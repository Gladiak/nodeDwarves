#!/usr/bin/env node
"use strict";

// Single training entry point (STRATEGY.md step T). Reads the recipe in config.json
// (`ai.training.recipe`), freezes everything a run depends on into its own folder, builds or reuses the
// mid-game snapshot bank, runs each phase through python/trainer_v2.py and refuses to finish if models/
// changed. One recipe, one command, one folder: a run can be repeated from its folder alone.
//
// Usage:
//   node scripts/train_recipe.js --out <run dir> [--rep 1] [--phases foundation,finetune]
//     [--set <recipe path>=<json>] [--bank <existing bank dir>] [--from <policy.json>] [--dry-run] [--bank-only]
//
// Examples:
//   node scripts/train_recipe.js --out experiments/runs/t1/base_r1
//   node scripts/train_recipe.js --out experiments/runs/t1/hold20_r1 --set leverNoiseHold=20
//   node scripts/train_recipe.js --out /tmp/smoke --phases foundation --set phases.0.episodes=16

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PYTHON = path.join(ROOT, ".venv", "bin", "python");

// Parse CLI options into a plain object.
function parseOptions(argv) {
  const options = { rep: 1, sets: [], phases: null, bank: null, from: null, dryRun: false, bankOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`);
      i += 1;
      return argv[i];
    };
    if (arg === "--out") options.out = path.resolve(next());
    else if (arg === "--rep") options.rep = Number(next());
    else if (arg === "--phases") options.phases = next().split(",").map((name) => name.trim()).filter(Boolean);
    else if (arg === "--set") options.sets.push(next());
    else if (arg === "--bank") options.bank = path.resolve(next());
    else if (arg === "--from") options.from = path.resolve(next());
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--bank-only") options.bankOnly = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.out) throw new Error("--out is required");
  if (!Number.isInteger(options.rep) || options.rep < 1) throw new Error("--rep must be a positive integer");
  return options;
}

// Apply `path=value` (JSON value) overrides to the recipe; array indexes are plain path segments.
function applySets(recipe, sets) {
  for (const entry of sets) {
    const index = entry.indexOf("=");
    if (index <= 0) throw new Error(`Bad --set ${entry}`);
    const keys = entry.slice(0, index).split(".");
    let value = entry.slice(index + 1);
    try { value = JSON.parse(value); } catch (error) { /* keep raw string */ }
    let node = recipe;
    for (const key of keys.slice(0, -1)) {
      if (node[key] === undefined || node[key] === null || typeof node[key] !== "object") {
        throw new Error(`--set ${entry}: unknown recipe path`);
      }
      node = node[key];
    }
    const last = keys[keys.length - 1];
    if (!(last in node)) throw new Error(`--set ${entry}: unknown recipe key ${last}`);
    node[last] = value;
  }
  return recipe;
}

// Validate the recipe so a typo fails before any simulation runs.
function validateRecipe(recipe) {
  const positiveInt = (value, label) => {
    if (!Number.isInteger(value) || value < 1) throw new Error(`recipe.${label} must be a positive integer`);
  };
  const ratio = (value, label) => {
    if (typeof value !== "number" || value < 0 || value > 1) throw new Error(`recipe.${label} must be in [0, 1]`);
  };
  positiveInt(recipe.stepTicks, "stepTicks");
  positiveInt(recipe.workers, "workers");
  positiveInt(recipe.leverNoiseHold, "leverNoiseHold");
  if (!Number.isInteger(recipe.policyLagBatches) || recipe.policyLagBatches < 0) {
    throw new Error("recipe.policyLagBatches must be a non-negative integer");
  }
  if (!Number.isInteger(recipe.seedBase)) throw new Error("recipe.seedBase must be an integer");
  if (recipe.leverLogStdInit !== null && !(typeof recipe.leverLogStdInit === "number" && Number.isFinite(recipe.leverLogStdInit))) {
    throw new Error("recipe.leverLogStdInit must be null (same as the other heads) or a number");
  }
  if (!recipe.snapshotBank || !Number.isInteger(recipe.snapshotBank.games) || recipe.snapshotBank.games < 1) {
    throw new Error("recipe.snapshotBank.games must be a positive integer");
  }
  ratio(recipe.snapshotBank.policyShare, "snapshotBank.policyShare");
  const bankTicks = recipe.snapshotBank && recipe.snapshotBank.ticks;
  if (!Array.isArray(bankTicks) || bankTicks.length === 0 || bankTicks.some((tick) => !Number.isInteger(tick) || tick < 1)) {
    throw new Error("recipe.snapshotBank.ticks must list positive integer ticks");
  }
  if (!(recipe.gamma > 0 && recipe.gamma < 1)) throw new Error("recipe.gamma must be in (0, 1)");
  if (!Array.isArray(recipe.phases) || recipe.phases.length === 0) throw new Error("recipe.phases is empty");
  recipe.phases.forEach((phase, index) => {
    const label = `phases.${index}`;
    if (!phase.name) throw new Error(`recipe.${label}.name is missing`);
    positiveInt(phase.episodes, `${label}.episodes`);
    positiveInt(phase.episodeTicks, `${label}.episodeTicks`);
    positiveInt(phase.epochs, `${label}.epochs`);
    positiveInt(phase.batchEpisodes, `${label}.batchEpisodes`);
    positiveInt(phase.miniBatchSize, `${label}.miniBatchSize`);
    positiveInt(phase.entropyRampEpisodes, `${label}.entropyRampEpisodes`);
    ratio(phase.snapshotProb, `${label}.snapshotProb`);
    ratio(phase.difficultyStart, `${label}.difficultyStart`);
    ratio(phase.difficultyEnd, `${label}.difficultyEnd`);
    ratio(phase.difficultyRampRatio, `${label}.difficultyRampRatio`);
    if (phase.episodeTicks % recipe.stepTicks !== 0) {
      throw new Error(`recipe.${label}.episodeTicks must be a multiple of stepTicks`);
    }
  });
  return recipe;
}

// Game config one phase trains on: the base config with the episode length as a profile override
// (training and eval), endgame off. No game phase is cut out of training: episodes end only on
// extinction (terminal) or the tick limit (bootstrapped).
function buildPhaseConfig(baseConfig, recipe, phase) {
  const config = JSON.parse(JSON.stringify(baseConfig));
  const training = config.ai.training;
  for (const key of ["configOverrides", "evalOverrides"]) {
    const overrides = training[key] || {};
    overrides.endgame = { ...(overrides.endgame || {}), enabled: false };
    overrides.ai = { ...(overrides.ai || {}), maxTicks: phase.episodeTicks };
    training[key] = overrides;
  }
  return config;
}

// Trainer command for one phase: everything else is read from the run folder (recipe.json and
// config_<phase>.json), so the folder alone defines the run.
function buildTrainerArgs(phase, options) {
  return [path.join("python", "trainer_v2.py"), "--run", options.out, "--phase", phase.name, "--rep", String(options.rep)];
}

// Hash a file or a directory listing of files.
function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

// Hash every file in models/ so the run can prove it never touched production checkpoints.
function hashModels() {
  const dir = path.join(ROOT, "models");
  if (!fs.existsSync(dir)) return "";
  return fs.readdirSync(dir).sort()
    .map((file) => `${file}:${sha256(fs.readFileSync(path.join(dir, file)))}`).join("\n");
}

// Reuse or build the snapshot bank. The cache key is the game config, the bank shape and the start
// policy: a chained run (--from) rebuilds the bank with that policy playing `policyShare` of the
// games, so training also sees the late-game states the current policy produces itself.
function ensureSnapshotBank(recipe, bankConfigPath, bankConfig, fromPolicy, dryRun) {
  const settings = recipe.snapshotBank;
  const policyHash = fromPolicy ? sha256(fs.readFileSync(fromPolicy)) : null;
  const share = fromPolicy ? settings.policyShare : 0;
  const key = sha256(JSON.stringify({ config: bankConfig, games: settings.games, ticks: settings.ticks, policyHash, share }))
    .slice(0, 16);
  const dir = path.resolve(ROOT, settings.dir, key);
  if (fs.existsSync(path.join(dir, "manifest.json")) || dryRun) return dir;
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`[recipe] building snapshot bank ${path.relative(ROOT, dir)} (${settings.games} games, policy share ${share})`);
  const args = [
    path.join(ROOT, "scripts", "build_snapshot_bank.js"),
    "--config", bankConfigPath, "--out", dir, "--games", String(settings.games),
    "--ticks", settings.ticks.join(","), "--workers", String(recipe.workers),
  ];
  if (fromPolicy && share > 0) args.push("--policy", fromPolicy, "--policy-share", String(share));
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit" });
  if (result.status !== 0) throw new Error("snapshot bank build failed");
  return dir;
}

// Current commit, or null outside git.
function gitCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function main() {
  const options = parseOptions(process.argv.slice(2));
  const baseConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
  const recipe = validateRecipe(applySets(JSON.parse(JSON.stringify(baseConfig.ai.training.recipe)), options.sets));
  const selected = recipe.phases
    .map((phase, index) => ({ phase, index }))
    .filter(({ phase }) => !options.phases || options.phases.includes(phase.name));
  if (selected.length === 0) throw new Error(`no recipe phase matches --phases ${options.phases}`);
  if (fs.existsSync(path.join(options.out, "run.json"))) {
    throw new Error(`${options.out} already holds a finished run; pick a new --out`);
  }
  fs.mkdirSync(options.out, { recursive: true });

  const phaseFiles = selected.map(({ phase }) => {
    const config = buildPhaseConfig(baseConfig, recipe, phase);
    const file = path.join(options.out, `config_${phase.name}.json`);
    fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
    return { config: file, payload: config };
  });
  let bank = null;
  if (selected.some(({ phase }) => phase.snapshotProb > 0)) {
    const first = selected.findIndex(({ phase }) => phase.snapshotProb > 0);
    bank = options.bank
      || ensureSnapshotBank(recipe, phaseFiles[first].config, phaseFiles[first].payload, options.from, options.dryRun);
  }
  // --bank-only builds (or finds) the cached snapshot bank ahead of a run and stops there.
  if (options.bankOnly) {
    console.log(`[recipe] snapshot bank: ${bank ? path.relative(ROOT, bank) : "none (no phase uses snapshot starts)"}`);
    return;
  }
  if (options.from) {
    fs.copyFileSync(options.from, path.join(options.out, "p.json"));
    fs.copyFileSync(options.from.replace(/\.json$/, ".state.pt"), path.join(options.out, "p.state.pt"));
  }

  const run = {
    recipe, rep: options.rep, phases: selected.map(({ phase }) => phase.name), sets: options.sets,
    bank: bank && path.relative(ROOT, bank), from: options.from, commit: gitCommit(), startedAt: new Date().toISOString(), timing: [],
  };
  fs.writeFileSync(path.join(options.out, "recipe.json"), `${JSON.stringify(run, null, 2)}\n`);

  const modelsBefore = hashModels();
  selected.forEach(({ phase }) => {
    const args = buildTrainerArgs(phase, options);
    if (options.dryRun) {
      console.log(`[recipe] ${phase.name}: ${PYTHON} ${args.join(" ")}`);
      return;
    }
    const started = Date.now();
    const result = spawnSync(PYTHON, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
    const seconds = (Date.now() - started) / 1000;
    fs.writeFileSync(path.join(options.out, `phase_${phase.name}.log`), `${result.stdout}\n${result.stderr}`);
    if (result.status !== 0) throw new Error(`${phase.name} failed (exit ${result.status}); see phase_${phase.name}.log`);
    const ppo = (result.stdout.match(/ppo\[[^\]]*\]/g) || []).slice(-1)[0] || "";
    run.timing.push({ phase: phase.name, seconds, ppo });
    console.log(`[recipe] ${phase.name} ${seconds.toFixed(0)}s ${ppo}`);
  });
  if (hashModels() !== modelsBefore) {
    throw new Error("models/ changed during the run: investigate before trusting any result");
  }
  if (options.dryRun) return;
  run.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(options.out, "run.json"), `${JSON.stringify(run, null, 2)}\n`);
}

module.exports = { applySets, validateRecipe, buildPhaseConfig, buildTrainerArgs };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[recipe] ${error.message}\n`);
    process.exit(1);
  }
}
