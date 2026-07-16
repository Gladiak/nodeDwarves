#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../src/config');
const { buildRuntime } = require('../src/runtime');
const { createInitialState } = require('../src/state');
const { buildObservation } = require('../src/ai/observation');
const {
  pushEvent,
  normalizeEventLogEntry,
  isDramaEventCategory,
} = require('../src/simulation/events');
const {
  MAX_SERIALIZED_EVENT_BYTES,
  buildNarrativeEventId,
  peekNarrativeEventIdentity,
  commitNarrativeEventIdentity,
  validateNarrativeEvent,
  assertNarrativeEvent,
} = require('../src/simulation/narrative_contract');
const { buildEventLogPanel } = require('../src/render/event_log_panel');

const ROOT = path.resolve(__dirname, '..');

// Fail fast with an explicit narrative-contract diagnostic.
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Clone one plain fixture without sharing nested references.
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// Build one complete canonical v1 fixture.
function buildValidEvent(overrides = {}) {
  const cycle = Object.prototype.hasOwnProperty.call(overrides, 'cycle') ? overrides.cycle : 0;
  const tick = Object.prototype.hasOwnProperty.call(overrides, 'tick') ? overrides.tick : 963;
  const sequence = Object.prototype.hasOwnProperty.call(overrides, 'sequence') ? overrides.sequence : 2;
  const base = {
    schemaVersion: 1,
    id: buildNarrativeEventId(cycle, tick, sequence),
    cycle,
    tick,
    sequence,
    type: 'lifecycle.birth',
    category: 'lifecycle',
    importance: 'notable',
    message: 'Birth: Dori Ironhand joins the settlement',
    actors: [
      {
        kind: 'dwarf',
        id: 'dwarf_1042',
        role: 'primary',
        label: 'Dori Ironhand',
      },
    ],
    location: {
      scope: 'surface',
      depth: 0,
      x: 42,
      y: 17,
      placeId: null,
      label: null,
    },
    causes: [
      {
        kind: 'state',
        ref: 'population.reproduction',
        metric: null,
        value: null,
      },
    ],
    consequences: [
      {
        kind: 'create',
        targetKind: 'dwarf',
        targetId: 'dwarf_1042',
        metric: null,
        value: null,
        unit: null,
      },
    ],
    sagaId: null,
    source: 'population',
    tags: ['birth'],
  };
  return { ...base, ...overrides };
}

// Require one malformed fixture to fail both result and throwing validator paths.
function assertInvalidEvent(event, label, errorFragment = '') {
  const result = validateNarrativeEvent(event);
  assert(result.valid === false, `${label}: malformed fixture unexpectedly passed.`);
  if (errorFragment) {
    assert(
      result.errors.some((error) => error.includes(errorFragment)),
      `${label}: missing diagnostic fragment ${JSON.stringify(errorFragment)} in ${JSON.stringify(result.errors)}.`,
    );
  }
  let threw = false;
  try {
    assertNarrativeEvent(event);
  } catch (error) {
    threw = true;
    assert(
      String(error.message || '').startsWith('Narrative event contract failed:'),
      `${label}: throwing validator returned an unstable error prefix.`,
    );
  }
  assert(threw, `${label}: assertNarrativeEvent did not reject malformed input.`);
}

// Validate the full canonical envelope and its plain-JSON round trip.
function validateCanonicalEnvelopeContract() {
  const event = buildValidEvent();
  const result = validateNarrativeEvent(event);
  assert(result.valid, `Canonical event fixture failed: ${result.errors.join('; ')}`);
  assert(assertNarrativeEvent(event) === event, 'Canonical event assertion should return the original value.');
  const roundTrip = JSON.parse(JSON.stringify(event));
  assert(
    JSON.stringify(roundTrip) === JSON.stringify(event),
    'Canonical event changed during JSON serialization round trip.',
  );
  assert(
    Buffer.byteLength(JSON.stringify(event), 'utf8') <= MAX_SERIALIZED_EVENT_BYTES,
    'Canonical event exceeds the serialization ceiling.',
  );

  const eventCause = buildValidEvent({
    causes: [{
      kind: 'event',
      ref: 'evt:v1:c0000:t0000000950:s0000',
      metric: null,
      value: null,
    }],
  });
  assert(
    validateNarrativeEvent(eventCause).valid,
    'Event-kind cause did not accept the normative colon-delimited event ID.',
  );
}

// Validate required fields, closed enums, identity coherence, and normalized strings.
function validateMalformedEnvelopeContract() {
  const missingMessage = buildValidEvent();
  delete missingMessage.message;
  assertInvalidEvent(missingMessage, 'missing message', 'event.message');

  const invalidCategory = buildValidEvent({ category: 'politics' });
  assertInvalidEvent(invalidCategory, 'invalid category', 'event.category');

  const invalidImportance = buildValidEvent({ importance: 'urgent' });
  assertInvalidEvent(invalidImportance, 'invalid importance', 'event.importance');

  const invalidType = buildValidEvent({ type: 'Lifecycle Birth' });
  assertInvalidEvent(invalidType, 'invalid type', 'event.type');

  const mismatchedId = buildValidEvent({ id: 'evt:v1:c0000:t0000000963:s0003' });
  assertInvalidEvent(mismatchedId, 'mismatched id', 'event.id');

  const controlMessage = buildValidEvent({ message: 'Birth:\nDori' });
  assertInvalidEvent(controlMessage, 'control character', 'event.message');

  const unknownField = buildValidEvent({ metadata: { state: 'forbidden' } });
  assertInvalidEvent(unknownField, 'unknown top-level field', 'event.metadata');
}

// Validate bounded nested references and rejection of live/unbounded state.
function validateBoundedReferenceContract() {
  const actorOverflow = buildValidEvent({
    actors: Array.from({ length: 9 }, (_, index) => ({
      kind: 'dwarf',
      id: `dwarf_${index}`,
      role: index === 0 ? 'primary' : 'secondary',
      label: `Dwarf ${index}`,
    })),
  });
  assertInvalidEvent(actorOverflow, 'actor overflow', 'maximum length is 8');

  const duplicateTags = buildValidEvent({ tags: ['birth', 'birth'] });
  assertInvalidEvent(duplicateTags, 'duplicate tags', 'sorted and unique');

  const unsortedTags = buildValidEvent({ tags: ['lifecycle', 'birth'] });
  assertInvalidEvent(unsortedTags, 'unsorted tags', 'sorted and unique');

  const partialCoordinates = buildValidEvent({
    location: {
      scope: 'surface',
      depth: 0,
      x: 4,
      y: null,
      placeId: null,
      label: null,
    },
  });
  assertInvalidEvent(partialCoordinates, 'partial coordinates', 'complete non-negative integer pair');

  const nestedObjectValue = buildValidEvent({
    consequences: [{
      kind: 'delta',
      targetKind: 'resource',
      targetId: 'stockpile.food',
      metric: 'amount',
      value: { amount: -12 },
      unit: 'units',
    }],
  });
  assertInvalidEvent(nestedObjectValue, 'nested consequence object', 'expected normalized scalar string');

  const circular = buildValidEvent();
  circular.actors[0].liveState = circular;
  assertInvalidEvent(circular, 'circular live state', 'circular reference');

  const oversized = buildValidEvent({ message: 'x'.repeat(MAX_SERIALIZED_EVENT_BYTES + 1) });
  assertInvalidEvent(oversized, 'oversized event', 'serialized payload exceeds');

  const utf8Overflow = buildValidEvent({ message: String.fromCodePoint(0x1FAA8).repeat(129) });
  assertInvalidEvent(utf8Overflow, 'UTF-8 byte overflow', 'event.message');
}

// Produce one deterministic identity sequence from a list of state positions.
function produceIdentitySequence(positions) {
  const clock = { tick: -1, nextSequence: 0 };
  const ids = [];
  for (const position of positions) {
    const state = {
      tick: position.tick,
      cycleStats: { count: position.cycle },
    };
    const identity = peekNarrativeEventIdentity(state, clock);
    ids.push(identity.id);
    commitNarrativeEventIdentity(clock, identity);
  }
  return ids;
}

// Validate seeded-order identity stability, rejection semantics, and cycle separation.
function validateDeterministicIdentityContract() {
  const positions = [
    { cycle: 0, tick: 81 },
    { cycle: 0, tick: 81 },
    { cycle: 0, tick: 82 },
    { cycle: 1, tick: 0 },
  ];
  const firstRun = produceIdentitySequence(positions);
  const secondRun = produceIdentitySequence(positions);
  assert(JSON.stringify(firstRun) === JSON.stringify(secondRun), 'Equal event order produced different IDs.');
  assert(firstRun[0] === 'evt:v1:c0000:t0000000081:s0000', 'First deterministic ID mismatch.');
  assert(firstRun[1] === 'evt:v1:c0000:t0000000081:s0001', 'Same-tick sequence did not increment.');
  assert(firstRun[2] === 'evt:v1:c0000:t0000000082:s0000', 'New tick did not reset sequence.');
  assert(firstRun[3] === 'evt:v1:c0001:t0000000000:s0000', 'Cycle reset ID mismatch.');
  assert(new Set(firstRun).size === firstRun.length, 'Deterministic identity sequence collided.');

  const clock = { tick: -1, nextSequence: 0 };
  const state = { tick: 90, cycleStats: { count: 2 } };
  const rejectedCandidate = peekNarrativeEventIdentity(state, clock);
  const nextCandidate = peekNarrativeEventIdentity(state, clock);
  assert(
    rejectedCandidate.id === nextCandidate.id,
    'Uncommitted/rejected candidate consumed an event sequence.',
  );
  commitNarrativeEventIdentity(clock, nextCandidate);
  assert(
    peekNarrativeEventIdentity(state, clock).sequence === 1,
    'Committed candidate did not advance event sequence.',
  );

  let invalidFailed = false;
  try {
    buildNarrativeEventId(0, 0, -1);
  } catch (error) {
    invalidFailed = true;
  }
  assert(invalidFailed, 'Negative identity counter did not fail.');
}

// Validate existing string callers, inferred categories, retention limits, and RNG neutrality.
function validateLegacyCompatibilityContract() {
  const config = { events: { maxEntries: 2, logMaxEntries: 2 } };
  const state = { tick: 41, events: [], eventLog: [] };
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error('Legacy pushEvent consumed Math.random.');
  };
  try {
    pushEvent(state, config, 'Birth: dwarf_1042 joined the settlement');
    pushEvent(state, config, 'Weather: stone rain');
    pushEvent(state, config, 'Build: workshop completed', { category: 'economy', source: 'structures' });
  } finally {
    Math.random = originalRandom;
  }

  assert(state.events.length === 2, 'HUD mini-log exceeded maxEntries.');
  assert(state.eventLog.length === 2, 'Event Log exceeded logMaxEntries.');
  assert(state.events[0] === 'Build: workshop completed', 'HUD mini-log ordering changed.');
  assert(state.eventLog[0].category === 'economy', 'Explicit legacy category was not preserved.');
  assert(state.eventLog[0].source === 'structures', 'Explicit legacy source was not preserved.');
  assert(state.eventLog[1].category === 'world', 'Legacy message category inference changed.');

  const inferredBirth = normalizeEventLogEntry({ tick: 41, message: 'Birth: dwarf_1042 arrived' });
  assert(inferredBirth.category === 'lifecycle', 'Birth prefix no longer infers lifecycle category.');
  assert(isDramaEventCategory(inferredBirth.category), 'Lifecycle category left the drama filter.');

  const projectedLegacy = buildValidEvent({
    id: buildNarrativeEventId(0, 41, 0),
    cycle: 0,
    tick: 41,
    sequence: 0,
    type: 'legacy.lifecycle',
    message: inferredBirth.message,
    actors: [],
    location: {
      scope: 'world',
      depth: null,
      x: null,
      y: null,
      placeId: null,
      label: null,
    },
    causes: [],
    consequences: [],
    source: inferredBirth.source,
    tags: [],
  });
  assert(
    validateNarrativeEvent(projectedLegacy).valid,
    'Normative legacy.* projection is not a valid canonical v1 event.',
  );

  const disabled = { tick: 4, events: [], eventLog: [] };
  pushEvent(disabled, { events: { maxEntries: 0, logMaxEntries: 0 } }, 'Weather: quiet');
  assert(disabled.events.length === 0, 'maxEntries=0 did not disable HUD retention.');
  assert(!Array.isArray(disabled.eventLog) || disabled.eventLog.length === 0, 'logMaxEntries=0 did not disable Event Log retention.');
}

// Validate that event changes remain outside the AI observation contract.
function validateAiObservationIsolationContract() {
  const config = loadConfig();
  const runtime = buildRuntime(config.display, {
    columns: Number(config.display.width || 120),
    rows: Number(config.display.height || 40),
  });
  const state = createInitialState(config, runtime);
  const before = buildObservation(state, config);
  pushEvent(state, config, 'Weather: narrative contract observation isolation');
  const after = buildObservation(state, config);
  assert(
    JSON.stringify(after) === JSON.stringify(before),
    'Event buffers changed the AI observation payload.',
  );
}

// Validate v0/v1 Event Log rendering and drama filtering without mutating stored records.
function validateEventLogRenderingContract() {
  const v1Drama = buildValidEvent({ tick: 51, sequence: 0, id: buildNarrativeEventId(0, 51, 0) });
  const v0World = {
    tick: 50,
    message: 'Weather: basalt rain crosses the valley',
    category: 'world',
    source: 'weather',
  };
  const state = {
    tick: 51,
    eventLog: [v1Drama, v0World],
    events: [],
    ui: {
      eventLog: {
        open: true,
        offset: 0,
        filter: 'drama',
      },
    },
  };
  const before = JSON.stringify(state.eventLog);
  const panel = buildEventLogPanel(state, {
    display: { event_log_panel: { enabled: true, width: 100, height: 24 } },
  }, {
    gridWidth: 110,
    gridHeight: 30,
  });
  assert(panel && Array.isArray(panel.lines), 'Event Log panel did not render mixed v0/v1 entries.');
  const text = panel.lines.map((line) => String(line.text || '')).join('\n');
  assert(text.includes('Birth: Dori Ironhand'), 'Drama filter did not render the v1 lifecycle event.');
  assert(!text.includes('basalt rain'), 'Drama filter leaked the v0 world event.');
  assert(JSON.stringify(state.eventLog) === before, 'Event Log renderer mutated retained records.');

  state.ui.eventLog.filter = 'all';
  const allPanel = buildEventLogPanel(state, {
    display: { event_log_panel: { enabled: true, width: 100, height: 24 } },
  }, {
    gridWidth: 110,
    gridHeight: 30,
  });
  const allText = allPanel.lines.map((line) => String(line.text || '')).join('\n');
  assert(allText.includes('basalt rain'), 'All-events filter did not render the v0 record.');
}

// Guard the intentionally event-free map-export snapshot schema until an explicit decision changes it.
function validateMapExportIsolationContract() {
  const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const start = appSource.indexOf('function buildMapExportSnapshot(state)');
  const end = appSource.indexOf('// Function: writeMapExportSnapshot.', start);
  assert(start >= 0 && end > start, 'Could not locate buildMapExportSnapshot for schema guard.');
  const snapshotSource = appSource.slice(start, end);
  assert(
    snapshotSource.includes('return { structures, roads, temple, underrealm };'),
    'Map-export snapshot key set changed; review the narrative isolation decision.',
  );
  assert(!snapshotSource.includes('eventLog'), 'Map-export snapshot unexpectedly includes eventLog.');
  assert(!snapshotSource.includes('state.events'), 'Map-export snapshot unexpectedly includes HUD events.');
}

// Execute every narrative-contract lane in deterministic order.
function main() {
  if (process.argv.length > 2) {
    throw new Error('Usage: node scripts/test_narrative_contracts.js');
  }
  validateCanonicalEnvelopeContract();
  validateMalformedEnvelopeContract();
  validateBoundedReferenceContract();
  validateDeterministicIdentityContract();
  validateLegacyCompatibilityContract();
  validateAiObservationIsolationContract();
  validateEventLogRenderingContract();
  validateMapExportIsolationContract();
  console.log('[test:narrative] PASS envelope malformed identity legacy retention bounds serialization renderer ai_isolation export_isolation');
}

main();
