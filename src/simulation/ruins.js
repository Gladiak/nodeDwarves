'use strict';

const { clamp } = require('../utils');
const { getStockpileRatio, hasInputs, consumeInputs } = require('./resources');
const { pushEvent } = require('./events');
const { isAdult } = require('./population');

function updateRuins(state, config, runtime) {
  const ruinsConfig = (config && config.ruins) || {};
  if (ruinsConfig.enabled === false) {
    return;
  }
  if (!state.ruins) {
    state.ruins = createDefaultRuinsState(ruinsConfig);
  }
  const ruins = state.ruins;
  if (!ruins.bonuses) {
    recomputeBonuses(state, ruinsConfig);
  }
  if (!ruins.stats) {
    ruins.stats = { started: 0, successes: 0, failures: 0, artifacts: 0 };
  }
  if (!ruins.artifactsFound) {
    ruins.artifactsFound = {};
  }
  if (!Array.isArray(ruins.expeditions)) {
    ruins.expeditions = [];
  }
  if (ruins.expedition) {
    if (ruins.expedition.active) {
      ruins.expeditions.push(ruins.expedition);
    }
    ruins.expedition = null;
  }
  ruins.expeditions = ruins.expeditions.filter((expedition) => expedition && expedition.active !== false);
  const rooms = Array.isArray(ruinsConfig.rooms) ? ruinsConfig.rooms : [];
  ruins.roomCount = rooms.length;
  if (rooms.length === 0) {
    return;
  }

  const hadActive = ruins.expeditions.length > 0;
  if (hadActive) {
    tickExpeditions(state, config, ruinsConfig, rooms);
  }

  const ignoreCooldown = shouldIgnoreCooldown(ruins, ruinsConfig, rooms);
  if (hadActive && !ignoreCooldown) {
    return;
  }

  if (ruins.cooldown > 0) {
    ruins.cooldown = Math.max(0, Number(ruins.cooldown || 0) - 1);
  }

  if (!ignoreCooldown && ruins.cooldown > 0) {
    return;
  }

  const maxConcurrent = resolveMaxConcurrent(ruins, ruinsConfig, rooms);
  let activeCount = ruins.expeditions.length;
  if (activeCount >= maxConcurrent) {
    return;
  }

  while (activeCount < maxConcurrent) {
    if (!canStartExpedition(state, config, ruinsConfig, rooms)) {
      return;
    }
    startExpedition(state, config, ruinsConfig, rooms);
    activeCount += 1;
  }
}

function createDefaultRuinsState(ruinsConfig) {
  const rooms = Array.isArray(ruinsConfig.rooms) ? ruinsConfig.rooms : [];
  return {
    enabled: true,
    roomsCleared: 0,
    roomCount: rooms.length,
    expeditions: [],
    cooldown: 0,
    artifactsFound: {},
    setCounts: {},
    bonuses: {
      outputMultiplier: 0,
      hazardReduction: 0,
      combatBonus: 0,
      artifactChanceBonus: 0,
      casualtyReduction: 0,
      activeCombos: [],
    },
    stats: {
      started: 0,
      successes: 0,
      failures: 0,
      artifacts: 0,
    },
  };
}

function canStartExpedition(state, config, ruinsConfig, rooms) {
  const expeditionConfig = ruinsConfig.expedition || {};
  if (!hasStructure(state, 'ruins')) {
    return false;
  }
  if (state.ruins.roomsCleared >= rooms.length && allArtifactsFound(ruinsConfig, state.ruins)) {
    return false;
  }
  if (expeditionConfig.requiresArmory && !hasStructure(state, 'armory')) {
    return false;
  }
  const kitResource = expeditionConfig.kitResource || 'expedition_kit';
  if (Number(state.stockpile[kitResource] || 0) < 1) {
    return false;
  }
  const minPopulation = Math.max(0, Number(expeditionConfig.minPopulation || 0));
  if (minPopulation > 0 && state.dwarves.length < minPopulation) {
    return false;
  }
  const idleAdults = getIdleAdults(state, config);
  const minIdle = Math.max(0, Number(expeditionConfig.minIdleAdults || 0));
  if (minIdle > 0 && idleAdults.length < minIdle) {
    return false;
  }
  const minRatios = expeditionConfig.minStockpileRatio || {};
  for (const [resource, ratioRaw] of Object.entries(minRatios)) {
    const minRatio = clamp(Number(ratioRaw || 0), 0, 1);
    if (minRatio <= 0) {
      continue;
    }
    const ratio = getStockpileRatio(state, config, resource);
    if (ratio < minRatio) {
      return false;
    }
  }

  const roomIndex = Math.max(0, Math.min(rooms.length - 1, Number(state.ruins.roomsCleared || 0)));
  const room = rooms[roomIndex];
  if (!room) {
    return false;
  }
  const cost = room.cost || {};
  if (Object.keys(cost).length > 0 && !hasInputs(state.stockpile, cost)) {
    return false;
  }

  const partySize = resolvePartySize(room, expeditionConfig, idleAdults.length);
  if (partySize <= 0) {
    return false;
  }

  return true;
}

function startExpedition(state, config, ruinsConfig, rooms) {
  const expeditionConfig = ruinsConfig.expedition || {};
  const kitResource = expeditionConfig.kitResource || 'expedition_kit';
  const roomIndex = Math.max(0, Math.min(rooms.length - 1, Number(state.ruins.roomsCleared || 0)));
  const room = rooms[roomIndex];
  if (!room) {
    return;
  }

  const idleAdults = getIdleAdults(state, config);
  const partySize = resolvePartySize(room, expeditionConfig, idleAdults.length);
  if (partySize <= 0) {
    return;
  }

  const cost = room.cost || {};
  if (Object.keys(cost).length > 0) {
    if (!hasInputs(state.stockpile, cost)) {
      return;
    }
    consumeInputs(state.stockpile, cost);
  }

  if (Number(state.stockpile[kitResource] || 0) < 1) {
    return;
  }
  state.stockpile[kitResource] = Number(state.stockpile[kitResource] || 0) - 1;

  let useMithril = false;
  const mithrilConfig = ruinsConfig.mithrilReinforcement || {};
  if (mithrilConfig.enabled) {
    const minRoom = Math.max(1, Number(mithrilConfig.minRoom || 1));
    if (roomIndex + 1 >= minRoom) {
      const costMithril = mithrilConfig.cost || {};
      if (Object.keys(costMithril).length > 0 && hasInputs(state.stockpile, costMithril)) {
        consumeInputs(state.stockpile, costMithril);
        useMithril = true;
      }
    }
  }

  const selected = idleAdults.slice(0, partySize);
  const dwarfIds = selected.map((dwarf) => dwarf.id);
  for (const dwarf of selected) {
    dwarf.expedition = true;
  }

  const ticks = Math.max(1, Number(room.expeditionTicks || 1));
  const expedition = {
    active: true,
    roomIndex,
    ticksRemaining: ticks,
    dwarfIds,
    useMithril,
  };
  state.ruins.expeditions = Array.isArray(state.ruins.expeditions) ? state.ruins.expeditions : [];
  state.ruins.expeditions.push(expedition);
  state.ruins.stats.started = Number(state.ruins.stats.started || 0) + 1;
  pushEvent(state, config, `Ruins: expedition started (Room ${roomIndex + 1})`);
}

function tickExpeditions(state, config, ruinsConfig, rooms) {
  const expeditions = Array.isArray(state.ruins.expeditions) ? state.ruins.expeditions : [];
  if (expeditions.length === 0) {
    return;
  }
  const active = [];
  for (const expedition of expeditions) {
    if (!expedition || expedition.active === false) {
      continue;
    }
    expedition.ticksRemaining = Number(expedition.ticksRemaining || 0) - 1;
    if (expedition.ticksRemaining > 0) {
      active.push(expedition);
      continue;
    }
    resolveExpedition(state, config, ruinsConfig, rooms, expedition);
  }
  state.ruins.expeditions = active;
}

function resolveExpedition(state, config, ruinsConfig, rooms, expedition) {
  const room = rooms[expedition.roomIndex];
  if (!room) {
    finishExpedition(state, config, ruinsConfig, expedition, false, 'room missing');
    return;
  }

  const bonuses = state.ruins.bonuses || {};
  const hazardReduction = clamp(Number(bonuses.hazardReduction || 0), 0, 0.95);
  const hazardChance = clamp(Number(room.hazardChance || 0), 0, 1) * (1 - hazardReduction);

  let guardianSpawned = false;
  let guardianDefeated = false;
  const guardianChance = clamp(Number(room.guardianChance || 0), 0, 1);
  if (guardianChance > 0 && Math.random() < guardianChance) {
    guardianSpawned = true;
    const guardianPower = Math.max(0, Number(room.guardianPower || 0));
    const partySize = getExpeditionPartySize(state, expedition);
    const kitPowerBonus = Math.max(0, Number((ruinsConfig.expedition || {}).kitPowerBonus || 0));
    const mithrilPowerBonus = expedition.useMithril
      ? Math.max(0, Number((ruinsConfig.mithrilReinforcement || {}).powerBonus || 0))
      : 0;
    const combatBonus = Math.max(0, Number(bonuses.combatBonus || 0));
    const power = partySize * (1 + kitPowerBonus + mithrilPowerBonus + combatBonus);
    if (power >= guardianPower) {
      guardianDefeated = true;
    }
  }

  if (guardianSpawned && !guardianDefeated) {
    finishExpedition(state, config, ruinsConfig, expedition, false, 'guardian');
    return;
  }

  if (hazardChance > 0 && Math.random() < hazardChance) {
    finishExpedition(state, config, ruinsConfig, expedition, false, 'hazard');
    return;
  }

  finishExpedition(state, config, ruinsConfig, expedition, true, guardianDefeated ? 'guardian' : 'clear');
}

function finishExpedition(state, config, ruinsConfig, expedition, success, reason) {
  const roomIndex = expedition.roomIndex;
  const room = Array.isArray(ruinsConfig.rooms) ? ruinsConfig.rooms[roomIndex] : null;

  if (success) {
    state.ruins.roomsCleared = Math.max(state.ruins.roomsCleared, roomIndex + 1);
    state.ruins.stats.successes = Number(state.ruins.stats.successes || 0) + 1;
    pushEvent(state, config, `Ruins: room ${roomIndex + 1} cleared`);

    if (room) {
      const baseChance = clamp(Number(room.artifactChance || 0), 0, 1);
      const guardianBonus = reason === 'guardian'
        ? Math.max(0, Number((ruinsConfig.guardians || {}).artifactBonus || 0))
        : 0;
      const bonusChance = Math.max(0, Number((state.ruins.bonuses || {}).artifactChanceBonus || 0));
      const totalChance = clamp(baseChance + guardianBonus + bonusChance, 0, 1);
      const rolls = Math.max(1, Math.floor(Number(room.artifactRolls || 1)));
      let foundAny = false;
      for (let roll = 0; roll < rolls; roll += 1) {
        if (Math.random() >= totalChance) {
          continue;
        }
        const artifactId = pickArtifact(ruinsConfig, state.ruins);
        if (!artifactId) {
          continue;
        }
        state.ruins.artifactsFound[artifactId] = true;
        state.ruins.stats.artifacts = Number(state.ruins.stats.artifacts || 0) + 1;
        foundAny = true;
        const artifactName = getArtifactName(ruinsConfig, artifactId);
        pushEvent(state, config, `Ruins: artifact found - ${artifactName}`);
      }
      if (foundAny) {
        recomputeBonuses(state, ruinsConfig);
      }
    }
  } else {
    state.ruins.stats.failures = Number(state.ruins.stats.failures || 0) + 1;
    const losses = resolveExpeditionLosses(state, ruinsConfig, expedition);
    if (losses > 0) {
      pushEvent(state, config, `Ruins: expedition failed (${losses} fallen)`);
    } else {
      pushEvent(state, config, 'Ruins: expedition failed');
    }
  }

  releaseExpeditioners(state, expedition);

  if (success) {
    const cooldownTicks = Math.max(0, Number((ruinsConfig.expedition || {}).cooldownTicks || 0));
    state.ruins.cooldown = cooldownTicks;
  } else {
    const cooldownTicks = Math.max(0, Number((ruinsConfig.expedition || {}).failureCooldownTicks || 0));
    state.ruins.cooldown = cooldownTicks;
  }

}

function resolveExpeditionLosses(state, ruinsConfig, expedition) {
  const expeditionConfig = ruinsConfig.expedition || {};
  const minLoss = Math.max(0, Math.floor(Number(expeditionConfig.failureLossMin || 0)));
  const maxLoss = Math.max(minLoss, Math.floor(Number(expeditionConfig.failureLossMax || minLoss)));
  const aliveIds = getExpeditionAliveIds(state, expedition);
  const partySize = aliveIds.length;
  if (partySize <= 0 || maxLoss <= 0) {
    return 0;
  }
  const baseLoss = Math.min(partySize, randomInt(minLoss, maxLoss));
  const reduction = clamp(Number((state.ruins.bonuses || {}).casualtyReduction || 0), 0, 0.9);
  const lossCount = Math.min(partySize, Math.max(0, Math.round(baseLoss * (1 - reduction))));
  if (lossCount <= 0) {
    return 0;
  }
  const candidates = aliveIds.slice();
  shuffleInPlace(candidates);
  const deadIds = new Set(candidates.slice(0, lossCount));
  applyExpeditionDeaths(state, deadIds);
  return deadIds.size;
}

function applyExpeditionDeaths(state, deadIds) {
  if (!deadIds || deadIds.size === 0) {
    return;
  }
  state.deathsCount = Number(state.deathsCount || 0) + deadIds.size;
  state.lastDeathTick = Number(state.tick || 0);
  state.deathsByCause = state.deathsByCause || {};
  state.deathsByCause.ruins = Number(state.deathsByCause.ruins || 0) + deadIds.size;
  state.dwarves = state.dwarves.filter((dwarf) => !deadIds.has(dwarf.id));
  state.jobs = state.jobs.filter((job) => !deadIds.has(job.dwarfId));

  for (const dwarf of state.dwarves) {
    if (dwarf.partnerId && deadIds.has(dwarf.partnerId)) {
      dwarf.partnerId = null;
      dwarf.bondTargetId = null;
      dwarf.bondScore = 0;
    }
    if (dwarf.pregnancy && deadIds.has(dwarf.pregnancy.partnerId)) {
      dwarf.pregnancy = null;
    }
  }
}

function releaseExpeditioners(state, expedition) {
  const ids = expedition && expedition.dwarfIds ? expedition.dwarfIds : [];
  if (!Array.isArray(ids) || ids.length === 0) {
    return;
  }
  const idSet = new Set(ids);
  for (const dwarf of state.dwarves) {
    if (idSet.has(dwarf.id)) {
      dwarf.expedition = false;
    }
  }
}

function recomputeBonuses(state, ruinsConfig) {
  const artifactPool = (ruinsConfig.artifacts && ruinsConfig.artifacts.pool) || {};
  const found = state.ruins.artifactsFound || {};
  const setCounts = {};
  for (const [artifactId, isFound] of Object.entries(found)) {
    if (!isFound) {
      continue;
    }
    const def = artifactPool[artifactId];
    if (!def || !def.set) {
      continue;
    }
    setCounts[def.set] = Number(setCounts[def.set] || 0) + 1;
  }
  state.ruins.setCounts = setCounts;

  const bonuses = {
    outputMultiplier: 0,
    hazardReduction: 0,
    combatBonus: 0,
    artifactChanceBonus: 0,
    casualtyReduction: 0,
    activeCombos: [],
  };

  const setBonuses = ruinsConfig.setBonuses || {};
  for (const [setId, thresholds] of Object.entries(setBonuses)) {
    const count = Number(setCounts[setId] || 0);
    for (const [thresholdRaw, bonus] of Object.entries(thresholds || {})) {
      const threshold = Number(thresholdRaw || 0);
      if (!Number.isFinite(threshold) || threshold <= 0) {
        continue;
      }
      if (count >= threshold) {
        applyBonus(bonuses, bonus);
      }
    }
  }

  const comboBonuses = Array.isArray(ruinsConfig.comboBonuses) ? ruinsConfig.comboBonuses : [];
  for (const combo of comboBonuses) {
    if (!combo || typeof combo !== 'object') {
      continue;
    }
    if (!meetsComboRequirements(combo.requires || {}, setCounts)) {
      continue;
    }
    applyBonus(bonuses, combo.bonus || {});
    const label = combo.label || combo.id;
    if (label) {
      bonuses.activeCombos.push(label);
    }
  }

  state.ruins.bonuses = bonuses;
}

function applyBonus(target, bonus) {
  if (!bonus || typeof bonus !== 'object') {
    return;
  }
  for (const [key, value] of Object.entries(bonus)) {
    if (key === 'activeCombos') {
      continue;
    }
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) {
      continue;
    }
    target[key] = Number(target[key] || 0) + numeric;
  }
}

function meetsComboRequirements(requires, setCounts) {
  for (const [setId, neededRaw] of Object.entries(requires || {})) {
    const needed = Math.max(0, Number(neededRaw || 0));
    const current = Math.max(0, Number(setCounts[setId] || 0));
    if (current < needed) {
      return false;
    }
  }
  return true;
}

function pickArtifact(ruinsConfig, ruinsState) {
  const pool = (ruinsConfig.artifacts && ruinsConfig.artifacts.pool) || {};
  const found = ruinsState.artifactsFound || {};
  const options = [];
  let totalWeight = 0;
  for (const [id, def] of Object.entries(pool)) {
    if (found[id]) {
      continue;
    }
    const weight = Math.max(0, Number(def && def.weight !== undefined ? def.weight : 1));
    if (weight <= 0) {
      continue;
    }
    totalWeight += weight;
    options.push({ id, weight });
  }
  if (totalWeight <= 0 || options.length === 0) {
    return null;
  }
  let roll = Math.random() * totalWeight;
  for (const option of options) {
    if (roll < option.weight) {
      return option.id;
    }
    roll -= option.weight;
  }
  return options[options.length - 1].id;
}

function getArtifactName(ruinsConfig, artifactId) {
  const pool = (ruinsConfig.artifacts && ruinsConfig.artifacts.pool) || {};
  const def = pool[artifactId] || {};
  return def.name || artifactId;
}

function resolvePartySize(room, expeditionConfig, idleCount) {
  const minSize = Math.max(1, Math.floor(Number(expeditionConfig.partySizeMin || 1)));
  const maxSize = Math.max(minSize, Math.floor(Number(expeditionConfig.partySizeMax || minSize)));
  const desired = Math.max(minSize, Math.floor(Number(room.partySize || minSize)));
  const clamped = Math.max(minSize, Math.min(maxSize, desired));
  if (idleCount < minSize) {
    return 0;
  }
  return Math.min(clamped, idleCount);
}

function getIdleAdults(state, config) {
  return state.dwarves.filter((dwarf) => (
    !dwarf.job
    && !dwarf.expedition
    && isAdult(dwarf, config)
  ));
}

function hasStructure(state, type) {
  return (state.structures || []).some((structure) => structure.type === type);
}

function allArtifactsFound(ruinsConfig, ruinsState) {
  const pool = (ruinsConfig.artifacts && ruinsConfig.artifacts.pool) || {};
  const entries = Object.keys(pool);
  if (entries.length === 0) {
    return true;
  }
  const found = ruinsState.artifactsFound || {};
  for (const id of entries) {
    if (!found[id]) {
      return false;
    }
  }
  return true;
}

// Decide whether repeatable expeditions bypass cooldown gating.
function shouldIgnoreCooldown(ruins, ruinsConfig, rooms) {
  const cleared = Math.max(0, Number(ruins.roomsCleared || 0));
  if (cleared < rooms.length) {
    return false;
  }
  return !allArtifactsFound(ruinsConfig, ruins);
}

// Resolve concurrent expedition limit once the final room is repeatable.
function resolveMaxConcurrent(ruins, ruinsConfig, rooms) {
  const expeditionConfig = ruinsConfig.expedition || {};
  const cleared = Math.max(0, Number(ruins.roomsCleared || 0));
  if (cleared < rooms.length || allArtifactsFound(ruinsConfig, ruins)) {
    return 1;
  }
  const raw = Number(expeditionConfig.maxConcurrentAfterClear || 1);
  if (!Number.isFinite(raw)) {
    return 1;
  }
  return Math.max(1, Math.floor(raw));
}

function getExpeditionAliveIds(state, expedition) {
  const ids = expedition && Array.isArray(expedition.dwarfIds) ? expedition.dwarfIds : [];
  if (ids.length === 0) {
    return [];
  }
  const alive = new Set((state.dwarves || []).map((dwarf) => dwarf.id));
  return ids.filter((id) => alive.has(id));
}

function getExpeditionPartySize(state, expedition) {
  return getExpeditionAliveIds(state, expedition).length;
}

function randomInt(min, max) {
  if (max <= min) {
    return min;
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffleInPlace(values) {
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = values[i];
    values[i] = values[j];
    values[j] = temp;
  }
}

module.exports = { updateRuins, recomputeBonuses };
