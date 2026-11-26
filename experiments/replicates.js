#!/usr/bin/env node
'use strict';

// Replicated recipe runs judged against the council (STRATEGY.md protocol, step T). One command,
// resumable: every finished step is kept and skipped on the next call, an interrupted training run is
// restarted from scratch (runs are deterministic, so nothing is lost but time).
//
//   node experiments/replicates.js --session experiments/runs/<date>_<topic> --name <variant> \
//     [--reps 3] [--set <recipe path>=<json>]... [--workers 7] [--games8k 24] [--seeds20k 32]
//     [--bank <existing bank dir>] [--ticks8k 8000] [--ticks20k 20000]   (the last three for smoke tests)
//
// Steps: (1) evaluation config frozen in the session, (2) council evaluated once at 8,000 ticks (eval
// plan, eval_paired.py) and 20,000 ticks (standard game, challenge_probe.js), (3) per replicate:
// training through scripts/train_recipe.js (the snapshot bank is built and cached on first use), the
// same two evaluations, and the policy's deterministic lever choices on bank states, (4) a paired
// summary per replicate and pooled over replicates, written to <session>/<name>_summary.json.
//
// Example (E42, persistent lever exploration):
//   node experiments/replicates.js --session experiments/runs/2026-11-27_e42 --name persist \
//     --set leverNoiseHold=280 --set leverLogStdInit=0

const fs = require('fs');
const os = require('os');
const path = require('path');
const v8 = require('v8');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PYTHON = path.join(ROOT, '.venv', 'bin', 'python');

function parseArgs(argv) {
  const options = { reps: 3, sets: [], workers: null, games8k: 24, seeds20k: 32, ticks8k: 8000, ticks20k: 20000, bank: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--session') options.session = path.resolve(next());
    else if (arg === '--name') options.name = next();
    else if (arg === '--reps') options.reps = Number(next());
    else if (arg === '--set') options.sets.push(next());
    else if (arg === '--workers') options.workers = Number(next());
    else if (arg === '--games8k') options.games8k = Number(next());
    else if (arg === '--seeds20k') options.seeds20k = Number(next());
    else if (arg === '--ticks8k') options.ticks8k = Number(next());
    else if (arg === '--ticks20k') options.ticks20k = Number(next());
    else if (arg === '--bank') options.bank = path.resolve(next());
    else throw new Error(`Unknown option ${arg}`);
  }
  if (!options.session || !options.name) throw new Error('--session and --name are required');
  if (!fs.existsSync(PYTHON)) throw new Error(`Python venv missing at ${PYTHON}: run npm run ai:bootstrap`);
  return options;
}

// Run a command from the repository root; stream its output; throw on failure.
function run(command, args) {
  console.log(`[replicates] ${path.basename(command)} ${args.map((a) => path.isAbsolute(a) ? path.relative(ROOT, a) : a).join(' ')}`);
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (exit ${result.status})`);
}

// Evaluation config: the endgame profile the protocol evaluates on, frozen once per session.
function ensureEvalConfig(session) {
  const target = path.join(session, 'config_eval.json');
  if (!fs.existsSync(target)) {
    const wrapper = require(path.join(ROOT, 'scripts', 'train_wrapper'));
    const { runDir, files } = wrapper.prepareRunFiles(ROOT, 'm4-balanced', {}, false);
    fs.copyFileSync(files.endgame, target);
    fs.rmSync(runDir, { recursive: true, force: true });
  }
  return target;
}

function eval8k(policy, out, evalConfig, options) {
  if (fs.existsSync(out)) return;
  const args = [path.join('experiments', 'eval_paired.py'), '--policy', policy, '--outcomes', '--config', evalConfig,
    '--ticks', String(options.ticks8k), '--episodes', String(options.games8k), '--workers', String(options.workers || 7), '--out', out];
  if (policy === 'default') args.push('--step-ticks', '10');
  run(PYTHON, args);
}

function eval20k(player, out, options) {
  if (fs.existsSync(out)) return;
  const seeds = Array.from({ length: options.seeds20k }, (_, i) => 101 * (i + 1)).join(',');
  run(process.execPath, [path.join('experiments', 'challenge_probe.js'), '--plan', 'standard', '--seeds', seeds,
    '--ticks', String(options.ticks20k), '--workers', String(options.workers || 7), '--players', player, '--out', out]);
}

// Deterministic lever choices (u in [0, 1], 0.5 = council default) on a sample of bank states.
function leverReadout(policyFile, bankDir) {
  const { loadPolicy, policyForward } = require(path.join(ROOT, 'src', 'ai', 'policy'));
  const policy = loadPolicy(policyFile);
  const levers = policy.resources.map((r, i) => [r, i]).filter(([r]) => r.startsWith('lever_'));
  const values = Object.fromEntries(levers.map(([r]) => [r.slice(6), []]));
  const files = fs.readdirSync(bankDir).filter((f) => f.endsWith('.v8.gz')).sort();
  const step = Math.max(1, Math.floor(files.length / 60));
  for (let i = 0; i < files.length; i += step) {
    const snap = v8.deserialize(zlib.gunzipSync(fs.readFileSync(path.join(bankDir, files[i]))));
    const out = policyForward(snap.state, snap.config, policy);
    if (out) for (const [r, index] of levers) values[r.slice(6)].push((out.output[index] + 1) / 2);
  }
  return Object.fromEntries(Object.entries(values).map(([name, list]) => {
    const mean = list.reduce((a, b) => a + b, 0) / list.length;
    const sd = Math.sqrt(list.reduce((a, b) => a + (b - mean) ** 2, 0) / list.length);
    return [name, { mean: +mean.toFixed(3), sd: +sd.toFixed(3) }];
  }));
}

// Paired statistics of a - b over games.
function paired(a, b) {
  const d = a.map((x, i) => x - b[i]);
  const n = d.length;
  const mean = d.reduce((s, x) => s + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  const se = sd / Math.sqrt(n);
  return { mean: +mean.toFixed(2), se: +se.toFixed(2), z: se > 0 ? +(mean / se).toFixed(2) : 0, wins: d.filter((x) => x > 0).length, n };
}
const average = (xs) => +(xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(2);

// Per-game outcomes of one evaluation file, keyed by game.
function outcomes8k(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).episodes_detail.map((e) => ({
    key: `${e.seed}:${e.scenario}`, pop: Number(e.pop || 0), extinct: Number(e.pop || 0) === 0,
    avoidable: Object.entries(e.deaths_by_cause || {}).filter(([k]) => k !== 'oldAge').reduce((s, [, v]) => s + Number(v || 0), 0),
  }));
}
function outcomes20k(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).episodes.map((e) => e.summary).sort((a, b) => a.seed - b.seed)
    .map((s) => ({ key: String(s.seed), pop: s.final_pop, extinct: s.extinction_tick !== null, avoidable: s.avoidable_deaths }));
}

// Compare a list of replicate outcome sets with the council on the same games.
function compare(council, replicates) {
  const keys = council.map((g) => g.key);
  const align = (set) => keys.map((k) => set.find((g) => g.key === k));
  const perRep = replicates.map((set) => {
    const games = align(set);
    return { pop: average(games.map((g) => g.pop)), vsCouncil: paired(games.map((g) => g.pop), council.map((g) => g.pop)),
      avoidable: average(games.map((g) => g.avoidable)), extinctions: games.filter((g) => g.extinct).length };
  });
  const pooledPop = keys.map((_, i) => average(replicates.map((set) => align(set)[i].pop)));
  return {
    council: { pop: average(council.map((g) => g.pop)), avoidable: average(council.map((g) => g.avoidable)), extinctions: council.filter((g) => g.extinct).length },
    replicates: perRep,
    pooled: { pop: average(pooledPop), vsCouncil: paired(pooledPop, council.map((g) => g.pop)),
      replicateSd: +Math.sqrt(perRep.map((r) => r.pop).reduce((s, x, _, xs) => s + (x - average(xs)) ** 2, 0) / Math.max(1, perRep.length - 1)).toFixed(2) },
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(options.session, { recursive: true });
  const evalConfig = ensureEvalConfig(options.session);
  const council8k = path.join(options.session, 'council_eval8k.json');
  const council20k = path.join(options.session, 'council_standard20k.json');
  eval8k('default', council8k, evalConfig, options);
  eval20k('default', council20k, options);

  const sets = [...options.sets];
  if (options.workers) sets.push(`workers=${options.workers}`);
  const reps = [];
  for (let rep = 1; rep <= options.reps; rep += 1) {
    const dir = path.join(options.session, `${options.name}_r${rep}`);
    if (fs.existsSync(dir) && !fs.existsSync(path.join(dir, 'run.json'))) {
      console.log(`[replicates] ${path.basename(dir)} was interrupted; restarting it`);
      fs.rmSync(dir, { recursive: true, force: true });
    }
    if (!fs.existsSync(path.join(dir, 'run.json'))) {
      run(process.execPath, [path.join('scripts', 'train_recipe.js'), '--out', dir, '--rep', String(rep),
        ...(options.bank ? ['--bank', options.bank] : []), ...sets.flatMap((s) => ['--set', s])]);
    }
    const policy = path.join(dir, 'p.json');
    eval8k(policy, path.join(dir, 'eval8k.json'), evalConfig, options);
    eval20k(`policy:${policy}`, path.join(dir, 'standard20k.json'), options);
    const runInfo = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
    reps.push({ rep, dir, levers: runInfo.bank ? leverReadout(policy, path.resolve(ROOT, runInfo.bank)) : null,
      seconds: runInfo.timing.reduce((s, t) => s + t.seconds, 0) });
  }

  const summary = {
    name: options.name, sets: options.sets, host: os.hostname(), finishedAt: new Date().toISOString(),
    ticks8k: compare(outcomes8k(council8k), reps.map((r) => outcomes8k(path.join(r.dir, 'eval8k.json')))),
    ticks20k: compare(outcomes20k(council20k), reps.map((r) => outcomes20k(path.join(r.dir, 'standard20k.json')))),
    levers: reps.map((r) => ({ rep: r.rep, ...r.levers })),
    trainingSeconds: reps.map((r) => Math.round(r.seconds)),
  };
  const out = path.join(options.session, `${options.name}_summary.json`);
  fs.writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  for (const horizon of ['ticks8k', 'ticks20k']) {
    const h = summary[horizon];
    console.log(`${horizon}: council pop ${h.council.pop} (ext ${h.council.extinctions}) | pooled ${h.pooled.pop} vs council ${h.pooled.vsCouncil.mean} (SE ${h.pooled.vsCouncil.se}, z ${h.pooled.vsCouncil.z}, wins ${h.pooled.vsCouncil.wins}/${h.pooled.vsCouncil.n}), replicate SD ${h.pooled.replicateSd}`);
    h.replicates.forEach((r, i) => console.log(`  r${i + 1}: pop ${r.pop} vs council ${r.vsCouncil.mean} (z ${r.vsCouncil.z}), avoidable ${r.avoidable}, extinctions ${r.extinctions}`));
  }
  console.log(`[replicates] summary written to ${path.relative(ROOT, out)}`);
}

try {
  main();
} catch (error) {
  console.error(`[replicates] ${error.message}`);
  process.exit(1);
}
