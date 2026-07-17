'use strict';

const { pushEvent } = require('./events');

const COUNCIL_ID = 'nine_braziers_council';
const COUNCIL_LABEL = 'Council of the Nine Braziers';
const SCHISM_ARC_ID = 'schism_arc';

// Build the shared political institution actor.
function buildCouncilActor(role = 'primary') {
  return {
    kind: 'institution',
    id: COUNCIL_ID,
    role,
    label: COUNCIL_LABEL,
  };
}

// Build bounded state evidence shared by political events.
function buildSchismStateCauses(schism) {
  return [
    {
      kind: 'state',
      ref: 'schism.pressure',
      metric: 'pressure',
      value: Math.max(0, Math.min(1, Number(schism && schism.pressure || 0))),
    },
    {
      kind: 'state',
      ref: 'schism.legitimacy',
      metric: 'legitimacy',
      value: Math.max(0, Math.min(1, Number(schism && schism.legitimacy || 0))),
    },
  ];
}

// Emit a doctrine change after doctrine, cooldown, and statistics commit.
function emitSchismDoctrineShifted(state, config, schism, details) {
  const doctrine = String(details && details.doctrine || 'austerity');
  return pushEvent(state, config, {
    type: 'schism.doctrine_shifted',
    category: 'schism',
    message: details.message,
    actors: [buildCouncilActor()],
    location: { scope: 'world' },
    causes: [
      ...buildSchismStateCauses(schism),
      {
        kind: 'state',
        ref: 'schism.doctrine',
        metric: 'previous_doctrine',
        value: String(details.previousDoctrine || 'unknown'),
      },
    ],
    consequences: [{
      kind: 'status',
      targetKind: 'institution',
      targetId: SCHISM_ARC_ID,
      metric: 'doctrine',
      value: doctrine,
      unit: null,
    }],
    source: 'schism',
    tags: ['schism', 'doctrine', doctrine],
  });
}

// Emit a pressure-driven political phase transition after phase state commits.
function emitSchismPhaseShifted(state, config, schism, details) {
  const phase = String(details && details.phase || 'concord');
  return pushEvent(state, config, {
    type: 'schism.phase_shifted',
    category: 'schism',
    message: details.message,
    actors: [buildCouncilActor()],
    location: { scope: 'world' },
    causes: [
      ...buildSchismStateCauses(schism),
      {
        kind: 'threshold',
        ref: 'schism.phase_thresholds',
        metric: 'previous_phase',
        value: String(details.previousPhase || 'concord'),
      },
    ],
    consequences: [{
      kind: 'status',
      targetKind: 'institution',
      targetId: SCHISM_ARC_ID,
      metric: 'phase',
      value: phase,
      unit: null,
    }],
    source: 'schism',
    tags: ['schism', 'phase', phase],
  });
}

// Emit the opening of a bounded seasonal ritual window.
function emitSchismRitualWindowOpened(state, config, schism, details) {
  const seasonName = String(details && details.seasonName || 'season');
  return pushEvent(state, config, {
    type: 'schism.ritual_window_opened',
    category: 'schism',
    message: details.message,
    actors: [buildCouncilActor()],
    location: { scope: 'world' },
    causes: [{
      kind: 'state',
      ref: 'seasons.current',
      metric: 'season_name',
      value: seasonName,
    }],
    consequences: [{
      kind: 'status',
      targetKind: 'institution',
      targetId: COUNCIL_ID,
      metric: 'ritual_window',
      value: 'open',
      unit: null,
    }],
    source: 'schism',
    tags: ['schism', 'ritual_window', 'opened'],
  });
}

// Emit the council festival trigger after its cooldown and counters commit.
function emitSchismCouncilRitualLit(state, config, schism, message) {
  return pushEvent(state, config, {
    type: 'schism.council_ritual_lit',
    category: 'schism',
    message,
    actors: [buildCouncilActor()],
    location: { scope: 'world' },
    causes: buildSchismStateCauses(schism),
    consequences: [{
      kind: 'status',
      targetKind: 'institution',
      targetId: COUNCIL_ID,
      metric: 'nine_braziers',
      value: 'lit',
      unit: null,
    }],
    source: 'schism',
    tags: ['schism', 'ritual', 'council', 'lit'],
  });
}

// Emit ritual invocation or expiration from a detached ritual snapshot.
function emitSchismRitualChanged(state, config, schism, phase, ritual, message) {
  const invoked = phase === 'invoked';
  const ritualId = String(ritual && ritual.id || 'council_rite');
  const consequences = [{
    kind: 'status',
    targetKind: 'institution',
    targetId: ritualId,
    metric: 'ritual_active',
    value: invoked,
    unit: null,
  }];
  if (invoked) {
    for (const metric of ['pressure', 'legitimacy']) {
      const value = Number(ritual && ritual.deltas && ritual.deltas[metric] || 0);
      if (value !== 0) {
        consequences.push({
          kind: 'delta',
          targetKind: 'institution',
          targetId: SCHISM_ARC_ID,
          metric,
          value,
          unit: 'ratio',
        });
      }
    }
  }
  return pushEvent(state, config, {
    type: invoked ? 'schism.ritual_invoked' : 'schism.ritual_expired',
    category: 'schism',
    message,
    actors: [
      buildCouncilActor(invoked ? 'instigator' : 'witness'),
      {
        kind: 'institution',
        id: ritualId,
        role: 'primary',
        label: String(ritual && ritual.label || ritualId),
      },
    ],
    location: { scope: 'world' },
    causes: invoked
      ? buildSchismStateCauses(schism)
      : [{
        kind: 'threshold',
        ref: 'schism.ritual_duration',
        metric: 'ends_at_tick',
        value: Math.max(0, Number(ritual && ritual.endsAtTick || 0)),
      }],
    consequences,
    source: 'schism',
    tags: ['schism', 'ritual', invoked ? 'invoked' : 'expired', ritualId],
  });
}

// Emit the deterministic council option slate after candidate selection.
function emitSchismDecreeProposed(state, config, schism, options, message) {
  const safeOptions = (Array.isArray(options) ? options : []).slice(0, 3);
  return pushEvent(state, config, {
    type: 'schism.decree_proposed',
    category: 'schism',
    message,
    actors: [
      buildCouncilActor('instigator'),
      ...safeOptions.map((option) => ({
        kind: 'institution',
        id: String(option && option.id || 'unnamed_decree'),
        role: 'secondary',
        label: String(option && option.label || option && option.id || 'Unnamed Decree'),
      })),
    ],
    location: { scope: 'world' },
    causes: buildSchismStateCauses(schism),
    consequences: [{
      kind: 'status',
      targetKind: 'institution',
      targetId: COUNCIL_ID,
      metric: 'decree_options',
      value: safeOptions.length,
      unit: 'options',
    }],
    source: 'schism',
    tags: ['schism', 'decree', 'proposed'],
  });
}

// Emit decree enactment or expiration after active/history state commits.
function emitSchismDecreeChanged(state, config, schism, phase, decree, message) {
  const enacted = phase === 'enacted';
  const decreeId = String(decree && decree.id || 'unnamed_decree');
  const consequences = [{
    kind: 'status',
    targetKind: 'institution',
    targetId: decreeId,
    metric: 'decree_active',
    value: enacted,
    unit: null,
  }];
  if (enacted) {
    for (const metric of ['pressure', 'legitimacy']) {
      const value = Number(decree && decree.deltas && decree.deltas[metric] || 0);
      if (value !== 0) {
        consequences.push({
          kind: 'delta',
          targetKind: 'institution',
          targetId: SCHISM_ARC_ID,
          metric,
          value,
          unit: 'ratio',
        });
      }
    }
  }
  return pushEvent(state, config, {
    type: enacted ? 'schism.decree_enacted' : 'schism.decree_expired',
    category: 'schism',
    message,
    actors: [
      buildCouncilActor(enacted ? 'instigator' : 'witness'),
      {
        kind: 'institution',
        id: decreeId,
        role: 'primary',
        label: String(decree && decree.label || decreeId),
      },
    ],
    location: { scope: 'world' },
    causes: enacted
      ? buildSchismStateCauses(schism)
      : [{
        kind: 'threshold',
        ref: 'schism.decree_duration',
        metric: 'ends_at_tick',
        value: Math.max(0, Number(decree && decree.endsAtTick || 0)),
      }],
    consequences,
    source: 'schism',
    tags: ['schism', 'decree', enacted ? 'enacted' : 'expired', decreeId],
  });
}

// Emit the opening or resolution of the run-scale political climax.
function emitSchismClimaxChanged(state, config, schism, phase, details) {
  const started = phase === 'started';
  const doctrine = String(details && details.doctrine || schism && schism.doctrine || 'austerity');
  const consequences = [{
    kind: 'status',
    targetKind: 'institution',
    targetId: SCHISM_ARC_ID,
    metric: 'climax_active',
    value: started,
    unit: null,
  }];
  if (!started) {
    consequences.push(
      {
        kind: 'delta',
        targetKind: 'institution',
        targetId: SCHISM_ARC_ID,
        metric: 'pressure',
        value: -Math.max(0, Number(details.pressureDrop || 0)),
        unit: 'ratio',
      },
      {
        kind: 'delta',
        targetKind: 'institution',
        targetId: SCHISM_ARC_ID,
        metric: 'legitimacy',
        value: Math.max(0, Number(details.legitimacyGain || 0)),
        unit: 'ratio',
      },
    );
  }
  return pushEvent(state, config, {
    type: started ? 'schism.climax_started' : 'schism.climax_resolved',
    category: 'schism',
    message: details.message,
    actors: [buildCouncilActor(started ? 'primary' : 'leader')],
    location: { scope: 'world' },
    causes: buildSchismStateCauses(schism),
    consequences,
    source: 'schism',
    tags: ['schism', 'climax', started ? 'started' : 'resolved', doctrine],
  });
}

module.exports = {
  emitSchismDoctrineShifted,
  emitSchismPhaseShifted,
  emitSchismRitualWindowOpened,
  emitSchismCouncilRitualLit,
  emitSchismRitualChanged,
  emitSchismDecreeProposed,
  emitSchismDecreeChanged,
  emitSchismClimaxChanged,
};
