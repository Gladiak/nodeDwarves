'use strict';
/*
Challenge probe: how hard is the game, and how much does play quality matter?

Runs episodes in-process (no Python, no ai_server IPC) and samples, every --sample-every ticks:
population, stock/target ratios, gross stock inflow and outflow per resource (exact, via a
read-only Proxy on state.stockpile), reserve autonomy (stock / recent outflow per tick), labor mix
and deaths by cause. Measurement only: it never writes models/ or config.json.

Two plans:
  --plan standard  the npm start game (config.json, no AI), headless benchmark seeds and layout.
  --plan eval      the training eval scenarios of a session config (same reset as eval_paired.py:
                   training + eval overrides, scenario overrides, no randomization, difficulty 1).

Players: default (no action fields), const:X, random (uniform [min,max] per decision),
neglect (food/water weights 0.05, wood/stone 2, governors on defaults), gov:X (default job weights,
every festival/governor head set to X), policy:<file> (a trained policy JSON run with the game's own
JS inference, src/ai/policy.js, deterministic mean action).

Example:
  node experiments/challenge_probe.js --plan eval \
    --config experiments/runs/2026-11-24_vs_default/configs/config_endgame.json \
    --players default,const:0,random,neglect --ticks 8000 --out <dir>/challenge_eval.json
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
// Optional config-read tracing for the config audit (scripts/config_trace.js); inert by default.
const configTrace = process.env.CONFIG_TRACE_OUT ? require(path.join(__dirname, '..', 'scripts', 'config_trace.js')) : null;

const ROOT = path.resolve(__dirname, '..');
const TRACKED = ['food', 'water', 'beer', 'wood', 'stone'];
const GOVERNOR_FIELDS = {
  trade: ['reserveRatioBias', 'contestIntent', 'opportunityIntent'],
  building: ['housingWeight', 'economyWeight', 'defenseWeight', 'specialWeight', 'mineBias', 'upgradeBias'],
  contracts: ['commitIntent'],
  ruins: ['warningDispatchIntent', 'mithrilReinforcementIntent'],
  underrealm: ['surfaceReserveBias', 'depthAllocationBias', 'minerMixBias', 'haulerMixBias', 'guardMixBias'],
  externalCamps: ['militiaSupportIntent', 'raiderTributeIntent'],
  social: ['mediationBias', 'mentorshipBias', 'accountabilityBias'],
  warriors: ['trainingIntent', 'rotationIntent', 'tournamentRiskIntent', 'championChallengeIntent',
    'recoveryPriorityIntent'],
};

// Same generator as ai_server.js and headless_benchmark.js.
function mulberry32(seed) {
  let t = Number(seed) >>> 0;
  return function random() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function parseArgs(argv) {
  const options = { plan: 'eval', config: null, players: 'default', ticks: 8000, sampleEvery: 250,
    workers: 7, seeds: '101,202,303,404', seedBase: 100000, episodes: 12, stepTicks: 2, out: null, set: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (key === 'set') options.set.push(argv[i + 1]);
    else options[key] = argv[i + 1];
    i += 1;
  }
  for (const key of ['ticks', 'sampleEvery', 'workers', 'seedBase', 'episodes', 'stepTicks']) {
    options[key] = Number(options[key]);
  }
  if (!options.out) throw new Error('--out is required');
  return options;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeDeep(target, source) {
  if (!isPlainObject(source)) return target;
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) target[key] = value.slice();
    else if (isPlainObject(value)) target[key] = mergeDeep(isPlainObject(target[key]) ? target[key] : {}, value);
    else target[key] = value;
  }
  return target;
}

// Mirror of ai_server buildScenarioConfig for eval resets (randomize false, difficulty 1).
function buildEvalConfig(base, scenarioName) {
  const config = JSON.parse(JSON.stringify(base));
  const training = (base.ai && base.ai.training) || {};
  config.ai = config.ai || {};
  config.ai.difficulty = 1;
  if (isPlainObject(training.configOverrides)) mergeDeep(config, training.configOverrides);
  if (isPlainObject(training.evalOverrides)) mergeDeep(config, training.evalOverrides);
  const scenario = (training.scenarios || []).find((entry) => entry && entry.name === scenarioName);
  if (scenarioName && !scenario) throw new Error(`unknown scenario ${scenarioName}`);
  if (scenario && scenario.overrides) mergeDeep(config, scenario.overrides);
  return config;
}

// Apply `--set path=value` overrides (JSON values) to the final effective config of an episode.
function applySets(config, sets) {
  for (const entry of sets || []) {
    const index = entry.indexOf('=');
    const keys = entry.slice(0, index).split('.');
    let value = entry.slice(index + 1);
    try { value = JSON.parse(value); } catch (error) { /* keep raw string */ }
    let node = config;
    for (const key of keys.slice(0, -1)) {
      if (!isPlainObject(node[key])) node[key] = {};
      node = node[key];
    }
    node[keys[keys.length - 1]] = value;
  }
  return config;
}

// Build the per-episode task list for a plan.
function buildTasks(options, baseConfig) {
  const players = String(options.players).split(',').map((p) => p.trim()).filter(Boolean);
  const episodes = [];
  if (options.plan === 'standard') {
    for (const seed of String(options.seeds).split(',').map(Number)) episodes.push({ seed, scenario: 'standard' });
  } else {
    const scenarios = (baseConfig.ai.training.evalScenarios || []).slice();
    const perScenario = Math.floor(options.episodes / scenarios.length);
    const remainder = options.episodes % scenarios.length;
    let index = 0;
    scenarios.forEach((name, i) => {
      for (let k = 0; k < perScenario + (i < remainder ? 1 : 0); k += 1) {
        episodes.push({ seed: options.seedBase + index, scenario: name });
        index += 1;
      }
    });
  }
  const tasks = [];
  for (const player of players) for (const episode of episodes) tasks.push({ ...episode, player });
  return tasks;
}

// Synthetic action envelope for one decision (null = no action fields).
function buildAction(player, config, rng) {
  if (player === 'default') return null;
  const low = Number(config.ai.minWeight ?? 0);
  const high = Number(config.ai.maxWeight ?? 2);
  const value = () => {
    if (player === 'random') return low + (high - low) * rng();
    if (player.startsWith('const:')) return Math.min(high, Math.max(low, Number(player.slice(6))));
    return null;
  };
  if (player === 'neglect') return { weights: { food: 0.05, water: 0.05, wood: 2, stone: 2 } };
  // gov:X keeps the default job weights and sets every festival/governor head to X.
  const governorsOnly = player.startsWith('gov:');
  const governorValue = governorsOnly ? Math.min(high, Math.max(low, Number(player.slice(4)))) : null;
  const pick = governorsOnly ? () => governorValue : value;
  const action = governorsOnly ? {} : { weights: {} };
  if (!governorsOnly) {
    for (const resource of Object.keys(config.resources.targets || {}).sort()) action.weights[resource] = value();
  }
  // Same action heads as python/train.py append_festival_action / append_governor_actions.
  const festivals = config.festivals || {};
  if (festivals.enabled !== false && (festivals.ai || {}).enabled !== false) action.festivalIntent = pick();
  const governors = config.ai.governors || {};
  for (const [group, fields] of Object.entries(GOVERNOR_FIELDS)) {
    const governor = governors[group] || {};
    if (governor.enabled === false) continue;
    if ((group === 'social' || group === 'warriors') && governor.actionHeadEnabled === false) continue;
    action[group] = {};
    for (const field of fields) action[group][field] = pick();
  }
  return action;
}

// Wrap state.stockpile in a read-only-semantics Proxy that counts gross inflow and outflow.
function watchStockpile(state, flows) {
  if (state.stockpile && state.stockpile.__probeWatched) return;
  const target = state.stockpile || {};
  state.stockpile = new Proxy(target, {
    get(obj, key) { return key === '__probeWatched' ? true : obj[key]; },
    set(obj, key, value) {
      const before = Number(obj[key] || 0);
      const after = Number(value);
      if (TRACKED.includes(key) && Number.isFinite(after)) {
        const flow = flows[key];
        if (after > before) flow.inflow += after - before;
        else flow.outflow += before - after;
      }
      obj[key] = value;
      return true;
    },
  });
}

function laborMix(state, config) {
  const adultAge = Number(config.population?.aging?.adultAge || 0);
  const mix = { adults: 0, idle: 0, gather: {}, build: 0, underrealm: 0, other: 0 };
  for (const dwarf of state.dwarves || []) {
    if (Number(dwarf.ageTicks || 0) < adultAge) continue;
    mix.adults += 1;
    const job = dwarf.job;
    if (dwarf.underrealmDuty && dwarf.underrealmDuty.active !== false) mix.underrealm += 1;
    else if (!job) mix.idle += 1;
    else if (job.type === 'gather') mix.gather[job.resource] = (mix.gather[job.resource] || 0) + 1;
    else if (job.type === 'build' || job.type === 'upgrade') mix.build += 1;
    else mix.other += 1;
  }
  return mix;
}

// Run one episode and return its sampled trajectory.
function runEpisode(task, options) {
  const { loadConfig } = require(path.join(ROOT, 'src', 'config'));
  const { buildRuntime } = require(path.join(ROOT, 'src', 'runtime'));
  const { createInitialState } = require(path.join(ROOT, 'src', 'state'));
  const { stepState } = require(path.join(ROOT, 'src', 'simulation'));
  const { computeOutcomeSignals, computeOutcomeReward } = require(path.join(ROOT, 'src', 'ai', 'outcome_reward'));
  const { loadPolicy, selectAction } = require(path.join(ROOT, 'src', 'ai', 'policy'));
  const policy = task.player.startsWith('policy:') ? loadPolicy(path.resolve(ROOT, task.player.slice(7))) : null;
  if (task.player.startsWith('policy:') && !policy) throw new Error(`cannot load ${task.player}`);
  // A trained policy decides at the cadence it was trained at; other players use --step-ticks.
  const stepTicks = policy && policy.stepTicks ? policy.stepTicks : options.stepTicks;
  const base = loadConfig(options.config ? path.resolve(ROOT, options.config) : undefined);
  const previousRandom = Math.random;
  Math.random = mulberry32(task.seed);
  try {
    let config;
    let runtime;
    if (options.plan === 'standard') {
      config = JSON.parse(JSON.stringify(base));
      config.display = config.display || {};
      config.display.terrain = { ...(config.display.terrain || {}), seed: task.seed };
      applySets(config, options.set);
      const display = { ...config.display, autoSize: false, width: 120, height: 40 };
      runtime = buildRuntime(display, { columns: 120, rows: 40 });
    } else {
      config = buildEvalConfig(base, task.scenario);
      applySets(config, options.set);
      const display = config.display || {};
      runtime = buildRuntime(display, { columns: Number(display.width || 80), rows: Number(display.height || 24) });
    }
    const state = createInitialState(config, runtime);
    const flows = Object.fromEntries(TRACKED.map((key) => [key, { inflow: 0, outflow: 0 }]));
    const actionRng = mulberry32((task.seed ^ 0x9e3779b9) >>> 0);
    const targets = { ...(config.resources.targets || {}) };
    const samples = [];
    const deaths = {};
    let births = 0;
    let lastBirths = Number(state.birthsCount || 0);
    let lastDeaths = { ...(state.deathsByCause || {}) };
    let lastFlows = JSON.parse(JSON.stringify(flows));
    let action = null;
    const startPop = (state.dwarves || []).length;
    let extinctionTick = null;
    // Outcome reward (src/ai/outcome_reward.js), accumulated per decision step like ai_server.
    let signals = computeOutcomeSignals(state, config);
    const reward = { total: 0, terms: {} };
    // Progress milestones (cycle-safe: counters that reset count from zero).
    const progress = { maxDepth: signals.depth, landmarkStages: 0, prestige: 0 };
    const gain = (current, previous) => (current >= previous ? current - previous : current);
    // Narrative output: new Event Log entries per category and how many are notable or above.
    const narrative = { total: 0, notable: 0, byCategory: {} };
    const NOTABLE = new Set(['notable', 'major', 'critical', 'legendary']);
    let lastEventId = null;
    for (let tick = 1; tick <= options.ticks; tick += 1) {
      if ((tick - 1) % stepTicks === 0) {
        action = policy ? selectAction(state, config, policy) : buildAction(task.player, config, actionRng);
      }
      watchStockpile(state, flows);
      // Eval actions carry `ticks` like ai_server step payloads; the standard game passes null.
      const stepAction = options.plan === 'standard' && task.player === 'default'
        ? null : { ...(action || {}), ticks: stepTicks };
      stepState(state, config, runtime, stepAction);
      const birthsNow = Number(state.birthsCount || 0);
      births += birthsNow >= lastBirths ? birthsNow - lastBirths : birthsNow;
      lastBirths = birthsNow;
      const deathsNow = state.deathsByCause || {};
      for (const [cause, count] of Object.entries(deathsNow)) {
        const prev = Number(lastDeaths[cause] || 0);
        const delta = Number(count) >= prev ? Number(count) - prev : Number(count);
        if (delta > 0) deaths[cause] = (deaths[cause] || 0) + delta;
      }
      lastDeaths = { ...deathsNow };
      const log = Array.isArray(state.eventLog) ? state.eventLog : [];
      for (const entry of log) {
        if (!entry || entry.id === lastEventId) break;
        narrative.total += 1;
        if (NOTABLE.has(entry.importance)) narrative.notable += 1;
        narrative.byCategory[entry.category] = (narrative.byCategory[entry.category] || 0) + 1;
      }
      if (log.length > 0 && log[0]) lastEventId = log[0].id;
      const pop = (state.dwarves || []).length;
      if (pop === 0 && extinctionTick === null) extinctionTick = tick;
      if (tick % stepTicks === 0 || pop === 0) {
        const next = computeOutcomeSignals(state, config);
        const step = computeOutcomeReward(signals, next, config);
        reward.total += step.total;
        for (const [key, value] of Object.entries(step.terms)) reward.terms[key] = (reward.terms[key] || 0) + value;
        progress.maxDepth = Math.max(progress.maxDepth, next.depth);
        progress.landmarkStages += gain(next.landmarkStages, signals.landmarkStages);
        progress.prestige += gain(next.prestige, signals.prestige);
        signals = next;
      }
      if (tick % options.sampleEvery === 0 || tick === options.ticks || pop === 0) {
        const window = {};
        for (const key of TRACKED) {
          const stock = Number(state.stockpile[key] || 0);
          const outRate = (flows[key].outflow - lastFlows[key].outflow) / options.sampleEvery;
          const inRate = (flows[key].inflow - lastFlows[key].inflow) / options.sampleEvery;
          window[key] = { stock, ratio: targets[key] ? stock / targets[key] : null, inRate, outRate,
            autonomy: outRate > 0 ? stock / outRate : null };
        }
        lastFlows = JSON.parse(JSON.stringify(flows));
        const ledger = state.modifierLedger || {};
        const pick = (quantity, key) => (ledger[quantity] && ledger[quantity][key] ? ledger[quantity][key].multiplier : null);
        const modifiers = { gatherFood: pick('gatherYield', 'food'), gatherWater: pick('gatherYield', 'water'),
          needDecay: pick('needDecay', 'colony'), birthChance: pick('birthChance', 'colony') };
        samples.push({ tick, pop, modifiers, resources: window, labor: laborMix(state, config),
          deaths: { ...deaths }, births });
      }
      if (pop === 0) break;
    }
    const scored = { score: reward.total / options.ticks,
      terms: Object.fromEntries(Object.entries(reward.terms).map(([k, v]) => [k, v / options.ticks])) };
    return { ...task, startPop, extinctionTick, targets, flows, deaths, births, samples, reward: scored, progress,
      narrative };
  } finally {
    Math.random = previousRandom;
  }
}

// Summarize one episode into the challenge scorecard metrics.
function summarize(episode) {
  const samples = episode.samples;
  const last = samples[samples.length - 1];
  const half = samples.filter((s) => s.tick > last.tick / 2);
  const mean = (list, f) => (list.length ? list.reduce((a, s) => a + f(s), 0) / list.length : null);
  const median = (values) => {
    const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  };
  const resources = {};
  for (const key of TRACKED) {
    const ratios = samples.map((s) => s.resources[key].ratio).filter((x) => x !== null);
    const inH = half.reduce((a, s) => a + s.resources[key].inRate, 0);
    const outH = half.reduce((a, s) => a + s.resources[key].outRate, 0);
    let safeAfter = null;
    if (ratios.length) {
      let lastLow = -1;
      samples.forEach((s, i) => { if (s.resources[key].ratio !== null && s.resources[key].ratio < 0.5) lastLow = i; });
      safeAfter = lastLow === samples.length - 1 ? null : (lastLow < 0 ? 0 : samples[lastLow + 1].tick);
    }
    resources[key] = {
      ratio_mean: ratios.length ? mean(ratios, (x) => x) : null,
      ratio_min: ratios.length ? Math.min(...ratios) : null,
      ratio_final: last.resources[key].ratio,
      share_below_half: ratios.length ? ratios.filter((x) => x < 0.5).length / ratios.length : null,
      share_below_quarter: ratios.length ? ratios.filter((x) => x < 0.25).length / ratios.length : null,
      surplus_second_half: outH > 0 ? inH / outH : null,
      autonomy_median_second_half: median(half.map((s) => s.resources[key].autonomy)),
      autonomy_min: Math.min(...samples.map((s) => s.resources[key].autonomy).filter(Number.isFinite), Infinity),
      safe_after_tick: safeAfter,
      outflow_per_dwarf_tick: mean(half, (s) => (s.pop ? s.resources[key].outRate / s.pop : 0)),
      inflow_total: episode.flows[key].inflow,
      outflow_total: episode.flows[key].outflow,
    };
  }
  const laborShare = (f) => mean(half, (s) => (s.labor.adults ? f(s.labor) / s.labor.adults : 0));
  const avoidable = ['starvation', 'raid', 'deepRaid', 'ruins', 'warriorLeague']
    .reduce((a, k) => a + Number(episode.deaths[k] || 0), 0);
  const pops = samples.map((s) => s.pop);
  return {
    seed: episode.seed, scenario: episode.scenario, player: episode.player,
    start_pop: episode.startPop, final_pop: last.pop, min_pop: Math.min(...pops), peak_pop: Math.max(...pops),
    drawdown: Math.max(...pops) > 0 ? 1 - last.pop / Math.max(...pops) : 0,
    extinction_tick: episode.extinctionTick, births: episode.births, deaths: episode.deaths,
    avoidable_deaths: avoidable,
    outcome_score: episode.reward ? episode.reward.score : null,
    progress: episode.progress || null,
    narrative: episode.narrative || null,
    outcome_terms: episode.reward ? episode.reward.terms : null,
    labor_second_half: {
      idle: laborShare((l) => l.idle), essentials: laborShare((l) => (l.gather.food || 0) + (l.gather.water || 0)),
      materials: laborShare((l) => Object.entries(l.gather).filter(([k]) => !['food', 'water'].includes(k))
        .reduce((a, [, v]) => a + v, 0)),
      build: laborShare((l) => l.build), underrealm: laborShare((l) => l.underrealm), other: laborShare((l) => l.other),
    },
    resources,
  };
}

function runPool(tasks, options) {
  return new Promise((resolve, reject) => {
    const results = [];
    let next = 0;
    let active = 0;
    const started = Date.now();
    const launch = () => {
      if (next >= tasks.length) { if (active === 0) resolve(results); return; }
      const task = tasks[next];
      next += 1;
      active += 1;
      const worker = new Worker(__filename, { workerData: { task, options } });
      worker.once('message', (episode) => {
        results.push(episode);
        const s = episode.summary;
        console.log(`[challenge] ${results.length}/${tasks.length} ${s.player} ${s.scenario} seed=${s.seed} `
          + `pop=${s.final_pop} avoid=${s.avoidable_deaths} ${((Date.now() - started) / 1000).toFixed(0)}s`);
      });
      worker.once('error', reject);
      worker.once('exit', () => { active -= 1; launch(); });
    };
    for (let i = 0; i < Math.min(options.workers, tasks.length); i += 1) launch();
  });
}

// Print per-player and per-scenario challenge tables from one or more probe outputs.
function report(files) {
  const episodes = files.flatMap((file) => JSON.parse(fs.readFileSync(file, 'utf8')).episodes.map((e) => {
    const last = e.samples[e.samples.length - 1];
    const perDwarf = (key) => (last.pop ? last.resources[key].stock / last.pop : null);
    return { ...e.summary, stock_per_dwarf_final: { food: perDwarf('food'), water: perDwarf('water') } };
  }));
  const avg = (list, f) => (list.length ? list.reduce((a, x) => a + (Number(f(x)) || 0), 0) / list.length : 0);
  const fmt = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '-' : v.toFixed(d));
  const players = [...new Set(episodes.map((e) => `${e.scenario === 'standard' ? 'std:' : ''}${e.player}`))];
  console.log('player          pop  peak  draw  ext  avoid starv  fd<.5  wt<.5 fdAut wtAut fdSur wtSur fd/dw wt/dw idle  ess  safeFd');
  for (const name of players) {
    const list = episodes.filter((e) => `${e.scenario === 'standard' ? 'std:' : ''}${e.player}` === name);
    const r = (key, field) => avg(list, (e) => e.resources[key][field]);
    console.log(`${name.padEnd(14)} ${fmt(avg(list, (e) => e.final_pop), 0).padStart(4)} ${fmt(avg(list, (e) => e.peak_pop), 0).padStart(5)} `
      + `${fmt(avg(list, (e) => e.drawdown)).padStart(5)} ${String(list.filter((e) => e.extinction_tick).length).padStart(4)} `
      + `${fmt(avg(list, (e) => e.avoidable_deaths), 1).padStart(6)} ${fmt(avg(list, (e) => e.deaths.starvation || 0), 1).padStart(5)} `
      + `${fmt(r('food', 'share_below_half')).padStart(6)} ${fmt(r('water', 'share_below_half')).padStart(6)} `
      + `${fmt(r('food', 'autonomy_median_second_half'), 0).padStart(5)} ${fmt(r('water', 'autonomy_median_second_half'), 0).padStart(5)} `
      + `${fmt(r('food', 'surplus_second_half')).padStart(5)} ${fmt(r('water', 'surplus_second_half')).padStart(5)} `
      + `${fmt(avg(list, (e) => e.stock_per_dwarf_final?.food), 1).padStart(5)} ${fmt(avg(list, (e) => e.stock_per_dwarf_final?.water), 1).padStart(5)} `
      + `${fmt(avg(list, (e) => e.labor_second_half.idle)).padStart(4)} ${fmt(avg(list, (e) => e.labor_second_half.essentials)).padStart(4)} `
      + `${fmt(r('food', 'safe_after_tick'), 0).padStart(6)}`);
  }
}

async function main() {
  if (process.argv[2] === '--report') {
    report(process.argv.slice(3));
    return;
  }
  const options = parseArgs(process.argv.slice(2));
  const { loadConfig } = require(path.join(ROOT, 'src', 'config'));
  const baseConfig = loadConfig(options.config ? path.resolve(ROOT, options.config) : undefined);
  const tasks = buildTasks(options, baseConfig);
  console.log(`[challenge] plan=${options.plan} tasks=${tasks.length} ticks=${options.ticks} workers=${options.workers} cpus=${os.cpus().length}`);
  const episodes = await runPool(tasks, options);
  const order = (e) => tasks.findIndex((t) => t.player === e.player && t.seed === e.seed && t.scenario === e.scenario);
  episodes.sort((a, b) => order(a) - order(b));
  fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
  fs.writeFileSync(options.out, `${JSON.stringify({ options, episodes }, null, 1)}\n`);
  console.log(`[challenge] wrote ${options.out}`);
}

if (isMainThread) {
  main().catch((error) => { console.error(error); process.exit(1); });
} else {
  const episode = runEpisode(workerData.task, workerData.options);
  if (configTrace) configTrace.flush();
  parentPort.postMessage({ ...episode, summary: summarize(episode) });
}
