'use strict';

const crypto = require('crypto');
const { createInitialState } = require('./state');
const { stepState } = require('./simulation');
const { selectAction, normalizeActionEnvelope } = require('./ai_policy');
const { createSessionRandom, validateSessionRandom, withSessionRandom } = require('./session_random');

// Resolve explicit config paths without allowing prototype traversal or silent missing settings.
function readScenarioSetting(root, key) {
  const parts = String(key).split('.');
  if (!/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(key)
      || parts.some((part) => ['__proto__', 'constructor', 'prototype'].includes(part))) {
    throw new Error(`Invalid scenario setting: ${key}`);
  }
  let value = root;
  for (const part of parts) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) {
      throw new Error(`Unknown scenario setting: ${key}`);
    }
    value = value[part];
  }
  return value;
}

// Assign a known leaf or explicit local replacement, keeping shared source definitions intact.
function writeScenarioSetting(config, key, value) {
  readScenarioSetting(config, key);
  const parts = key.split('.');
  const last = parts.pop();
  let target = config;
  for (const part of parts) target = target[part];
  target[last] = structuredClone(value);
}

// Merge a selected template branch leaf by leaf, retaining gameplay defaults absent from the test.
function copyTemplateSetting(config, key, value) {
  readScenarioSetting(config, key);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [child, entry] of Object.entries(value)) copyTemplateSetting(config, `${key}.${child}`, entry);
    return;
  }
  writeScenarioSetting(config, key, value);
}

// Apply only explicit scenario overrides; never mutate the shared base configuration.
function resolveScenario(config, scenarioId = 'free') {
  const scenarios = config.startup && config.startup.scenarios || [];
  const scenario = scenarios.find((entry) => entry.id === scenarioId)
    || (scenarioId === 'free' ? { id: 'free', name: 'Free colony', overrides: {} } : null);
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`);
  const resolved = structuredClone(config);
  const template = scenario.test_template;
  if (template) {
    const source = config.ai?.training?.scenarios?.find((entry) => entry.name === template.scenario);
    if (!source?.overrides) throw new Error(`Unknown scenario test template: ${template.scenario}`);
    if (!Array.isArray(template.paths) || template.paths.length === 0) {
      throw new Error(`Select explicit gameplay paths for test template: ${template.scenario}`);
    }
    for (const key of template.paths) {
      if (['ai', 'startup', 'persistence', 'simulation', 'display', 'symbols', 'events'].includes(String(key).split('.')[0])) {
        throw new Error(`Test template cannot override session or training settings: ${key}`);
      }
      copyTemplateSetting(resolved, key, readScenarioSetting(source.overrides, key));
    }
  }
  for (const [key, value] of Object.entries(scenario.overrides || {})) {
    writeScenarioSetting(resolved, key, value);
  }
  return { config: resolved, scenario };
}

// Create the entire interactive simulation within its own resumable random stream.
function createGameSession(baseConfig, runtime, options = {}) {
  const { config, scenario } = resolveScenario(baseConfig, options.scenarioId);
  const seed = options.seed ?? scenario.seed ?? crypto.randomBytes(4).readUInt32LE();
  const random = createSessionRandom(seed);
  const session = {
    id: crypto.randomBytes(12).toString('hex'),
    scenario: { id: scenario.id, name: scenario.name, seed, difficulty: scenario.difficulty || 'Standard',
      focus: scenario.focus || '', testTemplate: scenario.test_template?.scenario || null },
    config,
    runtime: structuredClone(runtime),
    random,
    policy: options.policy || null,
    controller: { currentAction: null, nextActionTick: 0, advances: 0 },
    presentation: null,
    state: null,
  };
  session.state = withSessionRandom(random, () => createInitialState(config, session.runtime));
  return session;
}

// Advance AI and simulation together so inference cadence survives a checkpoint.
function advanceGameSession(session) {
  return withSessionRandom(session.random, () => {
    const { state, config, runtime, controller, policy } = session;
    if (policy && state.tick >= controller.nextActionTick) {
      controller.currentAction = normalizeActionEnvelope(selectAction(state, config, policy));
      controller.nextActionTick = state.tick + Math.max(1, Number(config.ai && config.ai.stepTicks || 1));
    }
    stepState(state, config, runtime, controller.currentAction, { suppressEndgameReset: true });
    controller.advances += 1;
  });
}

// Reject incomplete or incompatible snapshots before exposing a restored world.
function validateGameSession(session) {
  if (!session || !/^[a-f0-9]{24}$/.test(session.id || '')
      || !session.config || !session.config.display || !session.config.simulation
      || !session.scenario || typeof session.scenario.name !== 'string'
      || !session.state || !Array.isArray(session.state.dwarves) || !Array.isArray(session.state.jobs)
      || !Number.isSafeInteger(session.state.tick) || session.state.tick < 0
      || !session.controller || !Number.isSafeInteger(session.controller.advances)
      || session.controller.advances < 0 || !Number.isFinite(session.controller.nextActionTick)
      || !session.runtime || !Number.isInteger(session.runtime.gridWidth) || session.runtime.gridWidth < 1
      || !Number.isInteger(session.runtime.gridHeight) || session.runtime.gridHeight < 1) {
    throw new Error('Incomplete saved game.');
  }
  validateSessionRandom(session.random);
  if (session.policy && !['mlp', 'linear'].includes(session.policy.type)) {
    throw new Error('Invalid saved AI policy.');
  }
  return session;
}

module.exports = { createGameSession, advanceGameSession, validateGameSession, resolveScenario };
