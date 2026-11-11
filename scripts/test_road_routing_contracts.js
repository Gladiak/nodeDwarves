#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const baseConfig = require('../config.json');
const { createInitialState } = require('../src/state');
const { moveWithDetour } = require('../src/simulation/movement');
const { chooseCostGuardedRoadStep, hasProgressingRoadContinuation,
  chooseProtectedRoadTripStep, getRoadTargetConnections } = require('../src/simulation/road_routing');
const { buildObservation } = require('../src/ai/observation');
const { processDwarfAction } = require('../src/simulation/dwarf_actions');
const { createRefinementTracker, getRefinementReport } = require('../src/telemetry/refinement');
const { validateRoadReports } = require('./validate_road_routing');

const clone = (value) => JSON.parse(JSON.stringify(value));
const runtime = { gridWidth: 60, gridHeight: 30, playableArea: 1800 };
const originalRandom = Math.random;
const configSnapshot = JSON.stringify(baseConfig);
let cases = 0;

// Keep fixture RNG ownership explicit, including failures and replay.
function seeded(seed, callback) {
  const before = Math.random;
  let value = seed >>> 0;
  Math.random = () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 4294967296);
  try { return callback(); } finally { Math.random = before; }
}

// Build a surface fixture with actual engine state and one unambiguous road alternative.
function fixture() {
  const config = clone(baseConfig);
  const state = seeded(101, () => createInitialState(config, runtime));
  const field = config.population.pathing.field;
  delete field.road_affinity;
  Object.assign(field, { temperature: 0, terrainWeight: 0, crowdWeight: 0, inertiaWeight: 0 });
  field.roadAffinity = { enabled: true, profile: 'pragmatic', routing_mode: 'cost_guarded',
    minTargetDistance: 10 };
  state.terrain = { width: 60, height: 30,
    types: Array.from({ length: 30 }, () => Array(60).fill('plain')),
    walkable: Array.from({ length: 30 }, () => Array(60).fill(true)) };
  state.roads = { width: 60, height: 30, version: 1,
    types: Array.from({ length: 30 }, () => Array(60).fill(null)) };
  state.nodes = []; state.structures = []; delete state.pathing;
  const actor = state.dwarves[0];
  Object.assign(actor, { x: 2, y: 2, moveCooldown: 0 });
  delete actor.underrealmDuty;
  state.dwarves = [actor];
  return { state, config, actor };
}

// Exercise the component-wise travel guard without simulation or random sampling.
function validateDominance() {
  const ordinary = { x: 3, y: 2, distance: 19, delay: 0, crowd: 0, cost: 19, road: false };
  const road = { ...ordinary, x: 2, y: 3, road: true };
  const snapshot = JSON.stringify([ordinary, road]);
  Math.random = () => { throw new Error('Road tie resolution consumed gameplay RNG'); };
  try {
    assert.equal(chooseCostGuardedRoadStep([ordinary, road], ordinary, 20), road);
    assert.equal(chooseCostGuardedRoadStep([ordinary, road], ordinary, 20, null, 0.05), ordinary);
    const improved = { ...road, cost: 18.8 };
    assert.equal(chooseCostGuardedRoadStep([ordinary, improved], ordinary, 20, null, 0.05), improved);
    cases += 2;
    assert.equal(chooseCostGuardedRoadStep([ordinary, improved], ordinary, 20, null, 0.05, true), ordinary);
    const stay = { ...ordinary, distance: 20, cost: 20.3, road: true };
    assert.equal(chooseCostGuardedRoadStep([stay, road], stay, 20, null, 0.05, true), road);
    cases += 2;
    for (const changes of [{ distance: 20 }, { delay: 1 }, { crowd: 1 }, { cost: 19.01 },
      { road: false }, { cost: NaN }, { distance: Infinity }]) {
      assert.equal(chooseCostGuardedRoadStep([ordinary, { ...road, ...changes }], ordinary, 20), ordinary);
      cases += 1;
    }
    for (let distance = 18; distance <= 21; distance += 1) {
      for (let delay = 0; delay <= 1; delay += 1) {
        for (let crowd = 0; crowd <= 1; crowd += 1) {
          for (const cost of [18, 19, 20]) {
            const candidate = { ...road, distance, delay, crowd, cost };
            const picked = chooseCostGuardedRoadStep([ordinary, candidate], ordinary, 20);
            if (picked !== ordinary) assert(picked.distance <= ordinary.distance && picked.distance < 20
              && picked.delay <= ordinary.delay && picked.crowd <= ordinary.crowd && picked.cost <= ordinary.cost);
            cases += 1;
          }
        }
      }
    }
    assert.equal(JSON.stringify([ordinary, road]), snapshot);
  } finally { Math.random = originalRandom; }
}

// Verify the public mover preserves sampling and admits every surface work family.
function validateEngine() {
  for (const type of ['road', 'bridge', 'ford']) {
    for (const family of ['gather', 'build', 'mine', 'home']) {
      const { state, config, actor } = fixture();
      state.roads.types[3][2] = type;
      actor.job = family === 'home' ? null : { id: 'work', type: family, resource: 'food' };
      let draws = 0; Math.random = () => { draws += 1; return 0; };
      moveWithDetour(actor, 14, 10, runtime, state, config, `${family}:work`);
      assert.deepEqual([actor.x, actor.y], [2, 3]);
      assert.equal(draws, 1);
      cases += 1;
    }
  }
  for (const reason of ['slower', 'crowded', 'away', 'blocked', 'deep', 'short']) {
    const { state, config, actor } = fixture();
    state.roads.types[3][2] = 'road';
    if (reason === 'slower') state.terrain.types[3][2] = 'mountain';
    if (reason === 'crowded') state.dwarves.push({ id: 'crowd', x: 2, y: 3 });
    if (reason === 'away') { state.roads.types[3][2] = null; state.roads.types[2][1] = 'road'; }
    if (reason === 'blocked') state.terrain.walkable[3][2] = false;
    if (reason === 'deep') actor.underrealmDuty = { active: true };
    Math.random = () => 0;
    moveWithDetour(actor, reason === 'short' ? 4 : 14, reason === 'short' ? 2 : 10,
      runtime, state, config);
    assert.deepEqual([actor.x, actor.y], [3, 2], reason);
    cases += 1;
  }
  const { state, config, actor } = fixture();
  const tracker = createRefinementTracker(state, config);
  Math.random = () => 0;
  moveWithDetour(actor, 14, 10, runtime, state, config);
  Object.assign(actor, { x: 2, y: 2, moveCooldown: 0 });
  state.roads.types[3][2] = 'ford'; state.roads.version += 1;
  moveWithDetour(actor, 14, 10, runtime, state, config);
  assert.deepEqual([actor.x, actor.y], [2, 3], 'new roads are visible immediately');
  const report = getRefinementReport(state, tracker, 1);
  assert.equal(report.movement.roadRebuilds, 0, 'guarded routing does not build nearest-road maps');
  assert.equal(report.movement.roadEvaluations, 2);
  assert.equal(report.movement.roadSubstitutions, 1);
  cases += 1;
}

// Exercise the production regional policy on a real long trip and a local-trip control.
function validateProductionScope() {
  for (const scenario of ['local', 'long', 'offroad']) {
    const longTrip = scenario !== 'local';
    const { state, config, actor } = fixture();
    config.population.pathing.field.roadAffinity = clone(baseConfig.population.pathing.field.roadAffinity);
    Object.assign(config.population.pathing.field, { temperature: 0.25, inertiaWeight: 0.2 });
    actor.lastMoveDx = 0; actor.lastMoveDy = 1;
    actor.job = { id: 'regional', type: 'build', resource: 'wood' };
    const target = { x: longTrip ? 34 : 14, y: 10 };
    state.roads.links = { route: { key: 'route', kind: 'village', completed: true,
      from: { x: 2, y: 2 }, to: target } };
    state.roads.tileLinks = {};
    if (scenario !== 'offroad') {
      state.roads.types[2][2] = 'road'; state.roads.tileLinks['2,2'] = ['route'];
    }
    for (let x = 2; x <= target.x; x += 1) {
      state.roads.types[3][x] = 'road'; state.roads.tileLinks[`${x},3`] = ['route'];
    }
    let draws = 0; Math.random = () => { draws += 1; return longTrip ? 0 : 0.1; };
    moveWithDetour(actor, target.x, target.y, runtime, state, config, 'regional');
    assert.deepEqual([actor.x, actor.y], scenario === 'long' ? [2, 3]
      : scenario === 'local' ? [3, 2] : [2, 2]);
    assert.equal(draws, 1);
    cases += 1;
  }
}

// Keep critical gathering on the ordinary sampler while other work remains eligible.
function validateProtectedGathering() {
  for (const resource of ['food', 'water', 'beer', 'stone', null]) {
    const { state, config, actor } = fixture();
    config.population.pathing.field.roadAffinity.protected_gather_resources = ['food', 'water', 'beer'];
    state.roads.types[3][2] = 'road';
    actor.job = { id: 'protected', type: resource ? 'gather' : 'build', resource: resource || 'food' };
    let draws = 0; Math.random = () => { draws += 1; return 0; };
    moveWithDetour(actor, 14, 10, runtime, state, config, 'protected');
    const protectedGather = ['food', 'water', 'beer'].includes(resource);
    assert.deepEqual([actor.x, actor.y], protectedGather ? [3, 2] : [2, 3]);
    assert.equal(draws, 1);
    assert.equal(Boolean(actor.roadRoute), !protectedGather);
    cases += 1;
  }
}

// Compare identical RNG streams through whole trips, reload and observer subscription.
function validateReplay() {
  const run = (enabled, observe, reload) => seeded(202, () => {
    const setup = fixture();
    setup.config.population.pathing.field.roadAffinity.enabled = enabled;
    let state = setup.state;
    for (let x = 2; x <= 14; x += 1) state.roads.types[3][x] = 'road';
    if (reload) state = clone(state);
    const actor = state.dwarves[0];
    const observation = buildObservation(state, setup.config);
    const tracker = observe ? createRefinementTracker(state, setup.config) : null;
    for (let tick = 0; tick < 20; tick += 1) {
      state.tick += 1; moveWithDetour(actor, 14, 10, runtime, state, setup.config);
    }
    assert.deepEqual([actor.x, actor.y], [14, 10]);
    return { actor, nextRandom: Math.random(), observation,
      substitutions: tracker ? getRefinementReport(state, tracker, 1).movement.roadSubstitutions : null };
  });
  const plain = run(false, false, false);
  const guarded = run(true, false, false);
  const tracked = run(true, true, false);
  const reloaded = run(true, false, true);
  assert.equal(plain.nextRandom, guarded.nextRandom);
  assert.deepEqual(guarded.actor, tracked.actor);
  assert.deepEqual(guarded, reloaded);
  assert.deepEqual(plain.observation, guarded.observation);
  assert(tracked.substitutions > 0);
  cases += 1;
}

// Shared assigned destinations must remain enterable without disabling transit crowd avoidance.
function validateDestinationCrowd() {
  for (const purpose of ['work', 'home', 'idle', 'offroad']) {
    const { state, config, actor } = fixture();
    config.population.pathing.field.crowdWeight = 1;
    config.population.pathing.field.roadAffinity.target_crowd_exemption = true;
    actor.job = ['work', 'offroad'].includes(purpose) ? { type: 'gather' } : null;
    actor.pathTargetKey = `${purpose}:assigned`;
    actor.roadRoute = { targetKey: actor.pathTargetKey, jobId: null };
    if (purpose !== 'offroad') state.roads.types[2][2] = 'road';
    for (let index = 0; index < 6; index += 1) state.dwarves.push({ id: `resident_${index}`, x: 3, y: 2 });
    Math.random = () => 0;
    moveWithDetour(actor, 3, 2, runtime, state, config, `${purpose}:assigned`);
    assert.deepEqual([actor.x, actor.y], ['idle', 'offroad'].includes(purpose) ? [2, 2] : [3, 2]);
    cases += 1;
  }
}

// Re-route only an invalid terrain target from the current worker position.
function validateGatherRetarget() {
  for (const enabled of [false, true]) {
    const { state, config, actor } = fixture();
    config.population.pathing.field.roadAffinity.retarget_from_current_position = enabled;
    config.resources.useTerrainTiles = true;
    config.resources.terrainAllowed.food = ['food'];
    state.terrain.types[2][4] = 'food'; state.terrain.types[2][13] = 'food';
    state.structures = [{ id: 'home', type: 'house', x: 2, y: 2 }];
    actor.homeId = 'home'; actor.x = 14;
    state.roads.types[2][14] = 'road';
    actor.job = { id: 'retarget', type: 'gather', resource: 'food', target: { x: 3, y: 2 }, workRemaining: 3 };
    actor.pathTargetKey = 'job:gather:tile:3,2';
    actor.roadRoute = { targetKey: actor.pathTargetKey, jobId: actor.job.id };
    state.jobs = [actor.job]; state.raid.active = false;
    Math.random = () => 0;
    processDwarfAction(actor, state, config, runtime);
    assert.deepEqual(actor.job.target, { x: enabled ? 13 : 4, y: 2 });
    cases += 1;
  }
}

// A nearby dead end, slow continuation, crowd or road interruption cannot lure a trip.
function validateContinuation() {
  const start = { x: 2, y: 3, distance: 19 };
  const inspect = (x, y) => y === 3 && x >= 2 && x <= 7
    ? { road: true, distance: 21 - x, delay: 0, crowd: 0 } : null;
  assert(hasProgressingRoadContinuation(start, 6, inspect, 0, 0));
  assert(!hasProgressingRoadContinuation(start, 7, inspect, 0, 0));
  assert(!hasProgressingRoadContinuation(start, 6, (x, y) => {
    const value = inspect(x, y); return value && { ...value, delay: x === 4 ? 1 : 0 };
  }, 0, 0));
  assert(!hasProgressingRoadContinuation(start, 6, (x, y) => x === 4 ? null : inspect(x, y), 0, 0));
  cases += 4;
  for (const length of [2, 6]) {
    const { state, config, actor } = fixture();
    config.population.pathing.field.roadAffinity.minimum_road_steps = 6;
    actor.job = { id: 'first', type: 'gather' };
    for (let x = 2; x < 2 + length; x += 1) state.roads.types[3][x] = 'road';
    Math.random = () => 0;
    moveWithDetour(actor, 14, 10, runtime, state, config, 'same_target');
    assert.deepEqual([actor.x, actor.y], length === 6 ? [2, 3] : [3, 2]);
    if (length === 6) {
      assert.equal(actor.roadRoute.jobId, 'first');
      actor.job.id = 'second'; actor.x = 2; actor.y = 2;
      state.roads.types[3].fill(null);
      moveWithDetour(actor, 14, 10, runtime, state, config, 'same_target');
      assert.equal(actor.roadRoute, undefined, 'a new job cannot inherit the previous route intervention');
    }
    cases += 1;
  }
}

// A naturally selected connected road trip gets protection without manufacturing substitutions.
function validateWholeTrip() {
  const { state, config, actor } = fixture();
  const affinity = config.population.pathing.field.roadAffinity;
  Object.assign(affinity, { minimum_road_steps: 6, whole_trip_protection: true, target_crowd_exemption: true });
  for (let x = 3; x <= 8; x += 1) state.roads.types[2][x] = 'road';
  actor.job = { id: 'whole', type: 'gather' };
  Math.random = () => 0;
  moveWithDetour(actor, 14, 10, runtime, state, config, 'whole_trip');
  assert.deepEqual([actor.x, actor.y], [3, 2]);
  assert.equal(actor.roadRoute.jobId, 'whole');
  actor.x = 13; actor.y = 10; actor.pathTargetKey = 'whole_trip';
  for (let index = 0; index < 6; index += 1) state.dwarves.push({ id: `waiting_${index}`, x: 14, y: 10 });
  config.population.pathing.field.crowdWeight = 1;
  state.tick += 1;
  moveWithDetour(actor, 14, 10, runtime, state, config, 'whole_trip');
  assert.deepEqual([actor.x, actor.y], [14, 10], 'verified road trips finish off-road approaches');
  const stay = { distance: 10, cost: 10.25, delay: 0, crowd: 0 };
  const forward = { distance: 9, cost: 9, delay: 0, crowd: 0 };
  assert.equal(chooseProtectedRoadTripStep([stay, forward], stay, 10), forward);
  assert.equal(chooseProtectedRoadTripStep([stay, { ...forward, delay: 1 }], stay, 10), stay);
  const cheaper = { ...forward, cost: 8.72 };
  assert.equal(chooseProtectedRoadTripStep([forward, cheaper], forward, 10), forward,
    'an ordinary advancing sample retains its stochastic choice');
  cases += 5;
}

// Only completed connected components serving the destination area can guide a new trip.
function validateConnections() {
  const { state } = fixture();
  state.roads.connectionVersion = 1;
  state.roads.links = {
    a: { key: 'a', completed: true, from: { x: 0, y: 0 }, to: { x: 6, y: 0 } },
    b: { key: 'b', kind: 'village', completed: true, from: { x: 6, y: 0 }, to: { x: 6, y: 6 } },
    c: { key: 'c', completed: false, from: { x: 20, y: 20 }, to: { x: 30, y: 20 } },
  };
  const before = JSON.stringify(state.roads);
  assert.deepEqual([...getRoadTargetConnections(state, 6, 6, 0)], ['a', 'b']);
  assert.equal(getRoadTargetConnections(state, 30, 20, 0).size, 0);
  assert.equal(getRoadTargetConnections(state, 6, 9, 3).size, 2);
  assert.equal(getRoadTargetConnections(state, 6, 10, 3).size, 0);
  assert.equal(JSON.stringify(state.roads), before, 'connectivity caches are outside save state');
  state.roads.links.c.completed = true; state.roads.connectionVersion += 1;
  assert.deepEqual([...getRoadTargetConnections(state, 30, 20, 0)], ['c']);
  assert.equal(getRoadTargetConnections(state, 30, 20, 0, true).size, 0, 'isolated local links stay on ordinary routing');
  assert.equal(getRoadTargetConnections(state, 6, 6, 0, true).size, 2, 'completed regional components are eligible');
  for (const completed of [false, true]) {
    const setup = fixture();
    Object.assign(setup.config.population.pathing.field.roadAffinity, {
      minimum_road_steps: 6, completed_connections_only: true, destination_radius: 0,
    });
    const roads = setup.state.roads;
    roads.links = { route: { key: 'route', completed,
      from: { x: 2, y: 3 }, to: { x: 14, y: 3 } } };
    roads.tileLinks = {};
    for (let x = 2; x <= 14; x += 1) { roads.types[3][x] = 'road'; roads.tileLinks[`${x},3`] = ['route']; }
    Math.random = () => 0;
    moveWithDetour(setup.actor, 14, 3, runtime, setup.state, setup.config);
    assert.deepEqual([setup.actor.x, setup.actor.y], completed ? [2, 3] : [3, 2]);
  }
  cases += 10;
}

// Prove the acceptance reader rejects regressions and missing/overflow measurements.
function validateGateFailures() {
  const cached = require('../benchmark_cache/headless_benchmark_baseline.json');
  const baseline = { meta: cached.meta, variant: cached.variants[0] };
  const candidate = clone(baseline);
  candidate.variant.summary.refinement.movement.roadSubstitutions = 1;
  candidate.variant.rows.forEach((row) => { row.refinement.movement.roadSubstitutions = 1; });
  assert(validateRoadReports(baseline, candidate).passed);
  const inactive = clone(candidate);
  inactive.variant.summary.refinement.movement.roadSubstitutions = 0;
  inactive.variant.rows.forEach((row) => { row.refinement.movement.roadSubstitutions = 0; });
  assert(!validateRoadReports(baseline, inactive).passed);
  const oneSubstitution = clone(inactive);
  oneSubstitution.variant.rows[0].refinement.movement.roadSubstitutions = 1;
  oneSubstitution.variant.summary.refinement.movement.roadSubstitutions = 1 / oneSubstitution.variant.rows.length;
  const singleGate = validateRoadReports(baseline, oneSubstitution);
  assert(singleGate.passed);
  assert.equal(singleGate.checks.find((row) => row.metric === 'roadSubstitutions').current, 1);
  cases += 1;
  assert.throws(() => validateRoadReports(baseline, inactive, false, false), /4000 ticks/);
  const startupBase = clone(baseline); const startup = clone(inactive);
  for (const report of [startupBase, startup]) {
    report.meta.ticks = 4000;
    report.variant.rows.forEach((row) => { row.tick = 4000; });
  }
  assert(validateRoadReports(startupBase, startup, false, false).passed);
  startup.variant.rows[0].refinement.movement.gatherUnits.water *= 0.94;
  assert(!validateRoadReports(startupBase, startup, false, false).passed);
  cases += 4;
  for (const damage of [
    (copy) => { copy.variant.rows[0].refinement.movement.gatherUnits.food *= 0.94; },
    (copy) => { copy.variant.rows[0].refinement.movement.p95TravelTicks = null; },
    (copy) => { copy.variant.rows[0].refinement.economy.invalidStockpiles = 1; },
    (copy) => { copy.variant.summary.refinement.movement.gatherUnits.water *= 0.94; },
    (copy) => { copy.variant.rows[0].refinement.runtime.ticksPerSecond *= 0.84; },
  ]) {
    const copy = clone(candidate); damage(copy);
    assert(!validateRoadReports(baseline, copy, true).passed);
    cases += 1;
  }
}

try {
  validateDominance(); validateEngine(); validateProtectedGathering(); validateReplay(); validateDestinationCrowd();
  validateProductionScope();
  validateGatherRetarget(); validateGateFailures();
  validateContinuation();
  validateWholeTrip();
  validateConnections();
  assert.equal(JSON.stringify(baseConfig), configSnapshot);
  process.stdout.write(`road-routing contracts: PASS (${cases} checks; guards, RNG, work families, cache, reload, PPO)\n`);
} finally { Math.random = originalRandom; }
