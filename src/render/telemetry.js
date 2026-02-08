"use strict";

const { clamp, padRight } = require("../utils");
const { getStockpileTarget } = require("../simulation/resources");
const { getFestivalStatus } = require("../simulation/festivals");
const { getAlchemyStatus } = require("../simulation/alchemy");
const { getWorldEventStatus } = require("../simulation/world_events");
const { getColorConfig, applyColor } = require("./colors");
const { fitLine, wrapLine } = require("./format");

const TELEMETRY_LAYOUT = [
  {
    id: "core_ops",
    title: "Core Ops",
    sections: ["world", "population", "pressure", "stockpile"],
  },
  {
    id: "economy",
    title: "Economy",
    sections: ["structures", "diplomacy", "operations"],
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
  const dwarves = Array.isArray(state.dwarves) ? state.dwarves : [];
  const avgMorale = averageValue(dwarves, (d) => d.state.morale);
  const avgMoraleBoost = averageValue(dwarves, (d) => d.state.moraleBoostBeer);
  const avgStress = averageValue(dwarves, (d) => d.state.stress);
  const idleCount = dwarves.filter(
    (dwarf) => !dwarf.job && !dwarf.expedition,
  ).length;
  const structures = state.structures || [];
  const houses = structures.filter(
    (structure) => structure.type === "house",
  );
  const wellCount = structures.filter(
    (structure) => structure.type === "well",
  ).length;
  const fieldCount = structures.filter(
    (structure) => structure.type === "field",
  ).length;
  const workshopCount = structures.filter(
    (structure) => structure.type === "workshop",
  ).length;
  const breweryCount = structures.filter(
    (structure) => structure.type === "brewery",
  ).length;
  const sawmillCount = structures.filter(
    (structure) => structure.type === "sawmill",
  ).length;
  const mineCount = structures.filter(
    (structure) => structure.type === "mine",
  ).length;
  const armoryCount = structures.filter(
    (structure) => structure.type === "armory",
  ).length;
  const forgeCount = structures.filter(
    (structure) => structure.type === "mithril_forge",
  ).length;
  const alchemyLabCount = structures.filter(
    (structure) => structure.type === "alchemy_lab",
  ).length;
  const ruinsCount = structures.filter(
    (structure) => structure.type === "ruins",
  ).length;
  const housingConfig = (config.population && config.population.housing) || {};
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
  const wildlifeConfig = config.wildlife || {};
  const wildlifeEnabled = wildlifeConfig.enabled === true;
  const herdCount = wildlifeEnabled && state.wildlife && Array.isArray(state.wildlife.herds)
    ? state.wildlife.herds.filter((herd) => herd && Number(herd.remaining || 0) > 0).length
    : 0;
  const huntCount = wildlifeEnabled
    ? state.jobs.filter((job) => job.type === "hunt").length
    : 0;
  const seasonLabel = formatSeasonLabel(state.season);
  const yearLabel = formatYearLabel(state, config);
  const underrealmTelemetry = getUnderrealmTelemetryLines(state);
  const stageCounts = countLifeStages(dwarves);
  const targets =
    (config.resources &&
      (config.resources.targets || config.resources.stockpile)) ||
    {};
  const resourceLabels = (config.resources && config.resources.labels) || {};
  const telemetryConfig = (config.display && config.display.telemetry) || {};
  const stockBarMax = Number(telemetryConfig.stockBarMax || 0);
  const colors = getColorConfig(config);
  const header = (label) => applyColor(label, "hud_header", colors);
  const pushSection = (lines, label) => {
    if (lines.length > 0 && lines[lines.length - 1] !== "") {
      lines.push("");
    }
    lines.push(header(label));
  };
  const cycleStats = state.cycleStats || {};
  const cycleCount = Math.max(0, Number(cycleStats.count || 0));
  const villageCount = Array.isArray(state.villages)
    ? state.villages.length
    : 1;
  const templeState = state.temple && typeof state.temple === "object"
    ? state.temple
    : null;
  const templeMaxStageConfig = config.structures
    && config.structures.temple_of_ancestors
    && Array.isArray(config.structures.temple_of_ancestors.stages)
    ? config.structures.temple_of_ancestors.stages.length
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
  const templeJob = state.jobs.find(
    (job) => job.type === "build" && job.structureType === "temple_of_ancestors",
  ) || null;
  const prestigeState = state.prestige && typeof state.prestige === "object"
    ? state.prestige
    : null;
  const prestigeTotal = Math.max(0, Number(prestigeState && prestigeState.total || 0));
  const prestigeRank = prestigeState && prestigeState.rank
    ? String(prestigeState.rank)
    : "Unproven";
  const reproductionStats = state.reproductionStats || {};
  const deathsByCause = state.deathsByCause || {};
  const birthsCount = Math.max(0, Number(state.birthsCount || 0));
  const deathsCount = Math.max(0, Number(state.deathsCount || 0));
  const reproAttempts = Math.max(0, Number(reproductionStats.attempts || 0));
  const reproSuccesses = Math.max(0, Number(reproductionStats.successes || 0));
  const reproSuccessRatio = reproAttempts > 0
    ? Math.round((reproSuccesses / reproAttempts) * 100)
    : 0;
  const raidStats = state.raidStats || {};
  const merchantStats = state.merchantStats || {};
  const contractsState = state.contracts && typeof state.contracts === "object"
    ? state.contracts
    : null;
  const contractsStats = contractsState && contractsState.stats
    ? contractsState.stats
    : {};
  const worldEventsState = state.worldEvents && typeof state.worldEvents === "object"
    ? state.worldEvents
    : null;
  const worldEventsStats = worldEventsState && worldEventsState.stats
    ? worldEventsState.stats
    : null;
  const includeRuins = options.includeRuins !== false;
  const includeMyths = options.includeMyths !== false;

  const left = [];
  const right = [];
  const sections = {};
  const appendFixedSection = (lines, sectionKey, label, rows, rowCount) => {
    pushSection(lines, label);
    const normalizedRows = Array.isArray(rows) ? rows : [];
    const count = Math.max(0, Number(rowCount || normalizedRows.length));
    const sectionRows = [];
    let added = 0;
    for (const row of normalizedRows) {
      if (added >= count) {
        break;
      }
      const text = row === null || row === undefined || row === ""
        ? "-"
        : String(row);
      lines.push(text);
      sectionRows.push(text);
      added += 1;
    }
    while (added < count) {
      lines.push("-");
      sectionRows.push("-");
      added += 1;
    }
    if (sectionKey) {
      sections[sectionKey] = {
        label,
        rows: sectionRows,
      };
    }
  };

  const festivalStatus = getFestivalStatus(state, config);
  const worldEventStatus = getWorldEventStatus(state, config);
  const contractStatus = formatContractStatus(state, config, columnWidth);
  const alchemyStatus = formatAlchemyStatus(state, config, columnWidth);
  const underrealmRows = buildStableUnderrealmRows(underrealmTelemetry);
  const shortages = Array.isArray(state.lastPriorities) ? state.lastPriorities : [];
  const stockRatioLine = [
    formatStockRatio("food", state, config, resourceLabels),
    formatStockRatio("water", state, config, resourceLabels),
    formatStockRatio("beer", state, config, resourceLabels),
  ].join(" | ");
  const buildRatioLine = [
    formatStockRatio("wood", state, config, resourceLabels),
    formatStockRatio("stone", state, config, resourceLabels),
    formatStockRatio("iron", state, config, resourceLabels),
  ].join(" | ");

  appendFixedSection(left, "world", "World", [
    `Simulation tick: ${state.tick} | Year ${yearLabel}, ${seasonLabel}`,
    `Completed cycles: ${cycleCount} | Villages: ${villageCount}`,
    `Prestige score: ${formatCompactNumber(prestigeTotal)} (${prestigeRank})`,
    `Weather: ${formatWeatherStatus(state.weather, colors)}`,
    `Housing ratio: ${housingRatio.toFixed(2)} beds per dwarf`,
    formatFestivalStatus(festivalStatus),
    formatWorldEventStatus(worldEventStatus),
    contractStatus,
    alchemyStatus,
    ...buildWorldLogRows(state.events, columnWidth, 3),
  ], 12);

  appendFixedSection(left, "underrealm", "Underrealm", underrealmRows, 9);

  appendFixedSection(left, "population", "Population", [
    `Population total: ${dwarves.length} (Adults ${stageCounts.adult}, Children ${stageCounts.child}, Elders ${stageCounts.elder})`,
    wildlifeEnabled
      ? `Workforce: ${idleCount} idle, ${state.jobs.length} assigned jobs, ${huntCount} hunting jobs`
      : `Workforce: ${idleCount} idle, ${state.jobs.length} assigned jobs`,
    wildlifeEnabled ? `Wildlife status: ${herdCount} active herds` : "Wildlife status: off",
    `Morale: ${avgMorale.toFixed(2)} (beer boost +${avgMoraleBoost.toFixed(2)}) | Stress: ${avgStress.toFixed(2)}`,
    `Births / deaths: ${birthsCount} / ${deathsCount}`,
    `Deaths by cause: starvation ${Math.max(0, Number(deathsByCause.starvation || 0))}, raids ${Math.max(0, Number(deathsByCause.raid || 0))}, deep raids ${Math.max(0, Number(deathsByCause.deepRaid || 0))}`,
    `Reproduction success: ${reproSuccesses}/${reproAttempts} (${reproSuccessRatio}%)`,
  ], 7);

  appendFixedSection(left, "pressure", "Pressure", [
    formatShortageStatus(shortages, 0, state, config, resourceLabels),
    formatShortageStatus(shortages, 1, state, config, resourceLabels),
    `Core stock targets: ${stockRatioLine}`,
    `Build stock targets: ${buildRatioLine}`,
    formatRaidStatus(raidStats),
    `Active shortage signals: ${shortages.length}`,
  ], 6);

  appendFixedSection(
    left,
    "lore",
    "Lore",
    buildLoreSectionRows(state, config, columnWidth, {
      includeRuins,
      includeMyths,
    }),
    11,
  );

  const templeProgress = formatTempleProgressStatus(templeJob, config) || "Temple construction progress: -";
  const structureLevelSummary = getStructureLevelSummary(structures);
  let toolLine = "Tool upgrade level: -";
  if (state.tools) {
    const maxLevel = Math.max(1, Number(state.tools.maxLevel || 1));
    const level = Math.min(
      maxLevel,
      Math.max(1, Number(state.tools.level || 1)),
    );
    toolLine = `Tool upgrade level: ${level}/${maxLevel}`;
  }

  appendFixedSection(right, "structures", "Structures", [
    `Core structures: Wells ${wellCount}, Fields ${fieldCount}, Mines ${mineCount}`,
    `Production structures: Workshops ${workshopCount}, Breweries ${breweryCount}, Sawmills ${sawmillCount}`,
    `Defense structures: Armories ${armoryCount}, Mithril forges ${forgeCount}`,
    `Arcane structures: Alchemy labs ${alchemyLabCount}, Ruins ${ruinsCount}`,
    formatTempleStageStatus(templeState, templeStage, templeMaxStage),
    templeProgress,
    toolLine,
    structureLevelSummary ? `Structure levels: ${structureLevelSummary}` : "Structure levels: -",
  ], 8);

  appendFixedSection(right, "diplomacy", "Diplomacy", [
    `Merchant status: ${formatMerchantStatus(state.merchant)}`,
    `Merchant trades completed: ${Math.max(0, Number(merchantStats.trades || 0))}`,
    formatMerchantFlowLine("Top exported resource", merchantStats.given, resourceLabels),
    formatMerchantFlowLine("Top imported resource", merchantStats.received, resourceLabels),
    formatContractStatus(state, config, columnWidth),
    formatContractReputation(state, config, columnWidth),
    formatContractRecordLine(contractsStats),
    formatContractWinRateLine(contractsStats),
    formatWorldEventStats(worldEventsStats),
    formatWorldEventLiveLine(worldEventStatus, worldEventsState, state.tick),
  ], 10);

  const stockpileOrder = getStockpileDisplayOrder(state, config);
  const stockpileLines = stockpileOrder.map((id) => {
    const count = Number(state.stockpile[id] || 0);
    const target = getStockpileTarget(state, config, id, targets);
    const maxValue = stockBarMax > 0
      ? stockBarMax
      : Math.max(1, target, Math.round(count));
    const ratio = maxValue > 0 ? clamp(count / maxValue, 0, 1) : 0;
    const detail = formatCountDetail(count, maxValue);
    const label = getTelemetryResourceLabel(id, resourceLabels);
    return formatBarLine(label, ratio, detail, columnWidth);
  });
  appendFixedSection(
    right,
    "stockpile",
    "Stockpile",
    stockpileLines.length > 0 ? stockpileLines : ["-"],
    Math.max(10, stockpileLines.length),
  );

  appendFixedSection(
    right,
    "operations",
    "Operations",
    buildOperationsSectionRows(
      state,
      config,
      shortages,
      resourceLabels,
      templeJob,
    ),
    11,
  );

  appendFixedSection(
    right,
    "deepSignals",
    "Deep Signals",
    buildDeepSignalsSectionRows(
      state,
      config,
      worldEventStatus,
      worldEventsState,
      worldEventsStats,
      contractsStats,
      columnWidth,
    ),
    6,
  );

  return { left, right, sections };
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
      "Strata: -",
      "Depth stock reserves: -",
      "Depth survey progress: -",
      "Delver role ratios: -",
      "Assigned delvers: -",
      "Ward status: -",
      "Deep threat level: -",
    ];
  }
  return [
    findLineByPrefix(lines, ["Realm:"], "Realm: -"),
    findLineByPrefix(lines, ["Hidden gate search time:", "Hidden gate:"], "Hidden gate: -"),
    findLineByPrefix(lines, ["Strata:"], "Strata: -"),
    findLineByPrefix(lines, ["Depth stock reserves:"], "Depth stock reserves: -"),
    findLineByPrefix(lines, ["Depth survey progress:"], "Depth survey progress: -"),
    findLineByPrefix(lines, ["Delver role ratios:"], "Delver role ratios: -"),
    findLineByPrefix(lines, ["Assigned delvers:"], "Assigned delvers: -"),
    findLineByPrefix(lines, ["Ward charges available:", "Shrine oath status:"], "Ward status: -"),
    findLineByPrefix(lines, ["Deep threat level:", "Deep lift progress"], "Deep threat level: -"),
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
  const ticksLeft = Math.max(0, Number(status.ticksLeft || 0));
  const duration = Math.max(0, Number(status.duration || 0));
  if (duration > 0) {
    return `Festival status: ${label} (${ticksLeft}/${duration} ticks remaining)`;
  }
  return `Festival status: ${label} (${ticksLeft} ticks remaining)`;
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

// Build operations lines for workforce, job mix, and stockpile deltas.
function buildOperationsSectionRows(
  state,
  config,
  shortages,
  resourceLabels,
  templeJob,
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
    formatShortageCompact(shortages, 1, state, config, resourceLabels),
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
  const layers = Array.isArray(underrealm.layers) ? underrealm.layers : [];
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
      `Delver role ratios: miners ${Math.round(clamp(Number(roles.minerRatio || 0), 0, 1) * 100)}%`
      + ` | haulers ${Math.round(clamp(Number(roles.haulerRatio || 0), 0, 1) * 100)}%`
      + ` | guards ${Math.round(clamp(Number(roles.guardRatio || 0), 0, 1) * 100)}%`,
    );
    const assignedByDepth = crew.assignedByDepth || {};
    let assignedTotal = 0;
    for (const count of Object.values(assignedByDepth)) {
      assignedTotal += Math.max(0, Number(count || 0));
    }
    const surfaceAdults = Math.max(0, Number(crew.surfaceAdults || 0));
    lines.push(`Assigned delvers: ${assignedTotal} | Surface adults: ${surfaceAdults}`);
  }
  if (activeDepth > 0 && underrealm.shrines) {
    const depthKey = String(activeDepth);
    const charges = Math.max(
      0,
      Number(
        underrealm.shrines.wardChargesByDepth
        && underrealm.shrines.wardChargesByDepth[depthKey],
      ),
    );
    lines.push(`Ward charges available: ${Math.floor(charges)}`);
    const oath = underrealm.shrines.oathByDepth && underrealm.shrines.oathByDepth[depthKey];
    if (oath && Number(oath.activeTicks || 0) > 0) {
      lines.push(`Shrine oath status: active (${Math.floor(Number(oath.activeTicks || 0))} ticks remaining)`);
    } else if (oath && Number(oath.penaltyTicks || 0) > 0) {
      lines.push(`Shrine oath status: unrest (${Math.floor(Number(oath.penaltyTicks || 0))} ticks remaining)`);
    }
  }
  const deepFaction = underrealm.deepFaction || null;
  if (deepFaction && deepFaction.activeRaidsByDepth) {
    const activeRaids = Object.values(deepFaction.activeRaidsByDepth)
      .filter((raid) => raid && Number(raid.ticksRemaining || 0) > 0);
    if (activeRaids.length > 0) {
      lines.push(`Deep threat level: ${activeRaids.length} active raid(s)`);
    }
  }
  if (maxUnlockedDepth > 0 && maxUnlockedDepth < maxDepth) {
    const lift = underrealm.lift || null;
    if (lift && lift.active === true) {
      const totalTicks = Math.max(1, Number(lift.totalTicks || 1));
      const remainingTicks = Math.max(0, Number(lift.ticksRemaining || 0));
      const pct = Math.max(0, Math.min(100, Math.round((1 - remainingTicks / totalTicks) * 100)));
      lines.push(`Deep lift progress D${lift.fromDepth} to D${lift.targetDepth}: ${pct}%`);
    }
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
  if (!templeState.site) {
    return `Temple status: stage ${stage}/${maxStage} (site scan in progress)`;
  }
  if (stage <= 0) {
    return `Temple status: stage 0/${maxStage} (site ready)`;
  }
  if (stage >= maxStage) {
    return `Temple status: stage ${maxStage}/${maxStage} complete`;
  }
  return `Temple status: stage ${stage}/${maxStage}`;
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
    Math.floor(Number(stageConfig.buildTicks || templeJob.workRemaining || 1)),
  );
  const remainingTicks = clamp(
    Math.floor(Number(templeJob.workRemaining || 0)),
    0,
    totalTicks,
  );
  const progress = clamp((totalTicks - remainingTicks) / totalTicks, 0, 1);
  return `Temple construction progress: ${Math.round(progress * 100)}%`;
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
