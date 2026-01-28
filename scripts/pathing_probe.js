'use strict';

const config = require('../config.json');
const { createInitialState } = require('../src/state');
const { buildRuntime } = require('../src/runtime');

function buildRuntimeForProbe(display) {
  const columns = Number(display.width || 120);
  const rows = Number(display.height || 40);
  return buildRuntime(display, { columns, rows });
}

const terrainConfig = (config.display && config.display.terrain) || {};
const terrainSymbols = (terrainConfig && terrainConfig.symbols) || {};
const terrainWalkable = (terrainConfig && terrainConfig.walkable) || {};
const symbolToType = Object.entries(terrainSymbols).reduce((acc, [type, symbol]) => {
  const key = String(symbol || '')[0];
  if (key) {
    acc[key] = type;
  }
  return acc;
}, {});

function isWalkableChar(ch) {
  const type = symbolToType[ch];
  if (type) {
    return terrainWalkable[type] !== false;
  }
  return true;
}

function bfsReachable(map, start, target) {
  const height = map.length;
  const width = height > 0 ? map[0].length : 0;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < width && y < height;
  const key = (x, y) => `${x},${y}`;
  const queue = [start];
  const visited = new Set([key(start.x, start.y)]);
  while (queue.length) {
    const { x, y } = queue.shift();
    if (x === target.x && y === target.y) {
      return true;
    }
    const neighbors = [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 },
    ];
    for (const n of neighbors) {
      if (!inBounds(n.x, n.y)) {
        continue;
      }
      if (!isWalkableChar(map[n.y][n.x])) {
        continue;
      }
      const k = key(n.x, n.y);
      if (visited.has(k)) {
        continue;
      }
      visited.add(k);
      queue.push(n);
    }
  }
  return false;
}

function simulateGreedy(map, start, target, trials, maxSteps) {
  let success = 0;
  const height = map.length;
  const width = height > 0 ? map[0].length : 0;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < width && y < height;

  for (let t = 0; t < trials; t += 1) {
    let x = start.x;
    let y = start.y;
    let done = false;
    for (let step = 0; step < maxSteps; step += 1) {
      if (x === target.x && y === target.y) {
        success += 1;
        done = true;
        break;
      }
      const options = [
        { x, y },
        { x: x + 1, y },
        { x: x - 1, y },
        { x, y: y + 1 },
        { x, y: y - 1 },
      ];
      const valid = options.filter((pos) => {
        if (!inBounds(pos.x, pos.y)) {
          return false;
        }
        return isWalkableChar(map[pos.y][pos.x]);
      });
      if (valid.length === 0) {
        break;
      }
      const currentDistance = Math.abs(target.x - x) + Math.abs(target.y - y);
      let bestDistance = Infinity;
      let best = [];
      for (const pos of valid) {
        const dist = Math.abs(target.x - pos.x) + Math.abs(target.y - pos.y);
        if (dist < bestDistance) {
          bestDistance = dist;
          best = [pos];
        } else if (dist === bestDistance) {
          best.push(pos);
        }
      }
      let pick = null;
      if (bestDistance === currentDistance) {
        const moves = valid.filter((pos) => !(pos.x === x && pos.y === y));
        if (moves.length > 0) {
          pick = moves[Math.floor(Math.random() * moves.length)];
        }
      }
      if (!pick) {
        pick = best[Math.floor(Math.random() * best.length)];
      }
      if (!pick) {
        break;
      }
      x = pick.x;
      y = pick.y;
    }
    if (!done && x === target.x && y === target.y) {
      success += 1;
    }
  }
  return success / Math.max(1, trials);
}

function localBfsStep(map, start, target, radius) {
  const height = map.length;
  const width = height > 0 ? map[0].length : 0;
  if (start.x === target.x && start.y === target.y) {
    return null;
  }
  const maxRadius = Math.max(1, Math.floor(radius || 0));
  const minX = Math.max(0, start.x - maxRadius);
  const maxX = Math.min(width - 1, start.x + maxRadius);
  const minY = Math.max(0, start.y - maxRadius);
  const maxY = Math.min(height - 1, start.y + maxRadius);
  const localWidth = maxX - minX + 1;
  const localHeight = maxY - minY + 1;
  if (localWidth <= 0 || localHeight <= 0) {
    return null;
  }
  const total = localWidth * localHeight;
  const visited = new Array(total).fill(false);
  const parent = new Array(total).fill(-1);
  const queue = new Array(total);
  let head = 0;
  let tail = 0;

  const toIndex = (x, y) => (y - minY) * localWidth + (x - minX);
  const toCoord = (index) => ({
    x: (index % localWidth) + minX,
    y: Math.floor(index / localWidth) + minY,
  });

  const startIndex = toIndex(start.x, start.y);
  queue[tail++] = startIndex;
  visited[startIndex] = true;

  let targetIndex = -1;
  let bestIndex = startIndex;
  let bestDistance = Math.abs(target.x - start.x) + Math.abs(target.y - start.y);

  while (head < tail) {
    const index = queue[head++];
    const pos = toCoord(index);
    const dist = Math.abs(target.x - pos.x) + Math.abs(target.y - pos.y);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestIndex = index;
    }
    if (pos.x === target.x && pos.y === target.y) {
      targetIndex = index;
      break;
    }

    const neighbors = [
      { x: pos.x + 1, y: pos.y },
      { x: pos.x - 1, y: pos.y },
      { x: pos.x, y: pos.y + 1 },
      { x: pos.x, y: pos.y - 1 },
    ];
    for (const next of neighbors) {
      if (next.x < minX || next.x > maxX || next.y < minY || next.y > maxY) {
        continue;
      }
      if (!isWalkableChar(map[next.y][next.x])) {
        continue;
      }
      const nextIndex = toIndex(next.x, next.y);
      if (visited[nextIndex]) {
        continue;
      }
      visited[nextIndex] = true;
      parent[nextIndex] = index;
      queue[tail++] = nextIndex;
    }
  }

  const goalIndex = targetIndex !== -1 ? targetIndex : bestIndex;
  if (goalIndex === startIndex) {
    return null;
  }

  let current = goalIndex;
  let prev = parent[current];
  if (prev === -1) {
    return null;
  }
  while (prev !== startIndex && prev !== -1) {
    current = prev;
    prev = parent[current];
  }
  if (prev === -1) {
    return null;
  }
  return toCoord(current);
}

function simulateDetour(map, start, target, trials, maxSteps, pathing) {
  const stallThreshold = Math.max(1, Number(pathing.stallThreshold || 6));
  const detourTicks = Math.max(0, Number(pathing.detourTicks || 4));
  const bfsRadius = Math.max(3, Number(pathing.bfsRadius || 10));
  let success = 0;
  const height = map.length;
  const width = height > 0 ? map[0].length : 0;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < width && y < height;

  for (let t = 0; t < trials; t += 1) {
    let x = start.x;
    let y = start.y;
    let stall = 0;
    let detour = 0;
    let done = false;
    for (let step = 0; step < maxSteps; step += 1) {
      if (x === target.x && y === target.y) {
        success += 1;
        done = true;
        break;
      }
      const beforeDistance = Math.abs(target.x - x) + Math.abs(target.y - y);
      const useDetour = detour > 0 || stall >= stallThreshold;
      if (useDetour && detour === 0 && detourTicks > 0) {
        detour = detourTicks;
      }

      let moved = false;
      if (useDetour) {
        const stepPos = localBfsStep(map, { x, y }, target, bfsRadius);
        if (stepPos) {
          x = stepPos.x;
          y = stepPos.y;
          moved = true;
        }
      }
      if (!moved) {
        const options = [
          { x, y },
          { x: x + 1, y },
          { x: x - 1, y },
          { x, y: y + 1 },
          { x, y: y - 1 },
        ];
        const valid = options.filter((pos) => {
          if (!inBounds(pos.x, pos.y)) {
            return false;
          }
          return isWalkableChar(map[pos.y][pos.x]);
        });
        if (valid.length === 0) {
          break;
        }
        let bestDistance = Infinity;
        let best = [];
        for (const pos of valid) {
          const dist = Math.abs(target.x - pos.x) + Math.abs(target.y - pos.y);
          if (dist < bestDistance) {
            bestDistance = dist;
            best = [pos];
          } else if (dist === bestDistance) {
            best.push(pos);
          }
        }
        let pick = null;
        if (bestDistance === beforeDistance) {
          const moves = valid.filter((pos) => !(pos.x === x && pos.y === y));
          if (moves.length > 0) {
            pick = moves[Math.floor(Math.random() * moves.length)];
          }
        }
        if (!pick) {
          pick = best[Math.floor(Math.random() * best.length)];
        }
        if (!pick) {
          break;
        }
        const prevX = x;
        const prevY = y;
        x = pick.x;
        y = pick.y;
        moved = x !== prevX || y !== prevY;
      }

      const afterDistance = Math.abs(target.x - x) + Math.abs(target.y - y);
      if (moved && afterDistance < beforeDistance) {
        stall = 0;
      } else {
        stall += 1;
      }
      if (detour > 0 && useDetour) {
        detour -= 1;
      }
    }
    if (!done && x === target.x && y === target.y) {
      success += 1;
    }
  }
  return success / Math.max(1, trials);
}

function printMap(lines) {
  return lines.join('\n');
}

function runPatternChecks() {
  const patterns = [
    {
      name: 'river_cut_no_bridge',
      map: [
        '..........',
        '..........',
        '==========',
        '..........',
        '..........',
      ],
      start: { x: 1, y: 1 },
      target: { x: 8, y: 3 },
    },
    {
      name: 'river_with_gap',
      map: [
        '..........',
        '..........',
        '====.=====',
        '..........',
        '..........',
      ],
      start: { x: 1, y: 1 },
      target: { x: 8, y: 3 },
    },
    {
      name: 'u_shaped_lake',
      map: [
        '..........',
        '.~~~~~~~..',
        '.~.....~..',
        '.~.~~~.~..',
        '.~...@.~..',
        '.~~~~~~~..',
        '..........',
      ],
      start: { x: 5, y: 4 },
      target: { x: 1, y: 1 },
    },
    {
      name: 'diagonal_pincher',
      map: [
        '...=......',
        '..=.=.....',
        '.=...=....',
        '..=.=.....',
        '...=......',
        '..........',
      ],
      start: { x: 0, y: 5 },
      target: { x: 9, y: 0 },
    },
  ];

  const results = [];
  const pathing = (config.population && config.population.pathing) || {};
  for (const pattern of patterns) {
    const map = pattern.map.map((line) => line.split(''));
    const reachable = bfsReachable(map, pattern.start, pattern.target);
    const success = reachable ? simulateGreedy(map, pattern.start, pattern.target, 200, 200) : 0;
    const detourSuccess = reachable
      ? simulateDetour(map, pattern.start, pattern.target, 200, 200, pathing)
      : 0;
    results.push({
      name: pattern.name,
      reachable,
      success,
      detourSuccess,
      map: pattern.map,
    });
  }

  console.log('== Pattern probe (greedy vs BFS) ==');
  for (const result of results) {
    console.log(
      `\n[${result.name}] reachable=${result.reachable} `
      + `greedySuccess=${(result.success * 100).toFixed(1)}% `
      + `detourSuccess=${(result.detourSuccess * 100).toFixed(1)}%`,
    );
    console.log(printMap(result.map));
  }
}

function buildComponents(walkable) {
  const height = walkable.length;
  const width = height > 0 ? walkable[0].length : 0;
  const ids = Array.from({ length: height }, () => Array(width).fill(-1));
  const sizes = [];
  let current = 0;

  const inBounds = (x, y) => x >= 0 && y >= 0 && x < width && y < height;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!walkable[y][x] || ids[y][x] !== -1) {
        continue;
      }
      const queue = [{ x, y }];
      ids[y][x] = current;
      let size = 0;
      while (queue.length) {
        const cell = queue.shift();
        size += 1;
        const neighbors = [
          { x: cell.x + 1, y: cell.y },
          { x: cell.x - 1, y: cell.y },
          { x: cell.x, y: cell.y + 1 },
          { x: cell.x, y: cell.y - 1 },
        ];
        for (const n of neighbors) {
          if (!inBounds(n.x, n.y)) {
            continue;
          }
          if (!walkable[n.y][n.x]) {
            continue;
          }
          if (ids[n.y][n.x] !== -1) {
            continue;
          }
          ids[n.y][n.x] = current;
          queue.push(n);
        }
      }
      sizes[current] = size;
      current += 1;
    }
  }
  return { ids, sizes };
}

function runMapConnectivityProbe() {
  const display = { ...config.display, autoSize: false };
  const runtime = buildRuntimeForProbe(display);
  const deterministicConfig = JSON.parse(JSON.stringify(config));
  deterministicConfig.display.terrain.seed = 12345;
  const state = createInitialState(deterministicConfig, runtime);
  const terrain = state.terrain;
  if (!terrain || !terrain.walkable) {
    console.log('No terrain walkable map available.');
    return;
  }

  const { ids, sizes } = buildComponents(terrain.walkable);
  const maxSize = sizes.length ? Math.max(...sizes) : 0;
  const mainId = sizes.findIndex((size) => size === maxSize);

  const nodesOutside = [];
  for (const node of state.nodes || []) {
    const id = ids[node.y] ? ids[node.y][node.x] : -1;
    if (id !== mainId) {
      nodesOutside.push(node);
    }
  }

  const dwarvesOutside = [];
  for (const dwarf of state.dwarves || []) {
    const id = ids[dwarf.y] ? ids[dwarf.y][dwarf.x] : -1;
    if (id !== mainId) {
      dwarvesOutside.push(dwarf);
    }
  }

  console.log('\n== Map connectivity probe ==');
  console.log(`components=${sizes.length} mainSize=${maxSize}`);
  console.log(`nodesOutsideMain=${nodesOutside.length} dwarvesOutsideMain=${dwarvesOutside.length}`);
  if (nodesOutside.length > 0) {
    const sample = nodesOutside.slice(0, 5).map((n) => `${n.id}@${n.x},${n.y}`).join(' ');
    console.log(`sample nodes outside main: ${sample}`);
  }
  if (dwarvesOutside.length > 0) {
    const sample = dwarvesOutside.slice(0, 5).map((d) => `${d.id}@${d.x},${d.y}`).join(' ');
    console.log(`sample dwarves outside main: ${sample}`);
  }
}

runPatternChecks();
runMapConnectivityProbe();
