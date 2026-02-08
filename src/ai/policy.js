'use strict';

const fs = require('fs');
const path = require('path');
const { clamp } = require('../utils');
const { buildObservation, buildFeatures } = require('./observation');

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
  'raidActive',
  'raidTimeLeft',
  'raidExposed',
  'raidDefense',
  'housingShortage',
  'seasonEligible',
  'mythsActiveRatio',
  'mythsSeverity',
  'festivalActive',
  'festivalTimeLeft',
  'festivalEligible',
  'festivalCostRatio',
  'mythFlag_rationing_oath',
  'mythFlag_blood_vigil',
  'mythFlag_relic_fever',
  'mythFlag_dry_wells',
];

// Load a policy definition from disk.
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

// Select an action based on the active policy and observation.
function selectAction(state, config, policy) {
  if (!policy) {
    return null;
  }
  const obs = buildObservation(state, config);
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
    const envelope = buildActionEnvelopeFromVector(
      resources,
      output,
      policy.minWeight,
      policy.maxWeight,
      true,
    );
    return normalizeActionEnvelope(envelope);
  }

  const outputVector = new Array(resources.length).fill(0);
  for (let index = 0; index < resources.length; index += 1) {
    const resource = resources[index];
    const featureValues = buildFeatures(obs, resource, config, policy.featureNames);
    const params = policy.weights[resource] || [];
    const bias = Number(policy.biases[resource] || 0);
    let mean = bias;
    for (let i = 0; i < featureValues.length; i += 1) {
      mean += Number(params[i] || 0) * featureValues[i];
    }
    outputVector[index] = clamp(mean, policy.minWeight, policy.maxWeight);
  }

  const envelope = buildActionEnvelopeFromVector(
    resources,
    outputVector,
    policy.minWeight,
    policy.maxWeight,
    false,
  );
  return normalizeActionEnvelope(envelope);
}

// Build a governor-ready action envelope from one policy output vector.
function buildActionEnvelopeFromVector(resources, outputVector, minWeight, maxWeight, normalizeFromTanh) {
  const weights = {};
  let festivalIntent;
  const trade = {};
  const building = {};

  for (let i = 0; i < resources.length; i += 1) {
    const actionId = String(resources[i] || '');
    if (!actionId) {
      continue;
    }
    const raw = Number(outputVector[i] ?? 0);
    const numeric = Number.isFinite(raw) ? raw : 0;
    const scaled = normalizeFromTanh
      ? scaleAction(clamp(numeric, -1, 1), minWeight, maxWeight)
      : clamp(numeric, minWeight, maxWeight);
    if (actionId === FESTIVAL_ACTION_ID) {
      festivalIntent = scaled;
      continue;
    }
    if (actionId === TRADE_RESERVE_BIAS_ACTION_ID) {
      trade.reserveRatioBias = scaled;
      continue;
    }
    if (actionId === TRADE_CONTEST_INTENT_ACTION_ID) {
      trade.contestIntent = scaled;
      continue;
    }
    if (actionId === TRADE_OPPORTUNITY_INTENT_ACTION_ID) {
      trade.opportunityIntent = scaled;
      continue;
    }
    if (actionId === BUILDING_HOUSING_WEIGHT_ACTION_ID) {
      building.housingWeight = scaled;
      continue;
    }
    if (actionId === BUILDING_ECONOMY_WEIGHT_ACTION_ID) {
      building.economyWeight = scaled;
      continue;
    }
    if (actionId === BUILDING_DEFENSE_WEIGHT_ACTION_ID) {
      building.defenseWeight = scaled;
      continue;
    }
    if (actionId === BUILDING_SPECIAL_WEIGHT_ACTION_ID) {
      building.specialWeight = scaled;
      continue;
    }
    if (actionId === BUILDING_MINE_BIAS_ACTION_ID) {
      building.mineBias = scaled;
      continue;
    }
    if (actionId === BUILDING_UPGRADE_BIAS_ACTION_ID) {
      building.upgradeBias = scaled;
      continue;
    }
    weights[actionId] = scaled;
  }

  const payload = {};
  if (Object.keys(weights).length > 0) {
    payload.weights = weights;
  }
  if (festivalIntent !== undefined) {
    payload.festivalIntent = festivalIntent;
  }
  if (Object.keys(trade).length > 0) {
    payload.trade = trade;
  }
  if (Object.keys(building).length > 0) {
    payload.building = building;
  }
  return payload;
}

// Normalize action payload to governor envelope with legacy compatibility fields.
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

// Build a flattened observation vector for all resources.
function buildObservationVector(obs, resources, config, featureNames) {
  const vector = [];
  for (const resource of resources) {
    vector.push(...buildFeatures(obs, resource, config, featureNames));
  }
  return vector;
}

// Run a simple MLP forward pass.
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

// Apply activation function element-wise.
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

// Scale an action output from -1..1 into weight range.
function scaleAction(value, minWeight, maxWeight) {
  const span = maxWeight - minWeight;
  if (span <= 0) {
    return minWeight;
  }
  return minWeight + (value + 1) * 0.5 * span;
}

module.exports = { loadPolicy, selectAction, normalizeActionEnvelope };
