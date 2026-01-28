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
    switchCooldownTicks: Math.max(0, Number(roles?.switchCooldownTicks ?? 0)),
    emergencyMinRatio: clamp(Number(roles?.emergencyMinRatio ?? 0), 0, 1),
    emergencyResources: Array.isArray(roles?.emergencyResources) && roles.emergencyResources.length > 0
      ? roles.emergencyResources
      : ['food_raw', 'water'],
  };
}

// Assign missing adult roles according to configured ratios.
function updateRoles(state, config) {
  const roleConfig = getRoleConfig(config);
  if (!roleConfig.enabled) {
    return;
  }
  const adults = state.dwarves.filter((dwarf) => isAdult(dwarf, config));
  let builderCount = adults.filter((dwarf) => dwarf.role === 'builder').length;
  let totalCount = adults.filter((dwarf) => dwarf.role === 'builder' || dwarf.role === 'gatherer').length;

  for (const dwarf of adults) {
    if (dwarf.role === 'builder' || dwarf.role === 'gatherer') {
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

module.exports = { getRoleConfig, updateRoles, isEmergencyGather };
