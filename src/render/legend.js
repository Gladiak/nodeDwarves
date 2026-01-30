'use strict';

const { padRight } = require('../utils');
const { getColorConfig, colorizeLegend } = require('./colors');
const { wrapLine } = require('./format');

// Build footer lines containing the legend and map key.
function buildFooterLines(config, runtime) {
  const height = Math.max(0, Number(runtime.footerHeight || 0));
  if (height === 0) {
    return [];
  }

  const width = Number(runtime.totalWidth || runtime.gridWidth || 0);
  const symbols = config.symbols || {};
  const colors = getColorConfig(config);
  const legendParts = [];
  const resourceConfig = config.resources || {};
  const nodeConfig = resourceConfig.nodes || {};
  const structureConfig = config.structures || {};
  const terrainConfig = (config.display && config.display.terrain) || {};
  const terrainSymbols = terrainConfig.symbols || {};
  const terrainEnabled = terrainConfig.enabled !== false && terrainSymbols && typeof terrainSymbols === 'object';

  legendParts.push(colorizeLegend(`${symbols.dwarf || '@'} dwarf`, 'dwarf', colors));
  for (const resource of Object.keys(nodeConfig)) {
    if (isTerrainMappedResource(resourceConfig, terrainSymbols, resource)) {
      continue;
    }
    const symbol = symbols[resource] || resource[0] || '?';
    legendParts.push(colorizeLegend(`${symbol} ${resource}`, resource, colors));
  }
  const houseLegend = getHouseLegendLabel(structureConfig.house);
  if (houseLegend) {
    legendParts.push(colorizeLegend(`${houseLegend} house`, 'house', colors));
  }
  const structureWhitelist = new Set(['house', 'well', 'field', 'workshop', 'brewery', 'sawmill', 'mine', 'watchtower']);
  for (const [type, definition] of Object.entries(structureConfig)) {
    if (type === 'house' && houseLegend) {
      continue;
    }
    if (!structureWhitelist.has(type)) {
      continue;
    }
    const count = Number(definition && definition.count !== undefined ? definition.count : definition);
    const hasDefinition = definition && typeof definition === 'object';
    if ((!Number.isFinite(count) || count <= 0) && !hasDefinition) {
      continue;
    }
    const symbol = symbols[type] || symbols.structure || '#';
    legendParts.push(colorizeLegend(`${symbol} ${type}`, type, colors));
  }

  const merchantConfig = config.merchant || {};
  if (merchantConfig.enabled !== false) {
    legendParts.push(colorizeLegend(`${symbols.merchant || 'M'} merchant`, 'merchant', colors));
  }

  const raidConfig = config.raids || {};
  const beastSymbol = getBeastSymbol(config);
  if (raidConfig.enabled === true && beastSymbol) {
    legendParts.push(colorizeLegend(`${beastSymbol} beasts`, 'beast', colors));
  }

  const legendLine = `Legend: ${legendParts.join('  ')}`;
  const lines = [];
  let terrainLine = '';
  if (terrainEnabled) {
    const terrainOrder = [
      'river',
      'lake',
      'mountain',
      'hill',
      'plain',
      'fertile',
      'food',
      'forest',
      'stone',
    ];
    const terrainParts = [];
    for (const type of terrainOrder) {
      const symbol = terrainSymbols[type];
      if (!symbol) {
        continue;
      }
      terrainParts.push(colorizeLegend(`${symbol} ${type}`, `terrain_${type}`, colors));
    }
    if (terrainParts.length > 0) {
      terrainLine = `Map: ${terrainParts.join('  ')}`;
    }
  }

  if (terrainLine && height >= 2) {
    const legendWrapped = wrapLine(legendLine, width);
    const terrainWrapped = wrapLine(terrainLine, width);
    const maxLegendLines = Math.max(0, height - 1);
    for (let i = 0; i < maxLegendLines; i += 1) {
      lines.push(padRight(legendWrapped[i] || '', width));
    }
    lines.push(padRight(terrainWrapped[0] || '', width));
    return lines.slice(0, height);
  }

  const wrapped = wrapLine(legendLine, width);
  for (let i = 0; i < height; i += 1) {
    lines.push(padRight(wrapped[i] || '', width));
  }

  return lines;
}

// Check if a resource is represented by terrain symbols.
function isTerrainMappedResource(resourceConfig, terrainSymbols, resourceId) {
  if (!resourceConfig || !resourceConfig.terrainAllowed) {
    return false;
  }
  const allowed = resourceConfig.terrainAllowed[resourceId];
  if (!Array.isArray(allowed) || allowed.length === 0) {
    return false;
  }
  if (!terrainSymbols || typeof terrainSymbols !== 'object') {
    return false;
  }
  return allowed.some((type) => Boolean(terrainSymbols[type]));
}

// Build a label for house level symbols.
function getHouseLegendLabel(houseConfig) {
  if (!houseConfig || !houseConfig.levels || typeof houseConfig.levels !== 'object') {
    return '';
  }
  const levels = Object.keys(houseConfig.levels)
    .map((key) => Number(key))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (levels.length === 0) {
    return '';
  }
  const min = levels[0];
  const max = levels[levels.length - 1];
  if (min === max) {
    return String(min);
  }
  return `${min}-${max}`;
}

// Resolve the symbol used for raid beasts.
function getBeastSymbol(config) {
  const symbols = config.symbols || {};
  if (symbols.beast) {
    return String(symbols.beast);
  }
  const raidConfig = config.raids || {};
  if (raidConfig.symbol) {
    return String(raidConfig.symbol);
  }
  return '';
}

module.exports = { buildFooterLines, getBeastSymbol };
