'use strict';

// Factored observation layout shared by the training server and in-game policy inference: per-resource
// features ("shortage", "nodeScarcity") once per real stockpile resource, every other feature once.
// The legacy per-resource layout of v1 policies was removed in STRATEGY.md T4.
const OBSERVATION_LAYOUT_FACTORED = 'factored';
const PER_RESOURCE_FEATURE_NAMES = new Set(['shortage', 'nodeScarcity']);
const LEVER_ACTION_PREFIX = 'lever_';

// Real stockpile resources carry per-resource signals; lever heads do not.
function isObservedResourceId(resource) {
  const text = String(resource || '');
  return text.length > 0 && !text.startsWith(LEVER_ACTION_PREFIX);
}

// Build the index plan shared by size checks and vector assembly. The optional third argument is
// accepted for call-site symmetry and must be "factored" when given.
function buildObservationPlan(resources, featureNames, layout = OBSERVATION_LAYOUT_FACTORED) {
  if (layout !== OBSERVATION_LAYOUT_FACTORED) {
    throw new Error(`Unsupported observation layout ${JSON.stringify(layout)}: only "factored" exists (STRATEGY.md T4)`);
  }
  const resourceList = Array.isArray(resources) ? resources.slice() : [];
  const names = Array.isArray(featureNames) ? featureNames : [];
  const perResourceIndexes = [];
  const globalIndexes = [];
  names.forEach((name, index) => {
    if (PER_RESOURCE_FEATURE_NAMES.has(name)) {
      perResourceIndexes.push(index);
    } else {
      globalIndexes.push(index);
    }
  });
  const observed = perResourceIndexes.length > 0
    ? resourceList.filter((resource) => isObservedResourceId(resource))
    : [];
  const globalSource = observed.length > 0 ? observed[0] : (resourceList[0] ?? null);
  const effectiveGlobals = globalSource === null ? [] : globalIndexes;
  return {
    layout: OBSERVATION_LAYOUT_FACTORED,
    resources: observed,
    perResourceIndexes,
    globalIndexes: effectiveGlobals,
    globalSource,
    size: observed.length * perResourceIndexes.length + effectiveGlobals.length,
  };
}

// Assemble one flat observation from full per-resource feature rows following the plan order.
function assembleObservationVector(plan, rowForResource) {
  const vector = new Array(plan.size);
  const rows = new Map();
  let cursor = 0;
  for (const resource of plan.resources) {
    const row = rowForResource(resource);
    rows.set(resource, row);
    for (const index of plan.perResourceIndexes) {
      vector[cursor] = Number(row[index] || 0);
      cursor += 1;
    }
  }
  if (plan.globalIndexes.length > 0) {
    const row = rows.has(plan.globalSource) ? rows.get(plan.globalSource) : rowForResource(plan.globalSource);
    for (const index of plan.globalIndexes) {
      vector[cursor] = Number(row[index] || 0);
      cursor += 1;
    }
  }
  return vector;
}

module.exports = {
  OBSERVATION_LAYOUT_FACTORED,
  PER_RESOURCE_FEATURE_NAMES,
  isObservedResourceId,
  buildObservationPlan,
  assembleObservationVector,
};
