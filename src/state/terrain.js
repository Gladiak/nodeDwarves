'use strict';

const { clamp } = require('../utils');

// Function: createTerrain.
function createTerrain(config, runtime, previousTerrain) {
  const display = (config && config.display) || {};
  const terrainConfig = display.terrain || {};
  if (terrainConfig.enabled === false) {
    return null;
  }

  const width = Math.max(0, Number(runtime.gridWidth || 0));
  const height = Math.max(0, Number(runtime.gridHeight || 0));
  if (width <= 0 || height <= 0) {
    return null;
  }

  const settings = normalizeTerrainSettings(terrainConfig);
  const seed = resolveTerrainSeed(settings.seed, previousTerrain, runtime);
  if (settings.mode === 'valley') {
    return createValleyTerrain(runtime, settings, seed);
  }
  return createCoastTerrain(runtime, settings, seed);
}

// Function: createCoastTerrain.
function createCoastTerrain(runtime, settings, seed) {
  const width = Math.max(0, Number(runtime.gridWidth || 0));
  const height = Math.max(0, Number(runtime.gridHeight || 0));
  const types = Array.from({ length: height }, () => new Array(width));
  const widthDenom = Math.max(1, width - 1);
  const heightDenom = Math.max(1, height - 1);
  const aspect = height > 0 ? width / height : 1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = x * settings.scale;
      const ny = y * settings.scale;
      let value = fractalNoise(nx, ny, seed, settings.octaves, settings.persistence, settings.lacunarity);

      if (settings.island.enabled) {
        const dx = ((x / widthDenom) * 2 - 1) * aspect;
        const dy = (y / heightDenom) * 2 - 1;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const radius = Math.max(0.01, settings.island.radius);
        const falloff = Math.pow(clamp(dist / radius, 0, 1), settings.island.falloff);
        value -= falloff;
      }

      value = clamp(value, 0, 1);
      types[y][x] = resolveTerrainType(value, settings.thresholds);
    }
  }

  const rng = createTerrainRng(seed);
  applyCoast(types, settings, seed);
  applyLakes(types, settings, rng);
  applyRivers(types, settings, rng);
  const walkable = buildWalkableMap(types, settings.walkable);
  const spawnable = buildSpawnableMap(walkable);

  return {
    width,
    height,
    seed,
    types,
    walkable,
    spawnable,
    walkableTypes: settings.walkable,
    symbols: settings.symbols,
    thresholds: settings.thresholds,
  };
}

// Function: createValleyTerrain.
function createValleyTerrain(runtime, settings, seed) {
  const width = Math.max(0, Number(runtime.gridWidth || 0));
  const height = Math.max(0, Number(runtime.gridHeight || 0));
  const valley = settings.valley;
  const rng = createTerrainRng(seed + 17);
  const heightMap = Array.from({ length: height }, (_, y) => {
    return Array.from({ length: width }, (_, x) => {
      const base = fractalNoise(
        x * valley.noiseScale,
        y * valley.noiseScale,
        seed,
        valley.octaves,
        valley.persistence,
        valley.lacunarity,
      );
      const mid = (height - 1) / 2;
      const gradient = mid > 0 ? Math.abs((y - mid) / mid) : 0;
      return base * (1 - valley.bowlStrength) + gradient * valley.bowlStrength;
    });
  });

  let smooth = smoothHeightMap(heightMap, valley.smoothingPasses);
  smooth = normalizeHeightMap(smooth);
  const riverInfo = buildValleyRivers(smooth, valley, seed);
  const carved = carveRiverValley(smooth, riverInfo.river, valley);

  const waterSet = new Set([...riverInfo.lakes]);
  for (const cell of riverInfo.river) {
    waterSet.add(`${cell.x},${cell.y}`);
  }

  const dist = computeDistanceToWater(waterSet, width, height);
  const humidity = dist.map((row) => row.map((d) => Math.exp(-d / valley.humidityDecay)));

  const baseTypes = Array.from({ length: height }, () => new Array(width).fill('plain'));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const key = `${x},${y}`;
      if (waterSet.has(key)) {
        baseTypes[y][x] = riverInfo.lakes.has(key) ? 'lake' : 'river';
        continue;
      }
      const h = carved[y][x];
      if (h >= valley.mountainHeight) {
        baseTypes[y][x] = 'mountain';
      } else if (h >= valley.hillHeight) {
        baseTypes[y][x] = 'hill';
      } else if (h <= valley.fertileHeight && dist[y][x] <= valley.fertileDistance) {
        baseTypes[y][x] = 'fertile';
      } else {
        baseTypes[y][x] = 'plain';
      }
    }
  }

  const forest = Array.from({ length: height }, () => new Array(width).fill(false));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const type = baseTypes[y][x];
      if (type === 'river' || type === 'lake' || type === 'mountain') {
        continue;
      }
      if (carved[y][x] > valley.forest.heightMax) {
        continue;
      }
      if (dist[y][x] > valley.forest.waterDistanceMax) {
        continue;
      }
      if (humidity[y][x] < valley.forest.humidityMin) {
        continue;
      }
      const noise = fractalNoise(
        x * valley.forest.noiseScale,
        y * valley.forest.noiseScale,
        seed + 77,
        3,
        0.5,
        2.0,
      );
      if (noise > valley.forest.noiseThreshold) {
        forest[y][x] = true;
      }
    }
  }
  for (let pass = 0; pass < valley.forest.clusterPasses; pass += 1) {
    smoothClusterMap(forest, baseTypes, (x, y) => humidity[y][x] > 0.4);
  }

  const stone = Array.from({ length: height }, () => new Array(width).fill(false));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const type = baseTypes[y][x];
      if (type !== 'mountain') {
        continue;
      }
      if (carved[y][x] < valley.stone.heightMin) {
        continue;
      }
      const noise = fractalNoise(
        x * valley.stone.noiseScale,
        y * valley.stone.noiseScale,
        seed + 99,
        3,
        0.5,
        2.0,
      );
      if (noise > valley.stone.noiseThreshold) {
        stone[y][x] = true;
      }
    }
  }
  for (let pass = 0; pass < valley.stone.clusterPasses; pass += 1) {
    smoothClusterMap(stone, baseTypes, () => true);
  }

  const food = buildValleyFoodMask(
    width,
    height,
    baseTypes,
    dist,
    humidity,
    forest,
    valley,
    seed,
  );

  const types = Array.from({ length: height }, () => new Array(width).fill('plain'));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const base = baseTypes[y][x];
      if (base === 'river' || base === 'lake') {
        types[y][x] = base;
        continue;
      }
      if (base === 'mountain') {
        types[y][x] = stone[y][x] ? 'stone' : 'mountain';
        continue;
      }
      if (forest[y][x]) {
        types[y][x] = 'forest';
        continue;
      }
      if (food[y][x]) {
        types[y][x] = 'food';
        continue;
      }
      types[y][x] = base;
    }
  }

  ensureValleyTerrainCoverage(types, baseTypes, carved, dist, riverInfo, valley, rng);

  const walkable = buildWalkableMap(types, settings.walkable);
  const spawnable = buildSpawnableMap(walkable);

  return {
    width,
    height,
    seed,
    types,
    walkable,
    spawnable,
    walkableTypes: settings.walkable,
    symbols: settings.symbols,
  };
}

// Function: ensureValleyTerrainCoverage.
function ensureValleyTerrainCoverage(types, baseTypes, heights, dist, riverInfo, valley, rng) {
  const counts = countTerrainTypes(types);

  if (!counts.river) {
    const riverCells = Array.isArray(riverInfo && riverInfo.river) ? riverInfo.river : [];
    if (riverCells.length > 0) {
      for (const cell of riverCells) {
        types[cell.y][cell.x] = 'river';
      }
      counts.river = riverCells.length;
    } else {
      const midY = Math.floor(types.length / 2);
      for (let x = 0; x < types[0].length; x += 1) {
        types[midY][x] = 'river';
      }
      counts.river = types[0].length;
    }
  }

  if (!counts.lake) {
    const riverCells = Array.isArray(riverInfo && riverInfo.river) ? riverInfo.river : [];
    const anchor = riverCells.length > 0
      ? riverCells[Math.floor((rng ? rng() : Math.random()) * riverCells.length)]
      : { x: Math.floor(types[0].length / 2), y: Math.floor(types.length / 2) };
    placeLakePatch(types, anchor.x, anchor.y);
    counts.lake = 1;
  }

  if (!counts.mountain) {
    const cell = selectCellByHeight(heights, types, (type) => type !== 'river' && type !== 'lake', true);
    if (cell) {
      types[cell.y][cell.x] = 'mountain';
      counts.mountain = 1;
    }
  }

  if (!counts.hill) {
    const cell = selectCellByHeight(
      heights,
      types,
      (type) => type !== 'river' && type !== 'lake' && type !== 'mountain',
      true,
    );
    if (cell) {
      types[cell.y][cell.x] = 'hill';
      counts.hill = 1;
    }
  }

  if (!counts.fertile) {
    const cell = selectCellByHeight(
      heights,
      types,
      (type, x, y) => type !== 'river' && type !== 'lake' && dist[y][x] <= valley.fertileDistance + 1,
      false,
    );
    if (cell) {
      types[cell.y][cell.x] = 'fertile';
      counts.fertile = 1;
    }
  }

  if (!counts.plain) {
    const cell = selectCellByHeight(
      heights,
      types,
      (type) => type !== 'river' && type !== 'lake' && type !== 'mountain',
      false,
    );
    if (cell) {
      types[cell.y][cell.x] = 'plain';
      counts.plain = 1;
    }
  }

  if (!counts.forest) {
    const maxDist = valley.forest && Number.isFinite(valley.forest.waterDistanceMax)
      ? valley.forest.waterDistanceMax
      : 4;
    const cell = selectCellByHeight(
      heights,
      types,
      (type, x, y) => type !== 'river' && type !== 'lake' && type !== 'mountain' && dist[y][x] <= maxDist,
      false,
    );
    if (cell) {
      types[cell.y][cell.x] = 'forest';
      counts.forest = 1;
    }
  }

  if (!counts.food) {
    const maxDist = valley.food && Number.isFinite(valley.food.waterDistanceMax)
      ? valley.food.waterDistanceMax
      : valley.fertileDistance + 1;
    const cell = selectCellByHeight(
      heights,
      types,
      (type, x, y) => (baseTypes[y][x] === 'fertile' || baseTypes[y][x] === 'plain')
        && type !== 'river'
        && type !== 'lake'
        && type !== 'mountain'
        && type !== 'forest'
        && type !== 'stone'
        && dist[y][x] <= maxDist,
      false,
    );
    if (cell) {
      types[cell.y][cell.x] = 'food';
      counts.food = 1;
    }
  }

  ensureMinimumFoodTiles(types, baseTypes, dist, valley, rng, counts);

  if (!counts.stone) {
    const cell = selectCellByHeight(
      heights,
      types,
      (type) => type === 'mountain',
      true,
    );
    if (cell) {
      types[cell.y][cell.x] = 'stone';
      counts.stone = 1;
    }
  }
}

// Function: ensureMinimumFoodTiles.
function ensureMinimumFoodTiles(types, baseTypes, dist, valley, rng, counts) {
  const foodConfig = valley.food || {};
  const minTiles = Math.max(0, Math.floor(Number(foodConfig.minTiles ?? 0)));
  if (minTiles <= 0) {
    return;
  }
  const current = Number(counts.food || 0);
  if (current >= minTiles) {
    return;
  }
  const maxDist = Number.isFinite(foodConfig.minTilesWaterDistanceMax)
    ? Math.max(0, Math.floor(foodConfig.minTilesWaterDistanceMax))
    : Math.max(0, Math.floor(foodConfig.waterDistanceMax ?? 0));
  const height = types.length;
  const width = height > 0 ? types[0].length : 0;
  const candidates = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (baseTypes[y][x] !== 'plain' && baseTypes[y][x] !== 'fertile') {
        continue;
      }
      const type = types[y][x];
      if (type === 'river' || type === 'lake' || type === 'mountain' || type === 'forest' || type === 'stone') {
        continue;
      }
      if (dist[y][x] > maxDist) {
        continue;
      }
      candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) {
    return;
  }
  shuffleInPlace(candidates, rng);
  const needed = Math.min(minTiles - current, candidates.length);
  for (let i = 0; i < needed; i += 1) {
    const cell = candidates[i];
    types[cell.y][cell.x] = 'food';
  }
  counts.food = current + needed;
}

// Function: countTerrainTypes.
function countTerrainTypes(types) {
  const counts = {};
  for (let y = 0; y < types.length; y += 1) {
    const row = types[y];
    for (let x = 0; x < row.length; x += 1) {
      const type = row[x];
      counts[type] = Number(counts[type] || 0) + 1;
    }
  }
  return counts;
}

// Function: shuffleInPlace.
function shuffleInPlace(items, rng) {
  const random = rng || Math.random;
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
}

// Function: selectCellByHeight.
function selectCellByHeight(heights, types, predicate, preferHigh) {
  const height = heights.length;
  const width = height > 0 ? heights[0].length : 0;
  let best = null;
  let bestValue = preferHigh ? -Infinity : Infinity;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const type = types[y][x];
      if (predicate && !predicate(type, x, y)) {
        continue;
      }
      const value = heights[y][x];
      if (preferHigh) {
        if (value > bestValue) {
          bestValue = value;
          best = { x, y };
        }
      } else if (value < bestValue) {
        bestValue = value;
        best = { x, y };
      }
    }
  }
  return best;
}

// Function: placeLakePatch.
function placeLakePatch(types, x, y) {
  const height = types.length;
  const width = height > 0 ? types[0].length : 0;
  const offsets = [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 1 },
  ];
  for (const offset of offsets) {
    const nx = x + offset.dx;
    const ny = y + offset.dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
      continue;
    }
    types[ny][nx] = 'lake';
  }
}

// Function: normalizeTerrainSettings.
function normalizeTerrainSettings(terrainConfig) {
  const mode = String(terrainConfig.mode || 'coast');
  const scaleRaw = Number(terrainConfig.scale ?? 0.08);
  const scale = Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 0.08;
  const octavesRaw = Number(terrainConfig.octaves ?? 3);
  const octaves = Number.isFinite(octavesRaw) ? clamp(Math.floor(octavesRaw), 1, 8) : 3;
  const persistenceRaw = Number(terrainConfig.persistence ?? 0.5);
  const persistence = Number.isFinite(persistenceRaw) ? clamp(persistenceRaw, 0, 1) : 0.5;
  const lacunarityRaw = Number(terrainConfig.lacunarity ?? 2.0);
  const lacunarity = Number.isFinite(lacunarityRaw) && lacunarityRaw > 0 ? lacunarityRaw : 2.0;
  const islandConfig = terrainConfig.island || {};
  const islandEnabled = islandConfig.enabled !== false;
  const radiusRaw = Number(islandConfig.radius ?? 0.9);
  const falloffRaw = Number(islandConfig.falloff ?? 1.8);
  const island = {
    enabled: islandEnabled,
    radius: Number.isFinite(radiusRaw) ? clamp(radiusRaw, 0.1, 2.5) : 0.9,
    falloff: Number.isFinite(falloffRaw) ? clamp(falloffRaw, 0.5, 6) : 1.8,
  };

  return {
    mode,
    seed: terrainConfig.seed ?? 0,
    scale,
    octaves,
    persistence,
    lacunarity,
    island,
    valley: normalizeValleySettings(terrainConfig.valley || {}, {
      scale,
      octaves,
      persistence,
      lacunarity,
    }),
    coast: normalizeCoastSettings(terrainConfig.coast || {}),
    lakes: normalizeLakeSettings(terrainConfig.lakes || {}),
    rivers: normalizeRiverSettings(terrainConfig.rivers || {}),
    thresholds: normalizeTerrainThresholds(terrainConfig.thresholds || {}),
    walkable: normalizeWalkableSettings(terrainConfig.walkable || {}),
    symbols: normalizeTerrainSymbols(terrainConfig.symbols || {}),
  };
}

// Function: normalizeTerrainThresholds.
function normalizeTerrainThresholds(raw) {
  const water = clamp(Number(raw.water ?? 0.32), 0, 1);
  const shore = clamp(Number(raw.shore ?? 0.38), water, 1);
  const grass = clamp(Number(raw.grass ?? 0.62), shore, 1);
  const forest = clamp(Number(raw.forest ?? 0.78), grass, 1);
  const mountain = clamp(Number(raw.mountain ?? 1), forest, 1);
  return { water, shore, grass, forest, mountain };
}

// Function: normalizeTerrainSymbols.
function normalizeTerrainSymbols(raw) {
  return {
    river: pickSymbol(raw.river ?? raw.water, '='),
    lake: pickSymbol(raw.lake ?? raw.water, '~'),
    water: pickSymbol(raw.water, '~'),
    shore: pickSymbol(raw.shore, ':'),
    grass: pickSymbol(raw.grass, '.'),
    hill: pickSymbol(raw.hill, 'n'),
    plain: pickSymbol(raw.plain, '.'),
    fertile: pickSymbol(raw.fertile, ':'),
    forest: pickSymbol(raw.forest, 'T'),
    food: pickSymbol(raw.food, 'f'),
    stone: pickSymbol(raw.stone, '*'),
    mountain: pickSymbol(raw.mountain, '^'),
  };
}

// Function: normalizeCoastSettings.
function normalizeCoastSettings(raw) {
  if (!raw || raw.enabled !== true) {
    return { enabled: false };
  }
  const side = normalizeCoastSide(raw.side);
  const widthRaw = Number(raw.width ?? 0.12);
  const shoreRaw = Number(raw.shoreWidth ?? 0.03);
  const noiseScaleRaw = Number(raw.noiseScale ?? 0.06);
  const jaggedRaw = Number(raw.jaggedness ?? 0.35);
  return {
    enabled: true,
    side,
    width: Number.isFinite(widthRaw) ? clamp(widthRaw, 0.01, 0.5) : 0.12,
    shoreWidth: Number.isFinite(shoreRaw) ? clamp(shoreRaw, 0, 0.2) : 0.03,
    noiseScale: Number.isFinite(noiseScaleRaw) ? clamp(noiseScaleRaw, 0.01, 0.2) : 0.06,
    jaggedness: Number.isFinite(jaggedRaw) ? clamp(jaggedRaw, 0, 1) : 0.35,
  };
}

// Function: normalizeCoastSide.
function normalizeCoastSide(value) {
  const side = String(value || '').toLowerCase();
  if (side === 'north' || side === 'south' || side === 'east' || side === 'west') {
    return side;
  }
  return 'west';
}

// Function: normalizeLakeSettings.
function normalizeLakeSettings(raw) {
  if (!raw || raw.enabled !== true) {
    return { enabled: false };
  }
  const countRaw = Number(raw.count ?? 1);
  const radiusMinRaw = Number(raw.radiusMin ?? 3);
  const radiusMaxRaw = Number(raw.radiusMax ?? 6);
  const shoreRaw = Number(raw.shoreWidth ?? 1);
  const bufferRaw = Number(raw.buffer ?? 3);
  const count = Number.isFinite(countRaw) ? clamp(Math.floor(countRaw), 0, 4) : 1;
  const radiusMin = Number.isFinite(radiusMinRaw) ? clamp(Math.floor(radiusMinRaw), 1, 12) : 3;
  const radiusMax = Number.isFinite(radiusMaxRaw)
    ? clamp(Math.floor(radiusMaxRaw), radiusMin, 14)
    : Math.max(radiusMin, 6);
  return {
    enabled: true,
    count,
    radiusMin,
    radiusMax,
    shoreWidth: Number.isFinite(shoreRaw) ? clamp(Math.floor(shoreRaw), 0, 3) : 1,
    buffer: Number.isFinite(bufferRaw) ? clamp(Math.floor(bufferRaw), 0, 10) : 3,
  };
}

// Function: normalizeValleySettings.
function normalizeValleySettings(raw, defaults) {
  const scale = Number(raw.noiseScale ?? defaults.scale ?? 0.06);
  const octaves = Number(raw.octaves ?? defaults.octaves ?? 4);
  const persistence = Number(raw.persistence ?? defaults.persistence ?? 0.5);
  const lacunarity = Number(raw.lacunarity ?? defaults.lacunarity ?? 2.0);
  const smoothingPasses = clamp(Math.floor(Number(raw.smoothingPasses ?? 3)), 1, 8);
  const bowlStrength = clamp(Number(raw.bowlStrength ?? 0.3), 0, 1);
  const mountainHeight = clamp(Number(raw.mountainHeight ?? 0.8), 0, 1);
  const hillHeight = clamp(Number(raw.hillHeight ?? 0.66), 0, 1);
  const fertileHeight = clamp(Number(raw.fertileHeight ?? 0.46), 0, 1);
  const fertileDistance = clamp(Math.floor(Number(raw.fertileDistance ?? 3)), 0, 10);
  const humidityDecay = Math.max(1, Number(raw.humidityDecay ?? 6));
  const riverBias = raw.riverBias || {};
  const riverCount = clamp(Math.floor(Number(raw.riverCount ?? 1)), 1, 4);
  const riverSourceMinDistance = clamp(Math.floor(Number(raw.riverSourceMinDistance ?? 6)), 0, 50);
  const riverWander = clamp(Number(raw.riverWander ?? 0.25), 0, 1);
  const riverSourceSides = Array.isArray(raw.riverSourceSides)
    ? raw.riverSourceSides.map((side) => String(side || '').toLowerCase())
      .filter((side) => ['north', 'south', 'east', 'west'].includes(side))
    : ['north', 'south', 'east', 'west'];
  const riverValleyDrop = Math.max(0, Number(raw.riverValleyDrop ?? 0.22));
  const riverValleyDropAdjacent = Math.max(0, Number(raw.riverValleyDropAdjacent ?? 0.1));
  const lakeDepth = Math.max(0, Number(raw.lakeDepth ?? 0.02));
  const lakeThreshold = Math.max(0, Number(raw.lakeThreshold ?? 0.03));
  const forest = raw.forest || {};
  const stone = raw.stone || {};
  const food = raw.food || {};

  return {
    noiseScale: Number.isFinite(scale) && scale > 0 ? scale : 0.06,
    octaves: Number.isFinite(octaves) ? clamp(Math.floor(octaves), 1, 8) : 4,
    persistence: Number.isFinite(persistence) ? clamp(persistence, 0, 1) : 0.5,
    lacunarity: Number.isFinite(lacunarity) && lacunarity > 0 ? lacunarity : 2.0,
    smoothingPasses,
    bowlStrength,
    mountainHeight: Math.max(hillHeight, mountainHeight),
    hillHeight: Math.min(hillHeight, mountainHeight),
    fertileHeight,
    fertileDistance,
    humidityDecay,
    riverBias: {
      east: Number(riverBias.east ?? -0.02),
      south: Number(riverBias.south ?? -0.01),
      west: Number(riverBias.west ?? 0.02),
      north: Number(riverBias.north ?? 0.03),
    },
    riverCount,
    riverSourceMinDistance,
    riverWander,
    riverSourceSides: riverSourceSides.length > 0 ? riverSourceSides : ['north', 'south', 'east', 'west'],
    riverValleyDrop,
    riverValleyDropAdjacent,
    lakeDepth,
    lakeThreshold,
    forest: {
      humidityMin: clamp(Number(forest.humidityMin ?? 0.43), 0, 1),
      heightMax: clamp(Number(forest.heightMax ?? 0.72), 0, 1),
      waterDistanceMax: clamp(Math.floor(Number(forest.waterDistanceMax ?? 4)), 0, 12),
      noiseScale: Math.max(0.01, Number(forest.noiseScale ?? 0.11)),
      noiseThreshold: clamp(Number(forest.noiseThreshold ?? 0.6), 0, 1),
      clusterPasses: clamp(Math.floor(Number(forest.clusterPasses ?? 2)), 0, 5),
    },
    food: {
      humidityMin: clamp(Number(food.humidityMin ?? 0.4), 0, 1),
      waterDistanceMax: clamp(Math.floor(Number(food.waterDistanceMax ?? 5)), 0, 12),
      noiseScale: Math.max(0.01, Number(food.noiseScale ?? 0.12)),
      noiseThreshold: clamp(Number(food.noiseThreshold ?? 0.7), 0, 1),
      clusterPasses: clamp(Math.floor(Number(food.clusterPasses ?? 1)), 0, 5),
      minTiles: Math.max(0, Math.floor(Number(food.minTiles ?? 0))),
      minTilesWaterDistanceMax: Number.isFinite(food.minTilesWaterDistanceMax)
        ? clamp(Math.floor(Number(food.minTilesWaterDistanceMax)), 0, 12)
        : undefined,
    },
    stone: {
      heightMin: clamp(Number(stone.heightMin ?? 0.58), 0, 1),
      noiseScale: Math.max(0.01, Number(stone.noiseScale ?? 0.13)),
      noiseThreshold: clamp(Number(stone.noiseThreshold ?? 0.64), 0, 1),
      clusterPasses: clamp(Math.floor(Number(stone.clusterPasses ?? 1)), 0, 4),
    },
  };
}

// Function: normalizeRiverSettings.
function normalizeRiverSettings(raw) {
  const enabled = raw.enabled !== false;
  const countRaw = Number(raw.count ?? 0);
  const count = Number.isFinite(countRaw) ? clamp(Math.floor(countRaw), 0, 4) : 0;
  const widthRaw = Number(raw.width ?? 1);
  const width = Number.isFinite(widthRaw) ? clamp(Math.floor(widthRaw), 1, 3) : 1;
  const shoreRaw = Number(raw.shoreWidth ?? 1);
  const shoreWidth = Number.isFinite(shoreRaw) ? clamp(Math.floor(shoreRaw), 0, 3) : 1;
  const wanderRaw = Number(raw.wander ?? 0.5);
  const wander = Number.isFinite(wanderRaw) ? clamp(wanderRaw, 0, 1) : 0.5;
  return {
    enabled,
    count,
    width,
    shoreWidth,
    wander,
  };
}

// Function: normalizeWalkableSettings.
function normalizeWalkableSettings(raw) {
  return {
    water: raw.water === true ? true : false,
    river: raw.river === true ? true : false,
    lake: raw.lake === true ? true : false,
    shore: raw.shore !== false,
    grass: raw.grass !== false,
    mountain: raw.mountain === true ? true : false,
    hill: raw.hill !== false,
    plain: raw.plain !== false,
    fertile: raw.fertile !== false,
    forest: raw.forest !== false,
    food: raw.food !== false,
    stone: raw.stone !== false,
  };
}

// Function: pickSymbol.
function pickSymbol(value, fallback) {
  const str = String(value ?? fallback);
  return str.length > 0 ? str[0] : fallback;
}

// Function: resolveTerrainSeed.
function resolveTerrainSeed(rawSeed, previousTerrain, runtime) {
  const parsed = Number(rawSeed ?? 0);
  const explicit = Number.isFinite(parsed) ? Math.floor(parsed) : 0;
  if (explicit !== 0) {
    return explicit >>> 0;
  }
  const previous = previousTerrain && Number.isFinite(previousTerrain.seed)
    ? Number(previousTerrain.seed)
    : 0;
  if (previous) {
    return previous >>> 0;
  }
  const rand = Math.floor(Math.random() * 4294967295) >>> 0;
  const mixed = (rand ^ (runtime.gridWidth << 16) ^ runtime.gridHeight) >>> 0;
  return mixed || 1;
}

// Function: resolveTerrainType.
function resolveTerrainType(value, thresholds) {
  if (value < thresholds.water) {
    return 'water';
  }
  if (value < thresholds.shore) {
    return 'shore';
  }
  if (value < thresholds.grass) {
    return 'grass';
  }
  if (value < thresholds.forest) {
    return 'forest';
  }
  return 'mountain';
}

// Function: applyCoast.
function applyCoast(types, settings, seed) {
  const coast = settings.coast || {};
  if (!coast.enabled) {
    return;
  }
  const height = types.length;
  const width = height > 0 ? types[0].length : 0;
  if (width <= 0 || height <= 0) {
    return;
  }
  const spec = getCoastSpec(coast, width, height);
  if (!spec) {
    return;
  }

  const noiseScale = coast.noiseScale;
  const jagged = coast.jaggedness;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distance = getCoastDistance(spec.side, x, y, width, height);
      let boundary = spec.sea;
      if (noiseScale > 0 && jagged > 0) {
        const n = smoothValueNoise(x * noiseScale, y * noiseScale, seed + 1337);
        const offset = Math.round((n - 0.5) * 2 * jagged * spec.sea);
        boundary = spec.sea + offset;
      }
      if (distance <= boundary) {
        types[y][x] = 'water';
      } else if (distance <= boundary + spec.shore) {
        types[y][x] = 'shore';
      }
    }
  }
}

// Function: applyLakes.
function applyLakes(types, settings, rng) {
  const lakes = settings.lakes || {};
  if (!lakes.enabled || lakes.count <= 0) {
    return;
  }
  const height = types.length;
  const width = height > 0 ? types[0].length : 0;
  if (width <= 0 || height <= 0) {
    return;
  }
  const random = typeof rng === 'function' ? rng : Math.random;

  for (let i = 0; i < lakes.count; i += 1) {
    const radius = randomBetweenWithRng(random, lakes.radiusMin, lakes.radiusMax);
    const center = pickLakeCenter(types, settings, random, radius, lakes.buffer);
    if (!center) {
      continue;
    }
    carveLake(types, center.x, center.y, radius, lakes.shoreWidth);
  }
}

// Function: applyRivers.
function applyRivers(types, settings, rng) {
  const rivers = settings.rivers || {};
  if (!rivers.enabled || rivers.count <= 0) {
    return;
  }
  const height = types.length;
  const width = height > 0 ? types[0].length : 0;
  if (width <= 0 || height <= 0) {
    return;
  }

  const random = typeof rng === 'function' ? rng : Math.random;
  const coast = settings.coast || {};
  const coastSpec = coast.enabled ? getCoastSpec(coast, width, height) : null;

  for (let i = 0; i < rivers.count; i += 1) {
    let start = null;
    let end = null;
    if (coastSpec) {
      start = pickInlandPoint(types, random, coastSpec, rivers.width);
      end = pickCoastEdgePoint(width, height, coastSpec.side, random);
    } else {
      start = pickEdgePoint(width, height, random);
      end = pickOppositeEdgePoint(width, height, start.side, random);
    }
    if (!start || !end) {
      continue;
    }
    const line = buildLine(start, end);
    for (const point of line) {
      let x = point.x;
      let y = point.y;
      if (random() < rivers.wander) {
        if (random() < 0.5) {
          x = clamp(x + (random() < 0.5 ? -1 : 1), 0, width - 1);
        } else {
          y = clamp(y + (random() < 0.5 ? -1 : 1), 0, height - 1);
        }
      }
      carveWater(types, x, y, rivers.width, rivers.shoreWidth);
    }
  }
}

// Function: pickEdgePoint.
function pickEdgePoint(width, height, random) {
  const rng = typeof random === 'function' ? random : Math.random;
  const sideIndex = Math.floor(rng() * 4);
  if (sideIndex === 0) {
    return { x: randomBetweenWithRng(rng, 0, width - 1), y: 0, side: 'north' };
  }
  if (sideIndex === 1) {
    return { x: randomBetweenWithRng(rng, 0, width - 1), y: height - 1, side: 'south' };
  }
  if (sideIndex === 2) {
    return { x: 0, y: randomBetweenWithRng(rng, 0, height - 1), side: 'west' };
  }
  return { x: width - 1, y: randomBetweenWithRng(rng, 0, height - 1), side: 'east' };
}

// Function: pickOppositeEdgePoint.
function pickOppositeEdgePoint(width, height, side, random) {
  const rng = typeof random === 'function' ? random : Math.random;
  if (side === 'north') {
    return { x: randomBetweenWithRng(rng, 0, width - 1), y: height - 1 };
  }
  if (side === 'south') {
    return { x: randomBetweenWithRng(rng, 0, width - 1), y: 0 };
  }
  if (side === 'west') {
    return { x: width - 1, y: randomBetweenWithRng(rng, 0, height - 1) };
  }
  return { x: 0, y: randomBetweenWithRng(rng, 0, height - 1) };
}

// Function: pickCoastEdgePoint.
function pickCoastEdgePoint(width, height, side, random) {
  const rng = typeof random === 'function' ? random : Math.random;
  if (side === 'north') {
    return { x: randomBetweenWithRng(rng, 0, width - 1), y: 0 };
  }
  if (side === 'south') {
    return { x: randomBetweenWithRng(rng, 0, width - 1), y: height - 1 };
  }
  if (side === 'west') {
    return { x: 0, y: randomBetweenWithRng(rng, 0, height - 1) };
  }
  return { x: width - 1, y: randomBetweenWithRng(rng, 0, height - 1) };
}

// Function: pickInlandPoint.
function pickInlandPoint(types, random, coastSpec, buffer) {
  const height = types.length;
  const width = height > 0 ? types[0].length : 0;
  if (width <= 0 || height <= 0) {
    return null;
  }
  const rng = typeof random === 'function' ? random : Math.random;
  const edgeBuffer = Math.max(0, Number(buffer || 0));
  let minX = edgeBuffer;
  let maxX = width - 1 - edgeBuffer;
  let minY = edgeBuffer;
  let maxY = height - 1 - edgeBuffer;
  if (coastSpec) {
    const inland = coastSpec.sea + coastSpec.shore + 2 + edgeBuffer;
    if (coastSpec.side === 'west') {
      minX = Math.max(minX, inland);
    } else if (coastSpec.side === 'east') {
      maxX = Math.min(maxX, width - 1 - inland);
    } else if (coastSpec.side === 'north') {
      minY = Math.max(minY, inland);
    } else if (coastSpec.side === 'south') {
      maxY = Math.min(maxY, height - 1 - inland);
    }
  }
  if (minX > maxX || minY > maxY) {
    minX = edgeBuffer;
    maxX = width - 1 - edgeBuffer;
    minY = edgeBuffer;
    maxY = height - 1 - edgeBuffer;
  }
  const attempts = 40;
  for (let i = 0; i < attempts; i += 1) {
    const x = randomBetweenWithRng(rng, minX, maxX);
    const y = randomBetweenWithRng(rng, minY, maxY);
    if (types[y][x] !== 'water') {
      return { x, y };
    }
  }
  return { x: Math.floor(width / 2), y: Math.floor(height / 2) };
}

// Function: pickLakeCenter.
function pickLakeCenter(types, settings, random, radius, buffer) {
  const height = types.length;
  const width = height > 0 ? types[0].length : 0;
  if (width <= 0 || height <= 0) {
    return null;
  }
  const rng = typeof random === 'function' ? random : Math.random;
  const coast = settings.coast || {};
  const coastSpec = coast.enabled ? getCoastSpec(coast, width, height) : null;
  const extra = Math.max(0, Number(buffer || 0)) + radius + 1;
  let minX = extra;
  let maxX = width - 1 - extra;
  let minY = extra;
  let maxY = height - 1 - extra;
  if (coastSpec) {
    const inland = coastSpec.sea + coastSpec.shore + extra;
    if (coastSpec.side === 'west') {
      minX = Math.max(minX, inland);
    } else if (coastSpec.side === 'east') {
      maxX = Math.min(maxX, width - 1 - inland);
    } else if (coastSpec.side === 'north') {
      minY = Math.max(minY, inland);
    } else if (coastSpec.side === 'south') {
      maxY = Math.min(maxY, height - 1 - inland);
    }
  }
  if (minX > maxX || minY > maxY) {
    return null;
  }
  const attempts = 40;
  for (let i = 0; i < attempts; i += 1) {
    const x = randomBetweenWithRng(rng, minX, maxX);
    const y = randomBetweenWithRng(rng, minY, maxY);
    if (types[y][x] !== 'water') {
      return { x, y };
    }
  }
  return null;
}

// Function: carveLake.
function carveLake(types, x, y, radius, shoreWidth) {
  const height = types.length;
  const width = height > 0 ? types[0].length : 0;
  if (width <= 0 || height <= 0) {
    return;
  }
  const r = Math.max(1, radius);
  const shore = Math.max(0, shoreWidth);
  const r2 = r * r;
  const rOuter = r + shore;
  const rOuter2 = rOuter * rOuter;
  const minX = Math.max(0, x - rOuter);
  const maxX = Math.min(width - 1, x + rOuter);
  const minY = Math.max(0, y - rOuter);
  const maxY = Math.min(height - 1, y + rOuter);
  for (let yy = minY; yy <= maxY; yy += 1) {
    for (let xx = minX; xx <= maxX; xx += 1) {
      const dx = xx - x;
      const dy = yy - y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 <= r2) {
        types[yy][xx] = 'water';
      } else if (shore > 0 && dist2 <= rOuter2 && types[yy][xx] !== 'water') {
        types[yy][xx] = 'shore';
      }
    }
  }
}

// Function: getCoastSpec.
function getCoastSpec(coast, width, height) {
  if (!coast || !coast.enabled) {
    return null;
  }
  const side = coast.side || 'west';
  const edge = side === 'north' || side === 'south' ? height : width;
  const sea = Math.max(1, Math.round(edge * clamp(coast.width, 0, 1)));
  const shore = Math.max(0, Math.round(edge * clamp(coast.shoreWidth, 0, 1)));
  return { side, sea, shore };
}

// Function: getCoastDistance.
function getCoastDistance(side, x, y, width, height) {
  if (side === 'north') {
    return y;
  }
  if (side === 'south') {
    return (height - 1) - y;
  }
  if (side === 'east') {
    return (width - 1) - x;
  }
  return x;
}

// Function: buildLine.
function buildLine(start, end) {
  const points = [];
  let x0 = start.x;
  let y0 = start.y;
  const x1 = end.x;
  const y1 = end.y;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    points.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) {
      break;
    }
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }

  return points;
}

// Function: carveWater.
function carveWater(types, x, y, width, shoreWidth) {
  const height = types.length;
  const maxY = height - 1;
  const maxX = height > 0 ? types[0].length - 1 : 0;
  const radius = Math.max(0, width - 1);
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx > maxX || ny > maxY) {
        continue;
      }
      types[ny][nx] = 'water';
    }
  }
  const shoreRadius = Math.max(0, radius + shoreWidth);
  for (let dy = -shoreRadius; dy <= shoreRadius; dy += 1) {
    for (let dx = -shoreRadius; dx <= shoreRadius; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx > maxX || ny > maxY) {
        continue;
      }
      if (types[ny][nx] !== 'water') {
        types[ny][nx] = 'shore';
      }
    }
  }
}

// Function: buildWalkableMap.
function buildWalkableMap(types, walkableConfig) {
  const height = types.length;
  const width = height > 0 ? types[0].length : 0;
  const map = Array.from({ length: height }, () => new Array(width).fill(true));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const type = types[y][x];
      const allowed = walkableConfig && walkableConfig[type] !== undefined
        ? walkableConfig[type]
        : true;
      map[y][x] = Boolean(allowed);
    }
  }
  return map;
}

// Function: buildSpawnableMap.
function buildSpawnableMap(walkable) {
  if (!walkable || walkable.length === 0) {
    return null;
  }
  const height = walkable.length;
  const width = walkable[0].length || 0;
  if (width <= 0) {
    return null;
  }
  const start = findNearestWalkable(walkable, Math.floor(width / 2), Math.floor(height / 2));
  if (!start) {
    return null;
  }

  const spawnable = Array.from({ length: height }, () => new Array(width).fill(false));
  const queue = [start];
  spawnable[start.y][start.x] = true;

  while (queue.length > 0) {
    const current = queue.shift();
    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];
    for (const next of neighbors) {
      if (next.x < 0 || next.y < 0 || next.x >= width || next.y >= height) {
        continue;
      }
      if (!walkable[next.y][next.x] || spawnable[next.y][next.x]) {
        continue;
      }
      spawnable[next.y][next.x] = true;
      queue.push(next);
    }
  }

  return spawnable;
}

// Function: findNearestWalkable.
function findNearestWalkable(walkable, startX, startY) {
  const height = walkable.length;
  const width = walkable[0].length || 0;
  if (height === 0 || width === 0) {
    return null;
  }
  const queue = [{ x: startX, y: startY }];
  const visited = Array.from({ length: height }, () => new Array(width).fill(false));
  visited[startY][startX] = true;

  while (queue.length > 0) {
    const current = queue.shift();
    if (walkable[current.y][current.x]) {
      return current;
    }
    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];
    for (const next of neighbors) {
      if (next.x < 0 || next.y < 0 || next.x >= width || next.y >= height) {
        continue;
      }
      if (visited[next.y][next.x]) {
        continue;
      }
      visited[next.y][next.x] = true;
      queue.push(next);
    }
  }
  return null;
}

// Function: getTerrainSpawnPredicate.
function getTerrainSpawnPredicate(terrain) {
  if (!terrain || !terrain.spawnable) {
    return null;
  }
  return (x, y) => Boolean(terrain.spawnable[y] && terrain.spawnable[y][x]);
}

// Function: getTerrainResourcePredicate.
function getTerrainResourcePredicate(terrain, terrainAllowed, resourceId) {
  if (!terrain) {
    return null;
  }
  const allowedTypes = Array.isArray(terrainAllowed && terrainAllowed[resourceId])
    ? terrainAllowed[resourceId]
    : null;
  const allowedSet = allowedTypes ? new Set(allowedTypes) : null;
  const spawnable = terrain.spawnable;
  const walkableTypes = terrain.walkableTypes || {};
  return (x, y) => {
    if (spawnable && (!spawnable[y] || !spawnable[y][x])) {
      return false;
    }
    if (!allowedSet) {
      return true;
    }
    const type = terrain.types && terrain.types[y] ? terrain.types[y][x] : null;
    const walkableHere = !terrain.walkable || (terrain.walkable[y] && terrain.walkable[y][x]);
    if (allowedSet.has(type) && (walkableTypes[type] !== false || walkableHere)) {
      return true;
    }
    for (const allowed of allowedSet) {
      if (walkableTypes[allowed] !== false) {
        continue;
      }
      if (walkableHere && hasAdjacentType(terrain.types, x, y, allowed)) {
        return true;
      }
    }
    return false;
  };
}

// Function: hasAdjacentType.
function hasAdjacentType(types, x, y, targetType) {
  if (!types || !types[y]) {
    return false;
  }
  const height = types.length;
  const width = height > 0 ? types[0].length : 0;
  const neighbors = [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ];
  for (const pos of neighbors) {
    if (pos.x < 0 || pos.y < 0 || pos.x >= width || pos.y >= height) {
      continue;
    }
    if (types[pos.y] && types[pos.y][pos.x] === targetType) {
      return true;
    }
  }
  return false;
}

// Function: fractalNoise.
function fractalNoise(x, y, seed, octaves, persistence, lacunarity) {
  let amplitude = 1;
  let frequency = 1;
  let value = 0;
  let max = 0;

  for (let i = 0; i < octaves; i += 1) {
    value += smoothValueNoise(x * frequency, y * frequency, seed) * amplitude;
    max += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return max > 0 ? value / max : 0;
}

// Function: smoothValueNoise.
function smoothValueNoise(x, y, seed) {
  const x0 = Math.floor(x);
  const x1 = x0 + 1;
  const y0 = Math.floor(y);
  const y1 = y0 + 1;
  const sx = fade(x - x0);
  const sy = fade(y - y0);

  const n00 = randomValue(x0, y0, seed);
  const n10 = randomValue(x1, y0, seed);
  const n01 = randomValue(x0, y1, seed);
  const n11 = randomValue(x1, y1, seed);

  const ix0 = lerp(n00, n10, sx);
  const ix1 = lerp(n01, n11, sx);
  return lerp(ix0, ix1, sy);
}

// Function: randomValue.
function randomValue(x, y, seed) {
  let h = (seed >>> 0) ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967295;
}

// Function: fade.
function fade(t) {
  return t * t * (3 - 2 * t);
}

// Function: lerp.
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Function: smoothHeightMap.
function smoothHeightMap(map, passes) {
  const height = map.length;
  const width = height > 0 ? map[0].length : 0;
  let current = map;
  const iterations = Math.max(1, Number(passes || 1));

  for (let p = 0; p < iterations; p += 1) {
    const next = Array.from({ length: height }, () => new Array(width).fill(0));
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny < 0 || nx < 0 || ny >= height || nx >= width) {
              continue;
            }
            sum += current[ny][nx];
            count += 1;
          }
        }
        next[y][x] = count > 0 ? sum / count : current[y][x];
      }
    }
    current = next;
  }
  return current;
}

// Function: normalizeHeightMap.
function normalizeHeightMap(map) {
  let min = Infinity;
  let max = -Infinity;
  for (const row of map) {
    for (const value of row) {
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }
    }
  }
  const range = max - min || 1;
  return map.map((row) => row.map((value) => (value - min) / range));
}

// Function: computeDistanceToWater.
function computeDistanceToWater(waterSet, width, height) {
  const dist = Array.from({ length: height }, () => new Array(width).fill(Infinity));
  const queue = [];
  for (const key of waterSet) {
    const [sx, sy] = key.split(',').map(Number);
    if (Number.isFinite(sx) && Number.isFinite(sy)) {
      dist[sy][sx] = 0;
      queue.push({ x: sx, y: sy });
    }
  }
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];
  let idx = 0;
  while (idx < queue.length) {
    const { x, y } = queue[idx];
    idx += 1;
    for (const dir of dirs) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }
      const nd = dist[y][x] + 1;
      if (nd < dist[ny][nx]) {
        dist[ny][nx] = nd;
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return dist;
}

// Function: buildValleyRiver.
function buildValleyRivers(heightMap, valley, seed) {
  const count = clamp(Math.floor(Number(valley.riverCount ?? 1)), 1, 4);
  const minDistance = Math.max(0, Math.floor(Number(valley.riverSourceMinDistance ?? 0)));
  const sources = pickRiverSources(
    heightMap,
    count,
    minDistance,
    valley.riverSourceSides,
    createTerrainRng(Number(seed || 0) + 91),
  );
  const river = [];
  const riverSet = new Set();
  const lakes = new Set();

  let index = 0;
  for (const source of sources) {
    const rng = createTerrainRng(Number(seed || 0) + 221 + index * 29);
    const result = traceValleyRiver(heightMap, valley, source, rng);
    for (const cell of result.river) {
      const key = `${cell.x},${cell.y}`;
      if (riverSet.has(key)) {
        continue;
      }
      riverSet.add(key);
      river.push(cell);
    }
    for (const lake of result.lakes) {
      lakes.add(lake);
    }
    index += 1;
  }

  return { river, lakes };
}

function traceValleyRiver(heightMap, valley, source, rng) {
  const height = heightMap.length;
  const width = height > 0 ? heightMap[0].length : 0;
  const river = [];
  const riverSet = new Set();
  const lakes = new Set();
  let x = source.x;
  let y = source.y;
  let previous = null;
  const maxSteps = width * height;
  const wander = clamp(Number(valley.riverWander ?? 0.25), 0, 1);

  for (let step = 0; step < maxSteps; step += 1) {
    const key = `${x},${y}`;
    if (!riverSet.has(key)) {
      river.push({ x, y });
      riverSet.add(key);
    }
    if (x === width - 1 || y === height - 1) {
      break;
    }
    const currentH = heightMap[y][x];
    let neighbors = [
      { x: x + 1, y, bias: valley.riverBias.east },
      { x, y: y + 1, bias: valley.riverBias.south },
      { x: x - 1, y, bias: valley.riverBias.west },
      { x, y: y - 1, bias: valley.riverBias.north },
    ].filter((n) => n.x >= 0 && n.y >= 0 && n.x < width && n.y < height);
    if (previous && neighbors.length > 1) {
      neighbors = neighbors.filter((n) => n.x !== previous.x || n.y !== previous.y);
      if (neighbors.length === 0) {
        neighbors = [
          { x: x + 1, y, bias: valley.riverBias.east },
          { x, y: y + 1, bias: valley.riverBias.south },
          { x: x - 1, y, bias: valley.riverBias.west },
          { x, y: y - 1, bias: valley.riverBias.north },
        ].filter((n) => n.x >= 0 && n.y >= 0 && n.x < width && n.y < height);
      }
    }
    let best = null;
    let bestScore = Infinity;
    const scored = [];
    for (const candidate of neighbors) {
      const noise = (rng ? rng() : Math.random()) - 0.5;
      const score = heightMap[candidate.y][candidate.x]
        + candidate.bias
        + noise * wander * 0.08;
      scored.push({ candidate, score });
    }
    if (scored.length === 0) {
      break;
    }
    scored.sort((a, b) => a.score - b.score);
    best = scored[0].candidate;
    bestScore = scored[0].score;
    if (scored.length > 1 && (rng ? rng() : Math.random()) < wander) {
      const pickIndex = Math.min(scored.length - 1, 1 + Math.floor((rng ? rng() : Math.random()) * 2));
      best = scored[pickIndex].candidate;
      bestScore = scored[pickIndex].score;
    }
    if (heightMap[best.y][best.x] > currentH + 0.0001) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            continue;
          }
          if (heightMap[ny][nx] <= currentH + valley.lakeThreshold) {
            lakes.add(`${nx},${ny}`);
            heightMap[ny][nx] = Math.min(heightMap[ny][nx], currentH - valley.lakeDepth);
          }
        }
      }
      heightMap[best.y][best.x] = currentH - valley.lakeDepth;
    }
    previous = { x, y };
    x = best.x;
    y = best.y;
  }

  return { river, lakes };
}

function pickRiverSources(heightMap, count, minDistance, sides, rng) {
  const height = heightMap.length;
  const width = height > 0 ? heightMap[0].length : 0;
  const sideList = Array.isArray(sides) && sides.length > 0
    ? sides.map((side) => String(side || '').toLowerCase())
      .filter((side) => ['north', 'south', 'east', 'west'].includes(side))
    : ['north', 'south', 'east', 'west'];
  const candidates = [];
  const candidatesBySide = {
    north: [],
    south: [],
    east: [],
    west: [],
  };
  const seen = new Set();

  if (sideList.includes('north')) {
    for (let x = 0; x < width; x += 1) {
      candidatesBySide.north.push({ x, y: 0, h: heightMap[0][x] });
    }
  }
  if (sideList.includes('south')) {
    for (let x = 0; x < width; x += 1) {
      candidatesBySide.south.push({ x, y: height - 1, h: heightMap[height - 1][x] });
    }
  }
  if (sideList.includes('west')) {
    for (let y = 0; y < height; y += 1) {
      candidatesBySide.west.push({ x: 0, y, h: heightMap[y][0] });
    }
  }
  if (sideList.includes('east')) {
    for (let y = 0; y < height; y += 1) {
      candidatesBySide.east.push({ x: width - 1, y, h: heightMap[y][width - 1] });
    }
  }

  for (const list of Object.values(candidatesBySide)) {
    for (const entry of list) {
      candidates.push(entry);
    }
  }

  candidates.sort((a, b) => b.h - a.h);
  for (const key of Object.keys(candidatesBySide)) {
    candidatesBySide[key].sort((a, b) => b.h - a.h);
  }

  const cycleSides = sideList.length > 0 ? sideList : ['north', 'south', 'east', 'west'];
  const sources = [];

  for (let i = 0; i < count; i += 1) {
    const side = cycleSides[i % cycleSides.length];
    let picked = null;
    const list = candidatesBySide[side] || [];
    for (const candidate of list) {
      const key = `${candidate.x},${candidate.y}`;
      if (seen.has(key)) {
        continue;
      }
      if (minDistance > 0 && sources.some((source) => manhattanDistance(source, candidate) < minDistance)) {
        continue;
      }
      picked = candidate;
      break;
    }
    if (!picked) {
      for (const candidate of candidates) {
        const key = `${candidate.x},${candidate.y}`;
        if (seen.has(key)) {
          continue;
        }
        if (minDistance > 0 && sources.some((source) => manhattanDistance(source, candidate) < minDistance)) {
          continue;
        }
        picked = candidate;
        break;
      }
    }
    if (!picked && candidates.length > 0) {
      picked = candidates[Math.floor((rng ? rng() : Math.random()) * candidates.length)];
    }
    if (picked) {
      sources.push({ x: picked.x, y: picked.y });
      seen.add(`${picked.x},${picked.y}`);
    }
  }

  if (sources.length < count) {
    for (const candidate of candidates) {
      if (sources.length >= count) {
        break;
      }
      const key = `${candidate.x},${candidate.y}`;
      if (seen.has(key)) {
        continue;
      }
      sources.push({ x: candidate.x, y: candidate.y });
      seen.add(key);
    }
  }

  if (sources.length === 0) {
    const fallback = pickRiverSource(heightMap);
    sources.push({ x: fallback.x, y: fallback.y });
  }

  return sources;
}

function manhattanDistance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

// Function: pickRiverSource.
function pickRiverSource(heightMap) {
  const height = heightMap.length;
  const width = height > 0 ? heightMap[0].length : 0;
  let best = { x: 0, y: 0, h: -1 };
  for (let y = 0; y < height; y += 1) {
    const h = heightMap[y][0];
    if (h > best.h) {
      best = { x: 0, y, h };
    }
  }
  for (let x = 0; x < width; x += 1) {
    const h = heightMap[0][x];
    if (h > best.h) {
      best = { x, y: 0, h };
    }
  }
  return best;
}

// Function: carveRiverValley.
function carveRiverValley(heightMap, river, valley) {
  const height = heightMap.length;
  const width = height > 0 ? heightMap[0].length : 0;
  const carved = heightMap.map((row) => row.slice());
  for (const cell of river) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const x = cell.x + dx;
        const y = cell.y + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) {
          continue;
        }
        const drop = dx === 0 && dy === 0 ? valley.riverValleyDrop : valley.riverValleyDropAdjacent;
        carved[y][x] = Math.max(0, carved[y][x] - drop);
      }
    }
  }
  return carved;
}

// Function: smoothClusterMap.
function smoothClusterMap(map, baseTypes, keepFn) {
  const height = map.length;
  const width = height > 0 ? map[0].length : 0;
  const next = map.map((row) => row.slice());
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const base = baseTypes[y][x];
      if (base === 'river' || base === 'lake' || base === 'mountain') {
        continue;
      }
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            continue;
          }
          if (map[ny][nx]) {
            count += 1;
          }
        }
      }
      if (count >= 4 && keepFn(x, y)) {
        next[y][x] = true;
      }
      if (count <= 1) {
        next[y][x] = false;
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      map[y][x] = next[y][x];
    }
  }
}

// Function: buildValleyFoodMask.
function buildValleyFoodMask(width, height, baseTypes, dist, humidity, forest, valley, seed) {
  const food = Array.from({ length: height }, () => new Array(width).fill(false));
  const settings = valley.food || {};
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const base = baseTypes[y][x];
      if (base !== 'fertile' && base !== 'plain') {
        continue;
      }
      if (forest[y][x]) {
        continue;
      }
      if (dist[y][x] > settings.waterDistanceMax) {
        continue;
      }
      if (humidity[y][x] < settings.humidityMin) {
        continue;
      }
      const noise = fractalNoise(
        x * settings.noiseScale,
        y * settings.noiseScale,
        seed + 143,
        3,
        0.5,
        2.0,
      );
      if (noise > settings.noiseThreshold) {
        food[y][x] = true;
      }
    }
  }
  for (let pass = 0; pass < settings.clusterPasses; pass += 1) {
    smoothClusterMap(food, baseTypes, (x, y) => {
      const base = baseTypes[y][x];
      if (base !== 'fertile' && base !== 'plain') {
        return false;
      }
      if (forest[y][x]) {
        return false;
      }
      if (dist[y][x] > settings.waterDistanceMax) {
        return false;
      }
      return humidity[y][x] >= settings.humidityMin;
    });
  }
  return food;
}

// Function: hasNearbyCluster.
function hasNearbyCluster(map, x, y) {
  const height = map.length;
  const width = height > 0 ? map[0].length : 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }
      if (map[ny][nx]) {
        return true;
      }
    }
  }
  return false;
}

// Function: createTerrainRng.
function createTerrainRng(seed) {
  let t = (Number(seed) >>> 0) || 1;
  return function random() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Function: randomBetweenWithRng.
function randomBetweenWithRng(rng, min, max) {
  const low = Number.isFinite(min) ? Number(min) : 0;
  const high = Number.isFinite(max) ? Number(max) : low;
  if (high <= low) {
    return low;
  }
  const rand = typeof rng === 'function' ? rng() : Math.random();
  return Math.floor(rand * (high - low + 1)) + low;
}

module.exports = {
  createTerrain,
  getTerrainSpawnPredicate,
  getTerrainResourcePredicate,
  findNearestWalkable,
};
