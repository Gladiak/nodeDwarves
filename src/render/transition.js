'use strict';

const { padRight, clamp } = require('../utils');
const { fitLine, wrapLine } = require('./format');
const { applyColor } = require('./colors');

const TITLE_TEXT = 'NEW FRONTIER';

// Apply a diagonal fade mask to the map grid.
function applyTransitionMask(grid, transition, runtime) {
  if (!grid || !transition || !transition.active) {
    return;
  }
  const width = Math.max(0, Number(runtime.gridWidth || 0));
  const height = Math.max(0, Number(runtime.gridHeight || 0));
  if (width === 0 || height === 0) {
    return;
  }

  const maxDiag = (width - 1) + (height - 1);
  const progress = clamp(Number(transition.progress || 0), 0, 1);
  const phase = transition.phase;

  let threshold = maxDiag;
  let inclusive = true;

  if (phase === 'fadeIn') {
    threshold = Math.floor(progress * maxDiag);
    inclusive = false;
  } else if (phase === 'fadeOut') {
    threshold = Math.floor(maxDiag - progress * maxDiag);
    inclusive = true;
  } else if (phase === 'hold') {
    threshold = -1;
    inclusive = true;
  }

  for (let y = 0; y < height; y += 1) {
    const row = grid[y];
    if (!row) {
      continue;
    }
    for (let x = 0; x < width; x += 1) {
      const diag = x + y;
      const shouldMask = inclusive ? diag >= threshold : diag > threshold;
      if (shouldMask && row[x] !== undefined) {
        row[x] = ' ';
      }
    }
  }
}

// Build a transition panel descriptor when enabled.
function buildTransitionPanel(state, config, runtime) {
  const uiConfig = (config.display && config.display.transition_panel) || {};
  if (uiConfig.enabled === false) {
    return null;
  }
  const transition = state && state.ui ? state.ui.transition : null;
  if (!transition || !transition.active || !transition.showPanel) {
    return null;
  }

  const gridWidth = Math.max(0, Number(runtime.gridWidth || 0));
  const gridHeight = Math.max(0, Number(runtime.gridHeight || 0));
  if (gridWidth <= 0 || gridHeight <= 0) {
    return null;
  }

  const targetWidth = Number(uiConfig.width || 70);
  const targetHeight = Number(uiConfig.height || 9);
  const width = clamp(Math.floor(targetWidth), 36, gridWidth);
  const height = clamp(Math.floor(targetHeight), 7, gridHeight);
  const innerWidth = Math.max(1, width - 6);
  const contentWidth = Math.max(1, innerWidth - 1);
  const innerHeight = Math.max(1, height - 2);

  const message = String(transition.message || 'A new journey begins.');
  const lines = buildTransitionLines(message, contentWidth, innerHeight);
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

// Build inner lines for the transition panel.
function buildTransitionLines(message, width, height) {
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

// Overlay the transition panel onto the grid.
function applyTransitionPanel(grid, panel, colors) {
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

module.exports = { applyTransitionMask, buildTransitionPanel, applyTransitionPanel };
