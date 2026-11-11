#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { moveWithDetour } = require('../src/simulation/movement');
const ROOT = path.resolve(__dirname, '..');

// Read one report variant, keeping the canonical cached baseline as the default control.
function loadVariant(file, label, last) {
  const report = JSON.parse(fs.readFileSync(path.resolve(ROOT, file), 'utf8'));
  const variant = label ? report.variants.find((entry) => entry.label === label)
    : report.variants[last ? report.variants.length - 1 : 0];
  if (!variant) throw new Error(`Missing variant ${label} in ${file}`);
  return { meta: report.meta, variant };
}

// Enforce the original workbook budgets, including the five-percent critical gathering bound.
function validateRoadReports(baseline, candidate, enforceTiming = false, requireRoadActivity = true) {
  if (!requireRoadActivity && Number(candidate.meta.ticks) > 4000) {
    throw new Error('Startup-only validation is limited to 4000 ticks; rollout requires road activity');
  }
  const failures = [];
  const checks = [];
  const check = (scope, metric, current, threshold, minimum) => {
    const pass = Number.isFinite(current) && Number.isFinite(threshold)
      && (minimum ? current >= threshold - 1e-9 : current <= threshold + 1e-9);
    const row = { scope, metric, current, threshold, direction: minimum ? 'minimum' : 'maximum', pass };
    checks.push(row); if (!pass) failures.push(row);
  };
  for (const key of ['ticks', 'seeds', 'resources', 'width', 'height']) {
    if (JSON.stringify(baseline.meta[key]) !== JSON.stringify(candidate.meta[key])) {
      throw new Error(`Incompatible benchmark profile: ${key}`);
    }
  }
  const controls = new Map(baseline.variant.rows.map((row) => [row.seed, row]));
  if (controls.size !== candidate.variant.rows.length) throw new Error('Seed count mismatch');
  for (const row of candidate.variant.rows) {
    const previous = controls.get(row.seed);
    if (!previous) throw new Error(`Missing baseline seed ${row.seed}`);
    const scope = `seed:${row.seed}`;
    const base = previous.refinement; const current = row.refinement;
    check(scope, 'population', row.population, previous.population * 0.9, true);
    check(scope, 'births', current.economy.births,
      Math.min(base.economy.births * 0.9, base.economy.births - 2), true);
    check(scope, 'deaths', current.economy.deaths,
      Math.max(base.economy.deaths * 1.1, base.economy.deaths + 2), false);
    for (const key of ['food', 'water', 'beer']) {
      const stock = current.economy.resources[key]; const oldStock = base.economy.resources[key];
      check(scope, `${key}.mean`, stock.average, oldStock.average * (key === 'beer' ? 0.88 : 0.92), true);
      if (key !== 'beer') {
        check(scope, `${key}.floor`, stock.floor, Math.min(oldStock.floor * 0.9, oldStock.floor - 2), true);
        check(scope, `${key}.gatherUnits`, current.movement.gatherUnits[key], base.movement.gatherUnits[key] * 0.95, true);
      }
    }
    for (const metric of ['meanTravelTicks', 'p95TravelTicks']) {
      if (base.movement[metric] !== null) check(scope, metric, current.movement[metric], base.movement[metric] * 1.1, false);
    }
    check(scope, 'failedStepShare', current.movement.failedSteps / Math.max(1, current.movement.attempts),
      base.movement.failedSteps / Math.max(1, base.movement.attempts) + 0.02, false);
    check(scope, 'invalidStocks', current.economy.invalidStockpiles, 0, false);
    check(scope, 'invalidMoodMemory', current.social.invalidMoodMemory, 0, false);
    check(scope, 'invalidSocial', current.social.invalidAggregateSamples, 0, false);
    check(scope, 'activeLegacyMagnitude', current.legacy.activeMagnitude, 0.05, false);
    if (current.narrative.priorityOwnership !== null) check(scope, 'priorityOwnership', current.narrative.priorityOwnership, 1, true);
    if (enforceTiming) check(scope, 'ticksPerSecond', current.runtime.ticksPerSecond, base.runtime.ticksPerSecond * 0.85, true);
  }
  const base = baseline.variant.summary.refinement; const current = candidate.variant.summary.refinement;
  check('aggregate', 'population', current.economy.population, base.economy.population * 0.92, true);
  for (const key of ['food', 'water']) {
    check('aggregate', `${key}.gatherUnits`, current.movement.gatherUnits[key], base.movement.gatherUnits[key] * 0.95, true);
    check('aggregate', `${key}.mean`, current.economy.resources[key].average, base.economy.resources[key].average * 0.92, true);
  }
  if (requireRoadActivity) {
    const substitutions = candidate.variant.rows.reduce((sum, row) =>
      sum + Number(row.refinement.movement.roadSubstitutions ?? 0), 0);
    check('aggregate', 'roadSubstitutions', substitutions, 1, true);
    check('aggregate', 'longTripRoadShareGain', current.movement.referenceLongRoadStepShare,
      base.movement.referenceLongRoadStepShare, true);
  }
  return { schemaVersion: 1, passed: failures.length === 0, baselineProfile: baseline.meta,
    candidateProfile: candidate.meta, candidateVariant: candidate.variant.label,
    phase: requireRoadActivity ? 'rollout' : 'startup', roadActivityRequired: requireRoadActivity,
    roadActivityUnit: 'sum of actual per-seed substitutions; minimum one',
    timingEnforced: enforceTiming, checks, failures };
}

// Replay a real late-game routing workload at fixed population, targets, and random stream.
function probeRoadRuntime(snapshot, frames = 64) {
  const originalRandom = Math.random;
  const samples = [];
  try {
    // ABBA order limits warm-up and thermal bias; every run starts from the same captured world.
    for (const enabled of [false, true, true, false]) {
      const state = JSON.parse(JSON.stringify(snapshot.state));
      const config = JSON.parse(JSON.stringify(snapshot.config));
      const field = config.population.pathing.field;
      const affinity = field.road_affinity || field.roadAffinity;
      affinity.enabled = enabled; affinity.routing_mode = 'cost_guarded';
      delete state.pathing;
      let randomSeed = 202;
      Math.random = () => ((randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0) / 4294967296);
      const homes = new Map((state.structures || []).map((entry) => [entry.id, entry]));
      const queries = [];
      const positions = state.dwarves.map((actor) => ({ actor, initial: {
        x: actor.x, y: actor.y, moveCooldown: actor.moveCooldown,
        lastMoveDx: actor.lastMoveDx, lastMoveDy: actor.lastMoveDy,
        pathTargetKey: actor.pathTargetKey, pathStallTicks: actor.pathStallTicks,
        pathDetourTicks: actor.pathDetourTicks,
        roadRoute: actor.roadRoute,
      } }));
      for (const actor of state.dwarves) {
        if (actor.underrealmDuty && actor.underrealmDuty.active !== false) continue;
        const target = actor.job?.target || homes.get(actor.homeId);
        if (!target || (actor.x === target.x && actor.y === target.y)) continue;
        queries.push({ actor, x: target.x, y: target.y,
          key: actor.pathTargetKey || `probe:${target.x},${target.y}` });
      }
      if (!queries.length) throw new Error('Runtime probe has no real travel targets');
      const timings = [];
      for (let frame = 0; frame < frames; frame += 1) {
        for (const { actor, initial } of positions) Object.assign(actor, initial);
        state.tick += 1;
        const start = performance.now();
        for (const query of queries) moveWithDetour(query.actor, query.x, query.y,
          snapshot.runtime, state, config, query.key);
        timings.push(performance.now() - start);
      }
      samples.push({ enabled, population: state.dwarves.length, queries: queries.length,
        elapsedMs: timings.reduce((sum, value) => sum + value, 0), timings });
    }
  } finally { Math.random = originalRandom; }
  const baseline = samples.filter((entry) => !entry.enabled).reduce((sum, entry) => sum + entry.elapsedMs, 0);
  const candidate = samples.filter((entry) => entry.enabled).reduce((sum, entry) => sum + entry.elapsedMs, 0);
  const throughputRatio = baseline / candidate;
  return { schemaVersion: 1, passed: throughputRatio >= 0.85, minimumThroughputRatio: 0.85,
    throughputRatio, population: snapshot.state.dwarves.length, framesPerRun: frames,
    method: 'ABBA fixed real-world routing workload; restore positions, targets and RNG each run; no simulation baseline rerun', samples };
}

// Keep CLI validation read-only except for an explicitly requested acceptance report.
function main(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--enforce-timing') options.enforceTiming = true;
    else if (argv[index] === '--startup-only') options.startupOnly = true;
    else if (['--baseline', '--candidate', '--control', '--variant', '--report-json', '--probe-state'].includes(argv[index])) {
      options[argv[index].slice(2)] = argv[++index];
    } else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (options['probe-state']) {
    const snapshot = JSON.parse(fs.readFileSync(path.resolve(ROOT, options['probe-state']), 'utf8'));
    const report = probeRoadRuntime(snapshot);
    process.stdout.write(`road-routing runtime: ${report.passed ? 'PASS' : 'FAIL'} population=${report.population} throughput=${report.throughputRatio.toFixed(3)}\n`);
    if (options['report-json']) fs.writeFileSync(path.resolve(ROOT, options['report-json']), `${JSON.stringify(report, null, 2)}\n`);
    if (!report.passed) process.exitCode = 1;
    return;
  }
  if (!options.candidate) throw new Error('--candidate is required');
  const baseline = loadVariant(options.baseline || 'benchmark_cache/headless_benchmark_baseline.json', options.control, false);
  const candidate = loadVariant(options.candidate, options.variant, true);
  const report = validateRoadReports(baseline, candidate, options.enforceTiming, !options.startupOnly);
  process.stdout.write(`road-routing gate: ${report.passed ? 'PASS' : 'FAIL'} (${report.checks.length} checks)\n`);
  for (const row of report.failures) process.stdout.write(`  ${row.scope} ${row.metric}: ${row.current} ${row.direction} ${row.threshold}\n`);
  if (options['report-json']) fs.writeFileSync(path.resolve(ROOT, options['report-json']), `${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
module.exports = { validateRoadReports, probeRoadRuntime };
