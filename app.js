'use strict';

const { loadConfig } = require('./src/config');
const { buildRuntime, getTerminalSize, setupResizeHandler } = require('./src/runtime');
const { createInitialState, fitStateToGrid } = require('./src/state');
const { stepState } = require('./src/simulation');
const { renderFrame } = require('./src/render');
const { clearScreen, moveCursorHome, hideCursor, showCursor } = require('./src/terminal');

const config = loadConfig();
let runtime = buildRuntime(config.display, getTerminalSize(config.display));
const state = createInitialState(config, runtime);

const tickMs = Number(config.display.tickMs || 200);
const maxTicks = Number(config.simulation.maxTicks || 0);

let running = true;

process.on('SIGINT', () => {
  running = false;
  shutdown();
});

setupResizeHandler(config.display, () => {
  runtime = buildRuntime(config.display, getTerminalSize(config.display));
  fitStateToGrid(state, runtime);
  clearScreen();
});

hideCursor();
clearScreen();
loop();

function loop() {
  if (!running) {
    return;
  }

  stepState(state, config, runtime);
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

function shutdown() {
  showCursor();
  process.stdout.write('\n');
  process.exit(0);
}
