"use strict";

const { clamp, padRight } = require("../utils");
const { getClanLabel, getClanList, countClans } = require("../clans");
const { getStockpileTarget } = require("../simulation/resources");
const { getFestivalStatus } = require("../simulation/festivals");
const { getColorConfig, applyColor } = require("./colors");
const { fitLine, wrapLine } = require("./format");

// Build HUD lines based on column layout.
function buildHudLines(state, config, runtime) {
  const columns = Math.max(1, Number(runtime.hudColumns || 1));
  const gap = Math.max(0, Number(runtime.hudColumnGap || 2));
  const columnWidth = getHudColumnWidth(runtime.hudWidth, columns, gap);

  if (columns <= 1) {
    const { left, right } = buildHudColumns(state, config, columnWidth, {
      includeRuins: false,
    });
    const baseLines = left.concat([""], right);
    const mythsSection = buildMythsHudSection(state, config, runtime.hudWidth);
    const ruinsSection = buildRuinsHudSection(state, config, runtime.hudWidth);
    const overlay = mergeHudSections(mythsSection, ruinsSection);
    if (overlay.length === 0) {
      return baseLines;
    }
    return baseLines.concat([""], overlay);
  }

  const { left, right } = buildHudColumns(state, config, columnWidth, {
    includeRuins: false,
  });
  const columnLines = formatColumns(
    [left, right],
    runtime.hudWidth,
    columns,
    gap,
  );
  const mythsSection = buildMythsHudSection(state, config, runtime.hudWidth);
  const ruinsSection = buildRuinsHudSection(state, config, runtime.hudWidth);
  const overlay = mergeHudSections(mythsSection, ruinsSection);
  if (overlay.length === 0) {
    return columnLines;
  }

  const totalHeight = Math.max(
    1,
    Number(runtime.gridHeight || columnLines.length || 1),
  );
  const lines = columnLines.slice(0, totalHeight);
  while (lines.length < totalHeight) {
    lines.push("");
  }

  if (overlay.length >= totalHeight) {
    return overlay.slice(0, totalHeight);
  }

  const start = totalHeight - overlay.length;
  for (let i = 0; i < overlay.length; i += 1) {
    lines[start + i] = overlay[i];
  }
  return lines;
}

// Build the left and right HUD columns.
function buildHudColumns(state, config, columnWidth, options = {}) {
  const dwarves = state.dwarves;
  const avgMorale = averageValue(dwarves, (d) => d.state.morale);
  const avgMoraleBoost = averageValue(dwarves, (d) => d.state.moraleBoostBeer);
  const avgStress = averageValue(dwarves, (d) => d.state.stress);
  const idleCount = dwarves.filter(
    (dwarf) => !dwarf.job && !dwarf.expedition,
  ).length;
  const topPriority =
    state.lastPriorities && state.lastPriorities[0]
      ? state.lastPriorities[0].resource
      : "-";
  const structures = state.structures || [];
  const houseCount = structures.filter(
    (structure) => structure.type === "house",
  ).length;
  const houseLevels = {};
  for (const structure of structures) {
    if (structure.type !== "house") {
      continue;
    }
    const rawLevel = Number(structure.level ?? 1);
    if (!Number.isFinite(rawLevel)) {
      continue;
    }
    const level = Math.max(1, Math.round(rawLevel));
    houseLevels[level] = Number(houseLevels[level] || 0) + 1;
  }
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
  const ruinsCount = structures.filter(
    (structure) => structure.type === "ruins",
  ).length;
  const watchtowerCount = structures.filter(
    (structure) => structure.type === "watchtower",
  ).length;
  const housingConfig = (config.population && config.population.housing) || {};
  const housingEnabled = housingConfig.enabled !== false;
  const bedsTotal = housingEnabled
    ? structures
        .filter((structure) => structure.type === "house")
        .reduce(
          (sum, house) => sum + Math.max(0, Number(house.capacity || 0)),
          0,
        )
    : 0;
  const housingRatio = housingEnabled
    ? bedsTotal > 0
      ? bedsTotal / Math.max(1, dwarves.length)
      : 0
    : 1;
  const towerConfig = (config.structures && config.structures.watchtower) || {};
  const towerRaid = towerConfig.raid || {};
  const towerDefensePer = Math.max(0, Number(towerRaid.defensePerTower ?? 0));
  const towerDefenseMax = clamp(Number(towerRaid.defenseMax ?? 0), 0, 1);
  const towerDefense = clamp(
    watchtowerCount * towerDefensePer,
    0,
    towerDefenseMax,
  );
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
  const lastEvent = formatLastEvent(state.events);
  const stageCounts = countLifeStages(dwarves);
  const targets =
    (config.resources &&
      (config.resources.targets || config.resources.stockpile)) ||
    {};
  const resourceLabels = (config.resources && config.resources.labels) || {};
  const hudConfig = (config.display && config.display.hud) || {};
  const stockBarMax = Number(hudConfig.stockBarMax || 0);
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
  const lastCycleTicks = Math.max(0, Number(cycleStats.lastTicks || 0));
  const villageCount = Array.isArray(state.villages)
    ? state.villages.length
    : 1;

  const left = [];
  pushSection(left, "World");
  left.push(`Tick: ${state.tick}`);
  left.push(`Cycles: ${cycleCount}`);
  left.push(`Villages: ${villageCount}`);
  left.push(`Last cycle Ticks: ${lastCycleTicks}`);
  left.push(`Year ${yearLabel}, Season ${seasonLabel}`);
  left.push(`Weather: ${formatWeatherStatus(state.weather, colors)}`);
  const festivalStatus = getFestivalStatus(state, config);
  if (festivalStatus) {
    if (festivalStatus.active) {
      left.push(
        fitLine(
          `Festival: ${festivalStatus.label} ${festivalStatus.ticksLeft}/${festivalStatus.duration}`,
          columnWidth,
        ),
      );
    } else {
      left.push("Festival: -");
    }
  }
  if (wildlifeEnabled) {
    left.push(`Wildlife: herds ${herdCount}`);
  }
  left.push(`Event: ${lastEvent}`);
  left.push(`Merchant: ${formatMerchantStatus(state.merchant)}`);
  pushSection(left, "Population");
  left.push(
    `Pop: ${dwarves.length} (C:${stageCounts.child}/A:${stageCounts.adult}/E:${stageCounts.elder})`,
  );
  left.push(`Idle: ${idleCount}`);
  left.push(`Jobs: ${state.jobs.length}`);
  if (wildlifeEnabled) {
    left.push(`Hunts: ${huntCount}`);
  }
  left.push(`Morale: ${avgMorale.toFixed(2)} (+${avgMoraleBoost.toFixed(2)})`);
  left.push(`Stress: ${avgStress.toFixed(2)}`);
  left.push(formatBondingLine(state, config));
  pushSection(left, "Housing");
  left.push(`Houses: ${houseCount}`);
  const levelEntries = Object.keys(houseLevels)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (levelEntries.length > 0) {
    const levelLine = `Levels: ${levelEntries
      .map((level) => `L${level}=${houseLevels[level]}`)
      .join(" ")}`;
    for (const line of wrapLine(levelLine, columnWidth)) {
      left.push(line);
    }
  }
  left.push(`Beds: ${bedsTotal}`);
  left.push(`Housing ratio: ${housingRatio.toFixed(2)}`);
  pushSection(left, "Defense");
  left.push(`Towers: ${watchtowerCount}`);
  left.push(`Tower def: ${Math.round(towerDefense * 100)}%`);
  left.push(`Priority: ${topPriority}`);

  const right = [];
  pushSection(right, "Clans");
  const clanLines = formatClanHudLines(dwarves, config, colors, columnWidth);
  if (clanLines.length > 0) {
    right.push(...clanLines);
  } else {
    right.push("-");
  }

  pushSection(right, "Structures");
  right.push(
    fitLine(`Wells: ${wellCount}  Fields: ${fieldCount}`, columnWidth),
  );
  right.push(
    fitLine(
      `Workshop: ${workshopCount}  Brewery: ${breweryCount}`,
      columnWidth,
    ),
  );
  right.push(
    fitLine(`Sawmills: ${sawmillCount}  Mines: ${mineCount}`, columnWidth),
  );
  right.push(
    fitLine(`Forge: ${forgeCount}  Armory: ${armoryCount}`, columnWidth),
  );
  right.push(fitLine(`Ruins: ${ruinsCount}`, columnWidth));
  if (state.tools) {
    const maxLevel = Math.max(1, Number(state.tools.maxLevel || 1));
    const level = Math.min(
      maxLevel,
      Math.max(1, Number(state.tools.level || 1)),
    );
    right.push(`Tools: L${level}/${maxLevel}`);
  }
  const structureLevels = getStructureLevelSummary(structures, columnWidth);
  if (structureLevels) {
    right.push(fitLine(structureLevels, columnWidth));
  }

  const includeRuins = options.includeRuins !== false;
  const ruinsLines = includeRuins
    ? buildRuinsHudLines(state, config, columnWidth)
    : [];
  if (ruinsLines.length > 0) {
    pushSection(right, "Ancient Dwarven Ruins");
    right.push(...ruinsLines);
  }

  pushSection(right, "Stockpile");

  for (const [id, count] of Object.entries(state.stockpile)) {
    const target = getStockpileTarget(state, config, id, targets);
    const maxValue = stockBarMax > 0 ? stockBarMax : target;
    const ratio = maxValue > 0 ? clamp(Number(count || 0) / maxValue, 0, 1) : 1;
    const detail =
      maxValue > 0
        ? formatCountDetail(count, maxValue)
        : formatCompactNumber(count);
    const label = resourceLabels[id] || id;
    right.push(formatBarLine(label, ratio, detail, columnWidth));
  }

  return { left, right };
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

// Merge optional HUD sections with a blank line between them.
function mergeHudSections(...sections) {
  const merged = [];
  for (const section of sections) {
    if (!section || section.length === 0) {
      continue;
    }
    if (merged.length > 0) {
      merged.push("");
    }
    merged.push(...section);
  }
  return merged;
}

// Compute a single HUD column width.
function getHudColumnWidth(totalWidth, columnCount, gap) {
  const usableWidth = Math.max(0, Number(totalWidth || 0));
  const gapWidth = Math.max(0, Number(gap || 0));
  const totalGap = gapWidth * (columnCount - 1);
  const columnWidth = Math.floor((usableWidth - totalGap) / columnCount);
  return Math.max(0, columnWidth);
}

// Format a need value for display.
// Build a compact bonding summary for the HUD.
function formatBondingLine(state, config) {
  const dwarves = state.dwarves || [];
  const housingConfig = (config.population && config.population.housing) || {};
  const housingEnabled = housingConfig.enabled !== false;
  const visited = new Set();
  let couples = 0;
  let noHomeCouples = 0;

  for (const dwarf of dwarves) {
    if (
      !dwarf.partnerId ||
      visited.has(dwarf.id) ||
      visited.has(dwarf.partnerId)
    ) {
      continue;
    }
    const partner = dwarves.find(
      (candidate) => candidate.id === dwarf.partnerId,
    );
    if (!partner) {
      continue;
    }
    visited.add(dwarf.id);
    visited.add(partner.id);
    couples += 1;
    if (housingEnabled && (!dwarf.homeId || dwarf.homeId !== partner.homeId)) {
      noHomeCouples += 1;
    }
  }

  let pregnancies = 0;
  for (const dwarf of dwarves) {
    if (dwarf.pregnancy) {
      pregnancies += 1;
    }
  }

  return `Bond: couples ${couples} preg ${pregnancies} noHome ${noHomeCouples}`;
}

// Build clan count lines for the HUD.
function formatClanHudLines(dwarves, config, colors, columnWidth) {
  const clanList = getClanList(config);
  if (clanList.length === 0) {
    return [];
  }
  const counts = countClans(dwarves, clanList);
  const lines = [];
  for (const clanId of clanList) {
    const label = getClanLabel(config, clanId);
    const coloredLabel = applyColor(label, `clan_${clanId}`, colors);
    const count = Number(counts[clanId] || 0);
    lines.push(fitLine(`${coloredLabel}: ${count}`, columnWidth));
  }
  return lines;
}

// Build a compact reproduction block summary for the HUD.
// Build HUD lines for ruins exploration progress.
function buildRuinsHudLines(state, config, columnWidth) {
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
      lines.push(
        fitLine(
          `Expeditions: ${expeditions.length}/${maxConcurrentAfterClear} active`,
          columnWidth,
        ),
      );
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
        lines.push(
          fitLine(
            `Expedition ${index + 1}: R${roomNumber} t${ticks} p${partySize}`,
            columnWidth,
          ),
        );
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
      lines.push(
        fitLine(
          `Expedition: R${roomNumber} t${ticks} p${partySize}`,
          columnWidth,
        ),
      );
    }
  } else if (!repeatable && Number(ruins.cooldown || 0) > 0) {
    lines.push(
      fitLine(
        `Expedition: cooldown ${Math.floor(Number(ruins.cooldown || 0))}`,
        columnWidth,
      ),
    );
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
  lines.push(`Kits: ${formatCompactNumber(kits)}`);

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

function buildRuinsHudSection(state, config, width) {
  const lines = buildRuinsHudLines(state, config, width);
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
    parts.push(`prod +${Math.round(output * 100)}%`);
  }
  if (hazard > 0) {
    parts.push(`risk -${Math.round(hazard * 100)}%`);
  }
  if (combat > 0) {
    parts.push(`combat +${Math.round(combat * 100)}%`);
  }
  if (drop > 0) {
    parts.push(`drop +${Math.round(drop * 100)}%`);
  }
  if (loss > 0) {
    parts.push(`loss -${Math.round(loss * 100)}%`);
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

// Format a small float with at most 2 decimal places.
function formatCompactFloat(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  const rounded = Math.round(numeric * 100) / 100;
  return String(rounded);
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

// Build a labeled bar line for HUD output.
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

// Format the season label with tick progress.
function formatSeasonLabel(season) {
  if (!season || !season.name) {
    return "-";
  }
  const tick = Number(season.tickInSeason || 0);
  const duration = Number(season.duration || 0);
  if (tick > 0 && duration > 0) {
    return `${season.name} ${tick}/${duration}`;
  }
  return String(season.name);
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

// Format the latest event for the HUD.
function formatLastEvent(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return "-";
  }
  return String(events[0]);
}

// Format the merchant status string.
function formatMerchantStatus(merchant) {
  if (!merchant || merchant.phase === "idle") {
    return "-";
  }
  if (merchant.phase === "trading") {
    const tradesMax = Number(merchant.tradesMax || 0);
    const tradesDone = Number(merchant.tradeCount || 0);
    if (tradesMax > 0) {
      return `trading ${tradesDone}/${tradesMax}`;
    }
    return "trading";
  }
  return String(merchant.phase);
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
    return `${colored} (${remaining}t)`;
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

// Build the myths HUD section with two sub-columns.
function buildMythsHudSection(state, config, width) {
  const mythsConfig = (config && config.myths) || {};
  if (mythsConfig.enabled === false) {
    return [];
  }
  const colors = getColorConfig(config);
  const header = applyColor("Myths", "hud_header", colors);
  const gap = 2;
  const columnWidth = getHudColumnWidth(width, 2, gap);
  if (columnWidth <= 0) {
    return [];
  }
  if (columnWidth < 12) {
    const fallback = buildMythsHudLines(state, config, width);
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

// Build single-column myths HUD lines (fallback).
function buildMythsHudLines(state, config, columnWidth) {
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

// Summarize mine/sawmill levels for the HUD.
function getStructureLevelSummary(structures, maxWidth) {
  if (!Array.isArray(structures)) {
    return "";
  }
  const entries = [];
  const collectLevel = (type, label, shortLabel) => {
    const match = structures.find(
      (structure) =>
        structure.type === type && Number.isFinite(Number(structure.level)),
    );
    if (!match) {
      return;
    }
    const level = Math.round(Number(match.level || 1));
    entries.push({ label, shortLabel, level });
  };

  collectLevel("mine", "Mine", "Mi");
  collectLevel("sawmill", "Sawmill", "Sm");
  collectLevel("brewery", "Brewery", "Br");
  collectLevel("mithril_forge", "Forge", "Fo");

  if (entries.length === 0) {
    return "";
  }

  const formatEntry = (entry, label, includeL, compactLevel) => {
    if (includeL) {
      return `${label} L${entry.level}`;
    }
    if (compactLevel) {
      return `${label}${entry.level}`;
    }
    return `${label} ${entry.level}`;
  };

  const summaries = [
    entries
      .map((entry) => formatEntry(entry, entry.label, true, false))
      .join(" | "),
    entries
      .map((entry) => formatEntry(entry, entry.shortLabel, true, false))
      .join(" | "),
    entries
      .map((entry) => formatEntry(entry, entry.shortLabel, false, true))
      .join(" "),
  ];

  const width = Math.max(0, Number(maxWidth || 0));
  if (width <= 0) {
    return summaries[0];
  }

  for (const summary of summaries) {
    if (fitLine(summary, width) === summary) {
      return summary;
    }
  }

  return fitLine(summaries[summaries.length - 1], width);
}

module.exports = {
  buildHudLines,
  formatColumns,
  getHudColumnWidth,
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
