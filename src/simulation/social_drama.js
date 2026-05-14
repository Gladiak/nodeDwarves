'use strict';

const { clamp } = require('../utils');
const { pushEvent } = require('./events');

const SOCIAL_INCIDENT_TYPES = [
  'mentorship_breakthrough',
  'rivalry_clash',
  'grudge_escalation',
  'reconciliation',
];

// Resolve social-drama config safely.
function getSocialDramaConfig(config) {
  return (config && config.population && config.population.socialDrama) || {};
}

// Resolve social-governor config safely.
function getSocialGovernorConfig(config) {
  const aiConfig = (config && config.ai) || {};
  const governors = aiConfig.governors && typeof aiConfig.governors === 'object'
    ? aiConfig.governors
    : {};
  return governors.social && typeof governors.social === 'object'
    ? governors.social
    : {};
}

// Resolve long-arc social config safely.
function getSocialLongArcConfig(socialConfig) {
  return socialConfig && socialConfig.longArc && typeof socialConfig.longArc === 'object'
    ? socialConfig.longArc
    : {};
}

// Build one normalized social payload for a dwarf.
function createDwarfSocialState() {
  return {
    links: {},
    status: {
      friendIds: [],
      rivalIds: [],
      grudgeIds: [],
      mentorId: null,
      menteeIds: [],
    },
    cooldowns: {
      lastIncidentTick: 0,
      lastIncidentType: '',
      lastStatusTick: 0,
    },
    arc: {
      supportMemory: 0,
      burdenMemory: 0,
    },
  };
}

// Build the social-drama runtime container.
function createSocialDramaState(config) {
  const socialConfig = getSocialDramaConfig(config);
  if (socialConfig.enabled === false) {
    return null;
  }
  return {
    enabled: true,
    cohesion: 0,
    conflictPressure: 0,
    mentorshipCoverage: 0,
    grudgeLoad: 0,
    longArc: {
      harmony: 0,
      strife: 0,
      avgSupport: 0,
      avgBurden: 0,
    },
    governor: {
      source: 'default',
      mediationBias: 0,
      mentorshipBias: 0,
      accountabilityBias: 0,
    },
    lastUpdateTick: 0,
    lastIncidentTick: 0,
    incidentCooldownUntilTick: 0,
    pairCooldownByKey: {},
    history: [],
    stats: {
      updates: 0,
      links: 0,
      friendships: 0,
      rivalries: 0,
      mentorships: 0,
      grudges: 0,
      incidents: 0,
      incidentsByType: createIncidentTypeCounters(),
    },
  };
}

// Ensure social runtime and dwarf payloads are present and normalized.
function ensureSocialDramaState(state, config) {
  const socialConfig = getSocialDramaConfig(config);
  if (!state || socialConfig.enabled === false) {
    if (state) {
      state.social = null;
      if (Array.isArray(state.dwarves)) {
        for (const dwarf of state.dwarves) {
          if (dwarf && typeof dwarf === 'object') {
            dwarf.social = null;
          }
        }
      }
    }
    return null;
  }
  if (!state.social || typeof state.social !== 'object') {
    state.social = createSocialDramaState(config);
  }
  if (!state.social || typeof state.social !== 'object') {
    return null;
  }
  const social = state.social;
  social.enabled = true;
  social.cohesion = clamp(Number(social.cohesion || 0), 0, 1);
  social.conflictPressure = clamp(Number(social.conflictPressure || 0), 0, 1);
  social.mentorshipCoverage = clamp(Number(social.mentorshipCoverage || 0), 0, 1);
  social.grudgeLoad = clamp(Number(social.grudgeLoad || 0), 0, 1);
  social.longArc = social.longArc && typeof social.longArc === 'object'
    ? social.longArc
    : {};
  social.longArc.harmony = clamp(Number(social.longArc.harmony || 0), 0, 1);
  social.longArc.strife = clamp(Number(social.longArc.strife || 0), 0, 1);
  social.longArc.avgSupport = clamp(Number(social.longArc.avgSupport || 0), 0, 1);
  social.longArc.avgBurden = clamp(Number(social.longArc.avgBurden || 0), 0, 1);
  social.governor = normalizeSocialGovernorSnapshot(social.governor);
  social.lastUpdateTick = Math.max(0, Number(social.lastUpdateTick || 0));
  social.lastIncidentTick = Math.max(0, Number(social.lastIncidentTick || 0));
  social.incidentCooldownUntilTick = Math.max(0, Number(social.incidentCooldownUntilTick || 0));
  social.pairCooldownByKey = social.pairCooldownByKey && typeof social.pairCooldownByKey === 'object'
    ? social.pairCooldownByKey
    : {};
  social.history = Array.isArray(social.history) ? social.history : [];
  social.stats = normalizeSocialStats(social.stats);
  social.stats.incidentsByType = normalizeIncidentTypeCounters(social.stats.incidentsByType);

  const dwarves = Array.isArray(state.dwarves) ? state.dwarves : [];
  for (const dwarf of dwarves) {
    if (!dwarf || typeof dwarf !== 'object') {
      continue;
    }
    dwarf.social = normalizeDwarfSocialState(dwarf.social);
  }
  return social;
}

// Tick social-drama state and derive explicit relationship statuses.
function updateSocialDrama(state, config, action) {
  const social = ensureSocialDramaState(state, config);
  if (!social) {
    return;
  }
  const socialConfig = getSocialDramaConfig(config);
  const longArcConfig = getSocialLongArcConfig(socialConfig);
  const governorConfig = getSocialGovernorConfig(config);
  const governor = resolveSocialGovernor(action, config, governorConfig);
  social.governor = normalizeSocialGovernorSnapshot(governor);
  const tick = Math.max(0, Number(state.tick || 0));
  const tickInterval = Math.max(1, Math.floor(Number(socialConfig.tickInterval ?? 12)));
  if (social.lastUpdateTick > 0 && tick - social.lastUpdateTick < tickInterval) {
    return;
  }

  const adults = (Array.isArray(state.dwarves) ? state.dwarves : [])
    .filter((dwarf) => isAdultDwarf(dwarf, config));
  const byId = new Map(adults.map((dwarf) => [String(dwarf.id || ''), dwarf]));
  if (adults.length < 2) {
    for (const dwarf of adults) {
      const socialState = normalizeDwarfSocialState(dwarf.social);
      socialState.links = {};
      socialState.status.friendIds = [];
      socialState.status.rivalIds = [];
      socialState.status.grudgeIds = [];
      socialState.status.mentorId = null;
      socialState.status.menteeIds = [];
      socialState.cooldowns.lastStatusTick = tick;
      dwarf.social = socialState;
    }
    social.cohesion = 0;
    social.conflictPressure = 0;
    social.mentorshipCoverage = 0;
    social.grudgeLoad = 0;
    social.longArc.avgSupport = 0;
    social.longArc.avgBurden = 0;
    social.longArc.harmony = clamp(
      Number(social.longArc.harmony || 0) * (1 - clamp(Number(longArcConfig.settlementMemoryDecayPerTick ?? 0.004), 0, 1)),
      0,
      1,
    );
    social.longArc.strife = clamp(
      Number(social.longArc.strife || 0) * (1 - clamp(Number(longArcConfig.settlementMemoryDecayPerTick ?? 0.004), 0, 1)),
      0,
      1,
    );
    social.stats.links = 0;
    social.stats.friendships = 0;
    social.stats.rivalries = 0;
    social.stats.mentorships = 0;
    social.stats.grudges = 0;
    social.stats.updates = Math.max(0, Number(social.stats.updates || 0)) + 1;
    social.lastUpdateTick = tick;
    return;
  }

  const pairs = buildInteractionPairs(adults, socialConfig);
  for (const [left, right] of pairs) {
    updateSocialLinkPair(left, right, config, social, socialConfig, longArcConfig, governor, tick);
  }

  let summary = finalizeSocialStatuses(adults, byId, socialConfig, tick);
  const incidentsTriggered = updateSocialIncidents(
    state,
    config,
    social,
    adults,
    byId,
    socialConfig,
    governorConfig,
    governor,
    tick,
  );
  if (incidentsTriggered > 0) {
    summary = finalizeSocialStatuses(adults, byId, socialConfig, tick);
  }

  const adultCount = adults.length;
  const friendRatio = adultCount > 0 ? summary.friendships / adultCount : 0;
  const rivalryRatio = adultCount > 0 ? summary.rivalries / adultCount : 0;
  const mentorshipCoverage = adultCount > 0 ? summary.mentoredAdults / adultCount : 0;
  const grudgeRatio = adultCount > 0 ? summary.grudges / adultCount : 0;
  social.cohesion = clamp(friendRatio * 0.68 + mentorshipCoverage * 0.44 - rivalryRatio * 0.4 - grudgeRatio * 0.28, 0, 1);
  social.conflictPressure = clamp(rivalryRatio * 0.58 + grudgeRatio * 0.82 + (1 - social.cohesion) * 0.12, 0, 1);
  social.mentorshipCoverage = clamp(mentorshipCoverage, 0, 1);
  social.grudgeLoad = clamp(grudgeRatio, 0, 1);
  applyLongArcConsequences(adults, social, longArcConfig, tick);
  applyLongArcSettlementDrift(social, longArcConfig);
  social.cohesion = clamp(
    social.cohesion
      + social.longArc.harmony * clamp(Number(longArcConfig.cohesionBonusScale ?? 0.08), 0, 1)
      - social.longArc.strife * clamp(Number(longArcConfig.cohesionStrifePenaltyScale ?? 0.1), 0, 1),
    0,
    1,
  );
  social.conflictPressure = clamp(
    social.conflictPressure
      + social.longArc.strife * clamp(Number(longArcConfig.conflictStrifeScale ?? 0.12), 0, 1)
      - social.longArc.harmony * clamp(Number(longArcConfig.conflictHarmonyReliefScale ?? 0.08), 0, 1),
    0,
    1,
  );
  social.grudgeLoad = clamp(
    social.grudgeLoad
      + social.longArc.strife * clamp(Number(longArcConfig.grudgeStrifeScale ?? 0.08), 0, 1)
      - social.longArc.harmony * clamp(Number(longArcConfig.grudgeHarmonyReliefScale ?? 0.05), 0, 1),
    0,
    1,
  );
  social.stats.links = Math.max(0, Number(summary.links || 0));
  social.stats.friendships = Math.max(0, Number(summary.friendships || 0));
  social.stats.rivalries = Math.max(0, Number(summary.rivalries || 0));
  social.stats.mentorships = Math.max(0, Number(summary.mentorships || 0));
  social.stats.grudges = Math.max(0, Number(summary.grudges || 0));
  social.stats.updates = Math.max(0, Number(social.stats.updates || 0)) + 1;
  social.lastUpdateTick = tick;
}

// Normalize social summary stats.
function normalizeSocialStats(raw) {
  const stats = raw && typeof raw === 'object' ? raw : {};
  const incidentsByType = normalizeIncidentTypeCounters(stats.incidentsByType);
  return {
    updates: Math.max(0, Number(stats.updates || 0)),
    links: Math.max(0, Number(stats.links || 0)),
    friendships: Math.max(0, Number(stats.friendships || 0)),
    rivalries: Math.max(0, Number(stats.rivalries || 0)),
    mentorships: Math.max(0, Number(stats.mentorships || 0)),
    grudges: Math.max(0, Number(stats.grudges || 0)),
    incidents: Math.max(0, Number(stats.incidents || 0)),
    incidentsByType,
  };
}

// Normalize one dwarf social payload.
function normalizeDwarfSocialState(raw) {
  const next = raw && typeof raw === 'object' ? raw : createDwarfSocialState();
  next.links = next.links && typeof next.links === 'object' ? next.links : {};
  next.status = next.status && typeof next.status === 'object' ? next.status : {};
  next.cooldowns = next.cooldowns && typeof next.cooldowns === 'object' ? next.cooldowns : {};
  next.arc = next.arc && typeof next.arc === 'object' ? next.arc : {};
  next.status.friendIds = toIdList(next.status.friendIds);
  next.status.rivalIds = toIdList(next.status.rivalIds);
  next.status.grudgeIds = toIdList(next.status.grudgeIds);
  next.status.mentorId = next.status.mentorId ? String(next.status.mentorId) : null;
  next.status.menteeIds = toIdList(next.status.menteeIds);
  next.cooldowns.lastIncidentTick = Math.max(0, Number(next.cooldowns.lastIncidentTick || 0));
  next.cooldowns.lastIncidentType = String(next.cooldowns.lastIncidentType || '');
  next.cooldowns.lastStatusTick = Math.max(0, Number(next.cooldowns.lastStatusTick || 0));
  next.arc.supportMemory = clamp(Number(next.arc.supportMemory || 0), 0, 1);
  next.arc.burdenMemory = clamp(Number(next.arc.burdenMemory || 0), 0, 1);
  return next;
}

// Ensure one dwarf social payload exists and expose inspect-friendly summary fields.
function ensureDwarfSocialState(dwarf, state) {
  const safeDwarf = dwarf && typeof dwarf === 'object' ? dwarf : null;
  const normalized = normalizeDwarfSocialState(safeDwarf ? safeDwarf.social : null);
  if (safeDwarf) {
    safeDwarf.social = normalized;
  }
  const summary = resolveDwarfSocialSummary(normalized);
  const incidentCount = resolveDwarfIncidentCount(safeDwarf, state, normalized);
  return {
    ...normalized,
    summary,
    incidentCount,
  };
}

// Resolve one compact tie summary for inspect/UX surfaces.
function resolveDwarfSocialSummary(socialState) {
  const normalized = normalizeDwarfSocialState(socialState);
  const status = normalized.status && typeof normalized.status === 'object'
    ? normalized.status
    : {};
  const links = normalized.links && typeof normalized.links === 'object'
    ? normalized.links
    : {};
  const friend = resolveTopSocialLink(status.friendIds, links, 'affinity');
  const rival = resolveTopSocialLink(status.rivalIds, links, 'rivalry');
  const grudge = resolveTopSocialLink(status.grudgeIds, links, 'grudge');
  const mentor = resolvePrimarySocialLink(status.mentorId, links, 'mentorship');
  const protege = resolveTopSocialLink(status.menteeIds, links, 'mentorship');
  return {
    friendId: friend.id,
    friendScore: friend.score,
    rivalId: rival.id,
    rivalScore: rival.score,
    grudgeId: grudge.id,
    grudgeScore: grudge.score,
    mentorId: mentor.id,
    mentorScore: mentor.score,
    protegeId: protege.id,
    protegeScore: protege.score,
  };
}

// Resolve one top-scoring social target for a metric from a candidate id list.
function resolveTopSocialLink(idsRaw, links, metric) {
  const ids = toIdList(idsRaw);
  let bestId = null;
  let bestScore = 0;
  for (const id of ids) {
    const resolved = resolvePrimarySocialLink(id, links, metric);
    if (!resolved.id) {
      continue;
    }
    const score = clamp(Number(resolved.score || 0), 0, 1);
    if (score > bestScore || (score === bestScore && bestId && String(resolved.id) < String(bestId))) {
      bestId = resolved.id;
      bestScore = score;
    }
  }
  return {
    id: bestId,
    score: bestScore,
  };
}

// Resolve one specific social target id and metric score.
function resolvePrimarySocialLink(idRaw, links, metric) {
  const id = idRaw ? String(idRaw) : '';
  if (!id) {
    return { id: null, score: 0 };
  }
  const sourceLinks = links && typeof links === 'object' ? links : {};
  const link = sourceLinks[id];
  if (!link || typeof link !== 'object') {
    return { id, score: 0 };
  }
  return {
    id,
    score: clamp(Number(link[metric] || 0), 0, 1),
  };
}

// Resolve incident count for one dwarf from social history when available.
function resolveDwarfIncidentCount(dwarf, state, normalizedSocial) {
  const id = dwarf && dwarf.id ? String(dwarf.id) : '';
  if (!id) {
    return 0;
  }
  const history = state && state.social && Array.isArray(state.social.history)
    ? state.social.history
    : null;
  if (history && history.length > 0) {
    let count = 0;
    for (const entry of history) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      if (String(entry.leftId || '') === id || String(entry.rightId || '') === id) {
        count += 1;
      }
    }
    return count;
  }
  const cooldowns = normalizedSocial && normalizedSocial.cooldowns && typeof normalizedSocial.cooldowns === 'object'
    ? normalizedSocial.cooldowns
    : {};
  return Number(cooldowns.lastIncidentTick || 0) > 0 ? 1 : 0;
}

// Build deterministic-sized pair samples without O(n^2) scans.
function buildInteractionPairs(adults, socialConfig) {
  const pairs = [];
  const pairIds = new Set();
  const byId = new Map(adults.map((dwarf) => [String(dwarf && dwarf.id || ''), dwarf]));
  const maxSamples = Math.max(0, Math.floor(Number(socialConfig.pairSamplesPerUpdate ?? 24)));
  const includePartners = socialConfig.includeBondedPairs !== false;
  const carryoverPairsPerDwarf = Math.max(0, Math.floor(Number(socialConfig.carryoverPairsPerDwarf ?? 1)));

  if (includePartners) {
    for (const dwarf of adults) {
      const leftId = String(dwarf && dwarf.id || '');
      const partnerId = dwarf && dwarf.partnerId ? String(dwarf.partnerId) : null;
      if (!leftId || !partnerId || leftId >= partnerId) {
        continue;
      }
      const partner = byId.get(partnerId);
      if (!partner) {
        continue;
      }
      const key = `${leftId}|${partnerId}`;
      if (pairIds.has(key)) {
        continue;
      }
      pairIds.add(key);
      pairs.push([dwarf, partner]);
    }
  }

  if (maxSamples <= 0 || adults.length < 2) {
    return pairs;
  }
  if (carryoverPairsPerDwarf > 0) {
    for (const dwarf of adults) {
      const dwarfId = String(dwarf && dwarf.id || '');
      if (!dwarfId || !dwarf.social || typeof dwarf.social !== 'object') {
        continue;
      }
      const candidateLinks = Object.entries(dwarf.social.links || {})
        .map(([peerId, link]) => ({
          peerId: String(peerId || ''),
          score: resolveLinkStrength(link),
        }))
        .filter((entry) => entry.peerId && entry.peerId !== dwarfId && entry.score > 0)
        .sort((left, right) => right.score - left.score || left.peerId.localeCompare(right.peerId))
        .slice(0, carryoverPairsPerDwarf);
      for (const entry of candidateLinks) {
        const leftId = dwarfId < entry.peerId ? dwarfId : entry.peerId;
        const rightId = dwarfId < entry.peerId ? entry.peerId : dwarfId;
        const key = `${leftId}|${rightId}`;
        if (pairIds.has(key)) {
          continue;
        }
        const peer = byId.get(entry.peerId);
        if (!peer) {
          continue;
        }
        pairIds.add(key);
        pairs.push([dwarf, peer]);
      }
    }
  }
  const target = maxSamples;
  const maxAttempts = Math.max(target * 6, 20);
  let attempts = 0;
  while (pairs.length < target && attempts < maxAttempts) {
    attempts += 1;
    const left = adults[Math.floor(Math.random() * adults.length)];
    const right = adults[Math.floor(Math.random() * adults.length)];
    if (!left || !right || left === right) {
      continue;
    }
    const leftId = String(left.id || '');
    const rightId = String(right.id || '');
    if (!leftId || !rightId) {
      continue;
    }
    const key = leftId < rightId ? `${leftId}|${rightId}` : `${rightId}|${leftId}`;
    if (pairIds.has(key)) {
      continue;
    }
    pairIds.add(key);
    pairs.push([left, right]);
  }
  return pairs;
}

// Update one social link pair from current mood, bond, and profile distance.
function updateSocialLinkPair(left, right, config, social, socialConfig, longArcConfig, governor, tick) {
  if (!left || !right) {
    return;
  }
  const leftSocial = normalizeDwarfSocialState(left.social);
  const rightSocial = normalizeDwarfSocialState(right.social);
  left.social = leftSocial;
  right.social = rightSocial;
  const leftId = String(left.id || '');
  const rightId = String(right.id || '');
  if (!leftId || !rightId || leftId === rightId) {
    return;
  }

  const leftLink = ensureSocialLink(leftSocial, rightId, tick);
  const rightLink = ensureSocialLink(rightSocial, leftId, tick);
  const relationships = (config && config.population && config.population.relationships) || {};
  const bondRatio = resolvePairBondRatio(left, right, relationships);
  const sameClan = left.clanId && right.clanId && left.clanId === right.clanId;
  const leftMood = left.state && typeof left.state === 'object' ? left.state : {};
  const rightMood = right.state && typeof right.state === 'object' ? right.state : {};
  const avgStress = clamp((Number(leftMood.stress || 0) + Number(rightMood.stress || 0)) / 2, 0, 1);
  const avgMorale = clamp((Number(leftMood.morale || 0) + Number(rightMood.morale || 0)) / 2, 0, 1);
  const lowMorale = 1 - avgMorale;
  const ageGap = Math.abs(Number(left.ageTicks || 0) - Number(right.ageTicks || 0));
  const leftSkill = resolveSocialSkillScore(left);
  const rightSkill = resolveSocialSkillScore(right);
  const skillGap = Math.abs(leftSkill - rightSkill);

  const affinityGain =
    Math.max(0, Number(socialConfig.affinityGainBase ?? 0.02))
    + bondRatio * Math.max(0, Number(socialConfig.affinityBondScale ?? 0.08))
    + (sameClan ? Math.max(0, Number(socialConfig.affinitySameClanBonus ?? 0.02)) : 0);
  const rivalryGain = Math.max(
    0,
    Math.max(0, Number(socialConfig.rivalryBaseGain ?? 0.002))
      + avgStress * Math.max(0, Number(socialConfig.rivalryStressScale ?? 0.06))
      + lowMorale * Math.max(0, Number(socialConfig.rivalryLowMoraleScale ?? 0.05))
      - bondRatio * Math.max(0, Number(socialConfig.rivalryBondShieldScale ?? 0.07)),
  );
  const mentorshipAgeGapMin = Math.max(0, Number(socialConfig.mentorshipAgeGapMin ?? 220));
  const mentorshipSkillGapMin = clamp(Number(socialConfig.mentorshipSkillGapMin ?? 0.18), 0, 1);
  const mentorshipEligible = bondRatio > 0.05
    && (ageGap >= mentorshipAgeGapMin || skillGap >= mentorshipSkillGapMin);
  const mentorshipGain = mentorshipEligible
    ? Math.max(0, Number(socialConfig.mentorshipBaseGain ?? 0.002))
      + bondRatio * Math.max(0, Number(socialConfig.mentorshipBondScale ?? 0.05))
      + clamp(skillGap, 0, 1) * Math.max(0, Number(socialConfig.mentorshipSkillScale ?? 0.04))
    : 0;
  const rivalryThreshold = clamp(Number(socialConfig.rivalryThreshold ?? 0.55), 0, 1);
  const grudgeStressThreshold = clamp(Number(socialConfig.grudgeStressThreshold ?? 0.72), 0, 1);
  const grudgeGain = Math.max(
    0,
    avgStress >= grudgeStressThreshold
      && (leftLink.rivalry >= rivalryThreshold || rightLink.rivalry >= rivalryThreshold)
      ? Math.max(0, Number(socialConfig.grudgeStressScale ?? 0.045))
        * clamp(avgStress - grudgeStressThreshold + 0.12, 0, 1)
      : 0,
  ) + Math.max(0, Number(socialConfig.grudgeRivalryScale ?? 0.006))
      * clamp((Number(leftLink.rivalry || 0) + Number(rightLink.rivalry || 0)) / 2, 0, 1);

  const harmony = clamp(Number(social && social.longArc && social.longArc.harmony || 0), 0, 1);
  const strife = clamp(Number(social && social.longArc && social.longArc.strife || 0), 0, 1);
  const governance = normalizeSocialGovernorSnapshot(governor);
  const affinityScale = clamp(
    1
      + harmony * clamp(Number(longArcConfig.affinityHarmonyScale ?? 0.2), 0, 2)
      - strife * clamp(Number(longArcConfig.affinityStrifePenaltyScale ?? 0.24), 0, 2),
    0.2,
    2.5,
  );
  const rivalryScale = clamp(
    1
      + strife * clamp(Number(longArcConfig.rivalryStrifeScale ?? 0.22), 0, 2)
      - harmony * clamp(Number(longArcConfig.rivalryHarmonyReliefScale ?? 0.14), 0, 2)
      - governance.mediationBias * clamp(Number(governance.mediationRivalryReductionScale ?? 0.55), 0, 1.5)
      - governance.accountabilityBias * clamp(Number(governance.accountabilityRivalryReductionScale ?? 0.3), 0, 1.5),
    0.15,
    2.8,
  );
  const mentorshipScale = clamp(
    1
      + harmony * clamp(Number(longArcConfig.mentorshipHarmonyScale ?? 0.2), 0, 2)
      + governance.mentorshipBias * clamp(Number(governance.mentorshipGainScale ?? 0.5), 0, 1.5),
    0.2,
    2.8,
  );
  const grudgeScale = clamp(
    1
      + strife * clamp(Number(longArcConfig.grudgeStrifeScale ?? 0.24), 0, 2)
      - harmony * clamp(Number(longArcConfig.grudgeHarmonyReliefScale ?? 0.16), 0, 2)
      - governance.mediationBias * clamp(Number(governance.mediationGrudgeReductionScale ?? 0.65), 0, 1.5)
      - governance.accountabilityBias * clamp(Number(governance.accountabilityGrudgeReductionScale ?? 0.48), 0, 1.5),
    0.15,
    2.9,
  );

  const affinityDecay = Math.max(0, Number(socialConfig.affinityDecayPerTick ?? 0.0015));
  const rivalryDecay = Math.max(0, Number(socialConfig.rivalryDecayPerTick ?? 0.0025));
  const mentorshipDecay = Math.max(0, Number(socialConfig.mentorshipDecayPerTick ?? 0.0018));
  const grudgeDecay = Math.max(0, Number(socialConfig.grudgeDecayPerTick ?? 0.0012));
  applyLinkDelta(
    leftLink,
    affinityGain * affinityScale,
    rivalryGain * rivalryScale,
    mentorshipGain * mentorshipScale,
    grudgeGain * grudgeScale,
    affinityDecay,
    rivalryDecay,
    mentorshipDecay,
    grudgeDecay,
    tick,
  );
  applyLinkDelta(
    rightLink,
    affinityGain * affinityScale,
    rivalryGain * rivalryScale,
    mentorshipGain * mentorshipScale,
    grudgeGain * grudgeScale,
    affinityDecay,
    rivalryDecay,
    mentorshipDecay,
    grudgeDecay,
    tick,
  );
}

// Ensure one normalized link entry exists for a peer.
function ensureSocialLink(socialState, peerId, tick) {
  const key = String(peerId || '');
  if (!key) {
    return null;
  }
  if (!socialState.links[key] || typeof socialState.links[key] !== 'object') {
    socialState.links[key] = {
      affinity: 0,
      rivalry: 0,
      mentorship: 0,
      grudge: 0,
      lastTick: tick,
    };
  }
  const link = socialState.links[key];
  link.affinity = clamp(Number(link.affinity || 0), 0, 1);
  link.rivalry = clamp(Number(link.rivalry || 0), 0, 1);
  link.mentorship = clamp(Number(link.mentorship || 0), 0, 1);
  link.grudge = clamp(Number(link.grudge || 0), 0, 1);
  link.lastTick = Math.max(0, Number(link.lastTick || 0));
  return link;
}

// Apply bounded social deltas on one link.
function applyLinkDelta(link, affinityGain, rivalryGain, mentorshipGain, grudgeGain, affinityDecay, rivalryDecay, mentorshipDecay, grudgeDecay, tick) {
  if (!link) {
    return;
  }
  link.affinity = clamp(link.affinity + affinityGain - affinityDecay, 0, 1);
  link.rivalry = clamp(link.rivalry + rivalryGain - rivalryDecay, 0, 1);
  link.mentorship = clamp(link.mentorship + mentorshipGain - mentorshipDecay, 0, 1);
  link.grudge = clamp(link.grudge + grudgeGain - grudgeDecay, 0, 1);
  link.lastTick = Math.max(0, Number(tick || 0));
}

// Finalize status arrays and aggregate summary counters.
function finalizeSocialStatuses(adults, byId, socialConfig, tick) {
  const maxLinks = Math.max(1, Math.floor(Number(socialConfig.maxTrackedLinksPerDwarf ?? 6)));
  const staleDecay = Math.max(0, Number(socialConfig.staleDecayPerTick ?? 0.001));
  const friendshipThreshold = clamp(Number(socialConfig.friendshipThreshold ?? 0.58), 0, 1);
  const rivalryThreshold = clamp(Number(socialConfig.rivalryThreshold ?? 0.55), 0, 1);
  const mentorshipThreshold = clamp(Number(socialConfig.mentorshipThreshold ?? 0.5), 0, 1);
  const grudgeThreshold = clamp(Number(socialConfig.grudgeThreshold ?? 0.42), 0, 1);
  const mentorshipAgeGapMin = Math.max(0, Number(socialConfig.mentorshipAgeGapMin ?? 220));
  const mentorshipSkillGapMin = clamp(Number(socialConfig.mentorshipSkillGapMin ?? 0.18), 0, 1);
  const scoreEps = Math.max(0.0001, Number(socialConfig.linkEpsilon ?? 0.01));
  const summary = {
    links: 0,
    friendships: 0,
    rivalries: 0,
    mentorships: 0,
    grudges: 0,
    mentoredAdults: 0,
  };

  for (const dwarf of adults) {
    const socialState = normalizeDwarfSocialState(dwarf.social);
    dwarf.social = socialState;
    const entries = [];
    for (const [peerId] of Object.entries(socialState.links)) {
      const peer = byId.get(String(peerId || ''));
      if (!peer) {
        continue;
      }
      const link = ensureSocialLink(socialState, peerId, tick);
      if (!link) {
        continue;
      }
      const idleTicks = Math.max(0, tick - Number(link.lastTick || tick));
      if (idleTicks > 0) {
        const idleDecay = staleDecay * idleTicks;
        link.affinity = clamp(link.affinity - idleDecay, 0, 1);
        link.rivalry = clamp(link.rivalry - idleDecay, 0, 1);
        link.mentorship = clamp(link.mentorship - idleDecay, 0, 1);
        link.grudge = clamp(link.grudge - idleDecay, 0, 1);
      }
      const strength = resolveLinkStrength(link);
      if (strength < scoreEps) {
        continue;
      }
      entries.push({
        peerId: String(peerId),
        peer,
        link,
        strength,
      });
    }

    entries.sort((left, right) => right.strength - left.strength || left.peerId.localeCompare(right.peerId));
    const kept = entries.slice(0, maxLinks);
    const keptIds = new Set(kept.map((entry) => entry.peerId));
    for (const peerId of Object.keys(socialState.links)) {
      if (!keptIds.has(peerId)) {
        delete socialState.links[peerId];
      }
    }

    const friendIds = [];
    const rivalIds = [];
    const grudgeIds = [];
    let mentorId = null;
    let mentorScore = -1;
    const menteeIds = [];
    const selfAge = Number(dwarf.ageTicks || 0);
    const selfSkill = resolveSocialSkillScore(dwarf);

    for (const entry of kept) {
      const link = entry.link;
      const peerId = entry.peerId;
      if (link.affinity >= friendshipThreshold && link.rivalry < rivalryThreshold) {
        friendIds.push(peerId);
      }
      if (link.rivalry >= rivalryThreshold) {
        rivalIds.push(peerId);
      }
      if (link.grudge >= grudgeThreshold) {
        grudgeIds.push(peerId);
      }
      if (link.mentorship >= mentorshipThreshold) {
        const peerAge = Number(entry.peer.ageTicks || 0);
        const peerSkill = resolveSocialSkillScore(entry.peer);
        const ageGap = peerAge - selfAge;
        const skillGap = peerSkill - selfSkill;
        if (ageGap >= mentorshipAgeGapMin && skillGap >= mentorshipSkillGapMin && link.mentorship > mentorScore) {
          mentorScore = link.mentorship;
          mentorId = peerId;
        }
        if (ageGap <= -mentorshipAgeGapMin && skillGap <= -mentorshipSkillGapMin) {
          menteeIds.push(peerId);
        }
      }
    }

    socialState.status.friendIds = friendIds.slice(0, maxLinks);
    socialState.status.rivalIds = rivalIds.slice(0, maxLinks);
    socialState.status.grudgeIds = grudgeIds.slice(0, maxLinks);
    socialState.status.mentorId = mentorId;
    socialState.status.menteeIds = menteeIds.slice(0, maxLinks);
    socialState.cooldowns.lastStatusTick = tick;

    summary.links += kept.length;
    summary.friendships += socialState.status.friendIds.length;
    summary.rivalries += socialState.status.rivalIds.length;
    summary.grudges += socialState.status.grudgeIds.length;
    summary.mentorships += (socialState.status.mentorId ? 1 : 0) + socialState.status.menteeIds.length;
    if (socialState.status.mentorId) {
      summary.mentoredAdults += 1;
    }
  }

  return {
    links: Math.floor(summary.links / 2),
    friendships: Math.floor(summary.friendships / 2),
    rivalries: Math.floor(summary.rivalries / 2),
    mentorships: Math.floor(summary.mentorships / 2),
    grudges: Math.floor(summary.grudges / 2),
    mentoredAdults: summary.mentoredAdults,
  };
}

// Run bounded social incidents with global/per-pair cooldown guardrails.
function updateSocialIncidents(state, config, social, adults, byId, socialConfig, governorConfig, governor, tick) {
  const incidentConfig = getSocialIncidentConfig(socialConfig);
  if (incidentConfig.enabled === false || adults.length < 2) {
    return 0;
  }
  if (tick < Math.max(0, Number(social.incidentCooldownUntilTick || 0))) {
    return 0;
  }
  const intervalTicks = Math.max(1, Math.floor(Number(incidentConfig.intervalTicks ?? 24)));
  if (social.lastIncidentTick > 0 && tick - social.lastIncidentTick < intervalTicks) {
    return 0;
  }

  const retentionTicks = Math.max(0, Math.floor(Number(incidentConfig.pairCooldownRetentionTicks ?? 480)));
  prunePairCooldowns(social.pairCooldownByKey, tick, retentionTicks);
  const maxPerUpdate = Math.max(1, Math.floor(Number(incidentConfig.maxPerUpdate ?? 1)));
  const governance = normalizeSocialGovernorSnapshot(governor, governorConfig);
  const accountabilityChanceScale = clamp(Number(governance.accountabilityIncidentChanceScale ?? 0.32), 0, 1.5);
  const mediationChanceScale = clamp(Number(governance.mediationIncidentChanceScale ?? 0.12), 0, 1.5);
  let triggered = 0;

  for (let i = 0; i < maxPerUpdate; i += 1) {
    const baseChance = clamp(Number(incidentConfig.baseChancePerRoll ?? 0.45), 0, 1);
    const chanceMultiplier = clamp(
      1
        - governance.accountabilityBias * accountabilityChanceScale
        - governance.mediationBias * mediationChanceScale,
      0.2,
      1.8,
    );
    const incidentChance = clamp(baseChance * chanceMultiplier, 0, 1);
    if (Math.random() > incidentChance) {
      break;
    }
    const candidates = buildIncidentCandidates(adults, byId, social, socialConfig, incidentConfig, tick);
    const selection = selectIncidentCandidate(candidates, incidentConfig, governance);
    if (!selection) {
      break;
    }
    const applied = applyIncidentSelection(selection, state, config, social, socialConfig, incidentConfig, tick);
    if (!applied) {
      break;
    }
    triggered += 1;
  }

  if (triggered > 0) {
    social.lastIncidentTick = tick;
    const globalCooldownTicks = Math.max(0, Math.floor(Number(incidentConfig.globalCooldownTicks ?? 18)));
    social.incidentCooldownUntilTick = tick + globalCooldownTicks;
  }
  return triggered;
}

// Resolve social incidents config with safe defaults.
function getSocialIncidentConfig(socialConfig) {
  return socialConfig && socialConfig.incidents && typeof socialConfig.incidents === 'object'
    ? socialConfig.incidents
    : {};
}

// Build candidate buckets for each incident type.
function buildIncidentCandidates(adults, byId, social, socialConfig, incidentConfig, tick) {
  const buckets = {};
  for (const type of SOCIAL_INCIDENT_TYPES) {
    buckets[type] = [];
  }
  const seenPairs = new Set();
  const rivalryThreshold = clamp(Number(socialConfig.rivalryThreshold ?? 0.55), 0, 1);
  const grudgeThreshold = clamp(Number(socialConfig.grudgeThreshold ?? 0.42), 0, 1);
  const mentorshipThreshold = clamp(Number(socialConfig.mentorshipThreshold ?? 0.5), 0, 1);
  const rivalryIncidentThreshold = Math.max(0.08, rivalryThreshold * 0.4);
  const grudgeIncidentThreshold = Math.max(0.025, grudgeThreshold * 0.2);
  const mentorshipIncidentThreshold = Math.max(0.1, mentorshipThreshold * 0.5);
  const reconciliationAffinityMin = clamp(Number(incidentConfig.reconciliationAffinityMin ?? 0.34), 0, 1);
  const perPairCooldownTicks = Math.max(0, Math.floor(Number(incidentConfig.perPairCooldownTicks ?? 120)));

  for (const left of adults) {
    const leftId = String(left && left.id || '');
    if (!leftId || !left.social || typeof left.social !== 'object') {
      continue;
    }
    for (const [peerId] of Object.entries(left.social.links || {})) {
      const rightId = String(peerId || '');
      if (!rightId || leftId >= rightId) {
        continue;
      }
      const right = byId.get(rightId);
      if (!right || !right.social || typeof right.social !== 'object') {
        continue;
      }
      const pairKey = `${leftId}|${rightId}`;
      if (seenPairs.has(pairKey)) {
        continue;
      }
      seenPairs.add(pairKey);
      const cooldownTick = Math.max(0, Number(social.pairCooldownByKey[pairKey] || 0));
      if (perPairCooldownTicks > 0 && cooldownTick > 0 && tick - cooldownTick < perPairCooldownTicks) {
        continue;
      }

      const leftLink = ensureSocialLink(left.social, rightId, tick);
      const rightLink = ensureSocialLink(right.social, leftId, tick);
      if (!leftLink || !rightLink) {
        continue;
      }
      const metrics = computePairIncidentMetrics(left, right, leftLink, rightLink, socialConfig);
      const entry = {
        left,
        right,
        leftLink,
        rightLink,
        pairKey,
        metrics,
      };

      if (metrics.mentorship >= mentorshipIncidentThreshold || metrics.hasMentorTie) {
        buckets.mentorship_breakthrough.push({
          ...entry,
          score: clamp(metrics.mentorship + metrics.affinity * 0.42 + metrics.skillGap * 0.38, 0.0001, 1.5),
        });
      }
      if (metrics.rivalry >= rivalryIncidentThreshold) {
        buckets.rivalry_clash.push({
          ...entry,
          score: clamp(metrics.rivalry + metrics.stress * 0.45 + metrics.grudge * 0.22, 0.0001, 1.5),
        });
      }
      if (metrics.grudge >= grudgeIncidentThreshold) {
        buckets.grudge_escalation.push({
          ...entry,
          score: clamp(metrics.grudge + metrics.stress * 0.35 + metrics.rivalry * 0.26, 0.0001, 1.5),
        });
      }
      if ((metrics.rivalry > 0.18 || metrics.grudge > 0.14) && metrics.affinity >= reconciliationAffinityMin) {
        buckets.reconciliation.push({
          ...entry,
          score: clamp(metrics.affinity + (1 - metrics.rivalry) * 0.35 + (1 - metrics.grudge) * 0.2, 0.0001, 1.5),
        });
      }
    }
  }
  return buckets;
}

// Compute one compact pair metric bundle for incident scoring.
function computePairIncidentMetrics(left, right, leftLink, rightLink, socialConfig) {
  const affinity = clamp((Number(leftLink.affinity || 0) + Number(rightLink.affinity || 0)) / 2, 0, 1);
  const rivalry = clamp((Number(leftLink.rivalry || 0) + Number(rightLink.rivalry || 0)) / 2, 0, 1);
  const mentorship = clamp((Number(leftLink.mentorship || 0) + Number(rightLink.mentorship || 0)) / 2, 0, 1);
  const grudge = clamp((Number(leftLink.grudge || 0) + Number(rightLink.grudge || 0)) / 2, 0, 1);
  const leftMood = left && left.state && typeof left.state === 'object' ? left.state : {};
  const rightMood = right && right.state && typeof right.state === 'object' ? right.state : {};
  const stress = clamp((Number(leftMood.stress || 0) + Number(rightMood.stress || 0)) / 2, 0, 1);
  const skillGap = clamp(
    Math.abs(resolveSocialSkillScore(left) - resolveSocialSkillScore(right)),
    0,
    1,
  );
  const mentorshipAgeGapMin = Math.max(0, Number(socialConfig.mentorshipAgeGapMin ?? 220));
  const ageGap = Math.abs(Number(left && left.ageTicks || 0) - Number(right && right.ageTicks || 0));
  const leftStatus = left && left.social && left.social.status && typeof left.social.status === 'object'
    ? left.social.status
    : {};
  const rightStatus = right && right.social && right.social.status && typeof right.social.status === 'object'
    ? right.social.status
    : {};
  const leftId = String(left && left.id || '');
  const rightId = String(right && right.id || '');
  const hasMentorTie = String(leftStatus.mentorId || '') === rightId || String(rightStatus.mentorId || '') === leftId;
  const mentorshipAgeGate = ageGap >= mentorshipAgeGapMin;
  return {
    affinity,
    rivalry,
    mentorship: mentorshipAgeGate ? mentorship : mentorship * 0.4,
    grudge,
    stress,
    skillGap,
    hasMentorTie,
  };
}

// Select one incident type and one pair candidate using weighted random scores.
function selectIncidentCandidate(candidates, incidentConfig, governor) {
  const weights = incidentConfig.weights && typeof incidentConfig.weights === 'object'
    ? incidentConfig.weights
    : {};
  const governance = normalizeSocialGovernorSnapshot(governor);
  const typePool = [];
  for (const type of SOCIAL_INCIDENT_TYPES) {
    const entries = Array.isArray(candidates[type]) ? candidates[type] : [];
    if (entries.length === 0) {
      continue;
    }
    const baseWeight = Math.max(0, Number(weights[type] ?? 1));
    const governorScale = resolveIncidentTypeGovernorWeightScale(type, governance);
    const weight = Math.max(0, baseWeight * governorScale);
    if (weight <= 0) {
      continue;
    }
    const scoreSum = entries.reduce((sum, entry) => sum + Math.max(0.0001, Number(entry.score || 0.0001)), 0);
    if (scoreSum <= 0) {
      continue;
    }
    typePool.push({
      type,
      entries,
      score: scoreSum * weight,
    });
  }
  if (typePool.length === 0) {
    return null;
  }

  const selectedType = pickWeighted(typePool, (entry) => entry.score);
  if (!selectedType) {
    return null;
  }
  const selectedPair = pickWeighted(selectedType.entries, (entry) => Math.max(0.0001, Number(entry.score || 0.0001)));
  if (!selectedPair) {
    return null;
  }
  return {
    type: selectedType.type,
    pair: selectedPair,
  };
}

// Resolve governor weight scaling for one incident type.
function resolveIncidentTypeGovernorWeightScale(type, governor) {
  const safeType = String(type || '');
  const mediation = clamp(Number(governor && governor.mediationBias || 0), -1, 1);
  const mentorship = clamp(Number(governor && governor.mentorshipBias || 0), -1, 1);
  const accountability = clamp(Number(governor && governor.accountabilityBias || 0), -1, 1);
  const mentorshipWeightScale = clamp(Number((governor && governor.mentorshipIncidentWeightScale) ?? 0.65), 0, 2);
  const reconciliationWeightScale = clamp(Number((governor && governor.mediationReconciliationWeightScale) ?? 0.75), 0, 2);
  const rivalryReductionScale = clamp(Number((governor && governor.mediationRivalryReductionScale) ?? 0.55), 0, 2);
  const escalationReductionScale = clamp(Number((governor && governor.accountabilityEscalationWeightReductionScale) ?? 0.6), 0, 2);

  if (safeType === 'mentorship_breakthrough') {
    return clamp(
      1 + mentorship * mentorshipWeightScale + mediation * 0.1,
      0.1,
      3.2,
    );
  }
  if (safeType === 'reconciliation') {
    return clamp(
      1 + mediation * reconciliationWeightScale + accountability * 0.18,
      0.1,
      3.2,
    );
  }
  if (safeType === 'rivalry_clash') {
    return clamp(
      1 - mediation * rivalryReductionScale - accountability * 0.25,
      0.08,
      3.4,
    );
  }
  if (safeType === 'grudge_escalation') {
    return clamp(
      1 - mediation * (rivalryReductionScale + 0.08) - accountability * escalationReductionScale,
      0.05,
      3.8,
    );
  }
  return 1;
}

// Apply one selected incident and persist cooldown/history/stats.
function applyIncidentSelection(selection, state, config, social, socialConfig, incidentConfig, tick) {
  if (!selection || !selection.pair) {
    return false;
  }
  const type = String(selection.type || '');
  const pair = selection.pair;
  const left = pair.left;
  const right = pair.right;
  const leftId = String(left && left.id || '');
  const rightId = String(right && right.id || '');
  if (!left || !right || !leftId || !rightId || leftId === rightId) {
    return false;
  }
  const effects = resolveIncidentEffects(incidentConfig, type);
  if (!effects) {
    return false;
  }

  let eventMessage = '';
  if (type === 'mentorship_breakthrough') {
    eventMessage = applyMentorshipBreakthrough(pair, effects, socialConfig);
  } else if (type === 'rivalry_clash') {
    eventMessage = applyRivalryClash(pair, effects);
  } else if (type === 'grudge_escalation') {
    eventMessage = applyGrudgeEscalation(pair, effects);
  } else if (type === 'reconciliation') {
    eventMessage = applyReconciliation(pair, effects);
  } else {
    return false;
  }
  if (!eventMessage) {
    return false;
  }

  const pairKey = pair.pairKey || (leftId < rightId ? `${leftId}|${rightId}` : `${rightId}|${leftId}`);
  social.pairCooldownByKey[pairKey] = tick;
  social.stats.incidents = Math.max(0, Number(social.stats.incidents || 0)) + 1;
  if (!social.stats.incidentsByType || typeof social.stats.incidentsByType !== 'object') {
    social.stats.incidentsByType = createIncidentTypeCounters();
  }
  social.stats.incidentsByType[type] = Math.max(0, Number(social.stats.incidentsByType[type] || 0)) + 1;
  social.history.push({
    tick,
    type,
    leftId,
    rightId,
    pairKey,
  });
  const historyLimit = Math.max(1, Math.floor(Number(incidentConfig.historyLimit ?? 48)));
  social.history = social.history.slice(-historyLimit);
  social.lastIncidentTick = tick;
  const leftSocial = left && left.social && typeof left.social === 'object' ? normalizeDwarfSocialState(left.social) : null;
  const rightSocial = right && right.social && typeof right.social === 'object' ? normalizeDwarfSocialState(right.social) : null;
  if (leftSocial) {
    leftSocial.cooldowns.lastIncidentTick = tick;
    leftSocial.cooldowns.lastIncidentType = type;
    left.social = leftSocial;
  }
  if (rightSocial) {
    rightSocial.cooldowns.lastIncidentTick = tick;
    rightSocial.cooldowns.lastIncidentType = type;
    right.social = rightSocial;
  }
  if (state && Array.isArray(state.events)) {
    pushEvent(state, config, eventMessage);
  }
  return true;
}

// Resolve per-type effects payload with fallback defaults.
function resolveIncidentEffects(incidentConfig, type) {
  const effectsRoot = incidentConfig.effects && typeof incidentConfig.effects === 'object'
    ? incidentConfig.effects
    : {};
  const raw = effectsRoot[type];
  return raw && typeof raw === 'object' ? raw : null;
}

// Apply mentorship breakthrough bonuses and tension relief.
function applyMentorshipBreakthrough(pair, effects, socialConfig) {
  const mentor = resolveMentorForPair(pair);
  const mentee = mentor === pair.left ? pair.right : pair.left;
  const mentorMoraleDelta = Number(effects.mentorMoraleDelta ?? 0.007);
  const menteeMoraleDelta = Number(effects.menteeMoraleDelta ?? 0.012);
  const stressDelta = Number(effects.stressDelta ?? -0.018);
  const fatigueDelta = Number(effects.fatigueDelta ?? -0.01);
  applyMoodDelta(mentor, mentorMoraleDelta, stressDelta, fatigueDelta);
  applyMoodDelta(mentee, menteeMoraleDelta, stressDelta, fatigueDelta);
  applyWarriorDelta(mentee, effects);
  applyLinkPairDelta(pair, {
    affinity: Number(effects.affinityGain ?? 0.06),
    mentorship: Number(effects.mentorshipGain ?? 0.05),
    rivalry: -Math.abs(Number(effects.rivalryRelief ?? 0.03)),
    grudge: -Math.abs(Number(effects.grudgeRelief ?? 0.02)),
  });
  const mentorId = String(mentor && mentor.id || '');
  const menteeId = String(mentee && mentee.id || '');
  return `Social incident: mentorship breakthrough (${mentorId} guided ${menteeId})`;
}

// Apply rivalry-clash penalties and tension growth.
function applyRivalryClash(pair, effects) {
  const moraleDelta = Number(effects.moraleDelta ?? -0.015);
  const stressDelta = Number(effects.stressDelta ?? 0.02);
  const fatigueDelta = Number(effects.fatigueDelta ?? 0.014);
  applyMoodDelta(pair.left, moraleDelta, stressDelta, fatigueDelta);
  applyMoodDelta(pair.right, moraleDelta, stressDelta, fatigueDelta);
  applyLinkPairDelta(pair, {
    affinity: -Math.abs(Number(effects.affinityLoss ?? 0.04)),
    rivalry: Number(effects.rivalryGain ?? 0.07),
    grudge: Number(effects.grudgeGain ?? 0.03),
  });
  return `Social incident: rivalry clash between ${pair.left.id} and ${pair.right.id}`;
}

// Apply grudge-escalation penalties and hostility growth.
function applyGrudgeEscalation(pair, effects) {
  const moraleDelta = Number(effects.moraleDelta ?? -0.02);
  const stressDelta = Number(effects.stressDelta ?? 0.026);
  applyMoodDelta(pair.left, moraleDelta, stressDelta, 0);
  applyMoodDelta(pair.right, moraleDelta, stressDelta, 0);
  applyLinkPairDelta(pair, {
    affinity: -Math.abs(Number(effects.affinityLoss ?? 0.03)),
    rivalry: Number(effects.rivalryGain ?? 0.05),
    grudge: Number(effects.grudgeGain ?? 0.08),
  });
  return `Social incident: grudge escalation between ${pair.left.id} and ${pair.right.id}`;
}

// Apply reconciliation relief and hostility reduction.
function applyReconciliation(pair, effects) {
  const moraleDelta = Number(effects.moraleDelta ?? 0.014);
  const stressDelta = Number(effects.stressDelta ?? -0.02);
  applyMoodDelta(pair.left, moraleDelta, stressDelta, 0);
  applyMoodDelta(pair.right, moraleDelta, stressDelta, 0);
  applyLinkPairDelta(pair, {
    affinity: Number(effects.affinityGain ?? 0.05),
    rivalry: -Math.abs(Number(effects.rivalryRelief ?? 0.09)),
    grudge: -Math.abs(Number(effects.grudgeRelief ?? 0.1)),
  });
  return `Social incident: reconciliation between ${pair.left.id} and ${pair.right.id}`;
}

// Resolve mentor/mentee direction for a mentorship incident pair.
function resolveMentorForPair(pair) {
  const left = pair.left;
  const right = pair.right;
  const leftStatus = left && left.social && left.social.status && typeof left.social.status === 'object'
    ? left.social.status
    : {};
  const rightStatus = right && right.social && right.social.status && typeof right.social.status === 'object'
    ? right.social.status
    : {};
  const leftId = String(left && left.id || '');
  const rightId = String(right && right.id || '');
  if (String(rightStatus.mentorId || '') === leftId) {
    return left;
  }
  if (String(leftStatus.mentorId || '') === rightId) {
    return right;
  }
  return resolveSocialSkillScore(left) >= resolveSocialSkillScore(right) ? left : right;
}

// Apply bounded mood deltas on one dwarf.
function applyMoodDelta(dwarf, moraleDelta, stressDelta, fatigueDelta) {
  if (!dwarf || !dwarf.state || typeof dwarf.state !== 'object') {
    return;
  }
  dwarf.state.morale = clamp(Number(dwarf.state.morale || 0) + Number(moraleDelta || 0), 0, 1);
  dwarf.state.stress = clamp(Number(dwarf.state.stress || 0) + Number(stressDelta || 0), 0, 1);
  dwarf.state.fatigue = clamp(Number(dwarf.state.fatigue || 0) + Number(fatigueDelta || 0), 0, 1);
}

// Apply bounded warrior progression deltas used by mentorship breakthroughs.
function applyWarriorDelta(dwarf, effects) {
  if (!dwarf || !dwarf.warrior || typeof dwarf.warrior !== 'object') {
    return;
  }
  dwarf.warrior.rating = clamp(
    Number(dwarf.warrior.rating || 0) + Number(effects.ratingGain ?? 0.0025),
    0,
    1,
  );
  dwarf.warrior.valor = clamp(
    Number(dwarf.warrior.valor || 0) + Number(effects.valorGain ?? 0.002),
    0,
    1,
  );
  dwarf.warrior.heroPotential = clamp(
    Number(dwarf.warrior.heroPotential || 0) + Number(effects.heroPotentialGain ?? 0.0015),
    0,
    1,
  );
}

// Apply symmetric link-channel deltas to both directions of one pair.
function applyLinkPairDelta(pair, deltas) {
  const leftLink = pair.leftLink;
  const rightLink = pair.rightLink;
  const affinityDelta = Number(deltas.affinity || 0);
  const rivalryDelta = Number(deltas.rivalry || 0);
  const mentorshipDelta = Number(deltas.mentorship || 0);
  const grudgeDelta = Number(deltas.grudge || 0);
  for (const link of [leftLink, rightLink]) {
    if (!link || typeof link !== 'object') {
      continue;
    }
    link.affinity = clamp(Number(link.affinity || 0) + affinityDelta, 0, 1);
    link.rivalry = clamp(Number(link.rivalry || 0) + rivalryDelta, 0, 1);
    link.mentorship = clamp(Number(link.mentorship || 0) + mentorshipDelta, 0, 1);
    link.grudge = clamp(Number(link.grudge || 0) + grudgeDelta, 0, 1);
  }
}

// Remove stale per-pair cooldown entries.
function prunePairCooldowns(cooldownMap, tick, retentionTicks) {
  if (!cooldownMap || typeof cooldownMap !== 'object' || retentionTicks <= 0) {
    return;
  }
  const minTick = tick - retentionTicks;
  for (const [pairKey, lastTick] of Object.entries(cooldownMap)) {
    if (Math.max(0, Number(lastTick || 0)) < minTick) {
      delete cooldownMap[pairKey];
    }
  }
}

// Weighted random pick helper.
function pickWeighted(entries, weightSelector) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }
  let total = 0;
  for (const entry of entries) {
    total += Math.max(0, Number(weightSelector(entry) || 0));
  }
  if (total <= 0) {
    return null;
  }
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= Math.max(0, Number(weightSelector(entry) || 0));
    if (roll <= 0) {
      return entry;
    }
  }
  return entries[entries.length - 1] || null;
}

// Build empty by-type counters for social incidents.
function createIncidentTypeCounters() {
  const byType = {};
  for (const type of SOCIAL_INCIDENT_TYPES) {
    byType[type] = 0;
  }
  return byType;
}

// Normalize social-incident counters by type.
function normalizeIncidentTypeCounters(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const normalized = {};
  for (const type of SOCIAL_INCIDENT_TYPES) {
    normalized[type] = Math.max(0, Number(source[type] || 0));
  }
  return normalized;
}

// Resolve one social link ranking strength.
function resolveLinkStrength(link) {
  if (!link || typeof link !== 'object') {
    return 0;
  }
  const affinity = clamp(Number(link.affinity || 0), 0, 1);
  const rivalry = clamp(Number(link.rivalry || 0), 0, 1);
  const mentorship = clamp(Number(link.mentorship || 0), 0, 1);
  const grudge = clamp(Number(link.grudge || 0), 0, 1);
  return Math.max(affinity, rivalry, mentorship, grudge);
}

// Resolve one bounded skill scalar used for mentorship inference.
function resolveSocialSkillScore(dwarf) {
  if (!dwarf || typeof dwarf !== 'object') {
    return 0;
  }
  const warrior = dwarf.warrior && typeof dwarf.warrior === 'object'
    ? dwarf.warrior
    : null;
  if (!warrior) {
    return 0;
  }
  return clamp(
    Number(warrior.rating || 0) * 0.55
      + Number(warrior.valor || 0) * 0.25
      + Number(warrior.heroPotential || 0) * 0.2,
    0,
    1,
  );
}

// Resolve pair bond strength from existing relationship channels.
function resolvePairBondRatio(left, right, relationships) {
  const threshold = Math.max(1, Number(relationships && relationships.bondThreshold || 12));
  const leftRatio = left
    && left.partnerId === right.id
    ? clamp(Number(left.bondScore || 0) / threshold, 0, 1)
    : 0;
  const rightRatio = right
    && right.partnerId === left.id
    ? clamp(Number(right.bondScore || 0) / threshold, 0, 1)
    : 0;
  return clamp((leftRatio + rightRatio) / 2, 0, 1);
}

// Resolve one social-governor snapshot from the action envelope.
function resolveSocialGovernor(action, config, governorConfig) {
  const sourceConfig = governorConfig && typeof governorConfig === 'object'
    ? governorConfig
    : getSocialGovernorConfig(config);
  const enabled = sourceConfig.enabled !== false;
  const socialAction = action && action.social && typeof action.social === 'object'
    ? action.social
    : null;
  const mediationBiasMax = clamp(Number(sourceConfig.mediationBiasMax ?? 0.45), 0, 1);
  const mentorshipBiasMax = clamp(Number(sourceConfig.mentorshipBiasMax ?? 0.45), 0, 1);
  const accountabilityBiasMax = clamp(Number(sourceConfig.accountabilityBiasMax ?? 0.45), 0, 1);
  const mediationBias = enabled && socialAction && Object.prototype.hasOwnProperty.call(socialAction, 'mediationBias')
    ? clamp(
      normalizeSocialSignedIntent(socialAction.mediationBias, config) * mediationBiasMax,
      -mediationBiasMax,
      mediationBiasMax,
    )
    : 0;
  const mentorshipBias = enabled && socialAction && Object.prototype.hasOwnProperty.call(socialAction, 'mentorshipBias')
    ? clamp(
      normalizeSocialSignedIntent(socialAction.mentorshipBias, config) * mentorshipBiasMax,
      -mentorshipBiasMax,
      mentorshipBiasMax,
    )
    : 0;
  const accountabilityBias = enabled && socialAction && Object.prototype.hasOwnProperty.call(socialAction, 'accountabilityBias')
    ? clamp(
      normalizeSocialSignedIntent(socialAction.accountabilityBias, config) * accountabilityBiasMax,
      -accountabilityBiasMax,
      accountabilityBiasMax,
    )
    : 0;
  return {
    enabled,
    source: socialAction ? 'action' : 'default',
    mediationBias,
    mentorshipBias,
    accountabilityBias,
    mediationRivalryReductionScale: clamp(Number(sourceConfig.mediationRivalryReductionScale ?? 0.55), 0, 2),
    mediationGrudgeReductionScale: clamp(Number(sourceConfig.mediationGrudgeReductionScale ?? 0.65), 0, 2),
    mentorshipGainScale: clamp(Number(sourceConfig.mentorshipGainScale ?? 0.5), 0, 2),
    accountabilityRivalryReductionScale: clamp(Number(sourceConfig.accountabilityRivalryReductionScale ?? 0.3), 0, 2),
    accountabilityGrudgeReductionScale: clamp(Number(sourceConfig.accountabilityGrudgeReductionScale ?? 0.48), 0, 2),
    mediationReconciliationWeightScale: clamp(Number(sourceConfig.mediationReconciliationWeightScale ?? 0.75), 0, 2),
    mentorshipIncidentWeightScale: clamp(Number(sourceConfig.mentorshipIncidentWeightScale ?? 0.65), 0, 2),
    accountabilityIncidentChanceScale: clamp(Number(sourceConfig.accountabilityIncidentChanceScale ?? 0.32), 0, 2),
    mediationIncidentChanceScale: clamp(Number(sourceConfig.mediationIncidentChanceScale ?? 0.12), 0, 2),
    accountabilityEscalationWeightReductionScale: clamp(Number(sourceConfig.accountabilityEscalationWeightReductionScale ?? 0.6), 0, 2),
  };
}

// Normalize one persisted social-governor snapshot.
function normalizeSocialGovernorSnapshot(raw, governorConfig) {
  const safeRaw = raw && typeof raw === 'object' ? raw : {};
  const sourceConfig = governorConfig && typeof governorConfig === 'object'
    ? governorConfig
    : {};
  return {
    enabled: safeRaw.enabled !== false,
    source: safeRaw.source === 'action' ? 'action' : 'default',
    mediationBias: clamp(Number(safeRaw.mediationBias || 0), -1, 1),
    mentorshipBias: clamp(Number(safeRaw.mentorshipBias || 0), -1, 1),
    accountabilityBias: clamp(Number(safeRaw.accountabilityBias || 0), -1, 1),
    mediationRivalryReductionScale: clamp(
      Number(safeRaw.mediationRivalryReductionScale ?? sourceConfig.mediationRivalryReductionScale ?? 0.55),
      0,
      2,
    ),
    mediationGrudgeReductionScale: clamp(
      Number(safeRaw.mediationGrudgeReductionScale ?? sourceConfig.mediationGrudgeReductionScale ?? 0.65),
      0,
      2,
    ),
    mentorshipGainScale: clamp(
      Number(safeRaw.mentorshipGainScale ?? sourceConfig.mentorshipGainScale ?? 0.5),
      0,
      2,
    ),
    accountabilityRivalryReductionScale: clamp(
      Number(safeRaw.accountabilityRivalryReductionScale ?? sourceConfig.accountabilityRivalryReductionScale ?? 0.3),
      0,
      2,
    ),
    accountabilityGrudgeReductionScale: clamp(
      Number(safeRaw.accountabilityGrudgeReductionScale ?? sourceConfig.accountabilityGrudgeReductionScale ?? 0.48),
      0,
      2,
    ),
    mediationReconciliationWeightScale: clamp(
      Number(safeRaw.mediationReconciliationWeightScale ?? sourceConfig.mediationReconciliationWeightScale ?? 0.75),
      0,
      2,
    ),
    mentorshipIncidentWeightScale: clamp(
      Number(safeRaw.mentorshipIncidentWeightScale ?? sourceConfig.mentorshipIncidentWeightScale ?? 0.65),
      0,
      2,
    ),
    accountabilityIncidentChanceScale: clamp(
      Number(safeRaw.accountabilityIncidentChanceScale ?? sourceConfig.accountabilityIncidentChanceScale ?? 0.32),
      0,
      2,
    ),
    mediationIncidentChanceScale: clamp(
      Number(safeRaw.mediationIncidentChanceScale ?? sourceConfig.mediationIncidentChanceScale ?? 0.12),
      0,
      2,
    ),
    accountabilityEscalationWeightReductionScale: clamp(
      Number(safeRaw.accountabilityEscalationWeightReductionScale ?? sourceConfig.accountabilityEscalationWeightReductionScale ?? 0.6),
      0,
      2,
    ),
  };
}

// Apply long-horizon social memory consequences on adult mood and aggregate climate.
function applyLongArcConsequences(adults, social, longArcConfig, tick) {
  const enabled = longArcConfig.enabled !== false;
  if (!enabled || !Array.isArray(adults) || adults.length === 0) {
    if (social && social.longArc && typeof social.longArc === 'object') {
      social.longArc.avgSupport = 0;
      social.longArc.avgBurden = 0;
    }
    return;
  }
  const memoryDecay = clamp(Number(longArcConfig.memoryDecayPerTick ?? 0.0026), 0, 1);
  const memoryGain = clamp(Number(longArcConfig.memoryGainPerUpdate ?? 0.26), 0, 1);
  const friendSupportWeight = Math.max(0, Number(longArcConfig.friendSupportWeight ?? 0.06));
  const mentorshipSupportWeight = Math.max(0, Number(longArcConfig.mentorshipSupportWeight ?? 0.12));
  const rivalBurdenWeight = Math.max(0, Number(longArcConfig.rivalBurdenWeight ?? 0.08));
  const grudgeBurdenWeight = Math.max(0, Number(longArcConfig.grudgeBurdenWeight ?? 0.14));
  const supportFromIncident = clamp(Number(longArcConfig.supportShockOnPositiveIncident ?? 0.06), 0, 1);
  const burdenFromIncident = clamp(Number(longArcConfig.burdenShockOnNegativeIncident ?? 0.08), 0, 1);
  const moraleSupportScale = Math.max(0, Number(longArcConfig.moraleSupportScale ?? 0.03));
  const moraleBurdenScale = Math.max(0, Number(longArcConfig.moraleBurdenScale ?? 0.035));
  const stressSupportReliefScale = Math.max(0, Number(longArcConfig.stressSupportReliefScale ?? 0.024));
  const stressBurdenScale = Math.max(0, Number(longArcConfig.stressBurdenScale ?? 0.04));
  const fatigueSupportReliefScale = Math.max(0, Number(longArcConfig.fatigueSupportReliefScale ?? 0.012));
  const fatigueBurdenScale = Math.max(0, Number(longArcConfig.fatigueBurdenScale ?? 0.018));
  let supportSum = 0;
  let burdenSum = 0;
  let count = 0;

  for (const dwarf of adults) {
    if (!dwarf || typeof dwarf !== 'object') {
      continue;
    }
    const socialState = normalizeDwarfSocialState(dwarf.social);
    dwarf.social = socialState;
    const status = socialState.status && typeof socialState.status === 'object'
      ? socialState.status
      : {};
    const friendCount = Array.isArray(status.friendIds) ? status.friendIds.length : 0;
    const rivalCount = Array.isArray(status.rivalIds) ? status.rivalIds.length : 0;
    const grudgeCount = Array.isArray(status.grudgeIds) ? status.grudgeIds.length : 0;
    const mentorshipCount = (status.mentorId ? 1 : 0) + (Array.isArray(status.menteeIds) ? status.menteeIds.length : 0);
    let supportTarget = clamp(friendCount * friendSupportWeight + mentorshipCount * mentorshipSupportWeight, 0, 1);
    let burdenTarget = clamp(rivalCount * rivalBurdenWeight + grudgeCount * grudgeBurdenWeight, 0, 1);
    const lastIncidentTick = Math.max(0, Number(socialState.cooldowns.lastIncidentTick || 0));
    const incidentAge = lastIncidentTick > 0 ? Math.max(0, tick - lastIncidentTick) : null;
    const incidentType = String(socialState.cooldowns.lastIncidentType || '');
    if (incidentAge !== null && incidentAge <= 1) {
      if (incidentType === 'mentorship_breakthrough' || incidentType === 'reconciliation') {
        supportTarget = clamp(supportTarget + supportFromIncident, 0, 1);
        burdenTarget = clamp(burdenTarget - supportFromIncident * 0.45, 0, 1);
      } else if (incidentType === 'rivalry_clash' || incidentType === 'grudge_escalation') {
        burdenTarget = clamp(burdenTarget + burdenFromIncident, 0, 1);
        supportTarget = clamp(supportTarget - burdenFromIncident * 0.35, 0, 1);
      }
    }

    socialState.arc.supportMemory = clamp(
      Number(socialState.arc.supportMemory || 0) * (1 - memoryDecay)
      + supportTarget * memoryGain,
      0,
      1,
    );
    socialState.arc.burdenMemory = clamp(
      Number(socialState.arc.burdenMemory || 0) * (1 - memoryDecay)
      + burdenTarget * memoryGain,
      0,
      1,
    );
    const supportMemory = clamp(Number(socialState.arc.supportMemory || 0), 0, 1);
    const burdenMemory = clamp(Number(socialState.arc.burdenMemory || 0), 0, 1);
    applyMoodDelta(
      dwarf,
      supportMemory * moraleSupportScale - burdenMemory * moraleBurdenScale,
      burdenMemory * stressBurdenScale - supportMemory * stressSupportReliefScale,
      burdenMemory * fatigueBurdenScale - supportMemory * fatigueSupportReliefScale,
    );
    supportSum += supportMemory;
    burdenSum += burdenMemory;
    count += 1;
  }

  const avgSupport = count > 0 ? clamp(supportSum / count, 0, 1) : 0;
  const avgBurden = count > 0 ? clamp(burdenSum / count, 0, 1) : 0;
  social.longArc.avgSupport = avgSupport;
  social.longArc.avgBurden = avgBurden;
}

// Update settlement-level social climate memory with slow drift.
function applyLongArcSettlementDrift(social, longArcConfig) {
  if (!social || !social.longArc || typeof social.longArc !== 'object') {
    return;
  }
  const enabled = longArcConfig.enabled !== false;
  if (!enabled) {
    social.longArc.harmony = 0;
    social.longArc.strife = 0;
    return;
  }
  const decay = clamp(Number(longArcConfig.settlementMemoryDecayPerTick ?? 0.004), 0, 1);
  const gain = clamp(Number(longArcConfig.settlementMemoryGainPerUpdate ?? 0.22), 0, 1);
  const harmonyTarget = clamp(
    Number(social.longArc.avgSupport || 0) * 0.7
      + Number(social.cohesion || 0) * 0.45
      - Number(social.conflictPressure || 0) * 0.22,
    0,
    1,
  );
  const strifeTarget = clamp(
    Number(social.longArc.avgBurden || 0) * 0.74
      + Number(social.conflictPressure || 0) * 0.48
      + Number(social.grudgeLoad || 0) * 0.34
      - Number(social.cohesion || 0) * 0.2,
    0,
    1,
  );
  social.longArc.harmony = clamp(
    Number(social.longArc.harmony || 0) * (1 - decay) + harmonyTarget * gain,
    0,
    1,
  );
  social.longArc.strife = clamp(
    Number(social.longArc.strife || 0) * (1 - decay) + strifeTarget * gain,
    0,
    1,
  );
}

// Normalize one governor value into -1..1 from global AI range.
function normalizeSocialSignedIntent(value, config) {
  const aiConfig = (config && config.ai) || {};
  const minWeight = Number(aiConfig.minWeight ?? 0);
  const maxWeight = Number(aiConfig.maxWeight ?? 1);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  if (maxWeight > minWeight) {
    const normalized = clamp((numeric - minWeight) / (maxWeight - minWeight), 0, 1);
    return clamp(normalized * 2 - 1, -1, 1);
  }
  return clamp(numeric, -1, 1);
}

// Return true if the dwarf is currently an adult.
function isAdultDwarf(dwarf, config) {
  if (!dwarf || typeof dwarf !== 'object') {
    return false;
  }
  const aging = (config && config.population && config.population.aging) || {};
  const adultAge = Number(aging.adultAge || 0);
  return Number(dwarf.ageTicks || 0) >= adultAge;
}

// Normalize ids arrays into unique string lists.
function toIdList(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const ids = [];
  const seen = new Set();
  for (const entry of raw) {
    if (!entry) {
      continue;
    }
    const id = String(entry);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

// Normalize unknown id collections to a unique id set.
function toIdSet(raw) {
  const set = new Set();
  if (raw instanceof Set) {
    for (const entry of raw.values()) {
      if (!entry) {
        continue;
      }
      set.add(String(entry));
    }
    return set;
  }
  if (!Array.isArray(raw)) {
    return set;
  }
  for (const entry of raw) {
    if (!entry) {
      continue;
    }
    set.add(String(entry));
  }
  return set;
}

// Remove dead dwarf references from social links, status arrays, and incident history.
function clearDeadSocialLinks(state, deadIdsRaw) {
  if (!state || typeof state !== 'object') {
    return 0;
  }
  const deadIds = toIdSet(deadIdsRaw);
  if (deadIds.size <= 0) {
    return 0;
  }

  let updatedDwarves = 0;
  const dwarves = Array.isArray(state.dwarves) ? state.dwarves : [];
  for (const dwarf of dwarves) {
    if (!dwarf || typeof dwarf !== 'object') {
      continue;
    }
    const socialState = normalizeDwarfSocialState(dwarf.social);
    let changed = false;

    for (const peerId of Object.keys(socialState.links)) {
      if (!deadIds.has(String(peerId || ''))) {
        continue;
      }
      delete socialState.links[peerId];
      changed = true;
    }

    const status = socialState.status;
    const nextFriends = toIdList(status.friendIds).filter((id) => !deadIds.has(id));
    if (nextFriends.length !== status.friendIds.length) {
      status.friendIds = nextFriends;
      changed = true;
    }
    const nextRivals = toIdList(status.rivalIds).filter((id) => !deadIds.has(id));
    if (nextRivals.length !== status.rivalIds.length) {
      status.rivalIds = nextRivals;
      changed = true;
    }
    const nextGrudges = toIdList(status.grudgeIds).filter((id) => !deadIds.has(id));
    if (nextGrudges.length !== status.grudgeIds.length) {
      status.grudgeIds = nextGrudges;
      changed = true;
    }
    const nextMentees = toIdList(status.menteeIds).filter((id) => !deadIds.has(id));
    if (nextMentees.length !== status.menteeIds.length) {
      status.menteeIds = nextMentees;
      changed = true;
    }
    const mentorId = status.mentorId ? String(status.mentorId) : null;
    if (mentorId && deadIds.has(mentorId)) {
      status.mentorId = null;
      changed = true;
    }

    if (changed) {
      updatedDwarves += 1;
    }
    dwarf.social = socialState;
  }

  const social = state.social && typeof state.social === 'object'
    ? state.social
    : null;
  if (social) {
    if (social.pairCooldownByKey && typeof social.pairCooldownByKey === 'object') {
      for (const pairKey of Object.keys(social.pairCooldownByKey)) {
        const [leftId, rightId] = String(pairKey || '').split('|');
        if (deadIds.has(String(leftId || '')) || deadIds.has(String(rightId || ''))) {
          delete social.pairCooldownByKey[pairKey];
        }
      }
    }
    if (Array.isArray(social.history)) {
      social.history = social.history.filter((entry) => {
        if (!entry || typeof entry !== 'object') {
          return false;
        }
        const leftId = String(entry.leftId || '');
        const rightId = String(entry.rightId || '');
        return !deadIds.has(leftId) && !deadIds.has(rightId);
      });
    }
  }

  return updatedDwarves;
}

// Return one stable social-drama status payload for render/telemetry callers.
function getSocialDramaStatus(state, config) {
  const socialConfig = getSocialDramaConfig(config);
  const social = state && state.social && typeof state.social === 'object'
    ? state.social
    : null;
  const enabled = Boolean(
    social
      && social.enabled === true
      && socialConfig.enabled !== false,
  );
  const stats = normalizeSocialStats(social && social.stats ? social.stats : null);
  const longArc = social && social.longArc && typeof social.longArc === 'object'
    ? social.longArc
    : {};
  const governor = normalizeSocialGovernorSnapshot(social && social.governor ? social.governor : null);
  return {
    enabled,
    cohesion: enabled ? clamp(Number(social.cohesion || 0), 0, 1) : 0,
    conflictPressure: enabled ? clamp(Number(social.conflictPressure || 0), 0, 1) : 0,
    mentorshipCoverage: enabled ? clamp(Number(social.mentorshipCoverage || 0), 0, 1) : 0,
    grudgeLoad: enabled ? clamp(Number(social.grudgeLoad || 0), 0, 1) : 0,
    longArc: {
      harmony: enabled ? clamp(Number(longArc.harmony || 0), 0, 1) : 0,
      strife: enabled ? clamp(Number(longArc.strife || 0), 0, 1) : 0,
      avgSupport: enabled ? clamp(Number(longArc.avgSupport || 0), 0, 1) : 0,
      avgBurden: enabled ? clamp(Number(longArc.avgBurden || 0), 0, 1) : 0,
    },
    governor,
    stats,
    history: social && Array.isArray(social.history) ? social.history.slice() : [],
    lastUpdateTick: Math.max(0, Number(social && social.lastUpdateTick || 0)),
    lastIncidentTick: Math.max(0, Number(social && social.lastIncidentTick || 0)),
  };
}

module.exports = {
  createDwarfSocialState,
  createSocialDramaState,
  ensureSocialDramaState,
  ensureDwarfSocialState,
  updateSocialDrama,
  clearDeadSocialLinks,
  getSocialDramaStatus,
};
