'use strict';

const { clamp } = require('../utils');
const { pushEvent } = require('./events');
const { randomBetween, shuffleInPlace } = require('./random');
const { getWorldEventModifier } = require('./world_events');

// Update contract lifecycle, reputation, and active buffs each tick.
function updateContracts(state, config) {
  const contractsConfig = getContractsConfig(config);
  const contracts = ensureContractsState(state, contractsConfig);
  if (!contracts) {
    return;
  }

  const tick = Math.max(0, Number(state.tick || 0));
  expireActiveBuff(contracts, tick);

  if (contracts.active) {
    if (canFulfillContract(state, contracts.active)) {
      completeContract(state, config, contracts, contracts.active, contractsConfig, tick);
      return;
    }
    if (tick >= Number(contracts.active.expiresAt || 0)) {
      failContract(state, config, contracts, contracts.active, contractsConfig, tick);
    }
    return;
  }

  if (tick < Number(contracts.nextSpawnTick || 0)) {
    return;
  }

  const contract = createContract(state, config, contractsConfig, tick);
  if (!contract) {
    contracts.nextSpawnTick = scheduleNextContractTick(tick, contractsConfig);
    return;
  }

  contracts.active = contract;
  pushEvent(state, config, buildContractOfferEvent(contract));
}

// Return the active contract target boost multiplier for a resource.
function getContractTargetBoost(state, resourceId) {
  const contracts = state && state.contracts ? state.contracts : null;
  const active = contracts && contracts.active ? contracts.active : null;
  if (!active || !resourceId || !active.targetBoosts) {
    return 1;
  }
  const boost = Number(active.targetBoosts[resourceId] || 1);
  if (!Number.isFinite(boost) || boost <= 1) {
    return 1;
  }
  return boost;
}

// Return the active contract output bonus (fraction).
function getContractProductionBonus(state) {
  const buff = getActiveBuff(state);
  if (!buff || buff.type !== 'production') {
    return 0;
  }
  return Math.max(0, Number(buff.outputBonus || 0));
}

// Return the active contract raid death rate reduction (fraction).
function getContractRaidDeathRateReduction(state) {
  const buff = getActiveBuff(state);
  if (!buff || buff.type !== 'war') {
    return 0;
  }
  return Math.max(0, Number(buff.raidDeathRateReduction || 0));
}

// Return the active contract ruins combat bonus (fraction).
function getContractRuinsCombatBonus(state) {
  const buff = getActiveBuff(state);
  if (!buff || buff.type !== 'war') {
    return 0;
  }
  return Math.max(0, Number(buff.ruinsCombatBonus || 0));
}

// Resolve contracts config with safe defaults.
function getContractsConfig(config) {
  return (config && config.contracts) || {};
}

// Ensure contract state exists and is normalized.
function ensureContractsState(state, contractsConfig) {
  if (!state || !contractsConfig || contractsConfig.enabled === false) {
    if (state) {
      state.contracts = null;
    }
    return null;
  }

  if (!state.contracts || typeof state.contracts !== 'object') {
    state.contracts = {
      active: null,
      nextSpawnTick: scheduleNextContractTick(state.tick, contractsConfig),
      reputations: buildInitialReputations(contractsConfig),
      activeBuff: null,
      stats: {
        successes: 0,
        failures: 0,
      },
      counter: 1,
    };
  }

  const contracts = state.contracts;
  if (!Number.isFinite(contracts.nextSpawnTick)) {
    contracts.nextSpawnTick = scheduleNextContractTick(state.tick, contractsConfig);
  }
  if (!contracts.reputations || typeof contracts.reputations !== 'object') {
    contracts.reputations = buildInitialReputations(contractsConfig);
  }
  if (!contracts.stats || typeof contracts.stats !== 'object') {
    contracts.stats = { successes: 0, failures: 0 };
  }
  if (!Number.isFinite(contracts.counter) || contracts.counter < 1) {
    contracts.counter = 1;
  }
  return contracts;
}

// Build the initial reputation map for configured factions.
function buildInitialReputations(contractsConfig) {
  const factions = (contractsConfig && contractsConfig.factions) || {};
  const reputations = {};
  for (const factionId of Object.keys(factions)) {
    reputations[factionId] = 0;
  }
  return reputations;
}

// Schedule the next contract spawn tick.
function scheduleNextContractTick(currentTick, contractsConfig) {
  const spawnRange = (contractsConfig && contractsConfig.spawnRangeTicks) || {};
  const minSpawn = Number(spawnRange.min ?? 200);
  const maxSpawn = Number(spawnRange.max ?? minSpawn);
  const tick = Math.max(0, Number(currentTick || 0));
  return tick + randomBetween(minSpawn, maxSpawn);
}

// Create a new contract definition from config and state.
function createContract(state, config, contractsConfig, tick) {
  const factions = (contractsConfig && contractsConfig.factions) || {};
  const factionEntries = Object.entries(factions);
  if (factionEntries.length === 0) {
    return null;
  }

  const [factionId, faction] = factionEntries[Math.floor(Math.random() * factionEntries.length)];
  if (!factionId || !faction || typeof faction !== 'object') {
    return null;
  }

  const requests = buildContractRequests(state, config, contractsConfig);
  if (!requests || requests.length === 0) {
    return null;
  }

  const expiryTicks = Math.max(1, Number(contractsConfig.expiryTicks || 0));
  const targetBoost = Math.max(1, Number(contractsConfig.targetBoost || 1));
  const requested = {};
  const targetBoosts = {};
  for (const request of requests) {
    if (!request || !request.resource || !Number.isFinite(request.amount)) {
      continue;
    }
    requested[request.resource] = Math.max(0, Math.round(Number(request.amount || 0)));
    targetBoosts[request.resource] = targetBoost;
  }

  if (Object.keys(requested).length === 0) {
    return null;
  }

  return {
    id: `contract_${Number(state.contracts && state.contracts.counter || 1)}`,
    factionId,
    factionLabel: faction.label || factionId,
    role: faction.role || 'production',
    mineral: faction.mineral || null,
    requested,
    requests,
    targetBoosts,
    createdTick: tick,
    expiresAt: tick + expiryTicks,
  };
}

// Build the requested resources for a contract.
function buildContractRequests(state, config, contractsConfig) {
  const allowed = Array.isArray(contractsConfig.allowedResources)
    ? contractsConfig.allowedResources.filter((resource) => typeof resource === 'string')
    : [];
  if (allowed.length === 0) {
    return [];
  }

  const available = allowed.filter((resource) => getContractTarget(state, config, contractsConfig, resource) > 0);
  if (available.length === 0) {
    return [];
  }

  const requestCountConfig = contractsConfig.requestCount || {};
  const countMin = Math.max(1, Math.floor(Number(requestCountConfig.min ?? 1)));
  const countMax = Math.max(countMin, Math.floor(Number(requestCountConfig.max ?? countMin)));
  shuffleInPlace(available);
  const count = Math.min(available.length, randomBetween(countMin, countMax));

  const ratioConfig = contractsConfig.requestRatio || {};
  const ratioMin = clamp(Number(ratioConfig.min ?? 0.2), 0, 1);
  const ratioMax = clamp(Number(ratioConfig.max ?? ratioMin), ratioMin, 1);

  const requests = [];
  for (const resource of available.slice(0, count)) {
    const target = getContractTarget(state, config, contractsConfig, resource);
    if (target <= 0) {
      continue;
    }
    const ratio = ratioMin + Math.random() * (ratioMax - ratioMin);
    const amount = Math.max(1, Math.round(target * ratio));
    requests.push({ resource, amount, target });
  }

  return requests;
}

// Compute the stockpile target used for contract sizing.
function getContractTarget(state, config, contractsConfig, resourceId) {
  const resources = (config && config.resources) || {};
  const targets = resources.targets || resources.stockpile || {};
  const perCapitaConfig = resources.targetsPerCapita || {};
  const requestTargets = contractsConfig.requestTargets || {};
  const requestTargetsPerCapita = contractsConfig.requestTargetsPerCapita || {};
  const baseTarget = Math.max(0, Number(
    requestTargets[resourceId] !== undefined ? requestTargets[resourceId] : targets[resourceId],
  ) || 0);
  const perCapita = Math.max(0, Number(
    requestTargetsPerCapita[resourceId] !== undefined
      ? requestTargetsPerCapita[resourceId]
      : perCapitaConfig[resourceId],
  ) || 0);
  if (perCapita <= 0) {
    return baseTarget;
  }
  const population = Array.isArray(state && state.dwarves) ? state.dwarves.length : 0;
  return Math.max(0, baseTarget + perCapita * population);
}

// Check whether stockpile has enough for the contract.
function canFulfillContract(state, contract) {
  if (!state || !state.stockpile || !contract || !contract.requested) {
    return false;
  }
  for (const [resource, amount] of Object.entries(contract.requested)) {
    if (Number(state.stockpile[resource] || 0) < Number(amount || 0)) {
      return false;
    }
  }
  return true;
}

// Apply contract completion effects and rewards.
function completeContract(state, config, contracts, contract, contractsConfig, tick) {
  consumeRequestedResources(state.stockpile, contract.requested);
  adjustReputation(contracts, contract.factionId, contractsConfig, contractsConfig.reputation && contractsConfig.reputation.successDelta);
  applyContractRewards(state, config, contract, contracts, contractsConfig);
  applyContractBuff(contracts, contract, contractsConfig, tick);
  const buffEvent = buildContractBuffEvent(contracts.activeBuff, tick);
  if (buffEvent) {
    pushEvent(state, config, buffEvent);
  }

  contracts.stats.successes = Number(contracts.stats.successes || 0) + 1;
  contracts.active = null;
  contracts.counter = Number(contracts.counter || 1) + 1;
  contracts.nextSpawnTick = scheduleNextContractTick(tick, contractsConfig);

  pushEvent(state, config, `Contract completed: ${contract.factionLabel || contract.factionId}`);
}

// Apply contract failure effects.
function failContract(state, config, contracts, contract, contractsConfig, tick) {
  adjustReputation(contracts, contract.factionId, contractsConfig, contractsConfig.reputation && contractsConfig.reputation.failureDelta);

  contracts.stats.failures = Number(contracts.stats.failures || 0) + 1;
  contracts.active = null;
  contracts.counter = Number(contracts.counter || 1) + 1;
  contracts.nextSpawnTick = scheduleNextContractTick(tick, contractsConfig);

  pushEvent(state, config, `Contract failed: ${contract.factionLabel || contract.factionId}`);
}

// Apply base and mineral rewards for a contract.
function applyContractRewards(state, config, contract, contracts, contractsConfig) {
  const rewardConfig = contractsConfig.rewards || {};
  const baseRewards = rewardConfig.base || {};
  const scalePerResource = Math.max(0, Number(rewardConfig.scalePerResource || 0));
  const eventRewardMultiplier = Math.max(0, Number(getWorldEventModifier(state, 'contractReward', 1) || 1));
  const requestCount = contract && contract.requests ? contract.requests.length : 0;
  const scale = 1 + scalePerResource * Math.max(0, requestCount - 1);

  for (const [resource, amountRaw] of Object.entries(baseRewards)) {
    const amount = Math.max(0, Math.round(Number(amountRaw || 0) * scale * eventRewardMultiplier));
    if (amount <= 0) {
      continue;
    }
    state.stockpile[resource] = Number(state.stockpile[resource] || 0) + amount;
  }

  const mineral = contract.mineral;
  if (!mineral) {
    return;
  }
  const rep = Number(contracts.reputations && contracts.reputations[contract.factionId] || 0);
  const thresholds = Array.isArray(rewardConfig.mineralThresholds)
    ? rewardConfig.mineralThresholds.slice()
    : [];
  thresholds.sort((a, b) => Number(b.minReputation || 0) - Number(a.minReputation || 0));
  let mineralAmount = 0;
  for (const threshold of thresholds) {
    const minReputation = Number(threshold && threshold.minReputation || 0);
    if (rep >= minReputation) {
      mineralAmount = Math.max(0, Number(threshold.amount || 0));
      break;
    }
  }
  mineralAmount = Math.max(0, Math.round(mineralAmount * eventRewardMultiplier));
  if (mineralAmount > 0) {
    state.stockpile[mineral] = Number(state.stockpile[mineral] || 0) + mineralAmount;
    const labels = (config && config.resources && config.resources.labels) || {};
    const label = labels[mineral] || mineral;
    pushEvent(state, config, `Contract reward: ${label} x${mineralAmount}`);
  }
}

// Apply the active contract buff for the faction role.
function applyContractBuff(contracts, contract, contractsConfig, tick) {
  const buffs = contractsConfig.buffs || {};
  const duration = Math.max(0, Number(buffs.durationTicks || 0));
  if (duration <= 0) {
    return;
  }

  const role = contract.role || 'production';
  const activeBuff = {
    type: role,
    expiresAt: tick + duration,
    factionId: contract.factionId,
  };

  if (role === 'production') {
    const production = buffs.production || {};
    activeBuff.outputBonus = Math.max(0, Number(production.outputBonus || 0));
  } else if (role === 'war') {
    const war = buffs.war || {};
    activeBuff.raidDeathRateReduction = Math.max(0, Number(war.raidDeathRateReduction || 0));
    activeBuff.ruinsCombatBonus = Math.max(0, Number(war.ruinsCombatBonus || 0));
  }

  contracts.activeBuff = activeBuff;
}

// Clear active buff when it expires.
function expireActiveBuff(contracts, tick) {
  if (!contracts || !contracts.activeBuff) {
    return;
  }
  const expiresAt = Number(contracts.activeBuff.expiresAt || 0);
  if (expiresAt > 0 && tick >= expiresAt) {
    contracts.activeBuff = null;
  }
}

// Resolve the current active buff from state.
function getActiveBuff(state) {
  const contracts = state && state.contracts ? state.contracts : null;
  if (!contracts || !contracts.activeBuff) {
    return null;
  }
  return contracts.activeBuff;
}

// Consume the requested resources from the stockpile.
function consumeRequestedResources(stockpile, requested) {
  if (!stockpile || !requested) {
    return;
  }
  for (const [resource, amount] of Object.entries(requested)) {
    stockpile[resource] = Number(stockpile[resource] || 0) - Number(amount || 0);
  }
}

// Adjust reputation for a faction within configured bounds.
function adjustReputation(contracts, factionId, contractsConfig, delta) {
  if (!contracts || !contracts.reputations || !factionId) {
    return;
  }
  const repConfig = contractsConfig.reputation || {};
  const min = Number(repConfig.min ?? -1);
  const max = Number(repConfig.max ?? 1);
  const current = Number(contracts.reputations[factionId] || 0);
  const change = Number(delta || 0);
  const next = clamp(current + change, min, max);
  contracts.reputations[factionId] = next;
}

// Build the event string for a new contract offer.
function buildContractOfferEvent(contract) {
  const label = contract.factionLabel || contract.factionId || 'Contract';
  const summary = formatContractRequestSummary(contract.requests, 2);
  if (!summary) {
    return `Contract: ${label} requests supplies`;
  }
  return `Contract: ${label} requests ${summary}`;
}

// Build a short event string for a newly applied buff.
function buildContractBuffEvent(buff, tick) {
  if (!buff || !Number.isFinite(buff.expiresAt)) {
    return '';
  }
  const ticksLeft = Math.max(0, Math.round(Number(buff.expiresAt) - Number(tick || 0)));
  if (buff.type === 'production') {
    const bonus = Math.round(Math.max(0, Number(buff.outputBonus || 0)) * 100);
    return `Contract boon: +${bonus}% output (${ticksLeft}t)`;
  }
  if (buff.type === 'war') {
    const raid = Math.round(Math.max(0, Number(buff.raidDeathRateReduction || 0)) * 100);
    const combat = Math.round(Math.max(0, Number(buff.ruinsCombatBonus || 0)) * 100);
    return `Contract boon: -${raid}% raid deaths, +${combat}% ruins (${ticksLeft}t)`;
  }
  return '';
}

// Format a short request summary for events.
function formatContractRequestSummary(requests, maxEntries) {
  if (!Array.isArray(requests) || requests.length === 0) {
    return '';
  }
  const limit = Math.max(1, Number(maxEntries || 1));
  const parts = requests.slice(0, limit).map((request) => {
    const resource = request.resource || '?';
    const amount = Math.max(0, Math.round(Number(request.amount || 0)));
    return `${resource} x${amount}`;
  });
  return parts.join(', ');
}

module.exports = {
  updateContracts,
  getContractTargetBoost,
  getContractProductionBonus,
  getContractRaidDeathRateReduction,
  getContractRuinsCombatBonus,
};
