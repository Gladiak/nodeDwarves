#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const PYTHON_BOOTSTRAP = process.env.PYTHON || 'python3';
const VENV_PYTHON = process.platform === 'win32'
  ? path.join(ROOT, '.venv', 'Scripts', 'python.exe')
  : path.join(ROOT, '.venv', 'bin', 'python');
const DEFAULT_REPORT_JSON_PATH = path.join(ROOT, 'debug', 'extended_gate_runtime_optimized_latest.json');
const DEFAULT_REPORT_MD_PATH = path.join(ROOT, 'debug', 'extended_gate_runtime_optimized_latest.md');
const DEFAULT_BASELINE_SECONDS = 2728.58;

const STEPS = [
  {
    id: 'bootstrap',
    label: 'Python environment',
    command: PYTHON_BOOTSTRAP,
    args: ['python/bootstrap.py'],
    note: 'Ensures the project virtualenv and Python dependencies are ready.',
  },
  {
    id: 'canonical',
    label: 'Canonical master',
    command: VENV_PYTHON,
    args: [
      'python/promote_best.py',
      '--eval-only',
      '--model-path', 'models/policy_best.json',
      '--best-model-path', 'models/policy_best.json',
      '--eval-episodes', '20',
      '--eval-max-steps', '2200',
      '--eval-score', 'rpt',
      '--transport', 'compact',
      '--report-tag', 'canonical-master',
      '--report-json', 'debug/canonical_master_latest.json',
      '--report-md', 'debug/canonical_master_latest.md',
      '--eval-progress',
      '--eval-progress-every', '10',
    ],
    note: 'Fixed canonical contract (20x2200, rpt, compact).',
  },
  {
    id: 'benchmark',
    label: 'Deterministic benchmark',
    command: NODE,
    args: [
      'scripts/headless_benchmark.js',
      '--ticks', '8000',
      '--seeds', '101,202,303,404',
      '--progress',
      '--progress-every', '2000',
    ],
    note: 'Shared deterministic collapse and balance signal; executed once.',
  },
  {
    id: 'regression',
    label: 'Deterministic regression profiles',
    command: NODE,
    args: ['scripts/regression.js', '--all'],
    note: 'All stored deterministic regression profiles.',
  },
  {
    id: 'policy_shape',
    label: 'Policy shape guardrail',
    command: NODE,
    args: ['scripts/test_training_contracts.js', '--policy-only'],
    note: 'Observation-normalization policy shape contract.',
  },
  {
    id: 'horizon',
    label: 'Horizon profile',
    command: NODE,
    args: [
      'scripts/regression.js',
      '--profile', 'horizon',
      '--report-json', 'debug/regression_horizon_latest.json',
      '--report-md', 'debug/regression_horizon_latest.md',
    ],
    note: 'Multi-horizon deep/governance guardrails.',
  },
];

// Parse CLI options for reporting and baseline comparison.
function parseArgs(argv) {
  const options = {
    reportJsonPath: DEFAULT_REPORT_JSON_PATH,
    reportMarkdownPath: DEFAULT_REPORT_MD_PATH,
    baselineSeconds: DEFAULT_BASELINE_SECONDS,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--report-json') {
      options.reportJsonPath = resolveOutputPath(argv[i + 1], DEFAULT_REPORT_JSON_PATH);
      i += 1;
      continue;
    }
    if (arg === '--report-md') {
      options.reportMarkdownPath = resolveOutputPath(argv[i + 1], DEFAULT_REPORT_MD_PATH);
      i += 1;
      continue;
    }
    if (arg === '--baseline-seconds') {
      const parsed = Number(argv[i + 1]);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('--baseline-seconds must be a positive finite number.');
      }
      options.baselineSeconds = parsed;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

// Resolve an output path, relative to project root when needed.
function resolveOutputPath(rawPath, fallbackPath) {
  const value = String(rawPath || '').trim();
  if (!value) {
    return fallbackPath;
  }
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

// Ensure parent directory exists before writing a report.
function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

// Format seconds with a stable compact precision.
function formatSeconds(seconds) {
  return `${Number(seconds).toFixed(2)}s`;
}

// Execute one validation step and capture timing/exit metadata.
function runStep(step) {
  const startedAt = new Date();
  const startMs = Date.now();
  const result = spawnSync(step.command, step.args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  const durationSeconds = (Date.now() - startMs) / 1000;
  const exitCode = Number.isInteger(result.status) ? result.status : 1;
  return {
    id: step.id,
    label: step.label,
    note: step.note,
    command: [step.command, ...step.args].join(' '),
    startedAt: startedAt.toISOString(),
    durationSeconds,
    exitCode,
    ok: exitCode === 0,
  };
}

// Build markdown summary lines from runtime report payload.
function buildMarkdownReport(report) {
  const lines = [];
  lines.push('# Extended Gate Runtime (Optimized)');
  lines.push('');
  lines.push(`Generated: ${report.meta.generatedAt}`);
  lines.push(`All checks passed: ${report.meta.allOk}`);
  lines.push(`Baseline reference: ${formatSeconds(report.summary.baselineSeconds)}`);
  lines.push(`Current runtime: ${formatSeconds(report.summary.totalSeconds)}`);
  lines.push(`Delta: ${formatSeconds(report.summary.deltaSeconds)} (${report.summary.deltaPercent.toFixed(2)}%)`);
  lines.push('');
  lines.push('## Step timings');
  lines.push('');
  lines.push('| Step | Seconds | Share | Status |');
  lines.push('| --- | ---: | ---: | --- |');
  for (const step of report.steps) {
    lines.push(
      `| ${step.label} | ${step.durationSeconds.toFixed(2)} | ${(step.runtimeShare * 100).toFixed(2)}% | ${step.ok ? 'PASS' : 'FAIL'} |`,
    );
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- `npm run ai:validate` is the single full acceptance gate and executes the benchmark only once.');
  lines.push('- Use direct script CLIs for isolated diagnostics; package scripts intentionally expose only operational entrypoints.');
  return `${lines.join('\n')}\n`;
}

// Execute optimized extended validation flow and write runtime reports.
function main() {
  const options = parseArgs(process.argv.slice(2));
  const flowStartedAt = new Date();
  const flowStartMs = Date.now();

  const steps = [];
  let allOk = true;
  for (const step of STEPS) {
    process.stdout.write(`\n[oq64] step=${step.id} start (${step.label})\n`);
    const result = runStep(step);
    steps.push(result);
    process.stdout.write(`[oq64] step=${step.id} done status=${result.ok ? 'PASS' : 'FAIL'} duration=${formatSeconds(result.durationSeconds)}\n`);
    if (!result.ok) {
      allOk = false;
      break;
    }
  }

  const totalSeconds = (Date.now() - flowStartMs) / 1000;
  const baselineSeconds = Number(options.baselineSeconds);
  const deltaSeconds = totalSeconds - baselineSeconds;
  const deltaPercent = (deltaSeconds / baselineSeconds) * 100;
  const normalizedSteps = steps.map((step) => ({
    ...step,
    runtimeShare: totalSeconds > 0 ? step.durationSeconds / totalSeconds : 0,
  }));

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      flowStartedAt: flowStartedAt.toISOString(),
      allOk,
    },
    summary: {
      baselineSeconds,
      totalSeconds,
      deltaSeconds,
      deltaPercent,
    },
    steps: normalizedSteps,
  };

  ensureParentDir(options.reportJsonPath);
  ensureParentDir(options.reportMarkdownPath);
  fs.writeFileSync(options.reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(options.reportMarkdownPath, buildMarkdownReport(report));

  process.stdout.write(`\n[oq64] runtime report json: ${options.reportJsonPath}\n`);
  process.stdout.write(`[oq64] runtime report md: ${options.reportMarkdownPath}\n`);
  process.stdout.write(`[oq64] total=${formatSeconds(totalSeconds)} baseline=${formatSeconds(baselineSeconds)} delta=${formatSeconds(deltaSeconds)} (${deltaPercent.toFixed(2)}%)\n`);

  if (!allOk) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`[oq64] error: ${error.message}\n`);
  process.exitCode = 1;
}
