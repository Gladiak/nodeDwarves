'use strict';

// Plain-language colony report for the in-game telemetry panel ([h]).
// Pure, read-only builders: they turn simulation state into short rows with a
// GOOD / WATCH / BAD verdict and one sentence explaining what the value means.

const { describeModifiers } = require('../simulation/modifier_ledger');
const { getStockpileTarget } = require('../simulation/resources');
const { getFestivalStatus } = require('../simulation/festivals');
const { getWorldEventStatus } = require('../simulation/world_events');
const { getExternalCampStatus } = require('../simulation/external_camps');
const { getSchismStatus } = require('../simulation/schism');
const { getSocialDramaStatus } = require('../simulation/social_drama');
const { getEpicConflictStatus } = require('../simulation/epic_conflicts');
const { getLandmarkStatus } = require('../simulation/landmarks');

const STATUS_GOOD = 'good';
const STATUS_WATCH = 'watch';
const STATUS_BAD = 'bad';
const STATUS_INFO = 'info';
const STATUS_RANK = { [STATUS_INFO]: 0, [STATUS_GOOD]: 1, [STATUS_WATCH]: 2, [STATUS_BAD]: 3 };
const ESSENTIAL_RESOURCES = ['food', 'water', 'beer'];
const MATERIAL_RESOURCES = ['wood', 'stone', 'iron'];
const TRACKED_HISTORY_RESOURCES = [...ESSENTIAL_RESOURCES, ...MATERIAL_RESOURCES];
const RARE_RESOURCES = ['mithril', 'adamantium', 'mana_crystal', 'embersteel', 'ironshade', 'void_shard', 'ember_resin', 'expedition_kit'];
const DEFAULT_THRESHOLDS = {
  stock_watch_ratio: 0.5,
  stock_bad_ratio: 0.25,
  morale_watch: 0.45,
  morale_bad: 0.3,
  shortage_watch_score: 1.5,
  shortage_bad_score: 2.5,
  runway_watch_ticks: 800,
  housing_watch_ratio: 1.0,
  housing_bad_ratio: 0.8,
  population_decline_watch: 0.03,
  population_decline_bad: 0.1,
  conflict_watch: 0.3,
  conflict_bad: 0.5,
};
const MAX_ATTENTION_ITEMS = 5;
const CRITICAL_STOCK_EFFECTS = {
  food: 'dwarves may starve',
  water: 'dwarves may die of thirst',
  beer: 'morale will sink',
};

// Resolve report thresholds from config (display.telemetry_panel.status_thresholds) and color alerts.
function resolveReportThresholds(config, alertConfig) {
  const panel = config && config.display && config.display.telemetry_panel;
  const source = panel && panel.status_thresholds && typeof panel.status_thresholds === 'object'
    ? panel.status_thresholds
    : {};
  const alerts = alertConfig && typeof alertConfig === 'object' ? alertConfig : {};
  const pick = (key, alertKey) => {
    const own = Number(source[key]);
    if (Number.isFinite(own)) {
      return own;
    }
    const fromAlerts = Number(alerts[alertKey]);
    return Number.isFinite(fromAlerts) ? fromAlerts : DEFAULT_THRESHOLDS[key];
  };
  const resolved = {
    stock_watch_ratio: pick('stock_watch_ratio', 'stockpile_warning_ratio'),
    stock_bad_ratio: pick('stock_bad_ratio', 'stockpile_critical_ratio'),
    morale_watch: pick('morale_watch', 'morale_warning'),
    morale_bad: pick('morale_bad', 'morale_critical'),
    shortage_watch_score: pick('shortage_watch_score', 'shortage_warning_score'),
    shortage_bad_score: pick('shortage_bad_score', 'shortage_critical_score'),
  };
  for (const key of Object.keys(DEFAULT_THRESHOLDS)) {
    if (resolved[key] === undefined) {
      resolved[key] = pick(key, null);
    }
  }
  resolved.stock_watch_ratio = Math.max(resolved.stock_bad_ratio, resolved.stock_watch_ratio);
  resolved.morale_watch = Math.max(resolved.morale_bad, resolved.morale_watch);
  resolved.housing_watch_ratio = Math.max(resolved.housing_bad_ratio, resolved.housing_watch_ratio);
  resolved.conflict_bad = Math.max(resolved.conflict_watch, resolved.conflict_bad);
  return resolved;
}

// Return the worse of two statuses (info < good < watch < bad).
function worstStatus(...statuses) {
  return statuses.reduce((worst, status) => (
    (STATUS_RANK[status] || 0) > (STATUS_RANK[worst] || 0) ? status : worst
  ), STATUS_INFO);
}

// Resolve the length of one in-game year in ticks (used as the trend window).
function resolveYearTicks(config) {
  const seasons = (config && config.seasons) || {};
  const order = Array.isArray(seasons.order) && seasons.order.length > 0 ? seasons.order.length : 4;
  return Math.max(1, Number(seasons.durationTicks || 200)) * order;
}

// Return one history-sample payload: tracked stock ratios, morale and population.
function buildHistorySample(state, config) {
  const sample = {
    tick: Math.max(0, Math.floor(Number(state && state.tick || 0))),
    morale: averageDwarfValue(state, (dwarf) => dwarf.state && dwarf.state.morale),
    population: Array.isArray(state && state.dwarves) ? state.dwarves.length : 0,
  };
  for (const id of TRACKED_HISTORY_RESOURCES) {
    sample[id] = resolveStock(state, config, id).ratio;
  }
  return sample;
}

// Read the trend of one history key over a tick window (delta and slope per tick).
function readHistoryTrend(history, key, lookbackTicks) {
  const list = Array.isArray(history) ? history : [];
  if (list.length < 2) {
    return { delta: 0, slopePerTick: 0, ticks: 0, known: false };
  }
  const latest = list[list.length - 1];
  const latestValue = Number(latest && latest[key]);
  if (!Number.isFinite(latestValue)) {
    return { delta: 0, slopePerTick: 0, ticks: 0, known: false };
  }
  const targetTick = Math.max(0, Number(latest.tick || 0) - Math.max(1, lookbackTicks));
  let baseline = list[0];
  for (let index = list.length - 2; index >= 0; index -= 1) {
    baseline = list[index];
    if (Number(baseline && baseline.tick || 0) <= targetTick) {
      break;
    }
  }
  const baselineValue = Number(baseline && baseline[key]);
  const ticks = Math.max(0, Number(latest.tick || 0) - Number(baseline && baseline.tick || 0));
  if (!Number.isFinite(baselineValue) || ticks <= 0) {
    return { delta: 0, slopePerTick: 0, ticks: 0, known: false };
  }
  const delta = latestValue - baselineValue;
  return { delta, slopePerTick: delta / ticks, ticks, known: true };
}

// Average one numeric dwarf property, ignoring missing values.
function averageDwarfValue(state, selector) {
  const dwarves = Array.isArray(state && state.dwarves) ? state.dwarves : [];
  let total = 0;
  let count = 0;
  for (const dwarf of dwarves) {
    const value = Number(dwarf ? selector(dwarf) : Number.NaN);
    if (Number.isFinite(value)) {
      total += value;
      count += 1;
    }
  }
  return count > 0 ? total / count : 0;
}

// Resolve current stock, target and ratio for one resource (ratio null when no target).
function resolveStock(state, config, resourceId) {
  const current = Math.max(0, Number(state && state.stockpile ? state.stockpile[resourceId] || 0 : 0));
  const target = Math.max(0, Number(getStockpileTarget(state, config, resourceId) || 0));
  return {
    id: resourceId,
    label: resolveResourceLabel(config, resourceId),
    current,
    target,
    ratio: target > 0 ? current / target : null,
  };
}

// Resolve the configured player-facing label for a resource.
function resolveResourceLabel(config, resourceId) {
  const labels = (config && config.resources && config.resources.labels) || {};
  const configured = String(labels[resourceId] || '').trim();
  if (configured) {
    return configured;
  }
  return String(resourceId || '-')
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// Count adults by what they are doing right now.
function collectWorkforce(dwarves) {
  const counts = { adults: 0, idle: 0, working: 0, underrealm: 0, expedition: 0 };
  for (const dwarf of dwarves) {
    if (!dwarf || (dwarf.lifeStage && dwarf.lifeStage !== 'adult')) {
      continue;
    }
    counts.adults += 1;
    const deepDuty = dwarf.underrealmDuty
      && dwarf.underrealmDuty.active !== false
      && Number(dwarf.underrealmDuty.depth || 0) > 0;
    if (deepDuty) {
      counts.underrealm += 1;
    } else if (dwarf.expedition) {
      counts.expedition += 1;
    } else if (dwarf.job) {
      counts.working += 1;
    } else {
      counts.idle += 1;
    }
  }
  return counts;
}

// Group active jobs into a few readable categories.
function collectJobMix(jobs) {
  const mix = { gather: 0, mine: 0, build: 0, craft: 0, other: 0, total: 0 };
  for (const job of jobs) {
    const type = String(job && job.type || '');
    mix.total += 1;
    if (type === 'gather' || type === 'hunt') {
      mix.gather += 1;
    } else if (type === 'mine') {
      mix.mine += 1;
    } else if (type === 'build' || type.startsWith('upgrade')) {
      mix.build += 1;
    } else if (type === 'craft' || type === 'brew') {
      mix.craft += 1;
    } else {
      mix.other += 1;
    }
  }
  return mix;
}

// Count dwarves per life stage.
function countLifeStages(dwarves) {
  const counts = { adult: 0, child: 0, elder: 0 };
  for (const dwarf of dwarves) {
    const stage = String(dwarf && dwarf.lifeStage || 'adult');
    counts[Object.prototype.hasOwnProperty.call(counts, stage) ? stage : 'adult'] += 1;
  }
  return counts;
}

// Count structures by type.
function countStructures(structures) {
  const counts = {};
  for (const structure of structures) {
    const type = String(structure && structure.type || '');
    if (type) {
      counts[type] = (counts[type] || 0) + 1;
    }
  }
  return counts;
}

// Return the first telemetry-section row starting with a prefix, without the prefix.
function findSectionValue(sections, sectionKey, prefix) {
  const section = sections && sections[sectionKey];
  const rows = section && Array.isArray(section.rows) ? section.rows : [];
  for (const raw of rows) {
    const row = String(raw || '').replace(/\u001b\[[0-9;]*m/g, '');
    if (row.startsWith(prefix)) {
      return row.slice(prefix.length).trim();
    }
  }
  return '';
}

// Collect every fact the report pages need in one read-only pass.
function collectColonyFacts(state, config, context = {}) {
  const safeState = state && typeof state === 'object' ? state : {};
  const safeConfig = config && typeof config === 'object' ? config : {};
  const dwarves = Array.isArray(safeState.dwarves) ? safeState.dwarves : [];
  const jobs = Array.isArray(safeState.jobs) ? safeState.jobs : [];
  const structures = Array.isArray(safeState.structures) ? safeState.structures : [];
  const thresholds = resolveReportThresholds(safeConfig, context.alertConfig);
  const history = Array.isArray(context.history) ? context.history : [];
  const yearTicks = resolveYearTicks(safeConfig);
  const housingEnabled = !(safeConfig.population && safeConfig.population.housing
    && safeConfig.population.housing.enabled === false);
  const beds = structures
    .filter((structure) => structure && structure.type === 'house')
    .reduce((sum, house) => sum + Math.max(0, Number(house.capacity || 0)), 0);
  const stocks = {};
  for (const id of [...TRACKED_HISTORY_RESOURCES, ...RARE_RESOURCES]) {
    stocks[id] = resolveStock(safeState, safeConfig, id);
    stocks[id].trend = readHistoryTrend(history, id, yearTicks);
  }
  const season = safeState.season || {};
  const underrealm = safeState.underrealm && typeof safeState.underrealm === 'object' ? safeState.underrealm : null;
  const discovery = underrealm && underrealm.discovery ? underrealm.discovery : {};
  const deepRaids = underrealm && underrealm.deepFaction && underrealm.deepFaction.activeRaidsByDepth
    ? Object.values(underrealm.deepFaction.activeRaidsByDepth)
      .filter((entry) => entry && Number(entry.ticksRemaining || 0) > 0).length
    : 0;
  const ruins = safeState.ruins && typeof safeState.ruins === 'object' ? safeState.ruins : null;
  const temple = safeState.temple && typeof safeState.temple === 'object' ? safeState.temple : null;
  const contracts = safeState.contracts && typeof safeState.contracts === 'object' ? safeState.contracts : null;
  const worldEvents = safeState.worldEvents && typeof safeState.worldEvents === 'object' ? safeState.worldEvents : null;
  const tick = Math.max(0, Math.floor(Number(safeState.tick || 0)));
  const sections = typeof context.getSections === 'function' ? context.getSections() : null;

  return {
    tick,
    year: Math.floor(Math.max(0, tick - 1) / yearTicks) + 1,
    season: season.name ? String(season.name).charAt(0).toUpperCase() + String(season.name).slice(1) : '-',
    seasonTicksLeft: Math.max(0, Number(season.duration || 0) - Number(season.tickInSeason || 0)),
    cyclesCompleted: Math.max(0, Number(safeState.cycleStats && safeState.cycleStats.count || 0)),
    prestige: Math.round(Math.max(0, Number(safeState.prestige && safeState.prestige.total || 0))),
    prestigeRank: safeState.prestige && safeState.prestige.rank ? String(safeState.prestige.rank) : 'Unproven',
    yearTicks,
    configForText: safeConfig,
    historyKnown: history.length >= 2,
    thresholds,
    stocks,
    morale: averageDwarfValue(safeState, (dwarf) => dwarf.state && dwarf.state.morale),
    stress: averageDwarfValue(safeState, (dwarf) => dwarf.state && dwarf.state.stress),
    moraleTrend: readHistoryTrend(history, 'morale', yearTicks),
    population: dwarves.length,
    populationTrend: readHistoryTrend(history, 'population', yearTicks),
    stages: countLifeStages(dwarves),
    births: Math.max(0, Number(safeState.birthsCount || 0)),
    deaths: Math.max(0, Number(safeState.deathsCount || 0)),
    deathsByCause: safeState.deathsByCause || {},
    council: safeState.steward && typeof safeState.steward === 'object' ? safeState.steward : null,
    modifiers: {
      foodYield: describeModifiers(safeState, 'gatherYield', 'food'),
      waterYield: describeModifiers(safeState, 'gatherYield', 'water'),
      needPace: describeModifiers(safeState, 'needDecay', 'colony'),
    },
    housingEnabled,
    beds,
    workforce: collectWorkforce(dwarves),
    jobMix: collectJobMix(jobs),
    shortages: (Array.isArray(safeState.lastPriorities) ? safeState.lastPriorities : [])
      .filter((entry) => entry && entry.resource)
      .slice(0, 2)
      .map((entry) => ({
        id: String(entry.resource),
        label: resolveResourceLabel(safeConfig, String(entry.resource)),
        urgency: Math.max(0, Number(entry.score || 0)),
      })),
    raid: {
      active: Boolean(safeState.raid && safeState.raid.active),
      ticksLeft: Math.max(0, Number(safeState.raid && safeState.raid.ticksRemaining || 0)),
      stats: safeState.raidStats || {},
    },
    deepRaids,
    epic: getEpicConflictStatus(safeState),
    social: getSocialDramaStatus(safeState, safeConfig),
    socialCounts: sections ? findSectionValue(sections, 'social', 'Status counts:') : '',
    schism: getSchismStatus(safeState, safeConfig),
    schismConfig: safeConfig.schism || {},
    festival: getFestivalStatus(safeState, safeConfig),
    worldEvent: getWorldEventStatus(safeState, safeConfig),
    worldEventNextIn: worldEvents && Number(worldEvents.nextSpawnTick || 0) > tick
      ? Number(worldEvents.nextSpawnTick) - tick
      : 0,
    camps: getExternalCampStatus(safeState, safeConfig),
    landmarks: getLandmarkStatus(safeState, safeConfig),
    underrealm: {
      enabled: Boolean(underrealm && underrealm.enabled !== false),
      gateFound: discovery.enabled === false || discovery.found === true,
      gatePopulation: Math.max(0, Number(discovery.populationThreshold || 0)),
      unlocked: Math.max(0, Number(underrealm && underrealm.maxUnlockedDepth || 0)),
      maxDepth: Math.max(0, Number(underrealm && underrealm.maxDepth || 0)),
      crew: Math.max(0, Number(underrealm && underrealm.crew && underrealm.crew.totalAssigned || 0)),
      progression: sections ? findSectionValue(sections, 'underrealm', 'Depth progression:') : '',
    },
    ruins: ruins && ruins.enabled !== false ? {
      cleared: Math.max(0, Number(ruins.roomsCleared || 0)),
      rooms: Math.max(0, Number(ruins.roomCount || 0)),
      expeditions: Array.isArray(ruins.expeditions) ? ruins.expeditions.length : 0,
      artifacts: Math.max(0, Number(ruins.stats && ruins.stats.artifacts || 0)),
      gate: ruins.readinessGate || null,
    } : null,
    temple: temple && temple.enabled !== false ? {
      stage: Math.max(0, Number(temple.stage || 0)),
      maxStage: Math.max(0, Number(temple.maxStage || 0)),
    } : null,
    tools: safeState.tools ? {
      level: Math.max(0, Number(safeState.tools.level || 0)),
      maxLevel: Math.max(1, Number(safeState.tools.maxLevel || 1)),
    } : null,
    structureCounts: countStructures(structures),
    trades: Math.max(0, Number(safeState.merchantStats && safeState.merchantStats.trades || 0)),
    contractActive: contracts && contracts.active ? {
      label: String(contracts.active.factionLabel || contracts.active.factionId || 'Contract'),
      ticksLeft: Math.max(0, Math.round(Number(contracts.active.expiresAt || 0) - tick)),
    } : null,
    contractStats: contracts && contracts.stats ? contracts.stats : {},
    warriors: sections ? {
      league: findSectionValue(sections, 'warriorLeague', 'League:'),
      champion: findSectionValue(sections, 'warriorLeague', 'Champion:').replace(/\s*<[^>]*>/g, ''),
      season: findSectionValue(sections, 'warriorLeague', 'Season:'),
    } : null,
  };
}

// Format a ratio as a whole percentage.
function pct(ratio) {
  return `${Math.max(0, Math.round(Number(ratio || 0) * 100))}%`;
}

// Format a compact count (1.2k, 3.4M).
function compact(value) {
  const numeric = Math.max(0, Number(value || 0));
  if (numeric >= 1e6) {
    return `${(numeric / 1e6).toFixed(1)}M`;
  }
  if (numeric >= 1e4) {
    return `${Math.round(numeric / 1e3)}k`;
  }
  if (numeric >= 1e3) {
    return `${(numeric / 1e3).toFixed(1)}k`;
  }
  return String(Math.round(numeric));
}

// Describe a tick span in seasons for readability ("~2 seasons").
function describeTicks(ticks, config) {
  const seasonTicks = Math.max(1, Number(config && config.seasons && config.seasons.durationTicks || 200));
  const seasons = ticks / seasonTicks;
  if (seasons < 1) {
    return `${Math.max(1, Math.round(ticks))} ticks`;
  }
  const rounded = Math.round(seasons);
  return `~${rounded} season${rounded === 1 ? '' : 's'}`;
}

// Describe a one-year ratio change in words ("up 12 pts in a year").
function describeTrend(delta) {
  const points = Math.round(Number(delta || 0) * 100);
  if (points === 0) {
    return 'steady over the year';
  }
  return `${points > 0 ? 'up' : 'down'} ${Math.abs(points)} pts in a year`;
}

// Evaluate one essential or building stock: status, value and meaning.
function assessStock(stock, facts, config, essential) {
  const t = facts.thresholds;
  if (stock.ratio === null) {
    return {
      label: stock.label,
      status: STATUS_INFO,
      value: `${compact(stock.current)} in store`,
      note: 'No target set for this resource.',
    };
  }
  const trend = stock.trend;
  const value = `${pct(stock.ratio)} of target`;
  const withTrend = (text) => (trend.known
    ? `${text} ${describeTrend(trend.delta)}.`
    : `${text.replace(/[;,]\s*$/, '')}.`);
  const runway = trend.known && trend.slopePerTick < 0
    ? Math.max(0, (stock.ratio - t.stock_watch_ratio) / Math.abs(trend.slopePerTick))
    : Number.POSITIVE_INFINITY;
  if (stock.ratio <= t.stock_bad_ratio) {
    return {
      label: stock.label,
      status: essential ? STATUS_BAD : STATUS_WATCH,
      value,
      note: withTrend(essential
        ? `Critically low: ${CRITICAL_STOCK_EFFECTS[stock.id] || 'the colony will feel it'};`
        : 'Very low: building and upgrades stall;'),
    };
  }
  if (stock.ratio <= t.stock_watch_ratio) {
    return {
      label: stock.label,
      status: STATUS_WATCH,
      value,
      note: withTrend('Below half of target, gatherers focus on it;'),
    };
  }
  if (essential && stock.ratio < 1.5 && runway < t.runway_watch_ticks) {
    return {
      label: stock.label,
      status: STATUS_WATCH,
      value,
      note: `Falling: under half of target in ${describeTicks(runway, config)}.`,
    };
  }
  if (stock.ratio < 1) {
    return { label: stock.label, status: STATUS_GOOD, value, note: withTrend('Close to target;') };
  }
  return { label: stock.label, status: STATUS_GOOD, value, note: withTrend('Comfortable buffer;') };
}

// Evaluate average morale.
function assessMorale(facts) {
  const t = facts.thresholds;
  const value = `${pct(facts.morale)} (stress ${pct(facts.stress)})`;
  if (facts.population === 0) {
    return { label: 'Morale', status: STATUS_INFO, value: '-', note: 'No dwarves left.' };
  }
  if (facts.morale <= t.morale_bad) {
    return { label: 'Morale', status: STATUS_BAD, value, note: 'Miserable: beer, food and festivals are needed now.' };
  }
  if (facts.morale <= t.morale_watch) {
    return { label: 'Morale', status: STATUS_WATCH, value, note: 'Unhappy: keep beer flowing and avoid shortages.' };
  }
  return { label: 'Morale', status: STATUS_GOOD, value, note: 'Dwarves are content.' };
}

// Evaluate population size and its yearly trend.
function assessPopulation(facts) {
  const t = facts.thresholds;
  const trend = facts.populationTrend;
  const change = trend.known ? Math.round(trend.delta) : 0;
  const changeText = trend.known ? ` (${change > 0 ? '+' : ''}${change} in a year)` : '';
  const value = `${facts.population} dwarves${changeText}`;
  if (facts.population === 0) {
    return { label: 'Population', status: STATUS_BAD, value, note: 'The colony has died out.' };
  }
  const base = Math.max(1, facts.population - change);
  const decline = trend.known && change < 0 ? -change / base : 0;
  if (decline >= t.population_decline_bad) {
    return { label: 'Population', status: STATUS_BAD, value, note: 'Shrinking fast: check deaths on the People page.' };
  }
  if (decline >= t.population_decline_watch) {
    return { label: 'Population', status: STATUS_WATCH, value, note: 'Slowly shrinking: more deaths than births.' };
  }
  if (change > 0) {
    return { label: 'Population', status: STATUS_GOOD, value, note: 'Growing.' };
  }
  return { label: 'Population', status: STATUS_GOOD, value, note: trend.known ? 'Stable.' : 'Trend appears after a while.' };
}

// Evaluate housing (beds per dwarf).
function assessHousing(facts) {
  const t = facts.thresholds;
  if (!facts.housingEnabled) {
    return { label: 'Housing', status: STATUS_INFO, value: 'disabled', note: 'Housing rules are off.' };
  }
  const ratio = facts.population > 0 ? facts.beds / facts.population : 1;
  const value = `${facts.beds} beds for ${facts.population}`;
  if (ratio < t.housing_bad_ratio) {
    return { label: 'Housing', status: STATUS_BAD, value, note: 'Overcrowded: fewer births and harsher winters.' };
  }
  if (ratio < t.housing_watch_ratio) {
    return { label: 'Housing', status: STATUS_WATCH, value, note: 'Some dwarves sleep outside: fewer births, harsher winters.' };
  }
  return { label: 'Housing', status: STATUS_GOOD, value, note: 'Everyone has a bed.' };
}

// Evaluate current physical threats (raids, deep raids, sieges).
function assessSafety(facts) {
  const siege = facts.epic && facts.epic.activeSiege;
  if (siege) {
    return {
      label: 'Safety',
      status: STATUS_BAD,
      value: `siege by ${siege.nemesisName}`,
      note: `Nemesis siege in progress (${siege.stage}).`,
    };
  }
  if (facts.raid.active) {
    return { label: 'Safety', status: STATUS_BAD, value: 'raid in progress', note: `Raiders attack for ${facts.raid.ticksLeft} more ticks.` };
  }
  if (facts.deepRaids > 0) {
    return { label: 'Safety', status: STATUS_BAD, value: `${facts.deepRaids} deep raid(s)`, note: 'The Underrealm crews are under attack.' };
  }
  const stats = facts.raid.stats || {};
  const lastTick = Number(stats.lastRaidTick || 0);
  const note = lastTick > 0
    ? `Last raid ${describeTicks(Math.max(0, facts.tick - lastTick), facts.configForText)} ago, ${Math.max(0, Number(stats.lastRaidDeaths || 0))} died.`
    : 'No raid so far.';
  return { label: 'Safety', status: STATUS_GOOD, value: 'no attack under way', note };
}

// Evaluate how much of the adult workforce is busy.
function assessWorkforce(facts) {
  const w = facts.workforce;
  const busy = w.working + w.underrealm + w.expedition;
  const share = w.adults > 0 ? busy / w.adults : 0;
  const value = `${busy} of ${w.adults} adults busy (${pct(share)})`;
  const topShortage = facts.shortages[0];
  if (topShortage && topShortage.urgency >= facts.thresholds.shortage_watch_score && w.idle > busy) {
    return {
      label: 'Workforce',
      status: STATUS_WATCH,
      value,
      note: `${topShortage.label} is short while ${w.idle} adults are idle.`,
    };
  }
  return {
    label: 'Workforce',
    status: STATUS_INFO,
    value,
    note: share < 0.35 ? 'Plenty of free hands: jobs, not workers, are the limit.' : 'Most adults are at work.',
  };
}

// Evaluate the social schism arc (pressure phases and climax).
function assessSchism(facts) {
  const s = facts.schism;
  if (!s || s.enabled === false) {
    return null;
  }
  const phase = String(s.phase || 'concord');
  const value = `${phase} (pressure ${pct(s.pressure)}, legitimacy ${pct(s.legitimacy)})`;
  if (s.climaxActive) {
    return { label: 'Schism', status: STATUS_BAD, value, note: 'Open crisis: the factions are clashing right now.' };
  }
  if (phase === 'reckoning') {
    return { label: 'Schism', status: STATUS_BAD, value, note: 'Close to breaking point: a crisis can erupt.' };
  }
  if (phase === 'fracture') {
    return { label: 'Schism', status: STATUS_WATCH, value, note: 'Factions are pulling apart; rites and decrees calm them.' };
  }
  if (phase === 'murmurs') {
    return { label: 'Schism', status: STATUS_GOOD, value, note: 'Some grumbling, nothing serious yet.' };
  }
  return { label: 'Schism', status: STATUS_GOOD, value, note: 'The colony is united.' };
}

// Evaluate social conflict between dwarves.
function assessConflict(facts) {
  const social = facts.social;
  if (!social || !social.enabled) {
    return null;
  }
  const t = facts.thresholds;
  const value = `conflict ${pct(social.conflictPressure)}, bonds ${pct(social.cohesion)}`;
  if (social.conflictPressure >= t.conflict_bad) {
    return { label: 'Relations', status: STATUS_BAD, value, note: 'Rivalries and grudges dominate daily life.' };
  }
  if (social.conflictPressure >= t.conflict_watch) {
    return { label: 'Relations', status: STATUS_WATCH, value, note: 'Rivalries are spreading.' };
  }
  return { label: 'Relations', status: STATUS_GOOD, value, note: 'Few quarrels; friendships hold the colony together.' };
}

// Explain one modifier-ledger quantity: combined multiplier and its strongest factors.
function describeModifierRow(label, entry, meaning) {
  if (!entry) {
    return null;
  }
  const movers = entry.movers.map(([name, value]) => `${name} x${value.toFixed(2)}`).join(', ');
  const capped = entry.multiplier !== entry.raw ? ' (capped)' : '';
  return {
    label,
    status: STATUS_INFO,
    value: `x${entry.multiplier.toFixed(2)}${capped}`,
    note: movers ? `${meaning}: ${movers}.` : `${meaning}: no active modifiers.`,
  };
}

// Describe the council (steward) posture when no AI policy decides the governors.
function assessCouncil(facts) {
  const council = facts.council;
  if (!council) {
    return null;
  }
  const held = Number(council.restrained || 0);
  const sources = council.sources || null;
  const heldText = (held > 0 ? `${held} venture group${held === 1 ? '' : 's'} held back` : 'nothing held back')
    + (sources ? `; decided by policy ${sources.policy}, council ${sources.council}, defaults ${sources.default}` : '');
  if (council.posture === 'cautious' && Number(council.cautious || 0) > 0) {
    return {
      label: 'Council',
      status: STATUS_INFO,
      value: 'cautious',
      note: `Reserves ${Number(council.reservePerCapita || 0).toFixed(1)} per dwarf (needs ${council.threshold}): risky ventures paused; ${heldText}.`,
    };
  }
  return { label: 'Council', status: STATUS_INFO, value: held > 0 ? 'restrained' : 'open', note: `Council posture: ${heldText}.` };
}

// Build the overall verdict and the "needs attention" list.
function assessColony(facts, config) {
  const vitals = [
    ...ESSENTIAL_RESOURCES.map((id) => assessStock(facts.stocks[id], facts, config, true)),
    assessMorale(facts),
    assessPopulation(facts),
    assessHousing(facts),
    assessSafety(facts),
    assessWorkforce(facts),
  ];
  const extras = [assessSchism(facts), assessConflict(facts), assessCouncil(facts)].filter(Boolean);
  const overall = worstStatus(...vitals.map((row) => row.status), ...extras.map((row) => row.status));
  const attention = [];
  for (const row of [...vitals, ...extras]) {
    if (row.status === STATUS_BAD) {
      attention.push({ status: STATUS_BAD, text: `${row.label}: ${row.note}` });
    }
  }
  for (const row of [...vitals, ...extras]) {
    if (row.status === STATUS_WATCH) {
      attention.push({ status: STATUS_WATCH, text: `${row.label}: ${row.note}` });
    }
  }
  if (facts.worldEvent && facts.worldEvent.active) {
    attention.push({
      status: STATUS_INFO,
      text: `World event "${facts.worldEvent.label}" is open for ${facts.worldEvent.ticksLeft} ticks${facts.worldEvent.requestSummary ? `: ${facts.worldEvent.requestSummary}` : ''}.`,
    });
  }
  let summary;
  if (overall === STATUS_BAD) {
    summary = 'Trouble: fix the red items below first, expansion can wait.';
  } else if (overall === STATUS_WATCH) {
    summary = 'Mostly fine, but a few areas are slipping; see the yellow items.';
  } else {
    summary = 'Healthy colony: stocks on target, dwarves content, no attack under way.';
  }
  if (attention.length === 0) {
    attention.push({
      status: STATUS_GOOD,
      text: 'Nothing urgent. Spare effort goes into upgrades, landmarks and the Underrealm.',
    });
  }
  return { overall, summary, vitals, extras, attention: attention.slice(0, MAX_ATTENTION_ITEMS) };
}

// Build the long-term progress rows shown on the status page.
function buildProgressRows(facts) {
  const rows = [];
  const u = facts.underrealm;
  if (u.enabled) {
    let value;
    let note;
    if (!u.gateFound) {
      value = 'gate not found';
      note = u.gatePopulation > 0 ? `The hidden gate appears once the colony nears ${u.gatePopulation} dwarves.` : 'The hidden gate has not been found yet.';
    } else {
      value = `depth ${u.unlocked} of ${u.maxDepth} open`;
      note = u.crew > 0 ? `${u.crew} dwarves work below.` : 'No crew assigned yet.';
    }
    rows.push({ label: 'Underrealm', status: STATUS_INFO, value, note });
  }
  if (facts.temple) {
    rows.push({
      label: 'Temple',
      status: STATUS_INFO,
      value: `stage ${facts.temple.stage} of ${facts.temple.maxStage}`,
      note: 'Each stage adds prestige and colony bonuses.',
    });
  }
  const landmarks = facts.landmarks;
  if (landmarks && landmarks.enabled !== false) {
    const entries = Array.isArray(landmarks.entries) ? landmarks.entries : [];
    const damaged = entries.filter((entry) => ['damaged', 'abandoned'].includes(entry.condition)).length;
    rows.push({
      label: 'Landmarks',
      status: damaged > 0 ? STATUS_WATCH : STATUS_INFO,
      value: `${Math.max(0, Number(landmarks.completed || 0))} of ${entries.length} complete`,
      note: damaged > 0 ? `${damaged} damaged or abandoned.` : 'Great works that grow in stages.',
    });
  }
  if (facts.ruins) {
    rows.push({
      label: 'Ruins',
      status: STATUS_INFO,
      value: `${facts.ruins.cleared} of ${facts.ruins.rooms} rooms explored`,
      note: facts.ruins.artifacts === 1 ? '1 artifact recovered.' : `${facts.ruins.artifacts} artifacts recovered.`,
    });
  }
  if (facts.tools) {
    rows.push({
      label: 'Tools',
      status: STATUS_INFO,
      value: `level ${facts.tools.level} of ${facts.tools.maxLevel}`,
      note: 'Better tools speed up every job.',
    });
  }
  return rows;
}

// Build the Colony Status page blocks.
function buildStatusPage(facts, assessment) {
  return [
    {
      title: 'Vitals',
      intro: 'The basics that keep the colony alive.',
      rows: assessment.vitals,
    },
    {
      title: 'Needs attention',
      intro: 'Most urgent first.',
      lines: assessment.attention,
    },
    {
      title: 'Long-term progress',
      intro: 'Goals that build up over years.',
      rows: [assessment.extras.find((row) => row.label === 'Council'), ...buildProgressRows(facts)].filter(Boolean),
    },
  ];
}

// Build the Economy page blocks.
function buildEconomyPage(facts, config) {
  const blocks = [];
  blocks.push({
    title: 'Essentials',
    intro: '100% = the stock the colony aims to keep.',
    rows: ESSENTIAL_RESOURCES.map((id) => ({ ...assessStock(facts.stocks[id], facts, config, true), bar: facts.stocks[id].ratio })),
  });
  const modifierRows = [
    describeModifierRow('Food yield', facts.modifiers.foodYield, 'Per gathering trip'),
    describeModifierRow('Water yield', facts.modifiers.waterYield, 'Per gathering trip'),
    describeModifierRow('Need pace', facts.modifiers.needPace, 'Hunger and thirst speed'),
  ].filter(Boolean);
  if (modifierRows.length > 0) {
    blocks.push({ title: 'What drives the economy', intro: 'Active multipliers, strongest first.', rows: modifierRows });
  }
  blocks.push({
    title: 'Building materials',
    intro: 'Needed for new structures and upgrades.',
    rows: MATERIAL_RESOURCES.map((id) => ({ ...assessStock(facts.stocks[id], facts, config, false), bar: facts.stocks[id].ratio })),
  });
  const rare = RARE_RESOURCES
    .map((id) => facts.stocks[id])
    .filter((stock) => stock && stock.current > 0)
    .map((stock) => `${stock.label} ${compact(stock.current)}`);
  blocks.push({
    title: 'Rare goods',
    intro: 'Deep and crafted materials for gear and late projects.',
    lines: [{ status: STATUS_INFO, text: rare.length > 0 ? rare.join(' | ') : 'None stored yet.' }],
  });
  const w = facts.workforce;
  const mix = facts.jobMix;
  const topShortage = facts.shortages[0];
  const workRows = [
    {
      label: 'Adults',
      status: STATUS_INFO,
      value: `${w.working} working, ${w.idle} idle`,
      note: `${w.underrealm} below ground, ${w.expedition} on expeditions.`,
    },
    {
      label: 'Jobs',
      status: STATUS_INFO,
      value: `${mix.total} active`,
      note: `gather ${mix.gather}, mine ${mix.mine}, build ${mix.build}, craft ${mix.craft}, other ${mix.other}.`,
    },
  ];
  if (topShortage) {
    const t = facts.thresholds;
    const status = topShortage.urgency >= t.shortage_bad_score
      ? STATUS_BAD
      : topShortage.urgency >= t.shortage_watch_score ? STATUS_WATCH : STATUS_GOOD;
    workRows.push({
      label: 'Top priority',
      status,
      value: `${topShortage.label} (urgency ${topShortage.urgency.toFixed(1)})`,
      note: status === STATUS_GOOD
        ? 'Routine restocking, nothing pressing.'
        : `Above ${t.shortage_watch_score} means a real shortage; gatherers focus on it.`,
    });
  } else {
    workRows.push({ label: 'Top priority', status: STATUS_GOOD, value: 'none', note: 'No shortage is driving work right now.' });
  }
  blocks.push({ title: 'Work', intro: 'What the adults are doing.', rows: workRows });
  const stats = facts.contractStats || {};
  const contractTotal = Math.max(0, Number(stats.successes || 0)) + Math.max(0, Number(stats.failures || 0));
  const camps = facts.camps && facts.camps.byRole ? facts.camps.byRole : {};
  blocks.push({
    title: 'Trade & neighbours',
    intro: 'Merchants, faction contracts and nearby camps.',
    rows: [
      { label: 'Merchants', status: STATUS_INFO, value: `${facts.trades} trades`, note: 'Surplus is swapped for what is missing.' },
      {
        label: 'Contracts',
        status: contractTotal > 0 && Number(stats.failures || 0) / contractTotal > 0.34 ? STATUS_WATCH : STATUS_INFO,
        value: contractTotal > 0 ? `${Number(stats.successes || 0)} won, ${Number(stats.failures || 0)} failed` : 'none yet',
        note: facts.contractActive
          ? `Working for ${facts.contractActive.label} (${facts.contractActive.ticksLeft} ticks left).`
          : 'No contract open right now.',
      },
      {
        label: 'Camps',
        status: Number(camps.raider || 0) > Number(camps.militia || 0) ? STATUS_WATCH : STATUS_INFO,
        value: `${Number(camps.trade || 0)} trade, ${Number(camps.militia || 0)} militia, ${Number(camps.raider || 0)} raider`,
        note: Number(camps.raider || 0) > 0 ? 'Raider camps raise the risk of attacks.' : 'No hostile camp nearby.',
      },
    ],
  });
  const counts = facts.structureCounts;
  const named = [
    ['house', 'house', 'houses'], ['field', 'field', 'fields'], ['well', 'well', 'wells'],
    ['mine', 'mine', 'mines'], ['brewery', 'brewery', 'breweries'], ['workshop', 'workshop', 'workshops'],
    ['sawmill', 'sawmill', 'sawmills'], ['armory', 'armory', 'armories'], ['watchtower', 'tower', 'towers'],
  ].filter(([type]) => counts[type] > 0)
    .map(([type, one, many]) => `${counts[type]} ${counts[type] === 1 ? one : many}`);
  blocks.push({
    title: 'Buildings',
    intro: 'Main structures in the village.',
    lines: [{ status: STATUS_INFO, text: named.length > 0 ? named.join(', ') : 'No structures yet.' }],
  });
  return blocks;
}

// Build the People page blocks.
function buildPeoplePage(facts, assessment) {
  const blocks = [];
  const pick = (label) => assessment.vitals.find((row) => row.label === label);
  const festival = facts.festival || {};
  const moodRows = [pick('Morale')];
  moodRows.push({
    label: 'Festival',
    status: STATUS_INFO,
    value: festival.active ? `${festival.label || 'festival'} on` : 'none',
    note: festival.active ? `${Math.max(0, Number(festival.ticksLeft || 0))} ticks left; lifts morale.` : 'Festivals lift morale when stocks allow.',
  });
  blocks.push({ title: 'Mood', intro: 'How the dwarves feel.', rows: moodRows });

  const causes = Object.entries(facts.deathsByCause || {})
    .filter(([, value]) => Number(value) > 0)
    .sort((left, right) => Number(right[1]) - Number(left[1]))
    .map(([cause, value]) => `${humanizeCause(cause)} ${value}`);
  blocks.push({
    title: 'Population',
    intro: 'Who lives here and how lives end.',
    rows: [
      pick('Population'),
      {
        label: 'Ages',
        status: STATUS_INFO,
        value: `${facts.stages.adult} adults, ${facts.stages.child} children`,
        note: `${facts.stages.elder} elders.`,
      },
      {
        label: 'Births/deaths',
        status: STATUS_INFO,
        value: `${facts.births} / ${facts.deaths}`,
        note: causes.length > 0 ? `Deaths: ${causes.join(', ')}.` : 'No deaths so far.',
      },
      pick('Housing'),
    ],
  });

  const community = [];
  const conflict = assessment.extras.find((row) => row.label === 'Relations');
  if (conflict) {
    community.push(conflict);
  }
  if (facts.socialCounts) {
    community.push({ label: 'Ties', status: STATUS_INFO, value: facts.socialCounts.replace(/,\s*/g, ', '), note: '' });
  }
  const schism = assessment.extras.find((row) => row.label === 'Schism');
  if (schism) {
    community.push(schism);
    const s = facts.schism;
    const acts = [];
    if (s.ritualActive && s.ritualLabel) {
      acts.push(`rite "${s.ritualLabel}"`);
    }
    if (s.decreeActive && s.decreeLabel) {
      acts.push(`decree "${s.decreeLabel}"`);
    }
    community.push({
      label: 'Doctrine',
      status: STATUS_INFO,
      value: String(s.doctrine || '-'),
      note: acts.length > 0 ? `In force: ${acts.join(', ')}.` : 'No rite or decree in force.',
    });
  }
  if (community.length > 0) {
    blocks.push({
      title: 'Community',
      intro: 'Friendships, rivalries and the political mood.',
      rows: community,
    });
  }
  return blocks;
}

// Turn a death-cause key into words.
function humanizeCause(cause) {
  const map = { oldAge: 'old age', deepRaid: 'deep raids', raid: 'raids', hunt: 'hunting', ruins: 'ruins', starvation: 'starvation' };
  return map[cause] || String(cause).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

// Build the Frontier & Defense page blocks.
function buildFrontierPage(facts, assessment) {
  const blocks = [];
  const raidStats = facts.raid.stats || {};
  const epic = facts.epic || {};
  const epicStats = epic.stats || {};
  const threatRows = [assessment.vitals.find((row) => row.label === 'Safety')];
  threatRows.push({
    label: 'Raid record',
    status: STATUS_INFO,
    value: `${Math.max(0, Number(raidStats.count || 0))} raids, ${Math.max(0, Number(raidStats.deaths || 0))} deaths`,
    note: 'Watchtowers, armories and militia reduce losses.',
  });
  threatRows.push({
    label: 'Nemeses',
    status: epic.activeSiege ? STATUS_BAD : STATUS_INFO,
    value: `${Math.max(0, Number(epic.activeNemeses || 0))} active`,
    note: `Sieges: ${Math.max(0, Number(epicStats.colonyVictories || 0))} held, ${Math.max(0, Number(epicStats.nemesisVictories || 0))} lost.`,
  });
  blocks.push({ title: 'Threats', intro: 'Who can hurt the colony.', rows: threatRows });

  const u = facts.underrealm;
  if (u.enabled) {
    const rows = buildProgressRows(facts).filter((row) => row.label === 'Underrealm');
    if (u.gateFound && u.progression) {
      rows.push({ label: 'Next depth', status: STATUS_INFO, value: u.progression, note: '' });
    }
    if (facts.deepRaids > 0) {
      rows.push({ label: 'Deep raids', status: STATUS_BAD, value: `${facts.deepRaids} active`, note: 'Deep crews are fighting.' });
    }
    blocks.push({ title: 'Underrealm', intro: 'The deep levels below the colony.', rows });
  }

  if (facts.ruins) {
    const gate = facts.ruins.gate;
    const rows = buildProgressRows(facts).filter((row) => row.label === 'Ruins');
    if (gate && gate.status) {
      const blocked = String(gate.status) === 'blocked';
      rows.push({
        label: 'Expedition',
        status: blocked ? STATUS_WATCH : STATUS_GOOD,
        value: `party strength ${Number(gate.score || 0).toFixed(0)} / ${Number(gate.minScore || 0).toFixed(0)} needed`,
        note: blocked ? 'Too weak to go deeper: better gear and fighters help.' : 'Ready to push deeper.',
      });
    }
    blocks.push({ title: 'Ruins', intro: 'Expeditions into the ancient ruins.', rows });
  }

  if (facts.warriors && facts.warriors.champion) {
    blocks.push({
      title: 'Warriors',
      intro: 'Press [w] for the full Warrior League.',
      rows: [
        { label: 'League', status: STATUS_INFO, value: facts.warriors.league || '-', note: facts.warriors.season },
        { label: 'Champion', status: STATUS_INFO, value: facts.warriors.champion, note: '' },
      ],
    });
  }

  const event = facts.worldEvent || {};
  blocks.push({
    title: 'World events',
    intro: 'Timed requests and opportunities.',
    rows: [event.active
      ? {
        label: 'Now',
        status: STATUS_WATCH,
        value: `${event.label} (${event.ticksLeft} ticks left)`,
        note: event.requestSummary || 'Meet the request before time runs out.',
      }
      : {
        label: 'Now',
        status: STATUS_INFO,
        value: 'none',
        note: facts.worldEventNextIn > 0 ? `Next one in about ${facts.worldEventNextIn} ticks.` : '',
      }],
  });
  return blocks;
}

// Build a complete report (header facts, verdict and the requested page blocks).
function buildColonyReport(pageId, state, config, context = {}) {
  const facts = collectColonyFacts(state, config, context);
  const assessment = assessColony(facts, config);
  let blocks = [];
  if (pageId === 'status') {
    blocks = buildStatusPage(facts, assessment);
  } else if (pageId === 'economy') {
    blocks = buildEconomyPage(facts, config);
  } else if (pageId === 'people') {
    blocks = buildPeoplePage(facts, assessment);
  } else if (pageId === 'frontier') {
    blocks = buildFrontierPage(facts, assessment);
  }
  return {
    header: `Year ${facts.year}, ${facts.season} | tick ${facts.tick} | cycles completed ${facts.cyclesCompleted} | prestige ${facts.prestige} (${facts.prestigeRank})`,
    overall: assessment.overall,
    summary: assessment.summary,
    trendNote: facts.historyKnown ? '' : 'Trends need about a year of play to appear.',
    blocks: blocks.map((block) => ({
      ...block,
      rows: Array.isArray(block.rows) ? block.rows.filter(Boolean) : undefined,
    })),
  };
}

module.exports = {
  STATUS_GOOD,
  STATUS_WATCH,
  STATUS_BAD,
  STATUS_INFO,
  buildColonyReport,
  buildHistorySample,
  collectColonyFacts,
  assessColony,
  resolveReportThresholds,
  resolveYearTicks,
};
