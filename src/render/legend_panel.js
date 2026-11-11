'use strict';

const { padRight, clamp } = require('../utils');
const { fitLine } = require('./format');
const { applyColor } = require('./colors');
const { buildLegendSections } = require('./legend');

const SECTION_RUNES = {
  LEGEND: 'ᛚ',
  MAP: 'ᚨ',
};

function getActiveUnderrealmDepth(state) {
  const underrealm = state && state.underrealm;
  if (!underrealm || underrealm.enabled === false) {
    return 0;
  }
  const maxUnlockedDepth = Math.max(0, Math.floor(Number(underrealm.maxUnlockedDepth || 0)));
  const activeDepth = Math.max(0, Math.floor(Number(underrealm.activeDepth || 0)));
  return clamp(activeDepth, 0, maxUnlockedDepth);
}

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
  if (gridWidth < 8 || gridHeight < 4) {
    return null;
  }

  const targetWidth = Number(uiConfig.width || 60);
  const targetHeight = Number(uiConfig.height || 18);
  const width = clamp(Math.floor(targetWidth), 30, gridWidth);
  const height = clamp(Math.floor(targetHeight), 10, gridHeight);
  const innerWidth = Math.max(1, width - 6);
  const contentWidth = Math.max(1, innerWidth - 1);
  const innerHeight = Math.max(1, height - 2);

  const { legendParts, terrainParts } = buildLegendSections(config, {
    detailed: true,
    underrealmActive: getActiveUnderrealmDepth(state) > 0,
  });
  const content = [];
  pushSection(content, 'LEGEND', contentWidth, buildColumns(legendParts, contentWidth, 3, 2));
  pushSection(content, 'MAP', contentWidth, buildColumns(terrainParts, contentWidth, 3, 2));
  const pageCapacity = Math.max(1, innerHeight - 1);
  const pageCount = Math.max(1, Math.ceil(content.length / pageCapacity));
  const requestedPage = Number(legendState.page);
  const page = clamp(Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0, 0, pageCount - 1);
  const lines = buildLegendLines(content, contentWidth, innerHeight, page, pageCount);
  const panelLines = buildPanelBox(lines, innerWidth, contentWidth);

  const x = Math.max(0, Math.floor((gridWidth - width) / 2));
  const y = Math.max(0, Math.floor((gridHeight - height) / 2));

  return {
    lines: panelLines,
    x,
    y,
    width,
    height,
    page,
    pageCount,
  };
}

// Build inner lines for the legend panel.
function buildLegendLines(entries, width, height, page, pageCount) {
  const maxContent = Math.max(0, height - 1);
  const trimmed = entries.slice(page * maxContent, (page + 1) * maxContent);
  while (trimmed.length < maxContent) {
    trimmed.push({ text: '', spans: [] });
  }
  const suffix = `${page + 1}/${pageCount}`;
  const hints = pageCount > 1
    ? [`[l] Close  [arrows] Page ${suffix}`, `[l] Close [arrows] ${suffix}`, `[l] [<>] ${suffix}`]
    : ['[l] Close legend'];
  const controlsLine = hints.find((hint) => hint.length <= width) || hints[hints.length - 1];
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

// Browse only the legend's UI page, leaving map depth and simulation state untouched.
function moveLegendPage(state, config, runtime, direction) {
  const panel = buildLegendPanel(state, config, runtime);
  if (!panel) return false;
  const delta = Number.isFinite(Number(direction)) ? Math.trunc(Number(direction)) : 0;
  state.ui.legend.page = ((panel.page + delta) % panel.pageCount + panel.pageCount) % panel.pageCount;
  return true;
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
  const gapWidth = Math.max(0, Number(gap || 0));
  const longest = Math.max(1, ...normalized.map((entry) => entry.text.length));
  const columns = Math.max(1, Math.min(Number(columnCount || 1),
    Math.floor((width + gapWidth) / (longest + gapWidth))));
  const usable = Math.max(0, width - gapWidth * (columns - 1));
  const colWidth = Math.floor(usable / columns);
  if (columns === 1 || colWidth < 12) {
    return normalized.flatMap((entry) => {
      const lines = [];
      for (let offset = 0; offset < Math.max(1, entry.text.length); offset += width) {
        const text = entry.text.slice(offset, offset + width);
        lines.push({ text, spans: entry.colorKey ? [{ start: 0, end: text.length, colorKey: entry.colorKey }] : [] });
      }
      return lines;
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

module.exports = { buildLegendPanel, applyLegendPanel, moveLegendPage };
