'use strict';

const { loadConfig } = require('./src/config');
const { buildRuntime, getTerminalSize, setupResizeHandler } = require('./src/runtime');
const { createInitialState, fitStateToGrid } = require('./src/state');
const { stepState } = require('./src/simulation');
const { renderFrame } = require('./src/render');
const { clearScreen, moveCursorHome, hideCursor, showCursor } = require('./src/terminal');
const { loadPolicy, selectAction } = require('./src/ai_policy');

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
    const text = chunk.toString('utf8');
    for (const char of text) {
      if (char === ' ') {
        paused = !paused;
        return;
      }
      if (char === '\u0003') {
        running = false;
        shutdown();
        return;
      }
    }
  });
}
