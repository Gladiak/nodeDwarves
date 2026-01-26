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

  if (policy && state.tick >= nextActionTick) {
    currentAction = selectAction(state, config, policy);
    nextActionTick = state.tick + getActionTicks(config);
  }

  stepState(state, config, runtime, currentAction);
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

function getActionTicks(config) {
  const aiConfig = config.ai || {};
  const ticks = Number(aiConfig.stepTicks || 1);
  return Math.max(1, ticks);
}
