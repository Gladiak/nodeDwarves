#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const config = require('../config.json');
const { buildLegendSections } = require('../src/render/legend');
const { buildLegendPanel, applyLegendPanel, moveLegendPage } = require('../src/render/legend_panel');
const { getColorConfig } = require('../src/render/colors');
const { visibleLength } = require('../src/utils');
const clone = (value) => JSON.parse(JSON.stringify(value));

// Prove every configured surface/deep entry is reachable, with exact bounds and color spans.
function validateAllEntries() {
  const originalRandom = Math.random;
  Math.random = () => { throw new Error('Legend rendering consumed simulation RNG'); };
  try {
    for (const [gridWidth, gridHeight] of [[118, 38], [78, 28], [78, 22], [58, 18], [32, 12]]) {
      for (const depth of [0, 1]) {
        const state = { ui: { legend: { open: true, page: 0 } },
          underrealm: { enabled: true, maxUnlockedDepth: 2, activeDepth: depth } };
        const runtime = { gridWidth, gridHeight };
        const sections = buildLegendSections(config, { detailed: true, underrealmActive: depth > 0 });
        const expected = [...sections.legendParts, ...sections.terrainParts];
        const first = buildLegendPanel(state, config, runtime);
        const rendered = [];
        for (let page = 0; page < first.pageCount; page += 1) {
          state.ui.legend.page = page;
          const before = JSON.stringify(state);
          const panel = buildLegendPanel(state, config, runtime);
          assert.equal(JSON.stringify(state), before, 'rendering must not mutate UI or simulation state');
          assert.equal(panel.page, page);
          assert.equal(panel.lines.length, panel.height);
          assert(panel.x >= 0 && panel.x + panel.width <= gridWidth);
          assert(panel.y >= 0 && panel.y + panel.height <= gridHeight);
          for (const line of panel.lines) {
            assert.equal(visibleLength(line.text), panel.width);
            assert((line.spans || []).every((span) => span.start >= 0 && span.end <= line.text.length
              && span.end > span.start));
          }
          const grid = Array.from({ length: gridHeight }, () => Array(gridWidth).fill(' '));
          applyLegendPanel(grid, panel, getColorConfig(config));
          assert(grid.every((row) => row.length === gridWidth));
          rendered.push(...panel.lines.map((line) => line.text));
        }
        const text = rendered.join('\n');
        for (const entry of expected) assert(text.includes(entry.text), `unreachable ${entry.text} at ${gridWidth}x${gridHeight}`);
        if (gridWidth >= 78 && gridHeight >= 28) assert.equal(first.pageCount, 1, 'normal popup must fit every default symbol');
        if (first.pageCount > 1) assert(text.includes('[arrows]'), 'overflow needs visible navigation');
      }
    }
  } finally { Math.random = originalRandom; }
}

// Keep long labels intact and clamp stale pages when resize or layer changes reduce the page count.
function validateOverflowAndNavigation() {
  const state = { ui: { legend: { open: true, page: 0 } }, underrealm: { activeDepth: 0 } };
  const small = { gridWidth: 58, gridHeight: 12 };
  const panel = buildLegendPanel(state, config, small);
  assert(panel.pageCount > 1);
  assert(moveLegendPage(state, config, small, -1));
  assert.equal(state.ui.legend.page, panel.pageCount - 1);
  moveLegendPage(state, config, small, 1);
  assert.equal(state.ui.legend.page, 0);
  state.ui.legend.page = 999;
  assert.equal(buildLegendPanel(state, config, { gridWidth: 118, gridHeight: 38 }).page, 0);
  state.ui.legend.page = NaN;
  assert.equal(buildLegendPanel(state, config, small).page, 0);
  const custom = clone(config);
  custom.landmarks.definitions.great_hall.label = 'X'.repeat(90);
  const expected = buildLegendSections(custom, { detailed: true }).legendParts.find((entry) => entry.text.includes('XXXXX')).text;
  state.ui.legend.page = 0;
  const first = buildLegendPanel(state, custom, small); const pieces = [];
  for (let page = 0; page < first.pageCount; page += 1) {
    state.ui.legend.page = page;
    pieces.push(...buildLegendPanel(state, custom, small).lines.slice(1, -2)
      .map((line) => line.separator ? '' : line.text.slice(4, -3).trimEnd()));
  }
  assert(pieces.join('').includes(expected), 'wrapping must preserve all long-label characters across pages');
  state.ui.legend.open = false;
  assert.equal(moveLegendPage(state, config, small, 1), false);
  assert.equal(buildLegendPanel(state, config, small), null);
  state.ui.legend.open = true;
  custom.display.legend_panel.enabled = false;
  assert.equal(buildLegendPanel(state, custom, small), null);
  assert.equal(buildLegendPanel(state, config, { gridWidth: 7, gridHeight: 3 }), null);
}

// Exercise the real application dispatcher without booting or stepping the simulation.
function validateArrowDispatch() {
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const handler = source.slice(source.indexOf('function handleInput(text) {'));
  const state = { ui: { legend: { open: true, page: 0 }, eventLog: { open: false } },
    underrealm: { enabled: true, maxUnlockedDepth: 2, activeDepth: 0 } };
  let depthChanges = 0;
  const context = { state, config, runtime: { gridWidth: 58, gridHeight: 12 }, moveLegendPage,
    getTransitionState: () => null, ensureEventLogState: () => {},
    shiftUnderrealmDepth: () => { depthChanges += 1; } };
  vm.runInNewContext(handler, context);
  for (const sequence of ['\u001b[C', '\u001b[B']) {
    const before = state.ui.legend.page; context.handleInput(sequence);
    assert.equal(state.ui.legend.page, before + 1);
  }
  for (const sequence of ['\u001b[D', '\u001b[A']) context.handleInput(sequence);
  assert.equal(state.ui.legend.page, 0);
  assert.equal(depthChanges, 0, 'legend arrows must not change map depth');
  state.ui.legend.open = false;
  context.handleInput('\u001b[B');
  assert.equal(depthChanges, 1, 'closed legend must restore normal depth controls');
}

validateAllEntries();
validateOverflowAndNavigation();
validateArrowDispatch();
process.stdout.write('Legend panel: PASS all_symbols surface_underrealm adaptive_columns pagination resize colors long_labels arrow_dispatch RNG_purity\n');
