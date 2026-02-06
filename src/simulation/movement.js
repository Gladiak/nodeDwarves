'use strict';

const { clamp } = require('../utils');
const { randomBetween } = require('./random');
const { getTerrainMoveDelay, isWalkableTile, isSpawnableTile } = require('./terrain');

const DWARF_ROAD_AFFINITY_PROFILES = {
  pragmatic: {
    minTargetDistance: 10,
    onRoadBonus: 0.16,
    offRoadPenalty: 0.05,
    offRoadGraceDistance: 2,
    maxDistancePenalty: 2,
  },
  scenic: {
    minTargetDistance: 6,
    onRoadBonus: 0.3,
    offRoadPenalty: 0.1,
    offRoadGraceDistance: 1,
    maxDistancePenalty: 4,
  },
};

// Resolve the road-affinity profile name and default values.
function resolveRoadAffinityProfile(rawValue) {
  const profileRaw = String(rawValue || 'pragmatic').toLowerCase();
  if (profileRaw === 'scenic') {
    return {
      name: 'scenic',
      values: DWARF_ROAD_AFFINITY_PROFILES.scenic,
    };
  }
  return {
    name: 'pragmatic',
    values: DWARF_ROAD_AFFINITY_PROFILES.pragmatic,
  };
}

// Move an entity toward a target, respecting movement cooldowns.
function moveTowards(entity, target, runtime, state, config) {
  if (runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return;
  }

  if (shouldPauseForMoveCooldown(entity)) {
    return;
  }

  moveTowardsStep(entity, target, runtime, state, config);
}

// Execute one movement step toward the target.
function moveTowardsStep(entity, target, runtime, state, config) {
  const targetX = clamp(Number(target.x || 0), 0, runtime.gridWidth - 1);
  const targetY = clamp(Number(target.y || 0), 0, runtime.gridHeight - 1);
  const currentDistance = Math.abs(targetX - entity.x) + Math.abs(targetY - entity.y);
  const options = [
    { x: entity.x, y: entity.y },
    { x: entity.x + 1, y: entity.y },
    { x: entity.x - 1, y: entity.y },
    { x: entity.x, y: entity.y + 1 },
    { x: entity.x, y: entity.y - 1 },
  ];
  const valid = options.filter((pos) => {
    if (pos.x < 0 || pos.y < 0 || pos.x >= runtime.gridWidth || pos.y >= runtime.gridHeight) {
      return false;
    }
    return isWalkableTile(state, pos.x, pos.y);
  });
  if (valid.length === 0) {
    return;
  }

  let bestDistance = Infinity;
  let best = [];
  for (const pos of valid) {
    const dist = Math.abs(targetX - pos.x) + Math.abs(targetY - pos.y);
    if (dist < bestDistance) {
      bestDistance = dist;
      best = [pos];
    } else if (dist === bestDistance) {
      best.push(pos);
    }
  }
  let pick = null;
  const hasStall = bestDistance === currentDistance;
  const candidates = hasStall
    ? valid.filter((pos) => !(pos.x === entity.x && pos.y === entity.y))
    : best;
  if (candidates.length > 0) {
    pick = pickMoveWithInertia(entity, candidates, targetX, targetY, currentDistance);
  }
  if (!pick) {
    return;
  }
  applyMoveWithCooldown(entity, pick.x, pick.y, state, config);
}

// Move toward a target using the configured pathing strategy.
function moveWithDetour(entity, targetX, targetY, runtime, state, config, pathKey) {
  const pathing = (config.population && config.population.pathing) || {};
  const mode = String(pathing.mode || 'detour');
  if (mode === 'field') {
    return moveWithField(entity, targetX, targetY, runtime, state, config, pathKey, pathing);
  }
  return moveWithDetourLegacy(entity, targetX, targetY, runtime, state, config, pathKey);
}

// Move toward a target using a detour when stalled.
function moveWithDetourLegacy(entity, targetX, targetY, runtime, state, config, pathKey) {
  if (runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return false;
  }

  if (shouldPauseForMoveCooldown(entity)) {
    return false;
  }

  const pathing = (config.population && config.population.pathing) || {};
  const stallThreshold = Math.max(1, Number(pathing.stallThreshold || 6));
  const detourTicks = Math.max(0, Number(pathing.detourTicks || 4));
  const bfsRadius = Math.max(3, Number(pathing.bfsRadius || 10));
  const key = pathKey || `${targetX},${targetY}`;

  if (entity.pathTargetKey !== key) {
    entity.pathTargetKey = key;
    entity.pathStallTicks = 0;
    entity.pathDetourTicks = 0;
  }

  const beforeX = entity.x;
  const beforeY = entity.y;
  const beforeDistance = Math.abs(targetX - beforeX) + Math.abs(targetY - beforeY);
  const useDetour = Number(entity.pathDetourTicks || 0) > 0
    || Number(entity.pathStallTicks || 0) >= stallThreshold;

  if (useDetour && Number(entity.pathDetourTicks || 0) === 0 && detourTicks > 0) {
    entity.pathDetourTicks = detourTicks;
  }

  let moved = false;
  if (useDetour) {
    const step = findLocalPathStep(state, runtime, entity.x, entity.y, targetX, targetY, bfsRadius);
    if (step) {
      moved = applyMoveWithCooldown(entity, step.x, step.y, state, config);
    }
  }

  if (!moved) {
    moveTowardsStep(entity, { x: targetX, y: targetY }, runtime, state, config);
    moved = entity.x !== beforeX || entity.y !== beforeY;
  }

  const afterDistance = Math.abs(targetX - entity.x) + Math.abs(targetY - entity.y);
  if (moved && afterDistance < beforeDistance) {
    entity.pathStallTicks = 0;
  } else if (!moved && Number(entity.moveCooldown || 0) > 0) {
    // Cooling down from slow terrain; do not count as a stall.
  } else {
    entity.pathStallTicks = Number(entity.pathStallTicks || 0) + 1;
  }

  if (Number(entity.pathDetourTicks || 0) > 0 && useDetour) {
    entity.pathDetourTicks = Math.max(0, Number(entity.pathDetourTicks || 0) - 1);
  }

  return moved;
}

// Move toward a target using a potential-field step with detour fallback.
function moveWithField(entity, targetX, targetY, runtime, state, config, pathKey, pathing) {
  if (runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return false;
  }

  if (shouldPauseForMoveCooldown(entity)) {
    return false;
  }

  const key = pathKey || `${targetX},${targetY}`;
  if (entity.pathTargetKey !== key) {
    entity.pathTargetKey = key;
    entity.pathStallTicks = 0;
    entity.pathDetourTicks = 0;
  }

  const fieldConfig = getFieldConfig(pathing);
  const field = fieldConfig.radius > 0
    ? getPathField(state, runtime, targetX, targetY, key, fieldConfig)
    : null;

  const beforeDistance = getTargetDistance(field, targetX, targetY, entity.x, entity.y);
  const stallThreshold = Math.max(1, Number(pathing.stallThreshold || 6));
  const detourTicks = Math.max(0, Number(pathing.detourTicks || 4));
  const bfsRadius = Math.max(3, Number(pathing.bfsRadius || 10));

  const useDetour = Number(entity.pathDetourTicks || 0) > 0
    || Number(entity.pathStallTicks || 0) >= stallThreshold;

  if (useDetour && Number(entity.pathDetourTicks || 0) === 0 && detourTicks > 0) {
    entity.pathDetourTicks = detourTicks;
  }

  let moved = false;
  if (useDetour) {
    const step = findLocalPathStep(state, runtime, entity.x, entity.y, targetX, targetY, bfsRadius);
    if (step) {
      moved = applyMoveWithCooldown(entity, step.x, step.y, state, config);
    }
  }

  if (!moved) {
    moved = moveWithFieldStep(entity, targetX, targetY, runtime, state, config, field, fieldConfig);
  }

  const afterDistance = getTargetDistance(field, targetX, targetY, entity.x, entity.y);
  if (moved && afterDistance < beforeDistance) {
    entity.pathStallTicks = 0;
  } else if (!moved && Number(entity.moveCooldown || 0) > 0) {
    // Cooling down from slow terrain; do not count as a stall.
  } else {
    entity.pathStallTicks = Number(entity.pathStallTicks || 0) + 1;
  }

  if (Number(entity.pathDetourTicks || 0) > 0 && useDetour) {
    entity.pathDetourTicks = Math.max(0, Number(entity.pathDetourTicks || 0) - 1);
  }

  return moved;
}

// Apply a move and record terrain cooldown data.
function applyMoveWithCooldown(entity, x, y, state, config) {
  const fromX = entity.x;
  const fromY = entity.y;
  const dx = x - fromX;
  const dy = y - fromY;
  if (dx === 0 && dy === 0) {
    return false;
  }
  updateOccupancyOnMove(state, fromX, fromY, x, y);
  entity.lastMoveDx = dx;
  entity.lastMoveDy = dy;
  entity.x = x;
  entity.y = y;
  const delay = getTerrainMoveDelay(state, config, x, y);
  if (delay > 0) {
    entity.moveCooldown = delay;
  }
  return true;
}

// Choose a potential-field step toward the target.
function moveWithFieldStep(entity, targetX, targetY, runtime, state, config, field, fieldConfig) {
  const candidates = [
    { x: entity.x, y: entity.y },
    { x: entity.x + 1, y: entity.y },
    { x: entity.x - 1, y: entity.y },
    { x: entity.x, y: entity.y + 1 },
    { x: entity.x, y: entity.y - 1 },
  ].filter((pos) => {
    if (pos.x < 0 || pos.y < 0 || pos.x >= runtime.gridWidth || pos.y >= runtime.gridHeight) {
      return false;
    }
    return isWalkableTile(state, pos.x, pos.y);
  });

  if (candidates.length === 0) {
    return false;
  }

  const occupancy = fieldConfig.crowdWeight > 0 ? ensureOccupancyMap(state, runtime) : null;
  const currentTargetDistance = getTargetDistance(field, targetX, targetY, entity.x, entity.y);
  const roadAffinity = fieldConfig.roadAffinity || null;
  const useRoadAffinity = Boolean(
    roadAffinity
      && roadAffinity.enabled
      && currentTargetDistance >= roadAffinity.minTargetDistance,
  );
  const roadDistanceMap = useRoadAffinity ? ensureRoadDistanceMap(state, runtime) : null;
  const scored = [];
  let bestCost = Infinity;

  for (const pos of candidates) {
    const dist = getTargetDistance(field, targetX, targetY, pos.x, pos.y);
    let cost = dist;

    if (fieldConfig.terrainWeight > 0) {
      const delay = getTerrainMoveDelay(state, config, pos.x, pos.y);
      cost += fieldConfig.terrainWeight * delay;
    }

    if (occupancy && fieldConfig.crowdWeight > 0) {
      const crowd = getOccupancyCount(occupancy, pos.x, pos.y, entity);
      if (crowd > 0) {
        cost += fieldConfig.crowdWeight * crowd;
      }
    }

    if (roadDistanceMap && roadDistanceMap.hasRoad && roadAffinity) {
      const roadType = getRoadOverlayType(state, pos.x, pos.y);
      if (roadType) {
        cost -= roadAffinity.onRoadBonus;
      } else if (roadAffinity.offRoadPenalty > 0) {
        const roadDistance = getRoadDistance(roadDistanceMap, pos.x, pos.y);
        if (roadDistance !== null) {
          const overflow = Math.max(
            0,
            roadDistance - roadAffinity.offRoadGraceDistance,
          );
          if (overflow > 0) {
            const capped = Math.min(overflow, roadAffinity.maxDistancePenalty);
            cost += roadAffinity.offRoadPenalty * capped;
          }
        }
      }
    }

    if (pos.x === entity.x && pos.y === entity.y) {
      cost += fieldConfig.stayPenalty;
    }

    const lastDx = Number(entity.lastMoveDx);
    const lastDy = Number(entity.lastMoveDy);
    const dx = pos.x - entity.x;
    const dy = pos.y - entity.y;
    if (fieldConfig.inertiaWeight > 0 && dx === lastDx && dy === lastDy && (dx !== 0 || dy !== 0)) {
      cost -= fieldConfig.inertiaWeight;
    }

    if (cost < bestCost) {
      bestCost = cost;
    }
    scored.push({ x: pos.x, y: pos.y, cost });
  }

  if (scored.length === 0) {
    return false;
  }

  let pick = null;
  if (fieldConfig.temperature <= 0) {
    const best = scored.filter((pos) => pos.cost === bestCost);
    pick = best[Math.floor(Math.random() * best.length)];
  } else {
    const scale = Math.max(0.05, fieldConfig.temperature);
    let total = 0;
    for (const pos of scored) {
      const weight = Math.exp(-(pos.cost - bestCost) / scale);
      pos.weight = weight;
      total += weight;
    }
    if (total > 0) {
      let roll = Math.random() * total;
      for (const pos of scored) {
        roll -= pos.weight || 0;
        if (roll <= 0) {
          pick = pos;
          break;
        }
      }
    }
    if (!pick) {
      pick = scored[Math.floor(Math.random() * scored.length)];
    }
  }

  if (!pick) {
    return false;
  }
  return applyMoveWithCooldown(entity, pick.x, pick.y, state, config);
}

// Pick a candidate move while preserving movement inertia when useful.
function pickMoveWithInertia(entity, candidates, targetX, targetY, currentDistance) {
  if (!candidates || candidates.length === 0) {
    return null;
  }
  const lastDx = Number(entity.lastMoveDx);
  const lastDy = Number(entity.lastMoveDy);
  let available = candidates;
  if (Number.isFinite(lastDx) && Number.isFinite(lastDy) && (lastDx !== 0 || lastDy !== 0)) {
    const noBacktrack = candidates.filter(
      (pos) => (pos.x - entity.x) !== -lastDx || (pos.y - entity.y) !== -lastDy,
    );
    if (noBacktrack.length > 0) {
      available = noBacktrack;
    }
  }
  const hasTarget = Number.isFinite(targetX) && Number.isFinite(targetY) && Number.isFinite(currentDistance);
  if (Number.isFinite(lastDx) && Number.isFinite(lastDy) && (lastDx !== 0 || lastDy !== 0)) {
    const inertia = available.filter((pos) => (pos.x - entity.x) === lastDx && (pos.y - entity.y) === lastDy);
    if (inertia.length > 0 && hasTarget) {
      const dist = Math.abs(targetX - inertia[0].x) + Math.abs(targetY - inertia[0].y);
      if (dist < currentDistance) {
        return inertia[Math.floor(Math.random() * inertia.length)];
      }
    } else if (inertia.length > 0 && !hasTarget) {
      return inertia[Math.floor(Math.random() * inertia.length)];
    }
  }
  return available[Math.floor(Math.random() * available.length)];
}

// Resolve field pathing parameters with safe defaults.
function getFieldConfig(pathing) {
  const field = pathing && pathing.field ? pathing.field : {};
  const roadAffinityRaw =
    (field.road_affinity && typeof field.road_affinity === 'object')
      ? field.road_affinity
      : (field.roadAffinity && typeof field.roadAffinity === 'object')
        ? field.roadAffinity
        : {};
  const roadAffinityProfile = resolveRoadAffinityProfile(
    roadAffinityRaw.profile
      ?? roadAffinityRaw.road_profile
      ?? roadAffinityRaw.mode,
  );
  const roadAffinityDefaults = roadAffinityProfile.values || {};
  const radius = Math.max(0, Math.floor(Number(field.radius ?? 0)));
  const ttlTicks = Math.max(0, Math.floor(Number(field.ttlTicks ?? 6)));
  const temperature = clamp(Number(field.temperature ?? 0.25), 0, 1);
  const terrainWeight = clamp(Number(field.terrainWeight ?? 0.25), 0, 1);
  const crowdWeight = clamp(Number(field.crowdWeight ?? 0.2), 0, 1);
  const inertiaWeight = clamp(Number(field.inertiaWeight ?? 0.2), 0, 1);
  const stayPenalty = clamp(Number(field.stayPenalty ?? 0.3), 0, 1);
  const hasRoadAffinityConfig = Object.keys(roadAffinityRaw).length > 0;
  const roadAffinityEnabled = hasRoadAffinityConfig && roadAffinityRaw.enabled !== false;
  const roadAffinityMinTargetDistance = Math.max(
    0,
    Math.floor(
      Number(
        roadAffinityRaw.minTargetDistance
          ?? roadAffinityRaw.min_target_distance
          ?? roadAffinityDefaults.minTargetDistance
          ?? 8,
      ),
    ),
  );
  const roadAffinityOnRoadBonus = clamp(
    Number(
      roadAffinityRaw.onRoadBonus
        ?? roadAffinityRaw.on_road_bonus
        ?? roadAffinityDefaults.onRoadBonus
        ?? 0.2,
    ),
    0,
    2,
  );
  const roadAffinityOffRoadPenalty = clamp(
    Number(
      roadAffinityRaw.offRoadPenalty
        ?? roadAffinityRaw.off_road_penalty
        ?? roadAffinityDefaults.offRoadPenalty
        ?? 0.08,
    ),
    0,
    2,
  );
  const roadAffinityOffRoadGraceDistance = Math.max(
    0,
    Math.floor(
      Number(
        roadAffinityRaw.offRoadGraceDistance
          ?? roadAffinityRaw.off_road_grace_distance
          ?? roadAffinityDefaults.offRoadGraceDistance
          ?? 1,
      ),
    ),
  );
  const roadAffinityMaxDistancePenalty = Math.max(
    0,
    Math.floor(
      Number(
        roadAffinityRaw.maxDistancePenalty
          ?? roadAffinityRaw.max_distance_penalty
          ?? roadAffinityDefaults.maxDistancePenalty
          ?? 3,
      ),
    ),
  );
  return {
    radius,
    ttlTicks,
    temperature,
    terrainWeight,
    crowdWeight,
    inertiaWeight,
    stayPenalty,
    roadAffinity: {
      enabled: roadAffinityEnabled,
      profile: roadAffinityProfile.name,
      minTargetDistance: roadAffinityMinTargetDistance,
      onRoadBonus: roadAffinityOnRoadBonus,
      offRoadPenalty: roadAffinityOffRoadPenalty,
      offRoadGraceDistance: roadAffinityOffRoadGraceDistance,
      maxDistancePenalty: roadAffinityMaxDistancePenalty,
    },
  };
}

// Find cached path field for a target, rebuilding when stale.
function getPathField(state, runtime, targetX, targetY, key, fieldConfig) {
  if (!state || !runtime || fieldConfig.radius <= 0) {
    return null;
  }
  const ttlTicks = Math.max(0, Number(fieldConfig.ttlTicks || 0));
  if (ttlTicks <= 0) {
    return buildPathField(state, runtime, targetX, targetY, fieldConfig.radius);
  }
  const tick = Number(state.tick || 0);
  const pathing = ensurePathingState(state);
  const fields = pathing.fields;
  const existing = fields[key];
  const sameTarget = existing
    && existing.targetX === targetX
    && existing.targetY === targetY
    && existing.radius === fieldConfig.radius
    && existing.width === runtime.gridWidth
    && existing.height === runtime.gridHeight;
  if (sameTarget && tick - existing.builtTick <= ttlTicks) {
    existing.lastUsed = tick;
    return existing;
  }
  const built = buildPathField(state, runtime, targetX, targetY, fieldConfig.radius);
  if (!built) {
    if (fields[key]) {
      delete fields[key];
    }
    return null;
  }
  built.targetX = targetX;
  built.targetY = targetY;
  built.radius = fieldConfig.radius;
  built.builtTick = tick;
  built.lastUsed = tick;
  fields[key] = built;
  prunePathFields(fields, tick, ttlTicks);
  return built;
}

// Remove stale path fields from cache.
function prunePathFields(fields, tick, ttlTicks) {
  if (!fields || ttlTicks <= 0) {
    return;
  }
  const expiry = ttlTicks * 2;
  for (const [key, entry] of Object.entries(fields)) {
    if (!entry || Number.isFinite(entry.lastUsed) === false) {
      delete fields[key];
      continue;
    }
    if (tick - entry.lastUsed > expiry) {
      delete fields[key];
    }
  }
}

// Build a BFS distance field centered on the target.
function buildPathField(state, runtime, targetX, targetY, radius) {
  const width = runtime.gridWidth;
  const height = runtime.gridHeight;
  const safeRadius = Math.max(1, Math.floor(Number(radius || 0)));
  if (safeRadius <= 0 || width <= 0 || height <= 0) {
    return null;
  }

  const anchorX = clamp(Math.floor(Number(targetX || 0)), 0, width - 1);
  const anchorY = clamp(Math.floor(Number(targetY || 0)), 0, height - 1);
  if (!isWalkableTile(state, anchorX, anchorY)) {
    return null;
  }

  const minX = Math.max(0, anchorX - safeRadius);
  const maxX = Math.min(width - 1, anchorX + safeRadius);
  const minY = Math.max(0, anchorY - safeRadius);
  const maxY = Math.min(height - 1, anchorY + safeRadius);
  const localWidth = maxX - minX + 1;
  const localHeight = maxY - minY + 1;
  const total = localWidth * localHeight;
  if (total <= 0) {
    return null;
  }

  const distances = new Array(total).fill(-1);
  const queue = new Array(total);
  let head = 0;
  let tail = 0;

  const toIndex = (x, y) => (y - minY) * localWidth + (x - minX);
  const targetIndex = toIndex(anchorX, anchorY);
  distances[targetIndex] = 0;
  queue[tail++] = targetIndex;

  while (head < tail) {
    const index = queue[head++];
    const x = (index % localWidth) + minX;
    const y = Math.floor(index / localWidth) + minY;
    const dist = distances[index];
    const nextDist = dist + 1;

    const neighbors = [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 },
    ];
    for (const next of neighbors) {
      if (next.x < minX || next.x > maxX || next.y < minY || next.y > maxY) {
        continue;
      }
      if (!isWalkableTile(state, next.x, next.y)) {
        continue;
      }
      const nextIndex = toIndex(next.x, next.y);
      if (distances[nextIndex] !== -1) {
        continue;
      }
      distances[nextIndex] = nextDist;
      queue[tail++] = nextIndex;
    }
  }

  return {
    minX,
    minY,
    width: localWidth,
    height: localHeight,
    distances,
  };
}

// Resolve distance to target using field data when available.
function getTargetDistance(field, targetX, targetY, x, y) {
  const fieldDistance = getFieldDistance(field, x, y);
  if (fieldDistance !== null) {
    return fieldDistance;
  }
  return Math.abs(targetX - x) + Math.abs(targetY - y);
}

// Read a cached distance from a field.
function getFieldDistance(field, x, y) {
  if (!field) {
    return null;
  }
  if (x < field.minX || y < field.minY || x >= field.minX + field.width || y >= field.minY + field.height) {
    return null;
  }
  const index = (y - field.minY) * field.width + (x - field.minX);
  const value = field.distances[index];
  if (value === -1 || value === undefined) {
    return null;
  }
  return value;
}

// Ensure pathing state container exists.
function ensurePathingState(state) {
  if (!state) {
    return { fields: {}, occupancy: null, roadDistance: null };
  }
  if (!state.pathing) {
    state.pathing = { fields: {}, occupancy: null, roadDistance: null };
  } else if (!state.pathing.fields) {
    state.pathing.fields = {};
  }
  if (state.pathing.roadDistance === undefined) {
    state.pathing.roadDistance = null;
  }
  return state.pathing;
}

// Build or reuse a per-tick occupancy map for dwarves.
function ensureOccupancyMap(state, runtime) {
  if (!state || !runtime) {
    return null;
  }
  const width = runtime.gridWidth;
  const height = runtime.gridHeight;
  if (width <= 0 || height <= 0) {
    return null;
  }
  const tick = Number(state.tick || 0);
  const pathing = ensurePathingState(state);
  const existing = pathing.occupancy;
  if (existing && existing.tick === tick && existing.width === width && existing.height === height) {
    return existing;
  }

  const total = width * height;
  const counts = new Array(total).fill(0);
  const dwarves = state.dwarves || [];
  for (const dwarf of dwarves) {
    const x = Number(dwarf.x);
    const y = Number(dwarf.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }
    if (x < 0 || y < 0 || x >= width || y >= height) {
      continue;
    }
    counts[y * width + x] += 1;
  }

  const merchant = state.merchant;
  if (merchant && merchant.phase && merchant.phase !== 'idle') {
    const x = Number(merchant.x);
    const y = Number(merchant.y);
    if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x < width && y < height) {
      counts[y * width + x] += 1;
    }
  }

  const raid = state.raid;
  if (raid && raid.active && Array.isArray(raid.beasts)) {
    for (const beast of raid.beasts) {
      const x = Number(beast.x);
      const y = Number(beast.y);
      if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x < width && y < height) {
        counts[y * width + x] += 1;
      }
    }
  }

  const occupancy = {
    tick,
    width,
    height,
    counts,
  };
  pathing.occupancy = occupancy;
  return occupancy;
}

// Read the number of dwarves occupying a tile, excluding the mover.
function getOccupancyCount(occupancy, x, y, entity) {
  if (!occupancy) {
    return 0;
  }
  const width = occupancy.width;
  const height = occupancy.height;
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return 0;
  }
  let count = Number(occupancy.counts[y * width + x] || 0);
  if (entity && entity.x === x && entity.y === y) {
    count = Math.max(0, count - 1);
  }
  return count;
}

// Update occupancy map when an entity moves.
function updateOccupancyOnMove(state, fromX, fromY, toX, toY) {
  if (!state || !state.pathing || !state.pathing.occupancy) {
    return;
  }
  const occupancy = state.pathing.occupancy;
  const tick = Number(state.tick || 0);
  if (occupancy.tick !== tick) {
    return;
  }
  const width = occupancy.width;
  const height = occupancy.height;
  if (fromX >= 0 && fromY >= 0 && fromX < width && fromY < height) {
    const fromIndex = fromY * width + fromX;
    occupancy.counts[fromIndex] = Math.max(0, Number(occupancy.counts[fromIndex] || 0) - 1);
  }
  if (toX >= 0 && toY >= 0 && toX < width && toY < height) {
    const toIndex = toY * width + toX;
    occupancy.counts[toIndex] = Number(occupancy.counts[toIndex] || 0) + 1;
  }
}

// Return the road overlay type at a tile, if any.
function getRoadOverlayType(state, x, y) {
  const roads = state && state.roads;
  if (!roads || !Array.isArray(roads.types)) {
    return null;
  }
  const row = roads.types[y];
  if (!row) {
    return null;
  }
  const type = row[x];
  if (type === 'road' || type === 'bridge' || type === 'ford') {
    return type;
  }
  return null;
}

// Build or reuse a per-tick road-distance map used by movement road affinity.
function ensureRoadDistanceMap(state, runtime) {
  if (!state || !runtime) {
    return null;
  }
  const width = runtime.gridWidth;
  const height = runtime.gridHeight;
  if (width <= 0 || height <= 0) {
    return null;
  }

  const tick = Number(state.tick || 0);
  const pathing = ensurePathingState(state);
  const existing = pathing.roadDistance;
  if (existing && existing.tick === tick && existing.width === width && existing.height === height) {
    return existing;
  }

  const total = width * height;
  const distances = new Array(total).fill(-1);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  let hasRoad = false;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!getRoadOverlayType(state, x, y)) {
        continue;
      }
      const index = y * width + x;
      if (distances[index] !== -1) {
        continue;
      }
      distances[index] = 0;
      queue[tail++] = index;
      hasRoad = true;
    }
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    const nextDistance = distances[index] + 1;
    const neighbors = [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 },
    ];
    for (const next of neighbors) {
      if (next.x < 0 || next.y < 0 || next.x >= width || next.y >= height) {
        continue;
      }
      const nextIndex = next.y * width + next.x;
      if (distances[nextIndex] !== -1) {
        continue;
      }
      distances[nextIndex] = nextDistance;
      queue[tail++] = nextIndex;
    }
  }

  const roadDistance = {
    tick,
    width,
    height,
    hasRoad,
    distances,
  };
  pathing.roadDistance = roadDistance;
  return roadDistance;
}

// Read the Manhattan distance from a tile to the nearest road tile.
function getRoadDistance(roadDistance, x, y) {
  if (!roadDistance || roadDistance.hasRoad !== true) {
    return null;
  }
  if (x < 0 || y < 0 || x >= roadDistance.width || y >= roadDistance.height) {
    return null;
  }
  const index = y * roadDistance.width + x;
  const value = Number(roadDistance.distances[index]);
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

// Run a local BFS to find a nearby path step.
function findLocalPathStep(state, runtime, startX, startY, targetX, targetY, radius) {
  const width = runtime.gridWidth;
  const height = runtime.gridHeight;
  if (startX === targetX && startY === targetY) {
    return null;
  }

  const maxRadius = Math.max(1, Math.floor(radius || 0));
  const minX = Math.max(0, startX - maxRadius);
  const maxX = Math.min(width - 1, startX + maxRadius);
  const minY = Math.max(0, startY - maxRadius);
  const maxY = Math.min(height - 1, startY + maxRadius);
  const localWidth = maxX - minX + 1;
  const localHeight = maxY - minY + 1;
  if (localWidth <= 0 || localHeight <= 0) {
    return null;
  }

  const total = localWidth * localHeight;
  const visited = new Array(total).fill(false);
  const parent = new Array(total).fill(-1);
  const queue = new Array(total);
  let head = 0;
  let tail = 0;

  const toIndex = (x, y) => (y - minY) * localWidth + (x - minX);
  const toCoord = (index) => ({
    x: (index % localWidth) + minX,
    y: Math.floor(index / localWidth) + minY,
  });

  const startIndex = toIndex(startX, startY);
  queue[tail++] = startIndex;
  visited[startIndex] = true;

  let targetIndex = -1;
  let bestIndex = startIndex;
  let bestDistance = Math.abs(targetX - startX) + Math.abs(targetY - startY);

  while (head < tail) {
    const index = queue[head++];
    const pos = toCoord(index);
    const dist = Math.abs(targetX - pos.x) + Math.abs(targetY - pos.y);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestIndex = index;
    }
    if (pos.x === targetX && pos.y === targetY) {
      targetIndex = index;
      break;
    }

    const neighbors = [
      { x: pos.x + 1, y: pos.y },
      { x: pos.x - 1, y: pos.y },
      { x: pos.x, y: pos.y + 1 },
      { x: pos.x, y: pos.y - 1 },
    ];
    for (const next of neighbors) {
      if (next.x < minX || next.x > maxX || next.y < minY || next.y > maxY) {
        continue;
      }
      if (!isWalkableTile(state, next.x, next.y)) {
        continue;
      }
      const nextIndex = toIndex(next.x, next.y);
      if (visited[nextIndex]) {
        continue;
      }
      visited[nextIndex] = true;
      parent[nextIndex] = index;
      queue[tail++] = nextIndex;
    }
  }

  const goalIndex = targetIndex !== -1 ? targetIndex : bestIndex;
  if (goalIndex === startIndex) {
    return null;
  }

  let current = goalIndex;
  let prev = parent[current];
  if (prev === -1) {
    return null;
  }
  while (prev !== startIndex && prev !== -1) {
    current = prev;
    prev = parent[current];
  }
  if (prev === -1) {
    return null;
  }
  return toCoord(current);
}

// Move a dwarf with random wandering choices.
function moveDwarf(dwarf, runtime, state, config) {
  if (runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return;
  }

  if (shouldPauseForMoveCooldown(dwarf)) {
    return;
  }

  const dirs = [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];
  const candidates = dirs
    .map((dir) => ({
      x: dwarf.x + dir.dx,
      y: dwarf.y + dir.dy,
    }))
    .filter((pos) => {
      if (pos.x < 0 || pos.y < 0 || pos.x >= runtime.gridWidth || pos.y >= runtime.gridHeight) {
        return false;
      }
      return isWalkableTile(state, pos.x, pos.y);
    });
  if (candidates.length === 0) {
    return;
  }
  const pick = pickMoveWithInertia(dwarf, candidates);
  if (pick) {
    applyMoveWithCooldown(dwarf, pick.x, pick.y, state, config);
  }
}

// Decrement movement cooldown and report whether movement is blocked.
function shouldPauseForMoveCooldown(entity) {
  const cooldown = Math.max(0, Number(entity.moveCooldown || 0));
  if (cooldown <= 0) {
    return false;
  }
  entity.moveCooldown = cooldown - 1;
  return true;
}

// Find a walkable tile near an anchor within a Manhattan radius.
function findNearbyWalkablePosition(state, runtime, anchorX, anchorY, radius, attempts) {
  const width = runtime.gridWidth;
  const height = runtime.gridHeight;
  if (width <= 0 || height <= 0) {
    return null;
  }
  const maxRadius = Math.max(0, Math.floor(Number(radius || 0)));
  if (maxRadius <= 0) {
    return null;
  }
  const maxAttempts = Math.max(1, Math.floor(Number(attempts || 0)));
  const originX = clamp(Math.floor(Number(anchorX || 0)), 0, width - 1);
  const originY = clamp(Math.floor(Number(anchorY || 0)), 0, height - 1);
  for (let i = 0; i < maxAttempts; i += 1) {
    const dx = randomBetween(-maxRadius, maxRadius);
    const dy = randomBetween(-maxRadius, maxRadius);
    if (dx === 0 && dy === 0) {
      continue;
    }
    if (Math.abs(dx) + Math.abs(dy) > maxRadius) {
      continue;
    }
    const x = originX + dx;
    const y = originY + dy;
    if (x < 0 || y < 0 || x >= width || y >= height) {
      continue;
    }
    if (!isWalkableTile(state, x, y)) {
      continue;
    }
    return { x, y };
  }
  return null;
}

// Find any walkable tile by random sampling.
function findAnyWalkablePosition(state, runtime) {
  const width = runtime.gridWidth;
  const height = runtime.gridHeight;
  const attempts = Math.max(50, width * height);
  for (let i = 0; i < attempts; i += 1) {
    const x = randomBetween(0, width - 1);
    const y = randomBetween(0, height - 1);
    if (isWalkableTile(state, x, y)) {
      return { x, y };
    }
  }
  return null;
}

// Find a walkable tile on a given map edge.
function findEdgeWalkablePosition(state, runtime, side) {
  const positions = getEdgePositions(runtime, side);
  if (positions.length === 0) {
    return null;
  }
  const candidates = positions.filter((pos) => isSpawnableTile(state, pos.x, pos.y));
  if (candidates.length === 0) {
    return null;
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// Find a spawnable position on a map edge with fallback.
function findEdgeSpawnPosition(state, runtime, side) {
  const positions = getEdgePositions(runtime, side);
  if (positions.length === 0) {
    return { x: 0, y: 0 };
  }

  const candidates = positions.filter((pos) => isSpawnableTile(state, pos.x, pos.y));
  if (candidates.length > 0) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  return findAnyWalkablePosition(state, runtime) || positions[Math.floor(Math.random() * positions.length)];
}

// Build positions along the edge of the map for a side.
function getEdgePositions(runtime, side) {
  const positions = [];
  if (runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return positions;
  }
  if (side === 'north' || side === 'south') {
    const y = side === 'north' ? 0 : runtime.gridHeight - 1;
    for (let x = 0; x < runtime.gridWidth; x += 1) {
      positions.push({ x, y });
    }
    return positions;
  }
  const x = side === 'west' ? 0 : runtime.gridWidth - 1;
  for (let y = 0; y < runtime.gridHeight; y += 1) {
    positions.push({ x, y });
  }
  return positions;
}

// Return the 8-neighborhood positions around a point.
function getAdjacentPositions(x, y) {
  return [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
    { x: x + 1, y: y + 1 },
    { x: x + 1, y: y - 1 },
    { x: x - 1, y: y + 1 },
    { x: x - 1, y: y - 1 },
  ];
}

module.exports = {
  moveTowards,
  moveTowardsStep,
  moveWithDetour,
  applyMoveWithCooldown,
  pickMoveWithInertia,
  findLocalPathStep,
  moveDwarf,
  shouldPauseForMoveCooldown,
  findNearbyWalkablePosition,
  findAnyWalkablePosition,
  findEdgeWalkablePosition,
  findEdgeSpawnPosition,
  getEdgePositions,
  getAdjacentPositions,
};
