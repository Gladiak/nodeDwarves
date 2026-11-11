#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { snapshotDebug, assembleArtifacts } = require('./assemble_quality_artifacts');
const { captureInput, reviewRetention } = require('./review_chronicle_retention');
const { createChronicleState, recordChronicleEvent } = require('../src/simulation/chronicle');

// Model the observed failed CI run: current reports coexist with an old tracked Horizon report.
function validateArtifactFreshness() {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/quality_gates.yml'), 'utf8');
  assert(workflow.includes('node scripts/assemble_quality_artifacts.js --snapshot'));
  assert(workflow.includes('node scripts/assemble_quality_artifacts.js\n'));
  assert(workflow.includes('steps.assemble_artifacts.outcome'));
  for (const group of ['canonical', 'regression', 'risk', 'horizon', 'horizon_weekly']) {
    assert(workflow.includes(`name: ${group}\n`), `missing workflow bundle ${group}`);
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodedwarves_ci_contract_'));
  const debug = path.join(root, 'debug'); fs.mkdirSync(debug);
  const put = (name, value) => fs.writeFileSync(path.join(debug, name), value);
  const context = { repository: 'fixture/repo', runId: '42', runAttempt: '1', commit: 'fixture',
    extended: 'failure', weekly: 'success' };
  try {
    put('regression_horizon_latest.json', '{"generatedAt":"old"}');
    put('canonical_master_latest.json', '{"generatedAt":"old"}');
    snapshotDebug(root);
    put('canonical_master_latest.json', '{"generatedAt":"current"}');
    put('regression_report_42.json', '{"allOk":false}');
    put('regression_horizon_weekly_latest.json', '{"allOk":true}');
    put('ci_validate_extended.log', '[oq64] step=regression done status=FAIL\n');
    put('ci_validate_horizon_weekly.log', 'weekly PASS\n');
    const report = assembleArtifacts(root, context);
    assert(report.passed);
    assert.equal(report.groups.horizon.reportStatus, 'not_produced');
    assert.deepEqual(report.groups.horizon.excludedStaleFiles, ['regression_horizon_latest.json']);
    assert(!fs.existsSync(path.join(debug, 'ci_artifacts/horizon/regression_horizon_latest.json')));
    assert.equal(report.groups.horizon.gateOutcome, 'failure');
    assert.equal(report.groups.canonical.reportStatus, 'produced', 'overwritten filename must be captured');
    assert.equal(report.groups.horizon_weekly.reportStatus, 'produced');
    assert.equal(report.groups.regression.files[0].name, 'regression_report_42.json');
    assert.equal(report.groups.risk.files.find((file) => file.name === 'risk_latest.log').scope, 'extended_log');
    assert.deepEqual(assembleArtifacts(root, context), report, 'packaging must replay deterministically');
    assert(!assembleArtifacts(root, { ...context, extended: 'success' }).passed,
      'a successful extended gate cannot use a stale Horizon report');
    put('regression_horizon_latest.json', '{"generatedAt":"current","allOk":true}');
    const complete = assembleArtifacts(root, { ...context, extended: 'success' });
    assert(complete.passed);
    for (const group of Object.values(complete.groups)) {
      assert(fs.existsSync(path.join(debug, 'ci_artifacts', group.group, '_status.json')));
      for (const file of group.files) {
        const bytes = fs.readFileSync(path.join(debug, 'ci_artifacts', group.group, file.name));
        assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), file.sha256);
      }
    }
    put('ci_validate_extended.log', '[oq64] step=benchmark start\nseed 101 complete\n'
      + '[oq64] step=benchmark done status=PASS\n[oq64] step=regression start\n');
    const section = assembleArtifacts(root, { ...context, extended: 'success' });
    assert(section.passed);
    assert.equal(section.groups.risk.files.find((file) => file.name === 'risk_latest.log').scope, 'benchmark');
    assert(!fs.readFileSync(path.join(debug, 'ci_artifacts/risk/risk_latest.log'), 'utf8').includes('regression'));
    snapshotDebug(root);
    const stale = assembleArtifacts(root, { ...context, extended: 'success' });
    assert(!stale.passed && stale.errors.some((error) => error.includes('risk')));
    assert.equal(fs.readFileSync(path.join(debug, 'regression_horizon_latest.json'), 'utf8'),
      '{"generatedAt":"current","allOk":true}', 'assembly must not delete the source evidence');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

// Keep claims whose live sagas were evicted, while rejecting broken sources and capacity overflow.
function validateRetentionStudy() {
  const config = { chronicle: { max_claims_per_chapter: 2, max_evidence_per_cycle: 7,
    max_archived_cycles: 1, saga_quality: { use_for_retention: false } } };
  const state = { tick: 10, cycleStats: { count: 0 }, dwarves: [],
    chronicle: createChronicleState(0), story: { sagas: { order: [], byId: {} } } };
  recordChronicleEvent(state, config, { id: 'fact:1', tick: 1, cycle: 0, type: 'world.observed',
    category: 'world', importance: 'critical', message: 'One witnessed fact.', actors: [],
    location: { scope: 'world' }, sagaId: 'evicted_saga' });
  const input = captureInput({ state, config });
  const before = JSON.stringify(input);
  const originalRandom = Math.random;
  Math.random = () => { throw new Error('Read-only closure tools consumed gameplay RNG'); };
  try {
    const report = reviewRetention(input);
    assert(report.passed);
    assert.equal(report.decision, 'keep_disabled');
    assert.equal(report.metrics.retainedClaims, 1);
    assert.equal(report.metrics.claimsWithUnavailableSagaStatus, 1);
    assert.equal(report.metrics.unresolvedClaims, 0);
    assert(!report.currentFlagReplay.hasRetentionEffect);
    assert.equal(report.currentFlagReplay.disabledHash, report.currentFlagReplay.enabledHash);
    assert.deepEqual(reviewRetention(JSON.parse(JSON.stringify(input))), report);
    assert.equal(JSON.stringify(input), before);
    const corrupt = JSON.parse(before); corrupt.chronicle.current.evidence = [];
    assert(!reviewRetention(corrupt).passed, 'missing sources must fail the study');
    const oversized = JSON.parse(before);
    const chapter = oversized.chronicle.current.chapters.find((entry) => entry.claims.length);
    chapter.claims.push(...[1, 2].map((index) => ({ ...chapter.claims[0], id: `extra:${index}` })));
    assert(!reviewRetention(oversized).passed, 'study must enforce chapter bounds');
    const oldCycles = JSON.parse(before);
    oldCycles.chronicle.archive = [oldCycles.chronicle.current, oldCycles.chronicle.current];
    assert(!reviewRetention(oldCycles).passed, 'study must enforce archive bounds');
    const zeroLimits = JSON.parse(before);
    Object.assign(zeroLimits.config.chronicle, { max_claims_per_chapter: 0,
      max_evidence_per_cycle: 0, max_archived_cycles: 0 });
    assert.deepEqual(reviewRetention(zeroLimits).bounds,
      { maxClaimsPerChapter: 1, maxEvidencePerCycle: 7, maxArchivedCycles: 1 });
  } finally { Math.random = originalRandom; }
}

validateArtifactFreshness();
validateRetentionStudy();
process.stdout.write('Operational closure contracts: PASS freshness overwritten_reports stale_exclusion missing_phases digests replay source_integrity bounds RNG purity\n');
