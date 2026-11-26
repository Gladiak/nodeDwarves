#!/usr/bin/env node
'use strict';

// Training recipe and policy-cadence contracts (STRATEGY.md step T, T1), included in `npm test`:
// the recipe in config.json is valid and is the only source of run-shape knobs for the v2 trainer,
// phase configs carry the episode length and termination exactly as the recipe says, the trainer's
// numerics and JS inference agree (python/test_trainer_v2.py), and a policy decides at the cadence
// recorded in its own file everywhere it is played.

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const baseConfig = require('../config.json');
const { spawnSync } = require('child_process');
const { applySets, validateRecipe, buildPhaseConfig, buildTrainerArgs } = require('./train_recipe');
const { loadPolicy, getPolicyStepTicks } = require('../src/ai_policy');
const { createGameSession, advanceGameSession } = require('../src/game_session');
const { buildRuntime } = require('../src/runtime');
const { scorecard, evaluationSettings, gateDecision, cacheKey } = require('./scorecard');

const passed = [];

// Recipe copy with optional overrides.
function recipeWith(sets = []) {
  return applySets(structuredClone(baseConfig.ai.training.recipe), sets);
}

function testRecipeIsValid() {
  const recipe = validateRecipe(recipeWith());
  assert(recipe.phases.length >= 1, 'recipe has no phases');
  assert.equal(recipe.stableTermination, false, 'stable termination must stay off: it cuts settled colonies out of training');
  const lastBankTick = Math.max(...recipe.snapshotBank.ticks);
  assert(lastBankTick >= 20000, `snapshot bank must cover the long game (last tick ${lastBankTick})`);
  passed.push('recipe_valid');
}

function testRecipeRejectsMistakes() {
  assert.throws(() => applySets(recipeWith(), ['noSuchKey=1']), /unknown recipe key/);
  assert.throws(() => applySets(recipeWith(), ['phases.0.noSuchKey=1']), /unknown recipe key/);
  assert.throws(() => validateRecipe(recipeWith(['phases.0.episodeTicks=2805'])), /multiple of stepTicks/);
  assert.throws(() => validateRecipe(recipeWith(['phases.0.snapshotProb=1.5'])), /\[0, 1\]/);
  assert.throws(() => validateRecipe(recipeWith(['gamma=1'])), /gamma/);
  assert.throws(() => validateRecipe(recipeWith(['stableTermination="no"'])), /stableTermination/);
  assert.throws(() => validateRecipe(recipeWith(['policyLagBatches=-1'])), /policyLagBatches/);
  assert.throws(() => validateRecipe(recipeWith(['leverLogStdInit="wide"'])), /leverLogStdInit/);
  validateRecipe(recipeWith(['leverLogStdInit=0']));
  passed.push('recipe_rejects_mistakes');
}

function testTrainerReadsOnlyTheRunFolder() {
  const args = buildTrainerArgs({ name: 'foundation' }, { out: '/tmp/run', rep: 2 });
  assert.deepEqual(args, [path.join('python', 'trainer_v2.py'), '--run', '/tmp/run', '--phase', 'foundation', '--rep', '2']);
  // Run-shape knobs live only in the recipe: the v2 trainer must never read them from ai.training.trainer.
  const runShape = ['episodes', 'maxSteps', 'stepTicks', 'gamma', 'entropyCoef', 'entropyCoefFinal',
    'entropyRampEpisodes', 'lr', 'lrFinal', 'epochs', 'miniBatchSize', 'batchEpisodes', 'workers', 'seed'];
  const sources = ['trainer_v2.py', 'v2/env.py', 'v2/model.py', 'v2/ppo.py', 'v2/rollout.py']
    .map((file) => fs.readFileSync(path.join(__dirname, '..', 'python', file), 'utf8')).join('\n');
  for (const key of runShape) {
    assert(!sources.includes(`trainer["${key}"]`) && !sources.includes(`trainer.get("${key}"`),
      `v2 trainer reads run-shape key ${key} outside the recipe`);
  }
  passed.push('trainer_reads_run_folder');
}

function testTrainerNumericsAndInference() {
  const python = path.join(__dirname, '..', '.venv', 'bin', 'python');
  assert(fs.existsSync(python), `Python venv not found at ${python}`);
  const result = spawnSync(python, [path.join(__dirname, '..', 'python', 'test_trainer_v2.py')],
    { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 0, `python/test_trainer_v2.py failed:\n${result.stdout}\n${result.stderr}`);
  passed.push(result.stdout.trim().replace('[test:trainer-v2] PASS ', 'trainer_v2:'));
}

function testPhaseConfig() {
  const recipe = validateRecipe(recipeWith());
  const phase = recipe.phases[0];
  const config = buildPhaseConfig(baseConfig, recipe, phase);
  for (const key of ['configOverrides', 'evalOverrides']) {
    assert.equal(config.ai.training[key].ai.maxTicks, phase.episodeTicks, `${key}.ai.maxTicks`);
    assert.equal(config.ai.training[key].endgame.enabled, false, `${key}.endgame`);
  }
  assert.equal(config.ai.training.configOverrides.ai.termination.enabled, false, 'stable termination leaked in');
  const stable = buildPhaseConfig(baseConfig, { ...recipe, stableTermination: true }, phase);
  assert.equal(stable.ai.training.configOverrides.ai.termination.enabled,
    baseConfig.ai.training.terminationProfile.enabled === true, 'stableTermination=true must use the profile');
  assert.equal(stable.ai.training.evalOverrides.ai.termination.enabled, false, 'evaluation never terminates early');
  const untouched = structuredClone(baseConfig);
  buildPhaseConfig(untouched, recipe, phase);
  assert.deepEqual(untouched, baseConfig, 'buildPhaseConfig mutated the base config');
  passed.push('phase_config');
}

function testPolicyCadence() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nodedwarves-recipe-'));
  try {
    const source = JSON.parse(fs.readFileSync(path.join(__dirname, '../models/policy_best.json'), 'utf8'));
    const file = path.join(directory, 'policy.json');
    fs.writeFileSync(file, JSON.stringify({ ...source, stepTicks: 10 }));
    const trained = loadPolicy(file);
    assert.equal(trained.stepTicks, 10, 'loadPolicy dropped stepTicks');
    assert.equal(getPolicyStepTicks(trained, baseConfig), 10);
    const legacy = loadPolicy(path.join(__dirname, '../models/policy_best.json'));
    assert.equal(legacy.stepTicks, null);
    assert.equal(getPolicyStepTicks(legacy, baseConfig), Math.max(1, Math.floor(baseConfig.ai.stepTicks)));

    // The interactive game decides at the policy's own cadence.
    const runtime = buildRuntime({ ...baseConfig.display, autoSize: false, width: 120, height: 40 }, { columns: 120, rows: 40 });
    const session = createGameSession(structuredClone(baseConfig), runtime, { seed: 404, policy: trained });
    const start = session.state.tick;
    advanceGameSession(session);
    assert.equal(session.controller.nextActionTick, start + 10, 'game ignored the policy cadence');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  passed.push('policy_cadence');
}

// The evaluation settings are complete and mistakes are refused; the gate applies its three rules.
function testEvaluationSettingsAndGate() {
  const settings = evaluationSettings(baseConfig);
  assert.deepEqual(settings.horizons.map((h) => [h.plan, h.ticks]), [['eval', 8000], ['standard', 20000]]);
  for (const bad of ['horizons.1.name="8k"', 'horizons.0.plan="other"', 'horizons.0.ticks=0', 'gate.horizon="5k"',
    'gate.lcbZ=-1', 'councilStepTicks=0']) {
    assert.throws(() => evaluationSettings(baseConfig, [bad]), undefined, `accepted ${bad}`);
  }
  const gate = { horizon: 'a', guardHorizon: 'b', minImprove: 0.005, lcbZ: 1.96, guardZ: 1 };
  const card = (primary, guard) => ({ a: { vsAgainst: { rpp: primary } }, b: { vsAgainst: { rpp: guard } } });
  const p = (mean, se) => ({ mean, se });
  assert.equal(gateDecision(card(p(0.02, 0.005), p(-0.01, 0.02)), gate).pass, true);
  assert.equal(gateDecision(card(p(0.004, 0.0001), p(0, 0.01)), gate).pass, false, 'passed below minImprove');
  assert.equal(gateDecision(card(p(0.02, 0.02), p(0, 0.01)), gate).pass, false, 'passed with lower bound <= 0');
  assert.equal(gateDecision(card(p(0.02, 0.005), p(-0.05, 0.01)), gate).pass, false, 'passed a long-horizon regression');
  passed.push('evaluation_gate');
}

// The scorecard refuses policies without a cadence, is deterministic, caches by player content and
// pairs the same games for every player.
async function testScorecard() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nodedwarves-scorecard-'));
  try {
    const source = JSON.parse(fs.readFileSync(path.join(__dirname, '../models/policy_best.json'), 'utf8'));
    const legacy = path.join(directory, 'legacy.json');
    fs.writeFileSync(legacy, JSON.stringify(source));
    const file = path.join(directory, 'policy.json');
    fs.writeFileSync(file, JSON.stringify({ ...source, stepTicks: 10 }));
    const sets = ['horizons.0.ticks=60', 'horizons.0.games=2', 'horizons.1.ticks=60', 'horizons.1.games=2',
      `cacheDir=${JSON.stringify(path.join(directory, 'cache'))}`];
    await assert.rejects(scorecard({ policy: legacy, sets, workers: 2 }), /stepTicks/);
    const first = await scorecard({ policy: file, against: 'council', sets, workers: 2 });
    const cached = fs.readdirSync(path.join(directory, 'cache')).length;
    assert.equal(cached, 4, 'expected council and policy cached on both horizons');
    const second = await scorecard({ policy: file, against: 'council', sets, workers: 2 });
    assert.deepEqual(second.horizons, first.horizons, 'scorecard is not reproducible');
    assert.equal(fs.readdirSync(path.join(directory, 'cache')).length, cached, 'cached results were played again');
    for (const h of Object.values(first.horizons)) {
      assert.deepEqual(h.outcomes.policy.map((g) => g.key), h.outcomes.council.map((g) => g.key), 'players saw different games');
    }
    const settings = evaluationSettings(baseConfig, sets);
    const key = (player, horizon) => cacheKey(player, horizon, settings, 'config');
    const changed = path.join(directory, 'changed.json');
    fs.writeFileSync(changed, JSON.stringify({ ...source, stepTicks: 5 }));
    assert.notEqual(key(`policy:${file}`, settings.horizons[0]), key(`policy:${changed}`, settings.horizons[0]));
    assert.notEqual(key('default', settings.horizons[0]), key('default', settings.horizons[1]));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  passed.push('scorecard');
}

(async () => {
  testRecipeIsValid();
  testRecipeRejectsMistakes();
  testTrainerReadsOnlyTheRunFolder();
  testTrainerNumericsAndInference();
  testPhaseConfig();
  testPolicyCadence();
  testEvaluationSettingsAndGate();
  await testScorecard();
  console.log(`[test:recipe] PASS ${passed.join(' ')}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
