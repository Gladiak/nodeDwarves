'use strict';

const { clamp } = require('../utils');
const {
  buildResourceConsequences,
  buildSecondaryActor,
  buildSecondaryLocation,
  buildSettlementActor,
  emitSecondaryEvent,
} = require('./secondary_events');
const { randomBetween } = require('./random');
const { isSpawnableTile } = require('./terrain');
const { getEdgePositions } = require('./movement');

const CAMP_ROLES = ['trade', 'militia', 'raider'];
const MAP_SIDES = ['north', 'south', 'west', 'east'];

// Resolve and sanitize External Camps config.
function getExternalCampsConfig(config) {
  const source = (config && config.externalCamps) || {};
  const enabled = source.enabled === true;
  const spawnRange = normalizeRange(source.spawnRangeTicks, { min: 420, max: 680 }, 0);
  const factionCooldown = normalizeRange(source.factionCooldownTicks, { min: 380, max: 620 }, 0);
  const durationRaw = source.durationTicks || {};

  const tradeRaw = source.trade || {};
  const militiaRaw = source.militia || {};
  const raiderRaw = source.raider || {};
  const influenceRaw = source.influence || {};
  const caravansRaw = source.caravans || {};

  const reserveRatioFloor = {
    default: clamp(Number(tradeRaw.reserveRatioFloor && tradeRaw.reserveRatioFloor.default), 0, 1),
    food: clamp(Number(tradeRaw.reserveRatioFloor && tradeRaw.reserveRatioFloor.food), 0, 1),
    water: clamp(Number(tradeRaw.reserveRatioFloor && tradeRaw.reserveRatioFloor.water), 0, 1),
  };
  if (reserveRatioFloor.default <= 0) {
    reserveRatioFloor.default = 0.65;
  }
  if (reserveRatioFloor.food <= 0) {
    reserveRatioFloor.food = 0.7;
  }
  if (reserveRatioFloor.water <= 0) {
    reserveRatioFloor.water = 0.75;
  }

  const externalConfig = {
    enabled,
    minTick: Math.max(0, Math.floor(Number(source.minTick || 320))),
    spawnRange,
    maxActive: Math.max(1, Math.floor(Number(source.maxActive || 2))),
    globalCooldownTicks: Math.max(0, Math.floor(Number(source.globalCooldownTicks || 140))),
    historyLimit: Math.max(0, Math.floor(Number(source.historyLimit || 40))),
    blockDuringRaid: source.blockDuringRaid === true,
    footprintRadius: Math.max(0, Math.floor(Number(source.footprintRadius || 1))),
    minDistanceBetween: Math.max(0, Math.floor(Number(source.minDistanceBetween || 10))),
    minDistanceFromVillage: Math.max(0, Math.floor(Number(source.minDistanceFromVillage || 16))),
    factionCooldown,
    duration: {
      setupMin: Math.max(1, Math.floor(Number(durationRaw.setupMin || 40))),
      setupMax: Math.max(1, Math.floor(Number(durationRaw.setupMax || 70))),
      activeMin: Math.max(1, Math.floor(Number(durationRaw.activeMin || 650))),
      activeMax: Math.max(1, Math.floor(Number(durationRaw.activeMax || 1050))),
      withdrawMin: Math.max(1, Math.floor(Number(durationRaw.withdrawMin || 50))),
      withdrawMax: Math.max(1, Math.floor(Number(durationRaw.withdrawMax || 90))),
    },
    trade: {
      enabled: tradeRaw.enabled !== false,
      tickInterval: Math.max(1, Math.floor(Number(tradeRaw.tickInterval || 28))),
      merchantTradeRateBonusPerCamp: Math.max(0, Number(tradeRaw.merchantTradeRateBonusPerCamp || 0.03)),
      merchantTradeRateBonusMax: Math.max(0, Number(tradeRaw.merchantTradeRateBonusMax || 0.18)),
      contractRewardBonusPerCamp: Math.max(0, Number(tradeRaw.contractRewardBonusPerCamp || 0.025)),
      contractRewardBonusMax: Math.max(0, Number(tradeRaw.contractRewardBonusMax || 0.15)),
      reserveRatioFloor,
      baseTradeAmount: Math.max(1, Math.floor(Number(tradeRaw.baseTradeAmount || 16))),
      protectedGiveResources: Array.isArray(tradeRaw.protectedGiveResources)
        ? tradeRaw.protectedGiveResources.filter((value) => typeof value === 'string')
        : ['food', 'water'],
      allowReceiveResources: Array.isArray(tradeRaw.allowReceiveResources)
        ? tradeRaw.allowReceiveResources.filter((value) => typeof value === 'string')
        : [],
      eventEveryTrades: Math.max(1, Math.floor(Number(tradeRaw.eventEveryTrades || 2))),
    },
    militia: {
      enabled: militiaRaw.enabled !== false,
      contractIntervalTicks: Math.max(1, Math.floor(Number(militiaRaw.contractIntervalTicks || 80))),
      supportCosts: normalizeAmountMap(militiaRaw.supportCosts || { wood: 16, stone: 12, beer: 8 }),
      supportMinStockpileRatios: normalizeRatioMap(militiaRaw.supportMinStockpileRatios || { food: 0.65, water: 0.7 }),
      baseRaidDefenseBonus: clamp(Number(militiaRaw.baseRaidDefenseBonus || 0.05), 0, 1),
      reputationBonusScale: Math.max(0, Number(militiaRaw.reputationBonusScale || 0.04)),
      maxRaidDefenseBonus: clamp(Number(militiaRaw.maxRaidDefenseBonus || 0.18), 0, 1),
      defenseBonusDecayOnMiss: clamp(Number(militiaRaw.defenseBonusDecayOnMiss || 0.015), 0, 1),
      eventEveryContracts: Math.max(1, Math.floor(Number(militiaRaw.eventEveryContracts || 2))),
    },
    raider: {
      enabled: raiderRaw.enabled !== false,
      demandIntervalTicks: Math.max(1, Math.floor(Number(raiderRaw.demandIntervalTicks || 70))),
      tributeCosts: normalizeAmountMap(raiderRaw.tributeCosts || { wood: 24, stone: 18, beer: 12 }),
      tributeMinStockpileRatios: normalizeRatioMap(raiderRaw.tributeMinStockpileRatios || { food: 0.75, water: 0.78 }),
      hostilityInitial: clamp(Number(raiderRaw.hostilityInitial || 0.35), 0, 1),
      hostilityGainOnReject: clamp(Number(raiderRaw.hostilityGainOnReject || 0.18), 0, 1),
      hostilityDecayOnPay: clamp(Number(raiderRaw.hostilityDecayOnPay || 0.1), 0, 1),
      hostilityDecayPerTick: clamp(Number(raiderRaw.hostilityDecayPerTick || 0.0008), 0, 1),
      hostilityMin: clamp(Number(raiderRaw.hostilityMin || 0), 0, 1),
      hostilityMax: clamp(Number(raiderRaw.hostilityMax || 1), 0, 1),
      skirmishLossRatioBase: clamp(Number(raiderRaw.skirmishLossRatioBase || 0.015), 0, 1),
      skirmishLossRatioPerHostility: clamp(Number(raiderRaw.skirmishLossRatioPerHostility || 0.03), 0, 1),
      skirmishLossWeights: normalizeRatioMap(
        raiderRaw.skirmishLossWeights || {
          food: 1,
          water: 1,
          wood: 0.8,
          stone: 0.7,
          beer: 0.9,
          iron: 0.4,
        },
      ),
      raidDeathRateBonusMax: Math.max(0, Number(raiderRaw.raidDeathRateBonusMax || 0.16)),
      raidResourceLossBonusMax: Math.max(0, Number(raiderRaw.raidResourceLossBonusMax || 0.2)),
      eventEveryDemands: Math.max(1, Math.floor(Number(raiderRaw.eventEveryDemands || 1))),
    },
    influence: {
      enabled: influenceRaw.enabled !== false,
      useForModifiers: influenceRaw.useForModifiers !== false,
      tradeRadius: Math.max(0, Math.floor(Number(influenceRaw.tradeRadius || 17))),
      militiaRadius: Math.max(0, Math.floor(Number(influenceRaw.militiaRadius || 15))),
      raiderRadius: Math.max(0, Math.floor(Number(influenceRaw.raiderRadius || 14))),
      minStrength: clamp(Number(influenceRaw.minStrength || 0.2), 0, 1),
      renderEnabled: influenceRaw.renderEnabled !== false,
      renderRingOnly: influenceRaw.renderRingOnly !== false,
      renderStep: Math.max(1, Math.floor(Number(influenceRaw.renderStep || 2))),
    },
    caravans: {
      enabled: caravansRaw.enabled !== false,
      dispatchIntervalTicks: Math.max(1, Math.floor(Number(caravansRaw.dispatchIntervalTicks || 70))),
      maxConcurrent: Math.max(1, Math.floor(Number(caravansRaw.maxConcurrent || 6))),
      maxPerCamp: Math.max(1, Math.floor(Number(caravansRaw.maxPerCamp || 1))),
      stepEveryTicks: Math.max(1, Math.floor(Number(caravansRaw.stepEveryTicks || 2))),
      payloadAmountRange: normalizeRange(caravansRaw.payloadAmountRange, { min: 6, max: 12 }, 1),
      payloadMultiplierFromDeal: Math.max(0, Number(caravansRaw.payloadMultiplierFromDeal || 0.35)),
      eventEveryArrivals: Math.max(1, Math.floor(Number(caravansRaw.eventEveryArrivals || 2))),
      eventEveryInterceptions: Math.max(1, Math.floor(Number(caravansRaw.eventEveryInterceptions || 1))),
      intercept: {
        enabled: !caravansRaw.intercept || caravansRaw.intercept.enabled !== false,
        baseChancePerStep: clamp(Number(
          caravansRaw.intercept && caravansRaw.intercept.baseChancePerStep || 0,
        ), 0, 1),
        raiderPressureScale: clamp(Number(
          caravansRaw.intercept && caravansRaw.intercept.raiderPressureScale || 0.03,
        ), 0, 1),
        militiaMitigationScale: clamp(Number(
          caravansRaw.intercept && caravansRaw.intercept.militiaMitigationScale || 0.02,
        ), 0, 1),
      },
    },
  };

  externalConfig.duration.setupMax = Math.max(externalConfig.duration.setupMin, externalConfig.duration.setupMax);
  externalConfig.duration.activeMax = Math.max(externalConfig.duration.activeMin, externalConfig.duration.activeMax);
  externalConfig.duration.withdrawMax = Math.max(externalConfig.duration.withdrawMin, externalConfig.duration.withdrawMax);
  externalConfig.caravans.enabled = externalConfig.caravans.enabled && externalConfig.trade.enabled;
  externalConfig.factions = normalizeFactions(source.factions, config, externalConfig);

  return externalConfig;
}

// Normalize a min/max range map.
function normalizeRange(rawRange, fallback, minFloor) {
  const range = rawRange || {};
  const min = Math.max(minFloor || 0, Number(range.min !== undefined ? range.min : fallback.min));
  const max = Math.max(min, Number(range.max !== undefined ? range.max : fallback.max));
  return {
    min: Math.floor(min),
    max: Math.floor(max),
  };
}

// Normalize a positive integer amount map.
function normalizeAmountMap(source) {
  const map = {};
  if (!source || typeof source !== 'object') {
    return map;
  }
  for (const [resourceId, amountRaw] of Object.entries(source)) {
    const amount = Math.max(0, Math.floor(Number(amountRaw || 0)));
    if (!resourceId || amount <= 0) {
      continue;
    }
    map[resourceId] = amount;
  }
  return map;
}

// Normalize a ratio map with values clamped to 0..1.
function normalizeRatioMap(source) {
  const map = {};
  if (!source || typeof source !== 'object') {
    return map;
  }
  for (const [key, valueRaw] of Object.entries(source)) {
    const value = clamp(Number(valueRaw || 0), 0, 1);
    if (!key || value <= 0) {
      continue;
    }
    map[key] = value;
  }
  return map;
}

// Build the faction table used by External Camps.
function normalizeFactions(rawFactions, config, externalConfig) {
  const factions = [];
  const source = rawFactions && typeof rawFactions === 'object' ? rawFactions : {};
  const contractsFactions = (config && config.contracts && config.contracts.factions) || {};

  for (const [factionId, entryRaw] of Object.entries(source)) {
    const entry = entryRaw && typeof entryRaw === 'object' ? entryRaw : {};
    const role = normalizeCampRole(entry.role);
    if (!isRoleEnabled(role, externalConfig)) {
      continue;
    }
    const weight = Math.max(0, Number(entry.weight !== undefined ? entry.weight : 1));
    if (weight <= 0) {
      continue;
    }
    const fallbackLabel = contractsFactions[factionId] && contractsFactions[factionId].label
      ? contractsFactions[factionId].label
      : buildFactionLabel(factionId);
    factions.push({
      id: factionId,
      role,
      weight,
      label: String(entry.label || fallbackLabel),
    });
  }

  if (factions.length === 0) {
    for (const [factionId, contractEntry] of Object.entries(contractsFactions)) {
      const contractRole = String(contractEntry && contractEntry.role || 'production').toLowerCase();
      const role = contractRole === 'war' ? 'militia' : 'trade';
      if (!isRoleEnabled(role, externalConfig)) {
        continue;
      }
      factions.push({
        id: factionId,
        role,
        weight: 1,
        label: String(contractEntry && contractEntry.label || buildFactionLabel(factionId)),
      });
    }
  }

  if (factions.length === 0) {
    if (externalConfig.trade.enabled) {
      factions.push({ id: 'wayfarer_exchange', role: 'trade', weight: 1, label: 'Wayfarer Exchange' });
    }
    if (externalConfig.militia.enabled) {
      factions.push({ id: 'borderward_company', role: 'militia', weight: 1, label: 'Borderward Company' });
    }
    if (externalConfig.raider.enabled) {
      factions.push({ id: 'ashen_marauders', role: 'raider', weight: 1, label: 'Ashen Marauders' });
    }
  }

  return factions;
}

// Resolve a valid camp role with default fallback.
function normalizeCampRole(rawRole) {
  const role = String(rawRole || '').toLowerCase();
  if (CAMP_ROLES.includes(role)) {
    return role;
  }
  return 'trade';
}

// Check whether one role is enabled by config.
function isRoleEnabled(role, externalConfig) {
  if (role === 'trade') {
    return externalConfig.trade.enabled !== false;
  }
  if (role === 'militia') {
    return externalConfig.militia.enabled !== false;
  }
  if (role === 'raider') {
    return externalConfig.raider.enabled !== false;
  }
  return false;
}

// Build a readable fallback faction label from an id.
function buildFactionLabel(factionId) {
  return String(factionId || 'Faction')
    .split(/[_\s-]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// Ensure External Camps runtime state exists and is normalized.
function ensureExternalCampsState(state, config) {
  const externalConfig = getExternalCampsConfig(config);
  if (!state || externalConfig.enabled !== true) {
    if (state) {
      state.externalCamps = null;
    }
    return null;
  }

  if (!state.externalCamps || typeof state.externalCamps !== 'object') {
    state.externalCamps = createExternalCampsState(externalConfig, Number(state.tick || 0));
  }

  const runtime = state.externalCamps;
  runtime.camps = Array.isArray(runtime.camps) ? runtime.camps : [];
  runtime.caravans = Array.isArray(runtime.caravans) ? runtime.caravans : [];
  runtime.counter = Math.max(1, Math.floor(Number(runtime.counter || 1)));
  runtime.caravanCounter = Math.max(1, Math.floor(Number(runtime.caravanCounter || 1)));
  runtime.history = Array.isArray(runtime.history) ? runtime.history : [];
  runtime.factionCooldownById = runtime.factionCooldownById && typeof runtime.factionCooldownById === 'object'
    ? runtime.factionCooldownById
    : {};
  runtime.stats = normalizeExternalCampStats(runtime.stats);
  runtime.modifiers = normalizeExternalCampModifiers(runtime.modifiers);
  if (!Number.isFinite(runtime.nextSpawnTick)) {
    runtime.nextSpawnTick = scheduleNextCampSpawnTick(externalConfig, Number(state.tick || 0));
  }
  if (!Number.isFinite(runtime.cooldownUntilTick)) {
    runtime.cooldownUntilTick = 0;
  }

  return runtime;
}

// Build an initial External Camps runtime state object.
function createExternalCampsState(externalConfig, currentTick) {
  return {
    camps: [],
    caravans: [],
    nextSpawnTick: scheduleNextCampSpawnTick(externalConfig, currentTick),
    cooldownUntilTick: 0,
    factionCooldownById: {},
    counter: 1,
    caravanCounter: 1,
    history: [],
    stats: normalizeExternalCampStats(null),
    modifiers: normalizeExternalCampModifiers(null),
  };
}

// Schedule the next camp spawn tick from the configured cadence.
function scheduleNextCampSpawnTick(externalConfig, currentTick) {
  const tick = Math.max(0, Math.floor(Number(currentTick || 0)));
  return tick + randomBetween(externalConfig.spawnRange.min, externalConfig.spawnRange.max);
}

// Normalize External Camps stats shape.
function normalizeExternalCampStats(statsRaw) {
  const stats = statsRaw && typeof statsRaw === 'object' ? statsRaw : {};
  const byRole = stats.byRole && typeof stats.byRole === 'object' ? stats.byRole : {};
  const normalizedByRole = {};
  for (const role of CAMP_ROLES) {
    normalizedByRole[role] = normalizeRoleStats(byRole[role]);
  }
  return {
    spawned: Math.max(0, Number(stats.spawned || 0)),
    departed: Math.max(0, Number(stats.departed || 0)),
    skirmishes: Math.max(0, Number(stats.skirmishes || 0)),
    caravans: normalizeCaravanStats(stats.caravans),
    losses: normalizeAmountMap(stats.losses),
    byRole: normalizedByRole,
  };
}

// Normalize one role stats payload.
function normalizeRoleStats(rawRoleStats) {
  const roleStats = rawRoleStats && typeof rawRoleStats === 'object' ? rawRoleStats : {};
  return {
    spawned: Math.max(0, Number(roleStats.spawned || 0)),
    departed: Math.max(0, Number(roleStats.departed || 0)),
    actions: Math.max(0, Number(roleStats.actions || 0)),
    rejected: Math.max(0, Number(roleStats.rejected || 0)),
    paid: Math.max(0, Number(roleStats.paid || 0)),
    defenseTicks: Math.max(0, Number(roleStats.defenseTicks || 0)),
    caravanDispatches: Math.max(0, Number(roleStats.caravanDispatches || 0)),
    caravanArrivals: Math.max(0, Number(roleStats.caravanArrivals || 0)),
    caravanIntercepts: Math.max(0, Number(roleStats.caravanIntercepts || 0)),
    given: normalizeAmountMap(roleStats.given),
    received: normalizeAmountMap(roleStats.received),
    losses: normalizeAmountMap(roleStats.losses),
  };
}

// Normalize caravan-related stats payload.
function normalizeCaravanStats(rawCaravanStats) {
  const caravanStats = rawCaravanStats && typeof rawCaravanStats === 'object' ? rawCaravanStats : {};
  return {
    dispatched: Math.max(0, Number(caravanStats.dispatched || 0)),
    arrived: Math.max(0, Number(caravanStats.arrived || 0)),
    intercepted: Math.max(0, Number(caravanStats.intercepted || 0)),
    returned: Math.max(0, Number(caravanStats.returned || 0)),
    payloadDelivered: normalizeAmountMap(caravanStats.payloadDelivered),
  };
}

// Normalize runtime modifiers used by other systems.
function normalizeExternalCampModifiers(rawModifiers) {
  const modifiers = rawModifiers && typeof rawModifiers === 'object' ? rawModifiers : {};
  return {
    merchantTradeRate: Math.max(0.1, Number(modifiers.merchantTradeRate || 1)),
    contractReward: Math.max(0.1, Number(modifiers.contractReward || 1)),
    raidDefenseBonus: Math.max(0, Number(modifiers.raidDefenseBonus || 0)),
    raidDeathRate: Math.max(0.1, Number(modifiers.raidDeathRate || 1)),
    raidResourceLoss: Math.max(0.1, Number(modifiers.raidResourceLoss || 1)),
    raiderPressure: clamp(Number(modifiers.raiderPressure || 0), 0, 1),
    tradeInfluence: clamp(Number(modifiers.tradeInfluence || 0), 0, 1),
    militiaInfluence: clamp(Number(modifiers.militiaInfluence || 0), 0, 1),
    raiderInfluence: clamp(Number(modifiers.raiderInfluence || 0), 0, 1),
    caravanInterceptRisk: clamp(Number(modifiers.caravanInterceptRisk || 0), 0, 1),
  };
}

// Advance External Camps state machine and interactions each tick.
function updateExternalCamps(state, config, runtime, action) {
  const externalConfig = getExternalCampsConfig(config);
  const externalState = ensureExternalCampsState(state, config);
  if (!externalState || !runtime || runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return;
  }

  const tick = Math.max(0, Math.floor(Number(state.tick || 0)));
  updateExistingCamps(state, config, runtime, action, externalConfig, externalState, tick);
  spawnCampIfEligible(state, config, runtime, externalConfig, externalState, tick);
  rebuildExternalCampModifiers(state, runtime, externalConfig, externalState);
  updateCaravans(state, config, runtime, externalConfig, externalState, tick);
}

// Advance existing camps and drop ones that completed withdrawal.
function updateExistingCamps(state, config, runtime, action, externalConfig, externalState, tick) {
  const kept = [];
  for (const camp of externalState.camps) {
    if (!camp || typeof camp !== 'object') {
      continue;
    }
    const active = updateSingleCamp(state, config, runtime, action, externalConfig, externalState, camp, tick);
    if (active) {
      kept.push(camp);
      continue;
    }
    finalizeCampDeparture(state, config, externalConfig, externalState, camp, tick);
  }
  externalState.camps = kept;
}

// Tick one camp according to current phase and role.
function updateSingleCamp(state, config, runtime, action, externalConfig, externalState, camp, tick) {
  normalizeCampRuntimeState(camp, externalConfig);

  if (camp.phase === 'setting_up') {
    camp.phaseTicksRemaining = Math.max(0, Number(camp.phaseTicksRemaining || 0) - 1);
    if (camp.phaseTicksRemaining <= 0) {
      camp.phase = 'active';
      camp.phaseTicksRemaining = Math.max(1, Number(camp.activeTicks || 1));
      camp.nextActionTick = tick + getRoleInterval(externalConfig, camp.role);
      emitCampEvent(state, config, camp, 'activated', `External camp active: ${camp.factionLabel} (${camp.role})`);
    }
    return true;
  }

  if (camp.phase === 'active') {
    if (camp.role === 'raider') {
      const raiderConfig = externalConfig.raider;
      camp.hostility = clamp(
        Number(camp.hostility || 0) - Number(raiderConfig.hostilityDecayPerTick || 0),
        raiderConfig.hostilityMin,
        raiderConfig.hostilityMax,
      );
    }

    if (tick >= Number(camp.nextActionTick || 0)) {
      runCampRoleTick(state, config, runtime, action, externalConfig, externalState, camp, tick);
      camp.nextActionTick = tick + getRoleInterval(externalConfig, camp.role);
    }

    if (camp.role === 'militia' && Number(camp.militiaDefenseBonus || 0) > 0) {
      externalState.stats.byRole.militia.defenseTicks = Number(externalState.stats.byRole.militia.defenseTicks || 0) + 1;
    }

    camp.phaseTicksRemaining = Math.max(0, Number(camp.phaseTicksRemaining || 0) - 1);
    if (camp.phaseTicksRemaining <= 0) {
      camp.phase = 'withdrawing';
      camp.phaseTicksRemaining = Math.max(1, Number(camp.withdrawTicks || 1));
      emitCampEvent(
        state,
        config,
        camp,
        'withdrawing',
        `External camp withdrawing: ${camp.factionLabel} (${camp.role})`,
      );
    }
    return true;
  }

  if (camp.phase === 'withdrawing') {
    camp.phaseTicksRemaining = Math.max(0, Number(camp.phaseTicksRemaining || 0) - 1);
    return camp.phaseTicksRemaining > 0;
  }

  return false;
}

// Ensure one camp object has all expected fields.
function normalizeCampRuntimeState(camp, externalConfig) {
  if (!camp.phase) {
    camp.phase = 'setting_up';
  }
  if (!Number.isFinite(camp.phaseTicksRemaining)) {
    camp.phaseTicksRemaining = Math.max(1, Number(camp.setupTicks || externalConfig.duration.setupMin));
  }
  if (!Number.isFinite(camp.nextActionTick)) {
    camp.nextActionTick = 0;
  }
  if (!Number.isFinite(camp.nextCaravanTick)) {
    camp.nextCaravanTick = 0;
  }
  camp.tradeActions = Math.max(0, Math.floor(Number(camp.tradeActions || 0)));
  camp.militiaContracts = Math.max(0, Math.floor(Number(camp.militiaContracts || 0)));
  camp.raiderDemands = Math.max(0, Math.floor(Number(camp.raiderDemands || 0)));
  camp.caravanDispatches = Math.max(0, Math.floor(Number(camp.caravanDispatches || 0)));
  camp.caravanArrivals = Math.max(0, Math.floor(Number(camp.caravanArrivals || 0)));
  camp.caravanIntercepts = Math.max(0, Math.floor(Number(camp.caravanIntercepts || 0)));
  camp.militiaDefenseBonus = Math.max(0, Number(camp.militiaDefenseBonus || 0));
  camp.hostility = clamp(Number(camp.hostility || 0), 0, 1);
  camp.radius = Math.max(0, Math.floor(Number(camp.radius || externalConfig.footprintRadius)));
}

// Resolve per-role action interval for active camps.
function getRoleInterval(externalConfig, role) {
  if (role === 'trade') {
    return Math.max(1, Number(externalConfig.trade.tickInterval || 1));
  }
  if (role === 'militia') {
    return Math.max(1, Number(externalConfig.militia.contractIntervalTicks || 1));
  }
  if (role === 'raider') {
    return Math.max(1, Number(externalConfig.raider.demandIntervalTicks || 1));
  }
  return 30;
}

// Run one role-specific periodic action for a camp.
function runCampRoleTick(state, config, runtime, action, externalConfig, externalState, camp, tick) {
  if (camp.role === 'trade') {
    runTradeCampTick(state, config, runtime, externalConfig, externalState, camp, tick);
    return;
  }
  if (camp.role === 'militia') {
    runMilitiaCampTick(state, config, action, externalConfig, externalState, camp);
    return;
  }
  if (camp.role === 'raider') {
    runRaiderCampTick(state, config, action, externalConfig, externalState, camp, tick);
  }
}

// Execute one trade-camp exchange based on surplus/shortage ratios.
function runTradeCampTick(state, config, runtime, externalConfig, externalState, camp, tick) {
  const tradeConfig = externalConfig.trade;
  const deal = resolveTradeCampDeal(state, config, tradeConfig, camp);
  if (!deal) {
    return;
  }

  const roleStats = externalState.stats.byRole.trade;
  const caravan = dispatchTradeCaravan(state, config, runtime, externalConfig, externalState, camp, deal, tick);
  if (caravan) {
    applyTradeCampGiveCost(state.stockpile, deal);
    camp.tradeActions = Number(camp.tradeActions || 0) + 1;
    camp.caravanDispatches = Number(camp.caravanDispatches || 0) + 1;
    roleStats.actions = Number(roleStats.actions || 0) + 1;
    roleStats.caravanDispatches = Number(roleStats.caravanDispatches || 0) + 1;
    roleStats.given[deal.giveResource] = Number(roleStats.given[deal.giveResource] || 0) + deal.giveAmount;

    externalState.stats.caravans.dispatched = Number(externalState.stats.caravans.dispatched || 0) + 1;
    const convoyCount = Number(externalState.stats.caravans.dispatched || 0);
    if (convoyCount === 1 || convoyCount % tradeConfig.eventEveryTrades === 0) {
      emitCampEvent(
        state,
        config,
        camp,
        'caravan_dispatched',
        `Trade caravan departed: ${camp.factionLabel} (${deal.giveResource} -${deal.giveAmount} for ${deal.receiveResource})`,
        buildResourceConsequences({ [deal.giveResource]: deal.giveAmount }, -1),
      );
    }
    return;
  }

  applyTradeCampDeal(state.stockpile, deal);

  camp.tradeActions = Number(camp.tradeActions || 0) + 1;
  roleStats.actions = Number(roleStats.actions || 0) + 1;
  roleStats.given[deal.giveResource] = Number(roleStats.given[deal.giveResource] || 0) + deal.giveAmount;
  roleStats.received[deal.receiveResource] = Number(roleStats.received[deal.receiveResource] || 0) + deal.receiveAmount;

  if (camp.tradeActions === 1 || camp.tradeActions % tradeConfig.eventEveryTrades === 0) {
    emitCampEvent(
      state,
      config,
      camp,
      'trade_completed',
      `Trade camp: ${camp.factionLabel} ${deal.giveResource} -${deal.giveAmount}, ${deal.receiveResource} +${deal.receiveAmount}`,
      [
        ...buildResourceConsequences({ [deal.giveResource]: deal.giveAmount }, -1),
        ...buildResourceConsequences({ [deal.receiveResource]: deal.receiveAmount }),
      ],
    );
  }
}

// Spend only the give side of a trade deal at caravan dispatch.
function applyTradeCampGiveCost(stockpile, deal) {
  if (!stockpile || !deal) {
    return;
  }
  stockpile[deal.giveResource] = Math.max(0, Number(stockpile[deal.giveResource] || 0) - Number(deal.giveAmount || 0));
}

// Dispatch one trade caravan when config and capacity constraints allow.
function dispatchTradeCaravan(state, config, runtime, externalConfig, externalState, camp, deal, tick) {
  const caravanConfig = externalConfig.caravans;
  if (!caravanConfig || caravanConfig.enabled !== true || !camp || !deal) {
    return null;
  }
  if (tick < Number(camp.nextCaravanTick || 0)) {
    return null;
  }

  const activeCaravans = Array.isArray(externalState.caravans) ? externalState.caravans : [];
  if (activeCaravans.length >= caravanConfig.maxConcurrent) {
    return null;
  }
  const campCaravans = activeCaravans.filter((entry) => entry && String(entry.campId || '') === String(camp.id || ''));
  if (campCaravans.length >= caravanConfig.maxPerCamp) {
    return null;
  }

  const giveTarget = getCampStockpileTarget(state, config, deal.giveResource);
  const giveCurrent = Math.max(0, Number(state && state.stockpile && state.stockpile[deal.giveResource] || 0));
  const postGiveRatio = giveTarget > 0
    ? (giveCurrent - Math.max(0, Number(deal.giveAmount || 0))) / Math.max(1, giveTarget)
    : 1;
  if (postGiveRatio < 1) {
    return null;
  }

  const villageCenter = getCampVillageCenter(state, runtime);
  const payloadRange = caravanConfig.payloadAmountRange || { min: 6, max: 12 };
  const targetAmount = Math.max(1, Math.round(Number(deal.receiveAmount || 0) * Number(caravanConfig.payloadMultiplierFromDeal || 0)));
  const payloadAmount = clamp(
    targetAmount,
    Math.max(1, Number(payloadRange.min || 1)),
    Math.max(1, Number(payloadRange.max || payloadRange.min || 1)),
  );
  if (payloadAmount <= 0) {
    return null;
  }

  const caravan = {
    id: `caravan_${Math.max(1, Number(externalState.caravanCounter || 1))}`,
    campId: camp.id,
    campLabel: camp.factionLabel,
    factionId: camp.factionId,
    role: camp.role,
    phase: 'to_village',
    x: Math.floor(Number(camp.x || 0)),
    y: Math.floor(Number(camp.y || 0)),
    originX: Math.floor(Number(camp.x || 0)),
    originY: Math.floor(Number(camp.y || 0)),
    targetX: Math.floor(Number(villageCenter.x || 0)),
    targetY: Math.floor(Number(villageCenter.y || 0)),
    receiveResource: deal.receiveResource,
    receiveAmount: payloadAmount,
    stepEveryTicks: Math.max(1, Number(caravanConfig.stepEveryTicks || 2)),
    stepCooldown: 0,
    dispatchedTick: tick,
  };

  externalState.caravanCounter = Number(externalState.caravanCounter || 1) + 1;
  externalState.caravans.push(caravan);
  camp.nextCaravanTick = tick + Math.max(1, Number(caravanConfig.dispatchIntervalTicks || 1));
  return caravan;
}

// Resolve one viable trade exchange for a trade camp.
function resolveTradeCampDeal(state, config, tradeConfig, camp) {
  const resources = (config && config.resources) || {};
  const baseTargets = resources.targets || resources.stockpile || {};
  const targetResourceIds = Object.keys(baseTargets);
  if (targetResourceIds.length === 0) {
    return null;
  }

  const receivePool = Array.isArray(tradeConfig.allowReceiveResources) && tradeConfig.allowReceiveResources.length > 0
    ? tradeConfig.allowReceiveResources
    : targetResourceIds;

  const need = pickNeedResource(state, config, receivePool);
  if (!need) {
    return null;
  }

  const protectedSet = new Set(tradeConfig.protectedGiveResources || []);
  const give = pickSurplusResource(state, config, targetResourceIds, need.resourceId, protectedSet);
  if (!give) {
    return null;
  }

  const giveTarget = getCampStockpileTarget(state, config, give.resourceId, baseTargets);
  const giveCurrent = Math.max(0, Number(state.stockpile[give.resourceId] || 0));
  const floorRatio = resolveReserveFloorRatio(tradeConfig.reserveRatioFloor, give.resourceId);
  const floorAmount = giveTarget > 0 ? Math.floor(giveTarget * floorRatio) : 0;
  const maxGive = Math.max(0, giveCurrent - floorAmount);
  if (maxGive <= 0) {
    return null;
  }

  const giveAmount = Math.max(1, Math.min(maxGive, Math.round(tradeConfig.baseTradeAmount * (0.7 + Math.random() * 0.6))));
  if (giveAmount <= 0) {
    return null;
  }

  const needScarcity = clamp(1 - need.ratio, 0, 1);
  const giveSurplus = clamp(give.ratio - 1, 0, 1);
  const reputation = clamp(getFactionReputation(state, camp.factionId), -1, 1);
  const price = clamp(1 + needScarcity * 0.35 - giveSurplus * 0.2 - reputation * 0.15, 0.75, 1.45);
  const receiveAmount = Math.max(1, Math.round(giveAmount * price));

  return {
    giveResource: give.resourceId,
    giveAmount,
    receiveResource: need.resourceId,
    receiveAmount,
  };
}

// Choose the resource with the lowest stockpile ratio.
function pickNeedResource(state, config, resourceIds) {
  const candidates = [];
  for (const resourceId of resourceIds) {
    const target = getCampStockpileTarget(state, config, resourceId);
    if (target <= 0) {
      continue;
    }
    const current = Math.max(0, Number(state.stockpile[resourceId] || 0));
    candidates.push({
      resourceId,
      ratio: current / Math.max(1, target),
    });
  }
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((left, right) => left.ratio - right.ratio);
  return candidates[0];
}

// Choose the resource with the highest surplus ratio.
function pickSurplusResource(state, config, resourceIds, excludedResourceId, protectedSet) {
  const minSurplusRatio = 1.15;
  const candidates = [];
  for (const resourceId of resourceIds) {
    if (resourceId === excludedResourceId || protectedSet.has(resourceId)) {
      continue;
    }
    const target = getCampStockpileTarget(state, config, resourceId);
    if (target <= 0) {
      continue;
    }
    const current = Math.max(0, Number(state.stockpile[resourceId] || 0));
    const ratio = current / Math.max(1, target);
    if (ratio < minSurplusRatio) {
      continue;
    }
    candidates.push({ resourceId, ratio });
  }
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((left, right) => right.ratio - left.ratio);
  return candidates[0];
}

// Resolve reserve floor ratio for one resource id.
function resolveReserveFloorRatio(reserveMap, resourceId) {
  if (!reserveMap || typeof reserveMap !== 'object') {
    return 0.65;
  }
  if (Number.isFinite(reserveMap[resourceId])) {
    return clamp(Number(reserveMap[resourceId]), 0, 1);
  }
  return clamp(Number(reserveMap.default || 0.65), 0, 1);
}

// Apply one resolved trade deal to stockpiles.
function applyTradeCampDeal(stockpile, deal) {
  if (!stockpile || !deal) {
    return;
  }
  stockpile[deal.giveResource] = Math.max(0, Number(stockpile[deal.giveResource] || 0) - Number(deal.giveAmount || 0));
  stockpile[deal.receiveResource] = Math.max(0, Number(stockpile[deal.receiveResource] || 0) + Number(deal.receiveAmount || 0));
}

// Execute one militia-camp support contract cycle.
function runMilitiaCampTick(state, config, action, externalConfig, externalState, camp) {
  const militiaConfig = externalConfig.militia;
  const roleStats = externalState.stats.byRole.militia;
  camp.militiaContracts = Number(camp.militiaContracts || 0) + 1;
  roleStats.actions = Number(roleStats.actions || 0) + 1;

  const reputation = clamp(getFactionReputation(state, camp.factionId), -1, 1);
  const desiredBonus = clamp(
    militiaConfig.baseRaidDefenseBonus + Math.max(0, reputation) * militiaConfig.reputationBonusScale,
    0,
    militiaConfig.maxRaidDefenseBonus,
  );

  const canPay = hasCosts(state.stockpile, militiaConfig.supportCosts)
    && passesMinStockpileRatios(state, config, militiaConfig.supportMinStockpileRatios);
  const decision = resolveMilitiaSupportDecision(state, config, action, canPay);

  if (decision.shouldPay) {
    consumeCosts(state.stockpile, militiaConfig.supportCosts);
    camp.militiaDefenseBonus = desiredBonus;
    roleStats.paid = Number(roleStats.paid || 0) + 1;
    if (camp.militiaContracts === 1 || camp.militiaContracts % militiaConfig.eventEveryContracts === 0) {
      emitCampEvent(
        state,
        config,
        camp,
        'militia_support_renewed',
        `Militia camp: ${camp.factionLabel} patrol contract renewed (+${Math.round(camp.militiaDefenseBonus * 100)}% defense)`,
      );
    }
    return;
  }

  camp.militiaDefenseBonus = Math.max(0, camp.militiaDefenseBonus - militiaConfig.defenseBonusDecayOnMiss);
  roleStats.rejected = Number(roleStats.rejected || 0) + 1;

  if (camp.militiaContracts % militiaConfig.eventEveryContracts === 0) {
    const skipReason = canPay && decision.source === 'action'
      ? 'policy hold'
      : 'low reserves';
    emitCampEvent(
      state,
      config,
      camp,
      'militia_support_skipped',
      `Militia camp: ${camp.factionLabel} support skipped (${skipReason})`,
    );
  }
}

// Execute one raider-camp tribute demand cycle.
function runRaiderCampTick(state, config, action, externalConfig, externalState, camp, tick) {
  void tick;
  const raiderConfig = externalConfig.raider;
  const roleStats = externalState.stats.byRole.raider;

  camp.raiderDemands = Number(camp.raiderDemands || 0) + 1;
  roleStats.actions = Number(roleStats.actions || 0) + 1;

  const canPay = hasCosts(state.stockpile, raiderConfig.tributeCosts)
    && passesMinStockpileRatios(state, config, raiderConfig.tributeMinStockpileRatios);
  const decision = resolveRaiderTributeDecision(state, config, action, canPay);

  if (decision.shouldPay) {
    consumeCosts(state.stockpile, raiderConfig.tributeCosts);
    camp.hostility = clamp(
      Number(camp.hostility || 0) - raiderConfig.hostilityDecayOnPay,
      raiderConfig.hostilityMin,
      raiderConfig.hostilityMax,
    );
    roleStats.paid = Number(roleStats.paid || 0) + 1;
    if (camp.raiderDemands === 1 || camp.raiderDemands % raiderConfig.eventEveryDemands === 0) {
      emitCampEvent(
        state,
        config,
        camp,
        'tribute_paid',
        `Raider camp: tribute paid to ${camp.factionLabel} (hostility ${Math.round(camp.hostility * 100)}%${decision.forced ? ', forced' : ''})`,
        buildResourceConsequences(raiderConfig.tributeCosts, -1),
      );
    }
    return;
  }

  camp.hostility = clamp(
    Number(camp.hostility || 0) + raiderConfig.hostilityGainOnReject,
    raiderConfig.hostilityMin,
    raiderConfig.hostilityMax,
  );
  roleStats.rejected = Number(roleStats.rejected || 0) + 1;

  const lossRatio = clamp(
    raiderConfig.skirmishLossRatioBase + raiderConfig.skirmishLossRatioPerHostility * camp.hostility,
    0,
    1,
  );
  const losses = applyWeightedStockpileLoss(state.stockpile, lossRatio, raiderConfig.skirmishLossWeights);
  mergeAmountMap(roleStats.losses, losses);
  mergeAmountMap(externalState.stats.losses, losses);

  const lossSummary = formatLossSummary(losses);
  if (lossSummary) {
    externalState.stats.skirmishes = Number(externalState.stats.skirmishes || 0) + 1;
    const stanceTag = canPay && decision.source === 'action'
      ? ', policy refused tribute'
      : '';
    emitCampEvent(
      state,
      config,
      camp,
      'skirmish',
      `Raider camp: ${camp.factionLabel} skirmish (${lossSummary}${stanceTag})`,
      buildResourceConsequences(losses, -1),
    );
  } else {
    emitCampEvent(
      state,
      config,
      camp,
      'pressure_rose',
      `Raider camp: ${camp.factionLabel} pressure rises`,
    );
  }
}

// Resolve normalized external-camps governor config with safe defaults.
function getExternalCampsGovernorConfig(config) {
  const aiConfig = (config && config.ai) || {};
  const governors = aiConfig.governors && typeof aiConfig.governors === 'object'
    ? aiConfig.governors
    : {};
  const source = governors.externalCamps && typeof governors.externalCamps === 'object'
    ? governors.externalCamps
    : {};
  const militiaIntentThresholdRaw = Number(source.militiaIntentThreshold);
  const raiderIntentThresholdRaw = Number(source.raiderTributeIntentThreshold);
  const criticalStockpileFloorRaw = Number(source.criticalStockpileFloor);
  return {
    enabled: source.enabled !== false,
    militiaIntentThreshold: clamp(
      Number.isFinite(militiaIntentThresholdRaw) ? militiaIntentThresholdRaw : 0.5,
      0,
      1,
    ),
    raiderTributeIntentThreshold: clamp(
      Number.isFinite(raiderIntentThresholdRaw) ? raiderIntentThresholdRaw : 0.5,
      0,
      1,
    ),
    forceComplianceOnCritical: source.forceComplianceOnCritical === true,
    criticalStockpileFloor: clamp(
      Number.isFinite(criticalStockpileFloorRaw) ? criticalStockpileFloorRaw : 0.4,
      0,
      1,
    ),
    criticalResources: normalizeGovernorResourceList(source.criticalResources, ['food', 'water']),
  };
}

// Normalize external-camps governor critical-resource ids.
function normalizeGovernorResourceList(source, fallback) {
  const list = Array.isArray(source) ? source : fallback;
  const normalized = [];
  for (const rawValue of list) {
    const resourceId = String(rawValue || '').trim();
    if (resourceId && !normalized.includes(resourceId)) {
      normalized.push(resourceId);
    }
  }
  return normalized;
}

// Resolve optional external-camps action payload from governor envelope.
function getExternalCampsAction(action) {
  if (!action || typeof action !== 'object') {
    return null;
  }
  const externalCamps = action.externalCamps;
  if (!externalCamps || typeof externalCamps !== 'object' || Array.isArray(externalCamps)) {
    return null;
  }
  return externalCamps;
}

// Normalize one governor intent from AI action range into 0..1.
function normalizeGovernorIntent(value, config, fallback) {
  const aiConfig = (config && config.ai) || {};
  const minWeightRaw = Number(aiConfig.minWeight);
  const maxWeightRaw = Number(aiConfig.maxWeight);
  const minWeight = Number.isFinite(minWeightRaw) ? minWeightRaw : 0;
  const maxWeight = Number.isFinite(maxWeightRaw) ? maxWeightRaw : 1;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return clamp(Number(fallback || 0), 0, 1);
  }
  if (maxWeight > minWeight) {
    return clamp((numeric - minWeight) / (maxWeight - minWeight), 0, 1);
  }
  return clamp(numeric, 0, 1);
}

// Check critical stockpile collapse across configured governor-critical resources.
function isCriticalStockpileCollapse(state, config, governorConfig) {
  if (!governorConfig || governorConfig.forceComplianceOnCritical !== true) {
    return false;
  }
  const floor = clamp(Number(governorConfig.criticalStockpileFloor || 0), 0, 1);
  if (floor <= 0) {
    return false;
  }
  const resources = Array.isArray(governorConfig.criticalResources)
    ? governorConfig.criticalResources
    : [];
  if (resources.length === 0) {
    return false;
  }
  let minRatio = 1;
  let found = false;
  for (const resourceId of resources) {
    const target = getCampStockpileTarget(state, config, resourceId);
    if (target <= 0) {
      continue;
    }
    const current = Math.max(0, Number(state && state.stockpile && state.stockpile[resourceId] || 0));
    minRatio = Math.min(minRatio, current / Math.max(1, target));
    found = true;
  }
  if (!found) {
    return false;
  }
  return minRatio <= floor;
}

// Resolve militia support stance using action intent, with safe default fallback.
function resolveMilitiaSupportDecision(state, config, action, canPay) {
  void state;
  const governorConfig = getExternalCampsGovernorConfig(config);
  const externalAction = governorConfig.enabled ? getExternalCampsAction(action) : null;
  const hasIntent = Boolean(
    externalAction && Object.prototype.hasOwnProperty.call(externalAction, 'militiaSupportIntent'),
  );
  const intent = hasIntent
    ? normalizeGovernorIntent(externalAction.militiaSupportIntent, config, 1)
    : 1;
  const shouldPay = canPay && (!hasIntent || intent >= governorConfig.militiaIntentThreshold);
  return {
    source: hasIntent ? 'action' : 'default',
    intent,
    shouldPay,
    forced: false,
  };
}

// Resolve raider tribute stance using action intent plus critical-collapse force-compliance.
function resolveRaiderTributeDecision(state, config, action, canPay) {
  const governorConfig = getExternalCampsGovernorConfig(config);
  const externalAction = governorConfig.enabled ? getExternalCampsAction(action) : null;
  const hasIntent = Boolean(
    externalAction && Object.prototype.hasOwnProperty.call(externalAction, 'raiderTributeIntent'),
  );
  const intent = hasIntent
    ? normalizeGovernorIntent(externalAction.raiderTributeIntent, config, 1)
    : 1;
  const forced = Boolean(
    canPay
    && governorConfig.enabled
    && isCriticalStockpileCollapse(state, config, governorConfig),
  );
  const shouldPay = canPay && (forced || !hasIntent || intent >= governorConfig.raiderTributeIntentThreshold);
  return {
    source: hasIntent ? 'action' : 'default',
    intent,
    shouldPay,
    forced,
  };
}

// Advance all active caravan entities on the map.
function updateCaravans(state, config, runtime, externalConfig, externalState, tick) {
  void tick;
  const caravanConfig = externalConfig.caravans;
  if (!caravanConfig || caravanConfig.enabled !== true) {
    externalState.caravans = [];
    return;
  }
  const caravans = Array.isArray(externalState.caravans) ? externalState.caravans : [];
  if (caravans.length === 0) {
    return;
  }

  const kept = [];
  for (const caravan of caravans) {
    if (!caravan || typeof caravan !== 'object') {
      continue;
    }
    const keep = updateSingleCaravan(state, config, runtime, externalConfig, externalState, caravan);
    if (keep) {
      kept.push(caravan);
    }
  }
  externalState.caravans = kept;
}

// Tick one caravan and return true while it remains active.
function updateSingleCaravan(state, config, runtime, externalConfig, externalState, caravan) {
  normalizeCaravanRuntimeState(caravan, externalConfig);

  if (caravan.stepCooldown > 0) {
    caravan.stepCooldown -= 1;
    return true;
  }

  stepCaravanTowardsTarget(caravan, state, runtime);
  caravan.stepCooldown = Math.max(0, Number(caravan.stepEveryTicks || 1) - 1);

  if (caravan.phase === 'to_village') {
    if (tryInterceptCaravan(state, config, externalConfig, externalState, caravan)) {
      return false;
    }
    if (caravan.x === caravan.targetX && caravan.y === caravan.targetY) {
      finalizeCaravanArrival(state, config, externalConfig, externalState, caravan);
    }
    return true;
  }

  if (caravan.phase === 'returning' && caravan.x === caravan.targetX && caravan.y === caravan.targetY) {
    finalizeCaravanReturn(externalState);
    return false;
  }

  return true;
}

// Ensure one caravan object has all expected runtime fields.
function normalizeCaravanRuntimeState(caravan, externalConfig) {
  const caravanConfig = externalConfig.caravans || {};
  if (!caravan.phase) {
    caravan.phase = 'to_village';
  }
  caravan.stepEveryTicks = Math.max(1, Math.floor(Number(caravan.stepEveryTicks || caravanConfig.stepEveryTicks || 2)));
  caravan.stepCooldown = Math.max(0, Math.floor(Number(caravan.stepCooldown || 0)));
  caravan.targetX = Math.floor(Number(caravan.targetX || 0));
  caravan.targetY = Math.floor(Number(caravan.targetY || 0));
  caravan.originX = Math.floor(Number(caravan.originX || caravan.x || 0));
  caravan.originY = Math.floor(Number(caravan.originY || caravan.y || 0));
  caravan.receiveAmount = Math.max(1, Math.floor(Number(caravan.receiveAmount || 1)));
}

// Move one caravan one tile towards its current target.
function stepCaravanTowardsTarget(caravan, state, runtime) {
  const x = Math.floor(Number(caravan.x || 0));
  const y = Math.floor(Number(caravan.y || 0));
  const targetX = Math.floor(Number(caravan.targetX || x));
  const targetY = Math.floor(Number(caravan.targetY || y));
  if (x === targetX && y === targetY) {
    caravan.x = x;
    caravan.y = y;
    return;
  }

  const dx = targetX - x;
  const dy = targetY - y;
  const xStep = dx === 0 ? 0 : (dx > 0 ? 1 : -1);
  const yStep = dy === 0 ? 0 : (dy > 0 ? 1 : -1);

  const candidates = [];
  if (Math.abs(dx) >= Math.abs(dy)) {
    candidates.push({ x: x + xStep, y });
    candidates.push({ x, y: y + yStep });
  } else {
    candidates.push({ x, y: y + yStep });
    candidates.push({ x: x + xStep, y });
  }

  for (const candidate of candidates) {
    if (!candidate || !Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) {
      continue;
    }
    if (candidate.x < 0 || candidate.y < 0 || candidate.x >= runtime.gridWidth || candidate.y >= runtime.gridHeight) {
      continue;
    }
    if (!isSpawnableTile(state, candidate.x, candidate.y)) {
      continue;
    }
    caravan.x = candidate.x;
    caravan.y = candidate.y;
    return;
  }

  caravan.x = clamp(x, 0, runtime.gridWidth - 1);
  caravan.y = clamp(y, 0, runtime.gridHeight - 1);
}

// Apply caravan-delivered resources and switch the caravan to return phase.
function finalizeCaravanArrival(state, config, externalConfig, externalState, caravan) {
  const receiveResource = String(caravan.receiveResource || '');
  const receiveAmount = Math.max(1, Number(caravan.receiveAmount || 1));
  if (receiveResource) {
    state.stockpile[receiveResource] = Math.max(0, Number(state.stockpile[receiveResource] || 0) + receiveAmount);
    externalState.stats.caravans.payloadDelivered[receiveResource] = Number(
      externalState.stats.caravans.payloadDelivered[receiveResource] || 0,
    ) + receiveAmount;
    externalState.stats.byRole.trade.received[receiveResource] = Number(
      externalState.stats.byRole.trade.received[receiveResource] || 0,
    ) + receiveAmount;
  }

  externalState.stats.caravans.arrived = Number(externalState.stats.caravans.arrived || 0) + 1;
  externalState.stats.byRole.trade.caravanArrivals = Number(
    externalState.stats.byRole.trade.caravanArrivals || 0,
  ) + 1;

  const camp = findCampById(externalState, caravan.campId);
  if (camp) {
    camp.caravanArrivals = Number(camp.caravanArrivals || 0) + 1;
  }

  const arrivalCount = Number(externalState.stats.caravans.arrived || 0);
  const caravanConfig = externalConfig.caravans || {};
  if (arrivalCount === 1 || arrivalCount % Math.max(1, Number(caravanConfig.eventEveryArrivals || 1)) === 0) {
    emitCaravanEvent(
      state,
      config,
      caravan,
      'arrived',
      `Trade caravan arrived: ${caravan.campLabel} delivered ${receiveResource} +${Math.floor(receiveAmount)}`,
      buildResourceConsequences({ [receiveResource]: receiveAmount }),
    );
  }

  caravan.phase = 'returning';
  caravan.targetX = Math.floor(Number(caravan.originX || caravan.x || 0));
  caravan.targetY = Math.floor(Number(caravan.originY || caravan.y || 0));
}

// Finalize one caravan that successfully returned to its camp.
function finalizeCaravanReturn(externalState) {
  externalState.stats.caravans.returned = Number(externalState.stats.caravans.returned || 0) + 1;
}

// Resolve whether a caravan gets intercepted while crossing raider influence.
function tryInterceptCaravan(state, config, externalConfig, externalState, caravan) {
  const caravanConfig = externalConfig.caravans || {};
  const intercept = caravanConfig.intercept || {};
  if (intercept.enabled !== true) {
    return false;
  }
  if (caravan.phase !== 'to_village') {
    return false;
  }
  if (!isPointInsideRaiderInfluence(externalState, externalConfig, caravan.x, caravan.y)) {
    return false;
  }

  const modifiers = normalizeExternalCampModifiers(externalState.modifiers);
  const chance = clamp(
    Number(intercept.baseChancePerStep || 0)
      + modifiers.raiderPressure * Number(intercept.raiderPressureScale || 0)
      - Math.max(0, Number(modifiers.raidDefenseBonus || 0)) * Number(intercept.militiaMitigationScale || 0),
    0,
    0.85,
  );
  if (chance <= 0 || Math.random() >= chance) {
    return false;
  }

  externalState.stats.caravans.intercepted = Number(externalState.stats.caravans.intercepted || 0) + 1;
  externalState.stats.byRole.trade.caravanIntercepts = Number(
    externalState.stats.byRole.trade.caravanIntercepts || 0,
  ) + 1;
  const camp = findCampById(externalState, caravan.campId);
  if (camp) {
    camp.caravanIntercepts = Number(camp.caravanIntercepts || 0) + 1;
  }

  const interceptedCount = Number(externalState.stats.caravans.intercepted || 0);
  if (interceptedCount === 1 || interceptedCount % Math.max(1, Number(caravanConfig.eventEveryInterceptions || 1)) === 0) {
    emitCaravanEvent(
      state,
      config,
      caravan,
      'intercepted',
      `Trade caravan intercepted: ${caravan.campLabel} lost ${caravan.receiveResource}`,
    );
  }
  return true;
}

// Check whether a position lies inside any active raider influence area.
function isPointInsideRaiderInfluence(externalState, externalConfig, x, y) {
  const influenceConfig = externalConfig.influence || {};
  if (influenceConfig.enabled === false) {
    return false;
  }
  const radius = Math.max(0, Math.floor(Number(influenceConfig.raiderRadius || 0)));
  if (radius <= 0) {
    return false;
  }
  const activeCamps = Array.isArray(externalState && externalState.camps) ? externalState.camps : [];
  for (const camp of activeCamps) {
    if (!camp || camp.phase !== 'active' || camp.role !== 'raider') {
      continue;
    }
    const distance = Math.abs(Number(camp.x || 0) - Number(x || 0)) + Math.abs(Number(camp.y || 0) - Number(y || 0));
    if (distance <= radius) {
      return true;
    }
  }
  return false;
}

// Find one camp by id from active runtime state.
function findCampById(externalState, campId) {
  const camps = Array.isArray(externalState && externalState.camps) ? externalState.camps : [];
  const target = String(campId || '');
  if (!target) {
    return null;
  }
  return camps.find((camp) => camp && String(camp.id || '') === target) || null;
}

// Check if stockpile covers all resource costs.
function hasCosts(stockpile, costs) {
  if (!costs || typeof costs !== 'object') {
    return false;
  }
  for (const [resourceId, amountRaw] of Object.entries(costs)) {
    const amount = Math.max(0, Number(amountRaw || 0));
    if (amount <= 0) {
      continue;
    }
    const available = Math.max(0, Number(stockpile[resourceId] || 0));
    if (available < amount) {
      return false;
    }
  }
  return true;
}

// Consume resource costs from stockpile.
function consumeCosts(stockpile, costs) {
  if (!stockpile || !costs || typeof costs !== 'object') {
    return;
  }
  for (const [resourceId, amountRaw] of Object.entries(costs)) {
    const amount = Math.max(0, Number(amountRaw || 0));
    if (amount <= 0) {
      continue;
    }
    const available = Math.max(0, Number(stockpile[resourceId] || 0));
    stockpile[resourceId] = Math.max(0, available - amount);
  }
}

// Validate stockpile guardrails expressed as target ratios.
function passesMinStockpileRatios(state, config, ratios) {
  if (!ratios || typeof ratios !== 'object') {
    return true;
  }
  for (const [resourceId, minRatioRaw] of Object.entries(ratios)) {
    const minRatio = clamp(Number(minRatioRaw || 0), 0, 1);
    if (minRatio <= 0) {
      continue;
    }
    const target = getCampStockpileTarget(state, config, resourceId);
    if (target <= 0) {
      continue;
    }
    const current = Math.max(0, Number(state.stockpile[resourceId] || 0));
    const ratio = current / Math.max(1, target);
    if (ratio < minRatio) {
      return false;
    }
  }
  return true;
}

// Apply weighted stockpile losses and return a compact loss map.
function applyWeightedStockpileLoss(stockpile, ratio, weights) {
  const losses = {};
  const safeRatio = clamp(Number(ratio || 0), 0, 1);
  if (safeRatio <= 0 || !stockpile || typeof stockpile !== 'object') {
    return losses;
  }

  for (const [resourceId, amountRaw] of Object.entries(stockpile)) {
    const weight = Math.max(0, Number(weights && weights[resourceId] || 0));
    if (weight <= 0) {
      continue;
    }
    const amount = Math.max(0, Number(amountRaw || 0));
    if (amount <= 0) {
      continue;
    }
    const loss = Math.max(0, Math.floor(amount * safeRatio * weight));
    if (loss <= 0) {
      continue;
    }
    stockpile[resourceId] = Math.max(0, amount - loss);
    losses[resourceId] = loss;
  }

  return losses;
}

// Merge source amount map into target map.
function mergeAmountMap(target, source) {
  if (!target || typeof target !== 'object' || !source || typeof source !== 'object') {
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

// Format a compact loss summary string.
function formatLossSummary(losses) {
  const entries = Object.entries(losses || {})
    .filter(([, amount]) => Number(amount || 0) > 0)
    .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0));
  if (entries.length === 0) {
    return '';
  }
  return entries.slice(0, 3).map(([resourceId, amount]) => `${resourceId} -${Math.floor(Number(amount || 0))}`).join(', ');
}

// Spawn a new camp when cadence and guardrails allow it.
function spawnCampIfEligible(state, config, runtime, externalConfig, externalState, tick) {
  if (tick < externalConfig.minTick) {
    return;
  }
  if (externalConfig.blockDuringRaid && state.raid && state.raid.active) {
    return;
  }
  if (externalState.camps.length >= externalConfig.maxActive) {
    return;
  }
  if (tick < Number(externalState.cooldownUntilTick || 0)) {
    return;
  }
  if (tick < Number(externalState.nextSpawnTick || 0)) {
    return;
  }

  const faction = pickWeightedFaction(externalConfig.factions, externalState.factionCooldownById, tick);
  if (!faction) {
    externalState.nextSpawnTick = scheduleNextCampSpawnTick(externalConfig, tick);
    return;
  }

  const center = pickCampCenter(state, runtime, externalConfig, externalState.camps);
  if (!center) {
    externalState.nextSpawnTick = scheduleNextCampSpawnTick(externalConfig, tick + 40);
    return;
  }

  const camp = buildCampDescriptor(externalState.counter, faction, center, externalConfig, tick);
  externalState.counter = Number(externalState.counter || 1) + 1;
  externalState.camps.push(camp);

  externalState.stats.spawned = Number(externalState.stats.spawned || 0) + 1;
  externalState.stats.byRole[camp.role].spawned = Number(externalState.stats.byRole[camp.role].spawned || 0) + 1;

  const cooldown = randomBetween(externalConfig.factionCooldown.min, externalConfig.factionCooldown.max);
  externalState.factionCooldownById[camp.factionId] = tick + cooldown;
  externalState.cooldownUntilTick = tick + externalConfig.globalCooldownTicks;
  externalState.nextSpawnTick = scheduleNextCampSpawnTick(externalConfig, tick);

  emitCampEvent(
    state,
    config,
    camp,
    'arrived',
    `External camp arrived: ${camp.factionLabel} (${camp.role})`,
  );
}

// Build one camp descriptor with deterministic lifecycle values.
function buildCampDescriptor(counter, faction, center, externalConfig, tick) {
  const setupTicks = randomBetween(externalConfig.duration.setupMin, externalConfig.duration.setupMax);
  const activeTicks = randomBetween(externalConfig.duration.activeMin, externalConfig.duration.activeMax);
  const withdrawTicks = randomBetween(externalConfig.duration.withdrawMin, externalConfig.duration.withdrawMax);
  const raiderConfig = externalConfig.raider;

  return {
    id: `camp_${Math.max(1, Number(counter || 1))}`,
    factionId: String(faction.id || 'external_faction'),
    factionLabel: String(faction.label || buildFactionLabel(faction.id)),
    role: normalizeCampRole(faction.role),
    phase: 'setting_up',
    phaseTicksRemaining: setupTicks,
    setupTicks,
    activeTicks,
    withdrawTicks,
    nextActionTick: tick + getRoleInterval(externalConfig, faction.role),
    nextCaravanTick: tick + Math.max(1, Number(externalConfig.caravans && externalConfig.caravans.dispatchIntervalTicks || 1)),
    x: center.x,
    y: center.y,
    radius: externalConfig.footprintRadius,
    tradeActions: 0,
    militiaContracts: 0,
    raiderDemands: 0,
    caravanDispatches: 0,
    caravanArrivals: 0,
    caravanIntercepts: 0,
    militiaDefenseBonus: 0,
    hostility: faction.role === 'raider' ? raiderConfig.hostilityInitial : 0,
    spawnedTick: tick,
  };
}

// Pick one faction by weight while honoring per-faction cooldown.
function pickWeightedFaction(factions, cooldownByFaction, tick) {
  const list = Array.isArray(factions)
    ? factions.filter((entry) => entry && Number(entry.weight || 0) > 0)
    : [];
  const eligible = list.filter((entry) => tick >= Number(cooldownByFaction[entry.id] || 0));
  if (eligible.length === 0) {
    return null;
  }

  const totalWeight = eligible.reduce((sum, entry) => sum + Math.max(0, Number(entry.weight || 0)), 0);
  if (totalWeight <= 0) {
    return eligible[0];
  }

  let roll = Math.random() * totalWeight;
  for (const entry of eligible) {
    roll -= Math.max(0, Number(entry.weight || 0));
    if (roll <= 0) {
      return entry;
    }
  }
  return eligible[eligible.length - 1];
}

// Pick one valid camp center near map edges with distance guardrails.
function pickCampCenter(state, runtime, externalConfig, existingCamps) {
  const edgePositions = buildShuffledEdgePositions(runtime);
  const villageCenter = getCampVillageCenter(state, runtime);

  for (const base of edgePositions) {
    const side = inferMapSide(runtime, base);
    const inward = randomBetween(externalConfig.footprintRadius + 1, externalConfig.footprintRadius + 6);
    const candidate = projectInwardFromEdge(base, side, inward, runtime);
    if (isValidCampCenter(state, runtime, candidate, villageCenter, existingCamps, externalConfig)) {
      return candidate;
    }
  }

  for (let y = 0; y < runtime.gridHeight; y += 1) {
    for (let x = 0; x < runtime.gridWidth; x += 1) {
      const candidate = { x, y };
      if (isValidCampCenter(state, runtime, candidate, villageCenter, existingCamps, externalConfig)) {
        return candidate;
      }
    }
  }

  return null;
}

// Build a randomized list of all edge positions.
function buildShuffledEdgePositions(runtime) {
  const list = [];
  for (const side of MAP_SIDES) {
    list.push(...getEdgePositions(runtime, side));
  }
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const temp = list[index];
    list[index] = list[swapIndex];
    list[swapIndex] = temp;
  }
  return list;
}

// Infer the closest edge side for one edge coordinate.
function inferMapSide(runtime, position) {
  if (position.y <= 0) {
    return 'north';
  }
  if (position.y >= runtime.gridHeight - 1) {
    return 'south';
  }
  if (position.x <= 0) {
    return 'west';
  }
  return 'east';
}

// Move one edge coordinate inward by a fixed amount.
function projectInwardFromEdge(position, side, inward, runtime) {
  let x = Number(position.x || 0);
  let y = Number(position.y || 0);
  if (side === 'north') {
    y += inward;
  } else if (side === 'south') {
    y -= inward;
  } else if (side === 'west') {
    x += inward;
  } else {
    x -= inward;
  }
  return {
    x: clamp(Math.floor(x), 0, runtime.gridWidth - 1),
    y: clamp(Math.floor(y), 0, runtime.gridHeight - 1),
  };
}

// Validate one center candidate against terrain and spacing constraints.
function isValidCampCenter(state, runtime, center, villageCenter, existingCamps, externalConfig) {
  if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) {
    return false;
  }

  const radius = Math.max(0, Number(externalConfig.footprintRadius || 0));
  if (center.x - radius < 0 || center.y - radius < 0
      || center.x + radius >= runtime.gridWidth || center.y + radius >= runtime.gridHeight) {
    return false;
  }

  const distanceToVillage = Math.abs(center.x - villageCenter.x) + Math.abs(center.y - villageCenter.y);
  if (distanceToVillage < externalConfig.minDistanceFromVillage) {
    return false;
  }

  for (const camp of existingCamps) {
    if (!camp) {
      continue;
    }
    const distance = Math.abs(center.x - Number(camp.x || 0)) + Math.abs(center.y - Number(camp.y || 0));
    if (distance < externalConfig.minDistanceBetween) {
      return false;
    }
  }

  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = center.x + dx;
      const y = center.y + dy;
      if (!isSpawnableTile(state, x, y)) {
        return false;
      }
      if (!isCampBuildableCell(state, runtime, x, y)) {
        return false;
      }
    }
  }

  return true;
}

// Finalize one departed camp and update history/statistics.
function finalizeCampDeparture(state, config, externalConfig, externalState, camp, tick) {
  externalState.stats.departed = Number(externalState.stats.departed || 0) + 1;
  externalState.stats.byRole[camp.role].departed = Number(externalState.stats.byRole[camp.role].departed || 0) + 1;

  const summary = buildCampDepartureSummary(camp);
  emitCampEvent(
    state,
    config,
    camp,
    'departed',
    summary ? `External camp departed: ${summary}` : `External camp departed: ${camp.factionLabel}`,
  );

  externalState.history.push({
    id: camp.id,
    factionId: camp.factionId,
    factionLabel: camp.factionLabel,
    role: camp.role,
    spawnedTick: Number(camp.spawnedTick || 0),
    endedTick: tick,
    tradeActions: Number(camp.tradeActions || 0),
    caravanDispatches: Number(camp.caravanDispatches || 0),
    caravanArrivals: Number(camp.caravanArrivals || 0),
    caravanIntercepts: Number(camp.caravanIntercepts || 0),
    militiaContracts: Number(camp.militiaContracts || 0),
    raiderDemands: Number(camp.raiderDemands || 0),
    hostility: Number(camp.hostility || 0),
  });

  trimCampHistory(externalState, externalConfig.historyLimit);
}

// Build one compact departure summary string.
function buildCampDepartureSummary(camp) {
  if (!camp) {
    return '';
  }
  if (camp.role === 'trade') {
    return `${camp.factionLabel} trade x${Math.max(0, Number(camp.tradeActions || 0))}, convoys ${Math.max(0, Number(camp.caravanArrivals || 0))}/${Math.max(0, Number(camp.caravanDispatches || 0))}`;
  }
  if (camp.role === 'militia') {
    const defensePct = Math.round(Math.max(0, Number(camp.militiaDefenseBonus || 0)) * 100);
    return `${camp.factionLabel} patrols x${Math.max(0, Number(camp.militiaContracts || 0))}, defense +${defensePct}%`;
  }
  if (camp.role === 'raider') {
    const hostilityPct = Math.round(Math.max(0, Number(camp.hostility || 0)) * 100);
    return `${camp.factionLabel} demands x${Math.max(0, Number(camp.raiderDemands || 0))}, hostility ${hostilityPct}%`;
  }
  return camp.factionLabel;
}

// Keep camp history length within configured limit.
function trimCampHistory(externalState, limitRaw) {
  const limit = Math.max(0, Math.floor(Number(limitRaw || 0)));
  if (limit <= 0) {
    return;
  }
  if (externalState.history.length > limit) {
    externalState.history = externalState.history.slice(externalState.history.length - limit);
  }
}

// Compute aggregate modifiers exposed to other simulation systems.
function rebuildExternalCampModifiers(state, runtime, externalConfig, externalState) {
  const activeCamps = externalState.camps.filter((camp) => camp && camp.phase === 'active');
  const villageCenter = getCampVillageCenter(state, runtime);
  const influenceConfig = externalConfig.influence || {};
  const useInfluence = influenceConfig.enabled !== false && influenceConfig.useForModifiers !== false;

  let tradeStrengthSum = 0;
  let tradeCampCount = 0;
  let militiaWeightedBonus = 0;
  let militiaStrengthSum = 0;
  let militiaCampCount = 0;
  let raiderWeightedPressure = 0;
  let raiderStrengthSum = 0;
  let raiderCampCount = 0;

  for (const camp of activeCamps) {
    if (!camp) {
      continue;
    }
    const strength = useInfluence
      ? getCampInfluenceStrength(camp, villageCenter, influenceConfig)
      : 1;
    if (camp.role === 'trade') {
      tradeCampCount += 1;
      tradeStrengthSum += strength;
      continue;
    }
    if (camp.role === 'militia') {
      militiaCampCount += 1;
      militiaStrengthSum += strength;
      militiaWeightedBonus += Math.max(0, Number(camp.militiaDefenseBonus || 0)) * strength;
      continue;
    }
    if (camp.role === 'raider') {
      raiderCampCount += 1;
      raiderStrengthSum += strength;
      raiderWeightedPressure += clamp(Number(camp.hostility || 0), 0, 1) * strength;
    }
  }

  const tradeBonus = Math.min(
    externalConfig.trade.merchantTradeRateBonusMax,
    tradeStrengthSum * externalConfig.trade.merchantTradeRateBonusPerCamp,
  );
  const contractBonus = Math.min(
    externalConfig.trade.contractRewardBonusMax,
    tradeStrengthSum * externalConfig.trade.contractRewardBonusPerCamp,
  );
  const militiaBonus = clamp(militiaWeightedBonus, 0, 1);
  const raiderPressure = raiderStrengthSum > 0
    ? clamp(raiderWeightedPressure / raiderStrengthSum, 0, 1)
    : 0;

  const interceptConfig = externalConfig.caravans && externalConfig.caravans.intercept
    ? externalConfig.caravans.intercept
    : {};
  const caravanInterceptRisk = clamp(
    Number(interceptConfig.baseChancePerStep || 0)
      + raiderPressure * Number(interceptConfig.raiderPressureScale || 0)
      - militiaBonus * Number(interceptConfig.militiaMitigationScale || 0),
    0,
    1,
  );

  externalState.modifiers = {
    merchantTradeRate: 1 + tradeBonus,
    contractReward: 1 + contractBonus,
    raidDefenseBonus: militiaBonus,
    raidDeathRate: 1 + clamp(raiderPressure, 0, 1) * externalConfig.raider.raidDeathRateBonusMax,
    raidResourceLoss: 1 + clamp(raiderPressure, 0, 1) * externalConfig.raider.raidResourceLossBonusMax,
    raiderPressure: clamp(raiderPressure, 0, 1),
    tradeInfluence: tradeCampCount > 0 ? clamp(tradeStrengthSum / tradeCampCount, 0, 1) : 0,
    militiaInfluence: militiaCampCount > 0 ? clamp(militiaStrengthSum / militiaCampCount, 0, 1) : 0,
    raiderInfluence: raiderCampCount > 0 ? clamp(raiderStrengthSum / raiderCampCount, 0, 1) : 0,
    caravanInterceptRisk: clamp(caravanInterceptRisk, 0, 1),
  };
}

// Resolve one role-specific influence radius.
function getCampInfluenceRadius(influenceConfig, role) {
  if (!influenceConfig || typeof influenceConfig !== 'object') {
    return 0;
  }
  if (role === 'militia') {
    return Math.max(0, Math.floor(Number(influenceConfig.militiaRadius || 0)));
  }
  if (role === 'raider') {
    return Math.max(0, Math.floor(Number(influenceConfig.raiderRadius || 0)));
  }
  return Math.max(0, Math.floor(Number(influenceConfig.tradeRadius || 0)));
}

// Compute linear influence strength of a camp at one map point.
function getCampInfluenceStrength(camp, point, influenceConfig) {
  if (!camp || !point) {
    return 0;
  }
  const radius = getCampInfluenceRadius(influenceConfig, camp.role);
  if (radius <= 0) {
    return 0;
  }
  const distance = Math.abs(Number(camp.x || 0) - Number(point.x || 0)) + Math.abs(Number(camp.y || 0) - Number(point.y || 0));
  if (distance > radius) {
    return 0;
  }
  const minStrength = clamp(Number(influenceConfig && influenceConfig.minStrength || 0), 0, 1);
  const linear = clamp(1 - distance / Math.max(1, radius), 0, 1);
  return clamp(minStrength + (1 - minStrength) * linear, 0, 1);
}

// Resolve one external-camp modifier value with fallback.
function getExternalCampModifier(state, key, fallback) {
  const externalState = state && state.externalCamps && typeof state.externalCamps === 'object'
    ? state.externalCamps
    : null;
  const modifiers = externalState && externalState.modifiers && typeof externalState.modifiers === 'object'
    ? externalState.modifiers
    : null;
  if (!modifiers || !key) {
    return fallback;
  }
  const value = Number(modifiers[key]);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

// Build a compact status payload for telemetry and overlays.
function getExternalCampStatus(state, config) {
  const externalConfig = getExternalCampsConfig(config);
  if (externalConfig.enabled !== true) {
    return null;
  }

  const externalState = state && state.externalCamps && typeof state.externalCamps === 'object'
    ? state.externalCamps
    : null;
  if (!externalState) {
    return {
      active: false,
      activeCount: 0,
      byRole: { trade: 0, militia: 0, raider: 0 },
      nextSpawnIn: 0,
      modifiers: normalizeExternalCampModifiers(null),
      caravans: {
        active: 0,
        toVillage: 0,
        returning: 0,
        dispatched: 0,
        arrived: 0,
        intercepted: 0,
      },
      camps: [],
    };
  }

  const tick = Math.max(0, Number(state && state.tick || 0));
  const activeCamps = Array.isArray(externalState.camps)
    ? externalState.camps.filter((camp) => camp && camp.phase !== 'withdrawing')
    : [];
  const byRole = { trade: 0, militia: 0, raider: 0 };
  for (const camp of activeCamps) {
    if (byRole[camp.role] !== undefined) {
      byRole[camp.role] += 1;
    }
  }
  const caravans = Array.isArray(externalState.caravans) ? externalState.caravans : [];
  const toVillage = caravans.filter((caravan) => caravan && caravan.phase === 'to_village').length;
  const returning = caravans.filter((caravan) => caravan && caravan.phase === 'returning').length;
  const caravanStats = externalState.stats && externalState.stats.caravans
    ? externalState.stats.caravans
    : normalizeCaravanStats(null);

  return {
    active: activeCamps.length > 0,
    activeCount: activeCamps.length,
    byRole,
    nextSpawnIn: Math.max(0, Number(externalState.nextSpawnTick || 0) - tick),
    modifiers: normalizeExternalCampModifiers(externalState.modifiers),
    caravans: {
      active: caravans.length,
      toVillage,
      returning,
      dispatched: Math.max(0, Number(caravanStats.dispatched || 0)),
      arrived: Math.max(0, Number(caravanStats.arrived || 0)),
      intercepted: Math.max(0, Number(caravanStats.intercepted || 0)),
    },
    camps: activeCamps
      .slice()
      .sort((left, right) => Number(left.phaseTicksRemaining || 0) - Number(right.phaseTicksRemaining || 0))
      .slice(0, 3)
      .map((camp) => ({
        id: camp.id,
        role: camp.role,
        label: camp.factionLabel,
        phase: camp.phase,
        ticksLeft: Math.max(0, Number(camp.phaseTicksRemaining || 0)),
        hostility: clamp(Number(camp.hostility || 0), 0, 1),
        defenseBonus: Math.max(0, Number(camp.militiaDefenseBonus || 0)),
      })),
  };
}

// Resolve faction reputation from contracts runtime (if available).
function getFactionReputation(state, factionId) {
  const contracts = state && state.contracts && typeof state.contracts === 'object'
    ? state.contracts
    : null;
  const reputations = contracts && contracts.reputations && typeof contracts.reputations === 'object'
    ? contracts.reputations
    : null;
  if (!reputations || !factionId) {
    return 0;
  }
  return clamp(Number(reputations[factionId] || 0), -1, 1);
}

// Resolve stockpile target without importing resource-system modules.
function getCampStockpileTarget(state, config, resourceId, fallbackTargets) {
  const resources = (config && config.resources) || {};
  const scaledTargets = state && state.resourceTargets ? state.resourceTargets : null;
  const targets = fallbackTargets || scaledTargets || resources.targets || resources.stockpile || {};
  const baseTarget = Math.max(0, Number(targets[resourceId] || 0));
  const perCapitaConfig = resources.targetsPerCapita || {};
  const perCapita = Math.max(0, Number(perCapitaConfig[resourceId] || 0));
  if (perCapita <= 0) {
    return baseTarget;
  }
  const population = Array.isArray(state && state.dwarves) ? state.dwarves.length : 0;
  return Math.max(0, baseTarget + perCapita * population);
}

// Resolve village center with local fallback logic.
function getCampVillageCenter(state, runtime) {
  const villages = state && Array.isArray(state.villages) ? state.villages : [];
  if (villages.length > 0) {
    const center = villages[0] && villages[0].center ? villages[0].center : null;
    if (center) {
      return clampPoint(center, runtime);
    }
  }

  const structures = state && Array.isArray(state.structures) ? state.structures : [];
  const houses = structures.filter((structure) => structure && structure.type === 'house');
  if (houses.length > 0) {
    const sum = houses.reduce((acc, house) => ({
      x: acc.x + Number(house.x || 0),
      y: acc.y + Number(house.y || 0),
    }), { x: 0, y: 0 });
    return clampPoint({
      x: Math.round(sum.x / houses.length),
      y: Math.round(sum.y / houses.length),
    }, runtime);
  }

  const workshops = structures.filter((structure) => structure && structure.type === 'workshop');
  if (workshops.length > 0) {
    return clampPoint(workshops[0], runtime);
  }

  return {
    x: clamp(Math.floor(Number(runtime.gridWidth || 0) / 2), 0, Math.max(0, runtime.gridWidth - 1)),
    y: clamp(Math.floor(Number(runtime.gridHeight || 0) / 2), 0, Math.max(0, runtime.gridHeight - 1)),
  };
}

// Clamp a coordinate-like object inside the runtime grid.
function clampPoint(point, runtime) {
  return {
    x: clamp(Math.floor(Number(point && point.x || 0)), 0, Math.max(0, runtime.gridWidth - 1)),
    y: clamp(Math.floor(Number(point && point.y || 0)), 0, Math.max(0, runtime.gridHeight - 1)),
  };
}

// Check if one tile can host camp footprint cells.
function isCampBuildableCell(state, runtime, x, y) {
  if (x < 0 || y < 0 || x >= runtime.gridWidth || y >= runtime.gridHeight) {
    return false;
  }
  if (!isSpawnableTile(state, x, y)) {
    return false;
  }
  const nodes = Array.isArray(state && state.nodes) ? state.nodes : [];
  for (const node of nodes) {
    if (Number(node.x || 0) === x && Number(node.y || 0) === y) {
      return false;
    }
  }
  const structures = Array.isArray(state && state.structures) ? state.structures : [];
  for (const structure of structures) {
    if (Number(structure.x || 0) === x && Number(structure.y || 0) === y) {
      return false;
    }
  }
  return true;
}

// Emit one committed camp lifecycle, trade, support, or pressure fact.
function emitCampEvent(state, config, camp, phase, message, consequences = null) {
  const campId = String(camp && camp.id || 'external_camp');
  const factionId = String(camp && camp.factionId || 'external_faction');
  return emitSecondaryEvent(state, config, {
    type: `external_camp.${phase}`,
    category: phase === 'skirmish' || phase === 'pressure_rose' ? 'combat' : 'diplomacy',
    message,
    actors: [
      buildSecondaryActor('camp', campId, 'primary', camp && camp.factionLabel),
      buildSecondaryActor('faction', factionId, 'secondary', camp && camp.factionLabel),
      buildSettlementActor(phase === 'skirmish' ? 'target' : 'beneficiary'),
    ],
    location: buildSecondaryLocation(camp, camp && camp.factionLabel),
    causes: [{
      kind: phase === 'arrived' || phase === 'activated' ? 'threshold' : 'action',
      ref: `external_camps.${camp && camp.role || 'camp'}`,
      metric: 'phase',
      value: phase,
    }],
    consequences: consequences || [{
      kind: 'status',
      targetKind: 'camp',
      targetId: campId,
      metric: 'phase',
      value: phase,
      unit: null,
    }],
    source: 'external_camps',
    tags: ['external_camp', String(camp && camp.role || 'camp'), phase],
  });
}

// Emit one caravan result at its last committed map position.
function emitCaravanEvent(state, config, caravan, phase, message, consequences = null) {
  const caravanId = String(caravan && caravan.id || 'trade_caravan');
  return emitSecondaryEvent(state, config, {
    type: `caravan.${phase}`,
    category: phase === 'intercepted' ? 'combat' : 'diplomacy',
    message,
    actors: [
      buildSecondaryActor('caravan', caravanId, 'primary', caravan && caravan.campLabel),
      buildSettlementActor(phase === 'intercepted' ? 'target' : 'beneficiary'),
    ],
    location: buildSecondaryLocation(caravan, 'Trade route'),
    causes: [{
      kind: phase === 'intercepted' ? 'action' : 'state',
      ref: `external_camps.caravan_${phase}`,
      metric: 'payload_resource',
      value: String(caravan && caravan.receiveResource || 'unknown'),
    }],
    consequences: consequences || [{
      kind: 'status',
      targetKind: 'caravan',
      targetId: caravanId,
      metric: 'phase',
      value: phase,
      unit: null,
    }],
    source: 'external_camps',
    tags: ['caravan', phase],
  });
}

module.exports = {
  getExternalCampsConfig,
  ensureExternalCampsState,
  updateExternalCamps,
  getExternalCampModifier,
  getExternalCampStatus,
};
