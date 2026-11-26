'use strict';

const { LEVER_ACTION_PREFIX, isLeverActionId } = require('./src/simulation/levers');
const readline = require('readline');
const fs = require('fs');
const v8 = require('v8');
const zlib = require('zlib');
const { loadPolicy, selectAction, normalizeActionEnvelope: normalizePolicyAction } = require('./src/ai/policy');
const { loadConfig } = require('./src/config');
const { buildRuntime } = require('./src/runtime');
const { createInitialState } = require('./src/state');
const { stepState } = require('./src/simulation');
const { buildObservation: buildAiObservation, getObservationNodeRatio, STRATEGIC_FEATURE_NAMES } = require('./src/ai/observation');
const {
  OBSERVATION_LAYOUT_FACTORED,
  buildObservationPlan,
  assembleObservationVector,
} = require('./src/ai/observation_layout');
const { getFestivalObservation } = require('./src/simulation/festivals');
const { clamp } = require('./src/utils');
const { computeOutcomeSignals, computeOutcomeReward } = require('./src/ai/outcome_reward');

const baseConfigPath = resolveConfigPath(process.argv.slice(2));
const baseConfig = loadConfig(baseConfigPath || undefined);
const nativeRandom = Math.random;
const DEBUG_MODE = resolveDebugMode(process.env.NODEDWARVES_DEBUG_MODE);
const TRANSPORT_LEGACY = 'legacy';
const TRANSPORT_COMPACT = 'compact';
const DEFAULT_FEATURE_NAMES = [
  'shortage',
  'nodeScarcity',
  'criticalNeeds',
  'idleAdults',
  'populationBalance',
  'seasonIndex',
  'seasonProgress',
  'weatherSeverity',
  'weatherTimeLeft',
  'raidActive',
  'raidTimeLeft',
  'raidExposed',
  'raidDefense',
  'housingShortage',
  'seasonEligible',
  'festivalActive',
  'festivalTimeLeft',
  'festivalEligible',
  'festivalCostRatio',
];
const ACTION_SLOT_WEIGHT = 'weight';
const ACTION_SLOT_LEVER = 'lever';
const FEATURE_KIND_SHORTAGE = 'shortage';
const FEATURE_KIND_NODE_SCARCITY = 'nodeScarcity';
const FEATURE_KIND_STATIC = 'static';
const FEATURE_KIND_MYTH_FLAG = 'mythFlag';
const FEATURE_KIND_CLAN_SHARE = 'clanShare';
const FEATURE_KIND_ZERO = 'zero';
const MYTH_FLAG_PREFIX = 'mythFlag_';
const CLAN_SHARE_PREFIX = 'clanShare_';
const STATIC_FEATURE_NAMES = new Set([
  'criticalNeeds',
  'idleAdults',
  'populationBalance',
  'seasonIndex',
  'seasonProgress',
  'weatherSeverity',
  'weatherTimeLeft',
  'raidActive',
  'raidTimeLeft',
  'raidExposed',
  'raidDefense',
  'housingShortage',
  'seasonEligible',
  'festivalActive',
  'festivalTimeLeft',
  'festivalEligible',
  'festivalCostRatio',
  'ruinsActive',
  'ruinsCooldown',
  'ruinsProgress',
  'ruinsArtifacts',
  'underrealmDepthProgress',
  'underrealmChampionProgress',
  'underrealmFrontierContested',
  'underrealmChampionCooldown',
  'underrealmReadinessScore',
  'underrealmReadinessGap',
  'underrealmReadinessBlocked',
  'underrealmReadinessWarning',
  'underrealmCombatPressure',
  'mythsActiveRatio',
  'mythsSeverity',
  'worldEventActive',
  'worldEventOfferPhase',
  'worldEventOfferReady',
  'worldEventTimeLeft',
  'worldEventSpawnImminence',
  'worldEventPressure',
  'contractActive',
  'contractReady',
  'contractTimeLeft',
  'contractFailurePressure',
  'contractReputation',
  'contractPressure',
  'externalCampActiveRatio',
  'externalCampRaiderPressure',
  'externalCampCaravanRisk',
  'externalCampMilitiaSupport',
  'externalCampTradeInfluence',
  'externalCampPressure',
  'schismPressure',
  'schismLegitimacy',
  'schismPhase',
  'schismDoctrineRevelry',
  'schismRitualOpen',
  'schismRitualActive',
  'schismClimaxActive',
  'schismInstability',
  'socialCohesion',
  'socialConflictPressure',
  'socialMentorshipCoverage',
  'socialGrudgeLoad',
  'socialIncidentRecency',
  'warriorEnabled',
  'warriorRosterCoverage',
  'warriorEliteScore',
  'warriorLegacyAura',
  'warriorChampionMomentum',
  'warriorTournamentRecency',
  'warriorInjuryShare',
  'warriorRetiredShare',
  'warriorSurvivability',
  'warriorHeroTurnoverPressure',
  ...STRATEGIC_FEATURE_NAMES,
]);
let runtime = buildRuntimeForConfig(baseConfig);

let state = null;
let prevMetrics = null;
let activeConfig = baseConfig;
let scenarioMeta = null;
let transportState = createTransportState();

resetState();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', (line) => {
  const trimmed = String(line || '').trim();
  if (!trimmed) {
    return;
  }

  let payload;
  try {
    payload = JSON.parse(trimmed);
  } catch (error) {
    writeResponse({ error: 'invalid_json' });
    return;
  }

  const cmd = payload && payload.cmd;
  const transportProblem = cmd === 'reset' ? describeUnsupportedTransport(payload.transport) : null;
  if (transportProblem) {
    writeResponse({ error: 'unsupported_transport', message: transportProblem });
    return;
  }

  if (cmd === 'reset' && payload.snapshot) {
    applySeed(payload.seed);
    try {
      resetFromSnapshot(String(payload.snapshot));
    } catch (error) {
      writeResponse({ error: 'snapshot_load_failed', message: String(error && error.message || error) });
      return;
    }
    configureTransport(payload.transport, activeConfig);
    writeResponse(buildResponse(0, false));
    return;
  }

  if (cmd === 'autostep') {
    writeResponse(autoStep(payload));
    return;
  }

  if (cmd === 'save_snapshot') {
    writeResponse(saveSnapshot(String(payload.path || '')));
    return;
  }

  if (cmd === 'reset') {
    applySeed(payload.seed);
    resetState({
      training: payload.training,
      eval: payload.eval,
      difficulty: payload.difficulty,
      randomize: payload.randomize,
      scenario: payload.scenario,
    });
    applyEpisodeTickLimit(payload.tickLimit);
    configureTransport(payload.transport, activeConfig);
    writeResponse(buildResponse(0, false));
    return;
  }

  if (cmd === 'step') {
    const action = decodeStepAction(payload);
    const forceDebug = Boolean(payload.debug)
      || Boolean(payload.action && payload.action.debug)
      || Boolean(action.debug);
    const stepAction = { ...action };
    delete stepAction.debug;
    const ticks = getStepTicks(stepAction, activeConfig);
    for (let i = 0; i < ticks; i += 1) {
      stepState(state, activeConfig, runtime, stepAction);
    }
    const metrics = computeMetrics(state, activeConfig);
    const reward = computeReward(prevMetrics, metrics, activeConfig, stepAction);
    prevMetrics = metrics;
    const doneStatus = getDoneStatus(state, activeConfig);
    writeResponse(buildResponse(reward, doneStatus.done, doneStatus.reason, forceDebug));
    return;
  }

  if (cmd === 'close') {
    // Exit only after stdout drains: pipes are asynchronous on macOS and an immediate
    // process.exit() can truncate buffered responses.
    rl.close();
    process.stdout.write(`${JSON.stringify({ ok: true })}\n`, () => process.exit(0));
    return;
  }

  writeResponse({ error: 'unknown_command' });
});

// Function: buildRuntimeForConfig.
function buildRuntimeForConfig(config) {
  const display = (config && config.display) || {};
  return buildRuntime(display, {
    columns: Number(display.width || 80),
    rows: Number(display.height || 24),
  });
}

// Function: resetState.
function resetState(options = {}) {
  const scenario = buildScenarioConfig(baseConfig, options);
  activeConfig = scenario.config;
  scenarioMeta = scenario.meta;
  runtime = buildRuntimeForConfig(activeConfig);
  state = createInitialState(activeConfig, runtime);
  if (scenario.initialTick !== null) {
    state.tick = scenario.initialTick;
  }
  // Episode tick limits count ticks played in this episode, whatever tick it starts at (random
  // season start, scenario start or snapshot).
  state.episodeStartTick = Number(state.tick || 0);
  prevMetrics = computeMetrics(state, activeConfig);
}

// Mid-game snapshot starts (STRATEGY.md S4d). A snapshot holds the scenario config, its metadata
// and the full state of one game at some tick; training resets from it and plays a normal-length
// episode from there (the tick limit counts from the snapshot tick).
const SNAPSHOT_VERSION = 1;

// Load a snapshot written by save_snapshot and make it the current episode.
function resetFromSnapshot(filePath) {
  const snapshot = v8.deserialize(zlib.gunzipSync(fs.readFileSync(filePath)));
  if (!snapshot || snapshot.version !== SNAPSHOT_VERSION || !snapshot.state || !snapshot.config) {
    throw new Error(`unsupported snapshot ${filePath}`);
  }
  activeConfig = snapshot.config;
  scenarioMeta = snapshot.scenarioMeta || null;
  runtime = buildRuntimeForConfig(activeConfig);
  state = snapshot.state;
  state.episodeStartTick = Number(state.tick || 0);
  prevMetrics = computeMetrics(state, activeConfig);
}

// Write the current game (config, scenario metadata, state) atomically to a gzip snapshot file.
function saveSnapshot(filePath) {
  if (!filePath || !state) {
    return { error: 'snapshot_save_failed' };
  }
  const payload = zlib.gzipSync(v8.serialize({ version: SNAPSHOT_VERSION, config: activeConfig, scenarioMeta, state }), { level: 6 });
  const temporary = `${filePath}.partial`;
  fs.writeFileSync(temporary, payload);
  fs.renameSync(temporary, filePath);
  return { ok: true, tick: state.tick, population: state.dwarves.length, bytes: payload.length };
}

// Play `ticks` ticks without the trainer: the council alone, or a policy file at its own cadence.
let autoPolicy = { path: null, policy: null };
function autoStep(payload) {
  if (!state) {
    return { error: 'no_state' };
  }
  const ticks = Math.max(0, Math.floor(Number(payload.ticks || 0)));
  const policyPath = payload.policy ? String(payload.policy) : null;
  if (policyPath && autoPolicy.path !== policyPath) {
    let policy = null;
    try {
      policy = loadPolicy(policyPath);
    } catch (error) {
      return { error: 'policy_load_failed', message: String(error && error.message || error) };
    }
    if (!policy) {
      return { error: 'policy_load_failed' };
    }
    autoPolicy = { path: policyPath, policy };
  }
  // A policy decides at the cadence it was trained at; an explicit different cadence is an error.
  const requested = Math.max(0, Math.floor(Number(payload.stepTicks || 0)));
  const trained = policyPath ? autoPolicy.policy.stepTicks : null;
  if (trained && requested > 0 && requested !== trained) {
    return { error: 'step_ticks_mismatch', policyStepTicks: trained, requested };
  }
  const cadence = trained || requested || 2;
  let action = null;
  for (let index = 0; index < ticks && state.dwarves.length > 0; index += 1) {
    if (policyPath && index % cadence === 0) {
      action = normalizePolicyAction(selectAction(state, activeConfig, autoPolicy.policy));
    }
    stepState(state, activeConfig, runtime, action);
  }
  prevMetrics = computeMetrics(state, activeConfig);
  return { ok: true, tick: state.tick, population: state.dwarves.length };
}

// Optional per-episode tick limit from the reset payload (long-horizon evaluation, STRATEGY.md S4f).
// It can only extend the configured limit, so existing evaluations end exactly as before.
function applyEpisodeTickLimit(raw) {
  const limit = Number(raw);
  if (state && Number.isFinite(limit) && limit > 0) {
    state.episodeTickLimit = Math.floor(limit);
  }
}

// Function: applySeed.
function applySeed(seed) {
  if (seed === undefined || seed === null) {
    Math.random = nativeRandom;
    return;
  }
  const intSeed = Number(seed) >>> 0;
  Math.random = mulberry32(intSeed);
}

// Resolve optional config path from CLI args ("--config <path>" or "--config=<path>").
function resolveConfigPath(argv) {
  if (!Array.isArray(argv)) {
    return null;
  }
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || '');
    if (token === '--config') {
      const value = index + 1 < argv.length ? String(argv[index + 1] || '').trim() : '';
      return value || null;
    }
    if (token.startsWith('--config=')) {
      const value = token.slice('--config='.length).trim();
      return value || null;
    }
  }
  return null;
}

// Normalize the debug mode passed via environment variables.
function resolveDebugMode(raw) {
  const value = String(raw || 'full').trim().toLowerCase();
  if (!value) {
    return 'full';
  }
  if (['0', 'off', 'none', 'false', 'disable', 'disabled'].includes(value)) {
    return 'off';
  }
  if (['final', 'end', 'done'].includes(value)) {
    return 'final';
  }
  if (['summary', 'minimal', 'min'].includes(value)) {
    return 'summary';
  }
  return 'full';
}

// Function: mulberry32.
function mulberry32(seed) {
  let t = seed >>> 0;
  return function random() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Function: getStepTicks.
function getStepTicks(action, config) {
  const aiConfig = config.ai || {};
  const actionTicks = Number(action.ticks);
  if (Number.isFinite(actionTicks) && actionTicks > 0) {
    return Math.floor(actionTicks);
  }
  return Math.max(1, Number(aiConfig.stepTicks || 10));
}

// Build default transport state.
function createTransportState() {
  return {
    mode: TRANSPORT_LEGACY,
    resources: [],
    featureNames: [],
    featureSpecs: [],
    actionSlots: [],
    actionClampLow: 0,
    actionClampHigh: 2,
  };
}

// Normalize transport mode to one of supported values.
function normalizeTransportMode(rawMode) {
  const mode = String(rawMode || '').trim().toLowerCase();
  if (mode === TRANSPORT_COMPACT) {
    return TRANSPORT_COMPACT;
  }
  return TRANSPORT_LEGACY;
}

// Parse a list of non-empty string ids.
function parseStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const parsed = [];
  for (const item of value) {
    const text = String(item || '').trim();
    if (text) {
      parsed.push(text);
    }
  }
  return parsed;
}

// Action heads of action space v2: job weights and levers. v1 heads (festival, gov_*) were removed in
// STRATEGY.md T4 and are refused at reset.
function isRemovedActionId(actionId) {
  return actionId === 'festival' || actionId.startsWith('gov_');
}

// Compile resource slots for compact action decoding.
function compileActionSlots(resources) {
  const slots = [];
  for (const rawResource of resources) {
    const actionId = String(rawResource || '');
    if (!actionId) {
      continue;
    }
    slots.push({
      kind: isLeverActionId(actionId) ? ACTION_SLOT_LEVER : ACTION_SLOT_WEIGHT,
      actionId,
    });
  }
  return slots;
}

// Build one compact feature spec list for fast vector encoding.
function compileFeatureSpecs(featureNames) {
  const names = Array.isArray(featureNames) && featureNames.length > 0
    ? featureNames
    : DEFAULT_FEATURE_NAMES;
  const specs = [];
  for (const rawName of names) {
    const name = String(rawName || '');
    if (!name) {
      continue;
    }
    if (name === FEATURE_KIND_SHORTAGE) {
      specs.push({ kind: FEATURE_KIND_SHORTAGE, name });
      continue;
    }
    if (name === FEATURE_KIND_NODE_SCARCITY) {
      specs.push({ kind: FEATURE_KIND_NODE_SCARCITY, name });
      continue;
    }
    if (STATIC_FEATURE_NAMES.has(name)) {
      specs.push({ kind: FEATURE_KIND_STATIC, key: name, name });
      continue;
    }
    if (name.startsWith(MYTH_FLAG_PREFIX)) {
      specs.push({
        kind: FEATURE_KIND_MYTH_FLAG,
        key: name.slice(MYTH_FLAG_PREFIX.length),
        name,
      });
      continue;
    }
    if (name.startsWith(CLAN_SHARE_PREFIX)) {
      specs.push({
        kind: FEATURE_KIND_CLAN_SHARE,
        key: name.slice(CLAN_SHARE_PREFIX.length),
        name,
      });
      continue;
    }
    specs.push({ kind: FEATURE_KIND_ZERO, name });
  }
  return specs;
}

// Resolve action clamp range once per reset/config.
function getActionClampBounds(config) {
  const ai = (config && config.ai) || {};
  const minWeight = Number(ai.minWeight ?? 0);
  const maxWeight = Number(ai.maxWeight ?? 2);
  return {
    low: Math.min(minWeight, maxWeight),
    high: Math.max(minWeight, maxWeight),
  };
}

// Reason a reset's transport request is unsupported (v1 heads, non-factored layout), or null.
function describeUnsupportedTransport(rawTransport) {
  if (!rawTransport || typeof rawTransport !== 'object') {
    return null;
  }
  const layout = rawTransport.observationLayout;
  if (layout !== undefined && layout !== null && layout !== OBSERVATION_LAYOUT_FACTORED) {
    return `observation layout ${JSON.stringify(layout)} was removed (STRATEGY.md T4)`;
  }
  const removed = parseStringList(rawTransport.resources).find(isRemovedActionId);
  return removed ? `action head ${removed} was removed (STRATEGY.md T4)` : null;
}

// Apply transport config for current session.
function configureTransport(rawTransport, config) {
  const mode = normalizeTransportMode(rawTransport && rawTransport.mode ? rawTransport.mode : rawTransport);
  const resources = rawTransport && typeof rawTransport === 'object'
    ? parseStringList(rawTransport.resources)
    : [];
  const featureNames = rawTransport && typeof rawTransport === 'object'
    ? parseStringList(rawTransport.featureNames)
    : [];
  const bounds = getActionClampBounds(config);
  const featureSpecs = compileFeatureSpecs(featureNames);
  transportState = {
    mode,
    resources,
    featureNames,
    featureSpecs,
    observationPlan: resources.length > 0
      ? buildObservationPlan(resources, featureSpecs.map((spec) => spec.name))
      : null,
    actionSlots: compileActionSlots(resources),
    actionClampLow: bounds.low,
    actionClampHigh: bounds.high,
  };
}

// Check if current session uses compact transport.
function isCompactTransport() {
  return transportState && transportState.mode === TRANSPORT_COMPACT;
}

// Decode one step action payload: a compact action vector, or a JSON action envelope.
function decodeStepAction(payload) {
  if (Array.isArray(payload && payload.actionValues)) {
    return decodeCompactActionPayload(payload.actionValues, payload);
  }
  const envelope = payload && payload.action && typeof payload.action === 'object'
    ? payload.action
    : {};
  if (Array.isArray(envelope.actionValues)) {
    return decodeCompactActionPayload(envelope.actionValues, envelope);
  }
  return envelope;
}

// Decode a compact action vector into the action envelope expected by stepState: job weights in the
// clamp range, lever heads mapped to u in [0, 1].
function decodeCompactActionPayload(actionValues, sourcePayload) {
  const slots = Array.isArray(transportState && transportState.actionSlots)
    ? transportState.actionSlots
    : [];
  const low = Number.isFinite(transportState && transportState.actionClampLow)
    ? Number(transportState.actionClampLow)
    : 0;
  const high = Number.isFinite(transportState && transportState.actionClampHigh)
    ? Number(transportState.actionClampHigh)
    : 2;

  let weights;
  let levers;
  const action = {};

  for (let idx = 0; idx < slots.length; idx += 1) {
    const slot = slots[idx];
    if (!slot) {
      continue;
    }
    const rawValue = Number(actionValues[idx]);
    const safeValue = Number.isFinite(rawValue) ? rawValue : 0;
    const value = clamp(safeValue, low, high);
    if (slot.kind === ACTION_SLOT_LEVER) {
      levers = levers || {};
      levers[String(slot.actionId).slice(LEVER_ACTION_PREFIX.length)] = high > low ? (value - low) / (high - low) : 0.5;
    } else {
      weights = weights || {};
      weights[slot.actionId] = value;
    }
  }

  if (weights && Object.keys(weights).length > 0) {
    action.weights = weights;
  }
  if (levers && Object.keys(levers).length > 0) {
    action.levers = levers;
  }

  const ticksRaw = Number(sourcePayload && sourcePayload.ticks);
  if (Number.isFinite(ticksRaw) && ticksRaw > 0) {
    action.ticks = Math.floor(ticksRaw);
  }
  if (sourcePayload && sourcePayload.debug) {
    action.debug = true;
  }
  return action;
}

// Function: buildResponse.
function buildResponse(reward, done, doneReason, forceDebug) {
  const metrics = computeMetrics(state, activeConfig);
  const compactTransport = isCompactTransport();
  const obs = compactTransport ? null : buildObservation(state, activeConfig, metrics);
  const debugPayload = getDebugPayload(state, activeConfig, metrics, done, forceDebug);
  const info = {
    tick: state.tick,
    population: metrics.population.total,
    births: Number(state.birthsCount || 0),
    deaths: Number(state.deathsCount || 0),
    doneReason: doneReason || null,
    scenario: scenarioMeta,
    trainingSignals: buildTrainingSignals(metrics),
    ...(debugPayload ? { debug: debugPayload } : {}),
  };
  const response = {
    reward: Number(reward || 0),
    done: Boolean(done),
    info,
  };
  if (compactTransport) {
    response.obsVector = buildCompactObservationVector(metrics, activeConfig);
  } else {
    response.obs = obs;
  }
  return response;
}

// Build compact training signals consumed by Python throughput diagnostics.
function buildTrainingSignals(metrics) {
  const underrealm = metrics
    && metrics.aiObservation
    && metrics.aiObservation.underrealm
    && typeof metrics.aiObservation.underrealm === 'object'
    ? metrics.aiObservation.underrealm
    : {};
  const worldEvents = metrics
    && metrics.aiObservation
    && metrics.aiObservation.worldEvents
    && typeof metrics.aiObservation.worldEvents === 'object'
    ? metrics.aiObservation.worldEvents
    : {};
  const contracts = metrics
    && metrics.aiObservation
    && metrics.aiObservation.contracts
    && typeof metrics.aiObservation.contracts === 'object'
    ? metrics.aiObservation.contracts
    : {};
  const externalCamps = metrics
    && metrics.aiObservation
    && metrics.aiObservation.externalCamps
    && typeof metrics.aiObservation.externalCamps === 'object'
    ? metrics.aiObservation.externalCamps
    : {};
  const schism = metrics
    && metrics.aiObservation
    && metrics.aiObservation.schism
    && typeof metrics.aiObservation.schism === 'object'
    ? metrics.aiObservation.schism
    : {};
  const social = metrics
    && metrics.aiObservation
    && metrics.aiObservation.social
    && typeof metrics.aiObservation.social === 'object'
    ? metrics.aiObservation.social
    : {};
  const warriors = metrics
    && metrics.aiObservation
    && metrics.aiObservation.warriors
    && typeof metrics.aiObservation.warriors === 'object'
    ? metrics.aiObservation.warriors
    : {};
  return {
    criticalNeedsFraction: Number(metrics.criticalNeedsFraction || 0),
    idleAdultsFraction: Number(metrics.idleAdultsFraction || 0),
    populationBalance: Number(metrics.populationBalance || 0),
    stockpileRatio: { ...(metrics.stockpileRatio || {}) },
    underrealmDepthProgress: Number(underrealm.depthProgress || 0),
    underrealmChampionProgress: Number(underrealm.championProgress || 0),
    underrealmReadinessScore: Number(underrealm.readinessScore || 0),
    underrealmCombatPressure: Number(underrealm.combatPressure || 0),
    worldEventPressure: Number(worldEvents.pressure || 0),
    worldEventOfferReady: Number(worldEvents.offerReady || 0),
    contractReady: Number(contracts.ready || 0),
    contractFailurePressure: Number(contracts.failurePressure || 0),
    externalCampPressure: Number(externalCamps.pressure || 0),
    externalCampRaiderPressure: Number(externalCamps.raiderPressure || 0),
    schismPressure: Number(schism.pressure || 0),
    schismLegitimacy: Number(schism.legitimacy || 0),
    socialCohesion: Number(social.cohesion || 0),
    socialConflictPressure: Number(social.conflictPressure || 0),
    socialMentorshipCoverage: Number(social.mentorshipCoverage || 0),
    socialGrudgeLoad: Number(social.grudgeLoad || 0),
    socialIncidentRecency: Number(social.incidentRecency || 0),
    warriorEnabled: Number(warriors.enabled || 0),
    warriorRosterCoverage: Number(warriors.rosterCoverage || 0),
    warriorEliteScore: Number(warriors.eliteScore || 0),
    warriorLegacyAura: Number(warriors.legacyAura || 0),
    warriorChampionMomentum: Number(warriors.championMomentum || 0),
    warriorTournamentRecency: Number(warriors.tournamentRecency || 0),
    warriorInjuryShare: Number(warriors.injuryShare || 0),
    warriorRetiredShare: Number(warriors.retiredShare || 0),
    warriorSurvivability: Number(warriors.survivability || 0),
    warriorHeroTurnoverPressure: Number(warriors.heroTurnoverPressure || 0),
    diplomacyPressure: Number(metrics.diplomacyPressure || 0),
    diplomacyCompletions: Number(metrics.diplomacyCompletions || 0),
    diplomacyFailures: Number(metrics.diplomacyFailures || 0),
    diplomacyExpirations: Number(metrics.diplomacyExpirations || 0),
  };
}

// Decide whether debug info should be included in a response.
function shouldIncludeDebug(done, forceDebug) {
  if (DEBUG_MODE === 'off') {
    return false;
  }
  if (DEBUG_MODE === 'final' || DEBUG_MODE === 'summary') {
    return Boolean(done || forceDebug);
  }
  return true;
}

// Build the debug payload based on the selected debug mode.
function getDebugPayload(state, config, metrics, done, forceDebug) {
  if (!shouldIncludeDebug(done, forceDebug)) {
    return null;
  }
  if (DEBUG_MODE === 'summary') {
    return buildDebugInfoMinimal(state, config, metrics);
  }
  return buildDebugInfo(state, config, metrics);
}

// Function: buildDebugInfo.
function buildDebugInfoMinimal(state, config, metrics) {
  const raidState = state.raid || {};
  const raidStats = state.raidStats || {};
  const raidObservation = metrics.raid || {};
  const underrealm = getUnderrealmDebugMetrics(state, config);
  const deathsByCause = getDeathsByCauseDebugMap(state);
  return {
    deaths: {
      starvation: Number(deathsByCause.starvation || 0),
      oldAge: Number(deathsByCause.oldAge || 0),
      raid: Number(deathsByCause.raid || 0),
    },
    deathsByCause,
    stockpile: {
      avgRatio: Number(metrics.stockpileAvg || 0),
      minRatio: Number(metrics.stockpileMin || 0),
    },
    raid: {
      active: Boolean(raidState.active),
      ticksRemaining: Number(raidState.ticksRemaining || 0),
      season: raidState.seasonName || null,
      count: Number(raidStats.count || 0),
      deaths: Number(raidStats.deaths || 0),
      loot: { ...(raidStats.loot || {}) },
      exposedRatio: Number(raidObservation.exposedRatio || 0),
      defenseRatio: Number(raidObservation.defenseRatio || 0),
      seasonEligible: Number(raidObservation.seasonEligible || 0),
    },
    nodes: { ...(metrics.nodeRatio || {}) },
    underrealm,
    weather: state.weather && state.weather.type ? { type: state.weather.type } : null,
    criticalNeedsFraction: Number(metrics.criticalNeedsFraction || 0),
    idleAdultsFraction: Number(metrics.idleAdultsFraction || 0),
  };
}

// Function: getDeathsByCauseDebugMap.
function getDeathsByCauseDebugMap(state) {
  const source = state && state.deathsByCause && typeof state.deathsByCause === 'object'
    ? state.deathsByCause
    : {};
  const preferredOrder = ['starvation', 'oldAge', 'raid', 'deepRaid', 'ruins', 'hunt', 'warriorLeague'];
  const normalized = {};
  for (const key of preferredOrder) {
    normalized[key] = Math.max(0, Number(source[key] || 0));
  }
  for (const [key, value] of Object.entries(source)) {
    if (Object.prototype.hasOwnProperty.call(normalized, key)) {
      continue;
    }
    normalized[key] = Math.max(0, Number(value || 0));
  }
  return normalized;
}

// Function: buildDebugInfo.
function buildDebugInfo(state, config, metrics) {
  const deathsByCause = getDeathsByCauseDebugMap(state);
  const reproduction = state.reproductionStats || {};
  const ticks = Number(reproduction.ticks || 0);
  const avg = (value) => (ticks > 0 ? Number(value || 0) / ticks : 0);
  const attempts = Number(reproduction.attempts || 0);
  const successes = Number(reproduction.successes || 0);
  const resources = config.resources || {};
  const targets = resources.targets || {};
  const housingConfig = (config.population && config.population.housing) || {};
  const housingEnabled = housingConfig.enabled !== false;
  const houses = housingEnabled
    ? (state.structures || []).filter((structure) => structure.type === 'house')
    : [];
  const houseCount = houses.length;
  const bedsTotal = houses.reduce((sum, house) => {
    return sum + Math.max(0, Number(house.capacity || 0));
  }, 0);
  const population = Math.max(1, state.dwarves.length);
  const housingRatio = housingEnabled
    ? (bedsTotal > 0 ? bedsTotal / population : 0)
    : 1;
  const unshelteredFraction = housingEnabled ? clamp(1 - housingRatio, 0, 1) : 0;
  const fieldConfig = (config.structures && config.structures.field) || {};
  const minIrrigation = Number(fieldConfig.irrigationMinMultiplier ?? 1);
  const maxIrrigation = Number(fieldConfig.irrigationMaxMultiplier ?? 1);
  const irrigationLow = Math.min(minIrrigation, maxIrrigation);
  const irrigationHigh = Math.max(minIrrigation, maxIrrigation);
  const waterRatio = getStockpileRatio(state, config, 'water');
  const weatherConfig = config.weather || {};
  const weatherStates = weatherConfig.states || {};
  const weatherType = state.weather && state.weather.type ? state.weather.type : null;
  const weatherDef = weatherType ? (weatherStates[weatherType] || {}) : {};
  const weatherIrrigationRaw = Number(weatherDef.irrigation ?? 1);
  const weatherFieldRegenRaw = Number(weatherDef.fieldRegen ?? 1);
  const weatherNodeRegenRaw = Number(weatherDef.nodeRegen ?? 1);
  const weatherIrrigation = Number.isFinite(weatherIrrigationRaw) ? weatherIrrigationRaw : 1;
  const weatherFieldRegen = Number.isFinite(weatherFieldRegenRaw) ? weatherFieldRegenRaw : 1;
  const weatherNodeRegen = Number.isFinite(weatherNodeRegenRaw) ? weatherNodeRegenRaw : 1;
  const irrigationBase = irrigationLow + (irrigationHigh - irrigationLow) * clamp(waterRatio, 0, 1);
  const irrigationMultiplier = irrigationBase * weatherIrrigation;
  const fieldSeasonMultiplier = getSeasonValue(state, 'fieldRegen', 1);
  const fieldNodes = (state.nodes || []).filter((node) => node.source === 'field' && node.id === 'food');
  const fieldNodeRatio = getNodeRatioForNodes(fieldNodes);
  const merchantStats = state.merchantStats || {};
  const merchantTicks = Number(merchantStats.ticks || 0);
  const merchantTradesPerTick = merchantTicks > 0
    ? Number(merchantStats.trades || 0) / merchantTicks
    : 0;
  const merchantGivenPerTick = scaleMerchantMap(merchantStats.given, merchantTicks);
  const merchantReceivedPerTick = scaleMerchantMap(merchantStats.received, merchantTicks);
  const raidState = state.raid || {};
  const raidStats = state.raidStats || {};
  const raidObservation = metrics.raid || {};
  const underrealm = getUnderrealmDebugMetrics(state, config);

  return {
    deaths: {
      starvation: Number(deathsByCause.starvation || 0),
      oldAge: Number(deathsByCause.oldAge || 0),
      raid: Number(deathsByCause.raid || 0),
    },
    deathsByCause,
    reproduction: {
      ticks,
      couplesPerTick: avg(reproduction.couples),
      fertileAdultsPerTick: avg(reproduction.fertileAdults),
      pregnanciesPerTick: avg(reproduction.pregnancies),
      cooldownsPerTick: avg(reproduction.cooldowns),
      resourceFactor: avg(reproduction.resourceFactorSum),
      crowdingFactor: avg(reproduction.crowdingFactorSum),
      moraleFactor: avg(reproduction.moraleFactorSum),
      seasonFactor: avg(reproduction.seasonFactorSum),
      chance: avg(reproduction.chanceSum),
      attempts,
      successes,
      successRate: attempts > 0 ? successes / attempts : 0,
      blocked: {
        infertile: Number(reproduction.blockedInfertile || 0),
        pregnant: Number(reproduction.blockedPregnant || 0),
        cooldown: Number(reproduction.blockedCooldown || 0),
        noResources: Number(reproduction.blockedNoResources || 0),
        noHousing: Number(reproduction.blockedNoHousing || 0),
        chance: Number(reproduction.blockedChance || 0),
      },
    },
    stockpile: {
      current: { ...state.stockpile },
      targets: { ...targets },
      ratios: { ...metrics.stockpileRatio },
      avgRatio: Number(metrics.stockpileAvg || 0),
      minRatio: Number(metrics.stockpileMin || 0),
    },
    housing: {
      houses: houseCount,
      beds: bedsTotal,
      ratio: Number(housingRatio || 0),
      unshelteredFraction: Number(unshelteredFraction || 0),
    },
    fields: {
      nodes: fieldNodes.length,
      nodeRatio: fieldNodeRatio,
      waterRatio: Number(waterRatio || 0),
      irrigationMultiplier: Number(irrigationMultiplier || 0),
      seasonMultiplier: Number(fieldSeasonMultiplier || 0),
      regenMultiplier: Number(irrigationMultiplier * fieldSeasonMultiplier * weatherFieldRegen * weatherNodeRegen || 0),
    },
    weather: state.weather
      ? {
        type: state.weather.type,
        remaining: Number(state.weather.ticksRemaining || 0),
        duration: Number(state.weather.duration || 0),
      }
      : null,
    merchant: {
      tradesPerTick: Number(merchantTradesPerTick || 0),
      givenPerTick: merchantGivenPerTick,
      receivedPerTick: merchantReceivedPerTick,
    },
    raid: {
      active: Boolean(raidState.active),
      ticksRemaining: Number(raidState.ticksRemaining || 0),
      season: raidState.seasonName || null,
      count: Number(raidStats.count || 0),
      deaths: Number(raidStats.deaths || 0),
      loot: { ...(raidStats.loot || {}) },
      exposedRatio: Number(raidObservation.exposedRatio || 0),
      defenseRatio: Number(raidObservation.defenseRatio || 0),
      seasonEligible: Number(raidObservation.seasonEligible || 0),
    },
    underrealm,
    nodes: { ...metrics.nodeRatio },
    needsAvg: { ...metrics.needsAvg },
    criticalNeedsFraction: Number(metrics.criticalNeedsFraction || 0),
    idleAdultsFraction: Number(metrics.idleAdultsFraction || 0),
  };
}

// Function: scaleMerchantMap.
function scaleMerchantMap(values, ticks) {
  const result = {};
  if (!values || typeof values !== 'object') {
    return result;
  }
  const divisor = Number(ticks || 0);
  for (const [key, value] of Object.entries(values)) {
    const amount = Number(value || 0);
    result[key] = divisor > 0 ? amount / divisor : 0;
  }
  return result;
}

// Resolve underrealm debug metrics with stable numeric defaults.
function getUnderrealmDebugMetrics(state, config) {
  const aiObservation = resolveAiObservation(state, config);
  const underrealm = aiObservation.underrealm;
  return {
    depthProgress: Number(underrealm.depthProgress || 0),
    championProgress: Number(underrealm.championProgress || 0),
    frontierContested: Number(underrealm.frontierContested || 0),
    championCooldown: Number(underrealm.championCooldown || 0),
    readinessScore: Number(underrealm.readinessScore || 0),
    readinessGap: Number(underrealm.readinessGap || 0),
    readinessBlocked: Number(underrealm.readinessBlocked || 0),
    readinessWarning: Number(underrealm.readinessWarning || 0),
    combatPressure: Number(underrealm.combatPressure || 0),
  };
}

// Resolve AI observation channels once with stable object defaults.
function resolveAiObservation(state, config) {
  const aiObservation = buildAiObservation(state, config) || {};
  return {
    ruins: aiObservation.ruins && typeof aiObservation.ruins === 'object'
      ? aiObservation.ruins
      : {},
    underrealm: aiObservation.underrealm && typeof aiObservation.underrealm === 'object'
      ? aiObservation.underrealm
      : {},
    myths: aiObservation.myths && typeof aiObservation.myths === 'object'
      ? aiObservation.myths
      : {},
    worldEvents: aiObservation.worldEvents && typeof aiObservation.worldEvents === 'object'
      ? aiObservation.worldEvents
      : {},
    contracts: aiObservation.contracts && typeof aiObservation.contracts === 'object'
      ? aiObservation.contracts
      : {},
    externalCamps: aiObservation.externalCamps && typeof aiObservation.externalCamps === 'object'
      ? aiObservation.externalCamps
      : {},
    schism: aiObservation.schism && typeof aiObservation.schism === 'object'
      ? aiObservation.schism
      : {},
    social: aiObservation.social && typeof aiObservation.social === 'object'
      ? aiObservation.social
      : {},
    warriors: aiObservation.warriors && typeof aiObservation.warriors === 'object'
      ? aiObservation.warriors
      : {},
    clanShares: aiObservation.clanShares && typeof aiObservation.clanShares === 'object'
      ? aiObservation.clanShares
      : {},
    strategic: aiObservation.strategic && typeof aiObservation.strategic === 'object'
      ? aiObservation.strategic
      : {},
  };
}

// Resolve compact AI reward signals from observation channels.
function getAiRewardSignals(aiObservation) {
  const underrealm = aiObservation && aiObservation.underrealm
    ? aiObservation.underrealm
    : {};
  const myths = aiObservation && aiObservation.myths
    ? aiObservation.myths
    : {};
  const worldEvents = aiObservation && aiObservation.worldEvents
    ? aiObservation.worldEvents
    : {};
  const contracts = aiObservation && aiObservation.contracts
    ? aiObservation.contracts
    : {};
  const externalCamps = aiObservation && aiObservation.externalCamps
    ? aiObservation.externalCamps
    : {};
  const schism = aiObservation && aiObservation.schism
    ? aiObservation.schism
    : {};
  const social = aiObservation && aiObservation.social
    ? aiObservation.social
    : {};
  const worldEventPressure = clamp(Number(worldEvents.pressure || 0), 0, 1);
  const contractFailurePressure = clamp(Number(contracts.failurePressure || 0), 0, 1);
  const externalCampPressure = clamp(Number(externalCamps.pressure || 0), 0, 1);
  const externalCampRaiderPressure = clamp(Number(externalCamps.raiderPressure || 0), 0, 1);
  const schismPressure = clamp(Number(schism.pressure || 0), 0, 1);
  const schismLegitimacy = clamp(Number(schism.legitimacy || 0), 0, 1);
  const schismInstability = clamp(Number(schism.instability || 0), 0, 1);
  const socialCohesion = clamp(Number(social.cohesion || 0), 0, 1);
  const socialConflictPressure = clamp(Number(social.conflictPressure || 0), 0, 1);
  const socialMentorshipCoverage = clamp(Number(social.mentorshipCoverage || 0), 0, 1);
  const socialGrudgeLoad = clamp(Number(social.grudgeLoad || 0), 0, 1);
  const socialIncidentRecency = clamp(Number(social.incidentRecency || 0), 0, 1);
  const socialPressure = clamp(
    socialConflictPressure * 0.52
      + socialGrudgeLoad * 0.28
      + (1 - socialCohesion) * 0.14
      + socialIncidentRecency * 0.06,
    0,
    1,
  );
  const diplomacyPressure = clamp(
    worldEventPressure * 0.18
      + contractFailurePressure * 0.23
      + externalCampPressure * 0.22
      + externalCampRaiderPressure * 0.09
      + schismPressure * 0.1
      + schismInstability * 0.05
      + (1 - schismLegitimacy) * 0.05
      + socialPressure * 0.08,
    0,
    1,
  );
  return {
    underrealmDepthProgress: clamp(Number(underrealm.depthProgress || 0), 0, 1),
    underrealmChampionProgress: clamp(Number(underrealm.championProgress || 0), 0, 1),
    underrealmReadinessScore: clamp(Number(underrealm.readinessScore || 0), 0, 1),
    underrealmCombatPressure: clamp(Number(underrealm.combatPressure || 0), 0, 1),
    mythsActiveRatio: clamp(Number(myths.activeRatio || 0), 0, 1),
    mythsSeverity: clamp(Number(myths.severity || 0), 0, 1),
    worldEventPressure,
    contractFailurePressure,
    externalCampPressure,
    externalCampRaiderPressure,
    schismPressure,
    schismLegitimacy,
    socialCohesion,
    socialConflictPressure,
    socialMentorshipCoverage,
    socialGrudgeLoad,
    socialIncidentRecency,
    socialPressure,
    diplomacyPressure,
  };
}

// Function: getSeasonValue.
function getSeasonValue(state, key, fallback) {
  if (!state || !state.season || !state.season.modifiers) {
    return fallback;
  }
  const value = state.season.modifiers[key];
  return Number.isFinite(value) ? Number(value) : fallback;
}

// Function: getStockpileRatio.
function getStockpileRatio(state, config, resourceId) {
  const targets = (config.resources && config.resources.targets) || {};
  const target = Number(targets[resourceId] || 0);
  if (target <= 0) {
    return 1;
  }
  const current = Number(state.stockpile[resourceId] || 0);
  return clamp(current / target, 0, 1);
}

// Function: getNodeRatioForNodes.
function getNodeRatioForNodes(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return 1;
  }
  let totalCapacity = 0;
  let totalRemaining = 0;
  for (const node of nodes) {
    const capacity = Math.max(0, Number(node.capacity || 0));
    const remaining = Math.max(0, Number(node.remaining || 0));
    totalCapacity += capacity;
    totalRemaining += remaining;
  }
  if (totalCapacity <= 0) {
    return 1;
  }
  return clamp(totalRemaining / totalCapacity, 0, 1);
}

// Function: getWeatherSeverity.
function getWeatherSeverity(state, config) {
  if (!state || !state.weather || !state.weather.type) {
    return 0;
  }
  const weatherConfig = (config && config.weather) || {};
  const states = weatherConfig.states || {};
  const type = state.weather.type;
  const def = states[type] || {};
  const configured = Number(def.severity);
  if (Number.isFinite(configured)) {
    return clamp(configured, 0, 1);
  }
  const fallback = {
    clear: 0,
    rain: 0.35,
    storm: 0.75,
    drought: 1,
    cold: 0.6,
  };
  return clamp(Number(fallback[type] || 0), 0, 1);
}

// Function: getWeatherTimeLeft.
function getWeatherTimeLeft(state) {
  if (!state || !state.weather) {
    return 0;
  }
  const duration = Number(state.weather.duration || 0);
  if (duration <= 0) {
    return 0;
  }
  const remaining = Number(state.weather.ticksRemaining || 0);
  return clamp(remaining / duration, 0, 1);
}

// Function: getHousingStats.
function getHousingStats(state, config) {
  const housingConfig = (config.population && config.population.housing) || {};
  const housingEnabled = housingConfig.enabled !== false;
  const houses = housingEnabled
    ? (state.structures || []).filter((structure) => structure.type === 'house')
    : [];
  const bedsTotal = houses.reduce((sum, house) => {
    return sum + Math.max(0, Number(house.capacity || 0));
  }, 0);
  const population = Math.max(1, state.dwarves.length);
  const housingRatio = housingEnabled
    ? (bedsTotal > 0 ? bedsTotal / population : 0)
    : 1;
  return {
    housingEnabled,
    houses,
    bedsTotal,
    population,
    housingRatio,
  };
}

// Function: getRaidObservation.
function getRaidObservation(state, config, housingStats) {
  const raidConfig = (config && config.raids) || {};
  const raidState = state.raid || {};
  const houses = housingStats ? housingStats.houses : (state.structures || []).filter((structure) => {
    return structure.type === 'house';
  });
  const population = housingStats ? housingStats.population : Math.max(1, state.dwarves.length);
  const houseMap = new Map(houses.map((house) => [house.id, house]));
  let exposedCount = 0;

  for (const dwarf of state.dwarves) {
    const home = dwarf.homeId ? houseMap.get(dwarf.homeId) : null;
    const sheltered = Boolean(home && dwarf.x === home.x && dwarf.y === home.y);
    if (!sheltered) {
      exposedCount += 1;
    }
  }

  const exposedRatio = population > 0 ? clamp(exposedCount / population, 0, 1) : 0;
  const adults = state.dwarves.filter((dwarf) => dwarf.lifeStage === 'adult').length;
  const defenseAdults = Math.max(1, Number(raidConfig.defenseAdults || population));
  const defenseMax = clamp(Number(raidConfig.defenseMax ?? 0), 0, 1);
  const defenseRaw = clamp(adults / defenseAdults, 0, defenseMax);
  const towerConfig = (config.structures && config.structures.watchtower) || {};
  const towerRaid = towerConfig.raid || {};
  const towerCount = (state.structures || []).filter((structure) => structure.type === 'watchtower').length;
  const towerDefensePer = Math.max(0, Number(towerRaid.defensePerTower ?? 0));
  const towerDefenseMax = clamp(Number(towerRaid.defenseMax ?? 0), 0, 1);
  const towerDefense = clamp(towerCount * towerDefensePer, 0, towerDefenseMax);
  const totalDefense = clamp(defenseRaw + towerDefense, 0, 1);
  const defenseRatio = clamp(totalDefense, 0, 1);

  const duration = Math.max(1, Number(raidState.duration || raidConfig.durationTicks || 0));
  const ticksRemaining = Math.max(0, Number(raidState.ticksRemaining || 0));
  const timeLeftRatio = duration > 0 ? clamp(ticksRemaining / duration, 0, 1) : 0;

  const seasonNames = Array.isArray(raidConfig.seasonNames) && raidConfig.seasonNames.length > 0
    ? raidConfig.seasonNames
    : ['spring', 'autumn'];
  const seasonName = state.season ? state.season.name : null;
  let seasonEligible = raidConfig.enabled === true
    && seasonName
    && seasonNames.includes(seasonName)
    ? 1
    : 0;
  const minTick = Math.max(0, Number(raidConfig.minTick || 0));
  const minPopulation = Math.max(0, Number(raidConfig.minPopulation || 0));
  if (state.tick < minTick || population < minPopulation) {
    seasonEligible = 0;
  }

  return {
    active: Boolean(raidState.active),
    timeLeftRatio,
    exposedRatio,
    defenseRatio,
    seasonEligible,
  };
}

// Function: cloneLootMap.
function cloneLootMap(loot) {
  const clone = {};
  for (const [resource, value] of Object.entries(loot || {})) {
    clone[resource] = Number(value || 0);
  }
  return clone;
}

// Function: getRaidLootDelta.
function getRaidLootDelta(prevLoot, nextLoot) {
  const delta = {};
  const prev = prevLoot || {};
  const next = nextLoot || {};
  for (const [resource, value] of Object.entries(next)) {
    const diff = Number(value || 0) - Number(prev[resource] || 0);
    if (diff > 0) {
      delta[resource] = diff;
    }
  }
  return delta;
}

// Function: getRaidLootRatio.
function getRaidLootRatio(deltaLoot, config) {
  const targets = (config.resources && config.resources.targets) || {};
  let sum = 0;
  let count = 0;
  for (const [resource, amount] of Object.entries(deltaLoot)) {
    const target = Number(targets[resource] || 0);
    if (target <= 0) {
      continue;
    }
    sum += clamp(Number(amount || 0) / target, 0, 1);
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

// Function: buildObservation.
function buildObservation(state, config, metrics) {
  const weatherSeverity = Number(metrics.weatherSeverity ?? getWeatherSeverity(state, config));
  const weatherTimeLeft = Number(metrics.weatherTimeLeft ?? getWeatherTimeLeft(state));
  const festivalObservation = metrics.festivalObservation || getFestivalObservation(state, config);
  const aiObservation = metrics.aiObservation || resolveAiObservation(state, config);
  return {
    tick: state.tick,
    season: metrics.season || state.season || null,
    weather: {
      type: state.weather ? state.weather.type : null,
      severity: weatherSeverity,
      timeLeft: weatherTimeLeft,
    },
    population: metrics.population,
    stockpile: { ...state.stockpile },
    targets: { ...((config.resources && config.resources.targets) || {}) },
    stockpileRatio: metrics.stockpileRatio,
    nodes: metrics.nodeRatio,
    needsAvg: metrics.needsAvg,
    criticalNeedsFraction: metrics.criticalNeedsFraction,
    idleAdultsFraction: metrics.idleAdultsFraction,
    populationBalance: metrics.populationBalance,
    housingRatio: metrics.housingRatio,
    raid: metrics.raid,
    festival: festivalObservation,
    ruins: aiObservation.ruins || {
      active: 0,
      cooldownRatio: 0,
      progress: 0,
      artifacts: 0,
    },
    underrealm: aiObservation.underrealm || {
      depthProgress: 0,
      championProgress: 0,
      frontierContested: 0,
      championCooldown: 0,
      readinessScore: 0,
      readinessGap: 0,
      readinessBlocked: 0,
      readinessWarning: 0,
      combatPressure: 0,
    },
    myths: aiObservation.myths || {
      activeRatio: 0,
      severity: 0,
      flags: {},
    },
    worldEvents: aiObservation.worldEvents || {
      active: 0,
      offerPhase: 0,
      offerReady: 0,
      timeLeft: 0,
      spawnImminence: 0,
      pressure: 0,
    },
    contracts: aiObservation.contracts || {
      active: 0,
      ready: 0,
      timeLeft: 0,
      failurePressure: 0,
      reputation: 0,
      expiryPressure: 0,
      pressure: 0,
    },
    externalCamps: aiObservation.externalCamps || {
      activeRatio: 0,
      raiderPressure: 0,
      caravanRisk: 0,
      militiaSupport: 0,
      tradeInfluence: 0,
      pressure: 0,
    },
    schism: aiObservation.schism || {
      pressure: 0,
      legitimacy: 0,
      phase: 0,
      doctrineRevelry: 0,
      ritualOpen: 0,
      ritualActive: 0,
      climaxActive: 0,
      instability: 0,
    },
    social: aiObservation.social || {
      cohesion: 0,
      conflictPressure: 0,
      mentorshipCoverage: 0,
      grudgeLoad: 0,
      incidentRecency: 0,
    },
    warriors: aiObservation.warriors || {
      enabled: 0,
      rosterCoverage: 0,
      eliteScore: 0,
      legacyAura: 0,
      championMomentum: 0,
      tournamentRecency: 0,
      injuryShare: 0,
      retiredShare: 0,
      survivability: 0,
      heroTurnoverPressure: 0,
    },
    clanShares: aiObservation.clanShares || {},
    strategic: aiObservation.strategic || {},
  };
}

// Build a compact flattened observation vector ordered by transport resources/features.
function buildCompactObservationVector(metrics, config) {
  const resources = Array.isArray(transportState && transportState.resources) && transportState.resources.length > 0
    ? transportState.resources
    : Object.keys((metrics && metrics.stockpileRatio) || {});
  const featureSpecs = Array.isArray(transportState && transportState.featureSpecs)
    && transportState.featureSpecs.length > 0
    ? transportState.featureSpecs
    : compileFeatureSpecs(DEFAULT_FEATURE_NAMES);
  const featureCount = featureSpecs.length;
  if (resources.length === 0 || featureCount === 0) {
    return [];
  }

  const ratios = (metrics && metrics.stockpileRatio) || {};
  const nodeRatios = (metrics && metrics.nodeRatio) || {};
  const raid = (metrics && metrics.raid) || {};
  const festival = (metrics && metrics.festivalObservation) || {};
  const aiObservation = (metrics && metrics.aiObservation) || {};
  const ruins = aiObservation.ruins && typeof aiObservation.ruins === 'object'
    ? aiObservation.ruins
    : {};
  const underrealm = aiObservation.underrealm && typeof aiObservation.underrealm === 'object'
    ? aiObservation.underrealm
    : {};
  const myths = aiObservation.myths && typeof aiObservation.myths === 'object'
    ? aiObservation.myths
    : {};
  const worldEvents = aiObservation.worldEvents && typeof aiObservation.worldEvents === 'object'
    ? aiObservation.worldEvents
    : {};
  const contracts = aiObservation.contracts && typeof aiObservation.contracts === 'object'
    ? aiObservation.contracts
    : {};
  const externalCamps = aiObservation.externalCamps && typeof aiObservation.externalCamps === 'object'
    ? aiObservation.externalCamps
    : {};
  const schism = aiObservation.schism && typeof aiObservation.schism === 'object'
    ? aiObservation.schism
    : {};
  const social = aiObservation.social && typeof aiObservation.social === 'object'
    ? aiObservation.social
    : {};
  const warriors = aiObservation.warriors && typeof aiObservation.warriors === 'object'
    ? aiObservation.warriors
    : {};
  const mythFlags = myths.flags && typeof myths.flags === 'object' ? myths.flags : {};
  const clanShares = aiObservation.clanShares && typeof aiObservation.clanShares === 'object'
    ? aiObservation.clanShares
    : {};
  const { seasonIndex, seasonProgress } = compactSeasonFeatures(
    (metrics && metrics.season) || (state && state.season),
  );
  const staticValues = {
    criticalNeeds: clamp(Number(metrics && metrics.criticalNeedsFraction || 0), 0, 1),
    idleAdults: clamp(Number(metrics && metrics.idleAdultsFraction || 0), 0, 1),
    populationBalance: clamp(Number(metrics && metrics.populationBalance || 0), 0, 1),
    seasonIndex,
    seasonProgress,
    weatherSeverity: clamp(
      Number(metrics && metrics.weatherSeverity !== undefined
        ? metrics.weatherSeverity
        : getWeatherSeverity(state, config)),
      0,
      1,
    ),
    weatherTimeLeft: clamp(
      Number(metrics && metrics.weatherTimeLeft !== undefined
        ? metrics.weatherTimeLeft
        : getWeatherTimeLeft(state)),
      0,
      1,
    ),
    raidActive: raid.active ? 1 : 0,
    raidTimeLeft: clamp(Number(raid.timeLeftRatio || 0), 0, 1),
    raidExposed: clamp(Number(raid.exposedRatio || 0), 0, 1),
    raidDefense: clamp(Number(raid.defenseRatio || 0), 0, 1),
    seasonEligible: clamp(Number(raid.seasonEligible || 0), 0, 1),
    housingShortage: clamp(1 - Number(metrics && metrics.housingRatio || 0), 0, 1),
    festivalActive: festival.active ? 1 : 0,
    festivalTimeLeft: clamp(Number(festival.timeLeft || 0), 0, 1),
    festivalEligible: clamp(Number(festival.eligible || 0), 0, 1),
    festivalCostRatio: clamp(Number(festival.costRatio || 0), 0, 1),
    ruinsActive: ruins.active ? 1 : 0,
    ruinsCooldown: clamp(Number(ruins.cooldownRatio || 0), 0, 1),
    ruinsProgress: clamp(Number(ruins.progress || 0), 0, 1),
    ruinsArtifacts: clamp(Number(ruins.artifacts || 0), 0, 1),
    underrealmDepthProgress: clamp(Number(underrealm.depthProgress || 0), 0, 1),
    underrealmChampionProgress: clamp(Number(underrealm.championProgress || 0), 0, 1),
    underrealmFrontierContested: clamp(Number(underrealm.frontierContested || 0), 0, 1),
    underrealmChampionCooldown: clamp(Number(underrealm.championCooldown || 0), 0, 1),
    underrealmReadinessScore: clamp(Number(underrealm.readinessScore || 0), 0, 1),
    underrealmReadinessGap: clamp(Number(underrealm.readinessGap || 0), 0, 1),
    underrealmReadinessBlocked: clamp(Number(underrealm.readinessBlocked || 0), 0, 1),
    underrealmReadinessWarning: clamp(Number(underrealm.readinessWarning || 0), 0, 1),
    underrealmCombatPressure: clamp(Number(underrealm.combatPressure || 0), 0, 1),
    mythsActiveRatio: clamp(Number(myths.activeRatio || 0), 0, 1),
    mythsSeverity: clamp(Number(myths.severity || 0), 0, 1),
    worldEventActive: clamp(Number(worldEvents.active || 0), 0, 1),
    worldEventOfferPhase: clamp(Number(worldEvents.offerPhase || 0), 0, 1),
    worldEventOfferReady: clamp(Number(worldEvents.offerReady || 0), 0, 1),
    worldEventTimeLeft: clamp(Number(worldEvents.timeLeft || 0), 0, 1),
    worldEventSpawnImminence: clamp(Number(worldEvents.spawnImminence || 0), 0, 1),
    worldEventPressure: clamp(Number(worldEvents.pressure || 0), 0, 1),
    contractActive: clamp(Number(contracts.active || 0), 0, 1),
    contractReady: clamp(Number(contracts.ready || 0), 0, 1),
    contractTimeLeft: clamp(Number(contracts.timeLeft || 0), 0, 1),
    contractFailurePressure: clamp(Number(contracts.failurePressure || 0), 0, 1),
    contractReputation: clamp(Number(contracts.reputation || 0), 0, 1),
    contractPressure: clamp(Number(contracts.pressure || 0), 0, 1),
    externalCampActiveRatio: clamp(Number(externalCamps.activeRatio || 0), 0, 1),
    externalCampRaiderPressure: clamp(Number(externalCamps.raiderPressure || 0), 0, 1),
    externalCampCaravanRisk: clamp(Number(externalCamps.caravanRisk || 0), 0, 1),
    externalCampMilitiaSupport: clamp(Number(externalCamps.militiaSupport || 0), 0, 1),
    externalCampTradeInfluence: clamp(Number(externalCamps.tradeInfluence || 0), 0, 1),
    externalCampPressure: clamp(Number(externalCamps.pressure || 0), 0, 1),
    schismPressure: clamp(Number(schism.pressure || 0), 0, 1),
    schismLegitimacy: clamp(Number(schism.legitimacy || 0), 0, 1),
    schismPhase: clamp(Number(schism.phase || 0), 0, 1),
    schismDoctrineRevelry: clamp(Number(schism.doctrineRevelry || 0), 0, 1),
    schismRitualOpen: clamp(Number(schism.ritualOpen || 0), 0, 1),
    schismRitualActive: clamp(Number(schism.ritualActive || 0), 0, 1),
    schismClimaxActive: clamp(Number(schism.climaxActive || 0), 0, 1),
    schismInstability: clamp(Number(schism.instability || 0), 0, 1),
    socialCohesion: clamp(Number(social.cohesion || 0), 0, 1),
    socialConflictPressure: clamp(Number(social.conflictPressure || 0), 0, 1),
    socialMentorshipCoverage: clamp(Number(social.mentorshipCoverage || 0), 0, 1),
    socialGrudgeLoad: clamp(Number(social.grudgeLoad || 0), 0, 1),
    socialIncidentRecency: clamp(Number(social.incidentRecency || 0), 0, 1),
    warriorEnabled: clamp(Number(warriors.enabled || 0), 0, 1),
    warriorRosterCoverage: clamp(Number(warriors.rosterCoverage || 0), 0, 1),
    warriorEliteScore: clamp(Number(warriors.eliteScore || 0), 0, 1),
    warriorLegacyAura: clamp(Number(warriors.legacyAura || 0), 0, 1),
    warriorChampionMomentum: clamp(Number(warriors.championMomentum || 0), 0, 1),
    warriorTournamentRecency: clamp(Number(warriors.tournamentRecency || 0), 0, 1),
    warriorInjuryShare: clamp(Number(warriors.injuryShare || 0), 0, 1),
    warriorRetiredShare: clamp(Number(warriors.retiredShare || 0), 0, 1),
    warriorSurvivability: clamp(Number(warriors.survivability || 0), 0, 1),
    warriorHeroTurnoverPressure: clamp(Number(warriors.heroTurnoverPressure || 0), 0, 1),
  };
  const strategic = aiObservation.strategic && typeof aiObservation.strategic === 'object'
    ? aiObservation.strategic
    : {};
  for (const name of STRATEGIC_FEATURE_NAMES) {
    staticValues[name] = clamp(Number(strategic[name] || 0), 0, 1);
  }

  // Fill one full feature row for a resource; the observation plan picks the needed slots.
  const buildRow = (resource) => {
    const ratio = Number(ratios[resource] ?? 1);
    const nodeRatio = Number(nodeRatios[resource] ?? 1);
    const shortage = clamp(1 - ratio, 0, 1);
    const nodeScarcity = clamp(1 - nodeRatio, 0, 1);
    const row = new Array(featureCount);
    for (let index = 0; index < featureCount; index += 1) {
      const spec = featureSpecs[index];
      if (spec.kind === FEATURE_KIND_SHORTAGE) {
        row[index] = shortage;
      } else if (spec.kind === FEATURE_KIND_NODE_SCARCITY) {
        row[index] = nodeScarcity;
      } else if (spec.kind === FEATURE_KIND_STATIC) {
        row[index] = Number(staticValues[spec.key] || 0);
      } else if (spec.kind === FEATURE_KIND_MYTH_FLAG) {
        row[index] = clamp(Number(mythFlags[spec.key] || 0), 0, 1);
      } else if (spec.kind === FEATURE_KIND_CLAN_SHARE) {
        row[index] = clamp(Number(clanShares[spec.key] || 0), 0, 1);
      } else {
        row[index] = 0;
      }
    }
    return row;
  };

  const plan = transportState && transportState.observationPlan
    ? transportState.observationPlan
    : buildObservationPlan(resources, featureSpecs.map((spec) => spec.name));
  const vector = assembleObservationVector(plan, buildRow);

  return vector;
}

// Build season index/progress scalars aligned with Python trainer feature extraction.
function compactSeasonFeatures(season) {
  if (!season || typeof season !== 'object') {
    return { seasonIndex: 0, seasonProgress: 0 };
  }
  const index = Number(season.index || 0);
  const tick = Number(season.tickInSeason || 0);
  const duration = Math.max(1, Number(season.duration || 1));
  return {
    seasonIndex: clamp(index / 3, 0, 1),
    seasonProgress: clamp(tick / duration, 0, 1),
  };
}

// Function: computeMetrics.
function computeMetrics(state, config) {
  const targets = (config.resources && config.resources.targets) || {};
  const ratios = {};
  let ratioSum = 0;
  let ratioCount = 0;
  let minRatio = 1;

  for (const [resource, targetValue] of Object.entries(targets)) {
    const target = Number(targetValue || 0);
    if (target <= 0) {
      continue;
    }
    const current = Number(state.stockpile[resource] || 0);
    const ratio = clamp(current / target, 0, 1);
    ratios[resource] = ratio;
    ratioSum += ratio;
    ratioCount += 1;
    minRatio = Math.min(minRatio, ratio);
  }

  const stockpileAvg = ratioCount > 0 ? ratioSum / ratioCount : 1;
  const stockpileMin = ratioCount > 0 ? minRatio : 1;

  const population = countLifeStages(state.dwarves);
  const needsAvg = averageNeeds(state.dwarves);
  const criticalNeedsFraction = getCriticalNeedsFraction(state.dwarves, config);
  const idleAdultsFraction = getIdleAdultsFraction(state.dwarves, config);
  const populationBalance = getPopulationBalance(state, config);
  const nodeRatio = getObservationNodeRatio(state, config);
  const housingStats = getHousingStats(state, config);
  const raidObservation = getRaidObservation(state, config, housingStats);
  const ruinsStats = state && state.ruins ? state.ruins.stats || {} : {};
  const ruinsArtifacts = state && state.ruins && state.ruins.artifactsFound
    ? Object.keys(state.ruins.artifactsFound).length
    : 0;
  const ruinsRoomsCleared = state && state.ruins ? Number(state.ruins.roomsCleared || 0) : 0;
  const festival = state && state.festival ? state.festival : null;
  const festivalActive = festival && festival.active ? 1 : 0;
  const festivalObservation = getFestivalObservation(state, config);
  const festivalEligible = festivalObservation && festivalObservation.eligible ? 1 : 0;
  const aiObservation = resolveAiObservation(state, config);
  const aiSignals = getAiRewardSignals(aiObservation);
  const warriorsObservation = aiObservation.warriors && typeof aiObservation.warriors === 'object'
    ? aiObservation.warriors
    : {};
  const warriorRuntimeStats = state
    && state.warriors
    && state.warriors.stats
    && typeof state.warriors.stats === 'object'
      ? state.warriors.stats
      : {};
  const warriorEliteScore = clamp(Number(warriorsObservation.eliteScore || 0), 0, 1);
  const warriorChampionMomentum = clamp(Number(warriorsObservation.championMomentum || 0), 0, 1);
  const warriorSurvivability = clamp(Number(warriorsObservation.survivability || 0), 0, 1);
  const warriorInjuryShare = clamp(Number(warriorsObservation.injuryShare || 0), 0, 1);
  const warriorRetiredShare = clamp(Number(warriorsObservation.retiredShare || 0), 0, 1);
  const warriorHeroTurnoverPressure = clamp(
    Number(warriorsObservation.heroTurnoverPressure || 0),
    0,
    1,
  );
  const warriorHeroTurnovers = Math.max(0, Number(warriorRuntimeStats.heroTurnovers || 0));
  const worldEventStats = state && state.worldEvents && state.worldEvents.stats
    ? state.worldEvents.stats
    : {};
  const contractsStats = state && state.contracts && state.contracts.stats
    ? state.contracts.stats
    : {};
  const externalCampStats = state && state.externalCamps && state.externalCamps.stats
    ? state.externalCamps.stats
    : {};
  const externalCampByRole = externalCampStats && externalCampStats.byRole
    ? externalCampStats.byRole
    : {};
  const externalCampRaiderStats = externalCampByRole && externalCampByRole.raider
    ? externalCampByRole.raider
    : {};
  const worldEventCompletions = Math.max(0, Number(worldEventStats.completed || 0));
  const worldEventFailures = Math.max(0, Number(worldEventStats.failed || 0));
  const worldEventExpirations = Math.max(0, Number(worldEventStats.expired || 0));
  const contractSuccesses = Math.max(0, Number(contractsStats.successes || 0));
  const contractFailures = Math.max(0, Number(contractsStats.failures || 0));
  const diplomacyCompletions = worldEventCompletions + contractSuccesses;
  const diplomacyFailures = worldEventFailures + contractFailures;
  const diplomacyExpirations = worldEventExpirations;
  const externalCampRaiderRejected = Math.max(0, Number(externalCampRaiderStats.rejected || 0));
  const externalCampSkirmishes = Math.max(0, Number(externalCampStats.skirmishes || 0));

  return {
    stockpileAvg,
    stockpileMin,
    stockpileRatio: ratios,
    population,
    needsAvg,
    criticalNeedsFraction,
    idleAdultsFraction,
    populationBalance,
    nodeRatio,
    housingRatio: housingStats.housingRatio,
    raid: raidObservation,
    raidDeaths: Number(state.deathsByCause && state.deathsByCause.raid || 0),
    raidLoot: cloneLootMap(state.raidStats && state.raidStats.loot),
    weatherSeverity: getWeatherSeverity(state, config),
    weatherTimeLeft: getWeatherTimeLeft(state),
    season: state.season || null,
    festivalObservation,
    ruinsSuccesses: Number(ruinsStats.successes || 0),
    ruinsFailures: Number(ruinsStats.failures || 0),
    ruinsArtifacts,
    ruinsRoomsCleared,
    aiObservation,
    underrealmDepthProgress: aiSignals.underrealmDepthProgress,
    underrealmChampionProgress: aiSignals.underrealmChampionProgress,
    underrealmReadinessScore: aiSignals.underrealmReadinessScore,
    underrealmCombatPressure: aiSignals.underrealmCombatPressure,
    mythsActiveRatio: aiSignals.mythsActiveRatio,
    mythsSeverity: aiSignals.mythsSeverity,
    worldEventPressure: aiSignals.worldEventPressure,
    contractFailurePressure: aiSignals.contractFailurePressure,
    externalCampPressure: aiSignals.externalCampPressure,
    externalCampRaiderPressure: aiSignals.externalCampRaiderPressure,
    schismPressure: aiSignals.schismPressure,
    schismLegitimacy: aiSignals.schismLegitimacy,
    socialCohesion: aiSignals.socialCohesion,
    socialConflictPressure: aiSignals.socialConflictPressure,
    socialMentorshipCoverage: aiSignals.socialMentorshipCoverage,
    socialGrudgeLoad: aiSignals.socialGrudgeLoad,
    socialIncidentRecency: aiSignals.socialIncidentRecency,
    socialPressure: aiSignals.socialPressure,
    warriorEliteScore,
    warriorChampionMomentum,
    warriorSurvivability,
    warriorInjuryShare,
    warriorRetiredShare,
    warriorHeroTurnoverPressure,
    warriorHeroTurnovers,
    diplomacyPressure: aiSignals.diplomacyPressure,
    worldEventCompletions,
    worldEventFailures,
    worldEventExpirations,
    contractSuccesses,
    contractFailures,
    diplomacyCompletions,
    diplomacyFailures,
    diplomacyExpirations,
    externalCampRaiderRejected,
    externalCampSkirmishes,
    festivalActive,
    festivalEligible,
    outcomeSignals: computeOutcomeSignals(state, config),
  };
}

// Reward for one decision step: the compact outcome reward (src/ai/outcome_reward.js).
function computeReward(prevMetrics, metrics, config) {
  const previous = prevMetrics && prevMetrics.outcomeSignals ? prevMetrics.outcomeSignals : metrics.outcomeSignals;
  return computeOutcomeReward(previous, metrics.outcomeSignals, config).total;
}

// Function: getPopulationFactor.
function getPopulationFactor(population, config) {
  const reproduction = config.population && config.population.reproduction;
  const softCap = Number(reproduction && reproduction.softCap || 0);
  if (softCap > 0) {
    return clamp(population / softCap, 0, 1);
  }
  return population > 0 ? 1 : 0;
}

// Episode end: extinction (terminal) or the episode tick limit (a time limit, bootstrapped by the
// trainer). There is no early stop for settled colonies (stable termination was removed in T4).
function getDoneStatus(state, config) {
  const aiConfig = config.ai || {};
  const maxTicks = Number(aiConfig.maxTicks || 0);
  const simMaxTicks = Number(config.simulation && config.simulation.maxTicks || 0);
  const limit = Math.max(maxTicks > 0 ? maxTicks : simMaxTicks, Number(state.episodeTickLimit || 0));
  if (state.dwarves.length === 0) {
    return { done: true, reason: 'extinction' };
  }
  const startTick = Number(state.episodeStartTick || 0);
  if (limit > 0 && state.tick - startTick >= limit) {
    return { done: true, reason: 'maxTicks' };
  }

  return { done: false, reason: null };
}

// Function: countLifeStages.
function countLifeStages(dwarves) {
  const counts = { total: dwarves.length, child: 0, adult: 0, elder: 0 };
  for (const dwarf of dwarves) {
    const stage = dwarf.lifeStage || 'adult';
    if (counts[stage] !== undefined) {
      counts[stage] += 1;
    } else {
      counts.adult += 1;
    }
  }
  return counts;
}

// Function: averageNeeds.
function averageNeeds(dwarves) {
  const totals = {};
  const count = dwarves.length || 1;

  for (const dwarf of dwarves) {
    for (const [need, value] of Object.entries(dwarf.needs)) {
      totals[need] = (totals[need] || 0) + Number(value || 0);
    }
  }

  for (const need of Object.keys(totals)) {
    totals[need] = totals[need] / count;
  }

  return totals;
}

// Function: getCriticalNeedsFraction.
function getCriticalNeedsFraction(dwarves, config) {
  if (dwarves.length === 0) {
    return 0;
  }
  const aiConfig = config.ai || {};
  const threshold = Number(aiConfig.criticalNeedThreshold ?? 0.9);
  let critical = 0;

  for (const dwarf of dwarves) {
    const needs = dwarf.needs || {};
    const over = Object.values(needs).some((value) => Number(value || 0) >= threshold);
    if (over) {
      critical += 1;
    }
  }

  return critical / dwarves.length;
}

// Function: getIdleAdultsFraction.
function getIdleAdultsFraction(dwarves, config) {
  const adults = dwarves.filter((dwarf) => dwarf.lifeStage === 'adult');
  if (adults.length === 0) {
    return 0;
  }
  const idleAdults = adults.filter((dwarf) => !dwarf.job).length;
  return idleAdults / adults.length;
}

// Function: getPopulationBalance.
function getPopulationBalance(state, config) {
  const reproduction = config.population && config.population.reproduction;
  const softCap = Number(reproduction && reproduction.softCap || 0);
  if (softCap <= 0) {
    return 1;
  }
  const ratio = 1 - Math.abs(state.dwarves.length - softCap) / softCap;
  return clamp(ratio, 0, 1);
}

// Function: buildScenarioConfig.
function buildScenarioConfig(base, options) {
  const aiConfig = base.ai || {};
  const training = aiConfig.training || {};
  const randomization = training.randomization || {};
  const trainingOverrides = isPlainObject(training.configOverrides)
    ? training.configOverrides
    : null;
  const evalOverrides = isPlainObject(training.evalOverrides)
    ? training.evalOverrides
    : null;
  const scenarios = Array.isArray(base.scenarios) ? base.scenarios : [];
  const trainingFlag = options.training !== undefined ? options.training : true;
  const evalFlag = options.eval === true;
  const enabled = trainingFlag !== false;
  // Every training and evaluation client sends its difficulty; without one the game plays at full difficulty.
  const difficulty = clamp(Number(options.difficulty ?? 1), 0, 1);
  const requestedScenario = typeof options.scenario === 'string' ? options.scenario : null;
  const scenarioDef = requestedScenario
    ? scenarios.find((entry) => entry && entry.name === requestedScenario) || null
    : null;
  const hasScenarioOverrides = Boolean(scenarioDef && scenarioDef.overrides);
  const hasTrainingOverrides = Boolean(
    enabled && trainingOverrides && Object.keys(trainingOverrides).length > 0,
  );
  const hasEvalOverrides = Boolean(
    evalFlag && evalOverrides && Object.keys(evalOverrides).length > 0,
  );
  const shouldClone = enabled || requestedScenario || hasScenarioOverrides || hasTrainingOverrides || hasEvalOverrides;
  const config = shouldClone ? cloneConfig(base) : base;

  if (!config.ai) {
    config.ai = {};
  }
  config.ai.difficulty = difficulty;

  if (hasTrainingOverrides) {
    mergeDeep(config, trainingOverrides);
  }

  if (hasEvalOverrides) {
    mergeDeep(config, evalOverrides);
  }

  if (hasScenarioOverrides) {
    mergeDeep(config, scenarioDef.overrides);
  }

  if (!enabled || options.randomize === false) {
    return {
      config,
      meta: {
        enabled: false,
        difficulty,
        name: requestedScenario,
        overridesApplied: hasScenarioOverrides,
        trainingOverridesApplied: hasTrainingOverrides,
        evalOverridesApplied: hasEvalOverrides,
        missing: Boolean(requestedScenario && !scenarioDef),
      },
      initialTick: null,
    };
  }

  const stockpileScale = scaleWithDifficulty(randomization.stockpileScale, difficulty, 1);
  const nodeCountScale = scaleWithDifficulty(randomization.nodeCountScale, difficulty, 1);
  const nodeCapacityScale = scaleWithDifficulty(randomization.nodeCapacityScale, difficulty, 1);
  const nodeRegenScale = scaleWithDifficulty(randomization.nodeRegenScale, difficulty, 1);
  const needDecayScale = scaleWithDifficulty(randomization.needDecayScale, difficulty, 1);

  applyStockpileScale(config, stockpileScale, randomization.stockpileFloor);
  applyNodeCountScale(config, nodeCountScale, randomization.nodeCountMin);
  applyNodeCapacityScale(config, nodeCapacityScale);
  applyNodeRegenScale(config, nodeRegenScale);
  applyNeedDecayScale(config, needDecayScale);

  const seasonInfo = getRandomSeasonStart(config, randomization);
  const initialTick = seasonInfo ? seasonInfo.initialTick : null;

  return {
    config,
    initialTick,
    meta: {
      enabled: true,
      difficulty,
      name: requestedScenario,
      overridesApplied: hasScenarioOverrides,
      trainingOverridesApplied: hasTrainingOverrides,
      evalOverridesApplied: hasEvalOverrides,
      missing: Boolean(requestedScenario && !scenarioDef),
      stockpileScale,
      nodeCountScale,
      nodeCapacityScale,
      nodeRegenScale,
      needDecayScale,
      season: seasonInfo ? seasonInfo.season : null,
    },
  };
}

// Function: cloneConfig.
function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

// Function: mergeDeep.
function mergeDeep(target, source) {
  if (!isPlainObject(source)) {
    return target;
  }
  const output = target && typeof target === 'object' ? target : {};

  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      output[key] = value.slice();
    } else if (isPlainObject(value)) {
      const baseValue = isPlainObject(output[key]) ? output[key] : {};
      output[key] = mergeDeep(baseValue, value);
    } else {
      output[key] = value;
    }
  }

  return output;
}

// Function: isPlainObject.
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Function: scaleWithDifficulty.
function scaleWithDifficulty(range, difficulty, fallback) {
  if (!range) {
    return fallback;
  }
  const parsed = parseRange(range, fallback);
  if (!parsed) {
    return fallback;
  }
  const target = randomBetween(parsed.min, parsed.max);
  return lerp(1, target, difficulty);
}

// Function: parseRange.
function parseRange(range, fallback) {
  const min = Number(range.min ?? range[0] ?? fallback);
  const max = Number(range.max ?? range[1] ?? min);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }
  return {
    min: Math.min(min, max),
    max: Math.max(min, max),
  };
}

// Function: lerp.
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Function: randomBetween.
function randomBetween(min, max) {
  const low = Number(min);
  const high = Number(max);
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    return low;
  }
  if (low === high) {
    return low;
  }
  return low + (high - low) * Math.random();
}

// Function: applyStockpileScale.
function applyStockpileScale(config, scale, floorMap = {}) {
  const resources = config.resources || {};
  const stockpile = resources.stockpile || {};
  for (const [resource, value] of Object.entries(stockpile)) {
    const base = Number(value || 0);
    const floor = Number(floorMap[resource] ?? 0);
    const scaled = Math.max(floor, Math.round(base * scale));
    stockpile[resource] = scaled;
  }
}

// Function: applyNodeCountScale.
function applyNodeCountScale(config, scale, minCount) {
  const resources = config.resources || {};
  const nodes = resources.nodes || {};
  const minMap = typeof minCount === 'object' && minCount ? minCount : null;
  const fallbackMin = Number(minMap ? 0 : minCount || 0);

  for (const [resource, count] of Object.entries(nodes)) {
    const base = Number(count || 0);
    const minValue = minMap ? Number(minMap[resource] ?? 0) : fallbackMin;
    const scaled = Math.max(minValue, Math.round(base * scale));
    nodes[resource] = scaled;
  }
}

// Function: applyNodeCapacityScale.
function applyNodeCapacityScale(config, scale) {
  const resources = config.resources || {};
  if (resources.defaultNodeCapacity !== undefined) {
    const base = Number(resources.defaultNodeCapacity || 0);
    resources.defaultNodeCapacity = Math.max(1, Math.round(base * scale));
  }
  const capacities = resources.nodeCapacity || {};
  for (const [resource, value] of Object.entries(capacities)) {
    const base = Number(value || 0);
    capacities[resource] = Math.max(1, Math.round(base * scale));
  }
}

// Function: applyNodeRegenScale.
function applyNodeRegenScale(config, scale) {
  const resources = config.resources || {};
  const regen = resources.nodeRegen || {};
  if (regen.enabled === false) {
    return;
  }
  if (regen.amount !== undefined) {
    const base = Number(regen.amount || 0);
    if (base > 0) {
      regen.amount = Math.max(1, Math.round(base * scale));
    }
  }
}

// Function: applyNeedDecayScale.
function applyNeedDecayScale(config, scale) {
  const needs = config.needs || {};
  const decay = needs.decayPerTick || {};
  for (const [need, value] of Object.entries(decay)) {
    decay[need] = Number(value || 0) * scale;
  }
}

// Function: getRandomSeasonStart.
function getRandomSeasonStart(config, randomization) {
  const seasons = config.seasons || {};
  if (seasons.enabled === false) {
    return null;
  }
  if (randomization.seasonStartRandom !== true) {
    return null;
  }
  const order = Array.isArray(seasons.order) && seasons.order.length > 0
    ? seasons.order
    : ['spring', 'summer', 'autumn', 'winter'];
  const duration = Math.max(1, Number(seasons.durationTicks || 200));
  const seasonIndex = Math.floor(Math.random() * order.length);
  const tickInSeason = randomization.seasonTickRandom
    ? Math.max(1, Math.floor(Math.random() * duration) + 1)
    : 1;
  const initialTick = (seasonIndex * duration + tickInSeason) - 1;

  return {
    initialTick,
    season: {
      name: order[seasonIndex],
      index: seasonIndex,
      tickInSeason,
      duration,
    },
  };
}

// Function: writeResponse.
function writeResponse(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
