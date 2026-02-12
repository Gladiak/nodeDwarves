#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const PROFILE_FAST = "fast";
const PROFILE_QUALITY = "quality";
const PROFILE_FULL = "full";
const PROFILE_ENDGAME = "endgame";
const PROFILE_BENCHMARK = "benchmark";
const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_DIM = "\x1b[2m";
const ANSI_CYAN = "\x1b[36m";
const ANSI_BLUE = "\x1b[34m";
const ANSI_YELLOW = "\x1b[33m";
const ANSI_GREEN = "\x1b[32m";
const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const DEFAULT_WORKERS_AUTO_MIN = 2;
const DEFAULT_WORKERS_AUTO_MAX = 12;
const DEFAULT_WORKERS_RESERVE = 1;
const PHASE_WORKER_MIN = 2;
const PHASE_WORKER_SCALE = {
  foundation: 1.0,
  finetune: 0.85,
  endgame: 0.65,
  consolidation: 0.75,
  benchmark: 1.0,
};
const ENDGAME_STEP_TICKS = 2;
const ENDGAME_TARGET_EPISODE_TICKS = 20000;
const ENDGAME_MAX_STEPS = Math.ceil(ENDGAME_TARGET_EPISODE_TICKS / ENDGAME_STEP_TICKS);
// Keep headroom above training horizon so randomized season-start offsets do not truncate episodes.
const ENDGAME_PROFILE_MAX_TICKS = 24000;

const VALID_PROFILES = new Set([
  PROFILE_FAST,
  PROFILE_QUALITY,
  PROFILE_FULL,
  PROFILE_ENDGAME,
  PROFILE_BENCHMARK,
]);

// Apply ANSI color to one text segment when color output is enabled.
function tint(text, colorCode) {
  if (!USE_COLOR || !colorCode) {
    return String(text);
  }
  return `${colorCode}${text}${ANSI_RESET}`;
}

// Build a compact status tag for wrapper logs.
function formatTag(tag, colorCode) {
  return tint(`[${String(tag || "info").toUpperCase()}]`, colorCode);
}

// Print one wrapper status line with consistent formatting.
function printStatus(tag, message, colorCode) {
  process.stdout.write(`${formatTag(tag, colorCode)} ${message}\n`);
}

// Parse one integer wrapper option with lower-bound validation.
function parseIntegerOptionValue(rawValue, optionName, minimum) {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < minimum) {
    throw new Error(`${optionName} expects an integer >= ${minimum}.`);
  }
  return numeric;
}

// Clamp one integer to the provided inclusive bounds.
function clampInt(value, minValue, maxValue) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return minValue;
  }
  const rounded = Math.floor(numeric);
  return Math.max(minValue, Math.min(maxValue, rounded));
}

// Detect available CPU parallelism for auto worker tuning.
function detectCpuCount() {
  if (typeof os.availableParallelism === "function") {
    const available = Number(os.availableParallelism());
    if (Number.isInteger(available) && available > 0) {
      return available;
    }
  }
  const cpus = os.cpus();
  if (Array.isArray(cpus) && cpus.length > 0) {
    return cpus.length;
  }
  return 1;
}

// Find the latest CLI option value (supports "--key value" and "--key=value").
function findOptionValue(args, optionName) {
  if (!Array.isArray(args) || !optionName) {
    return null;
  }
  const prefix = `${optionName}=`;
  for (let index = args.length - 1; index >= 0; index -= 1) {
    const token = String(args[index] || "");
    if (token === optionName) {
      return index + 1 < args.length ? String(args[index + 1] || "") : "";
    }
    if (token.startsWith(prefix)) {
      return token.slice(prefix.length);
    }
  }
  return null;
}

// Upsert one CLI option while removing prior occurrences.
function upsertCliOption(args, optionName, optionValue) {
  const cleaned = [];
  const prefix = `${optionName}=`;
  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index] || "");
    if (token === optionName) {
      index += 1;
      continue;
    }
    if (token.startsWith(prefix)) {
      continue;
    }
    cleaned.push(token);
  }
  cleaned.push(optionName, String(optionValue));
  return cleaned;
}

// Parse one positive integer from a CLI option value, returning null on failure.
function parsePositiveInt(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }
  return numeric;
}

// Derive one phase category from its wrapper name.
function getPhaseWorkerCategory(phaseName) {
  const name = String(phaseName || "").toLowerCase();
  if (name.includes("foundation")) {
    return "foundation";
  }
  if (name.includes("finetune")) {
    return "finetune";
  }
  if (name.includes("endgame")) {
    return "endgame";
  }
  if (name.includes("consolidation")) {
    return "consolidation";
  }
  if (name.includes("benchmark")) {
    return "benchmark";
  }
  return "default";
}

// Resolve worker count for one training phase under the selected worker strategy.
function resolvePhaseWorkers(workerPlan, phase, workersProfileAware) {
  const baseWorkers = Math.max(1, Number(workerPlan.workers || 1));
  const phaseName = String((phase && phase.name) || "");

  if (workerPlan.mode === "manual" || workersProfileAware !== true) {
    return {
      workers: baseWorkers,
      category: "flat",
      scale: 1.0,
      batchEpisodes: parsePositiveInt(findOptionValue(phase && phase.trainArgs, "--batch-episodes")),
    };
  }

  const category = getPhaseWorkerCategory(phaseName);
  const scale = Number(PHASE_WORKER_SCALE[category] || 0.9);
  let workers = Math.max(PHASE_WORKER_MIN, Math.floor(baseWorkers * scale));

  const batchEpisodes = parsePositiveInt(findOptionValue(phase && phase.trainArgs, "--batch-episodes"));
  if (batchEpisodes !== null) {
    // Keep at most two rollout waves per PPO update window.
    const phaseCap = Math.max(PHASE_WORKER_MIN, batchEpisodes * 2);
    workers = Math.min(workers, phaseCap);
  }

  workers = clampInt(workers, 1, Math.max(1, workerPlan.workersAutoMax));
  return {
    workers,
    category,
    scale,
    batchEpisodes,
  };
}

// Resolve the final worker count (manual override wins over CPU auto-tuning).
function resolveWorkerPlan(trainExtraArgs, workerOptions = {}) {
  const cpuCount = detectCpuCount();
  const workersAutoMin = Math.max(
    1,
    Number.isInteger(workerOptions.workersAutoMin)
      ? workerOptions.workersAutoMin
      : DEFAULT_WORKERS_AUTO_MIN,
  );
  const workersAutoMax = Math.max(
    workersAutoMin,
    Number.isInteger(workerOptions.workersAutoMax)
      ? workerOptions.workersAutoMax
      : DEFAULT_WORKERS_AUTO_MAX,
  );
  const reserveDefault = Number.isInteger(workerOptions.workersReserve)
    ? workerOptions.workersReserve
    : DEFAULT_WORKERS_RESERVE;
  const workersReserve = clampInt(reserveDefault, 0, Math.max(0, cpuCount - 1));
  const autoWorkers = clampInt(cpuCount - workersReserve, workersAutoMin, workersAutoMax);

  const manualRaw = findOptionValue(trainExtraArgs, "--workers");
  if (manualRaw !== null) {
    return {
      mode: "manual",
      cpuCount,
      workersAutoMin,
      workersAutoMax,
      workersReserve,
      autoWorkers,
      workers: parseIntegerOptionValue(manualRaw, "--workers", 1),
    };
  }

  return {
    mode: "auto",
    cpuCount,
    workersAutoMin,
    workersAutoMax,
    workersReserve,
    autoWorkers,
    workers: autoWorkers,
  };
}

// Parse wrapper CLI options and collect train-only extra args.
function parseArgs(argv) {
  const result = {
    profile: PROFILE_FAST,
    trainExtraArgs: [],
    dryRun: false,
    help: false,
    workersAutoMin: DEFAULT_WORKERS_AUTO_MIN,
    workersAutoMax: DEFAULT_WORKERS_AUTO_MAX,
    workersReserve: DEFAULT_WORKERS_RESERVE,
    workersProfileAware: true,
  };
  const args = Array.isArray(argv) ? [...argv] : [];
  if (args.length > 0 && !String(args[0]).startsWith("-")) {
    result.profile = String(args.shift()).trim().toLowerCase();
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || "").trim();
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
    if (arg === "--workers-auto-min") {
      result.workersAutoMin = parseIntegerOptionValue(
        args[index + 1],
        "--workers-auto-min",
        1,
      );
      index += 1;
      continue;
    }
    if (arg.startsWith("--workers-auto-min=")) {
      result.workersAutoMin = parseIntegerOptionValue(
        arg.slice("--workers-auto-min=".length),
        "--workers-auto-min",
        1,
      );
      continue;
    }
    if (arg === "--workers-auto-max") {
      result.workersAutoMax = parseIntegerOptionValue(
        args[index + 1],
        "--workers-auto-max",
        1,
      );
      index += 1;
      continue;
    }
    if (arg.startsWith("--workers-auto-max=")) {
      result.workersAutoMax = parseIntegerOptionValue(
        arg.slice("--workers-auto-max=".length),
        "--workers-auto-max",
        1,
      );
      continue;
    }
    if (arg === "--workers-reserve") {
      result.workersReserve = parseIntegerOptionValue(
        args[index + 1],
        "--workers-reserve",
        0,
      );
      index += 1;
      continue;
    }
    if (arg.startsWith("--workers-reserve=")) {
      result.workersReserve = parseIntegerOptionValue(
        arg.slice("--workers-reserve=".length),
        "--workers-reserve",
        0,
      );
      continue;
    }
    if (arg === "--workers-flat") {
      result.workersProfileAware = false;
      continue;
    }
    if (arg === "--workers-profile-aware") {
      result.workersProfileAware = true;
      continue;
    }
    result.trainExtraArgs.push(arg);
  }
  result.workersAutoMax = Math.max(result.workersAutoMin, result.workersAutoMax);
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
    "  full",
    "  endgame",
    "  benchmark",
    "",
    "Wrapper options:",
    `  --workers-auto-min <n>  Auto workers lower bound (default: ${DEFAULT_WORKERS_AUTO_MIN})`,
    `  --workers-auto-max <n>  Auto workers upper bound (default: ${DEFAULT_WORKERS_AUTO_MAX})`,
    `  --workers-reserve <n>   Keep CPU slots free (default: ${DEFAULT_WORKERS_RESERVE})`,
    "  --workers-flat          Disable phase-aware worker scaling",
    "  --workers-profile-aware Enable phase-aware worker scaling (default)",
    "  --help, -h              Show this help",
    "  --dry-run               Print commands without executing",
    "",
    "Notes:",
    "  - Extra args are forwarded only to python/train.py calls.",
    "  - Forward --workers <n> to force a manual worker count on every phase.",
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
  const tag = String(options.tag || "cmd");
  const tagColor = options.tagColor || ANSI_BLUE;
  const printable = [command, ...(args || [])].join(" ");
  const dryPrefix = dryRun ? `${formatTag("dry-run", ANSI_YELLOW)} ` : "";
  process.stdout.write(
    `${dryPrefix}${formatTag(tag, tagColor)} ${tint("$", ANSI_DIM)} ${printable}\n`,
  );
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

  if (profile === PROFILE_FAST || profile === PROFILE_QUALITY || profile === PROFILE_FULL) {
    files.fast = path.join(runDir, "config_fast.json");
    const configFast = buildProfileConfig(baseConfig, 3200, false);
    fs.writeFileSync(files.fast, `${JSON.stringify(configFast, null, 2)}\n`);
  }
  if (profile === PROFILE_QUALITY || profile === PROFILE_FULL) {
    files.finetune = path.join(runDir, "config_finetune.json");
    const configFinetune = buildProfileConfig(baseConfig, 3600, false);
    fs.writeFileSync(files.finetune, `${JSON.stringify(configFinetune, null, 2)}\n`);
  }
  if (profile === PROFILE_ENDGAME || profile === PROFILE_FULL) {
    files.endgame = path.join(runDir, "config_endgame.json");
    const configEndgame = buildProfileConfig(baseConfig, ENDGAME_PROFILE_MAX_TICKS, true);
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
        name: "fast-foundation",
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
          "--save-every", "100",
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
          "--eval-episodes", "3",
          "--eval-max-steps", "1600",
          "--eval-difficulty", "1.0",
          "--eval-score", "rpt",
          "--min-improve", "0.025",
          "--max-steps", "1600",
          "--step-ticks", "2",
        ],
      },
    ];
  }

  if (profile === PROFILE_QUALITY) {
    return [
      {
        name: "quality-foundation",
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
          "--save-every", "100",
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
          "--eval-episodes", "3",
          "--eval-max-steps", "1600",
          "--eval-difficulty", "1.0",
          "--eval-score", "rpt",
          "--min-improve", "0.025",
          "--max-steps", "1600",
          "--step-ticks", "2",
        ],
      },
      {
        name: "quality-finetune",
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
          "--save-every", "40",
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
          "--eval-episodes", "4",
          "--eval-max-steps", "1800",
          "--eval-difficulty", "1.0",
          "--eval-score", "rpt",
          "--min-improve", "0.030",
          "--max-steps", "1800",
          "--step-ticks", "2",
        ],
      },
    ];
  }

  if (profile === PROFILE_FULL) {
    return [
      {
        name: "full-foundation",
        summaryLogEvery: "40",
        trainArgs: [
          "--config", files.fast,
          "--workers", "8",
          "--episodes", "280",
          "--max-steps", "1700",
          "--step-ticks", "2",
          "--epochs", "3",
          "--batch-episodes", "8",
          "--mini-batch-size", "1024",
          "--log-every", "40",
          "--save-every", "80",
          "--eval-every", "20",
          "--eval-episodes", "3",
          "--eval-max-steps", "1700",
          "--eval-difficulty", "1.0",
          "--difficulty-start", "0.10",
          "--difficulty-end", "1.0",
          "--difficulty-ramp", "180",
          "--model-path", "models/policy.json",
          "--best-model-path", "models/policy_best.json",
          "--best-model-meta-path", "models/policy_best.meta.json",
          "--resume-from-best",
          "--debug-run-dir", runDir,
          "--debug-summary-name", "summary_full_phase1_foundation.log",
          "--debug-prefix", "full_p1",
        ],
        promoteArgs: [
          "--config", files.fast,
          "--eval-episodes", "4",
          "--eval-max-steps", "1700",
          "--eval-difficulty", "1.0",
          "--eval-score", "rpt",
          "--min-improve", "0.025",
          "--max-steps", "1700",
          "--step-ticks", "2",
        ],
      },
      {
        name: "full-finetune",
        summaryLogEvery: "20",
        trainArgs: [
          "--config", files.finetune,
          "--workers", "8",
          "--full-sim",
          "--episodes", "90",
          "--max-steps", "2100",
          "--step-ticks", "2",
          "--epochs", "3",
          "--batch-episodes", "8",
          "--mini-batch-size", "1024",
          "--log-every", "20",
          "--save-every", "40",
          "--eval-every", "10",
          "--eval-episodes", "3",
          "--eval-max-steps", "2100",
          "--eval-difficulty", "1.0",
          "--difficulty-start", "1.0",
          "--difficulty-end", "1.0",
          "--difficulty-ramp", "1",
          "--lr", "0.00011",
          "--lr-final", "0.00005",
          "--entropy-coef", "0.0022",
          "--entropy-coef-final", "0.0009",
          "--entropy-ramp", "90",
          "--model-path", "models/policy.json",
          "--best-model-path", "models/policy_best.json",
          "--best-model-meta-path", "models/policy_best.meta.json",
          "--resume-from-best",
          "--debug-run-dir", runDir,
          "--debug-summary-name", "summary_full_phase2_finetune.log",
          "--debug-prefix", "full_p2",
        ],
        promoteArgs: [
          "--config", files.finetune,
          "--eval-episodes", "5",
          "--eval-max-steps", "2100",
          "--eval-difficulty", "1.0",
          "--eval-score", "rpt",
          "--min-improve", "0.030",
          "--max-steps", "2100",
          "--step-ticks", "2",
        ],
      },
      {
        name: "full-endgame",
        summaryLogEvery: "8",
        trainArgs: [
          "--config", files.endgame,
          "--workers", "8",
          "--full-sim",
          "--episodes", "24",
          "--max-steps", "2800",
          "--step-ticks", "2",
          "--epochs", "3",
          "--batch-episodes", "4",
          "--mini-batch-size", "1024",
          "--log-every", "8",
          "--save-every", "16",
          "--eval-every", "6",
          "--eval-episodes", "3",
          "--eval-max-steps", "2800",
          "--eval-difficulty", "1.0",
          "--difficulty-start", "1.0",
          "--difficulty-end", "1.0",
          "--difficulty-ramp", "1",
          "--lr", "0.00009",
          "--lr-final", "0.00004",
          "--entropy-coef", "0.0015",
          "--entropy-coef-final", "0.0005",
          "--entropy-ramp", "24",
          "--model-path", "models/policy.json",
          "--best-model-path", "models/policy_best.json",
          "--best-model-meta-path", "models/policy_best.meta.json",
          "--resume-from-best",
          "--debug-run-dir", runDir,
          "--debug-summary-name", "summary_full_phase3_endgame.log",
          "--debug-prefix", "full_p3",
        ],
        promoteArgs: [
          "--config", files.endgame,
          "--eval-episodes", "6",
          "--eval-max-steps", "2800",
          "--eval-difficulty", "1.0",
          "--eval-score", "rpt",
          "--min-improve", "0.040",
          "--max-steps", "2800",
          "--step-ticks", "2",
        ],
      },
      {
        name: "full-consolidation",
        summaryLogEvery: "15",
        trainArgs: [
          "--config", files.finetune,
          "--workers", "8",
          "--full-sim",
          "--episodes", "40",
          "--max-steps", "2200",
          "--step-ticks", "2",
          "--epochs", "3",
          "--batch-episodes", "8",
          "--mini-batch-size", "1024",
          "--log-every", "15",
          "--save-every", "30",
          "--eval-every", "10",
          "--eval-episodes", "3",
          "--eval-max-steps", "2200",
          "--eval-difficulty", "1.0",
          "--difficulty-start", "1.0",
          "--difficulty-end", "1.0",
          "--difficulty-ramp", "1",
          "--lr", "0.00008",
          "--lr-final", "0.00003",
          "--entropy-coef", "0.0012",
          "--entropy-coef-final", "0.0004",
          "--entropy-ramp", "40",
          "--model-path", "models/policy.json",
          "--best-model-path", "models/policy_best.json",
          "--best-model-meta-path", "models/policy_best.meta.json",
          "--resume-from-best",
          "--debug-run-dir", runDir,
          "--debug-summary-name", "summary_full_phase4_consolidate.log",
          "--debug-prefix", "full_p4",
        ],
        promoteArgs: [
          "--config", files.finetune,
          "--eval-episodes", "8",
          "--eval-max-steps", "2200",
          "--eval-difficulty", "1.0",
          "--eval-score", "rpt",
          "--min-improve", "0.040",
          "--max-steps", "2200",
          "--step-ticks", "2",
        ],
      },
    ];
  }

  if (profile === PROFILE_ENDGAME) {
    return [
      {
        name: "endgame-specialization",
        summaryLogEvery: "4",
        trainArgs: [
          "--config", files.endgame,
          "--workers", "8",
          "--full-sim",
          "--episodes", "8",
          "--max-steps", String(ENDGAME_MAX_STEPS),
          "--step-ticks", String(ENDGAME_STEP_TICKS),
          "--batch-episodes", "4",
          "--log-every", "4",
          "--save-every", "8",
          "--eval-every", "4",
          "--eval-episodes", "1",
          "--eval-max-steps", String(ENDGAME_MAX_STEPS),
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
          "--eval-episodes", "4",
          "--eval-max-steps", String(ENDGAME_MAX_STEPS),
          "--eval-difficulty", "1.0",
          "--eval-score", "rpt",
          "--min-improve", "0.000",
          "--max-steps", String(ENDGAME_MAX_STEPS),
          "--step-ticks", String(ENDGAME_STEP_TICKS),
        ],
      },
    ];
  }

  if (profile === PROFILE_BENCHMARK) {
    return [
      {
        name: "benchmark-fast",
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
          "--save-every", "100",
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
          "--eval-episodes", "2",
          "--eval-max-steps", "1200",
          "--eval-difficulty", "1.0",
          "--eval-score", "rpt",
          "--min-improve", "0.030",
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
function runProfile(rootDir, profile, trainExtraArgs, dryRun, workerOptions = {}) {
  const npmCommand = getNpmCommand();
  const pythonCommand = getPythonCommand(rootDir);
  const workerPlan = resolveWorkerPlan(trainExtraArgs, workerOptions);
  const workersProfileAware = workerOptions.workersProfileAware !== false;
  printStatus("profile", `Starting training profile: ${profile}`, ANSI_CYAN);
  if (workerPlan.mode === "manual") {
    printStatus(
      "workers",
      `manual=${workerPlan.workers} cpu=${workerPlan.cpuCount} auto=${workerPlan.autoWorkers} `
      + `(min=${workerPlan.workersAutoMin}, max=${workerPlan.workersAutoMax}, reserve=${workerPlan.workersReserve})`,
      ANSI_CYAN,
    );
  } else {
    printStatus(
      "workers",
      `auto=${workerPlan.workers} cpu=${workerPlan.cpuCount} `
      + `(min=${workerPlan.workersAutoMin}, max=${workerPlan.workersAutoMax}, reserve=${workerPlan.workersReserve})`,
      ANSI_CYAN,
    );
    if (workersProfileAware) {
      printStatus("workers", "mode=profile-aware (phase-scaled)", ANSI_CYAN);
    } else {
      printStatus("workers", "mode=flat (same workers on all phases)", ANSI_CYAN);
    }
  }
  runCommand(npmCommand, ["run", "ai:bootstrap", "--silent"], {
    cwd: rootDir,
    dryRun,
    tag: "bootstrap",
    tagColor: ANSI_CYAN,
  });

  const { runDir, files } = prepareRunFiles(rootDir, profile);
  printStatus("run-dir", runDir, ANSI_CYAN);
  const phases = buildPhases(profile, runDir, files);

  phases.forEach((phase, index) => {
    const phaseName = String(phase.name || `phase-${index + 1}`);
    process.stdout.write("\n");
    printStatus(
      "phase",
      tint(`${index + 1}/${phases.length}`, ANSI_BOLD) + ` ${phaseName}`,
      ANSI_BLUE,
    );
    const phaseExtras = getPhaseTrainExtras(trainExtraArgs, index);
    const phaseWorkers = resolvePhaseWorkers(workerPlan, phase, workersProfileAware);
    if (workerPlan.mode === "auto" && workersProfileAware) {
      const batchLabel = phaseWorkers.batchEpisodes !== null
        ? ` batchEpisodes=${phaseWorkers.batchEpisodes}`
        : "";
      printStatus(
        "workers",
        `phase=${phaseName} workers=${phaseWorkers.workers} `
        + `base=${workerPlan.workers} category=${phaseWorkers.category} scale=${phaseWorkers.scale.toFixed(2)}${batchLabel}`,
        ANSI_CYAN,
      );
    }
    const trainEnv = {
      ...process.env,
      SUMMARY_LOG_EVERY: phase.summaryLogEvery,
    };
    const trainArgs = upsertCliOption(
      [...phase.trainArgs, ...phaseExtras],
      "--workers",
      phaseWorkers.workers,
    );
    printStatus("train", `Launching optimizer loop (${phaseName})`, ANSI_YELLOW);
    runCommand(
      pythonCommand,
      ["python/train.py", ...trainArgs],
      { cwd: rootDir, env: trainEnv, dryRun, tag: "train", tagColor: ANSI_YELLOW },
    );
    printStatus("promote", "Evaluating latest checkpoint against best", ANSI_GREEN);
    runCommand(
      pythonCommand,
      ["python/promote_best.py", ...phase.promoteArgs],
      { cwd: rootDir, dryRun, tag: "promote", tagColor: ANSI_GREEN },
    );
    printStatus("phase", `Completed ${phaseName}`, ANSI_GREEN);
  });
  process.stdout.write("\n");
  printStatus("done", `Training profile completed: ${profile}`, ANSI_GREEN);
}

// Entry point for safe profile-based training orchestration.
function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    printHelp();
    process.exit(2);
  }
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
  runProfile(rootDir, args.profile, args.trainExtraArgs, args.dryRun, {
    workersAutoMin: args.workersAutoMin,
    workersAutoMax: args.workersAutoMax,
    workersReserve: args.workersReserve,
    workersProfileAware: args.workersProfileAware,
  });
}

main();
