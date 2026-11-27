#!/usr/bin/env node
'use strict';

// Single evaluator and promotion gate (STRATEGY.md step T3). Every player is played in-process by
// experiments/challenge_probe.js on the horizons of `ai.evaluation` (8,000 ticks on the eval plan,
// 20,000 ticks on the standard game), a trained policy at its own `stepTicks`, the council at
// `councilStepTicks`. Results are cached per (simulation sources, config, horizon, player content), so
// the council and an unchanged incumbent are played once per game version.
//
//   node scripts/scorecard.js --policy <file> [--against <file>|council] [--out <file>] [--workers 7]
//   node scripts/scorecard.js --policy <file> --gate [--promote]      (gate vs models/policy_best.json)
//   options for smoke tests: --config <file>, --set <ai.evaluation path>=<json> (e.g. horizons.0.ticks=400)
//
// Gate (ai.evaluation.gate): paired reward per planned tick (`rpp`) of the candidate minus the
// incumbent on the gate horizon must exceed minImprove with a lower bound (lcbZ) above zero, and on the
// guard horizon no metric listed in `guards` may be worse beyond guardZ standard errors: rpp, final
// population and mean population over the second half (`latePop`; upper bound not below zero),
// extinctions and avoidable deaths (lower bound not above zero), as the section 6 protocol of
// STRATEGY.md asks of training changes. With `staged` the gate horizon is played first and the other
// horizons only when the candidate passes its primary test (E51), so a failing candidate costs one
// short horizon. The incumbent is the current best policy when it is a v2 policy (has stepTicks),
// otherwise the council. --promote copies a passing candidate (and its trainer state) to
// models/policy_best.* and writes the scorecard as its meta.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const probe = require(path.join(ROOT, 'experiments', 'challenge_probe.js'));
const AVOIDABLE = ['starvation', 'raid', 'deepRaid', 'ruins', 'warriorLeague'];
// Bump when the way games are set up or scored here changes (horizonOptions, gameOutcome): it is part
// of every cache key, like the simulation sources and experiments/challenge_probe.js.
const EVALUATION_VERSION = 2;
// Repository-relative label for files inside the repository, absolute otherwise.
// Guard metrics of the gate and their direction: +1 = higher is better, -1 = lower is better.
const GUARD_DIRECTION = { rpp: 1, pop: 1, latePop: 1, extinctions: -1, avoidable: -1 };
const label = (file) => (path.relative(ROOT, file).startsWith('..') ? file : path.relative(ROOT, file));

function parseArgs(argv) {
  const options = { policy: null, against: null, out: null, workers: 7, gate: false, promote: false,
    config: null, sets: [], incumbent: path.join(ROOT, 'models', 'policy_best.json') };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--policy') options.policy = path.resolve(next());
    else if (arg === '--against') options.against = next();
    else if (arg === '--out') options.out = path.resolve(next());
    else if (arg === '--workers') options.workers = Number(next());
    else if (arg === '--gate') options.gate = true;
    else if (arg === '--promote') { options.gate = true; options.promote = true; }
    else if (arg === '--incumbent') options.incumbent = path.resolve(next());
    else if (arg === '--config') options.config = path.resolve(next());
    else if (arg === '--set') options.sets.push(next());
    else throw new Error(`Unknown option ${arg}`);
  }
  if (!options.policy) throw new Error('--policy is required');
  if (options.against && options.gate) throw new Error('--against and --gate are exclusive (the gate picks the incumbent)');
  return options;
}

// Effective evaluation settings: ai.evaluation plus --set overrides (JSON values).
function evaluationSettings(config, sets = []) {
  const settings = JSON.parse(JSON.stringify((config.ai && config.ai.evaluation) || {}));
  for (const entry of sets) {
    const index = entry.indexOf('=');
    if (index <= 0) throw new Error(`--set expects path=value, got ${entry}`);
    const keys = entry.slice(0, index).split('.');
    let value = entry.slice(index + 1);
    try { value = JSON.parse(value); } catch (error) { /* keep raw string */ }
    let node = settings;
    for (const key of keys.slice(0, -1)) node = node[key];
    node[keys[keys.length - 1]] = value;
  }
  validateSettings(settings);
  return settings;
}

// Refuse incomplete or out-of-range evaluation settings instead of guessing.
function validateSettings(settings) {
  const positive = (value, name) => {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`ai.evaluation.${name} must be a positive integer`);
  };
  positive(settings.councilStepTicks, 'councilStepTicks');
  if (!Array.isArray(settings.scenarios) || settings.scenarios.length === 0 || settings.scenarios.some((name) => typeof name !== 'string')) {
    throw new Error('ai.evaluation.scenarios must list the eval-plan scenario names');
  }
  if (!Array.isArray(settings.horizons) || settings.horizons.length === 0) throw new Error('ai.evaluation.horizons is empty');
  const names = new Set();
  settings.horizons.forEach((h, i) => {
    if (!h || typeof h.name !== 'string' || names.has(h.name)) throw new Error(`ai.evaluation.horizons.${i}.name missing or duplicated`);
    names.add(h.name);
    if (h.plan !== 'eval' && h.plan !== 'standard') throw new Error(`ai.evaluation.horizons.${i}.plan must be eval or standard`);
    positive(h.ticks, `horizons.${i}.ticks`);
    positive(h.games, `horizons.${i}.games`);
    positive(h.seedBase, `horizons.${i}.seedBase`);
  });
  const gate = settings.gate || {};
  if (!names.has(gate.horizon) || !names.has(gate.guardHorizon)) throw new Error('ai.evaluation.gate horizons must name configured horizons');
  for (const key of ['minImprove', 'lcbZ', 'guardZ']) {
    if (!Number.isFinite(gate[key]) || gate[key] < 0) throw new Error(`ai.evaluation.gate.${key} must be a number >= 0`);
  }
  if (typeof settings.staged !== 'boolean') throw new Error('ai.evaluation.staged must be true or false');
  if (!Number.isFinite(settings.earlyStopZ)) throw new Error('ai.evaluation.earlyStopZ must be a number');
  if (!Array.isArray(gate.guards) || gate.guards.length === 0 || gate.guards.some((m) => !(m in GUARD_DIRECTION))
      || new Set(gate.guards).size !== gate.guards.length) {
    throw new Error(`ai.evaluation.gate.guards must list distinct metrics among ${Object.keys(GUARD_DIRECTION).join(', ')}`);
  }
}

// Probe options for one horizon. The eval plan plays the real game (endgame on); the standard plan
// uses seeds seedBase * (i + 1) like the headless benchmark series.
function horizonOptions(horizon, settings, configFile, workers) {
  const base = { ticks: horizon.ticks, sampleEvery: 250, workers, stepTicks: settings.councilStepTicks,
    config: configFile, quiet: true, plan: horizon.plan };
  if (horizon.plan === 'standard') {
    return { ...base, seeds: Array.from({ length: horizon.games }, (_, i) => horizon.seedBase * (i + 1)).join(','), set: [] };
  }
  return { ...base, seedBase: horizon.seedBase, episodes: horizon.games, set: ['endgame.enabled=true'] };
}

// Content hash of everything a cached result depends on: simulation and evaluator sources, the
// configuration, the horizon and the player's own content.
let sourceHash = null;
function sourcesDigest() {
  if (sourceHash) return sourceHash;
  const hash = crypto.createHash('sha256');
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) hash.update(path.relative(ROOT, full)).update(fs.readFileSync(full));
    }
  };
  walk(path.join(ROOT, 'src'));
  hash.update(fs.readFileSync(path.join(ROOT, 'experiments', 'challenge_probe.js'))).update(`scorecard:${EVALUATION_VERSION}`);
  sourceHash = hash.digest('hex');
  return sourceHash;
}

function playerDigest(player) {
  if (player === 'default') return 'council';
  return crypto.createHash('sha256').update(fs.readFileSync(player.slice('policy:'.length))).digest('hex');
}

function cacheKey(player, horizon, settings, configText) {
  return crypto.createHash('sha256').update(JSON.stringify({
    sources: sourcesDigest(), config: crypto.createHash('sha256').update(configText).digest('hex'),
    horizon, councilStepTicks: settings.councilStepTicks, player: playerDigest(player),
  })).digest('hex').slice(0, 32);
}

// Compact per-game outcome kept in the cache and the scorecard.
function gameOutcome(summary) {
  return { key: `${summary.seed}:${summary.scenario}`, pop: summary.final_pop, latePop: summary.mean_pop_second_half,
    extinct: summary.extinction_tick !== null,
    avoidable: AVOIDABLE.reduce((s, k) => s + Number((summary.deaths || {})[k] || 0), 0), rpp: summary.outcome_score };
}

// Play one player on one horizon (or read it from the cache). Returns per-game outcomes in task order.
async function playHorizon(player, horizon, settings, context) {
  const key = cacheKey(player, horizon, settings, context.configText);
  const file = path.join(context.cacheDir, `${key}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')).games;
  const options = { ...horizonOptions(horizon, settings, context.configFile, context.workers), players: player };
  const tasks = probe.buildTasks(options, context.config);
  const started = Date.now();
  const episodes = await probe.runPool(tasks, options);
  const index = (e) => tasks.findIndex((t) => t.seed === e.seed && t.scenario === e.scenario);
  episodes.sort((a, b) => index(a) - index(b));
  const games = episodes.map((e) => gameOutcome(e.summary));
  console.log(`[scorecard] ${horizon.name} ${player === 'default' ? 'council' : label(player.slice(7))}: `
    + `${games.length} games in ${Math.round((Date.now() - started) / 1000)}s`);
  fs.mkdirSync(context.cacheDir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ player: playerDigest(player), horizon, games })}\n`);
  fs.renameSync(tmp, file);
  return games;
}

// Paired statistics of a - b over the same games.
function paired(a, b) {
  const d = a.map((x, i) => x - b[i]);
  const n = d.length;
  const mean = d.reduce((s, x) => s + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  const se = sd / Math.sqrt(n);
  return { mean, se, z: se > 0 ? mean / se : 0, wins: d.filter((x) => x > 0).length, n };
}
const average = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

function aggregate(games) {
  return { pop: average(games.map((g) => g.pop)), latePop: average(games.map((g) => g.latePop)), rpp: average(games.map((g) => g.rpp)),
    avoidable: average(games.map((g) => g.avoidable)), extinctions: games.filter((g) => g.extinct).length, games: games.length };
}

// Paired candidate-minus-other deltas per game: final and second-half population, rpp, extinction (1/0),
// avoidable deaths.
function comparison(a, b) {
  const pair = (value) => paired(a.map(value), b.map(value));
  return { pop: pair((g) => g.pop), latePop: pair((g) => g.latePop), rpp: pair((g) => g.rpp),
    extinctions: pair((g) => (g.extinct ? 1 : 0)),
    avoidable: pair((g) => g.avoidable) };
}

// Gate decision on the scorecard of a candidate against the incumbent.
// A guard metric is "worse beyond guardZ SE" when even its most favourable bound is on the wrong side:
// upper bound below zero for higher-is-better metrics, lower bound above zero for lower-is-better ones.
// Primary test of the gate on the gate horizon: rpp delta >= minImprove with its lower bound above zero.
function primaryTest(entry, gate) {
  const primary = entry.vsAgainst.rpp;
  const lower = primary.mean - gate.lcbZ * primary.se;
  const reasons = [];
  if (primary.mean < gate.minImprove) reasons.push(`${gate.horizon} rpp delta ${primary.mean.toFixed(4)} < minImprove ${gate.minImprove}`);
  if (lower <= 0) reasons.push(`${gate.horizon} rpp lower bound ${lower.toFixed(4)} <= 0`);
  return { lower, reasons };
}

function gateDecision(horizons, gate) {
  const { lower, reasons } = primaryTest(horizons[gate.horizon], gate);
  const guards = {};
  if (!horizons[gate.guardHorizon]) {
    reasons.push(`${gate.guardHorizon} not played (staged evaluation stops after a failed ${gate.horizon} test)`);
    return { pass: false, lowerBound: lower, guards, reasons };
  }
  for (const metric of gate.guards) {
    const delta = horizons[gate.guardHorizon].vsAgainst[metric];
    const direction = GUARD_DIRECTION[metric];
    // Rounded so that a bound of exactly zero (e.g. 3/32 - 1 x 3/32) is not lost to float residue.
    const bound = Math.round((delta.mean + direction * gate.guardZ * delta.se) * 1e9) / 1e9;
    const ok = direction > 0 ? bound >= 0 : bound <= 0;
    guards[metric] = { mean: delta.mean, se: delta.se, bound, ok };
    if (!ok) {
      reasons.push(`${gate.guardHorizon} ${metric} worse beyond ${gate.guardZ} SE: delta ${delta.mean.toFixed(4)}, `
        + `${direction > 0 ? 'upper' : 'lower'} bound ${bound.toFixed(4)} ${direction > 0 ? '< 0' : '> 0'}`);
    }
  }
  return { pass: reasons.length === 0, lowerBound: lower, guards, reasons };
}

// Load a policy file and require the cadence the evaluator plays it at.
function requireV2Policy(file) {
  const policy = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Number.isInteger(policy.stepTicks) || policy.stepTicks <= 0) {
    throw new Error(`${label(file)} has no stepTicks: only policies from scripts/train_recipe.js can be scored`);
  }
  require(path.join(ROOT, 'src', 'ai', 'policy')).loadPolicy(file); // throws on any other non-v2 shape
  return policy;
}

function isV2Policy(file) {
  if (!fs.existsSync(file)) return false;
  try { requireV2Policy(file); return true; } catch (error) { return false; }
}

// Score `policy` against the council and an optional second player on every horizon.
async function scorecard({ policy, against = null, configFile = null, sets = [], workers = 7 }) {
  const { loadConfig } = require(path.join(ROOT, 'src', 'config'));
  const resolvedConfig = configFile || path.join(ROOT, 'config.json');
  const config = loadConfig(resolvedConfig);
  const settings = evaluationSettings(config, sets);
  requireV2Policy(policy);
  if (against && against !== 'council') requireV2Policy(against);
  const context = { config, configFile: resolvedConfig, configText: fs.readFileSync(resolvedConfig, 'utf8'), workers,
    cacheDir: path.resolve(ROOT, settings.cacheDir) };
  const againstPlayer = against && against !== 'council' ? `policy:${against}` : null;
  const horizons = {};
  // Staged evaluation plays the gate horizon first and stops when the candidate fails its primary test.
  const staged = settings.staged && Boolean(against);
  const ordered = staged
    ? [...settings.horizons].sort((a, b) => (b.name === settings.gate.horizon) - (a.name === settings.gate.horizon))
    : settings.horizons;
  const skipped = [];
  let stop = false;
  for (const horizon of ordered) {
    if (stop) { skipped.push(horizon.name); continue; }
    const council = await playHorizon('default', horizon, settings, context);
    const candidate = await playHorizon(`policy:${policy}`, horizon, settings, context);
    const entry = { plan: horizon.plan, ticks: horizon.ticks, council: aggregate(council), policy: aggregate(candidate),
      vsCouncil: comparison(candidate, council) };
    entry.outcomes = { council, policy: candidate };
    if (againstPlayer) {
      const other = await playHorizon(againstPlayer, horizon, settings, context);
      entry.against = aggregate(other);
      entry.vsAgainst = comparison(candidate, other);
      entry.outcomes.against = other;
    } else if (against === 'council') {
      entry.vsAgainst = entry.vsCouncil;
    }
    horizons[horizon.name] = entry;
    if (staged && horizon.name === settings.gate.horizon && primaryTest(entry, settings.gate).reasons.length) {
      stop = true;
    }
  }
  return { policy: label(policy), against: against ? (against === 'council' ? 'council' : label(against)) : null,
    settings, sources: sourcesDigest(), horizons, skipped };
}

function formatPaired(p) {
  return `${p.mean >= 0 ? '+' : ''}${p.mean.toFixed(Math.abs(p.mean) < 1 ? 4 : 1)} (SE ${p.se.toFixed(Math.abs(p.se) < 1 ? 4 : 1)}, z ${p.z.toFixed(2)}, wins ${p.wins}/${p.n})`;
}

function printScorecard(card) {
  for (const [name, h] of Object.entries(card.horizons)) {
    console.log(`${name} (${h.plan}, ${h.ticks} ticks, ${h.policy.games} games): council pop ${h.council.pop.toFixed(1)} `
      + `ext ${h.council.extinctions} avoidable ${h.council.avoidable.toFixed(1)} | policy pop ${h.policy.pop.toFixed(1)} `
      + `ext ${h.policy.extinctions} avoidable ${h.policy.avoidable.toFixed(1)}`);
    const line = (c) => `pop ${formatPaired(c.pop)}, late pop ${formatPaired(c.latePop)}, rpp ${formatPaired(c.rpp)}, extinct ${formatPaired(c.extinctions)}, `
      + `avoidable ${formatPaired(c.avoidable)}`;
    console.log(`  vs council: ${line(h.vsCouncil)}`);
    if (h.against) console.log(`  vs ${card.against}: ${line(h.vsAgainst)}`);
  }
  if (card.skipped && card.skipped.length) console.log(`(staged: ${card.skipped.join(', ')} not played after a failed ${card.settings.gate.horizon} test)`);
  if (card.gate) {
    const guards = Object.entries(card.gate.guards).map(([m, g]) => `${m} ${g.ok ? 'ok' : 'FAIL'} ${g.bound.toFixed(4)}`).join(', ');
    console.log(`gate vs ${card.against}: ${card.gate.pass ? 'PASS' : 'FAIL'}`
      + ` (${card.settings.gate.horizon} rpp lower bound ${card.gate.lowerBound.toFixed(4)}; ${card.settings.gate.guardHorizon} guards: ${guards})`);
    for (const reason of card.gate.reasons) console.log(`  - ${reason}`);
  }
}

// Copy a passing candidate and its trainer state to models/policy_best.* (atomic per file).
function promote(policyFile, card, target) {
  const copy = (from, to) => {
    const tmp = `${to}.${process.pid}.tmp`;
    fs.copyFileSync(from, tmp);
    fs.renameSync(tmp, to);
  };
  const stem = target.replace(/\.json$/, '');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  copy(policyFile, target);
  const state = policyFile.replace(/\.json$/, '.state.pt');
  if (fs.existsSync(state)) copy(state, `${stem}.state.pt`);
  else if (fs.existsSync(`${stem}.state.pt`)) fs.rmSync(`${stem}.state.pt`);
  const meta = { source: 'scorecard', promotedAt: new Date().toISOString(), policy: card.policy, against: card.against,
    gate: card.gate, horizons: Object.fromEntries(Object.entries(card.horizons).map(([k, h]) => [k, { ...h, outcomes: undefined }])) };
  fs.writeFileSync(`${stem}.meta.json`, `${JSON.stringify(meta, null, 2)}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let against = options.against ? (options.against === 'council' ? 'council' : path.resolve(options.against)) : null;
  if (options.gate) against = isV2Policy(options.incumbent) ? options.incumbent : 'council';
  if (against && against !== 'council' && path.resolve(against) === options.policy) throw new Error('candidate and incumbent are the same file');
  const card = await scorecard({ policy: options.policy, against, configFile: options.config, sets: options.sets, workers: options.workers });
  if (options.gate) {
    if (!card.horizons[card.settings.gate.horizon].vsAgainst) throw new Error('gate needs an incumbent comparison');
    card.gate = gateDecision(card.horizons, card.settings.gate);
  }
  printScorecard(card);
  const out = options.out || path.join(path.dirname(options.policy), 'scorecard.json');
  fs.writeFileSync(out, `${JSON.stringify(card, null, 1)}\n`);
  console.log(`[scorecard] wrote ${label(out)}`);
  if (options.promote) {
    if (!card.gate.pass) { console.log('[scorecard] gate failed: models/ unchanged'); process.exitCode = 2; return; }
    promote(options.policy, card, options.incumbent);
    console.log(`[scorecard] promoted ${card.policy} to ${label(options.incumbent)}`);
  }
}

module.exports = { scorecard, evaluationSettings, gateDecision, primaryTest, comparison, paired, horizonOptions, cacheKey };

if (require.main === module) {
  main().catch((error) => { console.error(`[scorecard] ${error.message}`); process.exit(1); });
}
