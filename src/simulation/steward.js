'use strict';

// Steward: the colony council's rule-based posture when no AI policy decides (STRATEGY.md S2).
// Every `decisionTicks` it judges whether the colony is safe (food and water in store per dwarf and
// population above thresholds). `restrainedGroups` stay at their minimum in every posture;
// `cautiousGroups` are switched off only while the colony is at risk, so labor and food stay home.
// It only fills action groups the caller did not provide, so a trained policy keeps full control of
// its own heads. Posture changes that alter what the council holds back become council decrees.
// Deterministic and RNG-free; its last decision lives in `state.steward` for saves and reports.

const { emitSecondaryEvent, buildSecondaryActor, buildSettlementActor } = require('./secondary_events');

const GROUPS = ['festivalIntent', 'trade', 'building', 'contracts', 'ruins', 'underrealm', 'externalCamps',
  'social', 'warriors'];
const GROUP_FIELDS = {
  trade: ['reserveRatioBias', 'contestIntent', 'opportunityIntent'],
  building: ['housingWeight', 'economyWeight', 'defenseWeight', 'specialWeight', 'mineBias', 'upgradeBias'],
  contracts: ['commitIntent'],
  ruins: ['warningDispatchIntent', 'mithrilReinforcementIntent'],
  underrealm: ['surfaceReserveBias', 'depthAllocationBias', 'minerMixBias', 'haulerMixBias', 'guardMixBias'],
  externalCamps: ['militiaSupportIntent', 'raiderTributeIntent'],
  social: ['mediationBias', 'mentorshipBias', 'accountabilityBias'],
  warriors: ['trainingIntent', 'rotationIntent', 'tournamentRiskIntent', 'championChallengeIntent',
    'recoveryPriorityIntent'],
};

// Resolve steward settings from `ai.steward` with explicit defaults.
function getStewardSettings(config) {
  const raw = (config && config.ai && config.ai.steward) || {};
  const pick = (list, fallback) => (Array.isArray(list) ? list.filter((g) => GROUPS.includes(g)) : fallback);
  return {
    enabled: raw.enabled === true,
    decisionTicks: Math.max(1, Math.floor(Number(raw.decisionTicks ?? 20))),
    safeReservePerCapita: Math.max(0, Number(raw.safeReservePerCapita ?? 2)),
    safeMinPopulation: Math.max(0, Number(raw.safeMinPopulation ?? 30)),
    cautiousGroups: pick(raw.cautiousGroups, GROUPS),
    restrainedGroups: pick(raw.restrainedGroups, []),
  };
}

// Judge the colony posture from food/water in store per dwarf and population.
function judgePosture(state, settings) {
  const population = Array.isArray(state.dwarves) ? state.dwarves.length : 0;
  const stock = state.stockpile || {};
  const perCapita = population > 0
    ? Math.min(Number(stock.food || 0), Number(stock.water || 0)) / population
    : 0;
  if (population < settings.safeMinPopulation) {
    return { posture: 'cautious', reason: 'small_population', population, reservePerCapita: perCapita };
  }
  if (perCapita < settings.safeReservePerCapita) {
    return { posture: 'cautious', reason: 'low_reserves', population, reservePerCapita: perCapita };
  }
  return { posture: 'open', reason: 'reserves_secure', population, reservePerCapita: perCapita };
}

// Build the action groups set to their minimum: every field of each listed group at 0.
function buildMinimumGroups(groups) {
  const action = {};
  for (const group of groups) {
    if (group === 'festivalIntent') {
      action.festivalIntent = 0;
      continue;
    }
    action[group] = Object.fromEntries(GROUP_FIELDS[group].map((field) => [field, 0]));
  }
  return action;
}

// Update the council decision when due and merge it under the caller's action.
function applySteward(state, config, action) {
  const settings = getStewardSettings(config);
  if (!settings.enabled) {
    return action;
  }
  const result = applyStewardGroups(state, config, action, settings);
  recordDecisionSources(state, action, result);
  return result;
}

// Record who decided each action group this tick: policy, council (steward) or engine default.
function recordDecisionSources(state, action, result) {
  const source = action && typeof action === 'object' ? action : {};
  const merged = result && typeof result === 'object' ? result : {};
  const counts = { policy: 0, council: 0, default: 0 };
  for (const group of ['weights', ...GROUPS]) {
    const fromPolicy = group === 'weights'
      ? Boolean(source.weights || (source.jobs && source.jobs.weights))
      : Object.prototype.hasOwnProperty.call(source, group);
    if (fromPolicy) counts.policy += 1;
    else if (Object.prototype.hasOwnProperty.call(merged, group)) counts.council += 1;
    else counts.default += 1;
  }
  if (state.steward) {
    state.steward.sources = counts;
  }
}

// Decide the posture when due and merge the council groups under the caller's action.
function applyStewardGroups(state, config, action, settings) {
  const previous = state.steward && typeof state.steward === 'object' ? state.steward : null;
  const due = !previous || !Number.isFinite(previous.decidedTick)
    || Number(state.tick || 0) - previous.decidedTick >= settings.decisionTicks;
  if (due) {
    const judged = judgePosture(state, settings);
    state.steward = {
      posture: judged.posture,
      reason: judged.reason,
      reservePerCapita: Math.round(judged.reservePerCapita * 100) / 100,
      population: judged.population,
      decidedTick: Number(state.tick || 0),
      changedTick: previous && previous.posture === judged.posture ? previous.changedTick : Number(state.tick || 0),
      changes: Number(previous && previous.changes || 0) + (previous && previous.posture !== judged.posture ? 1 : 0),
      threshold: settings.safeReservePerCapita,
      restrained: settings.restrainedGroups.length,
      cautious: settings.cautiousGroups.length,
    };
    if (previous && previous.posture !== judged.posture && settings.cautiousGroups.length > 0) {
      emitCouncilDecree(state, config, state.steward, settings);
    }
  }
  const groups = state.steward.posture === 'cautious'
    ? [...new Set([...settings.restrainedGroups, ...settings.cautiousGroups])]
    : settings.restrainedGroups;
  if (groups.length === 0) {
    return action;
  }
  const source = action && typeof action === 'object' ? action : {};
  const merged = { ...source };
  for (const [group, value] of Object.entries(buildMinimumGroups(groups))) {
    if (!Object.prototype.hasOwnProperty.call(source, group)) {
      merged[group] = value;
    }
  }
  return merged;
}

// Announce a posture change as a council decree in the Event Log.
function emitCouncilDecree(state, config, steward, settings) {
  const reserve = steward.reservePerCapita.toFixed(1);
  const message = steward.posture === 'cautious'
    ? `Council turns cautious: ${reserve} food and water per dwarf (needs ${settings.safeReservePerCapita}); risky ventures paused`
    : `Council reopens the frontier: reserves secure at ${reserve} per dwarf`;
  return emitSecondaryEvent(state, config, {
    type: 'council.posture_changed',
    category: 'economy',
    message,
    actors: [
      buildSecondaryActor('institution', 'colony_council', 'primary', 'Colony Council'),
      buildSettlementActor('beneficiary'),
    ],
    causes: [{ kind: 'threshold', ref: 'steward.reserve_per_capita', metric: 'reserve_per_capita',
      value: steward.reservePerCapita }],
    consequences: [{ kind: 'status', targetKind: 'institution', targetId: 'colony_council', metric: 'posture',
      value: steward.posture, unit: null }],
    source: 'steward',
    tags: ['council', steward.posture, steward.reason],
  });
}

module.exports = { applySteward, getStewardSettings, judgePosture };
