'use strict';

const fs = require('fs');
const path = require('path');
const { clamp } = require('../utils');
const { buildObservation, buildFeatures } = require('./observation');

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

module.exports = { loadPolicy, selectAction };
