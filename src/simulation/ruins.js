'use strict';

const { clamp } = require('../utils');
const { getClanEffects, getClanList, getClanShareByIds } = require('../clans');
const { getStockpileRatio, hasInputs, consumeInputs } = require('./resources');
const { pushEvent } = require('./events');
const { getMythMultiplier } = require('./myths');
const { getAlchemyMultiplier } = require('./alchemy');
const { getContractRuinsCombatBonus } = require('./contracts');
const { isAdult } = require('./population');

// Resolve a weighted clan bonus for an expedition effect key.
function getClanExpeditionBonus(state, config, expedition, effectKey) {
  const clanList = getClanList(config);
  if (clanList.length === 0 || !expedition) {
    return 0;
  }
  const dwarfIds = expedition.dwarfIds || [];
  let bonus = 0;
  for (const clanId of clanList) {
    const effects = getClanEffects(config, clanId);
    const value = Math.max(0, Number(effects[effectKey] || 0));
    if (value <= 0) {
      continue;
    }
    const share = getClanShareByIds(state.dwarves, dwarfIds, clanId);
    bonus += value * share;
  }
  return bonus;
}

function updateRuins(state, config, runtime) {
  const ruinsConfig = (config && config.ruins) || {};
  if (ruinsConfig.enabled === false) {
    return;
  }
  if (!state.ruins) {
    state.ruins = createDefaultRuinsState(ruinsConfig);
  }
  const ruins = state.ruins;
  if (!ruins.bonuses) {
    recomputeBonuses(state, ruinsConfig);
  }
  if (!ruins.stats) {
    ruins.stats = {
      started: 0,
      successes: 0,
      failures: 0,
      artifacts: 0,
      lastOutcome: null,
      lastOutcomeTick: 0,
      lastSuccesses: 0,
      lastFailures: 0,
      lastArtifactsFound: 0,
    };
  } else {
    if (!Number.isFinite(ruins.stats.lastOutcomeTick)) {
      ruins.stats.lastOutcomeTick = 0;
    }
    if (!Number.isFinite(ruins.stats.lastSuccesses)) {
      ruins.stats.lastSuccesses = 0;
    }
    if (!Number.isFinite(ruins.stats.lastFailures)) {
      ruins.stats.lastFailures = 0;
    }
    if (!Number.isFinite(ruins.stats.lastArtifactsFound)) {
      ruins.stats.lastArtifactsFound = 0;
    }
  }
  if (!ruins.artifactsFound) {
    ruins.artifactsFound = {};
  }
  if (!ruins.readinessGate || typeof ruins.readinessGate !== 'object') {
    ruins.readinessGate = createDefaultReadinessGateState();
  }
  if (!Array.isArray(ruins.expeditions)) {
    ruins.expeditions = [];
  }
  if (ruins.expedition) {
    if (ruins.expedition.active) {
      ruins.expeditions.push(ruins.expedition);
    }
    ruins.expedition = null;
  }
  ruins.expeditions = ruins.expeditions.filter((expedition) => expedition && expedition.active !== false);
  const rooms = Array.isArray(ruinsConfig.rooms) ? ruinsConfig.rooms : [];
  ruins.roomCount = rooms.length;
  if (rooms.length === 0) {
    return;
  }

  const hadActive = ruins.expeditions.length > 0;
  if (hadActive) {
    tickExpeditions(state, config, ruinsConfig, rooms);
  }

  const ignoreCooldown = shouldIgnoreCooldown(ruins, ruinsConfig, rooms);
  if (hadActive && !ignoreCooldown) {
    return;
  }

  if (ruins.cooldown > 0) {
    ruins.cooldown = Math.max(0, Number(ruins.cooldown || 0) - 1);
  }

  if (!ignoreCooldown && ruins.cooldown > 0) {
    return;
  }

  const maxConcurrent = resolveMaxConcurrent(ruins, ruinsConfig, rooms);
  let activeCount = ruins.expeditions.length;
  if (activeCount >= maxConcurrent) {
    return;
  }

  while (activeCount < maxConcurrent) {
    const startContext = buildExpeditionStartContext(state, config, ruinsConfig, rooms);
    if (!startContext) {
      return;
    }
    startExpedition(state, config, ruinsConfig, rooms, startContext);
    activeCount += 1;
  }
}

function createDefaultRuinsState(ruinsConfig) {
  const rooms = Array.isArray(ruinsConfig.rooms) ? ruinsConfig.rooms : [];
  return {
    enabled: true,
    roomsCleared: 0,
    roomCount: rooms.length,
    expeditions: [],
    cooldown: 0,
    artifactsFound: {},
    setCounts: {},
    bonuses: {
      outputMultiplier: 0,
      hazardReduction: 0,
      combatBonus: 0,
      artifactChanceBonus: 0,
      casualtyReduction: 0,
      activeCombos: [],
    },
    stats: {
      started: 0,
      successes: 0,
      failures: 0,
      artifacts: 0,
      lastOutcome: null,
      lastOutcomeTick: 0,
      lastSuccesses: 0,
      lastFailures: 0,
      lastArtifactsFound: 0,
    },
    readinessGate: createDefaultReadinessGateState(),
  };
}

// Build default readiness gate runtime state for ruins dispatch decisions.
function createDefaultReadinessGateState() {
  return {
    depth: 0,
    roomIndex: 0,
    status: 'unknown',
    reason: null,
    score: 0,
    minScore: 0,
    recommendedScore: 0,
    armoryLevel: 0,
    minArmoryLevel: 1,
    partySize: 0,
    offense: 0,
    defense: 0,
    support: 0,
    warningRiskMultiplier: 1,
    championCooldownTicks: 0,
    tick: 0,
    lastBlockedTick: 0,
    lastBlockedReason: null,
    lastBlockedDepth: 0,
  };
}

// Build a validated start context for a ruins expedition, or return null if blocked.
function buildExpeditionStartContext(state, config, ruinsConfig, rooms) {
  const expeditionConfig = ruinsConfig.expedition || {};
  if (!hasStructure(state, 'ruins')) {
    return null;
  }
  if (state.ruins.roomsCleared >= rooms.length && allArtifactsFound(ruinsConfig, state.ruins)) {
    return null;
  }
  if (expeditionConfig.requiresArmory && !hasStructure(state, 'armory')) {
    return null;
  }
  const kitResource = expeditionConfig.kitResource || 'expedition_kit';
  if (Number(state.stockpile[kitResource] || 0) < 1) {
    return null;
  }
  const minPopulation = Math.max(0, Number(expeditionConfig.minPopulation || 0));
  if (minPopulation > 0 && state.dwarves.length < minPopulation) {
    return null;
  }
  const idleAdults = getIdleAdults(state, config);
  const minIdle = Math.max(0, Number(expeditionConfig.minIdleAdults || 0));
  if (minIdle > 0 && idleAdults.length < minIdle) {
    return null;
  }
  const minRatios = expeditionConfig.minStockpileRatio || {};
  for (const [resource, ratioRaw] of Object.entries(minRatios)) {
    const minRatio = clamp(Number(ratioRaw || 0), 0, 1);
    if (minRatio <= 0) {
      continue;
    }
    const ratio = getStockpileRatio(state, config, resource);
    if (ratio < minRatio) {
      return null;
    }
  }

  const roomIndex = Math.max(0, Math.min(rooms.length - 1, Number(state.ruins.roomsCleared || 0)));
  const room = rooms[roomIndex];
  if (!room) {
    return null;
  }
  const cost = room.cost || {};
  if (Object.keys(cost).length > 0 && !hasInputs(state.stockpile, cost)) {
    return null;
  }

  const partySize = resolvePartySize(room, expeditionConfig, idleAdults.length);
  if (partySize <= 0) {
    return null;
  }

  const readinessGate = evaluateExpeditionReadinessGate(
    state,
    config,
    roomIndex,
    partySize,
    kitResource,
  );
  const dispatchGate = evaluateChampionDispatchGate(state, readinessGate);
  updateReadinessGateState(state, config, dispatchGate);
  if (dispatchGate.status === 'blocked') {
    return null;
  }

  return {
    expeditionConfig,
    kitResource,
    roomIndex,
    room,
    cost,
    idleAdults,
    partySize,
    readinessGate: dispatchGate,
  };
}

// Apply champion encounter dispatch constraints on top of readiness gate checks.
function evaluateChampionDispatchGate(state, readinessGate) {
  const gate = readinessGate && typeof readinessGate === 'object'
    ? { ...readinessGate }
    : createDefaultReadinessGateState();
  gate.championCooldownTicks = Math.max(0, Math.floor(Number(gate.championCooldownTicks || 0)));
  if (gate.status === 'blocked') {
    return gate;
  }
  const underrealm = state && state.underrealm;
  const combat = underrealm && underrealm.combat;
  if (!combat || combat.enabled === false) {
    return gate;
  }
  if (String(combat.progressionMode || 'champion_gate') !== 'champion_gate') {
    return gate;
  }
  const depth = Math.max(1, Math.floor(Number(gate.depth || 1)));
  const floor = resolveUnderrealmCombatFloor(combat, depth);
  if (!floor || floor.unlocked !== true) {
    return gate;
  }
  const championRequired = Boolean(
    floor.unlock
    && floor.unlock.required === true
    && floor.champion
    && floor.champion.enabled !== false
    && floor.unlock.cleared !== true,
  );
  if (!championRequired || floor.state !== 'contested') {
    return gate;
  }
  const cooldown = Math.max(
    0,
    Math.floor(Number(floor.encounter && floor.encounter.cooldownTicksRemaining || 0)),
  );
  if (cooldown <= 0) {
    return gate;
  }
  return {
    ...gate,
    status: 'blocked',
    reason: 'champion_cooldown',
    championCooldownTicks: cooldown,
  };
}

// Evaluate Underrealm readiness gate for one expedition dispatch.
function evaluateExpeditionReadinessGate(state, config, roomIndex, partySize, kitResource) {
  const safeRoomIndex = Math.max(0, Math.floor(Number(roomIndex || 0)));
  const safePartySize = Math.max(1, Math.floor(Number(partySize || 1)));
  const depth = resolveExpeditionDepth(safeRoomIndex, state && state.underrealm);
  const defaultGate = {
    depth,
    roomIndex: safeRoomIndex,
    status: 'ready',
    reason: 'combat_disabled',
    score: 0,
    minScore: 0,
    recommendedScore: 0,
    armoryLevel: resolveArmoryLevel(state),
    minArmoryLevel: 1,
    partySize: safePartySize,
    offense: 0,
    defense: 0,
    support: 0,
    warningRiskMultiplier: 1,
    championCooldownTicks: 0,
  };
  const underrealm = state && state.underrealm;
  const combat = underrealm && underrealm.combat;
  if (!combat || combat.enabled === false) {
    return defaultGate;
  }
  const floor = resolveUnderrealmCombatFloor(combat, depth);
  const minScore = Math.max(
    0,
    Number(floor && floor.readiness ? floor.readiness.minScore : 0),
  );
  const recommendedScore = Math.max(
    minScore,
    Number(floor && floor.readiness ? floor.readiness.recommendedScore : minScore),
  );
  const minArmoryLevel = Math.max(
    1,
    Math.floor(Number(floor && floor.minArmoryLevel ? floor.minArmoryLevel : 1)),
  );
  const armoryLevel = resolveArmoryLevel(state);
  const stockpile = state && state.stockpile ? state.stockpile : {};
  const maxTier = resolveMaxEquipmentTier(config, combat);
  const weights = combat.readiness && combat.readiness.scoreWeights
    ? combat.readiness.scoreWeights
    : {};
  const formula = combat.readiness && combat.readiness.formula
    ? combat.readiness.formula
    : {};
  const weaponPower = collectTopTierPower(stockpile, 'weapon_tier_', maxTier, safePartySize);
  const armorPower = collectTopTierPower(stockpile, 'armor_tier_', maxTier, safePartySize);
  const kits = Math.max(0, Math.floor(Number(stockpile[kitResource] || 0)));
  const kitCoverage = clamp(kits / safePartySize, 0, 1);
  const weaponAvgTier = weaponPower / safePartySize;
  const armorAvgTier = armorPower / safePartySize;
  const offense = Math.max(0, weaponAvgTier * Math.max(0, Number(formula.weaponAvgTierScale ?? 6)));
  const defense = Math.max(0, armorAvgTier * Math.max(0, Number(formula.armorAvgTierScale ?? 6)));
  const support = Math.max(
    0,
    kitCoverage * Math.max(0, Number(formula.supportKitFullScale ?? 8))
      + armoryLevel * Math.max(0, Number(formula.supportArmoryLevelScale ?? 1)),
  );
  const score = Math.max(
    0,
    offense * Math.max(0, Number(weights.offense ?? 1))
      + defense * Math.max(0, Number(weights.defense ?? 1))
      + support * Math.max(0, Number(weights.support ?? 0.8)),
  );

  let status = 'ready';
  let reason = 'recommended_ready';
  let warningRiskMultiplier = 1;
  if (armoryLevel < minArmoryLevel) {
    status = 'blocked';
    reason = 'armory_level';
  } else if (combat.readiness && combat.readiness.hardMinGate !== false && score < minScore) {
    status = 'blocked';
    reason = 'min_score';
  } else if (score < recommendedScore) {
    status = 'warning';
    reason = 'warning_zone';
    warningRiskMultiplier = Math.max(
      1,
      Number(combat.readiness.warningZoneRiskMultiplier ?? 1),
    );
  }
  return {
    depth,
    roomIndex: safeRoomIndex,
    status,
    reason,
    score,
    minScore,
    recommendedScore,
    armoryLevel,
    minArmoryLevel,
    partySize: safePartySize,
    offense,
    defense,
    support,
    warningRiskMultiplier,
    championCooldownTicks: 0,
  };
}

// Persist readiness gate snapshot and emit one-time block transitions.
function updateReadinessGateState(state, config, gate) {
  if (!state || !state.ruins || !gate) {
    return;
  }
  const previous = state.ruins.readinessGate && typeof state.ruins.readinessGate === 'object'
    ? state.ruins.readinessGate
    : createDefaultReadinessGateState();
  const tick = Math.max(0, Math.floor(Number(state.tick || 0)));
  const transitionedToBlocked = gate.status === 'blocked'
    && (
      previous.status !== 'blocked'
      || previous.reason !== gate.reason
      || Number(previous.depth || 0) !== Number(gate.depth || 0)
    );
  const readinessGate = {
    ...previous,
    ...gate,
    tick,
    lastBlockedTick: transitionedToBlocked ? tick : Number(previous.lastBlockedTick || 0),
    lastBlockedReason: transitionedToBlocked
      ? (gate.reason || null)
      : (previous.lastBlockedReason || null),
    lastBlockedDepth: transitionedToBlocked
      ? Math.max(0, Math.floor(Number(gate.depth || 0)))
      : Math.max(0, Math.floor(Number(previous.lastBlockedDepth || 0))),
  };
  state.ruins.readinessGate = readinessGate;

  const floor = resolveUnderrealmCombatFloor(
    state && state.underrealm && state.underrealm.combat,
    readinessGate.depth,
  );
  if (floor && typeof floor === 'object') {
    floor.readinessSnapshot = {
      score: Math.max(0, Number(readinessGate.score || 0)),
      offense: Math.max(0, Number(readinessGate.offense || 0)),
      defense: Math.max(0, Number(readinessGate.defense || 0)),
      support: Math.max(0, Number(readinessGate.support || 0)),
      partySize: Math.max(0, Math.floor(Number(readinessGate.partySize || 0))),
      armoryLevel: Math.max(0, Math.floor(Number(readinessGate.armoryLevel || 0))),
      tick,
    };
    floor.dispatchGate = {
      status: readinessGate.status || 'unknown',
      reason: readinessGate.reason || null,
      warningRiskMultiplier: Math.max(1, Number(readinessGate.warningRiskMultiplier || 1)),
      tick,
    };
  }

  if (!transitionedToBlocked) {
    return;
  }
  const combatStats = getUnderrealmCombatStats(state);
  if (combatStats) {
    combatStats.blockedDispatches = Number(combatStats.blockedDispatches || 0) + 1;
  }
  const depth = Math.max(1, Math.floor(Number(readinessGate.depth || 1)));
  if (readinessGate.reason === 'armory_level') {
    pushEvent(
      state,
      config,
      `Ruins: readiness gate blocked D${depth} (armory ${readinessGate.armoryLevel}/${readinessGate.minArmoryLevel})`,
    );
    return;
  }
  if (readinessGate.reason === 'champion_cooldown') {
    const cooldown = Math.max(0, Math.floor(Number(readinessGate.championCooldownTicks || 0)));
    pushEvent(
      state,
      config,
      `Ruins: readiness gate blocked D${depth} (champion cooldown ${cooldown} ticks)`,
    );
    return;
  }
  const score = Math.max(0, Number(readinessGate.score || 0)).toFixed(1);
  const minScore = Math.max(0, Number(readinessGate.minScore || 0)).toFixed(1);
  pushEvent(
    state,
    config,
    `Ruins: readiness gate blocked D${depth} (score ${score}/${minScore})`,
  );
}

// Resolve combat stats object if Underrealm combat runtime is available.
function getUnderrealmCombatStats(state) {
  const stats = state
    && state.underrealm
    && state.underrealm.combat
    && state.underrealm.combat.stats;
  if (!stats || typeof stats !== 'object') {
    return null;
  }
  return stats;
}

// Resolve one Underrealm combat floor object by depth.
function resolveUnderrealmCombatFloor(combat, depth) {
  if (!combat || !combat.floorsByDepth || typeof combat.floorsByDepth !== 'object') {
    return null;
  }
  const key = String(Math.max(1, Math.floor(Number(depth || 1))));
  return combat.floorsByDepth[key] || combat.floorsByDepth[Number(key)] || null;
}

// Map ruins room progression index to an Underrealm combat depth.
function resolveExpeditionDepth(roomIndex, underrealm) {
  const roomDepth = Math.max(1, Math.floor(Number(roomIndex || 0)) + 1);
  const frontierDepth = Math.max(
    1,
    Math.floor(Number(underrealm && underrealm.maxUnlockedDepth || roomDepth)),
  );
  const maxDepth = Math.max(
    1,
    Math.floor(Number(underrealm && underrealm.maxDepth || roomDepth)),
  );
  return clamp(
    Math.max(roomDepth, frontierDepth),
    1,
    maxDepth,
  );
}

// Resolve highest built armory level from current structures.
function resolveArmoryLevel(state) {
  let best = 0;
  for (const structure of (state && state.structures) || []) {
    if (!structure || structure.type !== 'armory') {
      continue;
    }
    best = Math.max(best, Math.max(1, Math.floor(Number(structure.level || 1))));
  }
  return best;
}

// Resolve max equipment tier available in config/runtime schema.
function resolveMaxEquipmentTier(config, combat) {
  const armory = (config && config.structures && config.structures.armory) || {};
  let maxTier = Math.max(1, Math.floor(Number(armory.levelMax || 1)));
  const equipment = armory.equipment || {};
  const recipes = equipment.recipes && typeof equipment.recipes === 'object'
    ? equipment.recipes
    : {};
  for (const recipe of Object.values(recipes)) {
    const tier = Math.max(0, Math.floor(Number(recipe && recipe.tier || 0)));
    if (tier > maxTier) {
      maxTier = tier;
    }
  }
  const floors = combat && combat.floorsByDepth && typeof combat.floorsByDepth === 'object'
    ? combat.floorsByDepth
    : {};
  for (const floor of Object.values(floors)) {
    const required = Math.max(1, Math.floor(Number(floor && floor.minArmoryLevel || 1)));
    if (required > maxTier) {
      maxTier = required;
    }
  }
  return maxTier;
}

// Sum the strongest available tier power for a fixed number of equipment slots.
function collectTopTierPower(stockpile, prefix, maxTier, slots) {
  const safeSlots = Math.max(0, Math.floor(Number(slots || 0)));
  const safeTier = Math.max(1, Math.floor(Number(maxTier || 1)));
  if (safeSlots <= 0) {
    return 0;
  }
  let remaining = safeSlots;
  let power = 0;
  for (let tier = safeTier; tier >= 1; tier -= 1) {
    const resourceId = `${prefix}${tier}`;
    const available = Math.max(0, Math.floor(Number(stockpile && stockpile[resourceId] || 0)));
    if (available <= 0) {
      continue;
    }
    const used = Math.min(remaining, available);
    power += used * tier;
    remaining -= used;
    if (remaining <= 0) {
      break;
    }
  }
  return power;
}

function startExpedition(state, config, ruinsConfig, rooms, startContext = null) {
  const context = startContext || buildExpeditionStartContext(state, config, ruinsConfig, rooms);
  if (!context) {
    return;
  }
  const {
    expeditionConfig,
    kitResource,
    roomIndex,
    room,
    cost,
    idleAdults,
    partySize,
    readinessGate,
  } = context;
  if (Object.keys(cost).length > 0) {
    if (!hasInputs(state.stockpile, cost)) {
      return;
    }
    consumeInputs(state.stockpile, cost);
  }

  if (Number(state.stockpile[kitResource] || 0) < 1) {
    return;
  }
  state.stockpile[kitResource] = Number(state.stockpile[kitResource] || 0) - 1;

  let useMithril = false;
  const mithrilConfig = ruinsConfig.mithrilReinforcement || {};
  if (mithrilConfig.enabled) {
    const minRoom = Math.max(1, Number(mithrilConfig.minRoom || 1));
    if (roomIndex + 1 >= minRoom) {
      const costMithril = mithrilConfig.cost || {};
      if (Object.keys(costMithril).length > 0 && hasInputs(state.stockpile, costMithril)) {
        consumeInputs(state.stockpile, costMithril);
        useMithril = true;
      }
    }
  }

  const selected = idleAdults.slice(0, partySize);
  const dwarfIds = selected.map((dwarf) => dwarf.id);
  for (const dwarf of selected) {
    dwarf.expedition = true;
  }

  const ticks = Math.max(1, Number(room.expeditionTicks || 1));
  const riskMultiplier = Math.max(1, Number(readinessGate.warningRiskMultiplier || 1));
  const expedition = {
    active: true,
    roomIndex,
    ticksRemaining: ticks,
    dwarfIds,
    useMithril,
    readiness: {
      depth: Math.max(1, Math.floor(Number(readinessGate.depth || roomIndex + 1))),
      status: readinessGate.status || 'ready',
      reason: readinessGate.reason || null,
      score: Math.max(0, Number(readinessGate.score || 0)),
      minScore: Math.max(0, Number(readinessGate.minScore || 0)),
      recommendedScore: Math.max(0, Number(readinessGate.recommendedScore || 0)),
      armoryLevel: Math.max(0, Math.floor(Number(readinessGate.armoryLevel || 0))),
      minArmoryLevel: Math.max(1, Math.floor(Number(readinessGate.minArmoryLevel || 1))),
      warningRiskMultiplier: riskMultiplier,
      components: {
        offense: Math.max(0, Number(readinessGate.offense || 0)),
        defense: Math.max(0, Number(readinessGate.defense || 0)),
        support: Math.max(0, Number(readinessGate.support || 0)),
      },
    },
  };
  state.ruins.expeditions = Array.isArray(state.ruins.expeditions) ? state.ruins.expeditions : [];
  state.ruins.expeditions.push(expedition);
  state.ruins.stats.started = Number(state.ruins.stats.started || 0) + 1;
  if (readinessGate.status === 'warning') {
    const depth = Math.max(1, Math.floor(Number(readinessGate.depth || roomIndex + 1)));
    const score = Math.max(0, Number(readinessGate.score || 0)).toFixed(1);
    const target = Math.max(0, Number(readinessGate.recommendedScore || 0)).toFixed(1);
    pushEvent(
      state,
      config,
      `Ruins: warning-zone dispatch D${depth} (score ${score}/${target}, risk x${riskMultiplier.toFixed(2)})`,
    );
  }
  pushEvent(state, config, `Ruins: expedition started (Room ${roomIndex + 1})`);
}

function tickExpeditions(state, config, ruinsConfig, rooms) {
  const expeditions = Array.isArray(state.ruins.expeditions) ? state.ruins.expeditions : [];
  if (expeditions.length === 0) {
    return;
  }
  const active = [];
  for (const expedition of expeditions) {
    if (!expedition || expedition.active === false) {
      continue;
    }
    expedition.ticksRemaining = Number(expedition.ticksRemaining || 0) - 1;
    if (expedition.ticksRemaining > 0) {
      active.push(expedition);
      continue;
    }
    resolveExpedition(state, config, ruinsConfig, rooms, expedition);
  }
  state.ruins.expeditions = active;
}

function resolveExpedition(state, config, ruinsConfig, rooms, expedition) {
  const room = rooms[expedition.roomIndex];
  if (!room) {
    finishExpedition(state, config, ruinsConfig, expedition, false, 'room missing');
    return;
  }

  const bonuses = state.ruins.bonuses || {};
  const clanHazardReduction = getClanExpeditionBonus(state, config, expedition, 'ruins_hazard_reduction');
  const hazardReduction = clamp(Number(bonuses.hazardReduction || 0) + clanHazardReduction, 0, 0.95);
  const mythHazard = getMythMultiplier(state, config, 'ruinsHazard', 1);
  const alchemyHazard = getAlchemyMultiplier(state, config, 'ruinsHazard', 1);
  const readinessRiskMultiplier = clamp(
    Number(
      expedition
      && expedition.readiness
      && expedition.readiness.status === 'warning'
        ? expedition.readiness.warningRiskMultiplier
        : 1,
    ),
    1,
    3,
  );
  const hazardChance = clamp(
    clamp(Number(room.hazardChance || 0), 0, 1) * (1 - hazardReduction) * mythHazard * alchemyHazard * readinessRiskMultiplier,
    0,
    1,
  );

  let guardianSpawned = false;
  let guardianDefeated = false;
  const guardianChance = clamp(Number(room.guardianChance || 0), 0, 1);
  if (guardianChance > 0 && Math.random() < guardianChance) {
    guardianSpawned = true;
    const guardianPower = Math.max(0, Number(room.guardianPower || 0)) * readinessRiskMultiplier;
    const partySize = getExpeditionPartySize(state, expedition);
    const kitPowerBonus = Math.max(0, Number((ruinsConfig.expedition || {}).kitPowerBonus || 0));
    const mithrilPowerBonus = expedition.useMithril
      ? Math.max(0, Number((ruinsConfig.mithrilReinforcement || {}).powerBonus || 0))
      : 0;
    const clanCombatBonus = getClanExpeditionBonus(state, config, expedition, 'ruins_combat_bonus');
    const contractCombatBonus = getContractRuinsCombatBonus(state);
    const combatBonus = Math.max(0, Number(bonuses.combatBonus || 0) + clanCombatBonus + contractCombatBonus);
    const power = partySize * (1 + kitPowerBonus + mithrilPowerBonus + combatBonus);
    if (power >= guardianPower) {
      guardianDefeated = true;
    }
  }

  if (guardianSpawned && !guardianDefeated) {
    finishExpedition(state, config, ruinsConfig, expedition, false, 'guardian');
    return;
  }

  if (hazardChance > 0 && Math.random() < hazardChance) {
    finishExpedition(state, config, ruinsConfig, expedition, false, 'hazard');
    return;
  }
  const championResult = resolveChampionEncounter(state, config, ruinsConfig, expedition);
  if (championResult.required === true) {
    if (championResult.outcome === 'victory') {
      finishExpedition(state, config, ruinsConfig, expedition, true, 'champion', {
        championResult,
      });
      return;
    }
    finishExpedition(state, config, ruinsConfig, expedition, false, `champion_${championResult.outcome}`, {
      championResult,
      forcedLosses: championResult.suggestedLosses,
    });
    return;
  }
  finishExpedition(state, config, ruinsConfig, expedition, true, guardianDefeated ? 'guardian' : 'clear');
}

// Resolve one deterministic champion encounter when the current frontier floor is contested.
function resolveChampionEncounter(state, config, ruinsConfig, expedition) {
  const underrealm = state && state.underrealm;
  const combat = underrealm && underrealm.combat;
  if (!underrealm || !combat || combat.enabled === false) {
    return { required: false };
  }
  if (String(combat.progressionMode || 'champion_gate') !== 'champion_gate') {
    return { required: false };
  }
  const depth = Math.max(
    1,
    Math.floor(Number(
      expedition
      && expedition.readiness
      && expedition.readiness.depth
        ? expedition.readiness.depth
        : resolveExpeditionDepth(expedition && expedition.roomIndex, underrealm),
    )),
  );
  const floor = resolveUnderrealmCombatFloor(combat, depth);
  if (!floor || floor.unlocked !== true) {
    return { required: false };
  }
  const championRequired = Boolean(
    floor.unlock
    && floor.unlock.required === true
    && floor.champion
    && floor.champion.enabled !== false
    && floor.unlock.cleared !== true,
  );
  if (!championRequired || floor.state !== 'contested') {
    return { required: false };
  }
  const encounter = floor.encounter && typeof floor.encounter === 'object'
    ? floor.encounter
    : {};
  floor.encounter = encounter;
  const cooldown = Math.max(0, Math.floor(Number(encounter.cooldownTicksRemaining || 0)));
  if (cooldown > 0) {
    return {
      required: true,
      outcome: 'cooldown',
      depth,
      championLabel: String(floor.champion && floor.champion.label || `Depth Champion D${depth}`),
      suggestedLosses: 0,
    };
  }
  encounter.active = true;
  encounter.attempts = Math.max(0, Math.floor(Number(encounter.attempts || 0))) + 1;

  const readiness = expedition && expedition.readiness ? expedition.readiness : {};
  const components = readiness.components && typeof readiness.components === 'object'
    ? readiness.components
    : {};
  const partySize = Math.max(1, getExpeditionPartySize(state, expedition));
  const bonuses = state && state.ruins && state.ruins.bonuses
    ? state.ruins.bonuses
    : {};
  const kitPowerBonus = Math.max(0, Number((ruinsConfig.expedition || {}).kitPowerBonus || 0));
  const mithrilPowerBonus = expedition.useMithril
    ? Math.max(0, Number((ruinsConfig.mithrilReinforcement || {}).powerBonus || 0))
    : 0;
  const clanCombatBonus = getClanExpeditionBonus(state, config, expedition, 'ruins_combat_bonus');
  const contractCombatBonus = getContractRuinsCombatBonus(state);
  const combatBonus = Math.max(
    0,
    Number(bonuses.combatBonus || 0) + clanCombatBonus + contractCombatBonus,
  );
  const readinessRiskMultiplier = clamp(
    Number(readiness && readiness.status === 'warning' ? readiness.warningRiskMultiplier : 1),
    1,
    3,
  );

  const offense = Math.max(0, Number(components.offense || 0));
  const defense = Math.max(0, Number(components.defense || 0));
  const support = Math.max(0, Number(components.support || 0));
  const partyPowerMultiplier = Math.max(
    0.1,
    1 + kitPowerBonus + mithrilPowerBonus + combatBonus,
  );
  const partyAttack = Math.max(
    1,
    (offense + support + partySize) * partyPowerMultiplier,
  );
  const partyDefense = Math.max(0, defense + support + partySize * 0.5);
  const partyHpMax = Math.max(1, partySize * Math.max(2, defense + 2));

  const championStats = floor.champion && floor.champion.stats
    ? floor.champion.stats
    : {};
  const championLabel = String(floor.champion && floor.champion.label || `Depth Champion D${depth}`);
  const championHpMax = Math.max(
    1,
    Number(championStats.hp || 1) * readinessRiskMultiplier,
  );
  const championAttack = Math.max(
    0,
    Number(championStats.attack || 0) * readinessRiskMultiplier,
  );
  const championDefense = Math.max(
    0,
    Number(championStats.defense || 0) * readinessRiskMultiplier,
  );
  const championPenetration = clamp(Number(championStats.penetration || 0), 0, 1);
  const encounterConfig = combat && combat.encounter && typeof combat.encounter === 'object'
    ? combat.encounter
    : {};
  const rounds = Math.max(
    1,
    Math.floor(
      Number(encounterConfig.roundsBase || 4)
        + Number(encounterConfig.roundsPerDepth || 0) * Math.max(0, depth - 1),
    ),
  );

  let partyHp = partyHpMax;
  let championHp = championHpMax;
  for (let round = 0; round < rounds; round += 1) {
    const partyDamage = Math.max(1, partyAttack - championDefense);
    const mitigatedDefense = Math.max(0, partyDefense * (1 - championPenetration));
    const championDamage = Math.max(1, championAttack - mitigatedDefense);
    championHp = Math.max(0, championHp - partyDamage);
    partyHp = Math.max(0, partyHp - championDamage);
    if (championHp <= 0 || partyHp <= 0) {
      break;
    }
  }

  let outcome = 'retreat';
  if (championHp <= 0 && partyHp > 0) {
    outcome = 'victory';
  } else if (partyHp <= 0) {
    outcome = 'defeat';
  }
  const tick = Math.max(0, Math.floor(Number(state.tick || 0)));
  encounter.active = false;
  encounter.lastOutcome = outcome;
  encounter.lastOutcomeTick = tick;

  if (outcome === 'victory') {
    encounter.victories = Math.max(0, Math.floor(Number(encounter.victories || 0))) + 1;
    encounter.cooldownTicksRemaining = 0;
    floor.state = 'cleared';
    floor.unlock = floor.unlock && typeof floor.unlock === 'object'
      ? floor.unlock
      : {};
    floor.unlock.cleared = true;
    const maxDepth = Math.max(1, Math.floor(Number(underrealm.maxDepth || depth)));
    const unlockDepth = clamp(
      Math.max(depth + 1, Math.floor(Number(floor.unlock.unlocksDepthOnWin || depth + 1))),
      1,
      maxDepth,
    );
    let unlockedDepth = null;
    if (unlockDepth > Math.max(0, Math.floor(Number(underrealm.maxUnlockedDepth || 0)))) {
      underrealm.maxUnlockedDepth = unlockDepth;
      const unlockedLayer = findUnderrealmLayer(underrealm, unlockDepth);
      if (unlockedLayer) {
        unlockedLayer.unlocked = true;
      }
      unlockedDepth = unlockDepth;
    }
    const combatStats = getUnderrealmCombatStats(state);
    if (combatStats) {
      combatStats.championsDefeated = Number(combatStats.championsDefeated || 0) + 1;
    }
    pushEvent(
      state,
      config,
      unlockedDepth
        ? `Underrealm D${depth}: ${championLabel} defeated, depth ${unlockedDepth} unlocked`
        : `Underrealm D${depth}: ${championLabel} defeated`,
    );
    return {
      required: true,
      outcome,
      depth,
      championLabel,
      suggestedLosses: 0,
      unlockedDepth,
    };
  }

  if (outcome === 'defeat') {
    encounter.defeats = Math.max(0, Math.floor(Number(encounter.defeats || 0))) + 1;
  } else {
    encounter.retreats = Math.max(0, Math.floor(Number(encounter.retreats || 0))) + 1;
  }
  floor.state = 'contested';
  const retryCooldown = Math.max(
    0,
    Math.floor(
      Number(encounterConfig.retryCooldownTicksBase || 90)
        + Number(encounterConfig.retryCooldownTicksPerDepth || 0) * Math.max(0, depth - 1),
    ),
  );
  encounter.cooldownTicksRemaining = retryCooldown;
  const suggestedLosses = resolveChampionLossCount(outcome, partySize, partyHp, partyHpMax);
  pushEvent(
    state,
    config,
    `Underrealm D${depth}: ${championLabel} ${outcome}, cooldown ${retryCooldown} ticks`,
  );
  return {
    required: true,
    outcome,
    depth,
    championLabel,
    suggestedLosses,
    cooldownTicksRemaining: retryCooldown,
  };
}

// Compute a deterministic casualty hint from champion outcome and remaining party stamina.
function resolveChampionLossCount(outcome, partySize, partyHp, partyHpMax) {
  const safePartySize = Math.max(0, Math.floor(Number(partySize || 0)));
  if (safePartySize <= 0 || outcome === 'victory') {
    return 0;
  }
  const hpRatio = partyHpMax > 0 ? clamp(Number(partyHp || 0) / Number(partyHpMax || 1), 0, 1) : 0;
  const damageRatio = clamp(1 - hpRatio, 0, 1);
  const baselineRatio = outcome === 'defeat' ? 0.55 : 0.2;
  const lossRatio = clamp(Math.max(damageRatio, baselineRatio), 0, 1);
  const minimum = outcome === 'defeat' ? 1 : 0;
  return Math.min(
    safePartySize,
    Math.max(minimum, Math.round(safePartySize * lossRatio)),
  );
}

function finishExpedition(state, config, ruinsConfig, expedition, success, reason, resultMeta = null) {
  const roomIndex = expedition.roomIndex;
  const room = Array.isArray(ruinsConfig.rooms) ? ruinsConfig.rooms[roomIndex] : null;
  let artifactsFound = 0;

  if (success) {
    state.ruins.roomsCleared = Math.max(state.ruins.roomsCleared, roomIndex + 1);
    state.ruins.stats.successes = Number(state.ruins.stats.successes || 0) + 1;
    pushEvent(state, config, `Ruins: room ${roomIndex + 1} cleared`);

    if (room) {
      const baseChance = clamp(Number(room.artifactChance || 0), 0, 1);
      const guardianBonus = reason === 'guardian'
        ? Math.max(0, Number((ruinsConfig.guardians || {}).artifactBonus || 0))
        : 0;
      const bonusChance = Math.max(0, Number((state.ruins.bonuses || {}).artifactChanceBonus || 0));
      const mythArtifact = getMythMultiplier(state, config, 'ruinsArtifactChance', 1);
      const alchemyArtifact = getAlchemyMultiplier(state, config, 'ruinsArtifactChance', 1);
      const totalChance = clamp((baseChance + guardianBonus + bonusChance) * mythArtifact * alchemyArtifact, 0, 1);
      const rolls = Math.max(1, Math.floor(Number(room.artifactRolls || 1)));
      let foundAny = false;
      for (let roll = 0; roll < rolls; roll += 1) {
        if (Math.random() >= totalChance) {
          continue;
        }
        const artifactId = pickArtifact(ruinsConfig, state.ruins);
        if (!artifactId) {
          continue;
        }
        state.ruins.artifactsFound[artifactId] = true;
        state.ruins.stats.artifacts = Number(state.ruins.stats.artifacts || 0) + 1;
        foundAny = true;
        artifactsFound += 1;
        const artifactName = getArtifactName(ruinsConfig, artifactId);
        pushEvent(state, config, `Ruins: artifact found - ${artifactName}`);
      }
      if (foundAny) {
        recomputeBonuses(state, ruinsConfig);
      }
    }
  } else {
    state.ruins.stats.failures = Number(state.ruins.stats.failures || 0) + 1;
    const combatStats = getUnderrealmCombatStats(state);
    if (combatStats) {
      combatStats.failedExpeditions = Number(combatStats.failedExpeditions || 0) + 1;
    }
    const forcedLosses = resultMeta
      && Number.isFinite(Number(resultMeta.forcedLosses))
      ? Math.max(0, Math.floor(Number(resultMeta.forcedLosses)))
      : null;
    const losses = resolveExpeditionLosses(state, ruinsConfig, expedition, forcedLosses);
    if (reason === 'champion_defeat') {
      if (losses > 0) {
        pushEvent(state, config, `Ruins: champion overran expedition (${losses} fallen)`);
      } else {
        pushEvent(state, config, 'Ruins: champion overran expedition');
      }
    } else if (reason === 'champion_retreat') {
      if (losses > 0) {
        pushEvent(state, config, `Ruins: expedition retreated from champion (${losses} fallen)`);
      } else {
        pushEvent(state, config, 'Ruins: expedition retreated from champion');
      }
    } else if (reason === 'champion_cooldown') {
      pushEvent(state, config, 'Ruins: champion hall sealed, expedition returned');
    } else if (losses > 0) {
      pushEvent(state, config, `Ruins: expedition failed (${losses} fallen)`);
    } else {
      pushEvent(state, config, 'Ruins: expedition failed');
    }
  }

  const stats = state.ruins.stats || {};
  const tick = Number(state.tick || 0);
  if (stats.lastOutcomeTick !== tick) {
    stats.lastOutcomeTick = tick;
    stats.lastSuccesses = 0;
    stats.lastFailures = 0;
    stats.lastArtifactsFound = 0;
  }
  if (success) {
    stats.lastSuccesses = Number(stats.lastSuccesses || 0) + 1;
  } else {
    stats.lastFailures = Number(stats.lastFailures || 0) + 1;
  }
  stats.lastOutcome = success ? 'success' : 'failure';
  stats.lastArtifactsFound = Number(stats.lastArtifactsFound || 0) + artifactsFound;
  state.ruins.stats = stats;

  releaseExpeditioners(state, expedition);

  if (success) {
    const cooldownTicks = Math.max(0, Number((ruinsConfig.expedition || {}).cooldownTicks || 0));
    state.ruins.cooldown = cooldownTicks;
  } else {
    const cooldownTicks = Math.max(0, Number((ruinsConfig.expedition || {}).failureCooldownTicks || 0));
    state.ruins.cooldown = cooldownTicks;
  }

}

function resolveExpeditionLosses(state, ruinsConfig, expedition, forcedLosses = null) {
  const expeditionConfig = ruinsConfig.expedition || {};
  const minLoss = Math.max(0, Math.floor(Number(expeditionConfig.failureLossMin || 0)));
  const maxLoss = Math.max(minLoss, Math.floor(Number(expeditionConfig.failureLossMax || minLoss)));
  const aliveIds = getExpeditionAliveIds(state, expedition);
  const partySize = aliveIds.length;
  if (partySize <= 0) {
    return 0;
  }
  let baseLoss = 0;
  if (Number.isFinite(Number(forcedLosses))) {
    baseLoss = Math.min(
      partySize,
      Math.max(0, Math.floor(Number(forcedLosses))),
    );
  } else {
    if (maxLoss <= 0) {
      return 0;
    }
    const readinessRiskMultiplier = clamp(
      Number(
        expedition
        && expedition.readiness
        && expedition.readiness.status === 'warning'
          ? expedition.readiness.warningRiskMultiplier
          : 1,
      ),
      1,
      3,
    );
    baseLoss = Math.min(
      partySize,
      Math.max(0, Math.round(randomInt(minLoss, maxLoss) * readinessRiskMultiplier)),
    );
  }
  const reduction = clamp(Number((state.ruins.bonuses || {}).casualtyReduction || 0), 0, 0.9);
  const lossCount = Math.min(partySize, Math.max(0, Math.round(baseLoss * (1 - reduction))));
  if (lossCount <= 0) {
    return 0;
  }
  const candidates = aliveIds.slice();
  shuffleInPlace(candidates);
  const deadIds = new Set(candidates.slice(0, lossCount));
  applyExpeditionDeaths(state, deadIds);
  return deadIds.size;
}

function applyExpeditionDeaths(state, deadIds) {
  if (!deadIds || deadIds.size === 0) {
    return;
  }
  state.deathsCount = Number(state.deathsCount || 0) + deadIds.size;
  state.lastDeathTick = Number(state.tick || 0);
  state.deathsByCause = state.deathsByCause || {};
  state.deathsByCause.ruins = Number(state.deathsByCause.ruins || 0) + deadIds.size;
  state.dwarves = state.dwarves.filter((dwarf) => !deadIds.has(dwarf.id));
  state.jobs = state.jobs.filter((job) => !deadIds.has(job.dwarfId));

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
}

function releaseExpeditioners(state, expedition) {
  const ids = expedition && expedition.dwarfIds ? expedition.dwarfIds : [];
  if (!Array.isArray(ids) || ids.length === 0) {
    return;
  }
  const idSet = new Set(ids);
  for (const dwarf of state.dwarves) {
    if (idSet.has(dwarf.id)) {
      dwarf.expedition = false;
    }
  }
}

function recomputeBonuses(state, ruinsConfig) {
  const artifactPool = (ruinsConfig.artifacts && ruinsConfig.artifacts.pool) || {};
  const found = state.ruins.artifactsFound || {};
  const setCounts = {};
  for (const [artifactId, isFound] of Object.entries(found)) {
    if (!isFound) {
      continue;
    }
    const def = artifactPool[artifactId];
    if (!def || !def.set) {
      continue;
    }
    setCounts[def.set] = Number(setCounts[def.set] || 0) + 1;
  }
  state.ruins.setCounts = setCounts;

  const bonuses = {
    outputMultiplier: 0,
    hazardReduction: 0,
    combatBonus: 0,
    artifactChanceBonus: 0,
    casualtyReduction: 0,
    activeCombos: [],
  };

  const setBonuses = ruinsConfig.setBonuses || {};
  for (const [setId, thresholds] of Object.entries(setBonuses)) {
    const count = Number(setCounts[setId] || 0);
    for (const [thresholdRaw, bonus] of Object.entries(thresholds || {})) {
      const threshold = Number(thresholdRaw || 0);
      if (!Number.isFinite(threshold) || threshold <= 0) {
        continue;
      }
      if (count >= threshold) {
        applyBonus(bonuses, bonus);
      }
    }
  }

  const comboBonuses = Array.isArray(ruinsConfig.comboBonuses) ? ruinsConfig.comboBonuses : [];
  for (const combo of comboBonuses) {
    if (!combo || typeof combo !== 'object') {
      continue;
    }
    if (!meetsComboRequirements(combo.requires || {}, setCounts)) {
      continue;
    }
    applyBonus(bonuses, combo.bonus || {});
    const label = combo.label || combo.id;
    if (label) {
      bonuses.activeCombos.push(label);
    }
  }

  state.ruins.bonuses = bonuses;
}

function applyBonus(target, bonus) {
  if (!bonus || typeof bonus !== 'object') {
    return;
  }
  for (const [key, value] of Object.entries(bonus)) {
    if (key === 'activeCombos') {
      continue;
    }
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) {
      continue;
    }
    target[key] = Number(target[key] || 0) + numeric;
  }
}

function meetsComboRequirements(requires, setCounts) {
  for (const [setId, neededRaw] of Object.entries(requires || {})) {
    const needed = Math.max(0, Number(neededRaw || 0));
    const current = Math.max(0, Number(setCounts[setId] || 0));
    if (current < needed) {
      return false;
    }
  }
  return true;
}

function pickArtifact(ruinsConfig, ruinsState) {
  const pool = (ruinsConfig.artifacts && ruinsConfig.artifacts.pool) || {};
  const found = ruinsState.artifactsFound || {};
  const options = [];
  let totalWeight = 0;
  for (const [id, def] of Object.entries(pool)) {
    if (found[id]) {
      continue;
    }
    const weight = Math.max(0, Number(def && def.weight !== undefined ? def.weight : 1));
    if (weight <= 0) {
      continue;
    }
    totalWeight += weight;
    options.push({ id, weight });
  }
  if (totalWeight <= 0 || options.length === 0) {
    return null;
  }
  let roll = Math.random() * totalWeight;
  for (const option of options) {
    if (roll < option.weight) {
      return option.id;
    }
    roll -= option.weight;
  }
  return options[options.length - 1].id;
}

function getArtifactName(ruinsConfig, artifactId) {
  const pool = (ruinsConfig.artifacts && ruinsConfig.artifacts.pool) || {};
  const def = pool[artifactId] || {};
  return def.name || artifactId;
}

function resolvePartySize(room, expeditionConfig, idleCount) {
  const minSize = Math.max(1, Math.floor(Number(expeditionConfig.partySizeMin || 1)));
  const maxSize = Math.max(minSize, Math.floor(Number(expeditionConfig.partySizeMax || minSize)));
  const desired = Math.max(minSize, Math.floor(Number(room.partySize || minSize)));
  const clamped = Math.max(minSize, Math.min(maxSize, desired));
  if (idleCount < minSize) {
    return 0;
  }
  return Math.min(clamped, idleCount);
}

function getIdleAdults(state, config) {
  return state.dwarves.filter((dwarf) => (
    !dwarf.job
    && !dwarf.expedition
    && !(dwarf.underrealmDuty && dwarf.underrealmDuty.active !== false)
    && isAdult(dwarf, config)
  ));
}

function hasStructure(state, type) {
  return (state.structures || []).some((structure) => structure.type === type);
}

function allArtifactsFound(ruinsConfig, ruinsState) {
  const pool = (ruinsConfig.artifacts && ruinsConfig.artifacts.pool) || {};
  const entries = Object.keys(pool);
  if (entries.length === 0) {
    return true;
  }
  const found = ruinsState.artifactsFound || {};
  for (const id of entries) {
    if (!found[id]) {
      return false;
    }
  }
  return true;
}

// Decide whether repeatable expeditions bypass cooldown gating.
function shouldIgnoreCooldown(ruins, ruinsConfig, rooms) {
  const cleared = Math.max(0, Number(ruins.roomsCleared || 0));
  if (cleared < rooms.length) {
    return false;
  }
  return !allArtifactsFound(ruinsConfig, ruins);
}

// Resolve concurrent expedition limit once the final room is repeatable.
function resolveMaxConcurrent(ruins, ruinsConfig, rooms) {
  const expeditionConfig = ruinsConfig.expedition || {};
  const cleared = Math.max(0, Number(ruins.roomsCleared || 0));
  if (cleared < rooms.length || allArtifactsFound(ruinsConfig, ruins)) {
    return 1;
  }
  const raw = Number(expeditionConfig.maxConcurrentAfterClear || 1);
  if (!Number.isFinite(raw)) {
    return 1;
  }
  return Math.max(1, Math.floor(raw));
}

function findUnderrealmLayer(underrealm, depth) {
  return (underrealm && Array.isArray(underrealm.layers) ? underrealm.layers : [])
    .find((layer) => Number(layer && layer.depth) === Number(depth));
}

function getExpeditionAliveIds(state, expedition) {
  const ids = expedition && Array.isArray(expedition.dwarfIds) ? expedition.dwarfIds : [];
  if (ids.length === 0) {
    return [];
  }
  const alive = new Set((state.dwarves || []).map((dwarf) => dwarf.id));
  return ids.filter((id) => alive.has(id));
}

function getExpeditionPartySize(state, expedition) {
  return getExpeditionAliveIds(state, expedition).length;
}

function randomInt(min, max) {
  if (max <= min) {
    return min;
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffleInPlace(values) {
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = values[i];
    values[i] = values[j];
    values[j] = temp;
  }
}

module.exports = { updateRuins, recomputeBonuses };
