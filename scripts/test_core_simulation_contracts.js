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
const { computeOutcomeSignals, computeOutcomeReward } = require('../src/ai/outcome_reward');
const { applySteward } = require('../src/simulation/steward');
const { composeModifiers, describeModifiers } = require('../src/simulation/modifier_ledger');
const { CORE_KEYS, FROZEN_KEYS } = require('./audit_config');
const { createWorldProfile, getWorldYieldFactor } = require('../src/simulation/world_profile');
const levers = require('../src/simulation/levers');
const { buildObservationPlan } = require('../src/ai/observation_layout');
const policyModule = require('../src/ai/policy');
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

test('proportional allocation follows weights and an explicit zero ignores a resource', (config, state) => {
  config.resources.targets = { food: 100, water: 100, wood: 100, stone: 100 };
  config.resources.targetsPerCapita = {};
  config.jobs.gatherTriggerRatio = 1;
  config.ai.priorityBoosts = {};
  const assign = (weights) => {
    state.stockpile = { ...state.stockpile, food: 0, water: 0, wood: 0, stone: 0 };
    for (const dwarf of state.dwarves) { dwarf.job = null; dwarf.role = 'gatherer'; }
    state.jobs = [];
    assignJobs(state, config, runtime, { weights });
    const counts = {};
    for (const job of state.jobs) counts[job.resource] = (counts[job.resource] || 0) + 1;
    return counts;
  };
  const weighted = assign({ food: 2, water: 2, wood: 0.4, stone: 0.4 });
  const essentials = (weighted.food || 0) + (weighted.water || 0);
  const materials = (weighted.wood || 0) + (weighted.stone || 0);
  assert(essentials >= 3 * Math.max(1, materials), `proportional split ${JSON.stringify(weighted)}`);
  const zeroed = assign({ food: 1, water: 1, wood: 0, stone: 0 });
  assert.equal((zeroed.wood || 0) + (zeroed.stone || 0), 0, 'weight 0 ignores the resource');
  assert(computeShortages(state, config.resources.targets, { wood: 0 }, config)
    .find((entry) => entry.resource === 'wood').score === 0);
});

test('outcome reward counts avoidable deaths, progress and extinction once', (config, state) => {
  config.ai.reward = { population: 1, populationScale: 10, deaths: 2, distress: 1,
    distressThreshold: 0.6, reserves: 0.5, reservePerCapita: 1, depth: 3, landmarkStage: 1,
    prestige: 0.5, extinction: 7 };
  state.dwarves = state.dwarves.slice(0, 4);
  for (const dwarf of state.dwarves) dwarf.needs = { hunger: 0.1, thirst: 0.1 };
  state.dwarves[0].needs.thirst = 0.7;
  state.stockpile.food = 2;
  state.stockpile.water = 8;
  state.deathsByCause = { oldAge: 5, raid: 1 };
  state.underrealm = { ...(state.underrealm || {}), maxUnlockedDepth: 1 };
  state.landmarks = { ...(state.landmarks || {}), stats: { stagesBuilt: 2 } };
  state.prestige = { ...(state.prestige || {}), total: 4 };
  const before = computeOutcomeSignals(state, config);
  assert.equal(before.distressShare, 0.25);
  assert.equal(before.reserve, 0.5);
  state.deathsByCause = { oldAge: 9, raid: 2, starvation: 1 };
  state.underrealm.maxUnlockedDepth = 2;
  state.landmarks.stats.stagesBuilt = 3;
  state.prestige.total = 6;
  const after = computeOutcomeSignals(state, config);
  const step = computeOutcomeReward(before, after, config);
  assert.equal(step.terms.population, 0.4);
  assert.equal(step.terms.deaths, -4, 'old age is not an avoidable death');
  assert.equal(step.terms.distress, -0.25);
  assert.equal(step.terms.reserves, 0.25);
  assert.equal(step.terms.progress, 3 + 1 + 1);
  assert.equal(step.terms.extinction, 0);
  state.dwarves = [];
  const empty = computeOutcomeSignals(state, config);
  assert.equal(computeOutcomeReward(after, empty, config).terms.extinction, -7);
  assert.equal(computeOutcomeReward(empty, empty, config).terms.extinction, 0, 'extinction counts once');
  const reset = { ...after, avoidableDeaths: 1, depth: 0 };
  assert.equal(computeOutcomeReward(after, reset, config).terms.deaths, -2, 'cycle reset counts from zero');
  finite(step);
});

test('steward fills only missing groups, judges posture from reserves and stays RNG-free', (config, state) => {
  config.ai.steward = { enabled: false };
  const policyAction = { weights: { food: 1 }, ruins: { warningDispatchIntent: 2 } };
  assert.equal(applySteward(state, config, policyAction), policyAction, 'disabled steward is a no-op');
  config.ai.steward = { enabled: true, decisionTicks: 1, safeReservePerCapita: 3, safeMinPopulation: 0,
    restrainedGroups: ['warriors'], cautiousGroups: ['ruins', 'trade'] };
  const population = state.dwarves.length;
  state.stockpile.food = population * 5;
  state.stockpile.water = population * 5;
  delete state.steward;
  const original = Math.random;
  Math.random = () => { throw new Error('steward must not use RNG'); };
  try {
    const open = applySteward(state, config, null);
    assert.equal(state.steward.posture, 'open');
    assert.deepEqual(Object.keys(open).sort(), ['warriors']);
    assert(Object.values(open.warriors).every((value) => value === 0));
    state.stockpile.food = population;
    const eventsBefore = (state.events || []).length;
    state.tick += 1;
    const cautious = applySteward(state, config, policyAction);
    assert.equal(state.steward.posture, 'cautious');
    assert.equal(state.steward.reason, 'low_reserves');
    assert.equal(cautious.ruins.warningDispatchIntent, 2, 'policy groups are never overridden');
    assert.equal(cautious.trade.contestIntent, 0);
    assert.equal(cautious.weights.food, 1);
    assert((state.events || []).length > eventsBefore, 'posture change emits a council decree');
  } finally {
    Math.random = original;
  }
});

test('modifier ledger keeps product order, bounds the multiplier and explains factors', (config, state) => {
  const factors = [['season', 0.45], ['festival', 1.1], ['temple', 1.07]];
  const inline = 2 * 0.45 * 1.1 * 1.07;
  config.simulation = { modifierBounds: {} };
  assert.equal(composeModifiers(state, config, 'gatherYield', 'food', 2, factors), inline, 'unbounded is bit-identical');
  const described = describeModifiers(state, 'gatherYield', 'food');
  assert.equal(described.movers[0][0], 'season', 'strongest factor first');
  config.simulation.modifierBounds.gatherYield = { min: 0.6, max: 1.6 };
  assert.equal(composeModifiers(state, config, 'gatherYield', 'food', 2, factors), 2 * 0.6, 'multiplier clamped to min');
  assert.equal(describeModifiers(state, 'gatherYield', 'food').multiplier, 0.6);
  assert.equal(composeModifiers(null, config, 'gatherYield', null, 2, [['boom', 5]]), 2 * 1.6, 'multiplier clamped to max');
});

test('training and eval overrides set only profile keys, never the economy', (config) => {
  const PROFILE = ['events', 'ai', 'merchant', 'endgame'];
  const training = config.ai.training;
  for (const name of ['configOverrides', 'evalOverrides']) {
    const extra = Object.keys(training[name] || {}).filter((key) => !PROFILE.includes(key));
    assert.deepEqual(extra, [], `${name} restates non-profile sections: ${extra.join(', ')}`);
    for (const key of [...CORE_KEYS, ...FROZEN_KEYS]) {
      let node = training[name];
      for (const part of key.split('.')) node = node && typeof node === 'object' ? node[part] : undefined;
      assert.equal(node, undefined, `${name} restates core key ${key}`);
    }
  }
});

test('fractional yields scale below one unit and full beer reserves pause brewing', (config, state) => {
  config.jobs.gatherYield = { ...config.jobs.gatherYield, food: 0.6 };
  const fractional = resources.getGatherYield(config, 'food', null, state);
  assert(fractional > 0 && fractional < 1, `fractional yield ${fractional}`);
  config.structures.brewery.pauseWhenFoodRatioBelow = 0;
  config.structures.brewery.stopWhenBeerReserveRatioAbove = 1.5;
  const reserve = config.consumption.beerReserveBase
    + config.consumption.beerReservePerCapita * state.dwarves.length;
  state.stockpile.beer = reserve * 1.6;
  assert.equal(resources.shouldPauseBrewing(state, config), true);
  state.stockpile.beer = reserve * 1.2;
  assert.equal(resources.shouldPauseBrewing(state, config), false);
  config.structures.brewery.stopWhenBeerReserveRatioAbove = 0;
  state.stockpile.beer = reserve * 10;
  assert.equal(resources.shouldPauseBrewing(state, config), false);
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

test('lever heads map u to low/default/high, reach their read sites and open venture groups', (config, state) => {
  config.ai.levers.enabled = true;
  const ids = levers.getLeverActionIds(config);
  assert.deepEqual(ids, ['lever_growth', 'lever_reserves', 'lever_builders', 'lever_deep', 'lever_ventures']);
  assert.equal(levers.mapLeverValue(0.5, 0.1, 0.25, 0.6), 0.25, 'midpoint keeps the council default');
  assert.equal(levers.mapLeverValue(0, 0.1, 0.25, 0.6), 0.1);
  assert.equal(levers.mapLeverValue(1, 0.1, 0.25, 0.6), 0.6);
  levers.applyLevers(state, config, { levers: { growth: 1, reserves: 0, builders: 0.5, deep: 1, ventures: 0.9 } });
  assert.equal(levers.getLeverSetting(state, 'population.reproduction.growthCap.maxAnnualGrowth', -1), 0.6);
  assert.equal(levers.getLeverSetting(state, 'jobs.gatherTriggerRatio.water', -1), 1.0);
  assert.equal(levers.getLeverSetting(state, 'population.roles.builderRatio', -1), config.population.roles.builderRatio);
  assert.deepEqual(levers.getLeverOpenGroups(state), ['ruins', 'underrealm', 'externalCamps']);
  const council = applySteward(state, config, {});
  for (const group of ['ruins', 'underrealm', 'externalCamps']) assert(!(group in council), `${group} left open`);
  assert('warriors' in council, 'other groups stay restrained');
  const before = state.growthCap ? state.growthCap.budget : null;
  state.growthCap = { budget: 0 };
  population.handleReproduction(state, config);
  const yearTicks = config.seasons.durationTicks * config.seasons.order.length;
  const expected = Math.max(state.dwarves.length * 0.6, config.population.reproduction.growthCap.minBirthsPerYear) / yearTicks;
  assert(Math.abs(state.growthCap.budget - expected) < 1e-9 || state.growthCap.budget < 1, 'growth lever sets the accrual rate');
  void before;
  const resources = ['food', 'water', 'wood', 'stone', ...ids];
  const plan = buildObservationPlan(resources, ['shortage', 'nodeScarcity', 'population'], 'factored');
  assert.deepEqual(plan.resources, ['food', 'water', 'wood', 'stone'], 'lever heads carry no per-resource rows');
  const envelope = policyModule.normalizeActionEnvelope({ levers: { growth: 0.2 } });
  assert.deepEqual(envelope.levers, { growth: 0.2 }, 'game inference keeps lever values');
  const none = clone(state);
  delete none.levers;
  levers.applyLevers(none, config, {});
  assert.equal(none.levers, undefined, 'no lever values, no change');
});

test('world profile is drawn per map seed, bounded, RNG-free and absent when disabled', (config, state) => {
  const off = clone(config);
  off.variety.enabled = false;
  assert.equal(createWorldProfile(off, 7), null, 'disabled variety draws nothing');
  assert(state.worldProfile && state.worldProfile.factors, 'new games carry their profile');
  const varied = clone(config);
  varied.variety.enabled = true;
  const before = Math.random;
  let draws = 0;
  Math.random = () => { draws += 1; return before(); };
  const a = createWorldProfile(varied, 12345);
  const b = createWorldProfile(varied, 12345);
  const c = createWorldProfile(varied, 54321);
  Math.random = before;
  assert.equal(draws, 0, 'profile draws never touch gameplay RNG');
  assert.deepEqual(a, b, 'same map seed, same profile');
  assert.notDeepEqual(a.factors, c.factors, 'different seeds differ');
  for (const [key, value] of Object.entries(a.factors)) {
    const [low, high] = varied.variety.ranges[key];
    assert(value >= low && value <= high, `${key} within range`);
  }
  const probe = { worldProfile: a, season: { name: 'winter' } };
  const expected = a.factors.waterYield * a.factors.winterYield;
  assert(Math.abs(getWorldYieldFactor(probe, 'water') - expected) < 1e-12, 'winter stacks on the resource factor');
  assert.equal(getWorldYieldFactor({ worldProfile: null }, 'food'), 1);
});

test('growth cap paces conceptions with a population-scaled birth budget', (config, state) => {
  state.dwarves = state.dwarves.slice(0, 2);
  const [a, b] = state.dwarves;
  for (const dwarf of [a, b]) {
    dwarf.ageTicks = config.population.aging.adultAge + 1;
    dwarf.lifeStage = 'adult'; dwarf.fertilityCooldown = 0;
    dwarf.pregnancy = null; dwarf.homeId = 'test_home';
  }
  a.partnerId = b.id; b.partnerId = a.id;
  for (const key of Object.keys(state.stockpile)) state.stockpile[key] = 10000;
  const reproduction = config.population.reproduction;
  reproduction.baseChance = 1;
  reproduction.growthCap = { enabled: true, maxAnnualGrowth: 0.25, minBirthsPerYear: 4, burst: 2 };
  state.growthCap = { budget: 0 };
  population.handleReproduction(state, config);
  assert(!a.pregnancy && !b.pregnancy, 'empty budget blocks conception');
  assert.equal(state.reproductionStats.blockedGrowthCap, 1);
  const yearTicks = config.seasons.durationTicks * config.seasons.order.length;
  assert(Math.abs(state.growthCap.budget - 4 / yearTicks) < 1e-12, 'floor accrues when the colony is small');
  state.growthCap.budget = 1;
  population.handleReproduction(state, config);
  assert(a.pregnancy || b.pregnancy, 'a full unit of budget allows one conception');
  assert(state.growthCap.budget < 1, 'conception spends one unit');
  state.growthCap.budget = 5;
  reproduction.growthCap.enabled = false;
  population.handleReproduction(state, config);
  assert.equal(state.growthCap.budget, 5, 'disabled cap leaves the budget untouched');
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
  state.worldProfile = null;
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
