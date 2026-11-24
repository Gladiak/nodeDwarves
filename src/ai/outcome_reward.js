'use strict';

// Compact outcome-tied reward (redesign R1). Six explainable terms, all read from simulation state:
//   population  + weight x population / populationScale        (sustained colony size, every step)
//   deaths      - weight x avoidable deaths this step         (starvation, raids, deep raids, ruins,
//                                                               hunts, Warrior League; not old age)
//   distress    - weight x share of dwarves with hunger or thirst >= distressThreshold
//   reserves    + weight x min over food/water of stock / (reservePerCapita x population), capped at 1
//   progress    + depthWeight per Underrealm depth unlocked, landmarkWeight per landmark stage built,
//                 prestigeWeight x prestige gained
//   extinction  - weight once, when the last dwarf dies
// Weights live in `ai.reward`. Pure functions: no RNG, no state writes. Used by ai_server.js.

const AVOIDABLE_CAUSES = ['starvation', 'raid', 'deepRaid', 'ruins', 'hunt', 'warriorLeague'];

const DEFAULTS = {
  population: 1,
  populationScale: 100,
  deaths: 2,
  distress: 1,
  distressThreshold: 0.6,
  reserves: 0.3,
  reservePerCapita: 2,
  depth: 20,
  landmarkStage: 5,
  prestige: 0.2,
  extinction: 20,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

// Resolve reward weights from `ai.reward`, falling back to documented defaults.
function getOutcomeRewardSettings(config) {
  const raw = (config && config.ai && config.ai.reward) || {};
  const settings = {};
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const value = Number(raw[key]);
    settings[key] = Number.isFinite(value) ? value : fallback;
  }
  settings.populationScale = Math.max(1, settings.populationScale);
  settings.reservePerCapita = Math.max(0, settings.reservePerCapita);
  return settings;
}

// Read the cumulative signals the reward compares between two steps.
function computeOutcomeSignals(state, config) {
  const settings = getOutcomeRewardSettings(config);
  const dwarves = Array.isArray(state && state.dwarves) ? state.dwarves : [];
  const population = dwarves.length;
  let distressed = 0;
  for (const dwarf of dwarves) {
    const needs = dwarf.needs || {};
    if (num(needs.hunger) >= settings.distressThreshold || num(needs.thirst) >= settings.distressThreshold) {
      distressed += 1;
    }
  }
  const causes = (state && state.deathsByCause) || {};
  const avoidableDeaths = AVOIDABLE_CAUSES.reduce((sum, cause) => sum + Math.max(0, num(causes[cause])), 0);
  const stockpile = (state && state.stockpile) || {};
  let reserve = 1;
  if (settings.reservePerCapita > 0 && population > 0) {
    const need = settings.reservePerCapita * population;
    reserve = Math.min(clamp(num(stockpile.food) / need, 0, 1), clamp(num(stockpile.water) / need, 0, 1));
  }
  return {
    population,
    distressShare: population > 0 ? distressed / population : 0,
    avoidableDeaths,
    reserve,
    depth: Math.max(0, Math.floor(num(state && state.underrealm && state.underrealm.maxUnlockedDepth))),
    landmarkStages: Math.max(0, num(state && state.landmarks && state.landmarks.stats
      && state.landmarks.stats.stagesBuilt)),
    prestige: Math.max(0, num(state && state.prestige && state.prestige.total)),
  };
}

// Positive progress since the previous step; counters that reset (new cycle) count from zero.
function counterDelta(current, previous) {
  if (current >= previous) return current - previous;
  return current;
}

// Reward for one decision step plus a per-term breakdown for diagnostics.
function computeOutcomeReward(previous, current, config) {
  const settings = getOutcomeRewardSettings(config);
  const prev = previous || current;
  const terms = {
    population: settings.population * (current.population / settings.populationScale),
    deaths: -settings.deaths * counterDelta(current.avoidableDeaths, prev.avoidableDeaths),
    distress: -settings.distress * current.distressShare,
    reserves: current.population > 0 ? settings.reserves * current.reserve : 0,
    progress: settings.depth * counterDelta(current.depth, prev.depth)
      + settings.landmarkStage * counterDelta(current.landmarkStages, prev.landmarkStages)
      + settings.prestige * counterDelta(current.prestige, prev.prestige),
    extinction: current.population === 0 && prev.population > 0 ? -settings.extinction : 0,
  };
  const total = Object.values(terms).reduce((sum, value) => sum + value, 0);
  return { total, terms };
}

module.exports = {
  AVOIDABLE_CAUSES,
  getOutcomeRewardSettings,
  computeOutcomeSignals,
  computeOutcomeReward,
};
