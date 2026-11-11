#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const config = require('../config.json');
const { createGameSession, advanceGameSession } = require('../src/game_session');
const { createMapFlows, cycleMapFlows, observeMapFlows, getMapFlowOverlay } = require('../src/runtime/map_flows');
const { getTerrainColors, getStructureColorKey, readForeground } = require('../src/render/map_readability');
const { applyMapFlows } = require('../src/render/map_flows');
const { getScenarioPreview, fitScenarioPreview } = require('../src/render/scenario_preview');
const { getColorConfig } = require('../src/render/colors');
const { buildGridBase } = require('../src/render/grid');
const { renderFrame } = require('../src/render');
const { updateSeason } = require('../src/simulation/season');
const { showStartMenu } = require('../src/runtime/start_menu');
const { renderStartMenu } = require('../src/render/start_menu');
const { loadPolicy, selectAction } = require('../src/ai_policy');
const { buildObservation } = require('../src/ai/observation');
const { encodeSave, decodeSave, getSaveSettings } = require('../src/persistence');

const runtime = { gridWidth: 80, gridHeight: 30, playableArea: 2400,
  totalWidth: 80, totalHeight: 30, frameEnabled: false, mapInset: null };
const strip = (value) => value.replace(/\x1b\[[0-9;]*m/g, '');

// Check real background/foreground separation and keep actors, hazards and wayfinding intact.
function hierarchy() {
  const colors = getColorConfig(config);
  const original = structuredClone(colors);
  const terrain = getTerrainColors(config, colors);
  assert.notStrictEqual(terrain, colors);
  assert.deepEqual(colors, original);
  assert(Math.max(...readForeground(terrain.map.terrain_plain_winter_ice)) < Math.max(...readForeground(colors.map.terrain_plain_winter_ice)));
  for (const key of ['terrain_road', 'terrain_bridge', 'terrain_corridor', 'terrain_magma', 'terrain_shrine', 'dwarf', 'beast', 'nemesis', 'hud_header']) {
    assert.equal(terrain.map[key], colors.map[key], `Hierarchy dimmed ${key}`);
  }
  const disabled = structuredClone(config); disabled.display.map_readability.enabled = false;
  assert.strictEqual(getTerrainColors(disabled, colors), colors);
  assert.equal(getStructureColorKey(config, colors, 'house'), 'terrain_mountain_medium');
  assert.equal(getStructureColorKey(disabled, colors, 'house'), 'house');
  assert.deepEqual(readForeground('\x1b[38;5;244m'), [128, 128, 128]);
  assert.deepEqual(readForeground('\x1b[93m'), [255, 255, 85]);
}

// Observe known actual moves; gaps, teleports, transitions and decorative deep positions make no paths.
function flows() {
  const tracker = createMapFlows(config);
  const state = { tick: 1, cycleStats: { count: 0 }, dwarves: [
    { id: 'gather', x: 2, y: 3, job: { type: 'gather' } },
    { id: 'work', x: 8, y: 6, job: { type: 'build' } },
    { id: 'deep', x: 4, y: 5, underrealmDuty: { active: true, depth: 1 }, job: { type: 'gather' } },
  ], merchant: { phase: 'trade', x: 12, y: 7 } };
  assert.equal(cycleMapFlows(tracker), 'all');
  observeMapFlows(tracker, state, runtime);
  state.tick++; state.dwarves[0].x++; state.dwarves[1].y--; state.dwarves[2].x++; state.merchant.x--;
  observeMapFlows(tracker, state, runtime);
  const overlay = getMapFlowOverlay(tracker, state);
  assert.equal(overlay.cells.length, 3);
  assert(overlay.cells.some((cell) => cell.x === 3 && cell.symbol === '>' && cell.family === 'gather'));
  assert(overlay.cells.some((cell) => cell.x === 8 && cell.symbol === '^' && cell.family === 'work'));
  assert(overlay.cells.some((cell) => cell.x === 11 && cell.symbol === '<' && cell.family === 'trade'));
  const before = structuredClone(state);
  assert.deepEqual(getMapFlowOverlay(tracker, state), overlay);
  assert.deepEqual(state, before, 'Overlay changed the authoritative world');
  state.tick++; state.dwarves[0].x += 10;
  observeMapFlows(tracker, state, runtime);
  assert.equal(tracker.segments.size, 3, 'Teleport was shown as observed travel');
  state.tick += 2; state.dwarves[1].x++;
  observeMapFlows(tracker, state, runtime);
  assert.equal(tracker.segments.size, 3, 'Missing samples were interpolated');
  assert.equal(cycleMapFlows(tracker), 'gather');
  assert(getMapFlowOverlay(tracker, state).cells.every((cell) => cell.family === 'gather'));
  state.underrealm = { activeDepth: 1 };
  assert.deepEqual(getMapFlowOverlay(tracker, state).cells, []);
  assert.equal(getMapFlowOverlay(tracker, state).label, 'Surface only');
  state.underrealm.activeDepth = 0; state.tick += 200;
  observeMapFlows(tracker, state, runtime);
  assert.equal(tracker.segments.size, 0, 'Old flow marks did not expire');
  state.cycleStats.count++; state.tick = 0;
  assert.equal(getMapFlowOverlay(tracker, state).cells.length, 0, 'Reset world showed tracks from the previous cycle');
  observeMapFlows(tracker, state, runtime);
  assert.equal(tracker.previous.size, 3); assert.equal(tracker.segments.size, 0);

  const bounded = createMapFlows(config); bounded.mode = 'all'; bounded.maxSegments = 5; bounded.maxCells = 3;
  const moving = { tick: 0, dwarves: [{ id: 'x', x: 1, y: 1, job: { type: 'gather' } }] };
  for (let tick = 0; tick < 40; tick++) { moving.tick = tick; moving.dwarves[0].x = tick + 1; observeMapFlows(bounded, moving, runtime); }
  assert(bounded.segments.size <= 5); assert(getMapFlowOverlay(bounded, moving).cells.length <= 3);
  const grid = Array.from({ length: 10 }, () => Array(20).fill('.'));
  applyMapFlows(grid, { cells: [{ x: 3, y: 3, symbol: '>', colorKey: 'flow_gather' }] },
    { mapInset: { x: 2, y: 2, width: 4, height: 4 } }, getColorConfig(config));
  assert.equal(grid[3][3], '.', 'Flow painted over the Ops reserved area');
}

// Compare the preview against the actual initial terrain on every catalog entry, including palette/RNG.
function previews() {
  const random = Math.random;
  const colors = getColorConfig(config);
  for (const scenario of config.startup.scenarios) {
    const seed = scenario.seed ?? 101;
    const preview = getScenarioPreview(config, runtime, scenario.id, seed);
    const session = createGameSession(config, runtime, { scenarioId: scenario.id, seed });
    session.state.tick = 1;
    updateSeason(session.state, session.config);
    const expected = buildGridBase(session.state, session.config, runtime, getTerrainColors(session.config, colors), '.');
    assert.deepEqual(preview.grid, expected, `${scenario.id}: preview did not match the launched world`);
    assert.strictEqual(Math.random, random, 'Preview consumed or leaked gameplay randomness');
    const small = fitScenarioPreview(preview, 32, 10);
    assert(small.length <= 10 && small.every((row) => row.length <= 32));
    const model = { title: 'FOUND A NEW HOLD', selected: 11, preview, items: config.startup.scenarios.map((entry) => ({ label: entry.name, detail: entry.description })) };
    for (const [width, height] of [[190, 60], [142, 30], [100, 37], [80, 30], [40, 28], [24, 12]]) {
      const frame = renderStartMenu(model, width, height, config);
      const rows = strip(frame).split('\n');
      assert.equal(rows.length, height); assert(rows.every((row) => row.length === width), `${width}x${height}: preview changed frame width`);
      if (width >= 40 && height >= 28) assert(strip(frame).includes(`Seed:${seed}`));
      assert(strip(frame).includes('The Long Emergency'.slice(0, Math.max(1, width - 12))));
    }
    const expanded = strip(renderStartMenu({ ...model, previewExpanded: true }, 80, 30, config));
    assert(expanded.includes(`Seed:${seed}`)); assert(expanded.includes('Enter: start'));
  }
  const first = getScenarioPreview(config, runtime, 'free', 101);
  const second = getScenarioPreview(config, runtime, 'free', 202);
  assert.notDeepEqual(first.grid, second.grid);
}

// Use real raw-input dispatch to prove the displayed seed and geometry survive confirmation.
async function menu() {
  const input = new EventEmitter(); Object.assign(input, { isTTY: true, setEncoding() {}, setRawMode() {}, resume() {} });
  const output = new EventEmitter(); let text = '';
  Object.assign(output, { columns: 100, rows: 38, write(value) { text = strip(value); } });
  const choice = showStartMenu(config, getSaveSettings(config), { input, output });
  input.emit('data', 'n'); assert(text.includes('Seed:'));
  input.emit('data', 'p'); assert(text.includes('Enter: start'));
  input.emit('data', 'p'); input.emit('data', 'r');
  const shownSeed = Number(text.match(/Seed:(\d+)/)[1]);
  input.emit('data', '\r');
  const selected = await choice;
  assert.equal(selected.seed, shownSeed); assert(selected.runtime.gridWidth > 0);
  const actual = createGameSession(config, selected.runtime, selected);
  assert.equal(actual.scenario.seed, shownSeed);
}

// Model observations/actions and exact session state stay identical while presentation changes.
function isolationAndCompatibility() {
  const policy = loadPolicy(path.join(__dirname, '../models/policy_best.json'));
  const session = createGameSession(config, runtime, { seed: 101, policy });
  const control = decodeSave(encodeSave(session)).session;
  const controlRenderConfig = structuredClone(config);
  controlRenderConfig.display.map_readability.enabled = false;
  const tracker = createMapFlows(config); cycleMapFlows(tracker);
  for (let tick = 0; tick < 150; tick++) {
    observeMapFlows(tracker, session.state, runtime);
    assert.deepEqual(buildObservation(session.state, config), buildObservation(control.state, config));
    assert.deepEqual(selectAction(session.state, config, policy), selectAction(control.state, config, policy));
    if (tick % 10 === 0) {
      renderFrame(session.state, session.config, runtime, { mapFlows: getMapFlowOverlay(tracker, session.state) });
      // The existing visibility cache is presentation state; hold its render cadence equal in both views.
      renderFrame(control.state, controlRenderConfig, runtime);
    }
    advanceGameSession(session); advanceGameSession(control);
  }
  assert.deepEqual(session, control, 'Read-only map presentation changed the saved world or RNG');
  const body = JSON.parse(encodeSave(control));
  body.engine = '8060cbc9b1f391ff3462d5fe392574233d796eb2f0f1fc70796bbcd6959cbc52';
  delete body.compatibility; delete body.checksum;
  body.checksum = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
  assert.deepEqual(decodeSave(JSON.stringify(body)).session, control, 'v2.5.0 save compatibility was lost after UI changes');
}

async function main() {
  const watchdog = setTimeout(() => { throw new Error('Map presentation contracts stalled.'); }, 120000);
  try {
    hierarchy(); flows(); previews(); isolationAndCompatibility(); await menu();
    process.stdout.write('Map presentation: PASS hierarchy, observed flows, bounds, collision/layer guards, 12 exact previews, seed launch, v2.5 saves and AI/RNG isolation\n');
  } finally { clearTimeout(watchdog); }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
