'use strict';

const PLACE_REGISTRY_SCHEMA_VERSION = 1;
const PLACE_REGISTRY_MAX_ENTRIES = 256;

const NAME_PREFIXES = [
  'Amber', 'Anvil', 'Ashen', 'Basalt', 'Black', 'Brass', 'Bronze', 'Cinder',
  'Copper', 'Deep', 'Ember', 'Flint', 'Forge', 'Garnet', 'Golden', 'Granite',
  'Grey', 'Hammer', 'Iron', 'Jade', 'Obsidian', 'Onyx', 'Quartz', 'Red',
  'Rune', 'Silver', 'Slate', 'Steel', 'Stone', 'Thunder', 'Umber', 'White',
];

const NAME_SUFFIXES = {
  village: [
    'Bastion', 'Burrow', 'Citadel', 'Delve', 'Hallow', 'Hearth', 'Hold', 'Hollow',
    'Keep', 'Rest', 'Spire', 'Stead', 'Vault', 'Watch', 'Ward', 'Warren',
  ],
  road: [
    'Causeway', 'Crossing', 'March', 'Pass', 'Path', 'Road', 'Run', 'Trail',
    'Traverse', 'Way', 'Waystone', 'Route', 'Span', 'Track', 'Walk', 'Wend',
  ],
  gate: [
    'Arch', 'Door', 'Gate', 'Maw', 'Portal', 'Threshold', 'Waygate', 'Wound',
  ],
  lift: [
    'Descent', 'Drop', 'Elevator', 'Hoist', 'Reach', 'Rise', 'Shaft', 'Winch',
  ],
  ruins: [
    'Catacombs', 'Crypt', 'Halls', 'Reliquary', 'Ruins', 'Sepulcher', 'Vaults', 'Wreck',
  ],
  temple: [
    'Chapel', 'Fane', 'Hall', 'Sanctum', 'Shrine', 'Temple', 'Vigil', 'Wake',
  ],
};

// Create the bounded authoritative place registry stored in simulation state.
function createPlaceRegistry() {
  return {
    schemaVersion: PLACE_REGISTRY_SCHEMA_VERSION,
    maxEntries: PLACE_REGISTRY_MAX_ENTRIES,
    order: [],
    byId: {},
    rejected: 0,
  };
}

// Repair legacy or partially serialized registry state without regenerating names.
function ensurePlaceRegistry(state) {
  if (!state || typeof state !== 'object') {
    return null;
  }
  if (!state.places || typeof state.places !== 'object') {
    state.places = createPlaceRegistry();
  }
  const registry = state.places;
  registry.schemaVersion = PLACE_REGISTRY_SCHEMA_VERSION;
  registry.maxEntries = PLACE_REGISTRY_MAX_ENTRIES;
  if (!registry.byId || typeof registry.byId !== 'object' || Array.isArray(registry.byId)) {
    registry.byId = {};
  }
  if (!Array.isArray(registry.order)) {
    registry.order = Object.keys(registry.byId).slice(0, PLACE_REGISTRY_MAX_ENTRIES);
  }
  registry.order = registry.order
    .map((id) => String(id || '').trim())
    .filter((id, index, entries) => id && registry.byId[id] && entries.indexOf(id) === index)
    .slice(0, PLACE_REGISTRY_MAX_ENTRIES);
  registry.rejected = Math.max(0, Math.floor(Number(registry.rejected || 0)));
  return registry;
}

// Register one place once; later calls may refresh coordinates but never rename it.
function registerPlace(state, config, draft) {
  const registry = ensurePlaceRegistry(state);
  const id = normalizePlaceId(draft && draft.id);
  if (!registry || !id) {
    return null;
  }
  const existing = registry.byId[id];
  if (existing) {
    refreshPlaceCoordinates(existing, draft);
    return existing;
  }
  if (registry.order.length >= registry.maxEntries) {
    registry.rejected += 1;
    return null;
  }
  const kind = normalizePlaceKind(draft && draft.kind);
  const seed = resolvePlaceSeed(state, config);
  const name = String(draft && draft.name || '').trim()
    || generatePlaceName(seed, kind, id, draft, registry);
  const record = {
    id,
    kind,
    name,
    shortName: String(draft && draft.shortName || '').trim() || buildShortPlaceName(kind, id, draft),
    scope: draft && draft.scope === 'underrealm' ? 'underrealm' : 'surface',
    depth: normalizeOptionalInteger(draft && draft.depth, 0),
    x: normalizeOptionalInteger(draft && draft.x, null),
    y: normalizeOptionalInteger(draft && draft.y, null),
    createdTick: Math.max(0, Math.floor(Number(state.tick || 0))),
  };
  registry.byId[id] = record;
  registry.order.push(id);
  return record;
}

// Resolve a stored place only; renderers must not synthesize authoritative names.
function resolvePlace(state, placeId) {
  const id = normalizePlaceId(placeId);
  const registry = state && state.places;
  return id && registry && registry.byId && registry.byId[id]
    ? registry.byId[id]
    : null;
}

// Resolve a full or compact persisted label with an explicit safe fallback.
function resolvePlaceLabel(state, placeId, fallback = '', compact = false) {
  const place = resolvePlace(state, placeId);
  if (!place) {
    return String(fallback || placeId || '').trim();
  }
  return String(compact ? place.shortName || place.name : place.name || place.shortName).trim();
}

// Build a canonical event location from one authoritative place record.
function buildPlaceLocation(state, placeId, fallback = null) {
  const place = resolvePlace(state, placeId);
  if (!place) {
    return fallback || { scope: 'world' };
  }
  const location = {
    scope: place.scope,
    depth: place.scope === 'underrealm' ? Math.max(1, Number(place.depth || 1)) : 0,
    placeId: place.id,
    label: place.name,
    shortLabel: place.shortName,
  };
  if (Number.isSafeInteger(place.x) && place.x >= 0 && Number.isSafeInteger(place.y) && place.y >= 0) {
    location.x = place.x;
    location.y = place.y;
  }
  return location;
}

// Find the closest stored surface place among the requested kinds.
function findNearestPlace(state, subject, kinds = ['village']) {
  const registry = state && state.places;
  const x = Number(subject && subject.x);
  const y = Number(subject && subject.y);
  if (!registry || !registry.byId || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  const acceptedKinds = new Set(kinds.map(normalizePlaceKind));
  let best = null;
  let bestDistance = Infinity;
  for (const id of registry.order || []) {
    const place = registry.byId[id];
    if (!place || !acceptedKinds.has(place.kind) || !Number.isFinite(place.x) || !Number.isFinite(place.y)) {
      continue;
    }
    const distance = Math.abs(x - place.x) + Math.abs(y - place.y);
    if (distance < bestDistance || (distance === bestDistance && place.id < best.id)) {
      best = place;
      bestDistance = distance;
    }
  }
  return best;
}

// Register initial map anchors that already exist when state is created.
function bootstrapPlaceRegistry(state, config) {
  ensurePlaceRegistry(state);
  const gate = state && state.underrealm && state.underrealm.discovery
    ? state.underrealm.discovery.surfaceGate
    : null;
  if (gate) {
    registerPlace(state, config, {
      id: 'underrealm_gate', kind: 'gate', shortName: 'Deep Gate', x: gate.x, y: gate.y,
    });
  }
  const layers = Array.isArray(state && state.underrealm && state.underrealm.layers)
    ? state.underrealm.layers
    : [];
  for (const layer of layers) {
    const depth = Math.max(1, Math.floor(Number(layer && layer.depth || 1)));
    registerPlace(state, config, {
      id: `ruins_d${depth}`,
      kind: 'ruins',
      shortName: `Ruins D${depth}`,
      scope: 'underrealm',
      depth,
    });
  }
  return state.places;
}

function generatePlaceName(seed, kind, id, draft, registry) {
  const hash = hashString(`${seed}|${kind}|${id}|${draft && draft.x}|${draft && draft.y}|${draft && draft.depth}`);
  const prefixes = NAME_PREFIXES;
  const suffixes = NAME_SUFFIXES[kind] || NAME_SUFFIXES.village;
  const base = `${prefixes[hash % prefixes.length]} ${suffixes[Math.floor(hash / prefixes.length) % suffixes.length]}`;
  const collision = Object.values(registry.byId).some((place) => place && place.name === base);
  return collision ? `${base} ${hash.toString(36).slice(-2).toUpperCase()}` : base;
}

function buildShortPlaceName(kind, id, draft) {
  const depth = Math.max(0, Math.floor(Number(draft && draft.depth || 0)));
  if (kind === 'village') return `V${extractTrailingNumber(id) || '?'}`;
  if (kind === 'road') return `Road ${shortHash(id)}`;
  if (kind === 'gate') return 'Deep Gate';
  if (kind === 'lift') return `Lift D${depth || extractTrailingNumber(id) || '?'}`;
  if (kind === 'ruins') return `Ruins D${depth || extractTrailingNumber(id) || '?'}`;
  if (kind === 'temple') return 'Ancestor Temple';
  return id.slice(0, 16);
}

function refreshPlaceCoordinates(place, draft) {
  const x = normalizeOptionalInteger(draft && draft.x, place.x);
  const y = normalizeOptionalInteger(draft && draft.y, place.y);
  if (x !== null) place.x = x;
  if (y !== null) place.y = y;
  const depth = normalizeOptionalInteger(draft && draft.depth, place.depth);
  if (depth !== null) place.depth = depth;
}

function resolvePlaceSeed(state, config) {
  if (state && state.terrain && Number.isFinite(Number(state.terrain.seed))) {
    return Math.floor(Number(state.terrain.seed));
  }
  return Math.floor(Number(config && config.display && config.display.terrain && config.display.terrain.seed || 0));
}

function normalizePlaceId(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_').slice(0, 96);
}

function normalizePlaceKind(value) {
  const kind = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(NAME_SUFFIXES, kind) ? kind : 'village';
}

function normalizeOptionalInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : fallback;
}

function extractTrailingNumber(value) {
  const match = String(value || '').match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function shortHash(value) {
  return hashString(String(value || '')).toString(36).slice(-3).toUpperCase();
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
  PLACE_REGISTRY_MAX_ENTRIES,
  bootstrapPlaceRegistry,
  buildPlaceLocation,
  createPlaceRegistry,
  ensurePlaceRegistry,
  findNearestPlace,
  registerPlace,
  resolvePlace,
  resolvePlaceLabel,
};
