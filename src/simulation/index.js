'use strict';

const { updateSeason, getSeasonModifier } = require('./season');
const { updateWeather, getWeatherModifier, getWeatherNeedMultipliers } = require('./weather');
const { updateRaidStart, updateRaidTick } = require('./raids');
const {
  advanceAge,
  applyNeedDecay,
  consumeResources,
  updateDerivedState,
  handleDeaths,
  updateRelationships,
  handleReproduction,
  assignHousing,
  cohouseCouples,
  getWinterHousingPenalty,
} = require('./population');
const { updateRoles } = require('./roles');
const { assignJobs } = require('./jobs');
const { processDwarfAction } = require('./dwarf_actions');
const { updateMerchant } = require('./merchant');
const { updateHouseStorage, regenerateNodes } = require('./resources');

// Advance the simulation by one tick.
function stepState(state, config, runtime, action) {
  state.lastConfig = config;
  state.tick += 1;
  updateSeason(state, config);
  updateWeather(state, config);
  updateRaidStart(state, config, runtime);
  const housingPenalty = getWinterHousingPenalty(state, config);
  const weatherNeedMultiplier = getWeatherModifier(state, config, 'needDecay', 1);
  const weatherNeedByNeed = getWeatherNeedMultipliers(state, config);

  for (const dwarf of state.dwarves) {
    advanceAge(dwarf, config);
    applyNeedDecay(
      dwarf,
      config.needs.decayPerTick || {},
      getSeasonModifier(state, 'needDecay', 1) * housingPenalty.needDecay * weatherNeedMultiplier,
      weatherNeedByNeed,
    );
    consumeResources(dwarf, state.stockpile, config.consumption || {});
    updateDerivedState(dwarf);
  }

  handleDeaths(state, config);
  updateRoles(state, config);
  assignHousing(state, config);
  updateRelationships(state, config);
  cohouseCouples(state, config);
  handleReproduction(state, config);

  assignJobs(state, config, runtime, action);

  for (const dwarf of state.dwarves) {
    processDwarfAction(dwarf, state, config, runtime);
  }

  updateMerchant(state, config, runtime);
  updateHouseStorage(state, config);
  regenerateNodes(state, config);
  updateRaidTick(state, config, runtime);
}

module.exports = { stepState };
