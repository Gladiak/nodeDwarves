'use strict';

const { clamp } = require('../utils');
const { getSeasonModifier } = require('./season');
const { getWeatherModifier } = require('./weather');
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
  const fieldSeason = getSeasonModifier(state, 'fieldRegen', 1);
  const fieldWeather = getWeatherModifier(state, config, 'fieldRegen', 1);
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
      baseDelta *= fieldSeason * fieldIrrigation * fieldWeather;
    } else {
      baseDelta *= multiplier * weatherRegen;
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

// Compute the current stockpile ratio against the configured target.
function getStockpileRatio(state, config, resourceId) {
  const targets = (config.resources && config.resources.targets) || {};
  const target = Number(targets[resourceId] || 0);
  if (target <= 0) {
    return 1;
  }
  const current = Number(state.stockpile[resourceId] || 0);
  return clamp(current / target, 0, 1);
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
  return base * weatherMultiplier;
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
    const target = Number(targets[resource] || 0);
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
    const terrainTarget = pickTerrainResourceTarget(state, config, resourceId, anchor);
    if (!terrainTarget) {
      return null;
    }
    target = { x: terrainTarget.x, y: terrainTarget.y };
  } else {
    return null;
  }

  const workTicks = getGatherTicks(config, resourceId, state);

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
  const multiplier = getSeasonModifier(state, 'gatherTicks', 1)
    * getWeatherModifier(state, config, 'gatherTicks', 1);
  return Math.max(1, Math.round(base * multiplier));
}

// Compute gather yield for a resource node.
function getGatherYield(config, resourceId, node, state) {
  const jobs = config.jobs || {};
  const specific = jobs.gatherYield && jobs.gatherYield[resourceId];
  const value = specific !== undefined ? specific : jobs.defaultGatherYield;
  const baseYield = Math.max(1, Number(value || 1));
  const multiplier = getSeasonModifier(state, 'gatherYield', 1)
    * getWeatherModifier(state, config, 'gatherYield', 1);
  const scaledYield = Math.max(1, Math.round(baseYield * multiplier));
  if (!node) {
    return scaledYield;
  }
  const remaining = Math.max(0, Number(node.remaining || 0));
  return Math.min(scaledYield, remaining);
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
function applyOutputs(stockpile, outputs) {
  for (const [resource, amount] of Object.entries(outputs)) {
    stockpile[resource] = Number(stockpile[resource] || 0) + Number(amount || 0);
  }
}

module.exports = {
  regenerateNodes,
  getResourceNodeRatio,
  getStockpileRatio,
  getFieldIrrigationMultiplier,
  updateHouseStorage,
  getHouseStorageCapacity,
  createResourceNode,
  createGatherJob,
  getGatherTicks,
  getGatherYield,
  hasInputs,
  consumeInputs,
  applyOutputs,
};
