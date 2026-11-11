'use strict';

const { applyColor } = require('./colors');

// Paint observed movement below every entity/structure layer, never over the reserved Ops inset.
function applyMapFlows(grid, overlay, runtime, colors) {
  if (!overlay?.cells) return;
  const inset = runtime.mapInset;
  for (const cell of overlay.cells) {
    if (inset && cell.x >= inset.x && cell.x < inset.x + inset.width
        && cell.y >= inset.y && cell.y < inset.y + inset.height) continue;
    if (grid[cell.y]?.[cell.x] === undefined) continue;
    grid[cell.y][cell.x] = applyColor(cell.symbol, cell.colorKey, colors);
  }
}

module.exports = { applyMapFlows };
