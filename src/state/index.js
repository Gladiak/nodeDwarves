'use strict';

const { clamp } = require('../utils');
const { pickClanId } = require('../clans');
const { createTempleState, createPrestigeState } = require('../simulation/temple');
const {
  createTerrain,
  getTerrainSpawnPredicate,
  getTerrainResourcePredicate,
} = require('./terrain');

// Resolve map scaling configuration for resource initialization.
function getResourceMapScale(config, runtime) {
  const resources = (config && config.resources) || {};
  const mapScale = resources.mapScale || {};
  if (mapScale.enabled === false) {
    return { mapScale, multiplier: 1 };
  }
  const baselineWidth = Math.max(0, Number(mapScale.baselineWidth || 0));
  const baselineHeight = Math.max(0, Number(mapScale.baselineHeight || 0));
  const baselineArea = baselineWidth > 0 && baselineHeight > 0
    ? baselineWidth * baselineHeight
    : 0;
  if (baselineArea <= 0) {
    return { mapScale, multiplier: 1 };
  }
  const width = Math.max(0, Number(runtime && runtime.gridWidth || 0));
  const height = Math.max(0, Number(runtime && runtime.gridHeight || 0));
  if (width <= 0 || height <= 0) {
    return { mapScale, multiplier: 1 };
  }
  const playableArea = Math.max(0, Number(runtime && runtime.playableArea || 0));
  const effectiveArea = playableArea > 0 ? playableArea : width * height;
  let multiplier = effectiveArea / baselineArea;
  const minMultiplier = Number(mapScale.minMultiplier ?? 0);
  const maxMultiplier = Number(mapScale.maxMultiplier ?? 0);
  if (Number.isFinite(minMultiplier) && minMultiplier > 0) {
    multiplier = Math.max(minMultiplier, multiplier);
  }
  if (Number.isFinite(maxMultiplier) && maxMultiplier > 0) {
    multiplier = Math.min(maxMultiplier, multiplier);
  }
  return { mapScale, multiplier };
}

// Check whether a map scale applies to a resource section.
function shouldApplyMapScale(mapScale, key) {
  if (!mapScale || typeof mapScale !== 'object') {
    return false;
  }
  const applyTo = mapScale.applyTo || {};
  if (Object.prototype.hasOwnProperty.call(applyTo, key)) {
    return applyTo[key] === true;
  }
  return false;
}

// Scale a resource map using the map multiplier.
function scaleResourceMap(source, multiplier) {
  const scaled = {};
  if (!source || typeof source !== 'object') {
    return scaled;
  }
  for (const [id, value] of Object.entries(source)) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) {
      continue;
    }
    const scaledValue = Math.max(0, Math.round(numeric * multiplier));
    scaled[id] = scaledValue;
  }
  return scaled;
}

// Build the initial stockpile, applying map scaling when configured.
function buildInitialStockpile(config, mapScaleContext) {
  const resources = (config && config.resources) || {};
  const baseStockpile = resources.stockpile || {};
  if (!mapScaleContext || !shouldApplyMapScale(mapScaleContext.mapScale, 'stockpile')) {
    return { ...baseStockpile };
  }
  return scaleResourceMap(baseStockpile, mapScaleContext.multiplier);
}

// Build scaled stockpile targets when enabled.
function buildScaledTargets(config, mapScaleContext) {
  if (!mapScaleContext || !shouldApplyMapScale(mapScaleContext.mapScale, 'targets')) {
    return null;
  }
  const resources = (config && config.resources) || {};
  const baseTargets = resources.targets || {};
  return scaleResourceMap(baseTargets, mapScaleContext.multiplier);
}

// Read underrealm configuration with safe defaults.
function getUnderrealmConfig(config) {
  return (config && config.underrealm) || {};
}

// Resolve fixed full-size dimensions for underrealm depth layers.
function getUnderrealmDepthSizeConfig(config, runtime) {
  const runtimeWidth = Math.max(1, Number(runtime && runtime.gridWidth || 1));
  const runtimeHeight = Math.max(1, Number(runtime && runtime.gridHeight || 1));
  return {
    baseWidth: runtimeWidth,
    baseHeight: runtimeHeight,
    minWidth: runtimeWidth,
    minHeight: runtimeHeight,
    shrinkFactor: 1,
  };
}

// Compute layer dimensions for a depth index with full-size layers.
function resolveUnderrealmLayerSize(depth, sizeConfig) {
  return {
    width: Math.max(1, Number(sizeConfig.baseWidth || 1)),
    height: Math.max(1, Number(sizeConfig.baseHeight || 1)),
  };
}

// Build deterministic terrain seed for an underrealm layer.
function getUnderrealmLayerSeed(baseSeed, underrealm, depth) {
  const safeBaseSeed = Number.isFinite(baseSeed) ? Math.floor(baseSeed) : 1;
  const seedOffset = Math.floor(Number(underrealm.seed_offset ?? 7001));
  const seedStep = Math.max(1, Math.floor(Number(underrealm.seed_step ?? 97)));
  const next = (safeBaseSeed + seedOffset + depth * seedStep) >>> 0;
  return next || 1;
}

// Resolve underrealm terrain generation config.
function getUnderrealmTerrainConfig(config) {
  const underrealm = getUnderrealmConfig(config);
  const terrain = underrealm.terrain || {};
  return {
    wallFillRatio: clamp(Number(terrain.wall_fill_ratio ?? 0.59), 0.2, 0.85),
    smoothPasses: Math.max(0, Math.floor(Number(terrain.smooth_passes ?? 5))),
    startChamberRadius: Math.max(2, Math.floor(Number(terrain.start_chamber_radius ?? 3))),
    chamberCountBase: Math.max(1, Math.floor(Number(terrain.chamber_count_base ?? 5))),
    chamberCountPerDepth: Math.max(0, Math.floor(Number(terrain.chamber_count_per_depth ?? 1))),
    chamberRadiusMin: Math.max(2, Math.floor(Number(terrain.chamber_radius_min ?? 2))),
    chamberRadiusMax: Math.max(2, Math.floor(Number(terrain.chamber_radius_max ?? 4))),
    corridorWidth: Math.max(1, Math.floor(Number(terrain.corridor_width ?? 1))),
    loopCountBase: Math.max(0, Math.floor(Number(terrain.loop_count_base ?? 2))),
    loopCountPerDepth: Math.max(0, Math.floor(Number(terrain.loop_count_per_depth ?? 1))),
    branchCountBase: Math.max(0, Math.floor(Number(terrain.branch_count_base ?? 7))),
    branchCountPerDepth: Math.max(0, Math.floor(Number(terrain.branch_count_per_depth ?? 2))),
    branchLengthMin: Math.max(2, Math.floor(Number(terrain.branch_length_min ?? 3))),
    branchLengthMax: Math.max(2, Math.floor(Number(terrain.branch_length_max ?? 8))),
    branchTurnChance: clamp(Number(terrain.branch_turn_chance ?? 0.1), 0, 1),
    pillarRatioBase: clamp(Number(terrain.pillar_ratio_base ?? 0.09), 0, 0.4),
    pillarRatioPerDepth: clamp(Number(terrain.pillar_ratio_per_depth ?? 0.018), 0, 0.2),
    pillarOpenNeighborsMin: clamp(
      Math.floor(Number(terrain.pillar_open_neighbors_min ?? 6)),
      4,
      8,
    ),
    chasmRatioBase: clamp(Number(terrain.chasm_ratio_base ?? 0.02), 0, 0.5),
    chasmRatioPerDepth: clamp(Number(terrain.chasm_ratio_per_depth ?? 0.01), 0, 0.5),
    crystalRatioBase: clamp(Number(terrain.crystal_ratio_base ?? 0.015), 0, 0.5),
    crystalRatioPerDepth: clamp(Number(terrain.crystal_ratio_per_depth ?? 0.008), 0, 0.5),
    magmaMinDepth: Math.max(1, Math.floor(Number(terrain.magma_min_depth ?? 4))),
    magmaRatioBase: clamp(Number(terrain.magma_ratio_base ?? 0.005), 0, 0.5),
    magmaRatioPerDepth: clamp(Number(terrain.magma_ratio_per_depth ?? 0.006), 0, 0.5),
    shrineMinDepth: Math.max(1, Math.floor(Number(terrain.shrine_min_depth ?? 4))),
    shrineCountBase: Math.max(0, Math.floor(Number(terrain.shrine_count_base ?? 1))),
    shrineCountPerDepth: Math.max(0, Math.floor(Number(terrain.shrine_count_per_depth ?? 1))),
    symbols: resolveUnderrealmSymbols(terrain.symbols),
    walkableTypes: resolveUnderrealmWalkableTypes(terrain.walkable),
  };
}

// Resolve underrealm terrain symbols.
function resolveUnderrealmSymbols(rawSymbols) {
  const symbols = rawSymbols || {};
  return {
    wall: String(symbols.wall || '#'),
    cave: String(symbols.cave || '.'),
    corridor: String(symbols.corridor || ':'),
    chasm: String(symbols.chasm || 'x'),
    crystal: String(symbols.crystal || '*'),
    magma: String(symbols.magma || '~'),
    shrine: String(symbols.shrine || '+'),
  };
}

// Resolve walkability by underrealm terrain type.
function resolveUnderrealmWalkableTypes(rawWalkable) {
  const walkable = rawWalkable || {};
  return {
    wall: walkable.wall === true,
    cave: walkable.cave !== false,
    corridor: walkable.corridor !== false,
    chasm: walkable.chasm === true,
    crystal: walkable.crystal !== false,
    magma: walkable.magma === true,
    shrine: walkable.shrine !== false,
  };
}

// Build a deterministic RNG for underrealm generation.
function createUnderrealmRng(seed) {
  let t = (Math.floor(Number(seed || 1)) >>> 0) || 1;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Pick an integer in [min, max] using a deterministic RNG.
function randomIntWithRng(rng, min, max) {
  const low = Number.isFinite(min) ? Number(min) : 0;
  const high = Number.isFinite(max) ? Number(max) : low;
  if (high <= low) {
    return Math.floor(low);
  }
  return Math.floor(rng() * (high - low + 1)) + Math.floor(low);
}

// Shuffle a list in place with deterministic RNG.
function shuffleInPlaceWithRng(items, rng) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
}

// Build an initial cave layout using a wall fill ratio.
function createInitialUnderrealmLayout(width, height, wallFillRatio, rng) {
  const types = Array.from({ length: height }, () => new Array(width).fill('wall'));
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      types[y][x] = rng() < wallFillRatio ? 'wall' : 'cave';
    }
  }
  return types;
}

// Count adjacent wall cells in a 3x3 neighborhood.
function countAdjacentWalls(types, x, y) {
  let count = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const nx = x + dx;
      const ny = y + dy;
      if (ny < 0 || ny >= types.length || nx < 0 || nx >= types[0].length) {
        count += 1;
        continue;
      }
      if (types[ny][nx] === 'wall') {
        count += 1;
      }
    }
  }
  return count;
}

// Smooth cave topology using cellular automata passes.
function smoothUnderrealmLayout(types, passes) {
  const height = types.length;
  const width = height > 0 ? types[0].length : 0;
  let current = types;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = current.map((row) => row.slice());
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const walls = countAdjacentWalls(current, x, y);
        next[y][x] = walls >= 5 ? 'wall' : 'cave';
      }
    }
    current = next;
  }
  return current;
}

// Carve a circular chamber.
function carveChamber(types, centerX, centerY, radius) {
  const height = types.length;
  const width = height > 0 ? types[0].length : 0;
  const r = Math.max(1, Math.floor(radius));
  for (let y = centerY - r; y <= centerY + r; y += 1) {
    if (y <= 0 || y >= height - 1) {
      continue;
    }
    for (let x = centerX - r; x <= centerX + r; x += 1) {
      if (x <= 0 || x >= width - 1) {
        continue;
      }
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy <= r * r) {
        types[y][x] = 'cave';
      }
    }
  }
}

// Carve tunnel cells using a square brush.
function carveCorridorBrush(types, centerX, centerY, corridorWidth) {
  const height = types.length;
  const width = height > 0 ? types[0].length : 0;
  const brush = Math.max(0, Math.floor((corridorWidth - 1) / 2));
  for (let y = centerY - brush; y <= centerY + brush; y += 1) {
    if (y <= 0 || y >= height - 1) {
      continue;
    }
    for (let x = centerX - brush; x <= centerX + brush; x += 1) {
      if (x <= 0 || x >= width - 1) {
        continue;
      }
      if (types[y][x] === 'wall' || types[y][x] === 'cave' || types[y][x] === 'corridor') {
        types[y][x] = 'cave';
      }
    }
  }
}

// Carve an L-shaped corridor between two chamber centers.
function carveCorridor(types, from, to, corridorWidth, rng) {
  let x = from.x;
  let y = from.y;
  const deltaX = Math.abs(to.x - from.x);
  const deltaY = Math.abs(to.y - from.y);
  const horizontalFirst = deltaX === deltaY ? rng() < 0.5 : deltaX > deltaY;
  const stepX = to.x >= x ? 1 : -1;
  const stepY = to.y >= y ? 1 : -1;
  const carveHorizontal = () => {
    while (x !== to.x) {
      carveCorridorBrush(types, x, y, corridorWidth);
      x += stepX;
    }
    carveCorridorBrush(types, x, y, corridorWidth);
  };
  const carveVertical = () => {
    while (y !== to.y) {
      carveCorridorBrush(types, x, y, corridorWidth);
      y += stepY;
    }
    carveCorridorBrush(types, x, y, corridorWidth);
  };
  if (horizontalFirst) {
    carveHorizontal();
    carveVertical();
  } else {
    carveVertical();
    carveHorizontal();
  }
}

const CARDINAL_DIRECTIONS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

// Build a canonical key for an undirected chamber edge.
function buildChamberEdgeKey(aIndex, bIndex) {
  const low = Math.min(aIndex, bIndex);
  const high = Math.max(aIndex, bIndex);
  return `${low}:${high}`;
}

// Build an engineered corridor graph using MST + optional loop links.
function buildUnderrealmChamberConnections(chambers, extraLoops) {
  if (!Array.isArray(chambers) || chambers.length <= 1) {
    return [];
  }
  const edges = [];
  const edgeSet = new Set();
  const connected = new Set([0]);
  const chamberCount = chambers.length;
  while (connected.size < chamberCount) {
    let best = null;
    for (const aIndex of connected) {
      const a = chambers[aIndex];
      for (let bIndex = 0; bIndex < chamberCount; bIndex += 1) {
        if (connected.has(bIndex)) {
          continue;
        }
        const b = chambers[bIndex];
        const distance = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        if (!best || distance < best.distance) {
          best = {
            aIndex,
            bIndex,
            distance,
          };
        }
      }
    }
    if (!best) {
      break;
    }
    connected.add(best.bIndex);
    const key = buildChamberEdgeKey(best.aIndex, best.bIndex);
    edgeSet.add(key);
    edges.push(best);
  }

  if (extraLoops <= 0) {
    return edges;
  }
  const candidates = [];
  for (let aIndex = 0; aIndex < chamberCount; aIndex += 1) {
    const a = chambers[aIndex];
    for (let bIndex = aIndex + 1; bIndex < chamberCount; bIndex += 1) {
      const key = buildChamberEdgeKey(aIndex, bIndex);
      if (edgeSet.has(key)) {
        continue;
      }
      const b = chambers[bIndex];
      const distance = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      candidates.push({
        aIndex,
        bIndex,
        distance,
      });
    }
  }
  candidates.sort((left, right) => left.distance - right.distance);
  let loopsAdded = 0;
  for (const candidate of candidates) {
    if (loopsAdded >= extraLoops) {
      break;
    }
    const key = buildChamberEdgeKey(candidate.aIndex, candidate.bIndex);
    if (edgeSet.has(key)) {
      continue;
    }
    edgeSet.add(key);
    edges.push(candidate);
    loopsAdded += 1;
  }
  return edges;
}

// Count open neighbors (non-wall) around a cell in 8 directions.
function countOpenNeighbors(types, x, y) {
  let count = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const ny = y + dy;
      const nx = x + dx;
      if (ny < 0 || ny >= types.length || nx < 0 || nx >= types[0].length) {
        continue;
      }
      if (types[ny][nx] !== 'wall') {
        count += 1;
      }
    }
  }
  return count;
}

// Measure how many consecutive wall cells are available in a direction.
function measureWallRun(types, originX, originY, direction, maxSteps) {
  const height = types.length;
  const width = height > 0 ? types[0].length : 0;
  let run = 0;
  for (let step = 1; step <= maxSteps; step += 1) {
    const x = originX + direction.dx * step;
    const y = originY + direction.dy * step;
    if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) {
      break;
    }
    if (types[y][x] !== 'wall') {
      break;
    }
    run += 1;
  }
  return run;
}

// Carve a service tunnel from an origin with at most one controlled bend.
function carveUnderrealmBranch(
  types,
  origin,
  direction,
  length,
  corridorWidth,
  turnChance,
  rng,
) {
  let x = origin.x;
  let y = origin.y;
  let activeDirection = direction;
  let bent = false;
  const desiredLength = Math.max(1, Math.floor(length));
  for (let step = 1; step <= desiredLength; step += 1) {
    x += activeDirection.dx;
    y += activeDirection.dy;
    if (y <= 0 || y >= types.length - 1 || x <= 0 || x >= types[0].length - 1) {
      break;
    }
    carveCorridorBrush(types, x, y, corridorWidth);
    if (!bent
        && turnChance > 0
        && step >= Math.floor(desiredLength / 2)
        && rng() < turnChance) {
      const options = CARDINAL_DIRECTIONS
        .filter(
          (entry) => !(entry.dx === activeDirection.dx && entry.dy === activeDirection.dy),
        )
        .filter(
          (entry) => !(entry.dx === -activeDirection.dx && entry.dy === -activeDirection.dy),
        )
        .map((entry) => ({
          direction: entry,
          run: measureWallRun(types, x, y, entry, Math.max(2, desiredLength - step)),
        }))
        .filter((entry) => entry.run >= 2);
      if (options.length > 0) {
        options.sort((left, right) => right.run - left.run);
        activeDirection = options[0].direction;
        bent = true;
      }
    }
  }
  if (rng() < 0.2) {
    carveChamber(types, x, y, 1);
  }
}

// Add engineered side shafts branching from caves.
function addUnderrealmBranches(types, depth, terrainConfig, start, rng) {
  const depthOffset = Math.max(0, depth - 1);
  const branchCount = Math.max(
    0,
    terrainConfig.branchCountBase + terrainConfig.branchCountPerDepth * depthOffset,
  );
  if (branchCount <= 0) {
    return;
  }
  const branchLengthMin = Math.min(terrainConfig.branchLengthMin, terrainConfig.branchLengthMax);
  const branchLengthMax = Math.max(terrainConfig.branchLengthMin, terrainConfig.branchLengthMax);
  const origins = collectTypeCells(types, new Set(['cave']));
  if (origins.length === 0) {
    return;
  }
  shuffleInPlaceWithRng(origins, rng);
  let carved = 0;
  for (const origin of origins) {
    if (carved >= branchCount) {
      break;
    }
    const distance = Math.abs(origin.x - start.x) + Math.abs(origin.y - start.y);
    if (distance < 4) {
      continue;
    }
    const targetLength = randomIntWithRng(rng, branchLengthMin, branchLengthMax);
    const options = CARDINAL_DIRECTIONS
      .map((direction) => ({
        direction,
        run: measureWallRun(types, origin.x, origin.y, direction, targetLength),
      }))
      .filter((entry) => entry.run >= branchLengthMin);
    if (options.length === 0) {
      continue;
    }
    options.sort((left, right) => right.run - left.run);
    const topRun = options[0].run;
    const topOptions = options.filter((entry) => entry.run === topRun);
    const chosen = topOptions[randomIntWithRng(rng, 0, topOptions.length - 1)];
    const branchLength = Math.min(targetLength, chosen.run);
    carveUnderrealmBranch(
      types,
      origin,
      chosen.direction,
      branchLength,
      terrainConfig.corridorWidth,
      terrainConfig.branchTurnChance,
      rng,
    );
    carved += 1;
  }
}

// Convert parts of wide-open caves into wall pillars to improve readability.
function addUnderrealmPillars(types, depth, terrainConfig, start, rng) {
  const depthOffset = Math.max(0, depth - 1);
  const pillarRatio = clamp(
    terrainConfig.pillarRatioBase + terrainConfig.pillarRatioPerDepth * depthOffset,
    0,
    0.5,
  );
  if (pillarRatio <= 0) {
    return;
  }
  const candidates = [];
  for (let y = 1; y < types.length - 1; y += 1) {
    for (let x = 1; x < types[0].length - 1; x += 1) {
      if (types[y][x] !== 'cave') {
        continue;
      }
      const distance = Math.abs(x - start.x) + Math.abs(y - start.y);
      if (distance < 5) {
        continue;
      }
      const openNeighbors = countOpenNeighbors(types, x, y);
      if (openNeighbors >= terrainConfig.pillarOpenNeighborsMin) {
        candidates.push({ x, y });
      }
    }
  }
  if (candidates.length === 0) {
    return;
  }
  shuffleInPlaceWithRng(candidates, rng);
  const targetCount = Math.floor(candidates.length * pillarRatio);
  for (let i = 0; i < targetCount; i += 1) {
    const cell = candidates[i];
    if (!cell) {
      break;
    }
    types[cell.y][cell.x] = 'wall';
  }
}

// Keep only walkable cave tiles connected to the start chamber.
function pruneDisconnectedCaves(types, startX, startY) {
  const height = types.length;
  const width = height > 0 ? types[0].length : 0;
  if (width <= 0 || height <= 0) {
    return;
  }
  const walkableSet = new Set(['cave']);
  const startInBounds = startX >= 0 && startY >= 0 && startX < width && startY < height;
  if (!startInBounds || !walkableSet.has(types[startY][startX])) {
    return;
  }
  const visited = Array.from({ length: height }, () => new Array(width).fill(false));
  const queue = [{ x: startX, y: startY }];
  let queueIndex = 0;
  visited[startY][startX] = true;
  while (queueIndex < queue.length) {
    const current = queue[queueIndex];
    queueIndex += 1;
    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];
    for (const next of neighbors) {
      if (next.x < 0 || next.y < 0 || next.x >= width || next.y >= height) {
        continue;
      }
      if (visited[next.y][next.x]) {
        continue;
      }
      if (!walkableSet.has(types[next.y][next.x])) {
        continue;
      }
      visited[next.y][next.x] = true;
      queue.push(next);
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (walkableSet.has(types[y][x]) && !visited[y][x]) {
        types[y][x] = 'wall';
      }
    }
  }
}

// Collect all coordinates matching a whitelist of terrain types.
function collectTypeCells(types, allowed) {
  const cells = [];
  for (let y = 0; y < types.length; y += 1) {
    for (let x = 0; x < types[0].length; x += 1) {
      if (allowed.has(types[y][x])) {
        cells.push({ x, y });
      }
    }
  }
  return cells;
}

// Place thematic underrealm feature tiles (chasm, crystal, magma, shrine).
function placeUnderrealmFeatures(types, depth, terrainConfig, start, rng) {
  const availableCave = collectTypeCells(types, new Set(['cave']));
  if (availableCave.length === 0) {
    return;
  }
  shuffleInPlaceWithRng(availableCave, rng);
  const depthOffset = Math.max(0, depth - 1);
  const chasmRatio = clamp(
    terrainConfig.chasmRatioBase + terrainConfig.chasmRatioPerDepth * depthOffset,
    0,
    0.6,
  );
  const crystalRatio = clamp(
    terrainConfig.crystalRatioBase + terrainConfig.crystalRatioPerDepth * depthOffset,
    0,
    0.6,
  );
  const magmaRatio = depth >= terrainConfig.magmaMinDepth
    ? clamp(
      terrainConfig.magmaRatioBase + terrainConfig.magmaRatioPerDepth * depthOffset,
      0,
      0.6,
    )
    : 0;
  const shrineCount = depth >= terrainConfig.shrineMinDepth
    ? Math.max(
      0,
      terrainConfig.shrineCountBase + terrainConfig.shrineCountPerDepth * depthOffset,
    )
    : 0;
  const reserved = new Set([`${start.x},${start.y}`]);
  let index = 0;
  const placeRatio = (ratio, tileType, minDistanceFromStart) => {
    const count = Math.max(0, Math.floor(availableCave.length * ratio));
    let placed = 0;
    while (index < availableCave.length && placed < count) {
      const cell = availableCave[index];
      index += 1;
      const key = `${cell.x},${cell.y}`;
      if (reserved.has(key)) {
        continue;
      }
      const dist = Math.abs(cell.x - start.x) + Math.abs(cell.y - start.y);
      if (dist < minDistanceFromStart) {
        continue;
      }
      types[cell.y][cell.x] = tileType;
      reserved.add(key);
      placed += 1;
    }
  };
  placeRatio(chasmRatio, 'chasm', 4);
  placeRatio(crystalRatio, 'crystal', 3);
  placeRatio(magmaRatio, 'magma', 8);

  const shrineCandidates = collectTypeCells(types, new Set(['cave', 'crystal']));
  shuffleInPlaceWithRng(shrineCandidates, rng);
  let placedShrines = 0;
  for (const cell of shrineCandidates) {
    if (placedShrines >= shrineCount) {
      break;
    }
    const key = `${cell.x},${cell.y}`;
    if (reserved.has(key)) {
      continue;
    }
    const dist = Math.abs(cell.x - start.x) + Math.abs(cell.y - start.y);
    if (dist < 6) {
      continue;
    }
    types[cell.y][cell.x] = 'shrine';
    reserved.add(key);
    placedShrines += 1;
  }
}

// Build a walkable matrix from terrain type rules.
function buildUnderrealmWalkableMap(types, walkableTypes) {
  const height = types.length;
  const width = height > 0 ? types[0].length : 0;
  const walkable = Array.from({ length: height }, () => new Array(width).fill(false));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const type = types[y][x];
      walkable[y][x] = Boolean(walkableTypes[type] !== false);
    }
  }
  return walkable;
}

// Build spawnable cells reachable from a starting tile.
function buildUnderrealmSpawnableMap(walkable, startX, startY) {
  const height = walkable.length;
  const width = height > 0 ? walkable[0].length : 0;
  if (width <= 0 || height <= 0) {
    return null;
  }
  const spawnable = Array.from({ length: height }, () => new Array(width).fill(false));
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) {
    return spawnable;
  }
  if (!walkable[startY][startX]) {
    return spawnable;
  }
  const queue = [{ x: startX, y: startY }];
  let queueIndex = 0;
  spawnable[startY][startX] = true;
  while (queueIndex < queue.length) {
    const current = queue[queueIndex];
    queueIndex += 1;
    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];
    for (const next of neighbors) {
      if (next.x < 0 || next.y < 0 || next.x >= width || next.y >= height) {
        continue;
      }
      if (!walkable[next.y][next.x] || spawnable[next.y][next.x]) {
        continue;
      }
      spawnable[next.y][next.x] = true;
      queue.push(next);
    }
  }
  return spawnable;
}

// Generate terrain for an underrealm layer using cave chambers and corridors.
function createUnderrealmLayerTerrain(config, width, height, seed, depth) {
  if (width <= 0 || height <= 0) {
    return null;
  }
  const terrainConfig = getUnderrealmTerrainConfig(config);
  const rng = createUnderrealmRng(Number(seed || 1) + depth * 7919);
  let types = createInitialUnderrealmLayout(
    width,
    height,
    terrainConfig.wallFillRatio,
    rng,
  );
  types = smoothUnderrealmLayout(types, terrainConfig.smoothPasses);

  const start = {
    x: clamp(Math.floor(width / 2), 1, Math.max(1, width - 2)),
    y: clamp(Math.floor(height / 2), 1, Math.max(1, height - 2)),
  };
  carveChamber(types, start.x, start.y, terrainConfig.startChamberRadius);
  const chamberCount = terrainConfig.chamberCountBase
    + Math.max(0, depth - 1) * terrainConfig.chamberCountPerDepth;
  const chamberRadiusMin = Math.min(
    terrainConfig.chamberRadiusMin,
    terrainConfig.chamberRadiusMax,
  );
  const chamberRadiusMax = Math.max(
    terrainConfig.chamberRadiusMin,
    terrainConfig.chamberRadiusMax,
  );
  const chambers = [{ ...start }];
  for (let index = 1; index < chamberCount; index += 1) {
    const radius = randomIntWithRng(rng, chamberRadiusMin, chamberRadiusMax);
    const centerX = randomIntWithRng(rng, radius + 1, Math.max(radius + 1, width - radius - 2));
    const centerY = randomIntWithRng(rng, radius + 1, Math.max(radius + 1, height - radius - 2));
    const center = { x: centerX, y: centerY };
    carveChamber(types, center.x, center.y, radius);
    chambers.push(center);
  }
  const depthOffset = Math.max(0, depth - 1);
  const loopCount = Math.max(
    0,
    terrainConfig.loopCountBase + terrainConfig.loopCountPerDepth * depthOffset,
  );
  const connections = buildUnderrealmChamberConnections(chambers, loopCount);
  for (const edge of connections) {
    const from = chambers[edge.aIndex];
    const to = chambers[edge.bIndex];
    if (!from || !to) {
      continue;
    }
    carveCorridor(types, from, to, terrainConfig.corridorWidth, rng);
  }

  addUnderrealmBranches(types, depth, terrainConfig, start, rng);
  addUnderrealmPillars(types, depth, terrainConfig, start, rng);
  pruneDisconnectedCaves(types, start.x, start.y);
  placeUnderrealmFeatures(types, depth, terrainConfig, start, rng);
  const walkable = buildUnderrealmWalkableMap(types, terrainConfig.walkableTypes);
  const spawnable = buildUnderrealmSpawnableMap(walkable, start.x, start.y);
  return {
    width,
    height,
    seed: Math.floor(Number(seed || 1)) || 1,
    start: { x: start.x, y: start.y },
    types,
    walkable,
    spawnable,
    symbols: terrainConfig.symbols,
    walkableTypes: terrainConfig.walkableTypes,
  };
}

// Build or refresh dedicated underrealm crew metadata.
function createUnderrealmCrewState(config, previousCrew) {
  const underrealm = getUnderrealmConfig(config);
  const crewConfig = underrealm.crew || {};
  const roles = crewConfig.roles || {};
  const previousAssigned = previousCrew && previousCrew.assignedByDepth
    ? previousCrew.assignedByDepth
    : {};
  const assignedByDepth = {};
  for (const [depth, count] of Object.entries(previousAssigned)) {
    const safeDepth = String(depth);
    const safeCount = Math.max(0, Math.floor(Number(count || 0)));
    assignedByDepth[safeDepth] = safeCount;
  }
  return {
    enabled: crewConfig.enabled !== false,
    surfaceReserveRatio: clamp(Number(crewConfig.surface_reserve_ratio ?? 0.4), 0, 1),
    maxUnderrealmRatio: clamp(Number(crewConfig.max_underrealm_ratio ?? 0.6), 0, 1),
    depthWeightGrowth: Math.max(0, Number(crewConfig.depth_weight_growth ?? 0.18)),
    populationBonusPerAssigned: Math.max(
      0,
      Number(crewConfig.population_bonus_per_assigned ?? 0.35),
    ),
    unlockPopulationBonusPerDepth: Math.max(
      0,
      Math.floor(Number(crewConfig.unlock_population_bonus_per_depth ?? 18)),
    ),
    roles: {
      minerRatio: clamp(Number(roles.miner_ratio ?? 0.12), 0, 1),
      haulerRatio: clamp(Number(roles.hauler_ratio ?? 0.08), 0, 1),
      guardRatio: clamp(Number(roles.guard_ratio ?? 0.05), 0, 1),
    },
    assignedByDepth,
    rolesByDepth: previousCrew && previousCrew.rolesByDepth
      ? { ...previousCrew.rolesByDepth }
      : {},
    membersByDepth: previousCrew && previousCrew.membersByDepth
      ? { ...previousCrew.membersByDepth }
      : {},
    totalAssigned: Math.max(0, Number(previousCrew && previousCrew.totalAssigned || 0)),
    surfaceAdults: Math.max(0, Number(previousCrew && previousCrew.surfaceAdults || 0)),
  };
}

// Resolve Underrealm discovery settings.
function getUnderrealmDiscoveryConfig(config) {
  const underrealm = getUnderrealmConfig(config);
  const discovery = underrealm.discovery || {};
  const minTick = Math.max(0, Math.floor(Number(discovery.min_tick ?? 140)));
  const maxTick = Math.max(minTick, Math.floor(Number(discovery.max_tick ?? 340)));
  const populationMin = Math.max(
    1,
    Math.floor(Number(discovery.population_min_for_timer ?? 100)),
  );
  const populationMax = Math.max(
    populationMin,
    Math.floor(Number(discovery.population_max_for_timer ?? 150)),
  );
  return {
    enabled: discovery.enabled !== false,
    minTick,
    maxTick,
    populationMin,
    populationMax,
    seedOffset: Math.floor(Number(discovery.seed_offset ?? 911)),
  };
}

// Check whether a point is inside current terrain bounds.
function isValidTerrainPoint(terrain, point) {
  if (!terrain || !point) {
    return false;
  }
  const x = Math.floor(Number(point.x));
  const y = Math.floor(Number(point.y));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return false;
  }
  return x >= 0
    && y >= 0
    && x < Number(terrain.width || 0)
    && y < Number(terrain.height || 0);
}

// Pick a deterministic surface gate tile for underrealm discovery.
function pickUnderrealmDiscoveryGate(terrain, seed) {
  if (!terrain || !terrain.types) {
    return { x: 0, y: 0 };
  }
  const width = Math.max(1, Number(terrain.width || 1));
  const height = Math.max(1, Number(terrain.height || 1));
  const candidates = [];
  const map = terrain.spawnable || terrain.walkable || null;
  if (Array.isArray(map) && map.length > 0) {
    for (let y = 0; y < height; y += 1) {
      const row = map[y];
      if (!row) {
        continue;
      }
      for (let x = 0; x < width; x += 1) {
        if (row[x] === true) {
          candidates.push({ x, y });
        }
      }
    }
  }
  if (candidates.length === 0) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        candidates.push({ x, y });
      }
    }
  }
  if (candidates.length === 0) {
    return { x: 0, y: 0 };
  }
  const rng = createUnderrealmRng(seed);
  const index = randomIntWithRng(rng, 0, Math.max(0, candidates.length - 1));
  return candidates[index] || { x: 0, y: 0 };
}

// Build or refresh underrealm discovery runtime state.
function createUnderrealmDiscoveryState(config, surfaceTerrain, baseSeed, previousDiscovery, maxUnlockedDepth) {
  const discoveryConfig = getUnderrealmDiscoveryConfig(config);
  const discoverySeed = Math.floor(Number(baseSeed || 1)) + discoveryConfig.seedOffset;
  const previousGate = previousDiscovery && previousDiscovery.surfaceGate
    ? previousDiscovery.surfaceGate
    : null;
  const surfaceGate = isValidTerrainPoint(surfaceTerrain, previousGate)
    ? {
      x: Math.floor(Number(previousGate.x || 0)),
      y: Math.floor(Number(previousGate.y || 0)),
    }
    : pickUnderrealmDiscoveryGate(surfaceTerrain, discoverySeed + 271);
  const delayRng = createUnderrealmRng(discoverySeed + 541);
  const populationRng = createUnderrealmRng(discoverySeed + 733);
  const defaultDelayTicks = randomIntWithRng(
    delayRng,
    discoveryConfig.minTick,
    discoveryConfig.maxTick,
  );
  const defaultPopulationThreshold = randomIntWithRng(
    populationRng,
    discoveryConfig.populationMin,
    discoveryConfig.populationMax,
  );
  const delayTicksRaw = previousDiscovery
    ? Number(previousDiscovery.delayTicks)
    : defaultDelayTicks;
  const delayTicks = Number.isFinite(delayTicksRaw)
    ? Math.max(0, Math.floor(delayTicksRaw))
    : defaultDelayTicks;
  const thresholdRaw = previousDiscovery
    ? Number(previousDiscovery.populationThreshold)
    : defaultPopulationThreshold;
  const populationThreshold = Number.isFinite(thresholdRaw)
    ? Math.max(1, Math.floor(thresholdRaw))
    : defaultPopulationThreshold;
  const timerStartedTickRaw = previousDiscovery
    ? Number(previousDiscovery.timerStartedTick)
    : NaN;
  let timerStartedTick = Number.isFinite(timerStartedTickRaw)
    ? Math.max(0, Math.floor(timerStartedTickRaw))
    : null;
  const targetTickRaw = previousDiscovery ? Number(previousDiscovery.targetTick) : NaN;
  let targetTick = Number.isFinite(targetTickRaw)
    ? Math.max(0, Math.floor(targetTickRaw))
    : 0;
  if (timerStartedTick !== null && targetTick <= 0) {
    targetTick = timerStartedTick + delayTicks;
  }
  if (previousDiscovery
      && timerStartedTick === null
      && targetTick > 0) {
    timerStartedTick = Math.max(0, targetTick - delayTicks);
  }
  const unlockedDepth = Math.max(0, Math.floor(Number(maxUnlockedDepth || 0)));
  const found = previousDiscovery
    ? previousDiscovery.found === true
    : unlockedDepth > 0;
  const foundTickRaw = previousDiscovery ? Number(previousDiscovery.foundTick) : NaN;
  const foundTick = Number.isFinite(foundTickRaw)
    ? Math.max(0, Math.floor(foundTickRaw))
    : null;
  return {
    enabled: discoveryConfig.enabled,
    targetTick,
    delayTicks,
    timerStartedTick,
    populationThreshold,
    found,
    foundTick,
    surfaceGate,
  };
}

// Build or refresh underrealm deep-lift progression runtime state.
function createUnderrealmLiftState(previousLift) {
  const fallback = {
    active: false,
    fromDepth: 0,
    targetDepth: 0,
    startedTick: 0,
    ticksRemaining: 0,
    totalTicks: 0,
    requiredSurveyRatio: 0,
    requiredStockpile: {},
    requiredMined: {},
  };
  if (!previousLift || typeof previousLift !== 'object') {
    return fallback;
  }
  return {
    active: previousLift.active === true,
    fromDepth: Math.max(0, Math.floor(Number(previousLift.fromDepth || 0))),
    targetDepth: Math.max(0, Math.floor(Number(previousLift.targetDepth || 0))),
    startedTick: Math.max(0, Math.floor(Number(previousLift.startedTick || 0))),
    ticksRemaining: Math.max(0, Math.floor(Number(previousLift.ticksRemaining || 0))),
    totalTicks: Math.max(0, Math.floor(Number(previousLift.totalTicks || 0))),
    requiredSurveyRatio: Math.max(0, Number(previousLift.requiredSurveyRatio || 0)),
    requiredStockpile: previousLift.requiredStockpile && typeof previousLift.requiredStockpile === 'object'
      ? { ...previousLift.requiredStockpile }
      : {},
    requiredMined: previousLift.requiredMined && typeof previousLift.requiredMined === 'object'
      ? { ...previousLift.requiredMined }
      : {},
  };
}

// Build or refresh underrealm shrine runtime state.
function createUnderrealmShrineState(previousShrines) {
  if (!previousShrines || typeof previousShrines !== 'object') {
    return null;
  }
  const wardChargesByDepth = previousShrines.wardChargesByDepth
    && typeof previousShrines.wardChargesByDepth === 'object'
    ? { ...previousShrines.wardChargesByDepth }
    : {};
  const oathByDepth = previousShrines.oathByDepth
    && typeof previousShrines.oathByDepth === 'object'
    ? { ...previousShrines.oathByDepth }
    : {};
  const stats = previousShrines.stats && typeof previousShrines.stats === 'object'
    ? {
      ...previousShrines.stats,
      prospectionFinds: previousShrines.stats.prospectionFinds
        && typeof previousShrines.stats.prospectionFinds === 'object'
        ? { ...previousShrines.stats.prospectionFinds }
        : {},
    }
    : {
      chargesCreated: 0,
      chargesSpent: 0,
      oathSuccesses: 0,
      oathFailures: 0,
      prospectionFinds: {},
    };
  return {
    wardChargesByDepth,
    oathByDepth,
    stats,
  };
}

const UNDERREALM_FLOOR_STATE_SET = new Set(['locked', 'accessible', 'contested', 'cleared']);

// Resolve floor-specific Underrealm combat scaffolding from config.
function resolveUnderrealmCombatFloorConfig(underrealmConfig, depth) {
  const combat = (underrealmConfig && underrealmConfig.combat) || {};
  const floors = combat.floors || {};
  const defaults = floors.defaults || {};
  const defaultReadiness = defaults.readiness || {};
  const defaultChampion = defaults.champion || {};
  const byDepth = floors.by_depth || {};
  const depthOverride = byDepth && typeof byDepth === 'object'
    ? (byDepth[String(depth)] || {})
    : {};
  const depthReadiness = depthOverride.readiness || {};
  const depthChampion = depthOverride.champion || {};
  const depthOffset = Math.max(0, depth - 1);

  const minScoreDefault = Math.max(
    0,
    Number(defaultReadiness.min_score_base ?? 18)
      + Number(defaultReadiness.min_score_per_depth ?? 8) * depthOffset,
  );
  const recommendedScoreDefault = Math.max(
    minScoreDefault,
    Number(defaultReadiness.recommended_score_base ?? 27)
      + Number(defaultReadiness.recommended_score_per_depth ?? 10) * depthOffset,
  );
  const minScore = Math.max(0, Number(depthReadiness.min_score ?? minScoreDefault));
  const recommendedScore = Math.max(
    minScore,
    Number(depthReadiness.recommended_score ?? recommendedScoreDefault),
  );

  const minArmoryLevelDefault = Math.max(
    1,
    Math.floor(
      Number(defaults.min_armory_level_base ?? 1)
        + Number(defaults.min_armory_level_per_depth ?? 0) * depthOffset,
    ),
  );
  const minArmoryLevel = Math.max(
    1,
    Math.floor(Number(depthOverride.min_armory_level ?? minArmoryLevelDefault)),
  );

  const championEnabled = (depthChampion.enabled ?? defaultChampion.enabled) !== false;
  const championIdPrefix = String(defaultChampion.id_prefix || 'under_champion');
  const championLabelPrefix = String(defaultChampion.label_prefix || 'Depth Champion');
  const championHpDefault = Math.max(
    1,
    Number(defaultChampion.hp_base ?? 105)
      + Number(defaultChampion.hp_per_depth ?? 28) * depthOffset,
  );
  const championAttackDefault = Math.max(
    0,
    Number(defaultChampion.attack_base ?? 9)
      + Number(defaultChampion.attack_per_depth ?? 2) * depthOffset,
  );
  const championDefenseDefault = Math.max(
    0,
    Number(defaultChampion.defense_base ?? 7)
      + Number(defaultChampion.defense_per_depth ?? 2) * depthOffset,
  );
  const championPenetrationDefault = clamp(
    Number(defaultChampion.penetration_base ?? 0.03)
      + Number(defaultChampion.penetration_per_depth ?? 0.01) * depthOffset,
    0,
    1,
  );
  return {
    minArmoryLevel,
    readiness: {
      minScore,
      recommendedScore,
    },
    champion: {
      enabled: championEnabled,
      id: String(depthChampion.id || `${championIdPrefix}_${depth}`),
      label: String(depthChampion.label || `${championLabelPrefix} D${depth}`),
      stats: {
        hp: Math.max(1, Number(depthChampion.hp ?? championHpDefault)),
        attack: Math.max(0, Number(depthChampion.attack ?? championAttackDefault)),
        defense: Math.max(0, Number(depthChampion.defense ?? championDefenseDefault)),
        penetration: clamp(
          Number(depthChampion.penetration ?? championPenetrationDefault),
          0,
          1,
        ),
      },
    },
  };
}

// Normalize floor progression state while enforcing depth unlock constraints.
function normalizeUnderrealmFloorState(rawState, unlocked) {
  const fallback = unlocked ? 'accessible' : 'locked';
  if (typeof rawState !== 'string' || !UNDERREALM_FLOOR_STATE_SET.has(rawState)) {
    return fallback;
  }
  if (!unlocked) {
    return 'locked';
  }
  if (rawState === 'locked') {
    return 'accessible';
  }
  return rawState;
}

// Build per-depth Underrealm combat runtime scaffolding.
function createUnderrealmCombatFloorState(underrealmConfig, depth, maxUnlockedDepth, previousFloor) {
  const floorConfig = resolveUnderrealmCombatFloorConfig(underrealmConfig, depth);
  const unlocked = depth <= maxUnlockedDepth;
  const previousEncounter = previousFloor && previousFloor.encounter
    ? previousFloor.encounter
    : {};
  const state = normalizeUnderrealmFloorState(previousFloor ? previousFloor.state : null, unlocked);
  const cleared = state === 'cleared'
    || Boolean(
      previousFloor
      && previousFloor.unlock
      && previousFloor.unlock.cleared === true,
    );
  return {
    depth,
    unlocked,
    state: cleared ? 'cleared' : state,
    minArmoryLevel: floorConfig.minArmoryLevel,
    readiness: {
      minScore: floorConfig.readiness.minScore,
      recommendedScore: floorConfig.readiness.recommendedScore,
    },
    champion: floorConfig.champion,
    encounter: {
      active: previousEncounter.active === true,
      attempts: Math.max(0, Math.floor(Number(previousEncounter.attempts || 0))),
      victories: Math.max(0, Math.floor(Number(previousEncounter.victories || 0))),
      defeats: Math.max(0, Math.floor(Number(previousEncounter.defeats || 0))),
      retreats: Math.max(0, Math.floor(Number(previousEncounter.retreats || 0))),
      lastOutcome: typeof previousEncounter.lastOutcome === 'string'
        ? previousEncounter.lastOutcome
        : null,
      lastOutcomeTick: Math.max(
        0,
        Math.floor(Number(previousEncounter.lastOutcomeTick || 0)),
      ),
      cooldownTicksRemaining: Math.max(
        0,
        Math.floor(Number(previousEncounter.cooldownTicksRemaining || 0)),
      ),
    },
    unlock: {
      required: floorConfig.champion.enabled === true,
      cleared,
      unlocksDepthOnWin: Math.max(
        depth + 1,
        Math.floor(Number(
          previousFloor
          && previousFloor.unlock
          && previousFloor.unlock.unlocksDepthOnWin
            ? previousFloor.unlock.unlocksDepthOnWin
            : depth + 1,
        )),
      ),
    },
  };
}

// Build or refresh top-level Underrealm combat runtime scaffolding.
function createUnderrealmCombatState(config, maxDepth, maxUnlockedDepth, previousUnderrealm) {
  const underrealmConfig = getUnderrealmConfig(config);
  const combatConfig = underrealmConfig.combat || {};
  const readiness = combatConfig.readiness || {};
  const readinessFormula = readiness.formula || {};
  const scoreWeights = readiness.score_weights || {};
  const encounterConfig = combatConfig.encounter || {};
  const previousCombat = previousUnderrealm && previousUnderrealm.combat
    && typeof previousUnderrealm.combat === 'object'
    ? previousUnderrealm.combat
    : null;
  const previousFloors = previousCombat && previousCombat.floorsByDepth
    && typeof previousCombat.floorsByDepth === 'object'
    ? { ...previousCombat.floorsByDepth }
    : {};
  if (Object.keys(previousFloors).length === 0) {
    for (const layer of (previousUnderrealm && previousUnderrealm.layers) || []) {
      const depth = Math.max(1, Math.floor(Number(layer && layer.depth || 0)));
      if (!layer || !layer.combat || typeof layer.combat !== 'object' || depth <= 0) {
        continue;
      }
      previousFloors[String(depth)] = layer.combat;
    }
  }
  const floorsByDepth = {};
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const previousFloor = previousFloors[String(depth)] || previousFloors[depth] || null;
    floorsByDepth[String(depth)] = createUnderrealmCombatFloorState(
      underrealmConfig,
      depth,
      maxUnlockedDepth,
      previousFloor,
    );
  }
  const previousStats = previousCombat && previousCombat.stats
    && typeof previousCombat.stats === 'object'
    ? previousCombat.stats
    : {};
  const dwarfChampionConfig = combatConfig.dwarf_champion || {};
  const previousDwarfChampion = previousCombat && previousCombat.dwarfChampion
    && typeof previousCombat.dwarfChampion === 'object'
    ? previousCombat.dwarfChampion
    : {};
  return {
    enabled: combatConfig.enabled !== false,
    progressionMode: String(combatConfig.progression_mode || 'champion_gate'),
    readiness: {
      hardMinGate: readiness.hard_min_gate !== false,
      warningZoneRiskMultiplier: Math.max(
        1,
        Number(readiness.warning_zone_risk_multiplier ?? 1.2),
      ),
      scoreWeights: {
        offense: Math.max(0, Number(scoreWeights.offense ?? 1)),
        defense: Math.max(0, Number(scoreWeights.defense ?? 1)),
        support: Math.max(0, Number(scoreWeights.support ?? 0.8)),
      },
      formula: {
        weaponAvgTierScale: Math.max(
          0,
          Number(readinessFormula.weapon_avg_tier_scale ?? 6),
        ),
        armorAvgTierScale: Math.max(
          0,
          Number(readinessFormula.armor_avg_tier_scale ?? 6),
        ),
        supportKitFullScale: Math.max(
          0,
          Number(readinessFormula.support_kit_full_scale ?? 8),
        ),
        supportArmoryLevelScale: Math.max(
          0,
          Number(readinessFormula.support_armory_level_scale ?? 1),
        ),
      },
    },
    encounter: {
      roundsBase: Math.max(1, Math.floor(Number(encounterConfig.rounds_base ?? 4))),
      roundsPerDepth: Math.max(0, Math.floor(Number(encounterConfig.rounds_per_depth ?? 1))),
      retryCooldownTicksBase: Math.max(
        0,
        Math.floor(Number(encounterConfig.retry_cooldown_ticks_base ?? 90)),
      ),
      retryCooldownTicksPerDepth: Math.max(
        0,
        Math.floor(Number(encounterConfig.retry_cooldown_ticks_per_depth ?? 20)),
      ),
    },
    dwarfChampion: {
      enabled: dwarfChampionConfig.enabled !== false,
      minSurvivals: Math.max(
        1,
        Math.floor(Number(dwarfChampionConfig.min_survivals ?? 3)),
      ),
      attackBonusRatio: clamp(
        Number(dwarfChampionConfig.attack_bonus_ratio ?? 0.1),
        0,
        1,
      ),
      defenseBonusRatio: clamp(
        Number(dwarfChampionConfig.defense_bonus_ratio ?? 0.08),
        0,
        1,
      ),
      requiresPartyPresence: dwarfChampionConfig.requires_party_presence !== false,
      activeDwarfId: typeof previousDwarfChampion.activeDwarfId === 'string'
        ? previousDwarfChampion.activeDwarfId
        : null,
      activeSinceTick: Math.max(
        0,
        Math.floor(Number(previousDwarfChampion.activeSinceTick || 0)),
      ),
      promotions: Math.max(
        0,
        Math.floor(Number(previousDwarfChampion.promotions || 0)),
      ),
      losses: Math.max(
        0,
        Math.floor(Number(previousDwarfChampion.losses || 0)),
      ),
    },
    floorsByDepth,
    stats: {
      championsDefeated: Math.max(
        0,
        Math.floor(Number(previousStats.championsDefeated || 0)),
      ),
      failedExpeditions: Math.max(
        0,
        Math.floor(Number(previousStats.failedExpeditions || 0)),
      ),
      blockedDispatches: Math.max(
        0,
        Math.floor(Number(previousStats.blockedDispatches || 0)),
      ),
    },
  };
}

// Build underrealm runtime state with full-size depth layers.
function createUnderrealmState(config, runtime, surfaceTerrain, previousUnderrealm) {
  const underrealm = getUnderrealmConfig(config);
  if (underrealm.enabled === false) {
    return null;
  }
  const maxDepth = Math.max(0, Math.floor(Number(underrealm.max_depth ?? 10)));
  if (maxDepth <= 0) {
    return null;
  }
  if (!surfaceTerrain || !surfaceTerrain.types) {
    return null;
  }
  const baseSeed = surfaceTerrain && Number.isFinite(surfaceTerrain.seed)
    ? Number(surfaceTerrain.seed)
    : 1;
  const sizeConfig = getUnderrealmDepthSizeConfig(config, runtime);
  const startUnlockedDepth = clamp(
    Math.floor(Number(underrealm.start_unlocked_depth ?? 0)),
    0,
    maxDepth,
  );
  const previousUnlockedDepth = previousUnderrealm
    ? Math.floor(Number(previousUnderrealm.maxUnlockedDepth || 0))
    : startUnlockedDepth;
  let maxUnlockedDepth = clamp(previousUnlockedDepth, 0, maxDepth);
  const discovery = createUnderrealmDiscoveryState(
    config,
    surfaceTerrain,
    baseSeed,
    previousUnderrealm ? previousUnderrealm.discovery : null,
    maxUnlockedDepth,
  );
  if (discovery.enabled && discovery.found !== true) {
    maxUnlockedDepth = 0;
  } else if (maxUnlockedDepth > 0 && discovery.found !== true) {
    discovery.found = true;
  }
  const startActiveDepth = clamp(
    Math.floor(Number(underrealm.start_active_depth ?? 0)),
    0,
    maxUnlockedDepth,
  );
  const previousActiveDepth = previousUnderrealm
    ? Math.floor(Number(previousUnderrealm.activeDepth || 0))
    : startActiveDepth;
  const activeDepth = clamp(previousActiveDepth, 0, maxUnlockedDepth);
  const difficultyPerDepth = clamp(Number(underrealm.difficulty_per_depth ?? 0.08), 0, 1);
  const rareDropPerDepth = clamp(Number(underrealm.rare_drop_per_depth ?? 0.1), 0, 1);
  const combat = createUnderrealmCombatState(
    config,
    maxDepth,
    maxUnlockedDepth,
    previousUnderrealm || null,
  );
  const previousLayers = previousUnderrealm && Array.isArray(previousUnderrealm.layers)
    ? previousUnderrealm.layers
    : [];
  const previousByDepth = new Map();
  for (const layer of previousLayers) {
    const depth = Math.floor(Number(layer && layer.depth || 0));
    if (depth > 0) {
      previousByDepth.set(depth, layer);
    }
  }
  const layers = [];
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const size = resolveUnderrealmLayerSize(depth, sizeConfig);
    const layerSeed = getUnderrealmLayerSeed(baseSeed, underrealm, depth);
    const previousLayer = previousByDepth.get(depth);
    const terrain = createUnderrealmLayerTerrain(
      config,
      size.width,
      size.height,
      layerSeed,
      depth,
    );
    const floorCombat = combat && combat.floorsByDepth
      ? combat.floorsByDepth[String(depth)] || null
      : null;
    layers.push({
      depth,
      unlocked: depth <= maxUnlockedDepth,
      width: size.width,
      height: size.height,
      terrain,
      difficultyMultiplier: 1 + difficultyPerDepth * (depth - 1),
      rareDropMultiplier: 1 + rareDropPerDepth * (depth - 1),
      combat: floorCombat,
      economy: previousLayer && previousLayer.economy
        ? previousLayer.economy
        : null,
    });
  }
  return {
    enabled: true,
    maxDepth,
    maxUnlockedDepth,
    activeDepth,
    layers,
    discovery,
    combat,
    lift: createUnderrealmLiftState(previousUnderrealm ? previousUnderrealm.lift : null),
    crew: createUnderrealmCrewState(config, previousUnderrealm ? previousUnderrealm.crew : null),
    economy: previousUnderrealm && previousUnderrealm.economy
      ? previousUnderrealm.economy
      : null,
    shrines: createUnderrealmShrineState(previousUnderrealm ? previousUnderrealm.shrines : null),
    deepFaction: previousUnderrealm && previousUnderrealm.deepFaction
      ? previousUnderrealm.deepFaction
      : null,
  };
}

// Build the initial simulation state.
function createInitialState(config, runtime) {
  const terrain = createTerrain(config, runtime, null);
  const occupied = new Set();
  const mapScaleContext = getResourceMapScale(config, runtime);
  const scaledTargets = buildScaledTargets(config, mapScaleContext);
  const structures = createStructures(config, runtime, occupied, terrain);
  const nodes = createResourceNodes(config, runtime, occupied, terrain, mapScaleContext);
  const dwarves = createDwarves(config, runtime, occupied, terrain);
  const pasture = createPastureState(config, terrain);
  const merchant = createMerchantState(config);
  const merchantStats = createMerchantStats();
  const contracts = createContractsState(config);
  const weather = createWeatherState(config);
  const houseStorage = createHouseStorageState(config);
  const raid = createRaidState(config);
  const raidStats = createRaidStats();
  const tools = createToolsState(config);
  const ruins = createRuinsState(config);
  const myths = createMythsState(config);
  const alchemy = createAlchemyState(config);
  const festival = createFestivalState(config);
  const worldEvents = createWorldEventsState(config);
  const wildlife = createWildlifeState(config);
  const roads = createRoadState(config, runtime);
  const temple = createTempleState(config);
  const prestige = createPrestigeState(config);
  const underrealm = createUnderrealmState(config, runtime, terrain, null);

  return {
    tick: 0,
    lastConfig: config,
    dwarves,
    nodes,
    structures,
    merchant,
    merchantStats,
    contracts,
    weather,
    houseStorage,
    raid,
    raidStats,
    tools,
    ruins,
    myths,
    alchemy,
    festival,
    worldEvents,
    pasture,
    wildlife,
    terrain,
    underrealm,
    roads,
    temple,
    prestige,
    stockpile: buildInitialStockpile(config, mapScaleContext),
    resourceTargets: scaledTargets,
    villages: null,
    villageStats: null,
    villageCounter: 0,
    villageBuildCursor: null,
    jobs: [],
    jobCounter: 1,
    structureCounter: structures.length,
    nodeCounter: nodes.length,
    lastPriorities: [],
    lastGovernorSignals: null,
    lastDecisionTrace: null,
    dwarfCounter: dwarves.length,
    events: [],
    ui: {
      inspect: {
        open: false,
        index: 0,
        ids: [],
      },
      legend: {
        open: false,
      },
      telemetryPanel: {
        open: false,
        page: 0,
      },
      saveMap: {
        open: false,
        busy: false,
        message: '',
        closeAtMs: 0,
      },
      transition: {
        active: false,
        phase: 'idle',
        phaseTick: 0,
        progress: 0,
        showPanel: false,
        fadeOutTicks: 0,
        holdTicks: 0,
        fadeInTicks: 0,
        message: '',
      },
    },
    birthsCount: 0,
    deathsCount: 0,
    lastDeathTick: 0,
    endgameArtifactsTick: null,
    cycleStats: {
      count: 0,
      lastTicks: 0,
    },
    endgameDifficulty: 1,
    deathsByCause: {
      starvation: 0,
      oldAge: 0,
      raid: 0,
      deepRaid: 0,
      hunt: 0,
      ruins: 0,
    },
    reproductionStats: {
      ticks: 0,
      couples: 0,
      fertileAdults: 0,
      pregnancies: 0,
      cooldowns: 0,
      resourceFactorSum: 0,
      crowdingFactorSum: 0,
      moraleFactorSum: 0,
      seasonFactorSum: 0,
      chanceSum: 0,
      attempts: 0,
      successes: 0,
      blockedInfertile: 0,
      blockedPregnant: 0,
      blockedCooldown: 0,
      blockedNoResources: 0,
      blockedNoHousing: 0,
      blockedLowStockpile: 0,
      blockedChance: 0,
    },
  };
}

// Create the initial world events state.
function createWorldEventsState(config) {
  const worldConfig = (config && config.worldEvents) || {};
  if (worldConfig.enabled === false) {
    return null;
  }
  const spawnRange = worldConfig.spawnRangeTicks || {};
  const minSpawn = Math.max(0, Number(spawnRange.min ?? 200));
  const maxSpawn = Math.max(minSpawn, Number(spawnRange.max ?? minSpawn));
  return {
    active: null,
    nextSpawnTick: randomBetween(minSpawn, maxSpawn),
    cooldownUntilTick: 0,
    cooldownByType: {
      traveling_bards: 0,
      rival_caravans: 0,
      limited_opportunities: 0,
    },
    counter: 1,
    history: [],
    stats: {
      spawned: 0,
      completed: 0,
      failed: 0,
      expired: 0,
      byType: {
        traveling_bards: { spawned: 0, completed: 0, failed: 0, expired: 0 },
        rival_caravans: { spawned: 0, completed: 0, failed: 0, expired: 0 },
        limited_opportunities: { spawned: 0, completed: 0, failed: 0, expired: 0 },
      },
    },
  };
}

// Build a blank road state sized to the runtime grid.
function createRoadState(config, runtime) {
  const roadsConfig = (config && config.roads) || {};
  if (roadsConfig.enabled === false) {
    return null;
  }
  if (!runtime || runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return null;
  }
  const width = Math.max(0, Number(runtime.gridWidth || 0));
  const height = Math.max(0, Number(runtime.gridHeight || 0));
  return {
    width,
    height,
    version: 0,
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

// Create pasture stock state from terrain tiles.
function createPastureState(config, terrain) {
  const pastureConfig = config && config.pasture ? config.pasture : {};
  if (pastureConfig.enabled === false) {
    return null;
  }
  if (!terrain || !terrain.types) {
    return null;
  }
  const capacity = Math.max(0, Number(pastureConfig.capacity_per_tile || 0));
  if (capacity <= 0) {
    return null;
  }
  const width = terrain.width;
  const height = terrain.height;
  const total = width * height;
  const mask = new Array(total).fill(false);
  const remaining = new Array(total).fill(0);
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    const row = terrain.types[y];
    for (let x = 0; x < width; x += 1) {
      if (row[x] !== 'pasture') {
        continue;
      }
      const index = y * width + x;
      mask[index] = true;
      remaining[index] = capacity;
      count += 1;
    }
  }
  if (count === 0) {
    return null;
  }
  return {
    width,
    height,
    capacity,
    mask,
    remaining,
    count,
  };
}

// Create initial wildlife state.
function createWildlifeState(config) {
  const wildlifeConfig = (config && config.wildlife) || {};
  if (wildlifeConfig.enabled === false) {
    return null;
  }
  return {
    herds: [],
    lastSeasonIndex: null,
    herdCounter: 0,
  };
}

// Create the initial weather state.
function createWeatherState(config) {
  const weatherConfig = (config && config.weather) || {};
  if (weatherConfig.enabled === false) {
    return null;
  }
  const defaultType = weatherConfig.default || 'clear';
  return {
    type: String(defaultType),
    ticksRemaining: 0,
    duration: 0,
  };
}

// Create the initial house storage state.
function createHouseStorageState(config) {
  const storageConfig = config.structures && config.structures.house
    ? config.structures.house.storage
    : null;
  if (!storageConfig || storageConfig.enabled === false) {
    return null;
  }
  const resources = Array.isArray(storageConfig.resources) ? storageConfig.resources : [];
  const stored = {};
  const capacity = {};
  for (const resource of resources) {
    stored[resource] = 0;
    capacity[resource] = 0;
  }
  return { stored, capacity };
}

// Create the initial raid state.
function createRaidState(config) {
  const raidConfig = (config && config.raids) || {};
  return {
    active: false,
    ticksRemaining: 0,
    duration: Math.max(0, Number(raidConfig.durationTicks || 0)),
    lastSeasonIndex: null,
    beasts: [],
  };
}

// Create a default raid stats record.
function createRaidStats() {
  return {
    count: 0,
    deaths: 0,
    loot: {},
    lastRaidDeaths: 0,
    lastRaidTick: 0,
  };
}

// Create the initial tool level state.
function createToolsState(config) {
  const toolsConfig = config.tools || {};
  const initialLevel = Math.max(1, Math.floor(Number(toolsConfig.initialLevel || 1)));
  const maxLevel = Math.max(1, Math.floor(Number(toolsConfig.maxLevel || 1)));
  return {
    level: Math.min(initialLevel, maxLevel),
    maxLevel,
  };
}

// Create the initial ruins exploration state.
function createRuinsState(config) {
  const ruinsConfig = (config && config.ruins) || {};
  if (ruinsConfig.enabled === false) {
    return null;
  }
  const rooms = Array.isArray(ruinsConfig.rooms) ? ruinsConfig.rooms : [];
  return {
    enabled: true,
    roomsCleared: 0,
    roomCount: rooms.length,
    expeditions: [],
    cooldown: 0,
    artifactsFound: {},
    setCounts: {},
    bonuses: {
      outputMultiplier: 0,
      hazardReduction: 0,
      combatBonus: 0,
      artifactChanceBonus: 0,
      casualtyReduction: 0,
      activeCombos: [],
    },
    stats: {
      started: 0,
      successes: 0,
      failures: 0,
      artifacts: 0,
      lastOutcome: null,
      lastOutcomeTick: 0,
      lastSuccesses: 0,
      lastFailures: 0,
      lastArtifactsFound: 0,
    },
    readinessGate: {
      depth: 0,
      roomIndex: 0,
      status: 'unknown',
      reason: null,
      score: 0,
      minScore: 0,
      recommendedScore: 0,
      armoryLevel: 0,
      minArmoryLevel: 1,
      partySize: 0,
      offense: 0,
      defense: 0,
      support: 0,
      warningRiskMultiplier: 1,
      tick: 0,
      lastBlockedTick: 0,
      lastBlockedReason: null,
      lastBlockedDepth: 0,
    },
  };
}

// Create the initial myths state.
function createMythsState(config) {
  const mythsConfig = (config && config.myths) || {};
  if (mythsConfig.enabled === false) {
    return null;
  }
  return {
    active: {},
    history: [],
    traditions: {},
    counters: {},
    lastTriggerTicks: {},
    lastProcessed: {},
  };
}

// Create the initial alchemy state.
function createAlchemyState(config) {
  const alchemyConfig = (config && config.alchemy) || {};
  if (alchemyConfig.enabled === false) {
    return null;
  }
  return {
    active: null,
    backlash: null,
    cooldownTicks: 0,
    history: [],
    stats: {
      activations: 0,
      stableCompletions: 0,
      backlashes: 0,
    },
  };
}

// Create the initial festival state.
function createFestivalState(config) {
  const festivalsConfig = (config && config.festivals) || {};
  if (festivalsConfig.enabled === false) {
    return null;
  }
  return {
    active: false,
    label: null,
    id: null,
    startedTick: null,
    durationTicks: 0,
    effects: {},
    lastSeasonIndex: null,
    lastSeasonName: null,
  };
}

// Create initial structures according to config.
function createStructures(config, runtime, occupied, terrain) {
  const structures = [];
  const structConfig = config.structures || {};
  const symbols = config.symbols || {};
  const isAllowed = getTerrainSpawnPredicate(terrain);

  for (const [type, definition] of Object.entries(structConfig)) {
    const count = Number(definition && definition.count !== undefined ? definition.count : definition);
    if (!Number.isFinite(count) || count <= 0) {
      continue;
    }

    let allowFn = isAllowed;
    const structDefinition = definition && typeof definition === 'object' ? definition : {};
    const terrainTypes = Array.isArray(structDefinition.spawnTerrain || structDefinition.buildTerrain)
      ? (structDefinition.spawnTerrain || structDefinition.buildTerrain)
      : null;
    const terrainPredicate = buildTerrainTypePredicate(terrain, terrainTypes);
    if (terrainPredicate) {
      allowFn = terrainPredicate;
    }

    const positions = createPositions(count, runtime.gridWidth, runtime.gridHeight, occupied, allowFn);
    const isHouse = type === 'house';
    const baseCapacity = definition && definition.capacity !== undefined ? definition.capacity : 1;
    const hasLevels = Boolean(isHouse && definition && typeof definition === 'object' && definition.levels);
    const level = hasLevels ? 1 : null;
    const capacity = isHouse
      ? getHouseCapacity(config, level, baseCapacity)
      : Math.max(1, Number(baseCapacity));
    const symbol = level
      ? String(level)
      : (symbols[type] || (type === 'workshop' ? 'W' : (symbols.structure || '#')));
    const levelMax = isHouse ? null : Math.max(1, Number(definition.levelMax || 1));

    for (let index = 0; index < positions.length; index += 1) {
      const pos = positions[index];
      const structure = {
        id: `${type}_${index + 1}`,
        type,
        symbol,
        capacity,
        x: pos.x,
        y: pos.y,
      };
      if (level) {
        structure.level = level;
      }
      if ((type === 'mine'
          || type === 'sawmill'
          || type === 'brewery'
          || type === 'mithril_forge'
          || type === 'armory')
          && levelMax) {
        structure.level = 1;
      }
      structures.push(structure);
      occupied.add(positionKey(pos.x, pos.y));
    }
  }

  return structures;
}

// Create initial resource nodes based on config.
function createResourceNodes(config, runtime, occupied, terrain, mapScaleContext) {
  const resources = config.resources || {};
  if (resources.useTerrainTiles === true) {
    return [];
  }
  const nodes = [];
  const nodeConfig = resources.nodes || {};
  const capacityConfig = resources.nodeCapacity || {};
  const defaultCapacity = Number(resources.defaultNodeCapacity || 10);
  const symbols = config.symbols || {};
  const terrainAllowed = resources.terrainAllowed || {};
  const mapScale = mapScaleContext ? mapScaleContext.mapScale : null;
  const mapMultiplier = mapScaleContext ? mapScaleContext.multiplier : 1;
  const scaleNodes = shouldApplyMapScale(mapScale, 'nodes');
  const scaleCapacity = shouldApplyMapScale(mapScale, 'nodeCapacity');
  let nodeCounter = 1;

  for (const [id, count] of Object.entries(nodeConfig)) {
    const baseCount = Math.max(0, Math.floor(Number(count || 0)));
    const scaledCount = scaleNodes
      ? Math.max(0, Math.round(baseCount * mapMultiplier))
      : baseCount;
    const isAllowed = getTerrainResourcePredicate(terrain, terrainAllowed, id);
    const positions = createPositions(
      scaledCount,
      runtime.gridWidth,
      runtime.gridHeight,
      occupied,
      isAllowed,
    );
    const symbol = symbols[id] || '?';
    const baseCapacity = Math.max(1, Number(capacityConfig[id] || defaultCapacity));
    const capacity = scaleCapacity
      ? Math.max(1, Math.round(baseCapacity * mapMultiplier))
      : baseCapacity;

    for (const pos of positions) {
      nodes.push({
        nodeId: `node_${nodeCounter++}`,
        id,
        symbol,
        source: 'natural',
        x: pos.x,
        y: pos.y,
        capacity,
        remaining: capacity,
      });
      occupied.add(positionKey(pos.x, pos.y));
    }

    if (scaledCount > 0 && positions.length === 0) {
      const fallback = findFallbackPosition(runtime, occupied, isAllowed);
      if (fallback) {
        nodes.push({
          nodeId: `node_${nodeCounter++}`,
          id,
          symbol,
          source: 'natural',
          x: fallback.x,
          y: fallback.y,
          capacity,
          remaining: capacity,
        });
        occupied.add(positionKey(fallback.x, fallback.y));
      }
    }
  }

  return nodes;
}

// Find the first available position that matches a predicate.
function findFallbackPosition(runtime, occupied, allowFn) {
  const width = runtime.gridWidth;
  const height = runtime.gridHeight;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const key = positionKey(x, y);
      if (occupied.has(key)) {
        continue;
      }
      if (allowFn && !allowFn(x, y)) {
        continue;
      }
      return { x, y };
    }
  }
  return null;
}

// Create initial dwarves using config rules.
function createDwarves(config, runtime, occupied, terrain) {
  const count = Number(config.dwarves.count || 0);
  const positions = createPositions(
    count,
    runtime.gridWidth,
    runtime.gridHeight,
    occupied,
    getTerrainSpawnPredicate(terrain),
  );
  const needsTemplate = config.needs.initial || {};
  const population = config.population || {};
  const aging = population.aging || {};
  const roles = population.roles || {};
  const initialAgeRange = population.initialAgeRange || {};
  const minAge = Number(initialAgeRange.min ?? aging.adultAge ?? 0);
  const maxAge = Number(initialAgeRange.max ?? aging.fertileEnd ?? minAge);

  const dwarves = positions.map((pos, index) => {
    const ageTicks = clamp(randomBetween(minAge, maxAge), 0, Number(aging.maxAge || maxAge || 0));
    const isAdult = ageTicks >= Number(aging.adultAge || 0);
    const role = roles.enabled && isAdult
      ? (Math.random() < clamp(Number(roles.builderRatio ?? 0), 0, 1) ? 'builder' : 'gatherer')
      : null;
    const clanId = pickClanId(config);
    return {
      id: `dwarf_${index + 1}`,
      spawnIndex: index + 1,
      x: pos.x,
      y: pos.y,
      ageTicks,
      lifeStage: getLifeStage(ageTicks, aging),
      role,
      roleCooldown: 0,
      clanId,
      needs: { ...needsTemplate },
      state: {
        health: 1,
        morale: 1,
        moraleBoostBeer: 0,
        stress: 0,
        fatigue: 0,
      },
      job: null,
      homeId: null,
      partnerId: null,
      bondTargetId: null,
      bondScore: 0,
      fertilityCooldown: 0,
      pregnancy: null,
      starvationTicks: 0,
      underrealmChampionSurvivals: 0,
    };
  });

  const breweryConfig = config.structures && config.structures.brewery;
  const brewmasterCount = Math.max(0, Number(breweryConfig && breweryConfig.brewmasterInitial || 0));
  if (brewmasterCount > 0) {
    let assigned = 0;
    const adultAge = Number(aging.adultAge || 0);
    for (const dwarf of dwarves) {
      if (assigned >= brewmasterCount) {
        break;
      }
      if (Number(dwarf.ageTicks || 0) < adultAge) {
        continue;
      }
      dwarf.role = 'brewmaster';
      dwarf.roleLocked = true;
      assigned += 1;
    }
  }

  return dwarves;
}

// Build a predicate for allowed terrain types.
function buildTerrainTypePredicate(terrain, allowedTypes) {
  if (!terrain || !terrain.types || !Array.isArray(allowedTypes) || allowedTypes.length === 0) {
    return null;
  }
  const allowedSet = new Set(allowedTypes.map((entry) => String(entry)));
  const spawnable = terrain.spawnable;
  return (x, y) => {
    if (spawnable && (!spawnable[y] || !spawnable[y][x])) {
      return false;
    }
    const type = terrain.types[y] ? terrain.types[y][x] : null;
    return type ? allowedSet.has(type) : false;
  };
}

// Create random positions while respecting occupancy and predicates.
function createPositions(count, width, height, occupied, allowFn) {
  if (width <= 0 || height <= 0) {
    return [];
  }

  const max = width * height;
  const available = Math.max(0, max - occupied.size);
  const target = Math.min(Number(count || 0), available);

  if (target <= 0) {
    return [];
  }

  const positions = [];
  let attempts = 0;
  const maxAttempts = Math.max(50, target * 20);

  while (positions.length < target && attempts < maxAttempts) {
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);
    const key = positionKey(x, y);

    if (!occupied.has(key) && (!allowFn || allowFn(x, y))) {
      positions.push({ x, y });
      occupied.add(key);
    }

    attempts += 1;
  }

  if (positions.length < target) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (positions.length >= target) {
          break;
        }
        const key = positionKey(x, y);
        if (!occupied.has(key) && (!allowFn || allowFn(x, y))) {
          positions.push({ x, y });
          occupied.add(key);
        }
      }
      if (positions.length >= target) {
        break;
      }
    }
  }

  return positions;
}

// Build a stable position key for occupancy checks.
function positionKey(x, y) {
  return `${x},${y}`;
}

// Fit all entities to the current runtime grid dimensions.
function fitStateToGrid(state, runtime, config) {
  if (runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return;
  }

  syncTerrainToGrid(state, runtime, config);
  const isAllowed = getTerrainSpawnPredicate(state.terrain);
  const occupied = new Set();

  for (const structure of state.structures || []) {
    placeEntity(structure, occupied, runtime, isAllowed);
  }

  for (const node of state.nodes) {
    placeEntity(node, occupied, runtime, isAllowed);
  }

  if (state.raid && Array.isArray(state.raid.beasts)) {
    for (const beast of state.raid.beasts) {
      placeEntity(beast, occupied, runtime, isAllowed);
    }
  }

  if (state.wildlife && Array.isArray(state.wildlife.herds)) {
    for (const herd of state.wildlife.herds) {
      placeEntity(herd, occupied, runtime, isAllowed);
    }
  }

  for (const dwarf of state.dwarves) {
    placeEntity(dwarf, occupied, runtime, isAllowed);
  }

  if (state.merchant && state.merchant.phase && state.merchant.phase !== 'idle') {
    clampMerchantState(state.merchant, runtime);
  }
}

// Sync terrain data to the current runtime grid size.
function syncTerrainToGrid(state, runtime, config) {
  if (!config || !config.display) {
    if (state.terrain
        && (state.terrain.width !== runtime.gridWidth || state.terrain.height !== runtime.gridHeight)) {
      state.terrain = null;
    }
    state.underrealm = null;
    return;
  }

  const terrainConfig = config.display.terrain || {};
  if (terrainConfig.enabled === false) {
    state.terrain = null;
    state.pasture = null;
    state.underrealm = null;
    if (state) {
      state.villageCenter = null;
      state.villages = null;
      state.villageStats = null;
      state.villageCounter = 0;
      state.villageBuildCursor = null;
      state.terrainIndex = null;
      state.roads = null;
      if (state.temple && typeof state.temple === 'object') {
        state.temple.site = null;
        state.temple.blockedReason = null;
      }
    }
    return;
  }

  if (!state.terrain
      || state.terrain.width !== runtime.gridWidth
      || state.terrain.height !== runtime.gridHeight) {
    state.terrain = createTerrain(config, runtime, state.terrain);
    state.pasture = createPastureState(config, state.terrain);
    if (state) {
      state.villageCenter = null;
      state.villages = null;
      state.villageStats = null;
      state.villageCounter = 0;
      state.villageBuildCursor = null;
      state.terrainIndex = null;
      state.roads = createRoadState(config, runtime);
      if (state.temple && typeof state.temple === 'object') {
        state.temple.site = null;
        state.temple.blockedReason = null;
      }
    }
  }
  if (applyRuntimeInsetMaskToTerrain(state.terrain, runtime)) {
    state.terrainIndex = null;
    state.roads = createRoadState(config, runtime);
  }
  syncUnderrealmToGrid(state, runtime, config);
}

// Sync underrealm layer data to the current runtime grid size.
function syncUnderrealmToGrid(state, runtime, config) {
  if (!state) {
    return;
  }
  state.underrealm = createUnderrealmState(
    config,
    runtime,
    state.terrain,
    state.underrealm,
  );
}

// Carve runtime inset cells out of existing terrain walkable/spawnable maps.
function applyRuntimeInsetMaskToTerrain(terrain, runtime) {
  if (!terrain || !Array.isArray(terrain.walkable)) {
    return false;
  }
  const inset = runtime && runtime.mapInset;
  if (!inset || inset.reserveSimulationSpace === false) {
    return false;
  }
  const width = Math.max(0, Number(terrain.width || 0));
  const height = Math.max(0, Number(terrain.height || 0));
  if (width <= 0 || height <= 0) {
    return false;
  }
  const minX = clamp(Math.floor(Number(inset.x || 0)), 0, width - 1);
  const minY = clamp(Math.floor(Number(inset.y || 0)), 0, height - 1);
  const maxX = clamp(minX + Math.max(0, Math.floor(Number(inset.width || 0))) - 1, minX, width - 1);
  const maxY = clamp(minY + Math.max(0, Math.floor(Number(inset.height || 0))) - 1, minY, height - 1);

  let changed = false;
  for (let y = minY; y <= maxY; y += 1) {
    const walkableRow = terrain.walkable[y];
    const spawnableRow = terrain.spawnable && terrain.spawnable[y] ? terrain.spawnable[y] : null;
    if (!walkableRow) {
      continue;
    }
    for (let x = minX; x <= maxX; x += 1) {
      if (walkableRow[x] !== false) {
        walkableRow[x] = false;
        changed = true;
      }
      if (spawnableRow && spawnableRow[x] !== false) {
        spawnableRow[x] = false;
        changed = true;
      }
    }
  }
  return changed;
}

// Clamp an entity into the grid and re-place if occupied.
function placeEntity(entity, occupied, runtime, allowFn) {
  const x = clamp(entity.x, 0, runtime.gridWidth - 1);
  const y = clamp(entity.y, 0, runtime.gridHeight - 1);
  const key = positionKey(x, y);

  if (!occupied.has(key) && (!allowFn || allowFn(x, y))) {
    entity.x = x;
    entity.y = y;
    occupied.add(key);
    return;
  }

  const [pos] = createPositions(1, runtime.gridWidth, runtime.gridHeight, occupied, allowFn);
  if (pos) {
    entity.x = pos.x;
    entity.y = pos.y;
    return;
  }

  entity.x = x;
  entity.y = y;
}

// Clamp merchant positions and targets within the grid.
function clampMerchantState(merchant, runtime) {
  merchant.x = clamp(Number(merchant.x || 0), 0, runtime.gridWidth - 1);
  merchant.y = clamp(Number(merchant.y || 0), 0, runtime.gridHeight - 1);
  if (merchant.target) {
    merchant.target = clampPoint(merchant.target, runtime);
  }
  if (merchant.exitTarget) {
    merchant.exitTarget = clampPoint(merchant.exitTarget, runtime);
  }
}

// Clamp a point into the grid bounds.
function clampPoint(point, runtime) {
  return {
    x: clamp(Number(point.x || 0), 0, runtime.gridWidth - 1),
    y: clamp(Number(point.y || 0), 0, runtime.gridHeight - 1),
  };
}

// Generate a random integer between min and max (inclusive).
function randomBetween(min, max) {
  const low = Number.isFinite(min) ? Number(min) : 0;
  const high = Number.isFinite(max) ? Number(max) : low;
  if (high <= low) {
    return low;
  }
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

// Create the initial merchant state.
function createMerchantState(config) {
  const merchantConfig = config.merchant || {};
  const enabled = merchantConfig.enabled !== false;
  const spawnRange = merchantConfig.spawnRangeTicks || {};
  const minSpawn = Number(spawnRange.min ?? 200);
  const maxSpawn = Number(spawnRange.max ?? minSpawn);
  const nextSpawnTick = enabled ? randomBetween(minSpawn, maxSpawn) : Number.POSITIVE_INFINITY;

  return {
    phase: 'idle',
    x: 0,
    y: 0,
    target: null,
    exitTarget: null,
    entrySide: null,
    exitSide: null,
    stayTicks: 0,
    tradesRemaining: 0,
    tradesMax: 0,
    tradeCount: 0,
    tradeLog: null,
    nextSpawnTick,
  };
}

// Create initial merchant stats counters.
function createMerchantStats() {
  return {
    ticks: 0,
    trades: 0,
    given: {},
    received: {},
  };
}

// Create the initial contracts state.
function createContractsState(config) {
  const contractsConfig = (config && config.contracts) || {};
  if (contractsConfig.enabled === false) {
    return null;
  }
  const spawnRange = contractsConfig.spawnRangeTicks || {};
  const minSpawn = Number(spawnRange.min ?? 200);
  const maxSpawn = Number(spawnRange.max ?? minSpawn);
  const nextSpawnTick = randomBetween(minSpawn, maxSpawn);
  const factions = contractsConfig.factions || {};
  const reputations = {};
  for (const factionId of Object.keys(factions)) {
    reputations[factionId] = 0;
  }
  return {
    active: null,
    activeBuff: null,
    reputations,
    nextSpawnTick,
    stats: {
      successes: 0,
      failures: 0,
    },
    counter: 1,
  };
}

// Resolve life stage from age ticks.
function getLifeStage(ageTicks, aging) {
  const adultAge = Number(aging.adultAge || 0);
  const oldAgeStart = Number(aging.oldAgeStart || Infinity);
  if (ageTicks < adultAge) {
    return 'child';
  }
  if (ageTicks >= oldAgeStart) {
    return 'elder';
  }
  return 'adult';
}

module.exports = { createInitialState, fitStateToGrid };
