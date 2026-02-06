#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const PROFILE_FAST = "fast";
const PROFILE_QUALITY = "quality";
const PROFILE_ENDGAME = "endgame";
const PROFILE_BENCHMARK = "benchmark";

const VALID_PROFILES = new Set([
  PROFILE_FAST,
  PROFILE_QUALITY,
  PROFILE_ENDGAME,
  PROFILE_BENCHMARK,
]);

// Parse wrapper CLI options and collect train-only extra args.
function parseArgs(argv) {
  const result = {
    profile: PROFILE_FAST,
    trainExtraArgs: [],
    dryRun: false,
    help: false,
  };
  const args = Array.isArray(argv) ? [...argv] : [];
  if (args.length > 0 && !String(args[0]).startsWith("-")) {
    result.profile = String(args.shift()).trim().toLowerCase();
  }
  for (const argRaw of args) {
    const arg = String(argRaw || "").trim();
    if (!arg || arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      result.dryRun = true;
      continue;
    }
    result.trainExtraArgs.push(arg);
  }
  return result;
}

// Print usage information for the training wrapper.
function printHelp() {
  const lines = [
    "Usage:",
    "  node scripts/train_wrapper.js [profile] [train args...]",
    "",
    "Profiles:",
    "  fast (default)",
    "  quality",
    "  endgame",
    "  benchmark",
    "",
    "Wrapper options:",
    "  --help, -h    Show this help",
    "  --dry-run     Print commands without executing",
    "",
    "Notes:",
    "  - Extra args are forwarded only to python/train.py calls.",
    "  - promote_best.py never receives forwarded args.",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

// Resolve command path for npm on the current platform.
function getNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

// Resolve command path for python in the project virtualenv.
function getPythonCommand(rootDir) {
  const unixPath = path.join(rootDir, ".venv", "bin", "python");
  if (fs.existsSync(unixPath)) {
    return unixPath;
  }
  const windowsPath = path.join(rootDir, ".venv", "Scripts", "python.exe");
  if (fs.existsSync(windowsPath)) {
    return windowsPath;
  }
  return "python3";
}

// Run one command and stop immediately on error.
function runCommand(command, args, options = {}) {
  const dryRun = options.dryRun === true;
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const printable = [command, ...(args || [])].join(" ");
  process.stdout.write(`${dryRun ? "[dry-run] " : ""}${printable}\n`);
  if (dryRun) {
    return;
  }
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
}

// Deep-clone plain JSON-like objects.
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

// Build the training config variant for one run profile.
function buildProfileConfig(baseConfig, maxTicks, endgameEnabled) {
  const config = cloneJson(baseConfig);
  config.ai = config.ai || {};
  config.ai.training = config.ai.training || {};
  config.ai.training.configOverrides = config.ai.training.configOverrides || {};
  config.ai.training.evalOverrides = config.ai.training.evalOverrides || {};

  const trainEndgame = config.ai.training.configOverrides.endgame || {};
  config.ai.training.configOverrides.endgame = {
    ...trainEndgame,
    enabled: endgameEnabled,
  };

  const evalEndgame = config.ai.training.evalOverrides.endgame || {};
  config.ai.training.evalOverrides.endgame = {
    ...evalEndgame,
    enabled: endgameEnabled,
  };

  const trainAi = config.ai.training.configOverrides.ai || {};
  config.ai.training.configOverrides.ai = {
    ...trainAi,
    maxTicks,
    termination: {
      ...(trainAi.termination || {}),
      enabled: false,
    },
  };

  const evalAi = config.ai.training.evalOverrides.ai || {};
  config.ai.training.evalOverrides.ai = {
    ...evalAi,
    maxTicks,
    termination: {
      ...(evalAi.termination || {}),
      enabled: false,
    },
  };

  return config;
}

// Create the run directory and all config files required by the selected profile.
function prepareRunFiles(rootDir, profile) {
  const runId = `run_${Date.now()}_${process.pid}_${Math.floor(Math.random() * 1000000)}`;
  const runDir = path.join(rootDir, "debug", runId);
  fs.mkdirSync(runDir, { recursive: true });

  const configPath = path.join(rootDir, "config.json");
  const baseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const files = {};

  if (profile === PROFILE_FAST || profile === PROFILE_QUALITY) {
    files.fast = path.join(runDir, "config_fast.json");
    const configFast = buildProfileConfig(baseConfig, 3200, false);
    fs.writeFileSync(files.fast, `${JSON.stringify(configFast, null, 2)}\n`);
  }
  if (profile === PROFILE_QUALITY) {
    files.finetune = path.join(runDir, "config_finetune.json");
    const configFinetune = buildProfileConfig(baseConfig, 3600, false);
    fs.writeFileSync(files.finetune, `${JSON.stringify(configFinetune, null, 2)}\n`);
  }
  if (profile === PROFILE_ENDGAME) {
    files.endgame = path.join(runDir, "config_endgame.json");
    const configEndgame = buildProfileConfig(baseConfig, 4800, true);
    fs.writeFileSync(files.endgame, `${JSON.stringify(configEndgame, null, 2)}\n`);
  }
  if (profile === PROFILE_BENCHMARK) {
    files.benchmark = path.join(runDir, "config_benchmark.json");
    const configBenchmark = buildProfileConfig(baseConfig, 2400, false);
    fs.writeFileSync(files.benchmark, `${JSON.stringify(configBenchmark, null, 2)}\n`);
  }

  return { runDir, files };
}

// Build the training/promote phase list for the selected profile.
function buildPhases(profile, runDir, files) {
  if (profile === PROFILE_FAST) {
    return [
      {
        summaryLogEvery: "50",
        trainArgs: [
          "--config", files.fast,
          "--workers", "8",
          "--episodes", "200",
          "--max-steps", "1600",
          "--step-ticks", "2",
          "--epochs", "3",
          "--batch-episodes", "8",
          "--mini-batch-size", "1024",
          "--log-every", "50",
          "--eval-every", "20",
          "--eval-episodes", "2",
          "--eval-max-steps", "1600",
          "--eval-difficulty", "1.0",
          "--difficulty-start", "0.12",
          "--difficulty-end", "1.0",
          "--difficulty-ramp", "120",
          "--model-path", "models/policy.json",
          "--best-model-path", "models/policy_best.json",
          "--best-model-meta-path", "models/policy_best.meta.json",
          "--resume-from-best",
          "--debug-run-dir", runDir,
          "--debug-summary-name", "summary_train.log",
          "--debug-prefix", "train",
        ],
        promoteArgs: [
          "--config", files.fast,
          "--eval-episodes", "2",
          "--eval-max-steps", "1600",
          "--eval-difficulty", "1.0",
          "--eval-score", "rpt",
          "--max-steps", "1600",
          "--step-ticks", "2",
        ],
      },
    ];
  }

  if (profile === PROFILE_QUALITY) {
    return [
      {
        summaryLogEvery: "50",
        trainArgs: [
          "--config", files.fast,
          "--workers", "8",
          "--episodes", "200",
          "--max-steps", "1600",
          "--step-ticks", "2",
          "--epochs", "3",
          "--batch-episodes", "8",
          "--mini-batch-size", "1024",
          "--log-every", "50",
          "--eval-every", "20",
          "--eval-episodes", "2",
          "--eval-max-steps", "1600",
          "--eval-difficulty", "1.0",
          "--difficulty-start", "0.12",
          "--difficulty-end", "1.0",
          "--difficulty-ramp", "120",
          "--model-path", "models/policy.json",
          "--best-model-path", "models/policy_best.json",
          "--best-model-meta-path", "models/policy_best.meta.json",
          "--resume-from-best",
          "--debug-run-dir", runDir,
          "--debug-summary-name", "summary_train.log",
          "--debug-prefix", "train",
        ],
        promoteArgs: [
          "--config", files.fast,
          "--eval-episodes", "2",
          "--eval-max-steps", "1600",
          "--eval-difficulty", "1.0",
          "--eval-score", "rpt",
          "--max-steps", "1600",
          "--step-ticks", "2",
        ],
      },
      {
        summaryLogEvery: "20",
        trainArgs: [
          "--config", files.finetune,
          "--workers", "8",
          "--full-sim",
          "--episodes", "40",
          "--max-steps", "1800",
          "--step-ticks", "2",
          "--epochs", "3",
          "--batch-episodes", "8",
          "--mini-batch-size", "1024",
          "--log-every", "20",
          "--eval-every", "10",
          "--eval-episodes", "2",
          "--eval-max-steps", "1800",
          "--eval-difficulty", "1.0",
          "--difficulty-start", "1.0",
          "--difficulty-end", "1.0",
          "--difficulty-ramp", "1",
          "--lr", "0.00012",
          "--lr-final", "0.00006",
          "--entropy-coef", "0.002",
          "--entropy-coef-final", "0.001",
          "--entropy-ramp", "40",
          "--model-path", "models/policy.json",
          "--best-model-path", "models/policy_best.json",
          "--best-model-meta-path", "models/policy_best.meta.json",
          "--resume-from-best",
          "--debug-run-dir", runDir,
          "--debug-summary-name", "summary_finetune.log",
          "--debug-prefix", "finetune",
        ],
        promoteArgs: [
          "--config", files.finetune,
          "--eval-episodes", "2",
          "--eval-max-steps", "1800",
          "--eval-difficulty", "1.0",
          "--eval-score", "rpt",
          "--max-steps", "1800",
          "--step-ticks", "2",
        ],
      },
    ];
  }

  if (profile === PROFILE_ENDGAME) {
    return [
      {
        summaryLogEvery: "4",
        trainArgs: [
          "--config", files.endgame,
          "--workers", "8",
          "--full-sim",
          "--episodes", "8",
          "--max-steps", "2400",
          "--step-ticks", "2",
          "--batch-episodes", "4",
          "--log-every", "4",
          "--eval-every", "8",
          "--eval-episodes", "1",
          "--eval-max-steps", "2400",
          "--eval-difficulty", "1.0",
          "--difficulty-start", "1.0",
          "--difficulty-end", "1.0",
          "--difficulty-ramp", "1",
          "--model-path", "models/policy.json",
          "--best-model-path", "models/policy_best.json",
          "--best-model-meta-path", "models/policy_best.meta.json",
          "--resume-from-best",
          "--debug-run-dir", runDir,
          "--debug-summary-name", "summary_endgame.log",
          "--debug-prefix", "endgame",
        ],
        promoteArgs: [
          "--config", files.endgame,
          "--eval-episodes", "1",
          "--eval-max-steps", "2400",
          "--eval-difficulty", "1.0",
          "--eval-score", "rpt",
          "--max-steps", "2400",
          "--step-ticks", "2",
        ],
      },
    ];
  }

  if (profile === PROFILE_BENCHMARK) {
    return [
      {
        summaryLogEvery: "50",
        trainArgs: [
          "--config", files.benchmark,
          "--workers", "8",
          "--episodes", "200",
          "--max-steps", "1200",
          "--step-ticks", "2",
          "--epochs", "3",
          "--batch-episodes", "8",
          "--mini-batch-size", "1024",
          "--log-every", "50",
          "--eval-every", "20",
          "--eval-episodes", "1",
          "--eval-max-steps", "1200",
          "--eval-difficulty", "1.0",
          "--model-path", "models/policy.json",
          "--best-model-path", "models/policy_best.json",
          "--best-model-meta-path", "models/policy_best.meta.json",
          "--resume-from-best",
          "--debug-mode", "summary",
          "--debug-run-dir", runDir,
          "--debug-summary-name", "summary_benchmark.log",
          "--debug-prefix", "benchmark",
        ],
        promoteArgs: [
          "--config", files.benchmark,
          "--eval-episodes", "1",
          "--eval-max-steps", "1200",
          "--eval-difficulty", "1.0",
          "--eval-score", "rpt",
          "--max-steps", "1200",
          "--step-ticks", "2",
          "--debug-mode", "summary",
        ],
      },
    ];
  }

  throw new Error(`Unsupported profile: ${profile}`);
}

// Return phase-specific train extras, keeping --fresh on first phase only.
function getPhaseTrainExtras(trainExtraArgs, phaseIndex) {
  if (!Array.isArray(trainExtraArgs) || trainExtraArgs.length === 0) {
    return [];
  }
  if (phaseIndex === 0) {
    return [...trainExtraArgs];
  }
  return trainExtraArgs.filter((arg) => arg !== "--fresh");
}

// Run all profile phases in sequence with train->promote ordering.
function runProfile(rootDir, profile, trainExtraArgs, dryRun) {
  const npmCommand = getNpmCommand();
  const pythonCommand = getPythonCommand(rootDir);
  runCommand(npmCommand, ["run", "ai:bootstrap", "--silent"], {
    cwd: rootDir,
    dryRun,
  });

  const { runDir, files } = prepareRunFiles(rootDir, profile);
  process.stdout.write(`Run directory: ${runDir}\n`);
  const phases = buildPhases(profile, runDir, files);

  phases.forEach((phase, index) => {
    const phaseExtras = getPhaseTrainExtras(trainExtraArgs, index);
    const trainEnv = {
      ...process.env,
      SUMMARY_LOG_EVERY: phase.summaryLogEvery,
    };
    runCommand(
      pythonCommand,
      ["python/train.py", ...phase.trainArgs, ...phaseExtras],
      { cwd: rootDir, env: trainEnv, dryRun },
    );
    runCommand(
      pythonCommand,
      ["python/promote_best.py", ...phase.promoteArgs],
      { cwd: rootDir, dryRun },
    );
  });
}

// Entry point for safe profile-based training orchestration.
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!VALID_PROFILES.has(args.profile)) {
    process.stderr.write(`Unknown profile: ${args.profile}\n`);
    printHelp();
    process.exit(2);
  }
  const rootDir = path.resolve(__dirname, "..");
  runProfile(rootDir, args.profile, args.trainExtraArgs, args.dryRun);
}

main();
