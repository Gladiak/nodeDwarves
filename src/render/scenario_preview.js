'use strict';

const { resolveScenario } = require('../game_session');
const { createSessionRandom, withSessionRandom } = require('../session_random');
const { createTerrain } = require('../state/terrain');
const { updateSeason } = require('../simulation/season');
const { buildGridBase } = require('./grid');
const { getColorConfig } = require('./colors');
const { getTerrainColors } = require('./map_readability');

const previews = new WeakMap();

// Generate the exact initial terrain for the launch seed/dimensions without creating or advancing a colony.
function getScenarioPreview(config, runtime, scenarioId, seed) {
  let cache = previews.get(config);
  if (!cache) { cache = new Map(); previews.set(config, cache); }
  const key = `${scenarioId}:${seed}:${runtime.gridWidth}:${runtime.gridHeight}:${JSON.stringify(runtime.mapInset)}`;
  if (cache.has(key)) {
    const cached = cache.get(key); cache.delete(key); cache.set(key, cached); return cached;
  }
  const resolved = resolveScenario(config, scenarioId).config;
  const terrain = withSessionRandom(createSessionRandom(seed), () => createTerrain(resolved, runtime));
  const state = { terrain, roads: null, tick: 1 };
  updateSeason(state, resolved);
  const colors = getTerrainColors(resolved, getColorConfig(resolved));
  const grid = buildGridBase(state, resolved, runtime, colors, '.');
  const preview = { seed, width: runtime.gridWidth, height: runtime.gridHeight, grid,
    enabled: config.startup?.preview?.enabled !== false };
  cache.set(key, preview);
  const capacity = Math.max(1, Math.min(12, Number(config.startup?.preview?.cache_entries || 4)));
  while (cache.size > capacity) cache.delete(cache.keys().next().value);
  return preview;
}

// Downsample to the available ASCII rectangle, retaining the full map extent and aspect ratio.
function fitScenarioPreview(preview, width, height) {
  if (!preview || width <= 0 || height <= 0) return [];
  const scale = Math.min(1, width / preview.width, height / preview.height);
  const columns = Math.max(1, Math.floor(preview.width * scale));
  const rows = Math.max(1, Math.floor(preview.height * scale));
  return Array.from({ length: rows }, (_, y) => Array.from({ length: columns }, (_, x) => {
    const sourceY = Math.min(preview.height - 1, Math.floor((y + 0.5) * preview.height / rows));
    const sourceX = Math.min(preview.width - 1, Math.floor((x + 0.5) * preview.width / columns));
    return preview.grid[sourceY][sourceX];
  }));
}

module.exports = { getScenarioPreview, fitScenarioPreview };
