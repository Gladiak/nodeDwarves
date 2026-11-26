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
// incumbent on the gate horizon must exceed minImprove with a lower bound (lcbZ) above zero, and the
// guard horizon must not regress (upper bound at guardZ not below zero). The incumbent is the current
// best policy when it is a v2 policy (has stepTicks), otherwise the council. --promote copies a passing
// candidate (and its trainer state) to models/policy_best.* and writes the scorecard as its meta.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const probe = require(path.join(ROOT, 'experiments', 'challenge_probe.js'));
const AVOIDABLE = ['starvation', 'raid', 'deepRaid', 'ruins', 'warriorLeague'];
// Bump when the way games are set up or scored here changes (horizonOptions, gameOutcome): it is part
// of every cache key, like the simulation sources and experiments/challenge_probe.js.
const EVALUATION_VERSION = 1;
// Repository-relative label for files inside the repository, absolute otherwise.
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
  return { key: `${summary.seed}:${summary.scenario}`, pop: summary.final_pop, extinct: summary.extinction_tick !== null,
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
  return { pop: average(games.map((g) => g.pop)), rpp: average(games.map((g) => g.rpp)),
    avoidable: average(games.map((g) => g.avoidable)), extinctions: games.filter((g) => g.extinct).length, games: games.length };
}

function comparison(a, b) {
  return { pop: paired(a.map((g) => g.pop), b.map((g) => g.pop)), rpp: paired(a.map((g) => g.rpp), b.map((g) => g.rpp)) };
}

// Gate decision on the scorecard of a candidate against the incumbent.
function gateDecision(horizons, gate) {
  const primary = horizons[gate.horizon].vsAgainst.rpp;
  const guard = horizons[gate.guardHorizon].vsAgainst.rpp;
  const lower = primary.mean - gate.lcbZ * primary.se;
  const upper = guard.mean + gate.guardZ * guard.se;
  const reasons = [];
  if (primary.mean < gate.minImprove) reasons.push(`${gate.horizon} rpp delta ${primary.mean.toFixed(4)} < minImprove ${gate.minImprove}`);
  if (lower <= 0) reasons.push(`${gate.horizon} rpp lower bound ${lower.toFixed(4)} <= 0`);
  if (upper < 0) reasons.push(`${gate.guardHorizon} rpp upper bound ${upper.toFixed(4)} < 0 (long-horizon regression)`);
  return { pass: reasons.length === 0, lowerBound: lower, guardUpperBound: upper, reasons };
}

// Load a policy file and require the cadence the evaluator plays it at.
function requireV2Policy(file) {
  const policy = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Number.isInteger(policy.stepTicks) || policy.stepTicks <= 0) {
    throw new Error(`${label(file)} has no stepTicks: only policies from scripts/train_recipe.js can be scored`);
  }
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
  for (const horizon of settings.horizons) {
    const council = await playHorizon('default', horizon, settings, context);
    const candidate = await playHorizon(`policy:${policy}`, horizon, settings, context);
    const entry = { plan: horizon.plan, ticks: horizon.ticks, council: aggregate(council), policy: aggregate(candidate),
      vsCouncil: comparison(candidate, council) };
    if (againstPlayer) {
      const other = await playHorizon(againstPlayer, horizon, settings, context);
      entry.against = aggregate(other);
      entry.vsAgainst = comparison(candidate, other);
    } else if (against === 'council') {
      entry.vsAgainst = entry.vsCouncil;
    }
    entry.outcomes = { council, policy: candidate };
    horizons[horizon.name] = entry;
  }
  return { policy: label(policy), against: against ? (against === 'council' ? 'council' : label(against)) : null,
    settings, sources: sourcesDigest(), horizons };
}

function formatPaired(p) {
  return `${p.mean >= 0 ? '+' : ''}${p.mean.toFixed(Math.abs(p.mean) < 1 ? 4 : 1)} (SE ${p.se.toFixed(Math.abs(p.se) < 1 ? 4 : 1)}, z ${p.z.toFixed(2)}, wins ${p.wins}/${p.n})`;
}

function printScorecard(card) {
  for (const [name, h] of Object.entries(card.horizons)) {
    console.log(`${name} (${h.plan}, ${h.ticks} ticks, ${h.policy.games} games): council pop ${h.council.pop.toFixed(1)} `
      + `ext ${h.council.extinctions} avoidable ${h.council.avoidable.toFixed(1)} | policy pop ${h.policy.pop.toFixed(1)} `
      + `ext ${h.policy.extinctions} avoidable ${h.policy.avoidable.toFixed(1)}`);
    console.log(`  vs council: pop ${formatPaired(h.vsCouncil.pop)}, rpp ${formatPaired(h.vsCouncil.rpp)}`);
    if (h.against) console.log(`  vs ${card.against}: pop ${formatPaired(h.vsAgainst.pop)}, rpp ${formatPaired(h.vsAgainst.rpp)}`);
  }
  if (card.gate) {
    console.log(`gate vs ${card.against}: ${card.gate.pass ? 'PASS' : 'FAIL'}`
      + ` (lower bound ${card.gate.lowerBound.toFixed(4)}, guard upper bound ${card.gate.guardUpperBound.toFixed(4)})`);
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

module.exports = { scorecard, evaluationSettings, gateDecision, paired, horizonOptions, cacheKey };

if (require.main === module) {
  main().catch((error) => { console.error(`[scorecard] ${error.message}`); process.exit(1); });
}
