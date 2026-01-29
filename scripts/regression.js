#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PYTHON = path.join(ROOT, '.venv', 'bin', 'python');
const TRAIN = path.join(ROOT, 'python', 'train.py');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const BASELINE_PATH = path.join(ROOT, 'debug', 'regression_baseline.json');

const DEFAULT_SEEDS = [12345, 22222];
const DEFAULT_EVAL_EPISODES = 20;
const DEFAULT_EVAL_MAX_STEPS = 1200;
const DEFAULT_RANDOM_EPISODES = 40;
const DEFAULT_RANDOM_MAX_STEPS = 520;
const DEFAULT_TOLERANCES = {
  eval: {
    avg_reward: { mode: 'rel', limit: -0.05 },
    score: { mode: 'rel', limit: -0.05 },
    avg_deaths: { mode: 'rel', limit: 0.15 },
  },
  random: {
    avg_reward: { mode: 'rel', limit: -0.08 },
    stock_min: { mode: 'rel', limit: -0.08 },
    extinction_rate: { mode: 'abs', limit: 0.05 },
  },
};

function parseArgs(argv) {
  const options = {
    seeds: DEFAULT_SEEDS.slice(),
    evalEpisodes: DEFAULT_EVAL_EPISODES,
    evalMaxSteps: DEFAULT_EVAL_MAX_STEPS,
    randomEpisodes: DEFAULT_RANDOM_EPISODES,
    randomMaxSteps: DEFAULT_RANDOM_MAX_STEPS,
    record: false,
    profile: 'standard',
    all: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--record') {
      options.record = true;
      continue;
    }
    if (arg === '--profile') {
      options.profile = String(argv[i + 1] || options.profile);
      i += 1;
      continue;
    }
    if (arg === '--all') {
      options.all = true;
      continue;
    }
    if (arg === '--seeds') {
      const value = argv[i + 1];
      i += 1;
      options.seeds = value.split(',').map((part) => Number(part.trim())).filter(Number.isFinite);
      continue;
    }
    if (arg === '--eval-episodes') {
      options.evalEpisodes = Number(argv[i + 1] || options.evalEpisodes);
      i += 1;
      continue;
    }
    if (arg === '--eval-max-steps') {
      options.evalMaxSteps = Number(argv[i + 1] || options.evalMaxSteps);
      i += 1;
      continue;
    }
    if (arg === '--random-episodes') {
      options.randomEpisodes = Number(argv[i + 1] || options.randomEpisodes);
      i += 1;
      continue;
    }
    if (arg === '--random-max-steps') {
      options.randomMaxSteps = Number(argv[i + 1] || options.randomMaxSteps);
      i += 1;
      continue;
    }
  }

  if (!options.seeds.length) {
    options.seeds = DEFAULT_SEEDS.slice();
  }
  return options;
}

function ensureFile(pathname, label) {
  if (!fs.existsSync(pathname)) {
    throw new Error(`${label} not found: ${pathname}`);
  }
}

function readConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

function writeTempConfig(config, tag) {
  const tempPath = path.join(os.tmpdir(), `nodedwarves_regression_${tag}.json`);
  fs.writeFileSync(tempPath, JSON.stringify(config, null, 2));
  return tempPath;
}

function buildEvalConfig(evalScenarios) {
  const cfg = readConfig();
  if (!cfg.display) cfg.display = {};
  if (!cfg.display.terrain) cfg.display.terrain = {};
  cfg.display.terrain.seed = 1337;
  if (!cfg.ai) cfg.ai = {};
  if (!cfg.ai.training) cfg.ai.training = {};
  cfg.ai.training.evalScenarios = evalScenarios;
  return cfg;
}

function buildRandomConfig() {
  const cfg = readConfig();
  if (!cfg.display) cfg.display = {};
  if (!cfg.display.terrain) cfg.display.terrain = {};
  cfg.display.terrain.seed = 0;
  return cfg;
}

function runCommand(args, logPath) {
  const result = spawnSync(PYTHON, [TRAIN, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (logPath) {
    fs.writeFileSync(logPath, output);
  }
  if (result.status !== 0) {
    throw new Error(`train.py failed (exit ${result.status}). See ${logPath || 'output'}.`);
  }
  return output;
}

function parseEvalOutput(output) {
  const lines = output.split(/\r?\n/);
  let line = null;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].startsWith('eval episode=')) {
      line = lines[i];
      break;
    }
  }
  if (!line) {
    throw new Error('No eval episode line found in output.');
  }
  return {
    avg_reward: readFloat(line, 'avg_reward'),
    avg_steps: readFloat(line, 'avg_steps'),
    avg_births: readFloat(line, 'avg_births'),
    avg_deaths: readFloat(line, 'avg_deaths'),
    score: readFloat(line, 'score'),
  };
}

function parseSummaryLog(summaryPath) {
  const lines = fs.readFileSync(summaryPath, 'utf8').trim().split(/\r?\n/);
  let line = null;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].startsWith('ep=')) {
      line = lines[i];
      break;
    }
  }
  if (!line) {
    throw new Error(`No summary line found in ${summaryPath}`);
  }
  const stock = readMatch(line, /stock\[min=([0-9.]+) avg=([0-9.]+)\]/);
  const termLabel = readMatch(line, /term=([^\s]+)/);
  const termRates = parseTermRates(termLabel ? termLabel[1] : '');
  const raidMatch = readMatch(
    line,
    /raid\[count=([0-9.]+) deaths=([0-9.]+) exp=([0-9.]+) def=([0-9.]+)[^\]]*\]/,
  );
  const shortSection = extractSection(line, 'short=', ' nodes=');
  const nodesSection = extractSection(line, 'nodes=', ' term=');
  const shortMap = parseKeyValueMap(shortSection);
  const nodesMap = parseKeyValueMap(nodesSection);
  const shortMetrics = {};
  const nodeMetrics = {};
  for (const [key, value] of Object.entries(shortMap)) {
    shortMetrics[`short_${key}`] = value;
  }
  for (const [key, value] of Object.entries(nodesMap)) {
    nodeMetrics[`node_${key}`] = value;
  }
  return {
    avg_reward: readFloat(line, 'avg_reward'),
    avg_steps: readFloat(line, 'avg_steps'),
    avg_births: readFloat(line, 'avg_births'),
    avg_deaths: readFloat(line, 'avg_deaths'),
    stock_min: stock ? Number(stock[1]) : null,
    stock_avg: stock ? Number(stock[2]) : null,
    crit: readFloat(line, 'crit'),
    idle: readFloat(line, 'idle'),
    extinction_rate: termRates.extinction || 0,
    raid_count: raidMatch ? Number(raidMatch[1]) : null,
    raid_deaths: raidMatch ? Number(raidMatch[2]) : null,
    raid_exposed: raidMatch ? Number(raidMatch[3]) : null,
    raid_defense: raidMatch ? Number(raidMatch[4]) : null,
    ...shortMetrics,
    ...nodeMetrics,
  };
}

function readFloat(line, key) {
  const match = readMatch(line, new RegExp(`${key}=([0-9.+-eE]+)`));
  return match ? Number(match[1]) : null;
}

function readMatch(line, regex) {
  const match = line.match(regex);
  return match || null;
}

function extractSection(line, startLabel, endLabel) {
  if (!line || !startLabel) {
    return '';
  }
  const start = line.indexOf(startLabel);
  if (start === -1) {
    return '';
  }
  const end = endLabel ? line.indexOf(endLabel, start) : -1;
  const slice = end === -1
    ? line.slice(start + startLabel.length)
    : line.slice(start + startLabel.length, end);
  return slice.trim();
}

function parseKeyValueMap(section) {
  if (!section) {
    return {};
  }
  const entries = section.split(' ').map((part) => part.trim()).filter(Boolean);
  const map = {};
  for (const entry of entries) {
    const [key, value] = entry.split('=');
    if (!key || value === undefined) {
      continue;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      map[key] = numeric;
    }
  }
  return map;
}

function extractSection(line, startLabel, endLabel) {
  if (!line || !startLabel) {
    return '';
  }
  const start = line.indexOf(startLabel);
  if (start === -1) {
    return '';
  }
  const end = endLabel ? line.indexOf(endLabel, start) : -1;
  const slice = end === -1
    ? line.slice(start + startLabel.length)
    : line.slice(start + startLabel.length, end);
  return slice.trim();
}

function parseKeyValueMap(section) {
  if (!section) {
    return {};
  }
  const entries = section.split(' ').map((part) => part.trim()).filter(Boolean);
  const map = {};
  for (const entry of entries) {
    const [key, value] = entry.split('=');
    if (!key || value === undefined) {
      continue;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      map[key] = numeric;
    }
  }
  return map;
}

function parseTermRates(termLabel) {
  const rates = {};
  if (!termLabel) {
    return rates;
  }
  const entries = termLabel.split(',');
  for (const entry of entries) {
    const match = entry.match(/^([a-z_]+):(\\d+)%$/);
    if (match) {
      rates[match[1]] = Number(match[2]) / 100;
    }
  }
  return rates;
}

function averageMetrics(list) {
  const totals = {};
  const counts = {};
  for (const metrics of list) {
    for (const [key, value] of Object.entries(metrics)) {
      if (value === null || value === undefined || Number.isNaN(value)) {
        continue;
      }
      totals[key] = Number(totals[key] || 0) + value;
      counts[key] = Number(counts[key] || 0) + 1;
    }
  }
  const averages = {};
  for (const key of Object.keys(totals)) {
    averages[key] = totals[key] / counts[key];
  }
  return averages;
}

function formatNumber(value, digits = 3) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  return value.toFixed(digits);
}

function formatPercent(value, digits = 1) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  return `${(value * 100).toFixed(digits)}%`;
}

function computeDelta(current, baseline) {
  if (!Number.isFinite(current) || !Number.isFinite(baseline)) {
    return { abs: null, rel: null };
  }
  const abs = current - baseline;
  const rel = baseline !== 0 ? abs / baseline : null;
  return { abs, rel };
}

function padRight(value, width) {
  const str = String(value);
  if (str.length >= width) {
    return str;
  }
  return str + ' '.repeat(width - str.length);
}

function buildLegendLines() {
  return [
    'Legend:',
    '- Eval (deterministic): fixed terrain seed=1337, randomization off (compare training quality).',
    '- Randomized: terrain seed=0, randomization on (robustness/stability).',
    '- Columns: current, baseline, delta(abs), delta(%), threshold, status.',
    '- threshold: rel limit -0.05 means max -5% drop; abs limit 0.05 means max +0.05 increase.',
    '- Key metrics: avg_reward/score (policy quality), avg_steps (survival), stock_min/stock_avg (buffer),',
    '  avg_births/avg_deaths (population flow), crit/idle (strain/utilization), extinction_rate (failures).',
    '- raid_*: avg raid count/deaths/exposure/defense; short_*: avg shortage ratio by resource; node_*: avg node capacity ratio.',
  ];
}

function buildDiffRows(metrics, baseline, tolerances, keys) {
  const rows = [];
  for (const key of keys) {
    const currentValue = metrics[key];
    const baselineValue = baseline ? baseline[key] : undefined;
    const delta = computeDelta(currentValue, baselineValue);
    const tolerance = tolerances ? tolerances[key] : null;
    let threshold = null;
    let status = 'n/a';
    if (tolerance && Number.isFinite(currentValue) && Number.isFinite(baselineValue)) {
      if (tolerance.mode === 'abs') {
        threshold = baselineValue + Number(tolerance.limit || 0);
        status = currentValue <= threshold + 1e-9 ? 'ok' : 'regress';
      } else {
        threshold = baselineValue * (1 + Number(tolerance.limit || 0));
        status = Number(tolerance.limit || 0) < 0
          ? (currentValue + 1e-9 >= threshold ? 'ok' : 'regress')
          : (currentValue <= threshold + 1e-9 ? 'ok' : 'regress');
      }
    }
    rows.push({
      metric: key,
      current: currentValue,
      baseline: baselineValue,
      deltaAbs: delta.abs,
      deltaRel: delta.rel,
      threshold,
      status,
    });
  }
  return rows;
}

function renderTable(title, rows) {
  const header = [
    padRight('metric', 16),
    padRight('current', 12),
    padRight('baseline', 12),
    padRight('delta', 12),
    padRight('delta%', 10),
    padRight('threshold', 12),
    padRight('status', 8),
  ].join(' ');
  const lines = [title, header, '-'.repeat(header.length)];
  for (const row of rows) {
    lines.push([
      padRight(row.metric, 16),
      padRight(formatNumber(row.current), 12),
      padRight(formatNumber(row.baseline), 12),
      padRight(formatNumber(row.deltaAbs), 12),
      padRight(row.deltaRel === null ? 'n/a' : formatPercent(row.deltaRel), 10),
      padRight(formatNumber(row.threshold), 12),
      padRight(row.status, 8),
    ].join(' '));
  }
  return lines;
}

function buildSummaryLines(sections) {
  const lines = ['Summary:'];
  for (const section of sections) {
    const evalStatus = section.evalOk ? 'PASS' : 'FAIL';
    const randomStatus = section.randomOk ? 'PASS' : 'FAIL';
    lines.push(`- ${section.profile}: eval=${evalStatus} random=${randomStatus}`);
  }
  return lines;
}

function writeReport(reportPath, data) {
  const lines = [];
  lines.push(`Regression report: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(...buildSummaryLines(data));
  lines.push('');
  lines.push(...buildLegendLines());
  lines.push('');

  for (const section of data) {
    lines.push(`Profile: ${section.profile}`);
    lines.push(`Seeds: ${section.config.seeds.join(', ')}`);
    lines.push(`Eval episodes: ${section.config.evalEpisodes}, Eval max steps: ${section.config.evalMaxSteps}`);
    lines.push(`Random episodes: ${section.config.randomEpisodes}, Random max steps: ${section.config.randomMaxSteps}`);
    lines.push('');
    lines.push(...renderTable('Eval (deterministic)', section.evalRows));
    lines.push('');
    lines.push(...renderTable('Randomized', section.randomRows));
    lines.push('');
  }

  fs.writeFileSync(reportPath, lines.join('\n'));
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    return { version: 2, profiles: {} };
  }
  const raw = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  if (raw && raw.profiles) {
    return raw;
  }
  if (raw && raw.baseline) {
    return {
      version: 2,
      profiles: {
        standard: {
          generatedAt: raw.generatedAt || null,
          config: raw.config || {},
          tolerances: raw.tolerances || DEFAULT_TOLERANCES,
          baseline: raw.baseline,
        },
      },
    };
  }
  return { version: 2, profiles: {} };
}

function saveBaseline(data) {
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(data, null, 2));
}

function buildProfileConfig(options) {
  return {
    seeds: options.seeds,
    evalEpisodes: options.evalEpisodes,
    evalMaxSteps: options.evalMaxSteps,
    randomEpisodes: options.randomEpisodes,
    randomMaxSteps: options.randomMaxSteps,
  };
}

function applyProfileConfig(options, config) {
  if (!config) {
    return { ...options };
  }
  return {
    ...options,
    seeds: Array.isArray(config.seeds) && config.seeds.length ? config.seeds : options.seeds,
    evalEpisodes: Number(config.evalEpisodes || options.evalEpisodes),
    evalMaxSteps: Number(config.evalMaxSteps || options.evalMaxSteps),
    randomEpisodes: Number(config.randomEpisodes || options.randomEpisodes),
    randomMaxSteps: Number(config.randomMaxSteps || options.randomMaxSteps),
  };
}

function runProfile(profileName, options) {
  const results = {
    eval: [],
    random: [],
  };

  for (const seed of options.seeds) {
    const evalDir = path.join(ROOT, 'debug', `regression_eval_${profileName}_seed${seed}_${Date.now()}`);
    fs.mkdirSync(evalDir, { recursive: true });
    const evalConfig = buildEvalConfig(['baseline', 'full_sim']);
    const evalConfigPath = writeTempConfig(evalConfig, `eval_${profileName}_${seed}`);
    fs.copyFileSync(path.join(ROOT, 'models', 'policy_best.json'), '/tmp/policy_best_eval.json');
    const evalOutput = runCommand([
      '--config', evalConfigPath,
      '--episodes', '1',
      '--batch-episodes', '9999',
      '--workers', '1',
      '--seed', String(seed),
      '--full-sim',
      '--eval-every', '1',
      '--eval-episodes', String(options.evalEpisodes),
      '--eval-max-steps', String(options.evalMaxSteps),
      '--model-path', '/tmp/policy_eval.json',
      '--best-model-path', '/tmp/policy_best_eval.json',
      '--best-model-meta-path', '/tmp/policy_best_eval.meta.json',
    ], path.join(evalDir, 'console.log'));
    const evalMetrics = parseEvalOutput(evalOutput);
    results.eval.push({ seed, metrics: evalMetrics, logDir: evalDir });

    const randomDir = path.join(ROOT, 'debug', `regression_random_${profileName}_seed${seed}_${Date.now()}`);
    fs.mkdirSync(randomDir, { recursive: true });
    const randomConfig = buildRandomConfig();
    const randomConfigPath = writeTempConfig(randomConfig, `random_${profileName}_${seed}`);
    fs.copyFileSync(path.join(ROOT, 'models', 'policy_best.json'), '/tmp/policy_best_eval.json');
    runCommand([
      '--config', randomConfigPath,
      '--episodes', String(options.randomEpisodes),
      '--batch-episodes', '9999',
      '--workers', '1',
      '--seed', String(seed),
      '--max-steps', String(options.randomMaxSteps),
      '--log-every', String(options.randomEpisodes),
      '--eval-every', '0',
      '--model-path', '/tmp/policy_eval.json',
      '--best-model-path', '/tmp/policy_best_eval.json',
      '--best-model-meta-path', '/tmp/policy_best_eval.meta.json',
      '--debug-run-dir', randomDir,
      '--debug-summary-name', 'summary_random.log',
      '--debug-prefix', 'rand',
    ], path.join(randomDir, 'console.log'));
    const summaryPath = path.join(randomDir, 'summary_random.log');
    const randomMetrics = parseSummaryLog(summaryPath);
    results.random.push({ seed, metrics: randomMetrics, logDir: randomDir });
  }

  const evalAverage = averageMetrics(results.eval.map((entry) => entry.metrics));
  const randomAverage = averageMetrics(results.random.map((entry) => entry.metrics));

  printSuite(`Eval (deterministic:${profileName})`, evalAverage);
  printSuite(`Randomized (${profileName})`, randomAverage);

  return { evalAverage, randomAverage };
}

function compareSuite(name, current, baseline, tolerances) {
  const results = [];
  let ok = true;
  for (const [metric, rule] of Object.entries(tolerances || {})) {
    const currentValue = current[metric];
    const baselineValue = baseline[metric];
    if (!Number.isFinite(currentValue) || !Number.isFinite(baselineValue)) {
      continue;
    }
    const limit = Number(rule.limit);
    const mode = rule.mode || 'rel';
    let pass = true;
    let threshold = null;
    if (mode === 'abs') {
      threshold = baselineValue + limit;
      pass = currentValue <= threshold + 1e-9;
    } else {
      threshold = baselineValue * (1 + limit);
      if (limit < 0) {
        pass = currentValue + 1e-9 >= threshold;
      } else {
        pass = currentValue <= threshold + 1e-9;
      }
    }
    results.push({
      metric,
      current: currentValue,
      baseline: baselineValue,
      threshold,
      pass,
    });
    if (!pass) {
      ok = false;
    }
  }
  return { name, ok, results };
}

function printSuite(title, metrics) {
  const entries = [
    `avg_reward=${formatNumber(metrics.avg_reward)}`,
    `avg_steps=${formatNumber(metrics.avg_steps)}`,
    `avg_births=${formatNumber(metrics.avg_births)}`,
    `avg_deaths=${formatNumber(metrics.avg_deaths)}`,
  ];
  if (metrics.score !== undefined) {
    entries.push(`score=${formatNumber(metrics.score)}`);
  }
  if (metrics.stock_min !== undefined) {
    entries.push(`stock_min=${formatNumber(metrics.stock_min)}`);
  }
  if (metrics.stock_avg !== undefined) {
    entries.push(`stock_avg=${formatNumber(metrics.stock_avg)}`);
  }
  if (metrics.crit !== undefined) {
    entries.push(`crit=${formatNumber(metrics.crit)}`);
  }
  if (metrics.idle !== undefined) {
    entries.push(`idle=${formatNumber(metrics.idle)}`);
  }
  if (metrics.extinction_rate !== undefined) {
    entries.push(`extinction=${formatNumber(metrics.extinction_rate, 3)}`);
  }
  console.log(`${title}: ${entries.join(' ')}`);
}

function main() {
  ensureFile(PYTHON, 'Python venv');
  ensureFile(TRAIN, 'train.py');
  ensureFile(CONFIG_PATH, 'config.json');

  const options = parseArgs(process.argv.slice(2));
  const baselineFile = loadBaseline();

  if (options.all) {
    if (options.record) {
      throw new Error('Use --record with a specific --profile, not --all.');
    }
    const profileNames = Object.keys(baselineFile.profiles || {});
    if (profileNames.length === 0) {
      throw new Error('No regression profiles found. Run with --record to create one.');
    }
    const reportSections = [];
    let allOk = true;
    for (const profileName of profileNames) {
      const profile = baselineFile.profiles[profileName];
      const profileOptions = applyProfileConfig(options, profile.config || {});
      const { evalAverage, randomAverage } = runProfile(profileName, profileOptions);
      const tolerances = profile.tolerances || DEFAULT_TOLERANCES;
      const comparisons = [
        compareSuite(`${profileName}.eval`, evalAverage, profile.baseline.eval, tolerances.eval),
        compareSuite(`${profileName}.random`, randomAverage, profile.baseline.random, tolerances.random),
      ];
      reportSections.push({
        profile: profileName,
        config: profile.config,
        evalOk: comparisons[0].ok,
        randomOk: comparisons[1].ok,
        evalRows: buildDiffRows(
          evalAverage,
          profile.baseline.eval,
          tolerances.eval,
          ['avg_reward', 'avg_steps', 'avg_births', 'avg_deaths', 'score'],
        ),
        randomRows: buildDiffRows(
          randomAverage,
          profile.baseline.random,
          tolerances.random,
          [
            'avg_reward',
            'avg_steps',
            'avg_births',
            'avg_deaths',
            'stock_min',
            'stock_avg',
            'crit',
            'idle',
            'raid_count',
            'raid_deaths',
            'raid_exposed',
            'raid_defense',
            'node_food',
            'node_water',
            'node_wood',
            'node_stone',
            'short_food',
            'short_water',
            'short_wood',
            'short_stone',
            'extinction_rate',
          ],
        ),
      });
      for (const suite of comparisons) {
        if (!suite.ok) {
          allOk = false;
        }
        for (const result of suite.results) {
          const verdict = result.pass ? 'ok' : 'regress';
          console.log(
            `${suite.name}.${result.metric}: ${verdict} ` +
            `current=${formatNumber(result.current)} ` +
            `baseline=${formatNumber(result.baseline)} ` +
            `threshold=${formatNumber(result.threshold)}`
          );
        }
      }
    }
    const reportPath = path.join(ROOT, 'debug', `regression_report_${Date.now()}.txt`);
    writeReport(reportPath, reportSections);
    console.log(`Diff report written to ${reportPath}`);
    if (!allOk) {
      process.exit(1);
    }
    return;
  }

  const profileName = options.profile || 'standard';
  const profile = baselineFile.profiles[profileName] || null;
  const profileOptions = options.record
    ? options
    : (profile ? applyProfileConfig(options, profile.config || {}) : options);
  const { evalAverage, randomAverage } = runProfile(profileName, profileOptions);

  if (options.record) {
    const record = {
      generatedAt: new Date().toISOString(),
      config: buildProfileConfig(profileOptions),
      tolerances: profile && profile.tolerances ? profile.tolerances : DEFAULT_TOLERANCES,
      baseline: {
        eval: evalAverage,
        random: randomAverage,
      },
    };
    baselineFile.version = 2;
    baselineFile.profiles = baselineFile.profiles || {};
    baselineFile.profiles[profileName] = record;
    saveBaseline(baselineFile);
    console.log(`Baseline recorded for profile "${profileName}" at ${BASELINE_PATH}`);
    return;
  }

  if (!profile) {
    throw new Error(`Baseline for profile "${profileName}" not found. Run with --record to create it.`);
  }

  const tolerances = profile.tolerances || DEFAULT_TOLERANCES;
  const comparisons = [
    compareSuite(`${profileName}.eval`, evalAverage, profile.baseline.eval, tolerances.eval),
    compareSuite(`${profileName}.random`, randomAverage, profile.baseline.random, tolerances.random),
  ];

  const reportPath = path.join(ROOT, 'debug', `regression_report_${Date.now()}.txt`);
  writeReport(reportPath, [{
    profile: profileName,
    config: profile.config,
    evalOk: comparisons[0].ok,
    randomOk: comparisons[1].ok,
    evalRows: buildDiffRows(
      evalAverage,
      profile.baseline.eval,
      tolerances.eval,
      ['avg_reward', 'avg_steps', 'avg_births', 'avg_deaths', 'score'],
    ),
    randomRows: buildDiffRows(
      randomAverage,
      profile.baseline.random,
      tolerances.random,
      [
        'avg_reward',
        'avg_steps',
        'avg_births',
        'avg_deaths',
        'stock_min',
        'stock_avg',
        'crit',
        'idle',
        'raid_count',
        'raid_deaths',
        'raid_exposed',
        'raid_defense',
        'node_food',
        'node_water',
        'node_wood',
        'node_stone',
        'short_food',
        'short_water',
        'short_wood',
        'short_stone',
        'extinction_rate',
      ],
    ),
  }]);
  console.log(`Diff report written to ${reportPath}`);

  let allOk = true;
  for (const suite of comparisons) {
    if (!suite.ok) {
      allOk = false;
    }
    for (const result of suite.results) {
      const verdict = result.pass ? 'ok' : 'regress';
      console.log(
        `${suite.name}.${result.metric}: ${verdict} ` +
        `current=${formatNumber(result.current)} ` +
        `baseline=${formatNumber(result.baseline)} ` +
        `threshold=${formatNumber(result.threshold)}`
      );
    }
  }

  if (!allOk) {
    process.exit(1);
  }
}

main();
