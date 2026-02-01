'use strict';

const { clamp } = require('../utils');
const { pushEvent } = require('./events');
const { shuffleInPlace } = require('./random');
const { isAdult } = require('./population');
const { moveDwarf, findEdgeWalkablePosition, findAnyWalkablePosition } = require('./movement');

const RAID_SIDES = ['north', 'south', 'west', 'east'];

// Evaluate raid start conditions at the beginning of a season.
function updateRaidStart(state, config, runtime) {
  const raidConfig = (config && config.raids) || {};
  if (raidConfig.enabled !== true) {
    return;
  }
  if (!state || !state.season || !runtime) {
    return;
  }

  if (!state.raid) {
    state.raid = {
      active: false,
      ticksRemaining: 0,
      duration: 0,
      lastSeasonIndex: null,
      beasts: [],
    };
  }

  if (state.raid.active) {
    return;
  }

  const seasonNames = Array.isArray(raidConfig.seasonNames) && raidConfig.seasonNames.length > 0
    ? raidConfig.seasonNames
    : ['spring', 'autumn'];
  if (!seasonNames.includes(state.season.name)) {
    return;
  }

  if (Number(state.season.tickInSeason || 0) !== 1) {
    return;
  }

  const minTick = Math.max(0, Number(raidConfig.minTick || 0));
  if (state.tick < minTick) {
    return;
  }

  const minPopulation = Math.max(0, Number(raidConfig.minPopulation || 0));
  if (state.dwarves.length < minPopulation) {
    return;
  }

  const seasonIndex = Number(state.season.globalIndex ?? state.season.index ?? 0);
  const minSeasonsBetween = Math.max(0, Number(raidConfig.minSeasonsBetween || 0));
  if (Number.isFinite(state.raid.lastSeasonIndex)
    && seasonIndex - state.raid.lastSeasonIndex <= minSeasonsBetween) {
    return;
  }

  const difficulty = getRaidDifficulty(config, state);
  const chanceConfig = raidConfig.chance || {};
  const chanceMin = clamp(Number(chanceConfig.min ?? 0), 0, 1);
  const chanceMax = clamp(Number(chanceConfig.max ?? chanceMin), 0, 1);
  const chance = lerp(chanceMin, chanceMax, difficulty);
  if (Math.random() >= chance) {
    return;
  }

  startRaid(state, config, runtime, raidConfig, seasonIndex);
}

// Check if raids are eligible in the current season.
function isRaidSeasonEligible(state, config) {
  const raidConfig = (config && config.raids) || {};
  if (raidConfig.enabled !== true) {
    return false;
  }
  if (!state || !state.season) {
    return false;
  }
  const seasonNames = Array.isArray(raidConfig.seasonNames) && raidConfig.seasonNames.length > 0
    ? raidConfig.seasonNames
    : ['spring', 'autumn'];
  if (!seasonNames.includes(state.season.name)) {
    return false;
  }
  const minTick = Math.max(0, Number(raidConfig.minTick || 0));
  if (state.tick < minTick) {
    return false;
  }
  const minPopulation = Math.max(0, Number(raidConfig.minPopulation || 0));
  if (state.dwarves.length < minPopulation) {
    return false;
  }
  return true;
}

// Start a new raid and spawn beasts.
function startRaid(state, config, runtime, raidConfig, seasonIndex) {
  const duration = Math.max(1, Number(raidConfig.durationTicks || 0));
  const raidState = state.raid || {};
  const raidStats = ensureRaidStats(state);
  raidState.active = true;
  raidState.ticksRemaining = duration;
  raidState.duration = duration;
  raidState.lastSeasonIndex = seasonIndex;
  raidState.beasts = spawnRaidBeasts(state, runtime, raidConfig);
  raidState.seasonName = state.season ? state.season.name : null;
  state.raid = raidState;
  raidStats.count = Number(raidStats.count || 0) + 1;
  pushEvent(state, config, 'Raid: beasts enter the valley');
}

// Advance raid state and conclude when the timer ends.
function updateRaidTick(state, config, runtime) {
  const raidState = state.raid;
  if (!raidState || !raidState.active) {
    return;
  }
  moveRaidBeasts(raidState.beasts || [], runtime, state, config);
  applyWatchtowerAttacks(state, config, raidState);
  raidState.ticksRemaining = Math.max(0, Number(raidState.ticksRemaining || 0) - 1);
  if (raidState.ticksRemaining > 0) {
    return;
  }
  finishRaid(state, config, raidState);
}

// Resolve raid outcomes including deaths and loot loss.
function finishRaid(state, config, raidState) {
  const raidConfig = (config && config.raids) || {};
  const raidStats = ensureRaidStats(state);
  const houses = (state.structures || []).filter((structure) => structure.type === 'house');
  const houseMap = new Map(houses.map((house) => [house.id, house]));
  const exposed = [];

  for (const dwarf of state.dwarves) {
    const home = dwarf.homeId ? houseMap.get(dwarf.homeId) : null;
    const sheltered = Boolean(home && dwarf.x === home.x && dwarf.y === home.y);
    if (!sheltered) {
      exposed.push(dwarf);
    }
  }

  const exposedCount = exposed.length;
  const population = Math.max(1, state.dwarves.length);
  const adults = state.dwarves.filter((dwarf) => isAdult(dwarf, config)).length;
  const defenseAdults = Math.max(1, Number(raidConfig.defenseAdults || population));
  const defenseMax = clamp(Number(raidConfig.defenseMax ?? 0), 0, 1);
  const defense = clamp(adults / defenseAdults, 0, defenseMax);
  const towerConfig = (config.structures && config.structures.watchtower) || {};
  const towerRaid = towerConfig.raid || {};
  const towerCount = (state.structures || []).filter((structure) => structure.type === 'watchtower').length;
  const towerDefensePer = Math.max(0, Number(towerRaid.defensePerTower ?? 0));
  const towerDefenseMax = clamp(Number(towerRaid.defenseMax ?? 0), 0, 1);
  const towerDefense = clamp(towerCount * towerDefensePer, 0, towerDefenseMax);
  const totalDefense = clamp(defense + towerDefense, 0, 1);

  const difficulty = getRaidDifficulty(config, state);
  const deathConfig = raidConfig.deathRate || {};
  const deathMin = clamp(Number(deathConfig.min ?? 0), 0, 1);
  const deathMax = clamp(Number(deathConfig.max ?? deathMin), 0, 1);
  const deathRate = clamp(lerp(deathMin, deathMax, difficulty) * (1 - totalDefense), 0, 1);
  let deaths = Math.ceil(exposedCount * deathRate);
  if (exposedCount > 0 && deaths === 0) {
    deaths = 1;
  }
  deaths = clamp(deaths, 0, exposedCount);

  let raidDeaths = 0;
  if (deaths > 0) {
    const victims = exposed.slice();
    shuffleInPlace(victims);
    const dead = victims.slice(0, deaths);
    const deadIds = new Set(dead.map((dwarf) => dwarf.id));
    raidDeaths = applyRaidDeaths(state, deadIds);
  }
  if (raidDeaths > 0) {
    raidStats.deaths = Number(raidStats.deaths || 0) + raidDeaths;
  }

  const lossConfig = raidConfig.resourceLoss || {};
  const lossMin = clamp(Number(lossConfig.min ?? 0), 0, 1);
  const lossMax = clamp(Number(lossConfig.max ?? lossMin), 0, 1);
  const baseLoss = lerp(lossMin, lossMax, difficulty);
  const lossRatio = clamp(baseLoss * (1 - totalDefense), 0, 1);
  const stolen = applyRaidResourceLoss(state, lossRatio, lossConfig.weights || {});
  addRaidLoot(raidStats, stolen);
  const stolenLabel = formatRaidLoot(stolen);

  const parts = [];
  if (raidDeaths > 0) {
    parts.push(`${raidDeaths} slain`);
  }
  if (stolenLabel) {
    parts.push(`loot ${stolenLabel}`);
  }

  pushEvent(state, config, parts.length > 0 ? `Raid ended: ${parts.join(', ')}` : 'Raid ended: no losses');

  raidState.active = false;
  raidState.ticksRemaining = 0;
  raidState.beasts = [];
}

// Remove dwarves killed in a raid and clean up their jobs.
function applyRaidDeaths(state, deadIds) {
  if (!deadIds || deadIds.size === 0) {
    return 0;
  }
  state.deathsByCause.raid = Number(state.deathsByCause.raid || 0) + deadIds.size;
  state.deathsCount = Number(state.deathsCount || 0) + deadIds.size;
  state.lastDeathTick = Number(state.tick || 0);
  state.dwarves = state.dwarves.filter((dwarf) => !deadIds.has(dwarf.id));
  state.jobs = state.jobs.filter((job) => !deadIds.has(job.dwarfId));
  return deadIds.size;
}

// Apply stockpile losses based on configured weights.
function applyRaidResourceLoss(state, lossRatio, weights) {
  const totals = {};
  if (!state || !state.stockpile) {
    return totals;
  }
  const stockpile = state.stockpile;
  for (const [resource, amount] of Object.entries(stockpile)) {
    const weight = Number(weights[resource] ?? 0);
    if (!Number.isFinite(weight) || weight <= 0) {
      continue;
    }
    const current = Math.max(0, Number(amount || 0));
    if (current <= 0) {
      continue;
    }
    const loss = Math.max(0, Math.floor(current * lossRatio * weight));
    if (loss > 0) {
      stockpile[resource] = current - loss;
      totals[resource] = loss;
    }
  }
  return totals;
}

// Format stolen loot for event messaging.
function formatRaidLoot(stolen) {
  if (!stolen || typeof stolen !== 'object') {
    return '';
  }
  const entries = Object.entries(stolen).filter(([, value]) => Number(value || 0) > 0);
  if (entries.length === 0) {
    return '';
  }
  return entries.map(([key, value]) => `${key}=${value}`).join(' ');
}

// Ensure raid stats exist on the state.
function ensureRaidStats(state) {
  if (!state.raidStats) {
    state.raidStats = { count: 0, deaths: 0, loot: {} };
  }
  if (!state.raidStats.loot || typeof state.raidStats.loot !== 'object') {
    state.raidStats.loot = {};
  }
  return state.raidStats;
}

// Accumulate raid loot in stats.
function addRaidLoot(raidStats, stolen) {
  if (!raidStats || !stolen || typeof stolen !== 'object') {
    return;
  }
  const loot = raidStats.loot || {};
  for (const [resource, amount] of Object.entries(stolen)) {
    const value = Math.max(0, Number(amount || 0));
    if (!Number.isFinite(value) || value <= 0) {
      continue;
    }
    loot[resource] = Number(loot[resource] || 0) + value;
  }
  raidStats.loot = loot;
}

// Spawn raid beasts based on population size.
function spawnRaidBeasts(state, runtime, raidConfig) {
  if (!runtime || runtime.gridWidth <= 0 || runtime.gridHeight <= 0) {
    return [];
  }
  const beastConfig = raidConfig.beasts || {};
  const minCount = Math.max(0, Number(beastConfig.min ?? 1));
  const maxCount = Math.max(minCount, Number(beastConfig.max ?? minCount));
  const perPop = Math.max(1, Number(beastConfig.perPop ?? 15));
  const population = Math.max(0, state.dwarves.length);
  let count = Math.round(population / perPop);
  count = clamp(count, minCount, maxCount);

  const beasts = [];
  for (let i = 0; i < count; i += 1) {
    beasts.push(spawnRaidBeast(state, runtime));
  }
  return beasts;
}

// Spawn a single raid beast on a map edge.
function spawnRaidBeast(state, runtime) {
  const side = RAID_SIDES[Math.floor(Math.random() * RAID_SIDES.length)];
  const pos = findEdgeWalkablePosition(state, runtime, side);
  if (pos) {
    return pos;
  }
  return findAnyWalkablePosition(state, runtime) || { x: 0, y: 0 };
}

// Move raid beasts randomly each tick.
function moveRaidBeasts(beasts, runtime, state, config) {
  if (!Array.isArray(beasts)) {
    return;
  }
  for (const beast of beasts) {
    moveDwarf(beast, runtime, state, config);
  }
}

// Resolve watchtower attacks against beasts during raids.
function applyWatchtowerAttacks(state, config, raidState) {
  if (!raidState || !raidState.active) {
    return;
  }
  const towerConfig = (config.structures && config.structures.watchtower) || {};
  const raidConfig = towerConfig.raid || {};
  const range = Math.max(0, Number(raidConfig.range ?? 0));
  const hitChance = clamp(Number(raidConfig.hitChance ?? 0), 0, 1);
  const maxKillsPerTick = Math.max(0, Number(raidConfig.maxKillsPerTick ?? 0));
  if (range <= 0 || hitChance <= 0 || maxKillsPerTick <= 0) {
    return;
  }

  const towers = (state.structures || []).filter((structure) => structure.type === 'watchtower');
  if (towers.length === 0) {
    return;
  }
  const beasts = Array.isArray(raidState.beasts) ? raidState.beasts : [];
  if (beasts.length === 0) {
    return;
  }

  let kills = 0;
  for (const tower of towers) {
    if (kills >= maxKillsPerTick || beasts.length === 0) {
      break;
    }
    let targetIndex = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < beasts.length; i += 1) {
      const beast = beasts[i];
      const distance = Math.abs(beast.x - tower.x) + Math.abs(beast.y - tower.y);
      if (distance <= range && distance < bestDistance) {
        bestDistance = distance;
        targetIndex = i;
        if (distance === 0) {
          break;
        }
      }
    }
    if (targetIndex < 0) {
      continue;
    }
    if (Math.random() <= hitChance) {
      beasts.splice(targetIndex, 1);
      kills += 1;
    }
  }

  raidState.beasts = beasts;
}

// Resolve raid difficulty value from config.
function getRaidDifficulty(config, state) {
  const aiConfig = (config && config.ai) || {};
  const value = Number(aiConfig.difficulty);
  const base = Number.isFinite(value) ? clamp(value, 0, 1) : 0.5;
  const multiplier = Number(state && state.endgameDifficulty || 1);
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    return base;
  }
  return clamp(base * multiplier, 0, 1);
}

// Linear interpolation helper for raid scaling.
function lerp(a, b, t) {
  return a + (b - a) * t;
}

module.exports = {
  updateRaidStart,
  updateRaidTick,
  isRaidSeasonEligible,
};
