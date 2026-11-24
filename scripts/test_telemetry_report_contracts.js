#!/usr/bin/env node
'use strict';

// Contracts for the plain-language telemetry panel ([h]): bounded rendering on every page and
// terminal size, read-only behaviour (no RNG, no simulation-state writes), verdict rules,
// config-driven thresholds, bounded trend history and lossless word wrapping.

const assert = require('assert/strict');
const { loadConfig } = require('../src/config');
const { buildRuntime } = require('../src/runtime');
const { createInitialState } = require('../src/state');
const { stepState } = require('../src/simulation');
const { getStockpileTarget } = require('../src/simulation/resources');
const { buildTelemetryPanel, getTelemetryPanelPageCount } = require('../src/telemetry/telemetry_panel');
const { collectColonyFacts, assessColony, buildColonyReport } = require('../src/telemetry/colony_report');
const { wrapLine } = require('../src/render/format');
const { visibleLength } = require('../src/utils');

const clone = (value) => JSON.parse(JSON.stringify(value));
const PAGE_IDS = ['status', 'economy', 'people', 'frontier'];

// Run a short seeded colony and sample telemetry history like the interactive renderer.
function buildColony(config, ticks) {
  let seed = 4242;
  const originalRandom = Math.random;
  Math.random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  try {
    const runtime = buildRuntime(config.display, { columns: 160, rows: 48 });
    const state = createInitialState(config, runtime);
    state.ui = state.ui || {};
    state.ui.telemetryPanel = { open: false, page: 0 };
    for (let tick = 0; tick < ticks; tick += 1) {
      stepState(state, config, runtime, {});
      if (tick % 10 === 0) {
        buildTelemetryPanel(state, config, runtime);
      }
    }
    return state;
  } finally {
    Math.random = originalRandom;
  }
}

// Strip render-only state so simulation state can be compared before and after rendering.
function simulationSnapshot(state) {
  const { renderState, ui, ...rest } = state;
  return JSON.stringify(rest);
}

// Every page renders inside the panel at every size, with valid spans, no RNG and no state writes.
function validateBoundedReadOnlyRendering(state, config) {
  assert.equal(getTelemetryPanelPageCount(), 5, 'expected Status, Economy, People, Frontier and Technical pages');
  const originalRandom = Math.random;
  Math.random = () => { throw new Error('telemetry rendering consumed simulation RNG'); };
  try {
    for (const [gridWidth, gridHeight] of [[198, 53], [140, 44], [100, 38], [72, 24]]) {
      for (let page = 0; page < getTelemetryPanelPageCount(); page += 1) {
        state.ui.telemetryPanel = { open: true, page };
        const before = simulationSnapshot(state);
        const panel = buildTelemetryPanel(state, config, { gridWidth, gridHeight });
        assert.equal(simulationSnapshot(state), before, 'rendering must not mutate simulation state');
        assert(panel, `page ${page} did not render at ${gridWidth}x${gridHeight}`);
        assert.equal(panel.lines.length, panel.height, 'panel height mismatch');
        assert(panel.x >= 0 && panel.x + panel.width <= gridWidth, 'panel exceeds grid width');
        assert(panel.y >= 0 && panel.y + panel.height <= gridHeight, 'panel exceeds grid height');
        for (const line of panel.lines) {
          assert.equal(visibleLength(line.text), panel.width, `line width mismatch on page ${page}`);
          for (const span of line.spans || []) {
            assert(span.start >= 0 && span.end <= line.text.length && span.start < span.end, 'span out of bounds');
          }
        }
        const text = panel.lines.map((line) => line.text).join('\n');
        assert(/OVERALL: (GOOD|WATCH|BAD)/.test(text), 'overall verdict missing');
        assert(!/undefined|NaN|;\./.test(text), `page ${page} rendered undefined/NaN or broken punctuation`);
      }
    }
  } finally {
    Math.random = originalRandom;
    state.ui.telemetryPanel = { open: false, page: 0 };
  }
}

// Low essentials or an active raid must turn the verdict BAD and lead the attention list.
function validateVerdictRules(state, config) {
  const healthy = clone(state);
  for (const id of ['food', 'water']) {
    healthy.stockpile[id] = Math.ceil(getStockpileTarget(healthy, config, id) * 2);
  }
  healthy.raid = { ...(healthy.raid || {}), active: false };
  const healthyAssessment = assessColony(collectColonyFacts(healthy, config, {}), config);
  const food = healthyAssessment.vitals.find((row) => row.label === 'Food');
  assert.equal(food.status, 'good', 'food at 200% of target should be GOOD');
  assert(!/[;,]\.$/.test(food.note), 'notes without trend history must end cleanly');

  const starving = clone(healthy);
  starving.stockpile.food = 0;
  const starvingAssessment = assessColony(collectColonyFacts(starving, config, {}), config);
  assert.equal(starvingAssessment.overall, 'bad', 'empty food stock should make the colony BAD');
  assert.equal(starvingAssessment.attention[0].status, 'bad', 'BAD items must come first');
  assert(starvingAssessment.attention[0].text.startsWith('Food'), 'food shortage should lead the attention list');

  const raided = clone(healthy);
  raided.raid = { ...(raided.raid || {}), active: true, ticksRemaining: 30 };
  const safety = assessColony(collectColonyFacts(raided, config, {}), config).vitals.find((row) => row.label === 'Safety');
  assert.equal(safety.status, 'bad', 'an active raid should make Safety BAD');

  const strict = clone(config);
  strict.display.telemetry_panel.status_thresholds = {
    ...(strict.display.telemetry_panel.status_thresholds || {}),
    stock_bad_ratio: 5,
    stock_watch_ratio: 5,
  };
  const strictFood = assessColony(collectColonyFacts(healthy, strict, {}), strict).vitals.find((row) => row.label === 'Food');
  assert.equal(strictFood.status, 'bad', 'config status_thresholds must override default stock thresholds');

  for (const pageId of PAGE_IDS) {
    const report = buildColonyReport(pageId, healthy, config, {});
    assert(report.blocks.length > 0, `${pageId} page has no blocks`);
    for (const block of report.blocks) {
      for (const row of block.rows || []) {
        assert(['good', 'watch', 'bad', 'info'].includes(row.status), `invalid status on ${pageId}`);
        assert(typeof row.label === 'string' && row.label.length > 0, `row without label on ${pageId}`);
      }
    }
  }
}

// Trend history is sampled on a fixed interval and bounded by history_points.
function validateHistoryBounds(state, config) {
  const history = state.renderState && state.renderState.telemetryReportHistory;
  const settings = config.display.telemetry_panel.dashboard;
  assert(Array.isArray(history) && history.length >= 2, 'trend history was not sampled');
  assert(history.length <= settings.history_points, 'trend history exceeded history_points');
  for (let index = 1; index < history.length; index += 1) {
    assert(history[index].tick - history[index - 1].tick >= settings.snapshot_interval_ticks, 'history sampled too often');
  }
}

// Word wrapping keeps every character of the original text.
function validateLosslessWrap() {
  const samples = [
    'Critically low: dwarves may starve; down 23 pts in a year.',
    'Quick health check. GOOD = fine, WATCH = slipping, BAD = act now.',
    'averyveryverylongtokenwithoutspaces then words',
  ];
  for (const sample of samples) {
    for (const width of [8, 12, 19, 30]) {
      const rows = wrapLine(sample, width);
      assert(rows.every((row) => visibleLength(row) <= width), `wrapped row wider than ${width}`);
      assert.equal(rows.join(' ').replace(/\s+/g, ''), sample.replace(/\s+/g, ''), `wrap lost characters at width ${width}`);
    }
  }
}

function main() {
  const config = loadConfig();
  const state = buildColony(config, 1500);
  validateBoundedReadOnlyRendering(state, config);
  validateVerdictRules(state, config);
  validateHistoryBounds(state, config);
  validateLosslessWrap();
  console.log('[test:telemetry-report] PASS bounded_pages read_only no_rng verdict_rules config_thresholds history_bounds lossless_wrap');
}

main();
