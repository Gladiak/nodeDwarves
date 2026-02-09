'use strict';

const { clamp } = require('../utils');
const { getResolvedDisplayColors } = require('./colors');

// Build the seasonal color context for the current render.
function buildSeasonalColorContext(state, config, terrain, colors) {
  const colorConfig = getResolvedDisplayColors(config);
  if (colorConfig.enabled === false) {
    return null;
  }
  const seasonal = colorConfig.seasonal || {};
  if (seasonal.enabled === false) {
    return null;
  }
  const seasonState = state && state.season ? state.season : null;
  if (!seasonState || !seasonState.name) {
    return null;
  }

  const seasonConfig = config && config.seasons ? config.seasons : {};
  const order = Array.isArray(seasonConfig.order) && seasonConfig.order.length > 0
    ? seasonConfig.order
    : ['spring', 'summer', 'autumn', 'winter'];
  if (order.length <= 1) {
    return null;
  }

  const index = Number.isFinite(seasonState.index) ? seasonState.index : order.indexOf(seasonState.name);
  if (!Number.isFinite(index) || index < 0) {
    return null;
  }
  const currentName = order[index];
  const prevName = order[(index - 1 + order.length) % order.length];

  const palettes = seasonal.palettes && typeof seasonal.palettes === 'object' ? seasonal.palettes : {};
  const presetPalettes = resolveSeasonalPresetPalettes(seasonal);
  const fromPaletteBase =
    palettes[prevName] && typeof palettes[prevName] === 'object' ? palettes[prevName] : {};
  const toPaletteBase =
    palettes[currentName] && typeof palettes[currentName] === 'object' ? palettes[currentName] : {};
  const fromPalettePreset =
    presetPalettes[prevName] && typeof presetPalettes[prevName] === 'object'
      ? presetPalettes[prevName]
      : {};
  const toPalettePreset =
    presetPalettes[currentName] && typeof presetPalettes[currentName] === 'object'
      ? presetPalettes[currentName]
      : {};
  const fromPalette = { ...fromPaletteBase, ...fromPalettePreset };
  const toPalette = { ...toPaletteBase, ...toPalettePreset };
  const typesList = Array.isArray(seasonal.types) && seasonal.types.length > 0
    ? seasonal.types
    : Object.keys({ ...fromPalette, ...toPalette });
  const types = new Set(typesList.filter((value) => typeof value === 'string' && value.length > 0));
  if (types.size === 0) {
    return null;
  }

  const duration = Math.max(1, Number(seasonState.duration || 0));
  const tickInSeason = Math.max(0, Number(seasonState.tickInSeason || 0));
  const progress = clamp(tickInSeason / duration, 0, 1);

  const patchy = seasonal.patchy && typeof seasonal.patchy === 'object' ? seasonal.patchy : {};
  const patchyEnabled = patchy.enabled !== false;
  const patchyScale = Math.max(0.001, Number(patchy.scale ?? patchy.noiseScale ?? 0.08));
  const patchyOctaves = Math.max(1, Number(patchy.octaves ?? 2));
  const patchyPersistence = clamp(Number(patchy.persistence ?? 0.55), 0, 1);
  const patchyLacunarity = Math.max(1, Number(patchy.lacunarity ?? 2));
  const patchySeedOffset = Number.isFinite(patchy.seedOffset) ? Number(patchy.seedOffset) : 0;

  const baseSeed = terrain && Number.isFinite(terrain.seed) ? Number(terrain.seed) : 0;
  const seasonIndex = Number.isFinite(seasonState.globalIndex) ? Number(seasonState.globalIndex) : index;
  const patchySeed = baseSeed + patchySeedOffset + seasonIndex * 1013;

  const cherry = seasonal.cherry && typeof seasonal.cherry === 'object' ? seasonal.cherry : {};
  const cherryEnabled = cherry.enabled === true;
  const cherrySeason = String(cherry.season || 'spring');
  const cherryTerrain = String(cherry.terrain || 'forest');
  const cherryRatio = clamp(Number(cherry.ratio ?? 0.08), 0, 1);
  const cherryNoiseScale = Math.max(0.001, Number(cherry.noiseScale ?? 0.2));
  const cherrySeedOffset = Number.isFinite(cherry.seedOffset) ? Number(cherry.seedOffset) : 0;
  const cherrySeed = baseSeed + cherrySeedOffset;

  return {
    types,
    progress,
    currentName,
    prevName,
    palettes: { from: fromPalette, to: toPalette },
    patchy: {
      enabled: patchyEnabled,
      scale: patchyScale,
      octaves: patchyOctaves,
      persistence: patchyPersistence,
      lacunarity: patchyLacunarity,
      seed: patchySeed,
    },
    cherry: {
      enabled: cherryEnabled,
      season: cherrySeason,
      terrain: cherryTerrain,
      ratio: cherryRatio,
      noiseScale: cherryNoiseScale,
      seed: cherrySeed,
    },
    colorMap: colors && colors.map ? colors.map : {},
  };
}

// Resolve seasonal palette overrides from an optional named preset.
function resolveSeasonalPresetPalettes(seasonal) {
  if (!seasonal || typeof seasonal !== 'object') {
    return {};
  }
  const presetName = String(seasonal.preset || '').trim();
  if (!presetName) {
    return {};
  }
  const presets = seasonal.presets && typeof seasonal.presets === 'object'
    ? seasonal.presets
    : {};
  const preset = presets[presetName];
  if (!preset || typeof preset !== 'object') {
    return {};
  }
  const withPalettes = preset.palettes && typeof preset.palettes === 'object'
    ? preset.palettes
    : null;
  return withPalettes || preset;
}

// Resolve the seasonal terrain color key for a specific tile.
function resolveSeasonalTerrainColorKey(context, type, x, y, fallbackKey) {
  if (!context || !context.types.has(type)) {
    return fallbackKey;
  }

  const fromPalette = context.palettes.from;
  const toPalette = context.palettes.to;
  let fromKey = pickPaletteKey(fromPalette, type, fallbackKey, context.colorMap);
  let toKey = pickPaletteKey(toPalette, type, fallbackKey, context.colorMap);

  if (context.cherry.enabled && type === context.cherry.terrain && isCherryTile(x, y, context.cherry)) {
    if (context.prevName === context.cherry.season) {
      fromKey = pickPaletteKey(fromPalette, 'cherry', fromKey, context.colorMap);
    }
    if (context.currentName === context.cherry.season) {
      toKey = pickPaletteKey(toPalette, 'cherry', toKey, context.colorMap);
    }
  }

  if (fromKey === toKey) {
    return fromKey;
  }

  const threshold = getPatchyThreshold(context.patchy, x, y);
  return context.progress >= threshold ? toKey : fromKey;
}

// Resolve a palette key while ensuring it exists in the color map.
function pickPaletteKey(palette, type, fallbackKey, colorMap) {
  const raw = palette && typeof palette[type] === 'string' ? palette[type] : '';
  if (raw && (!colorMap || colorMap[raw])) {
    return raw;
  }
  return fallbackKey;
}

// Check if a tile should be rendered as a cherry blossom variant.
function isCherryTile(x, y, cherry) {
  if (!cherry || !cherry.enabled || cherry.ratio <= 0) {
    return false;
  }
  const value = smoothValueNoise(x * cherry.noiseScale, y * cherry.noiseScale, cherry.seed);
  return value >= 1 - cherry.ratio;
}

// Compute the patchy transition threshold for a tile.
function getPatchyThreshold(patchy, x, y) {
  if (!patchy || !patchy.enabled) {
    return randomValue(x, y, patchy ? patchy.seed : 0);
  }
  const value = fractalNoise(
    x * patchy.scale,
    y * patchy.scale,
    patchy.seed,
    patchy.octaves,
    patchy.persistence,
    patchy.lacunarity,
  );
  return clamp(value, 0, 1);
}

// Generate deterministic fractal noise for patchy transitions.
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

// Produce smooth value noise for a given coordinate.
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

// Deterministic hash-based random value in [0, 1].
function randomValue(x, y, seed) {
  let h = (Number(seed) >>> 0) ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967295;
}

// Smooth interpolation curve for value noise.
function fade(t) {
  return t * t * (3 - 2 * t);
}

// Linear interpolation helper.
function lerp(a, b, t) {
  return a + (b - a) * t;
}

module.exports = {
  buildSeasonalColorContext,
  resolveSeasonalTerrainColorKey,
};
