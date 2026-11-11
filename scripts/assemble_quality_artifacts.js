#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GROUPS = ['canonical', 'regression', 'risk', 'horizon', 'horizon_weekly'];
const RULES = {
  canonical: /^canonical_master_latest\.(json|md)$/,
  regression: /^regression_report_.*\.(json|md|txt)$/,
  risk: /^(ci_validate_extended\.log|extended_gate_runtime_optimized_latest\.(json|md))$/,
  horizon: /^regression_horizon_latest\.(json|md)$/,
  horizon_weekly: /^(regression_horizon_weekly_latest\.(json|md)|ci_validate_horizon_weekly\.log)$/,
};

// Fingerprint content rather than filenames so overwritten reports and stale tracked files differ.
function fingerprint(file) {
  const bytes = fs.readFileSync(file);
  return { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

// Capture the pre-validation file set without changing any retained local evidence.
function snapshotDebug(root) {
  const debug = path.join(root, 'debug');
  fs.mkdirSync(debug, { recursive: true });
  const files = {};
  for (const entry of fs.readdirSync(debug, { withFileTypes: true })) {
    if (entry.isFile() && GROUPS.some((group) => RULES[group].test(entry.name))) {
      files[entry.name] = fingerprint(path.join(debug, entry.name));
    }
  }
  const snapshot = { schemaVersion: 1, files };
  fs.writeFileSync(path.join(debug, 'ci_pre_debug_files.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
  return snapshot;
}

// Package only new or changed evidence, and make skipped/missing phases explicit in every bundle.
function assembleArtifacts(root, context = {}) {
  const debug = path.join(root, 'debug');
  const snapshot = JSON.parse(fs.readFileSync(path.join(debug, 'ci_pre_debug_files.json'), 'utf8'));
  if (snapshot.schemaVersion !== 1 || !snapshot.files) throw new Error('Invalid pre-validation snapshot');
  const output = path.join(debug, 'ci_artifacts');
  const manifest = { schemaVersion: 1, repository: context.repository || null,
    runId: context.runId || null, runAttempt: context.runAttempt || null, commit: context.commit || null,
    outcomes: { extended: context.extended || 'unknown', weekly: context.weekly || 'unknown' },
    groups: {}, errors: [] };
  const names = fs.readdirSync(debug, { withFileTypes: true }).filter((entry) => entry.isFile())
    .map((entry) => entry.name).sort();
  for (const group of GROUPS) {
    const directory = path.join(output, group);
    fs.rmSync(directory, { recursive: true, force: true });
    fs.mkdirSync(directory, { recursive: true });
    const files = []; const stale = [];
    for (const name of names.filter((name) => RULES[group].test(name))) {
      const source = path.join(debug, name); const digest = fingerprint(source);
      if (snapshot.files[name]?.sha256 === digest.sha256) { stale.push(name); continue; }
      fs.copyFileSync(source, path.join(directory, name));
      files.push({ name, ...digest });
    }
    if (group === 'risk') {
      const log = files.find((file) => file.name === 'ci_validate_extended.log');
      if (log) {
        const text = fs.readFileSync(path.join(directory, log.name), 'utf8');
        const start = text.indexOf('[oq64] step=benchmark start');
        const end = start >= 0 ? text.indexOf('[oq64] step=benchmark done', start) : -1;
        const section = start >= 0 && end >= 0 ? text.slice(start, text.indexOf('\n', end) + 1 || text.length) : text;
        const file = path.join(directory, 'risk_latest.log');
        fs.writeFileSync(file, section);
        files.push({ name: 'risk_latest.log', ...fingerprint(file), derivedFrom: log.name,
          sourceSha256: log.sha256, scope: start >= 0 && end >= 0 ? 'benchmark' : 'extended_log' });
      }
    }
    const gate = group === 'horizon_weekly' ? manifest.outcomes.weekly : manifest.outcomes.extended;
    const reportFiles = files.filter((file) => file.name.endsWith('.json'));
    const required = gate === 'success' && group !== 'risk';
    if (required && reportFiles.length === 0) manifest.errors.push(`${group}: successful gate produced no fresh JSON report`);
    if (group === 'risk' && !files.some((file) => file.name === 'ci_validate_extended.log')) {
      manifest.errors.push('risk: missing fresh extended validation log');
    }
    const status = { schemaVersion: 1, group, repository: manifest.repository, runId: manifest.runId,
      runAttempt: manifest.runAttempt, commit: manifest.commit, gateOutcome: gate,
      reportStatus: reportFiles.length ? 'produced' : 'not_produced',
      interpretation: reportFiles.length ? 'Fresh content from this validation run'
        : 'No fresh report; the phase may have been skipped or failed before writing evidence',
      files, excludedStaleFiles: stale };
    manifest.groups[group] = status;
    fs.writeFileSync(path.join(directory, '_status.json'), `${JSON.stringify(status, null, 2)}\n`);
  }
  manifest.passed = manifest.errors.length === 0;
  fs.writeFileSync(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

// Keep CLI defaults identical to the workflow; no simulation or model settings are overridden.
function main(argv) {
  if (argv.some((arg) => arg !== '--snapshot')) throw new Error('Usage: assemble_quality_artifacts.js [--snapshot]');
  const root = path.resolve(__dirname, '..');
  if (argv.includes('--snapshot')) {
    const snapshot = snapshotDebug(root);
    process.stdout.write(`CI evidence snapshot: ${Object.keys(snapshot.files).length} files\n`);
    return;
  }
  const report = assembleArtifacts(root, { repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    commit: process.env.GITHUB_SHA, extended: process.env.EXTENDED_OUTCOME, weekly: process.env.WEEKLY_OUTCOME });
  process.stdout.write(`CI artifacts: ${report.passed ? 'PASS' : 'FAIL'}\n`);
  for (const error of report.errors) process.stderr.write(`${error}\n`);
  if (!report.passed) process.exitCode = 1;
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
module.exports = { snapshotDebug, assembleArtifacts };
