'use strict';

const HARD_MAX_SAGA_CHAPTERS = 16;
const HARD_MAX_CHAPTER_EVENT_REFS = 8;
const HARD_MAX_SAGA_ACTOR_REFS = 16;
const HARD_MAX_SAGA_PLACE_REFS = 8;
const HARD_MAX_SAGA_FACTION_REFS = 8;
const HARD_MAX_SAGA_THREAT_REFS = 8;
const HARD_MAX_SAGA_LOCATION_REFS = 8;
const HARD_MAX_CHAPTER_SUMMARY_CHARS = 512;
const ACTIVE_SAGA_STATUSES = new Set(['open', 'active', 'dormant']);
const TERMINAL_SAGA_STATUSES = new Set(['resolved', 'failed']);
const SAGA_STATUSES = new Set([
  ...ACTIVE_SAGA_STATUSES,
  ...TERMINAL_SAGA_STATUSES,
  'archived',
]);
const IMPORTANCE_ORDER = ['ambient', 'notable', 'major', 'critical', 'legendary'];

// Create the bounded ordered saga registry installed in each new cycle.
function createSagaRegistry() {
  return {
    nextSequence: 0,
    order: [],
    byId: {},
  };
}

// Repair a serialized saga registry under configured and absolute bounds.
function normalizeSagaRegistry(value, settings) {
  const source = isObject(value) ? value : {};
  const byIdSource = isObject(source.byId) ? source.byId : {};
  const rawOrder = Array.isArray(source.order) ? source.order : Object.keys(byIdSource);
  const registry = createSagaRegistry();
  registry.nextSequence = clampInteger(source.nextSequence, 0, 0, Number.MAX_SAFE_INTEGER);
  for (const rawId of rawOrder) {
    if (registry.order.length >= settings.maxEntries) break;
    const id = normalizeToken(rawId, 96);
    if (!id || !isSafeObjectKey(id) || registry.order.includes(id)) continue;
    if (!Object.prototype.hasOwnProperty.call(byIdSource, id)) continue;
    const saga = normalizeSagaRecord(byIdSource[id], id, settings);
    if (!saga) continue;
    registry.order.push(id);
    registry.byId[id] = saga;
  }
  return registry;
}

// Advance inactivity and terminal retention transitions at a simulation tick.
function advanceSagaLifecycles(story, settings, rawTick) {
  if (!story || !story.sagas) return;
  const tick = normalizeTick(rawTick, 0);
  for (const sagaId of story.sagas.order) {
    const saga = story.sagas.byId[sagaId];
    if (!saga || saga.status === 'archived') continue;
    const inactiveTicks = Math.max(0, tick - saga.lastEventTick);
    if (
      (saga.status === 'open' || saga.status === 'active')
      && inactiveTicks >= settings.inactivityTimeoutTicks
    ) {
      saga.status = 'dormant';
      closeActiveChapter(saga, tick);
    }
    if (
      (saga.status === 'dormant' || TERMINAL_SAGA_STATUSES.has(saga.status))
      && inactiveTicks >= settings.archiveTimeoutTicks
    ) {
      saga.status = 'archived';
      saga.archivedTick = tick;
      closeActiveChapter(saga, tick);
      incrementStoryStat(story, 'sagasArchived');
    }
  }
}

// Assign one canonical event to an explicit, causal, matched, or newly opened saga.
function processSagaEvent(story, event, settings) {
  if (!story || !story.sagas || !event) return null;
  const tick = normalizeTick(event.tick, 0);
  advanceSagaLifecycles(story, settings, tick);
  const evidence = buildEventEvidence(event);
  let saga = resolveExplicitSaga(story, event, settings, evidence);
  if (!saga) saga = resolveParentSaga(story, evidence.parentEventIds);
  if (!saga && isSagaEligible(event, settings)) {
    saga = resolveMatchedSaga(story, evidence, settings);
  }
  if (!saga && isSagaEligible(event, settings)) {
    saga = createGeneratedSaga(story, event, settings);
  }
  if (!saga) return null;

  appendSagaEvent(story, saga, event, evidence, settings);
  event.sagaId = saga.id;
  return saga;
}

function resolveExplicitSaga(story, event, settings) {
  const explicitId = normalizeToken(event.sagaId, 96);
  if (!explicitId || !isSafeObjectKey(explicitId)) return null;
  if (story.sagas.byId[explicitId]) return story.sagas.byId[explicitId];
  return createSaga(story, event, settings, explicitId);
}

function resolveParentSaga(story, parentEventIds) {
  if (parentEventIds.length === 0) return null;
  for (let index = story.sagas.order.length - 1; index >= 0; index -= 1) {
    const saga = story.sagas.byId[story.sagas.order[index]];
    if (!saga) continue;
    if (parentEventIds.some((eventId) => saga.eventIds.includes(eventId))) return saga;
  }
  return null;
}

function resolveMatchedSaga(story, evidence, settings) {
  const candidates = [];
  for (const sagaId of story.sagas.order) {
    const saga = story.sagas.byId[sagaId];
    if (!saga || !ACTIVE_SAGA_STATUSES.has(saga.status)) continue;
    const score = scoreSagaMatch(saga, evidence, settings.matching);
    if (score < settings.matching.minimumScore) continue;
    candidates.push({ saga, score });
  }
  candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.saga.lastEventTick !== left.saga.lastEventTick) {
      return right.saga.lastEventTick - left.saga.lastEventTick;
    }
    return left.saga.id.localeCompare(right.saga.id);
  });
  return candidates.length > 0 ? candidates[0].saga : null;
}

function scoreSagaMatch(saga, evidence, weights) {
  return countOverlap(saga.threatIds, evidence.threatIds) * weights.threat
    + countOverlap(saga.factionIds, evidence.factionIds) * weights.faction
    + countOverlap(saga.placeIds, evidence.placeIds) * weights.place
    + countOverlap(saga.locationKeys, evidence.locationKeys) * weights.location
    + countOverlap(saga.actorKeys, evidence.actorKeys) * weights.actor;
}

function countOverlap(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return 0;
  let count = 0;
  for (const value of right) {
    if (left.includes(value)) count += 1;
  }
  return count;
}

function isSagaEligible(event, settings) {
  if (normalizeToken(event.sagaId, 96)) return true;
  const rank = IMPORTANCE_ORDER.indexOf(String(event.importance || '').toLowerCase());
  const minimumRank = IMPORTANCE_ORDER.indexOf(settings.minimumImportance);
  return rank >= minimumRank;
}

function createGeneratedSaga(story, event, settings) {
  const cycle = normalizeTick(event.cycle, 0);
  let id = null;
  while (!id || story.sagas.byId[id]) {
    const sequence = story.sagas.nextSequence;
    story.sagas.nextSequence = Math.min(Number.MAX_SAFE_INTEGER, sequence + 1);
    id = `saga_c${String(cycle).padStart(4, '0')}_${String(sequence).padStart(4, '0')}`;
  }
  return createSaga(story, event, settings, id);
}

function createSaga(story, event, settings, id) {
  if (settings.maxEntries <= 0) return null;
  makeSagaCapacity(story, settings);
  if (story.sagas.order.length >= settings.maxEntries) return null;
  const tick = normalizeTick(event.tick, 0);
  const saga = {
    id,
    status: 'open',
    openedTick: tick,
    lastEventTick: tick,
    closedTick: null,
    archivedTick: null,
    eventCount: 0,
    eventIds: [],
    actorIds: [],
    actorKeys: [],
    placeIds: [],
    factionIds: [],
    threatIds: [],
    locationKeys: [],
    chapters: [],
    nextChapterSequence: 0,
    chaptersCompacted: 0,
    summary: '',
    resolutionEventId: null,
  };
  story.sagas.order.push(id);
  story.sagas.byId[id] = saga;
  incrementStoryStat(story, 'sagasOpened');
  return saga;
}

function makeSagaCapacity(story, settings) {
  while (story.sagas.order.length >= settings.maxEntries && story.sagas.order.length > 0) {
    const candidates = story.sagas.order
      .map((id, index) => ({ saga: story.sagas.byId[id], id, index }))
      .filter((entry) => entry.saga);
    candidates.sort((left, right) => {
      const leftRank = evictionRank(left.saga.status);
      const rightRank = evictionRank(right.saga.status);
      if (leftRank !== rightRank) return leftRank - rightRank;
      if (left.saga.lastEventTick !== right.saga.lastEventTick) {
        return left.saga.lastEventTick - right.saga.lastEventTick;
      }
      if (left.index !== right.index) return left.index - right.index;
      return left.id.localeCompare(right.id);
    });
    const selected = candidates[0];
    if (!selected) return;
    if (selected.saga.status !== 'archived') incrementStoryStat(story, 'sagasArchived');
    delete story.sagas.byId[selected.id];
    story.sagas.order.splice(selected.index, 1);
    incrementStoryStat(story, 'sagasEvicted');
  }
}

function evictionRank(status) {
  if (status === 'archived') return 0;
  if (TERMINAL_SAGA_STATUSES.has(status)) return 1;
  if (status === 'dormant') return 2;
  if (status === 'open') return 3;
  return 4;
}

function appendSagaEvent(story, saga, event, evidence, settings) {
  const tick = normalizeTick(event.tick, saga.lastEventTick);
  saga.lastEventTick = tick;
  saga.eventCount = Math.min(Number.MAX_SAFE_INTEGER, saga.eventCount + 1);
  appendUniqueBounded(saga.eventIds, event.id, settings.maxEventRefs);
  appendManyBounded(saga.actorIds, evidence.actorIds, settings.maxActorRefs);
  appendManyBounded(saga.actorKeys, evidence.actorKeys, settings.maxActorRefs);
  appendManyBounded(saga.placeIds, evidence.placeIds, settings.maxPlaceRefs);
  appendManyBounded(saga.factionIds, evidence.factionIds, settings.maxFactionRefs);
  appendManyBounded(saga.threatIds, evidence.threatIds, settings.maxThreatRefs);
  appendManyBounded(saga.locationKeys, evidence.locationKeys, settings.maxLocationRefs);
  appendChapterFact(story, saga, event, settings);

  const terminalStatus = resolveTerminalStatus(event, settings.lifecycle);
  if (terminalStatus) {
    const changed = saga.status !== terminalStatus;
    saga.status = terminalStatus;
    saga.closedTick = tick;
    saga.resolutionEventId = event.id;
    closeActiveChapter(saga, tick);
    if (changed) incrementStoryStat(story, terminalStatus === 'resolved' ? 'sagasResolved' : 'sagasFailed');
    return;
  }
  if (saga.status === 'archived' || TERMINAL_SAGA_STATUSES.has(saga.status)) {
    closeActiveChapter(saga, tick);
    return;
  }
  const eventRank = IMPORTANCE_ORDER.indexOf(String(event.importance || '').toLowerCase());
  const activationRank = IMPORTANCE_ORDER.indexOf(settings.lifecycle.activationMinimumImportance);
  if (saga.eventCount >= settings.lifecycle.activationEventCount || eventRank >= activationRank) {
    saga.status = 'active';
  } else if (saga.status === 'dormant') {
    saga.status = 'active';
  }
}

function appendChapterFact(story, saga, event, settings) {
  let chapter = saga.chapters.length > 0 ? saga.chapters[saga.chapters.length - 1] : null;
  if (!chapter || chapter.status !== 'active' || chapter.eventIds.length >= settings.maxEventsPerChapter) {
    if (chapter && chapter.status === 'active') closeChapter(chapter, normalizeTick(event.tick, 0));
    chapter = createChapter(saga, event, settings);
    saga.chapters.push(chapter);
    incrementStoryStat(story, 'chaptersOpened');
    if (saga.chapters.length > settings.maxChapters) {
      saga.chapters.splice(0, saga.chapters.length - settings.maxChapters);
      saga.chaptersCompacted = Math.min(Number.MAX_SAFE_INTEGER, saga.chaptersCompacted + 1);
      incrementStoryStat(story, 'chaptersCompacted');
    }
  } else {
    appendUniqueBounded(chapter.eventIds, event.id, settings.maxEventsPerChapter);
    chapter.lastEventTick = normalizeTick(event.tick, chapter.lastEventTick);
    chapter.latestFact = normalizeText(event.message, settings.chapterSummaryMaxChars);
    chapter.summary = buildChapterSummary(
      chapter.openingFact,
      chapter.latestFact,
      settings.chapterSummaryMaxChars,
    );
  }
  saga.summary = chapter.summary;
}

function createChapter(saga, event, settings) {
  const tick = normalizeTick(event.tick, 0);
  const sequence = saga.nextChapterSequence;
  saga.nextChapterSequence = Math.min(Number.MAX_SAFE_INTEGER, sequence + 1);
  const fact = normalizeText(event.message, settings.chapterSummaryMaxChars);
  return {
    id: `${saga.id}_ch${String(sequence).padStart(4, '0')}`,
    status: 'active',
    openedTick: tick,
    lastEventTick: tick,
    closedTick: null,
    eventIds: [event.id],
    openingFact: fact,
    latestFact: fact,
    summary: fact,
  };
}

function buildChapterSummary(openingFact, latestFact, limit) {
  if (!latestFact || latestFact === openingFact) return normalizeText(openingFact, limit);
  return normalizeText(`${openingFact} Then: ${latestFact}`, limit);
}

function closeActiveChapter(saga, tick) {
  const chapter = saga.chapters.length > 0 ? saga.chapters[saga.chapters.length - 1] : null;
  if (chapter && chapter.status === 'active') closeChapter(chapter, tick);
}

function closeChapter(chapter, tick) {
  chapter.status = 'closed';
  chapter.closedTick = normalizeTick(tick, chapter.lastEventTick);
}

function resolveTerminalStatus(event, lifecycle) {
  const type = normalizeToken(event.type, 96) || '';
  const tags = normalizeTokenList(event.tags, 32, 32);
  if (lifecycle.failedTypeSuffixes.some((suffix) => typeHasSuffix(type, suffix))
    || tags.includes('failed')) return 'failed';
  if (lifecycle.resolvedTypeSuffixes.some((suffix) => typeHasSuffix(type, suffix))
    || tags.includes('resolved')) return 'resolved';
  if (Array.isArray(event.consequences) && event.consequences.some((consequence) => (
    consequence
    && consequence.kind === 'destroy'
    && consequence.targetKind === 'threat'
  ))) return 'resolved';
  return null;
}

function typeHasSuffix(type, rawSuffix) {
  const suffix = normalizeToken(rawSuffix, 32);
  return Boolean(suffix && (
    type === suffix
    || type.endsWith(`.${suffix}`)
    || type.endsWith(`_${suffix}`)
  ));
}

function buildEventEvidence(event) {
  const actorIds = [];
  const actorKeys = [];
  const factionIds = [];
  const threatIds = [];
  for (const actor of Array.isArray(event.actors) ? event.actors : []) {
    const kind = normalizeToken(actor && actor.kind, 32);
    const id = normalizeToken(actor && actor.id, 96);
    if (!kind || !id || kind === 'system' || kind === 'settlement' || kind === 'institution') continue;
    appendUniqueBounded(actorIds, id, HARD_MAX_SAGA_ACTOR_REFS);
    appendUniqueBounded(actorKeys, `${kind}:${id}`, HARD_MAX_SAGA_ACTOR_REFS);
    if (kind === 'faction') appendUniqueBounded(factionIds, id, HARD_MAX_SAGA_FACTION_REFS);
    if (kind === 'threat') appendUniqueBounded(threatIds, id, HARD_MAX_SAGA_THREAT_REFS);
  }
  const placeIds = [];
  const locationKeys = [];
  const location = isObject(event.location) ? event.location : {};
  const placeId = normalizeToken(location.placeId, 96);
  if (placeId) placeIds.push(placeId);
  const locationKey = buildLocationKey(location);
  if (locationKey) locationKeys.push(locationKey);
  const parentEventIds = [];
  for (const cause of Array.isArray(event.causes) ? event.causes : []) {
    if (cause && cause.kind === 'event') {
      appendUniqueBounded(parentEventIds, normalizeToken(cause.ref, 96), 8);
    }
  }
  return {
    actorIds,
    actorKeys,
    placeIds,
    factionIds,
    threatIds,
    locationKeys,
    parentEventIds,
  };
}

function buildLocationKey(location) {
  const scope = normalizeToken(location.scope, 32);
  if (!scope || scope === 'world') return null;
  const placeId = normalizeToken(location.placeId, 96);
  if (placeId) return `place:${placeId}`;
  const depth = scope === 'underrealm' ? normalizeTick(location.depth, 1) : 0;
  const x = Number(location.x);
  const y = Number(location.y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    return `${scope}:d${depth}:x${Math.floor(x)}:y${Math.floor(y)}`;
  }
  return scope === 'underrealm' ? `underrealm:d${depth}` : null;
}

function normalizeSagaRecord(value, id, settings) {
  if (!isObject(value)) return null;
  const statusRaw = normalizeToken(value.status, 32);
  const status = SAGA_STATUSES.has(statusRaw) ? statusRaw : 'open';
  const chapters = normalizeChapters(value.chapters, id, settings);
  normalizeChapterLifecycle(chapters, status);
  return {
    id,
    status,
    openedTick: normalizeTick(value.openedTick, 0),
    lastEventTick: normalizeTick(value.lastEventTick, 0),
    closedTick: normalizeNullableTick(value.closedTick),
    archivedTick: normalizeNullableTick(value.archivedTick),
    eventCount: clampInteger(value.eventCount, 0, 0, Number.MAX_SAFE_INTEGER),
    eventIds: normalizeTokenList(value.eventIds, settings.maxEventRefs, 96),
    actorIds: normalizeTokenList(value.actorIds, settings.maxActorRefs, 96),
    actorKeys: normalizeTokenList(value.actorKeys, settings.maxActorRefs, 128),
    placeIds: normalizeTokenList(value.placeIds, settings.maxPlaceRefs, 96),
    factionIds: normalizeTokenList(value.factionIds, settings.maxFactionRefs, 96),
    threatIds: normalizeTokenList(value.threatIds, settings.maxThreatRefs, 96),
    locationKeys: normalizeTokenList(value.locationKeys, settings.maxLocationRefs, 128),
    chapters,
    nextChapterSequence: resolveNextChapterSequence(value.nextChapterSequence, chapters),
    chaptersCompacted: clampInteger(value.chaptersCompacted, 0, 0, Number.MAX_SAFE_INTEGER),
    summary: normalizeText(value.summary, settings.chapterSummaryMaxChars),
    resolutionEventId: normalizeToken(value.resolutionEventId, 96),
  };
}

function normalizeChapters(value, sagaId, settings) {
  if (!Array.isArray(value)) return [];
  const source = value.slice(-settings.maxChapters);
  const chapters = [];
  for (let index = 0; index < source.length; index += 1) {
    const chapter = source[index];
    if (!isObject(chapter)) continue;
    const openingFact = normalizeText(chapter.openingFact, settings.chapterSummaryMaxChars);
    const latestFact = normalizeText(chapter.latestFact, settings.chapterSummaryMaxChars);
    chapters.push({
      id: normalizeToken(chapter.id, 128) || `${sagaId}_ch${String(index).padStart(4, '0')}`,
      status: chapter.status === 'closed' ? 'closed' : 'active',
      openedTick: normalizeTick(chapter.openedTick, 0),
      lastEventTick: normalizeTick(chapter.lastEventTick, 0),
      closedTick: normalizeNullableTick(chapter.closedTick),
      eventIds: normalizeTokenList(chapter.eventIds, settings.maxEventsPerChapter, 96),
      openingFact,
      latestFact,
      summary: normalizeText(
        chapter.summary || buildChapterSummary(openingFact, latestFact, settings.chapterSummaryMaxChars),
        settings.chapterSummaryMaxChars,
      ),
    });
  }
  return chapters;
}

function normalizeChapterLifecycle(chapters, sagaStatus) {
  for (let index = 0; index < chapters.length - 1; index += 1) {
    if (chapters[index].status !== 'closed' || chapters[index].closedTick === null) {
      closeChapter(chapters[index], chapters[index].lastEventTick);
    }
  }
  if (
    chapters.length > 0
    && (sagaStatus === 'dormant' || sagaStatus === 'archived' || TERMINAL_SAGA_STATUSES.has(sagaStatus))
  ) {
    const latest = chapters[chapters.length - 1];
    if (latest.status !== 'closed' || latest.closedTick === null) {
      closeChapter(latest, latest.lastEventTick);
    }
  }
}

function resolveNextChapterSequence(value, chapters) {
  let minimum = chapters.length;
  for (const chapter of chapters) {
    const match = String(chapter.id || '').match(/_ch(\d+)$/);
    if (!match) continue;
    minimum = Math.max(
      minimum,
      Math.min(Number.MAX_SAFE_INTEGER, Number(match[1]) + 1),
    );
  }
  return Math.max(
    minimum,
    clampInteger(value, minimum, 0, Number.MAX_SAFE_INTEGER),
  );
}

function appendManyBounded(target, values, limit) {
  for (const value of values) appendUniqueBounded(target, value, limit);
}

function appendUniqueBounded(target, rawValue, limit) {
  const value = normalizeToken(rawValue, 128);
  if (!value || limit <= 0) return;
  if (target.includes(value)) return;
  target.push(value);
  if (target.length > limit) target.splice(0, target.length - limit);
}

function normalizeTokenList(value, limit, byteLimit) {
  if (!Array.isArray(value) || limit <= 0) return [];
  const result = [];
  for (const raw of value.slice(-limit)) {
    const token = normalizeToken(raw, byteLimit);
    if (token && !result.includes(token)) result.push(token);
  }
  return result;
}

function incrementStoryStat(story, field) {
  if (!story.stats || !Object.prototype.hasOwnProperty.call(story.stats, field)) return;
  const current = Number(story.stats[field] || 0);
  story.stats[field] = Number.isSafeInteger(current) && current >= 0
    ? Math.min(Number.MAX_SAFE_INTEGER, current + 1)
    : 1;
}

function normalizeText(value, limit) {
  const text = String(value === null || value === undefined ? '' : value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(text).slice(0, Math.max(0, limit)).join('');
}

function normalizeToken(value, byteLimit) {
  const token = String(value === null || value === undefined ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '_');
  if (!token) return null;
  return Buffer.from(token, 'utf8').subarray(0, byteLimit).toString('utf8').replace(/\ufffd+$/g, '') || null;
}

function normalizeTick(value, fallback) {
  return clampInteger(value, fallback, 0, Number.MAX_SAFE_INTEGER);
}

function normalizeNullableTick(value) {
  if (value === null || value === undefined) return null;
  return normalizeTick(value, 0);
}

function clampInteger(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isSafeObjectKey(value) {
  return value !== '__proto__' && value !== 'prototype' && value !== 'constructor';
}

module.exports = {
  HARD_MAX_CHAPTER_EVENT_REFS,
  HARD_MAX_CHAPTER_SUMMARY_CHARS,
  HARD_MAX_SAGA_ACTOR_REFS,
  HARD_MAX_SAGA_CHAPTERS,
  HARD_MAX_SAGA_FACTION_REFS,
  HARD_MAX_SAGA_LOCATION_REFS,
  HARD_MAX_SAGA_PLACE_REFS,
  HARD_MAX_SAGA_THREAT_REFS,
  advanceSagaLifecycles,
  createSagaRegistry,
  normalizeSagaRegistry,
  processSagaEvent,
};
