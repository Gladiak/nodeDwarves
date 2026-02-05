'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { loadConfig } = require('./src/config');
const { buildRuntime, getTerminalSize, setupResizeHandler } = require('./src/runtime');
const { createInitialState, fitStateToGrid } = require('./src/state');
const { stepState } = require('./src/simulation');
const { renderFrame } = require('./src/render');
const { clearScreen, moveCursorHome, hideCursor, showCursor } = require('./src/terminal');
const { loadPolicy, selectAction } = require('./src/ai_policy');
const { getSpawnOrderedIds } = require('./src/dwarf_lore');

const config = loadConfig();
let runtime = buildRuntime(config.display, getTerminalSize(config.display));
const state = createInitialState(config, runtime);
const policyPath = resolvePolicyPath(config);
const policy = policyPath ? loadPolicy(policyPath) : null;
let currentAction = null;
let nextActionTick = 0;
let paused = false;

const tickMs = Number(config.display.tickMs || 200);
const maxTicks = Number(config.simulation.maxTicks || 0);

let running = true;

process.on('SIGINT', () => {
  running = false;
  shutdown();
});

setupResizeHandler(config.display, () => {
  runtime = buildRuntime(config.display, getTerminalSize(config.display));
  fitStateToGrid(state, runtime, config);
  clearScreen();
});

hideCursor();
clearScreen();
setupInput();
loop();

// Function: loop.
function loop() {
  if (!running) {
    return;
  }

  updateUiTimers(state, config);

  if (!paused) {
    if (policy && state.tick >= nextActionTick) {
      currentAction = selectAction(state, config, policy);
      nextActionTick = state.tick + getActionTicks(config);
    }

    stepState(state, config, runtime, currentAction);
  }

  const frame = renderFrame(state, config, runtime);
  moveCursorHome();
  process.stdout.write(frame);

  if (maxTicks > 0 && state.tick >= maxTicks) {
    running = false;
    shutdown();
    return;
  }

  setTimeout(loop, tickMs);
}

// Function: shutdown.
function shutdown() {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
  showCursor();
  process.stdout.write('\n');
  process.exit(0);
}

// Function: resolvePolicyPath.
function resolvePolicyPath(config) {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--ai' && args[i + 1]) {
      return args[i + 1];
    }
  }
  if (process.env.AI_POLICY) {
    return process.env.AI_POLICY;
  }
  const runtimeConfig = config.ai && config.ai.runtime;
  if (runtimeConfig && runtimeConfig.enabled && runtimeConfig.policyPath) {
    return runtimeConfig.policyPath;
  }
  return null;
}

// Function: getActionTicks.
function getActionTicks(config) {
  const aiConfig = config.ai || {};
  const ticks = Number(aiConfig.stepTicks || 1);
  return Math.max(1, ticks);
}

// Function: setupInput.
function setupInput() {
  if (!process.stdin.isTTY) {
    return;
  }
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (chunk) => {
    handleInput(chunk.toString('utf8'));
  });
}

// Function: ensureInspectState.
function ensureInspectState(state) {
  if (!state.ui) {
    state.ui = {};
  }
  if (!state.ui.inspect) {
    state.ui.inspect = { open: false, index: 0, ids: [] };
  }
  if (!Array.isArray(state.ui.inspect.ids)) {
    state.ui.inspect.ids = [];
  }
  if (!Number.isFinite(state.ui.inspect.index)) {
    state.ui.inspect.index = 0;
  }
}

// Function: ensureLegendState.
function ensureLegendState(state) {
  if (!state.ui) {
    state.ui = {};
  }
  if (!state.ui.legend) {
    state.ui.legend = { open: false };
  }
}

// Function: ensureSaveMapState.
function ensureSaveMapState(state) {
  if (!state.ui) {
    state.ui = {};
  }
  if (!state.ui.saveMap) {
    state.ui.saveMap = {
      open: false,
      busy: false,
      message: '',
      closeAtMs: 0,
    };
  }
}

// Function: openInspect.
function openInspect(state) {
  ensureInspectState(state);
  ensureLegendState(state);
  ensureSaveMapState(state);
  state.ui.legend.open = false;
  closeSaveMap(state);
  state.ui.inspect.ids = getSpawnOrderedIds(state.dwarves || []);
  state.ui.inspect.index = 0;
  state.ui.inspect.open = true;
}

// Function: closeInspect.
function closeInspect(state) {
  ensureInspectState(state);
  state.ui.inspect.open = false;
}

// Function: toggleLegend.
function toggleLegend(state) {
  ensureLegendState(state);
  ensureInspectState(state);
  ensureSaveMapState(state);
  const next = !state.ui.legend.open;
  state.ui.legend.open = next;
  if (next) {
    state.ui.inspect.open = false;
    closeSaveMap(state);
  }
}

// Function: toggleInspect.
function toggleInspect(state) {
  ensureInspectState(state);
  if (state.ui.inspect.open) {
    closeInspect(state);
    return;
  }
  openInspect(state);
}

// Function: moveInspect.
function moveInspect(state, delta) {
  ensureInspectState(state);
  if (!state.ui.inspect.open) {
    return;
  }
  const ids = state.ui.inspect.ids || [];
  if (ids.length === 0) {
    return;
  }
  const size = ids.length;
  const next = (Number(state.ui.inspect.index || 0) + delta + size) % size;
  state.ui.inspect.index = next;
}

// Function: updateUiTimers.
function updateUiTimers(state, config) {
  ensureSaveMapState(state);
  const closeAt = Number(state.ui.saveMap.closeAtMs || 0);
  if (state.ui.saveMap.open && closeAt > 0 && Date.now() >= closeAt) {
    closeSaveMap(state);
  }
}

// Function: closeSaveMap.
function closeSaveMap(state) {
  ensureSaveMapState(state);
  state.ui.saveMap.open = false;
  state.ui.saveMap.message = '';
  state.ui.saveMap.closeAtMs = 0;
}

// Function: openSaveMap.
function openSaveMap(state, config, message) {
  ensureSaveMapState(state);
  ensureInspectState(state);
  ensureLegendState(state);
  const uiConfig = (config.display && config.display.save_panel) || {};
  const autoCloseMs = Math.max(0, Number(uiConfig.autoCloseMs || 3000));
  state.ui.saveMap.message = String(message || 'Map saved.');
  state.ui.saveMap.open = true;
  state.ui.saveMap.closeAtMs = Date.now() + autoCloseMs;
  state.ui.inspect.open = false;
  state.ui.legend.open = false;
}

// Function: triggerMapExport.
function triggerMapExport(state, config, runtime, options = {}) {
  ensureSaveMapState(state);
  ensureInspectState(state);
  ensureLegendState(state);
  if (state.ui.saveMap.busy) {
    return;
  }
  const width = Math.max(0, Number(runtime.gridWidth || 0));
  const height = Math.max(0, Number(runtime.gridHeight || 0));
  if (width <= 0 || height <= 0) {
    openSaveMap(state, config, 'Map export unavailable.');
    return;
  }
  state.ui.saveMap.busy = true;
  state.ui.inspect.open = false;
  state.ui.legend.open = false;
  closeSaveMap(state);

  let snapshotPath = null;
  if (options.includeStructures) {
    try {
      snapshotPath = writeMapExportSnapshot(state);
    } catch (err) {
      state.ui.saveMap.busy = false;
      const message = err && err.message
        ? `Map export failed (${err.message}).`
        : 'Map export failed.';
      openSaveMap(state, config, message);
      return;
    }
  }

  const args = buildMapExportArgs(state, runtime, {
    includeStructures: options.includeStructures === true,
    snapshotPath,
  });
  const scriptPath = path.join(__dirname, 'scripts', 'export_map.js');
  args.unshift(scriptPath);

  const child = spawn(process.execPath, args, {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let errorOutput = '';

  child.stdout.on('data', (data) => {
    output += data.toString();
  });
  child.stderr.on('data', (data) => {
    errorOutput += data.toString();
  });
  const cleanupSnapshot = () => {
    if (snapshotPath) {
      fs.unlink(snapshotPath, () => {});
    }
  };

  child.on('error', (err) => {
    state.ui.saveMap.busy = false;
    cleanupSnapshot();
    const message = err && err.message ? `Map export failed (${err.message}).` : 'Map export failed.';
    openSaveMap(state, config, message);
  });
  child.on('close', (code) => {
    state.ui.saveMap.busy = false;
    cleanupSnapshot();
    const message = code === 0
      ? buildSaveMessage(output)
      : buildFailureMessage(code, errorOutput);
    openSaveMap(state, config, message);
  });
}

// Function: buildMapExportArgs.
function buildMapExportArgs(state, runtime, options = {}) {
  const args = [];
  const width = Math.max(0, Number(runtime.gridWidth || 0));
  const height = Math.max(0, Number(runtime.gridHeight || 0));
  args.push(`--width=${width}`, `--height=${height}`);

  const season = state.season && state.season.name ? String(state.season.name) : '';
  if (season) {
    args.push(`--season=${season}`);
  }
  if (state.season && Number.isFinite(state.season.tickInSeason) && Number.isFinite(state.season.duration)) {
    const progress = clampUnit(state.season.tickInSeason / state.season.duration);
    args.push(`--seasonProgress=${progress}`);
  }

  const seed = state.terrain && Number.isFinite(state.terrain.seed) ? state.terrain.seed : null;
  if (seed !== null) {
    args.push(`--seed=${Math.floor(seed)}`);
  }

  if (options.snapshotPath) {
    args.push(`--state=${options.snapshotPath}`);
  }
  if (options.includeStructures) {
    args.push('--includeStructures');
  }

  return args;
}

// Function: buildMapExportSnapshot.
function buildMapExportSnapshot(state) {
  const structures = Array.isArray(state.structures)
    ? state.structures
      .filter((structure) => structure && typeof structure === 'object')
      .map((structure) => ({
        id: structure.id,
        type: structure.type,
        x: Number(structure.x || 0),
        y: Number(structure.y || 0),
        symbol: structure.symbol,
        level: structure.level,
        capacity: structure.capacity,
      }))
    : [];
  const roads = state.roads && state.roads.types
    ? {
      width: state.roads.width,
      height: state.roads.height,
      types: state.roads.types,
    }
    : null;

  return { structures, roads };
}

// Function: writeMapExportSnapshot.
function writeMapExportSnapshot(state) {
  const snapshot = buildMapExportSnapshot(state);
  const fileName = `node_dwarves_map_${Date.now()}_${Math.floor(Math.random() * 1000000)}.json`;
  const filePath = path.join(os.tmpdir(), fileName);
  fs.writeFileSync(filePath, JSON.stringify(snapshot));
  return filePath;
}

// Function: buildSaveMessage.
function buildSaveMessage(output) {
  const match = output.match(/Map exported to ([^\n\r]+)/);
  if (!match) {
    return 'Map saved.';
  }
  const rawPath = match[1].trim();
  const relative = path.relative(process.cwd(), rawPath);
  const displayPath = relative && !relative.startsWith('..') ? relative : rawPath;
  return `Map saved to ${displayPath}`;
}

// Function: buildFailureMessage.
function buildFailureMessage(code, errorOutput) {
  const firstLine = errorOutput.trim().split('\n')[0];
  const suffix = firstLine ? ` (${firstLine})` : '';
  return `Map export failed${suffix} (code ${code}).`;
}

// Function: clampUnit.
function clampUnit(value) {
  return Math.min(1, Math.max(0, Number(value || 0)));
}

// Function: handleInput.
function handleInput(text) {
  if (!text) {
    return;
  }
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '\u0003') {
      running = false;
      shutdown();
      return;
    }
    if (char === ' ') {
      paused = !paused;
      i += 1;
      continue;
    }
    if (char === 'i' || char === 'I') {
      toggleInspect(state);
      i += 1;
      continue;
    }
    if (char === 'l' || char === 'L') {
      toggleLegend(state);
      i += 1;
      continue;
    }
    if (char === 'm') {
      triggerMapExport(state, config, runtime);
      i += 1;
      continue;
    }
    if (char === 'M') {
      triggerMapExport(state, config, runtime, { includeStructures: true });
      i += 1;
      continue;
    }
    if (char === '\u001b') {
      const seq = text.slice(i, i + 3);
      if (seq === '\u001b[C') {
        moveInspect(state, 1);
        i += 3;
        continue;
      }
      if (seq === '\u001b[D') {
        moveInspect(state, -1);
        i += 3;
        continue;
      }
      i += 1;
      continue;
    }
    i += 1;
  }
}
