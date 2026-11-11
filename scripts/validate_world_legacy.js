#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const baseConfig = require('../config.json');
const { createInitialState } = require('../src/state');
const { pushEvent } = require('../src/simulation/events');
const { stepState } = require('../src/simulation');
const { resolveLegacyEffects } = require('../src/simulation/legacy_effects');
const { runEndgameReset } = require('../src/simulation/endgame');
const { countLegacyRecords, getWorldLegacySettings } = require('../src/simulation/world_legacy');

const ROOT = path.resolve(__dirname, '..');
const PROFILES = { '2-cycle': 2, '5-cycle': 5, '10-cycle': 10 };
const TICKS_PER_CYCLE = 1500;

function parseArgs(argv) {
  const options = { profiles: Object.keys(PROFILES), reportJson: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--profile') {
      const profile = String(argv[index + 1] || '');
      if (!PROFILES[profile]) throw new Error(`Unknown profile: ${profile}`);
      options.profiles = [profile];
      index += 1;
    } else if (arg === '--report-json') {
      options.reportJson = path.resolve(ROOT, String(argv[index + 1] || ''));
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

// Simulate controlled equal-length cycles with paired RNG streams and explicit source fixtures.
function runVariant(name, enabled) {
  const originalRandom = Math.random;
  let randomSeed = 6600 + PROFILES[name];
  Math.random = () => ((randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0) / 4294967296);
  try {
    const config = JSON.parse(JSON.stringify(baseConfig));
    config.display.terrain.seed = 6600 + PROFILES[name];
    config.endgame.transition.randomizeSeed = false;
    config.world_legacy.institutions.effects.enabled = enabled;
    const runtime = { gridWidth: 100, gridHeight: 38, playableArea: 3800 };
    const state = createInitialState(config, runtime);
    const settings = getWorldLegacySettings(config);
    const cycles = [];
    const failures = [];
    for (let cycle = 0; cycle < PROFILES[name]; cycle += 1) {
      const floors = { food: Infinity, water: Infinity };
      const sums = { food: 0, water: 0 };
      for (let tick = 0; tick < TICKS_PER_CYCLE; tick += 1) {
        stepState(state, config, runtime, null);
        for (const key of Object.keys(floors)) {
          const value = Number(state.stockpile[key]);
          if (!Number.isFinite(value) || value < 0) failures.push(`cycle ${cycle + 1}: invalid ${key}`);
          floors[key] = Math.min(floors[key], value);
          sums[key] += value;
        }
      }
      // These receipts deliberately guarantee source coverage; resets are controlled, not natural wins.
      for (let index = 0; index < 3; index += 1) {
        state.tick += 1;
        pushEvent(state, config, { type: 'construction.structure_completed', category: 'economy',
          importance: 'critical', message: `Controlled cycle ${cycle + 1} construction receipt ${index + 1}.`,
          actors: [], location: { scope: 'surface', x: 3, y: 3, label: 'Validation court' },
          causes: [], consequences: [], source: 'world_legacy_validation', tags: ['legacy'] });
      }
      const before = { population: state.dwarves.length, births: Number(state.birthsCount || 0),
        deaths: Number(state.deathsCount || 0), foodFloor: floors.food, waterFloor: floors.water,
        foodMean: sums.food / TICKS_PER_CYCLE, waterMean: sums.water / TICKS_PER_CYCLE };
      runEndgameReset(state, config, runtime);
      const effects = resolveLegacyEffects(state, config);
      const records = countLegacyRecords(state.worldLegacy);
      const bytes = Buffer.byteLength(JSON.stringify(state.worldLegacy));
      cycles.push({ cycle: cycle + 1, ...before, populationAfterReset: state.dwarves.length,
        legacyRecords: records, legacyStateBytes: bytes, effectiveMagnitude: effects.activeMagnitude,
        activeCount: effects.activeCount, evictedRecords: state.worldLegacy.stats.evictedRecords });
      if (before.population <= 0 || state.dwarves.length <= 0) failures.push(`cycle ${cycle + 1}: collapse`);
      if (effects.activeMagnitude > Math.min(0.05, settings.modifierCap) + 1e-9) failures.push(`cycle ${cycle + 1}: cap`);
      if (enabled && effects.activeCount !== 1) failures.push(`cycle ${cycle + 1}: missing verified guild`);
      if (records > settings.maxTotal || state.worldLegacy.cycles.length > settings.maxCycles) failures.push(`cycle ${cycle + 1}: retention`);
      if (bytes > 262144) failures.push(`cycle ${cycle + 1}: 256 KiB sentinel`);
      if (JSON.stringify(resolveLegacyEffects(JSON.parse(JSON.stringify(state)), config)) !== JSON.stringify(effects)) {
        failures.push(`cycle ${cycle + 1}: non-idempotent reload`);
      }
    }
    if (state.cycleStats.count !== PROFILES[name]) failures.push('completed-cycle count mismatch');
    return { enabled, cycles, failures };
  } finally { Math.random = originalRandom; }
}

// Apply the workbook budgets to each controlled cycle rather than hiding a weak seed in a mean.
function runProfile(name) {
  const baseline = runVariant(name, false);
  const candidate = runVariant(name, true);
  const failures = [...baseline.failures, ...candidate.failures];
  for (let index = 0; index < candidate.cycles.length; index += 1) {
    const base = baseline.cycles[index];
    const row = candidate.cycles[index];
    if (row.population < base.population * 0.9) failures.push(`cycle ${index + 1}: population budget`);
    if (row.births < base.births * 0.9 - 2 || row.deaths > base.deaths * 1.1 + 2) failures.push(`cycle ${index + 1}: lifecycle budget`);
    for (const key of ['food', 'water']) {
      if (row[`${key}Floor`] < base[`${key}Floor`] * 0.9 - 2
        || row[`${key}Mean`] < base[`${key}Mean`] * 0.92) failures.push(`cycle ${index + 1}: ${key} budget`);
    }
    if (index > 0 && row.effectiveMagnitude > candidate.cycles[index - 1].effectiveMagnitude + 1e-9) {
      failures.push(`cycle ${index + 1}: repeated same-type compounding`);
    }
  }
  return { profile: name, targetCycles: PROFILES[name], ticksPerCycle: TICKS_PER_CYCLE,
    sourceMode: 'three controlled construction receipts per cycle; real simulation between controlled resets',
    baseline: baseline.cycles, cycles: candidate.cycles, failures, passed: failures.length === 0 };
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write('Usage: node scripts/validate_world_legacy.js [--profile 2-cycle|5-cycle|10-cycle] [--report-json path]\n');
      return;
    }
    const profiles = options.profiles.map(runProfile);
    const report = { schemaVersion: 2, profiles, allPassed: profiles.every((entry) => entry.passed) };
    for (const profile of profiles) {
      const last = profile.cycles[profile.cycles.length - 1];
      process.stdout.write(
        `[world-legacy] ${profile.profile} ${profile.passed ? 'PASS' : 'FAIL'} records=${last.legacyRecords} bytes=${last.legacyStateBytes} active=${last.activeCount} modifier=${last.effectiveMagnitude.toFixed(3)}\n`,
      );
      for (const failure of profile.failures) process.stdout.write(`  - ${failure}\n`);
    }
    if (options.reportJson) {
      fs.mkdirSync(path.dirname(options.reportJson), { recursive: true });
      fs.writeFileSync(options.reportJson, `${JSON.stringify(report, null, 2)}\n`);
      process.stdout.write(`Report JSON written to ${options.reportJson}\n`);
    }
    if (!report.allPassed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`world legacy validation error: ${error.message}\n`);
    process.exitCode = 1;
  }
}

main();
