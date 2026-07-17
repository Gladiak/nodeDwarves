#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { buildRuntime } = require('../src/runtime');
const { createInitialState } = require('../src/state');
const { stepState } = require('../src/simulation');
const {
  createStoryDirectorCounterTracker,
  getStoryDirectorCounterReport,
  summarizeStoryDirectorReports,
  trackStoryDirectorCounters,
} = require('../src/telemetry/story_director');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_CONFIG_PATH = path.join(ROOT, 'config.json');
const DEFAULT_TICKS = 6000;
const DEFAULT_SEEDS = [101, 202, 303, 404];
const DEFAULT_RESOURCES = ['beer', 'food', 'water'];
const DEFAULT_VARIANT_LABEL = 'current';
const DEFAULT_PROGRESS_STEPS = 8;
const BENCHMARK_REPORT_SCHEMA_VERSION = 2;
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

// Compute stable SHA-256 hash for one file payload.
function computeFileHash(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return crypto.createHash('sha256').update(raw).digest('hex');
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

// Clamp one numeric value into an inclusive range.
function clamp(value, low, high) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return low;
  }
  return Math.max(low, Math.min(high, numeric));
}

// Capture compact Underrealm combat/progression metrics from end-of-run state.
function collectUnderrealmMetrics(state) {
  const underrealm = state && state.underrealm;
  if (!underrealm || underrealm.enabled === false) {
    return {
      depth: 0,
      champions: 0,
      failedExpeditions: 0,
      blockedDispatches: 0,
      frontierContested: 0,
      readinessScore: 0,
      heroPromotions: 0,
      heroLosses: 0,
      heroActive: 0,
      heroSurvivals: 0,
    };
  }
  const maxDepth = Math.max(1, Math.floor(Number(underrealm.maxDepth || 0)));
  const maxUnlockedDepth = clamp(
    Math.floor(Number(underrealm.maxUnlockedDepth || 0)),
    0,
    maxDepth,
  );
  const combat = underrealm.combat && typeof underrealm.combat === 'object'
    ? underrealm.combat
    : {};
  const combatStats = combat.stats && typeof combat.stats === 'object'
    ? combat.stats
    : {};
  const floorsByDepth = combat.floorsByDepth && typeof combat.floorsByDepth === 'object'
    ? combat.floorsByDepth
    : {};
  const frontier = maxUnlockedDepth > 0 ? floorsByDepth[String(maxUnlockedDepth)] || null : null;
  const readinessGate = state && state.ruins && state.ruins.readinessGate
    && typeof state.ruins.readinessGate === 'object'
    ? state.ruins.readinessGate
    : {};
  const readinessScoreRaw = Math.max(0, Number(readinessGate.score || 0));
  const readinessTargetRaw = Math.max(
    0,
    Number(readinessGate.recommendedScore || readinessGate.minScore || 0),
  );
  const readinessScore = readinessTargetRaw > 0
    ? clamp(readinessScoreRaw / readinessTargetRaw, 0, 1)
    : 0;
  const dwarfChampion = combat.dwarfChampion && typeof combat.dwarfChampion === 'object'
    ? combat.dwarfChampion
    : {};
  const activeDwarfId = typeof dwarfChampion.activeDwarfId === 'string'
    ? dwarfChampion.activeDwarfId
    : '';
  const activeDwarf = activeDwarfId && Array.isArray(state && state.dwarves)
    ? state.dwarves.find((dwarf) => String(dwarf && dwarf.id || '') === activeDwarfId)
    : null;
  return {
    depth: maxUnlockedDepth,
    champions: Math.max(0, Number(combatStats.championsDefeated || 0)),
    failedExpeditions: Math.max(0, Number(combatStats.failedExpeditions || 0)),
    blockedDispatches: Math.max(0, Number(combatStats.blockedDispatches || 0)),
    frontierContested: frontier && frontier.state === 'contested' ? 1 : 0,
    readinessScore,
    heroPromotions: Math.max(0, Number(dwarfChampion.promotions || 0)),
    heroLosses: Math.max(0, Number(dwarfChampion.losses || 0)),
    heroActive: activeDwarfId ? 1 : 0,
    heroSurvivals: Math.max(0, Number(activeDwarf && activeDwarf.underrealmChampionSurvivals || 0)),
  };
}

// Increment one string-keyed counter map.
function incrementCounter(counterMap, keyRaw, amountRaw) {
  if (!counterMap || typeof counterMap !== 'object') {
    return;
  }
  const key = String(keyRaw || '').trim() || 'unknown';
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount === 0) {
    return;
  }
  counterMap[key] = Math.max(0, Number(counterMap[key] || 0) + amount);
}

// Merge all numeric entries from source counter map into target map.
function mergeCounterMaps(targetMap, sourceMap) {
  if (!targetMap || typeof targetMap !== 'object') {
    return;
  }
  if (!sourceMap || typeof sourceMap !== 'object') {
    return;
  }
  for (const [key, value] of Object.entries(sourceMap)) {
    incrementCounter(targetMap, key, Number(value || 0));
  }
}

// Sort one counter map by value desc and key asc for stable reports.
function sortCounterMap(counterMap) {
  const entries = Object.entries(counterMap || {})
    .map(([key, value]) => [String(key || '').trim() || 'unknown', Number(value || 0)])
    .filter((entry) => Number.isFinite(entry[1]) && entry[1] > 0);
  entries.sort((left, right) => {
    const delta = right[1] - left[1];
    if (delta !== 0) {
      return delta;
    }
    return left[0].localeCompare(right[0]);
  });
  const sorted = {};
  for (const [key, value] of entries) {
    sorted[key] = value;
  }
  return sorted;
}

// Build normalized share map from one counter map and total.
function buildCounterShareMap(counterMap, totalRaw) {
  const total = Math.max(0, Number(totalRaw || 0));
  const shares = {};
  for (const [key, valueRaw] of Object.entries(counterMap || {})) {
    const value = Math.max(0, Number(valueRaw || 0));
    shares[key] = total > 0 && Number.isFinite(value) ? value / total : 0;
  }
  return shares;
}

// Create per-seed schism decree tracker for tick-by-tick benchmark telemetry.
function createSchismDecreeTracker() {
  return {
    issued: 0,
    activeTicks: 0,
    byId: {},
    activeTicksById: {},
    lastIssuedCount: 0,
  };
}

// Collect schism decree telemetry from one simulation tick.
function trackSchismDecreeTick(state, tracker) {
  if (!tracker || typeof tracker !== 'object') {
    return;
  }
  const schism = state && state.schism && state.schism.enabled !== false ? state.schism : null;
  const decree = schism && schism.decree && typeof schism.decree === 'object'
    ? schism.decree
    : null;
  if (decree && decree.active === true) {
    const decreeId = String(decree.id || 'unknown');
    tracker.activeTicks = Math.max(0, Number(tracker.activeTicks || 0)) + 1;
    incrementCounter(tracker.activeTicksById, decreeId, 1);
  }

  const issuedCount = schism
    ? Math.max(0, Number(schism && schism.stats && schism.stats.councilDecrees || 0))
    : 0;
  const previousCount = Math.max(0, Number(tracker.lastIssuedCount || 0));

  if (issuedCount < previousCount) {
    tracker.lastIssuedCount = issuedCount;
    return;
  }
  if (issuedCount > previousCount) {
    const delta = issuedCount - previousCount;
    const decreeId = String(decree && decree.id || 'unknown');
    tracker.issued = Math.max(0, Number(tracker.issued || 0)) + delta;
    incrementCounter(tracker.byId, decreeId, delta);
  }
  tracker.lastIssuedCount = issuedCount;
}

// Capture end-of-run metrics from simulation state.
function collectRow(state, resources, seed, decreeTracker, storyTracker) {
  const dwarves = Array.isArray(state.dwarves) ? state.dwarves : [];
  const stockpile = state.stockpile || {};
  const underrealm = collectUnderrealmMetrics(state);
  const decree = decreeTracker && typeof decreeTracker === 'object'
    ? decreeTracker
    : createSchismDecreeTracker();
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
    underrealmDepth: underrealm.depth,
    underrealmChampions: underrealm.champions,
    underrealmFailedExpeditions: underrealm.failedExpeditions,
    underrealmBlockedDispatches: underrealm.blockedDispatches,
    underrealmFrontierContested: underrealm.frontierContested,
    underrealmReadinessScore: underrealm.readinessScore,
    underrealmHeroPromotions: underrealm.heroPromotions,
    underrealmHeroLosses: underrealm.heroLosses,
    underrealmHeroActive: underrealm.heroActive,
    underrealmHeroSurvivals: underrealm.heroSurvivals,
    schismDecreeIssued: Math.max(0, Number(decree.issued || 0)),
    schismDecreeActiveTicks: Math.max(0, Number(decree.activeTicks || 0)),
    schismDecreeById: sortCounterMap(decree.byId),
    schismDecreeActiveTicksById: sortCounterMap(decree.activeTicksById),
    storyDirector: getStoryDirectorCounterReport(storyTracker),
    resources: resourceValues,
  };
}

// Compute summary averages from per-seed rows.
function summarizeRows(rows, resources) {
  const resourceAverages = {};
  const decreeByIdTotals = {};
  const decreeActiveTicksByIdTotals = {};
  let decreeIssuedTotal = 0;
  let decreeActiveTicksTotal = 0;
  for (const resourceId of resources) {
    resourceAverages[resourceId] = average(rows, (row) => row.resources[resourceId]);
  }
  for (const row of rows) {
    decreeIssuedTotal += Math.max(0, Number(row && row.schismDecreeIssued || 0));
    decreeActiveTicksTotal += Math.max(0, Number(row && row.schismDecreeActiveTicks || 0));
    mergeCounterMaps(decreeByIdTotals, row && row.schismDecreeById);
    mergeCounterMaps(decreeActiveTicksByIdTotals, row && row.schismDecreeActiveTicksById);
  }

  const decreeById = sortCounterMap(decreeByIdTotals);
  const decreeActiveTicksById = sortCounterMap(decreeActiveTicksByIdTotals);
  const storyDirector = summarizeStoryDirectorReports(
    rows.map((row) => row && row.storyDirector),
  );
  return {
    population: average(rows, (row) => row.population),
    morale: average(rows, (row) => row.morale),
    beerBoost: average(rows, (row) => row.beerBoost),
    hunger: average(rows, (row) => row.hunger),
    thirst: average(rows, (row) => row.thirst),
    underrealmDepth: average(rows, (row) => row.underrealmDepth),
    underrealmChampions: average(rows, (row) => row.underrealmChampions),
    underrealmFailedExpeditions: average(rows, (row) => row.underrealmFailedExpeditions),
    underrealmBlockedDispatches: average(rows, (row) => row.underrealmBlockedDispatches),
    underrealmFrontierContested: average(rows, (row) => row.underrealmFrontierContested),
    underrealmReadinessScore: average(rows, (row) => row.underrealmReadinessScore),
    underrealmHeroPromotions: average(rows, (row) => row.underrealmHeroPromotions),
    underrealmHeroLosses: average(rows, (row) => row.underrealmHeroLosses),
    underrealmHeroActive: average(rows, (row) => row.underrealmHeroActive),
    underrealmHeroSurvivals: average(rows, (row) => row.underrealmHeroSurvivals),
    schismDecrees: {
      issuedTotal: decreeIssuedTotal,
      issuedPerSeedAvg: average(rows, (row) => row.schismDecreeIssued),
      activeTicksTotal: decreeActiveTicksTotal,
      activeTicksPerSeedAvg: average(rows, (row) => row.schismDecreeActiveTicks),
      byId: decreeById,
      byIdShare: buildCounterShareMap(decreeById, decreeIssuedTotal),
      activeTicksById: decreeActiveTicksById,
      activeTicksByIdShare: buildCounterShareMap(decreeActiveTicksById, decreeActiveTicksTotal),
    },
    storyDirector,
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
      const decreeTracker = createSchismDecreeTracker();
      const storyTracker = createStoryDirectorCounterTracker();
      const progressEvery = resolveProgressEvery(options.ticks, options.progressEvery);
      let nextProgressTick = progressEvery;

      for (let index = 0; index < options.ticks; index += 1) {
        stepState(state, variantConfig, runtime, null);
        trackSchismDecreeTick(state, decreeTracker);
        trackStoryDirectorCounters(state, storyTracker);
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

      const collected = collectRow(
        state,
        options.resources,
        seed,
        decreeTracker,
        storyTracker,
      );
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
      underrealmDepth: Number(comparison.deltas.underrealmDepth.abs || 0),
      underrealmChampions: Number(comparison.deltas.underrealmChampions.abs || 0),
      underrealmFailedExpeditions: Number(
        comparison.deltas.underrealmFailedExpeditions.abs || 0,
      ),
      underrealmBlockedDispatches: Number(
        comparison.deltas.underrealmBlockedDispatches.abs || 0,
      ),
      underrealmFrontierContested: Number(
        comparison.deltas.underrealmFrontierContested.abs || 0,
      ),
      underrealmReadinessScore: Number(comparison.deltas.underrealmReadinessScore.abs || 0),
      underrealmHeroPromotions: Number(comparison.deltas.underrealmHeroPromotions.abs || 0),
      underrealmHeroLosses: Number(comparison.deltas.underrealmHeroLosses.abs || 0),
      underrealmHeroActive: Number(comparison.deltas.underrealmHeroActive.abs || 0),
      underrealmHeroSurvivals: Number(comparison.deltas.underrealmHeroSurvivals.abs || 0),
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

// Format one unsigned percentage from a [0,1] ratio.
function formatPercent(value, decimals = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 'n/a';
  }
  return `${(numeric * 100).toFixed(decimals)}%`;
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
      underrealmDepth: buildMetricDelta(
        variant.summary.underrealmDepth,
        baseline.summary.underrealmDepth,
      ),
      underrealmChampions: buildMetricDelta(
        variant.summary.underrealmChampions,
        baseline.summary.underrealmChampions,
      ),
      underrealmFailedExpeditions: buildMetricDelta(
        variant.summary.underrealmFailedExpeditions,
        baseline.summary.underrealmFailedExpeditions,
      ),
      underrealmBlockedDispatches: buildMetricDelta(
        variant.summary.underrealmBlockedDispatches,
        baseline.summary.underrealmBlockedDispatches,
      ),
      underrealmFrontierContested: buildMetricDelta(
        variant.summary.underrealmFrontierContested,
        baseline.summary.underrealmFrontierContested,
      ),
      underrealmReadinessScore: buildMetricDelta(
        variant.summary.underrealmReadinessScore,
        baseline.summary.underrealmReadinessScore,
      ),
      underrealmHeroPromotions: buildMetricDelta(
        variant.summary.underrealmHeroPromotions,
        baseline.summary.underrealmHeroPromotions,
      ),
      underrealmHeroLosses: buildMetricDelta(
        variant.summary.underrealmHeroLosses,
        baseline.summary.underrealmHeroLosses,
      ),
      underrealmHeroActive: buildMetricDelta(
        variant.summary.underrealmHeroActive,
        baseline.summary.underrealmHeroActive,
      ),
      underrealmHeroSurvivals: buildMetricDelta(
        variant.summary.underrealmHeroSurvivals,
        baseline.summary.underrealmHeroSurvivals,
      ),
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
        underrealmDepth: buildMetricDelta(
          row.underrealmDepth,
          baselineRow.underrealmDepth,
        ),
        underrealmChampions: buildMetricDelta(
          row.underrealmChampions,
          baselineRow.underrealmChampions,
        ),
        underrealmFailedExpeditions: buildMetricDelta(
          row.underrealmFailedExpeditions,
          baselineRow.underrealmFailedExpeditions,
        ),
        underrealmBlockedDispatches: buildMetricDelta(
          row.underrealmBlockedDispatches,
          baselineRow.underrealmBlockedDispatches,
        ),
        underrealmFrontierContested: buildMetricDelta(
          row.underrealmFrontierContested,
          baselineRow.underrealmFrontierContested,
        ),
        underrealmReadinessScore: buildMetricDelta(
          row.underrealmReadinessScore,
          baselineRow.underrealmReadinessScore,
        ),
        underrealmHeroPromotions: buildMetricDelta(
          row.underrealmHeroPromotions,
          baselineRow.underrealmHeroPromotions,
        ),
        underrealmHeroLosses: buildMetricDelta(
          row.underrealmHeroLosses,
          baselineRow.underrealmHeroLosses,
        ),
        underrealmHeroActive: buildMetricDelta(
          row.underrealmHeroActive,
          baselineRow.underrealmHeroActive,
        ),
        underrealmHeroSurvivals: buildMetricDelta(
          row.underrealmHeroSurvivals,
          baselineRow.underrealmHeroSurvivals,
        ),
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
  lines.push('');
  lines.push('## Underrealm Summary');
  lines.push('');
  lines.push('| Variant | Depth | Champions | Failed Expeditions | Blocked Dispatches | Frontier Contested | Readiness Score | Hero Prom | Hero Loss | Hero Active | Hero Surv |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const variant of report.variants) {
    lines.push(
      `| ${variant.label} | ${formatNumber(variant.summary.underrealmDepth, 2)} | ${formatNumber(variant.summary.underrealmChampions, 2)} | ${formatNumber(variant.summary.underrealmFailedExpeditions, 2)} | ${formatNumber(variant.summary.underrealmBlockedDispatches, 2)} | ${formatNumber(variant.summary.underrealmFrontierContested, 2)} | ${formatNumber(variant.summary.underrealmReadinessScore, 3)} | ${formatNumber(variant.summary.underrealmHeroPromotions, 2)} | ${formatNumber(variant.summary.underrealmHeroLosses, 2)} | ${formatNumber(variant.summary.underrealmHeroActive, 2)} | ${formatNumber(variant.summary.underrealmHeroSurvivals, 2)} |`,
    );
  }
  lines.push('');
  lines.push('## Story Director Summary');
  lines.push('');
  lines.push('| Variant | Considered | Selected | Suppressed | Preempted | Focus coverage | Critical focus | Legendary focus | Priority context | Sagas opened | Resolved | Failed | Archived | Resolution rate |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const variant of report.variants) {
    const story = variant && variant.summary && variant.summary.storyDirector || {};
    lines.push(
      `| ${variant.label} | ${formatNumber(story.considered, 0)} | ${formatNumber(story.selected, 0)} | ${formatNumber(story.suppressed, 0)} | ${formatNumber(story.preempted, 0)} | ${formatPercent(story.focusCoverage, 1)} | ${formatPercent(story.criticalFocusCoverage, 1)} | ${formatPercent(story.legendaryFocusCoverage, 1)} | ${formatPercent(story.priorityContextCoverage, 1)} | ${formatNumber(story.sagasOpened, 0)} | ${formatNumber(story.sagasResolved, 0)} | ${formatNumber(story.sagasFailed, 0)} | ${formatNumber(story.sagasArchived, 0)} | ${formatPercent(story.sagaResolutionRate, 1)} |`,
    );
  }
  const hasSchismDecreeTelemetry = report.variants.some((variant) => {
    const decrees = variant
      && variant.summary
      && variant.summary.schismDecrees
      && typeof variant.summary.schismDecrees === 'object'
      ? variant.summary.schismDecrees
      : null;
    return decrees && Number(decrees.issuedTotal || 0) > 0;
  });
  if (hasSchismDecreeTelemetry) {
    lines.push('');
    lines.push('## Schism Decree Usage');
    lines.push('');
    lines.push('| Variant | Issued total | Issued / seed | Active ticks total | Active ticks / seed |');
    lines.push('| --- | ---: | ---: | ---: | ---: |');
    for (const variant of report.variants) {
      const decrees = variant
        && variant.summary
        && variant.summary.schismDecrees
        && typeof variant.summary.schismDecrees === 'object'
        ? variant.summary.schismDecrees
        : {};
      lines.push(
        `| ${variant.label} | ${formatNumber(decrees.issuedTotal, 0)} | ${formatNumber(decrees.issuedPerSeedAvg, 2)} | ${formatNumber(decrees.activeTicksTotal, 0)} | ${formatNumber(decrees.activeTicksPerSeedAvg, 2)} |`,
      );
    }
    for (const variant of report.variants) {
      const decrees = variant
        && variant.summary
        && variant.summary.schismDecrees
        && typeof variant.summary.schismDecrees === 'object'
        ? variant.summary.schismDecrees
        : {};
      const decreeIds = Object.keys(decrees.byId || {});
      if (!decreeIds.length) {
        continue;
      }
      lines.push('');
      lines.push(`### Schism Decrees (${variant.label})`);
      lines.push('');
      lines.push('| Decree | Issued | Issued share | Active ticks | Active share |');
      lines.push('| --- | ---: | ---: | ---: | ---: |');
      for (const decreeId of decreeIds) {
        const issued = Number(decrees.byId && decrees.byId[decreeId] || 0);
        const issuedShare = Number(decrees.byIdShare && decrees.byIdShare[decreeId] || 0);
        const activeTicks = Number(
          decrees.activeTicksById && decrees.activeTicksById[decreeId] || 0,
        );
        const activeShare = Number(
          decrees.activeTicksByIdShare && decrees.activeTicksByIdShare[decreeId] || 0,
        );
        lines.push(
          `| ${decreeId} | ${formatNumber(issued, 0)} | ${formatPercent(issuedShare, 1)} | ${formatNumber(activeTicks, 0)} | ${formatPercent(activeShare, 1)} |`,
        );
      }
    }
  }
  if (report.comparisons.length > 0) {
    lines.push('');
    lines.push('## Comparisons (vs baseline)');
    lines.push('');
    lines.push('| Variant | Score | Pop rel | Morale rel | Hunger rel | Thirst rel | Depth rel | Champions rel | Blocked rel | Readiness rel | HeroProm rel | HeroLoss rel | HeroActive rel | HeroSurv rel | Resource rel avg |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const comparison of report.comparisons) {
      lines.push(
        `| ${comparison.variant} | ${formatSignedNumber(comparison.score, 2)} | ${formatSignedPercent(comparison.deltas.population.rel)} | ${formatSignedPercent(comparison.deltas.morale.rel)} | ${formatSignedPercent(comparison.deltas.hunger.rel)} | ${formatSignedPercent(comparison.deltas.thirst.rel)} | ${formatSignedPercent(comparison.deltas.underrealmDepth.rel)} | ${formatSignedPercent(comparison.deltas.underrealmChampions.rel)} | ${formatSignedPercent(comparison.deltas.underrealmBlockedDispatches.rel)} | ${formatSignedPercent(comparison.deltas.underrealmReadinessScore.rel)} | ${formatSignedPercent(comparison.deltas.underrealmHeroPromotions.rel)} | ${formatSignedPercent(comparison.deltas.underrealmHeroLosses.rel)} | ${formatSignedPercent(comparison.deltas.underrealmHeroActive.rel)} | ${formatSignedPercent(comparison.deltas.underrealmHeroSurvivals.rel)} | ${formatSignedPercent(comparison.deltas.resourceAverageRel)} |`,
      );
    }
  }
  for (const block of report.seedDeltas) {
    lines.push('');
    lines.push(`## Seed Deltas: ${block.variant} vs ${block.baseline}`);
    lines.push('');
    lines.push('| Seed | Score | Pop rel | Morale rel | Hunger rel | Thirst rel | Depth rel | Champions rel | Readiness rel | HeroProm rel | HeroLoss rel | HeroActive rel | HeroSurv rel | Resource rel avg |');
    lines.push('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const row of block.rows) {
      lines.push(
        `| ${row.seed} | ${formatSignedNumber(row.score, 2)} | ${formatSignedPercent(row.deltas.population.rel)} | ${formatSignedPercent(row.deltas.morale.rel)} | ${formatSignedPercent(row.deltas.hunger.rel)} | ${formatSignedPercent(row.deltas.thirst.rel)} | ${formatSignedPercent(row.deltas.underrealmDepth.rel)} | ${formatSignedPercent(row.deltas.underrealmChampions.rel)} | ${formatSignedPercent(row.deltas.underrealmReadinessScore.rel)} | ${formatSignedPercent(row.deltas.underrealmHeroPromotions.rel)} | ${formatSignedPercent(row.deltas.underrealmHeroLosses.rel)} | ${formatSignedPercent(row.deltas.underrealmHeroActive.rel)} | ${formatSignedPercent(row.deltas.underrealmHeroSurvivals.rel)} | ${formatSignedPercent(row.deltas.resourceAverageRel)} |`,
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
        `underDepth ${formatNumber(row.underrealmDepth, 2)}, underChamp ${formatNumber(row.underrealmChampions, 2)}, ` +
        `underFail ${formatNumber(row.underrealmFailedExpeditions, 2)}, underBlocked ${formatNumber(row.underrealmBlockedDispatches, 2)}, ` +
        `underContested ${formatNumber(row.underrealmFrontierContested, 2)}, underReady ${formatNumber(row.underrealmReadinessScore, 3)}, ` +
        `underHeroProm ${formatNumber(row.underrealmHeroPromotions, 2)}, underHeroLoss ${formatNumber(row.underrealmHeroLosses, 2)}, ` +
        `underHeroAct ${formatNumber(row.underrealmHeroActive, 2)}, underHeroSurv ${formatNumber(row.underrealmHeroSurvivals, 2)}, ` +
        formatResources(row.resources, report.meta.resources);
      process.stdout.write(`${line}\n`);
    }
    const summaryLine =
      `avg: pop ${formatNumber(variant.summary.population, 1)}, ` +
      `morale ${formatNumber(variant.summary.morale, 4)}, ` +
      `beerBoost ${formatNumber(variant.summary.beerBoost, 4)}, ` +
      `hunger ${formatNumber(variant.summary.hunger, 4)}, ` +
      `thirst ${formatNumber(variant.summary.thirst, 4)}, ` +
      `underDepth ${formatNumber(variant.summary.underrealmDepth, 2)}, ` +
      `underChamp ${formatNumber(variant.summary.underrealmChampions, 2)}, ` +
      `underFail ${formatNumber(variant.summary.underrealmFailedExpeditions, 2)}, ` +
      `underBlocked ${formatNumber(variant.summary.underrealmBlockedDispatches, 2)}, ` +
      `underContested ${formatNumber(variant.summary.underrealmFrontierContested, 2)}, ` +
      `underReady ${formatNumber(variant.summary.underrealmReadinessScore, 3)}, ` +
      `underHeroProm ${formatNumber(variant.summary.underrealmHeroPromotions, 2)}, ` +
      `underHeroLoss ${formatNumber(variant.summary.underrealmHeroLosses, 2)}, ` +
      `underHeroAct ${formatNumber(variant.summary.underrealmHeroActive, 2)}, ` +
      `underHeroSurv ${formatNumber(variant.summary.underrealmHeroSurvivals, 2)}, ` +
      formatResources(variant.summary.resources, report.meta.resources);
    process.stdout.write(`${summaryLine}\n`);

    const story = variant && variant.summary && variant.summary.storyDirector || {};
    process.stdout.write(
      `story: selected ${formatNumber(story.selected, 0)}/${formatNumber(story.considered, 0)} (${formatPercent(story.focusCoverage, 1)}), suppressed ${formatNumber(story.suppressed, 0)}, preempted ${formatNumber(story.preempted, 0)}, critical ${formatNumber(story.criticalSelected, 0)}/${formatNumber(story.criticalConsidered, 0)} (${formatPercent(story.criticalFocusCoverage, 1)}), legendary ${formatNumber(story.legendarySelected, 0)}/${formatNumber(story.legendaryConsidered, 0)} (${formatPercent(story.legendaryFocusCoverage, 1)}), priority context ${formatNumber(story.priorityContextCovered, 0)}/${formatNumber(story.priorityConsidered, 0)} (${formatPercent(story.priorityContextCoverage, 1)})\n`,
    );
    process.stdout.write(
      `sagas: opened ${formatNumber(story.sagasOpened, 0)}, resolved ${formatNumber(story.sagasResolved, 0)}, failed ${formatNumber(story.sagasFailed, 0)}, archived ${formatNumber(story.sagasArchived, 0)}, evicted ${formatNumber(story.sagasEvicted, 0)}, terminal/opened ${formatPercent(story.sagaResolutionRate, 1)}\n`,
    );

    const decrees = variant
      && variant.summary
      && variant.summary.schismDecrees
      && typeof variant.summary.schismDecrees === 'object'
      ? variant.summary.schismDecrees
      : null;
    const decreeIds = decrees ? Object.keys(decrees.byId || {}) : [];
    if (decrees && decreeIds.length > 0) {
      process.stdout.write(
        `decrees: issued ${formatNumber(decrees.issuedTotal, 0)}, issued/seed ${formatNumber(decrees.issuedPerSeedAvg, 2)}, activeTicks ${formatNumber(decrees.activeTicksTotal, 0)}, activeTicks/seed ${formatNumber(decrees.activeTicksPerSeedAvg, 2)}\n`,
      );
      for (const decreeId of decreeIds) {
        const issued = Number(decrees.byId && decrees.byId[decreeId] || 0);
        const issuedShare = Number(decrees.byIdShare && decrees.byIdShare[decreeId] || 0);
        const activeTicks = Number(decrees.activeTicksById && decrees.activeTicksById[decreeId] || 0);
        const activeShare = Number(
          decrees.activeTicksByIdShare && decrees.activeTicksByIdShare[decreeId] || 0,
        );
        process.stdout.write(
          `decree ${decreeId}: issued ${formatNumber(issued, 0)} (${formatPercent(issuedShare, 1)}), activeTicks ${formatNumber(activeTicks, 0)} (${formatPercent(activeShare, 1)})\n`,
        );
      }
    }
    process.stdout.write('\n');
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
    process.stdout.write(
      `underDepth ${formatSignedNumber(comparison.deltas.underrealmDepth.abs, 2)} (${formatSignedPercent(comparison.deltas.underrealmDepth.rel)})\n`,
    );
    process.stdout.write(
      `underChamp ${formatSignedNumber(comparison.deltas.underrealmChampions.abs, 2)} (${formatSignedPercent(comparison.deltas.underrealmChampions.rel)})\n`,
    );
    process.stdout.write(
      `underFail ${formatSignedNumber(comparison.deltas.underrealmFailedExpeditions.abs, 2)} (${formatSignedPercent(comparison.deltas.underrealmFailedExpeditions.rel)})\n`,
    );
    process.stdout.write(
      `underBlocked ${formatSignedNumber(comparison.deltas.underrealmBlockedDispatches.abs, 2)} (${formatSignedPercent(comparison.deltas.underrealmBlockedDispatches.rel)})\n`,
    );
    process.stdout.write(
      `underContested ${formatSignedNumber(comparison.deltas.underrealmFrontierContested.abs, 2)} (${formatSignedPercent(comparison.deltas.underrealmFrontierContested.rel)})\n`,
    );
    process.stdout.write(
      `underReadiness ${formatSignedNumber(comparison.deltas.underrealmReadinessScore.abs, 3)} (${formatSignedPercent(comparison.deltas.underrealmReadinessScore.rel)})\n`,
    );
    process.stdout.write(
      `underHeroProm ${formatSignedNumber(comparison.deltas.underrealmHeroPromotions.abs, 2)} (${formatSignedPercent(comparison.deltas.underrealmHeroPromotions.rel)})\n`,
    );
    process.stdout.write(
      `underHeroLoss ${formatSignedNumber(comparison.deltas.underrealmHeroLosses.abs, 2)} (${formatSignedPercent(comparison.deltas.underrealmHeroLosses.rel)})\n`,
    );
    process.stdout.write(
      `underHeroAct ${formatSignedNumber(comparison.deltas.underrealmHeroActive.abs, 2)} (${formatSignedPercent(comparison.deltas.underrealmHeroActive.rel)})\n`,
    );
    process.stdout.write(
      `underHeroSurv ${formatSignedNumber(comparison.deltas.underrealmHeroSurvivals.abs, 2)} (${formatSignedPercent(comparison.deltas.underrealmHeroSurvivals.rel)})\n`,
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
        `underDepth ${formatSignedPercent(row.deltas.underrealmDepth.rel)}, ` +
        `underChamp ${formatSignedPercent(row.deltas.underrealmChampions.rel)}, ` +
        `underReady ${formatSignedPercent(row.deltas.underrealmReadinessScore.rel)}, ` +
        `underHeroProm ${formatSignedPercent(row.deltas.underrealmHeroPromotions.rel)}, ` +
        `underHeroLoss ${formatSignedPercent(row.deltas.underrealmHeroLosses.rel)}, ` +
        `underHeroAct ${formatSignedPercent(row.deltas.underrealmHeroActive.rel)}, ` +
        `underHeroSurv ${formatSignedPercent(row.deltas.underrealmHeroSurvivals.rel)}, ` +
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
  const configHash = computeFileHash(options.configPath);
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
      reportSchemaVersion: BENCHMARK_REPORT_SCHEMA_VERSION,
      ticks: options.ticks,
      seeds: options.seeds,
      configPath: options.configPath,
      configHash,
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
