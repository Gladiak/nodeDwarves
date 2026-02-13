'use strict';

const { clamp } = require('../utils');
const { pushEvent } = require('./events');

const SCHISM_PHASES = ['concord', 'murmurs', 'fracture', 'reckoning'];
const SCHISM_DOCTRINES = ['austerity', 'revelry'];
const DEFAULT_RITUAL_HISTORY_LIMIT = 12;

// Resolve schism config safely.
function getSchismConfig(config) {
  return (config && config.schism) || {};
}

// Build a normalized schism runtime state for a fresh run.
function createSchismState(config) {
  const schismConfig = getSchismConfig(config);
  if (schismConfig.enabled === false) {
    return null;
  }
  const pressure = clamp(Number(schismConfig.start_pressure ?? 0.2), 0, 1);
  const legitimacy = clamp(Number(schismConfig.start_legitimacy ?? 0.45), 0, 1);
  const doctrine = normalizeDoctrine(schismConfig.start_doctrine || 'austerity');

  return {
    enabled: true,
    pressure,
    legitimacy,
    doctrine,
    phase: resolveSchismPhase(pressure, schismConfig),
    modifiers: {},
    ritualWindow: {
      open: false,
      seasonIndex: null,
      closesAtTick: 0,
      announced: false,
      councilTriggered: false,
    },
    councilCooldownUntilTick: 0,
    lastDoctrineSwitchTick: 0,
    climax: {
      active: false,
      resolved: false,
      endsAtTick: 0,
      doctrine: doctrine,
    },
    ritual: {
      active: false,
      id: null,
      label: null,
      source: null,
      startedTick: 0,
      endsAtTick: 0,
      durationTicks: 0,
      seasonIndex: null,
      effects: {},
      festivalEffects: {},
      deltas: {
        pressure: 0,
        legitimacy: 0,
      },
    },
    ritualHistory: [],
    markers: {
      contractSuccesses: 0,
      contractFailures: 0,
      worldCompleted: 0,
      worldFailed: 0,
      worldExpired: 0,
      raidCount: 0,
      raidLastTick: 0,
      deepRaidsStarted: 0,
      deepRaidDeaths: 0,
    },
    stats: {
      doctrineShifts: 0,
      phaseShifts: 0,
      councilFestivals: 0,
      climaxes: 0,
    },
  };
}

// Ensure schism state exists and has all required fields.
function ensureSchismState(state, config) {
  const schismConfig = getSchismConfig(config);
  if (!state || schismConfig.enabled === false) {
    if (state) {
      state.schism = null;
    }
    return null;
  }
  if (!state.schism || typeof state.schism !== 'object') {
    state.schism = createSchismState(config);
  }
  if (!state.schism || typeof state.schism !== 'object') {
    return null;
  }

  const schism = state.schism;
  schism.enabled = true;
  schism.pressure = clamp(Number(schism.pressure ?? schismConfig.start_pressure ?? 0.2), 0, 1);
  schism.legitimacy = clamp(Number(schism.legitimacy ?? schismConfig.start_legitimacy ?? 0.45), 0, 1);
  schism.doctrine = normalizeDoctrine(schism.doctrine || schismConfig.start_doctrine || 'austerity');
  schism.phase = normalizePhase(schism.phase || resolveSchismPhase(schism.pressure, schismConfig));
  schism.modifiers = schism.modifiers && typeof schism.modifiers === 'object' ? schism.modifiers : {};
  schism.ritualWindow = normalizeRitualWindowState(schism.ritualWindow);
  schism.climax = normalizeClimaxState(schism.climax, schism.doctrine);
  schism.ritual = normalizeActiveRitualState(schism.ritual);
  if (!Array.isArray(schism.ritualHistory)) {
    schism.ritualHistory = [];
  }
  schism.lastDoctrineSwitchTick = Math.max(0, Number(schism.lastDoctrineSwitchTick || 0));
  schism.councilCooldownUntilTick = Math.max(0, Number(schism.councilCooldownUntilTick || 0));
  schism.markers = normalizeSchismMarkers(schism.markers);
  schism.stats = normalizeSchismStats(schism.stats);
  return schism;
}

// Tick schism pressure/legitimacy, doctrine shifts, and narrative phases.
function updateSchism(state, config) {
  const schismConfig = getSchismConfig(config);
  const schism = ensureSchismState(state, config);
  if (!schism) {
    return;
  }

  const tick = Math.max(0, Number(state.tick || 0));
  updateActiveRitualLifecycle(state, config, schism, schismConfig, tick);
  const season = state && state.season ? state.season : null;
  const seasonIndex = resolveSeasonIndex(state);
  const tickInSeason = Math.max(0, Number(season && season.tickInSeason || 0));
  const seasonName = season && season.name ? String(season.name) : null;

  updateRitualWindow(
    state,
    config,
    schism,
    schismConfig,
    tick,
    seasonIndex,
    seasonName,
    tickInSeason,
  );

  const metrics = collectCurrentSchismMetrics(state, config);
  const eventDeltas = consumeSchismEventDeltas(state, schism, schismConfig, metrics);

  const pressureConfig = resolvePressureConfig(schismConfig);
  const shortageRatio = pressureConfig.shortage_score_divisor > 0
    ? clamp(metrics.shortageScore / pressureConfig.shortage_score_divisor, 0, 1)
    : 0;
  const pressureDrift = schism.pressure < pressureConfig.target
    ? pressureConfig.drift_per_tick
    : (schism.pressure > pressureConfig.target ? -pressureConfig.drift_per_tick : 0);
  const pressureDelta =
    pressureDrift
    + shortageRatio * pressureConfig.shortage_weight
    + (1 - metrics.morale) * pressureConfig.low_morale_weight
    + (metrics.raidActive ? pressureConfig.raid_active_weight : 0)
    + (metrics.deepRaidActive ? pressureConfig.deep_raid_active_weight : 0)
    - (metrics.festivalActive ? pressureConfig.festival_relief_per_tick : 0)
    - Math.max(0, metrics.templeStage) * pressureConfig.temple_relief_per_stage_tick
    + eventDeltas.pressure;
  schism.pressure = clamp(schism.pressure + pressureDelta, 0, 1);

  const legitimacyConfig = resolveLegitimacyConfig(schismConfig);
  const legitimacyDelta =
    -legitimacyConfig.passive_decay_per_tick
    - schism.pressure * legitimacyConfig.pressure_decay_scale
    + (metrics.festivalActive ? legitimacyConfig.festival_gain_per_tick : 0)
    + Math.max(0, metrics.templeStage) * legitimacyConfig.temple_gain_per_stage_tick
    + eventDeltas.legitimacy;
  schism.legitimacy = clamp(schism.legitimacy + legitimacyDelta, 0, 1);

  const nextDoctrine = resolveNextDoctrine(
    state,
    config,
    schism,
    schismConfig,
    metrics,
    tick,
    seasonIndex,
  );
  if (nextDoctrine !== schism.doctrine) {
    schism.doctrine = nextDoctrine;
    schism.lastDoctrineSwitchTick = tick;
    schism.stats.doctrineShifts = Number(schism.stats.doctrineShifts || 0) + 1;
    pushEvent(state, config, buildDoctrineShiftMessage(nextDoctrine));
  }

  const nextPhase = resolveSchismPhase(schism.pressure, schismConfig);
  if (nextPhase !== schism.phase) {
    schism.phase = nextPhase;
    schism.stats.phaseShifts = Number(schism.stats.phaseShifts || 0) + 1;
    pushEvent(state, config, buildPhaseShiftMessage(nextPhase));
  }

  updateSchismClimax(state, config, schism, schismConfig, tick);
  schism.modifiers = resolveActiveModifierMap(schismConfig, schism);
}

// Return a multiplicative runtime modifier produced by the schism arc.
function getSchismModifier(state, key, fallback) {
  const base = Number(fallback);
  const fallbackValue = Number.isFinite(base) ? base : 1;
  const schism = state && state.schism && state.schism.enabled !== false
    ? state.schism
    : null;
  if (!schism || !key) {
    return fallbackValue;
  }
  const modifiers = schism.modifiers && typeof schism.modifiers === 'object'
    ? schism.modifiers
    : {};
  const value = Number(modifiers[key]);
  if (!Number.isFinite(value) || value <= 0) {
    return fallbackValue;
  }
  return value;
}

// Return a normalized fallback festival intent when ritual window is open.
function getSchismFestivalIntent(state, config) {
  const schism = state && state.schism && state.schism.enabled !== false ? state.schism : null;
  if (!schism) {
    return 0;
  }
  const schismConfig = getSchismConfig(config);
  const ritualConfig = resolveRitualWindowConfig(schismConfig);
  if (!ritualConfig.enabled) {
    return 0;
  }
  const ritualState = schism.ritualWindow || {};
  if (ritualState.open !== true || ritualState.councilTriggered === true) {
    return 0;
  }
  const tick = Math.max(0, Number(state.tick || 0));
  if (tick < Number(schism.councilCooldownUntilTick || 0)) {
    return 0;
  }
  if (schism.legitimacy < ritualConfig.min_legitimacy) {
    return 0;
  }
  if (schism.pressure > ritualConfig.max_pressure) {
    return 0;
  }
  const byDoctrine = ritualConfig.festival_intent_by_doctrine || {};
  const doctrineIntent = Number(byDoctrine[schism.doctrine]);
  const fallbackIntent = Number(ritualConfig.festival_intent_fallback);
  const intent = Number.isFinite(doctrineIntent) ? doctrineIntent : fallbackIntent;
  return clamp(intent, 0, 1);
}

// Return multiplicative festival cost scalar from current schism doctrine.
function getSchismFestivalCostMultiplier(state, config) {
  return getSchismDoctrineScalar(state, config, 'festival', 'cost_multiplier', 1);
}

// Return multiplicative festival effect scalar from current schism doctrine.
function getSchismFestivalEffectMultiplier(state, config) {
  return getSchismDoctrineScalar(state, config, 'festival', 'effect_multiplier', 1);
}

// Resolve one branching ritual plan for the upcoming festival trigger.
function resolveSchismFestivalRitualPlan(state, config, source, baseFestivalCosts = {}) {
  const schism = ensureSchismState(state, config);
  if (!schism) {
    return null;
  }
  const ritualConfig = resolveFestivalRitualConfig(getSchismConfig(config));
  if (!ritualConfig.enabled) {
    return null;
  }
  const sourceLabel = source ? String(source) : 'ai';
  if (!ritualConfig.allow_ai_source && sourceLabel !== 'council') {
    return null;
  }
  if (!(schism.ritualWindow && schism.ritualWindow.open === true)) {
    return null;
  }

  const metrics = collectCurrentSchismMetrics(state, config);
  const tick = Math.max(0, Number(state && state.tick || 0));
  const candidates = [];
  for (const definition of ritualConfig.definitions) {
    if (!definition || definition.enabled === false) {
      continue;
    }
    if (!passesRitualDefinitionGates(definition, state, config, schism, metrics)) {
      continue;
    }
    const doctrineWeight = Math.max(
      0,
      Number(definition.doctrineWeight[schism.doctrine] ?? definition.doctrineWeight.default ?? 1),
    );
    const contextWeight = Math.max(0, resolveRitualContextWeight(definition, schism, metrics));
    const repeatWeight = Math.max(
      0,
      resolveRitualRepeatWeight(definition.id, schism, ritualConfig.repeatProtection, tick),
    );
    const weight = Math.max(0, Number(definition.weight || 0))
      * doctrineWeight
      * contextWeight
      * repeatWeight;
    if (weight <= 0) {
      continue;
    }
    const combinedCosts = mergeCostMaps(baseFestivalCosts, definition.costs);
    if (!hasCostInputs(state && state.stockpile, combinedCosts)) {
      continue;
    }
    candidates.push({
      definition,
      weight,
      combinedCosts,
    });
  }

  const picked = pickWeightedRitual(candidates);
  if (!picked) {
    return null;
  }
  const durationTicks = resolveRitualDurationTicks(state, config, ritualConfig, picked.definition);
  return {
    id: picked.definition.id,
    label: picked.definition.label,
    source: sourceLabel,
    costs: picked.definition.costs,
    festivalEffects: picked.definition.festivalEffects,
    effects: picked.definition.effects,
    deltas: picked.definition.deltas,
    durationTicks,
  };
}

// Notify schism state that a festival has started and record council-driven triggers.
function notifySchismFestivalStarted(state, config, source, ritualPlan) {
  const schism = ensureSchismState(state, config);
  if (!schism) {
    return;
  }
  const sourceLabel = source ? String(source) : 'ai';
  const tick = Math.max(0, Number(state.tick || 0));
  if (sourceLabel === 'council') {
    schism.ritualWindow.councilTriggered = true;
    schism.councilCooldownUntilTick = tick + resolveRitualWindowConfig(getSchismConfig(config)).min_ticks_between_council_festivals;
    schism.stats.councilFestivals = Number(schism.stats.councilFestivals || 0) + 1;
    pushEvent(state, config, 'Council ritual: the Nine Braziers are lit');
  }
  if (ritualPlan && ritualPlan.id) {
    activateSchismRitual(state, config, schism, ritualPlan, sourceLabel, tick);
  }
}

// Return whether temple can progress through the legitimacy branch for a stage.
function canTempleAdvanceByLegitimacy(state, config, stageNumber) {
  const schismConfig = getSchismConfig(config);
  if (schismConfig.enabled === false) {
    return false;
  }
  const templeConfig = schismConfig.temple && typeof schismConfig.temple === 'object'
    ? schismConfig.temple
    : {};
  if (templeConfig.legitimacy_path_enabled === false) {
    return false;
  }
  const threshold = resolveTempleLegitimacyThreshold(templeConfig, stageNumber);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return false;
  }
  const legitimacy = getSchismLegitimacy(state);
  return legitimacy >= threshold;
}

// Return the active schism legitimacy value in [0, 1].
function getSchismLegitimacy(state) {
  const schism = state && state.schism && state.schism.enabled !== false ? state.schism : null;
  if (!schism) {
    return 0;
  }
  return clamp(Number(schism.legitimacy || 0), 0, 1);
}

// Return the active schism doctrine.
function getSchismDoctrine(state) {
  const schism = state && state.schism && state.schism.enabled !== false ? state.schism : null;
  if (!schism) {
    return null;
  }
  return normalizeDoctrine(schism.doctrine);
}

// Return compact schism status details for telemetry.
function getSchismStatus(state, config) {
  const schism = ensureSchismState(state, config);
  if (!schism) {
    return null;
  }
  const ritualWindow = schism.ritualWindow || {};
  const climax = schism.climax || {};
  const ritual = schism.ritual || {};
  const ticksLeft = ritual.active
    ? Math.max(0, Number(ritual.endsAtTick || 0) - Math.max(0, Number(state && state.tick || 0)))
    : 0;
  return {
    enabled: schism.enabled !== false,
    pressure: clamp(Number(schism.pressure || 0), 0, 1),
    legitimacy: clamp(Number(schism.legitimacy || 0), 0, 1),
    phase: normalizePhase(schism.phase),
    doctrine: normalizeDoctrine(schism.doctrine),
    ritualOpen: ritualWindow.open === true,
    ritualCouncilTriggered: ritualWindow.councilTriggered === true,
    ritualActive: ritual.active === true,
    ritualLabel: ritual.label ? String(ritual.label) : null,
    ritualSource: ritual.source ? String(ritual.source) : null,
    ritualTicksLeft: ticksLeft,
    climaxActive: climax.active === true,
  };
}

// Normalize doctrine values.
function normalizeDoctrine(rawDoctrine) {
  const value = String(rawDoctrine || 'austerity').toLowerCase();
  if (SCHISM_DOCTRINES.includes(value)) {
    return value;
  }
  return 'austerity';
}

// Normalize phase values.
function normalizePhase(rawPhase) {
  const value = String(rawPhase || 'concord').toLowerCase();
  if (SCHISM_PHASES.includes(value)) {
    return value;
  }
  return 'concord';
}

// Normalize ritual-window state object.
function normalizeRitualWindowState(rawState) {
  const ritual = rawState && typeof rawState === 'object' ? rawState : {};
  return {
    open: ritual.open === true,
    seasonIndex: Number.isFinite(Number(ritual.seasonIndex))
      ? Number(ritual.seasonIndex)
      : null,
    closesAtTick: Math.max(0, Number(ritual.closesAtTick || 0)),
    announced: ritual.announced === true,
    councilTriggered: ritual.councilTriggered === true,
  };
}

// Normalize climax runtime state object.
function normalizeClimaxState(rawState, doctrine) {
  const climax = rawState && typeof rawState === 'object' ? rawState : {};
  return {
    active: climax.active === true,
    resolved: climax.resolved === true,
    endsAtTick: Math.max(0, Number(climax.endsAtTick || 0)),
    doctrine: normalizeDoctrine(climax.doctrine || doctrine || 'austerity'),
  };
}

// Normalize active ritual runtime state.
function normalizeActiveRitualState(rawState) {
  const ritual = rawState && typeof rawState === 'object' ? rawState : {};
  return {
    active: ritual.active === true,
    id: ritual.id ? String(ritual.id) : null,
    label: ritual.label ? String(ritual.label) : null,
    source: ritual.source ? String(ritual.source) : null,
    startedTick: Math.max(0, Number(ritual.startedTick || 0)),
    endsAtTick: Math.max(0, Number(ritual.endsAtTick || 0)),
    durationTicks: Math.max(0, Number(ritual.durationTicks || 0)),
    seasonIndex: Number.isFinite(Number(ritual.seasonIndex))
      ? Number(ritual.seasonIndex)
      : null,
    effects: normalizePositiveMultiplierMap(ritual.effects),
    festivalEffects: normalizePositiveMultiplierMap(ritual.festivalEffects),
    deltas: {
      pressure: Number.isFinite(Number(ritual && ritual.deltas && ritual.deltas.pressure))
        ? Number(ritual.deltas.pressure)
        : 0,
      legitimacy: Number.isFinite(Number(ritual && ritual.deltas && ritual.deltas.legitimacy))
        ? Number(ritual.deltas.legitimacy)
        : 0,
    },
  };
}

// Normalize marker counters used to process one-shot events.
function normalizeSchismMarkers(rawMarkers) {
  const markers = rawMarkers && typeof rawMarkers === 'object' ? rawMarkers : {};
  return {
    contractSuccesses: Math.max(0, Number(markers.contractSuccesses || 0)),
    contractFailures: Math.max(0, Number(markers.contractFailures || 0)),
    worldCompleted: Math.max(0, Number(markers.worldCompleted || 0)),
    worldFailed: Math.max(0, Number(markers.worldFailed || 0)),
    worldExpired: Math.max(0, Number(markers.worldExpired || 0)),
    raidCount: Math.max(0, Number(markers.raidCount || 0)),
    raidLastTick: Math.max(0, Number(markers.raidLastTick || 0)),
    deepRaidsStarted: Math.max(0, Number(markers.deepRaidsStarted || 0)),
    deepRaidDeaths: Math.max(0, Number(markers.deepRaidDeaths || 0)),
  };
}

// Normalize stats counters.
function normalizeSchismStats(rawStats) {
  const stats = rawStats && typeof rawStats === 'object' ? rawStats : {};
  return {
    doctrineShifts: Math.max(0, Number(stats.doctrineShifts || 0)),
    phaseShifts: Math.max(0, Number(stats.phaseShifts || 0)),
    councilFestivals: Math.max(0, Number(stats.councilFestivals || 0)),
    climaxes: Math.max(0, Number(stats.climaxes || 0)),
  };
}

// Resolve normalized pressure configuration.
function resolvePressureConfig(schismConfig) {
  const pressure = schismConfig && schismConfig.pressure && typeof schismConfig.pressure === 'object'
    ? schismConfig.pressure
    : {};
  return {
    target: clamp(Number(pressure.target ?? 0.35), 0, 1),
    drift_per_tick: Math.max(0, Number(pressure.drift_per_tick ?? 0.0008)),
    shortage_score_divisor: Math.max(0.1, Number(pressure.shortage_score_divisor ?? 2.4)),
    shortage_weight: Math.max(0, Number(pressure.shortage_weight ?? 0.014)),
    low_morale_weight: Math.max(0, Number(pressure.low_morale_weight ?? 0.009)),
    raid_active_weight: Math.max(0, Number(pressure.raid_active_weight ?? 0.004)),
    deep_raid_active_weight: Math.max(0, Number(pressure.deep_raid_active_weight ?? 0.005)),
    festival_relief_per_tick: Math.max(0, Number(pressure.festival_relief_per_tick ?? 0.0025)),
    temple_relief_per_stage_tick: Math.max(0, Number(pressure.temple_relief_per_stage_tick ?? 0.0005)),
    raid_start_shock: Math.max(0, Number(pressure.raid_start_shock ?? 0.08)),
    world_failure_shock: Math.max(0, Number(pressure.world_failure_shock ?? 0.05)),
    contract_failure_shock: Math.max(0, Number(pressure.contract_failure_shock ?? 0.045)),
    deep_raid_start_shock: Math.max(0, Number(pressure.deep_raid_start_shock ?? 0.07)),
    raid_death_shock_per_dwarf: Math.max(0, Number(pressure.raid_death_shock_per_dwarf ?? 0.004)),
    deep_raid_death_shock_per_dwarf: Math.max(0, Number(pressure.deep_raid_death_shock_per_dwarf ?? 0.006)),
  };
}

// Resolve normalized legitimacy configuration.
function resolveLegitimacyConfig(schismConfig) {
  const legitimacy = schismConfig && schismConfig.legitimacy && typeof schismConfig.legitimacy === 'object'
    ? schismConfig.legitimacy
    : {};
  return {
    passive_decay_per_tick: Math.max(0, Number(legitimacy.passive_decay_per_tick ?? 0.00045)),
    pressure_decay_scale: Math.max(0, Number(legitimacy.pressure_decay_scale ?? 0.00035)),
    festival_gain_per_tick: Math.max(0, Number(legitimacy.festival_gain_per_tick ?? 0.0014)),
    temple_gain_per_stage_tick: Math.max(0, Number(legitimacy.temple_gain_per_stage_tick ?? 0.0004)),
    contract_success_gain: Math.max(0, Number(legitimacy.contract_success_gain ?? 0.03)),
    contract_failure_loss: Math.max(0, Number(legitimacy.contract_failure_loss ?? 0.045)),
    world_success_gain: Math.max(0, Number(legitimacy.world_success_gain ?? 0.018)),
    world_failure_loss: Math.max(0, Number(legitimacy.world_failure_loss ?? 0.026)),
    raid_death_loss_per_dwarf: Math.max(0, Number(legitimacy.raid_death_loss_per_dwarf ?? 0.01)),
    deep_raid_death_loss_per_dwarf: Math.max(0, Number(legitimacy.deep_raid_death_loss_per_dwarf ?? 0.014)),
  };
}

// Resolve normalized ritual-window config.
function resolveRitualWindowConfig(schismConfig) {
  const ritual = schismConfig && schismConfig.ritual_windows && typeof schismConfig.ritual_windows === 'object'
    ? schismConfig.ritual_windows
    : {};
  const seasonNames = Array.isArray(ritual.season_names)
    ? ritual.season_names.map((entry) => String(entry || '').trim()).filter(Boolean)
    : ['spring', 'autumn'];
  const byDoctrine = ritual.festival_intent_by_doctrine
    && typeof ritual.festival_intent_by_doctrine === 'object'
    ? ritual.festival_intent_by_doctrine
    : {};
  return {
    enabled: ritual.enabled !== false,
    season_names: seasonNames,
    window_ticks: Math.max(1, Math.floor(Number(ritual.window_ticks ?? 24))),
    min_legitimacy: clamp(Number(ritual.min_legitimacy ?? 0.22), 0, 1),
    max_pressure: clamp(Number(ritual.max_pressure ?? 0.92), 0, 1),
    festival_intent_fallback: clamp(Number(ritual.festival_intent_fallback ?? 0.8), 0, 1),
    festival_intent_by_doctrine: {
      austerity: clamp(Number(byDoctrine.austerity ?? 0.65), 0, 1),
      revelry: clamp(Number(byDoctrine.revelry ?? 0.9), 0, 1),
    },
    min_ticks_between_council_festivals: Math.max(
      0,
      Math.floor(Number(ritual.min_ticks_between_council_festivals ?? 120)),
    ),
    announce_at_open: ritual.announce_at_open !== false,
  };
}

// Resolve normalized branching ritual configuration.
function resolveFestivalRitualConfig(schismConfig) {
  const rituals = schismConfig && schismConfig.rituals && typeof schismConfig.rituals === 'object'
    ? schismConfig.rituals
    : {};
  const definitionsRaw = rituals.definitions && typeof rituals.definitions === 'object'
    ? rituals.definitions
    : {};
  const definitions = Object.entries(definitionsRaw)
    .map(([id, rawDef]) => normalizeFestivalRitualDefinition(id, rawDef))
    .filter((entry) => entry && entry.enabled !== false);

  return {
    enabled: rituals.enabled === true,
    duration_mode: String(rituals.duration_mode || 'season'),
    duration_ticks: Math.max(1, Math.floor(Number(rituals.duration_ticks || 1))),
    allow_ai_source: rituals.allow_ai_source !== false,
    repeatProtection: normalizeRepeatProtectionConfig(rituals.repeat_protection),
    history_limit: Math.max(
      0,
      Math.floor(Number(rituals.history_limit ?? DEFAULT_RITUAL_HISTORY_LIMIT)),
    ),
    definitions,
  };
}

// Normalize anti-repeat ritual protection config.
function normalizeRepeatProtectionConfig(rawRepeatProtection) {
  const repeat = rawRepeatProtection && typeof rawRepeatProtection === 'object'
    ? rawRepeatProtection
    : {};
  return {
    enabled: repeat.enabled !== false,
    recent_window: Math.max(1, Math.floor(Number(repeat.recent_window ?? 3))),
    same_ritual_weight_multiplier: clamp(
      Number(repeat.same_ritual_weight_multiplier ?? 0.45),
      0,
      1,
    ),
    cooldown_ticks: Math.max(0, Math.floor(Number(repeat.cooldown_ticks ?? 0))),
  };
}

// Normalize one festival ritual definition.
function normalizeFestivalRitualDefinition(id, rawDefinition) {
  const def = rawDefinition && typeof rawDefinition === 'object' ? rawDefinition : {};
  const doctrineWeight = def.doctrine_weight && typeof def.doctrine_weight === 'object'
    ? def.doctrine_weight
    : {};
  const context = def.context && typeof def.context === 'object' ? def.context : {};
  return {
    id: String(id || def.id || ''),
    enabled: def.enabled !== false,
    label: String(def.label || id || 'Rite'),
    weight: Math.max(0, Number(def.weight ?? 1)),
    doctrineWeight: {
      austerity: Math.max(0, Number(doctrineWeight.austerity ?? 1)),
      revelry: Math.max(0, Number(doctrineWeight.revelry ?? 1)),
      default: Math.max(0, Number(doctrineWeight.default ?? 1)),
    },
    costs: normalizePositiveAmountMap(def.costs),
    minStockpileRatios: normalizeRatioMap(def.min_stockpile_ratios),
    effects: normalizePositiveMultiplierMap(def.effects),
    festivalEffects: normalizePositiveMultiplierMap(def.festival_effects),
    deltas: {
      pressure: Number.isFinite(Number(def && def.deltas && def.deltas.pressure))
        ? Number(def.deltas.pressure)
        : 0,
      legitimacy: Number.isFinite(Number(def && def.deltas && def.deltas.legitimacy))
        ? Number(def.deltas.legitimacy)
        : 0,
    },
    gates: {
      raid_required: context.raid_required === true,
      no_raid_required: context.no_raid_required === true,
      deep_raid_required: context.deep_raid_required === true,
      pressure_min: clamp(Number(context.pressure_min ?? 0), 0, 1),
      pressure_max: clamp(Number(context.pressure_max ?? 1), 0, 1),
      legitimacy_min: clamp(Number(context.legitimacy_min ?? 0), 0, 1),
      legitimacy_max: clamp(Number(context.legitimacy_max ?? 1), 0, 1),
      stock_floor_min: clamp(Number(context.stock_floor_min ?? 0), 0, 1),
      stock_floor_max: clamp(Number(context.stock_floor_max ?? 1), 0, 1),
      shortage_min: Math.max(0, Number(context.shortage_min ?? 0)),
      shortage_max: Math.max(0, Number(context.shortage_max ?? Number.POSITIVE_INFINITY)),
    },
    contextWeight: {
      pressure_scale: Math.max(0, Number(context.pressure_scale ?? 0)),
      legitimacy_scale: Math.max(0, Number(context.legitimacy_scale ?? 0)),
      shortage_scale: Math.max(0, Number(context.shortage_scale ?? 0)),
      raid_bonus: Math.max(0, Number(context.raid_bonus ?? 0)),
      deep_raid_bonus: Math.max(0, Number(context.deep_raid_bonus ?? 0)),
      stock_floor_bonus: Math.max(0, Number(context.stock_floor_bonus ?? 0)),
    },
    durationTicks: Math.max(0, Math.floor(Number(def.duration_ticks || 0))),
  };
}

// Compute anti-repeat weight for one ritual candidate using recent ritual history.
function resolveRitualRepeatWeight(ritualId, schism, repeatProtection, tick) {
  if (!ritualId || !repeatProtection || repeatProtection.enabled === false) {
    return 1;
  }
  const recentWindow = Math.max(1, Math.floor(Number(repeatProtection.recent_window || 3)));
  const cooldownTicks = Math.max(0, Math.floor(Number(repeatProtection.cooldown_ticks || 0)));
  const repeatMultiplier = clamp(
    Number(repeatProtection.same_ritual_weight_multiplier ?? 0.45),
    0,
    1,
  );
  const history = schism && Array.isArray(schism.ritualHistory) ? schism.ritualHistory : [];
  const safeTick = Math.max(0, Number(tick || 0));

  let lastMatchTick = null;
  let repeatCount = 0;
  let scanned = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (!entry || !entry.id) {
      continue;
    }
    scanned += 1;
    if (entry.id === ritualId) {
      repeatCount += 1;
      if (lastMatchTick === null) {
        const endedTick = Number(entry.endedTick);
        const startedTick = Number(entry.startedTick);
        if (Number.isFinite(endedTick)) {
          lastMatchTick = Math.max(0, Math.floor(endedTick));
        } else if (Number.isFinite(startedTick)) {
          lastMatchTick = Math.max(0, Math.floor(startedTick));
        }
      }
    }
    if (scanned >= recentWindow) {
      break;
    }
  }

  if (schism && schism.ritual && schism.ritual.active === true && schism.ritual.id === ritualId) {
    repeatCount += 1;
    const startedTick = Number(schism.ritual.startedTick);
    if (lastMatchTick === null && Number.isFinite(startedTick)) {
      lastMatchTick = Math.max(0, Math.floor(startedTick));
    }
  }

  if (
    cooldownTicks > 0
    && lastMatchTick !== null
    && safeTick - lastMatchTick < cooldownTicks
  ) {
    return 0;
  }
  if (repeatCount <= 0) {
    return 1;
  }
  if (repeatMultiplier <= 0) {
    return 0;
  }
  return Math.pow(repeatMultiplier, repeatCount);
}

// Validate ritual hard gates and stock-ratio preconditions.
function passesRitualDefinitionGates(definition, state, config, schism, metrics) {
  const gates = definition.gates || {};
  if (gates.raid_required && !metrics.raidActive) {
    return false;
  }
  if (gates.no_raid_required && metrics.raidActive) {
    return false;
  }
  if (gates.deep_raid_required && !metrics.deepRaidActive) {
    return false;
  }
  if (schism.pressure < gates.pressure_min || schism.pressure > gates.pressure_max) {
    return false;
  }
  if (schism.legitimacy < gates.legitimacy_min || schism.legitimacy > gates.legitimacy_max) {
    return false;
  }
  if (metrics.coreStockFloor < gates.stock_floor_min || metrics.coreStockFloor > gates.stock_floor_max) {
    return false;
  }
  if (metrics.shortageScore < gates.shortage_min || metrics.shortageScore > gates.shortage_max) {
    return false;
  }
  return passesStockpileRatioMap(state, config, definition.minStockpileRatios);
}

// Resolve contextual weight multiplier for one ritual candidate.
function resolveRitualContextWeight(definition, schism, metrics) {
  const context = definition.contextWeight || {};
  const pressureWeight = 1 + schism.pressure * context.pressure_scale;
  const legitimacyWeight = 1 + (1 - schism.legitimacy) * context.legitimacy_scale;
  const shortageWeight = 1 + Math.min(1, metrics.shortageScore / 3) * context.shortage_scale;
  const raidWeight = metrics.raidActive ? 1 + context.raid_bonus : 1;
  const deepRaidWeight = metrics.deepRaidActive ? 1 + context.deep_raid_bonus : 1;
  const stockWeight = metrics.coreStockFloor < 0.75 ? 1 + context.stock_floor_bonus : 1;
  return pressureWeight * legitimacyWeight * shortageWeight * raidWeight * deepRaidWeight * stockWeight;
}

// Resolve ritual duration from definition/config/season.
function resolveRitualDurationTicks(state, config, ritualConfig, definition) {
  const explicit = Math.max(0, Number(definition.durationTicks || 0));
  if (explicit > 0) {
    return Math.max(1, Math.floor(explicit));
  }
  const mode = String(ritualConfig.duration_mode || 'season').toLowerCase();
  if (mode === 'season') {
    const seasons = config && config.seasons ? config.seasons : {};
    return Math.max(1, Math.floor(Number(seasons.durationTicks || 200)));
  }
  return Math.max(1, Math.floor(Number(ritualConfig.duration_ticks || 1)));
}

// Pick one ritual candidate from weighted list.
function pickWeightedRitual(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }
  const total = candidates.reduce((sum, entry) => sum + Math.max(0, Number(entry.weight || 0)), 0);
  if (total <= 0) {
    return candidates[0];
  }
  let roll = Math.random() * total;
  for (const entry of candidates) {
    roll -= Math.max(0, Number(entry.weight || 0));
    if (roll <= 0) {
      return entry;
    }
  }
  return candidates[candidates.length - 1];
}

// Resolve phase from pressure thresholds.
function resolveSchismPhase(pressureValue, schismConfig) {
  const thresholds = schismConfig && schismConfig.phase_thresholds && typeof schismConfig.phase_thresholds === 'object'
    ? schismConfig.phase_thresholds
    : {};
  const pressure = clamp(Number(pressureValue || 0), 0, 1);
  const murmurs = clamp(Number(thresholds.murmurs ?? 0.35), 0, 1);
  const fracture = clamp(Number(thresholds.fracture ?? 0.58), murmurs, 1);
  const reckoning = clamp(Number(thresholds.reckoning ?? 0.78), fracture, 1);
  if (pressure >= reckoning) {
    return 'reckoning';
  }
  if (pressure >= fracture) {
    return 'fracture';
  }
  if (pressure >= murmurs) {
    return 'murmurs';
  }
  return 'concord';
}

// Update ritual-window lifecycle at season boundaries.
function updateRitualWindow(state, config, schism, schismConfig, tick, seasonIndex, seasonName, tickInSeason) {
  const ritualConfig = resolveRitualWindowConfig(schismConfig);
  if (!ritualConfig.enabled) {
    schism.ritualWindow.open = false;
    return;
  }
  const ritual = schism.ritualWindow;
  const seasonChanged = ritual.seasonIndex !== seasonIndex;
  if (seasonChanged) {
    ritual.seasonIndex = seasonIndex;
    ritual.open = false;
    ritual.closesAtTick = 0;
    ritual.announced = false;
    ritual.councilTriggered = false;
  }
  if (!seasonName || !ritualConfig.season_names.includes(seasonName)) {
    ritual.open = false;
    return;
  }
  if (tickInSeason <= 0 || tickInSeason > ritualConfig.window_ticks) {
    ritual.open = false;
    return;
  }
  ritual.open = true;
  ritual.closesAtTick = tick + Math.max(0, ritualConfig.window_ticks - tickInSeason);
  if (!ritual.announced && ritualConfig.announce_at_open) {
    ritual.announced = true;
    pushEvent(state, config, `Ritual window opened: ${seasonName} council rites`);
  }
}

// Tick active ritual lifecycle and expire timed effects.
function updateActiveRitualLifecycle(state, config, schism, schismConfig, tick) {
  const ritual = schism && schism.ritual ? schism.ritual : null;
  if (!ritual || ritual.active !== true) {
    return;
  }
  if (tick < Number(ritual.endsAtTick || 0)) {
    return;
  }
  const ritualConfig = resolveFestivalRitualConfig(schismConfig);
  pushEvent(state, config, `Ritual faded: ${ritual.label || ritual.id || 'Council Rite'}`);
  schism.ritualHistory.push({
    id: ritual.id || null,
    label: ritual.label || null,
    source: ritual.source || null,
    startedTick: Number(ritual.startedTick || 0),
    endedTick: tick,
  });
  trimRitualHistory(schism, ritualConfig.history_limit);
  schism.ritual = normalizeActiveRitualState(null);
}

// Activate a selected ritual and apply immediate pressure/legitimacy deltas.
function activateSchismRitual(state, config, schism, ritualPlan, sourceLabel, tick) {
  const ritual = normalizeActiveRitualState({
    active: true,
    id: ritualPlan.id,
    label: ritualPlan.label,
    source: sourceLabel,
    startedTick: tick,
    endsAtTick: tick + Math.max(1, Math.floor(Number(ritualPlan.durationTicks || 1))),
    durationTicks: Math.max(1, Math.floor(Number(ritualPlan.durationTicks || 1))),
    seasonIndex: resolveSeasonIndex(state),
    effects: ritualPlan.effects,
    festivalEffects: ritualPlan.festivalEffects,
    deltas: ritualPlan.deltas,
  });
  schism.ritual = ritual;

  const deltaPressure = Number(ritual.deltas && ritual.deltas.pressure || 0);
  const deltaLegitimacy = Number(ritual.deltas && ritual.deltas.legitimacy || 0);
  if (deltaPressure !== 0) {
    schism.pressure = clamp(schism.pressure + deltaPressure, 0, 1);
  }
  if (deltaLegitimacy !== 0) {
    schism.legitimacy = clamp(schism.legitimacy + deltaLegitimacy, 0, 1);
  }

  pushEvent(
    state,
    config,
    `Ritual invoked: ${ritual.label || ritual.id || 'Council Rite'} (${ritual.durationTicks} ticks)`,
  );
}

// Collect common runtime metrics used by the schism model.
function collectCurrentSchismMetrics(state, config) {
  const dwarves = Array.isArray(state && state.dwarves) ? state.dwarves : [];
  const morale = getAverageDwarfMetric(dwarves, (dwarf) => dwarf && dwarf.state ? dwarf.state.morale : 0, 0.5);
  const shortageScore = Math.max(
    0,
    Number(state
      && Array.isArray(state.lastPriorities)
      && state.lastPriorities[0]
      ? state.lastPriorities[0].score
      : 0),
  );
  const festivalActive = Boolean(state && state.festival && state.festival.active);
  const raidActive = Boolean(state && state.raid && state.raid.active);
  const deepRaidActive = hasActiveDeepRaid(state);
  const templeStage = Math.max(0, Math.floor(Number(state && state.temple && state.temple.stage || 0)));
  const coreStockFloor = getCoreStockFloorRatio(state, config);
  const beerRatio = getResourceRatio(state, config, 'beer');

  return {
    morale,
    shortageScore,
    festivalActive,
    raidActive,
    deepRaidActive,
    templeStage,
    coreStockFloor,
    beerRatio,
  };
}

// Consume one-shot lifecycle deltas from contracts/world/raids/deep raids.
function consumeSchismEventDeltas(state, schism, schismConfig, metrics) {
  const pressureConfig = resolvePressureConfig(schismConfig);
  const legitimacyConfig = resolveLegitimacyConfig(schismConfig);
  const nextMarkers = collectSchismMarkers(state);
  const previous = schism.markers || normalizeSchismMarkers(null);
  let pressureDelta = 0;
  let legitimacyDelta = 0;

  const contractSuccessDelta = Math.max(0, nextMarkers.contractSuccesses - previous.contractSuccesses);
  if (contractSuccessDelta > 0) {
    legitimacyDelta += contractSuccessDelta * legitimacyConfig.contract_success_gain;
  }
  const contractFailureDelta = Math.max(0, nextMarkers.contractFailures - previous.contractFailures);
  if (contractFailureDelta > 0) {
    legitimacyDelta -= contractFailureDelta * legitimacyConfig.contract_failure_loss;
    pressureDelta += contractFailureDelta * pressureConfig.contract_failure_shock;
  }

  const worldSuccessDelta = Math.max(0, nextMarkers.worldCompleted - previous.worldCompleted);
  if (worldSuccessDelta > 0) {
    legitimacyDelta += worldSuccessDelta * legitimacyConfig.world_success_gain;
  }
  const worldFailureDelta =
    Math.max(0, nextMarkers.worldFailed - previous.worldFailed)
    + Math.max(0, nextMarkers.worldExpired - previous.worldExpired);
  if (worldFailureDelta > 0) {
    legitimacyDelta -= worldFailureDelta * legitimacyConfig.world_failure_loss;
    pressureDelta += worldFailureDelta * pressureConfig.world_failure_shock;
  }

  const raidCountDelta = Math.max(0, nextMarkers.raidCount - previous.raidCount);
  if (raidCountDelta > 0) {
    pressureDelta += raidCountDelta * pressureConfig.raid_start_shock;
  }

  const raidDeaths = resolveLatestRaidDeaths(state, nextMarkers.raidLastTick, previous.raidLastTick);
  if (raidDeaths > 0) {
    legitimacyDelta -= raidDeaths * legitimacyConfig.raid_death_loss_per_dwarf;
    pressureDelta += raidDeaths * pressureConfig.raid_death_shock_per_dwarf;
  }

  const deepRaidStartDelta = Math.max(0, nextMarkers.deepRaidsStarted - previous.deepRaidsStarted);
  if (deepRaidStartDelta > 0) {
    pressureDelta += deepRaidStartDelta * pressureConfig.deep_raid_start_shock;
  }
  const deepRaidDeathDelta = Math.max(0, nextMarkers.deepRaidDeaths - previous.deepRaidDeaths);
  if (deepRaidDeathDelta > 0) {
    legitimacyDelta -= deepRaidDeathDelta * legitimacyConfig.deep_raid_death_loss_per_dwarf;
    pressureDelta += deepRaidDeathDelta * pressureConfig.deep_raid_death_shock_per_dwarf;
  }

  schism.markers = nextMarkers;
  if (metrics && metrics.coreStockFloor > 0.95 && metrics.morale > 0.7) {
    legitimacyDelta += 0.0008;
  }

  return {
    pressure: pressureDelta,
    legitimacy: legitimacyDelta,
  };
}

// Resolve doctrine hysteresis thresholds with compatibility fallbacks.
function resolveDoctrineHysteresisConfig(doctrineConfig) {
  const austerityEnterStockFloor = clamp(
    Number(doctrineConfig.austerity_enter_stock_floor ?? doctrineConfig.austerity_stock_floor ?? 0.72),
    0,
    1,
  );
  const austerityExitStockFloor = clamp(
    Number(doctrineConfig.austerity_exit_stock_floor ?? (austerityEnterStockFloor + 0.08)),
    austerityEnterStockFloor,
    1,
  );
  const austerityEnterShortage = Math.max(
    0,
    Number(doctrineConfig.austerity_enter_shortage_score ?? doctrineConfig.austerity_shortage_score ?? 2.1),
  );
  const austerityExitShortage = Math.max(
    0,
    Math.min(
      austerityEnterShortage,
      Number(doctrineConfig.austerity_exit_shortage_score ?? (austerityEnterShortage * 0.72)),
    ),
  );
  const austerityEnterLegitimacyFloor = clamp(
    Number(doctrineConfig.austerity_enter_legitimacy_floor ?? doctrineConfig.austerity_legitimacy_floor ?? 0.28),
    0,
    1,
  );
  const austerityExitLegitimacyFloor = clamp(
    Number(doctrineConfig.austerity_exit_legitimacy_floor ?? (austerityEnterLegitimacyFloor + 0.12)),
    austerityEnterLegitimacyFloor,
    1,
  );

  const revelryEnterMoraleFloor = clamp(
    Number(doctrineConfig.revelry_enter_morale_floor ?? doctrineConfig.revelry_morale_floor ?? 0.52),
    0,
    1,
  );
  const revelryExitMoraleFloor = clamp(
    Number(doctrineConfig.revelry_exit_morale_floor ?? (revelryEnterMoraleFloor + 0.08)),
    revelryEnterMoraleFloor,
    1,
  );
  const revelryEnterBeerRatioMin = clamp(
    Number(doctrineConfig.revelry_enter_beer_ratio_min ?? doctrineConfig.revelry_beer_ratio_min ?? 0.55),
    0,
    1,
  );
  const revelryExitBeerRatioMin = clamp(
    Number(doctrineConfig.revelry_exit_beer_ratio_min ?? (revelryEnterBeerRatioMin * 0.85)),
    0,
    revelryEnterBeerRatioMin,
  );
  const revelryEnterPressureThreshold = clamp(
    Number(doctrineConfig.revelry_enter_pressure_threshold ?? doctrineConfig.revelry_pressure_threshold ?? 0.63),
    0,
    1,
  );
  const revelryExitPressureThreshold = clamp(
    Number(doctrineConfig.revelry_exit_pressure_threshold ?? (revelryEnterPressureThreshold - 0.08)),
    0,
    revelryEnterPressureThreshold,
  );
  const revelryEnterStockFloorMin = clamp(
    Number(doctrineConfig.revelry_enter_stock_floor_min ?? doctrineConfig.revelry_stock_floor_min ?? 0.55),
    0,
    1,
  );
  const revelryExitStockFloorMin = clamp(
    Number(doctrineConfig.revelry_exit_stock_floor_min ?? (revelryEnterStockFloorMin * 0.9)),
    0,
    revelryEnterStockFloorMin,
  );

  return {
    austerity: {
      enter: {
        stockFloor: austerityEnterStockFloor,
        shortage: austerityEnterShortage,
        legitimacy: austerityEnterLegitimacyFloor,
      },
      exit: {
        stockFloor: austerityExitStockFloor,
        shortage: austerityExitShortage,
        legitimacy: austerityExitLegitimacyFloor,
      },
    },
    revelry: {
      enter: {
        morale: revelryEnterMoraleFloor,
        beer: revelryEnterBeerRatioMin,
        pressure: revelryEnterPressureThreshold,
        stockFloor: revelryEnterStockFloorMin,
      },
      exit: {
        morale: revelryExitMoraleFloor,
        beer: revelryExitBeerRatioMin,
        pressure: revelryExitPressureThreshold,
        stockFloor: revelryExitStockFloorMin,
      },
    },
  };
}

// Resolve next doctrine with seasonal/cooldown guardrails and hysteresis.
function resolveNextDoctrine(state, config, schism, schismConfig, metrics, tick, seasonIndex) {
  const doctrineConfig = schismConfig && schismConfig.doctrine && typeof schismConfig.doctrine === 'object'
    ? schismConfig.doctrine
    : {};
  const current = normalizeDoctrine(schism.doctrine);
  const cooldown = Math.max(0, Math.floor(Number(doctrineConfig.switch_cooldown_ticks ?? 100)));
  const seasonGate = doctrineConfig.switch_only_on_new_season !== false;
  const lastSwitch = Math.max(0, Number(schism.lastDoctrineSwitchTick || 0));
  if (tick - lastSwitch < cooldown) {
    return current;
  }
  if (seasonGate && schism.ritualWindow && schism.ritualWindow.seasonIndex === seasonIndex) {
    const tickInSeason = Math.max(0, Number(state && state.season ? state.season.tickInSeason : 0));
    if (tickInSeason > 1) {
      return current;
    }
  }

  const thresholds = resolveDoctrineHysteresisConfig(doctrineConfig);
  const austerityEnter = thresholds.austerity.enter;
  const austerityExit = thresholds.austerity.exit;
  const revelryEnter = thresholds.revelry.enter;
  const revelryExit = thresholds.revelry.exit;

  const shouldEnterAusterity =
    metrics.coreStockFloor <= austerityEnter.stockFloor
    || metrics.shortageScore >= austerityEnter.shortage
    || schism.legitimacy <= austerityEnter.legitimacy;
  if (shouldEnterAusterity) {
    return 'austerity';
  }

  const revelryNeedsEnter =
    metrics.morale <= revelryEnter.morale
    && metrics.beerRatio >= revelryEnter.beer;
  const revelryPressureEnter =
    schism.pressure >= revelryEnter.pressure
    && metrics.coreStockFloor >= revelryEnter.stockFloor;
  const shouldEnterRevelry = revelryNeedsEnter || revelryPressureEnter;

  if (current === 'austerity') {
    const recoveredFromAusterity =
      metrics.coreStockFloor >= austerityExit.stockFloor
      && metrics.shortageScore <= austerityExit.shortage
      && schism.legitimacy >= austerityExit.legitimacy;
    if (!recoveredFromAusterity) {
      return 'austerity';
    }
    return shouldEnterRevelry ? 'revelry' : 'austerity';
  }

  if (current === 'revelry') {
    const revelrySustainNeeds =
      metrics.morale <= revelryExit.morale
      && metrics.beerRatio >= revelryExit.beer;
    const revelrySustainPressure =
      schism.pressure >= revelryExit.pressure
      && metrics.coreStockFloor >= revelryExit.stockFloor;
    if (revelrySustainNeeds || revelrySustainPressure) {
      return 'revelry';
    }
  }

  if (shouldEnterRevelry) {
    return 'revelry';
  }

  return current;
}

// Resolve a combined modifier map from phase + doctrine + active climax.
function resolveActiveModifierMap(schismConfig, schism) {
  const out = {};
  const modifiers = schismConfig && schismConfig.modifiers && typeof schismConfig.modifiers === 'object'
    ? schismConfig.modifiers
    : {};
  const phaseMap = modifiers.phase && typeof modifiers.phase === 'object'
    ? modifiers.phase[schism.phase] || {}
    : {};
  const doctrineMap = modifiers.doctrine && typeof modifiers.doctrine === 'object'
    ? modifiers.doctrine[schism.doctrine] || {}
    : {};
  const ritualMap = schism.ritual && schism.ritual.active === true
    ? (schism.ritual.effects || {})
    : {};
  const climaxMap = schism.climax && schism.climax.active === true
    ? (modifiers.climax && typeof modifiers.climax === 'object' ? modifiers.climax : {})
    : {};
  mergeMultiplierMap(out, phaseMap);
  mergeMultiplierMap(out, doctrineMap);
  mergeMultiplierMap(out, ritualMap);
  mergeMultiplierMap(out, climaxMap);
  return out;
}

// Update climactic schism crisis lifecycle.
function updateSchismClimax(state, config, schism, schismConfig, tick) {
  const climaxConfig = schismConfig && schismConfig.climax && typeof schismConfig.climax === 'object'
    ? schismConfig.climax
    : {};
  if (climaxConfig.enabled === false) {
    schism.climax.active = false;
    return;
  }
  const triggerPressure = clamp(Number(climaxConfig.trigger_pressure ?? 0.84), 0, 1);
  const triggerLegitimacy = clamp(Number(climaxConfig.trigger_legitimacy ?? 0.38), 0, 1);
  const allowMultiple = climaxConfig.allow_multiple === true;
  const duration = Math.max(1, Math.floor(Number(climaxConfig.duration_ticks ?? 90)));
  const pressureDrop = clamp(Number(climaxConfig.resolution_pressure_drop ?? 0.22), 0, 1);
  const legitimacyGain = clamp(Number(climaxConfig.resolution_legitimacy_gain ?? 0.09), 0, 1);

  if (!schism.climax.active) {
    if (schism.climax.resolved && !allowMultiple) {
      return;
    }
    if (schism.pressure >= triggerPressure && schism.legitimacy <= triggerLegitimacy) {
      schism.climax.active = true;
      schism.climax.resolved = false;
      schism.climax.doctrine = schism.doctrine;
      schism.climax.endsAtTick = tick + duration;
      schism.stats.climaxes = Number(schism.stats.climaxes || 0) + 1;
      pushEvent(state, config, 'Schism climax: the halls split under the Nine Braziers');
    }
    return;
  }

  if (tick < Number(schism.climax.endsAtTick || 0)) {
    return;
  }

  schism.climax.active = false;
  schism.climax.resolved = true;
  schism.pressure = clamp(schism.pressure - pressureDrop, 0, 1);
  schism.legitimacy = clamp(schism.legitimacy + legitimacyGain, 0, 1);
  pushEvent(state, config, buildClimaxResolutionMessage(schism.climax.doctrine));
}

// Collect current marker counters from state.
function collectSchismMarkers(state) {
  const contractsStats = state && state.contracts && state.contracts.stats ? state.contracts.stats : {};
  const worldStats = state && state.worldEvents && state.worldEvents.stats ? state.worldEvents.stats : {};
  const raidStats = state && state.raidStats ? state.raidStats : {};
  const deepStats = state
    && state.underrealm
    && state.underrealm.deepFaction
    && state.underrealm.deepFaction.stats
    ? state.underrealm.deepFaction.stats
    : {};
  const deathsByCause = state && state.deathsByCause ? state.deathsByCause : {};
  return {
    contractSuccesses: Math.max(0, Number(contractsStats.successes || 0)),
    contractFailures: Math.max(0, Number(contractsStats.failures || 0)),
    worldCompleted: Math.max(0, Number(worldStats.completed || 0)),
    worldFailed: Math.max(0, Number(worldStats.failed || 0)),
    worldExpired: Math.max(0, Number(worldStats.expired || 0)),
    raidCount: Math.max(0, Number(raidStats.count || 0)),
    raidLastTick: Math.max(0, Number(raidStats.lastRaidTick || 0)),
    deepRaidsStarted: Math.max(0, Number(deepStats.raidsStarted || 0)),
    deepRaidDeaths: Math.max(0, Number(deathsByCause.deepRaid || 0)),
  };
}

// Resolve raid-death contribution only once per completed raid.
function resolveLatestRaidDeaths(state, nextRaidTick, previousRaidTick) {
  if (nextRaidTick <= 0 || nextRaidTick <= previousRaidTick) {
    return 0;
  }
  const raidStats = state && state.raidStats ? state.raidStats : {};
  return Math.max(0, Number(raidStats.lastRaidDeaths || 0));
}

// Compute seasonal index from current state payload.
function resolveSeasonIndex(state) {
  const season = state && state.season ? state.season : null;
  if (!season) {
    return 0;
  }
  const globalIndex = Number(season.globalIndex);
  if (Number.isFinite(globalIndex)) {
    return globalIndex;
  }
  const index = Number(season.index);
  return Number.isFinite(index) ? index : 0;
}

// Compute average dwarf metric with fallback when population is empty.
function getAverageDwarfMetric(dwarves, selector, fallback) {
  if (!Array.isArray(dwarves) || dwarves.length === 0) {
    return clamp(Number(fallback || 0), 0, 1);
  }
  let total = 0;
  let count = 0;
  for (const dwarf of dwarves) {
    const value = Number(selector(dwarf));
    if (!Number.isFinite(value)) {
      continue;
    }
    total += value;
    count += 1;
  }
  if (count <= 0) {
    return clamp(Number(fallback || 0), 0, 1);
  }
  return clamp(total / count, 0, 1);
}

// Check if at least one deep hostile raid is currently active.
function hasActiveDeepRaid(state) {
  const raidsByDepth = state
    && state.underrealm
    && state.underrealm.deepFaction
    && state.underrealm.deepFaction.activeRaidsByDepth;
  if (!raidsByDepth || typeof raidsByDepth !== 'object') {
    return false;
  }
  return Object.values(raidsByDepth).some(
    (raid) => raid && Number(raid.ticksRemaining || 0) > 0,
  );
}

// Compute stockpile ratio for one resource without importing resources.js.
function getResourceRatio(state, config, resourceId) {
  const resources = (config && config.resources) || {};
  const targets = (state && state.resourceTargets)
    || resources.targets
    || resources.stockpile
    || {};
  const baseTarget = Math.max(0, Number(targets[resourceId] || 0));
  const perCapita = Math.max(0, Number((resources.targetsPerCapita || {})[resourceId] || 0));
  const population = Array.isArray(state && state.dwarves) ? state.dwarves.length : 0;
  const target = baseTarget + perCapita * population;
  if (target <= 0) {
    return 1;
  }
  const current = Math.max(0, Number(state && state.stockpile && state.stockpile[resourceId] || 0));
  return clamp(current / target, 0, 1);
}

// Check stockpile ratio gates against configured targets.
function passesStockpileRatioMap(state, config, ratioMap) {
  if (!ratioMap || typeof ratioMap !== 'object') {
    return true;
  }
  for (const [resourceId, ratioRaw] of Object.entries(ratioMap)) {
    const threshold = clamp(Number(ratioRaw || 0), 0, 1);
    if (threshold <= 0) {
      continue;
    }
    const ratio = getResourceRatio(state, config, resourceId);
    if (ratio < threshold) {
      return false;
    }
  }
  return true;
}

// Normalize positive multiplier map entries.
function normalizePositiveMultiplierMap(rawMap) {
  const normalized = {};
  if (!rawMap || typeof rawMap !== 'object') {
    return normalized;
  }
  for (const [key, valueRaw] of Object.entries(rawMap)) {
    const value = Number(valueRaw);
    if (!Number.isFinite(value) || value <= 0) {
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
}

// Normalize positive integer amount map.
function normalizePositiveAmountMap(rawMap) {
  const normalized = {};
  if (!rawMap || typeof rawMap !== 'object') {
    return normalized;
  }
  for (const [resource, amountRaw] of Object.entries(rawMap)) {
    const amount = Number(amountRaw || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }
    normalized[resource] = Math.max(1, Math.round(amount));
  }
  return normalized;
}

// Normalize ratio map values to [0, 1].
function normalizeRatioMap(rawMap) {
  const normalized = {};
  if (!rawMap || typeof rawMap !== 'object') {
    return normalized;
  }
  for (const [key, valueRaw] of Object.entries(rawMap)) {
    const value = clamp(Number(valueRaw || 0), 0, 1);
    if (value <= 0) {
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
}

// Merge two positive amount maps into one.
function mergeCostMaps(baseCosts, extraCosts) {
  const merged = normalizePositiveAmountMap(baseCosts);
  const extra = normalizePositiveAmountMap(extraCosts);
  for (const [resource, amount] of Object.entries(extra)) {
    merged[resource] = Math.max(1, Math.round(Number(merged[resource] || 0) + Number(amount || 0)));
  }
  return merged;
}

// Check whether stockpile has enough for a full cost map.
function hasCostInputs(stockpile, costs) {
  if (!stockpile || !costs || typeof costs !== 'object') {
    return false;
  }
  for (const [resource, amountRaw] of Object.entries(costs)) {
    const amount = Math.max(0, Number(amountRaw || 0));
    if (amount <= 0) {
      continue;
    }
    if (Number(stockpile[resource] || 0) < amount) {
      return false;
    }
  }
  return true;
}

// Trim ritual history to configured limit.
function trimRitualHistory(schism, limitRaw) {
  if (!schism || !Array.isArray(schism.ritualHistory)) {
    return;
  }
  const limit = Math.max(0, Math.floor(Number(limitRaw || 0)));
  if (limit <= 0) {
    return;
  }
  if (schism.ritualHistory.length > limit) {
    schism.ritualHistory = schism.ritualHistory.slice(schism.ritualHistory.length - limit);
  }
}

// Compute core stock floor ratio (food/water/beer).
function getCoreStockFloorRatio(state, config) {
  return Math.min(
    getResourceRatio(state, config, 'food'),
    getResourceRatio(state, config, 'water'),
    getResourceRatio(state, config, 'beer'),
  );
}

// Resolve doctrine scalar from schism config subtree.
function getSchismDoctrineScalar(state, config, branchKey, scalarKey, fallback) {
  const fallbackValue = Number.isFinite(Number(fallback)) ? Number(fallback) : 1;
  const schism = state && state.schism && state.schism.enabled !== false ? state.schism : null;
  if (!schism) {
    return fallbackValue;
  }
  const schismConfig = getSchismConfig(config);
  const branch = schismConfig && schismConfig[branchKey] && typeof schismConfig[branchKey] === 'object'
    ? schismConfig[branchKey]
    : {};
  const map = branch && branch[scalarKey] && typeof branch[scalarKey] === 'object'
    ? branch[scalarKey]
    : {};
  const value = Number(map[schism.doctrine]);
  if (!Number.isFinite(value) || value <= 0) {
    return fallbackValue;
  }
  return value;
}

// Resolve temple legitimacy threshold for a specific stage number.
function resolveTempleLegitimacyThreshold(templeConfig, stageNumber) {
  const stage = Math.max(1, Math.floor(Number(stageNumber || 1)));
  if (Array.isArray(templeConfig.min_legitimacy_by_stage)) {
    const value = Number(templeConfig.min_legitimacy_by_stage[stage - 1]);
    if (Number.isFinite(value)) {
      return clamp(value, 0, 1);
    }
  }
  if (templeConfig.min_legitimacy_stage_map && typeof templeConfig.min_legitimacy_stage_map === 'object') {
    const value = Number(templeConfig.min_legitimacy_stage_map[String(stage)]);
    if (Number.isFinite(value)) {
      return clamp(value, 0, 1);
    }
  }
  const fallback = Number(templeConfig.min_legitimacy || 0);
  if (Number.isFinite(fallback) && fallback > 0) {
    return clamp(fallback, 0, 1);
  }
  return 0;
}

// Merge multiplier values into an accumulator map.
function mergeMultiplierMap(target, source) {
  if (!source || typeof source !== 'object') {
    return;
  }
  for (const [key, valueRaw] of Object.entries(source)) {
    const value = Number(valueRaw);
    if (!Number.isFinite(value) || value <= 0) {
      continue;
    }
    target[key] = Number(target[key] || 1) * value;
  }
}

// Build doctrine-shift event text.
function buildDoctrineShiftMessage(doctrine) {
  if (doctrine === 'revelry') {
    return 'Schism doctrine: Revelry Ascendant';
  }
  return 'Schism doctrine: Austerity Mandate';
}

// Build phase-shift event text.
function buildPhaseShiftMessage(phase) {
  if (phase === 'murmurs') {
    return 'Schism phase: murmurs rise in the halls';
  }
  if (phase === 'fracture') {
    return 'Schism phase: the halls fracture';
  }
  if (phase === 'reckoning') {
    return 'Schism phase: reckoning of the Nine Braziers';
  }
  return 'Schism phase: concord restored';
}

// Build climax-resolution event text.
function buildClimaxResolutionMessage(doctrine) {
  if (doctrine === 'revelry') {
    return 'Schism resolved: revelry rites bind the clans into one oath';
  }
  return 'Schism resolved: austerity covenant reforges the ancestral law';
}

module.exports = {
  getSchismConfig,
  createSchismState,
  ensureSchismState,
  updateSchism,
  getSchismModifier,
  getSchismFestivalIntent,
  resolveSchismFestivalRitualPlan,
  getSchismFestivalCostMultiplier,
  getSchismFestivalEffectMultiplier,
  notifySchismFestivalStarted,
  canTempleAdvanceByLegitimacy,
  getSchismLegitimacy,
  getSchismDoctrine,
  getSchismStatus,
};
