'use strict';

const IMPORTANCE_RANK = Object.freeze({
  ambient: 0,
  notable: 1,
  major: 2,
  critical: 3,
  legendary: 4,
});

const DEFAULT_LEVELS = Object.freeze([
  Object.freeze({ id: 'slow', label: '0.5x', delayMultiplier: 2 }),
  Object.freeze({ id: 'normal', label: '1x', delayMultiplier: 1 }),
  Object.freeze({ id: 'fast', label: '2x', delayMultiplier: 0.5 }),
  Object.freeze({ id: 'very_fast', label: '4x', delayMultiplier: 0.25 }),
]);

const DEFAULT_AUTO_PROTECT = Object.freeze({
  enabled: true,
  minimumImportance: 'critical',
  critical: Object.freeze({ mode: 'slow', level: 'slow', durationMs: 1800 }),
  legendary: Object.freeze({ mode: 'hold', level: 'slow', durationMs: 2400 }),
});

const HARD_MAX_LEVELS = 8;
const HARD_MAX_DURATION_MS = 60000;
const HARD_MAX_DELAY_MULTIPLIER = 16;

// Resolve presentation timing settings without mutating the source config.
function resolveTimeControlsConfig(config, baseTickMsRaw) {
  const display = config && config.display && typeof config.display === 'object'
    ? config.display
    : {};
  const rawCandidate = display.time_controls || display.timeControls;
  const raw = rawCandidate && typeof rawCandidate === 'object' ? rawCandidate : {};
  const baseTickMs = clampNumber(
    baseTickMsRaw === undefined ? display.tickMs : baseTickMsRaw,
    20,
    1,
    60000,
  );
  const minDelayMs = clampNumber(raw.min_delay_ms ?? raw.minDelayMs, 4, 1, baseTickMs);
  const levels = normalizeLevels(raw.levels, baseTickMs, minDelayMs);
  const rawDefaultLevel = raw.default_level ?? raw.defaultLevel;
  const defaultLevel = levels.some((entry) => entry.id === rawDefaultLevel)
    ? String(rawDefaultLevel)
    : (levels.some((entry) => entry.id === 'normal') ? 'normal' : levels[0].id);
  const autoCandidate = raw.auto_protect || raw.autoProtect;
  const autoRaw = autoCandidate && typeof autoCandidate === 'object' ? autoCandidate : {};
  const minimumImportance = normalizeImportance(
    autoRaw.minimum_importance ?? autoRaw.minimumImportance,
    DEFAULT_AUTO_PROTECT.minimumImportance,
  );

  return {
    enabled: raw.enabled !== false,
    baseTickMs,
    minDelayMs,
    defaultLevel,
    levels,
    autoProtect: {
      enabled: autoRaw.enabled !== false,
      minimumImportance,
      critical: normalizeProtectionRule(
        autoRaw.critical,
        DEFAULT_AUTO_PROTECT.critical,
        levels,
      ),
      legendary: normalizeProtectionRule(
        autoRaw.legendary,
        DEFAULT_AUTO_PROTECT.legendary,
        levels,
      ),
    },
  };
}

// Create ephemeral terminal timing state outside the authoritative simulation state.
function createTimeControls(config, baseTickMs) {
  const settings = resolveTimeControlsConfig(config, baseTickMs);
  return {
    settings,
    levelIndex: Math.max(0, settings.levels.findIndex((entry) => entry.id === settings.defaultLevel)),
    manualPaused: false,
    pendingSteps: 0,
    steppedPaused: false,
    autoProtection: null,
    lastObservedFocusId: null,
  };
}

// Observe a new Director focus and arm its configured presentation-only protection once.
function observeStoryFocus(controls, focus, nowMs = Date.now()) {
  if (!controls || !controls.settings) return false;
  expireAutoProtection(controls, nowMs);
  const eventId = String(focus && focus.eventId || '');
  if (!eventId) {
    controls.lastObservedFocusId = null;
    return false;
  }
  if (eventId === controls.lastObservedFocusId) return false;
  controls.lastObservedFocusId = eventId;

  const settings = controls.settings;
  const importance = normalizeImportance(focus && focus.importance, 'ambient');
  if (!settings.enabled
      || !settings.autoProtect.enabled
      || importanceRank(importance) < importanceRank(settings.autoProtect.minimumImportance)) {
    return false;
  }
  const rule = importance === 'legendary'
    ? settings.autoProtect.legendary
    : settings.autoProtect.critical;
  if (!rule || rule.mode === 'off' || rule.durationMs <= 0) return false;

  controls.autoProtection = {
    eventId,
    importance,
    mode: rule.mode,
    level: rule.level,
    startedAtMs: normalizeNow(nowMs),
    untilMs: normalizeNow(nowMs) + rule.durationMs,
  };
  return true;
}

// Toggle manual pause, treating Space during auto-hold as an explicit resume override.
function toggleManualPause(controls) {
  if (!controls || !controls.settings) return false;
  const wasAutoHold = Boolean(
    controls.autoProtection && controls.autoProtection.mode === 'hold',
  );
  cancelAutoProtection(controls);
  controls.pendingSteps = 0;
  controls.steppedPaused = false;
  controls.manualPaused = wasAutoHold ? false : !controls.manualPaused;
  return controls.manualPaused;
}

// Move to an adjacent configured speed and cancel any active automatic protection.
function changeSpeedLevel(controls, delta) {
  if (!controls || !controls.settings || !controls.settings.enabled) return null;
  cancelAutoProtection(controls);
  controls.steppedPaused = false;
  const levels = controls.settings.levels;
  const next = Math.max(
    0,
    Math.min(levels.length - 1, controls.levelIndex + Math.sign(Number(delta || 0))),
  );
  controls.levelIndex = next;
  return levels[next];
}

// Queue exactly one simulation tick and leave the terminal manually paused afterward.
function queueSingleStep(controls) {
  if (!controls || !controls.settings || !controls.settings.enabled) return false;
  cancelAutoProtection(controls);
  controls.manualPaused = true;
  controls.pendingSteps = 1;
  controls.steppedPaused = false;
  return true;
}

// Consume permission for one simulation tick from live or single-step mode.
function consumeSimulationAdvance(controls, nowMs = Date.now()) {
  if (!controls || !controls.settings) return true;
  expireAutoProtection(controls, nowMs);
  if (controls.pendingSteps > 0) {
    controls.pendingSteps -= 1;
    controls.steppedPaused = true;
    return true;
  }
  if (controls.manualPaused) return false;
  return !(controls.autoProtection && controls.autoProtection.mode === 'hold');
}

// Resolve the next visible-loop delay, including a temporary auto-slow override.
function getLoopDelayMs(controls, nowMs = Date.now()) {
  if (!controls || !controls.settings) return 20;
  expireAutoProtection(controls, nowMs);
  const selected = controls.settings.levels[controls.levelIndex] || controls.settings.levels[0];
  const auto = controls.autoProtection;
  const effective = auto && auto.mode === 'slow'
    ? controls.settings.levels.find((entry) => entry.id === auto.level) || selected
    : selected;
  const held = controls.manualPaused || (auto && auto.mode === 'hold');
  return held ? Math.max(controls.settings.baseTickMs, effective.delayMs) : effective.delayMs;
}

// Build a bounded read-only snapshot for renderers and operator feedback.
function getTimeControlsSnapshot(controls, nowMs = Date.now()) {
  if (!controls || !controls.settings) return null;
  expireAutoProtection(controls, nowMs);
  const selected = controls.settings.levels[controls.levelIndex] || controls.settings.levels[0];
  const auto = controls.autoProtection;
  const effective = auto && auto.mode === 'slow'
    ? controls.settings.levels.find((entry) => entry.id === auto.level) || selected
    : selected;
  const autoHold = Boolean(auto && auto.mode === 'hold');
  const paused = Boolean(controls.manualPaused || autoHold);
  return {
    enabled: controls.settings.enabled,
    selectedLevel: selected.id,
    selectedLabel: selected.label,
    effectiveLevel: effective.id,
    effectiveLabel: effective.label,
    delayMs: effective.delayMs,
    paused,
    pauseReason: controls.manualPaused ? 'manual' : (autoHold ? 'auto' : null),
    pendingStep: controls.pendingSteps > 0 || controls.steppedPaused === true,
    autoProtection: auto ? {
      eventId: auto.eventId,
      importance: auto.importance,
      mode: auto.mode,
      remainingMs: Math.max(0, auto.untilMs - normalizeNow(nowMs)),
    } : null,
  };
}

// Clear pause/protection at a cycle transition while retaining the selected manual speed.
function resetTimeControlsForTransition(controls) {
  if (!controls) return;
  controls.manualPaused = false;
  controls.pendingSteps = 0;
  controls.steppedPaused = false;
  controls.autoProtection = null;
  controls.lastObservedFocusId = null;
}

// Drop automatic protection without changing the operator-selected pause or speed.
function cancelAutoProtection(controls) {
  if (controls) controls.autoProtection = null;
}

// Expire elapsed wall-clock protection without touching simulation ticks.
function expireAutoProtection(controls, nowMs) {
  if (!controls || !controls.autoProtection) return;
  if (normalizeNow(nowMs) >= controls.autoProtection.untilMs) {
    controls.autoProtection = null;
  }
}

// Normalize configured speed levels into stable bounded runtime entries.
function normalizeLevels(rawLevels, baseTickMs, minDelayMs) {
  const source = Array.isArray(rawLevels) && rawLevels.length > 0
    ? rawLevels.slice(0, HARD_MAX_LEVELS)
    : DEFAULT_LEVELS;
  const levels = [];
  const seen = new Set();
  for (let index = 0; index < source.length; index += 1) {
    const raw = source[index] && typeof source[index] === 'object' ? source[index] : {};
    const id = normalizeToken(raw.id, `speed_${index + 1}`);
    if (seen.has(id)) continue;
    seen.add(id);
    const delayMultiplier = clampNumber(
      raw.delay_multiplier ?? raw.delayMultiplier,
      DEFAULT_LEVELS[index] ? DEFAULT_LEVELS[index].delayMultiplier : 1,
      0.05,
      HARD_MAX_DELAY_MULTIPLIER,
    );
    const delayMs = Math.max(minDelayMs, Math.round(baseTickMs * delayMultiplier));
    levels.push({
      id,
      label: String(raw.label || id).trim().slice(0, 12) || id,
      delayMultiplier,
      delayMs,
    });
  }
  if (levels.length > 0) return levels;
  return [{ id: 'normal', label: '1x', delayMultiplier: 1, delayMs: baseTickMs }];
}

// Normalize one critical/legendary protection rule against known speed levels.
function normalizeProtectionRule(rawRule, fallback, levels) {
  const raw = rawRule && typeof rawRule === 'object' ? rawRule : {};
  const modeRaw = String(raw.mode || fallback.mode).trim().toLowerCase();
  const mode = ['off', 'slow', 'hold'].includes(modeRaw) ? modeRaw : fallback.mode;
  const requestedLevel = String(raw.level || fallback.level || '');
  const level = levels.some((entry) => entry.id === requestedLevel)
    ? requestedLevel
    : levels[0].id;
  return {
    mode,
    level,
    durationMs: clampNumber(
      raw.duration_ms ?? raw.durationMs,
      fallback.durationMs,
      0,
      HARD_MAX_DURATION_MS,
    ),
  };
}

// Normalize a story-importance token to the closed presentation set.
function normalizeImportance(value, fallback) {
  const token = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(IMPORTANCE_RANK, token) ? token : fallback;
}

// Resolve one importance token to a comparable rank.
function importanceRank(value) {
  return IMPORTANCE_RANK[normalizeImportance(value, 'ambient')];
}

// Convert arbitrary IDs into safe stable config tokens.
function normalizeToken(value, fallback) {
  const token = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
  return token || fallback;
}

// Clamp a finite number with a fallback.
function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  const resolved = Number.isFinite(numeric) ? numeric : fallback;
  return Math.max(min, Math.min(max, resolved));
}

// Normalize injected time for deterministic tests.
function normalizeNow(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Date.now();
}

module.exports = {
  changeSpeedLevel,
  consumeSimulationAdvance,
  createTimeControls,
  getLoopDelayMs,
  getTimeControlsSnapshot,
  observeStoryFocus,
  queueSingleStep,
  resetTimeControlsForTransition,
  resolveTimeControlsConfig,
  toggleManualPause,
};
