'use strict';

const { pushEvent } = require('./events');

// Advance the weather timer and pick a new weather state when needed.
function updateWeather(state, config) {
  const weatherConfig = (config && config.weather) || {};
  if (weatherConfig.enabled === false) {
    state.weather = null;
    return;
  }

  if (!state.weather || !state.weather.type) {
    state.weather = {
      type: String(weatherConfig.default || 'clear'),
      ticksRemaining: 0,
      duration: 0,
    };
  }

  const remaining = Number(state.weather.ticksRemaining || 0);
  if (remaining > 0) {
    state.weather.ticksRemaining = Math.max(0, remaining - 1);
    return;
  }

  const nextType = pickWeatherType(state, config);
  const duration = getWeatherDuration(weatherConfig, nextType);
  state.weather = {
    type: String(nextType || weatherConfig.default || 'clear'),
    ticksRemaining: duration,
    duration,
  };
  pushEvent(state, config, `Weather: ${formatWeatherName(state.weather.type)}`);
}

// Format a weather id for player-facing event strings.
function formatWeatherName(type) {
  const value = String(type || '');
  if (!value) {
    return '-';
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Resolve the current weather definition from config.
function getWeatherDefinition(state, config) {
  const weatherConfig = (config && config.weather) || {};
  const states = weatherConfig.states || {};
  if (!state || !state.weather || !state.weather.type) {
    return null;
  }
  return states[state.weather.type] || null;
}

// Read a numeric modifier from the active weather definition.
function getWeatherModifier(state, config, key, fallback) {
  const safeFallback = Number(fallback || 1);
  const def = getWeatherDefinition(state, config);
  if (!def || def[key] === undefined) {
    return safeFallback;
  }
  const value = Number(def[key]);
  return Number.isFinite(value) ? value : safeFallback;
}

// Build per-need decay multipliers from the active weather definition.
function getWeatherNeedMultipliers(state, config) {
  const def = getWeatherDefinition(state, config);
  const map = def && def.needDecayByNeed;
  if (!map || typeof map !== 'object') {
    return null;
  }
  const result = {};
  for (const [need, value] of Object.entries(map)) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      result[need] = numeric;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

// Choose the next weather type based on weights and season bias.
function pickWeatherType(state, config) {
  const weatherConfig = (config && config.weather) || {};
  const states = weatherConfig.states || {};
  const seasonName = state && state.season ? state.season.name : null;
  const seasonBias = seasonName && weatherConfig.seasonBias
    ? (weatherConfig.seasonBias[seasonName] || {})
    : {};
  const entries = [];
  let total = 0;

  for (const [type, def] of Object.entries(states)) {
    const baseWeight = Number(def && def.weight !== undefined ? def.weight : 1);
    if (!Number.isFinite(baseWeight) || baseWeight <= 0) {
      continue;
    }
    const bias = Number(seasonBias[type] !== undefined ? seasonBias[type] : 1);
    const weight = baseWeight * (Number.isFinite(bias) ? bias : 1);
    if (weight <= 0) {
      continue;
    }
    total += weight;
    entries.push({ type, weight });
  }

  if (entries.length === 0 || total <= 0) {
    return weatherConfig.default || 'clear';
  }

  const roll = Math.random() * total;
  let cursor = 0;
  for (const entry of entries) {
    cursor += entry.weight;
    if (roll <= cursor) {
      return entry.type;
    }
  }
  return entries[entries.length - 1].type;
}

// Resolve a weather duration using the configured range for the type.
function getWeatherDuration(weatherConfig, weatherType) {
  const states = (weatherConfig && weatherConfig.states) || {};
  const def = states[weatherType] || {};
  const range = def.durationTicks !== undefined ? def.durationTicks : weatherConfig.durationTicks;
  const min = Number(range && range.min !== undefined ? range.min : range);
  const max = Number(range && range.max !== undefined ? range.max : min);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return 200;
  }
  const low = Math.max(1, Math.min(min, max));
  const high = Math.max(low, Math.max(min, max));
  return Math.floor(low + Math.random() * (high - low + 1));
}

module.exports = {
  updateWeather,
  getWeatherModifier,
  getWeatherNeedMultipliers,
};
