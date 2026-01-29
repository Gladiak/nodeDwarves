'use strict';

const { clamp } = require('../utils');

// Build a full observation object from the current state.
function buildObservation(state, config) {
  const targets = (config.resources && config.resources.targets) || {};
  const stockpileRatio = {};

  for (const [resource, targetValue] of Object.entries(targets)) {
    const target = Number(targetValue || 0);
    if (target <= 0) {
      continue;
    }
    const current = Number(state.stockpile[resource] || 0);
    stockpileRatio[resource] = clamp(current / target, 0, 1);
  }

  const housingStats = getHousingStats(state, config);
  const raidObservation = getRaidObservation(state, config, housingStats);

  return {
    season: state.season || null,
    weather: buildWeatherObservation(state, config),
    stockpileRatio,
    nodeRatio: getNodeRatio(state.nodes || []),
    criticalNeedsFraction: getCriticalNeedsFraction(state.dwarves || [], config),
    idleAdultsFraction: getIdleAdultsFraction(state.dwarves || []),
    populationBalance: getPopulationBalance(state, config),
    housingRatio: housingStats.housingRatio,
    raid: raidObservation,
  };
}

// Build feature vector values for a given resource.
function buildFeatures(obs, resource, config, featureNames) {
  const ratio = Number((obs.stockpileRatio && obs.stockpileRatio[resource]) ?? 1);
  const nodeRatio = Number((obs.nodeRatio && obs.nodeRatio[resource]) ?? 1);
  const shortage = clamp(1 - ratio, 0, 1);
  const nodeScarcity = clamp(1 - nodeRatio, 0, 1);
  const criticalNeeds = clamp(Number(obs.criticalNeedsFraction || 0), 0, 1);
  const idleAdults = clamp(Number(obs.idleAdultsFraction || 0), 0, 1);
  const populationBalance = clamp(Number(obs.populationBalance || 0), -1, 1);
  const seasonIndex = getSeasonIndex(obs.season, config);
  const seasonProgress = getSeasonProgress(obs.season);
  const weather = obs.weather || {};
  const weatherSeverity = clamp(Number(weather.severity || 0), 0, 1);
  const weatherTimeLeft = clamp(Number(weather.timeLeft || 0), 0, 1);
  const raid = obs.raid || {};
  const raidActive = raid.active ? 1 : 0;
  const raidTimeLeft = clamp(Number(raid.timeLeft || 0), 0, 1);
  const raidExposed = clamp(Number(raid.exposed || 0), 0, 1);
  const raidDefense = clamp(Number(raid.defense || 0), 0, 1);
  const housingRatio = clamp(Number(obs.housingRatio || 0), 0, 1);
  const housingShortage = clamp(1 - housingRatio, 0, 1);
  const seasonEligible = raid.seasonEligible ? 1 : 0;

  const values = {
    shortage,
    nodeScarcity,
    criticalNeeds,
    idleAdults,
    populationBalance,
    seasonIndex,
    seasonProgress,
    weatherSeverity,
    weatherTimeLeft,
    raidActive,
    raidTimeLeft,
    raidExposed,
    raidDefense,
    housingShortage,
    seasonEligible,
  };

  const names = Array.isArray(featureNames) && featureNames.length > 0
    ? featureNames
    : Object.keys(values);

  return names.map((name) => Number(values[name] ?? 0));
}

// Build weather observation scalars.
function buildWeatherObservation(state, config) {
  const weatherConfig = (config && config.weather) || {};
  const weather = state.weather;
  if (!weather || weatherConfig.enabled === false) {
    return { severity: 0, timeLeft: 0 };
  }
  const def = weatherConfig.states && weatherConfig.states[weather.type] ? weatherConfig.states[weather.type] : null;
  const severity = def && Number.isFinite(def.severity)
    ? clamp(Number(def.severity || 0), 0, 1)
    : getFallbackWeatherSeverity(weather.type);
  const duration = Math.max(1, Number(weather.duration || 0));
  const remaining = Math.max(0, Number(weather.ticksRemaining || 0));
  return {
    severity,
    timeLeft: clamp(remaining / duration, 0, 1),
  };
}

// Provide a fallback weather severity by type.
function getFallbackWeatherSeverity(type) {
  const id = String(type || '').toLowerCase();
  if (id === 'storm') {
    return 0.7;
  }
  if (id === 'drought' || id === 'cold') {
    return 0.6;
  }
  if (id === 'rain') {
    return 0.3;
  }
  return 0.1;
}

// Convert season info to a normalized index.
function getSeasonIndex(season, config) {
  if (!season || !season.name) {
    return 0;
  }
  const seasons = config.seasons || {};
  const order = Array.isArray(seasons.order) && seasons.order.length > 0
    ? seasons.order
    : ['spring', 'summer', 'autumn', 'winter'];
  const index = order.indexOf(season.name);
  if (index < 0) {
    return 0;
  }
  if (order.length <= 1) {
    return 0;
  }
  return clamp(index / (order.length - 1), 0, 1);
}

// Convert season progress to a normalized 0..1 range.
function getSeasonProgress(season) {
  if (!season) {
    return 0;
  }
  const tick = Number(season.tickInSeason || 0);
  const duration = Math.max(1, Number(season.duration || 0));
  return clamp(tick / duration, 0, 1);
}

// Compute fraction of dwarves with critical needs.
function getCriticalNeedsFraction(dwarves, config) {
  if (!Array.isArray(dwarves) || dwarves.length === 0) {
    return 0;
  }
  const threshold = Number((config.ai && config.ai.criticalNeedThreshold) || 0.9);
  let critical = 0;
  for (const dwarf of dwarves) {
    const needs = dwarf.needs || {};
    const values = Object.values(needs);
    const hasCritical = values.some((value) => Number(value || 0) >= threshold);
    if (hasCritical) {
      critical += 1;
    }
  }
  return clamp(critical / dwarves.length, 0, 1);
}

// Compute the fraction of idle adults.
function getIdleAdultsFraction(dwarves) {
  if (!Array.isArray(dwarves) || dwarves.length === 0) {
    return 0;
  }
  let adults = 0;
  let idleAdults = 0;
  for (const dwarf of dwarves) {
    if (dwarf.lifeStage !== 'adult') {
      continue;
    }
    adults += 1;
    if (!dwarf.job) {
      idleAdults += 1;
    }
  }
  if (adults <= 0) {
    return 0;
  }
  return clamp(idleAdults / adults, 0, 1);
}

// Compute population balance vs. configured housing target.
function getPopulationBalance(state, config) {
  const housingConfig = (config.population && config.population.housing) || {};
  if (housingConfig.enabled === false) {
    return 0;
  }
  const buildTargetRatio = Math.max(0, Number(housingConfig.buildTargetRatio ?? 1));
  if (buildTargetRatio <= 0) {
    return 0;
  }
  const houses = (state.structures || []).filter((structure) => structure.type === 'house');
  const bedsTotal = houses.reduce((sum, house) => sum + Math.max(0, Number(house.capacity || 0)), 0);
  const population = Math.max(1, state.dwarves.length);
  const ratio = bedsTotal / (population * buildTargetRatio);
  return clamp(ratio - 1, -1, 1);
}

// Compute housing stats for AI observation.
function getHousingStats(state, config) {
  const housingConfig = (config.population && config.population.housing) || {};
  const housingEnabled = housingConfig.enabled !== false;
  const houses = housingEnabled
    ? (state.structures || []).filter((structure) => structure.type === 'house')
    : [];
  const bedsTotal = houses.reduce((sum, house) => sum + Math.max(0, Number(house.capacity || 0)), 0);
  const population = Math.max(1, state.dwarves.length);
  const housingRatio = housingEnabled
    ? (bedsTotal > 0 ? bedsTotal / population : 0)
    : 1;
  return {
    housingEnabled,
    houses,
    population,
    housingRatio,
  };
}

// Build raid-related observation metrics.
function getRaidObservation(state, config, housingStats) {
  const raidConfig = (config && config.raids) || {};
  const raidState = state.raid || {};
  if (raidConfig.enabled !== true || !raidState) {
    return {
      active: false,
      timeLeft: 0,
      exposed: 0,
      defense: 0,
      seasonEligible: false,
    };
  }

  const raidActive = raidState.active === true;
  const timeLeft = raidActive
    ? clamp(Number(raidState.ticksRemaining || 0) / Math.max(1, Number(raidState.duration || 1)), 0, 1)
    : 0;

  const houses = housingStats ? housingStats.houses : (state.structures || []).filter((structure) => {
    return structure.type === 'house';
  });
  const population = housingStats ? housingStats.population : Math.max(1, state.dwarves.length);
  const housingRatio = housingStats ? housingStats.housingRatio : 0;
  const exposed = housingRatio < 1 ? clamp(1 - housingRatio, 0, 1) : 0;

  const defenseAdults = Math.max(1, Number(raidConfig.defenseAdults || population));
  const adults = state.dwarves.filter((dwarf) => dwarf.lifeStage === 'adult').length;
  const defenseMax = clamp(Number(raidConfig.defenseMax ?? 0), 0, 1);
  const defense = clamp(adults / defenseAdults, 0, defenseMax);
  const towerConfig = (config.structures && config.structures.watchtower) || {};
  const towerRaid = towerConfig.raid || {};
  const towerCount = (state.structures || []).filter((structure) => structure.type === 'watchtower').length;
  const towerDefensePer = Math.max(0, Number(towerRaid.defensePerTower ?? 0));
  const towerDefenseMax = clamp(Number(towerRaid.defenseMax ?? 0), 0, 1);
  const towerDefense = clamp(towerCount * towerDefensePer, 0, towerDefenseMax);
  const totalDefense = clamp(defense + towerDefense, 0, 1);

  const seasonEligible = raidConfig.enabled === true && state.season && state.season.name
    && Array.isArray(raidConfig.seasonNames)
    && raidConfig.seasonNames.includes(state.season.name);

  return {
    active: raidActive,
    timeLeft,
    exposed,
    defense: totalDefense,
    seasonEligible,
  };
}

// Compute resource node ratios for observations.
function getNodeRatio(nodes) {
  const totals = {};
  const remaining = {};

  for (const node of nodes) {
    if (!node || !node.id) {
      continue;
    }
    const capacity = Math.max(0, Number(node.capacity || 0));
    const remain = Math.max(0, Number(node.remaining || 0));
    totals[node.id] = Number(totals[node.id] || 0) + capacity;
    remaining[node.id] = Number(remaining[node.id] || 0) + remain;
  }

  const ratios = {};
  for (const [resource, total] of Object.entries(totals)) {
    ratios[resource] = total > 0 ? clamp(remaining[resource] / total, 0, 1) : 1;
  }

  return ratios;
}

module.exports = { buildObservation, buildFeatures };
