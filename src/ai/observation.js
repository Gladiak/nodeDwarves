'use strict';

const { clamp } = require('../utils');
const { getStockpileTarget } = require('../simulation/resources');
const { getFestivalObservation } = require('../simulation/festivals');
const { getWorldEventObservation } = require('../simulation/world_events');
const { getExternalCampStatus } = require('../simulation/external_camps');
const { getSchismStatus } = require('../simulation/schism');
const { getClanList, getClanShare } = require('../clans');

// Build a full observation object from the current state.
function buildObservation(state, config) {
  const targets = (config.resources && (config.resources.targets || config.resources.stockpile)) || {};
  const stockpileRatio = {};

  for (const [resource, targetValue] of Object.entries(targets)) {
    const target = getStockpileTarget(state, config, resource, targets);
    if (target <= 0) {
      continue;
    }
    const current = Number(state.stockpile[resource] || 0);
    stockpileRatio[resource] = clamp(current / target, 0, 1);
  }

  const housingStats = getHousingStats(state, config);
  const raidObservation = getRaidObservation(state, config, housingStats);
  const ruinsObservation = buildRuinsObservation(state, config);
  const underrealmObservation = buildUnderrealmObservation(state, config);
  const mythsObservation = buildMythsObservation(state, config);
  const festivalObservation = getFestivalObservation(state, config);
  const worldEventsObservation = buildWorldEventsObservation(state, config);
  const contractsObservation = buildContractsObservation(state, config);
  const externalCampsObservation = buildExternalCampsObservation(state, config);
  const schismObservation = buildSchismObservation(state, config);
  const socialObservation = buildSocialObservation(state, config);
  const warriorsObservation = buildWarriorsObservation(state, config);
  const clanShares = getClanShares(state, config);

  return {
    season: state.season || null,
    weather: buildWeatherObservation(state, config),
    stockpileRatio,
    nodeRatio: getNodeRatio(state.nodes || []),
    criticalNeedsFraction: getCriticalNeedsFraction(state.dwarves || [], config),
    idleAdultsFraction: getIdleAdultsFraction(state.dwarves || []),
    populationBalance: getPopulationBalance(state, config),
    housingRatio: housingStats.housingRatio,
    raid: raidObservation,
    ruins: ruinsObservation,
    underrealm: underrealmObservation,
    myths: mythsObservation,
    festival: festivalObservation,
    worldEvents: worldEventsObservation,
    contracts: contractsObservation,
    externalCamps: externalCampsObservation,
    schism: schismObservation,
    social: socialObservation,
    warriors: warriorsObservation,
    clanShares,
  };
}

// Build feature vector values for a given resource.
function buildFeatures(obs, resource, config, featureNames) {
  const ratio = Number((obs.stockpileRatio && obs.stockpileRatio[resource]) ?? 1);
  const nodeRatio = Number((obs.nodeRatio && obs.nodeRatio[resource]) ?? 1);
  const shortage = clamp(1 - ratio, 0, 1);
  const nodeScarcity = clamp(1 - nodeRatio, 0, 1);
  const criticalNeeds = clamp(Number(obs.criticalNeedsFraction || 0), 0, 1);
  const idleAdults = clamp(Number(obs.idleAdultsFraction || 0), 0, 1);
  const populationBalance = clamp(Number(obs.populationBalance || 0), 0, 1);
  const seasonIndex = getSeasonIndex(obs.season, config);
  const seasonProgress = getSeasonProgress(obs.season);
  const weather = obs.weather || {};
  const weatherSeverity = clamp(Number(weather.severity || 0), 0, 1);
  const weatherTimeLeft = clamp(Number(weather.timeLeft || 0), 0, 1);
  const raid = obs.raid || {};
  const raidActive = raid.active ? 1 : 0;
  const raidTimeLeft = clamp(Number(raid.timeLeftRatio ?? raid.timeLeft ?? 0), 0, 1);
  const raidExposed = clamp(Number(raid.exposedRatio ?? raid.exposed ?? 0), 0, 1);
  const raidDefense = clamp(Number(raid.defenseRatio ?? raid.defense ?? 0), 0, 1);
  const housingRatio = clamp(Number(obs.housingRatio || 0), 0, 1);
  const housingShortage = clamp(1 - housingRatio, 0, 1);
  const seasonEligible = raid.seasonEligible ? 1 : 0;
  const ruins = obs.ruins || {};
  const ruinsActive = ruins.active ? 1 : 0;
  const ruinsCooldown = clamp(Number(ruins.cooldownRatio ?? 0), 0, 1);
  const ruinsProgress = clamp(Number(ruins.progress ?? 0), 0, 1);
  const ruinsArtifacts = clamp(Number(ruins.artifacts ?? 0), 0, 1);
  const underrealm = obs.underrealm || {};
  const underrealmDepthProgress = clamp(Number(underrealm.depthProgress ?? 0), 0, 1);
  const underrealmChampionProgress = clamp(Number(underrealm.championProgress ?? 0), 0, 1);
  const underrealmFrontierContested = clamp(Number(underrealm.frontierContested ?? 0), 0, 1);
  const underrealmChampionCooldown = clamp(Number(underrealm.championCooldown ?? 0), 0, 1);
  const underrealmReadinessScore = clamp(Number(underrealm.readinessScore ?? 0), 0, 1);
  const underrealmReadinessGap = clamp(Number(underrealm.readinessGap ?? 0), 0, 1);
  const underrealmReadinessBlocked = clamp(Number(underrealm.readinessBlocked ?? 0), 0, 1);
  const underrealmReadinessWarning = clamp(Number(underrealm.readinessWarning ?? 0), 0, 1);
  const underrealmCombatPressure = clamp(Number(underrealm.combatPressure ?? 0), 0, 1);
  const myths = obs.myths || {};
  const mythsActiveRatio = clamp(Number(myths.activeRatio ?? 0), 0, 1);
  const mythsSeverity = clamp(Number(myths.severity ?? 0), 0, 1);
  const mythFlags = myths.flags || {};
  const festival = obs.festival || {};
  const festivalActive = festival.active ? 1 : 0;
  const festivalTimeLeft = clamp(Number(festival.timeLeft ?? 0), 0, 1);
  const festivalEligible = clamp(Number(festival.eligible ?? 0), 0, 1);
  const festivalCostRatio = clamp(Number(festival.costRatio ?? 0), 0, 1);
  const worldEvents = obs.worldEvents || {};
  const worldEventActive = clamp(Number(worldEvents.active ?? 0), 0, 1);
  const worldEventOfferPhase = clamp(Number(worldEvents.offerPhase ?? 0), 0, 1);
  const worldEventOfferReady = clamp(Number(worldEvents.offerReady ?? 0), 0, 1);
  const worldEventTimeLeft = clamp(Number(worldEvents.timeLeft ?? 0), 0, 1);
  const worldEventSpawnImminence = clamp(Number(worldEvents.spawnImminence ?? 0), 0, 1);
  const worldEventPressure = clamp(Number(worldEvents.pressure ?? 0), 0, 1);
  const contracts = obs.contracts || {};
  const contractActive = clamp(Number(contracts.active ?? 0), 0, 1);
  const contractReady = clamp(Number(contracts.ready ?? 0), 0, 1);
  const contractTimeLeft = clamp(Number(contracts.timeLeft ?? 0), 0, 1);
  const contractFailurePressure = clamp(Number(contracts.failurePressure ?? 0), 0, 1);
  const contractReputation = clamp(Number(contracts.reputation ?? 0), 0, 1);
  const contractPressure = clamp(Number(contracts.pressure ?? 0), 0, 1);
  const externalCamps = obs.externalCamps || {};
  const externalCampActiveRatio = clamp(Number(externalCamps.activeRatio ?? 0), 0, 1);
  const externalCampRaiderPressure = clamp(Number(externalCamps.raiderPressure ?? 0), 0, 1);
  const externalCampCaravanRisk = clamp(Number(externalCamps.caravanRisk ?? 0), 0, 1);
  const externalCampMilitiaSupport = clamp(Number(externalCamps.militiaSupport ?? 0), 0, 1);
  const externalCampTradeInfluence = clamp(Number(externalCamps.tradeInfluence ?? 0), 0, 1);
  const externalCampPressure = clamp(Number(externalCamps.pressure ?? 0), 0, 1);
  const schism = obs.schism || {};
  const schismPressure = clamp(Number(schism.pressure ?? 0), 0, 1);
  const schismLegitimacy = clamp(Number(schism.legitimacy ?? 0), 0, 1);
  const schismPhase = clamp(Number(schism.phase ?? 0), 0, 1);
  const schismDoctrineRevelry = clamp(Number(schism.doctrineRevelry ?? 0), 0, 1);
  const schismRitualOpen = clamp(Number(schism.ritualOpen ?? 0), 0, 1);
  const schismRitualActive = clamp(Number(schism.ritualActive ?? 0), 0, 1);
  const schismClimaxActive = clamp(Number(schism.climaxActive ?? 0), 0, 1);
  const schismInstability = clamp(Number(schism.instability ?? 0), 0, 1);
  const social = obs.social || {};
  const socialCohesion = clamp(Number(social.cohesion ?? 0), 0, 1);
  const socialConflictPressure = clamp(Number(social.conflictPressure ?? 0), 0, 1);
  const socialMentorshipCoverage = clamp(Number(social.mentorshipCoverage ?? 0), 0, 1);
  const socialGrudgeLoad = clamp(Number(social.grudgeLoad ?? 0), 0, 1);
  const socialIncidentRecency = clamp(Number(social.incidentRecency ?? 0), 0, 1);
  const warriors = obs.warriors || {};
  const warriorEnabled = clamp(Number(warriors.enabled ?? 0), 0, 1);
  const warriorRosterCoverage = clamp(Number(warriors.rosterCoverage ?? 0), 0, 1);
  const warriorEliteScore = clamp(Number(warriors.eliteScore ?? 0), 0, 1);
  const warriorLegacyAura = clamp(Number(warriors.legacyAura ?? 0), 0, 1);
  const warriorChampionMomentum = clamp(Number(warriors.championMomentum ?? 0), 0, 1);
  const warriorTournamentRecency = clamp(Number(warriors.tournamentRecency ?? 0), 0, 1);
  const warriorInjuryShare = clamp(Number(warriors.injuryShare ?? 0), 0, 1);
  const warriorRetiredShare = clamp(Number(warriors.retiredShare ?? 0), 0, 1);
  const warriorSurvivability = clamp(Number(warriors.survivability ?? 0), 0, 1);
  const warriorHeroTurnoverPressure = clamp(Number(warriors.heroTurnoverPressure ?? 0), 0, 1);
  const clanShares = obs.clanShares || {};

  const values = {
    shortage,
    nodeScarcity,
    criticalNeeds,
    idleAdults,
    populationBalance,
    seasonIndex,
    seasonProgress,
    weatherSeverity,
    weatherTimeLeft,
    raidActive,
    raidTimeLeft,
    raidExposed,
    raidDefense,
    housingShortage,
    seasonEligible,
    ruinsActive,
    ruinsCooldown,
    ruinsProgress,
    ruinsArtifacts,
    underrealmDepthProgress,
    underrealmChampionProgress,
    underrealmFrontierContested,
    underrealmChampionCooldown,
    underrealmReadinessScore,
    underrealmReadinessGap,
    underrealmReadinessBlocked,
    underrealmReadinessWarning,
    underrealmCombatPressure,
    mythsActiveRatio,
    mythsSeverity,
    festivalActive,
    festivalTimeLeft,
    festivalEligible,
    festivalCostRatio,
    worldEventActive,
    worldEventOfferPhase,
    worldEventOfferReady,
    worldEventTimeLeft,
    worldEventSpawnImminence,
    worldEventPressure,
    contractActive,
    contractReady,
    contractTimeLeft,
    contractFailurePressure,
    contractReputation,
    contractPressure,
    externalCampActiveRatio,
    externalCampRaiderPressure,
    externalCampCaravanRisk,
    externalCampMilitiaSupport,
    externalCampTradeInfluence,
    externalCampPressure,
    schismPressure,
    schismLegitimacy,
    schismPhase,
    schismDoctrineRevelry,
    schismRitualOpen,
    schismRitualActive,
    schismClimaxActive,
    schismInstability,
    socialCohesion,
    socialConflictPressure,
    socialMentorshipCoverage,
    socialGrudgeLoad,
    socialIncidentRecency,
    warriorEnabled,
    warriorRosterCoverage,
    warriorEliteScore,
    warriorLegacyAura,
    warriorChampionMomentum,
    warriorTournamentRecency,
    warriorInjuryShare,
    warriorRetiredShare,
    warriorSurvivability,
    warriorHeroTurnoverPressure,
  };
  const mythDefs = (config && config.myths && config.myths.definitions) || {};
  for (const mythId of Object.keys(mythDefs)) {
    const key = `mythFlag_${mythId}`;
    values[key] = clamp(Number(mythFlags[mythId] || 0), 0, 1);
  }
  const clanList = getClanList(config);
  for (const clanId of clanList) {
    const key = `clanShare_${clanId}`;
    values[key] = clamp(Number(clanShares[clanId] || 0), 0, 1);
  }

  const names = Array.isArray(featureNames) && featureNames.length > 0
    ? featureNames
    : Object.keys(values);

  return names.map((name) => Number(values[name] ?? 0));
}

// Build world-event pressure observation scalars.
function buildWorldEventsObservation(state, config) {
  const worldConfig = (config && config.worldEvents) || {};
  const fallback = {
    active: 0,
    offerPhase: 0,
    offerReady: 0,
    timeLeft: 0,
    spawnImminence: 0,
    pressure: 0,
  };
  if (worldConfig.enabled === false) {
    return fallback;
  }
  const world = getWorldEventObservation(state, config) || {};
  const active = world.active ? 1 : 0;
  const offerPhase = world.phase === 'offer' ? 1 : 0;
  const offerReady = clamp(Number(world.offerReady || 0), 0, 1);
  const timeLeft = clamp(Number(world.timeLeft || 0), 0, 1);
  const spawnImminence = getWorldEventSpawnImminence(state, config);
  const pressure = clamp(
    active * 0.35
      + offerPhase * 0.2
      + (offerPhase > 0 ? (1 - offerReady) * 0.2 : 0)
      + (offerPhase > 0 ? timeLeft * 0.15 : 0)
      + spawnImminence * 0.1,
    0,
    1,
  );
  return {
    active,
    offerPhase,
    offerReady,
    timeLeft,
    spawnImminence,
    pressure,
  };
}

// Build contract governance observation scalars.
function buildContractsObservation(state, config) {
  const contractsConfig = (config && config.contracts) || {};
  const fallback = {
    active: 0,
    ready: 0,
    timeLeft: 0,
    failurePressure: 0,
    reputation: 0,
    expiryPressure: 0,
    pressure: 0,
  };
  if (contractsConfig.enabled === false) {
    return fallback;
  }
  const contractsState = state && state.contracts && typeof state.contracts === 'object'
    ? state.contracts
    : null;
  if (!contractsState) {
    return fallback;
  }
  const activeContract = contractsState.active && typeof contractsState.active === 'object'
    ? contractsState.active
    : null;
  const tick = Math.max(0, Number(state && state.tick || 0));
  const expiryTicks = Math.max(1, Number(contractsConfig.expiryTicks || 0));
  const active = activeContract ? 1 : 0;
  const ticksLeft = activeContract ? Math.max(0, Number(activeContract.expiresAt || 0) - tick) : 0;
  const timeLeft = active > 0 ? clamp(ticksLeft / expiryTicks, 0, 1) : 0;
  const ready = activeContract && canFulfillContractRequest(state && state.stockpile, activeContract.requested)
    ? 1
    : 0;
  const stats = contractsState.stats && typeof contractsState.stats === 'object'
    ? contractsState.stats
    : {};
  const successes = Math.max(0, Number(stats.successes || 0));
  const failures = Math.max(0, Number(stats.failures || 0));
  const failurePressure = clamp(failures / Math.max(1, successes + failures + 1), 0, 1);
  const reputations = contractsState.reputations && typeof contractsState.reputations === 'object'
    ? Object.values(contractsState.reputations)
    : [];
  let reputation = 0;
  if (reputations.length > 0) {
    const sum = reputations.reduce((acc, value) => acc + clamp(Number(value || 0), -1, 1), 0);
    const average = sum / reputations.length;
    reputation = clamp((average + 1) / 2, 0, 1);
  }
  const expiryPressure = active > 0
    ? clamp((1 - ready) * clamp((0.35 - timeLeft) / 0.35, 0, 1), 0, 1)
    : 0;
  const pressure = clamp(
    active * 0.2
      + (active > 0 ? (1 - ready) * 0.25 : 0)
      + failurePressure * 0.35
      + expiryPressure * 0.2,
    0,
    1,
  );
  return {
    active,
    ready,
    timeLeft,
    failurePressure,
    reputation,
    expiryPressure,
    pressure,
  };
}

// Check whether stockpile can fulfill an active contract request.
function canFulfillContractRequest(stockpile, requested) {
  if (!stockpile || typeof stockpile !== 'object' || !requested || typeof requested !== 'object') {
    return false;
  }
  for (const [resourceId, amount] of Object.entries(requested)) {
    if (Number(stockpile[resourceId] || 0) < Number(amount || 0)) {
      return false;
    }
  }
  return true;
}

// Build external-camp pressure observation scalars.
function buildExternalCampsObservation(state, config) {
  const status = getExternalCampStatus(state, config);
  const fallback = {
    activeRatio: 0,
    raiderPressure: 0,
    caravanRisk: 0,
    militiaSupport: 0,
    tradeInfluence: 0,
    pressure: 0,
  };
  if (!status) {
    return fallback;
  }
  const maxActive = Math.max(1, Number(config && config.externalCamps && config.externalCamps.maxActive || 1));
  const activeRatio = clamp(Number(status.activeCount || 0) / maxActive, 0, 1);
  const modifiers = status.modifiers && typeof status.modifiers === 'object'
    ? status.modifiers
    : {};
  const raiderPressure = clamp(Number(modifiers.raiderPressure || 0), 0, 1);
  const caravanRisk = clamp(Number(modifiers.caravanInterceptRisk || 0), 0, 1);
  const tradeInfluence = clamp(Number(modifiers.tradeInfluence || 0), 0, 1);
  const militiaBonus = Math.max(0, Number(modifiers.raidDefenseBonus || 0));
  const militiaCap = Math.max(
    0.01,
    Number(config && config.externalCamps && config.externalCamps.militia
      && config.externalCamps.militia.maxRaidDefenseBonus
      || 0.18),
  );
  const militiaSupport = clamp(militiaBonus / militiaCap, 0, 1);
  const pressure = clamp(
    raiderPressure * 0.5
      + caravanRisk * 0.2
      + activeRatio * 0.15
      + (activeRatio > 0 ? (1 - militiaSupport) * 0.1 : 0)
      + (activeRatio > 0 ? (1 - tradeInfluence) * 0.05 : 0),
    0,
    1,
  );
  return {
    activeRatio,
    raiderPressure,
    caravanRisk,
    militiaSupport,
    tradeInfluence,
    pressure,
  };
}

// Build schism governance observation scalars.
function buildSchismObservation(state, config) {
  const status = getSchismStatus(state, config);
  const fallback = {
    pressure: 0,
    legitimacy: 0,
    phase: 0,
    doctrineRevelry: 0,
    ritualOpen: 0,
    ritualActive: 0,
    climaxActive: 0,
    instability: 0,
  };
  if (!status) {
    return fallback;
  }
  const pressure = clamp(Number(status.pressure || 0), 0, 1);
  const legitimacy = clamp(Number(status.legitimacy || 0), 0, 1);
  const phase = normalizeSchismPhase(status.phase);
  const doctrineRevelry = status.doctrine === 'revelry' ? 1 : 0;
  const ritualOpen = status.ritualOpen === true ? 1 : 0;
  const ritualActive = status.ritualActive === true ? 1 : 0;
  const climaxActive = status.climaxActive === true ? 1 : 0;
  const instability = clamp(
    pressure * 0.5
      + (1 - legitimacy) * 0.35
      + phase * 0.15,
    0,
    1,
  );
  return {
    pressure,
    legitimacy,
    phase,
    doctrineRevelry,
    ritualOpen,
    ritualActive,
    climaxActive,
    instability,
  };
}

// Build social-drama aggregate observation scalars.
function buildSocialObservation(state, config) {
  const socialConfig = config && config.population && config.population.socialDrama
    ? config.population.socialDrama
    : {};
  const social = state && state.social && typeof state.social === 'object'
    ? state.social
    : null;
  if (!social || socialConfig.enabled === false || social.enabled !== true) {
    return {
      cohesion: 0,
      conflictPressure: 0,
      mentorshipCoverage: 0,
      grudgeLoad: 0,
      incidentRecency: 0,
    };
  }

  const incidentsConfig = socialConfig && socialConfig.incidents && typeof socialConfig.incidents === 'object'
    ? socialConfig.incidents
    : {};
  const intervalTicks = Math.max(
    1,
    Number(incidentsConfig.intervalTicks || socialConfig.tickInterval || 12),
  );
  const recencyWindow = Math.max(1, intervalTicks * 4);
  const tick = Math.max(0, Number(state && state.tick || 0));
  const lastIncidentTick = Math.max(0, Number(social.lastIncidentTick || 0));
  const incidentRecency = lastIncidentTick > 0
    ? clamp(1 - Math.max(0, tick - lastIncidentTick) / recencyWindow, 0, 1)
    : 0;
  return {
    cohesion: clamp(Number(social.cohesion || 0), 0, 1),
    conflictPressure: clamp(Number(social.conflictPressure || 0), 0, 1),
    mentorshipCoverage: clamp(Number(social.mentorshipCoverage || 0), 0, 1),
    grudgeLoad: clamp(Number(social.grudgeLoad || 0), 0, 1),
    incidentRecency,
  };
}

// Build Warrior League aggregate observation scalars for AI training.
function buildWarriorsObservation(state, config) {
  const runtime = state && state.warriors && typeof state.warriors === 'object'
    ? state.warriors
    : null;
  const warriorsConfig = (config && config.warriors) || {};
  if (!runtime || runtime.enabled !== true || warriorsConfig.enabled !== true) {
    return {
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
    };
  }

  const dwarves = Array.isArray(state && state.dwarves) ? state.dwarves : [];
  const adults = dwarves.filter((dwarf) => dwarf && dwarf.lifeStage === 'adult');
  const warriorAdults = adults
    .map((dwarf) => ({
      dwarf,
      warrior: dwarf && dwarf.warrior && typeof dwarf.warrior === 'object'
        ? dwarf.warrior
        : null,
    }))
    .filter((entry) => entry.warrior);
  const rosterCoverage = adults.length > 0
    ? clamp(warriorAdults.length / adults.length, 0, 1)
    : 0;
  const activeInjuries = warriorAdults.filter((entry) => {
    const injury = entry.warrior && entry.warrior.injury && typeof entry.warrior.injury === 'object'
      ? entry.warrior.injury
      : null;
    return injury && Number(injury.recoveryTicks || 0) > 0;
  }).length;
  const retiredAdults = warriorAdults.filter((entry) => entry.warrior && entry.warrior.retired === true).length;
  const injuryShare = warriorAdults.length > 0
    ? clamp(activeInjuries / warriorAdults.length, 0, 1)
    : 0;
  const retiredShare = warriorAdults.length > 0
    ? clamp(retiredAdults / warriorAdults.length, 0, 1)
    : 0;

  const eliteSample = warriorAdults
    .map((entry) => ({
      id: String(entry.dwarf && entry.dwarf.id || ''),
      spawnIndex: Math.max(0, Math.floor(Number(entry.dwarf && entry.dwarf.spawnIndex || 0))),
      eliteScore: computeWarriorEliteScore(entry.warrior),
    }))
    .sort((left, right) => {
      if (Math.abs(right.eliteScore - left.eliteScore) > 1e-9) {
        return right.eliteScore - left.eliteScore;
      }
      if (left.spawnIndex !== right.spawnIndex) {
        return left.spawnIndex - right.spawnIndex;
      }
      return left.id.localeCompare(right.id);
    })
    .slice(0, 5);
  const eliteScore = eliteSample.length > 0
    ? clamp(
      eliteSample.reduce((sum, entry) => sum + Number(entry.eliteScore || 0), 0) / eliteSample.length,
      0,
      1,
    )
    : 0;

  const company = runtime.company && typeof runtime.company === 'object'
    ? runtime.company
    : {};
  const legacyAura = clamp(Number(company.legacyAura || 0), 0, 1);

  const league = runtime.league && typeof runtime.league === 'object'
    ? runtime.league
    : {};
  const championId = String(league.championId || '');
  const championDwarf = championId
    ? dwarves.find((dwarf) => String(dwarf && dwarf.id || '') === championId)
    : null;
  const championWarrior = championDwarf && championDwarf.warrior && typeof championDwarf.warrior === 'object'
    ? championDwarf.warrior
    : null;
  const championMomentum = championWarrior ? computeWarriorEliteScore(championWarrior) : 0;

  const tick = Math.max(0, Number(state && state.tick || 0));
  const lastTournamentTick = Math.max(0, Number(league.lastTournamentTick || 0));
  const seasonDuration = Math.max(
    1,
    Number(state && state.season && state.season.duration || 0),
    Number(config && config.seasons && config.seasons.durationTicks || 0),
  );
  const interval = Math.max(1, Number(warriorsConfig.tournaments && warriorsConfig.tournaments.interval_seasons || 1));
  const recencyWindow = Math.max(1, seasonDuration * interval);
  const tournamentRecency = lastTournamentTick > 0
    ? clamp(1 - Math.max(0, tick - lastTournamentTick) / recencyWindow, 0, 1)
    : 0;
  const stats = runtime.stats && typeof runtime.stats === 'object'
    ? runtime.stats
    : {};
  const tournaments = Math.max(0, Number(stats.tournaments || 0));
  const heroTurnovers = Math.max(0, Number(stats.heroTurnovers || 0));
  const heroTurnoverPressure = clamp(
    heroTurnovers / Math.max(1, tournaments + 1),
    0,
    1,
  );
  const survivability = clamp(
    1
      - injuryShare * 0.65
      - retiredShare * 0.2
      - heroTurnoverPressure * 0.15,
    0,
    1,
  );

  return {
    enabled: 1,
    rosterCoverage,
    eliteScore,
    legacyAura,
    championMomentum,
    tournamentRecency,
    injuryShare,
    retiredShare,
    survivability,
    heroTurnoverPressure,
  };
}

// Compute one bounded elite-performance scalar for a warrior payload.
function computeWarriorEliteScore(warrior) {
  if (!warrior || typeof warrior !== 'object') {
    return 0;
  }
  const rating = clamp(Number(warrior.rating || 0), 0, 1);
  const valor = clamp(Number(warrior.valor || 0), 0, 1);
  const heroPotential = clamp(Number(warrior.heroPotential || 0), 0, 1);
  const conditionScore = clamp(
    Number(warrior.condition && warrior.condition.score || 0),
    0,
    1,
  );
  return clamp(
    rating * 0.45
      + valor * 0.25
      + heroPotential * 0.2
      + conditionScore * 0.1,
    0,
    1,
  );
}

// Normalize schism phase names to a scalar in 0..1.
function normalizeSchismPhase(phaseName) {
  const map = {
    concord: 0,
    murmurs: 1,
    fracture: 2,
    reckoning: 3,
  };
  const index = Number(map[String(phaseName || '').toLowerCase()]);
  if (!Number.isFinite(index)) {
    return 0;
  }
  return clamp(index / 3, 0, 1);
}

// Resolve how close we are to the next world-event spawn.
function getWorldEventSpawnImminence(state, config) {
  const worldState = state && state.worldEvents && typeof state.worldEvents === 'object'
    ? state.worldEvents
    : null;
  if (!worldState) {
    return 0;
  }
  const spawnRange = (config && config.worldEvents && config.worldEvents.spawnRangeTicks) || {};
  const window = Math.max(
    1,
    Number(spawnRange.max ?? spawnRange.min ?? 1),
  );
  const tick = Math.max(0, Number(state && state.tick || 0));
  const nextSpawnTick = Math.max(0, Number(worldState.nextSpawnTick || 0));
  const nextSpawnIn = Math.max(0, nextSpawnTick - tick);
  return clamp(1 - (nextSpawnIn / window), 0, 1);
}

// Build weather observation scalars.
function buildWeatherObservation(state, config) {
  const weatherConfig = (config && config.weather) || {};
  const weather = state.weather;
  if (!weather || weatherConfig.enabled === false) {
    return { severity: 0, timeLeft: 0 };
  }
  const def = weatherConfig.states && weatherConfig.states[weather.type] ? weatherConfig.states[weather.type] : null;
  const severity = def && Number.isFinite(def.severity)
    ? clamp(Number(def.severity || 0), 0, 1)
    : getFallbackWeatherSeverity(weather.type);
  const duration = Math.max(1, Number(weather.duration || 0));
  const remaining = Math.max(0, Number(weather.ticksRemaining || 0));
  return {
    severity,
    timeLeft: clamp(remaining / duration, 0, 1),
  };
}

// Build underrealm combat/progression observation scalars.
function buildUnderrealmObservation(state, config) {
  const underrealmState = state && state.underrealm;
  if (!underrealmState || underrealmState.enabled === false) {
    return {
      depthProgress: 0,
      championProgress: 0,
      frontierContested: 0,
      championCooldown: 0,
      readinessScore: 0,
      readinessGap: 0,
      readinessBlocked: 0,
      readinessWarning: 0,
      combatPressure: 0,
    };
  }
  const maxDepth = Math.max(1, Math.floor(Number(underrealmState.maxDepth || 0)));
  const maxUnlockedDepth = clamp(
    Math.floor(Number(underrealmState.maxUnlockedDepth || 0)),
    0,
    maxDepth,
  );
  const depthProgress = clamp(maxUnlockedDepth / maxDepth, 0, 1);
  const combat = underrealmState.combat && typeof underrealmState.combat === 'object'
    ? underrealmState.combat
    : {};
  const stats = combat.stats && typeof combat.stats === 'object'
    ? combat.stats
    : {};
  const championsDefeated = Math.max(0, Number(stats.championsDefeated || 0));
  const championProgress = clamp(championsDefeated / maxDepth, 0, 1);
  const frontierDepth = maxUnlockedDepth > 0 ? maxUnlockedDepth : 0;
  const floor = frontierDepth > 0 && combat.floorsByDepth && typeof combat.floorsByDepth === 'object'
    ? combat.floorsByDepth[String(frontierDepth)] || null
    : null;
  const championRequired = Boolean(
    floor
    && floor.unlock
    && floor.unlock.required === true
    && floor.champion
    && floor.champion.enabled !== false,
  );
  const frontierContested = championRequired && floor && floor.state === 'contested' ? 1 : 0;
  const cooldownTicks = floor && floor.encounter
    ? Math.max(0, Number(floor.encounter.cooldownTicksRemaining || 0))
    : 0;
  const cooldownBudget = getUnderrealmRetryCooldownBudget(config, combat, frontierDepth);
  const championCooldown = cooldownBudget > 0
    ? clamp(cooldownTicks / cooldownBudget, 0, 1)
    : 0;
  const readinessGate = state && state.ruins && state.ruins.readinessGate
    && typeof state.ruins.readinessGate === 'object'
    ? state.ruins.readinessGate
    : {};
  const readinessSnapshot = floor && floor.readinessSnapshot && typeof floor.readinessSnapshot === 'object'
    ? floor.readinessSnapshot
    : {};
  const readinessStatus = String(
    readinessGate.status
    || readinessSnapshot.status
    || 'unknown',
  );
  const readinessScoreRaw = Number(
    readinessGate.score !== undefined ? readinessGate.score : readinessSnapshot.score,
  );
  const readinessRecommendedRaw = Number(
    readinessGate.recommendedScore !== undefined
      ? readinessGate.recommendedScore
      : readinessSnapshot.recommendedScore,
  );
  const readinessMinRaw = Number(
    readinessGate.minScore !== undefined ? readinessGate.minScore : readinessSnapshot.minScore,
  );
  const readinessScore = Math.max(0, readinessScoreRaw || 0);
  const readinessRecommended = Math.max(0, readinessRecommendedRaw || 0);
  const readinessMin = Math.max(0, readinessMinRaw || 0);
  const readinessScale = readinessRecommended > 0
    ? readinessRecommended
    : (readinessMin > 0 ? readinessMin : 1);
  const readinessScoreRatio = clamp(readinessScore / readinessScale, 0, 1);
  const readinessGap = clamp((readinessScale - readinessScore) / readinessScale, 0, 1);
  const readinessBlocked = readinessStatus === 'blocked' ? 1 : 0;
  const readinessWarning = readinessStatus === 'warning' ? 1 : 0;
  const failedExpeditions = Math.max(0, Number(stats.failedExpeditions || 0));
  const blockedDispatches = Math.max(0, Number(stats.blockedDispatches || 0));
  const failurePressure = clamp(
    failedExpeditions / Math.max(1, failedExpeditions + championsDefeated + 1),
    0,
    1,
  );
  const blockedPressure = clamp(
    blockedDispatches / Math.max(1, blockedDispatches + championsDefeated + 1),
    0,
    1,
  );
  const combatPressure = clamp(
    frontierContested * 0.35
      + readinessBlocked * 0.25
      + readinessWarning * 0.15
      + championCooldown * 0.1
      + failurePressure * 0.1
      + blockedPressure * 0.05,
    0,
    1,
  );
  return {
    depthProgress,
    championProgress,
    frontierContested,
    championCooldown,
    readinessScore: readinessScoreRatio,
    readinessGap,
    readinessBlocked,
    readinessWarning,
    combatPressure,
  };
}

// Resolve retry cooldown budget used to normalize champion cooldown ratio.
function getUnderrealmRetryCooldownBudget(config, combat, depth) {
  const combatConfig = (config && config.underrealm && config.underrealm.combat) || {};
  const encounterConfig = (combat && combat.encounter) || combatConfig.encounter || {};
  const depthValue = Math.max(1, Math.floor(Number(depth || 1)));
  const base = Math.max(
    1,
    Number(
      encounterConfig.retryCooldownTicksBase
      ?? encounterConfig.retry_cooldown_ticks_base
      ?? 90,
    ),
  );
  const perDepth = Math.max(
    0,
    Number(
      encounterConfig.retryCooldownTicksPerDepth
      ?? encounterConfig.retry_cooldown_ticks_per_depth
      ?? 20,
    ),
  );
  return Math.max(1, base + perDepth * Math.max(0, depthValue - 1));
}

// Provide a fallback weather severity by type.
function getFallbackWeatherSeverity(type) {
  const id = String(type || '').toLowerCase();
  if (id === 'storm') {
    return 0.7;
  }
  if (id === 'drought' || id === 'cold') {
    return 0.6;
  }
  if (id === 'rain') {
    return 0.3;
  }
  return 0.1;
}

// Convert season info to a normalized index.
function getSeasonIndex(season, config) {
  if (!season || !season.name) {
    return 0;
  }
  const seasons = config.seasons || {};
  const order = Array.isArray(seasons.order) && seasons.order.length > 0
    ? seasons.order
    : ['spring', 'summer', 'autumn', 'winter'];
  const index = order.indexOf(season.name);
  if (index < 0) {
    return 0;
  }
  if (order.length <= 1) {
    return 0;
  }
  return clamp(index / (order.length - 1), 0, 1);
}

// Convert season progress to a normalized 0..1 range.
function getSeasonProgress(season) {
  if (!season) {
    return 0;
  }
  const tick = Number(season.tickInSeason || 0);
  const duration = Math.max(1, Number(season.duration || 0));
  return clamp(tick / duration, 0, 1);
}

// Compute fraction of dwarves with critical needs.
function getCriticalNeedsFraction(dwarves, config) {
  if (!Array.isArray(dwarves) || dwarves.length === 0) {
    return 0;
  }
  const threshold = Number((config.ai && config.ai.criticalNeedThreshold) || 0.9);
  let critical = 0;
  for (const dwarf of dwarves) {
    const needs = dwarf.needs || {};
    const values = Object.values(needs);
    const hasCritical = values.some((value) => Number(value || 0) >= threshold);
    if (hasCritical) {
      critical += 1;
    }
  }
  return clamp(critical / dwarves.length, 0, 1);
}

// Compute the fraction of idle adults.
function getIdleAdultsFraction(dwarves) {
  if (!Array.isArray(dwarves) || dwarves.length === 0) {
    return 0;
  }
  let adults = 0;
  let idleAdults = 0;
  for (const dwarf of dwarves) {
    if (dwarf.lifeStage !== 'adult') {
      continue;
    }
    adults += 1;
    if (!dwarf.job) {
      idleAdults += 1;
    }
  }
  if (adults <= 0) {
    return 0;
  }
  return clamp(idleAdults / adults, 0, 1);
}

// Compute population balance vs. configured housing target.
function getPopulationBalance(state, config) {
  const reproduction = config.population && config.population.reproduction;
  const softCap = Number(reproduction && reproduction.softCap || 0);
  if (softCap <= 0) {
    return 1;
  }
  const ratio = 1 - Math.abs(state.dwarves.length - softCap) / softCap;
  return clamp(ratio, 0, 1);
}

// Compute housing stats for AI observation.
function getHousingStats(state, config) {
  const housingConfig = (config.population && config.population.housing) || {};
  const housingEnabled = housingConfig.enabled !== false;
  const houses = housingEnabled
    ? (state.structures || []).filter((structure) => structure.type === 'house')
    : [];
  const bedsTotal = houses.reduce((sum, house) => sum + Math.max(0, Number(house.capacity || 0)), 0);
  const population = Math.max(1, state.dwarves.length);
  const housingRatio = housingEnabled
    ? (bedsTotal > 0 ? bedsTotal / population : 0)
    : 1;
  return {
    housingEnabled,
    houses,
    population,
    housingRatio,
  };
}

// Build ruins observation scalars.
function buildRuinsObservation(state, config) {
  const ruinsConfig = (config && config.ruins) || {};
  if (ruinsConfig.enabled === false) {
    return { active: 0, cooldownRatio: 0, progress: 0, artifacts: 0 };
  }
  const ruins = state && state.ruins ? state.ruins : null;
  if (!ruins) {
    return { active: 0, cooldownRatio: 0, progress: 0, artifacts: 0 };
  }
  const rooms = Array.isArray(ruinsConfig.rooms) ? ruinsConfig.rooms : [];
  const roomCount = rooms.length > 0 ? rooms.length : 1;
  const progress = clamp(Number(ruins.roomsCleared || 0) / roomCount, 0, 1);
  const pool = ruinsConfig.artifacts && ruinsConfig.artifacts.pool
    ? ruinsConfig.artifacts.pool
    : {};
  const totalArtifacts = Object.keys(pool).length;
  const found = ruins.artifactsFound ? Object.keys(ruins.artifactsFound).length : 0;
  const artifacts = totalArtifacts > 0 ? clamp(found / totalArtifacts, 0, 1) : 0;
  const expeditionConfig = ruinsConfig.expedition || {};
  const maxCooldown = Math.max(
    1,
    Number(expeditionConfig.cooldownTicks || 0),
    Number(expeditionConfig.failureCooldownTicks || 0),
  );
  const cooldownRatio = clamp(Number(ruins.cooldown || 0) / maxCooldown, 0, 1);
  const active = Array.isArray(ruins.expeditions) && ruins.expeditions.length > 0 ? 1 : 0;
  return {
    active,
    cooldownRatio,
    progress,
    artifacts,
  };
}

// Build myths observation scalars.
function buildMythsObservation(state, config) {
  const mythsConfig = (config && config.myths) || {};
  if (mythsConfig.enabled === false || !state || !state.myths) {
    return { activeRatio: 0, severity: 0, flags: {} };
  }
  const defs = mythsConfig.definitions || {};
  const activeIds = Object.keys(state.myths.active || {});
  const maxActive = Math.max(1, Number(mythsConfig.maxActive || activeIds.length || 1));
  const activeRatio = clamp(activeIds.length / maxActive, 0, 1);
  const traditions = state.myths.traditions || {};
  let totalSeverity = 0;
  let count = 0;
  for (const mythId of activeIds) {
    const def = defs[mythId];
    const effects = def && def.effects;
    const severity = getEffectsSeverity(effects);
    if (severity > 0) {
      totalSeverity += severity;
      count += 1;
    }
  }
  for (const mythId of Object.keys(traditions)) {
    const def = defs[mythId];
    const effects = def && def.traditionEffects;
    const severity = getEffectsSeverity(effects);
    if (severity > 0) {
      totalSeverity += severity;
      count += 1;
    }
  }
  const severity = count > 0 ? clamp(totalSeverity / count, 0, 1) : 0;
  const flags = {};
  for (const mythId of Object.keys(defs)) {
    flags[mythId] = activeIds.includes(mythId) ? 1 : 0;
  }
  return { activeRatio, severity, flags };
}

// Compute average absolute deviation from 1 for a multiplier map.
function getEffectsSeverity(effects) {
  if (!effects || typeof effects !== 'object') {
    return 0;
  }
  let total = 0;
  let count = 0;
  for (const value of Object.values(effects)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      continue;
    }
    total += Math.abs(1 - numeric);
    count += 1;
  }
  return count > 0 ? total / count : 0;
}

// Compute clan share fractions across adults.
function getClanShares(state, config) {
  const clanList = getClanList(config);
  if (clanList.length === 0) {
    return {};
  }
  const shares = {};
  for (const clanId of clanList) {
    shares[clanId] = getClanShare(state.dwarves || [], clanId, (dwarf) => dwarf.lifeStage === 'adult');
  }
  return shares;
}

// Build raid-related observation metrics.
function getRaidObservation(state, config, housingStats) {
  const raidConfig = (config && config.raids) || {};
  const raidState = state.raid || {};
  if (!raidState) {
    return {
      active: false,
      timeLeftRatio: 0,
      exposedRatio: 0,
      defenseRatio: 0,
      seasonEligible: 0,
    };
  }

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
  const defenseRatio = clamp(defenseRaw + towerDefense, 0, 1);

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
    timeLeft: timeLeftRatio,
    exposed: exposedRatio,
    defense: defenseRatio,
  };
}

// Compute resource node ratios for observations.
function getNodeRatio(nodes) {
  const totals = {};
  const remaining = {};

  for (const node of nodes) {
    if (!node || !node.id) {
      continue;
    }
    const capacity = Math.max(0, Number(node.capacity || 0));
    const remain = Math.max(0, Number(node.remaining || 0));
    totals[node.id] = Number(totals[node.id] || 0) + capacity;
    remaining[node.id] = Number(remaining[node.id] || 0) + remain;
  }

  const ratios = {};
  for (const [resource, total] of Object.entries(totals)) {
    ratios[resource] = total > 0 ? clamp(remaining[resource] / total, 0, 1) : 0;
  }

  return ratios;
}

module.exports = { buildObservation, buildFeatures };
