'use strict';

const IMPORTANCE = ['ambient', 'notable', 'major', 'critical', 'legendary'];
const DEFAULT_CATEGORIES = ['social', 'lifecycle', 'combat', 'warrior', 'underrealm', 'schism', 'economy', 'world', 'festival', 'myth', 'endgame'];
const ACTIVE_SAGA_STATUSES = new Set(['open', 'active', 'dormant']);

// Create the bounded lived-experience registry stored on simulation state.
function createExperienceLedger() {
  return {
    schemaVersion: 1,
    byDwarfId: {},
    order: [],
    stats: { recorded: 0, merged: 0, evictedDeeds: 0, evictedDwarves: 0, skipped: 0 },
  };
}

// Repair old or partial state without expanding its persisted shape.
function ensureExperienceLedger(state) {
  if (!state.experience || typeof state.experience !== 'object') {
    state.experience = createExperienceLedger();
  }
  const ledger = state.experience;
  ledger.schemaVersion = 1;
  ledger.byDwarfId = ledger.byDwarfId && typeof ledger.byDwarfId === 'object'
    ? ledger.byDwarfId : {};
  ledger.order = Array.isArray(ledger.order)
    ? ledger.order.filter((id) => typeof id === 'string' && ledger.byDwarfId[id]) : [];
  ledger.stats = ledger.stats && typeof ledger.stats === 'object' ? ledger.stats : {};
  for (const field of ['recorded', 'merged', 'evictedDeeds', 'evictedDwarves', 'skipped']) {
    ledger.stats[field] = safeCount(ledger.stats[field]);
  }
  return ledger;
}

// Record one accepted canonical event as compact per-dwarf lived history.
function recordExperienceEvent(state, config, event) {
  const ledger = ensureExperienceLedger(state);
  const settings = getSettings(config);
  const dwarfActors = normalizeActors(event && event.actors).filter((actor) => actor.kind === 'dwarf');
  if (!isEligible(event, dwarfActors, settings)) {
    ledger.stats.skipped += 1;
    return 0;
  }
  let recorded = 0;
  for (const actor of dwarfActors) {
    const record = ensureDwarfRecord(ledger, actor);
    const deed = buildDeed(event, actor, dwarfActors, settings);
    const mergeTarget = findMergeTarget(record.deeds, deed, settings.mergeWindowTicks);
    if (mergeTarget) {
      mergeDeed(mergeTarget, deed, settings.maxSourceRefs);
      ledger.stats.merged += 1;
    } else {
      record.deeds.push(deed);
      ledger.stats.recorded += 1;
    }
    retainDwarfDeeds(record, state, settings, ledger.stats);
    record.definingDeedId = selectDefiningDeed(record.deeds)?.id || null;
    recorded += 1;
  }
  retainDwarfRecords(ledger, state, settings);
  return recorded;
}

// Return a read-only biography view for Inspect and tests.
function getDwarfBiography(state, config, dwarfId) {
  const ledger = state && state.experience;
  const record = ledger && ledger.byDwarfId ? ledger.byDwarfId[String(dwarfId || '')] : null;
  const deeds = record && Array.isArray(record.deeds) ? record.deeds.slice() : [];
  deeds.sort(compareRecent);
  const defining = deeds.find((deed) => deed.id === record.definingDeedId)
    || selectDefiningDeed(deeds);
  const recentLimit = Math.max(1, Math.min(6, Number(config?.experience_ledger?.inspect_recent_deeds || 3)));
  const dwarf = Array.isArray(state && state.dwarves)
    ? state.dwarves.find((entry) => String(entry.id) === String(dwarfId)) : null;
  const scars = dwarf && dwarf.warrior && Array.isArray(dwarf.warrior.scars)
    ? dwarf.warrior.scars.slice(0, 4).map(String) : [];
  const activeSagaRoles = collectActiveSagaRoles(state, dwarfId, deeds);
  return {
    definingDeed: defining || null,
    recentDeeds: deeds.slice(0, recentLimit),
    activeSagaRoles,
    scars,
    deedCount: deeds.length,
  };
}

// Build normalized ledger settings with hard safety ceilings.
function getSettings(config) {
  const raw = config && config.experience_ledger || {};
  return {
    enabled: raw.enabled !== false,
    minimumImportance: normalizeImportance(raw.minimum_importance, 'major'),
    categories: new Set(Array.isArray(raw.categories) ? raw.categories.map(String) : DEFAULT_CATEGORIES),
    maxDwarves: clampInt(raw.max_dwarves, 1, 4096, 1024),
    maxDeedsPerDwarf: clampInt(raw.max_deeds_per_dwarf, 1, 32, 12),
    maxSourceRefs: clampInt(raw.max_source_refs_per_deed, 1, 8, 4),
    maxActorRefs: clampInt(raw.max_actor_refs_per_deed, 1, 8, 4),
    mergeWindowTicks: clampInt(raw.merge_window_ticks, 0, 1000000, 1200),
  };
}

// Decide whether an event belongs in lived history.
function isEligible(event, dwarfActors, settings) {
  if (!settings.enabled || !event || !event.id || dwarfActors.length === 0) return false;
  if (!settings.categories.has(String(event.category || ''))) return false;
  return importanceRank(event.importance) >= importanceRank(settings.minimumImportance);
}

// Keep only bounded actor snapshots required to resolve missing or dead dwarves.
function normalizeActors(actors) {
  if (!Array.isArray(actors)) return [];
  return actors.filter((actor) => actor && actor.id).map((actor) => ({
    kind: String(actor.kind || 'unknown').slice(0, 32),
    id: String(actor.id).slice(0, 96),
    role: String(actor.role || 'participant').slice(0, 32),
    label: String(actor.label || actor.id).slice(0, 96),
  }));
}

// Create one compact deed without retaining the canonical event object.
function buildDeed(event, actor, dwarfActors, settings) {
  const sourceEventId = String(event.id);
  const actorSnapshots = dwarfActors.slice(0, settings.maxActorRefs);
  return {
    id: sourceEventId,
    sourceEventIds: [sourceEventId],
    firstTick: safeCount(event.tick),
    lastTick: safeCount(event.tick),
    cycle: safeCount(event.cycle),
    type: String(event.type || 'unknown').slice(0, 96),
    category: String(event.category || 'unknown').slice(0, 48),
    importance: normalizeImportance(event.importance, 'ambient'),
    summary: String(event.message || '').slice(0, 180),
    role: actor.role,
    actorSnapshots,
    location: normalizeLocation(event.location),
    sagaId: event.sagaId ? String(event.sagaId).slice(0, 96) : null,
    occurrences: 1,
  };
}

// Normalize only the location facts useful to biography presentation.
function normalizeLocation(location) {
  const source = location && typeof location === 'object' ? location : { scope: 'world' };
  const normalized = { scope: String(source.scope || 'world').slice(0, 24) };
  if (Number.isSafeInteger(Number(source.depth))) normalized.depth = Math.max(0, Number(source.depth));
  if (Number.isSafeInteger(Number(source.x))) normalized.x = Math.max(0, Number(source.x));
  if (Number.isSafeInteger(Number(source.y))) normalized.y = Math.max(0, Number(source.y));
  if (source.placeId) normalized.placeId = String(source.placeId).slice(0, 96);
  if (source.label) normalized.label = String(source.label).slice(0, 96);
  return normalized;
}

// Create a ledger row on first accepted deed.
function ensureDwarfRecord(ledger, actor) {
  if (!ledger.byDwarfId[actor.id]) {
    ledger.byDwarfId[actor.id] = {
      dwarfId: actor.id,
      identity: { id: actor.id, label: actor.label, role: actor.role },
      definingDeedId: null,
      deeds: [],
    };
    ledger.order.push(actor.id);
  } else if (actor.label) {
    ledger.byDwarfId[actor.id].identity = { id: actor.id, label: actor.label, role: actor.role };
  }
  return ledger.byDwarfId[actor.id];
}

// Find one equivalent recent deed eligible for deterministic compaction.
function findMergeTarget(deeds, deed, windowTicks) {
  for (let index = deeds.length - 1; index >= 0; index -= 1) {
    const candidate = deeds[index];
    if (candidate.type !== deed.type || candidate.sagaId !== deed.sagaId || candidate.role !== deed.role) continue;
    if (locationKey(candidate.location) !== locationKey(deed.location)) continue;
    if (deed.lastTick - candidate.lastTick <= windowTicks) return candidate;
  }
  return null;
}

// Merge repeat deeds while retaining a bounded audit trail of event IDs.
function mergeDeed(target, incoming, maxSourceRefs) {
  target.lastTick = incoming.lastTick;
  target.occurrences = safeCount(target.occurrences) + 1;
  target.summary = incoming.summary;
  target.importance = importanceRank(incoming.importance) > importanceRank(target.importance)
    ? incoming.importance : target.importance;
  for (const id of incoming.sourceEventIds) {
    if (!target.sourceEventIds.includes(id)) target.sourceEventIds.push(id);
  }
  target.sourceEventIds = target.sourceEventIds.slice(-maxSourceRefs);
}

// Retain defining, active-saga and Hall-of-Fame deeds ahead of lower-value entries.
function retainDwarfDeeds(record, state, settings, stats) {
  if (record.deeds.length <= settings.maxDeedsPerDwarf) return;
  const activeSagas = collectActiveSagaIds(state);
  record.deeds.sort((left, right) => compareRetention(right, left, activeSagas));
  const removed = record.deeds.splice(settings.maxDeedsPerDwarf);
  stats.evictedDeeds += removed.length;
}

// Enforce the global dwarf-record cap with stable protection and tie breaks.
function retainDwarfRecords(ledger, state, settings) {
  if (ledger.order.length <= settings.maxDwarves) return;
  const protectedIds = collectProtectedDwarfIds(state);
  const livingIds = new Set(Array.isArray(state.dwarves) ? state.dwarves.map((dwarf) => String(dwarf.id)) : []);
  const ranked = ledger.order.map((id, index) => {
    const record = ledger.byDwarfId[id];
    const latest = record && record.deeds.length > 0 ? Math.max(...record.deeds.map((deed) => deed.lastTick)) : 0;
    return { id, index, protected: protectedIds.has(id), living: livingIds.has(id), latest };
  });
  ranked.sort((left, right) => Number(right.protected) - Number(left.protected)
    || Number(right.living) - Number(left.living)
    || right.latest - left.latest || left.index - right.index || left.id.localeCompare(right.id));
  const keep = new Set(ranked.slice(0, settings.maxDwarves).map((entry) => entry.id));
  for (const id of ledger.order) {
    if (!keep.has(id)) {
      delete ledger.byDwarfId[id];
      ledger.stats.evictedDwarves += 1;
    }
  }
  ledger.order = ledger.order.filter((id) => keep.has(id));
}

// Select the most consequential deed with deterministic recent/id tie breaks.
function selectDefiningDeed(deeds) {
  return deeds.slice().sort((left, right) => importanceRank(right.importance) - importanceRank(left.importance)
    || right.lastTick - left.lastTick || left.id.localeCompare(right.id))[0] || null;
}

// Resolve saga participation only while the saga remains active.
function collectActiveSagaRoles(state, dwarfId, deeds) {
  const sagas = state?.story?.sagas;
  if (!sagas || !Array.isArray(sagas.order)) return [];
  const deedBySaga = new Map(deeds.filter((deed) => deed.sagaId).map((deed) => [deed.sagaId, deed]));
  return sagas.order.map((id) => sagas.byId && sagas.byId[id]).filter((saga) => saga
    && ACTIVE_SAGA_STATUSES.has(saga.status)
    && (Array.isArray(saga.actorIds) && saga.actorIds.includes(String(dwarfId)) || deedBySaga.has(saga.id)))
    .slice(0, 3).map((saga) => ({ sagaId: saga.id, status: saga.status, role: deedBySaga.get(saga.id)?.role || 'participant' }));
}

// Gather dwarf IDs whose history is still required by live narrative systems.
function collectProtectedDwarfIds(state) {
  const ids = new Set();
  const hall = state?.warriors?.company?.hallOfFame;
  if (Array.isArray(hall)) for (const entry of hall) if (entry && entry.dwarfId) ids.add(String(entry.dwarfId));
  const sagas = state?.story?.sagas;
  if (sagas && Array.isArray(sagas.order)) {
    for (const sagaId of sagas.order) {
      const saga = sagas.byId && sagas.byId[sagaId];
      if (!saga || !ACTIVE_SAGA_STATUSES.has(saga.status)) continue;
      for (const actorId of Array.isArray(saga.actorIds) ? saga.actorIds : []) ids.add(String(actorId));
    }
  }
  return ids;
}

// Gather active saga IDs for deed-level retention.
function collectActiveSagaIds(state) {
  const ids = new Set();
  const sagas = state?.story?.sagas;
  if (!sagas || !Array.isArray(sagas.order)) return ids;
  for (const id of sagas.order) {
    const saga = sagas.byId && sagas.byId[id];
    if (saga && ACTIVE_SAGA_STATUSES.has(saga.status)) ids.add(id);
  }
  return ids;
}

// Compare deed value for bounded retention.
function compareRetention(left, right, activeSagas) {
  const leftPinned = left.sagaId && activeSagas.has(left.sagaId);
  const rightPinned = right.sagaId && activeSagas.has(right.sagaId);
  return Number(leftPinned) - Number(rightPinned)
    || importanceRank(left.importance) - importanceRank(right.importance)
    || left.lastTick - right.lastTick || right.id.localeCompare(left.id);
}

// Sort newest deeds first.
function compareRecent(left, right) {
  return right.lastTick - left.lastTick || right.id.localeCompare(left.id);
}

// Build one stable equivalence key for compact deed merging.
function locationKey(location) {
  const value = location || {};
  return [value.scope, value.depth, value.placeId, value.x, value.y].map((part) => part ?? '').join(':');
}

// Normalize supported importance names.
function normalizeImportance(value, fallback) {
  const normalized = String(value || '').toLowerCase();
  return IMPORTANCE.includes(normalized) ? normalized : fallback;
}

// Convert importance to its stable retention rank.
function importanceRank(value) {
  return Math.max(0, IMPORTANCE.indexOf(normalizeImportance(value, 'ambient')));
}

// Clamp one integer setting to its absolute safety range.
function clampInt(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
}

// Normalize persisted counters to non-negative safe integers.
function safeCount(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

module.exports = {
  createExperienceLedger,
  ensureExperienceLedger,
  recordExperienceEvent,
  getDwarfBiography,
};
