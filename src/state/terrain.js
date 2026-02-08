"use strict";

const { clamp } = require("../utils");

// Function: createTerrain.
function createTerrain(config, runtime, previousTerrain) {
  const display = (config && config.display) || {};
  const terrainConfig = display.terrain || {};
  if (terrainConfig.enabled === false) {
    return null;
  }

  const width = Math.max(0, Number(runtime.gridWidth || 0));
  const height = Math.max(0, Number(runtime.gridHeight || 0));
  if (width <= 0 || height <= 0) {
    return null;
  }

  const settings = normalizeTerrainSettings(terrainConfig);
  const seed = resolveTerrainSeed(settings.seed, previousTerrain, runtime);
  return createValleyTerrain(runtime, settings, seed, config);
}

// Function: createValleyTerrain.
function createValleyTerrain(runtime, settings, seed, config) {
  const width = Math.max(0, Number(runtime.gridWidth || 0));
  const height = Math.max(0, Number(runtime.gridHeight || 0));
  const valley = settings.valley;
  const warp = buildDomainWarp(valley.domainWarp, seed);
  const landmarks = buildLandmarkProfiles(
    width,
    height,
    valley.landmarks,
    seed,
    warp,
    valley,
  );
  const ridgeMaskMap = landmarks ? landmarks.ridgeMaskMap : null;
  const riverSpineGuide = landmarks ? landmarks.riverSpineGuide : null;
  const worldSpine = buildWorldSpineProfile(
    width,
    height,
    valley.worldSpine,
    seed,
    warp,
  );
  const rng = createTerrainRng(seed + 17);
  const macroClimate = buildMacroClimateMaps(
    width,
    height,
    valley.macroZones,
    seed,
    warp,
  );
  const macroRelief = macroClimate ? macroClimate.reliefMap : null;
  const macroMoisture = macroClimate ? macroClimate.moistureMap : null;
  const landmarkSuitability = buildLandmarkSuitabilityContext(
    width,
    height,
    riverSpineGuide,
    ridgeMaskMap,
    warp,
  );
  const riverCorridorMap = landmarkSuitability
    ? landmarkSuitability.riverAffinityMap
    : null;
  const landmarkFirst = valley.landmarkFirst || {};
  const landmarkFirstEnabled = landmarkFirst.enabled === true;
  const biomeNoise = buildBiomeNoiseMask(
    width,
    height,
    valley.biomeNoise,
    seed,
    warp,
  );
  const biomeMask = biomeNoise ? biomeNoise.mask : null;
  const biomeHeightStrength = biomeNoise ? biomeNoise.heightStrength : 0;
  const biomeThresholdStrength = biomeNoise
    ? biomeNoise.noiseThresholdStrength
    : 0;
  const heightMap = Array.from({ length: height }, (_, y) => {
    return Array.from({ length: width }, (_, x) => {
      const warped = applyDomainWarp(x, y, warp);
      const base = fractalNoise(
        warped.x * valley.noiseScale,
        warped.y * valley.noiseScale,
        seed,
        valley.octaves,
        valley.persistence,
        valley.lacunarity,
      );
      const mid = (height - 1) / 2;
      const gradient = mid > 0 ? Math.abs((y - mid) / mid) : 0;
      const spineLift = sampleWorldSpineMask(worldSpine, x, y, warp);
      const ridgeLift = ridgeMaskMap ? ridgeMaskMap[y][x] : 0;
      const riverCorridor = riverCorridorMap ? riverCorridorMap[y][x] : 0;
      const legacyHeight = (
        base * (1 - valley.bowlStrength) +
        gradient * valley.bowlStrength +
        spineLift * worldSpine.reliefStrength +
        ridgeLift * valley.landmarks.ridgeMask.strength
      );
      if (!landmarkFirstEnabled) {
        return legacyHeight;
      }
      const landmarkFirstHeight =
        base * (1 - valley.bowlStrength) +
        gradient * valley.bowlStrength +
        spineLift * landmarkFirst.spineHeightBoost +
        ridgeLift * landmarkFirst.ridgeHeightBoost -
        riverCorridor * landmarkFirst.riverCarveStrength;
      return lerp(legacyHeight, landmarkFirstHeight, landmarkFirst.heightBlend);
    });
  });

  let smooth = smoothHeightMap(heightMap, valley.smoothingPasses);
  smooth = normalizeHeightMap(smooth);
  const riverInfo = buildValleyRivers(smooth, valley, seed, riverSpineGuide, warp);
  const carved = carveRiverValley(smooth, riverInfo.river, valley);
  const ponds = buildValleyPonds(carved, riverInfo, valley, rng);
  const riverSet = new Set();
  for (const cell of riverInfo.river) {
    riverSet.add(`${cell.x},${cell.y}`);
  }
  let lakeSet = new Set([...riverInfo.lakes, ...ponds]);
  lakeSet = applyWaterBudget(
    lakeSet,
    riverSet,
    carved,
    valley.waterBudget,
    seed,
  );
  const waterSet = new Set([...lakeSet, ...riverSet]);

  const baseDist = computeDistanceToWater(
    waterSet,
    width,
    height,
    valley.waterDistanceDiagonalWeight,
  );
  let dist = applyDistanceJitter(baseDist, valley, seed);
  dist = applyBiomeNoiseToDistance(dist, biomeNoise);
  const lakeDist = computeDistanceToWater(
    lakeSet,
    width,
    height,
    valley.waterDistanceDiagonalWeight,
  );
  const humidity = dist.map((row) =>
    row.map((d) => Math.exp(-d / valley.humidityDecay)),
  );

  const baseTypes = Array.from({ length: height }, () =>
    new Array(width).fill("plain"),
  );
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const key = `${x},${y}`;
      if (waterSet.has(key)) {
        baseTypes[y][x] = lakeSet.has(key) ? "lake" : "river";
        continue;
      }
      const reliefFactor = macroRelief ? macroRelief[y][x] : 0;
      const moistureFactor = macroMoisture ? macroMoisture[y][x] : 0;
      const ridgeFactor = ridgeMaskMap ? ridgeMaskMap[y][x] : 0;
      const riverFactor = riverCorridorMap ? riverCorridorMap[y][x] : 0;
      const heightBias = biomeMask ? biomeMask[y][x] * biomeHeightStrength : 0;
      const h = clamp(carved[y][x] + heightBias, 0, 1);
      const mountainThreshold = clamp(
        valley.mountainHeight -
          reliefFactor * valley.macroZones.mountainHeightShift -
          ridgeFactor * valley.landmarks.ridgeMask.mountainThresholdShift -
          ridgeFactor *
            (landmarkFirstEnabled ? landmarkFirst.mountainThresholdShift : 0) +
          riverFactor *
            (landmarkFirstEnabled
              ? landmarkFirst.riverMountainSuppression
              : 0),
        0,
        1,
      );
      const hillThreshold = clamp(
        valley.hillHeight -
          reliefFactor * valley.macroZones.hillHeightShift -
          ridgeFactor * valley.landmarks.ridgeMask.hillThresholdShift -
          ridgeFactor *
            (landmarkFirstEnabled ? landmarkFirst.hillThresholdShift : 0) +
          riverFactor *
            (landmarkFirstEnabled ? landmarkFirst.riverHillSuppression : 0),
        0,
        mountainThreshold,
      );
      const fertileHeightThreshold = clamp(
        valley.fertileHeight +
          moistureFactor * valley.macroZones.fertileHeightShift +
          riverFactor *
            (landmarkFirstEnabled ? landmarkFirst.fertileHeightBoost : 0),
        0,
        1,
      );
      const fertileDistance = clamp(
        Math.floor(
          valley.fertileDistance +
            moistureFactor * valley.macroZones.fertileDistanceShift +
            riverFactor *
              (landmarkFirstEnabled
                ? landmarkFirst.fertileDistanceBoost
                : 0),
        ),
        0,
        16,
      );
      if (h >= mountainThreshold) {
        baseTypes[y][x] = "mountain";
      } else if (h >= hillThreshold) {
        baseTypes[y][x] = "hill";
      } else if (
        h <= fertileHeightThreshold &&
        dist[y][x] <= fertileDistance
      ) {
        baseTypes[y][x] = "fertile";
      } else {
        baseTypes[y][x] = "plain";
      }
    }
  }

  const forestConfig = valley.forest || {};
  const forestWaterDistanceMin = Math.max(
    0,
    Number(forestConfig.waterDistanceMin ?? 0),
  );
  const forestWaterDistanceMax = Math.max(
    forestWaterDistanceMin,
    Number(forestConfig.waterDistanceMax ?? 0),
  );
  const forestWaterDistanceJitter = Math.max(
    0,
    Number(forestConfig.waterDistanceJitter ?? 0),
  );
  const forestWaterDistanceNoiseScale = Math.max(
    0.001,
    Number(
      forestConfig.waterDistanceNoiseScale ?? forestConfig.noiseScale ?? 0.11,
    ),
  );
  const forestNaturalSpread = forestConfig.naturalSpread || {};
  const forestNaturalSpreadEnabled = forestNaturalSpread.enabled !== false;
  const forestNaturalSpreadNoiseScale = Math.max(
    0.001,
    Number(forestNaturalSpread.noiseScale ?? 0.045),
  );
  const forestNaturalSpreadNoiseThreshold = clamp(
    Number(forestNaturalSpread.noiseThreshold ?? 0.6),
    0,
    1,
  );
  const forestNaturalSpreadMaxExtraDistance = Math.max(
    0,
    Number(forestNaturalSpread.maxExtraDistance ?? 5),
  );
  const forestNaturalSpreadHumidityRelax = clamp(
    Number(forestNaturalSpread.humidityRelax ?? 0.05),
    0,
    0.35,
  );
  const forestNaturalSpreadHumidityFloor = clamp(
    Number(forestNaturalSpread.humidityFloor ?? 0.2),
    0,
    1,
  );
  const forestNaturalSpreadThresholdBoost = clamp(
    Number(forestNaturalSpread.noiseThresholdBoost ?? 0.1),
    0,
    0.35,
  );
  const forestSpreadMap =
    forestNaturalSpreadEnabled && forestNaturalSpreadMaxExtraDistance > 0
      ? Array.from({ length: height }, () => new Array(width).fill(0))
      : null;
  if (forestSpreadMap) {
    const spreadThresholdDenominator = Math.max(
      0.0001,
      1 - forestNaturalSpreadNoiseThreshold,
    );
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const warped = applyDomainWarp(x, y, warp);
        const spreadNoise = fractalNoise(
          warped.x * forestNaturalSpreadNoiseScale,
          warped.y * forestNaturalSpreadNoiseScale,
          seed + 711,
          2,
          0.55,
          2.0,
        );
        const spreadFactor =
          spreadNoise > forestNaturalSpreadNoiseThreshold
            ? (spreadNoise - forestNaturalSpreadNoiseThreshold) /
              spreadThresholdDenominator
            : 0;
        forestSpreadMap[y][x] = clamp(spreadFactor, 0, 1);
      }
    }
  }
  const forest = Array.from({ length: height }, () =>
    new Array(width).fill(false),
  );
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const moistureFactor = macroMoisture ? macroMoisture[y][x] : 0;
      const landmarkEffects = computeBiomeLandmarkEffects(
        landmarkSuitability,
        forestConfig.landmarkSuitability,
        x,
        y,
      );
      const type = baseTypes[y][x];
      if (type === "river" || type === "lake" || type === "mountain") {
        continue;
      }
      const heightBias = biomeMask ? biomeMask[y][x] * biomeHeightStrength : 0;
      const effectiveHeight = clamp(carved[y][x] + heightBias, 0, 1);
      if (effectiveHeight > forestConfig.heightMax) {
        continue;
      }
      const effectiveMaxDistance = Math.max(
        forestWaterDistanceMin + 0.25,
        forestWaterDistanceMax +
          moistureFactor * valley.macroZones.waterDistanceShift +
          landmarkEffects.waterDistanceShift,
      );
      const spreadFactor = forestSpreadMap ? forestSpreadMap[y][x] : 0;
      const spreadDistanceAllowance =
        spreadFactor * forestNaturalSpreadMaxExtraDistance;
      const waterDist = dist[y][x];
      if (waterDist <= forestWaterDistanceMin) {
        continue;
      }
      let effectiveDist = waterDist;
      if (forestWaterDistanceJitter > 0) {
        const noise = smoothValueNoise(
          x * forestWaterDistanceNoiseScale,
          y * forestWaterDistanceNoiseScale,
          seed + 181,
        );
        effectiveDist =
          waterDist + (noise - 0.5) * 2 * forestWaterDistanceJitter;
      }
      const effectiveMaxDistanceWithSpread =
        effectiveMaxDistance + spreadDistanceAllowance;
      if (effectiveDist > effectiveMaxDistanceWithSpread) {
        continue;
      }
      const inlandDistance = Math.max(0, effectiveDist - effectiveMaxDistance);
      const inlandPenalty =
        spreadDistanceAllowance > 0
          ? clamp(inlandDistance / Math.max(0.25, spreadDistanceAllowance), 0, 1)
          : 0;
      const effectiveHumidity = clamp(
        humidity[y][x] +
          moistureFactor * valley.macroZones.humidityShift +
          landmarkEffects.humidityShift,
        0,
        1,
      );
      const humidityMin =
        spreadFactor > 0
          ? Math.max(
              forestNaturalSpreadHumidityFloor,
              forestConfig.humidityMin -
                spreadFactor * forestNaturalSpreadHumidityRelax,
            )
          : forestConfig.humidityMin;
      if (effectiveHumidity < humidityMin) {
        continue;
      }
      const warped = applyDomainWarp(x, y, warp);
      const noise = fractalNoise(
        warped.x * forestConfig.noiseScale,
        warped.y * forestConfig.noiseScale,
        seed + 77,
        3,
        0.5,
        2.0,
      );
      const thresholdBias = biomeMask
        ? biomeMask[y][x] * biomeThresholdStrength
        : 0;
      const macroThresholdBias =
        -moistureFactor * valley.macroZones.biomeThresholdShift;
      const spreadThresholdShift =
        spreadFactor *
        (1 - inlandPenalty) *
        forestNaturalSpreadThresholdBoost;
      const threshold = clamp(
        forestConfig.noiseThreshold +
          thresholdBias +
          macroThresholdBias +
          landmarkEffects.noiseThresholdShift -
          spreadThresholdShift,
        0,
        1,
      );
      if (noise > threshold) {
        forest[y][x] = true;
      }
    }
  }
  for (let pass = 0; pass < forestConfig.clusterPasses; pass += 1) {
    smoothClusterMap(forest, baseTypes, (x, y) => {
      const type = baseTypes[y][x];
      if (type === "river" || type === "lake" || type === "mountain") {
        return false;
      }
      const moistureFactor = macroMoisture ? macroMoisture[y][x] : 0;
      const landmarkEffects = computeBiomeLandmarkEffects(
        landmarkSuitability,
        forestConfig.landmarkSuitability,
        x,
        y,
      );
      const effectiveMaxDistance = Math.max(
        forestWaterDistanceMin + 0.25,
        forestWaterDistanceMax +
          moistureFactor * valley.macroZones.waterDistanceShift +
          landmarkEffects.waterDistanceShift,
      );
      const spreadFactor = forestSpreadMap ? forestSpreadMap[y][x] : 0;
      const spreadDistanceAllowance =
        spreadFactor * forestNaturalSpreadMaxExtraDistance;
      const effectiveMaxDistanceWithSpread =
        effectiveMaxDistance + spreadDistanceAllowance;
      if (
        dist[y][x] <= forestWaterDistanceMin ||
        dist[y][x] > effectiveMaxDistanceWithSpread
      ) {
        return false;
      }
      const effectiveHumidity = clamp(
        humidity[y][x] +
          moistureFactor * valley.macroZones.humidityShift +
          landmarkEffects.humidityShift,
        0,
        1,
      );
      const humidityMin =
        spreadFactor > 0
          ? Math.max(
              forestNaturalSpreadHumidityFloor,
              forestConfig.humidityMin -
                spreadFactor * forestNaturalSpreadHumidityRelax,
            )
          : forestConfig.humidityMin;
      const clusterHumidityMin =
        spreadFactor > 0 ? Math.max(0.3, humidityMin) : 0.4;
      return effectiveHumidity > clusterHumidityMin;
    });
  }
  applyBiomeEdgeJitter(forest, valley.biomeEdgeJitter, seed + 131, (x, y) => {
    const type = baseTypes[y][x];
    if (type === "river" || type === "lake" || type === "mountain") {
      return false;
    }
    const moistureFactor = macroMoisture ? macroMoisture[y][x] : 0;
    const landmarkEffects = computeBiomeLandmarkEffects(
      landmarkSuitability,
      forestConfig.landmarkSuitability,
      x,
      y,
    );
    const effectiveMaxDistance = Math.max(
      forestWaterDistanceMin + 0.25,
      forestWaterDistanceMax +
        moistureFactor * valley.macroZones.waterDistanceShift +
        landmarkEffects.waterDistanceShift,
    );
    const spreadFactor = forestSpreadMap ? forestSpreadMap[y][x] : 0;
    const spreadDistanceAllowance =
      spreadFactor * forestNaturalSpreadMaxExtraDistance;
    const effectiveMaxDistanceWithSpread =
      effectiveMaxDistance + spreadDistanceAllowance;
    if (
      dist[y][x] <= forestWaterDistanceMin ||
      dist[y][x] > effectiveMaxDistanceWithSpread
    ) {
      return false;
    }
    const effectiveHumidity = clamp(
      humidity[y][x] +
        moistureFactor * valley.macroZones.humidityShift +
        landmarkEffects.humidityShift,
      0,
      1,
    );
    const humidityMin =
      spreadFactor > 0
        ? Math.max(
            forestNaturalSpreadHumidityFloor,
            forestConfig.humidityMin -
              spreadFactor * forestNaturalSpreadHumidityRelax,
          )
        : forestConfig.humidityMin;
    return effectiveHumidity >= humidityMin;
  }, "forest");
  applyForestEdgeJitter(forest, lakeDist, forestConfig, seed);

  const stone = Array.from({ length: height }, () =>
    new Array(width).fill(false),
  );
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const type = baseTypes[y][x];
      if (type !== "mountain") {
        continue;
      }
      if (carved[y][x] < valley.stone.heightMin) {
        continue;
      }
      const warped = applyDomainWarp(x, y, warp);
      const noise = fractalNoise(
        warped.x * valley.stone.noiseScale,
        warped.y * valley.stone.noiseScale,
        seed + 99,
        3,
        0.5,
        2.0,
      );
      if (noise > valley.stone.noiseThreshold) {
        stone[y][x] = true;
      }
    }
  }
  for (let pass = 0; pass < valley.stone.clusterPasses; pass += 1) {
    smoothClusterMap(stone, baseTypes, () => true);
  }

  const food = buildValleyFoodMask(
    width,
    height,
    baseTypes,
    dist,
    humidity,
    forest,
    valley,
    seed,
    warp,
    biomeNoise,
    macroClimate,
    landmarkSuitability,
  );
  const pastureEnabled = !(config && config.pasture && config.pasture.enabled === false);
  const pasture = pastureEnabled
    ? buildValleyPastureMask(
        width,
        height,
        baseTypes,
        dist,
        humidity,
        forest,
        food,
        valley,
        seed,
        warp,
        biomeNoise,
        macroClimate,
        landmarkSuitability,
      )
    : Array.from({ length: height }, () => new Array(width).fill(false));

  const types = Array.from({ length: height }, () =>
    new Array(width).fill("plain"),
  );
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const base = baseTypes[y][x];
      if (base === "river" || base === "lake") {
        types[y][x] = base;
        continue;
      }
      if (base === "mountain") {
        types[y][x] = stone[y][x] ? "stone" : "mountain";
        continue;
      }
      if (forest[y][x]) {
        types[y][x] = "forest";
        continue;
      }
      if (food[y][x]) {
        types[y][x] = "food";
        continue;
      }
      if (pasture[y][x]) {
        types[y][x] = "pasture";
        continue;
      }
      types[y][x] = base;
    }
  }

  ensureValleyTerrainCoverage(
    types,
    baseTypes,
    carved,
    dist,
    riverInfo,
    valley,
    rng,
  );
  ensureMinimumTerrainTiles(types, baseTypes, carved, dist, settings, rng);
  ensureMinimumRuinSpawnTiles(types, carved, config, rng);

  const walkable = buildWalkableMap(types, settings.walkable);
  applyRuntimeInsetMask(walkable, runtime);
  const spawnable = buildSpawnableMap(walkable);

  return {
    width,
    height,
    seed,
    types,
    walkable,
    spawnable,
    walkableTypes: settings.walkable,
    symbols: settings.symbols,
  };
}

// Carve runtime map inset cells out of walkable/spawnable simulation space.
function applyRuntimeInsetMask(walkable, runtime) {
  if (!walkable || walkable.length === 0) {
    return;
  }
  const inset = runtime && runtime.mapInset;
  if (!inset || inset.reserveSimulationSpace === false) {
    return;
  }
  const height = walkable.length;
  const width = walkable[0].length || 0;
  if (width <= 0 || height <= 0) {
    return;
  }
  const minX = clamp(Math.floor(Number(inset.x || 0)), 0, width - 1);
  const minY = clamp(Math.floor(Number(inset.y || 0)), 0, height - 1);
  const maxX = clamp(minX + Math.max(0, Math.floor(Number(inset.width || 0))) - 1, minX, width - 1);
  const maxY = clamp(minY + Math.max(0, Math.floor(Number(inset.height || 0))) - 1, minY, height - 1);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      walkable[y][x] = false;
    }
  }
}

// Ensure a minimum number of spawn tiles for ruins.
function ensureMinimumRuinSpawnTiles(types, heights, config, rng) {
  const ruinsStruct =
    config && config.structures && config.structures.ruins
      ? config.structures.ruins
      : {};
  const ruinsStructCount = Math.max(
    0,
    Math.floor(Number(ruinsStruct.count ?? 0)),
  );
  if (ruinsStructCount <= 0) {
    return;
  }
  const minTiles = Math.max(
    0,
    Math.floor(Number(ruinsStruct.minSpawnTiles ?? 0)),
  );
  if (minTiles <= 0) {
    return;
  }
  const rawAllowed = Array.isArray(ruinsStruct.spawnTerrain)
    ? ruinsStruct.spawnTerrain
    : [];
  const allowedList = rawAllowed.map((entry) => String(entry));
  if (allowedList.length === 0) {
    return;
  }
  const allowedSet = new Set(allowedList);
  let count = 0;
  for (let y = 0; y < types.length; y += 1) {
    for (let x = 0; x < types[y].length; x += 1) {
      if (allowedSet.has(types[y][x])) {
        count += 1;
      }
    }
  }
  if (count >= minTiles) {
    return;
  }
  const avoid = new Set(["river", "lake", "water", "shore"]);
  const preferred = allowedSet.has("mountain") ? "mountain" : allowedList[0];
  const candidates = buildTerrainCandidateList(
    types,
    heights,
    (type) => !allowedSet.has(type) && !avoid.has(type),
    rng,
  );
  for (const cell of candidates) {
    if (count >= minTiles) {
      break;
    }
    types[cell.y][cell.x] = preferred;
    count += 1;
  }
}

// Function: ensureValleyTerrainCoverage.
function ensureValleyTerrainCoverage(
  types,
  baseTypes,
  heights,
  dist,
  riverInfo,
  valley,
  rng,
) {
  const counts = countTerrainTypes(types);

  if (!counts.river) {
    const riverCells = Array.isArray(riverInfo && riverInfo.river)
      ? riverInfo.river
      : [];
    if (riverCells.length > 0) {
      for (const cell of riverCells) {
        types[cell.y][cell.x] = "river";
      }
      counts.river = riverCells.length;
    } else {
      const midY = Math.floor(types.length / 2);
      for (let x = 0; x < types[0].length; x += 1) {
        types[midY][x] = "river";
      }
      counts.river = types[0].length;
    }
  }

  const allowFallbackLake = (() => {
    const budget = valley && valley.waterBudget ? valley.waterBudget : null;
    if (!budget || budget.enabled === false) {
      return true;
    }
    const maxRatio = clamp(Number(budget.maxRatio ?? 1), 0, 1);
    const total = types.length * (types[0] ? types[0].length : 0);
    const maxWaterCells = Math.max(0, Math.floor(total * maxRatio));
    const riverCells =
      budget.preserveRiver === false ? 0 : Number(counts.river || 0);
    return maxWaterCells > riverCells;
  })();

  if (!counts.lake && allowFallbackLake) {
    const riverCells = Array.isArray(riverInfo && riverInfo.river)
      ? riverInfo.river
      : [];
    const anchor =
      riverCells.length > 0
        ? riverCells[
            Math.floor((rng ? rng() : Math.random()) * riverCells.length)
          ]
        : {
            x: Math.floor(types[0].length / 2),
            y: Math.floor(types.length / 2),
          };
    const lakePatch = valley.lakePatch || {};
    let lakeRadius = randomBetweenWithRng(
      rng,
      lakePatch.radiusMin,
      lakePatch.radiusMax,
    );
    const budget = valley && valley.waterBudget ? valley.waterBudget : null;
    if (budget && budget.enabled !== false) {
      const maxRatio = clamp(Number(budget.maxRatio ?? 1), 0, 1);
      const total = types.length * (types[0] ? types[0].length : 0);
      const maxWaterCells = Math.max(0, Math.floor(total * maxRatio));
      const riverCells =
        budget.preserveRiver === false ? 0 : Number(counts.river || 0);
      const availableLakeCells = Math.max(0, maxWaterCells - riverCells);
      const maxRadiusByBudget = Math.max(
        1,
        Math.floor(Math.sqrt(availableLakeCells / Math.PI)),
      );
      lakeRadius = Math.min(lakeRadius, maxRadiusByBudget);
    }
    const edgeConfig = buildLakeEdgeConfig(lakePatch, rng, 433);
    placeLakePatch(types, anchor.x, anchor.y, lakeRadius, edgeConfig);
    counts.lake = 1;
  }

  if (!counts.mountain) {
    const cell = selectCellByHeight(
      heights,
      types,
      (type) => type !== "river" && type !== "lake",
      true,
    );
    if (cell) {
      types[cell.y][cell.x] = "mountain";
      counts.mountain = 1;
    }
  }

  if (!counts.hill) {
    const cell = selectCellByHeight(
      heights,
      types,
      (type) => type !== "river" && type !== "lake" && type !== "mountain",
      true,
    );
    if (cell) {
      types[cell.y][cell.x] = "hill";
      counts.hill = 1;
    }
  }

  if (!counts.fertile) {
    const cell = selectCellByHeight(
      heights,
      types,
      (type, x, y) =>
        type !== "river" &&
        type !== "lake" &&
        dist[y][x] <= valley.fertileDistance + 1,
      false,
    );
    if (cell) {
      types[cell.y][cell.x] = "fertile";
      counts.fertile = 1;
    }
  }

  if (!counts.plain) {
    const cell = selectCellByHeight(
      heights,
      types,
      (type) => type !== "river" && type !== "lake" && type !== "mountain",
      false,
    );
    if (cell) {
      types[cell.y][cell.x] = "plain";
      counts.plain = 1;
    }
  }

  if (!counts.forest) {
    const maxDist =
      valley.forest && Number.isFinite(valley.forest.waterDistanceMax)
        ? valley.forest.waterDistanceMax
        : 4;
    const cell = selectCellByHeight(
      heights,
      types,
      (type, x, y) =>
        type !== "river" &&
        type !== "lake" &&
        type !== "mountain" &&
        dist[y][x] <= maxDist,
      false,
    );
    if (cell) {
      types[cell.y][cell.x] = "forest";
      counts.forest = 1;
    }
  }

  if (!counts.food) {
    const maxDist =
      valley.food && Number.isFinite(valley.food.waterDistanceMax)
        ? valley.food.waterDistanceMax
        : valley.fertileDistance + 1;
    const cell = selectCellByHeight(
      heights,
      types,
      (type, x, y) =>
        (baseTypes[y][x] === "fertile" || baseTypes[y][x] === "plain") &&
        type !== "river" &&
        type !== "lake" &&
        type !== "mountain" &&
        type !== "forest" &&
        type !== "stone" &&
        dist[y][x] <= maxDist,
      false,
    );
    if (cell) {
      types[cell.y][cell.x] = "food";
      counts.food = 1;
    }
  }

  ensureMinimumFoodTiles(types, baseTypes, dist, valley, rng, counts);

  if (!counts.stone) {
    const cell = selectCellByHeight(
      heights,
      types,
      (type) => type === "mountain",
      true,
    );
    if (cell) {
      types[cell.y][cell.x] = "stone";
      counts.stone = 1;
    }
  }
}

// Function: buildValleyPonds.
function buildValleyPonds(heightMap, riverInfo, valley, rng) {
  const pondsConfig = valley && valley.ponds ? valley.ponds : {};
  if (pondsConfig.enabled === false || pondsConfig.count <= 0) {
    return new Set();
  }

  const height = heightMap.length;
  const width = height > 0 ? heightMap[0].length : 0;
  if (width <= 0 || height <= 0) {
    return new Set();
  }

  const pondSet = new Set();
  const avoidSet = new Set();
  const riverCells = Array.isArray(riverInfo && riverInfo.river)
    ? riverInfo.river
    : [];
  for (const cell of riverCells) {
    avoidSet.add(`${cell.x},${cell.y}`);
  }
  if (riverInfo && riverInfo.lakes) {
    for (const key of riverInfo.lakes) {
      avoidSet.add(key);
    }
  }

  const random = typeof rng === "function" ? rng : Math.random;
  for (let i = 0; i < pondsConfig.count; i += 1) {
    const radius = randomBetweenWithRng(
      random,
      pondsConfig.radiusMin,
      pondsConfig.radiusMax,
    );
    const center = pickPondCenter(
      heightMap,
      avoidSet,
      radius,
      pondsConfig.buffer,
      pondsConfig.heightMax,
      random,
    );
    if (!center) {
      continue;
    }
    const edgeConfig = buildLakeEdgeConfig(pondsConfig, random, 907);
    const pondCells = addPondCells(
      pondSet,
      center.x,
      center.y,
      radius,
      width,
      height,
      edgeConfig,
    );
    for (const key of pondCells) {
      avoidSet.add(key);
    }
  }

  return pondSet;
}

// Function: pickPondCenter.
function pickPondCenter(heightMap, avoidSet, radius, buffer, heightMax, rng) {
  const height = heightMap.length;
  const width = height > 0 ? heightMap[0].length : 0;
  if (width <= 0 || height <= 0) {
    return null;
  }
  const random = typeof rng === "function" ? rng : Math.random;
  const r = Math.max(1, radius);
  const margin = Math.max(0, buffer) + r;
  const minX = margin;
  const minY = margin;
  const maxX = width - 1 - margin;
  const maxY = height - 1 - margin;
  if (minX > maxX || minY > maxY) {
    return null;
  }

  const maxHeight = Number.isFinite(heightMax) ? clamp(heightMax, 0, 1) : 1;
  const attempts = 60;
  let best = null;
  let bestHeight = Infinity;
  for (let i = 0; i < attempts; i += 1) {
    const x = randomBetweenWithRng(random, minX, maxX);
    const y = randomBetweenWithRng(random, minY, maxY);
    if (isWaterWithinBuffer(avoidSet, x, y, margin)) {
      continue;
    }
    const h = heightMap[y][x];
    if (h > maxHeight) {
      continue;
    }
    if (h < bestHeight) {
      bestHeight = h;
      best = { x, y };
    }
  }

  if (!best && maxHeight < 1) {
    return pickPondCenter(heightMap, avoidSet, radius, buffer, 1, rng);
  }

  return best;
}

// Function: isWaterWithinBuffer.
function isWaterWithinBuffer(avoidSet, x, y, radius) {
  const r = Math.max(0, radius);
  for (let yy = y - r; yy <= y + r; yy += 1) {
    for (let xx = x - r; xx <= x + r; xx += 1) {
      if (avoidSet.has(`${xx},${yy}`)) {
        return true;
      }
    }
  }
  return false;
}

// Function: addPondCells.
function addPondCells(pondSet, x, y, radius, width, height, edgeConfig) {
  const r = Math.max(1, radius);
  const useJagged = isJaggedEdgeEnabled(edgeConfig);
  const jaggedPad = useJagged
    ? Math.ceil(r * edgeConfig.jaggedness)
    : 0;
  const stretch = getMaxEdgeStretch(edgeConfig);
  const maxRadius = Math.ceil(r * stretch) + jaggedPad;
  const minX = Math.max(0, x - maxRadius);
  const maxX = Math.min(width - 1, x + maxRadius);
  const minY = Math.max(0, y - maxRadius);
  const maxY = Math.min(height - 1, y + maxRadius);
  const added = [];
  for (let yy = minY; yy <= maxY; yy += 1) {
    for (let xx = minX; xx <= maxX; xx += 1) {
      const dx = xx - x;
      const dy = yy - y;
      const dist2 = computeEdgeDistanceSquared(dx, dy, edgeConfig);
      const edgeRadius = useJagged
        ? getJaggedRadius(r, edgeConfig, xx, yy)
        : r;
      if (dist2 <= edgeRadius * edgeRadius) {
        const key = `${xx},${yy}`;
        pondSet.add(key);
        added.push(key);
      }
    }
  }
  return added;
}

// Function: applyForestEdgeJitter.
function applyForestEdgeJitter(forest, dist, forestConfig, seed) {
  if (!forestConfig) {
    return;
  }
  const edgeDistanceRaw = Number(forestConfig.edgeDistance ?? 0);
  const edgeDistance = Number.isFinite(edgeDistanceRaw)
    ? clamp(Math.floor(edgeDistanceRaw), 0, 12)
    : 0;
  const edgeJitterRaw = Number(forestConfig.edgeJitter ?? 0);
  const edgeJitter = Number.isFinite(edgeJitterRaw)
    ? clamp(edgeJitterRaw, 0, 1)
    : 0;
  const edgeNoiseScaleRaw = Number(
    forestConfig.edgeNoiseScale ?? forestConfig.noiseScale ?? 0.1,
  );
  const edgeNoiseScale = Number.isFinite(edgeNoiseScaleRaw)
    ? Math.max(0.001, edgeNoiseScaleRaw)
    : 0.1;
  if (edgeDistance <= 0 || edgeJitter <= 0) {
    return;
  }
  const height = forest.length;
  const width = height > 0 ? forest[0].length : 0;
  const edgeSeedOffset = Number(forestConfig.edgeSeedOffset ?? 317);
  const noiseSeed = Number(seed || 0) + edgeSeedOffset;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!forest[y][x]) {
        continue;
      }
      const waterDist = dist[y][x];
      if (!Number.isFinite(waterDist) || waterDist > edgeDistance) {
        continue;
      }
      const noise = smoothValueNoise(
        x * edgeNoiseScale,
        y * edgeNoiseScale,
        noiseSeed,
      );
      const proximity = edgeDistance > 0 ? 1 - waterDist / edgeDistance : 0;
      const threshold = edgeJitter * clamp(proximity, 0, 1);
      if (noise < threshold) {
        forest[y][x] = false;
      }
    }
  }
}

// Function: ensureMinimumFoodTiles.
function ensureMinimumFoodTiles(
  types,
  baseTypes,
  dist,
  valley,
  rng,
  counts,
  minOverride,
) {
  const foodConfig = valley.food || {};
  const minTiles = Math.max(
    0,
    Math.floor(Number(minOverride ?? foodConfig.minTiles ?? 0)),
  );
  if (minTiles <= 0) {
    return;
  }
  const current = Number(counts.food || 0);
  if (current >= minTiles) {
    return;
  }
  const maxDist = Number.isFinite(foodConfig.minTilesWaterDistanceMax)
    ? Math.max(0, Math.floor(foodConfig.minTilesWaterDistanceMax))
    : Math.max(0, Math.floor(foodConfig.waterDistanceMax ?? 0));
  const height = types.length;
  const width = height > 0 ? types[0].length : 0;
  const collectCandidates = (distanceLimit) => {
    const list = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (baseTypes[y][x] !== "plain" && baseTypes[y][x] !== "fertile") {
          continue;
        }
        const type = types[y][x];
        if (
          type === "river" ||
          type === "lake" ||
          type === "mountain" ||
          type === "forest" ||
          type === "stone"
        ) {
          continue;
        }
        if (Number.isFinite(distanceLimit) && dist[y][x] > distanceLimit) {
          continue;
        }
        list.push({ x, y });
      }
    }
    return list;
  };

  let candidates = collectCandidates(maxDist);
  if (candidates.length < minTiles) {
    candidates = collectCandidates(null);
  }
  if (candidates.length === 0) {
    return;
  }
  shuffleInPlace(candidates, rng);
  const needed = Math.min(minTiles - current, candidates.length);
  for (let i = 0; i < needed; i += 1) {
    const cell = candidates[i];
    types[cell.y][cell.x] = "food";
  }
  counts.food = current + needed;
}

// Ensure minimum pasture tiles for stable grazing areas.
function ensureMinimumPastureTiles(
  types,
  baseTypes,
  dist,
  valley,
  rng,
  counts,
  minTiles,
) {
  const current = Number(counts.pasture || 0);
  if (current >= minTiles) {
    return;
  }
  const pastureConfig = valley.pasture || {};
  const distanceLimit = Number.isFinite(pastureConfig.waterDistanceMax)
    ? Math.max(0, Math.floor(Number(pastureConfig.waterDistanceMax)))
    : null;

  const collectCandidates = (maxDist) => {
    const list = [];
    for (let y = 0; y < types.length; y += 1) {
      for (let x = 0; x < types[y].length; x += 1) {
        const base = baseTypes[y][x];
        if (base !== "fertile" && base !== "plain") {
          continue;
        }
        const type = types[y][x];
        if (
          type === "river" ||
          type === "lake" ||
          type === "mountain" ||
          type === "forest" ||
          type === "stone" ||
          type === "food" ||
          type === "pasture"
        ) {
          continue;
        }
        if (Number.isFinite(maxDist) && dist[y][x] > maxDist) {
          continue;
        }
        list.push({ x, y });
      }
    }
    return list;
  };

  let candidates = collectCandidates(distanceLimit);
  if (candidates.length < minTiles) {
    candidates = collectCandidates(null);
  }
  if (candidates.length === 0) {
    return;
  }
  shuffleInPlace(candidates, rng);
  const needed = Math.min(minTiles - current, candidates.length);
  for (let i = 0; i < needed; i += 1) {
    const cell = candidates[i];
    types[cell.y][cell.x] = "pasture";
  }
  counts.pasture = current + needed;
}

// Ensure minimum counts for key terrain types.
function ensureMinimumTerrainTiles(
  types,
  baseTypes,
  heights,
  dist,
  settings,
  rng,
) {
  const minimums =
    settings && settings.minimumTiles ? settings.minimumTiles : null;
  if (!minimums || typeof minimums !== "object") {
    return;
  }

  let counts = countTerrainTypes(types);

  const minFood = Math.max(0, Math.floor(Number(minimums.food ?? 0)));
  if (minFood > 0 && baseTypes && dist) {
    ensureMinimumFoodTiles(
      types,
      baseTypes,
      dist,
      settings.valley || {},
      rng,
      counts,
      minFood,
    );
    counts = countTerrainTypes(types);
  }

  const minPasture = Math.max(0, Math.floor(Number(minimums.pasture ?? 0)));
  if (minPasture > 0 && baseTypes && dist) {
    ensureMinimumPastureTiles(
      types,
      baseTypes,
      dist,
      settings.valley || {},
      rng,
      counts,
      minPasture,
    );
    counts = countTerrainTypes(types);
  }

  const minStone = Math.max(0, Math.floor(Number(minimums.stone ?? 0)));
  if (minStone > 0) {
    ensureMinimumStoneTiles(types, heights, counts, minStone, rng);
    counts = countTerrainTypes(types);
  }

  const minMountain = Math.max(0, Math.floor(Number(minimums.mountain ?? 0)));
  if (minMountain > 0) {
    ensureMinimumMountainTiles(types, heights, counts, minMountain, rng);
  }
}

function buildTerrainCandidateList(types, heights, predicate, rng) {
  const height = types.length;
  const width = height > 0 ? types[0].length : 0;
  const candidates = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const type = types[y][x];
      if (predicate && !predicate(type, x, y)) {
        continue;
      }
      const score = heights && heights[y] ? Number(heights[y][x] || 0) : 0;
      candidates.push({ x, y, score });
    }
  }
  if (heights && heights.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
  } else {
    shuffleInPlace(candidates, rng);
  }
  return candidates;
}

function ensureMinimumMountainTiles(types, heights, counts, minTiles, rng) {
  const current = Number(counts.mountain || 0);
  if (current >= minTiles) {
    return;
  }
  const needed = minTiles - current;
  const isWater = (type) =>
    type === "river" || type === "lake" || type === "water" || type === "shore";
  const basePredicate = (type) =>
    !isWater(type) && type !== "mountain" && type !== "stone";

  let placed = 0;
  const primary = buildTerrainCandidateList(
    types,
    heights,
    (type) => basePredicate(type) && type !== "food" && type !== "forest",
    rng,
  );
  for (const cell of primary) {
    types[cell.y][cell.x] = "mountain";
    placed += 1;
    if (placed >= needed) {
      return;
    }
  }

  const fallback = buildTerrainCandidateList(
    types,
    heights,
    basePredicate,
    rng,
  );
  for (const cell of fallback) {
    if (types[cell.y][cell.x] === "mountain") {
      continue;
    }
    types[cell.y][cell.x] = "mountain";
    placed += 1;
    if (placed >= needed) {
      return;
    }
  }
}

function ensureMinimumStoneTiles(types, heights, counts, minTiles, rng) {
  const current = Number(counts.stone || 0);
  if (current >= minTiles) {
    return;
  }
  let remaining = minTiles - current;

  const mountainCandidates = buildTerrainCandidateList(
    types,
    heights,
    (type) => type === "mountain",
    rng,
  );
  for (const cell of mountainCandidates) {
    types[cell.y][cell.x] = "stone";
    remaining -= 1;
    if (remaining <= 0) {
      return;
    }
  }

  const isWater = (type) =>
    type === "river" || type === "lake" || type === "water" || type === "shore";
  const primaryFallback = buildTerrainCandidateList(
    types,
    heights,
    (type) =>
      !isWater(type) &&
      type !== "stone" &&
      type !== "food" &&
      type !== "forest",
    rng,
  );
  for (const cell of primaryFallback) {
    if (types[cell.y][cell.x] === "stone") {
      continue;
    }
    types[cell.y][cell.x] = "stone";
    remaining -= 1;
    if (remaining <= 0) {
      return;
    }
  }

  const finalFallback = buildTerrainCandidateList(
    types,
    heights,
    (type) => !isWater(type) && type !== "stone",
    rng,
  );
  for (const cell of finalFallback) {
    if (types[cell.y][cell.x] === "stone") {
      continue;
    }
    types[cell.y][cell.x] = "stone";
    remaining -= 1;
    if (remaining <= 0) {
      return;
    }
  }
}

// Function: countTerrainTypes.
function countTerrainTypes(types) {
  const counts = {};
  for (let y = 0; y < types.length; y += 1) {
    const row = types[y];
    for (let x = 0; x < row.length; x += 1) {
      const type = row[x];
      counts[type] = Number(counts[type] || 0) + 1;
    }
  }
  return counts;
}

// Function: shuffleInPlace.
function shuffleInPlace(items, rng) {
  const random = rng || Math.random;
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
}

// Function: selectCellByHeight.
function selectCellByHeight(heights, types, predicate, preferHigh) {
  const height = heights.length;
  const width = height > 0 ? heights[0].length : 0;
  let best = null;
  let bestValue = preferHigh ? -Infinity : Infinity;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const type = types[y][x];
      if (predicate && !predicate(type, x, y)) {
        continue;
      }
      const value = heights[y][x];
      if (preferHigh) {
        if (value > bestValue) {
          bestValue = value;
          best = { x, y };
        }
      } else if (value < bestValue) {
        bestValue = value;
        best = { x, y };
      }
    }
  }
  return best;
}

// Function: placeLakePatch.
function placeLakePatch(types, x, y, radius, edgeConfig) {
  const height = types.length;
  const width = height > 0 ? types[0].length : 0;
  if (width <= 0 || height <= 0) {
    return;
  }
  const r = Math.max(1, radius);
  const useJagged = isJaggedEdgeEnabled(edgeConfig);
  const jaggedPad = useJagged
    ? Math.ceil(r * edgeConfig.jaggedness)
    : 0;
  const stretch = getMaxEdgeStretch(edgeConfig);
  const maxRadius = Math.ceil(r * stretch) + jaggedPad;
  const minX = Math.max(0, x - maxRadius);
  const maxX = Math.min(width - 1, x + maxRadius);
  const minY = Math.max(0, y - maxRadius);
  const maxY = Math.min(height - 1, y + maxRadius);
  for (let yy = minY; yy <= maxY; yy += 1) {
    for (let xx = minX; xx <= maxX; xx += 1) {
      const dx = xx - x;
      const dy = yy - y;
      const dist2 = computeEdgeDistanceSquared(dx, dy, edgeConfig);
      const edgeRadius = useJagged
        ? getJaggedRadius(r, edgeConfig, xx, yy)
        : r;
      if (dist2 <= edgeRadius * edgeRadius) {
        types[yy][xx] = "lake";
      }
    }
  }
}

// Function: normalizeTerrainSettings.
function normalizeTerrainSettings(terrainConfig) {
  const scaleRaw = Number(terrainConfig.scale ?? 0.08);
  const scale = Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 0.08;
  const octavesRaw = Number(terrainConfig.octaves ?? 3);
  const octaves = Number.isFinite(octavesRaw)
    ? clamp(Math.floor(octavesRaw), 1, 8)
    : 3;
  const persistenceRaw = Number(terrainConfig.persistence ?? 0.5);
  const persistence = Number.isFinite(persistenceRaw)
    ? clamp(persistenceRaw, 0, 1)
    : 0.5;
  const lacunarityRaw = Number(terrainConfig.lacunarity ?? 2.0);
  const lacunarity =
    Number.isFinite(lacunarityRaw) && lacunarityRaw > 0 ? lacunarityRaw : 2.0;
  return {
    seed: terrainConfig.seed ?? 0,
    scale,
    octaves,
    persistence,
    lacunarity,
    valley: normalizeValleySettings(terrainConfig.valley || {}, {
      scale,
      octaves,
      persistence,
      lacunarity,
    }),
    walkable: normalizeWalkableSettings(terrainConfig.walkable || {}),
    symbols: normalizeTerrainSymbols(terrainConfig.symbols || {}),
    minimumTiles: normalizeMinimumTiles(terrainConfig.minimumTiles || {}),
  };
}

// Function: normalizeTerrainSymbols.
function normalizeTerrainSymbols(raw) {
  return {
    river: pickSymbol(raw.river ?? raw.water, "="),
    lake: pickSymbol(raw.lake ?? raw.water, "~"),
    water: pickSymbol(raw.water, "~"),
    shore: pickSymbol(raw.shore, ":"),
    grass: pickSymbol(raw.grass, "."),
    hill: pickSymbol(raw.hill, "n"),
    plain: pickSymbol(raw.plain, "."),
    fertile: pickSymbol(raw.fertile, ":"),
    forest: pickSymbol(raw.forest, "T"),
    food: pickSymbol(raw.food, "f"),
    pasture: pickSymbol(raw.pasture, ","),
    stone: pickSymbol(raw.stone, "*"),
    mountain: pickSymbol(raw.mountain, "^"),
  };
}

function normalizeMinimumTiles(raw) {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const keys = ["food", "pasture", "mountain", "stone"];
  const normalized = {};
  for (const key of keys) {
    const value = Number(raw[key]);
    if (!Number.isFinite(value)) {
      continue;
    }
    normalized[key] = Math.max(0, Math.floor(value));
  }
  return normalized;
}

// Function: normalizeBiomeLandmarkSuitability.
function normalizeBiomeLandmarkSuitability(raw, defaults) {
  const source = raw && typeof raw === "object" ? raw : {};
  const base = defaults && typeof defaults === "object" ? defaults : {};
  const enabled = source.enabled !== false;
  const riverSpineAffinityRaw = Number(
    source.river_spine_affinity ??
      source.riverSpineAffinity ??
      base.riverSpineAffinity ??
      0,
  );
  const ridgeAffinityRaw = Number(
    source.ridge_affinity ?? source.ridgeAffinity ?? base.ridgeAffinity ?? 0,
  );
  const waterDistanceShiftRaw = Number(
    source.water_distance_shift ??
      source.waterDistanceShift ??
      base.waterDistanceShift ??
      0,
  );
  const humidityShiftRaw = Number(
    source.humidity_shift ?? source.humidityShift ?? base.humidityShift ?? 0,
  );
  const noiseThresholdShiftRaw = Number(
    source.noise_threshold_shift ??
      source.noiseThresholdShift ??
      base.noiseThresholdShift ??
      0,
  );
  return {
    enabled,
    riverSpineAffinity: Number.isFinite(riverSpineAffinityRaw)
      ? clamp(riverSpineAffinityRaw, -1, 1)
      : 0,
    ridgeAffinity: Number.isFinite(ridgeAffinityRaw)
      ? clamp(ridgeAffinityRaw, -1, 1)
      : 0,
    waterDistanceShift: Number.isFinite(waterDistanceShiftRaw)
      ? clamp(waterDistanceShiftRaw, -12, 12)
      : 0,
    humidityShift: Number.isFinite(humidityShiftRaw)
      ? clamp(humidityShiftRaw, -0.45, 0.45)
      : 0,
    noiseThresholdShift: Number.isFinite(noiseThresholdShiftRaw)
      ? clamp(noiseThresholdShiftRaw, -0.3, 0.3)
      : 0,
  };
}

// Function: getFantasyPresetProfile.
function getFantasyPresetProfile(name) {
  const preset = String(name || "none").toLowerCase();
  if (preset === "green_realm") {
    return {
      bowlStrengthDelta: -0.03,
      riverWanderDelta: 0.08,
      macroZones: {
        humidityShift: 0.14,
        waterDistanceShift: 1.8,
        biomeThresholdShift: 0.08,
      },
      worldSpine: {
        reliefStrength: 0.12,
        widthRatio: 0.26,
      },
      waterBudget: {
        maxRatio: 0.12,
      },
      biomeEdgeJitter: {
        strength: 0.18,
      },
    };
  }
  if (preset === "broken_crown") {
    return {
      bowlStrengthDelta: 0.02,
      riverWanderDelta: -0.04,
      macroZones: {
        mountainHeightShift: 0.09,
        hillHeightShift: 0.08,
      },
      worldSpine: {
        reliefStrength: 0.2,
        widthRatio: 0.2,
      },
      waterBudget: {
        maxRatio: 0.08,
      },
      biomeEdgeJitter: {
        strength: 0.24,
      },
    };
  }
  if (preset === "mistwater") {
    return {
      bowlStrengthDelta: -0.02,
      riverWanderDelta: 0.12,
      macroZones: {
        humidityShift: 0.16,
        waterDistanceShift: 2.2,
        biomeThresholdShift: 0.1,
      },
      worldSpine: {
        reliefStrength: 0.1,
        widthRatio: 0.3,
      },
      waterBudget: {
        maxRatio: 0.14,
      },
      biomeEdgeJitter: {
        strength: 0.2,
      },
    };
  }
  if (preset === "high_marches") {
    return {
      bowlStrengthDelta: 0.03,
      riverWanderDelta: 0.02,
      macroZones: {
        mountainHeightShift: 0.07,
        hillHeightShift: 0.08,
        fertileDistanceShift: 2,
      },
      worldSpine: {
        reliefStrength: 0.16,
        widthRatio: 0.22,
      },
      waterBudget: {
        maxRatio: 0.1,
      },
      biomeEdgeJitter: {
        strength: 0.22,
      },
    };
  }
  if (preset === "natural_epic") {
    return {
      bowlStrengthDelta: -0.01,
      riverWanderDelta: 0.04,
      macroZones: {
        humidityShift: 0.06,
        waterDistanceShift: 0.8,
        biomeThresholdShift: 0.03,
      },
      worldSpine: {
        reliefStrength: 0.03,
        widthRatio: 0.24,
      },
      waterBudget: {
        maxRatio: 0.13,
      },
      biomeEdgeJitter: {
        strength: 0.18,
      },
      landmarkFirst: {
        enabled: true,
        heightBlend: 0.65,
        spineHeightBoost: 0.12,
        ridgeHeightBoost: 0.2,
        riverCarveStrength: 0.18,
        mountainThresholdShift: 0.08,
        hillThresholdShift: 0.06,
        riverMountainSuppression: 0.1,
        riverHillSuppression: 0.08,
        fertileHeightBoost: 0.05,
        fertileDistanceBoost: 2,
      },
      landmarkSuitability: {
        forest: {
          enabled: true,
          riverSpineAffinity: -0.41,
          ridgeAffinity: 0.46,
          waterDistanceShift: 1.95,
          humidityShift: 0.07,
          noiseThresholdShift: -0.05,
        },
        food: {
          enabled: true,
          riverSpineAffinity: 0.58,
          ridgeAffinity: -0.34,
          waterDistanceShift: 1.95,
          humidityShift: 0.08,
          noiseThresholdShift: -0.06,
        },
        pasture: {
          enabled: true,
          riverSpineAffinity: 0.24,
          ridgeAffinity: -0.18,
          waterDistanceShift: 1.3,
          humidityShift: 0.055,
          noiseThresholdShift: -0.035,
        },
      },
    };
  }
  if (preset === "heroic_contrast") {
    return {
      bowlStrengthDelta: 0.03,
      riverWanderDelta: 0.08,
      macroZones: {
        mountainHeightShift: 0.08,
        hillHeightShift: 0.09,
        fertileDistanceShift: 1,
        humidityShift: 0.07,
        waterDistanceShift: 1.2,
        biomeThresholdShift: 0.04,
      },
      worldSpine: {
        reliefStrength: 0.08,
        widthRatio: 0.2,
      },
      waterBudget: {
        maxRatio: 0.11,
      },
      biomeEdgeJitter: {
        strength: 0.25,
      },
      landmarkFirst: {
        enabled: true,
        heightBlend: 0.8,
        spineHeightBoost: 0.14,
        ridgeHeightBoost: 0.27,
        riverCarveStrength: 0.22,
        mountainThresholdShift: 0.12,
        hillThresholdShift: 0.1,
        riverMountainSuppression: 0.13,
        riverHillSuppression: 0.1,
        fertileHeightBoost: 0.07,
        fertileDistanceBoost: 2.5,
      },
      landmarkSuitability: {
        forest: {
          enabled: true,
          riverSpineAffinity: -0.5,
          ridgeAffinity: 0.62,
          waterDistanceShift: 2.4,
          humidityShift: 0.1,
          noiseThresholdShift: -0.07,
        },
        food: {
          enabled: true,
          riverSpineAffinity: 0.74,
          ridgeAffinity: -0.45,
          waterDistanceShift: 2.3,
          humidityShift: 0.1,
          noiseThresholdShift: -0.08,
        },
        pasture: {
          enabled: true,
          riverSpineAffinity: 0.32,
          ridgeAffinity: -0.24,
          waterDistanceShift: 1.6,
          humidityShift: 0.07,
          noiseThresholdShift: -0.05,
        },
      },
    };
  }
  return null;
}

// Function: applyFantasyPresetToValley.
function applyFantasyPresetToValley(valley) {
  if (!valley || valley.fantasyPreset === "none") {
    return valley;
  }
  const profile = getFantasyPresetProfile(valley.fantasyPreset);
  if (!profile) {
    return valley;
  }
  const next = {
    ...valley,
    macroZones: { ...(valley.macroZones || {}) },
    worldSpine: { ...(valley.worldSpine || {}) },
    waterBudget: { ...(valley.waterBudget || {}) },
    biomeEdgeJitter: { ...(valley.biomeEdgeJitter || {}) },
    landmarkFirst: { ...(valley.landmarkFirst || {}) },
    forest: {
      ...(valley.forest || {}),
      landmarkSuitability: normalizeBiomeLandmarkSuitability(
        valley &&
          valley.forest &&
          valley.forest.landmarkSuitability,
        null,
      ),
    },
    food: {
      ...(valley.food || {}),
      landmarkSuitability: normalizeBiomeLandmarkSuitability(
        valley &&
          valley.food &&
          valley.food.landmarkSuitability,
        null,
      ),
    },
    pasture: {
      ...(valley.pasture || {}),
      landmarkSuitability: normalizeBiomeLandmarkSuitability(
        valley &&
          valley.pasture &&
          valley.pasture.landmarkSuitability,
        null,
      ),
    },
  };

  if (Number.isFinite(profile.bowlStrengthDelta)) {
    next.bowlStrength = clamp(
      Number(next.bowlStrength || 0) + profile.bowlStrengthDelta,
      0,
      1,
    );
  }
  if (Number.isFinite(profile.riverWanderDelta)) {
    next.riverWander = clamp(
      Number(next.riverWander || 0) + profile.riverWanderDelta,
      0,
      1,
    );
  }

  if (profile.macroZones) {
    if (Number.isFinite(profile.macroZones.mountainHeightShift)) {
      next.macroZones.mountainHeightShift = clamp(
        Number(next.macroZones.mountainHeightShift || 0) +
          profile.macroZones.mountainHeightShift,
        0,
        0.25,
      );
    }
    if (Number.isFinite(profile.macroZones.hillHeightShift)) {
      next.macroZones.hillHeightShift = clamp(
        Number(next.macroZones.hillHeightShift || 0) +
          profile.macroZones.hillHeightShift,
        0,
        0.25,
      );
    }
    if (Number.isFinite(profile.macroZones.fertileDistanceShift)) {
      next.macroZones.fertileDistanceShift = clamp(
        Number(next.macroZones.fertileDistanceShift || 0) +
          profile.macroZones.fertileDistanceShift,
        0,
        8,
      );
    }
    if (Number.isFinite(profile.macroZones.humidityShift)) {
      next.macroZones.humidityShift = clamp(
        Number(next.macroZones.humidityShift || 0) +
          profile.macroZones.humidityShift,
        0,
        0.45,
      );
    }
    if (Number.isFinite(profile.macroZones.waterDistanceShift)) {
      next.macroZones.waterDistanceShift = clamp(
        Number(next.macroZones.waterDistanceShift || 0) +
          profile.macroZones.waterDistanceShift,
        0,
        8,
      );
    }
    if (Number.isFinite(profile.macroZones.biomeThresholdShift)) {
      next.macroZones.biomeThresholdShift = clamp(
        Number(next.macroZones.biomeThresholdShift || 0) +
          profile.macroZones.biomeThresholdShift,
        0,
        0.3,
      );
    }
  }

  if (profile.worldSpine) {
    if (Number.isFinite(profile.worldSpine.reliefStrength)) {
      next.worldSpine.reliefStrength = clamp(
        Number(next.worldSpine.reliefStrength || 0) +
          profile.worldSpine.reliefStrength,
        0,
        0.35,
      );
    }
    if (Number.isFinite(profile.worldSpine.widthRatio)) {
      next.worldSpine.widthRatio = clamp(
        profile.worldSpine.widthRatio,
        0.05,
        0.9,
      );
    }
  }

  if (profile.waterBudget && Number.isFinite(profile.waterBudget.maxRatio)) {
    next.waterBudget.maxRatio = clamp(profile.waterBudget.maxRatio, 0, 0.5);
  }
  if (
    profile.biomeEdgeJitter &&
    Number.isFinite(profile.biomeEdgeJitter.strength)
  ) {
    next.biomeEdgeJitter.strength = clamp(
      profile.biomeEdgeJitter.strength,
      0,
      0.45,
    );
  }
  if (profile.landmarkFirst) {
    if (profile.landmarkFirst.enabled === true) {
      next.landmarkFirst.enabled = true;
    } else if (profile.landmarkFirst.enabled === false) {
      next.landmarkFirst.enabled = false;
    }
    if (Number.isFinite(profile.landmarkFirst.heightBlend)) {
      next.landmarkFirst.heightBlend = clamp(
        profile.landmarkFirst.heightBlend,
        0,
        1,
      );
    }
    if (Number.isFinite(profile.landmarkFirst.spineHeightBoost)) {
      next.landmarkFirst.spineHeightBoost = clamp(
        profile.landmarkFirst.spineHeightBoost,
        0,
        0.35,
      );
    }
    if (Number.isFinite(profile.landmarkFirst.ridgeHeightBoost)) {
      next.landmarkFirst.ridgeHeightBoost = clamp(
        profile.landmarkFirst.ridgeHeightBoost,
        0,
        0.35,
      );
    }
    if (Number.isFinite(profile.landmarkFirst.riverCarveStrength)) {
      next.landmarkFirst.riverCarveStrength = clamp(
        profile.landmarkFirst.riverCarveStrength,
        0,
        0.35,
      );
    }
    if (Number.isFinite(profile.landmarkFirst.mountainThresholdShift)) {
      next.landmarkFirst.mountainThresholdShift = clamp(
        profile.landmarkFirst.mountainThresholdShift,
        0,
        0.25,
      );
    }
    if (Number.isFinite(profile.landmarkFirst.hillThresholdShift)) {
      next.landmarkFirst.hillThresholdShift = clamp(
        profile.landmarkFirst.hillThresholdShift,
        0,
        0.25,
      );
    }
    if (Number.isFinite(profile.landmarkFirst.riverMountainSuppression)) {
      next.landmarkFirst.riverMountainSuppression = clamp(
        profile.landmarkFirst.riverMountainSuppression,
        0,
        0.25,
      );
    }
    if (Number.isFinite(profile.landmarkFirst.riverHillSuppression)) {
      next.landmarkFirst.riverHillSuppression = clamp(
        profile.landmarkFirst.riverHillSuppression,
        0,
        0.25,
      );
    }
    if (Number.isFinite(profile.landmarkFirst.fertileHeightBoost)) {
      next.landmarkFirst.fertileHeightBoost = clamp(
        profile.landmarkFirst.fertileHeightBoost,
        0,
        0.25,
      );
    }
    if (Number.isFinite(profile.landmarkFirst.fertileDistanceBoost)) {
      next.landmarkFirst.fertileDistanceBoost = clamp(
        profile.landmarkFirst.fertileDistanceBoost,
        0,
        8,
      );
    }
  }
  if (profile.landmarkSuitability) {
    if (profile.landmarkSuitability.forest) {
      next.forest.landmarkSuitability = normalizeBiomeLandmarkSuitability(
        profile.landmarkSuitability.forest,
        next.forest.landmarkSuitability,
      );
    }
    if (profile.landmarkSuitability.food) {
      next.food.landmarkSuitability = normalizeBiomeLandmarkSuitability(
        profile.landmarkSuitability.food,
        next.food.landmarkSuitability,
      );
    }
    if (profile.landmarkSuitability.pasture) {
      next.pasture.landmarkSuitability = normalizeBiomeLandmarkSuitability(
        profile.landmarkSuitability.pasture,
        next.pasture.landmarkSuitability,
      );
    }
  }

  return next;
}

// Function: normalizeValleySettings.
function normalizeValleySettings(raw, defaults) {
  const scale = Number(raw.noiseScale ?? defaults.scale ?? 0.06);
  const octaves = Number(raw.octaves ?? defaults.octaves ?? 4);
  const persistence = Number(raw.persistence ?? defaults.persistence ?? 0.5);
  const lacunarity = Number(raw.lacunarity ?? defaults.lacunarity ?? 2.0);
  const smoothingPasses = clamp(
    Math.floor(Number(raw.smoothingPasses ?? 3)),
    1,
    8,
  );
  const bowlStrength = clamp(Number(raw.bowlStrength ?? 0.3), 0, 1);
  const domainWarp = raw.domain_warp || raw.domainWarp || {};
  const domainWarpEnabled = domainWarp.enabled !== false;
  const domainWarpStrengthRaw = Number(domainWarp.strength ?? 1.2);
  const domainWarpStrength = Number.isFinite(domainWarpStrengthRaw)
    ? clamp(domainWarpStrengthRaw, 0, 8)
    : 0;
  const domainWarpScaleRaw = Number(domainWarp.scale ?? 0.08);
  const domainWarpScale = Number.isFinite(domainWarpScaleRaw)
    ? Math.max(0, domainWarpScaleRaw)
    : 0;
  const fantasyPresetRaw = String(
    raw.fantasyPreset ?? raw.fantasy_preset ?? "none",
  ).toLowerCase();
  const fantasyPreset = [
    "none",
    "green_realm",
    "broken_crown",
    "mistwater",
    "high_marches",
    "natural_epic",
    "heroic_contrast",
  ].includes(fantasyPresetRaw)
    ? fantasyPresetRaw
    : "none";
  const macroZones = raw.macro_zones || raw.macroZones || {};
  const macroZonesEnabled = macroZones.enabled !== false;
  const macroZonesCountRaw = Number(
    macroZones.zone_count ?? macroZones.zoneCount ?? 3,
  );
  const macroZonesCount = Number.isFinite(macroZonesCountRaw)
    ? clamp(Math.floor(macroZonesCountRaw), 2, 6)
    : 3;
  const macroZonesScaleRaw = Number(
    macroZones.scale ?? macroZones.noiseScale ?? 0.016,
  );
  const macroZonesScale = Number.isFinite(macroZonesScaleRaw)
    ? Math.max(0.001, macroZonesScaleRaw)
    : 0.016;
  const macroZonesOctavesRaw = Number(macroZones.octaves ?? 2);
  const macroZonesOctaves = Number.isFinite(macroZonesOctavesRaw)
    ? clamp(Math.floor(macroZonesOctavesRaw), 1, 6)
    : 2;
  const macroZonesPersistenceRaw = Number(macroZones.persistence ?? 0.52);
  const macroZonesPersistence = Number.isFinite(macroZonesPersistenceRaw)
    ? clamp(macroZonesPersistenceRaw, 0, 1)
    : 0.52;
  const macroZonesLacunarityRaw = Number(macroZones.lacunarity ?? 2.0);
  const macroZonesLacunarity =
    Number.isFinite(macroZonesLacunarityRaw) && macroZonesLacunarityRaw > 0
      ? macroZonesLacunarityRaw
      : 2.0;
  const macroZonesSeedOffsetRaw = Number(
    macroZones.seed_offset ?? macroZones.seedOffset ?? 1181,
  );
  const macroZonesSeedOffset = Number.isFinite(macroZonesSeedOffsetRaw)
    ? Math.floor(macroZonesSeedOffsetRaw)
    : 1181;
  const macroZonesUseDomainWarp =
    macroZones.use_domain_warp === false ||
    macroZones.useDomainWarp === false
      ? false
      : true;
  const macroZonesSoftnessRaw = Number(macroZones.softness ?? 0.45);
  const macroZonesSoftness = Number.isFinite(macroZonesSoftnessRaw)
    ? clamp(macroZonesSoftnessRaw, 0, 1)
    : 0.45;
  const macroZonesSmoothingPassesRaw = Number(
    macroZones.smoothing_passes ?? macroZones.smoothingPasses ?? 1,
  );
  const macroZonesSmoothingPasses = Number.isFinite(
    macroZonesSmoothingPassesRaw,
  )
    ? clamp(Math.floor(macroZonesSmoothingPassesRaw), 0, 4)
    : 1;
  const macroMountainHeightShiftRaw = Number(
    macroZones.mountain_height_shift ?? macroZones.mountainHeightShift ?? 0.05,
  );
  const macroMountainHeightShift = Number.isFinite(macroMountainHeightShiftRaw)
    ? clamp(macroMountainHeightShiftRaw, 0, 0.25)
    : 0.05;
  const macroHillHeightShiftRaw = Number(
    macroZones.hill_height_shift ?? macroZones.hillHeightShift ?? 0.04,
  );
  const macroHillHeightShift = Number.isFinite(macroHillHeightShiftRaw)
    ? clamp(macroHillHeightShiftRaw, 0, 0.25)
    : 0.04;
  const macroFertileHeightShiftRaw = Number(
    macroZones.fertile_height_shift ?? macroZones.fertileHeightShift ?? 0.04,
  );
  const macroFertileHeightShift = Number.isFinite(macroFertileHeightShiftRaw)
    ? clamp(macroFertileHeightShiftRaw, 0, 0.25)
    : 0.04;
  const macroFertileDistanceShiftRaw = Number(
    macroZones.fertile_distance_shift ??
      macroZones.fertileDistanceShift ??
      2,
  );
  const macroFertileDistanceShift = Number.isFinite(
    macroFertileDistanceShiftRaw,
  )
    ? clamp(macroFertileDistanceShiftRaw, 0, 8)
    : 2;
  const macroHumidityShiftRaw = Number(
    macroZones.humidity_shift ?? macroZones.humidityShift ?? 0.1,
  );
  const macroHumidityShift = Number.isFinite(macroHumidityShiftRaw)
    ? clamp(macroHumidityShiftRaw, 0, 0.45)
    : 0.1;
  const macroWaterDistanceShiftRaw = Number(
    macroZones.water_distance_shift ?? macroZones.waterDistanceShift ?? 1.4,
  );
  const macroWaterDistanceShift = Number.isFinite(macroWaterDistanceShiftRaw)
    ? clamp(macroWaterDistanceShiftRaw, 0, 8)
    : 1.4;
  const macroBiomeThresholdShiftRaw = Number(
    macroZones.biome_threshold_shift ??
      macroZones.biomeThresholdShift ??
      0.06,
  );
  const macroBiomeThresholdShift = Number.isFinite(macroBiomeThresholdShiftRaw)
    ? clamp(macroBiomeThresholdShiftRaw, 0, 0.3)
    : 0.06;
  const worldSpine = raw.world_spine || raw.worldSpine || {};
  const worldSpineEnabled = worldSpine.enabled !== false;
  const worldSpineOrientationRaw = String(
    worldSpine.orientation ?? "horizontal",
  ).toLowerCase();
  const worldSpineOrientation =
    worldSpineOrientationRaw === "vertical" ? "vertical" : "horizontal";
  const worldSpineWidthRatioRaw = Number(
    worldSpine.width_ratio ?? worldSpine.widthRatio ?? 0.24,
  );
  const worldSpineWidthRatio = Number.isFinite(worldSpineWidthRatioRaw)
    ? clamp(worldSpineWidthRatioRaw, 0.05, 0.9)
    : 0.24;
  const worldSpineCurveScaleRaw = Number(
    worldSpine.curve_scale ?? worldSpine.curveScale ?? 0.045,
  );
  const worldSpineCurveScale = Number.isFinite(worldSpineCurveScaleRaw)
    ? Math.max(0.001, worldSpineCurveScaleRaw)
    : 0.045;
  const worldSpineCurveStrengthRaw = Number(
    worldSpine.curve_strength ?? worldSpine.curveStrength ?? 0.2,
  );
  const worldSpineCurveStrength = Number.isFinite(worldSpineCurveStrengthRaw)
    ? clamp(worldSpineCurveStrengthRaw, 0, 0.45)
    : 0.2;
  const worldSpineReliefStrengthRaw = Number(
    worldSpine.relief_strength ?? worldSpine.reliefStrength ?? 0.11,
  );
  const worldSpineReliefStrength = Number.isFinite(worldSpineReliefStrengthRaw)
    ? clamp(worldSpineReliefStrengthRaw, 0, 0.35)
    : 0.11;
  const worldSpineSeedOffsetRaw = Number(
    worldSpine.seed_offset ?? worldSpine.seedOffset ?? 1549,
  );
  const worldSpineSeedOffset = Number.isFinite(worldSpineSeedOffsetRaw)
    ? Math.floor(worldSpineSeedOffsetRaw)
    : 1549;
  const worldSpineUseDomainWarp =
    worldSpine.use_domain_warp === false || worldSpine.useDomainWarp === false
      ? false
      : true;
  const waterBudget = raw.water_budget || raw.waterBudget || {};
  const waterBudgetEnabled = waterBudget.enabled !== false;
  const waterBudgetMaxRatioRaw = Number(
    waterBudget.max_ratio ?? waterBudget.maxRatio ?? 0.14,
  );
  const waterBudgetMaxRatio = Number.isFinite(waterBudgetMaxRatioRaw)
    ? clamp(waterBudgetMaxRatioRaw, 0, 0.5)
    : 0.14;
  const waterBudgetPreserveRiver =
    waterBudget.preserve_river === false || waterBudget.preserveRiver === false
      ? false
      : true;
  const biomeEdgeJitter = raw.biome_edge_jitter || raw.biomeEdgeJitter || {};
  const biomeEdgeJitterEnabled = biomeEdgeJitter.enabled !== false;
  const biomeEdgeJitterPassesRaw = Number(biomeEdgeJitter.passes ?? 1);
  const biomeEdgeJitterPasses = Number.isFinite(biomeEdgeJitterPassesRaw)
    ? clamp(Math.floor(biomeEdgeJitterPassesRaw), 0, 4)
    : 1;
  const biomeEdgeJitterStrengthRaw = Number(biomeEdgeJitter.strength ?? 0.18);
  const biomeEdgeJitterStrength = Number.isFinite(biomeEdgeJitterStrengthRaw)
    ? clamp(biomeEdgeJitterStrengthRaw, 0, 0.45)
    : 0.18;
  const biomeEdgeJitterNoiseScaleRaw = Number(
    biomeEdgeJitter.noise_scale ?? biomeEdgeJitter.noiseScale ?? 0.28,
  );
  const biomeEdgeJitterNoiseScale = Number.isFinite(
    biomeEdgeJitterNoiseScaleRaw,
  )
    ? Math.max(0.001, biomeEdgeJitterNoiseScaleRaw)
    : 0.28;
  const biomeEdgeJitterSeedOffsetRaw = Number(
    biomeEdgeJitter.seed_offset ?? biomeEdgeJitter.seedOffset ?? 1723,
  );
  const biomeEdgeJitterSeedOffset = Number.isFinite(biomeEdgeJitterSeedOffsetRaw)
    ? Math.floor(biomeEdgeJitterSeedOffsetRaw)
    : 1723;
  const biomeEdgeJitterTypesRaw = Array.isArray(
    biomeEdgeJitter.types,
  )
    ? biomeEdgeJitter.types
    : ["forest", "food", "pasture"];
  const biomeEdgeJitterTypes = biomeEdgeJitterTypesRaw
    .map((type) => String(type || "").toLowerCase())
    .filter((type) => ["forest", "food", "pasture"].includes(type));
  const landmarks = raw.landmarks || {};
  const landmarksEnabled = landmarks.enabled !== false;
  const riverSpine = landmarks.river_spine || landmarks.riverSpine || {};
  const riverSpineEnabled = riverSpine.enabled !== false;
  const riverSpineOrientationRaw = String(
    riverSpine.orientation ?? "auto",
  ).toLowerCase();
  const riverSpineOrientation = ["auto", "horizontal", "vertical"].includes(
    riverSpineOrientationRaw,
  )
    ? riverSpineOrientationRaw
    : "auto";
  const riverSpineWidthRatioRaw = Number(
    riverSpine.width_ratio ?? riverSpine.widthRatio ?? 0.2,
  );
  const riverSpineWidthRatio = Number.isFinite(riverSpineWidthRatioRaw)
    ? clamp(riverSpineWidthRatioRaw, 0.05, 0.9)
    : 0.2;
  const riverSpineCurveScaleRaw = Number(
    riverSpine.curve_scale ?? riverSpine.curveScale ?? 0.05,
  );
  const riverSpineCurveScale = Number.isFinite(riverSpineCurveScaleRaw)
    ? Math.max(0.001, riverSpineCurveScaleRaw)
    : 0.05;
  const riverSpineCurveStrengthRaw = Number(
    riverSpine.curve_strength ?? riverSpine.curveStrength ?? 0.24,
  );
  const riverSpineCurveStrength = Number.isFinite(riverSpineCurveStrengthRaw)
    ? clamp(riverSpineCurveStrengthRaw, 0, 0.45)
    : 0.24;
  const riverSpineSeedOffsetRaw = Number(
    riverSpine.seed_offset ?? riverSpine.seedOffset ?? 2191,
  );
  const riverSpineSeedOffset = Number.isFinite(riverSpineSeedOffsetRaw)
    ? Math.floor(riverSpineSeedOffsetRaw)
    : 2191;
  const riverSpineUseDomainWarp =
    riverSpine.use_domain_warp === false || riverSpine.useDomainWarp === false
      ? false
      : true;
  const riverSpineWeightRaw = Number(riverSpine.weight ?? 0.12);
  const riverSpineWeight = Number.isFinite(riverSpineWeightRaw)
    ? clamp(riverSpineWeightRaw, 0, 1)
    : 0.12;
  const riverSpineBacktrackPenaltyRaw = Number(
    riverSpine.backtrack_penalty ?? riverSpine.backtrackPenalty ?? 0.03,
  );
  const riverSpineBacktrackPenalty = Number.isFinite(
    riverSpineBacktrackPenaltyRaw,
  )
    ? clamp(riverSpineBacktrackPenaltyRaw, 0, 0.2)
    : 0.03;
  const ridgeMask = landmarks.ridge_mask || landmarks.ridgeMask || {};
  const ridgeMaskEnabled = ridgeMask.enabled !== false;
  const ridgeMaskOrientationRaw = String(
    ridgeMask.orientation ?? "auto",
  ).toLowerCase();
  const ridgeMaskOrientation = ["auto", "horizontal", "vertical"].includes(
    ridgeMaskOrientationRaw,
  )
    ? ridgeMaskOrientationRaw
    : "auto";
  const ridgeMaskWidthRatioRaw = Number(
    ridgeMask.width_ratio ?? ridgeMask.widthRatio ?? 0.19,
  );
  const ridgeMaskWidthRatio = Number.isFinite(ridgeMaskWidthRatioRaw)
    ? clamp(ridgeMaskWidthRatioRaw, 0.05, 0.9)
    : 0.19;
  const ridgeMaskCurveScaleRaw = Number(
    ridgeMask.curve_scale ?? ridgeMask.curveScale ?? 0.04,
  );
  const ridgeMaskCurveScale = Number.isFinite(ridgeMaskCurveScaleRaw)
    ? Math.max(0.001, ridgeMaskCurveScaleRaw)
    : 0.04;
  const ridgeMaskCurveStrengthRaw = Number(
    ridgeMask.curve_strength ?? ridgeMask.curveStrength ?? 0.22,
  );
  const ridgeMaskCurveStrength = Number.isFinite(ridgeMaskCurveStrengthRaw)
    ? clamp(ridgeMaskCurveStrengthRaw, 0, 0.45)
    : 0.22;
  const ridgeMaskStrengthRaw = Number(ridgeMask.strength ?? 0.09);
  const ridgeMaskStrength = Number.isFinite(ridgeMaskStrengthRaw)
    ? clamp(ridgeMaskStrengthRaw, 0, 0.35)
    : 0.09;
  const ridgeMaskMountainThresholdShiftRaw = Number(
    ridgeMask.mountain_threshold_shift ??
      ridgeMask.mountainThresholdShift ??
      0.08,
  );
  const ridgeMaskMountainThresholdShift = Number.isFinite(
    ridgeMaskMountainThresholdShiftRaw,
  )
    ? clamp(ridgeMaskMountainThresholdShiftRaw, 0, 0.25)
    : 0.08;
  const ridgeMaskHillThresholdShiftRaw = Number(
    ridgeMask.hill_threshold_shift ?? ridgeMask.hillThresholdShift ?? 0.06,
  );
  const ridgeMaskHillThresholdShift = Number.isFinite(
    ridgeMaskHillThresholdShiftRaw,
  )
    ? clamp(ridgeMaskHillThresholdShiftRaw, 0, 0.25)
    : 0.06;
  const ridgeMaskSeedOffsetRaw = Number(
    ridgeMask.seed_offset ?? ridgeMask.seedOffset ?? 2609,
  );
  const ridgeMaskSeedOffset = Number.isFinite(ridgeMaskSeedOffsetRaw)
    ? Math.floor(ridgeMaskSeedOffsetRaw)
    : 2609;
  const ridgeMaskUseDomainWarp =
    ridgeMask.use_domain_warp === false || ridgeMask.useDomainWarp === false
      ? false
      : true;
  const landmarkFirst = raw.landmark_first || raw.landmarkFirst || {};
  const landmarkFirstEnabled = landmarkFirst.enabled === true;
  const landmarkFirstHeightBlendRaw = Number(
    landmarkFirst.height_blend ?? landmarkFirst.heightBlend ?? 0.65,
  );
  const landmarkFirstHeightBlend = Number.isFinite(landmarkFirstHeightBlendRaw)
    ? clamp(landmarkFirstHeightBlendRaw, 0, 1)
    : 0.65;
  const landmarkFirstSpineHeightBoostRaw = Number(
    landmarkFirst.spine_height_boost ??
      landmarkFirst.spineHeightBoost ??
      0.12,
  );
  const landmarkFirstSpineHeightBoost = Number.isFinite(
    landmarkFirstSpineHeightBoostRaw,
  )
    ? clamp(landmarkFirstSpineHeightBoostRaw, 0, 0.35)
    : 0.12;
  const landmarkFirstRidgeHeightBoostRaw = Number(
    landmarkFirst.ridge_height_boost ??
      landmarkFirst.ridgeHeightBoost ??
      0.2,
  );
  const landmarkFirstRidgeHeightBoost = Number.isFinite(
    landmarkFirstRidgeHeightBoostRaw,
  )
    ? clamp(landmarkFirstRidgeHeightBoostRaw, 0, 0.35)
    : 0.2;
  const landmarkFirstRiverCarveStrengthRaw = Number(
    landmarkFirst.river_carve_strength ??
      landmarkFirst.riverCarveStrength ??
      0.18,
  );
  const landmarkFirstRiverCarveStrength = Number.isFinite(
    landmarkFirstRiverCarveStrengthRaw,
  )
    ? clamp(landmarkFirstRiverCarveStrengthRaw, 0, 0.35)
    : 0.18;
  const landmarkFirstMountainThresholdShiftRaw = Number(
    landmarkFirst.mountain_threshold_shift ??
      landmarkFirst.mountainThresholdShift ??
      0.08,
  );
  const landmarkFirstMountainThresholdShift = Number.isFinite(
    landmarkFirstMountainThresholdShiftRaw,
  )
    ? clamp(landmarkFirstMountainThresholdShiftRaw, 0, 0.25)
    : 0.08;
  const landmarkFirstHillThresholdShiftRaw = Number(
    landmarkFirst.hill_threshold_shift ??
      landmarkFirst.hillThresholdShift ??
      0.06,
  );
  const landmarkFirstHillThresholdShift = Number.isFinite(
    landmarkFirstHillThresholdShiftRaw,
  )
    ? clamp(landmarkFirstHillThresholdShiftRaw, 0, 0.25)
    : 0.06;
  const landmarkFirstRiverMountainSuppressionRaw = Number(
    landmarkFirst.river_mountain_suppression ??
      landmarkFirst.riverMountainSuppression ??
      0.1,
  );
  const landmarkFirstRiverMountainSuppression = Number.isFinite(
    landmarkFirstRiverMountainSuppressionRaw,
  )
    ? clamp(landmarkFirstRiverMountainSuppressionRaw, 0, 0.25)
    : 0.1;
  const landmarkFirstRiverHillSuppressionRaw = Number(
    landmarkFirst.river_hill_suppression ??
      landmarkFirst.riverHillSuppression ??
      0.08,
  );
  const landmarkFirstRiverHillSuppression = Number.isFinite(
    landmarkFirstRiverHillSuppressionRaw,
  )
    ? clamp(landmarkFirstRiverHillSuppressionRaw, 0, 0.25)
    : 0.08;
  const landmarkFirstFertileHeightBoostRaw = Number(
    landmarkFirst.fertile_height_boost ??
      landmarkFirst.fertileHeightBoost ??
      0.05,
  );
  const landmarkFirstFertileHeightBoost = Number.isFinite(
    landmarkFirstFertileHeightBoostRaw,
  )
    ? clamp(landmarkFirstFertileHeightBoostRaw, 0, 0.25)
    : 0.05;
  const landmarkFirstFertileDistanceBoostRaw = Number(
    landmarkFirst.fertile_distance_boost ??
      landmarkFirst.fertileDistanceBoost ??
      2,
  );
  const landmarkFirstFertileDistanceBoost = Number.isFinite(
    landmarkFirstFertileDistanceBoostRaw,
  )
    ? clamp(landmarkFirstFertileDistanceBoostRaw, 0, 8)
    : 2;
  const biomeNoise = raw.biome_noise || raw.biomeNoise || {};
  const biomeNoiseEnabled = biomeNoise.enabled !== false;
  const biomeNoiseScaleRaw = Number(biomeNoise.scale ?? 0.05);
  const biomeNoiseScale = Number.isFinite(biomeNoiseScaleRaw)
    ? Math.max(0.001, biomeNoiseScaleRaw)
    : 0.05;
  const biomeNoiseOctavesRaw = Number(biomeNoise.octaves ?? 2);
  const biomeNoiseOctaves = Number.isFinite(biomeNoiseOctavesRaw)
    ? clamp(Math.floor(biomeNoiseOctavesRaw), 1, 8)
    : 2;
  const biomeNoisePersistenceRaw = Number(biomeNoise.persistence ?? 0.5);
  const biomeNoisePersistence = Number.isFinite(biomeNoisePersistenceRaw)
    ? clamp(biomeNoisePersistenceRaw, 0, 1)
    : 0.5;
  const biomeNoiseLacunarityRaw = Number(biomeNoise.lacunarity ?? 2.0);
  const biomeNoiseLacunarity =
    Number.isFinite(biomeNoiseLacunarityRaw) && biomeNoiseLacunarityRaw > 0
      ? biomeNoiseLacunarityRaw
      : 2.0;
  const biomeNoiseSeedOffsetRaw = Number(
    biomeNoise.seed_offset ?? biomeNoise.seedOffset ?? 0,
  );
  const biomeNoiseSeedOffset = Number.isFinite(biomeNoiseSeedOffsetRaw)
    ? Math.floor(biomeNoiseSeedOffsetRaw)
    : 0;
  const biomeNoiseUseDomainWarp =
    biomeNoise.use_domain_warp === false ||
    biomeNoise.useDomainWarp === false
      ? false
      : true;
  const biomeNoiseHeightStrengthRaw = Number(
    biomeNoise.height_strength ?? biomeNoise.heightStrength ?? 0,
  );
  const biomeNoiseHeightStrength = Number.isFinite(biomeNoiseHeightStrengthRaw)
    ? clamp(biomeNoiseHeightStrengthRaw, 0, 0.25)
    : 0;
  const biomeNoiseDistanceStrengthRaw = Number(
    biomeNoise.distance_strength ?? biomeNoise.distanceStrength ?? 0,
  );
  const biomeNoiseDistanceStrength = Number.isFinite(
    biomeNoiseDistanceStrengthRaw,
  )
    ? clamp(biomeNoiseDistanceStrengthRaw, 0, 12)
    : 0;
  const biomeNoiseThresholdStrengthRaw = Number(
    biomeNoise.noise_threshold_strength ?? biomeNoise.noiseThresholdStrength ?? 0,
  );
  const biomeNoiseThresholdStrength = Number.isFinite(
    biomeNoiseThresholdStrengthRaw,
  )
    ? clamp(biomeNoiseThresholdStrengthRaw, 0, 0.4)
    : 0;
  const mountainHeight = clamp(Number(raw.mountainHeight ?? 0.8), 0, 1);
  const hillHeight = clamp(Number(raw.hillHeight ?? 0.66), 0, 1);
  const fertileHeight = clamp(Number(raw.fertileHeight ?? 0.46), 0, 1);
  const fertileDistance = clamp(
    Math.floor(Number(raw.fertileDistance ?? 3)),
    0,
    10,
  );
  const humidityDecay = Math.max(1, Number(raw.humidityDecay ?? 6));
  const diagonalRaw = Number(raw.waterDistanceDiagonalWeight ?? 1);
  const waterDistanceDiagonalWeight = Number.isFinite(diagonalRaw)
    ? clamp(diagonalRaw, 0, 2)
    : 1;
  const waterDistanceJitterRaw = Number(
    raw.water_distance_jitter ?? raw.waterDistanceJitter ?? 0.6,
  );
  const waterDistanceJitter = Number.isFinite(waterDistanceJitterRaw)
    ? clamp(waterDistanceJitterRaw, 0, 12)
    : 0;
  const waterDistanceNoiseScaleRaw = Number(
    raw.water_distance_noise_scale ?? raw.waterDistanceNoiseScale ?? 0.2,
  );
  const waterDistanceNoiseScale = Number.isFinite(waterDistanceNoiseScaleRaw)
    ? Math.max(0.001, waterDistanceNoiseScaleRaw)
    : 0.2;
  const riverBias = raw.riverBias || {};
  const riverCount = clamp(Math.floor(Number(raw.riverCount ?? 1)), 1, 4);
  const riverSourceMinDistance = clamp(
    Math.floor(Number(raw.riverSourceMinDistance ?? 6)),
    0,
    50,
  );
  const riverWander = clamp(Number(raw.riverWander ?? 0.25), 0, 1);
  const riverSourceSides = Array.isArray(raw.riverSourceSides)
    ? raw.riverSourceSides
        .map((side) => String(side || "").toLowerCase())
        .filter((side) => ["north", "south", "east", "west"].includes(side))
    : ["north", "south", "east", "west"];
  const riverValleyDrop = Math.max(0, Number(raw.riverValleyDrop ?? 0.22));
  const riverValleyDropAdjacent = Math.max(
    0,
    Number(raw.riverValleyDropAdjacent ?? 0.1),
  );
  const lakeDepth = Math.max(0, Number(raw.lakeDepth ?? 0.02));
  const lakeThreshold = Math.max(0, Number(raw.lakeThreshold ?? 0.03));
  const lakePatch = raw.lakePatch || {};
  const lakePatchRadiusMinRaw = Number(lakePatch.radiusMin ?? 3);
  const lakePatchRadiusMin = Number.isFinite(lakePatchRadiusMinRaw)
    ? clamp(Math.floor(lakePatchRadiusMinRaw), 1, 10)
    : 3;
  const lakePatchRadiusMaxRaw = Number(lakePatch.radiusMax ?? 6);
  const lakePatchRadiusMax = Number.isFinite(lakePatchRadiusMaxRaw)
    ? clamp(Math.floor(lakePatchRadiusMaxRaw), lakePatchRadiusMin, 14)
    : Math.max(lakePatchRadiusMin, 6);
  const lakePatchEdgeJaggednessRaw = Number(
    lakePatch.edge_jaggedness ?? lakePatch.edgeJaggedness ?? 0,
  );
  const lakePatchEdgeNoiseScaleRaw = Number(
    lakePatch.edge_noise_scale ?? lakePatch.edgeNoiseScale ?? 0,
  );
  const lakePatchEdgeAspectRaw = Number(
    lakePatch.edge_aspect ?? lakePatch.edgeAspect ?? 0,
  );
  const ponds = raw.ponds || {};
  const pondsEnabled = ponds.enabled !== false;
  const pondsCountRaw = Number(ponds.count ?? 2);
  const pondsCount = Number.isFinite(pondsCountRaw)
    ? clamp(Math.floor(pondsCountRaw), 0, 6)
    : 2;
  const pondsRadiusMinRaw = Number(ponds.radiusMin ?? 2);
  const pondsRadiusMin = Number.isFinite(pondsRadiusMinRaw)
    ? clamp(Math.floor(pondsRadiusMinRaw), 1, 8)
    : 2;
  const pondsRadiusMaxRaw = Number(ponds.radiusMax ?? 4);
  const pondsRadiusMax = Number.isFinite(pondsRadiusMaxRaw)
    ? clamp(Math.floor(pondsRadiusMaxRaw), pondsRadiusMin, 10)
    : Math.max(pondsRadiusMin, 4);
  const pondsBufferRaw = Number(ponds.buffer ?? 3);
  const pondsBuffer = Number.isFinite(pondsBufferRaw)
    ? clamp(Math.floor(pondsBufferRaw), 0, 12)
    : 3;
  const pondsHeightMaxRaw = Number(ponds.heightMax ?? 0.55);
  const pondsHeightMax = Number.isFinite(pondsHeightMaxRaw)
    ? clamp(pondsHeightMaxRaw, 0, 1)
    : 0.55;
  const pondsEdgeJaggednessRaw = Number(
    ponds.edge_jaggedness ?? ponds.edgeJaggedness ?? 0,
  );
  const pondsEdgeNoiseScaleRaw = Number(
    ponds.edge_noise_scale ?? ponds.edgeNoiseScale ?? 0,
  );
  const pondsEdgeAspectRaw = Number(
    ponds.edge_aspect ?? ponds.edgeAspect ?? 0,
  );
  const forest = raw.forest || {};
  const forestNoiseScale = Math.max(0.01, Number(forest.noiseScale ?? 0.11));
  const forestWaterDistanceMin = clamp(
    Math.floor(Number(forest.waterDistanceMin ?? 0)),
    0,
    10,
  );
  const forestWaterDistanceMaxRaw = clamp(
    Math.floor(Number(forest.waterDistanceMax ?? 4)),
    0,
    12,
  );
  const forestWaterDistanceMax = Math.max(
    forestWaterDistanceMin,
    forestWaterDistanceMaxRaw,
  );
  const forestWaterDistanceJitter = Math.max(
    0,
    Number(forest.waterDistanceJitter ?? 0),
  );
  const forestWaterDistanceNoiseScale = Math.max(
    0.001,
    Number(forest.waterDistanceNoiseScale ?? forestNoiseScale),
  );
  const forestEdgeDistanceRaw = Number(
    forest.edge_distance ?? forest.edgeDistance ?? 0,
  );
  const forestEdgeDistance = Number.isFinite(forestEdgeDistanceRaw)
    ? clamp(Math.floor(forestEdgeDistanceRaw), 0, 12)
    : 0;
  const forestEdgeJitterRaw = Number(
    forest.edge_jitter ?? forest.edgeJitter ?? 0,
  );
  const forestEdgeJitter = Number.isFinite(forestEdgeJitterRaw)
    ? clamp(forestEdgeJitterRaw, 0, 1)
    : 0;
  const forestEdgeNoiseScaleRaw = Number(
    forest.edge_noise_scale ?? forest.edgeNoiseScale ?? forestNoiseScale,
  );
  const forestEdgeNoiseScale = Number.isFinite(forestEdgeNoiseScaleRaw)
    ? Math.max(0.001, forestEdgeNoiseScaleRaw)
    : forestNoiseScale;
  const forestNaturalSpread =
    forest.natural_spread || forest.naturalSpread || {};
  const forestNaturalSpreadNoiseScaleRaw = Number(
    forestNaturalSpread.noise_scale ??
      forestNaturalSpread.noiseScale ??
      0.045,
  );
  const forestNaturalSpreadNoiseThresholdRaw = Number(
    forestNaturalSpread.noise_threshold ??
      forestNaturalSpread.noiseThreshold ??
      0.6,
  );
  const forestNaturalSpreadMaxExtraDistanceRaw = Number(
    forestNaturalSpread.max_extra_distance ??
      forestNaturalSpread.maxExtraDistance ??
      5,
  );
  const forestNaturalSpreadHumidityRelaxRaw = Number(
    forestNaturalSpread.humidity_relax ??
      forestNaturalSpread.humidityRelax ??
      0.05,
  );
  const forestNaturalSpreadHumidityFloorRaw = Number(
    forestNaturalSpread.humidity_floor ??
      forestNaturalSpread.humidityFloor ??
      0.2,
  );
  const forestNaturalSpreadThresholdBoostRaw = Number(
    forestNaturalSpread.noise_threshold_boost ??
      forestNaturalSpread.noiseThresholdBoost ??
      0.1,
  );
  const forestNaturalSpreadEnabled = forestNaturalSpread.enabled !== false;
  const forestNaturalSpreadNoiseScale = Number.isFinite(
    forestNaturalSpreadNoiseScaleRaw,
  )
    ? Math.max(0.001, forestNaturalSpreadNoiseScaleRaw)
    : 0.045;
  const forestNaturalSpreadNoiseThreshold = Number.isFinite(
    forestNaturalSpreadNoiseThresholdRaw,
  )
    ? clamp(forestNaturalSpreadNoiseThresholdRaw, 0, 1)
    : 0.6;
  const forestNaturalSpreadMaxExtraDistance = Number.isFinite(
    forestNaturalSpreadMaxExtraDistanceRaw,
  )
    ? clamp(forestNaturalSpreadMaxExtraDistanceRaw, 0, 20)
    : 5;
  const forestNaturalSpreadHumidityRelax = Number.isFinite(
    forestNaturalSpreadHumidityRelaxRaw,
  )
    ? clamp(forestNaturalSpreadHumidityRelaxRaw, 0, 0.35)
    : 0.05;
  const forestNaturalSpreadHumidityFloor = Number.isFinite(
    forestNaturalSpreadHumidityFloorRaw,
  )
    ? clamp(forestNaturalSpreadHumidityFloorRaw, 0, 1)
    : 0.2;
  const forestNaturalSpreadThresholdBoost = Number.isFinite(
    forestNaturalSpreadThresholdBoostRaw,
  )
    ? clamp(forestNaturalSpreadThresholdBoostRaw, 0, 0.35)
    : 0.1;
  const stone = raw.stone || {};
  const food = raw.food || {};
  const pasture = raw.pasture || {};
  const pasturePatches = pasture.patches || {};
  const forestLandmarkSuitability = normalizeBiomeLandmarkSuitability(
    forest.landmark_suitability ?? forest.landmarkSuitability,
    {
      riverSpineAffinity: -0.38,
      ridgeAffinity: 0.42,
      waterDistanceShift: 1.8,
      humidityShift: 0.06,
      noiseThresholdShift: -0.04,
    },
  );
  const foodLandmarkSuitability = normalizeBiomeLandmarkSuitability(
    food.landmark_suitability ?? food.landmarkSuitability,
    {
      riverSpineAffinity: 0.52,
      ridgeAffinity: -0.3,
      waterDistanceShift: 1.8,
      humidityShift: 0.07,
      noiseThresholdShift: -0.05,
    },
  );
  const pastureLandmarkSuitability = normalizeBiomeLandmarkSuitability(
    pasture.landmark_suitability ?? pasture.landmarkSuitability,
    {
      riverSpineAffinity: 0.2,
      ridgeAffinity: -0.15,
      waterDistanceShift: 1.2,
      humidityShift: 0.05,
      noiseThresholdShift: -0.03,
    },
  );

  const normalizedValley = {
    noiseScale: Number.isFinite(scale) && scale > 0 ? scale : 0.06,
    octaves: Number.isFinite(octaves) ? clamp(Math.floor(octaves), 1, 8) : 4,
    persistence: Number.isFinite(persistence) ? clamp(persistence, 0, 1) : 0.5,
    lacunarity:
      Number.isFinite(lacunarity) && lacunarity > 0 ? lacunarity : 2.0,
    fantasyPreset,
    smoothingPasses,
    bowlStrength,
    domainWarp: {
      enabled: domainWarpEnabled,
      strength: domainWarpStrength,
      scale: domainWarpScale,
    },
    macroZones: {
      enabled: macroZonesEnabled,
      zoneCount: macroZonesCount,
      scale: macroZonesScale,
      octaves: macroZonesOctaves,
      persistence: macroZonesPersistence,
      lacunarity: macroZonesLacunarity,
      seedOffset: macroZonesSeedOffset,
      useDomainWarp: macroZonesUseDomainWarp,
      softness: macroZonesSoftness,
      smoothingPasses: macroZonesSmoothingPasses,
      mountainHeightShift: macroMountainHeightShift,
      hillHeightShift: macroHillHeightShift,
      fertileHeightShift: macroFertileHeightShift,
      fertileDistanceShift: macroFertileDistanceShift,
      humidityShift: macroHumidityShift,
      waterDistanceShift: macroWaterDistanceShift,
      biomeThresholdShift: macroBiomeThresholdShift,
    },
    worldSpine: {
      enabled: worldSpineEnabled,
      orientation: worldSpineOrientation,
      widthRatio: worldSpineWidthRatio,
      curveScale: worldSpineCurveScale,
      curveStrength: worldSpineCurveStrength,
      reliefStrength: worldSpineReliefStrength,
      seedOffset: worldSpineSeedOffset,
      useDomainWarp: worldSpineUseDomainWarp,
    },
    waterBudget: {
      enabled: waterBudgetEnabled,
      maxRatio: waterBudgetMaxRatio,
      preserveRiver: waterBudgetPreserveRiver,
    },
    landmarks: {
      enabled: landmarksEnabled,
      riverSpine: {
        enabled: riverSpineEnabled,
        orientation: riverSpineOrientation,
        widthRatio: riverSpineWidthRatio,
        curveScale: riverSpineCurveScale,
        curveStrength: riverSpineCurveStrength,
        seedOffset: riverSpineSeedOffset,
        useDomainWarp: riverSpineUseDomainWarp,
        weight: riverSpineWeight,
        backtrackPenalty: riverSpineBacktrackPenalty,
      },
      ridgeMask: {
        enabled: ridgeMaskEnabled,
        orientation: ridgeMaskOrientation,
        widthRatio: ridgeMaskWidthRatio,
        curveScale: ridgeMaskCurveScale,
        curveStrength: ridgeMaskCurveStrength,
        strength: ridgeMaskStrength,
        mountainThresholdShift: ridgeMaskMountainThresholdShift,
        hillThresholdShift: ridgeMaskHillThresholdShift,
        seedOffset: ridgeMaskSeedOffset,
        useDomainWarp: ridgeMaskUseDomainWarp,
      },
    },
    landmarkFirst: {
      enabled: landmarkFirstEnabled,
      heightBlend: landmarkFirstHeightBlend,
      spineHeightBoost: landmarkFirstSpineHeightBoost,
      ridgeHeightBoost: landmarkFirstRidgeHeightBoost,
      riverCarveStrength: landmarkFirstRiverCarveStrength,
      mountainThresholdShift: landmarkFirstMountainThresholdShift,
      hillThresholdShift: landmarkFirstHillThresholdShift,
      riverMountainSuppression: landmarkFirstRiverMountainSuppression,
      riverHillSuppression: landmarkFirstRiverHillSuppression,
      fertileHeightBoost: landmarkFirstFertileHeightBoost,
      fertileDistanceBoost: landmarkFirstFertileDistanceBoost,
    },
    biomeEdgeJitter: {
      enabled: biomeEdgeJitterEnabled,
      passes: biomeEdgeJitterPasses,
      strength: biomeEdgeJitterStrength,
      noiseScale: biomeEdgeJitterNoiseScale,
      seedOffset: biomeEdgeJitterSeedOffset,
      types:
        biomeEdgeJitterTypes.length > 0
          ? biomeEdgeJitterTypes
          : ["forest", "food", "pasture"],
    },
    biomeNoise: {
      enabled: biomeNoiseEnabled,
      scale: biomeNoiseScale,
      octaves: biomeNoiseOctaves,
      persistence: biomeNoisePersistence,
      lacunarity: biomeNoiseLacunarity,
      seedOffset: biomeNoiseSeedOffset,
      useDomainWarp: biomeNoiseUseDomainWarp,
      heightStrength: biomeNoiseHeightStrength,
      distanceStrength: biomeNoiseDistanceStrength,
      noiseThresholdStrength: biomeNoiseThresholdStrength,
    },
    mountainHeight: Math.max(hillHeight, mountainHeight),
    hillHeight: Math.min(hillHeight, mountainHeight),
    fertileHeight,
    fertileDistance,
    humidityDecay,
    waterDistanceDiagonalWeight,
    waterDistanceJitter,
    waterDistanceNoiseScale,
    riverBias: {
      east: Number(riverBias.east ?? -0.02),
      south: Number(riverBias.south ?? -0.01),
      west: Number(riverBias.west ?? 0.02),
      north: Number(riverBias.north ?? 0.03),
    },
    riverCount,
    riverSourceMinDistance,
    riverWander,
    riverSourceSides:
      riverSourceSides.length > 0
        ? riverSourceSides
        : ["north", "south", "east", "west"],
    riverValleyDrop,
    riverValleyDropAdjacent,
    lakeDepth,
    lakeThreshold,
    lakePatch: {
      radiusMin: lakePatchRadiusMin,
      radiusMax: lakePatchRadiusMax,
      edgeJaggedness: Number.isFinite(lakePatchEdgeJaggednessRaw)
        ? clamp(lakePatchEdgeJaggednessRaw, 0, 1)
        : 0,
      edgeNoiseScale: Number.isFinite(lakePatchEdgeNoiseScaleRaw)
        ? Math.max(0, lakePatchEdgeNoiseScaleRaw)
        : 0,
      edgeAspect: Number.isFinite(lakePatchEdgeAspectRaw)
        ? clamp(lakePatchEdgeAspectRaw, 0, 1)
        : 0,
    },
    ponds: {
      enabled: pondsEnabled,
      count: pondsCount,
      radiusMin: pondsRadiusMin,
      radiusMax: pondsRadiusMax,
      buffer: pondsBuffer,
      heightMax: pondsHeightMax,
      edgeJaggedness: Number.isFinite(pondsEdgeJaggednessRaw)
        ? clamp(pondsEdgeJaggednessRaw, 0, 1)
        : 0,
      edgeNoiseScale: Number.isFinite(pondsEdgeNoiseScaleRaw)
        ? Math.max(0, pondsEdgeNoiseScaleRaw)
        : 0,
      edgeAspect: Number.isFinite(pondsEdgeAspectRaw)
        ? clamp(pondsEdgeAspectRaw, 0, 1)
        : 0,
    },
    forest: {
      humidityMin: clamp(Number(forest.humidityMin ?? 0.43), 0, 1),
      heightMax: clamp(Number(forest.heightMax ?? 0.72), 0, 1),
      waterDistanceMin: forestWaterDistanceMin,
      waterDistanceMax: forestWaterDistanceMax,
      waterDistanceJitter: forestWaterDistanceJitter,
      waterDistanceNoiseScale: forestWaterDistanceNoiseScale,
      edgeDistance: forestEdgeDistance,
      edgeJitter: forestEdgeJitter,
      edgeNoiseScale: forestEdgeNoiseScale,
      noiseScale: forestNoiseScale,
      noiseThreshold: clamp(Number(forest.noiseThreshold ?? 0.6), 0, 1),
      clusterPasses: clamp(Math.floor(Number(forest.clusterPasses ?? 2)), 0, 5),
      naturalSpread: {
        enabled: forestNaturalSpreadEnabled,
        noiseScale: forestNaturalSpreadNoiseScale,
        noiseThreshold: forestNaturalSpreadNoiseThreshold,
        maxExtraDistance: forestNaturalSpreadMaxExtraDistance,
        humidityRelax: forestNaturalSpreadHumidityRelax,
        humidityFloor: forestNaturalSpreadHumidityFloor,
        noiseThresholdBoost: forestNaturalSpreadThresholdBoost,
      },
      landmarkSuitability: forestLandmarkSuitability,
    },
    food: {
      humidityMin: clamp(Number(food.humidityMin ?? 0.4), 0, 1),
      waterDistanceMax: clamp(
        Math.floor(Number(food.waterDistanceMax ?? 5)),
        0,
        12,
      ),
      noiseScale: Math.max(0.01, Number(food.noiseScale ?? 0.12)),
      noiseThreshold: clamp(Number(food.noiseThreshold ?? 0.7), 0, 1),
      clusterPasses: clamp(Math.floor(Number(food.clusterPasses ?? 1)), 0, 5),
      minTiles: Math.max(0, Math.floor(Number(food.minTiles ?? 0))),
      minTilesWaterDistanceMax: Number.isFinite(food.minTilesWaterDistanceMax)
        ? clamp(Math.floor(Number(food.minTilesWaterDistanceMax)), 0, 12)
        : undefined,
      landmarkSuitability: foodLandmarkSuitability,
    },
    pasture: {
      humidityMin: clamp(Number(pasture.humidityMin ?? 0.33), 0, 1),
      waterDistanceMax: clamp(
        Math.floor(Number(pasture.waterDistanceMax ?? 6)),
        0,
        12,
      ),
      noiseScale: Math.max(0.01, Number(pasture.noiseScale ?? 0.1)),
      noiseThreshold: clamp(Number(pasture.noiseThreshold ?? 0.65), 0, 1),
      clusterPasses: clamp(Math.floor(Number(pasture.clusterPasses ?? 1)), 0, 5),
      patches: (() => {
        const count = Number.isFinite(Number(pasturePatches.count))
          ? clamp(Math.floor(Number(pasturePatches.count)), 0, 50)
          : 0;
        const radiusMin = Number.isFinite(Number(pasturePatches.radiusMin))
          ? clamp(Math.floor(Number(pasturePatches.radiusMin)), 1, 12)
          : 3;
        const radiusMaxRaw = Number.isFinite(Number(pasturePatches.radiusMax))
          ? clamp(Math.floor(Number(pasturePatches.radiusMax)), 1, 20)
          : 6;
        const radiusMax = Math.max(radiusMin, radiusMaxRaw);
        const fill = clamp(Number(pasturePatches.fill ?? 0.8), 0, 1);
        return {
          count,
          radiusMin,
          radiusMax,
          fill,
        };
      })(),
      landmarkSuitability: pastureLandmarkSuitability,
    },
    stone: {
      heightMin: clamp(Number(stone.heightMin ?? 0.58), 0, 1),
      noiseScale: Math.max(0.01, Number(stone.noiseScale ?? 0.13)),
      noiseThreshold: clamp(Number(stone.noiseThreshold ?? 0.64), 0, 1),
      clusterPasses: clamp(Math.floor(Number(stone.clusterPasses ?? 1)), 0, 4),
    },
  };

  return applyFantasyPresetToValley(normalizedValley);
}

// Function: normalizeWalkableSettings.
function normalizeWalkableSettings(raw) {
  return {
    water: raw.water === true ? true : false,
    river: raw.river === true ? true : false,
    lake: raw.lake === true ? true : false,
    shore: raw.shore !== false,
    grass: raw.grass !== false,
    mountain: raw.mountain === true ? true : false,
    hill: raw.hill !== false,
    plain: raw.plain !== false,
    fertile: raw.fertile !== false,
    forest: raw.forest !== false,
    food: raw.food !== false,
    pasture: raw.pasture !== false,
    stone: raw.stone !== false,
  };
}

// Function: pickSymbol.
function pickSymbol(value, fallback) {
  const str = String(value ?? fallback);
  return str.length > 0 ? str[0] : fallback;
}

// Function: resolveTerrainSeed.
function resolveTerrainSeed(rawSeed, previousTerrain, runtime) {
  const parsed = Number(rawSeed ?? 0);
  const explicit = Number.isFinite(parsed) ? Math.floor(parsed) : 0;
  if (explicit !== 0) {
    return explicit >>> 0;
  }
  const previous =
    previousTerrain && Number.isFinite(previousTerrain.seed)
      ? Number(previousTerrain.seed)
      : 0;
  if (previous) {
    return previous >>> 0;
  }
  const rand = Math.floor(Math.random() * 4294967295) >>> 0;
  const mixed = (rand ^ (runtime.gridWidth << 16) ^ runtime.gridHeight) >>> 0;
  return mixed || 1;
}

// Function: buildLakeEdgeConfig.
function buildLakeEdgeConfig(source, rng, seedOffset) {
  if (!source) {
    return null;
  }
  const jaggednessRaw = Number(source.edgeJaggedness ?? 0);
  const noiseScaleRaw = Number(source.edgeNoiseScale ?? 0);
  const aspectRaw = Number(source.edge_aspect ?? source.edgeAspect ?? 0);
  const jaggedness = Number.isFinite(jaggednessRaw)
    ? clamp(jaggednessRaw, 0, 1)
    : 0;
  const noiseScale = Number.isFinite(noiseScaleRaw)
    ? Math.max(0, noiseScaleRaw)
    : 0;
  const aspect = Number.isFinite(aspectRaw) ? clamp(aspectRaw, 0, 1) : 0;
  const hasJagged = jaggedness > 0 && noiseScale > 0;
  const hasAspect = aspect > 0;
  if (!hasJagged && !hasAspect) {
    return null;
  }
  const random = typeof rng === "function" ? rng : Math.random;
  const offset = Number.isFinite(seedOffset) ? Math.floor(seedOffset) : 0;
  const seed = hasJagged ? Math.floor(random() * 2147483647) + offset : 0;
  let stretchX = 1;
  let stretchY = 1;
  let cos = 1;
  let sin = 0;
  if (hasAspect) {
    const ratio = 1 + (random() * 2 - 1) * aspect;
    const angle = random() * Math.PI * 2;
    cos = Math.cos(angle);
    sin = Math.sin(angle);
    const safe = Math.max(0.35, ratio);
    stretchX = safe;
    stretchY = Math.max(0.35, 1 / safe);
  }
  return {
    jaggedness,
    noiseScale: hasJagged ? noiseScale : 0,
    seed,
    stretchX,
    stretchY,
    cos,
    sin,
  };
}

// Function: isJaggedEdgeEnabled.
function isJaggedEdgeEnabled(edge) {
  return Boolean(edge && edge.jaggedness > 0 && edge.noiseScale > 0);
}

// Function: getJaggedRadius.
function getJaggedRadius(radius, edge, x, y) {
  if (!isJaggedEdgeEnabled(edge)) {
    return radius;
  }
  const noise = smoothValueNoise(x * edge.noiseScale, y * edge.noiseScale, edge.seed);
  const offset = (noise - 0.5) * 2 * edge.jaggedness * radius;
  return Math.max(1, radius + offset);
}

function getMaxEdgeStretch(edge) {
  if (!edge || !Number.isFinite(edge.stretchX) || !Number.isFinite(edge.stretchY)) {
    return 1;
  }
  return Math.max(1, edge.stretchX, edge.stretchY);
}

function computeEdgeDistanceSquared(dx, dy, edge) {
  if (!edge || !Number.isFinite(edge.stretchX) || !Number.isFinite(edge.stretchY)) {
    return dx * dx + dy * dy;
  }
  const cos = Number.isFinite(edge.cos) ? edge.cos : 1;
  const sin = Number.isFinite(edge.sin) ? edge.sin : 0;
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  const sx = edge.stretchX || 1;
  const sy = edge.stretchY || 1;
  const ex = rx / sx;
  const ey = ry / sy;
  return ex * ex + ey * ey;
}

// Function: buildWalkableMap.
function buildWalkableMap(types, walkableConfig) {
  const height = types.length;
  const width = height > 0 ? types[0].length : 0;
  const map = Array.from({ length: height }, () => new Array(width).fill(true));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const type = types[y][x];
      const allowed =
        walkableConfig && walkableConfig[type] !== undefined
          ? walkableConfig[type]
          : true;
      map[y][x] = Boolean(allowed);
    }
  }
  return map;
}

// Function: buildSpawnableMap.
function buildSpawnableMap(walkable) {
  if (!walkable || walkable.length === 0) {
    return null;
  }
  const height = walkable.length;
  const width = walkable[0].length || 0;
  if (width <= 0) {
    return null;
  }
  const start = findNearestWalkable(
    walkable,
    Math.floor(width / 2),
    Math.floor(height / 2),
  );
  if (!start) {
    return null;
  }

  const spawnable = Array.from({ length: height }, () =>
    new Array(width).fill(false),
  );
  const queue = [start];
  spawnable[start.y][start.x] = true;

  while (queue.length > 0) {
    const current = queue.shift();
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

// Function: findNearestWalkable.
function findNearestWalkable(walkable, startX, startY) {
  const height = walkable.length;
  const width = walkable[0].length || 0;
  if (height === 0 || width === 0) {
    return null;
  }
  const queue = [{ x: startX, y: startY }];
  const visited = Array.from({ length: height }, () =>
    new Array(width).fill(false),
  );
  visited[startY][startX] = true;

  while (queue.length > 0) {
    const current = queue.shift();
    if (walkable[current.y][current.x]) {
      return current;
    }
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
      visited[next.y][next.x] = true;
      queue.push(next);
    }
  }
  return null;
}

// Function: getTerrainSpawnPredicate.
function getTerrainSpawnPredicate(terrain) {
  if (!terrain || !terrain.spawnable) {
    return null;
  }
  return (x, y) => Boolean(terrain.spawnable[y] && terrain.spawnable[y][x]);
}

// Function: getTerrainResourcePredicate.
function getTerrainResourcePredicate(terrain, terrainAllowed, resourceId) {
  if (!terrain) {
    return null;
  }
  const allowedTypes = Array.isArray(
    terrainAllowed && terrainAllowed[resourceId],
  )
    ? terrainAllowed[resourceId]
    : null;
  const allowedSet = allowedTypes ? new Set(allowedTypes) : null;
  const spawnable = terrain.spawnable;
  const walkableTypes = terrain.walkableTypes || {};
  return (x, y) => {
    if (spawnable && (!spawnable[y] || !spawnable[y][x])) {
      return false;
    }
    if (!allowedSet) {
      return true;
    }
    const type = terrain.types && terrain.types[y] ? terrain.types[y][x] : null;
    const walkableHere =
      !terrain.walkable || (terrain.walkable[y] && terrain.walkable[y][x]);
    if (
      allowedSet.has(type) &&
      (walkableTypes[type] !== false || walkableHere)
    ) {
      return true;
    }
    for (const allowed of allowedSet) {
      if (walkableTypes[allowed] !== false) {
        continue;
      }
      if (walkableHere && hasAdjacentType(terrain.types, x, y, allowed)) {
        return true;
      }
    }
    return false;
  };
}

// Function: hasAdjacentType.
function hasAdjacentType(types, x, y, targetType) {
  if (!types || !types[y]) {
    return false;
  }
  const height = types.length;
  const width = height > 0 ? types[0].length : 0;
  const neighbors = [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ];
  for (const pos of neighbors) {
    if (pos.x < 0 || pos.y < 0 || pos.x >= width || pos.y >= height) {
      continue;
    }
    if (types[pos.y] && types[pos.y][pos.x] === targetType) {
      return true;
    }
  }
  return false;
}

// Function: fractalNoise.
function fractalNoise(x, y, seed, octaves, persistence, lacunarity) {
  let amplitude = 1;
  let frequency = 1;
  let value = 0;
  let max = 0;

  for (let i = 0; i < octaves; i += 1) {
    value += smoothValueNoise(x * frequency, y * frequency, seed) * amplitude;
    max += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return max > 0 ? value / max : 0;
}

// Function: smoothValueNoise.
function smoothValueNoise(x, y, seed) {
  const x0 = Math.floor(x);
  const x1 = x0 + 1;
  const y0 = Math.floor(y);
  const y1 = y0 + 1;
  const sx = fade(x - x0);
  const sy = fade(y - y0);

  const n00 = randomValue(x0, y0, seed);
  const n10 = randomValue(x1, y0, seed);
  const n01 = randomValue(x0, y1, seed);
  const n11 = randomValue(x1, y1, seed);

  const ix0 = lerp(n00, n10, sx);
  const ix1 = lerp(n01, n11, sx);
  return lerp(ix0, ix1, sy);
}

// Function: randomValue.
function randomValue(x, y, seed) {
  let h = (seed >>> 0) ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967295;
}

// Function: fade.
function fade(t) {
  return t * t * (3 - 2 * t);
}

// Function: lerp.
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Function: smoothHeightMap.
function smoothHeightMap(map, passes) {
  const height = map.length;
  const width = height > 0 ? map[0].length : 0;
  let current = map;
  const iterations = Math.max(1, Number(passes || 1));

  for (let p = 0; p < iterations; p += 1) {
    const next = Array.from({ length: height }, () => new Array(width).fill(0));
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny < 0 || nx < 0 || ny >= height || nx >= width) {
              continue;
            }
            sum += current[ny][nx];
            count += 1;
          }
        }
        next[y][x] = count > 0 ? sum / count : current[y][x];
      }
    }
    current = next;
  }
  return current;
}

// Function: normalizeHeightMap.
function normalizeHeightMap(map) {
  let min = Infinity;
  let max = -Infinity;
  for (const row of map) {
    for (const value of row) {
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }
    }
  }
  const range = max - min || 1;
  return map.map((row) => row.map((value) => (value - min) / range));
}

// Function: buildDomainWarp.
function buildDomainWarp(config, seed) {
  const settings = config || {};
  const enabled = settings.enabled !== false;
  const strengthRaw = Number(settings.strength ?? 0);
  const strength = Number.isFinite(strengthRaw) ? clamp(strengthRaw, 0, 12) : 0;
  const scaleRaw = Number(settings.scale ?? 0);
  const scale = Number.isFinite(scaleRaw) ? Math.max(0, scaleRaw) : 0;
  if (!enabled || strength <= 0 || scale <= 0) {
    return { enabled: false };
  }
  const baseSeed = Number(seed || 0);
  return {
    enabled: true,
    strength,
    scale,
    seedX: baseSeed + 401,
    seedY: baseSeed + 937,
  };
}

// Function: applyDomainWarp.
function applyDomainWarp(x, y, warp) {
  if (!warp || !warp.enabled) {
    return { x, y };
  }
  const noiseX = smoothValueNoise(x * warp.scale, y * warp.scale, warp.seedX);
  const noiseY = smoothValueNoise(x * warp.scale, y * warp.scale, warp.seedY);
  const dx = (noiseX - 0.5) * 2 * warp.strength;
  const dy = (noiseY - 0.5) * 2 * warp.strength;
  return { x: x + dx, y: y + dy };
}

// Function: applyDistanceJitter.
function applyDistanceJitter(dist, valley, seed) {
  if (!dist || dist.length === 0) {
    return dist;
  }
  const jitterRaw = Number(valley ? valley.waterDistanceJitter ?? 0 : 0);
  const jitter = Number.isFinite(jitterRaw) ? clamp(jitterRaw, 0, 12) : 0;
  if (jitter <= 0) {
    return dist;
  }
  const noiseScaleRaw = Number(
    valley ? valley.waterDistanceNoiseScale ?? 0 : 0,
  );
  const noiseScale = Number.isFinite(noiseScaleRaw)
    ? Math.max(0.001, noiseScaleRaw)
    : 0.1;
  const height = dist.length;
  const width = height > 0 ? dist[0].length : 0;
  const jittered = Array.from({ length: height }, () =>
    new Array(width).fill(0),
  );
  const noiseSeed = Number(seed || 0) + 523;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const base = dist[y][x];
      if (!Number.isFinite(base)) {
        jittered[y][x] = base;
        continue;
      }
      const noise = smoothValueNoise(x * noiseScale, y * noiseScale, noiseSeed);
      const offset = (noise - 0.5) * 2 * jitter;
      jittered[y][x] = Math.max(0, base + offset);
    }
  }
  return jittered;
}

// Function: inferRiverGuideOrientation.
function inferRiverGuideOrientation(valley) {
  const sides = Array.isArray(valley && valley.riverSourceSides)
    ? valley.riverSourceSides
    : [];
  const sideSet = new Set(sides.map((side) => String(side || "").toLowerCase()));
  if (
    (sideSet.has("west") || sideSet.has("east")) &&
    !sideSet.has("north") &&
    !sideSet.has("south")
  ) {
    return "horizontal";
  }
  if (
    (sideSet.has("north") || sideSet.has("south")) &&
    !sideSet.has("west") &&
    !sideSet.has("east")
  ) {
    return "vertical";
  }
  const bias = valley && valley.riverBias ? valley.riverBias : {};
  const horizontalBias =
    Math.abs(Number(bias.east || 0)) + Math.abs(Number(bias.west || 0));
  const verticalBias =
    Math.abs(Number(bias.north || 0)) + Math.abs(Number(bias.south || 0));
  return horizontalBias >= verticalBias ? "horizontal" : "vertical";
}

// Function: resolveLandmarkOrientation.
function resolveLandmarkOrientation(requested, fallback) {
  const wanted = String(requested || "").toLowerCase();
  if (wanted === "horizontal" || wanted === "vertical") {
    return wanted;
  }
  return fallback === "vertical" ? "vertical" : "horizontal";
}

// Function: buildLandmarkProfiles.
function buildLandmarkProfiles(width, height, settings, seed, warp, valley) {
  if (!settings || settings.enabled === false || width <= 0 || height <= 0) {
    return null;
  }
  const riverOrientation = inferRiverGuideOrientation(valley);
  const riverSpineConfig = settings.riverSpine || {};
  const resolvedRiverOrientation = resolveLandmarkOrientation(
    riverSpineConfig.orientation,
    riverOrientation,
  );
  const riverSpineShape = buildWorldSpineProfile(
    width,
    height,
    {
      enabled: riverSpineConfig.enabled !== false,
      orientation: resolvedRiverOrientation,
      widthRatio: riverSpineConfig.widthRatio,
      curveScale: riverSpineConfig.curveScale,
      curveStrength: riverSpineConfig.curveStrength,
      reliefStrength: 0,
      seedOffset: riverSpineConfig.seedOffset,
      useDomainWarp: riverSpineConfig.useDomainWarp,
    },
    seed + 317,
    warp,
  );
  const riverSpineGuide =
    riverSpineShape && riverSpineShape.enabled
      ? {
          ...riverSpineShape,
          enabled: true,
          weight: clamp(Number(riverSpineConfig.weight || 0), 0, 1),
          backtrackPenalty: clamp(
            Number(riverSpineConfig.backtrackPenalty || 0),
            0,
            0.2,
          ),
          travelDirection: 0,
        }
      : null;

  const ridgeConfig = settings.ridgeMask || {};
  const ridgeFallback =
    riverOrientation === "horizontal" ? "vertical" : "horizontal";
  const resolvedRidgeOrientation = resolveLandmarkOrientation(
    ridgeConfig.orientation,
    ridgeFallback,
  );
  const ridgeShape = buildWorldSpineProfile(
    width,
    height,
    {
      enabled: ridgeConfig.enabled !== false,
      orientation: resolvedRidgeOrientation,
      widthRatio: ridgeConfig.widthRatio,
      curveScale: ridgeConfig.curveScale,
      curveStrength: ridgeConfig.curveStrength,
      reliefStrength: 0,
      seedOffset: ridgeConfig.seedOffset,
      useDomainWarp: ridgeConfig.useDomainWarp,
    },
    seed + 941,
    warp,
  );
  const ridgeMaskMap =
    ridgeShape && ridgeShape.enabled
      ? Array.from({ length: height }, (_, y) =>
          Array.from({ length: width }, (_, x) =>
            sampleWorldSpineMask(ridgeShape, x, y, warp),
          ),
        )
      : null;

  return {
    riverSpineGuide,
    ridgeMaskMap,
  };
}

// Function: buildSourceRiverGuide.
function buildSourceRiverGuide(baseGuide, source, width, height) {
  if (!baseGuide || !baseGuide.enabled || !source) {
    return null;
  }
  let direction = 0;
  if (baseGuide.orientation === "horizontal") {
    direction = source.x <= width / 2 ? 1 : -1;
  } else {
    direction = source.y <= height / 2 ? 1 : -1;
  }
  return {
    ...baseGuide,
    travelDirection: direction,
  };
}

// Function: sampleGuidePoint.
function sampleGuidePoint(guide, x, y, warp) {
  if (!guide || !guide.enabled || !Array.isArray(guide.centers)) {
    return null;
  }
  let sampleX = x;
  let sampleY = y;
  if (guide.useDomainWarp && warp && warp.enabled) {
    const warped = applyDomainWarp(x, y, warp);
    sampleX = warped.x;
    sampleY = warped.y;
  }
  const major = guide.orientation === "horizontal" ? sampleX : sampleY;
  const minor = guide.orientation === "horizontal" ? sampleY : sampleX;
  const majorFloor = clamp(Math.floor(major), 0, guide.majorSize - 1);
  const majorCeil = clamp(Math.ceil(major), 0, guide.majorSize - 1);
  const t = clamp(major - majorFloor, 0, 1);
  const center = lerp(guide.centers[majorFloor], guide.centers[majorCeil], t);
  return { major, minor, center };
}

// Function: sampleGuideDistance.
function sampleGuideDistance(guide, x, y, warp) {
  const point = sampleGuidePoint(guide, x, y, warp);
  if (!point) {
    return 0;
  }
  return Math.abs(point.minor - point.center) / Math.max(1, guide.halfBand);
}

// Function: sampleGuideMajor.
function sampleGuideMajor(guide, x, y, warp) {
  const point = sampleGuidePoint(guide, x, y, warp);
  return point ? point.major : NaN;
}

// Function: buildLandmarkSuitabilityContext.
function buildLandmarkSuitabilityContext(
  width,
  height,
  riverSpineGuide,
  ridgeMaskMap,
  warp,
) {
  const hasRidge =
    Array.isArray(ridgeMaskMap) &&
    ridgeMaskMap.length === height &&
    height > 0 &&
    Array.isArray(ridgeMaskMap[0]) &&
    ridgeMaskMap[0].length === width;
  const hasRiverGuide = riverSpineGuide && riverSpineGuide.enabled;
  if (!hasRidge && !hasRiverGuide) {
    return null;
  }
  const riverAffinityMap = hasRiverGuide
    ? Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) =>
          sampleLandmarkGuideAffinity(riverSpineGuide, x, y, warp),
        ),
      )
    : null;
  return {
    ridgeMaskMap: hasRidge ? ridgeMaskMap : null,
    riverAffinityMap,
  };
}

// Function: sampleLandmarkGuideAffinity.
function sampleLandmarkGuideAffinity(guide, x, y, warp) {
  if (!guide || !guide.enabled) {
    return 0;
  }
  const distance = sampleGuideDistance(guide, x, y, warp);
  const closeness = clamp(1 - distance, 0, 1);
  return closeness * closeness * (3 - 2 * closeness);
}

// Function: computeBiomeLandmarkEffects.
function computeBiomeLandmarkEffects(context, settings, x, y) {
  if (!context || !settings || settings.enabled === false) {
    return {
      bias: 0,
      waterDistanceShift: 0,
      humidityShift: 0,
      noiseThresholdShift: 0,
    };
  }
  let bias = 0;
  const hasRiverMap =
    Array.isArray(context.riverAffinityMap) &&
    context.riverAffinityMap[y] &&
    Number.isFinite(context.riverAffinityMap[y][x]);
  if (hasRiverMap) {
    const centeredRiver = clamp(context.riverAffinityMap[y][x], 0, 1) * 2 - 1;
    bias += centeredRiver * Number(settings.riverSpineAffinity || 0);
  }
  const hasRidgeMap =
    Array.isArray(context.ridgeMaskMap) &&
    context.ridgeMaskMap[y] &&
    Number.isFinite(context.ridgeMaskMap[y][x]);
  if (hasRidgeMap) {
    const centeredRidge = clamp(context.ridgeMaskMap[y][x], 0, 1) * 2 - 1;
    bias += centeredRidge * Number(settings.ridgeAffinity || 0);
  }
  const clampedBias = clamp(bias, -1, 1);
  return {
    bias: clampedBias,
    waterDistanceShift: clampedBias * Number(settings.waterDistanceShift || 0),
    humidityShift: clampedBias * Number(settings.humidityShift || 0),
    noiseThresholdShift: clampedBias * Number(settings.noiseThresholdShift || 0),
  };
}

// Function: buildWorldSpineProfile.
function buildWorldSpineProfile(width, height, settings, seed, warp) {
  if (!settings || settings.enabled === false || width <= 0 || height <= 0) {
    return { enabled: false, reliefStrength: 0 };
  }
  const orientation = settings.orientation === "vertical" ? "vertical" : "horizontal";
  const majorSize = orientation === "horizontal" ? width : height;
  const minorSize = orientation === "horizontal" ? height : width;
  const halfBand = Math.max(1, (minorSize * settings.widthRatio) / 2);
  const curveScale = Math.max(0.001, Number(settings.curveScale || 0.04));
  const curveStrength = clamp(Number(settings.curveStrength || 0), 0, 0.45);
  const useWarp = settings.useDomainWarp !== false && warp && warp.enabled;
  const centers = new Array(majorSize).fill(minorSize / 2);
  const baseSeed = Number(seed || 0) + Number(settings.seedOffset || 0);
  const curveAmplitude = minorSize * curveStrength;
  for (let i = 0; i < majorSize; i += 1) {
    let sx = orientation === "horizontal" ? i : minorSize / 2;
    let sy = orientation === "horizontal" ? minorSize / 2 : i;
    if (useWarp) {
      const warped = applyDomainWarp(sx, sy, warp);
      sx = warped.x;
      sy = warped.y;
    }
    const noise = fractalNoise(sx * curveScale, sy * curveScale, baseSeed, 3, 0.5, 2.0);
    const offset = (noise - 0.5) * 2 * curveAmplitude;
    centers[i] = minorSize / 2 + offset;
  }
  return {
    enabled: true,
    orientation,
    majorSize,
    halfBand,
    useDomainWarp: useWarp,
    centers,
    reliefStrength: clamp(Number(settings.reliefStrength || 0), 0, 0.35),
  };
}

// Function: sampleWorldSpineMask.
function sampleWorldSpineMask(profile, x, y, warp) {
  if (!profile || !profile.enabled || !Array.isArray(profile.centers)) {
    return 0;
  }
  let sampleX = x;
  let sampleY = y;
  if (profile.useDomainWarp && warp && warp.enabled) {
    const warped = applyDomainWarp(x, y, warp);
    sampleX = warped.x;
    sampleY = warped.y;
  }
  const major = profile.orientation === "horizontal" ? sampleX : sampleY;
  const minor = profile.orientation === "horizontal" ? sampleY : sampleX;
  const majorFloor = clamp(Math.floor(major), 0, profile.majorSize - 1);
  const majorCeil = clamp(Math.ceil(major), 0, profile.majorSize - 1);
  const t = clamp(major - majorFloor, 0, 1);
  const center = lerp(profile.centers[majorFloor], profile.centers[majorCeil], t);
  const distance = Math.abs(minor - center);
  const normalized = clamp(1 - distance / profile.halfBand, 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

// Function: buildMacroClimateMaps.
function buildMacroClimateMaps(width, height, settings, seed, warp) {
  if (!settings || settings.enabled === false || width <= 0 || height <= 0) {
    return null;
  }
  const usedShifts =
    Number(settings.mountainHeightShift || 0) +
    Number(settings.hillHeightShift || 0) +
    Number(settings.fertileHeightShift || 0) +
    Number(settings.fertileDistanceShift || 0) +
    Number(settings.humidityShift || 0) +
    Number(settings.waterDistanceShift || 0) +
    Number(settings.biomeThresholdShift || 0);
  if (usedShifts <= 0) {
    return null;
  }
  const reliefMap = buildMacroZoneMap(
    width,
    height,
    settings,
    Number(seed || 0) + Number(settings.seedOffset || 0),
    warp,
  );
  const moistureMap = buildMacroZoneMap(
    width,
    height,
    settings,
    Number(seed || 0) + Number(settings.seedOffset || 0) + 911,
    warp,
  );
  return {
    reliefMap,
    moistureMap,
    settings,
  };
}

// Function: buildMacroZoneMap.
function buildMacroZoneMap(width, height, settings, seed, warp) {
  const zoneCount = Math.max(2, Math.floor(Number(settings.zoneCount || 3)));
  const scale = Math.max(0.001, Number(settings.scale || 0.016));
  const octaves = clamp(Math.floor(Number(settings.octaves || 2)), 1, 6);
  const persistence = clamp(Number(settings.persistence || 0.5), 0, 1);
  const lacunarity = Math.max(0.001, Number(settings.lacunarity || 2.0));
  const softness = clamp(Number(settings.softness || 0), 0, 1);
  const useWarp = settings.useDomainWarp !== false && warp && warp.enabled;
  let map = Array.from({ length: height }, () => new Array(width).fill(0));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sample = useWarp ? applyDomainWarp(x, y, warp) : { x, y };
      const noise = fractalNoise(
        sample.x * scale,
        sample.y * scale,
        seed,
        octaves,
        persistence,
        lacunarity,
      );
      const quantized =
        zoneCount > 1
          ? Math.round(noise * (zoneCount - 1)) / (zoneCount - 1)
          : noise;
      const blended = lerp(quantized, noise, softness);
      map[y][x] = (blended - 0.5) * 2;
    }
  }
  map = smoothFloatMap(map, Number(settings.smoothingPasses || 0));
  return map;
}

// Function: smoothFloatMap.
function smoothFloatMap(map, passes) {
  const iterations = Math.max(0, Math.floor(Number(passes || 0)));
  if (iterations <= 0) {
    return map;
  }
  const height = map.length;
  const width = height > 0 ? map[0].length : 0;
  let current = map;
  for (let p = 0; p < iterations; p += 1) {
    const next = Array.from({ length: height }, () => new Array(width).fill(0));
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny < 0 || nx < 0 || ny >= height || nx >= width) {
              continue;
            }
            sum += current[ny][nx];
            count += 1;
          }
        }
        next[y][x] = count > 0 ? sum / count : current[y][x];
      }
    }
    current = next;
  }
  return current;
}

// Function: applyWaterBudget.
function applyWaterBudget(lakeSet, riverSet, heightMap, settings, seed) {
  if (!lakeSet || lakeSet.size === 0) {
    return lakeSet || new Set();
  }
  if (!settings || settings.enabled === false || !heightMap || heightMap.length === 0) {
    return lakeSet;
  }
  const height = heightMap.length;
  const width = height > 0 ? heightMap[0].length : 0;
  const totalCells = width * height;
  if (totalCells <= 0) {
    return lakeSet;
  }
  const maxRatio = clamp(Number(settings.maxRatio ?? 1), 0, 1);
  const maxWaterCells = Math.max(0, Math.floor(totalCells * maxRatio));
  const riverCells =
    settings.preserveRiver === false ? 0 : Math.max(0, Number((riverSet && riverSet.size) || 0));
  const allowedLakeCells = Math.max(0, maxWaterCells - riverCells);
  if (lakeSet.size <= allowedLakeCells) {
    return lakeSet;
  }
  if (allowedLakeCells <= 0) {
    return new Set();
  }
  const components = collectWaterComponents(lakeSet, width, height, heightMap);
  if (components.length === 0) {
    return new Set();
  }
  const random = createTerrainRng(Number(seed || 0) + 1981);
  components.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.00001) {
      return b.score - a.score;
    }
    return b.cells.length - a.cells.length;
  });
  const kept = new Set();
  for (const component of components) {
    if (kept.size >= allowedLakeCells) {
      break;
    }
    const remaining = allowedLakeCells - kept.size;
    if (component.cells.length <= remaining) {
      for (const cell of component.cells) {
        kept.add(cell.key);
      }
      continue;
    }
    const sorted = component.cells.slice();
    sorted.sort((a, b) => {
      if (Math.abs(a.height - b.height) > 0.00001) {
        return a.height - b.height;
      }
      return random() < 0.5 ? -1 : 1;
    });
    for (let i = 0; i < remaining; i += 1) {
      kept.add(sorted[i].key);
    }
  }
  return kept;
}

// Function: collectWaterComponents.
function collectWaterComponents(waterSet, width, height, heightMap) {
  const remaining = new Set(waterSet);
  const components = [];
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];
  while (remaining.size > 0) {
    const iter = remaining.values().next();
    if (iter.done) {
      break;
    }
    const start = iter.value;
    remaining.delete(start);
    const queue = [start];
    const cells = [];
    let depthScore = 0;
    while (queue.length > 0) {
      const key = queue.pop();
      const point = parseCellKey(key);
      if (!point) {
        continue;
      }
      const cellHeight =
        heightMap &&
        heightMap[point.y] &&
        Number.isFinite(heightMap[point.y][point.x])
          ? Number(heightMap[point.y][point.x])
          : 1;
      cells.push({ key, height: cellHeight });
      depthScore += 1 - clamp(cellHeight, 0, 1);
      for (const dir of dirs) {
        const nx = point.x + dir.dx;
        const ny = point.y + dir.dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          continue;
        }
        const neighborKey = `${nx},${ny}`;
        if (!remaining.has(neighborKey)) {
          continue;
        }
        remaining.delete(neighborKey);
        queue.push(neighborKey);
      }
    }
    if (cells.length === 0) {
      continue;
    }
    const avgDepth = depthScore / cells.length;
    const sizeFactor = Math.min(1, cells.length / 64);
    components.push({
      cells,
      score: avgDepth * 0.75 + sizeFactor * 0.25,
    });
  }
  return components;
}

// Function: parseCellKey.
function parseCellKey(key) {
  if (!key || typeof key !== "string") {
    return null;
  }
  const parts = key.split(",");
  if (parts.length !== 2) {
    return null;
  }
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
}

// Function: applyBiomeEdgeJitter.
function applyBiomeEdgeJitter(mask, settings, seed, eligibleFn, biomeType) {
  if (!mask || !settings || settings.enabled === false) {
    return;
  }
  const types = Array.isArray(settings.types) ? settings.types : [];
  if (biomeType && types.length > 0 && !types.includes(biomeType)) {
    return;
  }
  const passes = Math.max(0, Math.floor(Number(settings.passes || 0)));
  const strength = clamp(Number(settings.strength || 0), 0, 0.45);
  const noiseScale = Math.max(0.001, Number(settings.noiseScale || 0.28));
  if (passes <= 0 || strength <= 0) {
    return;
  }
  const height = mask.length;
  const width = height > 0 ? mask[0].length : 0;
  const baseSeed = Number(seed || 0) + Number(settings.seedOffset || 0);
  for (let pass = 0; pass < passes; pass += 1) {
    const next = mask.map((row) => row.slice());
    const noiseSeed = baseSeed + pass * 53;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (eligibleFn && !eligibleFn(x, y)) {
          next[y][x] = false;
          continue;
        }
        const neighbors = countMaskNeighbors(mask, x, y);
        if (neighbors <= 0 || neighbors >= 8) {
          continue;
        }
        const noise = smoothValueNoise(x * noiseScale, y * noiseScale, noiseSeed);
        const centered = (noise - 0.5) * 2;
        if (mask[y][x]) {
          if (neighbors <= 2 && centered < -strength) {
            next[y][x] = false;
          }
          continue;
        }
        if (neighbors >= 5 && centered > strength && hasNearbyCluster(mask, x, y)) {
          next[y][x] = true;
        }
      }
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        mask[y][x] = next[y][x];
      }
    }
  }
}

// Function: countMaskNeighbors.
function countMaskNeighbors(mask, x, y) {
  const height = mask.length;
  const width = height > 0 ? mask[0].length : 0;
  let count = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }
      if (mask[ny][nx]) {
        count += 1;
      }
    }
  }
  return count;
}

// Function: buildBiomeNoiseMask.
function buildBiomeNoiseMask(width, height, settings, seed, warp) {
  if (!settings || settings.enabled === false) {
    return null;
  }
  const heightStrength = Math.max(0, Number(settings.heightStrength ?? 0));
  const distanceStrength = Math.max(0, Number(settings.distanceStrength ?? 0));
  const thresholdStrength = Math.max(
    0,
    Number(settings.noiseThresholdStrength ?? 0),
  );
  if (heightStrength <= 0 && distanceStrength <= 0 && thresholdStrength <= 0) {
    return null;
  }

  const scaleRaw = Number(settings.scale ?? 0.05);
  const scale = Number.isFinite(scaleRaw) ? Math.max(0.001, scaleRaw) : 0.05;
  const octavesRaw = Number(settings.octaves ?? 2);
  const octaves = Number.isFinite(octavesRaw)
    ? clamp(Math.floor(octavesRaw), 1, 8)
    : 2;
  const persistenceRaw = Number(settings.persistence ?? 0.5);
  const persistence = Number.isFinite(persistenceRaw)
    ? clamp(persistenceRaw, 0, 1)
    : 0.5;
  const lacunarityRaw = Number(settings.lacunarity ?? 2.0);
  const lacunarity =
    Number.isFinite(lacunarityRaw) && lacunarityRaw > 0
      ? lacunarityRaw
      : 2.0;
  const seedOffsetRaw = Number(settings.seedOffset ?? 0);
  const seedOffset = Number.isFinite(seedOffsetRaw) ? Math.floor(seedOffsetRaw) : 0;
  const useWarp = settings.useDomainWarp !== false && warp && warp.enabled;

  const mask = Array.from({ length: height }, () => new Array(width).fill(0));
  const baseSeed = Number(seed || 0) + seedOffset;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const warped = useWarp ? applyDomainWarp(x, y, warp) : { x, y };
      const noise = fractalNoise(
        warped.x * scale,
        warped.y * scale,
        baseSeed,
        octaves,
        persistence,
        lacunarity,
      );
      mask[y][x] = (noise - 0.5) * 2;
    }
  }

  return {
    mask,
    heightStrength,
    distanceStrength,
    noiseThresholdStrength: thresholdStrength,
  };
}

// Function: applyBiomeNoiseToDistance.
function applyBiomeNoiseToDistance(dist, biomeNoise) {
  if (!dist || dist.length === 0) {
    return dist;
  }
  if (!biomeNoise || !biomeNoise.mask || biomeNoise.distanceStrength <= 0) {
    return dist;
  }
  const height = dist.length;
  const width = height > 0 ? dist[0].length : 0;
  const adjusted = Array.from({ length: height }, () =>
    new Array(width).fill(0),
  );
  const strength = biomeNoise.distanceStrength;
  const mask = biomeNoise.mask;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const base = dist[y][x];
      if (!Number.isFinite(base)) {
        adjusted[y][x] = base;
        continue;
      }
      if (base <= 0) {
        adjusted[y][x] = 0;
        continue;
      }
      const offset = mask[y][x] * strength;
      adjusted[y][x] = Math.max(0, base + offset);
    }
  }
  return adjusted;
}

// Function: computeDistanceToWater.
function computeDistanceToWater(waterSet, width, height, diagonalWeight) {
  const dist = Array.from({ length: height }, () =>
    new Array(width).fill(Infinity),
  );
  const diag = Number(diagonalWeight);
  const useDiagonal = Number.isFinite(diag) && diag > 0;
  if (!useDiagonal) {
    const queue = [];
    for (const key of waterSet) {
      const [sx, sy] = key.split(",").map(Number);
      if (Number.isFinite(sx) && Number.isFinite(sy)) {
        dist[sy][sx] = 0;
        queue.push({ x: sx, y: sy });
      }
    }
    const dirs = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];
    let idx = 0;
    while (idx < queue.length) {
      const { x, y } = queue[idx];
      idx += 1;
      for (const dir of dirs) {
        const nx = x + dir.dx;
        const ny = y + dir.dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          continue;
        }
        const nd = dist[y][x] + 1;
        if (nd < dist[ny][nx]) {
          dist[ny][nx] = nd;
          queue.push({ x: nx, y: ny });
        }
      }
    }
    return dist;
  }

  const heap = { items: [] };
  for (const key of waterSet) {
    const [sx, sy] = key.split(",").map(Number);
    if (Number.isFinite(sx) && Number.isFinite(sy)) {
      dist[sy][sx] = 0;
      heapPush(heap, { x: sx, y: sy, dist: 0 });
    }
  }
  const dirs = [
    { dx: 1, dy: 0, cost: 1 },
    { dx: -1, dy: 0, cost: 1 },
    { dx: 0, dy: 1, cost: 1 },
    { dx: 0, dy: -1, cost: 1 },
    { dx: 1, dy: 1, cost: diag },
    { dx: -1, dy: 1, cost: diag },
    { dx: 1, dy: -1, cost: diag },
    { dx: -1, dy: -1, cost: diag },
  ];
  while (heap.items.length > 0) {
    const current = heapPop(heap);
    if (!current) {
      break;
    }
    if (current.dist !== dist[current.y][current.x]) {
      continue;
    }
    for (const dir of dirs) {
      const nx = current.x + dir.dx;
      const ny = current.y + dir.dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }
      const nd = current.dist + dir.cost;
      if (nd < dist[ny][nx]) {
        dist[ny][nx] = nd;
        heapPush(heap, { x: nx, y: ny, dist: nd });
      }
    }
  }
  return dist;
}

// Function: heapPush.
function heapPush(heap, item) {
  const items = heap.items;
  let idx = items.length;
  items.push(item);
  while (idx > 0) {
    const parent = Math.floor((idx - 1) / 2);
    if (items[parent].dist <= item.dist) {
      break;
    }
    items[idx] = items[parent];
    idx = parent;
  }
  items[idx] = item;
}

// Function: heapPop.
function heapPop(heap) {
  const items = heap.items;
  if (items.length === 0) {
    return null;
  }
  const root = items[0];
  const last = items.pop();
  if (items.length === 0) {
    return root;
  }
  let idx = 0;
  while (true) {
    const left = idx * 2 + 1;
    if (left >= items.length) {
      break;
    }
    const right = left + 1;
    const smallest =
      right < items.length && items[right].dist < items[left].dist
        ? right
        : left;
    if (items[smallest].dist >= last.dist) {
      break;
    }
    items[idx] = items[smallest];
    idx = smallest;
  }
  items[idx] = last;
  return root;
}

// Function: buildValleyRiver.
function buildValleyRivers(heightMap, valley, seed, riverSpineGuide, warp) {
  const height = heightMap.length;
  const width = height > 0 ? heightMap[0].length : 0;
  const count = clamp(Math.floor(Number(valley.riverCount ?? 1)), 1, 4);
  const minDistance = Math.max(
    0,
    Math.floor(Number(valley.riverSourceMinDistance ?? 0)),
  );
  const sources = pickRiverSources(
    heightMap,
    count,
    minDistance,
    valley.riverSourceSides,
    createTerrainRng(Number(seed || 0) + 91),
  );
  const baseMaxSteps = Math.max(1, width * height);
  let maxStepsPerRiver = baseMaxSteps;
  const waterBudget = valley && valley.waterBudget ? valley.waterBudget : null;
  if (waterBudget && waterBudget.enabled !== false && waterBudget.preserveRiver !== false) {
    const maxRatio = clamp(Number(waterBudget.maxRatio ?? 1), 0, 1);
    const maxWaterCells = Math.max(0, Math.floor(width * height * maxRatio));
    if (maxWaterCells > 0) {
      maxStepsPerRiver = Math.max(
        24,
        Math.floor(maxWaterCells / Math.max(1, count)),
      );
    }
  }
  maxStepsPerRiver = clamp(maxStepsPerRiver, 24, baseMaxSteps);
  const river = [];
  const riverSet = new Set();
  const lakes = new Set();

  let index = 0;
  for (const source of sources) {
    const rng = createTerrainRng(Number(seed || 0) + 221 + index * 29);
    const sourceGuide = buildSourceRiverGuide(
      riverSpineGuide,
      source,
      width,
      height,
    );
    const result = traceValleyRiver(
      heightMap,
      valley,
      source,
      rng,
      maxStepsPerRiver,
      sourceGuide,
      warp,
    );
    for (const cell of result.river) {
      const key = `${cell.x},${cell.y}`;
      if (riverSet.has(key)) {
        continue;
      }
      riverSet.add(key);
      river.push(cell);
    }
    for (const lake of result.lakes) {
      lakes.add(lake);
    }
    index += 1;
  }

  return { river, lakes };
}

function traceValleyRiver(
  heightMap,
  valley,
  source,
  rng,
  stepLimit,
  riverGuide,
  warp,
) {
  const height = heightMap.length;
  const width = height > 0 ? heightMap[0].length : 0;
  const river = [];
  const riverSet = new Set();
  const lakes = new Set();
  let x = source.x;
  let y = source.y;
  let previous = null;
  const maxSteps = clamp(
    Math.floor(Number(stepLimit ?? width * height)),
    24,
    Math.max(24, width * height),
  );
  const wander = clamp(Number(valley.riverWander ?? 0.25), 0, 1);

  for (let step = 0; step < maxSteps; step += 1) {
    const key = `${x},${y}`;
    if (!riverSet.has(key)) {
      river.push({ x, y });
      riverSet.add(key);
    }
    if (x === width - 1 || y === height - 1) {
      break;
    }
    const currentH = heightMap[y][x];
    let neighbors = [
      { x: x + 1, y, bias: valley.riverBias.east },
      { x, y: y + 1, bias: valley.riverBias.south },
      { x: x - 1, y, bias: valley.riverBias.west },
      { x, y: y - 1, bias: valley.riverBias.north },
    ].filter((n) => n.x >= 0 && n.y >= 0 && n.x < width && n.y < height);
    if (previous && neighbors.length > 1) {
      neighbors = neighbors.filter(
        (n) => n.x !== previous.x || n.y !== previous.y,
      );
      if (neighbors.length === 0) {
        neighbors = [
          { x: x + 1, y, bias: valley.riverBias.east },
          { x, y: y + 1, bias: valley.riverBias.south },
          { x: x - 1, y, bias: valley.riverBias.west },
          { x, y: y - 1, bias: valley.riverBias.north },
        ].filter((n) => n.x >= 0 && n.y >= 0 && n.x < width && n.y < height);
      }
    }
    let best = null;
    let bestScore = Infinity;
    const scored = [];
    const currentGuideMajor = sampleGuideMajor(riverGuide, x, y, warp);
    for (const candidate of neighbors) {
      const noise = (rng ? rng() : Math.random()) - 0.5;
      let score =
        heightMap[candidate.y][candidate.x] +
        candidate.bias +
        noise * wander * 0.08;
      if (riverGuide && riverGuide.enabled) {
        const guideDistance = sampleGuideDistance(
          riverGuide,
          candidate.x,
          candidate.y,
          warp,
        );
        score += guideDistance * riverGuide.weight;
        const candidateMajor = sampleGuideMajor(
          riverGuide,
          candidate.x,
          candidate.y,
          warp,
        );
        if (
          riverGuide.travelDirection !== 0 &&
          Number.isFinite(currentGuideMajor) &&
          Number.isFinite(candidateMajor)
        ) {
          const deltaMajor =
            (candidateMajor - currentGuideMajor) * riverGuide.travelDirection;
          if (deltaMajor < -0.05) {
            score += riverGuide.backtrackPenalty;
          }
        }
      }
      scored.push({ candidate, score });
    }
    if (scored.length === 0) {
      break;
    }
    scored.sort((a, b) => a.score - b.score);
    best = scored[0].candidate;
    bestScore = scored[0].score;
    if (scored.length > 1 && (rng ? rng() : Math.random()) < wander) {
      const pickIndex = Math.min(
        scored.length - 1,
        1 + Math.floor((rng ? rng() : Math.random()) * 2),
      );
      best = scored[pickIndex].candidate;
      bestScore = scored[pickIndex].score;
    }
    if (heightMap[best.y][best.x] > currentH + 0.0001) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            continue;
          }
          if (heightMap[ny][nx] <= currentH + valley.lakeThreshold) {
            lakes.add(`${nx},${ny}`);
            heightMap[ny][nx] = Math.min(
              heightMap[ny][nx],
              currentH - valley.lakeDepth,
            );
          }
        }
      }
      heightMap[best.y][best.x] = currentH - valley.lakeDepth;
    }
    previous = { x, y };
    x = best.x;
    y = best.y;
  }

  return { river, lakes };
}

// Function: pickRiverSources.
function pickRiverSources(heightMap, count, minDistance, sides, rng) {
  const height = heightMap.length;
  const width = height > 0 ? heightMap[0].length : 0;
  const random = typeof rng === "function" ? rng : Math.random;
  const avoidCorners = width > 2 && height > 2;
  const isCorner = (x, y) => {
    return (x === 0 || x === width - 1) && (y === 0 || y === height - 1);
  };
  const sideList =
    Array.isArray(sides) && sides.length > 0
      ? sides
          .map((side) => String(side || "").toLowerCase())
          .filter((side) => ["north", "south", "east", "west"].includes(side))
      : ["north", "south", "east", "west"];
  const candidates = [];
  const candidatesBySide = {
    north: [],
    south: [],
    east: [],
    west: [],
  };
  const seen = new Set();

  if (sideList.includes("north")) {
    for (let x = 0; x < width; x += 1) {
      if (avoidCorners && isCorner(x, 0)) {
        continue;
      }
      candidatesBySide.north.push({ x, y: 0, h: heightMap[0][x], side: "north" });
    }
  }
  if (sideList.includes("south")) {
    for (let x = 0; x < width; x += 1) {
      if (avoidCorners && isCorner(x, height - 1)) {
        continue;
      }
      candidatesBySide.south.push({
        x,
        y: height - 1,
        h: heightMap[height - 1][x],
        side: "south",
      });
    }
  }
  if (sideList.includes("west")) {
    for (let y = 0; y < height; y += 1) {
      if (avoidCorners && isCorner(0, y)) {
        continue;
      }
      candidatesBySide.west.push({ x: 0, y, h: heightMap[y][0], side: "west" });
    }
  }
  if (sideList.includes("east")) {
    for (let y = 0; y < height; y += 1) {
      if (avoidCorners && isCorner(width - 1, y)) {
        continue;
      }
      candidatesBySide.east.push({
        x: width - 1,
        y,
        h: heightMap[y][width - 1],
        side: "east",
      });
    }
  }

  for (const list of Object.values(candidatesBySide)) {
    for (const entry of list) {
      candidates.push(entry);
    }
  }

  candidates.sort((a, b) => b.h - a.h);
  for (const key of Object.keys(candidatesBySide)) {
    candidatesBySide[key].sort((a, b) => b.h - a.h);
  }

  const cycleSides =
    sideList.length > 0 ? sideList.slice() : ["north", "south", "east", "west"];
  shuffleInPlace(cycleSides, random);
  const sideUsage = {};
  for (const side of cycleSides) {
    sideUsage[side] = 0;
  }
  const sources = [];

  const canUseCandidate = (candidate) => {
    if (!candidate) {
      return false;
    }
    const key = `${candidate.x},${candidate.y}`;
    if (seen.has(key)) {
      return false;
    }
    if (
      minDistance > 0 &&
      sources.some(
        (source) => manhattanDistance(source, candidate) < minDistance,
      )
    ) {
      return false;
    }
    return true;
  };

  const pickFromSortedList = (list) => {
    if (!Array.isArray(list) || list.length === 0) {
      return null;
    }
    const available = [];
    for (const candidate of list) {
      if (!canUseCandidate(candidate)) {
        continue;
      }
      available.push(candidate);
    }
    if (available.length === 0) {
      return null;
    }
    const topBandSize = Math.max(
      1,
      Math.min(6, Math.floor(available.length * 0.2)),
    );
    const pickRange = Math.min(available.length, topBandSize);
    const pickIndex = Math.min(
      pickRange - 1,
      Math.floor(Math.pow(random(), 1.8) * pickRange),
    );
    return available[pickIndex];
  };

  for (let i = 0; i < count; i += 1) {
    let picked = null;
    let pickedSide = null;
    const minUsage = cycleSides.reduce((min, side) => {
      return Math.min(min, Number(sideUsage[side] || 0));
    }, Infinity);

    for (const side of cycleSides) {
      if (Number(sideUsage[side] || 0) !== minUsage) {
        continue;
      }
      picked = pickFromSortedList(candidatesBySide[side]);
      if (picked) {
        pickedSide = side;
        break;
      }
    }

    if (!picked) {
      for (const side of cycleSides) {
        if (Number(sideUsage[side] || 0) === minUsage) {
          continue;
        }
        picked = pickFromSortedList(candidatesBySide[side]);
        if (picked) {
          pickedSide = side;
          break;
        }
      }
    }

    if (!picked) {
      picked = pickFromSortedList(candidates);
      pickedSide = picked ? picked.side : null;
    }
    if (!picked && candidates.length > 0) {
      picked = candidates[Math.floor(random() * candidates.length)];
      pickedSide = picked ? picked.side : null;
    }
    if (picked) {
      sources.push({ x: picked.x, y: picked.y });
      seen.add(`${picked.x},${picked.y}`);
      if (pickedSide && sideUsage[pickedSide] !== undefined) {
        sideUsage[pickedSide] += 1;
      }
    }
  }

  if (sources.length < count) {
    for (const candidate of candidates) {
      if (sources.length >= count) {
        break;
      }
      const key = `${candidate.x},${candidate.y}`;
      if (seen.has(key)) {
        continue;
      }
      sources.push({ x: candidate.x, y: candidate.y });
      seen.add(key);
    }
  }

  if (sources.length === 0) {
    const fallback = pickRiverSource(heightMap, sideList, random);
    sources.push({ x: fallback.x, y: fallback.y });
  }

  return sources;
}

function manhattanDistance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

// Function: pickRiverSource.
function pickRiverSource(heightMap, sides, rng) {
  const height = heightMap.length;
  const width = height > 0 ? heightMap[0].length : 0;
  const random = typeof rng === "function" ? rng : Math.random;
  const avoidCorners = width > 2 && height > 2;
  const isCorner = (x, y) => {
    return (x === 0 || x === width - 1) && (y === 0 || y === height - 1);
  };
  const sideList =
    Array.isArray(sides) && sides.length > 0
      ? sides
          .map((side) => String(side || "").toLowerCase())
          .filter((side) => ["north", "south", "east", "west"].includes(side))
      : ["north", "south", "east", "west"];
  const candidates = [];

  if (sideList.includes("north")) {
    for (let x = 0; x < width; x += 1) {
      if (avoidCorners && isCorner(x, 0)) {
        continue;
      }
      candidates.push({ x, y: 0, h: heightMap[0][x] });
    }
  }
  if (sideList.includes("south")) {
    for (let x = 0; x < width; x += 1) {
      if (avoidCorners && isCorner(x, height - 1)) {
        continue;
      }
      candidates.push({ x, y: height - 1, h: heightMap[height - 1][x] });
    }
  }
  if (sideList.includes("west")) {
    for (let y = 0; y < height; y += 1) {
      if (avoidCorners && isCorner(0, y)) {
        continue;
      }
      candidates.push({ x: 0, y, h: heightMap[y][0] });
    }
  }
  if (sideList.includes("east")) {
    for (let y = 0; y < height; y += 1) {
      if (avoidCorners && isCorner(width - 1, y)) {
        continue;
      }
      candidates.push({ x: width - 1, y, h: heightMap[y][width - 1] });
    }
  }
  if (candidates.length === 0) {
    return { x: 0, y: 0 };
  }

  let best = candidates[0];
  for (let i = 1; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (candidate.h > best.h) {
      best = candidate;
      continue;
    }
    if (Math.abs(candidate.h - best.h) < 0.000001 && random() < 0.5) {
      best = candidate;
    }
  }
  return { x: best.x, y: best.y };
}

// Function: carveRiverValley.
function carveRiverValley(heightMap, river, valley) {
  const height = heightMap.length;
  const width = height > 0 ? heightMap[0].length : 0;
  const carved = heightMap.map((row) => row.slice());
  for (const cell of river) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const x = cell.x + dx;
        const y = cell.y + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) {
          continue;
        }
        const drop =
          dx === 0 && dy === 0
            ? valley.riverValleyDrop
            : valley.riverValleyDropAdjacent;
        carved[y][x] = Math.max(0, carved[y][x] - drop);
      }
    }
  }
  return carved;
}

// Function: smoothClusterMap.
function smoothClusterMap(map, baseTypes, keepFn) {
  const height = map.length;
  const width = height > 0 ? map[0].length : 0;
  const next = map.map((row) => row.slice());
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const base = baseTypes[y][x];
      if (base === "river" || base === "lake" || base === "mountain") {
        continue;
      }
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            continue;
          }
          if (map[ny][nx]) {
            count += 1;
          }
        }
      }
      if (count >= 4 && keepFn(x, y)) {
        next[y][x] = true;
      }
      if (count <= 1) {
        next[y][x] = false;
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      map[y][x] = next[y][x];
    }
  }
}

// Function: buildValleyFoodMask.
function buildValleyFoodMask(
  width,
  height,
  baseTypes,
  dist,
  humidity,
  forest,
  valley,
  seed,
  warp,
  biomeNoise,
  macroClimate,
  landmarkContext,
) {
  const food = Array.from({ length: height }, () =>
    new Array(width).fill(false),
  );
  const settings = valley.food || {};
  const biomeMask = biomeNoise ? biomeNoise.mask : null;
  const thresholdStrength = biomeNoise ? biomeNoise.noiseThresholdStrength : 0;
  const moistureMap = macroClimate ? macroClimate.moistureMap : null;
  const macroSettings = macroClimate ? macroClimate.settings : null;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const moistureFactor = moistureMap ? moistureMap[y][x] : 0;
      const landmarkEffects = computeBiomeLandmarkEffects(
        landmarkContext,
        settings.landmarkSuitability,
        x,
        y,
      );
      const base = baseTypes[y][x];
      if (base !== "fertile" && base !== "plain") {
        continue;
      }
      if (forest[y][x]) {
        continue;
      }
      const waterDistanceMax = Math.max(
        0,
        settings.waterDistanceMax +
          moistureFactor *
            (macroSettings ? macroSettings.waterDistanceShift : 0) +
          landmarkEffects.waterDistanceShift,
      );
      if (dist[y][x] > waterDistanceMax) {
        continue;
      }
      const effectiveHumidity = clamp(
        humidity[y][x] +
          moistureFactor * (macroSettings ? macroSettings.humidityShift : 0) +
          landmarkEffects.humidityShift,
        0,
        1,
      );
      if (effectiveHumidity < settings.humidityMin) {
        continue;
      }
      const warped = applyDomainWarp(x, y, warp);
      const noise = fractalNoise(
        warped.x * settings.noiseScale,
        warped.y * settings.noiseScale,
        seed + 143,
        3,
        0.5,
        2.0,
      );
      const thresholdBias = biomeMask ? biomeMask[y][x] * thresholdStrength : 0;
      const macroThresholdBias =
        -moistureFactor *
        (macroSettings ? macroSettings.biomeThresholdShift : 0);
      const threshold = clamp(
        settings.noiseThreshold +
          thresholdBias +
          macroThresholdBias +
          landmarkEffects.noiseThresholdShift,
        0,
        1,
      );
      if (noise > threshold) {
        food[y][x] = true;
      }
    }
  }
  for (let pass = 0; pass < settings.clusterPasses; pass += 1) {
    smoothClusterMap(food, baseTypes, (x, y) => {
      const moistureFactor = moistureMap ? moistureMap[y][x] : 0;
      const landmarkEffects = computeBiomeLandmarkEffects(
        landmarkContext,
        settings.landmarkSuitability,
        x,
        y,
      );
      const base = baseTypes[y][x];
      if (base !== "fertile" && base !== "plain") {
        return false;
      }
      if (forest[y][x]) {
        return false;
      }
      const waterDistanceMax = Math.max(
        0,
        settings.waterDistanceMax +
          moistureFactor *
            (macroSettings ? macroSettings.waterDistanceShift : 0) +
          landmarkEffects.waterDistanceShift,
      );
      if (dist[y][x] > waterDistanceMax) {
        return false;
      }
      const effectiveHumidity = clamp(
        humidity[y][x] +
          moistureFactor * (macroSettings ? macroSettings.humidityShift : 0) +
          landmarkEffects.humidityShift,
        0,
        1,
      );
      return effectiveHumidity >= settings.humidityMin;
    });
  }
  applyBiomeEdgeJitter(food, valley.biomeEdgeJitter, seed + 173, (x, y) => {
    const moistureFactor = moistureMap ? moistureMap[y][x] : 0;
    const landmarkEffects = computeBiomeLandmarkEffects(
      landmarkContext,
      settings.landmarkSuitability,
      x,
      y,
    );
    const base = baseTypes[y][x];
    if (base !== "fertile" && base !== "plain") {
      return false;
    }
    if (forest[y][x]) {
      return false;
    }
    const waterDistanceMax = Math.max(
      0,
      settings.waterDistanceMax +
        moistureFactor * (macroSettings ? macroSettings.waterDistanceShift : 0) +
        landmarkEffects.waterDistanceShift,
    );
    if (dist[y][x] > waterDistanceMax) {
      return false;
    }
    const effectiveHumidity = clamp(
      humidity[y][x] +
        moistureFactor * (macroSettings ? macroSettings.humidityShift : 0) +
        landmarkEffects.humidityShift,
      0,
      1,
    );
    return effectiveHumidity >= settings.humidityMin;
  }, "food");
  return food;
}

// Function: buildValleyPastureMask.
function buildValleyPastureMask(
  width,
  height,
  baseTypes,
  dist,
  humidity,
  forest,
  food,
  valley,
  seed,
  warp,
  biomeNoise,
  macroClimate,
  landmarkContext,
) {
  const pasture = Array.from({ length: height }, () =>
    new Array(width).fill(false),
  );
  const settings = valley.pasture || {};
  const patches = settings.patches || {};
  const biomeMask = biomeNoise ? biomeNoise.mask : null;
  const thresholdStrength = biomeNoise ? biomeNoise.noiseThresholdStrength : 0;
  const moistureMap = macroClimate ? macroClimate.moistureMap : null;
  const macroSettings = macroClimate ? macroClimate.settings : null;
  const patchCount = Math.max(0, Math.floor(Number(patches.count || 0)));
  const randomBetweenRng = (rng, min, max) => {
    const low = Number.isFinite(min) ? Number(min) : 0;
    const high = Number.isFinite(max) ? Number(max) : low;
    if (high <= low) {
      return low;
    }
    return Math.floor(rng() * (high - low + 1)) + low;
  };
  const isEligible = (x, y) => {
    const moistureFactor = moistureMap ? moistureMap[y][x] : 0;
    const landmarkEffects = computeBiomeLandmarkEffects(
      landmarkContext,
      settings.landmarkSuitability,
      x,
      y,
    );
    const base = baseTypes[y][x];
    if (base !== "fertile" && base !== "plain") {
      return false;
    }
    if (forest[y][x] || (food && food[y][x])) {
      return false;
    }
    const waterDistanceMax = Math.max(
      0,
      settings.waterDistanceMax +
        moistureFactor * (macroSettings ? macroSettings.waterDistanceShift : 0) +
        landmarkEffects.waterDistanceShift,
    );
    if (dist[y][x] > waterDistanceMax) {
      return false;
    }
    const effectiveHumidity = clamp(
      humidity[y][x] +
        moistureFactor * (macroSettings ? macroSettings.humidityShift : 0) +
        landmarkEffects.humidityShift,
      0,
      1,
    );
    return effectiveHumidity >= settings.humidityMin;
  };

  if (patchCount > 0) {
    const rng = createTerrainRng(seed + 211);
    const candidates = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (isEligible(x, y)) {
          candidates.push({ x, y });
        }
      }
    }
    const radiusMin = Math.max(1, Math.floor(Number(patches.radiusMin || 3)));
    const radiusMax = Math.max(radiusMin, Math.floor(Number(patches.radiusMax || radiusMin)));
    const fill = clamp(Number(patches.fill ?? 0.8), 0, 1);
    for (let i = 0; i < patchCount && candidates.length > 0; i += 1) {
      const seedIndex = Math.floor(rng() * candidates.length);
      const center = candidates[seedIndex];
      const radius = randomBetweenRng(rng, radiusMin, radiusMax);
      for (let y = Math.max(0, center.y - radius); y <= Math.min(height - 1, center.y + radius); y += 1) {
        for (let x = Math.max(0, center.x - radius); x <= Math.min(width - 1, center.x + radius); x += 1) {
          if (!isEligible(x, y)) {
            continue;
          }
          const dx = x - center.x;
          const dy = y - center.y;
          if (Math.sqrt(dx * dx + dy * dy) > radius) {
            continue;
          }
          if (fill < 1 && rng() > fill) {
            continue;
          }
          pasture[y][x] = true;
        }
      }
    }
  } else {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!isEligible(x, y)) {
          continue;
        }
        const warped = applyDomainWarp(x, y, warp);
        const noise = fractalNoise(
          warped.x * settings.noiseScale,
          warped.y * settings.noiseScale,
          seed + 211,
          3,
          0.5,
          2.0,
        );
        const moistureFactor = moistureMap ? moistureMap[y][x] : 0;
        const landmarkEffects = computeBiomeLandmarkEffects(
          landmarkContext,
          settings.landmarkSuitability,
          x,
          y,
        );
        const thresholdBias = biomeMask ? biomeMask[y][x] * thresholdStrength : 0;
        const macroThresholdBias =
          -moistureFactor *
          (macroSettings ? macroSettings.biomeThresholdShift : 0);
        const threshold = clamp(
          settings.noiseThreshold +
            thresholdBias +
            macroThresholdBias +
            landmarkEffects.noiseThresholdShift,
          0,
          1,
        );
        if (noise > threshold) {
          pasture[y][x] = true;
        }
      }
    }
  }
  for (let pass = 0; pass < settings.clusterPasses; pass += 1) {
    smoothClusterMap(pasture, baseTypes, (x, y) => {
      return isEligible(x, y);
    });
  }
  applyBiomeEdgeJitter(
    pasture,
    valley.biomeEdgeJitter,
    seed + 211,
    (x, y) => {
      return isEligible(x, y);
    },
    "pasture",
  );
  return pasture;
}

// Function: hasNearbyCluster.
function hasNearbyCluster(map, x, y) {
  const height = map.length;
  const width = height > 0 ? map[0].length : 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }
      if (map[ny][nx]) {
        return true;
      }
    }
  }
  return false;
}

// Function: createTerrainRng.
function createTerrainRng(seed) {
  let t = Number(seed) >>> 0 || 1;
  return function random() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Function: randomBetweenWithRng.
function randomBetweenWithRng(rng, min, max) {
  const low = Number.isFinite(min) ? Number(min) : 0;
  const high = Number.isFinite(max) ? Number(max) : low;
  if (high <= low) {
    return low;
  }
  const rand = typeof rng === "function" ? rng() : Math.random();
  return Math.floor(rand * (high - low + 1)) + low;
}

module.exports = {
  createTerrain,
  getTerrainSpawnPredicate,
  getTerrainResourcePredicate,
  findNearestWalkable,
};
