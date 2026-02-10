'use strict';

const { padRight, clamp } = require('../utils');
const { fitLine, wrapLine } = require('./format');
const { applyColor, getColorConfig } = require('./colors');
const { getStockpileTarget } = require('../simulation/resources');
const {
  buildTelemetrySections,
  formatColumns,
  getTelemetryColumnWidth,
} = require('./telemetry');

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;
const DEFAULT_ALERTS = {
  tracked_resources: ['food', 'water', 'beer'],
  stockpile_warning_ratio: 0.5,
  stockpile_critical_ratio: 0.25,
  morale_warning: 0.45,
  morale_critical: 0.3,
  shortage_warning_score: 1.5,
  shortage_critical_score: 2.5,
};
const SECTION_TOKEN_COLOR_KEYS = {
  world: 'weather_clear',
  population: 'dwarf',
  pressure: 'alert_critical',
  stockpile: 'food',
  structures: 'workshop',
  diplomacy: 'merchant',
  operations: 'brewery',
  'ai explainability': 'hud_header',
  endgame: 'temple_of_ancestors',
  underrealm: 'underrealm_delver',
  lore: 'alchemy_lab',
  'deep signals': 'underrealm_hostile',
  workforce: 'dwarf',
  'resource pressure': 'alert_warning',
  'diplomacy signals': 'merchant',
  'underrealm cues': 'underrealm_delver',
};
const SECTION_TOKEN_REGEX = buildSectionTokenRegex(SECTION_TOKEN_COLOR_KEYS);

const TELEMETRY_PANEL_PAGES = [
  {
    id: 'overview_deep',
    title: 'Overview + Deep',
    subtitle: 'Core world, underrealm combat gates, population, pressure, lore, and deep signals.',
    sections: ['world', 'underrealm', 'population', 'lore', 'pressure', 'deepSignals'],
    preferredColumns: 2,
    minColumnWidth: 38,
  },
  {
    id: 'economy',
    title: 'Economy',
    subtitle: 'Production chain health, governor signals, explainability drivers, diplomacy flow, and endgame checklist.',
    sections: ['stockpile', 'structures', 'operations', 'explainability', 'diplomacy', 'endgame'],
    preferredColumns: 2,
    minColumnWidth: 38,
  },
];

// Return the number of telemetry panel pages.
function getTelemetryPanelPageCount() {
  return TELEMETRY_PANEL_PAGES.length;
}

// Clamp a numeric ratio to [0, 1], with fallback.
function clampUnit(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return clampUnit(fallback, 0);
  }
  return Math.max(0, Math.min(1, numeric));
}

// Resolve normalized alert thresholds for telemetry panel status.
function resolveTelemetryAlertConfig(alerts) {
  const source = alerts && typeof alerts === 'object' ? alerts : {};
  const tracked = Array.isArray(source.tracked_resources)
    ? source.tracked_resources.map((value) => String(value || '').trim()).filter(Boolean)
    : DEFAULT_ALERTS.tracked_resources;
  const stockpileCritical = clampUnit(
    source.stockpile_critical_ratio,
    DEFAULT_ALERTS.stockpile_critical_ratio,
  );
  const stockpileWarning = Math.max(
    stockpileCritical,
    clampUnit(source.stockpile_warning_ratio, DEFAULT_ALERTS.stockpile_warning_ratio),
  );
  const moraleCritical = clampUnit(source.morale_critical, DEFAULT_ALERTS.morale_critical);
  const moraleWarning = Math.max(
    moraleCritical,
    clampUnit(source.morale_warning, DEFAULT_ALERTS.morale_warning),
  );
  const shortageWarning = Math.max(
    0,
    Number.isFinite(Number(source.shortage_warning_score))
      ? Number(source.shortage_warning_score)
      : DEFAULT_ALERTS.shortage_warning_score,
  );
  const shortageCritical = Math.max(
    shortageWarning,
    Number.isFinite(Number(source.shortage_critical_score))
      ? Number(source.shortage_critical_score)
      : DEFAULT_ALERTS.shortage_critical_score,
  );
  return {
    tracked_resources: tracked.length > 0 ? tracked : DEFAULT_ALERTS.tracked_resources.slice(),
    stockpile_warning_ratio: stockpileWarning,
    stockpile_critical_ratio: stockpileCritical,
    morale_warning: moraleWarning,
    morale_critical: moraleCritical,
    shortage_warning_score: shortageWarning,
    shortage_critical_score: shortageCritical,
  };
}

// Resolve the minimum stockpile ratio across tracked resources.
function resolveTelemetryStockpileRatio(state, config, trackedResources) {
  const tracked = Array.isArray(trackedResources) && trackedResources.length > 0
    ? trackedResources
    : DEFAULT_ALERTS.tracked_resources;
  let minRatio = 1;
  let found = false;
  for (const resourceId of tracked) {
    const id = String(resourceId || '').trim();
    if (!id) {
      continue;
    }
    const target = Math.max(0, Number(getStockpileTarget(state, config, id) || 0));
    if (target <= 0) {
      continue;
    }
    const current = Math.max(0, Number(state && state.stockpile ? state.stockpile[id] : 0));
    minRatio = Math.min(minRatio, clampUnit(current / target, 0));
    found = true;
  }
  return found ? minRatio : 1;
}

// Check if at least one underrealm deep raid is active.
function hasActiveDeepRaid(state) {
  const raids = state
    && state.underrealm
    && state.underrealm.deepFaction
    && state.underrealm.deepFaction.activeRaidsByDepth;
  if (!raids || typeof raids !== 'object') {
    return false;
  }
  return Object.values(raids).some((entry) => entry && Number(entry.ticksRemaining || 0) > 0);
}

// Resolve telemetry panel alert state from core pressure indicators.
function resolveTelemetryAlertState(state, config, alertConfig) {
  const alerts = resolveTelemetryAlertConfig(alertConfig);
  const dwarves = Array.isArray(state && state.dwarves) ? state.dwarves : [];
  let moraleTotal = 0;
  let moraleCount = 0;
  for (const dwarf of dwarves) {
    const value = Number(dwarf && dwarf.state ? dwarf.state.morale : Number.NaN);
    if (!Number.isFinite(value)) {
      continue;
    }
    moraleTotal += value;
    moraleCount += 1;
  }
  const moraleRatio = moraleCount > 0 ? moraleTotal / moraleCount : 0;
  const stockpileRatio = resolveTelemetryStockpileRatio(state, config, alerts.tracked_resources);
  const shortageScore = Math.max(
    0,
    Number(
      state
      && Array.isArray(state.lastPriorities)
      && state.lastPriorities[0]
        ? state.lastPriorities[0].score
        : 0,
    ),
  );
  const raidActive = Boolean(state && state.raid && state.raid.active);
  const deepRaidActive = hasActiveDeepRaid(state);
  const shortageCritical = shortageScore >= alerts.shortage_critical_score;
  const shortageWarning = shortageScore >= alerts.shortage_warning_score;
  const stockpileCritical = stockpileRatio <= alerts.stockpile_critical_ratio;
  const stockpileWarning = stockpileRatio <= alerts.stockpile_warning_ratio;
  const moraleCritical = moraleRatio <= alerts.morale_critical;
  const moraleWarning = moraleRatio <= alerts.morale_warning;
  let level = 'stable';
  if (
    raidActive
    || deepRaidActive
    || shortageCritical
    || stockpileCritical
    || moraleCritical
  ) {
    level = 'critical';
  } else if (
    shortageWarning
    || stockpileWarning
    || moraleWarning
  ) {
    level = 'warning';
  }
  return {
    level,
    colorKey: level === 'critical' ? 'alert_critical' : level === 'warning' ? 'alert_warning' : 'weather_clear',
    moraleRatio: clampUnit(moraleRatio, 0),
    stockpileRatio,
    shortageScore,
    raidActive,
    deepRaidActive,
    shortageCritical,
    shortageWarning,
    stockpileCritical,
    stockpileWarning,
    moraleCritical,
    moraleWarning,
  };
}

// Resolve one compact cause label for telemetry alert status.
function resolveTelemetryAlertCause(alertState) {
  if (!alertState || alertState.level === 'stable') {
    return 'stable';
  }
  const reasons = [];
  if (alertState.deepRaidActive) {
    reasons.push('deepRaid');
  }
  if (alertState.raidActive) {
    reasons.push('raid');
  }
  if (alertState.shortageCritical || alertState.shortageWarning) {
    reasons.push('shortage');
  }
  if (alertState.stockpileCritical || alertState.stockpileWarning) {
    reasons.push('stockpile');
  }
  if (alertState.moraleCritical || alertState.moraleWarning) {
    reasons.push('morale');
  }
  if (reasons.length === 0) {
    return 'unknown';
  }
  return reasons.length === 1 ? reasons[0] : 'mixed';
}

// Format the panel top risk line with compact pressure values.
function formatTelemetryAlertLine(alertState) {
  const status = alertState.level === 'critical'
    ? 'CRITICAL'
    : alertState.level === 'warning'
      ? 'Warning'
      : 'Stable';
  const cause = resolveTelemetryAlertCause(alertState);
  const stockpilePct = Math.max(0, Math.round(Number(alertState.stockpileRatio || 0) * 100));
  const moralePct = Math.max(0, Math.round(Number(alertState.moraleRatio || 0) * 100));
  const shortage = Math.max(0, Number(alertState.shortageScore || 0)).toFixed(2);
  if (alertState.level === 'stable') {
    return `Colony risk: ${status}  Stock:${stockpilePct}% Mor:${moralePct}% Shortage:${shortage}`;
  }
  return `Colony risk: ${status} (${cause})  Stock:${stockpilePct}% Mor:${moralePct}% Shortage:${shortage}`;
}

// Build a telemetry panel descriptor when enabled and opened.
function buildTelemetryPanel(state, config, runtime) {
  const uiConfig = (config.display && config.display.telemetry_panel) || {};
  if (uiConfig.enabled === false) {
    return null;
  }
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
  const pageIndex = normalizePanelPageIndex(
    telemetryState && telemetryState.page,
    pageCount,
  );
  const pageDefinition = TELEMETRY_PANEL_PAGES[pageIndex] || TELEMETRY_PANEL_PAGES[0];
  const colorProfile = getColorConfig(config);

  const lines = buildTelemetryPanelLines(state, config, contentWidth, innerHeight, {
    pageIndex,
    pageCount,
    page: pageDefinition,
  }, colorProfile.alerts);
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

// Build content lines for the telemetry panel.
function buildTelemetryPanelLines(state, config, width, height, pageState, alertConfig) {
  const controlsLine = '[<-]/[->] Page  [h] Close telemetry  [i] Dwarf info  [l] Legend';
  const maxContent = Math.max(0, height - 1);
  const topEntries = [];
  const bodyEntries = [];
  const pageIndex = Number(pageState && pageState.pageIndex || 0);
  const pageCount = Math.max(1, Number(pageState && pageState.pageCount || 1));
  const page = pageState && pageState.page ? pageState.page : TELEMETRY_PANEL_PAGES[0];
  const pageTitle = page && page.title ? String(page.title) : 'Overview';
  const pageSubtitle = page && page.subtitle ? String(page.subtitle) : '';

  pushLine(
    topEntries,
    `NODEDWARVES DATA CENTER  [${pageIndex + 1}/${pageCount}] ${pageTitle.toUpperCase()}`,
    width,
    'hud_header',
  );
  pushLine(topEntries, pageSubtitle, width, 'weather_clear');
  const alertState = resolveTelemetryAlertState(state, config, alertConfig);
  pushLine(topEntries, formatTelemetryAlertLine(alertState), width, alertState.colorKey);
  topEntries.push({ separator: true });

  const telemetryLines = buildTelemetryPageLines(state, config, width, page);
  bodyEntries.push(...buildBodyEntriesFromTelemetryLines(telemetryLines, width));

  const availableRows = Math.max(0, maxContent - topEntries.length);
  const bodyArea = bodyEntries.slice(0, availableRows);
  while (bodyArea.length < availableRows) {
    bodyArea.push({ text: '', colorKey: null, spans: [] });
  }

  const trimmed = [...topEntries, ...bodyArea];
  if (trimmed.length > maxContent) {
    trimmed.splice(maxContent);
  }
  while (trimmed.length < maxContent) {
    trimmed.push({ text: '', colorKey: null, spans: [] });
  }
  trimmed.push({
    text: fitLine(controlsLine, width),
    colorKey: null,
    spans: [],
  });

  return trimmed.map((entry) => ({
    text: fitLine(entry.text || '', width),
    colorKey: entry.colorKey || null,
    separator: entry.separator === true,
    spans: clampSpans(entry.spans, Math.max(0, Number(width || 0))),
  }));
}

// Build telemetry rows for the selected Data Center page.
function buildTelemetryPageLines(state, config, width, page) {
  return buildSectionPageLines(state, config, width, page);
}

// Build telemetry rows for pages backed by regular telemetry sections.
function buildSectionPageLines(state, config, width, page) {
  const safeWidth = Math.max(1, Math.floor(Number(width || 1)));
  const sectionKeys = page && Array.isArray(page.sections) ? page.sections : [];
  if (sectionKeys.length === 0) {
    return ['No telemetry sections configured.'];
  }

  const gap = 3;
  let columnCount = Math.min(
    Math.max(1, Number(page && page.preferredColumns || 1)),
    sectionKeys.length,
  );
  const minColumnWidth = Math.max(26, Number(page && page.minColumnWidth || 36));
  let columnWidth = getTelemetryColumnWidth(safeWidth, columnCount, gap);
  while (columnCount > 1 && columnWidth < minColumnWidth) {
    columnCount -= 1;
    columnWidth = getTelemetryColumnWidth(safeWidth, columnCount, gap);
  }

  if (columnWidth <= 0) {
    return ['Telemetry width unavailable.'];
  }

  const sections = buildTelemetrySections(state, config, columnWidth, {
    includeRuins: true,
    includeMyths: true,
  });

  const sectionBlocks = sectionKeys.map((key) =>
    buildSectionBlockLines(sections && sections[key], key, columnWidth),
  );
  const usableBlocks = sectionBlocks.filter((block) => Array.isArray(block) && block.length > 0);
  if (usableBlocks.length === 0) {
    return ['No telemetry data available for this page.'];
  }

  const mergedColumns = mergeBlocksIntoColumns(usableBlocks, columnCount);
  return formatMergedColumns(mergedColumns, safeWidth, columnCount, gap);
}

// Build one telemetry section block using section header + rows.
function buildSectionBlockLines(section, sectionKey, width) {
  const lines = [];
  const safeWidth = Math.max(1, Math.floor(Number(width || 1)));
  const fallbackLabel = sectionKey ? String(sectionKey) : 'Section';
  const label = section && section.label ? String(section.label) : fallbackLabel;
  lines.push(fitLine(`[${label}]`, safeWidth));
  const rows = section && Array.isArray(section.rows) ? section.rows : [];
  if (rows.length === 0) {
    lines.push('-');
    return lines;
  }
  for (const row of rows) {
    pushWrappedLines(lines, stripAnsi(row), safeWidth);
  }
  return lines;
}

// Build wrapped body entries from telemetry rows.
function buildBodyEntriesFromTelemetryLines(telemetryLines, width) {
  const safeWidth = Math.max(1, Math.floor(Number(width || 1)));
  const entries = [];
  const lines = Array.isArray(telemetryLines) ? telemetryLines : [];
  for (const line of lines) {
    const wrappedLines = wrapLine(String(line || ''), safeWidth);
    for (const wrappedLine of wrappedLines) {
      const text = fitLine(String(wrappedLine || ''), safeWidth);
      entries.push({
        text,
        colorKey: null,
        spans: buildSectionTokenSpans(text),
      });
    }
  }
  return entries;
}

// Distribute variable-height blocks across telemetry columns.
function mergeBlocksIntoColumns(blocks, columnCount) {
  const safeCount = Math.max(1, Math.floor(Number(columnCount || 1)));
  const columns = Array.from({ length: safeCount }, () => []);
  for (let i = 0; i < blocks.length; i += 1) {
    const target = i % safeCount;
    if (columns[target].length > 0) {
      columns[target].push('');
    }
    columns[target].push(...blocks[i]);
  }
  return columns;
}

// Format one or more telemetry columns into final panel lines.
function formatMergedColumns(columns, safeWidth, columnCount, gap) {
  if (columnCount <= 1) {
    return (columns[0] || []).map((line) => fitLine(line, safeWidth));
  }
  return formatColumns(columns, safeWidth, columnCount, gap).map((line) =>
    fitLine(line, safeWidth),
  );
}

// Push one or more wrapped lines so long text never gets truncated.
function pushWrappedLines(lines, value, width) {
  const safeWidth = Math.max(1, Math.floor(Number(width || 1)));
  const wrapped = wrapLine(String(value || ''), safeWidth);
  for (const row of wrapped) {
    lines.push(fitLine(row, safeWidth));
  }
}

// Remove ANSI escape sequences so panel text is always grid-safe.
function stripAnsi(value) {
  return String(value || '').replace(ANSI_PATTERN, '');
}

// Build the section-token regex used for in-line color spans.
function buildSectionTokenRegex(colorMap) {
  const tokens = Object.keys(colorMap || {});
  if (tokens.length === 0) {
    return null;
  }
  const pattern = tokens
    .map((token) => escapeRegexToken(token))
    .sort((left, right) => right.length - left.length)
    .join('|');
  return new RegExp(`\\[(${pattern})\\]`, 'gi');
}

// Escape regex-special characters in one token.
function escapeRegexToken(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Normalize section labels for token/color mapping.
function normalizeSectionToken(label) {
  return String(label || '').trim().toLowerCase();
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

// Clamp token spans to line bounds.
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
    if (end <= start) {
      continue;
    }
    out.push({
      start,
      end,
      colorKey: String(span.colorKey),
    });
  }
  return out;
}

// Build color spans for section tokens such as [World], [Population], etc.
function buildSectionTokenSpans(lineText) {
  if (!SECTION_TOKEN_REGEX) {
    return [];
  }
  const text = String(lineText || '');
  const spans = [];
  const regex = new RegExp(SECTION_TOKEN_REGEX.source, SECTION_TOKEN_REGEX.flags);
  let match = regex.exec(text);
  while (match) {
    const rawLabel = String(match[1] || '');
    const colorKey = SECTION_TOKEN_COLOR_KEYS[normalizeSectionToken(rawLabel)] || 'hud_header';
    spans.push({
      start: match.index,
      end: match.index + match[0].length,
      colorKey,
    });
    match = regex.exec(text);
  }
  return spans;
}

// Push one line into the panel buffer.
function pushLine(lines, text, width, colorKey = null) {
  lines.push({ text: fitLine(String(text || ''), width), colorKey });
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
    const spans = Array.isArray(line.spans) ? line.spans : [];
    const contentStart = Number.isFinite(line.contentStart) ? Number(line.contentStart) : null;
    const contentEnd = Number.isFinite(line.contentEnd) ? Number(line.contentEnd) : null;
    const hasContentRange = contentStart !== null && contentEnd !== null && contentEnd > contentStart;
    for (let col = 0; col < text.length; col += 1) {
      const x = startX + col;
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
        continue;
      }
      if (
        colorKey
        && hasContentRange
        && col >= contentStart
        && col < contentEnd
      ) {
        grid[y][x] = applyColor(ch, colorKey, colors);
        continue;
      }
      grid[y][x] = colorKey && !hasContentRange ? applyColor(ch, colorKey, colors) : ch;
    }
  }
}

module.exports = { buildTelemetryPanel, applyTelemetryPanel, getTelemetryPanelPageCount };
