#!/usr/bin/env node
'use strict';

// Replicated recipe runs judged against the council, or against an incumbent policy for chained runs
// (STRATEGY.md protocol, steps T and S5). One command,
// resumable: every finished step is kept and skipped on the next call, an interrupted training run is
// restarted from scratch (runs are deterministic, so nothing is lost but time).
//
//   node experiments/replicates.js --session experiments/runs/<date>_<topic> --name <variant> \
//     [--reps 3] [--set <recipe path>=<json>]... [--workers 7] [--bank <existing bank dir>]
//     [--eval-set <ai.evaluation path>=<json>]...   (e.g. horizons.0.ticks=400 for smoke tests)
//     [--from <policy.json>]      chained runs: every replicate starts from this policy (train_recipe --from)
//     [--against <policy.json>]   pool and gate against this policy as well as the council
//     [--no-early-stop]           train every replicate even when all finished ones are clearly behind
//
// Evaluation follows ai.evaluation: with `staged` a replicate that fails the 8k gate test is not played
// at 20k; with `earlyStopZ` the run stops once every finished replicate has 8k rpp z <= earlyStopZ against
// the comparator (add --eval-set staged=false for full scorecards).
//
// Per replicate: training through scripts/train_recipe.js (the snapshot bank is built and cached on
// first use), the scorecard of scripts/scorecard.js on every ai.evaluation horizon (the council is
// played once and cached), and the policy's deterministic lever choices on bank states. The summary
// per replicate and pooled over replicates goes to <session>/<name>_summary.json, with the promotion
// gate verdict of every replicate against the --against policy (or the council).
//
// Examples (a gamma variant of the default recipe; chained runs from the promoted policy):
//   node experiments/replicates.js --session experiments/runs/<date>_<id> --name gamma998 \
//     --set gamma=0.998
//   node experiments/replicates.js --session experiments/runs/<date>_<id> --name chain \
//     --from models/policy_best.json --against models/policy_best.json

const fs = require('fs');
const os = require('os');
const path = require('path');
const v8 = require('v8');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const { scorecard, paired, gateDecision } = require(path.join(ROOT, 'scripts', 'scorecard.js'));
const PYTHON = path.join(ROOT, '.venv', 'bin', 'python');

function parseArgs(argv) {
  const options = { reps: 3, sets: [], evalSets: [], workers: null, bank: null, from: null, against: null, noEarlyStop: false };
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
    else if (arg === '--from') options.from = path.resolve(next());
    else if (arg === '--against') options.against = path.resolve(next());
    else if (arg === '--no-early-stop') options.noEarlyStop = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  if (!options.session || !options.name) throw new Error('--session and --name are required');
  if (options.bank && options.from) throw new Error('--bank and --from are exclusive (a chained run builds its own bank)');
  for (const file of [options.from, options.against]) if (file && !fs.existsSync(file)) throw new Error(`${file} does not exist`);
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

// Outcome summary of one player's games.
const players = (games) => ({ pop: average(games.map((g) => g.pop)), latePop: average(games.map((g) => g.latePop)),
  avoidable: average(games.map((g) => g.avoidable)), extinctions: games.filter((g) => g.extinct).length });

// Pool the replicate scorecards that played one horizon (a staged scorecard skips the long horizon after
// a failed gate test): per replicate and mean-over-replicates paired with the council and, for chained
// runs, with the incumbent policy.
function pool(entries, horizon) {
  const played = entries.filter(({ card }) => card.horizons[horizon]);
  const cards = played.map(({ card }) => card);
  const council = cards[0].horizons[horizon].outcomes.council;
  const against = cards[0].horizons[horizon].outcomes.against || null;
  const perRep = played.map(({ rep, card }) => {
    const h = card.horizons[horizon];
    const row = { rep, pop: +h.policy.pop.toFixed(2), latePop: +h.policy.latePop.toFixed(2), vsCouncil: round(h.vsCouncil.pop),
      lateVsCouncil: round(h.vsCouncil.latePop), rppVsCouncil: round(h.vsCouncil.rpp),
      avoidable: +h.policy.avoidable.toFixed(2), extinctions: h.policy.extinctions };
    if (against) Object.assign(row, { vsAgainst: round(h.vsAgainst.pop), lateVsAgainst: round(h.vsAgainst.latePop),
      rppVsAgainst: round(h.vsAgainst.rpp) });
    return row;
  });
  const pooledPop = council.map((_, i) => average(cards.map((card) => card.horizons[horizon].outcomes.policy[i].pop)));
  const pop = perRep.map((r) => r.pop);
  const result = {
    council: players(council),
    replicates: perRep,
    pooled: { pop: average(pooledPop), vsCouncil: round(paired(pooledPop, council.map((g) => g.pop))),
      replicateSd: +Math.sqrt(pop.reduce((s, x) => s + (x - average(pop)) ** 2, 0) / Math.max(1, pop.length - 1)).toFixed(2) },
  };
  if (against) {
    result.against = players(against);
    result.pooled.vsAgainst = round(paired(pooledPop, against.map((g) => g.pop)));
  }
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(options.session, { recursive: true });
  const sets = [...options.sets];
  if (options.workers) sets.push(`workers=${options.workers}`);
  const reps = [];
  const cards = [];
  let stoppedEarly = null;
  for (let rep = 1; rep <= options.reps; rep += 1) {
    const dir = path.join(options.session, `${options.name}_r${rep}`);
    if (fs.existsSync(dir) && !fs.existsSync(path.join(dir, 'run.json'))) {
      console.log(`[replicates] ${path.basename(dir)} was interrupted; restarting it`);
      fs.rmSync(dir, { recursive: true, force: true });
    }
    if (!fs.existsSync(path.join(dir, 'run.json'))) {
      run(process.execPath, [path.join('scripts', 'train_recipe.js'), '--out', dir, '--rep', String(rep),
        ...(options.bank ? ['--bank', options.bank] : []), ...(options.from ? ['--from', options.from] : []),
        ...sets.flatMap((s) => ['--set', s])]);
    }
    const policy = path.join(dir, 'p.json');
    // The council and finished replicates come from the scorecard cache on later calls.
    const card = await scorecard({ policy, against: options.against || 'council', sets: options.evalSets, workers: options.workers || 7 });
    card.gate = gateDecision(card.horizons, card.settings.gate);
    fs.writeFileSync(path.join(dir, 'scorecard.json'), `${JSON.stringify(card, null, 1)}\n`);
    cards.push(card);
    const runInfo = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
    reps.push({ rep, dir, card, gate: card.gate, levers: runInfo.bank ? leverReadout(policy, path.resolve(ROOT, runInfo.bank)) : null,
      seconds: runInfo.timing.reduce((s, t) => s + t.seconds, 0) });
    // Early stop (ai.evaluation.earlyStopZ): when every replicate so far is clearly behind the comparator
    // on the gate horizon's rpp, further replicates of the same recipe are not worth their training time.
    const stopZ = card.settings.earlyStopZ;
    const behind = reps.every((r) => r.card.horizons[r.card.settings.gate.horizon].vsAgainst.rpp.z <= stopZ);
    if (rep < options.reps && !options.noEarlyStop && behind) {
      stoppedEarly = { afterRep: rep, earlyStopZ: stopZ };
      console.log(`[replicates] stopping after r${rep}: every replicate so far has ${card.settings.gate.horizon} rpp z <= ${stopZ} vs ${card.against}`);
      break;
    }
  }

  const horizons = [...new Set(cards.flatMap((card) => Object.keys(card.horizons)))];
  const summary = {
    name: options.name, sets: options.sets, evalSets: options.evalSets, host: os.hostname(), finishedAt: new Date().toISOString(),
    from: options.from && path.relative(ROOT, options.from), against: cards[0].against,
    stoppedEarly,
    horizons: Object.fromEntries(horizons.map((h) => [h, pool(reps, h)])),
    gate: reps.map((r) => ({ rep: r.rep, pass: r.gate.pass, lowerBound: +r.gate.lowerBound.toFixed(4), reasons: r.gate.reasons })),
    levers: reps.map((r) => ({ rep: r.rep, ...r.levers })),
    trainingSeconds: reps.map((r) => Math.round(r.seconds)),
  };
  const out = path.join(options.session, `${options.name}_summary.json`);
  fs.writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  for (const horizon of horizons) {
    const h = summary.horizons[horizon];
    console.log(`${horizon}: council pop ${h.council.pop} (ext ${h.council.extinctions}) | pooled ${h.pooled.pop} vs council ${h.pooled.vsCouncil.mean} (SE ${h.pooled.vsCouncil.se}, z ${h.pooled.vsCouncil.z}, wins ${h.pooled.vsCouncil.wins}/${h.pooled.vsCouncil.n}), replicate SD ${h.pooled.replicateSd}`);
    if (h.against) console.log(`  ${summary.against}: pop ${h.against.pop} (ext ${h.against.extinctions}) | pooled vs it ${h.pooled.vsAgainst.mean} (SE ${h.pooled.vsAgainst.se}, z ${h.pooled.vsAgainst.z}, wins ${h.pooled.vsAgainst.wins}/${h.pooled.vsAgainst.n})`);
    h.replicates.forEach((r) => console.log(`  r${r.rep}: pop ${r.pop} vs council ${r.vsCouncil.mean} (z ${r.vsCouncil.z}), late pop ${r.latePop} vs council ${r.lateVsCouncil.mean} (z ${r.lateVsCouncil.z})`
      + (r.vsAgainst ? `, vs ${summary.against} ${r.vsAgainst.mean} (z ${r.vsAgainst.z}) late ${r.lateVsAgainst.mean} (z ${r.lateVsAgainst.z})` : '') + `, avoidable ${r.avoidable}, extinctions ${r.extinctions}`));
  }
  summary.gate.forEach((g) => console.log(`gate r${g.rep} vs ${summary.against}: ${g.pass ? 'PASS' : 'FAIL'} (8k LCB ${g.lowerBound})${g.reasons.length ? ` - ${g.reasons.join('; ')}` : ''}`));
  console.log(`[replicates] summary written to ${path.relative(ROOT, out)}`);
}

main().catch((error) => {
  console.error(`[replicates] ${error.message}`);
  process.exit(1);
});
