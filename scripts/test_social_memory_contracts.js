#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const baseConfig = require('../config.json');
const { createInitialState } = require('../src/state');
const { runEndgameReset } = require('../src/simulation/endgame');
const { buildTelemetrySections } = require('../src/telemetry/telemetry');
const { createDwarfSocialState, createSocialDramaState, applyLongArcConsequences,
  applyLongArcSettlementDrift, clearDeadSocialLinks, updateSocialDrama } = require('../src/simulation/social_drama');

const clone = (value) => JSON.parse(JSON.stringify(value));
const originalConfig = JSON.stringify(baseConfig);
const config = clone(baseConfig);
const settings = config.population.socialDrama.longArc;
settings.enabled = true;
settings.memoryGainPerUpdate = 0.0015;
settings.settlementMemoryGainPerUpdate = 0.0016;
const social = createSocialDramaState(config);
let cases = 0;

// Pure-memory fixtures avoid random relationships, economy, and terminal runtime.
function dwarf(id) {
  return { id, social: createDwarfSocialState(), state: { morale: 0.5, stress: 0.5, fatigue: 0.5 } };
}

// Exact comparisons use a small floating-point tolerance only for arithmetic rounding.
function near(actual, expected) { assert(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`); }

// Verify every memory/climate/mood leaf remains a finite normalized ratio.
function bounded(values) {
  for (const value of Object.values(values)) {
    assert(Number.isFinite(value) && value >= 0 && value <= 1);
  }
}

const supported = dwarf('supported');
supported.social.status.friendIds = ['friend'];
supported.social.status.menteeIds = ['student'];
applyLongArcConsequences([supported], social, settings, 12);
near(supported.social.arc.supportMemory,
  (settings.friendSupportWeight + settings.mentorshipSupportWeight) * settings.memoryGainPerUpdate);
assert(supported.state.morale > 0.5 && supported.state.stress < 0.5 && supported.state.fatigue < 0.5);
cases += 1;

const burdened = dwarf('burdened');
burdened.social.status.rivalIds = ['rival'];
burdened.social.status.grudgeIds = ['rival'];
applyLongArcConsequences([burdened], social, settings, 12);
near(burdened.social.arc.burdenMemory,
  (settings.rivalBurdenWeight + settings.grudgeBurdenWeight) * settings.memoryGainPerUpdate);
assert(burdened.state.morale < 0.5 && burdened.state.stress > 0.5 && burdened.state.fatigue > 0.5);
cases += 1;

for (let tick = 24; tick <= 12000; tick += 12) {
  applyLongArcConsequences([supported, burdened], social, settings, tick);
  applyLongArcSettlementDrift(social, settings);
  bounded(supported.social.arc); bounded(burdened.social.arc);
  bounded(supported.state); bounded(burdened.state); bounded(social.longArc);
}
assert(social.longArc.harmony < 0.95 && social.longArc.strife < 0.95);
cases += 1;

const memoryBefore = supported.social.arc.supportMemory;
supported.social.status.friendIds = []; supported.social.status.menteeIds = [];
applyLongArcConsequences([supported], social, settings, 12012);
near(supported.social.arc.supportMemory, memoryBefore * (1 - settings.memoryDecayPerTick));
cases += 1;

// Isolate incident shocks from ongoing tie gain and memory decay.
const incidentSettings = { ...settings, memoryDecayPerTick: 0 };
for (const [type, memory, shock] of [
  ['reconciliation', 'supportMemory', settings.supportShockOnPositiveIncident],
  ['grudge_escalation', 'burdenMemory', settings.burdenShockOnNegativeIncident],
]) {
  const actor = dwarf(type);
  actor.social.cooldowns.lastIncidentTick = 100;
  actor.social.cooldowns.lastIncidentType = type;
  applyLongArcConsequences([actor], social, incidentSettings, 100);
  const first = actor.social.arc[memory];
  near(first, shock * settings.memoryGainPerUpdate);
  const restored = clone(actor);
  applyLongArcConsequences([actor], social, incidentSettings, 101);
  applyLongArcConsequences([restored], social, incidentSettings, 101);
  near(actor.social.arc[memory], first);
  assert.deepEqual(actor, restored);
  cases += 1;
}

const held = clone(burdened);
const before = clone(held.social.arc);
const disabled = { ...settings, enabled: false };
applyLongArcConsequences([held], social, disabled, 12024);
applyLongArcSettlementDrift(social, disabled);
assert.deepEqual(held.social.arc, before);
assert.deepEqual(social.longArc, { harmony: 0, strife: 0, avgSupport: 0, avgBurden: 0 });
cases += 1;

const state = { dwarves: [burdened] };
burdened.social.links.rival = { rivalry: 1, grudge: 1 };
clearDeadSocialLinks(state, ['rival']);
assert.deepEqual(burdened.social.status.rivalIds, []);
assert.deepEqual(burdened.social.status.grudgeIds, []);
assert(!burdened.social.links.rival);
cases += 1;

// The singleton path must decay memory too, and disabled climate must reset exactly.
burdened.ageTicks = config.population.aging.adultAge + 1;
state.social = createSocialDramaState(config);
state.tick = 12036;
const loneMemory = burdened.social.arc.burdenMemory;
updateSocialDrama(state, config, null);
assert(burdened.social.arc.burdenMemory < loneMemory);
state.social.longArc.harmony = 0.5;
state.social.longArc.strife = 0.5;
settings.enabled = false;
state.tick += 12;
updateSocialDrama(state, config, null);
assert.equal(state.social.longArc.harmony, 0);
assert.equal(state.social.longArc.strife, 0);
settings.enabled = true;
cases += 1;

// Cycle resets create fresh actor memory, including shock consumption markers.
const originalRandom = Math.random;
try {
  let seed = 101;
  Math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  config.endgame.transition.randomizeSeed = false;
  config.display.terrain.seed = 101;
  const runtime = { gridWidth: 50, gridHeight: 25, playableArea: 1250 };
  const cycle = createInitialState(config, runtime);
  cycle.dwarves[0].social.arc.supportMemory = 1;
  cycle.dwarves[0].social.cooldowns.lastMemoryIncidentTick = 100;
  cycle.tick = 300;
  runEndgameReset(cycle, config, runtime);
  assert(cycle.dwarves.every((actor) => actor.social.arc.supportMemory === 0
    && actor.social.arc.burdenMemory === 0 && !actor.social.cooldowns.lastMemoryIncidentTick));
  cycle.social.longArc.avgSupport = 0.002;
  const socialRows = JSON.stringify(buildTelemetrySections(cycle, config, 72).social);
  assert(socialRows.includes('support 0.2%'), 'small measured memory remains visible');
  cases += 1;
} finally { Math.random = originalRandom; }

assert.deepEqual(config.population.socialDrama.longArc, settings);
assert.equal(JSON.stringify(baseConfig), originalConfig);
process.stdout.write(`social-memory contracts: PASS (${cases} cases)\n`);
