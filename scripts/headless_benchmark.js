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
const DEFAULT_PROGRESS_STEPS = 8;
const DEFAULT_GATE_THRESHOLDS = {
  minScore: -2,
  maxPopulationDrop: 0.08,
  maxMoraleDrop: 0.05,
  maxHungerRise: 0.1,
  maxThirstRise: 0.1,
  maxResourceDrop: 0.12,
};

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
    '  --gate                    Enable balance gate against the first variant (baseline)',
    '  --gate-min-score <n>      Minimum comparison score allowed (default: -2)',
    '  --gate-max-pop-drop <n>   Max relative population drop allowed (default: 0.08)',
    '  --gate-max-morale-drop <n> Max relative morale drop allowed (default: 0.05)',
    '  --gate-max-hunger-rise <n> Max relative hunger rise allowed (default: 0.10)',
    '  --gate-max-thirst-rise <n> Max relative thirst rise allowed (default: 0.10)',
    '  --gate-max-resource-drop <n> Max average relative resource drop allowed (default: 0.12)',
    '  --report-json <path>      Write report JSON to file',
    '  --report-md <path>        Write report Markdown to file',
    '  --progress                Print progress updates to stderr',
    '  --progress-every <n>      Progress update interval in ticks',
    '  --help                    Show this help',
    '',
    'Examples:',
    '  node scripts/headless_benchmark.js --ticks 8000 --seeds 101,202,303,404',
    '  node scripts/headless_benchmark.js --ticks 8000 --variant baseline \\',
    '    --set structures.brewery.maxCount=3 \\',
    '    --set structures.brewery.outputPerTick.beer=1.15 \\',
    '    --variant tuned',
    '  node scripts/headless_benchmark.js --ticks 8000 --variant baseline --variant candidate --gate',
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
    progress: false,
    progressEvery: null,
    gate: false,
    gateThresholds: { ...DEFAULT_GATE_THRESHOLDS },
    reportJsonPath: null,
    reportMarkdownPath: null,
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
    if (arg === '--gate') {
      options.gate = true;
      continue;
    }
    if (arg === '--gate-min-score') {
      options.gateThresholds.minScore = parseFiniteNumber(argv[i + 1], '--gate-min-score');
      i += 1;
      continue;
    }
    if (arg === '--gate-max-pop-drop') {
      options.gateThresholds.maxPopulationDrop = parseNonNegativeNumber(
        argv[i + 1],
        '--gate-max-pop-drop',
      );
      i += 1;
      continue;
    }
    if (arg === '--gate-max-morale-drop') {
      options.gateThresholds.maxMoraleDrop = parseNonNegativeNumber(
        argv[i + 1],
        '--gate-max-morale-drop',
      );
      i += 1;
      continue;
    }
    if (arg === '--gate-max-hunger-rise') {
      options.gateThresholds.maxHungerRise = parseNonNegativeNumber(
        argv[i + 1],
        '--gate-max-hunger-rise',
      );
      i += 1;
      continue;
    }
    if (arg === '--gate-max-thirst-rise') {
      options.gateThresholds.maxThirstRise = parseNonNegativeNumber(
        argv[i + 1],
        '--gate-max-thirst-rise',
      );
      i += 1;
      continue;
    }
    if (arg === '--gate-max-resource-drop') {
      options.gateThresholds.maxResourceDrop = parseNonNegativeNumber(
        argv[i + 1],
        '--gate-max-resource-drop',
      );
      i += 1;
      continue;
    }
    if (arg === '--report-json') {
      options.reportJsonPath = resolveOutputPath(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--report-md') {
      options.reportMarkdownPath = resolveOutputPath(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--progress') {
      options.progress = true;
      continue;
    }
    if (arg === '--progress-every') {
      const progressEvery = Math.max(1, Math.floor(Number(argv[i + 1] || 0)));
      if (!Number.isFinite(progressEvery) || progressEvery <= 0) {
        throw new Error('--progress-every must be a positive integer.');
      }
      options.progress = true;
      options.progressEvery = progressEvery;
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

// Parse a finite number for one CLI argument.
function parseFiniteNumber(rawValue, flag) {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${flag} requires a finite number.`);
  }
  return numeric;
}

// Parse a non-negative number for one CLI argument.
function parseNonNegativeNumber(rawValue, flag) {
  const numeric = parseFiniteNumber(rawValue, flag);
  if (numeric < 0) {
    throw new Error(`${flag} must be >= 0.`);
  }
  return numeric;
}

// Resolve tick interval used for progress updates.
function resolveProgressEvery(ticks, progressEvery) {
  const configured = Number(progressEvery);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(1, Math.floor(configured));
  }
  const steps = Math.max(1, Number(DEFAULT_PROGRESS_STEPS));
  return Math.max(1, Math.floor(Math.max(1, Number(ticks || 1)) / steps));
}

// Format elapsed milliseconds in seconds.
function formatElapsedMs(elapsedMs) {
  return `${(Math.max(0, Number(elapsedMs || 0)) / 1000).toFixed(1)}s`;
}

// Print one progress line to stderr when enabled.
function writeProgress(options, message) {
  if (!options || options.progress !== true) {
    return;
  }
  process.stderr.write(`[progress] ${message}\n`);
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

// Resolve an output path and require a non-empty value.
function resolveOutputPath(rawPath) {
  const trimmed = String(rawPath || '').trim();
  if (!trimmed) {
    throw new Error('Output path cannot be empty.');
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
  const totalSeeds = options.seeds.length;
  writeProgress(options, `variant=${variant.label} start seeds=${totalSeeds} ticks=${options.ticks}`);
  for (const seed of options.seeds) {
    const row = withSeed(seed, () => {
      const seedStartMs = Date.now();
      const variantConfig = buildVariantConfig(baseConfig, variant);
      variantConfig.display = variantConfig.display || {};
      variantConfig.display.terrain = variantConfig.display.terrain || {};
      variantConfig.display.terrain.seed = Number(seed);

      const runtime = buildFixedRuntime(variantConfig, options.width, options.height);
      const state = createInitialState(variantConfig, runtime);
      const progressEvery = resolveProgressEvery(options.ticks, options.progressEvery);
      let nextProgressTick = progressEvery;

      for (let index = 0; index < options.ticks; index += 1) {
        stepState(state, variantConfig, runtime, null);
        const tick = index + 1;
        if (options.progress === true && (tick >= nextProgressTick || tick === options.ticks)) {
          const elapsedMs = Date.now() - seedStartMs;
          const population = Array.isArray(state.dwarves) ? state.dwarves.length : 0;
          const etaMs = tick > 0
            ? Math.max(0, (elapsedMs / tick) * (options.ticks - tick))
            : 0;
          writeProgress(
            options,
            `variant=${variant.label} seed=${seed} tick=${tick}/${options.ticks} pop=${population} elapsed=${formatElapsedMs(elapsedMs)} eta=${formatElapsedMs(etaMs)}`,
          );
          while (nextProgressTick <= tick) {
            nextProgressTick += progressEvery;
          }
        }
      }

      const collected = collectRow(state, options.resources, seed);
      writeProgress(
        options,
        `variant=${variant.label} seed=${seed} done tick=${collected.tick} pop=${collected.population} elapsed=${formatElapsedMs(Date.now() - seedStartMs)}`,
      );
      return collected;
    });
    rows.push(row);
  }
  writeProgress(options, `variant=${variant.label} completed seeds=${totalSeeds}`);
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
  return buildSummaryComparisons(variantResults, resources).map((comparison) => {
    const resourceDelta = {};
    for (const resourceId of resources) {
      resourceDelta[resourceId] = Number(
        comparison.deltas.resources[resourceId]
        && comparison.deltas.resources[resourceId].abs || 0,
      );
    }
    return {
      baseline: comparison.baseline,
      variant: comparison.variant,
      population: Number(comparison.deltas.population.abs || 0),
      morale: Number(comparison.deltas.morale.abs || 0),
      beerBoost: Number(comparison.deltas.beerBoost.abs || 0),
      hunger: Number(comparison.deltas.hunger.abs || 0),
      thirst: Number(comparison.deltas.thirst.abs || 0),
      resources: resourceDelta,
    };
  });
}

// Format a signed fixed-decimal number with explicit +/- prefix.
function formatSignedNumber(value, decimals) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 'n/a';
  }
  const fixed = numeric.toFixed(decimals);
  return numeric >= 0 ? `+${fixed}` : fixed;
}

// Format a signed percentage from a relative delta.
function formatSignedPercent(value, decimals = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 'n/a';
  }
  const scaled = (numeric * 100).toFixed(decimals);
  return numeric >= 0 ? `+${scaled}%` : `${scaled}%`;
}

// Compute relative delta as (current - baseline) / abs(baseline).
function computeRelativeDelta(current, baseline) {
  const currentNumber = Number(current);
  const baselineNumber = Number(baseline);
  if (!Number.isFinite(currentNumber) || !Number.isFinite(baselineNumber)) {
    return null;
  }
  if (Math.abs(baselineNumber) <= 1e-9) {
    return Math.abs(currentNumber) <= 1e-9 ? 0 : null;
  }
  return (currentNumber - baselineNumber) / Math.abs(baselineNumber);
}

// Build one metric delta payload with absolute and relative changes.
function buildMetricDelta(current, baseline) {
  const currentNumber = Number(current);
  const baselineNumber = Number(baseline);
  if (!Number.isFinite(currentNumber) || !Number.isFinite(baselineNumber)) {
    return { abs: null, rel: null };
  }
  return {
    abs: currentNumber - baselineNumber,
    rel: computeRelativeDelta(currentNumber, baselineNumber),
  };
}

// Compute one comparative score versus baseline (higher is better).
function computeComparisonScore(metricDeltas, resourceAverageRel) {
  const populationRel = Number(metricDeltas.population && metricDeltas.population.rel);
  const moraleRel = Number(metricDeltas.morale && metricDeltas.morale.rel);
  const beerBoostRel = Number(metricDeltas.beerBoost && metricDeltas.beerBoost.rel);
  const hungerRel = Number(metricDeltas.hunger && metricDeltas.hunger.rel);
  const thirstRel = Number(metricDeltas.thirst && metricDeltas.thirst.rel);
  const resourceRel = Number(resourceAverageRel);
  const components = [
    Number.isFinite(populationRel) ? populationRel * 0.35 : 0,
    Number.isFinite(moraleRel) ? moraleRel * 0.2 : 0,
    Number.isFinite(beerBoostRel) ? beerBoostRel * 0.05 : 0,
    Number.isFinite(hungerRel) ? -hungerRel * 0.15 : 0,
    Number.isFinite(thirstRel) ? -thirstRel * 0.15 : 0,
    Number.isFinite(resourceRel) ? resourceRel * 0.1 : 0,
  ];
  return components.reduce((sum, value) => sum + value, 0) * 100;
}

// Build detailed summary comparisons against the first variant.
function buildSummaryComparisons(variantResults, resources) {
  if (!Array.isArray(variantResults) || variantResults.length <= 1) {
    return [];
  }
  const baseline = variantResults[0];
  return variantResults.slice(1).map((variant) => {
    const metricDeltas = {
      population: buildMetricDelta(variant.summary.population, baseline.summary.population),
      morale: buildMetricDelta(variant.summary.morale, baseline.summary.morale),
      beerBoost: buildMetricDelta(variant.summary.beerBoost, baseline.summary.beerBoost),
      hunger: buildMetricDelta(variant.summary.hunger, baseline.summary.hunger),
      thirst: buildMetricDelta(variant.summary.thirst, baseline.summary.thirst),
      resources: {},
    };
    const resourceRelValues = [];
    for (const resourceId of resources) {
      const delta = buildMetricDelta(
        variant.summary.resources[resourceId],
        baseline.summary.resources[resourceId],
      );
      metricDeltas.resources[resourceId] = delta;
      if (Number.isFinite(delta.rel)) {
        resourceRelValues.push(delta.rel);
      }
    }
    const resourceAverageRel = resourceRelValues.length > 0
      ? average(resourceRelValues, (value) => value)
      : 0;
    const score = computeComparisonScore(metricDeltas, resourceAverageRel);
    return {
      baseline: baseline.label,
      variant: variant.label,
      deltas: {
        ...metricDeltas,
        resourceAverageRel,
      },
      score,
    };
  });
}

// Build per-seed delta rows for each non-baseline variant.
function buildSeedDeltas(variantResults, resources) {
  if (!Array.isArray(variantResults) || variantResults.length <= 1) {
    return [];
  }
  const baseline = variantResults[0];
  const baselineRowsBySeed = new Map(
    baseline.rows.map((row) => [Number(row.seed), row]),
  );
  return variantResults.slice(1).map((variant) => {
    const rows = [];
    for (const row of variant.rows) {
      const seed = Number(row.seed);
      const baselineRow = baselineRowsBySeed.get(seed);
      if (!baselineRow) {
        continue;
      }
      const metricDeltas = {
        population: buildMetricDelta(row.population, baselineRow.population),
        morale: buildMetricDelta(row.morale, baselineRow.morale),
        beerBoost: buildMetricDelta(row.beerBoost, baselineRow.beerBoost),
        hunger: buildMetricDelta(row.hunger, baselineRow.hunger),
        thirst: buildMetricDelta(row.thirst, baselineRow.thirst),
        resources: {},
      };
      const resourceRelValues = [];
      for (const resourceId of resources) {
        const delta = buildMetricDelta(
          row.resources[resourceId],
          baselineRow.resources[resourceId],
        );
        metricDeltas.resources[resourceId] = delta;
        if (Number.isFinite(delta.rel)) {
          resourceRelValues.push(delta.rel);
        }
      }
      const resourceAverageRel = resourceRelValues.length > 0
        ? average(resourceRelValues, (value) => value)
        : 0;
      rows.push({
        seed,
        deltas: {
          ...metricDeltas,
          resourceAverageRel,
        },
        score: computeComparisonScore(metricDeltas, resourceAverageRel),
      });
    }
    return {
      baseline: baseline.label,
      variant: variant.label,
      rows,
    };
  });
}

// Evaluate gate checks for each candidate variant.
function evaluateGate(summaryComparisons, thresholds) {
  const gateThresholds = {
    ...DEFAULT_GATE_THRESHOLDS,
    ...(thresholds || {}),
  };
  const results = summaryComparisons.map((comparison) => {
    const deltas = comparison.deltas || {};
    const checks = [
      {
        key: 'population_drop',
        pass: !Number.isFinite(deltas.population && deltas.population.rel)
          || deltas.population.rel >= -gateThresholds.maxPopulationDrop,
        value: deltas.population && deltas.population.rel,
        comparator: '>=',
        limit: -gateThresholds.maxPopulationDrop,
      },
      {
        key: 'morale_drop',
        pass: !Number.isFinite(deltas.morale && deltas.morale.rel)
          || deltas.morale.rel >= -gateThresholds.maxMoraleDrop,
        value: deltas.morale && deltas.morale.rel,
        comparator: '>=',
        limit: -gateThresholds.maxMoraleDrop,
      },
      {
        key: 'hunger_rise',
        pass: !Number.isFinite(deltas.hunger && deltas.hunger.rel)
          || deltas.hunger.rel <= gateThresholds.maxHungerRise,
        value: deltas.hunger && deltas.hunger.rel,
        comparator: '<=',
        limit: gateThresholds.maxHungerRise,
      },
      {
        key: 'thirst_rise',
        pass: !Number.isFinite(deltas.thirst && deltas.thirst.rel)
          || deltas.thirst.rel <= gateThresholds.maxThirstRise,
        value: deltas.thirst && deltas.thirst.rel,
        comparator: '<=',
        limit: gateThresholds.maxThirstRise,
      },
      {
        key: 'resource_avg_drop',
        pass: !Number.isFinite(deltas.resourceAverageRel)
          || deltas.resourceAverageRel >= -gateThresholds.maxResourceDrop,
        value: deltas.resourceAverageRel,
        comparator: '>=',
        limit: -gateThresholds.maxResourceDrop,
      },
      {
        key: 'comparison_score',
        pass: !Number.isFinite(comparison.score)
          || comparison.score >= gateThresholds.minScore,
        value: comparison.score,
        comparator: '>=',
        limit: gateThresholds.minScore,
      },
    ];
    return {
      baseline: comparison.baseline,
      variant: comparison.variant,
      score: comparison.score,
      checks,
      passed: checks.every((check) => check.pass),
    };
  });
  const failed = results.filter((result) => result.passed !== true).map((result) => result.variant);
  return {
    enabled: true,
    thresholds: gateThresholds,
    results,
    failed,
    allPassed: failed.length === 0,
  };
}

// Build a compact Markdown report for CI artifacts.
function buildMarkdownReport(report) {
  const lines = [];
  lines.push('# NodeDwarves Balance Report');
  lines.push('');
  lines.push(`Generated: ${report.meta.generatedAt}`);
  lines.push(`Ticks: ${report.meta.ticks}`);
  lines.push(`Seeds: ${report.meta.seeds.join(', ')}`);
  lines.push(`Resources: ${report.meta.resources.join(', ')}`);
  lines.push('');
  lines.push('## Variant Summary');
  lines.push('');
  lines.push('| Variant | Population | Morale | BeerBoost | Hunger | Thirst |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const variant of report.variants) {
    lines.push(
      `| ${variant.label} | ${formatNumber(variant.summary.population, 2)} | ${formatNumber(variant.summary.morale, 4)} | ${formatNumber(variant.summary.beerBoost, 4)} | ${formatNumber(variant.summary.hunger, 4)} | ${formatNumber(variant.summary.thirst, 4)} |`,
    );
  }
  if (report.comparisons.length > 0) {
    lines.push('');
    lines.push('## Comparisons (vs baseline)');
    lines.push('');
    lines.push('| Variant | Score | Pop rel | Morale rel | Hunger rel | Thirst rel | Resource rel avg |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const comparison of report.comparisons) {
      lines.push(
        `| ${comparison.variant} | ${formatSignedNumber(comparison.score, 2)} | ${formatSignedPercent(comparison.deltas.population.rel)} | ${formatSignedPercent(comparison.deltas.morale.rel)} | ${formatSignedPercent(comparison.deltas.hunger.rel)} | ${formatSignedPercent(comparison.deltas.thirst.rel)} | ${formatSignedPercent(comparison.deltas.resourceAverageRel)} |`,
      );
    }
  }
  for (const block of report.seedDeltas) {
    lines.push('');
    lines.push(`## Seed Deltas: ${block.variant} vs ${block.baseline}`);
    lines.push('');
    lines.push('| Seed | Score | Pop rel | Morale rel | Hunger rel | Thirst rel | Resource rel avg |');
    lines.push('| ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const row of block.rows) {
      lines.push(
        `| ${row.seed} | ${formatSignedNumber(row.score, 2)} | ${formatSignedPercent(row.deltas.population.rel)} | ${formatSignedPercent(row.deltas.morale.rel)} | ${formatSignedPercent(row.deltas.hunger.rel)} | ${formatSignedPercent(row.deltas.thirst.rel)} | ${formatSignedPercent(row.deltas.resourceAverageRel)} |`,
      );
    }
  }
  if (report.gate && report.gate.enabled === true) {
    lines.push('');
    lines.push('## Gate');
    lines.push('');
    lines.push('| Variant | Status | Score | Failed checks |');
    lines.push('| --- | --- | ---: | --- |');
    for (const gateResult of report.gate.results) {
      const failedChecks = gateResult.checks
        .filter((check) => check.pass !== true)
        .map((check) => check.key)
        .join(', ') || '-';
      lines.push(
        `| ${gateResult.variant} | ${gateResult.passed ? 'PASS' : 'FAIL'} | ${formatSignedNumber(gateResult.score, 2)} | ${failedChecks} |`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

// Write a report file ensuring parent folders exist.
function writeReportFile(filePath, content) {
  const targetPath = resolveOutputPath(filePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
  return targetPath;
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

  for (const comparison of report.comparisons) {
    process.stdout.write(`=== comparison ${comparison.variant} - ${comparison.baseline} ===\n`);
    process.stdout.write(`score ${formatSignedNumber(comparison.score, 2)}\n`);
    process.stdout.write(
      `population ${formatSignedNumber(comparison.deltas.population.abs, 1)} (${formatSignedPercent(comparison.deltas.population.rel)})\n`,
    );
    process.stdout.write(
      `morale ${formatSignedNumber(comparison.deltas.morale.abs, 4)} (${formatSignedPercent(comparison.deltas.morale.rel)})\n`,
    );
    process.stdout.write(
      `beerBoost ${formatSignedNumber(comparison.deltas.beerBoost.abs, 4)} (${formatSignedPercent(comparison.deltas.beerBoost.rel)})\n`,
    );
    process.stdout.write(
      `hunger ${formatSignedNumber(comparison.deltas.hunger.abs, 4)} (${formatSignedPercent(comparison.deltas.hunger.rel)})\n`,
    );
    process.stdout.write(
      `thirst ${formatSignedNumber(comparison.deltas.thirst.abs, 4)} (${formatSignedPercent(comparison.deltas.thirst.rel)})\n`,
    );
    process.stdout.write(
      `resource_avg_rel ${formatSignedPercent(comparison.deltas.resourceAverageRel)}\n`,
    );
    for (const resourceId of report.meta.resources) {
      const delta = comparison.deltas.resources[resourceId] || {};
      process.stdout.write(
        `${resourceId} ${formatSignedNumber(delta.abs, 1)} (${formatSignedPercent(delta.rel)})\n`,
      );
    }
    process.stdout.write('\n');
  }

  for (const seedBlock of report.seedDeltas) {
    process.stdout.write(`=== seed deltas ${seedBlock.variant} - ${seedBlock.baseline} ===\n`);
    for (const row of seedBlock.rows) {
      const line =
        `seed ${row.seed}: score ${formatSignedNumber(row.score, 2)}, ` +
        `pop ${formatSignedPercent(row.deltas.population.rel)}, ` +
        `morale ${formatSignedPercent(row.deltas.morale.rel)}, ` +
        `hunger ${formatSignedPercent(row.deltas.hunger.rel)}, ` +
        `thirst ${formatSignedPercent(row.deltas.thirst.rel)}, ` +
        `resources ${formatSignedPercent(row.deltas.resourceAverageRel)}`;
      process.stdout.write(`${line}\n`);
    }
    process.stdout.write('\n');
  }

  if (report.gate && report.gate.enabled === true) {
    const thresholds = report.gate.thresholds || {};
    process.stdout.write('=== gate ===\n');
    process.stdout.write(
      `thresholds: minScore ${formatNumber(thresholds.minScore, 2)}, maxPopDrop ${formatNumber(thresholds.maxPopulationDrop, 3)}, maxMoraleDrop ${formatNumber(thresholds.maxMoraleDrop, 3)}, maxHungerRise ${formatNumber(thresholds.maxHungerRise, 3)}, maxThirstRise ${formatNumber(thresholds.maxThirstRise, 3)}, maxResourceDrop ${formatNumber(thresholds.maxResourceDrop, 3)}\n`,
    );
    for (const gateResult of report.gate.results) {
      const failed = gateResult.checks.filter((check) => check.pass !== true);
      const status = gateResult.passed ? 'PASS' : 'FAIL';
      const failedLabels = failed.map((check) => check.key).join(', ') || '-';
      process.stdout.write(
        `variant ${gateResult.variant}: ${status} | score ${formatSignedNumber(gateResult.score, 2)} | failed ${failedLabels}\n`,
      );
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
  const comparisons = buildSummaryComparisons(variants, options.resources);
  const seedDeltas = buildSeedDeltas(variants, options.resources);
  const gate = options.gate === true
    ? evaluateGate(comparisons, options.gateThresholds)
    : {
      enabled: false,
      thresholds: options.gateThresholds,
      results: [],
      failed: [],
      allPassed: true,
    };
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
    comparisons,
    seedDeltas,
    gate,
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
    if (options.reportJsonPath) {
      const reportPath = writeReportFile(
        options.reportJsonPath,
        `${JSON.stringify(report, null, 2)}\n`,
      );
      process.stdout.write(`Report JSON written to ${reportPath}\n`);
    }
    if (options.reportMarkdownPath) {
      const reportPath = writeReportFile(
        options.reportMarkdownPath,
        buildMarkdownReport(report),
      );
      process.stdout.write(`Report Markdown written to ${reportPath}\n`);
    }
    if (options.gate === true && report.gate && report.gate.allPassed !== true) {
      process.exit(1);
    }
  } catch (error) {
    process.stderr.write(`headless_benchmark error: ${error.message}\n`);
    process.stderr.write('Use --help for usage.\n');
    process.exit(1);
  }
}

main();
