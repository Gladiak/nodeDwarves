'use strict';

const {
  NARRATIVE_SCHEMA_VERSION,
  MAX_SERIALIZED_EVENT_BYTES,
  peekNarrativeEventIdentity,
  commitNarrativeEventIdentity,
  validateNarrativeEvent,
} = require('./narrative_contract');
const {
  normalizeNarrativeEventDraft,
  normalizeHumanText,
  normalizeToken,
  reduceNarrativeEventToLimit,
  resolveEventImportance,
} = require('./narrative_normalizer');
const { processStoryDirectorEvent } = require('./story_director');

const EVENT_STATS_FIELDS = [
  'accepted',
  'rejected',
  'legacyNormalized',
  'truncated',
  'collisions',
];

const DRAMA_EVENT_CATEGORIES = new Set([
  'social',
  'lifecycle',
  'schism',
  'festival',
  'myth',
  'warrior',
  'underrealm',
]);

// Add a legacy or structured event to both bounded runtime logs.
function pushEvent(state, config, messageOrDraft, details = null) {
  if (!state || typeof state !== 'object') {
    return null;
  }
  ensureEventRuntimeState(state);
  const input = resolveEventDraft(messageOrDraft, details);
  if (!input) {
    incrementEventStat(state, 'rejected');
    return null;
  }

  const eventsConfig = (config && config.events) || {};
  const message = normalizeHumanText(input.draft.message, 512);
  if (!message) {
    incrementEventStat(state, 'rejected');
    return null;
  }

  let identity = null;
  try {
    identity = peekNarrativeEventIdentity(state, state.eventClock);
  } catch (error) {
    incrementEventStat(state, 'rejected');
    return null;
  }

  const candidate = normalizeNarrativeEventDraft(
    input.draft,
    identity,
    eventsConfig,
    message,
    inferEventCategory,
  );
  const reduced = reduceNarrativeEventToLimit(candidate, MAX_SERIALIZED_EVENT_BYTES);
  if (!reduced.event) {
    incrementEventStat(state, 'rejected');
    return null;
  }
  const validation = validateNarrativeEvent(reduced.event);
  if (!validation.valid) {
    incrementEventStat(state, 'rejected');
    return null;
  }
  if (hasRetainedEventId(state, reduced.event.id)) {
    incrementEventStat(state, 'collisions');
    incrementEventStat(state, 'rejected');
    return null;
  }

  try {
    commitNarrativeEventIdentity(state.eventClock, identity);
  } catch (error) {
    incrementEventStat(state, 'rejected');
    return null;
  }

  processStoryDirectorEvent(state, config, reduced.event);
  let acceptedEvent = reduced.event;
  let storyTruncated = false;
  const postStoryReduction = reduceNarrativeEventToLimit(acceptedEvent, MAX_SERIALIZED_EVENT_BYTES);
  if (postStoryReduction.event) {
    acceptedEvent = postStoryReduction.event;
    storyTruncated = postStoryReduction.truncated;
  } else {
    acceptedEvent.sagaId = null;
  }
  appendHudEvent(state, eventsConfig, reduced.event.message);
  appendEventLogEntry(state, eventsConfig, acceptedEvent);
  incrementEventStat(state, 'accepted');
  if (input.legacy) {
    incrementEventStat(state, 'legacyNormalized');
  }
  if (reduced.truncated || storyTruncated) {
    incrementEventStat(state, 'truncated');
  }
  return acceptedEvent;
}

// Initialize bounded scalar narrative runtime state for old or partial states.
function ensureEventRuntimeState(state) {
  state.events = Array.isArray(state.events) ? state.events : [];
  state.eventLog = Array.isArray(state.eventLog) ? state.eventLog : [];
  state.eventClock = state.eventClock && typeof state.eventClock === 'object'
    ? state.eventClock
    : { tick: -1, nextSequence: 0 };
  state.eventStats = state.eventStats && typeof state.eventStats === 'object'
    ? state.eventStats
    : {};
  for (const field of EVENT_STATS_FIELDS) {
    const value = Number(state.eventStats[field]);
    state.eventStats[field] = Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }
}

// Increment one known event diagnostic without creating unbounded samples.
function incrementEventStat(state, field) {
  if (!EVENT_STATS_FIELDS.includes(field)) {
    return;
  }
  const current = Number(state.eventStats && state.eventStats[field] || 0);
  state.eventStats[field] = Number.isSafeInteger(current) && current >= 0
    ? Math.min(Number.MAX_SAFE_INTEGER, current + 1)
    : 1;
}

// Resolve supported string, string-plus-details, or structured-object input.
function resolveEventDraft(messageOrDraft, details) {
  if (messageOrDraft && typeof messageOrDraft === 'object' && !Array.isArray(messageOrDraft)) {
    if (details !== null && details !== undefined) {
      return null;
    }
    return { draft: messageOrDraft, legacy: false };
  }
  const detailDraft = details && typeof details === 'object' && !Array.isArray(details)
    ? details
    : {};
  return {
    draft: {
      ...detailDraft,
      message: messageOrDraft,
    },
    legacy: true,
  };
}

// Return true when the retained structured UI buffer already owns an ID.
function hasRetainedEventId(state, id) {
  return state.eventLog.some((entry) => entry && typeof entry === 'object' && entry.id === id);
}

// Append a compact message under the configured HUD retention cap.
function appendHudEvent(state, eventsConfig, message) {
  const limit = resolveEventLimit(eventsConfig.maxEntries, 5);
  state.events.unshift(message);
  if (state.events.length > limit) {
    state.events = state.events.slice(0, limit);
  }
}

// Append one canonical event under the configured Event Log retention cap.
function appendEventLogEntry(state, eventsConfig, event) {
  const maxEvents = resolveEventLimit(eventsConfig.maxEntries, 5);
  const limit = resolveEventLogLimit(eventsConfig, maxEvents);
  if (limit <= 0) {
    return;
  }
  state.eventLog.unshift(event);
  if (state.eventLog.length > limit) {
    state.eventLog = state.eventLog.slice(0, limit);
  }
}

// Build a display-safe Event Log record without allocating identity or mutating state.
function normalizeEventLogEntry(raw) {
  const message = normalizeHumanText(raw && raw.message, 512);
  const inferredCategory = inferEventCategory(message);
  const categoryRaw = raw && raw.category ? String(raw.category).trim() : '';
  const category = normalizeEventCategory(categoryRaw || inferredCategory || 'other');
  const source = normalizeToken(raw && raw.source, 64) || category;
  const rawTick = Number(raw && raw.tick || 0);
  const tick = Number.isFinite(rawTick) ? Math.max(0, Math.floor(rawTick)) : 0;
  if (raw && raw.schemaVersion === NARRATIVE_SCHEMA_VERSION) {
    return {
      ...raw,
      tick,
      message,
      category,
      source,
    };
  }
  return {
    schemaVersion: 0,
    id: null,
    tick,
    type: `legacy.${category}`,
    category,
    importance: 'ambient',
    message,
    source,
  };
}

// Resolve a bounded numeric retention limit with a safe fallback.
function resolveEventLimit(value, fallback) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.max(0, Math.floor(numeric));
  }
  return Math.max(0, Math.floor(Number(fallback || 0)));
}

// Resolve bounded Event Log retention separately from the HUD mini-log.
function resolveEventLogLimit(eventsConfig, maxEvents) {
  const raw = Number(eventsConfig.logMaxEntries);
  if (Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw));
  }
  return Math.max(120, Math.max(1, Math.floor(Number(maxEvents || 5))) * 24);
}

// Normalize legacy category ids to safe lowercase tokens.
function normalizeEventCategory(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) {
    return 'other';
  }
  return raw.replace(/[^a-z0-9_]+/g, '_');
}

// Return true when an event category belongs to dwarf-driven drama lanes.
function isDramaEventCategory(category) {
  return DRAMA_EVENT_CATEGORIES.has(normalizeEventCategory(category));
}

// Infer one coarse category from event text for log filtering/highlighting.
function inferEventCategory(message) {
  const text = String(message || '').trim().toLowerCase();
  if (!text) {
    return 'other';
  }
  if (text.startsWith('social incident:')) {
    return 'social';
  }
  if (text.startsWith('birth:') || text.startsWith('death:')) {
    return 'lifecycle';
  }
  if (
    text.startsWith('schism')
    || text.startsWith('council ')
    || text.startsWith('ritual ')
    || text.includes('braziers')
  ) {
    return 'schism';
  }
  if (text.startsWith('festival')) {
    return 'festival';
  }
  if (text.startsWith('myth') || text.startsWith('tradition')) {
    return 'myth';
  }
  if (text.startsWith('warrior league')) {
    return 'warrior';
  }
  if (
    text.startsWith('raid')
    || text.includes('skirmish')
    || text.includes('champion')
    || text.includes('fell in tournament combat')
  ) {
    return 'combat';
  }
  if (text.startsWith('underrealm')) {
    return 'underrealm';
  }
  if (
    text.startsWith('world event')
    || text.startsWith('opportunity')
    || text.startsWith('contract')
    || text.startsWith('external camp')
    || text.startsWith('rival caravans')
    || text.startsWith('trade caravan')
    || text.startsWith('merchant')
  ) {
    return 'diplomacy';
  }
  if (
    text.startsWith('build:')
    || text.startsWith('upgrade:')
    || text.startsWith('tools:')
    || text.startsWith('temple ')
    || text.startsWith('road completed:')
  ) {
    return 'economy';
  }
  if (text.startsWith('weather:') || text.startsWith('wildlife:') || text.startsWith('alchemy')) {
    return 'world';
  }
  return 'other';
}

module.exports = {
  pushEvent,
  normalizeNarrativeEventDraft,
  reduceNarrativeEventToLimit,
  normalizeEventLogEntry,
  inferEventCategory,
  normalizeEventCategory,
  isDramaEventCategory,
  resolveEventImportance,
};
