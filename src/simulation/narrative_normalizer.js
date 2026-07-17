'use strict';

const {
  NARRATIVE_SCHEMA_VERSION,
  MAX_SERIALIZED_EVENT_BYTES,
  EVENT_CATEGORIES,
  EVENT_IMPORTANCE,
  ACTOR_KINDS,
  ACTOR_ROLES,
  LOCATION_SCOPES,
  CAUSE_KINDS,
  CONSEQUENCE_KINDS,
  CONSEQUENCE_TARGET_KINDS,
  EVENT_ID_PATTERN,
} = require('./narrative_contract');

const TOKEN_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const ANSI_PATTERN_GLOBAL = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const CONTROL_PATTERN_GLOBAL = /[\u0000-\u001f\u007f]+/g;

// Normalize one producer draft into a canonical event candidate.
function normalizeNarrativeEventDraft(draft, identity, eventsConfig, message, inferCategory) {
  const category = resolveStructuredCategory(draft && draft.category, message, inferCategory);
  const type = normalizeToken(draft && draft.type, 64) || `legacy.${category}`;
  return {
    schemaVersion: NARRATIVE_SCHEMA_VERSION,
    id: identity.id,
    cycle: identity.cycle,
    tick: identity.tick,
    sequence: identity.sequence,
    type,
    category,
    importance: resolveEventImportance(draft && draft.importance, type, category, eventsConfig),
    message,
    actors: normalizeActors(draft && draft.actors),
    location: normalizeLocation(draft && draft.location),
    causes: normalizeCauses(draft && draft.causes),
    consequences: normalizeConsequences(draft && draft.consequences),
    sagaId: normalizeToken(draft && draft.sagaId, 96),
    source: normalizeToken(draft && draft.source, 64) || category,
    tags: normalizeTags(draft && draft.tags),
  };
}

// Normalize a human-readable string and truncate on a UTF-8 code-point boundary.
function normalizeHumanText(value, maxBytes) {
  if (value === null || value === undefined) {
    return '';
  }
  const normalized = String(value)
    .replace(ANSI_PATTERN_GLOBAL, '')
    .replace(CONTROL_PATTERN_GLOBAL, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return truncateUtf8(normalized, maxBytes);
}

// Truncate a string without splitting one Unicode code point.
function truncateUtf8(value, maxBytes) {
  const limit = Math.max(0, Math.floor(Number(maxBytes || 0)));
  if (Buffer.byteLength(value, 'utf8') <= limit) {
    return value;
  }
  let output = '';
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > limit) {
      break;
    }
    output += character;
    bytes += characterBytes;
  }
  return output;
}

// Normalize one lowercase contract token or return null.
function normalizeToken(value, maxBytes) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }
  const token = String(value).trim().toLowerCase();
  if (!token || Buffer.byteLength(token, 'utf8') > maxBytes || !TOKEN_PATTERN.test(token)) {
    return null;
  }
  return token;
}

// Resolve a closed structured category with legacy message inference fallback.
function resolveStructuredCategory(value, message, inferCategory) {
  const explicit = normalizeToken(value, 32);
  if (explicit && EVENT_CATEGORIES.includes(explicit)) {
    return explicit;
  }
  const inferredRaw = typeof inferCategory === 'function' ? inferCategory(message) : 'other';
  const inferred = normalizeToken(inferredRaw, 32);
  return inferred && EVENT_CATEGORIES.includes(inferred) ? inferred : 'other';
}

// Resolve importance exclusively from producer input and config-driven defaults.
function resolveEventImportance(value, type, category, eventsConfig) {
  const explicit = normalizeToken(value, 16);
  if (explicit && EVENT_IMPORTANCE.includes(explicit)) {
    return explicit;
  }
  const importance = eventsConfig && eventsConfig.importance && typeof eventsConfig.importance === 'object'
    ? eventsConfig.importance
    : {};
  const byType = importance.by_type && typeof importance.by_type === 'object'
    ? importance.by_type
    : {};
  const byCategory = importance.by_category && typeof importance.by_category === 'object'
    ? importance.by_category
    : {};
  const candidates = [byType[type], byCategory[category], importance.default, 'ambient'];
  for (const candidate of candidates) {
    const normalized = normalizeToken(candidate, 16);
    if (normalized && EVENT_IMPORTANCE.includes(normalized)) {
      return normalized;
    }
  }
  return 'ambient';
}

// Normalize and deduplicate bounded actor references.
function normalizeActors(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const output = [];
  const seen = new Set();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      continue;
    }
    const kind = normalizeToken(raw.kind, 32);
    const id = normalizeToken(raw.id, 96);
    const role = normalizeToken(raw.role, 32);
    if (!ACTOR_KINDS.includes(kind) || !id || !ACTOR_ROLES.includes(role)) {
      continue;
    }
    const key = `${kind}|${id}|${role}`;
    if (seen.has(key)) {
      continue;
    }
    const actor = { kind, id, role };
    const label = normalizeHumanText(raw.label, 120);
    if (label) {
      actor.label = label;
    }
    output.push(actor);
    seen.add(key);
    if (output.length >= 8) {
      break;
    }
  }
  return output;
}

// Normalize one bounded world, surface, or Underrealm location.
function normalizeLocation(value) {
  const fallback = {
    scope: 'world',
    depth: null,
    x: null,
    y: null,
    placeId: null,
    label: null,
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }
  const scope = normalizeToken(value.scope, 32);
  if (!LOCATION_SCOPES.includes(scope)) {
    return fallback;
  }
  const hasX = value.x !== null && value.x !== undefined;
  const hasY = value.y !== null && value.y !== undefined;
  const coordinatePair = !hasX && !hasY
    ? { x: null, y: null }
    : normalizeCoordinatePair(value.x, value.y);
  if (!coordinatePair) {
    return fallback;
  }
  if (scope === 'world') {
    return fallback;
  }
  let depth = 0;
  if (scope === 'underrealm') {
    depth = normalizeNonNegativeInteger(value.depth);
    if (depth === null || depth < 1) {
      return fallback;
    }
  }
  return {
    scope,
    depth,
    x: coordinatePair.x,
    y: coordinatePair.y,
    placeId: normalizeToken(value.placeId, 96),
    label: normalizeHumanText(value.label, 120) || null,
  };
}

// Normalize an optional non-negative coordinate pair.
function normalizeCoordinatePair(x, y) {
  const normalizedX = normalizeNonNegativeInteger(x);
  const normalizedY = normalizeNonNegativeInteger(y);
  if (normalizedX === null || normalizedY === null) {
    return null;
  }
  return { x: normalizedX, y: normalizedY };
}

// Normalize one non-negative safe integer without accepting partial strings.
function normalizeNonNegativeInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isSafeInteger(numeric)) {
    return null;
  }
  return numeric >= 0 ? numeric : null;
}

// Normalize one bounded JSON scalar.
function normalizeScalar(value) {
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const text = normalizeHumanText(value, 120);
  return text || null;
}

// Normalize and deduplicate bounded causal references.
function normalizeCauses(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const output = [];
  const seen = new Set();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      continue;
    }
    const kind = normalizeToken(raw.kind, 32);
    if (!CAUSE_KINDS.includes(kind)) {
      continue;
    }
    const rawRef = typeof raw.ref === 'string' ? raw.ref.trim() : '';
    const ref = kind === 'event'
      ? (Buffer.byteLength(rawRef, 'utf8') <= 96 && EVENT_ID_PATTERN.test(rawRef) ? rawRef : null)
      : normalizeToken(raw.ref, 96);
    if (!ref) {
      continue;
    }
    const cause = {
      kind,
      ref,
      metric: normalizeToken(raw.metric, 64),
      value: normalizeScalar(raw.value),
    };
    const key = JSON.stringify([cause.kind, cause.ref, cause.metric, cause.value]);
    if (seen.has(key)) {
      continue;
    }
    output.push(cause);
    seen.add(key);
    if (output.length >= 8) {
      break;
    }
  }
  return output;
}

// Normalize and deduplicate bounded descriptive consequence facts.
function normalizeConsequences(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const output = [];
  const seen = new Set();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      continue;
    }
    const kind = normalizeToken(raw.kind, 32);
    const targetKind = normalizeToken(raw.targetKind, 32);
    const targetId = normalizeToken(raw.targetId, 96);
    if (!CONSEQUENCE_KINDS.includes(kind) || !CONSEQUENCE_TARGET_KINDS.includes(targetKind) || !targetId) {
      continue;
    }
    const consequence = {
      kind,
      targetKind,
      targetId,
      metric: normalizeToken(raw.metric, 64),
      value: normalizeScalar(raw.value),
      unit: normalizeToken(raw.unit, 32),
    };
    const key = JSON.stringify([
      consequence.kind,
      consequence.targetKind,
      consequence.targetId,
      consequence.metric,
      consequence.value,
      consequence.unit,
    ]);
    if (seen.has(key)) {
      continue;
    }
    output.push(consequence);
    seen.add(key);
    if (output.length >= 12) {
      break;
    }
  }
  return output;
}

// Normalize tags into a sorted unique bounded token list.
function normalizeTags(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const tags = value
    .map((entry) => normalizeToken(entry, 32))
    .filter(Boolean);
  return [...new Set(tags)].sort().slice(0, 8);
}

// Reduce optional payload deterministically to a serialized byte ceiling.
function reduceNarrativeEventToLimit(event, maxBytes = MAX_SERIALIZED_EVENT_BYTES) {
  const limit = Math.max(1, Math.floor(Number(maxBytes || MAX_SERIALIZED_EVENT_BYTES)));
  const candidate = JSON.parse(JSON.stringify(event));
  if (serializedEventBytes(candidate) <= limit) {
    return { event: candidate, truncated: false };
  }

  let changed = false;
  const reduceStep = (reducer) => {
    if (serializedEventBytes(candidate) <= limit) {
      return true;
    }
    changed = reducer() || changed;
    return serializedEventBytes(candidate) <= limit;
  };

  reduceStep(() => {
    let removed = false;
    for (const actor of candidate.actors) {
      if (Object.prototype.hasOwnProperty.call(actor, 'label')) {
        delete actor.label;
        removed = true;
      }
    }
    return removed;
  });
  reduceStep(() => {
    if (candidate.location.label === null) {
      return false;
    }
    candidate.location.label = null;
    return true;
  });
  reduceStep(() => clearScalarValues(candidate.causes));
  reduceStep(() => clearScalarValues(candidate.consequences));
  reduceStep(() => trimTrailingEntries(candidate.causes, limit, candidate));
  reduceStep(() => trimTrailingEntries(candidate.consequences, limit, candidate));
  reduceStep(() => trimSecondaryActors(candidate, limit));
  reduceStep(() => trimTrailingEntries(candidate.tags, limit, candidate));

  if (serializedEventBytes(candidate) > limit) {
    return { event: null, truncated: changed };
  }
  addTruncationTag(candidate, limit);
  return { event: candidate, truncated: true };
}

// Clear non-null values from bounded cause/consequence records.
function clearScalarValues(entries) {
  let changed = false;
  for (const entry of entries) {
    if (entry.value !== null) {
      entry.value = null;
      changed = true;
    }
  }
  return changed;
}

// Trim array tails until the serialized candidate fits or the array is empty.
function trimTrailingEntries(entries, limit, candidate) {
  let changed = false;
  while (entries.length > 0 && serializedEventBytes(candidate) > limit) {
    entries.pop();
    changed = true;
  }
  return changed;
}

// Preserve the leading primary actor while removing trailing secondary references.
function trimSecondaryActors(candidate, limit) {
  let changed = false;
  while (candidate.actors.length > 1 && serializedEventBytes(candidate) > limit) {
    candidate.actors.pop();
    changed = true;
  }
  return changed;
}

// Add the reserved truncation tag without violating tag or byte limits.
function addTruncationTag(candidate, limit) {
  const reserved = 'contract_truncated';
  const tags = candidate.tags.filter((tag) => tag !== reserved).slice(0, 7);
  candidate.tags = [...tags, reserved].sort();
  while (serializedEventBytes(candidate) > limit) {
    const removable = candidate.tags.findIndex((tag) => tag !== reserved);
    if (removable < 0) {
      candidate.tags = candidate.tags.filter((tag) => tag !== reserved);
      break;
    }
    candidate.tags.splice(removable, 1);
  }
}

// Return serialized UTF-8 bytes for one plain candidate.
function serializedEventBytes(event) {
  return Buffer.byteLength(JSON.stringify(event), 'utf8');
}

module.exports = {
  normalizeNarrativeEventDraft,
  normalizeHumanText,
  normalizeToken,
  reduceNarrativeEventToLimit,
  resolveEventImportance,
};
