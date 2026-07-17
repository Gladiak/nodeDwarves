'use strict';

const { clamp } = require('../utils');
const {
  buildResourceConsequences,
  buildSecondaryActor,
  emitSecondaryEvent,
} = require('./secondary_events');
const { randomBetween } = require('./random');

const WORLD_EVENT_TYPES = ['traveling_bards', 'rival_caravans', 'limited_opportunities'];

// Resolve world events config safely.
function getWorldEventsConfig(config) {
  return (config && config.worldEvents) || {};
}

// Ensure world events runtime state exists and is normalized.
function ensureWorldEventsState(state, config) {
  const worldConfig = getWorldEventsConfig(config);
  if (!state || worldConfig.enabled === false) {
    if (state) {
      state.worldEvents = null;
    }
    return null;
  }

  if (!state.worldEvents || typeof state.worldEvents !== 'object') {
    state.worldEvents = createWorldEventsState(worldConfig, state.tick);
  }

  const worldState = state.worldEvents;
  if (!Number.isFinite(worldState.nextSpawnTick)) {
    worldState.nextSpawnTick = scheduleNextWorldEventTick(worldState, worldConfig, state.tick);
  }
  if (!Number.isFinite(worldState.cooldownUntilTick)) {
    worldState.cooldownUntilTick = 0;
  }
  if (!Number.isFinite(worldState.counter) || worldState.counter < 1) {
    worldState.counter = 1;
  }
  if (!Array.isArray(worldState.history)) {
    worldState.history = [];
  }
  if (!worldState.cooldownByType || typeof worldState.cooldownByType !== 'object') {
    worldState.cooldownByType = {};
  }
  for (const type of WORLD_EVENT_TYPES) {
    if (!Number.isFinite(worldState.cooldownByType[type])) {
      worldState.cooldownByType[type] = 0;
    }
  }
  worldState.stats = normalizeWorldEventStats(worldState.stats);

  return worldState;
}

// Create a fresh world events state object.
function createWorldEventsState(worldConfig, currentTick) {
  const cooldownByType = {};
  for (const type of WORLD_EVENT_TYPES) {
    cooldownByType[type] = 0;
  }
  return {
    active: null,
    nextSpawnTick: scheduleNextWorldEventTick(null, worldConfig, currentTick),
    cooldownUntilTick: 0,
    cooldownByType,
    counter: 1,
    history: [],
    stats: normalizeWorldEventStats(null),
  };
}

// Normalize world event stats shape.
function normalizeWorldEventStats(rawStats) {
  const stats = rawStats && typeof rawStats === 'object' ? rawStats : {};
  const byType = stats.byType && typeof stats.byType === 'object' ? stats.byType : {};
  for (const type of WORLD_EVENT_TYPES) {
    if (!byType[type] || typeof byType[type] !== 'object') {
      byType[type] = {};
    }
    byType[type].spawned = Math.max(0, Number(byType[type].spawned || 0));
    byType[type].completed = Math.max(0, Number(byType[type].completed || 0));
    byType[type].failed = Math.max(0, Number(byType[type].failed || 0));
    byType[type].expired = Math.max(0, Number(byType[type].expired || 0));
  }

  return {
    spawned: Math.max(0, Number(stats.spawned || 0)),
    completed: Math.max(0, Number(stats.completed || 0)),
    failed: Math.max(0, Number(stats.failed || 0)),
    expired: Math.max(0, Number(stats.expired || 0)),
    byType,
  };
}

// Schedule the next world event spawn tick.
function scheduleNextWorldEventTick(worldState, worldConfig, currentTick) {
  const tick = Math.max(0, Number(currentTick || 0));
  const spawnRange = getSpawnRange(worldConfig);
  return tick + randomBetween(spawnRange.min, spawnRange.max);
}

// Resolve configured spawn range.
function getSpawnRange(worldConfig) {
  const range = worldConfig.spawnRangeTicks || {};
  const min = Math.max(0, Number(range.min ?? 0));
  const max = Math.max(min, Number(range.max ?? min));
  return { min, max };
}

// Update the world events lifecycle each tick.
function updateWorldEvents(state, config, runtime, action) {
  const worldConfig = getWorldEventsConfig(config);
  const worldState = ensureWorldEventsState(state, config);
  if (!worldState) {
    return;
  }

  const tick = Math.max(0, Number(state.tick || 0));
  if (worldState.active) {
    updateActiveWorldEvent(state, config, worldState, worldConfig, tick, action);
    return;
  }

  const minTick = Math.max(0, Number(worldConfig.minTick || 0));
  if (tick < minTick) {
    return;
  }
  if (worldConfig.blockDuringRaid === true && state.raid && state.raid.active) {
    return;
  }
  if (tick < Number(worldState.cooldownUntilTick || 0)) {
    return;
  }
  if (tick < Number(worldState.nextSpawnTick || 0)) {
    return;
  }

  const spawned = spawnNextWorldEvent(state, config, worldState, worldConfig, tick, action);
  if (!spawned) {
    worldState.nextSpawnTick = scheduleNextWorldEventTick(worldState, worldConfig, tick);
  }
}

// Resolve active world event lifecycle and completion.
function updateActiveWorldEvent(state, config, worldState, worldConfig, tick, action) {
  const active = worldState.active;
  if (!active) {
    return;
  }

  if (active.type === 'limited_opportunities' && active.phase === 'offer') {
    if (
      canFulfillRequest(state.stockpile, active.request)
      && shouldCompleteLimitedOpportunity(config, active, tick, action)
    ) {
      completeLimitedOpportunity(state, config, worldState, worldConfig, active, tick);
      return;
    }
    if (tick >= Number(active.expiresAt || 0)) {
      failLimitedOpportunity(state, config, worldState, worldConfig, active, tick);
    }
    return;
  }

  if (tick >= Number(active.expiresAt || 0)) {
    completeTimedWorldEvent(state, config, worldState, worldConfig, active, tick);
  }
}

// Attempt to spawn one world event based on weighted candidates.
function spawnNextWorldEvent(state, config, worldState, worldConfig, tick, action) {
  const candidates = WORLD_EVENT_TYPES
    .map((type) => ({ type, weight: getWorldEventWeight(worldConfig, type), def: worldConfig[type] || {} }))
    .filter((entry) => entry.weight > 0 && entry.def.enabled !== false)
    .filter((entry) => tick >= Number(worldState.cooldownByType[entry.type] || 0));

  if (candidates.length === 0) {
    return false;
  }

  let picked = pickWeightedEntry(candidates);
  while (picked) {
    const active = buildWorldEvent(state, config, worldState, worldConfig, picked.type, tick, action);
    if (active) {
      worldState.active = active;
      worldState.nextSpawnTick = scheduleNextWorldEventTick(worldState, worldConfig, tick);
      incrementWorldEventStat(worldState, active.type, 'spawned');
      emitWorldEventFact(state, config, active, 'started', buildWorldEventStartMessage(active));
      return true;
    }

    const index = candidates.findIndex((entry) => entry.type === picked.type);
    if (index >= 0) {
      candidates.splice(index, 1);
    }
    picked = pickWeightedEntry(candidates);
  }

  return false;
}

// Read world event weight with safe defaults.
function getWorldEventWeight(worldConfig, type) {
  const def = worldConfig[type] || {};
  const weight = Number(def.weight ?? 0);
  if (!Number.isFinite(weight) || weight <= 0) {
    return 0;
  }
  return weight;
}

// Pick one weighted entry or null when list is empty.
function pickWeightedEntry(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }
  const total = entries.reduce((sum, entry) => sum + Math.max(0, Number(entry.weight || 0)), 0);
  if (total <= 0) {
    return entries[0];
  }
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= Math.max(0, Number(entry.weight || 0));
    if (roll <= 0) {
      return entry;
    }
  }
  return entries[entries.length - 1];
}

// Build a world event instance by type.
function buildWorldEvent(state, config, worldState, worldConfig, type, tick, action) {
  if (type === 'traveling_bards') {
    return buildTravelingBardsEvent(state, config, worldState, worldConfig, tick);
  }
  if (type === 'rival_caravans') {
    return buildRivalCaravansEvent(state, config, worldState, worldConfig, tick, action);
  }
  if (type === 'limited_opportunities') {
    return buildLimitedOpportunityEvent(state, config, worldState, worldConfig, tick);
  }
  return null;
}

// Build the traveling bards event and apply upfront costs.
function buildTravelingBardsEvent(state, config, worldState, worldConfig, tick) {
  const def = worldConfig.traveling_bards || {};
  const population = Array.isArray(state.dwarves) ? state.dwarves.length : 0;
  const minPopulation = Math.max(0, Number(def.minPopulation || 0));
  if (population < minPopulation) {
    return null;
  }
  if (!passesStockpileRatios(state, config, def.minStockpileRatios)) {
    return null;
  }
  const costs = resolveScaledMap(def.costs, def.minCostRatio, true);
  if (!hasInputs(state.stockpile, costs)) {
    return null;
  }
  consumeInputs(state.stockpile, costs);

  const duration = Math.max(1, Number(def.durationTicks || 0));
  return {
    id: buildWorldEventId(worldState),
    type: 'traveling_bards',
    label: String(def.label || 'Traveling Bards'),
    phase: 'active',
    startedTick: tick,
    expiresAt: tick + duration,
    durationTicks: duration,
    effects: normalizeMultiplierMap(def.effects),
    targetBoosts: {},
    request: {},
    reward: {},
    meta: {
      costs,
    },
  };
}

// Build the rival caravans event and resolve contest outcome immediately.
function buildRivalCaravansEvent(state, config, worldState, worldConfig, tick, action) {
  const def = worldConfig.rival_caravans || {};
  const duration = Math.max(1, Number(def.durationTicks || 0));
  let outcome = 'lose';
  let effects = normalizeMultiplierMap(def.effectsLose);
  let paidContest = false;
  const contestCosts = resolveScaledMap(def.contestCosts, def.contestMinCostRatio, true);
  const contestIntent = getTradeIntent(action, config, 'contestIntent', 1);
  const contestIntentThreshold = clamp(
    Number(getTradeGovernorConfig(config).contestIntentThreshold ?? 0),
    0,
    1,
  );

  if (def.contestEnabled !== false) {
    const contestOk = passesStockpileRatios(state, config, def.contestMinStockpileRatios)
      && hasInputs(state.stockpile, contestCosts);
    if (contestOk && contestIntent >= contestIntentThreshold) {
      consumeInputs(state.stockpile, contestCosts);
      paidContest = true;
      outcome = 'win';
      effects = normalizeMultiplierMap(def.effectsWin);
    }
  } else {
    outcome = 'win';
    effects = normalizeMultiplierMap(def.effectsWin);
  }

  return {
    id: buildWorldEventId(worldState),
    type: 'rival_caravans',
    label: String(def.label || 'Rival Caravans'),
    phase: 'active',
    startedTick: tick,
    expiresAt: tick + duration,
    durationTicks: duration,
    effects,
    targetBoosts: {},
    request: {},
    reward: {},
    meta: {
      outcome,
      paidContest,
      contestIntent,
      contestIntentThreshold,
      contestCosts: paidContest ? contestCosts : {},
    },
  };
}

// Build a time-limited opportunity offer.
function buildLimitedOpportunityEvent(state, config, worldState, worldConfig, tick) {
  const def = worldConfig.limited_opportunities || {};
  const templates = Array.isArray(def.templates) ? def.templates : [];
  const candidates = templates
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({ ...entry, weight: Math.max(0, Number(entry.weight ?? 1)) }))
    .filter((entry) => entry.weight > 0);
  if (candidates.length === 0) {
    return null;
  }
  const chosen = pickWeightedEntry(candidates);
  if (!chosen) {
    return null;
  }

  const expiryTicks = Math.max(1, Number(def.expiryTicks || 0));
  const request = normalizeAmountMap(chosen.request);
  const reward = normalizeAmountMap(chosen.reward);
  const targetBoosts = normalizeTargetBoostMap(chosen.targetBoosts);
  if (Object.keys(request).length === 0 || Object.keys(reward).length === 0) {
    return null;
  }

  return {
    id: buildWorldEventId(worldState),
    type: 'limited_opportunities',
    label: String(chosen.label || def.label || 'Time-limited Opportunity'),
    phase: 'offer',
    startedTick: tick,
    expiresAt: tick + expiryTicks,
    durationTicks: expiryTicks,
    effects: {},
    targetBoosts,
    request,
    reward,
    meta: {
      templateId: chosen.id || null,
    },
  };
}

// Decide whether an opportunity should be completed this tick.
function shouldCompleteLimitedOpportunity(config, active, tick, action) {
  const tradeConfig = getTradeGovernorConfig(config);
  const forceTicks = Math.max(0, Math.floor(Number(tradeConfig.opportunityForceCompleteTicks || 0)));
  const ticksLeft = Math.max(0, Number(active.expiresAt || 0) - Number(tick || 0));
  if (ticksLeft <= forceTicks) {
    return true;
  }
  const intent = getTradeIntent(action, config, 'opportunityIntent', 1);
  const threshold = clamp(Number(tradeConfig.opportunityIntentThreshold ?? 0), 0, 1);
  return intent >= threshold;
}

// Read trade-governor config safely.
function getTradeGovernorConfig(config) {
  const aiConfig = (config && config.ai) || {};
  const governors = aiConfig.governors && typeof aiConfig.governors === 'object'
    ? aiConfig.governors
    : {};
  const trade = governors.trade;
  if (!trade || typeof trade !== 'object') {
    return {};
  }
  return trade;
}

// Resolve trade governor action payload safely.
function getTradeAction(action) {
  if (!action || typeof action !== 'object') {
    return null;
  }
  const trade = action.trade;
  if (!trade || typeof trade !== 'object' || Array.isArray(trade)) {
    return null;
  }
  return trade;
}

// Normalize a trade intent signal to 0..1 using AI action scaling.
function normalizeTradeIntent(value, config, fallback) {
  const aiConfig = (config && config.ai) || {};
  const minWeight = Number(aiConfig.minWeight ?? 0);
  const maxWeight = Number(aiConfig.maxWeight ?? 1);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return clamp(Number(fallback || 0), 0, 1);
  }
  if (maxWeight > minWeight) {
    return clamp((numeric - minWeight) / (maxWeight - minWeight), 0, 1);
  }
  return clamp(numeric, 0, 1);
}

// Read one trade intent field with fallback.
function getTradeIntent(action, config, key, fallback) {
  const tradeConfig = getTradeGovernorConfig(config);
  if (tradeConfig.enabled === false) {
    return clamp(Number(fallback || 0), 0, 1);
  }
  const tradeAction = getTradeAction(action);
  if (!tradeAction || !Object.prototype.hasOwnProperty.call(tradeAction, key)) {
    return clamp(Number(fallback || 0), 0, 1);
  }
  return normalizeTradeIntent(tradeAction[key], config, fallback);
}

// Build a unique event id and advance the world event counter.
function buildWorldEventId(worldState) {
  const next = Math.max(1, Number(worldState.counter || 1));
  worldState.counter = next + 1;
  return `we_${next}`;
}

// Complete a timed event and apply cooldown bookkeeping.
function completeTimedWorldEvent(state, config, worldState, worldConfig, active, tick) {
  finalizeWorldEvent(state, config, worldState, worldConfig, active, tick, 'completed', null);
}

// Complete an opportunity request and grant rewards.
function completeLimitedOpportunity(state, config, worldState, worldConfig, active, tick) {
  consumeInputs(state.stockpile, active.request);
  for (const [resource, amount] of Object.entries(active.reward || {})) {
    state.stockpile[resource] = Number(state.stockpile[resource] || 0) + Number(amount || 0);
  }
  const rewardSummary = formatAmountSummary(active.reward, 3);
  emitWorldEventFact(
    state,
    config,
    active,
    'completed',
    rewardSummary ? `Opportunity completed: ${rewardSummary}` : 'Opportunity completed',
    buildResourceConsequences(active.reward),
  );
  finalizeWorldEvent(state, config, worldState, worldConfig, active, tick, 'completed', null);
}

// Fail an expired opportunity and apply stockpile loss penalty.
function failLimitedOpportunity(state, config, worldState, worldConfig, active, tick) {
  const def = worldConfig.limited_opportunities || {};
  const ratio = clamp(Number(def.failureLossRatio || 0), 0, 1);
  const resources = Array.isArray(def.failureLossResources)
    ? def.failureLossResources.filter((value) => typeof value === 'string')
    : [];
  const losses = [];
  const lossAmounts = {};
  for (const resource of resources) {
    const current = Math.max(0, Number(state.stockpile[resource] || 0));
    if (current <= 0 || ratio <= 0) {
      continue;
    }
    const loss = Math.max(0, Math.floor(current * ratio));
    if (loss <= 0) {
      continue;
    }
    state.stockpile[resource] = current - loss;
    losses.push(`${resource} x${loss}`);
    lossAmounts[resource] = loss;
  }
  emitWorldEventFact(
    state,
    config,
    active,
    'expired',
    losses.length > 0
      ? `Opportunity expired: losses ${losses.slice(0, 3).join(', ')}`
      : 'Opportunity expired',
    buildResourceConsequences(lossAmounts, -1),
  );
  finalizeWorldEvent(state, config, worldState, worldConfig, active, tick, 'failed', 'expired');
}

// Finalize an active world event and update stats/history/cooldowns.
function finalizeWorldEvent(state, config, worldState, worldConfig, active, tick, result, reason) {
  if (!active) {
    return;
  }

  if (active.type !== 'limited_opportunities') {
    emitWorldEventFact(state, config, active, 'ended', buildWorldEventEndMessage(active));
  }
  if (active.type === 'rival_caravans') {
    const outcome = active.meta && active.meta.outcome ? active.meta.outcome : 'lose';
    emitWorldEventFact(
      state,
      config,
      active,
      `contest_${outcome}`,
      outcome === 'win'
        ? 'Rival caravans: contest won'
        : 'Rival caravans: contest lost',
    );
  }

  incrementWorldEventStat(worldState, active.type, result === 'completed' ? 'completed' : 'failed');
  if (reason === 'expired') {
    incrementWorldEventStat(worldState, active.type, 'expired');
  }

  const historyEntry = {
    id: active.id,
    type: active.type,
    label: active.label,
    startedTick: Number(active.startedTick || 0),
    endedTick: tick,
    result,
    reason: reason || null,
  };
  worldState.history.push(historyEntry);
  trimWorldEventHistory(worldState, worldConfig);

  const cooldownTicks = Math.max(
    0,
    Number((worldConfig[active.type] && worldConfig[active.type].cooldownTicks) || 0),
  );
  worldState.cooldownByType[active.type] = tick + cooldownTicks;
  const globalCooldown = Math.max(0, Number(worldConfig.globalCooldownTicks || 0));
  worldState.cooldownUntilTick = Math.max(worldState.cooldownUntilTick || 0, tick + globalCooldown);
  worldState.active = null;
}

// Emit a structured world-event lifecycle fact from committed active state.
function emitWorldEventFact(state, config, active, phase, message, consequences = null) {
  const eventId = String(active && active.id || 'world_event');
  const eventType = String(active && active.type || 'unknown');
  return emitSecondaryEvent(state, config, {
    type: `world.${eventType}_${phase}`,
    category: 'world',
    message,
    actors: [buildSecondaryActor(
      eventType === 'rival_caravans' ? 'caravan' : 'institution',
      eventId,
      'primary',
      active && active.label,
    )],
    causes: [{
      kind: phase === 'started' ? 'state' : 'threshold',
      ref: `world_events.${eventType}`,
      metric: 'phase',
      value: phase,
    }],
    consequences: Array.isArray(consequences) && consequences.length > 0
      ? consequences
      : [{
        kind: 'status',
        targetKind: eventType === 'rival_caravans' ? 'caravan' : 'institution',
        targetId: eventId,
        metric: 'phase',
        value: phase,
        unit: null,
      }],
    source: 'world_events',
    tags: ['world_event', eventType, phase],
  });
}

// Increment world event stats counters.
function incrementWorldEventStat(worldState, type, key) {
  worldState.stats = normalizeWorldEventStats(worldState.stats);
  worldState.stats[key] = Number(worldState.stats[key] || 0) + 1;
  if (worldState.stats.byType[type]) {
    worldState.stats.byType[type][key] = Number(worldState.stats.byType[type][key] || 0) + 1;
  }
}

// Trim history entries to configured limit.
function trimWorldEventHistory(worldState, worldConfig) {
  const limit = Math.max(0, Number(worldConfig.historyLimit || 0));
  if (limit <= 0) {
    return;
  }
  if (worldState.history.length > limit) {
    worldState.history = worldState.history.slice(worldState.history.length - limit);
  }
}

// Check stockpile ratio guardrails.
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

// Resolve stockpile target with optional per-capita scaling.
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

// Resolve a scaled integer amount map.
function resolveScaledMap(rawMap, ratio, roundToInt) {
  const normalized = {};
  if (!rawMap || typeof rawMap !== 'object') {
    return normalized;
  }
  const scale = Math.max(1, Number(ratio || 1));
  for (const [resource, amountRaw] of Object.entries(rawMap)) {
    const amount = Number(amountRaw || 0) * scale;
    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }
    const value = roundToInt ? Math.max(1, Math.round(amount)) : amount;
    normalized[resource] = value;
  }
  return normalized;
}

// Normalize a positive amount map.
function normalizeAmountMap(rawMap) {
  const normalized = {};
  if (!rawMap || typeof rawMap !== 'object') {
    return normalized;
  }
  for (const [resource, amountRaw] of Object.entries(rawMap)) {
    const amount = Math.max(0, Number(amountRaw || 0));
    if (amount <= 0) {
      continue;
    }
    normalized[resource] = Math.max(1, Math.round(amount));
  }
  return normalized;
}

// Normalize a multiplier map used for active effects.
function normalizeMultiplierMap(rawMap) {
  const normalized = {};
  if (!rawMap || typeof rawMap !== 'object') {
    return normalized;
  }
  for (const [key, valueRaw] of Object.entries(rawMap)) {
    const value = Number(valueRaw);
    if (!Number.isFinite(value) || value <= 0) {
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
}

// Normalize target boost values.
function normalizeTargetBoostMap(rawMap) {
  const normalized = {};
  if (!rawMap || typeof rawMap !== 'object') {
    return normalized;
  }
  for (const [resource, valueRaw] of Object.entries(rawMap)) {
    const value = Number(valueRaw);
    if (!Number.isFinite(value) || value <= 0) {
      continue;
    }
    normalized[resource] = value;
  }
  return normalized;
}

// Check whether stockpile satisfies all requested amounts.
function canFulfillRequest(stockpile, request) {
  if (!stockpile || !request) {
    return false;
  }
  for (const [resource, amount] of Object.entries(request)) {
    if (Number(stockpile[resource] || 0) < Number(amount || 0)) {
      return false;
    }
  }
  return true;
}

// Check if stockpile has enough for configured inputs.
function hasInputs(stockpile, inputs) {
  if (!stockpile || !inputs) {
    return false;
  }
  for (const [resource, amount] of Object.entries(inputs)) {
    if (Number(stockpile[resource] || 0) < Number(amount || 0)) {
      return false;
    }
  }
  return true;
}

// Consume inputs from stockpile.
function consumeInputs(stockpile, inputs) {
  if (!stockpile || !inputs) {
    return;
  }
  for (const [resource, amount] of Object.entries(inputs)) {
    stockpile[resource] = Number(stockpile[resource] || 0) - Number(amount || 0);
  }
}

// Format a compact amount summary.
function formatAmountSummary(amounts, maxEntries) {
  if (!amounts || typeof amounts !== 'object') {
    return '';
  }
  const entries = Object.entries(amounts)
    .filter(([, amount]) => Number(amount || 0) > 0)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));
  if (entries.length === 0) {
    return '';
  }
  const limit = Math.max(1, Number(maxEntries || 1));
  return entries
    .slice(0, limit)
    .map(([resource, amount]) => `${resource} x${Math.max(0, Math.round(Number(amount || 0)))}`)
    .join(', ');
}

// Build start event text for the world event log.
function buildWorldEventStartMessage(active) {
  if (!active) {
    return 'World event started';
  }
  if (active.type === 'limited_opportunities') {
    const request = formatAmountSummary(active.request, 2);
    if (request) {
      return `World event: ${active.label} (deliver ${request})`;
    }
  }
  return `World event started: ${active.label}`;
}

// Build end event text for active timed events.
function buildWorldEventEndMessage(active) {
  if (!active) {
    return 'World event ended';
  }
  return `World event ended: ${active.label}`;
}

// Resolve a world event multiplier by key.
function getWorldEventModifier(state, key, fallback) {
  const worldState = state && state.worldEvents ? state.worldEvents : null;
  const active = worldState && worldState.active ? worldState.active : null;
  if (!active || active.phase !== 'active' || !key) {
    return fallback;
  }
  const effects = active.effects || {};
  const value = Number(effects[key]);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

// Resolve target boost from the active opportunity offer.
function getWorldEventTargetBoost(state, resourceId) {
  const worldState = state && state.worldEvents ? state.worldEvents : null;
  const active = worldState && worldState.active ? worldState.active : null;
  if (!active || !resourceId || !active.targetBoosts) {
    return 1;
  }
  const boost = Number(active.targetBoosts[resourceId] || 1);
  if (!Number.isFinite(boost) || boost <= 0) {
    return 1;
  }
  return boost;
}

// Build a compact world events observation payload.
function getWorldEventObservation(state, config) {
  const worldConfig = getWorldEventsConfig(config);
  if (worldConfig.enabled === false) {
    return {
      active: false,
      timeLeft: 0,
      phase: 'idle',
      offerReady: 0,
    };
  }
  const worldState = state && state.worldEvents ? state.worldEvents : null;
  const active = worldState && worldState.active ? worldState.active : null;
  if (!active) {
    return {
      active: false,
      timeLeft: 0,
      phase: 'idle',
      offerReady: 0,
    };
  }

  const duration = Math.max(1, Number(active.durationTicks || 0));
  const ticksLeft = Math.max(0, Number(active.expiresAt || 0) - Number(state.tick || 0));
  const offerReady = active.phase === 'offer' && canFulfillRequest(state.stockpile, active.request) ? 1 : 0;
  return {
    active: true,
    type: active.type || null,
    phase: active.phase || 'active',
    timeLeft: clamp(ticksLeft / duration, 0, 1),
    offerReady,
  };
}

// Build world event telemetry status details.
function getWorldEventStatus(state, config) {
  const worldConfig = getWorldEventsConfig(config);
  if (worldConfig.enabled === false) {
    return null;
  }
  const worldState = state && state.worldEvents ? state.worldEvents : null;
  const active = worldState && worldState.active ? worldState.active : null;
  if (!active) {
    return {
      active: false,
      label: null,
      phase: 'idle',
      ticksLeft: 0,
      requestSummary: '',
      outcome: null,
    };
  }
  const ticksLeft = Math.max(0, Number(active.expiresAt || 0) - Number(state.tick || 0));
  const requestSummary = active.phase === 'offer' ? formatAmountSummary(active.request, 2) : '';
  const outcome = active.meta && active.meta.outcome ? String(active.meta.outcome) : null;
  return {
    active: true,
    label: active.label || active.type || 'Event',
    phase: active.phase || 'active',
    ticksLeft,
    requestSummary,
    outcome,
  };
}

module.exports = {
  ensureWorldEventsState,
  updateWorldEvents,
  getWorldEventModifier,
  getWorldEventTargetBoost,
  getWorldEventObservation,
  getWorldEventStatus,
};
