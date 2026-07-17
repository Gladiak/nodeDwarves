'use strict';

const { pushEvent } = require('./events');

const SETTLEMENT_ID = 'settlement_main';
const SETTLEMENT_LABEL = 'First Hold';
const CYCLE_SYSTEM_ID = 'dwarven_cycle';

// Build the stable settlement actor shared by endgame facts.
function buildSettlementActor(role = 'primary') {
  return {
    kind: 'settlement',
    id: SETTLEMENT_ID,
    role,
    label: SETTLEMENT_LABEL,
  };
}

// Build one saga id for the cycle that is closing or transitioning.
function buildEndgameSagaId(sourceCycle) {
  const cycle = Math.max(0, Math.floor(Number(sourceCycle || 0)));
  return `endgame_cycle_${String(cycle).padStart(4, '0')}`;
}

// Emit an artifact recovery after the ruins collection and counters commit.
function emitEndgameArtifactRecovered(state, config, details) {
  const artifactId = String(details && details.artifactId || 'unknown_artifact');
  const artifactName = String(details && details.artifactName || artifactId);
  const depth = Math.max(1, Math.floor(Number(details && details.depth || 1)));
  const foundCount = Math.max(0, Math.floor(Number(details && details.foundCount || 0)));
  const totalCount = Math.max(foundCount, Math.floor(Number(details && details.totalCount || 0)));
  return pushEvent(state, config, {
    type: 'endgame.artifact_recovered',
    category: 'underrealm',
    message: details && details.message,
    actors: [{
      kind: 'artifact',
      id: artifactId,
      role: 'primary',
      label: artifactName,
    }],
    location: {
      scope: 'underrealm',
      depth,
    },
    causes: [
      {
        kind: 'action',
        ref: 'ruins.expedition_resolution',
        metric: 'artifact_roll',
        value: 'success',
      },
      {
        kind: 'state',
        ref: 'ruins.artifact_pool',
        metric: 'configured_artifacts',
        value: totalCount,
      },
    ],
    consequences: [
      {
        kind: 'status',
        targetKind: 'artifact',
        targetId: artifactId,
        metric: 'recovered',
        value: true,
        unit: null,
      },
      {
        kind: 'progress',
        targetKind: 'settlement',
        targetId: SETTLEMENT_ID,
        metric: 'artifacts_recovered',
        value: foundCount,
        unit: 'artifacts',
      },
    ],
    source: 'ruins',
    tags: ['endgame', 'artifact', 'recovered', artifactId],
  });
}

// Emit the one-shot latch that starts the configured endgame waiting window.
function emitEndgameArtifactCollectionCompleted(state, config, details) {
  const artifactCount = Math.max(0, Math.floor(Number(details && details.artifactCount || 0)));
  const sourceCycle = Math.max(0, Math.floor(Number(
    state && state.cycleStats && state.cycleStats.count || 0,
  )));
  return pushEvent(state, config, {
    type: 'endgame.artifact_collection_completed',
    category: 'lifecycle',
    message: `Endgame: all ${artifactCount} relics secured; the cycle passage is armed`,
    actors: [buildSettlementActor()],
    location: { scope: 'world' },
    causes: [{
      kind: 'threshold',
      ref: 'endgame.artifact_collection',
      metric: 'artifacts_recovered',
      value: artifactCount,
    }],
    consequences: [{
      kind: 'status',
      targetKind: 'system',
      targetId: CYCLE_SYSTEM_ID,
      metric: 'passage_armed',
      value: true,
      unit: null,
    }],
    sagaId: buildEndgameSagaId(sourceCycle),
    source: 'endgame',
    tags: ['endgame', 'artifacts', 'collection_complete'],
  });
}

// Emit the committed presentation transition start before the old hold fades out.
function emitEndgameTransitionStarted(state, config, details) {
  const sourceCycle = Math.max(0, Math.floor(Number(details && details.sourceCycle || 0)));
  return pushEvent(state, config, {
    type: 'endgame.transition_started',
    category: 'lifecycle',
    message: `Endgame transition: hold ${sourceCycle + 1} prepares to depart`,
    actors: [buildSettlementActor()],
    location: { scope: 'world' },
    causes: [{
      kind: 'state',
      ref: 'endgame.artifact_collection',
      metric: 'passage_armed',
      value: true,
    }],
    consequences: [{
      kind: 'status',
      targetKind: 'system',
      targetId: CYCLE_SYSTEM_ID,
      metric: 'transition_phase',
      value: 'fade_out',
      unit: null,
    }],
    sagaId: buildEndgameSagaId(sourceCycle),
    source: 'app',
    tags: ['endgame', 'transition', 'started'],
  });
}

// Emit cycle closure after the replacement state owns its final cycle identity.
function emitEndgameCycleClosed(state, config, summary) {
  const sourceCycle = Math.max(0, Math.floor(Number(summary && summary.sourceCycle || 0)));
  const completedCycles = Math.max(sourceCycle + 1, Math.floor(Number(
    summary && summary.completedCycles || 0,
  )));
  const completedTicks = Math.max(0, Math.floor(Number(summary && summary.completedTicks || 0)));
  const artifactCount = Math.max(0, Math.floor(Number(summary && summary.artifactCount || 0)));
  return pushEvent(state, config, {
    type: 'endgame.cycle_closed',
    category: 'lifecycle',
    message: `Endgame: cycle ${completedCycles} closed after ${completedTicks} ticks; a new hold begins`,
    actors: [buildSettlementActor()],
    location: { scope: 'world' },
    causes: [
      {
        kind: 'state',
        ref: 'endgame.artifact_collection',
        metric: 'artifacts_recovered',
        value: artifactCount,
      },
      {
        kind: 'state',
        ref: 'endgame.previous_cycle',
        metric: 'duration_ticks',
        value: completedTicks,
      },
    ],
    consequences: [{
      kind: 'progress',
      targetKind: 'system',
      targetId: CYCLE_SYSTEM_ID,
      metric: 'cycles_completed',
      value: completedCycles,
      unit: 'cycles',
    }],
    sagaId: buildEndgameSagaId(sourceCycle),
    source: 'endgame',
    tags: ['endgame', 'cycle', 'closed'],
  });
}

// Emit the existing Warrior Company carry-over summary after the new cycle commits.
function emitEndgameWarriorCompanyCarriedOver(state, config, summary) {
  if (!summary || summary.applied !== true || Number(summary.seedBonus) <= 0) {
    return null;
  }
  const retainedRenown = Math.max(0, Math.min(1, Number(summary.retainedRenown || 0)));
  const seedBonus = Math.max(0, Math.min(1, Number(summary.seedBonus || 0)));
  const sourceCycle = Math.max(0, Math.floor(Number(summary.sourceCycle || 0)));
  const actors = [{
    kind: 'institution',
    id: 'warrior_company',
    role: 'primary',
    label: summary.companyName ? String(summary.companyName) : 'Warrior Company',
  }];
  if (summary.sourceChampionId) {
    actors.push({
      kind: 'dwarf',
      id: String(summary.sourceChampionId),
      role: 'founder',
    });
  }
  return pushEvent(state, config, {
    type: 'endgame.warrior_company_carried_over',
    category: 'warrior',
    message: `Warrior Company carry-over: retained ${(retainedRenown * 100).toFixed(1)}% renown (${(seedBonus * 100).toFixed(1)}% startup seed)`,
    actors,
    location: { scope: 'world' },
    causes: [{
      kind: 'state',
      ref: 'warriors.company_legacy',
      metric: 'retained_renown',
      value: retainedRenown,
    }],
    consequences: [{
      kind: 'status',
      targetKind: 'institution',
      targetId: 'warrior_company',
      metric: 'startup_seed',
      value: seedBonus,
      unit: 'ratio',
    }],
    sagaId: buildEndgameSagaId(sourceCycle),
    source: 'endgame',
    tags: ['endgame', 'warrior_company', 'carry_over'],
  });
}

// Emit the final presentation commit after fade-in reaches its terminal phase.
function emitEndgameTransitionCompleted(state, config, details) {
  const sourceCycle = Math.max(0, Math.floor(Number(details && details.sourceCycle || 0)));
  const completedCycles = Math.max(0, Math.floor(Number(
    state && state.cycleStats && state.cycleStats.count || 0,
  )));
  return pushEvent(state, config, {
    type: 'endgame.transition_completed',
    category: 'lifecycle',
    message: `Endgame transition complete: hold ${completedCycles + 1} stands revealed`,
    actors: [buildSettlementActor()],
    location: { scope: 'world' },
    causes: [{
      kind: 'state',
      ref: 'endgame.transition',
      metric: 'previous_phase',
      value: 'fade_in',
    }],
    consequences: [{
      kind: 'status',
      targetKind: 'system',
      targetId: CYCLE_SYSTEM_ID,
      metric: 'transition_phase',
      value: 'complete',
      unit: null,
    }],
    sagaId: buildEndgameSagaId(sourceCycle),
    source: 'app',
    tags: ['endgame', 'transition', 'completed'],
  });
}

module.exports = {
  buildEndgameSagaId,
  emitEndgameArtifactRecovered,
  emitEndgameArtifactCollectionCompleted,
  emitEndgameTransitionStarted,
  emitEndgameCycleClosed,
  emitEndgameWarriorCompanyCarriedOver,
  emitEndgameTransitionCompleted,
};
