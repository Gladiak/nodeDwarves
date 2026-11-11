'use strict';

const { verifyChronicleRecord } = require('./chronicle');

const EFFECT_SCHEMA_VERSION = 1;
const BUILD_TYPES = new Set(['construction.structure_completed', 'landmark.stage_completed',
  'temple.stage_completed']);

// Resolve the first typed effect with strict finite, ratio and magnitude ceilings.
function getLegacyEffectSettings(config) {
  const raw = config?.world_legacy?.institutions || {};
  const effects = raw.effects || {};
  const modifiers = raw.modifiers || {};
  return {
    enabled: config?.world_legacy?.enabled !== false && effects.enabled === true,
    minimumEvidence: Math.round(bounded(effects.minimum_construction_facts, 3, 12, 3)),
    decay: bounded(effects.decay_per_cycle, 0.01, 0.95, 0.5),
    institutionCap: bounded(effects.per_institution_cap, 0, 0.02, 0.02),
    totalCap: bounded(modifiers.total_cap, 0, 0.05, 0.02),
    rawMagnitude: bounded(modifiers.per_cycle, 0, 0.02, 0.005),
  };
}

// Select distinct retained construction receipts from one verified completed chapter.
function findConstructionEvidence(chronicle, minimumEvidence) {
  if (chronicle?.status !== 'completed' || !isVerified(chronicle)) return null;
  const evidence = new Map((chronicle.evidence || []).filter((entry) =>
    BUILD_TYPES.has(entry.type) && entry.cycle === chronicle.cycle).map((entry) => [entry.eventId, entry]));
  for (const chapter of chronicle.chapters || []) {
    const ids = [...new Set((chapter.claims || []).flatMap((claim) => claim.sourceEventIds || []))]
      .filter((id) => evidence.has(id)).sort();
    if (ids.length >= minimumEvidence) return { chapterId: chapter.id, eventIds: ids.slice(0, minimumEvidence) };
  }
  return null;
}

// Construct at most one active institution; historical hooks remain separate and inert.
function buildConstructionInstitution(chronicle, config) {
  const settings = getLegacyEffectSettings(config);
  if (!settings.enabled) return null;
  const source = findConstructionEvidence(chronicle, settings.minimumEvidence);
  if (!source) return null;
  return {
    id: `legacy_institution_c${chronicle.cycle}_builders_guild`,
    name: `Builders' Guild of Cycle ${chronicle.cycle + 1}`,
    motto: 'The witnessed works endure.',
    sourceCycle: chronicle.cycle,
    sourceChapterId: source.chapterId,
    sourceEventIds: source.eventIds,
    modifier: { schemaVersion: EFFECT_SCHEMA_VERSION, id: 'construction_speed',
      magnitude: Math.min(settings.rawMagnitude, settings.institutionCap, settings.totalCap),
      cap: settings.institutionCap, applied: false },
  };
}

// Resolve read-only contributions once per tick: the strongest same-type legacy wins.
function resolveLegacyEffects(state, config) {
  const settings = getLegacyEffectSettings(config);
  const details = [];
  const cycle = Number(state?.cycleStats?.count || 0);
  const verifiedArchives = new Map();
  const archives = Array.isArray(state?.chronicle?.archive) ? state.chronicle.archive : [];
  const institutions = Array.isArray(state?.worldLegacy?.institutions) ? state.worldLegacy.institutions : [];
  for (const record of institutions.slice(-32)) {
    const modifier = record.modifier || {};
    const age = cycle - Number(record.sourceCycle);
    const raw = bounded(modifier.magnitude, 0, 0.02, 0);
    const detail = { institutionId: record.id, name: record.name, type: modifier.id,
      sourceCycle: record.sourceCycle, sourceChapterId: record.sourceChapterId,
      sourceEventIds: (Array.isArray(record.sourceEventIds) ? record.sourceEventIds : []).slice(0, 12),
      target: modifier.id === 'construction_speed' ? 'construction work' : 'none',
      age, rawMagnitude: raw, decayedMagnitude: 0, contribution: 0,
      cap: settings.totalCap, reason: 'unsupported_effect' };
    details.push(detail);
    if (modifier.schemaVersion !== EFFECT_SCHEMA_VERSION || modifier.id !== 'construction_speed') continue;
    if (!settings.enabled) { detail.reason = 'disabled'; continue; }
    if (!Number.isSafeInteger(age) || age < 1) { detail.reason = 'invalid_cycle_age'; continue; }
    if (!verifiedArchives.has(record.sourceCycle)) {
      const archive = archives.find((entry) => entry.cycle === record.sourceCycle);
      verifiedArchives.set(record.sourceCycle, archive?.status === 'completed' && isVerified(archive) ? archive : null);
    }
    const archive = verifiedArchives.get(record.sourceCycle);
    const chapter = archive?.chapters?.find((entry) => entry.id === record.sourceChapterId);
    const refs = new Set((chapter?.claims || []).flatMap((claim) => claim.sourceEventIds || []));
    const evidence = new Map((archive?.evidence || []).map((entry) => [entry.eventId, entry]));
    const ids = [...new Set(detail.sourceEventIds)];
    if (ids.length < settings.minimumEvidence || !ids.every((id) => refs.has(id)
      && evidence.get(id)?.cycle === record.sourceCycle && BUILD_TYPES.has(evidence.get(id)?.type))) {
      detail.reason = 'unresolved_source'; continue;
    }
    detail.decayedMagnitude = Math.min(raw, settings.institutionCap,
      bounded(modifier.cap, 0, 0.02, 0)) * Math.pow(1 - settings.decay, age - 1);
    detail.reason = 'superseded';
  }
  const candidates = details.filter((entry) => entry.reason === 'superseded')
    .sort((left, right) => right.decayedMagnitude - left.decayedMagnitude
      || String(left.institutionId).localeCompare(String(right.institutionId)));
  const winner = candidates[0];
  if (winner) {
    winner.contribution = Math.min(winner.decayedMagnitude, settings.totalCap);
    winner.reason = winner.contribution > 0 ? 'active' : 'zero_budget';
  }
  return { schemaVersion: EFFECT_SCHEMA_VERSION, constructionSpeed: winner?.contribution || 0,
    activeMagnitude: winner?.contribution || 0,
    activeCount: details.filter((entry) => entry.contribution > 0).length,
    totalCap: settings.totalCap, details };
}

// Reject malformed archive records without repairing or mutating historical evidence.
function isVerified(record) {
  try { return verifyChronicleRecord(record).valid; } catch { return false; }
}

// Keep invalid configuration and historical magnitudes outside effective gameplay values.
function bounded(value, low, high, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(low, Math.min(high, number)) : fallback;
}

module.exports = { EFFECT_SCHEMA_VERSION, getLegacyEffectSettings,
  findConstructionEvidence, buildConstructionInstitution, resolveLegacyEffects };
