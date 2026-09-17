'use strict';

const IMPORTANCE = ['ambient', 'notable', 'major', 'critical', 'legendary'];
const CHAPTERS = [
  ['settlement_growth', 'Settlement Growth'],
  ['crises', 'Crises'],
  ['politics', 'Politics'],
  ['expeditions', 'Expeditions'],
  ['heroes', 'Heroes'],
  ['deaths', 'Deaths'],
  ['legacy', 'Legacy'],
];

// Create the bounded Chronicle state for one run.
function createChronicleState(cycle = 0) {
  return {
    schemaVersion: 1,
    current: createCycleRecord(cycle),
    archive: [],
    stats: { acceptedClaims: 0, omittedClaims: 0, evictedClaims: 0, completedCycles: 0 },
  };
}

// Create one deterministic, fixed-chapter cycle record.
function createCycleRecord(cycle) {
  return {
    schemaVersion: 1,
    cycle: safeCount(cycle),
    status: 'in_progress',
    startedTick: 0,
    completedTick: null,
    chapters: CHAPTERS.map(([id, title]) => ({ id, title, claims: [] })),
    evidence: [],
  };
}

// Repair Chronicle state and rotate the current record when a new cycle starts.
function ensureChronicleState(state) {
  const cycle = safeCount(state?.cycleStats?.count);
  if (!state.chronicle || typeof state.chronicle !== 'object') {
    state.chronicle = createChronicleState(cycle);
  }
  const chronicle = state.chronicle;
  chronicle.schemaVersion = 1;
  chronicle.archive = Array.isArray(chronicle.archive) ? chronicle.archive : [];
  chronicle.stats = chronicle.stats && typeof chronicle.stats === 'object' ? chronicle.stats : {};
  for (const field of ['acceptedClaims', 'omittedClaims', 'evictedClaims', 'completedCycles']) {
    chronicle.stats[field] = safeCount(chronicle.stats[field]);
  }
  if (!chronicle.current || chronicle.current.cycle !== cycle || chronicle.current.status !== 'in_progress') {
    chronicle.current = createCycleRecord(cycle);
    chronicle.current.startedTick = safeCount(state && state.tick);
  }
  return chronicle;
}

// Record one accepted event as a fact-backed Chronicle claim.
function recordChronicleEvent(state, config, event) {
  const chronicle = ensureChronicleState(state);
  const settings = getSettings(config);
  if (!isEligible(event, settings)) return null;
  const evidence = buildEvidence(event);
  const chapterId = classifyChapter(event);
  const claim = buildClaim(event, evidence, chapterId);
  if (!isEvidenceResolvable(evidence) || !verifyClaim(claim, [evidence])) {
    chronicle.stats.omittedClaims += 1;
    return null;
  }
  const chapter = chronicle.current.chapters.find((entry) => entry.id === chapterId);
  if (!chapter) {
    chronicle.stats.omittedClaims += 1;
    return null;
  }
  chapter.claims.push(claim);
  chronicle.current.evidence.push(evidence);
  chronicle.stats.acceptedClaims += 1;
  enforceCycleBounds(chronicle, settings);
  return claim;
}

// Finalize the current cycle without introducing unsourced prose.
function finalizeCycleChronicle(state, config, details = {}) {
  const chronicle = ensureChronicleState(state);
  const current = chronicle.current;
  const completed = JSON.parse(JSON.stringify(current));
  completed.status = 'completed';
  completed.completedTick = safeCount(details.completedTicks ?? state?.tick);
  completed.summary = buildChronicleSummary(completed);
  const verified = sanitizeChronicleRecord(completed);
  chronicle.stats.omittedClaims += verified.omittedClaims;
  chronicle.stats.completedCycles += 1;
  return verified.record;
}

// Carry only bounded factual Chronicle archives into the next cycle.
function carryChronicleAcrossCycle(previousState, nextState, config, completedRecord) {
  const settings = getSettings(config);
  const previousArchive = Array.isArray(previousState?.chronicle?.archive)
    ? previousState.chronicle.archive : [];
  const candidates = [...previousArchive, completedRecord].filter(Boolean);
  const archive = candidates.slice(-settings.maxArchivedCycles).map((record) => sanitizeChronicleRecord(record).record);
  const chronicle = ensureChronicleState(nextState);
  chronicle.archive = archive;
  chronicle.stats.completedCycles = safeCount(previousState?.chronicle?.stats?.completedCycles);
  return archive;
}

// Build an immutable snapshot for an in-progress export.
function buildCurrentChronicleSnapshot(state) {
  const source = state?.chronicle?.current || createCycleRecord(state?.cycleStats?.count || 0);
  const snapshot = JSON.parse(JSON.stringify(source));
  snapshot.completedTick = safeCount(state && state.tick);
  snapshot.summary = buildChronicleSummary(snapshot);
  return sanitizeChronicleRecord(snapshot).record;
}

// Verify all claims against compact source, actor and location evidence.
function verifyChronicleRecord(record) {
  const errors = [];
  const evidence = Array.isArray(record && record.evidence) ? record.evidence : [];
  const evidenceById = new Map(evidence.map((entry) => [entry.eventId, entry]));
  for (const chapter of Array.isArray(record && record.chapters) ? record.chapters : []) {
    for (const claim of Array.isArray(chapter.claims) ? chapter.claims : []) {
      const sources = Array.isArray(claim.sourceEventIds) ? claim.sourceEventIds : [];
      if (sources.length === 0) errors.push(`${claim.id}: missing source event`);
      for (const id of sources) {
        const source = evidenceById.get(id);
        if (!source) errors.push(`${claim.id}: unresolved event ${id}`);
        else if (!verifyClaim(claim, [source])) errors.push(`${claim.id}: unresolved actor or location`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

// Omit invalid claims and unreferenced evidence for export/reset safety.
function sanitizeChronicleRecord(record) {
  const clone = JSON.parse(JSON.stringify(record || createCycleRecord(0)));
  const evidence = Array.isArray(clone.evidence) ? clone.evidence.filter(isEvidenceResolvable) : [];
  const evidenceById = new Map(evidence.map((entry) => [entry.eventId, entry]));
  let omittedClaims = 0;
  for (const chapter of Array.isArray(clone.chapters) ? clone.chapters : []) {
    const claims = Array.isArray(chapter.claims) ? chapter.claims : [];
    chapter.claims = claims.filter((claim) => {
      const sources = Array.isArray(claim.sourceEventIds) ? claim.sourceEventIds : [];
      const valid = sources.length > 0 && sources.every((id) => evidenceById.has(id)
        && verifyClaim(claim, [evidenceById.get(id)]));
      if (!valid) omittedClaims += 1;
      return valid;
    });
  }
  const retainedIds = new Set(clone.chapters.flatMap((chapter) => chapter.claims.flatMap((claim) => claim.sourceEventIds)));
  clone.evidence = evidence.filter((entry) => retainedIds.has(entry.eventId));
  clone.summary = buildChronicleSummary(clone);
  return { record: clone, omittedClaims };
}

// Build compact transition highlights whose every line retains source IDs.
function buildChronicleSummary(record) {
  const claims = (Array.isArray(record?.chapters) ? record.chapters : [])
    .flatMap((chapter) => chapter.claims.map((claim) => ({ ...claim, chapterTitle: chapter.title })));
  claims.sort((left, right) => importanceRank(right.importance) - importanceRank(left.importance)
    || right.tick - left.tick || left.id.localeCompare(right.id));
  const activeChapters = (record?.chapters || []).filter((chapter) => chapter.claims.length > 0).length;
  return {
    title: `Cycle ${safeCount(record?.cycle) + 1} Chronicle`,
    claimCount: claims.length,
    chapterCount: activeChapters,
    highlights: claims.slice(0, 3).map((claim) => ({
      chapter: claim.chapterTitle,
      text: claim.text,
      sourceEventIds: claim.sourceEventIds.slice(),
    })),
  };
}

// Report whether saga quality is strong enough to influence Chronicle retention.
function reviewSagaQuality(state, config) {
  const sagas = state?.story?.sagas;
  const entries = sagas && Array.isArray(sagas.order)
    ? sagas.order.map((id) => sagas.byId && sagas.byId[id]).filter(Boolean) : [];
  const opened = safeCount(state?.story?.stats?.sagasOpened);
  const terminal = safeCount(state?.story?.stats?.sagasResolved) + safeCount(state?.story?.stats?.sagasFailed);
  const evicted = safeCount(state?.story?.stats?.sagasEvicted);
  return {
    sampleSize: entries.length,
    opened,
    terminal,
    evicted,
    terminalRate: opened > 0 ? terminal / opened : 0,
    fragmentationRate: opened > 0 ? evicted / opened : 0,
    useForRetention: config?.chronicle?.saga_quality?.use_for_retention === true,
    samples: entries.slice(-3).map((saga) => ({ id: saga.id, status: saga.status, eventCount: safeCount(saga.eventCount) })),
  };
}

// Map event families into the fixed Chronicle chapter vocabulary.
function classifyChapter(event) {
  const type = String(event?.type || '');
  const category = String(event?.category || '');
  const tags = Array.isArray(event?.tags) ? event.tags.map(String) : [];
  if (type.includes('death') || tags.includes('death')) return 'deaths';
  if (category === 'schism' || type.includes('decree') || type.includes('council')) return 'politics';
  if (category === 'warrior' || type.includes('champion') || type.includes('hero')) return 'heroes';
  if (category === 'underrealm' || type.includes('expedition') || type.includes('artifact') || type.includes('ruins')) return 'expeditions';
  if (category === 'endgame' || category === 'myth' || type.includes('temple') || type.includes('legacy')) return 'legacy';
  if (type.includes('raid') || type.includes('crisis') || type.includes('shortage') || type.includes('disaster')) return 'crises';
  return 'settlement_growth';
}

// Build the minimal source record required to audit a claim.
function buildEvidence(event) {
  return {
    eventId: String(event.id).slice(0, 128),
    tick: safeCount(event.tick),
    cycle: safeCount(event.cycle),
    type: String(event.type || 'unknown').slice(0, 96),
    category: String(event.category || 'unknown').slice(0, 48),
    importance: normalizeImportance(event.importance, 'ambient'),
    actors: normalizeActors(event.actors),
    location: normalizeLocation(event.location),
    sagaId: event.sagaId ? String(event.sagaId).slice(0, 96) : null,
  };
}

// Build one text claim that points back to its exact accepted event.
function buildClaim(event, evidence, chapterId) {
  return {
    id: `claim:${evidence.eventId}`,
    chapterId,
    tick: evidence.tick,
    importance: evidence.importance,
    text: String(event.message || '').slice(0, 220),
    sourceEventIds: [evidence.eventId],
    actorIds: evidence.actors.map((actor) => actor.id),
    location: evidence.location,
  };
}

// Enforce per-chapter and total evidence bounds together.
function enforceCycleBounds(chronicle, settings) {
  const current = chronicle.current;
  for (const chapter of current.chapters) {
    if (chapter.claims.length <= settings.maxClaimsPerChapter) continue;
    chapter.claims.sort(compareRetention);
    const removed = chapter.claims.splice(settings.maxClaimsPerChapter);
    chronicle.stats.evictedClaims += removed.length;
  }
  let claims = current.chapters.flatMap((chapter) => chapter.claims);
  if (claims.length > settings.maxEvidence) {
    claims.sort(compareRetention);
    const keep = new Set(claims.slice(0, settings.maxEvidence).map((claim) => claim.id));
    for (const chapter of current.chapters) {
      const before = chapter.claims.length;
      chapter.claims = chapter.claims.filter((claim) => keep.has(claim.id));
      chronicle.stats.evictedClaims += before - chapter.claims.length;
    }
  }
  const retainedIds = new Set(current.chapters.flatMap((chapter) => chapter.claims.flatMap((claim) => claim.sourceEventIds)));
  current.evidence = current.evidence.filter((entry) => retainedIds.has(entry.eventId));
}

// Keep higher importance then newer claims under pressure.
function compareRetention(left, right) {
  return importanceRank(right.importance) - importanceRank(left.importance)
    || right.tick - left.tick || left.id.localeCompare(right.id);
}

// Check that compact evidence can resolve every actor and location later.
function isEvidenceResolvable(evidence) {
  if (!evidence || !evidence.eventId) return false;
  if (!Array.isArray(evidence.actors) || evidence.actors.some((actor) => !actor.id || !actor.label)) return false;
  return isLocationResolvable(evidence.location);
}

// Validate a claim against one or more exact evidence records.
function verifyClaim(claim, evidenceList) {
  if (!claim || !claim.text || !Array.isArray(evidenceList) || evidenceList.length === 0) return false;
  const actorIds = new Set(evidenceList.flatMap((entry) => entry.actors.map((actor) => actor.id)));
  if ((claim.actorIds || []).some((id) => !actorIds.has(id))) return false;
  return isLocationResolvable(claim.location) && evidenceList.every(isEvidenceResolvable);
}

// World scope is intrinsically resolvable; mapped scopes need coordinates or a named place.
function isLocationResolvable(location) {
  if (!location || !location.scope) return false;
  if (location.scope === 'world') return true;
  return Boolean(location.placeId || location.label
    || Number.isSafeInteger(location.x) && Number.isSafeInteger(location.y));
}

// Normalize actor identity snapshots for post-mortem and post-reset resolution.
function normalizeActors(actors) {
  if (!Array.isArray(actors)) return [];
  return actors.filter((actor) => actor && actor.id).slice(0, 8).map((actor) => ({
    kind: String(actor.kind || 'unknown').slice(0, 32),
    id: String(actor.id).slice(0, 96),
    role: String(actor.role || 'participant').slice(0, 32),
    label: String(actor.label || actor.id).slice(0, 96),
  }));
}

// Normalize auditable location facts without copying event payloads.
function normalizeLocation(location) {
  const source = location && typeof location === 'object' ? location : { scope: 'world' };
  const result = { scope: String(source.scope || 'world').slice(0, 24) };
  for (const field of ['depth', 'x', 'y']) {
    if (Number.isSafeInteger(Number(source[field]))) result[field] = Math.max(0, Number(source[field]));
  }
  if (source.placeId) result.placeId = String(source.placeId).slice(0, 96);
  if (source.label) result.label = String(source.label).slice(0, 96);
  return result;
}

// Resolve Chronicle limits with hard ceilings.
function getSettings(config) {
  const raw = config && config.chronicle || {};
  return {
    enabled: raw.enabled !== false,
    minimumImportance: normalizeImportance(raw.minimum_importance, 'notable'),
    maxClaimsPerChapter: clampInt(raw.max_claims_per_chapter, 1, 64, 12),
    maxEvidence: clampInt(raw.max_evidence_per_cycle, 7, 512, 128),
    maxArchivedCycles: clampInt(raw.max_archived_cycles, 1, 16, 4),
  };
}

// Determine whether an event should become Chronicle prose.
function isEligible(event, settings) {
  if (!settings.enabled || !event || !event.id || !event.message) return false;
  return importanceRank(event.importance) >= importanceRank(settings.minimumImportance);
}

// Normalize supported importance names.
function normalizeImportance(value, fallback) {
  const normalized = String(value || '').toLowerCase();
  return IMPORTANCE.includes(normalized) ? normalized : fallback;
}

// Convert importance to its stable retention rank.
function importanceRank(value) {
  return Math.max(0, IMPORTANCE.indexOf(normalizeImportance(value, 'ambient')));
}

// Clamp one integer setting to its absolute safety range.
function clampInt(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
}

// Normalize persisted counters to non-negative safe integers.
function safeCount(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

module.exports = {
  CHAPTERS,
  createChronicleState,
  ensureChronicleState,
  recordChronicleEvent,
  finalizeCycleChronicle,
  carryChronicleAcrossCycle,
  buildCurrentChronicleSnapshot,
  buildChronicleSummary,
  verifyChronicleRecord,
  sanitizeChronicleRecord,
  reviewSagaQuality,
};
