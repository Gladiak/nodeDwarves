'use strict';

const { clamp } = require('./utils');

// Function: getClanConfig.
function getClanConfig(config) {
  return (config && config.clans) || {};
}

// Function: getClanList.
function getClanList(config) {
  const clanConfig = getClanConfig(config);
  if (clanConfig.enabled === false) {
    return [];
  }
  const list = Array.isArray(clanConfig.list) ? clanConfig.list : [];
  return list.map((entry) => String(entry)).filter((entry) => entry.length > 0);
}

// Function: getClanLabels.
function getClanLabels(config) {
  const clanConfig = getClanConfig(config);
  return clanConfig.labels && typeof clanConfig.labels === 'object' ? clanConfig.labels : {};
}

// Function: getClanLabel.
function getClanLabel(config, clanId) {
  if (!clanId) {
    return '';
  }
  const labels = getClanLabels(config);
  return labels[clanId] || clanId;
}

// Function: normalizeClanWeights.
function normalizeClanWeights(clanList, distribution) {
  const weights = clanList.map((clanId) => {
    const raw = distribution && distribution[clanId] !== undefined
      ? Number(distribution[clanId])
      : 0;
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  });
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return clanList.map(() => 1);
  }
  return weights;
}

// Function: pickClanId.
function pickClanId(config, rng = Math.random) {
  const clanConfig = getClanConfig(config);
  if (clanConfig.enabled === false) {
    return null;
  }
  const clanList = getClanList(config);
  if (clanList.length === 0) {
    return null;
  }
  const distribution = clanConfig.distribution || {};
  const weights = normalizeClanWeights(clanList, distribution);
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return clanList[0];
  }
  const roll = rng() * total;
  let cursor = 0;
  for (let i = 0; i < clanList.length; i += 1) {
    cursor += weights[i];
    if (roll <= cursor) {
      return clanList[i];
    }
  }
  return clanList[clanList.length - 1];
}

// Function: countClans.
function countClans(dwarves, clanList) {
  const counts = {};
  const list = Array.isArray(clanList) ? clanList : [];
  for (const clanId of list) {
    counts[clanId] = 0;
  }
  for (const dwarf of dwarves || []) {
    if (!dwarf || !dwarf.clanId) {
      continue;
    }
    if (counts[dwarf.clanId] === undefined) {
      continue;
    }
    counts[dwarf.clanId] += 1;
  }
  return counts;
}

// Function: getClanEffects.
function getClanEffects(config, clanId) {
  const clanConfig = getClanConfig(config);
  const effects = clanConfig.effects && typeof clanConfig.effects === 'object'
    ? clanConfig.effects
    : null;
  if (!effects || !clanId || !effects[clanId]) {
    return {};
  }
  return effects[clanId];
}

// Function: getClanShare.
function getClanShare(dwarves, clanId, predicate) {
  let total = 0;
  let matches = 0;
  for (const dwarf of dwarves || []) {
    if (!dwarf) {
      continue;
    }
    if (predicate && !predicate(dwarf)) {
      continue;
    }
    total += 1;
    if (dwarf.clanId === clanId) {
      matches += 1;
    }
  }
  return total > 0 ? clamp(matches / total, 0, 1) : 0;
}

// Function: getClanShareByIds.
function getClanShareByIds(dwarves, ids, clanId) {
  const idSet = new Set(Array.isArray(ids) ? ids : []);
  if (idSet.size === 0) {
    return 0;
  }
  let total = 0;
  let matches = 0;
  for (const dwarf of dwarves || []) {
    if (!dwarf || !idSet.has(dwarf.id)) {
      continue;
    }
    total += 1;
    if (dwarf.clanId === clanId) {
      matches += 1;
    }
  }
  return total > 0 ? clamp(matches / total, 0, 1) : 0;
}

module.exports = {
  getClanConfig,
  getClanList,
  getClanLabel,
  pickClanId,
  countClans,
  getClanEffects,
  getClanShare,
  getClanShareByIds,
};
