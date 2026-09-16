'use strict';

const assert = require('assert');

const baseConfig = require('../config.json');
const { createInitialState } = require('../src/state');
const { runEndgameReset } = require('../src/simulation/endgame');
const {
  EPIC_CONFLICT_SCHEMA_VERSION,
  SIEGE_STAGES,
  ensureEpicConflictState,
  updateEpicConflicts,
  promoteNemesis,
  startSiege,
  getDwarfNemesisMemory,
  getEpicConflictStatus,
} = require('../src/simulation/epic_conflicts');
const { renderEpicConflicts } = require('../src/render/epic_conflicts');
const { buildInspectPanel } = require('../src/render/inspect');
const { buildTelemetrySections } = require('../src/telemetry/telemetry');
const { buildObservation } = require('../src/ai/observation');

const runtime = { gridWidth: 80, gridHeight: 40, playableArea: 3200 };
let assertions = 0;

function check(value, message) {
  assertions += 1;
  assert(value, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}

function deepEqual(actual, expected, message) {
  assertions += 1;
  assert.deepEqual(actual, expected, message);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function testConfig() {
  const config = clone(baseConfig);
  config.display.colors.enabled = false;
  config.display.terrain.seed = 717171;
  config.endgame.transition.randomizeSeed = false;
  config.epic_conflicts.nemeses.promotion.check_interval_ticks = 1;
  config.epic_conflicts.siege.min_tick = 0;
  config.epic_conflicts.siege.cooldown_ticks = 0;
  config.epic_conflicts.siege.recovery_ticks = 4;
  config.epic_conflicts.siege.min_population = 1;
  config.epic_conflicts.siege.stage_ticks = Object.fromEntries(SIEGE_STAGES.map((stage) => [stage, 1]));
  config.epic_conflicts.siege.road_approach_reduction_per_segment = 0;
  config.epic_conflicts.siege.guardrails.collapse_population_floor = 1;
  config.epic_conflicts.siege.guardrails.collapse_stockpile_ratio = 0;
  config.epic_conflicts.siege.guardrails.max_damaged_structures = 2;
  config.epic_conflicts.siege.battle.structure_damage_severity = 1;
  config.epic_conflicts.siege.recovery.repair_interval_ticks = 1;
  config.epic_conflicts.siege.battle.adult_defense_per = 0.2;
  config.epic_conflicts.siege.battle.adult_defense_cap = 2;
  config.epic_conflicts.siege.battle.nemesis_base_power = 0.1;
  config.epic_conflicts.siege.battle.source_power_weight = 0;
  config.epic_conflicts.siege.battle.cycle_power = 0;
  return config;
}

function addRaiderCamp(state, hostility = 0.9) {
  state.externalCamps = state.externalCamps || { camps: [], modifiers: {} };
  state.externalCamps.camps = [{
    id: 'camp_e7', factionId: 'ashen_marauders', factionLabel: 'Ashen Marauders',
    role: 'raider', phase: 'active', phaseTicksRemaining: 999,
    x: 7, y: 8, hostility, raiderDemands: 3,
  }];
  state.externalCamps.modifiers = state.externalCamps.modifiers || {};
  return state.externalCamps.camps[0];
}

function promoteRaider(state, config, hostility = 0.9) {
  const camp = addRaiderCamp(state, hostility);
  return promoteNemesis(state, config, {
    sourceKind: 'raider_leader', sourceId: camp.factionId, sourceCampId: camp.id,
    factionId: camp.factionId, factionLabel: camp.factionLabel, power: hostility,
    eligibility: 'contract_test', location: { scope: 'surface', x: camp.x, y: camp.y, label: camp.factionLabel },
  });
}

function advanceUntilComplete(state, config, maxTicks = 20) {
  let ticks = 0;
  while (state.epicConflict.activeSiege && ticks < maxTicks) {
    state.tick += 1;
    updateEpicConflicts(state, config);
    ticks += 1;
  }
  return ticks;
}

function runFullSiege(config = testConfig()) {
  const state = createInitialState(config, runtime);
  const nemesis = promoteRaider(state, config);
  const siege = startSiege(state, config, nemesis.id);
  const grid = Array.from({ length: runtime.gridHeight }, () => Array(runtime.gridWidth).fill('.'));
  const rendered = renderEpicConflicts(grid, state, config, {});
  advanceUntilComplete(state, config);
  return { state, nemesis, siege, rendered, grid };
}

function run() {
  const config = testConfig();
  const initial = createInitialState(config, runtime);
  equal(initial.epicConflict.schemaVersion, EPIC_CONFLICT_SCHEMA_VERSION, 'initial E7 schema');
  equal(initial.epicConflict.nemeses.order.length, 0, 'initial nemesis registry is empty');

  const left = createInitialState(config, runtime);
  const right = createInitialState(config, runtime);
  const previousRandom = Math.random;
  Math.random = () => { throw new Error('nemesis identity consumed RNG'); };
  let leftNemesis;
  let rightNemesis;
  try {
    leftNemesis = promoteRaider(left, config);
    rightNemesis = promoteRaider(right, config);
  } finally {
    Math.random = previousRandom;
  }
  equal(leftNemesis.id, rightNemesis.id, 'same source produces stable nemesis id');
  equal(leftNemesis.displayName, rightNemesis.displayName, 'same source produces stable name');
  deepEqual(leftNemesis.traits, rightNemesis.traits, 'same source produces stable traits');
  check(leftNemesis.goal.length > 0, 'nemesis has a deterministic goal');
  check(leftNemesis.sagaId.startsWith('saga_nemesis_'), 'nemesis owns an explicit saga');
  check(left.story.sagas.byId[leftNemesis.sagaId], 'promotion is visible in saga registry');
  check(left.eventLog.some((event) => event.type === 'nemesis.promoted'), 'promotion emits canonical event');

  const automatic = createInitialState(config, runtime);
  addRaiderCamp(automatic);
  automatic.tick = 1;
  updateEpicConflicts(automatic, config);
  check(automatic.epicConflict.activeSiege, 'eligible raider camp automatically starts a staged siege');
  equal(automatic.epicConflict.activeSiege.stage, 'warning', 'automatic siege begins at warning');

  const demandTriggerConfig = testConfig();
  demandTriggerConfig.epic_conflicts.siege.trigger.raider_min_hostility = 0.99;
  demandTriggerConfig.epic_conflicts.siege.trigger.raider_min_demands = 2;
  const demandTriggered = createInitialState(demandTriggerConfig, runtime);
  const demandingCamp = addRaiderCamp(demandTriggered, 0.1);
  demandingCamp.raiderDemands = 2;
  demandTriggered.tick = 1;
  updateEpicConflicts(demandTriggered, demandTriggerConfig);
  check(demandTriggered.epicConflict.activeSiege, 'repeated demands can trigger a siege below the hostility threshold');

  const underrealm = createInitialState(config, runtime);
  const floor = underrealm.underrealm.combat.floorsByDepth['1'];
  floor.encounter.attempts = 1;
  floor.encounter.lastOutcome = 'defeat';
  floor.encounter.lastOutcomeTick = 1;
  underrealm.tick = 1;
  updateEpicConflicts(underrealm, config);
  const deepNemesis = Object.values(underrealm.epicConflict.nemeses.byId)
    .find((record) => record.sourceKind === 'underrealm_champion');
  check(deepNemesis, 'encountered Underrealm champion is promoted');
  equal(deepNemesis.sourceDepth, 1, 'Underrealm nemesis retains depth');
  check(deepNemesis.encounters.length > 0, 'Underrealm outcome enters encounter memory');

  const full = runFullSiege(config);
  check(full.siege, 'eligible nemesis starts a siege');
  equal(full.rendered.nemesis, 1, 'active nemesis front renders');
  equal(full.grid[8][7], config.symbols.nemesis, 'nemesis marker uses configured symbol');
  equal(full.state.epicConflict.stats.siegesCompleted, 1, 'full siege completes');
  const completed = full.state.epicConflict.history[0];
  deepEqual(completed.stages, ['warning', 'approach', 'demand', 'breach', 'battle', 'retreat', 'aftermath'], 'victory path exercises full staged lifecycle');
  equal(completed.outcome, 'colony_victory', 'stable hold wins deterministic scenario');
  check(full.state.eventLog.some((event) => event.type === 'siege.battle_resolved'), 'battle outcome is a canonical fact');
  check(full.state.eventLog.some((event) => event.type === 'siege.aftermath'), 'aftermath is visible');
  check(full.state.epicConflict.stats.structuresDamaged > 0, 'breach damages bounded structures');
  check(full.state.epicConflict.stats.colonyVictories > 0, 'colony outcome counter advances');
  check(full.nemesis.encounters.length === 1, 'hero-nemesis encounter is retained');
  const heroId = full.nemesis.encounters[0].heroId;
  check(getDwarfNemesisMemory(full.state, heroId).length > 0, 'hero Inspect memory resolves nemesis rivalry');

  full.state.ui.inspect.open = true;
  full.state.ui.inspect.ids = [heroId];
  full.state.ui.inspect.index = 0;
  const inspect = buildInspectPanel(full.state, config, runtime);
  const inspectText = inspect.lines.map((line) => line.text).join('\n');
  check(inspectText.includes('Nemesis:'), 'Dwarf Inspect presents nemesis memory');
  check(inspectText.includes(full.nemesis.displayName), 'Dwarf Inspect resolves the stable nemesis identity');
  const telemetry = buildTelemetrySections(full.state, config, 90);
  const storySection = telemetry.storyDirector;
  check(storySection.rows.some((line) => String(line).includes('Nemeses:')), 'saga telemetry exposes nemesis count');
  check(storySection.rows.some((line) => String(line).includes('Epic outcomes:')), 'saga telemetry exposes outcomes');

  full.state.tick += 1;
  updateEpicConflicts(full.state, config);
  check(full.state.structures.every((entry) => !entry.siegeDamage), 'recovery repairs siege damage');
  check(full.state.epicConflict.stats.structuresRestored > 0, 'repair completion is counted');

  const defeatedConfig = testConfig();
  defeatedConfig.epic_conflicts.siege.battle.adult_defense_per = 0;
  defeatedConfig.epic_conflicts.siege.battle.adult_defense_cap = 0;
  defeatedConfig.epic_conflicts.siege.battle.hero_defense_weight = 0;
  defeatedConfig.epic_conflicts.siege.battle.watchtower_defense = 0;
  defeatedConfig.epic_conflicts.siege.battle.armory_defense = 0;
  defeatedConfig.epic_conflicts.siege.battle.nemesis_base_power = 1;
  defeatedConfig.epic_conflicts.rivalry.rescue_min_hero_score = 1;
  defeatedConfig.epic_conflicts.rivalry.rescue_defense_bonus = 0;
  const defeated = runFullSiege(defeatedConfig);
  equal(defeated.state.epicConflict.history[0].outcome, 'nemesis_victory', 'weak defense can lose meaningfully');
  check(defeated.state.epicConflict.history[0].stages.includes('victory'), 'nemesis win exercises the victory stage');
  check(defeated.state.epicConflict.stats.injuries <= defeatedConfig.epic_conflicts.siege.guardrails.max_injuries, 'injuries respect hard cap');
  check(Object.values(defeated.state.stockpile).every((value) => Number(value) >= 0), 'siege never creates negative stockpiles');
  check(defeated.state.epicConflict.stats.nemesisVictories === 1, 'nemesis victory is counted');

  const guardedConfig = testConfig();
  guardedConfig.epic_conflicts.siege.guardrails.collapse_population_floor = 999;
  const guarded = runFullSiege(guardedConfig);
  equal(guarded.state.epicConflict.history[0].outcome, 'tribute', 'collapse guardrail accepts bounded tribute');
  check(!guarded.state.epicConflict.history[0].stages.includes('breach'), 'collapse guardrail avoids breach storm');

  const reconcileState = createInitialState(config, runtime);
  const reconcileNemesis = promoteRaider(reconcileState, config, 0.1);
  reconcileNemesis.victories = 1;
  reconcileNemesis.defeats = 1;
  startSiege(reconcileState, config, reconcileNemesis.id);
  advanceUntilComplete(reconcileState, config);
  equal(reconcileState.epicConflict.history[0].outcome, 'reconciliation', 'balanced rivalry can reconcile');
  equal(reconcileNemesis.status, 'reconciled', 'reconciled nemesis becomes terminal');

  const revengeState = createInitialState(config, runtime);
  const revengeNemesis = promoteRaider(revengeState, config);
  const revengeHero = revengeState.dwarves[0];
  revengeNemesis.grudgeHeroId = revengeHero.id;
  revengeNemesis.grudges.push(revengeHero.id);
  revengeNemesis.encounters.push({ id: 'prior', cycle: 0, tick: 0, heroId: revengeHero.id, outcome: 'nemesis_victory', branch: 'defeat', sourceEventId: null });
  startSiege(revengeState, config, revengeNemesis.id);
  advanceUntilComplete(revengeState, config);
  equal(revengeState.epicConflict.history[0].branch, 'revenge', 'returning hero can complete revenge branch');

  const successionState = createInitialState(config, runtime);
  const successionNemesis = promoteRaider(successionState, config);
  successionNemesis.grudgeHeroId = 'fallen_hero';
  successionNemesis.grudgeHeroClanId = successionState.dwarves[0].clanId;
  startSiege(successionState, config, successionNemesis.id);
  advanceUntilComplete(successionState, config);
  equal(successionState.epicConflict.history[0].branch, 'inherited_grudge', 'successor inherits an unresolved grudge');

  const legacyState = full.state;
  const observation = buildObservation(legacyState, config);
  legacyState.epicConflict.stats.siegesStarted += 99;
  deepEqual(buildObservation(legacyState, config), observation, 'E7 state remains outside PPO observations');
  legacyState.epicConflict.stats.siegesStarted -= 99;
  runEndgameReset(legacyState, config, runtime);
  check(legacyState.worldLegacy.nemeses.length > 0, 'qualified nemesis enters bounded world legacy');
  check(legacyState.epicConflict.nemeses.order.length > 0, 'legacy nemesis restores in next cycle');
  const restoredId = legacyState.epicConflict.nemeses.order[0];
  check(legacyState.epicConflict.nemeses.byId[restoredId].restoredFromLegacy, 'restored identity is marked');
  legacyState.tick += 1;
  updateEpicConflicts(legacyState, config);
  check(legacyState.eventLog.some((event) => event.type === 'nemesis.reappeared'), 'cross-cycle reappearance is narrated');

  const capacityConfig = testConfig();
  capacityConfig.epic_conflicts.nemeses.max_active = 2;
  const capacity = createInitialState(capacityConfig, runtime);
  for (let index = 0; index < 5; index += 1) {
    promoteNemesis(capacity, capacityConfig, {
      sourceKind: 'raider_leader', sourceId: `faction_${index}`,
      factionId: `faction_${index}`, factionLabel: `Faction ${index}`,
      power: 0.5, eligibility: 'capacity', location: { scope: 'world' },
    });
  }
  equal(capacity.epicConflict.nemeses.order.length, 2, 'nemesis registry obeys configured cap');
  check(capacity.epicConflict.stats.evicted >= 3, 'nemesis eviction is observable');
  check(JSON.stringify(capacity.epicConflict).length < 30000, 'bounded E7 state serializes compactly');

  const repaired = { epicConflict: { nemeses: { order: ['bad'], byId: { bad: { id: 'bad' } } }, history: new Array(100).fill({ id: 'old' }) } };
  ensureEpicConflictState(repaired, config);
  check(repaired.epicConflict.history.length <= config.epic_conflicts.siege.max_history, 'malformed history is repaired to cap');
  equal(repaired.epicConflict.schemaVersion, EPIC_CONFLICT_SCHEMA_VERSION, 'repaired state uses current schema');

  const status = getEpicConflictStatus(defeated.state);
  equal(status.stats.siegesCompleted, 1, 'read model reports completed siege');
  check(status.nemesisCount >= 1, 'read model reports named antagonists');

  console.log(`Epic conflict contracts: ${assertions} assertions passed.`);
}

run();
