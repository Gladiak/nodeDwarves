'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_KEEP_RUNS = 3;
const DEFAULT_KEEP_CONTINUOUS_REPORTS = 3;
const DEFAULT_KEEP_REGRESSION_REPORTS = 3;

// Parse cleanup CLI flags and retention knobs.
function parseArgs(argv) {
  const args = {
    keepRuns: DEFAULT_KEEP_RUNS,
    keepContinuousReports: DEFAULT_KEEP_CONTINUOUS_REPORTS,
    keepRegressionReports: DEFAULT_KEEP_REGRESSION_REPORTS,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (token === '--keep-runs') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value)) {
        args.keepRuns = Math.max(0, Math.floor(value));
        i += 1;
      }
      continue;
    }
    if (token === '--keep-continuous-reports') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value)) {
        args.keepContinuousReports = Math.max(0, Math.floor(value));
        i += 1;
      }
      continue;
    }
    if (token === '--keep-regression-reports') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value)) {
        args.keepRegressionReports = Math.max(0, Math.floor(value));
        i += 1;
      }
      continue;
    }
  }

  return args;
}

// Identify transient one-off files safe to delete.
function isTransientFile(name) {
  const lower = name.toLowerCase();
  if (lower.includes('smoke')) {
    return true;
  }
  if (/^risk_r002_runtime_smoke_.*\.log$/i.test(name)) {
    return true;
  }
  return false;
}

// Identify transient per-seed regression workspaces safe to delete.
function isTransientDir(name) {
  return /^regression_eval_/i.test(name) || /^regression_random_/i.test(name);
}

// Read one debug path mtime for retention sorting.
function getRunInfo(debugDir, name) {
  const fullPath = path.join(debugDir, name);
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(fullPath).mtimeMs;
  } catch (_) {
    mtimeMs = 0;
  }
  return { name, fullPath, mtimeMs };
}

// Delete or preview removal for one target path.
function removePath(fullPath, dryRun) {
  if (dryRun) {
    console.log(`[dry-run] remove ${fullPath}`);
    return;
  }
  fs.rmSync(fullPath, { recursive: true, force: true });
  console.log(`removed ${fullPath}`);
}

// Collect timestamp-grouped top-level reports that should keep only the newest N groups.
function collectTimestampedFileGroups(entries, debugDir, pattern) {
  const groups = new Map();
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const match = String(entry.name || '').match(pattern);
    if (!match) {
      continue;
    }
    const groupId = String(match[1] || '').trim();
    if (!groupId) {
      continue;
    }
    if (!groups.has(groupId)) {
      groups.set(groupId, {
        id: groupId,
        sortValue: Number(groupId) || 0,
        paths: [],
      });
    }
    groups.get(groupId).paths.push(path.join(debugDir, entry.name));
  }
  return Array.from(groups.values()).sort((left, right) => {
    if (left.sortValue !== right.sortValue) {
      return right.sortValue - left.sortValue;
    }
    return right.id.localeCompare(left.id);
  });
}

// Resolve all cleanup targets for the requested retention policy.
function collectCleanupTargets(debugDir, args) {
  const entries = fs.readdirSync(debugDir, { withFileTypes: true });
  const runDirs = [];
  const targets = [];

  for (const entry of entries) {
    const name = entry.name;
    const fullPath = path.join(debugDir, name);

    if (entry.isDirectory()) {
      if (/^run_/i.test(name)) {
        runDirs.push(getRunInfo(debugDir, name));
      } else if (isTransientDir(name)) {
        targets.push(fullPath);
      }
      continue;
    }

    if (entry.isFile() && isTransientFile(name)) {
      targets.push(fullPath);
    }
  }

  const continuousReportGroups = collectTimestampedFileGroups(
    entries,
    debugDir,
    /^continuous_train_(\d+)\.(json|md)$/i,
  );
  const removableContinuousGroups = continuousReportGroups.slice(args.keepContinuousReports);
  for (const group of removableContinuousGroups) {
    targets.push(...group.paths);
  }

  const regressionReportGroups = collectTimestampedFileGroups(
    entries,
    debugDir,
    /^regression_report_(\d+)\.(txt|json|md)$/i,
  );
  const removableRegressionGroups = regressionReportGroups.slice(args.keepRegressionReports);
  for (const group of removableRegressionGroups) {
    targets.push(...group.paths);
  }

  runDirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const removableRuns = runDirs.slice(args.keepRuns);
  for (const run of removableRuns) {
    targets.push(run.fullPath);
  }

  return Array.from(new Set(targets));
}

// Execute one debug cleanup pass with the provided retention policy.
function runCleanup(options = {}) {
  const args = {
    ...parseArgs([]),
  };
  Object.entries(options || {}).forEach(([key, value]) => {
    if (value !== undefined) {
      args[key] = value;
    }
  });
  const rootDir = args.cwd ? path.resolve(args.cwd) : process.cwd();
  const debugDir = args.debugDir ? path.resolve(args.debugDir) : path.resolve(rootDir, 'debug');

  if (!fs.existsSync(debugDir) || !fs.statSync(debugDir).isDirectory()) {
    console.log('debug directory not found, nothing to clean');
    return { removed: 0, dryRun: args.dryRun === true };
  }

  const targets = collectCleanupTargets(debugDir, args);
  if (targets.length === 0) {
    console.log('debug cleanup: nothing to remove');
    return { removed: 0, dryRun: args.dryRun === true };
  }

  console.log(
    `debug cleanup: removing ${targets.length} path(s) `
    + `(keep-runs=${args.keepRuns}, keep-continuous-reports=${args.keepContinuousReports}, `
    + `keep-regression-reports=${args.keepRegressionReports}, dry-run=${args.dryRun})`,
  );

  for (const fullPath of targets) {
    removePath(fullPath, args.dryRun);
  }

  return { removed: targets.length, dryRun: args.dryRun === true };
}

// Run the cleanup CLI entrypoint.
function main() {
  runCleanup(parseArgs(process.argv.slice(2)));
}

if (require.main === module) {
  main();
}

module.exports = {
  collectCleanupTargets,
  parseArgs,
  runCleanup,
};
