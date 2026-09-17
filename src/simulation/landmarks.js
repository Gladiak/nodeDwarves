'use strict';

const { clamp } = require('../utils');
const { registerPlace } = require('../place_identity');
const { isSpawnableTile } = require('./terrain');
const { getStockpileRatio, hasInputs, consumeInputs } = require('./resources');
const { isTempleFootprintCell } = require('./temple');
const { emitLandmarkEvent } = require('./landmark_events');

const LANDMARK_SCHEMA_VERSION = 1;
const LANDMARK_HARD_CAP = 8;
const CONDITION_NAMES = new Set(['planned', 'construction', 'active', 'prosperous', 'damaged', 'abandoned', 'restoration']);

// Create the bounded owner for unique settlement landmarks.
function createLandmarkState(config) {
  const settings = getSettings(config);
  const owner = {
    schemaVersion: LANDMARK_SCHEMA_VERSION,
    order: [],
    byId: {},
    maxActive: settings.maxActive,
    stats: { stagesBuilt: 0, completed: 0, damaged: 0, abandoned: 0, restored: 0 },
  };
  for (const definition of settings.definitions.slice(0, settings.maxActive)) {
    owner.order.push(definition.id);
    owner.byId[definition.id] = normalizeRecord(null, definition);
  }
  return owner;
}

// Repair serialized landmark data and reconcile it with configured definitions.
function ensureLandmarkState(state, config) {
  if (!state || typeof state !== 'object') return null;
  const settings = getSettings(config);
  const raw = state.landmarks && typeof state.landmarks === 'object'
    ? state.landmarks : createLandmarkState(config);
  const next = {
    schemaVersion: LANDMARK_SCHEMA_VERSION,
    order: [], byId: {}, maxActive: settings.maxActive,
    stats: { stagesBuilt: 0, completed: 0, damaged: 0, abandoned: 0, restored: 0 },
  };
  for (const key of Object.keys(next.stats)) {
    next.stats[key] = safeInt(raw.stats && raw.stats[key], 0);
  }
  const sourceById = raw.byId && typeof raw.byId === 'object' ? raw.byId : {};
  for (const definition of settings.definitions.slice(0, settings.maxActive)) {
    const existing = normalizeRecord(sourceById[definition.id], definition);
    next.order.push(definition.id);
    next.byId[definition.id] = existing;
  }
  state.landmarks = next;
  return next;
}

// Advance visible district conditions after combat and population changes commit.
function updateLandmarks(state, config, runtime) {
  const owner = ensureLandmarkState(state, config);
  const settings = getSettings(config);
  if (!owner || !settings.enabled) return owner;
  const population = Array.isArray(state.dwarves) ? state.dwarves.length : 0;
  for (const id of owner.order) {
    const landmark = owner.byId[id];
    const definition = settings.byId[id];
    if (!landmark || !definition) continue;
    if (landmark.site && !siteFitsRuntime(landmark.site, definition.maxRadius, runtime)) {
      landmark.site = null;
      landmark.placeId = null;
    }
    const structure = findLandmarkStructure(state, landmark);
    const severity = safeInt(structure && structure.siegeDamage && structure.siegeDamage.severity, 0);
    const previous = landmark.condition;
    if (severity > 0) {
      landmark.condition = 'damaged';
      if (landmark.lastDamageSeverity <= 0) owner.stats.damaged += 1;
    } else if (landmark.lastDamageSeverity > 0) {
      landmark.condition = 'restoration';
      landmark.restoredUntilTick = safeInt(state.tick, 0) + settings.restorationTicks;
      owner.stats.restored += 1;
    } else if (safeInt(state.tick, 0) < landmark.restoredUntilTick) {
      landmark.condition = 'restoration';
    } else if (landmark.stage <= 0) {
      landmark.condition = hasQueuedJob(state, id) ? 'construction' : 'planned';
    } else if (population < settings.abandonmentPopulation) {
      landmark.condition = 'abandoned';
      if (previous !== 'abandoned') owner.stats.abandoned += 1;
    } else if (hasQueuedJob(state, id)) {
      landmark.condition = 'construction';
    } else if (landmark.stage >= definition.stages.length && settlementProsperous(state, config, settings)) {
      landmark.condition = 'prosperous';
    } else {
      landmark.condition = 'active';
    }
    landmark.lastDamageSeverity = severity;
    if (previous !== landmark.condition) {
      landmark.lastConditionTick = safeInt(state.tick, 0);
      if (landmark.stage > 0 && ['damaged', 'abandoned', 'restoration'].includes(landmark.condition)) {
        emitLandmarkEvent(state, config, landmark, landmark.condition);
      }
    }
  }
  return owner;
}

// Return the next eligible landmark stage as a normal dwarf construction job.
function createLandmarkBuildJob(state, config, runtime, reservedPositions) {
  const owner = ensureLandmarkState(state, config);
  const settings = getSettings(config);
  if (!owner || !settings.enabled || !runtime) return null;
  if ((state.jobs || []).some((job) => job && job.type === 'build' && job.landmarkId)) return null;
  const lastStageTick = Math.max(0, ...owner.order.map((id) => safeInt(owner.byId[id] && owner.byId[id].lastBuildTick, 0)));
  if (lastStageTick > 0 && safeInt(state.tick, 0) - lastStageTick < settings.stageIntervalTicks) return null;
  const population = Array.isArray(state.dwarves) ? state.dwarves.length : 0;
  const cycles = safeInt(state.cycleStats && state.cycleStats.count, 0);
  for (const id of owner.order) {
    const landmark = owner.byId[id];
    const definition = settings.byId[id];
    if (!landmark || !definition || landmark.stage >= definition.stages.length) continue;
    if (population < definition.minPopulation || cycles < definition.minCycles) continue;
    const stage = definition.stages[landmark.stage];
    if (!passesStockpileGuard(state, config, definition.minResources)) continue;
    if (!hasInputs(state.stockpile, stage.buildCost)) continue;
    const site = ensureLandmarkSite(state, config, runtime, landmark, definition, settings);
    if (!site || (reservedPositions && reservedPositions.has(`${site.x},${site.y}`))) continue;
    if (hasQueuedJob(state, id)) continue;
    consumeInputs(state.stockpile, stage.buildCost);
    landmark.condition = 'construction';
    return {
      id: `job_${state.jobCounter++}`,
      type: 'build',
      structureType: `landmark_${id}`,
      landmarkId: id,
      landmarkStage: landmark.stage + 1,
      target: { x: site.x, y: site.y },
      workRemaining: stage.buildTicks,
      totalWork: stage.buildTicks,
      dwarfId: null,
      cost: { ...stage.buildCost },
    };
  }
  return null;
}

// Commit a completed construction stage and materialize its damageable center.
function completeLandmarkStageBuild(state, config, job, dwarf = null) {
  const owner = ensureLandmarkState(state, config);
  const settings = getSettings(config);
  const id = String(job && job.landmarkId || '');
  const landmark = owner && owner.byId[id];
  const definition = settings.byId[id];
  if (!landmark || !definition || !landmark.site) return { completed: false };
  const stageNumber = clamp(safeInt(job.landmarkStage, landmark.stage + 1), landmark.stage + 1, definition.stages.length);
  landmark.stage = stageNumber;
  landmark.condition = stageNumber >= definition.stages.length ? 'prosperous' : 'active';
  landmark.lastBuildTick = safeInt(state.tick, 0);
  owner.stats.stagesBuilt += 1;
  if (stageNumber >= definition.stages.length && !landmark.completedAtTick) {
    landmark.completedAtTick = safeInt(state.tick, 0);
    owner.stats.completed += 1;
  }
  let structure = findLandmarkStructure(state, landmark);
  if (!structure) {
    structure = {
      id: `landmark_${id}`,
      type: `landmark_${id}`,
      symbol: definition.symbol,
      capacity: 1,
      x: landmark.site.x,
      y: landmark.site.y,
      landmarkId: id,
      level: stageNumber,
    };
    state.structures.push(structure);
    landmark.structureId = structure.id;
  } else {
    structure.level = stageNumber;
    structure.symbol = definition.symbol;
  }
  emitLandmarkEvent(state, config, landmark, 'stage_completed', {
    stage: stageNumber,
    dwarf,
    message: `${definition.label}: stage ${stageNumber}/${definition.stages.length} complete`,
  });
  return { completed: true, id, stage: stageNumber, maxStage: definition.stages.length, fullyCompleted: stageNumber >= definition.stages.length };
}

// Test whether ordinary construction would collide with a reserved final footprint.
function isLandmarkFootprintCell(state, config, x, y) {
  const owner = state && state.landmarks;
  if (!owner || !owner.byId) return false;
  const settings = getSettings(config);
  return owner.order.some((id) => {
    const landmark = owner.byId[id];
    const definition = settings.byId[id];
    return landmark && landmark.site && definition
      && chebyshev(x, y, landmark.site.x, landmark.site.y) <= definition.maxRadius;
  });
}

// Return deterministic footprint and compact district tiles for rendering/export.
function getLandmarkRenderTiles(state, config, runtime) {
  const owner = state && state.landmarks;
  const settings = getSettings(config);
  if (!owner || !owner.byId || !settings.enabled) return [];
  const tiles = [];
  for (const id of owner.order) {
    const landmark = owner.byId[id];
    const definition = settings.byId[id];
    if (!landmark || !definition || !landmark.site) continue;
    const stage = definition.stages[Math.max(0, landmark.stage - 1)];
    const radius = landmark.stage > 0 ? stage.radius : 0;
    const conditionSymbol = settings.conditionSymbols[landmark.condition];
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const x = landmark.site.x + dx;
        const y = landmark.site.y + dy;
        if (!siteFitsRuntime({ x, y }, 0, runtime)) continue;
        const center = dx === 0 && dy === 0;
        tiles.push({
          x, y,
          symbol: center ? (conditionSymbol || definition.symbol) : definition.outlineSymbol,
          colorKey: center && settings.conditionColorKeys[landmark.condition]
            ? settings.conditionColorKeys[landmark.condition] : definition.colorKey,
          landmarkId: id,
        });
      }
    }
    if (settings.districtsEnabled && landmark.stage >= definition.stages.length) {
      for (const [dx, dy] of [[0, -radius - 1], [radius + 1, 0], [0, radius + 1], [-radius - 1, 0]]) {
        const x = landmark.site.x + dx;
        const y = landmark.site.y + dy;
        if (siteFitsRuntime({ x, y }, 0, runtime)) {
          tiles.push({ x, y, symbol: settings.districtSymbol, colorKey: definition.colorKey, landmarkId: id, district: true });
        }
      }
    }
  }
  return tiles;
}

// Expose a bounded read-only summary for telemetry and benchmark reports.
function getLandmarkStatus(state, config) {
  const owner = state && state.landmarks;
  const settings = getSettings(config);
  if (!owner || !owner.byId) return { enabled: settings.enabled, count: 0, completed: 0, conditions: {}, entries: [] };
  const entries = owner.order.map((id) => {
    const record = owner.byId[id];
    const definition = settings.byId[id];
    return record && definition ? {
      id, label: definition.label, stage: record.stage, maxStage: definition.stages.length,
      condition: record.condition, site: record.site ? { ...record.site } : null,
    } : null;
  }).filter(Boolean);
  const conditions = {};
  for (const entry of entries) conditions[entry.condition] = safeInt(conditions[entry.condition], 0) + 1;
  return {
    enabled: settings.enabled,
    count: entries.filter((entry) => entry.stage > 0).length,
    completed: entries.filter((entry) => entry.stage >= entry.maxStage).length,
    conditions,
    entries,
    stats: { ...(owner.stats || {}) },
  };
}

function ensureLandmarkSite(state, config, runtime, landmark, definition, settings = getSettings(config)) {
  if (landmark.site && siteAvailable(state, config, runtime, landmark.site.x, landmark.site.y, definition.maxRadius, landmark.id, settings)) {
    return landmark.site;
  }
  const center = resolveSettlementCenter(state, runtime);
  const candidates = [];
  for (let y = definition.maxRadius + 1; y < runtime.gridHeight - definition.maxRadius - 1; y += 1) {
    for (let x = definition.maxRadius + 1; x < runtime.gridWidth - definition.maxRadius - 1; x += 1) {
      if (!siteAvailable(state, config, runtime, x, y, definition.maxRadius, landmark.id, settings)) continue;
      const distance = Math.abs(x - center.x) + Math.abs(y - center.y);
      const targetPenalty = Math.abs(distance - definition.targetDistance);
      const stableTie = ((x * 73856093) ^ (y * 19349663) ^ hashText(landmark.id)) >>> 0;
      candidates.push({ x, y, score: targetPenalty * 100000 + stableTie % 100000 });
    }
  }
  candidates.sort((a, b) => a.score - b.score || a.y - b.y || a.x - b.x);
  const site = candidates[0] ? { x: candidates[0].x, y: candidates[0].y } : null;
  if (!site) return null;
  landmark.site = site;
  landmark.placeId = `landmark_${landmark.id}`;
  registerPlace(state, config, {
    id: landmark.placeId,
    kind: 'landmark',
    name: definition.label,
    shortName: definition.shortLabel,
    x: site.x,
    y: site.y,
  });
  return site;
}

function siteAvailable(state, config, runtime, x, y, radius, ownId, settings) {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const px = x + dx;
      const py = y + dy;
      if (!siteFitsRuntime({ x: px, y: py }, 0, runtime) || !isSpawnableTile(state, px, py)) return false;
      if (isTempleFootprintCell(state, config, px, py)) return false;
      if ((state.nodes || []).some((node) => node.x === px && node.y === py)) return false;
      if ((state.structures || []).some((structure) => structure.x === px && structure.y === py && structure.landmarkId !== ownId)) return false;
      const owner = state.landmarks;
      if (owner && owner.byId && owner.order.some((id) => {
        if (id === ownId) return false;
        const other = owner.byId[id];
        const otherDefinition = settings.byId[id];
        return other && other.site && otherDefinition
          && chebyshev(px, py, other.site.x, other.site.y) <= otherDefinition.maxRadius + 1;
      })) return false;
    }
  }
  return true;
}

function resolveSettlementCenter(state, runtime) {
  const village = state.villageCenter;
  if (village && Number.isFinite(village.x) && Number.isFinite(village.y)) return village;
  const houses = (state.structures || []).filter((entry) => entry.type === 'house');
  if (houses.length > 0) {
    return {
      x: Math.round(houses.reduce((sum, entry) => sum + entry.x, 0) / houses.length),
      y: Math.round(houses.reduce((sum, entry) => sum + entry.y, 0) / houses.length),
    };
  }
  return { x: Math.floor(runtime.gridWidth / 2), y: Math.floor(runtime.gridHeight / 2) };
}

function getSettings(config) {
  const raw = config && config.landmarks || {};
  const definitions = Object.entries(raw.definitions || {})
    .filter(([, value]) => value && value.enabled !== false)
    .map(([id, value], index) => normalizeDefinition(id, value, index))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .slice(0, LANDMARK_HARD_CAP);
  return {
    enabled: raw.enabled !== false,
    maxActive: clamp(safeInt(raw.max_active, 5), 0, LANDMARK_HARD_CAP),
    restorationTicks: clamp(safeInt(raw.restoration_ticks, 160), 1, 10000),
    stageIntervalTicks: clamp(safeInt(raw.stage_interval_ticks, 180), 0, 100000),
    abandonmentPopulation: clamp(safeInt(raw.abandonment_population, 8), 0, 10000),
    prosperityStockpileRatio: clamp(Number(raw.prosperity_stockpile_ratio ?? 0.75), 0, 1),
    districtsEnabled: !raw.districts || raw.districts.enabled !== false,
    districtSymbol: String(raw.districts && raw.districts.symbol || ':'),
    conditionSymbols: { construction: '%', damaged: 'x', abandoned: '?', restoration: '~', ...(raw.condition_symbols || {}) },
    conditionColorKeys: {
      construction: 'landmark_construction', damaged: 'landmark_damaged', abandoned: 'landmark_abandoned', restoration: 'landmark_restoration',
      ...(raw.condition_color_keys || {}),
    },
    definitions,
    byId: Object.fromEntries(definitions.map((entry) => [entry.id, entry])),
  };
}

function normalizeDefinition(id, raw, index) {
  const stages = (Array.isArray(raw.stages) ? raw.stages : []).slice(0, 5).map((stage, stageIndex) => ({
    id: stageIndex + 1,
    name: String(stage.name || `Stage ${stageIndex + 1}`),
    radius: clamp(safeInt(stage.radius, stageIndex > 0 ? 1 : 0), 0, 3),
    buildTicks: clamp(safeInt(stage.build_ticks, 80), 1, 100000),
    buildCost: normalizeCost(stage.build_cost),
  }));
  if (stages.length === 0) stages.push({ id: 1, name: 'Established', radius: 0, buildTicks: 80, buildCost: {} });
  return {
    id: String(id), label: String(raw.label || id), shortLabel: String(raw.short_label || raw.label || id).slice(0, 24),
    order: safeInt(raw.order, index), symbol: String(raw.symbol || id[0] || 'L'), outlineSymbol: String(raw.outline_symbol || '+'),
    colorKey: String(raw.color_key || `landmark_${id}`), minPopulation: safeInt(raw.build_min_population, 20),
    minCycles: safeInt(raw.build_min_cycles, 0), minResources: raw.build_min_resources || {},
    targetDistance: safeInt(raw.target_distance, 12), stages,
    maxRadius: Math.max(...stages.map((stage) => stage.radius)),
  };
}

function normalizeRecord(raw, definition) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const stage = clamp(safeInt(value.stage, 0), 0, definition.stages.length);
  const condition = CONDITION_NAMES.has(value.condition) ? value.condition : stage > 0 ? 'active' : 'planned';
  return {
    id: definition.id, kind: definition.id, label: definition.label, stage, condition,
    site: normalizeSite(value.site), placeId: value.placeId ? String(value.placeId) : null,
    structureId: value.structureId ? String(value.structureId) : null,
    completedAtTick: safeInt(value.completedAtTick, 0), lastBuildTick: safeInt(value.lastBuildTick, 0),
    lastConditionTick: safeInt(value.lastConditionTick, 0), lastDamageSeverity: safeInt(value.lastDamageSeverity, 0),
    restoredUntilTick: safeInt(value.restoredUntilTick, 0),
  };
}

function normalizeSite(raw) {
  const x = Number(raw && raw.x);
  const y = Number(raw && raw.y);
  return Number.isSafeInteger(x) && x >= 0 && Number.isSafeInteger(y) && y >= 0 ? { x, y } : null;
}
function normalizeCost(raw) {
  return Object.fromEntries(Object.entries(raw || {}).map(([key, value]) => [key, Math.max(0, Number(value || 0))]).filter(([, value]) => value > 0));
}
function passesStockpileGuard(state, config, guard) {
  return Object.entries(guard || {}).every(([resource, ratio]) => getStockpileRatio(state, config, resource) >= Number(ratio || 0));
}
function settlementProsperous(state, config, settings) {
  return ['food', 'water', 'wood', 'stone'].every((resource) => getStockpileRatio(state, config, resource) >= settings.prosperityStockpileRatio);
}
function findLandmarkStructure(state, landmark) {
  return (state.structures || []).find((entry) => entry && (entry.id === landmark.structureId || entry.landmarkId === landmark.id)) || null;
}
function hasQueuedJob(state, id) {
  return (state.jobs || []).some((job) => job && job.type === 'build' && job.landmarkId === id);
}
function siteFitsRuntime(site, radius, runtime) {
  return Boolean(site && runtime && site.x - radius >= 0 && site.y - radius >= 0 && site.x + radius < runtime.gridWidth && site.y + radius < runtime.gridHeight);
}
function chebyshev(ax, ay, bx, by) { return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); }
function safeInt(value, fallback) { const number = Number(value); return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback; }
function hashText(value) { let hash = 2166136261; for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return hash >>> 0; }

module.exports = {
  LANDMARK_HARD_CAP,
  LANDMARK_SCHEMA_VERSION,
  completeLandmarkStageBuild,
  createLandmarkBuildJob,
  createLandmarkState,
  ensureLandmarkState,
  getLandmarkRenderTiles,
  getLandmarkStatus,
  isLandmarkFootprintCell,
  updateLandmarks,
};
