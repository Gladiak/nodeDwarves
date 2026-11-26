#!/usr/bin/env node
'use strict';

// Simulation fingerprint for bit-identical refactors and optimizations (STRATEGY.md E39).
// Plays seeded no-AI games and hashes the complete game state (canonical content hash: v8.serialize
// is not canonical, one number may be written as int or double depending on JIT state) plus the
// position of the Math.random stream at fixed checkpoints.
//
// Usage:
//   node scripts/sim_fingerprint.js --save debug/sim_fingerprint.json      # before a change
//   node scripts/sim_fingerprint.js --compare debug/sim_fingerprint.json   # after: exit 1 on any difference
//   [--seeds 101,202,303,404] [--checkpoints 1000,4000,8000]

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const { loadConfig } = require(path.join(ROOT, 'src', 'config'));
const { buildRuntime } = require(path.join(ROOT, 'src', 'runtime'));
const { createInitialState } = require(path.join(ROOT, 'src', 'state'));
const { stepState } = require(path.join(ROOT, 'src', 'simulation'));

// Parse --key value options.
function parseArgs(argv) {
  const options = { seeds: '101,202,303,404', checkpoints: '1000,4000,8000', save: null, compare: null };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in options)) throw new Error(`Unknown option ${argv[i]}`);
    options[key] = argv[i + 1];
  }
  options.seeds = options.seeds.split(',').map(Number);
  options.checkpoints = options.checkpoints.split(',').map(Number).sort((a, b) => a - b);
  return options;
}

// Same generator as the measurement tools.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Every object reachable from the config: the config is an input, not game state (state keeps a
// reference to it), so it is hashed as an opaque marker; config changes that matter show up in the
// state they produce.
function collectObjects(root) {
  const objects = new Set();
  const stack = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    if (value === null || typeof value !== 'object' || objects.has(value)) continue;
    objects.add(value);
    for (const item of (value instanceof Map ? value.values() : Object.values(value))) stack.push(item);
  }
  return objects;
}

// Canonical content hash: cycles, Map/Set/typed arrays, NaN/Infinity/-0/undefined; key order counts.
function hashValue(root, opaque) {
  const hash = crypto.createHash('sha256');
  const seen = new Map();
  const visit = (value) => {
    if (value === undefined) { hash.update('u'); return; }
    if (value === null) { hash.update('n'); return; }
    const type = typeof value;
    if (type === 'number') { hash.update(Object.is(value, -0) ? 'd-0' : `d${value}`); return; }
    if (type === 'string') { hash.update(`s${value.length}:${value}`); return; }
    if (type === 'boolean') { hash.update(value ? 'T' : 'F'); return; }
    if (type === 'bigint') { hash.update(`b${value}`); return; }
    if (type === 'function' || type === 'symbol') { hash.update('f'); return; }
    if (opaque.has(value)) { hash.update('C'); return; }
    if (seen.has(value)) { hash.update(`r${seen.get(value)}`); return; }
    seen.set(value, seen.size);
    if (ArrayBuffer.isView(value)) {
      hash.update(`A${value.constructor.name}[`);
      for (const item of value) visit(item);
      hash.update(']');
      return;
    }
    if (Array.isArray(value)) {
      hash.update(`[${value.length}`);
      for (const item of value) visit(item);
      hash.update(']');
      return;
    }
    if (value instanceof Map) {
      hash.update('M{');
      for (const [key, item] of value) { visit(key); visit(item); }
      hash.update('}');
      return;
    }
    if (value instanceof Set) {
      hash.update('S{');
      for (const item of value) visit(item);
      hash.update('}');
      return;
    }
    hash.update('{');
    for (const key of Object.keys(value)) { hash.update(`k${key}`); visit(value[key]); }
    hash.update('}');
  };
  visit(root);
  return hash.digest('hex').slice(0, 20);
}

// Play one seeded game and fingerprint it at each checkpoint.
function fingerprintGame(seed, checkpoints) {
  const config = loadConfig();
  config.display.terrain = { ...(config.display.terrain || {}), seed };
  const runtime = buildRuntime({ ...config.display, autoSize: false, width: 120, height: 40 }, { columns: 120, rows: 40 });
  const nativeRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    const state = createInitialState(config, runtime);
    const opaque = collectObjects(config);
    const marks = [];
    let tick = 0;
    for (const checkpoint of checkpoints) {
      for (; tick < checkpoint; tick += 1) stepState(state, config, runtime, null);
      const probe = Math.random();
      marks.push({ tick: checkpoint, population: state.dwarves.length, state: hashValue(state, opaque), rng: probe });
    }
    return { seed, marks };
  } finally {
    Math.random = nativeRandom;
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const started = Date.now();
  const games = options.seeds.map((seed) => fingerprintGame(seed, options.checkpoints));
  const report = { seeds: options.seeds, checkpoints: options.checkpoints, games };
  for (const game of games) {
    console.log(`seed ${game.seed}: ${game.marks.map((m) => `t${m.tick} pop=${m.population} ${m.state} rng=${m.rng.toFixed(9)}`).join('  ')}`);
  }
  console.log(`[fingerprint] ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (options.save) {
    fs.writeFileSync(path.resolve(options.save), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[fingerprint] saved ${options.save}`);
  }
  if (options.compare) {
    const reference = JSON.parse(fs.readFileSync(path.resolve(options.compare), 'utf8'));
    if (JSON.stringify(reference.seeds) !== JSON.stringify(report.seeds)
      || JSON.stringify(reference.checkpoints) !== JSON.stringify(report.checkpoints)) {
      console.error('[fingerprint] reference uses other seeds or checkpoints');
      process.exit(2);
    }
    const differences = [];
    report.games.forEach((game, g) => game.marks.forEach((mark, m) => {
      const ref = reference.games[g].marks[m];
      if (ref.state !== mark.state || ref.rng !== mark.rng) differences.push(`seed ${game.seed} tick ${mark.tick}`);
    }));
    if (differences.length > 0) {
      console.error(`[fingerprint] DIFFERENT at ${differences.join(', ')}`);
      process.exit(1);
    }
    console.log('[fingerprint] IDENTICAL to reference');
  }
}

main();
