'use strict';

const ANSI16 = [
  [0, 0, 0], [170, 0, 0], [0, 170, 0], [170, 85, 0],
  [0, 0, 170], [170, 0, 170], [0, 170, 170], [170, 170, 170],
  [85, 85, 85], [255, 85, 85], [85, 255, 85], [255, 255, 85],
  [85, 85, 255], [255, 85, 255], [85, 255, 255], [255, 255, 255],
];
const cache = new WeakMap();
const WAYFINDING_KEYS = new Set(['terrain_road', 'terrain_bridge', 'terrain_ford',
  'terrain_corridor', 'terrain_magma', 'terrain_shrine', 'terrain_void']);

// Read the final foreground from common terminal color forms without altering background escapes.
function readForeground(code) {
  let rgb = null;
  for (const match of String(code || '').matchAll(/\x1b\[([0-9;]*)m/g)) {
    const values = match[1].split(';').map(Number);
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      if (value === 0 || value === 39) rgb = null;
      else if (value >= 30 && value <= 37) rgb = ANSI16[value - 30];
      else if (value >= 90 && value <= 97) rgb = ANSI16[value - 90 + 8];
      else if ((value === 38 || value === 48) && values[index + 1] === 2) {
        if (value === 38) rgb = values.slice(index + 2, index + 5);
        index += 4;
      } else if ((value === 38 || value === 48) && values[index + 1] === 5) {
        const number = values[index + 2];
        if (value === 38) {
          const steps = [0, 95, 135, 175, 215, 255];
          rgb = number < 16 ? ANSI16[number] : number >= 232 ? Array(3).fill(8 + (number - 232) * 10)
            : [steps[Math.floor((number - 16) / 36)], steps[Math.floor((number - 16) / 6) % 6], steps[(number - 16) % 6]];
        }
        index += 2;
      }
    }
  }
  return rgb && rgb.length === 3 && rgb.every((value) => Number.isFinite(value) && value >= 0 && value <= 255) ? rgb : null;
}

// Resolve a restrained hierarchy while keeping all tuning in display configuration.
function getReadabilitySettings(config) {
  const raw = config.display?.map_readability || {};
  const ratio = (value, fallback) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : fallback;
  return { enabled: raw.enabled !== false, terrainStrength: ratio(raw.terrain_strength ?? 0.82, 0.82),
    minimumBrightness: Math.max(0, Math.min(255, Number(raw.minimum_brightness ?? 72))),
    structureColorKey: String(raw.structure_color_key || 'terrain_mountain_medium') };
}

// Soften background terrain only; roads, hazards, actors, story markers and panels retain their colors.
function getTerrainColors(config, colors) {
  const settings = getReadabilitySettings(config);
  if (!settings.enabled || !colors?.enabled || settings.terrainStrength >= 1) return colors;
  const signature = JSON.stringify([settings, colors.map]);
  const saved = cache.get(config);
  if (saved?.signature === signature) return saved.colors;
  const map = { ...colors.map };
  for (const [key, code] of Object.entries(map)) {
    if (!key.startsWith('terrain_') || WAYFINDING_KEYS.has(key)) continue;
    const rgb = readForeground(code);
    if (!rgb) continue;
    const peak = Math.max(...rgb);
    const factor = peak > 0 ? Math.max(settings.terrainStrength, Math.min(1, settings.minimumBrightness / peak)) : 1;
    const next = rgb.map((value) => Math.round(value * factor));
    const attributes = code.replace(/\x1b\[(?:3[0-7]|9[0-7]|38;[25];[0-9;]+)m/g, '');
    map[key] = `${attributes}\x1b[38;2;${next.join(';')}m`;
  }
  const result = { ...colors, map };
  cache.set(config, { signature, colors: result });
  return result;
}

// Raise low-contrast structures to a configured map tone without changing their symbol or identity.
function getStructureColorKey(config, colors, key) {
  const settings = getReadabilitySettings(config);
  if (!settings.enabled) return key;
  const rgb = readForeground(colors.map?.[key]);
  return rgb && Math.max(...rgb) < 110 && colors.map?.[settings.structureColorKey] ? settings.structureColorKey : key;
}

module.exports = { getTerrainColors, getStructureColorKey, readForeground };
