'use strict';

const { stripAnsi } = require('../utils');
const { resolvePlace } = require('../place_identity');
const { applyColor } = require('./colors');

const IMPORTANCE_ORDER = Object.freeze(['ambient', 'notable', 'major', 'critical', 'legendary']);
const CELL_PRIORITY = Object.freeze({ path: 1, marker: 2, location: 3, actor: 4 });
const DEFAULT_OVERLAY = Object.freeze({
  enabled: true,
  minimumImportance: 'major',
  locationMinimumImportance: 'critical',
  maxActors: 2,
  radius: 1,
  maxMarkers: 4,
  cadenceTicks: 16,
  markerSymbol: '',
  showPaths: false,
  maxPathCells: 6,
  hideWhenModalOpen: true,
});

// Build one bounded render-only emphasis descriptor for the active Story Director focus.
function buildStoryFocusOverlay(state, config, runtime, activeDepth = 0, actorPositions = null) {
  const settings = resolveStoryFocusOverlayConfig(config);
  const focus = state && state.story && state.story.currentFocus;
  if (!settings.enabled || !focus || (settings.hideWhenModalOpen && hasBlockingOverlay(state))) {
    return null;
  }
  const importance = normalizeImportance(focus.importance);
  if (importanceRank(importance) < importanceRank(settings.minimumImportance)) return null;

  const event = findFocusedEvent(state, focus.eventId);
  const location = resolveFocusLocation(state, event && event.location, focus.placeId);
  const layer = resolveFocusLayer(location, runtime, activeDepth);
  const colorKey = resolveFocusColorKey(importance);
  const cells = [];
  const actorCells = collectActorCells(
    focus,
    event,
    actorPositions,
    runtime,
    settings.maxActors,
    colorKey,
  );
  cells.push(...actorCells);

  const locationEligible = importanceRank(importance)
    >= importanceRank(settings.locationMinimumImportance);
  if (locationEligible && layer.visible && layer.cell) {
    cells.push(buildCell(layer.cell.x, layer.cell.y, 'location', colorKey));
    if (isMarkerPhase(state && state.tick, settings.cadenceTicks)) {
      const markers = buildCardinalMarkers(layer.cell, settings, runtime, colorKey);
      cells.push(...markers);
    }
    if (settings.showPaths && actorCells.length > 0) {
      cells.push(...buildBoundedPath(
        actorCells[0],
        layer.cell,
        settings.maxPathCells,
        runtime,
        colorKey,
      ));
    }
  }

  const resolvedCells = deduplicateCells(cells);
  return {
    eventId: String(focus.eventId || ''),
    importance,
    colorKey,
    visibleLayer: layer.visible,
    cue: layer.cue,
    markerCount: resolvedCells.filter((cell) => cell.role === 'marker').length,
    actorCount: resolvedCells.filter((cell) => cell.role === 'actor').length,
    pathCount: resolvedCells.filter((cell) => cell.role === 'path').length,
    cells: resolvedCells,
  };
}

// Recolor bounded focus cells while preserving their existing map symbols by default.
function applyStoryFocusOverlay(grid, overlay, colors) {
  if (!overlay || !Array.isArray(overlay.cells)) return;
  for (const cell of overlay.cells) {
    if (!cell || !grid[cell.y] || grid[cell.y][cell.x] === undefined) continue;
    const existing = stripAnsi(grid[cell.y][cell.x]);
    const symbol = String(cell.symbol || existing || ' ')[0] || ' ';
    grid[cell.y][cell.x] = applyColor(symbol, cell.colorKey || overlay.colorKey, colors);
  }
}

// Normalize the visual budget independently from simulation and Director configuration.
function resolveStoryFocusOverlayConfig(config) {
  const raw = config && config.display && config.display.storyFocusOverlay
    ? config.display.storyFocusOverlay
    : {};
  return {
    enabled: raw.enabled !== false,
    minimumImportance: normalizeImportance(raw.minimumImportance || DEFAULT_OVERLAY.minimumImportance),
    locationMinimumImportance: normalizeImportance(
      raw.locationMinimumImportance || DEFAULT_OVERLAY.locationMinimumImportance,
    ),
    maxActors: clampInteger(raw.maxActors, DEFAULT_OVERLAY.maxActors, 0, 2),
    radius: clampInteger(raw.radius, DEFAULT_OVERLAY.radius, 1, 2),
    maxMarkers: clampInteger(raw.maxMarkers, DEFAULT_OVERLAY.maxMarkers, 0, 4),
    cadenceTicks: clampInteger(raw.cadenceTicks, DEFAULT_OVERLAY.cadenceTicks, 1, 1000),
    markerSymbol: normalizeMarkerSymbol(raw.markerSymbol),
    showPaths: raw.showPaths === true,
    maxPathCells: clampInteger(raw.maxPathCells, DEFAULT_OVERLAY.maxPathCells, 0, 12),
    hideWhenModalOpen: raw.hideWhenModalOpen !== false,
  };
}

function findFocusedEvent(state, eventId) {
  const id = String(eventId || '');
  const events = Array.isArray(state && state.eventLog) ? state.eventLog : [];
  return id ? events.find((entry) => entry && String(entry.id || '') === id) || null : null;
}

function resolveFocusLocation(state, rawLocation, placeIdFallback) {
  const location = rawLocation && typeof rawLocation === 'object' ? rawLocation : {};
  const placeId = String(location.placeId || placeIdFallback || '');
  const place = placeId ? resolvePlace(state, placeId) : null;
  const scope = normalizeScope(place && place.scope || location.scope);
  const resolvedDepth = normalizeCoordinate(
    place && place.depth,
    normalizeCoordinate(location.depth, 0),
  );
  return {
    scope,
    depth: scope === 'underrealm' ? Math.max(1, resolvedDepth) : 0,
    x: normalizeCoordinate(place && place.x, normalizeCoordinate(location.x, null)),
    y: normalizeCoordinate(place && place.y, normalizeCoordinate(location.y, null)),
  };
}

function resolveFocusLayer(location, runtime, activeDepthRaw) {
  const activeDepth = Math.max(0, Math.floor(Number(activeDepthRaw || 0)));
  if (!location || location.scope === 'world') {
    return { visible: false, cell: null, cue: null };
  }
  if (location.scope === 'surface' && activeDepth > 0) {
    return { visible: false, cell: null, cue: '↑ Surface' };
  }
  if (location.scope === 'underrealm' && location.depth !== activeDepth) {
    const arrow = location.depth > activeDepth ? '↓' : '↑';
    return { visible: false, cell: null, cue: `${arrow} Underrealm D${location.depth}` };
  }
  if (!Number.isSafeInteger(location.x) || !Number.isSafeInteger(location.y)) {
    return { visible: true, cell: null, cue: null };
  }
  const width = Math.max(0, Math.floor(Number(runtime && runtime.gridWidth || 0)));
  const height = Math.max(0, Math.floor(Number(runtime && runtime.gridHeight || 0)));
  if (location.x < 0 || location.y < 0 || location.x >= width || location.y >= height) {
    return {
      visible: false,
      cell: null,
      cue: `${resolveOffMapArrow(location, width, height)} Off-map`,
    };
  }
  return { visible: true, cell: { x: location.x, y: location.y }, cue: null };
}

function collectActorCells(focus, event, actorPositions, runtime, limit, colorKey) {
  if (!(actorPositions instanceof Map) || limit <= 0) return [];
  const ids = [];
  for (const rawId of Array.isArray(focus && focus.actorIds) ? focus.actorIds : []) {
    appendUnique(ids, rawId);
  }
  for (const actor of Array.isArray(event && event.actors) ? event.actors : []) {
    if (actor && actor.kind === 'dwarf') appendUnique(ids, actor.id);
  }
  const cells = [];
  for (const id of ids) {
    const position = actorPositions.get(id);
    if (!isGridCell(position, runtime)) continue;
    cells.push(buildCell(position.x, position.y, 'actor', colorKey));
    if (cells.length >= limit) break;
  }
  return cells;
}

function buildCardinalMarkers(center, settings, runtime, colorKey) {
  const candidates = [
    { x: center.x, y: center.y - settings.radius },
    { x: center.x + settings.radius, y: center.y },
    { x: center.x, y: center.y + settings.radius },
    { x: center.x - settings.radius, y: center.y },
  ];
  return candidates
    .filter((cell) => isGridCell(cell, runtime))
    .slice(0, settings.maxMarkers)
    .map((cell) => buildCell(cell.x, cell.y, 'marker', colorKey, settings.markerSymbol));
}

function buildBoundedPath(start, target, limit, runtime, colorKey) {
  if (!start || !target || limit <= 0) return [];
  let x = start.x;
  let y = start.y;
  const cells = [];
  while ((x !== target.x || y !== target.y) && cells.length < limit) {
    if (x !== target.x) x += x < target.x ? 1 : -1;
    else if (y !== target.y) y += y < target.y ? 1 : -1;
    if ((x === target.x && y === target.y) || !isGridCell({ x, y }, runtime)) continue;
    cells.push(buildCell(x, y, 'path', colorKey));
  }
  return cells;
}

function deduplicateCells(cells) {
  const byCoordinate = new Map();
  for (const cell of cells) {
    const key = `${cell.x},${cell.y}`;
    const previous = byCoordinate.get(key);
    if (!previous || CELL_PRIORITY[cell.role] > CELL_PRIORITY[previous.role]) {
      byCoordinate.set(key, cell);
    }
  }
  return [...byCoordinate.values()];
}

function buildCell(x, y, role, colorKey, symbol = '') {
  return { x: Math.floor(x), y: Math.floor(y), role, colorKey, symbol };
}

function isMarkerPhase(tickRaw, cadenceTicks) {
  const tick = Math.max(0, Math.floor(Number(tickRaw || 0)));
  return Math.floor(tick / cadenceTicks) % 2 === 0;
}

function isGridCell(cell, runtime) {
  const x = Number(cell && cell.x);
  const y = Number(cell && cell.y);
  const width = Math.max(0, Math.floor(Number(runtime && runtime.gridWidth || 0)));
  const height = Math.max(0, Math.floor(Number(runtime && runtime.gridHeight || 0)));
  return Number.isSafeInteger(x) && Number.isSafeInteger(y)
    && x >= 0 && y >= 0 && x < width && y < height;
}

function resolveOffMapArrow(location, width, height) {
  const horizontal = location.x < 0 ? '←' : location.x >= width ? '→' : '';
  const vertical = location.y < 0 ? '↑' : location.y >= height ? '↓' : '';
  return `${vertical}${horizontal}` || '→';
}

function resolveFocusColorKey(importance) {
  if (importance === 'legendary') return 'story_focus_legendary';
  if (importance === 'critical') return 'story_focus_critical';
  return 'story_focus_major';
}

function hasBlockingOverlay(state) {
  const ui = state && state.ui ? state.ui : {};
  return Boolean(
    (ui.inspect && ui.inspect.open)
    || (ui.legend && ui.legend.open)
    || (ui.telemetryPanel && ui.telemetryPanel.open)
    || (ui.warriorPanel && ui.warriorPanel.open)
    || (ui.eventLog && ui.eventLog.open)
    || (ui.saveMap && ui.saveMap.open)
    || (ui.transition && (ui.transition.active || ui.transition.showPanel)),
  );
}

function appendUnique(values, rawValue) {
  const value = String(rawValue || '');
  if (value && !values.includes(value)) values.push(value);
}

function normalizeScope(value) {
  const scope = String(value || 'world').toLowerCase();
  return ['surface', 'underrealm'].includes(scope) ? scope : 'world';
}

function normalizeCoordinate(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : fallback;
}

function normalizeImportance(value) {
  const importance = String(value || '').toLowerCase();
  return IMPORTANCE_ORDER.includes(importance) ? importance : 'major';
}

function importanceRank(value) {
  return Math.max(0, IMPORTANCE_ORDER.indexOf(normalizeImportance(value)));
}

function normalizeMarkerSymbol(value) {
  const text = String(value === undefined ? DEFAULT_OVERLAY.markerSymbol : value);
  return text.length > 0 ? text[0] : '';
}

function clampInteger(value, fallback, minimum, maximum) {
  const numeric = Number(value);
  const resolved = Number.isFinite(numeric) ? Math.floor(numeric) : fallback;
  return Math.max(minimum, Math.min(maximum, resolved));
}

module.exports = {
  applyStoryFocusOverlay,
  buildStoryFocusOverlay,
  resolveStoryFocusOverlayConfig,
};
