'use strict';

const { clamp } = require('../utils');
const {
  buildResourceConsequences,
  buildSecondaryActor,
  buildSettlementActor,
  emitSecondaryEvent,
} = require('./secondary_events');
const {
  getSchismFestivalIntent,
  resolveSchismFestivalRitualPlan,
  getSchismFestivalCostMultiplier,
  getSchismFestivalEffectMultiplier,
  notifySchismFestivalStarted,
} = require('./schism');

// Resolve festivals config with a safe fallback.
function getFestivalsConfig(config) {
  return (config && config.festivals) || {};
}

// Check that stockpile has all input costs available.
function hasInputs(stockpile, inputs) {
  for (const [resource, amount] of Object.entries(inputs)) {
    if (Number(stockpile[resource] || 0) < Number(amount || 0)) {
      return false;
    }
  }
  return true;
}

// Consume inputs from the stockpile.
function consumeInputs(stockpile, inputs) {
  for (const [resource, amount] of Object.entries(inputs)) {
    stockpile[resource] = Number(stockpile[resource] || 0) - Number(amount || 0);
  }
}

// Merge two positive cost maps.
function mergeCostMaps(baseCosts, extraCosts) {
  const merged = {};
  for (const [resource, amountRaw] of Object.entries(baseCosts || {})) {
    const amount = Number(amountRaw || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }
    merged[resource] = Math.max(1, Math.round(amount));
  }
  for (const [resource, amountRaw] of Object.entries(extraCosts || {})) {
    const amount = Number(amountRaw || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }
    merged[resource] = Math.max(1, Math.round(Number(merged[resource] || 0) + amount));
  }
  return merged;
}

// Build an integer cost map after applying an optional scalar.
function scaleFestivalCosts(rawCosts, scalar) {
  const scaled = {};
  const multiplier = Number.isFinite(Number(scalar)) && Number(scalar) > 0 ? Number(scalar) : 1;
  if (!rawCosts || typeof rawCosts !== 'object') {
    return scaled;
  }
  for (const [resource, amountRaw] of Object.entries(rawCosts)) {
    const amount = Number(amountRaw || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }
    scaled[resource] = Math.max(1, Math.round(amount * multiplier));
  }
  return scaled;
}

// Build a festival effect map after applying an optional scalar.
function scaleFestivalEffects(rawEffects, scalar) {
  const scaled = {};
  const multiplier = Number.isFinite(Number(scalar)) && Number(scalar) > 0 ? Number(scalar) : 1;
  if (!rawEffects || typeof rawEffects !== 'object') {
    return scaled;
  }
  for (const [key, valueRaw] of Object.entries(rawEffects)) {
    const value = Number(valueRaw);
    if (!Number.isFinite(value) || value <= 0) {
      continue;
    }
    if (value >= 1) {
      scaled[key] = 1 + (value - 1) * multiplier;
    } else {
      scaled[key] = 1 - (1 - value) * multiplier;
    }
    if (scaled[key] <= 0) {
      scaled[key] = 0.01;
    }
  }
  return scaled;
}

// Multiply active effect map by an additional multiplier map.
function mergeFestivalEffectMultipliers(baseEffects, extraEffects) {
  const merged = {};
  for (const [key, valueRaw] of Object.entries(baseEffects || {})) {
    const value = Number(valueRaw);
    if (!Number.isFinite(value) || value <= 0) {
      continue;
    }
    merged[key] = value;
  }
  for (const [key, valueRaw] of Object.entries(extraEffects || {})) {
    const value = Number(valueRaw);
    if (!Number.isFinite(value) || value <= 0) {
      continue;
    }
    merged[key] = Number(merged[key] || 1) * value;
  }
  return merged;
}

// Resolve current festival costs with schism doctrine scaling.
function getFestivalCosts(state, config, festivalsConfig) {
  const baseCosts = festivalsConfig && festivalsConfig.costs ? festivalsConfig.costs : {};
  const costMultiplier = getSchismFestivalCostMultiplier(state, config);
  return scaleFestivalCosts(baseCosts, costMultiplier);
}

// Compute the target stockpile amount, optionally scaling per capita.
function getStockpileTarget(state, config, resourceId) {
  const resources = (config && config.resources) || {};
  const scaledTargets = state && state.resourceTargets ? state.resourceTargets : null;
  const targets = scaledTargets || resources.targets || resources.stockpile || {};
  const baseTarget = Math.max(0, Number(targets[resourceId] || 0));
  const perCapitaConfig = resources.targetsPerCapita || {};
  const perCapita = Math.max(0, Number(perCapitaConfig[resourceId] || 0));
  if (perCapita <= 0) {
    return baseTarget;
  }
  const population = Array.isArray(state && state.dwarves) ? state.dwarves.length : 0;
  return Math.max(0, baseTarget + perCapita * population);
}

// Ensure the festival state exists and is normalized.
function ensureFestivalState(state, config) {
  const festivalsConfig = getFestivalsConfig(config);
  if (festivalsConfig.enabled === false) {
    if (state) {
      state.festival = null;
    }
    return null;
  }
  if (!state.festival || typeof state.festival !== 'object') {
    state.festival = {
      active: false,
      label: null,
      id: null,
      startedTick: null,
      durationTicks: 0,
      effects: {},
      source: null,
      ritualId: null,
      ritualLabel: null,
      lastSeasonIndex: null,
      lastSeasonName: null,
    };
  }
  if (!state.festival.effects || typeof state.festival.effects !== 'object') {
    state.festival.effects = {};
  }
  if (typeof state.festival.source !== 'string') {
    state.festival.source = null;
  }
  if (typeof state.festival.ritualId !== 'string') {
    state.festival.ritualId = null;
  }
  if (typeof state.festival.ritualLabel !== 'string') {
    state.festival.ritualLabel = null;
  }
  return state.festival;
}

// Resolve the current season index (global when available).
function getSeasonIndex(state) {
  if (!state || !state.season) {
    return 0;
  }
  const globalIndex = Number(state.season.globalIndex);
  if (Number.isFinite(globalIndex)) {
    return globalIndex;
  }
  const index = Number(state.season.index);
  return Number.isFinite(index) ? index : 0;
}

// Check if the season is eligible for festivals.
function isSeasonEligible(festivalsConfig, seasonName) {
  if (!seasonName) {
    return false;
  }
  const seasonNames = Array.isArray(festivalsConfig.seasonNames)
    ? festivalsConfig.seasonNames
    : [];
  if (seasonNames.length === 0) {
    return true;
  }
  return seasonNames.includes(seasonName);
}

// Check whether the festival window is open within the current season.
function isFestivalWindowOpen(state, festivalsConfig) {
  if (!state || !state.season) {
    return false;
  }
  const tickInSeason = Math.max(0, Number(state.season.tickInSeason || 0));
  const windowTicks = Math.max(1, Number(festivalsConfig.seasonWindowTicks || 1));
  if (tickInSeason <= 0) {
    return false;
  }
  return tickInSeason <= windowTicks;
}

// Compute the cost ratio for the configured festival costs.
function getFestivalCostRatio(state, config, festivalsConfig) {
  if (!state || !state.stockpile) {
    return 0;
  }
  const costs = getFestivalCosts(state, config, festivalsConfig);
  const minCostRatio = Math.max(0, Number(festivalsConfig.minCostRatio ?? 1));
  let ratio = Number.POSITIVE_INFINITY;
  let hasCost = false;

  for (const [resource, costRaw] of Object.entries(costs)) {
    const cost = Math.max(0, Number(costRaw || 0));
    if (cost <= 0) {
      continue;
    }
    hasCost = true;
    const current = Math.max(0, Number(state.stockpile[resource] || 0));
    const threshold = cost * (minCostRatio > 0 ? minCostRatio : 1);
    const resourceRatio = threshold > 0 ? current / threshold : 1;
    ratio = Math.min(ratio, resourceRatio);
  }

  if (!hasCost) {
    return 1;
  }
  if (!Number.isFinite(ratio)) {
    return 0;
  }
  return clamp(ratio, 0, 1);
}

// Check ratio-based stockpile guardrails.
function passesStockpileRatios(state, config, minStockpileRatios) {
  if (!minStockpileRatios || typeof minStockpileRatios !== 'object') {
    return true;
  }
  for (const [resource, minRatioRaw] of Object.entries(minStockpileRatios)) {
    const minRatio = clamp(Number(minRatioRaw || 0), 0, 1);
    if (minRatio <= 0) {
      continue;
    }
    const target = getStockpileTarget(state, config, resource);
    if (target <= 0) {
      continue;
    }
    const current = Math.max(0, Number(state.stockpile && state.stockpile[resource] || 0));
    const ratio = clamp(current / target, 0, 1);
    if (ratio < minRatio) {
      return false;
    }
  }
  return true;
}

// Determine whether the festival can be triggered right now.
function getFestivalEligibility(state, config, festivalsConfig) {
  const festival = state && state.festival ? state.festival : null;
  if (!state || !festivalsConfig || festivalsConfig.enabled === false) {
    return { eligible: false, costRatio: 0, costs: {} };
  }
  if (!state.season || !state.season.name) {
    return { eligible: false, costRatio: 0, costs: {} };
  }
  if (festival && festival.active) {
    return { eligible: false, costRatio: 0, costs: {} };
  }
  if (!isSeasonEligible(festivalsConfig, state.season.name)) {
    return { eligible: false, costRatio: 0, costs: {} };
  }
  if (!isFestivalWindowOpen(state, festivalsConfig)) {
    return { eligible: false, costRatio: 0, costs: {} };
  }
  if (festivalsConfig.blockDuringRaid === true && state.raid && state.raid.active) {
    return { eligible: false, costRatio: 0, costs: {} };
  }
  const population = Array.isArray(state.dwarves) ? state.dwarves.length : 0;
  const minPopulation = Math.max(0, Number(festivalsConfig.minPopulation || 0));
  if (population < minPopulation) {
    return { eligible: false, costRatio: 0, costs: {} };
  }

  const seasonIndex = getSeasonIndex(state);
  const minSeasonsBetween = Math.max(0, Number(festivalsConfig.cooldownSeasons || 0));
  if (festival && Number.isFinite(festival.lastSeasonIndex)) {
    if (seasonIndex - festival.lastSeasonIndex <= minSeasonsBetween) {
      return { eligible: false, costRatio: 0, costs: {} };
    }
  }

  const minStockpileRatios = festivalsConfig.minStockpileRatios || {};
  if (!passesStockpileRatios(state, config, minStockpileRatios)) {
    return { eligible: false, costRatio: 0, costs: {} };
  }

  const costs = getFestivalCosts(state, config, festivalsConfig);
  if (!hasInputs(state.stockpile, costs)) {
    return { eligible: false, costRatio: 0, costs };
  }

  const costRatio = getFestivalCostRatio(state, config, festivalsConfig);
  if (costRatio < 1) {
    return { eligible: false, costRatio, costs };
  }

  return { eligible: true, costRatio, costs };
}

// Normalize festival intent from action into 0..1.
function normalizeFestivalIntent(rawIntent, config) {
  const aiConfig = config && config.ai ? config.ai : {};
  const minWeight = Number(aiConfig.minWeight ?? 0);
  const maxWeight = Number(aiConfig.maxWeight ?? 1);
  const intentValue = Number(rawIntent);
  if (!Number.isFinite(intentValue)) {
    return 0;
  }
  if (maxWeight > minWeight) {
    return clamp((intentValue - minWeight) / (maxWeight - minWeight), 0, 1);
  }
  return clamp(intentValue, 0, 1);
}

// Update festival state each tick based on AI intent and guardrails.
function updateFestivals(state, config, runtime, action) {
  const festivalsConfig = getFestivalsConfig(config);
  if (festivalsConfig.enabled === false) {
    if (state) {
      state.festival = null;
    }
    return;
  }
  if (!state) {
    return;
  }
  const festival = ensureFestivalState(state, config);
  if (!festival) {
    return;
  }

  const aiIntentRaw = action && action.festivalIntent;
  const aiIntent = normalizeFestivalIntent(aiIntentRaw, config);
  const councilIntent = getSchismFestivalIntent(state, config);
  const intent = Math.max(aiIntent, councilIntent);

  if (festival.active) {
    const startedTick = Number(festival.startedTick || 0);
    const duration = Math.max(0, Number(festival.durationTicks || 0));
    const elapsed = Math.max(0, Number(state.tick || 0) - startedTick);
    if (duration > 0 && elapsed >= duration) {
      const label = festival.label || festivalsConfig.label || 'Festival';
      const completedFestival = { ...festival };
      festival.active = false;
      festival.id = null;
      festival.startedTick = null;
      festival.durationTicks = 0;
      festival.effects = {};
      festival.source = null;
      festival.ritualId = null;
      festival.ritualLabel = null;
      emitFestivalEvent(
        state,
        config,
        label,
        'ended',
        `Festival ended: ${label}`,
        null,
        completedFestival,
      );
    }
  }

  if (festival.active) {
    return;
  }

  const eligibility = getFestivalEligibility(state, config, festivalsConfig);
  if (!eligibility.eligible) {
    return;
  }

  const aiEnabled = !(festivalsConfig.ai && festivalsConfig.ai.enabled === false);
  const rawThreshold = (festivalsConfig.ai && festivalsConfig.ai.intentThreshold) ?? 0;
  const threshold = clamp(Number(rawThreshold), 0, 1);
  if (intent < threshold || (!aiEnabled && councilIntent <= 0)) {
    return;
  }

  const source = councilIntent >= threshold && councilIntent >= aiIntent ? 'council' : 'ai';
  const baseCosts = eligibility.costs || getFestivalCosts(state, config, festivalsConfig);
  const ritualPlan = resolveSchismFestivalRitualPlan(state, config, source, baseCosts);
  const costs = mergeCostMaps(baseCosts, ritualPlan ? ritualPlan.costs : null);
  if (!hasInputs(state.stockpile, costs)) {
    return;
  }
  consumeInputs(state.stockpile, costs);

  const label = festivalsConfig.label || 'Festival';
  festival.active = true;
  festival.label = label;
  festival.id = 'festival';
  festival.startedTick = Number(state.tick || 0);
  festival.durationTicks = Math.max(0, Number(festivalsConfig.durationTicks || 0));
  festival.effects = scaleFestivalEffects(
    festivalsConfig.effects && typeof festivalsConfig.effects === 'object'
      ? festivalsConfig.effects
      : {},
    getSchismFestivalEffectMultiplier(state, config),
  );
  if (ritualPlan && ritualPlan.festivalEffects) {
    festival.effects = mergeFestivalEffectMultipliers(
      festival.effects,
      ritualPlan.festivalEffects,
    );
  }
  festival.source = source;
  festival.ritualId = ritualPlan && ritualPlan.id ? String(ritualPlan.id) : null;
  festival.ritualLabel = ritualPlan && ritualPlan.label ? String(ritualPlan.label) : null;
  festival.lastSeasonIndex = getSeasonIndex(state);
  festival.lastSeasonName = state.season ? state.season.name : null;
  notifySchismFestivalStarted(state, config, source, ritualPlan);
  emitFestivalEvent(
    state,
    config,
    label,
    'started',
    source === 'council'
      ? `Festival started: ${label} (council decree${festival.ritualLabel ? `, ${festival.ritualLabel}` : ''})`
      : `Festival started: ${label}${festival.ritualLabel ? ` (${festival.ritualLabel})` : ''}`,
    buildResourceConsequences(costs, -1),
  );
}

// Emit one festival lifecycle fact with committed costs and source retained.
function emitFestivalEvent(state, config, label, phase, message, consequences = null, snapshot = null) {
  const festival = snapshot || (state && state.festival ? state.festival : {});
  return emitSecondaryEvent(state, config, {
    type: `festival.${phase}`,
    category: 'festival',
    message,
    actors: [
      buildSecondaryActor('institution', 'festival', 'primary', label),
      buildSettlementActor('beneficiary'),
    ],
    causes: [{
      kind: phase === 'started' ? 'action' : 'threshold',
      ref: 'festivals.lifecycle',
      metric: phase === 'started' ? 'source' : 'duration_ticks',
      value: phase === 'started'
        ? String(festival.source || 'settlement')
        : Math.max(0, Number(festival.durationTicks || 0)),
    }],
    consequences: consequences || [{
      kind: 'status',
      targetKind: 'institution',
      targetId: 'festival',
      metric: 'phase',
      value: phase,
      unit: null,
    }],
    source: 'festivals',
    tags: ['festival', phase],
  });
}

// Read a festival modifier value with a safe fallback.
function getFestivalModifier(state, key, fallback) {
  if (!state || !state.festival || !state.festival.active) {
    return fallback;
  }
  const effects = state.festival.effects;
  if (!effects || typeof effects !== 'object') {
    return fallback;
  }
  const value = Number(effects[key]);
  return Number.isFinite(value) ? value : fallback;
}

// Build a festival observation payload for AI/telemetry usage.
function getFestivalObservation(state, config) {
  const festivalsConfig = getFestivalsConfig(config);
  if (festivalsConfig.enabled === false) {
    return {
      active: false,
      timeLeft: 0,
      eligible: 0,
      costRatio: 0,
    };
  }
  const festival = state && state.festival ? state.festival : null;
  const active = Boolean(festival && festival.active);
  let timeLeftRatio = 0;
  if (active) {
    const duration = Math.max(1, Number(festival.durationTicks || 0));
    const elapsed = Math.max(0, Number(state.tick || 0) - Number(festival.startedTick || 0));
    const remaining = Math.max(0, duration - elapsed);
    timeLeftRatio = clamp(remaining / duration, 0, 1);
  }
  const eligibility = getFestivalEligibility(state, config, festivalsConfig);
  return {
    active,
    timeLeft: timeLeftRatio,
    eligible: eligibility.eligible ? 1 : 0,
    costRatio: clamp(Number(eligibility.costRatio || 0), 0, 1),
  };
}

// Build a festival status summary for telemetry.
function getFestivalStatus(state, config) {
  const festivalsConfig = getFestivalsConfig(config);
  if (festivalsConfig.enabled === false) {
    return null;
  }
  const festival = state && state.festival ? state.festival : null;
  const active = Boolean(festival && festival.active);
  const label = (festival && festival.label) || festivalsConfig.label || 'Festival';
  let ticksLeft = 0;
  let duration = 0;
  if (active) {
    duration = Math.max(0, Number(festival.durationTicks || 0));
    const elapsed = Math.max(0, Number(state.tick || 0) - Number(festival.startedTick || 0));
    ticksLeft = Math.max(0, duration - elapsed);
  }
  return {
    active,
    label,
    source: festival && festival.source ? String(festival.source) : null,
    ritualLabel: festival && festival.ritualLabel ? String(festival.ritualLabel) : null,
    ticksLeft,
    duration,
  };
}

module.exports = {
  ensureFestivalState,
  updateFestivals,
  getFestivalModifier,
  getFestivalObservation,
  getFestivalStatus,
};
