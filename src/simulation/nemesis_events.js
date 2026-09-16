'use strict';

const { pushEvent } = require('./events');
const { buildDwarfActor } = require('./lifecycle_events');

// Emit one canonical nemesis or siege fact into the persistent antagonist saga.
function emitNemesisEvent(state, config, nemesis, phase, details = {}) {
  if (!state || !nemesis || !phase) return null;
  const hero = details.hero || null;
  const actors = [
    {
      kind: 'threat',
      id: nemesis.id,
      role: phase === 'promoted' ? 'primary' : 'instigator',
      label: nemesis.displayName || nemesis.name || nemesis.id,
    },
    {
      kind: 'faction',
      id: nemesis.factionId || 'unknown_faction',
      role: 'secondary',
      label: nemesis.factionLabel || nemesis.factionId || 'Unknown Faction',
    },
  ];
  if (hero) {
    const actor = buildDwarfActor(state, config, hero, details.heroRole || 'opponent');
    if (actor) actors.push(actor);
  }
  actors.push({
    kind: 'settlement',
    id: 'settlement_main',
    role: phase === 'promoted' ? 'witness' : 'target',
    label: 'First Hold',
  });

  const location = normalizeLocation(details.location);
  const consequences = Array.isArray(details.consequences)
    ? details.consequences.slice(0, 12)
    : [{
      kind: 'status',
      targetKind: 'threat',
      targetId: nemesis.id,
      metric: 'phase',
      value: phase,
      unit: null,
    }];
  const causes = [];
  if (details.parentEventId) {
    causes.push({
      kind: 'event',
      ref: details.parentEventId,
      metric: 'precedes',
      value: phase,
    });
  }
  causes.push({
    kind: phase === 'promoted' || phase === 'reappeared' ? 'threshold' : 'state',
    ref: `epic_conflicts.${phase}`,
    metric: details.causeMetric || 'stage',
    value: details.causeValue === undefined ? phase : details.causeValue,
  });

  return pushEvent(state, config, {
    type: details.type || `nemesis.${phase}`,
    category: details.category || (phase === 'promoted' || phase === 'reappeared' ? 'world' : 'combat'),
    message: details.message || `${nemesis.displayName || nemesis.id}: ${phase}`,
    actors,
    location,
    causes,
    consequences,
    sagaId: nemesis.sagaId,
    source: 'epic_conflicts',
    tags: ['nemesis', phase, ...(Array.isArray(details.tags) ? details.tags : [])].slice(0, 32),
  });
}

function normalizeLocation(raw) {
  if (!raw || typeof raw !== 'object') return { scope: 'world' };
  const scope = raw.scope === 'underrealm' ? 'underrealm'
    : raw.scope === 'surface' ? 'surface' : 'world';
  if (scope === 'world') return { scope };
  const location = { scope };
  if (Number.isSafeInteger(raw.depth) && raw.depth >= 0) location.depth = raw.depth;
  if (Number.isSafeInteger(raw.x) && raw.x >= 0) location.x = raw.x;
  if (Number.isSafeInteger(raw.y) && raw.y >= 0) location.y = raw.y;
  if (raw.placeId) location.placeId = String(raw.placeId);
  if (raw.label) location.label = String(raw.label);
  return location;
}

module.exports = { emitNemesisEvent };
