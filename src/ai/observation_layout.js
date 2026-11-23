'use strict';

// Observation layouts shared by the training server and in-game policy inference.
// "per_resource" (legacy) repeats every feature once per action head; "factored" keeps
// per-resource features only for real stockpile resources and emits global features once.
const OBSERVATION_LAYOUT_PER_RESOURCE = 'per_resource';
const OBSERVATION_LAYOUT_FACTORED = 'factored';
const OBSERVATION_LAYOUTS = new Set([OBSERVATION_LAYOUT_PER_RESOURCE, OBSERVATION_LAYOUT_FACTORED]);
const PER_RESOURCE_FEATURE_NAMES = new Set(['shortage', 'nodeScarcity']);
const FESTIVAL_ACTION_ID = 'festival';
const GOVERNOR_ACTION_PREFIX = 'gov_';

// Resolve a layout id, falling back to the legacy layout for missing or unknown values.
function normalizeObservationLayout(value, fallback = OBSERVATION_LAYOUT_PER_RESOURCE) {
  const text = String(value || '').trim().toLowerCase();
  return OBSERVATION_LAYOUTS.has(text) ? text : fallback;
}

// Real stockpile resources carry per-resource signals; festival/governor heads do not.
function isObservedResourceId(resource) {
  const text = String(resource || '');
  return text.length > 0 && text !== FESTIVAL_ACTION_ID && !text.startsWith(GOVERNOR_ACTION_PREFIX);
}

// Build the index plan shared by size checks and vector assembly.
function buildObservationPlan(resources, featureNames, layout) {
  const resourceList = Array.isArray(resources) ? resources.slice() : [];
  const names = Array.isArray(featureNames) ? featureNames : [];
  const resolvedLayout = normalizeObservationLayout(layout);
  if (resolvedLayout === OBSERVATION_LAYOUT_PER_RESOURCE) {
    return {
      layout: resolvedLayout,
      resources: resourceList,
      perResourceIndexes: names.map((_, index) => index),
      globalIndexes: [],
      globalSource: null,
      size: resourceList.length * names.length,
    };
  }
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
    layout: resolvedLayout,
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
  OBSERVATION_LAYOUT_PER_RESOURCE,
  OBSERVATION_LAYOUT_FACTORED,
  PER_RESOURCE_FEATURE_NAMES,
  normalizeObservationLayout,
  isObservedResourceId,
  buildObservationPlan,
  assembleObservationVector,
};
