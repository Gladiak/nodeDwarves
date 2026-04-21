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
      lastStatusTick: 0,
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
function updateSocialDrama(state, config) {
  const social = ensureSocialDramaState(state, config);
  if (!social) {
    return;
  }
  const socialConfig = getSocialDramaConfig(config);
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
    updateSocialLinkPair(left, right, config, socialConfig, tick);
  }

  let summary = finalizeSocialStatuses(adults, byId, socialConfig, tick);
  const incidentsTriggered = updateSocialIncidents(
    state,
    config,
    social,
    adults,
    byId,
    socialConfig,
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
  next.status.friendIds = toIdList(next.status.friendIds);
  next.status.rivalIds = toIdList(next.status.rivalIds);
  next.status.grudgeIds = toIdList(next.status.grudgeIds);
  next.status.mentorId = next.status.mentorId ? String(next.status.mentorId) : null;
  next.status.menteeIds = toIdList(next.status.menteeIds);
  next.cooldowns.lastIncidentTick = Math.max(0, Number(next.cooldowns.lastIncidentTick || 0));
  next.cooldowns.lastStatusTick = Math.max(0, Number(next.cooldowns.lastStatusTick || 0));
  return next;
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
function updateSocialLinkPair(left, right, config, socialConfig, tick) {
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

  const affinityDecay = Math.max(0, Number(socialConfig.affinityDecayPerTick ?? 0.0015));
  const rivalryDecay = Math.max(0, Number(socialConfig.rivalryDecayPerTick ?? 0.0025));
  const mentorshipDecay = Math.max(0, Number(socialConfig.mentorshipDecayPerTick ?? 0.0018));
  const grudgeDecay = Math.max(0, Number(socialConfig.grudgeDecayPerTick ?? 0.0012));
  applyLinkDelta(leftLink, affinityGain, rivalryGain, mentorshipGain, grudgeGain, affinityDecay, rivalryDecay, mentorshipDecay, grudgeDecay, tick);
  applyLinkDelta(rightLink, affinityGain, rivalryGain, mentorshipGain, grudgeGain, affinityDecay, rivalryDecay, mentorshipDecay, grudgeDecay, tick);
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
function updateSocialIncidents(state, config, social, adults, byId, socialConfig, tick) {
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
  let triggered = 0;

  for (let i = 0; i < maxPerUpdate; i += 1) {
    const baseChance = clamp(Number(incidentConfig.baseChancePerRoll ?? 0.45), 0, 1);
    if (Math.random() > baseChance) {
      break;
    }
    const candidates = buildIncidentCandidates(adults, byId, social, socialConfig, incidentConfig, tick);
    const selection = selectIncidentCandidate(candidates, incidentConfig);
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
function selectIncidentCandidate(candidates, incidentConfig) {
  const weights = incidentConfig.weights && typeof incidentConfig.weights === 'object'
    ? incidentConfig.weights
    : {};
  const typePool = [];
  for (const type of SOCIAL_INCIDENT_TYPES) {
    const entries = Array.isArray(candidates[type]) ? candidates[type] : [];
    if (entries.length === 0) {
      continue;
    }
    const weight = Math.max(0, Number(weights[type] ?? 1));
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

module.exports = {
  createDwarfSocialState,
  createSocialDramaState,
  updateSocialDrama,
};
