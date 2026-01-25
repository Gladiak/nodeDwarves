'use strict';

const { padRight } = require('./utils');

function renderFrame(state, config, runtime) {
  const symbols = config.symbols || {};
  const emptySymbol = symbols.empty || '.';

  const headerLines = buildHeaderLines(config, runtime);
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

  const hudLines = runtime.hudEnabled ? buildHudLines(state, config) : [];
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
  const symbols = config.symbols || {};

  const lines = [];
  lines.push(padRight(fitLine(title, width), width));

  if (height > 1) {
    const legendParts = [
      `${symbols.dwarf || '@'} dwarf`,
      `${symbols.food_raw || 'f'} food_raw`,
      `${symbols.water || 'w'} water`,
      `${symbols.wood || 't'} wood`,
      `${symbols.stone || 's'} stone`,
      `${symbols.ore || 'o'} ore`,
      `${symbols.structure || '#'} structure`,
      `${symbols.workshop || 'W'} workshop`,
    ];

    const legendLine = `Legend: ${legendParts.join('  ')}`;
    lines.push(padRight(fitLine(legendLine, width), width));
  }

  while (lines.length < height) {
    lines.push(padRight('', width));
  }

  return lines.slice(0, height);
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

function buildHudLines(state, config) {
  const lines = [];
  const dwarves = state.dwarves;
  const avgNeeds = averageNeeds(dwarves);
  const avgMorale = averageValue(dwarves, (d) => d.state.morale);
  const avgStress = averageValue(dwarves, (d) => d.state.stress);
  const idleCount = dwarves.filter((dwarf) => !dwarf.job).length;
  const topPriority = state.lastPriorities && state.lastPriorities[0]
    ? state.lastPriorities[0].resource
    : '-';
  const symbols = config.symbols || {};

  lines.push(`Tick: ${state.tick}`);
  lines.push(`Dwarves: ${dwarves.length}`);
  lines.push(`Idle: ${idleCount}`);
  lines.push(`Jobs: ${state.jobs.length}`);
  lines.push(`Priority: ${topPriority}`);
  lines.push('Queue');

  const queue = (state.lastPriorities || []).slice(0, 3);
  if (queue.length === 0) {
    lines.push('-');
  } else {
    for (const entry of queue) {
      lines.push(`${entry.resource}: ${entry.missing}`);
    }
  }

  lines.push('');
  lines.push('Stockpile');

  for (const [id, count] of Object.entries(state.stockpile)) {
    lines.push(`${id}: ${count}`);
  }

  lines.push('');
  lines.push('Avg needs');

  for (const [id, value] of Object.entries(avgNeeds)) {
    lines.push(`${id}: ${value.toFixed(2)}`);
  }

  lines.push('');
  lines.push(`Morale: ${avgMorale.toFixed(2)}`);
  lines.push(`Stress: ${avgStress.toFixed(2)}`);

  return lines;
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
