'use strict';

const { clamp } = require('./utils');

function stepState(state, config, runtime, action) {
  state.tick += 1;
  updateSeason(state, config);

  for (const dwarf of state.dwarves) {
    advanceAge(dwarf, config);
    applyNeedDecay(dwarf, config.needs.decayPerTick || {}, getSeasonModifier(state, 'needDecay', 1));
    consumeResources(dwarf, state.stockpile, config.consumption || {});
    updateDerivedState(dwarf);
  }

  handleDeaths(state, config);
  updateRelationships(state, config);
  handleReproduction(state, config);

  assignJobs(state, config, action);

  for (const dwarf of state.dwarves) {
    processDwarfAction(dwarf, state, config, runtime);
  }

  regenerateNodes(state, config);
}

function pushEvent(state, config, message) {
  const eventsConfig = (config && config.events) || {};
  const maxEvents = Number(eventsConfig.maxEntries ?? 5);
  if (!message) {
    return;
  }
  state.events = Array.isArray(state.events) ? state.events : [];
  state.events.unshift(message);
  if (state.events.length > maxEvents) {
    state.events = state.events.slice(0, maxEvents);
  }
}

function advanceAge(dwarf, config) {
  const aging = (config.population && config.population.aging) || {};
  const adultAge = Number(aging.adultAge || 0);
  const oldAgeStart = Number(aging.oldAgeStart || Infinity);

  dwarf.ageTicks = Number(dwarf.ageTicks || 0) + 1;
  if (dwarf.ageTicks < adultAge) {
    dwarf.lifeStage = 'child';
  } else if (dwarf.ageTicks >= oldAgeStart) {
    dwarf.lifeStage = 'elder';
  } else {
    dwarf.lifeStage = 'adult';
  }

  if (Number(dwarf.fertilityCooldown || 0) > 0) {
    dwarf.fertilityCooldown = Math.max(0, Number(dwarf.fertilityCooldown || 0) - 1);
  }
}

function updateSeason(state, config) {
  const seasons = config.seasons || {};
  const enabled = seasons.enabled !== false;
  if (!enabled) {
    state.season = null;
    return;
  }

  const order = Array.isArray(seasons.order) && seasons.order.length > 0
    ? seasons.order
    : ['spring', 'summer', 'autumn', 'winter'];
  const duration = Math.max(1, Number(seasons.durationTicks || 200));
  const seasonIndex = Math.floor((state.tick - 1) / duration) % order.length;
  const name = order[seasonIndex];
  const tickInSeason = ((state.tick - 1) % duration) + 1;
  const modifiers = (seasons.modifiers && seasons.modifiers[name]) || {};

  state.season = {
    name,
    index: seasonIndex,
    tickInSeason,
    duration,
    modifiers,
  };
}

function getSeasonModifier(state, key, fallback) {
  const safeFallback = Number(fallback || 1);
  if (!state || !state.season || !state.season.modifiers) {
    return safeFallback;
  }
  const value = state.season.modifiers[key];
  return Number.isFinite(value) ? Number(value) : safeFallback;
}

function applyNeedDecay(dwarf, decay, multiplier) {
  const scale = Number(multiplier || 1);
  // Need values are 0..1 where 0 is satisfied and 1 is critical.
  for (const [need, delta] of Object.entries(decay)) {
    const current = Number(dwarf.needs[need] || 0);
    dwarf.needs[need] = clamp(current + Number(delta || 0) * scale, 0, 1);
  }
}

function handleDeaths(state, config) {
  const death = (config.population && config.population.death) || {};
  const aging = (config.population && config.population.aging) || {};
  const starvationThreshold = Number(death.starvationThreshold ?? 0.9);
  const starvationTicks = Math.max(1, Number(death.starvationTicks ?? 50));
  const oldAgeStart = Number(aging.oldAgeStart ?? Infinity);
  const maxAge = Number(aging.maxAge ?? Infinity);
  const chanceMin = Number(death.oldAgeChanceMin ?? 0.0002);
  const chanceMax = Number(death.oldAgeChanceMax ?? 0.005);

  const deadIds = new Set();
  const deathMessages = [];

  for (const dwarf of state.dwarves) {
    const hunger = Number(dwarf.needs.hunger || 0);
    const thirst = Number(dwarf.needs.thirst || 0);

    if (hunger >= starvationThreshold || thirst >= starvationThreshold) {
      dwarf.starvationTicks = Number(dwarf.starvationTicks || 0) + 1;
    } else {
      dwarf.starvationTicks = 0;
    }

    if (dwarf.starvationTicks >= starvationTicks) {
      deadIds.add(dwarf.id);
      deathMessages.push(`Death: ${dwarf.id} (starvation)`);
      continue;
    }

    const ageTicks = Number(dwarf.ageTicks || 0);
    if (Number.isFinite(maxAge) && ageTicks >= maxAge) {
      deadIds.add(dwarf.id);
      deathMessages.push(`Death: ${dwarf.id} (old age)`);
      continue;
    }

    if (Number.isFinite(oldAgeStart) && ageTicks >= oldAgeStart && Number.isFinite(maxAge)) {
      const span = Math.max(1, maxAge - oldAgeStart);
      const progress = clamp((ageTicks - oldAgeStart) / span, 0, 1);
      const chance = clamp(chanceMin + progress * (chanceMax - chanceMin), 0, 1);
      if (Math.random() < chance) {
        deadIds.add(dwarf.id);
        deathMessages.push(`Death: ${dwarf.id} (old age)`);
      }
    }
  }

  if (deadIds.size === 0) {
    return;
  }

  state.deathsCount = Number(state.deathsCount || 0) + deadIds.size;
  state.dwarves = state.dwarves.filter((dwarf) => !deadIds.has(dwarf.id));
  state.jobs = state.jobs.filter((job) => !deadIds.has(job.dwarfId));

  for (const dwarf of state.dwarves) {
    if (dwarf.partnerId && deadIds.has(dwarf.partnerId)) {
      dwarf.partnerId = null;
      dwarf.bondTargetId = null;
      dwarf.bondScore = 0;
    }
    if (dwarf.pregnancy && deadIds.has(dwarf.pregnancy.partnerId)) {
      dwarf.pregnancy = null;
    }
  }

  for (const message of deathMessages) {
    pushEvent(state, config, message);
  }
}

function updateRelationships(state, config) {
  const relationships = (config.population && config.population.relationships) || {};
  const baseInteractions = Math.max(0, Number(relationships.interactionsPerTick ?? 2));
  const idleMultiplier = Number(relationships.idleInteractionMultiplier ?? 1);
  const maxDistance = Math.max(0, Number(relationships.maxDistance ?? 6));
  const bondGain = Number(relationships.bondGain ?? 1);
  const bondDecay = Number(relationships.bondDecay ?? 0.2);
  const bondThreshold = Number(relationships.bondThreshold ?? 20);

  const adults = state.dwarves.filter((dwarf) => isAdult(dwarf, config));
  if (adults.length < 2 || baseInteractions === 0) {
    return;
  }

  const idleAdults = adults.filter((dwarf) => !dwarf.job).length;
  const idleFraction = adults.length > 0 ? idleAdults / adults.length : 0;
  const bonusInteractions = Math.round(baseInteractions * idleFraction * idleMultiplier);
  const interactions = baseInteractions + bonusInteractions;

  for (let i = 0; i < interactions; i += 1) {
    const a = adults[Math.floor(Math.random() * adults.length)];
    let b = adults[Math.floor(Math.random() * adults.length)];
    if (a === b) {
      continue;
    }

    if (a.partnerId || b.partnerId) {
      continue;
    }

    if (distance(a, b) > maxDistance) {
      continue;
    }

    progressBond(a, b, bondGain, bondDecay, bondThreshold);
    progressBond(b, a, bondGain, bondDecay, bondThreshold);

    if (a.bondTargetId === b.id && b.bondTargetId === a.id) {
      if (a.bondScore >= bondThreshold && b.bondScore >= bondThreshold) {
        a.partnerId = b.id;
        b.partnerId = a.id;
      }
    }
  }
}

function progressBond(dwarf, partner, bondGain, bondDecay, bondThreshold) {
  if (dwarf.partnerId) {
    return;
  }

  if (dwarf.bondTargetId && dwarf.bondTargetId !== partner.id) {
    dwarf.bondScore = Math.max(0, Number(dwarf.bondScore || 0) - bondDecay);
    if (dwarf.bondScore <= 0) {
      dwarf.bondTargetId = null;
    }
    return;
  }

  if (!dwarf.bondTargetId) {
    dwarf.bondTargetId = partner.id;
    dwarf.bondScore = 0;
  }

  dwarf.bondScore = Math.min(bondThreshold, Number(dwarf.bondScore || 0) + bondGain);
}

function handleReproduction(state, config) {
  const reproduction = (config.population && config.population.reproduction) || {};
  if (reproduction.enabled === false) {
    return;
  }

  processBirths(state, config, reproduction);
  attemptConceptions(state, config, reproduction);
}

function processBirths(state, config, reproduction) {
  const cooldownTicks = Math.max(0, Number(reproduction.cooldownTicks ?? 150));

  for (const dwarf of state.dwarves) {
    if (!dwarf.pregnancy) {
      continue;
    }
    if (state.tick < Number(dwarf.pregnancy.dueTick || 0)) {
      continue;
    }

    const partner = state.dwarves.find((candidate) => candidate.id === dwarf.pregnancy.partnerId) || null;
    spawnNewborn(state, config, dwarf, partner);
    dwarf.pregnancy = null;
    dwarf.fertilityCooldown = cooldownTicks;
    if (partner) {
      partner.fertilityCooldown = cooldownTicks;
    }
  }
}

function attemptConceptions(state, config, reproduction) {
  const baseChance = Number(reproduction.baseChance ?? 0.001);
  if (baseChance <= 0) {
    return;
  }

  const couples = collectCouples(state);
  if (couples.length === 0) {
    return;
  }

  const resourceFactor = getResourceFactor(state, reproduction);
  const crowdingFactor = getCrowdingFactor(state, reproduction);
  const moraleFactor = getMoraleFactor(state, reproduction);
  const seasonFactor = getSeasonModifier(state, 'reproductionChance', 1);
  const chance = clamp(baseChance * resourceFactor * crowdingFactor * moraleFactor * seasonFactor, 0, 1);

  if (chance <= 0) {
    return;
  }

  for (const [a, b] of couples) {
    if (!isFertileAdult(a, config) || !isFertileAdult(b, config)) {
      continue;
    }
    if (a.pregnancy || b.pregnancy) {
      continue;
    }
    if (Number(a.fertilityCooldown || 0) > 0 || Number(b.fertilityCooldown || 0) > 0) {
      continue;
    }

    const birthCost = reproduction.birthCost || {};
    if (!hasInputs(state.stockpile, birthCost)) {
      continue;
    }

    if (Math.random() >= chance) {
      continue;
    }

    consumeInputs(state.stockpile, birthCost);
    const carrier = Math.random() < 0.5 ? a : b;
    const dueTick = state.tick + Math.max(1, Number(reproduction.gestationTicks ?? 80));
    carrier.pregnancy = { dueTick, partnerId: carrier === a ? b.id : a.id };
  }
}

function collectCouples(state) {
  const couples = [];
  const visited = new Set();

  for (const dwarf of state.dwarves) {
    if (!dwarf.partnerId || visited.has(dwarf.id) || visited.has(dwarf.partnerId)) {
      continue;
    }
    const partner = state.dwarves.find((candidate) => candidate.id === dwarf.partnerId);
    if (!partner) {
      continue;
    }
    visited.add(dwarf.id);
    visited.add(partner.id);
    couples.push([dwarf, partner]);
  }

  return couples;
}

function getResourceFactor(state, reproduction) {
  const perCapita = reproduction.resourcePerCapita || {};
  const population = Math.max(1, state.dwarves.length);
  let ratio = 1;

  for (const [resource, amount] of Object.entries(perCapita)) {
    const need = Number(amount || 0);
    if (need <= 0) {
      continue;
    }
    const available = Number(state.stockpile[resource] || 0);
    ratio = Math.min(ratio, available / (need * population));
  }

  return clamp(ratio, 0, 1);
}

function getCrowdingFactor(state, reproduction) {
  const softCap = Number(reproduction.softCap ?? 0);
  if (softCap <= 0) {
    return 1;
  }
  const minFactor = clamp(Number(reproduction.crowdingMinFactor ?? 0.2), 0, 1);
  const ratio = 1 - state.dwarves.length / softCap;
  return clamp(ratio, minFactor, 1);
}

function getMoraleFactor(state, reproduction) {
  const influence = clamp(Number(reproduction.moraleInfluence ?? 0.5), 0, 1);
  if (state.dwarves.length === 0) {
    return 1;
  }
  const avgMorale = averageValue(state.dwarves, (dwarf) => dwarf.state.morale);
  return clamp((1 - influence) + avgMorale * influence, 0, 1);
}

function isAdult(dwarf, config) {
  const aging = (config.population && config.population.aging) || {};
  const adultAge = Number(aging.adultAge ?? 0);
  const age = Number(dwarf.ageTicks || 0);
  return age >= adultAge;
}

function isFertileAdult(dwarf, config) {
  const aging = (config.population && config.population.aging) || {};
  const adultAge = Number(aging.adultAge ?? 0);
  const fertileStart = Number(aging.fertileStart ?? adultAge);
  const fertileEnd = Number(aging.fertileEnd ?? Infinity);
  const age = Number(dwarf.ageTicks || 0);

  if (age < adultAge) {
    return false;
  }
  if (age < fertileStart || age > fertileEnd) {
    return false;
  }
  return true;
}

function spawnNewborn(state, config, parentA, parentB) {
  const needsTemplate = config.needs.initial || {};
  const aging = (config.population && config.population.aging) || {};
  const newborn = {
    id: `dwarf_${++state.dwarfCounter}`,
    x: parentA ? parentA.x : 0,
    y: parentA ? parentA.y : 0,
    ageTicks: 0,
    lifeStage: 'child',
    needs: { ...needsTemplate },
    state: {
      health: 1,
      morale: 1,
      stress: 0,
      fatigue: 0,
    },
    job: null,
    partnerId: null,
    bondTargetId: null,
    bondScore: 0,
    fertilityCooldown: 0,
    pregnancy: null,
    starvationTicks: 0,
  };

  if (parentA && parentB) {
    if (Math.random() < 0.5) {
      newborn.x = parentB.x;
      newborn.y = parentB.y;
    }
  }

  newborn.lifeStage = newborn.ageTicks < Number(aging.adultAge || 0) ? 'child' : 'adult';
  state.dwarves.push(newborn);
  state.birthsCount = Number(state.birthsCount || 0) + 1;
  pushEvent(state, config, `Birth: ${newborn.id}`);
}

function averageValue(dwarves, selector) {
  if (dwarves.length === 0) {
    return 0;
  }

  const total = dwarves.reduce((sum, dwarf) => sum + Number(selector(dwarf) || 0), 0);
  return total / dwarves.length;
}

function regenerateNodes(state, config) {
  const resourceConfig = config.resources || {};
  const regenConfig = resourceConfig.nodeRegen || {};
  if (regenConfig.enabled === false) {
    return;
  }

  const interval = Math.max(1, Number(regenConfig.intervalTicks || 30));
  if (state.tick % interval !== 0) {
    return;
  }

  const amount = Number(regenConfig.amount || 1);
  if (amount <= 0) {
    return;
  }

  const multiplier = getSeasonModifier(state, 'nodeRegen', 1);
  const delta = Math.floor(amount * multiplier);
  if (delta <= 0) {
    return;
  }

  const onlyDepleted = regenConfig.onlyDepleted === true;

  for (const node of state.nodes) {
    const capacity = Math.max(0, Number(node.capacity || 0));
    const remaining = Math.max(0, Number(node.remaining || 0));
    if (capacity <= 0 || remaining >= capacity) {
      continue;
    }
    if (onlyDepleted && remaining > 0) {
      continue;
    }
    node.remaining = Math.min(capacity, remaining + delta);
  }
}

function consumeResources(dwarf, stockpile, consumption) {
  if (!stockpile) {
    return;
  }

  const hungerThreshold = Number(consumption.hungerThreshold ?? 0.6);
  const thirstThreshold = Number(consumption.thirstThreshold ?? 0.6);
  const hungerTarget = Number(consumption.hungerTarget ?? hungerThreshold);
  const thirstTarget = Number(consumption.thirstTarget ?? thirstThreshold);
  const maxUnitsPerTick = Math.max(1, Number(consumption.maxUnitsPerTick ?? 1));
  const mealRelief = Number(consumption.mealRelief ?? 0.5);
  const rawFoodRelief = Number(consumption.rawFoodRelief ?? 0.35);
  const boozeRelief = Number(consumption.boozeRelief ?? 0.5);
  const waterRelief = Number(consumption.waterRelief ?? 0.35);

  let hunger = Number(dwarf.needs.hunger || 0);
  if (hunger >= hungerThreshold) {
    let units = 0;
    while (units < maxUnitsPerTick && hunger > hungerTarget) {
      if (Number(stockpile.meal || 0) > 0) {
        stockpile.meal -= 1;
        hunger = clamp(hunger - mealRelief, 0, 1);
        dwarf.needs.hunger = hunger;
      } else if (Number(stockpile.food_raw || 0) > 0) {
        stockpile.food_raw -= 1;
        hunger = clamp(hunger - rawFoodRelief, 0, 1);
        dwarf.needs.hunger = hunger;
      } else {
        break;
      }
      units += 1;
    }
  }

  let thirst = Number(dwarf.needs.thirst || 0);
  if (thirst >= thirstThreshold) {
    let units = 0;
    while (units < maxUnitsPerTick && thirst > thirstTarget) {
      if (Number(stockpile.booze || 0) > 0) {
        stockpile.booze -= 1;
        thirst = clamp(thirst - boozeRelief, 0, 1);
        dwarf.needs.thirst = thirst;
      } else if (Number(stockpile.water || 0) > 0) {
        stockpile.water -= 1;
        thirst = clamp(thirst - waterRelief, 0, 1);
        dwarf.needs.thirst = thirst;
      } else {
        break;
      }
      units += 1;
    }
  }
}

function updateDerivedState(dwarf) {
  const values = Object.values(dwarf.needs);
  const avgNeed = values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;

  dwarf.state.morale = clamp(1 - avgNeed, 0, 1);
  dwarf.state.stress = clamp(avgNeed, 0, 1);
  dwarf.state.fatigue = clamp(avgNeed, 0, 1);
}

function assignJobs(state, config, action) {
  const idleDwarves = state.dwarves.filter((dwarf) => !dwarf.job && canWork(dwarf, config));
  const resourceConfig = config.resources || {};
  const targets = resourceConfig.targets || resourceConfig.stockpile || {};
  const weights = getActionWeights(action, config);
  const shortages = computeShortages(state.stockpile, targets, weights);
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

function canWork(dwarf, config) {
  return isAdult(dwarf, config);
}

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

function computeShortages(stockpile, targets, weights) {
  const shortages = [];

  for (const [resource, targetValue] of Object.entries(targets)) {
    const target = Number(targetValue || 0);
    if (target <= 0) {
      continue;
    }

    const current = Number(stockpile[resource] || 0);
    const missing = target - current;

    if (missing > 0) {
      const ratio = missing / target;
      const weightRaw = weights && weights[resource] !== undefined ? weights[resource] : 1;
      const weight = clamp(Number(weightRaw || 1), 0, Number.POSITIVE_INFINITY);
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
  const workTicks = getRecipeTicks(recipe, state);

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

function getRecipeTicks(recipe, state) {
  const ticks = recipe.ticks !== undefined ? recipe.ticks : recipe.time;
  const base = Math.max(1, Number(ticks || 6));
  const multiplier = getSeasonModifier(state, 'craftTicks', 1);
  return Math.max(1, Math.round(base * multiplier));
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
  const workTicks = getGatherTicks(config, resourceId, state);

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

function getGatherTicks(config, resourceId, state) {
  const jobs = config.jobs || {};
  const specific = jobs.gatherTicks && jobs.gatherTicks[resourceId];
  const value = specific !== undefined ? specific : jobs.defaultGatherTicks;
  const base = Math.max(1, Number(value || 6));
  const multiplier = getSeasonModifier(state, 'gatherTicks', 1);
  return Math.max(1, Math.round(base * multiplier));
}

function getGatherYield(config, resourceId, node, state) {
  const jobs = config.jobs || {};
  const specific = jobs.gatherYield && jobs.gatherYield[resourceId];
  const value = specific !== undefined ? specific : jobs.defaultGatherYield;
  const baseYield = Math.max(1, Number(value || 1));
  const multiplier = getSeasonModifier(state, 'gatherYield', 1);
  const scaledYield = Math.max(1, Math.round(baseYield * multiplier));
  if (!node) {
    return scaledYield;
  }
  const remaining = Math.max(0, Number(node.remaining || 0));
  return Math.min(scaledYield, remaining);
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
