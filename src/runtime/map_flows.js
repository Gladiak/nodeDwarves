'use strict';

const MODES = ['off', 'all', 'gather', 'work', 'trade'];
const LABELS = { off: 'Off', all: 'All', gather: 'Gathering', work: 'Colony work', trade: 'Trade' };

// Keep the observer outside simulation state and saves; only adjacent observed moves become flow marks.
function createMapFlows(config) {
  const raw = config.display?.map_flows || {};
  const bounded = (value, fallback, max) => Number.isFinite(Number(value))
    ? Math.max(1, Math.min(max, Math.floor(Number(value)))) : fallback;
  return { enabled: raw.enabled !== false, mode: MODES.includes(raw.default_mode) ? raw.default_mode : 'off',
    retentionTicks: bounded(raw.retention_ticks, 120, 1200), maxActors: bounded(raw.max_actors, 1024, 4096),
    maxSegments: bounded(raw.max_segments, 4096, 16384), maxCells: bounded(raw.max_cells, 180, 1000),
    previous: new Map(), segments: new Map(), world: null, lastTick: null };
}

// Cycle presentation modes without touching policy actions, jobs or random draws.
function cycleMapFlows(tracker) {
  if (!tracker?.enabled) return 'off';
  tracker.mode = MODES[(MODES.indexOf(tracker.mode) + 1) % MODES.length];
  tracker.previous.clear();
  return tracker.mode;
}

// Collect bounded authoritative surface coordinates; deep renderer positions are intentionally excluded.
function collectActors(state, tracker, runtime) {
  const actors = new Map();
  const add = (id, entity, family) => {
    if (actors.size >= tracker.maxActors || !Number.isInteger(entity?.x) || !Number.isInteger(entity?.y)
        || entity.x < 0 || entity.y < 0 || entity.x >= runtime.gridWidth || entity.y >= runtime.gridHeight) return;
    actors.set(id, { x: entity.x, y: entity.y, family });
  };
  // Reserve trade actors first so high populations cannot hide caravans.
  if (state.merchant && state.merchant.phase !== 'idle') add('merchant', state.merchant, 'trade');
  for (const caravan of state.externalCamps?.caravans || []) add(`caravan:${caravan.id}`, caravan, 'trade');
  for (const dwarf of state.dwarves || []) {
    if (actors.size >= tracker.maxActors) break;
    if ((dwarf.underrealmDuty?.active !== false && dwarf.underrealmDuty?.depth > 0) || dwarf.expedition) continue;
    const family = dwarf.job?.type === 'gather' ? 'gather' : dwarf.job ? 'work' : null;
    add(`dwarf:${dwarf.id}`, dwarf, family);
  }
  return actors;
}

// Sample once per simulation tick, including every tick within accelerated frame batches.
function observeMapFlows(tracker, state, runtime) {
  if (!tracker?.enabled || tracker.mode === 'off') return;
  const world = `${state.cycleStats?.count || 0}:${runtime.gridWidth}:${runtime.gridHeight}`;
  const tick = Number(state.tick || 0);
  if (tracker.world !== world || tracker.lastTick !== null && tick < tracker.lastTick) {
    tracker.previous.clear(); tracker.segments.clear(); tracker.lastTick = null; tracker.world = world;
  }
  if (tick === tracker.lastTick) return;
  const actors = collectActors(state, tracker, runtime);
  if (tracker.lastTick === tick - 1) {
    for (const [id, current] of actors) {
      const previous = tracker.previous.get(id);
      if (!previous) continue;
      const dx = current.x - previous.x; const dy = current.y - previous.y;
      const family = previous.family || current.family;
      if (!family || Math.abs(dx) + Math.abs(dy) !== 1) continue;
      const key = `${family}:${current.x},${current.y}:${dx},${dy}`;
      const visits = Math.min(65535, (tracker.segments.get(key)?.visits || 0) + 1);
      tracker.segments.delete(key);
      tracker.segments.set(key, { x: current.x, y: current.y, dx, dy, family, tick, visits });
    }
  }
  tracker.previous = actors; tracker.lastTick = tick;
  for (const [key, segment] of tracker.segments) {
    if (segment.tick < tick - tracker.retentionTicks || tracker.segments.size > tracker.maxSegments) tracker.segments.delete(key);
    else break;
  }
}

// Read a bounded recent overlay; drawing never infers paths or advances the observer.
function getMapFlowOverlay(tracker, state) {
  const depth = Number(state.underrealm?.activeDepth || 0);
  if (!tracker?.enabled || tracker.mode === 'off') return { mode: 'off', label: 'Off', cells: [] };
  if (depth > 0) return { mode: tracker.mode, label: 'Surface only', cells: [] };
  const tick = Number(state.tick || 0);
  if (tracker.lastTick !== null && tick < tracker.lastTick
      || tracker.world && !tracker.world.startsWith(`${state.cycleStats?.count || 0}:`)) {
    return { mode: tracker.mode, label: LABELS[tracker.mode], cells: [] };
  }
  const cells = new Map();
  const segments = [...tracker.segments.values()].filter((entry) => entry.tick >= tick - tracker.retentionTicks
    && (tracker.mode === 'all' || tracker.mode === entry.family));
  segments.sort((a, b) => b.tick - a.tick || b.visits - a.visits || a.y - b.y || a.x - b.x || a.family.localeCompare(b.family));
  for (const entry of segments) {
    const key = `${entry.x},${entry.y}`;
    if (cells.has(key)) continue;
    cells.set(key, { ...entry, symbol: entry.dx > 0 ? '>' : entry.dx < 0 ? '<' : entry.dy > 0 ? 'v' : '^',
      colorKey: `flow_${entry.family}` });
    if (cells.size >= tracker.maxCells) break;
  }
  return { mode: tracker.mode, label: LABELS[tracker.mode], cells: [...cells.values()] };
}

module.exports = { createMapFlows, cycleMapFlows, observeMapFlows, getMapFlowOverlay };
