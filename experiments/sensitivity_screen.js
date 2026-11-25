#!/usr/bin/env node
'use strict';
/*
One-at-a-time sensitivity screen of the core tuning keys (STRATEGY.md R6).

For every key in scripts/audit_config.js CORE_KEYS (with --keys all, also FROZEN_KEYS), plays the same games with the key at
(1 - delta) and (1 + delta) of its current value via challenge_probe.js --set, and reports the paired
effect of the change on final population, avoidable deaths and progress (Underrealm depth x20 +
landmark stages x5). A key is "sensitive" when any effect has |z| >= 2. Resumable: finished keys are
skipped, so the screen can be stopped and restarted.

Usage:
  node experiments/sensitivity_screen.js --config <session>/configs/config_endgame.json --out <dir>
    [--delta 0.25] [--episodes 24] [--ticks 8000] [--workers 10] [--players default] [--keys core|all] [--report-only]
*/
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { CORE_KEYS, FROZEN_KEYS } = require('../scripts/audit_config');

const ROOT = path.resolve(__dirname, '..');
const PROBE = path.join(__dirname, 'challenge_probe.js');

function parseArgs(argv) {
  const options = { delta: 0.25, episodes: 24, ticks: 8000, workers: 10, players: 'default', keys: 'core', reportOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (key === 'reportOnly') { options.reportOnly = true; continue; }
    options[key] = argv[i + 1];
    i += 1;
  }
  for (const key of ['delta', 'episodes', 'ticks', 'workers']) options[key] = Number(options[key]);
  if (!options.config || !options.out) throw new Error('--config and --out are required');
  return options;
}

function readPath(config, key) {
  return key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), config);
}

// Run one probe variant unless its output already exists.
function runVariant(options, name, sets) {
  const out = path.join(options.out, `${name}.json`);
  if (fs.existsSync(out)) return out;
  const args = [PROBE, '--plan', 'eval', '--config', options.config, '--players', options.players,
    '--episodes', String(options.episodes), '--ticks', String(options.ticks), '--workers', String(options.workers),
    '--out', `${out}.partial`];
  for (const entry of sets) args.push('--set', entry);
  const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (result.status !== 0) throw new Error(`${name} failed: ${result.stderr.slice(-400)}`);
  fs.renameSync(`${out}.partial`, out);
  return out;
}

function summaries(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).episodes.map((episode) => episode.summary);
}

function paired(low, high, metric) {
  const diffs = high.map((entry, index) => metric(entry) - metric(low[index]));
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const variance = diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, diffs.length - 1);
  const se = Math.sqrt(variance / diffs.length);
  return { delta: mean, z: se > 0 ? mean / se : 0 };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(options.out, { recursive: true });
  const config = JSON.parse(fs.readFileSync(path.resolve(ROOT, options.config), 'utf8'));
  const metrics = {
    pop: (s) => s.final_pop,
    avoidable: (s) => s.avoidable_deaths,
    progress: (s) => (s.progress ? s.progress.maxDepth * 20 + s.progress.landmarkStages * 5 : 0),
  };
  const rows = [];
  const keys = options.keys === 'all' ? [...CORE_KEYS, ...FROZEN_KEYS] : CORE_KEYS;
  for (const key of keys) {
    const value = readPath(config, key);
    if (typeof value !== 'number') {
      rows.push({ key, skipped: 'not numeric in this config' });
      continue;
    }
    const lowValue = value * (1 - options.delta);
    const highValue = value * (1 + options.delta);
    const safe = key.replace(/[^A-Za-z0-9]+/g, '_');
    let lowFile = path.join(options.out, `${safe}_low.json`);
    let highFile = path.join(options.out, `${safe}_high.json`);
    if (!options.reportOnly) {
      lowFile = runVariant(options, `${safe}_low`, [`${key}=${lowValue}`]);
      highFile = runVariant(options, `${safe}_high`, [`${key}=${highValue}`]);
      process.stdout.write(`[screen] ${key} done\n`);
    }
    if (!fs.existsSync(lowFile) || !fs.existsSync(highFile)) {
      rows.push({ key, skipped: 'not run' });
      continue;
    }
    const low = summaries(lowFile);
    const high = summaries(highFile);
    const effects = Object.fromEntries(Object.entries(metrics).map(([name, fn]) => [name, paired(low, high, fn)]));
    const sensitive = Object.values(effects).some((effect) => Math.abs(effect.z) >= 2);
    rows.push({ key, value, lowValue, highValue, effects, sensitive });
  }
  fs.writeFileSync(path.join(options.out, 'screen_report.json'), `${JSON.stringify({ options, rows }, null, 1)}\n`);
  process.stdout.write('key                                         value      dPop      z   dAvoid      z   dProg      z  sensitive\n');
  for (const row of rows) {
    if (row.skipped) { process.stdout.write(`${row.key.padEnd(42)} skipped: ${row.skipped}\n`); continue; }
    const e = row.effects;
    process.stdout.write(`${row.key.padEnd(42)} ${String(row.value).padStart(8)} ${e.pop.delta.toFixed(1).padStart(8)} ${e.pop.z.toFixed(2).padStart(6)} `
      + `${e.avoidable.delta.toFixed(1).padStart(8)} ${e.avoidable.z.toFixed(2).padStart(6)} ${e.progress.delta.toFixed(1).padStart(7)} `
      + `${e.progress.z.toFixed(2).padStart(6)}  ${row.sensitive ? 'yes' : 'no'}\n`);
  }
}

main();
