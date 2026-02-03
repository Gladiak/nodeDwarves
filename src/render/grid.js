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

function resolveDenseForestColorKey(baseKey, colors) {
  if (!baseKey || !colors || !colors.map) {
    return baseKey;
  }
  const denseMap = {
    terrain_forest: "terrain_forest_dense",
    terrain_forest_spring: "terrain_forest_dense_spring",
    terrain_forest_summer: "terrain_forest_dense_summer",
    terrain_forest_autumn: "terrain_forest_dense_autumn",
    terrain_forest_winter: "terrain_forest_dense_winter",
  };
  const denseKey = denseMap[baseKey];
  if (denseKey && colors.map[denseKey]) {
    return denseKey;
  }
  return baseKey;
}

function resolvePronouncedHillColorKey(baseKey, colors) {
  if (!baseKey || !colors || !colors.map) {
    return baseKey;
  }
  if (baseKey === "terrain_hill" && colors.map.terrain_hill_pronounced) {
    return "terrain_hill_pronounced";
  }
  return baseKey;
}

function resolveMountainColorKey(baseKey, colors, isHigh) {
  if (!baseKey || !colors || !colors.map) {
    return baseKey;
  }
  if (baseKey !== "terrain_mountain") {
    return baseKey;
  }
  if (isHigh && colors.map.terrain_mountain_high) {
    return "terrain_mountain_high";
  }
  if (!isHigh && colors.map.terrain_mountain_medium) {
    return "terrain_mountain_medium";
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
  const terrain = state.terrain;
  const terrainEnabled =
    terrainConfig.enabled !== false &&
    terrain &&
    terrain.types &&
    terrain.width === width &&
    terrain.height === height;
  const riverSymbols = normalizeRiverSymbols(terrainConfig.riverSymbols || {});
  const riverConnections = buildRiverConnections(terrainConfig);
  const seasonalContext = buildSeasonalColorContext(
    state,
    config,
    terrain,
    colors,
  );

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (terrainEnabled) {
        const type = terrain.types[y] ? terrain.types[y][x] : null;
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
            x,
            y,
            baseSymbol,
          );
        } else if (type === "plain" || type === "grass") {
          symbol = getPlainSymbol(terrainConfig, terrain, x, y, baseSymbol);
        } else if (type === "forest") {
          const forestData = getForestSymbolData(
            terrainConfig,
            terrain,
            x,
            y,
            baseSymbol,
          );
          symbol = forestData.symbol;
          forestDense = forestData.dense;
        } else if (type === "mountain") {
          const mountainData = getMountainSymbolData(
            terrainConfig,
            terrain,
            x,
            y,
            baseSymbol,
          );
          symbol = mountainData.symbol;
          mountainHigh = mountainData.high;
        } else if (type === "stone") {
          const stoneData = getStoneSymbolData(
            terrainConfig,
            terrain,
            x,
            y,
            baseSymbol,
          );
          symbol = stoneData.symbol;
          mountainHigh = stoneData.high;
        } else if (type === "hill") {
          const hillData = getHillSymbolData(
            terrainConfig,
            terrain,
            x,
            y,
            baseSymbol,
          );
          symbol = hillData.symbol;
          hillPronounced = hillData.pronounced;
        }
        const colorType = type === "stone" ? "mountain" : type;
        const baseColorKey = colorType ? `terrain_${colorType}` : null;
        let colorKey = baseColorKey
          ? resolveSeasonalTerrainColorKey(
              seasonalContext,
              colorType,
              x,
              y,
              baseColorKey,
            )
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
        if (colorType === "pasture" && isPastureDepleted(state, x, y)) {
          if (colors && colors.map && colors.map.terrain_pasture_depleted) {
            colorKey = "terrain_pasture_depleted";
          }
        }
        grid[y][x] = colorKey ? applyColor(symbol, colorKey, colors) : symbol;
      } else {
        grid[y][x] = emptySymbol;
      }
    }
  }

  return grid;
}

module.exports = { buildGridBase };
