#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CHAPTERS, verifyChronicleRecord, buildCurrentChronicleSnapshot,
  createChronicleState, recordChronicleEvent } = require('../src/simulation/chronicle');
const { renderChronicleMarkdown } = require('../src/chronicle_export');
const clone = (value) => JSON.parse(JSON.stringify(value));
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

// Match the runtime Chronicle limit normalization, including explicit zero and missing settings.
function boundedSetting(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.floor(number))) : fallback;
}

// Retain only bounded narrative inputs, allowing the study to replay without a full world save.
function captureInput(snapshot) {
  const state = snapshot.state; const config = snapshot.config;
  if (!state?.chronicle?.current || !config?.chronicle) throw new Error('Snapshot needs Chronicle state and configuration');
  return clone({ tick: state.tick, population: state.dwarves?.length || 0,
    cycleStats: state.cycleStats, chronicle: state.chronicle,
    sagas: { order: state.story?.sagas?.order || [], byId: Object.fromEntries(
      (state.story?.sagas?.order || []).map((id) => [id, {
        id, status: state.story.sagas.byId[id].status, family: state.story.sagas.byId[id].family,
      }])) }, config: { chronicle: config.chronicle } });
}

// Measure source coverage and chapter density without scoring, evicting, or changing gameplay.
function reviewRetention(input) {
  const before = JSON.stringify(input); const state = clone(input);
  const record = state.chronicle.current;
  const verification = verifyChronicleRecord(record);
  const records = [record, ...(state.chronicle.archive || [])];
  const settings = state.config.chronicle;
  const maxClaims = boundedSetting(settings.max_claims_per_chapter, 1, 64, 12);
  const maxEvidence = boundedSetting(settings.max_evidence_per_cycle, 7, 512, 128);
  const maxArchive = boundedSetting(settings.max_archived_cycles, 1, 16, 4);
  const errors = verification.errors.slice();
  const byId = new Map((record.evidence || []).map((entry) => [entry.eventId, entry]));
  const claims = (record.chapters || []).flatMap((chapter) => chapter.claims || []);
  if ((state.chronicle.archive || []).length > maxArchive) errors.push('Archive exceeds configured bound');
  for (const entry of records) {
    if (!verifyChronicleRecord(entry).valid) errors.push('Archived source integrity failed');
    if (entry.chapters.length !== CHAPTERS.length || entry.evidence.length > maxEvidence
      || entry.chapters.some((chapter) => chapter.claims.length > maxClaims)) errors.push('Record exceeds configured bounds');
  }
  let attached = 0; let live = 0; let unknown = 0;
  for (const claim of claims) {
    const sources = (claim.sourceEventIds || []).map((id) => byId.get(id)).filter(Boolean);
    const ids = [...new Set(sources.map((entry) => entry.sagaId).filter(Boolean))];
    if (ids.length) {
      attached += 1;
      if (ids.every((id) => state.sagas.byId[id])) live += 1;
      else unknown += 1;
    }
  }
  // Replay retained facts only to test the current switch; this is not lost-history reconstruction.
  const replay = (enabled) => {
    const config = clone(state.config);
    config.chronicle.saga_quality = { use_for_retention: enabled };
    const replayState = { tick: state.tick, cycleStats: state.cycleStats,
      chronicle: createChronicleState(record.cycle) };
    for (const claim of claims.slice().sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id))) {
      if ((claim.sourceEventIds || []).length !== 1) continue;
      const source = byId.get(claim.sourceEventIds[0]);
      if (!source) continue;
      recordChronicleEvent(replayState, config, { ...source, id: source.eventId, message: claim.text });
    }
    return hash(JSON.stringify(buildCurrentChronicleSnapshot(replayState)));
  };
  const disabledHash = replay(false); const enabledHash = replay(true);
  const snapshot = buildCurrentChronicleSnapshot(state);
  const json = `${JSON.stringify({ schemaVersion: 1, chronicle: snapshot }, null, 2)}\n`;
  const exportHash = hash(json);
  const accepted = Number(state.chronicle.stats?.acceptedClaims || 0);
  return { schemaVersion: 1, passed: errors.length === 0 && before === JSON.stringify(input),
    decision: 'keep_disabled', tick: state.tick, population: state.population,
    scope: 'Read-only study of retained accepted facts; no reconstruction of evicted history or new simulation',
    metrics: { retainedClaims: claims.length, acceptedClaims: accepted,
      retainedShare: accepted ? claims.length / accepted : null,
      chapterCoverage: record.chapters.filter((chapter) => chapter.claims.length).length,
      chapterCount: CHAPTERS.length, sagaAttachedClaims: attached, claimsWithLiveSagaStatus: live,
      claimsWithUnavailableSagaStatus: unknown, claimsWithoutSaga: claims.length - attached,
      liveStatusCoverage: attached ? live / attached : null,
      unresolvedClaims: verification.errors.length, recordBytes: Buffer.byteLength(JSON.stringify(record)),
      chapters: record.chapters.map((chapter) => ({ id: chapter.id, claims: chapter.claims.length,
        priorityClaims: chapter.claims.filter((claim) => ['critical', 'legendary'].includes(claim.importance)).length })) },
    bounds: { maxClaimsPerChapter: maxClaims, maxEvidencePerCycle: maxEvidence, maxArchivedCycles: maxArchive },
    currentFlagReplay: { disabledHash, enabledHash, hasRetentionEffect: disabledHash !== enabledHash,
      limitation: 'Only already-retained single-source facts; the current flag has no ranking consumer' },
    integrity: { valid: errors.length === 0, errors, inputUnchanged: before === JSON.stringify(input),
      jsonExportHash: exportHash, markdownExportHash: hash(renderChronicleMarkdown(snapshot, exportHash)) },
    reasons: ['Retained claims outlive entries in the bounded live saga registry; missing status must not be treated as poor quality',
      'No validated alternative ranking or complete evicted-event history is available; preserving source-backed chapter budgets is the accepted outcome',
      'The current saga-quality switch is diagnostic-only; toggling it is not an implemented retention policy'],
    input };
}

// Review a world snapshot or replay a retained report's compact input with identical metrics/hashes.
function main(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!['--snapshot-json', '--replay-json', '--report-json'].includes(argv[index]) || !argv[index + 1]) {
      throw new Error('Usage: review_chronicle_retention.js (--snapshot-json FILE | --replay-json REPORT) [--report-json FILE]');
    }
    options[argv[index]] = argv[index + 1];
  }
  if (Boolean(options['--snapshot-json']) === Boolean(options['--replay-json'])) throw new Error('Choose exactly one input');
  const inputPath = path.resolve(options['--snapshot-json'] || options['--replay-json']);
  const contents = fs.readFileSync(inputPath);
  const value = JSON.parse(contents);
  const input = options['--snapshot-json'] ? captureInput(value) : value.input || value.retentionStudy?.input;
  if (!input) throw new Error('Replay report has no retained study input');
  const report = reviewRetention(input);
  report.provenance = { sourceSha256: hash(contents), inputHash: hash(JSON.stringify(input)),
    implementationSha256: hash(fs.readFileSync(__filename)) };
  if (options['--report-json']) {
    fs.writeFileSync(path.resolve(options['--report-json']), `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`Chronicle retention review: ${report.passed ? 'PASS' : 'FAIL'}; ${report.decision}; ${report.metrics.retainedClaims} claims; ${report.metrics.claimsWithUnavailableSagaStatus} without live saga status\n`);
  if (!report.passed) process.exitCode = 1;
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
module.exports = { captureInput, reviewRetention };
