#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { buildRuntime } = require('../src/runtime');
const { createInitialState } = require('../src/state');
const { stepState } = require('../src/simulation');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');

const DEFAULT_TICKS = 1600;
const DEFAULT_SEEDS = [101, 202, 303, 404];

function parseArgs(argv) {
  const options = {
    ticks: DEFAULT_TICKS,
    seeds: DEFAULT_SEEDS.slice(),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--ticks') {
      options.ticks = Math.max(100, Number(argv[i + 1] || options.ticks));
      i += 1;
      continue;
    }
    if (arg === '--seeds') {
      const value = String(argv[i + 1] || '');
      i += 1;
      options.seeds = value
        .split(',')
        .map((part) => Number(part.trim()))
        .filter(Number.isFinite);
      if (!options.seeds.length) {
        options.seeds = DEFAULT_SEEDS.slice();
      }
      continue;
    }
  }
  return options;
}

function readConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

function seededRandom(seed) {
  let t = Number(seed) >>> 0;
  return function random() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function withSeed(seed, fn) {
  const original = Math.random;
  Math.random = seededRandom(seed);
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

function buildRuntimeForConfig(config) {
  const display = { ...(config.display || {}) };
  display.autoSize = false;
  const terminal = {
    columns: Number(display.width || 80),
    rows: Number(display.height || 24),
  };
  return buildRuntime(display, terminal);
}

function runSimulation(baseConfig, seed, ticks) {
  return withSeed(seed, () => {
    const config = JSON.parse(JSON.stringify(baseConfig));
    if (!config.display) config.display = {};
    if (!config.display.terrain) config.display.terrain = {};
    config.display.terrain.seed = Number(seed);
    const runtime = buildRuntimeForConfig(config);
    const state = createInitialState(config, runtime);
    const startPop = state.dwarves.length;

    for (let i = 0; i < ticks; i += 1) {
      stepState(state, config, runtime, null);
    }

    return {
      births: Number(state.birthsCount || 0),
      deaths: Number(state.deathsCount || 0),
      startPop,
      endPop: state.dwarves.length,
    };
  });
}

function applyRelationshipOverrides(config, overrides) {
  if (!config.population) config.population = {};
  if (!config.population.relationships) config.population.relationships = {};
  Object.assign(config.population.relationships, overrides);
  return config;
}

function buildGrid(baseConfig) {
  const base = baseConfig.population && baseConfig.population.relationships
    ? baseConfig.population.relationships
    : {};
  const interactionsPerTick = [3, 4, 5];
  const minInteractions = [2, 3, 4];
  const proximityShare = [0.35, 0.5, 0.65];
  const bondThreshold = [10, 12];
  const bondGain = [1.1, 1.3, 1.5];

  const grid = [];
  for (const interactions of interactionsPerTick) {
    for (const min of minInteractions) {
      for (const share of proximityShare) {
        for (const threshold of bondThreshold) {
          for (const gain of bondGain) {
            grid.push({
              interactionsPerTick: interactions,
              minInteractionsPerTick: min,
              proximityShare: share,
              bondThreshold: threshold,
              bondGain: gain,
              idleInteractionMultiplier: Number(base.idleInteractionMultiplier ?? 1),
            });
          }
        }
      }
    }
  }
  return grid;
}

function aggregateResults(rows, ticks, seedsCount) {
  const totals = {
    births: 0,
    deaths: 0,
    delta: 0,
    endPop: 0,
    positive: 0,
  };
  for (const row of rows) {
    totals.births += row.births;
    totals.deaths += row.deaths;
    totals.delta += row.endPop - row.startPop;
    totals.endPop += row.endPop;
    if (row.endPop - row.startPop > 0) {
      totals.positive += 1;
    }
  }
  const scale = 1000 / ticks;
  return {
    birthsPerK: totals.births * scale / seedsCount,
    deathsPerK: totals.deaths * scale / seedsCount,
    deltaPerK: totals.delta * scale / seedsCount,
    avgEndPop: totals.endPop / seedsCount,
    positiveRuns: totals.positive,
  };
}

function formatNumber(value) {
  return value.toFixed(2).padStart(6, ' ');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const baseConfig = readConfig();
  const grid = buildGrid(baseConfig);

  const results = [];

  for (const overrides of grid) {
    const runs = [];
    for (const seed of options.seeds) {
      const config = JSON.parse(JSON.stringify(baseConfig));
      applyRelationshipOverrides(config, overrides);
      runs.push(runSimulation(config, seed, options.ticks));
    }
    const summary = aggregateResults(runs, options.ticks, options.seeds.length);
    results.push({ overrides, summary });
  }

  results.sort((a, b) => b.summary.deltaPerK - a.summary.deltaPerK);

  const header = [
    'inter',
    'minInt',
    'prox',
    'bondTh',
    'bondGn',
    'births/K',
    'deaths/K',
    'delta/K',
    'avgEnd',
    'pos',
  ].join('  ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const entry of results.slice(0, 8)) {
    const o = entry.overrides;
    const s = entry.summary;
    const line = [
      String(o.interactionsPerTick).padStart(5, ' '),
      String(o.minInteractionsPerTick).padStart(6, ' '),
      String(o.proximityShare.toFixed(2)).padStart(4, ' '),
      String(o.bondThreshold).padStart(6, ' '),
      String(o.bondGain.toFixed(2)).padStart(6, ' '),
      formatNumber(s.birthsPerK),
      formatNumber(s.deathsPerK),
      formatNumber(s.deltaPerK),
      formatNumber(s.avgEndPop),
      String(s.positiveRuns).padStart(3, ' '),
    ].join('  ');
    console.log(line);
  }

  console.log('');
  console.log(`Runs: ${options.seeds.length} seeds, ${options.ticks} ticks each`);
}

main();
