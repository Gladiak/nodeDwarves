'use strict';

// World profile (STRATEGY.md S3d): every game draws its own economic character from config-driven
// ranges (`variety.ranges`), deterministically from the map seed, so no fixed posture is right for
// every game. Draws use a private PRNG seeded by the terrain seed: gameplay RNG, exports, training
// and benchmarks are untouched, and the same map always gets the same profile (paired evaluation).
// Factors enter the economy as the named `world` factor of the modifier ledger.

const PROFILE_KEYS = ['foodYield', 'waterYield', 'winterYield', 'needDecay', 'raidChance'];

// Small deterministic generator, private to the profile draw.
function profileRandom(seed) {
  let t = (Number(seed) ^ 0x5eedc0de) >>> 0;
  return function next() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Read one [min, max] range; invalid or missing ranges give a neutral factor.
function readRange(ranges, key) {
  const raw = ranges && ranges[key];
  if (!Array.isArray(raw) || raw.length !== 2) {
    return [1, 1];
  }
  const low = Number(raw[0]);
  const high = Number(raw[1]);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high < low) {
    return [1, 1];
  }
  return [low, high];
}

// Draw the profile for one map seed, or null when variety is disabled.
function createWorldProfile(config, seed) {
  const variety = (config && config.variety) || {};
  if (variety.enabled !== true) {
    return null;
  }
  const random = profileRandom(seed);
  const factors = {};
  for (const key of PROFILE_KEYS) {
    const [low, high] = readRange(variety.ranges, key);
    factors[key] = Math.round((low + (high - low) * random()) * 1000) / 1000;
  }
  return { seed: Number(seed) >>> 0, factors };
}

// Read one profile factor; 1 without a profile.
function getWorldFactor(state, key) {
  const profile = state && state.worldProfile;
  const value = profile && profile.factors ? Number(profile.factors[key]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : 1;
}

// Gather-yield factor for a resource: its own yield factor, times the winter factor in winter.
function getWorldYieldFactor(state, resourceId) {
  let factor = 1;
  if (resourceId === 'food') factor *= getWorldFactor(state, 'foodYield');
  if (resourceId === 'water') factor *= getWorldFactor(state, 'waterYield');
  if (state && state.season && state.season.name === 'winter') {
    factor *= getWorldFactor(state, 'winterYield');
  }
  return factor;
}

module.exports = { PROFILE_KEYS, createWorldProfile, getWorldFactor, getWorldYieldFactor };
