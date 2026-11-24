'use strict';

// In-game telemetry panel ([h]): a plain-language colony report.
// Pages: Colony Status, Economy, People, Frontier & Defense, and a Technical page
// with AI and Story Director internals. Content comes from colony_report.js.

const { padRight, clamp } = require('../utils');
const { fitLine, wrapLine } = require('../render/format');
const { applyColor, getColorConfig } = require('../render/colors');
const { buildTelemetrySections } = require('./telemetry');
const {
  STATUS_GOOD,
  STATUS_WATCH,
  STATUS_BAD,
  STATUS_INFO,
  buildColonyReport,
  buildHistorySample,
} = require('./colony_report');

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;
const DEFAULT_HISTORY = {
  history_points: 32,
  snapshot_interval_ticks: 120,
};
const STATUS_BADGES = {
  [STATUS_GOOD]: { text: 'GOOD', colorKey: 'weather_clear', bullet: '+' },
  [STATUS_WATCH]: { text: 'WATCH', colorKey: 'alert_warning', bullet: '!' },
  [STATUS_BAD]: { text: 'BAD', colorKey: 'alert_critical', bullet: '!!' },
  [STATUS_INFO]: { text: '-', colorKey: 'menu_muted', bullet: '-' },
};
const TITLE_COLOR_KEY = 'hud_header';
const MUTED_COLOR_KEY = 'menu_muted';
const LABEL_WIDTH = 14;
const BADGE_WIDTH = 6;
const BAR_WIDTH = 10;
const MAX_VALUE_WIDTH = 42;
const COLUMN_GAP = 4;
const MIN_COLUMN_WIDTH = 58;
const TELEMETRY_PANEL_PAGES = [
  {
    id: 'status',
    title: 'Colony Status',
    intro: 'Quick health check. GOOD = fine, WATCH = slipping, BAD = act now. Trends compare with one year ago.',
  },
  {
    id: 'economy',
    title: 'Economy',
    intro: 'Stocks against the colony targets, what the dwarves work on, and trade with neighbours.',
  },
  {
    id: 'people',
    title: 'People',
    intro: 'Mood, births and deaths, housing, friendships and the political climate.',
  },
  {
    id: 'frontier',
    title: 'Frontier & Defense',
    intro: 'Threats to the colony and its long ventures: raids, nemeses, Underrealm, ruins and warriors.',
  },
  {
    id: 'technical',
    title: 'Technical',
    intro: 'Internal signals for debugging and AI training. Not needed to follow the colony.',
  },
];
const TECHNICAL_BLOCKS = [
  { key: 'explainability', title: 'AI decisions', intro: 'Latest governor choices and their drivers.' },
  { key: 'storyDirector', title: 'Story Director', intro: 'Narrative focus, sagas and selection counters.' },
];

// Return the number of telemetry panel pages.
function getTelemetryPanelPageCount() {
  return TELEMETRY_PANEL_PAGES.length;
}

// Resolve history sampling settings (display.telemetry_panel.dashboard).
function resolveHistoryConfig(config) {
  const panel = config && config.display && config.display.telemetry_panel;
  const source = panel && panel.dashboard && typeof panel.dashboard === 'object' ? panel.dashboard : {};
  const points = Number(source.history_points);
  const interval = Number(source.snapshot_interval_ticks);
  return {
    historyPoints: clamp(Math.floor(Number.isFinite(points) ? points : DEFAULT_HISTORY.history_points), 8, 240),
    snapshotIntervalTicks: Math.max(1, Math.floor(Number.isFinite(interval) ? interval : DEFAULT_HISTORY.snapshot_interval_ticks)),
  };
}

// Record one trend sample every interval, even while the panel is closed (render-only state).
function updateReportHistory(state, config) {
  if (!state || typeof state !== 'object') {
    return [];
  }
  if (!state.renderState || typeof state.renderState !== 'object') {
    state.renderState = {};
  }
  if (!Array.isArray(state.renderState.telemetryReportHistory)) {
    state.renderState.telemetryReportHistory = [];
  }
  const history = state.renderState.telemetryReportHistory;
  const { historyPoints, snapshotIntervalTicks } = resolveHistoryConfig(config);
  const tick = Math.max(0, Math.floor(Number(state.tick || 0)));
  const last = history[history.length - 1];
  if (last && tick < Number(last.tick || 0)) {
    history.length = 0;
  }
  const latest = history[history.length - 1];
  if (!latest || tick - Number(latest.tick || 0) >= snapshotIntervalTicks) {
    history.push(buildHistorySample(state, config));
  }
  while (history.length > historyPoints) {
    history.shift();
  }
  return history;
}

// Build a telemetry panel descriptor when enabled and opened.
function buildTelemetryPanel(state, config, runtime) {
  const uiConfig = (config.display && config.display.telemetry_panel) || {};
  if (uiConfig.enabled === false) {
    return null;
  }
  const history = updateReportHistory(state, config);
  const telemetryState = state && state.ui ? state.ui.telemetryPanel : null;
  if (!telemetryState || !telemetryState.open) {
    return null;
  }
  const gridWidth = Math.max(0, Number(runtime.gridWidth || 0));
  const gridHeight = Math.max(0, Number(runtime.gridHeight || 0));
  if (gridWidth <= 0 || gridHeight <= 0) {
    return null;
  }
  const targetWidth = Number(uiConfig.width || Math.floor(gridWidth * 0.98));
  const targetHeight = Number(uiConfig.height || Math.floor(gridHeight * 0.98));
  const width = clamp(Math.floor(targetWidth), 70, gridWidth);
  const height = clamp(Math.floor(targetHeight), 24, gridHeight);
  const innerWidth = Math.max(1, width - 6);
  const contentWidth = Math.max(1, innerWidth - 1);
  const innerHeight = Math.max(1, height - 2);
  const pageCount = getTelemetryPanelPageCount();
  const pageIndex = normalizePanelPageIndex(telemetryState.page, pageCount);
  const page = TELEMETRY_PANEL_PAGES[pageIndex];
  const lines = buildTelemetryPanelLines(state, config, contentWidth, innerHeight, {
    pageIndex,
    pageCount,
    page,
    history,
    alertConfig: getColorConfig(config).alerts,
  });
  return {
    lines: buildPanelBox(lines, innerWidth, contentWidth),
    x: Math.max(0, Math.floor((gridWidth - width) / 2)),
    y: Math.max(0, Math.floor((gridHeight - height) / 2)),
    width,
    height,
  };
}

// Build content lines (header, page body, controls) for the telemetry panel.
function buildTelemetryPanelLines(state, config, width, height, context) {
  const controlsLine = '[<-]/[->] Page  [h] Close  [w] Warrior league  [e] Event log  [i] Dwarf info  [l] Legend  [s] Save';
  const { page, pageIndex, pageCount } = context;
  let cachedSections = null;
  const getSections = () => {
    if (!cachedSections) {
      cachedSections = buildTelemetrySections(state, config, Math.max(40, Math.floor(width / 2)));
    }
    return cachedSections;
  };
  const reportPageId = page.id === 'technical' ? 'status' : page.id;
  const report = buildColonyReport(reportPageId, state, config, {
    history: context.history,
    alertConfig: context.alertConfig,
    getSections,
  });
  const badge = STATUS_BADGES[report.overall] || STATUS_BADGES[STATUS_INFO];
  const top = [];
  top.push(entryWithSpan(`COLONY REPORT  [${pageIndex + 1}/${pageCount}] ${page.title.toUpperCase()}`, width, TITLE_COLOR_KEY));
  const overallText = `OVERALL: ${badge.text}`;
  const headerText = `${fitLine(report.header, Math.max(0, width - overallText.length - 2)).trimEnd()}`;
  const headerLine = `${padRight(headerText, Math.max(0, width - overallText.length))}${overallText}`;
  top.push({
    text: fitLine(headerLine, width),
    spans: [{ start: Math.max(0, width - overallText.length), end: width, colorKey: badge.colorKey }],
  });
  for (const row of wrapLine(report.summary, width)) {
    top.push(entryWithSpan(row, width, badge.colorKey));
  }
  const intro = report.trendNote && page.id !== 'technical' ? `${page.intro} ${report.trendNote}` : page.intro;
  for (const row of wrapLine(intro, width)) {
    top.push(entryWithSpan(row, width, MUTED_COLOR_KEY));
  }
  top.push({ separator: true });

  const blocks = page.id === 'technical'
    ? buildTechnicalBlocks(getSections())
    : report.blocks;
  const body = layoutBlocks(blocks, width);
  const maxContent = Math.max(0, height - 1);
  const available = Math.max(0, maxContent - top.length);
  let bodyArea = body;
  if (body.length > available) {
    bodyArea = body.slice(0, Math.max(0, available - 1));
    bodyArea.push(entryWithSpan('... more rows hidden: enlarge the terminal to see them.', width, MUTED_COLOR_KEY));
  }
  const lines = [...top, ...bodyArea];
  while (lines.length < maxContent) {
    lines.push({ text: '', spans: [] });
  }
  lines.length = Math.min(lines.length, maxContent);
  lines.push({ text: fitLine(controlsLine, width), spans: [] });
  return lines.map((entry) => ({
    text: fitLine(entry.text || '', width),
    colorKey: null,
    separator: entry.separator === true,
    spans: clampSpans(entry.spans, width),
  }));
}

// Build Technical page blocks from the detailed telemetry sections.
function buildTechnicalBlocks(sections) {
  return TECHNICAL_BLOCKS
    .filter((spec) => sections && sections[spec.key])
    .map((spec) => ({
      title: spec.title,
      intro: spec.intro,
      plain: (sections[spec.key].rows || []).map((row) => String(row || '').replace(ANSI_PATTERN, '')),
    }));
}

// Lay out report blocks in one or two columns, keeping color spans aligned.
function layoutBlocks(blocks, width) {
  const safeWidth = Math.max(1, Math.floor(Number(width || 1)));
  const columnCount = Math.floor((safeWidth - COLUMN_GAP) / 2) >= MIN_COLUMN_WIDTH ? 2 : 1;
  const columnWidth = columnCount === 2 ? Math.floor((safeWidth - COLUMN_GAP) / 2) : safeWidth;
  const rendered = (Array.isArray(blocks) ? blocks : [])
    .map((block) => renderBlock(block, columnWidth))
    .filter((lines) => lines.length > 0);
  if (columnCount === 1) {
    return joinBlocks(rendered);
  }
  const columns = [[], []];
  for (const lines of rendered) {
    const target = columns[0].length <= columns[1].length ? 0 : 1;
    if (columns[target].length > 0) {
      columns[target].push({ text: '', spans: [] });
    }
    columns[target].push(...lines);
  }
  const rows = Math.max(columns[0].length, columns[1].length);
  const merged = [];
  const offset = columnWidth + COLUMN_GAP;
  for (let index = 0; index < rows; index += 1) {
    const left = columns[0][index] || { text: '', spans: [] };
    const right = columns[1][index] || { text: '', spans: [] };
    merged.push({
      text: `${padRight(left.text, offset)}${right.text}`,
      spans: [
        ...(left.spans || []),
        ...(right.spans || []).map((span) => ({ ...span, start: span.start + offset, end: span.end + offset })),
      ],
    });
  }
  return merged;
}

// Stack rendered blocks vertically with one blank line between them.
function joinBlocks(rendered) {
  const out = [];
  for (const lines of rendered) {
    if (out.length > 0) {
      out.push({ text: '', spans: [] });
    }
    out.push(...lines);
  }
  return out;
}

// Render one block: title + intro, then status rows, bullet lines or plain lines.
function renderBlock(block, width) {
  if (!block) {
    return [];
  }
  const lines = [];
  const title = `[${block.title}]`;
  const titleLine = block.intro ? `${title} ${block.intro}` : title;
  const wrappedTitle = wrapLine(titleLine, width);
  wrappedTitle.forEach((row, index) => {
    const spans = [{ start: 0, end: row.length, colorKey: MUTED_COLOR_KEY }];
    if (index === 0) {
      spans.unshift({ start: 0, end: Math.min(row.length, title.length), colorKey: TITLE_COLOR_KEY });
    }
    lines.push({ text: fitLine(row, width), spans });
  });
  if (Array.isArray(block.rows)) {
    lines.push(...renderStatusRows(block.rows, width));
  }
  if (Array.isArray(block.lines)) {
    lines.push(...renderBulletLines(block.lines, width));
  }
  if (Array.isArray(block.plain)) {
    for (const raw of block.plain) {
      for (const row of wrapLine(raw, width)) {
        lines.push({ text: fitLine(row, width), spans: [] });
      }
    }
    if (block.plain.length === 0) {
      lines.push({ text: '-', spans: [] });
    }
  }
  return lines;
}

// Render aligned status rows: label, badge, (bar), value, then the meaning.
function renderStatusRows(rows, width) {
  const hasBar = rows.some((row) => row && row.bar !== undefined);
  const barWidth = hasBar ? BAR_WIDTH + 3 : 0;
  const valueWidth = Math.min(
    MAX_VALUE_WIDTH,
    Math.max(8, ...rows.map((row) => String(row && row.value || '').length)),
  );
  const prefixWidth = LABEL_WIDTH + BADGE_WIDTH + barWidth;
  const lines = [];
  for (const row of rows) {
    if (!row) {
      continue;
    }
    const badge = STATUS_BADGES[row.status] || STATUS_BADGES[STATUS_INFO];
    const bar = hasBar ? `[${buildBar(row.bar)}] ` : '';
    const label = padRight(fitLine(String(row.label || ''), LABEL_WIDTH - 1), LABEL_WIDTH);
    const badgeText = padRight(badge.text, BADGE_WIDTH);
    const value = String(row.value || '');
    const note = String(row.note || '');
    const head = `${label}${badgeText}${bar}`;
    const spans = [{ start: LABEL_WIDTH, end: LABEL_WIDTH + badge.text.length, colorKey: badge.colorKey }];
    const inline = `${head}${padRight(value, valueWidth)}  ${note}`.trimEnd();
    if (inline.length <= width && value.length <= valueWidth) {
      const noteStart = head.length + valueWidth + 2;
      if (note) {
        spans.push({ start: noteStart, end: noteStart + note.length, colorKey: MUTED_COLOR_KEY });
      }
      lines.push({ text: fitLine(inline, width), spans });
      continue;
    }
    const valueRows = wrapLine(value, Math.max(8, width - prefixWidth));
    valueRows.forEach((valueRow, index) => {
      const prefix = index === 0 ? head : ' '.repeat(head.length);
      lines.push({ text: fitLine(`${prefix}${valueRow}`, width), spans: index === 0 ? spans : [] });
    });
    if (note) {
      const indent = Math.min(prefixWidth, Math.max(0, width - 20));
      for (const noteRow of wrapLine(note, Math.max(8, width - indent))) {
        const text = `${' '.repeat(indent)}${noteRow}`;
        lines.push({ text: fitLine(text, width), spans: [{ start: indent, end: text.length, colorKey: MUTED_COLOR_KEY }] });
      }
    }
  }
  return lines;
}

// Render bullet lines (status-colored marker + wrapped text).
function renderBulletLines(items, width) {
  const lines = [];
  for (const item of items) {
    const badge = STATUS_BADGES[item && item.status] || STATUS_BADGES[STATUS_INFO];
    const marker = padRight(badge.bullet, 3);
    const rows = wrapLine(String(item && item.text || ''), Math.max(8, width - marker.length));
    rows.forEach((row, index) => {
      const text = `${index === 0 ? marker : '   '}${row}`;
      lines.push({
        text: fitLine(text, width),
        spans: index === 0 ? [{ start: 0, end: badge.bullet.length, colorKey: badge.colorKey }] : [],
      });
    });
  }
  return lines;
}

// Build a fixed-width fill bar for a ratio (full at or above 100%).
function buildBar(ratio) {
  if (ratio === null || ratio === undefined || !Number.isFinite(Number(ratio))) {
    return ' '.repeat(BAR_WIDTH);
  }
  const filled = clamp(Math.round(Number(ratio) * BAR_WIDTH), 0, BAR_WIDTH);
  return `${'#'.repeat(filled)}${'-'.repeat(BAR_WIDTH - filled)}`;
}

// Build one full-width line colored by a single span.
function entryWithSpan(text, width, colorKey) {
  const fitted = fitLine(String(text || ''), width);
  return { text: fitted, spans: [{ start: 0, end: fitted.trimEnd().length, colorKey }] };
}

// Normalize telemetry page index into a safe wrapped range.
function normalizePanelPageIndex(value, pageCount) {
  const size = Math.max(1, Number(pageCount || 1));
  const numeric = Math.floor(Number(value || 0));
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return ((numeric % size) + size) % size;
}

// Clamp color spans to line bounds.
function clampSpans(spans, maxLength) {
  if (!Array.isArray(spans) || spans.length === 0 || maxLength <= 0) {
    return [];
  }
  const out = [];
  for (const span of spans) {
    if (!span || !span.colorKey) {
      continue;
    }
    const start = Math.max(0, Math.floor(Number(span.start || 0)));
    const end = Math.min(maxLength, Math.ceil(Number(span.end || 0)));
    if (end > start) {
      out.push({ start, end, colorKey: String(span.colorKey) });
    }
  }
  return out;
}

// Build an ASCII framed panel from content lines.
function buildPanelBox(lines, innerWidth, contentWidth) {
  const top = { text: `╔═╦${'═'.repeat(innerWidth)}╦═╗`, colorKey: null, separator: false };
  const bottom = { text: `╚═╩${'═'.repeat(innerWidth)}╩═╝`, colorKey: null, separator: false };
  const padWidth = Math.max(1, Number(contentWidth || innerWidth));
  const body = lines.map((line) => {
    if (line.separator) {
      return { text: `╠═╬${'═'.repeat(innerWidth)}╬═╣`, colorKey: null, separator: false };
    }
    return {
      text: `║░║ ${padRight(line.text || '', padWidth)}║░║`,
      colorKey: line.colorKey || null,
      spans: clampSpans(
        (Array.isArray(line.spans) ? line.spans : []).map((span) => ({
          start: Number(span.start || 0) + 4,
          end: Number(span.end || 0) + 4,
          colorKey: span.colorKey,
        })),
        4 + padWidth,
      ),
      separator: false,
      contentStart: 4,
      contentEnd: 4 + padWidth,
    };
  });
  return [top, ...body, bottom];
}

// Overlay the telemetry panel onto the current grid.
function applyTelemetryPanel(grid, panel, colors) {
  if (!panel || !Array.isArray(panel.lines)) {
    return;
  }
  for (let row = 0; row < panel.lines.length; row += 1) {
    const y = panel.y + row;
    if (!grid[y]) {
      continue;
    }
    const line = panel.lines[row];
    const text = String(line.text || '');
    const colorKey = line.colorKey || null;
    const spans = Array.isArray(line.spans) ? line.spans : [];
    const contentStart = Number.isFinite(line.contentStart) ? Number(line.contentStart) : null;
    const contentEnd = Number.isFinite(line.contentEnd) ? Number(line.contentEnd) : null;
    const hasContentRange = contentStart !== null && contentEnd !== null && contentEnd > contentStart;
    for (let col = 0; col < text.length; col += 1) {
      const x = panel.x + col;
      if (grid[y][x] === undefined) {
        continue;
      }
      const ch = text[col];
      let spanColorKey = null;
      for (const span of spans) {
        if (col >= span.start && col < span.end) {
          spanColorKey = span.colorKey;
          break;
        }
      }
      if (spanColorKey) {
        grid[y][x] = applyColor(ch, spanColorKey, colors);
      } else if (colorKey && hasContentRange && col >= contentStart && col < contentEnd) {
        grid[y][x] = applyColor(ch, colorKey, colors);
      } else {
        grid[y][x] = colorKey && !hasContentRange ? applyColor(ch, colorKey, colors) : ch;
      }
    }
  }
}

module.exports = { buildTelemetryPanel, applyTelemetryPanel, getTelemetryPanelPageCount };
