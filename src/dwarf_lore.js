'use strict';

const NAME_START = [
  'Bal', 'Bor', 'Dor', 'Dur', 'Eld', 'Far', 'Gar', 'Gim',
  'Grim', 'Hild', 'Krag', 'Krom', 'Kor', 'Lod', 'Mor', 'Nain',
  'Nor', 'Orin', 'Rag', 'Rim', 'Skal', 'Stor', 'Thra', 'Tor',
  'Ulf', 'Var', 'Yor', 'Zan', 'Brom', 'Dain', 'Forn', 'Morn',
  'Ald', 'Bald', 'Brand', 'Beld', 'Dran', 'Ebr', 'Fald', 'Gald',
  'Harn', 'Jor', 'Keld', 'Kurn', 'Lorn', 'Marn', 'Norn', 'Odr',
  'Ror', 'Skar', 'Thom', 'Urd', 'Vorn', 'Wald', 'Yarn', 'Zor',
];

const NAME_END = [
  'adin', 'ain', 'ar', 'bek', 'dan', 'dir', 'dor', 'drim',
  'dur', 'fast', 'gar', 'grim', 'grom', 'helm', 'in', 'kar',
  'lak', 'lin', 'mar', 'mir', 'mund', 'rak', 'rik', 'rin',
  'rum', 'son', 'stor', 'thor', 'vik', 'ward', 'win', 'zor',
  'bar', 'born', 'dain', 'dil', 'din', 'dren', 'dror', 'drun',
  'farn', 'gald', 'gath', 'gorn', 'goth', 'gund', 'hild', 'karn',
  'kron', 'larn', 'loth', 'morn', 'norn', 'rann', 'rond', 'sund',
  'tarn', 'thar', 'thir', 'thram', 'thul', 'vorn', 'wulf', 'zorn',
];

const SURNAME_START = [
  'Stone', 'Iron', 'Gold', 'Copper', 'Bronze', 'Granite', 'Flint', 'Ash',
  'Oak', 'Storm', 'Frost', 'Deep', 'Dark', 'Bright', 'High', 'Low',
  'Red', 'Black', 'White', 'Gray', 'Long', 'Broad', 'Hard', 'Swift',
  'Strong', 'Silent', 'Wild', 'Stout', 'True', 'Far', 'Cold', 'Deepen',
  'Steel', 'Rune', 'Hammer', 'Anvil', 'Ember', 'Shadow', 'Ridge', 'Peak',
  'Forge', 'Cinder', 'River', 'Crag', 'Gloom', 'Sun', 'Moon', 'Root',
  'Grim', 'Dawn', 'Dusk', 'Ironroot', 'Stoneveil', 'Stormhold', 'Boulder', 'Cave',
];

const SURNAME_END = [
  'beard', 'hammer', 'shield', 'axe', 'anvil', 'delver', 'breaker', 'forge',
  'singer', 'keeper', 'watch', 'brow', 'runner', 'seeker', 'ward', 'mantle',
  'helm', 'cleaver', 'mason', 'miner', 'carver', 'bearer', 'hand', 'banner',
  'gaze', 'heart', 'root', 'stone', 'cutter', 'tread', 'hold', 'claw',
  'brand', 'guard', 'warden', 'spire', 'fist', 'stride', 'stride', 'song',
  'grip', 'torch', 'oath', 'drum', 'ring', 'crest', 'spear', 'trail',
  'vault', 'path', 'trace', 'glen', 'forge', 'edge', 'spire', 'scar',
];

const ROLE_TITLES = {
  builder: 'Oathwright',
  gatherer: 'Hearthforager',
  manager: 'Hallmaster',
  brewmaster: 'Barrel-Sage',
};

const TRAIT_ADJECTIVES = [
  'stoic', 'fierce', 'patient', 'grim', 'bold', 'wary', 'curious', 'steadfast',
  'stout', 'loyal', 'proud', 'cunning', 'wily', 'brash', 'gentle', 'stern',
  'resolute', 'restless', 'quiet', 'keen', 'hardy', 'methodical', 'reckless', 'humble',
  'vigilant', 'ironwilled', 'kind', 'grizzled', 'practical', 'dour', 'brave', 'thoughtful',
  'unyielding', 'tenacious', 'measured', 'tempered', 'solemn', 'grave', 'gruff', 'steadyhanded',
  'watchful', 'ironbound', 'steelhearted', 'stubborn', 'reserved', 'shrewd', 'patient', 'level',
];

const TRAIT_NOUNS = [
  'hammer', 'stone', 'mason', 'delver', 'shield', 'torch', 'banner', 'anvil',
  'forge', 'pick', 'beard', 'axeblade', 'sentry', 'warden', 'seeker', 'miner',
  'carver', 'brewer', 'keeper', 'runner', 'tactician', 'scout', 'hearth', 'oak',
  'clan', 'river', 'mountain', 'oath', 'drum', 'song', 'root', 'flame',
  'citadel', 'gate', 'ridge', 'vault', 'cairn', 'spire', 'banner', 'ember',
  'crown', 'chain', 'glade', 'bridge', 'path', 'bastion', 'rune', 'stonewall',
];

const EPITHET_PREFIX = [
  'Oath-Bearer', 'Rune-Warden', 'Stone-Seer', 'Gatekeeper', 'Deep-Delver',
  'Ash-Walker', 'Ironbound', 'Forge-Kin', 'Hammer-Sworn', 'Shieldbound',
  'Crown-Guard', 'Anvil-Blessed', 'Grim-Sworn', 'Storm-Keeper', 'Ridge-Watcher',
  'Hearth-Sentinel', 'Vault-Warden', 'Night-Anchor', 'Steel-Root', 'Ember-Voice',
  'Stone-Caller', 'Oath-Keeper', 'Deep-Anchor', 'Hall-Bound', 'Iron-Hearted',
  'Forge-Guard', 'Cinder-Wise', 'Rune-Bound', 'Peak-Holder', 'Wall-Kin',
];

const EPITHET_SUFFIX = [
  'Deep', 'Silent Hall', 'Ash Gate', 'Iron Ridge', 'Black Stone',
  'Frosted Pass', 'Copper Hollow', 'Rune Vault', 'Stone Crown', 'Storm Wall',
  'Sundered Road', 'Hidden Forge', 'Red River', 'Obsidian Stair', 'Oath-Bridge',
  'Hollow Peak', 'Granite Keep', 'Old Hearth', 'Winter Gate', 'Dawn Anvil',
  'Gloom Hollow', 'Wyrm Pass', 'Cinder Rise', 'Stone Sea', 'Ashen Gate',
  'Iron Hollow', 'Frost Hall', 'Thunder Stair', 'Far Forge', 'Crag Watch',
];

const TABOOS = [
  'Never spill the first mug', 'Never break an oath', 'Never leave a comrade behind',
  'Never speak before the elder', 'Never sleep without a blade near',
  'Never boast before the forge', 'Never waste good iron', 'Never cross a sealed gate',
  'Never mock the deep', 'Never refuse a call to the wall',
  'Never dull the clan blade', 'Never lie in a stone hall', 'Never waste winter stores',
  'Never strike the first blow in peace', 'Never refuse a stranger at the hearth',
  'Never carve a name in vain', 'Never drink before duty', 'Never desert the watch',
];

const MARKS = [
  'Rune-scar on the left palm', 'Braided beard bound with iron wire',
  'Hammer-shaped birthmark on the brow', 'Scar across the knuckles',
  'Blackened fingertips from the forge', 'Notch cut into the right ear',
  'Tattoo of a crown on the forearm', 'Ring of copper on the thumb',
  'Ash-gray streak in the beard', 'Chisel mark along the jaw',
  'Split knuckle from a cave-in', 'Line of runes along the collarbone',
  'Bronze rivet stud in the ear', 'Storm-burned wrist', 'Scarred brow ridge',
  'Tattoo of a gate on the shoulder', 'Charcoal mark across the nose',
];

const HOUSE_PREFIX = [
  'Stone', 'Iron', 'Ash', 'Ember', 'Frost', 'Granite', 'Rune', 'Storm',
  'Deep', 'Bright', 'Dark', 'Gold', 'Copper', 'Steel', 'Black', 'White',
  'Red', 'Gray', 'Oak', 'Cinder', 'Crag', 'Boulder', 'Hollow', 'Dawn',
  'Dusk', 'Silver', 'Shadow', 'Flint', 'High', 'Low', 'Torch', 'Vault',
];

const HOUSE_SUFFIX = [
  'Ash', 'Forge', 'Root', 'Hall', 'Gate', 'Crown', 'Ridge', 'Ward',
  'Watch', 'Hearth', 'Stone', 'Anvil', 'Shield', 'Hammer', 'Hold', 'Vale',
  'Deep', 'Reach', 'Run', 'Keep', 'Spire', 'Glen', 'Road', 'Bridge',
  'Bastion', 'Haven', 'Trail', 'Oath', 'Peak', 'Cave', 'Pass', 'Hill',
];

const RANKS = [
  'Oath-Taker', 'Rune-Knight', 'Forge Adept', 'Deep Warden', 'Hall Sentinel',
  'Stone Captain', 'Anvil Marshal', 'Cinder Warden', 'Vault Keeper', 'Iron Guard',
  'Hearth Warden', 'Gate Captain', 'Ridge Keeper', 'Storm Sentinel', 'Rune Adept',
  'Crown Watcher', 'Shield Marshal', 'Dusk Warden', 'Ash Captain', 'Forge Captain',
];

const ARCHETYPES = [
  'Sentinel', 'Delver', 'Wayfarer', 'Hearthkeeper', 'Warden', 'Chronicler',
  'Pathfinder', 'Oathbearer', 'Stonewright', 'Shieldbearer', 'Forgekin',
  'Wardcaller', 'Ridgewatcher', 'Gatebound', 'Vaultseer', 'Hallbinder',
];

const VIRTUES = [
  'Patience', 'Resolve', 'Honor', 'Valor', 'Mercy', 'Discipline', 'Loyalty',
  'Calm', 'Tenacity', 'Wisdom', 'Steadiness', 'Courage', 'Duty', 'Justice',
  'Temperance', 'Focus',
];

const FLAWS = [
  'Pride', 'Wrath', 'Stubbornness', 'Doubt', 'Greed', 'Restlessness',
  'Impulsiveness', 'Ruthlessness', 'Jealousy', 'Fear', 'Rigidity', 'Melancholy',
  'Obsession', 'Vengeance', 'Suspicion', 'Aloofness',
];

const TOTEM_ADJECTIVES = [
  'Black', 'Iron', 'Stone', 'Ashen', 'Frost', 'Ember', 'Rune', 'Silver',
  'Golden', 'Granite', 'Storm', 'Deep', 'Red', 'White', 'Shadow', 'Bright',
];

const TOTEM_BEASTS = [
  'Ram', 'Stag', 'Bear', 'Wolf', 'Boar', 'Eagle', 'Raven', 'Hawk',
  'Serpent', 'Fox', 'Bull', 'Goat', 'Owl', 'Mole', 'Lynx', 'Hound',
];

const VOW_VERBS = [
  'Guard', 'Hold', 'Keep', 'Shield', 'Uphold', 'Carry', 'Protect', 'Forge',
  'Honor', 'Defy', 'Stand', 'Follow', 'Bear', 'Mark', 'Tend', 'Seek',
];

const VOW_OBJECTS = [
  'the last gate', 'the deep hall', 'the clan oath', 'the hearth', 'the old forge',
  'the watch', 'the stone road', 'the iron ridge', 'the forgotten vault', 'the high hall',
  'the silent bridge', 'the ash stair', 'the winter pass', 'the rune vault',
];

const VOW_QUALIFIERS = [
  'to the end', 'in silence', 'without fear', 'by stone', 'by steel',
  'through winter', 'for the fallen', 'for the clan', 'in the deep',
  'under oath', 'through storm', 'beneath the mountain',
];

const RUNES = [
  'ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᚷ', 'ᚹ',
  'ᚺ', 'ᚾ', 'ᛁ', 'ᛃ', 'ᛇ', 'ᛈ', 'ᛉ', 'ᛋ',
  'ᛏ', 'ᛒ', 'ᛖ', 'ᛗ', 'ᛚ', 'ᛜ', 'ᛟ', 'ᛞ',
];

const BLAZON_FIELDS = [
  'obsidian field', 'granite field', 'iron field', 'ash field', 'storm field',
  'frost field', 'ember field', 'coal field', 'slate field', 'blood-red field',
  'steel field', 'bone field', 'stone field', 'dawn field', 'dusk field',
];

const BLAZON_CHARGES = [
  'golden anvil', 'iron hammer', 'silver pick', 'bronze shield', 'rune crown',
  'stone tower', 'iron gate', 'ember torch', 'black axe', 'oak stag',
  'iron helm', 'broken chain', 'stone ram', 'twin axes', 'rune key',
];

const BLAZON_TRIMS = [
  'iron trim', 'gold trim', 'bronze trim', 'copper trim', 'stone trim',
  'steel trim', 'ash trim', 'rune trim', 'obsidian trim', 'frost trim',
  'ember trim', 'dawn trim', 'coal trim', 'shadow trim', 'storm trim',
];

const OATH_OBJECTS = [
  'the Iron Gate', 'the Deep Hall', 'the Granite Oath', 'the Ember Watch',
  'the Stone Crown', 'the Rune Vault', 'the Black Ridge', 'the Hearth Wall',
  'the Old Forge', 'the Last Bridge', 'the Silent Path', 'the High Anvil',
  'the Storm Wall', 'the Cold Road', 'the Ashen Stair', 'the Warden Keep',
  'the Iron Oath', 'the Deep Watch',
];

const MOTTO_VERBS = [
  'Hold', 'Guard', 'Forge', 'Stand', 'Endure', 'Carve', 'Delve', 'Raise',
  'Keep', 'Strike', 'Honor', 'Tend', 'Drive', 'Seek', 'Lift', 'Temper',
  'Bind', 'Break', 'Build', 'Bear', 'Hew', 'Mine', 'Ward', 'Prove',
  'Mark', 'Anchor', 'Steady', 'Shape', 'Follow', 'Remember', 'Protect', 'Bend',
  'Fortify', 'Shelter', 'Harden', 'Cleave', 'Defy', 'Guard', 'Uphold', 'Light',
];

const MOTTO_OBJECTS = [
  'the deep', 'the line', 'the mountain', 'the hearth', 'the gate', 'the oath', 'the forge', 'the hall',
  'the stone', 'the clan', 'the root', 'the river', 'the fire', 'the hammer', 'the anvil', 'the banner',
  'the shield', 'the path', 'the wall', 'the crown', 'the drum', 'the song', 'the steel', 'the axe',
  'the mark', 'the watch', 'the beacon', 'the vault', 'the code', 'the bridge', 'the ridge', 'the peak',
  'the forgefire', 'the oathstone', 'the deep road', 'the high hall', 'the iron gate', 'the cold wall',
  'the low flame', 'the ember hall',
];

const MOTTO_QUALIFIERS = [
  'with iron', 'with fire', 'with patience', 'with honor', 'in silence', 'in storm',
  'to the end', 'for the clan', 'for the hall', 'for the deep', 'without fear', 'as one',
  'by stone', 'by will', 'by oath', 'through night',
  'in shadow', 'under mountain', 'against the tide', 'for the fallen',
  'with cold steel', 'with steady hands', 'for the old blood', 'for the watch',
];

const SAGA_ACTIONS = [
  'bent', 'forged', 'held', 'carved', 'endured', 'broke', 'raised', 'bound',
  'marked', 'sealed', 'kindled', 'stood', 'guarded', 'tempered', 'shaped', 'bore',
  'lifted', 'bound', 'cleft', 'hardened', 'mended', 'swore', 'kept', 'weathered',
];

const SAGA_OBJECTS = [
  'basalt', 'iron gate', 'stone crown', 'deep hall', 'ash ridge', 'shadow pass',
  'frost bridge', 'rune vault', 'ember wall', 'storm mark', 'granite oath', 'black anvil',
  'iron chain', 'forgotten stair', 'broken helm', 'stone gate', 'rift bridge', 'deep road',
];

const SAGA_PLACES = [
  'the lower halls', 'the ash gate', 'the iron ridge', 'the black stairs',
  'the silent bridge', 'the old forge', 'the frost road', 'the deep watch',
  'the red river', 'the stone crown', 'the hidden vault', 'the iron wall',
  'the ember vault', 'the granite road', 'the hollow keep', 'the storm pass',
  'the rune arch', 'the broken gate',
];

const SAGA_SCENES = [
  'moonless rain', 'emberfall', 'winter hush', 'raid-fire', 'deep silence',
  'iron dusk', 'stone wind', 'cold dawn', 'ash storm', 'sunless watch',
  'long night', 'red tide', 'rune-light', 'black frost', 'ember haze',
  'stormbreak', 'silent thaw',
];

const SAGA_TEMPLATES = [
  'They {action} the {object} in {scene}.',
  'They {action} at {place} during {scene}.',
  'Their oath was {action} through {scene}.',
  'They {action} the {object} by {place}.',
];

// Hash a string into a 32-bit unsigned integer.
function hashString(value) {
  const text = String(value || '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// Mix a numeric seed into a better-distributed 32-bit value.
function mixSeed(seed) {
  let x = Number(seed) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

// Pick a deterministic entry from a list using a seed and salt.
function pickFromList(list, seed, salt) {
  if (!Array.isArray(list) || list.length === 0) {
    return '';
  }
  const mixed = mixSeed(seed + salt);
  return list[mixed % list.length];
}

// Clamp a number to the 0..1 range.
function clampUnit(value) {
  return Math.min(1, Math.max(0, Number(value || 0)));
}

// Resolve a stable lore seed for the current run.
function getLoreSeed(state, config) {
  const terrainSeed = state && state.terrain && Number.isFinite(state.terrain.seed)
    ? Number(state.terrain.seed)
    : null;
  if (terrainSeed !== null) {
    return terrainSeed;
  }
  const displaySeed = config && config.display && config.display.terrain
    ? Number(config.display.terrain.seed || 0)
    : 0;
  return Number.isFinite(displaySeed) ? displaySeed : 0;
}

// Capitalize the first letter of a word.
function capitalize(value) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  return text[0].toUpperCase() + text.slice(1);
}

// Build a deterministic dwarf name from the seed and id.
function buildDwarfName(baseSeed) {
  const first = `${pickFromList(NAME_START, baseSeed, 11)}${pickFromList(NAME_END, baseSeed, 17)}`;
  const last = `${pickFromList(SURNAME_START, baseSeed, 23)}${pickFromList(SURNAME_END, baseSeed, 29)}`;
  return `${first} ${last}`.trim();
}

// Build deterministic dwarf traits from the seed and id.
function buildDwarfTraits(baseSeed) {
  const traitA = `${pickFromList(TRAIT_ADJECTIVES, baseSeed, 31)} ${pickFromList(TRAIT_NOUNS, baseSeed, 37)}`.trim();
  let traitB = `${pickFromList(TRAIT_ADJECTIVES, baseSeed, 41)} ${pickFromList(TRAIT_NOUNS, baseSeed, 43)}`.trim();
  if (traitB === traitA) {
    traitB = `${pickFromList(TRAIT_ADJECTIVES, baseSeed, 47)} ${pickFromList(TRAIT_NOUNS, baseSeed, 53)}`.trim();
  }
  return [traitA, traitB];
}

// Build a deterministic dwarf epithet.
function buildDwarfEpithet(baseSeed) {
  const prefix = pickFromList(EPITHET_PREFIX, baseSeed, 59);
  const suffix = pickFromList(EPITHET_SUFFIX, baseSeed, 61);
  return `${prefix} of the ${suffix}`.trim();
}

// Build a deterministic dwarf oath.
function buildDwarfOath(baseSeed) {
  const target = pickFromList(OATH_OBJECTS, baseSeed, 67);
  return `Oath of ${target}`.trim();
}

// Build deterministic dwarf taboo and mark.
function buildDwarfTaboo(baseSeed) {
  return pickFromList(TABOOS, baseSeed, 131);
}

function buildDwarfMark(baseSeed) {
  return pickFromList(MARKS, baseSeed, 137);
}

// Build a deterministic house name.
function buildDwarfHouse(baseSeed) {
  const prefix = pickFromList(HOUSE_PREFIX, baseSeed, 71);
  let suffix = pickFromList(HOUSE_SUFFIX, baseSeed, 73);
  if (suffix === prefix) {
    suffix = pickFromList(HOUSE_SUFFIX, baseSeed, 79);
  }
  return `${prefix}-${suffix}`.trim();
}

// Build a deterministic rank.
function buildDwarfRank(baseSeed) {
  return pickFromList(RANKS, baseSeed, 83);
}

// Build a deterministic archetype.
function buildDwarfArchetype(baseSeed) {
  return pickFromList(ARCHETYPES, baseSeed, 89);
}

// Build a deterministic virtue.
function buildDwarfVirtue(baseSeed) {
  return pickFromList(VIRTUES, baseSeed, 97);
}

// Build a deterministic flaw.
function buildDwarfFlaw(baseSeed) {
  return pickFromList(FLAWS, baseSeed, 101);
}

// Build a deterministic totem.
function buildDwarfTotem(baseSeed) {
  const adj = pickFromList(TOTEM_ADJECTIVES, baseSeed, 103);
  const beast = pickFromList(TOTEM_BEASTS, baseSeed, 107);
  return `${adj} ${beast}`.trim();
}

// Build a deterministic vow.
function buildDwarfVow(baseSeed) {
  const verb = pickFromList(VOW_VERBS, baseSeed, 109);
  const object = pickFromList(VOW_OBJECTS, baseSeed, 113);
  const qualifier = pickFromList(VOW_QUALIFIERS, baseSeed, 127);
  return `${verb} ${object}, ${qualifier}`.trim();
}

// Build a deterministic base stat in the 0..1 range.
function buildDwarfBaseStat(baseSeed, salt) {
  const roll = mixSeed(baseSeed + salt) / 4294967295;
  return clampUnit(0.25 + roll * 0.65);
}

// Build a deterministic rune banner.
function buildDwarfRunes(baseSeed, count = 12) {
  const total = Math.max(1, Number(count || 12));
  const parts = [];
  for (let i = 0; i < total; i += 1) {
    parts.push(pickFromList(RUNES, baseSeed, 191 + i * 3));
  }
  return parts.join(' ');
}

// Build a deterministic heraldic blazon string.
function buildDwarfBlazon(baseSeed) {
  const field = pickFromList(BLAZON_FIELDS, baseSeed, 139);
  const charge = pickFromList(BLAZON_CHARGES, baseSeed, 149);
  const trim = pickFromList(BLAZON_TRIMS, baseSeed, 157);
  return `${field}, ${charge}, ${trim}`.trim();
}

// Build a deterministic heraldic motto.
function buildDwarfMotto(baseSeed) {
  const verb = pickFromList(MOTTO_VERBS, baseSeed, 107);
  const object = pickFromList(MOTTO_OBJECTS, baseSeed, 109);
  const qualifier = pickFromList(MOTTO_QUALIFIERS, baseSeed, 113);
  return `${verb} ${object}, ${qualifier}`.trim();
}

// Build a deterministic saga line from templates.
function buildSagaLine(baseSeed, salt) {
  const template = pickFromList(SAGA_TEMPLATES, baseSeed, salt);
  const action = pickFromList(SAGA_ACTIONS, baseSeed, salt + 1);
  const object = pickFromList(SAGA_OBJECTS, baseSeed, salt + 2);
  const place = pickFromList(SAGA_PLACES, baseSeed, salt + 3);
  const scene = pickFromList(SAGA_SCENES, baseSeed, salt + 4);
  return template
    .replace('{action}', action)
    .replace('{object}', object)
    .replace('{place}', place)
    .replace('{scene}', scene)
    .trim();
}

// Build deterministic dwarf saga lines.
function buildDwarfSaga(baseSeed) {
  return [buildSagaLine(baseSeed, 127), buildSagaLine(baseSeed, 137)];
}

// Describe a morale value with a short adjective.
function describeMorale(morale) {
  const value = Number(morale || 0);
  if (value >= 0.85) {
    return 'buoyant';
  }
  if (value >= 0.65) {
    return 'steady';
  }
  if (value >= 0.45) {
    return 'uneasy';
  }
  if (value >= 0.25) {
    return 'sullen';
  }
  return 'grim';
}

// Resolve a role label for display.
function resolveRoleLabel(dwarf) {
  if (!dwarf) {
    return 'idle';
  }
  const role = dwarf.role ? String(dwarf.role) : '';
  return role ? role : 'idle';
}

// Resolve an epic role title for display.
function resolveRoleTitle(dwarf) {
  if (!dwarf) {
    return 'Wayfarer';
  }
  const role = dwarf.role ? String(dwarf.role) : '';
  if (!role) {
    return 'Wayfarer';
  }
  return ROLE_TITLES[role] || capitalize(role);
}

// Build a combined title from morale and role.
function buildDwarfTitle(dwarf) {
  const morale = describeMorale(dwarf && dwarf.state ? dwarf.state.morale : 0);
  const roleTitle = resolveRoleTitle(dwarf);
  return `${capitalize(morale)} ${roleTitle}`.trim();
}

// Resolve a stable spawn index for ordering.
function getSpawnIndex(dwarf) {
  const raw = Number(dwarf && dwarf.spawnIndex);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  const id = dwarf && dwarf.id ? String(dwarf.id) : '';
  const match = id.match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

// Get dwarf ids sorted by spawn order.
function getSpawnOrderedIds(dwarves) {
  if (!Array.isArray(dwarves) || dwarves.length === 0) {
    return [];
  }
  return dwarves
    .slice()
    .sort((a, b) => getSpawnIndex(a) - getSpawnIndex(b))
    .map((dwarf) => dwarf.id);
}

// Build deterministic lore fields for a dwarf.
function buildDwarfLore(dwarf, state, config) {
  if (!dwarf) {
    return {
      name: 'Unknown',
      house: '',
      epithet: '',
      title: '',
      rank: '',
    archetype: '',
    traits: [],
    taboo: '',
    mark: '',
    virtue: '',
    flaw: '',
    totem: '',
    runes: '',
    baseStrength: 0,
    baseDexterity: 0,
    oath: '',
    vow: '',
    blazon: '',
    motto: '',
    saga: [],
    };
  }
  const seed = getLoreSeed(state, config);
  const baseSeed = hashString(`${seed}:${dwarf.id}`);
  return {
    name: buildDwarfName(baseSeed),
    house: buildDwarfHouse(baseSeed),
    epithet: buildDwarfEpithet(baseSeed),
    title: buildDwarfTitle(dwarf),
    rank: buildDwarfRank(baseSeed),
    archetype: buildDwarfArchetype(baseSeed),
    traits: buildDwarfTraits(baseSeed),
    taboo: buildDwarfTaboo(baseSeed),
    mark: buildDwarfMark(baseSeed),
    virtue: buildDwarfVirtue(baseSeed),
    flaw: buildDwarfFlaw(baseSeed),
    totem: buildDwarfTotem(baseSeed),
    runes: buildDwarfRunes(baseSeed, 12),
    baseStrength: buildDwarfBaseStat(baseSeed, 211),
    baseDexterity: buildDwarfBaseStat(baseSeed, 223),
    oath: buildDwarfOath(baseSeed),
    vow: buildDwarfVow(baseSeed),
    blazon: buildDwarfBlazon(baseSeed),
    motto: buildDwarfMotto(baseSeed),
    saga: buildDwarfSaga(baseSeed),
  };
}

module.exports = {
  buildDwarfLore,
  capitalize,
  describeMorale,
  getLoreSeed,
  getSpawnOrderedIds,
  resolveRoleLabel,
};
