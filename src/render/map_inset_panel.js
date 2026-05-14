'use strict';

const { padRight } = require('../utils');
const { getStockpileTarget } = require('../simulation/resources');
const { fitLine } = require('./format');
const { applyColor } = require('./colors');

const DEFAULT_ALERTS = {
  tracked_resources: ['food', 'water', 'beer'],
  stockpile_warning_ratio: 0.5,
  stockpile_critical_ratio: 0.25,
  morale_warning: 0.45,
  morale_critical: 0.3,
  shortage_warning_score: 1.5,
  shortage_critical_score: 2.5,
};

const DEFAULT_FOCUS = {
  enabled: false,
  compact_inset_on_critical: false,
  emphasize_inset_frame: true,
};

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

// Clamp a numeric ratio to [0, 1], with fallback.
function clampUnit(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return clampUnit(fallback, 0);
  }
  return Math.max(0, Math.min(1, numeric));
}

// Resolve alert/focus settings from the active color profile.
function resolveInsetThemeState(colors) {
  const rawAlerts = colors && colors.alerts ? colors.alerts : {};
  const tracked = Array.isArray(rawAlerts.tracked_resources)
    ? rawAlerts.tracked_resources.map((value) => String(value || '').trim()).filter(Boolean)
    : DEFAULT_ALERTS.tracked_resources;
  const stockpileCritical = clampUnit(
    rawAlerts.stockpile_critical_ratio,
    DEFAULT_ALERTS.stockpile_critical_ratio,
  );
  const stockpileWarning = Math.max(
    stockpileCritical,
    clampUnit(rawAlerts.stockpile_warning_ratio, DEFAULT_ALERTS.stockpile_warning_ratio),
  );
  const moraleCritical = clampUnit(rawAlerts.morale_critical, DEFAULT_ALERTS.morale_critical);
  const moraleWarning = Math.max(
    moraleCritical,
    clampUnit(rawAlerts.morale_warning, DEFAULT_ALERTS.morale_warning),
  );
  const shortageWarning = Math.max(
    0,
    Number.isFinite(Number(rawAlerts.shortage_warning_score))
      ? Number(rawAlerts.shortage_warning_score)
      : DEFAULT_ALERTS.shortage_warning_score,
  );
  const shortageCritical = Math.max(
    shortageWarning,
    Number.isFinite(Number(rawAlerts.shortage_critical_score))
      ? Number(rawAlerts.shortage_critical_score)
      : DEFAULT_ALERTS.shortage_critical_score,
  );

  const rawFocus = colors && colors.focus ? colors.focus : {};

  return {
    alerts: {
      tracked_resources: tracked.length > 0 ? tracked : DEFAULT_ALERTS.tracked_resources.slice(),
      stockpile_warning_ratio: stockpileWarning,
      stockpile_critical_ratio: stockpileCritical,
      morale_warning: moraleWarning,
      morale_critical: moraleCritical,
      shortage_warning_score: shortageWarning,
      shortage_critical_score: shortageCritical,
    },
    focus: {
      enabled: rawFocus.enabled === true,
      compact_inset_on_critical: rawFocus.compact_inset_on_critical === true,
      emphasize_inset_frame: rawFocus.emphasize_inset_frame !== false,
    },
  };
}

// Resolve the minimum tracked stockpile ratio across key survival resources.
function resolveTrackedStockpileRatio(state, config, trackedResources) {
  const tracked = Array.isArray(trackedResources) && trackedResources.length > 0
    ? trackedResources
    : DEFAULT_ALERTS.tracked_resources;
  let minRatio = 1;
  let found = false;
  for (const resourceId of tracked) {
    const id = String(resourceId || '').trim();
    if (!id) {
      continue;
    }
    const target = Math.max(0, Number(getStockpileTarget(state, config, id) || 0));
    if (target <= 0) {
      continue;
    }
    const current = Math.max(0, Number(state && state.stockpile ? state.stockpile[id] : 0));
    minRatio = Math.min(minRatio, clampUnit(current / target, 0));
    found = true;
  }
  return found ? minRatio : 1;
}

// Check if at least one underrealm deep raid is currently active.
function hasActiveDeepRaid(state) {
  const raids = state
    && state.underrealm
    && state.underrealm.deepFaction
    && state.underrealm.deepFaction.activeRaidsByDepth;
  if (!raids || typeof raids !== 'object') {
    return false;
  }
  return Object.values(raids).some((entry) => entry && Number(entry.ticksRemaining || 0) > 0);
}

// Resolve one alert color key from a semantic severity level.
function getAlertColorKey(level) {
  if (level === 'critical') {
    return 'alert_critical';
  }
  if (level === 'warning') {
    return 'alert_warning';
  }
  return 'weather_clear';
}

// Resolve the currently active weather id for inset display.
function resolveInsetWeatherType(state, config) {
  const weatherConfig = config && config.weather ? config.weather : {};
  if (weatherConfig.enabled === false) {
    return 'off';
  }
  const type = state && state.weather && state.weather.type
    ? String(state.weather.type)
    : String(weatherConfig.default || 'clear');
  return type.trim().toLowerCase() || 'clear';
}

// Resolve a compact ASCII weather token for the inset runtime line.
function resolveInsetWeatherToken(weatherType) {
  const type = String(weatherType || 'clear').toLowerCase();
  if (type === 'off') {
    return 'Off';
  }
  if (type.includes('storm') || type.includes('thunder')) {
    return 'Storm';
  }
  if (type.includes('rain') || type.includes('shower') || type.includes('drizzle')) {
    return 'Rain';
  }
  if (type.includes('drought') || type.includes('heat') || type.includes('hot')) {
    return 'Drought';
  }
  if (type.includes('cold') || type.includes('snow') || type.includes('frost') || type.includes('blizzard')) {
    return 'Cold';
  }
  if (type.includes('fog') || type.includes('mist') || type.includes('haze')) {
    return 'Fog';
  }
  if (type.includes('wind') || type.includes('gust')) {
    return 'Wind';
  }
  if (type.includes('clear') || type.includes('sun')) {
    return 'Clear';
  }
  return 'Mild';
}

// Resolve weather color key used by the inset weather token.
function resolveInsetWeatherColorKey(weatherType) {
  const type = String(weatherType || 'clear').toLowerCase();
  if (type.includes('rain') || type.includes('shower') || type.includes('drizzle')) {
    return 'weather_rain';
  }
  if (type.includes('storm') || type.includes('thunder')) {
    return 'weather_storm';
  }
  if (type.includes('drought') || type.includes('heat') || type.includes('hot')) {
    return 'weather_drought';
  }
  if (type.includes('cold') || type.includes('snow') || type.includes('frost') || type.includes('blizzard')) {
    return 'weather_cold';
  }
  return 'weather_clear';
}

// Build runtime line with tick/year/cycle and weather token.
function buildInsetRuntimeMetricLine(meta, width, compact = false) {
  const weatherToken = `Wx:${meta.weatherToken}`;
  const options = compact
    ? [
      `T:${meta.tick} Y:${meta.year} C:${meta.cycleCount} ${weatherToken}`,
      `T${meta.tick} Y${meta.year} C${meta.cycleCount} ${weatherToken}`,
      `T:${meta.tick} Y:${meta.year} ${weatherToken}`,
      `T${meta.tick} ${weatherToken}`,
      weatherToken,
    ]
    : [
      `T:${meta.tick}  Y:${meta.year}  Cy:${meta.cycleCount}  ${weatherToken}`,
      `Tick:${meta.tick} Year:${meta.year} C:${meta.cycleCount} ${weatherToken}`,
      `T${meta.tick} Y${meta.year} C${meta.cycleCount} ${weatherToken}`,
      `T:${meta.tick} Y:${meta.year} ${weatherToken}`,
      `T${meta.tick} ${weatherToken}`,
      weatherToken,
    ];
  const text = pickFittingInsetText(options, width);
  const start = text.indexOf(weatherToken);
  if (start < 0) {
    return buildInsetTextLine(text, width);
  }
  return buildInsetTextLine(text, width, [
    {
      start,
      end: start + weatherToken.length,
      colorKey: meta.weatherColorKey || 'weather_clear',
    },
  ]);
}

// Compute alert severity for inset emphasis using stockpile/morale/pressure signals.
function resolveInsetAlertState(state, config, moraleRatio, themeState) {
  const alerts = themeState && themeState.alerts ? themeState.alerts : DEFAULT_ALERTS;
  const shortageScore = Math.max(
    0,
    Number(
      state
      && Array.isArray(state.lastPriorities)
      && state.lastPriorities[0]
        ? state.lastPriorities[0].score
        : 0,
    ),
  );
  const stockpileRatio = resolveTrackedStockpileRatio(state, config, alerts.tracked_resources);
  const raidActive = Boolean(state && state.raid && state.raid.active);
  const deepRaidActive = hasActiveDeepRaid(state);
  const shortageCritical = shortageScore >= alerts.shortage_critical_score;
  const shortageWarning = shortageScore >= alerts.shortage_warning_score;
  const stockpileCritical = stockpileRatio <= alerts.stockpile_critical_ratio;
  const stockpileWarning = stockpileRatio <= alerts.stockpile_warning_ratio;
  const moraleCritical = moraleRatio <= alerts.morale_critical;
  const moraleWarning = moraleRatio <= alerts.morale_warning;

  let level = 'stable';
  if (
    raidActive
    || deepRaidActive
    || shortageCritical
    || stockpileCritical
    || moraleCritical
  ) {
    level = 'critical';
  } else if (
    shortageWarning
    || stockpileWarning
    || moraleWarning
  ) {
    level = 'warning';
  }

  return {
    level,
    colorKey: getAlertColorKey(level),
    shortageScore,
    stockpileRatio,
    moraleRatio,
    raidActive,
    deepRaidActive,
    shortageCritical,
    shortageWarning,
    stockpileCritical,
    stockpileWarning,
    moraleCritical,
    moraleWarning,
  };
}

// Resolve one compact alert reason label for the inset status line.
function resolveInsetAlertReason(alertState) {
  if (!alertState || alertState.level === 'stable') {
    return 'stable';
  }
  const reasons = [];
  if (alertState.deepRaidActive) {
    reasons.push('deepRaid');
  }
  if (alertState.raidActive) {
    reasons.push('raid');
  }
  if (alertState.shortageCritical || alertState.shortageWarning) {
    reasons.push('shortage');
  }
  if (alertState.stockpileCritical || alertState.stockpileWarning) {
    reasons.push('stockpile');
  }
  if (alertState.moraleCritical || alertState.moraleWarning) {
    reasons.push('morale');
  }
  if (reasons.length === 0) {
    return 'unknown';
  }
  return reasons.length === 1 ? reasons[0] : 'mixed';
}

// Build the population metric line with morale severity highlighting.
function buildPopulationMetricLine(population, moralePct, alertState, width) {
  const text = pickFittingInsetText(
    [
      `Pop:${population.total}  C:${population.children} A:${population.adults} E:${population.elders}  Mor:${moralePct}`,
      `Pop:${population.total} C:${population.children} A:${population.adults} E:${population.elders} M:${moralePct}`,
      `P:${population.total} C:${population.children} A:${population.adults} E:${population.elders} M:${moralePct}`,
      `P:${population.total} C${population.children} A${population.adults} E${population.elders}`,
    ],
    width,
  );
  const moraleCritical = Boolean(alertState && alertState.moraleCritical);
  const moraleWarning = Boolean(alertState && alertState.moraleWarning);
  if (!moraleCritical && !moraleWarning) {
    return buildInsetTextLine(text, width);
  }
  const moraleTokens = [`Mor:${moralePct}`, `M:${moralePct}`];
  let moraleIndex = -1;
  let moraleLength = 0;
  for (const token of moraleTokens) {
    moraleIndex = text.indexOf(token);
    if (moraleIndex >= 0) {
      moraleLength = token.length;
      break;
    }
  }
  if (moraleIndex < 0) {
    return buildInsetTextLine(text, width);
  }
  return buildInsetTextLine(text, width, [
    {
      start: moraleIndex,
      end: moraleIndex + moraleLength,
      colorKey: moraleCritical ? 'alert_critical' : 'alert_warning',
    },
  ]);
}

// Resolve one combat floor snapshot for map inset combat tokens.
function getInsetUnderrealmCombatFloor(underrealm, depth) {
  const combat = underrealm && underrealm.combat;
  const floors = combat && combat.floorsByDepth && typeof combat.floorsByDepth === 'object'
    ? combat.floorsByDepth
    : null;
  if (!floors) {
    return null;
  }
  const safeDepth = Math.max(1, Math.floor(Number(depth || 1)));
  return floors[String(safeDepth)] || floors[safeDepth] || null;
}

// Resolve compact Underrealm progression/combat/readiness tokens for inset rendering.
function resolveInsetUnderrealmCombatTokens(state) {
  const underrealm = state && state.underrealm ? state.underrealm : null;
  if (!underrealm || underrealm.enabled === false) {
    return {
      progression: 'P:Off',
      champion: 'C:Off',
      readiness: 'R:Off',
    };
  }

  const maxDepth = Math.max(0, Math.floor(Number(underrealm.maxDepth || 0)));
  const maxUnlockedDepth = Math.max(0, Math.floor(Number(underrealm.maxUnlockedDepth || 0)));
  const frontierDepth = Math.min(maxDepth, maxUnlockedDepth);
  const lift = underrealm.lift && typeof underrealm.lift === 'object'
    ? underrealm.lift
    : null;

  let progression = 'P:-';
  if (frontierDepth <= 0) {
    progression = 'P:Gate';
  } else if (maxDepth > 0 && frontierDepth >= maxDepth) {
    progression = 'P:Max';
  } else if (lift && lift.active === true) {
    const totalTicks = Math.max(1, Number(lift.totalTicks || 1));
    const remainingTicks = Math.max(0, Number(lift.ticksRemaining || 0));
    const pct = Math.max(0, Math.min(100, Math.round((1 - remainingTicks / totalTicks) * 100)));
    progression = `P:Lft${pct}%`;
  } else {
    progression = `P:N${frontierDepth + 1}`;
  }

  const combat = underrealm.combat && typeof underrealm.combat === 'object'
    ? underrealm.combat
    : null;
  let champion = 'C:Off';
  if (combat && combat.enabled !== false && frontierDepth > 0) {
    const floor = getInsetUnderrealmCombatFloor(underrealm, frontierDepth);
    if (!floor) {
      champion = `C:D${frontierDepth}?`;
    } else {
      const championRequired = Boolean(
        floor.unlock
        && floor.unlock.required === true
        && floor.champion
        && floor.champion.enabled !== false,
      );
      const cleared = Boolean(
        floor.unlock
        && floor.unlock.cleared === true,
      );
      if (!championRequired) {
        champion = `C:D${frontierDepth}Byp`;
      } else if (cleared) {
        champion = `C:D${frontierDepth}Clr`;
      } else {
        const stateCode = String(floor.state || 'accessible')
          .replace('accessible', 'Acc')
          .replace('contested', 'Cnt')
          .replace('locked', 'Lck')
          .replace('cleared', 'Clr');
        const cooldown = Math.max(
          0,
          Math.floor(Number(floor.encounter && floor.encounter.cooldownTicksRemaining || 0)),
        );
        champion = cooldown > 0
          ? `C:D${frontierDepth}${stateCode}${cooldown}t`
          : `C:D${frontierDepth}${stateCode}`;
        if (progression.startsWith('P:N')) {
          progression = 'P:CGate';
        }
      }
    }
  }

  let readiness = 'R:-';
  const gate = state
    && state.ruins
    && state.ruins.readinessGate
    && typeof state.ruins.readinessGate === 'object'
    ? state.ruins.readinessGate
    : null;
  if (gate && Number(gate.depth || 0) > 0) {
    const depth = Math.max(1, Math.floor(Number(gate.depth || 1)));
    const status = String(gate.status || 'unknown');
    if (status === 'blocked' && gate.reason === 'champion_cooldown') {
      const cooldown = Math.max(0, Math.floor(Number(gate.championCooldownTicks || 0)));
      readiness = `R:D${depth}Cd${cooldown}`;
    } else if (status === 'blocked') {
      readiness = `R:D${depth}Blk`;
    } else if (status === 'warning') {
      readiness = `R:D${depth}Wrn`;
    } else {
      readiness = `R:D${depth}Rdy`;
    }
  } else if (frontierDepth > 0) {
    readiness = `R:D${frontierDepth}Set`;
  }

  return {
    progression,
    champion,
    readiness,
  };
}

// Build a colored alert-summary line for the inset.
function buildAlertMetricLine(alertState, width) {
  const stockpilePct = Math.max(0, Math.round(Number(alertState.stockpileRatio || 0) * 100));
  const moralePct = Math.max(0, Math.round(Number(alertState.moraleRatio || 0) * 100));
  const reasonLabel = resolveInsetAlertReason(alertState);
  const showReason = alertState.level !== 'stable';
  const statusLabel = alertState.level === 'critical'
    ? 'CRITICAL'
    : alertState.level === 'warning'
      ? 'Warning'
      : 'Stable';
  const text = showReason
    ? pickFittingInsetText(
      [
        `Alert: ${statusLabel} (${reasonLabel})  Stock:${stockpilePct}% Mor:${moralePct}%`,
        `Alert: ${statusLabel} ${reasonLabel}  S:${stockpilePct}% M:${moralePct}%`,
        `Alert:${statusLabel} ${reasonLabel} S:${stockpilePct}% M:${moralePct}%`,
        `${statusLabel}/${reasonLabel} S:${stockpilePct}% M:${moralePct}%`,
      ],
      width,
    )
    : pickFittingInsetText(
      [
        `Alert: ${statusLabel}  Stock:${stockpilePct}% Mor:${moralePct}%`,
        `Alert: ${statusLabel}  S:${stockpilePct}% M:${moralePct}%`,
        `Alert:${statusLabel} S:${stockpilePct}% M:${moralePct}%`,
        `${statusLabel} S:${stockpilePct}% M:${moralePct}%`,
      ],
      width,
    );
  const spans = [];
  const statusStart = text.indexOf(statusLabel);
  if (statusStart >= 0) {
    spans.push({
      start: statusStart,
      end: statusStart + statusLabel.length,
      colorKey: alertState.colorKey,
    });
  }
  const reasonStart = text.indexOf(reasonLabel);
  if (showReason && reasonStart >= 0) {
    spans.push({
      start: reasonStart,
      end: reasonStart + reasonLabel.length,
      colorKey: alertState.colorKey,
    });
  }

  const stockTokens = [`Stock:${stockpilePct}%`, `S:${stockpilePct}%`];
  for (const token of stockTokens) {
    const start = text.indexOf(token);
    if (start >= 0 && (alertState.stockpileCritical || alertState.stockpileWarning)) {
      spans.push({
        start,
        end: start + token.length,
        colorKey: alertState.stockpileCritical ? 'alert_critical' : 'alert_warning',
      });
      break;
    }
  }

  const moraleTokens = [`Mor:${moralePct}%`, `M:${moralePct}%`];
  for (const token of moraleTokens) {
    const start = text.indexOf(token);
    if (start >= 0 && (alertState.moraleCritical || alertState.moraleWarning)) {
      spans.push({
        start,
        end: start + token.length,
        colorKey: alertState.moraleCritical ? 'alert_critical' : 'alert_warning',
      });
      break;
    }
  }

  return buildInsetTextLine(text, width, spans);
}

// Build regular inset metrics for day-to-day map operation.
function buildInsetDefaultMetricLines(meta, alertState, width) {
  const metrics = [];
  metrics.push(buildInsetRuntimeMetricLine(meta, width, false));
  metrics.push(buildPopulationMetricLine(meta.population, meta.moralePct, alertState, width));
  metrics.push(buildInsetSegmentLine(
    [
      {
        text: pickFittingInsetText(
          [
            `Underrealm unlocked: ${meta.unlockToken}`,
            `Underrealm: ${meta.unlockToken}`,
            `U:${meta.unlockToken}`,
          ],
          width,
        ),
        colorKey: alertState.deepRaidActive ? 'alert_critical' : null,
      },
    ],
    width,
  ));
  metrics.push(buildInsetTextLine(pickFittingInsetText(
    [
      `View ${meta.viewLabel} ${meta.depthToken}`,
      `View: ${meta.viewLabel} ${meta.depthToken}`,
      `${meta.viewLabel} ${meta.depthToken}`,
      `V:${meta.depthToken}`,
    ],
    width,
  ), width));
  metrics.push(buildInsetTextLine(pickFittingInsetText(
    [
      `Deep: ${meta.combatTokens.progression} ${meta.combatTokens.champion} ${meta.combatTokens.readiness}`,
      `Deep ${meta.combatTokens.progression} ${meta.combatTokens.champion} ${meta.combatTokens.readiness}`,
      `${meta.combatTokens.progression} ${meta.combatTokens.champion} ${meta.combatTokens.readiness}`,
      `${meta.combatTokens.champion} ${meta.combatTokens.readiness}`,
    ],
    width,
  ), width));
  metrics.push(buildAlertMetricLine(alertState, width));
  return metrics;
}

// Build compact critical-focus metrics for cinematic high-pressure moments.
function buildInsetFocusMetricLines(meta, alertState, width) {
  const metrics = [];
  metrics.push(buildInsetRuntimeMetricLine(meta, width, true));
  metrics.push(buildAlertMetricLine(alertState, width));
  metrics.push(buildPopulationMetricLine(meta.population, meta.moralePct, alertState, width));
  metrics.push(buildInsetTextLine(pickFittingInsetText(
    [
      `View ${meta.depthToken}  Unlock ${meta.unlockToken}`,
      `V:${meta.depthToken} U:${meta.unlockToken}`,
      `${meta.depthToken} ${meta.unlockToken}`,
    ],
    width,
  ), width));
  return metrics;
}

// Build concise map-inset lines with high-signal runtime data.
function buildMapInsetLines(state, config, width, height, themeState) {
  const safeHeight = Math.max(0, Math.floor(Number(height || 0)));
  if (safeHeight <= 0) {
    return {
      lines: [],
      alertState: resolveInsetAlertState(state, config, 1, themeState),
    };
  }
  const tick = Math.max(0, Number(state && state.tick || 0));
  const seasonOrder = Array.isArray(config && config.seasons && config.seasons.order)
    && config.seasons.order.length > 0
    ? config.seasons.order
    : ['spring', 'summer', 'autumn', 'winter'];
  const seasonGlobal = Math.max(0, Number(state && state.season ? state.season.globalIndex : 0));
  const year = Math.floor(seasonGlobal / Math.max(1, seasonOrder.length)) + 1;
  const cycleStats = state && state.cycleStats ? state.cycleStats : {};
  const cycleCount = Math.max(0, Number(cycleStats.count || 0));
  const weatherType = resolveInsetWeatherType(state, config);
  const weatherToken = resolveInsetWeatherToken(weatherType);
  const weatherColorKey = resolveInsetWeatherColorKey(weatherType);

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
  const moraleRatio = clampUnit(averageDwarfMetric(dwarves, 'morale'), 0);
  const moralePct = Math.max(0, Math.round(moraleRatio * 100));

  const underrealm = state && state.underrealm ? state.underrealm : null;
  const underrealmEnabled = Boolean(underrealm && underrealm.enabled !== false);
  const activeDepth = Math.max(0, Number(underrealm && underrealm.activeDepth || 0));
  const maxUnlockedDepth = Math.max(0, Number(underrealm && underrealm.maxUnlockedDepth || 0));
  const maxDepth = Math.max(0, Number(underrealm && underrealm.maxDepth || 0));
  const viewLabel = activeDepth > 0 ? 'Underrealm' : 'Surface';
  const depthToken = underrealmEnabled ? `D${activeDepth}` : 'D0';
  const unlockToken = underrealmEnabled ? `D${maxUnlockedDepth}/${maxDepth}` : 'Off';

  const alertState = resolveInsetAlertState(state, config, moraleRatio, themeState);
  const meta = {
    tick,
    year,
    cycleCount,
    weatherToken,
    weatherColorKey,
    population: {
      total: Math.max(0, dwarves.length),
      adults,
      children,
      elders,
    },
    moralePct,
    viewLabel,
    depthToken,
    unlockToken,
    combatTokens: resolveInsetUnderrealmCombatTokens(state),
  };

  const focus = themeState && themeState.focus ? themeState.focus : DEFAULT_FOCUS;
  const focusCritical = focus.enabled
    && focus.compact_inset_on_critical
    && alertState.level === 'critical';
  const metrics = focusCritical
    ? buildInsetFocusMetricLines(meta, alertState, width)
    : buildInsetDefaultMetricLines(meta, alertState, width);

  const commandColorKey = alertState.level === 'critical'
    ? 'alert_critical'
    : alertState.level === 'warning'
      ? 'alert_warning'
      : 'hud_header';
  const commandLine = buildInsetSegmentLine(
    [
      {
        text: pickFittingInsetText(
          [
            '[␠]⏯ [h]▦ [w]⚔ [i]◎ [l]≡ [e]✎ [⇆] [⇅] [m]⤓ [M]⤓+',
            '␠⏯ h▦ w⚔ i◎ l≡ e✎ ⇆ ⇅ m⤓ M⤓+',
            'h w i l e ⇆ ⇅ m M+ ␠',
            'h w i l e LR UD m M+ Sp',
          ],
          width,
        ),
        colorKey: commandColorKey,
      },
    ],
    width,
  );
  const metricBudget = Math.max(0, safeHeight - 1);
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
  return {
    lines: out,
    alertState,
  };
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
  const innerWidth = Math.max(0, width - 2);
  const innerHeight = Math.max(0, height - 2);
  const themeState = resolveInsetThemeState(colors);
  const insetData = buildMapInsetLines(state, config, innerWidth, innerHeight, themeState);
  const alertState = insetData && insetData.alertState
    ? insetData.alertState
    : { level: 'stable', colorKey: 'hud_header' };
  const focusState = themeState && themeState.focus ? themeState.focus : DEFAULT_FOCUS;
  const focusAlertFrame = focusState.enabled
    && focusState.emphasize_inset_frame
    && alertState.level !== 'stable';
  const frameColorKey = focusAlertFrame ? alertState.colorKey : 'frame';
  const titleColorKey = focusAlertFrame ? alertState.colorKey : 'hud_header';

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      setGridCell(grid, x, y, ' ', null, colors);
    }
  }

  setGridCell(grid, minX, minY, symbols.topLeft, frameColorKey, colors);
  setGridCell(grid, maxX, minY, symbols.topRight, frameColorKey, colors);
  setGridCell(grid, minX, maxY, symbols.bottomLeft, frameColorKey, colors);
  setGridCell(grid, maxX, maxY, symbols.bottomRight, frameColorKey, colors);
  for (let x = minX + 1; x < maxX; x += 1) {
    setGridCell(grid, x, minY, symbols.horizontal, frameColorKey, colors);
    setGridCell(grid, x, maxY, symbols.horizontal, frameColorKey, colors);
  }
  for (let y = minY + 1; y < maxY; y += 1) {
    setGridCell(grid, minX, y, symbols.vertical, frameColorKey, colors);
    setGridCell(grid, maxX, y, symbols.vertical, frameColorKey, colors);
  }

  const title = fitLine(String(inset.title || 'ᚦ NodeDwarves ᛞ'), Math.max(0, width - 4));
  const titleStart = Math.max(minX + 1, minX + Math.floor((width - title.length) / 2));
  for (let i = 0; i < title.length; i += 1) {
    const x = titleStart + i;
    if (x >= maxX) {
      break;
    }
    setGridCell(grid, x, minY, title[i], titleColorKey, colors);
  }

  const lines = Array.isArray(insetData && insetData.lines) ? insetData.lines : [];
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
