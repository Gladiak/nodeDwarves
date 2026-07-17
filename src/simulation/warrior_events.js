'use strict';

const { pushEvent } = require('./events');
const { buildDwarfActor, buildDwarfLocation } = require('./lifecycle_events');

const HALL_OF_FAME_ID = 'warrior_hall_of_fame';

// Build one fallback-safe dwarf actor from a retained object or stable id.
function buildWarriorDwarfActor(state, config, dwarfOrId, role) {
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

// Resolve a last-known fighter location without retaining live state references.
function buildWarriorLocation(dwarf) {
  return dwarf && typeof dwarf === 'object' ? buildDwarfLocation(dwarf) : { scope: 'world' };
}

// Emit scar, title, or vow progression after the warrior payload is authoritative.
function emitWarriorMarkChanged(state, config, dwarf, change) {
  const kind = String(change && change.kind || '');
  const nextId = String(change && change.id || '');
  const previousId = String(change && change.previousId || '');
  const typeByKind = {
    scar: 'warrior.scar_earned',
    title: 'warrior.title_earned',
    vow_sworn: 'warrior.vow_sworn',
    vow_replaced: 'warrior.vow_replaced',
  };
  if (!dwarf || !dwarf.id || !typeByKind[kind] || !nextId) {
    return null;
  }
  const causes = [{
    kind: 'state',
    ref: 'warriors.progression',
    metric: 'source',
    value: String(change.source || 'progression'),
  }];
  if (previousId) {
    causes.push({
      kind: 'state',
      ref: 'warriors.vows',
      metric: 'previous_vow',
      value: previousId,
    });
  }
  return pushEvent(state, config, {
    type: typeByKind[kind],
    category: 'warrior',
    message: change.message,
    actors: [buildWarriorDwarfActor(state, config, dwarf, 'primary')].filter(Boolean),
    location: buildWarriorLocation(dwarf),
    causes,
    consequences: [{
      kind: 'status',
      targetKind: 'dwarf',
      targetId: String(dwarf.id),
      metric: kind.startsWith('vow_') ? 'vow' : kind,
      value: nextId,
      unit: null,
    }],
    source: 'warriors',
    tags: ['warrior_league', kind, nextId],
  });
}

// Emit retirement after champion and expedition eligibility state is cleared.
function emitWarriorRetired(state, config, dwarf, details) {
  if (!dwarf || !dwarf.id) {
    return null;
  }
  return pushEvent(state, config, {
    type: 'warrior.retired',
    category: 'warrior',
    message: details.message,
    actors: [buildWarriorDwarfActor(state, config, dwarf, 'primary')].filter(Boolean),
    location: buildWarriorLocation(dwarf),
    causes: [{
      kind: 'state',
      ref: 'warriors.tournament_consequences',
      metric: 'reason',
      value: String(details.reason || 'injury'),
    }],
    consequences: [{
      kind: 'status',
      targetKind: 'dwarf',
      targetId: String(dwarf.id),
      metric: 'warrior_retired',
      value: true,
      unit: null,
    }],
    source: 'warriors',
    tags: ['warrior_league', 'retirement'],
  });
}

// Emit Underrealm command synchronization or relinquishment caused by league state.
function emitWarriorUnderrealmCommandChanged(state, config, dwarf, details) {
  const relinquished = details && details.mode === 'relinquished';
  const dwarfId = String(dwarf && dwarf.id || details && details.dwarfId || '');
  if (!dwarfId) {
    return null;
  }
  return pushEvent(state, config, {
    type: relinquished
      ? 'warrior.underrealm_command_relinquished'
      : 'warrior.underrealm_command_synced',
    category: 'warrior',
    message: details.message,
    actors: [buildWarriorDwarfActor(state, config, dwarf || dwarfId, relinquished ? 'primary' : 'leader')]
      .filter(Boolean),
    location: { scope: 'world' },
    causes: [{
      kind: 'state',
      ref: relinquished ? 'warriors.retirement' : 'warriors.tournament_champion',
      metric: 'command_sync',
      value: relinquished ? 'relinquished' : 'active',
    }],
    consequences: [{
      kind: 'status',
      targetKind: 'dwarf',
      targetId: dwarfId,
      metric: 'underrealm_dwarf_champion',
      value: relinquished ? 'inactive' : 'active',
      unit: null,
    }],
    source: 'warriors',
    tags: ['warrior_league', 'underrealm_command', relinquished ? 'relinquished' : 'synced'],
  });
}

// Emit a hero succession after the Underrealm command transfer commits.
function emitWarriorHeroCommandTaken(state, config, winner, loser, message) {
  if (!winner || !winner.id || !loser || !loser.id) {
    return null;
  }
  return pushEvent(state, config, {
    type: 'warrior.hero_command_taken',
    category: 'warrior',
    message,
    actors: [
      buildWarriorDwarfActor(state, config, winner, 'leader'),
      buildWarriorDwarfActor(state, config, loser, 'opponent'),
    ].filter(Boolean),
    location: { scope: 'world' },
    causes: [{
      kind: 'action',
      ref: 'warriors.champion_challenge',
      metric: 'defeated_champion_id',
      value: String(loser.id),
    }],
    consequences: [{
      kind: 'status',
      targetKind: 'dwarf',
      targetId: String(winner.id),
      metric: 'underrealm_dwarf_champion',
      value: 'active',
      unit: null,
    }],
    source: 'warriors',
    tags: ['warrior_league', 'hero_succession'],
  });
}

// Emit one committed tournament injury with bounded recovery facts.
function emitWarriorTournamentInjury(state, config, dwarf, details) {
  if (!dwarf || !dwarf.id) {
    return null;
  }
  const severity = String(details.severity || 'light');
  return pushEvent(state, config, {
    type: 'warrior.tournament_injury',
    category: 'warrior',
    message: details.message,
    actors: [buildWarriorDwarfActor(state, config, dwarf, 'victim')].filter(Boolean),
    location: buildWarriorLocation(dwarf),
    causes: [{
      kind: 'action',
      ref: 'warriors.tournament_duel',
      metric: 'severity',
      value: severity,
    }],
    consequences: [{
      kind: 'injury',
      targetKind: 'dwarf',
      targetId: String(dwarf.id),
      metric: 'recovery_ticks',
      value: Math.max(0, Math.floor(Number(details.recoveryTicks || 0))),
      unit: 'ticks',
    }],
    source: 'warriors',
    tags: ['warrior_league', 'injury', severity],
  });
}

// Emit a tournament death only after authoritative population cleanup.
function emitWarriorTournamentDeath(state, config, dwarf, message) {
  if (!dwarf || !dwarf.id) {
    return null;
  }
  return pushEvent(state, config, {
    type: 'warrior.tournament_death',
    category: 'warrior',
    message,
    actors: [buildWarriorDwarfActor(state, config, dwarf, 'victim')].filter(Boolean),
    location: buildWarriorLocation(dwarf),
    causes: [{
      kind: 'action',
      ref: 'warriors.tournament_duel',
      metric: 'outcome',
      value: 'fatal',
    }],
    consequences: [{
      kind: 'death',
      targetKind: 'dwarf',
      targetId: String(dwarf.id),
      metric: 'cause',
      value: 'warrior_league',
      unit: null,
    }],
    source: 'warriors',
    tags: ['warrior_league', 'tournament', 'death'],
  });
}

// Emit tournament crown and Hall of Fame induction after all league state commits.
function emitWarriorTournamentCrowned(state, config, result) {
  const champion = result && result.champion;
  const championId = String(champion && champion.id || '');
  if (!championId) {
    return null;
  }
  const seasonId = Math.max(0, Math.floor(Number(result.seasonId || 0)));
  const actors = [buildWarriorDwarfActor(state, config, champion, 'primary')];
  if (result.previousChampionId && String(result.previousChampionId) !== championId) {
    actors.push(buildWarriorDwarfActor(state, config, result.previousChampionId, 'opponent'));
  }
  return pushEvent(state, config, {
    type: 'warrior.tournament_champion_crowned',
    category: 'warrior',
    message: result.message,
    actors: actors.filter(Boolean),
    location: { scope: 'world' },
    causes: [
      {
        kind: 'state',
        ref: 'warriors.tournament',
        metric: 'season_id',
        value: seasonId,
      },
      {
        kind: 'state',
        ref: 'warriors.tournament',
        metric: 'participants',
        value: Math.max(0, Math.floor(Number(result.participantCount || 0))),
      },
    ],
    consequences: [
      {
        kind: 'status',
        targetKind: 'dwarf',
        targetId: championId,
        metric: 'league_champion',
        value: 'active',
        unit: null,
      },
      {
        kind: 'status',
        targetKind: 'institution',
        targetId: HALL_OF_FAME_ID,
        metric: 'inducted_dwarf_id',
        value: championId,
        unit: null,
      },
    ],
    source: 'warriors',
    tags: ['warrior_league', 'tournament', 'champion', 'hall_of_fame'],
  });
}

module.exports = {
  emitWarriorMarkChanged,
  emitWarriorRetired,
  emitWarriorUnderrealmCommandChanged,
  emitWarriorHeroCommandTaken,
  emitWarriorTournamentInjury,
  emitWarriorTournamentDeath,
  emitWarriorTournamentCrowned,
};
