'use strict';

const defaultConfig = require('../../config.json');
const { createTerrain } = require('../state/terrain');
const { createSessionRandom, withSessionRandom } = require('../session_random');
const { updateSeason } = require('../simulation/season');
const { buildGridBase } = require('./grid');
const { applyColor, getColorConfig } = require('./colors');
const { buildSeasonalColorContext, resolveSeasonalTerrainColorKey } = require('./seasonal_colors');
const { getTerrainColors } = require('./map_readability');
const { fitScenarioPreview } = require('./scenario_preview');

const LOGO = [
  ' _   _           _      ____                                  ',
  '| \\ | | ___   __| | ___|  _ \\__      ____ _ _ ____   _____  ___ ',
  "|  \\| |/ _ \\ / _` |/ _ \\ | | \\ \\ /\\ / / _` | '__\\ \\ / / _ \\/ __|",
  '| |\\  | (_) | (_| |  __/ |_| |\\ V  V / (_| | |   \\ V /  __/\\__ \\',
  '|_| \\_|\\___/ \\__,_|\\___|____/  \\_/\\_/ \\__,_|_|    \\_/ \\___||___/',
];
const LOGO_WIDTH = Math.max(...LOGO.map((entry) => entry.length));
const DIAMOND = '\u25c6';
let atlasCache = null;

// Build a decorative atlas with the same terrain generator, symbols and palette as the game.
function buildAtlas(config, width, height, colors) {
  if (atlasCache && atlasCache.config === config && atlasCache.width === width && atlasCache.height === height
      && atlasCache.colored === colors.enabled) return atlasCache.grid;
  const atlasConfig = { ...config, display: { ...config.display,
    terrain: { ...config.display.terrain, enabled: true, seed: config.startup?.background_seed || 707 } } };
  const runtime = { gridWidth: width, gridHeight: height, mapInset: null };
  const terrain = withSessionRandom(createSessionRandom(707), () => createTerrain(atlasConfig, runtime));
  // Match the first playable frame; without a season, the grid falls back to saturated base colors.
  const atlasState = { terrain, tick: 1, roads: null };
  updateSeason(atlasState, atlasConfig);
  const seasonal = buildSeasonalColorContext(atlasState, atlasConfig, terrain, colors);
  const grid = buildGridBase(atlasState, atlasConfig, runtime, getTerrainColors(atlasConfig, colors), '.');
  const tile = (x, y, symbol, key) => {
    if (x > 0 && y > 0 && x < width - 1 && y < height - 1) grid[y][x] = applyColor(symbol, key, colors);
  };
  const text = (x, y, value, key) => Array.from(value).forEach((symbol, index) => tile(x + index, y, symbol, key));
  const villages = [
    { x: Math.round(width * 0.15), y: Math.round(height * 0.37), name: 'COPPERHEARTH' },
    { x: Math.round(width * 0.83), y: Math.round(height * 0.65), name: 'OLD STONEGATE' },
    { x: Math.round(width * 0.49), y: Math.round(height * 0.88), name: 'THE LOWER HALLS' },
  ];
  const road = (x, y) => {
    const wet = ['river', 'lake'].includes(terrain.types[y]?.[x]);
    tile(x, y, wet ? '=' : '+', wet ? 'terrain_bridge' : 'terrain_road');
  };
  for (let index = 1; index < villages.length; index += 1) {
    const a = villages[index - 1]; const b = villages[index];
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x += 1) road(x, a.y);
    for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y += 1) road(b.x, y);
  }
  for (const village of villages) {
    const { x, y } = village;
    text(x - 5, y - 3, village.name, 'world_legacy_echo');
    text(x - 4, y - 2, '+---+---+', 'terrain_stone');
    text(x - 4, y - 1, '|   |   |', 'terrain_stone');
    text(x - 4, y, '+---+---+', 'terrain_stone');
    tile(x - 2, y - 1, config.symbols.house, 'house');
    tile(x + 2, y - 1, config.symbols.brewery, 'brewery');
    tile(x, y + 1, config.symbols.dwarf, 'dwarf');
    tile(x + 4, y + 1, config.symbols.dwarf, 'dwarf');
    for (let dx = -4; dx <= 3; dx += 1) {
      const key = resolveSeasonalTerrainColorKey(seasonal, 'fertile', x + dx, y + 2, 'terrain_fertile');
      tile(x + dx, y + 2, ':', key);
    }
  }
  atlasCache = { config, width, height, colored: colors.enabled, grid };
  return grid;
}

// Wrap a plain UI string within its carved panel, excluding terminal controls.
function wrapText(value, width) {
  const words = String(value || '').replace(/[\x00-\x1f\x7f]/g, ' ').split(/\s+/);
  const lines = [''];
  for (const word of words) {
    const last = lines.length - 1;
    if (lines[last] && lines[last].length + word.length + 1 > width) lines.push('');
    const index = lines.length - 1;
    lines[index] = `${lines[index]}${lines[index] ? ' ' : ''}${word}`.slice(0, width);
  }
  return lines;
}

// Carve the welcome panel into an illustrated world without creating a game session.
function renderStartMenu(model, width, height, suppliedConfig) {
  width = Math.max(1, Math.floor(width)); height = Math.max(1, Math.floor(height));
  if (width < 12 || height < 8) {
    return Array.from({ length: height }, (_, index) => (index === 0 ? 'NodeDwarves' : 'Resize to view menu').slice(0, width).padEnd(width)).join('\n');
  }
  const config = suppliedConfig || defaultConfig;
  const colors = suppliedConfig ? getColorConfig(config) : { enabled: false };
  const rows = buildAtlas(config, width, height, colors).map((row) => row.slice());
  const frame = config.display.frame || {};
  const put = (x, y, value, key = 'menu_text', backgroundKey = null) => {
    if (y < 0 || y >= height) return;
    const chars = Array.from(String(value).replace(/[\x00-\x1f\x7f]/g, ' '));
    chars.forEach((char, index) => {
      if (x + index < 0 || x + index >= width) return;
      if (!colors.enabled || !backgroundKey) {
        rows[y][x + index] = applyColor(char, key, colors);
        return;
      }
      // Apply background after foreground so a custom foreground reset cannot expose the terminal default.
      const foreground = colors.map[key] || colors.map.hud_header || '';
      const background = colors.map[backgroundKey] || colors.map.menu_background || '';
      rows[y][x + index] = foreground + background + char + colors.reset;
    });
  };
  const panelPut = (x, y, value, key = 'menu_text', backgroundKey = 'menu_background') => put(x, y, value, key, backgroundKey);
  const box = (left, top, boxWidth, boxHeight) => {
    const horizontal = frame.horizontal || '-'; const vertical = frame.vertical || '|';
    for (let y = top; y < top + boxHeight; y += 1) {
      panelPut(left, y, ' '.repeat(boxWidth));
    }
    panelPut(left, top, (frame.topLeft || '+') + horizontal.repeat(Math.max(0, boxWidth - 2)) + (frame.topRight || '+'), 'menu_border');
    panelPut(left, top + boxHeight - 1, (frame.bottomLeft || '+') + horizontal.repeat(Math.max(0, boxWidth - 2)) + (frame.bottomRight || '+'), 'menu_border');
    for (let y = top + 1; y < top + boxHeight - 1; y += 1) {
      panelPut(left, y, vertical, 'menu_border'); panelPut(left + boxWidth - 1, y, vertical, 'menu_border');
      for (let x = left + 1; x < left + boxWidth - 1; x += 1) {
        const seam = (x - left + ((y - top) % 8 < 4 ? 4 : 0)) % 9 === 0;
        if ((y - top) % 4 === 0 || seam) panelPut(x, y, seam ? '\u2502' : '\u2500', 'menu_texture');
      }
    }
  };
  const previewBox = (left, top, previewWidth, previewHeight, expanded = false) => {
    box(left, top, previewWidth, previewHeight);
    const label = `Seed:${model.preview.seed} ${model.preview.width}x${model.preview.height}`;
    panelPut(left + 2, top + 1, label.slice(0, previewWidth - 4), 'menu_text');
    const map = fitScenarioPreview(model.preview, previewWidth - 4, previewHeight - 5);
    const mapLeft = left + Math.floor((previewWidth - (map[0]?.length || 0)) / 2);
    const mapTop = top + 2 + Math.floor((previewHeight - 5 - map.length) / 2);
    for (let y = 0; y < map.length; y += 1) {
      for (let x = 0; x < map[y].length; x += 1) if (rows[mapTop + y]?.[mapLeft + x] !== undefined) rows[mapTop + y][mapLeft + x] = map[y][x];
    }
    panelPut(left + 2, top + previewHeight - 2,
      (expanded ? 'P/Esc: back  R: seed  Enter: start' : 'P: full map  R: new seed').slice(0, previewWidth - 4), 'menu_muted');
  };
  if (model.preview && model.previewExpanded) {
    previewBox(1, 1, width - 2, height - 2, true);
    return rows.map((rowCells) => rowCells.join('')).join('\n');
  }
  if (width >= 30 && height >= 16) {
    put(0, 0, (frame.topLeft || '+') + (frame.horizontal || '-').repeat(width - 2) + (frame.topRight || '+'), 'frame');
    put(0, height - 1, (frame.bottomLeft || '+') + (frame.horizontal || '-').repeat(width - 2) + (frame.bottomRight || '+'), 'frame');
    for (let y = 1; y < height - 1; y += 1) { put(0, y, frame.vertical || '|', 'frame'); put(width - 1, y, frame.vertical || '|', 'frame'); }
    put(3, 0, ' THE WORLD OF NODEDWARVES ', 'world_legacy_echo');
  }
  const compact = height < 24;
  const tiny = height < 12;
  const sidePreview = Boolean(model.preview && width >= 142 && height >= 28);
  const stackedPreview = Boolean(model.preview && !sidePreview && width >= 40 && height >= 28);
  const panelWidth = sidePreview ? 66 : Math.max(4, Math.min(86, width - (width >= 100 ? 16 : width >= 76 ? 4 : 2)));
  const panelHeight = Math.min(33, height - (compact ? 2 : 4));
  const left = sidePreview ? 2 : Math.max(0, Math.floor((width - panelWidth) / 2));
  const top = Math.max(0, Math.floor((height - panelHeight) / 2));
  const pillars = panelWidth >= 44 && height >= 16;
  const inset = pillars ? 5 : 3;
  const innerWidth = Math.max(1, panelWidth - inset * 2);
  const large = !model.preview && innerWidth >= LOGO_WIDTH && panelHeight >= 26;
  box(left, top, panelWidth, panelHeight);
  if (pillars) {
    for (let y = top + 1; y < top + panelHeight - 1; y += 1) {
      const decorated = (y - top) % 4 === 0;
      const glyph = decorated ? DIAMOND : '\u2502';
      for (const x of [left + 2, left + panelWidth - 3]) panelPut(x, y, glyph, decorated ? 'menu_border' : 'menu_pillar');
    }
  }
  const line = (y, value, key = 'menu_text', centered = true, selected = false) => {
    if (y <= top || y >= top + panelHeight - 1) return;
    const text = String(value).replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, innerWidth);
    const background = selected ? 'menu_selected_background' : 'menu_background';
    // Clear the full text row; all glyphs and surrounding spaces share one background.
    panelPut(left + inset, y, ' '.repeat(innerWidth), key, background);
    panelPut(left + (centered ? Math.floor((panelWidth - text.length) / 2) : inset), y, text, key, background);
  };
  let row = top + 1;
  if (!tiny) line(row++, '\u16df  THE GATEHOUSE  \u16df', 'menu_border');
  if (large) {
    row += 1;
    LOGO.forEach((entry) => line(row++, entry.padEnd(LOGO_WIDTH), 'menu_border'));
    row += 1;
    line(row++, 'DIG DEEP. DRINK HARD. REMEMBER THE HOLD.', 'menu_muted');
  } else line(row++, 'NodeDwarves', 'menu_border');
  if (!compact) {
    row += 1;
    line(row++, `\u2500\u2500 ${DIAMOND} \u2500\u2500`, 'menu_border');
  }
  if (!tiny) line(row++, model.title, 'menu_text');
  if (!compact) row += 1;
  const previewRows = stackedPreview ? Math.min(11, Math.max(7, panelHeight - 18)) : 0;
  const availableRows = Math.max(1, top + panelHeight - row - (compact ? 3 : 8) - previewRows);
  const spacing = !compact && model.items.length <= 4 && availableRows >= model.items.length * 2 - 1 ? 2 : 1;
  const itemBudget = Math.max(1, Math.min(7, Math.floor((availableRows + spacing - 1) / spacing)));
  const offset = Math.max(0, Math.min(model.selected - Math.floor(itemBudget / 2), model.items.length - itemBudget));
  for (let index = offset; index < Math.min(model.items.length, offset + itemBudget); index += 1) {
    const selected = index === model.selected;
    line(row, `${selected ? `${DIAMOND} > ` : '    '}${model.items[index].label}`,
      selected ? 'menu_selected' : 'menu_text', false, selected);
    row += spacing;
  }
  if (!compact) {
    const detailBase = top + panelHeight - previewRows - 7;
    line(detailBase, `\u2500\u2500\u2500 < + > \u2500\u2500\u2500`, 'menu_pillar');
    const selected = model.items[model.selected];
    const detail = wrapText(model.message || selected?.detail || '', innerWidth);
    detail.slice(0, 2).forEach((entry, index) => line(detailBase + 1 + index, entry, model.message ? 'alert_warning' : 'menu_muted'));
    if (model.items.length > itemBudget) line(top + panelHeight - 3, `${model.selected + 1}/${model.items.length} - Up/Down to browse`, 'menu_border');
  }
  if (stackedPreview) previewBox(left + inset, top + panelHeight - previewRows - 4, innerWidth, previewRows);
  if (sidePreview) previewBox(left + panelWidth + 3, top, width - left - panelWidth - 5, panelHeight);
  line(top + panelHeight - 2, model.preview ? 'Arrows Enter Esc | P: map R: seed' : compact ? 'Arrows Enter Esc Q' : 'Up/Down: choose | Enter: confirm | Esc: back | Q: quit', 'menu_muted');
  if (height >= 32) put(Math.max(2, width - 38), height - 1, ' A MOUNTAIN KEEPS ITS STORIES ', 'world_legacy_echo');
  return rows.map((rowCells) => rowCells.join('')).join('\n');
}

module.exports = { renderStartMenu };
