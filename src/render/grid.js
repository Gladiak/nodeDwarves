'use strict';

const { applyColor } = require('./colors');

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pickSymbol(value, fallback) {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return fallback;
}

function normalizeRiverSymbols(raw) {
  return {
    horizontal: pickSymbol(raw && raw.horizontal, '\u2500'),
    vertical: pickSymbol(raw && raw.vertical, '\u2502'),
    cornerNE: pickSymbol(raw && raw.cornerNE, '\u2514'),
    cornerNW: pickSymbol(raw && raw.cornerNW, '\u2518'),
    cornerSE: pickSymbol(raw && raw.cornerSE, '\u250c'),
    cornerSW: pickSymbol(raw && raw.cornerSW, '\u2510'),
    teeNorth: pickSymbol(raw && raw.teeNorth, '\u2534'),
    teeSouth: pickSymbol(raw && raw.teeSouth, '\u252c'),
    teeEast: pickSymbol(raw && raw.teeEast, '\u251c'),
    teeWest: pickSymbol(raw && raw.teeWest, '\u2524'),
    cross: pickSymbol(raw && raw.cross, '\u253c'),
  };
}

function buildRiverConnections(terrainConfig) {
  const raw = terrainConfig && terrainConfig.riverConnectsTo;
  const list = Array.isArray(raw) ? raw : ['river'];
  const set = new Set();
  for (const item of list) {
    if (typeof item === 'string' && item.length > 0) {
      set.add(item);
    }
  }
  if (!set.has('river')) {
    set.add('river');
  }
  return set;
}

function randomFromSeed(seed, x, y) {
  let h = (Number(seed) >>> 0) ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967295;
}

function getPlainSymbol(terrainConfig, terrain, x, y, fallback) {
  const config = terrainConfig && terrainConfig.plainSymbols;
  if (!config || typeof config !== 'object') {
    return fallback;
  }
  const primary = pickSymbol(config.primary, fallback);
  const secondary = pickSymbol(config.secondary, fallback);
  const weight = clamp(Number(config.primaryWeight ?? 0.7), 0, 1);
  const seed = terrain && Number.isFinite(terrain.seed) ? Number(terrain.seed) : 0;
  const roll = randomFromSeed(seed, x, y);
  return roll < weight ? primary : secondary;
}

function getTerrainType(terrain, x, y) {
  if (!terrain || !terrain.types || !terrain.types[y]) {
    return null;
  }
  return terrain.types[y][x] || null;
}

function getRiverSymbol(terrain, riverSymbols, riverConnections, x, y, fallback) {
  const north = riverConnections.has(getTerrainType(terrain, x, y - 1));
  const south = riverConnections.has(getTerrainType(terrain, x, y + 1));
  const west = riverConnections.has(getTerrainType(terrain, x - 1, y));
  const east = riverConnections.has(getTerrainType(terrain, x + 1, y));
  const mask = (north ? 1 : 0) | (south ? 2 : 0) | (west ? 4 : 0) | (east ? 8 : 0);

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
  const terrainEnabled = terrainConfig.enabled !== false
    && terrain
    && terrain.types
    && terrain.width === width
    && terrain.height === height;
  const riverSymbols = normalizeRiverSymbols(terrainConfig.riverSymbols || {});
  const riverConnections = buildRiverConnections(terrainConfig);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (terrainEnabled) {
        const type = terrain.types[y] ? terrain.types[y][x] : null;
        const baseSymbol = type && terrain.symbols && terrain.symbols[type]
          ? terrain.symbols[type]
          : emptySymbol;
        let symbol = baseSymbol;
        if (type === 'river') {
          symbol = getRiverSymbol(terrain, riverSymbols, riverConnections, x, y, baseSymbol);
        } else if (type === 'plain' || type === 'grass') {
          symbol = getPlainSymbol(terrainConfig, terrain, x, y, baseSymbol);
        }
        const colorKey = type ? `terrain_${type}` : null;
        grid[y][x] = colorKey ? applyColor(symbol, colorKey, colors) : symbol;
      } else {
        grid[y][x] = emptySymbol;
      }
    }
  }

  return grid;
}

module.exports = { buildGridBase };
