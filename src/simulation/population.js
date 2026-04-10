'use strict';

const { clamp } = require('../utils');
const { pushEvent } = require('./events');
const { getSeasonModifier } = require('./season');
const { hasInputs, consumeInputs, getStockpileRatio } = require('./resources');
const { getMythMultiplier } = require('./myths');
const { getClanConfig, pickClanId } = require('../clans');
const { createDwarfWarriorState } = require('./warriors');
const {
  clearDeadSocialLinks,
  createInitialDwarfSocialState,
  noteSocialInteraction,
  updateSocialDrama,
} = require('./social_drama');

// Resolve the clan id for a newborn based on config and parents.
function resolveNewbornClanId(parentA, parentB, config) {
  const clanConfig = getClanConfig(config);
  if (clanConfig.enabled === false) {
    return null;
  }
  const inheritance = clanConfig.inheritance || {};
  const mode = String(inheritance.mode || 'parent');
  const parentClans = [parentA, parentB]
    .map((parent) => (parent ? parent.clanId : null))
    .filter((clanId) => clanId);

  if (mode === 'random') {
    return pickClanId(config);
  }

  if (parentClans.length === 1) {
    return parentClans[0];
  }
  if (parentClans.length >= 2) {
    if (parentClans[0] === parentClans[1]) {
      return parentClans[0];
    }
    return Math.random() < 0.5 ? parentClans[0] : parentClans[1];
  }

  return pickClanId(config);
}

// Advance dwarf age ticks and update life stage transitions.
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
  if (Number(dwarf.roleCooldown || 0) > 0) {
    dwarf.roleCooldown = Math.max(0, Number(dwarf.roleCooldown || 0) - 1);
  }
}

// Compute housing statistics for the current population.
function getHousingStats(state, config) {
  const housingConfig = (config.population && config.population.housing) || {};
  const enabled = housingConfig.enabled !== false;
  const structures = state.structures || [];
  const houses = structures.filter((structure) => structure.type === 'house');
  const housingSlots = houses.reduce((sum, house) => sum + Math.max(0, Number(house.capacity || 0)), 0);
  const population = Math.max(1, state.dwarves.length);
  const ratio = enabled
    ? (housingSlots > 0 ? housingSlots / population : 0)
    : 1;
  const missingBeds = Math.max(0, population - housingSlots);
  const unsheltered = Math.max(0, state.dwarves.length - housingSlots);
  const unshelteredFraction = population > 0 ? unsheltered / population : 0;

  return {
    enabled,
    houses: houses.length,
    beds: housingSlots,
    population,
    ratio,
    missingBeds,
    unsheltered,
    unshelteredFraction,
  };
}

// Compute the current housing need against configured targets.
function getHousingNeed(state, config) {
  const housingConfig = (config.population && config.population.housing) || {};
  const enabled = housingConfig.enabled !== false;
  if (!enabled) {
    return { needed: false, ratio: 1 };
  }
  const housing = getHousingStats(state, config);
  const buildTargetRatio = Math.max(0, Number(housingConfig.buildTargetRatio ?? 1));
  const requiredBeds = Math.ceil(housing.population * buildTargetRatio);
  const missingBeds = Math.max(0, requiredBeds - housing.beds);
  const ratio = buildTargetRatio > 0 ? housing.beds / requiredBeds : 1;
  return {
    needed: missingBeds > 0,
    ratio: clamp(ratio, 0, 1),
    beds: housing.beds,
    requiredBeds,
    missingBeds,
  };
}

// Compute bonding multiplier based on housing coverage.
function getBondingHousingMultiplier(state, config) {
  const housing = getHousingStats(state, config);
  if (!housing.enabled) {
    return 1;
  }
  const housingConfig = (config.population && config.population.housing) || {};
  const minMultiplier = Number(housingConfig.bondingMinMultiplier ?? 1);
  const maxMultiplier = Number(housingConfig.bondingMaxMultiplier ?? 1);
  const ratio = clamp(housing.ratio, 0, 1);
  return minMultiplier + (maxMultiplier - minMultiplier) * ratio;
}

// Compute penalties for winter exposure based on housing coverage.
function getWinterHousingPenalty(state, config) {
  const housing = getHousingStats(state, config);
  const seasonName = state.season ? state.season.name : null;
  const winter = seasonName === 'winter';
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

// Boost bond gain for same-clan interactions when configured.
function getClanBondGain(dwarf, partner, baseGain, relationships) {
  const bonus = Math.max(0, Number(relationships.sameClanBondGainBonus ?? 0));
  if (bonus <= 0) {
    return baseGain;
  }
  if (!dwarf || !partner || !dwarf.clanId || !partner.clanId) {
    return baseGain;
  }
  if (dwarf.clanId !== partner.clanId) {
    return baseGain;
  }
  return baseGain * (1 + bonus);
}

// Assign housing to dwarves based on available beds and partnerships.
function assignHousing(state, config) {
  const housingConfig = (config.population && config.population.housing) || {};
  if (housingConfig.enabled === false) {
    return;
  }
  const houses = (state.structures || []).filter((structure) => structure.type === 'house');
  if (houses.length === 0) {
    for (const dwarf of state.dwarves) {
      dwarf.homeId = null;
    }
    return;
  }

  const houseSlots = houses
    .map((house) => ({
      house,
      remaining: Math.max(0, Number(house.capacity || 0)),
    }))
    .filter((slot) => slot.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining);
  if (houseSlots.length === 0) {
    for (const dwarf of state.dwarves) {
      dwarf.homeId = null;
    }
    return;
  }

  for (const dwarf of state.dwarves) {
    dwarf.homeId = null;
  }

  const couples = [];
  const assigned = new Set();
  for (const dwarf of state.dwarves) {
    if (!dwarf.partnerId || assigned.has(dwarf.id) || assigned.has(dwarf.partnerId)) {
      continue;
    }
    const partner = state.dwarves.find((candidate) => candidate.id === dwarf.partnerId);
    if (!partner) {
      continue;
    }
    couples.push([dwarf, partner]);
  }

  couples.sort((a, b) => {
    const aScore = Number(isAdult(a[0], config)) + Number(isAdult(a[1], config));
    const bScore = Number(isAdult(b[0], config)) + Number(isAdult(b[1], config));
    return bScore - aScore;
  });

  for (const [dwarf, partner] of couples) {
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

// Align couple housing assignments to reduce no-housing blocks.
function cohouseCouples(state, config) {
  const housingConfig = (config.population && config.population.housing) || {};
  if (housingConfig.enabled === false) {
    return;
  }
  const houses = (state.structures || []).filter((structure) => structure.type === 'house');
  if (houses.length === 0) {
    return;
  }
  const dwarves = state.dwarves || [];
  if (dwarves.length === 0) {
    return;
  }

  const houseMap = new Map();
  for (const house of houses) {
    const capacity = Math.max(0, Number(house.capacity || 0));
    houseMap.set(house.id, {
      house,
      capacity,
      occupants: [],
      remaining: capacity,
    });
  }

  for (const dwarf of dwarves) {
    if (!dwarf.homeId) {
      continue;
    }
    const entry = houseMap.get(dwarf.homeId);
    if (!entry) {
      continue;
    }
    entry.occupants.push(dwarf);
  }

  for (const entry of houseMap.values()) {
    entry.remaining = Math.max(0, entry.capacity - entry.occupants.length);
  }

  const byId = new Map(dwarves.map((dwarf) => [dwarf.id, dwarf]));
  const cohoused = new Set();
  for (const dwarf of dwarves) {
    if (!dwarf.partnerId || cohoused.has(dwarf.id)) {
      continue;
    }
    const partner = byId.get(dwarf.partnerId);
    if (!partner) {
      continue;
    }
    if (dwarf.homeId && partner.homeId && dwarf.homeId === partner.homeId) {
      cohoused.add(dwarf.id);
      cohoused.add(partner.id);
    }
  }

  const couples = collectCouples(state);
  if (couples.length === 0) {
    return;
  }

  const houseEntries = Array.from(houseMap.values());

  const findHouseWithRemaining = (slotsNeeded, excludeId) => {
    for (const entry of houseEntries) {
      if (excludeId && entry.house.id === excludeId) {
        continue;
      }
      if (entry.remaining >= slotsNeeded) {
        return entry;
      }
    }
    return null;
  };

  const moveDwarfToHouse = (dwarf, entry) => {
    if (!entry || entry.remaining <= 0) {
      return false;
    }
    if (dwarf.homeId === entry.house.id) {
      return true;
    }
    if (dwarf.homeId) {
      const oldEntry = houseMap.get(dwarf.homeId);
      if (oldEntry) {
        const index = oldEntry.occupants.indexOf(dwarf);
        if (index >= 0) {
          oldEntry.occupants.splice(index, 1);
          oldEntry.remaining = Math.max(0, oldEntry.capacity - oldEntry.occupants.length);
        }
      }
    }
    entry.occupants.push(dwarf);
    entry.remaining = Math.max(0, entry.capacity - entry.occupants.length);
    dwarf.homeId = entry.house.id;
    return true;
  };

  const tryFreeSlot = (entry, protectedIds) => {
    if (!entry) {
      return false;
    }
    for (const occupant of entry.occupants) {
      if (protectedIds.has(occupant.id)) {
        continue;
      }
      if (cohoused.has(occupant.id)) {
        continue;
      }
      const dest = findHouseWithRemaining(1, entry.house.id);
      if (!dest) {
        return false;
      }
      moveDwarfToHouse(occupant, dest);
      return true;
    }
    return false;
  };

  for (const [a, b] of couples) {
    if (!a || !b) {
      continue;
    }
    if (a.homeId && b.homeId && a.homeId === b.homeId) {
      continue;
    }

    const protectedIds = new Set([a.id, b.id]);
    const homeA = a.homeId ? houseMap.get(a.homeId) : null;
    const homeB = b.homeId ? houseMap.get(b.homeId) : null;

    if (homeA && homeA.remaining >= 1) {
      moveDwarfToHouse(b, homeA);
      continue;
    }
    if (homeB && homeB.remaining >= 1) {
      moveDwarfToHouse(a, homeB);
      continue;
    }

    const target = findHouseWithRemaining(2, null);
    if (target) {
      moveDwarfToHouse(a, target);
      moveDwarfToHouse(b, target);
      continue;
    }

    if (homeA && tryFreeSlot(homeA, protectedIds)) {
      moveDwarfToHouse(b, homeA);
      continue;
    }
    if (homeB && tryFreeSlot(homeB, protectedIds)) {
      moveDwarfToHouse(a, homeB);
    }
  }
}

// Apply per-tick need decay to a dwarf.
function applyNeedDecay(dwarf, decay, multiplier, perNeedMultiplier) {
  const baseScale = Number(multiplier || 1);
  // Need values are 0..1 where 0 is satisfied and 1 is critical.
  for (const [need, delta] of Object.entries(decay)) {
    const current = Number(dwarf.needs[need] || 0);
    const localScale = perNeedMultiplier && perNeedMultiplier[need] !== undefined
      ? Number(perNeedMultiplier[need] || 1)
      : 1;
    const scale = baseScale * localScale;
    dwarf.needs[need] = clamp(current + Number(delta || 0) * scale, 0, 1);
  }
}

// Remove dwarves who die from starvation or old age.
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
  state.lastDeathTick = Number(state.tick || 0);
  state.dwarves = state.dwarves.filter((dwarf) => !deadIds.has(dwarf.id));
  state.jobs = state.jobs.filter((job) => !deadIds.has(job.dwarfId));
  clearDeadSocialLinks(state, deadIds);

  for (const message of deathMessages) {
    pushEvent(state, config, message);
  }
}

// Update relationship bonds and partnerships for idle dwarves.
function updateRelationships(state, config) {
  const relationships = (config.population && config.population.relationships) || {};
  const baseInteractions = Math.max(0, Number(relationships.interactionsPerTick ?? 2));
  const minInteractions = Math.max(0, Number(relationships.minInteractionsPerTick ?? 0));
  const idleMultiplier = Number(relationships.idleInteractionMultiplier ?? 1);
  const maxDistance = Math.max(0, Number(relationships.maxDistance ?? 6));
  const proximityShare = clamp(Number(relationships.proximityShare ?? 0), 0, 1);
  const bondGain = Number(relationships.bondGain ?? 1);
  const bondDecay = Number(relationships.bondDecay ?? 0.2);
  const bondThreshold = Number(relationships.bondThreshold ?? 20);
  const moraleMin = clamp(Number(relationships.moraleMin ?? 0), 0, 1);
  const moraleMax = clamp(Number(relationships.moraleMax ?? 1), 0, 1);
  const moraleBonusMax = clamp(Number(relationships.moraleBonusMax ?? 0), 0, 1);
  const moraleExponent = Math.max(0.1, Number(relationships.moraleExponent ?? 1));
  const bondingMultiplier = getBondingHousingMultiplier(state, config);
  const housing = getHousingStats(state, config);

  const adults = state.dwarves.filter((dwarf) => isAdult(dwarf, config));
  if (adults.length < 2 || (baseInteractions === 0 && minInteractions === 0)) {
    updateSocialDrama(state, config);
    return;
  }

  const idleAdults = adults.filter((dwarf) => !dwarf.job).length;
  const idleFraction = adults.length > 0 ? idleAdults / adults.length : 0;
  const bonusInteractions = Math.round(baseInteractions * idleFraction * idleMultiplier);
  const avgMorale = averageValue(adults, (dwarf) => dwarf.state.morale);
  const moraleRatio = moraleMax > moraleMin
    ? clamp((avgMorale - moraleMin) / (moraleMax - moraleMin), 0, 1)
    : 0;
  const moraleBonus = 1 + moraleBonusMax * Math.pow(moraleRatio, moraleExponent);
  const interactions = Math.max(
    minInteractions,
    Math.round((baseInteractions + bonusInteractions) * bondingMultiplier * moraleBonus),
  );
  const adjustedBondGain = bondGain * bondingMultiplier * moraleBonus;
  if (interactions <= 0) {
    updateSocialDrama(state, config);
    return;
  }

  if (housing.enabled) {
    if (housing.houses === 0) {
      updateSocialDrama(state, config);
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
    const allowProximity = maxDistance > 0 && interactions > 0;
    let proximityInteractions = allowProximity ? Math.round(interactions * proximityShare) : 0;
    let houseInteractions = interactions - proximityInteractions;

    if (eligibleHouses.length === 0) {
      proximityInteractions = interactions;
      houseInteractions = 0;
    }

    for (let i = 0; i < houseInteractions; i += 1) {
      const group = eligibleHouses[Math.floor(Math.random() * eligibleHouses.length)];
      const a = group[Math.floor(Math.random() * group.length)];
      let b = group[Math.floor(Math.random() * group.length)];
      if (a === b) {
        continue;
      }
      noteSocialInteraction(state, config, a, b);
      if (a.partnerId && a.partnerId !== b.id) {
        continue;
      }
      if (b.partnerId && b.partnerId !== a.id) {
        continue;
      }
      const gain = getClanBondGain(a, b, adjustedBondGain, relationships);
      progressBond(a, b, gain, bondDecay, bondThreshold);
      progressBond(b, a, gain, bondDecay, bondThreshold);
    }

    for (let i = 0; i < proximityInteractions; i += 1) {
      const a = adults[Math.floor(Math.random() * adults.length)];
      let b = adults[Math.floor(Math.random() * adults.length)];
      if (a === b) {
        continue;
      }
      const dist = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (dist > maxDistance) {
        continue;
      }
      noteSocialInteraction(state, config, a, b);
      if (a.partnerId && a.partnerId !== b.id) {
        continue;
      }
      if (b.partnerId && b.partnerId !== a.id) {
        continue;
      }
      const gain = getClanBondGain(a, b, adjustedBondGain, relationships);
      progressBond(a, b, gain, bondDecay, bondThreshold);
      progressBond(b, a, gain, bondDecay, bondThreshold);
    }

    updateSocialDrama(state, config);
    return;
  }

  for (let i = 0; i < interactions; i += 1) {
    const a = adults[Math.floor(Math.random() * adults.length)];
    let b = adults[Math.floor(Math.random() * adults.length)];
    if (a === b) {
      continue;
    }
    const dist = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (dist > maxDistance) {
      continue;
    }
    noteSocialInteraction(state, config, a, b);
    if (a.partnerId && a.partnerId !== b.id) {
      continue;
    }
    if (b.partnerId && b.partnerId !== a.id) {
      continue;
    }
    const gain = getClanBondGain(a, b, bondGain, relationships);
    progressBond(a, b, gain, bondDecay, bondThreshold);
    progressBond(b, a, gain, bondDecay, bondThreshold);
  }
  updateSocialDrama(state, config);
}

// Update the bond score between two dwarves.
function progressBond(dwarf, partner, bondGain, bondDecay, bondThreshold) {
  if (!dwarf.partnerId) {
    dwarf.partnerId = partner.id;
  }

  if (dwarf.partnerId !== partner.id) {
    dwarf.bondTargetId = null;
    dwarf.bondScore = 0;
    return;
  }

  if (!dwarf.bondTargetId) {
    dwarf.bondTargetId = partner.id;
    dwarf.bondScore = 0;
  }

  dwarf.bondScore = Math.min(bondThreshold, Number(dwarf.bondScore || 0) + bondGain);
}

// Process births and new conception attempts.
function handleReproduction(state, config) {
  const reproduction = (config.population && config.population.reproduction) || {};
  if (reproduction.enabled === false) {
    return;
  }

  processBirths(state, config, reproduction);
  attemptConceptions(state, config, reproduction);
}

// Spawn new dwarves whose pregnancies are due.
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

// Attempt new conceptions among bonded couples.
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

  const minRatios = reproduction.minStockpileRatio || {};
  for (const [resource, ratioRaw] of Object.entries(minRatios)) {
    const minRatio = clamp(Number(ratioRaw || 0), 0, 1);
    if (minRatio <= 0) {
      continue;
    }
    const ratio = getStockpileRatio(state, config, resource);
    if (ratio < minRatio) {
      stats.blockedLowStockpile = Number(stats.blockedLowStockpile || 0) + 1;
      return;
    }
  }

  const resourceFactor = getResourceFactor(state, reproduction);
  const crowdingFactor = getCrowdingFactor(state, reproduction);
  const moraleFactor = getMoraleFactor(state, reproduction);
  const seasonFactor = getSeasonModifier(state, 'reproductionChance', 1);
  const mythFactor = getMythMultiplier(state, config, 'reproductionChance', 1);
  const chance = clamp(
    baseChance * resourceFactor * crowdingFactor * moraleFactor * seasonFactor * mythFactor,
    0,
    1,
  );
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

// Count fertile adults for reproduction stats.
function countFertileAdults(state, config) {
  let count = 0;
  for (const dwarf of state.dwarves) {
    if (isFertileAdult(dwarf, config)) {
      count += 1;
    }
  }
  return count;
}

// Count current pregnancies in the population.
function countPregnancies(dwarves) {
  let count = 0;
  for (const dwarf of dwarves) {
    if (dwarf.pregnancy) {
      count += 1;
    }
  }
  return count;
}

// Count active fertility cooldowns.
function countCooldowns(dwarves) {
  let count = 0;
  for (const dwarf of dwarves) {
    if (Number(dwarf.fertilityCooldown || 0) > 0) {
      count += 1;
    }
  }
  return count;
}

// Gather bonded couples for reproduction checks.
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

// Compute reproduction factor based on resources per capita.
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

// Compute reproduction crowding factor based on soft population cap.
function getCrowdingFactor(state, reproduction) {
  const softCap = getDynamicPopulationSoftCap(state, reproduction);
  if (softCap <= 0) {
    return 1;
  }
  const minFactor = clamp(Number(reproduction.crowdingMinFactor ?? 0.2), 0, 1);
  const ratio = 1 - state.dwarves.length / softCap;
  return clamp(ratio, minFactor, 1);
}

// Compute soft population cap with optional Underrealm expansion bonuses.
function getDynamicPopulationSoftCap(state, reproduction) {
  const baseSoftCap = Number(reproduction.softCap ?? 0);
  if (baseSoftCap <= 0) {
    return 0;
  }
  const underrealm = state && state.underrealm;
  if (!underrealm || underrealm.enabled === false) {
    return baseSoftCap;
  }
  const crew = underrealm.crew || {};
  if (crew.enabled === false) {
    return baseSoftCap;
  }
  const unlockedDepth = Math.max(0, Math.floor(Number(underrealm.maxUnlockedDepth || 0)));
  const perDepthBonus = Math.max(0, Number(crew.unlockPopulationBonusPerDepth || 0));
  const perAssignedBonus = Math.max(0, Number(crew.populationBonusPerAssigned || 0));
  const assignedByDepth = crew.assignedByDepth || {};
  let assignedTotal = 0;
  for (const count of Object.values(assignedByDepth)) {
    assignedTotal += Math.max(0, Number(count || 0));
  }
  return baseSoftCap + unlockedDepth * perDepthBonus + assignedTotal * perAssignedBonus;
}

// Compute reproduction morale factor.
function getMoraleFactor(state, reproduction) {
  const influence = clamp(Number(reproduction.moraleInfluence ?? 0.5), 0, 1);
  if (state.dwarves.length === 0) {
    return 1;
  }
  const avgMorale = averageValue(state.dwarves, (dwarf) => dwarf.state.morale);
  return clamp((1 - influence) + avgMorale * influence, 0, 1);
}

// Check if a dwarf is an adult.
function isAdult(dwarf, config) {
  const aging = (config.population && config.population.aging) || {};
  const adultAge = Number(aging.adultAge ?? 0);
  const age = Number(dwarf.ageTicks || 0);
  return age >= adultAge;
}

// Check if a dwarf is within the fertile adult age range.
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

// Spawn a newborn dwarf and record birth events.
function spawnNewborn(state, config, parentA, parentB) {
  const needsTemplate = config.needs.initial || {};
  const aging = (config.population && config.population.aging) || {};
  const clanId = resolveNewbornClanId(parentA, parentB, config);
  const newbornId = `dwarf_${++state.dwarfCounter}`;
  const newbornState = {
    health: 1,
    morale: 1,
    moraleBoostBeer: 0,
    stress: 0,
    fatigue: 0,
  };
  const terrainSeed = state && state.terrain && Number.isFinite(Number(state.terrain.seed))
    ? Number(state.terrain.seed)
    : null;
  const newborn = {
    id: newbornId,
    spawnIndex: state.dwarfCounter,
    x: parentA ? parentA.x : 0,
    y: parentA ? parentA.y : 0,
    ageTicks: 0,
    lifeStage: 'child',
    needs: { ...needsTemplate },
    state: newbornState,
    job: null,
    role: null,
    roleCooldown: 0,
    clanId,
    homeId: (parentA && parentA.homeId) || (parentB && parentB.homeId) || null,
    partnerId: null,
    bondTargetId: null,
    bondScore: 0,
    social: createInitialDwarfSocialState(),
    fertilityCooldown: 0,
    pregnancy: null,
    starvationTicks: 0,
    underrealmChampionSurvivals: 0,
  };
  newborn.warrior = createDwarfWarriorState(
    newbornId,
    newborn,
    config,
    {
      terrainSeed,
      clanId,
    },
  );

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

// Compute the average of a numeric selector for a group.
function averageValue(dwarves, selector) {
  if (dwarves.length === 0) {
    return 0;
  }

  const total = dwarves.reduce((sum, dwarf) => sum + Number(selector(dwarf) || 0), 0);
  return total / dwarves.length;
}

// Consume stockpiled resources to reduce hunger and thirst.
function consumeResources(dwarf, state, config) {
  const stockpile = state && state.stockpile ? state.stockpile : null;
  const consumption = config && config.consumption ? config.consumption : {};
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
  const beerRelief = Number(consumption.beerRelief ?? 0.5);
  const waterRelief = Number(consumption.waterRelief ?? 0.35);
  const beerMoraleGain = Math.max(0, Number(consumption.beerMoraleGain ?? 0));
  const beerMoraleDecay = Math.max(0, Number(consumption.beerMoraleDecayPerTick ?? 0));
  const beerMoraleMax = clamp(Number(consumption.beerMoraleMax ?? 0), 0, 1);
  const beerReserveBase = Math.max(0, Number(consumption.beerReserveBase ?? 0));
  const beerReservePerCapita = Math.max(0, Number(consumption.beerReservePerCapita ?? 0));
  const beerMinReserveRatio = clamp(Number(consumption.beerMinReserveRatio ?? 0), 0, 1);
  const population = Array.isArray(state && state.dwarves) ? state.dwarves.length : 0;
  const beerReserveTarget = beerReserveBase + beerReservePerCapita * population;
  let moraleBoost = Number(dwarf.state.moraleBoostBeer);
  if (!Number.isFinite(moraleBoost)) {
    moraleBoost = 0;
  }
  moraleBoost = Math.max(0, moraleBoost - beerMoraleDecay);

  let hunger = Number(dwarf.needs.hunger || 0);
  if (hunger >= hungerThreshold) {
    let units = 0;
    while (units < maxUnitsPerTick && hunger > hungerTarget) {
      if (Number(stockpile.meal || 0) > 0) {
        stockpile.meal -= 1;
        hunger = clamp(hunger - mealRelief, 0, 1);
        dwarf.needs.hunger = hunger;
      } else if (Number(stockpile.food || 0) > 0) {
        stockpile.food -= 1;
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
      const beerRatio = beerReserveTarget > 0
        ? Number(stockpile.beer || 0) / beerReserveTarget
        : 1;
      const preferBeer = beerMinReserveRatio <= 0 || beerRatio >= beerMinReserveRatio;
      if (preferBeer && Number(stockpile.beer || 0) > 0) {
        stockpile.beer -= 1;
        thirst = clamp(thirst - beerRelief, 0, 1);
        dwarf.needs.thirst = thirst;
        if (beerMoraleGain > 0 && beerMoraleMax > 0) {
          moraleBoost = Math.min(beerMoraleMax, moraleBoost + beerMoraleGain);
        }
      } else if (Number(stockpile.water || 0) > 0) {
        stockpile.water -= 1;
        thirst = clamp(thirst - waterRelief, 0, 1);
        dwarf.needs.thirst = thirst;
      } else if (Number(stockpile.beer || 0) > 0) {
        stockpile.beer -= 1;
        thirst = clamp(thirst - beerRelief, 0, 1);
        dwarf.needs.thirst = thirst;
        if (beerMoraleGain > 0 && beerMoraleMax > 0) {
          moraleBoost = Math.min(beerMoraleMax, moraleBoost + beerMoraleGain);
        }
      } else {
        break;
      }
      units += 1;
    }
  }

  dwarf.state.moraleBoostBeer = moraleBoost;
}

// Update derived mood metrics from current needs.
function updateDerivedState(dwarf) {
  const values = Object.values(dwarf.needs);
  const avgNeed = values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
  const moraleBoost = clamp(Number(dwarf.state.moraleBoostBeer || 0), 0, 1);

  dwarf.state.morale = clamp(1 - avgNeed + moraleBoost, 0, 1);
  dwarf.state.stress = clamp(avgNeed, 0, 1);
  dwarf.state.fatigue = clamp(avgNeed, 0, 1);
}

module.exports = {
  advanceAge,
  applyNeedDecay,
  consumeResources,
  updateDerivedState,
  handleDeaths,
  updateRelationships,
  handleReproduction,
  isAdult,
  isFertileAdult,
  getHousingStats,
  getHousingNeed,
  getBondingHousingMultiplier,
  getWinterHousingPenalty,
  assignHousing,
  cohouseCouples,
};
