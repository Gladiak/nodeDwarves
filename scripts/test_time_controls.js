#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../src/config');
const { buildRuntime } = require('../src/runtime');
const { createInitialState } = require('../src/state');
const { buildObservation } = require('../src/ai/observation');
const { renderFrame } = require('../src/render');
const {
  changeSpeedLevel,
  consumeSimulationAdvance,
  createTimeControls,
  getLoopDelayMs,
  getSimulationTicksPerFrame,
  getTimeControlsSnapshot,
  observeStoryFocus,
  queueSingleStep,
  resetTimeControlsForTransition,
  resolveTimeControlsConfig,
  toggleManualPause,
} = require('../src/runtime/time_controls');

const ROOT = path.resolve(__dirname, '..');

// Fail fast with one focused runtime-control contract message.
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Remove terminal color sequences before testing visible labels.
function stripAnsi(value) {
  return String(value || '').replace(/\x1b\[[0-9;]*m/g, '');
}

// Validate config resolution, explicit levels, and absolute safety bounds.
function validateTimeControlConfig() {
  const config = loadConfig();
  const settings = resolveTimeControlsConfig(config, 20);
  assert(settings.enabled === true, 'Time controls are unexpectedly disabled by default.');
  assert(settings.defaultLevel === 'warp', 'Default speed level is not warp.');
  assert(
    JSON.stringify(settings.levels.map((entry) => entry.delayMs))
      === JSON.stringify([40, 20, 10, 5, 4, 4, 4]),
    'Default speed levels do not resolve to the expected visible-loop delays.',
  );
  assert(
    JSON.stringify(settings.levels.map((entry) => entry.ticksPerFrame))
      === JSON.stringify([1, 1, 1, 1, 1, 5, 20]),
    'Default speed levels do not resolve to the expected simulation batches.',
  );
  assert(settings.autoProtect.critical.mode === 'slow', 'Critical focus is not auto-slow protected.');
  assert(settings.autoProtect.legendary.mode === 'hold', 'Legendary focus is not auto-hold protected.');

  const hostile = resolveTimeControlsConfig({
    display: {
      tickMs: 20,
      time_controls: {
        min_delay_ms: -10,
        levels: Array.from({ length: 20 }, (_, index) => ({
          id: `level_${index}`,
          label: 'x'.repeat(40),
          delay_multiplier: index === 0 ? 999 : 0,
        })),
        auto_protect: {
          critical: { mode: 'invalid', duration_ms: 999999 },
          legendary: { mode: 'hold', duration_ms: -5 },
        },
      },
    },
  }, 20);
  assert(hostile.levels.length === 8, 'Time-control level hard cap drifted above eight.');
  assert(hostile.levels[0].delayMs === 320, 'Delay multiplier hard cap drifted above sixteen.');
  assert(hostile.levels[1].delayMs === 1, 'Minimum loop delay clamp is not enforced.');
  assert(hostile.levels[0].label.length === 12, 'Speed label bound is not enforced.');
  assert(hostile.autoProtect.critical.mode === 'slow', 'Invalid protection mode did not fall back.');
  assert(hostile.autoProtect.critical.durationMs === 60000, 'Protection duration hard cap drifted.');
  assert(hostile.autoProtect.legendary.durationMs === 0, 'Negative protection duration was not clamped.');
}

// Validate pause, speed, and exactly-one-tick stepping semantics.
function validateManualControlFlow() {
  const controls = createTimeControls(loadConfig(), 20);
  assert(getLoopDelayMs(controls, 0) === 4, 'Warp speed did not use the configured delay.');
  assert(getSimulationTicksPerFrame(controls, 0) === 20, 'Warp speed did not batch twenty ticks.');
  assert(changeSpeedLevel(controls, -1).id === 'rapid', 'Slow-down did not select 25x speed.');
  assert(getSimulationTicksPerFrame(controls, 0) === 5, 'Rapid speed did not batch five ticks.');
  assert(changeSpeedLevel(controls, 1).id === 'warp', 'Speed-up did not restore warp speed.');

  assert(toggleManualPause(controls) === true, 'Space did not pause the visible simulation.');
  assert(consumeSimulationAdvance(controls, 0) === false, 'Manual pause allowed a simulation tick.');
  changeSpeedLevel(controls, 99);
  changeSpeedLevel(controls, 99);
  assert(getLoopDelayMs(controls, 0) === 20, 'Paused fast mode busy-looped below base tick delay.');
  assert(queueSingleStep(controls) === true, 'Single-step command was not queued.');
  assert(consumeSimulationAdvance(controls, 0) === true, 'Queued single step did not advance once.');
  assert(getSimulationTicksPerFrame(controls, 0) === 1, 'Single-step command retained a batched speed.');
  assert(getTimeControlsSnapshot(controls, 0).pendingStep === true, 'Completed single step is not visible while paused.');
  assert(consumeSimulationAdvance(controls, 0) === false, 'Single-step command advanced more than once.');
  assert(toggleManualPause(controls) === false, 'Space did not resume after single-step pause.');
  assert(consumeSimulationAdvance(controls, 0) === true, 'Resumed simulation remained blocked.');

  changeSpeedLevel(controls, -99);
  changeSpeedLevel(controls, -99);

  queueSingleStep(controls);
  const selectedBeforeTransition = getTimeControlsSnapshot(controls, 0).selectedLevel;
  resetTimeControlsForTransition(controls);
  const snapshot = getTimeControlsSnapshot(controls, 0);
  assert(snapshot.paused === false && snapshot.pendingStep === false, 'Transition reset retained pause/step state.');
  assert(snapshot.selectedLevel === selectedBeforeTransition, 'Transition reset discarded the operator-selected speed.');

  const disabled = createTimeControls({ display: { tickMs: 20, time_controls: { enabled: false } } }, 20);
  assert(toggleManualPause(disabled) === true, 'Disabling extended controls removed legacy Space pause.');
  assert(consumeSimulationAdvance(disabled, 0) === false, 'Legacy pause failed with extended controls disabled.');
  assert(queueSingleStep(disabled) === false, 'Disabled extended controls accepted a single-step command.');
}

// Validate one-shot critical/legendary protection, expiry, and manual precedence.
function validateAutomaticProtectionFlow() {
  const config = loadConfig();
  const controls = createTimeControls(config, 20);
  const critical = { eventId: 'evt:critical', importance: 'critical' };
  const criticalBefore = JSON.stringify(critical);
  assert(observeStoryFocus(controls, critical, 1000) === true, 'Critical focus did not arm auto-slow.');
  assert(JSON.stringify(critical) === criticalBefore, 'Focus observation mutated Director state.');
  assert(getLoopDelayMs(controls, 1000) === 40, 'Critical auto-slow did not select the slow level.');
  assert(getSimulationTicksPerFrame(controls, 1000) === 1, 'Critical auto-slow retained batched ticks.');
  assert(consumeSimulationAdvance(controls, 1000) === true, 'Critical auto-slow blocked simulation ticks.');
  assert(observeStoryFocus(controls, critical, 1500) === false, 'Same focus re-armed automatic protection.');
  assert(getTimeControlsSnapshot(controls, 2799).autoProtection !== null, 'Critical protection expired early.');
  assert(getTimeControlsSnapshot(controls, 2800).autoProtection === null, 'Critical protection did not expire.');
  assert(getLoopDelayMs(controls, 2800) === 4, 'Expired auto-slow did not restore manual speed.');

  assert(observeStoryFocus(controls, { eventId: 'evt:critical:2', importance: 'critical' }, 2900) === true, 'Second critical focus did not auto-slow.');
  assert(toggleManualPause(controls) === true, 'Space during auto-slow did not become a manual pause.');
  assert(getTimeControlsSnapshot(controls, 2901).autoProtection === null, 'Manual pause retained critical auto-slow.');
  assert(toggleManualPause(controls) === false, 'Space did not resume after overriding auto-slow.');

  const legendary = { eventId: 'evt:legendary', importance: 'legendary' };
  assert(observeStoryFocus(controls, legendary, 3000) === true, 'Legendary focus did not arm auto-hold.');
  assert(consumeSimulationAdvance(controls, 3000) === false, 'Legendary auto-hold allowed a tick.');
  assert(getLoopDelayMs(controls, 3000) === 20, 'Legendary auto-hold busy-looped below base tick delay.');
  const held = getTimeControlsSnapshot(controls, 3000);
  assert(held.paused && held.pauseReason === 'auto', 'Auto-hold status is not explicit.');
  assert(toggleManualPause(controls) === false, 'Space did not dismiss auto-hold and resume.');
  assert(consumeSimulationAdvance(controls, 3001) === true, 'Manual resume did not override auto-hold.');
  assert(observeStoryFocus(controls, legendary, 3002) === false, 'Dismissed focus re-triggered auto-hold.');

  observeStoryFocus(controls, { eventId: 'evt:legendary:2', importance: 'legendary' }, 4000);
  queueSingleStep(controls);
  assert(consumeSimulationAdvance(controls, 4000) === true, 'Single step did not override auto-hold.');
  assert(consumeSimulationAdvance(controls, 4000) === false, 'Auto-hold override did not settle into manual pause.');
  assert(getTimeControlsSnapshot(controls, 4000).autoProtection === null, 'Manual step retained auto protection.');

  const majorControls = createTimeControls(config, 20);
  assert(
    observeStoryFocus(majorControls, { eventId: 'evt:major', importance: 'major' }, 0) === false,
    'Major focus incorrectly crossed the default protection threshold.',
  );
}

// Validate operator feedback and keep controller state outside AI observations.
function validatePresentationAndIsolation() {
  const config = loadConfig();
  const runtime = buildRuntime(config.display, { columns: 120, rows: 40 });
  const state = createInitialState(config, runtime);
  const observationBefore = JSON.stringify(buildObservation(state, config));
  const controls = createTimeControls(config, 20);
  observeStoryFocus(controls, { eventId: 'evt:visible', importance: 'critical' }, 1000);
  const snapshot = getTimeControlsSnapshot(controls, 1000);
  const snapshotBefore = JSON.stringify(snapshot);
  const frame = stripAnsi(renderFrame(state, config, runtime, { timeControls: snapshot }));
  assert(frame.includes('AUTO:0.5x'), 'Ops Snapshot did not expose active auto-slow status.');
  assert(frame.includes('[−][+]') && frame.includes('.›'), 'Ops Snapshot omitted speed/step control hints.');
  assert(JSON.stringify(snapshot) === snapshotBefore, 'Renderer mutated the time-control snapshot.');
  assert(
    JSON.stringify(buildObservation(state, config)) === observationBefore,
    'Presentation timing changed the PPO observation contract.',
  );

  for (const columns of [120, 90, 72]) {
    const sizedRuntime = buildRuntime(config.display, { columns, rows: 40 });
    const sizedState = createInitialState(config, sizedRuntime);
    const sizedFrame = stripAnsi(renderFrame(sizedState, config, sizedRuntime, { timeControls: snapshot }));
    assert(sizedFrame.includes('AUTO:0.5x'), `Auto-slow status disappeared at ${columns} columns.`);
  }

  const holdFrame = stripAnsi(renderFrame(state, config, runtime, {
    timeControls: {
      ...snapshot,
      paused: true,
      pauseReason: 'auto',
      autoProtection: { eventId: 'evt:hold', importance: 'legendary', mode: 'hold', remainingMs: 2000 },
    },
  }));
  assert(holdFrame.includes('HOLD'), 'Ops Snapshot did not expose legendary auto-hold status.');
  const pausedFrame = stripAnsi(renderFrame(state, config, runtime, {
    timeControls: { ...snapshot, paused: true, pauseReason: 'manual', autoProtection: null },
  }));
  assert(pausedFrame.includes('PAUSE'), 'Ops Snapshot did not expose manual pause status.');

  const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert(appSource.includes('consumeSimulationAdvance(timeControls'), 'Terminal loop bypasses time controls.');
  assert(appSource.includes('getSimulationTicksPerFrame(timeControls'), 'Terminal loop bypasses batched speed levels.');
  assert(appSource.includes("char === '['") && appSource.includes("char === ']'") && appSource.includes("char === '.'"), 'Terminal input wiring is incomplete.');
  assert(!/\blet paused\b/.test(appSource), 'Legacy pause state still competes with the controller.');

  for (const relativePath of ['ai_server.js', 'scripts/headless_benchmark.js']) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
    assert(!source.includes('runtime/time_controls'), `${relativePath} imports presentation timing.`);
  }
}

// Execute the dedicated E4.3 runtime-control gate.
function main() {
  if (process.argv.length > 2) throw new Error('Usage: node scripts/test_time_controls.js');
  validateTimeControlConfig();
  validateManualControlFlow();
  validateAutomaticProtectionFlow();
  validatePresentationAndIsolation();
  console.log('[test:time-controls] PASS config levels pause speed step critical_slow legendary_hold expiry manual_override inset_status ai_isolation headless_isolation');
}

main();
