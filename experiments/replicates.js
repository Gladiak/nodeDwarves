#!/usr/bin/env node
'use strict';

// Replicated recipe runs judged against the council (STRATEGY.md protocol, step T). One command,
// resumable: every finished step is kept and skipped on the next call, an interrupted training run is
// restarted from scratch (runs are deterministic, so nothing is lost but time).
//
//   node experiments/replicates.js --session experiments/runs/<date>_<topic> --name <variant> \
//     [--reps 3] [--set <recipe path>=<json>]... [--workers 7] [--bank <existing bank dir>]
//     [--eval-set <ai.evaluation path>=<json>]...   (e.g. horizons.0.ticks=400 for smoke tests)
//
// Per replicate: training through scripts/train_recipe.js (the snapshot bank is built and cached on
// first use), the scorecard of scripts/scorecard.js on every ai.evaluation horizon (the council is
// played once and cached), and the policy's deterministic lever choices on bank states. The summary
// per replicate and pooled over replicates goes to <session>/<name>_summary.json.
//
// Example (a gamma variant of the default recipe):
//   node experiments/replicates.js --session experiments/runs/<date>_<id> --name gamma998 \
//     --set gamma=0.998

const fs = require('fs');
const os = require('os');
const path = require('path');
const v8 = require('v8');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const { scorecard, paired } = require(path.join(ROOT, 'scripts', 'scorecard.js'));
const PYTHON = path.join(ROOT, '.venv', 'bin', 'python');

function parseArgs(argv) {
  const options = { reps: 3, sets: [], evalSets: [], workers: null, bank: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--session') options.session = path.resolve(next());
    else if (arg === '--name') options.name = next();
    else if (arg === '--reps') options.reps = Number(next());
    else if (arg === '--set') options.sets.push(next());
    else if (arg === '--workers') options.workers = Number(next());
    else if (arg === '--eval-set') options.evalSets.push(next());
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

const average = (xs) => +(xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(2);
const round = (p) => ({ mean: +p.mean.toFixed(4), se: +p.se.toFixed(4), z: +p.z.toFixed(2), wins: p.wins, n: p.n });

// Pool replicate scorecards of one horizon: per replicate and mean-over-replicates paired with the council.
function pool(cards, horizon) {
  const council = cards[0].horizons[horizon].outcomes.council;
  const perRep = cards.map((card) => {
    const h = card.horizons[horizon];
    return { pop: +h.policy.pop.toFixed(2), vsCouncil: round(h.vsCouncil.pop), rppVsCouncil: round(h.vsCouncil.rpp),
      avoidable: +h.policy.avoidable.toFixed(2), extinctions: h.policy.extinctions };
  });
  const pooledPop = council.map((_, i) => average(cards.map((card) => card.horizons[horizon].outcomes.policy[i].pop)));
  const pop = perRep.map((r) => r.pop);
  return {
    council: { pop: average(council.map((g) => g.pop)), avoidable: average(council.map((g) => g.avoidable)), extinctions: council.filter((g) => g.extinct).length },
    replicates: perRep,
    pooled: { pop: average(pooledPop), vsCouncil: round(paired(pooledPop, council.map((g) => g.pop))),
      replicateSd: +Math.sqrt(pop.reduce((s, x) => s + (x - average(pop)) ** 2, 0) / Math.max(1, pop.length - 1)).toFixed(2) },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(options.session, { recursive: true });
  const sets = [...options.sets];
  if (options.workers) sets.push(`workers=${options.workers}`);
  const reps = [];
  const cards = [];
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
    // The council and finished replicates come from the scorecard cache on later calls.
    const card = await scorecard({ policy, against: 'council', sets: options.evalSets, workers: options.workers || 7 });
    fs.writeFileSync(path.join(dir, 'scorecard.json'), `${JSON.stringify(card, null, 1)}\n`);
    cards.push(card);
    const runInfo = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
    reps.push({ rep, dir, levers: runInfo.bank ? leverReadout(policy, path.resolve(ROOT, runInfo.bank)) : null,
      seconds: runInfo.timing.reduce((s, t) => s + t.seconds, 0) });
  }

  const horizons = Object.keys(cards[0].horizons);
  const summary = {
    name: options.name, sets: options.sets, evalSets: options.evalSets, host: os.hostname(), finishedAt: new Date().toISOString(),
    horizons: Object.fromEntries(horizons.map((h) => [h, pool(cards, h)])),
    levers: reps.map((r) => ({ rep: r.rep, ...r.levers })),
    trainingSeconds: reps.map((r) => Math.round(r.seconds)),
  };
  const out = path.join(options.session, `${options.name}_summary.json`);
  fs.writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  for (const horizon of horizons) {
    const h = summary.horizons[horizon];
    console.log(`${horizon}: council pop ${h.council.pop} (ext ${h.council.extinctions}) | pooled ${h.pooled.pop} vs council ${h.pooled.vsCouncil.mean} (SE ${h.pooled.vsCouncil.se}, z ${h.pooled.vsCouncil.z}, wins ${h.pooled.vsCouncil.wins}/${h.pooled.vsCouncil.n}), replicate SD ${h.pooled.replicateSd}`);
    h.replicates.forEach((r, i) => console.log(`  r${i + 1}: pop ${r.pop} vs council ${r.vsCouncil.mean} (z ${r.vsCouncil.z}), avoidable ${r.avoidable}, extinctions ${r.extinctions}`));
  }
  console.log(`[replicates] summary written to ${path.relative(ROOT, out)}`);
}

main().catch((error) => {
  console.error(`[replicates] ${error.message}`);
  process.exit(1);
});
