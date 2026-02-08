'use strict';

const { clamp } = require('../utils');

// Check whether a tile is walkable based on terrain data.
function isWalkableTile(state, x, y) {
  const terrain = state && state.terrain;
  if (!terrain || !terrain.walkable || !terrain.walkable[y]) {
    return true;
  }
  return Boolean(terrain.walkable[y][x]);
}

// Check whether a tile can spawn entities based on terrain data.
function isSpawnableTile(state, x, y) {
  const terrain = state && state.terrain;
  if (terrain && terrain.spawnable && terrain.spawnable[y]) {
    return Boolean(terrain.spawnable[y][x]);
  }
  return isWalkableTile(state, x, y);
}

// Read the terrain type at a position, if available.
function getTerrainTypeAt(state, x, y) {
  const terrain = state && state.terrain;
  if (!terrain || !terrain.types || !terrain.types[y]) {
    return null;
  }
  return terrain.types[y][x] || null;
}

// Check if any allowed terrain resource is within a distance of the anchor.
function hasTerrainResourceWithin(state, config, resourceId, anchor, maxDistance) {
  if (!state || !config || !anchor) {
    return false;
  }
  const resources = config.resources || {};
  if (resources.useTerrainTiles !== true) {
    return false;
  }
  const allowed = Array.isArray(resources.terrainAllowed && resources.terrainAllowed[resourceId])
    ? resources.terrainAllowed[resourceId]
    : [];
  if (allowed.length === 0) {
    return false;
  }
  const index = ensureTerrainIndex(state);
  if (!index) {
    return false;
  }
  const radius = Math.max(0, Math.floor(Number(maxDistance || 0)));
  for (const type of allowed) {
    const list = index.typePositions[type];
    if (!list || list.length === 0) {
      continue;
    }
    for (const pos of list) {
      const dist = Math.abs(pos.x - anchor.x) + Math.abs(pos.y - anchor.y);
      if (dist <= radius) {
        return true;
      }
    }
  }
  return false;
}

// Resolve the movement delay for a specific terrain type.
function getTerrainMoveDelay(state, config, x, y) {
  const type = getTerrainTypeAt(state, x, y);
  if (!type) {
    return 0;
  }
  const terrainConfig = config && config.display && config.display.terrain;
  const movementDelay = terrainConfig && terrainConfig.movementDelay;
  if (!movementDelay || typeof movementDelay !== 'object') {
    return 0;
  }
  return Math.max(0, Math.floor(Number(movementDelay[type] || 0)));
}

// Build or reuse an index of terrain tile positions by type.
function ensureTerrainIndex(state) {
  const terrain = state.terrain;
  if (!terrain || !terrain.types) {
    return null;
  }
  if (state.terrainIndex
      && state.terrainIndex.width === terrain.width
      && state.terrainIndex.height === terrain.height) {
    return state.terrainIndex;
  }
  const typePositions = {};
  for (let y = 0; y < terrain.height; y += 1) {
    const row = terrain.types[y];
    const spawnRow = terrain.spawnable && terrain.spawnable[y] ? terrain.spawnable[y] : null;
    for (let x = 0; x < terrain.width; x += 1) {
      if (spawnRow && spawnRow[x] !== true) {
        continue;
      }
      const type = row[x];
      if (!type) {
        continue;
      }
      if (!typePositions[type]) {
        typePositions[type] = [];
      }
      typePositions[type].push({ x, y });
    }
  }
  state.terrainIndex = {
    width: terrain.width,
    height: terrain.height,
    typePositions,
  };
  return state.terrainIndex;
}

// Resolve the cooldown ticks for terrain gathering, allowing per-resource overrides.
function getTerrainCooldownTicks(config, resourceId) {
  const resources = config && config.resources ? config.resources : {};
  const cooldown = resources.terrainCooldownTicks;
  if (cooldown === undefined || cooldown === null) {
    return 0;
  }
  if (Number.isFinite(cooldown)) {
    return Math.max(0, Math.floor(Number(cooldown)));
  }
  if (typeof cooldown !== 'object') {
    return 0;
  }
  const specific = cooldown && resourceId ? cooldown[resourceId] : undefined;
  if (Number.isFinite(specific)) {
    return Math.max(0, Math.floor(Number(specific)));
  }
  const fallback = cooldown.default ?? cooldown.all ?? 0;
  return Math.max(0, Math.floor(Number(fallback || 0)));
}

function getTerrainCooldownKey(x, y) {
  return `${x},${y}`;
}

function isPastureDepleted(state, x, y) {
  const pasture = state && state.pasture;
  if (!pasture || !pasture.mask || !pasture.remaining) {
    return false;
  }
  const width = pasture.width;
  const height = pasture.height;
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return false;
  }
  const index = y * width + x;
  if (!pasture.mask[index]) {
    return false;
  }
  return Number(pasture.remaining[index] || 0) <= 0;
}

function ensureTerrainCooldowns(state) {
  if (!state) {
    return null;
  }
  if (!state.terrainCooldowns || typeof state.terrainCooldowns !== 'object') {
    state.terrainCooldowns = {};
  }
  return state.terrainCooldowns;
}

// Check if a terrain tile is currently on cooldown for gathering.
function isTerrainTileOnCooldown(state, x, y) {
  const map = state && state.terrainCooldowns;
  if (!map || typeof map !== 'object') {
    return false;
  }
  const remaining = Number(map[getTerrainCooldownKey(x, y)] || 0);
  return remaining > 0;
}

// Apply a cooldown to a terrain tile after gathering.
function applyTerrainCooldown(state, x, y, ticks) {
  const duration = Math.max(0, Math.floor(Number(ticks || 0)));
  if (duration <= 0) {
    return;
  }
  const map = ensureTerrainCooldowns(state);
  if (!map) {
    return;
  }
  const key = getTerrainCooldownKey(x, y);
  const current = Math.max(0, Math.floor(Number(map[key] || 0)));
  map[key] = Math.max(current, duration);
}

// Decrement all active terrain cooldowns once per tick.
function tickTerrainCooldowns(state) {
  const map = state && state.terrainCooldowns;
  if (!map || typeof map !== 'object') {
    return;
  }
  for (const [key, value] of Object.entries(map)) {
    const remaining = Math.max(0, Math.floor(Number(value || 0)));
    const next = remaining - 1;
    if (next <= 0) {
      delete map[key];
    } else {
      map[key] = next;
    }
  }
}

// Add resource ids that are available via terrain tiles.
function addTerrainResourcesToSet(nodeResources, state, resources) {
  if (!nodeResources || !state || !resources || !resources.terrainAllowed) {
    return;
  }
  const index = ensureTerrainIndex(state);
  if (!index) {
    return;
  }
  const terrainAllowed = resources.terrainAllowed || {};
  for (const resourceId of Object.keys(terrainAllowed)) {
    const allowed = Array.isArray(terrainAllowed[resourceId]) ? terrainAllowed[resourceId] : [];
    for (const type of allowed) {
      const list = index.typePositions[type];
      if (list && list.length > 0) {
        nodeResources.add(resourceId);
        break;
      }
    }
  }
}

// Pick a terrain tile that yields the requested resource.
function pickTerrainResourceTarget(state, config, resourceId, anchor, options) {
  const resources = config.resources || {};
  const allowed = Array.isArray(resources.terrainAllowed && resources.terrainAllowed[resourceId])
    ? resources.terrainAllowed[resourceId]
    : null;
  if (!allowed || allowed.length === 0) {
    return null;
  }
  const index = ensureTerrainIndex(state);
  if (!index) {
    return null;
  }
  const ignoreCooldown = options && options.ignoreCooldown === true;
  const samples = [];
  const pushIfReady = (pos, type) => {
    if (!isSpawnableTile(state, pos.x, pos.y)) {
      return;
    }
    if (!ignoreCooldown && isTerrainTileOnCooldown(state, pos.x, pos.y)) {
      return;
    }
    if (resourceId === 'food' && type === 'pasture' && isPastureDepleted(state, pos.x, pos.y)) {
      return;
    }
    samples.push(pos);
  };
  const samplePerType = 200;
  const maxFullScan = 8000;
  let totalPositions = 0;
  for (const type of allowed) {
    const list = index.typePositions[type] || [];
    totalPositions += list.length;
  }
  const useFullScan = totalPositions > 0 && totalPositions <= maxFullScan;
  for (const type of allowed) {
    const list = index.typePositions[type] || [];
    if (list.length === 0) {
      continue;
    }
    if (useFullScan || list.length <= samplePerType) {
      for (const pos of list) {
        pushIfReady(pos, type);
      }
    } else {
      for (let i = 0; i < samplePerType; i += 1) {
        pushIfReady(list[Math.floor(Math.random() * list.length)], type);
      }
    }
  }
  if (samples.length === 0) {
    return null;
  }
  if (!anchor) {
    return samples[Math.floor(Math.random() * samples.length)];
  }
  let best = samples[0];
  let bestDistance = Math.abs(best.x - anchor.x) + Math.abs(best.y - anchor.y);
  for (let i = 1; i < samples.length; i += 1) {
    const candidate = samples[i];
    const dist = Math.abs(candidate.x - anchor.x) + Math.abs(candidate.y - anchor.y);
    if (dist < bestDistance) {
      best = candidate;
      bestDistance = dist;
    }
  }
  return best;
}

// Check whether a terrain tile is a valid resource source.
function isTerrainResourceTile(state, config, resourceId, x, y, options) {
  const resources = config.resources || {};
  const allowed = Array.isArray(resources.terrainAllowed && resources.terrainAllowed[resourceId])
    ? resources.terrainAllowed[resourceId]
    : null;
  if (!allowed || allowed.length === 0) {
    return false;
  }
  const type = getTerrainTypeAt(state, x, y);
  if (!type) {
    return false;
  }
  if (resourceId === 'food' && type === 'pasture' && isPastureDepleted(state, x, y)) {
    return false;
  }
  const ignoreCooldown = options && options.ignoreCooldown === true;
  if (!ignoreCooldown && isTerrainTileOnCooldown(state, x, y)) {
    return false;
  }
  return allowed.includes(type);
}

// Compute the ratio of terrain tiles that can provide a resource.
function getTerrainResourceRatio(state, config, resourceId) {
  const resources = config.resources || {};
  const allowed = Array.isArray(resources.terrainAllowed && resources.terrainAllowed[resourceId])
    ? resources.terrainAllowed[resourceId]
    : null;
  const terrain = state.terrain;
  if (!terrain || !terrain.types || !allowed || allowed.length === 0) {
    return 0;
  }
  const index = ensureTerrainIndex(state);
  if (!index) {
    return 0;
  }
  let count = 0;
  for (const type of allowed) {
    const list = index.typePositions[type];
    if (list) {
      count += list.length;
    }
  }
  const totalTiles = Math.max(1, terrain.width * terrain.height);
  return clamp(count / totalTiles, 0, 1);
}

module.exports = {
  getTerrainTypeAt,
  isWalkableTile,
  isSpawnableTile,
  hasTerrainResourceWithin,
  getTerrainMoveDelay,
  addTerrainResourcesToSet,
  pickTerrainResourceTarget,
  isTerrainResourceTile,
  getTerrainResourceRatio,
  getTerrainCooldownTicks,
  applyTerrainCooldown,
  tickTerrainCooldowns,
};
