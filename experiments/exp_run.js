#!/usr/bin/env node
"use strict";

// Run one training-process variant in isolation (see STRATEGY.md, measurement protocol).
// It replays the m4-pro phases from scripts/train_wrapper.js with per-variant overrides,
// writes every artifact under --out, and refuses to finish if models/ changed.
//
// Example:
//   node experiments/exp_run.js --name f1280 --rep 1 --foundation-episodes 1280
//
// Options:
//   --out <dir>                  Experiment session folder (default: experiments/runs/current)
//   --name <id>                  Variant name (folder <name>_r<rep>)
//   --rep <n>                    Replicate number; drives training seeds (default 1)
//   --foundation-episodes <n>    Foundation episodes (default: m4-pro value)
//   --difficulty-ramp <n>        Foundation difficulty ramp in episodes (default: 0.75 x foundation episodes)
//   --entropy-ramp <n|run>       Foundation entropy ramp; "run" = foundation episodes (default: trainer config)
//   --entropy-final <x>          Foundation final entropy coefficient (default: trainer config)
//   --chain <k>                  Repeat the whole recipe k times, resuming from the previous run (default 1)
//   --no-finetune                Skip the finetune phase
//   --set <phase>:<flag>=<value> Extra train.py override, phase = foundation|finetune|all (repeatable)
//   --workers <n>                Rollout workers per phase (default 7)
//   --fresh-start                Start from a new random policy instead of the session start.json
//   --freeze-only                Only freeze the session configs and start policy, then exit

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const wrapper = require(path.join(ROOT, "scripts", "train_wrapper"));

// Parse CLI options into a plain object.
function parseOptions(argv) {
  const options = { out: path.join(__dirname, "runs", "current"), rep: 1, chain: 1, finetune: true, sets: [], workers: 7 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === "--out") options.out = path.resolve(next());
    else if (arg === "--name") options.name = next();
    else if (arg === "--rep") options.rep = Number(next());
    else if (arg === "--foundation-episodes") options.foundationEpisodes = Number(next());
    else if (arg === "--difficulty-ramp") options.difficultyRamp = Number(next());
    else if (arg === "--entropy-ramp") options.entropyRamp = next();
    else if (arg === "--entropy-final") options.entropyFinal = next();
    else if (arg === "--chain") options.chain = Number(next());
    else if (arg === "--no-finetune") options.finetune = false;
    else if (arg === "--set") options.sets.push(next());
    else if (arg === "--workers") options.workers = Number(next());
    else if (arg === "--fresh-start") options.freshStart = true;
    else if (arg === "--freeze-only") options.freezeOnly = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.name && !options.freezeOnly) throw new Error("--name is required");
  return options;
}

// Hash every file in models/ so the run can prove it never touched production checkpoints.
function hashModels() {
  const dir = path.join(ROOT, "models");
  return fs.readdirSync(dir).sort().map((file) => {
    const digest = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, file))).digest("hex");
    return `${file}:${digest}`;
  }).join("\n");
}

// Create the session folder once: frozen configs and a frozen copy of the start policy.
function ensureSession(out) {
  const configs = path.join(out, "configs");
  if (!fs.existsSync(path.join(configs, "config_canonical_promote.json"))) {
    fs.mkdirSync(configs, { recursive: true });
    const { runDir, files } = wrapper.prepareRunFiles(ROOT, "m4-balanced", {}, false);
    for (const [key, file] of Object.entries(files)) {
      fs.copyFileSync(file, path.join(configs, path.basename(file)));
      console.log(`[session] config ${key} -> ${path.basename(file)}`);
    }
    fs.rmSync(runDir, { recursive: true, force: true });
  }
  if (!fs.existsSync(path.join(out, "start.json"))) {
    fs.copyFileSync(path.join(ROOT, "models", "policy_best.json"), path.join(out, "start.json"));
    fs.copyFileSync(path.join(ROOT, "models", "policy_best.state.pt"), path.join(out, "start.state.pt"));
    console.log("[session] start policy frozen from models/policy_best.json");
  }
  return {
    fast: path.join(configs, "config_fast.json"),
    finetune: path.join(configs, "config_finetune.json"),
  };
}

// Replace (or append) one CLI option value.
function setOption(args, key, value) {
  const index = args.lastIndexOf(key);
  if (index >= 0) args[index + 1] = String(value);
  else args.push(key, String(value));
}

// Apply the variant overrides to the m4-pro phase list.
function buildVariantPhases(options, runDir, files) {
  let phases = wrapper.buildPhases("m4-pro", runDir, files).map((phase) => ({ ...phase, trainArgs: [...phase.trainArgs] }));
  if (!options.finetune) phases = phases.filter((phase) => !phase.name.includes("finetune"));
  const foundation = phases.find((phase) => phase.name.includes("foundation"));
  if (options.foundationEpisodes) {
    setOption(foundation.trainArgs, "--episodes", options.foundationEpisodes);
    setOption(foundation.trainArgs, "--difficulty-ramp", options.difficultyRamp || Math.round(options.foundationEpisodes * 0.75));
  } else if (options.difficultyRamp) {
    setOption(foundation.trainArgs, "--difficulty-ramp", options.difficultyRamp);
  }
  const episodes = foundation.trainArgs[foundation.trainArgs.lastIndexOf("--episodes") + 1];
  if (options.entropyRamp) setOption(foundation.trainArgs, "--entropy-ramp", options.entropyRamp === "run" ? episodes : options.entropyRamp);
  if (options.entropyFinal) setOption(foundation.trainArgs, "--entropy-coef-final", options.entropyFinal);
  for (const spec of options.sets) {
    const match = /^(foundation|finetune|all):(--[a-z0-9-]+)=(.*)$/.exec(spec);
    if (!match) throw new Error(`Bad --set ${spec}`);
    phases.filter((phase) => match[1] === "all" || phase.name.includes(match[1]))
      .forEach((phase) => setOption(phase.trainArgs, match[2], match[3]));
  }
  return phases;
}

// Rewrite production paths to the run folder and add isolation flags.
function isolateArgs(trainArgs, runDir, workers, seed) {
  const args = trainArgs.map((arg) => String(arg)
    .replace("models/policy_best.meta.json", path.join(runDir, "best.meta.json"))
    .replace("models/policy_best.json", path.join(runDir, "best.json"))
    .replace("models/policy.json", path.join(runDir, "p.json")));
  setOption(args, "--workers", workers);
  setOption(args, "--seed", seed);
  setOption(args, "--eval-every", 1000000);
  setOption(args, "--save-every", args[args.lastIndexOf("--episodes") + 1]);
  args.push(
    "--model-state-path", path.join(runDir, "p.state.pt"),
    "--best-model-state-path", path.join(runDir, "best.state.pt"),
    "--no-save-best-during-training",
  );
  return args;
}

function main() {
  const options = parseOptions(process.argv.slice(2));
  const modelsBefore = hashModels();
  const files = ensureSession(options.out);
  if (options.freezeOnly) {
    console.log(`[session] frozen in ${options.out}`);
    return;
  }
  const runDir = path.join(options.out, `${options.name}_r${options.rep}`);
  fs.rmSync(runDir, { recursive: true, force: true });
  fs.mkdirSync(runDir, { recursive: true });
  if (!options.freshStart) {
    fs.copyFileSync(path.join(options.out, "start.json"), path.join(runDir, "p.json"));
    fs.copyFileSync(path.join(options.out, "start.state.pt"), path.join(runDir, "p.state.pt"));
  }
  const python = path.join(ROOT, ".venv", "bin", "python");
  const timing = [];
  for (let link = 0; link < options.chain; link += 1) {
    const phases = buildVariantPhases(options, runDir, files);
    phases.forEach((phase, index) => {
      const seed = 7000 + options.rep * 1000 + index * 101 + link * 37;
      const args = isolateArgs(phase.trainArgs, runDir, options.workers, seed);
      if (options.freshStart && link === 0 && index === 0) args.push("--fresh");
      const started = Date.now();
      const result = spawnSync(python, ["python/train.py", ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
      const seconds = (Date.now() - started) / 1000;
      const tag = `c${link}_${index}`;
      fs.writeFileSync(path.join(runDir, `phase_${tag}.log`), `${result.stdout}\n${result.stderr}`);
      if (result.status !== 0) throw new Error(`${phase.name} failed (exit ${result.status}); see phase_${tag}.log`);
      fs.copyFileSync(path.join(runDir, "p.json"), path.join(runDir, `p_after_${tag}.json`));
      const ppo = (result.stdout.match(/ppo\[[^\]]*\]/g) || []).slice(-1)[0] || "";
      timing.push({ link, phase: phase.name, seconds, ppo });
      console.log(`${options.name} r${options.rep} link=${link} ${phase.name} ${seconds.toFixed(0)}s ${ppo}`);
    });
  }
  fs.writeFileSync(path.join(runDir, "timing.json"), `${JSON.stringify({ options, timing }, null, 1)}\n`);
  if (hashModels() !== modelsBefore) {
    throw new Error("models/ changed during the experiment: investigate before trusting any result");
  }
}

main();
