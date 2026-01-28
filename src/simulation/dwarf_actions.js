'use strict';

const { clamp } = require('../utils');
const { pushEvent } = require('./events');
const { moveTowards, moveWithDetour, moveDwarf } = require('./movement');
const { isWalkableTile, isTerrainResourceTile, pickTerrainResourceTarget } = require('./terrain');
const { createStructure, getHouseMaxLevel, getHouseCapacity, isBuildableCell } = require('./structures');
const { createResourceNode, getGatherYield, applyOutputs } = require('./resources');

// Process the dwarf's per-tick action (panic, job, or idle).
function processDwarfAction(dwarf, state, config, runtime) {
  if (handleRaidPanic(dwarf, state, config, runtime)) {
    return;
  }
  if (dwarf.job) {
    processDwarfJob(dwarf, state, config, runtime);
    return;
  }

  handleIdleDwarf(dwarf, state, config, runtime);
}

// Handle raid panic behavior by running home or fleeing.
function handleRaidPanic(dwarf, state, config, runtime) {
  const raid = state.raid;
  if (!raid || !raid.active) {
    return false;
  }

  if (dwarf.homeId) {
    const house = findStructureById(state.structures, dwarf.homeId);
    if (house && house.type === 'house') {
      if (dwarf.x !== house.x || dwarf.y !== house.y) {
        moveTowards(dwarf, { x: house.x, y: house.y }, runtime, state, config);
      }
      return true;
    }
  }

  moveDwarf(dwarf, runtime, state, config);
  return true;
}

// Handle idle dwarves returning home or wandering.
function handleIdleDwarf(dwarf, state, config, runtime) {
  if (!runtime || runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return;
  }
  const home = getDwarfHomePosition(dwarf, state);
  if (home && (dwarf.x !== home.x || dwarf.y !== home.y)) {
    moveWithDetour(
      dwarf,
      home.x,
      home.y,
      runtime,
      state,
      config,
      `home:${dwarf.homeId}`,
    );
    return;
  }

  const population = config.population || {};
  const wanderChance = clamp(Number(population.idleWanderChance ?? 0), 0, 1);
  if (wanderChance > 0 && Math.random() < wanderChance) {
    moveDwarf(dwarf, runtime, state, config);
  }
}

// Process the dwarf's current job, including movement and completion.
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
  let targetStructure = null;

  if (job.type === 'build') {
    if (!isBuildableCell(state, runtime, targetX, targetY)) {
      removeJob(state, job.id);
      dwarf.job = null;
      return;
    }
  }
  if (job.type === 'gather') {
    if (job.nodeId) {
      targetNode = findNodeById(state.nodes, job.nodeId);
      if (!targetNode || Number(targetNode.remaining || 0) <= 0) {
        removeJob(state, job.id);
        dwarf.job = null;
        return;
      }

      targetX = clamp(targetNode.x, 0, runtime.gridWidth - 1);
      targetY = clamp(targetNode.y, 0, runtime.gridHeight - 1);
      job.target = { x: targetX, y: targetY };
    } else if (config.resources && config.resources.useTerrainTiles === true) {
      if (!isTerrainResourceTile(state, config, job.resource, targetX, targetY)) {
        const home = getDwarfHomePosition(dwarf, state);
        const anchor = home || dwarf || null;
        const newTarget = pickTerrainResourceTarget(state, config, job.resource, anchor);
        if (!newTarget) {
          removeJob(state, job.id);
          dwarf.job = null;
          return;
        }
        targetX = clamp(newTarget.x, 0, runtime.gridWidth - 1);
        targetY = clamp(newTarget.y, 0, runtime.gridHeight - 1);
        job.target = { x: targetX, y: targetY };
      }
    } else {
      removeJob(state, job.id);
      dwarf.job = null;
      return;
    }
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
  if (job.type === 'upgrade') {
    targetStructure = findStructureById(state.structures, job.structureId);
    if (!targetStructure || targetStructure.type !== 'house') {
      removeJob(state, job.id);
      dwarf.job = null;
      return;
    }

    targetX = clamp(targetStructure.x, 0, runtime.gridWidth - 1);
    targetY = clamp(targetStructure.y, 0, runtime.gridHeight - 1);
    job.target = { x: targetX, y: targetY };
  }

  if (!isWalkableTile(state, targetX, targetY)) {
    removeJob(state, job.id);
    dwarf.job = null;
    return;
  }

  if (dwarf.x !== targetX || dwarf.y !== targetY) {
    moveWithDetour(
      dwarf,
      targetX,
      targetY,
      runtime,
      state,
      config,
      `job:${job.id}`,
    );
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
  if (job.type === 'build') {
    const type = job.structureType || 'house';
    const structure = createStructure(state, config, type, targetX, targetY);
    state.structures.push(structure);
    if (type === 'well' || type === 'field') {
      const structureConfig = (config.structures && config.structures[type]) || {};
      const resourceId = type === 'well' ? 'water' : 'food_raw';
      const nodeCapacity = structureConfig.nodeCapacity;
      const node = createResourceNode(
        state,
        config,
        resourceId,
        targetX,
        targetY,
        nodeCapacity,
        type,
      );
      state.nodes.push(node);
    }
    pushEvent(state, config, `Build: ${structure.id}`);
    removeJob(state, job.id);
    dwarf.job = null;
    return;
  }
  if (job.type === 'upgrade') {
    const house = targetStructure || findStructureById(state.structures, job.structureId);
    if (!house) {
      removeJob(state, job.id);
      dwarf.job = null;
      return;
    }
    const houseConfig = (config.structures && config.structures.house) || {};
    const maxLevel = getHouseMaxLevel(houseConfig);
    const currentLevel = Math.max(1, Number(house.level || 1));
    if (currentLevel >= maxLevel) {
      removeJob(state, job.id);
      dwarf.job = null;
      return;
    }
    const nextLevel = Math.min(maxLevel, Number(job.targetLevel || currentLevel + 1));
    house.level = nextLevel;
    house.capacity = getHouseCapacity(houseConfig, nextLevel, house.capacity);
    house.symbol = String(nextLevel);
    pushEvent(state, config, `Upgrade: ${house.id} L${nextLevel}`);
    removeJob(state, job.id);
    dwarf.job = null;
    return;
  }

  const amount = getGatherYield(config, job.resource, targetNode, state);
  state.stockpile[job.resource] = Number(state.stockpile[job.resource] || 0) + amount;
  if (targetNode) {
    const resourceConfig = config.resources || {};
    const regenConfig = resourceConfig.nodeRegen || {};
    const regenEnabled = regenConfig.enabled !== false;
    const removeDepleted = resourceConfig.removeDepletedNodes === true;

    targetNode.remaining = Math.max(0, Number(targetNode.remaining || 0) - amount);
    if (targetNode.remaining <= 0 && (removeDepleted || !regenEnabled)) {
      removeNode(state, targetNode.nodeId);
    }
  }
  removeJob(state, job.id);
  dwarf.job = null;
}

// Remove a job from the global job list.
function removeJob(state, jobId) {
  const index = state.jobs.findIndex((job) => job.id === jobId);
  if (index >= 0) {
    state.jobs.splice(index, 1);
  }
}

// Find a resource node by its node id.
function findNodeById(nodes, nodeId) {
  return nodes.find((node) => node.nodeId === nodeId) || null;
}

// Find a structure by its id.
function findStructureById(structures, structureId) {
  if (!Array.isArray(structures)) {
    return null;
  }
  return structures.find((structure) => structure.id === structureId) || null;
}

// Resolve the current home position for a dwarf.
function getDwarfHomePosition(dwarf, state) {
  if (!dwarf || !dwarf.homeId) {
    return null;
  }
  const house = findStructureById(state.structures, dwarf.homeId);
  if (!house || house.type !== 'house') {
    return null;
  }
  return { x: Number(house.x || 0), y: Number(house.y || 0) };
}

// Remove a resource node from the state.
function removeNode(state, nodeId) {
  const index = state.nodes.findIndex((node) => node.nodeId === nodeId);
  if (index >= 0) {
    state.nodes.splice(index, 1);
  }
}

module.exports = { processDwarfAction };
