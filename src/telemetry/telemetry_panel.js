'use strict';

const { padRight, clamp } = require('../utils');
const { fitLine, wrapLine } = require('../render/format');
const { applyColor, getColorConfig } = require('../render/colors');
const { getStockpileTarget } = require('../simulation/resources');
const { getFestivalStatus } = require('../simulation/festivals');
const { getAlchemyStatus } = require('../simulation/alchemy');
const { getWorldEventStatus } = require('../simulation/world_events');
const { getExternalCampStatus } = require('../simulation/external_camps');
const { getSchismStatus } = require('../simulation/schism');
const {
  buildTelemetrySections,
  formatColumns,
  getTelemetryColumnWidth,
  formatCompactNumber,
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
const DEFAULT_DASHBOARD_HISTORY = {
  history_points: 32,
  snapshot_interval_ticks: 120,
};
const SECTION_TOKEN_COLOR_KEYS = {
  dashboard: 'hud_header',
  'kpi snapshot': 'hud_header',
  'trend charts': 'weather_clear',
  'forecast & bottlenecks': 'hud_header',
  'deep context': 'hud_header',
  'economy context': 'hud_header',
  'risk breakdown': 'alert_warning',
  'operations mix': 'brewery',
  'event timeline': 'merchant',
  'actionable insights': 'dwarf',
  world: 'weather_clear',
  population: 'dwarf',
  social: 'dwarf',
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
  'warrior league': 'armory',
  workforce: 'dwarf',
  'resource pressure': 'alert_warning',
  'diplomacy signals': 'merchant',
  'underrealm cues': 'underrealm_delver',
};
const SECTION_TOKEN_REGEX = buildSectionTokenRegex(SECTION_TOKEN_COLOR_KEYS);
const STATUS_TOKEN_COLOR_KEYS = {
  critical: 'alert_critical',
  blocked: 'alert_critical',
  failed: 'alert_critical',
  warning: 'alert_warning',
  pending: 'alert_warning',
  cooldown: 'alert_warning',
  active: 'alert_warning',
  ready: 'weather_clear',
  complete: 'weather_clear',
  cleared: 'weather_clear',
  online: 'weather_clear',
};
const STATUS_TOKEN_REGEX = buildStatusTokenRegex(STATUS_TOKEN_COLOR_KEYS);

const TELEMETRY_PANEL_PAGES = [
  {
    id: 'dashboard',
    title: 'Dashboard',
    subtitle: 'Analyst view: KPIs, trend charts, risk diagnostics, operations mix, and actionable next moves.',
    mode: 'dashboard',
    preferredColumns: 2,
    minColumnWidth: 46,
  },
  {
    id: 'overview_deep',
    title: 'Overview + Deep',
    subtitle: 'Core world, underrealm combat gates/readiness counters, population + social climate, pressure, lore, and deep signals.',
    sections: ['world', 'underrealm', 'population', 'social', 'lore', 'pressure', 'deepSignals'],
    preferredColumns: 2,
    minColumnWidth: 38,
  },
  {
    id: 'economy',
    title: 'Economy',
    subtitle: 'Production chain health, governor signals (trade/contracts/ruins/underrealm/camps/social/warriors), explainability drivers, diplomacy flow, and endgame checklist.',
    sections: ['stockpile', 'structures', 'operations', 'explainability', 'diplomacy', 'endgame'],
    preferredColumns: 2,
    minColumnWidth: 38,
  },
  {
    id: 'warrior_league',
    title: 'Warrior League',
    subtitle: 'Competitive lens: epic league naming, company identity/carry-over hooks, champion lineage, top 5 fighters, marks progression, and clan standings.',
    sections: ['warriorLeague', 'underrealm', 'deepSignals'],
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

// Resolve dashboard history sampling settings for trend rows.
function resolveTelemetryDashboardConfig(config) {
  const uiConfig = config
    && config.display
    && config.display.telemetry_panel
    && typeof config.display.telemetry_panel === 'object'
    ? config.display.telemetry_panel
    : {};
  const dashboardConfig = uiConfig.dashboard && typeof uiConfig.dashboard === 'object'
    ? uiConfig.dashboard
    : {};
  const historyPointsRaw = Number(dashboardConfig.history_points);
  const snapshotIntervalRaw = Number(dashboardConfig.snapshot_interval_ticks);
  const historyPoints = clamp(
    Math.floor(
      Number.isFinite(historyPointsRaw)
        ? historyPointsRaw
        : DEFAULT_DASHBOARD_HISTORY.history_points,
    ),
    8,
    240,
  );
  const snapshotIntervalTicks = Math.max(
    1,
    Math.floor(
      Number.isFinite(snapshotIntervalRaw)
        ? snapshotIntervalRaw
        : DEFAULT_DASHBOARD_HISTORY.snapshot_interval_ticks,
    ),
  );
  return {
    historyPoints,
    snapshotIntervalTicks,
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
  const controlsLine = '[<-]/[->] Page  [h] Close telemetry  [i] Dwarf info  [w] Warrior league  [l] Legend';
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

  const telemetryLines = buildTelemetryPageLines(state, config, width, page, {
    alertState,
    alertConfig,
  });
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
function buildTelemetryPageLines(state, config, width, page, context = {}) {
  if (page && page.mode === 'dashboard') {
    return buildDashboardPageLines(state, config, width, context);
  }
  return buildSectionPageLines(state, config, width, page, context);
}

// Build telemetry rows for the analyst dashboard page.
function buildDashboardPageLines(state, config, width, context = {}) {
  const safeWidth = Math.max(1, Math.floor(Number(width || 1)));
  const alertState = context.alertState
    || resolveTelemetryAlertState(state, config, context.alertConfig);
  const alertConfig = resolveTelemetryAlertConfig(context.alertConfig);
  const dashboardConfig = resolveTelemetryDashboardConfig(config);
  const snapshot = collectDashboardSnapshot(state, config, alertState, alertConfig);
  const history = updateDashboardHistory(state, snapshot, dashboardConfig);

  const gap = 3;
  let columnCount = safeWidth >= 110 ? 2 : 1;
  const minColumnWidth = 42;
  let columnWidth = getTelemetryColumnWidth(safeWidth, columnCount, gap);
  while (columnCount > 1 && columnWidth < minColumnWidth) {
    columnCount -= 1;
    columnWidth = getTelemetryColumnWidth(safeWidth, columnCount, gap);
  }
  if (columnCount <= 1) {
    columnWidth = safeWidth;
  }

  const blocks = [
    buildSectionBlockLines(
      { label: 'KPI Snapshot', rows: buildDashboardKpiRows(snapshot) },
      'kpi snapshot',
      columnWidth,
    ),
    buildSectionBlockLines(
      {
        label: 'Trend Charts',
        rows: buildDashboardTrendRows(snapshot, history, columnWidth, dashboardConfig),
      },
      'trend charts',
      columnWidth,
    ),
    buildSectionBlockLines(
      {
        label: 'Forecast & Bottlenecks',
        rows: buildDashboardForecastRows(snapshot, history, dashboardConfig, alertConfig),
      },
      'forecast & bottlenecks',
      columnWidth,
    ),
    buildSectionBlockLines(
      { label: 'Risk Breakdown', rows: buildDashboardRiskRows(snapshot, alertConfig) },
      'risk breakdown',
      columnWidth,
    ),
    buildSectionBlockLines(
      { label: 'Operations Mix', rows: buildDashboardOperationsRows(snapshot, columnWidth) },
      'operations mix',
      columnWidth,
    ),
    buildSectionBlockLines(
      { label: 'Event Timeline', rows: buildDashboardTimelineRows(snapshot) },
      'event timeline',
      columnWidth,
    ),
    buildSectionBlockLines(
      { label: 'Actionable Insights', rows: buildDashboardActionRows(snapshot, alertConfig) },
      'actionable insights',
      columnWidth,
    ),
  ];
  const usableBlocks = blocks.filter((block) => Array.isArray(block) && block.length > 0);
  if (usableBlocks.length === 0) {
    return ['No dashboard data available.'];
  }
  const mergedColumns = mergeBlocksIntoColumns(usableBlocks, columnCount);
  return formatMergedColumns(mergedColumns, safeWidth, columnCount, gap);
}

// Collect normalized dashboard snapshot values used by KPI/charts/insights blocks.
function collectDashboardSnapshot(state, config, alertState, alertConfig) {
  const safeState = state && typeof state === 'object' ? state : {};
  const safeConfig = config && typeof config === 'object' ? config : {};
  const dwarves = Array.isArray(safeState.dwarves) ? safeState.dwarves : [];
  const jobs = Array.isArray(safeState.jobs) ? safeState.jobs : [];
  const resourceLabels = (safeConfig.resources && safeConfig.resources.labels) || {};
  const lifeStages = countLifeStagesLocal(dwarves);
  const moraleRatio = averageDwarfMetric(dwarves, (dwarf) => dwarf && dwarf.state && dwarf.state.morale);
  const stressRatio = averageDwarfMetric(dwarves, (dwarf) => dwarf && dwarf.state && dwarf.state.stress);
  const food = resolveResourceTargetSnapshot(safeState, safeConfig, 'food', resourceLabels);
  const water = resolveResourceTargetSnapshot(safeState, safeConfig, 'water', resourceLabels);
  const beer = resolveResourceTargetSnapshot(safeState, safeConfig, 'beer', resourceLabels);
  const stockMinRatio = Math.min(food.ratio, water.ratio, beer.ratio);
  const shortages = collectShortageSnapshots(safeState, safeConfig, resourceLabels);
  const workforce = collectWorkforceSnapshot(dwarves);
  const jobMix = collectJobMixSnapshot(jobs);
  const underrealm = safeState.underrealm && typeof safeState.underrealm === 'object'
    ? safeState.underrealm
    : null;
  const maxDepth = Math.max(0, Number(underrealm && underrealm.maxDepth || 0));
  const maxUnlockedDepth = clamp(
    Math.floor(Number(underrealm && underrealm.maxUnlockedDepth || 0)),
    0,
    maxDepth,
  );
  const activeDepth = clamp(
    Math.floor(Number(underrealm && underrealm.activeDepth || 0)),
    0,
    maxUnlockedDepth,
  );
  const deepRaidCount = countActiveDeepRaids(safeState);
  const festivalStatus = getFestivalStatus(safeState, safeConfig);
  const alchemyStatus = getAlchemyStatus(safeState, safeConfig);
  const worldEventStatus = getWorldEventStatus(safeState, safeConfig);
  const externalCampStatus = getExternalCampStatus(safeState, safeConfig);
  const schismStatus = getSchismStatus(safeState, safeConfig);
  const worldEventsState = safeState.worldEvents && typeof safeState.worldEvents === 'object'
    ? safeState.worldEvents
    : null;
  const socialState = safeState.social && typeof safeState.social === 'object'
    ? safeState.social
    : null;
  const social = {
    enabled: Boolean(
      socialState
      && socialState.enabled === true
      && safeConfig.population
      && safeConfig.population.socialDrama
      && safeConfig.population.socialDrama.enabled !== false,
    ),
    cohesion: clampUnit(socialState && socialState.cohesion, 0),
    conflictPressure: clampUnit(socialState && socialState.conflictPressure, 0),
    mentorshipCoverage: clampUnit(socialState && socialState.mentorshipCoverage, 0),
    grudgeLoad: clampUnit(socialState && socialState.grudgeLoad, 0),
    incidents: Math.max(
      0,
      Number(
        socialState
        && socialState.stats
        && socialState.stats.incidents
        || 0,
      ),
    ),
    lastIncidentTick: Math.max(0, Number(socialState && socialState.lastIncidentTick || 0)),
  };
  const contract = resolveContractStatus(safeState);
  const risk = computeDashboardRiskScore(alertState, alertConfig);

  return {
    state: safeState,
    config: safeConfig,
    tick: Math.max(0, Math.floor(Number(safeState.tick || 0))),
    cycleCount: Math.max(0, Number(safeState.cycleStats && safeState.cycleStats.count || 0)),
    population: dwarves.length,
    lifeStages,
    moraleRatio: clampUnit(moraleRatio, 0),
    stressRatio: clampUnit(stressRatio, 0),
    food,
    water,
    beer,
    stockMinRatio: clampUnit(stockMinRatio, 0),
    alertState,
    alertLevel: alertState && alertState.level ? String(alertState.level) : 'stable',
    alertCause: resolveTelemetryAlertCause(alertState || {}),
    shortages,
    workforce,
    jobMix,
    underrealm: {
      enabled: Boolean(underrealm && underrealm.enabled !== false),
      maxDepth,
      maxUnlockedDepth,
      activeDepth,
      deepRaidCount,
    },
    festivalStatus,
    alchemyStatus,
    worldEventStatus,
    externalCampStatus,
    schismStatus,
    social,
    worldEventsState,
    contract,
    risk,
  };
}

// Build KPI summary rows for dashboard top-left panel.
function buildDashboardKpiRows(snapshot) {
  const underrealmText = snapshot.underrealm.enabled
    ? `D${snapshot.underrealm.activeDepth}/${snapshot.underrealm.maxUnlockedDepth}/${snapshot.underrealm.maxDepth}`
    : 'off';
  return [
    `Tick ${snapshot.tick} | Cycle ${snapshot.cycleCount} | Pop ${snapshot.population} (A${snapshot.lifeStages.adult}/C${snapshot.lifeStages.child}/E${snapshot.lifeStages.elder})`,
    `Morale ${formatRatioPct(snapshot.moraleRatio)} | Stress ${formatRatioPct(snapshot.stressRatio)} | Stock floor ${formatRatioPct(snapshot.stockMinRatio)}`,
    `Risk ${snapshot.alertLevel.toUpperCase()} (${snapshot.alertCause}) | Score ${formatRatioPct(snapshot.risk.score)}`,
    `Underrealm ${underrealmText} | Deep raids ${snapshot.underrealm.deepRaidCount}`,
    `Schism ${buildContextSchismSummary(snapshot)}`,
    `${snapshot.food.label} ${formatRatioPct(snapshot.food.ratio)} | ${snapshot.water.label} ${formatRatioPct(snapshot.water.ratio)} | ${snapshot.beer.label} ${formatRatioPct(snapshot.beer.ratio)}`,
  ];
}

// Build ASCII trend-chart rows from rolling dashboard history.
function buildDashboardTrendRows(snapshot, history, columnWidth, dashboardConfig) {
  const sparkWidth = Math.max(12, Math.min(28, Math.floor(Number(columnWidth || 1) - 44)));
  const sampling = dashboardConfig && typeof dashboardConfig === 'object'
    ? dashboardConfig
    : {
      historyPoints: DEFAULT_DASHBOARD_HISTORY.history_points,
      snapshotIntervalTicks: DEFAULT_DASHBOARD_HISTORY.snapshot_interval_ticks,
    };
  const windowTicks = Math.max(1, sampling.historyPoints * sampling.snapshotIntervalTicks);
  const deltaWindowTicks = Math.max(
    sampling.snapshotIntervalTicks,
    Math.floor(windowTicks * 0.2),
  );
  const foodSeries = smoothSeries(getHistorySeries(history, 'foodRatio'));
  const waterSeries = smoothSeries(getHistorySeries(history, 'waterRatio'));
  const beerSeries = smoothSeries(getHistorySeries(history, 'beerRatio'));
  const moraleSeries = smoothSeries(getHistorySeries(history, 'moraleRatio'));
  const populationSeries = smoothSeries(getHistorySeries(history, 'population'));
  const riskSeries = smoothSeries(getHistorySeries(history, 'riskScore'));
  const rows = [
    `Sampling: 1pt/${sampling.snapshotIntervalTicks}t | Window ${formatCompactNumber(windowTicks)}t | Delta ${formatCompactNumber(deltaWindowTicks)}t | Samples ${history.length}/${sampling.historyPoints}`,
  ];
  rows.push(buildDashboardTrendRow(
    `${snapshot.food.label} target%`,
    foodSeries,
    formatRatioPct(snapshot.food.ratio),
    formatSignedPoints(getHistoryDeltaByTicks(history, 'foodRatio', deltaWindowTicks) * 100),
    sparkWidth,
    { min: 0, max: 1.4 },
  ));
  rows.push(buildDashboardTrendRow(
    `${snapshot.water.label} target%`,
    waterSeries,
    formatRatioPct(snapshot.water.ratio),
    formatSignedPoints(getHistoryDeltaByTicks(history, 'waterRatio', deltaWindowTicks) * 100),
    sparkWidth,
    { min: 0, max: 1.4 },
  ));
  rows.push(buildDashboardTrendRow(
    `${snapshot.beer.label} target%`,
    beerSeries,
    formatRatioPct(snapshot.beer.ratio),
    formatSignedPoints(getHistoryDeltaByTicks(history, 'beerRatio', deltaWindowTicks) * 100),
    sparkWidth,
    { min: 0, max: 1.4 },
  ));
  rows.push(buildDashboardTrendRow(
    'Morale',
    moraleSeries,
    formatRatioPct(snapshot.moraleRatio),
    formatSignedPoints(getHistoryDeltaByTicks(history, 'moraleRatio', deltaWindowTicks) * 100),
    sparkWidth,
    { min: 0, max: 1 },
  ));
  rows.push(buildDashboardTrendRow(
    'Population',
    populationSeries,
    formatCompactNumber(snapshot.population),
    formatSignedInteger(getHistoryDeltaByTicks(history, 'population', deltaWindowTicks)),
    sparkWidth,
  ));
  rows.push(buildDashboardTrendRow(
    'Risk score',
    riskSeries,
    formatRatioPct(snapshot.risk.score),
    formatSignedPoints(getHistoryDeltaByTicks(history, 'riskScore', deltaWindowTicks) * 100),
    sparkWidth,
    { min: 0, max: 1 },
  ));
  return rows;
}

// Build one trend line with sparkline + current value + delta.
function buildDashboardTrendRow(label, series, valueLabel, deltaLabel, sparkWidth, bounds) {
  const spark = buildAsciiSparkline(series, sparkWidth, bounds);
  return `${padRight(label, 16)} [${spark}] ${valueLabel} (${deltaLabel})`;
}

// Build forward-looking dashboard rows (runway, flow, volatility, bottlenecks).
function buildDashboardForecastRows(snapshot, history, dashboardConfig, alertConfig) {
  const sampling = dashboardConfig && typeof dashboardConfig === 'object'
    ? dashboardConfig
    : {
      historyPoints: DEFAULT_DASHBOARD_HISTORY.history_points,
      snapshotIntervalTicks: DEFAULT_DASHBOARD_HISTORY.snapshot_interval_ticks,
    };
  const analysisWindowTicks = resolveContextDeltaWindowTicks(sampling);
  const shortWindowTicks = Math.max(
    sampling.snapshotIntervalTicks,
    Math.floor(analysisWindowTicks * 0.5),
  );
  const foodTrend = getHistoryTrendByTicks(history, 'foodRatio', analysisWindowTicks);
  const waterTrend = getHistoryTrendByTicks(history, 'waterRatio', analysisWindowTicks);
  const beerTrend = getHistoryTrendByTicks(history, 'beerRatio', analysisWindowTicks);
  const riskLongTrend = getHistoryTrendByTicks(history, 'riskScore', analysisWindowTicks);
  const riskShortTrend = getHistoryTrendByTicks(history, 'riskScore', shortWindowTicks);
  const foodFlow = getHistoryTrendByTicks(history, 'foodCurrent', analysisWindowTicks);
  const waterFlow = getHistoryTrendByTicks(history, 'waterCurrent', analysisWindowTicks);
  const beerFlow = getHistoryTrendByTicks(history, 'beerCurrent', analysisWindowTicks);

  const warnThreshold = clampUnit(alertConfig && alertConfig.stockpile_warning_ratio, 0.5);
  const criticalThreshold = clampUnit(alertConfig && alertConfig.stockpile_critical_ratio, 0.25);
  const foodWarnRunway = computeRunwayTicks(snapshot.food.ratio, foodTrend.slopePerTick, warnThreshold);
  const waterWarnRunway = computeRunwayTicks(snapshot.water.ratio, waterTrend.slopePerTick, warnThreshold);
  const beerWarnRunway = computeRunwayTicks(snapshot.beer.ratio, beerTrend.slopePerTick, warnThreshold);
  const foodCriticalRunway = computeRunwayTicks(snapshot.food.ratio, foodTrend.slopePerTick, criticalThreshold);
  const waterCriticalRunway = computeRunwayTicks(snapshot.water.ratio, waterTrend.slopePerTick, criticalThreshold);
  const beerCriticalRunway = computeRunwayTicks(snapshot.beer.ratio, beerTrend.slopePerTick, criticalThreshold);

  const stockVolatilityPp = averageValues([
    computeSeriesVolatility(history, 'foodRatio', 8),
    computeSeriesVolatility(history, 'waterRatio', 8),
    computeSeriesVolatility(history, 'beerRatio', 8),
  ]) * 100;
  const riskVolatilityPp = computeSeriesVolatility(history, 'riskScore', 8) * 100;
  const riskMomentumLabel = formatSignedPoints(riskLongTrend.delta * 100);
  const riskShortLabel = formatSignedPoints(riskShortTrend.delta * 100);
  const riskRateDiffPer100Ticks = (riskShortTrend.slopePerTick - riskLongTrend.slopePerTick) * 10000;
  const riskAcceleration = formatSignedRatePer100Ticks(riskRateDiffPer100Ticks, 'pp');
  const bottleneckLine = buildDashboardBottleneckLine(snapshot, history, analysisWindowTicks);
  const adultTotal = Math.max(1, Number(snapshot.lifeStages.adult || 0));
  const utilizedAdults = snapshot.workforce.job + snapshot.workforce.under + snapshot.workforce.exped;
  const utilization = clampUnit(utilizedAdults / adultTotal, 0);
  const gatherShare = snapshot.jobMix.total > 0
    ? snapshot.jobMix.gather / snapshot.jobMix.total
    : 0;

  return [
    `Window: ${formatCompactNumber(analysisWindowTicks)}t | Samples ${history.length}/${sampling.historyPoints}`,
    `Runway warn: ${snapshot.food.label} ${formatRunwayTicks(foodWarnRunway)} | ${snapshot.water.label} ${formatRunwayTicks(waterWarnRunway)} | ${snapshot.beer.label} ${formatRunwayTicks(beerWarnRunway)}`,
    `Runway crit: ${snapshot.food.label} ${formatRunwayTicks(foodCriticalRunway)} | ${snapshot.water.label} ${formatRunwayTicks(waterCriticalRunway)} | ${snapshot.beer.label} ${formatRunwayTicks(beerCriticalRunway)}`,
    `Net flow /100t: ${snapshot.food.label} ${formatSignedRatePer100Ticks(foodFlow.slopePerTick * 100)} | ${snapshot.water.label} ${formatSignedRatePer100Ticks(waterFlow.slopePerTick * 100)} | ${snapshot.beer.label} ${formatSignedRatePer100Ticks(beerFlow.slopePerTick * 100)}`,
    `Risk momentum: ${riskMomentumLabel}/${formatCompactNumber(analysisWindowTicks)}t | short ${riskShortLabel}/${formatCompactNumber(shortWindowTicks)}t | accel ${riskAcceleration}/100t`,
    `Volatility: stock ${formatVolatilityLevel(stockVolatilityPp)} (${stockVolatilityPp.toFixed(1)}pp) | risk ${formatVolatilityLevel(riskVolatilityPp)} (${riskVolatilityPp.toFixed(1)}pp)`,
    `${bottleneckLine} | Util ${formatRatioPct(utilization)} | Gather share ${formatRatioPct(gatherShare)}`,
  ];
}

// Build one compact bottleneck line from shortage urgency + trend direction.
function buildDashboardBottleneckLine(snapshot, history, lookbackTicks) {
  const shortage = snapshot && Array.isArray(snapshot.shortages) ? snapshot.shortages[0] : null;
  const weakest = [snapshot.food, snapshot.water, snapshot.beer]
    .slice()
    .sort((left, right) => left.ratio - right.ratio)[0];
  if (!shortage) {
    return `Bottleneck: none | watch ${weakest.label} ${formatRatioPct(weakest.ratio)}`;
  }
  const ratioKey = getResourceRatioHistoryKey(shortage.resourceId);
  const currentKey = getResourceCurrentHistoryKey(shortage.resourceId);
  const ratioTrend = ratioKey
    ? getHistoryTrendByTicks(history, ratioKey, lookbackTicks)
    : { delta: 0, slopePerTick: 0 };
  const flowTrend = currentKey
    ? getHistoryTrendByTicks(history, currentKey, lookbackTicks)
    : { delta: 0, slopePerTick: 0 };
  return `Bottleneck: ${shortage.label} ${formatRatioPct(shortage.ratio)} (u${shortage.urgency.toFixed(2)}) | trend ${formatSignedPoints(ratioTrend.delta * 100)} | flow ${formatSignedRatePer100Ticks(flowTrend.slopePerTick * 100)}`;
}

// Build risk-diagnostic rows with gauge, pressure mix, and shortage focus.
function buildDashboardRiskRows(snapshot, alertConfig) {
  const gaugeWidth = 26;
  const gauge = buildRatioBar(snapshot.risk.score, gaugeWidth, '#', '-');
  const rows = [
    `Risk gauge: [${gauge}] ${formatRatioPct(snapshot.risk.score)} (${snapshot.alertLevel.toUpperCase()})`,
    `Pressure mix: stock ${formatRatioPct(snapshot.risk.stockPressure)} | morale ${formatRatioPct(snapshot.risk.moralePressure)} | shortage ${formatRatioPct(snapshot.risk.shortagePressure)} | raid ${formatRatioPct(snapshot.risk.raidPressure)}`,
    `Hazards: surface raid ${snapshot.alertState.raidActive ? 'ACTIVE' : 'off'} | deep raid ${snapshot.alertState.deepRaidActive ? 'ACTIVE' : 'off'}`,
    `Thresholds: stock warn<=${Math.round(alertConfig.stockpile_warning_ratio * 100)}% crit<=${Math.round(alertConfig.stockpile_critical_ratio * 100)}% | morale warn<=${Math.round(alertConfig.morale_warning * 100)}% crit<=${Math.round(alertConfig.morale_critical * 100)}%`,
  ];
  if (snapshot.shortages[0]) {
    rows.push(formatDashboardShortageLine('Primary shortage', snapshot.shortages[0]));
  } else {
    rows.push('Primary shortage: none');
  }
  if (snapshot.shortages[1]) {
    rows.push(formatDashboardShortageLine('Secondary shortage', snapshot.shortages[1]));
  } else {
    rows.push('Secondary shortage: none');
  }
  return rows;
}

// Build operations rows with stacked bars for workforce and job distribution.
function buildDashboardOperationsRows(snapshot, columnWidth) {
  const barWidth = Math.max(18, Math.min(30, Math.floor(Number(columnWidth || 1) - 34)));
  const workforceSegments = [
    { value: snapshot.workforce.idle, token: 'I' },
    { value: snapshot.workforce.job, token: 'J' },
    { value: snapshot.workforce.under, token: 'U' },
    { value: snapshot.workforce.exped, token: 'E' },
  ];
  const workforceBar = buildStackedBar(workforceSegments, barWidth);
  const jobsSegments = [
    { value: snapshot.jobMix.gather, token: 'G' },
    { value: snapshot.jobMix.craft, token: 'C' },
    { value: snapshot.jobMix.build, token: 'B' },
    { value: snapshot.jobMix.mine, token: 'M' },
    { value: snapshot.jobMix.other, token: 'O' },
  ];
  const jobsBar = buildStackedBar(jobsSegments, barWidth);
  const adultTotal = Math.max(1, Number(snapshot.lifeStages.adult || 0));
  const utilizedAdults = snapshot.workforce.job + snapshot.workforce.under + snapshot.workforce.exped;
  const utilization = clampUnit(utilizedAdults / adultTotal, 0);
  return [
    `Workforce split: [${workforceBar}] I${snapshot.workforce.idle} J${snapshot.workforce.job} U${snapshot.workforce.under} E${snapshot.workforce.exped}`,
    'Workforce legend: I idle | J assigned | U underrealm | E expeditions',
    `Job mix: [${jobsBar}] G${snapshot.jobMix.gather} C${snapshot.jobMix.craft} B${snapshot.jobMix.build} M${snapshot.jobMix.mine} O${snapshot.jobMix.other}`,
    'Job legend: G gather | C craft | B build | M mine | O other',
    `Adult utilization: ${formatRatioPct(utilization)} | Active jobs: ${snapshot.jobMix.total} | Shortage score: ${snapshot.alertState.shortageScore.toFixed(2)}`,
  ];
}

// Build timeline rows for event and contract windows.
function buildDashboardTimelineRows(snapshot) {
  const rows = [];
  if (snapshot.worldEventStatus && snapshot.worldEventStatus.active === true) {
    const label = String(snapshot.worldEventStatus.label || 'Event');
    const ticks = Math.max(0, Number(snapshot.worldEventStatus.ticksLeft || 0));
    rows.push(`World event: ${label} active (${ticks}t left)`);
  } else {
    const nextSpawnTick = Math.max(
      0,
      Number(snapshot.worldEventsState && snapshot.worldEventsState.nextSpawnTick || 0),
    );
    const eta = Math.max(0, nextSpawnTick - snapshot.tick);
    rows.push(nextSpawnTick > 0
      ? `World event: none | next spawn in ${eta}t`
      : 'World event: none');
  }

  if (snapshot.contract.active) {
    rows.push(`Contract: ${snapshot.contract.label} (${snapshot.contract.ticksLeft}t left)`);
  } else {
    rows.push('Contract: none active');
  }

  if (snapshot.externalCampStatus) {
    const status = snapshot.externalCampStatus;
    const byRole = status.byRole || {};
    const activeCount = Math.max(
      0,
      Number(byRole.trade || 0) + Number(byRole.militia || 0) + Number(byRole.raider || 0),
    );
    if (activeCount > 0) {
      rows.push(
        `External camps: T${Math.max(0, Number(byRole.trade || 0))} M${Math.max(0, Number(byRole.militia || 0))} R${Math.max(0, Number(byRole.raider || 0))}`,
      );
    } else {
      rows.push(`External camps: none | next spawn ${Math.max(0, Number(status.nextSpawnIn || 0))}t`);
    }
    const caravans = status.caravans || {};
    const activeCaravans = Math.max(0, Number(caravans.active || 0));
    if (activeCaravans > 0) {
      rows.push(`Caravans: ${activeCaravans} active | inbound ${Math.max(0, Number(caravans.toVillage || 0))}`);
    }
  }

  if (snapshot.festivalStatus && snapshot.festivalStatus.active === true) {
    const label = String(snapshot.festivalStatus.label || 'Festival');
    const left = Math.max(0, Number(snapshot.festivalStatus.ticksLeft || 0));
    const duration = Math.max(0, Number(snapshot.festivalStatus.duration || 0));
    rows.push(duration > 0
      ? `Festival: ${label} (${left}/${duration}t)`
      : `Festival: ${label} (${left}t)`);
  } else {
    rows.push('Festival: off');
  }

  rows.push(`Schism: ${buildContextSchismSummary(snapshot)}`);

  if (snapshot.alchemyStatus && snapshot.alchemyStatus.mode === 'active') {
    const label = String(snapshot.alchemyStatus.label || 'Rite');
    rows.push(`Alchemy: ${label} active (${snapshot.alchemyStatus.ticksLeft}t left)`);
  } else if (snapshot.alchemyStatus && snapshot.alchemyStatus.mode === 'backlash') {
    rows.push(`Alchemy: backlash (${snapshot.alchemyStatus.ticksLeft}t left)`);
  } else if (snapshot.alchemyStatus && snapshot.alchemyStatus.mode === 'cooldown') {
    rows.push(`Alchemy: cooldown (${snapshot.alchemyStatus.ticksLeft}t left)`);
  } else {
    rows.push('Alchemy: idle');
  }

  rows.push(`Raids: surface ${snapshot.alertState.raidActive ? 'ACTIVE' : 'off'} | deep ${snapshot.alertState.deepRaidActive ? 'ACTIVE' : 'off'}`);
  return rows;
}

// Build deterministic analyst-style action hints from current risk drivers.
function buildDashboardActionRows(snapshot, alertConfig) {
  const rows = [];
  if (snapshot.alertLevel === 'critical') {
    rows.push('Immediate focus: stabilize essentials before expansion or optional projects.');
  } else if (snapshot.alertLevel === 'warning') {
    rows.push('Near-term focus: reduce pressure before it compounds into a critical state.');
  }

  const weakest = [snapshot.food, snapshot.water, snapshot.beer]
    .slice()
    .sort((left, right) => left.ratio - right.ratio)[0];
  if (weakest && weakest.ratio <= alertConfig.stockpile_warning_ratio) {
    rows.push(`Stock recovery: prioritize ${weakest.label.toLowerCase()} gather until above ${Math.round(alertConfig.stockpile_warning_ratio * 100)}% target.`);
  }
  if (snapshot.moraleRatio <= alertConfig.morale_warning) {
    rows.push('Morale recovery: keep beer/festival uptime and avoid starvation or thirst spikes.');
  }
  if (snapshot.alertState.raidActive || snapshot.alertState.deepRaidActive) {
    rows.push('Defense posture: redirect workforce to protection/support until raid pressure clears.');
  }
  if (snapshot.shortages[0] && snapshot.shortages[0].urgency >= alertConfig.shortage_warning_score) {
    rows.push(`Top shortage driver: ${snapshot.shortages[0].label} urgency ${snapshot.shortages[0].urgency.toFixed(2)}.`);
  }
  if (rows.length < 4) {
    rows.push('Optimization window: convert surplus into upgrades, contracts, and underrealm progression.');
  }
  if (rows.length < 5) {
    rows.push(`Watchline: risk ${formatRatioPct(snapshot.risk.score)} | stock floor ${formatRatioPct(snapshot.stockMinRatio)} | shortage ${snapshot.alertState.shortageScore.toFixed(2)}.`);
  }
  return rows.slice(0, 5);
}

// Resolve normalized stock snapshot for one tracked resource.
function resolveResourceTargetSnapshot(state, config, resourceId, resourceLabels) {
  const target = Math.max(0, Number(getStockpileTarget(state, config, resourceId) || 0));
  const current = Math.max(0, Number(state && state.stockpile ? state.stockpile[resourceId] : 0));
  const ratio = target > 0 ? current / target : 1;
  return {
    id: String(resourceId || ''),
    label: resolveResourceLabel(resourceId, resourceLabels),
    current,
    target,
    ratio: Math.max(0, ratio),
  };
}

// Resolve top shortage snapshots with urgency and target ratio context.
function collectShortageSnapshots(state, config, resourceLabels) {
  const shortages = Array.isArray(state && state.lastPriorities) ? state.lastPriorities : [];
  const out = [];
  for (const entry of shortages.slice(0, 2)) {
    const resourceId = String(entry && entry.resource || '').trim();
    if (!resourceId) {
      continue;
    }
    const snapshot = resolveResourceTargetSnapshot(state, config, resourceId, resourceLabels);
    out.push({
      resourceId,
      label: snapshot.label,
      ratio: snapshot.ratio,
      current: snapshot.current,
      target: snapshot.target,
      urgency: Math.max(0, Number(entry && entry.score || 0)),
    });
  }
  return out;
}

// Format one shortage diagnostic line for dashboard risk block.
function formatDashboardShortageLine(prefix, shortage) {
  return `${prefix}: ${shortage.label} ${formatRatioPct(shortage.ratio)} target (urgency ${shortage.urgency.toFixed(2)})`;
}

// Resolve compact contract status for timeline display.
function resolveContractStatus(state) {
  const contracts = state && state.contracts && typeof state.contracts === 'object'
    ? state.contracts
    : null;
  if (!contracts || !contracts.active) {
    return { active: false, label: '-', ticksLeft: 0 };
  }
  const active = contracts.active;
  const tick = Math.max(0, Number(state && state.tick || 0));
  const expiresAt = Math.max(0, Number(active.expiresAt || 0));
  const ticksLeft = Math.max(0, Math.round(expiresAt - tick));
  return {
    active: true,
    label: String(active.factionLabel || active.factionId || 'Contract'),
    ticksLeft,
  };
}

// Compute risk score and component pressures used by gauge and breakdown rows.
function computeDashboardRiskScore(alertState, alertConfig) {
  const safeState = alertState && typeof alertState === 'object' ? alertState : {};
  const shortageCritical = Math.max(0.01, Number(alertConfig.shortage_critical_score || 1));
  const stockPressure = clampUnit(1 - Number(safeState.stockpileRatio || 0), 0);
  const moralePressure = clampUnit(1 - Number(safeState.moraleRatio || 0), 0);
  const shortagePressure = clampUnit(
    Math.max(0, Number(safeState.shortageScore || 0)) / shortageCritical,
    0,
  );
  const raidPressure = safeState.raidActive || safeState.deepRaidActive ? 1 : 0;
  let score = (stockPressure * 0.35)
    + (moralePressure * 0.25)
    + (shortagePressure * 0.25)
    + (raidPressure * 0.15);
  if (safeState.level === 'critical') {
    score = Math.max(score, 0.75);
  } else if (safeState.level === 'warning') {
    score = Math.max(score, 0.45);
  }
  return {
    score: clampUnit(score, 0),
    stockPressure,
    moralePressure,
    shortagePressure,
    raidPressure,
  };
}

// Persist compact dashboard history in renderState for trend sparklines.
function updateDashboardHistory(state, snapshot, options) {
  if (!state || typeof state !== 'object') {
    return [];
  }
  if (!state.renderState || typeof state.renderState !== 'object') {
    state.renderState = {};
  }
  if (!Array.isArray(state.renderState.telemetryDashboardHistory)) {
    state.renderState.telemetryDashboardHistory = [];
  }
  if (!state.renderState.telemetryDashboardHistoryMeta || typeof state.renderState.telemetryDashboardHistoryMeta !== 'object') {
    state.renderState.telemetryDashboardHistoryMeta = {};
  }
  const history = state.renderState.telemetryDashboardHistory;
  const config = options && typeof options === 'object'
    ? options
    : { historyPoints: options };
  const keep = Math.max(
    8,
    Math.floor(
      Number.isFinite(Number(config.historyPoints))
        ? Number(config.historyPoints)
        : DEFAULT_DASHBOARD_HISTORY.history_points,
    ),
  );
  const snapshotIntervalTicks = Math.max(
    1,
    Math.floor(
      Number.isFinite(Number(config.snapshotIntervalTicks))
        ? Number(config.snapshotIntervalTicks)
        : DEFAULT_DASHBOARD_HISTORY.snapshot_interval_ticks,
    ),
  );
  const historyMeta = state.renderState.telemetryDashboardHistoryMeta;
  if (Number(historyMeta.snapshotIntervalTicks || 0) !== snapshotIntervalTicks) {
    history.length = 0;
  }
  historyMeta.snapshotIntervalTicks = snapshotIntervalTicks;
  historyMeta.historyPoints = keep;

  const entry = {
    tick: snapshot.tick,
    foodRatio: snapshot.food.ratio,
    waterRatio: snapshot.water.ratio,
    beerRatio: snapshot.beer.ratio,
    foodCurrent: snapshot.food.current,
    waterCurrent: snapshot.water.current,
    beerCurrent: snapshot.beer.current,
    moraleRatio: snapshot.moraleRatio,
    population: snapshot.population,
    riskScore: snapshot.risk.score,
  };
  const last = history[history.length - 1];
  if (last && Number(last.tick || 0) === snapshot.tick) {
    history[history.length - 1] = entry;
  } else if (!last) {
    history.push(entry);
  } else if (snapshot.tick < Number(last.tick || 0)) {
    history.length = 0;
    history.push(entry);
  } else if (snapshot.tick - Number(last.tick || 0) >= snapshotIntervalTicks) {
    history.push(entry);
  }
  while (history.length > keep) {
    history.shift();
  }
  return history;
}

// Resolve one numeric history series by key.
function getHistorySeries(history, key) {
  if (!Array.isArray(history) || history.length === 0) {
    return [];
  }
  return history.map((entry) => Number(entry && entry[key] || 0));
}

// Resolve trend delta and slope for one metric over a tick lookback window.
function getHistoryTrendByTicks(history, key, lookbackTicks = 600) {
  if (!Array.isArray(history) || history.length < 2) {
    return { delta: 0, ticks: 0, slopePerTick: 0 };
  }
  const safeLookbackTicks = Math.max(1, Math.floor(Number(lookbackTicks || 1)));
  const latest = history[history.length - 1];
  const latestTick = Math.max(0, Number(latest && latest.tick || 0));
  const latestValue = Number(latest && latest[key] || 0);
  const targetTick = Math.max(0, latestTick - safeLookbackTicks);
  let baseline = history[0];
  for (let i = history.length - 2; i >= 0; i -= 1) {
    const entry = history[i];
    const tick = Math.max(0, Number(entry && entry.tick || 0));
    baseline = entry;
    if (tick <= targetTick) {
      break;
    }
  }
  const baselineTick = Math.max(0, Number(baseline && baseline.tick || 0));
  const baselineValue = Number(baseline && baseline[key] || 0);
  const ticks = Math.max(0, latestTick - baselineTick);
  const delta = latestValue - baselineValue;
  const slopePerTick = ticks > 0 ? delta / ticks : 0;
  return { delta, ticks, slopePerTick };
}

// Resolve mean absolute change across recent history points (point-to-point volatility).
function computeSeriesVolatility(history, key, maxPoints = 8) {
  const series = getHistorySeries(history, key);
  const keep = Math.max(2, Math.floor(Number(maxPoints || 8)));
  const start = Math.max(0, series.length - keep);
  let absTotal = 0;
  let count = 0;
  for (let i = start + 1; i < series.length; i += 1) {
    absTotal += Math.abs(Number(series[i] || 0) - Number(series[i - 1] || 0));
    count += 1;
  }
  return count > 0 ? absTotal / count : 0;
}

// Resolve one delta using a fixed lookback measured in ticks.
function getHistoryDeltaByTicks(history, key, lookbackTicks = 600) {
  if (!Array.isArray(history) || history.length < 2) {
    return 0;
  }
  const safeLookbackTicks = Math.max(1, Math.floor(Number(lookbackTicks || 1)));
  const latest = history[history.length - 1];
  const latestTick = Math.max(0, Number(latest && latest.tick || 0));
  const latestValue = Number(latest && latest[key] || 0);
  const targetTick = Math.max(0, latestTick - safeLookbackTicks);
  let baseline = history[0];
  for (let i = history.length - 2; i >= 0; i -= 1) {
    const entry = history[i];
    const tick = Math.max(0, Number(entry && entry.tick || 0));
    baseline = entry;
    if (tick <= targetTick) {
      break;
    }
  }
  return latestValue - Number(baseline && baseline[key] || 0);
}

// Apply a lightweight moving average to reduce sparkline jitter.
function smoothSeries(values, radius = 1) {
  const list = Array.isArray(values)
    ? values.map((value) => Number(value || 0))
    : [];
  if (list.length <= 2) {
    return list;
  }
  const safeRadius = Math.max(0, Math.floor(Number(radius || 0)));
  if (safeRadius <= 0) {
    return list;
  }
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    let total = 0;
    let count = 0;
    for (let j = i - safeRadius; j <= i + safeRadius; j += 1) {
      const index = Math.max(0, Math.min(list.length - 1, j));
      total += list[index];
      count += 1;
    }
    out.push(count > 0 ? total / count : list[i]);
  }
  return out;
}

// Build one compact ASCII sparkline from a numeric series.
function buildAsciiSparkline(values, width, bounds) {
  const safeWidth = Math.max(1, Math.floor(Number(width || 1)));
  const sampled = sampleSeries(values, safeWidth);
  const scale = resolveSparklineScale(sampled, bounds);
  const chars = '._-:=+*#%@';
  return sampled.map((value) => {
    const ratio = clampUnit((Number(value || 0) - scale.min) / Math.max(1e-9, scale.max - scale.min), 0);
    const index = Math.max(0, Math.min(chars.length - 1, Math.round(ratio * (chars.length - 1))));
    return chars[index];
  }).join('');
}

// Resolve sparkline scale bounds from optional fixed bounds or sampled values.
function resolveSparklineScale(values, bounds) {
  const safeBounds = bounds && typeof bounds === 'object' ? bounds : null;
  const hasBounds = safeBounds
    && Number.isFinite(Number(safeBounds.min))
    && Number.isFinite(Number(safeBounds.max))
    && Number(safeBounds.max) > Number(safeBounds.min);
  if (hasBounds) {
    return { min: Number(safeBounds.min), max: Number(safeBounds.max) };
  }
  const list = Array.isArray(values) && values.length > 0 ? values : [0];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of list) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) {
      continue;
    }
    min = Math.min(min, numeric);
    max = Math.max(max, numeric);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1 };
  }
  if (max - min < 1e-6) {
    return { min: min - 0.5, max: max + 0.5 };
  }
  return { min, max };
}

// Resample one numeric series to fixed width using nearest-neighbor picks.
function sampleSeries(values, width) {
  const safeWidth = Math.max(1, Math.floor(Number(width || 1)));
  const list = Array.isArray(values)
    ? values.map((value) => Number(value || 0))
    : [];
  if (list.length === 0) {
    return Array.from({ length: safeWidth }, () => 0);
  }
  if (list.length === 1) {
    return Array.from({ length: safeWidth }, () => list[0]);
  }
  const sampled = [];
  for (let index = 0; index < safeWidth; index += 1) {
    const ratio = safeWidth <= 1 ? 1 : index / (safeWidth - 1);
    const source = Math.round(ratio * (list.length - 1));
    sampled.push(Number(list[source] || 0));
  }
  return sampled;
}

// Build a simple ratio bar from filled/empty ASCII characters.
function buildRatioBar(ratio, width, fillChar = '#', emptyChar = '-') {
  const safeWidth = Math.max(1, Math.floor(Number(width || 1)));
  const normalized = clampUnit(ratio, 0);
  const filled = Math.max(0, Math.min(safeWidth, Math.round(normalized * safeWidth)));
  const empty = Math.max(0, safeWidth - filled);
  return `${fillChar.repeat(filled)}${emptyChar.repeat(empty)}`;
}

// Build a deterministic stacked ASCII bar for distribution visualization.
function buildStackedBar(segments, width) {
  const safeWidth = Math.max(1, Math.floor(Number(width || 1)));
  const list = Array.isArray(segments) ? segments : [];
  const total = list.reduce(
    (sum, segment) => sum + Math.max(0, Number(segment && segment.value || 0)),
    0,
  );
  if (total <= 0) {
    return '.'.repeat(safeWidth);
  }
  const lengths = list.map(() => 0);
  let used = 0;
  for (let index = 0; index < list.length; index += 1) {
    const value = Math.max(0, Number(list[index] && list[index].value || 0));
    const length = Math.floor((value / total) * safeWidth);
    lengths[index] = length;
    used += length;
  }
  let remaining = safeWidth - used;
  while (remaining > 0) {
    let target = 0;
    let bestResidual = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < list.length; index += 1) {
      const value = Math.max(0, Number(list[index] && list[index].value || 0));
      const ideal = (value / total) * safeWidth;
      const residual = ideal - lengths[index];
      if (residual > bestResidual) {
        bestResidual = residual;
        target = index;
      }
    }
    lengths[target] += 1;
    remaining -= 1;
  }
  let bar = '';
  for (let index = 0; index < list.length; index += 1) {
    const token = String(list[index] && list[index].token || '#').charAt(0) || '#';
    bar += token.repeat(Math.max(0, lengths[index]));
  }
  return padRight(bar, safeWidth).slice(0, safeWidth);
}

// Count active deep raids across underrealm raid-depth map.
function countActiveDeepRaids(state) {
  const raids = state
    && state.underrealm
    && state.underrealm.deepFaction
    && state.underrealm.deepFaction.activeRaidsByDepth;
  if (!raids || typeof raids !== 'object') {
    return 0;
  }
  return Object.values(raids)
    .filter((entry) => entry && Number(entry.ticksRemaining || 0) > 0)
    .length;
}

// Count life stages from dwarf list.
function countLifeStagesLocal(dwarves) {
  const counts = { child: 0, adult: 0, elder: 0 };
  const list = Array.isArray(dwarves) ? dwarves : [];
  for (const dwarf of list) {
    const stage = String(dwarf && dwarf.lifeStage || 'adult');
    if (Object.prototype.hasOwnProperty.call(counts, stage)) {
      counts[stage] += 1;
    } else {
      counts.adult += 1;
    }
  }
  return counts;
}

// Compute average dwarf metric from a selector.
function averageDwarfMetric(dwarves, selector) {
  const list = Array.isArray(dwarves) ? dwarves : [];
  let total = 0;
  let count = 0;
  for (const dwarf of list) {
    const value = Number(selector(dwarf));
    if (!Number.isFinite(value)) {
      continue;
    }
    total += value;
    count += 1;
  }
  return count > 0 ? total / count : 0;
}

// Collect workforce allocation snapshot by adult assignment type.
function collectWorkforceSnapshot(dwarves) {
  const counts = { idle: 0, job: 0, under: 0, exped: 0 };
  const list = Array.isArray(dwarves) ? dwarves : [];
  for (const dwarf of list) {
    if (!dwarf || dwarf.lifeStage !== 'adult') {
      continue;
    }
    const underrealmDutyActive = Boolean(
      dwarf.underrealmDuty
      && dwarf.underrealmDuty.active !== false
      && Number(dwarf.underrealmDuty.depth || 0) > 0,
    );
    if (underrealmDutyActive) {
      counts.under += 1;
    } else if (dwarf.expedition) {
      counts.exped += 1;
    } else if (dwarf.job) {
      counts.job += 1;
    } else {
      counts.idle += 1;
    }
  }
  return counts;
}

// Collect active job mix by main operational categories.
function collectJobMixSnapshot(jobs) {
  const counts = { gather: 0, craft: 0, build: 0, mine: 0, other: 0, total: 0 };
  const list = Array.isArray(jobs) ? jobs : [];
  for (const job of list) {
    const type = String(job && job.type || '');
    counts.total += 1;
    if (type === 'gather') {
      counts.gather += 1;
    } else if (type === 'craft') {
      counts.craft += 1;
    } else if (type === 'build' || type === 'upgrade' || type === 'upgrade_tools' || type === 'upgrade_structure') {
      counts.build += 1;
    } else if (type === 'mine') {
      counts.mine += 1;
    } else {
      counts.other += 1;
    }
  }
  return counts;
}

// Resolve user-facing resource labels for dashboard rows.
function resolveResourceLabel(resourceId, resourceLabels) {
  const id = String(resourceId || '').trim();
  if (!id) {
    return '-';
  }
  const configured = String(resourceLabels && resourceLabels[id] ? resourceLabels[id] : '').trim();
  if (configured) {
    return configured;
  }
  return id
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// Format ratio as rounded percentage.
function formatRatioPct(ratio) {
  return `${Math.max(0, Math.round(Number(ratio || 0) * 100))}%`;
}

// Format signed percentage-point deltas.
function formatSignedPoints(points) {
  const numeric = Number(points || 0);
  if (!Number.isFinite(numeric) || Math.abs(numeric) < 0.05) {
    return '0pp';
  }
  const rounded = Math.round(numeric);
  if (rounded > 0) {
    return `+${rounded}pp`;
  }
  return `${rounded}pp`;
}

// Format signed integer deltas for count-based metrics.
function formatSignedInteger(value) {
  const numeric = Math.round(Number(value || 0));
  if (!Number.isFinite(numeric) || numeric === 0) {
    return '0';
  }
  if (numeric > 0) {
    return `+${numeric}`;
  }
  return String(numeric);
}

// Resolve a mean value for finite numeric entries.
function averageValues(values) {
  const list = Array.isArray(values) ? values : [];
  let total = 0;
  let count = 0;
  for (const value of list) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      continue;
    }
    total += numeric;
    count += 1;
  }
  return count > 0 ? total / count : 0;
}

// Resolve ticks to threshold from current ratio and ratio slope.
function computeRunwayTicks(currentRatio, slopePerTick, thresholdRatio) {
  const current = Math.max(0, Number(currentRatio || 0));
  const slope = Number(slopePerTick || 0);
  const threshold = Math.max(0, Number(thresholdRatio || 0));
  if (!Number.isFinite(current) || !Number.isFinite(slope) || !Number.isFinite(threshold)) {
    return Number.POSITIVE_INFINITY;
  }
  if (current <= threshold) {
    return 0;
  }
  if (slope >= -1e-9) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, (current - threshold) / Math.abs(slope));
}

// Format runway ticks for compact dashboard rows.
function formatRunwayTicks(ticks) {
  const numeric = Number(ticks);
  if (!Number.isFinite(numeric)) {
    return 'stable';
  }
  const rounded = Math.max(0, Math.round(numeric));
  if (rounded <= 0) {
    return 'now';
  }
  return `${formatCompactNumber(rounded)}t`;
}

// Format one signed per-100-tick rate with optional unit suffix.
function formatSignedRatePer100Ticks(value, unit = '') {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || Math.abs(numeric) < 0.05) {
    return `0${unit}`;
  }
  const abs = Math.abs(numeric);
  const rounded = abs < 10 ? numeric.toFixed(1) : Math.round(numeric).toString();
  const normalized = numeric > 0 ? `+${rounded}` : rounded;
  return `${normalized}${unit}`;
}

// Resolve compact qualitative volatility labels from pp magnitude.
function formatVolatilityLevel(ppValue) {
  const numeric = Math.max(0, Number(ppValue || 0));
  if (numeric >= 3) {
    return 'high';
  }
  if (numeric >= 1.2) {
    return 'medium';
  }
  return 'low';
}

// Resolve history key for tracked ratio resources.
function getResourceRatioHistoryKey(resourceId) {
  const id = String(resourceId || '').trim().toLowerCase();
  if (id === 'food') {
    return 'foodRatio';
  }
  if (id === 'water') {
    return 'waterRatio';
  }
  if (id === 'beer') {
    return 'beerRatio';
  }
  return null;
}

// Resolve history key for tracked stock-unit resources.
function getResourceCurrentHistoryKey(resourceId) {
  const id = String(resourceId || '').trim().toLowerCase();
  if (id === 'food') {
    return 'foodCurrent';
  }
  if (id === 'water') {
    return 'waterCurrent';
  }
  if (id === 'beer') {
    return 'beerCurrent';
  }
  return null;
}

// Build telemetry rows for pages backed by regular telemetry sections.
function buildSectionPageLines(state, config, width, page, context = {}) {
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

  const contextBlock = buildSectionContextBlock(state, config, page, columnWidth, context);
  const sectionBlocks = sectionKeys.map((key) =>
    buildSectionBlockLines(sections && sections[key], key, columnWidth),
  );
  const usableBlocks = [];
  if (Array.isArray(contextBlock) && contextBlock.length > 0) {
    usableBlocks.push(contextBlock);
  }
  for (const block of sectionBlocks) {
    if (Array.isArray(block) && block.length > 0) {
      usableBlocks.push(block);
    }
  }
  if (usableBlocks.length === 0) {
    return ['No telemetry data available for this page.'];
  }

  const mergedColumns = mergeBlocksIntoColumns(usableBlocks, columnCount);
  return formatMergedColumns(mergedColumns, safeWidth, columnCount, gap);
}

// Build one contextual deep-dive block for non-dashboard pages.
function buildSectionContextBlock(state, config, page, columnWidth, context = {}) {
  const pageId = page && page.id ? String(page.id) : '';
  if (pageId !== 'overview_deep' && pageId !== 'economy') {
    return null;
  }
  const alertState = context.alertState
    || resolveTelemetryAlertState(state, config, context.alertConfig);
  const alertConfig = resolveTelemetryAlertConfig(context.alertConfig);
  const dashboardConfig = resolveTelemetryDashboardConfig(config);
  const snapshot = collectDashboardSnapshot(state, config, alertState, alertConfig);
  const history = updateDashboardHistory(state, snapshot, dashboardConfig);
  const deltaWindowTicks = resolveContextDeltaWindowTicks(dashboardConfig);
  const isOverview = pageId === 'overview_deep';
  const rows = isOverview
    ? buildOverviewContextRows(snapshot, history, deltaWindowTicks)
    : buildEconomyContextRows(snapshot, history, deltaWindowTicks);
  const label = isOverview ? 'Deep Context' : 'Economy Context';
  return buildSectionBlockLines({ label, rows }, label.toLowerCase(), columnWidth);
}

// Resolve context block delta window from dashboard sampling settings.
function resolveContextDeltaWindowTicks(dashboardConfig) {
  const sampling = dashboardConfig && typeof dashboardConfig === 'object'
    ? dashboardConfig
    : {
      historyPoints: DEFAULT_DASHBOARD_HISTORY.history_points,
      snapshotIntervalTicks: DEFAULT_DASHBOARD_HISTORY.snapshot_interval_ticks,
    };
  const windowTicks = Math.max(1, sampling.historyPoints * sampling.snapshotIntervalTicks);
  return Math.max(sampling.snapshotIntervalTicks, Math.floor(windowTicks * 0.2));
}

// Build contextual lines for Overview + Deep page.
function buildOverviewContextRows(snapshot, history, deltaWindowTicks) {
  const riskDelta = formatSignedPoints(
    getHistoryDeltaByTicks(history, 'riskScore', deltaWindowTicks) * 100,
  );
  const moraleDelta = formatSignedPoints(
    getHistoryDeltaByTicks(history, 'moraleRatio', deltaWindowTicks) * 100,
  );
  const popDelta = formatSignedInteger(
    getHistoryDeltaByTicks(history, 'population', deltaWindowTicks),
  );
  const underrealmText = snapshot.underrealm.enabled
    ? `depth ${snapshot.underrealm.activeDepth}/${snapshot.underrealm.maxUnlockedDepth}/${snapshot.underrealm.maxDepth} | deep raids ${snapshot.underrealm.deepRaidCount}`
    : 'underrealm disabled';
  return [
    `Risk posture: ${snapshot.alertLevel.toUpperCase()} (${snapshot.alertCause}) ${formatRatioPct(snapshot.risk.score)} | Delta ${riskDelta}/${formatCompactNumber(deltaWindowTicks)}t`,
    `Population lens: ${formatCompactNumber(snapshot.population)} (${popDelta}) | Morale ${formatRatioPct(snapshot.moraleRatio)} (${moraleDelta}) | Stress ${formatRatioPct(snapshot.stressRatio)}`,
    `Social climate: ${buildContextSocialSummary(snapshot)}`,
    `Frontier posture: ${underrealmText}`,
    `Raid status: surface ${snapshot.alertState.raidActive ? 'ACTIVE' : 'off'} | deep ${snapshot.alertState.deepRaidActive ? 'ACTIVE' : 'off'}`,
    `Core stock floor: ${formatRatioPct(snapshot.stockMinRatio)} | ${snapshot.food.label} ${formatRatioPct(snapshot.food.ratio)} | ${snapshot.water.label} ${formatRatioPct(snapshot.water.ratio)} | ${snapshot.beer.label} ${formatRatioPct(snapshot.beer.ratio)}`,
    `Timeline: contract ${buildContextContractSummary(snapshot)} | event ${buildContextWorldEventSummary(snapshot)} | schism ${buildContextSchismSummary(snapshot)} | social ${buildContextSocialSummary(snapshot)}`,
  ];
}

// Build contextual lines for Economy page.
function buildEconomyContextRows(snapshot, history, deltaWindowTicks) {
  const weakest = [snapshot.food, snapshot.water, snapshot.beer]
    .slice()
    .sort((left, right) => left.ratio - right.ratio)[0];
  const foodDelta = formatSignedPoints(
    getHistoryDeltaByTicks(history, 'foodRatio', deltaWindowTicks) * 100,
  );
  const waterDelta = formatSignedPoints(
    getHistoryDeltaByTicks(history, 'waterRatio', deltaWindowTicks) * 100,
  );
  const beerDelta = formatSignedPoints(
    getHistoryDeltaByTicks(history, 'beerRatio', deltaWindowTicks) * 100,
  );
  const riskDelta = formatSignedPoints(
    getHistoryDeltaByTicks(history, 'riskScore', deltaWindowTicks) * 100,
  );
  const adultTotal = Math.max(1, Number(snapshot.lifeStages.adult || 0));
  const utilizedAdults = snapshot.workforce.job + snapshot.workforce.under + snapshot.workforce.exped;
  const utilization = clampUnit(utilizedAdults / adultTotal, 0);
  return [
    `Stock pressure: floor ${formatRatioPct(snapshot.stockMinRatio)} | weakest ${weakest.label} ${formatRatioPct(weakest.ratio)} | shortage ${snapshot.alertState.shortageScore.toFixed(2)}`,
    `Trend context (${formatCompactNumber(deltaWindowTicks)}t): ${snapshot.food.label} ${foodDelta} | ${snapshot.water.label} ${waterDelta} | ${snapshot.beer.label} ${beerDelta} | risk ${riskDelta}`,
    `Workforce load: utilization ${formatRatioPct(utilization)} | active jobs ${snapshot.jobMix.total} | I${snapshot.workforce.idle} J${snapshot.workforce.job} U${snapshot.workforce.under} E${snapshot.workforce.exped}`,
    `Shortage drivers: primary ${buildContextShortageSummary(snapshot.shortages[0])} | secondary ${buildContextShortageSummary(snapshot.shortages[1])}`,
    `Ops clocks: contract ${buildContextContractSummary(snapshot)} | festival ${buildContextFestivalSummary(snapshot)} | schism ${buildContextSchismSummary(snapshot)} | social ${buildContextSocialSummary(snapshot)} | alchemy ${buildContextAlchemySummary(snapshot)}`,
  ];
}

// Build one compact shortage summary token for context blocks.
function buildContextShortageSummary(shortage) {
  if (!shortage) {
    return 'none';
  }
  return `${shortage.label} ${formatRatioPct(shortage.ratio)} (u${shortage.urgency.toFixed(2)})`;
}

// Build one compact contract summary token for context blocks.
function buildContextContractSummary(snapshot) {
  if (!snapshot || !snapshot.contract || !snapshot.contract.active) {
    return 'none';
  }
  return `${snapshot.contract.label} ${snapshot.contract.ticksLeft}t`;
}

// Build one compact world-event summary token for context blocks.
function buildContextWorldEventSummary(snapshot) {
  if (snapshot && snapshot.worldEventStatus && snapshot.worldEventStatus.active === true) {
    const label = String(snapshot.worldEventStatus.label || 'event');
    const ticks = Math.max(0, Number(snapshot.worldEventStatus.ticksLeft || 0));
    return `${label} ${ticks}t`;
  }
  const nextSpawnTick = Math.max(
    0,
    Number(snapshot && snapshot.worldEventsState && snapshot.worldEventsState.nextSpawnTick || 0),
  );
  if (nextSpawnTick <= 0) {
    return 'none';
  }
  const tick = Math.max(0, Number(snapshot && snapshot.tick || 0));
  return `next ${Math.max(0, nextSpawnTick - tick)}t`;
}

// Build one compact schism summary token for context blocks.
function buildContextSchismSummary(snapshot) {
  if (!(snapshot && snapshot.schismStatus && snapshot.schismStatus.enabled !== false)) {
    return 'off';
  }
  const schism = snapshot.schismStatus;
  const phase = String(schism.phase || 'concord');
  const doctrine = String(schism.doctrine || 'austerity');
  const pressure = Math.round(clampUnit(schism.pressure, 0) * 100);
  const legitimacy = Math.round(clampUnit(schism.legitimacy, 0) * 100);
  const ritual = schism.ritualOpen ? 'ritual' : 'quiet';
  const activeRitual = schism.ritualActive
    ? `:${String(schism.ritualLabel || 'rite').slice(0, 6).toLowerCase()}`
    : '';
  const activeDecree = schism.decreeActive
    ? `|d:${String(schism.decreeLabel || 'decree').slice(0, 6).toLowerCase()}`
    : '';
  const climax = schism.climaxActive ? '+crisis' : '';
  return `${phase}/${doctrine} p${pressure} l${legitimacy} ${ritual}${activeRitual}${activeDecree}${climax}`;
}

// Build one compact social summary token for context blocks.
function buildContextSocialSummary(snapshot) {
  if (!(snapshot && snapshot.social && snapshot.social.enabled === true)) {
    return 'off';
  }
  const social = snapshot.social;
  const cohesion = Math.round(clampUnit(social.cohesion, 0) * 100);
  const conflict = Math.round(clampUnit(social.conflictPressure, 0) * 100);
  const mentorship = Math.round(clampUnit(social.mentorshipCoverage, 0) * 100);
  const grudge = Math.round(clampUnit(social.grudgeLoad, 0) * 100);
  const incidents = Math.max(0, Number(social.incidents || 0));
  const tick = Math.max(0, Number(snapshot.tick || 0));
  const lastIncidentTick = Math.max(0, Number(social.lastIncidentTick || 0));
  const recency = lastIncidentTick > 0 ? `${Math.max(0, tick - lastIncidentTick)}t` : 'none';
  return `c${cohesion}/f${conflict}/m${mentorship}/g${grudge} inc${incidents}@${recency}`;
}

// Build one compact festival summary token for context blocks.
function buildContextFestivalSummary(snapshot) {
  if (!(snapshot && snapshot.festivalStatus && snapshot.festivalStatus.active === true)) {
    return 'off';
  }
  const label = String(snapshot.festivalStatus.label || 'festival');
  const left = Math.max(0, Number(snapshot.festivalStatus.ticksLeft || 0));
  return `${label} ${left}t`;
}

// Build one compact alchemy summary token for context blocks.
function buildContextAlchemySummary(snapshot) {
  if (!snapshot || !snapshot.alchemyStatus) {
    return 'idle';
  }
  const status = snapshot.alchemyStatus;
  if (status.mode === 'active') {
    return `${String(status.label || 'rite')} ${Math.max(0, Number(status.ticksLeft || 0))}t`;
  }
  if (status.mode === 'backlash') {
    return `backlash ${Math.max(0, Number(status.ticksLeft || 0))}t`;
  }
  if (status.mode === 'cooldown') {
    return `cooldown ${Math.max(0, Number(status.ticksLeft || 0))}t`;
  }
  return 'idle';
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
        spans: buildInlineSignalSpans(text),
      });
    }
  }
  return entries;
}

// Distribute variable-height blocks across telemetry columns using shortest-column placement.
function mergeBlocksIntoColumns(blocks, columnCount) {
  const safeCount = Math.max(1, Math.floor(Number(columnCount || 1)));
  const columns = Array.from({ length: safeCount }, () => []);
  const heights = Array.from({ length: safeCount }, () => 0);
  for (const block of blocks) {
    if (!Array.isArray(block) || block.length === 0) {
      continue;
    }
    let target = 0;
    for (let i = 1; i < safeCount; i += 1) {
      if (heights[i] < heights[target]) {
        target = i;
      }
    }
    if (columns[target].length > 0) {
      columns[target].push('');
      heights[target] += 1;
    }
    columns[target].push(...block);
    heights[target] += block.length;
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

// Build status-token regex for light-weight in-line risk/accomplishment highlights.
function buildStatusTokenRegex(colorMap) {
  const tokens = Object.keys(colorMap || {});
  if (tokens.length === 0) {
    return null;
  }
  const pattern = tokens
    .map((token) => escapeRegexToken(token))
    .sort((left, right) => right.length - left.length)
    .join('|');
  return new RegExp(`\\b(${pattern})\\b`, 'gi');
}

// Build color spans for status words such as blocked/warning/ready.
function buildStatusTokenSpans(lineText) {
  if (!STATUS_TOKEN_REGEX) {
    return [];
  }
  const text = String(lineText || '');
  const spans = [];
  const regex = new RegExp(STATUS_TOKEN_REGEX.source, STATUS_TOKEN_REGEX.flags);
  let match = regex.exec(text);
  while (match) {
    const token = String(match[1] || '').trim().toLowerCase();
    const colorKey = STATUS_TOKEN_COLOR_KEYS[token];
    if (colorKey) {
      spans.push({
        start: match.index,
        end: match.index + match[0].length,
        colorKey,
      });
    }
    match = regex.exec(text);
  }
  return spans;
}

// Build merged spans from section labels and status tokens.
function buildInlineSignalSpans(lineText) {
  const sectionSpans = buildSectionTokenSpans(lineText);
  const statusSpans = buildStatusTokenSpans(lineText);
  return sectionSpans.concat(statusSpans);
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
