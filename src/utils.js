'use strict';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function padRight(value, width) {
  const str = String(value);
  if (str.length >= width) {
    return str.slice(0, width);
  }
  return str.padEnd(width, ' ');
}

module.exports = { clamp, padRight };
