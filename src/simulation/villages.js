"use strict";

const { clamp } = require("../utils");
const { getStockpileRatio } = require("./resources");
const { pushEvent } = require("./events");
const { getVillageCenter, selectVillageCenter } = require("./structures");

function getVillagesConfig(config) {
  const raw = (config && config.villages) || {};
  const populationThresholds = Array.isArray(raw.populationThresholds)
    ? raw.populationThresholds
        .map((value) => Math.max(0, Math.floor(Number(value ?? 0))))
        .filter((value) => Number.isFinite(value) && value > 0)
    : [];
  const trigger = raw.trigger || {};
  const triggerResources =
    Array.isArray(trigger.resources) && trigger.resources.length > 0
      ? trigger.resources.map((value) => String(value))
      : ["food", "water"];
  const triggerRatio = clamp(Number(trigger.ratioBelow ?? 0.4), 0, 1);
  const triggerTicks = Math.max(
    1,
    Math.floor(Number(trigger.ticks ?? 200)),
  );
  const maxCount = Math.max(1, Math.floor(Number(raw.maxCount ?? 3)));
  const founderCount = Math.max(0, Math.floor(Number(raw.founderCount ?? 8)));
  const minDistanceBetween = Math.max(
    0,
    Math.floor(Number(raw.minDistanceBetween ?? 20)),
  );
  const requiredResources =
    Array.isArray(raw.requiredResources) && raw.requiredResources.length > 0
      ? raw.requiredResources.map((value) => String(value))
      : triggerResources;
  const requiredResourceDistance = Math.max(
    0,
    Math.floor(Number(raw.requiredResourceDistance ?? 12)),
  );

  return {
    enabled: raw.enabled !== false,
    maxCount,
    founderCount,
    populationThresholds,
    triggerResources,
    triggerRatio,
    triggerTicks,
    minDistanceBetween,
    requiredResources,
    requiredResourceDistance,
  };
}

function ensureVillageState(state, runtime, config) {
  if (!state) {
    return;
  }
  if (!Array.isArray(state.villages) || state.villages.length === 0) {
    const center = getVillageCenter(state, runtime);
    state.villages = [
      {
        id: 1,
        center: { x: center.x, y: center.y },
        foundedTick: Math.max(0, Number(state.tick || 0)),
        founders: 0,
      },
    ];
    state.villageCounter = 1;
  }
  if (!state.villageStats) {
    state.villageStats = {
      lowResourceTicks: 0,
      lastFoundedTick: Math.max(0, Number(state.tick || 0)),
    };
  }
  state.lastConfig = config;
}

function updateVillages(state, config, runtime) {
  if (!state || !config || !runtime) {
    return;
  }
  const villagesConfig = getVillagesConfig(config);
  ensureVillageState(state, runtime, config);
  if (villagesConfig.enabled === false) {
    return;
  }

  const stats = state.villageStats || { lowResourceTicks: 0 };
  const villages = Array.isArray(state.villages) ? state.villages : [];
  if (villages.length >= villagesConfig.maxCount) {
    state.villageStats = stats;
    return;
  }

  const dwarfCount = Array.isArray(state.dwarves) ? state.dwarves.length : 0;
  const thresholds = villagesConfig.populationThresholds;
  const thresholdIndex = Math.max(0, villages.length - 1);
  if (thresholds.length > 0) {
    const popThreshold = thresholds[thresholdIndex];
    if (!Number.isFinite(popThreshold) || dwarfCount < popThreshold) {
      state.villageStats = stats;
      return;
    }
  } else {
    const triggerResources = villagesConfig.triggerResources;
    let belowThreshold = false;
    for (const resource of triggerResources) {
      const ratio = getStockpileRatio(state, config, resource);
      if (ratio < villagesConfig.triggerRatio) {
        belowThreshold = true;
        break;
      }
    }
    if (belowThreshold) {
      stats.lowResourceTicks =
        Math.max(0, Number(stats.lowResourceTicks || 0)) + 1;
    } else {
      stats.lowResourceTicks = 0;
    }
    if (stats.lowResourceTicks < villagesConfig.triggerTicks) {
      state.villageStats = stats;
      return;
    }
  }

  if (dwarfCount < villagesConfig.founderCount) {
    state.villageStats = stats;
    return;
  }

  const centers = villages.map((village) => village.center);
  const candidate = selectVillageCenter(state, runtime, config, {
    existingCenters: centers,
    minDistanceFromCenters: villagesConfig.minDistanceBetween,
    requiredResources: villagesConfig.requiredResources,
    requiredResourceDistance: villagesConfig.requiredResourceDistance,
  });
  if (!candidate) {
    state.villageStats = stats;
    return;
  }

  const nextId = Math.max(0, Number(state.villageCounter || villages.length)) + 1;
  state.villageCounter = nextId;
  const foundedTick = Math.max(0, Number(state.tick || 0));
  const village = {
    id: nextId,
    center: { x: candidate.x, y: candidate.y },
    foundedTick,
    founders: villagesConfig.founderCount,
  };
  villages.push(village);
  state.villages = villages;
  stats.lowResourceTicks = 0;
  stats.lastFoundedTick = foundedTick;
  state.villageStats = stats;

  pushEvent(
    state,
    config,
    `${villagesConfig.founderCount} dwarves founded village V${nextId}.`,
  );
}

module.exports = { updateVillages, getVillagesConfig, ensureVillageState };
