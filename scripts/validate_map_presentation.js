#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config.json');
const { createGameSession, advanceGameSession } = require('../src/game_session');
const { encodeSave, decodeSave } = require('../src/persistence');
const { loadPolicy, selectAction } = require('../src/ai_policy');
const { buildObservation } = require('../src/ai/observation');
const { createMapFlows, cycleMapFlows, observeMapFlows, getMapFlowOverlay } = require('../src/runtime/map_flows');
const { renderFrame } = require('../src/render');
const { assertSessionEqual } = require('./test_save_contracts');

// Compare new presentation against the original appearance at an identical render cadence.
function main() {
  const runtime = { gridWidth: 120, gridHeight: 40, playableArea: 4800,
    totalWidth: 120, totalHeight: 40, frameEnabled: false, mapInset: null };
  const modelPath = path.join(__dirname, '../models/policy_best.json');
  const modelHash = crypto.createHash('sha256').update(fs.readFileSync(modelPath)).digest('hex');
  const report = { completed: false, passed: false, modelHash, cases: [] };
  const controlRenderConfig = structuredClone(config);
  controlRenderConfig.display.map_readability.enabled = false;
  const started = Date.now();
  for (const fixture of [{ seed: 101, policy: null }, { seed: 303, policy: loadPolicy(modelPath) }]) {
    const session = createGameSession(config, runtime, fixture);
    const control = decodeSave(encodeSave(session)).session;
    const tracker = createMapFlows(config); cycleMapFlows(tracker);
    observeMapFlows(tracker, session.state, runtime);
    const row = { seed: fixture.seed, policy: fixture.policy ? 'canonical' : 'autonomous', ticks: 8000,
      maxSegments: 0, maxActors: 0, maxOverlayCells: 0, renderedFrames: 0 };
    for (let tick = 1; tick <= row.ticks; tick++) {
      if (tick % 250 === 0) cycleMapFlows(tracker);
      advanceGameSession(session); advanceGameSession(control);
      observeMapFlows(tracker, session.state, runtime);
      row.maxSegments = Math.max(row.maxSegments, tracker.segments.size);
      row.maxActors = Math.max(row.maxActors, tracker.previous.size);
      if (tick % 100 === 0) {
        const overlay = getMapFlowOverlay(tracker, session.state);
        row.maxOverlayCells = Math.max(row.maxOverlayCells, overlay.cells.length);
        renderFrame(session.state, config, runtime, { mapFlows: overlay }); row.renderedFrames++;
        renderFrame(control.state, controlRenderConfig, runtime);
        assert.deepEqual(buildObservation(session.state, config), buildObservation(control.state, config));
        if (fixture.policy) assert.deepEqual(selectAction(session.state, config, fixture.policy), selectAction(control.state, config, fixture.policy));
      }
      if (tick === 1000 || tick % 2000 === 0) {
        assertSessionEqual(session, control, `Map presentation ${row.policy} tick ${tick}`);
        process.stdout.write(`[map-presentation] ${row.policy} seed=${row.seed} ${tick}/8000 pop=${session.state.dwarves.length} exact-state=PASS\n`);
      }
    }
    assert(row.maxSegments <= tracker.maxSegments && row.maxActors <= tracker.maxActors && row.maxOverlayCells <= tracker.maxCells);
    row.passed = true; row.finalPopulation = session.state.dwarves.length; report.cases.push(row);
  }
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(modelPath)).digest('hex'), modelHash);
  report.completed = true; report.passed = true; report.elapsedMs = Date.now() - started;
  report.configHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../config.json'))).digest('hex');
  fs.writeFileSync(path.join(__dirname, '../debug/map_presentation_latest.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write('[map-presentation] PASS short/long exact-state, observer bounds, full frames, AI observation/action and model identity\n');
}

if (require.main === module) main();
