'use strict';

const fs = require('fs');
const path = require('path');
const { clamp } = require('./utils');

const DEFAULT_FEATURES = [
  'shortage',
  'nodeScarcity',
  'criticalNeeds',
  'idleAdults',
  'populationBalance',
  'seasonIndex',
  'seasonProgress',
  'weatherSeverity',
  'weatherTimeLeft',
];

function loadPolicy(policyPath) {
  if (!policyPath) {
    return null;
  }
  const resolved = path.resolve(policyPath);
  if (!fs.existsSync(resolved)) {
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const featureNames = Array.isArray(raw.featureNames) && raw.featureNames.length > 0
    ? raw.featureNames
    : DEFAULT_FEATURES;
  const minWeight = Number(raw.minWeight ?? 0);
  const maxWeight = Number(raw.maxWeight ?? 2);
  const type = raw.type || (Array.isArray(raw.layers) ? 'mlp' : 'linear');

  if (type === 'mlp') {
    return {
      type,
      path: resolved,
      resources: raw.resources || [],
      featureNames,
      minWeight,
      maxWeight,
      activation: raw.activation || 'tanh',
      outputActivation: raw.outputActivation || 'tanh',
      layers: Array.isArray(raw.layers) ? raw.layers : [],
    };
  }

  return {
    type: 'linear',
    path: resolved,
    resources: raw.resources || [],
    weights: raw.weights || {},
    biases: raw.biases || {},
    featureNames,
    minWeight,
    maxWeight,
  };
}

function selectAction(state, config, policy) {
  if (!policy) {
    return null;
  }
  const obs = buildObservation(state, config);
  const weights = {};
  const resources = policy.resources && policy.resources.length > 0
    ? policy.resources
    : Object.keys(obs.stockpileRatio || {});

  if (policy.type === 'mlp') {
    const input = buildObservationVector(obs, resources, config, policy.featureNames);
    const output = forwardNetwork(
      policy.layers,
      input,
      policy.activation,
      policy.outputActivation,
    );
    if (!output || output.length < resources.length) {
      return null;
    }
    for (let i = 0; i < resources.length; i += 1) {
      const resource = resources[i];
      const value = clamp(Number(output[i] ?? 0), -1, 1);
      weights[resource] = scaleAction(value, policy.minWeight, policy.maxWeight);
    }
    return { weights };
  }

  for (const resource of resources) {
    const featureValues = buildFeatures(obs, resource, config, policy.featureNames);
    const params = policy.weights[resource] || [];
    const bias = Number(policy.biases[resource] || 0);
    let mean = bias;
    for (let i = 0; i < featureValues.length; i += 1) {
      mean += Number(params[i] || 0) * featureValues[i];
    }
    weights[resource] = clamp(mean, policy.minWeight, policy.maxWeight);
  }

  return { weights };
}

function buildObservationVector(obs, resources, config, featureNames) {
  const vector = [];
  for (const resource of resources) {
    vector.push(...buildFeatures(obs, resource, config, featureNames));
  }
  return vector;
}

function forwardNetwork(layers, input, activation, outputActivation) {
  if (!layers || layers.length === 0) {
    return null;
  }
  let values = input.slice();
  for (let i = 0; i < layers.length; i += 1) {
    const layer = layers[i] || {};
    const weights = Array.isArray(layer.weights) ? layer.weights : [];
    const biases = Array.isArray(layer.biases) ? layer.biases : [];
    const next = new Array(weights.length).fill(0);
    for (let row = 0; row < weights.length; row += 1) {
      const rowWeights = weights[row] || [];
      let sum = Number(biases[row] || 0);
      for (let col = 0; col < rowWeights.length; col += 1) {
        sum += Number(rowWeights[col] || 0) * Number(values[col] || 0);
      }
      next[row] = sum;
    }
    values = next;
    if (i < layers.length - 1) {
      values = applyActivation(values, activation);
    } else if (outputActivation) {
      values = applyActivation(values, outputActivation);
    }
  }
  return values;
}

function applyActivation(values, activation) {
  const mode = String(activation || '').toLowerCase();
  if (mode === 'relu') {
    return values.map((value) => Math.max(0, value));
  }
  if (mode === 'tanh') {
    return values.map((value) => Math.tanh(value));
  }
  return values;
}

function scaleAction(value, minWeight, maxWeight) {
  const span = maxWeight - minWeight;
  if (span <= 0) {
    return minWeight;
  }
  return minWeight + (value + 1) * 0.5 * span;
}

function buildObservation(state, config) {
  const targets = (config.resources && config.resources.targets) || {};
  const stockpileRatio = {};

  for (const [resource, targetValue] of Object.entries(targets)) {
    const target = Number(targetValue || 0);
    if (target <= 0) {
      continue;
    }
    const current = Number(state.stockpile[resource] || 0);
    stockpileRatio[resource] = clamp(current / target, 0, 1);
  }

  return {
    season: state.season || null,
    weather: buildWeatherObservation(state, config),
    stockpileRatio,
    nodeRatio: getNodeRatio(state.nodes || []),
    criticalNeedsFraction: getCriticalNeedsFraction(state.dwarves || [], config),
    idleAdultsFraction: getIdleAdultsFraction(state.dwarves || []),
    populationBalance: getPopulationBalance(state, config),
  };
}

function buildFeatures(obs, resource, config, featureNames) {
  const ratio = Number((obs.stockpileRatio && obs.stockpileRatio[resource]) ?? 1);
  const nodeRatio = Number((obs.nodeRatio && obs.nodeRatio[resource]) ?? 1);
  const shortage = clamp(1 - ratio, 0, 1);
  const nodeScarcity = clamp(1 - nodeRatio, 0, 1);
  const criticalNeeds = clamp(Number(obs.criticalNeedsFraction || 0), 0, 1);
  const idleAdults = clamp(Number(obs.idleAdultsFraction || 0), 0, 1);
  const populationBalance = clamp(Number(obs.populationBalance || 0), 0, 1);
  const seasonIndex = getSeasonIndex(obs.season, config);
  const seasonProgress = getSeasonProgress(obs.season);
  const weather = obs.weather || {};
  const weatherSeverity = clamp(Number(weather.severity || 0), 0, 1);
  const weatherTimeLeft = clamp(Number(weather.timeLeft || 0), 0, 1);

  const featureMap = {
    shortage,
    nodeScarcity,
    criticalNeeds,
    idleAdults,
    populationBalance,
    seasonIndex,
    seasonProgress,
    weatherSeverity,
    weatherTimeLeft,
  };

  return featureNames.map((name) => Number(featureMap[name] ?? 0));
}

function buildWeatherObservation(state, config) {
  if (!state || !state.weather || !state.weather.type) {
    return { type: null, severity: 0, timeLeft: 0 };
  }
  const weatherConfig = (config && config.weather) || {};
  const states = weatherConfig.states || {};
  const type = state.weather.type;
  const def = states[type] || {};
  const configured = Number(def.severity);
  const severity = Number.isFinite(configured)
    ? clamp(configured, 0, 1)
    : getFallbackWeatherSeverity(type);
  const duration = Number(state.weather.duration || 0);
  const remaining = Number(state.weather.ticksRemaining || 0);
  const timeLeft = duration > 0 ? clamp(remaining / duration, 0, 1) : 0;
  return { type, severity, timeLeft };
}

function getFallbackWeatherSeverity(type) {
  const fallback = {
    clear: 0,
    rain: 0.35,
    storm: 0.75,
    drought: 1,
    cold: 0.6,
  };
  return clamp(Number(fallback[type] || 0), 0, 1);
}

function getSeasonIndex(season, config) {
  if (!season) {
    return 0;
  }
  const order = (config.seasons && config.seasons.order) || [];
  const maxIndex = Math.max(1, order.length - 1);
  return clamp(Number(season.index || 0) / maxIndex, 0, 1);
}

function getSeasonProgress(season) {
  if (!season) {
    return 0;
  }
  const tick = Number(season.tickInSeason || 0);
  const duration = Math.max(1, Number(season.duration || 1));
  return clamp(tick / duration, 0, 1);
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

function getIdleAdultsFraction(dwarves) {
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

module.exports = { loadPolicy, selectAction };
