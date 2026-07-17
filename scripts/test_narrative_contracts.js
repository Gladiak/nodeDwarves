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
  reduceNarrativeEventToLimit,
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
const {
  handleDeaths,
  updateRelationships,
  handleReproduction,
} = require('../src/simulation/population');
const { ensureSettlementFoundingEvent } = require('../src/simulation/lifecycle_events');
const { emitSocialIncidentEvent } = require('../src/simulation/social_events');
const { updateSocialDrama } = require('../src/simulation/social_drama');
const {
  emitSurfaceRaidStarted,
  emitSurfaceRaidResolved,
  emitRuinsExpeditionStarted,
  emitRuinsExpeditionResolved,
  emitUnderrealmChampionEncounter,
  emitDwarfChampionChanged,
  emitDeepRaidEvent,
} = require('../src/simulation/combat_events');
const { updateRaidTick } = require('../src/simulation/raids');
const {
  emitWarriorMarkChanged,
  emitWarriorRetired,
  emitWarriorUnderrealmCommandChanged,
  emitWarriorHeroCommandTaken,
  emitWarriorTournamentInjury,
  emitWarriorTournamentDeath,
  emitWarriorTournamentCrowned,
} = require('../src/simulation/warrior_events');
const { updateWarriors } = require('../src/simulation/warriors');
const {
  emitSchismDoctrineShifted,
  emitSchismPhaseShifted,
  emitSchismRitualWindowOpened,
  emitSchismCouncilRitualLit,
  emitSchismRitualChanged,
  emitSchismDecreeProposed,
  emitSchismDecreeChanged,
  emitSchismClimaxChanged,
} = require('../src/simulation/political_events');
const { updateSchism, notifySchismFestivalStarted } = require('../src/simulation/schism');
const {
  emitEndgameArtifactRecovered,
  emitEndgameArtifactCollectionCompleted,
  emitEndgameTransitionStarted,
  emitEndgameCycleClosed,
  emitEndgameWarriorCompanyCarriedOver,
  emitEndgameTransitionCompleted,
} = require('../src/simulation/endgame_events');
const {
  shouldTriggerEndgameReset,
  runEndgameReset,
} = require('../src/simulation/endgame');
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

// Validate actual structured pushEvent output, normalization, config defaults, and return semantics.
function validateStructuredEmitterContract() {
  const config = loadConfig();
  const state = {
    tick: 73,
    cycleStats: { count: 2 },
    events: [],
    eventLog: [],
  };
  const emitted = pushEvent(state, config, {
    schemaVersion: 99,
    id: 'producer_must_not_control_identity',
    cycle: 99,
    tick: 99,
    sequence: 99,
    type: 'Lifecycle.Birth',
    category: 'LIFECYCLE',
    message: '  Birth:\nDori Ironhand joins   the settlement  ',
    actors: [
      { kind: 'Dwarf', id: 'DWARF_1042', role: 'Primary', label: ' Dori Ironhand ' },
      { kind: 'dwarf', id: 'dwarf_1042', role: 'primary', label: 'Duplicate' },
      { kind: 'dwarf', id: { live: true }, role: 'secondary' },
    ],
    location: {
      scope: 'surface',
      depth: 9,
      x: 42,
      y: 17,
      placeId: 'EAST_GATE',
      label: ' East Gate ',
    },
    causes: [
      { kind: 'state', ref: 'POPULATION.REPRODUCTION', metric: null, value: null },
      { kind: 'state', ref: { live: true }, metric: null, value: null },
    ],
    consequences: [
      {
        kind: 'create',
        targetKind: 'dwarf',
        targetId: 'DWARF_1042',
        metric: null,
        value: null,
        unit: null,
      },
    ],
    sagaId: 'FOUNDING_SAGA',
    source: 'POPULATION',
    tags: ['Birth', 'lifecycle', 'birth', 'invalid tag'],
  });

  assert(emitted && emitted.schemaVersion === 1, 'Structured pushEvent did not return schema v1.');
  assert(
    emitted.id === 'evt:v1:c0002:t0000000073:s0000',
    'Structured pushEvent did not replace producer-controlled identity.',
  );
  assert(emitted.type === 'lifecycle.birth', 'Structured event type normalization failed.');
  assert(emitted.category === 'lifecycle', 'Structured event category normalization failed.');
  assert(emitted.importance === 'notable', 'Config category importance fallback failed.');
  assert(
    emitted.message === 'Birth: Dori Ironhand joins the settlement',
    'Structured message normalization failed.',
  );
  assert(emitted.actors.length === 1, 'Actor normalization/deduplication failed.');
  assert(emitted.actors[0].id === 'dwarf_1042', 'Actor ID normalization failed.');
  assert(emitted.location.depth === 0, 'Surface location did not force depth 0.');
  assert(emitted.location.x === 42 && emitted.location.y === 17, 'Location coordinate normalization failed.');
  assert(emitted.location.placeId === 'east_gate', 'Location place ID normalization failed.');
  assert(emitted.causes.length === 1, 'Invalid cause reference was not discarded.');
  assert(emitted.consequences.length === 1, 'Structured consequence normalization failed.');
  assert(emitted.sagaId === 'founding_saga', 'Saga ID normalization failed.');
  assert(emitted.source === 'population', 'Source normalization failed.');
  assert(JSON.stringify(emitted.tags) === JSON.stringify(['birth', 'lifecycle']), 'Tag normalization failed.');
  assert(validateNarrativeEvent(emitted).valid, 'Structured pushEvent returned a non-canonical event.');
  assert(state.eventLog[0] === emitted, 'Structured event was not retained as the returned canonical object.');
  assert(state.events[0] === emitted.message, 'Structured event did not preserve HUD message compatibility.');
  assert(state.eventStats.accepted === 1, 'Structured event accepted diagnostic mismatch.');
  assert(state.eventStats.legacyNormalized === 0, 'Structured event was counted as legacy.');

  const typeOverride = pushEvent(state, {
    events: {
      maxEntries: 5,
      logMaxEntries: 5,
      importance: {
        default: 'ambient',
        by_category: { lifecycle: 'notable' },
        by_type: { 'lifecycle.birth': 'legendary' },
      },
    },
  }, {
    type: 'lifecycle.birth',
    category: 'lifecycle',
    message: 'Birth: a type override is forged',
    source: 'population',
  });
  assert(typeOverride.importance === 'legendary', 'Type importance did not override category default.');

  const explicitImportance = pushEvent(state, config, {
    type: 'world.weather',
    category: 'world',
    importance: 'critical',
    message: 'Weather: the ash sky breaks',
    source: 'weather',
  });
  assert(explicitImportance.importance === 'critical', 'Explicit valid importance was not preserved.');

  const ambiguous = pushEvent(state, config, {
    type: 'world.weather',
    message: 'Weather: ambiguous object form',
  }, { category: 'world' });
  assert(ambiguous === null, 'Object form combined with details was not rejected.');
  assert(state.eventStats.rejected === 1, 'Rejected structured draft diagnostic mismatch.');
}

// Validate runtime sequence transactions, collision diagnostics, and zero-retention return behavior.
function validateEmitterIdentityAndCollisionContract() {
  const config = {
    events: {
      maxEntries: 2,
      logMaxEntries: 2,
      importance: { default: 'ambient', by_category: {}, by_type: {} },
    },
  };
  const createState = () => ({
    tick: 12,
    cycleStats: { count: 0 },
    events: [],
    eventLog: [],
  });
  const run = () => {
    const state = createState();
    const first = pushEvent(state, config, 'Birth: first event');
    const rejected = pushEvent(state, config, '   ');
    const second = pushEvent(state, config, 'Weather: second event');
    state.tick = 13;
    const third = pushEvent(state, config, 'Build: third event');
    return { state, first, rejected, second, third };
  };
  const left = run();
  const right = run();
  const leftIds = [left.first.id, left.second.id, left.third.id];
  const rightIds = [right.first.id, right.second.id, right.third.id];
  assert(JSON.stringify(leftIds) === JSON.stringify(rightIds), 'Actual pushEvent order produced unstable IDs.');
  assert(left.rejected === null, 'Empty runtime draft was not rejected.');
  assert(left.first.sequence === 0 && left.second.sequence === 1, 'Rejected draft consumed a same-tick sequence.');
  assert(left.third.sequence === 0, 'Actual event sequence did not reset on the next tick.');
  assert(left.state.eventLog.length === 2, 'Structured Event Log retention cap failed.');
  assert(left.state.eventClock.nextSequence === 1, 'Event clock was derived from retained log length.');

  const collisionState = createState();
  collisionState.eventLog.push(buildValidEvent({
    tick: 12,
    sequence: 0,
    id: buildNarrativeEventId(0, 12, 0),
  }));
  const collision = pushEvent(collisionState, config, 'Birth: collision candidate');
  assert(collision === null, 'Retained duplicate event ID was not rejected.');
  assert(collisionState.eventStats.collisions === 1, 'Collision diagnostic was not incremented.');
  assert(collisionState.eventStats.rejected === 1, 'Collision rejection diagnostic was not incremented.');
  assert(collisionState.eventClock.nextSequence === 0, 'Collision consumed the event sequence.');
  assert(collisionState.events.length === 0, 'Collision leaked into the HUD mini-log.');

  const noRetention = createState();
  const returned = pushEvent(noRetention, {
    events: {
      maxEntries: 0,
      logMaxEntries: 0,
      importance: { default: 'ambient', by_category: {}, by_type: {} },
    },
  }, 'Weather: returned without retention');
  assert(returned && returned.schemaVersion === 1, 'Zero-retention pushEvent did not return a canonical event.');
  assert(noRetention.events.length === 0 && noRetention.eventLog.length === 0, 'Zero-retention stores were not empty.');
  assert(noRetention.eventStats.accepted === 1, 'Zero-retention accepted diagnostic mismatch.');
}

// Validate deterministic optional-data reduction and its reserved provenance tag.
function validateRuntimeSerializationReductionContract() {
  const event = buildValidEvent();
  const reducedFixture = clone(event);
  delete reducedFixture.actors[0].label;
  reducedFixture.tags = ['birth', 'contract_truncated'];
  const targetBytes = Buffer.byteLength(JSON.stringify(reducedFixture), 'utf8');
  const result = reduceNarrativeEventToLimit(event, targetBytes);
  assert(result.truncated === true && result.event, 'Optional-data reduction did not report truncation.');
  assert(!Object.prototype.hasOwnProperty.call(result.event.actors[0], 'label'), 'Actor label was not removed first.');
  assert(result.event.tags.includes('contract_truncated'), 'Truncated event lacks the reserved tag.');
  assert(
    Buffer.byteLength(JSON.stringify(result.event), 'utf8') <= targetBytes,
    'Reduced event exceeds its deterministic byte ceiling.',
  );
  assert(validateNarrativeEvent(result.event).valid, 'Reduced event is not canonical after optional-data removal.');
}

// Build one real initial state for lifecycle producer integration fixtures.
function buildLifecycleFixture() {
  const config = loadConfig();
  const runtime = buildRuntime(config.display, {
    columns: Number(config.display.width || 120),
    rows: Number(config.display.height || 40),
  });
  const state = createInitialState(config, runtime);
  return { config, runtime, state };
}

// Validate the once-per-cycle structured settlement-founding event.
function validateLifecycleFoundingContract() {
  const { config, state } = buildLifecycleFixture();
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error('Founding event consumed Math.random.');
  };
  let event = null;
  try {
    event = ensureSettlementFoundingEvent(state, config);
  } finally {
    Math.random = originalRandom;
  }
  assert(event && event.type === 'lifecycle.settlement_founded', 'Settlement founding event type mismatch.');
  assert(event.tick === 0 && event.sequence === 0, 'Founding event identity should anchor cycle tick 0.');
  assert(event.importance === 'major', 'Settlement founding importance config mismatch.');
  assert(event.actors[0].kind === 'settlement', 'Founding event lacks primary settlement actor.');
  assert(event.actors.length === 8, 'Founding actor list did not respect the eight-reference cap.');
  assert(event.causes[0].metric === 'founder_count', 'Founding event lacks founder-count evidence.');
  assert(event.consequences[0].kind === 'create', 'Founding event lacks settlement creation consequence.');
  assert(validateNarrativeEvent(event).valid, 'Founding producer emitted a malformed event.');
  assert(state.lifecycle.foundingEmitted === true, 'Founding state flag was not committed.');
  assert(ensureSettlementFoundingEvent(state, config) === null, 'Founding event emitted more than once per cycle.');

  state.cycleStats.count = 4;
  state.lifecycle.foundingEmitted = false;
  state.events = [];
  state.eventLog = [];
  state.eventClock = { tick: -1, nextSequence: 0 };
  const nextCycleEvent = ensureSettlementFoundingEvent(state, config);
  assert(nextCycleEvent.cycle === 4, 'Founding event did not use the installed cycle counter.');
  assert(
    nextCycleEvent.id === 'evt:v1:c0004:t0000000000:s0000',
    'Next-cycle founding event identity mismatch.',
  );
}

// Validate a real due-pregnancy birth through the population producer.
function validateLifecycleBirthContract() {
  const { config, state } = buildLifecycleFixture();
  state.tick = 100;
  state.eventLog = [];
  state.events = [];
  state.eventClock = { tick: -1, nextSequence: 0 };
  state.eventStats = { accepted: 0, rejected: 0, legacyNormalized: 0, truncated: 0, collisions: 0 };
  const parentA = state.dwarves[0];
  const parentB = state.dwarves[1];
  parentA.pregnancy = { dueTick: state.tick, partnerId: parentB.id };
  config.population.reproduction = {
    ...config.population.reproduction,
    enabled: true,
    baseChance: 0,
    cooldownTicks: 25,
  };
  const beforePopulation = state.dwarves.length;
  const originalRandom = Math.random;
  Math.random = () => 0.25;
  try {
    handleReproduction(state, config);
  } finally {
    Math.random = originalRandom;
  }
  const event = state.eventLog.find((entry) => entry.type === 'lifecycle.birth');
  const newborn = state.dwarves[state.dwarves.length - 1];
  assert(state.dwarves.length === beforePopulation + 1, 'Due pregnancy did not create one newborn.');
  assert(event && event.message === `Birth: ${newborn.id}`, 'Birth producer changed compact message compatibility.');
  assert(event.importance === 'notable', 'Birth importance config mismatch.');
  assert(event.actors[0].id === newborn.id && event.actors[0].role === 'primary', 'Birth event lacks newborn actor.');
  assert(event.actors.filter((actor) => actor.role === 'parent').length === 2, 'Birth event lacks both parents.');
  assert(event.location.scope === 'surface', 'Birth event lacks surface location.');
  assert(event.consequences[0].kind === 'create', 'Birth event lacks dwarf creation consequence.');
  assert(validateNarrativeEvent(event).valid, 'Birth producer emitted a malformed event.');
}

// Validate one starvation death through the natural-death producer.
function validateLifecycleDeathContract() {
  const { config, state } = buildLifecycleFixture();
  state.tick = 200;
  state.eventLog = [];
  state.events = [];
  state.eventClock = { tick: -1, nextSequence: 0 };
  state.eventStats = { accepted: 0, rejected: 0, legacyNormalized: 0, truncated: 0, collisions: 0 };
  config.population.death = {
    ...config.population.death,
    starvationThreshold: 0.9,
    starvationTicks: 1,
    oldAgeChanceMin: 0,
    oldAgeChanceMax: 0,
  };
  config.population.aging = {
    ...config.population.aging,
    oldAgeStart: Number.MAX_SAFE_INTEGER - 1,
    maxAge: Number.MAX_SAFE_INTEGER,
  };
  for (const dwarf of state.dwarves) {
    dwarf.needs.hunger = 0;
    dwarf.needs.thirst = 0;
    dwarf.starvationTicks = 0;
  }
  const victim = state.dwarves[0];
  victim.needs.hunger = 1;
  const victimId = victim.id;
  handleDeaths(state, config);
  const event = state.eventLog.find((entry) => entry.type === 'lifecycle.death');
  assert(!state.dwarves.some((dwarf) => dwarf.id === victimId), 'Starvation victim remained in population.');
  assert(event && event.message === `Death: ${victimId} (starvation)`, 'Death compact message compatibility changed.');
  assert(event.importance === 'major', 'Death importance config mismatch.');
  assert(event.actors[0].id === victimId && event.actors[0].role === 'victim', 'Death event lacks victim actor.');
  assert(event.causes[0].ref === 'needs.starvation', 'Death event lacks starvation cause evidence.');
  assert(event.consequences[0].kind === 'death', 'Death event lacks death consequence.');
  assert(event.tags.includes('starvation'), 'Death event lacks normalized cause tag.');
  assert(validateNarrativeEvent(event).valid, 'Death producer emitted a malformed event.');
}

// Validate first-mutual-bond partnership emission without duplicate events.
function validateLifecyclePartnershipContract() {
  const { config, state } = buildLifecycleFixture();
  state.tick = 300;
  state.dwarves = state.dwarves.slice(0, 2);
  state.eventLog = [];
  state.events = [];
  state.eventClock = { tick: -1, nextSequence: 0 };
  state.eventStats = { accepted: 0, rejected: 0, legacyNormalized: 0, truncated: 0, collisions: 0 };
  config.population.housing = { ...config.population.housing, enabled: false };
  config.population.relationships = {
    ...config.population.relationships,
    interactionsPerTick: 1,
    minInteractionsPerTick: 0,
    idleInteractionMultiplier: 0,
    maxDistance: 1000,
    bondGain: 1,
    bondDecay: 0,
    bondThreshold: 20,
    moraleBonusMax: 0,
  };
  for (const dwarf of state.dwarves) {
    dwarf.job = null;
    dwarf.partnerId = null;
    dwarf.bondTargetId = null;
    dwarf.bondScore = 0;
    dwarf.ageTicks = Math.max(1, Number(config.population.aging.adultAge || 1));
    dwarf.lifeStage = 'adult';
  }
  const rolls = [0, 0.75, 0, 0.75];
  const originalRandom = Math.random;
  Math.random = () => (rolls.length > 0 ? rolls.shift() : 0.75);
  try {
    updateRelationships(state, config);
    updateRelationships(state, config);
  } finally {
    Math.random = originalRandom;
  }
  const events = state.eventLog.filter((entry) => entry.type === 'lifecycle.partnership_formed');
  assert(events.length === 1, 'Partnership producer did not emit exactly once for the first mutual bond.');
  const event = events[0];
  assert(event.importance === 'notable', 'Partnership importance config mismatch.');
  assert(event.actors.length === 2, 'Partnership event lacks both dwarf actors.');
  assert(event.consequences.length === 2, 'Partnership event lacks reciprocal status consequences.');
  assert(event.location.scope === 'surface', 'Partnership event lacks surface location.');
  assert(validateNarrativeEvent(event).valid, 'Partnership producer emitted a malformed event.');
}

// Build one social pair with stable pre-incident metrics and committed link outcomes.
function buildSocialIncidentPair(state) {
  const left = state.dwarves[0];
  const right = state.dwarves[1];
  left.x = 12;
  left.y = 9;
  left.homeId = 'house_social_fixture';
  right.x = 12;
  right.y = 9;
  right.homeId = 'house_social_fixture';
  const leftLink = {
    affinity: 0.62,
    rivalry: 0.48,
    mentorship: 0.57,
    grudge: 0.41,
    lastTick: state.tick,
  };
  const rightLink = { ...leftLink };
  return {
    left,
    right,
    leftLink,
    rightLink,
    pairKey: `${left.id}|${right.id}`,
    metrics: {
      affinity: 0.58,
      rivalry: 0.4,
      mentorship: 0.52,
      grudge: 0.34,
      stress: 0.71,
      skillGap: 0.2,
      hasMentorTie: true,
    },
  };
}

// Validate all four structured social-incident payload families without RNG or pair mutation.
function validateSocialIncidentEmitterContract() {
  const { config, state } = buildLifecycleFixture();
  state.tick = 420;
  state.eventLog = [];
  state.events = [];
  state.eventClock = { tick: -1, nextSequence: 0 };
  const pair = buildSocialIncidentPair(state);
  const pairBefore = clone({
    leftId: pair.left.id,
    rightId: pair.right.id,
    leftLink: pair.leftLink,
    rightLink: pair.rightLink,
    metrics: pair.metrics,
  });
  const cases = [
    {
      type: 'mentorship_breakthrough',
      eventType: 'social.mentorship_breakthrough',
      importance: 'notable',
      message: `Social incident: mentorship breakthrough (${pair.left.id} guided ${pair.right.id})`,
      mentorId: pair.left.id,
      actorRoles: ['primary', 'beneficiary'],
      consequenceMetric: 'mentor_id',
    },
    {
      type: 'rivalry_clash',
      eventType: 'social.rivalry_clash',
      importance: 'notable',
      message: `Social incident: rivalry clash between ${pair.left.id} and ${pair.right.id}`,
      mentorId: null,
      actorRoles: ['primary', 'opponent'],
      consequenceMetric: 'rivalry',
    },
    {
      type: 'grudge_escalation',
      eventType: 'social.grudge_escalation',
      importance: 'major',
      message: `Social incident: grudge escalation between ${pair.left.id} and ${pair.right.id}`,
      mentorId: null,
      actorRoles: ['primary', 'opponent'],
      consequenceMetric: 'grudge',
    },
    {
      type: 'reconciliation',
      eventType: 'social.reconciliation',
      importance: 'notable',
      message: `Social incident: reconciliation between ${pair.left.id} and ${pair.right.id}`,
      mentorId: null,
      actorRoles: ['primary', 'secondary'],
      consequenceMetric: 'rivalry',
    },
  ];
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error('Structured social event emission consumed Math.random.');
  };
  try {
    for (const fixture of cases) {
      const event = emitSocialIncidentEvent(state, config, {
        type: fixture.type,
        pair,
        message: fixture.message,
        mentorId: fixture.mentorId,
      });
      assert(event && event.type === fixture.eventType, `${fixture.type} event type mismatch.`);
      assert(event.category === 'social', `${fixture.type} event category mismatch.`);
      assert(event.importance === fixture.importance, `${fixture.type} importance mismatch.`);
      assert(event.message === fixture.message, `${fixture.type} compact message changed.`);
      assert(
        JSON.stringify(event.actors.map((actor) => actor.role)) === JSON.stringify(fixture.actorRoles),
        `${fixture.type} actor roles mismatch.`,
      );
      assert(event.actors.every((actor) => actor.label), `${fixture.type} actor label snapshot missing.`);
      assert(
        event.location.scope === 'surface' && event.location.x === 12 && event.location.y === 9,
        `${fixture.type} common surface location mismatch.`,
      );
      assert(
        event.causes[0].ref === 'population.social_drama',
        `${fixture.type} social cause reference missing.`,
      );
      assert(
        event.consequences.some((entry) => entry.metric === fixture.consequenceMetric),
        `${fixture.type} typed consequence missing.`,
      );
      assert(validateNarrativeEvent(event).valid, `${fixture.type} producer emitted a malformed event.`);
    }
  } finally {
    Math.random = originalRandom;
  }
  const pairAfter = clone({
    leftId: pair.left.id,
    rightId: pair.right.id,
    leftLink: pair.leftLink,
    rightLink: pair.rightLink,
    metrics: pair.metrics,
  });
  assert(JSON.stringify(pairAfter) === JSON.stringify(pairBefore), 'Social event emission mutated pair state.');
}

// Validate one real rivalry incident through updateSocialDrama and the structured gateway.
function validateSocialIncidentIntegrationContract() {
  const { config, state } = buildLifecycleFixture();
  state.tick = 480;
  state.dwarves = state.dwarves.slice(0, 2);
  state.eventLog = [];
  state.events = [];
  state.eventClock = { tick: -1, nextSequence: 0 };
  state.social = null;
  const adultAge = Math.max(1, Number(config.population.aging.adultAge || 1));
  const left = state.dwarves[0];
  const right = state.dwarves[1];
  left.ageTicks = adultAge + 100;
  right.ageTicks = adultAge + 80;
  left.lifeStage = 'adult';
  right.lifeStage = 'adult';
  left.partnerId = right.id;
  right.partnerId = left.id;
  left.state.stress = 0.8;
  right.state.stress = 0.8;
  left.social.links[right.id] = {
    affinity: 0.1,
    rivalry: 0.8,
    mentorship: 0,
    grudge: 0,
    lastTick: state.tick,
  };
  right.social.links[left.id] = { ...left.social.links[right.id] };
  const socialConfig = config.population.socialDrama;
  config.population.socialDrama = {
    ...socialConfig,
    tickInterval: 1,
    pairSamplesPerUpdate: 0,
    includeBondedPairs: true,
    carryoverPairsPerDwarf: 0,
    affinityGainBase: 0,
    affinityBondScale: 0,
    affinitySameClanBonus: 0,
    affinityDecayPerTick: 0,
    rivalryBaseGain: 0,
    rivalryStressScale: 0,
    rivalryLowMoraleScale: 0,
    rivalryBondShieldScale: 0,
    rivalryDecayPerTick: 0,
    mentorshipBaseGain: 0,
    mentorshipBondScale: 0,
    mentorshipSkillScale: 0,
    mentorshipDecayPerTick: 0,
    grudgeStressScale: 0,
    grudgeRivalryScale: 0,
    grudgeDecayPerTick: 0,
    incidents: {
      ...socialConfig.incidents,
      enabled: true,
      intervalTicks: 1,
      baseChancePerRoll: 1,
      maxPerUpdate: 1,
      globalCooldownTicks: 1,
      perPairCooldownTicks: 0,
      weights: {
        mentorship_breakthrough: 0,
        rivalry_clash: 1,
        grudge_escalation: 0,
        reconciliation: 0,
      },
    },
  };
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    updateSocialDrama(state, config, null);
  } finally {
    Math.random = originalRandom;
  }
  const events = state.eventLog.filter((entry) => entry.type === 'social.rivalry_clash');
  assert(events.length === 1, 'Actual social runtime did not emit one structured rivalry clash.');
  assert(state.social.history.length === 1, 'Actual social runtime did not retain incident history.');
  assert(state.social.stats.incidentsByType.rivalry_clash === 1, 'Rivalry incident counter mismatch.');
  assert(validateNarrativeEvent(events[0]).valid, 'Actual social runtime emitted a malformed event.');
}

// Validate every structured combat payload family without RNG or live-object mutation.
function validateCombatEmitterContract() {
  const { config, state } = buildLifecycleFixture();
  state.tick = 640;
  state.eventLog = [];
  state.events = [];
  state.eventClock = { tick: -1, nextSequence: 0 };
  const left = state.dwarves[0];
  const right = state.dwarves[1];
  const expedition = {
    roomIndex: 1,
    dwarfIds: [left.id, right.id],
    readiness: { depth: 2, score: 18.5 },
  };
  const raidState = {
    duration: 40,
    beasts: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
  };
  const deepRaid = {
    depth: 3,
    factionId: 'ashen_host',
    factionLabel: 'Ashen Host',
    strength: 1.4,
    casualties: 1,
    losses: { iron: 3 },
  };
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error('Structured combat event emission consumed Math.random.');
  };
  const emitted = [];
  try {
    emitted.push(emitSurfaceRaidStarted(
      state,
      config,
      raidState,
      'Raid: beasts enter the valley',
    ));
    emitted.push(emitSurfaceRaidResolved(state, config, {
      message: 'Raid ended: 1 slain, loot iron 3',
      victims: [left],
      raidDeaths: 1,
      stolen: { iron: 3 },
      difficulty: 0.6,
      defense: 0.4,
    }));
    emitted.push(emitRuinsExpeditionStarted(
      state,
      config,
      expedition,
      'Ruins: expedition started (Room 2)',
    ));
    emitted.push(emitRuinsExpeditionResolved(state, config, {
      message: 'Ruins: room 2 cleared',
      expedition,
      party: [left, right],
      victims: [],
      success: true,
      reason: 'clear',
    }));
    emitted.push(emitRuinsExpeditionResolved(state, config, {
      message: 'Ruins: expedition failed (1 fallen)',
      expedition,
      party: [right],
      victims: [left],
      success: false,
      reason: 'hazard',
    }));
    emitted.push(emitUnderrealmChampionEncounter(state, config, {
      message: 'Underrealm D2: Basalt Warden defeated, depth 3 unlocked',
      outcome: 'victory',
      depth: 2,
      championLabel: 'Basalt Warden',
      unlockedDepth: 3,
      dwarfIds: expedition.dwarfIds,
    }));
    emitted.push(emitUnderrealmChampionEncounter(state, config, {
      message: 'Underrealm D2: Basalt Warden retreat, cooldown 90 ticks',
      outcome: 'retreat',
      depth: 2,
      championLabel: 'Basalt Warden',
      dwarfIds: expedition.dwarfIds,
    }));
    emitted.push(emitDwarfChampionChanged(state, config, {
      mode: 'appointed',
      dwarf: left,
      message: `Underrealm: ${left.id} appointed Dwarf Champion command (+18% atk, +16% def)`,
      source: 'underrealm',
    }));
    emitted.push(emitDwarfChampionChanged(state, config, {
      mode: 'fallen',
      dwarfId: 'dwarf_fallen_champion',
      message: 'Underrealm: Dwarf Champion dwarf_fallen_champion has fallen',
      source: 'ruins',
    }));
    emitted.push(emitDeepRaidEvent(state, config, 'started', deepRaid, {
      message: 'Underrealm D3: Ashen Host emerge from the dark',
    }));
    emitted.push(emitDeepRaidEvent(state, config, 'casualties', deepRaid, {
      message: 'Underrealm D3: 1 delvers lost against Ashen Host',
      victims: [right],
    }));
    emitted.push(emitDeepRaidEvent(state, config, 'resolved', deepRaid, {
      message: 'Underrealm D3: raid broken (1 lost, iron 3)',
    }));
  } finally {
    Math.random = originalRandom;
  }

  const expectedTypes = [
    'combat.surface_raid_started',
    'combat.surface_raid_resolved',
    'combat.ruins_expedition_started',
    'combat.ruins_expedition_succeeded',
    'combat.ruins_expedition_failed',
    'combat.underrealm_champion_defeated',
    'combat.underrealm_champion_setback',
    'combat.dwarf_champion_appointed',
    'combat.dwarf_champion_fallen',
    'combat.deep_raid_started',
    'combat.deep_raid_casualties',
    'combat.deep_raid_resolved',
  ];
  assert(
    JSON.stringify(emitted.map((event) => event && event.type)) === JSON.stringify(expectedTypes),
    'Combat event type mapping mismatch.',
  );
  for (const event of emitted) {
    assert(event && event.category === 'combat', 'Combat producer category mismatch.');
    assert(event.actors.length > 0, `${event.type} lacks actors.`);
    assert(event.causes.length > 0, `${event.type} lacks causal evidence.`);
    assert(event.consequences.length > 0, `${event.type} lacks typed consequences.`);
    assert(validateNarrativeEvent(event).valid, `${event.type} producer emitted a malformed event.`);
  }
  assert(
    emitted[1].actors.some((actor) => actor.role === 'victim' && actor.label),
    'Surface raid did not retain a victim name snapshot.',
  );
  assert(
    emitted[5].consequences.some((entry) => entry.kind === 'unlock'),
    'Champion victory did not retain depth unlock outcome.',
  );
  assert(emitted[8].importance === 'critical', 'Dwarf Champion fall importance mismatch.');
  assert(emitted[10].importance === 'critical', 'Deep raid casualty importance mismatch.');
}

// Validate a real no-loss raid conclusion through updateRaidTick and the structured gateway.
function validateCombatRaidIntegrationContract() {
  const { config, runtime, state } = buildLifecycleFixture();
  state.tick = 700;
  state.dwarves = [];
  state.jobs = [];
  state.events = [];
  state.eventLog = [];
  state.eventClock = { tick: -1, nextSequence: 0 };
  state.raid = {
    active: true,
    ticksRemaining: 1,
    duration: 1,
    lastSeasonIndex: 0,
    beasts: [],
  };
  config.raids.resourceLoss = {
    ...config.raids.resourceLoss,
    min: 0,
    max: 0,
  };
  updateRaidTick(state, config, runtime);
  const events = state.eventLog.filter((entry) => entry.type === 'combat.surface_raid_resolved');
  assert(events.length === 1, 'Actual raid runtime did not emit one structured conclusion.');
  assert(events[0].message === 'Raid ended: no losses', 'Actual raid compact message changed.');
  assert(state.raid.active === false, 'Actual raid runtime did not close raid state.');
  assert(validateNarrativeEvent(events[0]).valid, 'Actual raid runtime emitted a malformed event.');
}

// Validate every structured Warrior League payload family without emission RNG.
function validateWarriorEmitterContract() {
  const { config, state } = buildLifecycleFixture();
  state.tick = 780;
  state.eventLog = [];
  state.events = [];
  state.eventClock = { tick: -1, nextSequence: 0 };
  const winner = state.dwarves[0];
  const loser = state.dwarves[1];
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error('Structured Warrior League event emission consumed Math.random.');
  };
  const emitted = [];
  try {
    emitted.push(emitWarriorMarkChanged(state, config, winner, {
      kind: 'scar',
      id: 'scar_broken_guard',
      source: 'tournament',
      message: `Warrior League: ${winner.id} gained scar scar_broken_guard`,
    }));
    emitted.push(emitWarriorMarkChanged(state, config, winner, {
      kind: 'title',
      id: 'title_league_champion',
      source: 'tournament',
      message: `Warrior League: ${winner.id} gained title title_league_champion`,
    }));
    emitted.push(emitWarriorMarkChanged(state, config, winner, {
      kind: 'vow_sworn',
      id: 'stone_oath',
      source: 'expedition',
      message: `Warrior League: ${winner.id} swore vow stone_oath`,
    }));
    emitted.push(emitWarriorMarkChanged(state, config, winner, {
      kind: 'vow_replaced',
      id: 'deep_lantern',
      previousId: 'stone_oath',
      source: 'expedition',
      message: `Warrior League: ${winner.id} replaced vow stone_oath -> deep_lantern`,
    }));
    emitted.push(emitWarriorRetired(state, config, loser, {
      reason: 'tournament injuries',
      message: `Warrior League: ${loser.id} retired after tournament injuries`,
    }));
    emitted.push(emitWarriorUnderrealmCommandChanged(state, config, loser, {
      mode: 'relinquished',
      message: `Underrealm: champion ${loser.id} stood down (retired)`,
    }));
    emitted.push(emitWarriorHeroCommandTaken(
      state,
      config,
      winner,
      loser,
      `Warrior League: ${winner.id} defeated ${loser.id} and took hero command`,
    ));
    emitted.push(emitWarriorTournamentInjury(state, config, loser, {
      severity: 'severe',
      recoveryTicks: 120,
      message: `Warrior League: ${loser.id} suffered severe injury (120 recovery ticks)`,
    }));
    emitted.push(emitWarriorTournamentDeath(
      state,
      config,
      loser,
      `Warrior League: ${loser.id} fell in tournament combat`,
    ));
    emitted.push(emitWarriorTournamentCrowned(state, config, {
      champion: winner,
      previousChampionId: loser.id,
      seasonId: 9,
      participantCount: 8,
      message: `Warrior League Basalt Crown S9: champion ${winner.id}`,
    }));
    emitted.push(emitWarriorUnderrealmCommandChanged(state, config, winner, {
      mode: 'synced',
      message: `Warrior League: ${winner.id} synced to Underrealm Dwarf Champion command`,
    }));
  } finally {
    Math.random = originalRandom;
  }

  const expectedTypes = [
    'warrior.scar_earned',
    'warrior.title_earned',
    'warrior.vow_sworn',
    'warrior.vow_replaced',
    'warrior.retired',
    'warrior.underrealm_command_relinquished',
    'warrior.hero_command_taken',
    'warrior.tournament_injury',
    'warrior.tournament_death',
    'warrior.tournament_champion_crowned',
    'warrior.underrealm_command_synced',
  ];
  assert(
    JSON.stringify(emitted.map((event) => event && event.type)) === JSON.stringify(expectedTypes),
    'Warrior League event type mapping mismatch.',
  );
  for (const event of emitted) {
    assert(event && event.category === 'warrior', 'Warrior League producer category mismatch.');
    assert(event.actors.length > 0, `${event.type} lacks actors.`);
    assert(event.causes.length > 0, `${event.type} lacks causal evidence.`);
    assert(event.consequences.length > 0, `${event.type} lacks typed consequences.`);
    assert(validateNarrativeEvent(event).valid, `${event.type} producer emitted a malformed event.`);
  }
  assert(emitted[4].importance === 'major', 'Warrior retirement importance mismatch.');
  assert(emitted[8].importance === 'critical', 'Tournament death importance mismatch.');
  assert(
    emitted[9].consequences.some((entry) => entry.targetId === 'warrior_hall_of_fame'),
    'Tournament crown did not retain Hall of Fame induction.',
  );
}

// Validate a real deterministic tournament crown and Hall of Fame update.
function validateWarriorTournamentIntegrationContract() {
  const { config, state } = buildLifecycleFixture();
  state.tick = 800;
  state.eventLog = [];
  state.events = [];
  state.eventClock = { tick: -1, nextSequence: 0 };
  config.warriors = {
    ...config.warriors,
    enabled: true,
    training: {
      ...(config.warriors && config.warriors.training || {}),
      enabled: false,
    },
    marks: {
      ...(config.warriors && config.warriors.marks || {}),
      enabled: false,
    },
    tournaments: {
      ...(config.warriors && config.warriors.tournaments || {}),
      enabled: true,
      cadence: 'season',
      interval_seasons: 1,
      min_participants: 2,
      max_participants: 2,
      sync_underrealm_champion: true,
      seed_weights: {
        rating: 1,
        valor: 0,
        hero_potential: 0,
        condition: 0,
        champion_survivals: 0,
      },
      duel_weights: {
        seed_score: 1,
        base_aptitude: 0,
        condition: 0,
      },
      consequences: {
        ...(config.warriors && config.warriors.tournaments
          && config.warriors.tournaments.consequences || {}),
        enabled: true,
        injury_base_chance: 1,
        injury_score_gap_scale: 0,
        injury_tie_break_bonus: 0,
        risk_intent_injury_scale: 0,
        recovery_intent_injury_reduction: 0,
        severity_weights: { light: 0, moderate: 0, severe: 1 },
        recovery_ticks: { light: 1, moderate: 1, severe: 1 },
        retirement_chance: { light: 0, moderate: 0, severe: 0 },
        death_chance: { light: 0, moderate: 0, severe: 1 },
        allow_retirements: false,
        allow_death: true,
      },
    },
  };
  const adults = state.dwarves.slice(0, 2);
  assert(adults.length === 2, 'Warrior tournament fixture lacks two fighters.');
  state.dwarves.forEach((dwarf, index) => {
    dwarf.lifeStage = index < 2 ? 'adult' : 'child';
  });
  adults.forEach((dwarf, index) => {
    dwarf.warrior.retired = false;
    dwarf.warrior.rating = index === 0 ? 0.95 : 0.25;
    dwarf.warrior.valor = 0.5;
    dwarf.warrior.heroPotential = 0.5;
    dwarf.warrior.nextEligibleExpeditionTick = 0;
  });
  state.season = {
    ...(state.season || {}),
    globalIndex: 12,
    index: 12,
    tickInSeason: 1,
    name: 'autumn',
  };
  const underChampion = state.underrealm.combat.dwarfChampion;
  underChampion.enabled = true;
  underChampion.activeDwarfId = null;
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    updateWarriors(state, config, null);
  } finally {
    Math.random = originalRandom;
  }
  const crownEvents = state.eventLog
    .filter((entry) => entry.type === 'warrior.tournament_champion_crowned');
  const deathEvents = state.eventLog
    .filter((entry) => entry.type === 'warrior.tournament_death');
  assert(crownEvents.length === 1, 'Actual tournament did not emit one structured crown.');
  assert(
    String(state.warriors.league.championId || '') === String(adults[0].id),
    'Actual tournament crowned the wrong deterministic fighter.',
  );
  assert(
    state.warriors.company.hallOfFame[0].dwarfId === adults[0].id,
    'Actual tournament did not commit the Hall of Fame entry before emission.',
  );
  assert(
    crownEvents[0].consequences.some((entry) => entry.targetId === 'warrior_hall_of_fame'),
    'Actual tournament crown lacks Hall of Fame consequence.',
  );
  assert(deathEvents.length === 1, 'Actual tournament did not emit one structured fatal outcome.');
  assert(
    !state.dwarves.some((dwarf) => dwarf.id === adults[1].id),
    'Fatal tournament loser remained in authoritative population state.',
  );
  assert(
    deathEvents[0].actors[0].id === adults[1].id && deathEvents[0].actors[0].label,
    'Fatal tournament event lost the removed fighter snapshot.',
  );
  assert(validateNarrativeEvent(crownEvents[0]).valid, 'Actual tournament emitted a malformed crown.');
  assert(validateNarrativeEvent(deathEvents[0]).valid, 'Actual tournament emitted a malformed death.');
}

// Validate all structured political payload families without event-emission RNG.
function validatePoliticalEmitterContract() {
  const { config, state } = buildLifecycleFixture();
  state.tick = 900;
  state.eventLog = [];
  state.events = [];
  state.eventClock = { tick: -1, nextSequence: 0 };
  const schism = state.schism;
  schism.pressure = 0.86;
  schism.legitimacy = 0.31;
  schism.doctrine = 'revelry';
  schism.phase = 'reckoning';
  const ritual = {
    active: true,
    id: 'oath_of_embers',
    label: 'Oath of Embers',
    startedTick: 880,
    endsAtTick: 940,
    durationTicks: 60,
    deltas: { pressure: -0.04, legitimacy: 0.05 },
  };
  const decree = {
    active: true,
    id: 'granary_compact',
    label: 'Granary Compact',
    startedTick: 900,
    endsAtTick: 1100,
    durationTicks: 200,
    deltas: { pressure: -0.03, legitimacy: 0.02 },
  };
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error('Structured political event emission consumed Math.random.');
  };
  const emitted = [];
  try {
    emitted.push(emitSchismDoctrineShifted(state, config, schism, {
      doctrine: 'revelry',
      previousDoctrine: 'austerity',
      message: 'Schism doctrine: Revelry Ascendant',
    }));
    emitted.push(emitSchismPhaseShifted(state, config, schism, {
      phase: 'reckoning',
      previousPhase: 'fracture',
      message: 'Schism phase: reckoning of the Nine Braziers',
    }));
    emitted.push(emitSchismRitualWindowOpened(state, config, schism, {
      seasonName: 'autumn',
      message: 'Ritual window opened: autumn council rites',
    }));
    emitted.push(emitSchismCouncilRitualLit(
      state,
      config,
      schism,
      'Council ritual: the Nine Braziers are lit',
    ));
    emitted.push(emitSchismRitualChanged(
      state,
      config,
      schism,
      'invoked',
      ritual,
      'Ritual invoked: Oath of Embers (60 ticks)',
    ));
    emitted.push(emitSchismRitualChanged(
      state,
      config,
      schism,
      'expired',
      ritual,
      'Ritual faded: Oath of Embers',
    ));
    emitted.push(emitSchismDecreeProposed(state, config, schism, [
      { id: 'granary_compact', label: 'Granary Compact' },
      { id: 'frontier_levy', label: 'Frontier Levy' },
      { id: 'deep_claims', label: 'Deep Claims' },
    ], 'Council decrees proposed: Granary Compact | Frontier Levy | Deep Claims'));
    emitted.push(emitSchismDecreeChanged(
      state,
      config,
      schism,
      'enacted',
      decree,
      'Council decree enacted: Granary Compact (200 ticks, pressure -3.0pp, legitimacy +2.0pp)',
    ));
    emitted.push(emitSchismDecreeChanged(
      state,
      config,
      schism,
      'expired',
      decree,
      'Council decree expired: Granary Compact',
    ));
    emitted.push(emitSchismClimaxChanged(state, config, schism, 'started', {
      doctrine: 'revelry',
      message: 'Schism climax: the halls split under the Nine Braziers',
    }));
    emitted.push(emitSchismClimaxChanged(state, config, schism, 'resolved', {
      doctrine: 'revelry',
      pressureDrop: 0.22,
      legitimacyGain: 0.09,
      message: 'Schism resolved: revelry rites bind the clans into one oath',
    }));
  } finally {
    Math.random = originalRandom;
  }

  const expectedTypes = [
    'schism.doctrine_shifted',
    'schism.phase_shifted',
    'schism.ritual_window_opened',
    'schism.council_ritual_lit',
    'schism.ritual_invoked',
    'schism.ritual_expired',
    'schism.decree_proposed',
    'schism.decree_enacted',
    'schism.decree_expired',
    'schism.climax_started',
    'schism.climax_resolved',
  ];
  assert(
    JSON.stringify(emitted.map((event) => event && event.type)) === JSON.stringify(expectedTypes),
    'Political event type mapping mismatch.',
  );
  for (const event of emitted) {
    assert(event && event.category === 'schism', 'Political producer category mismatch.');
    assert(event.actors.length > 0, `${event.type} lacks political actors.`);
    assert(event.causes.length > 0, `${event.type} lacks causal evidence.`);
    assert(event.consequences.length > 0, `${event.type} lacks typed consequences.`);
    assert(validateNarrativeEvent(event).valid, `${event.type} producer emitted a malformed event.`);
  }
  assert(emitted[6].actors.length === 4, 'Decree proposal did not retain the bounded option slate.');
  assert(emitted[9].importance === 'critical', 'Schism climax start importance mismatch.');
  assert(emitted[10].importance === 'legendary', 'Schism climax resolution importance mismatch.');
}

// Validate real phase/climax start and resolution through updateSchism.
function validatePoliticalClimaxIntegrationContract() {
  const { config, state } = buildLifecycleFixture();
  state.tick = 950;
  state.eventLog = [];
  state.events = [];
  state.eventClock = { tick: -1, nextSequence: 0 };
  config.schism = {
    ...config.schism,
    pressure: {
      ...(config.schism && config.schism.pressure || {}),
      target: 0.9,
      drift_per_tick: 0,
      shortage_weight: 0,
      low_morale_weight: 0,
      raid_active_weight: 0,
      deep_raid_active_weight: 0,
      festival_relief_per_tick: 0,
      temple_relief_per_stage_tick: 0,
    },
    legitimacy: {
      ...(config.schism && config.schism.legitimacy || {}),
      passive_decay_per_tick: 0,
      pressure_decay_scale: 0,
      festival_gain_per_tick: 0,
      temple_gain_per_stage_tick: 0,
    },
    ritual_windows: {
      ...(config.schism && config.schism.ritual_windows || {}),
      enabled: false,
    },
    decrees: {
      ...(config.schism && config.schism.decrees || {}),
      enabled: false,
    },
    climax: {
      ...(config.schism && config.schism.climax || {}),
      enabled: true,
      trigger_pressure: 0.8,
      trigger_legitimacy: 0.4,
      duration_ticks: 1,
      resolution_pressure_drop: 0.2,
      resolution_legitimacy_gain: 0.1,
      allow_multiple: false,
    },
  };
  state.schism.pressure = 0.9;
  state.schism.legitimacy = 0.3;
  state.schism.phase = 'concord';
  state.schism.climax.active = false;
  state.schism.climax.resolved = false;
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error('Deterministic political phase/climax path consumed Math.random.');
  };
  try {
    updateSchism(state, config);
    state.tick += 1;
    updateSchism(state, config);
  } finally {
    Math.random = originalRandom;
  }
  const phaseEvents = state.eventLog.filter((entry) => entry.type === 'schism.phase_shifted');
  const started = state.eventLog.filter((entry) => entry.type === 'schism.climax_started');
  const resolved = state.eventLog.filter((entry) => entry.type === 'schism.climax_resolved');
  assert(phaseEvents.length === 1, 'Actual schism runtime did not emit one phase transition.');
  assert(started.length === 1, 'Actual schism runtime did not emit one climax start.');
  assert(resolved.length === 1, 'Actual schism runtime did not emit one climax resolution.');
  assert(state.schism.climax.active === false, 'Actual schism climax remained active after resolution.');
  assert(state.schism.climax.resolved === true, 'Actual schism climax did not commit resolved state.');
  assert(Math.abs(state.schism.pressure - 0.7) < 1e-9, 'Climax pressure resolution mismatch.');
  assert(Math.abs(state.schism.legitimacy - 0.4) < 1e-9, 'Climax legitimacy resolution mismatch.');
  assert(validateNarrativeEvent(resolved[0]).valid, 'Actual climax resolution event is malformed.');
}

// Validate committed ritual invocation/expiration and decree archival through public runtime paths.
function validatePoliticalLifecycleIntegrationContract() {
  const { config, state } = buildLifecycleFixture();
  state.tick = 980;
  state.eventLog = [];
  state.events = [];
  state.eventClock = { tick: -1, nextSequence: 0 };
  config.schism = {
    ...config.schism,
    pressure: {
      ...(config.schism && config.schism.pressure || {}),
      target: state.schism.pressure,
      drift_per_tick: 0,
      shortage_weight: 0,
      low_morale_weight: 0,
      raid_active_weight: 0,
      deep_raid_active_weight: 0,
      festival_relief_per_tick: 0,
      temple_relief_per_stage_tick: 0,
    },
    legitimacy: {
      ...(config.schism && config.schism.legitimacy || {}),
      passive_decay_per_tick: 0,
      pressure_decay_scale: 0,
      festival_gain_per_tick: 0,
      temple_gain_per_stage_tick: 0,
    },
    ritual_windows: {
      ...(config.schism && config.schism.ritual_windows || {}),
      enabled: false,
    },
    decrees: {
      ...(config.schism && config.schism.decrees || {}),
      enabled: false,
    },
    climax: {
      ...(config.schism && config.schism.climax || {}),
      enabled: false,
    },
  };
  state.schism.ritualWindow.open = true;
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error('Political ritual/decree lifecycle consumed Math.random.');
  };
  try {
    notifySchismFestivalStarted(state, config, 'council', {
      id: 'oath_of_embers',
      label: 'Oath of Embers',
      durationTicks: 1,
      effects: {},
      festivalEffects: {},
      deltas: { pressure: -0.04, legitimacy: 0.05 },
    });
    state.schism.decree = {
      active: true,
      id: 'granary_compact',
      label: 'Granary Compact',
      source: 'council',
      startedTick: state.tick - 20,
      endsAtTick: state.tick + 1,
      durationTicks: 21,
      seasonIndex: 4,
      issuedSeasonIndex: 4,
      options: ['Granary Compact', 'Frontier Levy'],
      effects: {},
      deltas: { pressure: -0.03, legitimacy: 0.02 },
    };
    state.tick += 1;
    updateSchism(state, config);
  } finally {
    Math.random = originalRandom;
  }
  const expectedTypes = [
    'schism.council_ritual_lit',
    'schism.ritual_invoked',
    'schism.ritual_expired',
    'schism.decree_expired',
  ];
  for (const type of expectedTypes) {
    const events = state.eventLog.filter((entry) => entry.type === type);
    assert(events.length === 1, `Actual political lifecycle did not emit exactly one ${type}.`);
    assert(validateNarrativeEvent(events[0]).valid, `Actual ${type} event is malformed.`);
  }
  assert(state.schism.ritual.active === false, 'Expired ritual remained active after archival.');
  assert(state.schism.decree.active === false, 'Expired decree remained active after archival.');
  assert(
    state.schism.ritualHistory.some((entry) => entry.id === 'oath_of_embers'),
    'Expired ritual was not archived before structured emission.',
  );
  assert(
    state.schism.decreeHistory.some((entry) => entry.id === 'granary_compact'),
    'Expired decree was not archived before structured emission.',
  );
}

// Validate every structured endgame payload family without event-emission RNG.
function validateEndgameEmitterContract() {
  const { config, state } = buildLifecycleFixture();
  state.tick = 1200;
  state.cycleStats.count = 2;
  state.eventLog = [];
  state.events = [];
  state.eventClock = { tick: -1, nextSequence: 0 };
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error('Structured endgame event emission consumed Math.random.');
  };
  const emitted = [];
  try {
    emitted.push(emitEndgameArtifactRecovered(state, config, {
      artifactId: 'hammer_khorg',
      artifactName: 'Hammer of Khorg',
      depth: 3,
      foundCount: 10,
      totalCount: 10,
      message: 'Ruins: artifact found - Hammer of Khorg',
    }));
    emitted.push(emitEndgameArtifactCollectionCompleted(state, config, {
      artifactCount: 10,
    }));
    emitted.push(emitEndgameTransitionStarted(state, config, {
      sourceCycle: 2,
    }));
    state.cycleStats.count = 3;
    emitted.push(emitEndgameCycleClosed(state, config, {
      sourceCycle: 2,
      completedCycles: 3,
      completedTicks: 1200,
      artifactCount: 10,
    }));
    emitted.push(emitEndgameWarriorCompanyCarriedOver(state, config, {
      applied: true,
      sourceCycle: 2,
      companyName: 'Ember Wardens',
      retainedRenown: 0.36,
      seedBonus: 0.18,
      sourceChampionId: 'dwarf_1',
    }));
    emitted.push(emitEndgameTransitionCompleted(state, config, {
      sourceCycle: 2,
    }));
  } finally {
    Math.random = originalRandom;
  }

  const expectedTypes = [
    'endgame.artifact_recovered',
    'endgame.artifact_collection_completed',
    'endgame.transition_started',
    'endgame.cycle_closed',
    'endgame.warrior_company_carried_over',
    'endgame.transition_completed',
  ];
  assert(
    JSON.stringify(emitted.map((event) => event && event.type)) === JSON.stringify(expectedTypes),
    'Endgame event type mapping mismatch.',
  );
  for (const event of emitted) {
    assert(event && event.actors.length > 0, `${event && event.type} lacks endgame actors.`);
    assert(event.causes.length > 0, `${event.type} lacks causal evidence.`);
    assert(event.consequences.length > 0, `${event.type} lacks typed consequences.`);
    assert(validateNarrativeEvent(event).valid, `${event.type} producer emitted a malformed event.`);
  }
  assert(emitted[0].location.scope === 'underrealm', 'Artifact recovery lost its ruins depth.');
  assert(emitted[0].importance === 'major', 'Artifact recovery importance mismatch.');
  assert(emitted[1].importance === 'legendary', 'Artifact collection importance mismatch.');
  assert(emitted[2].importance === 'critical', 'Transition start importance mismatch.');
  assert(emitted[3].importance === 'legendary', 'Cycle closure importance mismatch.');
  assert(
    emitted.slice(1).every((event) => event.sagaId === 'endgame_cycle_0002'),
    'Endgame transition facts did not share the source-cycle saga.',
  );
}

// Run the real endgame latch and two resets to verify post-commit identities and carry-over.
function validateEndgameMultiCycleIntegrationContract() {
  const { config, runtime, state } = buildLifecycleFixture();
  config.endgame = {
    ...config.endgame,
    minTicksAfterArtifacts: 5,
    transition: {
      ...(config.endgame && config.endgame.transition || {}),
      randomizeSeed: false,
    },
  };
  state.tick = 200;
  state.cycleStats.count = 2;
  state.eventLog = [];
  state.events = [];
  state.eventClock = { tick: -1, nextSequence: 0 };
  const artifactPool = config.ruins.artifacts.pool;
  state.ruins.artifactsFound = Object.fromEntries(
    Object.keys(artifactPool).map((artifactId) => [artifactId, true]),
  );

  assert(shouldTriggerEndgameReset(state, config) === false, 'Endgame wait gate fired at latch time.');
  assert(state.endgameArtifactsTick === 200, 'Artifact completion tick did not latch.');
  assert(
    state.eventLog.filter((event) => event.type === 'endgame.artifact_collection_completed').length === 1,
    'Artifact completion did not emit exactly once when latched.',
  );
  assert(shouldTriggerEndgameReset(state, config) === false, 'Repeated latch check bypassed wait gate.');
  assert(
    state.eventLog.filter((event) => event.type === 'endgame.artifact_collection_completed').length === 1,
    'Repeated latch check duplicated artifact completion.',
  );
  state.tick = 205;
  assert(shouldTriggerEndgameReset(state, config) === true, 'Endgame wait gate did not mature.');

  state.prestige.total = 480;
  state.myths.traditions = { forge_oath: 2 };
  state.warriors.company.identity.name = 'Ember Wardens';
  state.warriors.company.identity.renown = 0.8;
  state.warriors.league.championId = state.dwarves[0].id;
  const previousRandom = Math.random;
  let randomState = 73013;
  Math.random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };
  let firstReset = null;
  let secondReset = null;
  try {
    firstReset = runEndgameReset(state, config, runtime);
    state.tick = 321;
    secondReset = runEndgameReset(state, config, runtime);
  } finally {
    Math.random = previousRandom;
  }

  assert(firstReset && firstReset.cycleEvent, 'First reset did not return its cycle event.');
  assert(firstReset.cycleEvent.cycle === 3, 'First closure did not use the installed cycle identity.');
  assert(firstReset.cycleEvent.tick === 0, 'First closure did not anchor the new cycle at tick 0.');
  assert(
    firstReset.cycleEvent.id === 'evt:v1:c0003:t0000000000:s0000',
    'First closure deterministic identity mismatch.',
  );
  assert(firstReset.carryoverEvent, 'Positive Warrior Company seed did not emit carry-over.');
  assert(firstReset.carryoverEvent.sequence === 1, 'Carry-over event order mismatch after closure.');
  assert(firstReset.carryoverEvent.cycle === 3, 'Carry-over retained the pre-reset cycle identity.');
  assert(state.cycleStats.count === 4, 'Second reset did not advance the completed-cycle counter.');
  assert(state.cycleStats.lastTicks === 321, 'Second reset did not retain previous cycle duration.');
  assert(state.prestige.total >= 480, 'Prestige meta-progression was lost across resets.');
  assert(state.myths.traditions.forge_oath === 2, 'Myth tradition was lost across resets.');
  assert(secondReset.cycleEvent.cycle === 4, 'Second closure cycle identity mismatch.');
  assert(
    secondReset.cycleEvent.id === 'evt:v1:c0004:t0000000000:s0000',
    'Second closure deterministic identity mismatch.',
  );
  assert(
    !state.eventLog.some((event) => event.type === 'legacy.warrior'),
    'Warrior carry-over still emitted through legacy compatibility.',
  );
  for (const event of state.eventLog) {
    assert(validateNarrativeEvent(event).valid, 'Multi-cycle reset retained a malformed event.');
  }
}

// Guard the private app transition hooks and their post-commit emission order.
function validateEndgameAppTransitionWiringContract() {
  const appSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const startBegin = appSource.indexOf('function startEndgameTransition(state, config, runtime)');
  const startEnd = appSource.indexOf('// Function: advanceEndgameTransition.', startBegin);
  const advanceBegin = appSource.indexOf('function advanceEndgameTransition(state, config, runtime)');
  const advanceEnd = appSource.indexOf('// Function: buildFailureMessage.', advanceBegin);
  assert(startBegin >= 0 && startEnd > startBegin, 'Could not locate endgame transition start wiring.');
  assert(advanceBegin >= 0 && advanceEnd > advanceBegin, 'Could not locate endgame transition advance wiring.');
  const startSource = appSource.slice(startBegin, startEnd);
  const advanceSource = appSource.slice(advanceBegin, advanceEnd);
  assert(
    startSource.indexOf('transition.active = true;')
      < startSource.indexOf('emitEndgameTransitionStarted(state, config'),
    'Transition start event is not wired after the active-state commit.',
  );
  assert(
    advanceSource.indexOf("transition.phase = 'done';")
      < advanceSource.indexOf('emitEndgameTransitionCompleted(state, config'),
    'Transition completion event is not wired after the done-phase commit.',
  );
}

// Validate existing string callers, inferred categories, retention limits, and RNG neutrality.
function validateLegacyCompatibilityContract() {
  const config = { events: { maxEntries: 2, logMaxEntries: 2 } };
  const state = { tick: 41, events: [], eventLog: [] };
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error('Legacy pushEvent consumed Math.random.');
  };
  let birthEvent = null;
  try {
    birthEvent = pushEvent(state, config, 'Birth: dwarf_1042 joined the settlement');
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
  assert(birthEvent && birthEvent.type === 'legacy.lifecycle', 'Legacy caller did not return canonical legacy.* event.');
  assert(birthEvent.importance === 'ambient', 'Minimal config did not use ambient importance fallback.');
  assert(validateNarrativeEvent(birthEvent).valid, 'Legacy caller returned a malformed v1 event.');
  assert(state.eventStats.accepted === 3, 'Legacy accepted diagnostic mismatch.');
  assert(state.eventStats.legacyNormalized === 3, 'Legacy normalization diagnostic mismatch.');

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
  const disabledEvent = pushEvent(
    disabled,
    { events: { maxEntries: 0, logMaxEntries: 0 } },
    'Weather: quiet',
  );
  assert(disabledEvent && disabledEvent.schemaVersion === 1, 'Disabled retention suppressed returned v1 event.');
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
  validateStructuredEmitterContract();
  validateEmitterIdentityAndCollisionContract();
  validateRuntimeSerializationReductionContract();
  validateLifecycleFoundingContract();
  validateLifecycleBirthContract();
  validateLifecycleDeathContract();
  validateLifecyclePartnershipContract();
  validateSocialIncidentEmitterContract();
  validateSocialIncidentIntegrationContract();
  validateCombatEmitterContract();
  validateCombatRaidIntegrationContract();
  validateWarriorEmitterContract();
  validateWarriorTournamentIntegrationContract();
  validatePoliticalEmitterContract();
  validatePoliticalClimaxIntegrationContract();
  validatePoliticalLifecycleIntegrationContract();
  validateEndgameEmitterContract();
  validateEndgameMultiCycleIntegrationContract();
  validateEndgameAppTransitionWiringContract();
  validateLegacyCompatibilityContract();
  validateAiObservationIsolationContract();
  validateEventLogRenderingContract();
  validateMapExportIsolationContract();
  console.log('[test:narrative] PASS envelope malformed identity emitter importance collision lifecycle social combat warrior political endgame multi_cycle app_transition legacy retention bounds serialization renderer ai_isolation export_isolation');
}

main();
