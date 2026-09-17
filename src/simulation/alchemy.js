'use strict';

const { clamp } = require('../utils');
const {
  buildResourceConsequences,
  buildSecondaryActor,
  buildSettlementActor,
  emitSecondaryEvent,
} = require('./secondary_events');

// Build a new alchemy state container.
function createAlchemyState() {
  return {
    active: null,
    backlash: null,
    cooldownTicks: 0,
    history: [],
    stats: {
      activations: 0,
      stableCompletions: 0,
      backlashes: 0,
    },
  };
}

// Resolve the alchemy config block.
function getAlchemyConfig(config) {
  return (config && config.alchemy) || {};
}

// Ensure alchemy state exists and is normalized.
function ensureAlchemyState(state, config) {
  const alchemyConfig = getAlchemyConfig(config);
  if (alchemyConfig.enabled === false) {
    if (state) {
      state.alchemy = null;
    }
    return null;
  }
  if (!state.alchemy || typeof state.alchemy !== 'object') {
    state.alchemy = createAlchemyState();
  }
  const alchemy = state.alchemy;
  if (!Array.isArray(alchemy.history)) {
    alchemy.history = [];
  }
  if (!alchemy.stats || typeof alchemy.stats !== 'object') {
    alchemy.stats = {
      activations: 0,
      stableCompletions: 0,
      backlashes: 0,
    };
  }
  if (!Number.isFinite(Number(alchemy.cooldownTicks))) {
    alchemy.cooldownTicks = 0;
  }
  if (alchemy.active && typeof alchemy.active !== 'object') {
    alchemy.active = null;
  }
  if (alchemy.backlash && typeof alchemy.backlash !== 'object') {
    alchemy.backlash = null;
  }
  return alchemy;
}

// Update alchemy lifecycle each tick (backlash, pact expiry, activation).
function updateAlchemy(state, config) {
  const alchemyConfig = getAlchemyConfig(config);
  if (alchemyConfig.enabled === false) {
    if (state) {
      state.alchemy = null;
    }
    return;
  }
  if (!state) {
    return;
  }
  const alchemy = ensureAlchemyState(state, config);
  if (!alchemy) {
    return;
  }

  const tick = Math.max(0, Number(state.tick || 0));

  expireBacklash(state, config, alchemy, tick);
  if (expireActivePact(state, config, alchemy, tick, alchemyConfig)) {
    return;
  }
  if (alchemy.active || alchemy.backlash) {
    return;
  }

  const cooldown = Math.max(0, Math.floor(Number(alchemy.cooldownTicks || 0)));
  if (cooldown > 0) {
    alchemy.cooldownTicks = cooldown - 1;
    return;
  }

  const nextFormula = selectFormula(state, config, alchemyConfig);
  if (!nextFormula) {
    return;
  }
  activateFormula(state, config, alchemy, tick, nextFormula);
}

function expireBacklash(state, config, alchemy, tick) {
  const backlash = alchemy.backlash;
  if (!backlash) {
    return;
  }
  const endsTick = Number(backlash.endsTick || 0);
  if (endsTick > 0 && tick >= endsTick) {
    emitAlchemyEvent(
      state,
      config,
      backlash,
      'backlash_faded',
      `Alchemy backlash faded: ${backlash.label || 'Arcane Debt'}`,
    );
    alchemy.backlash = null;
  }
}

function expireActivePact(state, config, alchemy, tick, alchemyConfig) {
  const active = alchemy.active;
  if (!active) {
    return false;
  }
  const endsTick = Number(active.endsTick || 0);
  if (endsTick <= 0 || tick < endsTick) {
    return false;
  }

  const failuresDuringPact = getRuinsFailuresSince(state, active);
  const failureThreshold = Math.max(0, Number(active.failureThreshold || 0));
  const shouldBacklash = failureThreshold > 0 && failuresDuringPact >= failureThreshold;
  const cooldownTicks = Math.max(0, Math.floor(Number(active.cooldownTicks || 0)));
  alchemy.active = null;
  alchemy.cooldownTicks = Math.max(Number(alchemy.cooldownTicks || 0), cooldownTicks);

  if (shouldBacklash) {
    applyBacklash(state, config, alchemy, tick, active.backlash || {});
  } else {
    alchemy.stats.stableCompletions = Number(alchemy.stats.stableCompletions || 0) + 1;
    emitAlchemyEvent(
      state,
      config,
      active,
      'rite_ended',
      `Alchemy rite ended: ${active.label || active.id || 'Rite'}`,
    );
  }

  addHistory(alchemy, {
    type: 'end',
    id: active.id || null,
    label: active.label || active.id || 'rite',
    tick,
    failures: failuresDuringPact,
    backlash: shouldBacklash,
  }, alchemyConfig);
  return true;
}

function applyBacklash(state, config, alchemy, tick, backlashConfig) {
  const ratio = clamp(Number(backlashConfig.resourceLossRatio || 0), 0, 1);
  const resources = Array.isArray(backlashConfig.lossResources)
    ? backlashConfig.lossResources.filter((resource) => typeof resource === 'string' && resource.length > 0)
    : [];
  const losses = [];
  const lossAmounts = {};

  if (ratio > 0 && resources.length > 0 && state && state.stockpile) {
    for (const resource of resources) {
      const current = Math.max(0, Number(state.stockpile[resource] || 0));
      if (current <= 0) {
        continue;
      }
      const lost = Math.max(0, Math.floor(current * ratio));
      if (lost <= 0) {
        continue;
      }
      state.stockpile[resource] = current - lost;
      losses.push(`${resource} -${lost}`);
      lossAmounts[resource] = lost;
    }
  }

  const durationTicks = Math.max(1, Math.floor(Number(backlashConfig.durationTicks || 1)));
  const label = backlashConfig.label || 'Debt of the Ancients';
  alchemy.backlash = {
    id: backlashConfig.id || 'debt_of_the_ancients',
    label,
    startedTick: tick,
    endsTick: tick + durationTicks,
    durationTicks,
    effects: normalizeEffectMap(backlashConfig.effects || {}),
    outputBonus: normalizeOutputBonus(backlashConfig.outputBonus),
  };
  alchemy.stats.backlashes = Number(alchemy.stats.backlashes || 0) + 1;

  emitAlchemyEvent(state, config, alchemy.backlash, 'backlash_started', `Alchemy backlash: ${label}`);
  if (losses.length > 0) {
    emitAlchemyEvent(
      state,
      config,
      alchemy.backlash,
      'backlash_losses',
      `Backlash losses: ${losses.join(', ')}`,
      buildResourceConsequences(lossAmounts, -1),
    );
  }
}

function activateFormula(state, config, alchemy, tick, selection) {
  const { id, formula } = selection;
  const label = formula.label || id;
  const durationTicks = Math.max(1, Math.floor(Number(formula.durationTicks || 1)));
  const inputs = normalizeCostMap(formula.inputs || {});
  if (Object.keys(inputs).length > 0) {
    consumeInputs(state.stockpile, inputs);
  }

  const backlash = normalizeBacklashConfig(formula.backlash || {});
  const cooldownTicks = Math.max(0, Math.floor(Number(formula.cooldownTicks || 0)));
  const active = {
    id,
    label,
    startedTick: tick,
    endsTick: tick + durationTicks,
    durationTicks,
    cooldownTicks,
    effects: normalizeEffectMap(formula.effects || {}),
    outputBonus: normalizeOutputBonus(formula.outputBonus),
    failureThreshold: Math.max(0, Number(backlash.failureThreshold || 0)),
    ruinsFailuresStart: getRuinsFailures(state),
    backlash,
  };
  alchemy.active = active;
  alchemy.stats.activations = Number(alchemy.stats.activations || 0) + 1;

  const failureLabel = active.failureThreshold > 0
    ? ` (backlash at ${active.failureThreshold} failures)`
    : '';
  emitAlchemyEvent(
    state,
    config,
    active,
    'rite_started',
    `Alchemy rite started: ${label}${failureLabel}`,
    buildResourceConsequences(inputs, -1),
  );
}

// Emit an alchemy rite/backlash fact with the formula snapshot retained as an institution actor.
function emitAlchemyEvent(state, config, subject, phase, message, consequences = null) {
  const subjectId = String(subject && subject.id || 'alchemy_rite');
  const label = String(subject && subject.label || subjectId);
  return emitSecondaryEvent(state, config, {
    type: `alchemy.${phase}`,
    category: 'myth',
    message,
    actors: [
      buildSecondaryActor('institution', subjectId, 'primary', label),
      buildSettlementActor(phase.includes('backlash') ? 'victim' : 'beneficiary'),
    ],
    causes: [{
      kind: phase.includes('started') ? 'action' : 'threshold',
      ref: `alchemy.${phase}`,
      metric: 'duration_ticks',
      value: Math.max(0, Number(subject && subject.durationTicks || 0)),
    }],
    consequences: consequences || [{
      kind: 'status',
      targetKind: 'institution',
      targetId: subjectId,
      metric: 'phase',
      value: phase,
      unit: null,
    }],
    source: 'alchemy',
    tags: ['alchemy', phase, subjectId],
  });
}

function selectFormula(state, config, alchemyConfig) {
  const formulas = resolveFormulas(alchemyConfig);
  for (const entry of formulas) {
    if (isFormulaEligible(state, config, entry.formula)) {
      return entry;
    }
  }
  return null;
}

function resolveFormulas(alchemyConfig) {
  const formulas = alchemyConfig && typeof alchemyConfig.formulas === 'object'
    ? alchemyConfig.formulas
    : {};
  const entries = [];
  for (const [id, formula] of Object.entries(formulas)) {
    if (!formula || typeof formula !== 'object') {
      continue;
    }
    if (formula.enabled === false) {
      continue;
    }
    const priority = Number(formula.priority || 0);
    entries.push({ id, priority, formula });
  }
  entries.sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    return a.id.localeCompare(b.id);
  });
  return entries;
}

function isFormulaEligible(state, config, formula) {
  if (!state || !formula) {
    return false;
  }
  if (!hasRequiredStructures(state, formula)) {
    return false;
  }
  if (formula.blockDuringRaid !== false && state.raid && state.raid.active) {
    return false;
  }

  const minPopulation = Math.max(0, Number(formula.minPopulation || 0));
  if (minPopulation > 0) {
    const population = Array.isArray(state.dwarves) ? state.dwarves.length : 0;
    if (population < minPopulation) {
      return false;
    }
  }

  if (formula.requiresUnfoundArtifacts === true && !hasUnfoundArtifacts(state, config)) {
    return false;
  }

  const inputs = normalizeCostMap(formula.inputs || {});
  if (Object.keys(inputs).length > 0 && !hasInputs(state.stockpile || {}, inputs)) {
    return false;
  }

  const minStockpileRatios = formula.minStockpileRatios || {};
  for (const [resource, ratioRaw] of Object.entries(minStockpileRatios)) {
    const requiredRatio = clamp(Number(ratioRaw || 0), 0, 1);
    if (requiredRatio <= 0) {
      continue;
    }
    if (getStockpileRatio(state, config, resource) < requiredRatio) {
      return false;
    }
  }

  return true;
}

function hasRequiredStructures(state, formula) {
  const required = Array.isArray(formula.requiredStructures) && formula.requiredStructures.length > 0
    ? formula.requiredStructures
    : ['alchemy_lab'];
  for (const type of required) {
    if (!hasStructure(state, type)) {
      return false;
    }
  }
  return true;
}

function hasUnfoundArtifacts(state, config) {
  const ruinsConfig = (config && config.ruins) || {};
  const pool = ruinsConfig && ruinsConfig.artifacts && ruinsConfig.artifacts.pool
    ? ruinsConfig.artifacts.pool
    : {};
  const total = Object.keys(pool).length;
  if (total <= 0) {
    return false;
  }
  const foundMap = state && state.ruins && state.ruins.artifactsFound
    ? state.ruins.artifactsFound
    : {};
  const found = Object.keys(foundMap).length;
  return found < total;
}

function hasStructure(state, type) {
  if (!state || !Array.isArray(state.structures) || !type) {
    return false;
  }
  return state.structures.some((structure) => structure && structure.type === type);
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

function normalizeCostMap(cost) {
  const normalized = {};
  if (!cost || typeof cost !== 'object') {
    return normalized;
  }
  for (const [resource, amount] of Object.entries(cost)) {
    const numeric = Number(amount || 0);
    if (Number.isFinite(numeric) && numeric > 0) {
      normalized[resource] = numeric;
    }
  }
  return normalized;
}

function normalizeEffectMap(effects) {
  const normalized = {};
  if (!effects || typeof effects !== 'object') {
    return normalized;
  }
  for (const [key, value] of Object.entries(effects)) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      normalized[key] = numeric;
    }
  }
  return normalized;
}

function normalizeOutputBonus(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return numeric;
}

function normalizeBacklashConfig(backlash) {
  if (!backlash || typeof backlash !== 'object') {
    return {
      failureThreshold: 0,
      durationTicks: 0,
      resourceLossRatio: 0,
      lossResources: [],
      effects: {},
      outputBonus: 0,
      label: 'Debt of the Ancients',
    };
  }
  return {
    id: backlash.id || 'debt_of_the_ancients',
    label: backlash.label || 'Debt of the Ancients',
    failureThreshold: Math.max(0, Math.floor(Number(backlash.failureThreshold || 0))),
    durationTicks: Math.max(0, Math.floor(Number(backlash.durationTicks || 0))),
    resourceLossRatio: clamp(Number(backlash.resourceLossRatio || 0), 0, 1),
    lossResources: Array.isArray(backlash.lossResources)
      ? backlash.lossResources.filter((resource) => typeof resource === 'string' && resource.length > 0)
      : [],
    effects: normalizeEffectMap(backlash.effects || {}),
    outputBonus: normalizeOutputBonus(backlash.outputBonus),
  };
}

function getRuinsFailures(state) {
  const ruins = state && state.ruins;
  const stats = ruins && ruins.stats;
  return Math.max(0, Number(stats && stats.failures || 0));
}

function getRuinsFailuresSince(state, active) {
  if (!active) {
    return 0;
  }
  const current = getRuinsFailures(state);
  const start = Math.max(0, Number(active.ruinsFailuresStart || 0));
  return Math.max(0, current - start);
}

function addHistory(alchemy, entry, alchemyConfig) {
  if (!alchemy || !entry) {
    return;
  }
  alchemy.history.push(entry);
  const historyLimit = Math.max(0, Math.floor(Number(alchemyConfig.historyLimit || 0)));
  if (historyLimit > 0 && alchemy.history.length > historyLimit) {
    alchemy.history = alchemy.history.slice(alchemy.history.length - historyLimit);
  }
}

// Compute a multiplier from active alchemy and active backlash.
function getAlchemyMultiplier(state, config, key, fallback) {
  const safeFallback = Number(fallback || 1);
  const alchemyConfig = getAlchemyConfig(config);
  if (!state || !state.alchemy || alchemyConfig.enabled === false) {
    return safeFallback;
  }
  let multiplier = safeFallback;
  const active = state.alchemy.active;
  const backlash = state.alchemy.backlash;
  if (active && active.effects && active.effects[key] !== undefined) {
    multiplier *= Number(active.effects[key] || 1);
  }
  if (backlash && backlash.effects && backlash.effects[key] !== undefined) {
    multiplier *= Number(backlash.effects[key] || 1);
  }
  return multiplier;
}

// Compute the additive output bonus from active alchemy/backlash.
function getAlchemyOutputBonus(state, config) {
  const alchemyConfig = getAlchemyConfig(config);
  if (!state || !state.alchemy || alchemyConfig.enabled === false) {
    return 0;
  }
  let bonus = 0;
  const active = state.alchemy.active;
  const backlash = state.alchemy.backlash;
  if (active) {
    bonus += Number(active.outputBonus || 0);
    if (active.effects && Number.isFinite(Number(active.effects.outputBonus))) {
      bonus += Number(active.effects.outputBonus);
    }
  }
  if (backlash) {
    bonus += Number(backlash.outputBonus || 0);
    if (backlash.effects && Number.isFinite(Number(backlash.effects.outputBonus))) {
      bonus += Number(backlash.effects.outputBonus);
    }
  }
  if (!Number.isFinite(bonus)) {
    return 0;
  }
  return clamp(bonus, -0.95, 5);
}

// Return telemetry-friendly alchemy status.
function getAlchemyStatus(state, config) {
  const alchemyConfig = getAlchemyConfig(config);
  if (!state || !state.alchemy || alchemyConfig.enabled === false) {
    return null;
  }
  const tick = Math.max(0, Number(state.tick || 0));
  const active = state.alchemy.active;
  if (active) {
    const endsTick = Math.max(0, Number(active.endsTick || 0));
    const ticksLeft = endsTick > 0 ? Math.max(0, endsTick - tick) : 0;
    const failures = getRuinsFailuresSince(state, active);
    return {
      mode: 'active',
      label: active.label || active.id || 'Rite',
      ticksLeft,
      durationTicks: Math.max(1, Number(active.durationTicks || 1)),
      failures,
      failureThreshold: Math.max(0, Number(active.failureThreshold || 0)),
    };
  }
  const backlash = state.alchemy.backlash;
  if (backlash) {
    const endsTick = Math.max(0, Number(backlash.endsTick || 0));
    const ticksLeft = endsTick > 0 ? Math.max(0, endsTick - tick) : 0;
    return {
      mode: 'backlash',
      label: backlash.label || 'Arcane Debt',
      ticksLeft,
      durationTicks: Math.max(1, Number(backlash.durationTicks || 1)),
    };
  }
  const cooldownTicks = Math.max(0, Number(state.alchemy.cooldownTicks || 0));
  if (cooldownTicks > 0) {
    return {
      mode: 'cooldown',
      ticksLeft: cooldownTicks,
    };
  }
  return null;
}

// Compute target stockpile amount for ratio checks.
function getStockpileTarget(state, config, resourceId) {
  const resources = (config && config.resources) || {};
  const scaledTargets = state && state.resourceTargets ? state.resourceTargets : null;
  const targets = scaledTargets || resources.targets || resources.stockpile || {};
  const baseTarget = Math.max(0, Number(targets[resourceId] || 0));
  const perCapitaConfig = resources.targetsPerCapita || {};
  const perCapita = Math.max(0, Number(perCapitaConfig[resourceId] || 0));
  if (perCapita <= 0) {
    return baseTarget;
  }
  const population = Array.isArray(state && state.dwarves) ? state.dwarves.length : 0;
  return Math.max(0, baseTarget + perCapita * population);
}

// Compute a stockpile ratio for eligibility checks.
function getStockpileRatio(state, config, resourceId) {
  const target = getStockpileTarget(state, config, resourceId);
  if (target <= 0) {
    return 1;
  }
  const current = Number(state.stockpile && state.stockpile[resourceId] || 0);
  return clamp(current / target, 0, 1);
}

module.exports = {
  createAlchemyState,
  updateAlchemy,
  getAlchemyMultiplier,
  getAlchemyOutputBonus,
  getAlchemyStatus,
};
