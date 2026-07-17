'use strict';

const { buildDwarfLore, getLoreSeed, resolveRoleTitle } = require('./dwarf_lore');

const IDENTITY_CACHE_KIND = 'dwarf_identity_cache_v1';
const DEFAULT_CACHE_LIMIT = 512;
const STATIC_LORE_CACHE_LIMIT = 2048;
const STATIC_LORE_CACHE = new Map();

// Create one explicitly bounded cache for a render/report operation.
function createDwarfIdentityCache(maxEntries = DEFAULT_CACHE_LIMIT) {
  const numericLimit = Number(maxEntries);
  return {
    kind: IDENTITY_CACHE_KIND,
    maxEntries: Number.isFinite(numericLimit) ? Math.max(1, Math.floor(numericLimit)) : DEFAULT_CACHE_LIMIT,
    identities: new Map(),
    liveIndex: new Map(),
    liveSignature: '',
    historyIndex: new Map(),
    historySignature: '',
  };
}

// Resolve one stable dwarf identity from live state, retained facts, or a safe ID fallback.
function resolveDwarfIdentity(dwarfOrId, state, config, options = {}) {
  const suppliedDwarf = dwarfOrId && typeof dwarfOrId === 'object' ? dwarfOrId : null;
  const id = String(suppliedDwarf && suppliedDwarf.id || dwarfOrId || '').trim();
  const cache = isIdentityCache(options.cache) ? options.cache : null;
  const liveDwarf = suppliedDwarf || findLiveDwarf(id, state, cache);
  const historical = liveDwarf ? null : findHistoricalIdentity(id, state, cache, options.snapshot);
  const status = resolveIdentityStatus(liveDwarf, historical);
  const role = String(liveDwarf && liveDwarf.role || '').trim();
  const seed = getLoreSeed(state, config);
  const historicalName = String(historical && historical.name || '').trim();
  const historicalHouse = String(historical && historical.house || '').trim();
  const historicalRoleTitle = String(historical && historical.roleTitle || '').trim();
  const cacheKey = [seed, id, role, status, historicalName, historicalHouse, historicalRoleTitle].join('|');
  if (cache && cache.identities.has(cacheKey)) {
    return cache.identities.get(cacheKey);
  }

  const lore = liveDwarf ? resolveStaticLore(liveDwarf, state, config, seed) : null;
  const name = String(lore && lore.name || historicalName || '').trim();
  const house = String(lore && lore.house || historicalHouse || '').trim();
  const roleTitle = String(
    liveDwarf
      ? resolveRoleTitle(liveDwarf)
      : historicalRoleTitle || fallbackHistoricalRoleTitle(status),
  ).trim();
  const fallbackId = id || 'n/a';
  const displayName = name || 'Unknown';
  const identity = Object.freeze({
    id: fallbackId,
    name: displayName,
    displayName,
    house,
    roleTitle,
    status,
    source: liveDwarf ? 'live' : historical ? historical.source : 'fallback',
    fallbackId,
    label: `${displayName} <${fallbackId}>`,
  });
  cacheIdentity(cache, cacheKey, identity);
  return identity;
}

// Cache only seed/id-stable lore fields across frames; dynamic role status stays operation-local.
function resolveStaticLore(dwarf, state, config, seed) {
  const id = String(dwarf && dwarf.id || '');
  const key = `${seed}|${id}`;
  if (STATIC_LORE_CACHE.has(key)) {
    return STATIC_LORE_CACHE.get(key);
  }
  const lore = buildDwarfLore(dwarf, state, config);
  const stable = Object.freeze({
    name: String(lore && lore.name || '').trim(),
    house: String(lore && lore.house || '').trim(),
  });
  STATIC_LORE_CACHE.set(key, stable);
  trimMap(STATIC_LORE_CACHE, STATIC_LORE_CACHE_LIMIT);
  return stable;
}

// Format one public identity label while retaining the stable ID for inspection.
function formatDwarfIdentity(dwarfOrId, state, config, options = {}) {
  return resolveDwarfIdentity(dwarfOrId, state, config, options).label;
}

// Resolve compact message names, adding house/ID context only to disambiguate collisions.
function resolveDwarfMessageNames(dwarvesOrIds, state, config, options = {}) {
  const cache = isIdentityCache(options.cache)
    ? options.cache
    : createDwarfIdentityCache();
  const identities = (Array.isArray(dwarvesOrIds) ? dwarvesOrIds : [dwarvesOrIds])
    .filter((entry) => entry !== null && entry !== undefined)
    .map((entry) => resolveDwarfIdentity(entry, state, config, { cache }))
    .filter((identity, index, entries) => (
      entries.findIndex((candidate) => candidate.id === identity.id) === index
    ));
  const baseCounts = countStrings(identities.map((identity) => identity.displayName));
  const names = identities.map((identity) => {
    if (identity.name === 'Unknown') {
      return identity.label;
    }
    if (baseCounts.get(identity.displayName) > 1 && identity.house) {
      return `${identity.displayName} of House ${identity.house}`;
    }
    return identity.displayName;
  });
  const resolvedCounts = countStrings(names);
  return identities.map((identity, index) => ({
    identity,
    messageName: resolvedCounts.get(names[index]) > 1
      ? `${names[index]} <${identity.id}>`
      : names[index],
  }));
}

// Replace dwarf IDs/full inspect labels in one compact event message with readable names.
function formatNamedEventMessage(message, dwarvesOrIds, state, config, options = {}) {
  let formatted = String(message || '').trim();
  const resolved = resolveDwarfMessageNames(dwarvesOrIds, state, config, options);
  const replacements = [];
  for (const entry of resolved) {
    const identity = entry.identity;
    replacements.push([identity.label, entry.messageName]);
    replacements.push([identity.id, entry.messageName]);
  }
  replacements.sort((left, right) => right[0].length - left[0].length);
  const placeholders = [];
  for (const [needle, replacement] of replacements) {
    if (!needle || needle === 'n/a') {
      continue;
    }
    const placeholder = `__ND_DWARF_NAME_${placeholders.length}__`;
    if (!formatted.includes(needle)) {
      continue;
    }
    formatted = formatted.split(needle).join(placeholder);
    placeholders.push([placeholder, replacement]);
  }
  for (const [placeholder, replacement] of placeholders) {
    formatted = formatted.split(placeholder).join(replacement);
  }
  return formatted;
}

// Snapshot bounded identity fields for Hall of Fame and cross-cycle records.
function snapshotDwarfIdentity(dwarfOrId, state, config, options = {}) {
  const identity = resolveDwarfIdentity(dwarfOrId, state, config, options);
  return {
    name: identity.name,
    house: identity.house,
    roleTitle: identity.roleTitle,
  };
}

// Count normalized strings for deterministic collision disambiguation.
function countStrings(values) {
  const counts = new Map();
  for (const value of values) {
    const key = String(value || '');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

// Return true for the dedicated cache contract instead of accepting unbounded generic maps.
function isIdentityCache(value) {
  return Boolean(
    value
    && value.kind === IDENTITY_CACHE_KIND
    && value.identities instanceof Map
    && value.liveIndex instanceof Map
    && value.historyIndex instanceof Map,
  );
}

// Resolve one live dwarf through a requested-ID-only per-tick bounded index.
function findLiveDwarf(id, state, cache) {
  if (!id) {
    return null;
  }
  const dwarves = Array.isArray(state && state.dwarves) ? state.dwarves : [];
  if (!cache) {
    return dwarves.find((entry) => String(entry && entry.id || '') === id) || null;
  }
  const tick = Math.max(0, Math.floor(Number(state && state.tick || 0)));
  const signature = `${tick}|${dwarves.length}|${String(dwarves[0] && dwarves[0].id || '')}|${String(dwarves[dwarves.length - 1] && dwarves[dwarves.length - 1].id || '')}`;
  if (cache.liveSignature !== signature) {
    cache.liveIndex.clear();
    cache.liveSignature = signature;
  }
  if (cache.liveIndex.has(id)) {
    const cached = cache.liveIndex.get(id);
    if (cached && dwarves.includes(cached)) {
      return cached;
    }
    cache.liveIndex.delete(id);
  }
  const dwarf = dwarves.find((entry) => String(entry && entry.id || '') === id) || null;
  if (dwarf) {
    cache.liveIndex.set(id, dwarf);
    trimMap(cache.liveIndex, cache.maxEntries);
  }
  return dwarf;
}

// Resolve retained labels and bounded legacy snapshots without regenerating another cycle's lore.
function findHistoricalIdentity(id, state, cache, suppliedSnapshot) {
  if (!id) {
    return null;
  }
  const explicit = normalizeIdentitySnapshot(suppliedSnapshot, 'snapshot');
  if (explicit && explicit.id === id) {
    return explicit;
  }
  const index = buildHistoricalIndex(state, cache);
  return index.get(id) || null;
}

// Build a newest-fact-first index from bounded Event Log and Warrior legacy state.
function buildHistoricalIndex(state, cache) {
  const eventLog = Array.isArray(state && state.eventLog) ? state.eventLog : [];
  const company = state && state.warriors && state.warriors.company
    ? state.warriors.company
    : {};
  const hall = Array.isArray(company.hallOfFame) ? company.hallOfFame : [];
  const carryover = company.carryover && typeof company.carryover === 'object'
    ? company.carryover
    : {};
  const signature = [
    eventLog.length,
    eventLog[0] && eventLog[0].id,
    hall.length,
    hall[0] && hall[0].dwarfId,
    hall[0] && hall[0].identity && hall[0].identity.name,
    carryover.sourceChampionId,
    carryover.sourceChampionIdentity && carryover.sourceChampionIdentity.name,
  ].join('|');
  if (cache && cache.historySignature === signature) {
    return cache.historyIndex;
  }

  const index = new Map();
  const historyLimit = cache ? cache.maxEntries : DEFAULT_CACHE_LIMIT;
  for (const event of eventLog) {
    const actors = Array.isArray(event && event.actors) ? event.actors : [];
    for (const actor of actors) {
      const actorId = String(actor && actor.kind === 'dwarf' && actor.id || '').trim();
      if (!actorId || index.has(actorId)) {
        continue;
      }
      index.set(actorId, {
        id: actorId,
        name: String(actor.label || '').trim(),
        house: '',
        roleTitle: '',
        status: inferHistoricalEventStatus(event, actorId),
        source: 'event',
      });
      if (index.size >= historyLimit) {
        break;
      }
    }
    if (index.size >= historyLimit) {
      break;
    }
  }
  for (const entry of hall) {
    const dwarfId = String(entry && entry.dwarfId || '').trim();
    if (!dwarfId) {
      continue;
    }
    const snapshot = normalizeIdentitySnapshot(entry.identity, 'hall_of_fame') || {};
    const existing = index.get(dwarfId) || {};
    if (!index.has(dwarfId) && index.size >= historyLimit) {
      continue;
    }
    index.set(dwarfId, {
      id: dwarfId,
      name: String(existing.name || snapshot.name || '').trim(),
      house: String(existing.house || snapshot.house || '').trim(),
      roleTitle: String(existing.roleTitle || snapshot.roleTitle || '').trim(),
      status: ['dead', 'retired'].includes(existing.status) ? existing.status : 'carried_over',
      source: existing.source || 'hall_of_fame',
    });
  }
  const carryId = String(carryover.sourceChampionId || '').trim();
  if (carryId && (index.has(carryId) || index.size < historyLimit)) {
    const snapshot = normalizeIdentitySnapshot(carryover.sourceChampionIdentity, 'carry_over') || {};
    const existing = index.get(carryId) || {};
    index.set(carryId, {
      id: carryId,
      name: String(existing.name || snapshot.name || '').trim(),
      house: String(existing.house || snapshot.house || '').trim(),
      roleTitle: String(existing.roleTitle || snapshot.roleTitle || '').trim(),
      status: ['dead', 'retired'].includes(existing.status) ? existing.status : 'carried_over',
      source: existing.source || 'carry_over',
    });
  }
  if (cache) {
    cache.historyIndex = index;
    cache.historySignature = signature;
  }
  return index;
}

// Normalize one actor or legacy identity snapshot into the shared read model.
function normalizeIdentitySnapshot(snapshot, source) {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }
  const id = String(snapshot.id || snapshot.dwarfId || '').trim();
  const name = String(snapshot.name || snapshot.label || '').trim();
  if (!id && !name) {
    return null;
  }
  return {
    id,
    name,
    house: String(snapshot.house || '').trim(),
    roleTitle: String(snapshot.roleTitle || '').trim(),
    status: String(snapshot.status || 'historical').trim(),
    source,
  };
}

// Classify historical status from committed event facts.
function inferHistoricalEventStatus(event, dwarfId) {
  const type = String(event && event.type || '');
  if (type.includes('death') || type.endsWith('.died')) {
    return 'dead';
  }
  const consequences = Array.isArray(event && event.consequences) ? event.consequences : [];
  if (consequences.some((entry) => entry && entry.kind === 'death' && entry.targetId === dwarfId)) {
    return 'dead';
  }
  if (type === 'warrior.retired') {
    return 'retired';
  }
  return 'historical';
}

// Resolve current status without confusing retired living dwarves with missing history.
function resolveIdentityStatus(liveDwarf, historical) {
  if (liveDwarf) {
    return liveDwarf.warrior && liveDwarf.warrior.retired === true ? 'retired' : 'living';
  }
  return historical && historical.status ? historical.status : 'missing';
}

// Keep historical role wording explicit when no authoritative role snapshot survived.
function fallbackHistoricalRoleTitle(status) {
  if (status === 'dead') {
    return 'Fallen Dwarf';
  }
  if (status === 'retired') {
    return 'Retired Warrior';
  }
  if (status === 'carried_over') {
    return 'Legacy Champion';
  }
  return 'Unknown Role';
}

// Insert one identity with deterministic FIFO eviction under the configured hard cap.
function cacheIdentity(cache, key, identity) {
  if (!cache) {
    return;
  }
  if (cache.identities.has(key)) {
    cache.identities.delete(key);
  }
  cache.identities.set(key, identity);
  trimMap(cache.identities, cache.maxEntries);
}

// Trim insertion-ordered maps deterministically to their hard cap.
function trimMap(map, limit) {
  while (map.size > limit) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

module.exports = {
  createDwarfIdentityCache,
  formatDwarfIdentity,
  formatNamedEventMessage,
  resolveDwarfIdentity,
  resolveDwarfMessageNames,
  snapshotDwarfIdentity,
};
