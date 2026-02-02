'use strict';

const { clamp } = require('../utils');
const { getClanEffects } = require('../clans');
const { getSeasonModifier } = require('./season');
const { getWeatherModifier } = require('./weather');
const { getMythMultiplier } = require('./myths');
const { getTerrainResourceRatio, pickTerrainResourceTarget } = require('./terrain');

// Regenerate resource nodes based on config, season, and weather multipliers.
function regenerateNodes(state, config) {
  const resourceConfig = config.resources || {};
  const regenConfig = resourceConfig.nodeRegen || {};
  const enabled = regenConfig.enabled !== false;
  if (!enabled) {
    return;
  }

  const multiplier = getSeasonModifier(state, 'nodeRegen', 1);
  const weatherRegen = getWeatherModifier(state, config, 'nodeRegen', 1);
  const mythRegen = getMythMultiplier(state, config, 'nodeRegen', 1);
  const fieldSeason = getSeasonModifier(state, 'fieldRegen', 1);
  const fieldWeather = getWeatherModifier(state, config, 'fieldRegen', 1);
  const mythFieldRegen = getMythMultiplier(state, config, 'fieldRegen', 1);
  const fieldIrrigation = getFieldIrrigationMultiplier(state, config);
  const perTick = Number(regenConfig.perTick ?? 0);
  const intervalTicks = Math.max(1, Number(regenConfig.intervalTicks ?? 0));
  const amount = Math.max(0, Number(regenConfig.amount ?? 0));
  const onlyDepleted = regenConfig.onlyDepleted === true;
  let baseRegen = 0;

  if (Number.isFinite(perTick) && perTick > 0) {
    baseRegen = perTick;
  } else if (Number.isFinite(amount) && amount > 0 && Number.isFinite(intervalTicks) && intervalTicks > 0) {
    const tick = Math.max(0, Number(state.tick || 0));
    if (tick % intervalTicks !== 0) {
      return;
    }
    baseRegen = amount;
  } else {
    return;
  }

  for (const node of state.nodes) {
    const capacity = Math.max(0, Number(node.capacity || 0));
    const remaining = Math.max(0, Number(node.remaining || 0));
    if (remaining >= capacity) {
      continue;
    }
    if (onlyDepleted && remaining > 0) {
      continue;
    }

    let baseDelta = baseRegen;
    if (node.source === 'field') {
      baseDelta *= fieldSeason * fieldIrrigation * fieldWeather * mythFieldRegen;
    } else {
      baseDelta *= multiplier * weatherRegen * mythRegen;
    }

    let nodeDelta = Math.floor(baseDelta);
    if (node.source === 'field') {
      nodeDelta = Math.round(baseDelta);
    }
    if (nodeDelta <= 0) {
      continue;
    }
    node.remaining = Math.min(capacity, remaining + nodeDelta);
  }
}

// Compute the ratio of remaining capacity for a resource across nodes/terrain.
function getResourceNodeRatio(state, resourceId) {
  let totalCapacity = 0;
  let totalRemaining = 0;
  for (const node of state.nodes) {
    if (node.id !== resourceId) {
      continue;
    }
    const capacity = Math.max(0, Number(node.capacity || 0));
    const remaining = Math.max(0, Number(node.remaining || 0));
    totalCapacity += capacity;
    totalRemaining += remaining;
  }
  const nodeRatio = totalCapacity > 0 ? clamp(totalRemaining / totalCapacity, 0, 1) : 0;
  const config = state.lastConfig;
  if (config && config.resources && config.resources.useTerrainTiles === true) {
    const terrainRatio = getTerrainResourceRatio(state, config, resourceId);
    return Math.max(nodeRatio, terrainRatio);
  }
  if (totalCapacity <= 0) {
    return 1;
  }
  return nodeRatio;
}

// Compute the target stockpile amount, optionally scaling per capita.
function getStockpileTarget(state, config, resourceId, fallbackTargets) {
  const resources = config.resources || {};
  const targets = fallbackTargets || resources.targets || resources.stockpile || {};
  const baseTarget = Math.max(0, Number(targets[resourceId] || 0));
  const perCapitaConfig = resources.targetsPerCapita || {};
  const perCapita = Math.max(0, Number(perCapitaConfig[resourceId] || 0));
  if (perCapita <= 0) {
    return baseTarget;
  }
  const population = Array.isArray(state && state.dwarves) ? state.dwarves.length : 0;
  return Math.max(0, baseTarget + perCapita * population);
}

// Check whether brewery jobs should pause due to low food ratio.
function shouldPauseBrewing(state, config) {
  const breweryConfig = config.structures && config.structures.brewery;
  if (!breweryConfig) {
    return false;
  }
  const threshold = clamp(Number(breweryConfig.pauseWhenFoodRatioBelow ?? 0), 0, 1);
  if (threshold <= 0) {
    return false;
  }
  const ratio = getStockpileRatio(state, config, 'food');
  return ratio < threshold;
}

// Compute the current stockpile ratio against the configured target.
function getStockpileRatio(state, config, resourceId) {
  const target = getStockpileTarget(state, config, resourceId);
  if (target <= 0) {
    return 1;
  }
  const current = Number(state.stockpile[resourceId] || 0);
  return clamp(current / target, 0, 1);
}

// Check if terrain cooldowns should be ignored for a resource under critical shortages.
function shouldIgnoreTerrainCooldown(state, config, resourceId) {
  const resources = config && config.resources ? config.resources : {};
  const critical = resources.terrainCooldownCriticalRatio;
  if (critical === undefined || critical === null) {
    return false;
  }
  let threshold = null;
  if (Number.isFinite(critical)) {
    threshold = Number(critical);
  } else if (typeof critical === 'object') {
    const specific = critical && resourceId ? critical[resourceId] : undefined;
    const fallback = critical ? (critical.default ?? critical.all) : undefined;
    if (Number.isFinite(specific)) {
      threshold = Number(specific);
    } else if (Number.isFinite(fallback)) {
      threshold = Number(fallback);
    }
  }
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return false;
  }
  const ratio = getStockpileRatio(state, config, resourceId);
  return ratio < threshold;
}

// Compute the irrigation multiplier for fields from water stockpile and weather.
function getFieldIrrigationMultiplier(state, config) {
  const fieldConfig = (config.structures && config.structures.field) || {};
  const minMultiplier = Number(fieldConfig.irrigationMinMultiplier ?? 1);
  const maxMultiplier = Number(fieldConfig.irrigationMaxMultiplier ?? 1);
  const low = Math.min(minMultiplier, maxMultiplier);
  const high = Math.max(minMultiplier, maxMultiplier);
  const waterRatio = getStockpileRatio(state, config, 'water');
  const ratio = clamp(waterRatio, 0, 1);
  const base = low + (high - low) * ratio;
  const weatherMultiplier = getWeatherModifier(state, config, 'irrigation', 1);
  const mythMultiplier = getMythMultiplier(state, config, 'irrigation', 1);
  return base * weatherMultiplier * mythMultiplier;
}

// Update house storage buffers and handle overflow/decay.
function updateHouseStorage(state, config) {
  const storageConfig = config.structures && config.structures.house
    ? config.structures.house.storage
    : null;
  if (!storageConfig || storageConfig.enabled === false) {
    return;
  }
  const resources = Array.isArray(storageConfig.resources) ? storageConfig.resources : [];
  if (resources.length === 0) {
    return;
  }
  const houses = (state.structures || []).filter((structure) => structure.type === 'house');
  if (!state.houseStorage) {
    state.houseStorage = { stored: {}, capacity: {} };
  }

  const stored = state.houseStorage.stored || {};
  const capacity = state.houseStorage.capacity || {};
  for (const resource of resources) {
    stored[resource] = Math.max(0, Number(stored[resource] || 0));
    capacity[resource] = 0;
  }

  for (const house of houses) {
    const capPerHouse = getHouseStorageCapacity(storageConfig, house.level);
    for (const resource of resources) {
      capacity[resource] += capPerHouse;
    }
  }

  const targets = (config.resources && config.resources.targets) || {};
  for (const resource of resources) {
    const target = getStockpileTarget(state, config, resource, targets);
    const maxCap = Math.max(0, Number(capacity[resource] || 0));
    let storedAmount = Math.max(0, Number(stored[resource] || 0));
    const stock = Math.max(0, Number(state.stockpile[resource] || 0));

    if (storedAmount > maxCap) {
      storedAmount = maxCap;
    }

    if (target <= 0) {
      state.stockpile[resource] = stock + storedAmount;
      stored[resource] = 0;
      continue;
    }

    if (stock > target) {
      const overflow = Math.min(maxCap - storedAmount, stock - target);
      state.stockpile[resource] = stock - overflow;
      storedAmount += overflow;
    } else if (stock < target && storedAmount > 0) {
      const releaseAmount = Math.min(storedAmount, target - stock);
      storedAmount -= releaseAmount;
      state.stockpile[resource] = stock + releaseAmount;
    } else if (stock < target && storedAmount < maxCap && stock > 0) {
      const storeAmount = Math.min(maxCap - storedAmount, target - stock, stock);
      storedAmount += storeAmount;
      state.stockpile[resource] = stock - storeAmount;
    }

    const decayRates = storageConfig.decayPerTick || storageConfig.decayRate || {};
    const decayRate = Number(decayRates[resource] || 0);
    if (decayRate > 0 && storedAmount > 0) {
      storedAmount = Math.max(0, storedAmount - Math.max(0, Math.floor(storedAmount * decayRate)));
    }

    stored[resource] = storedAmount;
  }

  state.houseStorage = { stored, capacity };
}

// Compute per-house storage capacity for the given level.
function getHouseStorageCapacity(storageConfig, level) {
  if (!storageConfig) {
    return 0;
  }
  const levelMap = storageConfig.capacityPerLevel;
  if (levelMap && typeof levelMap === 'object' && !Array.isArray(levelMap)) {
    const requested = Number.isFinite(level) ? String(level) : '1';
    if (levelMap[requested] !== undefined) {
      return Math.max(0, Number(levelMap[requested] || 0));
    }
    const numericKeys = Object.keys(levelMap)
      .map((key) => Number(key))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
    if (numericKeys.length > 0) {
      let chosen = null;
      if (Number.isFinite(level)) {
        for (const key of numericKeys) {
          if (key <= level) {
            chosen = key;
          } else {
            break;
          }
        }
      }
      if (chosen === null) {
        chosen = numericKeys[0];
      }
      return Math.max(0, Number(levelMap[String(chosen)] || 0));
    }
  }
  const base = Number(storageConfig.capacityPerHouse || 0);
  if (!Number.isFinite(level) || level <= 1) {
    return Math.max(0, base);
  }
  const bonus = Number(storageConfig.capacityPerLevel || 0);
  return Math.max(0, base + bonus * (level - 1));
}

// Create a resource node instance based on config defaults.
function createResourceNode(state, config, resourceId, x, y, capacityOverride, source) {
  const resources = config.resources || {};
  const capacityConfig = resources.nodeCapacity || {};
  const defaultCapacity = Number(resources.defaultNodeCapacity || 10);
  const symbols = config.symbols || {};
  const capacity = Math.max(
    1,
    Number(
      capacityOverride !== undefined
        ? capacityOverride
        : (capacityConfig[resourceId] ?? defaultCapacity),
    ),
  );
  const symbol = symbols[resourceId] || '?';
  return {
    nodeId: `node_${++state.nodeCounter}`,
    id: resourceId,
    symbol,
    source: source || 'natural',
    x,
    y,
    capacity,
    remaining: capacity,
  };
}

// Create a gather job for a resource, selecting a node or terrain tile.
function createGatherJob(resourceId, state, config, dwarf) {
  const resources = config.resources || {};
  const useTerrainTiles = resources.useTerrainTiles === true;
  const nodes = state.nodes.filter(
    (node) => node.id === resourceId && Number(node.remaining || 0) > 0,
  );
  const home = dwarf && dwarf.homeId
    ? state.structures.find((structure) => structure.id === dwarf.homeId)
    : null;
  const anchor = home || dwarf || null;

  let target = null;
  let nodeId = null;
  if (nodes.length > 0) {
    let node = nodes[Math.floor(Math.random() * nodes.length)];
    if (anchor) {
      let bestNodes = [];
      let bestDistance = Infinity;
      for (const candidate of nodes) {
        const dist = Math.abs(candidate.x - anchor.x) + Math.abs(candidate.y - anchor.y);
        if (dist < bestDistance) {
          bestDistance = dist;
          bestNodes = [candidate];
        } else if (dist === bestDistance) {
          bestNodes.push(candidate);
        }
      }
      if (bestNodes.length > 0) {
        node = bestNodes[Math.floor(Math.random() * bestNodes.length)];
      }
    }
    target = { x: node.x, y: node.y };
    nodeId = node.nodeId;
  } else if (useTerrainTiles) {
    const ignoreCooldown = shouldIgnoreTerrainCooldown(state, config, resourceId);
    const terrainTarget = pickTerrainResourceTarget(state, config, resourceId, anchor, { ignoreCooldown });
    if (!terrainTarget) {
      return null;
    }
    target = { x: terrainTarget.x, y: terrainTarget.y };
  } else {
    return null;
  }

  let workTicks = getGatherTicks(config, resourceId, state);
  const clanEffects = getClanEffects(config, dwarf && dwarf.clanId);
  const gatherTicksPenalty = Math.max(0, Number(clanEffects.gather_ticks_penalty || 0));
  if (gatherTicksPenalty > 0) {
    workTicks = Math.max(1, Math.round(workTicks * (1 + gatherTicksPenalty)));
  }

  return {
    id: `job_${state.jobCounter++}`,
    type: 'gather',
    resource: resourceId,
    nodeId,
    target,
    workRemaining: workTicks,
    dwarfId: null,
  };
}

// Resolve gather tick count for a resource.
function getGatherTicks(config, resourceId, state) {
  const jobs = config.jobs || {};
  const specific = jobs.gatherTicks && jobs.gatherTicks[resourceId];
  const value = specific !== undefined ? specific : jobs.defaultGatherTicks;
  const base = Math.max(1, Number(value || 6));
  const moraleMultiplier = getMoraleGatherTickMultiplier(state, config, resourceId);
  const multiplier = getSeasonModifier(state, 'gatherTicks', 1)
    * getWeatherModifier(state, config, 'gatherTicks', 1)
    * getMythMultiplier(state, config, 'gatherTicks', 1)
    * moraleMultiplier;
  return Math.max(1, Math.round(base * multiplier));
}

// Compute morale-based gather tick multiplier.
function getMoraleGatherTickMultiplier(state, config, resourceId) {
  const moraleConfig = config.morale && config.morale.gatherTicks;
  if (!moraleConfig || moraleConfig.enabled === false) {
    return 1;
  }
  const resources = Array.isArray(moraleConfig.resources) ? moraleConfig.resources : null;
  if (resources && resourceId && !resources.includes(resourceId)) {
    return 1;
  }
  const moraleMin = clamp(Number(moraleConfig.moraleMin ?? 0), 0, 1);
  const moraleMax = clamp(Number(moraleConfig.moraleMax ?? 1), 0, 1);
  if (moraleMax <= moraleMin) {
    return 1;
  }
  const bonusMax = clamp(Number(moraleConfig.bonusMax ?? 0), 0, 0.9);
  if (bonusMax <= 0) {
    return 1;
  }
  const exponent = Math.max(0.1, Number(moraleConfig.exponent ?? 1));
  const avgMorale = getAverageMorale(state);
  const ratio = clamp((avgMorale - moraleMin) / (moraleMax - moraleMin), 0, 1);
  const bonus = Math.pow(ratio, exponent) * bonusMax;
  return Math.max(0.1, 1 - bonus);
}

// Compute average morale across the population.
function getAverageMorale(state) {
  const dwarves = state && Array.isArray(state.dwarves) ? state.dwarves : [];
  if (dwarves.length === 0) {
    return 0;
  }
  let total = 0;
  for (const dwarf of dwarves) {
    const value = Number(dwarf.state && dwarf.state.morale);
    total += Number.isFinite(value) ? value : 0;
  }
  return total / dwarves.length;
}

// Compute average beer morale boost across the population.
function getAverageBeerMoraleBoost(state) {
  const dwarves = state && Array.isArray(state.dwarves) ? state.dwarves : [];
  if (dwarves.length === 0) {
    return 0;
  }
  let total = 0;
  for (const dwarf of dwarves) {
    const value = Number(dwarf.state && dwarf.state.moraleBoostBeer);
    total += Number.isFinite(value) ? value : 0;
  }
  return total / dwarves.length;
}

// Compute gather yield for a resource node.
function getGatherYield(config, resourceId, node, state) {
  const jobs = config.jobs || {};
  const specific = jobs.gatherYield && jobs.gatherYield[resourceId];
  const value = specific !== undefined ? specific : jobs.defaultGatherYield;
  const baseYield = Math.max(1, Number(value || 1));
  const multiplier = getSeasonModifier(state, 'gatherYield', 1)
    * getWeatherModifier(state, config, 'gatherYield', 1)
    * getMythMultiplier(state, config, 'gatherYield', 1);
  const toolMultiplier = getToolMultiplier(state, config, resourceId);
  const forgeMultiplier = getForgeMultiplier(state, config);
  const beerMultiplier = getBeerProductionMultiplier(state, config, resourceId);
  const scaledYield = Math.max(
    1,
    Math.round(baseYield * multiplier * toolMultiplier * forgeMultiplier * beerMultiplier),
  );
  if (!node) {
    return scaledYield;
  }
  const remaining = Math.max(0, Number(node.remaining || 0));
  return Math.min(scaledYield, remaining);
}

// Compute tool multiplier for gathering outputs.
function getToolMultiplier(state, config, resourceId) {
  const toolsConfig = config.tools || {};
  const applyTo = Array.isArray(toolsConfig.applyTo) ? toolsConfig.applyTo : null;
  if (applyTo && resourceId && !applyTo.includes(resourceId)) {
    return 1;
  }
  const tools = state && state.tools ? state.tools : null;
  if (!tools) {
    return 1;
  }
  const level = Math.max(1, Number(tools.level || 1));
  const maxLevel = Math.max(1, Number(toolsConfig.maxLevel || tools.maxLevel || 1));
  const minBonus = Math.max(0, Number(toolsConfig.bonusMin || 0));
  const maxBonus = Math.max(minBonus, Number(toolsConfig.bonusMax || minBonus));
  if (maxLevel <= 1) {
    return 1 + minBonus;
  }
  const exponent = Math.max(0.1, Number(toolsConfig.bonusExponent || 1));
  const progress = clamp((level - 1) / (maxLevel - 1), 0, 1);
  const bonus = minBonus + (maxBonus - minBonus) * Math.pow(progress, exponent);
  return 1 + bonus;
}

// Compute beer-driven production multiplier for outputs.
function getBeerProductionMultiplier(state, config, resourceId) {
  const consumption = config && config.consumption ? config.consumption : {};
  const bonusMax = Math.max(0, Number(consumption.beerProductionBonusMax ?? 0));
  if (bonusMax <= 0) {
    return 1;
  }
  const applyTo = Array.isArray(consumption.beerProductionApplyTo)
    ? consumption.beerProductionApplyTo
    : null;
  if (applyTo && resourceId && !applyTo.includes(resourceId)) {
    return 1;
  }
  const maxBoost = Math.max(0, Number(consumption.beerMoraleMax ?? 0));
  const avgBoost = getAverageBeerMoraleBoost(state);
  const ratio = maxBoost > 0 ? avgBoost / maxBoost : avgBoost;
  const progress = clamp(ratio, 0, 1);
  const exponent = Math.max(0.1, Number(consumption.beerProductionBonusExponent || 1));
  const bonus = bonusMax * Math.pow(progress, exponent);
  return 1 + bonus;
}

// Compute mithril forge multiplier for outputs.
function getForgeMultiplier(state, config) {
  const forgeConfig = config && config.structures && config.structures.mithril_forge;
  if (!forgeConfig) {
    return 1;
  }
  const structures = Array.isArray(state && state.structures) ? state.structures : [];
  const forge = structures.find((structure) => structure.type === 'mithril_forge');
  if (!forge) {
    return 1;
  }
  const level = Math.max(1, Number(forge.level || 1));
  const maxLevel = Math.max(1, Number(forgeConfig.levelMax || 1));
  const minBonus = Math.max(0, Number(forgeConfig.levelBonusMin || 0));
  const maxBonus = Math.max(minBonus, Number(forgeConfig.levelBonusMax ?? minBonus));
  if (maxLevel <= 1) {
    return 1 + minBonus;
  }
  const exponent = Math.max(0.1, Number(forgeConfig.levelBonusExponent || 1));
  const progress = clamp((level - 1) / (maxLevel - 1), 0, 1);
  const bonus = minBonus + (maxBonus - minBonus) * Math.pow(progress, exponent);
  return 1 + bonus;
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

// Apply output resources to the stockpile.
function applyOutputs(stockpile, outputs, state, config) {
  const forgeMultiplier = getForgeMultiplier(state, config);
  for (const [resource, amount] of Object.entries(outputs)) {
    const beerMultiplier = getBeerProductionMultiplier(state, config, resource);
    const ruinsMultiplier = getRuinsOutputMultiplier(state, config, resource);
    stockpile[resource] =
      Number(stockpile[resource] || 0)
      + Number(amount || 0) * forgeMultiplier * beerMultiplier * ruinsMultiplier;
  }
}

// Apply per-tick decay to stockpiled resources.
function applyStockpileDecay(state, config) {
  const resources = config && config.resources ? config.resources : {};
  const decay = resources.decayPerTick;
  if (!decay || typeof decay !== 'object') {
    return;
  }
  const stockpile = state && state.stockpile ? state.stockpile : null;
  if (!stockpile) {
    return;
  }

  for (const [resource, rateRaw] of Object.entries(decay)) {
    const rate = clamp(Number(rateRaw || 0), 0, 1);
    if (rate <= 0) {
      continue;
    }
    const current = Number(stockpile[resource] || 0);
    if (current <= 0) {
      continue;
    }
    const next = current - current * rate;
    stockpile[resource] = next > 0 ? next : 0;
  }
}

// Compute output multiplier from ruins artifact bonuses.
function getRuinsOutputMultiplier(state, config, resource) {
  const ruinsConfig = config && config.ruins ? config.ruins : {};
  if (ruinsConfig.enabled === false) {
    return 1;
  }
  const ruins = state && state.ruins ? state.ruins : null;
  if (!ruins || !ruins.bonuses) {
    return 1;
  }
  const applyTo = ruinsConfig.outputBonusApplyTo;
  if (Array.isArray(applyTo) && applyTo.length > 0) {
    if (!applyTo.includes(resource)) {
      return 1;
    }
  }
  const bonus = Math.max(0, Number(ruins.bonuses.outputMultiplier || 0));
  return 1 + bonus;
}

module.exports = {
  regenerateNodes,
  getResourceNodeRatio,
  getStockpileTarget,
  shouldPauseBrewing,
  getStockpileRatio,
  shouldIgnoreTerrainCooldown,
  getFieldIrrigationMultiplier,
  updateHouseStorage,
  getHouseStorageCapacity,
  createResourceNode,
  createGatherJob,
  getGatherTicks,
  getGatherYield,
  getToolMultiplier,
  getBeerProductionMultiplier,
  getForgeMultiplier,
  hasInputs,
  consumeInputs,
  applyOutputs,
  applyStockpileDecay,
};
