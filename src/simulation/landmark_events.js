'use strict';

const {
  buildSecondaryActor,
  buildSecondaryLocation,
  buildSettlementActor,
  emitSecondaryEvent,
} = require('./secondary_events');

// Commit one landmark construction or condition transition as a structured fact.
function emitLandmarkEvent(state, config, landmark, phase, details = {}) {
  if (!state || !landmark || !phase) return null;
  const label = landmark.label || landmark.id;
  const actors = [
    buildSecondaryActor('structure', landmark.structureId || landmark.id, 'primary', label),
    buildSettlementActor('owner'),
  ];
  if (details.dwarf) {
    actors.push(buildSecondaryActor(
      'dwarf',
      details.dwarf.id,
      'builder',
      details.dwarf.name || details.dwarf.id,
    ));
  }
  return emitSecondaryEvent(state, config, {
    type: details.type || `landmark.${phase}`,
    category: details.category || 'development',
    message: details.message || `${label}: ${phase}`,
    actors,
    location: buildSecondaryLocation({
      id: landmark.placeId || landmark.id,
      x: landmark.site && landmark.site.x,
      y: landmark.site && landmark.site.y,
    }, label),
    causes: [{
      kind: phase === 'stage_completed' ? 'action' : 'state',
      ref: `landmarks.${landmark.id}`,
      metric: phase === 'stage_completed' ? 'construction' : 'condition',
      value: details.stage || landmark.condition || phase,
    }],
    consequences: [{
      kind: phase === 'stage_completed' ? 'progress' : 'status',
      targetKind: 'structure',
      targetId: landmark.structureId || landmark.id,
      metric: phase === 'stage_completed' ? 'stage' : 'condition',
      value: details.stage || landmark.condition || phase,
      unit: phase === 'stage_completed' ? 'stage' : null,
    }],
    source: 'landmarks',
    tags: ['landmark', landmark.kind || landmark.id, phase],
  });
}

module.exports = { emitLandmarkEvent };
