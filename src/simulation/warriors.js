'use strict';

const { clamp } = require('../utils');
const { getClanEffects } = require('../clans');
const { buildDwarfLore } = require('../dwarf_lore');
const { pushEvent } = require('./events');

const WARRIOR_LEAGUE_EPITHETS = [
  'Gauntlet',
  'Crucible',
  'Conclave',
  'Tribunal',
  'Crown',
  'Aegis',
  'Dominion',
  'Arena',
];

// Clamp a numeric value to the 0..1 interval.
function clampUnit(value) {
  return clamp(Number(value || 0), 0, 1);
}

// Hash a string into a stable unsigned 32-bit integer.
function hashString(value) {
  const text = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// Mix an integer seed to improve value distribution.
function mixSeed(seed) {
  let value = Number(seed) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return value >>> 0;
}

// Resolve one dwarf display label as `Name Surname <id>`.
function formatWarriorDisplayName(dwarf, state, config) {
  const id = String(dwarf && dwarf.id || '').trim();
  if (!id) {
    return 'Unknown <n/a>';
  }
  const lore = buildDwarfLore(dwarf, state, config);
  const name = lore && lore.name ? String(lore.name) : 'Unknown';
  return `${name} <${id}>`;
}

// Resolve one dwarf display label by id with deterministic fallback.
function formatWarriorDisplayNameById(dwarfId, state, config, nameCache = null) {
  const id = String(dwarfId || '').trim();
  if (!id) {
    return 'Unknown <n/a>';
  }
  if (nameCache && nameCache.has(id)) {
    return nameCache.get(id);
  }
  const dwarves = Array.isArray(state && state.dwarves) ? state.dwarves : [];
  const dwarf = dwarves.find((entry) => String(entry && entry.id || '') === id);
  let label = '';
  if (dwarf) {
    label = formatWarriorDisplayName(dwarf, state, config);
  } else {
    label = `Unknown <${id}>`;
  }
  if (nameCache) {
    nameCache.set(id, label);
  }
  return label;
}

// Resolve one deterministic epic Warrior League season name.
function resolveWarriorLeagueEpicName(state, config, seasonIdRaw = null) {
  const runtimeSeasonId = state
    && state.warriors
    && state.warriors.league
    && Number.isFinite(Number(state.warriors.league.lastTournamentSeasonId))
      ? Number(state.warriors.league.lastTournamentSeasonId)
      : null;
  const stateSeasonId = state
    && state.season
    && Number.isFinite(Number(state.season.globalIndex))
      ? Number(state.season.globalIndex)
      : 0;
  const seasonId = Number.isFinite(Number(seasonIdRaw))
    ? Math.max(0, Math.floor(Number(seasonIdRaw)))
    : Number.isFinite(runtimeSeasonId)
      ? Math.max(0, Math.floor(runtimeSeasonId))
      : Math.max(0, Math.floor(stateSeasonId));
  const leagueDwarf = { id: `warrior_league_${seasonId}`, state: {} };
  const lore = buildDwarfLore(leagueDwarf, state, config);
  const name = lore && lore.name ? String(lore.name) : 'Stone Hall';
  const tagSeed = hashString(`${name}:${seasonId}:warrior_league`);
  const epithet = WARRIOR_LEAGUE_EPITHETS[mixSeed(tagSeed) % WARRIOR_LEAGUE_EPITHETS.length];
  return `${name} ${epithet}`.trim();
}

// Normalize one weight map to sum to 1 with a safe fallback.
function normalizeWeightMap(raw, fallback) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const defaults = fallback && typeof fallback === 'object' ? fallback : {};
  const normalized = {};
  let total = 0;
  for (const [key, defaultValue] of Object.entries(defaults)) {
    const value = Number(source[key]);
    const safe = Number.isFinite(value) ? Math.max(0, value) : Math.max(0, Number(defaultValue || 0));
    normalized[key] = safe;
    total += safe;
  }
  if (total <= 0) {
    const keys = Object.keys(defaults);
    if (keys.length === 0) {
      return {};
    }
    const uniform = 1 / keys.length;
    const fallbackMap = {};
    for (const key of keys) {
      fallbackMap[key] = uniform;
    }
    return fallbackMap;
  }
  for (const key of Object.keys(normalized)) {
    normalized[key] /= total;
  }
  return normalized;
}

// Resolve one outcome map (`success`, `failure`, `retreat`) with numeric bounds.
function normalizeOutcomeMap(raw, fallback, options = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const defaults = fallback && typeof fallback === 'object' ? fallback : {};
  const min = Number.isFinite(Number(options.min)) ? Number(options.min) : -Infinity;
  const max = Number.isFinite(Number(options.max)) ? Number(options.max) : Infinity;
  const integer = options.integer === true;
  const normalized = {};
  for (const [key, defaultValue] of Object.entries(defaults)) {
    const numeric = Number(source[key]);
    let value = Number.isFinite(numeric) ? numeric : Number(defaultValue || 0);
    if (!Number.isFinite(value)) {
      value = Number(defaultValue || 0);
    }
    if (integer) {
      value = Math.floor(value);
    }
    if (Number.isFinite(min)) {
      value = Math.max(min, value);
    }
    if (Number.isFinite(max)) {
      value = Math.min(max, value);
    }
    normalized[key] = value;
  }
  return normalized;
}

// Normalize title-rule entries from config into a strict deterministic schema.
function normalizeTitleRules(raw, fallback = []) {
  const source = Array.isArray(raw) ? raw : [];
  const defaults = Array.isArray(fallback) ? fallback : [];
  const merged = source.length > 0 ? source : defaults;
  const rules = [];
  for (const entry of merged) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const id = String(entry.id || '').trim();
    if (!id) {
      continue;
    }
    rules.push({
      id,
      expeditionsMin: Math.max(0, Math.floor(Number(entry.expeditions_min || 0))),
      winsMin: Math.max(0, Math.floor(Number(entry.wins_min || 0))),
      riskWinsMin: Math.max(0, Math.floor(Number(entry.risk_wins_min || 0))),
      lossesMax: Math.max(0, Math.floor(Number(entry.losses_max ?? 9999))),
      valorMin: clampUnit(Number(entry.valor_min || 0)),
      ratingMin: clampUnit(Number(entry.rating_min || 0)),
    });
  }
  return rules;
}

// Normalize vow catalog map with safe numeric bounds and explicit downside multipliers.
function normalizeVowCatalog(raw, fallback = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const defaults = fallback && typeof fallback === 'object' ? fallback : {};
  const merged = Object.keys(source).length > 0 ? source : defaults;
  const normalized = {};
  for (const [vowIdRaw, vowRaw] of Object.entries(merged)) {
    const vowId = String(vowIdRaw || '').trim();
    if (!vowId || !vowRaw || typeof vowRaw !== 'object') {
      continue;
    }
    normalized[vowId] = {
      dispatchScoreBonus: clamp(Number(vowRaw.dispatch_score_bonus ?? 0), -1, 1),
      dispatchScorePenalty: clamp(Number(vowRaw.dispatch_score_penalty ?? 0), 0, 1),
      riskySuccessBonus: clamp(Number(vowRaw.risky_success_bonus ?? 0), 0, 1),
      tournamentSeedBonus: clamp(Number(vowRaw.tournament_seed_bonus ?? 0), 0, 1),
      tournamentDuelBonus: clamp(Number(vowRaw.tournament_duel_bonus ?? 0), 0, 1),
      ratingLossMultiplier: Math.max(0.1, Number(vowRaw.rating_loss_multiplier ?? 1)),
      fatigueGainMultiplier: Math.max(0.1, Number(vowRaw.fatigue_gain_multiplier ?? 1)),
      stressGainMultiplier: Math.max(0.1, Number(vowRaw.stress_gain_multiplier ?? 1)),
    };
  }
  return normalized;
}

// Normalize one list of ids to unique non-empty string entries.
function normalizeIdList(raw, maxCount = Infinity) {
  const source = Array.isArray(raw) ? raw : [];
  const limit = Math.max(0, Math.floor(Number(maxCount || 0)));
  const ids = [];
  const seen = new Set();
  for (const entry of source) {
    const id = String(entry || '').trim();
    if (!id || seen.has(id)) {
      continue;
    }
    ids.push(id);
    seen.add(id);
    if (Number.isFinite(limit) && ids.length >= limit) {
      break;
    }
  }
  return ids;
}

// Normalize outcome filters for progression rule entries.
function normalizeRuleOutcomes(raw, fallback = ['failure']) {
  const allowed = new Set(['success', 'failure', 'retreat', 'any']);
  const source = Array.isArray(raw)
    ? raw
    : (raw ? [raw] : fallback);
  const outcomes = [];
  const seen = new Set();
  for (const entry of source) {
    const value = String(entry || '').trim().toLowerCase();
    if (!value || !allowed.has(value) || seen.has(value)) {
      continue;
    }
    outcomes.push(value);
    seen.add(value);
  }
  if (outcomes.length === 0) {
    return fallback.slice();
  }
  return outcomes;
}

// Normalize scar-rule entries used by event-driven progression updates.
function normalizeScarRules(raw, fallback = []) {
  const source = Array.isArray(raw) ? raw : [];
  const defaults = Array.isArray(fallback) ? fallback : [];
  const merged = source.length > 0 ? source : defaults;
  const rules = [];
  for (const entry of merged) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const id = String(entry.id || '').trim();
    if (!id) {
      continue;
    }
    rules.push({
      id,
      outcomes: normalizeRuleOutcomes(entry.outcomes, ['failure']),
      expeditionsMin: Math.max(0, Math.floor(Number(entry.expeditions_min || 0))),
      winsMin: Math.max(0, Math.floor(Number(entry.wins_min || 0))),
      lossesMin: Math.max(0, Math.floor(Number(entry.losses_min || 0))),
      retreatsMin: Math.max(0, Math.floor(Number(entry.retreats_min || 0))),
      riskWinsMin: Math.max(0, Math.floor(Number(entry.risk_wins_min || 0))),
    });
  }
  return rules;
}

// Normalize vow-assignment rule entries.
function normalizeVowRules(raw, fallback = []) {
  const source = Array.isArray(raw) ? raw : [];
  const defaults = Array.isArray(fallback) ? fallback : [];
  const merged = source.length > 0 ? source : defaults;
  const rules = [];
  for (const entry of merged) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const id = String(entry.id || '').trim();
    if (!id) {
      continue;
    }
    rules.push({
      id,
      priority: Math.floor(Number(entry.priority || 0)),
      clanId: entry.clan_id ? String(entry.clan_id).trim() : '',
      expeditionsMin: Math.max(0, Math.floor(Number(entry.expeditions_min || 0))),
      winsMin: Math.max(0, Math.floor(Number(entry.wins_min || 0))),
      riskWinsMin: Math.max(0, Math.floor(Number(entry.risk_wins_min || 0))),
      ratingMin: clampUnit(Number(entry.rating_min || 0)),
      valorMin: clampUnit(Number(entry.valor_min || 0)),
      conditionMin: clampUnit(Number(entry.condition_min || 0)),
    });
  }
  return rules;
}

// Resolve warrior configuration with strict defaults.
function getWarriorsConfig(config) {
  const raw = config && config.warriors && typeof config.warriors === 'object'
    ? config.warriors
    : {};
  const profileRaw = raw.profile && typeof raw.profile === 'object'
    ? raw.profile
    : {};
  const tournamentsRaw = raw.tournaments && typeof raw.tournaments === 'object'
    ? raw.tournaments
    : {};
  const progressionRaw = raw.progression && typeof raw.progression === 'object'
    ? raw.progression
    : {};
  const bonusesRaw = raw.bonuses && typeof raw.bonuses === 'object'
    ? raw.bonuses
    : {};
  const marksRaw = raw.marks && typeof raw.marks === 'object'
    ? raw.marks
    : {};
  const scarsRaw = marksRaw.scars && typeof marksRaw.scars === 'object'
    ? marksRaw.scars
    : {};
  const titlesRaw = marksRaw.titles && typeof marksRaw.titles === 'object'
    ? marksRaw.titles
    : {};
  const vowsRaw = raw.vows && typeof raw.vows === 'object'
    ? raw.vows
    : {};
  const expeditionsRaw = raw.expeditions && typeof raw.expeditions === 'object'
    ? raw.expeditions
    : {};
  const expeditionsProgressionRaw = expeditionsRaw.progression && typeof expeditionsRaw.progression === 'object'
    ? expeditionsRaw.progression
    : {};
  const legacyRaw = bonusesRaw.legacy && typeof bonusesRaw.legacy === 'object'
    ? bonusesRaw.legacy
    : {};
  const legacyPointsRaw = legacyRaw.points && typeof legacyRaw.points === 'object'
    ? legacyRaw.points
    : {};

  const baseMin = clampUnit(Number(profileRaw.base_min ?? 0.25));
  const baseSpan = clampUnit(Number(profileRaw.base_span ?? 0.65));
  const adjustedSpan = Math.min(baseSpan, 1 - baseMin);
  const conditionWeights = normalizeWeightMap(
    profileRaw.condition_weights,
    {
      morale: 0.45,
      stress_inverse: 0.30,
      fatigue_inverse: 0.25,
    },
  );
  const aptitudeWeights = normalizeWeightMap(
    profileRaw.aptitude_weights,
    {
      strength: 0.40,
      dexterity: 0.35,
      vitality: 0.25,
    },
  );
  const heroPotentialWeights = normalizeWeightMap(
    profileRaw.hero_potential_weights,
    {
      base_aptitude: 0.60,
      condition: 0.40,
    },
  );
  const tournamentSeedWeights = normalizeWeightMap(
    tournamentsRaw.seed_weights,
    {
      rating: 0.35,
      valor: 0.20,
      hero_potential: 0.20,
      condition: 0.15,
      champion_survivals: 0.10,
    },
  );
  const tournamentDuelWeights = normalizeWeightMap(
    tournamentsRaw.duel_weights,
    {
      seed_score: 0.45,
      base_aptitude: 0.35,
      condition: 0.20,
    },
  );
  const tournamentScoringRaw = tournamentsRaw.scoring && typeof tournamentsRaw.scoring === 'object'
    ? tournamentsRaw.scoring
    : {};
  const tournamentScoring = {
    duelWinPoints: Math.max(0, Math.floor(Number(tournamentScoringRaw.duel_win_points ?? 3))),
    duelLossPoints: Math.max(0, Math.floor(Number(tournamentScoringRaw.duel_loss_points ?? 1))),
    byePoints: Math.max(0, Math.floor(Number(tournamentScoringRaw.bye_points ?? 1))),
    championBonusPoints: Math.max(0, Math.floor(Number(tournamentScoringRaw.champion_bonus_points ?? 5))),
  };
  const tournamentProgressionRaw = tournamentsRaw.progression
    && typeof tournamentsRaw.progression === 'object'
    ? tournamentsRaw.progression
    : {};
  const tournamentProgression = {
    ratingWinDelta: clamp(
      Number(tournamentProgressionRaw.rating_win_delta ?? 0.01),
      -1,
      1,
    ),
    ratingLossDelta: clamp(
      Number(tournamentProgressionRaw.rating_loss_delta ?? -0.006),
      -1,
      1,
    ),
    championRatingBonus: clamp(
      Number(tournamentProgressionRaw.champion_rating_bonus ?? 0.02),
      -1,
      1,
    ),
    valorWinDelta: clamp(
      Number(tournamentProgressionRaw.valor_win_delta ?? 0.008),
      -1,
      1,
    ),
    valorLossDelta: clamp(
      Number(tournamentProgressionRaw.valor_loss_delta ?? -0.004),
      -1,
      1,
    ),
    championValorBonus: clamp(
      Number(tournamentProgressionRaw.champion_valor_bonus ?? 0.02),
      -1,
      1,
    ),
  };
  const dispatchWeights = normalizeWeightMap(
    expeditionsRaw.dispatch_weights,
    {
      rating: 0.40,
      valor: 0.20,
      hero_potential: 0.20,
      champion_survivals: 0.10,
      clan_class_fit: 0.10,
    },
  );
  const restTicks = normalizeOutcomeMap(
    expeditionsRaw.rest_ticks,
    {
      success: 80,
      failure: 140,
      retreat: 110,
    },
    {
      min: 0,
      integer: true,
    },
  );
  const ratingDelta = normalizeOutcomeMap(
    expeditionsProgressionRaw.rating_delta,
    {
      success: 0.04,
      failure: -0.05,
      retreat: -0.025,
    },
    {
      min: -1,
      max: 1,
    },
  );
  const valorDelta = normalizeOutcomeMap(
    expeditionsProgressionRaw.valor_delta,
    {
      success: 0.03,
      failure: -0.035,
      retreat: -0.015,
    },
    {
      min: -1,
      max: 1,
    },
  );
  const fatigueGain = normalizeOutcomeMap(
    expeditionsProgressionRaw.fatigue_gain,
    {
      success: 0.08,
      failure: 0.16,
      retreat: 0.12,
    },
    {
      min: 0,
      max: 1,
    },
  );
  const stressGain = normalizeOutcomeMap(
    expeditionsProgressionRaw.stress_gain,
    {
      success: 0.02,
      failure: 0.08,
      retreat: 0.05,
    },
    {
      min: 0,
      max: 1,
    },
  );
  const moraleDelta = normalizeOutcomeMap(
    expeditionsProgressionRaw.morale_delta,
    {
      success: 0.02,
      failure: -0.05,
      retreat: -0.03,
    },
    {
      min: -1,
      max: 1,
    },
  );
  const scarRules = normalizeScarRules(
    scarsRaw.rules,
    [
      {
        id: 'scar_broken_guard',
        outcomes: ['failure'],
        losses_min: 1,
      },
      {
        id: 'scar_ashen_step',
        outcomes: ['retreat'],
        retreats_min: 1,
      },
      {
        id: 'scar_deep_mark',
        outcomes: ['failure', 'retreat'],
        expeditions_min: 5,
        losses_min: 2,
      },
    ],
  );
  const titleRules = normalizeTitleRules(
    titlesRaw.rules,
    [
      {
        id: 'title_pathfinder',
        expeditions_min: 3,
        wins_min: 2,
        rating_min: 0.45,
      },
      {
        id: 'title_underrealm_vanguard',
        expeditions_min: 6,
        wins_min: 4,
        risk_wins_min: 2,
        rating_min: 0.58,
        valor_min: 0.58,
      },
      {
        id: 'title_clan_paragon',
        expeditions_min: 10,
        wins_min: 7,
        risk_wins_min: 4,
        losses_max: 3,
        rating_min: 0.72,
        valor_min: 0.7,
      },
    ],
  );
  const vowCatalog = normalizeVowCatalog(
    vowsRaw.catalog,
    {
      stone_oath: {
        dispatch_score_bonus: 0.04,
        dispatch_score_penalty: 0.01,
        tournament_seed_bonus: 0.02,
        tournament_duel_bonus: 0.02,
        rating_loss_multiplier: 1.15,
        fatigue_gain_multiplier: 1.18,
        stress_gain_multiplier: 1.06,
      },
      ember_oath: {
        dispatch_score_bonus: 0.03,
        risky_success_bonus: 0.03,
        tournament_seed_bonus: 0.03,
        tournament_duel_bonus: 0.03,
        rating_loss_multiplier: 1.08,
        fatigue_gain_multiplier: 1.08,
        stress_gain_multiplier: 1.25,
      },
      lantern_oath: {
        dispatch_score_bonus: 0.025,
        dispatch_score_penalty: 0.015,
        tournament_seed_bonus: 0.04,
        tournament_duel_bonus: 0.025,
        rating_loss_multiplier: 1.04,
        fatigue_gain_multiplier: 1.2,
        stress_gain_multiplier: 1.05,
      },
    },
  );
  const vowRules = normalizeVowRules(
    vowsRaw.rules,
    [
      {
        id: 'stone_oath',
        priority: 10,
        expeditions_min: 3,
        wins_min: 2,
        rating_min: 0.5,
      },
      {
        id: 'ember_oath',
        priority: 20,
        expeditions_min: 5,
        risk_wins_min: 1,
        valor_min: 0.55,
      },
      {
        id: 'lantern_oath',
        priority: 30,
        expeditions_min: 8,
        wins_min: 5,
        rating_min: 0.62,
        condition_min: 0.55,
      },
    ],
  );
  const legacyCapFallback = clampUnit(Number(bonusesRaw.legacy_cap ?? 1));
  const legacyPoints = {
    expeditionSuccess: Math.max(0, Number(legacyPointsRaw.expedition_success ?? 1)),
    expeditionFailure: Math.max(0, Number(legacyPointsRaw.expedition_failure ?? 0.35)),
    expeditionRetreat: Math.max(0, Number(legacyPointsRaw.expedition_retreat ?? 0.25)),
    riskySuccessBonus: Math.max(0, Number(legacyPointsRaw.risky_success_bonus ?? 0.45)),
    tournamentDuelWin: Math.max(0, Number(legacyPointsRaw.tournament_duel_win ?? 0.6)),
    tournamentDuelLoss: Math.max(0, Number(legacyPointsRaw.tournament_duel_loss ?? 0.15)),
    tournamentChampionBonus: Math.max(0, Number(legacyPointsRaw.tournament_champion_bonus ?? 1.8)),
  };

  return {
    enabled: raw.enabled === true,
    profile: {
      baseMin,
      baseSpan: adjustedSpan,
      seedOffset: Math.floor(Number(profileRaw.seed_offset ?? 9101)),
      strengthSalt: Math.floor(Number(profileRaw.strength_salt ?? 211)),
      dexteritySalt: Math.floor(Number(profileRaw.dexterity_salt ?? 223)),
      vitalitySalt: Math.floor(Number(profileRaw.vitality_salt ?? 239)),
      conditionWeights,
      aptitudeWeights,
      heroPotentialWeights,
    },
    tournaments: {
      enabled: tournamentsRaw.enabled !== false,
      cadence: String(tournamentsRaw.cadence || 'season'),
      intervalSeasons: Math.max(1, Math.floor(Number(tournamentsRaw.interval_seasons ?? 1))),
      minParticipants: Math.max(2, Math.floor(Number(tournamentsRaw.min_participants ?? 4))),
      maxParticipants: Math.max(2, Math.floor(Number(tournamentsRaw.max_participants ?? 16))),
      syncUnderrealmChampion: tournamentsRaw.sync_underrealm_champion !== false,
      seedWeights: tournamentSeedWeights,
      duelWeights: tournamentDuelWeights,
      scoring: tournamentScoring,
      progression: tournamentProgression,
    },
    progression: {
      enabled: progressionRaw.enabled !== false,
      ratingStart: clampUnit(Number(progressionRaw.rating_start ?? 0.5)),
      valorStart: clampUnit(Number(progressionRaw.valor_start ?? 0.5)),
    },
    marks: {
      enabled: marksRaw.enabled !== false,
      scars: {
        enabled: scarsRaw.enabled !== false,
        maxCount: Math.max(0, Math.floor(Number(scarsRaw.max_count ?? 6))),
        rules: scarRules,
      },
      titles: {
        enabled: titlesRaw.enabled !== false,
        maxCount: Math.max(0, Math.floor(Number(titlesRaw.max_count ?? 8))),
        championId: String(titlesRaw.champion_id || 'title_league_champion'),
        rules: titleRules,
      },
    },
    vows: {
      enabled: vowsRaw.enabled !== false,
      allowReassignment: vowsRaw.allow_reassignment === true,
      rules: vowRules,
      catalog: vowCatalog,
    },
    bonuses: {
      enabled: bonusesRaw.enabled !== false,
      legacyCap: Math.max(0, Number(bonusesRaw.legacy_cap ?? 1)),
      legacy: {
        enabled: legacyRaw.enabled !== false,
        pointsCap: Math.max(1, Number(legacyRaw.points_cap ?? 120)),
        diminishingAlpha: Math.max(0.1, Number(legacyRaw.diminishing_alpha ?? 1.25)),
        personalScale: Math.max(1, Number(legacyRaw.personal_scale ?? 18)),
        personalCap: clampUnit(Number(legacyRaw.personal_cap ?? 0.28)),
        personalDispatchScale: clampUnit(
          Number(legacyRaw.personal_dispatch_scale ?? 0.45),
        ),
        personalDuelScale: clampUnit(Number(legacyRaw.personal_duel_scale ?? 0.5)),
        companyScale: Math.max(1, Number(legacyRaw.company_scale ?? 96)),
        companyCap: clampUnit(Number(legacyRaw.company_cap ?? legacyCapFallback)),
        companyRosterSize: Math.max(
          1,
          Math.floor(Number(legacyRaw.company_roster_size ?? 12)),
        ),
        companyDispatchScale: clampUnit(
          Number(legacyRaw.company_dispatch_scale ?? 0.2),
        ),
        points: legacyPoints,
      },
    },
    expeditions: {
      enabled: expeditionsRaw.enabled !== false,
      riskDepthMin: Math.max(1, Math.floor(Number(expeditionsRaw.risk_depth_min ?? 3))),
      conditionMinScore: clampUnit(Number(expeditionsRaw.condition_min_score ?? 0.35)),
      fallbackConditionMinScore: clampUnit(Number(expeditionsRaw.fallback_condition_min_score ?? 0.22)),
      strictRiskConditionGate: expeditionsRaw.strict_risk_condition_gate !== false,
      championSurvivalsFullScale: Math.max(
        1,
        Number(expeditionsRaw.champion_survivals_full_scale ?? 6),
      ),
      dispatchWeights,
      restTicks,
      progression: {
        ratingDelta,
        valorDelta,
        fatigueGain,
        stressGain,
        moraleDelta,
        riskWinBonus: clampUnit(Number(expeditionsProgressionRaw.risk_win_bonus ?? 0.02)),
      },
    },
  };
}

// Resolve deterministic seed source for warrior profile generation.
function resolveWarriorSeed(config, options = {}) {
  if (Number.isFinite(Number(options.terrainSeed))) {
    return Math.floor(Number(options.terrainSeed));
  }
  const displaySeed = config
    && config.display
    && config.display.terrain
    && Number.isFinite(Number(config.display.terrain.seed))
      ? Number(config.display.terrain.seed)
      : 0;
  return Math.floor(displaySeed);
}

// Build one deterministic base trait in the 0..1 range.
function buildDeterministicTrait(baseSeed, salt, baseMin, baseSpan) {
  const safeMin = clampUnit(baseMin);
  const safeSpan = Math.max(0, Math.min(1 - safeMin, Number(baseSpan || 0)));
  const roll = mixSeed(baseSeed + Number(salt || 0)) / 4294967295;
  return clampUnit(safeMin + roll * safeSpan);
}

// Build deterministic warrior base profile for one dwarf id.
function createDwarfWarriorBaseProfile(dwarfId, config, options = {}) {
  const warriors = getWarriorsConfig(config);
  const profile = warriors.profile || {};
  const worldSeed = resolveWarriorSeed(config, options);
  const baseSeed = hashString(`${worldSeed + Number(profile.seedOffset || 0)}:${String(dwarfId || '')}`);
  return {
    strength: buildDeterministicTrait(baseSeed, profile.strengthSalt, profile.baseMin, profile.baseSpan),
    dexterity: buildDeterministicTrait(baseSeed, profile.dexteritySalt, profile.baseMin, profile.baseSpan),
    vitality: buildDeterministicTrait(baseSeed, profile.vitalitySalt, profile.baseMin, profile.baseSpan),
  };
}

// Build current condition snapshot from dwarf runtime state.
function createDwarfWarriorConditionSnapshot(dwarf, config) {
  const warriors = getWarriorsConfig(config);
  const profile = warriors.profile || {};
  const weights = profile.conditionWeights || {};
  const dwarfState = dwarf && dwarf.state && typeof dwarf.state === 'object'
    ? dwarf.state
    : {};
  const morale = clampUnit(Number(dwarfState.morale ?? 0));
  const stress = clampUnit(Number(dwarfState.stress ?? 0));
  const fatigue = clampUnit(Number(dwarfState.fatigue ?? 0));
  const score = clampUnit(
    morale * Number(weights.morale || 0)
    + (1 - stress) * Number(weights.stress_inverse || 0)
    + (1 - fatigue) * Number(weights.fatigue_inverse || 0),
  );
  return {
    morale,
    stress,
    fatigue,
    score,
  };
}

// Resolve base aptitude score from deterministic base profile.
function computeBaseCombatAptitude(baseProfile, config) {
  const warriors = getWarriorsConfig(config);
  const profile = warriors.profile || {};
  const weights = profile.aptitudeWeights || {};
  const source = baseProfile && typeof baseProfile === 'object'
    ? baseProfile
    : {};
  return clampUnit(
    Number(source.strength || 0) * Number(weights.strength || 0)
    + Number(source.dexterity || 0) * Number(weights.dexterity || 0)
    + Number(source.vitality || 0) * Number(weights.vitality || 0),
  );
}

// Resolve hero potential from base aptitude and current condition.
function computeHeroPotential(baseAptitude, conditionScore, config) {
  const warriors = getWarriorsConfig(config);
  const profile = warriors.profile || {};
  const weights = profile.heroPotentialWeights || {};
  return clampUnit(
    Number(baseAptitude || 0) * Number(weights.base_aptitude || 0)
    + Number(conditionScore || 0) * Number(weights.condition || 0),
  );
}

// Resolve a bounded diminishing bonus from cumulative points.
function computeDiminishingBonus(points, scale, cap, alpha) {
  const safePoints = Math.max(0, Number(points || 0));
  const safeScale = Math.max(1, Number(scale || 1));
  const safeCap = clampUnit(Number(cap || 0));
  const safeAlpha = Math.max(0.1, Number(alpha || 1));
  if (safeCap <= 0 || safePoints <= 0) {
    return 0;
  }
  const ratio = safePoints / safeScale;
  const diminished = ratio / (1 + ratio * safeAlpha);
  return clampUnit(Math.min(safeCap, diminished));
}

// Resolve current personal legacy bonus for one warrior.
function resolveWarriorPersonalLegacyBonus(warrior, warriors) {
  const bonuses = warriors && warriors.bonuses ? warriors.bonuses : {};
  const legacy = bonuses && bonuses.legacy ? bonuses.legacy : {};
  if (bonuses.enabled === false || legacy.enabled === false) {
    return 0;
  }
  const pointsCap = Math.max(1, Number(legacy.pointsCap || 1));
  const points = Math.min(pointsCap, Math.max(0, Number(warrior && warrior.legacyPoints || 0)));
  return computeDiminishingBonus(
    points,
    Number(legacy.personalScale || 1),
    Number(legacy.personalCap || 0),
    Number(legacy.diminishingAlpha || 1),
  );
}

// Resolve roster-aura bonus for one dwarf when company legacy applies.
function resolveWarriorCompanyDispatchBonus(state, dwarfId, warriors) {
  const bonuses = warriors && warriors.bonuses ? warriors.bonuses : {};
  const legacy = bonuses && bonuses.legacy ? bonuses.legacy : {};
  if (bonuses.enabled === false || legacy.enabled === false) {
    return 0;
  }
  const runtime = state && state.warriors && typeof state.warriors === 'object'
    ? state.warriors
    : null;
  const company = runtime && runtime.company && typeof runtime.company === 'object'
    ? runtime.company
    : null;
  if (!company || !Array.isArray(company.rosterIds)) {
    return 0;
  }
  const safeDwarfId = String(dwarfId || '');
  if (!safeDwarfId || !company.rosterIds.includes(safeDwarfId)) {
    return 0;
  }
  return clampUnit(
    clampUnit(Number(company.legacyAura || 0))
    * clampUnit(Number(legacy.companyDispatchScale || 0)),
  );
}

// Resolve vow effect payload with neutral fallbacks.
function resolveWarriorVowEffects(warrior, warriors) {
  const neutral = {
    id: '',
    dispatchScoreBonus: 0,
    dispatchScorePenalty: 0,
    riskySuccessBonus: 0,
    tournamentSeedBonus: 0,
    tournamentDuelBonus: 0,
    ratingLossMultiplier: 1,
    fatigueGainMultiplier: 1,
    stressGainMultiplier: 1,
  };
  const vows = warriors && warriors.vows ? warriors.vows : {};
  if (vows.enabled === false) {
    return neutral;
  }
  const vowId = warrior && typeof warrior.vow === 'string'
    ? warrior.vow
    : '';
  if (!vowId) {
    return neutral;
  }
  const catalog = vows.catalog && typeof vows.catalog === 'object'
    ? vows.catalog
    : {};
  const entry = catalog[vowId];
  if (!entry || typeof entry !== 'object') {
    return neutral;
  }
  return {
    ...neutral,
    ...entry,
    id: vowId,
  };
}

// Keep one progression mark list unique and bounded.
function normalizeWarriorMarkList(raw, maxCount) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return normalizeIdList(raw, maxCount);
}

// Add one mark id to a list if room is available and id is new.
function addUniqueWarriorMark(target, id, maxCount) {
  const safeId = String(id || '').trim();
  if (!safeId) {
    return false;
  }
  const list = Array.isArray(target) ? target : [];
  const limit = Math.max(0, Math.floor(Number(maxCount || 0)));
  if (list.includes(safeId)) {
    return false;
  }
  if (limit > 0 && list.length >= limit) {
    return false;
  }
  list.push(safeId);
  return true;
}

// Ensure one dwarf has a normalized warrior runtime payload.
function ensureDwarfWarriorState(dwarf, config) {
  if (!dwarf || typeof dwarf !== 'object') {
    return null;
  }
  const dwarfId = String(dwarf.id || '');
  if (!dwarf.warrior || typeof dwarf.warrior !== 'object') {
    dwarf.warrior = createDwarfWarriorState(dwarfId, dwarf, config, {
      clanId: dwarf.clanId,
    });
  }
  const warriors = getWarriorsConfig(config);
  const progression = warriors.progression || {};
  const marks = warriors.marks || {};
  const scarMarks = marks.scars || {};
  const titleMarks = marks.titles || {};
  const vows = warriors.vows || {};
  const vowCatalog = vows.catalog && typeof vows.catalog === 'object'
    ? vows.catalog
    : {};
  const legacy = warriors && warriors.bonuses && warriors.bonuses.legacy
    ? warriors.bonuses.legacy
    : {};
  const warrior = dwarf.warrior;
  const generatedBaseProfile = createDwarfWarriorBaseProfile(dwarfId, config);
  const baseProfile = warrior.baseProfile && typeof warrior.baseProfile === 'object'
    ? warrior.baseProfile
    : {};
  warrior.baseProfile = {
    strength: clampUnit(baseProfile.strength ?? generatedBaseProfile.strength),
    dexterity: clampUnit(baseProfile.dexterity ?? generatedBaseProfile.dexterity),
    vitality: clampUnit(baseProfile.vitality ?? generatedBaseProfile.vitality),
  };
  warrior.condition = createDwarfWarriorConditionSnapshot(dwarf, config);
  warrior.baseCombatAptitude = computeBaseCombatAptitude(warrior.baseProfile, config);
  warrior.heroPotential = computeHeroPotential(
    warrior.baseCombatAptitude,
    warrior.condition.score,
    config,
  );
  warrior.rating = clampUnit(
    Number(warrior.rating ?? progression.ratingStart ?? 0.5),
  );
  warrior.valor = clampUnit(
    Number(warrior.valor ?? progression.valorStart ?? 0.5),
  );
  warrior.expeditions = Math.max(0, Math.floor(Number(warrior.expeditions || 0)));
  warrior.wins = Math.max(0, Math.floor(Number(warrior.wins || 0)));
  warrior.losses = Math.max(0, Math.floor(Number(warrior.losses || 0)));
  warrior.retreats = Math.max(0, Math.floor(Number(warrior.retreats || 0)));
  warrior.riskWins = Math.max(0, Math.floor(Number(warrior.riskWins || 0)));
  warrior.scars = normalizeWarriorMarkList(
    warrior.scars,
    Math.max(0, Number(scarMarks.maxCount || 0)),
  );
  warrior.titles = normalizeWarriorMarkList(
    warrior.titles,
    Math.max(0, Number(titleMarks.maxCount || 0)),
  );
  const vowId = typeof warrior.vow === 'string'
    ? warrior.vow
    : '';
  warrior.vow = vowId && Object.prototype.hasOwnProperty.call(vowCatalog, vowId)
    ? vowId
    : null;
  const pointsCap = Math.max(1, Number(legacy.pointsCap || 1));
  warrior.legacyPoints = Math.min(
    pointsCap,
    Math.max(0, Number(warrior.legacyPoints || 0)),
  );
  warrior.lastTournamentTick = Math.max(0, Math.floor(Number(warrior.lastTournamentTick || 0)));
  warrior.lastExpeditionTick = Math.max(0, Math.floor(Number(warrior.lastExpeditionTick || 0)));
  warrior.nextEligibleExpeditionTick = Math.max(
    0,
    Math.floor(Number(warrior.nextEligibleExpeditionTick || 0)),
  );
  warrior.clanClass = warrior.clanClass
    ? String(warrior.clanClass)
    : (dwarf.clanId ? String(dwarf.clanId) : '');
  warrior.enabled = warriors.enabled === true;
  return warrior;
}

// Resolve per-clan class fit score for risky ruins dispatches.
function resolveWarriorClanClassFit(dwarf, config) {
  const clanId = dwarf && dwarf.clanId
    ? String(dwarf.clanId)
    : '';
  if (!clanId) {
    return 0.5;
  }
  const effects = getClanEffects(config, clanId);
  const combat = Math.max(0, Number(effects.ruins_combat_bonus || 0));
  const hazard = Math.max(0, Number(effects.ruins_hazard_reduction || 0));
  return clampUnit(0.5 + combat * 0.9 + hazard * 0.7);
}

// Resolve whether one dispatch should be treated as risky for warrior ranking/progression.
function isWarriorRiskyDispatch(readiness, config) {
  const warriors = getWarriorsConfig(config);
  const expeditions = warriors.expeditions || {};
  if (warriors.enabled !== true || expeditions.enabled === false) {
    return false;
  }
  const source = readiness && typeof readiness === 'object'
    ? readiness
    : {};
  const warningDispatch = String(source.status || '') === 'warning';
  const depth = Math.max(1, Math.floor(Number(source.depth || 1)));
  return warningDispatch || depth >= Math.max(1, Math.floor(Number(expeditions.riskDepthMin || 1)));
}

// Compute one warrior dispatch profile for candidate ranking.
function computeWarriorDispatchScore(dwarf, config, options = {}) {
  const warriors = getWarriorsConfig(config);
  const expeditions = warriors.expeditions || {};
  const safeDwarf = dwarf && typeof dwarf === 'object' ? dwarf : null;
  if (!safeDwarf || warriors.enabled !== true || expeditions.enabled === false) {
    return {
      dwarf: safeDwarf,
      dwarfId: safeDwarf && safeDwarf.id ? String(safeDwarf.id) : '',
      spawnIndex: Math.max(0, Math.floor(Number(safeDwarf && safeDwarf.spawnIndex || 0))),
      underrealmChampionSurvivals: Math.max(
        0,
        Math.floor(Number(safeDwarf && safeDwarf.underrealmChampionSurvivals || 0)),
      ),
      rating: 0,
      valor: 0,
      riskWins: 0,
      conditionScore: 0,
      heroPotential: 0,
      clanClassFit: 0.5,
      personalLegacyBonus: 0,
      companyLegacyBonus: 0,
      vowId: null,
      dispatchScore: 0,
      blockedByRest: false,
      blockedByCondition: false,
      readyForRiskDispatch: true,
      readyForSafeDispatch: true,
      nextEligibleExpeditionTick: 0,
    };
  }
  const warrior = ensureDwarfWarriorState(safeDwarf, config);
  const tick = Math.max(0, Math.floor(Number(options.tick || 0)));
  const riskyDispatch = options.riskyDispatch === true
    || isWarriorRiskyDispatch(options.readiness, config);
  const condition = warrior.condition || createDwarfWarriorConditionSnapshot(safeDwarf, config);
  const rating = clampUnit(Number(warrior.rating || 0));
  const valor = clampUnit(Number(warrior.valor || 0));
  const heroPotential = clampUnit(Number(warrior.heroPotential || 0));
  const survivals = Math.max(0, Math.floor(Number(safeDwarf.underrealmChampionSurvivals || 0)));
  const survivalsNorm = clampUnit(
    survivals / Math.max(1, Number(expeditions.championSurvivalsFullScale || 1)),
  );
  const clanClassFit = resolveWarriorClanClassFit(safeDwarf, config);
  const bonuses = warriors.bonuses || {};
  const legacy = bonuses.legacy || {};
  const vowEffects = resolveWarriorVowEffects(warrior, warriors);
  const personalLegacyBonus = resolveWarriorPersonalLegacyBonus(warrior, warriors);
  const companyLegacyBonus = resolveWarriorCompanyDispatchBonus(
    options.state,
    safeDwarf.id,
    warriors,
  );
  const dispatchWeights = expeditions.dispatchWeights || {};
  const dispatchScore = clampUnit(
    rating * Number(dispatchWeights.rating || 0)
    + valor * Number(dispatchWeights.valor || 0)
    + heroPotential * Number(dispatchWeights.hero_potential || 0)
    + survivalsNorm * Number(dispatchWeights.champion_survivals || 0)
    + clanClassFit * Number(dispatchWeights.clan_class_fit || 0)
    + personalLegacyBonus * clampUnit(Number(legacy.personalDispatchScale || 0))
    + companyLegacyBonus
    + Number(vowEffects.dispatchScoreBonus || 0)
    - Number(vowEffects.dispatchScorePenalty || 0),
  );
  const nextEligibleExpeditionTick = Math.max(
    0,
    Math.floor(Number(warrior.nextEligibleExpeditionTick || 0)),
  );
  const blockedByRest = tick < nextEligibleExpeditionTick;
  const conditionThreshold = riskyDispatch
    ? clampUnit(Number(expeditions.conditionMinScore || 0))
    : clampUnit(Number(expeditions.fallbackConditionMinScore || 0));
  const blockedByCondition = condition.score < conditionThreshold;
  return {
    dwarf: safeDwarf,
    dwarfId: String(safeDwarf.id || ''),
    spawnIndex: Math.max(0, Math.floor(Number(safeDwarf.spawnIndex || 0))),
    underrealmChampionSurvivals: survivals,
    rating,
    valor,
    riskWins: Math.max(0, Math.floor(Number(warrior.riskWins || 0))),
    conditionScore: clampUnit(Number(condition.score || 0)),
    heroPotential,
    clanClassFit,
    personalLegacyBonus,
    companyLegacyBonus,
    vowId: vowEffects.id || null,
    dispatchScore,
    blockedByRest,
    blockedByCondition,
    readyForRiskDispatch: !blockedByRest && !blockedByCondition,
    readyForSafeDispatch: !blockedByRest && condition.score >= clampUnit(
      Number(expeditions.fallbackConditionMinScore || 0),
    ),
    nextEligibleExpeditionTick,
  };
}

// Deterministic risky-dispatch comparator for warrior candidates.
function compareRiskDispatchCandidates(left, right) {
  const leftEligible = left && left.readyForRiskDispatch === true ? 1 : 0;
  const rightEligible = right && right.readyForRiskDispatch === true ? 1 : 0;
  if (rightEligible !== leftEligible) {
    return rightEligible - leftEligible;
  }
  const leftScore = Number(left && left.dispatchScore || 0);
  const rightScore = Number(right && right.dispatchScore || 0);
  if (Math.abs(rightScore - leftScore) > 1e-9) {
    return rightScore - leftScore;
  }
  const leftRating = Number(left && left.rating || 0);
  const rightRating = Number(right && right.rating || 0);
  if (Math.abs(rightRating - leftRating) > 1e-9) {
    return rightRating - leftRating;
  }
  const leftValor = Number(left && left.valor || 0);
  const rightValor = Number(right && right.valor || 0);
  if (Math.abs(rightValor - leftValor) > 1e-9) {
    return rightValor - leftValor;
  }
  const leftRiskWins = Math.max(0, Math.floor(Number(left && left.riskWins || 0)));
  const rightRiskWins = Math.max(0, Math.floor(Number(right && right.riskWins || 0)));
  if (rightRiskWins !== leftRiskWins) {
    return rightRiskWins - leftRiskWins;
  }
  const leftSurvivals = Math.max(0, Math.floor(Number(left && left.underrealmChampionSurvivals || 0)));
  const rightSurvivals = Math.max(0, Math.floor(Number(right && right.underrealmChampionSurvivals || 0)));
  if (rightSurvivals !== leftSurvivals) {
    return rightSurvivals - leftSurvivals;
  }
  const leftSpawnIndex = Math.max(0, Math.floor(Number(left && left.spawnIndex || 0)));
  const rightSpawnIndex = Math.max(0, Math.floor(Number(right && right.spawnIndex || 0)));
  if (leftSpawnIndex !== rightSpawnIndex) {
    return leftSpawnIndex - rightSpawnIndex;
  }
  return String(left && left.dwarfId || '').localeCompare(String(right && right.dwarfId || ''));
}

// Check whether one scar rule can be earned for the given outcome.
function matchesScarRule(warrior, rule, outcomeKey) {
  if (!rule || typeof rule !== 'object') {
    return false;
  }
  const outcomes = Array.isArray(rule.outcomes) ? rule.outcomes : ['failure'];
  if (
    !outcomes.includes('any')
    && !outcomes.includes(String(outcomeKey || ''))
  ) {
    return false;
  }
  return (
    Number(warrior.expeditions || 0) >= Number(rule.expeditionsMin || 0)
    && Number(warrior.wins || 0) >= Number(rule.winsMin || 0)
    && Number(warrior.losses || 0) >= Number(rule.lossesMin || 0)
    && Number(warrior.retreats || 0) >= Number(rule.retreatsMin || 0)
    && Number(warrior.riskWins || 0) >= Number(rule.riskWinsMin || 0)
  );
}

// Check whether one title rule is currently satisfied.
function matchesTitleRule(warrior, rule) {
  if (!rule || typeof rule !== 'object') {
    return false;
  }
  return (
    Number(warrior.expeditions || 0) >= Number(rule.expeditionsMin || 0)
    && Number(warrior.wins || 0) >= Number(rule.winsMin || 0)
    && Number(warrior.riskWins || 0) >= Number(rule.riskWinsMin || 0)
    && Number(warrior.losses || 0) <= Number(rule.lossesMax || 0)
    && Number(warrior.valor || 0) >= Number(rule.valorMin || 0)
    && Number(warrior.rating || 0) >= Number(rule.ratingMin || 0)
  );
}

// Check whether one vow assignment rule is currently satisfied.
function matchesVowRule(dwarf, warrior, rule) {
  if (!rule || typeof rule !== 'object') {
    return false;
  }
  const clanId = dwarf && dwarf.clanId ? String(dwarf.clanId) : '';
  if (rule.clanId && rule.clanId !== clanId) {
    return false;
  }
  const condition = warrior && warrior.condition ? warrior.condition : {};
  return (
    Number(warrior.expeditions || 0) >= Number(rule.expeditionsMin || 0)
    && Number(warrior.wins || 0) >= Number(rule.winsMin || 0)
    && Number(warrior.riskWins || 0) >= Number(rule.riskWinsMin || 0)
    && Number(warrior.rating || 0) >= Number(rule.ratingMin || 0)
    && Number(warrior.valor || 0) >= Number(rule.valorMin || 0)
    && Number(condition.score || 0) >= Number(rule.conditionMin || 0)
  );
}

// Deterministic comparator for vow-rule candidates.
function compareVowRules(left, right) {
  const leftPriority = Math.floor(Number(left && left.priority || 0));
  const rightPriority = Math.floor(Number(right && right.priority || 0));
  if (rightPriority !== leftPriority) {
    return rightPriority - leftPriority;
  }
  const leftRatingMin = Number(left && left.ratingMin || 0);
  const rightRatingMin = Number(right && right.ratingMin || 0);
  if (Math.abs(rightRatingMin - leftRatingMin) > 1e-9) {
    return rightRatingMin - leftRatingMin;
  }
  const leftValorMin = Number(left && left.valorMin || 0);
  const rightValorMin = Number(right && right.valorMin || 0);
  if (Math.abs(rightValorMin - leftValorMin) > 1e-9) {
    return rightValorMin - leftValorMin;
  }
  const leftConditionMin = Number(left && left.conditionMin || 0);
  const rightConditionMin = Number(right && right.conditionMin || 0);
  if (Math.abs(rightConditionMin - leftConditionMin) > 1e-9) {
    return rightConditionMin - leftConditionMin;
  }
  const leftExpeditionsMin = Math.floor(Number(left && left.expeditionsMin || 0));
  const rightExpeditionsMin = Math.floor(Number(right && right.expeditionsMin || 0));
  if (rightExpeditionsMin !== leftExpeditionsMin) {
    return rightExpeditionsMin - leftExpeditionsMin;
  }
  const leftWinsMin = Math.floor(Number(left && left.winsMin || 0));
  const rightWinsMin = Math.floor(Number(right && right.winsMin || 0));
  if (rightWinsMin !== leftWinsMin) {
    return rightWinsMin - leftWinsMin;
  }
  const leftRiskWinsMin = Math.floor(Number(left && left.riskWinsMin || 0));
  const rightRiskWinsMin = Math.floor(Number(right && right.riskWinsMin || 0));
  if (rightRiskWinsMin !== leftRiskWinsMin) {
    return rightRiskWinsMin - leftRiskWinsMin;
  }
  return String(left && left.id || '').localeCompare(String(right && right.id || ''));
}

// Assign/upgrade vow according to deterministic rules.
function assignWarriorVow(dwarf, warrior, warriors) {
  const vows = warriors && warriors.vows ? warriors.vows : {};
  const catalog = vows.catalog && typeof vows.catalog === 'object'
    ? vows.catalog
    : {};
  if (vows.enabled === false) {
    return { changed: false, previousVow: warrior && warrior.vow ? warrior.vow : null };
  }
  const rules = Array.isArray(vows.rules) ? vows.rules : [];
  const candidates = rules
    .filter((rule) => rule && Object.prototype.hasOwnProperty.call(catalog, rule.id))
    .filter((rule) => matchesVowRule(dwarf, warrior, rule))
    .sort(compareVowRules);
  if (candidates.length === 0) {
    return { changed: false, previousVow: warrior && warrior.vow ? warrior.vow : null };
  }
  const nextVow = String(candidates[0].id || '');
  const previousVow = warrior && typeof warrior.vow === 'string'
    ? warrior.vow
    : null;
  if (previousVow === nextVow) {
    return { changed: false, previousVow };
  }
  if (previousVow && vows.allowReassignment !== true) {
    return { changed: false, previousVow };
  }
  warrior.vow = nextVow || null;
  return {
    changed: previousVow !== warrior.vow,
    previousVow,
  };
}

// Add bounded legacy points and return effective increment.
function awardWarriorLegacyPoints(warrior, amount, warriors, runtime) {
  const bonuses = warriors && warriors.bonuses ? warriors.bonuses : {};
  const legacy = bonuses && bonuses.legacy ? bonuses.legacy : {};
  if (bonuses.enabled === false || legacy.enabled === false) {
    return 0;
  }
  const increment = Math.max(0, Number(amount || 0));
  if (increment <= 0) {
    return 0;
  }
  const pointsCap = Math.max(1, Number(legacy.pointsCap || 1));
  const before = Math.min(pointsCap, Math.max(0, Number(warrior.legacyPoints || 0)));
  const after = Math.min(pointsCap, before + increment);
  warrior.legacyPoints = after;
  const gained = Math.max(0, after - before);
  if (runtime && runtime.stats && gained > 0) {
    runtime.stats.legacyPointsAwarded = Math.max(
      0,
      Number(runtime.stats.legacyPointsAwarded || 0),
    ) + gained;
  }
  return gained;
}

// Recompute company aura from roster legacy points with strict diminishing model.
function refreshWarriorCompanyLegacyAura(state, config, warriors, runtime = null) {
  const safeRuntime = runtime || ensureWarriorsRuntimeState(state, config);
  if (!safeRuntime || !safeRuntime.company || typeof safeRuntime.company !== 'object') {
    return 0;
  }
  const bonuses = warriors && warriors.bonuses ? warriors.bonuses : {};
  const legacy = bonuses && bonuses.legacy ? bonuses.legacy : {};
  if (
    bonuses.enabled === false
    || legacy.enabled === false
    || !Array.isArray(safeRuntime.company.rosterIds)
  ) {
    safeRuntime.company.legacyAura = 0;
    return 0;
  }
  const byId = new Map(
    (Array.isArray(state && state.dwarves) ? state.dwarves : [])
      .map((dwarf) => [String(dwarf && dwarf.id || ''), dwarf]),
  );
  const rosterLimit = Math.max(1, Math.floor(Number(legacy.companyRosterSize || 1)));
  const rosterIds = normalizeIdList(safeRuntime.company.rosterIds, rosterLimit);
  const pointsCap = Math.max(1, Number(legacy.pointsCap || 1));
  const totalPoints = rosterIds.reduce((sum, dwarfId) => {
    const dwarf = byId.get(dwarfId);
    const warrior = dwarf && dwarf.warrior && typeof dwarf.warrior === 'object'
      ? dwarf.warrior
      : null;
    const points = Math.min(pointsCap, Math.max(0, Number(warrior && warrior.legacyPoints || 0)));
    return sum + points;
  }, 0);
  const aura = computeDiminishingBonus(
    totalPoints,
    Number(legacy.companyScale || 1),
    Number(legacy.companyCap || 0),
    Number(legacy.diminishingAlpha || 1),
  );
  safeRuntime.company.legacyAura = clampUnit(aura);
  safeRuntime.company.rosterIds = rosterIds;
  return safeRuntime.company.legacyAura;
}

// Apply scars/titles/vow assignment for a single warrior progression event.
function applyWarriorProgressionMarks(state, config, dwarf, warrior, context = {}) {
  if (!dwarf || !warrior) {
    return {
      gainedScars: [],
      gainedTitles: [],
      vowChanged: false,
      previousVow: null,
    };
  }
  const warriors = getWarriorsConfig(config);
  const marks = warriors.marks || {};
  const runtime = context.runtime || ensureWarriorsRuntimeState(state, config);
  const gainedScars = [];
  const gainedTitles = [];

  if (marks.enabled !== false) {
    const scarMarks = marks.scars || {};
    if (scarMarks.enabled !== false) {
      const maxCount = Math.max(0, Math.floor(Number(scarMarks.maxCount || 0)));
      warrior.scars = normalizeWarriorMarkList(warrior.scars, maxCount);
      for (const rule of Array.isArray(scarMarks.rules) ? scarMarks.rules : []) {
        if (!matchesScarRule(warrior, rule, context.outcomeKey)) {
          continue;
        }
        const added = addUniqueWarriorMark(warrior.scars, rule.id, maxCount);
        if (added) {
          gainedScars.push(rule.id);
        }
      }
    }

    const titleMarks = marks.titles || {};
    if (titleMarks.enabled !== false) {
      const maxCount = Math.max(0, Math.floor(Number(titleMarks.maxCount || 0)));
      warrior.titles = normalizeWarriorMarkList(warrior.titles, maxCount);
      if (context.champion === true && titleMarks.championId) {
        const championAdded = addUniqueWarriorMark(
          warrior.titles,
          String(titleMarks.championId),
          maxCount,
        );
        if (championAdded) {
          gainedTitles.push(String(titleMarks.championId));
        }
      }
      for (const rule of Array.isArray(titleMarks.rules) ? titleMarks.rules : []) {
        if (!matchesTitleRule(warrior, rule)) {
          continue;
        }
        const added = addUniqueWarriorMark(warrior.titles, rule.id, maxCount);
        if (added) {
          gainedTitles.push(rule.id);
        }
      }
    }
  }

  const vowResult = assignWarriorVow(dwarf, warrior, warriors);
  if (runtime && runtime.stats) {
    if (gainedScars.length > 0) {
      runtime.stats.scarsAwarded = Math.max(
        0,
        Math.floor(Number(runtime.stats.scarsAwarded || 0)),
      ) + gainedScars.length;
    }
    if (gainedTitles.length > 0) {
      runtime.stats.titlesAwarded = Math.max(
        0,
        Math.floor(Number(runtime.stats.titlesAwarded || 0)),
      ) + gainedTitles.length;
    }
    if (vowResult.changed) {
      runtime.stats.vowsAssigned = Math.max(
        0,
        Math.floor(Number(runtime.stats.vowsAssigned || 0)),
      ) + 1;
    }
  }

  if (state && config) {
    const fighterLabel = formatWarriorDisplayName(dwarf, state, config);
    for (const scarId of gainedScars) {
      pushEvent(state, config, `Warrior League: ${fighterLabel} gained scar ${scarId}`);
    }
    for (const titleId of gainedTitles) {
      pushEvent(state, config, `Warrior League: ${fighterLabel} gained title ${titleId}`);
    }
    if (vowResult.changed) {
      if (vowResult.previousVow) {
        pushEvent(
          state,
          config,
          `Warrior League: ${fighterLabel} replaced vow ${vowResult.previousVow} -> ${warrior.vow}`,
        );
      } else if (warrior.vow) {
        pushEvent(state, config, `Warrior League: ${fighterLabel} swore vow ${warrior.vow}`);
      }
    }
  }

  return {
    gainedScars,
    gainedTitles,
    vowChanged: vowResult.changed === true,
    previousVow: vowResult.previousVow || null,
  };
}

// Update warrior progression payload after one expedition outcome is finalized.
function applyWarriorExpeditionOutcome(state, config, expedition, outcome, options = {}) {
  const warriors = getWarriorsConfig(config);
  const expeditions = warriors.expeditions || {};
  if (warriors.enabled !== true || expeditions.enabled === false) {
    return;
  }
  const dwarfIds = Array.isArray(expedition && expedition.dwarfIds)
    ? expedition.dwarfIds
    : [];
  if (dwarfIds.length === 0) {
    return;
  }
  const outcomeKey = outcome === 'success' || outcome === 'failure' || outcome === 'retreat'
    ? outcome
    : 'failure';
  const tick = Math.max(
    0,
    Math.floor(Number(
      Number.isFinite(Number(options.tick))
        ? options.tick
        : (state && state.tick),
    ) || 0),
  );
  const progression = expeditions.progression || {};
  const runtime = ensureWarriorsRuntimeState(state, config);
  const bonuses = warriors.bonuses || {};
  const legacy = bonuses.legacy || {};
  const legacyPoints = legacy.points || {};
  const riskyDispatch = options.riskyDispatch === true
    || isWarriorRiskyDispatch(expedition && expedition.readiness, config);
  const riskWinBonus = outcomeKey === 'success' && riskyDispatch
    ? clampUnit(Number(progression.riskWinBonus || 0))
    : 0;
  const ratingDelta = progression.ratingDelta && typeof progression.ratingDelta === 'object'
    ? progression.ratingDelta
    : {};
  const valorDelta = progression.valorDelta && typeof progression.valorDelta === 'object'
    ? progression.valorDelta
    : {};
  const fatigueGain = progression.fatigueGain && typeof progression.fatigueGain === 'object'
    ? progression.fatigueGain
    : {};
  const stressGain = progression.stressGain && typeof progression.stressGain === 'object'
    ? progression.stressGain
    : {};
  const moraleDelta = progression.moraleDelta && typeof progression.moraleDelta === 'object'
    ? progression.moraleDelta
    : {};
  const restTicks = expeditions.restTicks && typeof expeditions.restTicks === 'object'
    ? expeditions.restTicks
    : {};
  const dwarves = Array.isArray(state && state.dwarves) ? state.dwarves : [];
  const byId = new Map(
    dwarves.map((dwarf) => [String(dwarf && dwarf.id || ''), dwarf]),
  );

  for (const dwarfIdRaw of dwarfIds) {
    const dwarfId = String(dwarfIdRaw || '');
    if (!dwarfId) {
      continue;
    }
    const dwarf = byId.get(dwarfId);
    if (!dwarf) {
      continue;
    }
    const warrior = ensureDwarfWarriorState(dwarf, config);
    if (!warrior) {
      continue;
    }
    const vowEffects = resolveWarriorVowEffects(warrior, warriors);
    const vowRiskBonus = outcomeKey === 'success' && riskyDispatch
      ? clampUnit(Number(vowEffects.riskySuccessBonus || 0))
      : 0;
    const totalRiskBonus = riskWinBonus + vowRiskBonus;
    warrior.expeditions = Math.max(0, Math.floor(Number(warrior.expeditions || 0))) + 1;
    if (outcomeKey === 'success') {
      warrior.wins = Math.max(0, Math.floor(Number(warrior.wins || 0))) + 1;
      if (riskyDispatch) {
        warrior.riskWins = Math.max(0, Math.floor(Number(warrior.riskWins || 0))) + 1;
      }
    } else if (outcomeKey === 'retreat') {
      warrior.retreats = Math.max(0, Math.floor(Number(warrior.retreats || 0))) + 1;
    } else {
      warrior.losses = Math.max(0, Math.floor(Number(warrior.losses || 0))) + 1;
    }
    const ratingOutcomeDeltaRaw = Number(ratingDelta[outcomeKey] || 0);
    const ratingOutcomeDelta = ratingOutcomeDeltaRaw < 0
      ? ratingOutcomeDeltaRaw * Math.max(0.1, Number(vowEffects.ratingLossMultiplier || 1))
      : ratingOutcomeDeltaRaw;
    const valorOutcomeDeltaRaw = Number(valorDelta[outcomeKey] || 0);
    const valorOutcomeDelta = valorOutcomeDeltaRaw < 0
      ? valorOutcomeDeltaRaw * (1 + Math.max(0, Number(vowEffects.ratingLossMultiplier || 1) - 1) * 0.6)
      : valorOutcomeDeltaRaw;
    warrior.rating = clampUnit(
      Number(warrior.rating || 0)
      + ratingOutcomeDelta
      + totalRiskBonus,
    );
    warrior.valor = clampUnit(
      Number(warrior.valor || 0)
      + valorOutcomeDelta
      + totalRiskBonus * 0.75,
    );

    dwarf.state = dwarf.state && typeof dwarf.state === 'object'
      ? dwarf.state
      : {};
    dwarf.state.fatigue = clampUnit(
      Number(dwarf.state.fatigue || 0)
      + Number(fatigueGain[outcomeKey] || 0) * Math.max(0.1, Number(vowEffects.fatigueGainMultiplier || 1)),
    );
    dwarf.state.stress = clampUnit(
      Number(dwarf.state.stress || 0)
      + Number(stressGain[outcomeKey] || 0) * Math.max(0.1, Number(vowEffects.stressGainMultiplier || 1)),
    );
    dwarf.state.morale = clampUnit(
      Number(dwarf.state.morale || 0) + Number(moraleDelta[outcomeKey] || 0),
    );

    let legacyGain = 0;
    if (outcomeKey === 'success') {
      legacyGain += Number(legacyPoints.expeditionSuccess || 0);
      if (riskyDispatch) {
        legacyGain += Number(legacyPoints.riskySuccessBonus || 0);
      }
    } else if (outcomeKey === 'retreat') {
      legacyGain += Number(legacyPoints.expeditionRetreat || 0);
    } else {
      legacyGain += Number(legacyPoints.expeditionFailure || 0);
    }
    awardWarriorLegacyPoints(warrior, legacyGain, warriors, runtime);

    warrior.lastExpeditionTick = tick;
    const rest = Math.max(0, Math.floor(Number(restTicks[outcomeKey] || 0)));
    warrior.nextEligibleExpeditionTick = Math.max(
      Math.max(0, Math.floor(Number(warrior.nextEligibleExpeditionTick || 0))),
      tick + rest,
    );
    warrior.condition = createDwarfWarriorConditionSnapshot(dwarf, config);
    warrior.baseCombatAptitude = computeBaseCombatAptitude(warrior.baseProfile, config);
    warrior.heroPotential = computeHeroPotential(
      warrior.baseCombatAptitude,
      warrior.condition.score,
      config,
    );
    applyWarriorProgressionMarks(state, config, dwarf, warrior, {
      outcomeKey,
      source: 'expedition',
      tick,
      runtime,
    });
  }
  refreshWarriorCompanyLegacyAura(state, config, warriors, runtime);
}

// Ensure top-level warrior runtime payload exists and has normalized shape.
function ensureWarriorsRuntimeState(state, config) {
  if (!state || typeof state !== 'object') {
    return null;
  }
  const defaults = createWarriorsState(config);
  if (!state.warriors || typeof state.warriors !== 'object') {
    state.warriors = defaults;
    return state.warriors;
  }
  const runtime = state.warriors;
  runtime.enabled = defaults.enabled;
  runtime.company = runtime.company && typeof runtime.company === 'object'
    ? runtime.company
    : {};
  runtime.company.rosterIds = Array.isArray(runtime.company.rosterIds)
    ? runtime.company.rosterIds
    : [];
  runtime.company.hallOfFame = Array.isArray(runtime.company.hallOfFame)
    ? runtime.company.hallOfFame
    : [];
  runtime.company.legacyAura = clampUnit(Number(runtime.company.legacyAura || 0));
  runtime.league = runtime.league && typeof runtime.league === 'object'
    ? runtime.league
    : {};
  runtime.league.seasonId = Number.isFinite(Number(runtime.league.seasonId))
    ? Math.max(0, Math.floor(Number(runtime.league.seasonId)))
    : 0;
  runtime.league.lastTournamentSeasonId = Number.isFinite(Number(runtime.league.lastTournamentSeasonId))
    ? Math.floor(Number(runtime.league.lastTournamentSeasonId))
    : -1;
  runtime.league.lastTournamentSeasonName = typeof runtime.league.lastTournamentSeasonName === 'string'
    ? runtime.league.lastTournamentSeasonName
    : '';
  runtime.league.lastTournamentLeagueName = typeof runtime.league.lastTournamentLeagueName === 'string'
    ? runtime.league.lastTournamentLeagueName
    : '';
  runtime.league.clanScoreById = runtime.league.clanScoreById
    && typeof runtime.league.clanScoreById === 'object'
    ? runtime.league.clanScoreById
    : {};
  runtime.league.ranking = Array.isArray(runtime.league.ranking)
    ? runtime.league.ranking
    : [];
  runtime.league.championId = typeof runtime.league.championId === 'string'
    ? runtime.league.championId
    : null;
  runtime.league.lastTournamentTick = Math.max(
    0,
    Math.floor(Number(runtime.league.lastTournamentTick || 0)),
  );
  runtime.stats = runtime.stats && typeof runtime.stats === 'object'
    ? runtime.stats
    : {};
  runtime.stats.tournaments = Math.max(0, Math.floor(Number(runtime.stats.tournaments || 0)));
  runtime.stats.tieBreaks = Math.max(0, Math.floor(Number(runtime.stats.tieBreaks || 0)));
  runtime.stats.upsets = Math.max(0, Math.floor(Number(runtime.stats.upsets || 0)));
  runtime.stats.scarsAwarded = Math.max(0, Math.floor(Number(runtime.stats.scarsAwarded || 0)));
  runtime.stats.titlesAwarded = Math.max(0, Math.floor(Number(runtime.stats.titlesAwarded || 0)));
  runtime.stats.vowsAssigned = Math.max(0, Math.floor(Number(runtime.stats.vowsAssigned || 0)));
  runtime.stats.legacyPointsAwarded = Math.max(0, Number(runtime.stats.legacyPointsAwarded || 0));
  return runtime;
}

// Resolve a stable season index for cadence-gated warrior updates.
function resolveWarriorSeasonIndex(state) {
  const season = state && state.season ? state.season : null;
  if (!season) {
    return null;
  }
  if (Number.isFinite(Number(season.globalIndex))) {
    return Math.max(0, Math.floor(Number(season.globalIndex)));
  }
  if (Number.isFinite(Number(season.index))) {
    return Math.max(0, Math.floor(Number(season.index)));
  }
  return null;
}

// Check whether one dwarf is eligible as a Warrior League tournament participant.
function isWarriorLeagueAdult(dwarf) {
  return Boolean(
    dwarf
    && String(dwarf.lifeStage || '') === 'adult'
    && dwarf.expedition !== true,
  );
}

// Add points to one clan bucket in a score map.
function addClanLeaguePoints(scoreByClan, clanId, points) {
  const key = clanId ? String(clanId) : '';
  if (!key) {
    return;
  }
  const safePoints = Math.max(0, Number(points || 0));
  scoreByClan[key] = Math.max(0, Number(scoreByClan[key] || 0)) + safePoints;
}

// Build tournament seed-entry payload for one candidate.
function buildTournamentSeedEntry(dwarf, config, warriors) {
  const warrior = ensureDwarfWarriorState(dwarf, config);
  if (!warrior) {
    return null;
  }
  const tournaments = warriors && warriors.tournaments ? warriors.tournaments : {};
  const expeditions = warriors && warriors.expeditions ? warriors.expeditions : {};
  const bonuses = warriors && warriors.bonuses ? warriors.bonuses : {};
  const legacy = bonuses && bonuses.legacy ? bonuses.legacy : {};
  const seedWeights = tournaments.seedWeights || {};
  const championSurvivals = Math.max(
    0,
    Math.floor(Number(dwarf && dwarf.underrealmChampionSurvivals || 0)),
  );
  const survivalsNorm = clampUnit(
    championSurvivals / Math.max(1, Number(expeditions.championSurvivalsFullScale || 1)),
  );
  const vowEffects = resolveWarriorVowEffects(warrior, warriors);
  const personalLegacyBonus = resolveWarriorPersonalLegacyBonus(warrior, warriors);
  const seedScore = clampUnit(
    Number(warrior.rating || 0) * Number(seedWeights.rating || 0)
    + Number(warrior.valor || 0) * Number(seedWeights.valor || 0)
    + Number(warrior.heroPotential || 0) * Number(seedWeights.hero_potential || 0)
    + Number(warrior.condition && warrior.condition.score || 0) * Number(seedWeights.condition || 0)
    + survivalsNorm * Number(seedWeights.champion_survivals || 0)
    + Number(vowEffects.tournamentSeedBonus || 0)
    + personalLegacyBonus * clampUnit(Number(legacy.personalDuelScale || 0)) * 0.4,
  );
  return {
    dwarf,
    warrior,
    dwarfId: String(dwarf && dwarf.id || ''),
    clanId: dwarf && dwarf.clanId ? String(dwarf.clanId) : '',
    spawnIndex: Math.max(0, Math.floor(Number(dwarf && dwarf.spawnIndex || 0))),
    rating: clampUnit(Number(warrior.rating || 0)),
    valor: clampUnit(Number(warrior.valor || 0)),
    riskWins: Math.max(0, Math.floor(Number(warrior.riskWins || 0))),
    heroPotential: clampUnit(Number(warrior.heroPotential || 0)),
    conditionScore: clampUnit(Number(warrior.condition && warrior.condition.score || 0)),
    baseCombatAptitude: clampUnit(Number(warrior.baseCombatAptitude || 0)),
    personalLegacyBonus,
    vowId: vowEffects.id || null,
    championSurvivals,
    seedScore,
    seedRank: 0,
  };
}

// Compare tournament seed entries using deterministic, trait-aware ordering.
function compareTournamentSeedEntries(left, right) {
  const leftSeed = Number(left && left.seedScore || 0);
  const rightSeed = Number(right && right.seedScore || 0);
  if (Math.abs(rightSeed - leftSeed) > 1e-9) {
    return rightSeed - leftSeed;
  }
  const leftRating = Number(left && left.rating || 0);
  const rightRating = Number(right && right.rating || 0);
  if (Math.abs(rightRating - leftRating) > 1e-9) {
    return rightRating - leftRating;
  }
  const leftValor = Number(left && left.valor || 0);
  const rightValor = Number(right && right.valor || 0);
  if (Math.abs(rightValor - leftValor) > 1e-9) {
    return rightValor - leftValor;
  }
  const leftHeroPotential = Number(left && left.heroPotential || 0);
  const rightHeroPotential = Number(right && right.heroPotential || 0);
  if (Math.abs(rightHeroPotential - leftHeroPotential) > 1e-9) {
    return rightHeroPotential - leftHeroPotential;
  }
  const leftCondition = Number(left && left.conditionScore || 0);
  const rightCondition = Number(right && right.conditionScore || 0);
  if (Math.abs(rightCondition - leftCondition) > 1e-9) {
    return rightCondition - leftCondition;
  }
  const leftRiskWins = Math.max(0, Math.floor(Number(left && left.riskWins || 0)));
  const rightRiskWins = Math.max(0, Math.floor(Number(right && right.riskWins || 0)));
  if (rightRiskWins !== leftRiskWins) {
    return rightRiskWins - leftRiskWins;
  }
  const leftSurvivals = Math.max(0, Math.floor(Number(left && left.championSurvivals || 0)));
  const rightSurvivals = Math.max(0, Math.floor(Number(right && right.championSurvivals || 0)));
  if (rightSurvivals !== leftSurvivals) {
    return rightSurvivals - leftSurvivals;
  }
  const leftSpawnIndex = Math.max(0, Math.floor(Number(left && left.spawnIndex || 0)));
  const rightSpawnIndex = Math.max(0, Math.floor(Number(right && right.spawnIndex || 0)));
  if (leftSpawnIndex !== rightSpawnIndex) {
    return leftSpawnIndex - rightSpawnIndex;
  }
  return String(left && left.dwarfId || '').localeCompare(String(right && right.dwarfId || ''));
}

// Compute one duel-score value for tournament bracket resolution.
function computeTournamentDuelScore(entry, warriors) {
  const tournaments = warriors && warriors.tournaments ? warriors.tournaments : {};
  const duelWeights = tournaments.duelWeights || {};
  const bonuses = warriors && warriors.bonuses ? warriors.bonuses : {};
  const legacy = bonuses && bonuses.legacy ? bonuses.legacy : {};
  const warrior = entry && entry.warrior && typeof entry.warrior === 'object'
    ? entry.warrior
    : {};
  const vowEffects = resolveWarriorVowEffects(warrior, warriors);
  const personalLegacyBonus = resolveWarriorPersonalLegacyBonus(warrior, warriors);
  return clampUnit(
    Number(entry && entry.seedScore || 0) * Number(duelWeights.seed_score || 0)
    + Number(entry && entry.baseCombatAptitude || 0) * Number(duelWeights.base_aptitude || 0)
    + Number(entry && entry.conditionScore || 0) * Number(duelWeights.condition || 0)
    + Number(vowEffects.tournamentDuelBonus || 0)
    + personalLegacyBonus * clampUnit(Number(legacy.personalDuelScale || 0)),
  );
}

// Resolve one deterministic bracket duel and return winner/loser metadata.
function resolveTournamentDuel(left, right, warriors) {
  const leftScore = computeTournamentDuelScore(left, warriors);
  const rightScore = computeTournamentDuelScore(right, warriors);
  if (Math.abs(leftScore - rightScore) > 1e-9) {
    return leftScore > rightScore
      ? {
        winner: left,
        loser: right,
        winnerScore: leftScore,
        loserScore: rightScore,
        tieBreakUsed: false,
      }
      : {
        winner: right,
        loser: left,
        winnerScore: rightScore,
        loserScore: leftScore,
        tieBreakUsed: false,
      };
  }
  const tieBreakLeftWins = compareTournamentSeedEntries(left, right) <= 0;
  return tieBreakLeftWins
    ? {
      winner: left,
      loser: right,
      winnerScore: leftScore,
      loserScore: rightScore,
      tieBreakUsed: true,
    }
    : {
      winner: right,
      loser: left,
      winnerScore: rightScore,
      loserScore: leftScore,
      tieBreakUsed: true,
    };
}

// Apply per-duel progression deltas plus legacy/marks progression.
function applyTournamentDuelProgression(state, config, runtime, winner, loser, warriors, tick) {
  const tournaments = warriors && warriors.tournaments ? warriors.tournaments : {};
  const progression = tournaments.progression || {};
  const bonuses = warriors && warriors.bonuses ? warriors.bonuses : {};
  const legacy = bonuses && bonuses.legacy ? bonuses.legacy : {};
  const legacyPoints = legacy.points || {};
  if (winner && winner.warrior) {
    winner.warrior.rating = clampUnit(
      Number(winner.warrior.rating || 0) + Number(progression.ratingWinDelta || 0),
    );
    winner.warrior.valor = clampUnit(
      Number(winner.warrior.valor || 0) + Number(progression.valorWinDelta || 0),
    );
    winner.warrior.lastTournamentTick = Math.max(0, Math.floor(Number(tick || 0)));
    winner.warrior.enrolled = true;
    awardWarriorLegacyPoints(
      winner.warrior,
      Number(legacyPoints.tournamentDuelWin || 0),
      warriors,
      runtime,
    );
    applyWarriorProgressionMarks(state, config, winner.dwarf, winner.warrior, {
      source: 'tournament',
      tick,
      runtime,
    });
  }
  if (loser && loser.warrior) {
    const loserVow = resolveWarriorVowEffects(loser.warrior, warriors);
    const ratingLossDelta = Number(progression.ratingLossDelta || 0);
    const scaledRatingLossDelta = ratingLossDelta < 0
      ? ratingLossDelta * Math.max(0.1, Number(loserVow.ratingLossMultiplier || 1))
      : ratingLossDelta;
    const valorLossDelta = Number(progression.valorLossDelta || 0);
    const scaledValorLossDelta = valorLossDelta < 0
      ? valorLossDelta * (1 + Math.max(0, Number(loserVow.ratingLossMultiplier || 1) - 1) * 0.6)
      : valorLossDelta;
    loser.warrior.rating = clampUnit(
      Number(loser.warrior.rating || 0) + scaledRatingLossDelta,
    );
    loser.warrior.valor = clampUnit(
      Number(loser.warrior.valor || 0) + scaledValorLossDelta,
    );
    loser.warrior.lastTournamentTick = Math.max(0, Math.floor(Number(tick || 0)));
    loser.warrior.enrolled = true;
    awardWarriorLegacyPoints(
      loser.warrior,
      Number(legacyPoints.tournamentDuelLoss || 0),
      warriors,
      runtime,
    );
    applyWarriorProgressionMarks(state, config, loser.dwarf, loser.warrior, {
      source: 'tournament',
      tick,
      runtime,
    });
  }
}

// Sync Warrior League champion to Underrealm Dwarf Champion runtime, when available.
function syncWarriorLeagueChampionToUnderrealm(state, championId, tick) {
  const runtime = state
    && state.underrealm
    && state.underrealm.combat
    && state.underrealm.combat.dwarfChampion
    && typeof state.underrealm.combat.dwarfChampion === 'object'
      ? state.underrealm.combat.dwarfChampion
      : null;
  if (!runtime || runtime.enabled === false || !championId) {
    return false;
  }
  const alive = new Set(
    Array.isArray(state.dwarves)
      ? state.dwarves.map((dwarf) => String(dwarf && dwarf.id || ''))
      : [],
  );
  if (!alive.has(String(championId || ''))) {
    return false;
  }
  const previous = typeof runtime.activeDwarfId === 'string'
    ? runtime.activeDwarfId
    : null;
  if (previous === championId) {
    return false;
  }
  runtime.activeDwarfId = championId;
  runtime.activeSinceTick = Math.max(0, Math.floor(Number(tick || 0)));
  runtime.promotions = Math.max(0, Math.floor(Number(runtime.promotions || 0))) + 1;
  return true;
}

// Execute one full seasonal Warrior League tournament.
function runSeasonWarriorTournament(state, config, runtime, warriors, seasonId) {
  const tournaments = warriors && warriors.tournaments ? warriors.tournaments : {};
  const scoring = tournaments.scoring || {};
  const bonuses = warriors && warriors.bonuses ? warriors.bonuses : {};
  const legacy = bonuses && bonuses.legacy ? bonuses.legacy : {};
  const legacyPoints = legacy.points || {};
  const tick = Math.max(0, Math.floor(Number(state && state.tick || 0)));
  const adults = (Array.isArray(state && state.dwarves) ? state.dwarves : [])
    .filter(isWarriorLeagueAdult)
    .map((dwarf) => buildTournamentSeedEntry(dwarf, config, warriors))
    .filter(Boolean)
    .sort(compareTournamentSeedEntries);
  const maxParticipants = Math.max(
    Number(tournaments.minParticipants || 2),
    Math.floor(Number(tournaments.maxParticipants || 16)),
  );
  const participants = adults.slice(0, maxParticipants);
  runtime.league.lastTournamentSeasonId = Math.max(0, Math.floor(Number(seasonId || 0)));
  runtime.league.lastTournamentSeasonName = state && state.season && state.season.name
    ? String(state.season.name)
    : '';
  runtime.league.lastTournamentLeagueName = resolveWarriorLeagueEpicName(
    state,
    config,
    runtime.league.lastTournamentSeasonId,
  );
  runtime.league.lastTournamentTick = tick;
  if (participants.length < Math.max(2, Number(tournaments.minParticipants || 2))) {
    runtime.league.ranking = [];
    runtime.league.clanScoreById = {};
    return {
      ran: false,
      championId: runtime.league.championId || null,
      tieBreaks: 0,
      upsets: 0,
    };
  }
  participants.forEach((entry, index) => {
    entry.seedRank = index + 1;
    if (entry.warrior) {
      entry.warrior.enrolled = true;
      entry.warrior.lastTournamentTick = tick;
    }
  });

  const standingById = new Map(
    participants.map((entry) => [entry.dwarfId, {
      entry,
      dwarfId: entry.dwarfId,
      clanId: entry.clanId,
      seedRank: entry.seedRank,
      seedScore: entry.seedScore,
      points: 0,
      wins: 0,
      losses: 0,
      duels: 0,
    }]),
  );
  const clanScoreById = {};
  let tieBreaks = 0;
  let upsets = 0;
  let bracket = participants.slice();

  while (bracket.length > 1) {
    const nextRound = [];
    let index = 0;
    if (bracket.length % 2 === 1) {
      const bye = bracket[0];
      const byeStanding = standingById.get(bye.dwarfId);
      if (byeStanding) {
        byeStanding.points += Number(scoring.byePoints || 0);
      }
      addClanLeaguePoints(clanScoreById, bye.clanId, Number(scoring.byePoints || 0));
      nextRound.push(bye);
      index = 1;
    }
    for (; index < bracket.length; index += 2) {
      const left = bracket[index];
      const right = bracket[index + 1];
      if (!left || !right) {
        if (left) {
          nextRound.push(left);
        }
        continue;
      }
      const duel = resolveTournamentDuel(left, right, warriors);
      const winner = duel.winner;
      const loser = duel.loser;
      if (duel.tieBreakUsed) {
        tieBreaks += 1;
      }
      if (winner.seedRank > loser.seedRank) {
        upsets += 1;
      }
      applyTournamentDuelProgression(
        state,
        config,
        runtime,
        winner,
        loser,
        warriors,
        tick,
      );
      const winnerStanding = standingById.get(winner.dwarfId);
      const loserStanding = standingById.get(loser.dwarfId);
      if (winnerStanding) {
        winnerStanding.wins += 1;
        winnerStanding.duels += 1;
        winnerStanding.points += Number(scoring.duelWinPoints || 0);
      }
      if (loserStanding) {
        loserStanding.losses += 1;
        loserStanding.duels += 1;
        loserStanding.points += Number(scoring.duelLossPoints || 0);
      }
      addClanLeaguePoints(clanScoreById, winner.clanId, Number(scoring.duelWinPoints || 0));
      addClanLeaguePoints(clanScoreById, loser.clanId, Number(scoring.duelLossPoints || 0));
      nextRound.push(winner);
    }
    bracket = nextRound;
  }

  const champion = bracket.length > 0 ? bracket[0] : null;
  const championId = champion ? champion.dwarfId : null;
  if (champion && champion.warrior) {
    const progression = tournaments.progression || {};
    champion.warrior.rating = clampUnit(
      Number(champion.warrior.rating || 0) + Number(progression.championRatingBonus || 0),
    );
    champion.warrior.valor = clampUnit(
      Number(champion.warrior.valor || 0) + Number(progression.championValorBonus || 0),
    );
    champion.warrior.lastTournamentTick = tick;
    awardWarriorLegacyPoints(
      champion.warrior,
      Number(legacyPoints.tournamentChampionBonus || 0),
      warriors,
      runtime,
    );
    applyWarriorProgressionMarks(state, config, champion.dwarf, champion.warrior, {
      source: 'tournament',
      tick,
      champion: true,
      runtime,
    });
  }
  const championStanding = championId ? standingById.get(championId) : null;
  if (championStanding) {
    championStanding.points += Number(scoring.championBonusPoints || 0);
    addClanLeaguePoints(
      clanScoreById,
      championStanding.clanId,
      Number(scoring.championBonusPoints || 0),
    );
  }

  const ranking = Array.from(standingById.values())
    .sort((left, right) => {
      if (right.points !== left.points) {
        return right.points - left.points;
      }
      if (right.wins !== left.wins) {
        return right.wins - left.wins;
      }
      if (Math.abs(Number(right.seedScore || 0) - Number(left.seedScore || 0)) > 1e-9) {
        return Number(right.seedScore || 0) - Number(left.seedScore || 0);
      }
      return compareTournamentSeedEntries(left.entry, right.entry);
    })
    .map((entry, index) => ({
      rank: index + 1,
      dwarfId: entry.dwarfId,
      clanId: entry.clanId || '',
      seedRank: entry.seedRank,
      seedScore: clampUnit(Number(entry.seedScore || 0)),
      points: Math.max(0, Number(entry.points || 0)),
      wins: Math.max(0, Math.floor(Number(entry.wins || 0))),
      losses: Math.max(0, Math.floor(Number(entry.losses || 0))),
      duels: Math.max(0, Math.floor(Number(entry.duels || 0))),
    }));

  runtime.league.championId = championId;
  runtime.league.clanScoreById = clanScoreById;
  runtime.league.ranking = ranking;
  runtime.stats.tournaments = Math.max(0, Number(runtime.stats.tournaments || 0)) + 1;
  runtime.stats.tieBreaks = Math.max(0, Number(runtime.stats.tieBreaks || 0)) + tieBreaks;
  runtime.stats.upsets = Math.max(0, Number(runtime.stats.upsets || 0)) + upsets;

  const rosterSize = Math.max(1, Math.floor(Number(legacy.companyRosterSize || 12)));
  runtime.company.rosterIds = ranking.slice(0, rosterSize).map((entry) => String(entry.dwarfId || ''));
  refreshWarriorCompanyLegacyAura(state, config, warriors, runtime);
  if (champion) {
    const championWarrior = champion.warrior && typeof champion.warrior === 'object'
      ? champion.warrior
      : {};
    runtime.company.hallOfFame.unshift({
      seasonId: runtime.league.lastTournamentSeasonId,
      seasonName: runtime.league.lastTournamentSeasonName,
      leagueName: runtime.league.lastTournamentLeagueName || '',
      tick,
      dwarfId: champion.dwarfId,
      clanId: champion.clanId || '',
      points: championStanding ? Math.max(0, Number(championStanding.points || 0)) : 0,
      titleIds: Array.isArray(championWarrior.titles) ? championWarrior.titles.slice(0, 4) : [],
      scarIds: Array.isArray(championWarrior.scars) ? championWarrior.scars.slice(0, 4) : [],
      vowId: championWarrior.vow || null,
      legacyPoints: Math.max(0, Number(championWarrior.legacyPoints || 0)),
    });
    runtime.company.hallOfFame = runtime.company.hallOfFame.slice(0, 40);
  }

  if (champion) {
    const leagueName = runtime.league.lastTournamentLeagueName || resolveWarriorLeagueEpicName(
      state,
      config,
      runtime.league.lastTournamentSeasonId,
    );
    const fighterLabel = formatWarriorDisplayName(champion.dwarf, state, config);
    const championLabel = champion.clanId ? `${fighterLabel} (${champion.clanId})` : fighterLabel;
    pushEvent(
      state,
      config,
      `Warrior League ${leagueName} S${runtime.league.lastTournamentSeasonId}: champion ${championLabel}`,
    );
    if (tournaments.syncUnderrealmChampion) {
      const synced = syncWarriorLeagueChampionToUnderrealm(state, champion.dwarfId, tick);
      if (synced) {
        pushEvent(
          state,
          config,
          `Warrior League: ${fighterLabel} synced to Underrealm Dwarf Champion command`,
        );
      }
    }
  }

  return {
    ran: true,
    championId,
    tieBreaks,
    upsets,
  };
}

// Update Warrior League seasonal runtime and execute cadence-gated tournaments.
function updateWarriors(state, config) {
  const runtime = ensureWarriorsRuntimeState(state, config);
  if (!runtime) {
    return;
  }
  const warriors = getWarriorsConfig(config);
  runtime.enabled = warriors.enabled === true;
  if (runtime.enabled !== true) {
    return;
  }
  refreshWarriorCompanyLegacyAura(state, config, warriors, runtime);
  const seasonId = resolveWarriorSeasonIndex(state);
  if (seasonId === null) {
    return;
  }
  runtime.league.seasonId = seasonId;
  const tournaments = warriors.tournaments || {};
  if (tournaments.enabled === false) {
    return;
  }
  const cadence = String(tournaments.cadence || 'season').toLowerCase();
  if (cadence !== 'season') {
    return;
  }
  const tickInSeason = Math.max(0, Math.floor(Number(state && state.season && state.season.tickInSeason || 0)));
  if (tickInSeason !== 1) {
    return;
  }
  const lastSeasonId = Number(runtime.league.lastTournamentSeasonId);
  if (Number.isFinite(lastSeasonId) && seasonId < Math.floor(lastSeasonId)) {
    runtime.league.lastTournamentSeasonId = -1;
  }
  if (Math.floor(Number(runtime.league.lastTournamentSeasonId || -1)) === seasonId) {
    return;
  }
  const interval = Math.max(1, Math.floor(Number(tournaments.intervalSeasons || 1)));
  if (
    Number.isFinite(lastSeasonId)
    && lastSeasonId >= 0
    && seasonId - Math.floor(lastSeasonId) < interval
  ) {
    return;
  }
  runSeasonWarriorTournament(state, config, runtime, warriors, seasonId);
}

// Create one normalized warrior payload for a dwarf.
function createDwarfWarriorState(dwarfId, dwarf, config, options = {}) {
  const warriors = getWarriorsConfig(config);
  const progression = warriors.progression || {};
  const baseProfile = createDwarfWarriorBaseProfile(dwarfId, config, options);
  const condition = createDwarfWarriorConditionSnapshot(dwarf, config);
  const baseAptitude = computeBaseCombatAptitude(baseProfile, config);
  return {
    enrolled: false,
    clanClass: options && options.clanId ? String(options.clanId) : '',
    baseProfile,
    condition,
    baseCombatAptitude: baseAptitude,
    heroPotential: computeHeroPotential(baseAptitude, condition.score, config),
    rating: clampUnit(Number(progression.ratingStart ?? 0.5)),
    valor: clampUnit(Number(progression.valorStart ?? 0.5)),
    expeditions: 0,
    wins: 0,
    losses: 0,
    retreats: 0,
    riskWins: 0,
    scars: [],
    titles: [],
    vow: null,
    legacyPoints: 0,
    lastTournamentTick: 0,
    lastExpeditionTick: 0,
    nextEligibleExpeditionTick: 0,
    enabled: warriors.enabled === true,
  };
}

// Create initial warriors runtime container.
function createWarriorsState(config) {
  const warriors = getWarriorsConfig(config);
  return {
    enabled: warriors.enabled === true,
    company: {
      rosterIds: [],
      hallOfFame: [],
      legacyAura: 0,
    },
    league: {
      seasonId: 0,
      lastTournamentSeasonId: -1,
      lastTournamentSeasonName: '',
      lastTournamentLeagueName: '',
      clanScoreById: {},
      ranking: [],
      championId: null,
      lastTournamentTick: 0,
    },
    stats: {
      tournaments: 0,
      tieBreaks: 0,
      upsets: 0,
      scarsAwarded: 0,
      titlesAwarded: 0,
      vowsAssigned: 0,
      legacyPointsAwarded: 0,
    },
  };
}

module.exports = {
  getWarriorsConfig,
  createDwarfWarriorState,
  createWarriorsState,
  createDwarfWarriorBaseProfile,
  createDwarfWarriorConditionSnapshot,
  computeBaseCombatAptitude,
  computeHeroPotential,
  ensureDwarfWarriorState,
  isWarriorRiskyDispatch,
  computeWarriorDispatchScore,
  compareRiskDispatchCandidates,
  applyWarriorExpeditionOutcome,
  updateWarriors,
  formatWarriorDisplayName,
  formatWarriorDisplayNameById,
  resolveWarriorLeagueEpicName,
};
