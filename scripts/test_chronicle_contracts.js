'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config.json');
const { createInitialState } = require('../src/state');
const { pushEvent } = require('../src/simulation/events');
const {
  createExperienceLedger,
  recordExperienceEvent,
  getDwarfBiography,
} = require('../src/simulation/experience_ledger');
const {
  createChronicleState,
  recordChronicleEvent,
  finalizeCycleChronicle,
  carryChronicleAcrossCycle,
  verifyChronicleRecord,
  reviewSagaQuality,
} = require('../src/simulation/chronicle');
const { exportChronicle, resolveSafeOutputDirectory } = require('../src/chronicle_export');
const { buildInspectPanel } = require('../src/render/inspect');
const { buildTransitionPanel } = require('../src/render/transition');
const { buildObservation } = require('../src/ai/observation');
const { runEndgameReset } = require('../src/simulation/endgame');

const runtime = { gridWidth: 120, gridHeight: 50, playableArea: 6000 };

// Build a compact accepted-event fixture for E5 contracts.
function event(sequence, overrides = {}) {
  const actorId = overrides.actorId || 'dwarf_1';
  return {
    id: `evt_c0000_t${String(sequence).padStart(8, '0')}_n0000`,
    schemaVersion: 1,
    tick: sequence,
    cycle: 0,
    type: 'social.mentorship_started',
    category: 'social',
    importance: 'major',
    message: `Dwarf ${actorId} completed deed ${sequence}.`,
    actors: [{ kind: 'dwarf', id: actorId, role: 'primary', label: `Dwarf ${actorId}` }],
    location: { scope: 'surface', depth: 0, x: 2, y: 3, placeId: 'hold_1', label: 'First Hold' },
    sagaId: null,
    tags: [],
    ...overrides,
  };
}

// Flatten rendered panel text for semantic assertions.
function panelText(panel) {
  return (panel?.lines || []).map((line) => line.text).join('\n');
}

// Run the deterministic E5 contract suite.
function run() {
  const ledgerState = {
    dwarves: [{ id: 'dwarf_1', warrior: { scars: ['deep_cut'] } }],
    warriors: { company: { hallOfFame: [] } },
    story: { sagas: { order: [], byId: {} } },
    experience: createExperienceLedger(),
  };
  recordExperienceEvent(ledgerState, config, event(10));
  recordExperienceEvent(ledgerState, config, event(11));
  assert.equal(ledgerState.experience.byDwarfId.dwarf_1.deeds.length, 1, 'equivalent deeds merge');
  assert.equal(ledgerState.experience.byDwarfId.dwarf_1.deeds[0].occurrences, 2, 'merge count retained');
  assert.deepEqual(ledgerState.experience.byDwarfId.dwarf_1.deeds[0].sourceEventIds.length, 2, 'source IDs retained');
  assert.equal(ledgerState.experience.byDwarfId.dwarf_1.deeds[0].consequences, undefined, 'full events are not copied');

  const denseConfig = JSON.parse(JSON.stringify(config));
  denseConfig.experience_ledger.max_deeds_per_dwarf = 3;
  denseConfig.experience_ledger.merge_window_ticks = 0;
  for (let index = 20; index < 40; index += 1) {
    recordExperienceEvent(ledgerState, denseConfig, event(index, { type: `warrior.deed_${index}`, category: 'warrior' }));
  }
  assert.equal(ledgerState.experience.byDwarfId.dwarf_1.deeds.length, 3, 'per-dwarf cap is hard');
  const biography = getDwarfBiography(ledgerState, config, 'dwarf_1');
  assert(biography.definingDeed, 'defining deed resolves');
  assert.deepEqual(biography.scars, ['deep_cut'], 'scars resolve');
  ledgerState.dwarves = [];
  assert(getDwarfBiography(ledgerState, config, 'dwarf_1').recentDeeds[0].actorSnapshots[0].label, 'dead actor snapshot resolves');

  const protectedConfig = JSON.parse(JSON.stringify(config));
  protectedConfig.experience_ledger.max_deeds_per_dwarf = 2;
  protectedConfig.experience_ledger.max_dwarves = 1;
  protectedConfig.experience_ledger.merge_window_ticks = 0;
  const protectedState = {
    dwarves: [],
    warriors: { company: { hallOfFame: [{ dwarfId: 'dwarf_hof' }] } },
    story: { sagas: { order: ['saga_active'], byId: { saga_active: { id: 'saga_active', status: 'active', actorIds: ['dwarf_hof'] } } } },
    experience: createExperienceLedger(),
  };
  recordExperienceEvent(protectedState, protectedConfig, event(40, { actorId: 'dwarf_old', type: 'combat.old', category: 'combat' }));
  recordExperienceEvent(protectedState, protectedConfig, event(41, { actorId: 'dwarf_hof', type: 'combat.saga', category: 'combat', sagaId: 'saga_active' }));
  recordExperienceEvent(protectedState, protectedConfig, event(42, { actorId: 'dwarf_hof', type: 'combat.critical', category: 'combat', importance: 'critical' }));
  recordExperienceEvent(protectedState, protectedConfig, event(43, { actorId: 'dwarf_hof', type: 'combat.legendary', category: 'combat', importance: 'legendary' }));
  assert(protectedState.experience.byDwarfId.dwarf_hof, 'Hall of Fame record survives global cap');
  assert(protectedState.experience.byDwarfId.dwarf_hof.deeds.some((deed) => deed.sagaId === 'saga_active'), 'active saga deed survives local cap');

  const chronicleState = { tick: 0, cycleStats: { count: 0 }, chronicle: createChronicleState(0) };
  const chapterCases = [
    ['lifecycle.birth', 'lifecycle', 'settlement_growth'],
    ['world.raid_started', 'world', 'crises'],
    ['schism.decree', 'schism', 'politics'],
    ['underrealm.expedition', 'underrealm', 'expeditions'],
    ['warrior.champion_crowned', 'warrior', 'heroes'],
    ['lifecycle.death', 'lifecycle', 'deaths'],
    ['endgame.cycle_closed', 'endgame', 'legacy'],
  ];
  chapterCases.forEach(([type, category, chapter], index) => {
    const claim = recordChronicleEvent(chronicleState, config, event(100 + index, { type, category }));
    assert.equal(claim.chapterId, chapter, `${type} chapter`);
  });
  const completed = finalizeCycleChronicle(chronicleState, config, { completedTicks: 200 });
  assert.equal(completed.summary.chapterCount, 7, 'all required chapters represented');
  assert(verifyChronicleRecord(completed).valid, 'completed Chronicle verifies');
  const broken = JSON.parse(JSON.stringify(completed));
  broken.evidence = [];
  assert.equal(verifyChronicleRecord(broken).valid, false, 'missing source event is rejected');
  const brokenActor = JSON.parse(JSON.stringify(completed));
  brokenActor.evidence[0].actors = [];
  assert.equal(verifyChronicleRecord(brokenActor).valid, false, 'missing actor is rejected');
  const brokenLocation = JSON.parse(JSON.stringify(completed));
  brokenLocation.evidence[0].location = { scope: 'surface' };
  assert.equal(verifyChronicleRecord(brokenLocation).valid, false, 'missing location is rejected');

  const boundedConfig = JSON.parse(JSON.stringify(config));
  boundedConfig.chronicle.max_claims_per_chapter = 2;
  boundedConfig.chronicle.max_evidence_per_cycle = 7;
  const boundedState = { tick: 0, cycleStats: { count: 0 }, chronicle: createChronicleState(0) };
  for (let index = 0; index < 100; index += 1) {
    recordChronicleEvent(boundedState, boundedConfig, event(300 + index, { type: `lifecycle.growth_${index}`, category: 'lifecycle' }));
  }
  assert.equal(boundedState.chronicle.current.chapters[0].claims.length, 2, 'chapter cap is hard');
  assert.equal(boundedState.chronicle.current.evidence.length, 2, 'unreferenced evidence is evicted');

  const peaceful = finalizeCycleChronicle({ tick: 10, cycleStats: { count: 0 }, chronicle: createChronicleState(0) }, config);
  assert(verifyChronicleRecord(peaceful).valid && peaceful.summary.claimCount === 0, 'empty peaceful cycle is valid');
  const shortState = { tick: 1, cycleStats: { count: 0 }, chronicle: createChronicleState(0) };
  recordChronicleEvent(shortState, config, event(1));
  assert.equal(finalizeCycleChronicle(shortState, config).summary.claimCount, 1, 'short Chronicle retains one fact');
  const catastrophicState = { tick: 2, cycleStats: { count: 0 }, chronicle: createChronicleState(0) };
  recordChronicleEvent(catastrophicState, config, event(1, { type: 'world.disaster', category: 'world', importance: 'critical' }));
  recordChronicleEvent(catastrophicState, config, event(2, { type: 'lifecycle.death', category: 'lifecycle', importance: 'critical' }));
  const catastrophic = finalizeCycleChronicle(catastrophicState, config);
  assert(catastrophic.chapters.find((chapter) => chapter.id === 'crises').claims.length === 1
    && catastrophic.chapters.find((chapter) => chapter.id === 'deaths').claims.length === 1, 'catastrophic Chronicle keeps crisis and death');
  const nextState = { tick: 0, cycleStats: { count: 1 }, chronicle: createChronicleState(1) };
  carryChronicleAcrossCycle(chronicleState, nextState, config, completed);
  assert.equal(nextState.chronicle.archive.length, 1, 'multi-cycle archive carries facts');
  assert.equal(nextState.chronicle.current.cycle, 1, 'new cycle remains separate');

  const exportRootA = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-chronicle-a-'));
  const exportRootB = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-chronicle-b-'));
  try {
    const exportState = { chronicle: { archive: [completed] } };
    const first = exportChronicle(exportState, config, { rootDir: exportRootA });
    const second = exportChronicle(exportState, config, { rootDir: exportRootB });
    assert.equal(first.hash, second.hash, 'equal seeded records have equal export hashes');
    assert.equal(path.basename(first.files[0]), path.basename(second.files[0]), 'safe names are deterministic');
    assert.equal(fs.readFileSync(first.files[0], 'utf8'), fs.readFileSync(second.files[0], 'utf8'), 'JSON exports match');
    assert.equal(resolveSafeOutputDirectory(exportRootA, '../escape'), path.join(exportRootA, 'chronicles'), 'path escape falls back');
  } finally {
    fs.rmSync(exportRootA, { recursive: true, force: true });
    fs.rmSync(exportRootB, { recursive: true, force: true });
  }

  const integration = createInitialState(config, runtime);
  const dwarf = integration.dwarves[0];
  const accepted = pushEvent(integration, config, {
    type: 'warrior.test_deed', category: 'warrior', importance: 'major', message: 'A witnessed test deed.',
    actors: [{ kind: 'dwarf', id: dwarf.id, role: 'primary', label: dwarf.id }],
    location: { scope: 'world' }, causes: [], consequences: [], source: 'e5_test', tags: ['test'],
  });
  assert(accepted && integration.experience.byDwarfId[dwarf.id], 'canonical event feeds ledger');
  assert(integration.chronicle.current.evidence.some((entry) => entry.eventId === accepted.id), 'canonical event feeds Chronicle');
  const observationBefore = buildObservation(integration, config);
  integration.experience.stats.recorded += 100;
  integration.chronicle.stats.acceptedClaims += 100;
  assert.deepEqual(buildObservation(integration, config), observationBefore, 'E5 state is absent from AI observations');

  integration.ui.inspect.open = true;
  integration.ui.inspect.ids = [dwarf.id];
  integration.ui.inspect.index = 0;
  const inspect = panelText(buildInspectPanel(integration, config, runtime));
  assert(inspect.includes('LIVED HISTORY') && inspect.includes('Defining deed:'), 'Inspect renders lived history');
  assert(inspect.includes('Relationships:'), 'Inspect renders active-relationship slot');
  assert(inspect.includes('INHERITED LORE'), 'Inspect separates inherited lore');

  integration.ui.transition = {
    active: true, showPanel: true, message: 'A new road opens.', chronicleSummary: completed.summary,
  };
  const transition = panelText(buildTransitionPanel(integration, config, runtime));
  assert(transition.includes('CYCLE LEGACY') && transition.includes('claims'), 'transition renders Chronicle summary');

  const sagaReview = reviewSagaQuality({ story: { stats: { sagasOpened: 10, sagasEvicted: 8 }, sagas: { order: [], byId: {} } } }, config);
  assert.equal(sagaReview.useForRetention, false, 'fragmented sagas do not influence Chronicle retention');
  assert.equal(sagaReview.fragmentationRate, 0.8, 'saga fragmentation is measured');

  const resetState = createInitialState(config, runtime);
  const resetDwarf = resetState.dwarves[0];
  pushEvent(resetState, config, {
    type: 'endgame.test_legacy', category: 'endgame', importance: 'legendary', message: 'The first cycle left a witnessed legacy.',
    actors: [{ kind: 'dwarf', id: resetDwarf.id, role: 'primary', label: resetDwarf.id }],
    location: { scope: 'world' }, causes: [], consequences: [], source: 'e5_test', tags: ['legacy'],
  });
  const resetResult = runEndgameReset(resetState, config, runtime, {
    preserveUi: { transition: { active: true, showPanel: true, message: 'Next cycle.' } },
  });
  assert.equal(resetState.chronicle.archive.length, 1, 'reset carries a bounded completed Chronicle');
  assert(resetState.ui.transition.chronicleSummary.claimCount > 0, 'reset exposes pre-reset summary');
  assert.equal(resetResult.completedChronicle.status, 'completed', 'reset returns completed Chronicle');

  console.log('Chronicle contracts: 39 assertions passed.');
}

run();
