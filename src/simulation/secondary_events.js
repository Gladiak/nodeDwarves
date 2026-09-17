'use strict';

const { pushEvent } = require('./events');

const SETTLEMENT_ID = 'settlement_main';
const SETTLEMENT_LABEL = 'First Hold';

// Build a stable actor reference while allowing callers to omit optional labels.
function buildSecondaryActor(kind, id, role = 'primary', label = null) {
  const actor = { kind, id: String(id), role };
  if (label !== null && label !== undefined && String(label).trim()) {
    actor.label = String(label);
  }
  return actor;
}

// Build a surface location when committed coordinates exist, otherwise use world scope.
function buildSecondaryLocation(subject, label = null) {
  if (
    !subject
    || subject.x === null
    || subject.x === undefined
    || subject.y === null
    || subject.y === undefined
  ) {
    return { scope: 'world' };
  }
  const x = Number(subject && subject.x);
  const y = Number(subject && subject.y);
  if (!Number.isSafeInteger(x) || x < 0 || !Number.isSafeInteger(y) || y < 0) {
    return { scope: 'world' };
  }
  return {
    scope: 'surface',
    depth: 0,
    x,
    y,
    placeId: subject && subject.id ? String(subject.id) : null,
    label,
  };
}

// Convert a committed resource amount map into bounded typed delta facts.
function buildResourceConsequences(amounts, direction = 1) {
  return Object.entries(amounts || {})
    .filter(([, amount]) => Number.isFinite(Number(amount)) && Number(amount) !== 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 12)
    .map(([resourceId, amount]) => ({
      kind: 'delta',
      targetKind: 'resource',
      targetId: resourceId,
      metric: 'stockpile',
      value: Number(amount) * direction,
      unit: 'units',
    }));
}

// Emit one secondary-producer fact after its authoritative state transition commits.
function emitSecondaryEvent(state, config, draft) {
  const safeDraft = draft && typeof draft === 'object' ? draft : {};
  const source = String(safeDraft.source || 'simulation');
  const actors = Array.isArray(safeDraft.actors) && safeDraft.actors.length > 0
    ? safeDraft.actors
    : [buildSecondaryActor('system', source, 'primary', safeDraft.systemLabel || null)];
  const causes = Array.isArray(safeDraft.causes) && safeDraft.causes.length > 0
    ? safeDraft.causes
    : [{
      kind: 'state',
      ref: `${source}.runtime`,
      metric: safeDraft.causeMetric || 'phase',
      value: safeDraft.causeValue === undefined ? 'committed' : safeDraft.causeValue,
    }];
  const consequences = Array.isArray(safeDraft.consequences) && safeDraft.consequences.length > 0
    ? safeDraft.consequences
    : [{
      kind: 'status',
      targetKind: 'system',
      targetId: source,
      metric: safeDraft.resultMetric || 'event',
      value: safeDraft.resultValue === undefined ? safeDraft.type : safeDraft.resultValue,
      unit: null,
    }];
  return pushEvent(state, config, {
    ...safeDraft,
    actors,
    location: safeDraft.location || { scope: 'world' },
    causes,
    consequences,
    source,
  });
}

// Return the shared settlement actor used by development and economy facts.
function buildSettlementActor(role = 'primary') {
  return buildSecondaryActor('settlement', SETTLEMENT_ID, role, SETTLEMENT_LABEL);
}

module.exports = {
  SETTLEMENT_ID,
  SETTLEMENT_LABEL,
  buildResourceConsequences,
  buildSecondaryActor,
  buildSecondaryLocation,
  buildSettlementActor,
  emitSecondaryEvent,
};
