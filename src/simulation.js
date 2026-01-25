'use strict';

const { clamp } = require('./utils');

function stepState(state, config, runtime) {
  state.tick += 1;

  for (const dwarf of state.dwarves) {
    applyNeedDecay(dwarf, config.needs.decayPerTick || {});
    consumeResources(dwarf, state.stockpile, config.consumption || {});
    updateDerivedState(dwarf);
  }

  assignJobs(state, config);

  for (const dwarf of state.dwarves) {
    processDwarfAction(dwarf, state, config, runtime);
  }
}

function applyNeedDecay(dwarf, decay) {
  // Need values are 0..1 where 0 is satisfied and 1 is critical.
  for (const [need, delta] of Object.entries(decay)) {
    const current = Number(dwarf.needs[need] || 0);
    dwarf.needs[need] = clamp(current + Number(delta || 0), 0, 1);
  }
}

function consumeResources(dwarf, stockpile, consumption) {
  if (!stockpile) {
    return;
  }

  const hunger = Number(dwarf.needs.hunger || 0);
  const thirst = Number(dwarf.needs.thirst || 0);
  const hungerThreshold = Number(consumption.hungerThreshold ?? 0.6);
  const thirstThreshold = Number(consumption.thirstThreshold ?? 0.6);
  const mealRelief = Number(consumption.mealRelief ?? 0.5);
  const rawFoodRelief = Number(consumption.rawFoodRelief ?? 0.35);
  const boozeRelief = Number(consumption.boozeRelief ?? 0.5);
  const waterRelief = Number(consumption.waterRelief ?? 0.35);

  if (hunger >= hungerThreshold) {
    if (Number(stockpile.meal || 0) > 0) {
      stockpile.meal -= 1;
      dwarf.needs.hunger = clamp(hunger - mealRelief, 0, 1);
    } else if (Number(stockpile.food_raw || 0) > 0) {
      stockpile.food_raw -= 1;
      dwarf.needs.hunger = clamp(hunger - rawFoodRelief, 0, 1);
    }
  }

  if (thirst >= thirstThreshold) {
    if (Number(stockpile.booze || 0) > 0) {
      stockpile.booze -= 1;
      dwarf.needs.thirst = clamp(thirst - boozeRelief, 0, 1);
    } else if (Number(stockpile.water || 0) > 0) {
      stockpile.water -= 1;
      dwarf.needs.thirst = clamp(thirst - waterRelief, 0, 1);
    }
  }
}

function updateDerivedState(dwarf) {
  const values = Object.values(dwarf.needs);
  const avgNeed = values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;

  dwarf.state.morale = clamp(1 - avgNeed, 0, 1);
  dwarf.state.stress = clamp(avgNeed, 0, 1);
  dwarf.state.fatigue = clamp(Number(dwarf.needs.sleep || 0), 0, 1);
}

function assignJobs(state, config) {
  const idleDwarves = state.dwarves.filter((dwarf) => !dwarf.job);
  const resourceConfig = config.resources || {};
  const targets = resourceConfig.targets || resourceConfig.stockpile || {};
  const shortages = computeShortages(state.stockpile, targets);
  const workshops = (state.structures || []).filter((structure) => structure.type === 'workshop');
  const workshopCapacity = getWorkshopCapacity(config, workshops);
  const workshopUsage = getWorkshopUsage(state.jobs);
  const nodeResources = new Set(
    state.nodes.filter((node) => Number(node.remaining || 0) > 0).map((node) => node.id),
  );

  state.lastPriorities = shortages;

  if (idleDwarves.length === 0 || shortages.length === 0) {
    return;
  }

  let offset = 0;

  for (const dwarf of idleDwarves) {
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
    if (job.type === 'craft' && job.workshopId) {
      workshopUsage[job.workshopId] = Number(workshopUsage[job.workshopId] || 0) + 1;
    }
  }
}

function computeShortages(stockpile, targets) {
  const shortages = [];

  for (const [resource, targetValue] of Object.entries(targets)) {
    const target = Number(targetValue || 0);
    if (target <= 0) {
      continue;
    }

    const current = Number(stockpile[resource] || 0);
    const missing = target - current;

    if (missing > 0) {
      shortages.push({
        resource,
        missing,
        ratio: missing / target,
      });
    }
  }

  shortages.sort((a, b) => {
    if (b.ratio !== a.ratio) {
      return b.ratio - a.ratio;
    }
    return b.missing - a.missing;
  });

  return shortages;
}

function getWorkshopCapacity(config, workshops) {
  if (!Array.isArray(workshops) || workshops.length === 0) {
    return 0;
  }

  const workshopConfig = config.structures && config.structures.workshop;
  const fallbackCapacity = workshops[0] && workshops[0].capacity !== undefined
    ? workshops[0].capacity
    : 1;
  const capacity = workshopConfig && workshopConfig.capacity !== undefined
    ? workshopConfig.capacity
    : fallbackCapacity;

  return Math.max(1, Number(capacity || 1));
}

function getWorkshopUsage(jobs) {
  const usage = {};
  for (const job of jobs) {
    if (job.type === 'craft' && job.workshopId) {
      usage[job.workshopId] = Number(usage[job.workshopId] || 0) + 1;
    }
  }
  return usage;
}

function selectWorkshop(workshops, workshopUsage, workshopCapacity, dwarf) {
  const available = workshops.filter((workshop) => {
    const used = Number(workshopUsage[workshop.id] || 0);
    return used < workshopCapacity;
  });

  if (available.length === 0) {
    return null;
  }

  if (!dwarf) {
    return available[0];
  }

  let best = available[0];
  let bestDistance = distance(dwarf, best);

  for (let i = 1; i < available.length; i += 1) {
    const candidate = available[i];
    const candidateDistance = distance(dwarf, candidate);
    if (candidateDistance < bestDistance) {
      best = candidate;
      bestDistance = candidateDistance;
    }
  }

  return best;
}

function distance(a, b) {
  return Math.abs(Number(a.x || 0) - Number(b.x || 0)) + Math.abs(Number(a.y || 0) - Number(b.y || 0));
}

function createJobForShortage(
  resourceId,
  state,
  config,
  dwarf,
  nodeResources,
  workshops,
  workshopUsage,
  workshopCapacity,
) {
  if (nodeResources.has(resourceId)) {
    return createGatherJob(resourceId, state, config);
  }

  const recipe = getRecipe(config, resourceId);
  if (!recipe) {
    return null;
  }

  return createCraftJob(resourceId, recipe, state, dwarf, workshops, workshopUsage, workshopCapacity);
}

function createCraftJob(resourceId, recipe, state, dwarf, workshops, workshopUsage, workshopCapacity) {
  if (!dwarf) {
    return null;
  }

  if (!Array.isArray(workshops) || workshops.length === 0 || workshopCapacity <= 0) {
    return null;
  }

  const inputs = recipe.inputs || {};
  if (!hasInputs(state.stockpile, inputs)) {
    return null;
  }

  const workshop = selectWorkshop(workshops, workshopUsage, workshopCapacity, dwarf);
  if (!workshop) {
    return null;
  }

  consumeInputs(state.stockpile, inputs);
  const outputs = recipe.outputs || { [resourceId]: 1 };
  const workTicks = getRecipeTicks(recipe);

  return {
    id: `job_${state.jobCounter++}`,
    type: 'craft',
    resource: resourceId,
    outputs,
    workshopId: workshop.id,
    target: { x: workshop.x, y: workshop.y },
    workRemaining: workTicks,
    dwarfId: null,
  };
}

function getRecipe(config, resourceId) {
  const recipes = config.recipes || {};
  const recipe = recipes[resourceId];
  return recipe || null;
}

function getRecipeTicks(recipe) {
  const ticks = recipe.ticks !== undefined ? recipe.ticks : recipe.time;
  return Math.max(1, Number(ticks || 6));
}

function hasInputs(stockpile, inputs) {
  for (const [resource, amount] of Object.entries(inputs)) {
    if (Number(stockpile[resource] || 0) < Number(amount || 0)) {
      return false;
    }
  }

  return true;
}

function consumeInputs(stockpile, inputs) {
  for (const [resource, amount] of Object.entries(inputs)) {
    stockpile[resource] = Number(stockpile[resource] || 0) - Number(amount || 0);
  }
}

function applyOutputs(stockpile, outputs) {
  for (const [resource, amount] of Object.entries(outputs)) {
    stockpile[resource] = Number(stockpile[resource] || 0) + Number(amount || 0);
  }
}

function createGatherJob(resourceId, state, config) {
  const nodes = state.nodes.filter(
    (node) => node.id === resourceId && Number(node.remaining || 0) > 0,
  );
  if (nodes.length === 0) {
    return null;
  }

  const node = nodes[Math.floor(Math.random() * nodes.length)];
  const workTicks = getGatherTicks(config, resourceId);

  return {
    id: `job_${state.jobCounter++}`,
    type: 'gather',
    resource: resourceId,
    nodeId: node.nodeId,
    target: { x: node.x, y: node.y },
    workRemaining: workTicks,
    dwarfId: null,
  };
}

function processDwarfAction(dwarf, state, config, runtime) {
  if (dwarf.job) {
    processDwarfJob(dwarf, state, config, runtime);
    return;
  }

  moveDwarf(dwarf, runtime);
}

function processDwarfJob(dwarf, state, config, runtime) {
  const job = dwarf.job;
  if (!job || !job.target) {
    if (job) {
      removeJob(state, job.id);
    }
    dwarf.job = null;
    return;
  }

  if (runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return;
  }

  let targetX = clamp(job.target.x, 0, runtime.gridWidth - 1);
  let targetY = clamp(job.target.y, 0, runtime.gridHeight - 1);
  let targetNode = null;
  let targetWorkshop = null;

  if (job.type === 'gather') {
    targetNode = findNodeById(state.nodes, job.nodeId);
    if (!targetNode || Number(targetNode.remaining || 0) <= 0) {
      removeJob(state, job.id);
      dwarf.job = null;
      return;
    }

    targetX = clamp(targetNode.x, 0, runtime.gridWidth - 1);
    targetY = clamp(targetNode.y, 0, runtime.gridHeight - 1);
    job.target = { x: targetX, y: targetY };
  }
  if (job.type === 'craft') {
    targetWorkshop = findStructureById(state.structures, job.workshopId);
    if (!targetWorkshop) {
      removeJob(state, job.id);
      dwarf.job = null;
      return;
    }

    targetX = clamp(targetWorkshop.x, 0, runtime.gridWidth - 1);
    targetY = clamp(targetWorkshop.y, 0, runtime.gridHeight - 1);
    job.target = { x: targetX, y: targetY };
  }

  if (dwarf.x !== targetX || dwarf.y !== targetY) {
    moveTowards(dwarf, { x: targetX, y: targetY }, runtime);
    return;
  }

  job.workRemaining -= 1;
  if (job.workRemaining > 0) {
    return;
  }

  if (job.type === 'craft') {
    applyOutputs(state.stockpile, job.outputs || {});
    removeJob(state, job.id);
    dwarf.job = null;
    return;
  }

  const amount = getGatherYield(config, job.resource, targetNode);
  state.stockpile[job.resource] = Number(state.stockpile[job.resource] || 0) + amount;
  if (targetNode) {
    targetNode.remaining = Number(targetNode.remaining || 0) - amount;
    if (targetNode.remaining <= 0) {
      removeNode(state, targetNode.nodeId);
    }
  }
  removeJob(state, job.id);
  dwarf.job = null;
}

function moveTowards(dwarf, target, runtime) {
  if (runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return;
  }

  const dx = target.x - dwarf.x;
  const dy = target.y - dwarf.y;

  if (dx === 0 && dy === 0) {
    return;
  }

  if (Math.abs(dx) >= Math.abs(dy)) {
    dwarf.x = clamp(dwarf.x + Math.sign(dx), 0, runtime.gridWidth - 1);
  } else {
    dwarf.y = clamp(dwarf.y + Math.sign(dy), 0, runtime.gridHeight - 1);
  }
}

function removeJob(state, jobId) {
  const index = state.jobs.findIndex((job) => job.id === jobId);
  if (index >= 0) {
    state.jobs.splice(index, 1);
  }
}

function findNodeById(nodes, nodeId) {
  return nodes.find((node) => node.nodeId === nodeId) || null;
}

function findStructureById(structures, structureId) {
  if (!Array.isArray(structures)) {
    return null;
  }
  return structures.find((structure) => structure.id === structureId) || null;
}

function removeNode(state, nodeId) {
  const index = state.nodes.findIndex((node) => node.nodeId === nodeId);
  if (index >= 0) {
    state.nodes.splice(index, 1);
  }
}

function getGatherTicks(config, resourceId) {
  const jobs = config.jobs || {};
  const specific = jobs.gatherTicks && jobs.gatherTicks[resourceId];
  const value = specific !== undefined ? specific : jobs.defaultGatherTicks;

  return Math.max(1, Number(value || 6));
}

function getGatherYield(config, resourceId, node) {
  const jobs = config.jobs || {};
  const specific = jobs.gatherYield && jobs.gatherYield[resourceId];
  const value = specific !== undefined ? specific : jobs.defaultGatherYield;
  const baseYield = Math.max(1, Number(value || 1));
  if (!node) {
    return baseYield;
  }
  const remaining = Math.max(0, Number(node.remaining || 0));
  return Math.min(baseYield, remaining);
}

function moveDwarf(dwarf, runtime) {
  if (runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return;
  }

  const dirs = [
    { dx: 0, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];
  const pick = dirs[Math.floor(Math.random() * dirs.length)];

  dwarf.x = clamp(dwarf.x + pick.dx, 0, runtime.gridWidth - 1);
  dwarf.y = clamp(dwarf.y + pick.dy, 0, runtime.gridHeight - 1);
}

module.exports = { stepState };
