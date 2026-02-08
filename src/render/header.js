'use strict';

const { padRight } = require('../utils');
const { fitLine } = require('./format');

// Build header lines for the frame header band.
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

module.exports = { buildHeaderLines };
