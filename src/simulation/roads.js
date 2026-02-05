'use strict';

const { clamp } = require('../utils');
const { getStockpileRatio, hasInputs, consumeInputs } = require('./resources');
const { getTerrainTypeAt } = require('./terrain');
const { pushEvent } = require('./events');

const NEIGHBOR_STEPS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

// Normalize roads config with safe defaults.
function getRoadsConfig(config) {
  const raw = (config && config.roads) || {};
  const buildEveryTicks = Math.max(1, Math.floor(Number(raw.buildEveryTicks ?? 10)));
  const buildMinResources = raw.buildMinResources && typeof raw.buildMinResources === 'object'
    ? raw.buildMinResources
    : null;
  const avoidTerrain = Array.isArray(raw.avoidTerrain) && raw.avoidTerrain.length > 0
    ? raw.avoidTerrain.map((value) => String(value))
    : [];
  const waterTerrain = Array.isArray(raw.waterTerrain) && raw.waterTerrain.length > 0
    ? raw.waterTerrain.map((value) => String(value))
    : ['lake', 'water', 'shore'];
  const softAvoidTerrain = Array.isArray(raw.softAvoidTerrain) && raw.softAvoidTerrain.length > 0
    ? raw.softAvoidTerrain.map((value) => String(value))
    : waterTerrain.slice();
  const anchorRadius = Math.max(0, Math.floor(Number(raw.anchorRadius ?? 1)));
  const parallelAvoidRadius = Math.max(0, Math.floor(Number(raw.parallelAvoidRadius ?? 1)));
  const parallelRelaxRadius = Math.max(0, Math.floor(Number(raw.parallelRelaxRadius ?? 0)));
  const parallelRelaxOnFail = raw.parallelRelaxOnFail !== false;
  const allowWaterFallback = raw.allowWaterFallback !== false;
  const crossings = raw.crossings || {};
  const cost = raw.cost || {};
  return {
    enabled: raw.enabled !== false,
    buildEveryTicks,
    buildMinResources,
    avoidTerrain,
    waterTerrain,
    softAvoidTerrain,
    anchorRadius,
    parallelAvoidRadius,
    parallelRelaxRadius,
    parallelRelaxOnFail,
    allowWaterFallback,
    connectVillages: raw.connectVillages !== false,
    connectMines: raw.connectMines !== false,
    crossings: {
      village: String(crossings.village || 'bridge'),
      mine: String(crossings.mine || 'ford'),
    },
    cost,
  };
}

// Build a blank road state sized to the current grid.
function createRoadState(width, height) {
  return {
    width,
    height,
    types: Array.from({ length: height }, () => new Array(width).fill(null)),
    queue: [],
    queueIndex: 0,
    planned: {},
    links: {},
    tileLinks: {},
    failedLinks: {},
    primaryMineLinkKey: null,
    nextBuildTick: 0,
    retryLinks: {},
  };
}

// Ensure a road state exists and matches the runtime grid.
function ensureRoadState(state, runtime) {
  if (!state || !runtime || runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return null;
  }
  const width = Math.max(0, Number(runtime.gridWidth || 0));
  const height = Math.max(0, Number(runtime.gridHeight || 0));
  if (!state.roads
      || state.roads.width !== width
      || state.roads.height !== height
      || !state.roads.types) {
    state.roads = createRoadState(width, height);
  }
  return state.roads;
}

// Update road planning and construction per tick.
function updateRoads(state, config, runtime) {
  if (!state || !config || !runtime) {
    return;
  }
  const roadsConfig = getRoadsConfig(config);
  if (roadsConfig.enabled === false) {
    if (state.roads) {
      state.roads = null;
    }
    return;
  }
  if (!state.terrain || !state.terrain.types) {
    return;
  }
  const roads = ensureRoadState(state, runtime);
  if (!roads) {
    return;
  }
  updateRetryLinks(roads, roadsConfig);

  const primaryMineKey = planMineLinks(state, roads, roadsConfig, runtime, config);
  if (!primaryMineKey
    || isLinkCompleted(roads, primaryMineKey)
    || roads.failedLinks[primaryMineKey]) {
    planVillageLinks(state, roads, roadsConfig, runtime, config);
  }

  if (state.tick < Number(roads.nextBuildTick || 0)) {
    return;
  }

  const built = buildNextRoadTile(state, roads, roadsConfig, config);
  if (built !== null) {
    roads.nextBuildTick = Number(state.tick || 0) + roadsConfig.buildEveryTicks;
  }
}

// Plan a link between the newest villages and the nearest existing center.
function planVillageLinks(state, roads, roadsConfig, runtime, config) {
  if (!roadsConfig.connectVillages) {
    return;
  }
  const villages = Array.isArray(state.villages) ? state.villages : [];
  if (villages.length < 2) {
    return;
  }
  const ordered = villages.slice().sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
  if (ordered.length >= 2) {
    const v1 = ordered[0];
    const v2 = ordered[1];
    const link12Key = buildVillageLinkKey(v1.id, v2.id);
    if (!roads.links[link12Key] && !roads.failedLinks[link12Key]) {
      planRoadLink(
        state,
        roads,
        roadsConfig,
        runtime,
        config,
        link12Key,
        'village',
        v1.center,
        v2.center,
      );
    }
    if (ordered.length >= 3 && isLinkCompleted(roads, link12Key)) {
      const v3 = ordered[2];
      const nearest = findNearestVillageCenter(v3.center, [v1, v2]);
      if (!nearest) {
        return;
      }
      const linkKey = buildVillageLinkKey(nearest.id, v3.id);
      if (!roads.links[linkKey] && !roads.failedLinks[linkKey]) {
        planRoadLink(
          state,
          roads,
          roadsConfig,
          runtime,
          config,
          linkKey,
          'village',
          nearest.center,
          v3.center,
        );
      }
    }
  }
}

// Plan mine links and return the primary mine link key.
function planMineLinks(state, roads, roadsConfig, runtime, config) {
  if (!roadsConfig.connectMines) {
    return null;
  }
  const villages = Array.isArray(state.villages) ? state.villages : [];
  if (villages.length === 0) {
    return null;
  }
  const mines = (state.structures || []).filter((structure) => structure.type === 'mine');
  if (mines.length === 0) {
    return null;
  }
  const orderedVillages = villages.slice().sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
  const primaryVillage = orderedVillages[0];
  if (!primaryVillage || !primaryVillage.center) {
    return null;
  }
  let linkKey = roads.primaryMineLinkKey;
  if (!linkKey) {
    const targetMine = selectNearestMine(primaryVillage.center, mines, roads);
    if (!targetMine) {
      return null;
    }
    linkKey = buildMineLinkKey(targetMine);
    roads.primaryMineLinkKey = linkKey;
    if (!roads.links[linkKey] && !roads.failedLinks[linkKey]) {
      planRoadLink(
        state,
        roads,
        roadsConfig,
        runtime,
        config,
        linkKey,
        'mine',
        primaryVillage.center,
        targetMine,
      );
    }
  }
  for (const mine of mines) {
    const mineKey = buildMineLinkKey(mine);
    if (roads.links[mineKey] || roads.failedLinks[mineKey]) {
      continue;
    }
    if (mineKey === linkKey) {
      continue;
    }
    const nearestVillage = findNearestVillageCenter(mine, orderedVillages);
    if (!nearestVillage) {
      continue;
    }
    planRoadLink(
      state,
      roads,
      roadsConfig,
      runtime,
      config,
      mineKey,
      'mine',
      nearestVillage.center,
      mine,
    );
  }
  return linkKey;
}

function buildVillageLinkKey(aId, bId) {
  const a = Math.max(0, Number(aId || 0));
  const b = Math.max(0, Number(bId || 0));
  return a <= b ? `v${a}-v${b}` : `v${b}-v${a}`;
}

function buildMineLinkKey(mine) {
  if (!mine) {
    return 'mine:unknown';
  }
  return `mine:${mine.id || `${mine.x},${mine.y}`}`;
}

function isLinkCompleted(roads, linkKey) {
  if (!roads || !roads.links || !linkKey) {
    return false;
  }
  const link = roads.links[linkKey];
  return Boolean(link && link.completed);
}

function findNearestVillageCenter(source, candidates) {
  if (!source || !Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }
  let best = null;
  let bestDist = Infinity;
  for (const village of candidates) {
    if (!village || !village.center) {
      continue;
    }
    const dist = Math.abs(Number(source.x || 0) - Number(village.center.x || 0))
      + Math.abs(Number(source.y || 0) - Number(village.center.y || 0));
    if (dist < bestDist) {
      bestDist = dist;
      best = village;
    } else if (dist === bestDist && best && Number(village.id || 0) < Number(best.id || 0)) {
      best = village;
    }
  }
  return best;
}
function selectNearestMine(center, mines, roads) {
  if (!center || !Array.isArray(mines) || mines.length === 0) {
    return null;
  }
  let best = null;
  let bestDist = Infinity;
  for (const mine of mines) {
    if (!mine) {
      continue;
    }
    const linkKey = buildMineLinkKey(mine);
    if (roads && roads.failedLinks && roads.failedLinks[linkKey]) {
      continue;
    }
    const dist = Math.abs(Number(center.x || 0) - Number(mine.x || 0))
      + Math.abs(Number(center.y || 0) - Number(mine.y || 0));
    if (dist < bestDist) {
      bestDist = dist;
      best = mine;
    } else if (dist === bestDist && best && String(mine.id || '') < String(best.id || '')) {
      best = mine;
    }
  }
  return best;
}

// Plan a road link and enqueue tiles to build.
function planRoadLink(state, roads, roadsConfig, runtime, config, linkKey, kind, start, goal) {
  if (!start || !goal) {
    markLinkFailed(roads, linkKey, roadsConfig);
    return;
  }
  const anchorStart = findRoadAnchor(roads, runtime, start, roadsConfig.anchorRadius, goal);
  const anchorGoal = findRoadAnchor(roads, runtime, goal, roadsConfig.anchorRadius, start);
  const from = anchorStart || start;
  const to = anchorGoal || goal;
  const path = findRoadPath(state, roads, runtime, roadsConfig, from, to);
  if (!path || path.length === 0) {
    markLinkFailed(roads, linkKey, roadsConfig);
    return;
  }

  const crossingType = resolveCrossingType(roadsConfig, kind);
  let pending = 0;
  for (const pos of path) {
    const key = `${pos.x},${pos.y}`;
    const tileType = resolveRoadTileType(state, pos.x, pos.y, crossingType, roadsConfig);
    if (!tileType) {
      continue;
    }
    if (roads.types[pos.y] && roads.types[pos.y][pos.x]) {
      continue;
    }
    pending += 1;
    if (!roads.planned[key]) {
      roads.queue.push({
        x: pos.x,
        y: pos.y,
        type: tileType,
      });
      roads.planned[key] = true;
    }
    if (!roads.tileLinks[key]) {
      roads.tileLinks[key] = [];
    }
    roads.tileLinks[key].push(linkKey);
  }

  roads.links[linkKey] = {
    key: linkKey,
    kind,
    from: { x: from.x, y: from.y },
    to: { x: to.x, y: to.y },
    pending,
    completed: pending === 0,
  };

  if (pending === 0) {
    finalizeRoadLink(state, roads, config, linkKey);
  }
}

function resolveCrossingType(roadsConfig, kind) {
  if (!roadsConfig || !roadsConfig.crossings) {
    return 'bridge';
  }
  if (kind === 'mine') {
    return roadsConfig.crossings.mine || 'ford';
  }
  return roadsConfig.crossings.village || 'bridge';
}

function resolveRoadTileType(state, x, y, crossingType, roadsConfig) {
  const terrainType = getTerrainTypeAt(state, x, y);
  if (isWaterTerrain(roadsConfig, terrainType)) {
    return 'bridge';
  }
  if (terrainType === 'river') {
    return crossingType === 'ford' ? 'ford' : 'bridge';
  }
  return 'road';
}

// Find a Manhattan path avoiding blocked terrain types.
function findRoadPath(state, roads, runtime, roadsConfig, start, goal) {
  const width = Math.max(0, Number(runtime.gridWidth || 0));
  const height = Math.max(0, Number(runtime.gridHeight || 0));
  const startX = clamp(Number(start.x || 0), 0, width - 1);
  const startY = clamp(Number(start.y || 0), 0, height - 1);
  const goalX = clamp(Number(goal.x || 0), 0, width - 1);
  const goalY = clamp(Number(goal.y || 0), 0, height - 1);
  if (startX === goalX && startY === goalY) {
    return [{ x: startX, y: startY }];
  }

  const avoid = Array.isArray(roadsConfig.avoidTerrain) ? roadsConfig.avoidTerrain : [];
  const softAvoid = Array.isArray(roadsConfig.softAvoidTerrain) ? roadsConfig.softAvoidTerrain : [];
  const parallelAvoidRadius = Math.max(0, Number(roadsConfig.parallelAvoidRadius || 0));
  const parallelBuffer = Math.max(0, Number(roadsConfig.anchorRadius || 0));
  const parallelRelaxRadius = Math.max(0, Number(roadsConfig.parallelRelaxRadius || 0));
  const parallelRelaxOnFail = roadsConfig.parallelRelaxOnFail !== false;
  const hardAvoid = new Set(avoid);
  const avoidWithSoft = new Set([...hardAvoid, ...softAvoid]);

  const primary = findRoadPathWithAvoid(
    state,
    roads,
    width,
    height,
    startX,
    startY,
    goalX,
    goalY,
    avoidWithSoft,
    parallelAvoidRadius,
    parallelBuffer,
  );
  if (primary) {
    return primary;
  }
  if (roadsConfig.allowWaterFallback === false) {
    if (parallelRelaxOnFail && parallelAvoidRadius > parallelRelaxRadius) {
      return findRoadPathWithAvoid(
        state,
        roads,
        width,
        height,
        startX,
        startY,
        goalX,
        goalY,
        avoidWithSoft,
        parallelRelaxRadius,
        parallelBuffer,
      );
    }
    return null;
  }
  const fallback = findRoadPathWithAvoid(
    state,
    roads,
    width,
    height,
    startX,
    startY,
    goalX,
    goalY,
    hardAvoid,
    parallelAvoidRadius,
    parallelBuffer,
  );
  if (fallback) {
    return fallback;
  }
  if (parallelRelaxOnFail && parallelAvoidRadius > parallelRelaxRadius) {
    const relaxedPrimary = findRoadPathWithAvoid(
      state,
      roads,
      width,
      height,
      startX,
      startY,
      goalX,
      goalY,
      avoidWithSoft,
      parallelRelaxRadius,
      parallelBuffer,
    );
    if (relaxedPrimary) {
      return relaxedPrimary;
    }
    return findRoadPathWithAvoid(
      state,
      roads,
      width,
      height,
      startX,
      startY,
      goalX,
      goalY,
      hardAvoid,
      parallelRelaxRadius,
      parallelBuffer,
    );
  }
  return null;
}

function findRoadPathWithAvoid(
  state,
  roads,
  width,
  height,
  startX,
  startY,
  goalX,
  goalY,
  avoidSet,
  parallelAvoidRadius,
  parallelBuffer,
) {
  const isRoadTile = (x, y) => {
    if (roads && roads.types && roads.types[y] && roads.types[y][x]) {
      return true;
    }
    if (roads && roads.planned && roads.planned[`${x},${y}`]) {
      return true;
    }
    return false;
  };
  const isNearRoad = (x, y, radius) => {
    if (!roads || radius <= 0) {
      return false;
    }
    for (let dy = -radius; dy <= radius; dy += 1) {
      const ny = y + dy;
      if (ny < 0 || ny >= height) {
        continue;
      }
      for (let dx = -radius; dx <= radius; dx += 1) {
        const nx = x + dx;
        if (nx < 0 || nx >= width) {
          continue;
        }
        if (nx === x && ny === y) {
          continue;
        }
        if (isRoadTile(nx, ny)) {
          return true;
        }
      }
    }
    return false;
  };
  const isPassable = (x, y) => {
    if (x === goalX && y === goalY) {
      return true;
    }
    if (isRoadTile(x, y)) {
      return true;
    }
    if (parallelAvoidRadius > 0
      && !(x === startX && y === startY)
      && !(x === goalX && y === goalY)
      && isNearRoad(x, y, parallelAvoidRadius)) {
      const distStart = Math.abs(x - startX) + Math.abs(y - startY);
      const distGoal = Math.abs(x - goalX) + Math.abs(y - goalY);
      if (distStart > parallelBuffer && distGoal > parallelBuffer) {
        return false;
      }
    }
    const type = getTerrainTypeAt(state, x, y);
    return !(type && avoidSet.has(type));
  };

  const size = width * height;
  const prev = new Int32Array(size);
  for (let i = 0; i < size; i += 1) {
    prev[i] = -1;
  }
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;
  const startIndex = startY * width + startX;
  const goalIndex = goalY * width + goalX;
  prev[startIndex] = startIndex;
  queue[tail++] = startIndex;

  while (head < tail) {
    const index = queue[head++];
    if (index === goalIndex) {
      break;
    }
    const x = index % width;
    const y = Math.floor(index / width);
    for (const step of NEIGHBOR_STEPS) {
      const nx = x + step.dx;
      const ny = y + step.dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }
      const nextIndex = ny * width + nx;
      if (prev[nextIndex] !== -1) {
        continue;
      }
      if (!isPassable(nx, ny)) {
        continue;
      }
      prev[nextIndex] = index;
      queue[tail++] = nextIndex;
    }
  }

  if (prev[goalIndex] === -1) {
    return null;
  }
  const path = [];
  let current = goalIndex;
  while (current !== startIndex) {
    const cx = current % width;
    const cy = Math.floor(current / width);
    path.push({ x: cx, y: cy });
    current = prev[current];
  }
  path.push({ x: startX, y: startY });
  path.reverse();
  return path;
}

function isWaterTerrain(roadsConfig, terrainType) {
  if (!terrainType || !roadsConfig || !Array.isArray(roadsConfig.waterTerrain)) {
    return false;
  }
  return roadsConfig.waterTerrain.includes(terrainType);
}

function findRoadAnchor(roads, runtime, pos, radius, target) {
  if (!roads || !roads.types || !pos || radius <= 0) {
    return null;
  }
  const width = Math.max(0, Number(runtime.gridWidth || 0));
  const height = Math.max(0, Number(runtime.gridHeight || 0));
  const startX = clamp(Number(pos.x || 0), 0, width - 1);
  const startY = clamp(Number(pos.y || 0), 0, height - 1);
  const targetX = target && Number.isFinite(target.x) ? Math.floor(Number(target.x)) : null;
  const targetY = target && Number.isFinite(target.y) ? Math.floor(Number(target.y)) : null;
  const isRoad = (x, y) => {
    if (roads.types[y] && roads.types[y][x]) {
      return true;
    }
    if (roads.planned && roads.planned[`${x},${y}`]) {
      return true;
    }
    return false;
  };

  if (isRoad(startX, startY)) {
    return { x: startX, y: startY };
  }

  const maxRadius = Math.max(1, Math.floor(radius));
  let best = null;
  let bestTargetDist = Infinity;
  let bestSelfDist = Infinity;
  for (let r = 1; r <= maxRadius; r += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      const dy = r - Math.abs(dx);
      const x1 = startX + dx;
      const y1 = startY + dy;
      if (x1 >= 0 && y1 >= 0 && x1 < width && y1 < height && isRoad(x1, y1)) {
        const selfDist = Math.abs(x1 - startX) + Math.abs(y1 - startY);
        const targetDist = targetX === null ? 0 : Math.abs(x1 - targetX) + Math.abs(y1 - targetY);
        if (targetDist < bestTargetDist || (targetDist === bestTargetDist && selfDist < bestSelfDist)) {
          best = { x: x1, y: y1 };
          bestTargetDist = targetDist;
          bestSelfDist = selfDist;
        }
      }
      if (dy !== 0) {
        const x2 = startX + dx;
        const y2 = startY - dy;
        if (x2 >= 0 && y2 >= 0 && x2 < width && y2 < height && isRoad(x2, y2)) {
          const selfDist = Math.abs(x2 - startX) + Math.abs(y2 - startY);
          const targetDist = targetX === null ? 0 : Math.abs(x2 - targetX) + Math.abs(y2 - targetY);
          if (targetDist < bestTargetDist || (targetDist === bestTargetDist && selfDist < bestSelfDist)) {
            best = { x: x2, y: y2 };
            bestTargetDist = targetDist;
            bestSelfDist = selfDist;
          }
        }
      }
    }
    if (best) {
      return best;
    }
  }
  return best;
}

// Attempt to build the next queued road tile.
function buildNextRoadTile(state, roads, roadsConfig, config) {
  const remaining = Math.max(0, roads.queue.length - roads.queueIndex);
  let attempts = 0;
  while (roads.queueIndex < roads.queue.length && attempts < remaining) {
    const entry = roads.queue[roads.queueIndex];
    if (!entry) {
      roads.queueIndex += 1;
      attempts += 1;
      continue;
    }
    const x = entry.x;
    const y = entry.y;
    if (!roads.types[y] || roads.types[y][x]) {
      const key = `${x},${y}`;
      if (roads.planned[key]) {
        delete roads.planned[key];
      }
      roads.queueIndex += 1;
      attempts += 1;
      continue;
    }

    if (!passesBuildMinResources(state, config, roadsConfig)) {
      return false;
    }

    const cost = getRoadCost(roadsConfig, entry.type);
    if (!hasInputs(state.stockpile, cost)) {
      roads.queue[roads.queueIndex] = null;
      roads.queue.push(entry);
      roads.queueIndex += 1;
      attempts += 1;
      continue;
    }
    consumeInputs(state.stockpile, cost);

    roads.types[y][x] = entry.type;
    roads.queueIndex += 1;
    attempts += 1;
    const key = `${x},${y}`;
    if (roads.planned[key]) {
      delete roads.planned[key];
    }

    const linkKeys = roads.tileLinks[key];
    if (Array.isArray(linkKeys)) {
      for (const linkKey of linkKeys) {
        const link = roads.links[linkKey];
        if (!link || link.completed) {
          continue;
        }
        link.pending = Math.max(0, Number(link.pending || 0) - 1);
        if (link.pending <= 0) {
          finalizeRoadLink(state, roads, config, linkKey);
        }
      }
    }
    return true;
  }
  return remaining > 0 ? false : null;
}

function getRoadCost(roadsConfig, type) {
  if (!roadsConfig || !roadsConfig.cost || !type) {
    return {};
  }
  const raw = roadsConfig.cost[type];
  return raw && typeof raw === 'object' ? raw : {};
}

function passesBuildMinResources(state, config, roadsConfig) {
  const minResources = roadsConfig.buildMinResources;
  if (!minResources || typeof minResources !== 'object') {
    return true;
  }
  for (const [resource, minRatioRaw] of Object.entries(minResources)) {
    const minRatio = Number(minRatioRaw);
    if (!Number.isFinite(minRatio) || minRatio <= 0) {
      continue;
    }
    const ratio = getStockpileRatio(state, config, resource);
    if (ratio < minRatio) {
      return false;
    }
  }
  return true;
}

function finalizeRoadLink(state, roads, config, linkKey) {
  const link = roads.links[linkKey];
  if (!link || link.completed) {
    return;
  }
  link.completed = true;
  pushEvent(state, config, buildRoadCompleteMessage(linkKey, link.kind));
}

function buildRoadCompleteMessage(linkKey, kind) {
  if (kind === 'village') {
    const parts = String(linkKey).split('-');
    if (parts.length === 2) {
      return `Road completed: ${parts[0].toUpperCase()} <-> ${parts[1].toUpperCase()}`;
    }
  }
  return `Road completed: ${linkKey}`;
}

function markLinkFailed(roads, linkKey, roadsConfig) {
  if (!roads || !linkKey) {
    return;
  }
  const cooldown = Math.max(0, Number(roadsConfig.retryFailedEveryTicks || 0));
  if (cooldown > 0) {
    roads.retryLinks[linkKey] = cooldown;
  }
  roads.failedLinks[linkKey] = true;
}

function updateRetryLinks(roads, roadsConfig) {
  if (!roads || !roads.retryLinks) {
    return;
  }
  const cooldown = Math.max(0, Number(roadsConfig.retryFailedEveryTicks || 0));
  if (cooldown <= 0) {
    return;
  }
  for (const [key, remainingRaw] of Object.entries(roads.retryLinks)) {
    const remaining = Math.max(0, Number(remainingRaw || 0) - 1);
    if (remaining <= 0) {
      delete roads.retryLinks[key];
      if (roads.failedLinks[key]) {
        delete roads.failedLinks[key];
      }
    } else {
      roads.retryLinks[key] = remaining;
    }
  }
}

module.exports = { updateRoads, ensureRoadState };
