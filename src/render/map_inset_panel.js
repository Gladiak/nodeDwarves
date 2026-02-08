'use strict';

const { padRight } = require('../utils');
const { fitLine } = require('./format');
const { applyColor } = require('./colors');

// Set one grid cell with optional color key.
function setGridCell(grid, x, y, symbol, colorKey, colors) {
  if (!grid[y] || grid[y][x] === undefined) {
    return;
  }
  const value = String(symbol || ' ')[0] || ' ';
  grid[y][x] = colorKey ? applyColor(value, colorKey, colors) : value;
}

// Clamp inset highlight spans to the visible line length.
function clampInsetSpans(spans, maxLength) {
  if (!Array.isArray(spans) || spans.length === 0 || maxLength <= 0) {
    return [];
  }
  const out = [];
  for (const span of spans) {
    if (!span || !span.colorKey) {
      continue;
    }
    const start = Math.max(0, Math.floor(Number(span.start || 0)));
    const end = Math.min(maxLength, Math.ceil(Number(span.end || 0)));
    if (end <= start) {
      continue;
    }
    out.push({
      start,
      end,
      colorKey: String(span.colorKey),
    });
  }
  return out;
}

// Build one inset line entry with optional color spans.
function buildInsetTextLine(rawText, width, spans = []) {
  const safeWidth = Math.max(0, Number(width || 0));
  const text = fitLine(String(rawText || ''), safeWidth);
  return {
    text: padRight(text, safeWidth),
    spans: clampInsetSpans(spans, text.length),
  };
}

// Build one inset line entry from text segments with optional color keys.
function buildInsetSegmentLine(segments, width) {
  const list = Array.isArray(segments) ? segments : [];
  let text = '';
  const spans = [];
  for (const segment of list) {
    if (segment === null || segment === undefined) {
      continue;
    }
    const part = segment && typeof segment === 'object' && Object.prototype.hasOwnProperty.call(segment, 'text')
      ? String(segment.text || '')
      : String(segment);
    const start = text.length;
    text += part;
    const colorKey = segment && typeof segment === 'object' ? segment.colorKey : null;
    if (colorKey) {
      spans.push({
        start,
        end: start + part.length,
        colorKey: String(colorKey),
      });
    }
  }
  return buildInsetTextLine(text, width, spans);
}

// Pick the first candidate line that fully fits the inset width.
function pickFittingInsetText(options, width) {
  const list = Array.isArray(options) ? options : [];
  const safeWidth = Math.max(1, Math.floor(Number(width || 1)));
  for (const option of list) {
    const candidate = String(option || '');
    if (fitLine(candidate, safeWidth) === candidate) {
      return candidate;
    }
  }
  if (list.length === 0) {
    return '';
  }
  return fitLine(String(list[list.length - 1] || ''), safeWidth);
}

// Compute average of a numeric dwarf state metric.
function averageDwarfMetric(dwarves, key) {
  if (!Array.isArray(dwarves) || dwarves.length === 0) {
    return 0;
  }
  let sum = 0;
  let count = 0;
  for (const dwarf of dwarves) {
    const value = Number(dwarf && dwarf.state ? dwarf.state[key] : Number.NaN);
    if (!Number.isFinite(value)) {
      continue;
    }
    sum += value;
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

// Build concise map-inset lines with high-signal runtime data.
function buildMapInsetLines(state, config, width, height) {
  const safeHeight = Math.max(0, Math.floor(Number(height || 0)));
  if (safeHeight <= 0) {
    return [];
  }
  const metrics = [];
  const tick = Math.max(0, Number(state && state.tick || 0));
  const seasonOrder = Array.isArray(config && config.seasons && config.seasons.order)
    && config.seasons.order.length > 0
    ? config.seasons.order
    : ['spring', 'summer', 'autumn', 'winter'];
  const seasonGlobal = Math.max(0, Number(state && state.season ? state.season.globalIndex : 0));
  const year = Math.floor(seasonGlobal / Math.max(1, seasonOrder.length)) + 1;
  const cycleStats = state && state.cycleStats ? state.cycleStats : {};
  const cycleCount = Math.max(0, Number(cycleStats.count || 0));

  const dwarves = Array.isArray(state && state.dwarves) ? state.dwarves : [];
  let adults = 0;
  let children = 0;
  let elders = 0;
  for (const dwarf of dwarves) {
    const stage = dwarf && dwarf.lifeStage ? dwarf.lifeStage : '';
    if (stage === 'child') {
      children += 1;
    } else if (stage === 'elder') {
      elders += 1;
    } else {
      adults += 1;
    }
  }
  const totalPopulation = Math.max(0, dwarves.length);
  const moralePct = Math.max(0, Math.round(averageDwarfMetric(dwarves, 'morale') * 100));

  const underrealm = state && state.underrealm ? state.underrealm : null;
  const underrealmEnabled = Boolean(underrealm && underrealm.enabled !== false);
  const activeDepth = Math.max(0, Number(underrealm && underrealm.activeDepth || 0));
  const maxUnlockedDepth = Math.max(0, Number(underrealm && underrealm.maxUnlockedDepth || 0));
  const maxDepth = Math.max(0, Number(underrealm && underrealm.maxDepth || 0));
  const viewLabel = activeDepth > 0 ? 'Underrealm' : 'Surface';
  const depthToken = underrealmEnabled ? `D${activeDepth}` : 'D0';
  const unlockToken = underrealmEnabled ? `D${maxUnlockedDepth}/${maxDepth}` : 'Off';

  metrics.push(buildInsetTextLine(pickFittingInsetText(
    [
      `T:${tick}  Y:${year}  Cy:${cycleCount}`,
      `Tick:${tick} Year:${year} C:${cycleCount}`,
      `T${tick} Y${year} C${cycleCount}`,
    ],
    width,
  ), width));
  metrics.push(buildInsetTextLine(pickFittingInsetText(
    [
      `Pop:${totalPopulation}  C:${children} A:${adults} E:${elders}  Mor:${moralePct}`,
      `Pop:${totalPopulation} C:${children} A:${adults} E:${elders} M:${moralePct}`,
      `P:${totalPopulation} C:${children} A:${adults} E:${elders} M:${moralePct}`,
      `P:${totalPopulation} C${children} A${adults} E${elders}`,
    ],
    width,
  ), width));
  metrics.push(buildInsetTextLine(pickFittingInsetText(
    [
      `Underrealm unlocked: ${unlockToken}`,
      `Underrealm: ${unlockToken}`,
      `U:${unlockToken}`,
    ],
    width,
  ), width));
  metrics.push(buildInsetTextLine(pickFittingInsetText(
    [
      `View ${viewLabel} ${depthToken}`,
      `View: ${viewLabel} ${depthToken}`,
      `${viewLabel} ${depthToken}`,
      `V:${depthToken}`,
    ],
    width,
  ), width));

  const commandLine = buildInsetSegmentLine(
    [
      {
        text: pickFittingInsetText(
          [
            '[␠]⏯ [h]▦ [i]◎ [l]≡ [⇆] [⇅] [m]⤓ [M]⤓+',
            '␠⏯ h▦ i◎ l≡ ⇆ ⇅ m⤓ M⤓+',
            'h i l ⇆ ⇅ m M+ ␠',
            'h i l LR UD m M+ Sp',
          ],
          width,
        ),
        colorKey: 'hud_header',
      },
    ],
    width,
  );
  const metricBudget = Math.max(0, safeHeight - 1);
  if (metricBudget >= 5) {
    metrics.push(buildInsetTextLine('─'.repeat(Math.max(1, width)), width));
  }

  const out = [];
  for (const line of metrics) {
    if (out.length >= metricBudget) {
      break;
    }
    out.push(line);
  }
  while (out.length < metricBudget) {
    out.push(buildInsetTextLine('', width));
  }
  out.push(commandLine);
  return out;
}

// Carve and render the top-right inset panel directly inside the map grid.
function applyMapInsetPanel(grid, state, config, runtime, colors, frameSymbols) {
  const inset = runtime && runtime.mapInset;
  if (!inset) {
    return;
  }
  const minX = Math.max(0, Math.floor(Number(inset.x || 0)));
  const minY = Math.max(0, Math.floor(Number(inset.y || 0)));
  const width = Math.max(0, Math.floor(Number(inset.width || 0)));
  const height = Math.max(0, Math.floor(Number(inset.height || 0)));
  if (width < 2 || height < 2) {
    return;
  }
  const maxX = minX + width - 1;
  const maxY = minY + height - 1;
  const symbols = frameSymbols && typeof frameSymbols === 'object'
    ? frameSymbols
    : {
      horizontal: '-',
      vertical: '|',
      topLeft: '+',
      topRight: '+',
      bottomLeft: '+',
      bottomRight: '+',
    };

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      setGridCell(grid, x, y, ' ', null, colors);
    }
  }

  setGridCell(grid, minX, minY, symbols.topLeft, 'frame', colors);
  setGridCell(grid, maxX, minY, symbols.topRight, 'frame', colors);
  setGridCell(grid, minX, maxY, symbols.bottomLeft, 'frame', colors);
  setGridCell(grid, maxX, maxY, symbols.bottomRight, 'frame', colors);
  for (let x = minX + 1; x < maxX; x += 1) {
    setGridCell(grid, x, minY, symbols.horizontal, 'frame', colors);
    setGridCell(grid, x, maxY, symbols.horizontal, 'frame', colors);
  }
  for (let y = minY + 1; y < maxY; y += 1) {
    setGridCell(grid, minX, y, symbols.vertical, 'frame', colors);
    setGridCell(grid, maxX, y, symbols.vertical, 'frame', colors);
  }

  const title = fitLine(String(inset.title || 'ᚦ NodeDwarves ᛞ'), Math.max(0, width - 4));
  const titleStart = Math.max(minX + 1, minX + Math.floor((width - title.length) / 2));
  for (let i = 0; i < title.length; i += 1) {
    const x = titleStart + i;
    if (x >= maxX) {
      break;
    }
    setGridCell(grid, x, minY, title[i], 'hud_header', colors);
  }

  const innerWidth = Math.max(0, width - 2);
  const innerHeight = Math.max(0, height - 2);
  const lines = buildMapInsetLines(state, config, innerWidth, innerHeight);
  for (let row = 0; row < lines.length; row += 1) {
    const y = minY + 1 + row;
    if (y >= maxY) {
      break;
    }
    const entry = lines[row] && typeof lines[row] === 'object'
      ? lines[row]
      : buildInsetTextLine(String(lines[row] || ''), innerWidth);
    const lineText = String(entry.text || '');
    const spans = Array.isArray(entry.spans) ? entry.spans : [];
    for (let col = 0; col < lineText.length && col < innerWidth; col += 1) {
      let colorKey = null;
      for (const span of spans) {
        if (col >= span.start && col < span.end) {
          colorKey = span.colorKey;
          break;
        }
      }
      setGridCell(grid, minX + 1 + col, y, lineText[col], colorKey, colors);
    }
  }
}

module.exports = { applyMapInsetPanel };
