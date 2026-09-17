'use strict';

const { pushEvent } = require('./events');
const { buildDwarfActor } = require('./lifecycle_events');
const { formatNamedEventMessage } = require('../dwarf_identity');
const { buildPlaceLocation, resolvePlaceLabel } = require('../place_identity');

const SETTLEMENT_ID = 'settlement_main';
const SETTLEMENT_LABEL = 'First Hold';

// Build one fallback-safe dwarf actor from a live object or stable id.
function buildCombatDwarfActor(state, config, dwarfOrId, role) {
  if (dwarfOrId && typeof dwarfOrId === 'object') {
    return buildDwarfActor(state, config, dwarfOrId, role);
  }
  const id = String(dwarfOrId || '');
  if (!id) {
    return null;
  }
  const live = (Array.isArray(state && state.dwarves) ? state.dwarves : [])
    .find((dwarf) => String(dwarf && dwarf.id || '') === id);
  return live
    ? buildDwarfActor(state, config, live, role)
    : { kind: 'dwarf', id, role };
}

// Build bounded dwarf actor references while retaining caller ordering.
function buildCombatDwarfActors(state, config, dwarves, role, limit = 7) {
  return (Array.isArray(dwarves) ? dwarves : [])
    .slice(0, Math.max(0, limit))
    .map((dwarf) => buildCombatDwarfActor(state, config, dwarf, role))
    .filter(Boolean);
}

// Build one canonical Underrealm location for combat at a known depth.
function buildUnderrealmCombatLocation(depthRaw, state) {
  const depth = Math.max(1, Math.floor(Number(depthRaw || 1)));
  return buildPlaceLocation(state, `ruins_d${depth}`, {
    scope: 'underrealm',
    depth,
    x: null,
    y: null,
    placeId: `ruins_d${depth}`,
    label: `Underrealm Depth ${depth}`,
  });
}

// Normalize one positive resource-loss map into bounded transfer consequences.
function buildResourceLossConsequences(losses, limit = 5) {
  return Object.entries(losses && typeof losses === 'object' ? losses : {})
    .filter(([, value]) => Number(value) > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, Math.max(0, limit))
    .map(([resourceId, value]) => ({
      kind: 'transfer',
      targetKind: 'resource',
      targetId: resourceId,
      metric: 'stolen',
      value: Number(value),
      unit: 'units',
    }));
}

// Emit the start of one surface beast raid after raid state is authoritative.
function emitSurfaceRaidStarted(state, config, raidState, message) {
  const beasts = Array.isArray(raidState && raidState.beasts) ? raidState.beasts : [];
  return pushEvent(state, config, {
    type: 'combat.surface_raid_started',
    category: 'combat',
    message,
    actors: [{
      kind: 'threat',
      id: 'valley_beast_raid',
      role: 'instigator',
      label: 'Valley Beasts',
    }],
    location: { scope: 'world' },
    causes: [
      {
        kind: 'state',
        ref: 'raids.seasonal_pressure',
        metric: 'beast_count',
        value: beasts.length,
      },
      {
        kind: 'state',
        ref: 'raids.seasonal_pressure',
        metric: 'duration_ticks',
        value: Math.max(0, Number(raidState && raidState.duration || 0)),
      },
    ],
    consequences: [{
      kind: 'status',
      targetKind: 'settlement',
      targetId: SETTLEMENT_ID,
      metric: 'surface_raid_active',
      value: true,
      unit: null,
    }],
    source: 'raids',
    tags: ['surface_raid', 'started'],
  });
}

// Emit one surface raid outcome with retained victim and resource-loss facts.
function emitSurfaceRaidResolved(state, config, outcome) {
  const victims = Array.isArray(outcome && outcome.victims) ? outcome.victims : [];
  const raidDeaths = Math.max(0, Number(outcome && outcome.raidDeaths || victims.length));
  const consequences = [{
    kind: 'status',
    targetKind: 'settlement',
    targetId: SETTLEMENT_ID,
    metric: 'surface_raid_casualties',
    value: raidDeaths,
    unit: 'dwarves',
  }];
  for (const victim of victims.slice(0, 5)) {
    consequences.push({
      kind: 'death',
      targetKind: 'dwarf',
      targetId: String(victim.id),
      metric: 'cause',
      value: 'surface_raid',
      unit: null,
    });
  }
  consequences.push(...buildResourceLossConsequences(outcome && outcome.stolen, 5));
  return pushEvent(state, config, {
    type: 'combat.surface_raid_resolved',
    category: 'combat',
    message: outcome.message,
    actors: [
      {
        kind: 'settlement',
        id: SETTLEMENT_ID,
        role: 'primary',
        label: SETTLEMENT_LABEL,
      },
      ...buildCombatDwarfActors(state, config, victims, 'victim', 7),
    ],
    location: { scope: 'world' },
    causes: [
      {
        kind: 'state',
        ref: 'raids.resolution',
        metric: 'difficulty',
        value: Number(outcome.difficulty),
      },
      {
        kind: 'state',
        ref: 'raids.resolution',
        metric: 'defense',
        value: Number(outcome.defense),
      },
    ],
    consequences,
    source: 'raids',
    tags: raidDeaths > 0 ? ['surface_raid', 'resolved', 'casualties'] : ['surface_raid', 'resolved'],
  });
}

// Emit a ruins expedition dispatch with its party and readiness evidence.
function emitRuinsExpeditionStarted(state, config, expedition, message) {
  const depth = Math.max(1, Number(expedition && expedition.readiness && expedition.readiness.depth || 1));
  const dwarfIds = Array.isArray(expedition && expedition.dwarfIds) ? expedition.dwarfIds : [];
  const expeditionId = `ruins_expedition_d${depth}`;
  const ruinsName = resolvePlaceLabel(state, `ruins_d${depth}`, `Ruins Depth ${depth}`);
  return pushEvent(state, config, {
    type: 'combat.ruins_expedition_started',
    category: 'combat',
    message: String(message || '').replace(/Ruins(?: Depth)? D?\d*/g, ruinsName),
    actors: [
      {
        kind: 'institution',
        id: expeditionId,
        role: 'primary',
        label: `${ruinsName} Expedition`,
      },
      ...buildCombatDwarfActors(state, config, dwarfIds, 'member', 7),
    ],
    location: buildUnderrealmCombatLocation(depth, state),
    causes: [
      {
        kind: 'action',
        ref: 'ruins.expedition_dispatch',
        metric: 'party_size',
        value: dwarfIds.length,
      },
      {
        kind: 'state',
        ref: 'ruins.readiness',
        metric: 'score',
        value: Number(expedition && expedition.readiness && expedition.readiness.score || 0),
      },
    ],
    consequences: [{
      kind: 'status',
      targetKind: 'institution',
      targetId: expeditionId,
      metric: 'expedition_active',
      value: true,
      unit: null,
    }],
    source: 'ruins',
    tags: ['ruins', 'expedition', 'started'],
  });
}

// Emit a resolved ruins expedition after success/failure and casualties are authoritative.
function emitRuinsExpeditionResolved(state, config, outcome) {
  const expedition = outcome && outcome.expedition;
  const depth = Math.max(1, Number(expedition && expedition.readiness && expedition.readiness.depth || 1));
  const party = Array.isArray(outcome && outcome.party) ? outcome.party : [];
  const victims = Array.isArray(outcome && outcome.victims) ? outcome.victims : [];
  const success = outcome && outcome.success === true;
  const expeditionId = `ruins_expedition_d${depth}`;
  const ruinsName = resolvePlaceLabel(state, `ruins_d${depth}`, `Ruins Depth ${depth}`);
  const consequences = [{
    kind: 'status',
    targetKind: 'institution',
    targetId: expeditionId,
    metric: 'outcome',
    value: success ? 'success' : String(outcome.reason || 'failure'),
    unit: null,
  }];
  for (const victim of victims.slice(0, 7)) {
    consequences.push({
      kind: 'death',
      targetKind: 'dwarf',
      targetId: String(victim.id),
      metric: 'cause',
      value: 'ruins_expedition',
      unit: null,
    });
  }
  return pushEvent(state, config, {
    type: success ? 'combat.ruins_expedition_succeeded' : 'combat.ruins_expedition_failed',
    category: 'combat',
    message: String(outcome.message || '').replace(/Ruins(?: Depth)? D?\d*/g, ruinsName),
    actors: [
      {
        kind: 'institution',
        id: expeditionId,
        role: 'primary',
        label: `${ruinsName} Expedition`,
      },
      ...buildCombatDwarfActors(state, config, victims, 'victim', 4),
      ...buildCombatDwarfActors(state, config, party, 'member', Math.max(0, 7 - victims.length)),
    ].slice(0, 8),
    location: buildUnderrealmCombatLocation(depth, state),
    causes: [{
      kind: 'state',
      ref: 'ruins.expedition_resolution',
      metric: 'reason',
      value: String(outcome.reason || (success ? 'clear' : 'failure')),
    }],
    consequences,
    source: 'ruins',
    tags: success ? ['ruins', 'expedition', 'victory'] : ['ruins', 'expedition', 'defeat'],
  });
}

// Emit a deterministic depth-champion battle outcome.
function emitUnderrealmChampionEncounter(state, config, encounter) {
  const outcome = String(encounter && encounter.outcome || 'retreat');
  const victory = outcome === 'victory';
  const depth = Math.max(1, Number(encounter && encounter.depth || 1));
  const dwarfIds = Array.isArray(encounter && encounter.dwarfIds) ? encounter.dwarfIds : [];
  const threatId = `depth_champion_${depth}`;
  const consequences = victory
    ? [{
      kind: 'destroy',
      targetKind: 'threat',
      targetId: threatId,
      metric: 'combat_outcome',
      value: 'defeated',
      unit: null,
    }]
    : [{
      kind: 'status',
      targetKind: 'location',
      targetId: `underrealm_depth_${depth}`,
      metric: 'champion_state',
      value: 'contested',
      unit: null,
    }];
  if (victory && Number(encounter.unlockedDepth) > depth) {
    consequences.push({
      kind: 'unlock',
      targetKind: 'location',
      targetId: `underrealm_depth_${Math.floor(Number(encounter.unlockedDepth))}`,
      metric: 'depth',
      value: Math.floor(Number(encounter.unlockedDepth)),
      unit: null,
    });
  }
  return pushEvent(state, config, {
    type: victory ? 'combat.underrealm_champion_defeated' : 'combat.underrealm_champion_setback',
    category: 'combat',
    message: encounter.message,
    actors: [
      {
        kind: 'threat',
        id: threatId,
        role: 'opponent',
        label: String(encounter.championLabel || `Depth Champion D${depth}`),
      },
      ...buildCombatDwarfActors(state, config, dwarfIds, 'member', 7),
    ],
    location: buildUnderrealmCombatLocation(depth, state),
    causes: [{
      kind: 'state',
      ref: 'underrealm.champion_encounter',
      metric: 'outcome',
      value: outcome,
    }],
    consequences,
    source: 'ruins',
    tags: ['underrealm', 'champion', victory ? 'victory' : outcome],
  });
}

// Emit an appointment, coronation, or fall of the active Dwarf Champion.
function emitDwarfChampionChanged(state, config, change) {
  const fallen = change && change.mode === 'fallen';
  const dwarf = change && change.dwarf;
  const dwarfId = String(dwarf && dwarf.id || change && change.dwarfId || '');
  if (!dwarfId) {
    return null;
  }
  return pushEvent(state, config, {
    type: fallen ? 'combat.dwarf_champion_fallen' : 'combat.dwarf_champion_appointed',
    category: 'combat',
    message: formatNamedEventMessage(change.message, [dwarf || dwarfId], state, config),
    actors: [buildCombatDwarfActor(state, config, dwarf || dwarfId, fallen ? 'victim' : 'leader')]
      .filter(Boolean),
    location: Number(change.depth) > 0
      ? buildUnderrealmCombatLocation(change.depth, state)
      : { scope: 'world' },
    causes: [{
      kind: 'state',
      ref: 'underrealm.dwarf_champion',
      metric: fallen ? 'status' : 'survivals',
      value: fallen ? 'fallen' : Math.max(0, Number(dwarf && dwarf.underrealmChampionSurvivals || 0)),
    }],
    consequences: [{
      kind: 'status',
      targetKind: 'dwarf',
      targetId: dwarfId,
      metric: 'dwarf_champion',
      value: fallen ? 'fallen' : 'active',
      unit: null,
    }],
    source: String(change.source || 'underrealm'),
    tags: ['underrealm', 'dwarf_champion', fallen ? 'fallen' : String(change.mode || 'appointed')],
  });
}

// Emit deep-raid start, casualty, or resolution facts at one Underrealm depth.
function emitDeepRaidEvent(state, config, phase, raid, details = {}) {
  const depth = Math.max(1, Number(raid && raid.depth || 1));
  const factionId = String(raid && raid.factionId || `deep_faction_${depth}`);
  const victims = Array.isArray(details.victims) ? details.victims : [];
  const typeByPhase = {
    started: 'combat.deep_raid_started',
    casualties: 'combat.deep_raid_casualties',
    resolved: 'combat.deep_raid_resolved',
  };
  const consequences = [];
  if (phase === 'started') {
    consequences.push({
      kind: 'status',
      targetKind: 'location',
      targetId: `underrealm_depth_${depth}`,
      metric: 'deep_raid_active',
      value: true,
      unit: null,
    });
  } else if (phase === 'casualties') {
    for (const victim of victims.slice(0, 7)) {
      consequences.push({
        kind: 'death',
        targetKind: 'dwarf',
        targetId: String(victim.id),
        metric: 'cause',
        value: 'deep_raid',
        unit: null,
      });
    }
  } else {
    consequences.push({
      kind: 'status',
      targetKind: 'location',
      targetId: `underrealm_depth_${depth}`,
      metric: 'deep_raid_active',
      value: false,
      unit: null,
    });
    consequences.push(...buildResourceLossConsequences(raid && raid.losses, 5));
  }
  return pushEvent(state, config, {
    type: typeByPhase[phase] || 'combat.deep_raid_resolved',
    category: 'combat',
    message: details.message,
    actors: [
      {
        kind: 'faction',
        id: factionId,
        role: phase === 'started' ? 'instigator' : 'opponent',
        label: String(raid && raid.factionLabel || factionId),
      },
      ...buildCombatDwarfActors(state, config, victims, 'victim', 7),
    ],
    location: buildUnderrealmCombatLocation(depth, state),
    causes: [{
      kind: 'state',
      ref: 'underrealm.deep_raid',
      metric: 'strength',
      value: Math.max(0, Number(raid && raid.strength || 0)),
    }],
    consequences,
    source: 'underrealm',
    tags: ['underrealm', 'deep_raid', phase],
  });
}

module.exports = {
  buildUnderrealmCombatLocation,
  emitSurfaceRaidStarted,
  emitSurfaceRaidResolved,
  emitRuinsExpeditionStarted,
  emitRuinsExpeditionResolved,
  emitUnderrealmChampionEncounter,
  emitDwarfChampionChanged,
  emitDeepRaidEvent,
};
