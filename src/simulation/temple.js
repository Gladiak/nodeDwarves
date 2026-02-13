'use strict';

const { clamp } = require('../utils');
const { canTempleAdvanceByLegitimacy, getSchismDoctrine } = require('./schism');

const DEFAULT_PRESTIGE_TIERS = [
  { name: 'Unproven', min: 0 },
  { name: 'Stonebound', min: 250 },
  { name: 'Hallkeeper', min: 700 },
  { name: 'Ancestor Voice', min: 1500 },
  { name: 'Eternal Citadel', min: 3000 },
];

const DEFAULT_WATER_TERRAINS = new Set(['river', 'lake']);
const DEFAULT_HIGHLAND_TERRAINS = new Set(['mountain', 'hill', 'stone']);
const TEMPLE_DOCTRINE_PATHS = ['austerity', 'revelry'];

// Resolve Temple of Ancestors config.
function getTempleConfig(config) {
  const structures = (config && config.structures) || {};
  return (structures && structures.temple_of_ancestors) || {};
}

// Resolve doctrine-path config for temple branching.
function getTempleDoctrinePathConfig(config) {
  const temple = getTempleConfig(config);
  const doctrinePath = temple && temple.doctrine_path && typeof temple.doctrine_path === 'object'
    ? temple.doctrine_path
    : {};
  return doctrinePath;
}

// Resolve prestige config.
function getPrestigeConfig(config) {
  return (config && config.prestige) || {};
}

// Normalize temple doctrine path ids.
function normalizeTempleDoctrinePath(rawPath) {
  const value = String(rawPath || '').toLowerCase();
  if (TEMPLE_DOCTRINE_PATHS.includes(value)) {
    return value;
  }
  return null;
}

// Resolve normalized doctrine-path profile for active temple branch.
function getTempleDoctrinePathProfile(config, doctrinePath) {
  const path = normalizeTempleDoctrinePath(doctrinePath);
  const doctrineConfig = getTempleDoctrinePathConfig(config);
  if (doctrineConfig.enabled === false || !path) {
    return {
      path: null,
      buildCostMultiplier: 1,
      buildTicksMultiplier: 1,
      prestigeMultiplier: 1,
      outputBonusMultiplier: 1,
      needDecayReductionMultiplier: 1,
      raidDefenseBonusMultiplier: 1,
    };
  }
  const branch = doctrineConfig[path] && typeof doctrineConfig[path] === 'object'
    ? doctrineConfig[path]
    : {};
  const effects = branch.effects && typeof branch.effects === 'object'
    ? branch.effects
    : {};
  return {
    path,
    buildCostMultiplier: Math.max(0.1, Number(branch.buildCostMultiplier ?? 1)),
    buildTicksMultiplier: Math.max(0.1, Number(branch.buildTicksMultiplier ?? 1)),
    prestigeMultiplier: Math.max(0, Number(branch.prestigeMultiplier ?? 1)),
    outputBonusMultiplier: Math.max(0, Number(effects.outputBonusMultiplier ?? 1)),
    needDecayReductionMultiplier: Math.max(0, Number(effects.needDecayReductionMultiplier ?? 1)),
    raidDefenseBonusMultiplier: Math.max(0, Number(effects.raidDefenseBonusMultiplier ?? 1)),
  };
}

// Resolve current doctrine path; when missing, pick according to config policy.
function resolveTempleDoctrinePath(state, config, stageNumber) {
  const temple = ensureTempleState(state, config);
  if (!temple || temple.enabled === false) {
    return null;
  }
  const doctrineConfig = getTempleDoctrinePathConfig(config);
  if (doctrineConfig.enabled === false) {
    temple.doctrinePath = null;
    return null;
  }
  const current = normalizeTempleDoctrinePath(temple.doctrinePath);
  if (current) {
    return current;
  }
  const defaultPathRaw = String(doctrineConfig.default_path || 'follow_schism').toLowerCase();
  let picked = null;
  if (defaultPathRaw === 'follow_schism') {
    picked = normalizeTempleDoctrinePath(getSchismDoctrine(state));
  } else {
    picked = normalizeTempleDoctrinePath(defaultPathRaw);
  }
  if (!picked) {
    picked = 'austerity';
  }
  temple.doctrinePath = picked;
  temple.doctrinePathChosenTick = Number.isFinite(Number(state && state.tick))
    ? Math.max(0, Number(state.tick || 0))
    : 0;
  temple.history.push({
    stage: Math.max(0, Math.floor(Number(stageNumber || 0))),
    tick: Number(state && state.tick || 0),
    doctrinePath: picked,
    marker: 'doctrine_lock',
  });
  return picked;
}

// Scale a temple stage cost map with deterministic integer rounding.
function scaleTempleCostMap(costMap, multiplierRaw) {
  const scaled = {};
  const multiplier = Math.max(0.1, Number(multiplierRaw || 1));
  const source = costMap && typeof costMap === 'object' ? costMap : {};
  for (const [resource, amountRaw] of Object.entries(source)) {
    const amount = Number(amountRaw || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }
    scaled[resource] = Math.max(1, Math.round(amount * multiplier));
  }
  return scaled;
}

// Keep only valid positive costs.
function normalizeCostMap(cost) {
  const normalized = {};
  if (!cost || typeof cost !== 'object') {
    return normalized;
  }
  for (const [resource, amountRaw] of Object.entries(cost)) {
    const amount = Number(amountRaw || 0);
    if (Number.isFinite(amount) && amount > 0) {
      normalized[resource] = amount;
    }
  }
  return normalized;
}

// Normalize stage effects into explicit numeric fields.
function normalizeStageEffects(effects) {
  const source = effects && typeof effects === 'object' ? effects : {};
  const outputBonus = Number(source.outputBonus ?? source.output_bonus ?? 0);
  const needDecayReduction = Number(
    source.needDecayReduction ?? source.need_decay_reduction ?? 0,
  );
  const raidDefenseBonus = Number(
    source.raidDefenseBonus ?? source.raid_defense_bonus ?? 0,
  );

  return {
    outputBonus: Number.isFinite(outputBonus) ? outputBonus : 0,
    needDecayReduction: clamp(
      Number.isFinite(needDecayReduction) ? needDecayReduction : 0,
      0,
      0.95,
    ),
    raidDefenseBonus: clamp(
      Number.isFinite(raidDefenseBonus) ? raidDefenseBonus : 0,
      0,
      0.95,
    ),
  };
}

// Normalize one temple stage entry.
function normalizeTempleStage(stage, index) {
  const source = stage && typeof stage === 'object' ? stage : {};
  const stageId = Math.max(1, Math.floor(Number(source.id || index + 1)));
  const buildTicks = Math.max(1, Math.floor(Number(source.buildTicks || 1)));
  const radius = Math.max(0, Math.floor(Number(source.radius || 0)));
  const prestige = Math.max(0, Number(source.prestige || 0));
  const prestigePerTick = Math.max(0, Number(source.prestigePerTick || 0));

  return {
    id: stageId,
    name: String(source.name || `Stage ${stageId}`),
    radius,
    buildTicks,
    buildCost: normalizeCostMap(source.buildCost),
    prestige,
    prestigePerTick,
    symbol: typeof source.symbol === 'string' && source.symbol.length > 0
      ? source.symbol[0]
      : null,
    outlineSymbol: typeof source.outlineSymbol === 'string' && source.outlineSymbol.length > 0
      ? source.outlineSymbol[0]
      : null,
    effects: normalizeStageEffects(source.effects),
  };
}

// Resolve and normalize all temple stages.
function getTempleStages(config) {
  const temple = getTempleConfig(config);
  const raw = Array.isArray(temple.stages) ? temple.stages : [];
  return raw.map((stage, index) => normalizeTempleStage(stage, index));
}

// Resolve one stage by its 1-based id.
function getTempleStageConfig(config, stageId) {
  const stage = Math.max(1, Math.floor(Number(stageId || 0)));
  const stages = getTempleStages(config);
  return stages.find((entry) => entry.id === stage) || stages[stage - 1] || null;
}

// Resolve the max configured temple radius.
function getTempleMaxRadius(config) {
  const stages = getTempleStages(config);
  let radius = 0;
  for (const stage of stages) {
    radius = Math.max(radius, Math.max(0, Number(stage.radius || 0)));
  }
  return radius;
}

// Resolve the active reservation radius based on reserveMaxFootprint policy.
function getTempleReservationRadius(config, templeStage) {
  const templeConfig = getTempleConfig(config);
  if (templeConfig.reserveMaxFootprint !== false) {
    return getTempleMaxRadius(config);
  }
  const stage = getTempleStageConfig(config, templeStage);
  return Math.max(0, Number(stage && stage.radius || 0));
}

// Resolve the max configured stage number.
function getTempleMaxStage(config) {
  return getTempleStages(config).length;
}

// Build initial temple state.
function createTempleState(config) {
  const temple = getTempleConfig(config);
  const maxStage = getTempleMaxStage(config);
  const startStageRaw = Math.floor(Number(temple.startStage || 0));
  const startStage = clamp(startStageRaw, 0, maxStage);
  return {
    enabled: temple.enabled !== false,
    stage: startStage,
    maxStage,
    doctrinePath: null,
    doctrinePathChosenTick: null,
    site: null,
    blockedReason: null,
    lastBuildTick: null,
    completedAtTick: null,
    history: [],
  };
}

// Build initial prestige state.
function createPrestigeState(config) {
  const prestige = getPrestigeConfig(config);
  return {
    enabled: prestige.enabled !== false,
    total: 0,
    cycle: 0,
    rank: resolvePrestigeRank(0, config),
    bySource: {},
    cyclesCompleted: 0,
  };
}

// Ensure temple state exists and is internally consistent.
function ensureTempleState(state, config) {
  if (!state) {
    return null;
  }
  if (!state.temple || typeof state.temple !== 'object') {
    state.temple = createTempleState(config);
  }
  const maxStage = getTempleMaxStage(config);
  state.temple.enabled = getTempleConfig(config).enabled !== false;
  state.temple.maxStage = maxStage;
  state.temple.stage = clamp(Math.floor(Number(state.temple.stage || 0)), 0, maxStage);
  state.temple.doctrinePath = normalizeTempleDoctrinePath(state.temple.doctrinePath);
  if (!Number.isFinite(Number(state.temple.doctrinePathChosenTick))) {
    state.temple.doctrinePathChosenTick = null;
  }
  if (!Array.isArray(state.temple.history)) {
    state.temple.history = [];
  }
  if (state.temple.stage >= maxStage && maxStage > 0 && !state.temple.completedAtTick) {
    state.temple.completedAtTick = Number(state.tick || 0);
  }
  return state.temple;
}

// Ensure prestige state exists and rank is current.
function ensurePrestigeState(state, config) {
  if (!state) {
    return null;
  }
  if (!state.prestige || typeof state.prestige !== 'object') {
    state.prestige = createPrestigeState(config);
  }
  state.prestige.enabled = getPrestigeConfig(config).enabled !== false;
  state.prestige.total = Math.max(0, Number(state.prestige.total || 0));
  state.prestige.cycle = Math.max(0, Number(state.prestige.cycle || 0));
  state.prestige.cyclesCompleted = Math.max(0, Number(state.prestige.cyclesCompleted || 0));
  if (!state.prestige.bySource || typeof state.prestige.bySource !== 'object') {
    state.prestige.bySource = {};
  }
  state.prestige.rank = resolvePrestigeRank(state.prestige.total, config);
  return state.prestige;
}

// Resolve prestige tiers sorted by threshold.
function getPrestigeTiers(config) {
  const prestige = getPrestigeConfig(config);
  const raw = Array.isArray(prestige.tiers) && prestige.tiers.length > 0
    ? prestige.tiers
    : DEFAULT_PRESTIGE_TIERS;
  const normalized = raw
    .map((tier, index) => {
      const entry = tier && typeof tier === 'object' ? tier : {};
      return {
        name: String(entry.name || `Tier ${index + 1}`),
        min: Math.max(0, Number(entry.min || 0)),
      };
    })
    .sort((a, b) => a.min - b.min);
  return normalized.length > 0 ? normalized : DEFAULT_PRESTIGE_TIERS.slice();
}

// Resolve the prestige rank label for a numeric value.
function resolvePrestigeRank(totalValue, config) {
  const total = Math.max(0, Number(totalValue || 0));
  const tiers = getPrestigeTiers(config);
  let rank = tiers[0] ? tiers[0].name : 'Unproven';
  for (const tier of tiers) {
    if (total >= tier.min) {
      rank = tier.name;
    } else {
      break;
    }
  }
  return rank;
}

// Add prestige points and keep rank metadata synchronized.
function awardPrestige(state, config, amountRaw, source) {
  const prestige = ensurePrestigeState(state, config);
  if (!prestige || prestige.enabled === false) {
    return 0;
  }
  const amount = Math.max(0, Number(amountRaw || 0));
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }
  prestige.total += amount;
  prestige.cycle += amount;
  const key = source ? String(source) : 'unknown';
  prestige.bySource[key] = Number(prestige.bySource[key] || 0) + amount;
  prestige.rank = resolvePrestigeRank(prestige.total, config);
  return amount;
}

// Build a flood-fill distance map for nearest terrain type in targetSet.
function buildDistanceMapToTerrain(types, width, height, targetSet) {
  const total = width * height;
  const distances = new Array(total).fill(Infinity);
  const queue = [];
  let head = 0;

  for (let y = 0; y < height; y += 1) {
    const row = types[y] || [];
    for (let x = 0; x < width; x += 1) {
      const type = row[x];
      if (!type || !targetSet.has(type)) {
        continue;
      }
      const index = y * width + x;
      distances[index] = 0;
      queue.push(index);
    }
  }

  const neighbors = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  while (head < queue.length) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    const base = distances[index];
    for (const neighbor of neighbors) {
      const nx = x + neighbor.dx;
      const ny = y + neighbor.dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }
      const nextIndex = ny * width + nx;
      const nextDistance = base + 1;
      if (nextDistance >= distances[nextIndex]) {
        continue;
      }
      distances[nextIndex] = nextDistance;
      queue.push(nextIndex);
    }
  }

  return distances;
}

// Compute map-aware village center used for distance guardrails.
function getVillageCenter(state, runtime) {
  const structures = Array.isArray(state && state.structures) ? state.structures : [];
  const houses = structures.filter((structure) => structure && structure.type === 'house');
  if (houses.length === 0) {
    return {
      x: Math.floor(Number(runtime && runtime.gridWidth || 0) / 2),
      y: Math.floor(Number(runtime && runtime.gridHeight || 0) / 2),
    };
  }

  let sumX = 0;
  let sumY = 0;
  for (const house of houses) {
    sumX += Number(house.x || 0);
    sumY += Number(house.y || 0);
  }

  return {
    x: Math.round(sumX / houses.length),
    y: Math.round(sumY / houses.length),
  };
}

// Iterate footprint cells using square or diamond topology.
function iterateFootprintCells(centerX, centerY, radius, shape, callback) {
  const safeRadius = Math.max(0, Math.floor(Number(radius || 0)));
  const mode = String(shape || 'square').toLowerCase();
  for (let dy = -safeRadius; dy <= safeRadius; dy += 1) {
    for (let dx = -safeRadius; dx <= safeRadius; dx += 1) {
      if (mode === 'diamond' && Math.abs(dx) + Math.abs(dy) > safeRadius) {
        continue;
      }
      callback(centerX + dx, centerY + dy, dx, dy);
    }
  }
}

// Check whether an absolute cell belongs to the configured temple footprint.
function isTempleFootprintCell(state, config, x, y) {
  const temple = state && state.temple;
  if (!temple || !temple.enabled || !temple.site) {
    return false;
  }
  const siteX = Number(temple.site.x);
  const siteY = Number(temple.site.y);
  if (!Number.isFinite(siteX) || !Number.isFinite(siteY)) {
    return false;
  }

  const templeConfig = getTempleConfig(config);
  const reserveRadius = getTempleReservationRadius(config, temple.stage);
  const shape = templeConfig.footprintShape || 'square';

  let inside = false;
  iterateFootprintCells(siteX, siteY, reserveRadius, shape, (cellX, cellY) => {
    if (inside) {
      return;
    }
    if (cellX === x && cellY === y) {
      inside = true;
    }
  });
  return inside;
}

// Check whether a footprint can be reserved at a map location.
function canReserveTempleFootprint(state, config, runtime, centerX, centerY, radius, avoidTerrainSet) {
  const terrain = state && state.terrain;
  const width = Number(runtime && runtime.gridWidth || 0);
  const height = Number(runtime && runtime.gridHeight || 0);
  if (!terrain || !Array.isArray(terrain.types) || width <= 0 || height <= 0) {
    return false;
  }

  const spawnable = Array.isArray(terrain.spawnable) ? terrain.spawnable : null;
  const structures = Array.isArray(state.structures) ? state.structures : [];
  const nodes = Array.isArray(state.nodes) ? state.nodes : [];
  const jobs = Array.isArray(state.jobs) ? state.jobs : [];
  const shape = getTempleConfig(config).footprintShape || 'square';
  const activeBuildTargets = new Set();
  for (const job of jobs) {
    if (!job || job.type !== 'build' || !job.target) {
      continue;
    }
    if (job.structureType === 'temple_of_ancestors') {
      continue;
    }
    const jobX = Math.floor(Number(job.target.x));
    const jobY = Math.floor(Number(job.target.y));
    if (!Number.isFinite(jobX) || !Number.isFinite(jobY)) {
      continue;
    }
    activeBuildTargets.add(`${jobX},${jobY}`);
  }
  let valid = true;

  iterateFootprintCells(centerX, centerY, radius, shape, (x, y) => {
    if (!valid) {
      return;
    }
    if (x < 0 || y < 0 || x >= width || y >= height) {
      valid = false;
      return;
    }
    if (spawnable && (!spawnable[y] || !spawnable[y][x])) {
      valid = false;
      return;
    }
    const type = terrain.types[y] ? terrain.types[y][x] : null;
    if (type && avoidTerrainSet.has(type)) {
      valid = false;
      return;
    }
    if (activeBuildTargets.has(`${x},${y}`)) {
      valid = false;
      return;
    }
    if (structures.some((structure) => structure.x === x && structure.y === y)) {
      valid = false;
      return;
    }
    if (nodes.some((node) => node.x === x && node.y === y)) {
      valid = false;
    }
  });

  return valid;
}

// Build distance score with min/max clipping and an optional preferred target distance.
function scoreDistance(distance, minDistance, maxDistance, targetDistance) {
  if (!Number.isFinite(distance)) {
    return 0;
  }
  if (distance < minDistance) {
    return 0;
  }
  if (maxDistance > 0 && distance > maxDistance) {
    return 0;
  }

  if (!Number.isFinite(targetDistance) || targetDistance <= 0) {
    return 1;
  }

  const spread = Math.max(1, targetDistance);
  const score = 1 - Math.abs(distance - targetDistance) / spread;
  return clamp(score, 0, 1);
}

// Compute local highland density score around a candidate cell.
function scoreLocalHighlandDensity(types, width, height, x, y, highlandSet) {
  const radius = 2;
  let total = 0;
  let highland = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }
      total += 1;
      const type = types[ny] ? types[ny][nx] : null;
      if (type && highlandSet.has(type)) {
        highland += 1;
      }
    }
  }
  if (total <= 0) {
    return 0;
  }
  return highland / total;
}

// Select a deterministic temple site from terrain topology and biome preferences.
function selectTempleSite(state, config, runtime) {
  const temple = getTempleConfig(config);
  const terrain = state && state.terrain;
  const width = Number(runtime && runtime.gridWidth || 0);
  const height = Number(runtime && runtime.gridHeight || 0);
  if (!terrain || !Array.isArray(terrain.types) || width <= 0 || height <= 0) {
    return null;
  }

  const siteConfig = temple.site && typeof temple.site === 'object' ? temple.site : {};
  const avoidTerrainSet = new Set(
    Array.isArray(siteConfig.avoidTerrain) && siteConfig.avoidTerrain.length > 0
      ? siteConfig.avoidTerrain.map((entry) => String(entry))
      : ['river', 'lake'],
  );
  const preferTerrain = Array.isArray(siteConfig.preferTerrain) && siteConfig.preferTerrain.length > 0
    ? siteConfig.preferTerrain.map((entry) => String(entry))
    : ['mountain', 'hill', 'stone'];
  const preferTerrainMap = new Map();
  for (let index = 0; index < preferTerrain.length; index += 1) {
    const terrainType = preferTerrain[index];
    const score = 1 - index / Math.max(1, preferTerrain.length);
    preferTerrainMap.set(terrainType, score);
  }

  const highlandSet = new Set(
    Array.isArray(siteConfig.highlandTerrain) && siteConfig.highlandTerrain.length > 0
      ? siteConfig.highlandTerrain.map((entry) => String(entry))
      : Array.from(DEFAULT_HIGHLAND_TERRAINS),
  );
  const waterTerrainSet = new Set(
    Array.isArray(siteConfig.waterTerrain) && siteConfig.waterTerrain.length > 0
      ? siteConfig.waterTerrain.map((entry) => String(entry))
      : Array.from(DEFAULT_WATER_TERRAINS),
  );

  const distanceToWater = buildDistanceMapToTerrain(terrain.types, width, height, waterTerrainSet);
  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  const villageCenter = getVillageCenter(state, runtime);

  const minVillageDistance = Math.max(0, Math.floor(Number(siteConfig.minDistanceFromVillage ?? 0)));
  const maxVillageDistance = Math.max(0, Math.floor(Number(siteConfig.maxDistanceFromVillage ?? 0)));
  const targetVillageDistance = Math.max(0, Number(siteConfig.targetDistanceFromVillage ?? 0));
  const targetWaterDistance = Math.max(0, Number(siteConfig.waterDistanceTarget ?? 0));
  const padding = Math.max(0, Math.floor(Number(siteConfig.searchPadding ?? 0)));

  const terrainWeight = clamp(Number(siteConfig.terrainWeight ?? 0.45), 0, 2);
  const highlandWeight = clamp(Number(siteConfig.highlandWeight ?? 0.35), 0, 2);
  const waterWeight = clamp(Number(siteConfig.waterWeight ?? 0.2), 0, 2);
  const centerWeight = clamp(Number(siteConfig.centerWeight ?? 0.1), 0, 2);
  const villageWeight = clamp(Number(siteConfig.villageWeight ?? 0.25), 0, 2);

  const templeStage = Math.max(0, Math.floor(Number(state && state.temple && state.temple.stage || 0)));
  const footprintRadius = getTempleReservationRadius(config, templeStage);
  let best = null;

  for (let y = padding; y < height - padding; y += 1) {
    const row = terrain.types[y] || [];
    for (let x = padding; x < width - padding; x += 1) {
      const terrainType = row[x];
      if (!terrainType || avoidTerrainSet.has(terrainType)) {
        continue;
      }

      if (!canReserveTempleFootprint(state, config, runtime, x, y, footprintRadius, avoidTerrainSet)) {
        continue;
      }

      const villageDistance = Math.abs(x - villageCenter.x) + Math.abs(y - villageCenter.y);
      const villageScore = scoreDistance(
        villageDistance,
        minVillageDistance,
        maxVillageDistance,
        targetVillageDistance,
      );
      if (villageScore <= 0) {
        continue;
      }

      const waterDistance = distanceToWater[y * width + x];
      const waterScore = scoreDistance(waterDistance, 0, 0, targetWaterDistance || 6);
      const highlandScore = scoreLocalHighlandDensity(
        terrain.types,
        width,
        height,
        x,
        y,
        highlandSet,
      );

      const terrainScore = preferTerrainMap.has(terrainType)
        ? Number(preferTerrainMap.get(terrainType))
        : 0.15;

      const centerDistance = Math.abs(x - centerX) + Math.abs(y - centerY);
      const maxCenterDistance = Math.max(1, centerX + centerY);
      const centerScore = 1 - clamp(centerDistance / maxCenterDistance, 0, 1);

      const score =
        terrainScore * terrainWeight
        + highlandScore * highlandWeight
        + waterScore * waterWeight
        + centerScore * centerWeight
        + villageScore * villageWeight;

      if (
        !best
        || score > best.score + 1e-6
        || (Math.abs(score - best.score) <= 1e-6 && villageDistance < best.villageDistance)
        || (
          Math.abs(score - best.score) <= 1e-6
          && villageDistance === best.villageDistance
          && (y < best.y || (y === best.y && x < best.x))
        )
      ) {
        best = {
          x,
          y,
          terrainType,
          score,
          villageDistance,
          waterDistance: Number.isFinite(waterDistance) ? waterDistance : null,
        };
      }
    }
  }

  return best;
}

// Ensure temple site exists and remains valid.
function ensureTempleSite(state, config, runtime) {
  const temple = ensureTempleState(state, config);
  if (!temple || temple.enabled === false) {
    return null;
  }
  if (!runtime || runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return null;
  }

  const reserveRadius = getTempleReservationRadius(config, temple.stage);
  const siteConfig = getTempleConfig(config).site || {};
  const avoidTerrainSet = new Set(
    Array.isArray(siteConfig.avoidTerrain) && siteConfig.avoidTerrain.length > 0
      ? siteConfig.avoidTerrain.map((entry) => String(entry))
      : ['river', 'lake'],
  );

  const current = temple.site;
  if (
    current
    && Number.isFinite(current.x)
    && Number.isFinite(current.y)
    && canReserveTempleFootprint(
      state,
      config,
      runtime,
      Math.floor(current.x),
      Math.floor(current.y),
      reserveRadius,
      avoidTerrainSet,
    )
  ) {
    temple.blockedReason = null;
    return {
      x: Math.floor(current.x),
      y: Math.floor(current.y),
      terrainType: current.terrainType || null,
    };
  }

  const selected = selectTempleSite(state, config, runtime);
  if (!selected) {
    temple.site = null;
    temple.blockedReason = 'no_valid_site';
    return null;
  }

  temple.site = {
    x: selected.x,
    y: selected.y,
    terrainType: selected.terrainType,
    score: selected.score,
    villageDistance: selected.villageDistance,
    waterDistance: selected.waterDistance,
  };
  temple.blockedReason = null;
  return temple.site;
}

// Check if stockpile satisfies all costs.
function hasCostInputs(stockpile, cost) {
  if (!cost || typeof cost !== 'object') {
    return true;
  }
  for (const [resource, amountRaw] of Object.entries(cost)) {
    const amount = Number(amountRaw || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }
    if (Number(stockpile && stockpile[resource] || 0) < amount) {
      return false;
    }
  }
  return true;
}

// Consume build costs from stockpile.
function consumeCostInputs(stockpile, cost) {
  if (!stockpile || !cost || typeof cost !== 'object') {
    return;
  }
  for (const [resource, amountRaw] of Object.entries(cost)) {
    const amount = Number(amountRaw || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }
    stockpile[resource] = Number(stockpile[resource] || 0) - amount;
  }
}

// Compute a stockpile ratio against configured targets.
function getStockpileRatioForTemple(state, config, resourceId) {
  const resources = (config && config.resources) || {};
  const baseTargets = state && state.resourceTargets
    ? state.resourceTargets
    : (resources.targets || resources.stockpile || {});
  const targetBase = Math.max(0, Number(baseTargets[resourceId] || 0));
  const perCapita = Math.max(0, Number((resources.targetsPerCapita || {})[resourceId] || 0));
  const population = Array.isArray(state && state.dwarves) ? state.dwarves.length : 0;
  const target = targetBase + perCapita * population;
  if (target <= 0) {
    return 1;
  }
  const current = Math.max(0, Number(state && state.stockpile && state.stockpile[resourceId] || 0));
  return clamp(current / target, 0, 1);
}

// Determine adult status with a lifeStage fallback.
function isAdultDwarf(dwarf, config) {
  if (!dwarf) {
    return false;
  }
  if (typeof dwarf.lifeStage === 'string') {
    return dwarf.lifeStage === 'adult' || dwarf.lifeStage === 'elder';
  }
  const population = (config && config.population) || {};
  const aging = population.aging || {};
  const adultAge = Math.max(0, Number(aging.adultAge || 0));
  return Number(dwarf.ageTicks || 0) >= adultAge;
}

// Count idle adults currently available for large constructions.
function countIdleAdults(state, config) {
  const dwarves = Array.isArray(state && state.dwarves) ? state.dwarves : [];
  let count = 0;
  for (const dwarf of dwarves) {
    if (!isAdultDwarf(dwarf, config)) {
      continue;
    }
    if (dwarf.expedition) {
      continue;
    }
    if (dwarf.job) {
      continue;
    }
    count += 1;
  }
  return count;
}

// Compute artifact completion ratio for optional temple unlock gates.
function getArtifactCompletionRatio(state, config) {
  const ruinsConfig = (config && config.ruins) || {};
  const pool = (ruinsConfig.artifacts && ruinsConfig.artifacts.pool) || {};
  const total = Object.keys(pool).length;
  if (total <= 0) {
    return 1;
  }
  const foundMap = state && state.ruins && state.ruins.artifactsFound
    ? state.ruins.artifactsFound
    : {};
  const found = Object.keys(foundMap).length;
  return clamp(found / total, 0, 1);
}

// Check temple build guardrails for the next stage.
function canStartTempleBuild(state, config, nextStage) {
  const templeConfig = getTempleConfig(config);
  const stage = nextStage || null;
  if (!stage) {
    return false;
  }

  const population = Array.isArray(state && state.dwarves) ? state.dwarves.length : 0;
  const minPopulation = Math.max(0, Number(templeConfig.buildMinPopulation || 0));
  if (population < minPopulation) {
    return false;
  }

  const cycleStats = state && state.cycleStats ? state.cycleStats : {};
  const cycleCount = Math.max(0, Number(cycleStats.count || 0));
  const minCycles = Math.max(0, Number(templeConfig.buildMinCycles || 0));
  if (cycleCount < minCycles) {
    return false;
  }

  const minIdleAdults = Math.max(0, Number(templeConfig.buildMinIdleAdults || 0));
  if (minIdleAdults > 0 && countIdleAdults(state, config) < minIdleAdults) {
    return false;
  }

  const minRatios = templeConfig.buildMinResources || {};
  for (const [resource, ratioRaw] of Object.entries(minRatios)) {
    const requiredRatio = clamp(Number(ratioRaw || 0), 0, 1);
    if (requiredRatio <= 0) {
      continue;
    }
    const ratio = getStockpileRatioForTemple(state, config, resource);
    if (ratio < requiredRatio) {
      return false;
    }
  }

  const minArtifactRatio = clamp(Number(templeConfig.minArtifactCompletionRatio || 0), 0, 1);
  if (minArtifactRatio > 0) {
    const artifactRatio = getArtifactCompletionRatio(state, config);
    if (artifactRatio < minArtifactRatio) {
      const stageNumber = Math.max(1, Math.floor(Number(stage.id || nextStage.id || 1)));
      if (!canTempleAdvanceByLegitimacy(state, config, stageNumber)) {
        return false;
      }
    }
  }

  return true;
}

// Create a build job for the next temple stage.
function createTempleBuildJob(state, config, runtime, reservedPositions) {
  const temple = ensureTempleState(state, config);
  if (!temple || temple.enabled === false) {
    return null;
  }

  const maxStage = getTempleMaxStage(config);
  if (maxStage <= 0 || temple.stage >= maxStage) {
    return null;
  }

  const hasActiveTempleJob = Array.isArray(state.jobs)
    && state.jobs.some((job) => job && job.type === 'build' && job.structureType === 'temple_of_ancestors');
  if (hasActiveTempleJob) {
    return null;
  }

  const nextStageNumber = temple.stage + 1;
  const stage = getTempleStageConfig(config, nextStageNumber);
  if (!stage) {
    return null;
  }
  const doctrinePath = resolveTempleDoctrinePath(state, config, nextStageNumber);
  const doctrineProfile = getTempleDoctrinePathProfile(config, doctrinePath);
  const stageBuildCost = scaleTempleCostMap(stage.buildCost, doctrineProfile.buildCostMultiplier);
  const stageBuildTicks = Math.max(
    1,
    Math.round(Number(stage.buildTicks || 1) * doctrineProfile.buildTicksMultiplier),
  );

  const site = ensureTempleSite(state, config, runtime);
  if (!site) {
    return null;
  }

  const key = `${site.x},${site.y}`;
  if (reservedPositions && reservedPositions.has(key)) {
    return null;
  }

  if (!canStartTempleBuild(state, config, stage)) {
    return null;
  }

  if (!hasCostInputs(state.stockpile, stageBuildCost)) {
    return null;
  }

  consumeCostInputs(state.stockpile, stageBuildCost);

  return {
    id: `job_${state.jobCounter++}`,
    type: 'build',
    structureType: 'temple_of_ancestors',
    templeStage: nextStageNumber,
    templeStageName: stage.name,
    templeDoctrinePath: doctrinePath,
    target: { x: site.x, y: site.y },
    workRemaining: stageBuildTicks,
    totalWork: stageBuildTicks,
    dwarfId: null,
    cost: { ...stageBuildCost },
  };
}

// Complete one temple stage when a build job resolves.
function completeTempleStageBuild(state, config, job) {
  const temple = ensureTempleState(state, config);
  if (!temple || temple.enabled === false) {
    return { completed: false };
  }

  const stageNumber = Math.max(
    temple.stage + 1,
    Math.floor(Number(job && job.templeStage || temple.stage + 1)),
  );
  const stage = getTempleStageConfig(config, stageNumber);
  if (!stage) {
    return { completed: false };
  }

  const doctrinePath = normalizeTempleDoctrinePath(
    job && job.templeDoctrinePath
      ? job.templeDoctrinePath
      : temple.doctrinePath,
  ) || resolveTempleDoctrinePath(state, config, stageNumber);
  const doctrineProfile = getTempleDoctrinePathProfile(config, doctrinePath);
  temple.doctrinePath = doctrinePath;

  temple.stage = clamp(stageNumber, 0, temple.maxStage);
  temple.lastBuildTick = Number(state && state.tick || 0);
  if (temple.stage >= temple.maxStage && temple.maxStage > 0) {
    temple.completedAtTick = temple.lastBuildTick;
  }

  const stagePrestige = awardPrestige(
    state,
    config,
    Number(stage.prestige || 0) * doctrineProfile.prestigeMultiplier,
    `temple_stage_${stageNumber}`,
  );
  let completionPrestige = 0;
  if (temple.stage >= temple.maxStage && temple.maxStage > 0) {
    const templeConfig = getTempleConfig(config);
    const finalPrestige = Math.max(0, Number(templeConfig.finalCompletionPrestige || 0));
    completionPrestige = awardPrestige(state, config, finalPrestige, 'temple_completion');
  }

  temple.history.push({
    stage: stageNumber,
    tick: Number(state && state.tick || 0),
    prestige: stagePrestige,
    doctrinePath: doctrinePath || null,
  });

  return {
    completed: true,
    stage: stageNumber,
    maxStage: temple.maxStage,
    stageName: stage.name,
    doctrinePath: doctrinePath || null,
    stagePrestige,
    completionPrestige,
    fullyCompleted: temple.stage >= temple.maxStage && temple.maxStage > 0,
  };
}

// Resolve aggregate temple effects from completed stages.
function getTempleEffects(state, config) {
  const temple = ensureTempleState(state, config);
  const stages = getTempleStages(config);
  if (!temple || temple.enabled === false || temple.stage <= 0 || stages.length === 0) {
    return {
      outputBonus: 0,
      needDecayReduction: 0,
      raidDefenseBonus: 0,
    };
  }

  const completedStage = Math.min(temple.stage, stages.length);
  const doctrineProfile = getTempleDoctrinePathProfile(config, temple.doctrinePath);
  let outputBonus = 0;
  let needDecayReduction = 0;
  let raidDefenseBonus = 0;

  for (let i = 0; i < completedStage; i += 1) {
    const effects = stages[i].effects;
    outputBonus += Number(effects.outputBonus || 0) * doctrineProfile.outputBonusMultiplier;
    needDecayReduction += Number(effects.needDecayReduction || 0) * doctrineProfile.needDecayReductionMultiplier;
    raidDefenseBonus += Number(effects.raidDefenseBonus || 0) * doctrineProfile.raidDefenseBonusMultiplier;
  }

  return {
    outputBonus,
    needDecayReduction: clamp(needDecayReduction, 0, 0.95),
    raidDefenseBonus: clamp(raidDefenseBonus, 0, 0.95),
  };
}

// Resolve need-decay multiplier from temple effects.
function getTempleNeedDecayMultiplier(state, config) {
  const effects = getTempleEffects(state, config);
  return Math.max(0.05, 1 - effects.needDecayReduction);
}

// Resolve output multiplier from temple effects.
function getTempleOutputMultiplier(state, config, resourceId) {
  const templeConfig = getTempleConfig(config);
  const applyTo = Array.isArray(templeConfig.outputApplyTo)
    ? templeConfig.outputApplyTo
    : null;
  if (applyTo && resourceId && !applyTo.includes(resourceId)) {
    return 1;
  }
  const effects = getTempleEffects(state, config);
  return Math.max(0, 1 + effects.outputBonus);
}

// Resolve additive raid defense bonus from temple effects.
function getTempleRaidDefenseBonus(state, config) {
  const effects = getTempleEffects(state, config);
  return clamp(effects.raidDefenseBonus, 0, 0.95);
}

// Render-visible temple cells for current stage footprint.
function getTempleRenderTiles(state, config, runtime) {
  const temple = ensureTempleState(state, config);
  if (!temple || temple.enabled === false || !temple.site || temple.stage <= 0) {
    return [];
  }

  const siteX = Math.floor(Number(temple.site.x || 0));
  const siteY = Math.floor(Number(temple.site.y || 0));
  const width = Number(runtime && runtime.gridWidth || 0);
  const height = Number(runtime && runtime.gridHeight || 0);
  if (width <= 0 || height <= 0) {
    return [];
  }

  const stage = getTempleStageConfig(config, temple.stage);
  if (!stage) {
    return [];
  }

  const symbols = (config && config.symbols) || {};
  const coreSymbol = stage.symbol || symbols.temple_of_ancestors || 'A';
  const outlineSymbol = stage.outlineSymbol || symbols.temple_of_ancestors_outline || '+';
  const shape = getTempleConfig(config).footprintShape || 'square';
  const tiles = [];

  iterateFootprintCells(siteX, siteY, stage.radius, shape, (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }
    const isCenter = x === siteX && y === siteY;
    tiles.push({
      x,
      y,
      symbol: isCenter ? coreSymbol : outlineSymbol,
      colorKey: 'temple_of_ancestors',
    });
  });

  return tiles;
}

// Per-tick temple update (site validation + passive prestige accrual).
function updateTemple(state, config, runtime) {
  const temple = ensureTempleState(state, config);
  const prestige = ensurePrestigeState(state, config);
  if (!temple || !prestige || temple.enabled === false) {
    return;
  }

  ensureTempleSite(state, config, runtime);

  const stage = getTempleStageConfig(config, temple.stage);
  if (!stage || temple.stage <= 0) {
    return;
  }

  const passive = Math.max(0, Number(stage.prestigePerTick || 0));
  if (passive > 0) {
    awardPrestige(state, config, passive, 'temple_passive');
  }
}

// Carry prestige meta-progression across endgame cycle resets.
function carryTemplePrestigeAcrossCycle(state, nextState, config) {
  const from = ensurePrestigeState(state, config);
  const to = ensurePrestigeState(nextState, config);
  if (!from || !to || from.enabled === false) {
    return;
  }

  to.total = Math.max(0, Number(from.total || 0));
  to.bySource = { ...(from.bySource || {}) };
  to.cyclesCompleted = Math.max(0, Number(from.cyclesCompleted || 0)) + 1;
  to.cycle = 0;
  to.rank = resolvePrestigeRank(to.total, config);

  const cycleBonus = Math.max(0, Number(getPrestigeConfig(config).cycleResetBonus || 0));
  if (cycleBonus > 0) {
    awardPrestige(nextState, config, cycleBonus, 'cycle_reset');
  }
}

module.exports = {
  createTempleState,
  createPrestigeState,
  ensureTempleState,
  ensurePrestigeState,
  updateTemple,
  awardPrestige,
  resolvePrestigeRank,
  getTempleStages,
  getTempleStageConfig,
  createTempleBuildJob,
  completeTempleStageBuild,
  getTempleNeedDecayMultiplier,
  getTempleOutputMultiplier,
  getTempleRaidDefenseBonus,
  getTempleRenderTiles,
  carryTemplePrestigeAcrossCycle,
  isTempleFootprintCell,
};
