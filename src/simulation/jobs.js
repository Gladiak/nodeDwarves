"use strict";

const { clamp } = require("../utils");
const { getSeasonModifier } = require("./season");
const { getRoleConfig, isEmergencyGather } = require("./roles");
const { isAdult, getHousingNeed } = require("./population");
const { addTerrainResourcesToSet } = require("./terrain");
const { createGatherJob, hasInputs, consumeInputs } = require("./resources");
const {
  createWellBuildJob,
  createFieldBuildJob,
  createSawmillBuildJob,
  createWorkshopBuildJob,
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
      assignManagedStructureJobs(state, config, runtime, managers);
      idleDwarves = idleDwarves.filter((dwarf) => !dwarf.job);
      if (idleDwarves.length === 0) {
        return;
      }
    }
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

  const resourceConfig = config.resources || {};
  const targets = resourceConfig.targets || resourceConfig.stockpile || {};
  const weights = getActionWeights(action, config);
  const shortages = computeShortages(state.stockpile, targets, weights, config);
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
  return isAdult(dwarf, config);
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

// Decide whether the first mine should be prioritized over other builds.
function shouldPrioritizeMine(state, config, runtime) {
  if (!runtime || runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return false;
  }
  const mineConfig = (config.structures && config.structures.mine) || {};
  if (mineConfig.buildWhenNoMine === false) {
    return false;
  }
  const structures = state.structures || [];
  if (structures.some((structure) => structure.type === "mine")) {
    return false;
  }
  const buildCost = mineConfig.buildCost || {};
  if (Object.keys(buildCost).length > 0 && !hasInputs(state.stockpile, buildCost)) {
    return false;
  }
  const target = findMineBuildSpot(state, runtime, mineConfig);
  return Boolean(target);
}

// Assign build jobs for managed structures (wells, fields, watchtowers).
function assignManagedStructureJobs(state, config, runtime, idleDwarves) {
  if (idleDwarves.length === 0) {
    return;
  }
  const reserved = new Set();
  for (const job of state.jobs) {
    if (job.type === "build" && job.target) {
      reserved.add(`${job.target.x},${job.target.y}`);
    }
  }

  while (idleDwarves.length > 0) {
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
    dwarf.job = buildJob;
    state.jobs.push(buildJob);
    if (buildJob.target) {
      reserved.add(`${buildJob.target.x},${buildJob.target.y}`);
    }
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
) {
  const housingConfig = (config.population && config.population.housing) || {};
  if (housingConfig.enabled === false) {
    return;
  }
  if (!runtime || runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return;
  }
  const hasBlockingBuild = state.jobs.some((job) => {
    if (job.type === "build" && job.structureType !== "watchtower") {
      return true;
    }
    return false;
  });
  if (hasBlockingBuild) {
    return;
  }
  if (idleDwarves.length === 0) {
    return;
  }
  if (roleConfig.enabled && emergency) {
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
  let buildJob = null;
  if (prioritizeMine) {
    buildJob = createMineBuildJob(state, config, runtime);
  } else if (!managerMode) {
    buildJob =
      createWellBuildJob(state, config, runtime) ||
      createFieldBuildJob(state, config, runtime);
  }

  if (!buildJob && housingNeed.needed) {
    buildJob =
      createHouseUpgradeJob(state, config, runtime, preferUpgrade) ||
      createHouseBuildJob(state, config, runtime);
  }

  if (!buildJob) {
    buildJob = createWorkshopBuildJob(state, config, runtime);
  }
  if (!buildJob) {
    buildJob = createMineBuildJob(state, config, runtime);
  }
  if (!buildJob) {
    buildJob = createSawmillBuildJob(state, config, runtime);
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
  dwarf.job = buildJob;
  state.jobs.push(buildJob);
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
  };

  dwarf.job = job;
  state.jobs.push(job);
}

// Assign upgrade jobs for mines and sawmills.
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
    (structure) => structure.type === "mine" || structure.type === "sawmill",
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

    const baseCost = structConfig.upgradeBaseCost || {};
    const scale = Math.max(1, Number(structConfig.upgradeCostScale || 1));
    const factor = Math.pow(scale, Math.max(0, current - 1));
    const cost = {};
    for (const [resource, amount] of Object.entries(baseCost)) {
      const scaled = Math.max(0, Number(amount || 0) * factor);
      if (scaled > 0) {
        cost[resource] = Math.ceil(scaled);
      }
    }
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

    const buildTicks = Math.max(1, Number(structConfig.upgradeTicks || 40));
    const job = {
      id: `job_${state.jobCounter++}`,
      type: "upgrade_structure",
      structureId: structure.id,
      structureType: structure.type,
      target: { x: structure.x, y: structure.y },
      workRemaining: buildTicks,
      dwarfId: dwarf.id,
      nextLevel: current + 1,
    };

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

// Compute shortage list sorted by urgency.
function computeShortages(stockpile, targets, weights, config) {
  const shortages = [];
  const aiConfig = config && config.ai ? config.ai : {};
  const priorityBoosts = aiConfig.priorityBoosts || {};

  for (const [resource, targetValue] of Object.entries(targets)) {
    const target = Number(targetValue || 0);
    if (target <= 0) {
      continue;
    }

    const current = Number(stockpile[resource] || 0);
    const missing = target - current;

    if (missing > 0) {
      const ratio = missing / target;
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
