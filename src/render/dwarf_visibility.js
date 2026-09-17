'use strict';

const CRITICAL_EVENT_WINDOW_TICKS = 240;
const INCIDENT_EVENT_WINDOW_TICKS = 240;
const SAGA_EVENT_WINDOW_TICKS = 1200;
const EVENT_SCAN_LIMIT = 160;

const VISIBILITY_TIERS = Object.freeze({
  urgentStory: 0,
  endangered: 1,
  champion: 2,
  saga: 3,
  incident: 4,
  retained: 5,
  adult: 6,
  other: 7,
});

// Select a bounded stable surface population while reserving slots for story-relevant actors.
function selectPriorityVisibleDwarves(state, config, candidates = null) {
  const dwarves = Array.isArray(candidates)
    ? candidates.filter(Boolean)
    : Array.isArray(state && state.dwarves) ? state.dwarves : [];
  const maxVisible = getMaxVisibleDwarves(config);
  if (maxVisible < 0) {
    commitVisibleIds(state, []);
    return [];
  }
  if (!maxVisible || dwarves.length <= maxVisible) {
    commitVisibleIds(state, dwarves.map((dwarf) => dwarf.id));
    return dwarves;
  }
  const previousIds = state && state.renderState && Array.isArray(state.renderState.visibleDwarfIds)
    ? state.renderState.visibleDwarfIds
    : [];
  const sorted = sortDwarvesByRenderPriority(state, dwarves, previousIds);
  const visible = sorted.slice(0, maxVisible);
  commitVisibleIds(state, visible.map((dwarf) => dwarf.id));
  return visible;
}

// Sort any layer-local candidate set with the same deterministic story tiers.
function sortDwarvesByRenderPriority(state, candidates, previousIds = []) {
  const dwarves = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  const eligibleIds = new Set(dwarves.map((dwarf) => String(dwarf.id || '')).filter(Boolean));
  const priority = collectPriorityDwarfIds(state, eligibleIds);
  const previousRank = new Map(
    (Array.isArray(previousIds) ? previousIds : [])
      .map((id, index) => [String(id || ''), index]),
  );
  const sourceRank = new Map(dwarves.map((dwarf, index) => [String(dwarf.id || ''), index]));

  return dwarves.slice().sort((left, right) => {
    const leftId = String(left && left.id || '');
    const rightId = String(right && right.id || '');
    const leftTier = resolveDwarfVisibilityTier(left, leftId, priority, previousRank);
    const rightTier = resolveDwarfVisibilityTier(right, rightId, priority, previousRank);
    if (leftTier !== rightTier) {
      return leftTier - rightTier;
    }
    const leftEventRank = priority.eventRank.has(leftId) ? priority.eventRank.get(leftId) : Infinity;
    const rightEventRank = priority.eventRank.has(rightId) ? priority.eventRank.get(rightId) : Infinity;
    if (leftEventRank !== rightEventRank) {
      return leftEventRank - rightEventRank;
    }
    const leftPreviousRank = previousRank.has(leftId) ? previousRank.get(leftId) : Infinity;
    const rightPreviousRank = previousRank.has(rightId) ? previousRank.get(rightId) : Infinity;
    if (leftPreviousRank !== rightPreviousRank) {
      return leftPreviousRank - rightPreviousRank;
    }
    const leftSourceRank = sourceRank.get(leftId);
    const rightSourceRank = sourceRank.get(rightId);
    if (leftSourceRank !== rightSourceRank) {
      return leftSourceRank - rightSourceRank;
    }
    return leftId.localeCompare(rightId);
  });
}

// Resolve priority sets from bounded retained facts and authoritative live state.
function collectPriorityDwarfIds(state, eligibleIds) {
  const now = Math.max(0, Math.floor(Number(state && state.tick || 0)));
  const urgent = new Set();
  const saga = new Set();
  const incident = new Set();
  const champion = collectChampionIds(state, eligibleIds);
  const eventRank = new Map();
  const events = Array.isArray(state && state.eventLog)
    ? state.eventLog.slice(0, EVENT_SCAN_LIMIT)
    : [];
  let actorRank = 0;
  for (const event of events) {
    const eventTick = Math.max(0, Math.floor(Number(event && event.tick || 0)));
    const age = Math.max(0, now - eventTick);
    const importance = String(event && event.importance || '').toLowerCase();
    const hasSaga = Boolean(String(event && event.sagaId || '').trim());
    const ids = getEventDwarfIds(event, eligibleIds);
    for (const id of ids) {
      if (!eventRank.has(id)) {
        eventRank.set(id, actorRank);
        actorRank += 1;
      }
      if (age <= CRITICAL_EVENT_WINDOW_TICKS && (importance === 'critical' || importance === 'legendary')) {
        urgent.add(id);
      }
      if (age <= SAGA_EVENT_WINDOW_TICKS && hasSaga) {
        saga.add(id);
      }
      if (age <= INCIDENT_EVENT_WINDOW_TICKS) {
        incident.add(id);
      }
    }
  }
  return { urgent, champion, saga, incident, eventRank };
}

// Classify one candidate into the documented stable priority tiers.
function resolveDwarfVisibilityTier(dwarf, id, priority, previousRank) {
  if (priority.urgent.has(id)) return VISIBILITY_TIERS.urgentStory;
  if (isEndangeredDwarf(dwarf)) return VISIBILITY_TIERS.endangered;
  if (priority.champion.has(id)) return VISIBILITY_TIERS.champion;
  if (priority.saga.has(id)) return VISIBILITY_TIERS.saga;
  if (priority.incident.has(id)) return VISIBILITY_TIERS.incident;
  if (previousRank.has(id)) return VISIBILITY_TIERS.retained;
  if (String(dwarf && dwarf.lifeStage || '') === 'adult') return VISIBILITY_TIERS.adult;
  return VISIBILITY_TIERS.other;
}

// Treat immediate health/need collapse as a visibility concern without changing gameplay state.
function isEndangeredDwarf(dwarf) {
  const state = dwarf && dwarf.state && typeof dwarf.state === 'object' ? dwarf.state : {};
  const needs = dwarf && dwarf.needs && typeof dwarf.needs === 'object' ? dwarf.needs : {};
  return Number(state.health ?? 1) <= 0.35
    || Number(state.morale ?? 1) <= 0.15
    || Number(dwarf && dwarf.starvationTicks || 0) > 0
    || Number(needs.hunger || 0) >= 0.85
    || Number(needs.thirst || 0) >= 0.85;
}

// Collect active surface/deep and Warrior League champions when they are layer-eligible.
function collectChampionIds(state, eligibleIds) {
  const ids = new Set();
  const leagueId = state && state.warriors && state.warriors.league
    ? state.warriors.league.championId
    : null;
  const deepId = state && state.underrealm && state.underrealm.combat
    && state.underrealm.combat.dwarfChampion
    ? state.underrealm.combat.dwarfChampion.activeDwarfId
    : null;
  for (const rawId of [leagueId, deepId]) {
    const id = String(rawId || '');
    if (id && eligibleIds.has(id)) {
      ids.add(id);
    }
  }
  return ids;
}

// Read live dwarf actors only, retaining producer order within the newest-first event stream.
function getEventDwarfIds(event, eligibleIds) {
  const ids = [];
  for (const actor of Array.isArray(event && event.actors) ? event.actors : []) {
    const id = String(actor && actor.kind === 'dwarf' && actor.id || '');
    if (id && eligibleIds.has(id) && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

// Resolve the existing render cap contract (`0` unlimited, negative hidden).
function getMaxVisibleDwarves(config) {
  const display = config && config.display && config.display.dwarves
    ? config.display.dwarves
    : {};
  const raw = Number(display.maxVisible ?? 0);
  if (Number.isFinite(raw) && raw < 0) return -1;
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.floor(raw));
}

function commitVisibleIds(state, ids) {
  if (!state || typeof state !== 'object') return;
  if (!state.renderState || typeof state.renderState !== 'object') {
    state.renderState = {};
  }
  state.renderState.visibleDwarfIds = ids.map((id) => String(id || '')).filter(Boolean);
}

module.exports = {
  EVENT_SCAN_LIMIT,
  VISIBILITY_TIERS,
  getMaxVisibleDwarves,
  isEndangeredDwarf,
  selectPriorityVisibleDwarves,
  sortDwarvesByRenderPriority,
};
