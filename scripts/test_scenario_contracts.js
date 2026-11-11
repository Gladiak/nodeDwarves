#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config.json');
const { createGameSession, advanceGameSession, resolveScenario } = require('../src/game_session');
const { encodeSave, decodeSave } = require('../src/persistence');
const { loadPolicy, selectAction } = require('../src/ai_policy');
const { buildObservation } = require('../src/ai/observation');

// Resolve a catalog path for independent source, precedence and isolation assertions.
function valueAt(root, key) {
  return key.split('.').reduce((entry, part) => entry[part], root);
}

// Check copied leaves without treating a partial template as a replacement for its defaults.
function assertTemplateLeaves(actual, expected, label) {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    for (const [key, value] of Object.entries(expected)) assertTemplateLeaves(actual[key], value, `${label}.${key}`);
  } else assert.deepEqual(actual, expected, label);
}

// Exercise filtered test-template reuse and protect the standard game and policy contract.
function main() {
  const original = JSON.stringify(config);
  const training = JSON.stringify(config.ai.training);
  const ids = config.startup.scenarios.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, 'Duplicate scenario IDs');
  assert.equal(ids.length, 12, 'Expected the curated twelve-scenario catalog');
  const variants = new Set();
  for (const scenario of config.startup.scenarios) {
    const resolved = resolveScenario(config, scenario.id).config;
    assert(scenario.focus && scenario.difficulty && scenario.description, `${scenario.id}: missing player context`);
    assert.deepEqual(resolved.ai, config.ai, `${scenario.id}: changed training or inference settings`);
    assert.deepEqual(resolved.simulation, config.simulation, `${scenario.id}: imposed a test time limit`);
    assert.deepEqual(resolved.persistence, config.persistence);
    assert.deepEqual(resolved.display, config.display);
    assert.deepEqual(resolved.symbols, config.symbols);
    assert.deepEqual(resolved.resources.nodes, config.resources.nodes, 'Explicit test nodes leaked into terrain gathering');
    assert.equal(resolved.resources.useTerrainTiles, true);
    assert.equal(resolved.population.socialDrama.longArc.enabled, config.population.socialDrama.longArc.enabled,
      'Test-only social-memory disablement leaked into a game');
    assert.deepEqual(resolved.underrealm.combat.readiness, config.underrealm.combat.readiness, 'Changed combat readiness gates');
    if (scenario.test_template) {
      const source = config.ai.training.scenarios.find((entry) => entry.name === scenario.test_template.scenario);
      for (const key of scenario.test_template.paths) {
        if (Object.hasOwn(scenario.overrides, key)) continue;
        assertTemplateLeaves(valueAt(resolved, key), valueAt(source.overrides, key), `${scenario.id}: source mismatch at ${key}`);
      }
    }
    const gameplay = structuredClone(resolved);
    delete gameplay.startup;
    variants.add(crypto.createHash('sha256').update(JSON.stringify(gameplay)).digest('hex'));
  }
  assert.equal(variants.size, ids.length, 'Two templates resolve to the same gameplay');
  assert.deepEqual(resolveScenario(config, 'free').config, config);

  const editable = structuredClone(config);
  const source = editable.ai.training.scenarios.find((entry) => entry.name === 'housing_pressure');
  source.overrides.structures.house.buildTicks = 47;
  assert.equal(resolveScenario(editable, 'crowded_hearth').config.structures.house.buildTicks, 47);
  editable.startup.scenarios.find((entry) => entry.id === 'crowded_hearth').overrides['structures.house.buildTicks'] = 31;
  assert.equal(resolveScenario(editable, 'crowded_hearth').config.structures.house.buildTicks, 31, 'Local override lost precedence');
  editable.structures.house.buildCost.iron = 1;
  assert.equal(resolveScenario(editable, 'crowded_hearth').config.structures.house.buildCost.iron, 1,
    'Copying a partial test branch discarded an unmentioned default');

  for (const fixture of [
    { scenario: 'missing-template', paths: ['dwarves.count'] },
    { scenario: 'housing_pressure', paths: [] },
    { scenario: 'housing_pressure', paths: ['missing.setting'] },
    { scenario: 'housing_pressure', paths: ['ai.training.enabled'] },
    { scenario: 'housing_pressure', paths: ['__proto__.polluted'] },
  ]) {
    const invalid = structuredClone(config);
    invalid.startup.scenarios.find((entry) => entry.id === 'crowded_hearth').test_template = fixture;
    assert.throws(() => resolveScenario(invalid, 'crowded_hearth'), /scenario|template|setting/i);
  }
  assert.throws(() => resolveScenario(config, 'unknown-hold'), /Unknown scenario/);
  assert.equal({}.polluted, undefined);

  const runtime = { gridWidth: 60, gridHeight: 30, playableArea: 1800,
    totalWidth: 60, totalHeight: 30, frameEnabled: false, mapInset: null };
  const policyPath = path.join(__dirname, '../models/policy_best.json');
  const modelHash = crypto.createHash('sha256').update(fs.readFileSync(policyPath)).digest('hex');
  const policy = loadPolicy(policyPath);
  const free = createGameSession(config, runtime, { seed: 101, policy });
  const withoutTemplates = structuredClone(config);
  withoutTemplates.startup.scenarios = [config.startup.scenarios[0]];
  const control = createGameSession(withoutTemplates, runtime, { seed: 101, policy });
  for (let index = 0; index < 120; index += 1) {
    assert.deepEqual(buildObservation(free.state, free.config), buildObservation(control.state, control.config));
    assert.deepEqual(selectAction(free.state, free.config, policy), selectAction(control.state, control.config, policy));
    advanceGameSession(free); advanceGameSession(control);
  }
  assert.deepEqual(free.random, control.random, 'Scenario catalog perturbed the free-game random stream');

  const pinned = createGameSession(config, runtime, { scenarioId: 'below_the_gate', policy });
  const restored = decodeSave(encodeSave(pinned)).session;
  assert.deepEqual(restored.config, pinned.config);
  assert.deepEqual(restored.scenario, pinned.scenario);
  assert.equal(restored.scenario.testTemplate, 'underrealm_push');
  assert.equal(restored.scenario.seed, 909);
  assert.equal(JSON.stringify(config), original, 'Scenario resolution mutated base config');
  assert.equal(JSON.stringify(config.ai.training), training, 'Scenario work mutated test/training profiles');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(policyPath)).digest('hex'), modelHash);
  process.stdout.write('Scenario contracts: PASS 12 distinct templates, filtered source reuse, local precedence, defaults, save pinning, standard-game/PPO/RNG isolation\n');
}

if (require.main === module) main();
