'use strict';

const { updateSeason, getSeasonModifier } = require('./season');
const { updateWeather, getWeatherModifier, getWeatherNeedMultipliers } = require('./weather');
const { updateRaidStart, updateRaidTick } = require('./raids');
const { updateFestivals, getFestivalModifier } = require('./festivals');
const { updateWildlifeStart, updateWildlifeTick, updatePastureBirths } = require('./wildlife');
const { getClanEffects } = require('../clans');
const { updateContracts } = require('./contracts');
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
const { updateBrewmasters, updateRoles } = require('./roles');
const { assignJobs } = require('./jobs');
const { processDwarfAction } = require('./dwarf_actions');
const { updateMerchant } = require('./merchant');
const { updateHouseStorage, regenerateNodes, applyStockpileDecay } = require('./resources');
const { tickTerrainCooldowns } = require('./terrain');
const { updateRuins } = require('./ruins');
const { updateEndgameDifficulty, maybeHandleEndgameReset } = require('./endgame');
const { updateMyths, getMythMultiplier } = require('./myths');
const { updateAlchemy, getAlchemyMultiplier } = require('./alchemy');
const { updateTemple, getTempleNeedDecayMultiplier } = require('./temple');
const { updateVillages } = require('./villages');
const { updateRoads } = require('./roads');

// Advance the simulation by one tick.
function stepState(state, config, runtime, action, options = {}) {
  state.lastConfig = config;
  state.tick += 1;
  const endgameDifficulty = updateEndgameDifficulty(state, config);
  updateSeason(state, config);
  updateWeather(state, config);
  updateRaidStart(state, config, runtime);
  updateFestivals(state, config, runtime, action);
  updateContracts(state, config, runtime);
  updateAlchemy(state, config);
  updateTemple(state, config, runtime);
  updateWildlifeStart(state, config, runtime);
  const housingPenalty = getWinterHousingPenalty(state, config);
  const weatherNeedMultiplier = getWeatherModifier(state, config, 'needDecay', 1);
  const weatherNeedByNeed = getWeatherNeedMultipliers(state, config);
  const mythNeedMultiplier = getMythMultiplier(state, config, 'needDecay', 1);
  const alchemyNeedMultiplier = getAlchemyMultiplier(state, config, 'needDecay', 1);
  const festivalNeedMultiplier = getFestivalModifier(state, 'needDecay', 1);
  const templeNeedMultiplier = getTempleNeedDecayMultiplier(state, config);
  const stormColdActive = state.weather
    ? state.weather.type === 'storm' || state.weather.type === 'cold'
    : false;

  for (const dwarf of state.dwarves) {
    const clanEffects = getClanEffects(config, dwarf.clanId);
    const stormColdBonus = Math.max(0, Number(clanEffects.storm_cold_need_decay_bonus || 0));
    const clanNeedMultiplier = stormColdActive && stormColdBonus > 0
      ? 1 + stormColdBonus
      : 1;
    advanceAge(dwarf, config);
    applyNeedDecay(
      dwarf,
      config.needs.decayPerTick || {},
      getSeasonModifier(state, 'needDecay', 1)
        * housingPenalty.needDecay
        * weatherNeedMultiplier
        * endgameDifficulty
        * clanNeedMultiplier
        * mythNeedMultiplier
        * alchemyNeedMultiplier
        * festivalNeedMultiplier
        * templeNeedMultiplier,
      weatherNeedByNeed,
    );
    consumeResources(dwarf, state, config);
    updateDerivedState(dwarf);
  }

  handleDeaths(state, config);
  updateBrewmasters(state, config);
  updateRoles(state, config);
  updateRuins(state, config, runtime);
  assignHousing(state, config);
  updateRelationships(state, config);
  cohouseCouples(state, config);
  handleReproduction(state, config);
  updateVillages(state, config, runtime);
  updateRoads(state, config, runtime);

  assignJobs(state, config, runtime, action);

  for (const dwarf of state.dwarves) {
    processDwarfAction(dwarf, state, config, runtime);
  }

  updateMerchant(state, config, runtime);
  applyStockpileDecay(state, config);
  tickTerrainCooldowns(state);
  updateHouseStorage(state, config);
  regenerateNodes(state, config);
  updateRaidTick(state, config, runtime);
  updateWildlifeTick(state, config, runtime);
  updatePastureBirths(state, config);
  updateMyths(state, config);
  if (!options.suppressEndgameReset) {
    maybeHandleEndgameReset(state, config, runtime);
  }
}

module.exports = { stepState };
