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
const { updateSocialDrama } = require('./social_drama');
const { updateVillages } = require('./villages');
const { updateRoads } = require('./roads');
const { updateUnderrealm } = require('./underrealm');
const { updateWarriors } = require('./warriors');
const { updateWorldEvents, getWorldEventModifier } = require('./world_events');
const { updateExternalCamps } = require('./external_camps');
const { ensureSettlementFoundingEvent } = require('./lifecycle_events');
const { advanceStoryDirector } = require('./story_director');
const { clamp } = require('../utils');

const BUILD_CLASS_ORDER = ['housing', 'economy', 'defense', 'special'];

// Advance the simulation by one tick.
function stepState(state, config, runtime, action, options = {}) {
  ensureSettlementFoundingEvent(state, config);
  const resolvedAction = normalizeActionEnvelope(action);
  state.lastGovernorSignals = buildGovernorSignals(config, resolvedAction);
  state.lastConfig = config;
  state.tick += 1;
  advanceStoryDirector(state, config);
  const endgameDifficulty = updateEndgameDifficulty(state, config);
  updateSeason(state, config);
  updateWarriors(state, config, resolvedAction);
  updateWeather(state, config);
  updateRaidStart(state, config, runtime);
  updateWorldEvents(state, config, runtime, resolvedAction);
  updateExternalCamps(state, config, runtime, resolvedAction);
  updateSchism(state, config);
  updateFestivals(state, config, runtime, resolvedAction);
  updateContracts(state, config, resolvedAction);
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
  updateUnderrealm(state, config, resolvedAction);
  updateRuins(state, config, runtime, resolvedAction);
  assignHousing(state, config);
  updateRelationships(state, config);
  updateSocialDrama(state, config, resolvedAction);
  cohouseCouples(state, config);
  handleReproduction(state, config);
  updateVillages(state, config, runtime);
  updateRoads(state, config, runtime);

  state.lastPriorities = [];
  assignJobs(state, config, runtime, resolvedAction);
  state.lastDecisionTrace = buildDecisionTrace(state, config);

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
  if (action.contracts && typeof action.contracts === 'object') {
    normalized.contracts = { ...action.contracts };
  }
  if (action.ruins && typeof action.ruins === 'object') {
    normalized.ruins = { ...action.ruins };
  }
  if (action.underrealm && typeof action.underrealm === 'object') {
    normalized.underrealm = { ...action.underrealm };
  }
  if (action.externalCamps && typeof action.externalCamps === 'object') {
    normalized.externalCamps = { ...action.externalCamps };
  }
  if (action.social && typeof action.social === 'object') {
    normalized.social = { ...action.social };
  }
  if (action.warriors && typeof action.warriors === 'object') {
    normalized.warriors = { ...action.warriors };
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
    contracts: buildContractsGovernorSignals(config, action),
    ruins: buildRuinsGovernorSignals(config, action),
    underrealm: buildUnderrealmGovernorSignals(config, action),
    externalCamps: buildExternalCampsGovernorSignals(config, action),
    social: buildSocialGovernorSignals(config, action),
    warriors: buildWarriorsGovernorSignals(config, action),
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

// Build contracts-governor telemetry summary.
function buildContractsGovernorSignals(config, action) {
  const aiConfig = (config && config.ai) || {};
  const governors = aiConfig.governors && typeof aiConfig.governors === 'object'
    ? aiConfig.governors
    : {};
  const contractsConfig = governors.contracts && typeof governors.contracts === 'object'
    ? governors.contracts
    : {};
  const enabled = contractsConfig.enabled !== false;
  const contractsAction = action && action.contracts && typeof action.contracts === 'object'
    ? action.contracts
    : null;
  return {
    enabled,
    source: contractsAction ? 'action' : 'default',
    commitIntent: enabled
      && contractsAction
      && Object.prototype.hasOwnProperty.call(contractsAction, 'commitIntent')
      ? normalizeIntent(contractsAction.commitIntent, config, 1)
      : 1,
  };
}

// Build ruins-governor telemetry summary.
function buildRuinsGovernorSignals(config, action) {
  const aiConfig = (config && config.ai) || {};
  const governors = aiConfig.governors && typeof aiConfig.governors === 'object'
    ? aiConfig.governors
    : {};
  const ruinsConfig = governors.ruins && typeof governors.ruins === 'object'
    ? governors.ruins
    : {};
  const enabled = ruinsConfig.enabled !== false;
  const ruinsAction = action && action.ruins && typeof action.ruins === 'object'
    ? action.ruins
    : null;
  return {
    enabled,
    source: ruinsAction ? 'action' : 'default',
    warningDispatchIntent: enabled
      && ruinsAction
      && Object.prototype.hasOwnProperty.call(ruinsAction, 'warningDispatchIntent')
      ? normalizeIntent(ruinsAction.warningDispatchIntent, config, 1)
      : 1,
    mithrilReinforcementIntent: enabled
      && ruinsAction
      && Object.prototype.hasOwnProperty.call(ruinsAction, 'mithrilReinforcementIntent')
      ? normalizeIntent(ruinsAction.mithrilReinforcementIntent, config, 1)
      : 1,
  };
}

// Build underrealm-governor telemetry summary.
function buildUnderrealmGovernorSignals(config, action) {
  const aiConfig = (config && config.ai) || {};
  const governors = aiConfig.governors && typeof aiConfig.governors === 'object'
    ? aiConfig.governors
    : {};
  const underrealmConfig = governors.underrealm && typeof governors.underrealm === 'object'
    ? governors.underrealm
    : {};
  const enabled = underrealmConfig.enabled !== false;
  const underrealmAction = action && action.underrealm && typeof action.underrealm === 'object'
    ? action.underrealm
    : null;
  return {
    enabled,
    source: underrealmAction ? 'action' : 'default',
    surfaceReserveBias: enabled
      && underrealmAction
      && Object.prototype.hasOwnProperty.call(underrealmAction, 'surfaceReserveBias')
      ? normalizeSignedIntent(underrealmAction.surfaceReserveBias, config)
      : 0,
    depthAllocationBias: enabled
      && underrealmAction
      && Object.prototype.hasOwnProperty.call(underrealmAction, 'depthAllocationBias')
      ? normalizeSignedIntent(underrealmAction.depthAllocationBias, config)
      : 0,
    minerMixBias: enabled
      && underrealmAction
      && Object.prototype.hasOwnProperty.call(underrealmAction, 'minerMixBias')
      ? normalizeSignedIntent(underrealmAction.minerMixBias, config)
      : 0,
    haulerMixBias: enabled
      && underrealmAction
      && Object.prototype.hasOwnProperty.call(underrealmAction, 'haulerMixBias')
      ? normalizeSignedIntent(underrealmAction.haulerMixBias, config)
      : 0,
    guardMixBias: enabled
      && underrealmAction
      && Object.prototype.hasOwnProperty.call(underrealmAction, 'guardMixBias')
      ? normalizeSignedIntent(underrealmAction.guardMixBias, config)
      : 0,
  };
}

// Build external-camps-governor telemetry summary.
function buildExternalCampsGovernorSignals(config, action) {
  const aiConfig = (config && config.ai) || {};
  const governors = aiConfig.governors && typeof aiConfig.governors === 'object'
    ? aiConfig.governors
    : {};
  const externalCampsConfig = governors.externalCamps && typeof governors.externalCamps === 'object'
    ? governors.externalCamps
    : {};
  const enabled = externalCampsConfig.enabled !== false;
  const externalCampsAction = action && action.externalCamps && typeof action.externalCamps === 'object'
    ? action.externalCamps
    : null;
  return {
    enabled,
    source: externalCampsAction ? 'action' : 'default',
    militiaSupportIntent: enabled
      && externalCampsAction
      && Object.prototype.hasOwnProperty.call(externalCampsAction, 'militiaSupportIntent')
      ? normalizeIntent(externalCampsAction.militiaSupportIntent, config, 1)
      : 1,
    raiderTributeIntent: enabled
      && externalCampsAction
      && Object.prototype.hasOwnProperty.call(externalCampsAction, 'raiderTributeIntent')
      ? normalizeIntent(externalCampsAction.raiderTributeIntent, config, 1)
      : 1,
  };
}

// Build social-governor telemetry summary.
function buildSocialGovernorSignals(config, action) {
  const aiConfig = (config && config.ai) || {};
  const governors = aiConfig.governors && typeof aiConfig.governors === 'object'
    ? aiConfig.governors
    : {};
  const socialConfig = governors.social && typeof governors.social === 'object'
    ? governors.social
    : {};
  const enabled = socialConfig.enabled !== false;
  const socialAction = action && action.social && typeof action.social === 'object'
    ? action.social
    : null;
  const mediationBiasMax = clamp(Number(socialConfig.mediationBiasMax ?? 0), 0, 1);
  const mentorshipBiasMax = clamp(Number(socialConfig.mentorshipBiasMax ?? 0), 0, 1);
  const accountabilityBiasMax = clamp(Number(socialConfig.accountabilityBiasMax ?? 0), 0, 1);
  const mediationBias = enabled && socialAction && Object.prototype.hasOwnProperty.call(socialAction, 'mediationBias')
    ? clamp(
      normalizeSignedIntent(socialAction.mediationBias, config) * mediationBiasMax,
      -mediationBiasMax,
      mediationBiasMax,
    )
    : 0;
  const mentorshipBias = enabled && socialAction && Object.prototype.hasOwnProperty.call(socialAction, 'mentorshipBias')
    ? clamp(
      normalizeSignedIntent(socialAction.mentorshipBias, config) * mentorshipBiasMax,
      -mentorshipBiasMax,
      mentorshipBiasMax,
    )
    : 0;
  const accountabilityBias = enabled && socialAction && Object.prototype.hasOwnProperty.call(socialAction, 'accountabilityBias')
    ? clamp(
      normalizeSignedIntent(socialAction.accountabilityBias, config) * accountabilityBiasMax,
      -accountabilityBiasMax,
      accountabilityBiasMax,
    )
    : 0;
  return {
    enabled,
    source: socialAction ? 'action' : 'default',
    mediationBias,
    mentorshipBias,
    accountabilityBias,
  };
}

// Build warriors-governor telemetry summary.
function buildWarriorsGovernorSignals(config, action) {
  const aiConfig = (config && config.ai) || {};
  const governors = aiConfig.governors && typeof aiConfig.governors === 'object'
    ? aiConfig.governors
    : {};
  const warriorsConfig = governors.warriors && typeof governors.warriors === 'object'
    ? governors.warriors
    : {};
  const enabled = warriorsConfig.enabled !== false;
  const warriorsAction = action && action.warriors && typeof action.warriors === 'object'
    ? action.warriors
    : null;
  const hasIntent = (field) => Boolean(
    enabled
      && warriorsAction
      && Object.prototype.hasOwnProperty.call(warriorsAction, field),
  );
  const intentOrFallback = (field) => (hasIntent(field)
    ? normalizeIntent(warriorsAction[field], config, 1)
    : 1);
  const trainingIntent = intentOrFallback('trainingIntent');
  const rotationIntent = intentOrFallback('rotationIntent');
  const tournamentRiskIntent = intentOrFallback('tournamentRiskIntent');
  const championChallengeIntent = intentOrFallback('championChallengeIntent');
  const recoveryPriorityIntent = intentOrFallback('recoveryPriorityIntent');
  const trainingIntentThreshold = clamp(Number(warriorsConfig.trainingIntentThreshold ?? 0.5), 0, 1);
  const rotationIntentThreshold = clamp(Number(warriorsConfig.rotationIntentThreshold ?? 0.5), 0, 1);
  const tournamentRiskIntentThreshold = clamp(
    Number(warriorsConfig.tournamentRiskIntentThreshold ?? 0.5),
    0,
    1,
  );
  const championChallengeIntentThreshold = clamp(
    Number(warriorsConfig.championChallengeIntentThreshold ?? 0.5),
    0,
    1,
  );
  const recoveryPriorityIntentThreshold = clamp(
    Number(warriorsConfig.recoveryPriorityIntentThreshold ?? 0.5),
    0,
    1,
  );
  const dominantIntent = [
    { id: 'training', value: trainingIntent },
    { id: 'rotation', value: rotationIntent },
    { id: 'tournamentRisk', value: tournamentRiskIntent },
    { id: 'championChallenge', value: championChallengeIntent },
    { id: 'recoveryPriority', value: recoveryPriorityIntent },
  ]
    .sort((left, right) => {
      if (right.value !== left.value) {
        return right.value - left.value;
      }
      return left.id.localeCompare(right.id);
    })[0].id;
  return {
    enabled,
    source: warriorsAction ? 'action' : 'default',
    trainingIntent,
    rotationIntent,
    tournamentRiskIntent,
    championChallengeIntent,
    recoveryPriorityIntent,
    trainingIntentThreshold,
    rotationIntentThreshold,
    tournamentRiskIntentThreshold,
    championChallengeIntentThreshold,
    recoveryPriorityIntentThreshold,
    trainingApplied: enabled && trainingIntent >= trainingIntentThreshold,
    rotationApplied: enabled && rotationIntent >= rotationIntentThreshold,
    tournamentRiskApplied: enabled && tournamentRiskIntent >= tournamentRiskIntentThreshold,
    championChallengeApplied: enabled && championChallengeIntent >= championChallengeIntentThreshold,
    recoveryPriorityApplied: enabled && recoveryPriorityIntent >= recoveryPriorityIntentThreshold,
    dominantIntent,
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
function buildDecisionTrace(state, config) {
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
  const contractsGovernor = governorSignals.contracts && typeof governorSignals.contracts === 'object'
    ? governorSignals.contracts
    : {};
  const ruinsGovernor = governorSignals.ruins && typeof governorSignals.ruins === 'object'
    ? governorSignals.ruins
    : {};
  const underrealmGovernor = governorSignals.underrealm && typeof governorSignals.underrealm === 'object'
    ? governorSignals.underrealm
    : {};
  const externalCampsGovernor = governorSignals.externalCamps && typeof governorSignals.externalCamps === 'object'
    ? governorSignals.externalCamps
    : {};
  const socialGovernor = governorSignals.social && typeof governorSignals.social === 'object'
    ? governorSignals.social
    : {};
  const warriorsGovernor = governorSignals.warriors && typeof governorSignals.warriors === 'object'
    ? governorSignals.warriors
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
  const socialConfig = config && config.population && config.population.socialDrama
    ? config.population.socialDrama
    : {};
  const social = state && state.social && typeof state.social === 'object'
    ? state.social
    : null;
  const socialEnabled = Boolean(
    social
    && social.enabled === true
    && socialConfig.enabled !== false,
  );
  const incidentsConfig = socialConfig && socialConfig.incidents && typeof socialConfig.incidents === 'object'
    ? socialConfig.incidents
    : {};
  const socialIntervalTicks = Math.max(
    1,
    Number(incidentsConfig.intervalTicks || socialConfig.tickInterval || 12),
  );
  const socialRecencyWindow = Math.max(1, socialIntervalTicks * 4);
  const socialLastIncidentTick = socialEnabled
    ? Math.max(0, Number(social.lastIncidentTick || 0))
    : 0;
  const socialIncidentRecency = socialEnabled && socialLastIncidentTick > 0
    ? clamp(1 - Math.max(0, tick - socialLastIncidentTick) / socialRecencyWindow, 0, 1)
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
    socialCohesion: socialEnabled ? clamp(Number(social.cohesion || 0), 0, 1) : 0,
    socialConflictPressure: socialEnabled ? clamp(Number(social.conflictPressure || 0), 0, 1) : 0,
    socialMentorshipCoverage: socialEnabled ? clamp(Number(social.mentorshipCoverage || 0), 0, 1) : 0,
    socialGrudgeLoad: socialEnabled ? clamp(Number(social.grudgeLoad || 0), 0, 1) : 0,
    socialIncidentRecency,
  };

  return {
    tick,
    governors: {
      jobsSource: jobsGovernor.source === 'action' ? 'action' : 'default',
      tradeSource: tradeGovernor.source === 'action' ? 'action' : 'default',
      buildingSource: buildingGovernor.source === 'action' ? 'action' : 'default',
      contractsSource: contractsGovernor.source === 'action' ? 'action' : 'default',
      ruinsSource: ruinsGovernor.source === 'action' ? 'action' : 'default',
      underrealmSource: underrealmGovernor.source === 'action' ? 'action' : 'default',
      externalCampsSource: externalCampsGovernor.source === 'action' ? 'action' : 'default',
      socialSource: socialGovernor.source === 'action' ? 'action' : 'default',
      warriorsSource: warriorsGovernor.source === 'action' ? 'action' : 'default',
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
      contractCommitIntent: clamp(Number(contractsGovernor.commitIntent || 0), 0, 1),
      ruinsWarningDispatchIntent: clamp(Number(ruinsGovernor.warningDispatchIntent || 0), 0, 1),
      ruinsMithrilReinforcementIntent: clamp(Number(ruinsGovernor.mithrilReinforcementIntent || 0), 0, 1),
      underrealmSurfaceReserveBias: clamp(Number(underrealmGovernor.surfaceReserveBias || 0), -1, 1),
      underrealmDepthAllocationBias: clamp(Number(underrealmGovernor.depthAllocationBias || 0), -1, 1),
      underrealmMinerMixBias: clamp(Number(underrealmGovernor.minerMixBias || 0), -1, 1),
      underrealmHaulerMixBias: clamp(Number(underrealmGovernor.haulerMixBias || 0), -1, 1),
      underrealmGuardMixBias: clamp(Number(underrealmGovernor.guardMixBias || 0), -1, 1),
      buildMineBias: Number(buildingGovernor.mineBias || 0),
      buildUpgradeBias: Number(buildingGovernor.upgradeBias || 0),
      militiaSupportIntent: clamp(Number(externalCampsGovernor.militiaSupportIntent || 0), 0, 1),
      raiderTributeIntent: clamp(Number(externalCampsGovernor.raiderTributeIntent || 0), 0, 1),
      socialMediationBias: clamp(Number(socialGovernor.mediationBias || 0), -1, 1),
      socialMentorshipBias: clamp(Number(socialGovernor.mentorshipBias || 0), -1, 1),
      socialAccountabilityBias: clamp(Number(socialGovernor.accountabilityBias || 0), -1, 1),
      warriorTrainingIntent: clamp(Number(warriorsGovernor.trainingIntent || 0), 0, 1),
      warriorRotationIntent: clamp(Number(warriorsGovernor.rotationIntent || 0), 0, 1),
      warriorTournamentRiskIntent: clamp(Number(warriorsGovernor.tournamentRiskIntent || 0), 0, 1),
      warriorChampionChallengeIntent: clamp(Number(warriorsGovernor.championChallengeIntent || 0), 0, 1),
      warriorRecoveryPriorityIntent: clamp(Number(warriorsGovernor.recoveryPriorityIntent || 0), 0, 1),
      warriorTrainingIntentThreshold: clamp(Number(warriorsGovernor.trainingIntentThreshold || 0.5), 0, 1),
      warriorRotationIntentThreshold: clamp(Number(warriorsGovernor.rotationIntentThreshold || 0.5), 0, 1),
      warriorTournamentRiskIntentThreshold: clamp(
        Number(warriorsGovernor.tournamentRiskIntentThreshold || 0.5),
        0,
        1,
      ),
      warriorChampionChallengeIntentThreshold: clamp(
        Number(warriorsGovernor.championChallengeIntentThreshold || 0.5),
        0,
        1,
      ),
      warriorRecoveryPriorityIntentThreshold: clamp(
        Number(warriorsGovernor.recoveryPriorityIntentThreshold || 0.5),
        0,
        1,
      ),
      warriorTrainingApplied: warriorsGovernor.trainingApplied === true,
      warriorRotationApplied: warriorsGovernor.rotationApplied === true,
      warriorTournamentRiskApplied: warriorsGovernor.tournamentRiskApplied === true,
      warriorChampionChallengeApplied: warriorsGovernor.championChallengeApplied === true,
      warriorRecoveryPriorityApplied: warriorsGovernor.recoveryPriorityApplied === true,
      warriorDominantIntent: warriorsGovernor.dominantIntent
        ? String(warriorsGovernor.dominantIntent)
        : '-',
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

  const socialPressureScore = scoreSocialPressure(context);
  if (socialPressureScore > 0) {
    const cohesion = Math.round(clamp(Number(context.socialCohesion || 0), 0, 1) * 100);
    const conflict = Math.round(clamp(Number(context.socialConflictPressure || 0), 0, 1) * 100);
    const grudge = Math.round(clamp(Number(context.socialGrudgeLoad || 0), 0, 1) * 100);
    const incident = Math.round(clamp(Number(context.socialIncidentRecency || 0), 0, 1) * 100);
    drivers.push({
      key: 'social:pressure',
      label: `Social pressure (coh ${cohesion}% / conf ${conflict}% / grd ${grudge}% / rec ${incident}%)`,
      kind: 'social',
      score: socialPressureScore,
    });
  }

  const signals = governorSignals && typeof governorSignals === 'object' ? governorSignals : {};
  const jobsSource = signals.jobs && signals.jobs.source === 'action';
  const tradeSource = signals.trade && signals.trade.source === 'action';
  const buildingSource = signals.building && signals.building.source === 'action';
  const contractsSource = signals.contracts && signals.contracts.source === 'action';
  const ruinsSource = signals.ruins && signals.ruins.source === 'action';
  const underrealmSource = signals.underrealm && signals.underrealm.source === 'action';
  const externalCampsSource = signals.externalCamps && signals.externalCamps.source === 'action';
  const socialSource = signals.social && signals.social.source === 'action';
  const warriorsSource = signals.warriors && signals.warriors.source === 'action';
  const actionDrivenCount = Number(jobsSource)
    + Number(tradeSource)
    + Number(buildingSource)
    + Number(contractsSource)
    + Number(ruinsSource)
    + Number(underrealmSource)
    + Number(externalCampsSource)
    + Number(socialSource)
    + Number(warriorsSource);
  if (actionDrivenCount > 0) {
    drivers.push({
      key: 'governor:action',
      label: `Policy action envelope (${actionDrivenCount}/9)`,
      kind: 'policy',
      score: 0.45 + actionDrivenCount * 0.1,
    });
  }

  return drivers
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
    .slice(0, 4);
}

// Score social pressure for explainability ranking.
function scoreSocialPressure(context) {
  const safe = context && typeof context === 'object' ? context : {};
  const cohesion = clamp(Number(safe.socialCohesion || 0), 0, 1);
  const conflict = clamp(Number(safe.socialConflictPressure || 0), 0, 1);
  const mentorship = clamp(Number(safe.socialMentorshipCoverage || 0), 0, 1);
  const grudge = clamp(Number(safe.socialGrudgeLoad || 0), 0, 1);
  const incidentRecency = clamp(Number(safe.socialIncidentRecency || 0), 0, 1);
  const pressure = clamp(
    conflict * 0.5
      + grudge * 0.3
      + incidentRecency * 0.2
      + (1 - cohesion) * 0.14
      - mentorship * 0.08,
    0,
    1.2,
  );
  if (pressure < 0.2) {
    return 0;
  }
  return pressure;
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
