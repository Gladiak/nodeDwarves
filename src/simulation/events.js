'use strict';

// Add a message to the rolling event list with a max length.
function pushEvent(state, config, message) {
  const eventsConfig = (config && config.events) || {};
  const maxEvents = Number(eventsConfig.maxEntries ?? 5);
  if (!message) {
    return;
  }
  state.events = Array.isArray(state.events) ? state.events : [];
  state.events.unshift(message);
  if (state.events.length > maxEvents) {
    state.events = state.events.slice(0, maxEvents);
  }
}

module.exports = { pushEvent };
