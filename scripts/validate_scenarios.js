#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../config.json');
const { createGameSession, advanceGameSession } = require('../src/game_session');
const { withSessionRandom } = require('../src/session_random');
const { getSaveSettings, saveGame, loadGame } = require('../src/persistence');
const { loadPolicy } = require('../src/ai_policy');
const { shouldTriggerEndgameReset } = require('../src/simulation/endgame');
const { appHelpers, assertSessionEqual } = require('./test_save_contracts');

// Keep validation launches explicit so a failed scenario can be rerun without repeating the catalog.
function parseOptions(args) {
  const options = { shortTicks: 2000, longTicks: 8000, only: null,
    report: path.join(__dirname, '../debug/scenario_validation_latest.json') };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]; const value = args[++index];
    if (flag === '--only') options.only = String(value).split(',');
    else if (flag === '--short-ticks') options.shortTicks = Number(value);
    else if (flag === '--long-ticks') options.longTicks = Number(value);
    else if (flag === '--report-json') options.report = path.resolve(value);
    else throw new Error(`Unknown scenario validation option: ${flag}`);
  }
  assert(Number.isInteger(options.shortTicks) && options.shortTicks >= 200);
  assert(Number.isInteger(options.longTicks) && options.longTicks >= options.shortTicks);
  return options;
}

// Advance the actual terminal simulation and cycle lifecycle, omitting wall-clock presentation delays.
function advance(session, driver) {
  if (session.state.ui.transition.active) {
    withSessionRandom(session.random, () => driver.advanceEndgameTransition(session.state, session.config, session.runtime));
  } else {
    advanceGameSession(session);
    if (shouldTriggerEndgameReset(session.state, session.config)) {
      withSessionRandom(session.random, () => driver.startEndgameTransition(session.state, session.config, session.runtime));
    }
  }
}

// Reject invalid economy/actor state while allowing deliberate gameplay losses and bounded caches.
function checkState(session) {
  for (const [resource, value] of Object.entries(session.state.stockpile)) {
    assert(Number.isFinite(value) && value >= 0, `Invalid ${resource} stockpile`);
  }
  assert(session.state.dwarves.length > 0, 'Colony became extinct');
  for (const dwarf of session.state.dwarves) {
    assert(Number.isFinite(dwarf.x) && Number.isFinite(dwarf.y), 'Invalid actor position');
    assert(dwarf.x >= 0 && dwarf.x < session.runtime.gridWidth && dwarf.y >= 0 && dwarf.y < session.runtime.gridHeight,
      'Actor left world bounds');
  }
}

// Validate distinct play templates once per milestone, reusing short runs as long-run prefixes.
function main() {
  const options = parseOptions(process.argv.slice(2));
  const selected = config.startup.scenarios.filter((entry) => !options.only || options.only.includes(entry.id));
  assert(selected.length > 0, 'No matching scenarios');
  if (options.only) assert(options.only.every((id) => selected.some((entry) => entry.id === id)), 'Unknown scenario ID');
  const longScenarios = new Set(['raider_frontier', 'divided_halls', 'below_the_gate', 'compound_crisis']);
  const modelPath = path.join(__dirname, '../models/policy_best.json');
  const modelHash = crypto.createHash('sha256').update(fs.readFileSync(modelPath)).digest('hex');
  const trainingHash = crypto.createHash('sha256').update(JSON.stringify(config.ai.training)).digest('hex');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nodedwarves-scenario-milestone-'));
  const settings = { ...getSaveSettings(config), directory };
  const runtime = { gridWidth: 120, gridHeight: 40, playableArea: 4800,
    totalWidth: 120, totalHeight: 40, frameEnabled: false, mapInset: null };
  const report = { schemaVersion: 1, completed: false, passed: false,
    configHash: crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../config.json'))).digest('hex'),
    modelHash, trainingHash, options, cases: [] };
  const cases = [];
  for (const scenario of selected) {
    const seed = scenario.seed ?? 101;
    cases.push({ scenarioId: scenario.id, seed, ticks: longScenarios.has(scenario.id) ? options.longTicks : options.shortTicks, policy: null });
    cases.push({ scenarioId: scenario.id, seed: (seed + 10007) >>> 0, ticks: options.shortTicks, policy: null });
  }
  if (selected.some((entry) => entry.id === 'compound_crisis')) {
    cases.push({ scenarioId: 'compound_crisis', seed: 1111, ticks: options.longTicks, policy: loadPolicy(modelPath) });
  }
  const started = Date.now();
  const writeReport = () => {
    fs.mkdirSync(path.dirname(options.report), { recursive: true });
    fs.writeFileSync(options.report, JSON.stringify({ ...report, elapsedMs: Date.now() - started }, null, 2) + '\n');
  };
  try {
    for (const fixture of cases) {
      let session = createGameSession(config, runtime, fixture);
      let driver = appHelpers(session);
      const row = { scenarioId: fixture.scenarioId, seed: fixture.seed, ticks: fixture.ticks,
        policy: fixture.policy ? 'canonical' : 'autonomous', passed: false, minPopulation: session.state.dwarves.length,
        maxPopulation: session.state.dwarves.length, maxDepth: 0, checkpointRestored: false };
      process.stdout.write(`[scenarios] ${row.scenarioId} seed=${row.seed} ${row.policy} horizon=${row.ticks} start\n`);
      try {
        for (let index = 1; index <= fixture.ticks; index += 1) {
          advance(session, driver);
          row.minPopulation = Math.min(row.minPopulation, session.state.dwarves.length);
          row.maxPopulation = Math.max(row.maxPopulation, session.state.dwarves.length);
          row.maxDepth = Math.max(row.maxDepth, Number(session.state.underrealm?.maxUnlockedDepth || 0));
          if (index % 100 === 0) checkState(session);
          if (index === Math.min(1000, Math.floor(fixture.ticks / 2))) {
            const filePath = saveGame(session, settings, 'autosave');
            const restored = loadGame(filePath, settings).session;
            assertSessionEqual(restored, session, `${row.scenarioId}: checkpoint identity`);
            session = restored; driver = appHelpers(session); row.checkpointRestored = true;
          }
          if (index % 1000 === 0) process.stdout.write(`[scenarios] ${row.scenarioId} seed=${row.seed} ${index}/${row.ticks} pop=${session.state.dwarves.length} depth=${row.maxDepth}\n`);
        }
        checkState(session);
        row.passed = true;
      } catch (error) { row.error = error.message; }
      row.finalPopulation = session.state.dwarves.length;
      row.deaths = Number(session.state.deathsCount || 0);
      row.cycles = Number(session.state.cycleStats?.count || 0);
      row.finalStockpile = session.state.stockpile;
      row.raidStats = session.state.raidStats;
      report.cases.push(row); writeReport();
      process.stdout.write(`[scenarios] ${row.scenarioId} seed=${row.seed} ${row.policy} ${row.passed ? 'PASS' : 'FAIL: ' + row.error} finalPop=${row.finalPopulation}\n`);
    }
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(modelPath)).digest('hex'), modelHash);
    assert.equal(crypto.createHash('sha256').update(JSON.stringify(config.ai.training)).digest('hex'), trainingHash);
    report.completed = true; report.passed = report.cases.every((row) => row.passed); writeReport();
    process.stdout.write(`[scenarios] ${report.passed ? 'PASS' : 'FAIL'} ${report.cases.filter((row) => row.passed).length}/${report.cases.length} cases; training and canonical policy unchanged\n`);
    if (!report.passed) process.exitCode = 1;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (require.main === module) main();
