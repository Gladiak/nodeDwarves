'use strict';

const { applyColor } = require('./colors');

// Draw bounded inherited sites on the current surface without mutating simulation state.
function renderWorldLegacyEchoes(grid, state, config, colors) {
  const settings = config && config.world_legacy || {};
  const echoSettings = settings.echoes || {};
  if (settings.enabled === false || echoSettings.enabled === false) return 0;
  const echoes = Array.isArray(state?.worldLegacy?.echoes) ? state.worldLegacy.echoes : [];
  const symbol = String(config?.symbols?.world_legacy_echo || '*')[0] || '*';
  const colorKey = String(echoSettings.color_key || 'world_legacy_echo');
  let rendered = 0;
  for (const echo of echoes) {
    const location = echo && echo.location;
    const x = Number(location && location.x);
    const y = Number(location && location.y);
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || !grid[y] || grid[y][x] === undefined) continue;
    grid[y][x] = applyColor(symbol, colorKey, colors);
    rendered += 1;
  }
  return rendered;
}

module.exports = { renderWorldLegacyEchoes };
