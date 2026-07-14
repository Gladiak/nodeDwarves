#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { runCleanup } = require("./clean_debug");

const PROFILE_FAST = "fast";
const PROFILE_QUALITY = "quality";
const PROFILE_QUALITY_MIXED = "quality-mixed";
const PROFILE_M4_BALANCED = "m4-balanced";
const PROFILE_FULL = "full";
const PROFILE_ENDGAME = "endgame";
const PROFILE_BENCHMARK = "benchmark";
const CANONICAL_MODE_PER_PHASE = "per-phase";
const CANONICAL_MODE_FINAL_ONLY = "final-only";
const CANONICAL_MODE_DISABLED = "disabled";
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
const DEFAULT_TRAIN_SEED_ROTATION = true;
const TRAIN_SEED_MODULUS = 2147483647;
const TRAIN_PHASE_SEED_STEP = 10007;
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
const CANONICAL_PROMOTE_EVAL_EPISODES = 20;
const CANONICAL_PROMOTE_EVAL_MAX_STEPS = 2200;
const CANONICAL_PROMOTE_STEP_TICKS = 2;
const CANONICAL_PROMOTE_MAX_STEPS = 2200;
const CANONICAL_PROMOTE_MIN_IMPROVE = 0.005;
const CANONICAL_PROMOTE_MAX_TICKS =
  (CANONICAL_PROMOTE_MAX_STEPS * CANONICAL_PROMOTE_STEP_TICKS) + 1200;
const LOW_LOAD_WORKERS_AUTO_MAX = 4;
const LOW_LOAD_WORKERS_RESERVE_MIN = 3;
const LOW_LOAD_CANONICAL_EVAL_EPISODES = 8;
const LOW_LOAD_CANONICAL_EVAL_MAX_STEPS = 1600;
const LOW_LOAD_PROMOTE_PROGRESS_EVERY = 2;
const M4_BALANCED_WORKERS_AUTO_MIN = 4;
const M4_BALANCED_WORKERS_AUTO_MAX = 5;
const M4_BALANCED_WORKERS_RESERVE = 5;
const M4_BALANCED_CANONICAL_EVAL_EPISODES = 12;
const M4_BALANCED_CANONICAL_EVAL_MAX_STEPS = 1800;
const M4_BALANCED_PROMOTE_PROGRESS_EVERY = 2;
const M4_BALANCED_ENDGAME_RESULT_WAIT_TIMEOUT_SECONDS = 1200;
const M4_BALANCED_TRAIN_EXTRAS = [
  "--eval-every", "40",
  "--eval-episodes", "2",
  "--eval-max-steps", "1400",
];

const VALID_PROFILES = new Set([
  PROFILE_FAST,
  PROFILE_QUALITY,
  PROFILE_QUALITY_MIXED,
  PROFILE_M4_BALANCED,
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

// Parse one finite number from mixed config input.
function toFiniteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

// Parse one boolean-ish config value with fallback.
function toBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "n", "off"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

// Resolve canonical promotion settings from config with stable defaults.
function resolveCanonicalPromotion(baseConfig) {
  const ai = (baseConfig && baseConfig.ai) || {};
  const training = (ai && ai.training) || {};
  const promotion = (training && training.promotion) || {};
  const canonical = (promotion && promotion.canonical) || {};

  const evalEpisodes = clampInt(
    toFiniteNumber(canonical.evalEpisodes, CANONICAL_PROMOTE_EVAL_EPISODES),
    1,
    200,
  );
  const evalMaxSteps = clampInt(
    toFiniteNumber(canonical.evalMaxSteps, CANONICAL_PROMOTE_EVAL_MAX_STEPS),
    1,
    20000,
  );
  const stepTicks = clampInt(
    toFiniteNumber(canonical.stepTicks, CANONICAL_PROMOTE_STEP_TICKS),
    1,
    100,
  );
  const maxSteps = clampInt(
    toFiniteNumber(canonical.maxSteps, CANONICAL_PROMOTE_MAX_STEPS),
    1,
    20000,
  );
  const minTicksFloor = (maxSteps * stepTicks) + 200;
  const maxTicksDefault = Math.max(
    CANONICAL_PROMOTE_MAX_TICKS,
    minTicksFloor,
  );
  const maxTicks = clampInt(
    toFiniteNumber(canonical.maxTicks, maxTicksDefault),
    minTicksFloor,
    200000,
  );
  const evalDifficulty = toFiniteNumber(canonical.evalDifficulty, 1.0);
  const minImprove = toFiniteNumber(canonical.minImprove, CANONICAL_PROMOTE_MIN_IMPROVE);
  const lcbZ = toFiniteNumber(canonical.lcbZ, 1.96);
  const evalScoreRaw = String(canonical.evalScore || "rpt").toLowerCase();
  const evalScore = ["reward", "rps", "rpt"].includes(evalScoreRaw) ? evalScoreRaw : "rpt";
  const seedRaw = Number(canonical.seed);
  const seed = Number.isFinite(seedRaw) ? Math.floor(seedRaw) : 0;

  return {
    enabled: toBoolean(canonical.enabled, true),
    evalEpisodes,
    evalMaxSteps,
    stepTicks,
    maxSteps,
    maxTicks,
    evalDifficulty,
    evalScore,
    minImprove,
    seed,
    endgameEnabled: toBoolean(canonical.endgameEnabled, false),
    requirePositiveLcb: toBoolean(canonical.requirePositiveLcb, true),
    lcbZ,
  };
}

// Apply one low-load preset to wrapper runtime options.
function applyLowLoadPreset(args) {
  if (!args || typeof args !== "object") {
    return;
  }
  args.lowLoad = true;
  args.lowWrite = true;
  args.autoCleanDebug = true;
  args.workersAutoMin = Math.min(args.workersAutoMin, LOW_LOAD_WORKERS_AUTO_MAX);
  args.workersAutoMax = Math.min(args.workersAutoMax, LOW_LOAD_WORKERS_AUTO_MAX);
  args.workersReserve = Math.max(args.workersReserve, LOW_LOAD_WORKERS_RESERVE_MIN);
  if (args.canonicalMode === CANONICAL_MODE_PER_PHASE) {
    args.canonicalMode = CANONICAL_MODE_FINAL_ONLY;
  }
  if (!Number.isInteger(args.canonicalEvalEpisodes)) {
    args.canonicalEvalEpisodes = LOW_LOAD_CANONICAL_EVAL_EPISODES;
  }
  if (!Number.isInteger(args.canonicalEvalMaxSteps)) {
    args.canonicalEvalMaxSteps = LOW_LOAD_CANONICAL_EVAL_MAX_STEPS;
  }
  if (typeof args.canonicalRequirePositiveLcb !== "boolean") {
    args.canonicalRequirePositiveLcb = false;
  }
  if (typeof args.phasePromoteRequirePositiveLcb !== "boolean") {
    args.phasePromoteRequirePositiveLcb = false;
  }
  args.promoteEvalProgress = true;
  if (!Number.isInteger(args.promoteEvalProgressEvery)) {
    args.promoteEvalProgressEvery = LOW_LOAD_PROMOTE_PROGRESS_EVERY;
  }
}

// Apply sustainable Apple M4 defaults while keeping final CLI overrides authoritative.
function applyM4BalancedPreset(args) {
  if (!args || typeof args !== "object") {
    return;
  }
  args.m4Balanced = true;
  args.lowWrite = true;
  args.autoCleanDebug = true;
  args.workersAutoMin = M4_BALANCED_WORKERS_AUTO_MIN;
  args.workersAutoMax = M4_BALANCED_WORKERS_AUTO_MAX;
  args.workersReserve = M4_BALANCED_WORKERS_RESERVE;
  args.canonicalMode = CANONICAL_MODE_FINAL_ONLY;
  args.canonicalEvalEpisodes = M4_BALANCED_CANONICAL_EVAL_EPISODES;
  args.canonicalEvalMaxSteps = M4_BALANCED_CANONICAL_EVAL_MAX_STEPS;
  args.canonicalRequirePositiveLcb = true;
  args.phasePromoteRequirePositiveLcb = false;
  args.skipPhasePromotes = true;
  args.promoteEvalProgress = true;
  args.promoteEvalProgressEvery = M4_BALANCED_PROMOTE_PROGRESS_EVERY;
  args.trainExtraArgs.push(...M4_BALANCED_TRAIN_EXTRAS);
}

// Apply run-time canonical promotion overrides on top of config defaults.
function applyCanonicalPromoteOverrides(canonicalPromote, runOptions = {}) {
  const resolved = {
    ...(canonicalPromote || {}),
  };
  const canonicalMode = String(
    runOptions.canonicalMode || CANONICAL_MODE_PER_PHASE,
  ).trim().toLowerCase();
  if (canonicalMode === CANONICAL_MODE_DISABLED) {
    resolved.enabled = false;
    return resolved;
  }
  if (Number.isInteger(runOptions.canonicalEvalEpisodes) && runOptions.canonicalEvalEpisodes > 0) {
    resolved.evalEpisodes = clampInt(runOptions.canonicalEvalEpisodes, 1, 200);
  }
  if (Number.isInteger(runOptions.canonicalEvalMaxSteps) && runOptions.canonicalEvalMaxSteps > 0) {
    const maxSteps = clampInt(runOptions.canonicalEvalMaxSteps, 1, 20000);
    resolved.evalMaxSteps = maxSteps;
    resolved.maxSteps = maxSteps;
  }
  if (typeof runOptions.canonicalRequirePositiveLcb === "boolean") {
    resolved.requirePositiveLcb = runOptions.canonicalRequirePositiveLcb;
  }
  const minTicksFloor = (resolved.maxSteps * resolved.stepTicks) + 200;
  resolved.maxTicks = clampInt(
    toFiniteNumber(resolved.maxTicks, minTicksFloor),
    minTicksFloor,
    200000,
  );
  return resolved;
}

// Resolve one training-only early-termination profile from config.
function resolveTrainingTerminationProfile(baseConfig) {
  const ai = (baseConfig && baseConfig.ai) || {};
  const training = (ai && ai.training) || {};
  const profile = (training && training.terminationProfile) || {};
  const enabled = toBoolean(profile.enabled, false);
  const resources = Array.isArray(profile.resources)
    ? profile.resources
      .map((resource) => String(resource || "").trim())
      .filter((resource) => resource.length > 0)
    : [];
  if (!enabled) {
    return {
      enabled: false,
      resources,
    };
  }
  return {
    enabled: true,
    minTicks: clampInt(toFiniteNumber(profile.minTicks, 0), 0, 200000),
    stableTicks: clampInt(toFiniteNumber(profile.stableTicks, 0), 0, 200000),
    minStockpileAvg: clampNumber(toFiniteNumber(profile.minStockpileAvg, 0), 0, 1),
    minStockpileMin: clampNumber(toFiniteNumber(profile.minStockpileMin, 0), 0, 1),
    maxCriticalNeeds: clampNumber(toFiniteNumber(profile.maxCriticalNeeds, 1), 0, 1),
    maxIdleAdults: clampNumber(toFiniteNumber(profile.maxIdleAdults, 1), 0, 1),
    minPopulationBalance: clampNumber(toFiniteNumber(profile.minPopulationBalance, 0), 0, 1),
    stockpileEps: Math.max(0, toFiniteNumber(profile.stockpileEps, 0.01)),
    resourceEps: Math.max(0, toFiniteNumber(profile.resourceEps, 0.01)),
    progressEps: Math.max(0, toFiniteNumber(profile.progressEps, 0.01)),
    allowDuringRaid: toBoolean(profile.allowDuringRaid, false),
    maxUnderrealmCombatPressure: clampNumber(
      toFiniteNumber(profile.maxUnderrealmCombatPressure, 1),
      0,
      1,
    ),
    maxMythsSeverity: clampNumber(toFiniteNumber(profile.maxMythsSeverity, 1), 0, 1),
    resources,
  };
}

// Clamp one number to inclusive bounds.
function clampNumber(value, minValue, maxValue) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return minValue;
  }
  return Math.max(minValue, Math.min(maxValue, numeric));
}

// Build a stable canonical promotion arg list used for every phase.
function buildCanonicalPromoteArgs(canonicalPromote, files) {
  if (!canonicalPromote || canonicalPromote.enabled !== true) {
    return null;
  }
  const configPath = files.canonical
    || files.fast
    || files.finetune
    || files.endgame
    || files.benchmark;
  if (!configPath) {
    return null;
  }
  const args = [
    "--config", configPath,
    "--eval-episodes", String(canonicalPromote.evalEpisodes),
    "--eval-max-steps", String(canonicalPromote.evalMaxSteps),
    "--eval-difficulty", String(canonicalPromote.evalDifficulty),
    "--eval-score", String(canonicalPromote.evalScore),
    "--min-improve", String(canonicalPromote.minImprove),
    "--max-steps", String(canonicalPromote.maxSteps),
    "--step-ticks", String(canonicalPromote.stepTicks),
    "--seed", String(canonicalPromote.seed),
  ];
  if (canonicalPromote.requirePositiveLcb) {
    args.push("--require-positive-lcb");
    args.push("--lcb-z", String(canonicalPromote.lcbZ));
  } else {
    args.push("--no-require-positive-lcb");
  }
  return args;
}

// Hash one string into a positive 31-bit seed.
function hashStringToSeed(text) {
  const source = String(text || "");
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) % TRAIN_SEED_MODULUS;
  }
  return Math.max(1, hash);
}

// Derive one deterministic base seed from a run directory id.
function resolveRunSeedBase(runDir) {
  const runId = path.basename(String(runDir || ""));
  return hashStringToSeed(runId);
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

// Remove one CLI option pair ("--name value" or "--name=value").
function removeCliOption(args, optionName) {
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
  return cleaned;
}

// Remove one boolean CLI flag ("--name" or "--name=value").
function removeCliFlag(args, flagName) {
  const prefix = `${flagName}=`;
  return (Array.isArray(args) ? args : []).filter((token) => {
    const text = String(token || "");
    if (text === flagName) {
      return false;
    }
    if (text.startsWith(prefix)) {
      return false;
    }
    return true;
  });
}

// Apply paired-LCB override for non-canonical phase promote checks.
function applyPhasePromoteLcbOptions(args, promoteOptions = {}) {
  if (typeof promoteOptions.phasePromoteRequirePositiveLcb !== "boolean") {
    return Array.isArray(args) ? [...args] : [];
  }
  const requirePositiveLcb = promoteOptions.phasePromoteRequirePositiveLcb === true;
  let nextArgs = Array.isArray(args) ? [...args] : [];
  nextArgs = removeCliFlag(nextArgs, "--require-positive-lcb");
  nextArgs = removeCliFlag(nextArgs, "--no-require-positive-lcb");
  if (!requirePositiveLcb) {
    nextArgs = removeCliOption(nextArgs, "--lcb-z");
    nextArgs.push("--no-require-positive-lcb");
  } else {
    nextArgs.push("--require-positive-lcb");
  }
  return nextArgs;
}

// Append promote eval-progress knobs without duplicating options.
function applyPromoteProgressOptions(args, promoteOptions = {}) {
  let nextArgs = Array.isArray(args) ? [...args] : [];
  if (promoteOptions.promoteEvalProgress === true && !nextArgs.includes("--eval-progress")) {
    nextArgs.push("--eval-progress");
  }
  if (
    Number.isInteger(promoteOptions.promoteEvalProgressEvery)
    && promoteOptions.promoteEvalProgressEvery > 0
  ) {
    nextArgs = upsertCliOption(
      nextArgs,
      "--eval-progress-every",
      promoteOptions.promoteEvalProgressEvery,
    );
  }
  return nextArgs;
}

// Parse one positive integer from a CLI option value, returning null on failure.
function parsePositiveInt(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }
  return numeric;
}

// Apply low-write checkpoint cadence to one phase train invocation.
function applyLowWriteTrainArgs(args) {
  let nextArgs = Array.isArray(args) ? [...args] : [];
  const episodes = parsePositiveInt(findOptionValue(nextArgs, "--episodes"));
  if (episodes !== null) {
    nextArgs = upsertCliOption(nextArgs, "--save-every", episodes);
  }
  return nextArgs;
}

// Resolve file-summary cadence for one phase under low-write mode.
function resolvePhaseSummaryLogEvery(phase, trainArgs, lowWriteEnabled) {
  if (lowWriteEnabled !== true) {
    return String(phase && phase.summaryLogEvery ? phase.summaryLogEvery : "1");
  }
  const episodes = parsePositiveInt(findOptionValue(trainArgs, "--episodes"));
  if (episodes === null) {
    return String(phase && phase.summaryLogEvery ? phase.summaryLogEvery : "1");
  }
  return String(episodes);
}

// Run post-training debug cleanup with wrapper-configured retention knobs.
function runAutoDebugCleanup(rootDir, workerOptions = {}, dryRun = false) {
  if (workerOptions.autoCleanDebug !== true) {
    return;
  }
  printStatus("cleanup", "Pruning debug artifacts after wrapper run", ANSI_CYAN);
  runCleanup({
    cwd: rootDir,
    dryRun: dryRun === true,
    keepRuns: Number.isInteger(workerOptions.debugKeepRuns)
      ? workerOptions.debugKeepRuns
      : undefined,
    keepContinuousReports: Number.isInteger(workerOptions.debugKeepContinuousReports)
      ? workerOptions.debugKeepContinuousReports
      : undefined,
    keepRegressionReports: Number.isInteger(workerOptions.debugKeepRegressionReports)
      ? workerOptions.debugKeepRegressionReports
      : undefined,
  });
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
  const cpuCount = Number.isInteger(workerOptions.cpuCount) && workerOptions.cpuCount > 0
    ? workerOptions.cpuCount
    : detectCpuCount();
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
    lowWrite: false,
    autoCleanDebug: false,
    debugKeepRuns: null,
    debugKeepContinuousReports: null,
    debugKeepRegressionReports: null,
    workersAutoMin: DEFAULT_WORKERS_AUTO_MIN,
    workersAutoMax: DEFAULT_WORKERS_AUTO_MAX,
    workersReserve: DEFAULT_WORKERS_RESERVE,
    workersProfileAware: true,
    trainSeedRotation: DEFAULT_TRAIN_SEED_ROTATION,
    canonicalMode: CANONICAL_MODE_PER_PHASE,
    canonicalEvalEpisodes: null,
    canonicalEvalMaxSteps: null,
    canonicalRequirePositiveLcb: null,
    phasePromoteRequirePositiveLcb: null,
    promoteEvalProgress: false,
    promoteEvalProgressEvery: null,
    skipPhasePromotes: false,
    lowLoad: false,
    m4Balanced: false,
  };
  const args = Array.isArray(argv) ? [...argv] : [];
  if (args.length > 0 && !String(args[0]).startsWith("-")) {
    result.profile = String(args.shift()).trim().toLowerCase();
  }
  if (result.profile === PROFILE_M4_BALANCED) {
    applyM4BalancedPreset(result);
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
    if (arg === "--low-write") {
      result.lowWrite = true;
      continue;
    }
    if (arg === "--no-low-write") {
      result.lowWrite = false;
      continue;
    }
    if (arg === "--auto-clean-debug") {
      result.autoCleanDebug = true;
      continue;
    }
    if (arg === "--no-auto-clean-debug") {
      result.autoCleanDebug = false;
      continue;
    }
    if (arg === "--debug-keep-runs") {
      result.debugKeepRuns = parseIntegerOptionValue(
        args[index + 1],
        "--debug-keep-runs",
        0,
      );
      index += 1;
      continue;
    }
    if (arg.startsWith("--debug-keep-runs=")) {
      result.debugKeepRuns = parseIntegerOptionValue(
        arg.slice("--debug-keep-runs=".length),
        "--debug-keep-runs",
        0,
      );
      continue;
    }
    if (arg === "--debug-keep-continuous-reports") {
      result.debugKeepContinuousReports = parseIntegerOptionValue(
        args[index + 1],
        "--debug-keep-continuous-reports",
        0,
      );
      index += 1;
      continue;
    }
    if (arg.startsWith("--debug-keep-continuous-reports=")) {
      result.debugKeepContinuousReports = parseIntegerOptionValue(
        arg.slice("--debug-keep-continuous-reports=".length),
        "--debug-keep-continuous-reports",
        0,
      );
      continue;
    }
    if (arg === "--debug-keep-regression-reports") {
      result.debugKeepRegressionReports = parseIntegerOptionValue(
        args[index + 1],
        "--debug-keep-regression-reports",
        0,
      );
      index += 1;
      continue;
    }
    if (arg.startsWith("--debug-keep-regression-reports=")) {
      result.debugKeepRegressionReports = parseIntegerOptionValue(
        arg.slice("--debug-keep-regression-reports=".length),
        "--debug-keep-regression-reports",
        0,
      );
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
    if (arg === "--train-seed-fixed") {
      result.trainSeedRotation = false;
      continue;
    }
    if (arg === "--train-seed-rotate") {
      result.trainSeedRotation = true;
      continue;
    }
    if (arg === "--canonical-final-only") {
      result.canonicalMode = CANONICAL_MODE_FINAL_ONLY;
      continue;
    }
    if (arg === "--canonical-per-phase") {
      result.canonicalMode = CANONICAL_MODE_PER_PHASE;
      result.skipPhasePromotes = false;
      continue;
    }
    if (arg === "--no-canonical-promote") {
      result.canonicalMode = CANONICAL_MODE_DISABLED;
      continue;
    }
    if (arg === "--canonical-eval-episodes") {
      result.canonicalEvalEpisodes = parseIntegerOptionValue(
        args[index + 1],
        "--canonical-eval-episodes",
        1,
      );
      index += 1;
      continue;
    }
    if (arg.startsWith("--canonical-eval-episodes=")) {
      result.canonicalEvalEpisodes = parseIntegerOptionValue(
        arg.slice("--canonical-eval-episodes=".length),
        "--canonical-eval-episodes",
        1,
      );
      continue;
    }
    if (arg === "--canonical-eval-max-steps") {
      result.canonicalEvalMaxSteps = parseIntegerOptionValue(
        args[index + 1],
        "--canonical-eval-max-steps",
        1,
      );
      index += 1;
      continue;
    }
    if (arg.startsWith("--canonical-eval-max-steps=")) {
      result.canonicalEvalMaxSteps = parseIntegerOptionValue(
        arg.slice("--canonical-eval-max-steps=".length),
        "--canonical-eval-max-steps",
        1,
      );
      continue;
    }
    if (arg === "--canonical-require-positive-lcb") {
      result.canonicalRequirePositiveLcb = true;
      continue;
    }
    if (arg === "--canonical-no-positive-lcb") {
      result.canonicalRequirePositiveLcb = false;
      continue;
    }
    if (arg === "--phase-promote-require-positive-lcb") {
      result.phasePromoteRequirePositiveLcb = true;
      continue;
    }
    if (arg === "--phase-promote-no-positive-lcb") {
      result.phasePromoteRequirePositiveLcb = false;
      continue;
    }
    if (arg === "--skip-phase-promotes") {
      result.skipPhasePromotes = true;
      continue;
    }
    if (arg === "--phase-promotes") {
      result.skipPhasePromotes = false;
      continue;
    }
    if (arg === "--promote-eval-progress") {
      result.promoteEvalProgress = true;
      continue;
    }
    if (arg === "--promote-no-eval-progress") {
      result.promoteEvalProgress = false;
      continue;
    }
    if (arg === "--promote-eval-progress-every") {
      result.promoteEvalProgressEvery = parseIntegerOptionValue(
        args[index + 1],
        "--promote-eval-progress-every",
        1,
      );
      index += 1;
      continue;
    }
    if (arg.startsWith("--promote-eval-progress-every=")) {
      result.promoteEvalProgressEvery = parseIntegerOptionValue(
        arg.slice("--promote-eval-progress-every=".length),
        "--promote-eval-progress-every",
        1,
      );
      continue;
    }
    if (arg === "--low-load") {
      applyLowLoadPreset(result);
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
    "  quality-mixed",
    "  m4-balanced",
    "  full",
    "  endgame",
    "  benchmark",
    "",
    "Wrapper options:",
    "  --low-write            Reduce latest-checkpoint writes to one end-of-phase save",
    "  --no-low-write         Restore the phase checkpoint cadence",
    "  --auto-clean-debug     Run debug cleanup after the wrapper finishes",
    "  --no-auto-clean-debug  Skip post-run debug cleanup",
    "  --debug-keep-runs <n>  Keep latest run_* folders during auto-clean",
    "  --debug-keep-continuous-reports <n>  Keep newest continuous reports during auto-clean",
    "  --debug-keep-regression-reports <n>  Keep newest regression report bundles during auto-clean",
    `  --workers-auto-min <n>  Auto workers lower bound (default: ${DEFAULT_WORKERS_AUTO_MIN})`,
    `  --workers-auto-max <n>  Auto workers upper bound (default: ${DEFAULT_WORKERS_AUTO_MAX})`,
    `  --workers-reserve <n>   Keep CPU slots free (default: ${DEFAULT_WORKERS_RESERVE})`,
    "  --workers-flat          Disable phase-aware worker scaling",
    "  --workers-profile-aware Enable phase-aware worker scaling (default)",
    "  --train-seed-fixed      Keep trainer seed exactly as configured/passed",
    "  --train-seed-rotate     Auto-rotate per-phase trainer seeds each run (default)",
    "  --canonical-final-only  Run canonical promote once at end (phase promotes stay lightweight)",
    "  --canonical-per-phase   Run canonical promote after every phase (default)",
    "  --no-canonical-promote  Disable canonical promote for this run",
    "  --canonical-eval-episodes <n>  Override canonical eval episodes for this run",
    "  --canonical-eval-max-steps <n> Override canonical eval/max steps for this run",
    "  --canonical-no-positive-lcb    Disable paired-LCB guardrail for this run",
    "  --canonical-require-positive-lcb Enable paired-LCB guardrail for this run",
    "  --phase-promote-no-positive-lcb Disable paired-LCB guard on non-canonical phase promotes",
    "  --phase-promote-require-positive-lcb Enable paired-LCB guard on non-canonical phase promotes",
    "  --skip-phase-promotes   Skip lightweight phase promote checks",
    "  --phase-promotes        Re-enable lightweight phase promotes",
    "  --promote-eval-progress         Enable partial eval progress logs on promote",
    "  --promote-no-eval-progress      Disable partial eval progress logs on promote",
    "  --promote-eval-progress-every <n> Promote progress cadence in episodes",
    "  --low-load             Apply low-load preset (workers cap + lighter canonical defaults)",
    "  --help, -h              Show this help",
    "  --dry-run               Print commands without executing",
    "",
    "Notes:",
    "  - Extra args are forwarded only to python/train.py calls.",
    "  - Forward --workers <n> to force a manual worker count on every phase.",
    "  - promote_best.py never receives forwarded args.",
    "  - Wrapper enforces --no-save-best-during-training and uses a canonical promote profile from ai.training.promotion.canonical.",
    "  - --low-write keeps one latest checkpoint write per phase; promotion checks still run unchanged.",
    "  - Low-load preset defaults: canonical-final-only, 8x1600 canonical eval, no paired-LCB, progress every 2 episodes.",
    "  - M4-balanced preset defaults: quality-mixed phases, 5->4 workers, sparse train eval, no phase promotes, final 12x1800 canonical eval with paired-LCB.",
    "  - Promotion reports are written per phase plus one run summary in the run directory.",
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

// Convert one free-form label into a filesystem-safe token.
function toPathToken(value, fallback = "item") {
  const text = String(value || "").trim().toLowerCase();
  const normalized = text.replace(/[^a-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

// Read one JSON file and return null on parse/read errors.
function readJsonFileSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

// Ensure the parent directory exists for the provided output path.
function ensureParentDir(filePath) {
  const directory = path.dirname(filePath);
  if (directory && directory !== ".") {
    fs.mkdirSync(directory, { recursive: true });
  }
}

// Write one JSON payload with stable formatting.
function writeJsonFile(filePath, payload) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

// Format one numeric value for markdown reports.
function fmtNumber(value, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return numeric.toFixed(digits);
}

// Build one run-level promotion summary payload.
function buildRunPromotionSummary(profile, runDir, canonicalPromote, phaseReports) {
  const phases = Array.isArray(phaseReports) ? phaseReports.map((entry) => {
    const report = entry && entry.report ? entry.report : {};
    const paired = report.paired || {};
    return {
      index: Number(entry.index),
      phase: String(entry.phase || ""),
      promoted: report.promoted === true,
      reason: String(report.reason || ""),
      latest_score: Number(report.latest && report.latest.score),
      best_score_before: Number(report.best_score_before),
      best_score_after: Number(report.best_score_after),
      delta_score: Number(report.delta_score),
      paired_lcb: Number(paired.lower_bound),
      paired_mean_delta: Number(paired.mean_delta),
      report_json: String(entry.reportJsonPath || ""),
      report_md: String(entry.reportMarkdownPath || ""),
    };
  }) : [];

  const promotedCount = phases.filter((phase) => phase.promoted).length;
  const deltas = phases
    .map((phase) => phase.delta_score)
    .filter((value) => Number.isFinite(value));
  const avgDelta = deltas.length > 0
    ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length
    : null;
  const finalBest = phases.length > 0 ? phases[phases.length - 1].best_score_after : null;

  return {
    version: 1,
    profile: String(profile || ""),
    runDir: String(runDir || ""),
    generatedAt: new Date().toISOString(),
    canonicalPromotion: canonicalPromote || null,
    totals: {
      phases: phases.length,
      promoted: promotedCount,
      retained: Math.max(0, phases.length - promotedCount),
      avgDeltaScore: avgDelta,
      finalBestScore: Number.isFinite(finalBest) ? finalBest : null,
    },
    phases,
  };
}

// Render one markdown run-level promotion summary with metric glossary.
function renderRunPromotionSummaryMarkdown(summary) {
  const canonical = summary.canonicalPromotion || {};
  const lines = [
    "# Training Promotion Summary",
    "",
    `- Generated at: \`${summary.generatedAt}\``,
    `- Profile: \`${summary.profile}\``,
    `- Run dir: \`${summary.runDir}\``,
    "",
    "## Canonical Benchmark",
    "",
    `- Enabled: \`${canonical.enabled === true}\``,
    `- Eval episodes: \`${canonical.evalEpisodes ?? "-"}\``,
    `- Eval max steps: \`${canonical.evalMaxSteps ?? "-"}\``,
    `- Score mode: \`${canonical.evalScore ?? "-"}\``,
    `- Min improve: \`${fmtNumber(canonical.minImprove)}\``,
    `- Require positive LCB: \`${canonical.requirePositiveLcb === true}\``,
    `- LCB z: \`${fmtNumber(canonical.lcbZ)}\``,
    "",
    "## Totals",
    "",
    `- Phases: \`${summary.totals.phases}\``,
    `- Promoted: \`${summary.totals.promoted}\``,
    `- Retained: \`${summary.totals.retained}\``,
    `- Avg delta score: \`${fmtNumber(summary.totals.avgDeltaScore)}\``,
    `- Final best score: \`${fmtNumber(summary.totals.finalBestScore)}\``,
    "",
    "## Phase Results",
    "",
    "| # | Phase | Promoted | Reason | Latest | Best before | Best after | Delta | Paired LCB |",
    "|---|---|---:|---|---:|---:|---:|---:|---:|",
  ];
  summary.phases.forEach((phase) => {
    lines.push(
      `| ${phase.index} | ${phase.phase} | ${phase.promoted ? "yes" : "no"} | ${phase.reason} | `
      + `${fmtNumber(phase.latest_score)} | ${fmtNumber(phase.best_score_before)} | `
      + `${fmtNumber(phase.best_score_after)} | ${fmtNumber(phase.delta_score)} | ${fmtNumber(phase.paired_lcb)} |`,
    );
  });
  lines.push(
    "",
    "## Metric Glossary",
    "",
    "- `Latest`: canonical benchmark score for `models/policy.json`.",
    "- `Best before`: canonical benchmark score for `models/policy_best.json` before the check.",
    "- `Best after`: best score tracked after this phase check.",
    "- `Delta`: `latest - best_before` on the same canonical benchmark.",
    "- `Paired LCB`: lower confidence bound of paired episode deltas (`latest_i - best_i`).",
    "- `Promoted`: checkpoint replacement decision for this phase.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

// Write one run-level promotion summary (JSON + Markdown) into the run directory.
function writeRunPromotionSummary(runDir, summary) {
  const jsonPath = path.join(runDir, "report_training_promotion_summary.json");
  const mdPath = path.join(runDir, "report_training_promotion_summary.md");
  writeJsonFile(jsonPath, summary);
  ensureParentDir(mdPath);
  fs.writeFileSync(mdPath, renderRunPromotionSummaryMarkdown(summary));
  return { jsonPath, mdPath };
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
  const trainingTermination = resolveTrainingTerminationProfile(baseConfig);

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
      ...trainingTermination,
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
function prepareRunFiles(rootDir, profile, runOptions = {}, dryRun = false) {
  const runId = `run_${Date.now()}_${process.pid}_${Math.floor(Math.random() * 1000000)}`;
  const runDir = path.join(rootDir, "debug", runId);
  if (!dryRun) {
    fs.mkdirSync(runDir, { recursive: true });
  }

  const configPath = path.join(rootDir, "config.json");
  const baseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const files = {};
  const canonicalPromote = applyCanonicalPromoteOverrides(
    resolveCanonicalPromotion(baseConfig),
    runOptions,
  );
  const writeConfig = (filePath, payload) => {
    if (!dryRun) {
      fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
    }
  };

  if (
    profile === PROFILE_FAST
    || profile === PROFILE_QUALITY
    || profile === PROFILE_QUALITY_MIXED
    || profile === PROFILE_M4_BALANCED
    || profile === PROFILE_FULL
  ) {
    files.fast = path.join(runDir, "config_fast.json");
    const configFast = buildProfileConfig(baseConfig, 3200, false);
    writeConfig(files.fast, configFast);
  }
  if (
    profile === PROFILE_QUALITY
    || profile === PROFILE_QUALITY_MIXED
    || profile === PROFILE_M4_BALANCED
    || profile === PROFILE_FULL
  ) {
    files.finetune = path.join(runDir, "config_finetune.json");
    const configFinetune = buildProfileConfig(baseConfig, 3600, false);
    writeConfig(files.finetune, configFinetune);
  }
  if (
    profile === PROFILE_M4_BALANCED
    || profile === PROFILE_ENDGAME
    || profile === PROFILE_FULL
  ) {
    files.endgame = path.join(runDir, "config_endgame.json");
    const configEndgame = buildProfileConfig(baseConfig, ENDGAME_PROFILE_MAX_TICKS, true);
    writeConfig(files.endgame, configEndgame);
  }
  if (profile === PROFILE_BENCHMARK) {
    files.benchmark = path.join(runDir, "config_benchmark.json");
    const configBenchmark = buildProfileConfig(baseConfig, 2400, false);
    writeConfig(files.benchmark, configBenchmark);
  }

  if (canonicalPromote.enabled) {
    files.canonical = path.join(runDir, "config_canonical_promote.json");
    const configCanonical = buildProfileConfig(
      baseConfig,
      canonicalPromote.maxTicks,
      canonicalPromote.endgameEnabled,
    );
    writeConfig(files.canonical, configCanonical);
  }

  return { runDir, files, canonicalPromote };
}

// Build the training/promote phase list for the selected profile.
function buildPhases(profile, runDir, files) {
  if (profile === PROFILE_M4_BALANCED) {
    const mixedPhases = buildPhases(PROFILE_QUALITY_MIXED, runDir, files).map((phase) => ({
      ...phase,
      name: String(phase.name || "quality-mixed").replace("quality-mixed", "m4-balanced"),
    }));
    return [
      ...mixedPhases,
      {
        name: "m4-balanced-endgame",
        summaryLogEvery: "4",
        resultWaitTimeoutSeconds: M4_BALANCED_ENDGAME_RESULT_WAIT_TIMEOUT_SECONDS,
        trainArgs: [
          "--config", files.endgame,
          "--workers", "8",
          "--full-sim",
          "--episodes", "8",
          "--max-steps", String(ENDGAME_MAX_STEPS),
          "--step-ticks", String(ENDGAME_STEP_TICKS),
          "--epochs", "3",
          "--batch-episodes", "4",
          "--mini-batch-size", "1024",
          "--log-every", "4",
          "--save-every", "8",
          "--eval-every", "4",
          "--eval-episodes", "1",
          "--eval-max-steps", String(ENDGAME_MAX_STEPS),
          "--eval-difficulty", "1.0",
          "--difficulty-start", "1.0",
          "--difficulty-end", "1.0",
          "--difficulty-ramp", "1",
          "--lr", "0.00009",
          "--lr-final", "0.00004",
          "--entropy-coef", "0.0015",
          "--entropy-coef-final", "0.0005",
          "--entropy-ramp", "8",
          "--model-path", "models/policy.json",
          "--best-model-path", "models/policy_best.json",
          "--best-model-meta-path", "models/policy_best.meta.json",
          "--resume-from-latest",
          "--debug-run-dir", runDir,
          "--debug-summary-name", "summary_m4_balanced_endgame.log",
          "--debug-prefix", "m4_balanced_endgame",
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
          "--eval-episodes", "8",
          "--eval-max-steps", "1600",
          "--eval-difficulty", "1.0",
          "--eval-score", "rpt",
          "--min-improve", "0.010",
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
          "--resume-from-latest",
          "--debug-run-dir", runDir,
          "--debug-summary-name", "summary_train.log",
          "--debug-prefix", "train",
        ],
        promoteArgs: [
          "--config", files.fast,
          "--eval-episodes", "10",
          "--eval-max-steps", "1600",
          "--eval-difficulty", "1.0",
          "--eval-score", "rpt",
          "--min-improve", "0.007",
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
          "--resume-from-latest",
          "--debug-run-dir", runDir,
          "--debug-summary-name", "summary_finetune.log",
          "--debug-prefix", "finetune",
        ],
        promoteArgs: [
          "--config", files.finetune,
          "--eval-episodes", "12",
          "--eval-max-steps", "1800",
          "--eval-difficulty", "1.0",
          "--eval-score", "rpt",
          "--min-improve", "0.009",
          "--max-steps", "1800",
          "--step-ticks", "2",
        ],
      },
    ];
  }

  if (profile === PROFILE_QUALITY_MIXED) {
    return [
      {
        name: "quality-mixed-foundation",
        summaryLogEvery: "40",
        trainArgs: [
          "--config", files.fast,
          "--workers", "8",
          "--episodes", "160",
          "--max-steps", "1400",
          "--step-ticks", "2",
          "--epochs", "3",
          "--batch-episodes", "8",
          "--mini-batch-size", "1024",
          "--log-every", "40",
          "--save-every", "80",
          "--eval-every", "20",
          "--eval-episodes", "2",
          "--eval-max-steps", "1400",
          "--eval-difficulty", "1.0",
          "--difficulty-start", "0.12",
          "--difficulty-end", "1.0",
          "--difficulty-ramp", "120",
          "--model-path", "models/policy.json",
          "--best-model-path", "models/policy_best.json",
          "--best-model-meta-path", "models/policy_best.meta.json",
          "--resume-from-latest",
          "--debug-run-dir", runDir,
          "--debug-summary-name", "summary_quality_mixed_foundation.log",
          "--debug-prefix", "quality_mixed_foundation",
        ],
        promoteArgs: [
          "--config", files.fast,
          "--eval-episodes", "10",
          "--eval-max-steps", "1400",
          "--eval-difficulty", "1.0",
          "--eval-score", "rpt",
          "--min-improve", "0.010",
          "--max-steps", "1400",
          "--step-ticks", "2",
        ],
      },
      {
        name: "quality-mixed-finetune",
        summaryLogEvery: "20",
        trainArgs: [
          "--config", files.finetune,
          "--workers", "8",
          "--full-sim",
          "--episodes", "50",
          "--max-steps", "1800",
          "--step-ticks", "2",
          "--epochs", "3",
          "--batch-episodes", "8",
          "--mini-batch-size", "1024",
          "--log-every", "20",
          "--save-every", "50",
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
          "--entropy-ramp", "50",
          "--model-path", "models/policy.json",
          "--best-model-path", "models/policy_best.json",
          "--best-model-meta-path", "models/policy_best.meta.json",
          "--resume-from-latest",
          "--debug-run-dir", runDir,
          "--debug-summary-name", "summary_quality_mixed_finetune.log",
          "--debug-prefix", "quality_mixed_finetune",
        ],
        promoteArgs: [
          "--config", files.finetune,
          "--eval-episodes", "12",
          "--eval-max-steps", "1800",
          "--eval-difficulty", "1.0",
          "--eval-score", "rpt",
          "--min-improve", "0.012",
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
          "--resume-from-latest",
          "--debug-run-dir", runDir,
          "--debug-summary-name", "summary_full_phase1_foundation.log",
          "--debug-prefix", "full_p1",
        ],
        promoteArgs: [
          "--config", files.fast,
          "--eval-episodes", "6",
          "--eval-max-steps", "1700",
          "--eval-difficulty", "1.0",
          "--eval-score", "rpt",
          "--min-improve", "0.010",
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
          "--resume-from-latest",
          "--debug-run-dir", runDir,
          "--debug-summary-name", "summary_full_phase2_finetune.log",
          "--debug-prefix", "full_p2",
        ],
        promoteArgs: [
          "--config", files.finetune,
          "--eval-episodes", "8",
          "--eval-max-steps", "2100",
          "--eval-difficulty", "1.0",
          "--eval-score", "rpt",
          "--min-improve", "0.012",
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
          "--resume-from-latest",
          "--debug-run-dir", runDir,
          "--debug-summary-name", "summary_full_phase3_endgame.log",
          "--debug-prefix", "full_p3",
        ],
        promoteArgs: [
          "--config", files.endgame,
          "--eval-episodes", "10",
          "--eval-max-steps", "2800",
          "--eval-difficulty", "1.0",
          "--eval-score", "rpt",
          "--min-improve", "0.015",
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
          "--resume-from-latest",
          "--debug-run-dir", runDir,
          "--debug-summary-name", "summary_full_phase4_consolidate.log",
          "--debug-prefix", "full_p4",
        ],
        promoteArgs: [
          "--config", files.finetune,
          "--eval-episodes", "12",
          "--eval-max-steps", "2200",
          "--eval-difficulty", "1.0",
          "--eval-score", "rpt",
          "--min-improve", "0.015",
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

  const { runDir, files, canonicalPromote } = prepareRunFiles(
    rootDir,
    profile,
    workerOptions,
    dryRun,
  );
  printStatus("run-dir", runDir, ANSI_CYAN);
  const phases = buildPhases(profile, runDir, files);
  const canonicalPromoteArgs = buildCanonicalPromoteArgs(canonicalPromote, files);
  const canonicalMode = String(
    workerOptions.canonicalMode || CANONICAL_MODE_PER_PHASE,
  ).trim().toLowerCase();
  const canonicalPerPhaseEnabled =
    canonicalPromoteArgs && canonicalMode === CANONICAL_MODE_PER_PHASE;
  const canonicalFinalEnabled =
    canonicalPromoteArgs && canonicalMode === CANONICAL_MODE_FINAL_ONLY;
  const phaseReports = [];
  if (canonicalPromoteArgs) {
    printStatus(
      "promote",
      `mode=canonical-${canonicalMode} episodes=${canonicalPromote.evalEpisodes} `
      + `maxSteps=${canonicalPromote.evalMaxSteps} score=${canonicalPromote.evalScore} `
      + `minImprove=${canonicalPromote.minImprove.toFixed(4)} lcb=${canonicalPromote.requirePositiveLcb ? "on" : "off"}`,
      ANSI_CYAN,
    );
  } else if (canonicalMode === CANONICAL_MODE_DISABLED) {
    printStatus("promote", "mode=phase-only (canonical disabled for this run)", ANSI_CYAN);
  }
  if (workerOptions.promoteEvalProgress === true) {
    const cadence = Number.isInteger(workerOptions.promoteEvalProgressEvery)
      ? workerOptions.promoteEvalProgressEvery
      : "-";
    printStatus("promote", `eval-progress=on cadence=${cadence}`, ANSI_CYAN);
  }
  if (typeof workerOptions.phasePromoteRequirePositiveLcb === "boolean") {
    printStatus(
      "promote",
      `phase-lcb=${workerOptions.phasePromoteRequirePositiveLcb ? "on" : "off"} (non-canonical phases)`,
      ANSI_CYAN,
    );
  }
  if (workerOptions.lowLoad === true) {
    printStatus("profile", "low-load preset enabled", ANSI_CYAN);
  }
  if (workerOptions.m4Balanced === true) {
    printStatus(
      "profile",
      "M4-balanced preset enabled (quality-mixed + long-horizon endgame, sustainable workers, final canonical)",
      ANSI_CYAN,
    );
  }
  if (workerOptions.lowWrite === true) {
    printStatus("profile", "low-write checkpoint cadence enabled", ANSI_CYAN);
  }
  const seedRotationEnabled = workerOptions.trainSeedRotation !== false;
  const runSeedBase = resolveRunSeedBase(runDir);
  if (seedRotationEnabled) {
    printStatus("seed", `mode=rotate base=${runSeedBase}`, ANSI_CYAN);
  } else {
    printStatus("seed", "mode=fixed", ANSI_CYAN);
  }
  const executePromoteCheck = (phaseName, promoteArgs, reportIndex, options = {}) => {
    const isCanonical = options.isCanonical === true;
    const safePhaseName = String(phaseName || `phase-${reportIndex}`);
    printStatus("promote", `Evaluating latest checkpoint against best (${safePhaseName})`, ANSI_GREEN);
    let promoteArgsResolved = Array.isArray(promoteArgs) ? [...promoteArgs] : [];
    if (!isCanonical) {
      promoteArgsResolved = applyPhasePromoteLcbOptions(promoteArgsResolved, workerOptions);
    }
    promoteArgsResolved = applyPromoteProgressOptions(promoteArgsResolved, workerOptions);
    const phaseToken = toPathToken(safePhaseName, `phase_${reportIndex}`);
    const phaseReportJsonPath = path.join(
      runDir,
      `report_promote_${String(reportIndex).padStart(2, "0")}_${phaseToken}.json`,
    );
    const phaseReportMdPath = path.join(
      runDir,
      `report_promote_${String(reportIndex).padStart(2, "0")}_${phaseToken}.md`,
    );
    const promoteArgsWithReport = [
      ...promoteArgsResolved,
      "--report-json", phaseReportJsonPath,
      "--report-md", phaseReportMdPath,
      "--report-tag", safePhaseName,
    ];
    runCommand(
      pythonCommand,
      ["python/promote_best.py", ...promoteArgsWithReport],
      { cwd: rootDir, dryRun, tag: "promote", tagColor: ANSI_GREEN },
    );
    if (!dryRun) {
      const reportPayload = readJsonFileSafe(phaseReportJsonPath);
      if (reportPayload) {
        phaseReports.push({
          index: reportIndex,
          phase: safePhaseName,
          reportJsonPath: phaseReportJsonPath,
          reportMarkdownPath: phaseReportMdPath,
          report: reportPayload,
        });
        const deltaLabel = fmtNumber(reportPayload.delta_score);
        const bestAfterLabel = fmtNumber(reportPayload.best_score_after);
        printStatus(
          "report",
          `phase=${safePhaseName} promoted=${reportPayload.promoted === true ? "yes" : "no"} `
          + `delta=${deltaLabel} best_after=${bestAfterLabel}`,
          ANSI_CYAN,
        );
      } else {
        printStatus(
          "report",
          `phase=${safePhaseName} missing promotion report: ${phaseReportJsonPath}`,
          ANSI_YELLOW,
        );
      }
    }
  };

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
    const trainArgsBase = [
      ...phase.trainArgs,
      ...phaseExtras,
      "--no-save-best-during-training",
    ];
    let trainArgsPrepared = trainArgsBase;
    if (workerOptions.lowWrite === true) {
      trainArgsPrepared = applyLowWriteTrainArgs(trainArgsPrepared);
    }
    let trainArgsWithSeed = trainArgsPrepared;
    if (seedRotationEnabled && findOptionValue(trainArgsBase, "--seed") === null) {
      const phaseSeed = (runSeedBase + (index + 1) * TRAIN_PHASE_SEED_STEP) % (TRAIN_SEED_MODULUS - 1) + 1;
      trainArgsWithSeed = upsertCliOption(trainArgsWithSeed, "--seed", phaseSeed);
      printStatus("seed", `phase=${phaseName} seed=${phaseSeed}`, ANSI_CYAN);
    }
    const trainArgs = upsertCliOption(
      trainArgsWithSeed,
      "--workers",
      phaseWorkers.workers,
    );
    const trainEnv = {
      ...process.env,
      SUMMARY_LOG_EVERY: resolvePhaseSummaryLogEvery(
        phase,
        trainArgs,
        workerOptions.lowWrite === true,
      ),
    };
    const inheritedResultWaitTimeoutSeconds = parsePositiveInt(
      process.env.TRAIN_RESULT_WAIT_TIMEOUT_SECONDS,
    );
    const phaseResultWaitTimeoutSeconds = parsePositiveInt(phase.resultWaitTimeoutSeconds);
    const resultWaitTimeoutSeconds = inheritedResultWaitTimeoutSeconds
      ?? phaseResultWaitTimeoutSeconds;
    if (resultWaitTimeoutSeconds !== null) {
      trainEnv.TRAIN_RESULT_WAIT_TIMEOUT_SECONDS = String(resultWaitTimeoutSeconds);
      printStatus(
        "watchdog",
        `phase=${phaseName} result-timeout=${resultWaitTimeoutSeconds}s `
          + `source=${inheritedResultWaitTimeoutSeconds !== null ? "environment" : "phase"}`,
        ANSI_CYAN,
      );
    }
    printStatus("train", `Launching optimizer loop (${phaseName})`, ANSI_YELLOW);
    runCommand(
      pythonCommand,
      ["python/train.py", ...trainArgs],
      { cwd: rootDir, env: trainEnv, dryRun, tag: "train", tagColor: ANSI_YELLOW },
    );
    const skipPhasePromote = workerOptions.skipPhasePromotes === true;
    if (skipPhasePromote) {
      printStatus(
        "promote",
        `Skipping phase promote (${phaseName}); canonical final check remains enabled`,
        ANSI_CYAN,
      );
    } else {
      const promoteArgs = canonicalPerPhaseEnabled ? canonicalPromoteArgs : phase.promoteArgs;
      executePromoteCheck(phaseName, promoteArgs, index + 1, {
        isCanonical: canonicalPerPhaseEnabled === true,
      });
    }
    printStatus("phase", `Completed ${phaseName}`, ANSI_GREEN);
  });
  if (canonicalFinalEnabled) {
    executePromoteCheck("canonical-final", canonicalPromoteArgs, phases.length + 1, {
      isCanonical: true,
    });
  }
  if (!dryRun) {
    const summary = buildRunPromotionSummary(profile, runDir, canonicalPromote, phaseReports);
    const summaryPaths = writeRunPromotionSummary(runDir, summary);
    printStatus("report", `summary json=${summaryPaths.jsonPath}`, ANSI_CYAN);
    printStatus("report", `summary md=${summaryPaths.mdPath}`, ANSI_CYAN);
  }
  runAutoDebugCleanup(rootDir, workerOptions, dryRun);
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
    trainSeedRotation: args.trainSeedRotation,
    canonicalMode: args.canonicalMode,
    canonicalEvalEpisodes: args.canonicalEvalEpisodes,
    canonicalEvalMaxSteps: args.canonicalEvalMaxSteps,
    canonicalRequirePositiveLcb: args.canonicalRequirePositiveLcb,
    phasePromoteRequirePositiveLcb: args.phasePromoteRequirePositiveLcb,
    skipPhasePromotes: args.skipPhasePromotes,
    promoteEvalProgress: args.promoteEvalProgress,
    promoteEvalProgressEvery: args.promoteEvalProgressEvery,
    lowWrite: args.lowWrite,
    autoCleanDebug: args.autoCleanDebug,
    debugKeepRuns: args.debugKeepRuns,
    debugKeepContinuousReports: args.debugKeepContinuousReports,
    debugKeepRegressionReports: args.debugKeepRegressionReports,
    lowLoad: args.lowLoad,
    m4Balanced: args.m4Balanced,
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  PROFILE_M4_BALANCED,
  applyM4BalancedPreset,
  buildPhases,
  parseArgs,
  resolvePhaseWorkers,
  resolveWorkerPlan,
};
