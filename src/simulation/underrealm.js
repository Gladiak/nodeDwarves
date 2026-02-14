'use strict';

const { clamp } = require('../utils');
const { pushEvent } = require('./events');
const { isAdult } = require('./population');
const { getAlchemyMultiplier } = require('./alchemy');
const { getSchismModifier } = require('./schism');

const DEFAULT_NODE_TEMPLATES = {
  stone: {
    enabled: true,
    minDepth: 1,
    baseNodes: 7,
    nodesPerDepth: 1,
    capacityMin: 44,
    capacityMax: 92,
    yieldMin: 1,
    yieldMax: 3,
  },
  iron: {
    enabled: true,
    minDepth: 1,
    baseNodes: 5,
    nodesPerDepth: 1,
    capacityMin: 30,
    capacityMax: 68,
    yieldMin: 1,
    yieldMax: 2,
  },
  mana_crystal: {
    enabled: true,
    minDepth: 2,
    baseNodes: 2,
    nodesPerDepth: 1,
    capacityMin: 10,
    capacityMax: 28,
    yieldMin: 1,
    yieldMax: 2,
  },
  mithril: {
    enabled: true,
    minDepth: 4,
    baseNodes: 1,
    nodesPerDepth: 0,
    capacityMin: 8,
    capacityMax: 20,
    yieldMin: 1,
    yieldMax: 1,
  },
  adamantio: {
    enabled: true,
    minDepth: 6,
    baseNodes: 1,
    nodesPerDepth: 0,
    capacityMin: 6,
    capacityMax: 15,
    yieldMin: 1,
    yieldMax: 1,
  },
  embersteel: {
    enabled: true,
    minDepth: 7,
    baseNodes: 1,
    nodesPerDepth: 0,
    capacityMin: 4,
    capacityMax: 11,
    yieldMin: 1,
    yieldMax: 1,
  },
  ironshade: {
    enabled: true,
    minDepth: 8,
    baseNodes: 1,
    nodesPerDepth: 0,
    capacityMin: 3,
    capacityMax: 9,
    yieldMin: 1,
    yieldMax: 1,
  },
};

const DEFAULT_RARE_DROPS = {
  mithril: {
    minDepth: 3,
    chance: 0.0038,
    amountMin: 1,
    amountMax: 1,
  },
  adamantio: {
    minDepth: 5,
    chance: 0.0028,
    amountMin: 1,
    amountMax: 1,
  },
  mana_crystal: {
    minDepth: 2,
    chance: 0.0045,
    amountMin: 1,
    amountMax: 2,
  },
  embersteel: {
    minDepth: 7,
    chance: 0.0022,
    amountMin: 1,
    amountMax: 1,
  },
  ironshade: {
    minDepth: 8,
    chance: 0.0018,
    amountMin: 1,
    amountMax: 1,
  },
};

const DEFAULT_FACTIONS = {
  gloomfang_brood: {
    label: 'Gloomfang Brood',
    weight: 1,
  },
  basalt_reavers: {
    label: 'Basalt Reavers',
    weight: 1,
  },
  shardbound_heresy: {
    label: 'Shardbound Heresy',
    weight: 0.7,
  },
};

const DEFAULT_SHRINE_SETTINGS = {
  enabled: true,
  ward: {
    enabled: true,
    chargeInterval: 20,
    chargeBase: 0,
    chargePerShrine: 0.9,
    chargePerGuard: 0.22,
    maxChargesPerDepth: 8,
    consumeOnRaidStart: 2,
    consumeMaxPerRaid: 4,
    strengthReductionPerCharge: 0.08,
    lossReductionPerCharge: 0.12,
    resourceCostPerCharge: {
      stone: 3,
      mana_crystal: 1,
    },
  },
  oath: {
    enabled: true,
    tickInterval: 42,
    minShrinesPerDepth: 1,
    minCrew: 3,
    durationTicks: 130,
    failurePenaltyTicks: 80,
    explorationMultiplier: 1.3,
    failureExplorationMultiplier: 0.85,
    moraleTickBonus: 0.004,
    stressTickReduction: 0.006,
    failureMoraleTickPenalty: 0.006,
    ritualCost: {
      beer: 8,
      mana_crystal: 1,
      stone: 6,
    },
  },
  prospection: {
    enabled: true,
    requiresShrine: true,
    minerBonusPerUnit: 0.03,
    guardBonusPerUnit: 0.015,
    riftDrop: {
      resource: 'void_shard',
      minDepth: 3,
      chance: 0.02,
      amountMin: 1,
      amountMax: 2,
    },
    magmaDrop: {
      resource: 'ember_resin',
      minDepth: 4,
      chance: 0.022,
      amountMin: 1,
      amountMax: 2,
    },
  },
};

const UNDERREALM_FLOOR_STATE_SET = new Set(['locked', 'accessible', 'contested', 'cleared']);

// Resolve one schism-driven Underrealm multiplier with bounded damping.
function resolveSchismUnderrealmMultiplier(
  state,
  key,
  {
    boostScale = 0.65,
    penaltyScale = 0.85,
    min = 0.25,
    max = 2,
  } = {},
) {
  const raw = Math.max(0.1, Number(getSchismModifier(state, key, 1) || 1));
  let adjusted = 1;
  if (raw >= 1) {
    adjusted = 1 + (raw - 1) * Math.max(0, Number(boostScale || 0));
  } else {
    adjusted = 1 - (1 - raw) * Math.max(0, Number(penaltyScale || 0));
  }
  return clamp(adjusted, Math.max(0.05, Number(min || 0.25)), Math.max(0.1, Number(max || 2)));
}

// Tick all Underrealm systems: crew assignment, economy, exploration, and hostiles.
function updateUnderrealm(state, config) {
  const underrealm = state && state.underrealm;
  if (!underrealm || underrealm.enabled === false) {
    clearAllUnderrealmDuty(state);
    return;
  }
  ensureUnderrealmRuntimeState(state, config);
  updateUnderrealmDiscovery(state, config);
  updateUnderrealmCombatRuntime(state, config);
  updateUnderrealmChampionAutoPromotion(state, config);
  updateCrewAssignments(state, config);
  updateUnderrealmShrines(state, config);
  updateUnderrealmEconomy(state, config);
  updateUnderrealmProgression(state, config);
  updateUnderrealmHostiles(state, config);
}

// Normalize combat floor state while respecting unlock status.
function normalizeUnderrealmCombatFloorState(rawState, unlocked) {
  const fallback = unlocked ? 'accessible' : 'locked';
  if (typeof rawState !== 'string' || !UNDERREALM_FLOOR_STATE_SET.has(rawState)) {
    return fallback;
  }
  if (!unlocked) {
    return 'locked';
  }
  if (rawState === 'locked') {
    return 'accessible';
  }
  return rawState;
}

// Build fallback combat scaffolding for a depth when state is missing.
function createFallbackUnderrealmCombatFloor(depth, maxUnlockedDepth) {
  const unlocked = depth <= maxUnlockedDepth;
  return {
    depth,
    unlocked,
    state: unlocked ? 'accessible' : 'locked',
    minArmoryLevel: 1,
    readiness: {
      minScore: 0,
      recommendedScore: 0,
    },
    champion: {
      enabled: true,
      id: `under_champion_${depth}`,
      label: `Depth Champion D${depth}`,
      stats: {
        hp: 100,
        attack: 10,
        defense: 8,
        penetration: 0.05,
      },
    },
    encounter: {
      active: false,
      attempts: 0,
      victories: 0,
      defeats: 0,
      retreats: 0,
      lastOutcome: null,
      lastOutcomeTick: 0,
      cooldownTicksRemaining: 0,
    },
    unlock: {
      required: true,
      cleared: false,
      unlocksDepthOnWin: depth + 1,
    },
  };
}

// Return normalized combat progression mode.
function getUnderrealmCombatProgressionMode(combat) {
  return String(
    combat && typeof combat.progressionMode === 'string'
      ? combat.progressionMode
      : 'champion_gate',
  );
}

// Tick per-floor combat runtime flags and encounter cooldowns.
function updateUnderrealmCombatRuntime(state, config) {
  const underrealm = state && state.underrealm;
  const combat = underrealm && underrealm.combat;
  if (!underrealm || !combat || combat.enabled === false) {
    return;
  }
  const maxDepth = Math.max(0, Math.floor(Number(underrealm.maxDepth || 0)));
  const maxUnlockedDepth = Math.max(0, Math.floor(Number(underrealm.maxUnlockedDepth || 0)));
  const mode = getUnderrealmCombatProgressionMode(combat);
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const floor = resolveUnderrealmCombatFloor(combat, depth, maxUnlockedDepth);
    if (!floor) {
      continue;
    }
    floor.depth = depth;
    floor.unlocked = depth <= maxUnlockedDepth;
    floor.state = normalizeUnderrealmCombatFloorState(floor.state, floor.unlocked);
    floor.unlock = floor.unlock && typeof floor.unlock === 'object'
      ? floor.unlock
      : {};
    floor.unlock.required = floor.unlock.required !== false;
    floor.unlock.cleared = floor.unlock.cleared === true;
    floor.unlock.unlocksDepthOnWin = Math.max(
      depth + 1,
      Math.floor(Number(floor.unlock.unlocksDepthOnWin || depth + 1)),
    );
    floor.encounter = floor.encounter && typeof floor.encounter === 'object'
      ? floor.encounter
      : {};
    floor.encounter.active = floor.encounter.active === true;
    floor.encounter.attempts = Math.max(0, Math.floor(Number(floor.encounter.attempts || 0)));
    floor.encounter.victories = Math.max(0, Math.floor(Number(floor.encounter.victories || 0)));
    floor.encounter.defeats = Math.max(0, Math.floor(Number(floor.encounter.defeats || 0)));
    floor.encounter.retreats = Math.max(0, Math.floor(Number(floor.encounter.retreats || 0)));
    floor.encounter.lastOutcome = typeof floor.encounter.lastOutcome === 'string'
      ? floor.encounter.lastOutcome
      : null;
    floor.encounter.lastOutcomeTick = Math.max(
      0,
      Math.floor(Number(floor.encounter.lastOutcomeTick || 0)),
    );
    floor.encounter.cooldownTicksRemaining = Math.max(
      0,
      Math.floor(Number(floor.encounter.cooldownTicksRemaining || 0)),
    );
    if (floor.encounter.cooldownTicksRemaining > 0) {
      floor.encounter.cooldownTicksRemaining -= 1;
    }
    if (floor.unlock.cleared === true || floor.state === 'cleared') {
      floor.unlock.cleared = true;
      floor.state = 'cleared';
      floor.encounter.active = false;
      continue;
    }
    if (!floor.unlocked) {
      floor.state = 'locked';
      floor.encounter.active = false;
      continue;
    }
    if (mode === 'champion_gate' && floor.unlock.required === true && floor.state === 'locked') {
      floor.state = 'accessible';
    }
  }
}

// Resolve the Underrealm root config with safe defaults.
function getUnderrealmConfig(config) {
  return (config && config.underrealm) || {};
}

// Resolve underrealm discovery gate config with defaults.
function getUnderrealmDiscoveryConfig(config) {
  const underrealm = getUnderrealmConfig(config);
  const discovery = underrealm.discovery || {};
  const minTick = Math.max(0, Math.floor(Number(discovery.min_tick ?? 140)));
  const maxTick = Math.max(minTick, Math.floor(Number(discovery.max_tick ?? 340)));
  const populationMin = Math.max(
    1,
    Math.floor(Number(discovery.population_min_for_timer ?? 100)),
  );
  const populationMax = Math.max(
    populationMin,
    Math.floor(Number(discovery.population_max_for_timer ?? 150)),
  );
  return {
    enabled: discovery.enabled !== false,
    minTick,
    maxTick,
    populationMin,
    populationMax,
  };
}

// Resolve underrealm progression config with defaults.
function getUnderrealmProgressionConfig(config) {
  const underrealm = getUnderrealmConfig(config);
  const progression = underrealm.progression || {};
  return {
    enabled: progression.enabled !== false,
    requiredSurveyRatio: clamp(Number(progression.required_survey_ratio ?? 1), 0, 1),
    minFrontierMiners: Math.max(0, Math.floor(Number(progression.min_frontier_miners ?? 1))),
    requireNoActiveRaid: progression.require_no_active_raid !== false,
    buildTicksBase: Math.max(1, Math.floor(Number(progression.build_ticks_base ?? 110))),
    buildTicksPerDepth: Math.max(0, Math.floor(Number(progression.build_ticks_per_depth ?? 65))),
    stockpileCostBase: normalizeCostMap(progression.stockpile_cost_base, {
      stone: 26,
      iron: 8,
    }),
    stockpileCostPerDepth: normalizeCostMap(progression.stockpile_cost_per_depth, {
      stone: 14,
      iron: 6,
    }),
    minedCostBase: normalizeCostMap(progression.mined_cost_base, {
      stone: 30,
      iron: 10,
    }),
    minedCostPerDepth: normalizeCostMap(progression.mined_cost_per_depth, {
      stone: 18,
      iron: 8,
    }),
  };
}

// Resolve economy config with defaults.
function getUnderrealmEconomyConfig(config) {
  const underrealm = getUnderrealmConfig(config);
  const economy = underrealm.economy || {};
  return {
    enabled: economy.enabled !== false,
    tickInterval: Math.max(1, Math.floor(Number(economy.tick_interval ?? 6))),
    nodeRegenInterval: Math.max(1, Math.floor(Number(economy.node_regen_interval ?? 30))),
    nodeRegenRatio: clamp(Number(economy.node_regen_ratio ?? 0.02), 0, 1),
    gatherEfficiencyPerHauler: clamp(Number(economy.gather_efficiency_per_hauler ?? 0.35), 0, 2),
    depthOutputBonus: Math.max(0, Number(economy.depth_output_bonus ?? 0.08)),
    rareDropGuardBonus: Math.max(0, Number(economy.rare_drop_guard_bonus ?? 0.02)),
    explorationPerMiner: Math.max(0, Number(economy.exploration_progress_per_miner ?? 0.85)),
    explorationPerGuard: Math.max(0, Number(economy.exploration_progress_per_guard ?? 0.35)),
    unlockThresholdBase: Math.max(1, Math.floor(Number(economy.unlock_threshold_base ?? 95))),
    unlockThresholdPerDepth: Math.max(0, Math.floor(Number(economy.unlock_threshold_per_depth ?? 65))),
    nodeTemplates: normalizeNodeTemplates(economy.nodes),
    rareDrops: normalizeRareDrops(economy.rare_drops),
  };
}

// Resolve hostile deep-faction config with defaults.
function getUnderrealmHostileConfig(config) {
  const underrealm = getUnderrealmConfig(config);
  const hostiles = underrealm.hostiles || {};
  return {
    enabled: hostiles.enabled !== false,
    checkInterval: Math.max(1, Math.floor(Number(hostiles.check_interval ?? 16))),
    minCrewForSpawn: Math.max(1, Math.floor(Number(hostiles.min_crew_for_spawn ?? 2))),
    spawnChanceBase: clamp(Number(hostiles.base_spawn_chance ?? 0.015), 0, 1),
    spawnChancePerDepth: clamp(Number(hostiles.spawn_chance_per_depth ?? 0.012), 0, 1),
    raidDurationBase: Math.max(1, Math.floor(Number(hostiles.raid_duration_base ?? 30))),
    raidDurationPerDepth: Math.max(0, Math.floor(Number(hostiles.raid_duration_per_depth ?? 8))),
    strengthBase: Math.max(0, Number(hostiles.strength_base ?? 0.16)),
    strengthPerDepth: Math.max(0, Number(hostiles.strength_per_depth ?? 0.07)),
    casualtyRate: clamp(Number(hostiles.casualty_rate ?? 0.08), 0, 1),
    casualtySeverity: clamp(Number(hostiles.casualty_severity ?? 0.25), 0, 1),
    guardMitigationPerGuard: clamp(Number(hostiles.guard_mitigation_per_guard ?? 0.04), 0, 1),
    stockpileLossBase: clamp(Number(hostiles.stockpile_loss_ratio_base ?? 0.015), 0, 1),
    stockpileLossPerDepth: clamp(Number(hostiles.stockpile_loss_ratio_per_depth ?? 0.008), 0, 1),
    stockpileLossTickInterval: Math.max(1, Math.floor(Number(hostiles.stockpile_loss_tick_interval ?? 6))),
    cooldownTicks: Math.max(0, Math.floor(Number(hostiles.cooldown_ticks ?? 90))),
    factions: normalizeFactions(hostiles.factions),
    lossWeights: normalizeLossWeights(hostiles.stockpile_loss_weights),
  };
}

// Resolve shrine systems config with defaults.
function getUnderrealmShrineConfig(config) {
  const underrealm = getUnderrealmConfig(config);
  const shrines = (underrealm && underrealm.shrines) || {};
  const ward = shrines.ward || {};
  const oath = shrines.oath || {};
  const prospection = shrines.prospection || {};
  const wardDefaults = DEFAULT_SHRINE_SETTINGS.ward;
  const oathDefaults = DEFAULT_SHRINE_SETTINGS.oath;
  const prospectionDefaults = DEFAULT_SHRINE_SETTINGS.prospection;
  const riftDrop = prospection.rift_drop || {};
  const magmaDrop = prospection.magma_drop || {};
  const riftDefaults = prospectionDefaults.riftDrop;
  const magmaDefaults = prospectionDefaults.magmaDrop;
  return {
    enabled: shrines.enabled !== false && DEFAULT_SHRINE_SETTINGS.enabled !== false,
    ward: {
      enabled: ward.enabled !== false && wardDefaults.enabled !== false,
      chargeInterval: Math.max(
        1,
        Math.floor(Number(ward.charge_interval ?? wardDefaults.chargeInterval)),
      ),
      chargeBase: Math.max(0, Number(ward.charge_base ?? wardDefaults.chargeBase)),
      chargePerShrine: Math.max(
        0,
        Number(ward.charge_per_shrine ?? wardDefaults.chargePerShrine),
      ),
      chargePerGuard: Math.max(
        0,
        Number(ward.charge_per_guard ?? wardDefaults.chargePerGuard),
      ),
      maxChargesPerDepth: Math.max(
        0,
        Math.floor(Number(ward.max_charges_per_depth ?? wardDefaults.maxChargesPerDepth)),
      ),
      consumeOnRaidStart: Math.max(
        0,
        Math.floor(Number(ward.consume_on_raid_start ?? wardDefaults.consumeOnRaidStart)),
      ),
      consumeMaxPerRaid: Math.max(
        0,
        Math.floor(Number(ward.consume_max_per_raid ?? wardDefaults.consumeMaxPerRaid)),
      ),
      strengthReductionPerCharge: clamp(
        Number(
          ward.strength_reduction_per_charge ?? wardDefaults.strengthReductionPerCharge,
        ),
        0,
        0.9,
      ),
      lossReductionPerCharge: clamp(
        Number(ward.loss_reduction_per_charge ?? wardDefaults.lossReductionPerCharge),
        0,
        0.95,
      ),
      resourceCostPerCharge: normalizeCostMap(
        ward.resource_cost_per_charge,
        wardDefaults.resourceCostPerCharge,
      ),
    },
    oath: {
      enabled: oath.enabled !== false && oathDefaults.enabled !== false,
      tickInterval: Math.max(
        1,
        Math.floor(Number(oath.tick_interval ?? oathDefaults.tickInterval)),
      ),
      minShrinesPerDepth: Math.max(
        0,
        Math.floor(Number(oath.min_shrines_per_depth ?? oathDefaults.minShrinesPerDepth)),
      ),
      minCrew: Math.max(0, Math.floor(Number(oath.min_crew ?? oathDefaults.minCrew))),
      durationTicks: Math.max(
        1,
        Math.floor(Number(oath.duration_ticks ?? oathDefaults.durationTicks)),
      ),
      failurePenaltyTicks: Math.max(
        0,
        Math.floor(
          Number(oath.failure_penalty_ticks ?? oathDefaults.failurePenaltyTicks),
        ),
      ),
      explorationMultiplier: clamp(
        Number(
          oath.exploration_multiplier ?? oathDefaults.explorationMultiplier,
        ),
        0.1,
        5,
      ),
      failureExplorationMultiplier: clamp(
        Number(
          oath.failure_exploration_multiplier ?? oathDefaults.failureExplorationMultiplier,
        ),
        0.1,
        5,
      ),
      moraleTickBonus: clamp(
        Number(oath.morale_tick_bonus ?? oathDefaults.moraleTickBonus),
        0,
        0.05,
      ),
      stressTickReduction: clamp(
        Number(oath.stress_tick_reduction ?? oathDefaults.stressTickReduction),
        0,
        0.05,
      ),
      failureMoraleTickPenalty: clamp(
        Number(
          oath.failure_morale_tick_penalty ?? oathDefaults.failureMoraleTickPenalty,
        ),
        0,
        0.05,
      ),
      ritualCost: normalizeCostMap(oath.ritual_cost, oathDefaults.ritualCost),
    },
    prospection: {
      enabled: prospection.enabled !== false && prospectionDefaults.enabled !== false,
      requiresShrine: prospection.requires_shrine !== false
        && prospectionDefaults.requiresShrine !== false,
      minerBonusPerUnit: clamp(
        Number(
          prospection.miner_bonus_per_unit ?? prospectionDefaults.minerBonusPerUnit,
        ),
        0,
        1,
      ),
      guardBonusPerUnit: clamp(
        Number(
          prospection.guard_bonus_per_unit ?? prospectionDefaults.guardBonusPerUnit,
        ),
        0,
        1,
      ),
      riftDrop: {
        resource: String(riftDrop.resource || riftDefaults.resource),
        minDepth: Math.max(
          1,
          Math.floor(Number(riftDrop.min_depth ?? riftDefaults.minDepth)),
        ),
        chance: clamp(Number(riftDrop.chance ?? riftDefaults.chance), 0, 1),
        amountMin: Math.max(
          1,
          Math.floor(Number(riftDrop.amount_min ?? riftDefaults.amountMin)),
        ),
        amountMax: Math.max(
          1,
          Math.floor(Number(riftDrop.amount_max ?? riftDefaults.amountMax)),
        ),
      },
      magmaDrop: {
        resource: String(magmaDrop.resource || magmaDefaults.resource),
        minDepth: Math.max(
          1,
          Math.floor(Number(magmaDrop.min_depth ?? magmaDefaults.minDepth)),
        ),
        chance: clamp(Number(magmaDrop.chance ?? magmaDefaults.chance), 0, 1),
        amountMin: Math.max(
          1,
          Math.floor(Number(magmaDrop.amount_min ?? magmaDefaults.amountMin)),
        ),
        amountMax: Math.max(
          1,
          Math.floor(Number(magmaDrop.amount_max ?? magmaDefaults.amountMax)),
        ),
      },
    },
  };
}

// Normalize one optional per-depth counter map to non-negative integer values.
function normalizeUnderrealmDepthCounterMap(rawMap) {
  const source = rawMap && typeof rawMap === 'object' ? rawMap : {};
  const normalized = {};
  for (const [depthRaw, valueRaw] of Object.entries(source)) {
    const depth = Math.max(1, Math.floor(Number(depthRaw || 0)));
    if (!Number.isFinite(depth) || depth <= 0) {
      continue;
    }
    normalized[String(depth)] = Math.max(0, Math.floor(Number(valueRaw || 0)));
  }
  return normalized;
}

// Initialize or repair runtime fields used by Underrealm simulation.
function ensureUnderrealmRuntimeState(state, config) {
  const underrealm = state.underrealm;
  if (!underrealm.discovery || typeof underrealm.discovery !== 'object') {
    underrealm.discovery = {
      enabled: false,
      targetTick: 0,
      delayTicks: 0,
      timerStartedTick: null,
      populationThreshold: 100,
      found: Number(underrealm.maxUnlockedDepth || 0) > 0,
      foundTick: null,
      surfaceGate: null,
    };
  }
  if (!underrealm.lift || typeof underrealm.lift !== 'object') {
    underrealm.lift = buildIdleLiftState();
  }
  underrealm.lift.progressRemainder = Math.max(
    0,
    Number(underrealm.lift.progressRemainder || 0),
  );
  if (!underrealm.economy) {
    underrealm.economy = {
      ticks: 0,
      totalGathered: {},
      totalRareDrops: {},
      unlockedDepths: 0,
    };
  }
  if (!underrealm.deepFaction) {
    underrealm.deepFaction = {
      activeRaidsByDepth: {},
      cooldownByDepth: {},
      stats: {
        raidsStarted: 0,
        raidsResolved: 0,
        deaths: 0,
        losses: {},
      },
    };
  }
  if (!underrealm.shrines || typeof underrealm.shrines !== 'object') {
    underrealm.shrines = {
      wardChargesByDepth: {},
      oathByDepth: {},
      stats: {
        chargesCreated: 0,
        chargesSpent: 0,
        oathSuccesses: 0,
        oathFailures: 0,
        prospectionFinds: {},
      },
    };
  }
  underrealm.shrines.wardChargesByDepth = underrealm.shrines.wardChargesByDepth || {};
  underrealm.shrines.oathByDepth = underrealm.shrines.oathByDepth || {};
  if (!underrealm.shrines.stats || typeof underrealm.shrines.stats !== 'object') {
    underrealm.shrines.stats = {
      chargesCreated: 0,
      chargesSpent: 0,
      oathSuccesses: 0,
      oathFailures: 0,
      prospectionFinds: {},
    };
  }
  underrealm.shrines.stats.prospectionFinds = underrealm.shrines.stats.prospectionFinds || {};
  if (!underrealm.combat || typeof underrealm.combat !== 'object') {
    underrealm.combat = {
      enabled: true,
      progressionMode: 'champion_gate',
      readiness: {
        hardMinGate: true,
        warningZoneRiskMultiplier: 1.2,
        warningZoneHardGuard: {
          enabled: true,
          minDepth: 3,
          minRecommendedScoreRatio: 0.99,
        },
        scoreWeights: {
          offense: 1,
          defense: 1,
          support: 0.8,
        },
        formula: {
          weaponAvgTierScale: 6,
          armorAvgTierScale: 6,
          supportKitFullScale: 8,
          supportArmoryLevelScale: 1,
        },
      },
      encounter: {
        roundsBase: 4,
        roundsPerDepth: 1,
        retryCooldownTicksBase: 90,
        retryCooldownTicksPerDepth: 30,
      },
      dwarfChampion: {
        enabled: true,
        minSurvivals: 1,
        attackBonusRatio: 0.18,
        defenseBonusRatio: 0.16,
        autoPromotion: {
          enabled: true,
          minUnlockedDepth: 1,
          minSurvivals: 0,
        },
        readinessScoreBonusBase: 4,
        readinessScoreBonusPerSurvival: 1.5,
        readinessScoreBonusCap: 10,
        retryCooldownReductionBase: 0.25,
        retryCooldownReductionPerSurvival: 0.05,
        retryCooldownReductionCap: 0.55,
        championHpReductionBase: 0.12,
        championHpReductionPerSurvival: 0.03,
        championHpReductionCap: 0.35,
        championRoundBonusBase: 1,
        championRoundBonusPerSurvival: 0.5,
        championRoundBonusCap: 3,
        frontierExplorationBonusBase: 1,
        frontierExplorationBonusPerSurvival: 0.12,
        frontierExplorationBonusCap: 1.5,
        liftBuildSpeedBonusBase: 1,
        liftBuildSpeedBonusPerSurvival: 0.12,
        liftBuildSpeedBonusCap: 1.5,
        requiresPartyPresence: false,
        activeDwarfId: null,
        activeSinceTick: 0,
        promotions: 0,
        losses: 0,
      },
      floorsByDepth: {},
      stats: {
        championsDefeated: 0,
        failedExpeditions: 0,
        blockedDispatches: 0,
        hardGuardBlocks: 0,
        warningDispatches: 0,
        cooldownEscalations: 0,
        hardGuardBlocksByDepth: {},
        warningDispatchesByDepth: {},
        cooldownEscalationsByDepth: {},
      },
    };
  }
  underrealm.combat.floorsByDepth = underrealm.combat.floorsByDepth || {};
  underrealm.combat.stats = underrealm.combat.stats || {};
  underrealm.combat.stats.championsDefeated = Math.max(
    0,
    Math.floor(Number(underrealm.combat.stats.championsDefeated || 0)),
  );
  underrealm.combat.stats.failedExpeditions = Math.max(
    0,
    Math.floor(Number(underrealm.combat.stats.failedExpeditions || 0)),
  );
  underrealm.combat.stats.blockedDispatches = Math.max(
    0,
    Math.floor(Number(underrealm.combat.stats.blockedDispatches || 0)),
  );
  underrealm.combat.stats.hardGuardBlocks = Math.max(
    0,
    Math.floor(Number(underrealm.combat.stats.hardGuardBlocks || 0)),
  );
  underrealm.combat.stats.warningDispatches = Math.max(
    0,
    Math.floor(Number(underrealm.combat.stats.warningDispatches || 0)),
  );
  underrealm.combat.stats.cooldownEscalations = Math.max(
    0,
    Math.floor(Number(underrealm.combat.stats.cooldownEscalations || 0)),
  );
  underrealm.combat.stats.hardGuardBlocksByDepth = normalizeUnderrealmDepthCounterMap(
    underrealm.combat.stats.hardGuardBlocksByDepth,
  );
  underrealm.combat.stats.warningDispatchesByDepth = normalizeUnderrealmDepthCounterMap(
    underrealm.combat.stats.warningDispatchesByDepth,
  );
  underrealm.combat.stats.cooldownEscalationsByDepth = normalizeUnderrealmDepthCounterMap(
    underrealm.combat.stats.cooldownEscalationsByDepth,
  );
  underrealm.combat.readiness = underrealm.combat.readiness || {};
  underrealm.combat.readiness.warningZoneHardGuard = (
    underrealm.combat.readiness.warningZoneHardGuard
    && typeof underrealm.combat.readiness.warningZoneHardGuard === 'object'
  )
    ? underrealm.combat.readiness.warningZoneHardGuard
    : {};
  underrealm.combat.readiness.scoreWeights = underrealm.combat.readiness.scoreWeights || {};
  underrealm.combat.readiness.formula = underrealm.combat.readiness.formula || {};
  underrealm.combat.readiness.hardMinGate = underrealm.combat.readiness.hardMinGate !== false;
  underrealm.combat.readiness.warningZoneRiskMultiplier = Math.max(
    1,
    Number(underrealm.combat.readiness.warningZoneRiskMultiplier ?? 1.2),
  );
  underrealm.combat.readiness.warningZoneHardGuard.enabled =
    underrealm.combat.readiness.warningZoneHardGuard.enabled !== false;
  underrealm.combat.readiness.warningZoneHardGuard.minDepth = Math.max(
    1,
    Math.floor(Number(underrealm.combat.readiness.warningZoneHardGuard.minDepth ?? 3)),
  );
  underrealm.combat.readiness.warningZoneHardGuard.minRecommendedScoreRatio = clamp(
    Number(underrealm.combat.readiness.warningZoneHardGuard.minRecommendedScoreRatio ?? 0.99),
    0,
    1,
  );
  underrealm.combat.readiness.scoreWeights.offense = Math.max(
    0,
    Number(underrealm.combat.readiness.scoreWeights.offense ?? 1),
  );
  underrealm.combat.readiness.scoreWeights.defense = Math.max(
    0,
    Number(underrealm.combat.readiness.scoreWeights.defense ?? 1),
  );
  underrealm.combat.readiness.scoreWeights.support = Math.max(
    0,
    Number(underrealm.combat.readiness.scoreWeights.support ?? 0.8),
  );
  underrealm.combat.readiness.formula.weaponAvgTierScale = Math.max(
    0,
    Number(underrealm.combat.readiness.formula.weaponAvgTierScale ?? 6),
  );
  underrealm.combat.readiness.formula.armorAvgTierScale = Math.max(
    0,
    Number(underrealm.combat.readiness.formula.armorAvgTierScale ?? 6),
  );
  underrealm.combat.readiness.formula.supportKitFullScale = Math.max(
    0,
    Number(underrealm.combat.readiness.formula.supportKitFullScale ?? 8),
  );
  underrealm.combat.readiness.formula.supportArmoryLevelScale = Math.max(
    0,
    Number(underrealm.combat.readiness.formula.supportArmoryLevelScale ?? 1),
  );
  underrealm.combat.dwarfChampion = underrealm.combat.dwarfChampion || {};
  underrealm.combat.dwarfChampion.enabled = underrealm.combat.dwarfChampion.enabled !== false;
  underrealm.combat.dwarfChampion.minSurvivals = Math.max(
    1,
    Math.floor(Number(underrealm.combat.dwarfChampion.minSurvivals ?? 1)),
  );
  underrealm.combat.dwarfChampion.attackBonusRatio = clamp(
    Number(underrealm.combat.dwarfChampion.attackBonusRatio ?? 0.18),
    0,
    1,
  );
  underrealm.combat.dwarfChampion.defenseBonusRatio = clamp(
    Number(underrealm.combat.dwarfChampion.defenseBonusRatio ?? 0.16),
    0,
    1,
  );
  underrealm.combat.dwarfChampion.readinessScoreBonusBase = Math.max(
    0,
    Number(underrealm.combat.dwarfChampion.readinessScoreBonusBase ?? 4),
  );
  underrealm.combat.dwarfChampion.readinessScoreBonusPerSurvival = Math.max(
    0,
    Number(underrealm.combat.dwarfChampion.readinessScoreBonusPerSurvival ?? 1.5),
  );
  underrealm.combat.dwarfChampion.readinessScoreBonusCap = Math.max(
    0,
    Number(underrealm.combat.dwarfChampion.readinessScoreBonusCap ?? 10),
  );
  underrealm.combat.dwarfChampion.retryCooldownReductionBase = clamp(
    Number(underrealm.combat.dwarfChampion.retryCooldownReductionBase ?? 0.25),
    0,
    0.95,
  );
  underrealm.combat.dwarfChampion.retryCooldownReductionPerSurvival = clamp(
    Number(underrealm.combat.dwarfChampion.retryCooldownReductionPerSurvival ?? 0.05),
    0,
    0.95,
  );
  underrealm.combat.dwarfChampion.retryCooldownReductionCap = clamp(
    Number(underrealm.combat.dwarfChampion.retryCooldownReductionCap ?? 0.55),
    0,
    0.95,
  );
  underrealm.combat.dwarfChampion.championHpReductionBase = clamp(
    Number(underrealm.combat.dwarfChampion.championHpReductionBase ?? 0.12),
    0,
    0.95,
  );
  underrealm.combat.dwarfChampion.championHpReductionPerSurvival = clamp(
    Number(underrealm.combat.dwarfChampion.championHpReductionPerSurvival ?? 0.03),
    0,
    0.95,
  );
  underrealm.combat.dwarfChampion.championHpReductionCap = clamp(
    Number(underrealm.combat.dwarfChampion.championHpReductionCap ?? 0.35),
    0,
    0.95,
  );
  underrealm.combat.dwarfChampion.championRoundBonusBase = Math.max(
    0,
    Number(underrealm.combat.dwarfChampion.championRoundBonusBase ?? 1),
  );
  underrealm.combat.dwarfChampion.championRoundBonusPerSurvival = Math.max(
    0,
    Number(underrealm.combat.dwarfChampion.championRoundBonusPerSurvival ?? 0.5),
  );
  underrealm.combat.dwarfChampion.championRoundBonusCap = Math.max(
    0,
    Number(underrealm.combat.dwarfChampion.championRoundBonusCap ?? 3),
  );
  underrealm.combat.dwarfChampion.frontierExplorationBonusBase = Math.max(
    0,
    Number(underrealm.combat.dwarfChampion.frontierExplorationBonusBase ?? 1),
  );
  underrealm.combat.dwarfChampion.frontierExplorationBonusPerSurvival = Math.max(
    0,
    Number(underrealm.combat.dwarfChampion.frontierExplorationBonusPerSurvival ?? 0.12),
  );
  underrealm.combat.dwarfChampion.frontierExplorationBonusCap = Math.max(
    0,
    Number(underrealm.combat.dwarfChampion.frontierExplorationBonusCap ?? 1.5),
  );
  underrealm.combat.dwarfChampion.liftBuildSpeedBonusBase = Math.max(
    0,
    Number(underrealm.combat.dwarfChampion.liftBuildSpeedBonusBase ?? 1),
  );
  underrealm.combat.dwarfChampion.liftBuildSpeedBonusPerSurvival = Math.max(
    0,
    Number(underrealm.combat.dwarfChampion.liftBuildSpeedBonusPerSurvival ?? 0.12),
  );
  underrealm.combat.dwarfChampion.liftBuildSpeedBonusCap = Math.max(
    0,
    Number(underrealm.combat.dwarfChampion.liftBuildSpeedBonusCap ?? 1.5),
  );
  underrealm.combat.dwarfChampion.requiresPartyPresence =
    underrealm.combat.dwarfChampion.requiresPartyPresence === true;
  underrealm.combat.dwarfChampion.autoPromotion = (
    underrealm.combat.dwarfChampion.autoPromotion
    && typeof underrealm.combat.dwarfChampion.autoPromotion === 'object'
  )
    ? underrealm.combat.dwarfChampion.autoPromotion
    : {};
  underrealm.combat.dwarfChampion.autoPromotion.enabled =
    underrealm.combat.dwarfChampion.autoPromotion.enabled !== false;
  underrealm.combat.dwarfChampion.autoPromotion.minUnlockedDepth = Math.max(
    1,
    Math.floor(Number(underrealm.combat.dwarfChampion.autoPromotion.minUnlockedDepth ?? 1)),
  );
  underrealm.combat.dwarfChampion.autoPromotion.minSurvivals = Math.max(
    0,
    Math.floor(Number(underrealm.combat.dwarfChampion.autoPromotion.minSurvivals ?? 0)),
  );
  underrealm.combat.dwarfChampion.activeDwarfId =
    typeof underrealm.combat.dwarfChampion.activeDwarfId === 'string'
      ? underrealm.combat.dwarfChampion.activeDwarfId
      : null;
  underrealm.combat.dwarfChampion.activeSinceTick = Math.max(
    0,
    Math.floor(Number(underrealm.combat.dwarfChampion.activeSinceTick || 0)),
  );
  underrealm.combat.dwarfChampion.promotions = Math.max(
    0,
    Math.floor(Number(underrealm.combat.dwarfChampion.promotions || 0)),
  );
  underrealm.combat.dwarfChampion.losses = Math.max(
    0,
    Math.floor(Number(underrealm.combat.dwarfChampion.losses || 0)),
  );
  const aliveDwarfIds = new Set(
    Array.isArray(state.dwarves)
      ? state.dwarves.map((dwarf) => String(dwarf && dwarf.id || ''))
      : [],
  );
  if (
    underrealm.combat.dwarfChampion.activeDwarfId
    && !aliveDwarfIds.has(underrealm.combat.dwarfChampion.activeDwarfId)
  ) {
    const fallenChampionId = String(underrealm.combat.dwarfChampion.activeDwarfId || '');
    underrealm.combat.dwarfChampion.activeDwarfId = null;
    underrealm.combat.dwarfChampion.activeSinceTick = 0;
    underrealm.combat.dwarfChampion.losses = Math.max(
      0,
      Math.floor(Number(underrealm.combat.dwarfChampion.losses || 0)),
    ) + 1;
    if (fallenChampionId) {
      pushEvent(state, config, `Underrealm: Dwarf Champion ${fallenChampionId} has fallen`);
    }
  }
  for (const dwarf of Array.isArray(state.dwarves) ? state.dwarves : []) {
    dwarf.underrealmChampionSurvivals = Math.max(
      0,
      Math.floor(Number(dwarf && dwarf.underrealmChampionSurvivals || 0)),
    );
  }
  const maxDepth = Math.max(0, Math.floor(Number(underrealm.maxDepth || 0)));
  const maxUnlockedDepth = Math.max(0, Math.floor(Number(underrealm.maxUnlockedDepth || 0)));
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const depthKey = String(depth);
    const fallback = createFallbackUnderrealmCombatFloor(depth, maxUnlockedDepth);
    const currentFloor = underrealm.combat.floorsByDepth[depthKey];
    const normalizedFloor = currentFloor && typeof currentFloor === 'object'
      ? currentFloor
      : fallback;
    normalizedFloor.depth = depth;
    normalizedFloor.unlocked = depth <= maxUnlockedDepth;
    normalizedFloor.state = normalizeUnderrealmCombatFloorState(
      normalizedFloor.state,
      normalizedFloor.unlocked,
    );
    underrealm.combat.floorsByDepth[depthKey] = normalizedFloor;
  }
  for (const layer of underrealm.layers || []) {
    const depth = Math.max(1, Math.floor(Number(layer && layer.depth || 0)));
    const depthKey = String(depth);
    if (!underrealm.combat.floorsByDepth[depthKey]) {
      underrealm.combat.floorsByDepth[depthKey] = createFallbackUnderrealmCombatFloor(
        depth,
        maxUnlockedDepth,
      );
    }
    layer.combat = underrealm.combat.floorsByDepth[depthKey];
  }
  if (!underrealm.crew || underrealm.crew.enabled === false) {
    clearAllUnderrealmDuty(state);
    return;
  }
  underrealm.crew.assignedByDepth = underrealm.crew.assignedByDepth || {};
  underrealm.crew.rolesByDepth = underrealm.crew.rolesByDepth || {};
  underrealm.crew.membersByDepth = underrealm.crew.membersByDepth || {};
  if (!Number.isFinite(underrealm.crew.populationBonusPerAssigned)) {
    underrealm.crew.populationBonusPerAssigned = 0;
  }
}

// Sort Dwarf Champion candidates deterministically by survivals, spawn order, and id.
function compareUnderrealmDwarfChampionCandidates(left, right) {
  const leftSurvivals = Math.max(0, Math.floor(Number(left && left.underrealmChampionSurvivals || 0)));
  const rightSurvivals = Math.max(0, Math.floor(Number(right && right.underrealmChampionSurvivals || 0)));
  if (rightSurvivals !== leftSurvivals) {
    return rightSurvivals - leftSurvivals;
  }
  const leftAge = Math.max(0, Math.floor(Number(left && left.ageTicks || 0)));
  const rightAge = Math.max(0, Math.floor(Number(right && right.ageTicks || 0)));
  if (leftAge !== rightAge) {
    return leftAge - rightAge;
  }
  const leftSpawnIndex = Math.max(0, Math.floor(Number(left && left.spawnIndex || 0)));
  const rightSpawnIndex = Math.max(0, Math.floor(Number(right && right.spawnIndex || 0)));
  if (leftSpawnIndex !== rightSpawnIndex) {
    return rightSpawnIndex - leftSpawnIndex;
  }
  return String(left && left.id || '').localeCompare(String(right && right.id || ''));
}

// Auto-promote one Dwarf Champion when slot is vacant and auto-promotion gates pass.
function updateUnderrealmChampionAutoPromotion(state, config) {
  const underrealm = state && state.underrealm;
  const combat = underrealm && underrealm.combat;
  const runtime = combat && combat.dwarfChampion;
  if (!underrealm || !combat || !runtime || runtime.enabled === false) {
    return;
  }
  if (runtime.activeDwarfId) {
    return;
  }
  const autoPromotion = runtime.autoPromotion && typeof runtime.autoPromotion === 'object'
    ? runtime.autoPromotion
    : null;
  if (!autoPromotion || autoPromotion.enabled === false) {
    return;
  }
  const unlockedDepth = Math.max(0, Math.floor(Number(underrealm.maxUnlockedDepth || 0)));
  const minUnlockedDepth = Math.max(1, Math.floor(Number(autoPromotion.minUnlockedDepth || 1)));
  if (unlockedDepth < minUnlockedDepth) {
    return;
  }
  const minSurvivals = Math.max(0, Math.floor(Number(autoPromotion.minSurvivals || 0)));
  const candidates = (Array.isArray(state.dwarves) ? state.dwarves : [])
    .filter((dwarf) => isAdult(dwarf, config))
    .filter((dwarf) => Number(dwarf && dwarf.underrealmChampionSurvivals || 0) >= minSurvivals)
    .sort(compareUnderrealmDwarfChampionCandidates);
  if (candidates.length === 0) {
    return;
  }
  const champion = candidates[0];
  runtime.activeDwarfId = champion.id;
  runtime.activeSinceTick = Math.max(0, Math.floor(Number(state.tick || 0)));
  runtime.promotions = Math.max(0, Math.floor(Number(runtime.promotions || 0))) + 1;
  const attackBonusPct = Math.round(clamp(Number(runtime.attackBonusRatio || 0), 0, 1) * 100);
  const defenseBonusPct = Math.round(clamp(Number(runtime.defenseBonusRatio || 0), 0, 1) * 100);
  pushEvent(
    state,
    config,
    `Underrealm: ${champion.id} appointed Dwarf Champion command (+${attackBonusPct}% atk, +${defenseBonusPct}% def)`,
  );
}

// Discover the first underrealm gate and unlock depth 1 when discovery time is reached.
function updateUnderrealmDiscovery(state, config) {
  const underrealm = state && state.underrealm;
  if (!underrealm || underrealm.enabled === false) {
    return;
  }
  const discoveryConfig = getUnderrealmDiscoveryConfig(config);
  const discovery = underrealm.discovery || {};
  discovery.enabled = discoveryConfig.enabled;
  if (!discovery.enabled) {
    if (Number(underrealm.maxUnlockedDepth || 0) > 0) {
      discovery.found = true;
    }
    underrealm.discovery = discovery;
    return;
  }
  if (discovery.found === true) {
    underrealm.discovery = discovery;
    return;
  }
  const populationThreshold = Math.max(
    1,
    Math.floor(
      Number(discovery.populationThreshold ?? discoveryConfig.populationMin),
    ),
  );
  const delayTicks = Math.max(
    0,
    Math.floor(Number(discovery.delayTicks ?? discoveryConfig.minTick)),
  );
  discovery.populationThreshold = populationThreshold;
  discovery.delayTicks = delayTicks;
  const totalPopulation = Array.isArray(state.dwarves) ? state.dwarves.length : 0;
  const hasTimerStarted = typeof discovery.timerStartedTick === 'number'
    && Number.isFinite(discovery.timerStartedTick);
  if (!hasTimerStarted) {
    if (totalPopulation < populationThreshold) {
      underrealm.discovery = discovery;
      return;
    }
    discovery.timerStartedTick = Math.max(0, Math.floor(Number(state.tick || 0)));
    discovery.targetTick = discovery.timerStartedTick + delayTicks;
    pushEvent(
      state,
      config,
      `Underrealm: gate rumors awaken as population reaches ${populationThreshold}`,
    );
  }
  const targetTick = Math.max(0, Math.floor(Number(discovery.targetTick || 0)));
  if (Number(state.tick || 0) < targetTick) {
    underrealm.discovery = discovery;
    return;
  }
  discovery.found = true;
  discovery.foundTick = Number(state.tick || 0);
  if (Number(underrealm.maxUnlockedDepth || 0) < 1) {
    underrealm.maxUnlockedDepth = 1;
    const layer = findUnderrealmLayer(underrealm, 1);
    if (layer) {
      layer.unlocked = true;
    }
  }
  underrealm.discovery = discovery;
  pushEvent(state, config, 'Underrealm: a hidden gate has been discovered');
}

// Manage depth unlock progression via Deep Lift projects.
function updateUnderrealmProgression(state, config) {
  const underrealm = state && state.underrealm;
  if (!underrealm || underrealm.enabled === false) {
    return;
  }
  const progressionConfig = getUnderrealmProgressionConfig(config);
  if (!progressionConfig.enabled) {
    return;
  }
  const maxDepth = Math.max(0, Math.floor(Number(underrealm.maxDepth || 0)));
  const unlockedDepth = Math.max(0, Math.floor(Number(underrealm.maxUnlockedDepth || 0)));
  if (unlockedDepth <= 0 || unlockedDepth >= maxDepth) {
    if (underrealm.lift && underrealm.lift.active) {
      underrealm.lift = buildIdleLiftState();
    }
    return;
  }
  const frontierDepth = unlockedDepth;
  const frontierLayer = findUnderrealmLayer(underrealm, frontierDepth);
  if (!frontierLayer || !frontierLayer.economy) {
    return;
  }
  const combat = underrealm.combat && typeof underrealm.combat === 'object'
    ? underrealm.combat
    : null;
  const progressionMode = getUnderrealmCombatProgressionMode(combat);
  const championGateEnabled = progressionMode === 'champion_gate'
    && combat
    && combat.enabled !== false;
  const frontierFloor = championGateEnabled
    ? resolveUnderrealmCombatFloor(combat, frontierDepth, underrealm.maxUnlockedDepth)
    : null;
  const championRequired = Boolean(
    frontierFloor
    && frontierFloor.unlocked === true
    && frontierFloor.unlock
    && frontierFloor.unlock.required === true
    && frontierFloor.champion
    && frontierFloor.champion.enabled !== false,
  );
  const frontierCleared = Boolean(
    frontierFloor
    && frontierFloor.unlock
    && frontierFloor.unlock.cleared === true,
  );
  if (championRequired && !frontierCleared && frontierFloor.state === 'contested') {
    underrealm.lift = buildIdleLiftState();
    return;
  }
  const roleCounts = (
    underrealm.crew
    && underrealm.crew.rolesByDepth
    && underrealm.crew.rolesByDepth[String(frontierDepth)]
  ) || {};
  const miners = Math.max(0, Math.floor(Number(roleCounts.miner || 0)));
  const activeRaid = getActiveRaidForDepth(state, frontierDepth);
  const surveyProgress = Math.max(0, Number(frontierLayer.economy.explorationProgress || 0));
  const surveyTarget = Math.max(1, Number(frontierLayer.economy.explorationTarget || 1));
  const surveyRatio = clamp(surveyProgress / surveyTarget, 0, 1);
  const requiredStockpile = buildDepthCostMap(
    progressionConfig.stockpileCostBase,
    progressionConfig.stockpileCostPerDepth,
    frontierDepth,
  );
  const requiredMined = buildDepthCostMap(
    progressionConfig.minedCostBase,
    progressionConfig.minedCostPerDepth,
    frontierDepth,
  );
  const minedTotals = frontierLayer.economy.totalGathered || {};
  const lift = underrealm.lift || buildIdleLiftState();
  const buildTicks = Math.max(
    1,
    progressionConfig.buildTicksBase
      + progressionConfig.buildTicksPerDepth * Math.max(0, frontierDepth - 1),
  );
  const championStrategic = resolveUnderrealmDwarfChampionStrategicBonuses(state, combat);
  if (lift.active === true) {
    const matchesFrontier = Number(lift.fromDepth || 0) === frontierDepth
      && Number(lift.targetDepth || 0) === frontierDepth + 1;
    if (!matchesFrontier) {
      underrealm.lift = buildIdleLiftState();
      return;
    }
    if (progressionConfig.requireNoActiveRaid && activeRaid) {
      underrealm.lift = lift;
      return;
    }
    if (miners < progressionConfig.minFrontierMiners) {
      underrealm.lift = lift;
      return;
    }
    const buildSpeedPerTick = 1 + championStrategic.liftBuildSpeedBonusRatio;
    const progressRemainder = Math.max(0, Number(lift.progressRemainder || 0)) + buildSpeedPerTick;
    const progressedTicks = Math.max(1, Math.floor(progressRemainder));
    lift.progressRemainder = Math.max(0, progressRemainder - progressedTicks);
    lift.ticksRemaining = Math.max(0, Math.floor(Number(lift.ticksRemaining || 0)) - progressedTicks);
    if (lift.ticksRemaining > 0) {
      underrealm.lift = lift;
      return;
    }
    const nextDepth = frontierDepth + 1;
    if (championRequired && !frontierCleared) {
      frontierFloor.state = 'contested';
      frontierFloor.encounter = frontierFloor.encounter && typeof frontierFloor.encounter === 'object'
        ? frontierFloor.encounter
        : {};
      frontierFloor.encounter.active = false;
      underrealm.lift = buildIdleLiftState();
      const championLabel = String(
        frontierFloor.champion && frontierFloor.champion.label
          ? frontierFloor.champion.label
          : `Depth Champion D${frontierDepth}`,
      );
      pushEvent(
        state,
        config,
        `Underrealm D${frontierDepth}: Deep Lift complete, ${championLabel} blocks depth ${nextDepth}`,
      );
      return;
    }
    underrealm.maxUnlockedDepth = nextDepth;
    const unlockedLayer = findUnderrealmLayer(underrealm, nextDepth);
    if (unlockedLayer) {
      unlockedLayer.unlocked = true;
      ensureLayerEconomyState(unlockedLayer, getUnderrealmEconomyConfig(config));
    }
    underrealm.lift = buildIdleLiftState();
    pushEvent(state, config, `Underrealm: Deep Lift completed, depth ${nextDepth} opened`);
    return;
  }
  const readyBySurvey = surveyRatio >= progressionConfig.requiredSurveyRatio;
  if (!readyBySurvey) {
    underrealm.lift = lift;
    return;
  }
  if (miners < progressionConfig.minFrontierMiners) {
    underrealm.lift = lift;
    return;
  }
  if (progressionConfig.requireNoActiveRaid && activeRaid) {
    underrealm.lift = lift;
    return;
  }
  if (!hasCostResources(state.stockpile, requiredStockpile)) {
    underrealm.lift = lift;
    return;
  }
  if (!hasCostResources(minedTotals, requiredMined)) {
    underrealm.lift = lift;
    return;
  }
  consumeCostResources(state.stockpile, requiredStockpile);
  underrealm.lift = {
    active: true,
    fromDepth: frontierDepth,
    targetDepth: frontierDepth + 1,
    startedTick: Number(state.tick || 0),
    ticksRemaining: buildTicks,
    totalTicks: buildTicks,
    progressRemainder: 0,
    requiredSurveyRatio: progressionConfig.requiredSurveyRatio,
    requiredStockpile,
    requiredMined,
  };
  pushEvent(
    state,
    config,
    `Underrealm D${frontierDepth}: Deep Lift construction started for depth ${frontierDepth + 1}`,
  );
}

// Assign a real set of adult dwarves to Underrealm duties.
function updateCrewAssignments(state, config) {
  const underrealm = state && state.underrealm;
  const crew = underrealm && underrealm.crew;
  if (!underrealm || !crew || crew.enabled === false) {
    clearAllUnderrealmDuty(state);
    resetCrewAssignments(crew);
    return;
  }
  const discovery = underrealm.discovery || null;
  if (discovery && discovery.enabled !== false && discovery.found !== true) {
    clearAllUnderrealmDuty(state);
    resetCrewAssignments(crew);
    return;
  }
  const maxDepth = Math.max(0, Math.floor(Number(underrealm.maxUnlockedDepth || 0)));
  if (maxDepth <= 0) {
    clearAllUnderrealmDuty(state);
    resetCrewAssignments(crew);
    return;
  }
  const dwarfChampion = underrealm
    && underrealm.combat
    && underrealm.combat.dwarfChampion
    && typeof underrealm.combat.dwarfChampion === 'object'
    ? underrealm.combat.dwarfChampion
    : null;
  const pinnedSurfaceChampionId = dwarfChampion
    && dwarfChampion.enabled !== false
    && dwarfChampion.requiresPartyPresence !== false
    && typeof dwarfChampion.activeDwarfId === 'string'
      ? dwarfChampion.activeDwarfId
      : '';
  const adults = state.dwarves
    .filter((dwarf) => (
      isAdult(dwarf, config)
      && !dwarf.expedition
      && String(dwarf && dwarf.id || '') !== pinnedSurfaceChampionId
    ))
    .slice()
    .sort(compareDwarvesBySpawn);
  const surfaceReserveRatio = clamp(Number(crew.surfaceReserveRatio || 0), 0, 1);
  const maxUnderrealmRatio = clamp(Number(crew.maxUnderrealmRatio ?? 0.6), 0, 1);
  const reserveCount = Math.floor(adults.length * surfaceReserveRatio);
  const deepLimit = Math.floor(adults.length * maxUnderrealmRatio);
  const assignable = Math.max(0, Math.min(adults.length - reserveCount, deepLimit));
  const perDepthCounts = splitCrewAcrossDepths(assignable, maxDepth, Number(crew.depthWeightGrowth ?? 0.18));
  const pool = adults.slice();
  const membersByDepth = {};
  const rolesByDepth = {};
  const assignedByDepth = {};
  const assignedIds = new Set();
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const count = Number(perDepthCounts[depth] || 0);
    if (count <= 0) {
      continue;
    }
    const roleCounts = splitCrewRoles(count, crew.roles || {});
    const picked = pickDepthCrew(pool, roleCounts, config);
    if (picked.length === 0) {
      continue;
    }
    membersByDepth[String(depth)] = picked.map((entry) => entry.dwarf.id);
    rolesByDepth[String(depth)] = {
      miner: picked.filter((entry) => entry.role === 'miner').length,
      hauler: picked.filter((entry) => entry.role === 'hauler').length,
      guard: picked.filter((entry) => entry.role === 'guard').length,
    };
    assignedByDepth[String(depth)] = picked.length;
    for (const entry of picked) {
      const dwarf = entry.dwarf;
      dwarf.underrealmDuty = {
        active: true,
        depth,
        role: entry.role,
      };
      assignedIds.add(dwarf.id);
    }
  }
  for (const dwarf of state.dwarves) {
    if (!assignedIds.has(dwarf.id)) {
      delete dwarf.underrealmDuty;
    }
  }
  dropSurfaceJobsForUnderrealmDuty(state, assignedIds);
  crew.assignedByDepth = assignedByDepth;
  crew.rolesByDepth = rolesByDepth;
  crew.membersByDepth = membersByDepth;
  crew.totalAssigned = assignedIds.size;
  crew.surfaceAdults = Math.max(0, adults.length - assignedIds.size);
}

// Tick shrine-driven systems: ward charges, delver oaths, and morale shaping.
function updateUnderrealmShrines(state, config) {
  const underrealm = state && state.underrealm;
  if (!underrealm || underrealm.enabled === false) {
    return;
  }
  const shrineConfig = getUnderrealmShrineConfig(config);
  if (!shrineConfig.enabled) {
    return;
  }
  const maxUnlockedDepth = Math.max(0, Math.floor(Number(underrealm.maxUnlockedDepth || 0)));
  if (maxUnlockedDepth <= 0) {
    return;
  }
  const shrinesState = underrealm.shrines || {};
  const economyConfig = getUnderrealmEconomyConfig(config);
  for (let depth = 1; depth <= maxUnlockedDepth; depth += 1) {
    const layer = findUnderrealmLayer(underrealm, depth);
    if (!layer) {
      continue;
    }
    ensureLayerEconomyState(layer, economyConfig);
    const depthKey = String(depth);
    ensureDepthShrineState(shrinesState, depthKey);
    const roleCounts = (underrealm.crew && underrealm.crew.rolesByDepth
      && underrealm.crew.rolesByDepth[depthKey]) || {};
    const assigned = Math.max(0, Number(
      underrealm.crew
      && underrealm.crew.assignedByDepth
      && underrealm.crew.assignedByDepth[depthKey],
    ));
    const guards = Math.max(0, Number(roleCounts.guard || 0));
    const shrineCount = getLayerFeatureCount(layer, 'shrine');
    tickShrineWardGeneration(
      state,
      shrineConfig,
      depth,
      assigned,
      guards,
      shrineCount,
    );
    tickShrineOath(
      state,
      config,
      shrineConfig,
      depth,
      assigned,
      shrineCount,
    );
  }
  applyShrineOathStateToDelvers(state, shrineConfig);
}

// Ensure per-depth shrine runtime entries exist.
function ensureDepthShrineState(shrinesState, depthKey) {
  if (!shrinesState || !depthKey) {
    return;
  }
  shrinesState.wardChargesByDepth = shrinesState.wardChargesByDepth || {};
  shrinesState.oathByDepth = shrinesState.oathByDepth || {};
  shrinesState.stats = shrinesState.stats || {
    chargesCreated: 0,
    chargesSpent: 0,
    oathSuccesses: 0,
    oathFailures: 0,
    prospectionFinds: {},
  };
  shrinesState.stats.prospectionFinds = shrinesState.stats.prospectionFinds || {};
  if (!Number.isFinite(Number(shrinesState.wardChargesByDepth[depthKey]))) {
    shrinesState.wardChargesByDepth[depthKey] = 0;
  }
  if (!shrinesState.oathByDepth[depthKey]) {
    shrinesState.oathByDepth[depthKey] = {
      activeTicks: 0,
      penaltyTicks: 0,
      lastTick: 0,
      lastSuccessTick: 0,
      lastFailureTick: 0,
    };
  }
}

// Build ward charges from shrine/guard presence and configured ritual costs.
function tickShrineWardGeneration(state, shrineConfig, depth, assigned, guards, shrineCount) {
  const underrealm = state && state.underrealm;
  if (!underrealm || !underrealm.shrines || !shrineConfig || !shrineConfig.ward.enabled) {
    return;
  }
  const wardConfig = shrineConfig.ward;
  if (assigned <= 0 || shrineCount <= 0) {
    return;
  }
  if (state.tick % wardConfig.chargeInterval !== 0) {
    return;
  }
  const depthKey = String(depth);
  const currentCharges = Math.max(
    0,
    Math.floor(Number(underrealm.shrines.wardChargesByDepth[depthKey] || 0)),
  );
  const capacityLeft = Math.max(0, wardConfig.maxChargesPerDepth - currentCharges);
  if (capacityLeft <= 0) {
    return;
  }
  const rawCharges = wardConfig.chargeBase
    + shrineCount * wardConfig.chargePerShrine
    + guards * wardConfig.chargePerGuard;
  const generated = Math.max(0, Math.floor(rawCharges));
  if (generated <= 0) {
    return;
  }
  const planned = Math.min(capacityLeft, generated);
  const affordable = getAffordableScaledCostCount(
    state.stockpile,
    wardConfig.resourceCostPerCharge,
    planned,
  );
  if (affordable <= 0) {
    return;
  }
  consumeScaledCostResources(state.stockpile, wardConfig.resourceCostPerCharge, affordable);
  underrealm.shrines.wardChargesByDepth[depthKey] = currentCharges + affordable;
  underrealm.shrines.stats.chargesCreated = Number(
    underrealm.shrines.stats.chargesCreated || 0,
  ) + affordable;
}

// Tick oath lifecycle and trigger oath rituals when cadence gates pass.
function tickShrineOath(state, config, shrineConfig, depth, assigned, shrineCount) {
  const underrealm = state && state.underrealm;
  if (!underrealm || !underrealm.shrines || !shrineConfig || !shrineConfig.oath.enabled) {
    return;
  }
  const oathConfig = shrineConfig.oath;
  const depthKey = String(depth);
  ensureDepthShrineState(underrealm.shrines, depthKey);
  const oathState = underrealm.shrines.oathByDepth[depthKey];
  oathState.activeTicks = Math.max(0, Math.floor(Number(oathState.activeTicks || 0)));
  oathState.penaltyTicks = Math.max(0, Math.floor(Number(oathState.penaltyTicks || 0)));
  if (oathState.activeTicks > 0) {
    oathState.activeTicks -= 1;
  }
  if (oathState.penaltyTicks > 0) {
    oathState.penaltyTicks -= 1;
  }
  if (state.tick % oathConfig.tickInterval !== 0) {
    return;
  }
  if (oathState.activeTicks > 0 || oathState.penaltyTicks > 0) {
    return;
  }
  if (assigned < oathConfig.minCrew) {
    return;
  }
  if (shrineCount < oathConfig.minShrinesPerDepth) {
    return;
  }
  if (hasCostResources(state.stockpile, oathConfig.ritualCost)) {
    consumeCostResources(state.stockpile, oathConfig.ritualCost);
    oathState.activeTicks = oathConfig.durationTicks;
    oathState.lastSuccessTick = Number(state.tick || 0);
    underrealm.shrines.stats.oathSuccesses = Number(
      underrealm.shrines.stats.oathSuccesses || 0,
    ) + 1;
    pushEvent(state, config, `Underrealm D${depth}: Delver oath sealed at the shrine`);
    return;
  }
  if (oathConfig.failurePenaltyTicks <= 0) {
    return;
  }
  oathState.penaltyTicks = oathConfig.failurePenaltyTicks;
  oathState.lastFailureTick = Number(state.tick || 0);
  underrealm.shrines.stats.oathFailures = Number(
    underrealm.shrines.stats.oathFailures || 0,
  ) + 1;
  pushEvent(state, config, `Underrealm D${depth}: oath failed, the halls grow restless`);
}

// Apply active/failing oath effects directly to assigned delver morale/stress.
function applyShrineOathStateToDelvers(state, shrineConfig) {
  if (!state || !Array.isArray(state.dwarves) || !shrineConfig || !shrineConfig.oath.enabled) {
    return;
  }
  const underrealm = state.underrealm;
  if (!underrealm || !underrealm.shrines || !underrealm.shrines.oathByDepth) {
    return;
  }
  const oathConfig = shrineConfig.oath;
  const schismMoraleMultiplier = Math.max(0.1, Number(getSchismModifier(state, 'underrealmMorale', 1) || 1));
  for (const dwarf of state.dwarves) {
    const duty = dwarf && dwarf.underrealmDuty;
    if (!duty || duty.active === false || Number(duty.depth || 0) <= 0) {
      continue;
    }
    const depthKey = String(Math.max(1, Math.floor(Number(duty.depth || 1))));
    const oathState = underrealm.shrines.oathByDepth[depthKey];
    if (!oathState || !dwarf.state) {
      continue;
    }
    const morale = clamp(Number(dwarf.state.morale || 0), 0, 1);
    const stress = clamp(Number(dwarf.state.stress || 0), 0, 1);
    if (Number(oathState.activeTicks || 0) > 0) {
      dwarf.state.morale = clamp(
        morale + oathConfig.moraleTickBonus * schismMoraleMultiplier,
        0,
        1,
      );
      dwarf.state.stress = clamp(stress - oathConfig.stressTickReduction, 0, 1);
      continue;
    }
    if (Number(oathState.penaltyTicks || 0) > 0) {
      dwarf.state.morale = clamp(
        morale - oathConfig.failureMoraleTickPenalty / schismMoraleMultiplier,
        0,
        1,
      );
    }
  }
}

// Reset assignment maps and counters for an Underrealm crew block.
function resetCrewAssignments(crew) {
  if (!crew || typeof crew !== 'object') {
    return;
  }
  crew.assignedByDepth = {};
  crew.rolesByDepth = {};
  crew.membersByDepth = {};
  crew.totalAssigned = 0;
  crew.surfaceAdults = 0;
}

// Split total crew count across unlocked depths using a linear weight ramp.
function splitCrewAcrossDepths(total, maxDepth, depthWeightGrowth) {
  const safeTotal = Math.max(0, Math.floor(Number(total || 0)));
  const safeDepth = Math.max(0, Math.floor(Number(maxDepth || 0)));
  const growth = Math.max(0, Number(depthWeightGrowth || 0));
  const result = {};
  if (safeTotal <= 0 || safeDepth <= 0) {
    return result;
  }
  const weights = [];
  let weightSum = 0;
  for (let depth = 1; depth <= safeDepth; depth += 1) {
    const weight = 1 + (depth - 1) * growth;
    weights.push({ depth, weight });
    weightSum += weight;
  }
  let assigned = 0;
  for (const entry of weights) {
    const count = Math.floor(safeTotal * (entry.weight / weightSum));
    result[entry.depth] = count;
    assigned += count;
  }
  let remainder = safeTotal - assigned;
  let cursor = weights.length - 1;
  while (remainder > 0 && cursor >= 0) {
    const depth = weights[cursor].depth;
    result[depth] = Number(result[depth] || 0) + 1;
    remainder -= 1;
    cursor -= 1;
    if (cursor < 0) {
      cursor = weights.length - 1;
    }
  }
  return result;
}

// Split a depth crew count into miner/hauler/guard duties.
function splitCrewRoles(total, roles) {
  const safeTotal = Math.max(0, Math.floor(Number(total || 0)));
  const minerRatio = clamp(Number(roles.minerRatio ?? 0.6), 0, 1);
  const haulerRatio = clamp(Number(roles.haulerRatio ?? 0.25), 0, 1);
  const guardRatio = clamp(Number(roles.guardRatio ?? 0.15), 0, 1);
  const ratioSum = minerRatio + haulerRatio + guardRatio;
  const minerWeight = ratioSum > 0 ? minerRatio / ratioSum : 0.6;
  const haulerWeight = ratioSum > 0 ? haulerRatio / ratioSum : 0.25;
  const guardWeight = ratioSum > 0 ? guardRatio / ratioSum : 0.15;
  const miners = Math.max(0, Math.floor(safeTotal * minerWeight));
  const haulers = Math.max(0, Math.floor(safeTotal * haulerWeight));
  let guards = Math.max(0, safeTotal - miners - haulers);
  if (safeTotal >= 3 && guards <= 0) {
    guards = 1;
  }
  const adjustedMiners = Math.max(0, safeTotal - haulers - guards);
  return {
    miner: adjustedMiners,
    hauler: haulers,
    guard: guards,
  };
}

// Pick concrete dwarves from a shared pool for miner/hauler/guard duties.
function pickDepthCrew(pool, roleCounts, config) {
  const picked = [];
  const pickRole = (role, count) => {
    for (let i = 0; i < count; i += 1) {
      const index = findBestCandidateIndex(pool, role, config);
      if (index < 0) {
        break;
      }
      const dwarf = pool.splice(index, 1)[0];
      if (!dwarf) {
        continue;
      }
      picked.push({ dwarf, role });
    }
  };
  pickRole('miner', Number(roleCounts.miner || 0));
  pickRole('hauler', Number(roleCounts.hauler || 0));
  pickRole('guard', Number(roleCounts.guard || 0));
  return picked;
}

// Resolve the best candidate index for a role from the current free pool.
function findBestCandidateIndex(pool, role, config) {
  let bestIndex = -1;
  let bestScore = -Infinity;
  for (let index = 0; index < pool.length; index += 1) {
    const dwarf = pool[index];
    if (!dwarf) {
      continue;
    }
    const score = getDelverRoleScore(dwarf, role, config);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

// Score a dwarf for a specific Underrealm role.
function getDelverRoleScore(dwarf, role, config) {
  const clanEffects = resolveClanEffects(config, dwarf.clanId);
  const roleName = String(dwarf.role || '');
  if (role === 'miner') {
    return (
      (roleName === 'gatherer' ? 20 : 0)
      + (roleName === 'builder' ? 8 : 0)
      + Number(clanEffects.mine_output_bonus || 0) * 120
      + Number(clanEffects.mine_rare_chance_bonus || 0) * 160
    );
  }
  if (role === 'hauler') {
    return (
      (roleName === 'manager' ? 16 : 0)
      + (roleName === 'gatherer' ? 10 : 0)
      + (roleName === 'builder' ? 4 : 0)
      + Number(clanEffects.build_ticks_bonus || 0) * 40
    );
  }
  return (
    (roleName === 'builder' ? 12 : 0)
    + (roleName === 'manager' ? 8 : 0)
    + Number(clanEffects.raid_defense_bonus || 0) * 200
    + Number(clanEffects.raid_max_kills_bonus || 0) * 120
  );
}

// Resolve clan effects for a dwarf without importing heavy helpers.
function resolveClanEffects(config, clanId) {
  const clans = (config && config.clans) || {};
  const effects = clans.effects || {};
  if (!clanId || !effects || typeof effects !== 'object') {
    return {};
  }
  const effect = effects[clanId];
  return effect && typeof effect === 'object' ? effect : {};
}

// Remove active surface jobs from dwarves assigned to Underrealm duty.
function dropSurfaceJobsForUnderrealmDuty(state, assignedIds) {
  if (!assignedIds || assignedIds.size === 0) {
    return;
  }
  state.jobs = (state.jobs || []).filter((job) => !assignedIds.has(job.dwarfId));
  for (const dwarf of state.dwarves) {
    if (!assignedIds.has(dwarf.id)) {
      continue;
    }
    dwarf.job = null;
  }
}

// Clear Underrealm duty metadata from every dwarf.
function clearAllUnderrealmDuty(state) {
  if (!state || !Array.isArray(state.dwarves)) {
    return;
  }
  for (const dwarf of state.dwarves) {
    delete dwarf.underrealmDuty;
  }
}

// Tick Underrealm economy: exploration, gathering, rare drops, and node regen.
function updateUnderrealmEconomy(state, config) {
  const underrealm = state && state.underrealm;
  if (!underrealm || underrealm.enabled === false) {
    return;
  }
  const economyConfig = getUnderrealmEconomyConfig(config);
  if (!economyConfig.enabled) {
    return;
  }
  underrealm.economy.ticks = Number(underrealm.economy.ticks || 0) + 1;
  underrealm.economy.unlockedDepths = Math.max(
    0,
    Math.floor(Number(underrealm.maxUnlockedDepth || 0)),
  );
  const layers = Array.isArray(underrealm.layers) ? underrealm.layers : [];
  for (const layer of layers) {
    if (!layer || !layer.terrain || Number(layer.depth || 0) <= 0) {
      continue;
    }
    ensureLayerEconomyState(layer, economyConfig);
    if (Number(layer.depth || 0) > Number(underrealm.maxUnlockedDepth || 0)) {
      continue;
    }
    updateLayerExploration(state, config, layer, economyConfig);
    updateLayerGathering(state, config, layer, economyConfig);
    regenLayerNodes(state, layer, economyConfig);
  }
}

// Initialize per-layer economy nodes and exploration metadata.
function ensureLayerEconomyState(layer, economyConfig) {
  if (layer.economy && Array.isArray(layer.economy.nodes)) {
    if (!layer.economy.featureCounts || typeof layer.economy.featureCounts !== 'object') {
      layer.economy.featureCounts = countLayerFeatures(layer.terrain);
    }
    return;
  }
  const nodes = createLayerNodes(layer, economyConfig);
  const depth = Math.max(1, Math.floor(Number(layer.depth || 1)));
  const explorationTarget = economyConfig.unlockThresholdBase
    + economyConfig.unlockThresholdPerDepth * Math.max(0, depth - 1);
  layer.economy = {
    nodes,
    featureCounts: countLayerFeatures(layer.terrain),
    totalGathered: {},
    totalRareDrops: {},
    explorationProgress: 0,
    explorationTarget,
    explored: false,
  };
}

// Build deterministic economy nodes for a depth layer.
function createLayerNodes(layer, economyConfig) {
  const depth = Math.max(1, Math.floor(Number(layer.depth || 1)));
  const seed = Number(layer.terrain && layer.terrain.seed || depth * 97);
  const rng = createDeterministicRng(seed + depth * 16381);
  const candidates = collectLayerNodeCandidates(layer.terrain);
  const nodes = [];
  for (const [resourceId, template] of Object.entries(economyConfig.nodeTemplates)) {
    if (!template.enabled || depth < template.minDepth) {
      continue;
    }
    const count = Math.max(0, template.baseNodes + template.nodesPerDepth * Math.max(0, depth - 1));
    for (let index = 0; index < count; index += 1) {
      const cell = candidates.length > 0
        ? candidates[Math.floor(rng() * candidates.length)]
        : { x: 0, y: 0 };
      const capacity = randomInt(
        template.capacityMin,
        template.capacityMax,
        rng,
      );
      nodes.push({
        id: `ud_node_${resourceId}_${depth}_${index + 1}`,
        resource: resourceId,
        x: cell.x,
        y: cell.y,
        capacity,
        remaining: capacity,
        yieldMin: template.yieldMin,
        yieldMax: template.yieldMax,
      });
    }
  }
  return nodes;
}

// Collect walkable cave-like cells as candidate spots for economy nodes.
function collectLayerNodeCandidates(terrain) {
  const candidates = [];
  if (!terrain || !terrain.types) {
    return candidates;
  }
  const blocked = new Set(['wall', 'chasm', 'magma']);
  for (let y = 0; y < terrain.types.length; y += 1) {
    const row = terrain.types[y];
    if (!row) {
      continue;
    }
    for (let x = 0; x < row.length; x += 1) {
      const type = row[x];
      if (blocked.has(type)) {
        continue;
      }
      candidates.push({ x, y });
    }
  }
  return candidates;
}

// Count underrealm terrain features used by shrine systems.
function countLayerFeatures(terrain) {
  const counts = {
    shrine: 0,
    chasm: 0,
    magma: 0,
  };
  if (!terrain || !Array.isArray(terrain.types)) {
    return counts;
  }
  for (const row of terrain.types) {
    if (!Array.isArray(row)) {
      continue;
    }
    for (const type of row) {
      if (type === 'shrine') {
        counts.shrine += 1;
      } else if (type === 'chasm') {
        counts.chasm += 1;
      } else if (type === 'magma') {
        counts.magma += 1;
      }
    }
  }
  return counts;
}

// Return one feature count for a layer economy snapshot.
function getLayerFeatureCount(layer, featureKey) {
  const featureCounts = layer
    && layer.economy
    && layer.economy.featureCounts
    && typeof layer.economy.featureCounts === 'object'
    ? layer.economy.featureCounts
    : countLayerFeatures(layer && layer.terrain);
  return Math.max(0, Number(featureCounts[featureKey] || 0));
}

// Resolve exploration multiplier from oath state for one depth.
function getDepthOathExplorationMultiplier(underrealm, depth, shrineConfig) {
  if (!underrealm || !underrealm.shrines || !shrineConfig || !shrineConfig.oath.enabled) {
    return 1;
  }
  const oathByDepth = underrealm.shrines.oathByDepth || {};
  const depthKey = String(Math.max(1, Math.floor(Number(depth || 1))));
  const state = oathByDepth[depthKey];
  if (!state) {
    return 1;
  }
  if (Number(state.activeTicks || 0) > 0) {
    return shrineConfig.oath.explorationMultiplier;
  }
  if (Number(state.penaltyTicks || 0) > 0) {
    return shrineConfig.oath.failureExplorationMultiplier;
  }
  return 1;
}

// Resolve one living dwarf by id from state.
function findLivingDwarfById(state, dwarfId) {
  const target = String(dwarfId || '');
  if (!target) {
    return null;
  }
  for (const dwarf of Array.isArray(state && state.dwarves) ? state.dwarves : []) {
    if (String(dwarf && dwarf.id || '') === target) {
      return dwarf;
    }
  }
  return null;
}

// Resolve one stacked champion bonus from base/per-survival/cap values.
function resolveStackedChampionBonus(baseRaw, perSurvivalRaw, capRaw, survivalsRaw) {
  const base = Math.max(0, Number(baseRaw || 0));
  const perSurvival = Math.max(0, Number(perSurvivalRaw || 0));
  const cap = Math.max(0, Number(capRaw || 0));
  const survivals = Math.max(0, Math.floor(Number(survivalsRaw || 0)));
  const value = base + perSurvival * survivals;
  if (cap <= 0) {
    return value;
  }
  return Math.min(value, cap);
}

// Resolve active dwarf-champion strategic bonuses used by deep progression loops.
function resolveUnderrealmDwarfChampionStrategicBonuses(state, combat = null) {
  const sourceCombat = combat && typeof combat === 'object'
    ? combat
    : (
      state
      && state.underrealm
      && state.underrealm.combat
      && typeof state.underrealm.combat === 'object'
        ? state.underrealm.combat
        : null
    );
  const runtime = sourceCombat && sourceCombat.dwarfChampion
    && typeof sourceCombat.dwarfChampion === 'object'
    ? sourceCombat.dwarfChampion
    : null;
  const empty = {
    active: false,
    dwarfId: null,
    survivals: 0,
    readinessScoreBonus: 0,
    retryCooldownReductionRatio: 0,
    championRoundBonus: 0,
    frontierExplorationBonusRatio: 0,
    liftBuildSpeedBonusRatio: 0,
  };
  if (!runtime || runtime.enabled === false) {
    return empty;
  }
  const dwarfId = typeof runtime.activeDwarfId === 'string'
    ? runtime.activeDwarfId
    : null;
  if (!dwarfId) {
    return empty;
  }
  const champion = findLivingDwarfById(state, dwarfId);
  if (!champion) {
    return empty;
  }
  const survivals = Math.max(0, Math.floor(Number(champion.underrealmChampionSurvivals || 0)));
  return {
    active: true,
    dwarfId,
    survivals,
    readinessScoreBonus: resolveStackedChampionBonus(
      runtime.readinessScoreBonusBase,
      runtime.readinessScoreBonusPerSurvival,
      runtime.readinessScoreBonusCap,
      survivals,
    ),
    retryCooldownReductionRatio: clamp(
      resolveStackedChampionBonus(
        runtime.retryCooldownReductionBase,
        runtime.retryCooldownReductionPerSurvival,
        runtime.retryCooldownReductionCap,
        survivals,
      ),
      0,
      0.95,
    ),
    championRoundBonus: Math.max(
      0,
      resolveStackedChampionBonus(
        runtime.championRoundBonusBase,
        runtime.championRoundBonusPerSurvival,
        runtime.championRoundBonusCap,
        survivals,
      ),
    ),
    frontierExplorationBonusRatio: Math.max(
      0,
      resolveStackedChampionBonus(
        runtime.frontierExplorationBonusBase,
        runtime.frontierExplorationBonusPerSurvival,
        runtime.frontierExplorationBonusCap,
        survivals,
      ),
    ),
    liftBuildSpeedBonusRatio: Math.max(
      0,
      resolveStackedChampionBonus(
        runtime.liftBuildSpeedBonusBase,
        runtime.liftBuildSpeedBonusPerSurvival,
        runtime.liftBuildSpeedBonusCap,
        survivals,
      ),
    ),
  };
}

// Compute how many scaled-cost charges can be paid with current stockpile.
function getAffordableScaledCostCount(stockpile, costPerUnit, maxUnits) {
  const stock = stockpile && typeof stockpile === 'object' ? stockpile : {};
  const costs = costPerUnit && typeof costPerUnit === 'object' ? costPerUnit : {};
  const target = Math.max(0, Math.floor(Number(maxUnits || 0)));
  if (target <= 0) {
    return 0;
  }
  const entries = Object.entries(costs).filter(([, amount]) => Number(amount || 0) > 0);
  if (entries.length === 0) {
    return target;
  }
  let affordable = target;
  for (const [resourceId, amountRaw] of entries) {
    const unitCost = Math.max(1, Math.floor(Number(amountRaw || 0)));
    const available = Math.max(0, Math.floor(Number(stock[resourceId] || 0)));
    affordable = Math.min(affordable, Math.floor(available / unitCost));
    if (affordable <= 0) {
      return 0;
    }
  }
  return affordable;
}

// Consume a cost map scaled by a multiplicity factor.
function consumeScaledCostResources(stockpile, costPerUnit, units) {
  if (!stockpile || typeof stockpile !== 'object') {
    return;
  }
  const safeUnits = Math.max(0, Math.floor(Number(units || 0)));
  if (safeUnits <= 0) {
    return;
  }
  for (const [resourceId, amountRaw] of Object.entries(costPerUnit || {})) {
    const unitCost = Math.max(0, Math.floor(Number(amountRaw || 0)));
    if (unitCost <= 0) {
      continue;
    }
    const spend = unitCost * safeUnits;
    stockpile[resourceId] = Math.max(0, Math.floor(Number(stockpile[resourceId] || 0)) - spend);
  }
}

// Tick exploration progress for a depth layer.
function updateLayerExploration(state, config, layer, economyConfig) {
  const depth = Math.max(1, Math.floor(Number(layer.depth || 1)));
  const crew = state.underrealm.crew || {};
  const rolesByDepth = crew.rolesByDepth || {};
  const roleCounts = rolesByDepth[String(depth)] || {};
  const miners = Math.max(0, Number(roleCounts.miner || 0));
  const guards = Math.max(0, Number(roleCounts.guard || 0));
  if (miners <= 0 && guards <= 0) {
    return;
  }
  const underrealm = state.underrealm || {};
  const shrineConfig = getUnderrealmShrineConfig(config);
  const oathMultiplier = getDepthOathExplorationMultiplier(
    underrealm,
    layer.depth,
    shrineConfig,
  );
  const championStrategic = resolveUnderrealmDwarfChampionStrategicBonuses(
    state,
    underrealm.combat,
  );
  const frontierDepth = Math.max(1, Math.floor(Number(underrealm.maxUnlockedDepth || depth)));
  const frontierMultiplier = championStrategic.active && depth === frontierDepth
    ? 1 + championStrategic.frontierExplorationBonusRatio
    : 1;
  const schismExplorationMultiplier = resolveSchismUnderrealmMultiplier(
    state,
    'underrealmExploration',
    { boostScale: 0.55, penaltyScale: 0.8, min: 0.3, max: 1.4 },
  );
  const gain = (
    miners * economyConfig.explorationPerMiner
    + guards * economyConfig.explorationPerGuard
  ) / Math.max(1, Number(layer.difficultyMultiplier || 1))
    * oathMultiplier
    * frontierMultiplier
    * schismExplorationMultiplier;
  layer.economy.explorationProgress = Number(layer.economy.explorationProgress || 0) + gain;
  const target = Math.max(1, Number(layer.economy.explorationTarget || 1));
  layer.economy.explored = Number(layer.economy.explorationProgress || 0) >= target;
}

// Tick gathering and rare-drop extraction for one depth layer.
function updateLayerGathering(state, config, layer, economyConfig) {
  if (state.tick % economyConfig.tickInterval !== 0) {
    return;
  }
  const underrealm = state.underrealm;
  const crew = underrealm.crew || {};
  const rolesByDepth = crew.rolesByDepth || {};
  const roleCounts = rolesByDepth[String(layer.depth)] || {};
  const miners = Math.max(0, Number(roleCounts.miner || 0));
  const haulers = Math.max(0, Number(roleCounts.hauler || 0));
  const guards = Math.max(0, Number(roleCounts.guard || 0));
  let workUnits = miners + Math.floor(haulers * economyConfig.gatherEfficiencyPerHauler);
  if (workUnits <= 0) {
    return;
  }
  const activeRaid = getActiveRaidForDepth(state, layer.depth);
  if (activeRaid) {
    workUnits = Math.max(0, Math.floor(workUnits * 0.6));
  }
  if (workUnits <= 0) {
    return;
  }
  const nodes = layer.economy.nodes || [];
  for (let index = 0; index < workUnits; index += 1) {
    const node = pickNodeForExtraction(nodes);
    if (!node) {
      break;
    }
    const base = randomInt(node.yieldMin, node.yieldMax, Math.random);
    const depthBonus = 1 + economyConfig.depthOutputBonus * Math.max(0, Number(layer.depth || 1) - 1);
    const extracted = Math.max(
      1,
      Math.min(
        Math.max(0, Number(node.remaining || 0)),
        Math.round(base * depthBonus),
      ),
    );
    if (extracted <= 0) {
      continue;
    }
    node.remaining = Math.max(0, Number(node.remaining || 0) - extracted);
    addStockpileResource(state.stockpile, node.resource, extracted);
    addNestedValue(layer.economy.totalGathered, node.resource, extracted);
    addNestedValue(state.underrealm.economy.totalGathered, node.resource, extracted);
  }
  applyLayerRareDrops(state, config, layer, guards, economyConfig);
  applyLayerProspectionDrops(state, config, layer, miners, guards);
}

// Select a node with remaining capacity, prioritizing richer nodes.
function pickNodeForExtraction(nodes) {
  const available = (nodes || []).filter((node) => Number(node.remaining || 0) > 0);
  if (available.length === 0) {
    return null;
  }
  available.sort((left, right) => Number(right.remaining || 0) - Number(left.remaining || 0));
  const topSlice = available.slice(0, Math.max(1, Math.ceil(available.length * 0.35)));
  return topSlice[Math.floor(Math.random() * topSlice.length)] || null;
}

// Roll rare-drop tables for the current depth layer.
function applyLayerRareDrops(state, config, layer, guards, economyConfig) {
  const drops = economyConfig.rareDrops;
  const depth = Math.max(1, Math.floor(Number(layer.depth || 1)));
  const alchemyRareMultiplier = getAlchemyMultiplier(state, config, 'underrealmRareDrop', 1);
  for (const [resourceId, entry] of Object.entries(drops)) {
    if (depth < entry.minDepth) {
      continue;
    }
    const depthMultiplier = Math.max(1, Number(layer.rareDropMultiplier || 1));
    const guardBonus = 1 + guards * economyConfig.rareDropGuardBonus;
    const chance = clamp(
      entry.chance * depthMultiplier * guardBonus * alchemyRareMultiplier,
      0,
      1,
    );
    if (Math.random() >= chance) {
      continue;
    }
    const amount = randomInt(entry.amountMin, entry.amountMax, Math.random);
    if (amount <= 0) {
      continue;
    }
    addStockpileResource(state.stockpile, resourceId, amount);
    addNestedValue(layer.economy.totalRareDrops, resourceId, amount);
    addNestedValue(state.underrealm.economy.totalRareDrops, resourceId, amount);
    pushEvent(state, config, `Underrealm D${depth}: rare find ${resourceId}+${amount}`);
  }
}

// Roll shrine-linked prospection drops from rifts and magma vents.
function applyLayerProspectionDrops(state, config, layer, miners, guards) {
  const underrealm = state && state.underrealm;
  if (!underrealm || !underrealm.shrines || !layer || !layer.economy) {
    return;
  }
  const shrineConfig = getUnderrealmShrineConfig(config);
  if (!shrineConfig.enabled || !shrineConfig.prospection.enabled) {
    return;
  }
  const depth = Math.max(1, Math.floor(Number(layer.depth || 1)));
  if (miners <= 0) {
    return;
  }
  const featureCounts = layer.economy.featureCounts || countLayerFeatures(layer.terrain);
  const shrineCount = Math.max(0, Number(featureCounts.shrine || 0));
  if (shrineConfig.prospection.requiresShrine && shrineCount <= 0) {
    return;
  }
  const workforceMultiplier = 1
    + miners * shrineConfig.prospection.minerBonusPerUnit
    + guards * shrineConfig.prospection.guardBonusPerUnit;
  const rareMultiplier = getAlchemyMultiplier(state, config, 'underrealmRareDrop', 1);
  const runDropRoll = (dropConfig, featureType, label) => {
    if (!dropConfig || !dropConfig.resource) {
      return;
    }
    if (depth < dropConfig.minDepth) {
      return;
    }
    const featureCount = Math.max(0, Number(featureCounts[featureType] || 0));
    if (featureCount <= 0) {
      return;
    }
    const featureMultiplier = 1 + Math.min(1.5, featureCount / 72);
    const chance = clamp(
      dropConfig.chance * workforceMultiplier * featureMultiplier * rareMultiplier,
      0,
      1,
    );
    if (chance <= 0 || Math.random() >= chance) {
      return;
    }
    const amount = randomInt(dropConfig.amountMin, dropConfig.amountMax, Math.random);
    if (amount <= 0) {
      return;
    }
    addStockpileResource(state.stockpile, dropConfig.resource, amount);
    addNestedValue(layer.economy.totalRareDrops, dropConfig.resource, amount);
    addNestedValue(underrealm.economy.totalRareDrops, dropConfig.resource, amount);
    addNestedValue(underrealm.shrines.stats.prospectionFinds, dropConfig.resource, amount);
    pushEvent(state, config, `Underrealm D${depth}: ${label} ${dropConfig.resource}+${amount}`);
  };
  runDropRoll(shrineConfig.prospection.riftDrop, 'chasm', 'rift fragment recovered');
  runDropRoll(shrineConfig.prospection.magmaDrop, 'magma', 'ember resin tapped');
}

// Regenerate depleted node capacity over time.
function regenLayerNodes(state, layer, economyConfig) {
  if (state.tick % economyConfig.nodeRegenInterval !== 0) {
    return;
  }
  for (const node of layer.economy.nodes || []) {
    const capacity = Math.max(0, Number(node.capacity || 0));
    const remaining = Math.max(0, Number(node.remaining || 0));
    if (remaining >= capacity) {
      continue;
    }
    const regen = Math.max(1, Math.floor(capacity * economyConfig.nodeRegenRatio));
    node.remaining = Math.min(capacity, remaining + regen);
  }
}

// Tick hostile deep-faction raids and pressure by depth.
function updateUnderrealmHostiles(state, config) {
  const underrealm = state && state.underrealm;
  if (!underrealm || underrealm.enabled === false) {
    return;
  }
  const hostiles = getUnderrealmHostileConfig(config);
  const shrineConfig = getUnderrealmShrineConfig(config);
  if (!hostiles.enabled) {
    return;
  }
  const deepFaction = underrealm.deepFaction;
  const active = deepFaction.activeRaidsByDepth || {};
  const cooldowns = deepFaction.cooldownByDepth || {};
  const maxUnlockedDepth = Math.max(0, Math.floor(Number(underrealm.maxUnlockedDepth || 0)));
  for (let depth = 1; depth <= maxUnlockedDepth; depth += 1) {
    const depthKey = String(depth);
    const activeRaid = active[depthKey];
    if (activeRaid) {
      tickDeepRaid(state, config, hostiles, activeRaid);
      if (activeRaid.ticksRemaining <= 0) {
        delete active[depthKey];
        cooldowns[depthKey] = hostiles.cooldownTicks;
        deepFaction.stats.raidsResolved = Number(deepFaction.stats.raidsResolved || 0) + 1;
      }
      continue;
    }
    if (Number(cooldowns[depthKey] || 0) > 0) {
      cooldowns[depthKey] = Number(cooldowns[depthKey] || 0) - 1;
      continue;
    }
    if (state.tick % hostiles.checkInterval !== 0) {
      continue;
    }
    const assigned = Number((underrealm.crew && underrealm.crew.assignedByDepth
      && underrealm.crew.assignedByDepth[depthKey]) || 0);
    if (assigned < hostiles.minCrewForSpawn) {
      continue;
    }
    const layer = findUnderrealmLayer(underrealm, depth);
    const difficulty = Math.max(0, Number(layer && layer.difficultyMultiplier || 1));
    const chance = clamp(
      (hostiles.spawnChanceBase + hostiles.spawnChancePerDepth * Math.max(0, depth - 1))
      * difficulty
      * (1 + assigned / 24),
      0,
      0.95,
    );
    if (Math.random() >= chance) {
      continue;
    }
    const raid = createDeepRaid(state, config, depth, layer, hostiles);
    const wardResult = applyShrineWardOnRaidStart(state, shrineConfig, depth, raid);
    active[depthKey] = raid;
    deepFaction.stats.raidsStarted = Number(deepFaction.stats.raidsStarted || 0) + 1;
    const wardText = wardResult.usedCharges > 0
      ? `, ward charges ${wardResult.usedCharges} spent`
      : '';
    pushEvent(
      state,
      config,
      `Underrealm D${depth}: ${active[depthKey].factionLabel} emerge from the dark${wardText}`,
    );
  }
  deepFaction.activeRaidsByDepth = active;
  deepFaction.cooldownByDepth = cooldowns;
}

// Create a deep raid descriptor for one depth.
function createDeepRaid(state, config, depth, layer, hostiles) {
  const faction = pickWeightedFaction(hostiles.factions);
  const duration = hostiles.raidDurationBase + hostiles.raidDurationPerDepth * Math.max(0, depth - 1);
  const depthDifficulty = Math.max(1, Number(layer && layer.difficultyMultiplier || 1));
  const baseStrength = (
    hostiles.strengthBase
    + hostiles.strengthPerDepth * Math.max(0, depth - 1)
  ) * depthDifficulty;
  const alchemyStrength = getAlchemyMultiplier(state, config, 'underrealmRaidStrength', 1);
  const schismStrength = resolveSchismUnderrealmMultiplier(
    state,
    'underrealmRaidStrength',
    { boostScale: 0.6, penaltyScale: 0.9, min: 0.35, max: 1.6 },
  );
  const strength = Math.max(0, baseStrength * alchemyStrength * schismStrength);
  return {
    depth,
    factionId: faction.id,
    factionLabel: faction.label,
    ticksRemaining: Math.max(1, Math.floor(duration)),
    strength,
    wardChargesUsed: 0,
    wardLossMultiplier: 1,
    casualties: 0,
    losses: {},
  };
}

// Spend available ward charges when a deep raid starts and apply mitigation to the raid.
function applyShrineWardOnRaidStart(state, shrineConfig, depth, raid) {
  const result = {
    usedCharges: 0,
    strengthMultiplier: 1,
    lossMultiplier: 1,
  };
  if (!state || !state.underrealm || !state.underrealm.shrines || !raid) {
    return result;
  }
  if (!shrineConfig || !shrineConfig.enabled || !shrineConfig.ward.enabled) {
    return result;
  }
  const wardConfig = shrineConfig.ward;
  const depthKey = String(depth);
  const chargesMap = state.underrealm.shrines.wardChargesByDepth || {};
  const available = Math.max(0, Math.floor(Number(chargesMap[depthKey] || 0)));
  if (available <= 0) {
    return result;
  }
  const desired = Math.max(0, Math.floor(Number(wardConfig.consumeOnRaidStart || 0)));
  const maxUse = Math.max(0, Math.floor(Number(wardConfig.consumeMaxPerRaid || 0)));
  const target = maxUse > 0 ? Math.min(maxUse, desired) : desired;
  const used = Math.max(0, Math.min(available, target));
  if (used <= 0) {
    return result;
  }
  chargesMap[depthKey] = available - used;
  const strengthReduction = clamp(used * wardConfig.strengthReductionPerCharge, 0, 0.9);
  const lossReduction = clamp(used * wardConfig.lossReductionPerCharge, 0, 0.95);
  result.usedCharges = used;
  result.strengthMultiplier = Math.max(0.1, 1 - strengthReduction);
  result.lossMultiplier = Math.max(0.05, 1 - lossReduction);
  raid.strength = Math.max(0, Number(raid.strength || 0) * result.strengthMultiplier);
  raid.wardChargesUsed = used;
  raid.wardLossMultiplier = result.lossMultiplier;
  state.underrealm.shrines.stats.chargesSpent = Number(
    state.underrealm.shrines.stats.chargesSpent || 0,
  ) + used;
  return result;
}

// Advance one deep raid tick: casualties, stockpile losses, and timer.
function tickDeepRaid(state, config, hostiles, raid) {
  if (!raid) {
    return;
  }
  const underrealm = state.underrealm;
  const crew = underrealm.crew || {};
  const depthKey = String(raid.depth);
  const roleCounts = (crew.rolesByDepth && crew.rolesByDepth[depthKey]) || {};
  const members = (crew.membersByDepth && crew.membersByDepth[depthKey]) || [];
  const guards = Math.max(0, Number(roleCounts.guard || 0));
  const mitigation = clamp(guards * hostiles.guardMitigationPerGuard, 0, 0.9);
  const schismCasualtyMultiplier = resolveSchismUnderrealmMultiplier(
    state,
    'underrealmRaidCasualty',
    { boostScale: 0.5, penaltyScale: 0.85, min: 0.45, max: 1.5 },
  );
  if (members.length > 0) {
    const casualtyChance = clamp(
      hostiles.casualtyRate * raid.strength * (1 - mitigation) * schismCasualtyMultiplier,
      0,
      0.95,
    );
    if (Math.random() < casualtyChance) {
      const lossRatio = clamp(hostiles.casualtySeverity * raid.strength * (1 - mitigation), 0, 1);
      const deaths = Math.max(1, Math.floor(members.length * lossRatio));
      const deadIds = sampleIds(members, deaths);
      const removed = applyDwarfDeaths(state, deadIds, 'deepRaid');
      if (removed > 0) {
        raid.casualties += removed;
        const stats = underrealm.deepFaction.stats;
        stats.deaths = Number(stats.deaths || 0) + removed;
        pushEvent(
          state,
          config,
          `Underrealm D${raid.depth}: ${removed} delvers lost against ${raid.factionLabel}`,
        );
      }
    }
  }
  if (raid.ticksRemaining % hostiles.stockpileLossTickInterval === 0) {
    const alchemyLoss = getAlchemyMultiplier(state, config, 'underrealmRaidLoss', 1);
    const schismLossMultiplier = resolveSchismUnderrealmMultiplier(
      state,
      'underrealmRaidLoss',
      { boostScale: 0.5, penaltyScale: 0.85, min: 0.45, max: 1.5 },
    );
    const wardLossMultiplier = clamp(Number(raid.wardLossMultiplier || 1), 0.05, 1);
    const ratio = clamp(
      (hostiles.stockpileLossBase + hostiles.stockpileLossPerDepth * Math.max(0, raid.depth - 1))
      * raid.strength
      * (1 - mitigation)
      * alchemyLoss
      * schismLossMultiplier
      * wardLossMultiplier,
      0,
      0.5,
    );
    const losses = applyStockpileLoss(state, ratio, hostiles.lossWeights);
    mergeLossMap(raid.losses, losses);
    mergeLossMap(underrealm.deepFaction.stats.losses, losses);
  }
  raid.ticksRemaining = Math.max(0, Number(raid.ticksRemaining || 0) - 1);
  if (raid.ticksRemaining > 0) {
    return;
  }
  const lossSummary = formatLossSummary(raid.losses);
  if (raid.casualties > 0 || lossSummary) {
    pushEvent(
      state,
      config,
      `Underrealm D${raid.depth}: raid broken (${raid.casualties} lost${lossSummary ? `, ${lossSummary}` : ''})`,
    );
  } else {
    pushEvent(state, config, `Underrealm D${raid.depth}: ${raid.factionLabel} repelled`);
  }
}

// Apply weighted resource losses to stockpile.
function applyStockpileLoss(state, ratio, weights) {
  const stockpile = state && state.stockpile ? state.stockpile : {};
  const losses = {};
  for (const [resourceId, amountRaw] of Object.entries(stockpile)) {
    const weight = Math.max(0, Number((weights && weights[resourceId]) || 0));
    if (weight <= 0) {
      continue;
    }
    const amount = Math.max(0, Number(amountRaw || 0));
    if (amount <= 0) {
      continue;
    }
    const loss = Math.max(0, Math.floor(amount * ratio * weight));
    if (loss <= 0) {
      continue;
    }
    stockpile[resourceId] = amount - loss;
    losses[resourceId] = loss;
  }
  return losses;
}

// Remove dead dwarves and clean partner/pregnancy references.
function applyDwarfDeaths(state, ids, cause) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return 0;
  }
  const deadIds = new Set(ids);
  const before = state.dwarves.length;
  state.dwarves = state.dwarves.filter((dwarf) => !deadIds.has(dwarf.id));
  const removed = before - state.dwarves.length;
  if (removed <= 0) {
    return 0;
  }
  state.jobs = (state.jobs || []).filter((job) => !deadIds.has(job.dwarfId));
  state.deathsCount = Number(state.deathsCount || 0) + removed;
  state.lastDeathTick = Number(state.tick || 0);
  state.deathsByCause = state.deathsByCause || {};
  const key = cause || 'deepRaid';
  state.deathsByCause[key] = Number(state.deathsByCause[key] || 0) + removed;
  for (const dwarf of state.dwarves) {
    if (dwarf.partnerId && deadIds.has(dwarf.partnerId)) {
      dwarf.partnerId = null;
      dwarf.bondTargetId = null;
      dwarf.bondScore = 0;
    }
    if (dwarf.pregnancy && deadIds.has(dwarf.pregnancy.partnerId)) {
      dwarf.pregnancy = null;
    }
  }
  return removed;
}

// Sample up to count ids from a list without replacement.
function sampleIds(ids, count) {
  const pool = Array.isArray(ids) ? ids.slice() : [];
  const target = Math.max(0, Math.min(pool.length, Math.floor(Number(count || 0))));
  const result = [];
  for (let i = 0; i < target; i += 1) {
    if (pool.length === 0) {
      break;
    }
    const index = Math.floor(Math.random() * pool.length);
    result.push(pool[index]);
    pool.splice(index, 1);
  }
  return result;
}

// Merge source loss map into target map.
function mergeLossMap(target, source) {
  if (!target || !source) {
    return;
  }
  for (const [resourceId, amountRaw] of Object.entries(source)) {
    const amount = Math.max(0, Number(amountRaw || 0));
    if (amount <= 0) {
      continue;
    }
    target[resourceId] = Number(target[resourceId] || 0) + amount;
  }
}

// Format a compact loss summary for event lines.
function formatLossSummary(losses) {
  const parts = [];
  for (const [resourceId, amountRaw] of Object.entries(losses || {})) {
    const amount = Math.max(0, Number(amountRaw || 0));
    if (amount <= 0) {
      continue;
    }
    parts.push(`${resourceId}-${amount}`);
    if (parts.length >= 3) {
      break;
    }
  }
  return parts.join(' ');
}

// Find a layer entry by depth number.
function findUnderrealmLayer(underrealm, depth) {
  return (underrealm.layers || [])
    .find((layer) => Number(layer && layer.depth) === Number(depth));
}

// Resolve one combat floor entry by depth, creating fallback shape when missing.
function resolveUnderrealmCombatFloor(combat, depth, maxUnlockedDepth = 0) {
  if (!combat || !combat.floorsByDepth || typeof combat.floorsByDepth !== 'object') {
    return null;
  }
  const safeDepth = Math.max(1, Math.floor(Number(depth || 1)));
  const key = String(safeDepth);
  if (!combat.floorsByDepth[key]) {
    combat.floorsByDepth[key] = createFallbackUnderrealmCombatFloor(
      safeDepth,
      Math.max(0, Math.floor(Number(maxUnlockedDepth || 0))),
    );
  }
  return combat.floorsByDepth[key] || null;
}

// Return active raid descriptor for a depth, or null.
function getActiveRaidForDepth(state, depth) {
  const deepFaction = state
    && state.underrealm
    && state.underrealm.deepFaction;
  if (!deepFaction || !deepFaction.activeRaidsByDepth) {
    return null;
  }
  return deepFaction.activeRaidsByDepth[String(depth)] || null;
}

// Normalize node templates from config fallback values.
function normalizeNodeTemplates(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const templates = {};
  for (const [resourceId, fallback] of Object.entries(DEFAULT_NODE_TEMPLATES)) {
    const cfg = source[resourceId] || {};
    templates[resourceId] = {
      enabled: cfg.enabled !== false && fallback.enabled !== false,
      minDepth: Math.max(1, Math.floor(Number(cfg.min_depth ?? fallback.minDepth))),
      baseNodes: Math.max(0, Math.floor(Number(cfg.base_nodes ?? fallback.baseNodes))),
      nodesPerDepth: Math.max(0, Math.floor(Number(cfg.nodes_per_depth ?? fallback.nodesPerDepth))),
      capacityMin: Math.max(1, Math.floor(Number(cfg.capacity_min ?? fallback.capacityMin))),
      capacityMax: Math.max(1, Math.floor(Number(cfg.capacity_max ?? fallback.capacityMax))),
      yieldMin: Math.max(1, Math.floor(Number(cfg.yield_min ?? fallback.yieldMin))),
      yieldMax: Math.max(1, Math.floor(Number(cfg.yield_max ?? fallback.yieldMax))),
    };
  }
  return templates;
}

// Normalize rare-drop entries from config fallback values.
function normalizeRareDrops(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const drops = {};
  for (const [resourceId, fallback] of Object.entries(DEFAULT_RARE_DROPS)) {
    const cfg = source[resourceId] || {};
    drops[resourceId] = {
      minDepth: Math.max(1, Math.floor(Number(cfg.min_depth ?? fallback.minDepth))),
      chance: clamp(Number(cfg.chance ?? fallback.chance), 0, 1),
      amountMin: Math.max(1, Math.floor(Number(cfg.amount_min ?? fallback.amountMin))),
      amountMax: Math.max(1, Math.floor(Number(cfg.amount_max ?? fallback.amountMax))),
    };
  }
  return drops;
}

// Normalize hostile faction table.
function normalizeFactions(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const factions = [];
  for (const [factionId, fallback] of Object.entries(DEFAULT_FACTIONS)) {
    const cfg = source[factionId] || {};
    factions.push({
      id: factionId,
      label: String(cfg.label || fallback.label),
      weight: Math.max(0, Number(cfg.weight ?? fallback.weight)),
    });
  }
  if (factions.every((entry) => entry.weight <= 0)) {
    for (const entry of factions) {
      entry.weight = 1;
    }
  }
  return factions;
}

// Pick one hostile faction based on configured weights.
function pickWeightedFaction(factions) {
  const list = Array.isArray(factions) ? factions : [];
  if (list.length === 0) {
    return { id: 'deep_hostiles', label: 'Deep Hostiles' };
  }
  const total = list.reduce((sum, entry) => sum + Math.max(0, Number(entry.weight || 0)), 0);
  if (total <= 0) {
    return list[0];
  }
  let roll = Math.random() * total;
  for (const entry of list) {
    const weight = Math.max(0, Number(entry.weight || 0));
    if (roll < weight) {
      return entry;
    }
    roll -= weight;
  }
  return list[list.length - 1];
}

// Normalize weighted stockpile-loss map for hostile raids.
function normalizeLossWeights(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const defaults = {
    food: 0.2,
    water: 0.2,
    stone: 0.5,
    iron: 0.6,
    mithril: 1,
    adamantio: 1,
    mana_crystal: 1,
    embersteel: 1,
    ironshade: 1,
    void_shard: 1,
    ember_resin: 1,
  };
  const weights = {};
  for (const [resourceId, fallback] of Object.entries(defaults)) {
    weights[resourceId] = Math.max(0, Number(source[resourceId] ?? fallback));
  }
  return weights;
}

// Normalize a resource-cost map with non-negative integer values.
function normalizeCostMap(raw, fallback) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const base = fallback && typeof fallback === 'object' ? fallback : {};
  const keys = new Set([
    ...Object.keys(base),
    ...Object.keys(source),
  ]);
  const map = {};
  for (const key of keys) {
    const amount = Math.max(0, Math.floor(Number(source[key] ?? base[key] ?? 0)));
    if (amount > 0) {
      map[key] = amount;
    }
  }
  return map;
}

// Build depth-scaled resource costs from base + per-depth increments.
function buildDepthCostMap(baseMap, perDepthMap, depth) {
  const safeDepth = Math.max(1, Math.floor(Number(depth || 1)));
  const depthOffset = Math.max(0, safeDepth - 1);
  const base = baseMap && typeof baseMap === 'object' ? baseMap : {};
  const perDepth = perDepthMap && typeof perDepthMap === 'object' ? perDepthMap : {};
  const keys = new Set([
    ...Object.keys(base),
    ...Object.keys(perDepth),
  ]);
  const map = {};
  for (const key of keys) {
    const fixed = Math.max(0, Math.floor(Number(base[key] || 0)));
    const extra = Math.max(0, Math.floor(Number(perDepth[key] || 0)));
    const amount = fixed + extra * depthOffset;
    if (amount > 0) {
      map[key] = amount;
    }
  }
  return map;
}

// Check whether every required resource amount is available in a map.
function hasCostResources(resourceMap, requiredMap) {
  const available = resourceMap && typeof resourceMap === 'object' ? resourceMap : {};
  const required = requiredMap && typeof requiredMap === 'object' ? requiredMap : {};
  for (const [resourceId, amountRaw] of Object.entries(required)) {
    const amount = Math.max(0, Number(amountRaw || 0));
    if (amount <= 0) {
      continue;
    }
    if (Math.max(0, Number(available[resourceId] || 0)) < amount) {
      return false;
    }
  }
  return true;
}

// Consume required resource costs from a mutable stockpile map.
function consumeCostResources(resourceMap, requiredMap) {
  if (!resourceMap || typeof resourceMap !== 'object') {
    return;
  }
  const required = requiredMap && typeof requiredMap === 'object' ? requiredMap : {};
  for (const [resourceId, amountRaw] of Object.entries(required)) {
    const amount = Math.max(0, Math.floor(Number(amountRaw || 0)));
    if (amount <= 0) {
      continue;
    }
    const available = Math.max(0, Math.floor(Number(resourceMap[resourceId] || 0)));
    resourceMap[resourceId] = Math.max(0, available - amount);
  }
}

// Build an idle Deep Lift runtime state.
function buildIdleLiftState() {
  return {
    active: false,
    fromDepth: 0,
    targetDepth: 0,
    startedTick: 0,
    ticksRemaining: 0,
    totalTicks: 0,
    progressRemainder: 0,
    requiredSurveyRatio: 0,
    requiredStockpile: {},
    requiredMined: {},
  };
}

// Add amount to a stockpile map key, preserving non-negative numbers.
function addStockpileResource(stockpile, resourceId, amountRaw) {
  if (!stockpile || !resourceId) {
    return;
  }
  const amount = Math.max(0, Number(amountRaw || 0));
  if (amount <= 0) {
    return;
  }
  stockpile[resourceId] = Math.max(0, Number(stockpile[resourceId] || 0)) + amount;
}

// Add amount to a nested numeric map key.
function addNestedValue(map, key, amountRaw) {
  if (!map || !key) {
    return;
  }
  const amount = Math.max(0, Number(amountRaw || 0));
  if (amount <= 0) {
    return;
  }
  map[key] = Number(map[key] || 0) + amount;
}

// Stable ordering by spawnIndex and then id.
function compareDwarvesBySpawn(left, right) {
  const leftSpawn = Number(left && left.spawnIndex || 0);
  const rightSpawn = Number(right && right.spawnIndex || 0);
  if (leftSpawn !== rightSpawn) {
    return leftSpawn - rightSpawn;
  }
  const leftId = String(left && left.id || '');
  const rightId = String(right && right.id || '');
  return leftId.localeCompare(rightId);
}

// Build a deterministic random generator from a numeric seed.
function createDeterministicRng(seedRaw) {
  let seed = (Math.floor(Number(seedRaw || 1)) >>> 0) || 1;
  return () => {
    seed += 0x6d2b79f5;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// Get a random integer in [min, max] using a supplied RNG.
function randomInt(minRaw, maxRaw, rng) {
  const min = Math.floor(Number(minRaw || 0));
  const max = Math.floor(Number(maxRaw || min));
  if (max <= min) {
    return min;
  }
  const roll = typeof rng === 'function' ? rng() : Math.random();
  return Math.floor(roll * (max - min + 1)) + min;
}

module.exports = { updateUnderrealm };
