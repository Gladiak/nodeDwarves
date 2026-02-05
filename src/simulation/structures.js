'use strict';

const { clamp } = require('../utils');
const {
  getTerrainTypeAt,
  hasTerrainResourceWithin,
  isSpawnableTile,
} = require('./terrain');
const { randomBetween } = require('./random');
const {
  getResourceNodeRatio,
  getStockpileRatio,
  hasInputs,
  consumeInputs,
} = require('./resources');
const { getHousingNeed } = require('./population');

// Clone a cost map while keeping only positive numeric values.
function cloneCost(cost) {
  const result = {};
  if (!cost || typeof cost !== 'object') {
    return result;
  }
  for (const [resource, amount] of Object.entries(cost)) {
    const value = Number(amount || 0);
    if (Number.isFinite(value) && value > 0) {
      result[resource] = value;
    }
  }
  return result;
}

// Create a structure instance using config defaults and symbols.
function createStructure(state, config, type, x, y) {
  const structureConfig = (config.structures && config.structures[type]) || {};
  const houseConfig = (config.structures && config.structures.house) || {};
  const symbols = config.symbols || {};

  let symbol = symbols[type] || symbols.structure || '#';
  let capacity = Math.max(1, Number(structureConfig.capacity || 1));
  const id = `${type}_${++state.structureCounter}`;

  const structure = {
    id,
    type,
    symbol,
    capacity,
    x,
    y,
  };

  if (type === 'house') {
    const level = structureConfig.levels ? 1 : null;
    structure.level = level;
    symbol = symbols.house || symbol;
    capacity = getHouseCapacity(houseConfig, level, capacity);
    structure.symbol = symbol;
    structure.capacity = capacity;
  }

  if (type === 'mine' || type === 'sawmill' || type === 'brewery' || type === 'mithril_forge') {
    const levelMax = Math.max(1, Number(structureConfig.levelMax || 1));
    structure.level = Math.min(1, levelMax);
  }

  return structure;
}

// Count queued build jobs for a structure type.
function countQueuedBuildJobs(state, structureType) {
  if (!structureType) {
    return 0;
  }
  const jobs = (state && Array.isArray(state.jobs)) ? state.jobs : [];
  return jobs.filter((job) => job.type === 'build' && job.structureType === structureType).length;
}

// Build a set of reserved upgrade targets.
function buildReservedUpgradeSet(state) {
  const reserved = new Set();
  const jobs = (state && Array.isArray(state.jobs)) ? state.jobs : [];
  for (const job of jobs) {
    if (job.type === 'upgrade' && job.structureId) {
      reserved.add(job.structureId);
    }
  }
  return reserved;
}

// Create a house build job when housing is needed.
function createHouseBuildJob(state, config, runtime, reservedPositions) {
  const housingConfig = (config.population && config.population.housing) || {};
  const houseConfig = (config.structures && config.structures.house) || {};
  const housingNeed = getHousingNeed(state, config);
  if (!housingNeed.needed) {
    return null;
  }

  const minResources = housingConfig.buildMinResources;
  if (minResources && typeof minResources === 'object') {
    for (const [resource, minRatioRaw] of Object.entries(minResources)) {
      const minRatio = Number(minRatioRaw);
      if (!Number.isFinite(minRatio) || minRatio <= 0) {
        continue;
      }
      const ratio = getStockpileRatio(state, config, resource);
      if (ratio < minRatio) {
        return null;
      }
    }
  }

  const buildCost = houseConfig.buildCost || {};
  if (Object.keys(buildCost).length > 0 && !hasInputs(state.stockpile, buildCost)) {
    return null;
  }

  const center = pickVillageCenterForStructure(state, config, runtime, 'house');
  const target = findVillageBuildSpot(state, runtime, reservedPositions, center);
  if (!target) {
    return null;
  }

  if (Object.keys(buildCost).length > 0) {
    consumeInputs(state.stockpile, buildCost);
  }

  const buildTicks = Math.max(1, Number(houseConfig.buildTicks || 40));
  return {
    id: `job_${state.jobCounter++}`,
    type: 'build',
    structureType: 'house',
    target,
    workRemaining: buildTicks,
    dwarfId: null,
    cost: cloneCost(buildCost),
  };
}

// Create a house upgrade job when conditions allow upgrading.
function createHouseUpgradeJob(state, config, runtime, preferUpgrade = false, reservedStructures) {
  const housingNeed = getHousingNeed(state, config);
  if (!housingNeed.needed) {
    return null;
  }

  const houseConfig = (config.structures && config.structures.house) || {};
  const housingConfig = (config.population && config.population.housing) || {};
  const houses = (state.structures || []).filter((structure) => structure.type === 'house');
  if (houses.length === 0) {
    return null;
  }
  const reservedSet = reservedStructures instanceof Set
    ? reservedStructures
    : buildReservedUpgradeSet(state);
  const upgradeMinHouses = Math.max(0, Number(houseConfig.upgradeMinHouses ?? 0));
  if (upgradeMinHouses > 0 && houses.length < upgradeMinHouses) {
    return null;
  }

  const upgradeCoverage = clamp(Number(houseConfig.upgradeMinHousingRatio ?? 0), 0, 1);
  if (upgradeCoverage > 0 && housingNeed.ratio < upgradeCoverage) {
    return null;
  }

  const minHouses = Math.max(0, Number(houseConfig.upgradeMinHouses ?? 0));
  if (minHouses > 0 && houses.length < minHouses) {
    return null;
  }

  const minResources = housingConfig.buildMinResources;
  if (minResources && typeof minResources === 'object') {
    for (const [resource, minRatioRaw] of Object.entries(minResources)) {
      const minRatio = Number(minRatioRaw);
      if (!Number.isFinite(minRatio) || minRatio <= 0) {
        continue;
      }
      const ratio = getStockpileRatio(state, config, resource);
      if (ratio < minRatio) {
        return null;
      }
    }
  }

  const maxLevel = getHouseMaxLevel(houseConfig);
  if (maxLevel <= 1) {
    return null;
  }

  const houseSet = buildHousePositionSet(houses);
  const minAdjacency = Math.max(0, Number(houseConfig.upgradeMinAdjacency ?? 0));
  const candidates = houses
    .map((house) => {
      if (reservedSet.has(house.id)) {
        return null;
      }
      const level = Math.max(1, Number(house.level || 1));
      if (level >= maxLevel) {
        return null;
      }
      const neighbors = countAdjacentHouses(house, houseSet);
      if (minAdjacency > 0 && neighbors < minAdjacency) {
        return null;
      }
      return {
        house,
        level,
        neighbors,
      };
    })
    .filter(Boolean);

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => {
    if (b.level !== a.level) {
      return b.level - a.level;
    }
    return b.neighbors - a.neighbors;
  });

  let best = candidates[0];
  if (best && preferUpgrade && best.level === 1) {
    const higher = candidates.find((candidate) => candidate.level > 1);
    if (higher) {
      best = higher;
    }
  }

  if (!best) {
    return null;
  }

  const levelConfig = getHouseLevelConfig(houseConfig, best.level + 1);
  const buildCost = getHouseUpgradeCost(houseConfig, levelConfig);
  if (Object.keys(buildCost).length > 0 && !hasInputs(state.stockpile, buildCost)) {
    return null;
  }

  const buildTicks = getHouseUpgradeTicks(houseConfig, levelConfig);
  if (Object.keys(buildCost).length > 0) {
    consumeInputs(state.stockpile, buildCost);
  }

  return {
    id: `job_${state.jobCounter++}`,
    type: 'upgrade',
    structureId: best.house.id,
    targetLevel: best.level + 1,
    target: { x: best.house.x, y: best.house.y },
    workRemaining: buildTicks,
    dwarfId: null,
    cost: cloneCost(buildCost),
  };
}

// Resolve a house level configuration entry.
function getHouseLevelConfig(houseConfig, level) {
  const levels = (houseConfig && houseConfig.levels) || {};
  const entry = levels[String(level)];
  return entry && typeof entry === 'object' ? entry : null;
}

// Find the maximum configured house level.
function getHouseMaxLevel(houseConfig) {
  const levels = (houseConfig && houseConfig.levels) || {};
  let maxLevel = 1;
  for (const key of Object.keys(levels)) {
    const value = Number(key);
    if (Number.isFinite(value) && value > maxLevel) {
      maxLevel = value;
    }
  }
  return maxLevel;
}

// Compute house capacity for a given level.
function getHouseCapacity(houseConfig, level, fallback) {
  const levelConfig = getHouseLevelConfig(houseConfig, level);
  const raw = levelConfig && levelConfig.capacity !== undefined
    ? levelConfig.capacity
    : (fallback !== undefined ? fallback : houseConfig.capacity);
  const capacity = Number(raw || 1);
  return Math.max(1, capacity);
}

// Resolve upgrade resource costs for a house level.
function getHouseUpgradeCost(houseConfig, levelConfig) {
  if (levelConfig && levelConfig.upgradeCost) {
    return levelConfig.upgradeCost;
  }
  return houseConfig.buildCost || {};
}

// Resolve upgrade ticks for a house level.
function getHouseUpgradeTicks(houseConfig, levelConfig) {
  const raw = levelConfig && levelConfig.upgradeTicks !== undefined
    ? levelConfig.upgradeTicks
    : houseConfig.buildTicks;
  return Math.max(1, Number(raw || 1));
}

// Build a set of occupied house positions for neighbor checks.
function buildHousePositionSet(houses) {
  const set = new Set();
  for (const house of houses) {
    set.add(`${house.x},${house.y}`);
  }
  return set;
}

// Count adjacent houses around a given house.
function countAdjacentHouses(house, houseSet) {
  let count = 0;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      if (houseSet.has(`${house.x + dx},${house.y + dy}`)) {
        count += 1;
      }
    }
  }
  return count;
}

// Create a well build job if water supply is critical.
function createWellBuildJob(state, config, runtime, reservedPositions) {
  const wellConfig = (config.structures && config.structures.well) || {};
  const placement = getPlacementConfig(wellConfig);
  const maxCount = Number(wellConfig.maxCount ?? 0);
  const existingWells = (state.structures || []).filter((structure) => structure.type === 'well').length;
  const queuedWells = countQueuedBuildJobs(state, 'well');
  if (maxCount > 0 && existingWells + queuedWells >= maxCount) {
    return null;
  }

  const center = pickVillageCenterForStructure(state, config, runtime, 'well');
  const stockRatio = getStockpileRatio(state, config, 'water');
  const criticalThreshold = clamp(Number(wellConfig.criticalStockpileRatio ?? 0), 0, 1);
  const isCritical = stockRatio <= criticalThreshold;
  const terrainWaterDistance = Math.max(0, Number(wellConfig.skipWhenTerrainWaterWithin ?? 0));
  if (terrainWaterDistance > 0 && !isCritical) {
    if (hasTerrainResourceWithin(state, config, 'water', center, terrainWaterDistance)) {
      return null;
    }
  }

  const nodeThreshold = Number(wellConfig.buildWhenNodeRatioBelow ?? 0.4);
  const stockThreshold = Number(wellConfig.buildWhenStockpileRatioBelow ?? 0.6);
  const nodeRatio = getResourceNodeRatio(state, 'water');
  if (nodeRatio >= nodeThreshold && stockRatio >= stockThreshold) {
    return null;
  }

  const buildCost = wellConfig.buildCost || {};
  if (Object.keys(buildCost).length > 0 && !hasInputs(state.stockpile, buildCost)) {
    return null;
  }

  const target = placement.mode === 'poisson'
    ? findPoissonBuildSpot(state, runtime, wellConfig, reservedPositions, {
      structureType: 'well',
      allowForest: shouldAllowForestBuild(state, config),
      center,
    })
    : findPeripheralBuildSpot(state, runtime, wellConfig, reservedPositions, center);
  if (!target) {
    return null;
  }

  if (Object.keys(buildCost).length > 0) {
    consumeInputs(state.stockpile, buildCost);
  }

  const buildTicks = Math.max(1, Number(wellConfig.buildTicks || 35));
  return {
    id: `job_${state.jobCounter++}`,
    type: 'build',
    structureType: 'well',
    target,
    workRemaining: buildTicks,
    dwarfId: null,
    cost: cloneCost(buildCost),
  };
}

// Create a field build job when food nodes are scarce.
function createFieldBuildJob(state, config, runtime, reservedPositions) {
  const fieldConfig = (config.structures && config.structures.field) || {};
  const placement = getPlacementConfig(fieldConfig);
  const maxCount = Number(fieldConfig.maxCount ?? 0);
  const existingFields = (state.structures || []).filter((structure) => structure.type === 'field').length;
  const queuedFields = countQueuedBuildJobs(state, 'field');
  if (maxCount > 0 && existingFields + queuedFields >= maxCount) {
    return null;
  }

  const center = pickVillageCenterForStructure(state, config, runtime, 'field');
  const nodeThreshold = Number(fieldConfig.buildWhenNodeRatioBelow ?? 0.4);
  const stockThreshold = Number(fieldConfig.buildWhenStockpileRatioBelow ?? 0.6);
  const nodeRatio = getResourceNodeRatio(state, 'food');
  const stockRatio = getStockpileRatio(state, config, 'food');
  if (nodeRatio >= nodeThreshold && stockRatio >= stockThreshold) {
    return null;
  }

  const minResources = fieldConfig.buildMinResources;
  if (minResources && typeof minResources === 'object') {
    for (const [resource, minRatioRaw] of Object.entries(minResources)) {
      const minRatio = Number(minRatioRaw);
      if (!Number.isFinite(minRatio) || minRatio <= 0) {
        continue;
      }
      const ratio = getStockpileRatio(state, config, resource);
      if (ratio < minRatio) {
        return null;
      }
    }
  }

  const buildCost = fieldConfig.buildCost || {};
  if (Object.keys(buildCost).length > 0 && !hasInputs(state.stockpile, buildCost)) {
    return null;
  }

  const allowForest = shouldAllowForestBuild(state, config);
  const allowTerrain = allowForest
    ? (innerState, x, y) => isFieldBuildTerrain(innerState, x, y, true)
    : isFieldClusterTerrain;

  const target = placement.mode === 'poisson'
    ? findPoissonBuildSpot(state, runtime, fieldConfig, reservedPositions, {
      structureType: 'field',
      allowTerrain,
      allowForest,
      center,
    })
    : findFertileBuildSpot(state, runtime, fieldConfig, reservedPositions, center);
  if (!target) {
    return null;
  }

  if (Object.keys(buildCost).length > 0) {
    consumeInputs(state.stockpile, buildCost);
  }

  const buildTicks = Math.max(1, Number(fieldConfig.buildTicks || 35));
  return {
    id: `job_${state.jobCounter++}`,
    type: 'build',
    structureType: 'field',
    target,
    workRemaining: buildTicks,
    dwarfId: null,
    cost: cloneCost(buildCost),
  };
}

// Create a workshop build job when no workshop exists.
function createWorkshopBuildJob(state, config, runtime, reservedPositions) {
  const workshopConfig = (config.structures && config.structures.workshop) || {};
  const maxCount = Number(workshopConfig.maxCount ?? 0);
  const existing = (state.structures || []).filter((structure) => structure.type === 'workshop').length;
  const queued = countQueuedBuildJobs(state, 'workshop');
  if (maxCount > 0 && existing + queued >= maxCount) {
    return null;
  }
  if (existing + queued > 0) {
    return null;
  }

  const buildCost = workshopConfig.buildCost || {};
  if (Object.keys(buildCost).length > 0 && !hasInputs(state.stockpile, buildCost)) {
    return null;
  }

  const target = findPeripheralBuildSpot(state, runtime, workshopConfig, reservedPositions);
  if (!target) {
    return null;
  }

  if (Object.keys(buildCost).length > 0) {
    consumeInputs(state.stockpile, buildCost);
  }

  const buildTicks = Math.max(1, Number(workshopConfig.buildTicks || 50));
  return {
    id: `job_${state.jobCounter++}`,
    type: 'build',
    structureType: 'workshop',
    target,
    workRemaining: buildTicks,
    dwarfId: null,
    cost: cloneCost(buildCost),
  };
}

// Create an armory build job when none exists.
function createArmoryBuildJob(state, config, runtime, reservedPositions) {
  const ruinsConfig = (config && config.ruins) || {};
  if (ruinsConfig.enabled === false) {
    return null;
  }
  const armoryConfig = (config.structures && config.structures.armory) || {};
  const maxCount = Number(armoryConfig.maxCount ?? 0);
  const existing = (state.structures || []).filter((structure) => structure.type === 'armory').length;
  const queued = countQueuedBuildJobs(state, 'armory');
  if (maxCount > 0 && existing + queued >= maxCount) {
    return null;
  }
  if (existing + queued > 0) {
    return null;
  }

  const minResources = armoryConfig.buildMinResources;
  if (minResources && typeof minResources === 'object') {
    for (const [resource, minRatioRaw] of Object.entries(minResources)) {
      const minRatio = Number(minRatioRaw);
      if (!Number.isFinite(minRatio) || minRatio <= 0) {
        continue;
      }
      const ratio = getStockpileRatio(state, config, resource);
      if (ratio < minRatio) {
        return null;
      }
    }
  }

  const buildCost = armoryConfig.buildCost || {};
  if (Object.keys(buildCost).length > 0 && !hasInputs(state.stockpile, buildCost)) {
    return null;
  }

  const target = findPeripheralBuildSpot(state, runtime, armoryConfig, reservedPositions);
  if (!target) {
    return null;
  }

  if (Object.keys(buildCost).length > 0) {
    consumeInputs(state.stockpile, buildCost);
  }

  const buildTicks = Math.max(1, Number(armoryConfig.buildTicks || 90));
  return {
    id: `job_${state.jobCounter++}`,
    type: 'build',
    structureType: 'armory',
    target,
    workRemaining: buildTicks,
    dwarfId: null,
    cost: cloneCost(buildCost),
  };
}

// Create a mithril forge build job when none exists.
function createMithrilForgeBuildJob(state, config, runtime, reservedPositions) {
  const forgeConfig = (config.structures && config.structures.mithril_forge) || {};
  const maxCount = Number(forgeConfig.maxCount ?? 0);
  const existing = (state.structures || []).filter((structure) => structure.type === 'mithril_forge').length;
  const queued = countQueuedBuildJobs(state, 'mithril_forge');
  if (maxCount > 0 && existing + queued >= maxCount) {
    return null;
  }
  if (existing + queued > 0) {
    return null;
  }

  const minResources = forgeConfig.buildMinResources;
  if (minResources && typeof minResources === 'object') {
    for (const [resource, minRatioRaw] of Object.entries(minResources)) {
      const minRatio = Number(minRatioRaw);
      if (!Number.isFinite(minRatio) || minRatio <= 0) {
        continue;
      }
      const ratio = getStockpileRatio(state, config, resource);
      if (ratio < minRatio) {
        return null;
      }
    }
  }

  const buildCost = forgeConfig.buildCost || {};
  if (Object.keys(buildCost).length > 0 && !hasInputs(state.stockpile, buildCost)) {
    return null;
  }

  const target = findPeripheralBuildSpot(state, runtime, forgeConfig, reservedPositions);
  if (!target) {
    return null;
  }

  if (Object.keys(buildCost).length > 0) {
    consumeInputs(state.stockpile, buildCost);
  }

  const buildTicks = Math.max(1, Number(forgeConfig.buildTicks || 120));
  return {
    id: `job_${state.jobCounter++}`,
    type: 'build',
    structureType: 'mithril_forge',
    target,
    workRemaining: buildTicks,
    dwarfId: null,
    cost: cloneCost(buildCost),
  };
}

// Create a brewery build job when no brewery exists.
function createBreweryBuildJob(state, config, runtime, reservedPositions) {
  const breweryConfig = (config.structures && config.structures.brewery) || {};
  const maxCount = Number(breweryConfig.maxCount ?? 0);
  const existing = (state.structures || []).filter((structure) => structure.type === 'brewery').length;
  const queued = countQueuedBuildJobs(state, 'brewery');
  if (maxCount > 0 && existing + queued >= maxCount) {
    return null;
  }

  const buildCost = breweryConfig.buildCost || {};
  if (Object.keys(buildCost).length > 0 && !hasInputs(state.stockpile, buildCost)) {
    return null;
  }

  const target = findPeripheralBuildSpot(state, runtime, breweryConfig, reservedPositions);
  if (!target) {
    return null;
  }

  if (Object.keys(buildCost).length > 0) {
    consumeInputs(state.stockpile, buildCost);
  }

  const buildTicks = Math.max(1, Number(breweryConfig.buildTicks || 55));
  return {
    id: `job_${state.jobCounter++}`,
    type: 'build',
    structureType: 'brewery',
    target,
    workRemaining: buildTicks,
    dwarfId: null,
    cost: cloneCost(buildCost),
  };
}

// Create a sawmill build job when wood is scarce.
function createSawmillBuildJob(state, config, runtime, reservedPositions) {
  const sawmillConfig = (config.structures && config.structures.sawmill) || {};
  const maxCount = Number(sawmillConfig.maxCount ?? 0);
  const existing = (state.structures || []).filter((structure) => structure.type === 'sawmill').length;
  const queued = countQueuedBuildJobs(state, 'sawmill');
  if (maxCount > 0 && existing + queued >= maxCount) {
    return null;
  }

  const buildCost = sawmillConfig.buildCost || {};
  if (Object.keys(buildCost).length > 0 && !hasInputs(state.stockpile, buildCost)) {
    return null;
  }

  const target = findPeripheralBuildSpot(state, runtime, sawmillConfig, reservedPositions);
  if (!target) {
    return null;
  }

  if (Object.keys(buildCost).length > 0) {
    consumeInputs(state.stockpile, buildCost);
  }

  const buildTicks = Math.max(1, Number(sawmillConfig.buildTicks || 50));
  return {
    id: `job_${state.jobCounter++}`,
    type: 'build',
    structureType: 'sawmill',
    target,
    workRemaining: buildTicks,
    dwarfId: null,
    cost: cloneCost(buildCost),
  };
}

// Create a mine build job.
function createMineBuildJob(state, config, runtime, reservedPositions) {
  const mineConfig = (config.structures && config.structures.mine) || {};
  const maxCount = Number(mineConfig.maxCount ?? 0);
  const existingMines = (state.structures || []).filter((structure) => structure.type === 'mine').length;
  const queuedMines = countQueuedBuildJobs(state, 'mine');
  if (maxCount > 0 && existingMines + queuedMines >= maxCount) {
    return null;
  }

  const buildWhenNoMine = mineConfig.buildWhenNoMine !== false;
  if (buildWhenNoMine && existingMines + queuedMines > 0) {
    return null;
  }

  const isExtraMine = existingMines + queuedMines > 0;
  const buildCost = (isExtraMine && mineConfig.buildCostExtra) || mineConfig.buildCost || {};
  if (Object.keys(buildCost).length > 0 && !hasInputs(state.stockpile, buildCost)) {
    return null;
  }

  const target = findMineBuildSpot(state, runtime, mineConfig, reservedPositions);
  if (!target) {
    return null;
  }

  if (Object.keys(buildCost).length > 0) {
    consumeInputs(state.stockpile, buildCost);
  }

  const buildTicksRaw = isExtraMine && Number.isFinite(mineConfig.buildTicksExtra)
    ? mineConfig.buildTicksExtra
    : mineConfig.buildTicks;
  const buildTicks = Math.max(1, Number(buildTicksRaw || 55));
  return {
    id: `job_${state.jobCounter++}`,
    type: 'build',
    structureType: 'mine',
    target,
    workRemaining: buildTicks,
    dwarfId: null,
    cost: cloneCost(buildCost),
  };
}

// Resolve cluster configuration for managed structures.
function getClusterConfig(structureConfig) {
  const cluster = (structureConfig && structureConfig.cluster) || {};
  const radius = Math.max(1, Math.floor(Number(cluster.radius ?? 5)));
  const minWallDistance = Math.max(0, Math.floor(Number(cluster.minWallDistance ?? 4)));
  const minSeparation = Math.max(
    0,
    Math.floor(Number(cluster.minSeparation ?? (radius * 2 + 2))),
  );
  const minStructureDistance = Math.max(
    0,
    Math.floor(Number(cluster.minStructureDistance ?? 6)),
  );
  const shape = String(cluster.shape || 'diamond').toLowerCase();
  const width = Math.max(1, Math.floor(Number(cluster.width ?? (radius * 2 + 1))));
  const height = Math.max(1, Math.floor(Number(cluster.height ?? (radius * 2 + 1))));
  const side = String(cluster.side || '').toLowerCase();
  return {
    enabled: cluster.enabled !== false,
    radius,
    minWallDistance,
    minSeparation,
    minStructureDistance,
    shape,
    width,
    height,
    side,
  };
}

// Resolve placement configuration for Poisson sampling.
function getPlacementConfig(structureConfig) {
  const placement = (structureConfig && structureConfig.placement) || {};
  const mode = String(placement.mode || '').toLowerCase();
  const hasMinDistanceFromCenter = Object.prototype.hasOwnProperty.call(
    placement,
    'minDistanceFromCenter',
  );
  const hasMaxDistanceFromCenter = Object.prototype.hasOwnProperty.call(
    placement,
    'maxDistanceFromCenter',
  );
  const minDistanceFromCenter = hasMinDistanceFromCenter
    ? Math.max(0, Math.floor(Number(placement.minDistanceFromCenter ?? 0)))
    : 0;
  const maxDistanceFromCenter = hasMaxDistanceFromCenter
    ? Math.max(0, Math.floor(Number(placement.maxDistanceFromCenter ?? 0)))
    : 0;
  const minDistanceBetween = Math.max(0, Math.floor(Number(placement.minDistanceBetween ?? 0)));
  const minStructureDistance = Math.max(0, Math.floor(Number(placement.minStructureDistance ?? 0)));
  const maxAttempts = Math.max(1, Math.floor(Number(placement.maxAttempts ?? 0)));
  const avoidTerrain = Array.isArray(placement.avoidTerrain)
    ? placement.avoidTerrain.map((entry) => String(entry))
    : [];
  return {
    mode,
    hasMinDistanceFromCenter,
    hasMaxDistanceFromCenter,
    minDistanceFromCenter,
    maxDistanceFromCenter,
    minDistanceBetween,
    minStructureDistance,
    maxAttempts,
    avoidTerrain,
  };
}

// Check whether a placement candidate passes all placement constraints.
function isPlacementCandidate({
  state,
  runtime,
  x,
  y,
  center,
  reservedPositions,
  placement,
  minDistanceFromCenter,
  maxDistanceFromCenter,
  minDistanceBetween,
  minStructureDistance,
  allowTerrain,
  allowForest,
  structurePositions,
  sameTypeStructures,
}) {
  if (!isBuildableCell(state, runtime, x, y)) {
    return false;
  }
  if (isReservedPosition(reservedPositions, x, y)) {
    return false;
  }
  const distFromCenter = Math.abs(center.x - x) + Math.abs(center.y - y);
  if (minDistanceFromCenter > 0 && distFromCenter < minDistanceFromCenter) {
    return false;
  }
  if (maxDistanceFromCenter > 0 && distFromCenter > maxDistanceFromCenter) {
    return false;
  }
  if (!isPlacementTerrainAllowed(state, x, y, placement, allowTerrain, allowForest)) {
    return false;
  }

  const position = { x, y };
  if (minStructureDistance > 0
    && minDistanceToStructures(position, structurePositions) < minStructureDistance) {
    return false;
  }
  if (minDistanceBetween > 0
    && minDistanceToStructures(position, sameTypeStructures) < minDistanceBetween) {
    return false;
  }
  return true;
}

// Find a nearby placement candidate by expanding the search radius.
function findNearbyPlacementCandidate(options, maxRadius) {
  const radiusMax = Math.max(0, Math.floor(Number(maxRadius || 0)));
  if (radiusMax <= 0) {
    return isPlacementCandidate(options) ? { x: options.x, y: options.y } : null;
  }
  const originX = options.x;
  const originY = options.y;
  for (let radius = 0; radius <= radiusMax; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const dy = radius - Math.abs(dx);
      const x1 = originX + dx;
      const y1 = originY + dy;
      if (isPlacementCandidate({ ...options, x: x1, y: y1 })) {
        return { x: x1, y: y1 };
      }
      if (dy !== 0) {
        const x2 = originX + dx;
        const y2 = originY - dy;
        if (isPlacementCandidate({ ...options, x: x2, y: y2 })) {
          return { x: x2, y: y2 };
        }
      }
    }
  }
  return null;
}

// Build a map of structure positions keyed by "x,y".
function buildStructurePositionMap(structures) {
  const map = new Map();
  for (const structure of structures || []) {
    map.set(`${structure.x},${structure.y}`, structure.type);
  }
  return map;
}

// Build a list of structure positions for distance checks.
function buildStructurePositions(structures) {
  const list = [];
  for (const structure of structures || []) {
    if (!structure) {
      continue;
    }
    list.push({
      x: Number(structure.x || 0),
      y: Number(structure.y || 0),
      type: structure.type,
    });
  }
  return list;
}

// Find the minimum Manhattan distance from a position to any structure.
function minDistanceToStructures(position, structures, ignoreTypes) {
  if (!structures || structures.length === 0) {
    return Infinity;
  }
  let minDistance = Infinity;
  for (const structure of structures) {
    if (ignoreTypes && ignoreTypes.has(structure.type)) {
      continue;
    }
    const dist = Math.abs(position.x - structure.x) + Math.abs(position.y - structure.y);
    if (dist < minDistance) {
      minDistance = dist;
      if (minDistance === 0) {
        break;
      }
    }
  }
  return minDistance;
}

// Check whether a terrain tile is allowed for a field cluster.
function isFieldClusterTerrain(state, x, y) {
  const type = getTerrainTypeAt(state, x, y);
  return type === 'fertile' || type === 'plain';
}

function getTerrainCoverageRatio(state, allowedTypes) {
  const terrain = state && state.terrain;
  const types = terrain && terrain.types;
  if (!types || types.length === 0) {
    return 1;
  }
  const height = types.length;
  const width = types[0].length || 0;
  if (width <= 0 || height <= 0) {
    return 1;
  }
  let total = 0;
  let matches = 0;
  for (let y = 0; y < height; y += 1) {
    const row = types[y];
    if (!row) {
      continue;
    }
    for (let x = 0; x < width; x += 1) {
      const type = row[x];
      total += 1;
      if (type && allowedTypes.has(type)) {
        matches += 1;
      }
    }
  }
  if (total <= 0) {
    return 1;
  }
  return matches / total;
}

function shouldAllowForestBuild(state, config) {
  const fieldConfig = (config.structures && config.structures.field) || {};
  const threshold = clamp(Number(fieldConfig.allowForestWhenPlainBelow ?? 0), 0, 1);
  if (threshold <= 0) {
    return false;
  }
  const ratio = getTerrainCoverageRatio(state, new Set(['plain', 'fertile']));
  return ratio < threshold;
}

function isFieldBuildTerrain(state, x, y, allowForest) {
  const type = getTerrainTypeAt(state, x, y);
  if (type === 'fertile' || type === 'plain') {
    return true;
  }
  return Boolean(allowForest && type === 'forest');
}

// Check whether a terrain tile is allowed for Poisson placement.
function isPlacementTerrainAllowed(state, x, y, placement, allowTerrain, allowForest) {
  const type = getTerrainTypeAt(state, x, y);
  const forestOverride = Boolean(allowForest && type === 'forest');
  if (placement && placement.avoidTerrain.length > 0 && type && placement.avoidTerrain.includes(type)) {
    if (!forestOverride) {
      return false;
    }
  }
  if (allowTerrain && !allowTerrain(state, x, y) && !forestOverride) {
    return false;
  }
  return true;
}

// Resolve rectangle bounds from a center.
function getRectBounds(center, width, height, runtime) {
  const halfW = Math.floor(width / 2);
  const halfH = Math.floor(height / 2);
  const minX = clamp(center.x - halfW, 0, runtime.gridWidth - 1);
  const maxX = clamp(center.x + halfW, 0, runtime.gridWidth - 1);
  const minY = clamp(center.y - halfH, 0, runtime.gridHeight - 1);
  const maxY = clamp(center.y + halfH, 0, runtime.gridHeight - 1);
  return { minX, maxX, minY, maxY };
}

// Count available build slots inside a cluster radius.
function countClusterSlots(state, runtime, center, radius, type, allowTerrain, structureMap, nodeSet, shape, width, height) {
  if (shape === 'rect') {
    const bounds = getRectBounds(center, width, height, runtime);
    let count = 0;
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        if (allowTerrain && !allowTerrain(state, x, y)) {
          continue;
        }
        const key = `${x},${y}`;
        const existingType = structureMap.get(key);
        if (existingType) {
          if (existingType === type) {
            count += 1;
          }
          continue;
        }
        if (nodeSet.has(key)) {
          continue;
        }
        if (!isSpawnableTile(state, x, y)) {
          continue;
        }
        count += 1;
      }
    }
    return count;
  }
  let count = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (Math.abs(dx) + Math.abs(dy) > radius) {
        continue;
      }
      const x = center.x + dx;
      const y = center.y + dy;
      if (x < 0 || y < 0 || x >= runtime.gridWidth || y >= runtime.gridHeight) {
        continue;
      }
      if (allowTerrain && !allowTerrain(state, x, y)) {
        continue;
      }
      const key = `${x},${y}`;
      const existingType = structureMap.get(key);
      if (existingType) {
        if (existingType === type) {
          count += 1;
        }
        continue;
      }
      if (nodeSet.has(key)) {
        continue;
      }
      if (!isSpawnableTile(state, x, y)) {
        continue;
      }
      count += 1;
    }
  }
  return count;
}

// Find a buildable spot within a cluster radius.
function findClusterBuildSpot(state, runtime, center, radius, allowTerrain, reservedPositions, shape, width, height) {
  if (shape === 'rect') {
    const bounds = getRectBounds(center, width, height, runtime);
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        if (
          isBuildableCell(state, runtime, x, y)
          && (!allowTerrain || allowTerrain(state, x, y))
          && !isReservedPosition(reservedPositions, x, y)
        ) {
          return { x, y };
        }
      }
    }
    return null;
  }
  for (let ring = 0; ring <= radius; ring += 1) {
    for (let dx = -ring; dx <= ring; dx += 1) {
      const dy = ring - Math.abs(dx);
      const x1 = center.x + dx;
      const y1 = center.y + dy;
      if (
        isBuildableCell(state, runtime, x1, y1)
        && (!allowTerrain || allowTerrain(state, x1, y1))
        && !isReservedPosition(reservedPositions, x1, y1)
      ) {
        return { x: x1, y: y1 };
      }
      if (dy !== 0) {
        const x2 = center.x + dx;
        const y2 = center.y - dy;
        if (
          isBuildableCell(state, runtime, x2, y2)
          && (!allowTerrain || allowTerrain(state, x2, y2))
          && !isReservedPosition(reservedPositions, x2, y2)
        ) {
          return { x: x2, y: y2 };
        }
      }
    }
  }
  return null;
}

// Distance from a point to a rectangle (Manhattan).
function distanceToRect(position, bounds) {
  const dx = position.x < bounds.minX
    ? bounds.minX - position.x
    : position.x > bounds.maxX
      ? position.x - bounds.maxX
      : 0;
  const dy = position.y < bounds.minY
    ? bounds.minY - position.y
    : position.y > bounds.maxY
      ? position.y - bounds.maxY
      : 0;
  return dx + dy;
}

// Pick a fixed cluster center for wells or fields.
function pickClusterCenter(state, runtime, center, type, wallRadius, clusterConfig, otherCenter, allowTerrainOverride) {
  const radius = clusterConfig.radius;
  const minDistance = wallRadius + clusterConfig.minWallDistance + radius;
  const structureList = buildStructurePositions(state.structures || []);
  const structureMap = buildStructurePositionMap(state.structures || []);
  const nodeSet = buildNodePositionSet(state.nodes || []);
  const allowTerrain = allowTerrainOverride || (type === 'field' ? isFieldClusterTerrain : null);
  const ignoreTypes = new Set([type]);
  let best = null;
  let bestScore = -1;
  let bestDistance = -1;
  let bestCenterDist = -1;

  if (clusterConfig.shape === 'rect') {
    const width = clusterConfig.width;
    const height = clusterConfig.height;
    const halfW = Math.floor(width / 2);
    const halfH = Math.floor(height / 2);
    const side = clusterConfig.side || (type === 'well' ? 'right' : 'left');
    const offset = wallRadius + clusterConfig.minWallDistance + halfW + 1;
    let baseX = center.x + (side === 'right' ? offset : -offset);
    baseX = clamp(baseX, halfW, runtime.gridWidth - 1 - halfW);
    const maxOffset = Math.max(runtime.gridHeight, runtime.gridWidth);
    for (let dy = 0; dy <= maxOffset; dy += 1) {
      for (const sign of [0, 1, -1]) {
        if (sign === 0 && dy > 0) {
          continue;
        }
        const candidateY = clamp(center.y + dy * sign, halfH, runtime.gridHeight - 1 - halfH);
        const pos = { x: baseX, y: candidateY };
        if (!isSpawnableTile(state, pos.x, pos.y)) {
          continue;
        }
        if (allowTerrain && !allowTerrain(state, pos.x, pos.y)) {
          continue;
        }
        if (otherCenter) {
          const dist = Math.abs(pos.x - otherCenter.x) + Math.abs(pos.y - otherCenter.y);
          if (dist < clusterConfig.minSeparation) {
            continue;
          }
        }
        const bounds = getRectBounds(pos, width, height, runtime);
        const distToStructures = minDistanceToStructures(pos, structureList, ignoreTypes);
        if (distToStructures < clusterConfig.minStructureDistance + Math.max(halfW, halfH)) {
          continue;
        }
        const slots = countClusterSlots(
          state,
          runtime,
          pos,
          radius,
          type,
          allowTerrain,
          structureMap,
          nodeSet,
          'rect',
          width,
          height,
        );
        if (slots <= 0) {
          continue;
        }
        const rectDist = Math.min(
          distanceToRect(center, bounds),
          Math.abs(pos.x - center.x) + Math.abs(pos.y - center.y),
        );
        const score = slots * 10000 + distToStructures * 10 + rectDist;
        if (
          score > bestScore
          || (score == bestScore && distToStructures > bestDistance)
        ) {
          bestScore = score;
          bestDistance = distToStructures;
          bestCenterDist = rectDist;
          best = pos;
        }
      }
      if (best) {
        break;
      }
    }
    return best;
  }

  for (let y = radius; y < runtime.gridHeight - radius; y += 1) {
    for (let x = radius; x < runtime.gridWidth - radius; x += 1) {
      const pos = { x, y };
      if (!isSpawnableTile(state, x, y)) {
        continue;
      }
      if (allowTerrain && !allowTerrain(state, x, y)) {
        continue;
      }
      const centerDist = Math.abs(x - center.x) + Math.abs(y - center.y);
      if (centerDist < minDistance) {
        continue;
      }
      if (otherCenter) {
        const dist = Math.abs(x - otherCenter.x) + Math.abs(y - otherCenter.y);
        if (dist < clusterConfig.minSeparation) {
          continue;
        }
      }
      const distToStructures = minDistanceToStructures(pos, structureList, ignoreTypes);
      if (distToStructures < radius + clusterConfig.minStructureDistance) {
        continue;
      }
      const slots = countClusterSlots(
        state,
        runtime,
        pos,
        radius,
        type,
        allowTerrain,
        structureMap,
        nodeSet,
        'diamond',
        clusterConfig.width,
        clusterConfig.height,
      );
      if (slots <= 0) {
        continue;
      }
      const score = slots * 10000 + Math.floor(distToStructures) * 10 + centerDist;
      if (
        score > bestScore
        || (score === bestScore && distToStructures > bestDistance)
        || (score === bestScore && distToStructures === bestDistance && centerDist > bestCenterDist)
      ) {
        bestScore = score;
        bestDistance = distToStructures;
        bestCenterDist = centerDist;
        best = pos;
      }
    }
  }

  return best;
}

// Validate whether an existing cluster center is still acceptable.
function isClusterCenterValid(
  state,
  runtime,
  center,
  type,
  wallRadius,
  clusterConfig,
  otherCenter,
  allowTerrainOverride,
  villageCenterOverride,
) {
  if (!center) {
    return false;
  }
  if (center.x < 0 || center.y < 0 || center.x >= runtime.gridWidth || center.y >= runtime.gridHeight) {
    return false;
  }
  if (!isSpawnableTile(state, center.x, center.y)) {
    return false;
  }
  if (type === 'field') {
    const allowTerrain = allowTerrainOverride || isFieldClusterTerrain;
    if (!allowTerrain(state, center.x, center.y)) {
      return false;
    }
  }
  const villageCenter = villageCenterOverride || getVillageCenter(state, runtime);
  const halfW = Math.floor(clusterConfig.width / 2);
  const halfH = Math.floor(clusterConfig.height / 2);
  const minDistance = wallRadius + clusterConfig.minWallDistance + clusterConfig.radius;
  const centerDist = Math.abs(center.x - villageCenter.x)
    + Math.abs(center.y - villageCenter.y);
  if (centerDist < minDistance) {
    return false;
  }
  if (otherCenter) {
    const sep = Math.abs(center.x - otherCenter.x) + Math.abs(center.y - otherCenter.y);
    if (sep < clusterConfig.minSeparation) {
      return false;
    }
  }
  const structureList = buildStructurePositions(state.structures || []);
  const ignoreTypes = new Set([type]);
  if (clusterConfig.shape === 'rect') {
    const bounds = getRectBounds(center, clusterConfig.width, clusterConfig.height, runtime);
    for (const structure of structureList) {
      if (ignoreTypes.has(structure.type)) {
        continue;
      }
      const dist = distanceToRect(structure, bounds);
      if (dist < clusterConfig.minStructureDistance) {
        return false;
      }
    }
    const side = clusterConfig.side || (type === 'well' ? 'right' : 'left');
    const offset = wallRadius + clusterConfig.minWallDistance + halfW + 1;
    const expectedX = clamp(
      villageCenter.x + (side === 'right' ? offset : -offset),
      halfW,
      runtime.gridWidth - 1 - halfW,
    );
    if (Math.abs(center.x - expectedX) > 1) {
      return false;
    }
  } else {
    const distToStructures = minDistanceToStructures(center, structureList, ignoreTypes);
    if (distToStructures < clusterConfig.radius + clusterConfig.minStructureDistance) {
      return false;
    }
  }
  return true;
}

// Resolve fixed cluster centers for wells and fields.
function ensureStructureClusters(state, runtime, config, centerOverride) {
  if (!state.structureClusters) {
    state.structureClusters = {};
  }
  const clusters = state.structureClusters;
  const wellConfig = (config.structures && config.structures.well) || {};
  const fieldConfig = (config.structures && config.structures.field) || {};
  const allowForest = shouldAllowForestBuild(state, config);
  const fieldAllowTerrain = allowForest
    ? (innerState, x, y) => isFieldBuildTerrain(innerState, x, y, true)
    : isFieldClusterTerrain;
  const center = centerOverride || getVillageCenter(state, runtime);
  const wallRadius = 0;

  const wellClusterConfig = getClusterConfig(wellConfig);
  const fieldClusterConfig = getClusterConfig(fieldConfig);
  if (clusters.well && !isClusterCenterValid(
    state,
    runtime,
    clusters.well,
    'well',
    wallRadius,
    wellClusterConfig,
    clusters.field,
    null,
    center,
  )) {
    clusters.well = null;
  }
  if (clusters.field && !isClusterCenterValid(
    state,
    runtime,
    clusters.field,
    'field',
    wallRadius,
    fieldClusterConfig,
    clusters.well,
    fieldAllowTerrain,
    center,
  )) {
    clusters.field = null;
  }

  if (!clusters.well) {
    if (wellClusterConfig.enabled) {
      clusters.well = pickClusterCenter(
        state,
        runtime,
        center,
        'well',
        wallRadius,
        wellClusterConfig,
        clusters.field,
      );
    }
  }
  if (!clusters.field) {
    if (fieldClusterConfig.enabled) {
      clusters.field = pickClusterCenter(
        state,
        runtime,
        center,
        'field',
        wallRadius,
        fieldClusterConfig,
        clusters.well,
        fieldAllowTerrain,
      );
    }
  }
  return clusters;
}

// Resolve hysteresis for manager-driven stockpile thresholds.
function shouldManagerBuild(state, key, ratio, low, high) {
  if (!state.managerBuildFlags) {
    state.managerBuildFlags = {};
  }
  const flags = state.managerBuildFlags;
  const lowClamp = clamp(Number.isFinite(low) ? low : 0, 0, 1);
  const highClamp = clamp(Number.isFinite(high) ? high : lowClamp, 0, 1);
  const min = Math.min(lowClamp, highClamp);
  const max = Math.max(lowClamp, highClamp);
  const current = Boolean(flags[key]);
  if (!current && ratio <= min) {
    flags[key] = true;
  } else if (current && ratio >= max) {
    flags[key] = false;
  }
  return Boolean(flags[key]);
}

// Create a well build job for manager-controlled placement.
function createManagedWellBuildJob(state, config, runtime, reservedPositions) {
  const wellConfig = (config.structures && config.structures.well) || {};
  const placement = getPlacementConfig(wellConfig);
  const manager = (wellConfig && wellConfig.manager) || {};
  if (manager.enabled === false) {
    return null;
  }
  const maxCount = Number(wellConfig.maxCount ?? 0);
  const existingWells = (state.structures || []).filter((structure) => structure.type === 'well').length;
  const queuedWells = countQueuedBuildJobs(state, 'well');
  if (maxCount > 0 && existingWells + queuedWells >= maxCount) {
    return null;
  }

  const stockRatio = getStockpileRatio(state, config, 'water');
  const buildBelow = clamp(Number(manager.buildBelowRatio ?? 0.6), 0, 1);
  const stopAbove = clamp(Number(manager.stopAboveRatio ?? 0.8), 0, 1);
  if (!shouldManagerBuild(state, 'well', stockRatio, buildBelow, stopAbove)) {
    return null;
  }

  const center = pickVillageCenterForStructure(state, config, runtime, 'well');
  const criticalThreshold = clamp(Number(wellConfig.criticalStockpileRatio ?? 0), 0, 1);
  const isCritical = stockRatio <= criticalThreshold;
  const terrainWaterDistance = Math.max(0, Number(wellConfig.skipWhenTerrainWaterWithin ?? 0));
  if (terrainWaterDistance > 0 && !isCritical) {
    if (hasTerrainResourceWithin(state, config, 'water', center, terrainWaterDistance)) {
      return null;
    }
  }

  const buildCost = wellConfig.buildCost || {};
  if (Object.keys(buildCost).length > 0 && !hasInputs(state.stockpile, buildCost)) {
    return null;
  }

  let target = null;
  if (placement.mode === 'poisson') {
    target = findPoissonBuildSpot(state, runtime, wellConfig, reservedPositions, {
      structureType: 'well',
      allowForest: shouldAllowForestBuild(state, config),
      center,
    });
  } else {
    const clusters = ensureStructureClusters(state, runtime, config, center);
    const clusterCenter = clusters && clusters.well;
    if (!clusterCenter) {
      return null;
    }
    const clusterConfig = getClusterConfig(wellConfig);
    const structureMap = buildStructurePositionMap(state.structures || []);
    const nodeSet = buildNodePositionSet(state.nodes || []);
    const clusterSlots = countClusterSlots(
      state,
      runtime,
      clusterCenter,
      clusterConfig.radius,
      'well',
      null,
      structureMap,
      nodeSet,
      clusterConfig.shape,
      clusterConfig.width,
      clusterConfig.height,
    );
    const maxAllowed = maxCount > 0 ? Math.min(maxCount, clusterSlots) : clusterSlots;
    const planned = existingWells + queuedWells;
    if (maxAllowed <= 0 || planned >= maxAllowed) {
      return null;
    }
    target = findClusterBuildSpot(
      state,
      runtime,
      clusterCenter,
      clusterConfig.radius,
      null,
      reservedPositions,
      clusterConfig.shape,
      clusterConfig.width,
      clusterConfig.height,
    );
  }
  if (!target) {
    return null;
  }

  if (Object.keys(buildCost).length > 0) {
    consumeInputs(state.stockpile, buildCost);
  }

  const buildTicks = Math.max(1, Number(wellConfig.buildTicks || 35));
  return {
    id: `job_${state.jobCounter++}`,
    type: 'build',
    structureType: 'well',
    target,
    workRemaining: buildTicks,
    dwarfId: null,
    cost: cloneCost(buildCost),
  };
}

// Create a field build job for manager-controlled placement.
function createManagedFieldBuildJob(state, config, runtime, reservedPositions) {
  const fieldConfig = (config.structures && config.structures.field) || {};
  const placement = getPlacementConfig(fieldConfig);
  const manager = (fieldConfig && fieldConfig.manager) || {};
  if (manager.enabled === false) {
    return null;
  }
  const maxCount = Number(fieldConfig.maxCount ?? 0);
  const existingFields = (state.structures || []).filter((structure) => structure.type === 'field').length;
  const queuedFields = countQueuedBuildJobs(state, 'field');
  if (maxCount > 0 && existingFields + queuedFields >= maxCount) {
    return null;
  }

  const stockRatio = getStockpileRatio(state, config, 'food');
  const buildBelow = clamp(Number(manager.buildBelowRatio ?? 0.45), 0, 1);
  const stopAbove = clamp(Number(manager.stopAboveRatio ?? 0.65), 0, 1);
  if (!shouldManagerBuild(state, 'field', stockRatio, buildBelow, stopAbove)) {
    return null;
  }

  const center = pickVillageCenterForStructure(state, config, runtime, 'field');
  const buildCost = fieldConfig.buildCost || {};
  if (Object.keys(buildCost).length > 0 && !hasInputs(state.stockpile, buildCost)) {
    return null;
  }

  const allowForest = shouldAllowForestBuild(state, config);
  const allowTerrain = allowForest
    ? (innerState, x, y) => isFieldBuildTerrain(innerState, x, y, true)
    : isFieldClusterTerrain;

  let target = null;
  if (placement.mode === 'poisson') {
    target = findPoissonBuildSpot(state, runtime, fieldConfig, reservedPositions, {
      structureType: 'field',
      allowTerrain,
      allowForest,
      center,
    });
  } else {
    const clusters = ensureStructureClusters(state, runtime, config, center);
    const clusterCenter = clusters && clusters.field;
    if (!clusterCenter) {
      return null;
    }
    const clusterConfig = getClusterConfig(fieldConfig);
    const structureMap = buildStructurePositionMap(state.structures || []);
    const nodeSet = buildNodePositionSet(state.nodes || []);
    const clusterSlots = countClusterSlots(
      state,
      runtime,
      clusterCenter,
      clusterConfig.radius,
      'field',
      isFieldClusterTerrain,
      structureMap,
      nodeSet,
      clusterConfig.shape,
      clusterConfig.width,
      clusterConfig.height,
    );
    const maxAllowed = maxCount > 0 ? Math.min(maxCount, clusterSlots) : clusterSlots;
    const planned = existingFields + queuedFields;
    if (maxAllowed <= 0 || planned >= maxAllowed) {
      return null;
    }
    target = findClusterBuildSpot(
      state,
      runtime,
      clusterCenter,
      clusterConfig.radius,
      isFieldClusterTerrain,
      reservedPositions,
      clusterConfig.shape,
      clusterConfig.width,
      clusterConfig.height,
    );
  }
  if (!target) {
    return null;
  }

  if (Object.keys(buildCost).length > 0) {
    consumeInputs(state.stockpile, buildCost);
  }

  const buildTicks = Math.max(1, Number(fieldConfig.buildTicks || 35));
  return {
    id: `job_${state.jobCounter++}`,
    type: 'build',
    structureType: 'field',
    target,
    workRemaining: buildTicks,
    dwarfId: null,
    cost: cloneCost(buildCost),
  };
}

// Check whether a watchtower can be placed on the given terrain type.
function isWatchtowerTerrainAllowed(state, x, y, placement) {
  const type = getTerrainTypeAt(state, x, y);
  if (!type) {
    return true;
  }
  const avoid = placement && Array.isArray(placement.avoidTerrain)
    ? placement.avoidTerrain.map((entry) => String(entry))
    : [];
  return avoid.length === 0 || !avoid.includes(type);
}

// Find a watchtower build spot by sampling the map.
function findWatchtowerBuildSpot(state, runtime, placement, reservedPositions) {
  const width = runtime.gridWidth;
  const height = runtime.gridHeight;
  if (width <= 0 || height <= 0) {
    return null;
  }
  const minDistance = Math.max(0, Math.floor(Number(placement.minDistanceBetween ?? 0)));
  const maxAttempts = Math.max(1, Math.floor(Number(placement.maxAttempts ?? (width * height))));
  const towers = (state.structures || []).filter((structure) => structure.type === 'watchtower');
  let best = null;
  let bestDistance = -1;

  for (let i = 0; i < maxAttempts; i += 1) {
    const x = randomBetween(0, width - 1);
    const y = randomBetween(0, height - 1);
    if (!isBuildableCell(state, runtime, x, y)) {
      continue;
    }
    if (!isWatchtowerTerrainAllowed(state, x, y, placement)) {
      continue;
    }
    if (isReservedPosition(reservedPositions, x, y)) {
      continue;
    }
    let nearest = Infinity;
    for (const tower of towers) {
      const dist = Math.abs(tower.x - x) + Math.abs(tower.y - y);
      if (dist < nearest) {
        nearest = dist;
      }
      if (nearest < minDistance) {
        break;
      }
    }
    if (nearest < minDistance) {
      continue;
    }
    if (nearest > bestDistance) {
      bestDistance = nearest;
      best = { x, y };
    }
  }

  return best;
}

// Create a watchtower build job for manager-controlled placement.
function createManagedWatchtowerBuildJob(state, config, runtime, reservedPositions) {
  const towerConfig = (config.structures && config.structures.watchtower) || {};
  const manager = (towerConfig && towerConfig.manager) || {};
  if (manager.enabled === false) {
    return null;
  }
  const maxCount = Number(towerConfig.maxCount ?? 0);
  const existingTowers = (state.structures || []).filter((structure) => structure.type === 'watchtower').length;
  if (maxCount > 0 && existingTowers >= maxCount) {
    return null;
  }

  const minResources = towerConfig.buildMinResources;
  if (minResources && typeof minResources === 'object') {
    for (const [resource, minRatioRaw] of Object.entries(minResources)) {
      const minRatio = Number(minRatioRaw);
      if (!Number.isFinite(minRatio) || minRatio <= 0) {
        continue;
      }
      const ratio = getStockpileRatio(state, config, resource);
      if (ratio < minRatio) {
        return null;
      }
    }
  }

  const buildCost = towerConfig.buildCost || {};
  if (Object.keys(buildCost).length > 0 && !hasInputs(state.stockpile, buildCost)) {
    return null;
  }

  const placement = towerConfig.placement || {};
  const target = findWatchtowerBuildSpot(state, runtime, placement, reservedPositions);
  if (!target) {
    return null;
  }

  if (Object.keys(buildCost).length > 0) {
    consumeInputs(state.stockpile, buildCost);
  }

  const buildTicks = Math.max(1, Number(towerConfig.buildTicks || 40));
  return {
    id: `job_${state.jobCounter++}`,
    type: 'build',
    structureType: 'watchtower',
    target,
    workRemaining: buildTicks,
    dwarfId: null,
    cost: cloneCost(buildCost),
  };
}

// Find the first available build spot near the village center.
function findVillageBuildSpot(state, runtime, reservedPositions, centerOverride) {
  return findVillageBuildSpotFromRadius(
    state,
    runtime,
    0,
    null,
    reservedPositions,
    centerOverride,
  );
}

// Find a build spot starting from a minimum radius and optional filter.
function findVillageBuildSpotFromRadius(state, runtime, minRadius, extraCheck, reservedPositions, centerOverride) {
  const center = centerOverride || getVillageCenter(state, runtime);
  const maxRadius = getMaxWallRingRadius(center, runtime);
  const startRadius = Math.max(0, Math.floor(minRadius || 0));

  for (let radius = startRadius; radius <= maxRadius; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const dy = radius - Math.abs(dx);
      const x1 = center.x + dx;
      const y1 = center.y + dy;
      if (isBuildableCell(state, runtime, x1, y1)
        && !isReservedPosition(reservedPositions, x1, y1)
        && (!extraCheck || extraCheck(x1, y1))) {
        return { x: x1, y: y1 };
      }
      if (dy !== 0) {
        const x2 = center.x + dx;
        const y2 = center.y - dy;
        if (isBuildableCell(state, runtime, x2, y2)
          && !isReservedPosition(reservedPositions, x2, y2)
          && (!extraCheck || extraCheck(x2, y2))) {
          return { x: x2, y: y2 };
        }
      }
    }
  }

  return null;
}

// Check if a build position is already reserved by another job.
function isReservedPosition(reservedPositions, x, y) {
  if (!reservedPositions || reservedPositions.size === 0) {
    return false;
  }
  return reservedPositions.has(`${x},${y}`);
}

// Compute the maximum ring radius that fits in the grid.
function getMaxWallRingRadius(center, runtime) {
  const maxX = Math.min(center.x, runtime.gridWidth - 1 - center.x);
  const maxY = Math.min(center.y, runtime.gridHeight - 1 - center.y);
  return Math.max(0, Math.min(maxX, maxY));
}

// Compute the outer radius of village structures.
function getVillageOuterRadius(state, runtime, excludeTypes, centerOverride) {
  const center = centerOverride || getVillageCenter(state, runtime);
  let maxDistance = 0;
  for (const structure of state.structures || []) {
    if (excludeTypes && excludeTypes.has(structure.type)) {
      continue;
    }
    const distance = Math.abs(structure.x - center.x) + Math.abs(structure.y - center.y);
    if (distance > maxDistance) {
      maxDistance = distance;
    }
  }
  return { center, radius: maxDistance };
}

// Compute a peripheral build radius for certain structures.
function getPeripheralBuildRadius(state, runtime, structureConfig, centerOverride) {
  const minRadius = Math.max(0, Number(structureConfig.buildMinRadius ?? 0));
  const outerBuffer = Math.max(0, Number(structureConfig.buildOuterBuffer ?? 0));
  const perimeter = getVillageOuterRadius(
    state,
    runtime,
    new Set(['well', 'field']),
    centerOverride,
  );
  const maxRadius = getMaxWallRingRadius(perimeter.center, runtime);
  if (maxRadius <= 0) {
    return 0;
  }
  const desired = Math.max(minRadius, perimeter.radius + outerBuffer);
  return Math.min(desired, maxRadius);
}

// Resolve the terrain types allowed for mine placement.
function getMineTerrainTypes(structureConfig) {
  if (!structureConfig) {
    return null;
  }
  const list = structureConfig.buildTerrain || structureConfig.spawnTerrain || null;
  if (!Array.isArray(list) || list.length === 0) {
    return null;
  }
  return list.map((entry) => String(entry));
}

// Find a build spot using Poisson-style sampling with terrain and spacing checks.
function findPoissonBuildSpot(state, runtime, structureConfig, reservedPositions, options) {
  const placement = getPlacementConfig(structureConfig);
  if (placement.mode !== 'poisson') {
    return null;
  }
  const width = runtime.gridWidth;
  const height = runtime.gridHeight;
  if (width <= 0 || height <= 0) {
    return null;
  }

  const center = getVillageCenter(state, runtime);
  const fallbackMin = getPeripheralBuildRadius(state, runtime, structureConfig, center);
  const minDistanceFromCenter = placement.hasMinDistanceFromCenter
    ? placement.minDistanceFromCenter
    : fallbackMin;
  let maxDistanceFromCenter = placement.hasMaxDistanceFromCenter
    ? placement.maxDistanceFromCenter
    : 0;
  if (maxDistanceFromCenter > 0 && minDistanceFromCenter > 0
    && maxDistanceFromCenter < minDistanceFromCenter) {
    maxDistanceFromCenter = minDistanceFromCenter;
  }
  const minDistanceBetween = placement.minDistanceBetween;
  const minStructureDistance = placement.minStructureDistance;
  const maxAttempts = placement.maxAttempts > 0 ? placement.maxAttempts : width * height;
  const allowTerrain = options && options.allowTerrain ? options.allowTerrain : null;
  const structureType = options && options.structureType ? options.structureType : null;
  const allowForest = Boolean(options && options.allowForest);
  const nearbySearchRadius = Math.max(
    0,
    Math.floor(Number(placement.nearbySearchRadius ?? placement.maxDistanceFromCenter ?? 0)),
  );

  const structurePositions = buildStructurePositions(state.structures || []);
  const sameTypeStructures = structureType
    ? structurePositions.filter((structure) => structure.type === structureType)
    : [];

  let best = null;
  let bestScore = -1;

  for (let i = 0; i < maxAttempts; i += 1) {
    const x = randomBetween(0, width - 1);
    const y = randomBetween(0, height - 1);
    const distFromCenter = Math.abs(center.x - x) + Math.abs(center.y - y);
    if (minDistanceFromCenter > 0 && distFromCenter + nearbySearchRadius < minDistanceFromCenter) {
      continue;
    }
    if (maxDistanceFromCenter > 0 && distFromCenter - nearbySearchRadius > maxDistanceFromCenter) {
      continue;
    }
    const candidate = findNearbyPlacementCandidate({
      state,
      runtime,
      x,
      y,
      center,
      reservedPositions,
      placement,
      minDistanceFromCenter,
      maxDistanceFromCenter,
      minDistanceBetween,
      minStructureDistance,
      allowTerrain,
      allowForest,
      structurePositions,
      sameTypeStructures,
    }, nearbySearchRadius);
    if (!candidate) {
      continue;
    }

    const distanceToSame = minDistanceToStructures(candidate, sameTypeStructures);
    const distanceToAll = minDistanceToStructures(candidate, structurePositions);
    const score = Math.min(distanceToSame, distanceToAll);
    const normalized = Number.isFinite(score) ? score : width + height;
    if (normalized > bestScore) {
      bestScore = normalized;
      best = candidate;
    }
  }

  if (!best) {
    const fallbackMax = maxDistanceFromCenter > 0
      ? Math.min(maxDistanceFromCenter, getMaxWallRingRadius(center, runtime))
      : getMaxWallRingRadius(center, runtime);
    const startRadius = Math.max(0, Math.floor(minDistanceFromCenter || 0));
    for (let radius = startRadius; radius <= fallbackMax; radius += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const dy = radius - Math.abs(dx);
        const x1 = center.x + dx;
        const y1 = center.y + dy;
        if (isPlacementCandidate({
          state,
          runtime,
          x: x1,
          y: y1,
          center,
          reservedPositions,
          placement,
          minDistanceFromCenter,
          maxDistanceFromCenter,
          minDistanceBetween,
          minStructureDistance,
          allowTerrain,
          allowForest,
          structurePositions,
          sameTypeStructures,
        })) {
          return { x: x1, y: y1 };
        }
        if (dy !== 0) {
          const x2 = center.x + dx;
          const y2 = center.y - dy;
          if (isPlacementCandidate({
            state,
            runtime,
            x: x2,
            y: y2,
            center,
            reservedPositions,
            placement,
            minDistanceFromCenter,
            maxDistanceFromCenter,
            minDistanceBetween,
            minStructureDistance,
            allowTerrain,
            allowForest,
            structurePositions,
            sameTypeStructures,
          })) {
            return { x: x2, y: y2 };
          }
        }
      }
    }
  }

  return best;
}

// Find a build spot outside the core village radius.
function findPeripheralBuildSpot(state, runtime, structureConfig, reservedPositions, centerOverride) {
  const minRadius = getPeripheralBuildRadius(state, runtime, structureConfig, centerOverride);
  const spot = findVillageBuildSpotFromRadius(
    state,
    runtime,
    minRadius,
    null,
    reservedPositions,
    centerOverride,
  );
  if (spot) {
    return spot;
  }
  return findVillageBuildSpot(state, runtime, reservedPositions, centerOverride);
}

// Find a fertile build spot for fields.
function findFertileBuildSpot(state, runtime, structureConfig, reservedPositions, centerOverride) {
  const minRadius = getPeripheralBuildRadius(state, runtime, structureConfig, centerOverride);
  return findVillageBuildSpotFromRadius(state, runtime, minRadius, (x, y) => {
    return getTerrainTypeAt(state, x, y) === 'fertile';
  }, reservedPositions, centerOverride);
}

// Find a build spot on mining terrain.
function findMineBuildSpot(state, runtime, structureConfig, reservedPositions, centerOverride) {
  const ignoreRadius = Boolean(structureConfig && structureConfig.ignorePeripheralRadius);
  const minRadius = ignoreRadius
    ? 0
    : getPeripheralBuildRadius(state, runtime, structureConfig, centerOverride);
  const allowed = getMineTerrainTypes(structureConfig);
  return findVillageBuildSpotFromRadius(state, runtime, minRadius, (x, y) => {
    if (!allowed || allowed.length === 0) {
      return true;
    }
    const type = getTerrainTypeAt(state, x, y);
    return type ? allowed.includes(type) : false;
  }, reservedPositions, centerOverride);
}

// Determine the village center from existing structures or terrain.
function getVillageCenter(state, runtime) {
  const edgeBuffer = resolveEdgeBuffer(runtime, state && state.lastConfig);
  if (state && Array.isArray(state.villages) && state.villages.length > 0) {
    const primary = state.villages[0];
    if (primary && primary.center) {
      return clampToEdgeBuffer(
        {
          x: Number(primary.center.x || 0),
          y: Number(primary.center.y || 0),
        },
        runtime,
        edgeBuffer,
      );
    }
  }
  const houses = (state.structures || []).filter((structure) => structure.type === 'house');
  if (houses.length > 0) {
    const sum = houses.reduce((acc, house) => {
      acc.x += Number(house.x || 0);
      acc.y += Number(house.y || 0);
      return acc;
    }, { x: 0, y: 0 });
    return clampToEdgeBuffer({
      x: Math.round(sum.x / houses.length),
      y: Math.round(sum.y / houses.length),
    }, runtime, edgeBuffer);
  }

  const workshops = (state.structures || []).filter((structure) => structure.type === 'workshop');
  if (workshops.length > 0) {
    const workshop = workshops[0];
    return clampToEdgeBuffer({
      x: Number(workshop.x || 0),
      y: Number(workshop.y || 0),
    }, runtime, edgeBuffer);
  }

  if (state.villageCenter && Number.isFinite(state.villageCenter.x) && Number.isFinite(state.villageCenter.y)) {
    return clampToEdgeBuffer({
      x: clamp(state.villageCenter.x, 0, runtime.gridWidth - 1),
      y: clamp(state.villageCenter.y, 0, runtime.gridHeight - 1),
    }, runtime, edgeBuffer);
  }

  const selected = selectVillageCenter(state, runtime, state.lastConfig);
  if (selected) {
    const clamped = clampToEdgeBuffer(selected, runtime, edgeBuffer);
    state.villageCenter = { x: clamped.x, y: clamped.y };
    return clamped;
  }

  const fallback = {
    x: Math.floor(runtime.gridWidth / 2),
    y: Math.floor(runtime.gridHeight / 2),
  };
  const clamped = clampToEdgeBuffer(fallback, runtime, edgeBuffer);
  state.villageCenter = { x: clamped.x, y: clamped.y };
  return clamped;
}

// Resolve all known village centers (at least the primary center).
function getVillageCenters(state, runtime) {
  const edgeBuffer = resolveEdgeBuffer(runtime, state && state.lastConfig);
  if (state && Array.isArray(state.villages) && state.villages.length > 0) {
    return state.villages.map((village) =>
      clampToEdgeBuffer(
        {
          x: Number(village.center && village.center.x || 0),
          y: Number(village.center && village.center.y || 0),
        },
        runtime,
        edgeBuffer,
      ),
    );
  }
  return [getVillageCenter(state, runtime)];
}

// Pick a village center for placing a specific structure type.
function pickVillageCenterForStructure(state, config, runtime, structureType) {
  const centers = getVillageCenters(state, runtime);
  if (centers.length <= 1) {
    return centers[0];
  }
  const villagesConfig = (config && config.villages) || {};
  const expandList =
    Array.isArray(villagesConfig.expandStructures) && villagesConfig.expandStructures.length > 0
      ? villagesConfig.expandStructures.map((value) => String(value))
      : ['house', 'well', 'field'];
  const expandSet = new Set(expandList);
  if (!expandSet.has(String(structureType || ''))) {
    return centers[0];
  }

  const radius = Math.max(
    0,
    Math.floor(Number(villagesConfig.structureRadius ?? 12)),
  );
  if (radius <= 0) {
    if (!state.villageBuildCursor) {
      state.villageBuildCursor = {};
    }
    const cursor = Math.max(0, Number(state.villageBuildCursor[structureType] || 0));
    const index = centers.length > 0 ? cursor % centers.length : 0;
    state.villageBuildCursor[structureType] = index + 1;
    return centers[index] || centers[0];
  }
  const structures = Array.isArray(state.structures) ? state.structures : [];
  let bestIndex = 0;
  let bestCount = Infinity;
  let bestMinDistance = -1;

  for (let i = 0; i < centers.length; i += 1) {
    const center = centers[i];
    let count = 0;
    let minDistance = Infinity;
    for (const structure of structures) {
      if (!structure || structure.type !== structureType) {
        continue;
      }
      const dist = Math.abs(structure.x - center.x) + Math.abs(structure.y - center.y);
      if (dist <= radius) {
        count += 1;
      }
      if (dist < minDistance) {
        minDistance = dist;
      }
    }
    const resolvedMin = Number.isFinite(minDistance) ? minDistance : Infinity;
    if (count < bestCount || (count === bestCount && resolvedMin > bestMinDistance)) {
      bestIndex = i;
      bestCount = count;
      bestMinDistance = resolvedMin;
    }
  }

  return centers[bestIndex] || centers[0];
}

// Select a village center using terrain openness and resource proximity.
function selectVillageCenter(state, runtime, config, options) {
  const terrain = state && state.terrain;
  if (!terrain || !terrain.types) {
    return null;
  }
  const settlement = getSettlementConfig(config);
  if (!settlement.enabled) {
    return null;
  }
  const opts = options && typeof options === 'object' ? options : {};
  const existingCenters = Array.isArray(opts.existingCenters) ? opts.existingCenters : [];
  const minDistanceFromCenters = Math.max(
    0,
    Math.floor(Number(opts.minDistanceFromCenters ?? 0)),
  );
  const requiredResources = Array.isArray(opts.requiredResources)
    ? opts.requiredResources.map((value) => String(value))
    : [];
  const requiredResourceDistance = Math.max(
    0,
    Math.floor(Number(opts.requiredResourceDistance ?? 0)),
  );

  const width = runtime.gridWidth;
  const height = runtime.gridHeight;
  const scanStep = settlement.scanStep;
  const radius = settlement.clearRadius;
  const minOpenRatio = settlement.minOpenRatio;
  const blocked = new Set(settlement.blockedTerrain);
  const edgeBuffer = resolveEdgeBuffer(runtime, config);
  if (shouldAllowForestBuild(state, config)) {
    blocked.delete('forest');
  }
  const resourceWeights = settlement.resourceWeights;
  const resourceCap = settlement.resourceDistanceCap;

  const nodesByResource = buildResourceLookup(state, config);
  const nodePositions = buildNodePositionSet(state.nodes || []);
  const centerFallback = {
    x: Math.floor(width / 2),
    y: Math.floor(height / 2),
  };

  let best = null;
  let bestFallback = null;
  for (let y = 0; y < height; y += scanStep) {
    for (let x = 0; x < width; x += scanStep) {
      if (edgeBuffer > 0) {
        if (x < edgeBuffer || y < edgeBuffer || x > width - 1 - edgeBuffer || y > height - 1 - edgeBuffer) {
          continue;
        }
      }
      if (!isSpawnableTile(state, x, y)) {
        continue;
      }
      const stats = scoreSettlementCandidate(
        state,
        runtime,
        x,
        y,
        radius,
        blocked,
        nodePositions,
      );
      if (!stats || stats.total === 0) {
        continue;
      }
      if (minDistanceFromCenters > 0 && existingCenters.length > 0) {
        let nearest = Infinity;
        for (const center of existingCenters) {
          if (!center) {
            continue;
          }
          const dist = Math.abs(Number(center.x || 0) - x) + Math.abs(Number(center.y || 0) - y);
          if (dist < nearest) {
            nearest = dist;
          }
          if (nearest < minDistanceFromCenters) {
            break;
          }
        }
        if (nearest < minDistanceFromCenters) {
          continue;
        }
      }
      if (requiredResources.length > 0 && requiredResourceDistance > 0) {
        if (!hasRequiredResources(nodesByResource, requiredResources, requiredResourceDistance, x, y)) {
          continue;
        }
      }
      const resourceScore = scoreResourceProximity(
        nodesByResource,
        resourceWeights,
        resourceCap,
        x,
        y,
      );
      const candidate = {
        x,
        y,
        openRatio: stats.openRatio,
        resourceScore,
        centerDistance: Math.abs(centerFallback.x - x) + Math.abs(centerFallback.y - y),
      };

      if (stats.openRatio >= minOpenRatio) {
        if (isBetterSettlementCandidate(candidate, best)) {
          best = candidate;
        }
      } else {
        if (isBetterSettlementCandidate(candidate, bestFallback)) {
          bestFallback = candidate;
        }
      }
    }
  }

  const pick = best || bestFallback;
  if (!pick) {
    return null;
  }
  return { x: pick.x, y: pick.y };
}

// Normalize settlement configuration defaults.
function getSettlementConfig(config) {
  const population = (config && config.population) || {};
  const raw = population.settlement || {};
  const scanStep = clamp(Math.floor(Number(raw.scanStep ?? 3)), 1, 8);
  const clearRadius = clamp(Math.floor(Number(raw.clearRadius ?? 6)), 2, 16);
  const edgeBuffer = clamp(Math.floor(Number(raw.edgeBuffer ?? 2)), 0, 12);
  const minOpenRatio = clamp(Number(raw.minOpenRatio ?? 0.65), 0, 1);
  const resourceDistanceCap = Math.max(5, Number(raw.resourceDistanceCap ?? 40));
  const defaultBlocked = ['river', 'lake', 'mountain', 'forest', 'stone'];
  const blockedTerrain = Array.isArray(raw.blockedTerrain) && raw.blockedTerrain.length > 0
    ? raw.blockedTerrain.map((value) => String(value))
    : defaultBlocked;
  const defaultWeights = {
    food: 1,
    water: 1,
    wood: 0.8,
    stone: 0.6,
  };
  const resourceWeights = { ...defaultWeights };
  if (raw.resourceWeights && typeof raw.resourceWeights === 'object') {
    for (const [key, value] of Object.entries(raw.resourceWeights)) {
      resourceWeights[key] = clamp(Number(value ?? resourceWeights[key] ?? 0), 0, 1);
    }
  }

  return {
    enabled: raw.enabled !== false,
    scanStep,
    clearRadius,
    edgeBuffer,
    minOpenRatio,
    resourceDistanceCap,
    resourceWeights,
    blockedTerrain: new Set(blockedTerrain),
  };
}

// Clamp a point inside the grid using an optional edge buffer.
function clampToEdgeBuffer(point, runtime, edgeBuffer) {
  if (!point || !runtime) {
    return point;
  }
  const maxBufferX = Math.max(0, Math.floor((runtime.gridWidth - 1) / 2));
  const maxBufferY = Math.max(0, Math.floor((runtime.gridHeight - 1) / 2));
  const safeBuffer = clamp(Math.floor(Number(edgeBuffer || 0)), 0, Math.min(maxBufferX, maxBufferY));
  const minX = safeBuffer;
  const minY = safeBuffer;
  const maxX = Math.max(minX, runtime.gridWidth - 1 - safeBuffer);
  const maxY = Math.max(minY, runtime.gridHeight - 1 - safeBuffer);
  return {
    x: clamp(Math.floor(Number(point.x || 0)), minX, maxX),
    y: clamp(Math.floor(Number(point.y || 0)), minY, maxY),
  };
}

// Resolve the effective edge buffer for settlement/center placement.
function resolveEdgeBuffer(runtime, config) {
  const settlement = getSettlementConfig(config);
  return settlement.edgeBuffer;
}

// Build a lookup of resource sources (nodes + terrain tiles when enabled).
function buildResourceLookup(state, config) {
  const lookup = {};
  const nodes = state && Array.isArray(state.nodes) ? state.nodes : [];
  for (const node of nodes) {
    if (!node || !node.id) {
      continue;
    }
    if (!lookup[node.id]) {
      lookup[node.id] = [];
    }
    lookup[node.id].push(node);
  }

  const resources = config && config.resources ? config.resources : {};
  if (resources.useTerrainTiles !== true) {
    return lookup;
  }
  const terrain = state && state.terrain ? state.terrain : null;
  if (!terrain || !Array.isArray(terrain.types)) {
    return lookup;
  }

  const terrainAllowed = resources.terrainAllowed || {};
  const allowedTypes = new Set();
  for (const [resourceId, types] of Object.entries(terrainAllowed)) {
    if (!Array.isArray(types)) {
      continue;
    }
    for (const type of types) {
      allowedTypes.add(String(type));
    }
    if (resourceId === 'water') {
      allowedTypes.add('water');
    }
  }
  if (allowedTypes.size === 0) {
    return lookup;
  }

  const typePositions = buildTerrainTypePositions(terrain.types, allowedTypes);
  const maxSamples = 200;
  for (const [resourceId, types] of Object.entries(terrainAllowed)) {
    if (!Array.isArray(types) || types.length === 0) {
      continue;
    }
    const allowed = types.map((type) => String(type));
    if (resourceId === 'water' && !allowed.includes('water')) {
      allowed.push('water');
    }
    const positions = [];
    for (const type of allowed) {
      const list = typePositions[type];
      if (list && list.length > 0) {
        positions.push(...list);
      }
    }
    if (positions.length === 0) {
      continue;
    }
    const sampled = samplePositions(positions, maxSamples);
    if (!lookup[resourceId]) {
      lookup[resourceId] = [];
    }
    lookup[resourceId].push(...sampled);
  }

  return lookup;
}

// Build a lookup of terrain type positions, limited to allowed types.
function buildTerrainTypePositions(types, allowedTypes) {
  const height = types.length;
  const width = height > 0 ? types[0].length : 0;
  const positions = {};
  for (let y = 0; y < height; y += 1) {
    const row = types[y];
    for (let x = 0; x < width; x += 1) {
      const type = row[x];
      if (!allowedTypes.has(type)) {
        continue;
      }
      if (!positions[type]) {
        positions[type] = [];
      }
      positions[type].push({ x, y });
    }
  }
  return positions;
}

// Sample a list of positions deterministically.
function samplePositions(list, maxSamples) {
  if (list.length <= maxSamples) {
    return list;
  }
  const sampled = [];
  const step = list.length / maxSamples;
  for (let i = 0; i < maxSamples; i += 1) {
    sampled.push(list[Math.floor(i * step)]);
  }
  return sampled;
}

// Build a set of all resource node positions.
function buildNodePositionSet(nodes) {
  const set = new Set();
  for (const node of nodes || []) {
    set.add(`${node.x},${node.y}`);
  }
  return set;
}

// Score an area for openness around a center point.
function scoreSettlementCandidate(state, runtime, centerX, centerY, radius, blocked, nodePositions) {
  const width = runtime.gridWidth;
  const height = runtime.gridHeight;
  let open = 0;
  let total = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dist > radius) {
        continue;
      }
      const x = centerX + dx;
      const y = centerY + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) {
        continue;
      }
      total += 1;
      if (!isSpawnableTile(state, x, y)) {
        continue;
      }
      if (nodePositions && nodePositions.has(`${x},${y}`)) {
        continue;
      }
      const type = getTerrainTypeAt(state, x, y);
      if (type && blocked && blocked.has(type)) {
        continue;
      }
      open += 1;
    }
  }
  if (total <= 0) {
    return null;
  }
  return { openRatio: open / total, open, total };
}

// Score proximity to resources using weighted distance.
function scoreResourceProximity(lookup, weights, cap, x, y) {
  if (!weights || typeof weights !== 'object') {
    return 0;
  }
  let score = 0;
  for (const [resource, weightRaw] of Object.entries(weights)) {
    const weight = clamp(Number(weightRaw ?? 0), 0, 1);
    if (weight <= 0) {
      continue;
    }
    const nodes = lookup[resource];
    if (!Array.isArray(nodes) || nodes.length === 0) {
      continue;
    }
    let best = Infinity;
    for (const node of nodes) {
      const dist = Math.abs(Number(node.x || 0) - x) + Math.abs(Number(node.y || 0) - y);
      if (dist < best) {
        best = dist;
      }
    }
    const normalized = 1 - clamp(best / cap, 0, 1);
    score += normalized * weight;
  }
  return score;
}

// Compute the Manhattan distance to the closest resource source.
function distanceToClosestResource(lookup, resourceId, x, y) {
  if (!lookup || !resourceId) {
    return Infinity;
  }
  const nodes = lookup[resourceId];
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return Infinity;
  }
  let best = Infinity;
  for (const node of nodes) {
    const dist = Math.abs(Number(node.x || 0) - x) + Math.abs(Number(node.y || 0) - y);
    if (dist < best) {
      best = dist;
    }
  }
  return best;
}

// Ensure a candidate is close enough to required resources.
function hasRequiredResources(lookup, requiredResources, maxDistance, x, y) {
  if (!Array.isArray(requiredResources) || requiredResources.length === 0) {
    return true;
  }
  if (maxDistance <= 0) {
    return true;
  }
  for (const resourceId of requiredResources) {
    const dist = distanceToClosestResource(lookup, resourceId, x, y);
    if (!Number.isFinite(dist) || dist > maxDistance) {
      return false;
    }
  }
  return true;
}

// Compare settlement candidates for preference ordering.
function isBetterSettlementCandidate(candidate, currentBest) {
  if (!candidate) {
    return false;
  }
  if (!currentBest) {
    return true;
  }
  if (candidate.openRatio > currentBest.openRatio + 1e-6) {
    return true;
  }
  if (Math.abs(candidate.openRatio - currentBest.openRatio) <= 1e-6) {
    if (candidate.resourceScore > currentBest.resourceScore + 1e-6) {
      return true;
    }
    if (Math.abs(candidate.resourceScore - currentBest.resourceScore) <= 1e-6) {
      if (candidate.centerDistance < currentBest.centerDistance) {
        return true;
      }
    }
  }
  return false;
}

// Check if a cell can be built on considering terrain and occupancy.
function isBuildableCell(state, runtime, x, y) {
  if (x < 0 || y < 0 || x >= runtime.gridWidth || y >= runtime.gridHeight) {
    return false;
  }
  if (!isSpawnableTile(state, x, y)) {
    return false;
  }
  for (const node of state.nodes) {
    if (node.x === x && node.y === y) {
      return false;
    }
  }
  for (const structure of state.structures || []) {
    if (structure.x === x && structure.y === y) {
      return false;
    }
  }
  return true;
}

module.exports = {
  createStructure,
  createHouseBuildJob,
  createHouseUpgradeJob,
  getHouseLevelConfig,
  getHouseMaxLevel,
  getHouseCapacity,
  getHouseUpgradeCost,
  getHouseUpgradeTicks,
  buildHousePositionSet,
  countAdjacentHouses,
  createWellBuildJob,
  createFieldBuildJob,
  createSawmillBuildJob,
  createWorkshopBuildJob,
  createArmoryBuildJob,
  createMithrilForgeBuildJob,
  createBreweryBuildJob,
  createMineBuildJob,
  createManagedWellBuildJob,
  createManagedFieldBuildJob,
  createManagedWatchtowerBuildJob,
  findVillageBuildSpot,
  findVillageBuildSpotFromRadius,
  getMaxWallRingRadius,
  getVillageOuterRadius,
  getPeripheralBuildRadius,
  findPeripheralBuildSpot,
  findFertileBuildSpot,
  findMineBuildSpot,
  getVillageCenter,
  selectVillageCenter,
  getSettlementConfig,
  buildResourceLookup,
  buildNodePositionSet,
  scoreSettlementCandidate,
  scoreResourceProximity,
  isBetterSettlementCandidate,
  isBuildableCell,
};
