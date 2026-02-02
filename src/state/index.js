'use strict';

const { clamp } = require('../utils');
const { pickClanId } = require('../clans');
const {
  createTerrain,
  getTerrainSpawnPredicate,
  getTerrainResourcePredicate,
} = require('./terrain');

// Build the initial simulation state.
function createInitialState(config, runtime) {
  const terrain = createTerrain(config, runtime, null);
  const occupied = new Set();
  const structures = createStructures(config, runtime, occupied, terrain);
  const nodes = createResourceNodes(config, runtime, occupied, terrain);
  const dwarves = createDwarves(config, runtime, occupied, terrain);
  const merchant = createMerchantState(config);
  const merchantStats = createMerchantStats();
  const weather = createWeatherState(config);
  const houseStorage = createHouseStorageState(config);
  const raid = createRaidState(config);
  const raidStats = createRaidStats();
  const tools = createToolsState(config);
  const ruins = createRuinsState(config);
  const myths = createMythsState(config);

  return {
    tick: 0,
    dwarves,
    nodes,
    structures,
    merchant,
    merchantStats,
    weather,
    houseStorage,
    raid,
    raidStats,
    tools,
    ruins,
    myths,
    terrain,
    stockpile: { ...config.resources.stockpile },
    jobs: [],
    jobCounter: 1,
    structureCounter: structures.length,
    nodeCounter: nodes.length,
    lastPriorities: [],
    dwarfCounter: dwarves.length,
    events: [],
    birthsCount: 0,
    deathsCount: 0,
    lastDeathTick: 0,
    endgameArtifactsTick: null,
    cycleStats: {
      count: 0,
      lastTicks: 0,
    },
    endgameDifficulty: 1,
    deathsByCause: {
      starvation: 0,
      oldAge: 0,
      raid: 0,
      ruins: 0,
    },
    reproductionStats: {
      ticks: 0,
      couples: 0,
      fertileAdults: 0,
      pregnancies: 0,
      cooldowns: 0,
      resourceFactorSum: 0,
      crowdingFactorSum: 0,
      moraleFactorSum: 0,
      seasonFactorSum: 0,
      chanceSum: 0,
      attempts: 0,
      successes: 0,
      blockedInfertile: 0,
      blockedPregnant: 0,
      blockedCooldown: 0,
      blockedNoResources: 0,
      blockedNoHousing: 0,
      blockedLowStockpile: 0,
      blockedChance: 0,
    },
  };
}

// Create the initial weather state.
function createWeatherState(config) {
  const weatherConfig = (config && config.weather) || {};
  if (weatherConfig.enabled === false) {
    return null;
  }
  const defaultType = weatherConfig.default || 'clear';
  return {
    type: String(defaultType),
    ticksRemaining: 0,
    duration: 0,
  };
}

// Create the initial house storage state.
function createHouseStorageState(config) {
  const storageConfig = config.structures && config.structures.house
    ? config.structures.house.storage
    : null;
  if (!storageConfig || storageConfig.enabled === false) {
    return null;
  }
  const resources = Array.isArray(storageConfig.resources) ? storageConfig.resources : [];
  const stored = {};
  const capacity = {};
  for (const resource of resources) {
    stored[resource] = 0;
    capacity[resource] = 0;
  }
  return { stored, capacity };
}

// Create the initial raid state.
function createRaidState(config) {
  const raidConfig = (config && config.raids) || {};
  return {
    active: false,
    ticksRemaining: 0,
    duration: Math.max(0, Number(raidConfig.durationTicks || 0)),
    lastSeasonIndex: null,
    beasts: [],
  };
}

// Create a default raid stats record.
function createRaidStats() {
  return {
    count: 0,
    deaths: 0,
    loot: {},
    lastRaidDeaths: 0,
    lastRaidTick: 0,
  };
}

// Create the initial tool level state.
function createToolsState(config) {
  const toolsConfig = config.tools || {};
  const initialLevel = Math.max(1, Math.floor(Number(toolsConfig.initialLevel || 1)));
  const maxLevel = Math.max(1, Math.floor(Number(toolsConfig.maxLevel || 1)));
  return {
    level: Math.min(initialLevel, maxLevel),
    maxLevel,
  };
}

// Create the initial ruins exploration state.
function createRuinsState(config) {
  const ruinsConfig = (config && config.ruins) || {};
  if (ruinsConfig.enabled === false) {
    return null;
  }
  const rooms = Array.isArray(ruinsConfig.rooms) ? ruinsConfig.rooms : [];
  return {
    enabled: true,
    roomsCleared: 0,
    roomCount: rooms.length,
    expeditions: [],
    cooldown: 0,
    artifactsFound: {},
    setCounts: {},
    bonuses: {
      outputMultiplier: 0,
      hazardReduction: 0,
      combatBonus: 0,
      artifactChanceBonus: 0,
      casualtyReduction: 0,
      activeCombos: [],
    },
    stats: {
      started: 0,
      successes: 0,
      failures: 0,
      artifacts: 0,
      lastOutcome: null,
      lastOutcomeTick: 0,
      lastSuccesses: 0,
      lastFailures: 0,
      lastArtifactsFound: 0,
    },
  };
}

// Create the initial myths state.
function createMythsState(config) {
  const mythsConfig = (config && config.myths) || {};
  if (mythsConfig.enabled === false) {
    return null;
  }
  return {
    active: {},
    history: [],
    traditions: {},
    counters: {},
    lastTriggerTicks: {},
    lastProcessed: {},
  };
}

// Create initial structures according to config.
function createStructures(config, runtime, occupied, terrain) {
  const structures = [];
  const structConfig = config.structures || {};
  const symbols = config.symbols || {};
  const isAllowed = getTerrainSpawnPredicate(terrain);

  for (const [type, definition] of Object.entries(structConfig)) {
    const count = Number(definition && definition.count !== undefined ? definition.count : definition);
    if (!Number.isFinite(count) || count <= 0) {
      continue;
    }

    let allowFn = isAllowed;
    const structDefinition = definition && typeof definition === 'object' ? definition : {};
    const terrainTypes = Array.isArray(structDefinition.spawnTerrain || structDefinition.buildTerrain)
      ? (structDefinition.spawnTerrain || structDefinition.buildTerrain)
      : null;
    const terrainPredicate = buildTerrainTypePredicate(terrain, terrainTypes);
    if (terrainPredicate) {
      allowFn = terrainPredicate;
    }

    const positions = createPositions(count, runtime.gridWidth, runtime.gridHeight, occupied, allowFn);
    const isHouse = type === 'house';
    const baseCapacity = definition && definition.capacity !== undefined ? definition.capacity : 1;
    const hasLevels = Boolean(isHouse && definition && typeof definition === 'object' && definition.levels);
    const level = hasLevels ? 1 : null;
    const capacity = isHouse
      ? getHouseCapacity(config, level, baseCapacity)
      : Math.max(1, Number(baseCapacity));
    const symbol = level
      ? String(level)
      : (symbols[type] || (type === 'workshop' ? 'W' : (symbols.structure || '#')));
    const levelMax = isHouse ? null : Math.max(1, Number(definition.levelMax || 1));

    for (let index = 0; index < positions.length; index += 1) {
      const pos = positions[index];
      const structure = {
        id: `${type}_${index + 1}`,
        type,
        symbol,
        capacity,
        x: pos.x,
        y: pos.y,
      };
      if (level) {
        structure.level = level;
      }
    if ((type === 'mine' || type === 'sawmill' || type === 'brewery' || type === 'mithril_forge') && levelMax) {
      structure.level = 1;
    }
      structures.push(structure);
      occupied.add(positionKey(pos.x, pos.y));
    }
  }

  return structures;
}

// Create initial resource nodes based on config.
function createResourceNodes(config, runtime, occupied, terrain) {
  const resources = config.resources || {};
  if (resources.useTerrainTiles === true) {
    return [];
  }
  const nodes = [];
  const nodeConfig = resources.nodes || {};
  const capacityConfig = resources.nodeCapacity || {};
  const defaultCapacity = Number(resources.defaultNodeCapacity || 10);
  const symbols = config.symbols || {};
  const terrainAllowed = resources.terrainAllowed || {};
  let nodeCounter = 1;

  for (const [id, count] of Object.entries(nodeConfig)) {
    const isAllowed = getTerrainResourcePredicate(terrain, terrainAllowed, id);
    const positions = createPositions(count, runtime.gridWidth, runtime.gridHeight, occupied, isAllowed);
    const symbol = symbols[id] || '?';
    const capacity = Math.max(1, Number(capacityConfig[id] || defaultCapacity));

    for (const pos of positions) {
      nodes.push({
        nodeId: `node_${nodeCounter++}`,
        id,
        symbol,
        source: 'natural',
        x: pos.x,
        y: pos.y,
        capacity,
        remaining: capacity,
      });
      occupied.add(positionKey(pos.x, pos.y));
    }

    if (count > 0 && positions.length === 0) {
      const fallback = findFallbackPosition(runtime, occupied, isAllowed);
      if (fallback) {
        nodes.push({
          nodeId: `node_${nodeCounter++}`,
          id,
          symbol,
          source: 'natural',
          x: fallback.x,
          y: fallback.y,
          capacity,
          remaining: capacity,
        });
        occupied.add(positionKey(fallback.x, fallback.y));
      }
    }
  }

  return nodes;
}

// Find the first available position that matches a predicate.
function findFallbackPosition(runtime, occupied, allowFn) {
  const width = runtime.gridWidth;
  const height = runtime.gridHeight;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const key = positionKey(x, y);
      if (occupied.has(key)) {
        continue;
      }
      if (allowFn && !allowFn(x, y)) {
        continue;
      }
      return { x, y };
    }
  }
  return null;
}

// Create initial dwarves using config rules.
function createDwarves(config, runtime, occupied, terrain) {
  const count = Number(config.dwarves.count || 0);
  const positions = createPositions(
    count,
    runtime.gridWidth,
    runtime.gridHeight,
    occupied,
    getTerrainSpawnPredicate(terrain),
  );
  const needsTemplate = config.needs.initial || {};
  const population = config.population || {};
  const aging = population.aging || {};
  const roles = population.roles || {};
  const initialAgeRange = population.initialAgeRange || {};
  const minAge = Number(initialAgeRange.min ?? aging.adultAge ?? 0);
  const maxAge = Number(initialAgeRange.max ?? aging.fertileEnd ?? minAge);

  const dwarves = positions.map((pos, index) => {
    const ageTicks = clamp(randomBetween(minAge, maxAge), 0, Number(aging.maxAge || maxAge || 0));
    const isAdult = ageTicks >= Number(aging.adultAge || 0);
    const role = roles.enabled && isAdult
      ? (Math.random() < clamp(Number(roles.builderRatio ?? 0), 0, 1) ? 'builder' : 'gatherer')
      : null;
    const clanId = pickClanId(config);
    return {
      id: `dwarf_${index + 1}`,
      x: pos.x,
      y: pos.y,
      ageTicks,
      lifeStage: getLifeStage(ageTicks, aging),
      role,
      roleCooldown: 0,
      clanId,
      needs: { ...needsTemplate },
      state: {
        health: 1,
        morale: 1,
        moraleBoostBeer: 0,
        stress: 0,
        fatigue: 0,
      },
      job: null,
      homeId: null,
      partnerId: null,
      bondTargetId: null,
      bondScore: 0,
      fertilityCooldown: 0,
      pregnancy: null,
      starvationTicks: 0,
    };
  });

  const breweryConfig = config.structures && config.structures.brewery;
  const brewmasterCount = Math.max(0, Number(breweryConfig && breweryConfig.brewmasterInitial || 0));
  if (brewmasterCount > 0) {
    let assigned = 0;
    const adultAge = Number(aging.adultAge || 0);
    for (const dwarf of dwarves) {
      if (assigned >= brewmasterCount) {
        break;
      }
      if (Number(dwarf.ageTicks || 0) < adultAge) {
        continue;
      }
      dwarf.role = 'brewmaster';
      dwarf.roleLocked = true;
      assigned += 1;
    }
  }

  return dwarves;
}

// Build a predicate for allowed terrain types.
function buildTerrainTypePredicate(terrain, allowedTypes) {
  if (!terrain || !terrain.types || !Array.isArray(allowedTypes) || allowedTypes.length === 0) {
    return null;
  }
  const allowedSet = new Set(allowedTypes.map((entry) => String(entry)));
  const spawnable = terrain.spawnable;
  return (x, y) => {
    if (spawnable && (!spawnable[y] || !spawnable[y][x])) {
      return false;
    }
    const type = terrain.types[y] ? terrain.types[y][x] : null;
    return type ? allowedSet.has(type) : false;
  };
}

// Create random positions while respecting occupancy and predicates.
function createPositions(count, width, height, occupied, allowFn) {
  if (width <= 0 || height <= 0) {
    return [];
  }

  const max = width * height;
  const available = Math.max(0, max - occupied.size);
  const target = Math.min(Number(count || 0), available);

  if (target <= 0) {
    return [];
  }

  const positions = [];
  let attempts = 0;
  const maxAttempts = Math.max(50, target * 20);

  while (positions.length < target && attempts < maxAttempts) {
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);
    const key = positionKey(x, y);

    if (!occupied.has(key) && (!allowFn || allowFn(x, y))) {
      positions.push({ x, y });
      occupied.add(key);
    }

    attempts += 1;
  }

  return positions;
}

// Build a stable position key for occupancy checks.
function positionKey(x, y) {
  return `${x},${y}`;
}

// Fit all entities to the current runtime grid dimensions.
function fitStateToGrid(state, runtime, config) {
  if (runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return;
  }

  syncTerrainToGrid(state, runtime, config);
  const isAllowed = getTerrainSpawnPredicate(state.terrain);
  const occupied = new Set();

  for (const structure of state.structures || []) {
    placeEntity(structure, occupied, runtime, isAllowed);
  }

  for (const node of state.nodes) {
    placeEntity(node, occupied, runtime, isAllowed);
  }

  if (state.raid && Array.isArray(state.raid.beasts)) {
    for (const beast of state.raid.beasts) {
      placeEntity(beast, occupied, runtime, isAllowed);
    }
  }

  for (const dwarf of state.dwarves) {
    placeEntity(dwarf, occupied, runtime, isAllowed);
  }

  if (state.merchant && state.merchant.phase && state.merchant.phase !== 'idle') {
    clampMerchantState(state.merchant, runtime);
  }
}

// Sync terrain data to the current runtime grid size.
function syncTerrainToGrid(state, runtime, config) {
  if (!config || !config.display) {
    if (state.terrain
        && (state.terrain.width !== runtime.gridWidth || state.terrain.height !== runtime.gridHeight)) {
      state.terrain = null;
    }
    return;
  }

  const terrainConfig = config.display.terrain || {};
  if (terrainConfig.enabled === false) {
    state.terrain = null;
    if (state) {
      state.villageCenter = null;
      state.terrainIndex = null;
    }
    return;
  }

  if (!state.terrain
      || state.terrain.width !== runtime.gridWidth
      || state.terrain.height !== runtime.gridHeight) {
    state.terrain = createTerrain(config, runtime, state.terrain);
    if (state) {
      state.villageCenter = null;
      state.terrainIndex = null;
    }
  }
}

// Clamp an entity into the grid and re-place if occupied.
function placeEntity(entity, occupied, runtime, allowFn) {
  const x = clamp(entity.x, 0, runtime.gridWidth - 1);
  const y = clamp(entity.y, 0, runtime.gridHeight - 1);
  const key = positionKey(x, y);

  if (!occupied.has(key) && (!allowFn || allowFn(x, y))) {
    entity.x = x;
    entity.y = y;
    occupied.add(key);
    return;
  }

  const [pos] = createPositions(1, runtime.gridWidth, runtime.gridHeight, occupied, allowFn);
  if (pos) {
    entity.x = pos.x;
    entity.y = pos.y;
    return;
  }

  entity.x = x;
  entity.y = y;
}

// Clamp merchant positions and targets within the grid.
function clampMerchantState(merchant, runtime) {
  merchant.x = clamp(Number(merchant.x || 0), 0, runtime.gridWidth - 1);
  merchant.y = clamp(Number(merchant.y || 0), 0, runtime.gridHeight - 1);
  if (merchant.target) {
    merchant.target = clampPoint(merchant.target, runtime);
  }
  if (merchant.exitTarget) {
    merchant.exitTarget = clampPoint(merchant.exitTarget, runtime);
  }
}

// Clamp a point into the grid bounds.
function clampPoint(point, runtime) {
  return {
    x: clamp(Number(point.x || 0), 0, runtime.gridWidth - 1),
    y: clamp(Number(point.y || 0), 0, runtime.gridHeight - 1),
  };
}

// Generate a random integer between min and max (inclusive).
function randomBetween(min, max) {
  const low = Number.isFinite(min) ? Number(min) : 0;
  const high = Number.isFinite(max) ? Number(max) : low;
  if (high <= low) {
    return low;
  }
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

// Create the initial merchant state.
function createMerchantState(config) {
  const merchantConfig = config.merchant || {};
  const enabled = merchantConfig.enabled !== false;
  const spawnRange = merchantConfig.spawnRangeTicks || {};
  const minSpawn = Number(spawnRange.min ?? 200);
  const maxSpawn = Number(spawnRange.max ?? minSpawn);
  const nextSpawnTick = enabled ? randomBetween(minSpawn, maxSpawn) : Number.POSITIVE_INFINITY;

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
    nextSpawnTick,
  };
}

// Create initial merchant stats counters.
function createMerchantStats() {
  return {
    ticks: 0,
    trades: 0,
    given: {},
    received: {},
  };
}

// Resolve life stage from age ticks.
function getLifeStage(ageTicks, aging) {
  const adultAge = Number(aging.adultAge || 0);
  const oldAgeStart = Number(aging.oldAgeStart || Infinity);
  if (ageTicks < adultAge) {
    return 'child';
  }
  if (ageTicks >= oldAgeStart) {
    return 'elder';
  }
  return 'adult';
}

module.exports = { createInitialState, fitStateToGrid };
