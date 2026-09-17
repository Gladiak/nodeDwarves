'use strict';

const { getLandmarkRenderTiles } = require('../simulation/landmarks');
const { applyColor } = require('./colors');

// Draw landmark footprints and compact district markers without mutating simulation state.
function renderLandmarks(grid, state, config, runtime, colors, structurePositions) {
  for (const tile of getLandmarkRenderTiles(state, config, runtime)) {
    if (!tile || !grid[tile.y] || grid[tile.y][tile.x] === undefined) continue;
    grid[tile.y][tile.x] = applyColor(tile.symbol, tile.colorKey, colors);
    if (structurePositions) structurePositions.add(`${tile.x},${tile.y}`);
  }
}

module.exports = { renderLandmarks };
