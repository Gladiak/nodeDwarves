'use strict';

const { applyColor } = require('./colors');

// Draw the active nemesis front and damaged structures without mutating simulation state.
function renderEpicConflicts(grid, state, config, colors) {
  const settings = config && config.epic_conflicts || {};
  if (settings.enabled === false) return { nemesis: 0, damage: 0 };
  const symbols = config && config.symbols || {};
  let damage = 0;
  for (const structure of Array.isArray(state && state.structures) ? state.structures : []) {
    if (!structure || !structure.siegeDamage) continue;
    if (!isGridCell(grid, structure.x, structure.y)) continue;
    grid[structure.y][structure.x] = applyColor(symbols.siege_damage || 'x', 'siege_damage', colors);
    damage += 1;
  }
  const siege = state && state.epicConflict && state.epicConflict.activeSiege;
  const location = siege && siege.location;
  if (!location || location.scope !== 'surface' || !isGridCell(grid, location.x, location.y)) {
    return { nemesis: 0, damage };
  }
  grid[location.y][location.x] = applyColor(symbols.nemesis || 'N', 'nemesis', colors);
  return { nemesis: 1, damage };
}

function isGridCell(grid, xRaw, yRaw) {
  const x = Number(xRaw);
  const y = Number(yRaw);
  return Number.isSafeInteger(x) && Number.isSafeInteger(y) && grid[y] && grid[y][x] !== undefined;
}

module.exports = { renderEpicConflicts };
