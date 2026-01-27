'use strict';

const { clamp } = require('./utils');

function createInitialState(config, runtime) {
  const occupied = new Set();
  const structures = createStructures(config, runtime, occupied);
  const nodes = createResourceNodes(config, runtime, occupied);
  const dwarves = createDwarves(config, runtime, occupied);
  const merchant = createMerchantState(config);
  const merchantStats = createMerchantStats();
  const weather = createWeatherState(config);
  const houseStorage = createHouseStorageState(config);
  const raid = createRaidState(config);
  const raidStats = createRaidStats();

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
    deathsByCause: {
      starvation: 0,
      oldAge: 0,
      raid: 0,
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
      blockedChance: 0,
    },
  };
}

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

function createRaidStats() {
  return {
    count: 0,
    deaths: 0,
    loot: {},
  };
}

function createStructures(config, runtime, occupied) {
  const structures = [];
  const structConfig = config.structures || {};
  const symbols = config.symbols || {};

  for (const [type, definition] of Object.entries(structConfig)) {
    const count = Number(definition && definition.count !== undefined ? definition.count : definition);
    if (!Number.isFinite(count) || count <= 0) {
      continue;
    }

    const positions = createPositions(count, runtime.gridWidth, runtime.gridHeight, occupied);
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
      structures.push(structure);
      occupied.add(positionKey(pos.x, pos.y));
    }
  }

  return structures;
}

function createResourceNodes(config, runtime, occupied) {
  const nodes = [];
  const nodeConfig = config.resources.nodes || {};
  const capacityConfig = config.resources.nodeCapacity || {};
  const defaultCapacity = Number(config.resources.defaultNodeCapacity || 10);
  const symbols = config.symbols || {};
  let nodeCounter = 1;

  for (const [id, count] of Object.entries(nodeConfig)) {
    const positions = createPositions(count, runtime.gridWidth, runtime.gridHeight, occupied);
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
  }

  return nodes;
}

function createDwarves(config, runtime, occupied) {
  const count = Number(config.dwarves.count || 0);
  const positions = createPositions(count, runtime.gridWidth, runtime.gridHeight, occupied);
  const needsTemplate = config.needs.initial || {};
  const population = config.population || {};
  const aging = population.aging || {};
  const initialAgeRange = population.initialAgeRange || {};
  const minAge = Number(initialAgeRange.min ?? aging.adultAge ?? 0);
  const maxAge = Number(initialAgeRange.max ?? aging.fertileEnd ?? minAge);

  return positions.map((pos, index) => {
    const ageTicks = clamp(randomBetween(minAge, maxAge), 0, Number(aging.maxAge || maxAge || 0));
    return {
      id: `dwarf_${index + 1}`,
      x: pos.x,
      y: pos.y,
      ageTicks,
      lifeStage: getLifeStage(ageTicks, aging),
      needs: { ...needsTemplate },
      state: {
        health: 1,
        morale: 1,
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
}

function createPositions(count, width, height, occupied) {
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

    if (!occupied.has(key)) {
      positions.push({ x, y });
      occupied.add(key);
    }

    attempts += 1;
  }

  return positions;
}

function positionKey(x, y) {
  return `${x},${y}`;
}

function fitStateToGrid(state, runtime) {
  if (runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return;
  }

  const occupied = new Set();

  for (const structure of state.structures || []) {
    placeEntity(structure, occupied, runtime);
  }

  for (const node of state.nodes) {
    placeEntity(node, occupied, runtime);
  }

  if (state.raid && Array.isArray(state.raid.beasts)) {
    for (const beast of state.raid.beasts) {
      placeEntity(beast, occupied, runtime);
    }
  }

  for (const dwarf of state.dwarves) {
    placeEntity(dwarf, occupied, runtime);
  }

  if (state.merchant && state.merchant.phase && state.merchant.phase !== 'idle') {
    clampMerchantState(state.merchant, runtime);
  }
}

function placeEntity(entity, occupied, runtime) {
  const x = clamp(entity.x, 0, runtime.gridWidth - 1);
  const y = clamp(entity.y, 0, runtime.gridHeight - 1);
  const key = positionKey(x, y);

  if (!occupied.has(key)) {
    entity.x = x;
    entity.y = y;
    occupied.add(key);
    return;
  }

  const [pos] = createPositions(1, runtime.gridWidth, runtime.gridHeight, occupied);
  if (pos) {
    entity.x = pos.x;
    entity.y = pos.y;
    return;
  }

  entity.x = x;
  entity.y = y;
}

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

function clampPoint(point, runtime) {
  return {
    x: clamp(Number(point.x || 0), 0, runtime.gridWidth - 1),
    y: clamp(Number(point.y || 0), 0, runtime.gridHeight - 1),
  };
}

function randomBetween(min, max) {
  const low = Number.isFinite(min) ? Number(min) : 0;
  const high = Number.isFinite(max) ? Number(max) : low;
  if (high <= low) {
    return low;
  }
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

function getHouseCapacity(config, level, fallback) {
  const houseConfig = (config.structures && config.structures.house) || {};
  const levels = houseConfig.levels || {};
  const levelConfig = levels[String(level)] || {};
  const raw = levelConfig.capacity !== undefined ? levelConfig.capacity : fallback;
  const capacity = Number(raw || houseConfig.capacity || fallback || 1);
  return Math.max(1, capacity);
}

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

function createMerchantStats() {
  return {
    ticks: 0,
    trades: 0,
    given: {},
    received: {},
  };
}

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
