#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadConfig } = require('../src/config');
const { buildRuntime } = require('../src/runtime');
const { createInitialState } = require('../src/state');
const { buildObservation: buildAiObservation, buildFeatures: buildAiFeatures } = require('../src/ai/observation');
const { updateExternalCamps } = require('../src/simulation/external_camps');
const { updateContracts } = require('../src/simulation/contracts');
const { updateRuins } = require('../src/simulation/ruins');
const { updateUnderrealm } = require('../src/simulation/underrealm');
const { updateSeason } = require('../src/simulation/season');
const { updateWarriors, applyWarriorExpeditionOutcome } = require('../src/simulation/warriors');
const { handleReproduction } = require('../src/simulation/population');
const { buildTelemetrySections } = require('../src/telemetry/telemetry');
const { getTelemetryPanelPageCount } = require('../src/telemetry/telemetry_panel');

const ROOT = path.resolve(__dirname, '..');
const PYTHON = path.join(ROOT, '.venv', 'bin', 'python');
const AI_SERVER = path.join(ROOT, 'ai_server.js');
const REGRESSION = path.join(ROOT, 'scripts', 'regression.js');
const PROMOTE = path.join(ROOT, 'python', 'promote_best.py');
const POLICY_BEST = path.join(ROOT, 'models', 'policy_best.json');

// Fail fast with an explicit contract error message.
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Read one JSON file with a strict UTF-8 parser.
function readJson(pathname) {
  return JSON.parse(fs.readFileSync(pathname, 'utf8'));
}

// Write a temporary config that keeps contract smokes compatible with legacy policy resources.
function writeLegacyWarriorsActionHeadConfig(tmpDir, filename) {
  const config = loadConfig();
  const policyPayload = readJson(POLICY_BEST);
  const policyResources = Array.isArray(policyPayload && policyPayload.resources)
    ? policyPayload.resources.map((entry) => String(entry || ''))
    : [];
  const hasWarriorActionHead = policyResources.some((resourceId) => resourceId.startsWith('gov_warriors_'));
  config.ai = config.ai || {};
  config.ai.governors = config.ai.governors || {};
  config.ai.governors.warriors = {
    ...((config.ai.governors && config.ai.governors.warriors) || {}),
    actionHeadEnabled: hasWarriorActionHead,
  };
  const outputPath = path.join(tmpDir, filename);
  fs.writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return outputPath;
}

// Validate policy observation-normalization shape contract.
function validateObservationContract(policy) {
  const resources = Array.isArray(policy && policy.resources) ? policy.resources : [];
  const featureNames = Array.isArray(policy && policy.featureNames) ? policy.featureNames : [];
  assert(resources.length > 0, 'Policy contract: resources list is empty.');
  assert(featureNames.length > 0, 'Policy contract: featureNames list is empty.');

  const expected = resources.length * featureNames.length;
  const observation = policy
    && policy.normalization
    && policy.normalization.observation
    && typeof policy.normalization.observation === 'object'
    ? policy.normalization.observation
    : null;

  assert(observation && observation.enabled === true, 'Policy contract: observation normalization is disabled.');
  const mean = Array.isArray(observation.mean) ? observation.mean : [];
  const variance = Array.isArray(observation.var) ? observation.var : [];
  assert(
    mean.length === expected && variance.length === expected,
    `Policy contract: normalization shape mismatch (expected=${expected}, mean=${mean.length}, var=${variance.length}).`,
  );
}

// Execute one subprocess and enforce expected exit codes.
function runCommand(command, args, options = {}) {
  const allowExitCodes = Array.isArray(options.allowExitCodes) ? options.allowExitCodes : [0];
  const label = String(options.label || command);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.error) {
    throw result.error;
  }
  const status = Number(result.status);
  if (!allowExitCodes.includes(status)) {
    const stdout = String(result.stdout || '').trim();
    const stderr = String(result.stderr || '').trim();
    throw new Error(
      `${label} failed (exit=${status})\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
  return result;
}

// Run one ai_server stdin/stdout session and return parsed JSON responses.
function runAiServerSession(configPath, commands) {
  const payloadLines = (Array.isArray(commands) ? commands : [])
    .map((command) => JSON.stringify(command))
    .join('\n');
  const input = `${payloadLines}\n`;
  const result = spawnSync('node', [
    AI_SERVER,
    '--config', configPath,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    input,
  });
  if (result.error) {
    throw result.error;
  }
  const status = Number(result.status);
  if (status !== 0) {
    const stderr = String(result.stderr || '').trim();
    const stdout = String(result.stdout || '').trim();
    throw new Error(
      `ai_server contract session failed (exit=${status})\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
  const lines = String(result.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

// Validate regression CLI output schema using a tiny deterministic smoke budget.
function validateRegressionReportSchema(tmpDir) {
  const reportJsonPath = path.join(tmpDir, 'regression_contract.json');
  const reportMdPath = path.join(tmpDir, 'regression_contract.md');
  const configPath = writeLegacyWarriorsActionHeadConfig(
    tmpDir,
    'regression_contract_config.json',
  );
  runCommand('node', [
    REGRESSION,
    '--config', configPath,
    '--profile', 'standard',
    '--seeds', '12345',
    '--eval-episodes', '1',
    '--eval-max-steps', '40',
    '--random-episodes', '1',
    '--random-max-steps', '40',
    '--report-json', reportJsonPath,
    '--report-md', reportMdPath,
  ], {
    label: 'regression contract smoke',
    // Short smoke runs can regress on thresholds; schema generation is what we validate here.
    allowExitCodes: [0, 1],
  });

  assert(fs.existsSync(reportJsonPath), 'Regression contract: JSON report was not created.');
  assert(fs.existsSync(reportMdPath), 'Regression contract: Markdown report was not created.');

  const report = readJson(reportJsonPath);
  assert(report && typeof report === 'object', 'Regression contract: report payload is not an object.');
  assert(report.meta && typeof report.meta === 'object', 'Regression contract: missing meta block.');
  assert(typeof report.meta.generatedAt === 'string' && report.meta.generatedAt.length > 0, 'Regression contract: missing meta.generatedAt.');
  assert(report.meta.options && typeof report.meta.options === 'object', 'Regression contract: missing meta.options.');
  assert(Array.isArray(report.meta.options.seeds), 'Regression contract: meta.options.seeds is not an array.');
  assert(Object.prototype.hasOwnProperty.call(report.meta.options, 'seedPack'), 'Regression contract: meta.options.seedPack key missing.');
  assert(Array.isArray(report.sections) && report.sections.length > 0, 'Regression contract: sections are missing.');

  const section = report.sections[0];
  assert(typeof section.profile === 'string' && section.profile.length > 0, 'Regression contract: section.profile missing.');
  assert(Array.isArray(section.evalRows), 'Regression contract: section.evalRows is not an array.');
  assert(Array.isArray(section.randomRows), 'Regression contract: section.randomRows is not an array.');
  if (section.evalRows.length > 0) {
    const row = section.evalRows[0];
    assert(typeof row.metric === 'string', 'Regression contract: eval row metric missing.');
    assert(Object.prototype.hasOwnProperty.call(row, 'status'), 'Regression contract: eval row status missing.');
  }

  const markdown = fs.readFileSync(reportMdPath, 'utf8');
  assert(markdown.includes('# NodeDwarves Regression Report'), 'Regression contract: markdown header missing.');
  assert(markdown.includes('## Profiles'), 'Regression contract: markdown profiles section missing.');
}

// Validate promote report schema and diagnostics block with a tiny eval-only run.
function validatePromoteReportSchema(tmpDir) {
  assert(fs.existsSync(PYTHON), `Promote contract: Python venv not found at ${PYTHON}`);
  const reportJsonPath = path.join(tmpDir, 'promote_contract.json');
  const reportMdPath = path.join(tmpDir, 'promote_contract.md');
  const configPath = writeLegacyWarriorsActionHeadConfig(
    tmpDir,
    'promote_contract_config.json',
  );
  runCommand(PYTHON, [
    PROMOTE,
    '--config', configPath,
    '--eval-only',
    '--model-path', POLICY_BEST,
    '--best-model-path', POLICY_BEST,
    '--eval-episodes', '1',
    '--eval-max-steps', '40',
    '--eval-score', 'rpt',
    '--transport', 'compact',
    '--report-tag', 'test-contracts',
    '--report-json', reportJsonPath,
    '--report-md', reportMdPath,
    '--eval-progress',
    '--eval-progress-every', '1',
  ], {
    label: 'promote contract smoke',
    allowExitCodes: [0],
  });

  assert(fs.existsSync(reportJsonPath), 'Promote contract: JSON report was not created.');
  assert(fs.existsSync(reportMdPath), 'Promote contract: Markdown report was not created.');
  const report = readJson(reportJsonPath);

  assert(report && typeof report === 'object', 'Promote contract: payload is not an object.');
  assert(Number.isFinite(Number(report.version)), 'Promote contract: version missing.');
  assert(report.latest && typeof report.latest === 'object', 'Promote contract: latest block missing.');
  assert(Number.isFinite(Number(report.latest.score)), 'Promote contract: latest.score is not numeric.');
  assert(report.eval_context && typeof report.eval_context === 'object', 'Promote contract: eval_context missing.');
  assert(String(report.eval_context.evalScore || '') === 'rpt', 'Promote contract: eval_context.evalScore mismatch.');

  assert(report.diagnostic && typeof report.diagnostic === 'object', 'Promote contract: diagnostic block missing.');
  assert(report.diagnostic.enabled === true, 'Promote contract: diagnostic.enabled is not true.');
  assert(report.diagnostic.latest && typeof report.diagnostic.latest === 'object', 'Promote contract: diagnostic.latest missing.');
  assert(
    Number.isFinite(Number(report.diagnostic.latest.ensemble_score)),
    'Promote contract: diagnostic.latest.ensemble_score is not numeric.',
  );
  assert(
    Number.isFinite(Number(report.latest.avg_under_depthProgress)),
    'Promote contract: latest.avg_under_depthProgress missing/non-numeric.',
  );
  assert(
    Number.isFinite(Number(report.latest.avg_under_readinessScore)),
    'Promote contract: latest.avg_under_readinessScore missing/non-numeric.',
  );
  assert(
    Number.isFinite(Number(report.latest.avg_under_combatPressure)),
    'Promote contract: latest.avg_under_combatPressure missing/non-numeric.',
  );

  const markdown = fs.readFileSync(reportMdPath, 'utf8');
  assert(markdown.includes('## Diagnostic Ensemble (Non-Blocking)'), 'Promote contract: diagnostic markdown section missing.');
}

// Build a deterministic config profile for external-camps governor smoke scenarios.
function createExternalCampSmokeConfig() {
  const config = loadConfig();
  config.display = {
    ...(config.display || {}),
    autoSize: false,
    width: 90,
    height: 45,
    mapInset: {
      ...((config.display && config.display.mapInset) || {}),
      enabled: false,
    },
  };
  config.externalCamps = {
    ...(config.externalCamps || {}),
    enabled: true,
    minTick: 1,
    spawnRangeTicks: { min: 1, max: 1 },
    maxActive: 1,
    globalCooldownTicks: 0,
    blockDuringRaid: false,
    footprintRadius: 0,
    minDistanceBetween: 0,
    minDistanceFromVillage: 0,
    factionCooldownTicks: { min: 1, max: 1 },
    durationTicks: {
      setupMin: 1,
      setupMax: 1,
      activeMin: 120,
      activeMax: 120,
      withdrawMin: 5,
      withdrawMax: 5,
    },
  };
  config.ai = config.ai || {};
  config.ai.governors = config.ai.governors || {};
  config.ai.governors.externalCamps = {
    enabled: true,
    militiaIntentThreshold: 0.6,
    raiderTributeIntentThreshold: 0.6,
    forceComplianceOnCritical: true,
    criticalStockpileFloor: 0.42,
    criticalResources: ['food', 'water'],
  };
  return config;
}

// Build a deterministic runtime+state pair for external-camps contract scenarios.
function createExternalCampSmokeState(config) {
  const runtime = buildRuntime(config.display, {
    columns: Number(config.display.width || 90),
    rows: Number(config.display.height || 45),
  });
  const state = createInitialState(config, runtime);
  state.resourceTargets = {
    ...(state.resourceTargets || {}),
    food: 100,
    water: 100,
  };
  return { state, runtime };
}

// Advance only external-camps logic for N ticks with an optional action factory.
function runExternalCampTicks(state, config, runtime, ticks, actionFactory) {
  for (let tick = 1; tick <= ticks; tick += 1) {
    state.tick = tick;
    const action = typeof actionFactory === 'function' ? actionFactory(tick) : null;
    updateExternalCamps(state, config, runtime, action);
  }
}

// Validate external-camps action-governor behavior for militia/raider stances.
function validateExternalCampsGovernorContract() {
  // Scenario A: militia low intent should hold payment when affordable.
  {
    const config = createExternalCampSmokeConfig();
    config.externalCamps.trade = { ...((config.externalCamps && config.externalCamps.trade) || {}), enabled: false };
    config.externalCamps.raider = { ...((config.externalCamps && config.externalCamps.raider) || {}), enabled: false };
    config.externalCamps.militia = {
      ...((config.externalCamps && config.externalCamps.militia) || {}),
      enabled: true,
      contractIntervalTicks: 1,
      supportCosts: { wood: 1, stone: 1, beer: 1 },
      supportMinStockpileRatios: { food: 0.1, water: 0.1 },
    };
    config.externalCamps.factions = {
      smoke_militia: { label: 'Smoke Militia', role: 'militia', weight: 1 },
    };
    const { state, runtime } = createExternalCampSmokeState(config);
    for (const resourceId of ['wood', 'stone', 'beer', 'food', 'water']) {
      state.stockpile[resourceId] = 500;
    }
    runExternalCampTicks(state, config, runtime, 10, () => ({
      externalCamps: { militiaSupportIntent: 0.2 },
    }));
    const roleStats = state.externalCamps
      && state.externalCamps.stats
      && state.externalCamps.stats.byRole
      ? state.externalCamps.stats.byRole.militia
      : null;
    assert(roleStats, 'External camps contract: militia stats missing in low-intent scenario.');
    assert(Number(roleStats.actions) > 0, 'External camps contract: militia low-intent scenario produced no actions.');
    assert(
      Number(roleStats.paid) === 0 && Number(roleStats.rejected) === Number(roleStats.actions),
      'External camps contract: militia low-intent stance should reject all affordable renewals.',
    );
  }

  // Scenario B: militia without action payload should fallback to default auto-pay.
  {
    const config = createExternalCampSmokeConfig();
    config.externalCamps.trade = { ...((config.externalCamps && config.externalCamps.trade) || {}), enabled: false };
    config.externalCamps.raider = { ...((config.externalCamps && config.externalCamps.raider) || {}), enabled: false };
    config.externalCamps.militia = {
      ...((config.externalCamps && config.externalCamps.militia) || {}),
      enabled: true,
      contractIntervalTicks: 1,
      supportCosts: { wood: 1, stone: 1, beer: 1 },
      supportMinStockpileRatios: { food: 0.1, water: 0.1 },
    };
    config.externalCamps.factions = {
      smoke_militia: { label: 'Smoke Militia', role: 'militia', weight: 1 },
    };
    const { state, runtime } = createExternalCampSmokeState(config);
    for (const resourceId of ['wood', 'stone', 'beer', 'food', 'water']) {
      state.stockpile[resourceId] = 500;
    }
    runExternalCampTicks(state, config, runtime, 10, () => null);
    const roleStats = state.externalCamps
      && state.externalCamps.stats
      && state.externalCamps.stats.byRole
      ? state.externalCamps.stats.byRole.militia
      : null;
    assert(roleStats, 'External camps contract: militia stats missing in default-fallback scenario.');
    assert(Number(roleStats.actions) > 0, 'External camps contract: militia default-fallback scenario produced no actions.');
    assert(
      Number(roleStats.paid) === Number(roleStats.actions) && Number(roleStats.rejected) === 0,
      'External camps contract: militia default fallback should auto-pay when affordable.',
    );
  }

  // Scenario C: raider low intent with critical collapse should force tribute payment.
  {
    const config = createExternalCampSmokeConfig();
    config.externalCamps.trade = { ...((config.externalCamps && config.externalCamps.trade) || {}), enabled: false };
    config.externalCamps.militia = { ...((config.externalCamps && config.externalCamps.militia) || {}), enabled: false };
    config.externalCamps.raider = {
      ...((config.externalCamps && config.externalCamps.raider) || {}),
      enabled: true,
      demandIntervalTicks: 1,
      tributeCosts: { wood: 1, stone: 1, beer: 1 },
      tributeMinStockpileRatios: { food: 0, water: 0 },
    };
    config.externalCamps.factions = {
      smoke_raider: { label: 'Smoke Raider', role: 'raider', weight: 1 },
    };
    const { state, runtime } = createExternalCampSmokeState(config);
    state.stockpile.wood = 50;
    state.stockpile.stone = 50;
    state.stockpile.beer = 50;
    state.stockpile.food = 35;
    state.stockpile.water = 35;
    const woodBefore = Number(state.stockpile.wood || 0);
    runExternalCampTicks(state, config, runtime, 10, () => ({
      externalCamps: { raiderTributeIntent: 0.1 },
    }));
    const roleStats = state.externalCamps
      && state.externalCamps.stats
      && state.externalCamps.stats.byRole
      ? state.externalCamps.stats.byRole.raider
      : null;
    assert(roleStats, 'External camps contract: raider stats missing in force-compliance scenario.');
    assert(Number(roleStats.actions) > 0, 'External camps contract: raider force-compliance scenario produced no actions.');
    assert(
      Number(roleStats.paid) === Number(roleStats.actions) && Number(roleStats.rejected) === 0,
      'External camps contract: critical-collapse guardrail should force tribute payment when affordable.',
    );
    assert(
      Number(state.stockpile.wood || 0) < woodBefore,
      'External camps contract: forced tribute should consume raider tribute resources.',
    );
  }
}

// Build a deterministic config profile for contract-governor smoke scenarios.
function createContractSmokeConfig() {
  const config = loadConfig();
  config.display = {
    ...(config.display || {}),
    autoSize: false,
    width: 90,
    height: 45,
    mapInset: {
      ...((config.display && config.display.mapInset) || {}),
      enabled: false,
    },
  };
  config.contracts = {
    ...(config.contracts || {}),
    enabled: true,
    spawnRangeTicks: { min: 1, max: 1 },
    expiryTicks: 8,
    requestCount: { min: 1, max: 1 },
    requestRatio: { min: 0.2, max: 0.2 },
    targetBoost: 1,
    allowedResources: ['wood'],
    requestTargets: { wood: 10 },
    requestTargetsPerCapita: {},
    rewards: {
      base: {},
      scalePerResource: 0,
      mineralThresholds: [],
    },
    buffs: {
      durationTicks: 0,
      production: { outputBonus: 0 },
      war: { raidDeathRateReduction: 0, ruinsCombatBonus: 0 },
    },
    factions: {
      smoke_guild: { label: 'Smoke Guild', role: 'production', mineral: null },
    },
  };
  config.ai = config.ai || {};
  config.ai.governors = config.ai.governors || {};
  config.ai.governors.contracts = {
    enabled: true,
    commitIntentThreshold: 0.8,
    forceCompleteTicks: 2,
    reserveMinStockpileRatios: {},
  };
  return config;
}

// Build a deterministic runtime+state pair for contract-governor scenarios.
function createContractSmokeState(config) {
  const runtime = buildRuntime(config.display, {
    columns: Number(config.display.width || 90),
    rows: Number(config.display.height || 45),
  });
  const state = createInitialState(config, runtime);
  state.resourceTargets = {
    ...(state.resourceTargets || {}),
    wood: 10,
  };
  return { state, runtime };
}

// Advance only contract logic for N ticks with optional action factory and capture success/failure ticks.
function runContractTicks(state, config, ticks, actionFactory) {
  let firstSuccessTick = null;
  let firstFailureTick = null;
  for (let tick = 1; tick <= ticks; tick += 1) {
    state.tick = tick;
    const action = typeof actionFactory === 'function' ? actionFactory(tick) : null;
    updateContracts(state, config, action);
    const stats = state.contracts && state.contracts.stats ? state.contracts.stats : null;
    if (stats && firstSuccessTick === null && Number(stats.successes || 0) > 0) {
      firstSuccessTick = tick;
    }
    if (stats && firstFailureTick === null && Number(stats.failures || 0) > 0) {
      firstFailureTick = tick;
    }
  }
  return { firstSuccessTick, firstFailureTick };
}

// Validate contract-governor timing behavior (intent hold, fallback, reserve guardrail).
function validateContractGovernorContract() {
  // Scenario A: low commit intent should hold until force window, then complete.
  {
    const config = createContractSmokeConfig();
    const { state } = createContractSmokeState(config);
    state.stockpile.wood = 100;
    const { firstSuccessTick, firstFailureTick } = runContractTicks(
      state,
      config,
      12,
      () => ({ contracts: { commitIntent: 0.2 } }),
    );
    const stats = state.contracts && state.contracts.stats ? state.contracts.stats : null;
    assert(stats, 'Contracts governor contract: stats missing in low-intent scenario.');
    assert(Number(stats.successes || 0) === 1, 'Contracts governor contract: low-intent scenario should eventually complete once.');
    assert(Number(stats.failures || 0) === 0, 'Contracts governor contract: low-intent scenario must not fail before force-complete.');
    assert(firstSuccessTick !== null, 'Contracts governor contract: low-intent scenario completion tick missing.');
    assert(firstSuccessTick >= 7, 'Contracts governor contract: low-intent completion happened before force window.');
    assert(firstFailureTick === null, 'Contracts governor contract: low-intent scenario unexpectedly failed.');
  }

  // Scenario B: missing action payload should preserve immediate auto-complete fallback.
  {
    const config = createContractSmokeConfig();
    const { state } = createContractSmokeState(config);
    state.stockpile.wood = 100;
    const { firstSuccessTick, firstFailureTick } = runContractTicks(
      state,
      config,
      2,
      () => null,
    );
    const stats = state.contracts && state.contracts.stats ? state.contracts.stats : null;
    assert(stats, 'Contracts governor contract: stats missing in fallback scenario.');
    assert(Number(stats.successes || 0) === 1, 'Contracts governor contract: fallback scenario should complete exactly once.');
    assert(Number(stats.failures || 0) === 0, 'Contracts governor contract: fallback scenario must not fail.');
    assert(firstSuccessTick !== null && firstSuccessTick <= 2, 'Contracts governor contract: fallback completion should happen immediately when affordable.');
    assert(firstFailureTick === null, 'Contracts governor contract: fallback scenario unexpectedly failed.');
  }

  // Scenario C: reserve-ratio guardrail should block early completion when post-commit floor is violated.
  {
    const config = createContractSmokeConfig();
    config.ai.governors.contracts.reserveMinStockpileRatios = { wood: 0.9 };
    config.ai.governors.contracts.forceCompleteTicks = 0;
    config.contracts.expiryTicks = 20;
    const { state } = createContractSmokeState(config);
    state.stockpile.wood = 10;
    const { firstSuccessTick, firstFailureTick } = runContractTicks(
      state,
      config,
      6,
      () => ({ contracts: { commitIntent: 1 } }),
    );
    const stats = state.contracts && state.contracts.stats ? state.contracts.stats : null;
    assert(stats, 'Contracts governor contract: stats missing in reserve-guard scenario.');
    assert(Number(stats.successes || 0) === 0, 'Contracts governor contract: reserve guardrail should block early completion.');
    assert(Number(stats.failures || 0) === 0, 'Contracts governor contract: reserve guardrail scenario should stay pending in early window.');
    assert(firstSuccessTick === null, 'Contracts governor contract: reserve guardrail scenario completed unexpectedly.');
    assert(firstFailureTick === null, 'Contracts governor contract: reserve guardrail scenario failed unexpectedly.');
  }
}

// Build a deterministic config profile for ruins-governor smoke scenarios.
function createRuinsSmokeConfig() {
  const config = loadConfig();
  config.display = {
    ...(config.display || {}),
    autoSize: false,
    width: 90,
    height: 45,
    mapInset: {
      ...((config.display && config.display.mapInset) || {}),
      enabled: false,
    },
  };
  config.ruins = {
    ...(config.ruins || {}),
    enabled: true,
    expedition: {
      ...((config.ruins && config.ruins.expedition) || {}),
      requiresArmory: false,
      kitResource: 'expedition_kit',
      minPopulation: 1,
      minIdleAdults: 1,
      minStockpileRatio: {},
      cooldownTicks: 4,
      failureCooldownTicks: 4,
      partySizeMin: 1,
      partySizeMax: 1,
      maxConcurrentAfterClear: 1,
    },
    mithrilReinforcement: {
      ...((config.ruins && config.ruins.mithrilReinforcement) || {}),
      enabled: true,
      minRoom: 1,
      cost: { mithril: 1 },
      powerBonus: 0.2,
    },
    rooms: [
      {
        name: 'Smoke Ruin',
        expeditionTicks: 8,
        partySize: 1,
        cost: {},
        hazardChance: 0,
        guardianChance: 0,
        guardianPower: 0,
        artifactChance: 0,
        artifactRolls: 0,
      },
    ],
    artifacts: { sets: {}, pool: {} },
    setBonuses: {},
    comboBonuses: [],
  };
  config.ai = config.ai || {};
  config.ai.governors = config.ai.governors || {};
  config.ai.governors.ruins = {
    enabled: true,
    warningDispatchIntentThreshold: 0.8,
    mithrilReinforcementIntentThreshold: 0.8,
  };
  return config;
}

// Build a deterministic runtime+state pair for ruins-governor scenarios.
function createRuinsSmokeState(config, options = {}) {
  const runtime = buildRuntime(config.display, {
    columns: Number(config.display.width || 90),
    rows: Number(config.display.height || 45),
  });
  const state = createInitialState(config, runtime);
  state.stockpile.expedition_kit = 20;
  state.stockpile.mithril = 20;

  const structures = Array.isArray(state.structures) ? state.structures : [];
  if (!structures.some((entry) => entry && entry.type === 'ruins')) {
    structures.push({ id: 'smoke_ruins', type: 'ruins', x: 1, y: 1 });
  }
  if (!structures.some((entry) => entry && entry.type === 'armory')) {
    structures.push({ id: 'smoke_armory', type: 'armory', x: 2, y: 2, level: 1 });
  }
  state.structures = structures;

  const warningMode = options.warningMode === true;
  const combat = state.underrealm && state.underrealm.combat ? state.underrealm.combat : null;
  const floor = combat && combat.floorsByDepth ? combat.floorsByDepth['1'] : null;
  if (combat) {
    combat.progressionMode = 'none';
  }
  if (floor) {
    floor.unlocked = true;
    floor.state = 'cleared';
    floor.unlock = { required: false, cleared: true };
    floor.encounter = { cooldownTicksRemaining: 0 };
    floor.minArmoryLevel = 1;
    floor.readiness = {
      ...(floor.readiness || {}),
      minScore: 0,
      recommendedScore: warningMode ? 100 : 0,
    };
  }
  if (combat && combat.readiness) {
    combat.readiness.hardMinGate = true;
    combat.readiness.warningZoneHardGuard = {
      enabled: true,
      minDepth: 3,
      minRecommendedScoreRatio: 0.99,
    };
  }

  return { state, runtime };
}

// Advance only ruins logic for N ticks with optional action factory.
function runRuinsTicks(state, config, runtime, ticks, actionFactory) {
  for (let tick = 1; tick <= ticks; tick += 1) {
    state.tick = tick;
    const action = typeof actionFactory === 'function' ? actionFactory(tick) : null;
    updateRuins(state, config, runtime, action);
  }
}

// Validate ruins-governor behavior for warning-zone dispatch and mithril posture.
function validateRuinsGovernorContract() {
  // Scenario A: warning-zone low intent should hold dispatch.
  {
    const config = createRuinsSmokeConfig();
    const { state, runtime } = createRuinsSmokeState(config, { warningMode: true });
    runRuinsTicks(state, config, runtime, 1, () => ({
      ruins: { warningDispatchIntent: 0.1, mithrilReinforcementIntent: 1 },
    }));
    const stats = state.ruins && state.ruins.stats ? state.ruins.stats : null;
    assert(stats, 'Ruins governor contract: stats missing in warning low-intent scenario.');
    assert(Number(stats.started || 0) === 0, 'Ruins governor contract: warning low-intent scenario should hold dispatch.');
    assert(Array.isArray(state.ruins.expeditions) && state.ruins.expeditions.length === 0, 'Ruins governor contract: warning low-intent scenario unexpectedly started expedition.');
  }

  // Scenario B: warning-zone without action payload should preserve legacy dispatch fallback.
  {
    const config = createRuinsSmokeConfig();
    const { state, runtime } = createRuinsSmokeState(config, { warningMode: true });
    runRuinsTicks(state, config, runtime, 1, () => null);
    const stats = state.ruins && state.ruins.stats ? state.ruins.stats : null;
    const expedition = state.ruins && Array.isArray(state.ruins.expeditions) ? state.ruins.expeditions[0] : null;
    assert(stats, 'Ruins governor contract: stats missing in warning fallback scenario.');
    assert(Number(stats.started || 0) === 1, 'Ruins governor contract: warning fallback scenario should start one expedition.');
    assert(expedition && expedition.active !== false, 'Ruins governor contract: warning fallback scenario missing active expedition.');
    assert(expedition.readiness && expedition.readiness.status === 'warning', 'Ruins governor contract: warning fallback expedition should keep warning readiness status.');
  }

  // Scenario C: mithril low intent should keep expedition start but hold reinforcement spend.
  {
    const config = createRuinsSmokeConfig();
    const { state, runtime } = createRuinsSmokeState(config, { warningMode: false });
    const mithrilBefore = Number(state.stockpile.mithril || 0);
    runRuinsTicks(state, config, runtime, 1, () => ({
      ruins: { mithrilReinforcementIntent: 0.1 },
    }));
    const stats = state.ruins && state.ruins.stats ? state.ruins.stats : null;
    const expedition = state.ruins && Array.isArray(state.ruins.expeditions) ? state.ruins.expeditions[0] : null;
    assert(stats, 'Ruins governor contract: stats missing in mithril low-intent scenario.');
    assert(Number(stats.started || 0) === 1, 'Ruins governor contract: mithril low-intent scenario should still start expedition.');
    assert(expedition && expedition.useMithril === false, 'Ruins governor contract: mithril low-intent scenario should not enable reinforcement.');
    assert(Number(state.stockpile.mithril || 0) === mithrilBefore, 'Ruins governor contract: mithril low-intent scenario should not consume mithril.');
  }

  // Scenario D: mithril fallback without action payload should preserve legacy auto-use when eligible.
  {
    const config = createRuinsSmokeConfig();
    const { state, runtime } = createRuinsSmokeState(config, { warningMode: false });
    const mithrilBefore = Number(state.stockpile.mithril || 0);
    runRuinsTicks(state, config, runtime, 1, () => null);
    const stats = state.ruins && state.ruins.stats ? state.ruins.stats : null;
    const expedition = state.ruins && Array.isArray(state.ruins.expeditions) ? state.ruins.expeditions[0] : null;
    assert(stats, 'Ruins governor contract: stats missing in mithril fallback scenario.');
    assert(Number(stats.started || 0) === 1, 'Ruins governor contract: mithril fallback scenario should start one expedition.');
    assert(expedition && expedition.useMithril === true, 'Ruins governor contract: mithril fallback scenario should enable reinforcement.');
    assert(Number(state.stockpile.mithril || 0) < mithrilBefore, 'Ruins governor contract: mithril fallback scenario should consume mithril.');
  }
}

// Build a deterministic config profile for underrealm-crew governor smoke scenarios.
function createUnderrealmCrewSmokeConfig() {
  const config = loadConfig();
  config.display = {
    ...(config.display || {}),
    autoSize: false,
    width: 90,
    height: 45,
    mapInset: {
      ...((config.display && config.display.mapInset) || {}),
      enabled: false,
    },
  };
  config.underrealm = {
    ...(config.underrealm || {}),
    enabled: true,
    max_depth: 3,
    discovery: {
      ...((config.underrealm && config.underrealm.discovery) || {}),
      enabled: false,
    },
    economy: {
      ...((config.underrealm && config.underrealm.economy) || {}),
      enabled: false,
    },
    progression: {
      ...((config.underrealm && config.underrealm.progression) || {}),
      enabled: false,
    },
    hostiles: {
      ...((config.underrealm && config.underrealm.hostiles) || {}),
      enabled: false,
    },
    shrines: {
      ...((config.underrealm && config.underrealm.shrines) || {}),
      enabled: false,
    },
    combat: {
      ...((config.underrealm && config.underrealm.combat) || {}),
      enabled: false,
      dwarf_champion: {
        ...(((config.underrealm && config.underrealm.combat) || {}).dwarf_champion || {}),
        enabled: false,
        requires_party_presence: false,
      },
    },
    crew: {
      ...((config.underrealm && config.underrealm.crew) || {}),
      enabled: true,
      surface_reserve_ratio: 0.5,
      max_underrealm_ratio: 0.8,
      depth_weight_growth: 0.1,
      roles: {
        miner_ratio: 0.5,
        hauler_ratio: 0.25,
        guard_ratio: 0.25,
      },
    },
  };
  config.ai = config.ai || {};
  config.ai.governors = config.ai.governors || {};
  config.ai.governors.underrealm = {
    enabled: true,
    surfaceReserveBiasMax: 0.2,
    depthAllocationBiasMax: 0.2,
    roleMixBiasMax: 0.2,
    smoothingAlpha: 1,
    majorReallocationThreshold: 0.05,
    reallocationCooldownTicks: 5,
    surfaceReserveRatioMin: 0.2,
    surfaceReserveRatioMax: 0.8,
    depthWeightGrowthMin: 0,
    depthWeightGrowthMax: 0.4,
    roleRatioMin: 0.02,
    roleRatioMax: 0.9,
  };
  return config;
}

// Build a deterministic runtime+state pair for underrealm-crew governor scenarios.
function createUnderrealmCrewSmokeState(config) {
  const runtime = buildRuntime(config.display, {
    columns: Number(config.display.width || 90),
    rows: Number(config.display.height || 45),
  });
  const state = createInitialState(config, runtime);
  state.tick = 0;
  state.jobs = [];
  state.dwarves = Array.from({ length: 40 }, (_, index) => ({
    id: `ud_smoke_${index + 1}`,
    lifeStage: 'adult',
    ageTicks: 1200 + index,
    spawnIndex: index + 1,
    role: index % 3 === 0 ? 'gatherer' : (index % 3 === 1 ? 'builder' : 'manager'),
    job: null,
    expedition: false,
    underrealmChampionSurvivals: 0,
    state: {
      morale: 0.7,
      stress: 0.2,
    },
  }));
  if (state.underrealm) {
    state.underrealm.maxUnlockedDepth = 3;
    state.underrealm.discovery = {
      ...(state.underrealm.discovery || {}),
      enabled: false,
      found: true,
    };
    if (state.underrealm.combat && state.underrealm.combat.dwarfChampion) {
      state.underrealm.combat.dwarfChampion.enabled = false;
      state.underrealm.combat.dwarfChampion.activeDwarfId = null;
    }
  }
  return { state, runtime };
}

// Run underrealm systems for N ticks with optional action factory.
function runUnderrealmCrewTicks(state, config, ticks, actionFactory) {
  for (let tick = 1; tick <= ticks; tick += 1) {
    state.tick = tick;
    const action = typeof actionFactory === 'function' ? actionFactory(tick) : null;
    updateUnderrealm(state, config, action);
  }
}

// Sum one role count across all underrealm depths.
function getUnderrealmRoleTotal(crew, roleId) {
  const rolesByDepth = crew && crew.rolesByDepth && typeof crew.rolesByDepth === 'object'
    ? crew.rolesByDepth
    : {};
  let total = 0;
  for (const depthRoles of Object.values(rolesByDepth)) {
    total += Math.max(0, Number(depthRoles && depthRoles[roleId] || 0));
  }
  return total;
}

// Validate underrealm-governor behavior for reserve/depth/role posture and cooldown hold.
function validateUnderrealmGovernorContract() {
  // Scenario A: default fallback keeps baseline posture and deterministic assignment.
  {
    const config = createUnderrealmCrewSmokeConfig();
    const { state } = createUnderrealmCrewSmokeState(config);
    runUnderrealmCrewTicks(state, config, 1, () => null);
    const crew = state.underrealm && state.underrealm.crew ? state.underrealm.crew : null;
    const governor = crew && crew.governor ? crew.governor : null;
    assert(crew, 'Underrealm governor contract: crew missing in default scenario.');
    assert(governor, 'Underrealm governor contract: governor runtime missing in default scenario.');
    assert(governor.source === 'default', 'Underrealm governor contract: default scenario should keep source=default.');
    assert(
      Math.abs(Number(governor.applied.surfaceReserveRatio || 0) - 0.5) < 1e-6,
      'Underrealm governor contract: default scenario should keep baseline surface reserve ratio.',
    );
    assert(Number(crew.totalAssigned || 0) > 0, 'Underrealm governor contract: default scenario should assign delvers.');
  }

  // Scenario B: positive surface-reserve bias should reduce deep assignments.
  {
    const config = createUnderrealmCrewSmokeConfig();
    const baseline = createUnderrealmCrewSmokeState(config);
    runUnderrealmCrewTicks(baseline.state, config, 1, () => null);
    const baselineAssigned = Number(baseline.state.underrealm.crew.totalAssigned || 0);

    const { state } = createUnderrealmCrewSmokeState(config);
    runUnderrealmCrewTicks(state, config, 1, () => ({
      underrealm: { surfaceReserveBias: 2 },
    }));
    const crew = state.underrealm && state.underrealm.crew ? state.underrealm.crew : null;
    const governor = crew && crew.governor ? crew.governor : null;
    assert(governor && governor.source === 'action', 'Underrealm governor contract: reserve-bias scenario should use action source.');
    assert(
      Number(governor.applied.surfaceReserveRatio || 0) > 0.5,
      'Underrealm governor contract: positive reserve bias should increase surface reserve ratio.',
    );
    assert(
      Number(crew.totalAssigned || 0) < baselineAssigned,
      'Underrealm governor contract: positive reserve bias should reduce underrealm assigned crew.',
    );
  }

  // Scenario C: depth-allocation bias should change applied depth growth.
  {
    const config = createUnderrealmCrewSmokeConfig();
    const { state } = createUnderrealmCrewSmokeState(config);
    runUnderrealmCrewTicks(state, config, 1, () => ({
      underrealm: { depthAllocationBias: 2 },
    }));
    const crew = state.underrealm && state.underrealm.crew ? state.underrealm.crew : null;
    const governor = crew && crew.governor ? crew.governor : null;
    assert(governor, 'Underrealm governor contract: depth-bias scenario missing governor runtime.');
    assert(
      Number(governor.applied.depthWeightGrowth || 0) > 0.1,
      'Underrealm governor contract: positive depth bias should increase depth weight growth.',
    );
  }

  // Scenario D: role-mix biases should tilt role distribution (more guards, fewer miners).
  {
    const config = createUnderrealmCrewSmokeConfig();
    const { state } = createUnderrealmCrewSmokeState(config);
    runUnderrealmCrewTicks(state, config, 1, () => ({
      underrealm: {
        minerMixBias: 0,
        haulerMixBias: 1,
        guardMixBias: 2,
      },
    }));
    const crew = state.underrealm && state.underrealm.crew ? state.underrealm.crew : null;
    const governor = crew && crew.governor ? crew.governor : null;
    assert(governor, 'Underrealm governor contract: role-mix scenario missing governor runtime.');
    const appliedRoles = governor.applied && governor.applied.roles ? governor.applied.roles : {};
    assert(
      Number(appliedRoles.guardRatio || 0) > 0.25,
      'Underrealm governor contract: guard mix bias should increase applied guard ratio.',
    );
    assert(
      Number(appliedRoles.minerRatio || 0) < 0.5,
      'Underrealm governor contract: miner mix negative bias should reduce applied miner ratio.',
    );
    const guards = getUnderrealmRoleTotal(crew, 'guard');
    const miners = getUnderrealmRoleTotal(crew, 'miner');
    assert(guards > 0, 'Underrealm governor contract: role-mix scenario should assign guards.');
    assert(miners > 0, 'Underrealm governor contract: role-mix scenario should still assign miners.');
  }

  // Scenario E: cooldown should hold major reallocation flips within the configured window.
  {
    const config = createUnderrealmCrewSmokeConfig();
    const { state } = createUnderrealmCrewSmokeState(config);
    state.tick = 1;
    updateUnderrealm(state, config, {
      underrealm: {
        minerMixBias: 0,
        haulerMixBias: 1,
        guardMixBias: 2,
      },
    });
    const crew = state.underrealm && state.underrealm.crew ? state.underrealm.crew : null;
    const governor = crew && crew.governor ? crew.governor : null;
    assert(governor, 'Underrealm governor contract: cooldown scenario missing governor runtime after tick1.');
    const appliedAfterTick1 = {
      minerRatio: Number(governor.applied.roles && governor.applied.roles.minerRatio || 0),
      haulerRatio: Number(governor.applied.roles && governor.applied.roles.haulerRatio || 0),
      guardRatio: Number(governor.applied.roles && governor.applied.roles.guardRatio || 0),
    };

    state.tick = 2;
    updateUnderrealm(state, config, {
      underrealm: {
        minerMixBias: 2,
        haulerMixBias: 1,
        guardMixBias: 0,
      },
    });
    const governorAfterTick2 = state.underrealm.crew && state.underrealm.crew.governor
      ? state.underrealm.crew.governor
      : null;
    assert(governorAfterTick2, 'Underrealm governor contract: cooldown scenario missing governor runtime after tick2.');
    assert(
      governorAfterTick2.holdByCooldown === true,
      'Underrealm governor contract: major flip inside cooldown window should be held.',
    );
    assert(
      Math.abs(Number(governorAfterTick2.applied.roles.minerRatio || 0) - appliedAfterTick1.minerRatio) < 1e-6
      && Math.abs(Number(governorAfterTick2.applied.roles.haulerRatio || 0) - appliedAfterTick1.haulerRatio) < 1e-6
      && Math.abs(Number(governorAfterTick2.applied.roles.guardRatio || 0) - appliedAfterTick1.guardRatio) < 1e-6,
      'Underrealm governor contract: cooldown hold should keep previous applied role mix.',
    );
  }
}

// Execute one callback under a deterministic Math.random stream.
function withDeterministicRandom(seed, callback) {
  const previous = Math.random;
  let value = Number(seed) >>> 0;
  Math.random = () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
  try {
    return callback();
  } finally {
    Math.random = previous;
  }
}

// Build a deterministic smoke config for warrior scaffold contracts.
function createWarriorsSmokeConfig(options = {}) {
  const config = loadConfig();
  config.display = {
    ...(config.display || {}),
    autoSize: false,
    width: 90,
    height: 45,
    mapInset: {
      ...((config.display && config.display.mapInset) || {}),
      enabled: false,
    },
  };
  config.population = config.population || {};
  config.population.reproduction = {
    ...(config.population.reproduction || {}),
    enabled: true,
  };
  if (options.withWarriorsBlock === false) {
    delete config.warriors;
  } else {
    config.warriors = {
      ...(config.warriors || {}),
      enabled: options.enabled === true,
    };
  }
  return config;
}

// Build deterministic signature for behavior-neutral comparison.
function getWarriorsNeutralSignature(state) {
  const dwarves = Array.isArray(state && state.dwarves) ? state.dwarves : [];
  const nodes = Array.isArray(state && state.nodes) ? state.nodes : [];
  const structures = Array.isArray(state && state.structures) ? state.structures : [];
  const ruins = state && state.ruins ? state.ruins : null;
  const underrealm = state && state.underrealm ? state.underrealm : null;
  return JSON.stringify({
    tick: Math.max(0, Number(state && state.tick || 0)),
    dwarfCounter: Math.max(0, Number(state && state.dwarfCounter || 0)),
    dwarves: dwarves.map((dwarf) => ({
      id: String(dwarf && dwarf.id || ''),
      spawnIndex: Math.max(0, Number(dwarf && dwarf.spawnIndex || 0)),
      x: Math.max(0, Number(dwarf && dwarf.x || 0)),
      y: Math.max(0, Number(dwarf && dwarf.y || 0)),
      clanId: dwarf && dwarf.clanId ? String(dwarf.clanId) : null,
      role: dwarf && dwarf.role ? String(dwarf.role) : null,
      lifeStage: dwarf && dwarf.lifeStage ? String(dwarf.lifeStage) : '',
      ageTicks: Math.max(0, Number(dwarf && dwarf.ageTicks || 0)),
      underrealmChampionSurvivals: Math.max(0, Number(dwarf && dwarf.underrealmChampionSurvivals || 0)),
    })),
    nodes: nodes.map((node) => ({
      id: String(node && node.id || ''),
      x: Math.max(0, Number(node && node.x || 0)),
      y: Math.max(0, Number(node && node.y || 0)),
      remaining: Math.max(0, Number(node && node.remaining || 0)),
    })),
    structures: structures.map((structure) => ({
      id: String(structure && structure.id || ''),
      type: String(structure && structure.type || ''),
      x: Math.max(0, Number(structure && structure.x || 0)),
      y: Math.max(0, Number(structure && structure.y || 0)),
      level: Math.max(0, Number(structure && structure.level || 0)),
      capacity: Math.max(0, Number(structure && structure.capacity || 0)),
    })),
    stockpile: state && state.stockpile ? state.stockpile : {},
    ruins: ruins ? {
      roomsCleared: Math.max(0, Number(ruins.roomsCleared || 0)),
      roomCount: Math.max(0, Number(ruins.roomCount || 0)),
      cooldown: Math.max(0, Number(ruins.cooldown || 0)),
      stats: {
        started: Math.max(0, Number(ruins.stats && ruins.stats.started || 0)),
        successes: Math.max(0, Number(ruins.stats && ruins.stats.successes || 0)),
        failures: Math.max(0, Number(ruins.stats && ruins.stats.failures || 0)),
        artifacts: Math.max(0, Number(ruins.stats && ruins.stats.artifacts || 0)),
      },
    } : null,
    underrealm: underrealm ? {
      maxDepth: Math.max(0, Number(underrealm.maxDepth || 0)),
      maxUnlockedDepth: Math.max(0, Number(underrealm.maxUnlockedDepth || 0)),
      activeDepth: Math.max(0, Number(underrealm.activeDepth || 0)),
    } : null,
  });
}

// Validate disabled warrior config keeps legacy behavior neutral.
function validateWarriorsDisabledNeutralContract() {
  const legacyConfig = createWarriorsSmokeConfig({
    withWarriorsBlock: false,
  });
  const disabledConfig = createWarriorsSmokeConfig({
    withWarriorsBlock: true,
    enabled: false,
  });
  const runtime = buildRuntime(legacyConfig.display, {
    columns: Number(legacyConfig.display.width || 90),
    rows: Number(legacyConfig.display.height || 45),
  });

  const legacyState = withDeterministicRandom(4101, () => createInitialState(legacyConfig, runtime));
  const disabledState = withDeterministicRandom(4101, () => createInitialState(disabledConfig, runtime));
  assert(
    getWarriorsNeutralSignature(legacyState) === getWarriorsNeutralSignature(disabledState),
    'Warriors contract: disabled config changed deterministic initial-state behavior.',
  );
  assert(
    disabledState.warriors && disabledState.warriors.enabled === false,
    'Warriors contract: disabled runtime scaffold missing or malformed.',
  );

  const legacyAfterRuins = withDeterministicRandom(7713, () => {
    const state = createInitialState(legacyConfig, runtime);
    runRuinsTicks(state, legacyConfig, runtime, 6, () => null);
    return state;
  });
  const disabledAfterRuins = withDeterministicRandom(7713, () => {
    const state = createInitialState(disabledConfig, runtime);
    runRuinsTicks(state, disabledConfig, runtime, 6, () => null);
    return state;
  });
  assert(
    getWarriorsNeutralSignature(legacyAfterRuins) === getWarriorsNeutralSignature(disabledAfterRuins),
    'Warriors contract: disabled config changed deterministic ruins behavior.',
  );
}

// Validate warrior phase-1 bootstrap payloads and newborn wiring.
function validateWarriorsBootstrapContract() {
  const config = createWarriorsSmokeConfig({
    withWarriorsBlock: true,
    enabled: true,
  });
  const runtime = buildRuntime(config.display, {
    columns: Number(config.display.width || 90),
    rows: Number(config.display.height || 45),
  });
  const stateA = withDeterministicRandom(9911, () => createInitialState(config, runtime));
  const stateB = withDeterministicRandom(9911, () => createInitialState(config, runtime));
  assert(stateA.warriors && stateA.warriors.enabled === true, 'Warriors contract: enabled runtime scaffold missing.');

  const dwarvesA = Array.isArray(stateA.dwarves) ? stateA.dwarves : [];
  const dwarvesB = Array.isArray(stateB.dwarves) ? stateB.dwarves : [];
  assert(dwarvesA.length > 2, 'Warriors contract: bootstrap state has insufficient dwarves.');
  for (let index = 0; index < Math.min(dwarvesA.length, 8); index += 1) {
    const left = dwarvesA[index];
    const right = dwarvesB[index];
    const leftWarrior = left && left.warrior && typeof left.warrior === 'object'
      ? left.warrior
      : null;
    const rightWarrior = right && right.warrior && typeof right.warrior === 'object'
      ? right.warrior
      : null;
    assert(leftWarrior, `Warriors contract: missing warrior payload for dwarf ${left && left.id}.`);
    assert(rightWarrior, `Warriors contract: deterministic mirror missing warrior payload for dwarf ${right && right.id}.`);
    const leftProfile = leftWarrior.baseProfile || {};
    const rightProfile = rightWarrior.baseProfile || {};
    const keys = ['strength', 'dexterity', 'vitality'];
    for (const key of keys) {
      const leftValue = Number(leftProfile[key] || 0);
      const rightValue = Number(rightProfile[key] || 0);
      assert(leftValue >= 0 && leftValue <= 1, `Warriors contract: ${key} out of range for ${left && left.id}.`);
      assert(Math.abs(leftValue - rightValue) < 1e-9, `Warriors contract: ${key} deterministic mismatch for ${left && left.id}.`);
    }
    assert(
      Number(leftWarrior.heroPotential || 0) >= 0 && Number(leftWarrior.heroPotential || 0) <= 1,
      `Warriors contract: heroPotential out of range for ${left && left.id}.`,
    );
  }

  const parentA = dwarvesA[0];
  const parentB = dwarvesA[1];
  assert(parentA && parentB, 'Warriors contract: missing parents for newborn wiring check.');
  parentA.pregnancy = {
    dueTick: 0,
    partnerId: parentB.id,
  };
  stateA.tick = 1;
  const before = dwarvesA.length;
  handleReproduction(stateA, config);
  const after = Array.isArray(stateA.dwarves) ? stateA.dwarves.length : 0;
  assert(after === before + 1, 'Warriors contract: newborn was not spawned during due pregnancy processing.');
  const newborn = stateA.dwarves[stateA.dwarves.length - 1];
  assert(newborn && newborn.warrior, 'Warriors contract: newborn missing warrior payload.');
  const newbornProfile = newborn.warrior.baseProfile || {};
  for (const key of ['strength', 'dexterity', 'vitality']) {
    const value = Number(newbornProfile[key] || 0);
    assert(value >= 0 && value <= 1, `Warriors contract: newborn ${key} out of range.`);
  }
}

// Validate warrior governor phase-1 plumbing (action envelope -> runtime snapshot).
function validateWarriorsGovernorPhase1Contract() {
  const config = createWarriorsSmokeConfig({
    withWarriorsBlock: true,
    enabled: true,
  });
  config.ai = config.ai || {};
  config.ai.minWeight = 0;
  config.ai.maxWeight = 2;
  config.ai.governors = config.ai.governors || {};
  config.ai.governors.warriors = {
    enabled: true,
    trainingIntentThreshold: 0.7,
    rotationIntentThreshold: 0.45,
    tournamentRiskIntentThreshold: 0.65,
    championChallengeIntentThreshold: 0.6,
    recoveryPriorityIntentThreshold: 0.75,
  };
  const runtime = buildRuntime(config.display, {
    columns: Number(config.display.width || 90),
    rows: Number(config.display.height || 45),
  });
  const state = createInitialState(config, runtime);
  state.tick = 11;
  state.season = {
    ...(state.season || {}),
    tickInSeason: 2,
  };

  updateWarriors(state, config, {
    warriors: {
      trainingIntent: 1.9,
      rotationIntent: 0.6,
      tournamentRiskIntent: 1.7,
      championChallengeIntent: 0.4,
      recoveryPriorityIntent: 1.8,
    },
  });
  const governor = state.warriors && state.warriors.governor ? state.warriors.governor : null;
  assert(governor, 'Warriors phase1 contract: missing governor runtime snapshot.');
  assert(governor.source === 'action', 'Warriors phase1 contract: action payload should set source=action.');
  assert(
    Math.abs(Number(governor.intents.trainingIntent || 0) - 0.95) < 1e-6,
    'Warriors phase1 contract: training intent normalization mismatch.',
  );
  assert(
    Math.abs(Number(governor.intents.rotationIntent || 0) - 0.3) < 1e-6,
    'Warriors phase1 contract: rotation intent normalization mismatch.',
  );
  assert(
    Math.abs(Number(governor.intents.tournamentRiskIntent || 0) - 0.85) < 1e-6,
    'Warriors phase1 contract: tournament-risk intent normalization mismatch.',
  );
  assert(governor.applied.training === true, 'Warriors phase1 contract: training threshold gate mismatch.');
  assert(governor.applied.rotation === false, 'Warriors phase1 contract: rotation threshold gate mismatch.');
  assert(governor.applied.tournamentRisk === true, 'Warriors phase1 contract: tournament-risk threshold gate mismatch.');
  assert(governor.applied.championChallenge === false, 'Warriors phase1 contract: champion threshold gate mismatch.');
  assert(governor.applied.recoveryPriority === true, 'Warriors phase1 contract: recovery threshold gate mismatch.');
  assert(
    String(governor.dominantIntent || '') === 'training',
    'Warriors phase1 contract: dominant intent should follow strongest normalized signal.',
  );
  const stats = state.warriors && state.warriors.stats ? state.warriors.stats : null;
  assert(stats, 'Warriors phase1 contract: missing warrior stats runtime.');
  assert(Number(stats.injuries || 0) === 0, 'Warriors phase1 contract: injuries counter should initialize at zero.');
  assert(Number(stats.retirements || 0) === 0, 'Warriors phase1 contract: retirements counter should initialize at zero.');
  assert(Number(stats.heroTurnovers || 0) === 0, 'Warriors phase1 contract: heroTurnovers counter should initialize at zero.');

  state.tick += 1;
  updateWarriors(state, config, null);
  const fallbackGovernor = state.warriors && state.warriors.governor ? state.warriors.governor : null;
  assert(fallbackGovernor, 'Warriors phase1 contract: fallback governor snapshot missing.');
  assert(
    fallbackGovernor.source === 'default',
    'Warriors phase1 contract: missing action payload should set source=default.',
  );
  assert(
    Math.abs(Number(fallbackGovernor.intents.trainingIntent || 0) - 1) < 1e-6
    && Math.abs(Number(fallbackGovernor.intents.rotationIntent || 0) - 1) < 1e-6
    && Math.abs(Number(fallbackGovernor.intents.tournamentRiskIntent || 0) - 1) < 1e-6
    && Math.abs(Number(fallbackGovernor.intents.championChallengeIntent || 0) - 1) < 1e-6
    && Math.abs(Number(fallbackGovernor.intents.recoveryPriorityIntent || 0) - 1) < 1e-6,
    'Warriors phase1 contract: fallback intents should remain legacy-open (1.0).',
  );
}

// Validate warrior phase-2 dispatch ordering and post-expedition progression updates.
function validateWarriorsExpeditionPhase2Contract() {
  const config = createRuinsSmokeConfig();
  config.ruins.expedition = {
    ...(config.ruins.expedition || {}),
    requiresArmory: false,
    minPopulation: 1,
    minIdleAdults: 1,
    cooldownTicks: 0,
    failureCooldownTicks: 0,
    partySizeMin: 1,
    partySizeMax: 1,
  };
  config.ruins.rooms = [
    {
      name: 'Warrior Phase2 Smoke',
      expeditionTicks: 1,
      partySize: 1,
      cost: {},
      hazardChance: 0,
      guardianChance: 0,
      guardianPower: 0,
      artifactChance: 0,
      artifactRolls: 0,
    },
  ];
  config.ruins.artifacts = {
    sets: {
      smoke_set: {
        label: 'Smoke Set',
      },
    },
    pool: {
      smoke_token: {
        name: 'Smoke Token',
        set: 'smoke_set',
        weight: 1,
      },
    },
  };
  config.underrealm = config.underrealm || {};
  config.underrealm.combat = {
    ...((config.underrealm && config.underrealm.combat) || {}),
    enabled: false,
    dwarf_champion: {
      ...(((config.underrealm && config.underrealm.combat) || {}).dwarf_champion || {}),
      enabled: false,
      requires_party_presence: false,
    },
  };
  config.warriors = {
    ...(config.warriors || {}),
    enabled: true,
    expeditions: {
      ...(((config.warriors || {}).expeditions) || {}),
      enabled: true,
      risk_depth_min: 1,
      condition_min_score: 0.3,
      fallback_condition_min_score: 0.2,
      strict_risk_condition_gate: true,
      champion_survivals_full_scale: 6,
      dispatch_weights: {
        rating: 1,
        valor: 0,
        hero_potential: 0,
        champion_survivals: 0,
        clan_class_fit: 0,
      },
      rest_ticks: {
        success: 3,
        failure: 6,
        retreat: 4,
      },
      progression: {
        rating_delta: {
          success: 0.05,
          failure: -0.05,
          retreat: -0.02,
        },
        valor_delta: {
          success: 0,
          failure: 0,
          retreat: 0,
        },
        fatigue_gain: {
          success: 0.1,
          failure: 0.2,
          retreat: 0.15,
        },
        stress_gain: {
          success: 0.03,
          failure: 0.08,
          retreat: 0.06,
        },
        morale_delta: {
          success: 0.02,
          failure: -0.05,
          retreat: -0.03,
        },
        risk_win_bonus: 0.02,
      },
    },
  };

  const { state, runtime } = createRuinsSmokeState(config, { warningMode: false });
  const adults = (Array.isArray(state.dwarves) ? state.dwarves : [])
    .filter((dwarf) => dwarf && dwarf.lifeStage === 'adult');
  assert(adults.length >= 3, 'Warriors phase2 contract: insufficient adult dwarves for dispatch test.');

  for (const dwarf of adults) {
    dwarf.state = dwarf.state && typeof dwarf.state === 'object'
      ? dwarf.state
      : {};
    dwarf.state.morale = 1;
    dwarf.state.stress = 0;
    dwarf.state.fatigue = 0;
    dwarf.warrior = dwarf.warrior && typeof dwarf.warrior === 'object'
      ? dwarf.warrior
      : {};
    dwarf.warrior.rating = 0.1;
    dwarf.warrior.valor = 0.1;
    dwarf.warrior.wins = 0;
    dwarf.warrior.losses = 0;
    dwarf.warrior.retreats = 0;
    dwarf.warrior.riskWins = 0;
    dwarf.warrior.expeditions = 0;
    dwarf.warrior.nextEligibleExpeditionTick = 0;
  }

  const top = adults[0];
  const runnerUp = adults[1];
  top.warrior.rating = 0.92;
  runnerUp.warrior.rating = 0.78;

  state.tick = 1;
  updateRuins(state, config, runtime, null);
  const firstExpedition = state.ruins && Array.isArray(state.ruins.expeditions)
    ? state.ruins.expeditions[0]
    : null;
  assert(firstExpedition, 'Warriors phase2 contract: first expedition did not start.');
  assert(
    Array.isArray(firstExpedition.dwarfIds) && firstExpedition.dwarfIds[0] === top.id,
    'Warriors phase2 contract: risky dispatch should prioritize top rated warrior.',
  );

  state.tick = 2;
  updateRuins(state, config, runtime, null);
  assert(
    Number(top.warrior.wins || 0) === 1
    && Number(top.warrior.expeditions || 0) === 1
    && Number(top.warrior.riskWins || 0) === 1,
    'Warriors phase2 contract: success progression counters were not updated.',
  );
  assert(
    Number(top.warrior.rating || 0) > 0.92,
    'Warriors phase2 contract: rating should increase after risky success.',
  );
  assert(
    Number(top.warrior.nextEligibleExpeditionTick || 0) >= 5,
    'Warriors phase2 contract: rest gate tick was not applied after expedition.',
  );

  state.tick = 3;
  updateRuins(state, config, runtime, null);
  const secondExpedition = state.ruins && Array.isArray(state.ruins.expeditions)
    ? state.ruins.expeditions[0]
    : null;
  assert(secondExpedition, 'Warriors phase2 contract: second expedition did not start.');
  assert(
    Array.isArray(secondExpedition.dwarfIds) && secondExpedition.dwarfIds[0] !== top.id,
    'Warriors phase2 contract: rest guardrail should avoid immediate redispatch of the resting top warrior.',
  );
}

// Validate warrior phase-3 seasonal tournament runtime and champion sync contract.
function validateWarriorsTournamentPhase3Contract() {
  const config = createWarriorsSmokeConfig({
    withWarriorsBlock: true,
    enabled: true,
  });
  config.seasons = {
    ...(config.seasons || {}),
    enabled: true,
    durationTicks: 2,
    order: ['spring', 'summer'],
    modifiers: {
      spring: {},
      summer: {},
    },
  };
  config.warriors = {
    ...(config.warriors || {}),
    enabled: true,
    tournaments: {
      ...(((config.warriors || {}).tournaments) || {}),
      enabled: true,
      cadence: 'season',
      interval_seasons: 1,
      min_participants: 2,
      max_participants: 2,
      sync_underrealm_champion: true,
      seed_weights: {
        rating: 1,
        valor: 0,
        hero_potential: 0,
        condition: 0,
        champion_survivals: 0,
      },
      duel_weights: {
        seed_score: 1,
        base_aptitude: 0,
        condition: 0,
      },
      scoring: {
        duel_win_points: 3,
        duel_loss_points: 1,
        bye_points: 1,
        champion_bonus_points: 2,
      },
      progression: {
        rating_win_delta: 0,
        rating_loss_delta: 0,
        champion_rating_bonus: 0,
        valor_win_delta: 0,
        valor_loss_delta: 0,
        champion_valor_bonus: 0,
      },
    },
    expeditions: {
      ...(((config.warriors || {}).expeditions) || {}),
      champion_survivals_full_scale: 6,
    },
  };

  const runtime = buildRuntime(config.display, {
    columns: Number(config.display.width || 90),
    rows: Number(config.display.height || 45),
  });
  const state = createInitialState(config, runtime);
  const combatChampion = state
    && state.underrealm
    && state.underrealm.combat
    && state.underrealm.combat.dwarfChampion
      ? state.underrealm.combat.dwarfChampion
      : null;
  assert(combatChampion, 'Warriors phase3 contract: missing underrealm dwarf champion runtime.');
  combatChampion.enabled = true;
  combatChampion.autoPromotion = {
    ...(combatChampion.autoPromotion || {}),
    enabled: false,
  };
  combatChampion.activeDwarfId = null;

  const adults = (Array.isArray(state.dwarves) ? state.dwarves : [])
    .filter((dwarf) => dwarf && dwarf.lifeStage === 'adult');
  assert(adults.length >= 3, 'Warriors phase3 contract: insufficient adult dwarves for tournament scenario.');
  const alpha = adults[0];
  const beta = adults[1];
  alpha.clanId = 'emberforge';
  beta.clanId = 'deepdelve';
  for (const dwarf of [alpha, beta]) {
    dwarf.state = dwarf.state && typeof dwarf.state === 'object'
      ? dwarf.state
      : {};
    dwarf.state.morale = 1;
    dwarf.state.stress = 0;
    dwarf.state.fatigue = 0;
    dwarf.warrior = dwarf.warrior && typeof dwarf.warrior === 'object'
      ? dwarf.warrior
      : {};
    dwarf.warrior.rating = 0.9;
    dwarf.warrior.valor = 0.5;
    dwarf.warrior.baseProfile = {
      strength: 0.7,
      dexterity: 0.7,
      vitality: 0.7,
    };
    dwarf.warrior.baseCombatAptitude = 0.7;
    dwarf.warrior.heroPotential = 0.7;
    dwarf.warrior.nextEligibleExpeditionTick = 0;
  }

  state.tick = 1;
  updateSeason(state, config);
  updateWarriors(state, config);
  const league = state.warriors && state.warriors.league ? state.warriors.league : null;
  const stats = state.warriors && state.warriors.stats ? state.warriors.stats : null;
  assert(league, 'Warriors phase3 contract: missing league runtime after season tournament tick.');
  assert(stats, 'Warriors phase3 contract: missing stats runtime after season tournament tick.');
  assert(Number(stats.tournaments || 0) === 1, 'Warriors phase3 contract: season boundary should run one tournament.');
  assert(
    String(league.championId || '') === String(alpha.id),
    'Warriors phase3 contract: deterministic tie-break should crown lower spawn-index champion.',
  );
  assert(
    Number(stats.tieBreaks || 0) >= 1,
    'Warriors phase3 contract: tie-break counter should increment when duel score ties.',
  );
  assert(
    league.clanScoreById
    && Number(league.clanScoreById.emberforge || 0) > 0
    && Number(league.clanScoreById.deepdelve || 0) > 0,
    'Warriors phase3 contract: clan leaderboard should include both participating clans.',
  );
  assert(
    String(combatChampion.activeDwarfId || '') === String(alpha.id),
    'Warriors phase3 contract: tournament champion should sync to underrealm champion runtime.',
  );

  state.tick = 2;
  updateSeason(state, config);
  updateWarriors(state, config);
  assert(
    Number(state.warriors.stats && state.warriors.stats.tournaments || 0) === 1,
    'Warriors phase3 contract: tournament must not rerun inside same season window.',
  );

  state.tick = 3;
  updateSeason(state, config);
  updateWarriors(state, config);
  assert(
    Number(state.warriors.stats && state.warriors.stats.tournaments || 0) === 2,
    'Warriors phase3 contract: next season boundary should run tournament again.',
  );
}

// Validate warrior phase-4 scars/titles/vows/legacy progression and cap guardrails.
function validateWarriorsProgressionPhase4Contract() {
  const config = createWarriorsSmokeConfig({
    withWarriorsBlock: true,
    enabled: true,
  });
  config.warriors = {
    ...(config.warriors || {}),
    enabled: true,
    tournaments: {
      ...(((config.warriors || {}).tournaments) || {}),
      enabled: true,
      cadence: 'season',
      interval_seasons: 1,
      min_participants: 2,
      max_participants: 2,
      sync_underrealm_champion: false,
      seed_weights: {
        rating: 1,
        valor: 0,
        hero_potential: 0,
        condition: 0,
        champion_survivals: 0,
      },
      duel_weights: {
        seed_score: 1,
        base_aptitude: 0,
        condition: 0,
      },
      progression: {
        rating_win_delta: 0,
        rating_loss_delta: 0,
        champion_rating_bonus: 0,
        valor_win_delta: 0,
        valor_loss_delta: 0,
        champion_valor_bonus: 0,
      },
    },
    expeditions: {
      ...(((config.warriors || {}).expeditions) || {}),
      enabled: true,
      risk_depth_min: 1,
      rest_ticks: {
        success: 0,
        failure: 0,
        retreat: 0,
      },
      progression: {
        ...((((config.warriors || {}).expeditions || {}).progression) || {}),
        rating_delta: {
          success: 0.02,
          failure: -0.05,
          retreat: -0.03,
        },
        valor_delta: {
          success: 0.01,
          failure: -0.02,
          retreat: -0.01,
        },
        fatigue_gain: {
          success: 0.08,
          failure: 0.1,
          retreat: 0.09,
        },
        stress_gain: {
          success: 0.03,
          failure: 0.07,
          retreat: 0.05,
        },
        morale_delta: {
          success: 0.01,
          failure: -0.03,
          retreat: -0.02,
        },
        risk_win_bonus: 0.02,
      },
    },
    marks: {
      enabled: true,
      scars: {
        enabled: true,
        max_count: 3,
        rules: [
          {
            id: 'scar_failure_mark',
            outcomes: ['failure'],
            losses_min: 1,
          },
        ],
      },
      titles: {
        enabled: true,
        max_count: 4,
        champion_id: 'title_league_champion',
        rules: [
          {
            id: 'title_vanguard',
            expeditions_min: 2,
            wins_min: 1,
            rating_min: 0,
            valor_min: 0,
          },
        ],
      },
    },
    vows: {
      enabled: true,
      allow_reassignment: false,
      rules: [
        {
          id: 'stone_oath',
          priority: 10,
          expeditions_min: 2,
          wins_min: 1,
          rating_min: 0,
          valor_min: 0,
          condition_min: 0,
        },
      ],
      catalog: {
        stone_oath: {
          dispatch_score_bonus: 0.05,
          dispatch_score_penalty: 0.01,
          tournament_seed_bonus: 0.02,
          tournament_duel_bonus: 0.02,
          rating_loss_multiplier: 1.6,
          fatigue_gain_multiplier: 1.2,
          stress_gain_multiplier: 1.15,
        },
      },
    },
    bonuses: {
      ...(((config.warriors || {}).bonuses) || {}),
      enabled: true,
      legacy_cap: 0.34,
      legacy: {
        enabled: true,
        points_cap: 2,
        diminishing_alpha: 1.1,
        personal_scale: 1,
        personal_cap: 0.25,
        personal_dispatch_scale: 0.5,
        personal_duel_scale: 0.5,
        company_scale: 2,
        company_cap: 0.34,
        company_roster_size: 2,
        company_dispatch_scale: 0.2,
        points: {
          expedition_success: 1.2,
          expedition_failure: 0.8,
          expedition_retreat: 0.5,
          risky_success_bonus: 0.6,
          tournament_duel_win: 0.5,
          tournament_duel_loss: 0.2,
          tournament_champion_bonus: 0.9,
        },
      },
    },
  };

  const runtime = buildRuntime(config.display, {
    columns: Number(config.display.width || 90),
    rows: Number(config.display.height || 45),
  });
  const state = createInitialState(config, runtime);
  const adults = (Array.isArray(state.dwarves) ? state.dwarves : [])
    .filter((dwarf) => dwarf && dwarf.lifeStage === 'adult');
  assert(adults.length >= 2, 'Warriors phase4 contract: insufficient adult dwarves for progression scenario.');
  const alpha = adults[0];
  const beta = adults[1];
  for (const dwarf of [alpha, beta]) {
    dwarf.state = dwarf.state && typeof dwarf.state === 'object'
      ? dwarf.state
      : {};
    dwarf.state.morale = 1;
    dwarf.state.stress = 0;
    dwarf.state.fatigue = 0;
    dwarf.warrior = dwarf.warrior && typeof dwarf.warrior === 'object'
      ? dwarf.warrior
      : {};
    dwarf.warrior.rating = 0.8;
    dwarf.warrior.valor = 0.6;
    dwarf.warrior.baseProfile = {
      strength: 0.7,
      dexterity: 0.7,
      vitality: 0.7,
    };
    dwarf.warrior.baseCombatAptitude = 0.7;
    dwarf.warrior.heroPotential = 0.7;
    dwarf.warrior.expeditions = 0;
    dwarf.warrior.wins = 0;
    dwarf.warrior.losses = 0;
    dwarf.warrior.retreats = 0;
    dwarf.warrior.riskWins = 0;
    dwarf.warrior.scars = [];
    dwarf.warrior.titles = [];
    dwarf.warrior.vow = null;
    dwarf.warrior.legacyPoints = 0;
    dwarf.warrior.nextEligibleExpeditionTick = 0;
  }
  alpha.warrior.rating = 0.92;
  beta.warrior.rating = 0.64;

  const expeditionTemplate = {
    dwarfIds: [alpha.id],
    readiness: {
      status: 'warning',
      depth: 4,
      riskyDispatch: true,
    },
  };
  state.tick = 1;
  applyWarriorExpeditionOutcome(state, config, expeditionTemplate, 'failure', {
    tick: state.tick,
    riskyDispatch: true,
  });
  assert(
    Array.isArray(alpha.warrior.scars) && alpha.warrior.scars.includes('scar_failure_mark'),
    'Warriors phase4 contract: failure scar rule was not applied.',
  );
  assert(
    Number(alpha.warrior.legacyPoints || 0) > 0,
    'Warriors phase4 contract: legacy points should increase on event-driven outcomes.',
  );

  state.tick = 2;
  applyWarriorExpeditionOutcome(state, config, expeditionTemplate, 'success', {
    tick: state.tick,
    riskyDispatch: true,
  });
  assert(
    Array.isArray(alpha.warrior.titles) && alpha.warrior.titles.includes('title_vanguard'),
    'Warriors phase4 contract: title rule was not assigned after threshold completion.',
  );
  assert(
    String(alpha.warrior.vow || '') === 'stone_oath',
    'Warriors phase4 contract: vow assignment rule did not trigger deterministically.',
  );
  assert(
    Number(alpha.warrior.legacyPoints || 0) <= 2 + 1e-9,
    'Warriors phase4 contract: legacy points exceeded configured cap.',
  );

  const ratingBeforeLoss = Number(alpha.warrior.rating || 0);
  state.tick = 3;
  applyWarriorExpeditionOutcome(state, config, expeditionTemplate, 'failure', {
    tick: state.tick,
    riskyDispatch: true,
  });
  const ratingAfterLoss = Number(alpha.warrior.rating || 0);
  const ratingDrop = Math.max(0, ratingBeforeLoss - ratingAfterLoss);
  assert(
    ratingDrop >= 0.07 - 1e-9,
    'Warriors phase4 contract: vow downside (rating loss multiplier) was not applied.',
  );

  state.tick = 10;
  state.season = {
    globalIndex: 5,
    index: 5,
    tickInSeason: 1,
    name: 'spring',
  };
  updateWarriors(state, config);
  assert(
    String(state.warriors && state.warriors.league && state.warriors.league.championId || '') === String(alpha.id),
    'Warriors phase4 contract: deterministic tournament champion mismatch for phase4 scenario.',
  );
  assert(
    Array.isArray(alpha.warrior.titles) && alpha.warrior.titles.includes('title_league_champion'),
    'Warriors phase4 contract: champion title was not assigned.',
  );
  assert(
    Number(state.warriors && state.warriors.company && state.warriors.company.legacyAura || 0)
      <= Number(config.warriors.bonuses.legacy.company_cap || 0) + 1e-9,
    'Warriors phase4 contract: company legacy aura exceeded configured cap.',
  );
  assert(
    Number(state.warriors && state.warriors.stats && state.warriors.stats.vowsAssigned || 0) >= 1,
    'Warriors phase4 contract: vow assignment stats counter was not updated.',
  );
}

// Validate warrior phase-5 telemetry/page wiring and top-5 naming format.
function validateWarriorsTelemetryPhase5Contract() {
  const config = createWarriorsSmokeConfig({
    withWarriorsBlock: true,
    enabled: true,
  });
  config.warriors = {
    ...(config.warriors || {}),
    enabled: true,
  };
  const runtime = buildRuntime(config.display, {
    columns: Number(config.display.width || 90),
    rows: Number(config.display.height || 45),
  });
  const state = createInitialState(config, runtime);
  const adults = (Array.isArray(state.dwarves) ? state.dwarves : [])
    .filter((dwarf) => dwarf && dwarf.lifeStage === 'adult');
  assert(adults.length >= 5, 'Warriors phase5 contract: insufficient adults for top-5 telemetry test.');

  const contenders = adults.slice(0, 5);
  contenders.forEach((dwarf, index) => {
    dwarf.clanId = index % 2 === 0 ? 'emberforge' : 'deepdelve';
    dwarf.state = dwarf.state && typeof dwarf.state === 'object' ? dwarf.state : {};
    dwarf.state.morale = 0.9;
    dwarf.state.stress = 0.1;
    dwarf.state.fatigue = 0.1;
    dwarf.warrior = dwarf.warrior && typeof dwarf.warrior === 'object' ? dwarf.warrior : {};
    dwarf.warrior.rating = 0.96 - index * 0.06;
    dwarf.warrior.valor = 0.9 - index * 0.05;
    dwarf.warrior.wins = 9 - index;
    dwarf.warrior.losses = index;
    dwarf.warrior.riskWins = 5 - index;
    dwarf.warrior.scars = ['scar_phase5', `scar_p5_${index}`];
    dwarf.warrior.titles = ['title_phase5'];
    dwarf.warrior.vow = index === 0 ? 'stone_oath' : null;
    dwarf.warrior.legacyPoints = 8 + index;
  });

  state.warriors = state.warriors && typeof state.warriors === 'object' ? state.warriors : {};
  state.warriors.enabled = true;
  state.warriors.league = {
    ...(state.warriors.league || {}),
    seasonId: 8,
    lastTournamentSeasonId: 8,
    lastTournamentSeasonName: 'autumn',
    lastTournamentLeagueName: 'Balgrim Stoneward Gauntlet',
    lastTournamentTick: 420,
    championId: contenders[0].id,
    clanScoreById: {
      emberforge: 33,
      deepdelve: 29,
    },
    ranking: contenders.map((dwarf, index) => ({
      rank: index + 1,
      dwarfId: dwarf.id,
      clanId: dwarf.clanId,
      seedRank: index + 1,
      seedScore: 0.9 - index * 0.05,
      points: 25 - index * 2,
      wins: Math.max(0, 7 - index),
      losses: index,
      duels: 8,
    })),
  };
  state.warriors.company = {
    ...(state.warriors.company || {}),
    rosterIds: contenders.map((dwarf) => dwarf.id),
    legacyAura: 0.18,
    hallOfFame: [
      {
        seasonId: 8,
        leagueName: 'Balgrim Stoneward Gauntlet',
        dwarfId: contenders[0].id,
      },
    ],
  };
  state.warriors.stats = {
    ...(state.warriors.stats || {}),
    tournaments: 3,
    tieBreaks: 2,
    upsets: 1,
    scarsAwarded: 4,
    titlesAwarded: 3,
    vowsAssigned: 1,
    legacyPointsAwarded: 14,
  };

  assert(
    state.ui && state.ui.warriorPanel && state.ui.warriorPanel.open === false,
    'Warriors phase5 contract: warrior panel UI state missing in initial state.',
  );
  assert(
    Number(getTelemetryPanelPageCount()) >= 4,
    'Warriors phase5 contract: telemetry page count should include Warrior League page.',
  );

  const sections = buildTelemetrySections(state, config, 96, {
    includeRuins: true,
    includeMyths: true,
  });
  const warriorSection = sections && sections.warriorLeague ? sections.warriorLeague : null;
  assert(warriorSection, 'Warriors phase5 contract: Warrior League telemetry section missing.');
  assert(
    Array.isArray(warriorSection.rows) && warriorSection.rows.length > 0,
    'Warriors phase5 contract: Warrior League telemetry rows are empty.',
  );
  assert(
    warriorSection.rows.some((row) => String(row).startsWith('Top 5 fighters:')),
    'Warriors phase5 contract: top-5 heading missing in Warrior League telemetry.',
  );
  const topRows = warriorSection.rows.filter((row) => String(row).startsWith('#'));
  assert(topRows.length === 5, 'Warriors phase5 contract: telemetry must expose top 5 fighters.');
  assert(
    warriorSection.rows.some((row) => String(row).includes('Marks (Scars/Titles/Vows):')),
    'Warriors phase5 contract: explicit Marks row missing.',
  );
  assert(
    warriorSection.rows.some((row) => String(row).includes(`<${contenders[0].id}>`)),
    'Warriors phase5 contract: fighter label should include <id> format.',
  );
}

// Validate warrior phase-6 AI observation channels and compact/legacy transport parity.
function validateWarriorsAiPhase6Contract(tmpDir) {
  const config = createWarriorsSmokeConfig({
    withWarriorsBlock: true,
    enabled: true,
  });
  config.warriors = {
    ...(config.warriors || {}),
    enabled: true,
  };
  const runtime = buildRuntime(config.display, {
    columns: Number(config.display.width || 90),
    rows: Number(config.display.height || 45),
  });
  const state = createInitialState(config, runtime);
  state.tick = 320;

  const adults = (Array.isArray(state.dwarves) ? state.dwarves : [])
    .filter((dwarf) => dwarf && dwarf.lifeStage === 'adult');
  assert(adults.length > 0, 'Warriors phase6 contract: missing adult dwarves for observation fixture.');
  const champion = adults[0];
  champion.state = champion.state && typeof champion.state === 'object' ? champion.state : {};
  champion.state.morale = 0.9;
  champion.state.stress = 0.1;
  champion.state.fatigue = 0.1;
  champion.warrior = champion.warrior && typeof champion.warrior === 'object' ? champion.warrior : {};
  champion.warrior.rating = 0.9;
  champion.warrior.valor = 0.82;
  champion.warrior.heroPotential = 0.86;
  champion.warrior.condition = {
    ...(champion.warrior.condition || {}),
    score: 0.88,
  };

  state.warriors = state.warriors && typeof state.warriors === 'object' ? state.warriors : {};
  state.warriors.enabled = true;
  state.warriors.company = {
    ...(state.warriors.company || {}),
    legacyAura: 0.34,
  };
  state.warriors.league = {
    ...(state.warriors.league || {}),
    championId: champion.id,
    lastTournamentTick: 280,
  };

  const aiObs = buildAiObservation(state, config);
  const warriorsObs = aiObs && aiObs.warriors && typeof aiObs.warriors === 'object'
    ? aiObs.warriors
    : null;
  assert(warriorsObs, 'Warriors phase6 contract: AI observation missing warriors block.');
  const warriorFeatureNames = [
    'warriorEnabled',
    'warriorRosterCoverage',
    'warriorEliteScore',
    'warriorLegacyAura',
    'warriorChampionMomentum',
    'warriorTournamentRecency',
  ];
  const values = buildAiFeatures(aiObs, 'food', config, warriorFeatureNames);
  assert(
    Array.isArray(values) && values.length === warriorFeatureNames.length,
    'Warriors phase6 contract: warrior feature extraction returned unexpected length.',
  );
  const expected = [
    Number(warriorsObs.enabled || 0),
    Number(warriorsObs.rosterCoverage || 0),
    Number(warriorsObs.eliteScore || 0),
    Number(warriorsObs.legacyAura || 0),
    Number(warriorsObs.championMomentum || 0),
    Number(warriorsObs.tournamentRecency || 0),
  ];
  for (let index = 0; index < expected.length; index += 1) {
    assert(
      Math.abs(Number(values[index] || 0) - expected[index]) <= 1e-9,
      `Warriors phase6 contract: legacy feature mismatch at index ${index}.`,
    );
  }

  // Compact transport parity check against legacy observation values.
  const compactConfigPath = path.join(tmpDir, 'warriors_phase6_transport_config.json');
  fs.writeFileSync(compactConfigPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  const legacyResponses = runAiServerSession(compactConfigPath, [
    { cmd: 'reset', seed: 11, training: true, transport: { mode: 'legacy' } },
    { cmd: 'close' },
  ]);
  const legacyObs = legacyResponses[0] && legacyResponses[0].obs;
  assert(legacyObs && legacyObs.warriors, 'Warriors phase6 contract: legacy reset response missing warriors observation.');

  const compactResponses = runAiServerSession(compactConfigPath, [
    {
      cmd: 'reset',
      seed: 11,
      training: true,
      transport: {
        mode: 'compact',
        resources: ['food'],
        featureNames: warriorFeatureNames,
      },
    },
    { cmd: 'close' },
  ]);
  const compactVector = compactResponses[0] && compactResponses[0].obsVector;
  assert(Array.isArray(compactVector), 'Warriors phase6 contract: compact reset response missing obsVector.');
  assert(
    compactVector.length === warriorFeatureNames.length,
    'Warriors phase6 contract: compact obsVector length mismatch for warrior features.',
  );
  const legacyExpected = [
    Number(legacyObs.warriors.enabled || 0),
    Number(legacyObs.warriors.rosterCoverage || 0),
    Number(legacyObs.warriors.eliteScore || 0),
    Number(legacyObs.warriors.legacyAura || 0),
    Number(legacyObs.warriors.championMomentum || 0),
    Number(legacyObs.warriors.tournamentRecency || 0),
  ];
  for (let index = 0; index < legacyExpected.length; index += 1) {
    assert(
      Math.abs(Number(compactVector[index] || 0) - legacyExpected[index]) <= 1e-9,
      `Warriors phase6 contract: compact/legacy mismatch at index ${index}.`,
    );
  }
}

// Execute the full contract suite in one deterministic temporary workspace.
function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodedwarves_test_contracts_'));
  try {
    assert(fs.existsSync(POLICY_BEST), `Policy contract: missing ${POLICY_BEST}`);
    const policy = readJson(POLICY_BEST);
    validateObservationContract(policy);

    // Deliberate mismatch must fail in test mode.
    const malformed = JSON.parse(JSON.stringify(policy));
    if (
      malformed
      && malformed.normalization
      && malformed.normalization.observation
      && Array.isArray(malformed.normalization.observation.mean)
      && malformed.normalization.observation.mean.length > 0
    ) {
      malformed.normalization.observation.mean = malformed.normalization.observation.mean.slice(0, -1);
    } else {
      throw new Error('Policy contract: cannot build malformed observation test case.');
    }
    let malformedFailed = false;
    try {
      validateObservationContract(malformed);
    } catch (error) {
      malformedFailed = true;
    }
    assert(malformedFailed, 'Policy contract: malformed observation shape did not fail as expected.');

    validateExternalCampsGovernorContract();
    validateContractGovernorContract();
    validateRuinsGovernorContract();
    validateUnderrealmGovernorContract();
    validateWarriorsDisabledNeutralContract();
    validateWarriorsBootstrapContract();
    validateWarriorsGovernorPhase1Contract();
    validateWarriorsExpeditionPhase2Contract();
    validateWarriorsTournamentPhase3Contract();
    validateWarriorsProgressionPhase4Contract();
    validateWarriorsTelemetryPhase5Contract();
    validateWarriorsAiPhase6Contract(tmpDir);
    validateRegressionReportSchema(tmpDir);
    validatePromoteReportSchema(tmpDir);
    console.log('[test:contracts] PASS policy_shape external_camps_governor contracts_governor ruins_governor underrealm_governor warriors_disabled warriors_bootstrap warriors_phase1 warriors_phase2 warriors_phase3 warriors_phase4 warriors_phase5 warriors_phase6 regression_schema promote_schema');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
