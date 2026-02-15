"use strict";

const { clamp, padRight } = require("../utils");
const { getStockpileTarget } = require("../simulation/resources");
const { getFestivalStatus } = require("../simulation/festivals");
const { getAlchemyStatus } = require("../simulation/alchemy");
const { getWorldEventStatus } = require("../simulation/world_events");
const { getExternalCampStatus } = require("../simulation/external_camps");
const { getSchismStatus } = require("../simulation/schism");
const { getColorConfig, applyColor } = require("../render/colors");
const { fitLine, wrapLine } = require("../render/format");

const TELEMETRY_LAYOUT = [
  {
    id: "core_ops",
    title: "Core Ops",
    sections: ["world", "population", "pressure", "stockpile"],
  },
  {
    id: "economy",
    title: "Economy",
    sections: ["structures", "diplomacy", "operations", "explainability", "endgame"],
  },
  {
    id: "deep_meta",
    title: "Deep & Meta",
    sections: ["underrealm", "lore", "deepSignals"],
  },
];

// Build telemetry sections as plain data for external panels/overlays.
function buildTelemetrySections(state, config, width, options = {}) {
  const sectionWidth = Math.max(1, Math.floor(Number(width || 1)));
  const includeRuins = options.includeRuins !== false;
  const includeMyths = options.includeMyths !== false;
  const { sections } = buildTelemetryColumns(state, config, sectionWidth, {
    includeRuins,
    includeMyths,
  });
  return sections;
}

// Return telemetry page layouts as plain serializable objects.
function getTelemetryLayouts() {
  return TELEMETRY_LAYOUT.map((layout) => ({
    id: String(layout.id || ""),
    title: String(layout.title || ""),
    sections: Array.isArray(layout.sections) ? layout.sections.slice() : [],
  }));
}

// Build the left and right telemetry columns.
function buildTelemetryColumns(state, config, columnWidth, options = {}) {
  const snapshot = collectTelemetrySnapshot(state, config, columnWidth, options);
  const sectionModels = buildTelemetrySectionModels(snapshot);
  return renderTelemetryColumns(sectionModels, snapshot.colors);
}

// Collect normalized telemetry snapshot data in one place.
function collectTelemetrySnapshot(state, config, columnWidth, options = {}) {
  const safeState = state && typeof state === "object" ? state : {};
  const safeConfig = config && typeof config === "object" ? config : {};
  const dwarves = Array.isArray(safeState.dwarves) ? safeState.dwarves : [];
  const jobs = Array.isArray(safeState.jobs) ? safeState.jobs : [];
  const structures = Array.isArray(safeState.structures) ? safeState.structures : [];
  const structureCounts = countEntriesByValue(structures, (entry) => entry && entry.type);
  const houses = structures.filter((structure) => structure && structure.type === "house");
  const housingConfig = (safeConfig.population && safeConfig.population.housing) || {};
  const housingEnabled = housingConfig.enabled !== false;
  const bedsTotal = housingEnabled
    ? houses.reduce(
        (sum, house) => sum + Math.max(0, Number(house.capacity || 0)),
        0,
      )
    : 0;
  const housingRatio = housingEnabled
    ? bedsTotal > 0
      ? bedsTotal / Math.max(1, dwarves.length)
      : 0
    : 1;
  const wildlifeConfig = safeConfig.wildlife || {};
  const wildlifeEnabled = wildlifeConfig.enabled === true;
  const herdCount = wildlifeEnabled && safeState.wildlife && Array.isArray(safeState.wildlife.herds)
    ? safeState.wildlife.herds.filter((herd) => herd && Number(herd.remaining || 0) > 0).length
    : 0;
  const huntCount = wildlifeEnabled
    ? jobs.filter((job) => job && job.type === "hunt").length
    : 0;
  const seasonLabel = formatSeasonLabel(safeState.season);
  const yearLabel = formatYearLabel(safeState, safeConfig);
  const underrealmRows = buildStableUnderrealmRows(getUnderrealmTelemetryLines(safeState));
  const stageCounts = countLifeStages(dwarves);
  const targets =
    (safeConfig.resources
      && (safeConfig.resources.targets || safeConfig.resources.stockpile))
    || {};
  const resourceLabels = (safeConfig.resources && safeConfig.resources.labels) || {};
  const telemetryConfig = (safeConfig.display && safeConfig.display.telemetry) || {};
  const stockBarMax = Number(telemetryConfig.stockBarMax || 0);
  const colors = getColorConfig(safeConfig);
  const cycleStats = safeState.cycleStats || {};
  const cycleCount = Math.max(0, Number(cycleStats.count || 0));
  const villageCount = Array.isArray(safeState.villages)
    ? safeState.villages.length
    : 1;
  const templeState = safeState.temple && typeof safeState.temple === "object"
    ? safeState.temple
    : null;
  const templeMaxStageConfig = safeConfig.structures
    && safeConfig.structures.temple_of_ancestors
    && Array.isArray(safeConfig.structures.temple_of_ancestors.stages)
    ? safeConfig.structures.temple_of_ancestors.stages.length
    : 0;
  const templeMaxStage = Math.max(
    templeMaxStageConfig,
    Math.max(0, Number(templeState && templeState.maxStage || 0)),
  );
  const templeStage = clamp(
    Math.floor(Number(templeState && templeState.stage || 0)),
    0,
    Math.max(0, templeMaxStage),
  );
  const templeJob = jobs.find(
    (job) => job.type === "build" && job.structureType === "temple_of_ancestors",
  ) || null;
  const prestigeState = safeState.prestige && typeof safeState.prestige === "object"
    ? safeState.prestige
    : null;
  const prestigeTotal = Math.max(0, Number(prestigeState && prestigeState.total || 0));
  const prestigeRank = prestigeState && prestigeState.rank
    ? String(prestigeState.rank)
    : "Unproven";
  const reproductionStats = safeState.reproductionStats || {};
  const deathsByCause = safeState.deathsByCause || {};
  const birthsCount = Math.max(0, Number(safeState.birthsCount || 0));
  const deathsCount = Math.max(0, Number(safeState.deathsCount || 0));
  const reproAttempts = Math.max(0, Number(reproductionStats.attempts || 0));
  const reproSuccesses = Math.max(0, Number(reproductionStats.successes || 0));
  const reproSuccessRatio = reproAttempts > 0
    ? Math.round((reproSuccesses / reproAttempts) * 100)
    : 0;
  const raidStats = safeState.raidStats || {};
  const merchantStats = safeState.merchantStats || {};
  const contractsState = safeState.contracts && typeof safeState.contracts === "object"
    ? safeState.contracts
    : null;
  const contractsStats = contractsState && contractsState.stats
    ? contractsState.stats
    : {};
  const worldEventsState = safeState.worldEvents && typeof safeState.worldEvents === "object"
    ? safeState.worldEvents
    : null;
  const worldEventsStats = worldEventsState && worldEventsState.stats
    ? worldEventsState.stats
    : null;
  const externalCampStatus = getExternalCampStatus(safeState, safeConfig);
  const includeRuins = options.includeRuins !== false;
  const includeMyths = options.includeMyths !== false;
  const festivalStatus = getFestivalStatus(safeState, safeConfig);
  const worldEventStatus = getWorldEventStatus(safeState, safeConfig);
  const schismStatus = getSchismStatus(safeState, safeConfig);
  const shortages = Array.isArray(safeState.lastPriorities) ? safeState.lastPriorities : [];
  const governorSignals = getGovernorSignals(safeState);
  const stockRatioLine = [
    formatStockRatio("food", safeState, safeConfig, resourceLabels),
    formatStockRatio("water", safeState, safeConfig, resourceLabels),
    formatStockRatio("beer", safeState, safeConfig, resourceLabels),
  ].join(" | ");
  const buildRatioLine = [
    formatStockRatio("wood", safeState, safeConfig, resourceLabels),
    formatStockRatio("stone", safeState, safeConfig, resourceLabels),
    formatStockRatio("iron", safeState, safeConfig, resourceLabels),
  ].join(" | ");
  const structureLevelSummary = getStructureLevelSummary(structures);
  const toolState = safeState.tools && typeof safeState.tools === "object"
    ? safeState.tools
    : null;
  let toolLine = "Tool upgrade level: -";
  if (toolState) {
    const maxLevel = Math.max(1, Number(toolState.maxLevel || 1));
    const level = Math.min(maxLevel, Math.max(1, Number(toolState.level || 1)));
    toolLine = `Tool upgrade level: ${level}/${maxLevel}`;
  }
  const stockpileEntries = buildStockpileTelemetryEntries(
    safeState,
    safeConfig,
    targets,
    resourceLabels,
    stockBarMax,
  );
  const stockpileLines = stockpileEntries.map((entry) => formatBarLine(
    entry.label,
    entry.ratio,
    entry.detail,
    columnWidth,
  ));

  return {
    state: safeState,
    config: safeConfig,
    columnWidth,
    colors,
    includeRuins,
    includeMyths,
    dwarves,
    jobs,
    structures,
    stageCounts,
    avgMorale: averageValue(dwarves, (dwarf) => dwarf.state.morale),
    avgMoraleBoost: averageValue(dwarves, (dwarf) => dwarf.state.moraleBoostBeer),
    avgStress: averageValue(dwarves, (dwarf) => dwarf.state.stress),
    idleCount: dwarves.filter((dwarf) => !dwarf.job && !dwarf.expedition).length,
    wildlifeEnabled,
    herdCount,
    huntCount,
    seasonLabel,
    yearLabel,
    underrealmRows,
    targets,
    resourceLabels,
    stockBarMax,
    cycleCount,
    villageCount,
    templeState,
    templeMaxStage,
    templeStage,
    templeJob,
    prestigeTotal,
    prestigeRank,
    birthsCount,
    deathsCount,
    reproAttempts,
    reproSuccesses,
    reproSuccessRatio,
    deathsByCause,
    raidStats,
    merchantStats,
    contractsStats,
    worldEventsState,
    worldEventsStats,
    externalCampStatus,
    festivalStatus,
    worldEventStatus,
    schismStatus,
    shortages,
    governorSignals,
    stockRatioLine,
    buildRatioLine,
    housingRatio,
    structureLevelSummary,
    toolLine,
    structureCounts,
    stockpileLines,
  };
}

// Build telemetry sections as plain section models (key/label/column/rows).
function buildTelemetrySectionModels(snapshot) {
  const templeProgress = formatTempleProgressStatus(snapshot.templeJob, snapshot.config)
    || "Temple construction progress: -";
  return [
    {
      column: "left",
      key: "world",
      label: "World",
      rows: [
        `Timeline: tick ${snapshot.state.tick} | year ${snapshot.yearLabel} | ${snapshot.seasonLabel}`,
        `Cycles: ${snapshot.cycleCount} complete | villages ${snapshot.villageCount}`,
        `Prestige: ${formatCompactNumber(snapshot.prestigeTotal)} (${snapshot.prestigeRank})`,
        `Weather: ${formatWeatherStatus(snapshot.state.weather, snapshot.colors)}`,
        `Housing ratio: ${snapshot.housingRatio.toFixed(2)} beds per dwarf`,
        formatFestivalStatus(snapshot.festivalStatus),
        formatSchismStatus(snapshot.schismStatus),
        formatWorldEventStatus(snapshot.worldEventStatus),
        formatContractStatus(snapshot.state, snapshot.config, snapshot.columnWidth),
        formatAlchemyStatus(snapshot.state, snapshot.config, snapshot.columnWidth),
        ...buildWorldLogRows(snapshot.state.events, snapshot.columnWidth, 3),
      ],
    },
    {
      column: "left",
      key: "underrealm",
      label: "Underrealm",
      rows: snapshot.underrealmRows,
    },
    {
      column: "left",
      key: "population",
      label: "Population",
      rows: [
        `Population total: ${snapshot.dwarves.length}`,
        `Life stages: adults ${snapshot.stageCounts.adult}, children ${snapshot.stageCounts.child}, elders ${snapshot.stageCounts.elder}`,
        snapshot.wildlifeEnabled
          ? `Workforce: ${snapshot.idleCount} idle, ${snapshot.jobs.length} assigned, ${snapshot.huntCount} hunting`
          : `Workforce: ${snapshot.idleCount} idle, ${snapshot.jobs.length} assigned`,
        snapshot.wildlifeEnabled
          ? `Wildlife status: ${snapshot.herdCount} active herds`
          : "Wildlife status: off",
        `Morale: ${snapshot.avgMorale.toFixed(2)} (beer +${snapshot.avgMoraleBoost.toFixed(2)}) | Stress: ${snapshot.avgStress.toFixed(2)}`,
        `Births / deaths: ${snapshot.birthsCount} / ${snapshot.deathsCount}`,
        `Deaths by cause: starvation ${Math.max(0, Number(snapshot.deathsByCause.starvation || 0))}, raids ${Math.max(0, Number(snapshot.deathsByCause.raid || 0))}, deep raids ${Math.max(0, Number(snapshot.deathsByCause.deepRaid || 0))}`,
        `Reproduction success: ${snapshot.reproSuccesses}/${snapshot.reproAttempts} (${snapshot.reproSuccessRatio}%)`,
      ],
    },
    {
      column: "left",
      key: "pressure",
      label: "Pressure",
      rows: [
        formatShortageStatus(
          snapshot.shortages,
          0,
          snapshot.state,
          snapshot.config,
          snapshot.resourceLabels,
        ),
        formatShortageStatus(
          snapshot.shortages,
          1,
          snapshot.state,
          snapshot.config,
          snapshot.resourceLabels,
        ),
        `Core stock targets: ${snapshot.stockRatioLine}`,
        `Build stock targets: ${snapshot.buildRatioLine}`,
        formatRaidStatus(snapshot.raidStats),
        formatJobsGovernorLine(snapshot.governorSignals.jobs, snapshot.resourceLabels),
      ],
    },
    {
      column: "left",
      key: "lore",
      label: "Lore",
      rows: buildLoreSectionRows(snapshot.state, snapshot.config, snapshot.columnWidth, {
        includeRuins: snapshot.includeRuins,
        includeMyths: snapshot.includeMyths,
      }),
    },
    {
      column: "right",
      key: "structures",
      label: "Structures",
      rows: [
        `Core structures: Wells ${snapshot.structureCounts.well || 0}, Fields ${snapshot.structureCounts.field || 0}, Mines ${snapshot.structureCounts.mine || 0}`,
        `Production structures: Workshops ${snapshot.structureCounts.workshop || 0}, Breweries ${snapshot.structureCounts.brewery || 0}, Sawmills ${snapshot.structureCounts.sawmill || 0}`,
        `Defense structures: Armories ${snapshot.structureCounts.armory || 0}, Mithril forges ${snapshot.structureCounts.mithril_forge || 0}`,
        `Arcane structures: Alchemy labs ${snapshot.structureCounts.alchemy_lab || 0}, Ruins ${snapshot.structureCounts.ruins || 0}`,
        formatTempleStageStatus(
          snapshot.templeState,
          snapshot.templeStage,
          snapshot.templeMaxStage,
        ),
        templeProgress,
        snapshot.toolLine,
        snapshot.structureLevelSummary
          ? `Structure levels: ${snapshot.structureLevelSummary}`
          : "Structure levels: -",
      ],
    },
    {
      column: "right",
      key: "diplomacy",
      label: "Diplomacy",
      rows: [
        `Merchant status: ${formatMerchantStatus(snapshot.state.merchant)}`,
        `Merchant trades completed: ${Math.max(0, Number(snapshot.merchantStats.trades || 0))}`,
        formatMerchantFlowLine(
          "Top exported resource",
          snapshot.merchantStats.given,
          snapshot.resourceLabels,
        ),
        formatMerchantFlowLine(
          "Top imported resource",
          snapshot.merchantStats.received,
          snapshot.resourceLabels,
        ),
        formatExternalCampStatus(snapshot.externalCampStatus),
        formatExternalCampModifiers(snapshot.externalCampStatus),
        formatContractStatus(snapshot.state, snapshot.config, snapshot.columnWidth),
        formatContractReputation(snapshot.state, snapshot.config, snapshot.columnWidth),
        formatContractRecordLine(snapshot.contractsStats),
        formatTradeGovernorLine(snapshot.governorSignals.trade),
        formatWorldEventStats(snapshot.worldEventsStats),
        formatWorldEventLiveLine(
          snapshot.worldEventStatus,
          snapshot.worldEventsState,
          snapshot.state.tick,
        ),
      ],
    },
    {
      column: "right",
      key: "stockpile",
      label: "Stockpile",
      rows: snapshot.stockpileLines,
    },
    {
      column: "right",
      key: "operations",
      label: "Operations",
      rows: buildOperationsSectionRows(
        snapshot.state,
        snapshot.config,
        snapshot.shortages,
        snapshot.resourceLabels,
        snapshot.templeJob,
        snapshot.governorSignals,
      ),
    },
    {
      column: "right",
      key: "explainability",
      label: "AI Explainability",
      rows: buildExplainabilitySectionRows(
        snapshot.state,
        snapshot.governorSignals,
        snapshot.shortages,
        snapshot.resourceLabels,
      ),
    },
    {
      column: "right",
      key: "endgame",
      label: "Endgame",
      rows: buildEndgameSectionRows(snapshot.state, snapshot.config, {
        templeStage: snapshot.templeStage,
        templeMaxStage: snapshot.templeMaxStage,
      }),
    },
    {
      column: "right",
      key: "deepSignals",
      label: "Deep Signals",
      rows: buildDeepSignalsSectionRows(
        snapshot.state,
        snapshot.config,
        snapshot.worldEventStatus,
        snapshot.worldEventsState,
        snapshot.worldEventsStats,
        snapshot.contractsStats,
        snapshot.columnWidth,
      ),
    },
  ];
}

// Render section models into colored left/right columns plus plain section map.
function renderTelemetryColumns(sectionModels, colors) {
  const left = [];
  const right = [];
  const sections = {};
  const header = (label) => applyColor(label, "hud_header", colors);

  for (const model of sectionModels) {
    if (!model || !model.key || !model.label) {
      continue;
    }
    const column = model.column === "right" ? right : left;
    if (column.length > 0 && column[column.length - 1] !== "") {
      column.push("");
    }
    column.push(header(model.label));
    const rows = normalizeTelemetryRows(model.rows);
    column.push(...rows);
    sections[model.key] = {
      label: String(model.label),
      rows,
    };
  }

  return { left, right, sections };
}

// Normalize telemetry rows and avoid sterile repeated placeholders.
function normalizeTelemetryRows(rows) {
  const normalized = Array.isArray(rows)
    ? rows.map((row) => {
        if (row === null || row === undefined || row === "") {
          return "-";
        }
        return String(row);
      })
    : [];
  if (normalized.length === 0) {
    return ["-"];
  }
  while (normalized.length > 1
    && normalized[normalized.length - 1] === "-"
    && normalized[normalized.length - 2] === "-") {
    normalized.pop();
  }
  return normalized;
}

// Count entries by one string selector value.
function countEntriesByValue(entries, selector) {
  const counts = {};
  const list = Array.isArray(entries) ? entries : [];
  for (const entry of list) {
    const value = String(selector(entry) || "").trim();
    if (!value) {
      continue;
    }
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

// Build deep-meta signal rows that complement underrealm/lore pages.
function buildDeepSignalsSectionRows(
  state,
  config,
  worldEventStatus,
  worldEventsState,
  worldEventsStats,
  contractsStats,
  width,
) {
  return [
    formatWorldEventLiveLine(worldEventStatus, worldEventsState, state.tick),
    formatWorldEventStats(worldEventsStats),
    formatWorldEventCadence(worldEventsState, state.tick),
    formatContractReputation(state, config, width),
    formatContractRecordLine(contractsStats),
    formatContractWinRateLine(contractsStats),
  ];
}

// Build endgame progression rows with a step-by-step checklist.
function buildEndgameSectionRows(state, config, options = {}) {
  const endgameConfig = (config && config.endgame) || {};
  const ruinsConfig = (config && config.ruins) || {};
  const endgameEnabled = endgameConfig.enabled !== false;
  const ruinsEnabled = ruinsConfig.enabled !== false;
  const cycleStats = state && state.cycleStats ? state.cycleStats : {};
  const cycleCount = Math.max(0, Number(cycleStats.count || 0));
  const lastCycleTicks = Math.max(0, Number(cycleStats.lastTicks || 0));
  const lastCycleLabel = lastCycleTicks > 0
    ? `${formatCompactNumber(lastCycleTicks)} ticks`
    : "-";
  const structures = Array.isArray(state && state.structures) ? state.structures : [];
  const hasRuinsStructure = ruinsEnabled
    && structures.some((structure) => structure && structure.type === "ruins");
  const rooms = Array.isArray(ruinsConfig.rooms) ? ruinsConfig.rooms : [];
  const roomTarget = Math.max(0, rooms.length);
  const ruinsState = state && state.ruins && typeof state.ruins === "object"
    ? state.ruins
    : null;
  const roomsCleared = clamp(
    Math.floor(Number(ruinsState && ruinsState.roomsCleared || 0)),
    0,
    roomTarget,
  );
  const roomsComplete = roomTarget <= 0 || roomsCleared >= roomTarget;
  const artifactPool = ruinsEnabled
    ? Object.keys((ruinsConfig.artifacts && ruinsConfig.artifacts.pool) || {})
    : [];
  const artifactTarget = artifactPool.length;
  const artifactsFoundMap = ruinsState && ruinsState.artifactsFound
    ? ruinsState.artifactsFound
    : {};
  let artifactFoundCount = 0;
  for (const artifactId of artifactPool) {
    if (artifactsFoundMap[artifactId]) {
      artifactFoundCount += 1;
    }
  }
  const artifactsComplete = ruinsEnabled
    && (artifactTarget <= 0 || artifactFoundCount >= artifactTarget);

  const minTicksAfterArtifacts = getEndgameMinTicks(endgameConfig);
  const tick = Math.max(0, Math.floor(Number(state && state.tick || 0)));
  const rawCompletionTick = state ? state.endgameArtifactsTick : null;
  const hasCompletionTick = Number.isFinite(rawCompletionTick) && Number(rawCompletionTick) >= 0;
  const completionTick = hasCompletionTick
    ? Math.max(0, Math.floor(Number(rawCompletionTick)))
    : 0;
  const waitElapsed = artifactsComplete && hasCompletionTick
    ? Math.max(0, tick - completionTick)
    : 0;
  const waitTarget = Math.max(0, minTicksAfterArtifacts);
  const waitShown = waitTarget > 0 ? Math.min(waitElapsed, waitTarget) : waitElapsed;
  const waitRemaining = waitTarget > waitElapsed ? waitTarget - waitElapsed : 0;
  const waitComplete = artifactsComplete && (waitTarget <= 0 || waitElapsed >= waitTarget);
  const triggerArmed = endgameEnabled && artifactsComplete && waitComplete;

  const requiredSteps = [roomsComplete, artifactsComplete, waitComplete, triggerArmed];
  const requiredDone = requiredSteps.filter(Boolean).length;

  const ruinsGatewayLabel = !ruinsEnabled
    ? "disabled (ruins.enabled=false)"
    : hasRuinsStructure
      ? "online"
      : "no ruins structure";
  const templeStage = Math.max(0, Number(options && options.templeStage || 0));
  const templeMaxStage = Math.max(0, Number(options && options.templeMaxStage || 0));
  const templeComplete = templeMaxStage > 0 && templeStage >= templeMaxStage;
  const templeDetail = templeMaxStage > 0
    ? `stage ${templeStage}/${templeMaxStage}`
    : "disabled";
  const difficulty = Math.max(1, Number(state && state.endgameDifficulty || 1));

  return [
    `Cycle reset loop: ${endgameEnabled ? "enabled" : "disabled"}`,
    `Cycle history: current ${cycleCount} | last cycle length ${lastCycleLabel}`,
    `Ruins gateway: ${ruinsGatewayLabel}`,
    `Required path progress: ${requiredDone}/4`,
    formatChecklistStep(
      roomsComplete,
      "Clear all ruins rooms",
      `${roomsCleared}/${roomTarget}`,
    ),
    formatChecklistStep(
      artifactsComplete,
      "Recover all artifacts",
      `${artifactFoundCount}/${artifactTarget}`,
    ),
    formatChecklistStep(
      waitComplete,
      "Hold post-artifact window",
      waitTarget <= 0
        ? "no delay configured"
        : `${waitShown}/${waitTarget} ticks`,
    ),
    formatChecklistStep(
      triggerArmed,
      "Arm new cycle trigger",
      triggerArmed ? "ready" : "pending",
    ),
    `Next reset ETA: ${getEndgameEtaLabel({
      endgameEnabled,
      ruinsEnabled,
      roomsComplete,
      roomTarget,
      roomsCleared,
      artifactsComplete,
      artifactTarget,
      artifactFoundCount,
      waitComplete,
      waitRemaining,
      waitTarget,
    })}`,
    formatChecklistStep(templeComplete, "Temple completion (optional)", templeDetail),
    `Cycle pressure multiplier: x${difficulty.toFixed(2)}`,
  ];
}

// Resolve the reset delay after all artifacts are found.
function getEndgameMinTicks(endgameConfig) {
  if (!endgameConfig || typeof endgameConfig !== "object") {
    return 0;
  }
  if (Number.isFinite(endgameConfig.minTicksAfterArtifacts)) {
    return Math.max(0, Number(endgameConfig.minTicksAfterArtifacts));
  }
  return Math.max(0, Number(endgameConfig.minStableTicks || 0));
}

// Format one checklist row with a stable [x]/[ ] marker.
function formatChecklistStep(done, label, detail) {
  const mark = done ? "x" : " ";
  return `[${mark}] ${label}: ${detail}`;
}

// Build a concise reason/ETA for the next cycle reset.
function getEndgameEtaLabel(context) {
  const data = context && typeof context === "object" ? context : {};
  if (!data.endgameEnabled) {
    return "disabled";
  }
  if (!data.ruinsEnabled) {
    return "blocked (ruins disabled)";
  }
  if (!data.roomsComplete) {
    const missingRooms = Math.max(0, Number(data.roomTarget || 0) - Number(data.roomsCleared || 0));
    return `${missingRooms} room(s) left`;
  }
  if (!data.artifactsComplete) {
    const missingArtifacts = Math.max(
      0,
      Number(data.artifactTarget || 0) - Number(data.artifactFoundCount || 0),
    );
    return `${missingArtifacts} artifact(s) missing`;
  }
  if (!data.waitComplete) {
    if (Math.max(0, Number(data.waitTarget || 0)) <= 0) {
      return "waiting for endgame check";
    }
    return `${Math.max(0, Number(data.waitRemaining || 0))} ticks after artifacts`;
  }
  return "armed (reset on next check)";
}

// Format multiple columns into fixed-width lines.
function formatColumns(columns, totalWidth, columnCount, gap) {
  const usableWidth = Math.max(0, Number(totalWidth || 0));
  const gapWidth = Math.max(0, Number(gap || 0));
  const totalGap = gapWidth * (columnCount - 1);
  const columnWidth = Math.floor((usableWidth - totalGap) / columnCount);

  if (columnWidth <= 0 || columns.length === 0) {
    return columns[0] || [];
  }

  const maxRows = Math.max(...columns.map((column) => column.length));
  const lines = [];

  for (let row = 0; row < maxRows; row += 1) {
    const parts = [];
    for (let col = 0; col < columnCount; col += 1) {
      const column = columns[col] || [];
      const value = column[row] !== undefined ? column[row] : "";
      parts.push(padRight(value, columnWidth));
    }
    lines.push(parts.join(" ".repeat(gapWidth)));
  }

  return lines;
}

// Compute a single telemetry column width.
function getTelemetryColumnWidth(totalWidth, columnCount, gap) {
  const usableWidth = Math.max(0, Number(totalWidth || 0));
  const gapWidth = Math.max(0, Number(gap || 0));
  const totalGap = gapWidth * (columnCount - 1);
  const columnWidth = Math.floor((usableWidth - totalGap) / columnCount);
  return Math.max(0, columnWidth);
}

// Build a stable 9-row underrealm summary to avoid row shifting.
function buildStableUnderrealmRows(underrealmLines) {
  const lines = Array.isArray(underrealmLines) ? underrealmLines : [];
  if (lines.length === 0) {
    return [
      "Realm: Inactive",
      "Hidden gate: -",
      "Depth progression: -",
      "Champion gate: -",
      "Readiness gate: -",
      "Strata: -",
      "Delver role ratios: -",
      "Assigned delvers: -",
      "Underrealm pressure: -",
    ];
  }
  return [
    findLineByPrefix(lines, ["Realm:"], "Realm: -"),
    findLineByPrefix(lines, ["Hidden gate search time:", "Hidden gate:"], "Hidden gate: -"),
    findLineByPrefix(
      lines,
      ["Depth progression:", "Deep lift progress", "Depth survey progress:"],
      "Depth progression: -",
    ),
    findLineByPrefix(lines, ["Champion gate:"], "Champion gate: -"),
    findLineByPrefix(lines, ["Readiness gate:"], "Readiness gate: -"),
    findLineByPrefix(lines, ["Strata:"], "Strata: -"),
    findLineByPrefix(lines, ["Delver role ratios:"], "Delver role ratios: -"),
    findLineByPrefix(lines, ["Assigned delvers:"], "Assigned delvers: -"),
    findLineByPrefix(
      lines,
      ["Underrealm pressure:", "Deep threat level:", "Ward charges available:", "Shrine oath status:"],
      "Underrealm pressure: -",
    ),
  ];
}

// Find the first line matching one of the provided prefixes.
function findLineByPrefix(lines, prefixes, fallback) {
  if (!Array.isArray(lines) || !Array.isArray(prefixes)) {
    return fallback;
  }
  for (const lineRaw of lines) {
    const line = String(lineRaw || "");
    for (const prefix of prefixes) {
      if (line.startsWith(prefix)) {
        return line;
      }
    }
  }
  return fallback;
}

// Format active festival status with stable placeholder output.
function formatFestivalStatus(status) {
  if (!status) {
    return "Festival status: off";
  }
  if (!status.active) {
    return "Festival status: -";
  }
  const label = String(status.label || "Festival");
  const ritualLabel = status.ritualLabel ? String(status.ritualLabel) : null;
  const ticksLeft = Math.max(0, Number(status.ticksLeft || 0));
  const duration = Math.max(0, Number(status.duration || 0));
  if (duration > 0) {
    return `Festival status: ${label}${ritualLabel ? ` | ${ritualLabel}` : ""} (${ticksLeft}/${duration} ticks remaining)`;
  }
  return `Festival status: ${label}${ritualLabel ? ` | ${ritualLabel}` : ""} (${ticksLeft} ticks remaining)`;
}

// Format schism arc status with compact phase/doctrine metrics.
function formatSchismStatus(status) {
  if (!status || status.enabled === false) {
    return "Schism status: off";
  }
  const phase = String(status.phase || "concord");
  const doctrine = String(status.doctrine || "austerity");
  const pressure = Math.round(clamp(Number(status.pressure || 0), 0, 1) * 100);
  const legitimacy = Math.round(clamp(Number(status.legitimacy || 0), 0, 1) * 100);
  const ritual = status.ritualOpen ? "ritual open" : "ritual closed";
  const activeRitual = status.ritualActive
    ? ` | active rite ${String(status.ritualLabel || "Rite")} (${Math.max(0, Number(status.ritualTicksLeft || 0))}t)`
    : "";
  const climax = status.climaxActive ? " | climax active" : "";
  return `Schism status: ${phase}/${doctrine} | pressure ${pressure}% | legitimacy ${legitimacy}% | ${ritual}${activeRitual}${climax}`;
}

// Format one shortage line with urgency and stock ratio.
function formatShortageStatus(shortages, index, state, config, resourceLabels) {
  const rankLabel = index === 0
    ? "Primary shortage"
    : index === 1
      ? "Secondary shortage"
      : `Shortage ${index + 1}`;
  if (!Array.isArray(shortages) || !shortages[index]) {
    return `${rankLabel}: -`;
  }
  const shortage = shortages[index];
  const resourceId = String(shortage.resource || "");
  if (!resourceId) {
    return `${rankLabel}: -`;
  }
  const label = getTelemetryResourceLabel(resourceId, resourceLabels);
  const target = getStockpileTarget(state, config, resourceId);
  const current = Math.max(0, Number(state.stockpile && state.stockpile[resourceId] || 0));
  const ratio = target > 0 ? Math.round(clamp(current / target, 0, 1) * 100) : 0;
  const urgency = Math.max(0, Number(shortage.score || 0)).toFixed(2);
  return `${rankLabel}: ${label} at ${ratio}% of target (urgency ${urgency})`;
}

// Format one shortage signal line for operations telemetry.
function formatShortageCompact(shortages, index, state, config, resourceLabels) {
  const rankLabel = index === 0
    ? "Primary shortage signal"
    : index === 1
      ? "Secondary shortage signal"
      : `Shortage signal ${index + 1}`;
  if (!Array.isArray(shortages) || !shortages[index]) {
    return `${rankLabel}: -`;
  }
  const shortage = shortages[index];
  const resourceId = String(shortage.resource || "");
  if (!resourceId) {
    return `${rankLabel}: -`;
  }
  const label = getTelemetryResourceLabel(resourceId, resourceLabels);
  const target = getStockpileTarget(state, config, resourceId);
  const current = Math.max(0, Number(state.stockpile && state.stockpile[resourceId] || 0));
  const ratio = target > 0 ? Math.round(clamp(current / target, 0, 1) * 100) : 0;
  const urgency = Math.max(0, Number(shortage.score || 0)).toFixed(2);
  return `${rankLabel}: ${label} at ${ratio}% of target (urgency ${urgency})`;
}

// Format stockpile ratio with explicit labels.
function formatStockRatio(resourceId, state, config, resourceLabels) {
  const target = getStockpileTarget(state, config, resourceId);
  const current = Math.max(0, Number(state.stockpile && state.stockpile[resourceId] || 0));
  const label = getTelemetryResourceLabel(resourceId, resourceLabels);
  if (target <= 0) {
    return `${label}: no target`;
  }
  const ratio = Math.round(clamp(current / target, 0, 2) * 100);
  return `${label} ${ratio}%`;
}

// Resolve resource labels for telemetry, preferring explicit readable names.
function getTelemetryResourceLabel(resourceId, resourceLabels) {
  const id = String(resourceId || "").trim();
  if (!id) {
    return "-";
  }
  const configured = String(resourceLabels && resourceLabels[id] ? resourceLabels[id] : "").trim();
  const fallback = humanizeResourceId(id);
  if (!configured) {
    return fallback;
  }
  const configuredHasSpaces = /\s/.test(configured);
  const fallbackHasSpaces = /\s/.test(fallback);
  if (!configuredHasSpaces && fallbackHasSpaces && configured.toLowerCase() !== fallback.toLowerCase()) {
    return fallback;
  }
  return configured;
}

// Convert a resource id like expedition_kit into a title label.
function humanizeResourceId(resourceId) {
  const raw = String(resourceId || "").trim();
  if (!raw) {
    return "-";
  }
  return raw
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

// Format raid pressure summary in a fixed short line.
function formatRaidStatus(raidStats) {
  const count = Math.max(0, Number(raidStats && raidStats.count || 0));
  const deaths = Math.max(0, Number(raidStats && raidStats.deaths || 0));
  const lastDeaths = Math.max(0, Number(raidStats && raidStats.lastRaidDeaths || 0));
  return `Surface raids: ${count} total | Deaths: ${deaths} total | Last raid deaths: ${lastDeaths}`;
}

// Resolve the latest governor observability snapshot with safe defaults.
function getGovernorSignals(state) {
  const raw = state && state.lastGovernorSignals && typeof state.lastGovernorSignals === "object"
    ? state.lastGovernorSignals
    : {};
  return {
    jobs: raw.jobs && typeof raw.jobs === "object" ? raw.jobs : {},
    trade: raw.trade && typeof raw.trade === "object" ? raw.trade : {},
    building: raw.building && typeof raw.building === "object" ? raw.building : {},
  };
}

// Resolve the latest simulation decision trace with normalized safe defaults.
function getDecisionTrace(state) {
  const raw = state && state.lastDecisionTrace && typeof state.lastDecisionTrace === "object"
    ? state.lastDecisionTrace
    : {};
  const governors = raw.governors && typeof raw.governors === "object"
    ? raw.governors
    : {};
  const shortages = Array.isArray(raw.shortages) ? raw.shortages : [];
  const jobs = raw.jobs && typeof raw.jobs === "object"
    ? raw.jobs
    : {};
  const context = raw.context && typeof raw.context === "object"
    ? raw.context
    : {};
  const drivers = Array.isArray(raw.drivers) ? raw.drivers : [];
  return {
    tick: Math.max(0, Number(raw.tick || (state && state.tick) || 0)),
    governors: {
      jobsSource: governors.jobsSource === "action" ? "action" : "default",
      tradeSource: governors.tradeSource === "action" ? "action" : "default",
      buildingSource: governors.buildingSource === "action" ? "action" : "default",
      tradeReserveBias: Number(governors.tradeReserveBias || 0),
      tradeContestIntent: clamp(Number(governors.tradeContestIntent || 0), 0, 1),
      tradeOpportunityIntent: clamp(Number(governors.tradeOpportunityIntent || 0), 0, 1),
      buildMineBias: Number(governors.buildMineBias || 0),
      buildUpgradeBias: Number(governors.buildUpgradeBias || 0),
      buildingClassOrder: Array.isArray(governors.buildingClassOrder)
        ? governors.buildingClassOrder.slice(0, 3).map((entry) => String(entry || "")).filter(Boolean)
        : [],
    },
    shortages: shortages.slice(0, 2).map((entry) => ({
      resource: String(entry && entry.resource || ""),
      score: Math.max(0, Number(entry && entry.score || 0)),
      current: Math.max(0, Number(entry && entry.current || 0)),
      target: Math.max(0, Number(entry && entry.target || 0)),
      weight: Math.max(0, Number(entry && entry.weight || 0)),
      boostApplied: entry && entry.boostApplied === true,
      boostMultiplier: Math.max(1, Number(entry && entry.boostMultiplier || 1)),
    })).filter((entry) => entry.resource.length > 0),
    jobs: {
      total: Math.max(0, Math.floor(Number(jobs.total || 0))),
      byType: jobs.byType && typeof jobs.byType === "object" ? jobs.byType : {},
    },
    context: {
      weather: String(context.weather || "clear"),
      raidActive: context.raidActive === true,
      raidTicksLeft: Math.max(0, Number(context.raidTicksLeft || 0)),
      worldEventActive: context.worldEventActive === true,
      worldEventLabel: String(context.worldEventLabel || ""),
      worldEventPhase: String(context.worldEventPhase || ""),
      worldEventTicksLeft: Math.max(0, Number(context.worldEventTicksLeft || 0)),
      festivalActive: context.festivalActive === true,
      contractActive: context.contractActive === true,
    },
    drivers: drivers.slice(0, 3).map((entry) => ({
      kind: String(entry && entry.kind || ""),
      label: String(entry && entry.label || ""),
      key: String(entry && entry.key || ""),
      score: Math.max(0, Number(entry && entry.score || 0)),
    })),
  };
}

// Build explainability rows with driver, shortage, and governor context.
function buildExplainabilitySectionRows(state, governorSignals, shortages, resourceLabels) {
  const trace = getDecisionTrace(state);
  const currentGovernorSignals = governorSignals && typeof governorSignals === "object"
    ? governorSignals
    : getGovernorSignals(state);
  const traceShortages = trace.shortages.length > 0
    ? trace.shortages
    : (Array.isArray(shortages) ? shortages.slice(0, 2).map((entry) => ({
      resource: String(entry && entry.resource || ""),
      score: Math.max(0, Number(entry && entry.score || 0)),
      current: Math.max(0, Number(entry && entry.current || 0)),
      target: Math.max(0, Number(entry && entry.target || 0)),
      weight: Math.max(0, Number(entry && entry.weight || 0)),
      boostApplied: entry && entry.boostApplied === true,
      boostMultiplier: Math.max(1, Number(entry && entry.boostMultiplier || 1)),
    })).filter((entry) => entry.resource.length > 0) : []);

  const rows = [];
  rows.push(
    `Decision tick ${trace.tick}: jobs ${trace.governors.jobsSource}, trade ${trace.governors.tradeSource}, build ${trace.governors.buildingSource}`,
  );
  rows.push(formatExplainabilityDriversLine(trace.drivers, resourceLabels));
  rows.push(formatExplainabilityShortageLine(traceShortages, 0, resourceLabels));
  rows.push(formatExplainabilityShortageLine(traceShortages, 1, resourceLabels));
  rows.push(formatExplainabilityContextLine(trace.context));
  rows.push(formatExplainabilityTradeLine(trace.governors, currentGovernorSignals.trade));
  rows.push(formatExplainabilityBuildLine(trace.governors, currentGovernorSignals.building));
  rows.push(formatExplainabilityWorkloadLine(trace.jobs));
  return rows;
}

// Format ranked explainability drivers in one compact line.
function formatExplainabilityDriversLine(drivers, resourceLabels) {
  const ranked = Array.isArray(drivers) ? drivers.slice(0, 3) : [];
  if (ranked.length === 0) {
    return "Drivers: no dominant pressure detected";
  }
  const parts = ranked.map((entry) => {
    if (!entry || !entry.kind) {
      return null;
    }
    if (entry.kind === "shortage") {
      const label = String(entry.key || "").replace(/^shortage:/, "");
      const readable = getTelemetryResourceLabel(label, resourceLabels);
      return `${readable} ${Number(entry.score || 0).toFixed(2)}`;
    }
    const rawLabel = String(entry.label || entry.kind).trim();
    return `${rawLabel} ${Number(entry.score || 0).toFixed(2)}`;
  }).filter(Boolean);
  if (parts.length === 0) {
    return "Drivers: no dominant pressure detected";
  }
  return `Drivers: ${parts.join(" | ")}`;
}

// Format one shortage explainability line with stock/weight/boost context.
function formatExplainabilityShortageLine(shortages, index, resourceLabels) {
  const list = Array.isArray(shortages) ? shortages : [];
  const shortage = list[index];
  if (!shortage || !shortage.resource) {
    return index === 0
      ? "Shortage #1: none"
      : "Shortage #2: none";
  }
  const label = getTelemetryResourceLabel(shortage.resource, resourceLabels);
  const current = Math.max(0, Number(shortage.current || 0));
  const target = Math.max(0, Number(shortage.target || 0));
  const score = Math.max(0, Number(shortage.score || 0));
  const weight = Math.max(0, Number(shortage.weight || 0));
  const boost = shortage.boostApplied === true
    ? `, boost x${Math.max(1, Number(shortage.boostMultiplier || 1)).toFixed(2)}`
    : "";
  return `Shortage #${index + 1}: ${label} ${formatCompactNumber(current)}/${formatCompactNumber(target)} | score ${score.toFixed(2)} | w ${weight.toFixed(2)}${boost}`;
}

// Format world context line for explainability.
function formatExplainabilityContextLine(context) {
  const safeContext = context && typeof context === "object" ? context : {};
  const weather = String(safeContext.weather || "clear");
  const raid = safeContext.raidActive === true
    ? `raid active (${Math.max(0, Number(safeContext.raidTicksLeft || 0))}t)`
    : "raid idle";
  const worldEvent = safeContext.worldEventActive === true
    ? `${String(safeContext.worldEventLabel || "event")} (${Math.max(0, Number(safeContext.worldEventTicksLeft || 0))}t)`
    : "none";
  const festival = safeContext.festivalActive === true ? "on" : "off";
  return `Context: weather ${weather}, ${raid}, event ${worldEvent}, festival ${festival}`;
}

// Format trade-governor explainability line.
function formatExplainabilityTradeLine(governors, tradeGovernor) {
  const traceGovernors = governors && typeof governors === "object" ? governors : {};
  const source = traceGovernors.tradeSource === "action" ? "action" : "default";
  const reserve = formatSignedGovernorValue(traceGovernors.tradeReserveBias);
  const contest = clamp(Number(traceGovernors.tradeContestIntent || 0), 0, 1).toFixed(2);
  const opportunity = clamp(Number(traceGovernors.tradeOpportunityIntent || 0), 0, 1).toFixed(2);
  if (!tradeGovernor || tradeGovernor.enabled === false) {
    return `Trade explain (${source}): disabled`;
  }
  return `Trade explain (${source}): reserve ${reserve}, contest ${contest}, opp ${opportunity}`;
}

// Format building-governor explainability line.
function formatExplainabilityBuildLine(governors, buildingGovernor) {
  const traceGovernors = governors && typeof governors === "object" ? governors : {};
  const source = traceGovernors.buildingSource === "action" ? "action" : "default";
  if (!buildingGovernor || buildingGovernor.enabled === false) {
    return `Build explain (${source}): disabled`;
  }
  const classOrder = Array.isArray(traceGovernors.buildingClassOrder)
    ? traceGovernors.buildingClassOrder.slice(0, 2).join(">")
    : "";
  const rank = classOrder || "-";
  const mineBias = formatSignedGovernorValue(traceGovernors.buildMineBias);
  const upgradeBias = formatSignedGovernorValue(traceGovernors.buildUpgradeBias);
  return `Build explain (${source}): ${rank}, mine ${mineBias}, upgrade ${upgradeBias}`;
}

// Format workload summary line using traced job counts.
function formatExplainabilityWorkloadLine(jobs) {
  const safeJobs = jobs && typeof jobs === "object" ? jobs : {};
  const byType = safeJobs.byType && typeof safeJobs.byType === "object" ? safeJobs.byType : {};
  const total = Math.max(0, Number(safeJobs.total || 0));
  const topTypeEntries = Object.entries(byType)
    .map(([type, count]) => ({
      type: String(type || "other"),
      count: Math.max(0, Number(count || 0)),
    }))
    .sort((left, right) => right.count - left.count)
    .filter((entry) => entry.count > 0);
  if (topTypeEntries.length === 0) {
    return `Job load: ${total} active jobs`;
  }
  const top = topTypeEntries.slice(0, 2).map((entry) => `${entry.type} ${entry.count}`).join(", ");
  return `Job load: ${total} active jobs | top ${top}`;
}

// Format one jobs-governor line from top weighted resources.
function formatJobsGovernorLine(governor, resourceLabels) {
  const source = governor && governor.source === "action" ? "action" : "default";
  const top = governor && Array.isArray(governor.top) ? governor.top : [];
  const entries = top
    .slice(0, 2)
    .map((entry) => {
      const resourceId = String(entry && entry.resource || "");
      if (!resourceId) {
        return "";
      }
      const label = getTelemetryResourceLabel(resourceId, resourceLabels);
      const weight = Number(entry && entry.weight || 0);
      return `${label} x${weight.toFixed(2)}`;
    })
    .filter((value) => value.length > 0);
  if (entries.length === 0) {
    return `Jobs governor (${source}): -`;
  }
  return `Jobs governor (${source}): ${entries.join(", ")}`;
}

// Format one trade-governor line with normalized advisory intents.
function formatTradeGovernorLine(governor) {
  if (!governor || governor.enabled === false) {
    return "Trade governor: disabled";
  }
  const source = governor.source === "action" ? "action" : "default";
  const reserve = formatSignedGovernorValue(governor.reserveRatioBias);
  const contest = clamp(Number(governor.contestIntent || 0), 0, 1).toFixed(2);
  const opportunity = clamp(Number(governor.opportunityIntent || 0), 0, 1).toFixed(2);
  return `Trade governor (${source}): reserve ${reserve}, contest ${contest}, opp ${opportunity}`;
}

// Format one building-governor line with class rank and bounded biases.
function formatBuildingGovernorLine(governor) {
  if (!governor || governor.enabled === false) {
    return "Building governor: disabled";
  }
  const source = governor.source === "action" ? "action" : "default";
  const classOrder = Array.isArray(governor.classOrder)
    ? governor.classOrder.slice(0, 2).map((name) => String(name || "").trim()).filter(Boolean)
    : [];
  const rank = classOrder.length > 0 ? classOrder.join(">") : "-";
  const mineBias = formatSignedGovernorValue(governor.mineBias);
  const upgradeBias = formatSignedGovernorValue(governor.upgradeBias);
  return `Building governor (${source}): ${rank}, mine ${mineBias}, upgrade ${upgradeBias}`;
}

// Format a signed governor bias value with explicit sign.
function formatSignedGovernorValue(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return "0.00";
  }
  if (numeric > 0) {
    return `+${numeric.toFixed(2)}`;
  }
  if (numeric < 0) {
    return `-${Math.abs(numeric).toFixed(2)}`;
  }
  return "0.00";
}

// Format a top resource flow line from cumulative stats maps.
function formatMerchantFlowLine(prefix, amounts, resourceLabels) {
  const entries = Object.entries(amounts || {})
    .filter(([, amount]) => Number(amount || 0) > 0)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));
  if (entries.length === 0) {
    return `${prefix}: -`;
  }
  const [resourceId, amount] = entries[0];
  const label = getTelemetryResourceLabel(resourceId, resourceLabels);
  return `${prefix}: ${label} ${formatCompactNumber(amount)}`;
}

// Format compact contract win/loss record.
function formatContractRecordLine(stats) {
  const wins = Math.max(0, Number(stats && stats.successes || 0));
  const losses = Math.max(0, Number(stats && stats.failures || 0));
  return `Contract record: ${wins} successful, ${losses} failed`;
}

// Format contract success rate percentage.
function formatContractWinRateLine(stats) {
  const wins = Math.max(0, Number(stats && stats.successes || 0));
  const losses = Math.max(0, Number(stats && stats.failures || 0));
  const total = wins + losses;
  if (total <= 0) {
    return "Contract success rate: -";
  }
  const ratio = Math.round((wins / total) * 100);
  return `Contract success rate: ${ratio}%`;
}

// Format aggregate world-event counters for the diplomacy section.
function formatWorldEventStats(stats) {
  if (!stats || typeof stats !== "object") {
    return "World events summary: -";
  }
  const spawned = Math.max(0, Number(stats.spawned || 0));
  const completed = Math.max(0, Number(stats.completed || 0));
  const failed = Math.max(0, Number(stats.failed || 0));
  const expired = Math.max(0, Number(stats.expired || 0));
  return `World events summary: spawned ${spawned}, completed ${completed}, failed ${failed}, expired ${expired}`;
}

// Format world-event spawn ETA in ticks.
function formatWorldEventCadence(worldEventsState, tick) {
  if (!worldEventsState || typeof worldEventsState !== "object") {
    return "Next world event in: -";
  }
  const nextSpawnTick = Math.max(0, Number(worldEventsState.nextSpawnTick || 0));
  const nowTick = Math.max(0, Number(tick || 0));
  const eta = Math.max(0, nextSpawnTick - nowTick);
  return `Next world event in: ${eta} ticks`;
}

// Format active world-event line with status or ETA fallback.
function formatWorldEventLiveLine(status, worldEventsState, tick) {
  void worldEventsState;
  void tick;
  if (status && status.active === true) {
    const label = String(status.label || "Event");
    const ticks = Math.max(0, Number(status.ticksLeft || 0));
    if (status.phase === "offer") {
      return `Active world event: ${label} (${ticks} ticks left, offer pending)`;
    }
    return `Active world event: ${label} (${ticks} ticks left)`;
  }
  return "Active world event: none";
}

// Build a stable stockpile display order from config + runtime state.
function getStockpileDisplayOrder(state, config) {
  const configured = Object.keys((config.resources && config.resources.stockpile) || {});
  const runtime = Object.keys((state && state.stockpile) || {});
  const seen = new Set();
  const order = [];
  for (const id of configured.concat(runtime)) {
    const key = String(id || "");
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    order.push(key);
  }
  return order;
}

// Build stockpile telemetry entries with compact weapon/armor tier aggregation.
function buildStockpileTelemetryEntries(state, config, targets, resourceLabels, stockBarMax) {
  const order = getStockpileDisplayOrder(state, config);
  const entries = [];
  const weaponTierIds = [];
  const armorTierIds = [];
  let compactInsertIndex = -1;

  for (const id of order) {
    const tierInfo = parseEquipmentTierResourceId(id);
    if (tierInfo) {
      if (compactInsertIndex < 0) {
        compactInsertIndex = entries.length;
      }
      if (tierInfo.type === "weapon") {
        weaponTierIds.push(id);
      } else if (tierInfo.type === "armor") {
        armorTierIds.push(id);
      }
      continue;
    }
    entries.push(
      buildStockpileEntryForResource(state, config, targets, resourceLabels, stockBarMax, id),
    );
  }

  const compactEntries = [];
  if (weaponTierIds.length > 0) {
    compactEntries.push(
      buildCompactEquipmentStockpileEntry(state, config, "weapon", weaponTierIds),
    );
  }
  if (armorTierIds.length > 0) {
    compactEntries.push(
      buildCompactEquipmentStockpileEntry(state, config, "armor", armorTierIds),
    );
  }
  if (compactEntries.length > 0) {
    const insertAt = compactInsertIndex >= 0 ? compactInsertIndex : entries.length;
    entries.splice(insertAt, 0, ...compactEntries);
  }

  return entries;
}

// Build one standard stockpile telemetry entry from a single resource id.
function buildStockpileEntryForResource(state, config, targets, resourceLabels, stockBarMax, resourceId) {
  const count = Number(state && state.stockpile && state.stockpile[resourceId] || 0);
  const target = getStockpileTarget(state, config, resourceId, targets);
  const maxValue = stockBarMax > 0
    ? stockBarMax
    : Math.max(1, target, Math.round(count));
  const ratio = maxValue > 0 ? clamp(count / maxValue, 0, 1) : 0;
  const detail = formatCountDetail(count, maxValue);
  const label = getTelemetryResourceLabel(resourceId, resourceLabels);
  return { label, ratio, detail };
}

// Parse one equipment stockpile id and resolve tier metadata when applicable.
function parseEquipmentTierResourceId(resourceId) {
  const raw = String(resourceId || "").trim();
  const match = raw.match(/^(weapon|armor)_tier_(\d+)$/);
  if (!match) {
    return null;
  }
  return {
    type: String(match[1] || ""),
    tier: Math.max(1, Math.floor(Number(match[2] || 1))),
  };
}

// Resolve one compact stockpile entry for all tiers of one equipment type.
function buildCompactEquipmentStockpileEntry(state, config, type, resourceIds) {
  const normalizedType = String(type || "") === "armor" ? "armor" : "weapon";
  const sorted = resourceIds
    .slice()
    .sort((left, right) => {
      const leftTier = parseEquipmentTierResourceId(left);
      const rightTier = parseEquipmentTierResourceId(right);
      return Number(leftTier && leftTier.tier || 0) - Number(rightTier && rightTier.tier || 0);
    });

  let totalCount = 0;
  let highestTierWithStock = 0;
  let highestTierCount = 0;
  let minTier = Infinity;
  let maxTier = 0;
  for (const id of sorted) {
    const tierInfo = parseEquipmentTierResourceId(id);
    const tier = Math.max(1, Math.floor(Number(tierInfo && tierInfo.tier || 1)));
    const count = Math.max(0, Number(state && state.stockpile && state.stockpile[id] || 0));
    totalCount += count;
    minTier = Math.min(minTier, tier);
    maxTier = Math.max(maxTier, tier);
    if (count > 0 && tier >= highestTierWithStock) {
      highestTierWithStock = tier;
      highestTierCount = count;
    }
  }
  if (!Number.isFinite(minTier)) {
    minTier = 1;
  }
  if (maxTier <= 0) {
    maxTier = minTier;
  }

  const target = resolveEquipmentTypeStockTarget(config, normalizedType, sorted);
  const maxValue = Math.max(1, Math.round(Math.max(target, totalCount)));
  const ratio = maxValue > 0 ? clamp(totalCount / maxValue, 0, 1) : 0;
  const detailParts = [formatCountDetail(totalCount, maxValue)];
  if (highestTierWithStock > 0) {
    detailParts.push(`hiT${highestTierWithStock}:${formatCompactNumber(highestTierCount)}`);
  }
  return {
    label: normalizedType === "weapon"
      ? `Weapons T${minTier}-${maxTier}`
      : `Armor T${minTier}-${maxTier}`,
    ratio,
    detail: detailParts.join(" "),
  };
}

// Resolve total stock target for one equipment type from armory recipes.
function resolveEquipmentTypeStockTarget(config, type, resourceIds) {
  const armory = config && config.structures && config.structures.armory;
  const equipment = armory && armory.equipment;
  const recipes = equipment && equipment.recipes && typeof equipment.recipes === "object"
    ? equipment.recipes
    : {};
  let total = 0;
  for (const id of resourceIds) {
    const recipe = recipes[id];
    const recipeType = String(recipe && recipe.type || "").trim();
    if (recipeType !== type) {
      continue;
    }
    total += Math.max(0, Number(recipe.max_stock || 0));
  }
  if (total > 0) {
    return total;
  }
  return 0;
}

// Build operations lines for workforce, job mix, and stockpile deltas.
function buildOperationsSectionRows(
  state,
  config,
  shortages,
  resourceLabels,
  templeJob,
  governorSignals,
) {
  const jobs = Array.isArray(state.jobs) ? state.jobs : [];
  const workforce = getWorkforceCounts(state.dwarves || []);
  const jobCounts = countJobTypes(jobs);
  const tools = state && state.tools ? state.tools : null;
  const toolsLevel = tools
    ? Math.max(1, Math.round(Number(tools.level || 1)))
    : 0;
  const toolsMax = tools
    ? Math.max(1, Math.round(Number(tools.maxLevel || 1)))
    : 0;
  const stockWindow = getStockpileWindowDelta(
    state,
    200,
    ["food", "water", "beer", "wood", "stone", "iron"],
  );
  const delta = stockWindow.deltas || {};
  const windowLabel = `${stockWindow.dt}-tick window`;
  const templeActive = templeJob ? 1 : 0;

  return [
    `Workforce (adults): idle ${workforce.idle}, assigned ${workforce.job}, underrealm duty ${workforce.under}, expeditions ${workforce.exped}`,
    `Active jobs by type: gathering ${jobCounts.gather}, crafting ${jobCounts.craft}, building ${jobCounts.build}, mining ${jobCounts.mine}`,
    `Operations queue: brewery ${jobCounts.brewery}, hunting ${jobCounts.hunt}, upgrades ${jobCounts.upgrade}, other ${jobCounts.other}`,
    `Build pipeline status: build jobs ${jobCounts.build}, upgrade jobs ${jobCounts.upgrade}, temple job active ${templeActive > 0 ? "yes" : "no"}`,
    tools ? `Tool upgrades: level ${toolsLevel}/${toolsMax} | Active jobs total: ${jobs.length}` : `Tool upgrades: - | Active jobs total: ${jobs.length}`,
    `Stockpile trend (${windowLabel}) core: food ${formatSignedDelta(delta.food)}, water ${formatSignedDelta(delta.water)}, beer ${formatSignedDelta(delta.beer)}`,
    `Stockpile trend (${windowLabel}) build: wood ${formatSignedDelta(delta.wood)}, stone ${formatSignedDelta(delta.stone)}, iron ${formatSignedDelta(delta.iron)}`,
    formatShortageCompact(shortages, 0, state, config, resourceLabels),
    formatBuildingGovernorLine(governorSignals && governorSignals.building),
    `Total shortage pressure: ${formatShortageHeat(shortages)}`,
    formatOpsLoadLine(jobCounts, jobs.length),
  ];
}

// Count adult workforce slots by current assignment type.
function getWorkforceCounts(dwarves) {
  const counts = { idle: 0, job: 0, under: 0, exped: 0 };
  const list = Array.isArray(dwarves) ? dwarves : [];
  for (const dwarf of list) {
    if (!dwarf || dwarf.lifeStage !== "adult") {
      continue;
    }
    const underrealmDutyActive = Boolean(
      dwarf.underrealmDuty
      && dwarf.underrealmDuty.active !== false
      && Number(dwarf.underrealmDuty.depth || 0) > 0,
    );
    if (underrealmDutyActive) {
      counts.under += 1;
      continue;
    }
    if (dwarf.expedition) {
      counts.exped += 1;
      continue;
    }
    if (dwarf.job) {
      counts.job += 1;
      continue;
    }
    counts.idle += 1;
  }
  return counts;
}

// Count active jobs by operational category.
function countJobTypes(jobs) {
  const counts = {
    gather: 0,
    craft: 0,
    build: 0,
    mine: 0,
    brewery: 0,
    hunt: 0,
    upgrade: 0,
    other: 0,
  };
  const list = Array.isArray(jobs) ? jobs : [];
  for (const job of list) {
    const type = job && job.type ? String(job.type) : "";
    if (type === "gather") {
      counts.gather += 1;
      continue;
    }
    if (type === "craft") {
      counts.craft += 1;
      continue;
    }
    if (type === "build") {
      counts.build += 1;
      continue;
    }
    if (type === "mine") {
      counts.mine += 1;
      continue;
    }
    if (type === "brewery") {
      counts.brewery += 1;
      continue;
    }
    if (type === "hunt") {
      counts.hunt += 1;
      continue;
    }
    if (type === "upgrade" || type === "upgrade_tools" || type === "upgrade_structure") {
      counts.upgrade += 1;
      continue;
    }
    counts.other += 1;
  }
  return counts;
}

// Compute stockpile deltas over a rolling window of ticks for telemetry observability.
function getStockpileWindowDelta(state, windowTicks, resourceIds) {
  const tick = Math.max(0, Number(state && state.tick || 0));
  const resources = Array.isArray(resourceIds) ? resourceIds : [];
  const snapshot = {};
  for (const id of resources) {
    snapshot[id] = Number(state && state.stockpile && state.stockpile[id] || 0);
  }
  if (!state || typeof state !== "object") {
    return { dt: 1, deltas: snapshot };
  }
  if (!state.renderState || typeof state.renderState !== "object") {
    state.renderState = {};
  }
  if (!Array.isArray(state.renderState.telemetryStockHistory)) {
    state.renderState.telemetryStockHistory = Array.isArray(
      state.renderState.hudStockHistory,
    )
      ? state.renderState.hudStockHistory
      : [];
  }
  const history = state.renderState.telemetryStockHistory;
  const last = history[history.length - 1];
  if (last && Number(last.tick || 0) > tick) {
    history.length = 0;
  }
  if (!last || Number(last.tick || 0) !== tick) {
    history.push({ tick, stockpile: snapshot });
  } else {
    last.stockpile = snapshot;
  }

  const window = Math.max(1, Math.floor(Number(windowTicks || 1)));
  const minTick = Math.max(0, tick - window);
  while (history.length > 2 && Number(history[1].tick || 0) <= minTick) {
    history.shift();
  }
  const baseline = history[0] || { tick, stockpile: snapshot };
  const dt = Math.max(1, tick - Number(baseline.tick || tick));
  const deltas = {};
  for (const id of resources) {
    const before = Number((baseline.stockpile || {})[id] || 0);
    const now = Number(snapshot[id] || 0);
    deltas[id] = now - before;
  }
  return { dt, deltas };
}

// Format signed delta values in compact k/m notation.
function formatSignedDelta(value) {
  const numeric = Math.round(Number(value || 0));
  if (numeric > 0) {
    return `+${formatCompactNumber(numeric)}`;
  }
  if (numeric < 0) {
    return `-${formatCompactNumber(Math.abs(numeric))}`;
  }
  return "0";
}

// Format aggregate shortage heat across top priorities.
function formatShortageHeat(shortages) {
  const list = Array.isArray(shortages) ? shortages : [];
  if (list.length === 0) {
    return "0.00";
  }
  let total = 0;
  for (const shortage of list) {
    total += Math.max(0, Number(shortage && shortage.score || 0));
  }
  return total.toFixed(2);
}

// Format production-vs-infrastructure load split for operations.
function formatOpsLoadLine(jobCounts, totalJobs) {
  const counts = jobCounts && typeof jobCounts === "object" ? jobCounts : {};
  const total = Math.max(0, Number(totalJobs || 0));
  const production = Math.max(0, Number(counts.gather || 0))
    + Math.max(0, Number(counts.craft || 0))
    + Math.max(0, Number(counts.mine || 0))
    + Math.max(0, Number(counts.brewery || 0))
    + Math.max(0, Number(counts.hunt || 0));
  const infra = Math.max(0, Number(counts.build || 0))
    + Math.max(0, Number(counts.upgrade || 0));
  const other = Math.max(0, total - production - infra);
  return `Workload split: production ${production}, infrastructure ${infra}, other ${other}`;
}

// Build a lore section with explicit myth and ruins summaries.
function buildLoreSectionRows(state, config, columnWidth, options = {}) {
  const includeRuins = options.includeRuins !== false;
  const includeMyths = options.includeMyths !== false;
  const mythsConfig = (config && config.myths) || {};
  const myths = state && state.myths ? state.myths : {};
  const mythDefs = mythsConfig.definitions || {};
  const activeCount = Object.keys(myths.active || {}).length;
  const maxActive = Math.max(0, Number(mythsConfig.maxActive || 0));
  const traditionsCount = Object.keys(myths.traditions || {}).length;
  const maxTraditions = Math.max(0, Number(mythsConfig.maxTraditions || 0));
  const mythBonusParts = includeMyths && mythsConfig.enabled !== false
    ? getMythBonusParts(state, config)
    : [];
  const activeNames = includeMyths && mythsConfig.enabled !== false
    ? getLoreMythNames(myths.active, mythDefs)
    : [];
  const traditionNames = includeMyths && mythsConfig.enabled !== false
    ? getLoreMythNames(myths.traditions, mythDefs)
    : [];

  const ruinsLines = includeRuins
    ? buildRuinsTelemetryLines(state, config, columnWidth)
    : [];
  const roomsLine = compactLoreRuinsLine(
    findLineByPrefix(ruinsLines, ["Rooms:"], "Rooms: -"),
    "Ruins rooms explored",
  );
  const expeditionLine = compactLoreRuinsLine(
    findLineByPrefix(ruinsLines, ["Expeditions:", "Expedition:"], "Expedition: -"),
    "Ruins expedition status",
  );
  const artifactsLine = compactLoreRuinsLine(
    findLineByPrefix(ruinsLines, ["Artifacts:"], "Artifacts: -"),
    "Ruins artifacts found",
  );
  const bonusLine = compactLoreRuinsLine(
    findLineByPrefix(ruinsLines, ["Bonus:", "Combos:", "Kits:"], "Bonus: -"),
    "Ruins bonus summary",
  );

  return [
    includeMyths && mythsConfig.enabled !== false
      ? `Active myths: ${activeCount}${maxActive > 0 ? `/${maxActive}` : ""}`
      : "Myths: off",
    includeMyths && mythsConfig.enabled !== false
      ? `Active traditions: ${traditionsCount}${maxTraditions > 0 ? `/${maxTraditions}` : ""}`
      : "Traditions: off",
    `Primary active myth: ${activeNames[0] || "-"}`,
    `Secondary active myth: ${activeNames[1] || "-"}`,
    `Primary tradition: ${traditionNames[0] || "-"}`,
    `Primary myth bonus: ${mythBonusParts[0] || "-"}`,
    `Secondary myth bonus: ${mythBonusParts[1] || "-"}`,
    roomsLine,
    expeditionLine,
    artifactsLine,
    bonusLine,
  ];
}

// Build myth labels for lore rows.
function getLoreMythNames(entries, definitions) {
  const ids = Object.keys(entries || {});
  const names = [];
  for (const mythId of ids) {
    const def = definitions && definitions[mythId] ? definitions[mythId] : {};
    const label = def.label || mythId;
    names.push(String(label));
  }
  return names;
}

// Compact ruins lore line prefixes to reduce telemetry noise.
function compactLoreRuinsLine(line, prefix) {
  const text = String(line || "").trim();
  if (!text || text === "-") {
    return `${prefix}: -`;
  }
  const colon = text.indexOf(":");
  if (colon >= 0 && colon + 1 < text.length) {
    return `${prefix}: ${text.slice(colon + 1).trim()}`;
  }
  return `${prefix}: ${text}`;
}

// Build telemetry lines for ruins exploration progress.
function buildRuinsTelemetryLines(state, config, columnWidth) {
  const ruinsConfig = config.ruins || {};
  if (ruinsConfig.enabled === false) {
    return [];
  }
  const ruins = state.ruins;
  if (!ruins) {
    return [];
  }
  const rooms = Array.isArray(ruinsConfig.rooms) ? ruinsConfig.rooms : [];
  if (rooms.length === 0) {
    return [];
  }

  const lines = [];
  const cleared = Math.max(0, Number(ruins.roomsCleared || 0));
  const allArtifacts = areAllArtifactsFound(ruins, ruinsConfig);
  lines.push(`Rooms: ${cleared}/${rooms.length}`);

  const expeditionConfig = ruinsConfig.expedition || {};
  const repeatable = cleared >= rooms.length && !allArtifacts;
  const maxConcurrentAfterClear = Math.max(
    1,
    Math.floor(Number(expeditionConfig.maxConcurrentAfterClear || 1)),
  );
  let expeditions = Array.isArray(ruins.expeditions) ? ruins.expeditions : [];
  if (expeditions.length === 0 && ruins.expedition && ruins.expedition.active) {
    expeditions = [ruins.expedition];
  }
  expeditions = expeditions.filter(
    (expedition) => expedition && expedition.active !== false,
  );

  if (expeditions.length > 0) {
    if (repeatable) {
      lines.push(`Expeditions: ${expeditions.length}/${maxConcurrentAfterClear} active`);
      const maxLines = Math.min(expeditions.length, maxConcurrentAfterClear);
      for (let index = 0; index < maxLines; index += 1) {
        const expedition = expeditions[index];
        const roomNumber = Math.max(1, Number(expedition.roomIndex || 0) + 1);
        const ticks = Math.max(
          0,
          Math.floor(Number(expedition.ticksRemaining || 0)),
        );
        const partySize = Array.isArray(expedition.dwarfIds)
          ? expedition.dwarfIds.length
          : 0;
        lines.push(`Expedition ${index + 1}: room ${roomNumber}, ${ticks} ticks left, party size ${partySize}`);
      }
    } else {
      const expedition = expeditions[0];
      const roomNumber = Math.max(1, Number(expedition.roomIndex || 0) + 1);
      const ticks = Math.max(
        0,
        Math.floor(Number(expedition.ticksRemaining || 0)),
      );
      const partySize = Array.isArray(expedition.dwarfIds)
        ? expedition.dwarfIds.length
        : 0;
      lines.push(`Expedition: room ${roomNumber}, ${ticks} ticks left, party size ${partySize}`);
    }
  } else if (!repeatable && Number(ruins.cooldown || 0) > 0) {
    lines.push(`Expedition: cooldown ${Math.floor(Number(ruins.cooldown || 0))} ticks`);
  } else if (cleared >= rooms.length && allArtifacts) {
    lines.push("Expedition: complete");
  } else if (cleared >= rooms.length) {
    lines.push(
      repeatable ? "Expeditions: repeatable" : "Expedition: repeatable",
    );
  } else {
    lines.push("Expedition: ready");
  }

  const kitResource = expeditionConfig.kitResource || "expedition_kit";
  const kits = Number(state.stockpile[kitResource] || 0);
  lines.push(`Expedition kits in stock: ${formatCompactNumber(kits)}`);
  const readinessGate = ruins.readinessGate && typeof ruins.readinessGate === "object"
    ? ruins.readinessGate
    : null;
  if (readinessGate && Number(readinessGate.depth || 0) > 0) {
    lines.push(formatRuinsReadinessGateLine(readinessGate));
  }
  for (const line of buildRuinsReadinessCounterLines(state, columnWidth)) {
    lines.push(line);
  }

  const artifactLines = buildArtifactProgressLines(
    ruins,
    ruinsConfig,
    columnWidth,
  );
  for (const line of artifactLines) {
    lines.push(line);
  }

  const bonusLines = buildRuinsBonusLines(ruins, columnWidth);
  for (const line of bonusLines) {
    lines.push(line);
  }

  return lines;
}

function buildRuinsTelemetrySection(state, config, width) {
  const lines = buildRuinsTelemetryLines(state, config, width);
  if (lines.length === 0) {
    return [];
  }
  const colors = getColorConfig(config);
  const header = applyColor("Ancient Dwarven Ruins", "hud_header", colors);
  return [header, ...lines];
}

function buildArtifactProgressLines(ruins, ruinsConfig, columnWidth) {
  const sets =
    ruinsConfig.artifacts && ruinsConfig.artifacts.sets
      ? ruinsConfig.artifacts.sets
      : {};
  const entries = [];
  for (const [setId, def] of Object.entries(sets)) {
    const total = Array.isArray(def.artifacts) ? def.artifacts.length : 0;
    if (total <= 0) {
      continue;
    }
    const count = Math.max(0, Number((ruins.setCounts || {})[setId] || 0));
    const name = def.name || setId;
    entries.push(`${name} ${count}/${total}`);
  }
  if (entries.length === 0) {
    return [];
  }
  const line = `Artifacts: ${entries.join(" ")}`;
  return wrapLine(line, columnWidth);
}

function areAllArtifactsFound(ruins, ruinsConfig) {
  const pool = (ruinsConfig.artifacts && ruinsConfig.artifacts.pool) || {};
  const entries = Object.keys(pool);
  if (entries.length === 0) {
    return true;
  }
  const found = ruins.artifactsFound || {};
  for (const id of entries) {
    if (!found[id]) {
      return false;
    }
  }
  return true;
}

function buildRuinsBonusLines(ruins, columnWidth) {
  const bonuses = ruins.bonuses || {};
  const parts = [];
  const output = Math.max(0, Number(bonuses.outputMultiplier || 0));
  const hazard = Math.max(0, Number(bonuses.hazardReduction || 0));
  const combat = Math.max(0, Number(bonuses.combatBonus || 0));
  const drop = Math.max(0, Number(bonuses.artifactChanceBonus || 0));
  const loss = Math.max(0, Number(bonuses.casualtyReduction || 0));

  if (output > 0) {
    parts.push(`production output +${Math.round(output * 100)}%`);
  }
  if (hazard > 0) {
    parts.push(`hazard risk -${Math.round(hazard * 100)}%`);
  }
  if (combat > 0) {
    parts.push(`combat strength +${Math.round(combat * 100)}%`);
  }
  if (drop > 0) {
    parts.push(`artifact drop chance +${Math.round(drop * 100)}%`);
  }
  if (loss > 0) {
    parts.push(`casualty losses -${Math.round(loss * 100)}%`);
  }

  const lines = [];
  if (parts.length > 0) {
    for (const line of wrapLine(`Bonus: ${parts.join(" ")}`, columnWidth)) {
      lines.push(line);
    }
  }

  const combos = Array.isArray(bonuses.activeCombos)
    ? bonuses.activeCombos
    : [];
  if (combos.length > 0) {
    for (const line of wrapLine(`Combos: ${combos.join(", ")}`, columnWidth)) {
      lines.push(line);
    }
  }

  return lines;
}

// Format one compact readiness gate line for ruins expedition telemetry.
function formatRuinsReadinessGateLine(readinessGate) {
  const depth = Math.max(1, Math.floor(Number(readinessGate.depth || 1)));
  const status = String(readinessGate.status || "unknown");
  const score = Math.max(0, Number(readinessGate.score || 0)).toFixed(1);
  const minScore = Math.max(0, Number(readinessGate.minScore || 0)).toFixed(1);
  const recommended = Math.max(minScore, Number(readinessGate.recommendedScore || 0)).toFixed(1);
  if (status === "blocked") {
    if (readinessGate.reason === "armory_level") {
      const level = Math.max(0, Math.floor(Number(readinessGate.armoryLevel || 0)));
      const required = Math.max(1, Math.floor(Number(readinessGate.minArmoryLevel || 1)));
      return `Readiness gate: D${depth} BLOCKED armory ${level}/${required}`;
    }
    if (readinessGate.reason === "warning_deep_guard") {
      const threshold = Math.max(
        0,
        Number(readinessGate.warningDeepGuardThreshold || recommended),
      ).toFixed(1);
      return `Readiness gate: D${depth} BLOCKED deep guard ${score}/${threshold}`;
    }
    if (readinessGate.reason === "champion_cooldown") {
      const cooldown = Math.max(0, Math.floor(Number(readinessGate.championCooldownTicks || 0)));
      return `Readiness gate: D${depth} BLOCKED champion cd ${cooldown}t`;
    }
    return `Readiness gate: D${depth} BLOCKED score ${score}/${minScore}`;
  }
  if (status === "warning") {
    const risk = Math.max(1, Number(readinessGate.warningRiskMultiplier || 1)).toFixed(2);
    return `Readiness gate: D${depth} warning score ${score}/${recommended} risk x${risk}`;
  }
  return `Readiness gate: D${depth} ready score ${score}/${recommended}`;
}

// Resolve compact Underrealm readiness counter snapshot from combat stats.
function getRuinsReadinessCounterSnapshot(state) {
  const stats = state
    && state.underrealm
    && state.underrealm.combat
    && state.underrealm.combat.stats
    && typeof state.underrealm.combat.stats === "object"
    ? state.underrealm.combat.stats
    : null;
  if (!stats) {
    return null;
  }
  return {
    hardGuardBlocks: Math.max(0, Math.floor(Number(stats.hardGuardBlocks || 0))),
    warningDispatches: Math.max(0, Math.floor(Number(stats.warningDispatches || 0))),
    cooldownEscalations: Math.max(0, Math.floor(Number(stats.cooldownEscalations || 0))),
    hardGuardBlocksByDepth: stats.hardGuardBlocksByDepth || {},
    warningDispatchesByDepth: stats.warningDispatchesByDepth || {},
    cooldownEscalationsByDepth: stats.cooldownEscalationsByDepth || {},
  };
}

// Render one compact per-depth counter map (`D<depth>:<count>`).
function formatRuinsDepthCounterMap(counterMap, maxEntries = 3) {
  const entries = Object.entries(counterMap && typeof counterMap === "object" ? counterMap : {})
    .map(([depthRaw, countRaw]) => ({
      depth: Math.max(1, Math.floor(Number(depthRaw || 0))),
      count: Math.max(0, Math.floor(Number(countRaw || 0))),
    }))
    .filter((entry) => entry.depth > 0 && entry.count > 0)
    .sort((left, right) => (right.count - left.count) || (left.depth - right.depth));
  if (entries.length === 0) {
    return "-";
  }
  return entries
    .slice(0, Math.max(1, Math.floor(Number(maxEntries || 1))))
    .map((entry) => `D${entry.depth}:${entry.count}`)
    .join(" ");
}

// Build compact readiness counter lines for long-run underrealm diagnostics.
function buildRuinsReadinessCounterLines(state, columnWidth) {
  const snapshot = getRuinsReadinessCounterSnapshot(state);
  if (!snapshot) {
    return [];
  }
  const hasAny = snapshot.hardGuardBlocks > 0
    || snapshot.warningDispatches > 0
    || snapshot.cooldownEscalations > 0;
  if (!hasAny) {
    return [];
  }
  const lines = [];
  const totalsLine = `Readiness counters: hard guard ${snapshot.hardGuardBlocks} | warning dispatch ${snapshot.warningDispatches} | cooldown esc ${snapshot.cooldownEscalations}`;
  for (const line of wrapLine(totalsLine, columnWidth)) {
    lines.push(line);
  }
  const depthLine = `Readiness by depth: guard ${formatRuinsDepthCounterMap(snapshot.hardGuardBlocksByDepth)} | warning ${formatRuinsDepthCounterMap(snapshot.warningDispatchesByDepth)} | cdEsc ${formatRuinsDepthCounterMap(snapshot.cooldownEscalationsByDepth)}`;
  for (const line of wrapLine(depthLine, columnWidth)) {
    lines.push(line);
  }
  return lines;
}

// Resolve one Underrealm combat floor snapshot by depth.
function getUnderrealmCombatFloor(underrealm, depth) {
  const combat = underrealm && underrealm.combat;
  const floors = combat && combat.floorsByDepth && typeof combat.floorsByDepth === "object"
    ? combat.floorsByDepth
    : null;
  if (!floors) {
    return null;
  }
  const safeDepth = Math.max(1, Math.floor(Number(depth || 1)));
  return floors[String(safeDepth)] || floors[safeDepth] || null;
}

// Resolve dwarf-champion runtime metadata from Underrealm combat state.
function getUnderrealmDwarfChampionRuntime(underrealm) {
  const combat = underrealm && underrealm.combat;
  const runtime = combat && combat.dwarfChampion && typeof combat.dwarfChampion === "object"
    ? combat.dwarfChampion
    : null;
  if (!runtime || runtime.enabled === false) {
    return null;
  }
  return runtime;
}

// Format compact dwarf-champion status token for Underrealm champion-gate row.
function formatUnderrealmDwarfChampionToken(state, underrealm) {
  const runtime = getUnderrealmDwarfChampionRuntime(underrealm);
  if (!runtime) {
    return "Hero off";
  }
  const dwarfId = typeof runtime.activeDwarfId === "string" ? runtime.activeDwarfId : "";
  if (!dwarfId) {
    return "Hero none";
  }
  const dwarf = Array.isArray(state && state.dwarves)
    ? state.dwarves.find((entry) => String(entry && entry.id || "") === dwarfId)
    : null;
  if (!dwarf) {
    return "Hero none";
  }
  const survivals = Math.max(0, Math.floor(Number(dwarf.underrealmChampionSurvivals || 0)));
  return `Hero ${dwarfId} S${survivals}`;
}

// Build a compact progression status line for the current frontier depth.
function formatUnderrealmProgressionLine(underrealm, frontierLayer, maxUnlockedDepth, maxDepth) {
  if (maxDepth <= 0) {
    return "Depth progression: unavailable";
  }
  if (maxUnlockedDepth <= 0) {
    return "Depth progression: gate locked";
  }
  if (maxUnlockedDepth >= maxDepth) {
    return `Depth progression: D${maxDepth} max unlocked`;
  }

  const lift = underrealm && underrealm.lift ? underrealm.lift : null;
  if (lift && lift.active === true) {
    const totalTicks = Math.max(1, Number(lift.totalTicks || 1));
    const remainingTicks = Math.max(0, Number(lift.ticksRemaining || 0));
    const pct = Math.max(0, Math.min(100, Math.round((1 - remainingTicks / totalTicks) * 100)));
    return `Depth progression: lift D${lift.fromDepth}->D${lift.targetDepth} ${pct}%`;
  }

  const frontierFloor = getUnderrealmCombatFloor(underrealm, maxUnlockedDepth);
  const championRequired = Boolean(
    frontierFloor
    && frontierFloor.unlock
    && frontierFloor.unlock.required === true
    && frontierFloor.champion
    && frontierFloor.champion.enabled !== false,
  );
  const championCleared = Boolean(
    frontierFloor
    && frontierFloor.unlock
    && frontierFloor.unlock.cleared === true,
  );
  if (championRequired && !championCleared) {
    return `Depth progression: D${maxUnlockedDepth + 1} locked by champion`;
  }

  if (frontierLayer && frontierLayer.economy) {
    const progress = Math.max(0, Number(frontierLayer.economy.explorationProgress || 0));
    const target = Math.max(0, Number(frontierLayer.economy.explorationTarget || 0));
    if (target > 0) {
      const pct = Math.min(100, Math.round((progress / target) * 100));
      return `Depth progression: D${maxUnlockedDepth} survey ${pct}%`;
    }
  }

  return `Depth progression: D${maxUnlockedDepth}->D${maxUnlockedDepth + 1} pending`;
}

// Build a compact champion-gate status line for the frontier depth.
function formatUnderrealmChampionGateLine(state, underrealm, frontierDepth) {
  const combat = underrealm && underrealm.combat;
  const heroToken = formatUnderrealmDwarfChampionToken(state, underrealm);
  if (!combat || combat.enabled === false) {
    return `Champion gate: off | ${heroToken}`;
  }
  if (frontierDepth <= 0) {
    return `Champion gate: unavailable | ${heroToken}`;
  }
  const floor = getUnderrealmCombatFloor(underrealm, frontierDepth);
  if (!floor) {
    return `Champion gate: D${frontierDepth} missing | ${heroToken}`;
  }
  const championRequired = Boolean(
    floor.unlock
    && floor.unlock.required === true
    && floor.champion
    && floor.champion.enabled !== false,
  );
  if (!championRequired) {
    return `Champion gate: D${frontierDepth} bypassed | ${heroToken}`;
  }

  const encounter = floor.encounter && typeof floor.encounter === "object"
    ? floor.encounter
    : {};
  const attempts = Math.max(0, Math.floor(Number(encounter.attempts || 0)));
  const wins = Math.max(0, Math.floor(Number(encounter.victories || 0)));
  const defeats = Math.max(0, Math.floor(Number(encounter.defeats || 0)));
  const retreats = Math.max(0, Math.floor(Number(encounter.retreats || 0)));
  const cooldown = Math.max(0, Math.floor(Number(encounter.cooldownTicksRemaining || 0)));
  const cleared = floor.unlock && floor.unlock.cleared === true;
  const stateLabel = cleared ? "cleared" : String(floor.state || "accessible");

  if (cooldown > 0 && !cleared) {
    return `Champion gate: D${frontierDepth} ${stateLabel} cd${cooldown} W${wins}D${defeats}R${retreats} | ${heroToken}`;
  }
  if (cleared) {
    return `Champion gate: D${frontierDepth} cleared W${wins}/A${attempts} | ${heroToken}`;
  }
  return `Champion gate: D${frontierDepth} ${stateLabel} W${wins}D${defeats}R${retreats} | ${heroToken}`;
}

// Build readiness fallback from frontier floor when ruins gate snapshot is unavailable.
function formatUnderrealmReadinessFallbackLine(underrealm, frontierDepth) {
  const combat = underrealm && underrealm.combat;
  if (!combat || combat.enabled === false || frontierDepth <= 0) {
    return "Readiness gate: -";
  }
  const floor = getUnderrealmCombatFloor(underrealm, frontierDepth);
  if (!floor) {
    return `Readiness gate: D${frontierDepth} unavailable`;
  }
  const minScore = Math.max(
    0,
    Number(floor.readiness && floor.readiness.minScore || 0),
  ).toFixed(1);
  const recommendedValue = Math.max(
    Number(minScore),
    Number(floor.readiness && floor.readiness.recommendedScore || minScore),
  );
  const recommended = Number.isFinite(recommendedValue)
    ? recommendedValue.toFixed(1)
    : minScore;
  const minArmory = Math.max(1, Math.floor(Number(floor.minArmoryLevel || 1)));
  return `Readiness gate: D${frontierDepth} min ${minScore}/${recommended} armory ${minArmory}`;
}

// Build a compact pressure line from ward/oath status and deep hostile activity.
function formatUnderrealmPressureLine(underrealm, activeDepth, activeRaidCount) {
  const parts = [];
  if (activeDepth > 0 && underrealm && underrealm.shrines) {
    const depthKey = String(activeDepth);
    const charges = Math.max(
      0,
      Number(
        underrealm.shrines.wardChargesByDepth
        && underrealm.shrines.wardChargesByDepth[depthKey],
      ),
    );
    parts.push(`ward ${Math.floor(charges)}`);
    const oath = underrealm.shrines.oathByDepth && underrealm.shrines.oathByDepth[depthKey];
    if (oath && Number(oath.activeTicks || 0) > 0) {
      parts.push(`oath active ${Math.floor(Number(oath.activeTicks || 0))}t`);
    } else if (oath && Number(oath.penaltyTicks || 0) > 0) {
      parts.push(`oath unrest ${Math.floor(Number(oath.penaltyTicks || 0))}t`);
    } else {
      parts.push("oath idle");
    }
  }
  parts.push(`threats ${Math.max(0, Math.floor(Number(activeRaidCount || 0)))}`);
  return `Underrealm pressure: ${parts.join(" | ")}`;
}

// Build underrealm status lines for the dedicated Underrealm telemetry section.
function getUnderrealmTelemetryLines(state) {
  const underrealm = state && state.underrealm;
  if (!underrealm || underrealm.enabled === false) {
    return [];
  }
  const maxDepth = Math.max(0, Math.floor(Number(underrealm.maxDepth || 0)));
  const maxUnlockedDepth = clamp(
    Math.floor(Number(underrealm.maxUnlockedDepth || 0)),
    0,
    maxDepth,
  );
  const activeDepth = clamp(
    Math.floor(Number(underrealm.activeDepth || 0)),
    0,
    maxUnlockedDepth,
  );
  const lines = [];
  if (activeDepth <= 0) {
    lines.push(`Realm: Surface view (unlocked depths ${maxUnlockedDepth}/${maxDepth})`);
  } else {
    lines.push(`Realm: Underrealm depth ${activeDepth} (unlocked depths ${maxUnlockedDepth}/${maxDepth})`);
  }
  const frontierDepth = clamp(maxUnlockedDepth, 0, maxDepth);
  const layers = Array.isArray(underrealm.layers) ? underrealm.layers : [];
  const frontierLayer = layers.find((layer) => Number(layer && layer.depth) === frontierDepth);
  const discovery = underrealm.discovery || null;
  if (maxUnlockedDepth <= 0 && discovery && discovery.enabled !== false && discovery.found !== true) {
    const threshold = Math.max(1, Math.floor(Number(discovery.populationThreshold || 1)));
    const nowPopulation = Array.isArray(state.dwarves) ? state.dwarves.length : 0;
    const timerStartedTick = discovery.timerStartedTick;
    const hasTimerStarted = typeof timerStartedTick === 'number'
      && Number.isFinite(timerStartedTick);
    if (!hasTimerStarted) {
      lines.push(`Hidden gate: waiting for population ${nowPopulation}/${threshold}`);
    } else {
      const targetTick = Math.max(0, Math.floor(Number(discovery.targetTick || 0)));
      const eta = Math.max(0, targetTick - Math.floor(Number(state.tick || 0)));
      lines.push(`Hidden gate search time: ${eta} ticks remaining`);
    }
  } else if (discovery && discovery.enabled !== false && discovery.found === true) {
    lines.push('Hidden gate: discovered');
  }
  lines.push(
    formatUnderrealmProgressionLine(
      underrealm,
      frontierLayer,
      maxUnlockedDepth,
      maxDepth,
    ),
  );
  lines.push(formatUnderrealmChampionGateLine(state, underrealm, frontierDepth));

  const activeLayer = layers.find((layer) => Number(layer && layer.depth) === activeDepth);
  if (activeLayer) {
    lines.push(
      `Strata: ${activeLayer.width}x${activeLayer.height}`
      + ` | difficulty ${formatMultiplierPercent(activeLayer.difficultyMultiplier)}`
      + ` | rare drops ${formatMultiplierPercent(activeLayer.rareDropMultiplier)}`,
    );
    if (activeLayer.economy && Array.isArray(activeLayer.economy.nodes)) {
      const nodes = activeLayer.economy.nodes;
      let remaining = 0;
      let capacity = 0;
      for (const node of nodes) {
        remaining += Math.max(0, Number(node.remaining || 0));
        capacity += Math.max(0, Number(node.capacity || 0));
      }
      if (capacity > 0) {
        const pct = Math.round((remaining / capacity) * 100);
        lines.push(`Depth stock reserves: ${pct}% (${formatCompactNumber(remaining)}/${formatCompactNumber(capacity)})`);
      }
      const progress = Math.max(0, Number(activeLayer.economy.explorationProgress || 0));
      const target = Math.max(0, Number(activeLayer.economy.explorationTarget || 0));
      if (target > 0 && activeDepth === maxUnlockedDepth && maxUnlockedDepth < maxDepth) {
        lines.push(`Depth survey progress: ${Math.min(100, Math.round(progress / target * 100))}%`);
      }
    }
  }
  const crew = underrealm.crew || null;
  if (crew && crew.enabled !== false) {
    const roles = crew.roles || {};
    lines.push(
      `Delver role ratios: M${Math.round(clamp(Number(roles.minerRatio || 0), 0, 1) * 100)}%`
      + ` H${Math.round(clamp(Number(roles.haulerRatio || 0), 0, 1) * 100)}%`
      + ` G${Math.round(clamp(Number(roles.guardRatio || 0), 0, 1) * 100)}%`,
    );
    const assignedByDepth = crew.assignedByDepth || {};
    let assignedTotal = 0;
    for (const count of Object.values(assignedByDepth)) {
      assignedTotal += Math.max(0, Number(count || 0));
    }
    const surfaceAdults = Math.max(0, Number(crew.surfaceAdults || 0));
    lines.push(`Assigned delvers: ${assignedTotal} | Surface adults: ${surfaceAdults}`);
  }
  const deepFaction = underrealm.deepFaction || null;
  let activeRaidCount = 0;
  if (deepFaction && deepFaction.activeRaidsByDepth) {
    const activeRaids = Object.values(deepFaction.activeRaidsByDepth)
      .filter((raid) => raid && Number(raid.ticksRemaining || 0) > 0);
    activeRaidCount = activeRaids.length;
  }
  lines.push(formatUnderrealmPressureLine(underrealm, activeDepth, activeRaidCount));

  const ruinsGate = state
    && state.ruins
    && state.ruins.readinessGate
    && typeof state.ruins.readinessGate === "object"
    ? state.ruins.readinessGate
    : null;
  if (ruinsGate && Number(ruinsGate.depth || 0) > 0) {
    lines.push(formatRuinsReadinessGateLine(ruinsGate));
  } else {
    lines.push(formatUnderrealmReadinessFallbackLine(underrealm, frontierDepth));
  }
  return lines;
}

// Convert a multiplier (1.00 = baseline) to signed percentage.
function formatMultiplierPercent(multiplier) {
  const numeric = Number(multiplier || 1);
  if (!Number.isFinite(numeric)) {
    return "0%";
  }
  const deltaPct = Math.round((numeric - 1) * 100);
  if (deltaPct > 0) {
    return `+${deltaPct}%`;
  }
  if (deltaPct < 0) {
    return `${deltaPct}%`;
  }
  return "0%";
}

// Format a number compactly (k/m).
function formatCompactNumber(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  const abs = Math.abs(numeric);
  if (abs >= 1000000) {
    const scaled = Math.round(numeric / 1000000);
    return `${scaled}m`;
  }
  if (abs >= 1000) {
    const scaled = Math.round(numeric / 1000);
    return `${scaled}k`;
  }
  return String(Math.round(numeric));
}

// Format count and max values together.
function formatCountDetail(count, maxValue) {
  return `${formatCompactNumber(count)}/${formatCompactNumber(maxValue)}`;
}

// Build a labeled bar line for telemetry output.
function formatBarLine(label, ratio, details, columnWidth) {
  const safeWidth = Math.max(0, Number(columnWidth || 0));
  if (safeWidth <= 0) {
    return "";
  }

  const prefix = `${label}: `;
  let suffix = details ? ` ${details}` : "";
  let barWidth = safeWidth - prefix.length - suffix.length - 2;

  if (barWidth < 4 && suffix) {
    const maxDetails = Math.max(0, safeWidth - prefix.length - 2 - 4);
    if (maxDetails > 0 && details) {
      const trimmed = fitLine(String(details), maxDetails);
      suffix = trimmed ? ` ${trimmed}` : "";
      barWidth = safeWidth - prefix.length - suffix.length - 2;
    }
  }

  if (barWidth < 4 && suffix) {
    suffix = "";
    barWidth = safeWidth - prefix.length - 2;
  }

  if (barWidth < 4) {
    const fallback = details
      ? `${label}: ${details}`
      : `${label}: ${Number(ratio || 0).toFixed(2)}`;
    return fitLine(fallback, safeWidth);
  }

  const bar = makeBar(ratio, barWidth);
  return `${prefix}[${bar}]${suffix}`;
}

// Build a bar segment with filled and empty markers.
function makeBar(ratio, width) {
  const safeWidth = Math.max(0, Number(width || 0));
  if (safeWidth === 0) {
    return "";
  }
  const clamped = clamp(Number(ratio || 0), 0, 1);
  const filled = Math.round(clamped * safeWidth);
  const empty = Math.max(0, safeWidth - filled);
  return `${"#".repeat(filled)}${"-".repeat(empty)}`;
}

// Format the season label using only a capitalized season name.
function formatSeasonLabel(season) {
  if (!season || !season.name) {
    return "-";
  }
  const raw = String(season.name || "").trim();
  if (!raw) {
    return "-";
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

// Format the current year based on tick and season length.
function formatYearLabel(state, config) {
  const seasons = config.seasons || {};
  if (seasons.enabled === false) {
    return "-";
  }
  const order =
    Array.isArray(seasons.order) && seasons.order.length > 0
      ? seasons.order
      : ["spring", "summer", "autumn", "winter"];
  const duration = Math.max(1, Number(seasons.durationTicks || 200));
  const cycle = duration * order.length;
  if (cycle <= 0) {
    return "-";
  }
  const tick = Number(state.tick || 0);
  const year = Math.floor(Math.max(0, tick - 1) / cycle) + 1;
  return String(year);
}

// Format the latest event for telemetry.
function formatLastEvent(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return "-";
  }
  return String(events[0]);
}

// Build a wrapped world-log block with a fixed number of rows.
function buildWorldLogRows(events, width, maxLines = 3) {
  const safeWidth = Math.max(1, Number(width || 1));
  const rows = Math.max(1, Math.floor(Number(maxLines || 1)));
  const wrapped = wrapLine(`Latest world log: ${formatLastEvent(events)}`, safeWidth);
  const lines = wrapped.slice(0, rows);
  if (wrapped.length > rows) {
    const lastIndex = rows - 1;
    if (safeWidth > 3) {
      const base = fitLine(lines[lastIndex] || "", safeWidth - 3);
      lines[lastIndex] = `${base}...`;
    } else {
      lines[lastIndex] = fitLine(lines[lastIndex] || "", safeWidth);
    }
  }
  while (lines.length < rows) {
    lines.push(" ");
  }
  return lines;
}

// Format world event status text for telemetry.
function formatWorldEventStatus(status) {
  if (!status || status.active !== true) {
    return "World event status: -";
  }
  const label = String(status.label || "Event");
  const ticks = Math.max(0, Number(status.ticksLeft || 0));
  if (status.phase === "offer") {
    const request = status.requestSummary ? ` ${status.requestSummary}` : "";
    return `World event status: ${label} (${ticks} ticks left)${request}`;
  }
  if (status.outcome) {
    return `World event status: ${label} (${ticks} ticks left, ${status.outcome})`;
  }
  return `World event status: ${label} (${ticks} ticks left)`;
}

// Format the merchant status string.
function formatMerchantStatus(merchant) {
  if (!merchant || merchant.phase === "idle") {
    return "not present";
  }
  if (merchant.phase === "trading") {
    const tradesMax = Number(merchant.tradesMax || 0);
    const tradesDone = Number(merchant.tradeCount || 0);
    if (tradesMax > 0) {
      return `trading (${tradesDone}/${tradesMax} trades used)`;
    }
    return "trading";
  }
  return String(merchant.phase);
}

// Format a compact external-camps status line.
function formatExternalCampStatus(status) {
  if (!status) {
    return "External camps: off";
  }
  const trade = Math.max(0, Number(status.byRole && status.byRole.trade || 0));
  const militia = Math.max(0, Number(status.byRole && status.byRole.militia || 0));
  const raider = Math.max(0, Number(status.byRole && status.byRole.raider || 0));
  const nextSpawn = Math.max(0, Number(status.nextSpawnIn || 0));
  if (Math.max(trade + militia + raider, 0) <= 0) {
    return `External camps: none active | next in ${nextSpawn} ticks`;
  }
  return `External camps: trade ${trade}, militia ${militia}, raider ${raider} | next in ${nextSpawn} ticks`;
}

// Format active external-camp modifier outputs.
function formatExternalCampModifiers(status) {
  if (!status || !status.modifiers) {
    return "External camp effects: -";
  }
  const modifiers = status.modifiers;
  const tradeRate = Math.max(0, Number(modifiers.merchantTradeRate || 1));
  const contractReward = Math.max(0, Number(modifiers.contractReward || 1));
  const defense = Math.max(0, Number(modifiers.raidDefenseBonus || 0));
  const pressure = Math.max(0, Number(modifiers.raiderPressure || 0));
  return `External camp effects: trade x${tradeRate.toFixed(2)} | contracts x${contractReward.toFixed(2)} | defense +${Math.round(defense * 100)}% | raider pressure ${Math.round(pressure * 100)}%`;
}

// Format the current contract status line.
function formatContractStatus(state, config, width) {
  void width;
  const contractsConfig = (config && config.contracts) || {};
  if (contractsConfig.enabled === false) {
    return "Contract status: off";
  }
  const contracts = state && state.contracts ? state.contracts : null;
  if (!contracts || !contracts.active) {
    return "Contract status: -";
  }
  const active = contracts.active;
  const label = String(active.factionLabel || active.factionId || "Contract");
  const expiresAt = Number(active.expiresAt || 0);
  const tick = Number(state.tick || 0);
  const ticksLeft = Math.max(0, Math.round(expiresAt - tick));
  return `Contract status: ${label} (${ticksLeft} ticks left)`;
}

// Format the contract reputation summary line.
function formatContractReputation(state, config, width) {
  void width;
  const contractsConfig = (config && config.contracts) || {};
  if (contractsConfig.enabled === false) {
    return "Contract reputation: off";
  }
  const factions = contractsConfig.factions || {};
  const entries = Object.entries(factions);
  if (entries.length === 0) {
    return "Contract reputation: -";
  }
  const contracts = state && state.contracts ? state.contracts : null;
  if (!contracts || !contracts.reputations) {
    return "Contract reputation: -";
  }
  const parts = entries.map(([factionId, faction]) => {
    const label = faction && faction.label ? faction.label : factionId;
    const value = Number(contracts.reputations[factionId] || 0);
    return `${label} ${value.toFixed(2)}`;
  });
  return `Contract reputation: ${parts.join(" | ")}`;
}

// Format the alchemy rite status line.
function formatAlchemyStatus(state, config, width) {
  void width;
  const alchemyConfig = (config && config.alchemy) || {};
  if (alchemyConfig.enabled === false) {
    return "Alchemy status: off";
  }
  const status = getAlchemyStatus(state, config);
  if (!status) {
    return "Alchemy status: -";
  }
  if (status.mode === "active") {
    const label = String(status.label || "Rite");
    const threshold = Math.max(0, Number(status.failureThreshold || 0));
    if (threshold > 0) {
      const failures = Math.max(0, Number(status.failures || 0));
      return `Alchemy status: ${label} (${status.ticksLeft} ticks left, failures ${failures}/${threshold})`;
    }
    return `Alchemy status: ${label} (${status.ticksLeft} ticks left)`;
  }
  if (status.mode === "backlash") {
    const label = String(status.label || "Backlash");
    return `Alchemy status: ${label} backlash (${status.ticksLeft} ticks left)`;
  }
  if (status.mode === "cooldown") {
    return `Alchemy status: cooldown (${status.ticksLeft} ticks left)`;
  }
  return "Alchemy status: -";
}

// Format weather label with color and remaining ticks.
function formatWeatherStatus(weather, colors) {
  if (!weather || !weather.type) {
    return "-";
  }
  const type = String(weather.type);
  const label = formatWeatherLabel(type);
  const colored = applyColor(label, `weather_${type}`, colors);
  const remaining = Number(weather.ticksRemaining || 0);
  if (remaining > 0) {
    return `${colored} (${remaining} ticks remaining)`;
  }
  return colored;
}

// Normalize weather labels for display.
function formatWeatherLabel(type) {
  const labels = {
    clear: "Clear",
    rain: "Rain",
    storm: "Storm",
    drought: "Drought",
    cold: "Cold",
  };
  if (labels[type]) {
    return labels[type];
  }
  if (!type) {
    return "-";
  }
  return type.charAt(0).toUpperCase() + type.slice(1);
}

// Build the myths telemetry section with two sub-columns.
function buildMythsTelemetrySection(state, config, width) {
  const mythsConfig = (config && config.myths) || {};
  if (mythsConfig.enabled === false) {
    return [];
  }
  const colors = getColorConfig(config);
  const header = applyColor("Myths", "hud_header", colors);
  const gap = 2;
  const columnWidth = getTelemetryColumnWidth(width, 2, gap);
  if (columnWidth <= 0) {
    return [];
  }
  if (columnWidth < 12) {
    const fallback = buildMythsTelemetryLines(state, config, width);
    return fallback.length > 0 ? [header, ...fallback] : [];
  }
  const activeLines = buildMythsActiveLines(state, config, columnWidth);
  const traditionLines = buildMythsTraditionLines(state, config, columnWidth);
  const body = formatColumns([activeLines, traditionLines], width, 2, gap);
  const bonusLines = buildMythsBonusLines(state, config, width);
  if (body.length === 0 && bonusLines.length === 0) {
    return [];
  }
  return [header, ...body, ...bonusLines];
}

// Build single-column myths telemetry lines (fallback).
function buildMythsTelemetryLines(state, config, columnWidth) {
  const activeLines = buildMythsActiveLines(state, config, columnWidth);
  const traditionLines = buildMythsTraditionLines(state, config, columnWidth);
  const bonusLines = buildMythsBonusLines(state, config, columnWidth);
  if (activeLines.length === 0 && traditionLines.length === 0) {
    return bonusLines;
  }
  if (traditionLines.length === 0) {
    return activeLines.concat(bonusLines);
  }
  if (activeLines.length === 0) {
    return traditionLines.concat(bonusLines);
  }
  const needsSpacer = activeLines.length > 1 && traditionLines.length > 1;
  return activeLines.concat(
    needsSpacer ? [""] : [],
    traditionLines,
    bonusLines,
  );
}

// Build the active myths column lines.
function buildMythsActiveLines(state, config, columnWidth) {
  const mythsConfig = (config && config.myths) || {};
  if (mythsConfig.enabled === false) {
    return [];
  }
  const myths = state.myths || {};
  const defs = mythsConfig.definitions || {};
  const active = myths.active || {};
  const activeIds = Object.keys(active);
  const maxActive = Math.max(0, Number(mythsConfig.maxActive || 0));
  const lines = [];
  lines.push(
    `Active: ${activeIds.length}${maxActive > 0 ? `/${maxActive}` : ""}`,
  );
  if (activeIds.length === 0) {
    return lines;
  }
  for (const mythId of activeIds) {
    const def = defs[mythId] || {};
    const label = def.label || mythId;
    const entry = active[mythId] || {};
    const endsTick = Math.max(0, Number(entry.endsTick || 0));
    const remaining =
      endsTick > 0 ? Math.max(0, endsTick - Number(state.tick || 0)) : null;
    const timeLabel = remaining !== null ? `t${remaining}` : "t--";
    lines.push(fitLine(`${label} ${timeLabel}`, columnWidth));
  }
  return lines;
}

// Build the traditions column lines.
function buildMythsTraditionLines(state, config, columnWidth) {
  const mythsConfig = (config && config.myths) || {};
  if (mythsConfig.enabled === false) {
    return [];
  }
  const lines = [];
  if (mythsConfig.traditionsEnabled === false) {
    lines.push("Traditions: off");
    return lines;
  }
  const myths = state.myths || {};
  const defs = mythsConfig.definitions || {};
  const traditions = myths.traditions || {};
  const traditionIds = Object.keys(traditions);
  const maxTraditions = Math.max(0, Number(mythsConfig.maxTraditions || 0));
  lines.push(
    `Traditions: ${traditionIds.length}${maxTraditions > 0 ? `/${maxTraditions}` : ""}`,
  );
  if (traditionIds.length === 0) {
    return lines;
  }
  for (const mythId of traditionIds) {
    const def = defs[mythId] || {};
    const label = def.label || mythId;
    lines.push(fitLine(label, columnWidth));
  }
  return lines;
}

// Build the myth bonuses summary lines (limited to 2-3 lines).
function buildMythsBonusLines(state, config, width) {
  const mythsConfig = (config && config.myths) || {};
  if (mythsConfig.enabled === false) {
    return [];
  }
  const parts = getMythBonusParts(state, config);
  if (parts.length === 0) {
    return [];
  }
  const safeWidth = Math.max(0, Number(width || 0));
  if (safeWidth <= 0) {
    return [];
  }
  const maxLines = safeWidth >= 52 ? 3 : 2;
  const colors = getColorConfig(config);
  const prefix = `${applyColor("Myth bonuses", "hud_header", colors)}: `;
  let lines = wrapLine(`${prefix}${parts.join(", ")}`, safeWidth);
  if (lines.length > maxLines) {
    const trimmed = fitLine(lines[maxLines - 1], Math.max(0, safeWidth - 3));
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = `${trimmed}...`;
  }
  return lines;
}

function getMythBonusParts(state, config) {
  const mythsConfig = (config && config.myths) || {};
  if (mythsConfig.enabled === false) {
    return [];
  }
  const defs = mythsConfig.definitions || {};
  const myths = state.myths || {};
  const multipliers = {};
  const applyEffects = (effects) => {
    if (!effects || typeof effects !== "object") {
      return;
    }
    for (const [key, valueRaw] of Object.entries(effects)) {
      const value = Number(valueRaw);
      if (!Number.isFinite(value) || value <= 0) {
        continue;
      }
      multipliers[key] = (multipliers[key] || 1) * value;
    }
  };

  for (const mythId of Object.keys(myths.active || {})) {
    const def = defs[mythId] || {};
    applyEffects(def.effects);
  }
  for (const mythId of Object.keys(myths.traditions || {})) {
    const def = defs[mythId] || {};
    applyEffects(def.traditionEffects);
  }

  return formatMythBonusParts(multipliers);
}

function formatMythBonusParts(multipliers) {
  const labels = {
    needDecay: "Need decay",
    gatherTicks: "Gather ticks",
    gatherYield: "Gather yield",
    reproductionChance: "Reproduction",
    raidDeathRate: "Raid deaths",
    raidResourceLoss: "Raid loss",
    ruinsArtifactChance: "Artifact chance",
    ruinsHazard: "Hazard",
    fieldRegen: "Field regen",
    irrigation: "Irrigation",
    nodeRegen: "Node regen",
  };
  const parts = [];
  const addPart = (key, label) => {
    const value = Number(multipliers[key]);
    if (!Number.isFinite(value)) {
      return;
    }
    const delta = Math.round((value - 1) * 100);
    if (delta === 0) {
      return;
    }
    const sign = delta > 0 ? "+" : "";
    parts.push(`${label} ${sign}${delta}%`);
  };

  for (const key of Object.keys(labels)) {
    if (multipliers[key] !== undefined) {
      addPart(key, labels[key]);
    }
  }

  const extraKeys = Object.keys(multipliers)
    .filter((key) => !labels[key])
    .sort();
  for (const key of extraKeys) {
    addPart(key, key);
  }

  return parts;
}

// Count dwarves by life stage.
function countLifeStages(dwarves) {
  const counts = { child: 0, adult: 0, elder: 0 };
  for (const dwarf of dwarves) {
    const stage = dwarf.lifeStage || "adult";
    if (counts[stage] !== undefined) {
      counts[stage] += 1;
    } else {
      counts.adult += 1;
    }
  }
  return counts;
}

// Compute average needs across all dwarves.
// Compute average of a numeric selector.
function averageValue(dwarves, selector) {
  if (dwarves.length === 0) {
    return 0;
  }

  const total = dwarves.reduce(
    (sum, dwarf) => sum + Number(selector(dwarf) || 0),
    0,
  );
  return total / dwarves.length;
}

// Summarize mine/sawmill levels for telemetry.
function getStructureLevelSummary(structures) {
  if (!Array.isArray(structures)) {
    return "";
  }
  const entries = [];
  const collectLevel = (type, label) => {
    const match = structures.find(
      (structure) =>
        structure.type === type && Number.isFinite(Number(structure.level)),
    );
    if (!match) {
      return;
    }
    const level = Math.round(Number(match.level || 1));
    entries.push({ label, level });
  };

  collectLevel("mine", "Mine");
  collectLevel("sawmill", "Sawmill");
  collectLevel("brewery", "Brewery");
  collectLevel("mithril_forge", "Mithril forge");

  if (entries.length === 0) {
    return "";
  }

  return entries
    .map((entry) => `${entry.label} level ${entry.level}`)
    .join(" | ");
}

// Format temple stage line for telemetry display.
function formatTempleStageStatus(templeState, stage, maxStage) {
  if (maxStage <= 0 || !templeState || templeState.enabled === false) {
    return "Temple status: disabled";
  }
  const doctrinePath = templeState && templeState.doctrinePath
    ? ` | path ${String(templeState.doctrinePath)}`
    : "";
  if (!templeState.site) {
    return `Temple status: stage ${stage}/${maxStage} (site scan in progress)${doctrinePath}`;
  }
  if (stage <= 0) {
    return `Temple status: stage 0/${maxStage} (site ready)${doctrinePath}`;
  }
  if (stage >= maxStage) {
    return `Temple status: stage ${maxStage}/${maxStage} complete${doctrinePath}`;
  }
  return `Temple status: stage ${stage}/${maxStage}${doctrinePath}`;
}

// Format temple build progress line while a stage is under construction.
function formatTempleProgressStatus(templeJob, config) {
  if (!templeJob) {
    return "";
  }
  const templeConfig = (config.structures && config.structures.temple_of_ancestors) || {};
  const stages = Array.isArray(templeConfig.stages) ? templeConfig.stages : [];
  const stageIndex = Math.max(0, Math.floor(Number(templeJob.templeStage || 1)) - 1);
  const stageConfig = stages[stageIndex] || {};
  const totalTicks = Math.max(
    1,
    Math.floor(Number(templeJob.totalWork || stageConfig.buildTicks || templeJob.workRemaining || 1)),
  );
  const remainingTicks = clamp(
    Math.floor(Number(templeJob.workRemaining || 0)),
    0,
    totalTicks,
  );
  const progress = clamp((totalTicks - remainingTicks) / totalTicks, 0, 1);
  const path = templeJob && templeJob.templeDoctrinePath
    ? ` | ${String(templeJob.templeDoctrinePath)}`
    : "";
  return `Temple construction progress: ${Math.round(progress * 100)}%${path}`;
}

module.exports = {
  buildTelemetrySections,
  getTelemetryLayouts,
  formatColumns,
  getTelemetryColumnWidth,
  formatCompactNumber,
  formatCountDetail,
  formatBarLine,
  makeBar,
  formatSeasonLabel,
  formatYearLabel,
  formatLastEvent,
  formatMerchantStatus,
  formatWeatherStatus,
  formatWeatherLabel,
  countLifeStages,
  averageValue,
};
