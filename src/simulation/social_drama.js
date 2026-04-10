'use strict';

const { clamp } = require('../utils');
const { pushEvent } = require('./events');

const DEFAULT_HISTORY_LIMIT = 12;
const DEFAULT_MAX_LINKS = 6;

// Return the social-drama config nested under population relationships.
function getSocialDramaConfig(config) {
  const relationships = (config && config.population && config.population.relationships) || {};
  return relationships.socialDrama && typeof relationships.socialDrama === 'object'
    ? relationships.socialDrama
    : {};
}

// Build one empty per-dwarf social runtime state.
function createInitialDwarfSocialState() {
  return {
    links: [],
    lastIncidentTick: 0,
    incidentCount: 0,
    summary: createEmptySummary(),
  };
}

// Build one empty summary snapshot for inspect/telemetry usage.
function createEmptySummary() {
  return {
    friendId: null,
    friendScore: 0,
    rivalId: null,
    rivalScore: 0,
    grudgeId: null,
    grudgeScore: 0,
    mentorId: null,
    mentorScore: 0,
    protegeId: null,
    protegeScore: 0,
  };
}

// Build one empty social-drama runtime state for the run.
function createSocialDramaState(config) {
  const dramaConfig = getSocialDramaConfig(config);
  if (dramaConfig.enabled === false) {
    return null;
  }
  return {
    enabled: true,
    lastIncidentTick: 0,
    history: [],
    stats: {
      incidents: 0,
      friendship: 0,
      rivalry: 0,
      grudge: 0,
      mentorship: 0,
    },
  };
}

// Ensure one dwarf carries a normalized social runtime payload.
function ensureDwarfSocialState(dwarf) {
  if (!dwarf || typeof dwarf !== 'object') {
    return createInitialDwarfSocialState();
  }
  if (!dwarf.social || typeof dwarf.social !== 'object') {
    dwarf.social = createInitialDwarfSocialState();
  }
  const social = dwarf.social;
  social.links = Array.isArray(social.links)
    ? social.links.map(normalizeSocialLink).filter(Boolean)
    : [];
  social.lastIncidentTick = Math.max(0, Math.floor(Number(social.lastIncidentTick || 0)));
  social.incidentCount = Math.max(0, Math.floor(Number(social.incidentCount || 0)));
  social.summary = normalizeSummary(social.summary);
  return social;
}

// Ensure the global social-drama runtime state exists and is normalized.
function ensureSocialDramaState(state, config) {
  const dramaConfig = getSocialDramaConfig(config);
  if (!state || dramaConfig.enabled === false) {
    if (state) {
      state.socialDrama = null;
    }
    return null;
  }
  if (!state.socialDrama || typeof state.socialDrama !== 'object') {
    state.socialDrama = createSocialDramaState(config);
  }
  const socialDrama = state.socialDrama;
  socialDrama.enabled = true;
  socialDrama.lastIncidentTick = Math.max(0, Math.floor(Number(socialDrama.lastIncidentTick || 0)));
  socialDrama.history = Array.isArray(socialDrama.history)
    ? socialDrama.history
      .map((entry) => normalizeIncidentEntry(entry))
      .filter(Boolean)
    : [];
  socialDrama.stats = normalizeDramaStats(socialDrama.stats);
  trimIncidentHistory(socialDrama, resolveDramaSettings(dramaConfig).incidents.historyLimit);
  return socialDrama;
}

// Record one social interaction between two dwarves and update bounded link memory.
function noteSocialInteraction(state, config, dwarf, partner) {
  const dramaConfig = getSocialDramaConfig(config);
  if (dramaConfig.enabled === false) {
    return;
  }
  if (!dwarf || !partner || !dwarf.id || !partner.id || dwarf.id === partner.id) {
    return;
  }
  const socialDrama = ensureSocialDramaState(state, config);
  if (!socialDrama) {
    return;
  }
  const settings = resolveDramaSettings(dramaConfig);
  const tick = Math.max(0, Math.floor(Number(state && state.tick || 0)));
  const socialA = ensureDwarfSocialState(dwarf);
  const socialB = ensureDwarfSocialState(partner);
  const linkA = ensureSocialLink(socialA, partner.id, settings, tick);
  const linkB = ensureSocialLink(socialB, dwarf.id, settings, tick);
  if (!linkA || !linkB) {
    return;
  }

  const moraleA = clampUnit(dwarf.state && dwarf.state.morale, 0.5);
  const moraleB = clampUnit(partner.state && partner.state.morale, 0.5);
  const stressA = clampUnit(dwarf.state && dwarf.state.stress, 0.5);
  const stressB = clampUnit(partner.state && partner.state.stress, 0.5);
  const avgMorale = (moraleA + moraleB) / 2;
  const avgStress = (stressA + stressB) / 2;
  const sameClan = Boolean(dwarf.clanId && partner.clanId && dwarf.clanId === partner.clanId);
  const sameHome = Boolean(dwarf.homeId && partner.homeId && dwarf.homeId === partner.homeId);
  const sameRole = Boolean(dwarf.role && partner.role && dwarf.role === partner.role);

  const affinityFactor =
    1
    + (sameClan ? settings.sameClanAffinityBonus : 0)
    + (sameHome ? settings.sameHomeAffinityBonus : 0)
    + avgMorale * 0.35;
  const rivalryPressure =
    0.08
    + avgStress * settings.stressRivalryScale
    + (1 - avgMorale) * settings.lowMoraleRivalryScale
    + (sameRole ? settings.sameRoleRivalryBonus : 0)
    + (!sameClan && sameHome ? 0.12 : 0)
    + (!sameClan && !sameRole ? 0.04 : 0)
    + (linkA.grudge > 0 || linkB.grudge > 0 ? 0.12 : 0);

  const affinityGain = settings.friendshipGain * affinityFactor;
  const frictionGain = settings.rivalryGain * rivalryPressure;
  const frictionRelief = affinityGain * 0.04;
  const affinityErosion = frictionGain * 0.22;

  linkA.affinity = clampScore(linkA.affinity + affinityGain, settings.scoreCap);
  linkB.affinity = clampScore(linkB.affinity + affinityGain, settings.scoreCap);
  linkA.friction = clampScore(Math.max(0, linkA.friction - frictionRelief) + frictionGain, settings.scoreCap);
  linkB.friction = clampScore(Math.max(0, linkB.friction - frictionRelief) + frictionGain, settings.scoreCap);
  linkA.affinity = clampScore(Math.max(0, linkA.affinity - affinityErosion), settings.scoreCap);
  linkB.affinity = clampScore(Math.max(0, linkB.affinity - affinityErosion), settings.scoreCap);

  const grudgeFloor = settings.thresholds.rivalry * 0.75;
  const frictionAverage = (linkA.friction + linkB.friction) / 2;
  if (frictionAverage >= grudgeFloor) {
    const grudgeGain = settings.grudgeGain * (1 + frictionAverage / Math.max(1, settings.scoreCap));
    linkA.grudge = clampScore(linkA.grudge + grudgeGain, settings.scoreCap);
    linkB.grudge = clampScore(linkB.grudge + grudgeGain, settings.scoreCap);
  } else if (avgMorale > 0.68 && avgStress < 0.38) {
    const softRelief = affinityGain * 0.04;
    linkA.grudge = Math.max(0, linkA.grudge - softRelief);
    linkB.grudge = Math.max(0, linkB.grudge - softRelief);
  }

  updateMentorshipLinks(dwarf, partner, linkA, linkB, settings);
  linkA.lastInteractionTick = tick;
  linkB.lastInteractionTick = tick;
}

// Decay social link memory, apply passive effects, and trigger rare incidents.
function updateSocialDrama(state, config) {
  const socialDrama = ensureSocialDramaState(state, config);
  if (!socialDrama) {
    return;
  }
  const settings = resolveDramaSettings(getSocialDramaConfig(config));
  const dwarves = Array.isArray(state && state.dwarves) ? state.dwarves : [];
  const validIds = new Set(dwarves.map((dwarf) => String(dwarf && dwarf.id || '')).filter(Boolean));

  for (const dwarf of dwarves) {
    const social = ensureDwarfSocialState(dwarf);
    social.links = social.links
      .map(normalizeSocialLink)
      .filter((link) => link && validIds.has(String(link.targetId || '')));
    decaySocialLinks(social.links, settings);
    pruneWeakLinks(social.links, settings);
    social.summary = buildSocialSummary(social.links, settings);
    applyPassiveDramaEffects(dwarf, social.summary, settings.effects);
  }

  maybeTriggerIncident(state, config, socialDrama, settings);
}

// Clear dead-id references from pair bonds, pregnancies, and social memory.
function clearDeadSocialLinks(state, deadIds) {
  const ids = normalizeIdSet(deadIds);
  if (ids.size === 0 || !state) {
    return;
  }
  const dwarves = Array.isArray(state.dwarves) ? state.dwarves : [];
  for (const dwarf of dwarves) {
    if (!dwarf || typeof dwarf !== 'object') {
      continue;
    }
    if (dwarf.partnerId && ids.has(String(dwarf.partnerId || ''))) {
      dwarf.partnerId = null;
      dwarf.bondTargetId = null;
      dwarf.bondScore = 0;
    }
    if (dwarf.pregnancy && ids.has(String(dwarf.pregnancy.partnerId || ''))) {
      dwarf.pregnancy = null;
    }
    const social = ensureDwarfSocialState(dwarf);
    social.links = social.links.filter((link) => !ids.has(String(link && link.targetId || '')));
    social.summary = buildSocialSummary(social.links, resolveDramaSettings(getSocialDramaConfig(state.lastConfig || {})));
  }
}

// Build a telemetry-friendly social-drama status snapshot.
function getSocialDramaStatus(state, config) {
  const dramaConfig = getSocialDramaConfig(config);
  if (dramaConfig.enabled === false) {
    return {
      enabled: false,
      friendships: 0,
      rivalries: 0,
      grudges: 0,
      mentorships: 0,
      heat: 0,
      latestIncident: null,
      ticksSinceIncident: null,
      totalIncidents: 0,
    };
  }
  const socialDrama = ensureSocialDramaState(state, config);
  const settings = resolveDramaSettings(dramaConfig);
  const dwarves = Array.isArray(state && state.dwarves) ? state.dwarves : [];
  const friendships = countUniquePeerPairs(dwarves, 'friendId');
  const rivalries = countUniquePeerPairs(dwarves, 'rivalId');
  const grudges = countUniquePeerPairs(dwarves, 'grudgeId');
  const mentorships = countUniqueMentorships(dwarves);
  const latestIncident = socialDrama && Array.isArray(socialDrama.history) && socialDrama.history.length > 0
    ? socialDrama.history[0]
    : null;
  const tick = Math.max(0, Number(state && state.tick || 0));
  const totalHeat = dwarves.reduce((sum, dwarf) => {
    const summary = ensureDwarfSocialState(dwarf).summary;
    const value =
      Math.max(0, Number(summary.rivalScore || 0))
      + Math.max(0, Number(summary.grudgeScore || 0)) * 1.2
      - Math.max(0, Number(summary.friendScore || 0)) * 0.4
      - Math.max(0, Number(summary.mentorScore || 0)) * 0.3;
    return sum + value;
  }, 0);
  const heat = dwarves.length > 0
    ? clamp(totalHeat / (dwarves.length * Math.max(1, settings.scoreCap)), 0, 1)
    : 0;
  return {
    enabled: true,
    friendships,
    rivalries,
    grudges,
    mentorships,
    heat,
    latestIncident: latestIncident ? latestIncident.text : null,
    ticksSinceIncident: latestIncident ? Math.max(0, tick - Number(latestIncident.tick || tick)) : null,
    totalIncidents: socialDrama ? Math.max(0, Number(socialDrama.stats.incidents || 0)) : 0,
  };
}

// Normalize one incident entry loaded from state or history.
function normalizeIncidentEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  return {
    type: String(entry.type || 'unknown'),
    tick: Math.max(0, Math.floor(Number(entry.tick || 0))),
    sourceId: entry.sourceId ? String(entry.sourceId) : null,
    targetId: entry.targetId ? String(entry.targetId) : null,
    text: entry.text ? String(entry.text) : '',
  };
}

// Normalize the global drama statistics shape.
function normalizeDramaStats(stats) {
  const source = stats && typeof stats === 'object' ? stats : {};
  return {
    incidents: Math.max(0, Math.floor(Number(source.incidents || 0))),
    friendship: Math.max(0, Math.floor(Number(source.friendship || 0))),
    rivalry: Math.max(0, Math.floor(Number(source.rivalry || 0))),
    grudge: Math.max(0, Math.floor(Number(source.grudge || 0))),
    mentorship: Math.max(0, Math.floor(Number(source.mentorship || 0))),
  };
}

// Normalize one per-target social link.
function normalizeSocialLink(link) {
  if (!link || typeof link !== 'object' || !link.targetId) {
    return null;
  }
  return {
    targetId: String(link.targetId),
    affinity: Math.max(0, Number(link.affinity || 0)),
    friction: Math.max(0, Number(link.friction || 0)),
    grudge: Math.max(0, Number(link.grudge || 0)),
    mentor: Math.max(0, Number(link.mentor || 0)),
    protege: Math.max(0, Number(link.protege || 0)),
    lastInteractionTick: Math.max(0, Math.floor(Number(link.lastInteractionTick || 0))),
    lastIncidentTick: Math.max(0, Math.floor(Number(link.lastIncidentTick || 0))),
  };
}

// Normalize one cached summary block.
function normalizeSummary(summary) {
  const source = summary && typeof summary === 'object' ? summary : {};
  return {
    friendId: source.friendId ? String(source.friendId) : null,
    friendScore: Math.max(0, Number(source.friendScore || 0)),
    rivalId: source.rivalId ? String(source.rivalId) : null,
    rivalScore: Math.max(0, Number(source.rivalScore || 0)),
    grudgeId: source.grudgeId ? String(source.grudgeId) : null,
    grudgeScore: Math.max(0, Number(source.grudgeScore || 0)),
    mentorId: source.mentorId ? String(source.mentorId) : null,
    mentorScore: Math.max(0, Number(source.mentorScore || 0)),
    protegeId: source.protegeId ? String(source.protegeId) : null,
    protegeScore: Math.max(0, Number(source.protegeScore || 0)),
  };
}

// Resolve normalized drama settings with safe defaults.
function resolveDramaSettings(dramaConfig) {
  const source = dramaConfig && typeof dramaConfig === 'object' ? dramaConfig : {};
  const thresholds = source.thresholds && typeof source.thresholds === 'object'
    ? source.thresholds
    : {};
  const decayPerTick = source.decayPerTick && typeof source.decayPerTick === 'object'
    ? source.decayPerTick
    : {};
  const effects = source.effects && typeof source.effects === 'object'
    ? source.effects
    : {};
  const incidents = source.incidents && typeof source.incidents === 'object'
    ? source.incidents
    : {};
  return {
    maxLinksPerDwarf: Math.max(1, Math.floor(Number(source.maxLinksPerDwarf || DEFAULT_MAX_LINKS))),
    scoreCap: Math.max(1, Number(source.scoreCap || 12)),
    minScoreToKeep: Math.max(0, Number(source.minScoreToKeep ?? 0.25)),
    friendshipGain: Math.max(0, Number(source.friendshipGain ?? 0.7)),
    rivalryGain: Math.max(0, Number(source.rivalryGain ?? 0.45)),
    grudgeGain: Math.max(0, Number(source.grudgeGain ?? 0.32)),
    mentorshipGain: Math.max(0, Number(source.mentorshipGain ?? 0.55)),
    sameClanAffinityBonus: Math.max(0, Number(source.sameClanAffinityBonus ?? 0.25)),
    sameHomeAffinityBonus: Math.max(0, Number(source.sameHomeAffinityBonus ?? 0.18)),
    sameRoleRivalryBonus: Math.max(0, Number(source.sameRoleRivalryBonus ?? 0.2)),
    stressRivalryScale: Math.max(0, Number(source.stressRivalryScale ?? 0.7)),
    lowMoraleRivalryScale: Math.max(0, Number(source.lowMoraleRivalryScale ?? 0.6)),
    mentorAgeGapTicks: Math.max(0, Number(source.mentorAgeGapTicks ?? 260)),
    menteeMaxAgeTicks: Math.max(0, Number(source.menteeMaxAgeTicks ?? 1400)),
    thresholds: {
      friendship: Math.max(0, Number(thresholds.friendship ?? 4.8)),
      rivalry: Math.max(0, Number(thresholds.rivalry ?? 3.6)),
      grudge: Math.max(0, Number(thresholds.grudge ?? 4.6)),
      mentor: Math.max(0, Number(thresholds.mentor ?? 4.2)),
      protege: Math.max(0, Number(thresholds.protege ?? 4.2)),
    },
    decayPerTick: {
      affinity: Math.max(0, Number(decayPerTick.affinity ?? 0.05)),
      friction: Math.max(0, Number(decayPerTick.friction ?? 0.04)),
      grudge: Math.max(0, Number(decayPerTick.grudge ?? 0.025)),
      mentor: Math.max(0, Number(decayPerTick.mentor ?? 0.03)),
      protege: Math.max(0, Number(decayPerTick.protege ?? 0.03)),
    },
    effects: {
      friendMoralePerTick: Number(effects.friendMoralePerTick ?? 0.012),
      friendStressReliefPerTick: Number(effects.friendStressReliefPerTick ?? 0.01),
      rivalStressPerTick: Number(effects.rivalStressPerTick ?? 0.012),
      rivalMoralePenaltyPerTick: Number(effects.rivalMoralePenaltyPerTick ?? 0.006),
      grudgeStressPerTick: Number(effects.grudgeStressPerTick ?? 0.016),
      grudgeMoralePenaltyPerTick: Number(effects.grudgeMoralePenaltyPerTick ?? 0.01),
      grudgeFatiguePerTick: Number(effects.grudgeFatiguePerTick ?? 0.008),
      mentorMoralePerTick: Number(effects.mentorMoralePerTick ?? 0.01),
      mentorStressReliefPerTick: Number(effects.mentorStressReliefPerTick ?? 0.012),
      protegeMoralePerTick: Number(effects.protegeMoralePerTick ?? 0.008),
      protegeStressReliefPerTick: Number(effects.protegeStressReliefPerTick ?? 0.006),
    },
    incidents: {
      enabled: incidents.enabled !== false,
      historyLimit: Math.max(1, Math.floor(Number(incidents.historyLimit || DEFAULT_HISTORY_LIMIT))),
      maxPerTick: Math.max(0, Math.floor(Number(incidents.maxPerTick || 1))),
      globalCooldownTicks: Math.max(0, Math.floor(Number(incidents.globalCooldownTicks || 20))),
      pairCooldownTicks: Math.max(0, Math.floor(Number(incidents.pairCooldownTicks || 80))),
      friendshipChance: clamp(Number(incidents.friendshipChance ?? 0.03), 0, 1),
      rivalryChance: clamp(Number(incidents.rivalryChance ?? 0.025), 0, 1),
      grudgeChance: clamp(Number(incidents.grudgeChance ?? 0.022), 0, 1),
      mentorshipChance: clamp(Number(incidents.mentorshipChance ?? 0.03), 0, 1),
      friendshipMoraleDelta: Number(incidents.friendshipMoraleDelta ?? 0.06),
      friendshipStressReliefDelta: Number(incidents.friendshipStressReliefDelta ?? 0.05),
      rivalryStressDelta: Number(incidents.rivalryStressDelta ?? 0.08),
      rivalryMoraleDelta: Number(incidents.rivalryMoraleDelta ?? -0.04),
      grudgeStressDelta: Number(incidents.grudgeStressDelta ?? 0.11),
      grudgeMoraleDelta: Number(incidents.grudgeMoraleDelta ?? -0.07),
      mentorshipMoraleDelta: Number(incidents.mentorshipMoraleDelta ?? 0.07),
      mentorshipFatigueReliefDelta: Number(incidents.mentorshipFatigueReliefDelta ?? 0.05),
    },
  };
}

// Ensure one bounded social link exists for the requested target.
function ensureSocialLink(social, targetId, settings, tick) {
  const id = String(targetId || '');
  if (!id) {
    return null;
  }
  let link = social.links.find((entry) => entry.targetId === id);
  if (link) {
    return link;
  }
  if (social.links.length >= settings.maxLinksPerDwarf) {
    social.links.sort((left, right) => {
      const leftScore = getLinkStrength(left);
      const rightScore = getLinkStrength(right);
      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }
      return Number(left.lastInteractionTick || 0) - Number(right.lastInteractionTick || 0);
    });
    social.links.shift();
  }
  link = normalizeSocialLink({
    targetId: id,
    affinity: 0,
    friction: 0,
    grudge: 0,
    mentor: 0,
    protege: 0,
    lastInteractionTick: tick,
    lastIncidentTick: 0,
  });
  social.links.push(link);
  return link;
}

// Update mentorship/protege directional links when age gap and mood allow it.
function updateMentorshipLinks(dwarf, partner, linkA, linkB, settings) {
  const ageA = Math.max(0, Number(dwarf.ageTicks || 0));
  const ageB = Math.max(0, Number(partner.ageTicks || 0));
  const gap = Math.abs(ageA - ageB);
  if (gap < settings.mentorAgeGapTicks) {
    return;
  }
  let younger = null;
  let older = null;
  let youngerLink = null;
  let olderLink = null;
  if (ageA < ageB) {
    younger = dwarf;
    older = partner;
    youngerLink = linkA;
    olderLink = linkB;
  } else if (ageB < ageA) {
    younger = partner;
    older = dwarf;
    youngerLink = linkB;
    olderLink = linkA;
  }
  if (!younger || !older || !youngerLink || !olderLink) {
    return;
  }
  if (Math.max(0, Number(younger.ageTicks || 0)) > settings.menteeMaxAgeTicks) {
    return;
  }
  const mentorGain = settings.mentorshipGain * (1 + gap / Math.max(1, settings.mentorAgeGapTicks * 4));
  youngerLink.mentor = clampScore(youngerLink.mentor + mentorGain, settings.scoreCap);
  olderLink.protege = clampScore(olderLink.protege + mentorGain, settings.scoreCap);
}

// Decay all social metrics by their configured per-tick amounts.
function decaySocialLinks(links, settings) {
  for (const link of links) {
    link.affinity = Math.max(0, link.affinity - settings.decayPerTick.affinity);
    link.friction = Math.max(0, link.friction - settings.decayPerTick.friction);
    link.grudge = Math.max(0, link.grudge - settings.decayPerTick.grudge);
    link.mentor = Math.max(0, link.mentor - settings.decayPerTick.mentor);
    link.protege = Math.max(0, link.protege - settings.decayPerTick.protege);
  }
}

// Drop links that no longer carry enough meaningful memory.
function pruneWeakLinks(links, settings) {
  const keepThreshold = Math.max(0, settings.minScoreToKeep);
  for (let i = links.length - 1; i >= 0; i -= 1) {
    if (getLinkStrength(links[i]) < keepThreshold) {
      links.splice(i, 1);
    }
  }
}

// Rebuild one dwarf's best social states from bounded link memory.
function buildSocialSummary(links, settings) {
  const summary = createEmptySummary();
  for (const link of links) {
    if (!link) {
      continue;
    }
    if (
      link.affinity >= settings.thresholds.friendship
      && link.affinity >= link.friction
      && link.affinity > summary.friendScore
    ) {
      summary.friendId = link.targetId;
      summary.friendScore = link.affinity;
    }
    if (
      link.friction >= settings.thresholds.rivalry
      && link.friction >= link.affinity * 0.7
      && summary.friendId !== link.targetId
      && link.friction > summary.rivalScore
    ) {
      summary.rivalId = link.targetId;
      summary.rivalScore = link.friction;
    }
    if (link.grudge >= settings.thresholds.grudge && link.grudge > summary.grudgeScore) {
      summary.grudgeId = link.targetId;
      summary.grudgeScore = link.grudge;
    }
    if (link.mentor >= settings.thresholds.mentor && link.mentor > summary.mentorScore) {
      summary.mentorId = link.targetId;
      summary.mentorScore = link.mentor;
    }
    if (link.protege >= settings.thresholds.protege && link.protege > summary.protegeScore) {
      summary.protegeId = link.targetId;
      summary.protegeScore = link.protege;
    }
  }
  if (!summary.rivalId && summary.grudgeId) {
    summary.rivalId = summary.grudgeId;
    summary.rivalScore = summary.grudgeScore;
  }
  return summary;
}

// Apply low-amplitude persistent mood effects from active social states.
function applyPassiveDramaEffects(dwarf, summary, effects) {
  if (!dwarf || !dwarf.state || !summary) {
    return;
  }
  if (summary.friendId) {
    adjustDwarfState(dwarf, {
      morale: Number(effects.friendMoralePerTick || 0),
      stress: -Number(effects.friendStressReliefPerTick || 0),
    });
  }
  if (summary.rivalId) {
    adjustDwarfState(dwarf, {
      morale: -Number(effects.rivalMoralePenaltyPerTick || 0),
      stress: Number(effects.rivalStressPerTick || 0),
    });
  }
  if (summary.grudgeId) {
    adjustDwarfState(dwarf, {
      morale: -Number(effects.grudgeMoralePenaltyPerTick || 0),
      stress: Number(effects.grudgeStressPerTick || 0),
      fatigue: Number(effects.grudgeFatiguePerTick || 0),
    });
  }
  if (summary.mentorId) {
    adjustDwarfState(dwarf, {
      morale: Number(effects.mentorMoralePerTick || 0),
      stress: -Number(effects.mentorStressReliefPerTick || 0),
    });
  }
  if (summary.protegeId) {
    adjustDwarfState(dwarf, {
      morale: Number(effects.protegeMoralePerTick || 0),
      stress: -Number(effects.protegeStressReliefPerTick || 0),
    });
  }
}

// Trigger at most one rare social incident when scores and cooldowns allow it.
function maybeTriggerIncident(state, config, socialDrama, settings) {
  if (!socialDrama || settings.incidents.enabled === false || settings.incidents.maxPerTick <= 0) {
    return;
  }
  const tick = Math.max(0, Math.floor(Number(state && state.tick || 0)));
  for (let i = 0; i < settings.incidents.maxPerTick; i += 1) {
    if (tick - Number(socialDrama.lastIncidentTick || 0) < settings.incidents.globalCooldownTicks) {
      return;
    }
    const candidates = buildIncidentCandidates(state, settings, tick);
    if (candidates.length === 0) {
      return;
    }
    const chosen = pickWeightedCandidate(candidates);
    if (!chosen) {
      return;
    }
    const baseChance = resolveIncidentChance(chosen.type, settings.incidents);
    const scoreRatio = clamp(Number(chosen.score || 0) / Math.max(1, settings.scoreCap), 0.25, 1);
    if (Math.random() > clamp(baseChance * scoreRatio, 0, 1)) {
      continue;
    }
    applyIncident(state, config, socialDrama, chosen, settings.incidents, tick);
  }
}

// Build all incident candidates from current social summaries.
function buildIncidentCandidates(state, settings, tick) {
  const dwarves = Array.isArray(state && state.dwarves) ? state.dwarves : [];
  const byId = new Map(dwarves.map((dwarf) => [String(dwarf.id || ''), dwarf]));
  const candidates = [];
  const seen = new Set();

  for (const dwarf of dwarves) {
    const social = ensureDwarfSocialState(dwarf);
    pushIncidentCandidate(candidates, seen, byId, dwarf, social.summary.friendId, social.summary.friendScore, 'friendship', tick, settings);
    pushIncidentCandidate(candidates, seen, byId, dwarf, social.summary.rivalId, social.summary.rivalScore, 'rivalry', tick, settings);
    pushIncidentCandidate(candidates, seen, byId, dwarf, social.summary.grudgeId, social.summary.grudgeScore, 'grudge', tick, settings);
    pushIncidentCandidate(candidates, seen, byId, dwarf, social.summary.mentorId, social.summary.mentorScore, 'mentorship', tick, settings, true);
  }

  return candidates;
}

// Push one eligible incident candidate if cooldowns and identities allow it.
function pushIncidentCandidate(candidates, seen, byId, dwarf, targetId, score, type, tick, settings, directional = false) {
  const sourceId = dwarf && dwarf.id ? String(dwarf.id) : '';
  const targetKey = targetId ? String(targetId) : '';
  if (!sourceId || !targetKey || sourceId === targetKey || Number(score || 0) <= 0) {
    return;
  }
  const target = byId.get(targetKey);
  if (!target) {
    return;
  }
  const key = directional
    ? `${type}:${sourceId}->${targetKey}`
    : `${type}:${buildPairKey(sourceId, targetKey)}`;
  if (seen.has(key)) {
    return;
  }
  const sourceSocial = ensureDwarfSocialState(dwarf);
  const targetSocial = ensureDwarfSocialState(target);
  const sourceLink = sourceSocial.links.find((link) => link.targetId === targetKey) || null;
  const targetLink = targetSocial.links.find((link) => link.targetId === sourceId) || null;
  const lastPairIncidentTick = Math.max(
    Number(sourceSocial.lastIncidentTick || 0),
    Number(targetSocial.lastIncidentTick || 0),
    Number(sourceLink && sourceLink.lastIncidentTick || 0),
    Number(targetLink && targetLink.lastIncidentTick || 0),
  );
  if (tick - lastPairIncidentTick < settings.incidents.pairCooldownTicks) {
    return;
  }
  seen.add(key);
  candidates.push({
    type,
    source: dwarf,
    target,
    sourceLink,
    targetLink,
    score: Math.max(0, Number(score || 0)),
  });
}

// Pick one incident candidate using weighted score.
function pickWeightedCandidate(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }
  const total = candidates.reduce((sum, entry) => sum + Math.max(0, Number(entry.score || 0)), 0);
  if (total <= 0) {
    return candidates[0];
  }
  let roll = Math.random() * total;
  for (const entry of candidates) {
    roll -= Math.max(0, Number(entry.score || 0));
    if (roll <= 0) {
      return entry;
    }
  }
  return candidates[candidates.length - 1];
}

// Resolve the chance gate for one incident type.
function resolveIncidentChance(type, incidents) {
  if (type === 'friendship') {
    return incidents.friendshipChance;
  }
  if (type === 'rivalry') {
    return incidents.rivalryChance;
  }
  if (type === 'grudge') {
    return incidents.grudgeChance;
  }
  if (type === 'mentorship') {
    return incidents.mentorshipChance;
  }
  return 0;
}

// Apply one social incident payload to runtime mood and event history.
function applyIncident(state, config, socialDrama, candidate, incidents, tick) {
  const source = candidate.source;
  const target = candidate.target;
  let text = '';
  if (candidate.type === 'friendship') {
    adjustDwarfState(source, {
      morale: incidents.friendshipMoraleDelta,
      stress: -incidents.friendshipStressReliefDelta,
    });
    adjustDwarfState(target, {
      morale: incidents.friendshipMoraleDelta,
      stress: -incidents.friendshipStressReliefDelta,
    });
    text = `Social drama: ${source.id} and ${target.id} share a hearth-song`;
  } else if (candidate.type === 'rivalry') {
    adjustDwarfState(source, {
      morale: incidents.rivalryMoraleDelta,
      stress: incidents.rivalryStressDelta,
    });
    adjustDwarfState(target, {
      morale: incidents.rivalryMoraleDelta,
      stress: incidents.rivalryStressDelta,
    });
    text = `Social drama: ${source.id} and ${target.id} quarrel over duty`;
  } else if (candidate.type === 'grudge') {
    adjustDwarfState(source, {
      morale: incidents.grudgeMoraleDelta,
      stress: incidents.grudgeStressDelta,
      fatigue: incidents.grudgeStressDelta * 0.4,
    });
    adjustDwarfState(target, {
      morale: incidents.grudgeMoraleDelta,
      stress: incidents.grudgeStressDelta,
      fatigue: incidents.grudgeStressDelta * 0.4,
    });
    text = `Social drama: ${source.id} and ${target.id} let a grudge harden`;
  } else if (candidate.type === 'mentorship') {
    adjustDwarfState(source, {
      morale: incidents.mentorshipMoraleDelta * 0.7,
      fatigue: -incidents.mentorshipFatigueReliefDelta * 0.4,
    });
    adjustDwarfState(target, {
      morale: incidents.mentorshipMoraleDelta,
      stress: -incidents.mentorshipFatigueReliefDelta * 0.6,
      fatigue: -incidents.mentorshipFatigueReliefDelta,
    });
    text = `Social drama: ${target.id} steadies ${source.id} with hard-earned craft wisdom`;
  }
  if (!text) {
    return;
  }

  const sourceSocial = ensureDwarfSocialState(source);
  const targetSocial = ensureDwarfSocialState(target);
  sourceSocial.lastIncidentTick = tick;
  targetSocial.lastIncidentTick = tick;
  sourceSocial.incidentCount = Math.max(0, Number(sourceSocial.incidentCount || 0)) + 1;
  targetSocial.incidentCount = Math.max(0, Number(targetSocial.incidentCount || 0)) + 1;
  if (candidate.sourceLink) {
    candidate.sourceLink.lastIncidentTick = tick;
  }
  if (candidate.targetLink) {
    candidate.targetLink.lastIncidentTick = tick;
  }

  socialDrama.lastIncidentTick = tick;
  socialDrama.stats.incidents = Math.max(0, Number(socialDrama.stats.incidents || 0)) + 1;
  if (candidate.type === 'friendship') {
    socialDrama.stats.friendship = Math.max(0, Number(socialDrama.stats.friendship || 0)) + 1;
  } else if (candidate.type === 'rivalry') {
    socialDrama.stats.rivalry = Math.max(0, Number(socialDrama.stats.rivalry || 0)) + 1;
  } else if (candidate.type === 'grudge') {
    socialDrama.stats.grudge = Math.max(0, Number(socialDrama.stats.grudge || 0)) + 1;
  } else if (candidate.type === 'mentorship') {
    socialDrama.stats.mentorship = Math.max(0, Number(socialDrama.stats.mentorship || 0)) + 1;
  }

  socialDrama.history.unshift({
    type: candidate.type,
    tick,
    sourceId: source.id,
    targetId: target.id,
    text,
  });
  trimIncidentHistory(socialDrama, incidents.historyLimit);
  pushEvent(state, config, text);
}

// Trim incident history to its configured upper bound.
function trimIncidentHistory(socialDrama, limit) {
  if (!socialDrama || !Array.isArray(socialDrama.history)) {
    return;
  }
  const maxEntries = Math.max(1, Math.floor(Number(limit || DEFAULT_HISTORY_LIMIT)));
  if (socialDrama.history.length > maxEntries) {
    socialDrama.history = socialDrama.history.slice(0, maxEntries);
  }
}

// Count unique peer-pair states such as friendships, rivalries, or grudges.
function countUniquePeerPairs(dwarves, key) {
  const pairs = new Set();
  for (const dwarf of dwarves) {
    const summary = ensureDwarfSocialState(dwarf).summary;
    const targetId = summary && summary[key] ? String(summary[key]) : '';
    const sourceId = dwarf && dwarf.id ? String(dwarf.id) : '';
    if (!sourceId || !targetId || sourceId === targetId) {
      continue;
    }
    pairs.add(buildPairKey(sourceId, targetId));
  }
  return pairs.size;
}

// Count unique mentorship relations from protege -> mentor summaries.
function countUniqueMentorships(dwarves) {
  const pairs = new Set();
  for (const dwarf of dwarves) {
    const summary = ensureDwarfSocialState(dwarf).summary;
    const mentorId = summary && summary.mentorId ? String(summary.mentorId) : '';
    const protegeId = dwarf && dwarf.id ? String(dwarf.id) : '';
    if (!mentorId || !protegeId || mentorId === protegeId) {
      continue;
    }
    pairs.add(`${mentorId}->${protegeId}`);
  }
  return pairs.size;
}

// Build one stable sorted pair key.
function buildPairKey(a, b) {
  return [String(a || ''), String(b || '')].sort().join('::');
}

// Return the aggregate strength of one bounded link entry.
function getLinkStrength(link) {
  if (!link) {
    return 0;
  }
  return Number(link.affinity || 0)
    + Number(link.friction || 0)
    + Number(link.grudge || 0)
    + Number(link.mentor || 0)
    + Number(link.protege || 0);
}

// Clamp one drama score into the legal [0, scoreCap] interval.
function clampScore(value, scoreCap) {
  return clamp(Number(value || 0), 0, Math.max(1, Number(scoreCap || 1)));
}

// Clamp one runtime metric into [0, 1] with a fallback.
function clampUnit(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return clamp(Number(fallback || 0), 0, 1);
  }
  return clamp(numeric, 0, 1);
}

// Adjust dwarf morale/stress/fatigue with safe clamping.
function adjustDwarfState(dwarf, deltas) {
  if (!dwarf || !dwarf.state || !deltas || typeof deltas !== 'object') {
    return;
  }
  if (deltas.morale !== undefined) {
    dwarf.state.morale = clampUnit(Number(dwarf.state.morale || 0) + Number(deltas.morale || 0), 0);
  }
  if (deltas.stress !== undefined) {
    dwarf.state.stress = clampUnit(Number(dwarf.state.stress || 0) + Number(deltas.stress || 0), 0);
  }
  if (deltas.fatigue !== undefined) {
    dwarf.state.fatigue = clampUnit(Number(dwarf.state.fatigue || 0) + Number(deltas.fatigue || 0), 0);
  }
}

// Normalize dead-id inputs into a clean string set.
function normalizeIdSet(deadIds) {
  if (deadIds instanceof Set) {
    return new Set(Array.from(deadIds).map((id) => String(id || '')).filter(Boolean));
  }
  if (Array.isArray(deadIds)) {
    return new Set(deadIds.map((id) => String(id || '')).filter(Boolean));
  }
  return new Set();
}

module.exports = {
  createInitialDwarfSocialState,
  createSocialDramaState,
  ensureDwarfSocialState,
  ensureSocialDramaState,
  noteSocialInteraction,
  updateSocialDrama,
  clearDeadSocialLinks,
  getSocialDramaStatus,
};
