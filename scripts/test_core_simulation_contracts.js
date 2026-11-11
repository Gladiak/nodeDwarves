#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const baseConfig = require('../config.json');
const { createInitialState } = require('../src/state');
const { stepState } = require('../src/simulation');
const { runEndgameReset } = require('../src/simulation/endgame');
const { pushEvent } = require('../src/simulation/events');
const resources = require('../src/simulation/resources');
const population = require('../src/simulation/population');
const structures = require('../src/simulation/structures');
const { computeShortages, assignJobs } = require('../src/simulation/jobs');
const { moveWithDetour } = require('../src/simulation/movement');
const { updateRaidStart, updateRaidTick } = require('../src/simulation/raids');
const { buildObservation } = require('../src/ai/observation');
const { createRefinementTracker, trackRefinementTick, getRefinementReport,
  summarizeRefinementReports } = require('../src/telemetry/refinement');

const runtime = { gridWidth: 60, gridHeight: 30, playableArea: 1800,
  terminalWidth: 60, terminalHeight: 30, frameEnabled: false };
const clone = (value) => JSON.parse(JSON.stringify(value));
let cases = 0;

// Restore the process RNG even when a fixture throws.
function seeded(seed, callback) {
  const original = Math.random;
  let value = seed >>> 0;
  Math.random = () => {
    value = (Math.imul(1664525, value) + 1013904223) >>> 0;
    return value / 4294967296;
  };
  try { return callback(); } finally { Math.random = original; }
}

// Give every case independent config, state, and random-stream ownership.
function test(name, callback) {
  const before = JSON.stringify(baseConfig);
  const originalRandom = Math.random;
  seeded(101, () => {
    const config = clone(baseConfig);
    config.display.terrain.seed = 101;
    callback(config, createInitialState(config, runtime));
  });
  assert.equal(JSON.stringify(baseConfig), before, `${name}: config isolation`);
  assert.equal(Math.random, originalRandom, `${name}: RNG isolation`);
  cases += 1;
}

// Check the finite numeric leaves without JSON hiding NaN or Infinity.
function finite(value, path = 'state') {
  if (typeof value === 'number') assert(Number.isFinite(value), path);
  else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) finite(entry, `${path}.${key}`);
  }
}

// Keep serialization coverage on durable core fields, excluding ephemeral caches.
function core(state) {
  return { tick: state.tick, stockpile: state.stockpile, dwarves: state.dwarves,
    structures: state.structures, jobs: state.jobs, raid: state.raid,
    birthsCount: state.birthsCount, deathsCount: state.deathsCount };
}

// Use a flat, bounded map to make route expectations independent of generation.
function flatMap(state) {
  state.terrain = { width: 60, height: 30,
    walkable: Array.from({ length: 30 }, () => Array(60).fill(true)),
    spawnable: Array.from({ length: 30 }, () => Array(60).fill(true)),
    types: Array.from({ length: 30 }, () => Array(60).fill('plain')) };
  state.nodes = [];
  state.structures = [];
  delete state.pathing;
}

test('guarded costs, outputs, decay and target ratios', (config, state) => {
  state.stockpile = { food: 2.5, water: 2, iron: 0 };
  assert(!resources.hasInputs(state.stockpile, { food: 3 }));
  assert(resources.hasInputs(state.stockpile, { food: 2.5 }));
  resources.consumeInputs(state.stockpile, { food: 2.5 });
  assert.equal(state.stockpile.food, 0);
  resources.applyOutputs(state.stockpile, { iron: 0.125 }, state, config);
  assert(state.stockpile.iron > 0);
  config.resources.decayPerTick = { water: 1, iron: 0.5 };
  resources.applyStockpileDecay(state, config);
  assert.equal(state.stockpile.water, 0);
  finite(state.stockpile);
  assert(Object.values(state.stockpile).every((value) => value >= 0));
  config.resources.targets = { food: 100 };
  config.resources.targetsPerCapita = {};
  state.stockpile.food = 25;
  assert.equal(resources.getStockpileRatio(state, config, 'food'), 0.25);
  config.resources.targets.food = 200;
  assert.equal(resources.getStockpileRatio(state, config, 'food'), 0.125);
});

test('shortages favor critical gathering before optional spending', (config, state) => {
  config.resources.targets = { food: 100, water: 100 };
  config.resources.targetsPerCapita = {};
  config.jobs.gatherTriggerRatio = 1;
  state.stockpile.food = 0;
  state.stockpile.water = 90;
  const shortages = computeShortages(state, config.resources.targets, {}, config);
  assert.equal(shortages[0].resource, 'food');
  assert(shortages[0].score > shortages[1].score);
  for (const dwarf of state.dwarves) { dwarf.job = null; dwarf.role = 'gatherer'; }
  state.jobs = [];
  const before = { ...state.stockpile };
  assignJobs(state, config, runtime, null);
  assert(state.jobs.some((job) => job.type === 'gather'));
  assert(!state.jobs.some((job) => job.type === 'build' || job.type === 'upgrade'));
  assert.deepEqual(state.stockpile, before);
});

test('structure ratio, costs, capacity and queued reservations', (config, state) => {
  flatMap(state);
  config.population.housing.buildMinResources = { food: 0.5 };
  config.resources.targetsPerCapita = {};
  config.resources.targets.food = 100;
  for (const key of Object.keys(state.stockpile)) state.stockpile[key] = 10000;
  state.stockpile.food = 49;
  const before = clone(state.stockpile);
  assert.equal(structures.createHouseBuildJob(state, config, runtime, new Set()), null);
  assert.deepEqual(state.stockpile, before);
  state.stockpile.food = 50;
  const job = structures.createHouseBuildJob(state, config, runtime, new Set());
  assert(job && job.workRemaining > 0);
  for (const [key, cost] of Object.entries(config.structures.house.buildCost)) {
    assert.equal(state.stockpile[key], (key === 'food' ? 50 : before[key]) - cost);
  }
  state.structures = Array.from({ length: 100 }, (_, index) =>
    ({ id: `house_${index}`, type: 'house', level: 1, capacity: 10, x: index % 60, y: 10 }));
  assert.equal(structures.createHouseBuildJob(state, config, runtime, new Set()), null);
  config.structures.brewery.maxCount = 1;
  state.jobs = [{ type: 'build', structureType: 'brewery' }];
  assert.equal(structures.createBreweryBuildJob(state, config, runtime, new Set()), null);
  state.jobs = [];
  state.stockpile = {};
  assert.equal(structures.createBreweryBuildJob(state, config, runtime, new Set()), null);
});

test('consumption bounds, preference, fractional reserves and empty stocks', (config, state) => {
  const dwarf = state.dwarves[0];
  dwarf.needs.hunger = 1;
  dwarf.needs.thirst = 1;
  config.consumption.maxUnitsPerTick = 1;
  state.stockpile = { meal: 1, food: 1, beer: 1, water: 1 };
  population.consumeResources(dwarf, state, config);
  assert.equal(state.stockpile.meal, 0);
  assert.equal(state.stockpile.food, 1);
  assert(dwarf.needs.hunger < 1 && dwarf.needs.thirst < 1);
  assert(Object.values(state.stockpile).every((value) => value >= 0));
  state.stockpile = { meal: 0.2, beer: 0.2, food: 0, water: 0 };
  dwarf.needs.hunger = 1;
  dwarf.needs.thirst = 1;
  dwarf.state.moraleBoostBeer = 0;
  config.consumption.beerMoraleDecayPerTick = 0;
  config.consumption.beerMinReserveRatio = 0;
  population.consumeResources(dwarf, state, config);
  assert(Object.values(state.stockpile).every((value) => value >= 0));
  assert.equal(dwarf.needs.hunger, 1 - 0.2 * config.consumption.mealRelief);
  assert.equal(dwarf.needs.thirst, 1 - 0.2 * config.consumption.beerRelief);
  assert.equal(dwarf.state.moraleBoostBeer,
    Math.min(config.consumption.beerMoraleMax, 0.2 * config.consumption.beerMoraleGain));
  const needs = clone(dwarf.needs);
  population.consumeResources(dwarf, state, config);
  assert.deepEqual(dwarf.needs, needs);
  finite(dwarf.state);
  assert(dwarf.state.moraleBoostBeer <= config.consumption.beerMoraleMax);
  state.stockpile = { meal: 0.2, food: 2, beer: 0.2, water: 2 };
  dwarf.needs.hunger = 1; dwarf.needs.thirst = 1;
  population.consumeResources(dwarf, state, config);
  assert(Math.abs(state.stockpile.food - 1.2) < 1e-12);
  assert(Math.abs(state.stockpile.water - 1.2) < 1e-12);
  assert(Math.abs(dwarf.needs.hunger - (1 - 0.2 * config.consumption.mealRelief
    - 0.8 * config.consumption.rawFoodRelief)) < 1e-12);
});

test('seeded reproduction, stock/housing/cooldown gates and lifecycle', (config, state) => {
  state.dwarves = state.dwarves.slice(0, 2);
  const [a, b] = state.dwarves;
  for (const dwarf of [a, b]) {
    dwarf.ageTicks = config.population.aging.adultAge + 1;
    dwarf.lifeStage = 'adult'; dwarf.fertilityCooldown = 0;
    dwarf.pregnancy = null; dwarf.homeId = 'test_home';
  }
  a.partnerId = b.id; b.partnerId = a.id;
  const reproduction = config.population.reproduction;
  reproduction.baseChance = 1;
  reproduction.minStockpileRatio = { food: 0.5 };
  state.stockpile.food = 0;
  population.handleReproduction(state, config);
  assert(!a.pregnancy && !b.pregnancy);
  for (const key of Object.keys(state.stockpile)) state.stockpile[key] = 10000;
  a.fertilityCooldown = 2;
  population.handleReproduction(state, config);
  assert(!a.pregnancy && !b.pregnancy);
  a.fertilityCooldown = 0; b.homeId = 'different_home';
  population.handleReproduction(state, config);
  assert(!a.pregnancy && !b.pregnancy);
  b.homeId = a.homeId;
  const twin = clone(state);
  const conceive = (value) => seeded(101, () => {
    for (let i = 0; i < 100 && !value.dwarves.some((dwarf) => dwarf.pregnancy); i += 1) {
      population.handleReproduction(value, config);
    }
    const carrier = value.dwarves.find((dwarf) => dwarf.pregnancy);
    assert(carrier);
    value.tick = carrier.pregnancy.dueTick;
    population.handleReproduction(value, config);
    return core(value);
  });
  assert.deepEqual(conceive(state), conceive(twin));
  assert.equal(state.dwarves.length, 3);
  assert.equal(state.dwarves[2].lifeStage, 'child');
  assert.equal(state.dwarves[2].ageTicks, 0);
  const child = state.dwarves[2];
  child.ageTicks = config.population.aging.adultAge - 1;
  population.advanceAge(child, config);
  assert.equal(child.lifeStage, 'adult');
  child.ageTicks = config.population.aging.maxAge;
  population.handleDeaths(state, config);
  assert(!state.dwarves.includes(child));
  assert.equal(state.deathsByCause.oldAge, 1);
});

test('field walkability, bounded steps, sealed fallback and disabled affinity parity', (config, state) => {
  flatMap(state);
  config.population.pathing.mode = 'field';
  config.population.pathing.field.road_affinity = { enabled: false, profile: 'scenic' };
  const dwarf = { id: 'probe', x: 2, y: 2 };
  const run = (inputConfig) => seeded(101, () => {
    const localState = clone(state); const entity = { ...dwarf }; const route = [];
    for (let tick = 0; tick < 12; tick += 1) {
      localState.tick = tick;
      const before = { ...entity };
      moveWithDetour(entity, 15, 2, runtime, localState, inputConfig);
      assert(entity.x >= 0 && entity.y >= 0 && entity.x < 60 && entity.y < 30);
      assert(localState.terrain.walkable[entity.y][entity.x]);
      assert(Math.abs(entity.x - before.x) + Math.abs(entity.y - before.y) <= 1);
      route.push([entity.x, entity.y]);
    }
    return route;
  });
  const noAffinity = clone(config);
  delete noAffinity.population.pathing.field.road_affinity;
  delete noAffinity.population.pathing.field.roadAffinity;
  assert.deepEqual(run(config), run(noAffinity));
  state.terrain.walkable = Array.from({ length: 30 }, () => Array(60).fill(false));
  state.terrain.walkable[2][2] = true;
  assert.equal(moveWithDetour(dwarf, 15, 2, runtime, state, config), false);
  assert.deepEqual([dwarf.x, dwarf.y], [2, 2]);
});

test('competitive roads, bridges/fords, short trips and leaving roads', (config, state) => {
  flatMap(state);
  const field = config.population.pathing.field;
  Object.assign(field, { temperature: 0, terrainWeight: 0, crowdWeight: 0, inertiaWeight: 0 });
  delete field.roadAffinity;
  field.road_affinity = { enabled: true, profile: 'pragmatic' };
  state.roads = { width: 60, height: 30, version: 0,
    types: Array.from({ length: 30 }, () => Array(60).fill(null)) };
  const actor = state.dwarves[0];
  for (const type of ['road', 'bridge', 'ford']) {
    state.roads.version += 1;
    for (let x = 2; x <= 14; x += 1) state.roads.types[3][x] = type;
    Object.assign(actor, { x: 2, y: 2, moveCooldown: 0, pathStallTicks: 0, pathDetourTicks: 0 });
    assert(moveWithDetour(actor, 14, 10, runtime, state, config));
    assert.deepEqual([actor.x, actor.y], [2, 3], `${type} wins an equal-distance route choice`);
  }
  Object.assign(actor, { x: 2, y: 2, moveCooldown: 0 });
  field.road_affinity.onRoadBonus = 2;
  moveWithDetour(actor, 4, 2, runtime, state, config);
  assert.deepEqual([actor.x, actor.y], [3, 2], 'short trip bypasses even a large detour bonus');
  Object.assign(actor, { x: 2, y: 3, moveCooldown: 0 });
  moveWithDetour(actor, 2, 0, runtime, state, config);
  assert.deepEqual([actor.x, actor.y], [2, 2], 'a dwarf leaves the road to reach its target');
});

test('empty-road cache reuse, dynamic invalidation and completed-trip telemetry', (config, state) => {
  flatMap(state);
  config.population.pathing.field.temperature = 0;
  config.population.pathing.field.crowdWeight = 0;
  config.population.pathing.field.inertiaWeight = 0;
  delete config.population.pathing.field.roadAffinity;
  config.population.pathing.field.road_affinity = { enabled: true, profile: 'pragmatic' };
  state.roads = { width: 60, height: 30, version: 1,
    types: Array.from({ length: 30 }, () => Array(60).fill(null)) };
  const actor = state.dwarves[0];
  Object.assign(actor, { x: 2, y: 2, moveCooldown: 0, job: null });
  const tracker = createRefinementTracker(state, config);
  for (let tick = 1; tick <= 12; tick += 1) {
    state.tick = tick;
    moveWithDetour(actor, 50, 20, runtime, state, config);
    trackRefinementTick(state, tracker);
  }
  assert.equal(getRefinementReport(state, tracker, 1).movement.roadRebuilds, 1);
  state.roads.types[actor.y][actor.x + 1] = 'road';
  state.roads.version += 1;
  state.tick += 1;
  moveWithDetour(actor, 50, 20, runtime, state, config);
  assert.equal(getRefinementReport(state, tracker, 1).movement.roadRebuilds, 2);
  const goal = { x: actor.x + 2, y: actor.y };
  for (let tick = 0; tick < 4 && actor.x !== goal.x; tick += 1) {
    state.tick += 1;
    moveWithDetour(actor, goal.x, goal.y, runtime, state, config);
    trackRefinementTick(state, tracker);
  }
  const report = getRefinementReport(state, tracker, 1).movement;
  assert.equal(report.measurementVersion, 2);
  assert.equal(report.referenceLongTripDistance, 10);
  assert(report.completedTrips >= 1 && report.abortedTrips >= 1);
  assert(report.byJobFamily.idle.completedTrips >= 1);
  assert(Number.isFinite(report.byJobFamily.idle.meanTravelTicks));
});

test('road, terrain, crowd and inertia costs compose within walkable bounds', (config, state) => {
  flatMap(state);
  Object.assign(config.population.pathing.field, { temperature: 1, terrainWeight: 1,
    crowdWeight: 1, inertiaWeight: 1 });
  delete config.population.pathing.field.roadAffinity;
  config.population.pathing.field.road_affinity = { enabled: true, profile: 'scenic',
    minTargetDistance: 0, onRoadBonus: 2, offRoadPenalty: 2, maxDistancePenalty: 4 };
  state.roads = { width: 60, height: 30, version: 1,
    types: Array.from({ length: 30 }, () => Array(60).fill(null)) };
  state.roads.types[2][3] = 'road';
  state.terrain.walkable[2][3] = false;
  const actor = state.dwarves[0];
  Object.assign(actor, { x: 2, y: 2, moveCooldown: 0, lastMoveDx: 1, lastMoveDy: 0 });
  for (let tick = 0; tick < 24; tick += 1) {
    state.tick = tick;
    const before = { x: actor.x, y: actor.y };
    moveWithDetour(actor, 20, 10, runtime, state, config);
    assert(actor.x >= 0 && actor.y >= 0 && actor.x < 60 && actor.y < 30);
    assert(state.terrain.walkable[actor.y][actor.x]);
    assert(Math.abs(actor.x - before.x) + Math.abs(actor.y - before.y) <= 1);
  }
});

test('surface raid start/tick/end, tower range/hit/kill limits and defense cap', (config, state) => {
  flatMap(state);
  config.raids.enabled = true;
  config.raids.minTick = 0; config.raids.minPopulation = 0;
  config.raids.chance = { min: 1, max: 1 };
  config.raids.durationTicks = 3;
  state.season = { name: config.raids.seasonNames[0], tickInSeason: 1, globalIndex: 100 };
  state.raid = { active: false, lastSeasonIndex: null, beasts: [] };
  updateRaidStart(state, config, runtime);
  assert(state.raid.active);
  assert.equal(state.raid.ticksRemaining, 3);
  const count = state.raidStats.count;
  updateRaidStart(state, config, runtime);
  assert.equal(state.raidStats.count, count);
  config.structures.watchtower.raid = { range: 2, hitChance: 1, maxKillsPerTick: 1,
    defensePerTower: 1, defenseMax: 0.3 };
  // Beasts with a cooldown stay still, so this tests towers through the public tick API.
  const beast = (x, y) => ({ x, y, moveCooldown: 10 });
  state.structures = [{ id: 't1', type: 'watchtower', x: 10, y: 10 },
    { id: 't2', type: 'watchtower', x: 10, y: 10 }];
  state.dwarves.forEach((dwarf) => { dwarf.clanId = null; });
  state.raid.beasts = [beast(12, 10), beast(11, 10), beast(14, 10)];
  updateRaidTick(state, config, runtime);
  assert.equal(state.raid.beasts.length, 2);
  assert(state.raid.beasts.some((entry) => entry.x === 14));
  config.structures.watchtower.raid.hitChance = 0;
  updateRaidTick(state, config, runtime);
  assert.equal(state.raid.beasts.length, 2);
  config.raids.defenseMax = 0;
  config.raids.resourceLoss = { min: 1, max: 1, weights: { food: 1 } };
  state.stockpile = { food: 100 };
  const exposedPopulation = state.dwarves.length;
  updateRaidTick(state, config, runtime);
  assert.equal(state.stockpile.food, 30);
  assert.equal(state.raid.active, false);
  assert.equal(state.raid.ticksRemaining, 0);
  assert.deepEqual(state.raid.beasts, []);
  assert(state.raidStats.lastRaidDeaths <= exposedPopulation);
  finite(core(state));
  assert.deepEqual(clone(core(state)), core(state));
});

test('short-run core safety and saved-state contract', (config, state) => {
  for (let tick = 0; tick < 80; tick += 1) {
    stepState(state, config, runtime, null, { suppressEndgameReset: true });
    finite(core(state));
    assert(Object.values(state.stockpile).every((value) => value >= 0));
  }
  assert.deepEqual(clone(core(state)), core(state));
  assert.deepEqual(buildObservation(clone(state), config), buildObservation(state, config));
});

test('read-only metrics preserve core endpoints, observation and RNG', (config) => {
  const run = (observe) => seeded(202, () => {
    const state = createInitialState(config, runtime);
    const tracker = observe ? createRefinementTracker(state, config) : null;
    for (let tick = 0; tick < 32; tick += 1) {
      stepState(state, config, runtime, null, { suppressEndgameReset: true });
      if (tracker) trackRefinementTick(state, tracker);
    }
    return { endpoint: core(state), observation: buildObservation(state, config), random: Math.random(),
      report: tracker ? getRefinementReport(state, tracker, 10) : null };
  });
  const observed = run(true); const plain = run(false);
  assert.deepEqual(observed.endpoint, plain.endpoint);
  assert.deepEqual(observed.observation, plain.observation);
  assert.equal(observed.random, plain.random);
  const report = observed.report;
  assert.equal(report.samples, 32);
  assert.equal(report.economy.invalidStockpiles, 0);
  assert.equal(report.social.longArcEnabled, baseConfig.population.socialDrama.longArc.enabled === true);
  assert.equal(report.narrative.merged, 0);
  assert.equal(report.narrative.mergeStatus, 'no_registry_merge_operation');
  assert.equal(report.runtime.renderMeanMs, null);
  assert(report.movement.attempts > 0);
  assert(report.movement.fieldRebuilds > 0);
  assert.equal(report.movement.roadRebuilds, 0);
  assert.equal(report.legacy.activeModifiers, 0);
  finite(report);
  assert.deepEqual(summarizeRefinementReports([report, report]), report);
});

test('metric counters survive in-place cycle resets without entering save state', (config, state) => {
  config.endgame.transition.randomizeSeed = false;
  const tracker = createRefinementTracker(state, config);
  state.birthsCount = 5; state.deathsCount = 2;
  pushEvent(state, config, { type: 'world.cycle_witnessed', category: 'world',
    importance: 'critical', message: 'A witnessed cycle fact.', actors: [],
    location: { scope: 'world' }, causes: [], consequences: [], tags: [], source: 'core_contract' });
  const retiredEvents = Object.values(state.story.sagas.byId).reduce((sum, saga) => sum + saga.eventCount, 0);
  state.social.stats.incidents = 3;
  state.social.stats.incidentsByType.reconciliation = 3;
  runEndgameReset(state, config, runtime);
  state.birthsCount = 7; state.deathsCount = 1;
  state.social.stats.incidents = 4;
  state.social.stats.incidentsByType.reconciliation = 4;
  const report = getRefinementReport(state, tracker, 1);
  assert.equal(report.economy.births, 12);
  assert.equal(report.economy.deaths, 3);
  assert.equal(report.social.incidents, 7);
  assert.equal(report.social.incidentsByType.reconciliation, 7);
  assert.equal(report.narrative.retiredEvents, retiredEvents);
  assert.equal(report.narrative.retired + state.story.sagas.order.length, report.narrative.opened);
  assert(!JSON.stringify(state).includes('completedBirths'));
});

process.stdout.write(`core-simulation contracts: PASS (${cases} cases; isolated seed=101)\n`);
