'use strict';

const { clamp } = require('../utils');
const { getStockpileRatio, hasInputs, consumeInputs } = require('./resources');
const { getTerrainTypeAt, isSpawnableTile } = require('./terrain');
const { pushEvent } = require('./events');

const NEIGHBOR_STEPS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];
const ROAD_TERRAIN_PENALTY_DEFAULTS = {
  plain: 0,
  fertile: 0.04,
  food: 0.08,
  pasture: 0.07,
  forest: 0.16,
  hill: 0.45,
  mountain: 1.2,
  stone: 0.8,
  river: 0.9,
  lake: 1.2,
  shore: 0.7,
  water: 1.4,
};
const ROAD_PATH_STYLE_PROFILES = {
  pragmatic: {
    heuristicWeight: 1.25,
    turnPenalty: 0.2,
    straightStepThreshold: 7,
    straightStepPenalty: 0.02,
    noiseScale: 0.14,
    noiseWeight: 0.08,
    softAvoidPenalty: 4.2,
    longLinkWaypoint: {
      enabled: true,
      minDistance: 42,
      candidateCount: 6,
      offsetMin: 3,
      offsetMax: 9,
      alongJitterRatio: 0.12,
      minSegmentDistance: 10,
      maxDetourRatio: 1.3,
      maxDirectRatio: 1.12,
      minTurnGain: 3,
      minLineDeviationGain: 1.4,
      turnReward: 0.12,
    },
  },
  scenic: {
    heuristicWeight: 0.95,
    turnPenalty: 0.08,
    straightStepThreshold: 4,
    straightStepPenalty: 0.08,
    noiseScale: 0.18,
    noiseWeight: 0.28,
    softAvoidPenalty: 2.8,
    longLinkWaypoint: {
      enabled: true,
      minDistance: 26,
      candidateCount: 12,
      offsetMin: 5,
      offsetMax: 16,
      alongJitterRatio: 0.26,
      minSegmentDistance: 7,
      maxDetourRatio: 1.65,
      maxDirectRatio: 1.4,
      minTurnGain: 1,
      minLineDeviationGain: 0.4,
      turnReward: 0.26,
    },
  },
};

// Resolve the road path style profile name and defaults.
function resolveRoadPathStyleProfile(rawValue) {
  const profileRaw = String(rawValue || "pragmatic").toLowerCase();
  if (profileRaw === "scenic") {
    return {
      name: "scenic",
      values: ROAD_PATH_STYLE_PROFILES.scenic,
    };
  }
  return {
    name: "pragmatic",
    values: ROAD_PATH_STYLE_PROFILES.pragmatic,
  };
}

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
  const pathStyleRaw = raw.path_style || raw.pathStyle || {};
  const pathStyleProfile = resolveRoadPathStyleProfile(
    pathStyleRaw.profile ?? pathStyleRaw.path_profile ?? pathStyleRaw.mode,
  );
  const pathStyleDefaults = pathStyleProfile.values || {};
  const longLinkWaypointRaw =
    pathStyleRaw.long_link_waypoint || pathStyleRaw.longLinkWaypoint || {};
  const longLinkWaypointDefaults = pathStyleDefaults.longLinkWaypoint || {};
  const pathTerrainPenaltyRaw =
    pathStyleRaw.terrain_penalty || pathStyleRaw.terrainPenalty || {};
  const pathTerrainPenalty = {};
  for (const [type, penaltyRaw] of Object.entries(pathTerrainPenaltyRaw)) {
    const penalty = Number(penaltyRaw);
    if (!Number.isFinite(penalty)) {
      continue;
    }
    pathTerrainPenalty[String(type)] = Math.max(0, penalty);
  }
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
    pathStyle: {
      enabled: pathStyleRaw.enabled !== false,
      profile: pathStyleProfile.name,
      heuristicWeight: clamp(
        Number(
          pathStyleRaw.heuristicWeight ??
            pathStyleRaw.heuristic_weight ??
            pathStyleDefaults.heuristicWeight ??
            1,
        ),
        0,
        5,
      ),
      turnPenalty: clamp(
        Number(
          pathStyleRaw.turnPenalty ??
            pathStyleRaw.turn_penalty ??
            pathStyleDefaults.turnPenalty ??
            0.14,
        ),
        0,
        3,
      ),
      straightStepThreshold: clamp(
        Math.floor(
          Number(
            pathStyleRaw.straightStepThreshold ??
              pathStyleRaw.straight_step_threshold ??
              pathStyleDefaults.straightStepThreshold ??
              5,
          ),
        ),
        1,
        32,
      ),
      straightStepPenalty: clamp(
        Number(
          pathStyleRaw.straightStepPenalty ??
            pathStyleRaw.straight_step_penalty ??
            pathStyleDefaults.straightStepPenalty ??
            0.04,
        ),
        0,
        2,
      ),
      noiseScale: Math.max(
        0.001,
        Number(
          pathStyleRaw.noiseScale ??
            pathStyleRaw.noise_scale ??
            pathStyleDefaults.noiseScale ??
            0.16,
        ),
      ),
      noiseWeight: clamp(
        Number(
          pathStyleRaw.noiseWeight ??
            pathStyleRaw.noise_weight ??
            pathStyleDefaults.noiseWeight ??
            0.18,
        ),
        0,
        2,
      ),
      softAvoidPenalty: clamp(
        Number(
          pathStyleRaw.softAvoidPenalty ??
            pathStyleRaw.soft_avoid_penalty ??
            pathStyleDefaults.softAvoidPenalty ??
            3.5,
        ),
        0,
        25,
      ),
      seedOffset: Math.floor(
        Number(pathStyleRaw.seedOffset ?? pathStyleRaw.seed_offset ?? 991),
      ),
      longLinkWaypoint: {
        enabled: longLinkWaypointRaw.enabled !== false
          && longLinkWaypointDefaults.enabled !== false,
        minDistance: clamp(
          Math.floor(
            Number(
              longLinkWaypointRaw.minDistance ??
                longLinkWaypointRaw.min_distance ??
                longLinkWaypointDefaults.minDistance ??
                34,
            ),
          ),
          8,
          400,
        ),
        candidateCount: clamp(
          Math.floor(
            Number(
              longLinkWaypointRaw.candidateCount ??
                longLinkWaypointRaw.candidate_count ??
                longLinkWaypointDefaults.candidateCount ??
                8,
            ),
          ),
          2,
          24,
        ),
        offsetMin: clamp(
          Number(
            longLinkWaypointRaw.offsetMin ??
              longLinkWaypointRaw.offset_min ??
              longLinkWaypointDefaults.offsetMin ??
              4,
          ),
          1,
          40,
        ),
        offsetMax: clamp(
          Number(
            longLinkWaypointRaw.offsetMax ??
              longLinkWaypointRaw.offset_max ??
              longLinkWaypointDefaults.offsetMax ??
              12,
          ),
          1,
          60,
        ),
        alongJitterRatio: clamp(
          Number(
            longLinkWaypointRaw.alongJitterRatio ??
              longLinkWaypointRaw.along_jitter_ratio ??
              longLinkWaypointDefaults.alongJitterRatio ??
              0.18,
          ),
          0,
          0.6,
        ),
        minSegmentDistance: clamp(
          Math.floor(
            Number(
              longLinkWaypointRaw.minSegmentDistance ??
                longLinkWaypointRaw.min_segment_distance ??
                longLinkWaypointDefaults.minSegmentDistance ??
                8,
            ),
          ),
          2,
          100,
        ),
        maxDetourRatio: clamp(
          Number(
            longLinkWaypointRaw.maxDetourRatio ??
              longLinkWaypointRaw.max_detour_ratio ??
              longLinkWaypointDefaults.maxDetourRatio ??
              1.45,
          ),
          1,
          3,
        ),
        maxDirectRatio: clamp(
          Number(
            longLinkWaypointRaw.maxDirectRatio ??
              longLinkWaypointRaw.max_direct_ratio ??
              longLinkWaypointDefaults.maxDirectRatio ??
              1.25,
          ),
          1,
          2,
        ),
        minTurnGain: clamp(
          Math.floor(
            Number(
              longLinkWaypointRaw.minTurnGain ??
                longLinkWaypointRaw.min_turn_gain ??
                longLinkWaypointDefaults.minTurnGain ??
                2,
            ),
          ),
          0,
          12,
        ),
        minLineDeviationGain: clamp(
          Number(
            longLinkWaypointRaw.minLineDeviationGain ??
              longLinkWaypointRaw.min_line_deviation_gain ??
              longLinkWaypointDefaults.minLineDeviationGain ??
              0.9,
          ),
          0,
          20,
        ),
        turnReward: clamp(
          Number(
            longLinkWaypointRaw.turnReward ??
              longLinkWaypointRaw.turn_reward ??
              longLinkWaypointDefaults.turnReward ??
              0.18,
          ),
          0,
          2,
        ),
      },
      terrainPenalty: { ...ROAD_TERRAIN_PENALTY_DEFAULTS, ...pathTerrainPenalty },
    },
    cost,
  };
}

// Build a blank road state sized to the current grid.
function createRoadState(width, height) {
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
  const anchorStart = findRoadAnchor(state, roads, runtime, start, roadsConfig.anchorRadius, goal);
  const anchorGoal = findRoadAnchor(state, roads, runtime, goal, roadsConfig.anchorRadius, start);
  const from = anchorStart || start;
  const to = anchorGoal || goal;
  const path = findRoadPath(state, roads, runtime, roadsConfig, from, to, linkKey);
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
  if (!isSpawnableTile(state, x, y)) {
    return null;
  }
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
function findRoadPath(state, roads, runtime, roadsConfig, start, goal, linkKey) {
  const width = Math.max(0, Number(runtime.gridWidth || 0));
  const height = Math.max(0, Number(runtime.gridHeight || 0));
  const startX = clamp(Number(start.x || 0), 0, width - 1);
  const startY = clamp(Number(start.y || 0), 0, height - 1);
  const goalX = clamp(Number(goal.x || 0), 0, width - 1);
  const goalY = clamp(Number(goal.y || 0), 0, height - 1);
  if (!isSpawnableTile(state, startX, startY) || !isSpawnableTile(state, goalX, goalY)) {
    return null;
  }
  if (startX === goalX && startY === goalY) {
    return [{ x: startX, y: startY }];
  }

  const avoid = Array.isArray(roadsConfig.avoidTerrain) ? roadsConfig.avoidTerrain : [];
  const softAvoid = Array.isArray(roadsConfig.softAvoidTerrain) ? roadsConfig.softAvoidTerrain : [];
  const parallelAvoidRadius = Math.max(0, Number(roadsConfig.parallelAvoidRadius || 0));
  const parallelBuffer = Math.max(0, Number(roadsConfig.anchorRadius || 0));
  const parallelRelaxRadius = Math.max(0, Number(roadsConfig.parallelRelaxRadius || 0));
  const parallelRelaxOnFail = roadsConfig.parallelRelaxOnFail !== false;
  const pathStyle = roadsConfig.pathStyle || {};
  const hardAvoid = new Set(avoid);
  const softAvoidSet = new Set(
    softAvoid.filter((type) => type && !hardAvoid.has(type)),
  );
  const avoidWithSoft = new Set([...hardAvoid, ...softAvoidSet]);
  const baseSearchSeed = buildRoadSearchSeed(state, linkKey, pathStyle.seedOffset);
  const manhattanDistance = Math.abs(startX - goalX) + Math.abs(startY - goalY);
  const longLinkWaypoint = pathStyle.longLinkWaypoint || {};
  const canUseLongLinkWaypoint =
    pathStyle.enabled !== false &&
    longLinkWaypoint.enabled !== false &&
    manhattanDistance >= Number(longLinkWaypoint.minDistance || 0);
  const runPathSearch = (
    sx,
    sy,
    gx,
    gy,
    blockedSet,
    softPenaltySet,
    parallelRadius,
    seedSuffix,
  ) => {
    const searchSeed = baseSearchSeed + hashRoadString(String(seedSuffix || ""));
    if (pathStyle.enabled === false) {
      return findRoadPathWithAvoidBfs(
        state,
        roads,
        width,
        height,
        sx,
        sy,
        gx,
        gy,
        blockedSet,
        parallelRadius,
        parallelBuffer,
      );
    }
    return findRoadPathWithAvoidWeighted(
      state,
      roads,
      width,
      height,
      sx,
      sy,
      gx,
      gy,
      blockedSet,
      softPenaltySet,
      parallelRadius,
      parallelBuffer,
      pathStyle,
      searchSeed,
    );
  };
  const tryPathMode = (
    modeKey,
    blockedSet,
    softPenaltySet,
    parallelRadius,
  ) => {
    const segmentSearch = (sx, sy, gx, gy, seedSuffix) => {
      return runPathSearch(
        sx,
        sy,
        gx,
        gy,
        blockedSet,
        softPenaltySet,
        parallelRadius,
        seedSuffix,
      );
    };
    const directPath = runPathSearch(
      startX,
      startY,
      goalX,
      goalY,
      blockedSet,
      softPenaltySet,
      parallelRadius,
      `${modeKey}:direct`,
    );
    if (!canUseLongLinkWaypoint) {
      return directPath;
    }
    const waypointPath = findRoadPathViaLongWaypoint(
      state,
      width,
      height,
      startX,
      startY,
      goalX,
      goalY,
      blockedSet,
      longLinkWaypoint,
      baseSearchSeed + hashRoadString(`${modeKey}:waypoint`),
      segmentSearch,
      modeKey,
    );
    if (!waypointPath) {
      return directPath;
    }
    if (!directPath) {
      return waypointPath;
    }
    return selectPreferredLongLinkPath(
      directPath,
      waypointPath,
      longLinkWaypoint,
    );
  };

  const primary = tryPathMode(
    "primary",
    avoidWithSoft,
    null,
    parallelAvoidRadius,
  );
  if (primary) {
    return primary;
  }
  if (roadsConfig.allowWaterFallback !== false) {
    const fallback = tryPathMode(
      "fallback",
      hardAvoid,
      softAvoidSet,
      parallelAvoidRadius,
    );
    if (fallback) {
      return fallback;
    }
  }
  if (parallelRelaxOnFail && parallelAvoidRadius > parallelRelaxRadius) {
    const relaxedPrimary = tryPathMode(
      "relaxed-primary",
      avoidWithSoft,
      null,
      parallelRelaxRadius,
    );
    if (relaxedPrimary) {
      return relaxedPrimary;
    }
    if (roadsConfig.allowWaterFallback !== false) {
      return tryPathMode(
        "relaxed-fallback",
        hardAvoid,
        softAvoidSet,
        parallelRelaxRadius,
      );
    }
  }
  return null;
}

// Try splitting long links through a scenic midpoint waypoint.
function findRoadPathViaLongWaypoint(
  state,
  width,
  height,
  startX,
  startY,
  goalX,
  goalY,
  blockedSet,
  settings,
  seed,
  searchFn,
  modeKey,
) {
  if (!settings || typeof searchFn !== "function") {
    return null;
  }
  const candidates = buildLongLinkWaypointCandidates(
    startX,
    startY,
    goalX,
    goalY,
    width,
    height,
    settings,
    seed,
  );
  if (candidates.length === 0) {
    return null;
  }
  const baseDistance = Math.abs(startX - goalX) + Math.abs(startY - goalY) + 1;
  const maxDetourRatio = Math.max(1, Number(settings.maxDetourRatio || 1));
  const maxPathLength = Math.max(baseDistance, Math.ceil(baseDistance * maxDetourRatio));
  const turnReward = Math.max(0, Number(settings.turnReward || 0));
  let bestPath = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < candidates.length; i += 1) {
    const waypoint = candidates[i];
    if (!isSpawnableTile(state, waypoint.x, waypoint.y)) {
      continue;
    }
    const terrainType = getTerrainTypeAt(state, waypoint.x, waypoint.y);
    if (terrainType && blockedSet && blockedSet.has(terrainType)) {
      continue;
    }
    const pathA = searchFn(
      startX,
      startY,
      waypoint.x,
      waypoint.y,
      `${modeKey}:wp:${i}:a`,
    );
    if (!pathA || pathA.length < 2) {
      continue;
    }
    const pathB = searchFn(
      waypoint.x,
      waypoint.y,
      goalX,
      goalY,
      `${modeKey}:wp:${i}:b`,
    );
    if (!pathB || pathB.length < 2) {
      continue;
    }
    const combined = pathA.concat(pathB.slice(1));
    if (combined.length > maxPathLength) {
      continue;
    }
    const turns = countRoadPathTurns(combined);
    const score = combined.length - turns * turnReward;
    if (score < bestScore) {
      bestScore = score;
      bestPath = combined;
    }
  }
  return bestPath;
}

// Build deterministic waypoint candidates around the center of a long link.
function buildLongLinkWaypointCandidates(
  startX,
  startY,
  goalX,
  goalY,
  width,
  height,
  settings,
  seed,
) {
  const dx = goalX - startX;
  const dy = goalY - startY;
  const euclidean = Math.sqrt(dx * dx + dy * dy);
  if (!Number.isFinite(euclidean) || euclidean < 2) {
    return [];
  }
  const ux = dx / euclidean;
  const uy = dy / euclidean;
  const px = -uy;
  const py = ux;
  const centerX = (startX + goalX) / 2;
  const centerY = (startY + goalY) / 2;
  const candidateCount = Math.max(1, Math.floor(Number(settings.candidateCount || 1)));
  const offsetLow = Math.max(
    1,
    Math.min(
      Number(settings.offsetMin || 0),
      Number(settings.offsetMax || Number(settings.offsetMin || 0)),
    ),
  );
  const offsetHigh = Math.max(
    offsetLow,
    Number(settings.offsetMax || offsetLow),
  );
  const alongJitterRatio = Math.max(0, Number(settings.alongJitterRatio || 0));
  const alongJitter = euclidean * alongJitterRatio;
  const minSegmentDistance = Math.max(
    1,
    Math.floor(Number(settings.minSegmentDistance || 1)),
  );
  const candidates = [];
  const seen = new Set();
  const maxAttempts = Math.max(candidateCount * 6, 12);
  let attempts = 0;
  while (candidates.length < candidateCount && attempts < maxAttempts) {
    const sideNoise = hashRoadNoise(attempts + 19, 7, seed + 13);
    const side = sideNoise < 0.5 ? -1 : 1;
    const offsetNoise = hashRoadNoise(attempts + 71, 29, seed + 37);
    const alongNoise = hashRoadNoise(attempts + 101, 43, seed + 59);
    const offset = offsetLow + (offsetHigh - offsetLow) * offsetNoise;
    const along = (alongNoise - 0.5) * 2 * alongJitter;
    const rawX = centerX + ux * along + px * offset * side;
    const rawY = centerY + uy * along + py * offset * side;
    const x = clamp(Math.round(rawX), 0, width - 1);
    const y = clamp(Math.round(rawY), 0, height - 1);
    attempts += 1;
    if ((x === startX && y === startY) || (x === goalX && y === goalY)) {
      continue;
    }
    const distStart = Math.abs(x - startX) + Math.abs(y - startY);
    const distGoal = Math.abs(x - goalX) + Math.abs(y - goalY);
    if (distStart < minSegmentDistance || distGoal < minSegmentDistance) {
      continue;
    }
    const key = `${x},${y}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    candidates.push({ x, y });
  }
  return candidates;
}

// Select between direct and waypoint path using bounded detour + curvature gain.
function selectPreferredLongLinkPath(directPath, waypointPath, settings) {
  if (!Array.isArray(directPath) || directPath.length === 0) {
    return waypointPath;
  }
  if (!Array.isArray(waypointPath) || waypointPath.length === 0) {
    return directPath;
  }
  const maxDirectRatio = Math.max(1, Number(settings.maxDirectRatio || 1));
  if (waypointPath.length > Math.ceil(directPath.length * maxDirectRatio)) {
    return directPath;
  }
  const minLineDeviationGain = Math.max(
    0,
    Number(settings.minLineDeviationGain || 0),
  );
  if (minLineDeviationGain > 0) {
    const directLineDeviation = getRoadPathMaxLineDeviation(directPath);
    const waypointLineDeviation = getRoadPathMaxLineDeviation(waypointPath);
    if (waypointLineDeviation >= directLineDeviation + minLineDeviationGain) {
      return waypointPath;
    }
  }
  const directTurns = countRoadPathTurns(directPath);
  const waypointTurns = countRoadPathTurns(waypointPath);
  const minTurnGain = Math.max(0, Math.floor(Number(settings.minTurnGain || 0)));
  if (waypointTurns >= directTurns + minTurnGain) {
    return waypointPath;
  }
  const turnReward = Math.max(0, Number(settings.turnReward || 0));
  const directScore = directPath.length - directTurns * turnReward;
  const waypointScore = waypointPath.length - waypointTurns * turnReward;
  return waypointScore <= directScore ? waypointPath : directPath;
}

// Count direction changes along a path.
function countRoadPathTurns(path) {
  if (!Array.isArray(path) || path.length < 3) {
    return 0;
  }
  let turns = 0;
  let prevDx = null;
  let prevDy = null;
  for (let i = 1; i < path.length; i += 1) {
    const dx = Math.sign(Number(path[i].x || 0) - Number(path[i - 1].x || 0));
    const dy = Math.sign(Number(path[i].y || 0) - Number(path[i - 1].y || 0));
    if (prevDx !== null && prevDy !== null && (dx !== prevDx || dy !== prevDy)) {
      turns += 1;
    }
    prevDx = dx;
    prevDy = dy;
  }
  return turns;
}

// Measure maximum perpendicular deviation from the link baseline.
function getRoadPathMaxLineDeviation(path) {
  if (!Array.isArray(path) || path.length < 2) {
    return 0;
  }
  const start = path[0];
  const end = path[path.length - 1];
  const x1 = Number(start.x || 0);
  const y1 = Number(start.y || 0);
  const x2 = Number(end.x || 0);
  const y2 = Number(end.y || 0);
  const denominator = Math.hypot(x2 - x1, y2 - y1);
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  let maxDeviation = 0;
  for (const point of path) {
    const x = Number(point.x || 0);
    const y = Number(point.y || 0);
    const distance =
      Math.abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1) /
      denominator;
    if (distance > maxDeviation) {
      maxDeviation = distance;
    }
  }
  return maxDeviation;
}

// Find a path with plain BFS (legacy mode, no weighted style costs).
function findRoadPathWithAvoidBfs(
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
    if (!isSpawnableTile(state, x, y)) {
      return false;
    }
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

// Find a weighted path with terrain/style costs for more organic road lines.
function findRoadPathWithAvoidWeighted(
  state,
  roads,
  width,
  height,
  startX,
  startY,
  goalX,
  goalY,
  blockedSet,
  softPenaltySet,
  parallelAvoidRadius,
  parallelBuffer,
  pathStyle,
  searchSeed,
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
    if (!isSpawnableTile(state, x, y)) {
      return false;
    }
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
    return !(type && blockedSet && blockedSet.has(type));
  };

  const size = width * height;
  const prev = new Int32Array(size);
  const prevDir = new Int8Array(size);
  const straightRun = new Uint16Array(size);
  const gScore = new Float64Array(size);
  const fScore = new Float64Array(size);
  for (let i = 0; i < size; i += 1) {
    prev[i] = -1;
    prevDir[i] = -1;
    straightRun[i] = 0;
    gScore[i] = Number.POSITIVE_INFINITY;
    fScore[i] = Number.POSITIVE_INFINITY;
  }

  const startIndex = startY * width + startX;
  const goalIndex = goalY * width + goalX;
  gScore[startIndex] = 0;
  fScore[startIndex] =
    pathStyle.heuristicWeight
    * (Math.abs(startX - goalX) + Math.abs(startY - goalY));
  const heap = [];
  pushRoadQueue(heap, { index: startIndex, score: fScore[startIndex] });

  while (heap.length > 0) {
    const current = popRoadQueue(heap);
    if (!current) {
      break;
    }
    const index = current.index;
    if (current.score > fScore[index]) {
      continue;
    }
    if (index === goalIndex) {
      break;
    }
    const x = index % width;
    const y = Math.floor(index / width);
    const incomingDir = prevDir[index];
    for (let stepIndex = 0; stepIndex < NEIGHBOR_STEPS.length; stepIndex += 1) {
      const step = NEIGHBOR_STEPS[stepIndex];
      const nx = x + step.dx;
      const ny = y + step.dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }
      if (!isPassable(nx, ny)) {
        continue;
      }
      const nextIndex = ny * width + nx;
      const terrainType = getTerrainTypeAt(state, nx, ny);
      let stepCost = 1 + getRoadTerrainPenalty(pathStyle, terrainType);
      if (terrainType && softPenaltySet && softPenaltySet.has(terrainType)) {
        stepCost += Number(pathStyle.softAvoidPenalty || 0);
      }
      if (pathStyle.noiseWeight > 0) {
        const noise = sampleRoadPathNoise(
          nx,
          ny,
          Number(pathStyle.noiseScale || 0.16),
          searchSeed,
        );
        stepCost += noise * pathStyle.noiseWeight;
      }

      let nextStraightRun = 1;
      if (incomingDir >= 0) {
        if (incomingDir === stepIndex) {
          nextStraightRun = Number(straightRun[index] || 0) + 1;
          if (
            nextStraightRun > pathStyle.straightStepThreshold
            && pathStyle.straightStepPenalty > 0
          ) {
            stepCost +=
              (nextStraightRun - pathStyle.straightStepThreshold)
              * pathStyle.straightStepPenalty;
          }
        } else if (pathStyle.turnPenalty > 0) {
          stepCost += pathStyle.turnPenalty;
        }
      }

      const tentative = gScore[index] + stepCost;
      if (tentative >= gScore[nextIndex]) {
        continue;
      }
      prev[nextIndex] = index;
      prevDir[nextIndex] = stepIndex;
      straightRun[nextIndex] = nextStraightRun;
      gScore[nextIndex] = tentative;
      const heuristic = pathStyle.heuristicWeight
        * (Math.abs(nx - goalX) + Math.abs(ny - goalY));
      const score = tentative + heuristic;
      fScore[nextIndex] = score;
      pushRoadQueue(heap, { index: nextIndex, score });
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

// Return terrain penalty for weighted road pathing.
function getRoadTerrainPenalty(pathStyle, terrainType) {
  if (!terrainType || !pathStyle || !pathStyle.terrainPenalty) {
    return 0;
  }
  const value = Number(pathStyle.terrainPenalty[terrainType] || 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

// Build a deterministic seed for road path variation.
function buildRoadSearchSeed(state, linkKey, seedOffset) {
  const terrainSeed = state && state.terrain && Number.isFinite(state.terrain.seed)
    ? Math.floor(Number(state.terrain.seed))
    : 0;
  return terrainSeed + hashRoadString(String(linkKey || 'road')) + Math.floor(Number(seedOffset || 0));
}

// Sample smooth deterministic noise for road cost variation.
function sampleRoadPathNoise(x, y, scale, seed) {
  const fx = x * Math.max(0.001, Number(scale || 0.16));
  const fy = y * Math.max(0.001, Number(scale || 0.16));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smoothStep(fx - x0);
  const ty = smoothStep(fy - y0);
  const n00 = hashRoadNoise(x0, y0, seed);
  const n10 = hashRoadNoise(x0 + 1, y0, seed);
  const n01 = hashRoadNoise(x0, y0 + 1, seed);
  const n11 = hashRoadNoise(x0 + 1, y0 + 1, seed);
  const nx0 = n00 + (n10 - n00) * tx;
  const nx1 = n01 + (n11 - n01) * tx;
  const value = nx0 + (nx1 - nx0) * ty;
  return clamp(value, 0, 1);
}

// Smooth interpolation curve for value-noise blending.
function smoothStep(t) {
  const x = clamp(Number(t || 0), 0, 1);
  return x * x * (3 - 2 * x);
}

// Hash integer coordinates to a deterministic [0,1] value.
function hashRoadNoise(x, y, seed) {
  let h = Math.floor(Number(seed || 0)) | 0;
  h ^= Math.imul((x | 0) + 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul((y | 0) + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2d);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967295;
}

// Hash a string key to a deterministic 32-bit integer.
function hashRoadString(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// Push a node into the min-heap queue used by weighted path search.
function pushRoadQueue(heap, node) {
  heap.push(node);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = Math.floor((i - 1) / 2);
    if (heap[parent].score <= heap[i].score) {
      break;
    }
    const tmp = heap[parent];
    heap[parent] = heap[i];
    heap[i] = tmp;
    i = parent;
  }
}

// Pop the node with the smallest score from the min-heap queue.
function popRoadQueue(heap) {
  if (!Array.isArray(heap) || heap.length === 0) {
    return null;
  }
  const root = heap[0];
  const tail = heap.pop();
  if (heap.length === 0 || !tail) {
    return root;
  }
  heap[0] = tail;
  let i = 0;
  while (true) {
    const left = i * 2 + 1;
    const right = i * 2 + 2;
    let smallest = i;
    if (left < heap.length && heap[left].score < heap[smallest].score) {
      smallest = left;
    }
    if (right < heap.length && heap[right].score < heap[smallest].score) {
      smallest = right;
    }
    if (smallest === i) {
      break;
    }
    const tmp = heap[i];
    heap[i] = heap[smallest];
    heap[smallest] = tmp;
    i = smallest;
  }
  return root;
}

function isWaterTerrain(roadsConfig, terrainType) {
  if (!terrainType || !roadsConfig || !Array.isArray(roadsConfig.waterTerrain)) {
    return false;
  }
  return roadsConfig.waterTerrain.includes(terrainType);
}

function findRoadAnchor(state, roads, runtime, pos, radius, target) {
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

  if (isRoad(startX, startY) && isSpawnableTile(state, startX, startY)) {
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
      if (x1 >= 0
          && y1 >= 0
          && x1 < width
          && y1 < height
          && isRoad(x1, y1)
          && isSpawnableTile(state, x1, y1)) {
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
        if (x2 >= 0
            && y2 >= 0
            && x2 < width
            && y2 < height
            && isRoad(x2, y2)
            && isSpawnableTile(state, x2, y2)) {
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
    if (!isSpawnableTile(state, x, y)) {
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
    roads.version = Math.max(0, Number(roads.version || 0)) + 1;
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
