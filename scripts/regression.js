#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PYTHON = path.join(ROOT, '.venv', 'bin', 'python');
const PROMOTE = path.join(ROOT, 'python', 'promote_best.py');
const ROLLOUT = path.join(ROOT, 'python', 'regression_rollout.py');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const BASELINE_PATH = path.join(ROOT, 'regression', 'baselines', 'regression_baseline.json');
const LEGACY_BASELINE_PATH = path.join(ROOT, 'debug', 'regression_baseline.json');
const POLICY_BEST_PATH = path.join(ROOT, 'models', 'policy_best.json');

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
const EVAL_REPORT_METRICS = ['avg_reward', 'avg_steps', 'avg_births', 'avg_deaths', 'score'];
const RANDOM_REPORT_METRICS = [
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
  'under_depthProgress',
  'under_championProgress',
  'under_frontierContested',
  'under_championCooldown',
  'under_readinessScore',
  'under_readinessGap',
  'under_readinessBlocked',
  'under_readinessWarning',
  'under_combatPressure',
  'node_food',
  'node_water',
  'node_wood',
  'node_stone',
  'short_food',
  'short_water',
  'short_wood',
  'short_stone',
  'extinction_rate',
];

function parseArgs(argv) {
  const options = {
    seeds: DEFAULT_SEEDS.slice(),
    evalEpisodes: DEFAULT_EVAL_EPISODES,
    evalMaxSteps: DEFAULT_EVAL_MAX_STEPS,
    randomEpisodes: DEFAULT_RANDOM_EPISODES,
    randomMaxSteps: DEFAULT_RANDOM_MAX_STEPS,
    cliOverrides: {
      seeds: false,
      evalEpisodes: false,
      evalMaxSteps: false,
      randomEpisodes: false,
      randomMaxSteps: false,
    },
    record: false,
    profile: 'standard',
    all: false,
    reportJsonPath: null,
    reportMarkdownPath: null,
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
      options.cliOverrides.seeds = true;
      continue;
    }
    if (arg === '--eval-episodes') {
      options.evalEpisodes = Number(argv[i + 1] || options.evalEpisodes);
      options.cliOverrides.evalEpisodes = true;
      i += 1;
      continue;
    }
    if (arg === '--eval-max-steps') {
      options.evalMaxSteps = Number(argv[i + 1] || options.evalMaxSteps);
      options.cliOverrides.evalMaxSteps = true;
      i += 1;
      continue;
    }
    if (arg === '--random-episodes') {
      options.randomEpisodes = Number(argv[i + 1] || options.randomEpisodes);
      options.cliOverrides.randomEpisodes = true;
      i += 1;
      continue;
    }
    if (arg === '--random-max-steps') {
      options.randomMaxSteps = Number(argv[i + 1] || options.randomMaxSteps);
      options.cliOverrides.randomMaxSteps = true;
      i += 1;
      continue;
    }
    if (arg === '--report-json') {
      options.reportJsonPath = resolveOutputPath(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === '--report-md') {
      options.reportMarkdownPath = resolveOutputPath(argv[i + 1]);
      i += 1;
      continue;
    }
  }

  if (!options.seeds.length) {
    options.seeds = DEFAULT_SEEDS.slice();
  }
  return options;
}

// Resolve an output file path from CLI input.
function resolveOutputPath(rawPath) {
  const trimmed = String(rawPath || '').trim();
  if (!trimmed) {
    throw new Error('Output path cannot be empty.');
  }
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
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

function createTempWorkspace(prefix) {
  const safePrefix = String(prefix || 'nodedwarves_regression').replace(/[^a-zA-Z0-9._-]+/g, '_');
  return fs.mkdtempSync(path.join(os.tmpdir(), `${safePrefix}_`));
}

function removeTempWorkspace(tempDir) {
  if (!tempDir) {
    return;
  }
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (error) {
    // Best-effort cleanup; regression results remain in debug/ directories.
  }
}

function writeTempConfig(config, tempDir, tag) {
  const safeTag = String(tag || 'config').replace(/[^a-zA-Z0-9._-]+/g, '_');
  const tempPath = path.join(tempDir, `${safeTag}.json`);
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

// Format elapsed milliseconds as compact mm:ss string.
function formatElapsedMs(elapsedMs) {
  const safeMs = Math.max(0, Math.floor(Number(elapsedMs || 0)));
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Run one Python script with heartbeat logging and persisted console output.
async function runPythonScript(scriptPath, args, logPath, options = {}) {
  const captureOutput = options.captureOutput !== false;
  const scriptName = path.basename(scriptPath || 'python');
  const label = String(options.label || scriptName);
  const heartbeatEveryMs = Math.max(1000, Math.floor(Number(options.heartbeatEveryMs || 15000)));
  const progressLog = options.progressLog !== false;
  const tempLogDir = !logPath ? createTempWorkspace(`nodedwarves_regression_${scriptName}`) : null;
  const effectiveLogPath = logPath || path.join(tempLogDir, `${scriptName}.log`);
  const logDir = path.dirname(effectiveLogPath);
  fs.mkdirSync(logDir, { recursive: true });
  if (progressLog) {
    console.log(`[regression] ${label}: started (log=${effectiveLogPath})`);
  }

  const startMs = Date.now();
  const logStream = fs.createWriteStream(effectiveLogPath, { flags: 'w' });
  const child = spawn(PYTHON, [scriptPath, ...args], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';

  const appendChunk = (chunk) => {
    if (!chunk) {
      return;
    }
    const text = chunk.toString('utf8');
    logStream.write(text);
    if (captureOutput) {
      output += text;
    }
  };

  if (child.stdout) {
    child.stdout.on('data', appendChunk);
  }
  if (child.stderr) {
    child.stderr.on('data', appendChunk);
  }

  const heartbeat = progressLog
    ? setInterval(() => {
      const elapsed = formatElapsedMs(Date.now() - startMs);
      console.log(`[regression] ${label}: running ${elapsed}`);
    }, heartbeatEveryMs)
    : null;

  let spawnError = null;
  let exitCode = 0;
  await new Promise((resolve) => {
    child.on('error', (error) => {
      spawnError = error;
      resolve();
    });
    child.on('close', (code) => {
      exitCode = Number(code || 0);
      resolve();
    });
  });

  if (heartbeat) {
    clearInterval(heartbeat);
  }

  await new Promise((resolve) => {
    logStream.end(resolve);
  });

  if (spawnError) {
    if (tempLogDir) {
      removeTempWorkspace(tempLogDir);
    }
    throw spawnError;
  }

  if (exitCode !== 0) {
    if (progressLog) {
      console.log(
        `[regression] ${label}: failed after ${formatElapsedMs(Date.now() - startMs)} ` +
        `(exit=${exitCode})`,
      );
    }
    const error = new Error(`${scriptName} failed (exit ${exitCode}). See ${effectiveLogPath}.`);
    if (tempLogDir) {
      removeTempWorkspace(tempLogDir);
    }
    throw error;
  }

  if (progressLog) {
    console.log(`[regression] ${label}: completed in ${formatElapsedMs(Date.now() - startMs)}`);
  }
  if (tempLogDir) {
    removeTempWorkspace(tempLogDir);
  }
  return output;
}

function parseEvalOnlyOutput(output) {
  const lines = output.split(/\r?\n/);
  let payload = null;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].startsWith('EVAL_ONLY ')) {
      continue;
    }
    const rawJson = lines[i].slice('EVAL_ONLY '.length).trim();
    if (!rawJson) {
      continue;
    }
    try {
      payload = JSON.parse(rawJson);
      break;
    } catch (error) {
      throw new Error(`Invalid EVAL_ONLY payload: ${rawJson}`);
    }
  }
  if (!payload) {
    return parseEvalOutput(output);
  }
  return {
    avg_reward: Number(payload.avg_reward),
    avg_steps: Number(payload.avg_steps),
    avg_births: Number(payload.avg_births),
    avg_deaths: Number(payload.avg_deaths),
    score: Number(payload.score),
  };
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
  const nodesSection = extractSection(line, 'nodes=', ' under=')
    || extractSection(line, 'nodes=', ' term=');
  const underSection = extractSection(line, 'under=', ' term=');
  const shortMap = parseKeyValueMap(shortSection);
  const nodesMap = parseKeyValueMap(nodesSection);
  const underMap = parseKeyValueMap(underSection);
  const shortMetrics = {};
  const nodeMetrics = {};
  const underMetrics = {};
  for (const [key, value] of Object.entries(shortMap)) {
    shortMetrics[`short_${key}`] = value;
  }
  for (const [key, value] of Object.entries(nodesMap)) {
    nodeMetrics[`node_${key}`] = value;
  }
  for (const [key, value] of Object.entries(underMap)) {
    underMetrics[`under_${key}`] = value;
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
    ...underMetrics,
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

function parseTermRates(termLabel) {
  const rates = {};
  if (!termLabel) {
    return rates;
  }
  const entries = termLabel.split(/\s+/).filter(Boolean);
  for (const entry of entries) {
    const match = entry.match(/^([a-z_]+):(\d+)%$/);
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

function average(list, selector) {
  if (!Array.isArray(list) || list.length === 0) {
    return 0;
  }
  let sum = 0;
  let count = 0;
  for (const entry of list) {
    const value = Number(selector(entry));
    if (!Number.isFinite(value)) {
      continue;
    }
    sum += value;
    count += 1;
  }
  return count > 0 ? sum / count : 0;
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
    '- under_*: averaged Underrealm combat/progression bundle from trainer summaries (depth/champion/readiness/pressure).',
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
    const score = Number.isFinite(section.profileScore)
      ? formatNumber(section.profileScore, 1)
      : 'n/a';
    lines.push(`- ${section.profile}: eval=${evalStatus} random=${randomStatus} score=${score}`);
  }
  return lines;
}

// Compute pass rate over rows with concrete tolerance status.
function computeRowsPassRate(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const checked = list.filter((row) => row && row.status !== 'n/a');
  if (checked.length === 0) {
    return null;
  }
  const passed = checked.filter((row) => row.status === 'ok').length;
  return passed / checked.length;
}

// Compute one profile score from eval/random pass rates (0..100).
function computeProfileScore(evalRows, randomRows) {
  const evalPassRate = computeRowsPassRate(evalRows);
  const randomPassRate = computeRowsPassRate(randomRows);
  const parts = [evalPassRate, randomPassRate].filter((value) => Number.isFinite(value));
  if (parts.length === 0) {
    return null;
  }
  return average(parts, (value) => value) * 100;
}

// Build compact seed metric rows for report output.
function buildSeedMetricsRows(entries, metricKeys) {
  const rows = [];
  const list = Array.isArray(entries) ? entries : [];
  for (const entry of list) {
    const seed = Number(entry && entry.seed);
    const metrics = entry && entry.metrics && typeof entry.metrics === 'object'
      ? entry.metrics
      : {};
    const row = { seed };
    for (const key of metricKeys) {
      row[key] = Number(metrics[key]);
    }
    rows.push(row);
  }
  return rows;
}

// Build a serializable report bundle consumed by txt/json/markdown writers.
function buildReportBundle(sections, options, allOk) {
  const sectionList = Array.isArray(sections) ? sections : [];
  const scores = sectionList
    .map((section) => Number(section && section.profileScore))
    .filter(Number.isFinite);
  const averageScore = scores.length > 0 ? average(scores, (value) => value) : null;
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      allProfiles: options && options.all === true,
      allOk: Boolean(allOk),
      averageProfileScore: averageScore,
      options: {
        seeds: options && options.seeds ? options.seeds : [],
        evalEpisodes: options && options.evalEpisodes,
        evalMaxSteps: options && options.evalMaxSteps,
        randomEpisodes: options && options.randomEpisodes,
        randomMaxSteps: options && options.randomMaxSteps,
      },
    },
    sections: sectionList,
  };
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

// Build Markdown report lines from a bundle payload.
function buildMarkdownReport(bundle) {
  const lines = [];
  lines.push('# NodeDwarves Regression Report');
  lines.push('');
  lines.push(`Generated: ${bundle.meta.generatedAt}`);
  lines.push(`All profiles mode: ${bundle.meta.allProfiles ? 'yes' : 'no'}`);
  lines.push(`Gate result: ${bundle.meta.allOk ? 'PASS' : 'FAIL'}`);
  lines.push(
    `Average profile score: ${
      Number.isFinite(bundle.meta.averageProfileScore)
        ? formatNumber(bundle.meta.averageProfileScore, 1)
        : 'n/a'
    }`,
  );
  lines.push('');
  lines.push('## Profiles');
  lines.push('');
  lines.push('| Profile | Eval | Random | Score |');
  lines.push('| --- | --- | --- | ---: |');
  for (const section of bundle.sections) {
    lines.push(
      `| ${section.profile} | ${section.evalOk ? 'PASS' : 'FAIL'} | ${section.randomOk ? 'PASS' : 'FAIL'} | ${
        Number.isFinite(section.profileScore) ? formatNumber(section.profileScore, 1) : 'n/a'
      } |`,
    );
  }

  for (const section of bundle.sections) {
    lines.push('');
    lines.push(`## ${section.profile}`);
    lines.push('');
    lines.push(`Config seeds: ${(section.config && section.config.seeds || []).join(', ')}`);
    lines.push(
      `Eval episodes/max_steps: ${section.config.evalEpisodes}/${section.config.evalMaxSteps}`,
    );
    lines.push(
      `Random episodes/max_steps: ${section.config.randomEpisodes}/${section.config.randomMaxSteps}`,
    );
    lines.push('');
    lines.push('### Eval diff');
    lines.push('');
    lines.push('| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | --- |');
    for (const row of section.evalRows || []) {
      lines.push(
        `| ${row.metric} | ${formatNumber(row.current)} | ${formatNumber(row.baseline)} | ${formatNumber(row.deltaAbs)} | ${
          row.deltaRel === null ? 'n/a' : formatPercent(row.deltaRel)
        } | ${formatNumber(row.threshold)} | ${String(row.status || 'n/a').toUpperCase()} |`,
      );
    }
    lines.push('');
    lines.push('### Randomized diff');
    lines.push('');
    lines.push('| Metric | Current | Baseline | Delta | Delta% | Threshold | Status |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | --- |');
    for (const row of section.randomRows || []) {
      lines.push(
        `| ${row.metric} | ${formatNumber(row.current)} | ${formatNumber(row.baseline)} | ${formatNumber(row.deltaAbs)} | ${
          row.deltaRel === null ? 'n/a' : formatPercent(row.deltaRel)
        } | ${formatNumber(row.threshold)} | ${String(row.status || 'n/a').toUpperCase()} |`,
      );
    }
    if (Array.isArray(section.evalSeedMetrics) && section.evalSeedMetrics.length > 0) {
      lines.push('');
      lines.push('### Eval seed metrics');
      lines.push('');
      lines.push('| Seed | avg_reward | avg_steps | avg_births | avg_deaths | score |');
      lines.push('| ---: | ---: | ---: | ---: | ---: | ---: |');
      for (const row of section.evalSeedMetrics) {
        lines.push(
          `| ${row.seed} | ${formatNumber(row.avg_reward)} | ${formatNumber(row.avg_steps)} | ${formatNumber(row.avg_births)} | ${formatNumber(row.avg_deaths)} | ${formatNumber(row.score)} |`,
        );
      }
    }
    if (Array.isArray(section.randomSeedMetrics) && section.randomSeedMetrics.length > 0) {
      lines.push('');
      lines.push('### Randomized seed metrics');
      lines.push('');
      lines.push('| Seed | avg_reward | avg_steps | avg_births | avg_deaths | stock_min | stock_avg | extinction_rate |');
      lines.push('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
      for (const row of section.randomSeedMetrics) {
        lines.push(
          `| ${row.seed} | ${formatNumber(row.avg_reward)} | ${formatNumber(row.avg_steps)} | ${formatNumber(row.avg_births)} | ${formatNumber(row.avg_deaths)} | ${formatNumber(row.stock_min)} | ${formatNumber(row.stock_avg)} | ${formatNumber(row.extinction_rate)} |`,
        );
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

// Write one JSON report bundle to disk.
function writeJsonReport(reportPath, bundle) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(bundle, null, 2)}\n`);
}

// Write one Markdown report bundle to disk.
function writeMarkdownReport(reportPath, bundle) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, buildMarkdownReport(bundle));
}

// Normalize baseline payloads to the current v2 profile schema.
function normalizeBaselinePayload(raw) {
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

// Read and parse a baseline file from disk.
function readBaselineFile(pathname) {
  const raw = JSON.parse(fs.readFileSync(pathname, 'utf8'));
  return normalizeBaselinePayload(raw);
}

function loadBaseline() {
  if (fs.existsSync(BASELINE_PATH)) {
    return readBaselineFile(BASELINE_PATH);
  }

  if (fs.existsSync(LEGACY_BASELINE_PATH)) {
    const migrated = readBaselineFile(LEGACY_BASELINE_PATH);
    saveBaseline(migrated);
    console.log(`Migrated legacy baseline from ${LEGACY_BASELINE_PATH} to ${BASELINE_PATH}`);
    return migrated;
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
  const cliOverrides = options.cliOverrides || {};
  return {
    ...options,
    seeds: cliOverrides.seeds
      ? options.seeds
      : (Array.isArray(config.seeds) && config.seeds.length ? config.seeds : options.seeds),
    evalEpisodes: cliOverrides.evalEpisodes
      ? options.evalEpisodes
      : Number(config.evalEpisodes || options.evalEpisodes),
    evalMaxSteps: cliOverrides.evalMaxSteps
      ? options.evalMaxSteps
      : Number(config.evalMaxSteps || options.evalMaxSteps),
    randomEpisodes: cliOverrides.randomEpisodes
      ? options.randomEpisodes
      : Number(config.randomEpisodes || options.randomEpisodes),
    randomMaxSteps: cliOverrides.randomMaxSteps
      ? options.randomMaxSteps
      : Number(config.randomMaxSteps || options.randomMaxSteps),
  };
}

// Run one full profile (eval + randomized) across all configured seeds.
async function runProfile(profileName, options) {
  const results = {
    eval: [],
    random: [],
  };
  const sourceBestModelPath = POLICY_BEST_PATH;

  for (const seed of options.seeds) {
    console.log(`[regression] profile=${profileName} seed=${seed}: begin`);
    const seedTempDir = createTempWorkspace(`nodedwarves_regression_${profileName}_seed${seed}`);
    try {
      const evalDir = path.join(ROOT, 'debug', `regression_eval_${profileName}_seed${seed}_${Date.now()}`);
      fs.mkdirSync(evalDir, { recursive: true });
      const evalConfig = buildEvalConfig(['baseline', 'full_sim']);
      const evalConfigPath = writeTempConfig(evalConfig, seedTempDir, `eval_${profileName}_${seed}`);
      const evalOutput = await runPythonScript(PROMOTE, [
        '--config', evalConfigPath,
        '--model-path', sourceBestModelPath,
        '--best-model-path', path.join(seedTempDir, `unused_best_${seed}.json`),
        '--best-model-meta-path', path.join(seedTempDir, `unused_best_${seed}.meta.json`),
        '--eval-episodes', String(options.evalEpisodes),
        '--eval-max-steps', String(options.evalMaxSteps),
        '--eval-difficulty', '1.0',
        '--seed', String(seed),
        '--eval-only',
      ], path.join(evalDir, 'console.log'), {
        label: `profile=${profileName} seed=${seed} eval`,
      });
      const evalMetrics = parseEvalOnlyOutput(evalOutput);
      results.eval.push({ seed, metrics: evalMetrics, logDir: evalDir });

      const randomDir = path.join(ROOT, 'debug', `regression_random_${profileName}_seed${seed}_${Date.now()}`);
      fs.mkdirSync(randomDir, { recursive: true });
      const randomConfig = buildRandomConfig();
      const randomConfigPath = writeTempConfig(randomConfig, seedTempDir, `random_${profileName}_${seed}`);
      const summaryPath = path.join(randomDir, 'summary_random.log');
      await runPythonScript(ROLLOUT, [
        '--config', randomConfigPath,
        '--model-path', sourceBestModelPath,
        '--episodes', String(options.randomEpisodes),
        '--seed', String(seed),
        '--max-steps', String(options.randomMaxSteps),
        '--summary-path', summaryPath,
      ], path.join(randomDir, 'console.log'), {
        captureOutput: false,
        label: `profile=${profileName} seed=${seed} randomized`,
      });
      const randomMetrics = parseSummaryLog(summaryPath);
      results.random.push({ seed, metrics: randomMetrics, logDir: randomDir });
      console.log(`[regression] profile=${profileName} seed=${seed}: completed`);
    } finally {
      removeTempWorkspace(seedTempDir);
    }
  }

  const evalAverage = averageMetrics(results.eval.map((entry) => entry.metrics));
  const randomAverage = averageMetrics(results.random.map((entry) => entry.metrics));

  printSuite(`Eval (deterministic:${profileName})`, evalAverage);
  printSuite(`Randomized (${profileName})`, randomAverage);

  return {
    evalAverage,
    randomAverage,
    evalSeedResults: results.eval,
    randomSeedResults: results.random,
  };
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

// Build one profile report section with score and seed-level snapshots.
function buildProfileReportSection(
  profileName,
  profileConfig,
  tolerances,
  evalAverage,
  randomAverage,
  evalSeedResults,
  randomSeedResults,
  evalOk,
  randomOk,
) {
  const evalRows = buildDiffRows(
    evalAverage,
    profileConfig.baseline.eval,
    tolerances.eval,
    EVAL_REPORT_METRICS,
  );
  const randomRows = buildDiffRows(
    randomAverage,
    profileConfig.baseline.random,
    tolerances.random,
    RANDOM_REPORT_METRICS,
  );
  const profileScore = computeProfileScore(evalRows, randomRows);
  return {
    profile: profileName,
    config: profileConfig.config,
    evalOk,
    randomOk,
    evalRows,
    randomRows,
    profileScore,
    evalSeedMetrics: buildSeedMetricsRows(evalSeedResults, EVAL_REPORT_METRICS),
    randomSeedMetrics: buildSeedMetricsRows(randomSeedResults, RANDOM_REPORT_METRICS),
  };
}

// Log tolerance comparison results and return gate status.
function logComparisonResults(comparisons) {
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
  return allOk;
}

// Resolve report output paths, defaulting JSON/Markdown next to the txt report.
function resolveReportPaths(options, txtPath) {
  const defaultBase = txtPath.endsWith('.txt') ? txtPath.slice(0, -4) : txtPath;
  return {
    txtPath,
    jsonPath: options && options.reportJsonPath
      ? options.reportJsonPath
      : `${defaultBase}.json`,
    markdownPath: options && options.reportMarkdownPath
      ? options.reportMarkdownPath
      : `${defaultBase}.md`,
  };
}

async function main() {
  ensureFile(PYTHON, 'Python venv');
  ensureFile(PROMOTE, 'promote_best.py');
  ensureFile(ROLLOUT, 'regression_rollout.py');
  ensureFile(CONFIG_PATH, 'config.json');
  ensureFile(POLICY_BEST_PATH, 'policy_best.json');

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
      const runtimeProfile = {
        ...profile,
        config: buildProfileConfig(profileOptions),
      };
      const {
        evalAverage,
        randomAverage,
        evalSeedResults,
        randomSeedResults,
      } = await runProfile(profileName, profileOptions);
      const tolerances = profile.tolerances || DEFAULT_TOLERANCES;
      const comparisons = [
        compareSuite(`${profileName}.eval`, evalAverage, profile.baseline.eval, tolerances.eval),
        compareSuite(`${profileName}.random`, randomAverage, profile.baseline.random, tolerances.random),
      ];
      reportSections.push(buildProfileReportSection(
        profileName,
        runtimeProfile,
        tolerances,
        evalAverage,
        randomAverage,
        evalSeedResults,
        randomSeedResults,
        comparisons[0].ok,
        comparisons[1].ok,
      ));
      if (!logComparisonResults(comparisons)) {
        allOk = false;
      }
    }
    const reportPath = path.join(ROOT, 'debug', `regression_report_${Date.now()}.txt`);
    writeReport(reportPath, reportSections);
    const bundle = buildReportBundle(reportSections, options, allOk);
    const paths = resolveReportPaths(options, reportPath);
    writeJsonReport(paths.jsonPath, bundle);
    writeMarkdownReport(paths.markdownPath, bundle);
    console.log(`Diff report written to ${paths.txtPath}`);
    console.log(`JSON report written to ${paths.jsonPath}`);
    console.log(`Markdown report written to ${paths.markdownPath}`);
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
  const {
    evalAverage,
    randomAverage,
    evalSeedResults,
    randomSeedResults,
  } = await runProfile(profileName, profileOptions);

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
  const runtimeProfile = {
    ...profile,
    config: buildProfileConfig(profileOptions),
  };
  const comparisons = [
    compareSuite(`${profileName}.eval`, evalAverage, profile.baseline.eval, tolerances.eval),
    compareSuite(`${profileName}.random`, randomAverage, profile.baseline.random, tolerances.random),
  ];

  const section = buildProfileReportSection(
    profileName,
    runtimeProfile,
    tolerances,
    evalAverage,
    randomAverage,
    evalSeedResults,
    randomSeedResults,
    comparisons[0].ok,
    comparisons[1].ok,
  );
  const reportPath = path.join(ROOT, 'debug', `regression_report_${Date.now()}.txt`);
  writeReport(reportPath, [section]);
  const allOk = logComparisonResults(comparisons);
  const bundle = buildReportBundle([section], options, allOk);
  const paths = resolveReportPaths(options, reportPath);
  writeJsonReport(paths.jsonPath, bundle);
  writeMarkdownReport(paths.markdownPath, bundle);
  console.log(`Diff report written to ${paths.txtPath}`);
  console.log(`JSON report written to ${paths.jsonPath}`);
  console.log(`Markdown report written to ${paths.markdownPath}`);

  if (!allOk) {
    process.exit(1);
  }
}

main().catch((error) => {
  if (error && error.stack) {
    console.error(error.stack);
  } else {
    console.error(String(error));
  }
  process.exit(1);
});
