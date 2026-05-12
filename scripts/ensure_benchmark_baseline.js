#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_CONFIG_PATH = path.join(ROOT, 'config.json');
const DEFAULT_BASELINE_JSON_PATH = path.join(
  ROOT,
  'benchmark_cache',
  'headless_benchmark_baseline.json',
);
const DEFAULT_CANDIDATE_REPORT_PATH = path.join(ROOT, 'debug', 'headless_benchmark_candidate.json');
const DEFAULT_TICKS = 8000;
const DEFAULT_SEEDS = [101, 202, 303, 404];
const DEFAULT_RESOURCES = ['beer', 'food', 'water'];
const DEFAULT_WIDTH = 120;
const DEFAULT_HEIGHT = 40;
const DEFAULT_PROGRESS_EVERY = 2000;

// Print CLI usage and examples.
function printHelp() {
  const lines = [
    'Ensure a cached baseline report exists and matches the target benchmark profile.',
    '',
    'Usage:',
    '  node scripts/ensure_benchmark_baseline.js [options]',
    '',
    'Options:',
    `  --baseline-json <path>    Baseline cache JSON path (default: ${DEFAULT_BASELINE_JSON_PATH})`,
    '  --baseline-md <path>      Baseline cache Markdown path (default: derived from JSON path)',
    `  --candidate-report <path> Candidate report used to infer profile (default: ${DEFAULT_CANDIDATE_REPORT_PATH})`,
    `  --config <path>           Config path (default: ${DEFAULT_CONFIG_PATH})`,
    `  --ticks <n>               Tick count (default: ${DEFAULT_TICKS})`,
    `  --seeds <a,b,c>           Seeds list (default: ${DEFAULT_SEEDS.join(',')})`,
    `  --resources <a,b,c>       Resource ids (default: ${DEFAULT_RESOURCES.join(',')})`,
    `  --width <n>               Benchmark width (default: ${DEFAULT_WIDTH})`,
    `  --height <n>              Benchmark height (default: ${DEFAULT_HEIGHT})`,
    `  --progress-every <n>      Progress interval while refreshing baseline (default: ${DEFAULT_PROGRESS_EVERY})`,
    '  --force                   Force baseline regeneration',
    '  --help                    Show this help',
    '',
    'Notes:',
    '  - If candidate report exists, its meta profile is used as target unless overridden by explicit flags.',
    '  - Baseline is refreshed when missing or when ticks/seeds/resources/layout/config hash mismatch.',
    '',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

// Parse one comma-separated list argument.
function parseList(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// Parse one CSV seed list into finite integers.
function parseSeeds(rawValue) {
  return parseList(rawValue)
    .map((entry) => Number(entry))
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.floor(value));
}

// Parse a positive integer argument.
function parsePositiveInteger(rawValue, flag) {
  const value = Math.floor(Number(rawValue));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return value;
}

// Resolve one input path (or fallback).
function resolvePath(rawValue, fallback) {
  const value = String(rawValue || '').trim();
  const effective = value || fallback;
  return path.resolve(process.cwd(), effective);
}

// Derive baseline markdown path from baseline JSON path.
function deriveMarkdownPath(jsonPath) {
  if (jsonPath.endsWith('.json')) {
    return `${jsonPath.slice(0, -5)}.md`;
  }
  return `${jsonPath}.md`;
}

// Parse CLI options.
function parseArgs(argv) {
  const options = {
    baselineJsonPath: DEFAULT_BASELINE_JSON_PATH,
    baselineMarkdownPath: '',
    candidateReportPath: DEFAULT_CANDIDATE_REPORT_PATH,
    configPath: DEFAULT_CONFIG_PATH,
    ticks: null,
    seeds: null,
    resources: null,
    width: null,
    height: null,
    progressEvery: DEFAULT_PROGRESS_EVERY,
    force: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--baseline-json') {
      options.baselineJsonPath = resolvePath(argv[index + 1], options.baselineJsonPath);
      index += 1;
      continue;
    }
    if (arg === '--baseline-md') {
      options.baselineMarkdownPath = resolvePath(argv[index + 1], '');
      index += 1;
      continue;
    }
    if (arg === '--candidate-report') {
      options.candidateReportPath = resolvePath(argv[index + 1], options.candidateReportPath);
      index += 1;
      continue;
    }
    if (arg === '--config') {
      options.configPath = resolvePath(argv[index + 1], options.configPath);
      index += 1;
      continue;
    }
    if (arg === '--ticks') {
      options.ticks = parsePositiveInteger(argv[index + 1], '--ticks');
      index += 1;
      continue;
    }
    if (arg === '--seeds') {
      const parsedSeeds = parseSeeds(argv[index + 1]);
      if (parsedSeeds.length === 0) {
        throw new Error('--seeds requires at least one valid numeric seed.');
      }
      options.seeds = parsedSeeds;
      index += 1;
      continue;
    }
    if (arg === '--resources') {
      const parsedResources = parseList(argv[index + 1]);
      if (parsedResources.length === 0) {
        throw new Error('--resources requires at least one resource id.');
      }
      options.resources = parsedResources;
      index += 1;
      continue;
    }
    if (arg === '--width') {
      options.width = parsePositiveInteger(argv[index + 1], '--width');
      index += 1;
      continue;
    }
    if (arg === '--height') {
      options.height = parsePositiveInteger(argv[index + 1], '--height');
      index += 1;
      continue;
    }
    if (arg === '--progress-every') {
      options.progressEvery = parsePositiveInteger(argv[index + 1], '--progress-every');
      index += 1;
      continue;
    }
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.baselineMarkdownPath) {
    options.baselineMarkdownPath = deriveMarkdownPath(options.baselineJsonPath);
  }

  return options;
}

// Read one report JSON if it exists and has expected shape.
function loadReportIfPresent(reportPath) {
  if (!reportPath || !fs.existsSync(reportPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    return null;
  }
}

// Compute SHA-256 hash for one file payload.
function computeFileHash(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// Compare arrays using strict ordered equality.
function arraysEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

// Resolve target benchmark profile from defaults, candidate meta, and explicit options.
function resolveTargetProfile(options) {
  const target = {
    configPath: options.configPath,
    ticks: DEFAULT_TICKS,
    seeds: DEFAULT_SEEDS.slice(),
    resources: DEFAULT_RESOURCES.slice(),
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  };

  const candidateReport = loadReportIfPresent(options.candidateReportPath);
  const candidateMeta = candidateReport && candidateReport.meta && typeof candidateReport.meta === 'object'
    ? candidateReport.meta
    : null;
  if (candidateMeta) {
    const metaConfigPath = String(candidateMeta.configPath || '').trim();
    if (metaConfigPath) {
      const resolvedConfigPath = path.resolve(process.cwd(), metaConfigPath);
      if (fs.existsSync(resolvedConfigPath)) {
        target.configPath = resolvedConfigPath;
      }
    }
    if (Number.isFinite(Number(candidateMeta.ticks)) && Number(candidateMeta.ticks) > 0) {
      target.ticks = Math.floor(Number(candidateMeta.ticks));
    }
    if (Array.isArray(candidateMeta.seeds)) {
      const candidateSeeds = candidateMeta.seeds
        .map((entry) => Number(entry))
        .filter((value) => Number.isFinite(value))
        .map((value) => Math.floor(value));
      if (candidateSeeds.length > 0) {
        target.seeds = candidateSeeds;
      }
    }
    if (Array.isArray(candidateMeta.resources)) {
      const candidateResources = candidateMeta.resources
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
      if (candidateResources.length > 0) {
        target.resources = candidateResources;
      }
    }
    if (Number.isFinite(Number(candidateMeta.width)) && Number(candidateMeta.width) > 0) {
      target.width = Math.floor(Number(candidateMeta.width));
    }
    if (Number.isFinite(Number(candidateMeta.height)) && Number(candidateMeta.height) > 0) {
      target.height = Math.floor(Number(candidateMeta.height));
    }
  }

  if (options.ticks !== null) {
    target.ticks = options.ticks;
  }
  if (Array.isArray(options.seeds) && options.seeds.length > 0) {
    target.seeds = options.seeds.slice();
  }
  if (Array.isArray(options.resources) && options.resources.length > 0) {
    target.resources = options.resources.slice();
  }
  if (options.width !== null) {
    target.width = options.width;
  }
  if (options.height !== null) {
    target.height = options.height;
  }

  target.configPath = path.resolve(process.cwd(), target.configPath);
  if (!fs.existsSync(target.configPath)) {
    throw new Error(`Config file not found: ${target.configPath}`);
  }
  target.configHash = computeFileHash(target.configPath);
  return target;
}

// Build stale/mismatch reasons between target profile and cached baseline meta.
function collectRefreshReasons(target, baselineReport, forceRefresh) {
  const reasons = [];
  if (forceRefresh) {
    reasons.push('forced refresh requested');
  }
  if (!baselineReport) {
    reasons.push('baseline cache missing or unreadable');
    return reasons;
  }
  const meta = baselineReport.meta && typeof baselineReport.meta === 'object'
    ? baselineReport.meta
    : null;
  if (!meta) {
    reasons.push('baseline meta payload missing');
    return reasons;
  }

  const baselineTicks = Number(meta.ticks);
  if (!Number.isFinite(baselineTicks) || Math.floor(baselineTicks) !== target.ticks) {
    reasons.push(`ticks mismatch (cache=${meta.ticks} target=${target.ticks})`);
  }

  const baselineSeeds = Array.isArray(meta.seeds)
    ? meta.seeds.map((entry) => Math.floor(Number(entry))).filter((entry) => Number.isFinite(entry))
    : [];
  if (!arraysEqual(baselineSeeds, target.seeds)) {
    reasons.push(`seeds mismatch (cache=${baselineSeeds.join(',')} target=${target.seeds.join(',')})`);
  }

  const baselineResources = Array.isArray(meta.resources)
    ? meta.resources.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  if (!arraysEqual(baselineResources, target.resources)) {
    reasons.push(
      `resources mismatch (cache=${baselineResources.join(',')} target=${target.resources.join(',')})`,
    );
  }

  const baselineWidth = Number(meta.width);
  if (!Number.isFinite(baselineWidth) || Math.floor(baselineWidth) !== target.width) {
    reasons.push(`width mismatch (cache=${meta.width} target=${target.width})`);
  }

  const baselineHeight = Number(meta.height);
  if (!Number.isFinite(baselineHeight) || Math.floor(baselineHeight) !== target.height) {
    reasons.push(`height mismatch (cache=${meta.height} target=${target.height})`);
  }

  const baselineConfigHash = String(meta.configHash || '').trim();
  if (!baselineConfigHash) {
    reasons.push('config hash missing in baseline cache metadata');
  } else if (baselineConfigHash !== target.configHash) {
    reasons.push('config hash mismatch');
  }

  return reasons;
}

// Build benchmark CLI arguments for baseline refresh.
function buildRefreshArgs(options, target) {
  return [
    path.join('scripts', 'headless_benchmark.js'),
    '--config',
    target.configPath,
    '--ticks',
    String(target.ticks),
    '--seeds',
    target.seeds.join(','),
    '--resources',
    target.resources.join(','),
    '--width',
    String(target.width),
    '--height',
    String(target.height),
    '--variant',
    'baseline',
    '--output',
    'table',
    '--report-json',
    options.baselineJsonPath,
    '--report-md',
    options.baselineMarkdownPath,
    '--progress',
    '--progress-every',
    String(options.progressEvery),
  ];
}

// Refresh baseline cache by invoking the benchmark script.
function refreshBaseline(options, target, reasons) {
  if (reasons.length > 0) {
    process.stdout.write(`Refreshing baseline cache: ${reasons.join('; ')}\n`);
  } else {
    process.stdout.write('Refreshing baseline cache.\n');
  }
  const args = buildRefreshArgs(options, target);
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Baseline refresh failed with exit code ${result.status}.`);
  }
}

// Main CLI entrypoint.
function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const target = resolveTargetProfile(options);
  const baselineReport = loadReportIfPresent(options.baselineJsonPath);
  const reasons = collectRefreshReasons(target, baselineReport, options.force);
  if (reasons.length === 0) {
    process.stdout.write(`Baseline cache is up to date: ${options.baselineJsonPath}\n`);
    return;
  }
  refreshBaseline(options, target, reasons);
}

main();
