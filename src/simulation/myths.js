'use strict';

const { clamp } = require('../utils');
const {
  buildSecondaryActor,
  buildSettlementActor,
  emitSecondaryEvent,
} = require('./secondary_events');

// Build a new myths state object.
function createMythsState() {
  return {
    active: {},
    history: [],
    traditions: {},
    counters: {},
    lastTriggerTicks: {},
    lastProcessed: {},
  };
}

// Resolve the myths config block.
function getMythsConfig(config) {
  return (config && config.myths) || {};
}

// Ensure myths state exists and is normalized.
function ensureMythsState(state, config) {
  const mythsConfig = getMythsConfig(config);
  if (mythsConfig.enabled === false) {
    if (state) {
      state.myths = null;
    }
    return null;
  }
  if (!state.myths || typeof state.myths !== 'object') {
    state.myths = createMythsState();
  }
  const myths = state.myths;
  if (!myths.active || typeof myths.active !== 'object') {
    myths.active = {};
  }
  if (!Array.isArray(myths.history)) {
    myths.history = [];
  }
  if (!myths.traditions || typeof myths.traditions !== 'object') {
    myths.traditions = {};
  }
  if (!myths.counters || typeof myths.counters !== 'object') {
    myths.counters = {};
  }
  if (!myths.lastTriggerTicks || typeof myths.lastTriggerTicks !== 'object') {
    myths.lastTriggerTicks = {};
  }
  if (!myths.lastProcessed || typeof myths.lastProcessed !== 'object') {
    myths.lastProcessed = {};
  }
  return myths;
}

// Get a numeric season index for counters.
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

// Compute target stockpile amount for ratio checks.
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

// Compute a stockpile ratio for myth triggers.
function getStockpileRatio(state, config, resourceId) {
  const target = getStockpileTarget(state, config, resourceId);
  if (target <= 0) {
    return 1;
  }
  const current = Number(state.stockpile && state.stockpile[resourceId] || 0);
  return clamp(current / target, 0, 1);
}

// Ensure a myth counter object exists.
function getMythCounter(myths, mythId) {
  if (!myths.counters[mythId] || typeof myths.counters[mythId] !== 'object') {
    myths.counters[mythId] = {};
  }
  return myths.counters[mythId];
}

// Update a season-based window counter and return current count.
function updateSeasonWindow(counter, seasonIndex, windowSize, conditionMet) {
  if (!Number.isFinite(counter.lastSeasonIndex)) {
    counter.lastSeasonIndex = seasonIndex;
  }
  if (!Array.isArray(counter.seasons)) {
    counter.seasons = [];
  }
  if (seasonIndex !== counter.lastSeasonIndex) {
    if (counter.seasonHadCondition) {
      counter.seasons.push(counter.lastSeasonIndex);
    }
    counter.seasonHadCondition = false;
    counter.lastSeasonIndex = seasonIndex;
  }
  if (conditionMet) {
    counter.seasonHadCondition = true;
  }
  const limit = Math.max(1, Number(windowSize || 1));
  counter.seasons = counter.seasons.filter((entry) => seasonIndex - entry < limit);
  return counter.seasons.length;
}

// Compute per-effect severity for telemetry/AI summaries.
function getEffectsSeverity(effects) {
  if (!effects || typeof effects !== 'object') {
    return 0;
  }
  let total = 0;
  let count = 0;
  for (const value of Object.values(effects)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      continue;
    }
    total += Math.abs(1 - numeric);
    count += 1;
  }
  return count > 0 ? total / count : 0;
}

// Activate a myth and register history/events.
function activateMyth(state, config, myths, mythId, def, reason) {
  const now = Math.max(0, Number(state.tick || 0));
  const duration = Math.max(0, Number(def.durationTicks || 0));
  const label = def.label || mythId;
  const history = myths.history;
  const entry = {
    id: mythId,
    label,
    startedTick: now,
    endedTick: null,
    reason: reason || null,
  };
  history.push(entry);
  const historyLimit = Math.max(0, Number(getMythsConfig(config).historyLimit || 0));
  if (historyLimit > 0 && history.length > historyLimit) {
    myths.history = history.slice(history.length - historyLimit);
  }
  myths.active[mythId] = {
    id: mythId,
    startedTick: now,
    endsTick: duration > 0 ? now + duration : 0,
    historyIndex: myths.history.length - 1,
  };
  myths.lastTriggerTicks[mythId] = now;
  emitMythEvent(state, config, mythId, label, 'awakened', reason || 'trigger');
}

// Add or refresh a tradition entry.
function addTradition(state, config, myths, mythId, def) {
  const mythsConfig = getMythsConfig(config);
  if (mythsConfig.traditionsEnabled === false) {
    return;
  }
  if (!def.traditionEffects || typeof def.traditionEffects !== 'object') {
    return;
  }
  const now = Math.max(0, Number(state.tick || 0));
  const traditions = myths.traditions;
  if (traditions[mythId]) {
    traditions[mythId].acquiredTick = now;
    return;
  }
  const maxTraditions = Math.max(0, Number(mythsConfig.maxTraditions || 0));
  if (maxTraditions > 0 && Object.keys(traditions).length >= maxTraditions) {
    let oldestId = null;
    let oldestTick = Infinity;
    for (const [id, entry] of Object.entries(traditions)) {
      const tick = Number(entry.acquiredTick || 0);
      if (tick < oldestTick) {
        oldestTick = tick;
        oldestId = id;
      }
    }
    if (oldestId) {
      delete traditions[oldestId];
    }
  }
  traditions[mythId] = {
    id: mythId,
    acquiredTick: now,
  };
  emitMythEvent(state, config, mythId, def.label || mythId, 'tradition_formed', 'myth_completed');
}

// Expire active myths and apply traditions.
function expireMyths(state, config, myths, defs) {
  const now = Math.max(0, Number(state.tick || 0));
  for (const [mythId, entry] of Object.entries(myths.active)) {
    const endsTick = Math.max(0, Number(entry.endsTick || 0));
    if (endsTick <= 0) {
      continue;
    }
    if (now < endsTick) {
      continue;
    }
    const def = defs[mythId] || {};
    const label = def.label || mythId;
    const historyIndex = entry.historyIndex;
    if (Number.isFinite(historyIndex) && myths.history[historyIndex]) {
      myths.history[historyIndex].endedTick = now;
    }
    addTradition(state, config, myths, mythId, def);
    delete myths.active[mythId];
    emitMythEvent(state, config, mythId, label, 'faded', 'duration_elapsed');
  }
}

// Emit a structured myth or tradition transition after state and history commit.
function emitMythEvent(state, config, mythId, label, phase, reason) {
  const targetKind = phase === 'tradition_formed' ? 'institution' : 'system';
  return emitSecondaryEvent(state, config, {
    type: `myth.${phase}`,
    category: 'myth',
    message: phase === 'awakened'
      ? `Myth awakened: ${label}`
      : phase === 'faded'
        ? `Myth faded: ${label}`
        : `Tradition formed: ${label}`,
    actors: [
      buildSecondaryActor('institution', mythId, 'primary', label),
      buildSettlementActor('beneficiary'),
    ],
    causes: [{
      kind: phase === 'awakened' ? 'threshold' : 'state',
      ref: `myths.${reason}`,
      metric: 'phase',
      value: phase,
    }],
    consequences: [{
      kind: phase === 'tradition_formed' ? 'create' : 'status',
      targetKind,
      targetId: phase === 'tradition_formed' ? `tradition_${mythId}` : mythId,
      metric: phase === 'tradition_formed' ? null : 'phase',
      value: phase === 'tradition_formed' ? null : phase,
      unit: null,
    }],
    source: 'myths',
    tags: ['myth', mythId, phase],
  });
}

// Check activation cooldown and slot limits.
function canActivateMyth(myths, mythsConfig, mythId) {
  if (myths.active[mythId]) {
    return false;
  }
  const maxActive = Math.max(0, Number(mythsConfig.maxActive || 0));
  if (maxActive > 0 && Object.keys(myths.active).length >= maxActive) {
    return false;
  }
  const minGap = Math.max(0, Number(mythsConfig.minGapTicks || 0));
  if (minGap > 0) {
    const lastRaw = myths.lastTriggerTicks[mythId];
    const last = Number.isFinite(Number(lastRaw)) ? Number(lastRaw) : -Infinity;
    const now = Math.max(0, Number(myths.lastProcessed.tick || 0));
    if (Number.isFinite(last) && now - last < minGap) {
      return false;
    }
  }
  return true;
}

// Trigger: resource crisis over ticks and/or repeated seasons.
function checkResourceCrisis(state, config, myths, mythId, trigger) {
  const counter = getMythCounter(myths, mythId);
  const resources = Array.isArray(trigger.resources) ? trigger.resources : [];
  const ratioThreshold = clamp(Number(trigger.ratioThreshold ?? 0), 0, 1);
  const ticksRequired = Math.max(1, Number(trigger.ticksRequired || 1));
  let below = false;
  for (const resource of resources) {
    const ratio = getStockpileRatio(state, config, resource);
    if (ratio < ratioThreshold) {
      below = true;
      break;
    }
  }
  counter.lowTicks = below ? Number(counter.lowTicks || 0) + 1 : 0;
  const seasonIndex = getSeasonIndex(state);
  const seasonWindow = Math.max(1, Number(trigger.seasonWindow || 1));
  const seasonCount = Math.max(1, Number(trigger.seasonCount || 1));
  const seasonHits = updateSeasonWindow(counter, seasonIndex, seasonWindow, below);
  return counter.lowTicks >= ticksRequired || seasonHits >= seasonCount;
}

// Trigger: raid deaths in recent raids.
function checkRaidDeaths(state, myths, mythId, trigger) {
  const raidStats = state.raidStats || {};
  const lastRaidTick = Number(raidStats.lastRaidTick || 0);
  if (!Number.isFinite(lastRaidTick) || lastRaidTick <= 0) {
    return false;
  }
  const counter = getMythCounter(myths, mythId);
  const lastProcessed = Number(counter.lastRaidTick || 0);
  if (lastProcessed === lastRaidTick) {
    return false;
  }
  counter.lastRaidTick = lastRaidTick;
  const deathsThisRaid = Math.max(0, Number(raidStats.lastRaidDeaths || 0));
  const window = Math.max(1, Number(trigger.recentRaidWindow || 1));
  const threshold = Math.max(0, Number(trigger.deathsPerRaidThreshold || 0));
  const recentThreshold = Math.max(0, Number(trigger.recentRaidDeathsThreshold || 0));
  if (!Array.isArray(counter.recentRaidDeaths)) {
    counter.recentRaidDeaths = [];
  }
  counter.recentRaidDeaths.push(deathsThisRaid);
  while (counter.recentRaidDeaths.length > window) {
    counter.recentRaidDeaths.shift();
  }
  const totalRecent = counter.recentRaidDeaths.reduce((sum, value) => sum + Number(value || 0), 0);
  return deathsThisRaid >= threshold || totalRecent >= recentThreshold;
}

// Trigger: ruins success streak or artifact found.
function checkRuinsSuccess(state, myths, mythId, trigger) {
  const ruins = state.ruins;
  if (!ruins || !ruins.stats) {
    return false;
  }
  const stats = ruins.stats;
  const lastOutcomeTick = Number(stats.lastOutcomeTick || 0);
  if (!Number.isFinite(lastOutcomeTick) || lastOutcomeTick <= 0) {
    return false;
  }
  const counter = getMythCounter(myths, mythId);
  if (Number(counter.lastOutcomeTick || 0) === lastOutcomeTick) {
    return false;
  }
  counter.lastOutcomeTick = lastOutcomeTick;
  const successes = Math.max(0, Number(stats.lastSuccesses || 0));
  const failures = Math.max(0, Number(stats.lastFailures || 0));
  if (failures > 0) {
    counter.successStreak = 0;
  } else if (successes > 0) {
    counter.successStreak = Number(counter.successStreak || 0) + successes;
  }
  const artifactImmediate = trigger.artifactImmediate !== false;
  const artifactsFound = Math.max(0, Number(stats.lastArtifactsFound || 0));
  if (artifactImmediate && artifactsFound > 0) {
    return true;
  }
  const streakRequired = Math.max(1, Number(trigger.successStreak || 1));
  return counter.successStreak >= streakRequired;
}

// Trigger: drought seasons or low water streak.
function checkDroughtWater(state, config, myths, mythId, trigger) {
  const counter = getMythCounter(myths, mythId);
  const ratioThreshold = clamp(Number(trigger.waterRatioThreshold ?? 0), 0, 1);
  const ticksRequired = Math.max(1, Number(trigger.ticksRequired || 1));
  const waterRatio = getStockpileRatio(state, config, 'water');
  const lowWater = waterRatio < ratioThreshold;
  counter.lowWaterTicks = lowWater ? Number(counter.lowWaterTicks || 0) + 1 : 0;
  const seasonIndex = getSeasonIndex(state);
  const seasonWindow = Math.max(1, Number(trigger.seasonWindow || 1));
  const droughtCount = Math.max(1, Number(trigger.droughtCount || 1));
  const isDrought = state.weather && state.weather.type === 'drought';
  const droughtHits = updateSeasonWindow(counter, seasonIndex, seasonWindow, isDrought);
  return counter.lowWaterTicks >= ticksRequired || droughtHits >= droughtCount;
}

// Update myths each tick (expire, trigger, activate).
function updateMyths(state, config) {
  const mythsConfig = getMythsConfig(config);
  if (mythsConfig.enabled === false) {
    if (state) {
      state.myths = null;
    }
    return;
  }
  if (!state) {
    return;
  }
  const myths = ensureMythsState(state, config);
  if (!myths) {
    return;
  }
  const defs = mythsConfig.definitions || {};
  myths.lastProcessed.tick = Math.max(0, Number(state.tick || 0));

  expireMyths(state, config, myths, defs);

  for (const [mythId, def] of Object.entries(defs)) {
    const trigger = def.trigger || def.triggers || {};
    if (!trigger || typeof trigger !== 'object') {
      continue;
    }
    let triggered = false;
    const type = String(trigger.type || '');
    if (type === 'resource_crisis') {
      triggered = checkResourceCrisis(state, config, myths, mythId, trigger);
    } else if (type === 'raid_deaths') {
      triggered = checkRaidDeaths(state, myths, mythId, trigger);
    } else if (type === 'ruins_success') {
      triggered = checkRuinsSuccess(state, myths, mythId, trigger);
    } else if (type === 'drought_or_water_crisis') {
      triggered = checkDroughtWater(state, config, myths, mythId, trigger);
    }
    if (!triggered) {
      continue;
    }
    if (!canActivateMyth(myths, mythsConfig, mythId)) {
      continue;
    }
    activateMyth(state, config, myths, mythId, def, type || null);
  }
}

// Compute a multiplier from active myths and traditions.
function getMythMultiplier(state, config, key, fallback) {
  const safeFallback = Number(fallback || 1);
  const mythsConfig = getMythsConfig(config);
  if (!state || !state.myths || mythsConfig.enabled === false) {
    return safeFallback;
  }
  const defs = mythsConfig.definitions || {};
  let multiplier = safeFallback;
  for (const mythId of Object.keys(state.myths.active || {})) {
    const def = defs[mythId];
    const effects = def && def.effects;
    const value = effects && effects[key];
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      multiplier *= numeric;
    }
  }
  for (const mythId of Object.keys(state.myths.traditions || {})) {
    const def = defs[mythId];
    const effects = def && def.traditionEffects;
    const value = effects && effects[key];
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      multiplier *= numeric;
    }
  }
  return multiplier;
}

// Carry traditions and history across endgame cycle resets.
function carryMythsAcrossCycle(previous, next, config) {
  const mythsConfig = getMythsConfig(config);
  if (mythsConfig.enabled === false) {
    return;
  }
  if (!previous || !previous.myths) {
    return;
  }
  if (!next || !next.myths) {
    next.myths = createMythsState();
  }
  const prevMyths = previous.myths;
  next.myths.active = {};
  next.myths.counters = {};
  next.myths.lastTriggerTicks = {};
  next.myths.lastProcessed = {};
  next.myths.traditions = { ...(prevMyths.traditions || {}) };
  const historyLimit = Math.max(0, Number(mythsConfig.historyLimit || 0));
  if (historyLimit > 0) {
    next.myths.history = (prevMyths.history || []).slice(-historyLimit);
  } else {
    next.myths.history = (prevMyths.history || []).slice();
  }
}

module.exports = {
  createMythsState,
  updateMyths,
  getMythMultiplier,
  getEffectsSeverity,
  carryMythsAcrossCycle,
};
