'use strict';

const { clamp } = require('../utils');
const { getStockpileTarget } = require('../simulation/resources');
const { getFestivalObservation } = require('../simulation/festivals');
const { getClanList, getClanShare } = require('../clans');

// Build a full observation object from the current state.
function buildObservation(state, config) {
  const targets = (config.resources && (config.resources.targets || config.resources.stockpile)) || {};
  const stockpileRatio = {};

  for (const [resource, targetValue] of Object.entries(targets)) {
    const target = getStockpileTarget(state, config, resource, targets);
    if (target <= 0) {
      continue;
    }
    const current = Number(state.stockpile[resource] || 0);
    stockpileRatio[resource] = clamp(current / target, 0, 1);
  }

  const housingStats = getHousingStats(state, config);
  const raidObservation = getRaidObservation(state, config, housingStats);
  const ruinsObservation = buildRuinsObservation(state, config);
  const mythsObservation = buildMythsObservation(state, config);
  const festivalObservation = getFestivalObservation(state, config);
  const clanShares = getClanShares(state, config);

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
    ruins: ruinsObservation,
    myths: mythsObservation,
    festival: festivalObservation,
    clanShares,
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
  const populationBalance = clamp(Number(obs.populationBalance || 0), 0, 1);
  const seasonIndex = getSeasonIndex(obs.season, config);
  const seasonProgress = getSeasonProgress(obs.season);
  const weather = obs.weather || {};
  const weatherSeverity = clamp(Number(weather.severity || 0), 0, 1);
  const weatherTimeLeft = clamp(Number(weather.timeLeft || 0), 0, 1);
  const raid = obs.raid || {};
  const raidActive = raid.active ? 1 : 0;
  const raidTimeLeft = clamp(Number(raid.timeLeftRatio ?? raid.timeLeft ?? 0), 0, 1);
  const raidExposed = clamp(Number(raid.exposedRatio ?? raid.exposed ?? 0), 0, 1);
  const raidDefense = clamp(Number(raid.defenseRatio ?? raid.defense ?? 0), 0, 1);
  const housingRatio = clamp(Number(obs.housingRatio || 0), 0, 1);
  const housingShortage = clamp(1 - housingRatio, 0, 1);
  const seasonEligible = raid.seasonEligible ? 1 : 0;
  const ruins = obs.ruins || {};
  const ruinsActive = ruins.active ? 1 : 0;
  const ruinsCooldown = clamp(Number(ruins.cooldownRatio ?? 0), 0, 1);
  const ruinsProgress = clamp(Number(ruins.progress ?? 0), 0, 1);
  const ruinsArtifacts = clamp(Number(ruins.artifacts ?? 0), 0, 1);
  const myths = obs.myths || {};
  const mythsActiveRatio = clamp(Number(myths.activeRatio ?? 0), 0, 1);
  const mythsSeverity = clamp(Number(myths.severity ?? 0), 0, 1);
  const mythFlags = myths.flags || {};
  const festival = obs.festival || {};
  const festivalActive = festival.active ? 1 : 0;
  const festivalTimeLeft = clamp(Number(festival.timeLeft ?? 0), 0, 1);
  const festivalEligible = clamp(Number(festival.eligible ?? 0), 0, 1);
  const festivalCostRatio = clamp(Number(festival.costRatio ?? 0), 0, 1);
  const clanShares = obs.clanShares || {};

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
    ruinsActive,
    ruinsCooldown,
    ruinsProgress,
    ruinsArtifacts,
    mythsActiveRatio,
    mythsSeverity,
    festivalActive,
    festivalTimeLeft,
    festivalEligible,
    festivalCostRatio,
  };
  const mythDefs = (config && config.myths && config.myths.definitions) || {};
  for (const mythId of Object.keys(mythDefs)) {
    const key = `mythFlag_${mythId}`;
    values[key] = clamp(Number(mythFlags[mythId] || 0), 0, 1);
  }
  const clanList = getClanList(config);
  for (const clanId of clanList) {
    const key = `clanShare_${clanId}`;
    values[key] = clamp(Number(clanShares[clanId] || 0), 0, 1);
  }

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
  const reproduction = config.population && config.population.reproduction;
  const softCap = Number(reproduction && reproduction.softCap || 0);
  if (softCap <= 0) {
    return 1;
  }
  const ratio = 1 - Math.abs(state.dwarves.length - softCap) / softCap;
  return clamp(ratio, 0, 1);
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

// Build ruins observation scalars.
function buildRuinsObservation(state, config) {
  const ruinsConfig = (config && config.ruins) || {};
  if (ruinsConfig.enabled === false) {
    return { active: 0, cooldownRatio: 0, progress: 0, artifacts: 0 };
  }
  const ruins = state && state.ruins ? state.ruins : null;
  if (!ruins) {
    return { active: 0, cooldownRatio: 0, progress: 0, artifacts: 0 };
  }
  const rooms = Array.isArray(ruinsConfig.rooms) ? ruinsConfig.rooms : [];
  const roomCount = rooms.length > 0 ? rooms.length : 1;
  const progress = clamp(Number(ruins.roomsCleared || 0) / roomCount, 0, 1);
  const pool = ruinsConfig.artifacts && ruinsConfig.artifacts.pool
    ? ruinsConfig.artifacts.pool
    : {};
  const totalArtifacts = Object.keys(pool).length;
  const found = ruins.artifactsFound ? Object.keys(ruins.artifactsFound).length : 0;
  const artifacts = totalArtifacts > 0 ? clamp(found / totalArtifacts, 0, 1) : 0;
  const expeditionConfig = ruinsConfig.expedition || {};
  const maxCooldown = Math.max(
    1,
    Number(expeditionConfig.cooldownTicks || 0),
    Number(expeditionConfig.failureCooldownTicks || 0),
  );
  const cooldownRatio = clamp(Number(ruins.cooldown || 0) / maxCooldown, 0, 1);
  const active = Array.isArray(ruins.expeditions) && ruins.expeditions.length > 0 ? 1 : 0;
  return {
    active,
    cooldownRatio,
    progress,
    artifacts,
  };
}

// Build myths observation scalars.
function buildMythsObservation(state, config) {
  const mythsConfig = (config && config.myths) || {};
  if (mythsConfig.enabled === false || !state || !state.myths) {
    return { activeRatio: 0, severity: 0, flags: {} };
  }
  const defs = mythsConfig.definitions || {};
  const activeIds = Object.keys(state.myths.active || {});
  const maxActive = Math.max(1, Number(mythsConfig.maxActive || activeIds.length || 1));
  const activeRatio = clamp(activeIds.length / maxActive, 0, 1);
  const traditions = state.myths.traditions || {};
  let totalSeverity = 0;
  let count = 0;
  for (const mythId of activeIds) {
    const def = defs[mythId];
    const effects = def && def.effects;
    const severity = getEffectsSeverity(effects);
    if (severity > 0) {
      totalSeverity += severity;
      count += 1;
    }
  }
  for (const mythId of Object.keys(traditions)) {
    const def = defs[mythId];
    const effects = def && def.traditionEffects;
    const severity = getEffectsSeverity(effects);
    if (severity > 0) {
      totalSeverity += severity;
      count += 1;
    }
  }
  const severity = count > 0 ? clamp(totalSeverity / count, 0, 1) : 0;
  const flags = {};
  for (const mythId of Object.keys(defs)) {
    flags[mythId] = activeIds.includes(mythId) ? 1 : 0;
  }
  return { activeRatio, severity, flags };
}

// Compute average absolute deviation from 1 for a multiplier map.
function getEffectsSeverity(effects) {
  if (!effects || typeof effects !== 'object') {
    return 0;
  }
  let total = 0;
  let count = 0;
  for (const value of Object.values(effects)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      continue;
    }
    total += Math.abs(1 - numeric);
    count += 1;
  }
  return count > 0 ? total / count : 0;
}

// Compute clan share fractions across adults.
function getClanShares(state, config) {
  const clanList = getClanList(config);
  if (clanList.length === 0) {
    return {};
  }
  const shares = {};
  for (const clanId of clanList) {
    shares[clanId] = getClanShare(state.dwarves || [], clanId, (dwarf) => dwarf.lifeStage === 'adult');
  }
  return shares;
}

// Build raid-related observation metrics.
function getRaidObservation(state, config, housingStats) {
  const raidConfig = (config && config.raids) || {};
  const raidState = state.raid || {};
  if (!raidState) {
    return {
      active: false,
      timeLeftRatio: 0,
      exposedRatio: 0,
      defenseRatio: 0,
      seasonEligible: 0,
    };
  }

  const houses = housingStats ? housingStats.houses : (state.structures || []).filter((structure) => {
    return structure.type === 'house';
  });
  const population = housingStats ? housingStats.population : Math.max(1, state.dwarves.length);
  const houseMap = new Map(houses.map((house) => [house.id, house]));
  let exposedCount = 0;

  for (const dwarf of state.dwarves) {
    const home = dwarf.homeId ? houseMap.get(dwarf.homeId) : null;
    const sheltered = Boolean(home && dwarf.x === home.x && dwarf.y === home.y);
    if (!sheltered) {
      exposedCount += 1;
    }
  }

  const exposedRatio = population > 0 ? clamp(exposedCount / population, 0, 1) : 0;
  const adults = state.dwarves.filter((dwarf) => dwarf.lifeStage === 'adult').length;
  const defenseAdults = Math.max(1, Number(raidConfig.defenseAdults || population));
  const defenseMax = clamp(Number(raidConfig.defenseMax ?? 0), 0, 1);
  const defenseRaw = clamp(adults / defenseAdults, 0, defenseMax);
  const towerConfig = (config.structures && config.structures.watchtower) || {};
  const towerRaid = towerConfig.raid || {};
  const towerCount = (state.structures || []).filter((structure) => structure.type === 'watchtower').length;
  const towerDefensePer = Math.max(0, Number(towerRaid.defensePerTower ?? 0));
  const towerDefenseMax = clamp(Number(towerRaid.defenseMax ?? 0), 0, 1);
  const towerDefense = clamp(towerCount * towerDefensePer, 0, towerDefenseMax);
  const defenseRatio = clamp(defenseRaw + towerDefense, 0, 1);

  const duration = Math.max(1, Number(raidState.duration || raidConfig.durationTicks || 0));
  const ticksRemaining = Math.max(0, Number(raidState.ticksRemaining || 0));
  const timeLeftRatio = duration > 0 ? clamp(ticksRemaining / duration, 0, 1) : 0;

  const seasonNames = Array.isArray(raidConfig.seasonNames) && raidConfig.seasonNames.length > 0
    ? raidConfig.seasonNames
    : ['spring', 'autumn'];
  const seasonName = state.season ? state.season.name : null;
  let seasonEligible = raidConfig.enabled === true
    && seasonName
    && seasonNames.includes(seasonName)
    ? 1
    : 0;
  const minTick = Math.max(0, Number(raidConfig.minTick || 0));
  const minPopulation = Math.max(0, Number(raidConfig.minPopulation || 0));
  if (state.tick < minTick || population < minPopulation) {
    seasonEligible = 0;
  }

  return {
    active: Boolean(raidState.active),
    timeLeftRatio,
    exposedRatio,
    defenseRatio,
    seasonEligible,
    timeLeft: timeLeftRatio,
    exposed: exposedRatio,
    defense: defenseRatio,
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
    ratios[resource] = total > 0 ? clamp(remaining[resource] / total, 0, 1) : 0;
  }

  return ratios;
}

module.exports = { buildObservation, buildFeatures };
