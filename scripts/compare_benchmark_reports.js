#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_BASELINE_PATH = path.join(
  ROOT,
  'benchmark_cache',
  'headless_benchmark_baseline.json',
);
const DEFAULT_CANDIDATE_PATH = path.join(ROOT, 'debug', 'headless_benchmark_candidate.json');
const SUPPORTED_OUTPUT = new Set(['table', 'json', 'both']);

const METRICS = [
  { key: 'population', label: 'population', decimals: 1 },
  { key: 'morale', label: 'morale', decimals: 4 },
  { key: 'beerBoost', label: 'beerBoost', decimals: 4 },
  { key: 'hunger', label: 'hunger', decimals: 4 },
  { key: 'thirst', label: 'thirst', decimals: 4 },
  { key: 'underrealmDepth', label: 'underDepth', decimals: 2 },
  { key: 'underrealmChampions', label: 'underChamp', decimals: 2 },
  { key: 'underrealmFailedExpeditions', label: 'underFail', decimals: 2 },
  { key: 'underrealmBlockedDispatches', label: 'underBlocked', decimals: 2 },
  { key: 'underrealmFrontierContested', label: 'underContested', decimals: 2 },
  { key: 'underrealmReadinessScore', label: 'underReadiness', decimals: 3 },
  { key: 'underrealmHeroPromotions', label: 'underHeroProm', decimals: 2 },
  { key: 'underrealmHeroLosses', label: 'underHeroLoss', decimals: 2 },
  { key: 'underrealmHeroActive', label: 'underHeroAct', decimals: 2 },
  { key: 'underrealmHeroSurvivals', label: 'underHeroSurv', decimals: 2 },
];

// Print CLI usage with examples.
function printHelp() {
  const lines = [
    'Compare two headless benchmark report JSON files.',
    'Includes summary/seed deltas plus schism decree usage deltas when available.',
    '',
    'Usage:',
    '  node scripts/compare_benchmark_reports.js [options]',
    '',
    'Options:',
    `  --baseline <path>          Baseline report path (default: ${DEFAULT_BASELINE_PATH})`,
    `  --candidate <path>         Candidate report path (default: ${DEFAULT_CANDIDATE_PATH})`,
    '  --baseline-variant <label> Baseline variant label to compare (default: first variant)',
    '  --candidate-variant <label> Candidate variant label to compare (default: first variant)',
    '  --resources <a,b,c>        Resource ids for deltas (default: shared keys)',
    '  --output <table|json|both> Stdout format (default: table)',
    '  --report-json <path>       Write comparison payload JSON to file',
    '  --report-md <path>         Write comparison markdown to file',
    '  --help                     Show this help',
    '',
    'Examples:',
    '  node scripts/compare_benchmark_reports.js',
    '  node scripts/compare_benchmark_reports.js --baseline debug/base.json --candidate debug/cand.json',
    '  node scripts/compare_benchmark_reports.js --resources beer,food,water --output both',
    '',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

// Parse CLI arguments into comparison options.
function parseArgs(argv) {
  const options = {
    baselinePath: DEFAULT_BASELINE_PATH,
    candidatePath: DEFAULT_CANDIDATE_PATH,
    baselineVariant: '',
    candidateVariant: '',
    resources: [],
    output: 'table',
    reportJsonPath: '',
    reportMarkdownPath: '',
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--baseline') {
      options.baselinePath = resolveInputPath(argv[index + 1], '--baseline');
      index += 1;
      continue;
    }
    if (arg === '--candidate') {
      options.candidatePath = resolveInputPath(argv[index + 1], '--candidate');
      index += 1;
      continue;
    }
    if (arg === '--baseline-variant') {
      options.baselineVariant = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (arg === '--candidate-variant') {
      options.candidateVariant = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (arg === '--resources') {
      options.resources = parseList(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === '--output') {
      const output = String(argv[index + 1] || '').trim().toLowerCase();
      if (!SUPPORTED_OUTPUT.has(output)) {
        throw new Error('--output must be one of: table, json, both.');
      }
      options.output = output;
      index += 1;
      continue;
    }
    if (arg === '--report-json') {
      options.reportJsonPath = resolveOutputPath(argv[index + 1], '--report-json');
      index += 1;
      continue;
    }
    if (arg === '--report-md') {
      options.reportMarkdownPath = resolveOutputPath(argv[index + 1], '--report-md');
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

// Parse one comma-separated list argument.
function parseList(rawValue) {
  if (!rawValue) {
    return [];
  }
  return String(rawValue)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

// Resolve one required input path.
function resolveInputPath(rawValue, flag) {
  const value = String(rawValue || '').trim();
  if (!value) {
    throw new Error(`${flag} requires a path.`);
  }
  return path.resolve(process.cwd(), value);
}

// Resolve one optional output path.
function resolveOutputPath(rawValue, flag) {
  const value = String(rawValue || '').trim();
  if (!value) {
    throw new Error(`${flag} requires a path.`);
  }
  return path.resolve(process.cwd(), value);
}

// Read and parse one JSON report file.
function loadReport(filePath, role) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${role} report not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.variants) || parsed.variants.length === 0) {
    throw new Error(`${role} report has no variants: ${filePath}`);
  }
  return parsed;
}

// Pick one variant from report (by label or first entry).
function resolveVariant(report, desiredLabel, role) {
  const label = String(desiredLabel || '').trim();
  if (!label) {
    return report.variants[0];
  }
  const match = report.variants.find((variant) => String(variant && variant.label || '') === label);
  if (!match) {
    throw new Error(`${role} variant "${label}" not found in report.`);
  }
  return match;
}

// Compute one relative delta versus baseline.
function computeRelativeDelta(current, baseline) {
  const currentNumber = Number(current);
  const baselineNumber = Number(baseline);
  if (!Number.isFinite(currentNumber) || !Number.isFinite(baselineNumber)) {
    return null;
  }
  if (Math.abs(baselineNumber) <= 1e-9) {
    return null;
  }
  return (currentNumber - baselineNumber) / Math.abs(baselineNumber);
}

// Build one absolute+relative delta object.
function buildDelta(current, baseline) {
  const currentNumber = Number(current);
  const baselineNumber = Number(baseline);
  if (!Number.isFinite(currentNumber) || !Number.isFinite(baselineNumber)) {
    return { abs: null, rel: null };
  }
  return {
    abs: currentNumber - baselineNumber,
    rel: computeRelativeDelta(currentNumber, baselineNumber),
  };
}

// Build normalized share map from one counter map and total.
function buildCounterShareMap(counterMap, totalRaw) {
  const total = Math.max(0, Number(totalRaw || 0));
  const shares = {};
  for (const [key, valueRaw] of Object.entries(counterMap || {})) {
    const value = Math.max(0, Number(valueRaw || 0));
    shares[key] = total > 0 && Number.isFinite(value) ? value / total : 0;
  }
  return shares;
}

// Normalize one numeric counter map (drop non-finite/negative values).
function normalizeCounterMap(counterMap) {
  const normalized = {};
  for (const [keyRaw, valueRaw] of Object.entries(counterMap || {})) {
    const key = String(keyRaw || '').trim();
    const value = Number(valueRaw);
    if (!key || !Number.isFinite(value) || value <= 0) {
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
}

// Normalize schism decree summary payload from one benchmark summary.
function normalizeSchismDecreeSummary(summary) {
  const raw = summary && summary.schismDecrees && typeof summary.schismDecrees === 'object'
    ? summary.schismDecrees
    : {};
  const issuedTotal = Math.max(0, Number(raw.issuedTotal || 0));
  const activeTicksTotal = Math.max(0, Number(raw.activeTicksTotal || 0));
  const byId = normalizeCounterMap(raw.byId);
  const activeTicksById = normalizeCounterMap(raw.activeTicksById);
  return {
    issuedTotal,
    activeTicksTotal,
    byId,
    byIdShare: buildCounterShareMap(byId, issuedTotal),
    activeTicksById,
    activeTicksByIdShare: buildCounterShareMap(activeTicksById, activeTicksTotal),
  };
}

// Build schism decree usage deltas between candidate and baseline summaries.
function buildSchismDecreeDeltas(baselineSummary, candidateSummary) {
  const baseline = normalizeSchismDecreeSummary(baselineSummary);
  const candidate = normalizeSchismDecreeSummary(candidateSummary);
  const decreeIds = new Set([
    ...Object.keys(baseline.byId || {}),
    ...Object.keys(candidate.byId || {}),
    ...Object.keys(baseline.activeTicksById || {}),
    ...Object.keys(candidate.activeTicksById || {}),
  ]);
  const rows = Array.from(decreeIds)
    .sort((left, right) => left.localeCompare(right))
    .map((decreeId) => ({
      decreeId,
      issued: buildDelta(
        Number(candidate.byId && candidate.byId[decreeId] || 0),
        Number(baseline.byId && baseline.byId[decreeId] || 0),
      ),
      issuedShare: buildDelta(
        Number(candidate.byIdShare && candidate.byIdShare[decreeId] || 0),
        Number(baseline.byIdShare && baseline.byIdShare[decreeId] || 0),
      ),
      activeTicks: buildDelta(
        Number(candidate.activeTicksById && candidate.activeTicksById[decreeId] || 0),
        Number(baseline.activeTicksById && baseline.activeTicksById[decreeId] || 0),
      ),
      activeShare: buildDelta(
        Number(candidate.activeTicksByIdShare && candidate.activeTicksByIdShare[decreeId] || 0),
        Number(baseline.activeTicksByIdShare && baseline.activeTicksByIdShare[decreeId] || 0),
      ),
    }));
  return {
    issuedTotal: buildDelta(candidate.issuedTotal, baseline.issuedTotal),
    activeTicksTotal: buildDelta(candidate.activeTicksTotal, baseline.activeTicksTotal),
    rows,
  };
}

// Resolve resource ids used for comparison.
function resolveResourceIds(baselineSummary, candidateSummary, requestedResourceIds) {
  if (Array.isArray(requestedResourceIds) && requestedResourceIds.length > 0) {
    return requestedResourceIds.slice();
  }
  const baselineResourceKeys = Object.keys((baselineSummary && baselineSummary.resources) || {});
  const candidateResourceKeys = new Set(Object.keys((candidateSummary && candidateSummary.resources) || {}));
  return baselineResourceKeys.filter((resourceId) => candidateResourceKeys.has(resourceId));
}

// Build summary deltas for shared metrics and resources.
function buildSummaryDeltas(baselineSummary, candidateSummary, resourceIds) {
  const metricDeltas = {};
  for (const metric of METRICS) {
    metricDeltas[metric.key] = buildDelta(
      candidateSummary && candidateSummary[metric.key],
      baselineSummary && baselineSummary[metric.key],
    );
  }
  const resourceDeltas = {};
  const resourceRelValues = [];
  for (const resourceId of resourceIds) {
    const resourceDelta = buildDelta(
      candidateSummary
      && candidateSummary.resources
      && candidateSummary.resources[resourceId],
      baselineSummary
      && baselineSummary.resources
      && baselineSummary.resources[resourceId],
    );
    resourceDeltas[resourceId] = resourceDelta;
    if (Number.isFinite(resourceDelta.rel)) {
      resourceRelValues.push(resourceDelta.rel);
    }
  }
  const resourceAverageRel = resourceRelValues.length > 0
    ? resourceRelValues.reduce((sum, value) => sum + value, 0) / resourceRelValues.length
    : null;
  return {
    metrics: metricDeltas,
    resources: resourceDeltas,
    resourceAverageRel,
  };
}

// Build per-seed deltas for seeds shared by both reports.
function buildSeedDeltas(baselineRows, candidateRows, resourceIds) {
  const baselineBySeed = new Map((baselineRows || []).map((row) => [Number(row.seed), row]));
  const seedDeltas = [];
  for (const row of candidateRows || []) {
    const seed = Number(row && row.seed);
    if (!Number.isFinite(seed)) {
      continue;
    }
    const baselineRow = baselineBySeed.get(seed);
    if (!baselineRow) {
      continue;
    }
    seedDeltas.push({
      seed,
      deltas: buildSummaryDeltas(baselineRow, row, resourceIds),
    });
  }
  seedDeltas.sort((left, right) => left.seed - right.seed);
  return seedDeltas;
}

// Format one number with a fixed precision.
function formatNumber(value, decimals = 2) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  return Number(value).toFixed(Math.max(0, decimals));
}

// Format one signed delta number.
function formatSigned(value, decimals = 2) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  const numeric = Number(value);
  const sign = numeric > 0 ? '+' : '';
  return `${sign}${numeric.toFixed(Math.max(0, decimals))}`;
}

// Format one signed percentage delta.
function formatSignedPercent(value) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  const percent = Number(value) * 100;
  const sign = percent > 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
}

// Format one signed percentage-point delta from a [0,1] ratio.
function formatSignedPercentPoints(value) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  const points = Number(value) * 100;
  const sign = points > 0 ? '+' : '';
  return `${sign}${points.toFixed(2)}pp`;
}

// Build a markdown report for one comparison payload.
function renderMarkdown(payload) {
  const lines = [];
  lines.push('# Benchmark Report Diff');
  lines.push('');
  lines.push(`- baseline report: \`${payload.meta.baselineReportPath}\``);
  lines.push(`- candidate report: \`${payload.meta.candidateReportPath}\``);
  lines.push(`- baseline variant: \`${payload.meta.baselineVariantLabel}\``);
  lines.push(`- candidate variant: \`${payload.meta.candidateVariantLabel}\``);
  lines.push(`- compared seeds: \`${payload.meta.sharedSeeds.join(',') || 'none'}\``);
  lines.push('');
  lines.push('## Summary Deltas (candidate - baseline)');
  lines.push('');
  lines.push('| metric | abs | rel |');
  lines.push('| --- | ---: | ---: |');
  for (const metric of METRICS) {
    const delta = payload.summary.deltas.metrics[metric.key] || {};
    lines.push(
      `| ${metric.label} | ${formatSigned(delta.abs, metric.decimals)} | ${formatSignedPercent(delta.rel)} |`,
    );
  }
  if (payload.meta.resources.length > 0) {
    for (const resourceId of payload.meta.resources) {
      const delta = payload.summary.deltas.resources[resourceId] || {};
      lines.push(
        `| ${resourceId} | ${formatSigned(delta.abs, 1)} | ${formatSignedPercent(delta.rel)} |`,
      );
    }
  }
  lines.push(`| resource_avg_rel | n/a | ${formatSignedPercent(payload.summary.deltas.resourceAverageRel)} |`);
  lines.push('');
  if (payload.summary.schismDecrees) {
    lines.push('## Schism Decree Deltas');
    lines.push('');
    lines.push('| metric | abs | rel |');
    lines.push('| --- | ---: | ---: |');
    lines.push(
      `| decrees_issued_total | ${formatSigned(payload.summary.schismDecrees.issuedTotal.abs, 0)} | ${formatSignedPercent(payload.summary.schismDecrees.issuedTotal.rel)} |`,
    );
    lines.push(
      `| decrees_active_ticks_total | ${formatSigned(payload.summary.schismDecrees.activeTicksTotal.abs, 0)} | ${formatSignedPercent(payload.summary.schismDecrees.activeTicksTotal.rel)} |`,
    );
    if (payload.summary.schismDecrees.rows.length > 0) {
      lines.push('');
      lines.push('| decree | issued abs | issued rel | issued share delta | active ticks abs | active ticks rel | active share delta |');
      lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
      for (const decreeRow of payload.summary.schismDecrees.rows) {
        lines.push(
          `| ${decreeRow.decreeId} | ${formatSigned(decreeRow.issued.abs, 0)} | ${formatSignedPercent(decreeRow.issued.rel)} | ${formatSignedPercentPoints(decreeRow.issuedShare.abs)} | ${formatSigned(decreeRow.activeTicks.abs, 0)} | ${formatSignedPercent(decreeRow.activeTicks.rel)} | ${formatSignedPercentPoints(decreeRow.activeShare.abs)} |`,
        );
      }
    }
    lines.push('');
  }
  if (payload.seedDeltas.length > 0) {
    lines.push('## Seed Deltas');
    lines.push('');
    lines.push('| seed | metric | abs | rel |');
    lines.push('| ---: | --- | ---: | ---: |');
    for (const seedRow of payload.seedDeltas) {
      for (const metric of METRICS) {
        const delta = seedRow.deltas.metrics[metric.key] || {};
        lines.push(
          `| ${seedRow.seed} | ${metric.label} | ${formatSigned(delta.abs, metric.decimals)} | ${formatSignedPercent(delta.rel)} |`,
        );
      }
      for (const resourceId of payload.meta.resources) {
        const delta = seedRow.deltas.resources[resourceId] || {};
        lines.push(
          `| ${seedRow.seed} | ${resourceId} | ${formatSigned(delta.abs, 1)} | ${formatSignedPercent(delta.rel)} |`,
        );
      }
      lines.push(
        `| ${seedRow.seed} | resource_avg_rel | n/a | ${formatSignedPercent(seedRow.deltas.resourceAverageRel)} |`,
      );
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

// Print one comparison payload as plain-text table blocks.
function printTable(payload) {
  process.stdout.write('=== report diff ===\n');
  process.stdout.write(`baseline report: ${payload.meta.baselineReportPath}\n`);
  process.stdout.write(`candidate report: ${payload.meta.candidateReportPath}\n`);
  process.stdout.write(`baseline variant: ${payload.meta.baselineVariantLabel}\n`);
  process.stdout.write(`candidate variant: ${payload.meta.candidateVariantLabel}\n`);
  process.stdout.write(`shared seeds: ${payload.meta.sharedSeeds.join(',') || 'none'}\n`);
  process.stdout.write('\n');
  process.stdout.write('=== summary deltas candidate - baseline ===\n');
  for (const metric of METRICS) {
    const delta = payload.summary.deltas.metrics[metric.key] || {};
    process.stdout.write(
      `${metric.label} ${formatSigned(delta.abs, metric.decimals)} (${formatSignedPercent(delta.rel)})\n`,
    );
  }
  for (const resourceId of payload.meta.resources) {
    const delta = payload.summary.deltas.resources[resourceId] || {};
    process.stdout.write(
      `${resourceId} ${formatSigned(delta.abs, 1)} (${formatSignedPercent(delta.rel)})\n`,
    );
  }
  process.stdout.write(
    `resource_avg_rel ${formatSignedPercent(payload.summary.deltas.resourceAverageRel)}\n`,
  );
  if (payload.summary.schismDecrees) {
    process.stdout.write(
      `decrees_issued_total ${formatSigned(payload.summary.schismDecrees.issuedTotal.abs, 0)} (${formatSignedPercent(payload.summary.schismDecrees.issuedTotal.rel)})\n`,
    );
    process.stdout.write(
      `decrees_active_ticks_total ${formatSigned(payload.summary.schismDecrees.activeTicksTotal.abs, 0)} (${formatSignedPercent(payload.summary.schismDecrees.activeTicksTotal.rel)})\n`,
    );
    for (const decreeRow of payload.summary.schismDecrees.rows) {
      process.stdout.write(
        `decree ${decreeRow.decreeId}: issued ${formatSigned(decreeRow.issued.abs, 0)} (${formatSignedPercent(decreeRow.issued.rel)}), issued_share ${formatSignedPercentPoints(decreeRow.issuedShare.abs)}, active_ticks ${formatSigned(decreeRow.activeTicks.abs, 0)} (${formatSignedPercent(decreeRow.activeTicks.rel)}), active_share ${formatSignedPercentPoints(decreeRow.activeShare.abs)}\n`,
      );
    }
  }
  process.stdout.write('\n');
  if (payload.seedDeltas.length > 0) {
    process.stdout.write('=== seed deltas ===\n');
    for (const seedRow of payload.seedDeltas) {
      process.stdout.write(`seed ${seedRow.seed}\n`);
      for (const metric of METRICS) {
        const delta = seedRow.deltas.metrics[metric.key] || {};
        process.stdout.write(
          `  ${metric.label} ${formatSigned(delta.abs, metric.decimals)} (${formatSignedPercent(delta.rel)})\n`,
        );
      }
      for (const resourceId of payload.meta.resources) {
        const delta = seedRow.deltas.resources[resourceId] || {};
        process.stdout.write(
          `  ${resourceId} ${formatSigned(delta.abs, 1)} (${formatSignedPercent(delta.rel)})\n`,
        );
      }
      process.stdout.write(
        `  resource_avg_rel ${formatSignedPercent(seedRow.deltas.resourceAverageRel)}\n`,
      );
    }
  }
}

// Write one text payload to disk, creating parent folder when needed.
function writeFile(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
}

// Run the comparison CLI from process arguments.
function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const baselineReport = loadReport(options.baselinePath, 'baseline');
  const candidateReport = loadReport(options.candidatePath, 'candidate');

  const baselineVariant = resolveVariant(
    baselineReport,
    options.baselineVariant,
    'baseline',
  );
  const candidateVariant = resolveVariant(
    candidateReport,
    options.candidateVariant,
    'candidate',
  );

  const baselineSummary = baselineVariant.summary || {};
  const candidateSummary = candidateVariant.summary || {};
  const resourceIds = resolveResourceIds(
    baselineSummary,
    candidateSummary,
    options.resources,
  );

  const summaryDeltas = buildSummaryDeltas(
    baselineSummary,
    candidateSummary,
    resourceIds,
  );
  const schismDecreeDeltas = buildSchismDecreeDeltas(
    baselineSummary,
    candidateSummary,
  );
  const seedDeltas = buildSeedDeltas(
    baselineVariant.rows || [],
    candidateVariant.rows || [],
    resourceIds,
  );

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      baselineReportPath: options.baselinePath,
      candidateReportPath: options.candidatePath,
      baselineVariantLabel: String(baselineVariant.label || ''),
      candidateVariantLabel: String(candidateVariant.label || ''),
      resources: resourceIds,
      sharedSeeds: seedDeltas.map((row) => row.seed),
    },
    baseline: {
      summary: baselineSummary,
      rows: baselineVariant.rows || [],
    },
    candidate: {
      summary: candidateSummary,
      rows: candidateVariant.rows || [],
    },
    summary: {
      deltas: summaryDeltas,
      schismDecrees: schismDecreeDeltas,
    },
    seedDeltas,
  };

  if (options.output === 'table' || options.output === 'both') {
    printTable(payload);
  }
  if (options.output === 'json' || options.output === 'both') {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }

  if (options.reportJsonPath) {
    writeFile(options.reportJsonPath, `${JSON.stringify(payload, null, 2)}\n`);
    process.stdout.write(`Comparison JSON written to ${options.reportJsonPath}\n`);
  }
  if (options.reportMarkdownPath) {
    writeFile(options.reportMarkdownPath, renderMarkdown(payload));
    process.stdout.write(`Comparison Markdown written to ${options.reportMarkdownPath}\n`);
  }
}

main();
