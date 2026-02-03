'use strict';

const { clamp } = require('../utils');
const { randomBetween, shuffleInPlace } = require('./random');
const { moveTowards, findEdgeSpawnPosition } = require('./movement');
const { pushEvent } = require('./events');

const WILDLIFE_SIDES = ['north', 'south', 'west', 'east'];

function ensureWildlifeState(state) {
  if (!state) {
    return null;
  }
  if (!state.wildlife) {
    state.wildlife = {
      herds: [],
      lastSeasonIndex: null,
      herdCounter: 0,
    };
  } else if (!Array.isArray(state.wildlife.herds)) {
    state.wildlife.herds = [];
  }
  return state.wildlife;
}

function getWildlifeConfig(config) {
  return (config && config.wildlife) || {};
}

function getHerdConfig(wildlifeConfig) {
  return wildlifeConfig && wildlifeConfig.herd ? wildlifeConfig.herd : {};
}

function pickDifferentSide(side) {
  const options = WILDLIFE_SIDES.filter((value) => value !== side);
  if (options.length === 0) {
    return side;
  }
  return options[Math.floor(Math.random() * options.length)];
}

function buildHerdOffsets(count) {
  const desired = Math.max(1, Math.floor(Number(count || 1)));
  const base = [{ dx: 0, dy: 0 }];
  const candidates = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
    { dx: 1, dy: 1 },
    { dx: 1, dy: -1 },
    { dx: -1, dy: 1 },
    { dx: -1, dy: -1 },
    { dx: 2, dy: 0 },
    { dx: -2, dy: 0 },
    { dx: 0, dy: 2 },
    { dx: 0, dy: -2 },
  ];
  shuffleInPlace(candidates);
  const offsets = base.slice();
  for (const candidate of candidates) {
    offsets.push(candidate);
    if (offsets.length >= desired) {
      break;
    }
  }
  return offsets;
}

function spawnHerd(state, runtime, wildlifeConfig) {
  const wildlifeState = ensureWildlifeState(state);
  if (!wildlifeState) {
    return null;
  }
  const herdConfig = getHerdConfig(wildlifeConfig);
  const entrySide = WILDLIFE_SIDES[Math.floor(Math.random() * WILDLIFE_SIDES.length)];
  const exitSide = pickDifferentSide(entrySide);
  const entry = findEdgeSpawnPosition(state, runtime, entrySide);
  const exit = findEdgeSpawnPosition(state, runtime, exitSide);
  if (!entry || !exit) {
    return null;
  }

  const sizeMinRaw = Number(herdConfig.size_min ?? herdConfig.size ?? 8);
  const sizeMin = Math.max(1, Math.floor(sizeMinRaw || 1));
  const sizeMaxRaw = Number(herdConfig.size_max ?? sizeMin);
  const sizeMax = Math.max(sizeMin, Math.floor(sizeMaxRaw || sizeMin));
  const size = randomBetween(sizeMin, sizeMax);
  const ttlTicks = Math.max(1, Math.floor(Number(herdConfig.ttl_ticks ?? 120)));
  const renderMin = Math.max(1, Math.floor(Number(herdConfig.render_min ?? 5)));
  const renderMax = Math.max(renderMin, Math.floor(Number(herdConfig.render_max ?? renderMin)));
  const renderCount = randomBetween(renderMin, renderMax);

  const herd = {
    id: `herd_${++wildlifeState.herdCounter}`,
    x: entry.x,
    y: entry.y,
    targetX: exit.x,
    targetY: exit.y,
    remaining: size,
    ttl: ttlTicks,
    entrySide,
    exitSide,
    seasonName: state.season ? state.season.name : null,
    offsets: buildHerdOffsets(renderCount),
  };
  wildlifeState.herds.push(herd);
  return herd;
}

// Spawn wildlife herds at the start of eligible seasons.
function updateWildlifeStart(state, config, runtime) {
  const wildlifeConfig = getWildlifeConfig(config);
  if (wildlifeConfig.enabled !== true) {
    return;
  }
  if (!state || !state.season || !runtime) {
    return;
  }
  const seasonNames = Array.isArray(wildlifeConfig.seasons) && wildlifeConfig.seasons.length > 0
    ? wildlifeConfig.seasons
    : ['spring', 'autumn'];
  if (!seasonNames.includes(state.season.name)) {
    return;
  }
  if (Number(state.season.tickInSeason || 0) !== 1) {
    return;
  }

  const wildlifeState = ensureWildlifeState(state);
  const seasonIndex = Number(state.season.globalIndex ?? state.season.index ?? 0);
  if (Number.isFinite(wildlifeState.lastSeasonIndex) && wildlifeState.lastSeasonIndex === seasonIndex) {
    return;
  }
  wildlifeState.lastSeasonIndex = seasonIndex;

  const spawnConfig = wildlifeConfig.spawn || {};
  const minHerds = Math.max(0, Math.floor(Number(spawnConfig.herds_min ?? 0)));
  const maxHerds = Math.max(minHerds, Math.floor(Number(spawnConfig.herds_max ?? minHerds)));
  const count = randomBetween(minHerds, maxHerds);
  if (count <= 0) {
    return;
  }
  let spawned = 0;
  for (let i = 0; i < count; i += 1) {
    const herd = spawnHerd(state, runtime, wildlifeConfig);
    if (herd) {
      spawned += 1;
    }
  }
  if (spawned > 0) {
    pushEvent(state, config, `Wildlife: ${spawned} herd${spawned > 1 ? 's' : ''} roaming`);
  }
}

// Advance herd movement and despawn when depleted or expired.
function updateWildlifeTick(state, config, runtime) {
  const wildlifeConfig = getWildlifeConfig(config);
  if (wildlifeConfig.enabled !== true) {
    return;
  }
  const wildlifeState = ensureWildlifeState(state);
  if (!wildlifeState || wildlifeState.herds.length === 0) {
    return;
  }
  const herdConfig = getHerdConfig(wildlifeConfig);
  const moveEvery = Math.max(1, Math.floor(Number(herdConfig.move_every_ticks ?? 1)));
  const next = [];
  for (const herd of wildlifeState.herds) {
    if (!herd) {
      continue;
    }
    herd.ttl = Math.max(0, Number(herd.ttl || 0) - 1);
    if (herd.remaining <= 0 || herd.ttl <= 0) {
      continue;
    }
    const atTarget = herd.x === herd.targetX && herd.y === herd.targetY;
    if (atTarget) {
      continue;
    }
    if (moveEvery <= 1 || Number(state.tick || 0) % moveEvery === 0) {
      moveTowards(herd, { x: herd.targetX, y: herd.targetY }, runtime, state, config);
    }
    next.push(herd);
  }
  wildlifeState.herds = next;
}

// Regenerate pasture stock via births.
function updatePastureBirths(state, config) {
  const pastureConfig = (config && config.pasture) || {};
  if (pastureConfig.enabled === false) {
    return;
  }
  const pasture = state && state.pasture;
  if (!pasture || !pasture.mask || !pasture.remaining) {
    return;
  }
  const birth = pastureConfig.birth || {};
  const interval = Math.max(1, Math.floor(Number(birth.interval_ticks ?? 0)));
  const amount = Math.max(0, Number(birth.amount ?? 0));
  if (interval <= 0 || amount <= 0) {
    return;
  }
  if (Number(state.tick || 0) % interval !== 0) {
    return;
  }
  const capacity = Math.max(0, Number(pasture.capacity || 0));
  if (capacity <= 0) {
    return;
  }
  const remaining = pasture.remaining;
  const mask = pasture.mask;
  for (let i = 0; i < remaining.length; i += 1) {
    if (!mask[i]) {
      continue;
    }
    const current = Number(remaining[i] || 0);
    if (current >= capacity) {
      continue;
    }
    remaining[i] = clamp(current + amount, 0, capacity);
  }
}

function findHerdById(state, herdId) {
  if (!state || !state.wildlife || !Array.isArray(state.wildlife.herds)) {
    return null;
  }
  return state.wildlife.herds.find((herd) => herd.id === herdId) || null;
}

function countActiveHerds(state) {
  if (!state || !state.wildlife || !Array.isArray(state.wildlife.herds)) {
    return 0;
  }
  return state.wildlife.herds.filter((herd) => herd && herd.remaining > 0).length;
}

module.exports = {
  updateWildlifeStart,
  updateWildlifeTick,
  updatePastureBirths,
  findHerdById,
  countActiveHerds,
};
