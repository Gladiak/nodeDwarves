#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const baseConfig = require('../config.json');
const { createInitialState } = require('../src/state');
const { buildObservation } = require('../src/ai/observation');
const { buildNarrativeEventId } = require('../src/simulation/narrative_contract');
const { createStoryDirectorState, processStoryDirectorEvent, advanceStoryDirector,
  ensureStoryDirectorState } = require('../src/simulation/story_director');
const { emitSchismPhaseShifted, emitSchismRitualChanged,
  emitSchismClimaxChanged } = require('../src/simulation/political_events');
const { createRefinementTracker, getRefinementReport } = require('../src/telemetry/refinement');
const clone = (value) => JSON.parse(JSON.stringify(value));

// Build a complete canonical fixture without inventing production state transitions.
function buildValidEvent(overrides) {
  const tick = overrides.tick;
  return { schemaVersion: 1, cycle: 0, tick, sequence: 0,
    id: buildNarrativeEventId(0, tick, 0), type: 'world.fixture_started', category: 'world',
    importance: 'major', message: 'A witnessed saga fact.', actors: [], causes: [],
    consequences: [], tags: [], sagaId: null, source: 'saga_refinement_contract',
    location: { scope: 'world', depth: null, x: null, y: null, placeId: null, label: null },
    ...overrides };
}

// Verify cause-level diagnostics remain bounded, factual, deterministic, and RNG-free.
function validateSagaRefinementDiagnosticContract() {
  const config = clone(baseConfig);
  config.story_director.sagas.max_entries = 2;
  config.story_director.sagas.inactivity_timeout_ticks = 3;
  config.story_director.sagas.archive_timeout_ticks = 6;
  config.story_director.sagas.unresolved_archive_grace_ticks = 0;
  config.story_director.sagas.lifecycle.terminal_retention_ticks = 0;
  const state = { tick: 0, dwarves: [], stockpile: {}, story: createStoryDirectorState(config) };
  const tracker = createRefinementTracker(state, config);
  const emit = (tick, overrides = {}) => {
    state.tick = tick;
    const event = buildValidEvent({ tick, sequence: 0, category: 'world',
      type: 'world.fixture_started', importance: 'critical', actors: [], causes: [],
      consequences: [], tags: [],
      location: { scope: 'world', depth: null, x: null, y: null, placeId: null, label: null },
      ...overrides });
    processStoryDirectorEvent(state, config, event);
    return event;
  };
  const actor = { kind: 'dwarf', id: 'diagnostic_actor', role: 'primary', label: 'Diagnostic Actor' };
  const location = { scope: 'surface', depth: 0, x: 4, y: 5, placeId: 'diagnostic_forge', label: 'Forge' };
  const originalRandom = Math.random;
  Math.random = () => { throw new Error('Saga diagnostics consumed gameplay RNG.'); };
  try {
    const opening = emit(1, { actors: [actor], location });
    const actorMatch = emit(2, { actors: [actor] });
    assert(actorMatch.sagaId === opening.sagaId, 'Diagnostic actor match lost ownership.');
    const placeMatch = emit(3, { location });
    assert(placeMatch.sagaId === opening.sagaId, 'Diagnostic place match lost ownership.');
    emit(4, { type: 'world.fixture_completed', causes: [{ kind: 'event', ref: opening.id,
      metric: null, value: null }] });
    state.tick = 20;
    advanceStoryDirector(state, config);
    for (let index = 0; index < 300; index += 1) {
      const event = emit(21 + index, { type: `world.flood_${index}` });
      assert(event.sagaId, 'Priority event lost saga ownership during capacity pressure.');
    }
    emit(321, { importance: 'ambient', type: 'world.low_value' });
    const report = getRefinementReport(state, tracker, 1).narrative;
    const diagnostics = report.diagnostics;
    assert(report.merged === 0 && report.priorityOwnership === 1, 'Saga merge/ownership counters are ambiguous.');
    assert(diagnostics.matchesByPath.actor >= 1 && diagnostics.matchesByPath.place >= 1
      && diagnostics.matchesByPath.parent_cause >= 1, 'Saga match paths were not reported.');
    assert(diagnostics.exitsByReasonAndStatus['age_timeout:resolved'] === 1,
      'Inactivity archive lost its previous terminal state.');
    assert(diagnostics.exitsByReasonAndStatus['capacity:active'] > 0,
      'Capacity eviction lost its pre-eviction state.');
    assert(Object.keys(diagnostics.openingsByType).length <= 256, 'Diagnostic type map is unbounded.');
    assert(Object.values(diagnostics.openingsByType).reduce((sum, value) => sum + value, 0)
      === report.opened, 'Bounded diagnostic overflow lost opening counts.');
    assert(diagnostics.samples.length <= 8 && diagnostics.samples.every((sample) => sample.timeline.length <= 8),
      'Saga diagnostic timelines are unbounded.');
    assert(diagnostics.samples[0].timeline.every((entry) => entry.eventId && entry.fact),
      'Saga timeline invented a fact without source identity.');
    assert(state.story.sagas.order.length <= 2 && report.skippedEvents === 1,
      'Diagnostics changed saga capacity or low-value opening behavior.');
  } finally { Math.random = originalRandom; }
}

// Exercise family separation, causal closure, retention and dormant grace with tiny fixtures.
function validateBehavior() {
  const config = clone(baseConfig);
  const sagas = config.story_director.sagas;
  sagas.matching.require_family_for_actor = true;
  sagas.max_entries = 2;
  sagas.inactivity_timeout_ticks = 3;
  sagas.archive_timeout_ticks = 6;
  sagas.unresolved_archive_grace_ticks = 3;
  sagas.lifecycle.terminal_retention_ticks = 12;
  const state = { tick: 0, dwarves: [], stockpile: {}, story: createStoryDirectorState(config) };
  const actor = (id) => ({ kind: 'dwarf', id, label: id, role: 'primary' });
  const emit = (tick, type, id) => {
    state.tick = tick;
    const event = buildValidEvent({ tick, type, actors: [actor(id)] });
    processStoryDirectorEvent(state, config, event);
    return event;
  };
  const social = emit(1, 'social.grudge_escalation', 'a');
  const combat = emit(2, 'combat.deep_raid_started', 'a');
  assert.notEqual(social.sagaId, combat.sagaId, 'one shared actor must not merge unrelated families');
  const reconciled = emit(3, 'social.reconciliation', 'a');
  assert.equal(reconciled.sagaId, social.sagaId);
  assert.equal(state.story.sagas.byId[social.sagaId].status, 'resolved');
  emit(4, 'world.another_started', 'b');
  assert(state.story.sagas.byId[social.sagaId], 'recent authoritative terminal survives capacity pressure');
  const dormant = { tick: 0, dwarves: [], stockpile: {}, story: createStoryDirectorState(config) };
  for (let tick = 1; tick <= 2; tick += 1) {
    dormant.tick = tick;
    processStoryDirectorEvent(dormant, config, buildValidEvent({ tick,
      actors: [actor('unresolved')], type: 'world.unresolved_beat' }));
  }
  const id = dormant.story.sagas.order[0];
  dormant.tick = 8; advanceStoryDirector(dormant, config);
  assert.equal(dormant.story.sagas.byId[id].status, 'dormant');
  dormant.tick = 11; advanceStoryDirector(dormant, config);
  assert.equal(dormant.story.sagas.byId[id].status, 'archived');
}

// A local ritual expiry cannot close the whole political arc or erase its real outcome.
function validatePoliticalArc() {
  const config = clone(baseConfig);
  config.story_director.sagas.group_political_arc = true;
  const originalRandom = Math.random;
  let seed = 202;
  Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  try {
    config.display.terrain.seed = 202;
    const state = createInitialState(config, { gridWidth: 60, gridHeight: 30, playableArea: 1800 });
    const before = buildObservation(state, config);
    const schism = { pressure: 0.5, legitimacy: 0.4, doctrine: 'austerity' };
    state.tick = 1;
    const opening = emitSchismPhaseShifted(state, config, schism,
      { phase: 'murmurs', previousPhase: 'concord', message: 'Schism phase: murmurs rise.' });
    state.tick = 2;
    const expiry = emitSchismRitualChanged(state, config, schism, 'expired',
      { id: 'quiet_rite' }, 'A local ritual expires.');
    assert.equal(opening.sagaId, 'saga_schism_c0');
    assert.equal(expiry.sagaId, opening.sagaId);
    assert.notEqual(state.story.sagas.byId[opening.sagaId].status, 'failed');
    state.tick = 3;
    const ending = emitSchismClimaxChanged(state, config, schism, 'resolved',
      { message: 'The council resolves the witnessed climax.', pressureDrop: 0.1, legitimacyGain: 0.1 });
    state.tick = 4;
    emitSchismPhaseShifted(state, config, schism,
      { phase: 'concord', previousPhase: 'murmurs', message: 'Schism phase: concord returns.' });
    let saga = state.story.sagas.byId[opening.sagaId];
    assert.equal(saga.status, 'resolved');
    assert.equal(saga.resolutionEventId, ending.id);
    assert.equal(saga.resolutionSummary, ending.message);
    assert.equal(saga.summary, ending.message);
    const restored = clone(state.story);
    state.story = restored;
    ensureStoryDirectorState(state, config);
    saga = state.story.sagas.byId[opening.sagaId];
    assert.equal(saga.resolutionSummary, ending.message);
    // Tick is an existing observation channel; hold it fixed for the narrative-only comparison.
    state.tick = 0;
    assert.deepEqual(buildObservation(state, config), before);
  } finally { Math.random = originalRandom; }
}

validateSagaRefinementDiagnosticContract();
validateBehavior();
validatePoliticalArc();
process.stdout.write('saga-refinement contracts: PASS diagnostics family political_outcome retention grace serialization bounds RNG observation\n');
