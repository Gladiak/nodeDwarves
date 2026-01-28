'use strict';

// Resolve color configuration from the display settings.
function getColorConfig(config) {
  const display = config.display || {};
  const colors = display.colors || {};
  const enabled = colors.enabled !== false;
  const reset = colors.reset || '\x1b[0m';
  const map = colors.map || {};
  return { enabled, reset, map };
}

// Apply an ANSI color code for a given key if enabled.
function applyColor(value, key, colors) {
  if (!colors || colors.enabled === false) {
    return String(value);
  }
  const code = colors.map && colors.map[key];
  if (!code) {
    return String(value);
  }
  return `${code}${value}${colors.reset}`;
}

// Convenience wrapper for coloring legend entries.
function colorizeLegend(value, key, colors) {
  return applyColor(value, key, colors);
}

module.exports = { getColorConfig, applyColor, colorizeLegend };
