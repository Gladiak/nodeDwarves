'use strict';

const assert = require('assert');

const baseConfig = require('../config.json');
const { createInitialState } = require('../src/state');
const { pushEvent } = require('../src/simulation/events');
const { runEndgameReset } = require('../src/simulation/endgame');
const {
  WORLD_LEGACY_SCHEMA_VERSION,
  createWorldLegacyState,
  migrateWorldLegacyState,
  getLegacySagaHooks,
  countLegacyRecords,
} = require('../src/simulation/world_legacy');
const { renderWorldLegacyEchoes } = require('../src/render/world_legacy');
const { buildTransitionPanel } = require('../src/render/transition');
const { buildObservation } = require('../src/ai/observation');

const runtime = { gridWidth: 80, gridHeight: 32, playableArea: 2560 };

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function testConfig() {
  const config = clone(baseConfig);
  config.endgame.transition.randomizeSeed = false;
  config.display.terrain.seed = 424242;
  config.display.colors.enabled = false;
  return config;
}

function addLegacyEvent(state, config, cycle, importance = 'legendary') {
  const dwarf = state.dwarves[0];
  return pushEvent(state, config, {
    type: cycle % 2 === 0 ? 'warrior.champion_crowned' : 'lifecycle.death',
    category: cycle % 2 === 0 ? 'warrior' : 'lifecycle',
    importance,
    message: `${dwarf.id} secured the legacy of cycle ${cycle + 1}.`,
    actors: [{ kind: 'dwarf', id: dwarf.id, role: 'primary', label: `Hero ${cycle + 1}` }],
    location: {
      scope: 'surface', depth: 0, x: 4, y: 5,
      placeId: `hold_${cycle + 1}`, label: `Hold ${cycle + 1}`,
    },
    causes: [], consequences: [], source: 'e6_test', tags: ['legacy'],
  });
}

function runCycle(state, config, cycle) {
  state.tick = 1000 + cycle;
  addLegacyEvent(state, config, cycle);
  return runEndgameReset(state, config, runtime, {
    preserveUi: {
      transition: {
        active: true, showPanel: true, message: 'The next hold inherits the old songs.',
      },
    },
  });
}

function assertEchoesMapped(state) {
  for (const echo of state.worldLegacy.echoes) {
    assert(echo.location, `${echo.id} has no mapped location`);
    const { x, y } = echo.location;
    assert.equal(state.terrain.walkable[y][x], true, `${echo.id} is not on a walkable cell`);
    assert(state.places.byId[echo.location.placeId], `${echo.id} is not registered as a current place`);
  }
}

function run() {
  const config = testConfig();
  const initial = createInitialState(config, runtime);
  assert.equal(initial.worldLegacy.schemaVersion, WORLD_LEGACY_SCHEMA_VERSION, 'initial schema');
  assert.equal(countLegacyRecords(initial.worldLegacy), 0, 'initial legacy is empty');

  const migrated = migrateWorldLegacyState({
    history: [{ cycle: 2, title: 'Old shape', sourceEventIds: ['evt_old'] }],
  }, config);
  assert.equal(migrated.schemaVersion, WORLD_LEGACY_SCHEMA_VERSION, 'v0 migrates to current schema');
  assert.equal(migrated.cycles[0].sourceCycle, 2, 'v0 cycle survives migration');
  assert.equal(migrated.stats.migratedStates, 1, 'migration is counted');
  const rejectedFuture = migrateWorldLegacyState({ schemaVersion: 99, echoes: [{ id: 'future' }] }, config);
  assert.equal(countLegacyRecords(rejectedFuture), 0, 'future schema is rejected safely');
  assert.equal(rejectedFuture.stats.rejectedRecords, 1, 'future records are counted as rejected');

  const first = runCycle(initial, config, 0);
  assert.equal(initial.cycleStats.count, 1, 'first cycle closes');
  assert.equal(initial.worldLegacy.cycles.length, 1, 'every cycle creates a cycle record');
  assert(initial.worldLegacy.identities.length > 0, 'actor identity is archived');
  assert(initial.worldLegacy.identities[0].house, 'archived identity retains its house');
  assert(initial.worldLegacy.places.length > 0, 'named place is archived');
  assert(initial.worldLegacy.memorials.length > 0, 'qualifying actor receives a memorial');
  assert(initial.worldLegacy.institutions.length > 0, 'an institution is inherited');
  assert(initial.worldLegacy.echoes.length > 0, 'a geographic echo is created');
  assert(initial.worldLegacy.echoes[0].sourceChapterId, 'echo retains Chronicle chapter provenance');
  assert(first.legacySummary.records > 0, 'reset returns a legacy summary');
  assert.equal(initial.ui.transition.legacySummary.records, first.legacySummary.records, 'transition receives legacy summary');
  assertEchoesMapped(initial);

  const hooks = getLegacySagaHooks(initial);
  assert.equal(hooks.echoes.length, initial.worldLegacy.echoes.length, 'saga hooks expose echoes');
  hooks.echoes[0].label = 'mutated';
  assert.notEqual(initial.worldLegacy.echoes[0].label, 'mutated', 'saga hooks are read-only copies');

  const grid = Array.from({ length: runtime.gridHeight }, () => Array(runtime.gridWidth).fill('.'));
  const rendered = renderWorldLegacyEchoes(grid, initial, config, {});
  assert.equal(rendered, initial.worldLegacy.echoes.length, 'all mapped echoes render');
  assert(grid.some((row) => row.includes(config.symbols.world_legacy_echo)), 'legacy symbol is visible');

  const panelConfig = clone(config);
  panelConfig.display.transition_panel.height = 14;
  const panel = buildTransitionPanel(initial, panelConfig, runtime);
  const panelText = panel.lines.map((line) => line.text).join('\n');
  assert(panelText.includes('WORLD LEGACY'), 'transition makes accumulated legacy inspectable');

  const observation = buildObservation(initial, config);
  initial.worldLegacy.stats.createdRecords += 1000;
  initial.worldLegacy.echoes.push({ id: 'observation_probe', sourceCycle: 0, sourceEventIds: [], location: null });
  assert.deepEqual(buildObservation(initial, config), observation, 'world legacy remains outside PPO observations');
  initial.worldLegacy.echoes.pop();

  const left = createInitialState(config, runtime);
  const right = createInitialState(config, runtime);
  runCycle(left, config, 0);
  runCycle(right, config, 0);
  assert.deepEqual(left.worldLegacy, right.worldLegacy, 'equal seeds remap legacy identically');

  const bounded = testConfig();
  bounded.world_legacy.retention = {
    max_cycles: 2, max_identities: 3, max_places: 3, max_memorials: 2,
    max_institutions: 3, max_echoes: 3, max_total_records: 12,
  };
  bounded.world_legacy.institutions.modifiers.per_cycle = 0.02;
  bounded.world_legacy.institutions.modifiers.total_cap = 0.03;
  const multi = createInitialState(bounded, runtime);
  const sizes = [];
  for (let cycle = 0; cycle < 5; cycle += 1) {
    runCycle(multi, bounded, cycle);
    sizes.push(countLegacyRecords(multi.worldLegacy));
    assertEchoesMapped(multi);
  }
  assert.equal(multi.cycleStats.count, 5, 'five-cycle profile completes');
  assert.equal(multi.worldLegacy.cycles.length, 2, 'old cycle records expire at cap');
  assert(countLegacyRecords(multi.worldLegacy) <= 12, 'total record cap is hard');
  assert(multi.worldLegacy.stats.evictedRecords > 0, 'compaction is observable');
  const modifierTotal = multi.worldLegacy.institutions.reduce(
    (sum, entry) => sum + Number(entry.modifier && entry.modifier.magnitude || 0), 0,
  );
  assert(modifierTotal <= 0.03 + 1e-9, 'institution modifier budget cannot compound past cap');
  assert(multi.worldLegacy.institutions.every((entry) => entry.modifier.applied === false), 'modifier hooks do not alter gameplay');
  assert(sizes[4] <= sizes[3] + 6, 'five-cycle state growth is bounded by retention');

  const peaceful = createInitialState(config, runtime);
  runEndgameReset(peaceful, config, runtime);
  assert.equal(peaceful.worldLegacy.cycles.length, 1, 'peaceful cycle still leaves a legacy record');

  const cycleOnlyConfig = testConfig();
  for (const key of [
    'max_identities_per_cycle', 'max_places_per_cycle', 'max_memorials_per_cycle',
    'max_institutions_per_cycle', 'max_echoes_per_cycle',
  ]) cycleOnlyConfig.world_legacy.selection[key] = 0;
  const cycleOnly = createInitialState(cycleOnlyConfig, runtime);
  addLegacyEvent(cycleOnly, cycleOnlyConfig, 0);
  runEndgameReset(cycleOnly, cycleOnlyConfig, runtime);
  assert.equal(countLegacyRecords(cycleOnly.worldLegacy), 1, 'zero per-cycle selectors retain only the required cycle record');

  const mythConfig = testConfig();
  mythConfig.world_legacy.selection.max_institutions_per_cycle = 2;
  const mythState = createInitialState(mythConfig, runtime);
  const founder = mythState.dwarves[0];
  pushEvent(mythState, mythConfig, {
    type: 'myth.ancestral_song', category: 'myth', importance: 'critical',
    message: 'The founding house bound its ancestral song to the new hold.',
    actors: [{ kind: 'dwarf', id: founder.id, role: 'founder', label: 'First Founder' }],
    location: { scope: 'world' }, causes: [], consequences: [], source: 'e6_test', tags: ['myth'],
  });
  runEndgameReset(mythState, mythConfig, runtime);
  assert(mythState.worldLegacy.identities.some((entry) => entry.role === 'founder' && entry.house), 'founder house is archived');
  assert(mythState.worldLegacy.institutions.some((entry) => entry.name.includes('Myth Keepers')), 'qualified myth becomes inherited institution memory');

  console.log('World legacy contracts: 39 assertions passed.');
}

run();
