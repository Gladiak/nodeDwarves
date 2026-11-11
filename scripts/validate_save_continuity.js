#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('crypto');
const baseConfig = require('../config.json');
const { createGameSession, advanceGameSession } = require('../src/game_session');
const { withSessionRandom } = require('../src/session_random');
const { getSaveSettings, saveGame, loadGame } = require('../src/persistence');
const { loadPolicy } = require('../src/ai_policy');
const { shouldTriggerEndgameReset } = require('../src/simulation/endgame');
const { appHelpers, assertSessionEqual } = require('./test_save_contracts');

// Follow the same AI, transition and reset path used by the terminal loop.
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

// Compare whole worlds over long horizons using one persisted split point per case.
function main() {
  const args = process.argv.slice(2);
  const ticksIndex = args.indexOf('--ticks');
  const ticks = ticksIndex < 0 ? 8000 : Number(args[ticksIndex + 1]);
  assert(Number.isSafeInteger(ticks) && ticks >= 200, 'Use at least 200 validation advances.');
  const cut = Math.floor(ticks / 2) + 1;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nodedwarves-save-continuity-'));
  const settings = { ...getSaveSettings(baseConfig), directory };
  const modelPath = path.join(__dirname, '../models/policy_best.json');
  const modelHash = crypto.createHash('sha256').update(fs.readFileSync(modelPath)).digest('hex');
  const runtime = { gridWidth: 120, gridHeight: 40, playableArea: 4800,
    totalWidth: 120, totalHeight: 40, frameEnabled: false, mapInset: null };
  const cases = [
    { name: 'autonomous', seed: 101, scenarioId: 'free', policy: null },
    { name: 'canonical-policy', seed: 303, scenarioId: 'free', policy: loadPolicy(modelPath) },
    { name: 'green-valley', seed: 101, scenarioId: 'green_valley', policy: null, short: true },
    { name: 'lean-provisions', seed: 303, scenarioId: 'lean_provisions', policy: null, short: true },
  ];
  try {
    for (const fixture of cases) {
      const horizon = fixture.short ? Math.min(ticks, 1000) : ticks;
      const split = Math.min(cut, Math.floor(horizon / 2) + 1);
      const original = createGameSession(baseConfig, runtime, fixture);
      const driver = appHelpers(original);
      let filePath;
      process.stdout.write(`[save-continuity] ${fixture.name} seed=${fixture.seed} horizon=${horizon} start\n`);
      for (let index = 1; index <= horizon; index += 1) {
        advance(original, driver);
        if (index === split) filePath = saveGame(original, settings, 'autosave');
        if (index % 1000 === 0) process.stdout.write(`[save-continuity] ${fixture.name} uninterrupted ${index}/${horizon} pop=${original.state.dwarves.length}\n`);
      }
      const resumed = loadGame(filePath, settings).session;
      const resumedDriver = appHelpers(resumed);
      for (let index = split + 1; index <= horizon; index += 1) {
        advance(resumed, resumedDriver);
        if (index % 1000 === 0) process.stdout.write(`[save-continuity] ${fixture.name} resumed ${index}/${horizon} pop=${resumed.state.dwarves.length}\n`);
      }
      assertSessionEqual(resumed, original, `${fixture.name} at ${horizon}`);
      for (const [resource, value] of Object.entries(resumed.state.stockpile)) {
        assert(Number.isFinite(value) && value >= 0, `Invalid ${resource} stockpile`);
      }
      assert(resumed.state.dwarves.length > 0, 'Colony collapsed');
      process.stdout.write(`[save-continuity] ${fixture.name} PASS complete state/RNG/AI identity; tick=${resumed.state.tick} cycles=${resumed.state.cycleStats.count} saveBytes=${fs.statSync(filePath).size}\n`);
    }
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(modelPath)).digest('hex'), modelHash);
    process.stdout.write(`[save-continuity] PASS all cases; canonical model unchanged sha256=${modelHash}\n`);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (require.main === module) main();
