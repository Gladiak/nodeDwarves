'use strict';

const { clamp } = require('../utils');
const { createInitialState } = require('../state');
const { carryMythsAcrossCycle } = require('./myths');

function getEndgameConfig(config) {
  return (config && config.endgame) || {};
}

function getEndgameMinTicks(endgame) {
  if (!endgame || typeof endgame !== 'object') {
    return 0;
  }
  if (Number.isFinite(endgame.minTicksAfterArtifacts)) {
    return Math.max(0, Number(endgame.minTicksAfterArtifacts));
  }
  return Math.max(0, Number(endgame.minStableTicks || 0));
}

function getCycleStats(state) {
  const stats = state && state.cycleStats ? state.cycleStats : null;
  return {
    count: Math.max(0, Number(stats && stats.count || 0)),
    lastTicks: Math.max(0, Number(stats && stats.lastTicks || 0)),
  };
}

function areAllArtifactsFound(config, state) {
  const ruinsConfig = (config && config.ruins) || {};
  if (ruinsConfig.enabled === false) {
    return false;
  }
  const pool = (ruinsConfig.artifacts && ruinsConfig.artifacts.pool) || {};
  const entries = Object.keys(pool);
  if (entries.length === 0) {
    return true;
  }
  const ruinsState = state && state.ruins ? state.ruins : null;
  if (!ruinsState) {
    return false;
  }
  const found = ruinsState.artifactsFound || {};
  for (const id of entries) {
    if (!found[id]) {
      return false;
    }
  }
  return true;
}

function ensureArtifactsCompletionTick(state) {
  if (!state) {
    return 0;
  }
  const existing = state.endgameArtifactsTick;
  if (Number.isFinite(existing) && existing >= 0) {
    return existing;
  }
  const now = Math.max(0, Number(state.tick || 0));
  state.endgameArtifactsTick = now;
  return now;
}

function clearArtifactsCompletionTick(state) {
  if (!state) {
    return;
  }
  state.endgameArtifactsTick = null;
}

function computeEndgameDifficultyMultiplier(state, config) {
  const endgame = getEndgameConfig(config);
  const difficulty = endgame.difficulty || {};
  if (difficulty.enabled === false) {
    return 1;
  }
  const perCycle = Math.max(0, Number(difficulty.perCycle || 0));
  if (perCycle <= 0) {
    return 1;
  }
  const maxMultiplier = Math.max(1, Number(difficulty.maxMultiplier || 1));
  const count = getCycleStats(state).count;
  return clamp(1 + count * perCycle, 1, maxMultiplier);
}

function updateEndgameDifficulty(state, config) {
  const multiplier = computeEndgameDifficultyMultiplier(state, config);
  if (state) {
    state.endgameDifficulty = multiplier;
  }
  return multiplier;
}

function shouldTriggerEndgameReset(state, config) {
  const endgame = getEndgameConfig(config);
  if (endgame.enabled === false) {
    return false;
  }
  if (!areAllArtifactsFound(config, state)) {
    clearArtifactsCompletionTick(state);
    return false;
  }
  const minTicks = getEndgameMinTicks(endgame);
  if (minTicks <= 0) {
    return true;
  }
  const completionTick = ensureArtifactsCompletionTick(state);
  return Number(state.tick || 0) - completionTick >= minTicks;
}

function resetStateInPlace(state, nextState) {
  for (const key of Object.keys(state)) {
    delete state[key];
  }
  Object.assign(state, nextState);
}

function runEndgameReset(state, config, runtime) {
  const endgame = getEndgameConfig(config);
  const resetPopulation = Math.max(0, Math.floor(Number(endgame.resetPopulation || 0)));
  const configOverride = resetPopulation > 0
    ? {
      ...config,
      dwarves: {
        ...(config.dwarves || {}),
        count: resetPopulation,
      },
    }
    : config;

  const nextState = createInitialState(configOverride, runtime);
  const stats = getCycleStats(state);
  carryMythsAcrossCycle(state, nextState, config);
  nextState.cycleStats = {
    count: stats.count + 1,
    lastTicks: Math.max(0, Number(state.tick || 0)),
  };
  nextState.lastDeathTick = 0;
  nextState.endgameArtifactsTick = null;
  updateEndgameDifficulty(nextState, config);
  resetStateInPlace(state, nextState);
}

function maybeHandleEndgameReset(state, config, runtime) {
  if (!shouldTriggerEndgameReset(state, config)) {
    return false;
  }
  runEndgameReset(state, config, runtime);
  return true;
}

module.exports = {
  computeEndgameDifficultyMultiplier,
  updateEndgameDifficulty,
  maybeHandleEndgameReset,
};
