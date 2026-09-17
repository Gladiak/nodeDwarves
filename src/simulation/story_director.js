'use strict';

const { EVENT_IMPORTANCE } = require('./narrative_contract');
const {
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
  normalizeSagaRegistry: normalizeSagaRegistryV3,
  processSagaEvent,
} = require('./story_sagas');

const STORY_SCHEMA_VERSION = 3;
const HARD_MAX_SAGAS = 64;
const HARD_MAX_SAGA_EVENT_REFS = 32;
const HARD_MAX_HISTORY = 512;
const HARD_MAX_REASON_TRACE = 512;
const HARD_MAX_FREQUENCY_TYPES = 256;
const HARD_MAX_SCORE = 50000000;
const MAX_FOCUS_ACTORS = 8;

// Resolve and clamp the Story Director configuration without mutating source config.
function getStoryDirectorConfig(config) {
  const raw = config && config.story_director && typeof config.story_director === 'object'
    ? config.story_director
    : {};
  const focusRaw = raw.focus && typeof raw.focus === 'object' ? raw.focus : {};
  const budgetRaw = focusRaw.interruption_budget && typeof focusRaw.interruption_budget === 'object'
    ? focusRaw.interruption_budget
    : {};
  const escalationRaw = focusRaw.escalation && typeof focusRaw.escalation === 'object'
    ? focusRaw.escalation
    : {};
  const sagasRaw = raw.sagas && typeof raw.sagas === 'object' ? raw.sagas : {};
  const sagaMatchingRaw = sagasRaw.matching && typeof sagasRaw.matching === 'object'
    ? sagasRaw.matching
    : {};
  const sagaLifecycleRaw = sagasRaw.lifecycle && typeof sagasRaw.lifecycle === 'object'
    ? sagasRaw.lifecycle
    : {};
  const sagaChaptersRaw = sagasRaw.chapters && typeof sagasRaw.chapters === 'object'
    ? sagasRaw.chapters
    : {};
  const historyRaw = raw.history && typeof raw.history === 'object' ? raw.history : {};
  const scoringRaw = raw.scoring && typeof raw.scoring === 'object' ? raw.scoring : {};
  const importanceRaw = scoringRaw.importance && typeof scoringRaw.importance === 'object'
    ? scoringRaw.importance
    : {};
  const rarityRaw = scoringRaw.rarity && typeof scoringRaw.rarity === 'object'
    ? scoringRaw.rarity
    : {};
  const namedActorsRaw = scoringRaw.named_actors && typeof scoringRaw.named_actors === 'object'
    ? scoringRaw.named_actors
    : {};
  const consequencesRaw = scoringRaw.consequences && typeof scoringRaw.consequences === 'object'
    ? scoringRaw.consequences
    : {};
  const visibilityRaw = scoringRaw.visibility && typeof scoringRaw.visibility === 'object'
    ? scoringRaw.visibility
    : {};
  return {
    enabled: raw.enabled !== false,
    focus: {
      minimumImportance: normalizeImportance(focusRaw.minimum_importance, 'major'),
      cooldownTicks: clampInteger(focusRaw.cooldown_ticks, 180, 0, 1000000),
      durationTicks: clampInteger(focusRaw.duration_ticks, 240, 1, 1000000),
      interruptionBudget: {
        windowTicks: clampInteger(budgetRaw.window_ticks, 1200, 1, 10000000),
        maxInterruptions: clampInteger(budgetRaw.max_interruptions, 3, 0, 1000),
      },
      escalation: {
        enabled: escalationRaw.enabled !== false,
        minimumImportance: normalizeImportance(escalationRaw.minimum_importance, 'critical'),
        cooldownTicks: clampInteger(escalationRaw.cooldown_ticks, 60, 0, 1000000),
      },
    },
    sagas: {
      minimumImportance: normalizeImportance(sagasRaw.minimum_importance, 'major'),
      inactivityTimeoutTicks: clampInteger(sagasRaw.inactivity_timeout_ticks, 2400, 1, 10000000),
      archiveTimeoutTicks: clampInteger(sagasRaw.archive_timeout_ticks, 7200, 1, 10000000),
      maxEntries: clampInteger(sagasRaw.max_entries, 24, 0, HARD_MAX_SAGAS),
      maxEventRefs: clampInteger(sagasRaw.max_event_refs, 16, 1, HARD_MAX_SAGA_EVENT_REFS),
      maxActorRefs: clampInteger(sagasRaw.max_actor_refs, 12, 1, HARD_MAX_SAGA_ACTOR_REFS),
      maxPlaceRefs: clampInteger(sagasRaw.max_place_refs, 8, 1, HARD_MAX_SAGA_PLACE_REFS),
      maxFactionRefs: clampInteger(
        sagasRaw.max_faction_refs,
        8,
        1,
        HARD_MAX_SAGA_FACTION_REFS,
      ),
      maxThreatRefs: clampInteger(sagasRaw.max_threat_refs, 8, 1, HARD_MAX_SAGA_THREAT_REFS),
      maxLocationRefs: clampInteger(
        sagasRaw.max_location_refs,
        8,
        1,
        HARD_MAX_SAGA_LOCATION_REFS,
      ),
      maxChapters: clampInteger(
        sagaChaptersRaw.max_entries,
        8,
        1,
        HARD_MAX_SAGA_CHAPTERS,
      ),
      maxEventsPerChapter: clampInteger(
        sagaChaptersRaw.max_event_refs,
        4,
        1,
        HARD_MAX_CHAPTER_EVENT_REFS,
      ),
      chapterSummaryMaxChars: clampInteger(
        sagaChaptersRaw.summary_max_chars,
        240,
        32,
        HARD_MAX_CHAPTER_SUMMARY_CHARS,
      ),
      matching: {
        minimumScore: clampInteger(sagaMatchingRaw.minimum_score, 30, 1, 1000000),
        actor: clampInteger(sagaMatchingRaw.actor_weight, 30, 0, 1000000),
        location: clampInteger(sagaMatchingRaw.location_weight, 20, 0, 1000000),
        place: clampInteger(sagaMatchingRaw.place_weight, 40, 0, 1000000),
        faction: clampInteger(sagaMatchingRaw.faction_weight, 80, 0, 1000000),
        threat: clampInteger(sagaMatchingRaw.threat_weight, 100, 0, 1000000),
      },
      lifecycle: {
        activationEventCount: clampInteger(
          sagaLifecycleRaw.activation_event_count,
          2,
          1,
          1000000,
        ),
        activationMinimumImportance: normalizeImportance(
          sagaLifecycleRaw.activation_minimum_importance,
          'critical',
        ),
        resolvedTypeSuffixes: normalizeConfigTokenList(
          sagaLifecycleRaw.resolved_type_suffixes,
          ['resolved', 'completed', 'succeeded', 'defeated', 'reconciliation', 'closed'],
          16,
        ),
        failedTypeSuffixes: normalizeConfigTokenList(
          sagaLifecycleRaw.failed_type_suffixes,
          ['failed', 'expired'],
          16,
        ),
      },
    },
    history: {
      maxEntries: clampInteger(historyRaw.max_entries, 160, 0, HARD_MAX_HISTORY),
      reasonTraceMaxEntries: clampInteger(
        historyRaw.reason_trace_max_entries,
        160,
        1,
        HARD_MAX_REASON_TRACE,
      ),
    },
    scoring: {
      importance: {
        ambient: clampInteger(importanceRaw.ambient, 0, 0, 1000000),
        notable: clampInteger(importanceRaw.notable, 25, 0, 1000000),
        major: clampInteger(importanceRaw.major, 50, 0, 1000000),
        critical: clampInteger(importanceRaw.critical, 80, 0, 1000000),
        legendary: clampInteger(importanceRaw.legendary, 120, 0, 1000000),
      },
      rarity: {
        firstOccurrenceBonus: clampInteger(
          rarityRaw.first_occurrence_bonus,
          18,
          0,
          1000000,
        ),
        maxTrackedTypes: clampInteger(
          rarityRaw.max_tracked_types,
          128,
          0,
          HARD_MAX_FREQUENCY_TYPES,
        ),
      },
      namedActors: {
        perActor: clampInteger(namedActorsRaw.per_actor, 8, 0, 1000000),
        maxActors: clampInteger(namedActorsRaw.max_actors, 3, 0, MAX_FOCUS_ACTORS),
      },
      consequences: {
        perEntry: clampInteger(consequencesRaw.per_entry, 5, 0, 1000000),
        maxEntries: clampInteger(consequencesRaw.max_entries, 4, 0, 12),
      },
      currentSagaBonus: clampInteger(scoringRaw.current_saga_bonus, 24, 0, 1000000),
      visibility: {
        visibleBonus: clampInteger(visibilityRaw.visible_bonus, 12, 0, 1000000),
        worldBonus: clampInteger(visibilityRaw.world_bonus, 4, 0, 1000000),
        hiddenPenalty: clampInteger(visibilityRaw.hidden_penalty, 6, 0, 1000000),
      },
    },
  };
}

// Create empty per-cycle Story Director state before the first canonical event arrives.
function createStoryDirectorState(config) {
  const settings = getStoryDirectorConfig(config);
  return {
    schemaVersion: STORY_SCHEMA_VERSION,
    enabled: settings.enabled,
    currentFocus: null,
    sagas: createSagaRegistry(),
    cooldowns: {
      focusUntilTick: 0,
      escalationUntilTick: 0,
    },
    interruptionBudget: {
      windowStartedTick: 0,
      used: 0,
    },
    frequencies: {
      order: [],
      byType: {},
    },
    history: [],
    reasonTrace: [],
    cursor: {
      lastEventId: null,
      lastCycle: -1,
      lastTick: -1,
      lastSequence: -1,
    },
    stats: createStoryStats(),
  };
}

// Repair serialized or legacy state while enforcing config limits and absolute hard caps.
function ensureStoryDirectorState(state, config) {
  if (!state || typeof state !== 'object') {
    return null;
  }
  const settings = getStoryDirectorConfig(config);
  if (!state.story || typeof state.story !== 'object' || Array.isArray(state.story)) {
    state.story = createStoryDirectorState(config);
    return state.story;
  }
  const story = state.story;
  story.schemaVersion = STORY_SCHEMA_VERSION;
  story.enabled = settings.enabled;
  story.currentFocus = normalizeFocusRecord(story.currentFocus);
  story.sagas = normalizeSagaRegistryV3(story.sagas, settings.sagas);
  story.cooldowns = {
    focusUntilTick: normalizeTick(story.cooldowns && story.cooldowns.focusUntilTick, 0),
    escalationUntilTick: normalizeTick(story.cooldowns && story.cooldowns.escalationUntilTick, 0),
  };
  story.interruptionBudget = {
    windowStartedTick: normalizeTick(
      story.interruptionBudget && story.interruptionBudget.windowStartedTick,
      0,
    ),
    used: clampInteger(
      story.interruptionBudget && story.interruptionBudget.used,
      0,
      0,
      settings.focus.interruptionBudget.maxInterruptions,
    ),
  };
  story.frequencies = normalizeFrequencyRegistry(
    story.frequencies,
    settings.scoring.rarity.maxTrackedTypes,
  );
  story.history = normalizeRecordList(
    story.history,
    settings.history.maxEntries,
    normalizeHistoryRecord,
  );
  story.reasonTrace = normalizeRecordList(
    story.reasonTrace,
    settings.history.reasonTraceMaxEntries,
    normalizeReasonTraceRecord,
  );
  story.cursor = {
    lastEventId: normalizeNullableToken(story.cursor && story.cursor.lastEventId, 96),
    lastCycle: normalizeSignedTick(story.cursor && story.cursor.lastCycle, -1),
    lastTick: normalizeSignedTick(story.cursor && story.cursor.lastTick, -1),
    lastSequence: normalizeSignedTick(story.cursor && story.cursor.lastSequence, -1),
  };
  story.stats = normalizeStoryStats(story.stats);
  return story;
}

// Expire the current focus at a simulation tick without consulting events or timing sources.
function advanceStoryDirector(state, config) {
  const story = ensureStoryDirectorState(state, config);
  if (!story || !story.enabled) return story;
  const settings = getStoryDirectorConfig(config);
  const tick = normalizeTick(state && state.tick, 0);
  expireCurrentFocus(story, settings, tick);
  advanceSagaLifecycles(story, settings.sagas, tick);
  return story;
}

// Score and deterministically accept or suppress one committed canonical event.
function processStoryDirectorEvent(state, config, event) {
  const story = ensureStoryDirectorState(state, config);
  if (!story || !isProcessableEvent(event) || !isEventAfterCursor(event, story.cursor)) {
    return { decision: 'ignored', reasonCode: 'invalid_or_processed', score: 0 };
  }
  const settings = getStoryDirectorConfig(config);
  updateStoryCursor(story.cursor, event);
  if (!story.enabled) {
    return { decision: 'ignored', reasonCode: 'director_disabled', score: 0 };
  }

  const tick = normalizeTick(event.tick, normalizeTick(state && state.tick, 0));
  expireCurrentFocus(story, settings, tick);
  advanceSagaLifecycles(story, settings.sagas, tick);
  processSagaEvent(story, event, settings.sagas);
  const score = buildStoryEventScore(state, story, event, settings);
  incrementFrequency(story.frequencies, event.type, settings.scoring.rarity.maxTrackedTypes);
  incrementStoryStat(story, 'considered');
  incrementPriorityImportanceStat(story, event.importance, 'Considered');
  incrementPriorityContextStat(story, event);

  const eventRank = EVENT_IMPORTANCE.indexOf(event.importance);
  const minimumRank = EVENT_IMPORTANCE.indexOf(settings.focus.minimumImportance);
  if (eventRank < minimumRank) {
    return suppressStoryEvent(story, settings, event, score, tick, 'below_minimum_importance');
  }

  const current = story.currentFocus;
  const escalationRank = EVENT_IMPORTANCE.indexOf(settings.focus.escalation.minimumImportance);
  const qualifiesForEscalation = settings.focus.escalation.enabled
    && eventRank >= escalationRank;
  if (current) {
    const currentRank = EVENT_IMPORTANCE.indexOf(current.importance);
    const stronger = eventRank > currentRank
      || (eventRank === currentRank && score.total > Number(current.score || 0));
    if (!qualifiesForEscalation || !stronger) {
      return suppressStoryEvent(story, settings, event, score, tick, 'focus_active');
    }
    return attemptEscalatedSelection(story, settings, event, score, tick, true);
  }

  if (tick < story.cooldowns.focusUntilTick) {
    if (!qualifiesForEscalation) {
      return suppressStoryEvent(story, settings, event, score, tick, 'focus_cooldown');
    }
    return attemptEscalatedSelection(story, settings, event, score, tick, false);
  }
  return selectStoryEvent(story, settings, event, score, tick, 'selected_focus', false);
}

// Return the score breakdown used by runtime selection without mutating frequency counters.
function scoreStoryEvent(state, config, event) {
  const story = ensureStoryDirectorState(state, config);
  const settings = getStoryDirectorConfig(config);
  return buildStoryEventScore(state, story, event, settings);
}

function attemptEscalatedSelection(story, settings, event, score, tick, preempting) {
  refreshInterruptionBudget(story, settings, tick);
  if (tick < story.cooldowns.escalationUntilTick) {
    return suppressStoryEvent(story, settings, event, score, tick, 'escalation_cooldown');
  }
  if (story.interruptionBudget.used >= settings.focus.interruptionBudget.maxInterruptions) {
    return suppressStoryEvent(
      story,
      settings,
      event,
      score,
      tick,
      'interruption_budget_exhausted',
    );
  }
  story.interruptionBudget.used += 1;
  story.cooldowns.escalationUntilTick = tick + settings.focus.escalation.cooldownTicks;
  return selectStoryEvent(
    story,
    settings,
    event,
    score,
    tick,
    preempting ? 'selected_preemption' : 'selected_escalation',
    preempting,
  );
}

function selectStoryEvent(story, settings, event, score, tick, reasonCode, preempting) {
  if (preempting && story.currentFocus) {
    appendFocusHistory(story, settings, story.currentFocus, 'preempted');
    incrementStoryStat(story, 'preempted');
  }
  story.currentFocus = {
    eventId: event.id,
    type: event.type,
    importance: event.importance,
    sagaId: event.sagaId || null,
    selectedTick: tick,
    expiresTick: tick + settings.focus.durationTicks,
    actorIds: normalizeTokenList(
      Array.isArray(event.actors) ? event.actors.map((actor) => actor && actor.id) : [],
      MAX_FOCUS_ACTORS,
      96,
    ),
    placeId: normalizeNullableToken(event.location && event.location.placeId, 96),
    score: score.total,
    reasonCode,
  };
  story.cooldowns.focusUntilTick = tick + settings.focus.cooldownTicks;
  incrementStoryStat(story, 'selected');
  incrementPriorityImportanceStat(story, event.importance, 'Selected');
  appendReasonTrace(story, settings, event, score, tick, 'selected', reasonCode);
  return { decision: 'selected', reasonCode, score: score.total };
}

function suppressStoryEvent(story, settings, event, score, tick, reasonCode) {
  incrementStoryStat(story, 'suppressed');
  incrementPriorityImportanceStat(story, event.importance, 'Suppressed');
  appendReasonTrace(story, settings, event, score, tick, 'suppressed', reasonCode);
  return { decision: 'suppressed', reasonCode, score: score.total };
}

function buildStoryEventScore(state, story, event, settings) {
  const importance = normalizeImportance(event && event.importance, 'ambient');
  const severityScore = settings.scoring.importance[importance];
  const priorCount = getFrequencyCount(
    story && story.frequencies,
    event && event.type,
    settings.scoring.rarity.maxTrackedTypes,
  );
  const rarityScore = priorCount === null
    ? 0
    : Math.floor(settings.scoring.rarity.firstOccurrenceBonus / (priorCount + 1));
  const namedActorCount = Math.min(
    settings.scoring.namedActors.maxActors,
    Array.isArray(event && event.actors)
      ? event.actors.filter((actor) => String(actor && actor.label || '').trim().length > 0).length
      : 0,
  );
  const namedActorScore = namedActorCount * settings.scoring.namedActors.perActor;
  const consequenceCount = Math.min(
    settings.scoring.consequences.maxEntries,
    Array.isArray(event && event.consequences) ? event.consequences.length : 0,
  );
  const consequenceScore = consequenceCount * settings.scoring.consequences.perEntry;
  const currentSagaScore = event && event.sagaId && story && story.currentFocus
    && story.currentFocus.sagaId === event.sagaId
    ? settings.scoring.currentSagaBonus
    : 0;
  const visibilityScore = resolveVisibilityScore(state, event && event.location, settings.scoring.visibility);
  return {
    total: severityScore
      + rarityScore
      + namedActorScore
      + consequenceScore
      + currentSagaScore
      + visibilityScore,
    severityScore,
    rarityScore,
    namedActorScore,
    consequenceScore,
    currentSagaScore,
    visibilityScore,
  };
}

function resolveVisibilityScore(state, location, settings) {
  const scope = String(location && location.scope || 'world').toLowerCase();
  if (scope === 'world') return settings.worldBonus;
  const activeDepth = Math.max(0, Math.floor(Number(
    state && state.underrealm && state.underrealm.activeDepth || 0,
  )));
  const locationDepth = scope === 'underrealm'
    ? Math.max(1, Math.floor(Number(location && location.depth || 1)))
    : 0;
  return activeDepth === locationDepth ? settings.visibleBonus : -settings.hiddenPenalty;
}

function appendReasonTrace(story, settings, event, score, tick, decision, reasonCode) {
  appendBoundedRecord(story.reasonTrace, {
    tick,
    eventId: event.id,
    sagaId: event.sagaId || null,
    decision,
    reasonCode,
    score: score.total,
    severityScore: score.severityScore,
    rarityScore: score.rarityScore,
    namedActorScore: score.namedActorScore,
    consequenceScore: score.consequenceScore,
    currentSagaScore: score.currentSagaScore,
    visibilityScore: score.visibilityScore,
  }, settings.history.reasonTraceMaxEntries);
}

function expireCurrentFocus(story, settings, tick) {
  if (!story.currentFocus || tick < story.currentFocus.expiresTick) return;
  appendFocusHistory(story, settings, story.currentFocus, 'expired');
  story.currentFocus = null;
}

function appendFocusHistory(story, settings, focus, outcome) {
  appendBoundedRecord(story.history, {
    ...focus,
    outcome,
  }, settings.history.maxEntries);
}

function appendBoundedRecord(records, record, limit) {
  if (!Array.isArray(records) || limit <= 0) return;
  records.push(record);
  if (records.length > limit) records.splice(0, records.length - limit);
}

function refreshInterruptionBudget(story, settings, tick) {
  const elapsed = tick - story.interruptionBudget.windowStartedTick;
  if (elapsed >= settings.focus.interruptionBudget.windowTicks || elapsed < 0) {
    story.interruptionBudget.windowStartedTick = tick;
    story.interruptionBudget.used = 0;
  }
}

function incrementStoryStat(story, field) {
  const current = Number(story.stats && story.stats[field] || 0);
  story.stats[field] = Number.isSafeInteger(current) && current >= 0
    ? Math.min(Number.MAX_SAFE_INTEGER, current + 1)
    : 1;
}

function incrementPriorityImportanceStat(story, importance, suffix) {
  const normalized = normalizeImportance(importance, 'ambient');
  if (normalized !== 'critical' && normalized !== 'legendary') return;
  incrementStoryStat(story, `${normalized}${suffix}`);
}

function incrementPriorityContextStat(story, event) {
  const importance = normalizeImportance(event && event.importance, 'ambient');
  if (importance !== 'critical' && importance !== 'legendary') return;
  const location = event && event.location && typeof event.location === 'object'
    ? event.location
    : {};
  const scope = String(location.scope || '').trim().toLowerCase();
  const hasActors = Array.isArray(event && event.actors) && event.actors.length > 0;
  const hasCoordinates = Number.isFinite(Number(location.x)) && Number.isFinite(Number(location.y));
  const hasNamedPlace = Boolean(String(location.placeId || location.label || '').trim());
  const covered = scope === 'world'
    || (hasActors && (hasCoordinates || hasNamedPlace));
  if (covered) incrementStoryStat(story, `${importance}ContextCovered`);
}

function isProcessableEvent(event) {
  return Boolean(
    event
    && event.schemaVersion === 1
    && normalizeNullableToken(event.id, 96)
    && normalizeNullableToken(event.type, 96)
    && EVENT_IMPORTANCE.includes(event.importance),
  );
}

function isEventAfterCursor(event, cursor) {
  const position = [Number(event.cycle), Number(event.tick), Number(event.sequence)];
  const previous = [Number(cursor.lastCycle), Number(cursor.lastTick), Number(cursor.lastSequence)];
  for (let index = 0; index < position.length; index += 1) {
    if (position[index] > previous[index]) return true;
    if (position[index] < previous[index]) return false;
  }
  return false;
}

function updateStoryCursor(cursor, event) {
  cursor.lastEventId = event.id;
  cursor.lastCycle = normalizeTick(event.cycle, 0);
  cursor.lastTick = normalizeTick(event.tick, 0);
  cursor.lastSequence = normalizeTick(event.sequence, 0);
}

function normalizeFrequencyRegistry(value, limit) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const byTypeSource = source.byType && typeof source.byType === 'object' && !Array.isArray(source.byType)
    ? source.byType
    : {};
  const rawOrder = Array.isArray(source.order) ? source.order : Object.keys(byTypeSource);
  const order = [];
  const byType = {};
  for (const rawType of rawOrder) {
    if (order.length >= limit) break;
    const type = normalizeNullableToken(rawType, 96);
    if (!type || !isSafeObjectKey(type) || order.includes(type)) continue;
    if (!Object.prototype.hasOwnProperty.call(byTypeSource, type)) continue;
    order.push(type);
    byType[type] = clampInteger(byTypeSource[type], 0, 0, Number.MAX_SAFE_INTEGER);
  }
  return { order, byType };
}

function getFrequencyCount(registry, rawType, limit) {
  const type = normalizeNullableToken(rawType, 96);
  if (!type || !isSafeObjectKey(type) || !registry) return null;
  if (Object.prototype.hasOwnProperty.call(registry.byType, type)) return registry.byType[type];
  return registry.order.length < limit ? 0 : null;
}

function incrementFrequency(registry, rawType, limit) {
  const type = normalizeNullableToken(rawType, 96);
  if (!type || !isSafeObjectKey(type) || limit <= 0) return;
  if (Object.prototype.hasOwnProperty.call(registry.byType, type)) {
    registry.byType[type] = Math.min(Number.MAX_SAFE_INTEGER, registry.byType[type] + 1);
    return;
  }
  if (registry.order.length >= limit) return;
  registry.order.push(type);
  registry.byType[type] = 1;
}

function normalizeFocusRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const eventId = normalizeNullableToken(value.eventId, 96);
  if (!eventId) return null;
  return {
    eventId,
    type: normalizeNullableToken(value.type, 96),
    importance: normalizeImportance(value.importance, 'ambient'),
    sagaId: normalizeNullableToken(value.sagaId, 96),
    selectedTick: normalizeTick(value.selectedTick, 0),
    expiresTick: normalizeTick(value.expiresTick, 0),
    actorIds: normalizeTokenList(value.actorIds, MAX_FOCUS_ACTORS, 96),
    placeId: normalizeNullableToken(value.placeId, 96),
    score: normalizeFiniteNumber(value.score, 0, -HARD_MAX_SCORE, HARD_MAX_SCORE),
    reasonCode: normalizeNullableToken(value.reasonCode, 64),
  };
}

function normalizeHistoryRecord(value) {
  const focus = normalizeFocusRecord(value);
  if (!focus) return null;
  return {
    ...focus,
    reasonCode: normalizeNullableToken(value.reasonCode, 64),
    outcome: normalizeNullableToken(value.outcome, 64),
  };
}

function normalizeReasonTraceRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const eventId = normalizeNullableToken(value.eventId, 96);
  const reasonCode = normalizeNullableToken(value.reasonCode, 64);
  if (!eventId || !reasonCode) return null;
  return {
    tick: normalizeTick(value.tick, 0),
    eventId,
    decision: normalizeNullableToken(value.decision, 32) || 'ignored',
    reasonCode,
    score: normalizeFiniteNumber(value.score, 0, -HARD_MAX_SCORE, HARD_MAX_SCORE),
    severityScore: normalizeFiniteNumber(value.severityScore, 0, 0, HARD_MAX_SCORE),
    rarityScore: normalizeFiniteNumber(value.rarityScore, 0, 0, HARD_MAX_SCORE),
    namedActorScore: normalizeFiniteNumber(value.namedActorScore, 0, 0, HARD_MAX_SCORE),
    consequenceScore: normalizeFiniteNumber(value.consequenceScore, 0, 0, HARD_MAX_SCORE),
    currentSagaScore: normalizeFiniteNumber(value.currentSagaScore, 0, 0, HARD_MAX_SCORE),
    visibilityScore: normalizeFiniteNumber(
      value.visibilityScore,
      0,
      -HARD_MAX_SCORE,
      HARD_MAX_SCORE,
    ),
    sagaId: normalizeNullableToken(value.sagaId, 96),
  };
}

function createStoryStats() {
  return {
    considered: 0,
    selected: 0,
    suppressed: 0,
    preempted: 0,
    sagasOpened: 0,
    sagasResolved: 0,
    sagasFailed: 0,
    sagasArchived: 0,
    sagasEvicted: 0,
    chaptersOpened: 0,
    chaptersCompacted: 0,
    criticalConsidered: 0,
    criticalSelected: 0,
    criticalSuppressed: 0,
    criticalContextCovered: 0,
    legendaryConsidered: 0,
    legendarySelected: 0,
    legendarySuppressed: 0,
    legendaryContextCovered: 0,
  };
}

function normalizeStoryStats(value) {
  const source = value && typeof value === 'object' ? value : {};
  const stats = createStoryStats();
  for (const key of Object.keys(stats)) {
    stats[key] = clampInteger(source[key], 0, 0, Number.MAX_SAFE_INTEGER);
  }
  return stats;
}

function normalizeRecordList(value, limit, normalizer) {
  if (!Array.isArray(value) || limit <= 0) return [];
  const records = [];
  const start = Math.max(0, value.length - limit);
  for (let index = start; index < value.length; index += 1) {
    const entry = value[index];
    const normalized = normalizer(entry);
    if (normalized) records.push(normalized);
  }
  return records;
}

function normalizeTokenList(value, limit, byteLimit) {
  if (!Array.isArray(value) || limit <= 0) return [];
  const result = [];
  for (const raw of value) {
    if (result.length >= limit) break;
    const token = normalizeNullableToken(raw, byteLimit);
    if (token && !result.includes(token)) result.push(token);
  }
  return result;
}

function normalizeNullableToken(value, byteLimit) {
  const token = String(value === null || value === undefined ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '_');
  if (!token) return null;
  return Buffer.from(token, 'utf8').subarray(0, byteLimit).toString('utf8').replace(/\ufffd+$/g, '') || null;
}

function isSafeObjectKey(value) {
  return value !== '__proto__' && value !== 'prototype' && value !== 'constructor';
}

function normalizeImportance(value, fallback) {
  const importance = String(value || '').trim().toLowerCase();
  return EVENT_IMPORTANCE.includes(importance) ? importance : fallback;
}

function normalizeConfigTokenList(value, fallback, limit) {
  const source = Array.isArray(value) && value.length > 0 ? value : fallback;
  return normalizeTokenList(source, limit, 32);
}

function normalizeTick(value, fallback) {
  return clampInteger(value, fallback, 0, Number.MAX_SAFE_INTEGER);
}

function normalizeSignedTick(value, fallback) {
  return clampInteger(value, fallback, -1, Number.MAX_SAFE_INTEGER);
}

function normalizeFiniteNumber(value, fallback, min, max) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : fallback;
}

function clampInteger(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

module.exports = {
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
};
