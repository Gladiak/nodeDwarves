"use strict";

const { clamp } = require("../utils");
const { getClanEffects } = require("../clans");
const { getSeasonModifier } = require("./season");
const { getRoleConfig, isEmergencyGather } = require("./roles");
const { isAdult, getHousingNeed } = require("./population");
const { addTerrainResourcesToSet } = require("./terrain");
const {
  createGatherJob,
  getStockpileTarget,
  getStockpileRatio,
  shouldPauseBrewing,
  hasInputs,
  consumeInputs,
} = require("./resources");
const {
  createWellBuildJob,
  createFieldBuildJob,
  createSawmillBuildJob,
  createWorkshopBuildJob,
  createArmoryBuildJob,
  createAlchemyLabBuildJob,
  createMithrilForgeBuildJob,
  createBreweryBuildJob,
  createMineBuildJob,
  createHouseBuildJob,
  createHouseUpgradeJob,
  createManagedWellBuildJob,
  createManagedFieldBuildJob,
  createManagedWatchtowerBuildJob,
  findMineBuildSpot,
} = require("./structures");

// Assign jobs to idle dwarves based on shortages and build needs.
function assignJobs(state, config, runtime, action) {
  let idleDwarves = state.dwarves.filter(
    (dwarf) => !dwarf.job && canWork(dwarf, config),
  );
  if (idleDwarves.length === 0) {
    return;
  }

  const buildQueue = createBuildQueueState(state, config);
  const mineQueue = createMineQueueState(state, config, buildQueue);
  const brewingPaused = shouldPauseBrewing(state, config);
  if (!brewingPaused) {
    const brewers = idleDwarves.filter((dwarf) => dwarf.role === "brewmaster");
    idleDwarves = idleDwarves.filter((dwarf) => dwarf.role !== "brewmaster");
    if (brewers.length > 0) {
      assignBreweryJobs(state, config, runtime, brewers, buildQueue);
    }
  }
  if (idleDwarves.length === 0) {
    return;
  }

  const roleConfig = getRoleConfig(config);
  const emergency = isEmergencyGather(state, config, roleConfig);
  const managerActive =
    roleConfig.enabled &&
    roleConfig.managerRatio > 0 &&
    state.dwarves.some((dwarf) => dwarf.role === "manager");
  const prioritizeMine = shouldPrioritizeMine(state, config, runtime);
  if (managerActive && !prioritizeMine) {
    const managers = idleDwarves.filter((dwarf) => dwarf.role === "manager");
    if (managers.length > 0) {
      assignManagedStructureJobs(state, config, runtime, managers, buildQueue);
      idleDwarves = idleDwarves.filter((dwarf) => !dwarf.job);
      if (idleDwarves.length === 0) {
        return;
      }
    }
  }

  assignExtraMineJobIfNeeded(
    state,
    config,
    runtime,
    idleDwarves,
    roleConfig,
    mineQueue,
    buildQueue,
  );
  if (idleDwarves.length === 0) {
    return;
  }

  assignBuildJobIfNeeded(
    state,
    config,
    runtime,
    idleDwarves,
    roleConfig,
    emergency,
    managerActive,
    prioritizeMine,
    buildQueue,
  );
  if (idleDwarves.length === 0) {
    return;
  }

  assignMineJobs(state, config, idleDwarves, roleConfig, emergency);
  if (idleDwarves.length === 0) {
    return;
  }

  assignSawmillJobs(state, config, idleDwarves, roleConfig, emergency);
  if (idleDwarves.length === 0) {
    return;
  }

  assignToolUpgradeJob(state, config, idleDwarves, roleConfig, emergency);
  if (idleDwarves.length === 0) {
    return;
  }

  assignStructureUpgradeJob(state, config, idleDwarves, roleConfig, emergency);
  if (idleDwarves.length === 0) {
    return;
  }

  assignArmoryJobs(state, config, idleDwarves, roleConfig, emergency);
  if (idleDwarves.length === 0) {
    return;
  }

  const resourceConfig = config.resources || {};
  const targets = resourceConfig.targets || resourceConfig.stockpile || {};
  const weights = getActionWeights(action, config);
  const shortages = computeShortages(state, targets, weights, config);
  const workshops = (state.structures || []).filter(
    (structure) => structure.type === "workshop",
  );
  const workshopCapacity = getWorkshopCapacity(config, workshops);
  const workshopUsage = getWorkshopUsage(state.jobs);
  const nodeResources = new Set(
    state.nodes
      .filter((node) => Number(node.remaining || 0) > 0)
      .map((node) => node.id),
  );
  if (resourceConfig.useTerrainTiles === true) {
    addTerrainResourcesToSet(nodeResources, state, resourceConfig);
  }

  state.lastPriorities = shortages;

  if (shortages.length === 0) {
    return;
  }

  let offset = 0;

  const orderedDwarves = roleConfig.enabled
    ? orderIdleDwarves(idleDwarves)
    : idleDwarves;
  const allowCraft = !roleConfig.enabled;

  for (const dwarf of orderedDwarves) {
    let job = null;

    for (let attempt = 0; attempt < shortages.length; attempt += 1) {
      const shortage = shortages[(offset + attempt) % shortages.length];
      job = createJobForShortage(
        shortage.resource,
        state,
        config,
        dwarf,
        nodeResources,
        workshops,
        workshopUsage,
        workshopCapacity,
        allowCraft,
      );

      if (job) {
        offset = (offset + attempt + 1) % shortages.length;
        break;
      }
    }

    if (!job) {
      break;
    }

    job.dwarfId = dwarf.id;
    dwarf.job = job;
    state.jobs.push(job);
    if (job.type === "craft" && job.workshopId) {
      workshopUsage[job.workshopId] =
        Number(workshopUsage[job.workshopId] || 0) + 1;
    }
  }
}

// Check whether a dwarf can be assigned work.
function canWork(dwarf, config) {
  return isAdult(dwarf, config) && !dwarf.expedition;
}

// Take an idle dwarf with the requested role if available.
function takeIdleDwarf(idleDwarves, role) {
  if (!role) {
    return idleDwarves.shift() || null;
  }
  const index = idleDwarves.findIndex((dwarf) => dwarf.role === role);
  if (index < 0) {
    return null;
  }
  return idleDwarves.splice(index, 1)[0] || null;
}

// Order idle dwarves so gatherers are assigned first.
function orderIdleDwarves(idleDwarves) {
  const gatherers = [];
  const builders = [];
  const managers = [];
  const unknown = [];
  for (const dwarf of idleDwarves) {
    if (dwarf.role === "gatherer") {
      gatherers.push(dwarf);
    } else if (dwarf.role === "builder") {
      builders.push(dwarf);
    } else if (dwarf.role === "manager") {
      managers.push(dwarf);
    } else {
      unknown.push(dwarf);
    }
  }
  return gatherers.concat(unknown, builders, managers);
}

// Apply clan build tick modifiers to a job, if applicable.
function applyClanBuildTicks(job, dwarf, config) {
  if (!job || !dwarf) {
    return;
  }
  if (
    job.type !== "build"
    && job.type !== "upgrade"
    && job.type !== "upgrade_tools"
    && job.type !== "upgrade_structure"
  ) {
    return;
  }
  const clanEffects = getClanEffects(config, dwarf.clanId);
  const bonus = Math.max(0, Number(clanEffects.build_ticks_bonus || 0));
  if (bonus <= 0) {
    return;
  }
  const workRemaining = Math.max(1, Number(job.workRemaining || 1));
  job.workRemaining = Math.max(1, Math.round(workRemaining * (1 - bonus)));
}

// Clone a cost map while keeping only positive numeric values.
function cloneCost(cost) {
  const result = {};
  if (!cost || typeof cost !== "object") {
    return result;
  }
  for (const [resource, amount] of Object.entries(cost)) {
    const value = Number(amount || 0);
    if (Number.isFinite(value) && value > 0) {
      result[resource] = value;
    }
  }
  return result;
}

// Resolve build queue limits for parallel construction.
function getBuildQueueConfig(config) {
  const jobsConfig = (config && config.jobs) || {};
  const queue = jobsConfig.buildQueue || {};
  const maxConcurrentRaw = Number(queue.maxConcurrent ?? 1);
  const maxConcurrent = Math.max(1, Math.floor(maxConcurrentRaw));
  const maxPerTickRaw = Number(queue.maxPerTick ?? maxConcurrent);
  const maxPerTick = Math.max(1, Math.floor(maxPerTickRaw));
  return { maxConcurrent, maxPerTick };
}

// Resolve mine queue limits for extra mine builds.
function getMineQueueConfig(config) {
  const jobsConfig = (config && config.jobs) || {};
  const queue = jobsConfig.mineQueue || {};
  const maxConcurrentRaw = Number(queue.maxConcurrent ?? 1);
  const maxConcurrent = Math.max(1, Math.floor(maxConcurrentRaw));
  const maxPerTickRaw = Number(queue.maxPerTick ?? maxConcurrent);
  const maxPerTick = Math.max(1, Math.floor(maxPerTickRaw));
  return { maxConcurrent, maxPerTick };
}

function buildReservedPositionsFromJobs(jobs) {
  const reserved = new Set();
  for (const job of jobs) {
    if ((job.type === "build" || job.type === "upgrade") && job.target) {
      reserved.add(`${job.target.x},${job.target.y}`);
    }
  }
  return reserved;
}

// Initialize the build queue state for the current tick.
function createBuildQueueState(state, config) {
  const jobs = (state && Array.isArray(state.jobs)) ? state.jobs : [];
  const { maxConcurrent, maxPerTick } = getBuildQueueConfig(config);
  const active = jobs.filter((job) => job.type === "build" || job.type === "upgrade").length;
  const remainingTotal = Math.max(0, maxConcurrent - active);
  const remaining = Math.max(0, Math.min(maxPerTick, remainingTotal));
  const reservedPositions = buildReservedPositionsFromJobs(jobs);
  const reservedStructures = new Set();
  for (const job of jobs) {
    if (job.type === "upgrade" && job.structureId) {
      reservedStructures.add(job.structureId);
    }
  }
  return {
    remaining,
    reservedPositions,
    reservedStructures,
  };
}

// Initialize the extra mine queue state for the current tick.
function createMineQueueState(state, config, buildQueue) {
  const jobs = (state && Array.isArray(state.jobs)) ? state.jobs : [];
  const { maxConcurrent, maxPerTick } = getMineQueueConfig(config);
  const active = jobs.filter((job) => job.type === "build" && job.structureType === "mine").length;
  const remainingTotal = Math.max(0, maxConcurrent - active);
  const remaining = Math.max(0, Math.min(maxPerTick, remainingTotal));
  const reservedPositions = buildQueue ? buildQueue.reservedPositions : buildReservedPositionsFromJobs(jobs);
  return {
    remaining,
    reservedPositions,
  };
}

// Reserve a build slot and target to avoid duplicates.
function reserveBuildQueue(buildQueue, buildJob) {
  if (!buildQueue) {
    return;
  }
  buildQueue.remaining = Math.max(0, Number(buildQueue.remaining || 0) - 1);
  if (buildJob && buildJob.target) {
    buildQueue.reservedPositions.add(`${buildJob.target.x},${buildJob.target.y}`);
  }
  if (buildJob && buildJob.type === "upgrade" && buildJob.structureId) {
    buildQueue.reservedStructures.add(buildJob.structureId);
  }
}

function reserveMineQueue(mineQueue, buildJob, buildQueue) {
  if (!mineQueue) {
    return;
  }
  mineQueue.remaining = Math.max(0, Number(mineQueue.remaining || 0) - 1);
  if (buildJob && buildJob.target) {
    mineQueue.reservedPositions.add(`${buildJob.target.x},${buildJob.target.y}`);
    if (buildQueue && buildQueue.reservedPositions) {
      buildQueue.reservedPositions.add(`${buildJob.target.x},${buildJob.target.y}`);
    }
  }
}

// Decide whether the first mine should be prioritized over other builds.
function shouldPrioritizeMine(state, config, runtime) {
  if (!runtime || runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return false;
  }
  const mineConfig = (config.structures && config.structures.mine) || {};
  const structures = state.structures || [];
  const mines = structures.filter((structure) => structure.type === "mine");
  const mineCount = mines.length;
  if (mineCount > 0) {
    return false;
  }
  const maxCount = Math.max(0, Number(mineConfig.maxCount ?? 0));
  if (maxCount > 0 && mineCount >= maxCount) {
    return false;
  }
  const queuedMines = state.jobs
    ? state.jobs.filter((job) => job.type === "build" && job.structureType === "mine").length
    : 0;
  if (maxCount > 0 && mineCount + queuedMines >= maxCount) {
    return false;
  }
  if (mineConfig.buildWhenNoMine === false && mineCount > 0) {
    return false;
  }
  const buildCost = mineConfig.buildCost || {};
  if (Object.keys(buildCost).length > 0 && !hasInputs(state.stockpile, buildCost)) {
    return false;
  }
  const target = findMineBuildSpot(state, runtime, mineConfig, null);
  return Boolean(target);
}

// Decide whether an extra mine should be forced via the mine queue.
function shouldForceExtraMine(state, config, runtime) {
  if (!runtime || runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return false;
  }
  const mineConfig = (config.structures && config.structures.mine) || {};
  const structures = state.structures || [];
  const mineCount = structures.filter((structure) => structure.type === "mine").length;
  if (mineCount <= 0) {
    return false;
  }
  const maxCount = Math.max(0, Number(mineConfig.maxCount ?? 0));
  if (maxCount > 0 && mineCount >= maxCount) {
    return false;
  }
  const queuedMines = state.jobs
    ? state.jobs.filter((job) => job.type === "build" && job.structureType === "mine").length
    : 0;
  if (maxCount > 0 && mineCount + queuedMines >= maxCount) {
    return false;
  }
  const buildCost = mineConfig.buildCostExtra || mineConfig.buildCost || {};
  if (Object.keys(buildCost).length > 0 && !hasInputs(state.stockpile, buildCost)) {
    return false;
  }
  const target = findMineBuildSpot(state, runtime, mineConfig, null);
  return Boolean(target);
}

// Prefer extra mines before the village count reaches a threshold (soft guardrail).
function shouldPreferExtraMine(state, config) {
  const mineConfig = (config.structures && config.structures.mine) || {};
  const preferExtraAlways = mineConfig.preferExtraAlways === true;
  const preferBeforeVillageCount = Math.max(
    0,
    Math.floor(Number(mineConfig.preferBeforeVillageCount ?? 0)),
  );
  const villageCount = Array.isArray(state.villages) ? state.villages.length : 0;
  if (!preferExtraAlways) {
    if (preferBeforeVillageCount <= 0) {
      return false;
    }
    if (villageCount >= preferBeforeVillageCount) {
      return false;
    }
  }
  const structures = state.structures || [];
  const mineCount = structures.filter((structure) => structure.type === "mine").length;
  if (mineCount <= 0) {
    return false;
  }
  const maxCount = Math.max(0, Number(mineConfig.maxCount ?? 0));
  if (maxCount > 0 && mineCount >= maxCount) {
    return false;
  }
  const queuedMines = state.jobs
    ? state.jobs.filter((job) => job.type === "build" && job.structureType === "mine").length
    : 0;
  if (maxCount > 0 && mineCount + queuedMines >= maxCount) {
    return false;
  }
  const buildCost = mineConfig.buildCostExtra || mineConfig.buildCost || {};
  if (Object.keys(buildCost).length > 0 && !hasInputs(state.stockpile, buildCost)) {
    return false;
  }
  return true;
}

// Assign build jobs for managed structures (wells, fields, watchtowers).
function assignManagedStructureJobs(state, config, runtime, idleDwarves, buildQueue) {
  if (idleDwarves.length === 0) {
    return;
  }
  if (!buildQueue || buildQueue.remaining <= 0) {
    return;
  }
  const reserved = buildQueue.reservedPositions;

  while (idleDwarves.length > 0 && buildQueue.remaining > 0) {
    const buildJob =
      createManagedWellBuildJob(state, config, runtime, reserved) ||
      createManagedFieldBuildJob(state, config, runtime, reserved) ||
      createManagedWatchtowerBuildJob(state, config, runtime, reserved);
    if (!buildJob) {
      return;
    }
    const dwarf = takeIdleDwarf(idleDwarves, "manager");
    if (!dwarf) {
      return;
    }
    buildJob.dwarfId = dwarf.id;
    applyClanBuildTicks(buildJob, dwarf, config);
    dwarf.job = buildJob;
    state.jobs.push(buildJob);
    reserveBuildQueue(buildQueue, buildJob);
  }
}

// Assign a build or upgrade job when housing or defenses need attention.
function assignBuildJobIfNeeded(
  state,
  config,
  runtime,
  idleDwarves,
  roleConfig,
  emergency,
  managerActive,
  prioritizeMine,
  buildQueue,
) {
  const housingConfig = (config.population && config.population.housing) || {};
  if (housingConfig.enabled === false) {
    return;
  }
  if (!runtime || runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return;
  }
  if (idleDwarves.length === 0) {
    return;
  }
  if (roleConfig.enabled && emergency) {
    return;
  }
  if (!buildQueue || buildQueue.remaining <= 0) {
    return;
  }

  const housingNeed = getHousingNeed(state, config);
  const houseConfig = (config.structures && config.structures.house) || {};
  const upgradeMinHouses = Math.max(
    0,
    Number(houseConfig.upgradeMinHouses ?? 0),
  );
  const houses = (state.structures || []).filter(
    (structure) => structure.type === "house",
  );
  const preferUpgrade =
    housingNeed.needed &&
    (upgradeMinHouses <= 0 || houses.length >= upgradeMinHouses);
  const managerMode = Boolean(managerActive);

  const preferExtraMine = shouldPreferExtraMine(state, config);

  while (idleDwarves.length > 0 && buildQueue.remaining > 0) {
    let buildJob = null;
    if (prioritizeMine) {
      buildJob = createMineBuildJob(state, config, runtime, buildQueue.reservedPositions);
    } else if (!managerMode) {
      buildJob =
        createWellBuildJob(state, config, runtime, buildQueue.reservedPositions) ||
        createFieldBuildJob(state, config, runtime, buildQueue.reservedPositions);
    }

    if (!buildJob && preferExtraMine) {
      buildJob = createMineBuildJob(state, config, runtime, buildQueue.reservedPositions);
    }

    if (!buildJob && housingNeed.needed) {
      buildJob =
        createHouseUpgradeJob(
          state,
          config,
          runtime,
          preferUpgrade,
          buildQueue.reservedStructures,
        ) ||
        createHouseBuildJob(state, config, runtime, buildQueue.reservedPositions);
    }

    if (!buildJob) {
      buildJob = createWorkshopBuildJob(state, config, runtime, buildQueue.reservedPositions);
    }
    if (!buildJob) {
      buildJob = createMineBuildJob(state, config, runtime, buildQueue.reservedPositions);
    }
    if (!buildJob) {
      buildJob = createSawmillBuildJob(state, config, runtime, buildQueue.reservedPositions);
    }
    if (!buildJob) {
      buildJob = createMithrilForgeBuildJob(state, config, runtime, buildQueue.reservedPositions);
    }
    if (!buildJob) {
      buildJob = createArmoryBuildJob(state, config, runtime, buildQueue.reservedPositions);
    }
    if (!buildJob) {
      buildJob = createAlchemyLabBuildJob(state, config, runtime, buildQueue.reservedPositions);
    }
    if (!buildJob) {
      return;
    }
    const preferred = roleConfig.enabled
      ? takeIdleDwarf(idleDwarves, "builder")
      : null;
    const dwarf = preferred || takeIdleDwarf(idleDwarves);
    if (!dwarf) {
      return;
    }
    buildJob.dwarfId = dwarf.id;
    applyClanBuildTicks(buildJob, dwarf, config);
    dwarf.job = buildJob;
    state.jobs.push(buildJob);
    reserveBuildQueue(buildQueue, buildJob);
  }
}

function assignExtraMineJobIfNeeded(
  state,
  config,
  runtime,
  idleDwarves,
  roleConfig,
  mineQueue,
  buildQueue,
) {
  if (!runtime || runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return;
  }
  if (!mineQueue || mineQueue.remaining <= 0) {
    return;
  }
  if (idleDwarves.length === 0) {
    return;
  }
  if (!shouldForceExtraMine(state, config, runtime)) {
    return;
  }

  while (idleDwarves.length > 0 && mineQueue.remaining > 0) {
    const buildJob = createMineBuildJob(state, config, runtime, mineQueue.reservedPositions);
    if (!buildJob) {
      return;
    }
    const preferred = roleConfig && roleConfig.enabled
      ? takeIdleDwarf(idleDwarves, "builder")
      : null;
    const dwarf = preferred || takeIdleDwarf(idleDwarves);
    if (!dwarf) {
      return;
    }
    buildJob.dwarfId = dwarf.id;
    applyClanBuildTicks(buildJob, dwarf, config);
    dwarf.job = buildJob;
    state.jobs.push(buildJob);
    reserveMineQueue(mineQueue, buildJob, buildQueue);
  }
}

// Assign brewery jobs to keep brewmasters stationed at breweries.
function assignBreweryJobs(state, config, runtime, brewers, buildQueue) {
  const breweryConfig = (config.structures && config.structures.brewery) || {};
  const maxCount = Number(breweryConfig.maxCount ?? 0);
  const workersPer = Math.max(
    0,
    Number(breweryConfig.workersPerBrewery ?? breweryConfig.capacity ?? 0),
  );
  if (workersPer <= 0) {
    return;
  }
  const breweries = (state.structures || []).filter(
    (structure) => structure.type === "brewery",
  );
  const canBuildMore = maxCount > 0 && breweries.length < maxCount;
  if (canBuildMore && buildQueue && buildQueue.remaining > 0) {
    const hasBreweryBuild = state.jobs.some(
      (job) => job.type === "build" && job.structureType === "brewery",
    );
    if (!hasBreweryBuild) {
      const buildJob = createBreweryBuildJob(
        state,
        config,
        runtime,
        buildQueue.reservedPositions,
      );
      if (buildJob && brewers.length > 0) {
        const dwarf = brewers.shift();
        if (!dwarf) {
          return;
        }
        buildJob.dwarfId = dwarf.id;
        applyClanBuildTicks(buildJob, dwarf, config);
        dwarf.job = buildJob;
        state.jobs.push(buildJob);
        reserveBuildQueue(buildQueue, buildJob);
      }
    }
  }
  if (breweries.length === 0) {
    return;
  }

  const workersByBrewery = {};
  for (const job of state.jobs) {
    if (job.type !== "brewery" || !job.structureId) {
      continue;
    }
    workersByBrewery[job.structureId] =
      Number(workersByBrewery[job.structureId] || 0) + 1;
  }

  for (const brewery of breweries) {
    const active = Number(workersByBrewery[brewery.id] || 0);
    let openSlots = workersPer - active;
    while (openSlots > 0 && brewers.length > 0) {
      const dwarf = brewers.shift();
      if (!dwarf) {
        return;
      }
      const job = {
        id: `job_${state.jobCounter++}`,
        type: "brewery",
        structureId: brewery.id,
        target: { x: brewery.x, y: brewery.y },
        workRemaining: 1,
        dwarfId: dwarf.id,
      };
      dwarf.job = job;
      state.jobs.push(job);
      openSlots -= 1;
    }
    if (brewers.length === 0) {
      return;
    }
  }
}

// Assign armory jobs to craft expedition kits.
function assignArmoryJobs(state, config, idleDwarves, roleConfig, emergency) {
  const ruinsConfig = config.ruins || {};
  if (ruinsConfig.enabled === false) {
    return;
  }
  const armoryConfig = (config.structures && config.structures.armory) || {};
  if (armoryConfig.pauseOnEmergency !== false && emergency) {
    return;
  }
  const workersPer = Math.max(
    0,
    Number(armoryConfig.workersPerArmory ?? armoryConfig.capacity ?? 0),
  );
  if (workersPer <= 0) {
    return;
  }
  const armories = (state.structures || []).filter(
    (structure) => structure.type === "armory",
  );
  if (armories.length === 0) {
    return;
  }

  const expeditionConfig = (config.ruins && config.ruins.expedition) || {};
  const kitResource = expeditionConfig.kitResource || "expedition_kit";
  const kitMax = Math.max(0, Number(armoryConfig.kitMax ?? 0));
  let kitReserved = 0;
  for (const job of state.jobs) {
    if (job.type !== "armory") {
      continue;
    }
    const outputs = job.outputs || {};
    kitReserved += Number(outputs[kitResource] || 0);
  }
  const kitCurrent = Number(state.stockpile[kitResource] || 0);
  if (kitMax > 0 && kitCurrent + kitReserved >= kitMax) {
    return;
  }

  const workersByArmory = {};
  for (const job of state.jobs) {
    if (job.type !== "armory" || !job.structureId) {
      continue;
    }
    workersByArmory[job.structureId] =
      Number(workersByArmory[job.structureId] || 0) + 1;
  }

  for (const armory of armories) {
    const active = Number(workersByArmory[armory.id] || 0);
    let openSlots = workersPer - active;
    while (openSlots > 0 && idleDwarves.length > 0) {
      if (kitMax > 0 && kitCurrent + kitReserved >= kitMax) {
        return;
      }
      const preferred = roleConfig.enabled
        ? takeIdleDwarf(idleDwarves, "gatherer")
        : null;
      const dwarf = preferred || takeIdleDwarf(idleDwarves);
      if (!dwarf) {
        return;
      }
      const job = createArmoryJob(
        state,
        config,
        armory,
        kitResource,
        armoryConfig,
      );
      if (!job) {
        return;
      }
      kitReserved += Number((job.outputs || {})[kitResource] || 0);
      job.dwarfId = dwarf.id;
      dwarf.job = job;
      state.jobs.push(job);
      openSlots -= 1;
    }
    if (idleDwarves.length === 0) {
      return;
    }
  }
}

// Assign mining jobs to keep miners stationed at mines.
function assignMineJobs(state, config, idleDwarves, roleConfig, emergency) {
  const mineConfig = (config.structures && config.structures.mine) || {};
  if (mineConfig.pauseOnEmergency !== false && emergency) {
    return;
  }
  const minersPerMine = Math.max(
    0,
    Number(mineConfig.minersPerMine ?? mineConfig.capacity ?? 0),
  );
  if (minersPerMine <= 0) {
    return;
  }
  const mines = (state.structures || []).filter(
    (structure) => structure.type === "mine",
  );
  if (mines.length === 0) {
    return;
  }

  const minersByMine = {};
  for (const job of state.jobs) {
    if (job.type !== "mine" || !job.structureId) {
      continue;
    }
    minersByMine[job.structureId] =
      Number(minersByMine[job.structureId] || 0) + 1;
  }

  for (const mine of mines) {
    const active = Number(minersByMine[mine.id] || 0);
    let openSlots = minersPerMine - active;
    while (openSlots > 0 && idleDwarves.length > 0) {
      const preferred = roleConfig.enabled
        ? takeIdleDwarf(idleDwarves, "gatherer")
        : null;
      const dwarf = preferred || takeIdleDwarf(idleDwarves);
      if (!dwarf) {
        return;
      }
      const job = {
        id: `job_${state.jobCounter++}`,
        type: "mine",
        structureId: mine.id,
        target: { x: mine.x, y: mine.y },
        workRemaining: 1,
        dwarfId: dwarf.id,
      };
      dwarf.job = job;
      state.jobs.push(job);
      openSlots -= 1;
    }
    if (idleDwarves.length === 0) {
      return;
    }
  }
}

// Assign sawmill jobs to keep workers stationed at sawmills.
function assignSawmillJobs(state, config, idleDwarves, roleConfig, emergency) {
  const sawmillConfig = (config.structures && config.structures.sawmill) || {};
  if (sawmillConfig.pauseOnEmergency !== false && emergency) {
    return;
  }
  const workersPer = Math.max(
    0,
    Number(sawmillConfig.workersPerSawmill ?? sawmillConfig.capacity ?? 0),
  );
  if (workersPer <= 0) {
    return;
  }
  const sawmills = (state.structures || []).filter(
    (structure) => structure.type === "sawmill",
  );
  if (sawmills.length === 0) {
    return;
  }

  const workersBySawmill = {};
  for (const job of state.jobs) {
    if (job.type !== "sawmill" || !job.structureId) {
      continue;
    }
    workersBySawmill[job.structureId] =
      Number(workersBySawmill[job.structureId] || 0) + 1;
  }

  for (const sawmill of sawmills) {
    const active = Number(workersBySawmill[sawmill.id] || 0);
    let openSlots = workersPer - active;
    while (openSlots > 0 && idleDwarves.length > 0) {
      const preferred = roleConfig.enabled
        ? takeIdleDwarf(idleDwarves, "gatherer")
        : null;
      const dwarf = preferred || takeIdleDwarf(idleDwarves);
      if (!dwarf) {
        return;
      }
      const job = {
        id: `job_${state.jobCounter++}`,
        type: "sawmill",
        structureId: sawmill.id,
        target: { x: sawmill.x, y: sawmill.y },
        workRemaining: 1,
        dwarfId: dwarf.id,
      };
      dwarf.job = job;
      state.jobs.push(job);
      openSlots -= 1;
    }
    if (idleDwarves.length === 0) {
      return;
    }
  }
}

// Assign a tools upgrade job at the workshop.
function assignToolUpgradeJob(
  state,
  config,
  idleDwarves,
  roleConfig,
  emergency,
) {
  const toolsConfig = config.tools || {};
  const workshopConfig =
    (config.structures && config.structures.workshop) || {};
  if (emergency && workshopConfig.pauseOnEmergency !== false) {
    return;
  }
  if (!state.tools) {
    return;
  }
  const maxLevel = Math.max(
    1,
    Number(toolsConfig.maxLevel || state.tools.maxLevel || 1),
  );
  const current = Math.max(1, Number(state.tools.level || 1));
  if (current >= maxLevel) {
    return;
  }
  if (state.jobs.some((job) => job.type === "upgrade_tools")) {
    return;
  }

  const workshops = (state.structures || []).filter(
    (structure) => structure.type === "workshop",
  );
  if (workshops.length === 0) {
    return;
  }
  const workshop = workshops[0];

  const baseCost = toolsConfig.upgradeBaseCost || {};
  const scale = Math.max(1, Number(toolsConfig.upgradeCostScale || 1));
  const factor = Math.pow(scale, Math.max(0, current - 1));
  const cost = {};
  for (const [resource, amount] of Object.entries(baseCost)) {
    const scaled = Math.max(0, Number(amount || 0) * factor);
    if (scaled > 0) {
      cost[resource] = Math.ceil(scaled);
    }
  }
  if (Object.keys(cost).length > 0 && !hasInputs(state.stockpile, cost)) {
    return;
  }

  const preferred = roleConfig.enabled
    ? takeIdleDwarf(idleDwarves, "builder")
    : null;
  const dwarf = preferred || takeIdleDwarf(idleDwarves);
  if (!dwarf) {
    return;
  }

  if (Object.keys(cost).length > 0) {
    consumeInputs(state.stockpile, cost);
  }

  const buildTicks = Math.max(1, Number(toolsConfig.upgradeTicks || 45));
  const job = {
    id: `job_${state.jobCounter++}`,
    type: "upgrade_tools",
    workshopId: workshop.id,
    target: { x: workshop.x, y: workshop.y },
    workRemaining: buildTicks,
    dwarfId: dwarf.id,
    nextLevel: current + 1,
    cost: cloneCost(cost),
  };

  applyClanBuildTicks(job, dwarf, config);
  dwarf.job = job;
  state.jobs.push(job);
}

// Resolve a structure level config entry for upgrades.
function getStructureLevelConfig(structConfig, level) {
  if (!structConfig || !structConfig.levels) {
    return null;
  }
  const levels = structConfig.levels;
  return levels[level] || levels[String(level)] || null;
}

// Compute upgrade costs for a structure level.
function getStructureUpgradeCost(structConfig, levelConfig, currentLevel) {
  if (levelConfig && levelConfig.upgradeCost) {
    return levelConfig.upgradeCost;
  }
  const baseCost = structConfig.upgradeBaseCost || {};
  const scale = Math.max(1, Number(structConfig.upgradeCostScale || 1));
  const factor = Math.pow(scale, Math.max(0, currentLevel - 1));
  const cost = {};
  for (const [resource, amount] of Object.entries(baseCost)) {
    const scaled = Math.max(0, Number(amount || 0) * factor);
    if (scaled > 0) {
      cost[resource] = Math.ceil(scaled);
    }
  }
  return cost;
}

// Compute upgrade ticks for a structure level.
function getStructureUpgradeTicks(structConfig, levelConfig) {
  if (levelConfig && levelConfig.upgradeTicks !== undefined) {
    return levelConfig.upgradeTicks;
  }
  return structConfig.upgradeTicks;
}

// Assign upgrade jobs for mines, sawmills, breweries, and mithril forges.
function assignStructureUpgradeJob(
  state,
  config,
  idleDwarves,
  roleConfig,
  emergency,
) {
  if (roleConfig.enabled && emergency) {
    return;
  }
  if (state.jobs.some((job) => job.type === "upgrade_structure")) {
    return;
  }
  const candidates = (state.structures || []).filter(
    (structure) => (
      structure.type === "mine"
      || structure.type === "sawmill"
      || structure.type === "brewery"
      || structure.type === "mithril_forge"
    ),
  );
  if (candidates.length === 0) {
    return;
  }

  for (const structure of candidates) {
    const structConfig = config.structures && config.structures[structure.type];
    if (!structConfig) {
      continue;
    }
    const maxLevel = Math.max(1, Number(structConfig.levelMax || 1));
    const current = Math.max(1, Number(structure.level || 1));
    if (current >= maxLevel) {
      continue;
    }

    const nextLevel = current + 1;
    const levelConfig = getStructureLevelConfig(structConfig, nextLevel);
    const cost = getStructureUpgradeCost(structConfig, levelConfig, current);
    if (Object.keys(cost).length > 0 && !hasInputs(state.stockpile, cost)) {
      continue;
    }

    const preferred = roleConfig.enabled
      ? takeIdleDwarf(idleDwarves, "builder")
      : null;
    const dwarf = preferred || takeIdleDwarf(idleDwarves);
    if (!dwarf) {
      return;
    }

    if (Object.keys(cost).length > 0) {
      consumeInputs(state.stockpile, cost);
    }

    const rawTicks = getStructureUpgradeTicks(structConfig, levelConfig);
    const buildTicks = Math.max(1, Number(rawTicks || 40));
    const job = {
      id: `job_${state.jobCounter++}`,
      type: "upgrade_structure",
      structureId: structure.id,
      structureType: structure.type,
      target: { x: structure.x, y: structure.y },
      workRemaining: buildTicks,
      dwarfId: dwarf.id,
      nextLevel,
      cost: cloneCost(cost),
    };

    applyClanBuildTicks(job, dwarf, config);
    dwarf.job = job;
    state.jobs.push(job);
    return;
  }
}

// Resolve action weights from AI or defaults.
function getActionWeights(action, config) {
  const aiConfig = config.ai || {};
  const minWeight = Number(aiConfig.minWeight ?? 0);
  const maxWeight = Number(aiConfig.maxWeight ?? 2);
  const defaults = aiConfig.defaultWeights || {};
  const rawWeights = (action && action.weights) || defaults;
  const weights = {};

  for (const [resource, value] of Object.entries(rawWeights)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      continue;
    }
    weights[resource] = clamp(numeric, minWeight, maxWeight);
  }

  return weights;
}

// Resolve the gather trigger ratio for a resource (multiplies the stockpile target).
function getGatherTriggerRatio(config, resourceId) {
  const jobsConfig = (config && config.jobs) || {};
  const trigger = jobsConfig.gatherTriggerRatio;
  if (Number.isFinite(trigger)) {
    return Math.max(0, Number(trigger));
  }
  if (!trigger || typeof trigger !== "object") {
    return 1;
  }
  const specific = trigger[resourceId];
  const fallback = trigger.default ?? trigger.all;
  if (Number.isFinite(specific)) {
    return Math.max(0, Number(specific));
  }
  if (Number.isFinite(fallback)) {
    return Math.max(0, Number(fallback));
  }
  return 1;
}

// Compute shortage list sorted by urgency.
function computeShortages(state, targets, weights, config) {
  const shortages = [];
  const aiConfig = config && config.ai ? config.ai : {};
  const priorityBoosts = aiConfig.priorityBoosts || {};
  const stockpile = state.stockpile || {};

  for (const [resource, targetValue] of Object.entries(targets)) {
    const target = getStockpileTarget(state, config, resource, targets);
    if (target <= 0) {
      continue;
    }

    const current = Number(stockpile[resource] || 0);
    const triggerRatio = getGatherTriggerRatio(config, resource);
    const effectiveTarget = target * triggerRatio;
    const missing = effectiveTarget - current;

    if (missing > 0) {
      const ratio = effectiveTarget > 0 ? missing / effectiveTarget : 0;
      const stockpileRatio = clamp(current / target, 0, 1);
      const weightRaw =
        weights && weights[resource] !== undefined ? weights[resource] : 1;
      let weight = clamp(Number(weightRaw || 1), 0, Number.POSITIVE_INFINITY);
      const boostConfig = priorityBoosts && priorityBoosts[resource];
      if (boostConfig && typeof boostConfig === "object") {
        const threshold = clamp(Number(boostConfig.threshold ?? 0), 0, 1);
        const multiplier = Math.max(0, Number(boostConfig.multiplier ?? 0));
        const minWeight = Math.max(0, Number(boostConfig.minWeight ?? 0));
        const exponent = Math.max(0.1, Number(boostConfig.exponent ?? 1));
        if (
          threshold > 0 &&
          stockpileRatio < threshold &&
          (multiplier > 0 || minWeight > 0)
        ) {
          const severity = clamp(
            (threshold - stockpileRatio) / threshold,
            0,
            1,
          );
          const boost = 1 + Math.pow(severity, exponent) * multiplier;
          weight = Math.max(weight, minWeight) * boost;
        }
      }
      const score = ratio * weight;
      shortages.push({
        resource,
        missing,
        ratio,
        weight,
        score,
      });
    }
  }

  shortages.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (b.ratio !== a.ratio) {
      return b.ratio - a.ratio;
    }
    return b.missing - a.missing;
  });

  return shortages;
}

// Determine workshop capacity for crafting jobs.
function getWorkshopCapacity(config, workshops) {
  if (!Array.isArray(workshops) || workshops.length === 0) {
    return 0;
  }

  const workshopConfig = config.structures && config.structures.workshop;
  const fallbackCapacity =
    workshops[0] && workshops[0].capacity !== undefined
      ? workshops[0].capacity
      : 1;
  const capacity =
    workshopConfig && workshopConfig.capacity !== undefined
      ? workshopConfig.capacity
      : fallbackCapacity;

  return Math.max(1, Number(capacity || 1));
}

// Track current workshop usage from active jobs.
function getWorkshopUsage(jobs) {
  const usage = {};
  for (const job of jobs) {
    if (job.type === "craft" && job.workshopId) {
      usage[job.workshopId] = Number(usage[job.workshopId] || 0) + 1;
    }
  }
  return usage;
}

// Select the nearest available workshop for a dwarf.
function selectWorkshop(workshops, workshopUsage, workshopCapacity, dwarf) {
  if (!Array.isArray(workshops) || workshops.length === 0) {
    return null;
  }
  const available = workshops.filter((workshop) => {
    const usage = Number(workshopUsage[workshop.id] || 0);
    return usage < workshopCapacity;
  });
  if (available.length === 0) {
    return null;
  }
  let best = available[0];
  let bestDistance = distance(dwarf, best);
  for (const workshop of available) {
    const dist = distance(dwarf, workshop);
    if (dist < bestDistance) {
      bestDistance = dist;
      best = workshop;
    }
  }
  return best;
}

// Compute Manhattan distance between two positions.
function distance(a, b) {
  return (
    Math.abs(Number(a.x || 0) - Number(b.x || 0)) +
    Math.abs(Number(a.y || 0) - Number(b.y || 0))
  );
}

// Return active wildlife herds that still have remaining stock.
function getActiveHerds(state) {
  const wildlife = state && state.wildlife;
  if (!wildlife || !Array.isArray(wildlife.herds)) {
    return [];
  }
  return wildlife.herds.filter((herd) => herd && Number(herd.remaining || 0) > 0);
}

// Count the number of active hunt jobs.
function countActiveHuntJobs(state) {
  const jobs = (state && Array.isArray(state.jobs)) ? state.jobs : [];
  return jobs.filter((job) => job.type === "hunt").length;
}

// Choose the nearest herd for a hunt job.
function selectHerdForHunt(herds, dwarf) {
  if (!Array.isArray(herds) || herds.length === 0) {
    return null;
  }
  let bestDistance = Infinity;
  let candidates = [];
  for (const herd of herds) {
    const dist = distance(dwarf, herd);
    if (dist < bestDistance) {
      bestDistance = dist;
      candidates = [herd];
    } else if (dist === bestDistance) {
      candidates.push(herd);
    }
  }
  if (candidates.length === 0) {
    return null;
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// Create a hunt job targeting a moving herd.
function createHuntJob(state, config, dwarf) {
  if (!state || !config || !dwarf) {
    return null;
  }
  const wildlifeConfig = (config && config.wildlife) || {};
  if (wildlifeConfig.enabled !== true) {
    return null;
  }
  const huntConfig = wildlifeConfig.hunt || {};
  if (huntConfig.enabled !== true) {
    return null;
  }
  const herds = getActiveHerds(state);
  if (herds.length === 0) {
    return null;
  }

  const maxConcurrent = Math.max(0, Math.floor(Number(huntConfig.max_concurrent ?? 0)));
  if (maxConcurrent > 0) {
    const active = countActiveHuntJobs(state);
    if (active >= maxConcurrent) {
      return null;
    }
  }

  const minFoodRatio = clamp(Number(huntConfig.min_food_ratio ?? 0), 0, 1);
  if (minFoodRatio > 0) {
    const ratio = getStockpileRatio(state, config, "food");
    if (ratio >= minFoodRatio) {
      return null;
    }
  }

  const herd = selectHerdForHunt(herds, dwarf);
  if (!herd) {
    return null;
  }
  const defaultTicks = (config.jobs && config.jobs.defaultGatherTicks) || 6;
  const workTicks = Math.max(1, Math.floor(Number(huntConfig.work_ticks ?? defaultTicks)));
  return {
    id: `job_${state.jobCounter++}`,
    type: "hunt",
    resource: "food",
    herdId: herd.id,
    target: { x: herd.x, y: herd.y },
    workRemaining: workTicks,
    dwarfId: null,
  };
}

// Create a gather or craft job for a resource shortage.
function createJobForShortage(
  resourceId,
  state,
  config,
  dwarf,
  nodeResources,
  workshops,
  workshopUsage,
  workshopCapacity,
  allowCraft = true,
) {
  if (resourceId === "food") {
    const huntJob = createHuntJob(state, config, dwarf);
    if (huntJob) {
      return huntJob;
    }
  }
  if (nodeResources.has(resourceId)) {
    return createGatherJob(resourceId, state, config, dwarf);
  }

  if (!allowCraft) {
    return null;
  }

  const recipe = getRecipe(config, resourceId);
  if (!recipe) {
    return null;
  }

  return createCraftJob(
    resourceId,
    recipe,
    state,
    dwarf,
    workshops,
    workshopUsage,
    workshopCapacity,
  );
}

// Create an armory job to craft expedition kits.
function createArmoryJob(state, config, armory, kitResource, armoryConfig) {
  if (!armory) {
    return null;
  }
  const kitCost = armoryConfig.kitCost || {};
  if (Object.keys(kitCost).length > 0 && !hasInputs(state.stockpile, kitCost)) {
    return null;
  }
  if (Object.keys(kitCost).length > 0) {
    consumeInputs(state.stockpile, kitCost);
  }
  const output = Math.max(0, Number(armoryConfig.kitOutput ?? 1));
  const workTicks = Math.max(1, Math.floor(Number(armoryConfig.kitTicks || 20)));
  return {
    id: `job_${state.jobCounter++}`,
    type: "armory",
    structureId: armory.id,
    target: { x: armory.x, y: armory.y },
    workRemaining: workTicks,
    outputs: { [kitResource]: output },
    dwarfId: null,
  };
}

// Create a craft job for a recipe and reserve inputs.
function createCraftJob(
  resourceId,
  recipe,
  state,
  dwarf,
  workshops,
  workshopUsage,
  workshopCapacity,
) {
  if (!dwarf) {
    return null;
  }

  if (
    !Array.isArray(workshops) ||
    workshops.length === 0 ||
    workshopCapacity <= 0
  ) {
    return null;
  }

  const inputs = recipe.inputs || {};
  if (!hasInputs(state.stockpile, inputs)) {
    return null;
  }

  const workshop = selectWorkshop(
    workshops,
    workshopUsage,
    workshopCapacity,
    dwarf,
  );
  if (!workshop) {
    return null;
  }

  consumeInputs(state.stockpile, inputs);
  const outputs = recipe.outputs || { [resourceId]: 1 };
  const workTicks = getRecipeTicks(recipe, state);

  return {
    id: `job_${state.jobCounter++}`,
    type: "craft",
    resource: resourceId,
    outputs,
    workshopId: workshop.id,
    target: { x: workshop.x, y: workshop.y },
    workRemaining: workTicks,
    dwarfId: null,
  };
}

// Fetch a crafting recipe from config.
function getRecipe(config, resourceId) {
  const recipes = config.recipes || {};
  const recipe = recipes[resourceId];
  return recipe || null;
}

// Compute recipe work ticks with seasonal modifiers.
function getRecipeTicks(recipe, state) {
  const ticks = recipe.ticks !== undefined ? recipe.ticks : recipe.time;
  const base = Math.max(1, Number(ticks || 6));
  const multiplier = getSeasonModifier(state, "craftTicks", 1);
  return Math.max(1, Math.round(base * multiplier));
}

module.exports = {
  assignJobs,
  canWork,
  takeIdleDwarf,
  orderIdleDwarves,
  assignBuildJobIfNeeded,
  getActionWeights,
  computeShortages,
  getWorkshopCapacity,
  getWorkshopUsage,
  selectWorkshop,
  distance,
  createJobForShortage,
  createCraftJob,
  getRecipe,
  getRecipeTicks,
};
