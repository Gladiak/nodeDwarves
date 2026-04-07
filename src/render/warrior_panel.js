'use strict';

const { clamp, padRight } = require('../utils');
const { fitLine, wrapLine } = require('./format');
const { applyColor } = require('./colors');
const { buildTelemetrySections } = require('../telemetry/telemetry');

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

// Build the Warrior League panel descriptor when enabled and opened.
function buildWarriorPanel(state, config, runtime) {
  const uiConfig = (config.display && config.display.warrior_panel) || {};
  if (uiConfig.enabled === false) {
    return null;
  }
  const panelState = state && state.ui ? state.ui.warriorPanel : null;
  if (!panelState || !panelState.open) {
    return null;
  }

  const gridWidth = Math.max(0, Number(runtime.gridWidth || 0));
  const gridHeight = Math.max(0, Number(runtime.gridHeight || 0));
  if (gridWidth <= 0 || gridHeight <= 0) {
    return null;
  }

  const targetWidth = Number(uiConfig.width || Math.floor(gridWidth * 0.9));
  const targetHeight = Number(uiConfig.height || Math.floor(gridHeight * 0.78));
  const width = clamp(Math.floor(targetWidth), 72, gridWidth);
  const height = clamp(Math.floor(targetHeight), 20, gridHeight);
  const innerWidth = Math.max(1, width - 6);
  const contentWidth = Math.max(1, innerWidth - 1);
  const innerHeight = Math.max(1, height - 2);

  const lines = buildWarriorPanelLines(state, config, contentWidth, innerHeight);
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

// Build wrapped content lines for Warrior League analytics.
function buildWarriorPanelLines(state, config, width, height) {
  const controlsLine = '[w] Close warrior panel';
  const maxContent = Math.max(0, height - 1);
  const lines = [];
  pushLine(lines, 'NODEDWARVES WARRIOR LEAGUE', width, 'hud_header');
  pushLine(
    lines,
    'Competitive command view: champion lineage, marks, clan board, and top 5 fighters.',
    width,
    'weather_clear',
  );
  lines.push({ text: '', colorKey: null, separator: true });

  const sections = buildTelemetrySections(state, config, width, {
    includeRuins: true,
    includeMyths: true,
  });
  const warriorSection = sections && sections.warriorLeague ? sections.warriorLeague : null;
  pushLine(
    lines,
    `[${warriorSection && warriorSection.label ? warriorSection.label : 'Warrior League'}]`,
    width,
    'hud_header',
  );
  const rows = warriorSection && Array.isArray(warriorSection.rows) ? warriorSection.rows : [];
  if (rows.length === 0) {
    pushLine(lines, '-', width, null);
  } else {
    const rowEntries = buildWarriorPanelRowEntries(rows);
    for (const entry of rowEntries) {
      if (entry.separator) {
        lines.push({ text: '', colorKey: null });
        continue;
      }
      pushWrappedLines(lines, entry.text, width, entry.colorKey);
    }
  }

  const trimmed = lines.slice(0, maxContent);
  while (trimmed.length < maxContent) {
    trimmed.push({ text: '', colorKey: null });
  }
  trimmed.push({ text: fitLine(controlsLine, width), colorKey: null });
  return trimmed.map((entry) => ({
    text: fitLine(String(entry.text || ''), width),
    colorKey: entry.colorKey || null,
    separator: entry.separator === true,
  }));
}

// Push one colored line entry.
function pushLine(lines, value, width, colorKey = null) {
  lines.push({
    text: fitLine(String(value || ''), width),
    colorKey,
    separator: false,
  });
}

// Push wrapped lines from one long value while keeping one color style.
function pushWrappedLines(lines, value, width, colorKey = null) {
  const safeWidth = Math.max(1, Math.floor(Number(width || 1)));
  const wrapped = wrapLine(String(value || ''), safeWidth);
  for (const row of wrapped) {
    pushLine(lines, row, safeWidth, colorKey);
  }
}

// Strip ANSI escapes from telemetry rows before re-wrapping.
function stripAnsi(value) {
  return String(value || '').replace(ANSI_PATTERN, '');
}

// Build color-aware row entries and spacing hints for Warrior League content.
function buildWarriorPanelRowEntries(rows) {
  const entries = [];
  let hasVisibleRow = false;
  let previousBlank = true;
  for (const rawRow of rows) {
    const text = stripAnsi(rawRow);
    const trimmed = text.trim();
    const blankRow = trimmed.length === 0;
    if (
      !blankRow
      && hasVisibleRow
      && !previousBlank
      && shouldInsertWarriorSectionSpacer(trimmed)
    ) {
      entries.push({ separator: true, text: '', colorKey: null });
      previousBlank = true;
    }
    entries.push({
      separator: false,
      text,
      colorKey: resolveWarriorRowColorKey(trimmed),
    });
    if (!blankRow) {
      hasVisibleRow = true;
    }
    previousBlank = blankRow;
  }
  return entries;
}

// Decide whether one row starts a new visual section in Warrior panel.
function shouldInsertWarriorSectionSpacer(rowText) {
  return (
    rowText.startsWith('Champion:')
    || rowText.startsWith('Company identity:')
    || rowText.startsWith('Top 5 fighters:')
    || rowText.startsWith('Clan board:')
    || rowText.startsWith('Hall of fame:')
    || rowText.startsWith('Lineage ledger:')
  );
}

// Resolve selective color highlights for key Warrior panel rows.
function resolveWarriorRowColorKey(rowText) {
  if (!rowText) {
    return null;
  }
  if (rowText.startsWith('Warrior League: disabled')) {
    return 'alert_warning';
  }
  if (rowText.startsWith('Champion:')) {
    return 'temple_of_ancestors';
  }
  if (rowText.startsWith('Company identity:')) {
    return 'temple_of_ancestors';
  }
  if (rowText.startsWith('Carry-over hooks:')) {
    return 'armory';
  }
  if (rowText.startsWith('League metrics:')) {
    return 'armory';
  }
  if (rowText.startsWith('Champion marks:')) {
    return 'temple_of_ancestors';
  }
  if (rowText.startsWith('#')) {
    return resolveWarriorFighterRowColorKey(rowText);
  }
  if (rowText.startsWith('Hall of fame:')) {
    return 'temple_of_ancestors';
  }
  if (rowText.startsWith('Lineage ledger:')) {
    return 'armory';
  }
  if (rowText.startsWith('Lineage memory:')) {
    return 'armory';
  }
  return null;
}

// Resolve color for one fighter row, highlighting only rank #1.
function resolveWarriorFighterRowColorKey(rowText) {
  const rankMatch = rowText.match(/^#(\d+)\s/);
  const rank = rankMatch ? Math.max(0, Math.floor(Number(rankMatch[1]))) : 0;
  if (rank === 1) {
    return 'temple_of_ancestors';
  }
  return null;
}

// Build framed panel box from inner content lines.
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

// Overlay warrior panel content onto the active grid.
function applyWarriorPanel(grid, panel, colors) {
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
    const text = String(line.text || '');
    const colorKey = line.colorKey || null;
    const colorStart = Number.isFinite(line.colorStart) ? Number(line.colorStart) : null;
    const colorEnd = Number.isFinite(line.colorEnd) ? Number(line.colorEnd) : null;
    for (let col = 0; col < text.length; col += 1) {
      const x = startX + col;
      if (grid[y][x] === undefined) {
        continue;
      }
      const ch = text[col];
      const shouldColor = colorKey && (colorStart === null || (col >= colorStart && col < colorEnd));
      grid[y][x] = shouldColor ? applyColor(ch, colorKey, colors) : ch;
    }
  }
}

module.exports = { buildWarriorPanel, applyWarriorPanel };
