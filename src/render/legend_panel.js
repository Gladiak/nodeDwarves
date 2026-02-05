'use strict';

const { padRight, clamp } = require('../utils');
const { fitLine } = require('./format');
const { applyColor } = require('./colors');
const { buildLegendSections } = require('./legend');

const SECTION_RUNES = {
  LEGEND: 'ᛚ',
  MAP: 'ᚨ',
};

// Build a legend panel descriptor when enabled.
function buildLegendPanel(state, config, runtime) {
  const uiConfig = (config.display && config.display.legend_panel) || {};
  if (uiConfig.enabled === false) {
    return null;
  }
  const legendState = state && state.ui ? state.ui.legend : null;
  if (!legendState || !legendState.open) {
    return null;
  }

  const gridWidth = Math.max(0, Number(runtime.gridWidth || 0));
  const gridHeight = Math.max(0, Number(runtime.gridHeight || 0));
  if (gridWidth <= 0 || gridHeight <= 0) {
    return null;
  }

  const targetWidth = Number(uiConfig.width || 60);
  const targetHeight = Number(uiConfig.height || 18);
  const width = clamp(Math.floor(targetWidth), 30, gridWidth);
  const height = clamp(Math.floor(targetHeight), 10, gridHeight);
  const innerWidth = Math.max(1, width - 6);
  const contentWidth = Math.max(1, innerWidth - 1);
  const innerHeight = Math.max(1, height - 2);

  const { legendParts, terrainParts } = buildLegendSections(config, { detailed: true });
  const lines = buildLegendLines(legendParts, terrainParts, contentWidth, innerHeight);
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

// Build inner lines for the legend panel.
function buildLegendLines(legendParts, terrainParts, width, height) {
  const controlsLine = '[l] Close legend';
  const maxContent = Math.max(0, height - 1);
  const content = [];

  const legendLines = buildColumns(legendParts, width, 2, 2);
  const sectionSlots = Math.max(0, maxContent - 1);
  const sectionHeight = Math.floor(sectionSlots / 2);
  const entriesPerSection = Math.max(0, sectionHeight - 2);
  const legendEntries = fitSectionEntries(legendLines, entriesPerSection);

  const terrainLines = buildColumns(terrainParts, width, 2, 2);
  const terrainEntries = fitSectionEntries(terrainLines, entriesPerSection);
  pushSection(content, 'LEGEND', width, legendEntries);
  pushSection(content, 'MAP', width, terrainEntries);

  const trimmed = content.slice(0, maxContent);
  while (trimmed.length < maxContent) {
    trimmed.push({ text: '', spans: [] });
  }
  trimmed.push({ text: fitLine(controlsLine, width), spans: [] });
  return trimmed.map((entry) => {
    const text = fitLine(entry.text, width);
    const spans = clampSpans(entry.spans, text.length);
    return {
      text,
      spans,
      colorKey: entry.colorKey || null,
      separator: entry.separator,
    };
  });
}

// Fit legend/map entries to a fixed section height (excluding header + spacer).
function fitSectionEntries(entries, slots) {
  const limit = Math.max(0, Number(slots || 0));
  if (limit === 0) {
    return [];
  }
  const list = Array.isArray(entries) ? entries.filter((entry) => entry) : [];
  const result = [];
  if (list.length === 0) {
    result.push({ text: 'None', spans: [] });
  }
  for (const entry of list) {
    if (result.length >= limit) {
      break;
    }
    result.push(entry);
  }
  while (result.length < limit) {
    result.push({ text: '', spans: [] });
  }
  return result;
}

// Push a section with a colored header and separator.
function pushSection(lines, title, width, entries) {
  if (lines.length > 0) {
    lines.push({ text: '', colorKey: null, separator: true });
  }
  const rune = SECTION_RUNES[title] ? `${SECTION_RUNES[title]} ` : '';
  pushLine(lines, `${rune}${String(title || '')}`, width, 'hud_header');
  lines.push({ text: '', spans: [] });
  for (const entry of entries || []) {
    if (!entry) {
      continue;
    }
    pushLine(lines, entry, width);
  }
}

// Push a single line into the buffer.
function pushLine(lines, value, width, colorKey = null) {
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'text')) {
    const text = fitLine(value.text || '', width);
    const spans = clampSpans(value.spans, text.length);
    lines.push({ text, spans, colorKey: value.colorKey || colorKey || null });
    return;
  }
  const text = fitLine(value, width);
  lines.push({ text, spans: [], colorKey });
}

// Build column layout for a list of entries.
function buildColumns(items, width, columnCount, gap) {
  const entries = Array.isArray(items) ? items.filter((item) => item) : [];
  if (entries.length === 0) {
    return [];
  }
  const normalized = entries.map((entry) => {
    if (entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'text')) {
      return { text: String(entry.text || ''), colorKey: entry.colorKey || null };
    }
    return { text: String(entry), colorKey: null };
  });
  const columns = Math.max(1, Number(columnCount || 1));
  const gapWidth = Math.max(0, Number(gap || 0));
  const usable = Math.max(0, width - gapWidth * (columns - 1));
  const colWidth = Math.floor(usable / columns);
  if (columns === 1 || colWidth < 12) {
    return normalized.map((entry) => {
      const text = fitLine(entry.text, width);
      const spans = entry.colorKey ? [{ start: 0, end: text.length, colorKey: entry.colorKey }] : [];
      return { text, spans };
    });
  }

  const rows = Math.ceil(normalized.length / columns);
  const cols = [];
  for (let c = 0; c < columns; c += 1) {
    cols.push(normalized.slice(c * rows, (c + 1) * rows));
  }

  const lines = [];
  for (let r = 0; r < rows; r += 1) {
    const parts = [];
    const spans = [];
    let cursor = 0;
    for (let c = 0; c < columns; c += 1) {
      const entry = cols[c][r] || { text: '', colorKey: null };
      const valueText = fitLine(entry.text, colWidth);
      parts.push(padRight(valueText, colWidth));
      if (entry.colorKey && valueText.length > 0) {
        spans.push({ start: cursor, end: cursor + valueText.length, colorKey: entry.colorKey });
      }
      cursor += colWidth;
      if (c < columns - 1) {
        cursor += gapWidth;
      }
    }
    const text = parts.join(' '.repeat(gapWidth)).trimEnd();
    lines.push({ text, spans: clampSpans(spans, text.length) });
  }
  return lines;
}

// Build a bordered panel from inner lines.
function buildPanelBox(lines, innerWidth, contentWidth) {
  const top = { text: `╔═╦${'═'.repeat(innerWidth)}╦═╗`, spans: [] };
  const bottom = { text: `╚═╩${'═'.repeat(innerWidth)}╩═╝`, spans: [] };
  const padWidth = Math.max(1, Number(contentWidth || innerWidth));
  const contentStart = 4;
  const contentEnd = contentStart + padWidth;
  const body = lines.map((line) => {
    if (line.separator) {
      return { text: `╠═╬${'═'.repeat(innerWidth)}╬═╣`, spans: [] };
    }
    const spans = [];
    if (Array.isArray(line.spans)) {
      for (const span of line.spans) {
        if (!span || !span.colorKey) {
          continue;
        }
        const start = contentStart + span.start;
        const end = contentStart + span.end;
        if (end > start) {
          spans.push({ start, end, colorKey: span.colorKey });
        }
      }
    }
    if ((!line.spans || line.spans.length === 0) && line.colorKey) {
      spans.push({ start: contentStart, end: contentEnd, colorKey: line.colorKey });
    }
    return {
      text: `║░║ ${padRight(line.text, padWidth)}║░║`,
      spans,
    };
  });
  return [top, ...body, bottom];
}

// Overlay the legend panel onto the grid.
function applyLegendPanel(grid, panel, colors) {
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
    const spans = Array.isArray(line.spans) ? line.spans : [];
    for (let col = 0; col < text.length; col += 1) {
      const x = startX + col;
      if (grid[y][x] === undefined) {
        continue;
      }
      const ch = text[col];
      let colorKey = null;
      for (const span of spans) {
        if (col >= span.start && col < span.end) {
          colorKey = span.colorKey;
          break;
        }
      }
      grid[y][x] = colorKey ? applyColor(ch, colorKey, colors) : ch;
    }
  }
}

// Clamp span ranges to a maximum length.
function clampSpans(spans, maxLength) {
  const limit = Math.max(0, Number(maxLength || 0));
  const result = [];
  for (const span of Array.isArray(spans) ? spans : []) {
    if (!span || !span.colorKey) {
      continue;
    }
    const start = Math.max(0, Math.min(limit, Number(span.start || 0)));
    const end = Math.max(0, Math.min(limit, Number(span.end || 0)));
    if (end > start) {
      result.push({ start, end, colorKey: span.colorKey });
    }
  }
  return result;
}

module.exports = { buildLegendPanel, applyLegendPanel };
