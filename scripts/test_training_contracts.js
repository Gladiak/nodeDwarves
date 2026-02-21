#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PYTHON = path.join(ROOT, '.venv', 'bin', 'python');
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

// Validate regression CLI output schema using a tiny deterministic smoke budget.
function validateRegressionReportSchema(tmpDir) {
  const reportJsonPath = path.join(tmpDir, 'regression_contract.json');
  const reportMdPath = path.join(tmpDir, 'regression_contract.md');
  runCommand('node', [
    REGRESSION,
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
  runCommand(PYTHON, [
    PROMOTE,
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

    validateRegressionReportSchema(tmpDir);
    validatePromoteReportSchema(tmpDir);
    console.log('[test:contracts] PASS policy_shape regression_schema promote_schema');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
