#!/usr/bin/env node
'use strict';

const assert = require('assert');

const baseConfig = require('../config.json');
const { createInitialState } = require('../src/state');
const { stepState } = require('../src/simulation');
const { renderFrame } = require('../src/render');
const { buildLegendSections } = require('../src/render/legend');
const { buildTelemetrySections } = require('../src/telemetry/telemetry');
const { buildObservation } = require('../src/ai/observation');
const {
  LANDMARK_HARD_CAP,
  LANDMARK_SCHEMA_VERSION,
  completeLandmarkStageBuild,
  createLandmarkBuildJob,
  ensureLandmarkState,
  getLandmarkRenderTiles,
  getLandmarkStatus,
  isLandmarkFootprintCell,
  updateLandmarks,
} = require('../src/simulation/landmarks');

const runtime = {
  gridWidth: 80, gridHeight: 40, playableArea: 3200,
  frameEnabled: false, headerHeight: 0, footerHeight: 0,
  terminalWidth: 80, terminalHeight: 40,
};
let assertions = 0;

function check(value, message) { assertions += 1; assert(value, message); }
function equal(actual, expected, message) { assertions += 1; assert.equal(actual, expected, message); }
function deepEqual(actual, expected, message) { assertions += 1; assert.deepEqual(actual, expected, message); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function testConfig() {
  const config = clone(baseConfig);
  config.display.colors.enabled = false;
  config.display.terrain.seed = 808080;
  config.landmarks.restoration_ticks = 3;
  config.landmarks.abandonment_population = 5;
  for (const definition of Object.values(config.landmarks.definitions)) {
    definition.build_min_population = 0;
    definition.build_min_cycles = 0;
    definition.build_min_resources = {};
    for (const stage of definition.stages) {
      stage.build_ticks = 1;
      stage.build_cost = {};
    }
  }
  return config;
}

function finishAllLandmarks(state, config) {
  let completions = 0;
  for (let guard = 0; guard < 40; guard += 1) {
    const job = createLandmarkBuildJob(state, config, runtime, new Set());
    if (!job) break;
    const result = completeLandmarkStageBuild(state, config, job, state.dwarves[0]);
    check(result.completed, `landmark stage ${guard + 1} completes`);
    completions += 1;
  }
  return completions;
}

function run() {
  const config = testConfig();
  const state = createInitialState(config, runtime);
  for (const [resource, target] of Object.entries(config.resources.targets || {})) {
    state.stockpile[resource] = Math.max(Number(state.stockpile[resource] || 0), Number(target || 0));
  }
  equal(state.landmarks.schemaVersion, LANDMARK_SCHEMA_VERSION, 'initial landmark schema');
  equal(state.landmarks.order.length, 5, 'five configured landmark records');
  check(state.landmarks.order.length <= LANDMARK_HARD_CAP, 'landmark hard cap enforced');

  const pristineObservation = buildObservation(state, config);
  state.landmarks.byId.great_hall.condition = 'abandoned';
  deepEqual(buildObservation(state, config), pristineObservation, 'landmark metadata is outside PPO observation');
  state.landmarks.byId.great_hall.condition = 'planned';

  equal(finishAllLandmarks(state, config), 15, 'all five three-stage landmarks complete');
  const status = getLandmarkStatus(state, config);
  equal(status.count, 5, 'all landmark centers founded');
  equal(status.completed, 5, 'all landmark progressions complete');
  equal(state.structures.filter((entry) => entry.landmarkId).length, 5, 'one damageable center per landmark');

  const occupied = new Set();
  for (const id of state.landmarks.order) {
    const landmark = state.landmarks.byId[id];
    check(landmark.site, `${id} has a deterministic site`);
    const key = `${landmark.site.x},${landmark.site.y}`;
    check(!occupied.has(key), `${id} center does not overlap`);
    occupied.add(key);
    check(isLandmarkFootprintCell(state, config, landmark.site.x, landmark.site.y), `${id} reserves its footprint`);
    check(state.places.byId[landmark.placeId], `${id} registers a named place`);
  }

  const tiles = getLandmarkRenderTiles(state, config, runtime);
  check(tiles.length >= 125, 'final footprints render at multi-cell scale');
  check(tiles.some((tile) => tile.district), 'completed landmarks render compact district markers');
  const frame = String(renderFrame(state, config, runtime, { color: false }));
  for (const symbol of ['G', 'A', 'F', 'H', 'N']) check(frame.includes(symbol), `${symbol} is export/frame visible`);
  const legend = buildLegendSections(config, { color: false, detailed: false });
  const legendText = JSON.stringify(legend);
  check(legendText.includes('GreatHall') && legendText.includes('GateFortress'), 'legend lists landmark identities');

  const gateId = 'gate_fortress';
  const gateStructure = state.structures.find((entry) => entry.landmarkId === gateId);
  gateStructure.siegeDamage = { severity: 2, damagedTick: state.tick, nemesisId: 'test' };
  updateLandmarks(state, config, runtime);
  equal(state.landmarks.byId[gateId].condition, 'damaged', 'siege damage changes district condition');
  check(getLandmarkRenderTiles(state, config, runtime).some((tile) => tile.landmarkId === gateId && tile.symbol === 'x'), 'damage state is visible');
  delete gateStructure.siegeDamage;
  state.tick += 1;
  updateLandmarks(state, config, runtime);
  equal(state.landmarks.byId[gateId].condition, 'restoration', 'damage removal enters restoration state');
  check(getLandmarkRenderTiles(state, config, runtime).some((tile) => tile.landmarkId === gateId && tile.symbol === '~'), 'restoration state is visible');
  state.tick += 4;
  updateLandmarks(state, config, runtime);
  equal(state.landmarks.byId[gateId].condition, 'prosperous', 'restoration deterministically returns to prosperity');

  const originalDwarves = state.dwarves;
  state.dwarves = originalDwarves.slice(0, 2);
  updateLandmarks(state, config, runtime);
  equal(state.landmarks.byId.great_hall.condition, 'abandoned', 'population collapse marks a district abandoned');
  state.dwarves = originalDwarves;
  state.tick += 1;
  updateLandmarks(state, config, runtime);
  equal(state.landmarks.byId.great_hall.condition, 'prosperous', 'repopulation reactivates an abandoned district');

  const serialized = JSON.parse(JSON.stringify(state.landmarks));
  const repairedState = { ...state, landmarks: serialized };
  ensureLandmarkState(repairedState, config);
  deepEqual(getLandmarkStatus(repairedState, config).entries, getLandmarkStatus(state, config).entries, 'serialization round-trip preserves landmark facts');
  const sections = buildTelemetrySections(state, config, 72);
  check(JSON.stringify(sections.structures).includes('Landmarks: 5/5'), 'telemetry exposes landmark progression');

  const narrowRuntime = { ...runtime, gridWidth: 34, gridHeight: 18, playableArea: 612, terminalWidth: 34, terminalHeight: 18 };
  const narrowState = createInitialState(config, narrowRuntime);
  const narrowJob = createLandmarkBuildJob(narrowState, config, narrowRuntime, new Set());
  if (narrowJob) {
    completeLandmarkStageBuild(narrowState, config, narrowJob);
    const narrowLandmark = narrowState.landmarks.byId[narrowJob.landmarkId];
    check(narrowLandmark.site.x >= 2 && narrowLandmark.site.x < narrowRuntime.gridWidth - 2, 'narrow-map x placement is valid');
    check(narrowLandmark.site.y >= 2 && narrowLandmark.site.y < narrowRuntime.gridHeight - 2, 'narrow-map y placement is valid');
  }

  const organicConfig = testConfig();
  organicConfig.structures.temple_of_ancestors.enabled = false;
  organicConfig.population.roles.emergencyMinRatio = 0;
  organicConfig.landmarks.stage_interval_ticks = 2;
  for (const [id, definition] of Object.entries(organicConfig.landmarks.definitions)) {
    definition.enabled = id === 'great_hall';
  }
  const organicState = createInitialState(organicConfig, runtime);
  for (let tick = 0; tick < 240 && organicState.landmarks.byId.great_hall.stage === 0; tick += 1) {
    stepState(organicState, organicConfig, runtime, null, { suppressEndgameReset: true });
  }
  check(organicState.landmarks.byId.great_hall.stage > 0, 'normal dwarf job flow completes an autonomous landmark stage');

  console.log(`Landmark contracts: ${assertions} assertions passed.`);
}

run();
