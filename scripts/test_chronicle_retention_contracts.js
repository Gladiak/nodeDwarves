#!/usr/bin/env node
'use strict';

// Chronicle retention study contracts (scripts/review_chronicle_retention.js): retained claims, source
// integrity, chapter/archive bounds, deterministic replay and no gameplay RNG use.
const assert = require('assert/strict');
const { captureInput, reviewRetention } = require('./review_chronicle_retention');
const { createChronicleState, recordChronicleEvent } = require('../src/simulation/chronicle');

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

validateRetentionStudy();
process.stdout.write('Chronicle retention contracts: PASS retained_claims replay source_integrity bounds RNG purity\n');
