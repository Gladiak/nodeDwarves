'use strict';

const { clamp } = require('../utils');
const { getClanEffects } = require('../clans');
const { buildDwarfLore } = require('../dwarf_lore');
const { hasInputs, consumeInputs } = require('./resources');
const { clearDeadSocialLinks } = require('./social_drama');
const {
  emitWarriorMarkChanged,
  emitWarriorRetired,
  emitWarriorUnderrealmCommandChanged,
  emitWarriorHeroCommandTaken,
  emitWarriorTournamentInjury,
  emitWarriorTournamentDeath,
  emitWarriorTournamentCrowned,
  emitWarriorCompanyDoctrine,
} = require('./warrior_events');

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

const WARRIOR_COMPANY_NAME_PREFIXES = [
  'Anvil',
  'Iron',
  'Ember',
  'Stone',
  'Deep',
  'Rune',
  'Lantern',
  'Ash',
];

const WARRIOR_COMPANY_FOCUS_PROFILES = {
  balanced: {
    id: 'balanced',
    label: 'balanced',
    nameSuffix: 'Company',
    motto: 'Discipline in all fronts.',
    dispatchMultiplier: 1,
    duelMultiplier: 1,
    trainingMultiplier: 1,
  },
  vanguard: {
    id: 'vanguard',
    label: 'vanguard',
    nameSuffix: 'Vanguard',
    motto: 'First in, last out.',
    dispatchMultiplier: 1.16,
    duelMultiplier: 1.04,
    trainingMultiplier: 0.96,
  },
  glory: {
    id: 'glory',
    label: 'glory',
    nameSuffix: 'Crownguard',
    motto: 'Honor before comfort.',
    dispatchMultiplier: 0.98,
    duelMultiplier: 1.2,
    trainingMultiplier: 1.03,
  },
  stoic: {
    id: 'stoic',
    label: 'stoic',
    nameSuffix: 'Ironward',
    motto: 'Scars are records, not failures.',
    dispatchMultiplier: 1.05,
    duelMultiplier: 0.94,
    trainingMultiplier: 1.22,
  },
  sentinel: {
    id: 'sentinel',
    label: 'sentinel',
    nameSuffix: 'Watch',
    motto: 'Hold the depths and endure.',
    dispatchMultiplier: 1.11,
    duelMultiplier: 1,
    trainingMultiplier: 1.12,
  },
};

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

// Normalize one resource-cost map to non-negative numeric entries.
function normalizeResourceCostMap(raw, fallback = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const defaults = fallback && typeof fallback === 'object' ? fallback : {};
  const normalized = {};
  const keys = new Set([
    ...Object.keys(defaults),
    ...Object.keys(source),
  ]);
  for (const key of keys) {
    const id = String(key || '').trim();
    if (!id) {
      continue;
    }
    const fromSource = Number(source[id]);
    const fromFallback = Number(defaults[id]);
    const value = Number.isFinite(fromSource)
      ? fromSource
      : (Number.isFinite(fromFallback) ? fromFallback : 0);
    const safe = Math.max(0, value);
    if (safe <= 0) {
      continue;
    }
    normalized[id] = safe;
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

// Resolve one normalized company-focus profile.
function getWarriorCompanyFocusProfile(focusId) {
  const safeId = String(focusId || '').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(WARRIOR_COMPANY_FOCUS_PROFILES, safeId)) {
    return WARRIOR_COMPANY_FOCUS_PROFILES[safeId];
  }
  return WARRIOR_COMPANY_FOCUS_PROFILES.balanced;
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
  const tournamentConsequencesRaw = tournamentsRaw.consequences
    && typeof tournamentsRaw.consequences === 'object'
    ? tournamentsRaw.consequences
    : {};
  const tournamentConsequenceSeverityWeights = normalizeWeightMap(
    tournamentConsequencesRaw.severity_weights,
    {
      light: 0.58,
      moderate: 0.30,
      severe: 0.12,
    },
  );
  const tournamentConsequenceRecoveryTicks = normalizeOutcomeMap(
    tournamentConsequencesRaw.recovery_ticks,
    {
      light: 45,
      moderate: 95,
      severe: 170,
    },
    {
      min: 0,
      integer: true,
    },
  );
  const tournamentConsequenceRatingPenalty = normalizeOutcomeMap(
    tournamentConsequencesRaw.rating_penalty,
    {
      light: -0.005,
      moderate: -0.015,
      severe: -0.04,
    },
    {
      min: -1,
      max: 1,
    },
  );
  const tournamentConsequenceValorPenalty = normalizeOutcomeMap(
    tournamentConsequencesRaw.valor_penalty,
    {
      light: -0.004,
      moderate: -0.012,
      severe: -0.03,
    },
    {
      min: -1,
      max: 1,
    },
  );
  const tournamentConsequenceFatigueGain = normalizeOutcomeMap(
    tournamentConsequencesRaw.fatigue_gain,
    {
      light: 0.08,
      moderate: 0.18,
      severe: 0.32,
    },
    {
      min: 0,
      max: 1,
    },
  );
  const tournamentConsequenceStressGain = normalizeOutcomeMap(
    tournamentConsequencesRaw.stress_gain,
    {
      light: 0.03,
      moderate: 0.08,
      severe: 0.16,
    },
    {
      min: 0,
      max: 1,
    },
  );
  const tournamentConsequenceMoraleDelta = normalizeOutcomeMap(
    tournamentConsequencesRaw.morale_delta,
    {
      light: -0.01,
      moderate: -0.03,
      severe: -0.08,
    },
    {
      min: -1,
      max: 1,
    },
  );
  const tournamentConsequenceRetirementChance = normalizeOutcomeMap(
    tournamentConsequencesRaw.retirement_chance,
    {
      light: 0,
      moderate: 0.01,
      severe: 0.06,
    },
    {
      min: 0,
      max: 1,
    },
  );
  const tournamentConsequenceDeathChance = normalizeOutcomeMap(
    tournamentConsequencesRaw.death_chance,
    {
      light: 0,
      moderate: 0,
      severe: 0.01,
    },
    {
      min: 0,
      max: 1,
    },
  );
  const tournamentHeroSuccessionRaw = tournamentsRaw.hero_succession
    && typeof tournamentsRaw.hero_succession === 'object'
    ? tournamentsRaw.hero_succession
    : {};
  const trainingRaw = raw.training && typeof raw.training === 'object'
    ? raw.training
    : {};
  const trainingProgressionRaw = trainingRaw.progression && typeof trainingRaw.progression === 'object'
    ? trainingRaw.progression
    : {};
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
  const legacyCompanyIdentityRaw = legacyRaw.company_identity && typeof legacyRaw.company_identity === 'object'
    ? legacyRaw.company_identity
    : {};
  const legacyCarryoverRaw = legacyRaw.carryover && typeof legacyRaw.carryover === 'object'
    ? legacyRaw.carryover
    : {};
  const companyIdentityRenownWeights = normalizeWeightMap(
    legacyCompanyIdentityRaw.renown_weights,
    {
      aura: 0.45,
      hall_of_fame: 0.25,
      marks: 0.2,
      tournaments: 0.1,
    },
  );
  const companyIdentityNamePrefixes = normalizeIdList(
    legacyCompanyIdentityRaw.name_prefixes,
    24,
  );

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
      consequences: {
        enabled: tournamentConsequencesRaw.enabled !== false,
        injuryBaseChance: clamp(Number(tournamentConsequencesRaw.injury_base_chance ?? 0.22), 0, 1),
        injuryScoreGapScale: clamp(Number(tournamentConsequencesRaw.injury_score_gap_scale ?? 0.32), 0, 1),
        injuryTieBreakBonus: clamp(Number(tournamentConsequencesRaw.injury_tie_break_bonus ?? 0.05), 0, 1),
        riskIntentInjuryScale: clamp(
          Number(tournamentConsequencesRaw.risk_intent_injury_scale ?? 0.65),
          0,
          2,
        ),
        recoveryIntentInjuryReduction: clamp(
          Number(tournamentConsequencesRaw.recovery_intent_injury_reduction ?? 0.5),
          0,
          1,
        ),
        riskIntentSeverityBias: clamp(
          Number(tournamentConsequencesRaw.risk_intent_severity_bias ?? 0.4),
          0,
          2,
        ),
        recoveryIntentSeverityBias: clamp(
          Number(tournamentConsequencesRaw.recovery_intent_severity_bias ?? 0.35),
          0,
          2,
        ),
        winnerFatigueGain: clamp(Number(tournamentConsequencesRaw.winner_fatigue_gain ?? 0.025), 0, 1),
        winnerStressGain: clamp(Number(tournamentConsequencesRaw.winner_stress_gain ?? 0.01), 0, 1),
        allowRetirements: tournamentConsequencesRaw.allow_retirements !== false,
        allowDeath: tournamentConsequencesRaw.allow_death === true,
        severityWeights: tournamentConsequenceSeverityWeights,
        recoveryTicks: tournamentConsequenceRecoveryTicks,
        ratingPenalty: tournamentConsequenceRatingPenalty,
        valorPenalty: tournamentConsequenceValorPenalty,
        fatigueGain: tournamentConsequenceFatigueGain,
        stressGain: tournamentConsequenceStressGain,
        moraleDelta: tournamentConsequenceMoraleDelta,
        retirementChance: tournamentConsequenceRetirementChance,
        deathChance: tournamentConsequenceDeathChance,
      },
      heroSuccession: {
        enabled: tournamentHeroSuccessionRaw.enabled !== false,
        requireChampionDefeat: tournamentHeroSuccessionRaw.require_champion_defeat !== false,
        syncUnderrealmOnDefeat: tournamentHeroSuccessionRaw.sync_underrealm_on_defeat !== false,
        minConditionScore: clampUnit(Number(tournamentHeroSuccessionRaw.min_condition_score ?? 0.42)),
        minRating: clampUnit(Number(tournamentHeroSuccessionRaw.min_rating ?? 0.45)),
        minValor: clampUnit(Number(tournamentHeroSuccessionRaw.min_valor ?? 0.45)),
        minHeroPotential: clampUnit(Number(tournamentHeroSuccessionRaw.min_hero_potential ?? 0.42)),
      },
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
        companyIdentity: {
          enabled: legacyCompanyIdentityRaw.enabled !== false,
          renownScale: Math.max(1, Number(legacyCompanyIdentityRaw.renown_scale ?? 1)),
          renownCap: clampUnit(Number(legacyCompanyIdentityRaw.renown_cap ?? 0.45)),
          renownWeights: companyIdentityRenownWeights,
          dispatchScale: clampUnit(Number(legacyCompanyIdentityRaw.dispatch_scale ?? 0.16)),
          duelScale: clampUnit(Number(legacyCompanyIdentityRaw.duel_scale ?? 0.12)),
          trainingScale: clampUnit(Number(legacyCompanyIdentityRaw.training_scale ?? 0.18)),
          reserveMemberScale: clampUnit(
            Number(legacyCompanyIdentityRaw.reserve_member_scale ?? 0.35),
          ),
          namePrefixes: companyIdentityNamePrefixes.length > 0
            ? companyIdentityNamePrefixes
            : WARRIOR_COMPANY_NAME_PREFIXES.slice(),
          maxHallOfFameCarry: Math.max(
            1,
            Math.floor(Number(legacyCompanyIdentityRaw.max_hall_of_fame_carry ?? 16)),
          ),
        },
        carryover: {
          enabled: legacyCarryoverRaw.enabled !== false,
          historyLimit: Math.max(1, Math.floor(Number(legacyCarryoverRaw.history_limit ?? 8))),
          renownRetention: clampUnit(Number(legacyCarryoverRaw.renown_retention ?? 0.45)),
          perCycleDecay: clampUnit(Number(legacyCarryoverRaw.per_cycle_decay ?? 0.1)),
          maxSeedBonus: clampUnit(Number(legacyCarryoverRaw.max_seed_bonus ?? 0.18)),
          minCyclesForSeed: Math.max(
            0,
            Math.floor(Number(legacyCarryoverRaw.min_cycles_for_seed ?? 1)),
          ),
          startingRatingScale: clampUnit(
            Number(legacyCarryoverRaw.starting_rating_scale ?? 0.24),
          ),
          startingValorScale: clampUnit(
            Number(legacyCarryoverRaw.starting_valor_scale ?? 0.22),
          ),
          startingHeroPotentialScale: clampUnit(
            Number(legacyCarryoverRaw.starting_hero_potential_scale ?? 0.2),
          ),
        },
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
    training: {
      enabled: trainingRaw.enabled !== false,
      tickInterval: Math.max(1, Math.floor(Number(trainingRaw.tick_interval ?? 36))),
      baseParticipants: Math.max(1, Math.floor(Number(trainingRaw.base_participants ?? 2))),
      maxParticipants: Math.max(1, Math.floor(Number(trainingRaw.max_participants ?? 6))),
      rotationWindowTicks: Math.max(1, Math.floor(Number(trainingRaw.rotation_window_ticks ?? 160))),
      minConditionScore: clampUnit(Number(trainingRaw.min_condition_score ?? 0.4)),
      fatigueCeiling: clampUnit(Number(trainingRaw.fatigue_ceiling ?? 0.82)),
      stressCeiling: clampUnit(Number(trainingRaw.stress_ceiling ?? 0.85)),
      skipInjured: trainingRaw.skip_injured !== false,
      costPerSession: normalizeResourceCostMap(trainingRaw.cost_per_session, {
        food: 2,
        beer: 1,
        iron: 1,
      }),
      progression: {
        ratingGain: clamp(Number(trainingProgressionRaw.rating_gain ?? 0.005), -1, 1),
        valorGain: clamp(Number(trainingProgressionRaw.valor_gain ?? 0.004), -1, 1),
        heroPotentialGain: clamp(Number(trainingProgressionRaw.hero_potential_gain ?? 0.003), -1, 1),
        fatigueGain: clamp(Number(trainingProgressionRaw.fatigue_gain ?? 0.05), 0, 1),
        stressGain: clamp(Number(trainingProgressionRaw.stress_gain ?? 0.02), 0, 1),
        moraleDelta: clamp(Number(trainingProgressionRaw.morale_delta ?? 0.01), -1, 1),
        recoveryRelief: clamp(Number(trainingProgressionRaw.recovery_relief ?? 0.12), 0, 1),
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

// Resolve deterministic severity rank for injury-state comparisons.
function getWarriorInjurySeverityRank(severity) {
  const id = String(severity || '').toLowerCase();
  if (id === 'severe') {
    return 3;
  }
  if (id === 'moderate') {
    return 2;
  }
  if (id === 'light') {
    return 1;
  }
  return 0;
}

// Normalize one injury payload into strict warrior runtime shape.
function normalizeWarriorInjuryState(injuryRaw) {
  const source = injuryRaw && typeof injuryRaw === 'object'
    ? injuryRaw
    : {};
  const recoveryTicks = Math.max(0, Math.floor(Number(source.recoveryTicks || 0)));
  if (recoveryTicks <= 0) {
    return null;
  }
  const severityRaw = String(source.severity || '').toLowerCase();
  const severity = getWarriorInjurySeverityRank(severityRaw) > 0
    ? severityRaw
    : 'light';
  return {
    severity,
    recoveryTicks,
    source: source.source ? String(source.source) : 'league',
    lastTick: Math.max(0, Math.floor(Number(source.lastTick || 0))),
  };
}

// Check whether one warrior currently has active injury recovery ticks.
function hasWarriorActiveInjury(warrior) {
  return Boolean(
    warrior
    && warrior.injury
    && Number(warrior.injury.recoveryTicks || 0) > 0,
  );
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
  warrior.injury = normalizeWarriorInjuryState(warrior.injury);
  warrior.retired = warrior.retired === true;
  warrior.trainingSessions = Math.max(0, Math.floor(Number(warrior.trainingSessions || 0)));
  warrior.lastTrainingTick = Math.max(0, Math.floor(Number(warrior.lastTrainingTick || 0)));
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
      companyIdentityBonus: 0,
      vowId: null,
      dispatchScore: 0,
      blockedByRest: false,
      blockedByInjury: false,
      blockedByRetired: false,
      blockedByCondition: false,
      readyForRiskDispatch: true,
      readyForSafeDispatch: true,
      nextEligibleExpeditionTick: 0,
    };
  }
  const warrior = ensureDwarfWarriorState(safeDwarf, config);
  const retired = warrior && warrior.retired === true;
  if (retired) {
    return {
      dwarf: safeDwarf,
      dwarfId: String(safeDwarf.id || ''),
      spawnIndex: Math.max(0, Math.floor(Number(safeDwarf.spawnIndex || 0))),
      underrealmChampionSurvivals: Math.max(
        0,
        Math.floor(Number(safeDwarf.underrealmChampionSurvivals || 0)),
      ),
      rating: clampUnit(Number(warrior.rating || 0)),
      valor: clampUnit(Number(warrior.valor || 0)),
      riskWins: Math.max(0, Math.floor(Number(warrior.riskWins || 0))),
      conditionScore: clampUnit(Number(warrior.condition && warrior.condition.score || 0)),
      heroPotential: clampUnit(Number(warrior.heroPotential || 0)),
      clanClassFit: resolveWarriorClanClassFit(safeDwarf, config),
      personalLegacyBonus: 0,
      companyLegacyBonus: 0,
      companyIdentityBonus: 0,
      vowId: warrior.vow || null,
      dispatchScore: 0,
      blockedByRest: true,
      blockedByInjury: false,
      blockedByRetired: true,
      blockedByCondition: true,
      readyForRiskDispatch: false,
      readyForSafeDispatch: false,
      nextEligibleExpeditionTick: Number.MAX_SAFE_INTEGER,
    };
  }
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
  const companyIdentityBonus = resolveWarriorCompanyIdentityBonus(
    options.state,
    safeDwarf.id,
    warriors,
    'dispatch',
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
    + companyIdentityBonus
    + Number(vowEffects.dispatchScoreBonus || 0)
    - Number(vowEffects.dispatchScorePenalty || 0),
  );
  const nextEligibleExpeditionTick = Math.max(
    0,
    Math.floor(Number(warrior.nextEligibleExpeditionTick || 0)),
  );
  const blockedByRest = tick < nextEligibleExpeditionTick;
  const blockedByInjury = hasWarriorActiveInjury(warrior);
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
    companyIdentityBonus,
    vowId: vowEffects.id || null,
    dispatchScore,
    blockedByRest,
    blockedByInjury,
    blockedByRetired: false,
    blockedByCondition,
    readyForRiskDispatch: !blockedByRest && !blockedByInjury && !blockedByCondition,
    readyForSafeDispatch: !blockedByRest && !blockedByInjury && condition.score >= clampUnit(
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

// Resolve deterministic focus id from roster marks/performance posture.
function resolveWarriorCompanyFocusId(metrics, runtime) {
  const safeMetrics = metrics && typeof metrics === 'object' ? metrics : {};
  const rosterSize = Math.max(1, Number(safeMetrics.rosterSize || 1));
  const scarsPerFighter = Math.max(0, Number(safeMetrics.totalScars || 0)) / rosterSize;
  const titlesPerFighter = Math.max(0, Number(safeMetrics.totalTitles || 0)) / rosterSize;
  const vowsRatio = clampUnit(Number(safeMetrics.totalVows || 0) / rosterSize);
  const riskWinsPerFighter = Math.max(0, Number(safeMetrics.totalRiskWins || 0)) / rosterSize;
  const survivalsPerFighter = Math.max(0, Number(safeMetrics.totalChampionSurvivals || 0)) / rosterSize;
  const stats = runtime && runtime.stats && typeof runtime.stats === 'object'
    ? runtime.stats
    : {};
  const tournaments = Math.max(1, Math.floor(Number(stats.tournaments || 0)));
  const injuryPressure = clampUnit(
    (Math.max(0, Number(stats.injuries || 0)) + Math.max(0, Number(stats.retirements || 0)))
    / Math.max(1, tournaments * 5),
  );
  if (riskWinsPerFighter >= 1.15 || vowsRatio >= 0.58) {
    return 'vanguard';
  }
  if (titlesPerFighter >= scarsPerFighter + 0.4 && titlesPerFighter >= 0.6) {
    return 'glory';
  }
  if (scarsPerFighter >= titlesPerFighter + 0.45 || injuryPressure >= 0.28) {
    return 'stoic';
  }
  if (survivalsPerFighter >= 0.8) {
    return 'sentinel';
  }
  return 'balanced';
}

// Build deterministic company name from current focus + historical seed.
function buildWarriorCompanyIdentityName(company, focusProfile, identityConfig) {
  const safeCompany = company && typeof company === 'object' ? company : {};
  const hall = Array.isArray(safeCompany.hallOfFame) ? safeCompany.hallOfFame : [];
  const carryover = safeCompany.carryover && typeof safeCompany.carryover === 'object'
    ? safeCompany.carryover
    : {};
  const prefixesRaw = identityConfig && Array.isArray(identityConfig.namePrefixes)
    ? identityConfig.namePrefixes
    : [];
  const prefixes = prefixesRaw.length > 0
    ? prefixesRaw
    : WARRIOR_COMPANY_NAME_PREFIXES;
  const seedSource = hall[0] && typeof hall[0] === 'object'
    ? `${hall[0].dwarfId || ''}:${hall[0].seasonId || 0}:${hall[0].tick || 0}`
    : `${safeCompany.rosterIds || ''}:${carryover.sourceChampionId || ''}:${carryover.cycleIndex || 0}`;
  const prefix = prefixes[mixSeed(hashString(`${seedSource}:${focusProfile.id}:prefix`)) % prefixes.length] || 'Stone';
  return `${prefix} ${focusProfile.nameSuffix}`.trim();
}

// Recompute company identity from roster marks/history and keep bounded bonuses explicit.
function refreshWarriorCompanyIdentity(state, config, warriors, runtime = null) {
  const safeRuntime = runtime || ensureWarriorsRuntimeState(state, config);
  if (!safeRuntime || !safeRuntime.company || typeof safeRuntime.company !== 'object') {
    return null;
  }
  const bonuses = warriors && warriors.bonuses ? warriors.bonuses : {};
  const legacy = bonuses && bonuses.legacy ? bonuses.legacy : {};
  const identityConfig = legacy && legacy.companyIdentity && typeof legacy.companyIdentity === 'object'
    ? legacy.companyIdentity
    : {};
  const company = safeRuntime.company;
  company.identity = company.identity && typeof company.identity === 'object'
    ? company.identity
    : {};
  if (
    bonuses.enabled === false
    || legacy.enabled === false
    || identityConfig.enabled === false
  ) {
    company.identity = {
      name: '',
      focus: 'balanced',
      motto: '',
      renown: 0,
      dispatchBonus: 0,
      duelBonus: 0,
      trainingBonus: 0,
      updatedTick: Math.max(0, Math.floor(Number(state && state.tick || 0))),
    };
    return company.identity;
  }

  const rosterLimit = Math.max(1, Math.floor(Number(legacy.companyRosterSize || 1)));
  const rosterIds = normalizeIdList(company.rosterIds, rosterLimit);
  const allDwarves = Array.isArray(state && state.dwarves) ? state.dwarves : [];
  const byId = new Map(allDwarves.map((dwarf) => [String(dwarf && dwarf.id || ''), dwarf]));
  if (rosterIds.length === 0) {
    const seededRoster = allDwarves
      .map((dwarf) => ({
        dwarf,
        warrior: dwarf && dwarf.warrior && typeof dwarf.warrior === 'object' ? dwarf.warrior : null,
      }))
      .filter((entry) => (
        entry.warrior
        && String(entry.dwarf && entry.dwarf.lifeStage || '') === 'adult'
        && entry.warrior.retired !== true
      ))
      .sort((left, right) => {
        const leftScore = Number(left.warrior.rating || 0) * 0.7 + Number(left.warrior.valor || 0) * 0.3;
        const rightScore = Number(right.warrior.rating || 0) * 0.7 + Number(right.warrior.valor || 0) * 0.3;
        if (Math.abs(rightScore - leftScore) > 1e-9) {
          return rightScore - leftScore;
        }
        const leftSpawn = Math.max(0, Math.floor(Number(left.dwarf && left.dwarf.spawnIndex || 0)));
        const rightSpawn = Math.max(0, Math.floor(Number(right.dwarf && right.dwarf.spawnIndex || 0)));
        if (leftSpawn !== rightSpawn) {
          return leftSpawn - rightSpawn;
        }
        return String(left.dwarf && left.dwarf.id || '').localeCompare(String(right.dwarf && right.dwarf.id || ''));
      })
      .slice(0, rosterLimit)
      .map((entry) => String(entry.dwarf && entry.dwarf.id || ''));
    company.rosterIds = seededRoster;
  } else {
    company.rosterIds = rosterIds;
  }

  const pointsCap = Math.max(1, Number(legacy.pointsCap || 1));
  const activeRoster = company.rosterIds
    .map((dwarfId) => byId.get(String(dwarfId || '')))
    .filter(Boolean);
  const metrics = {
    rosterSize: activeRoster.length,
    totalLegacyPoints: 0,
    totalScars: 0,
    totalTitles: 0,
    totalVows: 0,
    totalRiskWins: 0,
    totalChampionSurvivals: 0,
  };
  for (const dwarf of activeRoster) {
    const warrior = dwarf && dwarf.warrior && typeof dwarf.warrior === 'object'
      ? dwarf.warrior
      : null;
    if (!warrior) {
      continue;
    }
    metrics.totalLegacyPoints += Math.min(pointsCap, Math.max(0, Number(warrior.legacyPoints || 0)));
    metrics.totalScars += Array.isArray(warrior.scars) ? warrior.scars.length : 0;
    metrics.totalTitles += Array.isArray(warrior.titles) ? warrior.titles.length : 0;
    metrics.totalVows += warrior.vow ? 1 : 0;
    metrics.totalRiskWins += Math.max(0, Math.floor(Number(warrior.riskWins || 0)));
    metrics.totalChampionSurvivals += Math.max(0, Math.floor(Number(dwarf && dwarf.underrealmChampionSurvivals || 0)));
  }

  const hall = Array.isArray(company.hallOfFame) ? company.hallOfFame : [];
  const hallDepthNorm = clampUnit(
    hall.length / Math.max(1, Number(identityConfig.maxHallOfFameCarry || 1)),
  );
  const marksNorm = metrics.rosterSize > 0
    ? clampUnit(
      (
        metrics.totalScars
        + metrics.totalTitles * 1.2
        + metrics.totalVows * 1.5
      ) / Math.max(1, metrics.rosterSize * 6),
    )
    : 0;
  const legacyNorm = metrics.rosterSize > 0
    ? clampUnit(metrics.totalLegacyPoints / Math.max(1, pointsCap * metrics.rosterSize))
    : 0;
  const stats = safeRuntime.stats && typeof safeRuntime.stats === 'object'
    ? safeRuntime.stats
    : {};
  const tournamentNorm = clampUnit(Math.max(0, Number(stats.tournaments || 0)) / 24);
  const auraNorm = clampUnit(Number(company.legacyAura || 0));
  const renownWeights = identityConfig.renownWeights || {};
  const renownRaw = (
    auraNorm * Number(renownWeights.aura || 0)
    + hallDepthNorm * Number(renownWeights.hall_of_fame || 0)
    + clampUnit((marksNorm + legacyNorm) * 0.5) * Number(renownWeights.marks || 0)
    + tournamentNorm * Number(renownWeights.tournaments || 0)
  ) * Math.max(1, Number(identityConfig.renownScale || 1));
  const carryover = company.carryover && typeof company.carryover === 'object'
    ? company.carryover
    : {};
  const seededRenown = clampUnit(Number(carryover.seedBonus || 0));
  const renown = clampUnit(
    Math.min(
      Number(identityConfig.renownCap || 0),
      renownRaw + seededRenown,
    ),
  );
  const focusId = resolveWarriorCompanyFocusId(metrics, safeRuntime);
  const focusProfile = getWarriorCompanyFocusProfile(focusId);
  company.identity = {
    name: buildWarriorCompanyIdentityName(company, focusProfile, identityConfig),
    focus: focusProfile.id,
    motto: focusProfile.motto,
    renown,
    dispatchBonus: clampUnit(
      renown
      * clampUnit(Number(identityConfig.dispatchScale || 0))
      * Number(focusProfile.dispatchMultiplier || 1),
    ),
    duelBonus: clampUnit(
      renown
      * clampUnit(Number(identityConfig.duelScale || 0))
      * Number(focusProfile.duelMultiplier || 1),
    ),
    trainingBonus: clampUnit(
      renown
      * clampUnit(Number(identityConfig.trainingScale || 0))
      * Number(focusProfile.trainingMultiplier || 1),
    ),
    updatedTick: Math.max(0, Math.floor(Number(state && state.tick || 0))),
  };
  return company.identity;
}

// Resolve one company identity bonus channel for a fighter (roster-aware).
function resolveWarriorCompanyIdentityBonus(state, dwarfId, warriors, channel = 'dispatch') {
  const bonuses = warriors && warriors.bonuses ? warriors.bonuses : {};
  const legacy = bonuses && bonuses.legacy ? bonuses.legacy : {};
  const identityConfig = legacy && legacy.companyIdentity && typeof legacy.companyIdentity === 'object'
    ? legacy.companyIdentity
    : {};
  if (
    bonuses.enabled === false
    || legacy.enabled === false
    || identityConfig.enabled === false
  ) {
    return 0;
  }
  const runtime = state && state.warriors && typeof state.warriors === 'object'
    ? state.warriors
    : null;
  const company = runtime && runtime.company && typeof runtime.company === 'object'
    ? runtime.company
    : null;
  if (!company) {
    return 0;
  }
  const identity = company.identity && typeof company.identity === 'object'
    ? company.identity
    : {};
  let baseBonus = 0;
  if (channel === 'duel') {
    baseBonus = clampUnit(Number(identity.duelBonus || 0));
  } else if (channel === 'training') {
    baseBonus = clampUnit(Number(identity.trainingBonus || 0));
  } else {
    baseBonus = clampUnit(Number(identity.dispatchBonus || 0));
  }
  if (baseBonus <= 0) {
    return 0;
  }
  if (channel === 'training') {
    return baseBonus;
  }
  const rosterIds = Array.isArray(company.rosterIds)
    ? company.rosterIds
    : [];
  const safeId = String(dwarfId || '');
  const onRoster = safeId && rosterIds.includes(safeId);
  const membershipScale = onRoster
    ? 1
    : clampUnit(Number(identityConfig.reserveMemberScale || 0));
  return clampUnit(baseBonus * membershipScale);
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
      emitWarriorMarkChanged(state, config, dwarf, {
        kind: 'scar',
        id: scarId,
        source: context.source,
        message: `Warrior League: ${fighterLabel} gained scar ${scarId}`,
      });
    }
    for (const titleId of gainedTitles) {
      emitWarriorMarkChanged(state, config, dwarf, {
        kind: 'title',
        id: titleId,
        source: context.source,
        message: `Warrior League: ${fighterLabel} gained title ${titleId}`,
      });
    }
    if (vowResult.changed) {
      if (vowResult.previousVow) {
        emitWarriorMarkChanged(state, config, dwarf, {
          kind: 'vow_replaced',
          id: warrior.vow,
          previousId: vowResult.previousVow,
          source: context.source,
          message: `Warrior League: ${fighterLabel} replaced vow ${vowResult.previousVow} -> ${warrior.vow}`,
        });
      } else if (warrior.vow) {
        emitWarriorMarkChanged(state, config, dwarf, {
          kind: 'vow_sworn',
          id: warrior.vow,
          source: context.source,
          message: `Warrior League: ${fighterLabel} swore vow ${warrior.vow}`,
        });
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
    if (warrior.retired === true) {
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
  refreshWarriorCompanyIdentity(state, config, warriors, runtime);
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
  runtime.company.identity = runtime.company.identity && typeof runtime.company.identity === 'object'
    ? runtime.company.identity
    : {};
  runtime.company.identity.name = typeof runtime.company.identity.name === 'string'
    ? runtime.company.identity.name
    : '';
  runtime.company.identity.focus = typeof runtime.company.identity.focus === 'string'
    ? runtime.company.identity.focus
    : 'balanced';
  runtime.company.identity.motto = typeof runtime.company.identity.motto === 'string'
    ? runtime.company.identity.motto
    : '';
  runtime.company.identity.renown = clampUnit(Number(runtime.company.identity.renown || 0));
  runtime.company.identity.dispatchBonus = clampUnit(Number(runtime.company.identity.dispatchBonus || 0));
  runtime.company.identity.duelBonus = clampUnit(Number(runtime.company.identity.duelBonus || 0));
  runtime.company.identity.trainingBonus = clampUnit(Number(runtime.company.identity.trainingBonus || 0));
  runtime.company.identity.updatedTick = Math.max(
    0,
    Math.floor(Number(runtime.company.identity.updatedTick || 0)),
  );
  runtime.company.carryover = runtime.company.carryover && typeof runtime.company.carryover === 'object'
    ? runtime.company.carryover
    : {};
  runtime.company.carryover.cycleIndex = Math.max(
    0,
    Math.floor(Number(runtime.company.carryover.cycleIndex || 0)),
  );
  runtime.company.carryover.retainedRenown = clampUnit(
    Number(runtime.company.carryover.retainedRenown || 0),
  );
  runtime.company.carryover.seedBonus = clampUnit(Number(runtime.company.carryover.seedBonus || 0));
  runtime.company.carryover.sourceChampionId = runtime.company.carryover.sourceChampionId
    ? String(runtime.company.carryover.sourceChampionId)
    : null;
  runtime.company.cycleHistory = Array.isArray(runtime.company.cycleHistory)
    ? runtime.company.cycleHistory
    : [];
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
  runtime.stats.injuries = Math.max(0, Math.floor(Number(runtime.stats.injuries || 0)));
  runtime.stats.retirements = Math.max(0, Math.floor(Number(runtime.stats.retirements || 0)));
  runtime.stats.recoveries = Math.max(0, Math.floor(Number(runtime.stats.recoveries || 0)));
  runtime.stats.trainingSessions = Math.max(0, Math.floor(Number(runtime.stats.trainingSessions || 0)));
  runtime.stats.trainingParticipants = Math.max(
    0,
    Math.floor(Number(runtime.stats.trainingParticipants || 0)),
  );
  runtime.stats.heroTurnovers = Math.max(0, Math.floor(Number(runtime.stats.heroTurnovers || 0)));
  const governorConfig = getWarriorsGovernorConfig(config);
  const governor = ensureWarriorsGovernorRuntime(runtime);
  if (governor) {
    governor.enabled = governorConfig.enabled === true;
    governor.thresholds.trainingIntent = clamp(
      Number(governorConfig.trainingIntentThreshold || 0.5),
      0,
      1,
    );
    governor.thresholds.rotationIntent = clamp(
      Number(governorConfig.rotationIntentThreshold || 0.5),
      0,
      1,
    );
    governor.thresholds.tournamentRiskIntent = clamp(
      Number(governorConfig.tournamentRiskIntentThreshold || 0.5),
      0,
      1,
    );
    governor.thresholds.championChallengeIntent = clamp(
      Number(governorConfig.championChallengeIntentThreshold || 0.5),
      0,
      1,
    );
    governor.thresholds.recoveryPriorityIntent = clamp(
      Number(governorConfig.recoveryPriorityIntentThreshold || 0.5),
      0,
      1,
    );
  }
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
  const warrior = dwarf && dwarf.warrior && typeof dwarf.warrior === 'object'
    ? dwarf.warrior
    : null;
  return Boolean(
    dwarf
    && String(dwarf.lifeStage || '') === 'adult'
    && dwarf.expedition !== true
    && (!warrior || warrior.retired !== true)
    && (!warrior || !hasWarriorActiveInjury(warrior))
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
function buildTournamentSeedEntry(dwarf, state, config, warriors) {
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
  const companyIdentityBonus = resolveWarriorCompanyIdentityBonus(
    state,
    dwarf && dwarf.id,
    warriors,
    'duel',
  );
  const seedScore = clampUnit(
    Number(warrior.rating || 0) * Number(seedWeights.rating || 0)
    + Number(warrior.valor || 0) * Number(seedWeights.valor || 0)
    + Number(warrior.heroPotential || 0) * Number(seedWeights.hero_potential || 0)
    + Number(warrior.condition && warrior.condition.score || 0) * Number(seedWeights.condition || 0)
    + survivalsNorm * Number(seedWeights.champion_survivals || 0)
    + Number(vowEffects.tournamentSeedBonus || 0)
    + personalLegacyBonus * clampUnit(Number(legacy.personalDuelScale || 0)) * 0.4
    + companyIdentityBonus * 0.45
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
    companyIdentityBonus,
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
    + personalLegacyBonus * clampUnit(Number(legacy.personalDuelScale || 0))
    + clampUnit(Number(entry && entry.companyIdentityBonus || 0))
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

// Pick one severity id from a normalized weight map.
function pickWarriorSeverity(weights, fallback = 'light') {
  const source = weights && typeof weights === 'object' ? weights : {};
  const entries = Object.entries(source)
    .map(([id, value]) => [String(id || '').trim(), Math.max(0, Number(value || 0))])
    .filter(([id, value]) => id && value > 0)
    .sort((left, right) => left[0].localeCompare(right[0]));
  if (entries.length === 0) {
    return String(fallback || 'light');
  }
  const total = entries.reduce((sum, entry) => sum + entry[1], 0);
  if (total <= 0) {
    return String(fallback || 'light');
  }
  let roll = Math.random() * total;
  for (const [id, weight] of entries) {
    if (roll <= weight) {
      return id;
    }
    roll -= weight;
  }
  return entries[entries.length - 1][0];
}

// Merge one new injury payload into warrior runtime keeping the higher severity/recovery budget.
function setWarriorInjuryState(warrior, severity, recoveryTicks, tick, source = 'league') {
  if (!warrior || typeof warrior !== 'object') {
    return null;
  }
  const nextSeverityRaw = String(severity || '').toLowerCase();
  const nextSeverity = getWarriorInjurySeverityRank(nextSeverityRaw) > 0
    ? nextSeverityRaw
    : 'light';
  const nextRecoveryTicks = Math.max(0, Math.floor(Number(recoveryTicks || 0)));
  if (nextRecoveryTicks <= 0) {
    warrior.injury = normalizeWarriorInjuryState(warrior.injury);
    return warrior.injury;
  }
  const previous = normalizeWarriorInjuryState(warrior.injury);
  if (!previous) {
    warrior.injury = {
      severity: nextSeverity,
      recoveryTicks: nextRecoveryTicks,
      source,
      lastTick: Math.max(0, Math.floor(Number(tick || 0))),
    };
    return warrior.injury;
  }
  const previousRank = getWarriorInjurySeverityRank(previous.severity);
  const nextRank = getWarriorInjurySeverityRank(nextSeverity);
  warrior.injury = {
    severity: nextRank >= previousRank ? nextSeverity : previous.severity,
    recoveryTicks: Math.max(
      Math.max(0, Math.floor(Number(previous.recoveryTicks || 0))),
      nextRecoveryTicks,
    ),
    source,
    lastTick: Math.max(0, Math.floor(Number(tick || 0))),
  };
  return warrior.injury;
}

// Apply one warrior retirement outcome after severe league consequences.
function applyWarriorLeagueRetirement(state, config, runtime, dwarf, warrior, tick, reason = 'injury') {
  if (!dwarf || !warrior || warrior.retired === true) {
    return false;
  }
  warrior.retired = true;
  warrior.nextEligibleExpeditionTick = Number.MAX_SAFE_INTEGER;
  warrior.injury = normalizeWarriorInjuryState(warrior.injury);
  if (runtime && runtime.stats) {
    runtime.stats.retirements = Math.max(0, Number(runtime.stats.retirements || 0)) + 1;
  }
  const label = formatWarriorDisplayName(dwarf, state, config);

  const league = runtime && runtime.league && typeof runtime.league === 'object'
    ? runtime.league
    : null;
  const leagueChampionId = league && league.championId ? String(league.championId) : '';
  if (league && leagueChampionId && leagueChampionId === String(dwarf.id || '')) {
    league.championId = null;
  }
  const underChampion = state
    && state.underrealm
    && state.underrealm.combat
    && state.underrealm.combat.dwarfChampion
    && typeof state.underrealm.combat.dwarfChampion === 'object'
      ? state.underrealm.combat.dwarfChampion
      : null;
  if (
    underChampion
    && typeof underChampion.activeDwarfId === 'string'
    && underChampion.activeDwarfId === String(dwarf.id || '')
  ) {
    underChampion.activeDwarfId = null;
    underChampion.activeSinceTick = 0;
    underChampion.losses = Math.max(0, Math.floor(Number(underChampion.losses || 0))) + 1;
    emitWarriorRetired(state, config, dwarf, {
      reason,
      message: `Warrior League: ${label} retired after ${reason}`,
    });
    emitWarriorUnderrealmCommandChanged(state, config, dwarf, {
      mode: 'relinquished',
      message: `Underrealm: champion ${label} stood down (retired)`,
    });
    return true;
  }
  emitWarriorRetired(state, config, dwarf, {
    reason,
    message: `Warrior League: ${label} retired after ${reason}`,
  });
  return true;
}

// Remove dwarves killed by Warrior League consequences and clean relationship/job references.
function applyWarriorLeagueDeaths(state, deadIds) {
  if (!deadIds || deadIds.size === 0) {
    return 0;
  }
  const ids = new Set(Array.from(deadIds).map((id) => String(id || '')).filter(Boolean));
  if (ids.size === 0) {
    return 0;
  }
  const removed = Array.isArray(state && state.dwarves)
    ? state.dwarves.filter((dwarf) => ids.has(String(dwarf && dwarf.id || ''))).length
    : 0;
  if (removed <= 0) {
    return 0;
  }
  state.deathsCount = Math.max(0, Number(state.deathsCount || 0)) + removed;
  state.lastDeathTick = Math.max(0, Math.floor(Number(state.tick || 0)));
  state.deathsByCause = state.deathsByCause && typeof state.deathsByCause === 'object'
    ? state.deathsByCause
    : {};
  state.deathsByCause.warriorLeague = Math.max(
    0,
    Number(state.deathsByCause.warriorLeague || 0),
  ) + removed;
  state.dwarves = (Array.isArray(state.dwarves) ? state.dwarves : [])
    .filter((dwarf) => !ids.has(String(dwarf && dwarf.id || '')));
  state.jobs = (Array.isArray(state.jobs) ? state.jobs : [])
    .filter((job) => !ids.has(String(job && job.dwarfId || '')));
  clearDeadSocialLinks(state, ids);

  const runtime = state && state.warriors && typeof state.warriors === 'object'
    ? state.warriors
    : null;
  if (runtime && runtime.league && runtime.league.championId && ids.has(String(runtime.league.championId || ''))) {
    runtime.league.championId = null;
  }
  if (runtime && runtime.company && Array.isArray(runtime.company.rosterIds)) {
    runtime.company.rosterIds = runtime.company.rosterIds
      .map((id) => String(id || ''))
      .filter((id) => !ids.has(id));
  }
  const underChampion = state
    && state.underrealm
    && state.underrealm.combat
    && state.underrealm.combat.dwarfChampion
    && typeof state.underrealm.combat.dwarfChampion === 'object'
      ? state.underrealm.combat.dwarfChampion
      : null;
  if (
    underChampion
    && typeof underChampion.activeDwarfId === 'string'
    && ids.has(String(underChampion.activeDwarfId || ''))
  ) {
    underChampion.activeDwarfId = null;
    underChampion.activeSinceTick = 0;
    underChampion.losses = Math.max(0, Math.floor(Number(underChampion.losses || 0))) + 1;
  }
  return removed;
}

// Check if one winning fighter satisfies hero-succession promotion thresholds.
function meetsWarriorHeroSuccessionRequirements(winner, heroSuccession) {
  if (!winner || !winner.warrior) {
    return false;
  }
  const warrior = winner.warrior;
  const conditionScore = clampUnit(Number(warrior.condition && warrior.condition.score || 0));
  return (
    conditionScore >= Number(heroSuccession.minConditionScore || 0)
    && clampUnit(Number(warrior.rating || 0)) >= Number(heroSuccession.minRating || 0)
    && clampUnit(Number(warrior.valor || 0)) >= Number(heroSuccession.minValor || 0)
    && clampUnit(Number(warrior.heroPotential || 0)) >= Number(heroSuccession.minHeroPotential || 0)
  );
}

// Apply hero succession when a reigning champion is defeated and gate checks pass.
function tryWarriorHeroSuccessionAfterDefeat(state, config, runtime, warriors, winner, loser, tick) {
  const tournaments = warriors && warriors.tournaments ? warriors.tournaments : {};
  const heroSuccession = tournaments.heroSuccession && typeof tournaments.heroSuccession === 'object'
    ? tournaments.heroSuccession
    : {};
  if (heroSuccession.enabled === false || !winner || !winner.dwarfId || !loser || !loser.dwarfId) {
    return false;
  }
  const reigningLeagueChampionId = runtime && runtime.league && runtime.league.championId
    ? String(runtime.league.championId)
    : '';
  const underChampion = state
    && state.underrealm
    && state.underrealm.combat
    && state.underrealm.combat.dwarfChampion
    && typeof state.underrealm.combat.dwarfChampion === 'object'
      ? state.underrealm.combat.dwarfChampion
      : null;
  const reigningUnderChampionId = underChampion && typeof underChampion.activeDwarfId === 'string'
    ? String(underChampion.activeDwarfId)
    : '';
  const loserId = String(loser.dwarfId || '');
  const defeatedChampion = Boolean(
    loserId
    && (
      (reigningLeagueChampionId && loserId === reigningLeagueChampionId)
      || (reigningUnderChampionId && loserId === reigningUnderChampionId)
    ),
  );
  if (heroSuccession.requireChampionDefeat !== false && !defeatedChampion) {
    return false;
  }
  if (!meetsWarriorHeroSuccessionRequirements(winner, heroSuccession)) {
    return false;
  }
  const governor = ensureWarriorsGovernorRuntime(runtime);
  const challengeAllowed = governor && governor.enabled === true
    ? governor.applied.championChallenge === true
    : true;
  if (!challengeAllowed) {
    return false;
  }
  if (heroSuccession.syncUnderrealmOnDefeat === false) {
    return false;
  }
  const promoted = syncWarriorLeagueChampionToUnderrealm(state, winner.dwarfId, tick);
  if (!promoted) {
    return false;
  }
  if (runtime && runtime.stats) {
    runtime.stats.heroTurnovers = Math.max(0, Number(runtime.stats.heroTurnovers || 0)) + 1;
  }
  const winnerLabel = formatWarriorDisplayName(winner.dwarf, state, config);
  const loserLabel = formatWarriorDisplayName(loser.dwarf, state, config);
  emitWarriorHeroCommandTaken(
    state,
    config,
    winner.dwarf,
    loser.dwarf,
    `Warrior League: ${winnerLabel} defeated ${loserLabel} and took hero command`,
  );
  return true;
}

// Apply tournament consequences (injury/recovery/retirement/death) after one duel.
function applyTournamentDuelConsequences(
  state,
  config,
  runtime,
  warriors,
  winner,
  loser,
  duel,
  tick,
  deadIds,
  deathEvents,
) {
  if (!winner || !loser || !winner.warrior || !loser.warrior || !winner.dwarf || !loser.dwarf) {
    return;
  }
  const tournaments = warriors && warriors.tournaments ? warriors.tournaments : {};
  const consequences = tournaments.consequences && typeof tournaments.consequences === 'object'
    ? tournaments.consequences
    : {};
  const governor = ensureWarriorsGovernorRuntime(runtime);
  const governorEnabled = governor && governor.enabled === true;
  const riskApplied = governorEnabled
    && governor.applied
    && governor.applied.tournamentRisk === true;
  const recoveryApplied = governorEnabled
    && governor.applied
    && governor.applied.recoveryPriority === true;
  const riskIntent = riskApplied
    ? clamp(Number(governor.intents.tournamentRiskIntent || 0), 0, 1)
    : 0.5;
  const recoveryIntent = recoveryApplied
    ? clamp(Number(governor.intents.recoveryPriorityIntent || 0), 0, 1)
    : 0;

  winner.dwarf.state = winner.dwarf.state && typeof winner.dwarf.state === 'object'
    ? winner.dwarf.state
    : {};
  winner.dwarf.state.fatigue = clampUnit(
    Number(winner.dwarf.state.fatigue || 0) + Number(consequences.winnerFatigueGain || 0),
  );
  winner.dwarf.state.stress = clampUnit(
    Number(winner.dwarf.state.stress || 0) + Number(consequences.winnerStressGain || 0),
  );
  winner.warrior.condition = createDwarfWarriorConditionSnapshot(winner.dwarf, config);
  winner.warrior.heroPotential = computeHeroPotential(
    winner.warrior.baseCombatAptitude,
    winner.warrior.condition.score,
    config,
  );

  tryWarriorHeroSuccessionAfterDefeat(
    state,
    config,
    runtime,
    warriors,
    winner,
    loser,
    tick,
  );

  if (consequences.enabled === false) {
    return;
  }
  const scoreGap = clamp(
    Math.abs(Number(duel && duel.winnerScore || 0) - Number(duel && duel.loserScore || 0)),
    0,
    1,
  );
  let injuryChance = clamp(
    Number(consequences.injuryBaseChance || 0)
      + scoreGap * Number(consequences.injuryScoreGapScale || 0)
      + ((duel && duel.tieBreakUsed) ? Number(consequences.injuryTieBreakBonus || 0) : 0),
    0,
    1,
  );
  const riskScale = Math.max(
    0,
    1 + (riskIntent - 0.5) * 2 * Number(consequences.riskIntentInjuryScale || 0),
  );
  injuryChance = clamp(injuryChance * riskScale, 0, 1);
  injuryChance = clamp(
    injuryChance * (1 - recoveryIntent * Number(consequences.recoveryIntentInjuryReduction || 0)),
    0,
    1,
  );
  if (Math.random() >= injuryChance) {
    return;
  }

  const baseWeights = consequences.severityWeights && typeof consequences.severityWeights === 'object'
    ? consequences.severityWeights
    : { light: 1 };
  const weighted = {
    light: Math.max(0, Number(baseWeights.light || 0)),
    moderate: Math.max(0, Number(baseWeights.moderate || 0)),
    severe: Math.max(0, Number(baseWeights.severe || 0)),
  };
  weighted.severe *= 1 + riskIntent * Number(consequences.riskIntentSeverityBias || 0);
  weighted.light *= 1 + recoveryIntent * Number(consequences.recoveryIntentSeverityBias || 0);
  const severityWeights = normalizeWeightMap(weighted, baseWeights);
  const severity = pickWarriorSeverity(severityWeights, 'light');
  const recoveryTicksMap = consequences.recoveryTicks && typeof consequences.recoveryTicks === 'object'
    ? consequences.recoveryTicks
    : {};
  const recoveryTicks = Math.max(0, Math.floor(Number(recoveryTicksMap[severity] || 0)));
  const ratingPenaltyMap = consequences.ratingPenalty && typeof consequences.ratingPenalty === 'object'
    ? consequences.ratingPenalty
    : {};
  const valorPenaltyMap = consequences.valorPenalty && typeof consequences.valorPenalty === 'object'
    ? consequences.valorPenalty
    : {};
  const fatigueGainMap = consequences.fatigueGain && typeof consequences.fatigueGain === 'object'
    ? consequences.fatigueGain
    : {};
  const stressGainMap = consequences.stressGain && typeof consequences.stressGain === 'object'
    ? consequences.stressGain
    : {};
  const moraleDeltaMap = consequences.moraleDelta && typeof consequences.moraleDelta === 'object'
    ? consequences.moraleDelta
    : {};

  setWarriorInjuryState(loser.warrior, severity, recoveryTicks, tick, 'tournament');
  loser.warrior.rating = clampUnit(
    Number(loser.warrior.rating || 0) + Number(ratingPenaltyMap[severity] || 0),
  );
  loser.warrior.valor = clampUnit(
    Number(loser.warrior.valor || 0) + Number(valorPenaltyMap[severity] || 0),
  );
  loser.warrior.nextEligibleExpeditionTick = Math.max(
    Math.max(0, Math.floor(Number(loser.warrior.nextEligibleExpeditionTick || 0))),
    Math.max(0, Math.floor(Number(tick || 0))) + recoveryTicks,
  );

  loser.dwarf.state = loser.dwarf.state && typeof loser.dwarf.state === 'object'
    ? loser.dwarf.state
    : {};
  loser.dwarf.state.fatigue = clampUnit(
    Number(loser.dwarf.state.fatigue || 0) + Number(fatigueGainMap[severity] || 0),
  );
  loser.dwarf.state.stress = clampUnit(
    Number(loser.dwarf.state.stress || 0) + Number(stressGainMap[severity] || 0),
  );
  loser.dwarf.state.morale = clampUnit(
    Number(loser.dwarf.state.morale || 0) + Number(moraleDeltaMap[severity] || 0),
  );
  loser.warrior.condition = createDwarfWarriorConditionSnapshot(loser.dwarf, config);
  loser.warrior.heroPotential = computeHeroPotential(
    loser.warrior.baseCombatAptitude,
    loser.warrior.condition.score,
    config,
  );
  if (runtime && runtime.stats) {
    runtime.stats.injuries = Math.max(0, Number(runtime.stats.injuries || 0)) + 1;
  }

  const loserLabel = formatWarriorDisplayName(loser.dwarf, state, config);
  emitWarriorTournamentInjury(state, config, loser.dwarf, {
    severity,
    recoveryTicks,
    message: `Warrior League: ${loserLabel} suffered ${severity} injury (${recoveryTicks} recovery ticks)`,
  });

  const lifeStage = String(loser.dwarf.lifeStage || '');
  const ageMultiplier = lifeStage === 'elder' ? 1.4 : 1;
  const retirementChanceMap = consequences.retirementChance && typeof consequences.retirementChance === 'object'
    ? consequences.retirementChance
    : {};
  const deathChanceMap = consequences.deathChance && typeof consequences.deathChance === 'object'
    ? consequences.deathChance
    : {};
  let retirementChance = consequences.allowRetirements !== false
    ? Math.max(0, Number(retirementChanceMap[severity] || 0))
    : 0;
  let deathChance = consequences.allowDeath === true
    ? Math.max(0, Number(deathChanceMap[severity] || 0))
    : 0;
  deathChance = clamp(deathChance * ageMultiplier * (1 + riskIntent * 0.5) * (1 - recoveryIntent * 0.4), 0, 1);
  retirementChance = clamp(
    retirementChance * ageMultiplier * (1 + riskIntent * 0.35) * (1 - recoveryIntent * 0.25),
    0,
    1,
  );

  if (deathChance > 0 && Math.random() < deathChance) {
    if (deadIds && typeof deadIds.add === 'function') {
      deadIds.add(String(loser.dwarfId || ''));
    }
    if (Array.isArray(deathEvents)) {
      deathEvents.push({
        dwarf: loser.dwarf,
        message: `Warrior League: ${loserLabel} fell in tournament combat`,
      });
    }
    return;
  }
  if (retirementChance > 0 && Math.random() < retirementChance) {
    applyWarriorLeagueRetirement(state, config, runtime, loser.dwarf, loser.warrior, tick, 'tournament injuries');
  }
}

// Tick injury recovery for all active warriors and refresh condition snapshots.
function tickWarriorInjuryRecovery(state, config, runtime, warriors) {
  const training = warriors && warriors.training ? warriors.training : {};
  const progression = training && training.progression ? training.progression : {};
  const governor = ensureWarriorsGovernorRuntime(runtime);
  const recoveryIntent = governor
    && governor.enabled === true
    && governor.applied
    && governor.applied.recoveryPriority === true
    ? clamp(Number(governor.intents.recoveryPriorityIntent || 0), 0, 1)
    : 0;
  const extraRecoveryStep = recoveryIntent >= 0.7 ? 1 : 0;
  const dwarves = Array.isArray(state && state.dwarves) ? state.dwarves : [];
  for (const dwarf of dwarves) {
    const warrior = ensureDwarfWarriorState(dwarf, config);
    if (!warrior || !hasWarriorActiveInjury(warrior)) {
      continue;
    }
    const injury = warrior.injury;
    const current = Math.max(0, Math.floor(Number(injury.recoveryTicks || 0)));
    if (current <= 0) {
      warrior.injury = null;
      continue;
    }
    const step = 1 + extraRecoveryStep;
    const next = Math.max(0, current - step);
    injury.recoveryTicks = next;
    injury.lastTick = Math.max(0, Math.floor(Number(state && state.tick || 0)));
    dwarf.state = dwarf.state && typeof dwarf.state === 'object'
      ? dwarf.state
      : {};
    const relief = Number(progression.recoveryRelief || 0);
    if (relief > 0) {
      dwarf.state.fatigue = clampUnit(Number(dwarf.state.fatigue || 0) - relief * 0.6 * step);
      dwarf.state.stress = clampUnit(Number(dwarf.state.stress || 0) - relief * 0.8 * step);
    }
    warrior.condition = createDwarfWarriorConditionSnapshot(dwarf, config);
    warrior.heroPotential = computeHeroPotential(
      warrior.baseCombatAptitude,
      warrior.condition.score,
      config,
    );
    if (next <= 0) {
      warrior.injury = null;
      if (runtime && runtime.stats) {
        runtime.stats.recoveries = Math.max(0, Number(runtime.stats.recoveries || 0)) + 1;
      }
    }
  }
}

// Build training candidates sorted by growth need + rotation recency balance.
function buildWarriorTrainingCandidates(state, config, warriors, runtime, tick) {
  const training = warriors && warriors.training ? warriors.training : {};
  const governor = ensureWarriorsGovernorRuntime(runtime);
  const rotationIntent = governor
    && governor.enabled === true
    && governor.applied
    && governor.applied.rotation === true
    ? clamp(Number(governor.intents.rotationIntent || 0), 0, 1)
    : 0.35;
  const windowTicks = Math.max(1, Math.floor(Number(training.rotationWindowTicks || 1)));
  const dwarves = Array.isArray(state && state.dwarves) ? state.dwarves : [];
  return dwarves
    .filter((dwarf) => dwarf && String(dwarf.lifeStage || '') === 'adult' && dwarf.expedition !== true)
    .map((dwarf) => ({
      dwarf,
      warrior: ensureDwarfWarriorState(dwarf, config),
    }))
    .filter((entry) => entry.warrior && entry.warrior.retired !== true)
    .filter((entry) => {
      if (training.skipInjured !== false && hasWarriorActiveInjury(entry.warrior)) {
        return false;
      }
      const conditionScore = clampUnit(Number(entry.warrior.condition && entry.warrior.condition.score || 0));
      if (conditionScore < Number(training.minConditionScore || 0)) {
        return false;
      }
      const fatigue = clampUnit(Number(entry.dwarf && entry.dwarf.state && entry.dwarf.state.fatigue || 0));
      const stress = clampUnit(Number(entry.dwarf && entry.dwarf.state && entry.dwarf.state.stress || 0));
      return fatigue <= Number(training.fatigueCeiling || 1) && stress <= Number(training.stressCeiling || 1);
    })
    .map((entry) => {
      const warrior = entry.warrior;
      const growthNeed = clamp(
        (1 - clampUnit(Number(warrior.rating || 0))) * 0.6
        + (1 - clampUnit(Number(warrior.valor || 0))) * 0.4,
        0,
        1,
      );
      const lastTrainingTick = Math.max(0, Math.floor(Number(warrior.lastTrainingTick || 0)));
      const rotationRecency = clamp((Math.max(0, tick - lastTrainingTick)) / windowTicks, 0, 1);
      const conditionScore = clampUnit(Number(warrior.condition && warrior.condition.score || 0));
      const score = clamp(
        growthNeed * (1 - rotationIntent * 0.5)
        + rotationRecency * rotationIntent
        + conditionScore * 0.2,
        0,
        2,
      );
      return {
        ...entry,
        score,
        lastTrainingTick,
      };
    })
    .sort((left, right) => {
      if (Math.abs(Number(right.score || 0) - Number(left.score || 0)) > 1e-9) {
        return Number(right.score || 0) - Number(left.score || 0);
      }
      if (left.lastTrainingTick !== right.lastTrainingTick) {
        return left.lastTrainingTick - right.lastTrainingTick;
      }
      const leftSpawn = Math.max(0, Math.floor(Number(left.dwarf && left.dwarf.spawnIndex || 0)));
      const rightSpawn = Math.max(0, Math.floor(Number(right.dwarf && right.dwarf.spawnIndex || 0)));
      if (leftSpawn !== rightSpawn) {
        return leftSpawn - rightSpawn;
      }
      return String(left.dwarf && left.dwarf.id || '').localeCompare(String(right.dwarf && right.dwarf.id || ''));
    });
}

// Run one periodic warrior training session with bounded costs and progression gains.
function runWarriorTraining(state, config, runtime, warriors) {
  const training = warriors && warriors.training ? warriors.training : {};
  if (training.enabled === false) {
    return;
  }
  const tick = Math.max(0, Math.floor(Number(state && state.tick || 0)));
  const interval = Math.max(1, Math.floor(Number(training.tickInterval || 1)));
  if (tick % interval !== 0) {
    return;
  }
  const governor = ensureWarriorsGovernorRuntime(runtime);
  const governorEnabled = governor && governor.enabled === true;
  const trainingApplied = governorEnabled
    && governor.applied
    && governor.applied.training === true;
  const recoveryApplied = governorEnabled
    && governor.applied
    && governor.applied.recoveryPriority === true;
  if (governorEnabled && !trainingApplied) {
    return;
  }
  const trainingIntent = trainingApplied
    ? clamp(Number(governor.intents.trainingIntent || 0), 0, 1)
    : 1;
  const recoveryIntent = recoveryApplied
    ? clamp(Number(governor.intents.recoveryPriorityIntent || 0), 0, 1)
    : 0;
  const companyTrainingBonus = resolveWarriorCompanyIdentityBonus(
    state,
    null,
    warriors,
    'training',
  );
  const intensity = clamp(
    0.25 + trainingIntent * 0.9 - recoveryIntent * 0.35 + companyTrainingBonus,
    0.1,
    1,
  );
  const maxParticipants = Math.max(
    Math.max(1, Math.floor(Number(training.baseParticipants || 1))),
    Math.floor(Number(training.maxParticipants || 1)),
  );
  const minParticipants = Math.max(1, Math.floor(Number(training.baseParticipants || 1)));
  const participantsTarget = clamp(
    Math.floor(minParticipants + (maxParticipants - minParticipants) * intensity),
    minParticipants,
    maxParticipants,
  );
  const costs = training.costPerSession && typeof training.costPerSession === 'object'
    ? training.costPerSession
    : {};
  if (Object.keys(costs).length > 0 && !hasInputs(state.stockpile || {}, costs)) {
    return;
  }
  const candidates = buildWarriorTrainingCandidates(state, config, warriors, runtime, tick);
  if (candidates.length === 0) {
    return;
  }
  const selected = candidates.slice(0, Math.max(1, Math.min(participantsTarget, candidates.length)));
  if (selected.length === 0) {
    return;
  }
  if (Object.keys(costs).length > 0) {
    consumeInputs(state.stockpile || {}, costs);
  }
  const progression = training.progression && typeof training.progression === 'object'
    ? training.progression
    : {};
  for (const entry of selected) {
    const dwarf = entry.dwarf;
    const warrior = entry.warrior;
    if (!dwarf || !warrior) {
      continue;
    }
    dwarf.state = dwarf.state && typeof dwarf.state === 'object'
      ? dwarf.state
      : {};
    const growthGate = clamp(0.6 + (1 - clampUnit(Number(warrior.rating || 0))) * 0.4, 0, 1.5);
    warrior.rating = clampUnit(
      Number(warrior.rating || 0) + Number(progression.ratingGain || 0) * intensity * growthGate,
    );
    warrior.valor = clampUnit(
      Number(warrior.valor || 0) + Number(progression.valorGain || 0) * intensity * growthGate,
    );
    warrior.heroPotential = clampUnit(
      Number(warrior.heroPotential || 0)
      + Number(progression.heroPotentialGain || 0)
      * intensity
      * (1 - clampUnit(Number(warrior.heroPotential || 0))),
    );
    dwarf.state.fatigue = clampUnit(
      Number(dwarf.state.fatigue || 0)
      + Number(progression.fatigueGain || 0) * intensity * (1 - recoveryIntent * 0.5),
    );
    dwarf.state.stress = clampUnit(
      Number(dwarf.state.stress || 0)
      + Number(progression.stressGain || 0) * intensity * (1 - recoveryIntent * 0.4),
    );
    dwarf.state.morale = clampUnit(
      Number(dwarf.state.morale || 0) + Number(progression.moraleDelta || 0) * intensity,
    );
    warrior.condition = createDwarfWarriorConditionSnapshot(dwarf, config);
    warrior.heroPotential = computeHeroPotential(
      warrior.baseCombatAptitude,
      warrior.condition.score,
      config,
    );
    warrior.trainingSessions = Math.max(0, Math.floor(Number(warrior.trainingSessions || 0))) + 1;
    warrior.lastTrainingTick = tick;
  }
  if (runtime && runtime.stats) {
    runtime.stats.trainingSessions = Math.max(0, Number(runtime.stats.trainingSessions || 0)) + 1;
    runtime.stats.trainingParticipants = Math.max(0, Number(runtime.stats.trainingParticipants || 0)) + selected.length;
  }
}

// Select tournament participants with optional governor-driven rotation/recovery filtering.
function selectWarriorTournamentParticipants(entries, maxParticipants, runtime, tick) {
  const pool = Array.isArray(entries) ? entries.slice() : [];
  const limit = Math.max(0, Math.min(Math.floor(Number(maxParticipants || 0)), pool.length));
  if (limit <= 0) {
    return [];
  }
  const governor = ensureWarriorsGovernorRuntime(runtime);
  const governorEnabled = governor && governor.enabled === true;
  const rotationIntent = governorEnabled
    && governor.applied
    && governor.applied.rotation === true
    ? clamp(Number(governor.intents.rotationIntent || 0), 0, 1)
    : 0;
  const recoveryIntent = governorEnabled
    && governor.applied
    && governor.applied.recoveryPriority === true
    ? clamp(Number(governor.intents.recoveryPriorityIntent || 0), 0, 1)
    : 0;
  const recoveredPool = recoveryIntent >= 0.5
    ? pool.filter((entry) => !hasWarriorActiveInjury(entry && entry.warrior))
    : pool;
  const sourcePool = recoveredPool.length >= Math.max(2, Math.ceil(limit * 0.7))
    ? recoveredPool
    : pool;
  if (sourcePool.length <= limit || rotationIntent <= 0.05) {
    return sourcePool.slice(0, limit);
  }
  const reserveSlots = Math.min(limit - 1, Math.floor(limit * rotationIntent * 0.45));
  if (reserveSlots <= 0) {
    return sourcePool.slice(0, limit);
  }
  const coreSlots = Math.max(1, limit - reserveSlots);
  const core = sourcePool.slice(0, coreSlots);
  const selectedIds = new Set(core.map((entry) => String(entry && entry.dwarfId || '')));
  const bench = sourcePool
    .filter((entry) => !selectedIds.has(String(entry && entry.dwarfId || '')))
    .sort((left, right) => {
      const leftTick = Math.max(0, Math.floor(Number(left && left.warrior && left.warrior.lastTournamentTick || 0)));
      const rightTick = Math.max(0, Math.floor(Number(right && right.warrior && right.warrior.lastTournamentTick || 0)));
      if (leftTick !== rightTick) {
        return leftTick - rightTick;
      }
      const leftReady = clampUnit(Number(left && left.conditionScore || 0));
      const rightReady = clampUnit(Number(right && right.conditionScore || 0));
      if (Math.abs(rightReady - leftReady) > 1e-9) {
        return rightReady - leftReady;
      }
      return compareTournamentSeedEntries(left, right);
    });
  const selected = core.slice();
  for (const entry of bench) {
    if (selected.length >= limit) {
      break;
    }
    selected.push(entry);
  }
  return selected
    .sort(compareTournamentSeedEntries)
    .slice(0, limit);
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
    .map((dwarf) => buildTournamentSeedEntry(dwarf, state, config, warriors))
    .filter(Boolean)
    .sort(compareTournamentSeedEntries);
  const maxParticipants = Math.max(
    Number(tournaments.minParticipants || 2),
    Math.floor(Number(tournaments.maxParticipants || 16)),
  );
  const participants = selectWarriorTournamentParticipants(
    adults,
    maxParticipants,
    runtime,
    tick,
  );
  const deadIds = new Set();
  const deathEvents = [];
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
      applyTournamentDuelConsequences(
        state,
        config,
        runtime,
        warriors,
        winner,
        loser,
        duel,
        tick,
        deadIds,
        deathEvents,
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

  const previousChampionId = runtime.league.championId
    ? String(runtime.league.championId)
    : '';
  runtime.league.championId = championId;
  if (previousChampionId && championId && previousChampionId !== championId) {
    runtime.stats.heroTurnovers = Math.max(0, Number(runtime.stats.heroTurnovers || 0)) + 1;
  }
  runtime.league.clanScoreById = clanScoreById;
  runtime.league.ranking = ranking;
  runtime.stats.tournaments = Math.max(0, Number(runtime.stats.tournaments || 0)) + 1;
  runtime.stats.tieBreaks = Math.max(0, Number(runtime.stats.tieBreaks || 0)) + tieBreaks;
  runtime.stats.upsets = Math.max(0, Number(runtime.stats.upsets || 0)) + upsets;

  if (deadIds.size > 0) {
    applyWarriorLeagueDeaths(state, deadIds);
    for (const deathEvent of deathEvents) {
      emitWarriorTournamentDeath(state, config, deathEvent.dwarf, deathEvent.message);
    }
  }

  const rosterSize = Math.max(1, Math.floor(Number(legacy.companyRosterSize || 12)));
  runtime.company.rosterIds = ranking.slice(0, rosterSize).map((entry) => String(entry.dwarfId || ''));
  refreshWarriorCompanyLegacyAura(state, config, warriors, runtime);
  refreshWarriorCompanyIdentity(state, config, warriors, runtime);
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
    refreshWarriorCompanyIdentity(state, config, warriors, runtime);
  }

  if (champion) {
    const leagueName = runtime.league.lastTournamentLeagueName || resolveWarriorLeagueEpicName(
      state,
      config,
      runtime.league.lastTournamentSeasonId,
    );
    const fighterLabel = formatWarriorDisplayName(champion.dwarf, state, config);
    const championLabel = champion.clanId ? `${fighterLabel} (${champion.clanId})` : fighterLabel;
    emitWarriorTournamentCrowned(state, config, {
      champion: champion.dwarf,
      previousChampionId,
      seasonId: runtime.league.lastTournamentSeasonId,
      participantCount: participants.length,
      message: `Warrior League ${leagueName} S${runtime.league.lastTournamentSeasonId}: champion ${championLabel}`,
    });
    const identity = runtime.company && runtime.company.identity && typeof runtime.company.identity === 'object'
      ? runtime.company.identity
      : null;
    if (identity && identity.name) {
      emitWarriorCompanyDoctrine(
        state,
        config,
        champion.dwarf,
        identity,
        `Warrior Company ${identity.name}: ${identity.focus} doctrine active (${(clampUnit(Number(identity.renown || 0)) * 100).toFixed(1)}% renown)`,
      );
    }
    if (tournaments.syncUnderrealmChampion) {
      const synced = syncWarriorLeagueChampionToUnderrealm(state, champion.dwarfId, tick);
      if (synced) {
        emitWarriorUnderrealmCommandChanged(state, config, champion.dwarf, {
          mode: 'synced',
          message: `Warrior League: ${fighterLabel} synced to Underrealm Dwarf Champion command`,
        });
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

// Resolve normalized warriors-governor config with safe defaults.
function getWarriorsGovernorConfig(config) {
  const aiConfig = (config && config.ai) || {};
  const governors = aiConfig.governors && typeof aiConfig.governors === 'object'
    ? aiConfig.governors
    : {};
  const source = governors.warriors && typeof governors.warriors === 'object'
    ? governors.warriors
    : {};
  return {
    enabled: source.enabled !== false,
    trainingIntentThreshold: clamp(Number(source.trainingIntentThreshold ?? 0.5), 0, 1),
    rotationIntentThreshold: clamp(Number(source.rotationIntentThreshold ?? 0.5), 0, 1),
    tournamentRiskIntentThreshold: clamp(Number(source.tournamentRiskIntentThreshold ?? 0.5), 0, 1),
    championChallengeIntentThreshold: clamp(
      Number(source.championChallengeIntentThreshold ?? 0.5),
      0,
      1,
    ),
    recoveryPriorityIntentThreshold: clamp(
      Number(source.recoveryPriorityIntentThreshold ?? 0.5),
      0,
      1,
    ),
  };
}

// Resolve optional warriors action payload from governor envelope.
function getWarriorsGovernorAction(action) {
  if (!action || typeof action !== 'object') {
    return null;
  }
  return action.warriors && typeof action.warriors === 'object'
    ? action.warriors
    : null;
}

// Normalize one warriors-governor intent from AI action range into 0..1.
function normalizeWarriorsGovernorIntent(value, config, fallback) {
  const aiConfig = (config && config.ai) || {};
  const minWeightRaw = Number(aiConfig.minWeight);
  const maxWeightRaw = Number(aiConfig.maxWeight);
  const minWeight = Number.isFinite(minWeightRaw) ? minWeightRaw : 0;
  const maxWeight = Number.isFinite(maxWeightRaw) ? maxWeightRaw : 1;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return clamp(Number(fallback || 0), 0, 1);
  }
  if (maxWeight > minWeight) {
    return clamp((numeric - minWeight) / (maxWeight - minWeight), 0, 1);
  }
  return clamp(numeric, 0, 1);
}

// Resolve dominant warriors-governor intent with deterministic tie-break ordering.
function resolveWarriorsGovernorDominantIntent(intents) {
  const source = intents && typeof intents === 'object' ? intents : {};
  return [
    { id: 'training', value: clamp(Number(source.trainingIntent || 0), 0, 1) },
    { id: 'rotation', value: clamp(Number(source.rotationIntent || 0), 0, 1) },
    { id: 'tournamentRisk', value: clamp(Number(source.tournamentRiskIntent || 0), 0, 1) },
    { id: 'championChallenge', value: clamp(Number(source.championChallengeIntent || 0), 0, 1) },
    { id: 'recoveryPriority', value: clamp(Number(source.recoveryPriorityIntent || 0), 0, 1) },
  ]
    .sort((left, right) => {
      if (right.value !== left.value) {
        return right.value - left.value;
      }
      return left.id.localeCompare(right.id);
    })[0].id;
}

// Ensure one normalized warriors-governor runtime block exists on warrior state.
function ensureWarriorsGovernorRuntime(runtime) {
  if (!runtime || typeof runtime !== 'object') {
    return null;
  }
  const governor = runtime.governor && typeof runtime.governor === 'object'
    ? runtime.governor
    : {};
  const intents = governor.intents && typeof governor.intents === 'object'
    ? governor.intents
    : {};
  const thresholds = governor.thresholds && typeof governor.thresholds === 'object'
    ? governor.thresholds
    : {};
  const applied = governor.applied && typeof governor.applied === 'object'
    ? governor.applied
    : {};
  runtime.governor = {
    enabled: governor.enabled !== false,
    source: governor.source === 'action' ? 'action' : 'default',
    intents: {
      trainingIntent: clamp(Number(intents.trainingIntent || 0), 0, 1),
      rotationIntent: clamp(Number(intents.rotationIntent || 0), 0, 1),
      tournamentRiskIntent: clamp(Number(intents.tournamentRiskIntent || 0), 0, 1),
      championChallengeIntent: clamp(Number(intents.championChallengeIntent || 0), 0, 1),
      recoveryPriorityIntent: clamp(Number(intents.recoveryPriorityIntent || 0), 0, 1),
    },
    thresholds: {
      trainingIntent: clamp(Number(thresholds.trainingIntent || 0.5), 0, 1),
      rotationIntent: clamp(Number(thresholds.rotationIntent || 0.5), 0, 1),
      tournamentRiskIntent: clamp(Number(thresholds.tournamentRiskIntent || 0.5), 0, 1),
      championChallengeIntent: clamp(Number(thresholds.championChallengeIntent || 0.5), 0, 1),
      recoveryPriorityIntent: clamp(Number(thresholds.recoveryPriorityIntent || 0.5), 0, 1),
    },
    applied: {
      training: applied.training === true,
      rotation: applied.rotation === true,
      tournamentRisk: applied.tournamentRisk === true,
      championChallenge: applied.championChallenge === true,
      recoveryPriority: applied.recoveryPriority === true,
    },
    dominantIntent: typeof governor.dominantIntent === 'string' && governor.dominantIntent
      ? governor.dominantIntent
      : 'training',
    lastDecisionTick: Math.max(0, Math.floor(Number(governor.lastDecisionTick || 0))),
  };
  return runtime.governor;
}

// Resolve one warriors-governor runtime decision snapshot from action envelope + config defaults.
function resolveWarriorsGovernorState(state, config, runtime, action) {
  const governorConfig = getWarriorsGovernorConfig(config);
  const governor = ensureWarriorsGovernorRuntime(runtime);
  if (!governor) {
    return null;
  }
  governor.enabled = governorConfig.enabled === true;
  governor.thresholds.trainingIntent = governorConfig.trainingIntentThreshold;
  governor.thresholds.rotationIntent = governorConfig.rotationIntentThreshold;
  governor.thresholds.tournamentRiskIntent = governorConfig.tournamentRiskIntentThreshold;
  governor.thresholds.championChallengeIntent = governorConfig.championChallengeIntentThreshold;
  governor.thresholds.recoveryPriorityIntent = governorConfig.recoveryPriorityIntentThreshold;

  const warriorsAction = governor.enabled ? getWarriorsGovernorAction(action) : null;
  const hasIntent = (field) => Boolean(
    warriorsAction && Object.prototype.hasOwnProperty.call(warriorsAction, field),
  );
  const hasAnyIntent = hasIntent('trainingIntent')
    || hasIntent('rotationIntent')
    || hasIntent('tournamentRiskIntent')
    || hasIntent('championChallengeIntent')
    || hasIntent('recoveryPriorityIntent');
  const intentOrFallback = (field) => (hasIntent(field)
    ? normalizeWarriorsGovernorIntent(warriorsAction[field], config, 1)
    : 1);
  const intents = {
    trainingIntent: intentOrFallback('trainingIntent'),
    rotationIntent: intentOrFallback('rotationIntent'),
    tournamentRiskIntent: intentOrFallback('tournamentRiskIntent'),
    championChallengeIntent: intentOrFallback('championChallengeIntent'),
    recoveryPriorityIntent: intentOrFallback('recoveryPriorityIntent'),
  };
  governor.source = hasAnyIntent ? 'action' : 'default';
  governor.intents = intents;
  governor.applied = {
    training: governor.enabled && intents.trainingIntent >= governor.thresholds.trainingIntent,
    rotation: governor.enabled && intents.rotationIntent >= governor.thresholds.rotationIntent,
    tournamentRisk: governor.enabled
      && intents.tournamentRiskIntent >= governor.thresholds.tournamentRiskIntent,
    championChallenge: governor.enabled
      && intents.championChallengeIntent >= governor.thresholds.championChallengeIntent,
    recoveryPriority: governor.enabled
      && intents.recoveryPriorityIntent >= governor.thresholds.recoveryPriorityIntent,
  };
  governor.dominantIntent = resolveWarriorsGovernorDominantIntent(intents);
  governor.lastDecisionTick = Math.max(0, Math.floor(Number(state && state.tick || 0)));
  return governor;
}

// Update Warrior League seasonal runtime and execute cadence-gated tournaments.
function updateWarriors(state, config, action = null) {
  const runtime = ensureWarriorsRuntimeState(state, config);
  if (!runtime) {
    return;
  }
  const warriors = getWarriorsConfig(config);
  runtime.enabled = warriors.enabled === true;
  if (runtime.enabled !== true) {
    return;
  }
  resolveWarriorsGovernorState(state, config, runtime, action);
  tickWarriorInjuryRecovery(state, config, runtime, warriors);
  refreshWarriorCompanyLegacyAura(state, config, warriors, runtime);
  refreshWarriorCompanyIdentity(state, config, warriors, runtime);
  runWarriorTraining(state, config, runtime, warriors);
  refreshWarriorCompanyLegacyAura(state, config, warriors, runtime);
  refreshWarriorCompanyIdentity(state, config, warriors, runtime);
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
    retired: false,
    injury: null,
    trainingSessions: 0,
    lastTrainingTick: 0,
    lastTournamentTick: 0,
    lastExpeditionTick: 0,
    nextEligibleExpeditionTick: 0,
    enabled: warriors.enabled === true,
  };
}

// Create initial warriors runtime container.
function createWarriorsState(config) {
  const warriors = getWarriorsConfig(config);
  const governorConfig = getWarriorsGovernorConfig(config);
  return {
    enabled: warriors.enabled === true,
    company: {
      rosterIds: [],
      hallOfFame: [],
      legacyAura: 0,
      identity: {
        name: '',
        focus: 'balanced',
        motto: '',
        renown: 0,
        dispatchBonus: 0,
        duelBonus: 0,
        trainingBonus: 0,
        updatedTick: 0,
      },
      carryover: {
        cycleIndex: 0,
        retainedRenown: 0,
        seedBonus: 0,
        sourceChampionId: null,
      },
      cycleHistory: [],
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
      injuries: 0,
      retirements: 0,
      recoveries: 0,
      trainingSessions: 0,
      trainingParticipants: 0,
      heroTurnovers: 0,
    },
    governor: {
      enabled: governorConfig.enabled === true,
      source: 'default',
      intents: {
        trainingIntent: 1,
        rotationIntent: 1,
        tournamentRiskIntent: 1,
        championChallengeIntent: 1,
        recoveryPriorityIntent: 1,
      },
      thresholds: {
        trainingIntent: governorConfig.trainingIntentThreshold,
        rotationIntent: governorConfig.rotationIntentThreshold,
        tournamentRiskIntent: governorConfig.tournamentRiskIntentThreshold,
        championChallengeIntent: governorConfig.championChallengeIntentThreshold,
        recoveryPriorityIntent: governorConfig.recoveryPriorityIntentThreshold,
      },
      applied: {
        training: true,
        rotation: true,
        tournamentRisk: true,
        championChallenge: true,
        recoveryPriority: true,
      },
      dominantIntent: 'training',
      lastDecisionTick: 0,
    },
  };
}

// Carry warrior-company lineage and apply bounded startup hooks across endgame cycle resets.
function carryWarriorCompanyAcrossCycle(previousState, nextState, config) {
  const warriors = getWarriorsConfig(config);
  const bonuses = warriors && warriors.bonuses ? warriors.bonuses : {};
  const legacy = bonuses && bonuses.legacy ? bonuses.legacy : {};
  const identityConfig = legacy && legacy.companyIdentity && typeof legacy.companyIdentity === 'object'
    ? legacy.companyIdentity
    : {};
  const carryoverConfig = legacy && legacy.carryover && typeof legacy.carryover === 'object'
    ? legacy.carryover
    : {};
  if (
    warriors.enabled !== true
    || bonuses.enabled === false
    || legacy.enabled === false
    || identityConfig.enabled === false
    || carryoverConfig.enabled === false
  ) {
    return;
  }

  const previousRuntime = ensureWarriorsRuntimeState(previousState, config);
  const nextRuntime = ensureWarriorsRuntimeState(nextState, config);
  if (!previousRuntime || !nextRuntime) {
    return;
  }
  const previousCompany = previousRuntime.company && typeof previousRuntime.company === 'object'
    ? previousRuntime.company
    : {};
  const nextCompany = nextRuntime.company && typeof nextRuntime.company === 'object'
    ? nextRuntime.company
    : {};
  const previousIdentity = previousCompany.identity && typeof previousCompany.identity === 'object'
    ? previousCompany.identity
    : {};
  const previousCycleStats = previousState && previousState.cycleStats ? previousState.cycleStats : {};
  const previousCycleCount = Math.max(0, Math.floor(Number(previousCycleStats.count || 0)));
  const nextCycleIndex = previousCycleCount + 1;

  const historyLimit = Math.max(1, Math.floor(Number(carryoverConfig.historyLimit || 1)));
  const maxHallCarry = Math.max(1, Math.floor(Number(identityConfig.maxHallOfFameCarry || 1)));
  const previousHall = Array.isArray(previousCompany.hallOfFame)
    ? previousCompany.hallOfFame
    : [];
  nextCompany.hallOfFame = previousHall
    .slice(0, maxHallCarry)
    .map((entry) => ({ ...(entry && typeof entry === 'object' ? entry : {}) }));

  const previousHistory = Array.isArray(previousCompany.cycleHistory)
    ? previousCompany.cycleHistory
    : [];
  const previousChampionId = previousRuntime && previousRuntime.league && previousRuntime.league.championId
    ? String(previousRuntime.league.championId)
    : null;
  const cycleSummary = {
    cycle: previousCycleCount,
    name: previousIdentity.name ? String(previousIdentity.name) : '',
    focus: previousIdentity.focus ? String(previousIdentity.focus) : 'balanced',
    renown: clampUnit(Number(previousIdentity.renown || 0)),
    championId: previousChampionId,
    tournaments: Math.max(
      0,
      Math.floor(Number(previousRuntime && previousRuntime.stats && previousRuntime.stats.tournaments || 0)),
    ),
    tick: Math.max(0, Math.floor(Number(previousState && previousState.tick || 0))),
  };
  nextCompany.cycleHistory = previousHistory
    .concat([cycleSummary])
    .slice(-historyLimit)
    .map((entry) => ({ ...(entry && typeof entry === 'object' ? entry : {}) }));

  const minCyclesForSeed = Math.max(0, Math.floor(Number(carryoverConfig.minCyclesForSeed || 0)));
  const cyclesBeyondFloor = Math.max(0, nextCycleIndex - minCyclesForSeed);
  const baseDecay = clampUnit(1 - Number(carryoverConfig.perCycleDecay || 0));
  const decayMultiplier = cyclesBeyondFloor > 0 ? Math.pow(baseDecay, cyclesBeyondFloor) : 1;
  const retainedRenown = nextCycleIndex >= minCyclesForSeed
    ? clampUnit(
      clampUnit(Number(previousIdentity.renown || 0))
      * clampUnit(Number(carryoverConfig.renownRetention || 0))
      * decayMultiplier,
    )
    : 0;
  const seedBonus = clampUnit(Math.min(
    Number(carryoverConfig.maxSeedBonus || 0),
    retainedRenown,
  ));

  nextCompany.carryover = {
    cycleIndex: nextCycleIndex,
    retainedRenown,
    seedBonus,
    sourceChampionId: previousChampionId,
  };

  if (seedBonus > 0) {
    const ratingScale = clampUnit(Number(carryoverConfig.startingRatingScale || 0));
    const valorScale = clampUnit(Number(carryoverConfig.startingValorScale || 0));
    const heroScale = clampUnit(Number(carryoverConfig.startingHeroPotentialScale || 0));
    const dwarves = Array.isArray(nextState && nextState.dwarves) ? nextState.dwarves : [];
    for (const dwarf of dwarves) {
      const warrior = ensureDwarfWarriorState(dwarf, config);
      if (!warrior) {
        continue;
      }
      warrior.rating = clampUnit(Number(warrior.rating || 0) + seedBonus * ratingScale);
      warrior.valor = clampUnit(Number(warrior.valor || 0) + seedBonus * valorScale);
      warrior.heroPotential = clampUnit(
        Number(warrior.heroPotential || 0) + seedBonus * heroScale,
      );
    }
  }

  const rosterSize = Math.max(1, Math.floor(Number(legacy.companyRosterSize || 1)));
  const seededRoster = (Array.isArray(nextState && nextState.dwarves) ? nextState.dwarves : [])
    .map((dwarf) => ({
      dwarf,
      warrior: ensureDwarfWarriorState(dwarf, config),
    }))
    .filter((entry) => (
      entry.warrior
      && String(entry.dwarf && entry.dwarf.lifeStage || '') === 'adult'
      && entry.warrior.retired !== true
    ))
    .sort((left, right) => {
      const leftScore = Number(left.warrior.rating || 0) * 0.5
        + Number(left.warrior.valor || 0) * 0.3
        + Number(left.warrior.heroPotential || 0) * 0.2;
      const rightScore = Number(right.warrior.rating || 0) * 0.5
        + Number(right.warrior.valor || 0) * 0.3
        + Number(right.warrior.heroPotential || 0) * 0.2;
      if (Math.abs(rightScore - leftScore) > 1e-9) {
        return rightScore - leftScore;
      }
      const leftSpawn = Math.max(0, Math.floor(Number(left.dwarf && left.dwarf.spawnIndex || 0)));
      const rightSpawn = Math.max(0, Math.floor(Number(right.dwarf && right.dwarf.spawnIndex || 0)));
      if (leftSpawn !== rightSpawn) {
        return leftSpawn - rightSpawn;
      }
      return String(left.dwarf && left.dwarf.id || '').localeCompare(String(right.dwarf && right.dwarf.id || ''));
    })
    .slice(0, rosterSize)
    .map((entry) => String(entry.dwarf && entry.dwarf.id || ''));
  nextCompany.rosterIds = seededRoster;
  refreshWarriorCompanyLegacyAura(nextState, config, warriors, nextRuntime);
  refreshWarriorCompanyIdentity(nextState, config, warriors, nextRuntime);
  return {
    applied: true,
    sourceCycle: previousCycleCount,
    targetCycle: nextCycleIndex,
    companyName: String(previousIdentity.name || ''),
    retainedRenown,
    seedBonus,
    sourceChampionId: previousChampionId,
    historyEntries: nextCompany.cycleHistory.length,
    hallOfFameEntries: nextCompany.hallOfFame.length,
    seededRosterSize: nextCompany.rosterIds.length,
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
  carryWarriorCompanyAcrossCycle,
  formatWarriorDisplayName,
  formatWarriorDisplayNameById,
  resolveWarriorLeagueEpicName,
};
