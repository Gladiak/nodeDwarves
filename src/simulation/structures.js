'use strict';

const { clamp } = require('../utils');
const {
  getTerrainTypeAt,
  hasTerrainResourceWithin,
  isSpawnableTile,
} = require('./terrain');
const {
  getResourceNodeRatio,
  getStockpileRatio,
  hasInputs,
  consumeInputs,
} = require('./resources');
const { getHousingNeed, getHousingStats } = require('./population');
const { isRaidSeasonEligible } = require('./raids');

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
    symbol = level ? String(level) : (symbols.house || symbol);
    capacity = getHouseCapacity(houseConfig, level, capacity);
    structure.symbol = symbol;
    structure.capacity = capacity;
  }

  return structure;
}

// Create a house build job when housing is needed.
function createHouseBuildJob(state, config, runtime) {
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

  const target = findVillageBuildSpot(state, runtime);
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
  };
}

// Create a house upgrade job when conditions allow upgrading.
function createHouseUpgradeJob(state, config, runtime, preferUpgrade = false) {
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

  const minHousingRatio = Number(
    houseConfig.upgradeMinHousingRatio ?? housingConfig.buildTargetRatio ?? 1,
  );
  if (minHousingRatio > 0 && !preferUpgrade) {
    const housing = getHousingStats(state, config);
    if (housing.ratio < minHousingRatio) {
      return null;
    }
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
  const candidates = houses
    .map((house) => {
      const level = Math.max(1, Number(house.level || 1));
      if (level >= maxLevel) {
        return null;
      }
      return {
        house,
        level,
        neighbors: countAdjacentHouses(house, houseSet),
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
function createWellBuildJob(state, config, runtime) {
  const wellConfig = (config.structures && config.structures.well) || {};
  const maxCount = Number(wellConfig.maxCount ?? 0);
  const existingWells = (state.structures || []).filter((structure) => structure.type === 'well').length;
  if (maxCount > 0 && existingWells >= maxCount) {
    return null;
  }

  const stockRatio = getStockpileRatio(state, config, 'water');
  const criticalThreshold = clamp(Number(wellConfig.criticalStockpileRatio ?? 0), 0, 1);
  const isCritical = stockRatio <= criticalThreshold;
  const terrainWaterDistance = Math.max(0, Number(wellConfig.skipWhenTerrainWaterWithin ?? 0));
  if (terrainWaterDistance > 0 && !isCritical) {
    const villageCenter = getVillageCenter(state, runtime);
    if (hasTerrainResourceWithin(state, config, 'water', villageCenter, terrainWaterDistance)) {
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

  const target = findPeripheralBuildSpot(state, runtime, wellConfig);
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
  };
}

// Create a field build job when food nodes are scarce.
function createFieldBuildJob(state, config, runtime) {
  const fieldConfig = (config.structures && config.structures.field) || {};
  const maxCount = Number(fieldConfig.maxCount ?? 0);
  const existingFields = (state.structures || []).filter((structure) => structure.type === 'field').length;
  if (maxCount > 0 && existingFields >= maxCount) {
    return null;
  }

  const nodeThreshold = Number(fieldConfig.buildWhenNodeRatioBelow ?? 0.4);
  const stockThreshold = Number(fieldConfig.buildWhenStockpileRatioBelow ?? 0.6);
  const nodeRatio = getResourceNodeRatio(state, 'food_raw');
  const stockRatio = getStockpileRatio(state, config, 'food_raw');
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

  const target = findFertileBuildSpot(state, runtime, fieldConfig);
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
  };
}

// Create a wall build job when raid eligibility conditions are met.
function createWallBuildJob(state, config, runtime) {
  const wallConfig = (config.structures && config.structures.wall) || {};
  const maxCount = Number(wallConfig.maxCount ?? 0);
  if (maxCount <= 0) {
    return null;
  }
  const targetRatio = Number(wallConfig.buildTargetRatio ?? 0);
  if (targetRatio <= 0) {
    return null;
  }
  const existingWalls = (state.structures || []).filter((structure) => structure.type === 'wall').length;
  if (existingWalls >= maxCount) {
    return null;
  }

  if (wallConfig.buildWhenRaidEligible === true && !isRaidSeasonEligible(state, config)) {
    return null;
  }

  const minHousingRatio = Number(wallConfig.buildMinHousingRatio ?? 0);
  if (minHousingRatio > 0) {
    const housing = getHousingStats(state, config);
    if (housing.ratio < minHousingRatio) {
      return null;
    }
  }

  const minResources = wallConfig.buildMinResources;
  if (minResources && typeof minResources === 'object') {
    for (const [resource, minRatioRaw] of Object.entries(minResources)) {
      const minRatio = Number(minRatioRaw);
      if (!Number.isFinite(minRatio) || minRatio <= 0) {
        continue;
      }
      const ratioValue = getStockpileRatio(state, config, resource);
      if (ratioValue < minRatio) {
        return null;
      }
    }
  }

  const buildCost = wallConfig.buildCost || {};
  if (Object.keys(buildCost).length > 0 && !hasInputs(state.stockpile, buildCost)) {
    return null;
  }

  const target = findWallBuildSpot(state, runtime, wallConfig);
  if (!target) {
    return null;
  }

  if (Object.keys(buildCost).length > 0) {
    consumeInputs(state.stockpile, buildCost);
  }

  const buildTicks = Math.max(1, Number(wallConfig.buildTicks || 50));
  return {
    id: `job_${state.jobCounter++}`,
    type: 'build',
    structureType: 'wall',
    target,
    workRemaining: buildTicks,
    dwarfId: null,
  };
}

// Find the first available build spot near the village center.
function findVillageBuildSpot(state, runtime) {
  return findVillageBuildSpotFromRadius(state, runtime, 0);
}

// Find a build spot starting from a minimum radius and optional filter.
function findVillageBuildSpotFromRadius(state, runtime, minRadius, extraCheck) {
  const center = getVillageCenter(state, runtime);
  const maxRadius = getMaxWallRingRadius(center, runtime);
  const startRadius = Math.max(0, Math.floor(minRadius || 0));

  for (let radius = startRadius; radius <= maxRadius; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const dy = radius - Math.abs(dx);
      const x1 = center.x + dx;
      const y1 = center.y + dy;
      if (isBuildableCell(state, runtime, x1, y1) && (!extraCheck || extraCheck(x1, y1))) {
        return { x: x1, y: y1 };
      }
      if (dy !== 0) {
        const x2 = center.x + dx;
        const y2 = center.y - dy;
        if (isBuildableCell(state, runtime, x2, y2) && (!extraCheck || extraCheck(x2, y2))) {
          return { x: x2, y: y2 };
        }
      }
    }
  }

  return null;
}

// Compute the radius to place a defensive wall ring.
function getWallBuildRadius(state, runtime, wallConfig) {
  const baseRadius = Math.max(0, Number(wallConfig && wallConfig.buildRadius || 0));
  const buffer = Math.max(0, Number(wallConfig && wallConfig.buildInnerBuffer || 0));
  const perimeter = getVillageOuterRadius(state, runtime, new Set(['wall', 'well', 'field']));
  const required = perimeter.radius + buffer;
  const startRadius = Math.max(baseRadius, required);
  const maxRadius = getMaxWallRingRadius(perimeter.center, runtime);
  if (startRadius <= 0 || maxRadius <= 0 || startRadius > maxRadius) {
    return 0;
  }
  const obstacles = getWallRingObstacles(state);
  for (let radius = startRadius; radius <= maxRadius; radius += 1) {
    if (isWallRingClear(perimeter.center, radius, runtime, obstacles)) {
      return radius;
    }
  }
  return 0;
}

// Find a buildable spot on the wall ring.
function findWallBuildSpot(state, runtime, wallConfig) {
  const radius = getWallBuildRadius(state, runtime, wallConfig);
  if (radius <= 0) {
    return null;
  }
  const center = getVillageCenter(state, runtime);
  for (let dx = -radius; dx <= radius; dx += 1) {
    const dy = radius - Math.abs(dx);
    const x1 = center.x + dx;
    const y1 = center.y + dy;
    if (isBuildableCell(state, runtime, x1, y1)) {
      return { x: x1, y: y1 };
    }
    if (dy !== 0) {
      const x2 = center.x + dx;
      const y2 = center.y - dy;
      if (isBuildableCell(state, runtime, x2, y2)) {
        return { x: x2, y: y2 };
      }
    }
  }
  return null;
}

// Compute the maximum ring radius that fits in the grid.
function getMaxWallRingRadius(center, runtime) {
  const maxX = Math.min(center.x, runtime.gridWidth - 1 - center.x);
  const maxY = Math.min(center.y, runtime.gridHeight - 1 - center.y);
  return Math.max(0, Math.min(maxX, maxY));
}

// Compute the outer radius of village structures.
function getVillageOuterRadius(state, runtime, excludeTypes) {
  const center = getVillageCenter(state, runtime);
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
function getPeripheralBuildRadius(state, runtime, structureConfig) {
  const minRadius = Math.max(0, Number(structureConfig.buildMinRadius ?? 0));
  const outerBuffer = Math.max(0, Number(structureConfig.buildOuterBuffer ?? 0));
  const perimeter = getVillageOuterRadius(state, runtime, new Set(['well', 'field']));
  const maxRadius = getMaxWallRingRadius(perimeter.center, runtime);
  if (maxRadius <= 0) {
    return 0;
  }
  const desired = Math.max(minRadius, perimeter.radius + outerBuffer);
  return Math.min(desired, maxRadius);
}

// Find a build spot outside the core village radius.
function findPeripheralBuildSpot(state, runtime, structureConfig) {
  const minRadius = getPeripheralBuildRadius(state, runtime, structureConfig);
  return findVillageBuildSpotFromRadius(state, runtime, minRadius);
}

// Find a fertile build spot for fields.
function findFertileBuildSpot(state, runtime, structureConfig) {
  const minRadius = getPeripheralBuildRadius(state, runtime, structureConfig);
  return findVillageBuildSpotFromRadius(state, runtime, minRadius, (x, y) => {
    return getTerrainTypeAt(state, x, y) === 'fertile';
  });
}

// Collect obstacles that prevent wall placement.
function getWallRingObstacles(state) {
  const obstacles = new Set();
  const nodeObstacles = new Set(['wood', 'water']);
  const structureObstacles = new Set(['well', 'field']);

  for (const node of state.nodes || []) {
    if (nodeObstacles.has(node.id)) {
      obstacles.add(`${node.x},${node.y}`);
    }
  }

  for (const structure of state.structures || []) {
    if (structure.type === 'wall') {
      continue;
    }
    if (structureObstacles.has(structure.type)) {
      obstacles.add(`${structure.x},${structure.y}`);
    }
  }

  return obstacles;
}

// Validate that a wall ring is clear of obstacles.
function isWallRingClear(center, radius, runtime, obstacles) {
  if (radius <= 0) {
    return false;
  }
  if (
    center.x - radius < 0
    || center.y - radius < 0
    || center.x + radius >= runtime.gridWidth
    || center.y + radius >= runtime.gridHeight
  ) {
    return false;
  }
  for (let dx = -radius; dx <= radius; dx += 1) {
    const dy = radius - Math.abs(dx);
    const x1 = center.x + dx;
    const y1 = center.y + dy;
    if (obstacles.has(`${x1},${y1}`)) {
      return false;
    }
    if (dy !== 0) {
      const x2 = center.x + dx;
      const y2 = center.y - dy;
      if (obstacles.has(`${x2},${y2}`)) {
        return false;
      }
    }
  }
  return true;
}

// Determine the village center from existing structures or terrain.
function getVillageCenter(state, runtime) {
  const houses = (state.structures || []).filter((structure) => structure.type === 'house');
  if (houses.length > 0) {
    const sum = houses.reduce((acc, house) => {
      acc.x += Number(house.x || 0);
      acc.y += Number(house.y || 0);
      return acc;
    }, { x: 0, y: 0 });
    return {
      x: Math.round(sum.x / houses.length),
      y: Math.round(sum.y / houses.length),
    };
  }

  const workshops = (state.structures || []).filter((structure) => structure.type === 'workshop');
  if (workshops.length > 0) {
    const workshop = workshops[0];
    return { x: Number(workshop.x || 0), y: Number(workshop.y || 0) };
  }

  if (state.villageCenter && Number.isFinite(state.villageCenter.x) && Number.isFinite(state.villageCenter.y)) {
    return {
      x: clamp(state.villageCenter.x, 0, runtime.gridWidth - 1),
      y: clamp(state.villageCenter.y, 0, runtime.gridHeight - 1),
    };
  }

  const selected = selectVillageCenter(state, runtime, state.lastConfig);
  if (selected) {
    state.villageCenter = { x: selected.x, y: selected.y };
    return selected;
  }

  const fallback = {
    x: Math.floor(runtime.gridWidth / 2),
    y: Math.floor(runtime.gridHeight / 2),
  };
  state.villageCenter = { x: fallback.x, y: fallback.y };
  return fallback;
}

// Select a village center using terrain openness and resource proximity.
function selectVillageCenter(state, runtime, config) {
  const terrain = state && state.terrain;
  if (!terrain || !terrain.types) {
    return null;
  }
  const settlement = getSettlementConfig(config);
  if (!settlement.enabled) {
    return null;
  }

  const width = runtime.gridWidth;
  const height = runtime.gridHeight;
  const scanStep = settlement.scanStep;
  const radius = settlement.clearRadius;
  const minOpenRatio = settlement.minOpenRatio;
  const blocked = settlement.blockedTerrain;
  const resourceWeights = settlement.resourceWeights;
  const resourceCap = settlement.resourceDistanceCap;

  const nodesByResource = buildResourceLookup(state.nodes || []);
  const nodePositions = buildNodePositionSet(state.nodes || []);
  const centerFallback = {
    x: Math.floor(width / 2),
    y: Math.floor(height / 2),
  };

  let best = null;
  let bestFallback = null;
  for (let y = 0; y < height; y += scanStep) {
    for (let x = 0; x < width; x += scanStep) {
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
  const minOpenRatio = clamp(Number(raw.minOpenRatio ?? 0.65), 0, 1);
  const resourceDistanceCap = Math.max(5, Number(raw.resourceDistanceCap ?? 40));
  const defaultBlocked = ['river', 'lake', 'mountain', 'forest', 'stone'];
  const blockedTerrain = Array.isArray(raw.blockedTerrain) && raw.blockedTerrain.length > 0
    ? raw.blockedTerrain.map((value) => String(value))
    : defaultBlocked;
  const defaultWeights = {
    food_raw: 1,
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
    minOpenRatio,
    resourceDistanceCap,
    resourceWeights,
    blockedTerrain: new Set(blockedTerrain),
  };
}

// Build a lookup of nodes keyed by resource id.
function buildResourceLookup(nodes) {
  const lookup = {};
  for (const node of nodes || []) {
    if (!node || !node.id) {
      continue;
    }
    if (!lookup[node.id]) {
      lookup[node.id] = [];
    }
    lookup[node.id].push(node);
  }
  return lookup;
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
  createWallBuildJob,
  findVillageBuildSpot,
  findVillageBuildSpotFromRadius,
  getWallBuildRadius,
  findWallBuildSpot,
  getMaxWallRingRadius,
  getVillageOuterRadius,
  getPeripheralBuildRadius,
  findPeripheralBuildSpot,
  findFertileBuildSpot,
  getWallRingObstacles,
  isWallRingClear,
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
