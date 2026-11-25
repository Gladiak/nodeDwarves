'use strict';

// Strategic levers (STRATEGY.md S4b): the AI's high-level decisions in action space v2. Each lever
// is one action head with a value u in [0, 1]; u = 0.5 keeps the council default (the config
// value), u = 0 and u = 1 reach the configured `low` and `high` settings piecewise-linearly.
// Numeric levers override one or more config paths at their read sites through `getLeverSetting`;
// a group lever (`ventures`) lets the council stop restraining its groups when u >= `openAbove`
// (default 0.65, so the untrained midpoint keeps the council's restraint). Without lever values in the
// action (council play, v1 policies) nothing changes. RNG-free.

const LEVER_ACTION_PREFIX = 'lever_';

// Read a dotted config path.
function readPath(config, path) {
  return String(path).split('.').reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), config);
}

// Configured lever definitions in a stable order, or [] when levers are off.
function getLeverDefinitions(config) {
  const levers = config && config.ai && config.ai.levers;
  if (!levers || levers.enabled !== true || !levers.definitions || typeof levers.definitions !== 'object') {
    return [];
  }
  return Object.entries(levers.definitions).map(([name, raw]) => ({
    name,
    paths: Array.isArray(raw.paths) ? raw.paths.slice() : (raw.path ? [raw.path] : []),
    low: Number(raw.low),
    high: Number(raw.high),
    groups: Array.isArray(raw.groups) ? raw.groups.slice() : null,
    openAbove: Number.isFinite(Number(raw.openAbove)) ? Number(raw.openAbove) : 0.65,
  }));
}

// Action ids for the configured levers (`lever_<name>`).
function getLeverActionIds(config) {
  return getLeverDefinitions(config).map((definition) => `${LEVER_ACTION_PREFIX}${definition.name}`);
}

// True for action ids that are lever heads.
function isLeverActionId(actionId) {
  return String(actionId || '').startsWith(LEVER_ACTION_PREFIX);
}

// Map u in [0, 1] to a setting: low at 0, the config default at 0.5, high at 1.
function mapLeverValue(u, low, base, high) {
  const t = Math.min(1, Math.max(0, Number(u)));
  if (!Number.isFinite(t)) {
    return base;
  }
  // Written from the default outwards so the midpoint returns the default exactly.
  return t <= 0.5 ? base - (base - low) * (1 - t / 0.5) : base + (high - base) * ((t - 0.5) / 0.5);
}

// Resolve the action's lever values into state.levers (settings by config path, open groups).
function applyLevers(state, config, action) {
  const values = action && action.levers && typeof action.levers === 'object' ? action.levers : null;
  if (!values) {
    return;
  }
  const settings = {};
  const openGroups = [];
  const applied = {};
  for (const definition of getLeverDefinitions(config)) {
    const u = Number(values[definition.name]);
    if (!Number.isFinite(u)) {
      continue;
    }
    applied[definition.name] = Math.min(1, Math.max(0, u));
    if (definition.groups) {
      if (u >= definition.openAbove) {
        openGroups.push(...definition.groups);
      }
      continue;
    }
    for (const path of definition.paths) {
      const base = Number(readPath(config, path));
      if (!Number.isFinite(base) || !Number.isFinite(definition.low) || !Number.isFinite(definition.high)) {
        continue;
      }
      settings[path] = mapLeverValue(u, definition.low, base, definition.high);
    }
  }
  state.levers = { values: applied, settings, openGroups, tick: Number(state.tick || 0) };
}

// Setting chosen by a lever for a config path, or the caller's fallback.
function getLeverSetting(state, path, fallback) {
  const settings = state && state.levers && state.levers.settings;
  const value = settings ? Number(settings[path]) : NaN;
  return Number.isFinite(value) ? value : fallback;
}

// Groups the levers opened (the council stops restraining them).
function getLeverOpenGroups(state) {
  const groups = state && state.levers && state.levers.openGroups;
  return Array.isArray(groups) ? groups : [];
}

module.exports = {
  LEVER_ACTION_PREFIX,
  getLeverDefinitions,
  getLeverActionIds,
  isLeverActionId,
  mapLeverValue,
  applyLevers,
  getLeverSetting,
  getLeverOpenGroups,
};
