#!/usr/bin/env node
'use strict';

const baseConfig = require('../config.json');
const { createInitialState } = require('../src/state');
const {
  SIEGE_STAGES,
  promoteNemesis,
  startSiege,
  updateEpicConflicts,
  getEpicConflictStatus,
} = require('../src/simulation/epic_conflicts');

const runtime = { gridWidth: 100, gridHeight: 36, playableArea: 3600 };

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function seededRandom(seedRaw) {
  let seed = Number(seedRaw) >>> 0;
  return () => {
    seed += 0x6d2b79f5;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function withSeed(seed, callback) {
  const previous = Math.random;
  Math.random = seededRandom(seed);
  try {
    return callback();
  } finally {
    Math.random = previous;
  }
}

function scenarioConfig() {
  const config = clone(baseConfig);
  config.display.terrain.seed = 770077;
  config.epic_conflicts.nemeses.promotion.check_interval_ticks = 1;
  config.epic_conflicts.siege.min_tick = 0;
  config.epic_conflicts.siege.cooldown_ticks = 0;
  config.epic_conflicts.siege.min_population = 1;
  config.epic_conflicts.siege.recovery_ticks = 12;
  config.epic_conflicts.siege.stage_ticks = Object.fromEntries(SIEGE_STAGES.map((stage) => [stage, 3]));
  config.epic_conflicts.siege.road_approach_reduction_per_segment = 0;
  config.epic_conflicts.siege.guardrails.collapse_population_floor = 1;
  config.epic_conflicts.siege.guardrails.collapse_stockpile_ratio = 0;
  config.epic_conflicts.siege.battle.structure_damage_severity = 2;
  config.epic_conflicts.siege.recovery.repair_interval_ticks = 2;
  return config;
}

function installCamp(state, index, hostility = 0.9) {
  const camp = {
    id: `camp_validation_${index}`,
    factionId: `validation_raiders_${index}`,
    factionLabel: `Validation Raiders ${index}`,
    role: 'raider',
    phase: 'active',
    phaseTicksRemaining: 9999,
    hostility,
    raiderDemands: 4,
    x: 5 + index,
    y: 6 + index,
  };
  state.externalCamps = state.externalCamps || {};
  state.externalCamps.camps = [camp];
  state.externalCamps.modifiers = state.externalCamps.modifiers || {};
  return camp;
}

function installNemesis(state, config, index, hostility = 0.9) {
  const camp = installCamp(state, index, hostility);
  return promoteNemesis(state, config, {
    sourceKind: 'raider_leader', sourceId: camp.factionId, sourceCampId: camp.id,
    factionId: camp.factionId, factionLabel: camp.factionLabel,
    power: hostility, eligibility: 'validation',
    location: { scope: 'surface', x: camp.x, y: camp.y, label: camp.factionLabel },
  });
}

function advance(state, config, limit = 200) {
  let ticks = 0;
  while (state.epicConflict.activeSiege && ticks < limit) {
    state.tick += 1;
    updateEpicConflicts(state, config);
    ticks += 1;
  }
  return ticks;
}

function assertStop(condition, message) {
  if (!condition) throw new Error(message);
}

function runFullSiegeProfile() {
  return withSeed(707, () => {
    const config = scenarioConfig();
    config.epic_conflicts.siege.battle.adult_defense_per = 0.2;
    config.epic_conflicts.siege.battle.adult_defense_cap = 2;
    config.epic_conflicts.siege.battle.nemesis_base_power = 0.1;
    config.epic_conflicts.siege.battle.source_power_weight = 0;
    const state = createInitialState(config, runtime);
    const initialPopulation = state.dwarves.length;
    const nemesis = installNemesis(state, config, 1);
    startSiege(state, config, nemesis.id);
    const duration = advance(state, config);
    const history = state.epicConflict.history[0];
    assertStop(history, 'full-siege: no completed history');
    assertStop(history.outcome === 'colony_victory', 'full-siege: stable colony did not win');
    assertStop(history.stages.join(',') === 'warning,approach,demand,breach,battle,retreat,aftermath', 'full-siege: incomplete stage sequence');
    assertStop(state.dwarves.length === initialPopulation, 'full-siege: unexpected population loss');
    assertStop(duration <= 30, 'full-siege: stage machine exceeded deterministic horizon');
    return {
      duration,
      outcome: history.outcome,
      stages: history.stages.length,
      records: nemesis.encounters.length,
      stateBytes: Buffer.byteLength(JSON.stringify(state.epicConflict)),
    };
  });
}

function runCollapseGuardProfile() {
  return withSeed(708, () => {
    const config = scenarioConfig();
    config.epic_conflicts.siege.guardrails.collapse_population_floor = 999;
    const state = createInitialState(config, runtime);
    const before = clone(state.stockpile);
    const nemesis = installNemesis(state, config, 2);
    startSiege(state, config, nemesis.id);
    advance(state, config);
    const history = state.epicConflict.history[0];
    assertStop(history.outcome === 'tribute', 'collapse-guard: tribute branch not selected');
    assertStop(!history.stages.includes('breach'), 'collapse-guard: fragile hold was breached');
    for (const [resource, amount] of Object.entries(state.stockpile)) {
      assertStop(Number(amount) >= 0, `collapse-guard: negative ${resource}`);
      const maxLoss = Math.max(0, Number(before[resource] || 0));
      assertStop(Number(amount) >= Number(before[resource] || 0) - maxLoss, `collapse-guard: invalid ${resource}`);
    }
    return { outcome: history.outcome, stages: history.stages.length, losses: history.outcome === 'tribute' };
  });
}

function runFiveSiegeProfile() {
  return withSeed(709, () => {
    const config = scenarioConfig();
    config.epic_conflicts.nemeses.max_active = 3;
    config.epic_conflicts.siege.battle.adult_defense_per = 0.2;
    config.epic_conflicts.siege.battle.adult_defense_cap = 2;
    config.epic_conflicts.siege.battle.nemesis_base_power = 0.1;
    config.epic_conflicts.siege.battle.source_power_weight = 0;
    const state = createInitialState(config, runtime);
    const population = state.dwarves.length;
    for (let index = 0; index < 5; index += 1) {
      const nemesis = installNemesis(state, config, index + 10);
      startSiege(state, config, nemesis.id);
      advance(state, config);
      state.externalCamps.camps = [];
      const recoveryEnd = state.epicConflict.recoveryUntilTick;
      while (state.tick <= recoveryEnd) {
        state.tick += 1;
        updateEpicConflicts(state, config);
      }
    }
    const status = getEpicConflictStatus(state);
    const bytes = Buffer.byteLength(JSON.stringify(state.epicConflict));
    assertStop(status.nemesisCount <= 3, 'five-siege: nemesis cap exceeded');
    assertStop(state.epicConflict.history.length <= config.epic_conflicts.siege.max_history, 'five-siege: history cap exceeded');
    assertStop(state.dwarves.length === population, 'five-siege: stable profile lost population');
    assertStop(Object.values(state.stockpile).every((value) => Number(value) >= 0), 'five-siege: negative stockpile');
    assertStop(bytes < 64000, 'five-siege: E7 state exceeded 64 KiB stop rule');
    assertStop(state.structures.every((entry) => !entry.siegeDamage), 'five-siege: recovery left permanent damage');
    return {
      nemeses: status.nemesisCount,
      completed: status.stats.siegesCompleted,
      evicted: status.stats.evicted,
      restored: status.stats.structuresRestored,
      stateBytes: bytes,
    };
  });
}

function main() {
  const full = runFullSiegeProfile();
  const guard = runCollapseGuardProfile();
  const five = runFiveSiegeProfile();
  process.stdout.write(`[epic-conflicts] full-siege PASS stages=${full.stages} ticks=${full.duration} encounters=${full.records} bytes=${full.stateBytes}\n`);
  process.stdout.write(`[epic-conflicts] collapse-guard PASS outcome=${guard.outcome} stages=${guard.stages}\n`);
  process.stdout.write(`[epic-conflicts] 5-siege PASS nemeses=${five.nemeses} completed=${five.completed} evicted=${five.evicted} restored=${five.restored} bytes=${five.stateBytes}\n`);
}

main();
