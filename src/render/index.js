'use strict';

const { padRight, clamp } = require('../utils');
const { buildGridBase } = require('./grid');
const { buildHeaderLines } = require('./header');
const { buildFooterLines, getBeastSymbol } = require('./legend');
const { buildLegendPanel, applyLegendPanel } = require('./legend_panel');
const { buildHudLines } = require('./hud');
const { getColorConfig, applyColor } = require('./colors');
const { formatMapLine } = require('./format');
const { buildInspectPanel, applyInspectPanel } = require('./inspect');
const { buildSavePanel, applySavePanel } = require('./save_panel');
const { applyTransitionMask, buildTransitionPanel, applyTransitionPanel } = require('./transition');

// Render a full frame including map, HUD, header, and footer.
function renderFrame(state, config, runtime) {
  const symbols = config.symbols || {};
  const colors = getColorConfig(config);
  const emptySymbol = symbols.empty || '.';
  const frameConfig = (config.display && config.display.frame) || {};
  const frameEnabled = runtime.frameEnabled !== undefined
    ? runtime.frameEnabled
    : frameConfig.enabled === true;
  const frameSymbols = getFrameSymbols(frameConfig);

  const headerLines = buildHeaderLines(config, runtime);
  const footerLines = buildFooterLines(config, runtime);
  const grid = buildGridBase(state, config, runtime, colors, emptySymbol);
  const structurePositions = new Set();
  const dwarfPositions = new Set();

  for (const node of state.nodes) {
    if (grid[node.y] && grid[node.y][node.x] !== undefined) {
      grid[node.y][node.x] = applyColor(node.symbol, node.id, colors);
    }
  }

  for (const structure of state.structures || []) {
    if (grid[structure.y] && grid[structure.y][structure.x] !== undefined) {
      let symbol = structure.symbol;
      let colorKey = structure.type;
      if (structure.type === 'house') {
        symbol = symbols.house || symbol;
        colorKey = 'house';
      }
      grid[structure.y][structure.x] = applyColor(symbol, colorKey, colors);
      structurePositions.add(`${structure.x},${structure.y}`);
    }
  }

  const visibleDwarves = selectVisibleDwarves(state, config, runtime);
  for (const dwarf of visibleDwarves) {
    const draw = resolveDwarfRenderPosition(dwarf, state.structures, runtime, structurePositions, dwarfPositions);
    if (draw && grid[draw.y] && grid[draw.y][draw.x] !== undefined) {
      grid[draw.y][draw.x] = applyColor(symbols.dwarf || '@', 'dwarf', colors);
      dwarfPositions.add(`${draw.x},${draw.y}`);
    }
  }

  const wildlife = state.wildlife;
  if (wildlife && Array.isArray(wildlife.herds)) {
    const herdSymbol = symbols.herd || '&';
    for (const herd of wildlife.herds) {
      if (!herd || Number(herd.remaining || 0) <= 0) {
        continue;
      }
      const offsets = Array.isArray(herd.offsets) && herd.offsets.length > 0
        ? herd.offsets
        : [{ dx: 0, dy: 0 }];
      for (const offset of offsets) {
        const x = herd.x + Number(offset.dx || 0);
        const y = herd.y + Number(offset.dy || 0);
        if (grid[y] && grid[y][x] !== undefined) {
          grid[y][x] = applyColor(herdSymbol, 'herd', colors);
        }
      }
    }
  }

  const raidState = state.raid;
  const beastSymbol = getBeastSymbol(config);
  if (raidState && raidState.active && beastSymbol && Array.isArray(raidState.beasts)) {
    for (const beast of raidState.beasts) {
      if (grid[beast.y] && grid[beast.y][beast.x] !== undefined) {
        grid[beast.y][beast.x] = applyColor(beastSymbol, 'beast', colors);
      }
    }
  }

  const merchant = state.merchant;
  if (merchant && merchant.phase && merchant.phase !== 'idle') {
    if (grid[merchant.y] && grid[merchant.y][merchant.x] !== undefined) {
      grid[merchant.y][merchant.x] = applyColor(symbols.merchant || 'M', 'merchant', colors);
    }
  }

  applyTransitionMask(grid, state.ui ? state.ui.transition : null, runtime);

  const legendPanel = buildLegendPanel(state, config, runtime);
  if (legendPanel) {
    applyLegendPanel(grid, legendPanel, colors);
  }

  const inspectPanel = buildInspectPanel(state, config, runtime);
  if (inspectPanel) {
    applyInspectPanel(grid, inspectPanel, colors);
  }

  const savePanel = buildSavePanel(state, config, runtime);
  if (savePanel) {
    applySavePanel(grid, savePanel, colors);
  }

  const transitionPanel = buildTransitionPanel(state, config, runtime);
  if (transitionPanel) {
    applyTransitionPanel(grid, transitionPanel, colors);
  }

  const hudLines = runtime.hudEnabled ? buildHudLines(state, config, runtime) : [];
  const lines = [];

  for (const line of headerLines) {
    lines.push(line);
  }

  if (frameEnabled) {
    const topLine = applyColor(
      `${frameSymbols.topLeft}${frameSymbols.horizontal.repeat(runtime.gridWidth)}${frameSymbols.topRight}`,
      'frame',
      colors,
    );
    lines.push(formatMapLine(topLine, '', runtime));
  }

  for (let y = 0; y < runtime.gridHeight; y += 1) {
    const gridLine = grid[y].join('');
    if (runtime.hudEnabled) {
      const hudLine = hudLines[y] || '';
      const mapLine = frameEnabled
        ? `${applyColor(frameSymbols.vertical, 'frame', colors)}${gridLine}${applyColor(frameSymbols.vertical, 'frame', colors)}`
        : gridLine;
      lines.push(`${mapLine} | ${padRight(hudLine, runtime.hudWidth)}`);
    } else {
      const mapLine = frameEnabled
        ? `${applyColor(frameSymbols.vertical, 'frame', colors)}${gridLine}${applyColor(frameSymbols.vertical, 'frame', colors)}`
        : gridLine;
      lines.push(mapLine);
    }
  }

  if (frameEnabled) {
    const bottomLine = applyColor(
      `${frameSymbols.bottomLeft}${frameSymbols.horizontal.repeat(runtime.gridWidth)}${frameSymbols.bottomRight}`,
      'frame',
      colors,
    );
    lines.push(formatMapLine(bottomLine, '', runtime));
  }

  for (const line of footerLines) {
    lines.push(line);
  }

  return `${lines.join('\n')}\n`;
}

// Select a stable subset of dwarves to render for readability.
function selectVisibleDwarves(state, config, runtime) {
  const dwarves = state.dwarves || [];
  const display = (config.display && config.display.dwarves) || {};
  const maxVisible = Math.max(0, Number(display.maxVisible ?? 0));
  if (!maxVisible || dwarves.length <= maxVisible) {
    return dwarves;
  }
  const adults = dwarves.filter((dwarf) => dwarf.lifeStage === 'adult');
  const nonAdults = dwarves.filter((dwarf) => dwarf.lifeStage !== 'adult');
  const useAdultsOnly = adults.length >= maxVisible;
  const pool = useAdultsOnly ? adults : adults.concat(nonAdults);
  if (pool.length <= maxVisible) {
    return pool;
  }
  if (!state.renderState) {
    state.renderState = {};
  }
  const renderState = state.renderState;
  const prevIds = Array.isArray(renderState.visibleDwarfIds) ? renderState.visibleDwarfIds : [];
  const dwarfById = new Map(pool.map((dwarf) => [dwarf.id, dwarf]));
  const visible = [];
  const used = new Set();

  for (const id of prevIds) {
    const dwarf = dwarfById.get(id);
    if (!dwarf) {
      continue;
    }
    visible.push(dwarf);
    used.add(id);
    if (visible.length >= maxVisible) {
      break;
    }
  }

  if (visible.length < maxVisible) {
    const remainingAdults = adults.filter((dwarf) => !used.has(dwarf.id));
    const remainingOthers = nonAdults.filter((dwarf) => !used.has(dwarf.id));
    shuffleInPlace(remainingAdults);
    shuffleInPlace(remainingOthers);
    const candidates = useAdultsOnly ? remainingAdults : remainingAdults.concat(remainingOthers);
    const needed = maxVisible - visible.length;
    for (let i = 0; i < needed && i < candidates.length; i += 1) {
      visible.push(candidates[i]);
    }
  }

  renderState.visibleDwarfIds = visible.map((dwarf) => dwarf.id);
  return visible;
}

// Resolve a stable render center based on housing or the grid.
function getRenderCenter(state, runtime) {
  const houses = (state.structures || []).filter((structure) => structure.type === 'house');
  if (houses.length > 0) {
    const sum = houses.reduce((acc, house) => {
      acc.x += Number(house.x || 0);
      acc.y += Number(house.y || 0);
      return acc;
    }, { x: 0, y: 0 });
    return {
      x: clamp(Math.round(sum.x / houses.length), 0, runtime.gridWidth - 1),
      y: clamp(Math.round(sum.y / houses.length), 0, runtime.gridHeight - 1),
    };
  }
  return {
    x: Math.floor(runtime.gridWidth / 2),
    y: Math.floor(runtime.gridHeight / 2),
  };
}

// Shuffle a list in place using Fisher-Yates.
function shuffleInPlace(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
  }
  return list;
}

// Resolve render position for a dwarf, offsetting miners next to their mine.
function resolveDwarfRenderPosition(dwarf, structures, runtime, structurePositions, dwarfPositions) {
  if (!dwarf || !runtime) {
    return null;
  }
  const base = { x: dwarf.x, y: dwarf.y };
  const job = dwarf.job;
  if (!job || job.type !== 'mine') {
    return base;
  }
  const mine = Array.isArray(structures)
    ? structures.find((structure) => structure.id === job.structureId && structure.type === 'mine')
    : null;
  if (!mine) {
    return base;
  }
  const offsets = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  for (const offset of offsets) {
    const x = mine.x + offset.x;
    const y = mine.y + offset.y;
    if (x < 0 || y < 0 || x >= runtime.gridWidth || y >= runtime.gridHeight) {
      continue;
    }
    const key = `${x},${y}`;
    if (structurePositions.has(key) || dwarfPositions.has(key)) {
      continue;
    }
    return { x, y };
  }
  return base;
}

// Normalize frame symbol characters.
function getFrameSymbols(frameConfig) {
  const pick = (value, fallback) => {
    const str = String(value || fallback);
    return str.length > 0 ? str[0] : fallback;
  };
  return {
    horizontal: pick(frameConfig.horizontal, '-'),
    vertical: pick(frameConfig.vertical, '|'),
    topLeft: pick(frameConfig.topLeft, '+'),
    topRight: pick(frameConfig.topRight, '+'),
    bottomLeft: pick(frameConfig.bottomLeft, '+'),
    bottomRight: pick(frameConfig.bottomRight, '+'),
  };
}

module.exports = { renderFrame };
