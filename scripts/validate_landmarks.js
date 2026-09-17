#!/usr/bin/env node
'use strict';

const baseConfig = require('../config.json');
const { createInitialState } = require('../src/state');
const { stepState } = require('../src/simulation');
const { getLandmarkStatus } = require('../src/simulation/landmarks');

const seeds = [808, 1608, 2408, 3208, 4008];
const sizes = [[64, 26], [80, 32], [100, 36]];

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function runScenario(seed, width, height) {
  const config = clone(baseConfig);
  config.display.terrain.seed = seed;
  config.endgame.enabled = false;
  config.structures.temple_of_ancestors.enabled = false;
  config.population.roles.emergencyMinRatio = 0;
  config.landmarks.abandonment_population = 1;
  config.landmarks.stage_interval_ticks = 20;
  for (const definition of Object.values(config.landmarks.definitions)) {
    definition.build_min_population = Math.min(12, definition.build_min_population);
    definition.build_min_resources = {};
    for (const stage of definition.stages) {
      stage.build_ticks = Math.max(12, Math.round(stage.build_ticks * 0.2));
      stage.build_cost = Object.fromEntries(Object.keys(stage.build_cost).map((resource) => [resource, 1]));
    }
  }
  const runtime = { gridWidth: width, gridHeight: height, playableArea: width * height };
  const state = createInitialState(config, runtime);
  for (let tick = 0; tick < 2400; tick += 1) stepState(state, config, runtime, null, { suppressEndgameReset: true });
  const status = getLandmarkStatus(state, config);
  const invalid = status.entries.filter((entry) => entry.site && (
    entry.site.x < 0 || entry.site.y < 0 || entry.site.x >= width || entry.site.y >= height
  ));
  if (invalid.length > 0) throw new Error(`invalid landmark sites for seed ${seed} ${width}x${height}`);
  if (state.dwarves.length <= 0) throw new Error(`population collapsed for seed ${seed} ${width}x${height}`);
  if (status.count <= 0) throw new Error(`no organic landmark founded for seed ${seed} ${width}x${height}`);
  return {
    seed, size: `${width}x${height}`, population: state.dwarves.length,
    founded: status.count, completed: status.completed,
    stateBytes: Buffer.byteLength(JSON.stringify(state.landmarks)),
  };
}

const rows = [];
for (let index = 0; index < seeds.length; index += 1) {
  const [width, height] = sizes[index % sizes.length];
  rows.push(runScenario(seeds[index], width, height));
}
const maxBytes = Math.max(...rows.map((row) => row.stateBytes));
if (maxBytes > 20000) throw new Error(`landmark state exceeded bound: ${maxBytes} bytes`);
console.table(rows);
console.log(`Landmark validation PASS: ${rows.length} seeds/sizes, max state ${maxBytes} bytes.`);
