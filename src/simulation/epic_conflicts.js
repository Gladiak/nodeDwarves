'use strict';

const { clamp } = require('../utils');
const { isAdult } = require('./population');
const { ensureDwarfWarriorState, setWarriorInjuryState } = require('./warriors');
const { emitNemesisEvent } = require('./nemesis_events');
const { resolveDwarfIdentity } = require('../dwarf_identity');

const EPIC_CONFLICT_SCHEMA_VERSION = 1;
const SIEGE_STAGES = ['warning', 'approach', 'demand', 'breach', 'battle', 'retreat', 'victory', 'aftermath'];
const TERMINAL_NEMESIS_STATUSES = new Set(['defeated', 'reconciled']);

// Create the bounded runtime owner for persistent antagonists and staged sieges.
function createEpicConflictState() {
  return {
    schemaVersion: EPIC_CONFLICT_SCHEMA_VERSION,
    nemeses: { order: [], byId: {} },
    activeSiege: null,
    history: [],
    recoveryUntilTick: 0,
    nextSiegeSequence: 1,
    stats: {
      promoted: 0,
      restored: 0,
      evicted: 0,
      siegesStarted: 0,
      siegesCompleted: 0,
      colonyVictories: 0,
      nemesisVictories: 0,
      reconciliations: 0,
      tributes: 0,
      encounters: 0,
      injuries: 0,
      structuresDamaged: 0,
      structuresRestored: 0,
    },
  };
}

// Repair partial serialized conflict state and enforce every configured hard cap.
function ensureEpicConflictState(state, config) {
  if (!state || typeof state !== 'object') return null;
  const settings = getEpicConflictSettings(config);
  const raw = state.epicConflict && typeof state.epicConflict === 'object'
    ? state.epicConflict : createEpicConflictState();
  const next = createEpicConflictState();
  next.nextSiegeSequence = Math.max(1, safeInt(raw.nextSiegeSequence, 1));
  next.recoveryUntilTick = safeInt(raw.recoveryUntilTick, 0);
  for (const field of Object.keys(next.stats)) next.stats[field] = safeInt(raw.stats && raw.stats[field], 0);
  const sourceOrder = raw.nemeses && Array.isArray(raw.nemeses.order)
    ? raw.nemeses.order : Object.keys(raw.nemeses && raw.nemeses.byId || {});
  for (const idRaw of sourceOrder) {
    const id = token(idRaw, 96);
    const record = normalizeNemesis(raw.nemeses && raw.nemeses.byId && raw.nemeses.byId[id], settings);
    if (!id || !record || next.nemeses.byId[id]) continue;
    next.nemeses.order.push(id);
    next.nemeses.byId[id] = record;
  }
  next.history = normalizeHistory(raw.history, settings.maxHistory);
  next.activeSiege = normalizeSiege(raw.activeSiege, settings);
  state.epicConflict = next;
  enforceNemesisCapacity(next, settings);
  return next;
}

// Advance promotion, siege stages, rivalry memory, and post-conflict recovery.
function updateEpicConflicts(state, config) {
  const settings = getEpicConflictSettings(config);
  const runtime = getEpicConflictRuntime(state, config);
  if (!runtime || !settings.enabled) return runtime;
  emitPendingReappearances(state, config, runtime);
  promoteEligibleNemeses(state, config, runtime, settings);
  syncUnderrealmEncounterMemory(state, config, runtime, settings);
  recoverSiegeDamage(state, runtime, settings);
  if (runtime.activeSiege) {
    advanceSiege(state, config, runtime, settings);
  } else {
    maybeStartSiege(state, config, runtime, settings);
  }
  enforceNemesisCapacity(runtime, settings);
  return runtime;
}

// Promote one source into a stable named antagonist without consuming gameplay RNG.
function promoteNemesis(state, config, source) {
  const runtime = getEpicConflictRuntime(state, config);
  const settings = getEpicConflictSettings(config);
  if (!runtime || !settings.enabled || !source) return null;
  const sourceKind = token(source.sourceKind, 32);
  const sourceId = token(source.sourceId, 64);
  if (!sourceKind || !sourceId) return null;
  const id = token(`nemesis_${sourceKind}_${sourceId}`, 96);
  const existing = runtime.nemeses.byId[id];
  if (existing) {
    existing.lastSeenTick = safeInt(state.tick, existing.lastSeenTick);
    existing.sourceCampId = token(source.sourceCampId, 96) || existing.sourceCampId;
    existing.location = normalizeLocation(source.location) || existing.location;
    existing.power = clamp(Number(source.power ?? existing.power), 0, 2);
    if (!TERMINAL_NEMESIS_STATUSES.has(existing.status)) existing.status = 'active';
    return existing;
  }
  const identity = buildNemesisIdentity(sourceKind, sourceId, settings);
  const cycle = safeInt(state.cycleStats && state.cycleStats.count, 0);
  const nemesis = {
    id,
    sagaId: token(`saga_${id}`, 96),
    sourceKind,
    sourceId,
    sourceDepth: safeInt(source.sourceDepth, 0),
    sourceCampId: token(source.sourceCampId, 96),
    factionId: token(source.factionId || sourceId, 64) || 'unknown_faction',
    factionLabel: text(source.factionLabel || source.factionId || 'Unknown Faction', 96),
    name: identity.name,
    epithet: identity.epithet,
    displayName: `${identity.name} ${identity.epithet}`,
    traits: identity.traits,
    goal: identity.goal,
    titles: [identity.epithet],
    scars: [],
    grudges: [],
    encounters: [],
    victories: 0,
    defeats: 0,
    retreats: 0,
    status: 'active',
    promotedCycle: cycle,
    promotedTick: safeInt(state.tick, 0),
    lastSeenTick: safeInt(state.tick, 0),
    lastSiegeTick: 0,
    lastEventId: null,
    grudgeHeroId: null,
    grudgeHeroClanId: null,
    sourceOutcomeTick: 0,
    sourceVictories: 0,
    sourceDefeats: 0,
    sourceRetreats: 0,
    power: clamp(Number(source.power || 0), 0, 2),
    location: normalizeLocation(source.location),
    restoredFromLegacy: false,
    reappearancePending: false,
  };
  runtime.nemeses.order.push(id);
  runtime.nemeses.byId[id] = nemesis;
  runtime.stats.promoted += 1;
  enforceNemesisCapacity(runtime, settings);
  const event = emitNemesisEvent(state, config, nemesis, 'promoted', {
    message: `${nemesis.displayName}, ${nemesis.goal}, rises for ${nemesis.factionLabel}.`,
    location: nemesis.location,
    causeMetric: 'eligibility',
    causeValue: text(source.eligibility || sourceKind, 64),
    consequences: [{
      kind: 'create', targetKind: 'threat', targetId: nemesis.id,
      metric: 'nemesis_status', value: 'active', unit: null,
    }],
  });
  nemesis.lastEventId = event && event.id || null;
  return nemesis;
}

// Start a staged surface siege for one eligible persistent nemesis.
function startSiege(state, config, nemesisId, options = {}) {
  const runtime = getEpicConflictRuntime(state, config);
  const settings = getEpicConflictSettings(config);
  const nemesis = runtime && runtime.nemeses.byId[token(nemesisId, 96)];
  if (!runtime || !settings.siegeEnabled || !nemesis || runtime.activeSiege) return null;
  const tick = safeInt(state.tick, 0);
  const heroSelection = selectSiegeHero(state, config, nemesis);
  const sourceCamp = findSourceCamp(state, nemesis);
  const location = normalizeLocation(options.location)
    || normalizeLocation(sourceCamp && { scope: 'surface', x: sourceCamp.x, y: sourceCamp.y, label: sourceCamp.factionLabel })
    || nemesis.location
    || { scope: 'world' };
  const sequence = runtime.nextSiegeSequence;
  runtime.nextSiegeSequence += 1;
  const siege = {
    id: token(`siege_c${safeInt(state.cycleStats && state.cycleStats.count, 0)}_${sequence}`, 96),
    nemesisId: nemesis.id,
    sourceCampId: token(options.sourceCampId || sourceCamp && sourceCamp.id || nemesis.sourceCampId, 96),
    stage: 'warning',
    stageTicksRemaining: settings.stageTicks.warning,
    startedTick: tick,
    lastStageTick: tick,
    heroId: heroSelection.hero ? String(heroSelection.hero.id) : null,
    inheritedGrudge: heroSelection.inheritedGrudge,
    location,
    parentEventId: nemesis.lastEventId,
    outcome: null,
    branch: heroSelection.branch,
    defenseScore: 0,
    threatScore: 0,
    damagedStructureIds: [],
    injuredDwarfIds: [],
    resourceLosses: {},
    stages: ['warning'],
  };
  runtime.activeSiege = siege;
  runtime.stats.siegesStarted += 1;
  nemesis.lastSiegeTick = tick;
  nemesis.status = 'active';
  const event = emitSiegeStage(state, config, nemesis, siege, 'warning', settings);
  siege.parentEventId = event && event.id || siege.parentEventId;
  nemesis.lastEventId = siege.parentEventId;
  applySchismDelta(state, settings.politics.warningPressure, 0);
  return siege;
}

// Rehydrate only bounded qualifying nemeses previously admitted to worldLegacy.
function restoreLegacyNemeses(state, config) {
  const runtime = getEpicConflictRuntime(state, config);
  const settings = getEpicConflictSettings(config);
  const records = Array.isArray(state && state.worldLegacy && state.worldLegacy.nemeses)
    ? state.worldLegacy.nemeses : [];
  if (!runtime || !settings.enabled) return 0;
  let restored = 0;
  for (const record of records) {
    const normalized = normalizeNemesis({
      ...record,
      restoredFromLegacy: true,
      reappearancePending: true,
      status: TERMINAL_NEMESIS_STATUSES.has(record.status) ? record.status : 'dormant',
      lastSeenTick: safeInt(state.tick, 0),
      lastSiegeTick: 0,
      lastEventId: null,
      sourceCampId: null,
      location: null,
    }, settings);
    if (!normalized || runtime.nemeses.byId[normalized.id]) continue;
    runtime.nemeses.order.push(normalized.id);
    runtime.nemeses.byId[normalized.id] = normalized;
    restored += 1;
  }
  runtime.stats.restored += restored;
  enforceNemesisCapacity(runtime, settings);
  return restored;
}

// Return a compact read model for telemetry, reports, and panel tests.
function getEpicConflictStatus(state) {
  const runtime = state && state.epicConflict && typeof state.epicConflict === 'object'
    ? state.epicConflict : createEpicConflictState();
  const records = runtime.nemeses && runtime.nemeses.byId || {};
  const active = runtime.activeSiege;
  const nemesis = active ? records[active.nemesisId] : null;
  return {
    nemesisCount: Object.keys(records).length,
    activeNemeses: Object.values(records).filter((entry) => entry && !TERMINAL_NEMESIS_STATUSES.has(entry.status)).length,
    activeSiege: active ? {
      id: active.id,
      stage: active.stage,
      ticksRemaining: safeInt(active.stageTicksRemaining, 0),
      nemesisId: active.nemesisId,
      nemesisName: nemesis ? nemesis.displayName : active.nemesisId,
      heroId: active.heroId,
      outcome: active.outcome,
      branch: active.branch,
    } : null,
    recoveryTicks: Math.max(0, safeInt(runtime.recoveryUntilTick, 0) - safeInt(state && state.tick, 0)),
    stats: { ...runtime.stats },
  };
}

function getEpicConflictRuntime(state, config) {
  const runtime = state && state.epicConflict;
  if (runtime
    && runtime.schemaVersion === EPIC_CONFLICT_SCHEMA_VERSION
    && runtime.nemeses && Array.isArray(runtime.nemeses.order)
    && runtime.nemeses.byId && typeof runtime.nemeses.byId === 'object'
    && Array.isArray(runtime.history)
    && runtime.stats && typeof runtime.stats === 'object') {
    return runtime;
  }
  return ensureEpicConflictState(state, config);
}

// Resolve factual nemesis rivalry rows for one dwarf Inspect panel.
function getDwarfNemesisMemory(state, dwarfId) {
  const id = String(dwarfId || '');
  if (!id) return [];
  const runtime = state && state.epicConflict;
  const records = runtime && runtime.nemeses && runtime.nemeses.byId || {};
  const rows = [];
  for (const nemesis of Object.values(records)) {
    if (!nemesis) continue;
    const encounters = (nemesis.encounters || []).filter((entry) => entry && entry.heroId === id);
    const hasGrudge = (nemesis.grudges || []).includes(id) || nemesis.grudgeHeroId === id;
    if (encounters.length === 0 && !hasGrudge) continue;
    const latest = encounters[encounters.length - 1];
    rows.push({
      nemesisId: nemesis.id,
      label: nemesis.displayName,
      encounters: encounters.length,
      outcome: latest ? latest.outcome : 'grudge',
      branch: latest ? latest.branch : 'grudge',
      active: !TERMINAL_NEMESIS_STATUSES.has(nemesis.status),
    });
  }
  rows.sort((left, right) => right.encounters - left.encounters || left.nemesisId.localeCompare(right.nemesisId));
  return rows;
}

function promoteEligibleNemeses(state, config, runtime, settings) {
  const tick = safeInt(state.tick, 0);
  if (tick % settings.promotionCheckInterval !== 0) return;
  const camps = Array.isArray(state.externalCamps && state.externalCamps.camps)
    ? state.externalCamps.camps : [];
  for (const camp of camps) {
    if (!camp || camp.role !== 'raider') continue;
    const hostility = clamp(Number(camp.hostility || 0), 0, 1);
    const demands = safeInt(camp.raiderDemands, 0);
    if (hostility < settings.raiderPromotionHostility && demands < settings.raiderPromotionDemands) continue;
    promoteNemesis(state, config, {
      sourceKind: 'raider_leader',
      sourceId: camp.factionId || camp.id,
      sourceCampId: camp.id,
      factionId: camp.factionId,
      factionLabel: camp.factionLabel,
      power: hostility,
      eligibility: hostility >= settings.raiderPromotionHostility ? 'hostility' : 'demands',
      location: { scope: 'surface', x: safeInt(camp.x, 0), y: safeInt(camp.y, 0), label: camp.factionLabel },
    });
  }
  const floors = state.underrealm && state.underrealm.combat && state.underrealm.combat.floorsByDepth || {};
  for (const [depthKey, floor] of Object.entries(floors)) {
    if (!floor || !floor.champion || floor.champion.enabled === false) continue;
    const attempts = safeInt(floor.encounter && floor.encounter.attempts, 0);
    if (attempts < settings.underrealmPromotionAttempts) continue;
    promoteNemesis(state, config, {
      sourceKind: 'underrealm_champion',
      sourceId: floor.champion.id || `depth_${depthKey}`,
      sourceDepth: safeInt(depthKey, 1),
      factionId: `underrealm_depth_${depthKey}`,
      factionLabel: `Underrealm Depth ${depthKey}`,
      power: resolveChampionPower(floor.champion),
      eligibility: 'champion_encounter',
      location: { scope: 'underrealm', depth: safeInt(depthKey, 1), label: floor.champion.label },
    });
  }
}

function syncUnderrealmEncounterMemory(state, config, runtime, settings) {
  const floors = state.underrealm && state.underrealm.combat && state.underrealm.combat.floorsByDepth || {};
  for (const nemesis of Object.values(runtime.nemeses.byId)) {
    if (!nemesis || nemesis.sourceKind !== 'underrealm_champion') continue;
    const floor = floors[String(nemesis.sourceDepth)];
    const encounter = floor && floor.encounter;
    const outcomeTick = safeInt(encounter && encounter.lastOutcomeTick, 0);
    if (!encounter || outcomeTick <= safeInt(nemesis.sourceOutcomeTick, 0)) continue;
    const outcome = String(encounter.lastOutcome || 'retreat');
    if (outcome === 'victory') nemesis.defeats += 1;
    else if (outcome === 'defeat') nemesis.victories += 1;
    else nemesis.retreats += 1;
    nemesis.sourceOutcomeTick = outcomeTick;
    nemesis.sourceVictories = safeInt(encounter.victories, 0);
    nemesis.sourceDefeats = safeInt(encounter.defeats, 0);
    nemesis.sourceRetreats = safeInt(encounter.retreats, 0);
    const hero = selectSiegeHero(state, config, nemesis).hero;
    const branch = outcome === 'victory' ? 'nemesis_defeated' : outcome === 'defeat' ? 'deep_grudge' : 'stalemate';
    recordEncounter(state, runtime, settings, nemesis, hero, outcome, branch, null);
  }
}

function maybeStartSiege(state, config, runtime, settings) {
  const tick = safeInt(state.tick, 0);
  if (!settings.siegeEnabled || tick < settings.siegeMinTick || tick < runtime.recoveryUntilTick) return;
  if ((state.raid && state.raid.active) || (state.dwarves || []).length < settings.minPopulation) return;
  const candidates = [];
  for (const id of runtime.nemeses.order) {
    const nemesis = runtime.nemeses.byId[id];
    if (!nemesis || nemesis.sourceKind !== 'raider_leader' || TERMINAL_NEMESIS_STATUSES.has(nemesis.status)) continue;
    if (tick - safeInt(nemesis.lastSiegeTick, 0) < settings.siegeCooldownTicks) continue;
    const camp = findSourceCamp(state, nemesis);
    if (!camp || camp.phase !== 'active') continue;
    const hostility = clamp(Number(camp.hostility || 0), 0, 1);
    const demands = safeInt(camp.raiderDemands, 0);
    const demandTriggered = settings.siegeTriggerDemands > 0 && demands >= settings.siegeTriggerDemands;
    if (hostility < settings.siegeTriggerHostility && !demandTriggered) continue;
    candidates.push({ nemesis, camp, score: hostility + demands * 0.02 + nemesis.victories * 0.1 });
  }
  candidates.sort((left, right) => right.score - left.score || left.nemesis.id.localeCompare(right.nemesis.id));
  const chosen = candidates[0];
  if (!chosen) return;
  chosen.nemesis.sourceCampId = chosen.camp.id;
  chosen.nemesis.power = Math.max(chosen.nemesis.power, clamp(Number(chosen.camp.hostility || 0), 0, 1));
  startSiege(state, config, chosen.nemesis.id, {
    sourceCampId: chosen.camp.id,
    location: { scope: 'surface', x: safeInt(chosen.camp.x, 0), y: safeInt(chosen.camp.y, 0), label: chosen.camp.factionLabel },
  });
}

function advanceSiege(state, config, runtime, settings) {
  const siege = runtime.activeSiege;
  const nemesis = siege && runtime.nemeses.byId[siege.nemesisId];
  if (!siege || !nemesis) {
    runtime.activeSiege = null;
    return;
  }
  siege.stageTicksRemaining = Math.max(0, safeInt(siege.stageTicksRemaining, 0) - 1);
  if (siege.stageTicksRemaining > 0) return;
  if (siege.stage === 'warning') return enterSiegeStage(state, config, runtime, nemesis, siege, 'approach', settings);
  if (siege.stage === 'approach') return enterSiegeStage(state, config, runtime, nemesis, siege, 'demand', settings);
  if (siege.stage === 'demand') {
    const demandOutcome = resolveDemandOutcome(state, nemesis, settings);
    if (demandOutcome === 'reconciliation') {
      siege.outcome = 'reconciliation';
      siege.branch = 'reconciliation';
      runtime.stats.reconciliations += 1;
      nemesis.status = 'reconciled';
      return enterSiegeStage(state, config, runtime, nemesis, siege, 'retreat', settings);
    }
    if (demandOutcome === 'tribute') {
      siege.outcome = 'tribute';
      siege.branch = 'collapse_guardrail';
      runtime.stats.tributes += 1;
      applyTribute(state, siege, settings);
      return enterSiegeStage(state, config, runtime, nemesis, siege, 'retreat', settings);
    }
    return enterSiegeStage(state, config, runtime, nemesis, siege, 'breach', settings);
  }
  if (siege.stage === 'breach') {
    damageStructures(state, runtime, siege, settings);
    return enterSiegeStage(state, config, runtime, nemesis, siege, 'battle', settings);
  }
  if (siege.stage === 'battle') {
    resolveSiegeBattle(state, config, runtime, nemesis, siege, settings);
    return enterSiegeStage(
      state, config, runtime, nemesis, siege,
      siege.outcome === 'nemesis_victory' ? 'victory' : 'retreat', settings,
    );
  }
  if (siege.stage === 'retreat' || siege.stage === 'victory') {
    return enterSiegeStage(state, config, runtime, nemesis, siege, 'aftermath', settings);
  }
  if (siege.stage === 'aftermath') finishSiege(state, config, runtime, nemesis, siege, settings);
}

function enterSiegeStage(state, config, runtime, nemesis, siege, stage, settings) {
  siege.stage = stage;
  siege.lastStageTick = safeInt(state.tick, 0);
  siege.stageTicksRemaining = resolveStageDuration(state, stage, settings);
  if (!siege.stages.includes(stage)) siege.stages.push(stage);
  const event = emitSiegeStage(state, config, nemesis, siege, stage, settings);
  siege.parentEventId = event && event.id || siege.parentEventId;
  nemesis.lastEventId = siege.parentEventId;
}

function emitSiegeStage(state, config, nemesis, siege, stage, settings) {
  const hero = findDwarf(state, siege.heroId);
  const label = nemesis.displayName;
  const messages = {
    warning: `${label} has marked the hold; watchtowers sound the siege warning.`,
    approach: `${label} advances along the frontier roads toward the hold.`,
    demand: `${label} demands tribute and submission from the council.`,
    breach: `${label} breaches the outer works; structures and territory are contested.`,
    battle: `${label} meets ${heroLabel(hero, state, config)} in the decisive battle.`,
    retreat: siege.outcome === 'reconciliation'
      ? `${label} accepts reconciliation and withdraws under oath.`
      : siege.outcome === 'tribute'
        ? `${label} withdraws after the hold pays a guarded tribute.`
        : `${label} retreats from the hold after ${siege.branch || 'the defense'}.`,
    victory: `${label} breaks the defense and claims a grim victory.`,
    aftermath: `The hold enters recovery after ${label}'s siege (${siege.outcome || 'unresolved'}).`,
  };
  const consequences = [{
    kind: 'status', targetKind: 'settlement', targetId: 'settlement_main',
    metric: 'siege_stage', value: stage, unit: null,
  }];
  if (stage === 'breach') consequences.push({
    kind: 'status', targetKind: 'world', targetId: 'surface_frontier',
    metric: 'territory_contested', value: true, unit: null,
  });
  if (stage === 'retreat') consequences.push({
    kind: 'status', targetKind: 'threat', targetId: nemesis.id,
    metric: 'withdrawn', value: true, unit: null,
  });
  if (stage === 'victory') consequences.push({
    kind: 'status', targetKind: 'threat', targetId: nemesis.id,
    metric: 'victory', value: true, unit: null,
  });
  if (stage === 'aftermath') consequences.push({
    kind: 'status', targetKind: 'settlement', targetId: 'settlement_main',
    metric: 'recovery_ticks', value: settings.recoveryTicks, unit: 'ticks',
  });
  return emitNemesisEvent(state, config, nemesis, stage, {
    type: `siege.${stage}`,
    message: messages[stage],
    hero,
    heroRole: 'opponent',
    location: siege.location,
    parentEventId: siege.parentEventId,
    consequences,
    tags: ['siege', stage, siege.outcome || 'active', siege.branch || 'mainline'],
  });
}

function resolveDemandOutcome(state, nemesis, settings) {
  const camp = findSourceCamp(state, nemesis);
  const hostility = clamp(Number(camp && camp.hostility || nemesis.power || 0), 0, 1);
  if (nemesis.defeats > 0 && nemesis.victories > 0 && hostility <= settings.reconciliationHostilityMax) {
    return 'reconciliation';
  }
  const population = Array.isArray(state.dwarves) ? state.dwarves.length : 0;
  const critical = ['food', 'water'].some((resource) => {
    const current = Math.max(0, Number(state.stockpile && state.stockpile[resource] || 0));
    const target = Math.max(1, Number(state.resourceTargets && state.resourceTargets[resource]
      || configTarget(state, resource) || 1));
    return current / target < settings.collapseStockpileRatio;
  });
  return population <= settings.collapsePopulationFloor || critical ? 'tribute' : 'defiance';
}

function applyTribute(state, siege, settings) {
  for (const [resource, amountRaw] of Object.entries(settings.tributeCosts)) {
    const current = Math.max(0, Number(state.stockpile && state.stockpile[resource] || 0));
    const loss = Math.min(current, Math.max(0, Math.floor(Number(amountRaw || 0))));
    if (loss <= 0) continue;
    state.stockpile[resource] = current - loss;
    siege.resourceLosses[resource] = Number(siege.resourceLosses[resource] || 0) + loss;
  }
}

function resolveSiegeBattle(state, config, runtime, nemesis, siege, settings) {
  const hero = findDwarf(state, siege.heroId);
  const heroScore = computeHeroScore(hero, config);
  const defense = computeSiegeDefense(state, config, heroScore, settings);
  const threat = computeNemesisThreat(state, nemesis, settings);
  siege.defenseScore = defense;
  siege.threatScore = threat;
  const priorHeroDefeat = (nemesis.encounters || []).some((entry) => (
    entry && entry.heroId === siege.heroId && entry.outcome === 'nemesis_victory'
  ));
  let colonyVictory = defense >= threat;
  let branch = siege.branch || 'defense';
  if (!colonyVictory && hero && heroScore >= settings.rescueMinHeroScore
    && defense + settings.rescueDefenseBonus >= threat) {
    colonyVictory = true;
    branch = 'rescue';
  } else if (colonyVictory && priorHeroDefeat) {
    branch = 'revenge';
  } else if (siege.inheritedGrudge) {
    branch = 'inherited_grudge';
  }
  siege.branch = branch;
  siege.outcome = colonyVictory ? 'colony_victory' : 'nemesis_victory';
  if (colonyVictory) {
    runtime.stats.colonyVictories += 1;
    nemesis.defeats += 1;
    nemesis.retreats += 1;
    nemesis.status = 'dormant';
    appendUnique(nemesis.scars, `scar_of_${token(siege.heroId || 'the_hold', 48)}`, settings.maxScars);
    applySchismDelta(state, -settings.politics.victoryPressureRelief, settings.politics.victoryLegitimacyGain);
  } else {
    runtime.stats.nemesisVictories += 1;
    nemesis.victories += 1;
    nemesis.status = 'active';
    applyBattleLosses(state, config, runtime, nemesis, siege, threat - defense, settings);
    applySchismDelta(state, settings.politics.defeatPressureGain, -settings.politics.defeatLegitimacyLoss);
  }
  if (hero) {
    nemesis.grudgeHeroId = String(hero.id);
    nemesis.grudgeHeroClanId = hero.clanId ? String(hero.clanId) : null;
    appendUnique(nemesis.grudges, String(hero.id), settings.maxGrudges);
  }
  const event = emitNemesisEvent(state, config, nemesis, 'battle_resolved', {
    type: 'siege.battle_resolved',
    message: colonyVictory
      ? `${heroLabel(hero, state, config)} turns back ${nemesis.displayName} through ${branch}.`
      : `${nemesis.displayName} overwhelms the defense; recovery begins under a living grudge.`,
    hero,
    location: siege.location,
    parentEventId: siege.parentEventId,
    causeMetric: 'score_margin',
    causeValue: Number((defense - threat).toFixed(4)),
    consequences: buildBattleConsequences(nemesis, siege, colonyVictory),
    tags: ['siege', 'battle', colonyVictory ? 'colony_victory' : 'nemesis_victory', branch],
  });
  siege.parentEventId = event && event.id || siege.parentEventId;
  nemesis.lastEventId = siege.parentEventId;
  recordEncounter(state, runtime, settings, nemesis, hero, siege.outcome, branch, siege.parentEventId);
}

function buildBattleConsequences(nemesis, siege, colonyVictory) {
  const consequences = [{
    kind: 'status', targetKind: 'threat', targetId: nemesis.id,
    metric: 'battle_outcome', value: colonyVictory ? 'repelled' : 'victorious', unit: null,
  }];
  for (const id of siege.injuredDwarfIds) consequences.push({
    kind: 'injury', targetKind: 'dwarf', targetId: id,
    metric: 'siege_injury', value: 'moderate', unit: null,
  });
  for (const id of siege.damagedStructureIds) consequences.push({
    kind: 'status', targetKind: 'structure', targetId: id,
    metric: 'siege_damage', value: true, unit: null,
  });
  for (const [resource, amount] of Object.entries(siege.resourceLosses)) consequences.push({
    kind: 'transfer', targetKind: 'resource', targetId: resource,
    metric: 'siege_loss', value: amount, unit: 'units',
  });
  return consequences.slice(0, 12);
}

function applyBattleLosses(state, config, runtime, nemesis, siege, gapRaw, settings) {
  const gap = Math.max(0, Number(gapRaw || 0));
  const adults = (Array.isArray(state.dwarves) ? state.dwarves : [])
    .filter((dwarf) => isAdult(dwarf, config))
    .sort((left, right) => computeHeroScore(left, config) - computeHeroScore(right, config)
      || String(left.id).localeCompare(String(right.id)));
  const injuryCount = Math.min(
    settings.maxInjuries,
    Math.max(1, Math.ceil(gap * settings.injuryGapScale)),
    Math.max(0, adults.length - settings.collapsePopulationFloor),
  );
  for (const dwarf of adults.slice(0, injuryCount)) {
    const warrior = ensureDwarfWarriorState(dwarf, config);
    setWarriorInjuryState(warrior, 'moderate', settings.injuryRecoveryTicks, state.tick, 'siege');
    dwarf.state.stress = clamp(Number(dwarf.state.stress || 0) + settings.injuryStressGain, 0, 1);
    siege.injuredDwarfIds.push(String(dwarf.id));
  }
  runtime.stats.injuries += siege.injuredDwarfIds.length;
  const ratio = Math.min(settings.maxResourceLossRatio, settings.resourceLossBase + gap * settings.resourceLossGapScale);
  for (const resource of settings.lossResources) {
    const current = Math.max(0, Number(state.stockpile && state.stockpile[resource] || 0));
    const reserve = Math.max(0, Number(configTarget(state, resource) || 0) * settings.resourceReserveRatio);
    const loss = Math.min(Math.max(0, current - reserve), Math.floor(current * ratio));
    if (loss <= 0) continue;
    state.stockpile[resource] = current - loss;
    siege.resourceLosses[resource] = loss;
  }
}

function damageStructures(state, runtime, siege, settings) {
  const candidates = (Array.isArray(state.structures) ? state.structures : [])
    .filter((entry) => entry && entry.id && entry.type !== 'house')
    .sort((left, right) => structureDamageRank(left.type) - structureDamageRank(right.type)
      || String(left.id).localeCompare(String(right.id)));
  for (const structure of candidates.slice(0, settings.maxDamagedStructures)) {
    structure.siegeDamage = {
      severity: settings.structureDamageSeverity,
      nemesisId: siege.nemesisId,
      damagedTick: safeInt(state.tick, 0),
    };
    siege.damagedStructureIds.push(String(structure.id));
  }
  runtime.stats.structuresDamaged += siege.damagedStructureIds.length;
}

function recoverSiegeDamage(state, runtime, settings) {
  const tick = safeInt(state && state.tick, 0);
  if (tick <= 0 || tick > runtime.recoveryUntilTick || tick % settings.repairIntervalTicks !== 0) return;
  for (const structure of Array.isArray(state.structures) ? state.structures : []) {
    if (!structure || !structure.siegeDamage) continue;
    structure.siegeDamage.severity = Math.max(0, safeInt(structure.siegeDamage.severity, 0) - 1);
    if (structure.siegeDamage.severity <= 0) {
      delete structure.siegeDamage;
      runtime.stats.structuresRestored += 1;
    }
  }
}

function finishSiege(state, config, runtime, nemesis, siege, settings) {
  const tick = safeInt(state.tick, 0);
  runtime.stats.siegesCompleted += 1;
  runtime.recoveryUntilTick = tick + settings.recoveryTicks;
  runtime.history.push({
    id: siege.id,
    nemesisId: siege.nemesisId,
    heroId: siege.heroId,
    cycle: safeInt(state.cycleStats && state.cycleStats.count, 0),
    startedTick: siege.startedTick,
    completedTick: tick,
    outcome: siege.outcome,
    branch: siege.branch,
    stages: siege.stages.slice(),
    sourceEventId: siege.parentEventId,
  });
  if (runtime.history.length > settings.maxHistory) runtime.history.splice(0, runtime.history.length - settings.maxHistory);
  nemesis.lastSeenTick = tick;
  runtime.activeSiege = null;
}

function recordEncounter(state, runtime, settings, nemesis, hero, outcome, branch, sourceEventId) {
  const entry = {
    id: token(`encounter_c${safeInt(state.cycleStats && state.cycleStats.count, 0)}_t${safeInt(state.tick, 0)}_${nemesis.encounters.length}`, 128),
    cycle: safeInt(state.cycleStats && state.cycleStats.count, 0),
    tick: safeInt(state.tick, 0),
    heroId: hero ? String(hero.id) : null,
    heroClanId: hero && hero.clanId ? String(hero.clanId) : null,
    outcome: token(outcome, 48) || 'unknown',
    branch: token(branch, 48) || 'mainline',
    sourceEventId: sourceEventId || null,
  };
  nemesis.encounters.push(entry);
  if (nemesis.encounters.length > settings.maxEncounters) {
    nemesis.encounters.splice(0, nemesis.encounters.length - settings.maxEncounters);
  }
  runtime.stats.encounters += 1;
}

function emitPendingReappearances(state, config, runtime) {
  for (const nemesis of Object.values(runtime.nemeses.byId)) {
    if (!nemesis || !nemesis.reappearancePending) continue;
    nemesis.reappearancePending = false;
    const event = emitNemesisEvent(state, config, nemesis, 'reappeared', {
      message: `${nemesis.displayName} returns from an older cycle, carrying ${nemesis.encounters.length} remembered encounters.`,
      causeMetric: 'legacy_cycle',
      causeValue: nemesis.promotedCycle,
      consequences: [{
        kind: 'status', targetKind: 'threat', targetId: nemesis.id,
        metric: 'legacy_reappearance', value: true, unit: null,
      }],
    });
    nemesis.lastEventId = event && event.id || null;
  }
}

function selectSiegeHero(state, config, nemesis) {
  const dwarves = Array.isArray(state && state.dwarves) ? state.dwarves : [];
  const livingGrudge = findDwarf(state, nemesis.grudgeHeroId);
  if (livingGrudge) return { hero: livingGrudge, inheritedGrudge: false, branch: 'grudge' };
  const adults = dwarves.filter((dwarf) => isAdult(dwarf, config));
  const successor = nemesis.grudgeHeroClanId
    ? adults.filter((dwarf) => String(dwarf.clanId || '') === nemesis.grudgeHeroClanId)
      .sort(compareHeroCandidates(config))[0]
    : null;
  if (successor) return { hero: successor, inheritedGrudge: true, branch: 'succession' };
  const championId = state.warriors && state.warriors.league && state.warriors.league.championId;
  const leagueChampion = findDwarf(state, championId);
  if (leagueChampion) return { hero: leagueChampion, inheritedGrudge: false, branch: 'champion' };
  const deepChampionId = state.underrealm && state.underrealm.combat
    && state.underrealm.combat.dwarfChampion && state.underrealm.combat.dwarfChampion.activeDwarfId;
  const deepChampion = findDwarf(state, deepChampionId);
  if (deepChampion) return { hero: deepChampion, inheritedGrudge: false, branch: 'deep_champion' };
  const hero = adults.sort(compareHeroCandidates(config))[0] || null;
  return { hero, inheritedGrudge: false, branch: hero ? 'chosen_defender' : 'hold_defense' };
}

function compareHeroCandidates(config) {
  return (left, right) => computeHeroScore(right, config) - computeHeroScore(left, config)
    || safeInt(left.spawnIndex, 0) - safeInt(right.spawnIndex, 0)
    || String(left.id).localeCompare(String(right.id));
}

function computeHeroScore(dwarf, config) {
  if (!dwarf) return 0;
  const warrior = ensureDwarfWarriorState(dwarf, config);
  return clamp(
    Number(warrior && warrior.rating || 0) * 0.4
    + Number(warrior && warrior.valor || 0) * 0.3
    + Number(warrior && warrior.heroPotential || 0) * 0.3,
    0,
    1,
  );
}

function computeSiegeDefense(state, config, heroScore, settings) {
  const adults = (state.dwarves || []).filter((dwarf) => isAdult(dwarf, config)).length;
  const structures = Array.isArray(state.structures) ? state.structures : [];
  const towers = structures.filter((entry) => entry && entry.type === 'watchtower' && !entry.siegeDamage).length;
  const armories = structures.filter((entry) => entry && entry.type === 'armory' && !entry.siegeDamage).length;
  const militia = Math.max(0, Number(state.externalCamps && state.externalCamps.modifiers
    && state.externalCamps.modifiers.raidDefenseBonus || 0));
  return clamp(
    Math.min(settings.adultDefenseCap, adults * settings.adultDefensePer)
    + towers * settings.watchtowerDefense
    + armories * settings.armoryDefense
    + heroScore * settings.heroDefenseWeight
    + militia,
    0,
    2,
  );
}

function computeNemesisThreat(state, nemesis, settings) {
  return clamp(
    settings.nemesisBasePower
    + Number(nemesis.power || 0) * settings.sourcePowerWeight
    + safeInt(nemesis.victories, 0) * settings.victoryPower
    + safeInt(state.cycleStats && state.cycleStats.count, 0) * settings.cyclePower,
    0,
    2,
  );
}

function resolveStageDuration(state, stage, settings) {
  const base = settings.stageTicks[stage] || 1;
  if (stage !== 'approach') return base;
  const roads = Array.isArray(state.roads && state.roads.segments) ? state.roads.segments.length
    : Array.isArray(state.roads) ? state.roads.length : 0;
  return Math.max(1, base - Math.min(settings.roadApproachReductionCap, roads * settings.roadApproachReduction));
}

function applySchismDelta(state, pressureDelta, legitimacyDelta) {
  const schism = state && state.schism;
  if (!schism || schism.enabled === false) return;
  schism.pressure = clamp(Number(schism.pressure || 0) + Number(pressureDelta || 0), 0, 1);
  schism.legitimacy = clamp(Number(schism.legitimacy || 0) + Number(legitimacyDelta || 0), 0, 1);
}

function findSourceCamp(state, nemesis) {
  const camps = Array.isArray(state.externalCamps && state.externalCamps.camps)
    ? state.externalCamps.camps : [];
  return camps.find((camp) => camp && camp.id === nemesis.sourceCampId)
    || camps.find((camp) => camp && camp.role === 'raider' && camp.factionId === nemesis.factionId)
    || null;
}

function findDwarf(state, id) {
  if (!id) return null;
  return (Array.isArray(state && state.dwarves) ? state.dwarves : [])
    .find((dwarf) => dwarf && String(dwarf.id) === String(id)) || null;
}

function heroLabel(hero, state, config) {
  if (!hero) return 'The hold';
  const identity = resolveDwarfIdentity(hero, state, config);
  return identity && identity.label ? identity.label : String(hero.id || 'The hold');
}

function resolveChampionPower(champion) {
  const stats = champion && champion.stats || {};
  return clamp((Number(stats.hp || 0) / 200 + Number(stats.attack || 0) / 40 + Number(stats.defense || 0) / 40) / 3, 0, 1);
}

function buildNemesisIdentity(sourceKind, sourceId, settings) {
  const hash = hashString(`${sourceKind}|${sourceId}`);
  const names = settings.identityNames;
  const epithets = settings.identityEpithets;
  const traits = settings.identityTraits;
  const goals = settings.identityGoals;
  return {
    name: names[hash % names.length],
    epithet: epithets[Math.floor(hash / 7) % epithets.length],
    traits: [
      traits[Math.floor(hash / 13) % traits.length],
      traits[Math.floor(hash / 29) % traits.length],
    ].filter((value, index, list) => list.indexOf(value) === index),
    goal: goals[Math.floor(hash / 47) % goals.length],
  };
}

function enforceNemesisCapacity(runtime, settings) {
  while (runtime.nemeses.order.length > settings.maxNemeses) {
    const candidates = runtime.nemeses.order
      .map((id, index) => ({ id, index, record: runtime.nemeses.byId[id] }))
      .filter((entry) => entry.record && (!runtime.activeSiege || runtime.activeSiege.nemesisId !== entry.id))
      .sort((left, right) => nemesisEvictionRank(left.record) - nemesisEvictionRank(right.record)
        || safeInt(left.record.lastSeenTick, 0) - safeInt(right.record.lastSeenTick, 0)
        || left.id.localeCompare(right.id));
    const selected = candidates[0];
    if (!selected) break;
    delete runtime.nemeses.byId[selected.id];
    runtime.nemeses.order.splice(runtime.nemeses.order.indexOf(selected.id), 1);
    runtime.stats.evicted += 1;
  }
}

function nemesisEvictionRank(record) {
  if (record.status === 'reconciled') return 0;
  if (record.status === 'defeated') return 1;
  if (record.status === 'dormant') return 2;
  return 3;
}

function normalizeNemesis(raw, settings) {
  if (!raw || typeof raw !== 'object') return null;
  const id = token(raw.id, 96);
  if (!id) return null;
  const encounters = normalizeEncounters(raw.encounters, settings.maxEncounters);
  return {
    id,
    sagaId: token(raw.sagaId || `saga_${id}`, 96),
    sourceKind: token(raw.sourceKind, 32) || 'legacy_nemesis',
    sourceId: token(raw.sourceId, 64) || id,
    sourceDepth: safeInt(raw.sourceDepth, 0),
    sourceCampId: token(raw.sourceCampId, 96) || null,
    factionId: token(raw.factionId, 64) || 'unknown_faction',
    factionLabel: text(raw.factionLabel, 96) || 'Unknown Faction',
    name: text(raw.name, 64) || 'Nameless',
    epithet: text(raw.epithet, 96) || 'the Remembered',
    displayName: text(raw.displayName, 128) || `${text(raw.name, 64) || 'Nameless'} ${text(raw.epithet, 96) || 'the Remembered'}`,
    traits: uniqueText(raw.traits, 4, 48),
    goal: text(raw.goal, 128) || 'seeks dominion over the hold',
    titles: uniqueText(raw.titles, 4, 96),
    scars: uniqueText(raw.scars, settings.maxScars, 96),
    grudges: uniqueText(raw.grudges, settings.maxGrudges, 96),
    encounters,
    victories: safeInt(raw.victories, 0),
    defeats: safeInt(raw.defeats, 0),
    retreats: safeInt(raw.retreats, 0),
    status: ['active', 'dormant', 'defeated', 'reconciled'].includes(raw.status) ? raw.status : 'dormant',
    promotedCycle: safeInt(raw.promotedCycle, 0),
    promotedTick: safeInt(raw.promotedTick, 0),
    lastSeenTick: safeInt(raw.lastSeenTick, 0),
    lastSiegeTick: safeInt(raw.lastSiegeTick, 0),
    lastEventId: raw.lastEventId ? String(raw.lastEventId) : null,
    grudgeHeroId: raw.grudgeHeroId ? String(raw.grudgeHeroId) : null,
    grudgeHeroClanId: raw.grudgeHeroClanId ? String(raw.grudgeHeroClanId) : null,
    sourceOutcomeTick: safeInt(raw.sourceOutcomeTick, 0),
    sourceVictories: safeInt(raw.sourceVictories, 0),
    sourceDefeats: safeInt(raw.sourceDefeats, 0),
    sourceRetreats: safeInt(raw.sourceRetreats, 0),
    power: clamp(Number(raw.power || 0), 0, 2),
    location: normalizeLocation(raw.location),
    restoredFromLegacy: raw.restoredFromLegacy === true,
    reappearancePending: raw.reappearancePending === true,
  };
}

function normalizeSiege(raw, settings) {
  if (!raw || typeof raw !== 'object' || !token(raw.id, 96) || !token(raw.nemesisId, 96)) return null;
  const stage = SIEGE_STAGES.includes(raw.stage) ? raw.stage : 'warning';
  return {
    id: token(raw.id, 96), nemesisId: token(raw.nemesisId, 96), sourceCampId: token(raw.sourceCampId, 96) || null,
    stage, stageTicksRemaining: Math.min(settings.stageTicks[stage], Math.max(0, safeInt(raw.stageTicksRemaining, 0))),
    startedTick: safeInt(raw.startedTick, 0), lastStageTick: safeInt(raw.lastStageTick, 0),
    heroId: raw.heroId ? String(raw.heroId) : null, inheritedGrudge: raw.inheritedGrudge === true,
    location: normalizeLocation(raw.location) || { scope: 'world' }, parentEventId: raw.parentEventId ? String(raw.parentEventId) : null,
    outcome: raw.outcome ? token(raw.outcome, 48) : null, branch: raw.branch ? token(raw.branch, 48) : null,
    defenseScore: Math.max(0, Number(raw.defenseScore || 0)), threatScore: Math.max(0, Number(raw.threatScore || 0)),
    damagedStructureIds: uniqueText(raw.damagedStructureIds, settings.maxDamagedStructures, 96),
    injuredDwarfIds: uniqueText(raw.injuredDwarfIds, settings.maxInjuries, 96),
    resourceLosses: normalizeAmountMap(raw.resourceLosses),
    stages: uniqueText(raw.stages, SIEGE_STAGES.length, 32).filter((entry) => SIEGE_STAGES.includes(entry)),
  };
}

function normalizeEncounters(raw, limit) {
  return (Array.isArray(raw) ? raw : []).slice(-limit).map((entry, index) => ({
    id: token(entry && entry.id, 128) || `legacy_encounter_${index}`,
    cycle: safeInt(entry && entry.cycle, 0), tick: safeInt(entry && entry.tick, 0),
    heroId: entry && entry.heroId ? String(entry.heroId) : null,
    heroClanId: entry && entry.heroClanId ? String(entry.heroClanId) : null,
    outcome: token(entry && entry.outcome, 48) || 'unknown', branch: token(entry && entry.branch, 48) || 'mainline',
    sourceEventId: entry && entry.sourceEventId ? String(entry.sourceEventId) : null,
  }));
}

function normalizeHistory(raw, limit) {
  return (Array.isArray(raw) ? raw : []).slice(-limit).filter((entry) => entry && entry.id).map((entry) => ({
    id: token(entry.id, 96), nemesisId: token(entry.nemesisId, 96), heroId: entry.heroId ? String(entry.heroId) : null,
    cycle: safeInt(entry.cycle, 0), startedTick: safeInt(entry.startedTick, 0), completedTick: safeInt(entry.completedTick, 0),
    outcome: token(entry.outcome, 48) || 'unknown', branch: token(entry.branch, 48) || 'mainline',
    stages: uniqueText(entry.stages, SIEGE_STAGES.length, 32).filter((stage) => SIEGE_STAGES.includes(stage)),
    sourceEventId: entry.sourceEventId ? String(entry.sourceEventId) : null,
  }));
}

// Normalize all config-driven E7 tuning with absolute safety ceilings.
function getEpicConflictSettings(config) {
  const raw = config && config.epic_conflicts || {};
  const nemeses = raw.nemeses || {};
  const promotion = nemeses.promotion || {};
  const identity = nemeses.identity || {};
  const siege = raw.siege || {};
  const trigger = siege.trigger || {};
  const stages = siege.stage_ticks || {};
  const battle = siege.battle || {};
  const guardrails = siege.guardrails || {};
  const recovery = siege.recovery || {};
  const rivalry = raw.rivalry || {};
  const politics = siege.politics || {};
  return {
    enabled: raw.enabled !== false,
    maxNemeses: clampInt(nemeses.max_active, 1, 32, 8),
    maxEncounters: clampInt(nemeses.max_encounters_per_nemesis, 1, 32, 8),
    maxGrudges: clampInt(nemeses.max_grudges_per_nemesis, 1, 8, 4),
    maxScars: clampInt(nemeses.max_scars_per_nemesis, 1, 8, 4),
    promotionCheckInterval: clampInt(promotion.check_interval_ticks, 1, 1000, 20),
    raiderPromotionHostility: clamp(Number(promotion.raider_min_hostility ?? 0.55), 0, 1),
    raiderPromotionDemands: clampInt(promotion.raider_min_demands, 0, 20, 2),
    underrealmPromotionAttempts: clampInt(promotion.underrealm_min_attempts, 1, 20, 1),
    identityNames: normalizePool(identity.names, ['Vark', 'Skarn', 'Morgul', 'Thraxx']),
    identityEpithets: normalizePool(identity.epithets, ['the Ashen', 'the Gatebreaker', 'the Deep-Crowned', 'the Oath-Eater']),
    identityTraits: normalizePool(identity.traits, ['patient', 'ruthless', 'cunning', 'unyielding']),
    identityGoals: normalizePool(identity.goals, ['seeks dominion over the hold', 'hunts the Warrior Company', 'covets the deep roads', 'would break the ancestor oaths']),
    siegeEnabled: siege.enabled !== false,
    siegeMinTick: clampInt(siege.min_tick, 0, 1000000, 1800),
    siegeCooldownTicks: clampInt(siege.cooldown_ticks, 0, 1000000, 2200),
    recoveryTicks: clampInt(siege.recovery_ticks, 1, 100000, 600),
    minPopulation: clampInt(siege.min_population, 1, 10000, 24),
    maxHistory: clampInt(siege.max_history, 1, 64, 16),
    stageTicks: Object.fromEntries(SIEGE_STAGES.map((stage) => [stage, clampInt(stages[stage], 1, 10000, 60)])),
    siegeTriggerHostility: clamp(Number(trigger.raider_min_hostility ?? 0.68), 0, 1),
    siegeTriggerDemands: clampInt(trigger.raider_min_demands, 0, 100, 10),
    collapsePopulationFloor: clampInt(guardrails.collapse_population_floor, 1, 10000, 18),
    collapseStockpileRatio: clamp(Number(guardrails.collapse_stockpile_ratio ?? 0.2), 0, 1),
    maxInjuries: clampInt(guardrails.max_injuries, 0, 12, 3),
    maxResourceLossRatio: clamp(Number(guardrails.max_resource_loss_ratio ?? 0.03), 0, 0.25),
    maxDamagedStructures: clampInt(guardrails.max_damaged_structures, 0, 8, 2),
    resourceReserveRatio: clamp(Number(guardrails.resource_reserve_ratio ?? 0.25), 0, 1),
    structureDamageSeverity: clampInt(battle.structure_damage_severity, 1, 8, 2),
    injuryRecoveryTicks: clampInt(battle.injury_recovery_ticks, 1, 10000, 180),
    injuryStressGain: clamp(Number(battle.injury_stress_gain ?? 0.12), 0, 1),
    injuryGapScale: Math.max(0, Number(battle.injury_gap_scale ?? 8)),
    resourceLossBase: clamp(Number(battle.resource_loss_base ?? 0.01), 0, 0.25),
    resourceLossGapScale: Math.max(0, Number(battle.resource_loss_gap_scale ?? 0.05)),
    lossResources: normalizePool(battle.loss_resources, ['food', 'wood', 'stone', 'beer', 'iron']),
    adultDefensePer: Math.max(0, Number(battle.adult_defense_per ?? 0.012)),
    adultDefenseCap: clamp(Number(battle.adult_defense_cap ?? 0.45), 0, 2),
    watchtowerDefense: Math.max(0, Number(battle.watchtower_defense ?? 0.08)),
    armoryDefense: Math.max(0, Number(battle.armory_defense ?? 0.04)),
    heroDefenseWeight: Math.max(0, Number(battle.hero_defense_weight ?? 0.22)),
    nemesisBasePower: Math.max(0, Number(battle.nemesis_base_power ?? 0.34)),
    sourcePowerWeight: Math.max(0, Number(battle.source_power_weight ?? 0.36)),
    victoryPower: Math.max(0, Number(battle.victory_power ?? 0.04)),
    cyclePower: Math.max(0, Number(battle.cycle_power ?? 0.015)),
    roadApproachReduction: clampInt(siege.road_approach_reduction_per_segment, 0, 100, 1),
    roadApproachReductionCap: clampInt(siege.road_approach_reduction_cap, 0, 10000, 25),
    repairIntervalTicks: clampInt(recovery.repair_interval_ticks, 1, 10000, 120),
    tributeCosts: normalizeAmountMap(siege.tribute_costs || { wood: 12, stone: 8, beer: 6 }),
    rescueMinHeroScore: clamp(Number(rivalry.rescue_min_hero_score ?? 0.62), 0, 1),
    rescueDefenseBonus: Math.max(0, Number(rivalry.rescue_defense_bonus ?? 0.16)),
    reconciliationHostilityMax: clamp(Number(rivalry.reconciliation_hostility_max ?? 0.28), 0, 1),
    politics: {
      warningPressure: clamp(Number(politics.warning_pressure_gain ?? 0.01), 0, 1),
      defeatPressureGain: clamp(Number(politics.defeat_pressure_gain ?? 0.04), 0, 1),
      defeatLegitimacyLoss: clamp(Number(politics.defeat_legitimacy_loss ?? 0.025), 0, 1),
      victoryPressureRelief: clamp(Number(politics.victory_pressure_relief ?? 0.02), 0, 1),
      victoryLegitimacyGain: clamp(Number(politics.victory_legitimacy_gain ?? 0.015), 0, 1),
    },
  };
}

function configTarget(state, resource) {
  return state && state.lastConfig && state.lastConfig.resources
    && state.lastConfig.resources.targets && state.lastConfig.resources.targets[resource];
}

function structureDamageRank(type) {
  const order = ['landmark_gate_fortress', 'watchtower', 'armory', 'workshop', 'mine', 'well', 'field'];
  return order.indexOf(type) >= 0 ? order.indexOf(type) : 99;
}

function normalizeLocation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const scope = raw.scope === 'underrealm' ? 'underrealm' : raw.scope === 'surface' ? 'surface' : 'world';
  const result = { scope };
  if (scope !== 'world') {
    if (Number.isSafeInteger(Number(raw.depth)) && Number(raw.depth) >= 0) result.depth = Number(raw.depth);
    if (Number.isSafeInteger(Number(raw.x)) && Number(raw.x) >= 0) result.x = Number(raw.x);
    if (Number.isSafeInteger(Number(raw.y)) && Number(raw.y) >= 0) result.y = Number(raw.y);
    if (raw.placeId) result.placeId = String(raw.placeId);
    if (raw.label) result.label = text(raw.label, 96);
  }
  return result;
}

function normalizePool(raw, fallback) {
  const pool = uniqueText(raw, 64, 128);
  return pool.length > 0 ? pool : fallback.slice();
}

function normalizeAmountMap(raw) {
  const result = {};
  for (const [key, value] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    const amount = Math.max(0, Math.floor(Number(value || 0)));
    if (key && amount > 0) result[key] = amount;
  }
  return result;
}

function appendUnique(list, value, limit) {
  if (!value || list.includes(value)) return;
  list.push(value);
  if (list.length > limit) list.splice(0, list.length - limit);
}

function uniqueText(raw, limit, maxChars) {
  return [...new Set((Array.isArray(raw) ? raw : []).map((value) => text(value, maxChars)).filter(Boolean))].slice(-limit);
}

function text(value, maxChars) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxChars);
}

function token(value, maxChars) {
  return text(value, maxChars).toLowerCase().replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
}

function safeInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

module.exports = {
  EPIC_CONFLICT_SCHEMA_VERSION,
  SIEGE_STAGES,
  createEpicConflictState,
  ensureEpicConflictState,
  updateEpicConflicts,
  promoteNemesis,
  startSiege,
  restoreLegacyNemeses,
  getEpicConflictSettings,
  getEpicConflictStatus,
  getDwarfNemesisMemory,
};
