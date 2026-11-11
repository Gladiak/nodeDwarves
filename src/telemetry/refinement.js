'use strict';

const { resolveLegacyEffects } = require('../simulation/legacy_effects');

// Observers live outside saves and PPO state; absent observers are cheap no-ops.
const movementObservers = new WeakMap();
const sagaObservers = new WeakMap();
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const ratio = (a, b) => b > 0 ? a / b : 0;
const ROAD_TYPES = new Set(['road', 'bridge', 'ford']);
const MOOD_FIELDS = ['morale', 'stress', 'fatigue'];
const MEMORY_FIELDS = ['supportMemory', 'burdenMemory'];

// Subscribe explicitly from headless tooling, never from simulation decisions.
function createRefinementTracker(state, config) {
  const tracker = {
    ticks: 0, resources: {}, socialSums: {}, socialPeaks: {}, socialSaturated: {},
    completedBirths: 0, completedDeaths: 0, completedIncidents: 0, completedIncidentTypes: {},
    adultTicks: 0, idleAdultTicks: 0, invalidStockpiles: 0,
    invalidMoodMemory: 0, invalidSocialSamples: 0,
    movement: { attempts: 0, steps: 0, roadSteps: 0, longSteps: 0, longRoadSteps: 0,
      stays: 0, failedSteps: 0, cooldowns: 0, targetDistanceSum: 0,
      fieldRebuilds: 0, roadRebuilds: 0, completedTrips: 0, travelTicks: 0, abortedTrips: 0,
      referenceLongSteps: 0, referenceLongRoadSteps: 0, roadEvaluations: 0, roadSubstitutions: 0,
      roadProgressProtections: 0, roadTripsStarted: 0, firstRoadTripTick: null },
    pathingMs: 0, trips: new Map(), travelHistogram: Array(257).fill(0),
    travelFamilies: new Map(),
    gatherUnits: Object.fromEntries(Object.keys(config.resources?.stockpile || {}).map((key) => [key, 0])),
    gatherJobs: Object.fromEntries(Object.keys(config.resources?.stockpile || {}).map((key) => [key, 0])),
    constructionJobs: 0,
    narrative: { opened: 0, assignedEvents: 0, resolved: 0, failed: 0, archived: 0,
      evicted: 0, retired: 0, singleEventRetired: 0, retiredEvents: 0,
      skippedEvents: 0, priorityAssigned: 0, priorityUnowned: 0 },
    sagaDiagnostics: { openingsByType: new Map(), openingsByFamily: new Map(),
      openingsByReason: new Map(), matchesByPath: new Map(), skippedByType: new Map(),
      exitsByReasonAndStatus: new Map(),
      exits: {}, samples: new Map() },
    config, liveDwarves: new WeakSet(state.dwarves || []),
  };
  movementObservers.set(state, tracker);
  if (state.story) sagaObservers.set(state.story, tracker);
  return tracker;
}

// Carry observer ownership before reset events commit, without carrying gameplay state.
function carryRefinementTracker(previousState, nextState) {
  const tracker = getMovementObserver(previousState);
  if (!tracker) return;
  tracker.completedBirths += number(previousState.birthsCount);
  tracker.completedDeaths += number(previousState.deathsCount);
  tracker.completedIncidents += number(previousState.social?.stats?.incidents);
  for (const saga of Object.values(previousState.story?.sagas?.byId || {})) {
    tracker.narrative.retired += 1;
    tracker.narrative.retiredEvents += number(saga.eventCount);
    if (saga.eventCount === 1) tracker.narrative.singleEventRetired += 1;
  }
  for (const [type, count] of Object.entries(previousState.social?.stats?.incidentsByType || {})) {
    tracker.completedIncidentTypes[type] = number(tracker.completedIncidentTypes[type]) + number(count);
  }
  movementObservers.set(nextState, tracker);
  if (nextState.story) sagaObservers.set(nextState.story, tracker);
}

// Return an observer only when benchmark collection has been requested.
function getMovementObserver(state) { return state ? movementObservers.get(state) : undefined; }

// Count actual cache construction, including uncached builds and empty road overlays.
function recordPathRebuild(state, kind) {
  const tracker = getMovementObserver(state);
  if (tracker) tracker.movement[kind === 'road' ? 'roadRebuilds' : 'fieldRebuilds'] += 1;
}

// Observe only surface dwarves, preserving every decision and RNG call in the mover.
function recordMovement(tracker, state, entity, targetX, targetY, beforeX, beforeY, cooldown, pathKey) {
  if (!tracker.liveDwarves.has(entity)
    || (entity.underrealmDuty && entity.underrealmDuty.active !== false)) return;
  const movement = tracker.movement;
  const distance = Math.abs(targetX - beforeX) + Math.abs(targetY - beforeY);
  if (distance === 0) return;
  movement.attempts += 1;
  movement.targetDistanceSum += distance;
  const rawFamily = entity.job?.type === 'gather' ? `gather_${entity.job.resource}`
    : entity.job?.type || (String(pathKey || '').startsWith('home:') ? 'home' : 'idle');
  const family = tracker.travelFamilies.has(rawFamily) || tracker.travelFamilies.size < 31 ? rawFamily : 'other';
  if (!tracker.travelFamilies.has(family)) tracker.travelFamilies.set(family,
    { attempts: 0, steps: 0, completedTrips: 0, abortedTrips: 0, travelTicks: 0, histogram: Array(257).fill(0) });
  const familyStats = tracker.travelFamilies.get(family);
  familyStats.attempts += 1;
  const targetKey = `${entity.job?.id || family}:${targetX},${targetY}`;
  let trip = tracker.trips.get(entity.id);
  if (!trip || trip.key !== targetKey || trip.owner !== entity) {
    if (trip) abortTrip(tracker, trip);
    trip = { key: targetKey, ticks: 0, startDistance: distance, owner: entity,
      jobId: entity.job?.id || null, family };
    tracker.trips.set(entity.id, trip);
  }
  trip.ticks += 1;
  const moved = entity.x !== beforeX || entity.y !== beforeY;
  if (moved) {
    movement.steps += 1;
    familyStats.steps += 1;
    const road = ROAD_TYPES.has(state.roads?.types?.[entity.y]?.[entity.x]);
    if (road) movement.roadSteps += 1;
    if (trip.startDistance >= 10) {
      movement.referenceLongSteps += 1;
      if (road) movement.referenceLongRoadSteps += 1;
    }
    const field = tracker.config.population?.pathing?.field || {};
    const affinity = field.road_affinity || field.roadAffinity || {};
    const threshold = number(affinity.minTargetDistance ?? affinity.min_target_distance
      ?? (affinity.profile === 'scenic' ? 6 : 10));
    if (distance >= threshold) {
      movement.longSteps += 1;
      if (road) movement.longRoadSteps += 1;
    }
  } else {
    movement.stays += 1;
    if (cooldown > 0) movement.cooldowns += 1;
    else movement.failedSteps += 1;
  }
  if (entity.x === targetX && entity.y === targetY) {
    movement.completedTrips += 1;
    movement.travelTicks += trip.ticks;
    familyStats.completedTrips += 1;
    familyStats.travelTicks += trip.ticks;
    familyStats.histogram[Math.min(256, trip.ticks)] += 1;
    tracker.travelHistogram[Math.min(256, trip.ticks)] += 1;
    tracker.trips.delete(entity.id);
  }
}

// Canceled jobs, replaced targets, deaths, and reset actors end an unfinished trip.
function abortTrip(tracker, trip) {
  tracker.movement.abortedTrips += 1;
  tracker.travelFamilies.get(trip.family).abortedTrips += 1;
}

// Measure committed gathering without inferring production from net stockpile deltas.
function recordGatherCompletion(state, resource, amount) {
  const tracker = getMovementObserver(state);
  if (!tracker) return;
  if (!Object.hasOwn(tracker.config.resources?.stockpile || {}, resource)) return;
  tracker.gatherUnits[resource] = number(tracker.gatherUnits[resource]) + number(amount);
  tracker.gatherJobs[resource] = number(tracker.gatherJobs[resource]) + 1;
}

// Count normal structures and successful temple/landmark stage completions.
function recordConstructionCompletion(state) {
  const tracker = getMovementObserver(state);
  if (tracker) tracker.constructionJobs += 1;
}

// Return an exact bounded percentile, with explicit overflow instead of a fabricated tail.
function getTravelPercentile(histogram, count) {
  if (!count) return null;
  let cumulative = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index];
    if (cumulative >= count * 0.95) return index === 256 ? null : index;
  }
  return null;
}

// Collect lifecycle counters at the authoritative saga boundary, before eviction.
function recordSagaMetric(story, kind, saga, context = {}) {
  const tracker = story ? sagaObservers.get(story) : null;
  if (!tracker) return;
  if (kind in tracker.narrative) tracker.narrative[kind] += 1;
  if (kind === 'evicted') {
    tracker.narrative.retired += 1;
    tracker.narrative.retiredEvents += saga.eventCount;
    if (saga.eventCount === 1) tracker.narrative.singleEventRetired += 1;
  }
  const diagnostic = tracker.sagaDiagnostics;
  const event = context.event;
  const priority = event && ['critical', 'legendary'].includes(event.importance);
  if (kind === 'skippedEvents') {
    countDiagnostic(diagnostic.skippedByType, event?.type || 'unknown');
    if (priority) tracker.narrative.priorityUnowned += 1;
  }
  if (kind === 'opened') {
    countDiagnostic(diagnostic.openingsByType, event?.type || 'unknown');
    countDiagnostic(diagnostic.openingsByFamily, String(event?.type || 'unknown').split('.')[0]);
    countDiagnostic(diagnostic.openingsByReason, context.reason || 'unknown');
    if (diagnostic.samples.size < 8) {
      diagnostic.samples.set(saga.id, { id: saga.id, openingType: event?.type || null,
        openingReason: context.reason || null, timeline: [], finalStatus: saga.status });
    }
  }
  if (kind === 'assignedEvents') {
    if (priority) tracker.narrative.priorityAssigned += 1;
    if (saga.eventCount > 1) countDiagnostic(diagnostic.matchesByPath, context.path || 'unknown');
    const sample = diagnostic.samples.get(saga.id);
    if (sample && event) {
      sample.timeline.push({ eventId: event.id, tick: event.tick, type: event.type,
        fact: String(event.message || '').slice(0, 160) });
      if (sample.timeline.length > 8) sample.timeline.splice(1, 1);
      sample.finalStatus = saga.status;
    }
  }
  if (['resolved', 'failed', 'archived', 'evicted'].includes(kind)) {
    countDiagnostic(diagnostic.exitsByReasonAndStatus,
      `${context.reason || kind}:${context.statusBefore || saga.status}`);
    const summary = diagnostic.exits[kind] || { count: 0, events: 0, lifetime: 0 };
    summary.count += 1; summary.events += saga.eventCount;
    summary.lifetime += Math.max(0, number(context.tick ?? saga.lastEventTick) - saga.openedTick);
    diagnostic.exits[kind] = summary;
    const sample = diagnostic.samples.get(saga.id);
    if (sample) {
      sample.finalStatus = saga.status; sample.exitReason = context.reason || kind;
      if ((kind === 'resolved' || kind === 'failed') && context.event) {
        sample.outcome = { eventId: context.event.id, tick: context.event.tick,
          type: context.event.type, fact: String(context.event.message || '').slice(0, 160) };
      }
    }
  }
}

// Bound diagnostic cardinality independently of event/type churn.
function countDiagnostic(map, rawKey) {
  let key = String(rawKey).slice(0, 128);
  if (!map.has(key) && map.size >= 255) key = 'other';
  map.set(key, (map.get(key) || 0) + 1);
}

// Serialize maps in a stable order without retaining additional saga evidence.
function getSagaDiagnosticReport(diagnostic) {
  const output = {};
  for (const field of ['openingsByType', 'openingsByFamily', 'openingsByReason',
    'matchesByPath', 'skippedByType', 'exitsByReasonAndStatus']) {
    output[field] = Object.fromEntries([...diagnostic[field]].sort(([a], [b]) => a.localeCompare(b)));
  }
  output.exits = Object.fromEntries(Object.entries(diagnostic.exits).map(([kind, value]) =>
    [kind, { ...value, meanEvents: ratio(value.events, value.count),
      meanLifetimeTicks: ratio(value.lifetime, value.count) }]));
  output.samples = [...diagnostic.samples.values()];
  return output;
}

// Sample after each tick without repairing or mutating any simulation record.
function trackRefinementTick(state, tracker) {
  tracker.ticks += 1;
  if (state.story) sagaObservers.set(state.story, tracker);
  for (const key of ['food', 'water', 'beer']) {
    const value = state.stockpile?.[key];
    const numeric = number(value);
    if (!Number.isFinite(value) || value < 0) tracker.invalidStockpiles += 1;
    const resource = tracker.resources[key] || { floor: numeric, sum: 0 };
    resource.floor = Math.min(resource.floor, numeric);
    resource.sum += numeric;
    tracker.resources[key] = resource;
  }
  for (const [key, value] of Object.entries(state.stockpile || {})) {
    if (!['food', 'water', 'beer'].includes(key) && (!Number.isFinite(value) || value < 0)) {
      tracker.invalidStockpiles += 1;
    }
  }
  const adultAge = number(tracker.config.population?.aging?.adultAge);
  tracker.liveDwarves = new WeakSet(state.dwarves || []);
  for (const dwarf of state.dwarves || []) {
    for (const field of MOOD_FIELDS) {
      const value = dwarf.state?.[field];
      if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) tracker.invalidMoodMemory += 1;
    }
    for (const field of MEMORY_FIELDS) {
      const value = dwarf.social?.arc?.[field];
      if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) tracker.invalidMoodMemory += 1;
    }
    if (number(dwarf.ageTicks) < adultAge) continue;
    tracker.adultTicks += 1;
    if (!dwarf.job && (!dwarf.underrealmDuty || dwarf.underrealmDuty.active === false)) tracker.idleAdultTicks += 1;
  }
  for (const [id, trip] of tracker.trips) {
    if (!tracker.liveDwarves.has(trip.owner) || (trip.owner.job?.id || null) !== trip.jobId) {
      abortTrip(tracker, trip);
      tracker.trips.delete(id);
    }
  }
  const social = state.social || {};
  const values = { cohesion: social.cohesion, conflictPressure: social.conflictPressure,
    mentorshipCoverage: social.mentorshipCoverage, grudgeLoad: social.grudgeLoad,
    support: social.longArc?.avgSupport, burden: social.longArc?.avgBurden,
    harmony: social.longArc?.harmony, strife: social.longArc?.strife };
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) tracker.invalidSocialSamples += 1;
    tracker.socialSums[key] = number(tracker.socialSums[key]) + number(value);
    tracker.socialPeaks[key] = Math.max(number(tracker.socialPeaks[key]), number(value));
    tracker.socialSaturated[key] = number(tracker.socialSaturated[key]) + (number(value) > 0.95 ? 1 : 0);
  }
}

// Produce explicit nulls for unavailable measurements, separate from measured zeros.
function getRefinementReport(state, tracker, elapsedMs) {
  const movement = tracker.movement;
  const narrative = tracker.narrative;
  const retained = Object.values(state.story?.sagas?.byId || {});
  const observedSagas = narrative.retired + retained.length;
  const travelP95 = getTravelPercentile(tracker.travelHistogram, movement.completedTrips);
  const effects = resolveLegacyEffects(state, tracker.config);
  return {
    schemaVersion: 1, samples: tracker.ticks,
    economy: { population: state.dwarves?.length || 0, births: tracker.completedBirths + number(state.birthsCount),
      deaths: tracker.completedDeaths + number(state.deathsCount), idleAdultRatio: ratio(tracker.idleAdultTicks, tracker.adultTicks),
      invalidStockpiles: tracker.invalidStockpiles,
      resources: Object.fromEntries(Object.entries(tracker.resources).map(([key, value]) =>
        [key, { floor: value.floor, average: ratio(value.sum, tracker.ticks) }])) },
    social: { enabled: tracker.config.population?.socialDrama?.enabled !== false,
      longArcEnabled: tracker.config.population?.socialDrama?.longArc?.enabled !== false,
      invalidMoodMemory: tracker.invalidMoodMemory, invalidAggregateSamples: tracker.invalidSocialSamples,
      average: Object.fromEntries(Object.entries(tracker.socialSums).map(([key, value]) =>
        [key, ratio(value, tracker.ticks)])), peak: { ...tracker.socialPeaks },
      saturatedTickShare: Object.fromEntries(Object.entries(tracker.socialSaturated).map(([key, value]) =>
        [key, ratio(value, tracker.ticks)])),
      incidents: tracker.completedIncidents + number(state.social?.stats?.incidents),
      incidentsByType: Object.fromEntries([...new Set([...Object.keys(tracker.completedIncidentTypes),
        ...Object.keys(state.social?.stats?.incidentsByType || {})])].map((type) =>
        [type, number(tracker.completedIncidentTypes[type]) + number(state.social?.stats?.incidentsByType?.[type])])) },
    narrative: { ...narrative, merged: 0, mergeStatus: 'no_registry_merge_operation',
      diagnostics: getSagaDiagnosticReport(tracker.sagaDiagnostics),
      priorityOwnership: narrative.priorityAssigned + narrative.priorityUnowned > 0
        ? ratio(narrative.priorityAssigned, narrative.priorityAssigned + narrative.priorityUnowned) : null,
      terminalRate: ratio(narrative.resolved + narrative.failed, narrative.opened),
      fragmentationRate: ratio(narrative.singleEventRetired
        + retained.filter((saga) => saga.eventCount === 1).length, observedSagas),
      eventsPerSaga: ratio(narrative.retiredEvents
        + retained.reduce((sum, saga) => sum + saga.eventCount, 0), observedSagas) },
    movement: { ...movement, measurementVersion: 2, meanTargetDistance: ratio(movement.targetDistanceSum, movement.attempts),
      meanTravelTicks: movement.completedTrips ? movement.travelTicks / movement.completedTrips : null,
      p95TravelTicks: travelP95, p95Overflow: travelP95 === null && movement.completedTrips > 0,
      travelOverflowSamples: tracker.travelHistogram[256],
      referenceLongTripDistance: 10,
      referenceLongRoadStepShare: ratio(movement.referenceLongRoadSteps, movement.referenceLongSteps),
      byJobFamily: Object.fromEntries([...tracker.travelFamilies].sort(([a], [b]) => a.localeCompare(b))
        .map(([family, stats]) => [family, { attempts: stats.attempts, steps: stats.steps,
          completedTrips: stats.completedTrips, abortedTrips: stats.abortedTrips,
          meanTravelTicks: stats.completedTrips ? stats.travelTicks / stats.completedTrips : null,
          p95TravelTicks: getTravelPercentile(stats.histogram, stats.completedTrips),
          travelOverflowSamples: stats.histogram[256] }])),
      gatherUnits: { ...tracker.gatherUnits }, gatherJobs: { ...tracker.gatherJobs },
      constructionJobs: tracker.constructionJobs,
      roadStepShare: ratio(movement.roadSteps, movement.steps),
      longRoadStepShare: ratio(movement.longRoadSteps, movement.longSteps),
      stayShare: ratio(movement.stays, movement.attempts), incompleteTrips: tracker.trips.size },
    legacy: { records: ['cycles', 'identities', 'places', 'memorials', 'institutions', 'echoes', 'nemeses']
      .reduce((sum, field) => sum + (state.worldLegacy?.[field]?.length || 0), 0),
      activeModifiers: effects.activeCount,
      activeMagnitude: effects.activeMagnitude,
      effectiveModifiers: { constructionSpeed: effects.constructionSpeed },
      contributions: effects.details,
      serializedBytes: Buffer.byteLength(JSON.stringify(state.worldLegacy || {})),
      evictions: number(state.worldLegacy?.stats?.evictedRecords) },
    runtime: { elapsedMs, ticksPerSecond: elapsedMs > 0 ? tracker.ticks * 1000 / elapsedMs : null,
      pathingMs: tracker.pathingMs, renderMeanMs: null, renderP95Ms: null,
      renderStatus: 'not_rendered_headless' },
  };
}

// Average numeric leaves; preserve explicit unavailable fields and flags.
function summarizeRefinementReports(reports) {
  if (!reports.length) return null;
  const combine = (values) => {
    if (values.every((value) => typeof value === 'number')) {
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    }
    if (values.every((value) => value && typeof value === 'object' && !Array.isArray(value))) {
      const keys = new Set(values.flatMap((value) => Object.keys(value)));
      return Object.fromEntries([...keys].map((key) => [key, combine(values.map((value) => value[key]))]));
    }
    return values.every((value) => value === values[0]) ? values[0] : null;
  };
  return combine(reports);
}

module.exports = { createRefinementTracker, carryRefinementTracker, getMovementObserver, recordPathRebuild,
  recordMovement, recordSagaMetric, recordGatherCompletion, recordConstructionCompletion,
  trackRefinementTick, getRefinementReport,
  summarizeRefinementReports };
