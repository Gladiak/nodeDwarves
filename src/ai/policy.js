'use strict';

const { LEVER_ACTION_PREFIX, isLeverActionId } = require('../simulation/levers');
const fs = require('fs');
const path = require('path');
const { clamp } = require('../utils');
const { buildObservation, buildFeatures } = require('./observation');
const {
  OBSERVATION_LAYOUT_FACTORED,
  buildObservationPlan,
  assembleObservationVector,
} = require('./observation_layout');

const OBS_NORM_VERSION = 1;
const WARNED_KEYS = new Set();

// Emit one warning per key to avoid noisy logs on long runs.
function warnOnce(key, message) {
  if (!key || WARNED_KEYS.has(key)) {
    return;
  }
  WARNED_KEYS.add(key);
  console.warn(message);
}

// Parse observation normalization metadata from the policy payload.
function parseObservationNormalization(raw, policyPath) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const mean = Array.isArray(raw.mean) ? raw.mean : null;
  const variance = Array.isArray(raw.var) ? raw.var : null;
  if (!mean || !variance || mean.length === 0 || mean.length !== variance.length) {
    warnOnce(
      `obs-norm-invalid:${policyPath}`,
      `[ai-policy] Invalid observation normalization metadata in ${policyPath}; using raw observations.`,
    );
    return null;
  }
  const parsedMean = mean.map((value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  });
  const parsedVar = variance.map((value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return 1;
    }
    return numeric;
  });
  const clipRaw = Number(raw.clip ?? 0);
  const epsilonRaw = Number(raw.epsilon ?? 1e-8);
  return {
    enabled: Boolean(raw.enabled),
    mean: parsedMean,
    variance: parsedVar,
    clip: Number.isFinite(clipRaw) ? Math.max(0, clipRaw) : 0,
    epsilon: Number.isFinite(epsilonRaw) ? Math.max(1e-12, epsilonRaw) : 1e-8,
  };
}

// Load a v2 policy (STRATEGY.md T4): an MLP with the factored observation layout, its own decision
// cadence (`stepTicks`) and only job-weight and lever heads. Returns null when the file does not
// exist; throws on any other policy shape (v1 policies were removed with the old training stack).
function loadPolicy(policyPath) {
  if (!policyPath) {
    return null;
  }
  const resolved = path.resolve(policyPath);
  if (!fs.existsSync(resolved)) {
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const problem = describeUnsupportedPolicy(raw);
  if (problem) {
    throw new Error(`[ai-policy] ${resolved} is not a v2 policy (${problem}); train one with npm run ai:train:recipe`);
  }
  let observationNormalization = null;
  const normalization = raw.normalization && typeof raw.normalization === 'object' ? raw.normalization : null;
  if (normalization) {
    const version = Number(normalization.version ?? 0);
    if (version && version !== OBS_NORM_VERSION) {
      warnOnce(
        `obs-norm-version:${resolved}`,
        `[ai-policy] Unsupported normalization version (${version}) in ${resolved}; using raw observations.`,
      );
    } else {
      observationNormalization = parseObservationNormalization(normalization.observation, resolved);
    }
  }
  const resources = raw.resources.slice();
  const featureNames = raw.featureNames.slice();
  return {
    type: 'mlp',
    path: resolved,
    resources,
    featureNames,
    observationLayout: OBSERVATION_LAYOUT_FACTORED,
    observationPlan: buildObservationPlan(resources, featureNames),
    minWeight: Number(raw.minWeight ?? 0),
    maxWeight: Number(raw.maxWeight ?? 2),
    activation: raw.activation || 'tanh',
    outputActivation: raw.outputActivation || 'tanh',
    layers: raw.layers,
    observationNormalization,
    stepTicks: raw.stepTicks,
  };
}

// Why a parsed policy file is not a loadable v2 policy, or null when it is.
function describeUnsupportedPolicy(raw) {
  if (!raw || typeof raw !== 'object') return 'not a JSON object';
  if ((raw.type || 'mlp') !== 'mlp' || !Array.isArray(raw.layers) || raw.layers.length === 0) return 'not an MLP';
  if (raw.observationLayout !== OBSERVATION_LAYOUT_FACTORED) return `observation layout ${JSON.stringify(raw.observationLayout)}`;
  if (!Number.isInteger(raw.stepTicks) || raw.stepTicks < 1) return 'no stepTicks cadence';
  if (!Array.isArray(raw.featureNames) || raw.featureNames.length === 0) return 'no featureNames';
  if (!Array.isArray(raw.resources) || raw.resources.length === 0) return 'no action heads';
  const v1Head = raw.resources.find((id) => id === 'festival' || String(id).startsWith('gov_'));
  if (v1Head) return `v1 action head ${v1Head}`;
  return null;
}

// Decision cadence of a policy: the cadence it was trained at (policy JSON `stepTicks`).
function getPolicyStepTicks(policy) {
  return policy.stepTicks;
}

// MLP forward pass on one observation: raw input vector and tanh output (null when unusable).
function forwardMlp(obs, config, policy) {
  const rawInput = buildObservationVector(obs, config, policy.featureNames, policy.observationPlan);
  const input = normalizeObservationInput(rawInput, policy.observationNormalization, policy.path);
  if (!input) {
    return null;
  }
  return { rawInput, output: forwardNetwork(policy.layers, input, policy.activation, policy.outputActivation) };
}

// Raw observation and network output of a policy for a state (train/serve parity checks).
function policyForward(state, config, policy) {
  if (!policy) {
    return null;
  }
  return forwardMlp(buildObservation(state, config), config, policy);
}

// Select an action based on the active policy and observation.
function selectAction(state, config, policy) {
  if (!policy) {
    return null;
  }
  const forward = forwardMlp(buildObservation(state, config), config, policy);
  const output = forward && forward.output;
  if (!output || output.length < policy.resources.length) {
    return null;
  }
  return normalizeActionEnvelope(buildActionEnvelopeFromVector(policy.resources, output, policy.minWeight, policy.maxWeight));
}

// Build a governor-ready action envelope from one tanh policy output vector: job weights in
// [minWeight, maxWeight], lever heads as u in [0, 1] (the midpoint keeps the council default).
function buildActionEnvelopeFromVector(resources, outputVector, minWeight, maxWeight) {
  const weights = {};
  const levers = {};
  for (let i = 0; i < resources.length; i += 1) {
    const actionId = String(resources[i] || '');
    if (!actionId) {
      continue;
    }
    const raw = Number(outputVector[i] ?? 0);
    const numeric = Number.isFinite(raw) ? raw : 0;
    const scaled = scaleAction(clamp(numeric, -1, 1), minWeight, maxWeight);
    if (isLeverActionId(actionId)) {
      const span = maxWeight - minWeight;
      levers[actionId.slice(LEVER_ACTION_PREFIX.length)] = span > 0 ? clamp((scaled - minWeight) / span, 0, 1) : 0.5;
      continue;
    }
    weights[actionId] = scaled;
  }
  const payload = {};
  if (Object.keys(weights).length > 0) {
    payload.weights = weights;
  }
  if (Object.keys(levers).length > 0) {
    payload.levers = levers;
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
  if (action.levers && typeof action.levers === 'object') {
    normalized.levers = { ...action.levers };
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

// Build a flattened observation vector following the policy's observation layout plan.
function buildObservationVector(obs, config, featureNames, plan) {
  return assembleObservationVector(
    plan,
    (resource) => buildFeatures(obs, resource, config, featureNames),
  );
}

// Apply policy-side observation normalization when metadata is available.
function normalizeObservationInput(input, normalization, policyPath) {
  if (!normalization || !normalization.enabled) {
    return input;
  }
  if (!Array.isArray(input)) {
    return null;
  }
  const mean = normalization.mean || [];
  const variance = normalization.variance || [];
  if (input.length !== mean.length || input.length !== variance.length) {
    warnOnce(
      `obs-norm-shape:${policyPath}`,
      `[ai-policy] Observation normalization shape mismatch for ${policyPath}; ignoring policy action.`,
    );
    return null;
  }
  const epsilon = Number(normalization.epsilon ?? 1e-8);
  const clip = Number(normalization.clip ?? 0);
  const safeEpsilon = Number.isFinite(epsilon) ? Math.max(1e-12, epsilon) : 1e-8;
  const clipValue = Number.isFinite(clip) ? Math.max(0, clip) : 0;
  const normalized = new Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const value = Number(input[i] ?? 0);
    const mu = Number(mean[i] ?? 0);
    const sigma2 = Number(variance[i] ?? 1);
    const safeVar = Number.isFinite(sigma2) && sigma2 > 0 ? sigma2 : 1;
    let scaled = (value - mu) / Math.sqrt(safeVar + safeEpsilon);
    if (clipValue > 0) {
      scaled = clamp(scaled, -clipValue, clipValue);
    }
    normalized[i] = scaled;
  }
  return normalized;
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

module.exports = { loadPolicy, selectAction, normalizeActionEnvelope, getPolicyStepTicks, policyForward };
