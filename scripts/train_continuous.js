#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_DIM = "\x1b[2m";
const ANSI_CYAN = "\x1b[36m";
const ANSI_BLUE = "\x1b[34m";
const ANSI_YELLOW = "\x1b[33m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_RED = "\x1b[31m";
const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;

const TRAIN_KIND_DAILY = "daily";
const TRAIN_KIND_FULL = "full";
const TRAIN_KIND_HIGH = "high";

// Apply ANSI color to one text segment when color output is enabled.
function tint(text, colorCode) {
  if (!USE_COLOR || !colorCode) {
    return String(text);
  }
  return `${colorCode}${text}${ANSI_RESET}`;
}

// Build one compact status tag for continuous training logs.
function formatTag(tag, colorCode) {
  return tint(`[${String(tag || "info").toUpperCase()}]`, colorCode);
}

// Print one status line with stable formatting.
function printStatus(tag, message, colorCode) {
  process.stdout.write(`${formatTag(tag, colorCode)} ${message}\n`);
}

// Parse one integer option with lower bound validation.
function parseIntegerOption(rawValue, optionName, minimum) {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < minimum) {
    throw new Error(`${optionName} expects an integer >= ${minimum}.`);
  }
  return numeric;
}

// Parse one finite numeric option.
function parseNumberOption(rawValue, optionName) {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${optionName} expects a finite number.`);
  }
  return numeric;
}

// Parse CLI options for the continuous training orchestrator.
function parseArgs(rawArgs) {
  const args = Array.isArray(rawArgs) ? [...rawArgs] : [];
  const options = {
    cycles: 24,
    fullEvery: 4,
    highEvery: 8,
    gateEvery: 8,
    maxNoImprove: 10,
    maxGateFail: 2,
    improveThreshold: 0,
    freshFirst: false,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || "").trim();
    if (!arg) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--fresh-first") {
      options.freshFirst = true;
      continue;
    }
    if (arg === "--cycles") {
      options.cycles = parseIntegerOption(args[index + 1], "--cycles", 1);
      index += 1;
      continue;
    }
    if (arg.startsWith("--cycles=")) {
      options.cycles = parseIntegerOption(arg.slice("--cycles=".length), "--cycles", 1);
      continue;
    }
    if (arg === "--full-every") {
      options.fullEvery = parseIntegerOption(args[index + 1], "--full-every", 0);
      index += 1;
      continue;
    }
    if (arg.startsWith("--full-every=")) {
      options.fullEvery = parseIntegerOption(arg.slice("--full-every=".length), "--full-every", 0);
      continue;
    }
    if (arg === "--high-every") {
      options.highEvery = parseIntegerOption(args[index + 1], "--high-every", 0);
      index += 1;
      continue;
    }
    if (arg.startsWith("--high-every=")) {
      options.highEvery = parseIntegerOption(arg.slice("--high-every=".length), "--high-every", 0);
      continue;
    }
    if (arg === "--gate-every") {
      options.gateEvery = parseIntegerOption(args[index + 1], "--gate-every", 0);
      index += 1;
      continue;
    }
    if (arg.startsWith("--gate-every=")) {
      options.gateEvery = parseIntegerOption(arg.slice("--gate-every=".length), "--gate-every", 0);
      continue;
    }
    if (arg === "--max-no-improve") {
      options.maxNoImprove = parseIntegerOption(args[index + 1], "--max-no-improve", 0);
      index += 1;
      continue;
    }
    if (arg.startsWith("--max-no-improve=")) {
      options.maxNoImprove = parseIntegerOption(
        arg.slice("--max-no-improve=".length),
        "--max-no-improve",
        0,
      );
      continue;
    }
    if (arg === "--max-gate-fail") {
      options.maxGateFail = parseIntegerOption(args[index + 1], "--max-gate-fail", 0);
      index += 1;
      continue;
    }
    if (arg.startsWith("--max-gate-fail=")) {
      options.maxGateFail = parseIntegerOption(
        arg.slice("--max-gate-fail=".length),
        "--max-gate-fail",
        0,
      );
      continue;
    }
    if (arg === "--improve-threshold") {
      options.improveThreshold = parseNumberOption(args[index + 1], "--improve-threshold");
      index += 1;
      continue;
    }
    if (arg.startsWith("--improve-threshold=")) {
      options.improveThreshold = parseNumberOption(
        arg.slice("--improve-threshold=".length),
        "--improve-threshold",
      );
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

// Print CLI usage for the continuous orchestrator.
function printHelp() {
  const lines = [
    "Usage:",
    "  node scripts/train_continuous.js [options]",
    "",
    "Options:",
    "  --cycles <n>             Total cycles to run (default: 24)",
    "  --full-every <n>         Run full consolidation every n cycles (0 disables, default: 4)",
    "  --high-every <n>         Run strict high-quality cycle every n cycles (0 disables, default: 8)",
    "  --gate-every <n>         Run validation gate every n cycles (0 disables, default: 8)",
    "  --max-no-improve <n>     Stop after n consecutive non-improving cycles (0 disables, default: 10)",
    "  --max-gate-fail <n>      Stop after n consecutive gate failures (0 disables, default: 2)",
    "  --improve-threshold <x>  Delta score threshold for improvement (default: 0)",
    "  --fresh-first            Add --fresh only on cycle 1 training command",
    "  --dry-run                Print commands and schedule without executing",
    "  --help, -h               Show this help",
    "",
    "Training schedule policy:",
    "  - `high` takes priority over `full` when both match the same cycle.",
    "  - `full` cycle uses `ai:train:full -- --canonical-final-only --phase-promote-no-positive-lcb`.",
    "  - other cycles use `ai:train:quality:daily`.",
    "",
    "Examples:",
    "  node scripts/train_continuous.js --cycles 24 --full-every 4 --high-every 8 --gate-every 8",
    "  node scripts/train_continuous.js --cycles 12 --high-every 0 --gate-every 4 --max-no-improve 6",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

// Resolve npm executable path on the current platform.
function getNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

// Execute one command and return its exit status.
function runCommand(command, args, options = {}) {
  const cwd = options.cwd || process.cwd();
  const dryRun = options.dryRun === true;
  const tag = String(options.tag || "cmd");
  const tagColor = options.tagColor || ANSI_BLUE;
  const printable = [command, ...(args || [])].join(" ");
  const prefix = dryRun ? `${formatTag("dry-run", ANSI_YELLOW)} ` : "";
  process.stdout.write(`${prefix}${formatTag(tag, tagColor)} ${tint("$", ANSI_DIM)} ${printable}\n`);
  if (dryRun) {
    return 0;
  }
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    throw result.error;
  }
  return Number.isInteger(result.status) ? result.status : 1;
}

// Return one run label and npm arguments for the requested training kind.
function buildTrainCommand(kind, includeFresh) {
  const safeKind = String(kind || "");
  const forwardedArgs = [];
  let scriptName = "ai:train:quality:daily";
  let label = "quality-daily";

  if (safeKind === TRAIN_KIND_FULL) {
    scriptName = "ai:train:full";
    label = "full-consolidation";
    forwardedArgs.push("--canonical-final-only", "--phase-promote-no-positive-lcb");
  } else if (safeKind === TRAIN_KIND_HIGH) {
    scriptName = "ai:train:quality:high";
    label = "quality-high";
  }

  if (includeFresh) {
    forwardedArgs.push("--fresh");
  }

  const args = ["run", scriptName];
  if (forwardedArgs.length > 0) {
    args.push("--", ...forwardedArgs);
  }

  return {
    kind: safeKind || TRAIN_KIND_DAILY,
    label,
    scriptName,
    forwardedArgs,
    args,
  };
}

// Decide which training command should run for the provided cycle.
function selectTrainKind(cycleIndex, options) {
  if (options.highEvery > 0 && cycleIndex % options.highEvery === 0) {
    return TRAIN_KIND_HIGH;
  }
  if (options.fullEvery > 0 && cycleIndex % options.fullEvery === 0) {
    return TRAIN_KIND_FULL;
  }
  return TRAIN_KIND_DAILY;
}

// Return all run-level promotion summary files currently available.
function listRunSummaryFiles(rootDir) {
  const debugDir = path.join(rootDir, "debug");
  if (!fs.existsSync(debugDir)) {
    return [];
  }
  const directories = fs.readdirSync(debugDir, { withFileTypes: true });
  const entries = [];
  directories.forEach((entry) => {
    if (!entry.isDirectory() || !entry.name.startsWith("run_")) {
      return;
    }
    const summaryPath = path.join(debugDir, entry.name, "report_training_promotion_summary.json");
    if (!fs.existsSync(summaryPath)) {
      return;
    }
    try {
      const stat = fs.statSync(summaryPath);
      entries.push({
        path: summaryPath,
        mtimeMs: stat.mtimeMs,
      });
    } catch (error) {
      // Ignore transient file stat errors.
    }
  });
  entries.sort((left, right) => {
    if (left.mtimeMs !== right.mtimeMs) {
      return left.mtimeMs - right.mtimeMs;
    }
    return left.path.localeCompare(right.path);
  });
  return entries;
}

// Return the newest summary file created after one snapshot set.
function findNewestSummaryAfter(snapshotSet, currentEntries) {
  const addedEntries = (currentEntries || []).filter((entry) => !snapshotSet.has(entry.path));
  if (addedEntries.length === 0) {
    return null;
  }
  addedEntries.sort((left, right) => {
    if (left.mtimeMs !== right.mtimeMs) {
      return right.mtimeMs - left.mtimeMs;
    }
    return right.path.localeCompare(left.path);
  });
  return addedEntries[0];
}

// Read one JSON payload and return null on read/parse errors.
function readJsonFileSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

// Return the canonical decision metrics from one run summary payload.
function extractCanonicalMetrics(summaryPayload) {
  if (!summaryPayload || typeof summaryPayload !== "object") {
    return null;
  }
  const phases = Array.isArray(summaryPayload.phases) ? summaryPayload.phases : [];
  if (phases.length === 0) {
    return null;
  }
  let phase = phases.find((item) => item && item.phase === "canonical-final");
  if (!phase) {
    phase = phases[phases.length - 1];
  }
  if (!phase || typeof phase !== "object") {
    return null;
  }
  const deltaScore = Number(phase.delta_score);
  const pairedLcb = Number(phase.paired_lcb);
  const latestScore = Number(phase.latest_score);
  const bestScoreBefore = Number(phase.best_score_before);
  return {
    phase: String(phase.phase || ""),
    promoted: phase.promoted === true,
    reason: String(phase.reason || ""),
    deltaScore: Number.isFinite(deltaScore) ? deltaScore : null,
    pairedLcb: Number.isFinite(pairedLcb) ? pairedLcb : null,
    latestScore: Number.isFinite(latestScore) ? latestScore : null,
    bestScoreBefore: Number.isFinite(bestScoreBefore) ? bestScoreBefore : null,
  };
}

// Format one number for logs and markdown tables.
function fmtNumber(value, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return numeric.toFixed(digits);
}

// Ensure the parent directory exists for one output file.
function ensureParentDir(filePath) {
  const directory = path.dirname(filePath);
  if (directory && directory !== ".") {
    fs.mkdirSync(directory, { recursive: true });
  }
}

// Write one JSON payload with stable indentation.
function writeJsonFile(filePath, payload) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

// Build one markdown report for a continuous training run.
function buildMarkdownReport(report) {
  const cycles = Array.isArray(report.cycles) ? report.cycles : [];
  const lines = [
    "# Continuous Training Report",
    "",
    `- Started: \`${report.startedAt}\``,
    `- Finished: \`${report.finishedAt}\``,
    `- Status: \`${report.status}\``,
    `- Stop reason: \`${report.stopReason || "none"}\``,
    `- Requested cycles: \`${report.options.cycles}\``,
    `- Completed cycles: \`${report.completedCycles}\``,
    `- No-improve streak (final): \`${report.noImproveStreak}\``,
    `- Gate-fail streak (final): \`${report.gateFailStreak}\``,
    "",
    "## Options",
    "",
    `- fullEvery: \`${report.options.fullEvery}\``,
    `- highEvery: \`${report.options.highEvery}\``,
    `- gateEvery: \`${report.options.gateEvery}\``,
    `- maxNoImprove: \`${report.options.maxNoImprove}\``,
    `- maxGateFail: \`${report.options.maxGateFail}\``,
    `- improveThreshold: \`${fmtNumber(report.options.improveThreshold, 6)}\``,
    `- freshFirst: \`${report.options.freshFirst === true}\``,
    `- dryRun: \`${report.options.dryRun === true}\``,
    "",
    "## Cycles",
    "",
    "| Cycle | Train kind | Improved | Promoted | Delta | Paired LCB | Gate status |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];

  cycles.forEach((cycle) => {
    const canonical = cycle.canonical || {};
    const gate = cycle.gate || {};
    const gateStatus = gate.enabled ? (gate.status === 0 ? "pass" : `fail(${gate.status})`) : "skip";
    lines.push(
      `| ${cycle.index} | ${cycle.train.kind} | ${cycle.improved === true ? "yes" : "no"} `
      + `| ${canonical.promoted === true ? "yes" : "no"} `
      + `| ${fmtNumber(canonical.deltaScore)} | ${fmtNumber(canonical.pairedLcb)} | ${gateStatus} |`,
    );
  });

  lines.push("");
  return `${lines.join("\n")}\n`;
}

// Persist one continuous run report to debug JSON and markdown files.
function writeContinuousReport(rootDir, report) {
  const timestamp = Date.now();
  const baseName = `continuous_train_${timestamp}`;
  const debugDir = path.join(rootDir, "debug");
  const jsonPath = path.join(debugDir, `${baseName}.json`);
  const mdPath = path.join(debugDir, `${baseName}.md`);
  writeJsonFile(jsonPath, report);
  ensureParentDir(mdPath);
  fs.writeFileSync(mdPath, buildMarkdownReport(report), "utf8");
  return { jsonPath, mdPath };
}

// Run one full continuous training loop and return report + exit code.
function runContinuous(rootDir, options) {
  const npmCommand = getNpmCommand();
  const startedAt = new Date().toISOString();
  const cycles = [];
  let status = "completed";
  let stopReason = "";
  let noImproveStreak = 0;
  let gateFailStreak = 0;

  printStatus(
    "profile",
    `continuous cycles=${options.cycles} fullEvery=${options.fullEvery} highEvery=${options.highEvery} `
    + `gateEvery=${options.gateEvery}`,
    ANSI_CYAN,
  );
  printStatus(
    "guard",
    `maxNoImprove=${options.maxNoImprove} maxGateFail=${options.maxGateFail} `
    + `improveThreshold=${fmtNumber(options.improveThreshold, 6)}`,
    ANSI_CYAN,
  );

  for (let cycleIndex = 1; cycleIndex <= options.cycles; cycleIndex += 1) {
    const trainKind = selectTrainKind(cycleIndex, options);
    const includeFresh = options.freshFirst === true && cycleIndex === 1;
    const trainCommand = buildTrainCommand(trainKind, includeFresh);
    const gateEnabled = options.gateEvery > 0 && cycleIndex % options.gateEvery === 0;

    process.stdout.write("\n");
    printStatus(
      "cycle",
      `${tint(`${cycleIndex}/${options.cycles}`, ANSI_BOLD)} train=${trainCommand.kind}`
      + `${gateEnabled ? " gate=on" : " gate=off"}`,
      ANSI_BLUE,
    );

    const preEntries = listRunSummaryFiles(rootDir);
    const preSnapshot = new Set(preEntries.map((entry) => entry.path));
    const trainStatus = runCommand(npmCommand, trainCommand.args, {
      cwd: rootDir,
      dryRun: options.dryRun,
      tag: "train",
      tagColor: ANSI_YELLOW,
    });

    const cycleRecord = {
      index: cycleIndex,
      train: {
        kind: trainCommand.kind,
        script: trainCommand.scriptName,
        forwardedArgs: [...trainCommand.forwardedArgs],
        status: trainStatus,
      },
      canonical: null,
      improved: false,
      noImproveStreakAfter: noImproveStreak,
      gate: {
        enabled: gateEnabled,
        status: null,
        gateFailStreakAfter: gateFailStreak,
      },
    };

    if (trainStatus !== 0) {
      status = "training_failed";
      stopReason = `cycle ${cycleIndex} training failed with exit code ${trainStatus}`;
      cycles.push(cycleRecord);
      printStatus("error", stopReason, ANSI_RED);
      break;
    }

    if (!options.dryRun) {
      const postEntries = listRunSummaryFiles(rootDir);
      const summaryEntry = findNewestSummaryAfter(preSnapshot, postEntries);
      if (summaryEntry) {
        const summaryPayload = readJsonFileSafe(summaryEntry.path);
        const canonical = extractCanonicalMetrics(summaryPayload);
        cycleRecord.summaryPath = summaryEntry.path;
        cycleRecord.canonical = canonical;
        const deltaScore = canonical && Number.isFinite(canonical.deltaScore)
          ? canonical.deltaScore
          : null;
        const improved = Boolean(canonical && (
          canonical.promoted === true
          || (Number.isFinite(deltaScore) && deltaScore > options.improveThreshold)
        ));
        cycleRecord.improved = improved;
        if (improved) {
          noImproveStreak = 0;
        } else {
          noImproveStreak += 1;
        }
        cycleRecord.noImproveStreakAfter = noImproveStreak;
        printStatus(
          "report",
          `delta=${fmtNumber(deltaScore)} lcb=${fmtNumber(canonical && canonical.pairedLcb)} `
          + `promoted=${canonical && canonical.promoted === true ? "yes" : "no"} `
          + `improved=${improved ? "yes" : "no"} streak=${noImproveStreak}`,
          ANSI_CYAN,
        );
      } else {
        noImproveStreak += 1;
        cycleRecord.noImproveStreakAfter = noImproveStreak;
        printStatus(
          "warn",
          "missing run promotion summary after training command; counting as non-improving cycle",
          ANSI_YELLOW,
        );
      }
    }

    if (gateEnabled) {
      const gateArgs = ["run", "ai:validate:gate"];
      const gateStatus = runCommand(npmCommand, gateArgs, {
        cwd: rootDir,
        dryRun: options.dryRun,
        tag: "gate",
        tagColor: ANSI_GREEN,
      });
      cycleRecord.gate.status = gateStatus;
      if (options.dryRun) {
        printStatus("gate", "dry-run mode: gate command not executed", ANSI_CYAN);
      } else {
        if (gateStatus === 0) {
          gateFailStreak = 0;
        } else {
          gateFailStreak += 1;
        }
        if (gateStatus !== 0) {
          printStatus(
            "warn",
            `validation gate failed with exit code ${gateStatus} (streak=${gateFailStreak})`,
            ANSI_YELLOW,
          );
        } else {
          printStatus("gate", "validation gate passed", ANSI_GREEN);
        }
      }
      cycleRecord.gate.gateFailStreakAfter = gateFailStreak;
    }

    cycles.push(cycleRecord);

    if (!options.dryRun && options.maxNoImprove > 0 && noImproveStreak >= options.maxNoImprove) {
      status = "stopped_no_improve";
      stopReason = `reached max-no-improve=${options.maxNoImprove} at cycle ${cycleIndex}`;
      printStatus("stop", stopReason, ANSI_YELLOW);
      break;
    }
    if (!options.dryRun && options.maxGateFail > 0 && gateFailStreak >= options.maxGateFail) {
      status = "stopped_gate_fail";
      stopReason = `reached max-gate-fail=${options.maxGateFail} at cycle ${cycleIndex}`;
      printStatus("stop", stopReason, ANSI_RED);
      break;
    }
  }

  const finishedAt = new Date().toISOString();
  const report = {
    version: 1,
    status,
    stopReason,
    startedAt,
    finishedAt,
    options: {
      cycles: options.cycles,
      fullEvery: options.fullEvery,
      highEvery: options.highEvery,
      gateEvery: options.gateEvery,
      maxNoImprove: options.maxNoImprove,
      maxGateFail: options.maxGateFail,
      improveThreshold: options.improveThreshold,
      freshFirst: options.freshFirst,
      dryRun: options.dryRun,
    },
    completedCycles: cycles.length,
    noImproveStreak,
    gateFailStreak,
    cycles,
  };

  if (options.dryRun) {
    printStatus("report", "dry-run mode: report files were not written", ANSI_CYAN);
  } else {
    const reportPaths = writeContinuousReport(rootDir, report);
    printStatus("report", `json=${reportPaths.jsonPath}`, ANSI_CYAN);
    printStatus("report", `md=${reportPaths.mdPath}`, ANSI_CYAN);
  }
  if (!stopReason) {
    printStatus("done", `completed cycles=${cycles.length}/${options.cycles}`, ANSI_GREEN);
  }
  const exitCode = status === "training_failed" || status === "stopped_gate_fail" ? 1 : 0;
  return { report, exitCode };
}

// Entry point for continuous training orchestration.
function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    printHelp();
    process.exit(2);
  }

  if (options.help) {
    printHelp();
    return;
  }

  const rootDir = path.resolve(__dirname, "..");
  const { exitCode } = runContinuous(rootDir, options);
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

main();
