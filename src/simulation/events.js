'use strict';

const DRAMA_EVENT_CATEGORIES = new Set([
  'social',
  'lifecycle',
  'schism',
  'festival',
  'myth',
  'warrior',
  'underrealm',
]);

// Add a message to the rolling event list with a max length.
function pushEvent(state, config, message, details = null) {
  const eventsConfig = (config && config.events) || {};
  const maxEvents = Number(eventsConfig.maxEntries ?? 5);
  const text = String(message || '').trim();
  if (!text) {
    return;
  }
  state.events = Array.isArray(state.events) ? state.events : [];
  state.events.unshift(text);
  if (state.events.length > maxEvents) {
    state.events = state.events.slice(0, maxEvents);
  }
  const maxLogEntries = resolveEventLogLimit(eventsConfig, maxEvents);
  if (maxLogEntries <= 0) {
    return;
  }
  const tick = Math.max(0, Math.floor(Number(state && state.tick || 0)));
  const entry = normalizeEventLogEntry({
    tick,
    message: text,
    source: details && details.source ? details.source : null,
    category: details && details.category ? details.category : null,
  });
  state.eventLog = Array.isArray(state.eventLog) ? state.eventLog : [];
  state.eventLog.unshift(entry);
  if (state.eventLog.length > maxLogEntries) {
    state.eventLog = state.eventLog.slice(0, maxLogEntries);
  }
}

// Build one normalized event-log entry payload.
function normalizeEventLogEntry(raw) {
  const source = raw && raw.source ? String(raw.source).trim() : '';
  const message = raw && raw.message ? String(raw.message).trim() : '';
  const inferredCategory = inferEventCategory(message);
  const categoryRaw = raw && raw.category ? String(raw.category).trim() : '';
  const category = normalizeEventCategory(categoryRaw || inferredCategory || 'other');
  return {
    tick: Math.max(0, Math.floor(Number(raw && raw.tick || 0))),
    message,
    category,
    source: source || category,
  };
}

// Resolve bounded event-log limit with fallback larger than the HUD mini-log.
function resolveEventLogLimit(eventsConfig, maxEvents) {
  const raw = Number(eventsConfig.logMaxEntries);
  if (Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw));
  }
  return Math.max(120, Math.max(1, Math.floor(Number(maxEvents || 5))) * 24);
}

// Normalize category ids to known-safe lowercase tokens.
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
  normalizeEventLogEntry,
  inferEventCategory,
  normalizeEventCategory,
  isDramaEventCategory,
};
