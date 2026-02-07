"use strict";

const { applyColor } = require("./colors");
const {
  buildSeasonalColorContext,
  resolveSeasonalTerrainColorKey,
} = require("./seasonal_colors");

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pickSymbol(value, fallback) {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return fallback;
}

function isPastureDepleted(state, x, y) {
  const pasture = state && state.pasture;
  if (!pasture || !pasture.mask || !pasture.remaining) {
    return false;
  }
  const width = pasture.width;
  const height = pasture.height;
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return false;
  }
  const index = y * width + x;
  if (!pasture.mask[index]) {
    return false;
  }
  return Number(pasture.remaining[index] || 0) <= 0;
}

function normalizeRiverSymbols(raw) {
  return {
    horizontal: pickSymbol(raw && raw.horizontal, "\u2500"),
    vertical: pickSymbol(raw && raw.vertical, "\u2502"),
    cornerNE: pickSymbol(raw && raw.cornerNE, "\u2514"),
    cornerNW: pickSymbol(raw && raw.cornerNW, "\u2518"),
    cornerSE: pickSymbol(raw && raw.cornerSE, "\u250c"),
    cornerSW: pickSymbol(raw && raw.cornerSW, "\u2510"),
    teeNorth: pickSymbol(raw && raw.teeNorth, "\u2534"),
    teeSouth: pickSymbol(raw && raw.teeSouth, "\u252c"),
    teeEast: pickSymbol(raw && raw.teeEast, "\u251c"),
    teeWest: pickSymbol(raw && raw.teeWest, "\u2524"),
    cross: pickSymbol(raw && raw.cross, "\u253c"),
  };
}

function normalizeRoadSymbols(roadRaw, riverRaw) {
  const road = normalizeRiverSymbols(roadRaw || {});
  const river = normalizeRiverSymbols(riverRaw || {});
  return {
    horizontal: pickSymbol(road.horizontal, river.horizontal),
    vertical: pickSymbol(road.vertical, river.vertical),
    cornerNE: pickSymbol(road.cornerNE, river.cornerNE),
    cornerNW: pickSymbol(road.cornerNW, river.cornerNW),
    cornerSE: pickSymbol(road.cornerSE, river.cornerSE),
    cornerSW: pickSymbol(road.cornerSW, river.cornerSW),
    teeNorth: pickSymbol(road.teeNorth, river.teeNorth),
    teeSouth: pickSymbol(road.teeSouth, river.teeSouth),
    teeEast: pickSymbol(road.teeEast, river.teeEast),
    teeWest: pickSymbol(road.teeWest, river.teeWest),
    cross: pickSymbol(road.cross, river.cross),
  };
}

function normalizeRoadSpecialSymbols(raw) {
  return {
    bridge: pickSymbol(raw && raw.bridge, "="),
    ford: pickSymbol(raw && raw.ford, ":"),
  };
}

function normalizeUnderrealmCorridorSymbols(raw) {
  return {
    horizontal: pickSymbol(raw && raw.horizontal, "\u2550"),
    vertical: pickSymbol(raw && raw.vertical, "\u2551"),
    cornerNE: pickSymbol(raw && raw.cornerNE, "\u255a"),
    cornerNW: pickSymbol(raw && raw.cornerNW, "\u255d"),
    cornerSE: pickSymbol(raw && raw.cornerSE, "\u2554"),
    cornerSW: pickSymbol(raw && raw.cornerSW, "\u2557"),
    teeNorth: pickSymbol(raw && raw.teeNorth, "\u2569"),
    teeSouth: pickSymbol(raw && raw.teeSouth, "\u2566"),
    teeEast: pickSymbol(raw && raw.teeEast, "\u2560"),
    teeWest: pickSymbol(raw && raw.teeWest, "\u2563"),
    cross: pickSymbol(raw && raw.cross, "\u256c"),
  };
}

function buildRiverConnections(terrainConfig) {
  const raw = terrainConfig && terrainConfig.riverConnectsTo;
  const list = Array.isArray(raw) ? raw : ["river"];
  const set = new Set();
  for (const item of list) {
    if (typeof item === "string" && item.length > 0) {
      set.add(item);
    }
  }
  if (!set.has("river")) {
    set.add("river");
  }
  return set;
}

function getUnderrealmCorridorSymbol(terrain, corridorSymbols, x, y, fallback) {
  if (!terrain || !terrain.types || !terrain.types[y] || terrain.types[y][x] !== "corridor") {
    return fallback;
  }
  const has = (dx, dy) => {
    const row = terrain.types[y + dy];
    if (!row) {
      return false;
    }
    return row[x + dx] === "corridor";
  };
  const north = has(0, -1);
  const south = has(0, 1);
  const west = has(-1, 0);
  const east = has(1, 0);
  const key =
    (north ? 1 : 0) +
    (south ? 2 : 0) +
    (west ? 4 : 0) +
    (east ? 8 : 0);
  switch (key) {
    case 1:
    case 2:
    case 3:
      return corridorSymbols.vertical;
    case 4:
    case 8:
    case 12:
      return corridorSymbols.horizontal;
    case 5:
      return corridorSymbols.cornerNW;
    case 6:
      return corridorSymbols.cornerSW;
    case 9:
      return corridorSymbols.cornerNE;
    case 10:
      return corridorSymbols.cornerSE;
    case 7:
      return corridorSymbols.teeWest;
    case 11:
      return corridorSymbols.teeEast;
    case 13:
      return corridorSymbols.teeNorth;
    case 14:
      return corridorSymbols.teeSouth;
    case 15:
      return corridorSymbols.cross;
    default:
      return fallback;
  }
}

function isRoadType(value) {
  return value === "road" || value === "bridge" || value === "ford";
}

function getRoadSymbol(roads, roadSymbols, x, y, fallback) {
  if (!roads || !roads.types || !roads.types[y]) {
    return fallback;
  }
  const has = (dx, dy) => {
    const row = roads.types[y + dy];
    if (!row) {
      return false;
    }
    return isRoadType(row[x + dx]);
  };
  const north = has(0, -1);
  const south = has(0, 1);
  const west = has(-1, 0);
  const east = has(1, 0);
  const key =
    (north ? 1 : 0) +
    (south ? 2 : 0) +
    (west ? 4 : 0) +
    (east ? 8 : 0);
  switch (key) {
    case 1:
    case 2:
    case 3:
      return roadSymbols.vertical;
    case 4:
    case 8:
    case 12:
      return roadSymbols.horizontal;
    case 5:
      return roadSymbols.cornerNW;
    case 6:
      return roadSymbols.cornerSW;
    case 9:
      return roadSymbols.cornerNE;
    case 10:
      return roadSymbols.cornerSE;
    case 7:
      return roadSymbols.teeWest;
    case 11:
      return roadSymbols.teeEast;
    case 13:
      return roadSymbols.teeNorth;
    case 14:
      return roadSymbols.teeSouth;
    case 15:
      return roadSymbols.cross;
    default:
      return fallback;
  }
}

function randomFromSeed(seed, x, y) {
  let h =
    (Number(seed) >>> 0) ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967295;
}

function fade(t) {
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothValueNoise(x, y, seed) {
  const x0 = Math.floor(x);
  const x1 = x0 + 1;
  const y0 = Math.floor(y);
  const y1 = y0 + 1;
  const sx = fade(x - x0);
  const sy = fade(y - y0);

  const n00 = randomFromSeed(seed, x0, y0);
  const n10 = randomFromSeed(seed, x1, y0);
  const n01 = randomFromSeed(seed, x0, y1);
  const n11 = randomFromSeed(seed, x1, y1);

  const ix0 = lerp(n00, n10, sx);
  const ix1 = lerp(n01, n11, sx);
  return lerp(ix0, ix1, sy);
}

function getPlainSymbol(terrainConfig, terrain, x, y, fallback) {
  const config = terrainConfig?.plainSymbols;
  if (!config || typeof config !== "object") return fallback;

  const primary = pickSymbol(config.primary, fallback);
  const secondary = pickSymbol(config.secondary, fallback);
  const tertiary = pickSymbol(config.tertiary, fallback);

  const w1 = clamp(Number(config.primaryWeight ?? 0.7), 0, 1);
  const w2 = clamp(Number(config.secondaryWeight ?? 0.15), 0, 1);

  // opzionale: evita che w1+w2 superi 1
  const w2c = Math.min(w2, 1 - w1);

  const seed =
    terrain && Number.isFinite(terrain.seed) ? Number(terrain.seed) : 0;
  const roll = randomFromSeed(seed, x, y);

  if (roll < w1) return primary;
  if (roll < w1 + w2c) return secondary;
  return tertiary;
}

function countForestNeighbors(terrain, x, y) {
  if (!terrain || !terrain.types) {
    return 0;
  }
  let count = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    const row = terrain.types[y + dy];
    if (!row) {
      continue;
    }
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      if (row[x + dx] === "forest") {
        count += 1;
      }
    }
  }
  return count;
}

function getForestSymbolData(terrainConfig, terrain, x, y, fallback) {
  const config = terrainConfig?.forestSymbols;
  if (!config || typeof config !== "object") {
    return { symbol: fallback, dense: false };
  }

  const primary = pickSymbol(config.primary, fallback);
  const dense = pickSymbol(config.dense, primary);
  const minNeighbors = Math.max(
    0,
    Math.floor(Number(config.denseMinNeighbors ?? 6)),
  );
  if (minNeighbors <= 0) {
    return { symbol: dense, dense: true };
  }
  const neighbors = countForestNeighbors(terrain, x, y);
  let isDense = neighbors >= minNeighbors;
  if (isDense) {
    const noiseScale = Math.max(
      0,
      Number(config.denseNoiseScale ?? config.denseNoise?.scale ?? 0.2),
    );
    const noiseThreshold = clamp(
      Number(
        config.denseNoiseThreshold ?? config.denseNoise?.threshold ?? 0.55,
      ),
      0,
      1,
    );
    if (noiseScale > 0) {
      const seedOffset = Number.isFinite(config.denseNoiseSeedOffset)
        ? Number(config.denseNoiseSeedOffset)
        : 0;
      const terrainSeed =
        terrain && Number.isFinite(terrain.seed) ? Number(terrain.seed) : 0;
      const noise = smoothValueNoise(x * noiseScale, y * noiseScale, terrainSeed + seedOffset);
      isDense = noise >= noiseThreshold;
    }
  }
  return { symbol: isDense ? dense : primary, dense: isDense };
}

function countHillNeighbors(terrain, x, y) {
  if (!terrain || !terrain.types) {
    return 0;
  }
  let count = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    const row = terrain.types[y + dy];
    if (!row) {
      continue;
    }
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      if (row[x + dx] === "hill") {
        count += 1;
      }
    }
  }
  return count;
}

function countMountainNeighbors(terrain, x, y) {
  if (!terrain || !terrain.types) {
    return 0;
  }
  let count = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    const row = terrain.types[y + dy];
    if (!row) {
      continue;
    }
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      if (row[x + dx] === "mountain") {
        count += 1;
      }
    }
  }
  return count;
}

function countStoneNeighbors(terrain, x, y) {
  if (!terrain || !terrain.types) {
    return 0;
  }
  let count = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    const row = terrain.types[y + dy];
    if (!row) {
      continue;
    }
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      if (row[x + dx] === "stone") {
        count += 1;
      }
    }
  }
  return count;
}

function hasAdjacentTerrain(terrain, x, y, type) {
  if (!terrain || !terrain.types) {
    return false;
  }
  for (let dy = -1; dy <= 1; dy += 1) {
    const row = terrain.types[y + dy];
    if (!row) {
      continue;
    }
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      if (row[x + dx] === type) {
        return true;
      }
    }
  }
  return false;
}

function getHillSymbolData(terrainConfig, terrain, x, y, fallback) {
  const config = terrainConfig?.hillSymbols;
  if (!config || typeof config !== "object") {
    return { symbol: fallback, pronounced: false };
  }

  const primary = pickSymbol(config.primary, fallback);
  const pronounced = pickSymbol(config.pronounced, primary);
  if (config.pronouncedNearMountain !== false) {
    if (hasAdjacentTerrain(terrain, x, y, "mountain")) {
      return { symbol: pronounced, pronounced: true };
    }
  }
  const minNeighbors = Math.max(
    0,
    Math.floor(Number(config.pronouncedMinNeighbors ?? 6)),
  );
  if (minNeighbors <= 0) {
    return { symbol: pronounced, pronounced: true };
  }

  const neighbors = countHillNeighbors(terrain, x, y);
  let isPronounced = neighbors >= minNeighbors;
  if (isPronounced) {
    const noiseScale = Math.max(
      0,
      Number(config.pronouncedNoiseScale ?? config.pronouncedNoise?.scale ?? 0.2),
    );
    const noiseThreshold = clamp(
      Number(
        config.pronouncedNoiseThreshold ??
          config.pronouncedNoise?.threshold ??
          0.55,
      ),
      0,
      1,
    );
    if (noiseScale > 0) {
      const seedOffset = Number.isFinite(config.pronouncedNoiseSeedOffset)
        ? Number(config.pronouncedNoiseSeedOffset)
        : 0;
      const terrainSeed =
        terrain && Number.isFinite(terrain.seed) ? Number(terrain.seed) : 0;
      const noise = smoothValueNoise(
        x * noiseScale,
        y * noiseScale,
        terrainSeed + seedOffset,
      );
      isPronounced = noise >= noiseThreshold;
    }
  }

  return { symbol: isPronounced ? pronounced : primary, pronounced: isPronounced };
}

function getMountainSymbolData(terrainConfig, terrain, x, y, fallback) {
  const config = terrainConfig?.mountainSymbols;
  if (!config || typeof config !== "object") {
    return { symbol: fallback, high: false };
  }

  const medium = pickSymbol(config.medium, fallback);
  const high = pickSymbol(config.high, medium);
  if (config.mediumNearHill !== false) {
    if (hasAdjacentTerrain(terrain, x, y, "hill")) {
      return { symbol: medium, high: false };
    }
  }

  const minNeighbors = Math.max(
    0,
    Math.floor(Number(config.highMinNeighbors ?? 6)),
  );
  if (minNeighbors <= 0) {
    return { symbol: high, high: true };
  }

  const neighbors = countMountainNeighbors(terrain, x, y);
  let isHigh = neighbors >= minNeighbors;
  if (isHigh) {
    const noiseScale = Math.max(
      0,
      Number(config.highNoiseScale ?? config.highNoise?.scale ?? 0.2),
    );
    const noiseThreshold = clamp(
      Number(config.highNoiseThreshold ?? config.highNoise?.threshold ?? 0.55),
      0,
      1,
    );
    if (noiseScale > 0) {
      const seedOffset = Number.isFinite(config.highNoiseSeedOffset)
        ? Number(config.highNoiseSeedOffset)
        : 0;
      const terrainSeed =
        terrain && Number.isFinite(terrain.seed) ? Number(terrain.seed) : 0;
      const noise = smoothValueNoise(
        x * noiseScale,
        y * noiseScale,
        terrainSeed + seedOffset,
      );
      isHigh = noise >= noiseThreshold;
    }
  }

  return { symbol: isHigh ? high : medium, high: isHigh };
}

function getStoneSymbolData(terrainConfig, terrain, x, y, fallback) {
  const config = terrainConfig?.mountainSymbols;
  if (!config || typeof config !== "object") {
    return { symbol: fallback, high: false };
  }

  const medium = pickSymbol(config.medium, fallback);
  const high = pickSymbol(config.high, medium);
  if (config.mediumNearHill !== false) {
    if (hasAdjacentTerrain(terrain, x, y, "hill")) {
      return { symbol: medium, high: false };
    }
  }

  const minNeighbors = Math.max(
    0,
    Math.floor(Number(config.highMinNeighbors ?? 6)),
  );
  if (minNeighbors <= 0) {
    return { symbol: high, high: true };
  }

  const neighbors = countStoneNeighbors(terrain, x, y);
  let isHigh = neighbors >= minNeighbors;
  if (isHigh) {
    const noiseScale = Math.max(
      0,
      Number(config.highNoiseScale ?? config.highNoise?.scale ?? 0.2),
    );
    const noiseThreshold = clamp(
      Number(config.highNoiseThreshold ?? config.highNoise?.threshold ?? 0.55),
      0,
      1,
    );
    if (noiseScale > 0) {
      const seedOffset = Number.isFinite(config.highNoiseSeedOffset)
        ? Number(config.highNoiseSeedOffset)
        : 0;
      const terrainSeed =
        terrain && Number.isFinite(terrain.seed) ? Number(terrain.seed) : 0;
      const noise = smoothValueNoise(
        x * noiseScale,
        y * noiseScale,
        terrainSeed + seedOffset,
      );
      isHigh = noise >= noiseThreshold;
    }
  }

  return { symbol: isHigh ? high : medium, high: isHigh };
}

function getTerrainType(terrain, x, y) {
  if (!terrain || !terrain.types || !terrain.types[y]) {
    return null;
  }
  return terrain.types[y][x] || null;
}

function getActiveUnderrealmDepth(state) {
  const underrealm = state && state.underrealm;
  if (!underrealm || underrealm.enabled === false) {
    return 0;
  }
  const maxUnlockedDepth = Math.max(
    0,
    Math.floor(Number(underrealm.maxUnlockedDepth || 0)),
  );
  const activeDepth = Math.max(0, Math.floor(Number(underrealm.activeDepth || 0)));
  return clamp(activeDepth, 0, maxUnlockedDepth);
}

function resolveRenderTerrain(state) {
  const activeDepth = getActiveUnderrealmDepth(state);
  if (activeDepth <= 0) {
    return state.terrain;
  }
  const underrealm = state && state.underrealm;
  const layers = underrealm && Array.isArray(underrealm.layers)
    ? underrealm.layers
    : [];
  const layer = layers.find((entry) => Number(entry && entry.depth) === activeDepth);
  if (layer && layer.terrain) {
    return layer.terrain;
  }
  return state.terrain;
}

function resolveTerrainViewport(runtime, terrain) {
  const gridWidth = Math.max(0, Number(runtime && runtime.gridWidth || 0));
  const gridHeight = Math.max(0, Number(runtime && runtime.gridHeight || 0));
  const terrainWidth = Math.max(0, Number(terrain && terrain.width || 0));
  const terrainHeight = Math.max(0, Number(terrain && terrain.height || 0));
  const offsetX = terrainWidth < gridWidth
    ? Math.floor((gridWidth - terrainWidth) / 2)
    : 0;
  const offsetY = terrainHeight < gridHeight
    ? Math.floor((gridHeight - terrainHeight) / 2)
    : 0;
  return { offsetX, offsetY };
}

function resolveDenseForestColorKey(baseKey, colors) {
  if (!baseKey || !colors || !colors.map) {
    return baseKey;
  }
  const prefix = "terrain_forest";
  if (baseKey === prefix || baseKey.startsWith(`${prefix}_`)) {
    const suffix = baseKey.slice(prefix.length);
    const denseKey = `terrain_forest_dense${suffix}`;
    if (colors.map[denseKey]) {
      return denseKey;
    }
  }
  return baseKey;
}

function resolvePronouncedHillColorKey(baseKey, colors) {
  if (!baseKey || !colors || !colors.map) {
    return baseKey;
  }
  const prefix = "terrain_hill";
  if (baseKey === prefix || baseKey.startsWith(`${prefix}_`)) {
    const suffix = baseKey.slice(prefix.length);
    const pronouncedKey = `terrain_hill_pronounced${suffix}`;
    if (colors.map[pronouncedKey]) {
      return pronouncedKey;
    }
  }
  return baseKey;
}

function resolveMountainColorKey(baseKey, colors, isHigh) {
  if (!baseKey || !colors || !colors.map) {
    return baseKey;
  }
  const prefix = "terrain_mountain";
  if (!(baseKey === prefix || baseKey.startsWith(`${prefix}_`))) {
    return baseKey;
  }
  const suffix = baseKey.slice(prefix.length);
  const highKey = `terrain_mountain_high${suffix}`;
  const mediumKey = `terrain_mountain_medium${suffix}`;
  if (isHigh && colors.map[highKey]) {
    return highKey;
  }
  if (!isHigh && colors.map[mediumKey]) {
    return mediumKey;
  }
  return baseKey;
}

function getRiverSymbol(
  terrain,
  riverSymbols,
  riverConnections,
  x,
  y,
  fallback,
) {
  const north = riverConnections.has(getTerrainType(terrain, x, y - 1));
  const south = riverConnections.has(getTerrainType(terrain, x, y + 1));
  const west = riverConnections.has(getTerrainType(terrain, x - 1, y));
  const east = riverConnections.has(getTerrainType(terrain, x + 1, y));
  const mask =
    (north ? 1 : 0) | (south ? 2 : 0) | (west ? 4 : 0) | (east ? 8 : 0);

  switch (mask) {
    case 0:
      return fallback;
    case 1:
    case 2:
    case 3:
      return riverSymbols.vertical;
    case 4:
    case 8:
    case 12:
      return riverSymbols.horizontal;
    case 5:
      return riverSymbols.cornerNW;
    case 9:
      return riverSymbols.cornerNE;
    case 6:
      return riverSymbols.cornerSW;
    case 10:
      return riverSymbols.cornerSE;
    case 7:
      return riverSymbols.teeWest;
    case 11:
      return riverSymbols.teeEast;
    case 13:
      return riverSymbols.teeNorth;
    case 14:
      return riverSymbols.teeSouth;
    case 15:
      return riverSymbols.cross;
    default:
      return fallback;
  }
}

// Build the base grid with terrain or empty symbols.
function buildGridBase(state, config, runtime, colors, emptySymbol) {
  const height = Math.max(0, Number(runtime.gridHeight || 0));
  const width = Math.max(0, Number(runtime.gridWidth || 0));
  const grid = Array.from({ length: height }, () => new Array(width));
  const display = (config && config.display) || {};
  const terrainConfig = display.terrain || {};
  const terrain = resolveRenderTerrain(state);
  const roadsConfig = config.roads || {};
  const roads = state.roads;
  const activeUnderrealmDepth = getActiveUnderrealmDepth(state);
  const underrealmViewActive = activeUnderrealmDepth > 0;
  const viewport = resolveTerrainViewport(runtime, terrain);
  const terrainEnabled =
    terrainConfig.enabled !== false &&
    terrain &&
    terrain.types;
  const roadsEnabled =
    !underrealmViewActive &&
    roadsConfig.enabled !== false &&
    roads &&
    roads.types &&
    roads.width === width &&
    roads.height === height;
  const riverSymbols = normalizeRiverSymbols(terrainConfig.riverSymbols || {});
  const riverConnections = buildRiverConnections(terrainConfig);
  const roadSymbols = normalizeRoadSymbols(
    terrainConfig.roadSymbols || {},
    terrainConfig.riverSymbols || {},
  );
  const roadSpecialSymbols = normalizeRoadSpecialSymbols(
    terrainConfig.roadSpecialSymbols || {},
  );
  const underrealmTerrainConfig = (config && config.underrealm && config.underrealm.terrain) || {};
  const underrealmCorridorSymbols = normalizeUnderrealmCorridorSymbols(
    underrealmTerrainConfig.corridor_symbols || {},
  );
  const underrealmVoidSymbol = underrealmViewActive
    ? pickSymbol(underrealmTerrainConfig.void_symbol, " ")
    : emptySymbol;
  const underrealmVoidColorKey = underrealmViewActive
    && typeof underrealmTerrainConfig.void_color_key === "string"
    && underrealmTerrainConfig.void_color_key.length > 0
    ? underrealmTerrainConfig.void_color_key
    : null;
  const seasonalContext = underrealmViewActive
    ? null
    : buildSeasonalColorContext(
      state,
      config,
      terrain,
      colors,
    );

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const terrainX = x - viewport.offsetX;
      const terrainY = y - viewport.offsetY;
      const inTerrainBounds = terrainEnabled
        && terrainY >= 0
        && terrainY < terrain.height
        && terrainX >= 0
        && terrainX < terrain.width;
      if (inTerrainBounds) {
        const type = terrain.types[terrainY] ? terrain.types[terrainY][terrainX] : null;
        const baseSymbol =
          type && terrain.symbols && terrain.symbols[type]
            ? terrain.symbols[type]
            : emptySymbol;
        let symbol = baseSymbol;
        let forestDense = false;
        let hillPronounced = false;
        let mountainHigh = false;
        if (type === "river") {
          symbol = getRiverSymbol(
            terrain,
            riverSymbols,
            riverConnections,
            terrainX,
            terrainY,
            baseSymbol,
          );
        } else if (type === "plain" || type === "grass") {
          symbol = getPlainSymbol(
            terrainConfig,
            terrain,
            terrainX,
            terrainY,
            baseSymbol,
          );
        } else if (type === "forest") {
          const forestData = getForestSymbolData(
            terrainConfig,
            terrain,
            terrainX,
            terrainY,
            baseSymbol,
          );
          symbol = forestData.symbol;
          forestDense = forestData.dense;
        } else if (type === "mountain") {
          const mountainData = getMountainSymbolData(
            terrainConfig,
            terrain,
            terrainX,
            terrainY,
            baseSymbol,
          );
          symbol = mountainData.symbol;
          mountainHigh = mountainData.high;
        } else if (type === "stone") {
          const stoneData = getStoneSymbolData(
            terrainConfig,
            terrain,
            terrainX,
            terrainY,
            baseSymbol,
          );
          symbol = stoneData.symbol;
          mountainHigh = stoneData.high;
        } else if (type === "hill") {
          const hillData = getHillSymbolData(
            terrainConfig,
            terrain,
            terrainX,
            terrainY,
            baseSymbol,
          );
          symbol = hillData.symbol;
          hillPronounced = hillData.pronounced;
        } else if (underrealmViewActive && type === "corridor") {
          symbol = getUnderrealmCorridorSymbol(
            terrain,
            underrealmCorridorSymbols,
            terrainX,
            terrainY,
            baseSymbol,
          );
        }
        const colorType = type === "stone" ? "mountain" : type;
        const baseColorKey = colorType ? `terrain_${colorType}` : null;
        const seasonalLocked = colorType === "hill" || colorType === "mountain";
        let colorKey = baseColorKey
          ? (seasonalLocked
              ? baseColorKey
              : resolveSeasonalTerrainColorKey(
                seasonalContext,
                colorType,
                terrainX,
                terrainY,
                baseColorKey,
              ))
          : null;
        if (forestDense) {
          colorKey = resolveDenseForestColorKey(colorKey, colors);
        }
        if (colorType === "mountain") {
          colorKey = resolveMountainColorKey(colorKey, colors, mountainHigh);
        }
        if (hillPronounced) {
          colorKey = resolvePronouncedHillColorKey(colorKey, colors);
        }
        if (colorType === "pasture"
            && terrain === state.terrain
            && isPastureDepleted(state, terrainX, terrainY)) {
          if (colors && colors.map && colors.map.terrain_pasture_depleted) {
            colorKey = "terrain_pasture_depleted";
          }
        }
        if (roadsEnabled && roads.types[y]) {
          const roadType = roads.types[y][x];
          if (roadType) {
            if (roadType === "bridge") {
              symbol = roadSpecialSymbols.bridge;
              colorKey =
                colors && colors.map && colors.map.terrain_bridge
                  ? "terrain_bridge"
                  : "terrain_road";
            } else if (roadType === "ford") {
              symbol = roadSpecialSymbols.ford;
              colorKey =
                colors && colors.map && colors.map.terrain_ford
                  ? "terrain_ford"
                  : "terrain_road";
            } else {
              symbol = getRoadSymbol(
                roads,
                roadSymbols,
                x,
                y,
                roadSymbols.horizontal,
              );
              colorKey =
                colors && colors.map && colors.map.terrain_road
                  ? "terrain_road"
                  : null;
            }
          }
        }
        grid[y][x] = colorKey ? applyColor(symbol, colorKey, colors) : symbol;
      } else {
        if (underrealmVoidColorKey && colors && colors.map && colors.map[underrealmVoidColorKey]) {
          grid[y][x] = applyColor(underrealmVoidSymbol, underrealmVoidColorKey, colors);
        } else {
          grid[y][x] = underrealmVoidSymbol;
        }
      }
    }
  }

  return grid;
}

module.exports = { buildGridBase };
