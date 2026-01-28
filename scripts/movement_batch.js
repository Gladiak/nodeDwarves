'use strict';

const config = require('../config.json');
const { createInitialState } = require('../src/state');
const { buildRuntime } = require('../src/runtime');
const { clamp } = require('../src/utils');

const args = parseArgs(process.argv.slice(2));
const seeds = Math.max(1, Number(args.seeds || 24));
const steps = Math.max(50, Number(args.steps || 400));
const defaultDwarves = Math.max(1, Number(args.dwarves || 12));
const defaultResource = String(args.resource || 'food_raw');
const defaultMode = String(args.mode || 'cycle');
const matrixMode = args.matrix === true || args.matrix === 'true';

const resourceList = parseList(args.resources) || (matrixMode ? ['food_raw', 'wood', 'stone', 'water'] : [defaultResource]);
const dwarvesList = parseNumberList(args.dwarvesList) || (matrixMode ? [4, 12, 24] : [defaultDwarves]);
const modeList = parseList(args.modes) || (matrixMode ? ['cycle', 'oneway'] : [defaultMode]);

const scenarioResults = [];
for (const resourceId of resourceList) {
  for (const dwarvesCount of dwarvesList) {
    for (const mode of modeList) {
      const results = [];
      for (let i = 0; i < seeds; i += 1) {
        const seed = Number.isFinite(Number(args.seed))
          ? Number(args.seed) + i
          : i + 1;
        results.push(runSeed(seed, resourceId, dwarvesCount, mode));
      }
      scenarioResults.push({
        resourceId,
        dwarvesCount,
        mode,
        results,
      });
    }
  }
}

printSummary(scenarioResults, {
  seeds,
  steps,
});

function runSeed(seed, resourceId, dwarvesCount, mode) {
  const sandboxConfig = JSON.parse(JSON.stringify(config));
  sandboxConfig.display = buildSandboxDisplay(config.display);
  sandboxConfig.display.colors.enabled = false;
  sandboxConfig.display.terrain.seed = seed;
  sandboxConfig.dwarves.count = dwarvesCount;
  sandboxConfig.merchant = { enabled: false };
  sandboxConfig.raids = { enabled: false };

  const runtime = buildRuntime(sandboxConfig.display, {
    columns: sandboxConfig.display.width,
    rows: sandboxConfig.display.height,
  });

  const state = createInitialState(sandboxConfig, runtime);
  const home = selectHomeCenter(state, runtime, sandboxConfig);
  state.structures = [
    {
      id: 'house_1',
      type: 'house',
      symbol: sandboxConfig.symbols.house || 'h',
      x: home.x,
      y: home.y,
    },
  ];
  state.dwarves = buildDwarves(dwarvesCount, home, state, runtime);

  const nodeTargets = buildResourceLookup(state.nodes || []);
  const terrainIndex = buildTerrainIndex(state.terrain);
  const pathing = getPathingConfig(sandboxConfig);

  let stallEvents = 0;
  let maxStallTicks = 0;
  let totalDistance = 0;
  let distanceSamples = 0;
  const stalledDwarves = new Set();
  let totalMoves = 0;
  let nonProgressMoves = 0;
  let backtrackMoves = 0;

  for (let tick = 0; tick < steps; tick += 1) {
    for (const dwarf of state.dwarves) {
      if (!dwarf.target || (mode === 'cycle' && dwarf.phase === 'to_resource')) {
        const target = pickResourceTarget(nodeTargets, terrainIndex, sandboxConfig, resourceId, home, dwarf);
        if (target) {
          dwarf.target = { x: target.x, y: target.y };
          dwarf.phase = 'to_resource';
        }
      }

      if (mode === 'cycle' && dwarf.phase === 'to_home') {
        dwarf.home = home;
      }

      if (dwarf.phase === 'to_resource') {
        if (dwarf.target && dwarf.x === dwarf.target.x && dwarf.y === dwarf.target.y) {
          if (mode === 'cycle') {
            dwarf.phase = 'to_home';
          } else {
            dwarf.target = null;
          }
        }
      }
      if (dwarf.phase === 'to_home') {
        if (dwarf.x === home.x && dwarf.y === home.y) {
          dwarf.phase = 'to_resource';
          dwarf.target = null;
        }
      }

      const dest = dwarf.phase === 'to_home' ? home : dwarf.target;
      if (dest && (dwarf.x !== dest.x || dwarf.y !== dest.y)) {
        const beforeX = dwarf.x;
        const beforeY = dwarf.y;
        const beforeDistance = Math.abs(dest.x - beforeX) + Math.abs(dest.y - beforeY);
        const moved = moveWithDetour(
          dwarf,
          dest.x,
          dest.y,
          runtime,
          state,
          sandboxConfig,
          `batch:${dwarf.id}:${dwarf.phase}`,
        );
        const afterDistance = Math.abs(dest.x - dwarf.x) + Math.abs(dest.y - dwarf.y);
        if (moved) {
          totalMoves += 1;
          if (afterDistance >= beforeDistance) {
            nonProgressMoves += 1;
          }
          if (Number.isFinite(dwarf.prevX) && Number.isFinite(dwarf.prevY)) {
            if (dwarf.prevX === dwarf.x && dwarf.prevY === dwarf.y) {
              backtrackMoves += 1;
            }
          }
          dwarf.prevX = beforeX;
          dwarf.prevY = beforeY;
        }
        if (moved) {
          dwarf.stallTicks = 0;
        } else {
          dwarf.stallTicks = Number(dwarf.stallTicks || 0) + 1;
        }
      }
    }

    let stalledThisTick = 0;
    for (const dwarf of state.dwarves) {
      const dest = dwarf.phase === 'to_home' ? home : dwarf.target;
      if (dest) {
        totalDistance += Math.abs(dest.x - dwarf.x) + Math.abs(dest.y - dwarf.y);
        distanceSamples += 1;
      }
      const stallTicks = Number(dwarf.stallTicks || 0);
      if (stallTicks > maxStallTicks) {
        maxStallTicks = stallTicks;
      }
      if (stallTicks >= pathing.stallThreshold) {
        stalledThisTick += 1;
        stalledDwarves.add(dwarf.id);
      }
    }
    if (stalledThisTick > 0) {
      stallEvents += 1;
    }
  }

  return {
    seed,
    stallEventRate: stallEvents / steps,
    maxStallTicks,
    stalledDwarves: stalledDwarves.size,
    avgDistance: distanceSamples > 0 ? totalDistance / distanceSamples : 0,
    nonProgressRate: totalMoves > 0 ? nonProgressMoves / totalMoves : 0,
    backtrackRate: totalMoves > 0 ? backtrackMoves / totalMoves : 0,
  };
}

function printSummary(scenarios, meta) {
  console.log('== Movement batch summary ==');
  console.log(`seeds=${meta.seeds} steps=${meta.steps}`);
  for (const scenario of scenarios) {
    const resultsList = scenario.results;
    const avg = (key) => resultsList.reduce((sum, item) => sum + Number(item[key] || 0), 0) / resultsList.length;
    const worst = [...resultsList].sort((a, b) => b.stallEventRate - a.stallEventRate).slice(0, 3);
    console.log(
      `\nresource=${scenario.resourceId} dwarves=${scenario.dwarvesCount} mode=${scenario.mode}`,
    );
    console.log(
      `avg stallEventRate=${avg('stallEventRate').toFixed(3)} `
      + `avg maxStall=${avg('maxStallTicks').toFixed(1)} `
      + `avgDistance=${avg('avgDistance').toFixed(2)} `
      + `avg nonProgressRate=${avg('nonProgressRate').toFixed(3)} `
      + `avg backtrackRate=${avg('backtrackRate').toFixed(3)}`,
    );
    console.log('worst seeds:');
    for (const item of worst) {
      console.log(
        `  seed=${item.seed} stallEventRate=${item.stallEventRate.toFixed(3)} `
        + `maxStall=${item.maxStallTicks} `
        + `stalledDwarves=${item.stalledDwarves} `
        + `avgDist=${item.avgDistance.toFixed(2)} `
        + `nonProg=${item.nonProgressRate.toFixed(3)} `
        + `backtrack=${item.backtrackRate.toFixed(3)}`,
      );
    }
  }
}

function buildSandboxDisplay(display) {
  const width = Number((display && display.width) || 120);
  const height = Number((display && display.height) || 32);
  return {
    ...display,
    width,
    height,
    autoSize: false,
    hud: { enabled: false },
    header: { enabled: false, height: 0 },
    footer: { enabled: false, height: 0 },
    frame: { enabled: false },
  };
}

function buildDwarves(count, home, state, runtime) {
  const dwarves = [];
  const occupied = new Set();
  occupied.add(`${home.x},${home.y}`);
  for (let i = 0; i < count; i += 1) {
    const pos = findNearbySpawn(home, runtime, state, occupied);
    dwarves.push({
      id: `dwarf_${i + 1}`,
      x: pos.x,
      y: pos.y,
      phase: 'to_resource',
      target: null,
      home,
      moveCooldown: 0,
      pathTargetKey: null,
      pathDetourTicks: 0,
      pathStallTicks: 0,
      stallTicks: 0,
    });
    occupied.add(`${pos.x},${pos.y}`);
  }
  return dwarves;
}

function findNearbySpawn(home, runtime, state, occupied) {
  const maxRadius = 4;
  for (let radius = 0; radius <= maxRadius; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        const x = clamp(home.x + dx, 0, runtime.gridWidth - 1);
        const y = clamp(home.y + dy, 0, runtime.gridHeight - 1);
        const key = `${x},${y}`;
        if (occupied.has(key)) {
          continue;
        }
        if (!isWalkableTile(state, x, y)) {
          continue;
        }
        return { x, y };
      }
    }
  }
  return { x: home.x, y: home.y };
}

function selectHomeCenter(state, runtime, cfg) {
  const settlement = getSettlementConfig(cfg);
  if (!settlement.enabled || !state.terrain || !state.terrain.types) {
    return { x: Math.floor(runtime.gridWidth / 2), y: Math.floor(runtime.gridHeight / 2) };
  }

  const nodesByResource = buildResourceLookup(state.nodes || []);
  const nodePositions = buildNodePositionSet(state.nodes || []);
  const centerFallback = { x: Math.floor(runtime.gridWidth / 2), y: Math.floor(runtime.gridHeight / 2) };
  let best = null;
  let bestFallback = null;
  for (let y = 0; y < runtime.gridHeight; y += settlement.scanStep) {
    for (let x = 0; x < runtime.gridWidth; x += settlement.scanStep) {
      if (!isSpawnableTile(state, x, y)) {
        continue;
      }
      const stats = scoreSettlementCandidate(state, runtime, x, y, settlement.clearRadius, settlement.blockedTerrain, nodePositions);
      if (!stats || stats.total === 0) {
        continue;
      }
      const resourceScore = scoreResourceProximity(nodesByResource, settlement.resourceWeights, settlement.resourceDistanceCap, x, y);
      const candidate = {
        x,
        y,
        openRatio: stats.openRatio,
        resourceScore,
        centerDistance: Math.abs(centerFallback.x - x) + Math.abs(centerFallback.y - y),
      };
      if (stats.openRatio >= settlement.minOpenRatio) {
        if (isBetterSettlementCandidate(candidate, best)) {
          best = candidate;
        }
      } else if (isBetterSettlementCandidate(candidate, bestFallback)) {
        bestFallback = candidate;
      }
    }
  }
  const pick = best || bestFallback;
  return pick ? { x: pick.x, y: pick.y } : centerFallback;
}

function getSettlementConfig(cfg) {
  const population = (cfg && cfg.population) || {};
  const raw = population.settlement || {};
  const scanStep = clamp(Math.floor(Number(raw.scanStep ?? 3)), 1, 8);
  const clearRadius = clamp(Math.floor(Number(raw.clearRadius ?? 6)), 2, 16);
  const minOpenRatio = clamp(Number(raw.minOpenRatio ?? 0.65), 0, 1);
  const resourceDistanceCap = Math.max(5, Number(raw.resourceDistanceCap ?? 40));
  const defaultBlocked = ['river', 'lake', 'mountain', 'forest', 'stone'];
  const blockedTerrain = Array.isArray(raw.blockedTerrain) && raw.blockedTerrain.length > 0
    ? raw.blockedTerrain.map((value) => String(value))
    : defaultBlocked;
  const defaultWeights = { food_raw: 1, water: 1, wood: 0.8, stone: 0.6 };
  const resourceWeights = { ...defaultWeights };
  if (raw.resourceWeights && typeof raw.resourceWeights === 'object') {
    for (const [key, value] of Object.entries(raw.resourceWeights)) {
      resourceWeights[key] = clamp(Number(value ?? resourceWeights[key] ?? 0), 0, 1);
    }
  }
  return {
    enabled: raw.enabled !== false,
    scanStep,
    clearRadius,
    minOpenRatio,
    resourceDistanceCap,
    resourceWeights,
    blockedTerrain: new Set(blockedTerrain),
  };
}

function buildResourceLookup(nodes) {
  const lookup = {};
  for (const node of nodes || []) {
    if (!node || !node.id) {
      continue;
    }
    if (!lookup[node.id]) {
      lookup[node.id] = [];
    }
    lookup[node.id].push(node);
  }
  return lookup;
}

function buildTerrainIndex(terrain) {
  if (!terrain || !terrain.types) {
    return { typePositions: {} };
  }
  const typePositions = {};
  for (let y = 0; y < terrain.height; y += 1) {
    const row = terrain.types[y];
    for (let x = 0; x < terrain.width; x += 1) {
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
  return { typePositions };
}

function buildNodePositionSet(nodes) {
  const set = new Set();
  for (const node of nodes || []) {
    set.add(`${node.x},${node.y}`);
  }
  return set;
}

function scoreSettlementCandidate(state, runtime, centerX, centerY, radius, blocked, nodePositions) {
  let open = 0;
  let total = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dist > radius) {
        continue;
      }
      const x = centerX + dx;
      const y = centerY + dy;
      if (x < 0 || y < 0 || x >= runtime.gridWidth || y >= runtime.gridHeight) {
        continue;
      }
      total += 1;
      if (!isSpawnableTile(state, x, y)) {
        continue;
      }
      if (nodePositions && nodePositions.has(`${x},${y}`)) {
        continue;
      }
      const type = getTerrainTypeAt(state, x, y);
      if (type && blocked && blocked.has(type)) {
        continue;
      }
      open += 1;
    }
  }
  if (total <= 0) {
    return null;
  }
  return { openRatio: open / total, open, total };
}

function scoreResourceProximity(lookup, weights, cap, x, y) {
  let score = 0;
  for (const [resource, weightRaw] of Object.entries(weights || {})) {
    const weight = clamp(Number(weightRaw ?? 0), 0, 1);
    if (weight <= 0) {
      continue;
    }
    const nodes = lookup[resource];
    if (!Array.isArray(nodes) || nodes.length === 0) {
      continue;
    }
    let best = Infinity;
    for (const node of nodes) {
      const dist = Math.abs(Number(node.x || 0) - x) + Math.abs(Number(node.y || 0) - y);
      if (dist < best) {
        best = dist;
      }
    }
    const normalized = 1 - clamp(best / cap, 0, 1);
    score += normalized * weight;
  }
  return score;
}

function isBetterSettlementCandidate(candidate, currentBest) {
  if (!candidate) {
    return false;
  }
  if (!currentBest) {
    return true;
  }
  if (candidate.openRatio > currentBest.openRatio + 1e-6) {
    return true;
  }
  if (Math.abs(candidate.openRatio - currentBest.openRatio) <= 1e-6) {
    if (candidate.resourceScore > currentBest.resourceScore + 1e-6) {
      return true;
    }
    if (Math.abs(candidate.resourceScore - currentBest.resourceScore) <= 1e-6) {
      if (candidate.centerDistance < currentBest.centerDistance) {
        return true;
      }
    }
  }
  return false;
}

function pickResourceTarget(nodeLookup, terrainIndex, cfg, resourceId, anchor, dwarf) {
  const nodes = nodeLookup[resourceId];
  if (Array.isArray(nodes) && nodes.length > 0) {
    const base = anchor || dwarf || nodes[0];
    let best = null;
    let bestDist = Infinity;
    for (const node of nodes) {
      const dist = Math.abs(node.x - base.x) + Math.abs(node.y - base.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = node;
      }
    }
    return best || nodes[0];
  }
  if (cfg.resources && cfg.resources.useTerrainTiles === true) {
    return pickTerrainTileTarget(terrainIndex, cfg.resources.terrainAllowed, resourceId, anchor || dwarf);
  }
  return null;
}

function pickTerrainTileTarget(terrainIndex, terrainAllowed, resourceId, anchor) {
  if (!terrainIndex || !terrainAllowed) {
    return null;
  }
  const allowed = Array.isArray(terrainAllowed[resourceId]) ? terrainAllowed[resourceId] : null;
  if (!allowed || allowed.length === 0) {
    return null;
  }
  const samples = [];
  const samplePerType = 200;
  const maxFullScan = 8000;
  let totalPositions = 0;
  for (const type of allowed) {
    const list = terrainIndex.typePositions[type] || [];
    totalPositions += list.length;
  }
  const useFullScan = totalPositions > 0 && totalPositions <= maxFullScan;
  for (const type of allowed) {
    const list = terrainIndex.typePositions[type] || [];
    if (list.length === 0) {
      continue;
    }
    if (useFullScan || list.length <= samplePerType) {
      samples.push(...list);
    } else {
      for (let i = 0; i < samplePerType; i += 1) {
        samples.push(list[Math.floor(Math.random() * list.length)]);
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
  let bestDist = Math.abs(best.x - anchor.x) + Math.abs(best.y - anchor.y);
  for (let i = 1; i < samples.length; i += 1) {
    const candidate = samples[i];
    const dist = Math.abs(candidate.x - anchor.x) + Math.abs(candidate.y - anchor.y);
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}

function getTerrainTypeAt(state, x, y) {
  const terrain = state && state.terrain;
  if (!terrain || !terrain.types || !terrain.types[y]) {
    return null;
  }
  return terrain.types[y][x] || null;
}

function isWalkableTile(state, x, y) {
  const terrain = state && state.terrain;
  if (!terrain || !terrain.walkable || !terrain.walkable[y]) {
    return true;
  }
  return Boolean(terrain.walkable[y][x]);
}

function isSpawnableTile(state, x, y) {
  const terrain = state && state.terrain;
  if (terrain && terrain.spawnable && terrain.spawnable[y]) {
    return Boolean(terrain.spawnable[y][x]);
  }
  return isWalkableTile(state, x, y);
}

function getTerrainMoveDelay(state, cfg, x, y) {
  const type = getTerrainTypeAt(state, x, y);
  if (!type) {
    return 0;
  }
  const terrainConfig = cfg && cfg.display && cfg.display.terrain;
  const movementDelay = terrainConfig && terrainConfig.movementDelay;
  if (!movementDelay || typeof movementDelay !== 'object') {
    return 0;
  }
  return Math.max(0, Math.floor(Number(movementDelay[type] || 0)));
}

function shouldPauseForMoveCooldown(entity) {
  const cooldown = Math.max(0, Number(entity.moveCooldown || 0));
  if (cooldown <= 0) {
    return false;
  }
  entity.moveCooldown = cooldown - 1;
  return true;
}

function moveWithDetour(entity, targetX, targetY, runtime, state, cfg, pathKey) {
  if (runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return false;
  }
  if (shouldPauseForMoveCooldown(entity)) {
    return false;
  }
  const pathing = getPathingConfig(cfg);
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
    || Number(entity.pathStallTicks || 0) >= pathing.stallThreshold;
  if (useDetour && Number(entity.pathDetourTicks || 0) === 0 && pathing.detourTicks > 0) {
    entity.pathDetourTicks = pathing.detourTicks;
  }

  let moved = false;
  if (useDetour) {
    const step = findLocalPathStep(state, runtime, entity.x, entity.y, targetX, targetY, pathing.bfsRadius);
    if (step) {
      moved = applyMoveWithCooldown(entity, step.x, step.y, state, cfg);
    }
  }
  if (!moved) {
    moveTowardsStep(entity, { x: targetX, y: targetY }, runtime, state, cfg);
    moved = entity.x !== beforeX || entity.y !== beforeY;
  }

  const afterDistance = Math.abs(targetX - entity.x) + Math.abs(targetY - entity.y);
  if (moved && afterDistance < beforeDistance) {
    entity.pathStallTicks = 0;
  } else if (!moved && Number(entity.moveCooldown || 0) > 0) {
    // cooldown stall
  } else {
    entity.pathStallTicks = Number(entity.pathStallTicks || 0) + 1;
  }

  if (Number(entity.pathDetourTicks || 0) > 0 && useDetour) {
    entity.pathDetourTicks = Math.max(0, Number(entity.pathDetourTicks || 0) - 1);
  }

  return moved;
}

function getPathingConfig(cfg) {
  const pathing = (cfg.population && cfg.population.pathing) || {};
  return {
    stallThreshold: Math.max(1, Number(pathing.stallThreshold || 6)),
    detourTicks: Math.max(0, Number(pathing.detourTicks || 4)),
    bfsRadius: Math.max(3, Number(pathing.bfsRadius || 10)),
  };
}

function moveTowardsStep(entity, target, runtime, state, cfg) {
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
  const hasStall = bestDistance === currentDistance;
  const candidates = hasStall
    ? valid.filter((pos) => !(pos.x === entity.x && pos.y === entity.y))
    : best;
  if (candidates.length === 0) {
    return;
  }
  const pick = pickMoveWithInertia(entity, candidates, targetX, targetY, currentDistance);
  if (!pick) {
    return;
  }
  applyMoveWithCooldown(entity, pick.x, pick.y, state, cfg);
}

function applyMoveWithCooldown(entity, x, y, state, cfg) {
  const dx = x - entity.x;
  const dy = y - entity.y;
  if (dx === 0 && dy === 0) {
    return false;
  }
  entity.lastMoveDx = dx;
  entity.lastMoveDy = dy;
  entity.x = x;
  entity.y = y;
  const delay = getTerrainMoveDelay(state, cfg, x, y);
  if (delay > 0) {
    entity.moveCooldown = delay;
  }
  return true;
}

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

function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      continue;
    }
    const [key, value] = arg.slice(2).split('=');
    parsed[key] = value === undefined ? true : value;
  }
  return parsed;
}

function parseList(value) {
  if (!value) {
    return null;
  }
  const list = String(value)
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return list.length > 0 ? list : null;
}

function parseNumberList(value) {
  const list = parseList(value);
  if (!list) {
    return null;
  }
  const numbers = list
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0);
  return numbers.length > 0 ? numbers : null;
}
