'use strict';

const { clamp } = require('../utils');
const { randomBetween } = require('./random');
const { pushEvent } = require('./events');
const { moveTowards, findEdgeSpawnPosition, getAdjacentPositions } = require('./movement');
const { getStockpileTarget } = require('./resources');
const { isBuildableCell, findVillageBuildSpot } = require('./structures');

const MERCHANT_SIDES = ['north', 'south', 'west', 'east'];

// Update merchant state machine per tick.
function updateMerchant(state, config, runtime) {
  const merchantConfig = config.merchant || {};
  if (merchantConfig.enabled === false) {
    return;
  }
  if (!runtime || runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return;
  }

  const merchantStats = ensureMerchantStats(state);
  merchantStats.ticks = Number(merchantStats.ticks || 0) + 1;

  const merchant = ensureMerchantState(state, merchantConfig);
  if (merchant.phase === 'idle') {
    if (state.tick < merchant.nextSpawnTick) {
      return;
    }
    spawnMerchant(state, config, runtime, merchant);
    return;
  }

  if (merchant.phase === 'entering') {
    if (!merchant.target) {
      merchant.target = findMerchantStopSpot(state, runtime) || { x: merchant.x, y: merchant.y };
    }
    if (merchant.x === merchant.target.x && merchant.y === merchant.target.y) {
      merchant.phase = 'trading';
    } else {
      moveTowards(merchant, merchant.target, runtime, state, config);
      if (merchant.x === merchant.target.x && merchant.y === merchant.target.y) {
        merchant.phase = 'trading';
      }
    }
    return;
  }

  if (merchant.phase === 'trading') {
    if (Number(merchant.tradesRemaining || 0) > 0) {
      attemptMerchantTrade(state, config, merchant);
    }
    merchant.stayTicks = Math.max(0, Number(merchant.stayTicks || 0) - 1);
    if (merchant.stayTicks <= 0 || Number(merchant.tradesRemaining || 0) <= 0) {
      startMerchantExit(state, runtime, merchant);
    }
    return;
  }

  if (merchant.phase === 'exiting') {
    if (!merchant.exitTarget) {
      const fallbackSide = merchant.exitSide || pickMerchantSide();
      merchant.exitTarget = findEdgeSpawnPosition(state, runtime, fallbackSide);
    }
    if (merchant.x === merchant.exitTarget.x && merchant.y === merchant.exitTarget.y) {
      finalizeMerchantVisit(state, config, merchant);
      return;
    }
    moveTowards(merchant, merchant.exitTarget, runtime, state, config);
  }
}

// Ensure merchant state exists and has valid fields.
function ensureMerchantState(state, merchantConfig) {
  if (!state.merchant || typeof state.merchant !== 'object') {
    state.merchant = buildMerchantState(merchantConfig, state.tick);
  }

  const merchant = state.merchant;
  if (!merchant.phase) {
    merchant.phase = 'idle';
  }
  if (!Number.isFinite(merchant.nextSpawnTick)) {
    merchant.nextSpawnTick = scheduleNextMerchantSpawnTick(state.tick, merchantConfig);
  }
  return merchant;
}

// Ensure merchant stats exist and are normalized.
function ensureMerchantStats(state) {
  if (!state.merchantStats || typeof state.merchantStats !== 'object') {
    state.merchantStats = buildMerchantStats();
  }
  const stats = state.merchantStats;
  if (!Number.isFinite(stats.ticks)) {
    stats.ticks = 0;
  }
  if (!Number.isFinite(stats.trades)) {
    stats.trades = 0;
  }
  if (!stats.given || typeof stats.given !== 'object') {
    stats.given = {};
  }
  if (!stats.received || typeof stats.received !== 'object') {
    stats.received = {};
  }
  return stats;
}

// Build a fresh merchant state object.
function buildMerchantState(merchantConfig, currentTick) {
  const spawnRange = getMerchantSpawnRange(merchantConfig);
  const baseTick = Number.isFinite(currentTick) ? currentTick : 0;
  return {
    phase: 'idle',
    x: 0,
    y: 0,
    target: null,
    exitTarget: null,
    entrySide: null,
    exitSide: null,
    stayTicks: 0,
    tradesRemaining: 0,
    tradesMax: 0,
    tradeCount: 0,
    tradeLog: null,
    nextSpawnTick: baseTick + randomBetween(spawnRange.min, spawnRange.max),
  };
}

// Build an empty merchant stats record.
function buildMerchantStats() {
  return {
    ticks: 0,
    trades: 0,
    given: {},
    received: {},
  };
}

// Schedule the next merchant spawn tick.
function scheduleNextMerchantSpawnTick(currentTick, merchantConfig) {
  const spawnRange = getMerchantSpawnRange(merchantConfig);
  return currentTick + randomBetween(spawnRange.min, spawnRange.max);
}

// Normalize merchant spawn range settings.
function getMerchantSpawnRange(merchantConfig) {
  const spawnRange = merchantConfig.spawnRangeTicks || {};
  const min = Math.max(0, Number(spawnRange.min ?? 0));
  const max = Math.max(min, Number(spawnRange.max ?? min));
  return { min, max };
}

// Spawn the merchant into the world and set visit timers.
function spawnMerchant(state, config, runtime, merchant) {
  const merchantConfig = config.merchant || {};
  const entrySide = pickMerchantSide();
  const exitSide = pickExitSide(entrySide);
  const entryPosition = findEdgeSpawnPosition(state, runtime, entrySide);
  const stopTarget = findMerchantStopSpot(state, runtime) || entryPosition;
  const exitTarget = findEdgeSpawnPosition(state, runtime, exitSide);

  merchant.phase = 'entering';
  merchant.entrySide = entrySide;
  merchant.exitSide = exitSide;
  merchant.x = entryPosition.x;
  merchant.y = entryPosition.y;
  merchant.target = stopTarget;
  merchant.exitTarget = exitTarget;

  merchant.stayTicks = Math.max(0, Number(merchantConfig.stayTicks ?? 10));
  const maxTrades = Math.max(0, Number(merchantConfig.maxTradesPerVisit ?? 0));
  merchant.tradesRemaining = maxTrades;
  merchant.tradesMax = maxTrades;
  merchant.tradeCount = 0;
  merchant.tradeLog = {};

  merchant.nextSpawnTick = scheduleNextMerchantSpawnTick(state.tick, merchantConfig);

  pushEvent(state, config, 'Merchant arrived');
}

// Begin the merchant exit phase.
function startMerchantExit(state, runtime, merchant) {
  if (merchant.phase === 'exiting') {
    return;
  }
  merchant.phase = 'exiting';
  if (!merchant.exitTarget) {
    const exitSide = merchant.exitSide || pickMerchantSide();
    merchant.exitTarget = findEdgeSpawnPosition(state, runtime, exitSide);
  }
}

// Finalize the merchant visit and reset state.
function finalizeMerchantVisit(state, config, merchant) {
  const summary = buildMerchantTradeSummary(merchant.tradeLog, 2);
  pushEvent(state, config, 'Merchant departed');
  if (summary) {
    pushEvent(state, config, summary);
  }

  merchant.phase = 'idle';
  merchant.x = 0;
  merchant.y = 0;
  merchant.target = null;
  merchant.exitTarget = null;
  merchant.entrySide = null;
  merchant.exitSide = null;
  merchant.stayTicks = 0;
  merchant.tradesRemaining = 0;
  merchant.tradesMax = 0;
  merchant.tradeCount = 0;
  merchant.tradeLog = null;
}

// Pick a random map side for merchant entry.
function pickMerchantSide() {
  return MERCHANT_SIDES[Math.floor(Math.random() * MERCHANT_SIDES.length)];
}

// Pick a different side for merchant exit when possible.
function pickExitSide(entrySide) {
  const options = MERCHANT_SIDES.filter((side) => side !== entrySide);
  if (options.length === 0) {
    return entrySide;
  }
  return options[Math.floor(Math.random() * options.length)];
}

// Find a target stop spot near the village.
function findMerchantStopSpot(state, runtime) {
  const houses = (state.structures || []).filter((structure) => structure.type === 'house');
  if (houses.length > 0) {
    const house = houses[Math.floor(Math.random() * houses.length)];
    const adjacent = getAdjacentPositions(house.x, house.y);
    const available = adjacent.filter((pos) => isBuildableCell(state, runtime, pos.x, pos.y));
    if (available.length > 0) {
      return available[Math.floor(Math.random() * available.length)];
    }
  }

  return findVillageBuildSpot(state, runtime);
}

// Attempt a merchant trade and apply it if valid.
function attemptMerchantTrade(state, config, merchant) {
  const trade = findMerchantTradeOption(state, config);
  if (!trade) {
    return false;
  }
  applyMerchantTrade(state, merchant, trade);
  return true;
}

// Choose a trade option based on shortages and reserves.
function findMerchantTradeOption(state, config) {
  const merchantConfig = config.merchant || {};
  const reserveRatio = clamp(Number(merchantConfig.reserveRatio ?? 0.8), 0, 1);
  const tradeRate = merchantConfig.tradeRate || {};
  const neverGive = getMerchantNeverGive(merchantConfig);
  const targets = getMerchantTargets(state, config);

  const needs = [];
  for (const [resource, targetValue] of Object.entries(targets)) {
    const target = Number(targetValue || 0);
    if (target <= 0) {
      continue;
    }
    const current = Number(state.stockpile[resource] || 0);
    const ratio = clamp(current / target, 0, 1);
    if (ratio < 1) {
      needs.push({ resource, ratio });
    }
  }

  if (needs.length === 0) {
    return null;
  }

  needs.sort((a, b) => a.ratio - b.ratio);
  const need = needs[0];

  const extras = [];
  for (const [resource, targetValue] of Object.entries(targets)) {
    const target = Number(targetValue || 0);
    if (target <= 0) {
      continue;
    }
    if (need.resource === resource) {
      continue;
    }
    if (neverGive.has(resource)) {
      continue;
    }
    const current = Number(state.stockpile[resource] || 0);
    const ratio = clamp(current / target, 0, 1);
    if (ratio > reserveRatio) {
      extras.push({ resource, ratio, current, target });
    }
  }

  if (extras.length === 0) {
    return null;
  }

  extras.sort((a, b) => b.ratio - a.ratio);
  const extra = extras[0];

  const rate = Number(tradeRate[extra.resource] ?? tradeRate.default ?? 1);
  if (!Number.isFinite(rate) || rate <= 0) {
    return null;
  }

  const giveAmount = Math.max(1, Math.floor((extra.current - extra.target) * rate));
  const receiveAmount = Math.max(1, Math.floor(giveAmount / rate));
  if (giveAmount <= 0 || receiveAmount <= 0) {
    return null;
  }

  return {
    giveResource: extra.resource,
    giveAmount,
    receiveResource: need.resource,
    receiveAmount,
  };
}

// Resolve resources that the merchant should never receive from the stockpile.
function getMerchantNeverGive(merchantConfig) {
  const list = Array.isArray(merchantConfig.neverGive) ? merchantConfig.neverGive : [];
  const blocked = new Set();
  for (const resource of list) {
    if (typeof resource !== 'string') {
      continue;
    }
    const trimmed = resource.trim();
    if (trimmed.length > 0) {
      blocked.add(trimmed);
    }
  }
  return blocked;
}

// Resolve merchant targets from resource config.
function getMerchantTargets(state, config) {
  const resources = config.resources || {};
  const baseTargets = resources.targets || resources.stockpile || {};
  const targets = {};
  for (const resource of Object.keys(baseTargets)) {
    const target = getStockpileTarget(state, config, resource, baseTargets);
    if (target > 0) {
      targets[resource] = target;
    }
  }
  return targets;
}

// Apply the chosen merchant trade to stockpiles and stats.
function applyMerchantTrade(state, merchant, trade) {
  state.stockpile[trade.giveResource] = Number(state.stockpile[trade.giveResource] || 0) - trade.giveAmount;
  state.stockpile[trade.receiveResource] = Number(state.stockpile[trade.receiveResource] || 0)
    + trade.receiveAmount;
  merchant.tradesRemaining = Math.max(0, Number(merchant.tradesRemaining || 0) - 1);
  merchant.tradeCount = Number(merchant.tradeCount || 0) + 1;
  recordMerchantTrade(merchant, trade);
  recordMerchantTradeStats(state, trade);
}

// Record trade counts for a merchant visit.
function recordMerchantTrade(merchant, trade) {
  if (!merchant.tradeLog || typeof merchant.tradeLog !== 'object') {
    merchant.tradeLog = {};
  }
  const key = `${trade.giveResource}->${trade.receiveResource}`;
  merchant.tradeLog[key] = Number(merchant.tradeLog[key] || 0) + 1;
}

// Record cumulative merchant trade stats on the state.
function recordMerchantTradeStats(state, trade) {
  const stats = ensureMerchantStats(state);
  const giveResource = trade.giveResource;
  const receiveResource = trade.receiveResource;
  const giveAmount = Number(trade.giveAmount || 0);
  const receiveAmount = Number(trade.receiveAmount || 0);

  stats.trades = Number(stats.trades || 0) + 1;
  if (giveResource) {
    stats.given[giveResource] = Number(stats.given[giveResource] || 0) + giveAmount;
  }
  if (receiveResource) {
    stats.received[receiveResource] = Number(stats.received[receiveResource] || 0) + receiveAmount;
  }
}

// Build a compact trade summary string for events.
function buildMerchantTradeSummary(tradeLog, maxEntries) {
  if (!tradeLog || typeof tradeLog !== 'object') {
    return '';
  }
  const entries = Object.entries(tradeLog)
    .filter(([, count]) => Number(count || 0) > 0)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));
  if (entries.length === 0) {
    return '';
  }
  const limit = Math.max(1, Number(maxEntries || 0));
  const parts = entries.slice(0, limit).map(([key, count]) => `${key} x${count}`);
  return `Merchant traded: ${parts.join(', ')}`;
}

module.exports = { updateMerchant };
