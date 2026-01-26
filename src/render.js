'use strict';

const { padRight, clamp } = require('./utils');

function renderFrame(state, config, runtime) {
  const symbols = config.symbols || {};
  const emptySymbol = symbols.empty || '.';

  const headerLines = buildHeaderLines(config, runtime);
  const footerLines = buildFooterLines(config, runtime);
  const grid = Array.from({ length: runtime.gridHeight }, () => {
    return new Array(runtime.gridWidth).fill(emptySymbol);
  });

  for (const node of state.nodes) {
    if (grid[node.y] && grid[node.y][node.x] !== undefined) {
      grid[node.y][node.x] = node.symbol;
    }
  }

  for (const structure of state.structures || []) {
    if (grid[structure.y] && grid[structure.y][structure.x] !== undefined) {
      grid[structure.y][structure.x] = structure.symbol;
    }
  }

  for (const dwarf of state.dwarves) {
    if (grid[dwarf.y] && grid[dwarf.y][dwarf.x] !== undefined) {
      grid[dwarf.y][dwarf.x] = symbols.dwarf || '@';
    }
  }

  const hudLines = runtime.hudEnabled ? buildHudLines(state, config, runtime) : [];
  const lines = [];

  for (const line of headerLines) {
    lines.push(line);
  }

  for (let y = 0; y < runtime.gridHeight; y += 1) {
    const gridLine = grid[y].join('');
    if (runtime.hudEnabled) {
      const hudLine = hudLines[y] || '';
      lines.push(`${gridLine} | ${padRight(hudLine, runtime.hudWidth)}`);
    } else {
      lines.push(gridLine);
    }
  }

  for (const line of footerLines) {
    lines.push(line);
  }

  return `${lines.join('\n')}\n`;
}

function buildHeaderLines(config, runtime) {
  const height = Math.max(0, Number(runtime.headerHeight || 0));
  if (height === 0) {
    return [];
  }

  const width = Number(runtime.totalWidth || runtime.gridWidth || 0);
  const headerConfig = (config.display && config.display.header) || {};
  const title = String(headerConfig.title || 'NodeDwarves Simulation');

  const lines = [];
  lines.push(padRight(fitLine(title, width), width));

  while (lines.length < height) {
    lines.push(padRight('', width));
  }

  return lines.slice(0, height);
}

function buildFooterLines(config, runtime) {
  const height = Math.max(0, Number(runtime.footerHeight || 0));
  if (height === 0) {
    return [];
  }

  const width = Number(runtime.totalWidth || runtime.gridWidth || 0);
  const symbols = config.symbols || {};
  const legendParts = [];
  const nodeConfig = (config.resources && config.resources.nodes) || {};
  const structureConfig = config.structures || {};

  legendParts.push(`${symbols.dwarf || '@'} dwarf`);
  for (const resource of Object.keys(nodeConfig)) {
    const symbol = symbols[resource] || resource[0] || '?';
    legendParts.push(`${symbol} ${resource}`);
  }
  for (const [type, definition] of Object.entries(structureConfig)) {
    const count = Number(definition && definition.count !== undefined ? definition.count : definition);
    const hasDefinition = definition && typeof definition === 'object';
    if ((!Number.isFinite(count) || count <= 0) && !hasDefinition) {
      continue;
    }
    const symbol = symbols[type] || symbols.structure || '#';
    legendParts.push(`${symbol} ${type}`);
  }

  const legendLine = `Legend: ${legendParts.join('  ')}`;
  const wrapped = wrapLine(legendLine, width);
  const lines = [];

  for (let i = 0; i < height; i += 1) {
    lines.push(padRight(wrapped[i] || '', width));
  }

  return lines;
}

function fitLine(value, width) {
  if (width <= 0) {
    return '';
  }
  const str = String(value);
  if (str.length <= width) {
    return str;
  }
  return str.slice(0, width);
}

function wrapLine(value, width) {
  if (width <= 0) {
    return [''];
  }
  let remaining = String(value);
  const lines = [];

  while (remaining.length > width) {
    const slice = remaining.slice(0, width);
    let splitIndex = slice.lastIndexOf(' ');
    if (splitIndex <= 0) {
      splitIndex = width;
    }
    lines.push(slice.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  lines.push(remaining);
  return lines;
}

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

function buildSingleHud(state, config, columnWidth) {
  const { left, right } = buildHudColumns(state, config, columnWidth);
  return left.concat([''], right);
}

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
  const wellCount = structures.filter((structure) => structure.type === 'well').length;
  const fieldCount = structures.filter((structure) => structure.type === 'field').length;
  const seasonLabel = formatSeasonLabel(state.season);
  const yearLabel = formatYearLabel(state, config);
  const lastEvent = formatLastEvent(state.events);
  const stageCounts = countLifeStages(dwarves);
  const targets = (config.resources && config.resources.targets) || {};
  const hudConfig = (config.display && config.display.hud) || {};
  const stockBarMax = Number(hudConfig.stockBarMax || 0);

  const left = [];
  left.push(`Tick: ${state.tick}`);
  left.push(`Year ${yearLabel}, Season ${seasonLabel}`);
  left.push(`Event: ${lastEvent}`);
  left.push(`Pop: ${dwarves.length}`);
  left.push(`Adult: ${stageCounts.adult}`);
  left.push(`Child: ${stageCounts.child}`);
  left.push(`Elder: ${stageCounts.elder}`);
  left.push(`Idle: ${idleCount}`);
  left.push(`Jobs: ${state.jobs.length}`);
  left.push(`Wells: ${wellCount}`);
  left.push(`Fields: ${fieldCount}`);
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
    const detail = maxValue > 0 ? `${count}/${maxValue}` : String(count);
    right.push(formatBarLine(id, ratio, detail, columnWidth));
  }

  right.push('');
  right.push('Queue');

  const queue = (state.lastPriorities || []).slice(0, 3);
  if (queue.length === 0) {
    right.push('-');
  } else {
    for (const entry of queue) {
      right.push(`${entry.resource}: ${entry.missing}`);
    }
  }

  return { left, right };
}

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

function getHudColumnWidth(totalWidth, columnCount, gap) {
  const usableWidth = Math.max(0, Number(totalWidth || 0));
  const gapWidth = Math.max(0, Number(gap || 0));
  const totalGap = gapWidth * (columnCount - 1);
  const columnWidth = Math.floor((usableWidth - totalGap) / columnCount);
  return Math.max(0, columnWidth);
}

function formatNeedValue(value) {
  const numeric = Number(value || 0);
  return numeric.toFixed(2);
}

function formatBarLine(label, ratio, details, columnWidth) {
  const safeWidth = Math.max(0, Number(columnWidth || 0));
  if (safeWidth <= 0) {
    return '';
  }

  const prefix = `${label}: `;
  let suffix = details ? ` ${details}` : '';
  let barWidth = safeWidth - prefix.length - suffix.length - 2;

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

function formatLastEvent(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return '-';
  }
  return String(events[0]);
}

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

function averageNeeds(dwarves) {
  const totals = {};
  const count = dwarves.length || 1;

  for (const dwarf of dwarves) {
    for (const [need, value] of Object.entries(dwarf.needs)) {
      totals[need] = (totals[need] || 0) + Number(value || 0);
    }
  }

  for (const need of Object.keys(totals)) {
    totals[need] = totals[need] / count;
  }

  return totals;
}

function averageValue(dwarves, selector) {
  if (dwarves.length === 0) {
    return 0;
  }

  const total = dwarves.reduce((sum, dwarf) => sum + Number(selector(dwarf) || 0), 0);
  return total / dwarves.length;
}

module.exports = { renderFrame };
