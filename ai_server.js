'use strict';

const readline = require('readline');
const { loadConfig } = require('./src/config');
const { buildRuntime } = require('./src/runtime');
const { createInitialState } = require('./src/state');
const { stepState } = require('./src/simulation');
const { buildObservation: buildAiObservation } = require('./src/ai/observation');
const { getTerrainResourceRatio } = require('./src/simulation/terrain');
const { getFestivalObservation } = require('./src/simulation/festivals');
const { clamp } = require('./src/utils');

const baseConfigPath = resolveConfigPath(process.argv.slice(2));
const baseConfig = loadConfig(baseConfigPath || undefined);
const nativeRandom = Math.random;
const DEBUG_MODE = resolveDebugMode(process.env.NODEDWARVES_DEBUG_MODE);
const TRANSPORT_LEGACY = 'legacy';
const TRANSPORT_COMPACT = 'compact';
const DEFAULT_FEATURE_NAMES = [
  'shortage',
  'nodeScarcity',
  'criticalNeeds',
  'idleAdults',
  'populationBalance',
  'seasonIndex',
  'seasonProgress',
  'weatherSeverity',
  'weatherTimeLeft',
  'raidActive',
  'raidTimeLeft',
  'raidExposed',
  'raidDefense',
  'housingShortage',
  'seasonEligible',
  'festivalActive',
  'festivalTimeLeft',
  'festivalEligible',
  'festivalCostRatio',
];
const FESTIVAL_ACTION_ID = 'festival';
const TRADE_RESERVE_BIAS_ACTION_ID = 'gov_trade_reserve_ratio_bias';
const TRADE_CONTEST_INTENT_ACTION_ID = 'gov_trade_contest_intent';
const TRADE_OPPORTUNITY_INTENT_ACTION_ID = 'gov_trade_opportunity_intent';
const BUILDING_HOUSING_WEIGHT_ACTION_ID = 'gov_building_housing_weight';
const BUILDING_ECONOMY_WEIGHT_ACTION_ID = 'gov_building_economy_weight';
const BUILDING_DEFENSE_WEIGHT_ACTION_ID = 'gov_building_defense_weight';
const BUILDING_SPECIAL_WEIGHT_ACTION_ID = 'gov_building_special_weight';
const BUILDING_MINE_BIAS_ACTION_ID = 'gov_building_mine_bias';
const BUILDING_UPGRADE_BIAS_ACTION_ID = 'gov_building_upgrade_bias';
const ACTION_SLOT_WEIGHT = 'weight';
const ACTION_SLOT_FESTIVAL = 'festivalIntent';
const ACTION_SLOT_TRADE_RESERVE = 'tradeReserveRatioBias';
const ACTION_SLOT_TRADE_CONTEST = 'tradeContestIntent';
const ACTION_SLOT_TRADE_OPPORTUNITY = 'tradeOpportunityIntent';
const ACTION_SLOT_BUILDING_HOUSING = 'buildingHousingWeight';
const ACTION_SLOT_BUILDING_ECONOMY = 'buildingEconomyWeight';
const ACTION_SLOT_BUILDING_DEFENSE = 'buildingDefenseWeight';
const ACTION_SLOT_BUILDING_SPECIAL = 'buildingSpecialWeight';
const ACTION_SLOT_BUILDING_MINE = 'buildingMineBias';
const ACTION_SLOT_BUILDING_UPGRADE = 'buildingUpgradeBias';
const FEATURE_KIND_SHORTAGE = 'shortage';
const FEATURE_KIND_NODE_SCARCITY = 'nodeScarcity';
const FEATURE_KIND_STATIC = 'static';
const FEATURE_KIND_MYTH_FLAG = 'mythFlag';
const FEATURE_KIND_CLAN_SHARE = 'clanShare';
const FEATURE_KIND_ZERO = 'zero';
const MYTH_FLAG_PREFIX = 'mythFlag_';
const CLAN_SHARE_PREFIX = 'clanShare_';
const STATIC_FEATURE_NAMES = new Set([
  'criticalNeeds',
  'idleAdults',
  'populationBalance',
  'seasonIndex',
  'seasonProgress',
  'weatherSeverity',
  'weatherTimeLeft',
  'raidActive',
  'raidTimeLeft',
  'raidExposed',
  'raidDefense',
  'housingShortage',
  'seasonEligible',
  'festivalActive',
  'festivalTimeLeft',
  'festivalEligible',
  'festivalCostRatio',
  'ruinsActive',
  'ruinsCooldown',
  'ruinsProgress',
  'ruinsArtifacts',
  'underrealmDepthProgress',
  'underrealmChampionProgress',
  'underrealmFrontierContested',
  'underrealmChampionCooldown',
  'underrealmReadinessScore',
  'underrealmReadinessGap',
  'underrealmReadinessBlocked',
  'underrealmReadinessWarning',
  'underrealmCombatPressure',
  'mythsActiveRatio',
  'mythsSeverity',
]);
let runtime = buildRuntimeForConfig(baseConfig);

let state = null;
let prevMetrics = null;
let activeConfig = baseConfig;
let scenarioMeta = null;
let transportState = createTransportState();

resetState();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', (line) => {
  const trimmed = String(line || '').trim();
  if (!trimmed) {
    return;
  }

  let payload;
  try {
    payload = JSON.parse(trimmed);
  } catch (error) {
    writeResponse({ error: 'invalid_json' });
    return;
  }

  const cmd = payload && payload.cmd;
  if (cmd === 'reset') {
    applySeed(payload.seed);
    resetState({
      training: payload.training,
      eval: payload.eval,
      difficulty: payload.difficulty,
      randomize: payload.randomize,
      scenario: payload.scenario,
    });
    configureTransport(payload.transport, activeConfig);
    writeResponse(buildResponse(0, false));
    return;
  }

  if (cmd === 'step') {
    const action = decodeStepAction(payload);
    const forceDebug = Boolean(payload.debug)
      || Boolean(payload.action && payload.action.debug)
      || Boolean(action.debug);
    const stepAction = { ...action };
    delete stepAction.debug;
    const ticks = getStepTicks(stepAction, activeConfig);
    for (let i = 0; i < ticks; i += 1) {
      stepState(state, activeConfig, runtime, stepAction);
    }
    const metrics = computeMetrics(state, activeConfig);
    const reward = computeReward(prevMetrics, metrics, activeConfig, stepAction);
    prevMetrics = metrics;
    const doneStatus = getDoneStatus(state, activeConfig, metrics);
    writeResponse(buildResponse(reward, doneStatus.done, doneStatus.reason, forceDebug));
    return;
  }

  if (cmd === 'close') {
    writeResponse({ ok: true });
    process.exit(0);
    return;
  }

  writeResponse({ error: 'unknown_command' });
});

// Function: buildRuntimeForConfig.
function buildRuntimeForConfig(config) {
  const display = (config && config.display) || {};
  return buildRuntime(display, {
    columns: Number(display.width || 80),
    rows: Number(display.height || 24),
  });
}

// Function: resetState.
function resetState(options = {}) {
  const scenario = buildScenarioConfig(baseConfig, options);
  activeConfig = scenario.config;
  scenarioMeta = scenario.meta;
  runtime = buildRuntimeForConfig(activeConfig);
  state = createInitialState(activeConfig, runtime);
  if (scenario.initialTick !== null) {
    state.tick = scenario.initialTick;
  }
  prevMetrics = computeMetrics(state, activeConfig);
}

// Function: applySeed.
function applySeed(seed) {
  if (seed === undefined || seed === null) {
    Math.random = nativeRandom;
    return;
  }
  const intSeed = Number(seed) >>> 0;
  Math.random = mulberry32(intSeed);
}

// Resolve optional config path from CLI args ("--config <path>" or "--config=<path>").
function resolveConfigPath(argv) {
  if (!Array.isArray(argv)) {
    return null;
  }
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || '');
    if (token === '--config') {
      const value = index + 1 < argv.length ? String(argv[index + 1] || '').trim() : '';
      return value || null;
    }
    if (token.startsWith('--config=')) {
      const value = token.slice('--config='.length).trim();
      return value || null;
    }
  }
  return null;
}

// Normalize the debug mode passed via environment variables.
function resolveDebugMode(raw) {
  const value = String(raw || 'full').trim().toLowerCase();
  if (!value) {
    return 'full';
  }
  if (['0', 'off', 'none', 'false', 'disable', 'disabled'].includes(value)) {
    return 'off';
  }
  if (['final', 'end', 'done'].includes(value)) {
    return 'final';
  }
  if (['summary', 'minimal', 'min'].includes(value)) {
    return 'summary';
  }
  return 'full';
}

// Function: mulberry32.
function mulberry32(seed) {
  let t = seed >>> 0;
  return function random() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Function: getStepTicks.
function getStepTicks(action, config) {
  const aiConfig = config.ai || {};
  const actionTicks = Number(action.ticks);
  if (Number.isFinite(actionTicks) && actionTicks > 0) {
    return Math.floor(actionTicks);
  }
  return Math.max(1, Number(aiConfig.stepTicks || 10));
}

// Build default transport state.
function createTransportState() {
  return {
    mode: TRANSPORT_LEGACY,
    resources: [],
    featureNames: [],
    featureSpecs: [],
    actionSlots: [],
    actionClampLow: 0,
    actionClampHigh: 2,
  };
}

// Normalize transport mode to one of supported values.
function normalizeTransportMode(rawMode) {
  const mode = String(rawMode || '').trim().toLowerCase();
  if (mode === TRANSPORT_COMPACT) {
    return TRANSPORT_COMPACT;
  }
  return TRANSPORT_LEGACY;
}

// Parse a list of non-empty string ids.
function parseStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const parsed = [];
  for (const item of value) {
    const text = String(item || '').trim();
    if (text) {
      parsed.push(text);
    }
  }
  return parsed;
}

// Resolve one action slot kind for compact action decoding.
function resolveActionSlotKind(actionId) {
  if (actionId === FESTIVAL_ACTION_ID) {
    return ACTION_SLOT_FESTIVAL;
  }
  if (actionId === TRADE_RESERVE_BIAS_ACTION_ID) {
    return ACTION_SLOT_TRADE_RESERVE;
  }
  if (actionId === TRADE_CONTEST_INTENT_ACTION_ID) {
    return ACTION_SLOT_TRADE_CONTEST;
  }
  if (actionId === TRADE_OPPORTUNITY_INTENT_ACTION_ID) {
    return ACTION_SLOT_TRADE_OPPORTUNITY;
  }
  if (actionId === BUILDING_HOUSING_WEIGHT_ACTION_ID) {
    return ACTION_SLOT_BUILDING_HOUSING;
  }
  if (actionId === BUILDING_ECONOMY_WEIGHT_ACTION_ID) {
    return ACTION_SLOT_BUILDING_ECONOMY;
  }
  if (actionId === BUILDING_DEFENSE_WEIGHT_ACTION_ID) {
    return ACTION_SLOT_BUILDING_DEFENSE;
  }
  if (actionId === BUILDING_SPECIAL_WEIGHT_ACTION_ID) {
    return ACTION_SLOT_BUILDING_SPECIAL;
  }
  if (actionId === BUILDING_MINE_BIAS_ACTION_ID) {
    return ACTION_SLOT_BUILDING_MINE;
  }
  if (actionId === BUILDING_UPGRADE_BIAS_ACTION_ID) {
    return ACTION_SLOT_BUILDING_UPGRADE;
  }
  return ACTION_SLOT_WEIGHT;
}

// Compile resource slots for compact action decoding.
function compileActionSlots(resources) {
  const slots = [];
  for (const rawResource of resources) {
    const actionId = String(rawResource || '');
    if (!actionId) {
      continue;
    }
    slots.push({
      kind: resolveActionSlotKind(actionId),
      actionId,
    });
  }
  return slots;
}

// Build one compact feature spec list for fast vector encoding.
function compileFeatureSpecs(featureNames) {
  const names = Array.isArray(featureNames) && featureNames.length > 0
    ? featureNames
    : DEFAULT_FEATURE_NAMES;
  const specs = [];
  for (const rawName of names) {
    const name = String(rawName || '');
    if (!name) {
      continue;
    }
    if (name === FEATURE_KIND_SHORTAGE) {
      specs.push({ kind: FEATURE_KIND_SHORTAGE });
      continue;
    }
    if (name === FEATURE_KIND_NODE_SCARCITY) {
      specs.push({ kind: FEATURE_KIND_NODE_SCARCITY });
      continue;
    }
    if (STATIC_FEATURE_NAMES.has(name)) {
      specs.push({ kind: FEATURE_KIND_STATIC, key: name });
      continue;
    }
    if (name.startsWith(MYTH_FLAG_PREFIX)) {
      specs.push({
        kind: FEATURE_KIND_MYTH_FLAG,
        key: name.slice(MYTH_FLAG_PREFIX.length),
      });
      continue;
    }
    if (name.startsWith(CLAN_SHARE_PREFIX)) {
      specs.push({
        kind: FEATURE_KIND_CLAN_SHARE,
        key: name.slice(CLAN_SHARE_PREFIX.length),
      });
      continue;
    }
    specs.push({ kind: FEATURE_KIND_ZERO });
  }
  return specs;
}

// Resolve action clamp range once per reset/config.
function getActionClampBounds(config) {
  const ai = (config && config.ai) || {};
  const minWeight = Number(ai.minWeight ?? 0);
  const maxWeight = Number(ai.maxWeight ?? 2);
  return {
    low: Math.min(minWeight, maxWeight),
    high: Math.max(minWeight, maxWeight),
  };
}

// Apply transport config for current session.
function configureTransport(rawTransport, config) {
  const mode = normalizeTransportMode(rawTransport && rawTransport.mode ? rawTransport.mode : rawTransport);
  const resources = rawTransport && typeof rawTransport === 'object'
    ? parseStringList(rawTransport.resources)
    : [];
  const featureNames = rawTransport && typeof rawTransport === 'object'
    ? parseStringList(rawTransport.featureNames)
    : [];
  const bounds = getActionClampBounds(config);
  transportState = {
    mode,
    resources,
    featureNames,
    featureSpecs: compileFeatureSpecs(featureNames),
    actionSlots: compileActionSlots(resources),
    actionClampLow: bounds.low,
    actionClampHigh: bounds.high,
  };
}

// Check if current session uses compact transport.
function isCompactTransport() {
  return transportState && transportState.mode === TRANSPORT_COMPACT;
}

// Decode one step action payload with legacy + compact compatibility.
function decodeStepAction(payload) {
  if (Array.isArray(payload && payload.actionValues)) {
    return decodeCompactActionPayload(payload.actionValues, payload);
  }
  const legacy = payload && payload.action && typeof payload.action === 'object'
    ? payload.action
    : {};
  if (Array.isArray(legacy.actionValues)) {
    return decodeCompactActionPayload(legacy.actionValues, legacy);
  }
  return legacy;
}

// Decode compact action vector into the legacy action envelope expected by stepState.
function decodeCompactActionPayload(actionValues, sourcePayload) {
  const slots = Array.isArray(transportState && transportState.actionSlots)
    ? transportState.actionSlots
    : [];
  const low = Number.isFinite(transportState && transportState.actionClampLow)
    ? Number(transportState.actionClampLow)
    : 0;
  const high = Number.isFinite(transportState && transportState.actionClampHigh)
    ? Number(transportState.actionClampHigh)
    : 2;

  let weights;
  let festivalIntent;
  let trade;
  let building;
  const action = {};

  for (let idx = 0; idx < slots.length; idx += 1) {
    const slot = slots[idx];
    if (!slot) {
      continue;
    }
    const rawValue = Number(actionValues[idx]);
    const safeValue = Number.isFinite(rawValue) ? rawValue : 0;
    const value = clamp(safeValue, low, high);
    switch (slot.kind) {
      case ACTION_SLOT_FESTIVAL:
        festivalIntent = value;
        break;
      case ACTION_SLOT_TRADE_RESERVE:
        trade = trade || {};
        trade.reserveRatioBias = value;
        break;
      case ACTION_SLOT_TRADE_CONTEST:
        trade = trade || {};
        trade.contestIntent = value;
        break;
      case ACTION_SLOT_TRADE_OPPORTUNITY:
        trade = trade || {};
        trade.opportunityIntent = value;
        break;
      case ACTION_SLOT_BUILDING_HOUSING:
        building = building || {};
        building.housingWeight = value;
        break;
      case ACTION_SLOT_BUILDING_ECONOMY:
        building = building || {};
        building.economyWeight = value;
        break;
      case ACTION_SLOT_BUILDING_DEFENSE:
        building = building || {};
        building.defenseWeight = value;
        break;
      case ACTION_SLOT_BUILDING_SPECIAL:
        building = building || {};
        building.specialWeight = value;
        break;
      case ACTION_SLOT_BUILDING_MINE:
        building = building || {};
        building.mineBias = value;
        break;
      case ACTION_SLOT_BUILDING_UPGRADE:
        building = building || {};
        building.upgradeBias = value;
        break;
      case ACTION_SLOT_WEIGHT:
      default:
        weights = weights || {};
        weights[slot.actionId] = value;
        break;
    }
  }

  if (weights && Object.keys(weights).length > 0) {
    action.weights = weights;
  }
  if (festivalIntent !== undefined) {
    action.festivalIntent = festivalIntent;
  }
  if (trade && Object.keys(trade).length > 0) {
    action.trade = trade;
  }
  if (building && Object.keys(building).length > 0) {
    action.building = building;
  }

  const ticksRaw = Number(sourcePayload && sourcePayload.ticks);
  if (Number.isFinite(ticksRaw) && ticksRaw > 0) {
    action.ticks = Math.floor(ticksRaw);
  }
  if (sourcePayload && sourcePayload.debug) {
    action.debug = true;
  }
  return action;
}

// Function: buildResponse.
function buildResponse(reward, done, doneReason, forceDebug) {
  const metrics = computeMetrics(state, activeConfig);
  const compactTransport = isCompactTransport();
  const obs = compactTransport ? null : buildObservation(state, activeConfig, metrics);
  const debugPayload = getDebugPayload(state, activeConfig, metrics, done, forceDebug);
  const info = {
    tick: state.tick,
    population: metrics.population.total,
    births: Number(state.birthsCount || 0),
    deaths: Number(state.deathsCount || 0),
    doneReason: doneReason || null,
    scenario: scenarioMeta,
    trainingSignals: buildTrainingSignals(metrics),
    ...(debugPayload ? { debug: debugPayload } : {}),
  };
  const response = {
    reward: Number(reward || 0),
    done: Boolean(done),
    info,
  };
  if (compactTransport) {
    response.obsVector = buildCompactObservationVector(metrics, activeConfig);
  } else {
    response.obs = obs;
  }
  return response;
}

// Build compact training signals consumed by Python throughput diagnostics.
function buildTrainingSignals(metrics) {
  const underrealm = metrics
    && metrics.aiObservation
    && metrics.aiObservation.underrealm
    && typeof metrics.aiObservation.underrealm === 'object'
    ? metrics.aiObservation.underrealm
    : {};
  return {
    criticalNeedsFraction: Number(metrics.criticalNeedsFraction || 0),
    idleAdultsFraction: Number(metrics.idleAdultsFraction || 0),
    populationBalance: Number(metrics.populationBalance || 0),
    stockpileRatio: { ...(metrics.stockpileRatio || {}) },
    underrealmDepthProgress: Number(underrealm.depthProgress || 0),
    underrealmChampionProgress: Number(underrealm.championProgress || 0),
    underrealmReadinessScore: Number(underrealm.readinessScore || 0),
    underrealmCombatPressure: Number(underrealm.combatPressure || 0),
  };
}

// Decide whether debug info should be included in a response.
function shouldIncludeDebug(done, forceDebug) {
  if (DEBUG_MODE === 'off') {
    return false;
  }
  if (DEBUG_MODE === 'final' || DEBUG_MODE === 'summary') {
    return Boolean(done || forceDebug);
  }
  return true;
}

// Build the debug payload based on the selected debug mode.
function getDebugPayload(state, config, metrics, done, forceDebug) {
  if (!shouldIncludeDebug(done, forceDebug)) {
    return null;
  }
  if (DEBUG_MODE === 'summary') {
    return buildDebugInfoMinimal(state, config, metrics);
  }
  return buildDebugInfo(state, config, metrics);
}

// Function: buildDebugInfo.
function buildDebugInfoMinimal(state, config, metrics) {
  const raidState = state.raid || {};
  const raidStats = state.raidStats || {};
  const raidObservation = metrics.raid || {};
  const underrealm = getUnderrealmDebugMetrics(state, config);
  return {
    stockpile: {
      avgRatio: Number(metrics.stockpileAvg || 0),
      minRatio: Number(metrics.stockpileMin || 0),
    },
    raid: {
      active: Boolean(raidState.active),
      ticksRemaining: Number(raidState.ticksRemaining || 0),
      season: raidState.seasonName || null,
      count: Number(raidStats.count || 0),
      deaths: Number(raidStats.deaths || 0),
      loot: { ...(raidStats.loot || {}) },
      exposedRatio: Number(raidObservation.exposedRatio || 0),
      defenseRatio: Number(raidObservation.defenseRatio || 0),
      seasonEligible: Number(raidObservation.seasonEligible || 0),
    },
    nodes: { ...(metrics.nodeRatio || {}) },
    underrealm,
    weather: state.weather && state.weather.type ? { type: state.weather.type } : null,
    criticalNeedsFraction: Number(metrics.criticalNeedsFraction || 0),
    idleAdultsFraction: Number(metrics.idleAdultsFraction || 0),
  };
}

// Function: buildDebugInfo.
function buildDebugInfo(state, config, metrics) {
  const deaths = state.deathsByCause || {};
  const reproduction = state.reproductionStats || {};
  const ticks = Number(reproduction.ticks || 0);
  const avg = (value) => (ticks > 0 ? Number(value || 0) / ticks : 0);
  const attempts = Number(reproduction.attempts || 0);
  const successes = Number(reproduction.successes || 0);
  const resources = config.resources || {};
  const targets = resources.targets || {};
  const housingConfig = (config.population && config.population.housing) || {};
  const housingEnabled = housingConfig.enabled !== false;
  const houses = housingEnabled
    ? (state.structures || []).filter((structure) => structure.type === 'house')
    : [];
  const houseCount = houses.length;
  const bedsTotal = houses.reduce((sum, house) => {
    return sum + Math.max(0, Number(house.capacity || 0));
  }, 0);
  const population = Math.max(1, state.dwarves.length);
  const housingRatio = housingEnabled
    ? (bedsTotal > 0 ? bedsTotal / population : 0)
    : 1;
  const unshelteredFraction = housingEnabled ? clamp(1 - housingRatio, 0, 1) : 0;
  const fieldConfig = (config.structures && config.structures.field) || {};
  const minIrrigation = Number(fieldConfig.irrigationMinMultiplier ?? 1);
  const maxIrrigation = Number(fieldConfig.irrigationMaxMultiplier ?? 1);
  const irrigationLow = Math.min(minIrrigation, maxIrrigation);
  const irrigationHigh = Math.max(minIrrigation, maxIrrigation);
  const waterRatio = getStockpileRatio(state, config, 'water');
  const weatherConfig = config.weather || {};
  const weatherStates = weatherConfig.states || {};
  const weatherType = state.weather && state.weather.type ? state.weather.type : null;
  const weatherDef = weatherType ? (weatherStates[weatherType] || {}) : {};
  const weatherIrrigationRaw = Number(weatherDef.irrigation ?? 1);
  const weatherFieldRegenRaw = Number(weatherDef.fieldRegen ?? 1);
  const weatherNodeRegenRaw = Number(weatherDef.nodeRegen ?? 1);
  const weatherIrrigation = Number.isFinite(weatherIrrigationRaw) ? weatherIrrigationRaw : 1;
  const weatherFieldRegen = Number.isFinite(weatherFieldRegenRaw) ? weatherFieldRegenRaw : 1;
  const weatherNodeRegen = Number.isFinite(weatherNodeRegenRaw) ? weatherNodeRegenRaw : 1;
  const irrigationBase = irrigationLow + (irrigationHigh - irrigationLow) * clamp(waterRatio, 0, 1);
  const irrigationMultiplier = irrigationBase * weatherIrrigation;
  const fieldSeasonMultiplier = getSeasonValue(state, 'fieldRegen', 1);
  const fieldNodes = (state.nodes || []).filter((node) => node.source === 'field' && node.id === 'food');
  const fieldNodeRatio = getNodeRatioForNodes(fieldNodes);
  const merchantStats = state.merchantStats || {};
  const merchantTicks = Number(merchantStats.ticks || 0);
  const merchantTradesPerTick = merchantTicks > 0
    ? Number(merchantStats.trades || 0) / merchantTicks
    : 0;
  const merchantGivenPerTick = scaleMerchantMap(merchantStats.given, merchantTicks);
  const merchantReceivedPerTick = scaleMerchantMap(merchantStats.received, merchantTicks);
  const raidState = state.raid || {};
  const raidStats = state.raidStats || {};
  const raidObservation = metrics.raid || {};
  const underrealm = getUnderrealmDebugMetrics(state, config);

  return {
    deaths: {
      starvation: Number(deaths.starvation || 0),
      oldAge: Number(deaths.oldAge || 0),
      raid: Number(deaths.raid || 0),
    },
    reproduction: {
      ticks,
      couplesPerTick: avg(reproduction.couples),
      fertileAdultsPerTick: avg(reproduction.fertileAdults),
      pregnanciesPerTick: avg(reproduction.pregnancies),
      cooldownsPerTick: avg(reproduction.cooldowns),
      resourceFactor: avg(reproduction.resourceFactorSum),
      crowdingFactor: avg(reproduction.crowdingFactorSum),
      moraleFactor: avg(reproduction.moraleFactorSum),
      seasonFactor: avg(reproduction.seasonFactorSum),
      chance: avg(reproduction.chanceSum),
      attempts,
      successes,
      successRate: attempts > 0 ? successes / attempts : 0,
      blocked: {
        infertile: Number(reproduction.blockedInfertile || 0),
        pregnant: Number(reproduction.blockedPregnant || 0),
        cooldown: Number(reproduction.blockedCooldown || 0),
        noResources: Number(reproduction.blockedNoResources || 0),
        noHousing: Number(reproduction.blockedNoHousing || 0),
        chance: Number(reproduction.blockedChance || 0),
      },
    },
    stockpile: {
      current: { ...state.stockpile },
      targets: { ...targets },
      ratios: { ...metrics.stockpileRatio },
      avgRatio: Number(metrics.stockpileAvg || 0),
      minRatio: Number(metrics.stockpileMin || 0),
    },
    housing: {
      houses: houseCount,
      beds: bedsTotal,
      ratio: Number(housingRatio || 0),
      unshelteredFraction: Number(unshelteredFraction || 0),
    },
    fields: {
      nodes: fieldNodes.length,
      nodeRatio: fieldNodeRatio,
      waterRatio: Number(waterRatio || 0),
      irrigationMultiplier: Number(irrigationMultiplier || 0),
      seasonMultiplier: Number(fieldSeasonMultiplier || 0),
      regenMultiplier: Number(irrigationMultiplier * fieldSeasonMultiplier * weatherFieldRegen * weatherNodeRegen || 0),
    },
    weather: state.weather
      ? {
        type: state.weather.type,
        remaining: Number(state.weather.ticksRemaining || 0),
        duration: Number(state.weather.duration || 0),
      }
      : null,
    merchant: {
      tradesPerTick: Number(merchantTradesPerTick || 0),
      givenPerTick: merchantGivenPerTick,
      receivedPerTick: merchantReceivedPerTick,
    },
    raid: {
      active: Boolean(raidState.active),
      ticksRemaining: Number(raidState.ticksRemaining || 0),
      season: raidState.seasonName || null,
      count: Number(raidStats.count || 0),
      deaths: Number(raidStats.deaths || 0),
      loot: { ...(raidStats.loot || {}) },
      exposedRatio: Number(raidObservation.exposedRatio || 0),
      defenseRatio: Number(raidObservation.defenseRatio || 0),
      seasonEligible: Number(raidObservation.seasonEligible || 0),
    },
    underrealm,
    nodes: { ...metrics.nodeRatio },
    needsAvg: { ...metrics.needsAvg },
    criticalNeedsFraction: Number(metrics.criticalNeedsFraction || 0),
    idleAdultsFraction: Number(metrics.idleAdultsFraction || 0),
  };
}

// Function: scaleMerchantMap.
function scaleMerchantMap(values, ticks) {
  const result = {};
  if (!values || typeof values !== 'object') {
    return result;
  }
  const divisor = Number(ticks || 0);
  for (const [key, value] of Object.entries(values)) {
    const amount = Number(value || 0);
    result[key] = divisor > 0 ? amount / divisor : 0;
  }
  return result;
}

// Resolve underrealm debug metrics with stable numeric defaults.
function getUnderrealmDebugMetrics(state, config) {
  const aiObservation = resolveAiObservation(state, config);
  const underrealm = aiObservation.underrealm;
  return {
    depthProgress: Number(underrealm.depthProgress || 0),
    championProgress: Number(underrealm.championProgress || 0),
    frontierContested: Number(underrealm.frontierContested || 0),
    championCooldown: Number(underrealm.championCooldown || 0),
    readinessScore: Number(underrealm.readinessScore || 0),
    readinessGap: Number(underrealm.readinessGap || 0),
    readinessBlocked: Number(underrealm.readinessBlocked || 0),
    readinessWarning: Number(underrealm.readinessWarning || 0),
    combatPressure: Number(underrealm.combatPressure || 0),
  };
}

// Resolve AI observation channels once with stable object defaults.
function resolveAiObservation(state, config) {
  const aiObservation = buildAiObservation(state, config) || {};
  return {
    ruins: aiObservation.ruins && typeof aiObservation.ruins === 'object'
      ? aiObservation.ruins
      : {},
    underrealm: aiObservation.underrealm && typeof aiObservation.underrealm === 'object'
      ? aiObservation.underrealm
      : {},
    myths: aiObservation.myths && typeof aiObservation.myths === 'object'
      ? aiObservation.myths
      : {},
    clanShares: aiObservation.clanShares && typeof aiObservation.clanShares === 'object'
      ? aiObservation.clanShares
      : {},
  };
}

// Resolve compact AI reward signals from observation channels.
function getAiRewardSignals(aiObservation) {
  const underrealm = aiObservation && aiObservation.underrealm
    ? aiObservation.underrealm
    : {};
  const myths = aiObservation && aiObservation.myths
    ? aiObservation.myths
    : {};
  return {
    underrealmDepthProgress: clamp(Number(underrealm.depthProgress || 0), 0, 1),
    underrealmChampionProgress: clamp(Number(underrealm.championProgress || 0), 0, 1),
    underrealmReadinessScore: clamp(Number(underrealm.readinessScore || 0), 0, 1),
    underrealmCombatPressure: clamp(Number(underrealm.combatPressure || 0), 0, 1),
    mythsActiveRatio: clamp(Number(myths.activeRatio || 0), 0, 1),
    mythsSeverity: clamp(Number(myths.severity || 0), 0, 1),
  };
}

// Function: getSeasonValue.
function getSeasonValue(state, key, fallback) {
  if (!state || !state.season || !state.season.modifiers) {
    return fallback;
  }
  const value = state.season.modifiers[key];
  return Number.isFinite(value) ? Number(value) : fallback;
}

// Function: getStockpileRatio.
function getStockpileRatio(state, config, resourceId) {
  const targets = (config.resources && config.resources.targets) || {};
  const target = Number(targets[resourceId] || 0);
  if (target <= 0) {
    return 1;
  }
  const current = Number(state.stockpile[resourceId] || 0);
  return clamp(current / target, 0, 1);
}

// Function: getNodeRatioForNodes.
function getNodeRatioForNodes(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return 1;
  }
  let totalCapacity = 0;
  let totalRemaining = 0;
  for (const node of nodes) {
    const capacity = Math.max(0, Number(node.capacity || 0));
    const remaining = Math.max(0, Number(node.remaining || 0));
    totalCapacity += capacity;
    totalRemaining += remaining;
  }
  if (totalCapacity <= 0) {
    return 1;
  }
  return clamp(totalRemaining / totalCapacity, 0, 1);
}

// Function: getWeatherSeverity.
function getWeatherSeverity(state, config) {
  if (!state || !state.weather || !state.weather.type) {
    return 0;
  }
  const weatherConfig = (config && config.weather) || {};
  const states = weatherConfig.states || {};
  const type = state.weather.type;
  const def = states[type] || {};
  const configured = Number(def.severity);
  if (Number.isFinite(configured)) {
    return clamp(configured, 0, 1);
  }
  const fallback = {
    clear: 0,
    rain: 0.35,
    storm: 0.75,
    drought: 1,
    cold: 0.6,
  };
  return clamp(Number(fallback[type] || 0), 0, 1);
}

// Function: getWeatherTimeLeft.
function getWeatherTimeLeft(state) {
  if (!state || !state.weather) {
    return 0;
  }
  const duration = Number(state.weather.duration || 0);
  if (duration <= 0) {
    return 0;
  }
  const remaining = Number(state.weather.ticksRemaining || 0);
  return clamp(remaining / duration, 0, 1);
}

// Function: getHousingStats.
function getHousingStats(state, config) {
  const housingConfig = (config.population && config.population.housing) || {};
  const housingEnabled = housingConfig.enabled !== false;
  const houses = housingEnabled
    ? (state.structures || []).filter((structure) => structure.type === 'house')
    : [];
  const bedsTotal = houses.reduce((sum, house) => {
    return sum + Math.max(0, Number(house.capacity || 0));
  }, 0);
  const population = Math.max(1, state.dwarves.length);
  const housingRatio = housingEnabled
    ? (bedsTotal > 0 ? bedsTotal / population : 0)
    : 1;
  return {
    housingEnabled,
    houses,
    bedsTotal,
    population,
    housingRatio,
  };
}

// Function: getRaidObservation.
function getRaidObservation(state, config, housingStats) {
  const raidConfig = (config && config.raids) || {};
  const raidState = state.raid || {};
  const houses = housingStats ? housingStats.houses : (state.structures || []).filter((structure) => {
    return structure.type === 'house';
  });
  const population = housingStats ? housingStats.population : Math.max(1, state.dwarves.length);
  const houseMap = new Map(houses.map((house) => [house.id, house]));
  let exposedCount = 0;

  for (const dwarf of state.dwarves) {
    const home = dwarf.homeId ? houseMap.get(dwarf.homeId) : null;
    const sheltered = Boolean(home && dwarf.x === home.x && dwarf.y === home.y);
    if (!sheltered) {
      exposedCount += 1;
    }
  }

  const exposedRatio = population > 0 ? clamp(exposedCount / population, 0, 1) : 0;
  const adults = state.dwarves.filter((dwarf) => dwarf.lifeStage === 'adult').length;
  const defenseAdults = Math.max(1, Number(raidConfig.defenseAdults || population));
  const defenseMax = clamp(Number(raidConfig.defenseMax ?? 0), 0, 1);
  const defenseRaw = clamp(adults / defenseAdults, 0, defenseMax);
  const towerConfig = (config.structures && config.structures.watchtower) || {};
  const towerRaid = towerConfig.raid || {};
  const towerCount = (state.structures || []).filter((structure) => structure.type === 'watchtower').length;
  const towerDefensePer = Math.max(0, Number(towerRaid.defensePerTower ?? 0));
  const towerDefenseMax = clamp(Number(towerRaid.defenseMax ?? 0), 0, 1);
  const towerDefense = clamp(towerCount * towerDefensePer, 0, towerDefenseMax);
  const totalDefense = clamp(defenseRaw + towerDefense, 0, 1);
  const defenseRatio = clamp(totalDefense, 0, 1);

  const duration = Math.max(1, Number(raidState.duration || raidConfig.durationTicks || 0));
  const ticksRemaining = Math.max(0, Number(raidState.ticksRemaining || 0));
  const timeLeftRatio = duration > 0 ? clamp(ticksRemaining / duration, 0, 1) : 0;

  const seasonNames = Array.isArray(raidConfig.seasonNames) && raidConfig.seasonNames.length > 0
    ? raidConfig.seasonNames
    : ['spring', 'autumn'];
  const seasonName = state.season ? state.season.name : null;
  let seasonEligible = raidConfig.enabled === true
    && seasonName
    && seasonNames.includes(seasonName)
    ? 1
    : 0;
  const minTick = Math.max(0, Number(raidConfig.minTick || 0));
  const minPopulation = Math.max(0, Number(raidConfig.minPopulation || 0));
  if (state.tick < minTick || population < minPopulation) {
    seasonEligible = 0;
  }

  return {
    active: Boolean(raidState.active),
    timeLeftRatio,
    exposedRatio,
    defenseRatio,
    seasonEligible,
  };
}

// Function: cloneLootMap.
function cloneLootMap(loot) {
  const clone = {};
  for (const [resource, value] of Object.entries(loot || {})) {
    clone[resource] = Number(value || 0);
  }
  return clone;
}

// Function: getRaidLootDelta.
function getRaidLootDelta(prevLoot, nextLoot) {
  const delta = {};
  const prev = prevLoot || {};
  const next = nextLoot || {};
  for (const [resource, value] of Object.entries(next)) {
    const diff = Number(value || 0) - Number(prev[resource] || 0);
    if (diff > 0) {
      delta[resource] = diff;
    }
  }
  return delta;
}

// Function: getRaidLootRatio.
function getRaidLootRatio(deltaLoot, config) {
  const targets = (config.resources && config.resources.targets) || {};
  let sum = 0;
  let count = 0;
  for (const [resource, amount] of Object.entries(deltaLoot)) {
    const target = Number(targets[resource] || 0);
    if (target <= 0) {
      continue;
    }
    sum += clamp(Number(amount || 0) / target, 0, 1);
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

// Function: buildObservation.
function buildObservation(state, config, metrics) {
  const weatherSeverity = Number(metrics.weatherSeverity ?? getWeatherSeverity(state, config));
  const weatherTimeLeft = Number(metrics.weatherTimeLeft ?? getWeatherTimeLeft(state));
  const festivalObservation = metrics.festivalObservation || getFestivalObservation(state, config);
  const aiObservation = metrics.aiObservation || resolveAiObservation(state, config);
  return {
    tick: state.tick,
    season: metrics.season || state.season || null,
    weather: {
      type: state.weather ? state.weather.type : null,
      severity: weatherSeverity,
      timeLeft: weatherTimeLeft,
    },
    population: metrics.population,
    stockpile: { ...state.stockpile },
    targets: { ...((config.resources && config.resources.targets) || {}) },
    stockpileRatio: metrics.stockpileRatio,
    nodes: metrics.nodeRatio,
    needsAvg: metrics.needsAvg,
    criticalNeedsFraction: metrics.criticalNeedsFraction,
    idleAdultsFraction: metrics.idleAdultsFraction,
    populationBalance: metrics.populationBalance,
    housingRatio: metrics.housingRatio,
    raid: metrics.raid,
    festival: festivalObservation,
    ruins: aiObservation.ruins || {
      active: 0,
      cooldownRatio: 0,
      progress: 0,
      artifacts: 0,
    },
    underrealm: aiObservation.underrealm || {
      depthProgress: 0,
      championProgress: 0,
      frontierContested: 0,
      championCooldown: 0,
      readinessScore: 0,
      readinessGap: 0,
      readinessBlocked: 0,
      readinessWarning: 0,
      combatPressure: 0,
    },
    myths: aiObservation.myths || {
      activeRatio: 0,
      severity: 0,
      flags: {},
    },
    clanShares: aiObservation.clanShares || {},
  };
}

// Build a compact flattened observation vector ordered by transport resources/features.
function buildCompactObservationVector(metrics, config) {
  const resources = Array.isArray(transportState && transportState.resources) && transportState.resources.length > 0
    ? transportState.resources
    : Object.keys((metrics && metrics.stockpileRatio) || {});
  const featureSpecs = Array.isArray(transportState && transportState.featureSpecs)
    && transportState.featureSpecs.length > 0
    ? transportState.featureSpecs
    : compileFeatureSpecs(DEFAULT_FEATURE_NAMES);
  const featureCount = featureSpecs.length;
  if (resources.length === 0 || featureCount === 0) {
    return [];
  }

  const ratios = (metrics && metrics.stockpileRatio) || {};
  const nodeRatios = (metrics && metrics.nodeRatio) || {};
  const raid = (metrics && metrics.raid) || {};
  const festival = (metrics && metrics.festivalObservation) || {};
  const aiObservation = (metrics && metrics.aiObservation) || {};
  const ruins = aiObservation.ruins && typeof aiObservation.ruins === 'object'
    ? aiObservation.ruins
    : {};
  const underrealm = aiObservation.underrealm && typeof aiObservation.underrealm === 'object'
    ? aiObservation.underrealm
    : {};
  const myths = aiObservation.myths && typeof aiObservation.myths === 'object'
    ? aiObservation.myths
    : {};
  const mythFlags = myths.flags && typeof myths.flags === 'object' ? myths.flags : {};
  const clanShares = aiObservation.clanShares && typeof aiObservation.clanShares === 'object'
    ? aiObservation.clanShares
    : {};
  const { seasonIndex, seasonProgress } = compactSeasonFeatures(
    (metrics && metrics.season) || (state && state.season),
  );
  const staticValues = {
    criticalNeeds: clamp(Number(metrics && metrics.criticalNeedsFraction || 0), 0, 1),
    idleAdults: clamp(Number(metrics && metrics.idleAdultsFraction || 0), 0, 1),
    populationBalance: clamp(Number(metrics && metrics.populationBalance || 0), 0, 1),
    seasonIndex,
    seasonProgress,
    weatherSeverity: clamp(
      Number(metrics && metrics.weatherSeverity !== undefined
        ? metrics.weatherSeverity
        : getWeatherSeverity(state, config)),
      0,
      1,
    ),
    weatherTimeLeft: clamp(
      Number(metrics && metrics.weatherTimeLeft !== undefined
        ? metrics.weatherTimeLeft
        : getWeatherTimeLeft(state)),
      0,
      1,
    ),
    raidActive: raid.active ? 1 : 0,
    raidTimeLeft: clamp(Number(raid.timeLeftRatio || 0), 0, 1),
    raidExposed: clamp(Number(raid.exposedRatio || 0), 0, 1),
    raidDefense: clamp(Number(raid.defenseRatio || 0), 0, 1),
    seasonEligible: clamp(Number(raid.seasonEligible || 0), 0, 1),
    housingShortage: clamp(1 - Number(metrics && metrics.housingRatio || 0), 0, 1),
    festivalActive: festival.active ? 1 : 0,
    festivalTimeLeft: clamp(Number(festival.timeLeft || 0), 0, 1),
    festivalEligible: clamp(Number(festival.eligible || 0), 0, 1),
    festivalCostRatio: clamp(Number(festival.costRatio || 0), 0, 1),
    ruinsActive: ruins.active ? 1 : 0,
    ruinsCooldown: clamp(Number(ruins.cooldownRatio || 0), 0, 1),
    ruinsProgress: clamp(Number(ruins.progress || 0), 0, 1),
    ruinsArtifacts: clamp(Number(ruins.artifacts || 0), 0, 1),
    underrealmDepthProgress: clamp(Number(underrealm.depthProgress || 0), 0, 1),
    underrealmChampionProgress: clamp(Number(underrealm.championProgress || 0), 0, 1),
    underrealmFrontierContested: clamp(Number(underrealm.frontierContested || 0), 0, 1),
    underrealmChampionCooldown: clamp(Number(underrealm.championCooldown || 0), 0, 1),
    underrealmReadinessScore: clamp(Number(underrealm.readinessScore || 0), 0, 1),
    underrealmReadinessGap: clamp(Number(underrealm.readinessGap || 0), 0, 1),
    underrealmReadinessBlocked: clamp(Number(underrealm.readinessBlocked || 0), 0, 1),
    underrealmReadinessWarning: clamp(Number(underrealm.readinessWarning || 0), 0, 1),
    underrealmCombatPressure: clamp(Number(underrealm.combatPressure || 0), 0, 1),
    mythsActiveRatio: clamp(Number(myths.activeRatio || 0), 0, 1),
    mythsSeverity: clamp(Number(myths.severity || 0), 0, 1),
  };

  const vector = new Array(resources.length * featureCount);
  let cursor = 0;

  for (const resource of resources) {
    const ratio = Number(ratios[resource] ?? 1);
    const nodeRatio = Number(nodeRatios[resource] ?? 1);
    const shortage = clamp(1 - ratio, 0, 1);
    const nodeScarcity = clamp(1 - nodeRatio, 0, 1);
    for (const spec of featureSpecs) {
      if (spec.kind === FEATURE_KIND_SHORTAGE) {
        vector[cursor] = shortage;
      } else if (spec.kind === FEATURE_KIND_NODE_SCARCITY) {
        vector[cursor] = nodeScarcity;
      } else if (spec.kind === FEATURE_KIND_STATIC) {
        vector[cursor] = Number(staticValues[spec.key] || 0);
      } else if (spec.kind === FEATURE_KIND_MYTH_FLAG) {
        vector[cursor] = clamp(Number(mythFlags[spec.key] || 0), 0, 1);
      } else if (spec.kind === FEATURE_KIND_CLAN_SHARE) {
        vector[cursor] = clamp(Number(clanShares[spec.key] || 0), 0, 1);
      } else {
        vector[cursor] = 0;
      }
      cursor += 1;
    }
  }

  return vector;
}

// Build season index/progress scalars aligned with Python trainer feature extraction.
function compactSeasonFeatures(season) {
  if (!season || typeof season !== 'object') {
    return { seasonIndex: 0, seasonProgress: 0 };
  }
  const index = Number(season.index || 0);
  const tick = Number(season.tickInSeason || 0);
  const duration = Math.max(1, Number(season.duration || 1));
  return {
    seasonIndex: clamp(index / 3, 0, 1),
    seasonProgress: clamp(tick / duration, 0, 1),
  };
}

// Function: computeMetrics.
function computeMetrics(state, config) {
  const targets = (config.resources && config.resources.targets) || {};
  const ratios = {};
  let ratioSum = 0;
  let ratioCount = 0;
  let minRatio = 1;

  for (const [resource, targetValue] of Object.entries(targets)) {
    const target = Number(targetValue || 0);
    if (target <= 0) {
      continue;
    }
    const current = Number(state.stockpile[resource] || 0);
    const ratio = clamp(current / target, 0, 1);
    ratios[resource] = ratio;
    ratioSum += ratio;
    ratioCount += 1;
    minRatio = Math.min(minRatio, ratio);
  }

  const stockpileAvg = ratioCount > 0 ? ratioSum / ratioCount : 1;
  const stockpileMin = ratioCount > 0 ? minRatio : 1;

  const population = countLifeStages(state.dwarves);
  const needsAvg = averageNeeds(state.dwarves);
  const criticalNeedsFraction = getCriticalNeedsFraction(state.dwarves, config);
  const idleAdultsFraction = getIdleAdultsFraction(state.dwarves, config);
  const populationBalance = getPopulationBalance(state, config);
  const nodeRatio = getNodeRatio(state.nodes);
  const resources = config.resources || {};
  if (resources.useTerrainTiles === true) {
    const terrainAllowed = resources.terrainAllowed || {};
    for (const resourceId of Object.keys(terrainAllowed)) {
      const terrainRatio = getTerrainResourceRatio(state, config, resourceId);
      const current = nodeRatio[resourceId] !== undefined ? nodeRatio[resourceId] : 0;
      nodeRatio[resourceId] = Math.max(current, terrainRatio);
    }
  }
  const housingStats = getHousingStats(state, config);
  const raidObservation = getRaidObservation(state, config, housingStats);
  const ruinsStats = state && state.ruins ? state.ruins.stats || {} : {};
  const ruinsArtifacts = state && state.ruins && state.ruins.artifactsFound
    ? Object.keys(state.ruins.artifactsFound).length
    : 0;
  const ruinsRoomsCleared = state && state.ruins ? Number(state.ruins.roomsCleared || 0) : 0;
  const festival = state && state.festival ? state.festival : null;
  const festivalActive = festival && festival.active ? 1 : 0;
  const festivalObservation = getFestivalObservation(state, config);
  const festivalEligible = festivalObservation && festivalObservation.eligible ? 1 : 0;
  const aiObservation = resolveAiObservation(state, config);
  const aiSignals = getAiRewardSignals(aiObservation);

  return {
    stockpileAvg,
    stockpileMin,
    stockpileRatio: ratios,
    population,
    needsAvg,
    criticalNeedsFraction,
    idleAdultsFraction,
    populationBalance,
    nodeRatio,
    housingRatio: housingStats.housingRatio,
    raid: raidObservation,
    raidDeaths: Number(state.deathsByCause && state.deathsByCause.raid || 0),
    raidLoot: cloneLootMap(state.raidStats && state.raidStats.loot),
    weatherSeverity: getWeatherSeverity(state, config),
    weatherTimeLeft: getWeatherTimeLeft(state),
    season: state.season || null,
    festivalObservation,
    ruinsSuccesses: Number(ruinsStats.successes || 0),
    ruinsFailures: Number(ruinsStats.failures || 0),
    ruinsArtifacts,
    ruinsRoomsCleared,
    aiObservation,
    underrealmDepthProgress: aiSignals.underrealmDepthProgress,
    underrealmChampionProgress: aiSignals.underrealmChampionProgress,
    underrealmReadinessScore: aiSignals.underrealmReadinessScore,
    underrealmCombatPressure: aiSignals.underrealmCombatPressure,
    mythsActiveRatio: aiSignals.mythsActiveRatio,
    mythsSeverity: aiSignals.mythsSeverity,
    festivalActive,
    festivalEligible,
  };
}

// Clamp one reward contribution to a symmetric absolute cap when provided.
function clampRewardAbs(value, maxAbs) {
  const numeric = Number(value || 0);
  const cap = Number(maxAbs || 0);
  if (!(cap > 0)) {
    return numeric;
  }
  return clamp(numeric, -cap, cap);
}

// Build one signed delta with optional clipping.
function getMetricDelta(current, previous, clipAbs) {
  return clampRewardAbs(Number(current || 0) - Number(previous || 0), clipAbs);
}

// Build one improvement delta (positive when current is lower than previous).
function getImprovementDelta(previous, current, clipAbs) {
  return clampRewardAbs(Number(previous || 0) - Number(current || 0), clipAbs);
}

// Function: computeReward.
function computeReward(prevMetrics, metrics, config, action) {
  const rewardConfig = (config.ai && config.ai.reward) || {};
  const stockpileAvgWeight = Number(rewardConfig.stockpileAvg ?? 1);
  const stockpileMinWeight = Number(rewardConfig.stockpileMin ?? 0.5);
  const waterStockpileWeight = Number(rewardConfig.waterStockpile ?? 0);
  const waterLowThreshold = clamp(Number(rewardConfig.waterLowThreshold ?? 0), 0, 1);
  const waterLowPenalty = Math.max(0, Number(rewardConfig.waterLowPenalty ?? 0));
  const waterLowExponent = Math.max(0.1, Number(rewardConfig.waterLowExponent ?? 1));
  const stockpilePopGate = rewardConfig.stockpilePopGate === true;
  const survivalWeight = Number(rewardConfig.survival ?? 0);
  const populationDeltaWeight = Number(rewardConfig.populationDelta ?? 0);
  const populationWeight = Number(rewardConfig.populationBalance ?? 1);
  const criticalNeedsWeight = Number(rewardConfig.criticalNeeds ?? 2);
  const idleWeight = Number(rewardConfig.idleAdults ?? 0.2);
  const stockpileAvgDeltaWeight = Number(rewardConfig.stockpileAvgDelta ?? 0);
  const stockpileMinDeltaWeight = Number(rewardConfig.stockpileMinDelta ?? 0);
  const populationBalanceDeltaWeight = Number(rewardConfig.populationBalanceDelta ?? 0);
  const criticalNeedsDeltaWeight = Number(rewardConfig.criticalNeedsDelta ?? 0);
  const idleAdultsDeltaWeight = Number(rewardConfig.idleAdultsDelta ?? 0);
  const raidExposureWeight = Number(rewardConfig.raidExposure ?? 0);
  const raidExposureEligibleWeight = Number(rewardConfig.raidExposureEligible ?? 0);
  const raidDeathsWeight = Number(rewardConfig.raidDeaths ?? 0);
  const raidLootWeight = Number(rewardConfig.raidLoot ?? 0);
  const raidPrepShelterWeight = Number(rewardConfig.raidPrepShelter ?? 0);
  const raidPrepDefenseWeight = Number(rewardConfig.raidPrepDefense ?? 0);
  const deathWeight = Number(rewardConfig.death ?? 2);
  const extinctionPenalty = Number(rewardConfig.extinction ?? 0);
  const ruinsSuccessWeight = Number(rewardConfig.ruinsSuccess ?? 0);
  const ruinsArtifactWeight = Number(rewardConfig.ruinsArtifact ?? 0);
  const ruinsFailureWeight = Number(rewardConfig.ruinsFailure ?? 0);
  const ruinsRoomClearWeight = Number(rewardConfig.ruinsRoomClear ?? 0);
  const underrealmDepthDeltaWeight = Number(rewardConfig.underrealmDepthDelta ?? 0);
  const underrealmChampionDeltaWeight = Number(rewardConfig.underrealmChampionDelta ?? 0);
  const underrealmReadinessDeltaWeight = Number(rewardConfig.underrealmReadinessDelta ?? 0);
  const underrealmPressureWeight = Number(rewardConfig.underrealmCombatPressure ?? 0);
  const underrealmPressureDeltaWeight = Number(rewardConfig.underrealmPressureDelta ?? 0);
  const mythsSeverityWeight = Number(rewardConfig.mythsSeverity ?? 0);
  const mythsSeverityDeltaWeight = Number(rewardConfig.mythsSeverityDelta ?? 0);
  const mythsActiveWeight = Number(rewardConfig.mythsActive ?? 0);
  const mythsActiveDeltaWeight = Number(rewardConfig.mythsActiveDelta ?? 0);
  const festivalActiveWeight = Number(
    rewardConfig.festival_active ?? rewardConfig.festivalActive ?? 0,
  );
  const festivalStartWeight = Number(
    rewardConfig.festival_start ?? rewardConfig.festivalStart ?? 0,
  );
  const festivalIntentWeight = Number(
    rewardConfig.festival_intent ?? rewardConfig.festivalIntent ?? 0,
  );
  const deltaClip = Math.max(0, Number(rewardConfig.deltaClip ?? 0));
  const eventClip = Math.max(0, Number(rewardConfig.eventClip ?? 0));
  const totalClip = Math.max(0, Number(rewardConfig.totalClip ?? 0));

  const prevPop = prevMetrics ? prevMetrics.population.total : metrics.population.total;
  const deaths = Math.max(0, prevPop - metrics.population.total);
  const extinct = metrics.population.total === 0 ? 1 : 0;
  const populationDelta = metrics.population.total - prevPop;
  const populationFactor = getPopulationFactor(metrics.population.total, config);
  const stockpileFactor = stockpilePopGate ? populationFactor : 1;

  const waterRatio = Number(metrics.stockpileRatio && metrics.stockpileRatio.water || 0);
  const waterDeficit = waterLowThreshold > 0 && waterRatio < waterLowThreshold
    ? Math.pow((waterLowThreshold - waterRatio) / waterLowThreshold, waterLowExponent)
    : 0;
  const raid = metrics.raid || {};
  const raidExposureBase = clamp(Number(raid.exposedRatio || 0), 0, 1);
  const raidExposurePenalty = raid.active
    ? raidExposureBase * raidExposureWeight
    : (raid.seasonEligible ? raidExposureBase * raidExposureEligibleWeight : 0);
  const housingRatio = clamp(Number(metrics.housingRatio || 0), 0, 1);
  const raidPrepGate = raid.active || raid.seasonEligible;
  const raidPrepShelter = raidPrepGate ? housingRatio * raidPrepShelterWeight : 0;
  const raidPrepDefense = raidPrepGate
    ? clamp(Number(raid.defenseRatio || 0), 0, 1) * raidPrepDefenseWeight
    : 0;
  const raidDeaths = Math.max(
    0,
    Number(metrics.raidDeaths || 0) - Number(prevMetrics ? prevMetrics.raidDeaths || 0 : 0),
  );
  const raidDeathsPenalty = raidDeaths * raidDeathsWeight;
  const raidLootDelta = getRaidLootDelta(prevMetrics ? prevMetrics.raidLoot : null, metrics.raidLoot);
  const raidLootPenalty = getRaidLootRatio(raidLootDelta, config) * raidLootWeight;
  const prevRuinsSuccesses = prevMetrics ? Number(prevMetrics.ruinsSuccesses || 0) : metrics.ruinsSuccesses;
  const prevRuinsFailures = prevMetrics ? Number(prevMetrics.ruinsFailures || 0) : metrics.ruinsFailures;
  const prevRuinsArtifacts = prevMetrics ? Number(prevMetrics.ruinsArtifacts || 0) : metrics.ruinsArtifacts;
  const prevRuinsRooms = prevMetrics ? Number(prevMetrics.ruinsRoomsCleared || 0) : metrics.ruinsRoomsCleared;
  const ruinsSuccessDelta = Math.max(0, Number(metrics.ruinsSuccesses || 0) - prevRuinsSuccesses);
  const ruinsFailureDelta = Math.max(0, Number(metrics.ruinsFailures || 0) - prevRuinsFailures);
  const ruinsArtifactDelta = Math.max(0, Number(metrics.ruinsArtifacts || 0) - prevRuinsArtifacts);
  const ruinsRoomsDelta = Math.max(0, Number(metrics.ruinsRoomsCleared || 0) - prevRuinsRooms);
  const festivalActive = Number(metrics.festivalActive || 0);
  const prevFestivalActive = prevMetrics ? Number(prevMetrics.festivalActive || 0) : 0;
  const festivalStarted = festivalActive > 0 && prevFestivalActive <= 0 ? 1 : 0;
  const festivalEligible = Number(metrics.festivalEligible || 0);
  const minWeight = Number((config.ai && config.ai.minWeight) ?? 0);
  const maxWeight = Number((config.ai && config.ai.maxWeight) ?? 1);
  const intentRaw = action ? Number(action.festivalIntent) : NaN;
  let festivalIntent = 0;
  if (Number.isFinite(intentRaw)) {
    if (maxWeight > minWeight) {
      festivalIntent = clamp((intentRaw - minWeight) / (maxWeight - minWeight), 0, 1);
    } else {
      festivalIntent = clamp(intentRaw, 0, 1);
    }
  }
  const festivalIntentBonus = festivalEligible > 0 ? festivalIntent * festivalIntentWeight : 0;

  const prevStockpileAvg = prevMetrics ? Number(prevMetrics.stockpileAvg || 0) : Number(metrics.stockpileAvg || 0);
  const prevStockpileMin = prevMetrics ? Number(prevMetrics.stockpileMin || 0) : Number(metrics.stockpileMin || 0);
  const prevPopulationBalance = prevMetrics
    ? Number(prevMetrics.populationBalance || 0)
    : Number(metrics.populationBalance || 0);
  const prevCriticalNeeds = prevMetrics
    ? Number(prevMetrics.criticalNeedsFraction || 0)
    : Number(metrics.criticalNeedsFraction || 0);
  const prevIdleAdults = prevMetrics
    ? Number(prevMetrics.idleAdultsFraction || 0)
    : Number(metrics.idleAdultsFraction || 0);
  const prevUnderrealmDepth = prevMetrics
    ? Number(prevMetrics.underrealmDepthProgress || 0)
    : Number(metrics.underrealmDepthProgress || 0);
  const prevUnderrealmChampion = prevMetrics
    ? Number(prevMetrics.underrealmChampionProgress || 0)
    : Number(metrics.underrealmChampionProgress || 0);
  const prevUnderrealmReadiness = prevMetrics
    ? Number(prevMetrics.underrealmReadinessScore || 0)
    : Number(metrics.underrealmReadinessScore || 0);
  const prevUnderrealmPressure = prevMetrics
    ? Number(prevMetrics.underrealmCombatPressure || 0)
    : Number(metrics.underrealmCombatPressure || 0);
  const prevMythsSeverity = prevMetrics
    ? Number(prevMetrics.mythsSeverity || 0)
    : Number(metrics.mythsSeverity || 0);
  const prevMythsActive = prevMetrics
    ? Number(prevMetrics.mythsActiveRatio || 0)
    : Number(metrics.mythsActiveRatio || 0);

  const stockpileAvgDelta = getMetricDelta(metrics.stockpileAvg, prevStockpileAvg, deltaClip);
  const stockpileMinDelta = getMetricDelta(metrics.stockpileMin, prevStockpileMin, deltaClip);
  const populationBalanceDelta = getMetricDelta(
    metrics.populationBalance,
    prevPopulationBalance,
    deltaClip,
  );
  const criticalNeedsDelta = getImprovementDelta(
    prevCriticalNeeds,
    metrics.criticalNeedsFraction,
    deltaClip,
  );
  const idleAdultsDelta = getImprovementDelta(
    prevIdleAdults,
    metrics.idleAdultsFraction,
    deltaClip,
  );
  const underrealmDepthDelta = Math.max(
    0,
    getMetricDelta(metrics.underrealmDepthProgress, prevUnderrealmDepth, deltaClip),
  );
  const underrealmChampionDelta = Math.max(
    0,
    getMetricDelta(metrics.underrealmChampionProgress, prevUnderrealmChampion, deltaClip),
  );
  const underrealmReadinessDelta = getMetricDelta(
    metrics.underrealmReadinessScore,
    prevUnderrealmReadiness,
    deltaClip,
  );
  const underrealmPressureDelta = getImprovementDelta(
    prevUnderrealmPressure,
    metrics.underrealmCombatPressure,
    deltaClip,
  );
  const mythsSeverityDelta = getImprovementDelta(
    prevMythsSeverity,
    metrics.mythsSeverity,
    deltaClip,
  );
  const mythsActiveDelta = getImprovementDelta(
    prevMythsActive,
    metrics.mythsActiveRatio,
    deltaClip,
  );

  const coreReward = (((metrics.stockpileAvg * stockpileAvgWeight)
    + (metrics.stockpileMin * stockpileMinWeight)
    + (waterRatio * waterStockpileWeight)) * stockpileFactor)
    + (populationFactor * survivalWeight)
    + (populationDelta * populationDeltaWeight)
    + (metrics.populationBalance * populationWeight)
    - (metrics.criticalNeedsFraction * criticalNeedsWeight)
    - (metrics.idleAdultsFraction * idleWeight)
    - (waterDeficit * waterLowPenalty * stockpileFactor)
    + (stockpileAvgDelta * stockpileAvgDeltaWeight)
    + (stockpileMinDelta * stockpileMinDeltaWeight)
    + (populationBalanceDelta * populationBalanceDeltaWeight)
    + (criticalNeedsDelta * criticalNeedsDeltaWeight)
    + (idleAdultsDelta * idleAdultsDeltaWeight);

  const progressionReward = (underrealmDepthDelta * underrealmDepthDeltaWeight)
    + (underrealmChampionDelta * underrealmChampionDeltaWeight)
    + (underrealmReadinessDelta * underrealmReadinessDeltaWeight)
    + (underrealmPressureDelta * underrealmPressureDeltaWeight)
    - (Number(metrics.underrealmCombatPressure || 0) * underrealmPressureWeight)
    + (mythsSeverityDelta * mythsSeverityDeltaWeight)
    + (mythsActiveDelta * mythsActiveDeltaWeight)
    - (Number(metrics.mythsSeverity || 0) * mythsSeverityWeight)
    - (Number(metrics.mythsActiveRatio || 0) * mythsActiveWeight);

  const eventRewardRaw = raidPrepShelter
    + raidPrepDefense
    + (ruinsSuccessDelta * ruinsSuccessWeight)
    + (ruinsArtifactDelta * ruinsArtifactWeight)
    + (ruinsRoomsDelta * ruinsRoomClearWeight)
    + (festivalActive * festivalActiveWeight)
    + (festivalStarted * festivalStartWeight)
    + festivalIntentBonus
    + progressionReward
    - raidExposurePenalty
    - raidDeathsPenalty
    - raidLootPenalty
    - (ruinsFailureDelta * ruinsFailureWeight);
  const eventReward = clampRewardAbs(eventRewardRaw, eventClip);

  const rewardRaw = coreReward
    + eventReward
    - (deaths * deathWeight)
    - (extinct * extinctionPenalty);
  return clampRewardAbs(rewardRaw, totalClip);
}

// Function: getPopulationFactor.
function getPopulationFactor(population, config) {
  const reproduction = config.population && config.population.reproduction;
  const softCap = Number(reproduction && reproduction.softCap || 0);
  if (softCap > 0) {
    return clamp(population / softCap, 0, 1);
  }
  return population > 0 ? 1 : 0;
}

// Function: getDoneStatus.
function getDoneStatus(state, config, metrics) {
  const aiConfig = config.ai || {};
  const maxTicks = Number(aiConfig.maxTicks || 0);
  const simMaxTicks = Number(config.simulation && config.simulation.maxTicks || 0);
  const limit = maxTicks > 0 ? maxTicks : simMaxTicks;
  if (state.dwarves.length === 0) {
    return { done: true, reason: 'extinction' };
  }
  if (limit > 0 && state.tick >= limit) {
    return { done: true, reason: 'maxTicks' };
  }

  const termination = aiConfig.termination || {};
  if (termination.enabled === true) {
    const safeMetrics = metrics || computeMetrics(state, config);
    if (shouldTerminateStable(state, safeMetrics, termination)) {
      return { done: true, reason: 'stable' };
    }
  }

  return { done: false, reason: null };
}

// Function: shouldTerminateStable.
function shouldTerminateStable(state, metrics, termination) {
  if (!metrics) {
    return false;
  }
  const minTicks = Math.max(0, Number(termination.minTicks ?? 0));
  const stableTicksTarget = Math.max(1, Number(termination.stableTicks ?? 0));
  const minStockpileAvg = clamp(Number(termination.minStockpileAvg ?? 0), 0, 1);
  const minStockpileMin = clamp(Number(termination.minStockpileMin ?? 0), 0, 1);
  const maxCriticalNeeds = clamp(Number(termination.maxCriticalNeeds ?? 1), 0, 1);
  const maxIdleAdults = clamp(Number(termination.maxIdleAdults ?? 1), 0, 1);
  const minPopulationBalance = clamp(Number(termination.minPopulationBalance ?? 0), 0, 1);
  const maxUnderrealmCombatPressure = clamp(
    Number(termination.maxUnderrealmCombatPressure ?? 1),
    0,
    1,
  );
  const maxMythsSeverity = clamp(Number(termination.maxMythsSeverity ?? 1), 0, 1);
  const allowDuringRaid = termination.allowDuringRaid === true;
  const stockpileEps = Math.max(0, Number(termination.stockpileEps ?? 0.01));
  const resourceEps = Math.max(0, Number(termination.resourceEps ?? stockpileEps));
  const progressEps = Math.max(0, Number(termination.progressEps ?? stockpileEps));

  const populationTotal = metrics.population && Number(metrics.population.total || 0);
  const raidActive = Boolean(metrics.raid && metrics.raid.active);
  const healthy = populationTotal > 0
    && Number(metrics.stockpileAvg || 0) >= minStockpileAvg
    && Number(metrics.stockpileMin || 0) >= minStockpileMin
    && Number(metrics.criticalNeedsFraction || 0) <= maxCriticalNeeds
    && Number(metrics.idleAdultsFraction || 0) <= maxIdleAdults
    && Number(metrics.populationBalance || 0) >= minPopulationBalance
    && Number(metrics.underrealmCombatPressure || 0) <= maxUnderrealmCombatPressure
    && Number(metrics.mythsSeverity || 0) <= maxMythsSeverity
    && (allowDuringRaid || !raidActive);

  const tracker = state.termination || {};
  const lastTick = Number.isFinite(tracker.lastTick) ? tracker.lastTick : state.tick;
  const deltaTicks = Math.max(0, state.tick - lastTick);
  const prevAvg = Number(tracker.stockpileAvg);
  const avg = Number(metrics.stockpileAvg || 0);
  const avgDelta = Number.isFinite(prevAvg) ? Math.abs(avg - prevAvg) : 0;
  const scaledEps = stockpileEps <= 0 ? Infinity : stockpileEps * Math.max(1, deltaTicks);
  const stableDelta = avgDelta <= scaledEps;
  const ratios = metrics.stockpileRatio || {};
  const prevRatios = tracker.stockpileRatios || {};
  const resourceList = Array.isArray(termination.resources) && termination.resources.length > 0
    ? termination.resources
    : Object.keys(ratios);
  let maxResourceDelta = 0;
  const nextRatios = {};
  for (const resource of resourceList) {
    const current = Number(ratios[resource] ?? 0);
    const prev = Number(prevRatios[resource]);
    const delta = Number.isFinite(prev) ? Math.abs(current - prev) : 0;
    if (delta > maxResourceDelta) {
      maxResourceDelta = delta;
    }
    nextRatios[resource] = current;
  }
  const scaledResourceEps = resourceEps <= 0 ? Infinity : resourceEps * Math.max(1, deltaTicks);
  const stableResources = maxResourceDelta <= scaledResourceEps;
  const progressScore = clamp(
    (Number(metrics.populationBalance || 0) * 0.4)
      + (Number(metrics.underrealmDepthProgress || 0) * 0.3)
      + (Number(metrics.underrealmChampionProgress || 0) * 0.2)
      + (Number(metrics.underrealmReadinessScore || 0) * 0.1),
    0,
    1,
  );
  const prevProgressScore = Number(tracker.progressScore);
  const progressDelta = Number.isFinite(prevProgressScore)
    ? Math.abs(progressScore - prevProgressScore)
    : 0;
  const scaledProgressEps = progressEps <= 0 ? Infinity : progressEps * Math.max(1, deltaTicks);
  const stableProgress = progressDelta <= scaledProgressEps;

  let stableTicks = Number(tracker.stableTicks || 0);
  if (state.tick < minTicks) {
    stableTicks = 0;
  } else if (healthy && stableDelta && stableResources && stableProgress) {
    stableTicks += deltaTicks > 0 ? deltaTicks : 1;
  } else {
    stableTicks = 0;
  }

  state.termination = {
    lastTick: state.tick,
    stockpileAvg: avg,
    stockpileRatios: nextRatios,
    progressScore,
    stableTicks,
  };

  return state.tick >= minTicks && stableTicksTarget > 0 && stableTicks >= stableTicksTarget;
}

// Function: countLifeStages.
function countLifeStages(dwarves) {
  const counts = { total: dwarves.length, child: 0, adult: 0, elder: 0 };
  for (const dwarf of dwarves) {
    const stage = dwarf.lifeStage || 'adult';
    if (counts[stage] !== undefined) {
      counts[stage] += 1;
    } else {
      counts.adult += 1;
    }
  }
  return counts;
}

// Function: averageNeeds.
function averageNeeds(dwarves) {
  const totals = {};
  const count = dwarves.length || 1;

  for (const dwarf of dwarves) {
    for (const [need, value] of Object.entries(dwarf.needs)) {
      totals[need] = (totals[need] || 0) + Number(value || 0);
    }
  }

  for (const need of Object.keys(totals)) {
    totals[need] = totals[need] / count;
  }

  return totals;
}

// Function: getCriticalNeedsFraction.
function getCriticalNeedsFraction(dwarves, config) {
  if (dwarves.length === 0) {
    return 0;
  }
  const aiConfig = config.ai || {};
  const threshold = Number(aiConfig.criticalNeedThreshold ?? 0.9);
  let critical = 0;

  for (const dwarf of dwarves) {
    const needs = dwarf.needs || {};
    const over = Object.values(needs).some((value) => Number(value || 0) >= threshold);
    if (over) {
      critical += 1;
    }
  }

  return critical / dwarves.length;
}

// Function: getIdleAdultsFraction.
function getIdleAdultsFraction(dwarves, config) {
  const adults = dwarves.filter((dwarf) => dwarf.lifeStage === 'adult');
  if (adults.length === 0) {
    return 0;
  }
  const idleAdults = adults.filter((dwarf) => !dwarf.job).length;
  return idleAdults / adults.length;
}

// Function: getPopulationBalance.
function getPopulationBalance(state, config) {
  const reproduction = config.population && config.population.reproduction;
  const softCap = Number(reproduction && reproduction.softCap || 0);
  if (softCap <= 0) {
    return 1;
  }
  const ratio = 1 - Math.abs(state.dwarves.length - softCap) / softCap;
  return clamp(ratio, 0, 1);
}

// Function: getNodeRatio.
function getNodeRatio(nodes) {
  const totals = {};
  const counts = {};

  for (const node of nodes) {
    const capacity = Math.max(0, Number(node.capacity || 0));
    const remaining = Math.max(0, Number(node.remaining || 0));
    totals[node.id] = (totals[node.id] || 0) + remaining;
    counts[node.id] = (counts[node.id] || 0) + capacity;
  }

  const ratios = {};
  for (const [resource, totalCapacity] of Object.entries(counts)) {
    const totalRemaining = totals[resource] || 0;
    ratios[resource] = totalCapacity > 0 ? clamp(totalRemaining / totalCapacity, 0, 1) : 0;
  }

  return ratios;
}

// Function: buildScenarioConfig.
function buildScenarioConfig(base, options) {
  const aiConfig = base.ai || {};
  const training = aiConfig.training || {};
  const randomization = training.randomization || {};
  const trainingOverrides = isPlainObject(training.configOverrides)
    ? training.configOverrides
    : null;
  const evalOverrides = isPlainObject(training.evalOverrides)
    ? training.evalOverrides
    : null;
  const scenarios = Array.isArray(training.scenarios) ? training.scenarios : [];
  const trainingFlag = options.training !== undefined ? options.training : true;
  const evalFlag = options.eval === true;
  const enabled = training.enabled !== false && trainingFlag !== false;
  const requestedDifficulty = options.difficulty !== undefined ? options.difficulty : training.difficultyStart;
  const difficulty = clamp(Number(requestedDifficulty ?? 0), 0, 1);
  const requestedScenario = typeof options.scenario === 'string' ? options.scenario : null;
  const scenarioDef = requestedScenario
    ? scenarios.find((entry) => entry && entry.name === requestedScenario) || null
    : null;
  const hasScenarioOverrides = Boolean(scenarioDef && scenarioDef.overrides);
  const hasTrainingOverrides = Boolean(
    enabled && trainingOverrides && Object.keys(trainingOverrides).length > 0,
  );
  const hasEvalOverrides = Boolean(
    evalFlag && evalOverrides && Object.keys(evalOverrides).length > 0,
  );
  const shouldClone = enabled || requestedScenario || hasScenarioOverrides || hasTrainingOverrides || hasEvalOverrides;
  const config = shouldClone ? cloneConfig(base) : base;

  if (!config.ai) {
    config.ai = {};
  }
  config.ai.difficulty = difficulty;

  if (hasTrainingOverrides) {
    mergeDeep(config, trainingOverrides);
  }

  if (hasEvalOverrides) {
    mergeDeep(config, evalOverrides);
  }

  if (hasScenarioOverrides) {
    mergeDeep(config, scenarioDef.overrides);
  }

  if (!enabled || options.randomize === false) {
    return {
      config,
      meta: {
        enabled: false,
        difficulty,
        name: requestedScenario,
        overridesApplied: hasScenarioOverrides,
        trainingOverridesApplied: hasTrainingOverrides,
        evalOverridesApplied: hasEvalOverrides,
        missing: Boolean(requestedScenario && !scenarioDef),
      },
      initialTick: null,
    };
  }

  const stockpileScale = scaleWithDifficulty(randomization.stockpileScale, difficulty, 1);
  const nodeCountScale = scaleWithDifficulty(randomization.nodeCountScale, difficulty, 1);
  const nodeCapacityScale = scaleWithDifficulty(randomization.nodeCapacityScale, difficulty, 1);
  const nodeRegenScale = scaleWithDifficulty(randomization.nodeRegenScale, difficulty, 1);
  const needDecayScale = scaleWithDifficulty(randomization.needDecayScale, difficulty, 1);

  applyStockpileScale(config, stockpileScale, randomization.stockpileFloor);
  applyNodeCountScale(config, nodeCountScale, randomization.nodeCountMin);
  applyNodeCapacityScale(config, nodeCapacityScale);
  applyNodeRegenScale(config, nodeRegenScale);
  applyNeedDecayScale(config, needDecayScale);

  const seasonInfo = getRandomSeasonStart(config, randomization);
  const initialTick = seasonInfo ? seasonInfo.initialTick : null;

  return {
    config,
    initialTick,
    meta: {
      enabled: true,
      difficulty,
      name: requestedScenario,
      overridesApplied: hasScenarioOverrides,
      trainingOverridesApplied: hasTrainingOverrides,
      evalOverridesApplied: hasEvalOverrides,
      missing: Boolean(requestedScenario && !scenarioDef),
      stockpileScale,
      nodeCountScale,
      nodeCapacityScale,
      nodeRegenScale,
      needDecayScale,
      season: seasonInfo ? seasonInfo.season : null,
    },
  };
}

// Function: cloneConfig.
function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

// Function: mergeDeep.
function mergeDeep(target, source) {
  if (!isPlainObject(source)) {
    return target;
  }
  const output = target && typeof target === 'object' ? target : {};

  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      output[key] = value.slice();
    } else if (isPlainObject(value)) {
      const baseValue = isPlainObject(output[key]) ? output[key] : {};
      output[key] = mergeDeep(baseValue, value);
    } else {
      output[key] = value;
    }
  }

  return output;
}

// Function: isPlainObject.
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Function: scaleWithDifficulty.
function scaleWithDifficulty(range, difficulty, fallback) {
  if (!range) {
    return fallback;
  }
  const parsed = parseRange(range, fallback);
  if (!parsed) {
    return fallback;
  }
  const target = randomBetween(parsed.min, parsed.max);
  return lerp(1, target, difficulty);
}

// Function: parseRange.
function parseRange(range, fallback) {
  const min = Number(range.min ?? range[0] ?? fallback);
  const max = Number(range.max ?? range[1] ?? min);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }
  return {
    min: Math.min(min, max),
    max: Math.max(min, max),
  };
}

// Function: lerp.
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Function: randomBetween.
function randomBetween(min, max) {
  const low = Number(min);
  const high = Number(max);
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    return low;
  }
  if (low === high) {
    return low;
  }
  return low + (high - low) * Math.random();
}

// Function: applyStockpileScale.
function applyStockpileScale(config, scale, floorMap = {}) {
  const resources = config.resources || {};
  const stockpile = resources.stockpile || {};
  for (const [resource, value] of Object.entries(stockpile)) {
    const base = Number(value || 0);
    const floor = Number(floorMap[resource] ?? 0);
    const scaled = Math.max(floor, Math.round(base * scale));
    stockpile[resource] = scaled;
  }
}

// Function: applyNodeCountScale.
function applyNodeCountScale(config, scale, minCount) {
  const resources = config.resources || {};
  const nodes = resources.nodes || {};
  const minMap = typeof minCount === 'object' && minCount ? minCount : null;
  const fallbackMin = Number(minMap ? 0 : minCount || 0);

  for (const [resource, count] of Object.entries(nodes)) {
    const base = Number(count || 0);
    const minValue = minMap ? Number(minMap[resource] ?? 0) : fallbackMin;
    const scaled = Math.max(minValue, Math.round(base * scale));
    nodes[resource] = scaled;
  }
}

// Function: applyNodeCapacityScale.
function applyNodeCapacityScale(config, scale) {
  const resources = config.resources || {};
  if (resources.defaultNodeCapacity !== undefined) {
    const base = Number(resources.defaultNodeCapacity || 0);
    resources.defaultNodeCapacity = Math.max(1, Math.round(base * scale));
  }
  const capacities = resources.nodeCapacity || {};
  for (const [resource, value] of Object.entries(capacities)) {
    const base = Number(value || 0);
    capacities[resource] = Math.max(1, Math.round(base * scale));
  }
}

// Function: applyNodeRegenScale.
function applyNodeRegenScale(config, scale) {
  const resources = config.resources || {};
  const regen = resources.nodeRegen || {};
  if (regen.enabled === false) {
    return;
  }
  if (regen.amount !== undefined) {
    const base = Number(regen.amount || 0);
    if (base > 0) {
      regen.amount = Math.max(1, Math.round(base * scale));
    }
  }
}

// Function: applyNeedDecayScale.
function applyNeedDecayScale(config, scale) {
  const needs = config.needs || {};
  const decay = needs.decayPerTick || {};
  for (const [need, value] of Object.entries(decay)) {
    decay[need] = Number(value || 0) * scale;
  }
}

// Function: getRandomSeasonStart.
function getRandomSeasonStart(config, randomization) {
  const seasons = config.seasons || {};
  if (seasons.enabled === false) {
    return null;
  }
  if (randomization.seasonStartRandom !== true) {
    return null;
  }
  const order = Array.isArray(seasons.order) && seasons.order.length > 0
    ? seasons.order
    : ['spring', 'summer', 'autumn', 'winter'];
  const duration = Math.max(1, Number(seasons.durationTicks || 200));
  const seasonIndex = Math.floor(Math.random() * order.length);
  const tickInSeason = randomization.seasonTickRandom
    ? Math.max(1, Math.floor(Math.random() * duration) + 1)
    : 1;
  const initialTick = (seasonIndex * duration + tickInSeason) - 1;

  return {
    initialTick,
    season: {
      name: order[seasonIndex],
      index: seasonIndex,
      tickInSeason,
      duration,
    },
  };
}

// Function: writeResponse.
function writeResponse(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
