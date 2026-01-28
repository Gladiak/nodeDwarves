'use strict';

const { applyColor } = require('./colors');

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

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (terrainEnabled) {
        const type = terrain.types[y] ? terrain.types[y][x] : null;
        const symbol = type && terrain.symbols && terrain.symbols[type]
          ? terrain.symbols[type]
          : emptySymbol;
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
