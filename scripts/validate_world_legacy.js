#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const baseConfig = require('../config.json');
const { createInitialState } = require('../src/state');
const { pushEvent } = require('../src/simulation/events');
const { runEndgameReset } = require('../src/simulation/endgame');
const { countLegacyRecords, getWorldLegacySettings } = require('../src/simulation/world_legacy');

const ROOT = path.resolve(__dirname, '..');
const PROFILES = { '2-cycle': 2, '5-cycle': 5 };

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

function runProfile(name) {
  const config = JSON.parse(JSON.stringify(baseConfig));
  config.display.terrain.seed = 6600 + PROFILES[name];
  config.endgame.transition.randomizeSeed = false;
  const runtime = { gridWidth: 100, gridHeight: 38, playableArea: 3800 };
  const state = createInitialState(config, runtime);
  const settings = getWorldLegacySettings(config);
  const cycles = [];
  const failures = [];

  for (let cycle = 0; cycle < PROFILES[name]; cycle += 1) {
    state.tick = 2000 + cycle * 100;
    const dwarf = state.dwarves[0];
    pushEvent(state, config, {
      type: cycle % 2 === 0 ? 'warrior.champion_crowned' : 'world.legacy_founding',
      category: cycle % 2 === 0 ? 'warrior' : 'world',
      importance: cycle % 2 === 0 ? 'legendary' : 'critical',
      message: `Cycle ${cycle + 1} completed a witnessed legacy deed.`,
      actors: [{ kind: 'dwarf', id: dwarf.id, role: 'primary', label: `Legacy Hero ${cycle + 1}` }],
      location: { scope: 'surface', x: 3, y: 3, placeId: `legacy_hold_${cycle}`, label: `Legacy Hold ${cycle + 1}` },
      causes: [], consequences: [], source: 'world_legacy_validation', tags: ['legacy'],
    });

    const before = {
      population: state.dwarves.length,
      deaths: Number(state.deathsCount || 0),
      stockpile: snapshotStockpile(state.stockpile),
      endgameTicks: Number(state.tick || 0),
    };
    runEndgameReset(state, config, runtime);
    const modifierTotal = state.worldLegacy.institutions.reduce(
      (sum, entry) => sum + Number(entry.modifier && entry.modifier.magnitude || 0), 0,
    );
    const records = countLegacyRecords(state.worldLegacy);
    const stateBytes = Buffer.byteLength(JSON.stringify(state.worldLegacy));
    const row = {
      cycle: cycle + 1,
      populationBeforeReset: before.population,
      populationAfterReset: state.dwarves.length,
      deaths: before.deaths,
      stockpileBeforeReset: before.stockpile,
      endgameTicks: before.endgameTicks,
      legacyRecords: records,
      legacyStateBytes: stateBytes,
      modifierMagnitude: modifierTotal,
      echoes: state.worldLegacy.echoes.length,
      evictedRecords: state.worldLegacy.stats.evictedRecords,
    };
    cycles.push(row);

    if (state.dwarves.length <= 0) failures.push(`cycle ${cycle + 1}: population collapsed`);
    if (Object.values(before.stockpile).some((value) => value < 0)) failures.push(`cycle ${cycle + 1}: negative stockpile`);
    if (records > settings.maxTotal) failures.push(`cycle ${cycle + 1}: total legacy cap exceeded`);
    if (modifierTotal > settings.modifierCap + 1e-9) failures.push(`cycle ${cycle + 1}: modifier cap exceeded`);
    if (state.worldLegacy.cycles.length > settings.maxCycles) failures.push(`cycle ${cycle + 1}: cycle retention cap exceeded`);
    if (stateBytes > 262144) failures.push(`cycle ${cycle + 1}: legacy state exceeded 256 KiB stop rule`);
  }

  if (state.cycleStats.count !== PROFILES[name]) failures.push('completed-cycle count mismatch');
  return { profile: name, targetCycles: PROFILES[name], cycles, failures, passed: failures.length === 0 };
}

function snapshotStockpile(stockpile) {
  const result = {};
  for (const key of ['food', 'water', 'beer', 'wood', 'stone', 'iron']) {
    result[key] = Math.max(0, Number(stockpile && stockpile[key] || 0));
  }
  return result;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write('Usage: node scripts/validate_world_legacy.js [--profile 2-cycle|5-cycle] [--report-json path]\n');
      return;
    }
    const profiles = options.profiles.map(runProfile);
    const report = { schemaVersion: 1, profiles, allPassed: profiles.every((entry) => entry.passed) };
    for (const profile of profiles) {
      const last = profile.cycles[profile.cycles.length - 1];
      process.stdout.write(
        `[world-legacy] ${profile.profile} ${profile.passed ? 'PASS' : 'FAIL'} records=${last.legacyRecords} bytes=${last.legacyStateBytes} echoes=${last.echoes} modifier=${last.modifierMagnitude.toFixed(3)}\n`,
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
