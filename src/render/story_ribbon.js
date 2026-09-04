'use strict';

const { padRight } = require('../utils');
const { createDwarfIdentityCache, resolveDwarfIdentity } = require('../dwarf_identity');
const { resolvePlaceLabel } = require('../place_identity');
const { applyColor } = require('./colors');

const DEFAULT_RIBBON = Object.freeze({
  enabled: true,
  maxWidth: 118,
  minWidth: 40,
  marginLeft: 1,
  marginRight: 1,
  marginBottom: 1,
  hideWhenModalOpen: true,
});

const IMPORTANCE_COLORS = Object.freeze({
  major: 'alert_warning',
  critical: 'alert_critical',
  legendary: 'alert_critical',
});

// Build a compact, read-only in-map presentation of the Director's current focus.
function buildStoryRibbon(state, config, runtime, options = {}) {
  const settings = resolveStoryRibbonConfig(config);
  const focus = state && state.story && state.story.currentFocus;
  if (!settings.enabled || !focus || (settings.hideWhenModalOpen && hasBlockingOverlay(state))) {
    return null;
  }

  const rect = resolveStoryRibbonRect(runtime, settings);
  if (!rect) return null;

  const event = findFocusedEvent(state, focus.eventId);
  const saga = findFocusedSaga(state, focus.sagaId || (event && event.sagaId));
  const facts = buildStoryRibbonFacts(
    state,
    config,
    focus,
    event,
    saga,
    rect.width - 4,
    options.focusCue,
  );
  const importance = normalizeImportance(focus.importance || (event && event.importance));
  const title = buildRibbonTitle(importance, saga && saga.id, rect.width - 4);
  const colorKey = IMPORTANCE_COLORS[importance] || 'hud_header';

  return {
    ...rect,
    importance,
    eventId: String(focus.eventId || ''),
    sagaId: saga ? String(saga.id || '') : null,
    fields: facts.fields,
    lines: buildRibbonBox(title, facts.rows, rect.width, colorKey),
  };
}

// Draw one ribbon descriptor without mutating simulation or Director state.
function applyStoryRibbon(grid, ribbon, colors) {
  if (!ribbon || !Array.isArray(ribbon.lines)) return;
  for (let row = 0; row < ribbon.lines.length; row += 1) {
    const y = ribbon.y + row;
    if (!grid[y]) continue;
    const line = ribbon.lines[row];
    const text = String(line.text || '');
    for (let column = 0; column < text.length; column += 1) {
      const x = ribbon.x + column;
      if (grid[y][x] === undefined) continue;
      const highlighted = line.colorKey
        && column >= Number(line.colorStart || 0)
        && column < Number(line.colorEnd || 0);
      grid[y][x] = highlighted ? applyColor(text[column], line.colorKey, colors) : text[column];
    }
  }
}

// Normalize display-only ribbon settings under supported terminal bounds.
function resolveStoryRibbonConfig(config) {
  const raw = config && config.display && config.display.storyRibbon
    ? config.display.storyRibbon
    : {};
  const minWidth = clampInteger(raw.minWidth, DEFAULT_RIBBON.minWidth, 24, 240);
  return {
    enabled: raw.enabled !== false,
    maxWidth: Math.max(minWidth, clampInteger(raw.maxWidth, DEFAULT_RIBBON.maxWidth, 24, 240)),
    minWidth,
    marginLeft: clampInteger(raw.marginLeft, DEFAULT_RIBBON.marginLeft, 0, 40),
    marginRight: clampInteger(raw.marginRight, DEFAULT_RIBBON.marginRight, 0, 40),
    marginBottom: clampInteger(raw.marginBottom, DEFAULT_RIBBON.marginBottom, 0, 20),
    hideWhenModalOpen: raw.hideWhenModalOpen !== false,
  };
}

// Place the ribbon along the lower map edge and avoid the carved Ops Snapshot when they overlap.
function resolveStoryRibbonRect(runtime, settings) {
  const gridWidth = Math.max(0, Math.floor(Number(runtime && runtime.gridWidth || 0)));
  const gridHeight = Math.max(0, Math.floor(Number(runtime && runtime.gridHeight || 0)));
  const height = 4;
  const y = gridHeight - settings.marginBottom - height;
  if (y < 0) return null;

  let availableWidth = gridWidth - settings.marginLeft - settings.marginRight;
  const inset = runtime && runtime.mapInset;
  if (inset && rectanglesOverlapVertically(y, height, inset.y, inset.height)) {
    availableWidth = Math.min(availableWidth, Math.floor(Number(inset.x || 0)) - settings.marginLeft - 1);
  }
  const width = Math.min(settings.maxWidth, availableWidth);
  if (width < settings.minWidth) return null;
  return { x: settings.marginLeft, y, width, height };
}

function rectanglesOverlapVertically(topA, heightA, topB, heightB) {
  const aBottom = topA + Math.max(0, Number(heightA || 0));
  const bTop = Math.max(0, Number(topB || 0));
  const bBottom = bTop + Math.max(0, Number(heightB || 0));
  return topA < bBottom && bTop < aBottom;
}

function hasBlockingOverlay(state) {
  const ui = state && state.ui ? state.ui : {};
  return Boolean(
    (ui.inspect && ui.inspect.open)
    || (ui.legend && ui.legend.open)
    || (ui.telemetryPanel && ui.telemetryPanel.open)
    || (ui.warriorPanel && ui.warriorPanel.open)
    || (ui.eventLog && ui.eventLog.open)
    || (ui.saveMap && ui.saveMap.open)
    || (ui.transition && (ui.transition.active || ui.transition.showPanel)),
  );
}

function findFocusedEvent(state, eventId) {
  const id = String(eventId || '');
  if (!id) return null;
  const log = Array.isArray(state && state.eventLog) ? state.eventLog : [];
  return log.find((entry) => entry && String(entry.id || '') === id) || null;
}

function findFocusedSaga(state, sagaId) {
  const id = String(sagaId || '');
  const byId = state && state.story && state.story.sagas && state.story.sagas.byId;
  return id && byId && typeof byId === 'object' ? byId[id] || null : null;
}

function buildStoryRibbonFacts(state, config, focus, event, saga, width, focusCue) {
  const actor = formatActors(event && event.actors, focus && focus.actorIds, state, config, width);
  const rawAction = String(event && event.message || saga && saga.summary || humanizeToken(focus && focus.type) || 'Major event');
  const action = removeLeadingActor(rawAction, actor);
  const place = formatPlace(event && event.location, focus && focus.placeId, state, width);
  const consequence = formatConsequence(event && event.consequences);
  const compact = width < 56;
  const actorLabel = compact ? 'A' : 'Actor';
  const actionLabel = compact ? 'Do' : 'Action';
  const resultLabel = compact ? 'Result' : 'Consequence';
  const firstPrefix = actor ? `${actorLabel}: ${actor} | ${actionLabel}: ` : `${actionLabel}: `;
  const firstRow = `${firstPrefix}${truncateText(action, Math.max(1, width - firstPrefix.length))}`;
  const secondParts = [];
  if (place) secondParts.push(`At: ${place}${focusCue ? ` [${focusCue}]` : ''}`);
  else if (focusCue) secondParts.push(`Direction: ${focusCue}`);
  if (consequence) secondParts.push(`${resultLabel}: ${consequence}`);
  if (secondParts.length === 0 && saga && saga.summary && saga.summary !== action) {
    secondParts.push(`Beat: ${saga.summary}`);
  }
  const secondRow = truncateText(secondParts.join(' | ') || `Focus: ${humanizeToken(focus && focus.type)}`, width);
  return {
    fields: { actor, action, place, consequence },
    rows: [truncateText(firstRow, width), secondRow],
  };
}

function removeLeadingActor(action, actor) {
  const text = String(action || '').trim();
  const primaryActor = String(actor || '').split(' & ')[0].trim();
  if (!primaryActor || !text.toLowerCase().startsWith(primaryActor.toLowerCase())) return text;
  const suffix = text.slice(primaryActor.length);
  if (suffix && !/^[\s:,-]/.test(suffix)) return text;
  return suffix.replace(/^[\s:,-]+/, '').trim() || text;
}

function formatActors(eventActors, focusActorIds, state, config, width) {
  const actors = Array.isArray(eventActors) && eventActors.length > 0
    ? eventActors
    : (Array.isArray(focusActorIds) ? focusActorIds.map((id) => ({ kind: 'dwarf', id })) : []);
  const cache = createDwarfIdentityCache(16);
  const labels = [];
  const limit = width >= 90 ? 2 : 1;
  for (const actor of actors) {
    if (!actor || typeof actor !== 'object') continue;
    let label = '';
    if (actor.kind === 'dwarf') {
      const identity = resolveDwarfIdentity(actor.id, state, config, { cache, snapshot: actor });
      label = identity.name !== 'Unknown' ? identity.displayName : String(actor.label || identity.label);
    } else {
      label = String(actor.label || humanizeToken(actor.id)).trim();
    }
    if (label && !labels.includes(label)) labels.push(label);
    if (labels.length >= limit) break;
  }
  return labels.join(' & ');
}

function formatPlace(location, focusPlaceId, state, width) {
  const compact = width < 70;
  const placeId = String(location && location.placeId || focusPlaceId || '');
  const retained = String(location && (compact ? location.shortLabel || location.label : location.label) || '');
  const resolved = placeId ? resolvePlaceLabel(state, placeId, retained, compact) : retained;
  const named = resolved === placeId ? humanizeToken(placeId) : resolved;
  if (named) return named;
  const scope = String(location && location.scope || '');
  if (scope === 'underrealm') return `Underrealm D${Math.max(1, Number(location.depth || 1))}`;
  if (scope === 'surface') return 'Surface';
  if (scope === 'world') return 'World';
  return '';
}

function formatConsequence(consequences) {
  const entry = Array.isArray(consequences) ? consequences.find(Boolean) : null;
  if (!entry || typeof entry !== 'object') return '';
  const kind = String(entry.kind || 'status');
  const metric = humanizeToken(entry.metric || kind || 'outcome');
  const target = humanizeToken(entry.targetId || entry.targetKind || 'target');
  if (kind === 'create') return `${humanizeToken(entry.targetKind)} created`;
  if (kind === 'destroy') return `${target} destroyed`;
  if (kind === 'death') return `${target} died`;
  if (kind === 'injury') return `${target} injured`;
  if (kind === 'unlock') return `${target} unlocked`;
  if (typeof entry.value === 'boolean') {
    const stateMetric = metric.replace(/ active$/i, '').trim() || target;
    return `${stateMetric} ${entry.value ? 'began' : 'ended'}`;
  }
  const value = entry.value === null || entry.value === undefined ? '' : formatScalar(entry.value);
  const unit = entry.unit ? ` ${humanizeToken(entry.unit)}` : '';
  if (value && typeof entry.value === 'string') return `${metric}: ${value}`.trim();
  if (value) return `${metric} ${value}${unit}`.trim();
  return `${humanizeToken(kind)} ${target}`.trim();
}

function formatScalar(value) {
  if (value === true) return 'active';
  if (value === false) return 'ended';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return humanizeToken(value);
}

function buildRibbonTitle(importance, sagaId, width) {
  const saga = sagaId ? ` | ${compactSagaId(sagaId)}` : '';
  return truncateText(`STORY | ${importance.toUpperCase()}${saga}`, width);
}

function compactSagaId(value) {
  const id = String(value || '');
  const match = id.match(/c(\d+)_([0-9]+)$/);
  return match ? `Saga C${Number(match[1])}.${Number(match[2])}` : `Saga ${humanizeToken(id)}`;
}

function buildRibbonBox(title, rows, width, colorKey) {
  const innerWidth = Math.max(1, width - 4);
  const titleText = truncateText(title, innerWidth);
  const topSuffix = Math.max(0, innerWidth - titleText.length);
  const top = `╔═${titleText}${'═'.repeat(topSuffix)}═╗`;
  const body = rows.map((text) => `║ ${padRight(truncateText(text, innerWidth), innerWidth)} ║`);
  const bottom = `╚${'═'.repeat(width - 2)}╝`;
  return [
    { text: top, colorKey, colorStart: 0, colorEnd: width },
    ...body.map((entry) => ({ text: entry, colorKey, colorStart: 2, colorEnd: width - 2 })),
    { text: bottom, colorKey, colorStart: 0, colorEnd: width },
  ];
}

function truncateText(value, width) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const limit = Math.max(0, Math.floor(Number(width || 0)));
  if (text.length <= limit) return text;
  if (limit <= 3) return text.slice(0, limit);
  return `${text.slice(0, limit - 3).trimEnd()}...`;
}

function humanizeToken(value) {
  return String(value || '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeImportance(value) {
  const importance = String(value || '').toLowerCase();
  return ['major', 'critical', 'legendary'].includes(importance) ? importance : 'major';
}

function clampInteger(value, fallback, minimum, maximum) {
  const numeric = Number(value);
  const resolved = Number.isFinite(numeric) ? Math.floor(numeric) : fallback;
  return Math.max(minimum, Math.min(maximum, resolved));
}

module.exports = {
  applyStoryRibbon,
  buildStoryRibbon,
  resolveStoryRibbonConfig,
};
