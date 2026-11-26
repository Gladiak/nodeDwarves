'use strict';

// Deterministic v2 policy fixture for contracts and validators (STRATEGY.md T4): a small tanh MLP with
// the same file schema python/trainer_v2.py writes (factored layout, job-weight and lever heads in the
// trainer's order, observation normalization, own stepTicks). Weights come from a seeded PRNG, so the
// file is identical on every machine. Tests use it instead of a promoted policy in models/.

const fs = require('fs');
const path = require('path');
const { buildObservationPlan } = require('../src/ai/observation_layout');

// Mulberry32 PRNG returning floats in [0, 1).
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Action heads in the trainer's order (python/v2/env.py action_ids): sorted job targets, then levers.
function fixtureActionIds(config) {
  const jobs = Object.keys((config.resources && config.resources.targets) || {}).sort();
  const levers = Object.keys((config.ai.levers && config.ai.levers.definitions) || {}).map((name) => `lever_${name}`);
  return [...jobs, ...levers];
}

// Build the policy JSON payload for a config.
function createTestPolicyPayload(config, { seed = 1, hiddenSizes = [16, 16], stepTicks = 10 } = {}) {
  const random = mulberry32(seed);
  const resources = fixtureActionIds(config);
  const featureNames = config.ai.training.trainer.featureNames.slice();
  const inputSize = buildObservationPlan(resources, featureNames).size;
  const layer = (inputs, outputs, scale) => ({
    weights: Array.from({ length: outputs }, () => Array.from({ length: inputs }, () => (random() * 2 - 1) * scale)),
    biases: Array.from({ length: outputs }, () => (random() * 2 - 1) * 0.1),
  });
  const sizes = [inputSize, ...hiddenSizes];
  const trunk = sizes.slice(1).map((outputs, index) => layer(sizes[index], outputs, 1 / Math.sqrt(sizes[index])));
  const last = hiddenSizes[hiddenSizes.length - 1];
  const stats = (size) => ({ enabled: true, count: 1, mean: new Array(size).fill(0), var: new Array(size).fill(1), clip: 5, epsilon: 1e-8 });
  return {
    version: 3,
    type: 'mlp',
    resources,
    featureNames,
    observationLayout: 'factored',
    minWeight: Number(config.ai.minWeight ?? 0),
    maxWeight: Number(config.ai.maxWeight ?? 2),
    activation: 'tanh',
    outputActivation: 'tanh',
    hiddenSizes: hiddenSizes.slice(),
    layers: [...trunk, layer(last, resources.length, 1 / Math.sqrt(last))],
    valueLayers: [...trunk.map((entry) => ({ weights: entry.weights.map((row) => row.slice()), biases: entry.biases.slice() })),
      layer(last, 1, 1 / Math.sqrt(last))],
    valueHead: 'normalized_returns',
    logStd: new Array(resources.length).fill(-0.8),
    stepTicks,
    normalization: { version: 1, observation: stats(inputSize), returns: stats(1) },
  };
}

// Write the fixture policy to `file` and return the path.
function writeTestPolicy(file, config, options) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(createTestPolicyPayload(config, options))}\n`);
  return file;
}

module.exports = { createTestPolicyPayload, writeTestPolicy, fixtureActionIds };
