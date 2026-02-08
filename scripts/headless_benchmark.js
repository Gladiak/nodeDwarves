#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { buildRuntime } = require('../src/runtime');
const { createInitialState } = require('../src/state');
const { stepState } = require('../src/simulation');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_CONFIG_PATH = path.join(ROOT, 'config.json');
const DEFAULT_TICKS = 6000;
const DEFAULT_SEEDS = [101, 202, 303, 404];
const DEFAULT_RESOURCES = ['beer', 'food', 'water'];
const DEFAULT_VARIANT_LABEL = 'current';

// Print CLI usage and examples.
function printHelp() {
  const lines = [
    'NodeDwarves headless benchmark',
    '',
    'Usage:',
    '  node scripts/headless_benchmark.js [options]',
    '',
    'Options:',
    '  --config <path>           Config JSON path (default: config.json)',
    '  --ticks <n>               Tick count per seed (default: 6000)',
    '  --seeds <a,b,c>           Comma-separated seeds (default: 101,202,303,404)',
    '  --resources <a,b,c>       Resource ids printed in summary (default: beer,food,water)',
    '  --width <n>               Fixed benchmark width (default: 120)',
    '  --height <n>              Fixed benchmark height (default: 40)',
    '  --variant <label>         Start a variant block (repeatable)',
    '  --set <path=value>        Override for latest variant (repeatable)',
    "  --output <table|json|both> Output format (default: table)",
    '  --help                    Show this help',
    '',
    'Examples:',
    '  node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404',
    '  node scripts/headless_benchmark.js --ticks 8000 --variant baseline \\',
    '    --set structures.brewery.maxCount=3 \\',
    '    --set structures.brewery.outputPerTick.beer=1.15 \\',
    '    --variant tuned',
    '  node scripts/headless_benchmark.js --output both --resources beer,food,water,iron',
    '',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

// Parse CLI arguments into benchmark options.
function parseArgs(argv) {
  const options = {
    configPath: DEFAULT_CONFIG_PATH,
    ticks: DEFAULT_TICKS,
    seeds: DEFAULT_SEEDS.slice(),
    resources: DEFAULT_RESOURCES.slice(),
    width: 120,
    height: 40,
    output: 'table',
    variants: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--config') {
      options.configPath = resolvePath(argv[i + 1], options.configPath);
      i += 1;
      continue;
    }
    if (arg === '--ticks') {
      options.ticks = Math.max(1, Math.floor(Number(argv[i + 1] || options.ticks)));
      i += 1;
      continue;
    }
    if (arg === '--seeds') {
      options.seeds = parseSeeds(argv[i + 1], options.seeds);
      i += 1;
      continue;
    }
    if (arg === '--resources') {
      options.resources = parseResourceList(argv[i + 1], options.resources);
      i += 1;
      continue;
    }
    if (arg === '--width') {
      options.width = Math.max(20, Math.floor(Number(argv[i + 1] || options.width)));
      i += 1;
      continue;
    }
    if (arg === '--height') {
      options.height = Math.max(10, Math.floor(Number(argv[i + 1] || options.height)));
      i += 1;
      continue;
    }
    if (arg === '--variant') {
      const label = String(argv[i + 1] || '').trim();
      if (!label) {
        throw new Error('--variant requires a non-empty label.');
      }
      options.variants.push({ label, assignments: [] });
      i += 1;
      continue;
    }
    if (arg === '--set') {
      const assignment = parseAssignment(argv[i + 1]);
      if (!assignment) {
        throw new Error('--set requires path=value.');
      }
      if (options.variants.length === 0) {
        options.variants.push({ label: DEFAULT_VARIANT_LABEL, assignments: [] });
      }
      options.variants[options.variants.length - 1].assignments.push(assignment);
      i += 1;
      continue;
    }
    if (arg === '--output') {
      const output = String(argv[i + 1] || '').trim().toLowerCase();
      if (!['table', 'json', 'both'].includes(output)) {
        throw new Error('--output must be one of: table, json, both.');
      }
      options.output = output;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.variants.length) {
    options.variants.push({ label: DEFAULT_VARIANT_LABEL, assignments: [] });
  }

  return options;
}

// Resolve a possibly relative file path.
function resolvePath(rawPath, fallback) {
  if (!rawPath) {
    return fallback;
  }
  const trimmed = String(rawPath).trim();
  if (!trimmed) {
    return fallback;
  }
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
}

// Parse comma-separated seed list.
function parseSeeds(raw, fallback) {
  const values = String(raw || '')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter(Number.isFinite);
  return values.length ? values : fallback.slice();
}

// Parse comma-separated resource id list.
function parseResourceList(raw, fallback) {
  const values = String(raw || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return values.length ? values : fallback.slice();
}

// Parse one override assignment formatted as path=value.
function parseAssignment(raw) {
  const text = String(raw || '');
  const eqIndex = text.indexOf('=');
  if (eqIndex <= 0) {
    return null;
  }
  const pathText = text.slice(0, eqIndex).trim();
  const valueText = text.slice(eqIndex + 1).trim();
  if (!pathText) {
    return null;
  }
  return {
    path: pathText,
    value: parseValue(valueText),
  };
}

// Parse assignment values (number, boolean, JSON, or string).
function parseValue(raw) {
  const text = String(raw || '').trim();
  if (text.length === 0) {
    return '';
  }
  if (text === 'true') {
    return true;
  }
  if (text === 'false') {
    return false;
  }
  if (text === 'null') {
    return null;
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const numeric = Number(text);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  if (
    (text.startsWith('{') && text.endsWith('}')) ||
    (text.startsWith('[') && text.endsWith(']')) ||
    (text.startsWith('"') && text.endsWith('"'))
  ) {
    try {
      return JSON.parse(text);
    } catch (error) {
      return text;
    }
  }
  return text;
}

// Build a deterministic pseudo-random generator from a numeric seed.
function seededRandom(seed) {
  let t = Number(seed) >>> 0;
  return function random() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Execute a callback under deterministic Math.random state.
function withSeed(seed, callback) {
  const previousRandom = Math.random;
  Math.random = seededRandom(seed);
  try {
    return callback();
  } finally {
    Math.random = previousRandom;
  }
}

// Deep-clone plain JSON-compatible values.
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// Set a dot-path value in an object, creating missing objects.
function setByPath(target, pathText, value) {
  const keys = String(pathText || '')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!keys.length) {
    return;
  }
  let current = target;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (!current[key] || typeof current[key] !== 'object' || Array.isArray(current[key])) {
      current[key] = {};
    }
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
}

// Load base config JSON from disk.
function loadConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}

// Apply one variant's overrides to a cloned config.
function buildVariantConfig(baseConfig, variant) {
  const nextConfig = clone(baseConfig);
  for (const assignment of variant.assignments) {
    setByPath(nextConfig, assignment.path, assignment.value);
  }
  return nextConfig;
}

// Build fixed runtime layout for deterministic headless runs.
function buildFixedRuntime(config, width, height) {
  const display = { ...(config.display || {}) };
  display.autoSize = false;
  display.width = width;
  display.height = height;
  return buildRuntime(display, { columns: width, rows: height });
}

// Average a numeric selector over a list.
function average(list, selector) {
  if (!Array.isArray(list) || list.length === 0) {
    return 0;
  }
  let sum = 0;
  let count = 0;
  for (const item of list) {
    const value = Number(selector(item));
    if (!Number.isFinite(value)) {
      continue;
    }
    sum += value;
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

// Capture end-of-run metrics from simulation state.
function collectRow(state, resources, seed) {
  const dwarves = Array.isArray(state.dwarves) ? state.dwarves : [];
  const stockpile = state.stockpile || {};
  const resourceValues = {};
  for (const resourceId of resources) {
    resourceValues[resourceId] = Number(stockpile[resourceId] || 0);
  }
  return {
    seed,
    tick: Number(state.tick || 0),
    population: dwarves.length,
    morale: average(dwarves, (dwarf) => dwarf && dwarf.state && dwarf.state.morale),
    beerBoost: average(dwarves, (dwarf) => dwarf && dwarf.state && dwarf.state.moraleBoostBeer),
    hunger: average(dwarves, (dwarf) => dwarf && dwarf.needs && dwarf.needs.hunger),
    thirst: average(dwarves, (dwarf) => dwarf && dwarf.needs && dwarf.needs.thirst),
    resources: resourceValues,
  };
}

// Compute summary averages from per-seed rows.
function summarizeRows(rows, resources) {
  const resourceAverages = {};
  for (const resourceId of resources) {
    resourceAverages[resourceId] = average(rows, (row) => row.resources[resourceId]);
  }
  return {
    population: average(rows, (row) => row.population),
    morale: average(rows, (row) => row.morale),
    beerBoost: average(rows, (row) => row.beerBoost),
    hunger: average(rows, (row) => row.hunger),
    thirst: average(rows, (row) => row.thirst),
    resources: resourceAverages,
  };
}

// Run all seeds for one variant and return rows + summary.
function runVariant(baseConfig, options, variant) {
  const rows = [];
  for (const seed of options.seeds) {
    const row = withSeed(seed, () => {
      const variantConfig = buildVariantConfig(baseConfig, variant);
      variantConfig.display = variantConfig.display || {};
      variantConfig.display.terrain = variantConfig.display.terrain || {};
      variantConfig.display.terrain.seed = Number(seed);

      const runtime = buildFixedRuntime(variantConfig, options.width, options.height);
      const state = createInitialState(variantConfig, runtime);

      for (let index = 0; index < options.ticks; index += 1) {
        stepState(state, variantConfig, runtime, null);
      }

      return collectRow(state, options.resources, seed);
    });
    rows.push(row);
  }
  return {
    label: variant.label,
    assignments: variant.assignments,
    rows,
    summary: summarizeRows(rows, options.resources),
  };
}

// Format a number with fixed decimals for table output.
function formatNumber(value, decimals) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 'n/a';
  }
  return numeric.toFixed(decimals);
}

// Build one compact resource string for a row.
function formatResources(resourceMap, resources) {
  return resources
    .map((resourceId) => `${resourceId} ${formatNumber(resourceMap[resourceId], 1)}`)
    .join(', ');
}

// Build delta information against the first variant summary.
function buildDeltas(variantResults, resources) {
  if (!Array.isArray(variantResults) || variantResults.length <= 1) {
    return [];
  }
  const baseline = variantResults[0];
  return variantResults.slice(1).map((variant) => {
    const resourceDelta = {};
    for (const resourceId of resources) {
      resourceDelta[resourceId] =
        Number(variant.summary.resources[resourceId] || 0) -
        Number(baseline.summary.resources[resourceId] || 0);
    }
    return {
      baseline: baseline.label,
      variant: variant.label,
      population: Number(variant.summary.population || 0) - Number(baseline.summary.population || 0),
      morale: Number(variant.summary.morale || 0) - Number(baseline.summary.morale || 0),
      beerBoost: Number(variant.summary.beerBoost || 0) - Number(baseline.summary.beerBoost || 0),
      hunger: Number(variant.summary.hunger || 0) - Number(baseline.summary.hunger || 0),
      thirst: Number(variant.summary.thirst || 0) - Number(baseline.summary.thirst || 0),
      resources: resourceDelta,
    };
  });
}

// Print benchmark report in human-readable table form.
function printTable(report) {
  for (const variant of report.variants) {
    process.stdout.write(`=== ${variant.label} ===\n`);
    for (const row of variant.rows) {
      const line =
        `seed ${row.seed}: tick ${row.tick}, pop ${row.population}, ` +
        `morale ${formatNumber(row.morale, 4)}, beerBoost ${formatNumber(row.beerBoost, 4)}, ` +
        `hunger ${formatNumber(row.hunger, 4)}, thirst ${formatNumber(row.thirst, 4)}, ` +
        formatResources(row.resources, report.meta.resources);
      process.stdout.write(`${line}\n`);
    }
    const summaryLine =
      `avg: pop ${formatNumber(variant.summary.population, 1)}, ` +
      `morale ${formatNumber(variant.summary.morale, 4)}, ` +
      `beerBoost ${formatNumber(variant.summary.beerBoost, 4)}, ` +
      `hunger ${formatNumber(variant.summary.hunger, 4)}, ` +
      `thirst ${formatNumber(variant.summary.thirst, 4)}, ` +
      formatResources(variant.summary.resources, report.meta.resources);
    process.stdout.write(`${summaryLine}\n\n`);
  }

  for (const delta of report.deltas) {
    process.stdout.write(`=== delta ${delta.variant} - ${delta.baseline} ===\n`);
    process.stdout.write(`population ${formatNumber(delta.population, 1)}\n`);
    process.stdout.write(`morale ${formatNumber(delta.morale, 4)}\n`);
    process.stdout.write(`beerBoost ${formatNumber(delta.beerBoost, 4)}\n`);
    process.stdout.write(`hunger ${formatNumber(delta.hunger, 4)}\n`);
    process.stdout.write(`thirst ${formatNumber(delta.thirst, 4)}\n`);
    for (const resourceId of report.meta.resources) {
      process.stdout.write(`${resourceId} ${formatNumber(delta.resources[resourceId], 1)}\n`);
    }
    process.stdout.write('\n');
  }
}

// Print benchmark report as JSON.
function printJson(report) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

// Build report from CLI options and simulation runs.
function runBenchmark(options) {
  const baseConfig = loadConfig(options.configPath);
  const variants = options.variants.map((variant) => runVariant(baseConfig, options, variant));
  return {
    meta: {
      ticks: options.ticks,
      seeds: options.seeds,
      configPath: options.configPath,
      resources: options.resources,
      width: options.width,
      height: options.height,
      generatedAt: new Date().toISOString(),
    },
    variants,
    deltas: buildDeltas(variants, options.resources),
  };
}

// Main CLI entrypoint.
function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return;
    }
    const report = runBenchmark(options);
    if (options.output === 'table' || options.output === 'both') {
      printTable(report);
    }
    if (options.output === 'json' || options.output === 'both') {
      printJson(report);
    }
  } catch (error) {
    process.stderr.write(`headless_benchmark error: ${error.message}\n`);
    process.stderr.write('Use --help for usage.\n');
    process.exit(1);
  }
}

main();
