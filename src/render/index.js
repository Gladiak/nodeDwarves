'use strict';

const { clamp } = require('../utils');
const { buildGridBase } = require('./grid');
const { buildHeaderLines } = require('./header');
const { buildFooterLines, getBeastSymbol } = require('./legend');
const { buildLegendPanel, applyLegendPanel } = require('./legend_panel');
const { buildTelemetryPanel, applyTelemetryPanel } = require('../telemetry/telemetry_panel');
const { applyMapInsetPanel } = require('./map_inset_panel');
const { getColorConfig, applyColor } = require('./colors');
const { formatMapLine } = require('./format');
const { buildInspectPanel, applyInspectPanel } = require('./inspect');
const { buildSavePanel, applySavePanel } = require('./save_panel');
const { applyTransitionMask, buildTransitionPanel, applyTransitionPanel } = require('./transition');
const { getTempleRenderTiles } = require('../simulation/temple');

// Resolve the currently active underrealm depth for rendering.
function getActiveUnderrealmDepth(state) {
  const underrealm = state && state.underrealm;
  if (!underrealm || underrealm.enabled === false) {
    return 0;
  }
  const maxUnlockedDepth = Math.max(0, Math.floor(Number(underrealm.maxUnlockedDepth || 0)));
  const activeDepth = Math.max(0, Math.floor(Number(underrealm.activeDepth || 0)));
  return clamp(activeDepth, 0, maxUnlockedDepth);
}

// Resolve discovered underrealm gate tile for surface rendering.
function getUnderrealmGateRenderData(state, config) {
  const underrealm = state && state.underrealm;
  if (!underrealm || underrealm.enabled === false) {
    return null;
  }
  const discovery = underrealm.discovery;
  if (!discovery || discovery.enabled === false || discovery.found !== true) {
    return null;
  }
  const gate = discovery.surfaceGate;
  if (!gate) {
    return null;
  }
  const x = Math.floor(Number(gate.x));
  const y = Math.floor(Number(gate.y));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  const discoveryConfig = (config.underrealm && config.underrealm.discovery) || {};
  const symbol = String(discoveryConfig.symbol || 'O');
  const colorKey = String(discoveryConfig.color_key || 'underrealm_gate');
  return { x, y, symbol, colorKey };
}

// Resolve one underrealm terrain layer by depth.
function getUnderrealmLayerByDepth(state, depth) {
  const underrealm = state && state.underrealm;
  if (!underrealm || !Array.isArray(underrealm.layers)) {
    return null;
  }
  return underrealm.layers.find((layer) => Number(layer && layer.depth || 0) === Number(depth)) || null;
}

// Check whether an underrealm terrain type should be considered walkable.
function isUnderrealmWalkableType(type, walkableConfig) {
  if (!type) {
    return false;
  }
  if (walkableConfig && Object.prototype.hasOwnProperty.call(walkableConfig, type)) {
    return walkableConfig[type] === true;
  }
  return type !== 'wall' && type !== 'chasm' && type !== 'magma';
}

// Collect all walkable cell coordinates from a layer terrain.
function collectUnderrealmWalkableCells(terrain, walkableConfig) {
  if (!terrain || !Array.isArray(terrain.types)) {
    return [];
  }
  const cells = [];
  for (let y = 0; y < terrain.types.length; y += 1) {
    const row = terrain.types[y];
    if (!Array.isArray(row)) {
      continue;
    }
    for (let x = 0; x < row.length; x += 1) {
      if (isUnderrealmWalkableType(row[x], walkableConfig)) {
        cells.push({ x, y });
      }
    }
  }
  return cells;
}

// Build a deterministic hash from a string seed.
function hashString(value) {
  const text = String(value || '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// Pick one free cell deterministically from a walkable-cell list.
function pickUnderrealmRenderCell(cells, occupied, seedKey, markOccupied = true) {
  if (!Array.isArray(cells) || cells.length === 0) {
    return null;
  }
  const start = hashString(seedKey) % cells.length;
  for (let step = 0; step < cells.length; step += 1) {
    const index = (start + step) % cells.length;
    const cell = cells[index];
    const key = `${cell.x},${cell.y}`;
    if (occupied && occupied.has(key)) {
      continue;
    }
    if (markOccupied && occupied) {
      occupied.add(key);
    }
    return { x: cell.x, y: cell.y };
  }
  return null;
}

// Pick a deterministic target cell without reserving occupancy.
function pickUnderrealmTargetCell(cells, seedKey) {
  return pickUnderrealmRenderCell(cells, null, seedKey, false);
}

// Build a key string for one map coordinate.
function getUnderrealmCellKey(x, y) {
  return `${Number(x)},${Number(y)}`;
}

// Build a walkable lookup set for fast occupancy/path checks.
function buildUnderrealmWalkableSet(cells) {
  const set = new Set();
  for (const cell of cells) {
    if (!cell) {
      continue;
    }
    set.add(getUnderrealmCellKey(cell.x, cell.y));
  }
  return set;
}

// Resolve persistent render-state storage for one underrealm depth.
function getUnderrealmRenderDepthState(state, depth) {
  if (!state.renderState || typeof state.renderState !== 'object') {
    state.renderState = {};
  }
  if (!state.renderState.underrealmActors || typeof state.renderState.underrealmActors !== 'object') {
    state.renderState.underrealmActors = {};
  }
  const depthKey = String(depth);
  if (!state.renderState.underrealmActors[depthKey]
      || typeof state.renderState.underrealmActors[depthKey] !== 'object') {
    state.renderState.underrealmActors[depthKey] = {};
  }
  return state.renderState.underrealmActors[depthKey];
}

// Validate and normalize one stored render cell.
function normalizeUnderrealmRenderCell(raw, walkableSet) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const x = Math.floor(Number(raw.x));
  const y = Math.floor(Number(raw.y));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return walkableSet.has(getUnderrealmCellKey(x, y)) ? { x, y } : null;
}

// Resolve a persistent actor cell and reserve it in the occupancy set.
function resolveUnderrealmActorCell(depthState, actorKey, walkableCells, walkableSet, occupied, seedKey) {
  const existing = normalizeUnderrealmRenderCell(depthState[actorKey], walkableSet);
  if (existing) {
    const existingKey = getUnderrealmCellKey(existing.x, existing.y);
    if (!occupied.has(existingKey)) {
      occupied.add(existingKey);
      return existing;
    }
  }
  const spawned = pickUnderrealmRenderCell(
    walkableCells,
    occupied,
    seedKey,
  );
  if (!spawned) {
    return null;
  }
  depthState[actorKey] = spawned;
  return spawned;
}

// Pick one local movement step toward a target while honoring walkability and occupancy.
function pickUnderrealmStep(current, target, walkableSet, occupied, seedKey) {
  if (!current) {
    return null;
  }
  const targetCell = target || current;
  const options = [
    { x: current.x + 1, y: current.y },
    { x: current.x - 1, y: current.y },
    { x: current.x, y: current.y + 1 },
    { x: current.x, y: current.y - 1 },
    { x: current.x, y: current.y },
  ];
  let best = current;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestTie = Number.POSITIVE_INFINITY;
  for (const option of options) {
    const key = getUnderrealmCellKey(option.x, option.y);
    const isCurrent = option.x === current.x && option.y === current.y;
    if (!isCurrent && !walkableSet.has(key)) {
      continue;
    }
    if (!isCurrent && occupied.has(key)) {
      continue;
    }
    const distance = Math.abs(option.x - targetCell.x) + Math.abs(option.y - targetCell.y);
    const tie = hashString(`${seedKey}:${option.x},${option.y}`);
    if (distance < bestDistance || (distance === bestDistance && tie < bestTie)) {
      best = { x: option.x, y: option.y };
      bestDistance = distance;
      bestTie = tie;
    }
  }
  return best;
}

// Advance one actor on the underrealm map, keeping movement local (no teleport).
function advanceUnderrealmActorCell(depthState, actorKey, current, target, walkableSet, occupied, seedKey, allowMove) {
  if (!current) {
    return null;
  }
  if (!allowMove) {
    return current;
  }
  const currentKey = getUnderrealmCellKey(current.x, current.y);
  occupied.delete(currentKey);
  const next = pickUnderrealmStep(
    current,
    target,
    walkableSet,
    occupied,
    seedKey,
  ) || current;
  const nextKey = getUnderrealmCellKey(next.x, next.y);
  occupied.add(nextKey);
  depthState[actorKey] = next;
  return next;
}

// Keep underrealm render-state memory aligned with currently active actors.
function pruneUnderrealmActorState(depthState, activeKeys) {
  for (const key of Object.keys(depthState)) {
    if (!activeKeys.has(key)) {
      delete depthState[key];
    }
  }
}

// Find the nearest target cell by Manhattan distance.
function findNearestUnderrealmCell(origin, targets) {
  if (!origin || !Array.isArray(targets) || targets.length === 0) {
    return null;
  }
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    if (!target) {
      continue;
    }
    const distance = Math.abs(origin.x - target.x) + Math.abs(origin.y - target.y);
    if (distance < bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  return best;
}

// Resolve concrete delver ids assigned to a specific underrealm depth.
function getDelverIdsForDepth(state, depth) {
  const underrealm = state && state.underrealm;
  const crew = underrealm && underrealm.crew;
  const depthKey = String(depth);
  if (crew && crew.membersByDepth && Array.isArray(crew.membersByDepth[depthKey])) {
    return crew.membersByDepth[depthKey].slice();
  }
  if (!Array.isArray(state && state.dwarves)) {
    return [];
  }
  const ids = [];
  for (const dwarf of state.dwarves) {
    const duty = dwarf && dwarf.underrealmDuty;
    if (duty && duty.active !== false && Number(duty.depth || 0) === Number(depth)) {
      ids.push(dwarf.id);
    }
  }
  return ids;
}

// Resolve the configured dwarf render limit (`0` = unlimited, `<0` = hidden).
function getMaxVisibleDwarves(config) {
  const display = (config && config.display && config.display.dwarves) || {};
  const raw = Number(display.maxVisible ?? 0);
  if (Number.isFinite(raw) && raw < 0) {
    return -1;
  }
  if (!Number.isFinite(raw)) {
    return 0;
  }
  return Math.max(0, Math.floor(raw));
}

// Estimate how many hostile markers should be rendered for an active deep raid.
function estimateDeepRaidRenderCount(raid, maxCells) {
  const strength = Math.max(0, Number(raid && raid.strength || 0));
  const count = Math.round(strength * 8) + 2;
  return clamp(count, 1, Math.max(1, Math.min(16, maxCells)));
}

// Overlay delver/hostile markers when rendering a specific underrealm depth.
function renderUnderrealmOccupants(grid, state, config, colors, depth) {
  const layer = getUnderrealmLayerByDepth(state, depth);
  if (!layer || !layer.terrain) {
    return;
  }
  const underrealmConfig = (config && config.underrealm) || {};
  const terrainConfig = underrealmConfig.terrain || {};
  const walkableConfig = terrainConfig.walkable || {};
  const walkableCells = collectUnderrealmWalkableCells(layer.terrain, walkableConfig);
  if (walkableCells.length === 0) {
    return;
  }
  const walkableSet = buildUnderrealmWalkableSet(walkableCells);
  const symbols = config.symbols || {};
  const tick = Math.floor(Number(state && state.tick || 0));
  const depthState = getUnderrealmRenderDepthState(state, depth);
  const activeActorKeys = new Set();
  const occupied = new Set();
  const delverCells = [];
  const maxVisibleDwarves = getMaxVisibleDwarves(config);
  let delverIds = getDelverIdsForDepth(state, depth)
    .filter((id) => Boolean(id))
    .sort();
  if (maxVisibleDwarves < 0) {
    delverIds = [];
  } else if (maxVisibleDwarves > 0 && delverIds.length > maxVisibleDwarves) {
    delverIds = delverIds.slice(0, maxVisibleDwarves);
  }
  const delverColorKey = colors && colors.map && colors.map.underrealm_delver
    ? 'underrealm_delver'
    : 'dwarf';
  const delverSymbol = String(symbols.dwarf || '☻');
  const delverTargetPhase = Math.floor(tick / 30);
  const delverMoveStep = tick % 2 === 0;
  for (const delverId of delverIds) {
    const actorKey = `d:${delverId}`;
    activeActorKeys.add(actorKey);
    const baseCell = resolveUnderrealmActorCell(
      depthState,
      actorKey,
      walkableCells,
      walkableSet,
      occupied,
      `spawn:delver:${depth}:${delverId}`,
    );
    if (!baseCell) {
      continue;
    }
    const target = pickUnderrealmTargetCell(
      walkableCells,
      `target:delver:${depth}:${delverId}:${delverTargetPhase}`,
    );
    const cell = advanceUnderrealmActorCell(
      depthState,
      actorKey,
      baseCell,
      target,
      walkableSet,
      occupied,
      `step:delver:${depth}:${delverId}:${tick}`,
      delverMoveStep,
    );
    if (!cell || !grid[cell.y] || grid[cell.y][cell.x] === undefined) {
      continue;
    }
    delverCells.push(cell);
    grid[cell.y][cell.x] = applyColor(delverSymbol, delverColorKey, colors);
  }

  const deepFaction = state && state.underrealm && state.underrealm.deepFaction;
  const activeRaid = deepFaction
    && deepFaction.activeRaidsByDepth
    && deepFaction.activeRaidsByDepth[String(depth)];
  if (!activeRaid) {
    pruneUnderrealmActorState(depthState, activeActorKeys);
    return;
  }
  const hostileColorKey = colors && colors.map && colors.map.underrealm_hostile
    ? 'underrealm_hostile'
    : 'beast';
  const hostileSymbol = String(symbols.underrealm_hostile || '☠');
  const hostileTargetPhase = Math.floor(tick / 16);
  const hostileCount = estimateDeepRaidRenderCount(activeRaid, walkableCells.length);
  for (let index = 0; index < hostileCount; index += 1) {
    const actorKey = `h:${activeRaid.factionId || 'deep'}:${index}`;
    activeActorKeys.add(actorKey);
    const baseCell = resolveUnderrealmActorCell(
      depthState,
      actorKey,
      walkableCells,
      walkableSet,
      occupied,
      `spawn:hostile:${depth}:${activeRaid.factionId || 'deep'}:${index}`,
    );
    if (!baseCell) {
      continue;
    }
    const nearestDelver = findNearestUnderrealmCell(baseCell, delverCells);
    const roamingTarget = pickUnderrealmTargetCell(
      walkableCells,
      `target:hostile:${depth}:${activeRaid.factionId || 'deep'}:${index}:${hostileTargetPhase}`,
    );
    const target = nearestDelver || roamingTarget;
    const cell = advanceUnderrealmActorCell(
      depthState,
      actorKey,
      baseCell,
      target,
      walkableSet,
      occupied,
      `step:hostile:${depth}:${activeRaid.factionId || 'deep'}:${index}:${tick}`,
      true,
    );
    if (!cell || !grid[cell.y] || grid[cell.y][cell.x] === undefined) {
      continue;
    }
    grid[cell.y][cell.x] = applyColor(hostileSymbol, hostileColorKey, colors);
  }
  pruneUnderrealmActorState(depthState, activeActorKeys);
}

// Check if one underrealm terrain coordinate is walkable.
function isUnderrealmCellWalkable(terrain, xRaw, yRaw) {
  const x = Math.floor(Number(xRaw));
  const y = Math.floor(Number(yRaw));
  if (!terrain || x < 0 || y < 0 || x >= Number(terrain.width || 0) || y >= Number(terrain.height || 0)) {
    return false;
  }
  const map = Array.isArray(terrain.spawnable) ? terrain.spawnable : terrain.walkable;
  return Boolean(map && map[y] && map[y][x] === true);
}

// Resolve a stable elevator anchor for one depth layer.
function resolveUnderrealmLiftAnchor(layer) {
  if (!layer || !layer.terrain) {
    return null;
  }
  const terrain = layer.terrain;
  const start = terrain.start || null;
  if (start && isUnderrealmCellWalkable(terrain, start.x, start.y)) {
    return { x: Math.floor(Number(start.x)), y: Math.floor(Number(start.y)) };
  }
  const width = Math.max(1, Math.floor(Number(terrain.width || 1)));
  const height = Math.max(1, Math.floor(Number(terrain.height || 1)));
  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  if (isUnderrealmCellWalkable(terrain, centerX, centerY)) {
    return { x: centerX, y: centerY };
  }
  const maxRadius = Math.max(width, height);
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      const y = centerY + dy;
      const span = radius - Math.abs(dy);
      const leftX = centerX - span;
      const rightX = centerX + span;
      if (isUnderrealmCellWalkable(terrain, leftX, y)) {
        return { x: leftX, y };
      }
      if (rightX !== leftX && isUnderrealmCellWalkable(terrain, rightX, y)) {
        return { x: rightX, y };
      }
    }
  }
  return null;
}

// Pick a nearby walkable cell around an anchor, avoiding occupied keys when possible.
function pickNearbyLiftCell(terrain, anchor, occupied) {
  if (!terrain || !anchor) {
    return null;
  }
  const options = [
    { x: anchor.x, y: anchor.y },
    { x: anchor.x + 1, y: anchor.y },
    { x: anchor.x - 1, y: anchor.y },
    { x: anchor.x, y: anchor.y + 1 },
    { x: anchor.x, y: anchor.y - 1 },
    { x: anchor.x + 1, y: anchor.y + 1 },
    { x: anchor.x - 1, y: anchor.y - 1 },
    { x: anchor.x + 1, y: anchor.y - 1 },
    { x: anchor.x - 1, y: anchor.y + 1 },
  ];
  for (const option of options) {
    if (!isUnderrealmCellWalkable(terrain, option.x, option.y)) {
      continue;
    }
    const key = `${option.x},${option.y}`;
    if (occupied && occupied.has(key)) {
      continue;
    }
    if (occupied) {
      occupied.add(key);
    }
    return { x: option.x, y: option.y };
  }
  return null;
}

// Draw a single underrealm elevator marker.
function drawUnderrealmLiftMarker(grid, cell, symbol, colorKey, colors) {
  if (!cell || !grid[cell.y] || grid[cell.y][cell.x] === undefined) {
    return;
  }
  grid[cell.y][cell.x] = applyColor(symbol, colorKey, colors);
}

// Render underrealm elevator markers to show vertical progression state.
function renderUnderrealmLifts(grid, state, config, colors, depth) {
  const underrealm = state && state.underrealm;
  if (!underrealm || underrealm.enabled === false) {
    return;
  }
  const layer = getUnderrealmLayerByDepth(state, depth);
  if (!layer || !layer.terrain) {
    return;
  }
  const symbols = config.symbols || {};
  const maxDepth = Math.max(0, Math.floor(Number(underrealm.maxDepth || 0)));
  const maxUnlockedDepth = Math.max(0, Math.floor(Number(underrealm.maxUnlockedDepth || 0)));
  const lift = underrealm.lift || null;
  const anchor = resolveUnderrealmLiftAnchor(layer);
  if (!anchor) {
    return;
  }
  const occupied = new Set();
  const upCell = pickNearbyLiftCell(layer.terrain, anchor, occupied);
  if (upCell) {
    const upSymbol = String(symbols.underrealm_lift_up || '↑');
    drawUnderrealmLiftMarker(grid, upCell, upSymbol, 'underrealm_lift_up', colors);
  }
  if (depth >= maxDepth) {
    return;
  }
  const downCell = pickNearbyLiftCell(layer.terrain, anchor, occupied);
  if (!downCell) {
    return;
  }
  const unlockedBelow = depth < maxUnlockedDepth;
  const activeBuild = lift
    && lift.active === true
    && Number(lift.fromDepth || 0) === depth
    && Number(lift.targetDepth || 0) === depth + 1;
  const downSymbol = String(symbols.underrealm_lift_down || '↓');
  const lockedSymbol = String(symbols.underrealm_lift_locked || downSymbol);
  if (unlockedBelow) {
    drawUnderrealmLiftMarker(grid, downCell, downSymbol, 'underrealm_lift_down', colors);
    return;
  }
  if (activeBuild) {
    drawUnderrealmLiftMarker(grid, downCell, downSymbol, 'underrealm_lift_active', colors);
    return;
  }
  drawUnderrealmLiftMarker(grid, downCell, lockedSymbol, 'underrealm_lift_locked', colors);
}

// Render a full frame including map, telemetry overlays, header, and footer.
function renderFrame(state, config, runtime) {
  const symbols = config.symbols || {};
  const colors = getColorConfig(config);
  const emptySymbol = symbols.empty || '.';
  const frameConfig = (config.display && config.display.frame) || {};
  const frameEnabled = runtime.frameEnabled !== undefined
    ? runtime.frameEnabled
    : frameConfig.enabled === true;
  const frameSymbols = getFrameSymbols(frameConfig);

  const headerLines = buildHeaderLines(config, runtime);
  const footerLines = buildFooterLines(config, runtime);
  const grid = buildGridBase(state, config, runtime, colors, emptySymbol);
  const structurePositions = new Set();
  const dwarfPositions = new Set();
  const activeUnderrealmDepth = getActiveUnderrealmDepth(state);
  const underrealmViewActive = activeUnderrealmDepth > 0;
  if (!underrealmViewActive) {
    for (const node of state.nodes) {
      if (grid[node.y] && grid[node.y][node.x] !== undefined) {
        grid[node.y][node.x] = applyColor(node.symbol, node.id, colors);
      }
    }

    for (const structure of state.structures || []) {
      if (grid[structure.y] && grid[structure.y][structure.x] !== undefined) {
        let symbol = structure.symbol;
        let colorKey = structure.type;
        if (structure.type === 'house') {
          symbol = symbols.house || symbol;
          colorKey = 'house';
        }
        grid[structure.y][structure.x] = applyColor(symbol, colorKey, colors);
        structurePositions.add(`${structure.x},${structure.y}`);
      }
    }

    const templeTiles = getTempleRenderTiles(state, config, runtime);
    for (const tile of templeTiles) {
      if (!tile || grid[tile.y] === undefined || grid[tile.y][tile.x] === undefined) {
        continue;
      }
      grid[tile.y][tile.x] = applyColor(tile.symbol, tile.colorKey || 'temple_of_ancestors', colors);
      structurePositions.add(`${tile.x},${tile.y}`);
    }

    const underrealmGate = getUnderrealmGateRenderData(state, config);
    if (underrealmGate && grid[underrealmGate.y] && grid[underrealmGate.y][underrealmGate.x] !== undefined) {
      grid[underrealmGate.y][underrealmGate.x] = applyColor(
        underrealmGate.symbol,
        underrealmGate.colorKey,
        colors,
      );
    }

    const visibleDwarves = selectVisibleDwarves(state, config, runtime);
    for (const dwarf of visibleDwarves) {
      const draw = resolveDwarfRenderPosition(
        dwarf,
        state.structures,
        runtime,
        structurePositions,
        dwarfPositions,
      );
      if (draw && grid[draw.y] && grid[draw.y][draw.x] !== undefined) {
        grid[draw.y][draw.x] = applyColor(symbols.dwarf || '@', 'dwarf', colors);
        dwarfPositions.add(`${draw.x},${draw.y}`);
      }
    }

    const wildlife = state.wildlife;
    if (wildlife && Array.isArray(wildlife.herds)) {
      const herdSymbol = symbols.herd || '&';
      for (const herd of wildlife.herds) {
        if (!herd || Number(herd.remaining || 0) <= 0) {
          continue;
        }
        const offsets = Array.isArray(herd.offsets) && herd.offsets.length > 0
          ? herd.offsets
          : [{ dx: 0, dy: 0 }];
        for (const offset of offsets) {
          const x = herd.x + Number(offset.dx || 0);
          const y = herd.y + Number(offset.dy || 0);
          if (grid[y] && grid[y][x] !== undefined) {
            grid[y][x] = applyColor(herdSymbol, 'herd', colors);
          }
        }
      }
    }

    const raidState = state.raid;
    const beastSymbol = getBeastSymbol(config);
    if (raidState && raidState.active && beastSymbol && Array.isArray(raidState.beasts)) {
      for (const beast of raidState.beasts) {
        if (grid[beast.y] && grid[beast.y][beast.x] !== undefined) {
          grid[beast.y][beast.x] = applyColor(beastSymbol, 'beast', colors);
        }
      }
    }

    const merchant = state.merchant;
    if (merchant && merchant.phase && merchant.phase !== 'idle') {
      if (grid[merchant.y] && grid[merchant.y][merchant.x] !== undefined) {
        grid[merchant.y][merchant.x] = applyColor(symbols.merchant || 'M', 'merchant', colors);
      }
    }
  } else {
    renderUnderrealmOccupants(
      grid,
      state,
      config,
      colors,
      activeUnderrealmDepth,
    );
    renderUnderrealmLifts(
      grid,
      state,
      config,
      colors,
      activeUnderrealmDepth,
    );
  }

  applyTransitionMask(grid, state.ui ? state.ui.transition : null, runtime);
  applyMapInsetPanel(grid, state, config, runtime, colors, frameSymbols);

  const legendPanel = buildLegendPanel(state, config, runtime);
  if (legendPanel) {
    applyLegendPanel(grid, legendPanel, colors);
  }

  const telemetryPanel = buildTelemetryPanel(state, config, runtime);
  if (telemetryPanel) {
    applyTelemetryPanel(grid, telemetryPanel, colors);
  }

  const inspectPanel = buildInspectPanel(state, config, runtime);
  if (inspectPanel) {
    applyInspectPanel(grid, inspectPanel, colors);
  }

  const savePanel = buildSavePanel(state, config, runtime);
  if (savePanel) {
    applySavePanel(grid, savePanel, colors);
  }

  const transitionPanel = buildTransitionPanel(state, config, runtime);
  if (transitionPanel) {
    applyTransitionPanel(grid, transitionPanel, colors);
  }

  const lines = [];

  for (const line of headerLines) {
    lines.push(line);
  }

  if (frameEnabled) {
    const topLine = applyColor(
      `${frameSymbols.topLeft}${frameSymbols.horizontal.repeat(runtime.gridWidth)}${frameSymbols.topRight}`,
      'frame',
      colors,
    );
    lines.push(formatMapLine(topLine, '', runtime));
  }

  for (let y = 0; y < runtime.gridHeight; y += 1) {
    const gridLine = grid[y].join('');
    const mapLine = frameEnabled
      ? `${applyColor(frameSymbols.vertical, 'frame', colors)}${gridLine}${applyColor(frameSymbols.vertical, 'frame', colors)}`
      : gridLine;
    lines.push(mapLine);
  }

  if (frameEnabled) {
    const bottomLine = applyColor(
      `${frameSymbols.bottomLeft}${frameSymbols.horizontal.repeat(runtime.gridWidth)}${frameSymbols.bottomRight}`,
      'frame',
      colors,
    );
    lines.push(formatMapLine(bottomLine, '', runtime));
  }

  for (const line of footerLines) {
    lines.push(line);
  }

  return `${lines.join('\n')}\n`;
}

// Select a stable subset of dwarves to render for readability.
function selectVisibleDwarves(state, config, runtime) {
  const dwarves = state.dwarves || [];
  const maxVisible = getMaxVisibleDwarves(config);
  if (maxVisible < 0) {
    return [];
  }
  if (!maxVisible || dwarves.length <= maxVisible) {
    return dwarves;
  }
  const adults = dwarves.filter((dwarf) => dwarf.lifeStage === 'adult');
  const nonAdults = dwarves.filter((dwarf) => dwarf.lifeStage !== 'adult');
  const useAdultsOnly = adults.length >= maxVisible;
  const pool = useAdultsOnly ? adults : adults.concat(nonAdults);
  if (pool.length <= maxVisible) {
    return pool;
  }
  if (!state.renderState) {
    state.renderState = {};
  }
  const renderState = state.renderState;
  const prevIds = Array.isArray(renderState.visibleDwarfIds) ? renderState.visibleDwarfIds : [];
  const dwarfById = new Map(pool.map((dwarf) => [dwarf.id, dwarf]));
  const visible = [];
  const used = new Set();

  for (const id of prevIds) {
    const dwarf = dwarfById.get(id);
    if (!dwarf) {
      continue;
    }
    visible.push(dwarf);
    used.add(id);
    if (visible.length >= maxVisible) {
      break;
    }
  }

  if (visible.length < maxVisible) {
    const remainingAdults = adults.filter((dwarf) => !used.has(dwarf.id));
    const remainingOthers = nonAdults.filter((dwarf) => !used.has(dwarf.id));
    shuffleInPlace(remainingAdults);
    shuffleInPlace(remainingOthers);
    const candidates = useAdultsOnly ? remainingAdults : remainingAdults.concat(remainingOthers);
    const needed = maxVisible - visible.length;
    for (let i = 0; i < needed && i < candidates.length; i += 1) {
      visible.push(candidates[i]);
    }
  }

  renderState.visibleDwarfIds = visible.map((dwarf) => dwarf.id);
  return visible;
}

// Resolve a stable render center based on housing or the grid.
function getRenderCenter(state, runtime) {
  const houses = (state.structures || []).filter((structure) => structure.type === 'house');
  if (houses.length > 0) {
    const sum = houses.reduce((acc, house) => {
      acc.x += Number(house.x || 0);
      acc.y += Number(house.y || 0);
      return acc;
    }, { x: 0, y: 0 });
    return {
      x: clamp(Math.round(sum.x / houses.length), 0, runtime.gridWidth - 1),
      y: clamp(Math.round(sum.y / houses.length), 0, runtime.gridHeight - 1),
    };
  }
  return {
    x: Math.floor(runtime.gridWidth / 2),
    y: Math.floor(runtime.gridHeight / 2),
  };
}

// Shuffle a list in place using Fisher-Yates.
function shuffleInPlace(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
  }
  return list;
}

// Resolve render position for a dwarf, offsetting miners next to their mine.
function resolveDwarfRenderPosition(dwarf, structures, runtime, structurePositions, dwarfPositions) {
  if (!dwarf || !runtime) {
    return null;
  }
  const base = { x: dwarf.x, y: dwarf.y };
  const job = dwarf.job;
  if (!job || job.type !== 'mine') {
    return base;
  }
  const mine = Array.isArray(structures)
    ? structures.find((structure) => structure.id === job.structureId && structure.type === 'mine')
    : null;
  if (!mine) {
    return base;
  }
  const offsets = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  for (const offset of offsets) {
    const x = mine.x + offset.x;
    const y = mine.y + offset.y;
    if (x < 0 || y < 0 || x >= runtime.gridWidth || y >= runtime.gridHeight) {
      continue;
    }
    const key = `${x},${y}`;
    if (structurePositions.has(key) || dwarfPositions.has(key)) {
      continue;
    }
    return { x, y };
  }
  return base;
}

// Normalize frame symbol characters.
function getFrameSymbols(frameConfig) {
  const pick = (value, fallback) => {
    const str = String(value || fallback);
    return str.length > 0 ? str[0] : fallback;
  };
  return {
    horizontal: pick(frameConfig.horizontal, '-'),
    vertical: pick(frameConfig.vertical, '|'),
    topLeft: pick(frameConfig.topLeft, '+'),
    topRight: pick(frameConfig.topRight, '+'),
    bottomLeft: pick(frameConfig.bottomLeft, '+'),
    bottomRight: pick(frameConfig.bottomRight, '+'),
  };
}

module.exports = { renderFrame };
