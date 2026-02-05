'use strict';

const { padRight, clamp } = require('../utils');
const { fitLine, wrapLine } = require('./format');
const { applyColor } = require('./colors');

const TITLE_TEXT = 'ᛗ MAP ARCHIVE';

// Build a save confirmation panel when enabled.
function buildSavePanel(state, config, runtime) {
  const uiConfig = (config.display && config.display.save_panel) || {};
  if (uiConfig.enabled === false) {
    return null;
  }
  const saveState = state && state.ui ? state.ui.saveMap : null;
  if (!saveState || !saveState.open) {
    return null;
  }

  const gridWidth = Math.max(0, Number(runtime.gridWidth || 0));
  const gridHeight = Math.max(0, Number(runtime.gridHeight || 0));
  if (gridWidth <= 0 || gridHeight <= 0) {
    return null;
  }

  const targetWidth = Number(uiConfig.width || 54);
  const targetHeight = Number(uiConfig.height || 7);
  const width = clamp(Math.floor(targetWidth), 26, gridWidth);
  const height = clamp(Math.floor(targetHeight), 6, gridHeight);
  const innerWidth = Math.max(1, width - 6);
  const contentWidth = Math.max(1, innerWidth - 1);
  const innerHeight = Math.max(1, height - 2);

  const message = String(saveState.message || 'Map saved.');
  const lines = buildSaveLines(message, contentWidth, innerHeight);
  const panelLines = buildPanelBox(lines, innerWidth, contentWidth);

  const x = Math.max(0, Math.floor((gridWidth - width) / 2));
  const y = Math.max(0, Math.floor((gridHeight - height) / 2));

  return {
    lines: panelLines,
    x,
    y,
    width,
    height,
  };
}

// Build inner lines for the save panel.
function buildSaveLines(message, width, height) {
  const maxContent = Math.max(1, Number(height || 1));
  const content = [];

  pushLine(content, TITLE_TEXT, width, 'hud_header');
  content.push({ text: '', colorKey: null });

  const wrapped = wrapLine(message, width);
  const remaining = Math.max(1, maxContent - content.length);
  for (let i = 0; i < wrapped.length && i < remaining; i += 1) {
    pushLine(content, wrapped[i], width);
  }

  while (content.length < maxContent) {
    content.push({ text: '', colorKey: null });
  }

  return content.map((entry) => ({
    text: fitLine(entry.text, width),
    colorKey: entry.colorKey || null,
  }));
}

// Push a single line into the buffer.
function pushLine(lines, value, width, colorKey = null) {
  const text = fitLine(value, width);
  lines.push({ text, colorKey });
}

// Build a bordered panel from inner lines.
function buildPanelBox(lines, innerWidth, contentWidth) {
  const top = { text: `╔═╦${'═'.repeat(innerWidth)}╦═╗`, colorKey: null };
  const bottom = { text: `╚═╩${'═'.repeat(innerWidth)}╩═╝`, colorKey: null };
  const padWidth = Math.max(1, Number(contentWidth || innerWidth));
  const contentStart = 4;
  const contentEnd = contentStart + padWidth;
  const body = lines.map((line) => {
    return {
      text: `║░║ ${padRight(line.text, padWidth)}║░║`,
      colorKey: line.colorKey || null,
      colorStart: line.colorKey ? contentStart : null,
      colorEnd: line.colorKey ? contentEnd : null,
    };
  });
  return [top, ...body, bottom];
}

// Overlay the save panel onto the grid.
function applySavePanel(grid, panel, colors) {
  if (!panel || !Array.isArray(panel.lines)) {
    return;
  }
  const startY = panel.y;
  const startX = panel.x;

  for (let row = 0; row < panel.lines.length; row += 1) {
    const y = startY + row;
    if (!grid[y]) {
      continue;
    }
    const line = panel.lines[row];
    const text = line.text || '';
    const colorKey = line.colorKey || null;
    const colorStart = Number.isFinite(line.colorStart) ? line.colorStart : null;
    const colorEnd = Number.isFinite(line.colorEnd) ? line.colorEnd : null;
    for (let col = 0; col < text.length; col += 1) {
      const x = startX + col;
      if (grid[y][x] === undefined) {
        continue;
      }
      const ch = text[col];
      const shouldColor = colorKey && (colorStart === null || (col >= colorStart && col < colorEnd));
      if (shouldColor) {
        grid[y][x] = applyColor(ch, colorKey, colors);
      } else {
        grid[y][x] = ch;
      }
    }
  }
}

module.exports = { buildSavePanel, applySavePanel };
