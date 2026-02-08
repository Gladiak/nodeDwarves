'use strict';

const { visibleLength, sliceVisible } = require('../utils');

// Return one map line (side telemetry layout removed).
function formatMapLine(mapLine) {
  return mapLine;
}

// Fit a string to the visible width.
function fitLine(value, width) {
  if (width <= 0) {
    return '';
  }
  const str = String(value);
  if (visibleLength(str) <= width) {
    return str;
  }
  return sliceVisible(str, width);
}

// Wrap a string into multiple lines by visible width.
function wrapLine(value, width) {
  if (width <= 0) {
    return [''];
  }
  let remaining = String(value);
  const lines = [];

  while (visibleLength(remaining) > width) {
    let splitIndex = findLastSpaceIndex(remaining, width);
    if (splitIndex <= 0) {
      const slice = sliceVisible(remaining, width);
      lines.push(slice);
      remaining = remaining.slice(slice.length).trimStart();
      continue;
    }
    while (splitIndex > 0 && remaining[splitIndex] === ' ') {
      splitIndex -= 1;
    }
    if (splitIndex <= 0) {
      const slice = sliceVisible(remaining, width);
      lines.push(slice);
      remaining = remaining.slice(slice.length).trimStart();
      continue;
    }
    lines.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex + 1).trimStart();
  }

  lines.push(remaining);
  return lines;
}

// Find the last space within a visible width.
function findLastSpaceIndex(value, width) {
  let visible = 0;
  let lastSpace = -1;

  for (let i = 0; i < value.length && visible < width; ) {
    if (value[i] === '\x1b') {
      const match = value.slice(i).match(/^\x1b\[[0-9;]*m/);
      if (match) {
        i += match[0].length;
        continue;
      }
    }
    if (value[i] === ' ') {
      lastSpace = i;
    }
    visible += 1;
    i += 1;
  }

  return lastSpace;
}

module.exports = { formatMapLine, fitLine, wrapLine, findLastSpaceIndex };
