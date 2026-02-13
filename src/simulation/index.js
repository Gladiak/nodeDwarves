'use strict';

const { updateSeason, getSeasonModifier } = require('./season');
const { updateWeather, getWeatherModifier, getWeatherNeedMultipliers } = require('./weather');
const { updateRaidStart, updateRaidTick } = require('./raids');
const { updateFestivals, getFestivalModifier } = require('./festivals');
const { updateWildlifeStart, updateWildlifeTick, updatePastureBirths } = require('./wildlife');
const { getClanEffects } = require('../clans');
const { updateContracts } = require('./contracts');
const {
  advanceAge,
  applyNeedDecay,
  consumeResources,
  updateDerivedState,
  handleDeaths,
  updateRelationships,
  handleReproduction,
  assignHousing,
  cohouseCouples,
  getWinterHousingPenalty,
} = require('./population');
const { updateBrewmasters, updateRoles } = require('./roles');
const { assignJobs } = require('./jobs');
const { processDwarfAction } = require('./dwarf_actions');
const { updateMerchant } = require('./merchant');
const { updateHouseStorage, regenerateNodes, applyStockpileDecay } = require('./resources');
const { tickTerrainCooldowns } = require('./terrain');
const { updateRuins } = require('./ruins');
const { updateEndgameDifficulty, maybeHandleEndgameReset } = require('./endgame');
const { updateMyths, getMythMultiplier } = require('./myths');
const { updateAlchemy, getAlchemyMultiplier } = require('./alchemy');
const { updateTemple, getTempleNeedDecayMultiplier } = require('./temple');
const { updateSchism, getSchismModifier } = require('./schism');
const { updateVillages } = require('./villages');
const { updateRoads } = require('./roads');
const { updateUnderrealm } = require('./underrealm');
const { updateWorldEvents, getWorldEventModifier } = require('./world_events');
const { clamp } = require('../utils');

const BUILD_CLASS_ORDER = ['housing', 'economy', 'defense', 'special'];

// Advance the simulation by one tick.
function stepState(state, config, runtime, action, options = {}) {
  const resolvedAction = normalizeActionEnvelope(action);
  state.lastGovernorSignals = buildGovernorSignals(config, resolvedAction);
  state.lastConfig = config;
  state.tick += 1;
  const endgameDifficulty = updateEndgameDifficulty(state, config);
  updateSeason(state, config);
  updateWeather(state, config);
  updateRaidStart(state, config, runtime);
  updateWorldEvents(state, config, runtime, resolvedAction);
  updateSchism(state, config);
  updateFestivals(state, config, runtime, resolvedAction);
  updateContracts(state, config, runtime);
  updateAlchemy(state, config);
  updateTemple(state, config, runtime);
  updateWildlifeStart(state, config, runtime);
  const housingPenalty = getWinterHousingPenalty(state, config);
  const weatherNeedMultiplier = getWeatherModifier(state, config, 'needDecay', 1);
  const weatherNeedByNeed = getWeatherNeedMultipliers(state, config);
  const mythNeedMultiplier = getMythMultiplier(state, config, 'needDecay', 1);
  const alchemyNeedMultiplier = getAlchemyMultiplier(state, config, 'needDecay', 1);
  const worldNeedMultiplier = getWorldEventModifier(state, 'needDecay', 1);
  const festivalNeedMultiplier = getFestivalModifier(state, 'needDecay', 1);
  const templeNeedMultiplier = getTempleNeedDecayMultiplier(state, config);
  const schismNeedMultiplier = getSchismModifier(state, 'needDecay', 1);
  const stormColdActive = state.weather
    ? state.weather.type === 'storm' || state.weather.type === 'cold'
    : false;

  for (const dwarf of state.dwarves) {
    const clanEffects = getClanEffects(config, dwarf.clanId);
    const stormColdBonus = Math.max(0, Number(clanEffects.storm_cold_need_decay_bonus || 0));
    const clanNeedMultiplier = stormColdActive && stormColdBonus > 0
      ? 1 + stormColdBonus
      : 1;
    advanceAge(dwarf, config);
    applyNeedDecay(
      dwarf,
      config.needs.decayPerTick || {},
      getSeasonModifier(state, 'needDecay', 1)
        * housingPenalty.needDecay
        * weatherNeedMultiplier
        * endgameDifficulty
        * clanNeedMultiplier
        * mythNeedMultiplier
        * alchemyNeedMultiplier
        * worldNeedMultiplier
        * festivalNeedMultiplier
        * templeNeedMultiplier
        * schismNeedMultiplier,
      weatherNeedByNeed,
    );
    consumeResources(dwarf, state, config);
    updateDerivedState(dwarf);
  }

  handleDeaths(state, config);
  updateBrewmasters(state, config);
  updateRoles(state, config);
  updateUnderrealm(state, config);
  updateRuins(state, config, runtime);
  assignHousing(state, config);
  updateRelationships(state, config);
  cohouseCouples(state, config);
  handleReproduction(state, config);
  updateVillages(state, config, runtime);
  updateRoads(state, config, runtime);

  state.lastPriorities = [];
  assignJobs(state, config, runtime, resolvedAction);
  state.lastDecisionTrace = buildDecisionTrace(state);

  for (const dwarf of state.dwarves) {
    processDwarfAction(dwarf, state, config, runtime);
  }

  updateMerchant(state, config, runtime, resolvedAction);
  applyStockpileDecay(state, config);
  tickTerrainCooldowns(state);
  updateHouseStorage(state, config);
  regenerateNodes(state, config);
  updateRaidTick(state, config, runtime);
  updateWildlifeTick(state, config, runtime);
  updatePastureBirths(state, config);
  updateMyths(state, config);
  if (!options.suppressEndgameReset) {
    maybeHandleEndgameReset(state, config, runtime);
  }
}

// Normalize incoming AI action to governor envelope with legacy fallback.
function normalizeActionEnvelope(action) {
  if (!action || typeof action !== 'object') {
    return null;
  }

  const normalized = {};
  const jobsSource = action.jobs && typeof action.jobs === 'object' ? action.jobs : null;
  const jobsWeights = resolveJobsWeights(action, jobsSource);

  if (jobsSource) {
    normalized.jobs = { ...jobsSource };
  }
  if (jobsWeights) {
    const weights = { ...jobsWeights };
    normalized.jobs = normalized.jobs || {};
    normalized.jobs.weights = weights;
    normalized.weights = { ...weights };
  } else if (normalized.jobs && Object.prototype.hasOwnProperty.call(normalized.jobs, 'weights')) {
    delete normalized.jobs.weights;
  }

  if (Object.prototype.hasOwnProperty.call(action, 'festivalIntent')) {
    normalized.festivalIntent = action.festivalIntent;
  }
  if (action.trade && typeof action.trade === 'object') {
    normalized.trade = { ...action.trade };
  }
  if (action.building && typeof action.building === 'object') {
    normalized.building = { ...action.building };
  }

  if (normalized.jobs && Object.keys(normalized.jobs).length === 0) {
    delete normalized.jobs;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

// Resolve jobs weights from envelope or legacy action fields.
function resolveJobsWeights(action, jobsSource) {
  const jobsWeights = jobsSource && jobsSource.weights && typeof jobsSource.weights === 'object'
    ? jobsSource.weights
    : null;
  if (jobsWeights && Object.keys(jobsWeights).length > 0) {
    return jobsWeights;
  }

  const legacyWeights = action.weights && typeof action.weights === 'object'
    ? action.weights
    : null;
  if (legacyWeights && Object.keys(legacyWeights).length > 0) {
    return legacyWeights;
  }

  return null;
}

// Build compact governor telemetry signals from action envelope + config defaults.
function buildGovernorSignals(config, action) {
  return {
    jobs: buildJobsGovernorSignals(config, action),
    trade: buildTradeGovernorSignals(config, action),
    building: buildBuildingGovernorSignals(config, action),
  };
}

// Build jobs-governor telemetry summary.
function buildJobsGovernorSignals(config, action) {
  const aiConfig = (config && config.ai) || {};
  const minWeight = Number(aiConfig.minWeight ?? 0);
  const maxWeight = Number(aiConfig.maxWeight ?? 2);
  const defaults = aiConfig.defaultWeights && typeof aiConfig.defaultWeights === 'object'
    ? aiConfig.defaultWeights
    : {};
  const jobs = action && action.jobs && typeof action.jobs === 'object' ? action.jobs : null;
  const rawWeights = resolveJobsWeights(action || {}, jobs) || defaults;
  const source = rawWeights === defaults ? 'default' : 'action';
  const entries = Object.entries(rawWeights)
    .map(([resource, value]) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return null;
      }
      const clamped = maxWeight > minWeight
        ? clamp(numeric, minWeight, maxWeight)
        : numeric;
      return {
        resource: String(resource || ''),
        weight: clamped,
      };
    })
    .filter(Boolean)
    .filter((entry) => entry.resource.length > 0);
  entries.sort((left, right) => {
    if (right.weight !== left.weight) {
      return right.weight - left.weight;
    }
    return left.resource.localeCompare(right.resource);
  });
  return {
    source,
    entries,
    top: entries.slice(0, 2),
  };
}

// Build trade-governor telemetry summary.
function buildTradeGovernorSignals(config, action) {
  const aiConfig = (config && config.ai) || {};
  const governors = aiConfig.governors && typeof aiConfig.governors === 'object'
    ? aiConfig.governors
    : {};
  const tradeConfig = governors.trade && typeof governors.trade === 'object'
    ? governors.trade
    : {};
  const enabled = tradeConfig.enabled !== false;
  const tradeAction = action && action.trade && typeof action.trade === 'object'
    ? action.trade
    : null;
  const reserveRatioBiasMax = clamp(Number(tradeConfig.reserveRatioBiasMax ?? 0), 0, 1);
  const reserveRatioBias = enabled && tradeAction && Object.prototype.hasOwnProperty.call(tradeAction, 'reserveRatioBias')
    ? clamp(
      normalizeSignedIntent(tradeAction.reserveRatioBias, config) * reserveRatioBiasMax,
      -reserveRatioBiasMax,
      reserveRatioBiasMax,
    )
    : 0;
  return {
    enabled,
    source: tradeAction ? 'action' : 'default',
    reserveRatioBias,
    contestIntent: enabled && tradeAction && Object.prototype.hasOwnProperty.call(tradeAction, 'contestIntent')
      ? normalizeIntent(tradeAction.contestIntent, config, 1)
      : 1,
    opportunityIntent: enabled && tradeAction && Object.prototype.hasOwnProperty.call(tradeAction, 'opportunityIntent')
      ? normalizeIntent(tradeAction.opportunityIntent, config, 1)
      : 1,
  };
}

// Build building-governor telemetry summary.
function buildBuildingGovernorSignals(config, action) {
  const aiConfig = (config && config.ai) || {};
  const minWeight = Number(aiConfig.minWeight ?? 0);
  const maxWeight = Number(aiConfig.maxWeight ?? 2);
  const fallbackWeight = maxWeight > minWeight
    ? clamp(1, minWeight, maxWeight)
    : 1;
  const governors = aiConfig.governors && typeof aiConfig.governors === 'object'
    ? aiConfig.governors
    : {};
  const buildingConfig = governors.building && typeof governors.building === 'object'
    ? governors.building
    : {};
  const defaults = buildingConfig.defaultWeights && typeof buildingConfig.defaultWeights === 'object'
    ? buildingConfig.defaultWeights
    : {};
  const enabled = buildingConfig.enabled !== false;
  const buildingAction = action && action.building && typeof action.building === 'object'
    ? action.building
    : null;
  const weights = {
    housing: clampGovernorWeight(defaults.housing, minWeight, maxWeight, fallbackWeight),
    economy: clampGovernorWeight(defaults.economy, minWeight, maxWeight, fallbackWeight),
    defense: clampGovernorWeight(defaults.defense, minWeight, maxWeight, fallbackWeight),
    special: clampGovernorWeight(defaults.special, minWeight, maxWeight, fallbackWeight),
  };
  if (enabled && buildingAction) {
    weights.housing = clampGovernorWeight(
      buildingAction.housingWeight,
      minWeight,
      maxWeight,
      weights.housing,
    );
    weights.economy = clampGovernorWeight(
      buildingAction.economyWeight,
      minWeight,
      maxWeight,
      weights.economy,
    );
    weights.defense = clampGovernorWeight(
      buildingAction.defenseWeight,
      minWeight,
      maxWeight,
      weights.defense,
    );
    weights.special = clampGovernorWeight(
      buildingAction.specialWeight,
      minWeight,
      maxWeight,
      weights.special,
    );
  }
  const classOrder = BUILD_CLASS_ORDER
    .slice()
    .sort((left, right) => {
      const leftWeight = Number(weights[left] || 0);
      const rightWeight = Number(weights[right] || 0);
      if (rightWeight !== leftWeight) {
        return rightWeight - leftWeight;
      }
      return BUILD_CLASS_ORDER.indexOf(left) - BUILD_CLASS_ORDER.indexOf(right);
    });
  const mineBiasMax = clamp(Number(buildingConfig.mineBiasMax ?? 0), 0, 1);
  const upgradeBiasMax = clamp(Number(buildingConfig.upgradeBiasMax ?? 0), 0, 1);
  const mineBias = enabled && buildingAction && Object.prototype.hasOwnProperty.call(buildingAction, 'mineBias')
    ? clamp(
      normalizeSignedIntent(buildingAction.mineBias, config) * mineBiasMax,
      -mineBiasMax,
      mineBiasMax,
    )
    : 0;
  const upgradeBias = enabled && buildingAction && Object.prototype.hasOwnProperty.call(buildingAction, 'upgradeBias')
    ? clamp(
      normalizeSignedIntent(buildingAction.upgradeBias, config) * upgradeBiasMax,
      -upgradeBiasMax,
      upgradeBiasMax,
    )
    : 0;
  return {
    enabled,
    source: buildingAction ? 'action' : 'default',
    weights,
    classOrder,
    mineBias,
    upgradeBias,
  };
}

// Normalize governor intent into 0..1 based on global AI action scaling.
function normalizeIntent(value, config, fallback) {
  const aiConfig = (config && config.ai) || {};
  const minWeight = Number(aiConfig.minWeight ?? 0);
  const maxWeight = Number(aiConfig.maxWeight ?? 1);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return clamp(Number(fallback || 0), 0, 1);
  }
  if (maxWeight > minWeight) {
    return clamp((numeric - minWeight) / (maxWeight - minWeight), 0, 1);
  }
  return clamp(numeric, 0, 1);
}

// Normalize governor intent into -1..1.
function normalizeSignedIntent(value, config) {
  return clamp(normalizeIntent(value, config, 0.5) * 2 - 1, -1, 1);
}

// Clamp one governor class weight to configured AI ranges.
function clampGovernorWeight(value, minWeight, maxWeight, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  if (maxWeight > minWeight) {
    return clamp(numeric, minWeight, maxWeight);
  }
  return fallback;
}

// Build a compact decision trace used by telemetry explainability rows.
function buildDecisionTrace(state) {
  const shortagesRaw = Array.isArray(state && state.lastPriorities) ? state.lastPriorities : [];
  const shortages = shortagesRaw.slice(0, 3).map((entry) => ({
    resource: String(entry && entry.resource || ''),
    score: Number(entry && entry.score || 0),
    ratio: clamp(Number(entry && entry.ratio || 0), 0, 1),
    missing: Math.max(0, Number(entry && entry.missing || 0)),
    current: Math.max(0, Number(entry && entry.current || 0)),
    target: Math.max(0, Number(entry && entry.target || 0)),
    weight: Math.max(0, Number(entry && entry.weight || 0)),
    baseWeight: Math.max(0, Number(entry && entry.baseWeight || 0)),
    boostApplied: entry && entry.boostApplied === true,
    boostSeverity: clamp(Number(entry && entry.boostSeverity || 0), 0, 1),
    boostMultiplier: Math.max(1, Number(entry && entry.boostMultiplier || 1)),
  })).filter((entry) => entry.resource.length > 0);

  const governorSignals = state && state.lastGovernorSignals && typeof state.lastGovernorSignals === 'object'
    ? state.lastGovernorSignals
    : {};
  const jobsGovernor = governorSignals.jobs && typeof governorSignals.jobs === 'object'
    ? governorSignals.jobs
    : {};
  const tradeGovernor = governorSignals.trade && typeof governorSignals.trade === 'object'
    ? governorSignals.trade
    : {};
  const buildingGovernor = governorSignals.building && typeof governorSignals.building === 'object'
    ? governorSignals.building
    : {};
  const jobs = Array.isArray(state && state.jobs) ? state.jobs : [];
  const jobsByType = {};
  for (const job of jobs) {
    const type = String(job && job.type || 'other');
    jobsByType[type] = Number(jobsByType[type] || 0) + 1;
  }
  const worldEvent = state && state.worldEvents && state.worldEvents.active
    ? state.worldEvents.active
    : null;
  const tick = Math.max(0, Number(state && state.tick || 0));
  const worldEventTicksLeft = worldEvent
    ? Math.max(
      0,
      Number(worldEvent.expiresAt || 0) > 0
        ? Number(worldEvent.expiresAt || 0) - tick
        : Number(worldEvent.ticksRemaining || 0),
    )
    : 0;
  const context = {
    weather: state && state.weather && state.weather.type ? String(state.weather.type) : 'clear',
    raidActive: Boolean(state && state.raid && state.raid.active === true),
    raidTicksLeft: Math.max(0, Number(state && state.raid && state.raid.ticksRemaining || 0)),
    worldEventActive: Boolean(worldEvent),
    worldEventLabel: worldEvent && worldEvent.label ? String(worldEvent.label) : '',
    worldEventPhase: worldEvent && worldEvent.phase ? String(worldEvent.phase) : '',
    worldEventTicksLeft,
    festivalActive: Boolean(state && state.festival && state.festival.active === true),
    contractActive: Boolean(state && state.contracts && state.contracts.active === true),
  };

  return {
    tick,
    governors: {
      jobsSource: jobsGovernor.source === 'action' ? 'action' : 'default',
      tradeSource: tradeGovernor.source === 'action' ? 'action' : 'default',
      buildingSource: buildingGovernor.source === 'action' ? 'action' : 'default',
      jobsTop: Array.isArray(jobsGovernor.top)
        ? jobsGovernor.top.slice(0, 2).map((entry) => ({
          resource: String(entry && entry.resource || ''),
          weight: Math.max(0, Number(entry && entry.weight || 0)),
        })).filter((entry) => entry.resource.length > 0)
        : [],
      buildingClassOrder: Array.isArray(buildingGovernor.classOrder)
        ? buildingGovernor.classOrder.slice(0, 4).map((name) => String(name || '')).filter(Boolean)
        : [],
      tradeReserveBias: Number(tradeGovernor.reserveRatioBias || 0),
      tradeContestIntent: clamp(Number(tradeGovernor.contestIntent || 0), 0, 1),
      tradeOpportunityIntent: clamp(Number(tradeGovernor.opportunityIntent || 0), 0, 1),
      buildMineBias: Number(buildingGovernor.mineBias || 0),
      buildUpgradeBias: Number(buildingGovernor.upgradeBias || 0),
    },
    shortages,
    jobs: {
      total: jobs.length,
      byType: jobsByType,
    },
    context,
    drivers: buildDecisionDrivers(shortages, context, governorSignals),
  };
}

// Build ranked decision drivers so telemetry can explain top pressures quickly.
function buildDecisionDrivers(shortages, context, governorSignals) {
  const drivers = [];
  const shortageList = Array.isArray(shortages) ? shortages : [];
  for (const shortage of shortageList) {
    const resource = String(shortage && shortage.resource || '');
    if (!resource) {
      continue;
    }
    drivers.push({
      key: `shortage:${resource}`,
      label: `Shortage ${resource}`,
      kind: 'shortage',
      score: Math.max(0, Number(shortage && shortage.score || 0)),
    });
  }

  const weatherType = context && context.weather ? String(context.weather) : 'clear';
  const weatherScore = scoreWeatherPressure(weatherType);
  if (weatherScore > 0) {
    drivers.push({
      key: `weather:${weatherType}`,
      label: `Weather ${weatherType}`,
      kind: 'weather',
      score: weatherScore,
    });
  }

  if (context && context.raidActive) {
    const ticksLeft = Math.max(0, Number(context.raidTicksLeft || 0));
    drivers.push({
      key: 'raid:active',
      label: ticksLeft > 0 ? `Raid active (${ticksLeft}t left)` : 'Raid active',
      kind: 'raid',
      score: 1,
    });
  }

  if (context && context.worldEventActive) {
    const label = String(context.worldEventLabel || 'World event');
    drivers.push({
      key: 'world_event:active',
      label,
      kind: 'world_event',
      score: 0.7,
    });
  }

  const signals = governorSignals && typeof governorSignals === 'object' ? governorSignals : {};
  const jobsSource = signals.jobs && signals.jobs.source === 'action';
  const tradeSource = signals.trade && signals.trade.source === 'action';
  const buildingSource = signals.building && signals.building.source === 'action';
  const actionDrivenCount = Number(jobsSource) + Number(tradeSource) + Number(buildingSource);
  if (actionDrivenCount > 0) {
    drivers.push({
      key: 'governor:action',
      label: `Policy action envelope (${actionDrivenCount}/3)`,
      kind: 'policy',
      score: 0.45 + actionDrivenCount * 0.1,
    });
  }

  return drivers
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
    .slice(0, 4);
}

// Score weather pressure for explainability ranking.
function scoreWeatherPressure(type) {
  const key = String(type || 'clear');
  if (key === 'storm') {
    return 0.9;
  }
  if (key === 'drought') {
    return 0.85;
  }
  if (key === 'cold') {
    return 0.8;
  }
  if (key === 'rain') {
    return 0.35;
  }
  return 0;
}

module.exports = { stepState };
