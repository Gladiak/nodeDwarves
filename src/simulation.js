'use strict';

const { clamp } = require('./utils');

function stepState(state, config, runtime, action) {
  state.tick += 1;
  updateSeason(state, config);
  const housingPenalty = getWinterHousingPenalty(state, config);

  for (const dwarf of state.dwarves) {
    advanceAge(dwarf, config);
    applyNeedDecay(
      dwarf,
      config.needs.decayPerTick || {},
      getSeasonModifier(state, 'needDecay', 1) * housingPenalty.needDecay,
    );
    consumeResources(dwarf, state.stockpile, config.consumption || {});
    updateDerivedState(dwarf);
  }

  handleDeaths(state, config);
  assignHousing(state, config);
  updateRelationships(state, config);
  handleReproduction(state, config);

  assignJobs(state, config, runtime, action);

  for (const dwarf of state.dwarves) {
    processDwarfAction(dwarf, state, config, runtime);
  }

  updateMerchant(state, config, runtime);
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

function getHousingStats(state, config) {
  const housingConfig = (config.population && config.population.housing) || {};
  const enabled = housingConfig.enabled !== false;
  if (!enabled) {
    return {
      enabled: false,
      houses: 0,
      beds: 0,
      ratio: 1,
      unshelteredFraction: 0,
    };
  }

  const structures = state.structures || [];
  const houses = structures.filter((structure) => structure.type === 'house');
  const houseCount = houses.length;
  const beds = houses.reduce((sum, house) => {
    return sum + Math.max(0, Number(house.capacity || 0));
  }, 0);
  const population = Math.max(1, state.dwarves.length);
  const ratio = beds > 0 ? beds / population : 0;
  const unshelteredFraction = clamp(1 - ratio, 0, 1);

  return {
    enabled: true,
    houses: houseCount,
    beds,
    ratio,
    unshelteredFraction,
  };
}

function getBondingHousingMultiplier(state, config) {
  const housing = getHousingStats(state, config);
  if (!housing.enabled) {
    return 1;
  }
  const housingConfig = (config.population && config.population.housing) || {};
  const minMultiplier = Number(housingConfig.bondingMinMultiplier ?? 1);
  const maxMultiplier = Number(housingConfig.bondingMaxMultiplier ?? 1);
  const low = Math.min(minMultiplier, maxMultiplier);
  const high = Math.max(minMultiplier, maxMultiplier);
  const ratio = clamp(housing.ratio, 0, 1);
  return low + (high - low) * ratio;
}

function getWinterHousingPenalty(state, config) {
  const housing = getHousingStats(state, config);
  const winter = state.season && state.season.name === 'winter';
  if (!housing.enabled || !winter) {
    return { needDecay: 1, oldAge: 1 };
  }
  const housingConfig = (config.population && config.population.housing) || {};
  const needPenalty = Math.max(0, Number(housingConfig.winterNeedPenalty ?? 0));
  const oldAgePenalty = Math.max(0, Number(housingConfig.winterOldAgePenalty ?? 0));
  const exposure = housing.unshelteredFraction;

  return {
    needDecay: 1 + needPenalty * exposure,
    oldAge: 1 + oldAgePenalty * exposure,
  };
}

function assignHousing(state, config) {
  const housingConfig = (config.population && config.population.housing) || {};
  if (housingConfig.enabled === false) {
    return;
  }

  const houses = (state.structures || []).filter((structure) => structure.type === 'house');
  for (const dwarf of state.dwarves) {
    dwarf.homeId = null;
  }

  if (houses.length === 0) {
    return;
  }

  const houseSlots = houses
    .map((house) => ({
      house,
      remaining: Math.max(0, Number(house.capacity || 0)),
    }))
    .filter((entry) => entry.remaining > 0);

  if (houseSlots.length === 0) {
    return;
  }

  const assigned = new Set();

  for (const dwarf of state.dwarves) {
    if (!dwarf.partnerId || assigned.has(dwarf.id)) {
      continue;
    }
    const partner = state.dwarves.find((candidate) => candidate.id === dwarf.partnerId);
    if (!partner || assigned.has(partner.id)) {
      continue;
    }
    const slot = houseSlots.find((entry) => entry.remaining >= 2);
    if (!slot) {
      continue;
    }
    dwarf.homeId = slot.house.id;
    partner.homeId = slot.house.id;
    slot.remaining -= 2;
    assigned.add(dwarf.id);
    assigned.add(partner.id);
  }

  const unassigned = state.dwarves
    .filter((dwarf) => !dwarf.homeId)
    .sort((a, b) => Number(isAdult(b, config)) - Number(isAdult(a, config)));

  for (const dwarf of unassigned) {
    const slot = houseSlots.find((entry) => entry.remaining >= 1);
    if (!slot) {
      break;
    }
    dwarf.homeId = slot.house.id;
    slot.remaining -= 1;
  }
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
  const housingPenalty = getWinterHousingPenalty(state, config);

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
      state.deathsByCause.starvation = Number(state.deathsByCause.starvation || 0) + 1;
      deathMessages.push(`Death: ${dwarf.id} (starvation)`);
      continue;
    }

    const ageTicks = Number(dwarf.ageTicks || 0);
    if (Number.isFinite(maxAge) && ageTicks >= maxAge) {
      deadIds.add(dwarf.id);
      state.deathsByCause.oldAge = Number(state.deathsByCause.oldAge || 0) + 1;
      deathMessages.push(`Death: ${dwarf.id} (old age)`);
      continue;
    }

    if (Number.isFinite(oldAgeStart) && ageTicks >= oldAgeStart && Number.isFinite(maxAge)) {
      const span = Math.max(1, maxAge - oldAgeStart);
      const progress = clamp((ageTicks - oldAgeStart) / span, 0, 1);
      const chanceBase = clamp(chanceMin + progress * (chanceMax - chanceMin), 0, 1);
      const chance = clamp(chanceBase * housingPenalty.oldAge, 0, 1);
      if (Math.random() < chance) {
        deadIds.add(dwarf.id);
        state.deathsByCause.oldAge = Number(state.deathsByCause.oldAge || 0) + 1;
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
  const bondingMultiplier = getBondingHousingMultiplier(state, config);
  const housing = getHousingStats(state, config);

  const adults = state.dwarves.filter((dwarf) => isAdult(dwarf, config));
  if (adults.length < 2 || baseInteractions === 0) {
    return;
  }

  const idleAdults = adults.filter((dwarf) => !dwarf.job).length;
  const idleFraction = adults.length > 0 ? idleAdults / adults.length : 0;
  const bonusInteractions = Math.round(baseInteractions * idleFraction * idleMultiplier);
  const interactions = Math.max(0, Math.round((baseInteractions + bonusInteractions) * bondingMultiplier));
  const adjustedBondGain = bondGain * bondingMultiplier;

  if (housing.enabled) {
    if (housing.houses === 0) {
      return;
    }

    const byHouse = new Map();
    for (const dwarf of adults) {
      if (!dwarf.homeId) {
        continue;
      }
      if (!byHouse.has(dwarf.homeId)) {
        byHouse.set(dwarf.homeId, []);
      }
      byHouse.get(dwarf.homeId).push(dwarf);
    }

    const eligibleHouses = Array.from(byHouse.values()).filter((group) => group.length >= 2);
    if (eligibleHouses.length === 0) {
      return;
    }

    for (let i = 0; i < interactions; i += 1) {
      const group = eligibleHouses[Math.floor(Math.random() * eligibleHouses.length)];
      const a = group[Math.floor(Math.random() * group.length)];
      let b = group[Math.floor(Math.random() * group.length)];
      if (a === b) {
        continue;
      }
      if (a.partnerId || b.partnerId) {
        continue;
      }

      progressBond(a, b, adjustedBondGain, bondDecay, bondThreshold);
      progressBond(b, a, adjustedBondGain, bondDecay, bondThreshold);

      if (a.bondTargetId === b.id && b.bondTargetId === a.id) {
        if (a.bondScore >= bondThreshold && b.bondScore >= bondThreshold) {
          a.partnerId = b.id;
          b.partnerId = a.id;
        }
      }
    }
    return;
  }

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

    progressBond(a, b, adjustedBondGain, bondDecay, bondThreshold);
    progressBond(b, a, adjustedBondGain, bondDecay, bondThreshold);

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
  const stats = state.reproductionStats || {};
  const housingConfig = (config.population && config.population.housing) || {};
  const housingEnabled = housingConfig.enabled !== false;
  if (baseChance <= 0) {
    return;
  }

  const couples = collectCouples(state);
  stats.ticks = Number(stats.ticks || 0) + 1;
  stats.couples = Number(stats.couples || 0) + couples.length;
  stats.fertileAdults = Number(stats.fertileAdults || 0) + countFertileAdults(state, config);
  stats.pregnancies = Number(stats.pregnancies || 0) + countPregnancies(state.dwarves);
  stats.cooldowns = Number(stats.cooldowns || 0) + countCooldowns(state.dwarves);
  if (couples.length === 0) {
    return;
  }

  const resourceFactor = getResourceFactor(state, reproduction);
  const crowdingFactor = getCrowdingFactor(state, reproduction);
  const moraleFactor = getMoraleFactor(state, reproduction);
  const seasonFactor = getSeasonModifier(state, 'reproductionChance', 1);
  const chance = clamp(baseChance * resourceFactor * crowdingFactor * moraleFactor * seasonFactor, 0, 1);
  stats.resourceFactorSum = Number(stats.resourceFactorSum || 0) + resourceFactor;
  stats.crowdingFactorSum = Number(stats.crowdingFactorSum || 0) + crowdingFactor;
  stats.moraleFactorSum = Number(stats.moraleFactorSum || 0) + moraleFactor;
  stats.seasonFactorSum = Number(stats.seasonFactorSum || 0) + seasonFactor;
  stats.chanceSum = Number(stats.chanceSum || 0) + chance;

  if (chance <= 0) {
    return;
  }

  for (const [a, b] of couples) {
    if (!isFertileAdult(a, config) || !isFertileAdult(b, config)) {
      stats.blockedInfertile = Number(stats.blockedInfertile || 0) + 1;
      continue;
    }
    if (a.pregnancy || b.pregnancy) {
      stats.blockedPregnant = Number(stats.blockedPregnant || 0) + 1;
      continue;
    }
    if (Number(a.fertilityCooldown || 0) > 0 || Number(b.fertilityCooldown || 0) > 0) {
      stats.blockedCooldown = Number(stats.blockedCooldown || 0) + 1;
      continue;
    }
    if (housingEnabled) {
      if (!a.homeId || a.homeId !== b.homeId) {
        stats.blockedNoHousing = Number(stats.blockedNoHousing || 0) + 1;
        continue;
      }
    }

    const birthCost = reproduction.birthCost || {};
    if (!hasInputs(state.stockpile, birthCost)) {
      stats.blockedNoResources = Number(stats.blockedNoResources || 0) + 1;
      continue;
    }

    stats.attempts = Number(stats.attempts || 0) + 1;
    if (Math.random() >= chance) {
      stats.blockedChance = Number(stats.blockedChance || 0) + 1;
      continue;
    }

    stats.successes = Number(stats.successes || 0) + 1;
    consumeInputs(state.stockpile, birthCost);
    const carrier = Math.random() < 0.5 ? a : b;
    const dueTick = state.tick + Math.max(1, Number(reproduction.gestationTicks ?? 80));
    carrier.pregnancy = { dueTick, partnerId: carrier === a ? b.id : a.id };
  }
}

function countFertileAdults(state, config) {
  let count = 0;
  for (const dwarf of state.dwarves) {
    if (isFertileAdult(dwarf, config)) {
      count += 1;
    }
  }
  return count;
}

function countPregnancies(dwarves) {
  let count = 0;
  for (const dwarf of dwarves) {
    if (dwarf.pregnancy) {
      count += 1;
    }
  }
  return count;
}

function countCooldowns(dwarves) {
  let count = 0;
  for (const dwarf of dwarves) {
    if (Number(dwarf.fertilityCooldown || 0) > 0) {
      count += 1;
    }
  }
  return count;
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
    homeId: (parentA && parentA.homeId) || (parentB && parentB.homeId) || null,
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
  const baseDelta = amount * multiplier;
  if (baseDelta <= 0) {
    return;
  }

  const onlyDepleted = regenConfig.onlyDepleted === true;

  const fieldSeason = getSeasonModifier(state, 'fieldRegen', 1);
  const fieldIrrigation = getFieldIrrigationMultiplier(state, config);

  for (const node of state.nodes) {
    const capacity = Math.max(0, Number(node.capacity || 0));
    const remaining = Math.max(0, Number(node.remaining || 0));
    if (capacity <= 0 || remaining >= capacity) {
      continue;
    }
    if (onlyDepleted && remaining > 0) {
      continue;
    }
    let nodeDelta = Math.floor(baseDelta);
    if (node.source === 'field') {
      nodeDelta = Math.round(baseDelta * fieldSeason * fieldIrrigation);
    }
    if (nodeDelta <= 0) {
      continue;
    }
    node.remaining = Math.min(capacity, remaining + nodeDelta);
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

function assignJobs(state, config, runtime, action) {
  const idleDwarves = state.dwarves.filter((dwarf) => !dwarf.job && canWork(dwarf, config));
  if (idleDwarves.length === 0) {
    return;
  }

  assignBuildJobIfNeeded(state, config, runtime, idleDwarves);
  if (idleDwarves.length === 0) {
    return;
  }

  const resourceConfig = config.resources || {};
  const targets = resourceConfig.targets || resourceConfig.stockpile || {};
  const weights = getActionWeights(action, config);
  const shortages = computeShortages(state.stockpile, targets, weights, config);
  const workshops = (state.structures || []).filter((structure) => structure.type === 'workshop');
  const workshopCapacity = getWorkshopCapacity(config, workshops);
  const workshopUsage = getWorkshopUsage(state.jobs);
  const nodeResources = new Set(
    state.nodes.filter((node) => Number(node.remaining || 0) > 0).map((node) => node.id),
  );

  state.lastPriorities = shortages;

  if (shortages.length === 0) {
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

function assignBuildJobIfNeeded(state, config, runtime, idleDwarves) {
  const housingConfig = (config.population && config.population.housing) || {};
  if (housingConfig.enabled === false) {
    return;
  }
  if (!runtime || runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return;
  }
  if (state.jobs.some((job) => job.type === 'build' || job.type === 'upgrade')) {
    return;
  }
  if (idleDwarves.length === 0) {
    return;
  }

  const buildJob = createWellBuildJob(state, config, runtime)
    || createFieldBuildJob(state, config, runtime)
    || createHouseBuildJob(state, config, runtime)
    || createHouseUpgradeJob(state, config, runtime);
  if (!buildJob) {
    return;
  }
  const dwarf = idleDwarves.shift();
  if (!dwarf) {
    return;
  }
  buildJob.dwarfId = dwarf.id;
  dwarf.job = buildJob;
  state.jobs.push(buildJob);
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
      const weightRaw = weights && weights[resource] !== undefined ? weights[resource] : 1;
      let weight = clamp(Number(weightRaw || 1), 0, Number.POSITIVE_INFINITY);
      const boostConfig = priorityBoosts && priorityBoosts[resource];
      if (boostConfig && typeof boostConfig === 'object') {
        const threshold = clamp(Number(boostConfig.threshold ?? 0), 0, 1);
        const multiplier = Math.max(0, Number(boostConfig.multiplier ?? 0));
        const minWeight = Math.max(0, Number(boostConfig.minWeight ?? 0));
        const exponent = Math.max(0.1, Number(boostConfig.exponent ?? 1));
        if (threshold > 0 && stockpileRatio < threshold && (multiplier > 0 || minWeight > 0)) {
          const severity = clamp((threshold - stockpileRatio) / threshold, 0, 1);
          const boost = 1 + (Math.pow(severity, exponent) * multiplier);
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

function createHouseBuildJob(state, config, runtime) {
  const housingConfig = (config.population && config.population.housing) || {};
  const houseConfig = (config.structures && config.structures.house) || {};
  const targetRatio = Number(housingConfig.buildTargetRatio ?? 1);
  if (targetRatio <= 0) {
    return null;
  }

  const housing = getHousingStats(state, config);
  if (housing.ratio >= targetRatio) {
    return null;
  }

  const minResources = housingConfig.buildMinResources;
  if (minResources && typeof minResources === 'object') {
    for (const [resource, minRatioRaw] of Object.entries(minResources)) {
      const minRatio = Number(minRatioRaw);
      if (!Number.isFinite(minRatio) || minRatio <= 0) {
        continue;
      }
      const ratio = getStockpileRatio(state, config, resource);
      if (ratio < minRatio) {
        return null;
      }
    }
  }

  const buildCost = houseConfig.buildCost || {};
  if (Object.keys(buildCost).length > 0 && !hasInputs(state.stockpile, buildCost)) {
    return null;
  }

  const target = findVillageBuildSpot(state, runtime);
  if (!target) {
    return null;
  }

  if (Object.keys(buildCost).length > 0) {
    consumeInputs(state.stockpile, buildCost);
  }

  const buildTicks = Math.max(1, Number(houseConfig.buildTicks || 30));
  return {
    id: `job_${state.jobCounter++}`,
    type: 'build',
    structureType: 'house',
    target,
    workRemaining: buildTicks,
    dwarfId: null,
  };
}

function createHouseUpgradeJob(state, config, runtime) {
  const houseConfig = (config.structures && config.structures.house) || {};
  const housingConfig = (config.population && config.population.housing) || {};
  const maxLevel = getHouseMaxLevel(houseConfig);
  if (maxLevel <= 1) {
    return null;
  }

  const houses = (state.structures || []).filter((structure) => structure.type === 'house');
  if (houses.length === 0) {
    return null;
  }

  const minHouses = Math.max(0, Number(houseConfig.upgradeMinHouses ?? 0));
  if (houses.length < minHouses) {
    return null;
  }

  const minHousingRatio = Number(
    houseConfig.upgradeMinHousingRatio ?? housingConfig.buildTargetRatio ?? 1,
  );
  if (minHousingRatio > 0) {
    const housing = getHousingStats(state, config);
    if (housing.ratio < minHousingRatio) {
      return null;
    }
  }

  const minResources = housingConfig.buildMinResources;
  if (minResources && typeof minResources === 'object') {
    for (const [resource, minRatioRaw] of Object.entries(minResources)) {
      const minRatio = Number(minRatioRaw);
      if (!Number.isFinite(minRatio) || minRatio <= 0) {
        continue;
      }
      const ratio = getStockpileRatio(state, config, resource);
      if (ratio < minRatio) {
        return null;
      }
    }
  }

  const minAdjacency = Math.max(0, Number(houseConfig.upgradeMinAdjacency ?? 0));
  const houseSet = buildHousePositionSet(houses);
  let best = null;

  for (const house of houses) {
    const level = Math.max(1, Number(house.level || 1));
    if (level >= maxLevel) {
      continue;
    }
    const adjacency = countAdjacentHouses(house, houseSet);
    if (adjacency < minAdjacency) {
      continue;
    }
    if (!best) {
      best = { house, level, adjacency };
      continue;
    }
    if (adjacency > best.adjacency) {
      best = { house, level, adjacency };
      continue;
    }
    if (adjacency === best.adjacency && level < best.level) {
      best = { house, level, adjacency };
      continue;
    }
    if (adjacency === best.adjacency && level === best.level) {
      if (String(house.id || '') < String(best.house.id || '')) {
        best = { house, level, adjacency };
      }
    }
  }

  if (!best) {
    return null;
  }

  const nextLevel = Math.min(maxLevel, best.level + 1);
  const levelConfig = getHouseLevelConfig(houseConfig, nextLevel);
  if (!levelConfig) {
    return null;
  }
  const upgradeCost = getHouseUpgradeCost(houseConfig, levelConfig);
  if (Object.keys(upgradeCost).length > 0 && !hasInputs(state.stockpile, upgradeCost)) {
    return null;
  }

  const upgradeTicks = getHouseUpgradeTicks(houseConfig, levelConfig);
  if (Object.keys(upgradeCost).length > 0) {
    consumeInputs(state.stockpile, upgradeCost);
  }

  return {
    id: `job_${state.jobCounter++}`,
    type: 'upgrade',
    structureId: best.house.id,
    targetLevel: nextLevel,
    target: { x: best.house.x, y: best.house.y },
    workRemaining: upgradeTicks,
    dwarfId: null,
  };
}

function getHouseLevelConfig(houseConfig, level) {
  const levels = (houseConfig && houseConfig.levels) || {};
  const entry = levels[String(level)];
  return entry && typeof entry === 'object' ? entry : null;
}

function getHouseMaxLevel(houseConfig) {
  const levels = (houseConfig && houseConfig.levels) || {};
  let maxLevel = 1;
  for (const key of Object.keys(levels)) {
    const value = Number(key);
    if (Number.isFinite(value) && value > maxLevel) {
      maxLevel = value;
    }
  }
  return maxLevel;
}

function getHouseCapacity(houseConfig, level, fallback) {
  const levelConfig = getHouseLevelConfig(houseConfig, level);
  const raw = levelConfig && levelConfig.capacity !== undefined
    ? levelConfig.capacity
    : (fallback !== undefined ? fallback : houseConfig.capacity);
  const capacity = Number(raw || 1);
  return Math.max(1, capacity);
}

function getHouseUpgradeCost(houseConfig, levelConfig) {
  if (levelConfig && levelConfig.upgradeCost) {
    return levelConfig.upgradeCost;
  }
  return houseConfig.buildCost || {};
}

function getHouseUpgradeTicks(houseConfig, levelConfig) {
  const raw = levelConfig && levelConfig.upgradeTicks !== undefined
    ? levelConfig.upgradeTicks
    : houseConfig.buildTicks;
  return Math.max(1, Number(raw || 1));
}

function buildHousePositionSet(houses) {
  const set = new Set();
  for (const house of houses) {
    set.add(`${house.x},${house.y}`);
  }
  return set;
}

function countAdjacentHouses(house, houseSet) {
  let count = 0;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      if (houseSet.has(`${house.x + dx},${house.y + dy}`)) {
        count += 1;
      }
    }
  }
  return count;
}

function createWellBuildJob(state, config, runtime) {
  const wellConfig = (config.structures && config.structures.well) || {};
  const maxCount = Number(wellConfig.maxCount ?? 0);
  const existingWells = (state.structures || []).filter((structure) => structure.type === 'well').length;
  if (maxCount > 0 && existingWells >= maxCount) {
    return null;
  }

  const nodeThreshold = Number(wellConfig.buildWhenNodeRatioBelow ?? 0.4);
  const stockThreshold = Number(wellConfig.buildWhenStockpileRatioBelow ?? 0.6);
  const nodeRatio = getResourceNodeRatio(state, 'water');
  const stockRatio = getStockpileRatio(state, config, 'water');
  if (nodeRatio >= nodeThreshold && stockRatio >= stockThreshold) {
    return null;
  }

  const buildCost = wellConfig.buildCost || {};
  if (Object.keys(buildCost).length > 0 && !hasInputs(state.stockpile, buildCost)) {
    return null;
  }

  const target = findVillageBuildSpot(state, runtime);
  if (!target) {
    return null;
  }

  if (Object.keys(buildCost).length > 0) {
    consumeInputs(state.stockpile, buildCost);
  }

  const buildTicks = Math.max(1, Number(wellConfig.buildTicks || 35));
  return {
    id: `job_${state.jobCounter++}`,
    type: 'build',
    structureType: 'well',
    target,
    workRemaining: buildTicks,
    dwarfId: null,
  };
}

function createFieldBuildJob(state, config, runtime) {
  const fieldConfig = (config.structures && config.structures.field) || {};
  const maxCount = Number(fieldConfig.maxCount ?? 0);
  const existingFields = (state.structures || []).filter((structure) => structure.type === 'field').length;
  if (maxCount > 0 && existingFields >= maxCount) {
    return null;
  }

  const nodeThreshold = Number(fieldConfig.buildWhenNodeRatioBelow ?? 0.4);
  const stockThreshold = Number(fieldConfig.buildWhenStockpileRatioBelow ?? 0.6);
  const nodeRatio = getResourceNodeRatio(state, 'food_raw');
  const stockRatio = getStockpileRatio(state, config, 'food_raw');
  if (nodeRatio >= nodeThreshold && stockRatio >= stockThreshold) {
    return null;
  }

  const minResources = fieldConfig.buildMinResources;
  if (minResources && typeof minResources === 'object') {
    for (const [resource, minRatioRaw] of Object.entries(minResources)) {
      const minRatio = Number(minRatioRaw);
      if (!Number.isFinite(minRatio) || minRatio <= 0) {
        continue;
      }
      const ratio = getStockpileRatio(state, config, resource);
      if (ratio < minRatio) {
        return null;
      }
    }
  }

  const buildCost = fieldConfig.buildCost || {};
  if (Object.keys(buildCost).length > 0 && !hasInputs(state.stockpile, buildCost)) {
    return null;
  }

  const target = findVillageBuildSpot(state, runtime);
  if (!target) {
    return null;
  }

  if (Object.keys(buildCost).length > 0) {
    consumeInputs(state.stockpile, buildCost);
  }

  const buildTicks = Math.max(1, Number(fieldConfig.buildTicks || 35));
  return {
    id: `job_${state.jobCounter++}`,
    type: 'build',
    structureType: 'field',
    target,
    workRemaining: buildTicks,
    dwarfId: null,
  };
}

function findVillageBuildSpot(state, runtime) {
  const center = getVillageCenter(state, runtime);
  const maxRadius = Math.max(runtime.gridWidth, runtime.gridHeight);

  for (let radius = 0; radius <= maxRadius; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const dy = radius - Math.abs(dx);
      const x1 = center.x + dx;
      const y1 = center.y + dy;
      if (isBuildableCell(state, runtime, x1, y1)) {
        return { x: x1, y: y1 };
      }
      if (dy !== 0) {
        const x2 = center.x + dx;
        const y2 = center.y - dy;
        if (isBuildableCell(state, runtime, x2, y2)) {
          return { x: x2, y: y2 };
        }
      }
    }
  }

  return null;
}

function getVillageCenter(state, runtime) {
  const houses = (state.structures || []).filter((structure) => structure.type === 'house');
  if (houses.length > 0) {
    const sum = houses.reduce((acc, house) => {
      acc.x += Number(house.x || 0);
      acc.y += Number(house.y || 0);
      return acc;
    }, { x: 0, y: 0 });
    return {
      x: Math.round(sum.x / houses.length),
      y: Math.round(sum.y / houses.length),
    };
  }

  const workshops = (state.structures || []).filter((structure) => structure.type === 'workshop');
  if (workshops.length > 0) {
    const workshop = workshops[0];
    return { x: Number(workshop.x || 0), y: Number(workshop.y || 0) };
  }

  return {
    x: Math.floor(runtime.gridWidth / 2),
    y: Math.floor(runtime.gridHeight / 2),
  };
}

function isBuildableCell(state, runtime, x, y) {
  if (x < 0 || y < 0 || x >= runtime.gridWidth || y >= runtime.gridHeight) {
    return false;
  }
  for (const node of state.nodes) {
    if (node.x === x && node.y === y) {
      return false;
    }
  }
  for (const structure of state.structures || []) {
    if (structure.x === x && structure.y === y) {
      return false;
    }
  }
  return true;
}

function getResourceNodeRatio(state, resourceId) {
  let totalCapacity = 0;
  let totalRemaining = 0;
  for (const node of state.nodes) {
    if (node.id !== resourceId) {
      continue;
    }
    const capacity = Math.max(0, Number(node.capacity || 0));
    const remaining = Math.max(0, Number(node.remaining || 0));
    totalCapacity += capacity;
    totalRemaining += remaining;
  }
  if (totalCapacity <= 0) {
    return 1;
  }
  return clamp(totalRemaining / totalCapacity, 0, 1);
}

function getStockpileRatio(state, config, resourceId) {
  const targets = (config.resources && config.resources.targets) || {};
  const target = Number(targets[resourceId] || 0);
  if (target <= 0) {
    return 1;
  }
  const current = Number(state.stockpile[resourceId] || 0);
  return clamp(current / target, 0, 1);
}

function getFieldIrrigationMultiplier(state, config) {
  const fieldConfig = (config.structures && config.structures.field) || {};
  const minMultiplier = Number(fieldConfig.irrigationMinMultiplier ?? 1);
  const maxMultiplier = Number(fieldConfig.irrigationMaxMultiplier ?? 1);
  const low = Math.min(minMultiplier, maxMultiplier);
  const high = Math.max(minMultiplier, maxMultiplier);
  const waterRatio = getStockpileRatio(state, config, 'water');
  const ratio = clamp(waterRatio, 0, 1);
  return low + (high - low) * ratio;
}

function createStructure(state, config, type, x, y) {
  const structureConfig = (config.structures && config.structures[type]) || {};
  const houseConfig = (config.structures && config.structures.house) || {};
  const symbols = config.symbols || {};
  const isHouse = type === 'house';
  const hasLevels = Boolean(isHouse && houseConfig && houseConfig.levels);
  let symbol = symbols[type] || symbols.structure || '#';
  let capacity = Math.max(1, Number(structureConfig.capacity || 1));
  const id = `${type}_${++state.structureCounter}`;
  const structure = {
    id,
    type,
    x,
    y,
  };
  if (isHouse && hasLevels) {
    const level = 1;
    capacity = getHouseCapacity(houseConfig, level, capacity);
    symbol = String(level);
    structure.level = level;
  }
  structure.symbol = symbol;
  structure.capacity = capacity;
  return structure;
}

function createResourceNode(state, config, resourceId, x, y, capacityOverride, source) {
  const resources = config.resources || {};
  const capacityConfig = resources.nodeCapacity || {};
  const defaultCapacity = Number(resources.defaultNodeCapacity || 10);
  const capacity = Math.max(
    1,
    Number(
      capacityOverride !== undefined
        ? capacityOverride
        : (capacityConfig[resourceId] ?? defaultCapacity),
    ),
  );
  const symbols = config.symbols || {};
  const symbol = symbols[resourceId] || '?';
  return {
    nodeId: `node_${++state.nodeCounter}`,
    id: resourceId,
    symbol,
    source: source || 'natural',
    x,
    y,
    capacity,
    remaining: capacity,
  };
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
  let targetStructure = null;

  if (job.type === 'build') {
    if (!isBuildableCell(state, runtime, targetX, targetY)) {
      removeJob(state, job.id);
      dwarf.job = null;
      return;
    }
  }
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

const MERCHANT_SIDES = ['north', 'south', 'west', 'east'];

function updateMerchant(state, config, runtime) {
  const merchantConfig = config.merchant || {};
  if (merchantConfig.enabled === false) {
    return;
  }
  if (!runtime || runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return;
  }

  const merchantStats = ensureMerchantStats(state);
  merchantStats.ticks = Number(merchantStats.ticks || 0) + 1;

  const merchant = ensureMerchantState(state, merchantConfig);
  if (merchant.phase === 'idle') {
    if (state.tick < merchant.nextSpawnTick) {
      return;
    }
    spawnMerchant(state, config, runtime, merchant);
    return;
  }

  if (merchant.phase === 'entering') {
    if (!merchant.target) {
      merchant.target = findMerchantStopSpot(state, runtime) || { x: merchant.x, y: merchant.y };
    }
    if (merchant.x === merchant.target.x && merchant.y === merchant.target.y) {
      merchant.phase = 'trading';
    } else {
      moveTowards(merchant, merchant.target, runtime);
      if (merchant.x === merchant.target.x && merchant.y === merchant.target.y) {
        merchant.phase = 'trading';
      }
    }
    return;
  }

  if (merchant.phase === 'trading') {
    if (Number(merchant.tradesRemaining || 0) > 0) {
      attemptMerchantTrade(state, config, merchant);
    }
    merchant.stayTicks = Math.max(0, Number(merchant.stayTicks || 0) - 1);
    if (merchant.stayTicks <= 0 || Number(merchant.tradesRemaining || 0) <= 0) {
      startMerchantExit(state, runtime, merchant);
    }
    return;
  }

  if (merchant.phase === 'exiting') {
    if (!merchant.exitTarget) {
      const fallbackSide = merchant.exitSide || pickMerchantSide();
      merchant.exitTarget = findEdgeSpawnPosition(state, runtime, fallbackSide);
    }
    if (merchant.x === merchant.exitTarget.x && merchant.y === merchant.exitTarget.y) {
      finalizeMerchantVisit(state, config, merchant);
      return;
    }
    moveTowards(merchant, merchant.exitTarget, runtime);
  }
}

function ensureMerchantState(state, merchantConfig) {
  if (!state.merchant || typeof state.merchant !== 'object') {
    state.merchant = buildMerchantState(merchantConfig, state.tick);
  }

  const merchant = state.merchant;
  if (!merchant.phase) {
    merchant.phase = 'idle';
  }
  if (!Number.isFinite(merchant.nextSpawnTick)) {
    merchant.nextSpawnTick = scheduleNextMerchantSpawnTick(state.tick, merchantConfig);
  }
  return merchant;
}

function ensureMerchantStats(state) {
  if (!state.merchantStats || typeof state.merchantStats !== 'object') {
    state.merchantStats = buildMerchantStats();
  }
  const stats = state.merchantStats;
  if (!Number.isFinite(stats.ticks)) {
    stats.ticks = 0;
  }
  if (!Number.isFinite(stats.trades)) {
    stats.trades = 0;
  }
  if (!stats.given || typeof stats.given !== 'object') {
    stats.given = {};
  }
  if (!stats.received || typeof stats.received !== 'object') {
    stats.received = {};
  }
  return stats;
}

function buildMerchantState(merchantConfig, currentTick) {
  const spawnRange = getMerchantSpawnRange(merchantConfig);
  const baseTick = Number.isFinite(currentTick) ? currentTick : 0;
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
    nextSpawnTick: baseTick + randomBetween(spawnRange.min, spawnRange.max),
  };
}

function buildMerchantStats() {
  return {
    ticks: 0,
    trades: 0,
    given: {},
    received: {},
  };
}

function scheduleNextMerchantSpawnTick(currentTick, merchantConfig) {
  const spawnRange = getMerchantSpawnRange(merchantConfig);
  return currentTick + randomBetween(spawnRange.min, spawnRange.max);
}

function getMerchantSpawnRange(merchantConfig) {
  const spawnRange = merchantConfig.spawnRangeTicks || {};
  const min = Math.max(0, Number(spawnRange.min ?? 0));
  const max = Math.max(min, Number(spawnRange.max ?? min));
  return { min, max };
}

function spawnMerchant(state, config, runtime, merchant) {
  const merchantConfig = config.merchant || {};
  const entrySide = pickMerchantSide();
  const exitSide = pickExitSide(entrySide);
  const entryPosition = findEdgeSpawnPosition(state, runtime, entrySide);
  const stopTarget = findMerchantStopSpot(state, runtime) || entryPosition;
  const exitTarget = findEdgeSpawnPosition(state, runtime, exitSide);

  merchant.phase = 'entering';
  merchant.entrySide = entrySide;
  merchant.exitSide = exitSide;
  merchant.x = entryPosition.x;
  merchant.y = entryPosition.y;
  merchant.target = stopTarget;
  merchant.exitTarget = exitTarget;

  merchant.stayTicks = Math.max(0, Number(merchantConfig.stayTicks ?? 10));
  const maxTrades = Math.max(0, Number(merchantConfig.maxTradesPerVisit ?? 0));
  merchant.tradesRemaining = maxTrades;
  merchant.tradesMax = maxTrades;
  merchant.tradeCount = 0;
  merchant.tradeLog = {};

  merchant.nextSpawnTick = scheduleNextMerchantSpawnTick(state.tick, merchantConfig);

  pushEvent(state, config, 'Merchant arrived');
}

function startMerchantExit(state, runtime, merchant) {
  if (merchant.phase === 'exiting') {
    return;
  }
  merchant.phase = 'exiting';
  if (!merchant.exitTarget) {
    const exitSide = merchant.exitSide || pickMerchantSide();
    merchant.exitTarget = findEdgeSpawnPosition(state, runtime, exitSide);
  }
}

function finalizeMerchantVisit(state, config, merchant) {
  const summary = buildMerchantTradeSummary(merchant.tradeLog, 2);
  pushEvent(state, config, 'Merchant departed');
  if (summary) {
    pushEvent(state, config, summary);
  }

  merchant.phase = 'idle';
  merchant.x = 0;
  merchant.y = 0;
  merchant.target = null;
  merchant.exitTarget = null;
  merchant.entrySide = null;
  merchant.exitSide = null;
  merchant.stayTicks = 0;
  merchant.tradesRemaining = 0;
  merchant.tradesMax = 0;
  merchant.tradeCount = 0;
  merchant.tradeLog = null;
}

function pickMerchantSide() {
  return MERCHANT_SIDES[Math.floor(Math.random() * MERCHANT_SIDES.length)];
}

function pickExitSide(entrySide) {
  const options = MERCHANT_SIDES.filter((side) => side !== entrySide);
  if (options.length === 0) {
    return entrySide;
  }
  return options[Math.floor(Math.random() * options.length)];
}

function findEdgeSpawnPosition(state, runtime, side) {
  const positions = getEdgePositions(runtime, side);
  if (positions.length === 0) {
    return { x: 0, y: 0 };
  }

  const candidates = positions.filter((pos) => isBuildableCell(state, runtime, pos.x, pos.y));
  const pool = candidates.length > 0 ? candidates : positions;
  return pool[Math.floor(Math.random() * pool.length)];
}

function getEdgePositions(runtime, side) {
  const positions = [];
  if (runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return positions;
  }
  if (side === 'north' || side === 'south') {
    const y = side === 'north' ? 0 : runtime.gridHeight - 1;
    for (let x = 0; x < runtime.gridWidth; x += 1) {
      positions.push({ x, y });
    }
    return positions;
  }
  const x = side === 'west' ? 0 : runtime.gridWidth - 1;
  for (let y = 0; y < runtime.gridHeight; y += 1) {
    positions.push({ x, y });
  }
  return positions;
}

function findMerchantStopSpot(state, runtime) {
  const houses = (state.structures || []).filter((structure) => structure.type === 'house');
  if (houses.length > 0) {
    const house = houses[Math.floor(Math.random() * houses.length)];
    const adjacent = getAdjacentPositions(house.x, house.y);
    const available = adjacent.filter((pos) => isBuildableCell(state, runtime, pos.x, pos.y));
    if (available.length > 0) {
      return available[Math.floor(Math.random() * available.length)];
    }
  }

  return findVillageBuildSpot(state, runtime);
}

function getAdjacentPositions(x, y) {
  return [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
    { x: x + 1, y: y + 1 },
    { x: x + 1, y: y - 1 },
    { x: x - 1, y: y + 1 },
    { x: x - 1, y: y - 1 },
  ];
}

function attemptMerchantTrade(state, config, merchant) {
  const trade = findMerchantTradeOption(state, config);
  if (!trade) {
    return false;
  }
  applyMerchantTrade(state, merchant, trade);
  return true;
}

function findMerchantTradeOption(state, config) {
  const merchantConfig = config.merchant || {};
  const reserveRatio = clamp(Number(merchantConfig.reserveRatio ?? 0.8), 0, 1);
  const tradeRate = merchantConfig.tradeRate || {};
  const giveAmount = Math.max(0, Number(tradeRate.give ?? 2));
  const receiveAmount = Math.max(0, Number(tradeRate.receive ?? 1));
  if (giveAmount <= 0 || receiveAmount <= 0) {
    return null;
  }

  const targets = getMerchantTargets(config);
  const missing = [];
  const surplus = [];

  for (const [resource, targetValue] of Object.entries(targets)) {
    const target = Number(targetValue || 0);
    if (target <= 0) {
      continue;
    }
    const current = Number(state.stockpile[resource] || 0);
    const ratio = target > 0 ? current / target : 0;
    const missingAmount = target - current;
    if (missingAmount >= receiveAmount) {
      missing.push({
        resource,
        missingAmount,
        missingRatio: 1 - ratio,
      });
    }

    const reserveTarget = target * reserveRatio;
    const surplusAmount = current - reserveTarget;
    if (surplusAmount >= giveAmount) {
      surplus.push({
        resource,
        surplusAmount,
        surplusRatio: target > 0 ? surplusAmount / target : 0,
        reserveTarget,
      });
    }
  }

  if (missing.length === 0 || surplus.length === 0) {
    return null;
  }

  missing.sort((a, b) => {
    if (b.missingRatio !== a.missingRatio) {
      return b.missingRatio - a.missingRatio;
    }
    return b.missingAmount - a.missingAmount;
  });

  surplus.sort((a, b) => {
    if (b.surplusRatio !== a.surplusRatio) {
      return b.surplusRatio - a.surplusRatio;
    }
    return b.surplusAmount - a.surplusAmount;
  });

  const epsilon = 1e-9;

  for (const need of missing) {
    for (const extra of surplus) {
      if (need.resource === extra.resource) {
        continue;
      }
      const current = Number(state.stockpile[extra.resource] || 0);
      if (current - giveAmount < extra.reserveTarget - epsilon) {
        continue;
      }
      return {
        giveResource: extra.resource,
        receiveResource: need.resource,
        giveAmount,
        receiveAmount,
      };
    }
  }

  return null;
}

function getMerchantTargets(config) {
  const resources = config.resources || {};
  return resources.targets || resources.stockpile || {};
}

function applyMerchantTrade(state, merchant, trade) {
  state.stockpile[trade.giveResource] = Number(state.stockpile[trade.giveResource] || 0) - trade.giveAmount;
  state.stockpile[trade.receiveResource] = Number(state.stockpile[trade.receiveResource] || 0)
    + trade.receiveAmount;
  merchant.tradesRemaining = Math.max(0, Number(merchant.tradesRemaining || 0) - 1);
  merchant.tradeCount = Number(merchant.tradeCount || 0) + 1;
  recordMerchantTrade(merchant, trade);
  recordMerchantTradeStats(state, trade);
}

function recordMerchantTrade(merchant, trade) {
  if (!merchant.tradeLog || typeof merchant.tradeLog !== 'object') {
    merchant.tradeLog = {};
  }
  const key = `${trade.giveResource}->${trade.receiveResource}`;
  merchant.tradeLog[key] = Number(merchant.tradeLog[key] || 0) + 1;
}

function recordMerchantTradeStats(state, trade) {
  const stats = ensureMerchantStats(state);
  stats.trades = Number(stats.trades || 0) + 1;
  const giveResource = trade.giveResource;
  const receiveResource = trade.receiveResource;
  const giveAmount = Number(trade.giveAmount || 0);
  const receiveAmount = Number(trade.receiveAmount || 0);

  if (giveResource) {
    stats.given[giveResource] = Number(stats.given[giveResource] || 0) + giveAmount;
  }
  if (receiveResource) {
    stats.received[receiveResource] = Number(stats.received[receiveResource] || 0) + receiveAmount;
  }
}

function buildMerchantTradeSummary(tradeLog, maxEntries) {
  if (!tradeLog || typeof tradeLog !== 'object') {
    return '';
  }
  const entries = Object.entries(tradeLog);
  if (entries.length === 0) {
    return '';
  }
  entries.sort((a, b) => b[1] - a[1]);
  const limit = Math.max(1, Number(maxEntries || 1));
  const parts = entries.slice(0, limit).map(([key, count]) => `${key} x${count}`);
  const remaining = entries.length - limit;
  if (remaining > 0) {
    parts.push(`+${remaining}`);
  }
  return `Merchant traded: ${parts.join(', ')}`;
}

function randomBetween(min, max) {
  const low = Number.isFinite(min) ? Number(min) : 0;
  const high = Number.isFinite(max) ? Number(max) : low;
  if (high <= low) {
    return low;
  }
  return Math.floor(Math.random() * (high - low + 1)) + low;
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
