'use strict';

const readline = require('readline');
const { loadConfig } = require('./src/config');
const { buildRuntime } = require('./src/runtime');
const { createInitialState } = require('./src/state');
const { stepState } = require('./src/simulation');
const { clamp } = require('./src/utils');

const baseConfig = loadConfig();
const nativeRandom = Math.random;
const runtime = buildRuntime(baseConfig.display, {
  columns: Number(baseConfig.display.width || 80),
  rows: Number(baseConfig.display.height || 24),
});

let state = null;
let prevMetrics = null;
let activeConfig = baseConfig;
let scenarioMeta = null;

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
    writeResponse(buildResponse(0, false));
    return;
  }

  if (cmd === 'step') {
    const action = payload.action || {};
    const ticks = getStepTicks(action, activeConfig);
    for (let i = 0; i < ticks; i += 1) {
      stepState(state, activeConfig, runtime, action);
    }
    const metrics = computeMetrics(state, activeConfig);
    const reward = computeReward(prevMetrics, metrics, activeConfig);
    prevMetrics = metrics;
    const doneStatus = getDoneStatus(state, activeConfig, metrics);
    writeResponse(buildResponse(reward, doneStatus.done, doneStatus.reason));
    return;
  }

  if (cmd === 'close') {
    writeResponse({ ok: true });
    process.exit(0);
    return;
  }

  writeResponse({ error: 'unknown_command' });
});

function resetState(options = {}) {
  const scenario = buildScenarioConfig(baseConfig, options);
  activeConfig = scenario.config;
  scenarioMeta = scenario.meta;
  state = createInitialState(activeConfig, runtime);
  if (scenario.initialTick !== null) {
    state.tick = scenario.initialTick;
  }
  prevMetrics = computeMetrics(state, activeConfig);
}

function applySeed(seed) {
  if (seed === undefined || seed === null) {
    Math.random = nativeRandom;
    return;
  }
  const intSeed = Number(seed) >>> 0;
  Math.random = mulberry32(intSeed);
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function random() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function getStepTicks(action, config) {
  const aiConfig = config.ai || {};
  const actionTicks = Number(action.ticks);
  if (Number.isFinite(actionTicks) && actionTicks > 0) {
    return Math.floor(actionTicks);
  }
  return Math.max(1, Number(aiConfig.stepTicks || 10));
}

function buildResponse(reward, done, doneReason) {
  const metrics = computeMetrics(state, activeConfig);
  const obs = buildObservation(state, activeConfig, metrics);
  return {
    obs,
    reward: Number(reward || 0),
    done: Boolean(done),
    info: {
      tick: state.tick,
      population: metrics.population.total,
      births: Number(state.birthsCount || 0),
      deaths: Number(state.deathsCount || 0),
      doneReason: doneReason || null,
      scenario: scenarioMeta,
      debug: buildDebugInfo(state, activeConfig, metrics),
    },
  };
}

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
  const fieldNodes = (state.nodes || []).filter((node) => node.source === 'field' && node.id === 'food_raw');
  const fieldNodeRatio = getNodeRatioForNodes(fieldNodes);
  const merchantStats = state.merchantStats || {};
  const merchantTicks = Number(merchantStats.ticks || 0);
  const merchantTradesPerTick = merchantTicks > 0
    ? Number(merchantStats.trades || 0) / merchantTicks
    : 0;
  const merchantGivenPerTick = scaleMerchantMap(merchantStats.given, merchantTicks);
  const merchantReceivedPerTick = scaleMerchantMap(merchantStats.received, merchantTicks);

  return {
    deaths: {
      starvation: Number(deaths.starvation || 0),
      oldAge: Number(deaths.oldAge || 0),
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
    nodes: { ...metrics.nodeRatio },
    needsAvg: { ...metrics.needsAvg },
    criticalNeedsFraction: Number(metrics.criticalNeedsFraction || 0),
    idleAdultsFraction: Number(metrics.idleAdultsFraction || 0),
  };
}

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

function getSeasonValue(state, key, fallback) {
  if (!state || !state.season || !state.season.modifiers) {
    return fallback;
  }
  const value = state.season.modifiers[key];
  return Number.isFinite(value) ? Number(value) : fallback;
}

function getStockpileRatio(state, config, resourceId) {
  const targets = (config.resources && config.resources.targets) || {};
  const target = Number(targets[resourceId] || 0);
  if (target <= 0) {
    return 1;
  }
  const current = Number(state.stockpile[resourceId] || 0);
  return clamp(current / target, 0, 1);
}

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

function buildObservation(state, config, metrics) {
  const weatherSeverity = getWeatherSeverity(state, config);
  const weatherTimeLeft = getWeatherTimeLeft(state);
  return {
    tick: state.tick,
    season: state.season || null,
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
  };
}

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
  };
}

function computeReward(prevMetrics, metrics, config) {
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
  const deathWeight = Number(rewardConfig.death ?? 2);
  const extinctionPenalty = Number(rewardConfig.extinction ?? 0);

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
  const reward = ((metrics.stockpileAvg * stockpileAvgWeight)
    + (metrics.stockpileMin * stockpileMinWeight)
    + (waterRatio * waterStockpileWeight)) * stockpileFactor
    + (populationFactor * survivalWeight)
    + (populationDelta * populationDeltaWeight)
    + (metrics.populationBalance * populationWeight)
    - (metrics.criticalNeedsFraction * criticalNeedsWeight)
    - (metrics.idleAdultsFraction * idleWeight)
    - (waterDeficit * waterLowPenalty * stockpileFactor)
    - (deaths * deathWeight)
    - (extinct * extinctionPenalty);

  return reward;
}

function getPopulationFactor(population, config) {
  const reproduction = config.population && config.population.reproduction;
  const softCap = Number(reproduction && reproduction.softCap || 0);
  if (softCap > 0) {
    return clamp(population / softCap, 0, 1);
  }
  return population > 0 ? 1 : 0;
}

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
  const stockpileEps = Math.max(0, Number(termination.stockpileEps ?? 0.01));
  const resourceEps = Math.max(0, Number(termination.resourceEps ?? stockpileEps));

  const populationTotal = metrics.population && Number(metrics.population.total || 0);
  const healthy = populationTotal > 0
    && Number(metrics.stockpileAvg || 0) >= minStockpileAvg
    && Number(metrics.stockpileMin || 0) >= minStockpileMin
    && Number(metrics.criticalNeedsFraction || 0) <= maxCriticalNeeds
    && Number(metrics.idleAdultsFraction || 0) <= maxIdleAdults
    && Number(metrics.populationBalance || 0) >= minPopulationBalance;

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

  let stableTicks = Number(tracker.stableTicks || 0);
  if (state.tick < minTicks) {
    stableTicks = 0;
  } else if (healthy && stableDelta && stableResources) {
    stableTicks += deltaTicks > 0 ? deltaTicks : 1;
  } else {
    stableTicks = 0;
  }

  state.termination = {
    lastTick: state.tick,
    stockpileAvg: avg,
    stockpileRatios: nextRatios,
    stableTicks,
  };

  return state.tick >= minTicks && stableTicksTarget > 0 && stableTicks >= stableTicksTarget;
}

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

function getIdleAdultsFraction(dwarves, config) {
  const adults = dwarves.filter((dwarf) => dwarf.lifeStage === 'adult');
  if (adults.length === 0) {
    return 0;
  }
  const idleAdults = adults.filter((dwarf) => !dwarf.job).length;
  return idleAdults / adults.length;
}

function getPopulationBalance(state, config) {
  const reproduction = config.population && config.population.reproduction;
  const softCap = Number(reproduction && reproduction.softCap || 0);
  if (softCap <= 0) {
    return 1;
  }
  const ratio = 1 - Math.abs(state.dwarves.length - softCap) / softCap;
  return clamp(ratio, 0, 1);
}

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

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

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

function lerp(a, b, t) {
  return a + (b - a) * t;
}

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

function applyNeedDecayScale(config, scale) {
  const needs = config.needs || {};
  const decay = needs.decayPerTick || {};
  for (const [need, value] of Object.entries(decay)) {
    decay[need] = Number(value || 0) * scale;
  }
}

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

function writeResponse(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
