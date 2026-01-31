'use strict';

const { clamp } = require('../utils');
const { isAdult } = require('./population');
const { getStockpileRatio } = require('./resources');

// Build normalized role configuration settings.
function getRoleConfig(config) {
  const roles = config.population && config.population.roles;
  const enabled = roles && roles.enabled === true;
  return {
    enabled,
    builderRatio: clamp(Number(roles?.builderRatio ?? 0), 0, 1),
    managerRatio: clamp(Number(roles?.managerRatio ?? 0), 0, 1),
    switchCooldownTicks: Math.max(0, Number(roles?.switchCooldownTicks ?? 0)),
    emergencyMinRatio: clamp(Number(roles?.emergencyMinRatio ?? 0), 0, 1),
    emergencyResources: Array.isArray(roles?.emergencyResources) && roles.emergencyResources.length > 0
      ? roles.emergencyResources
      : ['food', 'water'],
  };
}

// Assign brewmaster roles based on brewery capacity and population scaling.
function updateBrewmasters(state, config) {
  const breweryConfig = config.structures && config.structures.brewery;
  if (!breweryConfig) {
    return;
  }
  const perCapita = Math.max(0, Number(breweryConfig.brewmasterPerCapita ?? 0));
  const min = Math.max(
    0,
    Number(breweryConfig.brewmasterMin ?? breweryConfig.brewmasterInitial ?? 0),
  );
  const max = Math.max(0, Number(breweryConfig.brewmasterMax ?? 0));
  const workersPer = Math.max(
    0,
    Number(breweryConfig.workersPerBrewery ?? breweryConfig.capacity ?? 0),
  );
  const maxCount = Math.max(0, Number(breweryConfig.maxCount ?? 0));
  const population = Array.isArray(state && state.dwarves) ? state.dwarves.length : 0;
  let target = Math.ceil(population * perCapita);
  if (min > 0) {
    target = Math.max(target, min);
  }
  if (max > 0) {
    target = Math.min(target, max);
  }
  if (workersPer > 0 && maxCount > 0) {
    target = Math.min(target, workersPer * maxCount);
  }

  const adults = state.dwarves.filter((dwarf) => isAdult(dwarf, config));
  target = Math.min(target, adults.length);
  const cooldownTicks = getRoleConfig(config).switchCooldownTicks;

  let current = 0;
  const demotePool = [];
  const gatherers = [];
  const builders = [];
  const managers = [];
  const others = [];

  for (const dwarf of adults) {
    if (dwarf.role === 'brewmaster') {
      current += 1;
      if (!dwarf.roleLocked && Number(dwarf.roleCooldown || 0) <= 0) {
        demotePool.push(dwarf);
      }
      continue;
    }
    if (dwarf.roleLocked || Number(dwarf.roleCooldown || 0) > 0) {
      continue;
    }
    if (dwarf.role === 'gatherer') {
      gatherers.push(dwarf);
    } else if (dwarf.role === 'builder') {
      builders.push(dwarf);
    } else if (dwarf.role === 'manager') {
      managers.push(dwarf);
    } else {
      others.push(dwarf);
    }
  }

  if (current < target) {
    let needed = target - current;
    const pool = gatherers.concat(builders, others, managers);
    for (const dwarf of pool) {
      if (needed <= 0) {
        break;
      }
      dwarf.role = 'brewmaster';
      dwarf.roleCooldown = cooldownTicks;
      needed -= 1;
    }
    return;
  }

  if (current > target) {
    let extra = current - target;
    for (const dwarf of demotePool) {
      if (extra <= 0) {
        break;
      }
      dwarf.role = 'gatherer';
      dwarf.roleCooldown = cooldownTicks;
      extra -= 1;
    }
  }
}

// Assign missing adult roles according to configured ratios.
function updateRoles(state, config) {
  const roleConfig = getRoleConfig(config);
  if (!roleConfig.enabled) {
    return;
  }
  const adults = state.dwarves.filter((dwarf) => isAdult(dwarf, config));
  let builderCount = adults.filter((dwarf) => dwarf.role === 'builder' || dwarf.role === 'manager').length;
  let managerCount = adults.filter((dwarf) => dwarf.role === 'manager').length;
  let totalCount = adults.filter((dwarf) => (
    dwarf.role === 'builder'
    || dwarf.role === 'gatherer'
    || dwarf.role === 'manager'
  )).length;

  for (const dwarf of adults) {
    if (dwarf.roleLocked) {
      continue;
    }
    if (dwarf.role === 'builder' || dwarf.role === 'gatherer' || dwarf.role === 'manager') {
      continue;
    }
    if (Number(dwarf.roleCooldown || 0) > 0) {
      continue;
    }
    const ratio = totalCount > 0 ? builderCount / totalCount : 0;
    const role = ratio < roleConfig.builderRatio ? 'builder' : 'gatherer';
    dwarf.role = role;
    dwarf.roleCooldown = roleConfig.switchCooldownTicks;
    totalCount += 1;
    if (role === 'builder') {
      builderCount += 1;
    }
  }

  if (builderCount > 0 && roleConfig.managerRatio > 0) {
    const targetManagers = Math.max(0, Math.floor(builderCount * roleConfig.managerRatio));
    if (managerCount < targetManagers) {
      for (const dwarf of adults) {
        if (managerCount >= targetManagers) {
          break;
        }
        if (dwarf.roleLocked) {
          continue;
        }
        if (dwarf.role !== 'builder') {
          continue;
        }
        if (Number(dwarf.roleCooldown || 0) > 0) {
          continue;
        }
        dwarf.role = 'manager';
        dwarf.roleCooldown = roleConfig.switchCooldownTicks;
        managerCount += 1;
      }
    } else if (managerCount > targetManagers) {
      for (const dwarf of adults) {
        if (managerCount <= targetManagers) {
          break;
        }
        if (dwarf.roleLocked) {
          continue;
        }
        if (dwarf.role !== 'manager') {
          continue;
        }
        if (Number(dwarf.roleCooldown || 0) > 0) {
          continue;
        }
        dwarf.role = 'builder';
        dwarf.roleCooldown = roleConfig.switchCooldownTicks;
        managerCount -= 1;
      }
    }
  }
}

// Check if any critical resource shortage should force gathering.
function isEmergencyGather(state, config, roleConfig) {
  if (!roleConfig.enabled || roleConfig.emergencyMinRatio <= 0) {
    return false;
  }
  for (const resource of roleConfig.emergencyResources) {
    const ratio = getStockpileRatio(state, config, resource);
    if (ratio < roleConfig.emergencyMinRatio) {
      return true;
    }
  }
  return false;
}

module.exports = { getRoleConfig, updateBrewmasters, updateRoles, isEmergencyGather };
