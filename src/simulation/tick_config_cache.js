'use strict';

// Per-tick memo for pure config normalizers.
// The cache is active only inside stepState, so in-place config edits made between
// ticks (tests, validators, scenario tooling) always take effect on the next tick.
// Cached values are deep-frozen: an accidental caller-side mutation throws in strict
// mode instead of silently leaking into later lookups in the same tick.

let scopeDepth = 0;
let generation = 0;
const cachesByConfig = new WeakMap();

// Open one tick scope; nested scopes share the outer generation.
function enterTickConfigScope() {
  if (scopeDepth === 0) {
    generation += 1;
  }
  scopeDepth += 1;
}

// Close one tick scope.
function exitTickConfigScope() {
  scopeDepth = Math.max(0, scopeDepth - 1);
}

// Run fn inside a tick scope and always close it.
function withTickConfigScope(fn) {
  enterTickConfigScope();
  try {
    return fn();
  } finally {
    exitTickConfigScope();
  }
}

// True while a stepState tick scope is open.
function isTickConfigScopeActive() {
  return scopeDepth > 0;
}

// Recursively freeze plain objects and arrays.
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);
  }
  return value;
}

// Return compute() memoized per (config, key, source identity) for the current tick.
function memoizeTickConfig(key, config, source, compute) {
  if (scopeDepth === 0 || !config || typeof config !== 'object') {
    return compute();
  }
  let perConfig = cachesByConfig.get(config);
  if (!perConfig) {
    perConfig = new Map();
    cachesByConfig.set(config, perConfig);
  }
  const entry = perConfig.get(key);
  if (entry && entry.generation === generation && entry.source === source) {
    return entry.value;
  }
  const value = deepFreeze(compute());
  perConfig.set(key, { generation, source, value });
  return value;
}

module.exports = {
  enterTickConfigScope,
  exitTickConfigScope,
  withTickConfigScope,
  isTickConfigScopeActive,
  memoizeTickConfig,
};
