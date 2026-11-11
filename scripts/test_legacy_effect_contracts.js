#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const baseConfig = require('../config.json');
const { createInitialState } = require('../src/state');
const { pushEvent } = require('../src/simulation/events');
const { runEndgameReset } = require('../src/simulation/endgame');
const { processDwarfAction } = require('../src/simulation/dwarf_actions');
const { migrateWorldLegacyState, carryWorldLegacyAcrossCycle } = require('../src/simulation/world_legacy');
const { buildObservation } = require('../src/ai/observation');
const { resolveLegacyEffects } = require('../src/simulation/legacy_effects');
const { buildTelemetrySections } = require('../src/telemetry/telemetry');

const clone = (value) => JSON.parse(JSON.stringify(value));
const runtime = { gridWidth: 60, gridHeight: 30, playableArea: 1800 };
const config = clone(baseConfig);
config.endgame.transition.randomizeSeed = false;
config.world_legacy.institutions.effects.enabled = true;
let seed = 404;
const originalRandom = Math.random;
Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

// Feed the real structured boundary and Chronicle collector with distinct witnessed works.
function receipts(state, count) {
  for (let index = 0; index < count; index += 1) {
    state.tick += 1;
    pushEvent(state, config, { type: 'construction.structure_completed', category: 'economy',
      importance: 'major', message: `Witnessed work ${index + 1}.`, actors: [],
      location: { scope: 'surface', x: 2, y: 2, label: 'Builders court' },
      source: 'legacy_effect_contract', causes: [], consequences: [], tags: [] });
  }
}

try {
  const state = createInitialState(config, runtime);
  receipts(state, 3);
  runEndgameReset(state, config, runtime);
  const observation = buildObservation(state, config);
  const snapshot = JSON.stringify(state);
  const effect = resolveLegacyEffects(state, config);
  assert.equal(effect.activeCount, 1);
  assert.equal(effect.constructionSpeed, 0.005);
  assert.equal(effect.details[0].sourceEventIds.length, 3);
  assert.equal(effect.details[0].sourceChapterId, 'settlement_growth');
  Math.random = () => { throw new Error('Effect resolver consumed gameplay RNG'); };
  assert.deepEqual(resolveLegacyEffects(state, config), effect);
  assert(JSON.stringify(state) === snapshot, 'resolving must not mutate history');
  assert.deepEqual(buildObservation(state, config), observation, 'PPO shape and values stay isolated');
  assert.deepEqual(resolveLegacyEffects(clone(state), config), effect, 'save/reload is idempotent');
  const replay = clone(state);
  carryWorldLegacyAcrossCycle(replay, replay, config, replay.chronicle.archive[0]);
  assert.deepEqual(replay.worldLegacy.institutions, state.worldLegacy.institutions,
    'replaying one completed cycle cannot admit the same guild twice');
  assert.deepEqual(resolveLegacyEffects(replay, config), effect);
  const rows = Object.values(buildTelemetrySections(state, config, 120)).flatMap((section) => section.rows);
  assert(rows.some((row) => row.includes('Inherited construction: +0.50%')));
  assert(rows.some((row) => row.includes('Guild source: cycle 1 / settlement_growth')));
  assert(rows.some((row) => row.includes('raw 0.50%') && row.includes('applied 0.50%')));
  const disabled = clone(config);
  disabled.world_legacy.institutions.effects.enabled = false;
  assert.equal(resolveLegacyEffects(state, disabled).activeMagnitude, 0);

  const old = clone(state);
  old.cycleStats.count = 2;
  assert.equal(resolveLegacyEffects(old, config).constructionSpeed, 0.0025, 'one cycle halves the effect');
  old.cycleStats.count = 3;
  assert.equal(resolveLegacyEffects(old, config).constructionSpeed, 0.00125);
  const missing = clone(state);
  missing.chronicle.archive = [];
  assert.equal(resolveLegacyEffects(missing, config).activeCount, 0, 'missing source expires safely');
  const broken = clone(state);
  broken.worldLegacy.institutions[0].sourceEventIds[0] = 'unknown';
  assert.equal(resolveLegacyEffects(broken, config).activeCount, 0);
  const unsupported = clone(state);
  unsupported.worldLegacy.institutions[0].modifier.id = 'future_magic';
  unsupported.worldLegacy = migrateWorldLegacyState(unsupported.worldLegacy, config);
  assert.equal(unsupported.worldLegacy.institutions[0].modifier.id, 'future_magic');
  assert.equal(resolveLegacyEffects(unsupported, config).activeCount, 0);
  unsupported.worldLegacy.institutions[0].modifier.id = 'construction_speed';
  unsupported.worldLegacy.institutions[0].modifier.schemaVersion = 99;
  assert.equal(resolveLegacyEffects(unsupported, config).activeCount, 0);
  delete unsupported.worldLegacy.institutions[0].modifier.schemaVersion;
  assert.equal(resolveLegacyEffects(unsupported, config).activeCount, 0, 'old applied=false hooks remain inert');
  const capped = clone(state);
  const capConfig = clone(config);
  capConfig.world_legacy.institutions.modifiers.total_cap = 0.003;
  capped.worldLegacy.institutions[0].modifier.magnitude = 100;
  assert.equal(resolveLegacyEffects(capped, capConfig).activeMagnitude, 0.003);
  capped.worldLegacy.institutions.push({ ...clone(capped.worldLegacy.institutions[0]), id: 'second_guild' });
  assert.equal(resolveLegacyEffects(capped, config).activeMagnitude, 0.02, 'same type never stacks');
  capped.worldLegacy.institutions[0].modifier.magnitude = NaN;
  capped.worldLegacy.institutions[1].modifier.magnitude = Infinity;
  assert.equal(resolveLegacyEffects(capped, config).activeMagnitude, 0, 'nonfinite effects are inert');

  // Exercise the single production consumer with a long build and a normal crafting job.
  const worker = state.dwarves[0];
  state.raid.active = false;
  state.terrain = { width: 60, height: 30,
    walkable: Array.from({ length: 30 }, () => Array(60).fill(true)),
    types: Array.from({ length: 30 }, () => Array(60).fill('plain')) };
  state.nodes = []; state.structures = [];
  worker.x = 2; worker.y = 2;
  worker.job = { id: 'guild_build', type: 'build', structureType: 'house',
    target: { x: 2, y: 2 }, workRemaining: 1000 };
  state.jobs = [worker.job];
  processDwarfAction(worker, state, config, runtime);
  assert.equal(worker.job.workRemaining, 998.995, 'build work alone consumes the modifier');
  state.structures = [{ id: 'armory', type: 'armory', x: 2, y: 2 }];
  worker.job = { id: 'craft', type: 'armory', structureId: 'armory',
    target: { x: 2, y: 2 }, workRemaining: 1000, outputs: {} };
  state.jobs = [worker.job];
  processDwarfAction(worker, state, config, runtime);
  assert.equal(worker.job.workRemaining, 999);

  Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (const count of [0, 1, 2]) {
    const low = createInitialState(config, runtime);
    receipts(low, count); runEndgameReset(low, config, runtime);
    assert.equal(resolveLegacyEffects(low, config).activeCount, 0, 'low evidence cannot invent an effect');
  }
  const organic = createInitialState(config, runtime);
  organic.terrain = state.terrain; organic.structures = []; organic.nodes = [];
  organic.raid.active = false;
  const builder = organic.dwarves[0];
  for (let index = 0; index < 3; index += 1) {
    builder.x = 3 + index * 3; builder.y = 3;
    builder.job = { id: `real_build_${index}`, type: 'build', structureType: 'house',
      target: { x: builder.x, y: builder.y }, workRemaining: 1 };
    organic.jobs = [builder.job]; organic.tick += 1;
    processDwarfAction(builder, organic, config, runtime);
  }
  runEndgameReset(organic, config, runtime);
  assert.equal(resolveLegacyEffects(organic, config).activeCount, 1,
    'real construction producers must satisfy the evidence contract');
  process.stdout.write('legacy-effects contracts: PASS evidence consumer decay caps migration source expiry RNG serialization PPO\n');
} finally { Math.random = originalRandom; }
