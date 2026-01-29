'use strict';

const { clamp, padRight } = require('../utils');
const { getColorConfig, applyColor } = require('./colors');
const { fitLine } = require('./format');

// Build HUD lines based on column layout.
function buildHudLines(state, config, runtime) {
  const columns = Math.max(1, Number(runtime.hudColumns || 1));
  const gap = Math.max(0, Number(runtime.hudColumnGap || 2));
  const columnWidth = getHudColumnWidth(runtime.hudWidth, columns, gap);

  if (columns <= 1) {
    return buildSingleHud(state, config, columnWidth);
  }

  const { left, right } = buildHudColumns(state, config, columnWidth);
  return formatColumns([left, right], runtime.hudWidth, columns, gap);
}

// Build a single-column HUD layout.
function buildSingleHud(state, config, columnWidth) {
  const { left, right } = buildHudColumns(state, config, columnWidth);
  return left.concat([''], right);
}

// Build the left and right HUD columns.
function buildHudColumns(state, config, columnWidth) {
  const dwarves = state.dwarves;
  const avgNeeds = averageNeeds(dwarves);
  const avgMorale = averageValue(dwarves, (d) => d.state.morale);
  const avgStress = averageValue(dwarves, (d) => d.state.stress);
  const idleCount = dwarves.filter((dwarf) => !dwarf.job).length;
  const topPriority = state.lastPriorities && state.lastPriorities[0]
    ? state.lastPriorities[0].resource
    : '-';
  const structures = state.structures || [];
  const houseCount = structures.filter((structure) => structure.type === 'house').length;
  const wellCount = structures.filter((structure) => structure.type === 'well').length;
  const fieldCount = structures.filter((structure) => structure.type === 'field').length;
  const workshopCount = structures.filter((structure) => structure.type === 'workshop').length;
  const sawmillCount = structures.filter((structure) => structure.type === 'sawmill').length;
  const mineCount = structures.filter((structure) => structure.type === 'mine').length;
  const watchtowerCount = structures.filter((structure) => structure.type === 'watchtower').length;
  const housingConfig = (config.population && config.population.housing) || {};
  const housingEnabled = housingConfig.enabled !== false;
  const bedsTotal = housingEnabled
    ? structures
      .filter((structure) => structure.type === 'house')
      .reduce((sum, house) => sum + Math.max(0, Number(house.capacity || 0)), 0)
    : 0;
  const housingRatio = housingEnabled
    ? (bedsTotal > 0 ? bedsTotal / Math.max(1, dwarves.length) : 0)
    : 1;
  const towerConfig = (config.structures && config.structures.watchtower) || {};
  const towerRaid = towerConfig.raid || {};
  const towerDefensePer = Math.max(0, Number(towerRaid.defensePerTower ?? 0));
  const towerDefenseMax = clamp(Number(towerRaid.defenseMax ?? 0), 0, 1);
  const towerDefense = clamp(watchtowerCount * towerDefensePer, 0, towerDefenseMax);
  const seasonLabel = formatSeasonLabel(state.season);
  const yearLabel = formatYearLabel(state, config);
  const lastEvent = formatLastEvent(state.events);
  const stageCounts = countLifeStages(dwarves);
  const targets = (config.resources && config.resources.targets) || {};
  const hudConfig = (config.display && config.display.hud) || {};
  const stockBarMax = Number(hudConfig.stockBarMax || 0);
  const colors = getColorConfig(config);

  const left = [];
  left.push(`Tick: ${state.tick}`);
  left.push(`Year ${yearLabel}, Season ${seasonLabel}`);
  left.push(`Weather: ${formatWeatherStatus(state.weather, colors)}`);
  left.push(`Event: ${lastEvent}`);
  left.push(`Merchant: ${formatMerchantStatus(state.merchant)}`);
  left.push(`Pop: ${dwarves.length} (C:${stageCounts.child}/A:${stageCounts.adult}/E:${stageCounts.elder})`);
  left.push(`Idle: ${idleCount}`);
  left.push(`Jobs: ${state.jobs.length}`);
  left.push(`Houses: ${houseCount}`);
  left.push(`Wells: ${wellCount}`);
  left.push(`Fields: ${fieldCount}`);
  left.push(`Workshop: ${workshopCount}`);
  left.push(`Sawmills: ${sawmillCount}`);
  left.push(`Mines: ${mineCount}`);
  if (state.tools) {
    const maxLevel = Math.max(1, Number(state.tools.maxLevel || 1));
    const level = Math.min(maxLevel, Math.max(1, Number(state.tools.level || 1)));
    left.push(`Tools: L${level}/${maxLevel}`);
  }
  const structureLevels = getStructureLevelSummary(structures);
  if (structureLevels) {
    left.push(structureLevels);
  }
  left.push(`Towers: ${watchtowerCount}`);
  left.push(`Beds: ${bedsTotal}`);
  left.push(`Housing ratio: ${housingRatio.toFixed(2)}`);
  left.push(`Tower def: ${Math.round(towerDefense * 100)}%`);
  left.push(`Priority: ${topPriority}`);
  left.push('');
  left.push('Avg hunger/thirst');

  const hungerValue = Number(avgNeeds.hunger ?? 0);
  const thirstValue = Number(avgNeeds.thirst ?? 0);

  left.push(formatBarLine('Hunger', hungerValue, formatNeedValue(hungerValue), columnWidth));
  left.push(formatBarLine('Thirst', thirstValue, formatNeedValue(thirstValue), columnWidth));

  left.push('');
  left.push(`Morale: ${avgMorale.toFixed(2)}`);
  left.push(`Stress: ${avgStress.toFixed(2)}`);

  const right = [];
  right.push('Stockpile');

  for (const [id, count] of Object.entries(state.stockpile)) {
    const target = Number(targets[id] || 0);
    const maxValue = stockBarMax > 0 ? stockBarMax : target;
    const ratio = maxValue > 0 ? clamp(Number(count || 0) / maxValue, 0, 1) : 1;
    const detail = maxValue > 0
      ? formatCountDetail(count, maxValue)
      : formatCompactNumber(count);
    right.push(formatBarLine(id, ratio, detail, columnWidth));
  }

  const storage = state.houseStorage;
  if (storage && storage.stored) {
    right.push('');
    right.push('House storage');

    const entries = Object.entries(storage.stored);
    if (entries.length === 0) {
      right.push('-');
    } else {
      for (const [id, count] of entries) {
        const capacity = Number(storage.capacity && storage.capacity[id] !== undefined
          ? storage.capacity[id]
          : 0);
        const ratio = capacity > 0 ? clamp(Number(count || 0) / capacity, 0, 1) : 0;
        const detail = capacity > 0
          ? formatCountDetail(count, capacity)
          : formatCompactNumber(count || 0);
        right.push(formatBarLine(id, ratio, detail, columnWidth));
      }
    }
  }

  right.push('');
  right.push('Queue');

  const queue = (state.lastPriorities || []).slice(0, 3);
  if (queue.length === 0) {
    right.push('-');
  } else {
    for (const entry of queue) {
      right.push(`${entry.resource}: ${formatCompactNumber(entry.missing)}`);
    }
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
      const value = column[row] !== undefined ? column[row] : '';
      parts.push(padRight(value, columnWidth));
    }
    lines.push(parts.join(' '.repeat(gapWidth)));
  }

  return lines;
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
function formatNeedValue(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return '0';
  }
  return String(Math.round(numeric));
}

// Format a number compactly (k/m).
function formatCompactNumber(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return '0';
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
    return '';
  }

  const prefix = `${label}: `;
  let suffix = details ? ` ${details}` : '';
  let barWidth = safeWidth - prefix.length - suffix.length - 2;

  if (barWidth < 4 && suffix) {
    const maxDetails = Math.max(0, safeWidth - prefix.length - 2 - 4);
    if (maxDetails > 0 && details) {
      const trimmed = fitLine(String(details), maxDetails);
      suffix = trimmed ? ` ${trimmed}` : '';
      barWidth = safeWidth - prefix.length - suffix.length - 2;
    }
  }

  if (barWidth < 4 && suffix) {
    suffix = '';
    barWidth = safeWidth - prefix.length - 2;
  }

  if (barWidth < 4) {
    const fallback = details ? `${label}: ${details}` : `${label}: ${Number(ratio || 0).toFixed(2)}`;
    return fitLine(fallback, safeWidth);
  }

  const bar = makeBar(ratio, barWidth);
  return `${prefix}[${bar}]${suffix}`;
}

// Build a bar segment with filled and empty markers.
function makeBar(ratio, width) {
  const safeWidth = Math.max(0, Number(width || 0));
  if (safeWidth === 0) {
    return '';
  }
  const clamped = clamp(Number(ratio || 0), 0, 1);
  const filled = Math.round(clamped * safeWidth);
  const empty = Math.max(0, safeWidth - filled);
  return `${'#'.repeat(filled)}${'-'.repeat(empty)}`;
}

// Format the season label with tick progress.
function formatSeasonLabel(season) {
  if (!season || !season.name) {
    return '-';
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
    return '-';
  }
  const order = Array.isArray(seasons.order) && seasons.order.length > 0
    ? seasons.order
    : ['spring', 'summer', 'autumn', 'winter'];
  const duration = Math.max(1, Number(seasons.durationTicks || 200));
  const cycle = duration * order.length;
  if (cycle <= 0) {
    return '-';
  }
  const tick = Number(state.tick || 0);
  const year = Math.floor(Math.max(0, tick - 1) / cycle) + 1;
  return String(year);
}

// Format the latest event for the HUD.
function formatLastEvent(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return '-';
  }
  return String(events[0]);
}

// Format the merchant status string.
function formatMerchantStatus(merchant) {
  if (!merchant || merchant.phase === 'idle') {
    return '-';
  }
  if (merchant.phase === 'trading') {
    const tradesMax = Number(merchant.tradesMax || 0);
    const tradesDone = Number(merchant.tradeCount || 0);
    if (tradesMax > 0) {
      return `trading ${tradesDone}/${tradesMax}`;
    }
    return 'trading';
  }
  return String(merchant.phase);
}

// Format weather label with color and remaining ticks.
function formatWeatherStatus(weather, colors) {
  if (!weather || !weather.type) {
    return '-';
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
    clear: 'Clear',
    rain: 'Rain',
    storm: 'Storm',
    drought: 'Drought',
    cold: 'Cold',
  };
  if (labels[type]) {
    return labels[type];
  }
  if (!type) {
    return '-';
  }
  return type.charAt(0).toUpperCase() + type.slice(1);
}

// Count dwarves by life stage.
function countLifeStages(dwarves) {
  const counts = { child: 0, adult: 0, elder: 0 };
  for (const dwarf of dwarves) {
    const stage = dwarf.lifeStage || 'adult';
    if (counts[stage] !== undefined) {
      counts[stage] += 1;
    } else {
      counts.adult += 1;
    }
  }
  return counts;
}

// Compute average needs across all dwarves.
function averageNeeds(dwarves) {
  if (dwarves.length === 0) {
    return { hunger: 0, thirst: 0 };
  }

  const totals = {};
  for (const dwarf of dwarves) {
    for (const need of Object.keys(dwarf.needs || {})) {
      totals[need] = Number(totals[need] || 0) + Number(dwarf.needs[need] || 0);
    }
  }

  for (const need of Object.keys(totals)) {
    totals[need] = totals[need] / dwarves.length;
  }

  return totals;
}

// Compute average of a numeric selector.
function averageValue(dwarves, selector) {
  if (dwarves.length === 0) {
    return 0;
  }

  const total = dwarves.reduce((sum, dwarf) => sum + Number(selector(dwarf) || 0), 0);
  return total / dwarves.length;
}

// Summarize mine/sawmill levels for the HUD.
function getStructureLevelSummary(structures) {
  if (!Array.isArray(structures)) {
    return '';
  }
  const summary = [];
  const mineLevels = structures.filter((s) => s.type === 'mine' && Number.isFinite(Number(s.level)));
  if (mineLevels.length > 0) {
    const level = Math.round(Number(mineLevels[0].level || 1));
    summary.push(`Mine L${level}`);
  }
  const sawmillLevels = structures.filter((s) => s.type === 'sawmill' && Number.isFinite(Number(s.level)));
  if (sawmillLevels.length > 0) {
    const level = Math.round(Number(sawmillLevels[0].level || 1));
    summary.push(`Sawmill L${level}`);
  }
  if (summary.length === 0) {
    return '';
  }
  return summary.join(' | ');
}

module.exports = {
  buildHudLines,
  formatColumns,
  getHudColumnWidth,
  formatNeedValue,
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
  averageNeeds,
  averageValue,
};
