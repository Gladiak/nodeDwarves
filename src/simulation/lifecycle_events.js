'use strict';

const { buildDwarfLore } = require('../dwarf_lore');
const { pushEvent } = require('./events');

const SETTLEMENT_ID = 'settlement_main';
const SETTLEMENT_LABEL = 'First Hold';

// Build one stable dwarf actor reference with a historical name snapshot.
function buildDwarfActor(state, config, dwarf, role) {
  if (!dwarf || !dwarf.id) {
    return null;
  }
  const lore = buildDwarfLore(dwarf, state, config);
  const label = lore && lore.name ? String(lore.name) : String(dwarf.id);
  return {
    kind: 'dwarf',
    id: String(dwarf.id),
    role,
    label,
  };
}

// Build a surface location from one dwarf position or fall back to world scope.
function buildDwarfLocation(dwarf) {
  const x = Number(dwarf && dwarf.x);
  const y = Number(dwarf && dwarf.y);
  if (!Number.isSafeInteger(x) || x < 0 || !Number.isSafeInteger(y) || y < 0) {
    return { scope: 'world' };
  }
  return {
    scope: 'surface',
    depth: 0,
    x,
    y,
    placeId: dwarf && dwarf.homeId ? String(dwarf.homeId) : null,
    label: null,
  };
}

// Emit one structured newborn fact after the dwarf exists in state.
function emitBirthEvent(state, config, newborn, parentA, parentB) {
  const actors = [
    buildDwarfActor(state, config, newborn, 'primary'),
    buildDwarfActor(state, config, parentA, 'parent'),
    buildDwarfActor(state, config, parentB, 'parent'),
  ].filter(Boolean);
  return pushEvent(state, config, {
    type: 'lifecycle.birth',
    category: 'lifecycle',
    message: `Birth: ${newborn.id}`,
    actors,
    location: buildDwarfLocation(newborn),
    causes: [{
      kind: 'state',
      ref: 'population.reproduction',
      metric: null,
      value: null,
    }],
    consequences: [{
      kind: 'create',
      targetKind: 'dwarf',
      targetId: String(newborn.id),
      metric: null,
      value: null,
      unit: null,
    }],
    source: 'population',
    tags: ['birth'],
  });
}

// Emit one structured natural-death fact using the dwarf's last known state.
function emitDeathEvent(state, config, dwarf, cause) {
  if (!dwarf || !dwarf.id) {
    return null;
  }
  const normalizedCause = cause === 'starvation' ? 'starvation' : 'old_age';
  const causeFact = normalizedCause === 'starvation'
    ? {
      kind: 'threshold',
      ref: 'needs.starvation',
      metric: 'starvation_ticks',
      value: Math.max(0, Number(dwarf.starvationTicks || 0)),
    }
    : {
      kind: 'state',
      ref: 'population.aging',
      metric: 'age_ticks',
      value: Math.max(0, Number(dwarf.ageTicks || 0)),
    };
  const messageCause = normalizedCause === 'starvation' ? 'starvation' : 'old age';
  return pushEvent(state, config, {
    type: 'lifecycle.death',
    category: 'lifecycle',
    message: `Death: ${dwarf.id} (${messageCause})`,
    actors: [buildDwarfActor(state, config, dwarf, 'victim')].filter(Boolean),
    location: buildDwarfLocation(dwarf),
    causes: [causeFact],
    consequences: [{
      kind: 'death',
      targetKind: 'dwarf',
      targetId: String(dwarf.id),
      metric: 'cause',
      value: normalizedCause,
      unit: null,
    }],
    source: 'population',
    tags: ['death', normalizedCause],
  });
}

// Emit one partnership fact after both dwarves reference each other.
function emitPartnershipEvent(state, config, dwarfA, dwarfB) {
  if (!dwarfA || !dwarfB || !dwarfA.id || !dwarfB.id) {
    return null;
  }
  return pushEvent(state, config, {
    type: 'lifecycle.partnership_formed',
    category: 'lifecycle',
    message: `Partnership: ${dwarfA.id} and ${dwarfB.id} formed a bond`,
    actors: [
      buildDwarfActor(state, config, dwarfA, 'primary'),
      buildDwarfActor(state, config, dwarfB, 'secondary'),
    ].filter(Boolean),
    location: buildDwarfLocation(dwarfA),
    causes: [{
      kind: 'action',
      ref: 'population.relationships.interaction',
      metric: 'bond_score',
      value: Math.min(Number(dwarfA.bondScore || 0), Number(dwarfB.bondScore || 0)),
    }],
    consequences: [
      {
        kind: 'status',
        targetKind: 'dwarf',
        targetId: String(dwarfA.id),
        metric: 'partner_id',
        value: String(dwarfB.id),
        unit: null,
      },
      {
        kind: 'status',
        targetKind: 'dwarf',
        targetId: String(dwarfB.id),
        metric: 'partner_id',
        value: String(dwarfA.id),
        unit: null,
      },
    ],
    source: 'population',
    tags: ['partnership'],
  });
}

// Emit one settlement founding fact exactly once per initialized cycle.
function ensureSettlementFoundingEvent(state, config) {
  state.lifecycle = state.lifecycle && typeof state.lifecycle === 'object'
    ? state.lifecycle
    : { foundingEmitted: false };
  if (state.lifecycle.foundingEmitted === true) {
    return null;
  }
  const dwarves = Array.isArray(state.dwarves) ? [...state.dwarves] : [];
  dwarves.sort((left, right) => {
    const spawnDelta = Number(left && left.spawnIndex || 0) - Number(right && right.spawnIndex || 0);
    return spawnDelta !== 0 ? spawnDelta : String(left && left.id || '').localeCompare(String(right && right.id || ''));
  });
  const founderActors = dwarves
    .slice(0, 7)
    .map((dwarf) => buildDwarfActor(state, config, dwarf, 'founder'))
    .filter(Boolean);
  const anchor = dwarves[0] || null;
  const event = pushEvent(state, config, {
    type: 'lifecycle.settlement_founded',
    category: 'lifecycle',
    message: `Founding: ${dwarves.length} dwarves established ${SETTLEMENT_LABEL}`,
    actors: [
      {
        kind: 'settlement',
        id: SETTLEMENT_ID,
        role: 'primary',
        label: SETTLEMENT_LABEL,
      },
      ...founderActors,
    ],
    location: buildDwarfLocation(anchor),
    causes: [{
      kind: 'state',
      ref: 'simulation.initialization',
      metric: 'founder_count',
      value: dwarves.length,
    }],
    consequences: [{
      kind: 'create',
      targetKind: 'settlement',
      targetId: SETTLEMENT_ID,
      metric: null,
      value: null,
      unit: null,
    }],
    source: 'population',
    tags: ['founding', 'settlement'],
  });
  if (event) {
    state.lifecycle.foundingEmitted = true;
  }
  return event;
}

module.exports = {
  buildDwarfActor,
  buildDwarfLocation,
  emitBirthEvent,
  emitDeathEvent,
  emitPartnershipEvent,
  ensureSettlementFoundingEvent,
};
