#!/usr/bin/env node
'use strict';

// Training recipe and policy-cadence contracts (STRATEGY.md step T, T1), included in `npm test`:
// the recipe in config.json is valid and is the only source of run-shape knobs for the v2 trainer,
// phase configs carry the episode length exactly as the recipe says, the trainer's numerics and JS
// inference agree (python/test_trainer_v2.py), a policy decides at the cadence recorded in its own file
// everywhere it is played, and ai.training holds only what the v2 stack reads (T4).

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const baseConfig = require('../config.json');
const { spawnSync } = require('child_process');
const { applySets, validateRecipe, buildPhaseConfig, buildTrainerArgs, bankKeyConfig } = require('./train_recipe');
const { loadPolicy, getPolicyStepTicks } = require('../src/ai_policy');
const { createGameSession, advanceGameSession } = require('../src/game_session');
const { buildRuntime } = require('../src/runtime');
const { scorecard, evaluationSettings, gateDecision, comparison, cacheKey } = require('./scorecard');
const { createTestPolicyPayload } = require('./test_policy_fixture');

const passed = [];

// Recipe copy with optional overrides.
function recipeWith(sets = []) {
  return applySets(structuredClone(baseConfig.ai.training.recipe), sets);
}

function testRecipeIsValid() {
  const recipe = validateRecipe(recipeWith());
  assert(recipe.phases.length >= 1, 'recipe has no phases');
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
  assert.throws(() => applySets(recipeWith(), ['stableTermination=true']), /unknown recipe key/);
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
  assert.equal(config.ai.termination, undefined, 'stable termination is gone: only extinction ends an episode early');
  const untouched = structuredClone(baseConfig);
  buildPhaseConfig(untouched, recipe, phase);
  assert.deepEqual(untouched, baseConfig, 'buildPhaseConfig mutated the base config');
  // The bank key ignores evaluation settings and the recipe (no game code reads them), not the game.
  const tweaked = structuredClone(config);
  tweaked.ai.evaluation.earlyStopZ = 5;
  tweaked.ai.training.recipe.gamma = 0.5;
  assert.deepEqual(bankKeyConfig(tweaked), bankKeyConfig(config), 'evaluation or recipe changes rebuild the bank');
  tweaked.population.reproduction.baseChance += 0.001;
  assert.notDeepEqual(bankKeyConfig(tweaked), bankKeyConfig(config), 'a game change reuses an old bank');
  passed.push('phase_config');
}

function testPolicyCadence() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nodedwarves-recipe-'));
  try {
    const source = createTestPolicyPayload(baseConfig, { stepTicks: 10 });
    const file = path.join(directory, 'policy.json');
    fs.writeFileSync(file, JSON.stringify(source));
    const trained = loadPolicy(file);
    assert.equal(trained.stepTicks, 10, 'loadPolicy dropped stepTicks');
    assert.equal(getPolicyStepTicks(trained, baseConfig), 10);
    // v1 policies (no cadence, legacy layout, governor heads) are refused, not silently replayed.
    const refuse = (name, payload) => {
      const bad = path.join(directory, `${name}.json`);
      fs.writeFileSync(bad, JSON.stringify(payload));
      assert.throws(() => loadPolicy(bad), /not a v2 policy/, `loadPolicy accepted ${name}`);
    };
    refuse('no_cadence', { ...source, stepTicks: undefined });
    refuse('legacy_layout', { ...source, observationLayout: 'per_resource' });
    refuse('governor_head', { ...source, resources: [...source.resources, 'gov_trade_contest_intent'] });
    refuse('linear', { ...source, type: 'linear' });
    assert.equal(loadPolicy(path.join(directory, 'missing.json')), null);

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

// ai.training holds only what the v2 stack reads (STRATEGY.md T4): the recipe, the trainer's algorithm
// hyperparameters and feature list, the profile overrides and the training randomization. The scenario
// catalog is game content (top-level `scenarios`), the eval plan lives in ai.evaluation.
function testTrainingConfigSurface() {
  const training = baseConfig.ai.training;
  assert.deepEqual(Object.keys(training).sort(), ['configOverrides', 'evalOverrides', 'randomization', 'recipe', 'trainer']);
  assert.deepEqual(Object.keys(training.trainer).sort(), ['clipRange', 'featureNames', 'gaeLambda', 'hiddenSizes',
    'logStdInit', 'maxGradNorm', 'obsNorm', 'obsNormClip', 'obsNormEpsilon', 'returnNorm', 'returnNormClip',
    'returnNormEpsilon', 'returnNormMaxCount', 'targetKl', 'valueClipRange', 'valueCoef', 'valueHuberDelta']);
  const count = (value) => (value && typeof value === 'object' ? Object.values(value).reduce((sum, v) => sum + count(v), 0) : 1);
  const withoutFeatures = count(training) - training.trainer.featureNames.length;
  assert(withoutFeatures <= 110, `ai.training grew to ${withoutFeatures} values besides the feature list`);
  assert.equal(baseConfig.ai.termination, undefined, 'ai.termination was removed with stable termination');
  assert(Array.isArray(baseConfig.scenarios) && baseConfig.scenarios.length > 0, 'top-level scenario catalog missing');
  const names = new Set(baseConfig.scenarios.map((entry) => entry.name));
  for (const name of baseConfig.ai.evaluation.scenarios) assert(names.has(name), `eval scenario ${name} not in the catalog`);
  passed.push('training_config_surface');
}

// The evaluation settings are complete and mistakes are refused; the gate applies its rules: 8k rpp
// improvement with a lower bound above zero, and no 20k guard metric worse beyond guardZ SE.
function testEvaluationSettingsAndGate() {
  const settings = evaluationSettings(baseConfig);
  assert.deepEqual(settings.horizons.map((h) => [h.plan, h.ticks]), [['eval', 8000], ['standard', 20000]]);
  assert.deepEqual(settings.gate.guards, ['rpp', 'latePop', 'extinctions', 'avoidable'], 'the 20k guards are the section 6 rule on the E51 metric');
  assert.equal(settings.staged, true, 'the gate horizon is played first');
  for (const bad of ['horizons.1.name="8k"', 'horizons.0.plan="other"', 'horizons.0.ticks=0', 'gate.horizon="5k"',
    'gate.lcbZ=-1', 'councilStepTicks=0', 'gate.guards=[]', 'gate.guards=["deaths"]', 'gate.guards=["pop","pop"]', 'staged="yes"', 'earlyStopZ="low"']) {
    assert.throws(() => evaluationSettings(baseConfig, [bad]), undefined, `accepted ${bad}`);
  }
  const gate = { horizon: 'a', guardHorizon: 'b', minImprove: 0.005, lcbZ: 1.96, guardZ: 1,
    guards: ['rpp', 'pop', 'latePop', 'extinctions', 'avoidable'] };
  const p = (mean, se) => ({ mean, se });
  const fine = { rpp: p(0, 0.01), pop: p(0, 10), latePop: p(0, 8), extinctions: p(0, 0.05), avoidable: p(0, 5) };
  const card = (primary, guard = {}) => ({ a: { vsAgainst: { rpp: primary } }, b: { vsAgainst: { ...fine, ...guard } } });
  assert.equal(gateDecision(card(p(0.02, 0.005), { rpp: p(-0.01, 0.02) }), gate).pass, true);
  assert.equal(gateDecision(card(p(0.004, 0.0001)), gate).pass, false, 'passed below minImprove');
  assert.equal(gateDecision(card(p(0.02, 0.02)), gate).pass, false, 'passed with lower bound <= 0');
  assert.equal(gateDecision(card(p(0.02, 0.005), { rpp: p(-0.05, 0.01) }), gate).pass, false, 'passed an rpp regression');
  assert.equal(gateDecision(card(p(0.02, 0.005), { pop: p(-37.4, 36.3) }), gate).pass, false, 'passed a population regression');
  assert.equal(gateDecision(card(p(0.02, 0.005), { latePop: p(-25, 20) }), gate).pass, false, 'passed a late-population regression');
  const staged = gateDecision({ a: { vsAgainst: { rpp: p(0.001, 0.01) } } }, gate);
  assert.equal(staged.pass, false, 'passed without the guard horizon');
  assert.match(staged.reasons.join(' '), /not played/, 'a staged stop must say the guard horizon was not played');
  assert.equal(gateDecision(card(p(0.02, 0.005), { extinctions: p(0.156, 0.101) }), gate).pass, false, 'passed more extinctions');
  assert.equal(gateDecision(card(p(0.02, 0.005), { avoidable: p(23.4, 9.6) }), gate).pass, false, 'passed more avoidable deaths');
  assert.equal(gateDecision(card(p(0.02, 0.005), { pop: p(-20, 30), extinctions: p(0.09, 0.09), avoidable: p(5, 9) }), gate).pass,
    true, 'refused a change within one SE');
  assert.equal(gateDecision(card(p(0.02, 0.005), { extinctions: p(3 / 32, 3 / 32) }), gate).guards.extinctions.ok, true,
    'a bound of exactly zero is not worse');
  assert.equal(gateDecision(card(p(0.02, 0.005), { avoidable: p(23.4, 9.6) }), { ...gate, guards: ['rpp'] }).pass, true,
    'guards outside the configured list must not count');

  // Paired comparison: extinction is a 1/0 per game, avoidable deaths are counts.
  const games = (rows) => rows.map(([pop, extinct, avoidable], i) => ({ key: `g${i}`, pop, latePop: pop / 2, extinct, avoidable, rpp: pop / 1000 }));
  const delta = comparison(games([[0, true, 9], [120, false, 4]]), games([[100, false, 3], [100, false, 4]]));
  assert.deepEqual([delta.extinctions.mean, delta.avoidable.mean, delta.pop.mean, delta.latePop.mean], [0.5, 3, -40, -20]);
  passed.push('evaluation_gate');
}

// The scorecard refuses policies without a cadence, is deterministic, caches by player content and
// pairs the same games for every player.
async function testScorecard() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nodedwarves-scorecard-'));
  try {
    const source = createTestPolicyPayload(baseConfig, { stepTicks: 10 });
    const legacy = path.join(directory, 'legacy.json');
    fs.writeFileSync(legacy, JSON.stringify({ ...source, stepTicks: undefined }));
    const file = path.join(directory, 'policy.json');
    fs.writeFileSync(file, JSON.stringify(source));
    const sets = ['horizons.0.ticks=60', 'horizons.0.games=2', 'horizons.1.ticks=60', 'horizons.1.games=2', 'staged=false',
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
      assert.ok(h.outcomes.policy.every((g) => Number.isFinite(g.latePop) && g.latePop >= 0), 'missing second-half population');
    }
    // Staged: a candidate that fails the gate test is not played on the guard horizon.
    const stagedCard = await scorecard({ policy: file, against: 'council', workers: 2,
      sets: [...sets.filter((s) => s !== 'staged=false'), 'staged=true', 'gate.minImprove=1000'] });
    assert.deepEqual([Object.keys(stagedCard.horizons), stagedCard.skipped], [['8k'], ['20k']], 'staged evaluation played the guard horizon');
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
  testTrainingConfigSurface();
  testEvaluationSettingsAndGate();
  await testScorecard();
  console.log(`[test:recipe] PASS ${passed.join(' ')}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
