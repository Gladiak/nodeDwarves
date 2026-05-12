'use strict';

const { clamp, padRight } = require('../utils');
const { fitLine, wrapLine } = require('./format');
const { applyColor } = require('./colors');
const { normalizeEventLogEntry, isDramaEventCategory } = require('../simulation/events');

const FILTER_ORDER = ['all', 'drama'];
const FILTER_LABELS = {
  all: 'All events',
  drama: 'Dwarf drama',
};

const CATEGORY_COLOR_KEYS = {
  social: 'dwarf',
  lifecycle: 'dwarf',
  schism: 'hud_header',
  festival: 'brewery',
  myth: 'alchemy_lab',
  warrior: 'armory',
  diplomacy: 'merchant',
  combat: 'alert_warning',
  underrealm: 'underrealm_delver',
  economy: 'workshop',
  world: 'weather_clear',
};

// Build the Event Log panel descriptor when enabled and opened.
function buildEventLogPanel(state, config, runtime) {
  const uiConfig = (config.display && config.display.event_log_panel) || {};
  if (uiConfig.enabled === false) {
    return null;
  }
  const panelState = state && state.ui ? state.ui.eventLog : null;
  if (!panelState || !panelState.open) {
    return null;
  }

  const gridWidth = Math.max(0, Number(runtime.gridWidth || 0));
  const gridHeight = Math.max(0, Number(runtime.gridHeight || 0));
  if (gridWidth <= 0 || gridHeight <= 0) {
    return null;
  }

  const targetWidth = Number(uiConfig.width || Math.floor(gridWidth * 0.9));
  const targetHeight = Number(uiConfig.height || Math.floor(gridHeight * 0.76));
  const width = clamp(Math.floor(targetWidth), 72, gridWidth);
  const height = clamp(Math.floor(targetHeight), 18, gridHeight);
  const innerWidth = Math.max(1, width - 6);
  const contentWidth = Math.max(1, innerWidth - 1);
  const innerHeight = Math.max(1, height - 2);

  const lines = buildEventLogLines(state, contentWidth, innerHeight, panelState);
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

// Build wrapped content rows for the Event Log panel.
function buildEventLogLines(state, width, height, panelState) {
  const controlsLine = '[e] Close log  [f or left/right] Filter  [up/down] Scroll';
  const maxContent = Math.max(0, height - 1);
  const lines = [];
  pushLine(lines, 'NODEDWARVES EVENT LOG', width, 'hud_header');

  const filter = normalizeFilterId(panelState && panelState.filter);
  const allEntries = collectEventEntries(state);
  const filteredEntries = filterEventEntries(allEntries, filter);
  const maxOffset = Math.max(0, filteredEntries.length - 1);
  const offset = clamp(Math.floor(Number(panelState && panelState.offset || 0)), 0, maxOffset);

  pushLine(
    lines,
    `Filter: ${FILTER_LABELS[filter]} | Stored ${allEntries.length} | Matched ${filteredEntries.length} | Offset ${offset}`,
    width,
    'weather_clear',
  );
  lines.push({ text: '', colorKey: null, separator: true });

  const availableRows = Math.max(0, maxContent - lines.length);
  const visibleEntries = filteredEntries.slice(offset);
  const bodyRows = [];
  if (visibleEntries.length === 0) {
    pushLine(bodyRows, 'No events available for the selected filter.', width, null);
  } else {
    for (const entry of visibleEntries) {
      if (bodyRows.length >= availableRows) {
        break;
      }
      pushWrappedEventRows(bodyRows, entry, width, availableRows - bodyRows.length);
    }
  }

  const trimmedBody = bodyRows.slice(0, availableRows);
  while (trimmedBody.length < availableRows) {
    trimmedBody.push({ text: '', colorKey: null, separator: false });
  }

  const content = [...lines, ...trimmedBody];
  if (content.length > maxContent) {
    content.splice(maxContent);
  }
  while (content.length < maxContent) {
    content.push({ text: '', colorKey: null, separator: false });
  }
  content.push({ text: fitLine(controlsLine, width), colorKey: null, separator: false });
  return content.map((entry) => ({
    text: fitLine(String(entry.text || ''), width),
    colorKey: entry.colorKey || null,
    separator: entry.separator === true,
  }));
}

// Build normalized event entries from eventLog (fallback to HUD mini-log strings).
function collectEventEntries(state) {
  const log = Array.isArray(state && state.eventLog) ? state.eventLog : [];
  if (log.length > 0) {
    return log
      .map((entry) => normalizeEventLogEntry(entry))
      .filter((entry) => entry && entry.message);
  }
  const miniLog = Array.isArray(state && state.events) ? state.events : [];
  const tick = Math.max(0, Math.floor(Number(state && state.tick || 0)));
  return miniLog
    .map((message) => normalizeEventLogEntry({ tick, message }))
    .filter((entry) => entry && entry.message);
}

// Keep filter id deterministic and bounded.
function normalizeFilterId(value) {
  const id = String(value || 'all').trim().toLowerCase();
  return FILTER_ORDER.includes(id) ? id : 'all';
}

// Apply one log filter mode.
function filterEventEntries(entries, filter) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }
  if (filter === 'drama') {
    return entries.filter((entry) => isDramaEventCategory(entry.category));
  }
  return entries;
}

// Push one colored line entry.
function pushLine(lines, value, width, colorKey = null) {
  lines.push({
    text: fitLine(String(value || ''), width),
    colorKey,
    separator: false,
  });
}

// Push one wrapped event message with compact tick prefix and category color.
function pushWrappedEventRows(lines, entry, width, maxRows) {
  if (!entry || maxRows <= 0) {
    return;
  }
  const colorKey = CATEGORY_COLOR_KEYS[entry.category] || null;
  const prefix = `[t${Math.max(0, Number(entry.tick || 0))}] `;
  const safeWidth = Math.max(1, Math.floor(Number(width || 1)));
  const availableMessageWidth = Math.max(1, safeWidth - prefix.length);
  const wrapped = wrapLine(String(entry.message || ''), availableMessageWidth);
  if (wrapped.length === 0) {
    return;
  }
  let count = 0;
  for (let i = 0; i < wrapped.length && count < maxRows; i += 1) {
    const lineText = i === 0
      ? `${prefix}${wrapped[i]}`
      : `${' '.repeat(prefix.length)}${wrapped[i]}`;
    lines.push({
      text: fitLine(lineText, safeWidth),
      colorKey,
      separator: false,
    });
    count += 1;
  }
}

// Build bordered panel box from inner lines.
function buildPanelBox(lines, innerWidth, contentWidth) {
  const top = { text: `╔═╦${'═'.repeat(innerWidth)}╦═╗`, colorKey: null };
  const bottom = { text: `╚═╩${'═'.repeat(innerWidth)}╩═╝`, colorKey: null };
  const padWidth = Math.max(1, Number(contentWidth || innerWidth));
  const contentStart = 4;
  const contentEnd = contentStart + padWidth;
  const body = lines.map((line) => {
    if (line.separator) {
      return { text: `╠═╬${'═'.repeat(innerWidth)}╬═╣`, colorKey: null };
    }
    return {
      text: `║░║ ${padRight(line.text || '', padWidth)}║░║`,
      colorKey: line.colorKey || null,
      colorStart: line.colorKey ? contentStart : null,
      colorEnd: line.colorKey ? contentEnd : null,
    };
  });
  return [top, ...body, bottom];
}

// Overlay Event Log panel content onto the current grid.
function applyEventLogPanel(grid, panel, colors) {
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

module.exports = { buildEventLogPanel, applyEventLogPanel };
