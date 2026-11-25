'use strict';

// Modifier ledger (STRATEGY.md R3): one place where narrative and environment systems change the
// core economy. Gather yield, need decay and birth chance are each a base value times named factors.
// `composeModifiers` multiplies in the caller's order (so results stay bit-identical to the inline
// products it replaced), optionally bounds the combined multiplier with
// `simulation.modifierBounds.<quantity>`, and records the latest breakdown in `state.modifierLedger`
// for the Colony Report. No RNG, no gameplay state besides the ledger record.

// Resolve configured bounds for one quantity; missing bounds leave the product untouched.
function getModifierBounds(config, quantity) {
  const all = config && config.simulation && config.simulation.modifierBounds;
  const raw = all && typeof all === 'object' ? all[quantity] : null;
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const min = Number(raw.min);
  const max = Number(raw.max);
  if (!Number.isFinite(min) && !Number.isFinite(max)) {
    return null;
  }
  return { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : Infinity };
}

// Multiply `base` by each [name, value] factor in order and return the result. With bounds, the
// combined multiplier is clamped first and the result is base x bounded multiplier.
// `detail` (optional) lists finer factors to record instead of `factors` (not multiplied).
function composeModifiers(state, config, quantity, key, base, factors, detail = null) {
  let product = base;
  let multiplier = 1;
  for (let index = 0; index < factors.length; index += 1) {
    const value = factors[index][1];
    product *= value;
    multiplier *= value;
  }
  const bounds = getModifierBounds(config, quantity);
  let bounded = multiplier;
  if (bounds) {
    bounded = Math.min(bounds.max, Math.max(bounds.min, multiplier));
    if (bounded !== multiplier) {
      product = base * bounded;
    }
  }
  if (state && key) {
    recordModifiers(state, quantity, key, detail || factors, multiplier, bounded);
  }
  return product;
}

// Keep the latest breakdown per quantity and key (bounded: a handful of entries).
function recordModifiers(state, quantity, key, factors, multiplier, bounded) {
  const ledger = state.modifierLedger && typeof state.modifierLedger === 'object' ? state.modifierLedger : {};
  state.modifierLedger = ledger;
  const bucket = ledger[quantity] && typeof ledger[quantity] === 'object' ? ledger[quantity] : {};
  ledger[quantity] = bucket;
  const entry = bucket[key] && typeof bucket[key] === 'object' ? bucket[key] : { factors: {} };
  for (const [name, value] of factors) {
    entry.factors[name] = value;
  }
  entry.multiplier = multiplier;
  entry.bounded = bounded;
  entry.tick = Number(state.tick || 0);
  bucket[key] = entry;
}

// List the factors that move a recorded quantity, strongest first, for plain-language reports.
function describeModifiers(state, quantity, key, limit = 3) {
  const entry = state && state.modifierLedger && state.modifierLedger[quantity]
    && state.modifierLedger[quantity][key];
  if (!entry) {
    return null;
  }
  const movers = Object.entries(entry.factors)
    .filter(([, value]) => Number.isFinite(value) && Math.abs(value - 1) >= 0.01)
    .sort((a, b) => Math.abs(Math.log(b[1])) - Math.abs(Math.log(a[1])))
    .slice(0, limit);
  return { multiplier: entry.bounded, raw: entry.multiplier, movers };
}

module.exports = { composeModifiers, describeModifiers, getModifierBounds };
