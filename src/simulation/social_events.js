'use strict';

const { pushEvent } = require('./events');
const { buildDwarfActor } = require('./lifecycle_events');

const SOCIAL_EVENT_TYPES = Object.freeze({
  mentorship_breakthrough: {
    type: 'social.mentorship_breakthrough',
    causeMetric: 'mentorship',
    tags: ['mentorship', 'breakthrough'],
  },
  rivalry_clash: {
    type: 'social.rivalry_clash',
    causeMetric: 'rivalry',
    tags: ['rivalry', 'clash'],
  },
  grudge_escalation: {
    type: 'social.grudge_escalation',
    causeMetric: 'grudge',
    tags: ['grudge', 'escalation'],
  },
  reconciliation: {
    type: 'social.reconciliation',
    causeMetric: 'affinity',
    tags: ['reconciliation'],
  },
});

// Resolve one bounded average from the two directional relationship links.
function resolvePairLinkValue(pair, metric) {
  const leftValue = Number(pair && pair.leftLink && pair.leftLink[metric] || 0);
  const rightValue = Number(pair && pair.rightLink && pair.rightLink[metric] || 0);
  return Math.max(0, Math.min(1, (leftValue + rightValue) / 2));
}

// Use a shared surface fact only when the pair has a defensible common location.
function buildSocialPairLocation(left, right) {
  const leftX = Number(left && left.x);
  const leftY = Number(left && left.y);
  const rightX = Number(right && right.x);
  const rightY = Number(right && right.y);
  const hasSharedCoordinates = Number.isSafeInteger(leftX)
    && leftX >= 0
    && Number.isSafeInteger(leftY)
    && leftY >= 0
    && leftX === rightX
    && leftY === rightY;
  if (hasSharedCoordinates) {
    return {
      scope: 'surface',
      depth: 0,
      x: leftX,
      y: leftY,
      placeId: left && left.homeId ? String(left.homeId) : null,
      label: null,
    };
  }
  const leftHomeId = String(left && left.homeId || '');
  const rightHomeId = String(right && right.homeId || '');
  if (leftHomeId && leftHomeId === rightHomeId) {
    return {
      scope: 'surface',
      depth: 0,
      x: null,
      y: null,
      placeId: leftHomeId,
      label: null,
    };
  }
  return { scope: 'world' };
}

// Resolve actor order and roles without inferring an instigator for symmetric incidents.
function buildSocialActors(state, config, incidentType, pair, mentorId) {
  const left = pair && pair.left;
  const right = pair && pair.right;
  if (incidentType === 'mentorship_breakthrough') {
    const mentor = String(left && left.id || '') === String(mentorId || '') ? left : right;
    const mentee = mentor === left ? right : left;
    return [
      buildDwarfActor(state, config, mentor, 'primary'),
      buildDwarfActor(state, config, mentee, 'beneficiary'),
    ].filter(Boolean);
  }
  const roles = incidentType === 'reconciliation'
    ? ['primary', 'secondary']
    : ['primary', 'opponent'];
  return [
    buildDwarfActor(state, config, left, roles[0]),
    buildDwarfActor(state, config, right, roles[1]),
  ].filter(Boolean);
}

// Build the minimum typed outcome facts that make each social incident replayable.
function buildSocialConsequences(incidentType, pair, mentorId) {
  const leftId = String(pair && pair.left && pair.left.id || '');
  const rightId = String(pair && pair.right && pair.right.id || '');
  const consequence = (targetId, metric, value, kind = 'status') => ({
    kind,
    targetKind: 'dwarf',
    targetId,
    metric,
    value,
    unit: typeof value === 'number' ? 'ratio' : null,
  });
  if (incidentType === 'mentorship_breakthrough') {
    const mentor = leftId === String(mentorId || '') ? leftId : rightId;
    const mentee = mentor === leftId ? rightId : leftId;
    return [
      consequence(mentee, 'mentor_id', mentor),
      consequence(mentee, 'mentorship', resolvePairLinkValue(pair, 'mentorship'), 'progress'),
    ];
  }
  if (incidentType === 'rivalry_clash') {
    const rivalry = resolvePairLinkValue(pair, 'rivalry');
    return [
      consequence(leftId, 'rivalry', rivalry),
      consequence(rightId, 'rivalry', rivalry),
    ];
  }
  if (incidentType === 'grudge_escalation') {
    const grudge = resolvePairLinkValue(pair, 'grudge');
    return [
      consequence(leftId, 'grudge', grudge),
      consequence(rightId, 'grudge', grudge),
    ];
  }
  const rivalry = resolvePairLinkValue(pair, 'rivalry');
  const grudge = resolvePairLinkValue(pair, 'grudge');
  return [
    consequence(leftId, 'rivalry', rivalry, 'progress'),
    consequence(rightId, 'rivalry', rivalry, 'progress'),
    consequence(leftId, 'grudge', grudge, 'progress'),
    consequence(rightId, 'grudge', grudge, 'progress'),
  ];
}

// Emit one structured social-incident fact after its existing gameplay effects commit.
function emitSocialIncidentEvent(state, config, incident) {
  const incidentType = String(incident && incident.type || '');
  const definition = SOCIAL_EVENT_TYPES[incidentType];
  const pair = incident && incident.pair;
  const message = String(incident && incident.message || '');
  if (!definition || !pair || !pair.left || !pair.right || !message) {
    return null;
  }
  const leftId = String(pair.left.id || '');
  const rightId = String(pair.right.id || '');
  const mentorId = String(incident.mentorId || '');
  if (!leftId || !rightId || leftId === rightId) {
    return null;
  }
  if (
    incidentType === 'mentorship_breakthrough'
    && mentorId !== leftId
    && mentorId !== rightId
  ) {
    return null;
  }
  const metrics = pair.metrics && typeof pair.metrics === 'object' ? pair.metrics : {};
  const primaryValue = Number(metrics[definition.causeMetric]);
  const causes = [{
    kind: 'state',
    ref: 'population.social_drama',
    metric: definition.causeMetric,
    value: Number.isFinite(primaryValue) ? primaryValue : null,
  }];
  const stress = Number(metrics.stress);
  if (Number.isFinite(stress) && incidentType !== 'reconciliation') {
    causes.push({
      kind: 'state',
      ref: 'population.social_drama',
      metric: 'stress',
      value: stress,
    });
  }
  return pushEvent(state, config, {
    type: definition.type,
    category: 'social',
    message,
    actors: buildSocialActors(state, config, incidentType, pair, mentorId),
    location: buildSocialPairLocation(pair.left, pair.right),
    causes,
    consequences: buildSocialConsequences(incidentType, pair, mentorId),
    source: 'social_drama',
    tags: definition.tags,
  });
}

module.exports = {
  SOCIAL_EVENT_TYPES,
  buildSocialPairLocation,
  emitSocialIncidentEvent,
};
