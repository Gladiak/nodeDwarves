'use strict';

const { getStoryDirectorConfig } = require('../simulation/story_director');

const STORY_COUNTER_FIELDS = [
  'considered',
  'selected',
  'suppressed',
  'preempted',
  'criticalConsidered',
  'criticalSelected',
  'criticalSuppressed',
  'criticalContextCovered',
  'legendaryConsidered',
  'legendarySelected',
  'legendarySuppressed',
  'legendaryContextCovered',
  'sagasOpened',
  'sagasResolved',
  'sagasFailed',
  'sagasArchived',
  'sagasEvicted',
  'chaptersOpened',
  'chaptersCompacted',
];

// Build the player-facing Story Director rows from bounded plain-JSON state.
function buildStoryDirectorSectionRows(state, config) {
  const snapshot = collectStoryDirectorTelemetry(state, config);
  if (!snapshot.enabled) return ['Director: disabled'];
  const rows = [];
  if (snapshot.focus) {
    rows.push(
      `Current focus: ${snapshot.focus.importance} ${snapshot.focus.type} | ${snapshot.focus.remainingTicks}t left`,
    );
    rows.push(
      `Focus source: ${snapshot.focus.eventId} | score ${formatNumber(snapshot.focus.score, 0)}`,
    );
    rows.push(`Focus reason: ${snapshot.focus.reasonCode}`);
  } else {
    rows.push('Current focus: none');
  }
  if (snapshot.saga) {
    rows.push(
      `Current saga: ${snapshot.saga.id} | ${snapshot.saga.status} | ${snapshot.saga.eventCount} facts / ${snapshot.saga.chapterCount} chapters`,
    );
    rows.push(`Saga beat: ${snapshot.saga.summary || '-'}`);
  } else {
    rows.push('Current saga: none');
  }
  rows.push(
    `Cooldowns: focus ${snapshot.cooldowns.focusRemainingTicks}t | escalation ${snapshot.cooldowns.escalationRemainingTicks}t`,
  );
  rows.push(
    `Interruptions: ${snapshot.interruptions.used}/${snapshot.interruptions.maximum} | reset in ${snapshot.interruptions.resetRemainingTicks}t`,
  );
  if (snapshot.latestDecision) {
    rows.push(
      `Latest decision: ${snapshot.latestDecision.decision}/${snapshot.latestDecision.reasonCode} | score ${formatNumber(snapshot.latestDecision.score, 0)}`,
    );
    rows.push(
      `Score parts: severity ${formatNumber(snapshot.latestDecision.severityScore, 0)}, rarity ${formatNumber(snapshot.latestDecision.rarityScore, 0)}, actors ${formatNumber(snapshot.latestDecision.namedActorScore, 0)}, effects ${formatNumber(snapshot.latestDecision.consequenceScore, 0)}, saga ${formatNumber(snapshot.latestDecision.currentSagaScore, 0)}, view ${formatNumber(snapshot.latestDecision.visibilityScore, 0)}`,
    );
  } else {
    rows.push('Latest decision: none');
  }
  rows.push(
    `Focus totals: selected ${snapshot.counters.selected}/${snapshot.counters.considered} (${formatPercent(snapshot.focusCoverage)}) | suppressed ${snapshot.counters.suppressed} | preempted ${snapshot.counters.preempted}`,
  );
  rows.push(
    `Critical focus: ${snapshot.counters.criticalSelected}/${snapshot.counters.criticalConsidered} (${formatPercent(snapshot.criticalCoverage)}) | Legendary: ${snapshot.counters.legendarySelected}/${snapshot.counters.legendaryConsidered} (${formatPercent(snapshot.legendaryCoverage)})`,
  );
  rows.push(
    `Priority context: critical ${snapshot.counters.criticalContextCovered}/${snapshot.counters.criticalConsidered} (${formatPercent(snapshot.criticalContextCoverage)}) | legendary ${snapshot.counters.legendaryContextCovered}/${snapshot.counters.legendaryConsidered} (${formatPercent(snapshot.legendaryContextCoverage)})`,
  );
  rows.push(
    `Saga outcomes: opened ${snapshot.counters.sagasOpened} | resolved ${snapshot.counters.sagasResolved} | failed ${snapshot.counters.sagasFailed} | archived ${snapshot.counters.sagasArchived}`,
  );
  rows.push(`Saga registry: ${formatStatusCounts(snapshot.sagaStatuses)}`);
  return rows;
}

// Collect a stable telemetry snapshot without repairing or mutating simulation state.
function collectStoryDirectorTelemetry(state, config) {
  const safeState = isObject(state) ? state : {};
  const story = isObject(safeState.story) ? safeState.story : {};
  const settings = getStoryDirectorConfig(config);
  const tick = toCount(safeState.tick);
  const focus = normalizeFocus(story.currentFocus, tick);
  const saga = resolveCurrentSaga(story.sagas, focus && focus.sagaId);
  const cooldowns = isObject(story.cooldowns) ? story.cooldowns : {};
  const budget = isObject(story.interruptionBudget) ? story.interruptionBudget : {};
  const counters = normalizeCounterMap(story.stats);
  const trace = Array.isArray(story.reasonTrace) ? story.reasonTrace : [];
  const latestDecision = normalizeDecision(trace.length > 0 ? trace[trace.length - 1] : null);
  return {
    enabled: story.enabled !== false && settings.enabled,
    focus,
    saga,
    latestDecision,
    counters,
    cooldowns: {
      focusRemainingTicks: remainingTicks(cooldowns.focusUntilTick, tick),
      escalationRemainingTicks: remainingTicks(cooldowns.escalationUntilTick, tick),
    },
    interruptions: {
      used: toCount(budget.used),
      maximum: settings.focus.interruptionBudget.maxInterruptions,
      resetRemainingTicks: remainingTicks(
        toCount(budget.windowStartedTick) + settings.focus.interruptionBudget.windowTicks,
        tick,
      ),
    },
    focusCoverage: ratio(counters.selected, counters.considered),
    criticalCoverage: ratio(counters.criticalSelected, counters.criticalConsidered),
    legendaryCoverage: ratio(counters.legendarySelected, counters.legendaryConsidered),
    criticalContextCoverage: ratio(
      counters.criticalContextCovered,
      counters.criticalConsidered,
    ),
    legendaryContextCoverage: ratio(
      counters.legendaryContextCovered,
      counters.legendaryConsidered,
    ),
    sagaStatuses: countSagaStatuses(story.sagas),
  };
}

// Create one external benchmark tracker that survives in-simulation cycle resets.
function createStoryDirectorCounterTracker() {
  return {
    cycle: null,
    totals: normalizeCounterMap(),
    previous: normalizeCounterMap(),
  };
}

// Accumulate monotonic Story Director counters once per benchmark tick.
function trackStoryDirectorCounters(state, tracker) {
  if (!isObject(tracker)) return;
  const story = isObject(state && state.story) ? state.story : {};
  const current = normalizeCounterMap(story.stats);
  const cycle = resolveCycle(state, story);
  if (tracker.cycle === null || tracker.cycle !== cycle) {
    tracker.cycle = cycle;
    tracker.previous = normalizeCounterMap();
  }
  if (!isObject(tracker.totals)) tracker.totals = normalizeCounterMap();
  if (!isObject(tracker.previous)) tracker.previous = normalizeCounterMap();
  for (const field of STORY_COUNTER_FIELDS) {
    const previous = toCount(tracker.previous[field]);
    const value = current[field];
    const delta = value >= previous ? value - previous : value;
    tracker.totals[field] = safeAdd(tracker.totals[field], delta);
    tracker.previous[field] = value;
  }
}

// Return one serializable per-run report with derived coverage and resolution rates.
function getStoryDirectorCounterReport(tracker) {
  const counters = normalizeCounterMap(tracker && tracker.totals);
  return buildCounterReport(counters);
}

// Sum per-seed Story Director reports and recompute ratios from their totals.
function summarizeStoryDirectorReports(reports) {
  const totals = normalizeCounterMap();
  for (const report of Array.isArray(reports) ? reports : []) {
    for (const field of STORY_COUNTER_FIELDS) {
      totals[field] = safeAdd(totals[field], report && report[field]);
    }
  }
  return buildCounterReport(totals);
}

function buildCounterReport(counters) {
  const priorityConsidered = safeAdd(
    counters.criticalConsidered,
    counters.legendaryConsidered,
  );
  const prioritySelected = safeAdd(counters.criticalSelected, counters.legendarySelected);
  const priorityContextCovered = safeAdd(
    counters.criticalContextCovered,
    counters.legendaryContextCovered,
  );
  const terminalSagas = safeAdd(counters.sagasResolved, counters.sagasFailed);
  return {
    ...counters,
    focusCoverage: ratio(counters.selected, counters.considered),
    criticalFocusCoverage: ratio(counters.criticalSelected, counters.criticalConsidered),
    legendaryFocusCoverage: ratio(counters.legendarySelected, counters.legendaryConsidered),
    priorityConsidered,
    prioritySelected,
    priorityFocusCoverage: ratio(prioritySelected, priorityConsidered),
    criticalContextCoverage: ratio(
      counters.criticalContextCovered,
      counters.criticalConsidered,
    ),
    legendaryContextCoverage: ratio(
      counters.legendaryContextCovered,
      counters.legendaryConsidered,
    ),
    priorityContextCovered,
    priorityContextCoverage: ratio(priorityContextCovered, priorityConsidered),
    sagaTerminal: terminalSagas,
    sagaResolutionRate: ratio(terminalSagas, counters.sagasOpened),
  };
}

function normalizeFocus(value, tick) {
  if (!isObject(value)) return null;
  return {
    eventId: cleanToken(value.eventId, 96) || '-',
    type: cleanToken(value.type, 96) || 'unknown',
    importance: cleanToken(value.importance, 16) || 'ambient',
    sagaId: cleanToken(value.sagaId, 96),
    score: toNumber(value.score),
    reasonCode: cleanToken(value.reasonCode, 64) || 'unknown',
    remainingTicks: remainingTicks(value.expiresTick, tick),
  };
}

function normalizeDecision(value) {
  if (!isObject(value)) return null;
  return {
    decision: cleanToken(value.decision, 32) || 'unknown',
    reasonCode: cleanToken(value.reasonCode, 64) || 'unknown',
    score: toNumber(value.score),
    severityScore: toNumber(value.severityScore),
    rarityScore: toNumber(value.rarityScore),
    namedActorScore: toNumber(value.namedActorScore),
    consequenceScore: toNumber(value.consequenceScore),
    currentSagaScore: toNumber(value.currentSagaScore),
    visibilityScore: toNumber(value.visibilityScore),
  };
}

function resolveCurrentSaga(registry, focusSagaId) {
  if (!isObject(registry) || !isObject(registry.byId)) return null;
  const explicit = focusSagaId && registry.byId[focusSagaId];
  if (isObject(explicit)) return normalizeSaga(explicit, focusSagaId);
  const candidates = [];
  for (const id of Array.isArray(registry.order) ? registry.order : []) {
    const saga = registry.byId[id];
    if (!isObject(saga) || !['active', 'open', 'dormant'].includes(saga.status)) continue;
    candidates.push(normalizeSaga(saga, id));
  }
  candidates.sort((left, right) => {
    const rankDelta = sagaStatusRank(left.status) - sagaStatusRank(right.status);
    if (rankDelta !== 0) return rankDelta;
    if (right.lastEventTick !== left.lastEventTick) return right.lastEventTick - left.lastEventTick;
    return left.id.localeCompare(right.id);
  });
  return candidates[0] || null;
}

function normalizeSaga(value, fallbackId) {
  return {
    id: cleanToken(value.id || fallbackId, 96) || 'unknown',
    status: cleanToken(value.status, 32) || 'open',
    eventCount: toCount(value.eventCount),
    chapterCount: Array.isArray(value.chapters) ? value.chapters.length : 0,
    lastEventTick: toCount(value.lastEventTick),
    summary: cleanText(value.summary, 240),
  };
}

function sagaStatusRank(status) {
  if (status === 'active') return 0;
  if (status === 'open') return 1;
  return 2;
}

function countSagaStatuses(registry) {
  const counts = {};
  if (!isObject(registry) || !isObject(registry.byId)) return counts;
  for (const id of Array.isArray(registry.order) ? registry.order : []) {
    const status = cleanToken(registry.byId[id] && registry.byId[id].status, 32) || 'open';
    counts[status] = toCount(counts[status]) + 1;
  }
  return counts;
}

function formatStatusCounts(counts) {
  const order = ['active', 'open', 'dormant', 'resolved', 'failed', 'archived'];
  const parts = order.filter((status) => toCount(counts[status]) > 0)
    .map((status) => `${status} ${toCount(counts[status])}`);
  return parts.length > 0 ? parts.join(' | ') : 'empty';
}

function normalizeCounterMap(value) {
  const source = isObject(value) ? value : {};
  const result = {};
  for (const field of STORY_COUNTER_FIELDS) result[field] = toCount(source[field]);
  return result;
}

function resolveCycle(state, story) {
  const cursorCycle = Number(story && story.cursor && story.cursor.lastCycle);
  if (Number.isFinite(cursorCycle) && cursorCycle >= 0) return Math.floor(cursorCycle);
  return toCount(state && state.cycleStats && state.cycleStats.count);
}

function remainingTicks(deadline, tick) {
  return Math.max(0, Math.floor(toNumber(deadline) - toNumber(tick)));
}

function ratio(numerator, denominator) {
  const total = toCount(denominator);
  return total > 0 ? Math.max(0, Math.min(1, toCount(numerator) / total)) : 0;
}

function safeAdd(left, right) {
  return Math.min(Number.MAX_SAFE_INTEGER, toCount(left) + toCount(right));
}

function toCount(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : 0;
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function cleanToken(value, limit) {
  const token = String(value === null || value === undefined ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '_');
  return token.slice(0, Math.max(0, limit)) || null;
}

function cleanText(value, limit) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(0, limit));
}

function formatNumber(value, decimals) {
  return toNumber(value).toFixed(Math.max(0, decimals));
}

function formatPercent(value) {
  return `${(Math.max(0, Math.min(1, toNumber(value))) * 100).toFixed(1)}%`;
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

module.exports = {
  STORY_COUNTER_FIELDS,
  buildStoryDirectorSectionRows,
  collectStoryDirectorTelemetry,
  createStoryDirectorCounterTracker,
  getStoryDirectorCounterReport,
  summarizeStoryDirectorReports,
  trackStoryDirectorCounters,
};
