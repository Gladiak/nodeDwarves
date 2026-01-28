'use strict';

// Update the season state, advancing ticks and modifiers.
function updateSeason(state, config) {
  const seasons = config.seasons || {};
  const enabled = seasons.enabled !== false;
  if (!enabled) {
    state.season = null;
    return;
  }

  const order = Array.isArray(seasons.order) && seasons.order.length > 0
    ? seasons.order
    : ['spring', 'summer', 'autumn', 'winter'];
  const duration = Math.max(1, Number(seasons.durationTicks || 200));
  const seasonNumber = Math.floor((state.tick - 1) / duration);
  const seasonIndex = seasonNumber % order.length;
  const name = order[seasonIndex];
  const tickInSeason = ((state.tick - 1) % duration) + 1;
  const modifiers = (seasons.modifiers && seasons.modifiers[name]) || {};

  state.season = {
    name,
    index: seasonIndex,
    globalIndex: seasonNumber,
    tickInSeason,
    duration,
    modifiers,
  };
}

// Read a season modifier value with a safe fallback.
function getSeasonModifier(state, key, fallback) {
  const safeFallback = Number(fallback || 1);
  if (!state || !state.season || !state.season.modifiers) {
    return safeFallback;
  }
  const value = state.season.modifiers[key];
  return Number.isFinite(value) ? Number(value) : safeFallback;
}

module.exports = { updateSeason, getSeasonModifier };
