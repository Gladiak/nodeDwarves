'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_KEEP_RUNS = 3;

function parseArgs(argv) {
  const args = {
    keepRuns: DEFAULT_KEEP_RUNS,
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
  }

  return args;
}

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

function isTransientDir(name) {
  return /^regression_eval_/i.test(name) || /^regression_random_/i.test(name);
}

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

function removePath(fullPath, dryRun) {
  if (dryRun) {
    console.log(`[dry-run] remove ${fullPath}`);
    return;
  }
  fs.rmSync(fullPath, { recursive: true, force: true });
  console.log(`removed ${fullPath}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const debugDir = path.resolve(process.cwd(), 'debug');

  if (!fs.existsSync(debugDir) || !fs.statSync(debugDir).isDirectory()) {
    console.log('debug directory not found, nothing to clean');
    return;
  }

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

  runDirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const removableRuns = runDirs.slice(args.keepRuns);
  for (const run of removableRuns) {
    targets.push(run.fullPath);
  }

  if (targets.length === 0) {
    console.log('debug cleanup: nothing to remove');
    return;
  }

  console.log(
    `debug cleanup: removing ${targets.length} path(s) (keep-runs=${args.keepRuns}, dry-run=${args.dryRun})`,
  );

  for (const fullPath of targets) {
    removePath(fullPath, args.dryRun);
  }
}

main();
