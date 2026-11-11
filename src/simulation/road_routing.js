'use strict';

const connectionCaches = new WeakMap();
const MAX_CONNECTION_LINKS = 128;
const MAX_CONNECTION_TARGETS = 256;

// Preserve ordinary gathering routes for explicitly protected shortage-sensitive resources.
function isProtectedRoadGather(entity, resources) {
  return entity?.job?.type === 'gather' && Array.isArray(resources)
    && resources.includes(entity.job.resource);
}

// Resolve explicit surface routing policy without changing job priorities or resource rules.
function getCostGuardedRoadConfig(config) {
  const pathing = config?.population?.pathing || {};
  const field = pathing.field || {};
  const affinity = field.road_affinity || field.roadAffinity || {};
  return pathing.mode === 'field' && affinity.enabled !== false
    && affinity.routing_mode === 'cost_guarded' ? affinity : null;
}

// Read surface road continuity without creating distance maps or persistent route state.
function isRoadTravelCell(state, x, y) {
  return ['road', 'bridge', 'ford'].includes(state?.roads?.types?.[y]?.[x]);
}

// Cache bounded completed-link connectivity by its authoritative topology version.
function getRoadTargetConnections(state, targetX, targetY, radius, regionalOnly = false) {
  const roads = state?.roads;
  if (!roads || !roads.links) return new Set();
  const version = Number(roads.connectionVersion || 0);
  let cache = connectionCaches.get(roads);
  if (!cache || cache.version !== version) {
    const links = Object.values(roads.links).slice(0, MAX_CONNECTION_LINKS)
      .filter((link) => link.completed && [link.from?.x, link.from?.y, link.to?.x, link.to?.y].every(Number.isFinite));
    const parents = new Map(); const nodes = new Map();
    const root = (key) => {
      let result = key;
      while (parents.get(result) !== result) result = parents.get(result);
      return result;
    };
    for (const link of links) {
      const endpoints = [link.from, link.to].map((point) => {
        const key = `${point.x},${point.y}`;
        if (!parents.has(key)) { parents.set(key, key); nodes.set(key, point); }
        return key;
      });
      parents.set(root(endpoints[1]), root(endpoints[0]));
    }
    const regionalComponents = new Set(links.filter((link) => link.kind === 'village')
      .map((link) => root(`${link.from.x},${link.from.y}`)));
    cache = { version, links, nodes, root, regionalComponents, targets: new Map() };
    connectionCaches.set(roads, cache);
  }
  const key = `${targetX},${targetY}:${radius}:${regionalOnly}`;
  if (cache.targets.has(key)) return cache.targets.get(key);
  const components = new Set();
  for (const [id, point] of cache.nodes) {
    const component = cache.root(id);
    if ((!regionalOnly || cache.regionalComponents.has(component))
      && Math.abs(point.x - targetX) + Math.abs(point.y - targetY) <= radius) components.add(component);
  }
  const result = new Set(cache.links.filter((link) => components.has(cache.root(`${link.from.x},${link.from.y}`)))
    .map((link) => link.key));
  if (cache.targets.size >= MAX_CONNECTION_TARGETS) cache.targets.delete(cache.targets.keys().next().value);
  cache.targets.set(key, result);
  return result;
}

// A physical road tile is useful only if it belongs to a completed target-connected component.
function isTargetConnectedRoadCell(state, x, y, connections) {
  return isRoadTravelCell(state, x, y)
    && (state.roads.tileLinks?.[`${x},${y}`] || []).some((key) => connections.has(key));
}

// Require a bounded road segment that keeps making destination progress without slower/crowded tiles.
function hasProgressingRoadContinuation(start, minimumSteps, inspect, maximumDelay, maximumCrowd) {
  if (minimumSteps <= 1) return true;
  const queue = [{ ...start, steps: 1 }];
  const seen = new Set([`${start.x},${start.y}`]);
  for (let index = 0; index < queue.length; index += 1) {
    const cell = queue[index];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = cell.x + dx; const y = cell.y + dy;
      const key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const next = inspect(x, y);
      if (!next || !next.road || ![next.distance, next.delay, next.crowd].every(Number.isFinite)
        || next.distance !== cell.distance - 1
        || next.delay > maximumDelay || next.crowd > maximumCrowd) continue;
      if (cell.steps + 1 >= minimumSteps) return true;
      queue.push({ ...next, x, y, steps: cell.steps + 1 });
    }
  }
  return false;
}

// Prefer a road only when it dominates the sampled ordinary step on every travel guard.
function chooseCostGuardedRoadStep(candidates, ordinary, currentDistance, approveRoad,
  minimumImprovement = 0, preserveProgressingSteps = false) {
  if (!ordinary || ((ordinary.road || preserveProgressingSteps) && ordinary.distance < currentDistance)) return ordinary;
  if (![ordinary.distance, ordinary.delay, ordinary.crowd, ordinary.cost, currentDistance]
    .every(Number.isFinite)) return ordinary;
  let best = ordinary;
  for (const candidate of candidates) {
    if (![candidate.distance, candidate.delay, candidate.crowd, candidate.cost].every(Number.isFinite)
      || !candidate.road || candidate.distance >= currentDistance
      || candidate.distance > ordinary.distance || candidate.delay > ordinary.delay
      || candidate.crowd > ordinary.crowd
      || candidate.cost > ordinary.cost - minimumImprovement) continue;
    if (approveRoad && !approveRoad(candidate)) continue;
    if (best === ordinary || candidate.cost < best.cost
      || (candidate.cost === best.cost && candidate.distance < best.distance)) best = candidate;
  }
  return best;
}

// Keep a verified road trip progressing when the ordinary sample would stay or backtrack.
function chooseProtectedRoadTripStep(candidates, ordinary, currentDistance) {
  if (!ordinary || ordinary.distance < currentDistance) return ordinary;
  if (![ordinary.distance, ordinary.delay, ordinary.crowd, ordinary.cost, currentDistance]
    .every(Number.isFinite)) return ordinary;
  let best = ordinary;
  for (const candidate of candidates) {
    if (![candidate.distance, candidate.delay, candidate.crowd, candidate.cost].every(Number.isFinite)
      || candidate.distance >= currentDistance || candidate.distance > ordinary.distance
      || candidate.delay > ordinary.delay
      || candidate.crowd > ordinary.crowd || candidate.cost > ordinary.cost) continue;
    if (best === ordinary || candidate.cost < best.cost
      || (candidate.cost === best.cost && candidate.road && !best.road)) best = candidate;
  }
  return best;
}

module.exports = { chooseCostGuardedRoadStep, getCostGuardedRoadConfig,
  isRoadTravelCell, hasProgressingRoadContinuation, chooseProtectedRoadTripStep,
  getRoadTargetConnections, isTargetConnectedRoadCell, isProtectedRoadGather };
