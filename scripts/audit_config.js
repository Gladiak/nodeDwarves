#!/usr/bin/env node
'use strict';

// Config audit (STRATEGY.md step R2). Combines dynamic read traces (scripts/config_trace.js) with the
// keys read by the Python trainer to list config values that nothing reads, and classifies every
// top-level section as core, narrative, presentation or infrastructure.
//
// Usage:
//   node scripts/audit_config.js --trace <file.jsonl> [--trace <file2.jsonl>] [--json <out.json>]

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Section classes: core = the economic model tuned and measured in STRATEGY.md; narrative = story
// systems; presentation = what the terminal shows; infrastructure = sessions, saves and training.
const SECTION_CLASS = {
  resources: 'core', jobs: 'core', consumption: 'core', needs: 'core', population: 'core',
  seasons: 'core', weather: 'core', raids: 'core', structures: 'core', morale: 'core', dwarves: 'core',
  tools: 'core', merchant: 'core', pasture: 'core', wildlife: 'core', underrealm: 'core',
  ai: 'core', simulation: 'core', variety: 'core',
  schism: 'narrative', warriors: 'narrative', myths: 'narrative', alchemy: 'narrative',
  landmarks: 'narrative', epic_conflicts: 'narrative', world_legacy: 'narrative',
  experience_ledger: 'narrative', chronicle: 'narrative', story_director: 'narrative', clans: 'narrative',
  festivals: 'narrative', worldEvents: 'narrative', externalCamps: 'narrative', contracts: 'narrative',
  ruins: 'narrative', villages: 'narrative', roads: 'narrative', prestige: 'narrative', endgame: 'narrative',
  display: 'presentation', symbols: 'presentation', events: 'presentation',
  startup: 'infrastructure', persistence: 'infrastructure',
};
// The tuning surface (STRATEGY.md R6, E28): core keys whose +/-25% change moved final population,
// avoidable deaths or progress with |z| >= 2 on the 24-game plan. Only these are changed when
// balancing the economy; a measured step may add a key here.
const CORE_KEYS = [
  'jobs.gatherYield.food', 'jobs.gatherYield.water', 'jobs.gatherTicks.food', 'jobs.gatherTriggerRatio.food',
  'needs.decayPerTick.hunger', 'needs.decayPerTick.thirst',
  'consumption.rawFoodRelief', 'consumption.waterRelief', 'consumption.hungerThreshold', 'consumption.thirstThreshold',
  'population.reproduction.baseChance', 'population.reproduction.resourcePerCapita.water',
  'population.reproduction.minStockpileRatio.food', 'population.aging.oldAgeStart', 'population.aging.maxAge',
  'population.housing.buildTargetRatio', 'population.roles.emergencyMinRatio', 'raids.chance.max',
  // S3-0 growth cap (E29/E30): measured when added.
  'population.reproduction.growthCap.maxAnnualGrowth', 'population.reproduction.growthCap.minBirthsPerYear',
];
// Economic keys screened in R6 without a measurable effect at +/-25%: frozen at their values.
// The raid minimums act only below difficulty 1 (training curriculum); the steward reserve acts only
// when a group is cautious (none today).
const FROZEN_KEYS = [
  'jobs.gatherYield.wood', 'jobs.gatherYield.stone', 'jobs.gatherTicks.water', 'jobs.gatherTriggerRatio.water',
  'consumption.beerRelief', 'resources.targets.food', 'resources.targets.water',
  'resources.targetsPerCapita.food', 'resources.targetsPerCapita.water', 'resources.stockpile.food',
  'resources.stockpile.water', 'dwarves.count',
  'seasons.modifiers.winter.gatherYield', 'seasons.modifiers.winter.needDecay', 'seasons.modifiers.winter.reproductionChance',
  'seasons.modifiers.autumn.gatherYield',
  'structures.brewery.outputPerTick.beer', 'structures.brewery.foodCostPerTick', 'structures.brewery.stopWhenBeerReserveRatioAbove',
  'structures.field.nodeCapacity', 'population.reproduction.resourcePerCapita.food', 'population.reproduction.softCap',
  'population.aging.fertileEnd', 'population.death.starvationTicks', 'population.roles.builderRatio',
  'population.roles.managerRatio', 'raids.chance.min', 'raids.deathRate.min', 'raids.deathRate.max',
  'raids.resourceLoss.max', 'ai.steward.safeReservePerCapita', 'ai.priorityBoosts.water.multiplier',
];

// Subtrees of the ai section that are training infrastructure rather than game behavior.
const AI_INFRA = ['ai.training', 'ai.runtime'];

function parseArgs(argv) {
  const options = { traces: [], json: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--trace') options.traces.push(argv[++i]);
    else if (argv[i] === '--json') options.json = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (options.traces.length === 0) throw new Error('--trace is required');
  return options;
}

// Every leaf path of the config, with array indices folded to [*].
function leafPaths(value, base = '', out = new Map()) {
  if (Array.isArray(value)) {
    if (value.length === 0 || value.every((entry) => !entry || typeof entry !== 'object')) {
      out.set(base, value);
      return out;
    }
    value.forEach((entry) => leafPaths(entry, `${base}[*]`, out));
    return out;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) out.set(base, value);
    for (const key of keys) leafPaths(value[key], base ? `${base}.${key}` : key, out);
    return out;
  }
  out.set(base, value);
  return out;
}

// Key names the Python trainer reads with .get("name") or ["name"].
function pythonKeyNames() {
  const names = new Set();
  for (const file of fs.readdirSync(path.join(ROOT, 'python'))) {
    if (!file.endsWith('.py')) continue;
    const text = fs.readFileSync(path.join(ROOT, 'python', file), 'utf8');
    for (const match of text.matchAll(/(?:\.get\(|\[)\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g)) names.add(match[1]);
  }
  return names;
}

function classify(leaf) {
  if (AI_INFRA.some((prefix) => leaf === prefix || leaf.startsWith(`${prefix}.`) || leaf.startsWith(`${prefix}[`))) {
    return 'infrastructure';
  }
  return SECTION_CLASS[leaf.split(/[.[]/)[0]] || 'unclassified';
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  const leaves = leafPaths(config);
  const read = new Set();
  const frozen = [];
  for (const file of options.traces) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      for (const entry of JSON.parse(line)) {
        if (entry.endsWith('.**')) frozen.push(entry.slice(0, -3));
        else read.add(entry);
      }
    }
  }
  const python = pythonKeyNames();
  const unread = [];
  for (const leaf of leaves.keys()) {
    if (read.has(leaf)) continue;
    if (frozen.some((prefix) => leaf === prefix || leaf.startsWith(`${prefix}.`) || leaf.startsWith(`${prefix}[`))) continue;
    const name = leaf.split('.').pop().replace(/\[\*\]$/, '');
    if (leaf.startsWith('ai.') && python.has(name)) continue;
    unread.push(leaf);
  }
  const byClass = {};
  for (const leaf of leaves.keys()) {
    const cls = classify(leaf);
    byClass[cls] = byClass[cls] || { leaves: 0, unread: 0 };
    byClass[cls].leaves += 1;
  }
  for (const leaf of unread) byClass[classify(leaf)].unread += 1;
  // Group unread leaves by their deepest common parent to keep the report readable.
  const groups = new Map();
  for (const leaf of unread) {
    const parent = leaf.includes('.') ? leaf.slice(0, leaf.lastIndexOf('.')) : leaf;
    groups.set(parent, (groups.get(parent) || 0) + 1);
  }
  const missingCore = [...CORE_KEYS, ...FROZEN_KEYS].filter((key) => !leaves.has(key));
  const report = { coreKeys: CORE_KEYS.length, missingCore, leaves: leaves.size, read: leaves.size - unread.length, unread: unread.length, byClass,
    unreadGroups: [...groups.entries()].sort((a, b) => b[1] - a[1]).map(([parent, count]) => ({ parent, count })),
    unreadLeaves: unread };
  process.stdout.write(`config leaves ${report.leaves}, read ${report.read}, never read ${report.unread}\n`);
  process.stdout.write(`core tuning keys ${CORE_KEYS.length}, frozen screened keys ${FROZEN_KEYS.length}${missingCore.length ? `, missing: ${missingCore.join(', ')}` : ''}\n`);
  for (const [cls, entry] of Object.entries(byClass)) process.stdout.write(`  ${cls}: ${entry.leaves} leaves, ${entry.unread} never read\n`);
  process.stdout.write('never-read groups:\n');
  for (const { parent, count } of report.unreadGroups) process.stdout.write(`  ${count}\t${parent}\n`);
  if (options.json) fs.writeFileSync(options.json, `${JSON.stringify(report, null, 1)}\n`);
}

if (require.main === module) main();

module.exports = { CORE_KEYS, FROZEN_KEYS, SECTION_CLASS, leafPaths };
