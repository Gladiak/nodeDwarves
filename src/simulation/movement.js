'use strict';

const { clamp } = require('../utils');
const { randomBetween } = require('./random');
const { getTerrainMoveDelay, isWalkableTile, isSpawnableTile } = require('./terrain');

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

// Move toward a target using a detour when stalled.
function moveWithDetour(entity, targetX, targetY, runtime, state, config, pathKey) {
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

// Apply a move and record terrain cooldown data.
function applyMoveWithCooldown(entity, x, y, state, config) {
  const dx = x - entity.x;
  const dy = y - entity.y;
  if (dx === 0 && dy === 0) {
    return false;
  }
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
  findAnyWalkablePosition,
  findEdgeWalkablePosition,
  findEdgeSpawnPosition,
  getEdgePositions,
  getAdjacentPositions,
};
