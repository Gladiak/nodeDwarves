'use strict';

const { clamp } = require('../utils');
const { pushEvent } = require('./events');
const {
  moveTowards,
  moveWithDetour,
  moveDwarf,
  findNearbyWalkablePosition,
} = require('./movement');
const { randomBetween } = require('./random');
const { getClanEffects } = require('../clans');
const {
  isWalkableTile,
  getTerrainTypeAt,
  isTerrainResourceTile,
  pickTerrainResourceTarget,
  getTerrainCooldownTicks,
  applyTerrainCooldown,
} = require('./terrain');
const { createStructure, getHouseMaxLevel, getHouseCapacity, isBuildableCell } = require('./structures');
const {
  createResourceNode,
  getGatherYield,
  getToolMultiplier,
  shouldPauseBrewing,
  shouldIgnoreTerrainCooldown,
  hasInputs,
  consumeInputs,
  applyOutputs,
} = require('./resources');
const { getAlchemyMultiplier } = require('./alchemy');
const { findHerdById } = require('./wildlife');
const { completeTempleStageBuild } = require('./temple');

// Process the dwarf's per-tick action (panic, job, or idle).
function processDwarfAction(dwarf, state, config, runtime) {
  if (dwarf && dwarf.underrealmDuty && dwarf.underrealmDuty.active !== false) {
    if (dwarf.job && dwarf.job.id) {
      removeJob(state, dwarf.job.id);
      dwarf.job = null;
    }
    return;
  }
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
    const house = findStructureById(state, dwarf.homeId);
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
    resetIdleWanderState(dwarf);
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

  const wander = getIdleWanderConfig(config);
  if (!wander.enabled || wander.chance <= 0 || wander.radius <= 0) {
    return;
  }

  const pauseTicks = Math.max(0, Math.floor(Number(dwarf.idlePauseTicks || 0)));
  if (pauseTicks > 0) {
    dwarf.idlePauseTicks = pauseTicks - 1;
    return;
  }

  const anchor = home || dwarf;
  let targetX = Number(dwarf.idleTargetX);
  let targetY = Number(dwarf.idleTargetY);
  let hasTarget = Number.isFinite(targetX) && Number.isFinite(targetY);
  if (hasTarget) {
    const targetAge = Math.max(0, Math.floor(Number(dwarf.idleTargetAge || 0)));
    if (!isWalkableTile(state, targetX, targetY)) {
      clearIdleWanderTarget(dwarf);
      hasTarget = false;
    } else if (wander.maxTargetAge > 0 && targetAge >= wander.maxTargetAge) {
      clearIdleWanderTarget(dwarf);
      hasTarget = false;
    }
  }

  if (hasTarget) {
    if (dwarf.x === targetX && dwarf.y === targetY) {
      clearIdleWanderTarget(dwarf);
      dwarf.idlePauseTicks = randomBetween(wander.minPauseTicks, wander.maxPauseTicks);
      return;
    }
    moveWithDetour(
      dwarf,
      targetX,
      targetY,
      runtime,
      state,
      config,
      `idle:${targetX},${targetY}`,
    );
    dwarf.idleTargetAge = Math.max(0, Math.floor(Number(dwarf.idleTargetAge || 0))) + 1;
    return;
  }

  if (Math.random() >= wander.chance) {
    return;
  }

  const target = findNearbyWalkablePosition(
    state,
    runtime,
    anchor.x,
    anchor.y,
    wander.radius,
    wander.maxAttempts,
  );
  if (!target || (target.x === dwarf.x && target.y === dwarf.y)) {
    return;
  }
  dwarf.idleTargetX = target.x;
  dwarf.idleTargetY = target.y;
  dwarf.idleTargetAge = 0;
  moveWithDetour(
    dwarf,
    target.x,
    target.y,
    runtime,
    state,
    config,
    `idle:${target.x},${target.y}`,
  );
}

// Resolve idle wander tuning from config.
function getIdleWanderConfig(config) {
  const population = (config && config.population) ? config.population : {};
  const idle = population.idleWander || {};
  const fallbackChance = population.idleWanderChance ?? 0;
  const enabled = idle.enabled !== false;
  const chance = clamp(Number(idle.chance ?? fallbackChance ?? 0), 0, 1);
  const radius = Math.max(0, Math.floor(Number(idle.radius ?? 6)));
  const minPauseTicks = Math.max(0, Math.floor(Number(idle.minPauseTicks ?? 6)));
  const maxPauseTicks = Math.max(minPauseTicks, Math.floor(Number(idle.maxPauseTicks ?? 18)));
  const maxTargetAge = Math.max(0, Math.floor(Number(idle.maxTargetAge ?? 120)));
  const maxAttempts = Math.max(1, Math.floor(Number(idle.maxAttempts ?? 18)));
  return {
    enabled,
    chance,
    radius,
    minPauseTicks,
    maxPauseTicks,
    maxTargetAge,
    maxAttempts,
  };
}

// Clear idle wander target data stored on the dwarf.
function clearIdleWanderTarget(dwarf) {
  delete dwarf.idleTargetX;
  delete dwarf.idleTargetY;
  delete dwarf.idleTargetAge;
}

// Reset idle wander state on a dwarf.
function resetIdleWanderState(dwarf) {
  clearIdleWanderTarget(dwarf);
  delete dwarf.idlePauseTicks;
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
    const isTempleBuild = job.structureType === 'temple_of_ancestors';
    if (!isTempleBuild && !isBuildableCell(state, runtime, targetX, targetY)) {
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
      const ignoreCooldown = shouldIgnoreTerrainCooldown(state, config, job.resource);
      if (!isTerrainResourceTile(state, config, job.resource, targetX, targetY, { ignoreCooldown })) {
        const home = getDwarfHomePosition(dwarf, state);
        const anchor = home || dwarf || null;
        const newTarget = pickTerrainResourceTarget(state, config, job.resource, anchor, { ignoreCooldown });
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
  if (job.type === 'hunt') {
    const herd = findHerdById(state, job.herdId);
    if (!herd || Number(herd.remaining || 0) <= 0) {
      removeJob(state, job.id);
      dwarf.job = null;
      return;
    }
    targetX = clamp(herd.x, 0, runtime.gridWidth - 1);
    targetY = clamp(herd.y, 0, runtime.gridHeight - 1);
    job.target = { x: targetX, y: targetY };
  }
  if (job.type === 'craft') {
    targetWorkshop = findStructureById(state, job.workshopId);
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
    targetStructure = findStructureById(state, job.structureId);
    if (!targetStructure || targetStructure.type !== 'house') {
      removeJob(state, job.id);
      dwarf.job = null;
      return;
    }

    targetX = clamp(targetStructure.x, 0, runtime.gridWidth - 1);
    targetY = clamp(targetStructure.y, 0, runtime.gridHeight - 1);
    job.target = { x: targetX, y: targetY };
  }
  if (job.type === 'upgrade_tools') {
    targetWorkshop = findStructureById(state, job.workshopId);
    if (!targetWorkshop || targetWorkshop.type !== 'workshop') {
      removeJob(state, job.id);
      dwarf.job = null;
      return;
    }

    targetX = clamp(targetWorkshop.x, 0, runtime.gridWidth - 1);
    targetY = clamp(targetWorkshop.y, 0, runtime.gridHeight - 1);
    job.target = { x: targetX, y: targetY };
  }
  if (job.type === 'upgrade_structure') {
    targetStructure = findStructureById(state, job.structureId);
    if (!targetStructure || targetStructure.type !== job.structureType) {
      removeJob(state, job.id);
      dwarf.job = null;
      return;
    }

    targetX = clamp(targetStructure.x, 0, runtime.gridWidth - 1);
    targetY = clamp(targetStructure.y, 0, runtime.gridHeight - 1);
    job.target = { x: targetX, y: targetY };
  }
  if (job.type === 'mine') {
    targetStructure = findStructureById(state, job.structureId);
    if (!targetStructure || targetStructure.type !== 'mine') {
      removeJob(state, job.id);
      dwarf.job = null;
      return;
    }

    targetX = clamp(targetStructure.x, 0, runtime.gridWidth - 1);
    targetY = clamp(targetStructure.y, 0, runtime.gridHeight - 1);
    job.target = { x: targetX, y: targetY };
  }
  if (job.type === 'sawmill') {
    targetStructure = findStructureById(state, job.structureId);
    if (!targetStructure || targetStructure.type !== 'sawmill') {
      removeJob(state, job.id);
      dwarf.job = null;
      return;
    }

    targetX = clamp(targetStructure.x, 0, runtime.gridWidth - 1);
    targetY = clamp(targetStructure.y, 0, runtime.gridHeight - 1);
    job.target = { x: targetX, y: targetY };
  }
  if (job.type === 'brewery') {
    targetStructure = findStructureById(state, job.structureId);
    if (!targetStructure || targetStructure.type !== 'brewery') {
      removeJob(state, job.id);
      dwarf.job = null;
      return;
    }

    targetX = clamp(targetStructure.x, 0, runtime.gridWidth - 1);
    targetY = clamp(targetStructure.y, 0, runtime.gridHeight - 1);
    job.target = { x: targetX, y: targetY };
  }
  if (job.type === 'armory') {
    targetStructure = findStructureById(state, job.structureId);
    if (!targetStructure || targetStructure.type !== 'armory') {
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
    const pathKey = resolveJobPathKey(job, targetX, targetY);
    moveWithDetour(
      dwarf,
      targetX,
      targetY,
      runtime,
      state,
      config,
      pathKey,
    );
    return;
  }

  if (job.type === 'mine') {
    const clanEffects = getClanEffects(config, dwarf.clanId);
    const output = getMineOutput(state, config, targetStructure, clanEffects);
    if (output) {
      applyOutputs(state.stockpile, output, state, config);
    }
    return;
  }
  if (job.type === 'sawmill') {
    const clanEffects = getClanEffects(config, dwarf.clanId);
    const output = getSawmillOutput(state, config, targetStructure);
    const penalty = Math.max(0, Number(clanEffects.sawmill_output_penalty || 0));
    const adjusted = applyOutputMultiplier(output, 1 - penalty);
    if (adjusted) {
      applyOutputs(state.stockpile, adjusted, state, config);
    }
    return;
  }
  if (job.type === 'brewery') {
    if (shouldPauseBrewing(state, config)) {
      removeJob(state, job.id);
      dwarf.job = null;
      return;
    }
    const output = getBreweryOutput(state, config, targetStructure);
    if (!output || Object.keys(output).length === 0) {
      return;
    }
    const cost = getBreweryFoodCost(state, config, targetStructure);
    if (cost > 0) {
      const inputs = { food: cost };
      if (!hasInputs(state.stockpile, inputs)) {
        return;
      }
      consumeInputs(state.stockpile, inputs);
    }
    applyOutputs(state.stockpile, output, state, config);
    return;
  }

  job.workRemaining -= 1;
  if (job.workRemaining > 0) {
    return;
  }

  if (job.type === 'armory') {
    for (const [resource, amount] of Object.entries(job.outputs || {})) {
      state.stockpile[resource] = Number(state.stockpile[resource] || 0) + Number(amount || 0);
    }
    removeJob(state, job.id);
    dwarf.job = null;
    return;
  }
  if (job.type === 'craft') {
    applyOutputs(state.stockpile, job.outputs || {}, state, config);
    removeJob(state, job.id);
    dwarf.job = null;
    return;
  }
  if (job.type === 'build') {
    const type = job.structureType || 'house';
    if (type === 'temple_of_ancestors') {
      const result = completeTempleStageBuild(state, config, job);
      if (result && result.completed) {
        const stageLabel = result.stageName
          ? `Temple: Stage ${result.stage}/${result.maxStage} ${result.stageName}`
          : `Temple: Stage ${result.stage}/${result.maxStage}`;
        pushEvent(state, config, stageLabel);
        if (result.fullyCompleted) {
          const prestige = Math.round(Number(result.completionPrestige || 0));
          if (prestige > 0) {
            pushEvent(state, config, `Temple complete: +${prestige} prestige`);
          } else {
            pushEvent(state, config, 'Temple complete: Ancestors honored');
          }
        }
      }
      applyClanBuildCostPenalty(dwarf, state, config, job);
      removeJob(state, job.id);
      dwarf.job = null;
      return;
    }
    const structure = createStructure(state, config, type, targetX, targetY);
    state.structures.push(structure);
    if (type === 'well' || type === 'field') {
      const structureConfig = (config.structures && config.structures[type]) || {};
      const resourceId = type === 'well' ? 'water' : 'food';
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
    applyClanBuildCostPenalty(dwarf, state, config, job);
    removeJob(state, job.id);
    dwarf.job = null;
    return;
  }
  if (job.type === 'upgrade') {
    const house = targetStructure || findStructureById(state, job.structureId);
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
    const symbols = config.symbols || {};
    house.symbol = symbols.house || house.symbol;
    pushEvent(state, config, `Upgrade: ${house.id} L${nextLevel}`);
    applyClanBuildCostPenalty(dwarf, state, config, job);
    removeJob(state, job.id);
    dwarf.job = null;
    return;
  }
  if (job.type === 'upgrade_tools') {
    const tools = state.tools || {};
    const toolsConfig = config.tools || {};
    const maxLevel = Math.max(1, Number(toolsConfig.maxLevel || tools.maxLevel || 1));
    const current = Math.max(1, Number(tools.level || 1));
    const nextLevel = Math.min(maxLevel, Number(job.nextLevel || current + 1));
    tools.level = nextLevel;
    tools.maxLevel = maxLevel;
    state.tools = tools;
    pushEvent(state, config, `Tools: L${nextLevel}`);
    applyClanBuildCostPenalty(dwarf, state, config, job);
    removeJob(state, job.id);
    dwarf.job = null;
    return;
  }
  if (job.type === 'upgrade_structure') {
    const structure = targetStructure || findStructureById(state, job.structureId);
    if (!structure) {
      removeJob(state, job.id);
      dwarf.job = null;
      return;
    }
    const structConfig = config.structures && config.structures[structure.type];
    const maxLevel = Math.max(1, Number(structConfig && structConfig.levelMax || 1));
    const current = Math.max(1, Number(structure.level || 1));
    const nextLevel = Math.min(maxLevel, Number(job.nextLevel || current + 1));
    structure.level = nextLevel;
    pushEvent(state, config, `Upgrade: ${structure.id} L${nextLevel}`);
    applyClanBuildCostPenalty(dwarf, state, config, job);
    removeJob(state, job.id);
    dwarf.job = null;
    return;
  }

  if (job.type === 'hunt') {
    const wildlifeConfig = (config && config.wildlife) || {};
    const huntConfig = wildlifeConfig.hunt || {};
    const herd = findHerdById(state, job.herdId);
    if (!herd || Number(herd.remaining || 0) <= 0) {
      removeJob(state, job.id);
      dwarf.job = null;
      return;
    }

    const yieldMinRaw = Number(huntConfig.yield_min ?? 1);
    const yieldMin = Math.max(1, Math.floor(yieldMinRaw || 1));
    const yieldMaxRaw = Number(huntConfig.yield_max ?? yieldMin);
    const yieldMax = Math.max(yieldMin, Math.floor(yieldMaxRaw || yieldMin));
    let amount = randomBetween(yieldMin, yieldMax);

    const riskConfig = huntConfig.risk || {};
    const deathChance = clamp(Number(riskConfig.death_chance ?? 0), 0, 1);
    const penaltyChance = clamp(Number(riskConfig.penalty_chance ?? 0), 0, 1);
    const roll = Math.random();
    if (roll < deathChance) {
      pushEvent(state, config, `Hunt failed: ${dwarf.id} fell`);
      applyHuntDeath(state, dwarf);
      return;
    }
    if (roll < deathChance + penaltyChance) {
      const penalty = riskConfig.penalty || {};
      const yieldMultiplier = Math.max(0, Number(penalty.yield_multiplier ?? 1));
      const cooldown = Math.max(0, Math.floor(Number(penalty.move_cooldown ?? 0)));
      amount = Math.max(0, Math.round(amount * yieldMultiplier));
      if (cooldown > 0) {
        dwarf.moveCooldown = Math.max(0, Number(dwarf.moveCooldown || 0)) + cooldown;
      }
    }

    const actual = Math.min(Math.max(0, amount), Math.max(0, Number(herd.remaining || 0)));
    if (actual > 0) {
      herd.remaining = Math.max(0, Number(herd.remaining || 0) - actual);
      state.stockpile.food = Number(state.stockpile.food || 0) + actual;
    }
    removeJob(state, job.id);
    dwarf.job = null;
    return;
  }

  let amount = getGatherYield(config, job.resource, targetNode, state);
  const clanEffects = getClanEffects(config, dwarf.clanId);
  const gatherPenalty = Math.max(0, Number(clanEffects.gather_yield_penalty || 0));
  const penaltyResources = Array.isArray(clanEffects.gather_penalty_resources)
    ? clanEffects.gather_penalty_resources
    : null;
  if (
    gatherPenalty > 0
    && (!penaltyResources || penaltyResources.includes(job.resource))
  ) {
    amount = Math.max(1, Math.round(amount * (1 - gatherPenalty)));
  }
  if (!targetNode && job.resource === 'food') {
    const terrainType = getTerrainTypeAt(state, targetX, targetY);
    if (terrainType === 'pasture') {
      amount = consumePastureStock(state, targetX, targetY, amount);
    }
  }
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
  if (!targetNode && config.resources && config.resources.useTerrainTiles === true) {
    const cooldownTicks = getTerrainCooldownTicks(config, job.resource);
    if (cooldownTicks > 0) {
      applyTerrainCooldown(state, targetX, targetY, cooldownTicks);
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

// Consume stock from a pasture tile and return the actual yield.
function consumePastureStock(state, x, y, amount) {
  const pasture = state && state.pasture;
  if (!pasture || !pasture.mask || !pasture.remaining) {
    return amount;
  }
  const width = pasture.width;
  const height = pasture.height;
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return amount;
  }
  const index = y * width + x;
  if (!pasture.mask[index]) {
    return amount;
  }
  const remaining = Math.max(0, Number(pasture.remaining[index] || 0));
  if (remaining <= 0) {
    return 0;
  }
  const actual = Math.min(remaining, Math.max(0, Number(amount || 0)));
  pasture.remaining[index] = remaining - actual;
  return actual;
}

// Apply a hunt death and remove the dwarf from state.
function applyHuntDeath(state, dwarf) {
  if (!state || !dwarf) {
    return;
  }
  state.deathsByCause.hunt = Number(state.deathsByCause.hunt || 0) + 1;
  state.deathsCount = Number(state.deathsCount || 0) + 1;
  state.lastDeathTick = Number(state.tick || 0);
  state.dwarves = state.dwarves.filter((entry) => entry.id !== dwarf.id);
  state.jobs = state.jobs.filter((job) => job.dwarfId !== dwarf.id);
}

// Resolve a stable path key per job target to improve field-cache reuse.
function resolveJobPathKey(job, targetX, targetY) {
  if (!job || !job.type) {
    return `job:unknown:${targetX},${targetY}`;
  }
  if (job.type === 'gather') {
    if (job.nodeId) {
      return `job:gather:node:${job.nodeId}`;
    }
    return `job:gather:tile:${targetX},${targetY}`;
  }
  if (job.type === 'hunt' && job.herdId) {
    return `job:hunt:herd:${job.herdId}`;
  }
  if ((job.type === 'craft' || job.type === 'upgrade_tools') && job.workshopId) {
    return `job:${job.type}:workshop:${job.workshopId}`;
  }
  if (
    (
      job.type === 'upgrade'
      || job.type === 'upgrade_structure'
      || job.type === 'mine'
      || job.type === 'sawmill'
      || job.type === 'brewery'
      || job.type === 'armory'
    )
    && job.structureId
  ) {
    return `job:${job.type}:structure:${job.structureId}`;
  }
  if (job.type === 'build' && job.structureType) {
    return `job:build:${job.structureType}:${targetX},${targetY}`;
  }
  return `job:${job.type}:${targetX},${targetY}`;
}

// Find a resource node by its node id.
function findNodeById(nodes, nodeId) {
  return nodes.find((node) => node.nodeId === nodeId) || null;
}

// Build or reuse a per-tick structure lookup map.
function getStructureIndex(state) {
  if (!state || !Array.isArray(state.structures)) {
    return null;
  }
  const tick = Number(state.tick || 0);
  const length = state.structures.length;
  const counter = Number(state.structureCounter || 0);
  const cache = state.structureIndex;
  if (
    cache
    && cache.tick === tick
    && cache.length === length
    && cache.counter === counter
    && cache.map instanceof Map
  ) {
    return cache.map;
  }
  const map = new Map();
  for (const structure of state.structures) {
    if (structure && structure.id) {
      map.set(structure.id, structure);
    }
  }
  state.structureIndex = { tick, length, counter, map };
  return map;
}

// Find a structure by its id.
function findStructureById(state, structureId) {
  if (!state || !Array.isArray(state.structures)) {
    return null;
  }
  const index = getStructureIndex(state);
  if (!index) {
    return null;
  }
  return index.get(structureId) || null;
}

// Resolve the current home position for a dwarf.
function getDwarfHomePosition(dwarf, state) {
  if (!dwarf || !dwarf.homeId) {
    return null;
  }
  const house = findStructureById(state, dwarf.homeId);
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

// Apply a multiplier to an output map.
function applyOutputMultiplier(output, multiplier) {
  if (!output || typeof output !== 'object') {
    return output;
  }
  const safeMultiplier = Number.isFinite(multiplier) ? multiplier : 1;
  if (safeMultiplier === 1) {
    return output;
  }
  const scaled = {};
  for (const [resource, amount] of Object.entries(output)) {
    scaled[resource] = Number(amount || 0) * safeMultiplier;
  }
  return scaled;
}

// Apply per-clan build cost penalty for stone/iron at completion time.
function applyClanBuildCostPenalty(dwarf, state, config, job) {
  if (!dwarf || !job || !state || !config) {
    return;
  }
  const clanEffects = getClanEffects(config, dwarf.clanId);
  const penalty = Math.max(0, Number(clanEffects.build_cost_penalty || 0));
  if (penalty <= 0) {
    return;
  }
  const cost = job.cost;
  if (!cost || typeof cost !== 'object') {
    return;
  }
  const extra = {};
  for (const [resource, amount] of Object.entries(cost)) {
    if (resource !== 'stone' && resource !== 'iron') {
      continue;
    }
    const extraAmount = Math.max(0, Math.floor(Number(amount || 0) * penalty));
    if (extraAmount > 0) {
      extra[resource] = extraAmount;
    }
  }
  if (Object.keys(extra).length === 0) {
    return;
  }
  if (!hasInputs(state.stockpile, extra)) {
    return;
  }
  consumeInputs(state.stockpile, extra);
}

// Resolve mine outputs per tick from config.
function getMineOutput(state, config, structure, clanEffects) {
  const mineConfig = config.structures && config.structures.mine;
  if (!mineConfig || !mineConfig.outputPerTick) {
    return null;
  }
  const structureMultiplier = getStructureLevelMultiplier(structure, mineConfig);
  const output = {};
  for (const [resource, amount] of Object.entries(mineConfig.outputPerTick)) {
    const multiplier = getToolMultiplier(state, config, resource);
    output[resource] = Number(amount || 0) * multiplier * structureMultiplier;
  }
  const rareBonus = Math.max(0, Number(clanEffects && clanEffects.mine_rare_chance_bonus || 0));
  const rareOutput = getMineRareOutputs(state, config, structure, structureMultiplier, rareBonus);
  if (rareOutput) {
    for (const [resource, amount] of Object.entries(rareOutput)) {
      output[resource] = Number(output[resource] || 0) + Number(amount || 0);
    }
  }
  const bonus = Math.max(0, Number(clanEffects && clanEffects.mine_output_bonus || 0));
  const penalty = Math.max(0, Number(clanEffects && clanEffects.mine_output_penalty || 0));
  const clanMultiplier = Math.max(0, 1 + bonus - penalty);
  const alchemyMultiplier = getAlchemyMultiplier(state, config, 'mineOutput', 1);
  return applyOutputMultiplier(output, clanMultiplier * alchemyMultiplier);
}

// Resolve rare mine drops based on mine level and configured chances.
function getMineRareOutputs(state, config, structure, structureMultiplier, rareBonus) {
  const mineConfig = config.structures && config.structures.mine;
  const rareDrops = mineConfig && mineConfig.rareDrops;
  if (!rareDrops || typeof rareDrops !== 'object') {
    return null;
  }
  const alchemyRareMultiplier = getAlchemyMultiplier(state, config, 'mineRareChance', 1);

  const level = Math.max(1, Number(structure && structure.level || 1));
  const output = {};

  for (const [resource, definition] of Object.entries(rareDrops)) {
    if (!definition || typeof definition !== 'object') {
      continue;
    }
    const minLevel = Math.max(1, Number(definition.minLevel || 1));
    if (level < minLevel) {
      continue;
    }
    const baseChance = clamp(Number(definition.chance || 0), 0, 1);
    const chance = clamp(
      (baseChance + Math.max(0, Number(rareBonus || 0))) * alchemyRareMultiplier,
      0,
      1,
    );
    if (chance <= 0 || Math.random() >= chance) {
      continue;
    }
    const amount = Math.max(0, Number(definition.amount ?? 1));
    if (amount <= 0) {
      continue;
    }
    const multiplier = getToolMultiplier(state, config, resource);
    output[resource] = Number(output[resource] || 0)
      + amount * multiplier * structureMultiplier;
  }

  return Object.keys(output).length > 0 ? output : null;
}

// Resolve sawmill outputs per tick from config.
function getSawmillOutput(state, config, structure) {
  const sawmillConfig = config.structures && config.structures.sawmill;
  if (!sawmillConfig || !sawmillConfig.outputPerTick) {
    return null;
  }
  const multiplier = getStructureLevelMultiplier(structure, sawmillConfig);
  const output = {};
  for (const [resource, amount] of Object.entries(sawmillConfig.outputPerTick)) {
    output[resource] = Number(amount || 0) * multiplier;
  }
  return output;
}

// Resolve brewery outputs per tick from config.
function getBreweryOutput(state, config, structure) {
  const breweryConfig = config.structures && config.structures.brewery;
  if (!breweryConfig || !breweryConfig.outputPerTick) {
    return null;
  }
  const multiplier = getStructureLevelMultiplier(structure, breweryConfig);
  const output = {};
  for (const [resource, amount] of Object.entries(breweryConfig.outputPerTick)) {
    output[resource] = Number(amount || 0) * multiplier;
  }
  return output;
}

// Resolve brewery food costs per tick from config.
function getBreweryFoodCost(state, config, structure) {
  const breweryConfig = config.structures && config.structures.brewery;
  if (!breweryConfig) {
    return 0;
  }
  const base = Number(breweryConfig.foodCostPerTick ?? 0);
  if (base <= 0) {
    return 0;
  }
  const multiplier = getStructureCostMultiplier(structure, breweryConfig);
  return Math.max(0, base * multiplier);
}

// Compute level-based input cost multiplier for a structure.
function getStructureCostMultiplier(structure, structConfig) {
  if (!structure || !structConfig) {
    return 1;
  }
  const level = Math.max(1, Number(structure.level || 1));
  const maxLevel = Math.max(1, Number(structConfig.levelMax || 1));
  const minReduction = clamp(Number(structConfig.foodCostReductionMin ?? 0), 0, 1);
  const maxReduction = clamp(
    Number(structConfig.foodCostReductionMax ?? minReduction),
    0,
    1,
  );
  if (maxLevel <= 1) {
    return Math.max(0, 1 - minReduction);
  }
  const exponent = Math.max(0.1, Number(structConfig.foodCostReductionExponent || 1));
  const progress = clamp((level - 1) / (maxLevel - 1), 0, 1);
  const reduction = minReduction + (maxReduction - minReduction) * Math.pow(progress, exponent);
  return Math.max(0, 1 - reduction);
}

// Compute level-based output multiplier for a structure.
function getStructureLevelMultiplier(structure, structConfig) {
  if (!structure || !structConfig) {
    return 1;
  }
  const level = Math.max(1, Number(structure.level || 1));
  const maxLevel = Math.max(1, Number(structConfig.levelMax || 1));
  const minBonus = Math.max(0, Number(structConfig.levelBonusMin || 0));
  const maxBonus = Math.max(minBonus, Number(structConfig.levelBonusMax || minBonus));
  if (maxLevel <= 1) {
    return 1 + minBonus;
  }
  const exponent = Math.max(0.1, Number(structConfig.levelBonusExponent || 1));
  const progress = clamp((level - 1) / (maxLevel - 1), 0, 1);
  const bonus = minBonus + (maxBonus - minBonus) * Math.pow(progress, exponent);
  return 1 + bonus;
}

module.exports = { processDwarfAction };
