'use strict';

const { padRight, clamp } = require('../utils');
const { buildGridBase } = require('./grid');
const { buildHeaderLines } = require('./header');
const { buildFooterLines, getBeastSymbol } = require('./legend');
const { buildHudLines } = require('./hud');
const { getColorConfig, applyColor } = require('./colors');
const { formatMapLine } = require('./format');

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
        const level = Number(structure.level);
        if (Number.isFinite(level)) {
          const safeLevel = Math.round(clamp(level, 1, 9));
          symbol = String(safeLevel);
        } else {
          symbol = symbols.house || symbol;
        }
        colorKey = 'house';
      }
      grid[structure.y][structure.x] = applyColor(symbol, colorKey, colors);
    }
  }

  for (const dwarf of state.dwarves) {
    if (grid[dwarf.y] && grid[dwarf.y][dwarf.x] !== undefined) {
      grid[dwarf.y][dwarf.x] = applyColor(symbols.dwarf || '@', 'dwarf', colors);
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
