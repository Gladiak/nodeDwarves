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
const {
  buildResourceConsequences,
  buildSecondaryActor,
  buildSecondaryLocation,
  emitSecondaryEvent,
} = require('../src/simulation/secondary_events');
const { auditNarrativeProducers } = require('./audit_narrative_producers');
const { buildEventLogPanel } = require('../src/render/event_log_panel');
const { applyStoryRibbon, buildStoryRibbon } = require('../src/render/story_ribbon');
const {
  applyStoryFocusOverlay,
  buildStoryFocusOverlay,
  resolveStoryFocusOverlayConfig,
} = require('../src/render/story_focus_overlay');
const { stripAnsi } = require('../src/utils');
const { buildTelemetrySections } = require('../src/telemetry/telemetry');
const {
  buildTelemetryPanel,
  getTelemetryPanelPageCount,
} = require('../src/telemetry/telemetry_panel');
const {
  collectStoryDirectorTelemetry,
  createStoryDirectorCounterTracker,
  getStoryDirectorCounterReport,
  trackStoryDirectorCounters,
} = require('../src/telemetry/story_director');
const {
  selectPriorityVisibleDwarves,
  sortDwarvesByRenderPriority,
} = require('../src/render/dwarf_visibility');
const {
  HARD_MAX_FREQUENCY_TYPES,
  HARD_MAX_HISTORY,
  HARD_MAX_REASON_TRACE,
  HARD_MAX_SAGAS,
  HARD_MAX_SAGA_EVENT_REFS,
  STORY_SCHEMA_VERSION,
  advanceStoryDirector,
  createStoryDirectorState,
  ensureStoryDirectorState,
  getStoryDirectorConfig,
  processStoryDirectorEvent,
  scoreStoryEvent,
} = require('../src/simulation/story_director');
const {
  HARD_MAX_CHAPTER_EVENT_REFS,
  HARD_MAX_CHAPTER_SUMMARY_CHARS,
  HARD_MAX_SAGA_ACTOR_REFS,
  HARD_MAX_SAGA_CHAPTERS,
} = require('../src/simulation/story_sagas');
const {
  createDwarfIdentityCache,
  formatNamedEventMessage,
  resolveDwarfIdentity,
  resolveDwarfMessageNames,
  snapshotDwarfIdentity,
} = require('../src/dwarf_identity');
const {
  PLACE_REGISTRY_MAX_ENTRIES,
  buildPlaceLocation,
  createPlaceRegistry,
  registerPlace,
  resolvePlaceLabel,
} = require('../src/place_identity');

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
  assert(event && event.message === `Birth: ${event.actors[0].label}`, 'Birth producer did not use the newborn name.');
  assert(!event.message.includes(newborn.id), 'Birth message leaked the newborn raw ID.');
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
  assert(
    event && event.message === `Death: ${event.actors[0].label} (starvation)`,
    'Death producer did not retain the deceased name.',
  );
  assert(!event.message.includes(victimId), 'Death message leaked the deceased raw ID.');
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
  assert(
    event.actors.every((actor) => event.message.includes(actor.label) && !event.message.includes(actor.id)),
    'Partnership message did not replace both raw IDs with names.',
  );
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
      assert(
        event.actors.every((actor) => event.message.includes(actor.label) && !event.message.includes(actor.id)),
        `${fixture.type} message did not replace raw pair IDs with names.`,
      );
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
  assert(
    emitted[7].message.includes(emitted[7].actors[0].label)
      && !emitted[7].message.includes(left.id),
    'Dwarf Champion appointment did not use the resolved display name.',
  );
  assert(
    emitted[8].message.includes('Unknown <dwarf_fallen_champion>'),
    'Missing fallen champion did not use the explicit unknown-ID fallback.',
  );
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
    const knownActors = event.actors.filter((actor) => actor.kind === 'dwarf' && actor.label);
    assert(
      knownActors.some((actor) => event.message.includes(actor.label)),
      `${event.type} message lacks a named dwarf actor.`,
    );
    assert(
      knownActors.every((actor) => !event.message.includes(actor.id)),
      `${event.type} message leaked a raw dwarf ID.`,
    );
  }
  assert(emitted[4].importance === 'major', 'Warrior retirement importance mismatch.');
  assert(
    emitted[4].message.includes(emitted[4].actors[0].label),
    'Warrior retirement message did not retain the retired dwarf name.',
  );
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
    state.warriors.company.hallOfFame[0].identity
      && state.warriors.company.hallOfFame[0].identity.name,
    'Hall of Fame entry did not retain its bounded identity snapshot.',
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
  state.story.currentFocus = {
    eventId: 'evt:v1:c0002:t0000000200:s0000',
    importance: 'legendary',
  };
  state.story.history.push({ eventId: 'evt:v1:c0002:t0000000200:s0000' });
  state.story.sagas.order.push('saga_old_cycle');
  state.story.sagas.byId.saga_old_cycle = { id: 'saga_old_cycle' };
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
    assert(
      state.story.currentFocus
        && state.story.currentFocus.eventId === firstReset.cycleEvent.id,
      'New-cycle closure did not replace the old Story focus after reset.',
    );
    assert(
      !state.story.history.some((focus) => focus.eventId === 'evt:v1:c0002:t0000000200:s0000'),
      'Old Story history leaked across the cycle reset.',
    );
    assert(
      !state.story.sagas.order.includes('saga_old_cycle'),
      'Old Story saga registry entry leaked across the cycle reset.',
    );
    assert(
      firstReset.cycleEvent.sagaId
        && state.story.sagas.order.includes(firstReset.cycleEvent.sagaId),
      'New-cycle closure did not establish its authoritative saga after reset.',
    );
    assert(
      state.story.schemaVersion === STORY_SCHEMA_VERSION,
      'Cycle reset did not reinstall the active Story Director schema.',
    );
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
  state.story.currentFocus = {
    eventId: 'evt:v1:c0000:t0000000000:s0000',
    type: 'lifecycle.settlement_founded',
    importance: 'legendary',
    selectedTick: 0,
    expiresTick: 100,
    actorIds: ['settlement'],
    placeId: null,
  };
  state.story.history.push({ ...state.story.currentFocus, outcome: 'shown' });
  const afterStoryMutation = buildObservation(state, config);
  assert(
    JSON.stringify(afterStoryMutation) === JSON.stringify(before),
    'Story Director state changed the AI observation payload.',
  );
}

// Validate the shared E1.3 boundary and enforce zero direct legacy producer sites.
function validateSecondaryProducerMigrationContract() {
  const config = loadConfig();
  const state = {
    tick: 77,
    cycleStats: { count: 2 },
    events: [],
    eventLog: [],
  };
  let randomCalls = 0;
  const originalRandom = Math.random;
  Math.random = () => {
    randomCalls += 1;
    return 0.5;
  };
  let event;
  try {
    event = emitSecondaryEvent(state, config, {
      type: 'construction.structure_completed',
      category: 'economy',
      message: 'Build: workshop_7',
      actors: [buildSecondaryActor('structure', 'workshop_7', 'primary', 'Workshop')],
      location: { scope: 'surface', depth: 0, x: 12, y: 8 },
      causes: [{
        kind: 'action',
        ref: 'dwarf_actions.job_completion',
        metric: 'worker_id',
        value: 'dwarf_4',
      }],
      consequences: buildResourceConsequences({ stone: 12 }, -1),
      source: 'dwarf_actions',
      tags: ['construction', 'completed'],
    });
  } finally {
    Math.random = originalRandom;
  }
  assert(event && validateNarrativeEvent(event).valid, 'E1.3 shared boundary emitted an invalid v1 event.');
  assert(event.type === 'construction.structure_completed', 'E1.3 event type was not retained.');
  assert(event.location.scope === 'surface' && event.location.x === 12, 'E1.3 location fact was lost.');
  assert(event.actors[0].id === 'workshop_7', 'E1.3 actor snapshot was lost.');
  assert(event.consequences[0].value === -12, 'E1.3 resource consequence sign changed.');
  assert(buildSecondaryLocation(null).scope === 'world', 'E1.3 missing location invented surface coordinates.');
  assert(randomCalls === 0, 'E1.3 structured emission consumed gameplay RNG.');

  const audit = auditNarrativeProducers();
  assert(
    audit.remainingLegacyProducerCount === 0,
    `E1.3 legacy producer audit found ${audit.remainingLegacyProducerCount} direct call site(s).`,
  );
  assert(audit.structuredCallSites > 0, 'E1.3 audit did not identify structured boundary call sites.');
}

// Validate shared live/historical identity resolution and bounded cache behavior.
function validateDwarfIdentityResolverContract() {
  const config = loadConfig();
  const living = {
    id: 'dwarf_identity_1',
    role: 'builder',
    state: { morale: 0.8 },
    warrior: { retired: false },
  };
  const retired = {
    id: 'dwarf_identity_2',
    role: 'gatherer',
    state: { morale: 0.6 },
    warrior: { retired: true },
  };
  const state = {
    tick: 91,
    terrain: { seed: 4242 },
    dwarves: [living, retired],
    eventLog: [{
      id: 'evt:v1:c0000:t0000000090:s0000',
      type: 'lifecycle.death',
      actors: [{ kind: 'dwarf', id: 'dwarf_identity_dead', role: 'victim', label: 'Dorin Ashguard' }],
      consequences: [{ kind: 'death', targetId: 'dwarf_identity_dead' }],
    }],
    warriors: {
      company: {
        hallOfFame: [{
          dwarfId: 'dwarf_identity_legacy',
          identity: {
            name: 'Borin Stoneward',
            house: 'Stone-Ward',
            roleTitle: 'Stone Captain',
          },
        }],
        carryover: {
          sourceChampionId: 'dwarf_identity_legacy',
          sourceChampionIdentity: {
            name: 'Borin Stoneward',
            house: 'Stone-Ward',
            roleTitle: 'Stone Captain',
          },
        },
      },
    },
  };
  const cache = createDwarfIdentityCache(2);
  const liveIdentity = resolveDwarfIdentity(living.id, state, config, { cache });
  assert(liveIdentity.status === 'living' && liveIdentity.source === 'live', 'Live identity status/source mismatch.');
  assert(liveIdentity.name !== 'Unknown' && liveIdentity.house, 'Live identity did not reuse deterministic lore.');
  assert(liveIdentity.roleTitle === 'Oathwright', 'Live identity role title mismatch.');
  assert(liveIdentity.label.endsWith(`<${living.id}>`), 'Live identity label lost its stable ID.');
  assert(Object.isFrozen(liveIdentity), 'Cached identity read model is mutable.');
  assert(
    resolveDwarfIdentity(living.id, state, config, { cache }) === liveIdentity,
    'Repeated live identity resolution missed the operation cache.',
  );
  living.role = 'manager';
  const reassignedIdentity = resolveDwarfIdentity(living.id, state, config, { cache });
  assert(
    reassignedIdentity.roleTitle === 'Hallmaster' && reassignedIdentity.name === liveIdentity.name,
    'Dynamic role invalidation changed stable lore or retained a stale title.',
  );

  const retiredIdentity = resolveDwarfIdentity(retired.id, state, config, { cache });
  assert(retiredIdentity.status === 'retired', 'Living retired dwarf was not classified as retired.');
  const deadIdentity = resolveDwarfIdentity('dwarf_identity_dead', state, config, { cache });
  assert(
    deadIdentity.status === 'dead' && deadIdentity.name === 'Dorin Ashguard',
    'Dead identity did not retain the authoritative event snapshot.',
  );
  assert(deadIdentity.roleTitle === 'Fallen Dwarf', 'Dead identity fallback role title mismatch.');

  const carriedIdentity = resolveDwarfIdentity('dwarf_identity_legacy', state, config, { cache });
  assert(carriedIdentity.status === 'carried_over', 'Carried-over champion status mismatch.');
  assert(
    carriedIdentity.name === 'Borin Stoneward'
      && carriedIdentity.house === 'Stone-Ward'
      && carriedIdentity.roleTitle === 'Stone Captain',
    'Carried-over champion lost its bounded identity snapshot.',
  );
  const missingIdentity = resolveDwarfIdentity('dwarf_identity_missing', state, config, { cache });
  assert(missingIdentity.status === 'missing', 'Unknown identity did not use missing status.');
  assert(
    missingIdentity.label === 'Unknown <dwarf_identity_missing>',
    'Unknown identity did not preserve the explicit fallback ID.',
  );
  assert(cache.identities.size <= 2, 'Dwarf identity cache exceeded its configured hard cap.');

  const unknownMessage = formatNamedEventMessage(
    'Death: dwarf_identity_unknown',
    ['dwarf_identity_unknown'],
    { tick: 1, terrain: { seed: 4242 }, dwarves: [], eventLog: [] },
    config,
  );
  assert(
    unknownMessage === 'Death: Unknown <dwarf_identity_unknown>',
    'Unknown message fallback nested or dropped its stable ID.',
  );
  const collisionState = {
    tick: 1,
    terrain: { seed: 4242 },
    dwarves: [],
    eventLog: [],
    warriors: {
      company: {
        hallOfFame: [
          {
            dwarfId: 'dwarf_twin_a',
            identity: { name: 'Dori Ironhand', house: 'Ash-Forge', roleTitle: 'Oathwright' },
          },
          {
            dwarfId: 'dwarf_twin_b',
            identity: { name: 'Dori Ironhand', house: 'Rune-Hall', roleTitle: 'Hallmaster' },
          },
        ],
        carryover: {},
      },
    },
  };
  const collisionNames = resolveDwarfMessageNames(
    ['dwarf_twin_a', 'dwarf_twin_b'],
    collisionState,
    config,
  ).map((entry) => entry.messageName);
  assert(
    collisionNames[0] === 'Dori Ironhand of House Ash-Forge'
      && collisionNames[1] === 'Dori Ironhand of House Rune-Hall',
    'House context was not limited to a material name collision.',
  );
  const duplicateActorMessage = formatNamedEventMessage(
    `Champion: ${living.id}`,
    [living, living.id],
    state,
    config,
  );
  assert(
    duplicateActorMessage === `Champion: ${reassignedIdentity.name}`,
    'Duplicate references to one actor triggered false identity disambiguation.',
  );

  const twinState = { ...state, dwarves: [clone(living), clone(retired)] };
  const twinIdentity = resolveDwarfIdentity(living.id, twinState, config);
  assert(
    JSON.stringify(snapshotDwarfIdentity(living.id, state, config))
      === JSON.stringify(snapshotDwarfIdentity(living.id, twinState, config)),
    'Equal seed/id identity snapshots diverged.',
  );
  assert(twinIdentity.label === liveIdentity.label, 'Equal seed/id display labels diverged.');
}

// Validate deterministic, bounded, serialized place identity and authoritative UI lookup.
function validatePlaceIdentityRegistryContract() {
  const config = loadConfig();
  const left = { tick: 12, places: createPlaceRegistry() };
  const right = { tick: 12, places: createPlaceRegistry() };
  const draft = { id: 'village_7', kind: 'village', shortName: 'V7', x: 19, y: 8 };
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error('Place identity consumed gameplay RNG.');
  };
  let leftPlace;
  try {
    leftPlace = registerPlace(left, config, draft);
    registerPlace(right, config, draft);
  } finally {
    Math.random = originalRandom;
  }
  assert(leftPlace && leftPlace.name, 'Place identity did not generate a stored name.');
  assert(
    leftPlace.name === right.places.byId.village_7.name,
    'Equal seed/id/coordinates generated different place names.',
  );
  const stableName = leftPlace.name;
  registerPlace(left, config, { ...draft, x: 20, y: 9 });
  assert(left.places.byId.village_7.name === stableName, 'Coordinate refresh renamed an existing place.');
  assert(left.places.byId.village_7.x === 20, 'Existing place coordinates did not refresh.');
  assert(resolvePlaceLabel(left, 'village_7', 'fallback') === stableName, 'Full place label missed state.');
  assert(resolvePlaceLabel(left, 'village_7', 'fallback', true) === 'V7', 'Compact place label missed state.');
  const requiredKinds = [
    { id: 'road_hold_mine', kind: 'road', x: 20, y: 9 },
    { id: 'underrealm_gate', kind: 'gate', x: 5, y: 4 },
    { id: 'deep_lift_d2', kind: 'lift', scope: 'underrealm', depth: 2 },
    { id: 'ruins_d2', kind: 'ruins', scope: 'underrealm', depth: 2 },
    { id: 'temple_of_ancestors', kind: 'temple', x: 22, y: 10 },
  ];
  for (const required of requiredKinds) {
    const registered = registerPlace(left, config, required);
    assert(registered && registered.kind === required.kind && registered.name, `Missing ${required.kind} identity.`);
  }
  const location = buildPlaceLocation(left, 'village_7');
  assert(
    location.placeId === 'village_7' && location.label === stableName && location.shortLabel === 'V7',
    'Canonical place location lost full or compact authoritative labels.',
  );

  const serialized = JSON.parse(JSON.stringify(left));
  assert(
    resolvePlaceLabel(serialized, 'village_7') === stableName,
    'Place identity did not survive JSON serialization.',
  );
  const bounded = { tick: 0, places: createPlaceRegistry() };
  for (let index = 0; index < PLACE_REGISTRY_MAX_ENTRIES + 3; index += 1) {
    registerPlace(bounded, config, { id: `road_${index}`, kind: 'road', x: index, y: 0 });
  }
  assert(
    bounded.places.order.length === PLACE_REGISTRY_MAX_ENTRIES && bounded.places.rejected === 3,
    'Place registry hard cap or rejection counter drifted.',
  );

  const runtime = buildRuntime(config.display, { columns: 100, rows: 32 });
  const initial = createInitialState(config, runtime);
  assert(initial.places.byId.underrealm_gate, 'Initial state did not register the Underrealm gate.');
  assert(initial.places.byId.ruins_d1, 'Initial state did not register depth ruins.');

  const renderState = {
    tick: 12,
    places: left.places,
    eventLog: [{
      ...buildValidEvent({ tick: 12, sequence: 0 }),
      message: 'Village founded',
      location: { ...location, label: 'Stale renderer label' },
    }],
    events: [],
    ui: { eventLog: { open: true, offset: 0, filter: 'all' } },
  };
  const panel = buildEventLogPanel(renderState, {
    display: { event_log_panel: { enabled: true, width: 100, height: 18 } },
  }, { gridWidth: 100, gridHeight: 24 });
  const rendered = panel.lines.map((line) => String(line.text || '').trim()).join(' ');
  assert(rendered.includes(`At: ${stableName}`), 'Event Log did not prefer authoritative place state.');
  assert(!rendered.includes('Stale renderer label'), 'Event Log trusted a stale retained place label.');
}

// Validate bounded story-priority visibility above the configured surface/deep render cap.
function validateDwarfPriorityVisibilityContract() {
  const dwarves = Array.from({ length: 80 }, (_, index) => ({
    id: `dwarf_${index + 1}`,
    lifeStage: 'adult',
    needs: { hunger: 0.1, thirst: 0.1 },
    state: { health: 1, morale: 0.8 },
    starvationTicks: 0,
  }));
  dwarves[78].lifeStage = 'child';
  dwarves[77].state.health = 0.2;
  const state = {
    tick: 1000,
    dwarves,
    renderState: { visibleDwarfIds: ['dwarf_1', 'dwarf_2', 'dwarf_3', 'dwarf_4', 'dwarf_5', 'dwarf_6'] },
    warriors: { league: { championId: 'dwarf_77' } },
    underrealm: { combat: { dwarfChampion: { activeDwarfId: null } } },
    eventLog: [
      {
        tick: 1000,
        importance: 'critical',
        sagaId: null,
        actors: [{ kind: 'dwarf', id: 'dwarf_79', role: 'victim' }],
      },
      {
        tick: 990,
        importance: 'notable',
        sagaId: null,
        actors: [{ kind: 'dwarf', id: 'dwarf_75', role: 'primary' }],
      },
      {
        tick: 500,
        importance: 'major',
        sagaId: 'saga.deep_oath',
        actors: [{ kind: 'dwarf', id: 'dwarf_76', role: 'primary' }],
      },
    ],
  };
  const config = { display: { dwarves: { maxVisible: 6 } } };
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error('Priority visibility consumed gameplay RNG.');
  };
  let first;
  let second;
  try {
    first = selectPriorityVisibleDwarves(state, config).map((dwarf) => dwarf.id);
    second = selectPriorityVisibleDwarves(state, config).map((dwarf) => dwarf.id);
  } finally {
    Math.random = originalRandom;
  }
  for (const required of ['dwarf_79', 'dwarf_78', 'dwarf_77', 'dwarf_76', 'dwarf_75', 'dwarf_1']) {
    assert(first.includes(required), `Priority visibility omitted ${required} above maxVisible.`);
  }
  assert(first.length === 6, 'Priority visibility exceeded maxVisible.');
  assert(JSON.stringify(first) === JSON.stringify(second), 'Priority visibility flickered without state changes.');

  state.eventLog.unshift({
    tick: 1000,
    importance: 'legendary',
    sagaId: null,
    actors: [{ kind: 'dwarf', id: 'dwarf_74', role: 'primary' }],
  });
  const preempted = selectPriorityVisibleDwarves(state, config).map((dwarf) => dwarf.id);
  assert(preempted.includes('dwarf_74') && preempted.includes('dwarf_79'), 'Legendary actor did not preempt a lower tier.');
  assert(!preempted.includes('dwarf_1'), 'New urgent story actor failed to evict the retained fallback slot.');

  const deepCandidates = dwarves.filter((dwarf) => Number(dwarf.id.split('_')[1]) >= 70);
  const deepSorted = sortDwarvesByRenderPriority(state, deepCandidates).map((dwarf) => dwarf.id);
  assert(
    deepSorted.indexOf('dwarf_74') < deepSorted.indexOf('dwarf_70')
      && deepSorted.indexOf('dwarf_79') < deepSorted.indexOf('dwarf_70'),
    'Layer-local Underrealm ranking did not share urgent story priority.',
  );

  const hidden = selectPriorityVisibleDwarves(clone(state), {
    display: { dwarves: { maxVisible: -1 } },
  });
  assert(hidden.length === 0, 'Priority visibility changed the negative hidden-cap contract.');
  const unlimited = selectPriorityVisibleDwarves(clone(state), {
    display: { dwarves: { maxVisible: 0 } },
  });
  assert(unlimited.length === dwarves.length, 'Priority visibility changed the zero unlimited-cap contract.');
}

// Validate the empty E3.1 Director substrate, hard bounds, and RNG/time isolation.
function validateStoryDirectorStateContract() {
  const config = loadConfig();
  const settings = getStoryDirectorConfig(config);
  assert(settings.enabled === true, 'Story Director default should be enabled.');
  assert(settings.focus.minimumImportance === 'major', 'Story focus importance default drifted.');
  assert(settings.focus.cooldownTicks === 180, 'Story focus cooldown default drifted.');
  assert(settings.focus.durationTicks === 240, 'Story focus duration default drifted.');
  assert(
    settings.focus.interruptionBudget.windowTicks === 1200
      && settings.focus.interruptionBudget.maxInterruptions === 3,
    'Story interruption-budget defaults drifted.',
  );
  assert(
    settings.focus.escalation.enabled === true
      && settings.focus.escalation.minimumImportance === 'critical'
      && settings.focus.escalation.cooldownTicks === 60,
    'Story escalation defaults drifted.',
  );
  assert(
    settings.sagas.inactivityTimeoutTicks === 2400
      && settings.sagas.archiveTimeoutTicks === 7200
      && settings.sagas.maxEntries === 24
      && settings.sagas.maxEventRefs === 16
      && settings.sagas.maxChapters === 8
      && settings.sagas.maxEventsPerChapter === 4,
    'Story saga defaults drifted.',
  );
  assert(
    settings.history.maxEntries === 160 && settings.history.reasonTraceMaxEntries === 160,
    'Story history defaults drifted.',
  );
  assert(
    settings.scoring.rarity.maxTrackedTypes === 128
      && settings.scoring.importance.legendary === 120,
    'Story scoring defaults drifted.',
  );

  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error('E3.1 Story Director state consumed gameplay RNG.');
  };
  let left;
  let right;
  try {
    left = createStoryDirectorState(config);
    right = createStoryDirectorState(config);
  } finally {
    Math.random = originalRandom;
  }
  assert(JSON.stringify(left) === JSON.stringify(right), 'Equal config created different Story Director state.');
  assert(left.schemaVersion === STORY_SCHEMA_VERSION, 'Story schema version mismatch.');
  assert(left.currentFocus === null, 'E3.1 invented a current focus before E3.2.');
  assert(left.sagas.order.length === 0 && left.history.length === 0, 'E3.1 invented story history.');

  const extremeConfig = {
    story_director: {
      enabled: true,
      focus: {
        minimum_importance: 'invalid',
        cooldown_ticks: -10,
        duration_ticks: 0,
        interruption_budget: { window_ticks: 0, max_interruptions: 999999 },
        escalation: { enabled: true, minimum_importance: 'invalid', cooldown_ticks: -5 },
      },
      scoring: { rarity: { max_tracked_types: 999999 } },
      sagas: {
        inactivity_timeout_ticks: 0,
        archive_timeout_ticks: 0,
        max_entries: 999999,
        max_event_refs: 999999,
        max_actor_refs: 999999,
        chapters: {
          max_entries: 999999,
          max_event_refs: 999999,
          summary_max_chars: 999999,
        },
      },
      history: { max_entries: 999999, reason_trace_max_entries: 999999 },
    },
  };
  const extreme = getStoryDirectorConfig(extremeConfig);
  assert(extreme.focus.minimumImportance === 'major', 'Invalid focus importance did not fall back.');
  assert(extreme.focus.cooldownTicks === 0, 'Focus cooldown lower bound failed.');
  assert(extreme.focus.durationTicks === 1, 'Focus duration lower bound failed.');
  assert(extreme.focus.interruptionBudget.windowTicks === 1, 'Budget window lower bound failed.');
  assert(extreme.focus.interruptionBudget.maxInterruptions === 1000, 'Budget count hard bound failed.');
  assert(extreme.focus.escalation.minimumImportance === 'critical', 'Escalation importance fallback failed.');
  assert(extreme.focus.escalation.cooldownTicks === 0, 'Escalation cooldown lower bound failed.');
  assert(
    extreme.scoring.rarity.maxTrackedTypes === HARD_MAX_FREQUENCY_TYPES,
    'Frequency registry hard cap failed.',
  );
  assert(extreme.sagas.maxEntries === HARD_MAX_SAGAS, 'Saga registry hard cap failed.');
  assert(extreme.sagas.maxEventRefs === HARD_MAX_SAGA_EVENT_REFS, 'Saga event-ref hard cap failed.');
  assert(extreme.sagas.maxActorRefs === HARD_MAX_SAGA_ACTOR_REFS, 'Saga actor-ref hard cap failed.');
  assert(extreme.sagas.maxChapters === HARD_MAX_SAGA_CHAPTERS, 'Saga chapter hard cap failed.');
  assert(
    extreme.sagas.maxEventsPerChapter === HARD_MAX_CHAPTER_EVENT_REFS,
    'Saga chapter event-ref hard cap failed.',
  );
  assert(
    extreme.sagas.chapterSummaryMaxChars === HARD_MAX_CHAPTER_SUMMARY_CHARS,
    'Saga chapter summary hard cap failed.',
  );
  assert(extreme.history.maxEntries === HARD_MAX_HISTORY, 'Story history hard cap failed.');
  assert(
    extreme.history.reasonTraceMaxEntries === HARD_MAX_REASON_TRACE,
    'Reason-trace hard cap failed.',
  );
  assert(
    getStoryDirectorConfig({ story_director: { history: { reason_trace_max_entries: 0 } } })
      .history.reasonTraceMaxEntries === 1,
    'Reason trace could be disabled despite mandatory suppression explainability.',
  );

  const sagaEntries = Array.from({ length: HARD_MAX_SAGAS + 10 }, (_, index) => [`saga_${index}`, {
    status: 'ACTIVE',
    openedTick: index,
    lastEventTick: 999,
    eventIds: Array.from(
      { length: HARD_MAX_SAGA_EVENT_REFS + 10 },
      (__, ref) => `evt_${index}_${ref}`,
    ),
    actorIds: Array.from({ length: 20 }, (__, ref) => `dwarf_${ref}`),
    placeIds: Array.from({ length: 20 }, (__, ref) => `place_${ref}`),
  }]);
  const dirtyState = {
    tick: 999,
    story: {
      schemaVersion: 99,
      enabled: true,
      currentFocus: {
        eventId: 'EVT:V1:C0000:T0000000999:S0000',
        type: 'Combat.Deep_Raid',
        importance: 'CRITICAL',
        selectedTick: 999,
        expiresTick: 1200,
        actorIds: Array.from({ length: 20 }, (_, index) => `DWARF_${index}`),
      },
      sagas: {
        order: sagaEntries.map(([id]) => id),
        byId: Object.fromEntries(sagaEntries),
      },
      cooldowns: { focusUntilTick: -4, escalationUntilTick: Infinity },
      interruptionBudget: { windowStartedTick: -1, used: 999999 },
      frequencies: {
        order: Array.from({ length: HARD_MAX_FREQUENCY_TYPES + 10 }, (_, index) => `type_${index}`),
        byType: Object.fromEntries(
          Array.from(
            { length: HARD_MAX_FREQUENCY_TYPES + 10 },
            (_, index) => [`type_${index}`, index + 1],
          ),
        ),
      },
      history: Array.from({ length: HARD_MAX_HISTORY + 10 }, (_, index) => ({
        eventId: `evt_history_${index}`,
        importance: 'major',
        selectedTick: index,
        expiresTick: index + 1,
        actorIds: ['dwarf_1'],
        reasonCode: 'selected',
        outcome: 'shown',
      })),
      reasonTrace: Array.from({ length: HARD_MAX_REASON_TRACE + 10 }, (_, index) => ({
        tick: index,
        eventId: `evt_trace_${index}`,
        decision: 'suppressed',
        reasonCode: 'cooldown',
        score: index,
      })),
      cursor: { lastEventId: 'EVENT_LAST', lastTick: 999 },
      stats: { considered: -1, selected: Infinity, suppressed: 3 },
    },
  };
  const repaired = ensureStoryDirectorState(dirtyState, extremeConfig);
  assert(repaired.schemaVersion === STORY_SCHEMA_VERSION, 'Story repair did not restore schema version.');
  assert(repaired.currentFocus.actorIds.length === 8, 'Current-focus actor refs exceeded their cap.');
  assert(repaired.sagas.order.length === HARD_MAX_SAGAS, 'Repaired saga registry exceeded hard cap.');
  assert(
    repaired.sagas.byId.saga_0.eventIds.length === HARD_MAX_SAGA_EVENT_REFS,
    'Repaired saga event references exceeded hard cap.',
  );
  assert(repaired.history.length === HARD_MAX_HISTORY, 'Repaired story history exceeded hard cap.');
  assert(
    repaired.reasonTrace.length === HARD_MAX_REASON_TRACE,
    'Repaired reason trace exceeded hard cap.',
  );
  assert(repaired.interruptionBudget.used === 1000, 'Repaired budget usage exceeded configured cap.');
  assert(
    repaired.frequencies.order.length === HARD_MAX_FREQUENCY_TYPES,
    'Repaired frequency registry exceeded its hard cap.',
  );
  assert(repaired.cooldowns.focusUntilTick === 0, 'Negative focus cooldown survived repair.');
  assert(repaired.stats.considered === 0 && repaired.stats.selected === 0, 'Invalid stats survived repair.');
  const unsafeRegistry = ensureStoryDirectorState({
    story: {
      sagas: {
        order: ['__proto__'],
        byId: JSON.parse('{"__proto__":{"status":"active"}}'),
      },
    },
  }, config);
  assert(unsafeRegistry.sagas.order.length === 0, 'Unsafe saga registry key survived repair.');
  const serialized = JSON.parse(JSON.stringify(repaired));
  const roundTrip = ensureStoryDirectorState({ story: serialized }, extremeConfig);
  assert(JSON.stringify(roundTrip) === JSON.stringify(repaired), 'Story state JSON round-trip drifted.');

  const source = fs.readFileSync(path.join(ROOT, 'src/simulation/story_director.js'), 'utf8');
  assert(!source.includes('Math.random'), 'Story Director source references gameplay RNG.');
  assert(!source.includes('Date.now'), 'Story Director source references wall-clock time.');
  assert(!source.includes('performance.now'), 'Story Director source references render timing.');
  assert(!source.includes('process.hrtime'), 'Story Director source references process timing.');
}

// Validate E3.2 score components, cooldowns, escalation, preemption, and reason traces.
function validateStoryDirectorSelectionContract() {
  const config = clone(loadConfig());
  config.story_director.focus.minimum_importance = 'notable';
  config.story_director.focus.cooldown_ticks = 80;
  config.story_director.focus.duration_ticks = 500;
  config.story_director.focus.escalation.cooldown_ticks = 10;
  config.story_director.focus.interruption_budget.window_ticks = 200;
  config.story_director.focus.interruption_budget.max_interruptions = 2;
  const state = {
    tick: 10,
    underrealm: { activeDepth: 0 },
    story: createStoryDirectorState(config),
  };
  const eventAt = (tick, sequence, overrides = {}) => buildValidEvent({
    tick,
    sequence,
    id: buildNarrativeEventId(0, tick, sequence),
    ...overrides,
  });

  const notable = eventAt(10, 0, { sagaId: 'saga_alpha' });
  const initialScore = scoreStoryEvent(state, config, notable);
  assert(
    initialScore.severityScore === 25
      && initialScore.rarityScore === 18
      && initialScore.namedActorScore === 8
      && initialScore.consequenceScore === 5
      && initialScore.visibilityScore === 12
      && initialScore.total === 68,
    'Story score component formula drifted.',
  );
  assert(
    processStoryDirectorEvent(state, config, notable).reasonCode === 'selected_focus',
    'First eligible Story event was not selected.',
  );
  assert(state.story.currentFocus.eventId === notable.id, 'Selected focus identity mismatch.');
  const repeated = eventAt(11, 0, { importance: 'major', sagaId: 'saga_alpha' });
  const repeatedScore = scoreStoryEvent(state, config, repeated);
  assert(repeatedScore.rarityScore === 9, 'Repeated event type did not lose rarity score.');
  assert(repeatedScore.currentSagaScore === 24, 'Current-saga continuity bonus was not applied.');
  assert(
    processStoryDirectorEvent(state, config, repeated).reasonCode === 'focus_active',
    'Non-escalating event interrupted an active focus.',
  );

  const critical = eventAt(12, 0, {
    type: 'combat.deep_raid_casualties',
    category: 'combat',
    importance: 'critical',
    sagaId: null,
  });
  assert(
    processStoryDirectorEvent(state, config, critical).reasonCode === 'selected_preemption',
    'Critical event did not preempt notable focus.',
  );
  assert(state.story.history[0].eventId === notable.id, 'Preempted focus was not retained in history.');
  assert(state.story.interruptionBudget.used === 1, 'First preemption did not consume its budget.');

  const cooldownCritical = eventAt(13, 0, {
    type: 'schism.climax_started',
    category: 'schism',
    importance: 'critical',
    actors: [
      ...notable.actors,
      { kind: 'faction', id: 'council', role: 'secondary', label: 'Ember Council' },
    ],
    consequences: [...notable.consequences, ...notable.consequences],
  });
  assert(
    processStoryDirectorEvent(state, config, cooldownCritical).reasonCode === 'escalation_cooldown',
    'Escalation cooldown did not suppress a stronger same-tier event.',
  );

  const legendary = eventAt(22, 0, {
    type: 'world.legendary_crisis',
    category: 'world',
    importance: 'legendary',
    actors: [],
    consequences: [],
    location: { scope: 'underrealm', depth: 2, x: 4, y: 5, placeId: null, label: null },
  });
  assert(
    processStoryDirectorEvent(state, config, legendary).reasonCode === 'selected_preemption',
    'Legendary escalation did not preempt after cooldown.',
  );
  assert(state.story.interruptionBudget.used === 2, 'Second preemption did not consume its budget.');

  const actors = Array.from({ length: 3 }, (_, index) => ({
    kind: 'dwarf',
    id: `dwarf_budget_${index}`,
    role: index === 0 ? 'primary' : 'secondary',
    label: `Budget Dwarf ${index}`,
  }));
  const consequences = Array.from({ length: 4 }, (_, index) => ({
    kind: 'status',
    targetKind: 'world',
    targetId: `budget_${index}`,
    metric: null,
    value: null,
    unit: null,
  }));
  const budgetBlocked = eventAt(32, 0, {
    type: 'endgame.artifact_collection_completed',
    category: 'other',
    importance: 'legendary',
    actors,
    consequences,
  });
  assert(
    processStoryDirectorEvent(state, config, budgetBlocked).reasonCode
      === 'interruption_budget_exhausted',
    'Interruption budget did not suppress a third escalation.',
  );
  const ambient = eventAt(33, 0, { type: 'weather.changed', importance: 'ambient' });
  assert(
    processStoryDirectorEvent(state, config, ambient).reasonCode === 'below_minimum_importance',
    'Minimum importance threshold did not suppress ambient focus.',
  );
  const refreshedBudget = eventAt(212, 0, {
    type: budgetBlocked.type,
    category: budgetBlocked.category,
    importance: 'legendary',
    actors,
    consequences,
  });
  assert(
    processStoryDirectorEvent(state, config, refreshedBudget).reasonCode === 'selected_preemption'
      && state.story.interruptionBudget.used === 1
      && state.story.interruptionBudget.windowStartedTick === 212,
    'Interruption budget window did not reset deterministically.',
  );
  assert(
    state.story.reasonTrace.length === state.story.stats.considered
      && state.story.stats.selected === 4
      && state.story.stats.suppressed === 4
      && state.story.stats.preempted === 3,
    'Story selection counters and reason trace diverged.',
  );
  assert(
    state.story.reasonTrace.every((trace) => Number.isFinite(trace.score)
      && Number.isFinite(trace.severityScore)
      && Number.isFinite(trace.visibilityScore)),
    'Story reason trace omitted score components.',
  );
  assert(
    processStoryDirectorEvent(state, config, ambient).decision === 'ignored',
    'Story cursor reprocessed a duplicate canonical event.',
  );

  state.tick = state.story.currentFocus.expiresTick;
  advanceStoryDirector(state, config);
  assert(state.story.currentFocus === null, 'Story focus did not expire on simulation ticks.');
  assert(
    state.story.history[state.story.history.length - 1].outcome === 'expired',
    'Expired focus did not enter bounded history.',
  );

  const directConfig = clone(config);
  directConfig.events.logMaxEntries = 0;
  const directState = {
    tick: 44,
    cycleStats: { count: 0 },
    events: [],
    eventLog: [],
    underrealm: { activeDepth: 0 },
  };
  const directEvent = pushEvent(directState, directConfig, {
    ...eventAt(44, 0, { importance: 'major' }),
    id: undefined,
    cycle: undefined,
    tick: undefined,
    sequence: undefined,
  });
  assert(directEvent && directState.eventLog.length === 0, 'Zero Event Log retention contract drifted.');
  assert(
    directState.story.currentFocus && directState.story.currentFocus.eventId === directEvent.id,
    'Story Director depended on Event Log retention to receive an event.',
  );

  const deterministicLeft = { tick: 10, underrealm: { activeDepth: 0 }, story: createStoryDirectorState(config) };
  const deterministicRight = clone(deterministicLeft);
  const sequence = [
    notable,
    repeated,
    critical,
    cooldownCritical,
    legendary,
    budgetBlocked,
    ambient,
    refreshedBudget,
  ];
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error('E3.2 Story selection consumed gameplay RNG.');
  };
  try {
    for (const event of sequence) {
      processStoryDirectorEvent(deterministicLeft, config, event);
      processStoryDirectorEvent(deterministicRight, config, event);
    }
  } finally {
    Math.random = originalRandom;
  }
  assert(
    JSON.stringify(deterministicLeft.story) === JSON.stringify(deterministicRight.story),
    'Equal event streams produced different Story Director decisions.',
  );
}

// Validate E3.3 causal grouping, deterministic IDs, saga lifecycle, and fact-backed chapters.
function validateStorySagaAggregationContract() {
  const config = clone(loadConfig());
  config.story_director.focus.minimum_importance = 'legendary';
  config.story_director.sagas.inactivity_timeout_ticks = 10;
  config.story_director.sagas.archive_timeout_ticks = 30;
  config.story_director.sagas.chapters.max_entries = 2;
  config.story_director.sagas.chapters.max_event_refs = 2;
  config.story_director.sagas.chapters.summary_max_chars = 64;
  const eventAt = (tick, sequence, overrides = {}) => buildValidEvent({
    tick,
    sequence,
    id: buildNarrativeEventId(0, tick, sequence),
    importance: 'major',
    ...overrides,
  });
  const actor = (kind, id, label = id) => ({ kind, id, role: 'primary', label });
  const location = (placeId, x, y) => ({
    scope: 'surface',
    depth: 0,
    x,
    y,
    placeId,
    label: placeId,
  });
  const state = {
    tick: 0,
    underrealm: { activeDepth: 0 },
    story: createStoryDirectorState(config),
  };

  const opening = eventAt(1, 0, {
    type: 'social.grudge_escalation',
    actors: [actor('dwarf', 'dwarf_arc', 'Dori Arc')],
    location: location('ember_forge', 4, 5),
    message: 'Dori Arc challenges the old oath',
  });
  processStoryDirectorEvent(state, config, opening);
  assert(opening.sagaId === 'saga_c0000_0000', 'Generated saga identity mismatch.');
  const actorLinked = eventAt(2, 0, {
    type: 'social.rivalry_clash',
    actors: [actor('dwarf', 'dwarf_arc', 'Dori Arc')],
    location: location('far_gate', 18, 7),
    message: 'Dori Arc confronts a rival at Far Gate',
  });
  processStoryDirectorEvent(state, config, actorLinked);
  assert(actorLinked.sagaId === opening.sagaId, 'Shared actor did not join its existing saga.');
  const placeLinked = eventAt(3, 0, {
    type: 'construction.structure_milestone',
    actors: [actor('structure', 'forge_hall', 'Forge Hall')],
    location: location('ember_forge', 4, 5),
    message: 'Forge Hall is completed at Ember Forge',
  });
  processStoryDirectorEvent(state, config, placeLinked);
  assert(placeLinked.sagaId === opening.sagaId, 'Shared place did not join its existing saga.');
  const firstSaga = state.story.sagas.byId[opening.sagaId];
  assert(firstSaga.status === 'active' && firstSaga.eventCount === 3, 'Saga did not activate by event count.');

  const factionOpening = eventAt(4, 0, {
    type: 'diplomacy.faction_pressure',
    category: 'diplomacy',
    actors: [actor('faction', 'ashen_compact', 'Ashen Compact')],
    location: { scope: 'world', depth: null, x: null, y: null, placeId: null, label: null },
  });
  processStoryDirectorEvent(state, config, factionOpening);
  const factionLinked = eventAt(5, 0, {
    type: 'diplomacy.faction_demand',
    category: 'diplomacy',
    actors: [actor('faction', 'ashen_compact', 'Ashen Compact')],
  });
  processStoryDirectorEvent(state, config, factionLinked);
  assert(factionLinked.sagaId === factionOpening.sagaId, 'Shared faction did not group deterministically.');

  const threatOpening = eventAt(6, 0, {
    type: 'combat.threat_sighted',
    category: 'combat',
    actors: [actor('threat', 'wyrm_01', 'The Cinder Wyrm')],
  });
  processStoryDirectorEvent(state, config, threatOpening);
  const threatLinked = eventAt(7, 0, {
    type: 'combat.threat_advanced',
    category: 'combat',
    actors: [actor('threat', 'wyrm_01', 'The Cinder Wyrm')],
  });
  processStoryDirectorEvent(state, config, threatLinked);
  assert(threatLinked.sagaId === threatOpening.sagaId, 'Shared threat did not group deterministically.');

  const parent = eventAt(8, 0, {
    type: 'world.parent_fact',
    category: 'world',
    actors: [actor('artifact', 'parent_relic', 'Parent Relic')],
  });
  processStoryDirectorEvent(state, config, parent);
  const child = eventAt(9, 0, {
    type: 'world.child_fact',
    category: 'world',
    actors: [],
    causes: [{ kind: 'event', ref: parent.id, metric: null, value: null }],
  });
  processStoryDirectorEvent(state, config, child);
  assert(child.sagaId === parent.sagaId, 'Explicit parent event did not preserve causal saga membership.');

  const explicit = eventAt(10, 0, {
    type: 'endgame.transition_started',
    category: 'other',
    importance: 'critical',
    sagaId: 'explicit_cycle_arc',
    actors: [],
  });
  processStoryDirectorEvent(state, config, explicit);
  assert(
    explicit.sagaId === 'explicit_cycle_arc' && state.story.sagas.byId.explicit_cycle_arc,
    'Producer-owned explicit saga ID was not authoritative.',
  );
  const explicitContinuation = eventAt(11, 0, {
    type: 'endgame.transition_advanced',
    category: 'other',
    sagaId: 'explicit_cycle_arc',
    actors: [],
  });
  processStoryDirectorEvent(state, config, explicitContinuation);
  assert(explicitContinuation.sagaId === explicit.sagaId, 'Explicit saga continuation drifted.');

  const resolved = eventAt(12, 0, {
    type: 'combat.deep_raid_resolved',
    category: 'combat',
    actors: [actor('dwarf', 'dwarf_arc', 'Dori Arc')],
  });
  processStoryDirectorEvent(state, config, resolved);
  const resolvedSaga = state.story.sagas.byId[opening.sagaId];
  assert(
    resolvedSaga.status === 'resolved'
      && resolvedSaga.resolutionEventId === resolved.id
      && resolvedSaga.chapters[resolvedSaga.chapters.length - 1].status === 'closed',
    'Resolved saga lifecycle did not close on an authoritative fact.',
  );
  const failed = eventAt(13, 0, {
    type: 'contract.failed',
    category: 'diplomacy',
    actors: [actor('caravan', 'failed_caravan', 'Failed Caravan')],
  });
  processStoryDirectorEvent(state, config, failed);
  assert(state.story.sagas.byId[failed.sagaId].status === 'failed', 'Failure fact did not fail its saga.');
  assert(validateNarrativeEvent(opening).valid, 'Director-generated saga ID broke the v1 event contract.');

  const runtimeFixture = buildLifecycleFixture();
  const runtimeEvent = pushEvent(runtimeFixture.state, runtimeFixture.config, {
    type: 'world.saga_runtime_fact',
    category: 'world',
    importance: 'major',
    message: 'A runtime fact opens a retained saga',
    source: 'story_saga_contract',
    actors: [actor('artifact', 'runtime_relic', 'Runtime Relic')],
  });
  assert(
    runtimeEvent
      && runtimeEvent.sagaId === 'saga_c0000_0000'
      && runtimeFixture.state.eventLog[0].sagaId === runtimeEvent.sagaId,
    'Committed runtime event did not expose its assigned saga through Event Log retention.',
  );
  assert(
    Buffer.byteLength(JSON.stringify(runtimeEvent), 'utf8') <= MAX_SERIALIZED_EVENT_BYTES
      && validateNarrativeEvent(runtimeEvent).valid,
    'Post-saga runtime event violated the canonical serialization contract.',
  );

  const chapterState = {
    tick: 0,
    underrealm: { activeDepth: 0 },
    story: createStoryDirectorState(config),
  };
  const chapterEvents = Array.from({ length: 6 }, (_, index) => eventAt(index + 1, 0, {
    type: `world.chapter_beat_${index}`,
    actors: [actor('dwarf', 'chapter_dwarf', 'Chapter Dwarf')],
    message: `Beat ${index}`,
  }));
  for (const event of chapterEvents) processStoryDirectorEvent(chapterState, config, event);
  let chapterSaga = chapterState.story.sagas.byId[chapterEvents[0].sagaId];
  assert(
    chapterSaga.chapters.length === 2
      && chapterSaga.chaptersCompacted === 1
      && chapterSaga.chapters.every((chapter) => chapter.eventIds.length <= 2),
    'Saga chapter or source-reference bounds failed.',
  );
  assert(
    chapterSaga.chapters[0].summary === 'Beat 2 Then: Beat 3'
      && chapterSaga.chapters[1].summary === 'Beat 4 Then: Beat 5',
    'Chapter summaries were not derived exactly from canonical facts.',
  );
  assert(
    chapterSaga.chapters.every((chapter) => chapter.eventIds.every((id) => (
      chapterEvents.some((event) => event.id === id)
    ))),
    'Chapter retained a source ID outside its canonical input facts.',
  );
  chapterSaga.chapters.forEach((chapter) => { chapter.status = 'active'; });
  chapterSaga.nextChapterSequence = 0;
  ensureStoryDirectorState(chapterState, config);
  chapterSaga = chapterState.story.sagas.byId[chapterEvents[0].sagaId];
  assert(
    chapterSaga.chapters[0].status === 'closed'
      && chapterSaga.nextChapterSequence >= 3,
    'Serialized saga repair did not close stale chapters or preserve monotonic chapter identity.',
  );
  chapterState.tick = 16;
  advanceStoryDirector(chapterState, config);
  chapterSaga = chapterState.story.sagas.byId[chapterEvents[0].sagaId];
  assert(chapterSaga.status === 'dormant', 'Inactive saga did not become dormant.');
  const reactivated = eventAt(17, 0, {
    type: 'world.chapter_return',
    actors: [actor('dwarf', 'chapter_dwarf', 'Chapter Dwarf')],
    message: 'Chapter Dwarf returns',
  });
  processStoryDirectorEvent(chapterState, config, reactivated);
  chapterSaga = chapterState.story.sagas.byId[chapterEvents[0].sagaId];
  assert(reactivated.sagaId === chapterSaga.id && chapterSaga.status === 'active', 'Dormant saga did not reactivate.');
  chapterState.tick = 47;
  advanceStoryDirector(chapterState, config);
  chapterSaga = chapterState.story.sagas.byId[chapterEvents[0].sagaId];
  assert(chapterSaga.status === 'archived' && chapterSaga.archivedTick === 47, 'Saga did not archive on timeout.');

  const capacityConfig = clone(config);
  capacityConfig.story_director.sagas.max_entries = 2;
  const capacityState = {
    tick: 0,
    underrealm: { activeDepth: 0 },
    story: createStoryDirectorState(capacityConfig),
  };
  const capacityEvents = Array.from({ length: 3 }, (_, index) => eventAt(index + 1, 0, {
    type: `world.capacity_${index}`,
    actors: [actor('artifact', `capacity_${index}`, `Capacity ${index}`)],
  }));
  for (const event of capacityEvents) processStoryDirectorEvent(capacityState, capacityConfig, event);
  assert(
    capacityState.story.sagas.order.length === 2
      && !capacityState.story.sagas.byId.saga_c0000_0000
      && capacityState.story.stats.sagasEvicted === 1,
    'Full saga registry did not evict the deterministic oldest candidate.',
  );

  const deterministicTemplates = Array.from({ length: 5 }, (_, index) => eventAt(index + 1, 0, {
    type: `world.deterministic_${index}`,
    actors: [actor('dwarf', 'deterministic_dwarf', 'Deterministic Dwarf')],
    message: `Deterministic beat ${index}`,
  }));
  const deterministicLeft = {
    tick: 0,
    underrealm: { activeDepth: 0 },
    story: createStoryDirectorState(config),
  };
  const deterministicRight = clone(deterministicLeft);
  const leftEvents = clone(deterministicTemplates);
  const rightEvents = clone(deterministicTemplates);
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error('E3.3 saga aggregation consumed gameplay RNG.');
  };
  try {
    for (const event of leftEvents) processStoryDirectorEvent(deterministicLeft, config, event);
    for (const event of rightEvents) processStoryDirectorEvent(deterministicRight, config, event);
  } finally {
    Math.random = originalRandom;
  }
  assert(
    JSON.stringify(deterministicLeft.story) === JSON.stringify(deterministicRight.story)
      && JSON.stringify(leftEvents.map((event) => event.sagaId))
        === JSON.stringify(rightEvents.map((event) => event.sagaId)),
    'Equal causal streams produced different saga IDs or state.',
  );
  const sagaSource = fs.readFileSync(path.join(ROOT, 'src/simulation/story_sagas.js'), 'utf8');
  assert(!sagaSource.includes('Math.random'), 'Saga aggregation source references gameplay RNG.');
  assert(!sagaSource.includes('Date.now'), 'Saga aggregation source references wall-clock time.');
  assert(!sagaSource.includes('performance.now'), 'Saga aggregation source references render timing.');
}

// Validate E3.4 telemetry, priority coverage, and reset-safe headless counters.
function validateStoryDirectorTelemetryContract() {
  const config = clone(loadConfig());
  config.story_director.focus.escalation.enabled = false;
  const eventAt = (tick, sequence, overrides = {}) => buildValidEvent({
    tick,
    sequence,
    id: buildNarrativeEventId(0, tick, sequence),
    ...overrides,
  });
  const actor = (kind, id, label = id) => ({ kind, id, role: 'primary', label });
  const location = (placeId, x, y) => ({
    scope: 'surface',
    depth: 0,
    x,
    y,
    placeId,
    label: placeId,
  });
  const state = {
    tick: 0,
    underrealm: { activeDepth: 0 },
    story: createStoryDirectorState(config),
  };
  const criticalSelected = eventAt(1, 0, {
    type: 'world.telemetry_critical_selected',
    category: 'world',
    importance: 'critical',
    actors: [actor('dwarf', 'telemetry_dwarf', 'Telemetry Dwarf')],
    location: location('telemetry_forge', 7, 9),
    message: 'Telemetry Dwarf holds the forge',
  });
  const criticalSuppressed = eventAt(2, 0, {
    type: 'world.telemetry_critical_suppressed',
    category: 'world',
    importance: 'critical',
    actors: [],
    location: {
      scope: 'surface',
      depth: null,
      x: null,
      y: null,
      placeId: null,
      label: null,
    },
    message: 'An unlocated critical signal is suppressed',
  });
  processStoryDirectorEvent(state, config, criticalSelected);
  processStoryDirectorEvent(state, config, criticalSuppressed);
  state.tick = 500;
  advanceStoryDirector(state, config);
  const legendarySelected = eventAt(500, 0, {
    type: 'world.telemetry_legendary_selected',
    category: 'world',
    importance: 'legendary',
    actors: [],
    location: {
      scope: 'world',
      depth: null,
      x: null,
      y: null,
      placeId: null,
      label: 'The known world',
    },
    message: 'The world remembers a legendary turning point',
  });
  processStoryDirectorEvent(state, config, legendarySelected);

  assert(
    state.story.stats.criticalConsidered === 2
      && state.story.stats.criticalSelected === 1
      && state.story.stats.criticalSuppressed === 1
      && state.story.stats.criticalContextCovered === 1,
    'Critical Story Director coverage counters drifted.',
  );
  assert(
    state.story.stats.legendaryConsidered === 1
      && state.story.stats.legendarySelected === 1
      && state.story.stats.legendarySuppressed === 0
      && state.story.stats.legendaryContextCovered === 1,
    'Legendary Story Director coverage counters drifted.',
  );

  const beforeTelemetry = JSON.stringify(state.story);
  const snapshot = collectStoryDirectorTelemetry(state, config);
  assert(snapshot.focus && snapshot.focus.importance === 'legendary', 'Telemetry lost current focus.');
  assert(snapshot.saga && snapshot.saga.id === legendarySelected.sagaId, 'Telemetry lost current saga.');
  assert(snapshot.latestDecision.reasonCode === 'selected_focus', 'Telemetry lost selection reason.');
  assert(snapshot.criticalCoverage === 0.5, 'Critical focus coverage ratio mismatch.');
  assert(snapshot.criticalContextCoverage === 0.5, 'Critical context coverage ratio mismatch.');
  assert(snapshot.legendaryContextCoverage === 1, 'Legendary context coverage ratio mismatch.');

  const sections = buildTelemetrySections(state, config, 100);
  const storySection = sections.storyDirector;
  assert(storySection && storySection.label === 'Story Director', 'Story Director telemetry section missing.');
  const storyText = storySection.rows.join('\n');
  assert(storyText.includes('Current focus: legendary'), 'Telemetry section omitted current focus.');
  assert(storyText.includes('Current saga:'), 'Telemetry section omitted current saga.');
  assert(storyText.includes('Cooldowns:'), 'Telemetry section omitted cooldown state.');
  assert(storyText.includes('Focus reason: selected_focus'), 'Telemetry section omitted selection reason.');
  assert(storyText.includes('Priority context:'), 'Telemetry section omitted priority context coverage.');
  assert(JSON.stringify(state.story) === beforeTelemetry, 'Story telemetry mutated Director state.');

  state.ui = { telemetryPanel: { open: true, page: 4 } };
  const panel = buildTelemetryPanel(state, config, { gridWidth: 120, gridHeight: 40 });
  const panelText = panel.lines.map((line) => String(line.text || '')).join('\n');
  assert(getTelemetryPanelPageCount() >= 5, 'Story Director Data Center page was not registered.');
  assert(panelText.includes('STORY DIRECTOR'), 'Story Director Data Center page did not render.');
  assert(panel.lines.every((line) => String(line.text || '').length <= 120), 'Story telemetry panel overflowed.');

  const tracker = createStoryDirectorCounterTracker();
  trackStoryDirectorCounters(state, tracker);
  trackStoryDirectorCounters(state, tracker);
  let report = getStoryDirectorCounterReport(tracker);
  assert(
    report.considered === 3
      && report.selected === 2
      && report.suppressed === 1
      && report.priorityFocusCoverage === 2 / 3
      && report.priorityContextCoverage === 2 / 3,
    'Headless Story Director tracker double-counted or derived incorrect coverage.',
  );
  state.story = createStoryDirectorState(config);
  state.story.cursor.lastCycle = 1;
  state.story.stats.considered = 2;
  state.story.stats.selected = 1;
  state.story.stats.suppressed = 1;
  state.story.stats.sagasOpened = 2;
  state.story.stats.sagasResolved = 1;
  trackStoryDirectorCounters(state, tracker);
  report = getStoryDirectorCounterReport(tracker);
  assert(
    report.considered === 5
      && report.selected === 3
      && report.suppressed === 2
      && report.sagasOpened >= 2
      && report.sagasResolved >= 1,
    'Headless Story Director tracker did not survive a cycle reset.',
  );

  const benchmarkSource = fs.readFileSync(path.join(ROOT, 'scripts/headless_benchmark.js'), 'utf8');
  const baselineGuardSource = fs.readFileSync(
    path.join(ROOT, 'scripts/ensure_benchmark_baseline.js'),
    'utf8',
  );
  assert(
    benchmarkSource.includes('trackStoryDirectorCounters(state, storyTracker)')
      && benchmarkSource.includes('reportSchemaVersion: BENCHMARK_REPORT_SCHEMA_VERSION'),
    'Headless benchmark is not wired to Story Director counters/schema.',
  );
  assert(
    baselineGuardSource.includes('report schema mismatch'),
    'Baseline cache guard does not refresh on benchmark report-schema drift.',
  );
}

// Validate v0/v1 Event Log rendering and drama filtering without mutating stored records.
function validateEventLogRenderingContract() {
  const v1Drama = buildValidEvent({
    tick: 51,
    sequence: 0,
    id: buildNarrativeEventId(0, 51, 0),
    importance: 'legendary',
    actors: [
      {
        kind: 'dwarf',
        id: 'dwarf_1042',
        role: 'primary',
        label: 'Dori Ironhand',
      },
      {
        kind: 'dwarf',
        id: 'dwarf_1043',
        role: 'parent',
        label: 'Bori Ironhand',
      },
      {
        kind: 'dwarf',
        id: 'dwarf_1044',
        role: 'witness',
        label: 'Kori Embervein',
      },
      {
        kind: 'dwarf',
        id: 'dwarf_1045',
        role: 'witness',
        label: 'Ori Copperbraid',
      },
    ],
    location: {
      scope: 'surface',
      depth: 0,
      x: 42,
      y: 17,
      placeId: 'forge_hall',
      label: 'Forge Hall',
    },
    sagaId: 'saga.iron_oath',
  });
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
  const flatText = panel.lines.map((line) => String(line.text || '').trim()).join(' ');
  assert(text.includes('Birth: Dori Ironhand'), 'Drama filter did not render the v1 lifecycle event.');
  assert(text.includes('[LEGENDARY]'), 'Event Log did not render structured importance.');
  assert(
    flatText.includes('Actors: Dori Ironhand, Bori Ironhand, Kori Embervein +1'),
    'Event Log did not render the bounded named-actor summary.',
  );
  assert(flatText.includes('At: Forge Hall (42,17)'), 'Event Log did not render structured location.');
  assert(
    flatText.includes('Saga=saga.iron_oath'),
    'Event Log did not render saga membership.',
  );
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
  assert(allText.includes('[AMBIENT]'), 'Legacy Event Log record lost its safe importance fallback.');

  const narrowPanel = buildEventLogPanel(state, {
    display: { event_log_panel: { enabled: true, width: 72, height: 18 } },
  }, {
    gridWidth: 72,
    gridHeight: 18,
  });
  assert(narrowPanel && narrowPanel.width === 72, 'Narrow Event Log panel did not retain its supported width.');
  assert(narrowPanel.lines.length === 18, 'Narrow Event Log panel did not retain its supported height.');
  assert(
    narrowPanel.lines.every((line) => String(line.text || '').length <= 72),
    'Narrow Event Log panel overflowed its configured width.',
  );
  assert(JSON.stringify(state.eventLog) === before, 'Narrow Event Log rendering mutated retained records.');
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
  assert(!snapshotSource.includes('state.story'), 'Map-export snapshot unexpectedly includes Story Director state.');
}

// Validate the E4.1 ribbon layout, structured-fact fallbacks, and read-only boundary.
function validateStoryRibbonContract() {
  const config = loadConfig();
  const event = buildValidEvent({
    tick: 500,
    sequence: 0,
    type: 'combat.ribbon_defense_resolved',
    category: 'combat',
    importance: 'critical',
    message: 'Dori Ironhand held the eastern gate against the raiders',
    actors: [{
      kind: 'dwarf',
      id: 'ribbon_dwarf',
      role: 'primary',
      label: 'Dori Ironhand',
    }],
    location: {
      scope: 'surface',
      depth: 0,
      x: 12,
      y: 7,
      placeId: 'ribbon_hold',
      label: 'Stale Hold',
    },
    consequences: [{
      kind: 'status',
      targetKind: 'settlement',
      targetId: 'settlement_main',
      metric: 'raid_active',
      value: false,
      unit: null,
    }],
    sagaId: 'saga_c0001_0007',
  });
  const state = {
    tick: 500,
    dwarves: [],
    places: {
      order: ['ribbon_hold'],
      byId: {
        ribbon_hold: {
          id: 'ribbon_hold',
          name: 'Ironward Hold',
          shortName: 'Ironward',
        },
      },
    },
    eventLog: [event],
    story: {
      currentFocus: {
        eventId: event.id,
        type: event.type,
        importance: event.importance,
        sagaId: event.sagaId,
        actorIds: ['ribbon_dwarf'],
        placeId: 'ribbon_hold',
      },
      sagas: {
        byId: {
          [event.sagaId]: {
            id: event.sagaId,
            status: 'active',
            summary: event.message,
          },
        },
      },
    },
    ui: {},
  };
  const before = JSON.stringify(state);
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error('Story ribbon consumed gameplay RNG.');
  };
  let wide;
  let medium;
  let narrow;
  try {
    wide = buildStoryRibbon(state, config, { gridWidth: 120, gridHeight: 30, mapInset: null });
    medium = buildStoryRibbon(state, config, { gridWidth: 90, gridHeight: 24, mapInset: null });
    narrow = buildStoryRibbon(state, config, { gridWidth: 72, gridHeight: 18, mapInset: null });
  } finally {
    Math.random = originalRandom;
  }
  assert(wide && medium && narrow, 'Story ribbon did not render at supported widths.');
  for (const ribbon of [wide, medium, narrow]) {
    assert(ribbon.lines.length === 4, 'Story ribbon height drifted from its compact four-row layout.');
    assert(
      ribbon.lines.every((line) => String(line.text || '').length === ribbon.width),
      'Story ribbon overflowed or underfilled its resolved width.',
    );
  }
  const wideText = wide.lines.map((line) => line.text).join('\n');
  assert(wideText.includes('Actor: Dori Ironhand'), 'Story ribbon omitted the primary actor.');
  assert(wideText.includes('Action: held the eastern gate'), 'Story ribbon omitted the action.');
  assert(wideText.includes('At: Ironward Hold'), 'Story ribbon ignored authoritative place identity.');
  assert(wideText.includes('Consequence: raid ended'), 'Story ribbon omitted the consequence.');
  assert(!wideText.includes('Stale Hold'), 'Story ribbon trusted a stale event location label.');
  assert(JSON.stringify(state) === before, 'Story ribbon builder mutated simulation or Director state.');

  const collision = buildStoryRibbon(state, config, {
    gridWidth: 72,
    gridHeight: 18,
    mapInset: { x: 50, y: 10, width: 22, height: 8 },
  });
  assert(collision && collision.x + collision.width < 50, 'Story ribbon collided with the Ops Snapshot.');

  const modalState = clone(state);
  modalState.ui.eventLog = { open: true };
  assert(
    buildStoryRibbon(modalState, config, { gridWidth: 120, gridHeight: 30 }) === null,
    'Story ribbon remained visible beneath a blocking modal.',
  );

  const fallbackState = clone(state);
  fallbackState.eventLog = [];
  fallbackState.story.sagas.byId[event.sagaId].summary = 'The eastern defense became legend';
  const fallback = buildStoryRibbon(fallbackState, config, {
    gridWidth: 72,
    gridHeight: 18,
    mapInset: null,
  });
  assert(
    fallback && fallback.fields.action === 'The eastern defense became legend',
    'Story ribbon did not use the fact-backed saga beat after Event Log eviction.',
  );

  const grid = Array.from({ length: 18 }, () => Array(72).fill('.'));
  applyStoryRibbon(grid, narrow, { enabled: false, map: {} });
  assert(grid[narrow.y][narrow.x] === '╔', 'Story ribbon overlay was not applied to the map grid.');
  assert(JSON.stringify(state) === before, 'Story ribbon application mutated simulation state.');
}

// Validate the E4.2 overlay budget, layer cues, deterministic pulse, and symbol preservation.
function validateStoryFocusOverlayContract() {
  const config = loadConfig();
  const event = buildValidEvent({
    tick: 640,
    sequence: 0,
    type: 'combat.focus_defense_resolved',
    category: 'combat',
    importance: 'critical',
    message: 'Dori Ironhand held the Ironward approach',
    actors: [{
      kind: 'dwarf',
      id: 'focus_dwarf',
      role: 'primary',
      label: 'Dori Ironhand',
    }],
    location: {
      scope: 'surface',
      depth: 0,
      x: 10,
      y: 8,
      placeId: 'focus_hold',
      label: 'Stale Hold',
    },
    sagaId: 'saga_c0001_0009',
  });
  const state = {
    tick: 32,
    dwarves: [],
    places: {
      order: ['focus_hold'],
      byId: {
        focus_hold: {
          id: 'focus_hold',
          name: 'Ironward Hold',
          shortName: 'Ironward',
          scope: 'surface',
          depth: 0,
          x: 10,
          y: 8,
        },
      },
    },
    eventLog: [event],
    story: {
      currentFocus: {
        eventId: event.id,
        type: event.type,
        importance: event.importance,
        sagaId: event.sagaId,
        actorIds: ['focus_dwarf'],
        placeId: 'focus_hold',
      },
      sagas: {
        byId: {
          [event.sagaId]: { id: event.sagaId, status: 'active', summary: event.message },
        },
      },
    },
    ui: {},
  };
  const runtime = { gridWidth: 30, gridHeight: 20, mapInset: null };
  const actorPositions = new Map([['focus_dwarf', { x: 4, y: 5 }]]);
  const before = JSON.stringify(state);
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error('Story focus overlay consumed gameplay RNG.');
  };
  let overlay;
  try {
    overlay = buildStoryFocusOverlay(state, config, runtime, 0, actorPositions);
  } finally {
    Math.random = originalRandom;
  }
  assert(overlay, 'Story focus overlay did not render for a critical focus.');
  assert(overlay.actorCount === 1, 'Story focus overlay exceeded or missed its actor budget.');
  assert(overlay.markerCount === 4, 'Story focus overlay did not build its bounded cardinal markers.');
  assert(overlay.pathCount === 0, 'Story focus paths were unexpectedly enabled by default.');
  assert(overlay.cells.length === 6, 'Story focus overlay exceeded its default six-cell visual budget.');
  assert(
    overlay.cells.every((cell) => cell.x >= 0 && cell.x < 30 && cell.y >= 0 && cell.y < 20),
    'Story focus overlay emitted an out-of-bounds cell.',
  );
  assert(JSON.stringify(state) === before, 'Story focus overlay builder mutated simulation state.');

  const grid = Array.from({ length: 20 }, () => Array(30).fill('.'));
  grid[5][4] = '@';
  grid[8][10] = 'H';
  applyStoryFocusOverlay(grid, overlay, {
    enabled: true,
    reset: '\x1b[0m',
    map: { story_focus_critical: '\x1b[93m' },
  });
  assert(stripAnsi(grid[5][4]) === '@', 'Story focus actor emphasis replaced its map symbol.');
  assert(stripAnsi(grid[8][10]) === 'H', 'Story focus location emphasis replaced its map symbol.');
  assert(grid[5][4] !== '@', 'Story focus actor emphasis did not apply its importance color.');

  const majorState = clone(state);
  majorState.eventLog[0].importance = 'major';
  majorState.story.currentFocus.importance = 'major';
  const major = buildStoryFocusOverlay(majorState, config, runtime, 0, actorPositions);
  assert(major.actorCount === 1, 'Major focus did not emphasize its visible actor.');
  assert(major.markerCount === 0, 'Major focus added location markers below the critical threshold.');
  assert(
    major.cells.every((cell) => cell.role === 'actor'),
    'Major focus added non-actor map decoration.',
  );

  const quietPulseState = clone(state);
  quietPulseState.tick = 16;
  const quietPulse = buildStoryFocusOverlay(quietPulseState, config, runtime, 0, actorPositions);
  assert(quietPulse.markerCount === 0, 'Story focus pulse ignored its tick-derived quiet phase.');
  assert(
    quietPulse.cells.some((cell) => cell.role === 'location'),
    'Story focus quiet phase hid the critical location anchor.',
  );

  const offLayerState = clone(state);
  offLayerState.eventLog[0].location = {
    scope: 'underrealm', depth: 3, x: 10, y: 8, placeId: null, label: 'Deep Vault',
  };
  offLayerState.story.currentFocus.placeId = null;
  const offLayer = buildStoryFocusOverlay(offLayerState, config, runtime, 0, actorPositions);
  assert(offLayer.cue === '↓ Underrealm D3', 'Story focus overlay omitted its off-layer depth cue.');
  assert(
    !offLayer.cells.some((cell) => cell.role === 'location' || cell.role === 'marker'),
    'Off-layer focus painted a location on the active map.',
  );
  const cueRibbon = buildStoryRibbon(
    offLayerState,
    config,
    { gridWidth: 72, gridHeight: 20, mapInset: null },
    { focusCue: offLayer.cue },
  );
  assert(
    cueRibbon.lines.some((line) => line.text.includes('↓ Underrealm D3')),
    'Story ribbon did not surface the off-layer focus cue.',
  );

  const modalState = clone(state);
  modalState.ui.eventLog = { open: true };
  assert(
    buildStoryFocusOverlay(modalState, config, runtime, 0, actorPositions) === null,
    'Story focus overlay remained visible beneath a blocking modal.',
  );

  const pathConfig = clone(config);
  pathConfig.display.storyFocusOverlay.showPaths = true;
  pathConfig.display.storyFocusOverlay.maxPathCells = 3;
  const pathOverlay = buildStoryFocusOverlay(state, pathConfig, runtime, 0, actorPositions);
  assert(pathOverlay.pathCount === 3, 'Opt-in story focus path ignored its three-cell hard budget.');

  const clamped = resolveStoryFocusOverlayConfig({
    display: {
      storyFocusOverlay: { maxActors: 99, radius: 99, maxMarkers: 99, maxPathCells: 99 },
    },
  });
  assert(clamped.maxActors === 2, 'Story focus actor hard cap drifted above two.');
  assert(clamped.radius === 2, 'Story focus radius hard cap drifted above two.');
  assert(clamped.maxMarkers === 4, 'Story focus marker hard cap drifted above four.');
  assert(clamped.maxPathCells === 12, 'Story focus path hard cap drifted above twelve.');
  assert(JSON.stringify(state) === before, 'Story focus overlay validation mutated simulation state.');
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
  validateSecondaryProducerMigrationContract();
  validateDwarfIdentityResolverContract();
  validatePlaceIdentityRegistryContract();
  validateDwarfPriorityVisibilityContract();
  validateStoryDirectorStateContract();
  validateStoryDirectorSelectionContract();
  validateStorySagaAggregationContract();
  validateStoryDirectorTelemetryContract();
  validateLegacyCompatibilityContract();
  validateAiObservationIsolationContract();
  validateEventLogRenderingContract();
  validateStoryRibbonContract();
  validateStoryFocusOverlayContract();
  validateMapExportIsolationContract();
  console.log('[test:narrative] PASS envelope malformed identity emitter importance collision lifecycle social combat warrior political endgame multi_cycle app_transition secondary_audit dwarf_identity named_messages place_identity priority_visibility story_state story_bounds story_serialization story_scoring story_focus story_preemption story_trace saga_grouping saga_ids saga_lifecycle saga_chapters story_telemetry story_reports story_ribbon story_focus_overlay legacy retention bounds serialization renderer ai_isolation export_isolation');
}

main();
