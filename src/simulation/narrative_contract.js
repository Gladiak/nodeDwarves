'use strict';

const NARRATIVE_SCHEMA_VERSION = 1;
const MAX_SERIALIZED_EVENT_BYTES = 16 * 1024;
const TOKEN_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const EVENT_ID_PATTERN = /^evt:v1:c\d{4,}:t\d{10,}:s\d{4,}$/;
const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

const EVENT_FIELDS = Object.freeze([
  'schemaVersion',
  'id',
  'cycle',
  'tick',
  'sequence',
  'type',
  'category',
  'importance',
  'message',
  'actors',
  'location',
  'causes',
  'consequences',
  'sagaId',
  'source',
  'tags',
]);

const EVENT_CATEGORIES = Object.freeze([
  'social',
  'lifecycle',
  'schism',
  'festival',
  'myth',
  'warrior',
  'diplomacy',
  'combat',
  'underrealm',
  'economy',
  'world',
  'other',
]);

const EVENT_IMPORTANCE = Object.freeze([
  'ambient',
  'notable',
  'major',
  'critical',
  'legendary',
]);

const ACTOR_KINDS = Object.freeze([
  'dwarf',
  'faction',
  'settlement',
  'structure',
  'location',
  'camp',
  'caravan',
  'threat',
  'wildlife',
  'artifact',
  'institution',
  'system',
]);

const ACTOR_ROLES = Object.freeze([
  'primary',
  'secondary',
  'instigator',
  'target',
  'victim',
  'ally',
  'opponent',
  'leader',
  'member',
  'beneficiary',
  'witness',
  'owner',
  'founder',
  'parent',
  'child',
]);

const LOCATION_SCOPES = Object.freeze(['world', 'surface', 'underrealm']);
const CAUSE_KINDS = Object.freeze(['event', 'state', 'action', 'threshold']);
const CONSEQUENCE_KINDS = Object.freeze([
  'delta',
  'status',
  'progress',
  'create',
  'destroy',
  'death',
  'injury',
  'transfer',
  'unlock',
]);
const CONSEQUENCE_TARGET_KINDS = Object.freeze([
  ...ACTOR_KINDS,
  'resource',
  'world',
]);

// Format one non-negative integer with a minimum decimal width.
function formatCounter(value, width, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Narrative identity: ${label} must be a non-negative safe integer.`);
  }
  return String(value).padStart(width, '0');
}

// Build one deterministic narrative-event ID without consuming simulation randomness.
function buildNarrativeEventId(cycle, tick, sequence) {
  return [
    'evt:v1:c',
    formatCounter(cycle, 4, 'cycle'),
    ':t',
    formatCounter(tick, 10, 'tick'),
    ':s',
    formatCounter(sequence, 4, 'sequence'),
  ].join('');
}

// Resolve one safe state counter for identity generation.
function resolveStateCounter(value, label) {
  const numeric = Number(value || 0);
  const normalized = Math.max(0, Math.floor(numeric));
  if (!Number.isFinite(numeric) || !Number.isSafeInteger(normalized)) {
    throw new Error(`Narrative identity: state ${label} must resolve to a safe integer.`);
  }
  return normalized;
}

// Peek at the next identity; callers commit only after the candidate passes validation.
function peekNarrativeEventIdentity(state, eventClock) {
  const cycle = resolveStateCounter(
    state && state.cycleStats ? state.cycleStats.count : 0,
    'cycle',
  );
  const tick = resolveStateCounter(state && state.tick, 'tick');
  const clock = eventClock && typeof eventClock === 'object' ? eventClock : {};
  const clockTick = Number(clock.tick);
  const sequence = clockTick === tick
    ? resolveStateCounter(clock.nextSequence, 'event sequence')
    : 0;
  return {
    cycle,
    tick,
    sequence,
    id: buildNarrativeEventId(cycle, tick, sequence),
  };
}

// Commit one previously peeked identity to the mutable per-state event clock.
function commitNarrativeEventIdentity(eventClock, identity) {
  if (!eventClock || typeof eventClock !== 'object') {
    throw new Error('Narrative identity: eventClock must be an object.');
  }
  const cycle = identity && identity.cycle;
  const tick = identity && identity.tick;
  const sequence = identity && identity.sequence;
  const expectedId = buildNarrativeEventId(cycle, tick, sequence);
  if (!identity || identity.id !== expectedId) {
    throw new Error('Narrative identity: cannot commit a malformed candidate.');
  }
  if (sequence >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Narrative identity: event sequence exhausted the safe integer range.');
  }
  eventClock.tick = tick;
  eventClock.nextSequence = sequence + 1;
  return eventClock;
}

// Return true for a canonical token with an optional byte ceiling.
function isToken(value, maxBytes) {
  return typeof value === 'string'
    && value.length > 0
    && Buffer.byteLength(value, 'utf8') <= maxBytes
    && TOKEN_PATTERN.test(value);
}

// Return true for normalized human-readable text within its UTF-8 byte limit.
function isNormalizedText(value, maxBytes, allowEmpty = false) {
  if (typeof value !== 'string') {
    return false;
  }
  if ((!allowEmpty && value.length === 0) || value !== value.trim()) {
    return false;
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    return false;
  }
  return !ANSI_PATTERN.test(value) && !CONTROL_PATTERN.test(value) && !/\s{2,}/.test(value);
}

// Push one deterministic validation error when a condition is false.
function expect(errors, condition, path, message) {
  if (!condition) {
    errors.push(`${path}: ${message}`);
  }
}

// Reject unknown or missing canonical object fields.
function validateObjectFields(value, required, optional, path, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path}: expected object`);
    return false;
  }
  const allowed = new Set([...required, ...optional]);
  for (const field of required) {
    expect(errors, Object.prototype.hasOwnProperty.call(value, field), `${path}.${field}`, 'missing required field');
  }
  for (const field of Object.keys(value)) {
    expect(errors, allowed.has(field), `${path}.${field}`, 'unknown field');
  }
  return true;
}

// Validate that a value contains only finite, acyclic, plain JSON data.
function validatePlainJson(value, path, errors, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number') {
    expect(errors, Number.isFinite(value), path, 'number must be finite');
    return;
  }
  if (typeof value !== 'object') {
    errors.push(`${path}: value is not plain JSON`);
    return;
  }
  if (ancestors.has(value)) {
    errors.push(`${path}: circular reference is forbidden`);
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    errors.push(`${path}: class instances and live state references are forbidden`);
    return;
  }
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validatePlainJson(entry, `${path}[${index}]`, errors, nextAncestors));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    validatePlainJson(entry, `${path}.${key}`, errors, nextAncestors);
  }
}

// Validate one bounded JSON scalar.
function validateScalar(value, path, errors) {
  if (value === null || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number') {
    expect(errors, Number.isFinite(value), path, 'number must be finite');
    return;
  }
  expect(errors, isNormalizedText(value, 120), path, 'expected normalized scalar string up to 120 bytes');
}

// Validate canonical bounded actor references.
function validateActors(actors, errors) {
  expect(errors, Array.isArray(actors), 'event.actors', 'expected array');
  if (!Array.isArray(actors)) {
    return;
  }
  expect(errors, actors.length <= 8, 'event.actors', 'maximum length is 8');
  const seen = new Set();
  actors.forEach((actor, index) => {
    const path = `event.actors[${index}]`;
    if (!validateObjectFields(actor, ['kind', 'id', 'role'], ['label'], path, errors)) {
      return;
    }
    expect(errors, ACTOR_KINDS.includes(actor.kind), `${path}.kind`, 'invalid actor kind');
    expect(errors, isToken(actor.id, 96), `${path}.id`, 'invalid actor id');
    expect(errors, ACTOR_ROLES.includes(actor.role), `${path}.role`, 'invalid actor role');
    if (Object.prototype.hasOwnProperty.call(actor, 'label') && actor.label !== null) {
      expect(errors, isNormalizedText(actor.label, 120), `${path}.label`, 'invalid actor label');
    }
    const key = `${actor.kind}|${actor.id}|${actor.role}`;
    expect(errors, !seen.has(key), path, 'duplicate actor reference');
    seen.add(key);
  });
}

// Validate the canonical world/surface/underrealm location object.
function validateLocation(location, errors) {
  const path = 'event.location';
  if (!validateObjectFields(
    location,
    ['scope', 'depth', 'x', 'y', 'placeId', 'label'],
    [],
    path,
    errors,
  )) {
    return;
  }
  expect(errors, LOCATION_SCOPES.includes(location.scope), `${path}.scope`, 'invalid location scope');
  if (location.placeId !== null) {
    expect(errors, isToken(location.placeId, 96), `${path}.placeId`, 'invalid place id');
  }
  if (location.label !== null) {
    expect(errors, isNormalizedText(location.label, 120), `${path}.label`, 'invalid location label');
  }
  const coordinatesNull = location.x === null && location.y === null;
  const coordinatesValid = Number.isSafeInteger(location.x)
    && location.x >= 0
    && Number.isSafeInteger(location.y)
    && location.y >= 0;
  expect(errors, coordinatesNull || coordinatesValid, path, 'coordinates must be a complete non-negative integer pair');
  if (location.scope === 'world') {
    expect(errors, location.depth === null && coordinatesNull, path, 'world location cannot have depth or coordinates');
  } else if (location.scope === 'surface') {
    expect(errors, location.depth === 0, `${path}.depth`, 'surface depth must be 0');
  } else if (location.scope === 'underrealm') {
    expect(
      errors,
      Number.isSafeInteger(location.depth) && location.depth >= 1,
      `${path}.depth`,
      'underrealm depth must be a positive safe integer',
    );
  }
}

// Validate canonical bounded cause references.
function validateCauses(causes, errors) {
  expect(errors, Array.isArray(causes), 'event.causes', 'expected array');
  if (!Array.isArray(causes)) {
    return;
  }
  expect(errors, causes.length <= 8, 'event.causes', 'maximum length is 8');
  const seen = new Set();
  causes.forEach((cause, index) => {
    const path = `event.causes[${index}]`;
    if (!validateObjectFields(cause, ['kind', 'ref', 'metric', 'value'], [], path, errors)) {
      return;
    }
    expect(errors, CAUSE_KINDS.includes(cause.kind), `${path}.kind`, 'invalid cause kind');
    const validRef = cause.kind === 'event'
      ? typeof cause.ref === 'string'
        && Buffer.byteLength(cause.ref, 'utf8') <= 96
        && EVENT_ID_PATTERN.test(cause.ref)
      : isToken(cause.ref, 96);
    expect(errors, validRef, `${path}.ref`, 'invalid cause reference');
    if (cause.metric !== null) {
      expect(errors, isToken(cause.metric, 64), `${path}.metric`, 'invalid cause metric');
    }
    validateScalar(cause.value, `${path}.value`, errors);
    const key = JSON.stringify([cause.kind, cause.ref, cause.metric, cause.value]);
    expect(errors, !seen.has(key), path, 'duplicate cause reference');
    seen.add(key);
  });
}

// Validate canonical bounded consequence facts.
function validateConsequences(consequences, errors) {
  expect(errors, Array.isArray(consequences), 'event.consequences', 'expected array');
  if (!Array.isArray(consequences)) {
    return;
  }
  expect(errors, consequences.length <= 12, 'event.consequences', 'maximum length is 12');
  const seen = new Set();
  consequences.forEach((consequence, index) => {
    const path = `event.consequences[${index}]`;
    if (!validateObjectFields(
      consequence,
      ['kind', 'targetKind', 'targetId', 'metric', 'value', 'unit'],
      [],
      path,
      errors,
    )) {
      return;
    }
    expect(errors, CONSEQUENCE_KINDS.includes(consequence.kind), `${path}.kind`, 'invalid consequence kind');
    expect(
      errors,
      CONSEQUENCE_TARGET_KINDS.includes(consequence.targetKind),
      `${path}.targetKind`,
      'invalid consequence target kind',
    );
    expect(errors, isToken(consequence.targetId, 96), `${path}.targetId`, 'invalid consequence target id');
    if (consequence.metric !== null) {
      expect(errors, isToken(consequence.metric, 64), `${path}.metric`, 'invalid consequence metric');
    }
    validateScalar(consequence.value, `${path}.value`, errors);
    if (consequence.unit !== null) {
      expect(errors, isToken(consequence.unit, 32), `${path}.unit`, 'invalid consequence unit');
    }
    const key = JSON.stringify([
      consequence.kind,
      consequence.targetKind,
      consequence.targetId,
      consequence.metric,
      consequence.value,
      consequence.unit,
    ]);
    expect(errors, !seen.has(key), path, 'duplicate consequence fact');
    seen.add(key);
  });
}

// Validate canonical normalized tags and their deterministic order.
function validateTags(tags, errors) {
  expect(errors, Array.isArray(tags), 'event.tags', 'expected array');
  if (!Array.isArray(tags)) {
    return;
  }
  expect(errors, tags.length <= 8, 'event.tags', 'maximum length is 8');
  tags.forEach((tag, index) => {
    expect(errors, isToken(tag, 32), `event.tags[${index}]`, 'invalid tag');
  });
  const sortedUnique = [...new Set(tags)].sort();
  expect(errors, JSON.stringify(tags) === JSON.stringify(sortedUnique), 'event.tags', 'tags must be sorted and unique');
}

// Validate one canonical schema-v1 event and return all deterministic errors.
function validateNarrativeEvent(event) {
  const errors = [];
  validatePlainJson(event, 'event', errors);
  if (!validateObjectFields(event, EVENT_FIELDS, [], 'event', errors)) {
    return { valid: false, errors };
  }

  expect(errors, event.schemaVersion === NARRATIVE_SCHEMA_VERSION, 'event.schemaVersion', 'expected version 1');
  expect(errors, Number.isSafeInteger(event.cycle) && event.cycle >= 0, 'event.cycle', 'invalid cycle');
  expect(errors, Number.isSafeInteger(event.tick) && event.tick >= 0, 'event.tick', 'invalid tick');
  expect(errors, Number.isSafeInteger(event.sequence) && event.sequence >= 0, 'event.sequence', 'invalid sequence');
  let expectedId = null;
  try {
    expectedId = buildNarrativeEventId(event.cycle, event.tick, event.sequence);
  } catch (error) {
    errors.push(`event.id: ${error.message}`);
  }
  expect(
    errors,
    typeof event.id === 'string'
      && Buffer.byteLength(event.id, 'utf8') <= 96
      && EVENT_ID_PATTERN.test(event.id)
      && event.id === expectedId,
    'event.id',
    'id does not match cycle/tick/sequence',
  );
  expect(errors, isToken(event.type, 64), 'event.type', 'invalid event type');
  expect(errors, EVENT_CATEGORIES.includes(event.category), 'event.category', 'invalid event category');
  expect(errors, EVENT_IMPORTANCE.includes(event.importance), 'event.importance', 'invalid importance');
  expect(errors, isNormalizedText(event.message, 512), 'event.message', 'invalid normalized message');
  expect(errors, event.sagaId === null || isToken(event.sagaId, 96), 'event.sagaId', 'invalid saga id');
  expect(errors, isToken(event.source, 64), 'event.source', 'invalid source');

  validateActors(event.actors, errors);
  validateLocation(event.location, errors);
  validateCauses(event.causes, errors);
  validateConsequences(event.consequences, errors);
  validateTags(event.tags, errors);

  try {
    const serialized = JSON.stringify(event);
    expect(
      errors,
      Buffer.byteLength(serialized, 'utf8') <= MAX_SERIALIZED_EVENT_BYTES,
      'event',
      `serialized payload exceeds ${MAX_SERIALIZED_EVENT_BYTES} bytes`,
    );
  } catch (error) {
    errors.push(`event: JSON serialization failed (${error.message})`);
  }

  return { valid: errors.length === 0, errors };
}

// Throw a stable diagnostic when a canonical event violates the v1 contract.
function assertNarrativeEvent(event) {
  const result = validateNarrativeEvent(event);
  if (!result.valid) {
    throw new Error(`Narrative event contract failed:\n- ${result.errors.join('\n- ')}`);
  }
  return event;
}

module.exports = {
  NARRATIVE_SCHEMA_VERSION,
  MAX_SERIALIZED_EVENT_BYTES,
  EVENT_CATEGORIES,
  EVENT_IMPORTANCE,
  ACTOR_KINDS,
  ACTOR_ROLES,
  LOCATION_SCOPES,
  CAUSE_KINDS,
  CONSEQUENCE_KINDS,
  buildNarrativeEventId,
  peekNarrativeEventIdentity,
  commitNarrativeEventIdentity,
  validateNarrativeEvent,
  assertNarrativeEvent,
};
