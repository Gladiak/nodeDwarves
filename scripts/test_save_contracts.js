#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { spawnSync } = require('child_process');
const { isDeepStrictEqual } = require('util');
const baseConfig = require('../config.json');
const { createGameSession, advanceGameSession, resolveScenario } = require('../src/game_session');
const { createSessionRandom, withSessionRandom } = require('../src/session_random');
const { encodeSave, decodeSave, getSaveSettings, saveGame, loadGame, listSavedGames } = require('../src/persistence');
const { renderStartMenu, showStartMenu } = require('../src/runtime/start_menu');
const { createTimeControls, resetTimeControlsForTransition, observeStoryFocus } = require('../src/runtime/time_controls');
const { runEndgameReset } = require('../src/simulation/endgame');
const { buildCurrentChronicleSnapshot } = require('../src/simulation/chronicle');
const events = require('../src/simulation/endgame_events');
const { loadPolicy, selectAction } = require('../src/ai_policy');
const { buildObservation } = require('../src/ai/observation');
const { createTerrain } = require('../src/state/terrain');
const { updateSeason } = require('../src/simulation/season');
const { buildGridBase } = require('../src/render/grid');
const { getColorConfig } = require('../src/render/colors');
const { getTerrainColors } = require('../src/render/map_readability');

const runtime = { gridWidth: 60, gridHeight: 30, playableArea: 1800,
  totalWidth: 60, totalHeight: 30, frameEnabled: false, mapInset: null };
const appSource = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

// Use the real terminal transition and presentation functions without starting the app.
function appHelpers(session) {
  const context = {
    session, structuredClone, Date, createTimeControls, resetTimeControlsForTransition,
    timeControls: createTimeControls(session.config), buildCurrentChronicleSnapshot,
    DEFAULT_ENDGAME_MESSAGES: ['The caravan departs.'], runEndgameReset,
    ...events,
    ensureInspectState() {}, ensureLegendState() {}, ensureTelemetryPanelState() {},
    ensureWarriorPanelState() {}, ensureEventLogState() {}, ensureSaveMapState() {},
    closeSaveMap(state) { Object.assign(state.ui.saveMap, { open: false, busy: false, message: '', closeAtMs: 0 }); },
    clampUnit: (value) => Math.min(1, Math.max(0, Number(value || 0))),
  };
  const source = appSource.slice(appSource.indexOf('function getTransitionState('),
    appSource.indexOf('// Function: buildFailureMessage.'))
    + appSource.slice(appSource.indexOf('function capturePresentation('), appSource.indexOf('// Save only at frame boundaries'))
    + appSource.slice(appSource.indexOf('function parseStartupOptions('), appSource.indexOf('// Store wall-clock protection'));
  // Compile repository functions in this realm so prototype identity remains meaningful.
  return Function(...Object.keys(context), `${source}\nreturn { startEndgameTransition, advanceEndgameTransition, capturePresentation, restorePresentation, parseStartupOptions };`)(...Object.values(context));
}

// Fail compactly for large worlds while checking all saved state, not just counters.
function assertSessionEqual(actual, expected, label) {
  assert(isDeepStrictEqual(actual, expected), `${label}: complete session differs`);
  for (const dwarf of actual.state.dwarves) {
    if (!dwarf.job) continue;
    const expectedJob = expected.state.jobs.find((job) => job === expected.state.dwarves.find((entry) => entry.id === dwarf.id)?.job);
    if (expectedJob) assert(actual.state.jobs.includes(dwarf.job), 'Shared live job reference was detached');
  }
}

// Interpret terminal background colors so foreground resets cannot hide grey text patches.
function readBackgroundCells(frame) {
  let background = 'terminal-default';
  let foreground = 'terminal-default';
  const rows = [[]];
  for (const token of frame.match(/\x1b\[[0-9;]*m|[^\x1b]/gu) || []) {
    if (token.startsWith('\x1b')) {
      const codes = token.slice(2, -1).split(';').map(Number);
      for (let index = 0; index < codes.length; index += 1) {
        const code = codes[index];
        if (code === 0 || code === 49) background = 'terminal-default';
        if (code === 0 || code === 39) foreground = 'terminal-default';
        if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) foreground = `ansi:${code}`;
        if ((code === 38 || code === 48) && codes[index + 1] === 2) {
          if (code === 48) background = codes.slice(index + 2, index + 5).join(',');
          else foreground = codes.slice(index + 2, index + 5).join(',');
          index += 4;
        } else if ((code === 38 || code === 48) && codes[index + 1] === 5) {
          if (code === 48) background = `indexed:${codes[index + 2]}`;
          else foreground = `indexed:${codes[index + 2]}`;
          index += 2;
        }
      }
    } else if (token === '\n') rows.push([]);
    else rows[rows.length - 1].push({ char: token, background, foreground });
  }
  return rows;
}

// Compare visible atlas terrain with the gameplay renderer, including seasonal and theme overrides.
function homeTerrainPaletteContracts() {
  const model = { title: 'A MOUNTAIN AWAITS', selected: 0, items: [{ label: '[N] New colony' }] };
  const width = 140; const height = 60;
  for (const variant of ['active-theme', 'custom-theme', 'seasons-disabled']) {
    const config = structuredClone(baseConfig);
    config.display.terrain.seed = config.startup.background_seed;
    if (variant === 'seasons-disabled') config.seasons.enabled = false;
    if (variant === 'custom-theme') {
      config.display.themes[config.display.theme].colors.map.terrain_forest_winter_ice = '\x1b[38;2;110;140;150m';
    }
    const mapRuntime = { gridWidth: width, gridHeight: height, mapInset: null };
    const terrain = withSessionRandom(createSessionRandom(707), () => createTerrain(config, mapRuntime));
    const gameState = { terrain, tick: 1, roads: null };
    updateSeason(gameState, config);
    const gameplay = buildGridBase(gameState, config, mapRuntime, getTerrainColors(config, getColorConfig(config)), '.');
    const expected = readBackgroundCells(gameplay.map((row) => row.join('')).join('\n'));
    const actual = readBackgroundCells(renderStartMenu(model, width, height, config));
    // These rows are above the gatehouse, villages and decorative road network.
    for (let y = 1; y <= 10; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        assert.deepEqual(actual[y][x], expected[y][x], `${variant}: home/game terrain mismatch at ${x},${y}`);
      }
    }
  }
}

// Check the actual colored gatehouse, including letters, spaces and custom foreground resets.
function gatehouseContracts() {
  const model = { title: 'A MOUNTAIN AWAITS', selected: 0, message: '', items: [
    { label: '[N] New colony', detail: 'Choose a free colony or a configured scenario.' },
    { label: '[L] Load colony' }, { label: '[C] Continue latest' }, { label: '[Q] Quit' },
  ] };
  const config = structuredClone(baseConfig);
  config.display.colors.map.menu_text = '\x1b[0m' + config.display.colors.map.menu_text;
  const nativeRandom = Math.random;
  for (const [width, height] of [[190, 60], [120, 45], [100, 37], [80, 30], [80, 28], [60, 24], [40, 16], [24, 12]]) {
    const frame = renderStartMenu(model, width, height, config);
    assert.strictEqual(Math.random, nativeRandom, 'Gatehouse leaked its decorative random stream');
    const rows = readBackgroundCells(frame);
    assert.equal(rows.length, height);
    assert(rows.every((row) => row.length === width));
    for (const [phrase, background] of [['[N] New colony', 'terminal-default'], ['[L] Load colony', 'terminal-default']]) {
      const row = rows.find((cells) => cells.map((cell) => cell.char).join('').includes(phrase));
      if (width < 40) continue;
      assert(row, `${width}x${height} hid a primary menu option`);
      const index = row.map((cell) => cell.char).join('').indexOf(phrase);
      assert(row.slice(index, index + phrase.length).every((cell) => cell.background === background),
        `${width}x${height} used a different background behind menu letters`);
      assert.equal(row[index + phrase.length].background, background, 'Text and adjacent padding have different backgrounds');
    }
  }
  const large = renderStartMenu(model, 120, 45);
  assert(large.includes('THE GATEHOUSE') && large.includes('\u25c6') && large.includes('\u2502'));
}

// Exercise real input listeners and fragmented escape sequences with a fake terminal.
async function menuContracts(settings) {
  const input = new EventEmitter();
  Object.assign(input, { isTTY: true, setEncoding() {}, setRawMode() {}, resume() {} });
  const output = new EventEmitter();
  Object.assign(output, { columns: 100, rows: 38, write() {} });
  const choice = showStartMenu(baseConfig, settings, { input, output });
  input.emit('data', 'n');
  input.emit('data', '\x1b'); input.emit('data', '['); input.emit('data', 'B');
  input.emit('data', '\r\r');
  assert.equal((await choice).scenarioId, 'green_valley');
  assert.equal(input.listenerCount('data'), 0);
  assert.equal(output.listenerCount('resize'), 0);
  const load = showStartMenu(baseConfig, settings, { input, output });
  input.emit('data', 'l\r');
  assert.equal((await load).loaded.session.scenario.id, 'free');
  for (const [width, height] of [[120, 45], [80, 30], [40, 16], [24, 12]]) {
    const frame = renderStartMenu({ title: 'THE HOLD ARCHIVES', selected: 10, message: '',
      items: Array.from({ length: 20 }, (_, index) => ({ label: `Colony ${index}`, detail: 'A remembered hold.' })) }, width, height);
    const rows = frame.split('\n');
    assert.equal(rows.length, height);
    assert(rows.every((row) => row.length === width));
    assert(frame.includes('> Colony 10'), 'Selected item is not visible');
    assert(!frame.includes('\x1b'), 'ASCII view contains terminal escape injection');
  }
}

// Run short save, crash-recovery, policy and transition checks together at the milestone.
async function main() {
  const watchdog = setTimeout(() => { throw new Error('Save contracts stalled while awaiting terminal input.'); }, 120000);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nodedwarves-save-contracts-'));
  const settings = { ...getSaveSettings(baseConfig), directory };
  const nativeRandom = Math.random;
  try {
    const config = structuredClone(baseConfig);
    Object.assign(config.endgame.transition, { fadeOutTicks: 2, holdTicks: 2, fadeInTicks: 2 });
    const session = createGameSession(config, runtime, { seed: 101 });
    for (let i = 0; i < 75; i += 1) advanceGameSession(session);
    const job = session.state.dwarves.find((dwarf) => dwarf.job && session.state.jobs.includes(dwarf.job));
    assert(job, 'Fixture did not exercise a shared active job');
    session.state.saveSentinels = { nan: NaN, infinity: Infinity, absent: undefined,
      minusZero: -0, typed: new Int32Array([1, 2, -1]), values: new Set(['stone']) };
    const serialized = encodeSave(session);
    const restored = decodeSave(serialized).session;
    assertSessionEqual(restored, session, 'Graph round trip');
    assert.strictEqual(restored.state.lastConfig, restored.config);
    assert.strictEqual(Math.random, nativeRandom);
    assert.throws(() => withSessionRandom(createSessionRandom(0), () => { throw new Error('scope failure'); }), /scope failure/);
    assert.strictEqual(Math.random, nativeRandom);
    delete session.state.saveSentinels; delete restored.state.saveSentinels;
    const beforeRandom = { ...session.random };
    const filePath = saveGame(session, settings, 'manual');
    assert.deepEqual(session.random, beforeRandom, 'Saving consumed gameplay RNG');
    const observation = buildObservation(session.state, session.config);
    assert.deepEqual(buildObservation(loadGame(filePath, settings).session.state, session.config), observation);
    for (let i = 0; i < 90; i += 1) { advanceGameSession(session); advanceGameSession(restored); }
    assertSessionEqual(restored, session, 'Autonomous continuation');

    const policy = loadPolicy(path.join(__dirname, '../models/policy_best.json'));
    assert(policy, 'Missing canonical policy');
    const governed = createGameSession(config, runtime, { seed: 303, policy });
    for (let i = 0; i < 27; i += 1) advanceGameSession(governed);
    const governedCopy = decodeSave(encodeSave(governed)).session;
    assert.deepEqual(selectAction(governedCopy.state, governedCopy.config, governedCopy.policy),
      selectAction(governed.state, governed.config, governed.policy));
    assert.deepEqual(governedCopy.controller, governed.controller);
    for (let i = 0; i < 65; i += 1) { advanceGameSession(governed); advanceGameSession(governedCopy); }
    assertSessionEqual(governedCopy, governed, 'Canonical policy continuation');
    const policyFile = saveGame(governed, settings);
    const worker = spawnSync(process.execPath, ['-e', `
      const { loadGame, saveGame } = require('./src/persistence');
      const { advanceGameSession } = require('./src/game_session');
      const settings = JSON.parse(process.argv[2]);
      const session = loadGame(process.argv[1], settings).session;
      for (let index = 0; index < 150; index += 1) advanceGameSession(session);
      saveGame(session, settings);
    `, policyFile, JSON.stringify(settings)], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 60000 });
    assert.equal(worker.status, 0, worker.stderr || worker.error?.message);
    for (let i = 0; i < 150; i += 1) advanceGameSession(governed);
    assertSessionEqual(loadGame(policyFile, settings).session, governed, 'Fresh-process canonical policy continuation');

    saveGame(session, settings, 'autosave');
    assert(fs.existsSync(`${filePath}.bak`));
    fs.writeFileSync(filePath, 'interrupted checkpoint');
    const recovered = loadGame(filePath, settings);
    assert(recovered.recovered);
    assert.equal(recovered.session.state.tick, 75);
    saveGame(session, settings);
    assert.equal(loadGame(`${filePath}.bak`, settings).session.state.tick, 75, 'Good backup was overwritten by corrupt primary');
    const goodText = fs.readFileSync(filePath, 'utf8');
    const originalRename = fs.renameSync;
    try {
      fs.renameSync = (source, target) => {
        if (target === filePath) throw new Error('Injected atomic replacement failure');
        return originalRename(source, target);
      };
      assert.throws(() => saveGame(session, settings), /atomic replacement failure/);
    } finally { fs.renameSync = originalRename; }
    assert.equal(fs.readFileSync(filePath, 'utf8'), goodText, 'Failed replacement damaged the existing checkpoint');
    assert.throws(() => saveGame(session, { ...settings, maxBytes: 32 }), /max_save_bytes/);
    assert.equal(fs.readFileSync(filePath, 'utf8'), goodText);
    assert.throws(() => saveGame(session, { ...settings, enabled: false }), /disabled/);
    const damaged = JSON.parse(goodText); damaged.data = damaged.data.slice(0, -4) + 'AAAA';
    assert.throws(() => decodeSave(JSON.stringify(damaged)), /checksum/);
    const version = JSON.parse(goodText); version.version = 999;
    assert.throws(() => decodeSave(JSON.stringify(version)), /version/);
    const incompatible = JSON.parse(goodText); incompatible.engine = 'old-engine';
    delete incompatible.checksum;
    incompatible.checksum = require('crypto').createHash('sha256').update(JSON.stringify(incompatible)).digest('hex');
    assert.throws(() => decodeSave(JSON.stringify(incompatible)), /original game build/);
    assert.throws(() => loadGame(filePath, { ...settings, maxBytes: 16 }), /too large/);
    assert(!fs.readdirSync(directory).some((name) => name.endsWith('.tmp')));

    for (const phase of ['fadeOut', 'hold', 'fadeIn']) {
      const original = createGameSession(config, runtime, { seed: 202 });
      const driver = appHelpers(original);
      withSessionRandom(original.random, () => driver.startEndgameTransition(original.state, original.config, original.runtime));
      while (original.state.ui.transition.phase !== phase) {
        withSessionRandom(original.random, () => driver.advanceEndgameTransition(original.state, original.config, original.runtime));
      }
      withSessionRandom(original.random, () => driver.advanceEndgameTransition(original.state, original.config, original.runtime));
      const copy = decodeSave(encodeSave(original)).session;
      const copyDriver = appHelpers(copy);
      for (let i = 0; i < 8; i += 1) {
        withSessionRandom(original.random, () => driver.advanceEndgameTransition(original.state, original.config, original.runtime));
        withSessionRandom(copy.random, () => copyDriver.advanceEndgameTransition(copy.state, copy.config, copy.runtime));
      }
      for (let i = 0; i < 12; i += 1) { advanceGameSession(original); advanceGameSession(copy); }
      assertSessionEqual(copy, original, `Cycle transition ${phase}`);
      assert.equal(copy.state.cycleStats.count, 1);
    }

    const helpers = appHelpers(session);
    const controls = createTimeControls(config);
    controls.levelIndex = 3; controls.manualPaused = true; controls.pendingSteps = 1;
    observeStoryFocus(controls, { eventId: 'resume-story', importance: 'legendary' }, 1000);
    const presentation = helpers.capturePresentation(controls, 1500);
    const rebased = helpers.restorePresentation(presentation, config, 200, 100000);
    assert.equal(rebased.autoProtection.untilMs, 101900);
    assert.equal(rebased.levelIndex, 3);
    assert(rebased.manualPaused); assert.equal(rebased.pendingSteps, 1);
    assert.throws(() => helpers.parseStartupOptions(['--resume', '--new']), /Choose one/);
    assert.throws(() => helpers.parseStartupOptions(['--seed', '-1']), /Seed/);
    assert.throws(() => helpers.parseStartupOptions(['--load']), /Missing/);
    assert.equal(helpers.parseStartupOptions(['--scenario', 'green_valley']).newGame, true);

    const baseBefore = JSON.stringify(baseConfig);
    for (const preset of baseConfig.startup.scenarios) {
      const resolved = resolveScenario(baseConfig, preset.id);
      const world = createGameSession(baseConfig, runtime, { scenarioId: preset.id, seed: 404 });
      for (let i = 0; i < 30; i += 1) advanceGameSession(world);
      assert.equal(world.scenario.id, preset.id);
      assert.equal(resolved.config.resources.targets.food, baseConfig.resources.targets.food);
      assert.equal(resolved.config.population.aging.maxAge, baseConfig.population.aging.maxAge);
    }
    assert.equal(JSON.stringify(baseConfig), baseBefore);
    homeTerrainPaletteContracts();
    gatehouseContracts();
    await menuContracts(settings);
    assert.strictEqual(Math.random, nativeRandom);
    process.stdout.write('Save contracts: PASS graph identity, RNG, autonomous/AI resume, backups, corruption, bounds, all cycle phases, time controls, scenarios and ASCII menu\n');
  } finally {
    clearTimeout(watchdog);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
module.exports = { appHelpers, assertSessionEqual };
