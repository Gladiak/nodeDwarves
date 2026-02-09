'use strict';

const DEFAULT_THEME_ALERTS = {
  tracked_resources: ['food', 'water', 'beer'],
  stockpile_warning_ratio: 0.5,
  stockpile_critical_ratio: 0.25,
  morale_warning: 0.45,
  morale_critical: 0.3,
  shortage_warning_score: 1.5,
  shortage_critical_score: 2.5,
};

const DEFAULT_THEME_FOCUS = {
  enabled: false,
  compact_inset_on_critical: false,
  emphasize_inset_frame: true,
};

// Check whether a value is a plain object.
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Deep-merge plain objects while replacing arrays/scalars.
function deepMergeObjects(base, override) {
  const left = isPlainObject(base) ? base : {};
  const right = isPlainObject(override) ? override : {};
  const merged = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = deepMergeObjects(merged[key], value);
      continue;
    }
    if (isPlainObject(value)) {
      merged[key] = deepMergeObjects({}, value);
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

// Clamp a numeric value to [0, 1], falling back when invalid.
function clampUnit(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return clampUnit(fallback, 0);
  }
  return Math.max(0, Math.min(1, numeric));
}

// Resolve the active display theme (if configured and valid).
function resolveActiveTheme(config) {
  const display = (config && config.display) || {};
  const themeId = String(display.theme || '').trim();
  const themes = isPlainObject(display.themes) ? display.themes : {};
  if (!themeId || !isPlainObject(themes[themeId])) {
    return { id: null, definition: null };
  }
  return {
    id: themeId,
    definition: themes[themeId],
  };
}

// Build the merged display-color config from base colors + theme overrides.
function getResolvedDisplayColors(config) {
  const display = (config && config.display) || {};
  const baseColors = isPlainObject(display.colors) ? display.colors : {};
  const activeTheme = resolveActiveTheme(config);
  const themeColors = activeTheme.definition && isPlainObject(activeTheme.definition.colors)
    ? activeTheme.definition.colors
    : null;
  return themeColors ? deepMergeObjects(baseColors, themeColors) : deepMergeObjects(baseColors, {});
}

// Normalize alert thresholds from the active theme.
function resolveThemeAlerts(themeDefinition) {
  const alerts = themeDefinition && isPlainObject(themeDefinition.alerts)
    ? themeDefinition.alerts
    : {};
  const tracked = Array.isArray(alerts.tracked_resources)
    ? alerts.tracked_resources.map((value) => String(value || '').trim()).filter(Boolean)
    : DEFAULT_THEME_ALERTS.tracked_resources;
  return {
    tracked_resources: tracked.length > 0 ? tracked : DEFAULT_THEME_ALERTS.tracked_resources.slice(),
    stockpile_warning_ratio: clampUnit(
      alerts.stockpile_warning_ratio,
      DEFAULT_THEME_ALERTS.stockpile_warning_ratio,
    ),
    stockpile_critical_ratio: clampUnit(
      alerts.stockpile_critical_ratio,
      DEFAULT_THEME_ALERTS.stockpile_critical_ratio,
    ),
    morale_warning: clampUnit(alerts.morale_warning, DEFAULT_THEME_ALERTS.morale_warning),
    morale_critical: clampUnit(alerts.morale_critical, DEFAULT_THEME_ALERTS.morale_critical),
    shortage_warning_score: Math.max(
      0,
      Number.isFinite(Number(alerts.shortage_warning_score))
        ? Number(alerts.shortage_warning_score)
        : DEFAULT_THEME_ALERTS.shortage_warning_score,
    ),
    shortage_critical_score: Math.max(
      0,
      Number.isFinite(Number(alerts.shortage_critical_score))
        ? Number(alerts.shortage_critical_score)
        : DEFAULT_THEME_ALERTS.shortage_critical_score,
    ),
  };
}

// Normalize focus-mode settings from the active theme.
function resolveThemeFocus(themeDefinition) {
  const focus = themeDefinition && isPlainObject(themeDefinition.focus)
    ? themeDefinition.focus
    : {};
  return {
    enabled: focus.enabled === true ? true : DEFAULT_THEME_FOCUS.enabled,
    compact_inset_on_critical: focus.compact_inset_on_critical === true
      ? true
      : DEFAULT_THEME_FOCUS.compact_inset_on_critical,
    emphasize_inset_frame: focus.emphasize_inset_frame === false
      ? false
      : DEFAULT_THEME_FOCUS.emphasize_inset_frame,
  };
}

// Resolve color configuration from the display settings.
function getColorConfig(config) {
  const activeTheme = resolveActiveTheme(config);
  const colors = getResolvedDisplayColors(config);
  const enabled = colors.enabled !== false;
  const reset = colors.reset || '\x1b[0m';
  const map = colors.map || {};
  const theme = activeTheme.definition || null;
  const alerts = resolveThemeAlerts(theme);
  const focus = resolveThemeFocus(theme);
  return {
    enabled,
    reset,
    map,
    themeId: activeTheme.id,
    alerts,
    focus,
  };
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

module.exports = {
  getColorConfig,
  getResolvedDisplayColors,
  applyColor,
  colorizeLegend,
};
