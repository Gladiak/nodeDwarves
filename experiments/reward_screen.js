#!/usr/bin/env node
'use strict';
/*
Offline reward screen (STRATEGY.md T5, long horizon). Measurement only: never writes models/ or config.json.

1. --record: plays every player on the 20,000-tick standard horizon of the scorecard (same seeds and
   cadence as scripts/scorecard.js) through experiments/challenge_probe.js and stores, per decision
   step, the outcome-reward signals plus the age structure (challenge_probe `recordSignals`). One gzip
   file per player in the session folder; finished players are skipped, so recording is resumable.
2. --screen: replays candidate rewards on the recorded signals (seconds) and asks whether each
   candidate ranks players and games the way the long-horizon goal does: final population at 20,000
   ticks (0 after extinction). It reports, per candidate, the share of same-seed game pairs where the
   reward difference and the goal difference agree in sign, Kendall tau of player means, and the paired
   reward delta of the council against every policy player. Returns are measured undiscounted and
   discounted with the recipe gamma from several start ticks (what a critic sees from mid-game states),
   plus an 8,000-tick check against population at 8,000 ticks.

Usage:
  node experiments/reward_screen.js --session experiments/runs/<session> --record
    [--players default,gov:2,random,neglect,policy:<file>,...] [--games 32] [--ticks 20000] [--workers 7]
  node experiments/reward_screen.js --session experiments/runs/<session> --screen [--starts 0,4000,8000,12000]
*/
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const probe = require(path.join(__dirname, 'challenge_probe.js'));
const { horizonOptions, evaluationSettings, paired } = require(path.join(ROOT, 'scripts', 'scorecard.js'));
const { loadConfig } = require(path.join(ROOT, 'src', 'config'));
const { getOutcomeRewardSettings } = require(path.join(ROOT, 'src', 'ai', 'outcome_reward'));

function parseArgs(argv) {
  const options = { session: null, record: false, screen: false, players: 'default,gov:2,random,neglect',
    games: 32, ticks: 20000, workers: 7, starts: '0,4000,8000,12000' };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'record' || key === 'screen') { options[key] = true; continue; }
    if (!(key in options)) throw new Error(`Unknown option ${argv[i]}`);
    options[key] = argv[i + 1];
    i += 1;
  }
  for (const key of ['games', 'ticks', 'workers']) options[key] = Number(options[key]);
  if (!options.session || (!options.record && !options.screen)) throw new Error('--session and --record or --screen are required');
  options.session = path.resolve(options.session);
  return options;
}

const slug = (player) => player.replace(/^policy:/, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(-60);

// Play each player once on the long horizon and store its per-decision signals.
async function record(options) {
  const configFile = path.join(ROOT, 'config.json');
  const config = loadConfig(configFile);
  const settings = evaluationSettings(config);
  const horizon = { ...settings.horizons.find((h) => h.plan === 'standard'), ticks: options.ticks, games: options.games };
  fs.mkdirSync(options.session, { recursive: true });
  for (const player of options.players.split(',').map((p) => p.trim()).filter(Boolean)) {
    const file = path.join(options.session, `signals_${slug(player)}.json.gz`);
    if (fs.existsSync(file)) { console.log(`[reward-screen] ${player}: recorded already`); continue; }
    const probeOptions = { ...horizonOptions(horizon, settings, configFile, options.workers), players: player, recordSignals: true };
    const tasks = probe.buildTasks(probeOptions, config);
    const started = Date.now();
    const episodes = await probe.runPool(tasks, probeOptions);
    episodes.sort((a, b) => a.seed - b.seed);
    const payload = { player, horizon, rewardSettings: getOutcomeRewardSettings(config), fields: episodes[0].signalFields,
      games: episodes.map((e) => ({ seed: e.seed, final: e.summary.final_pop, extinct: e.extinctionTick,
        score: e.summary.outcome_score, rows: e.signals })) };
    fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(payload)));
    console.log(`[reward-screen] ${player}: ${episodes.length} games in ${Math.round((Date.now() - started) / 1000)}s -> ${path.basename(file)}`);
  }
}

// Candidate rewards: step(prev, cur, ctx) on named signal rows; ctx carries the outcome weights and a
// per-game memory (peak population per cycle, for recordings made before the peak was a signal).
// Candidates are defined on the outcome reward of E46 (`v1`: no drawdown, extinction 20); `recorded`
// replays each file with the weights it was recorded under and must reproduce the probe score.
const gain = (current, previous) => (current >= previous ? current - previous : current);
function baseTerms(prev, cur, w) {
  return {
    population: w.population * (cur.pop / w.populationScale),
    deaths: -w.deaths * gain(cur.avoidableDeaths, prev.avoidableDeaths),
    distress: -w.distress * cur.distressShare,
    reserves: cur.pop > 0 ? w.reserves * cur.reserve : 0,
    progress: w.depth * gain(cur.depth, prev.depth) + w.landmarkStage * gain(cur.landmarkStages, prev.landmarkStages)
      + w.prestige * gain(cur.prestige, prev.prestige),
    extinction: cur.pop === 0 && prev.pop > 0 ? -w.extinction : 0,
  };
}
const sum = (terms) => Object.values(terms).reduce((a, b) => a + b, 0);
// One candidate from options: `extinction` replaces the extinction weight; `drawdown` k charges
// k x (running peak of the current cycle - population) / populationScale per step, so a bust after a
// boom costs; `life` counts the population term in remaining lifetime (a dwarf with its whole life
// ahead counts `life`, one at the maximum age 0), so an ageing cohort loses value before it dies;
// `sqrt` makes the population term concave, shrinking what a boom adds.
function candidate({ extinction = null, drawdown = 0, life = 0, sqrt = false, fromWeights = false } = {}) {
  return (prev, cur, ctx) => {
    const t = baseTerms(prev, cur, ctx.w);
    if (extinction !== null && t.extinction) t.extinction = -extinction;
    if (life) t.population = ctx.w.population * life * (cur.lifeAhead / ctx.w.populationScale);
    else if (sqrt) t.population = ctx.w.population * Math.sqrt(cur.pop / ctx.w.populationScale);
    let total = sum(t);
    const k = drawdown || (fromWeights ? ctx.w.drawdown || 0 : 0);
    if (k) {
      if (cur.cycle !== ctx.memory.cycle) { ctx.memory.cycle = cur.cycle; ctx.memory.peak = 0; }
      ctx.memory.peak = Math.max(ctx.memory.peak || 0, cur.pop);
      const peak = Number.isFinite(cur.peak) ? cur.peak : ctx.memory.peak;
      if (peak > cur.pop) total -= k * (peak - cur.pop) / ctx.w.populationScale;
    }
    return total;
  };
}

const V1 = { extinction: 20, drawdown: 0 };
const CANDIDATES = {
  recorded: candidate({ fromWeights: true }),
  v1: candidate(),
  ext_200: candidate({ extinction: 200 }),
  ext_1000: candidate({ extinction: 1000 }),
  ext_2000: candidate({ extinction: 2000 }),
  ext_5000: candidate({ extinction: 5000 }),
  drawdown_0_5: candidate({ drawdown: 0.5 }),
  drawdown_1: candidate({ drawdown: 1 }),
  drawdown_2: candidate({ drawdown: 2 }),
  drawdown_0_5_ext_2000: candidate({ drawdown: 0.5, extinction: 2000 }),
  drawdown_1_ext_1000: candidate({ drawdown: 1, extinction: 1000 }),
  drawdown_1_ext_2000: candidate({ drawdown: 1, extinction: 2000 }),
  drawdown_1_ext_5000: candidate({ drawdown: 1, extinction: 5000 }),
  life_2: candidate({ life: 2 }),
  life_2_ext_1000: candidate({ life: 2, extinction: 1000 }),
  life_2_drawdown_1_ext_2000: candidate({ life: 2, drawdown: 1, extinction: 2000 }),
  sqrt: candidate({ sqrt: true }),
  sqrt_ext_1000: candidate({ sqrt: true, extinction: 1000 }),
};
CANDIDATES.recorded.recorded = true;

// Per-step rewards of one game under a candidate, as [tick, reward] pairs; nothing after extinction.
function stepRewards(game, fields, reward, w) {
  const rows = game.rows.map((row) => Object.fromEntries(fields.map((f, i) => [f, row[i]])));
  const ctx = { w: reward.recorded ? w : { ...w, ...V1 }, memory: {} };
  const out = [];
  for (let i = 1; i < rows.length; i += 1) out.push([rows[i].tick, reward(rows[i - 1], rows[i], ctx)]);
  return { steps: out, rows };
}

// Discounted return from the first step at or after `start` (gamma per decision step).
function discounted(steps, start, gamma) {
  let total = 0;
  let factor = 1;
  for (const [tick, reward] of steps) {
    if (tick <= start) continue;
    total += factor * reward;
    factor *= gamma;
  }
  return total;
}

function popAt(rows, tick) {
  let pop = rows[0].pop;
  for (const row of rows) { if (row.tick > tick) break; pop = row.pop; }
  return pop;
}

function kendall(a, b) {
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = i + 1; j < a.length; j += 1) {
      const s = Math.sign(a[i] - a[j]) * Math.sign(b[i] - b[j]);
      if (s > 0) concordant += 1; else if (s < 0) discordant += 1;
    }
  }
  return concordant + discordant ? (concordant - discordant) / (concordant + discordant) : 0;
}

// Share of same-seed pairs of players whose reward difference has the sign of the goal difference.
function pairAgreement(values, goals) {
  let agree = 0;
  let total = 0;
  const players = Object.keys(values);
  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      const a = players[i];
      const b = players[j];
      values[a].forEach((value, g) => {
        const dg = goals[a][g] - goals[b][g];
        if (dg === 0) return;
        total += 1;
        if (Math.sign(value - values[b][g]) === Math.sign(dg)) agree += 1;
      });
    }
  }
  return total ? agree / total : 0;
}

function screen(options) {
  const config = loadConfig(path.join(ROOT, 'config.json'));
  const w = getOutcomeRewardSettings(config);
  const gamma = Number(config.ai.training.recipe.gamma);
  const starts = options.starts.split(',').map(Number);
  const files = fs.readdirSync(options.session).filter((f) => /^signals_.*\.json\.gz$/.test(f)).sort();
  const data = files.map((f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(options.session, f)))));
  if (data.length < 2) throw new Error('record at least two players first');
  const seeds = data[0].games.map((g) => g.seed).join(',');
  for (const d of data) if (d.games.map((g) => g.seed).join(',') !== seeds) throw new Error(`${d.player}: different games`);
  const names = data.map((d) => d.player.replace(/^policy:.*\/([^/]+)\/p\.json$/, '$1'));
  const ticks = data[0].horizon.ticks;
  const goal20 = Object.fromEntries(data.map((d, i) => [names[i], d.games.map((g) => (g.extinct !== null ? 0 : g.final))]));
  const goal8 = {};
  console.log(`[reward-screen] ${data.length} players x ${data[0].games.length} games, ${ticks} ticks, gamma ${gamma} per decision`);
  console.log('players: ' + names.map((n) => `${n} (pop ${(goal20[n].reduce((a, b) => a + b, 0) / goal20[n].length).toFixed(0)}, `
    + `ext ${data[names.indexOf(n)].games.filter((g) => g.extinct !== null).length})`).join(', '));
  const council = names.indexOf('default');
  const report = { session: options.session, gamma, starts, players: names, candidates: {} };
  const header = ['candidate', 'agree20', 'tau20', ...starts.map((s) => `agr@${s / 1000}k`), 'agree8', 'council-policies (z)'];
  console.log(header.join(' | '));
  for (const [name, reward] of Object.entries(CANDIDATES)) {
    const total = {};
    const total8 = {};
    const disc = Object.fromEntries(starts.map((s) => [s, {}]));
    data.forEach((d, i) => {
      const key = names[i];
      total[key] = [];
      total8[key] = [];
      goal8[key] = [];
      for (const s of starts) disc[s][key] = [];
      for (const game of d.games) {
        const { steps, rows } = stepRewards(game, d.fields, reward, d.rewardSettings || { ...w, ...V1 });
        total[key].push(steps.reduce((a, [, r]) => a + r, 0));
        total8[key].push(steps.filter(([t]) => t <= 8000).reduce((a, [, r]) => a + r, 0));
        goal8[key].push(popAt(rows, 8000));
        for (const s of starts) disc[s][key].push(discounted(steps, s, gamma));
      }
    });
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const entry = {
      agree20: pairAgreement(total, goal20),
      tau20: kendall(names.map((n) => mean(total[n])), names.map((n) => mean(goal20[n]))),
      discountedAgreement: Object.fromEntries(starts.map((s) => [s, pairAgreement(disc[s], goal20)])),
      agree8: pairAgreement(total8, goal8),
      councilVsPolicies: {},
    };
    if (council >= 0) {
      for (const n of names.filter((x) => x !== 'default' && data[names.indexOf(x)].player.startsWith('policy:'))) {
        const p = paired(total.default, total[n]);
        entry.councilVsPolicies[n] = { mean: +(p.mean / (ticks / 10)).toFixed(4), z: +p.z.toFixed(2) };
      }
    }
    if (name === 'recorded') {
      // The replay must reproduce the probe's own outcome score, or the screen measures something else.
      const worst = Math.max(...data.flatMap((d, i) => d.games.map((g, k) => Math.abs(total[names[i]][k] / ticks - g.score))));
      if (worst > 1e-9) throw new Error(`recorded replay differs from the probe outcome score by ${worst}`);
    }
    report.candidates[name] = entry;
    console.log([name.padEnd(20), entry.agree20.toFixed(3), entry.tau20.toFixed(2),
      ...starts.map((s) => entry.discountedAgreement[s].toFixed(3)), entry.agree8.toFixed(3),
      Object.entries(entry.councilVsPolicies).map(([n, v]) => `${n} ${v.z >= 0 ? '+' : ''}${v.z}`).join(' ')].join(' | '));
  }
  const out = path.join(options.session, 'reward_screen.json');
  fs.writeFileSync(out, `${JSON.stringify(report, null, 1)}\n`);
  console.log(`[reward-screen] wrote ${path.relative(ROOT, out)}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.record) await record(options);
  if (options.screen) screen(options);
}

if (require.main === module) main().catch((error) => { console.error(`[reward-screen] ${error.message}`); process.exit(1); });
