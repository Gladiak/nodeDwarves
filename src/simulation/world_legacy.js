'use strict';

const { registerPlace } = require('../place_identity');
const { resolveDwarfIdentity } = require('../dwarf_identity');

const WORLD_LEGACY_SCHEMA_VERSION = 1;
const IMPORTANCE = ['ambient', 'notable', 'major', 'critical', 'legendary'];
const RECORD_FIELDS = ['cycles', 'identities', 'places', 'memorials', 'institutions', 'echoes'];

// Create the versioned, bounded cross-cycle history container.
function createWorldLegacyState() {
  return {
    schemaVersion: WORLD_LEGACY_SCHEMA_VERSION,
    cycles: [],
    identities: [],
    places: [],
    memorials: [],
    institutions: [],
    echoes: [],
    stats: {
      completedCycles: 0,
      createdRecords: 0,
      evictedRecords: 0,
      migratedStates: 0,
      rejectedRecords: 0,
    },
  };
}

// Repair known historical shapes and reject unsupported future schemas safely.
function migrateWorldLegacyState(raw, config) {
  const settings = getWorldLegacySettings(config);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return createWorldLegacyState();
  }
  const version = Number.isSafeInteger(Number(raw.schemaVersion))
    ? Number(raw.schemaVersion) : 0;
  if (version > WORLD_LEGACY_SCHEMA_VERSION) {
    const fresh = createWorldLegacyState();
    fresh.stats.rejectedRecords = countRawRecords(raw);
    return fresh;
  }
  const migrated = createWorldLegacyState();
  const source = version === 0 ? migrateVersionZero(raw) : raw;
  for (const field of RECORD_FIELDS) {
    migrated[field] = sanitizeRecordList(source[field], field, settings);
  }
  const stats = source.stats && typeof source.stats === 'object' ? source.stats : {};
  for (const field of Object.keys(migrated.stats)) {
    migrated.stats[field] = safeCount(stats[field]);
  }
  if (version !== WORLD_LEGACY_SCHEMA_VERSION) migrated.stats.migratedStates += 1;
  enforceLegacyBounds(migrated, settings);
  return migrated;
}

// Install or repair legacy state on a live simulation state.
function ensureWorldLegacyState(state, config) {
  if (!state || typeof state !== 'object') return null;
  state.worldLegacy = migrateWorldLegacyState(state.worldLegacy, config);
  return state.worldLegacy;
}

// Convert one completed Chronicle into compact history and remap visible echoes.
function carryWorldLegacyAcrossCycle(previousState, nextState, config, completedChronicle) {
  const settings = getWorldLegacySettings(config);
  const legacy = migrateWorldLegacyState(previousState && previousState.worldLegacy, config);
  if (!settings.enabled || !completedChronicle || typeof completedChronicle !== 'object') {
    nextState.worldLegacy = legacy;
    remapLegacyEchoes(nextState, config);
    return buildLegacySummary(legacy);
  }

  const sourceCycle = safeCount(completedChronicle.cycle);
  const before = countLegacyRecords(legacy);
  mergeRecords(legacy.cycles, [buildCycleLegacy(completedChronicle)], 'id');
  mergeRecords(
    legacy.identities,
    buildIdentityRecords(previousState, completedChronicle, config, settings),
    'id',
  );
  mergeRecords(legacy.places, buildPlaceRecords(previousState, completedChronicle, settings), 'id');

  const memorials = buildMemorialRecords(completedChronicle, settings);
  mergeRecords(legacy.memorials, memorials, 'id');
  mergeRecords(legacy.institutions, buildInstitutionRecords(previousState, completedChronicle, settings), 'id');
  mergeRecords(legacy.echoes, buildEchoRecords(completedChronicle, memorials, settings), 'id');

  legacy.stats.completedCycles = Math.max(legacy.stats.completedCycles, sourceCycle + 1);
  legacy.stats.createdRecords += Math.max(0, countLegacyRecords(legacy) - before);
  enforceLegacyBounds(legacy, settings);
  nextState.worldLegacy = legacy;
  remapLegacyEchoes(nextState, config);
  return buildLegacySummary(legacy);
}

// Return bounded hooks that future saga producers may reference without touching old worlds.
function getLegacySagaHooks(state) {
  const legacy = state && state.worldLegacy;
  return {
    institutions: Array.isArray(legacy && legacy.institutions)
      ? legacy.institutions.map(copyRecord) : [],
    echoes: Array.isArray(legacy && legacy.echoes)
      ? legacy.echoes.map(copyRecord) : [],
    memorials: Array.isArray(legacy && legacy.memorials)
      ? legacy.memorials.map(copyRecord) : [],
  };
}

// Build a compact read model for transition and telemetry consumers.
function buildLegacySummary(legacy) {
  const source = legacy || createWorldLegacyState();
  const latestCycle = Array.isArray(source.cycles) && source.cycles.length > 0
    ? source.cycles[source.cycles.length - 1] : null;
  return {
    title: latestCycle ? latestCycle.title : 'World Legacy',
    completedCycles: safeCount(source.stats && source.stats.completedCycles),
    records: countLegacyRecords(source),
    identities: Array.isArray(source.identities) ? source.identities.length : 0,
    memorials: Array.isArray(source.memorials) ? source.memorials.length : 0,
    institutions: Array.isArray(source.institutions) ? source.institutions.length : 0,
    echoes: Array.isArray(source.echoes) ? source.echoes.length : 0,
  };
}

// Create one guaranteed record per completed cycle, including peaceful cycles.
function buildCycleLegacy(chronicle) {
  const cycle = safeCount(chronicle.cycle);
  const summary = chronicle.summary && typeof chronicle.summary === 'object' ? chronicle.summary : {};
  const sourceEventIds = uniqueStrings(
    (summary.highlights || []).flatMap((entry) => entry && entry.sourceEventIds || []),
    12,
  );
  return {
    id: `legacy_cycle_${cycle}`,
    sourceCycle: cycle,
    title: shortText(summary.title || `Cycle ${cycle + 1} Legacy`, 96),
    completedTick: safeCount(chronicle.completedTick),
    claimCount: safeCount(summary.claimCount),
    chapterCount: safeCount(summary.chapterCount),
    sourceEventIds,
  };
}

// Select important actor snapshots from Chronicle evidence.
function buildIdentityRecords(previousState, chronicle, config, settings) {
  if (settings.identitiesPerCycle <= 0) return [];
  const candidates = sortedEvidence(chronicle);
  const byId = new Map();
  for (const evidence of candidates) {
    for (const actor of Array.isArray(evidence.actors) ? evidence.actors : []) {
      if (!actor || !actor.id || byId.has(String(actor.id))) continue;
      const live = (previousState?.dwarves || []).find((dwarf) => dwarf && String(dwarf.id) === String(actor.id));
      const identity = actor.kind === 'dwarf'
        ? resolveDwarfIdentity(live || actor.id, previousState, config) : null;
      byId.set(String(actor.id), {
        id: `legacy_identity_c${safeCount(chronicle.cycle)}_${safeId(actor.id)}`,
        actorId: shortText(actor.id, 96),
        kind: shortText(actor.kind || 'unknown', 32),
        label: shortText(actor.label || actor.id, 96),
        name: shortText(identity && identity.name, 96),
        house: shortText(identity && identity.house, 96),
        roleTitle: shortText(identity && identity.roleTitle, 64),
        role: shortText(actor.role || 'participant', 32),
        scars: uniqueStrings(live?.warrior?.scars, 4),
        titles: uniqueStrings(live?.warrior?.titles, 4),
        importance: normalizeImportance(evidence.importance),
        sourceCycle: safeCount(chronicle.cycle),
        sourceChapterId: findChronicleChapterId(chronicle, evidence.eventId),
        sourceEventIds: [shortText(evidence.eventId, 128)],
      });
      if (byId.size >= settings.identitiesPerCycle) return [...byId.values()];
    }
  }
  return [...byId.values()];
}

// Archive named place identity without retaining coordinates from the old terrain.
function buildPlaceRecords(previousState, chronicle, settings) {
  if (settings.placesPerCycle <= 0) return [];
  const results = [];
  const seen = new Set();
  for (const evidence of sortedEvidence(chronicle)) {
    const location = evidence && evidence.location;
    if (!location || (!location.placeId && !location.label)) continue;
    const sourcePlaceId = shortText(location.placeId || `label_${safeId(location.label)}`, 96);
    if (seen.has(sourcePlaceId)) continue;
    seen.add(sourcePlaceId);
    const authoritative = previousState && previousState.places && previousState.places.byId
      ? previousState.places.byId[location.placeId] : null;
    results.push({
      id: `legacy_place_c${safeCount(chronicle.cycle)}_${safeId(sourcePlaceId)}`,
      sourcePlaceId,
      label: shortText(location.label || authoritative && authoritative.name || sourcePlaceId, 96),
      kind: shortText(authoritative && authoritative.kind || inferEchoKind(evidence), 32),
      sourceScope: location.scope === 'underrealm' ? 'underrealm' : 'surface',
      sourceDepth: safeCount(location.depth),
      sourceCycle: safeCount(chronicle.cycle),
      sourceChapterId: findChronicleChapterId(chronicle, evidence.eventId),
      sourceEventIds: [shortText(evidence.eventId, 128)],
    });
    if (results.length >= settings.placesPerCycle) break;
  }
  return results;
}

// Turn the strongest witnessed actor deeds into memorial records.
function buildMemorialRecords(chronicle, settings) {
  if (settings.memorialsPerCycle <= 0) return [];
  const results = [];
  for (const evidence of sortedEvidence(chronicle)) {
    if (importanceRank(evidence.importance) < importanceRank(settings.memorialImportance)) continue;
    const actor = (evidence.actors || []).find((entry) => entry && entry.id);
    if (!actor) continue;
    const form = String(evidence.type || '').includes('death') ? 'tomb'
      : String(evidence.type || '').includes('champion') ? 'statue' : 'ancestor_hall';
    results.push({
      id: `legacy_memorial_c${safeCount(chronicle.cycle)}_${safeId(actor.id)}`,
      actorId: shortText(actor.id, 96),
      label: shortText(`${actor.label || actor.id} ${form.replace('_', ' ')}`, 120),
      form,
      sourceCycle: safeCount(chronicle.cycle),
      sourceChapterId: findChronicleChapterId(chronicle, evidence.eventId),
      sourceEventIds: [shortText(evidence.eventId, 128)],
    });
    if (results.length >= settings.memorialsPerCycle) break;
  }
  return results;
}

// Preserve one named institution and an inert, capped modifier hook per cycle.
function buildInstitutionRecords(previousState, chronicle, settings) {
  if (settings.institutionsPerCycle <= 0) return [];
  const identity = previousState?.warriors?.company?.identity || {};
  const cycle = safeCount(chronicle.cycle);
  const name = shortText(identity.name || `Keepers of Cycle ${cycle + 1}`, 96);
  const motto = shortText(identity.motto || chronicle?.summary?.title || 'Memory endures.', 160);
  const records = [];
  const mythEvidence = sortedEvidence(chronicle).find((entry) => entry && entry.category === 'myth');
  if (mythEvidence) {
    const claim = findChronicleClaim(chronicle, mythEvidence.eventId);
    records.push({
      id: `legacy_institution_c${cycle}_myth_keepers`,
      name: `Myth Keepers of Cycle ${cycle + 1}`,
      motto: shortText(claim && claim.text || 'The old songs endure.', 160),
      sourceCycle: cycle,
      sourceChapterId: findChronicleChapterId(chronicle, mythEvidence.eventId),
      sourceEventIds: [shortText(mythEvidence.eventId, 128)],
      modifier: buildModifier(settings),
    });
  }
  records.push({
    id: `legacy_institution_c${cycle}_${safeId(name)}`,
    name,
    motto,
    sourceCycle: cycle,
    sourceChapterId: 'legacy',
    sourceEventIds: uniqueStrings(
      (chronicle?.summary?.highlights || []).flatMap((entry) => entry && entry.sourceEventIds || []),
      8,
    ),
    modifier: buildModifier(settings),
  });
  return records.slice(0, settings.institutionsPerCycle);
}

function buildModifier(settings) {
  return {
    id: 'legacy_resolve',
    magnitude: Math.min(settings.modifierCap, settings.modifierPerCycle),
    cap: settings.modifierCap,
    applied: false,
  };
}

// Create geographic echo intents whose coordinates are assigned only in the new world.
function buildEchoRecords(chronicle, memorials, settings) {
  if (!settings.echoesEnabled || settings.echoesPerCycle <= 0) return [];
  const results = [];
  const places = buildPlaceRecords(null, chronicle, settings);
  for (const place of places) {
    results.push({
      id: `legacy_echo_c${safeCount(chronicle.cycle)}_${safeId(place.sourcePlaceId)}`,
      kind: normalizeEchoKind(place.kind),
      label: shortText(`Echo of ${place.label}`, 96),
      sourceCycle: safeCount(chronicle.cycle),
      sourcePlaceId: place.sourcePlaceId,
      sourceEventIds: place.sourceEventIds.slice(),
      sourceChapterId: place.sourceChapterId,
      location: null,
    });
    if (results.length >= settings.echoesPerCycle) return results;
  }
  for (const memorial of memorials) {
    results.push({
      id: `legacy_echo_${safeId(memorial.id)}`,
      kind: memorial.form === 'tomb' ? 'ancestral_ruin' : 'ancestor_hall',
      label: shortText(memorial.label, 96),
      sourceCycle: memorial.sourceCycle,
      sourceActorId: memorial.actorId,
      sourceEventIds: memorial.sourceEventIds.slice(),
      sourceChapterId: memorial.sourceChapterId,
      location: null,
    });
    if (results.length >= settings.echoesPerCycle) break;
  }
  return results;
}

// Deterministically map every retained echo to a valid free cell in the current terrain.
function remapLegacyEchoes(state, config) {
  const settings = getWorldLegacySettings(config);
  const echoes = Array.isArray(state?.worldLegacy?.echoes) ? state.worldLegacy.echoes : [];
  const terrain = state && state.terrain;
  if (!settings.echoesEnabled || !terrain || !Array.isArray(terrain.walkable)) return echoes;
  const cells = [];
  for (let y = 0; y < terrain.walkable.length; y += 1) {
    for (let x = 0; x < (terrain.walkable[y] || []).length; x += 1) {
      if (terrain.walkable[y][x]) cells.push({ x, y });
    }
  }
  const occupied = collectOccupiedCells(state);
  const terrainSeed = safeCount(terrain.seed);
  for (const echo of echoes) {
    if (cells.length === 0) {
      echo.location = null;
      continue;
    }
    const start = hashString(`${terrainSeed}|${echo.id}`) % cells.length;
    let selected = null;
    for (let offset = 0; offset < cells.length; offset += 1) {
      const cell = cells[(start + offset) % cells.length];
      if (!occupied.has(`${cell.x},${cell.y}`)) {
        selected = cell;
        occupied.add(`${cell.x},${cell.y}`);
        break;
      }
    }
    if (!selected) selected = cells[start];
    const placeId = `legacy_site_${safeId(echo.id)}`;
    const place = registerPlace(state, config, {
      id: placeId,
      kind: echo.kind === 'ancient_road' ? 'road' : echo.kind === 'lost_hold' ? 'village' : 'ruins',
      name: echo.label,
      shortName: `Legacy C${echo.sourceCycle + 1}`,
      x: selected.x,
      y: selected.y,
    });
    echo.location = {
      scope: 'surface', x: selected.x, y: selected.y,
      placeId: place ? place.id : placeId,
      label: echo.label,
      mappedCycle: safeCount(state?.cycleStats?.count),
    };
  }
  return echoes;
}

function getWorldLegacySettings(config) {
  const raw = config && config.world_legacy || {};
  const retention = raw.retention || {};
  const selection = raw.selection || {};
  const modifiers = raw.institutions && raw.institutions.modifiers || {};
  const echoes = raw.echoes || {};
  return {
    enabled: raw.enabled !== false,
    maxCycles: clampInt(retention.max_cycles, 1, 16, 5),
    maxIdentities: clampInt(retention.max_identities, 1, 256, 32),
    maxPlaces: clampInt(retention.max_places, 1, 128, 24),
    maxMemorials: clampInt(retention.max_memorials, 1, 64, 12),
    maxInstitutions: clampInt(retention.max_institutions, 1, 32, 8),
    maxEchoes: clampInt(retention.max_echoes, 1, 64, 12),
    maxTotal: clampInt(retention.max_total_records, 6, 384, 96),
    identitiesPerCycle: clampInt(selection.max_identities_per_cycle, 0, 16, 4),
    placesPerCycle: clampInt(selection.max_places_per_cycle, 0, 12, 3),
    memorialsPerCycle: clampInt(selection.max_memorials_per_cycle, 0, 4, 1),
    institutionsPerCycle: clampInt(selection.max_institutions_per_cycle, 0, 2, 1),
    echoesPerCycle: clampInt(selection.max_echoes_per_cycle, 0, 4, 2),
    memorialImportance: normalizeImportance(selection.memorial_minimum_importance || 'critical'),
    modifierPerCycle: clampNumber(modifiers.per_cycle, 0, 0.05, 0.005),
    modifierCap: clampNumber(modifiers.total_cap, 0, 0.1, 0.02),
    echoesEnabled: echoes.enabled !== false,
  };
}

function enforceLegacyBounds(legacy, settings) {
  const caps = {
    cycles: settings.maxCycles,
    identities: settings.maxIdentities,
    places: settings.maxPlaces,
    memorials: settings.maxMemorials,
    institutions: settings.maxInstitutions,
    echoes: settings.maxEchoes,
  };
  for (const field of RECORD_FIELDS) {
    const list = Array.isArray(legacy[field]) ? legacy[field] : [];
    list.sort(compareRecords);
    if (list.length > caps[field]) {
      legacy.stats.evictedRecords += list.length - caps[field];
      legacy[field] = list.slice(-caps[field]);
    } else {
      legacy[field] = list;
    }
  }
  enforceInstitutionModifierCap(legacy.institutions, settings.modifierCap);
  const evictionOrder = ['identities', 'places', 'echoes', 'memorials', 'institutions', 'cycles'];
  while (countLegacyRecords(legacy) > settings.maxTotal) {
    const field = evictionOrder.find((name) => legacy[name].length > (name === 'cycles' ? 1 : 0));
    if (!field) break;
    legacy[field].shift();
    legacy.stats.evictedRecords += 1;
  }
  return legacy;
}

// Keep the aggregate inherited modifier budget bounded even across many cycles.
function enforceInstitutionModifierCap(institutions, totalCap) {
  let remaining = Math.max(0, Number(totalCap || 0));
  for (let index = institutions.length - 1; index >= 0; index -= 1) {
    const record = institutions[index];
    if (!record.modifier || typeof record.modifier !== 'object') continue;
    const requested = clampNumber(record.modifier.magnitude, 0, 0.1, 0);
    record.modifier.magnitude = Math.min(requested, remaining);
    record.modifier.cap = totalCap;
    record.modifier.applied = false;
    remaining = Math.max(0, remaining - record.modifier.magnitude);
  }
}

function sanitizeRecordList(value, field, settings) {
  if (!Array.isArray(value)) return [];
  const limit = {
    cycles: settings.maxCycles, identities: settings.maxIdentities, places: settings.maxPlaces,
    memorials: settings.maxMemorials, institutions: settings.maxInstitutions, echoes: settings.maxEchoes,
  }[field];
  return value.filter((entry) => entry && typeof entry === 'object' && entry.id)
    .map((entry) => sanitizeRecord(entry, field)).sort(compareRecords).slice(-limit);
}

function sanitizeRecord(record, field) {
  const result = {
    id: shortText(record.id, 128),
    sourceCycle: safeCount(record.sourceCycle),
    sourceEventIds: uniqueStrings(record.sourceEventIds, 12),
  };
  const fields = ['title', 'actorId', 'kind', 'label', 'name', 'house', 'roleTitle', 'role',
    'importance', 'sourcePlaceId', 'sourceScope', 'sourceChapterId', 'form', 'motto', 'sourceActorId'];
  for (const key of fields) if (record[key] !== undefined) result[key] = shortText(record[key], key === 'motto' ? 160 : 120);
  for (const key of ['completedTick', 'claimCount', 'chapterCount', 'sourceDepth']) {
    if (record[key] !== undefined) result[key] = safeCount(record[key]);
  }
  if (field === 'identities') {
    result.scars = uniqueStrings(record.scars, 4);
    result.titles = uniqueStrings(record.titles, 4);
  }
  if (field === 'institutions' && record.modifier && typeof record.modifier === 'object') {
    result.modifier = {
      id: shortText(record.modifier.id || 'legacy_resolve', 48),
      magnitude: clampNumber(record.modifier.magnitude, 0, 0.1, 0),
      cap: clampNumber(record.modifier.cap, 0, 0.1, 0),
      applied: false,
    };
    result.modifier.magnitude = Math.min(result.modifier.magnitude, result.modifier.cap);
  }
  if (field === 'echoes') result.location = sanitizeMappedLocation(record.location);
  return result;
}

function migrateVersionZero(raw) {
  const cycles = Array.isArray(raw.history) ? raw.history.map((entry, index) => ({
    id: entry && entry.id || `legacy_cycle_${safeCount(entry && entry.cycle !== undefined ? entry.cycle : index)}`,
    sourceCycle: safeCount(entry && entry.cycle !== undefined ? entry.cycle : index),
    title: entry && (entry.title || entry.summary) || `Cycle ${index + 1} Legacy`,
    sourceEventIds: entry && entry.sourceEventIds || [],
  })) : raw.cycles;
  return { ...raw, cycles };
}

function sortedEvidence(chronicle) {
  return (Array.isArray(chronicle && chronicle.evidence) ? chronicle.evidence : []).slice().sort((a, b) =>
    importanceRank(b && b.importance) - importanceRank(a && a.importance)
    || safeCount(b && b.tick) - safeCount(a && a.tick)
    || String(a && a.eventId || '').localeCompare(String(b && b.eventId || '')));
}

function findChronicleChapterId(chronicle, eventId) {
  for (const chapter of Array.isArray(chronicle && chronicle.chapters) ? chronicle.chapters : []) {
    for (const claim of Array.isArray(chapter && chapter.claims) ? chapter.claims : []) {
      if ((claim.sourceEventIds || []).includes(eventId)) return shortText(chapter.id, 48);
    }
  }
  return 'legacy';
}

function findChronicleClaim(chronicle, eventId) {
  for (const chapter of Array.isArray(chronicle && chronicle.chapters) ? chronicle.chapters : []) {
    const claim = (chapter.claims || []).find((entry) => (entry.sourceEventIds || []).includes(eventId));
    if (claim) return claim;
  }
  return null;
}

function mergeRecords(target, additions, key) {
  const index = new Map(target.map((entry, position) => [entry[key], position]));
  for (const addition of additions) {
    if (!addition || !addition[key]) continue;
    const existing = index.get(addition[key]);
    if (existing === undefined) {
      index.set(addition[key], target.length);
      target.push(addition);
    } else if (safeCount(addition.sourceCycle) >= safeCount(target[existing].sourceCycle)) {
      target[existing] = addition;
    }
  }
}

function collectOccupiedCells(state) {
  const occupied = new Set();
  for (const list of [state?.nodes, state?.structures, state?.dwarves]) {
    for (const entry of Array.isArray(list) ? list : []) {
      if (Number.isSafeInteger(entry?.x) && Number.isSafeInteger(entry?.y)) occupied.add(`${entry.x},${entry.y}`);
    }
  }
  return occupied;
}

function sanitizeMappedLocation(location) {
  if (!location || typeof location !== 'object') return null;
  const x = Number(location.x);
  const y = Number(location.y);
  if (!Number.isSafeInteger(x) || x < 0 || !Number.isSafeInteger(y) || y < 0) return null;
  return {
    scope: 'surface', x, y,
    placeId: shortText(location.placeId, 96),
    label: shortText(location.label, 96),
    mappedCycle: safeCount(location.mappedCycle),
  };
}

function inferEchoKind(evidence) {
  const type = String(evidence && evidence.type || '');
  if (type.includes('road')) return 'road';
  if (type.includes('village') || type.includes('found')) return 'village';
  return 'ruins';
}

function normalizeEchoKind(kind) {
  if (kind === 'road') return 'ancient_road';
  if (kind === 'village') return 'lost_hold';
  if (kind === 'ancestor_hall') return 'ancestor_hall';
  return 'ancestral_ruin';
}

function compareRecords(left, right) {
  return safeCount(left && left.sourceCycle) - safeCount(right && right.sourceCycle)
    || String(left && left.id || '').localeCompare(String(right && right.id || ''));
}

function countLegacyRecords(legacy) {
  return RECORD_FIELDS.reduce((sum, field) => sum + (Array.isArray(legacy && legacy[field]) ? legacy[field].length : 0), 0);
}

function countRawRecords(raw) {
  return RECORD_FIELDS.reduce((sum, field) => sum + (Array.isArray(raw && raw[field]) ? raw[field].length : 0), 0);
}

function uniqueStrings(values, limit) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => shortText(value, 128)).filter(Boolean))].slice(0, limit);
}

function normalizeImportance(value) {
  const normalized = String(value || '').toLowerCase();
  return IMPORTANCE.includes(normalized) ? normalized : 'ambient';
}

function importanceRank(value) {
  return Math.max(0, IMPORTANCE.indexOf(normalizeImportance(value)));
}

function shortText(value, limit) {
  return String(value || '').trim().slice(0, limit);
}

function safeId(value) {
  return shortText(value, 96).toLowerCase().replace(/[^a-z0-9._-]+/g, '_') || 'unknown';
}

function safeCount(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function copyRecord(record) {
  return JSON.parse(JSON.stringify(record));
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

module.exports = {
  WORLD_LEGACY_SCHEMA_VERSION,
  createWorldLegacyState,
  migrateWorldLegacyState,
  ensureWorldLegacyState,
  carryWorldLegacyAcrossCycle,
  remapLegacyEchoes,
  getLegacySagaHooks,
  buildLegacySummary,
  getWorldLegacySettings,
  countLegacyRecords,
};
