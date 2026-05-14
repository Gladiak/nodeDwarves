'use strict';

const { padRight, clamp } = require('../utils');
const { fitLine, wrapLine } = require('./format');
const { applyColor } = require('./colors');
const { getClanLabel, getClanEffects } = require('../clans');
const { buildDwarfLore, capitalize, describeMorale, resolveRoleLabel } = require('../dwarf_lore');
const { ensureDwarfSocialState } = require('../simulation/social_drama');

const SECTION_RUNES = {
  PROFILE: 'ᚦ',
  STATUS: 'ᚨ',
  STATS: 'ᚱ',
  CLAN: 'ᚲ',
  CHARACTER: 'ᛉ',
  SOCIAL: 'ᛖ',
  LEGACY: 'ᛞ',
};

// Build an inspect panel descriptor when enabled.
function buildInspectPanel(state, config, runtime) {
  const uiConfig = (config.display && config.display.inspect_panel) || {};
  if (uiConfig.enabled === false) {
    return null;
  }
  const inspectState = state && state.ui ? state.ui.inspect : null;
  if (!inspectState || !inspectState.open) {
    return null;
  }

  const gridWidth = Math.max(0, Number(runtime.gridWidth || 0));
  const gridHeight = Math.max(0, Number(runtime.gridHeight || 0));
  if (gridWidth <= 0 || gridHeight <= 0) {
    return null;
  }

  const targetWidth = Number(uiConfig.width || 50);
  const targetHeight = Number(uiConfig.height || 12);
  const width = clamp(Math.floor(targetWidth), 26, gridWidth);
  const height = clamp(Math.floor(targetHeight), 10, gridHeight);
  const innerWidth = Math.max(1, width - 6);
  const contentWidth = Math.max(1, innerWidth - 1);
  const innerHeight = Math.max(1, height - 2);

  const dwarves = Array.isArray(state.dwarves) ? state.dwarves : [];
  const ids = Array.isArray(inspectState.ids) ? inspectState.ids : [];
  const total = ids.length;
  const index = total > 0 ? clamp(Number(inspectState.index || 0), 0, total - 1) : 0;
  const id = total > 0 ? ids[index] : null;
  const dwarf = id ? dwarves.find((entry) => entry.id === id) : null;

  const lines = buildInspectLines(dwarf, index, total, state, config, contentWidth, innerHeight);
  const panelLines = buildPanelBox(lines, innerWidth, contentWidth);

  const x = Math.max(0, Math.floor((gridWidth - width) / 2));
  const y = Math.max(0, Math.floor((gridHeight - height) / 2));

  return {
    lines: panelLines,
    x,
    y,
    width,
    height,
  };
}

// Build inner lines for the inspect panel.
function buildInspectLines(dwarf, index, total, state, config, width, height) {
  const controlsLine = '[<-] Prev  [->] Next  [i] Close';
  const maxContent = Math.max(0, height - 1);
  const content = [];

  if (!dwarf) {
    pushLine(content, 'No dwarves available.', width);
  } else {
    const lore = buildDwarfLore(dwarf, state, config);
    const displayName = `${lore.name} <${dwarf.id}>`;
    const morale = capitalize(describeMorale(dwarf.state ? dwarf.state.morale : 0));
    const role = capitalize(resolveRoleLabel(dwarf));
    const age = Number(dwarf.ageTicks || 0);
    const stage = capitalize(dwarf.lifeStage ? String(dwarf.lifeStage) : 'unknown');
    const clanId = dwarf.clanId ? String(dwarf.clanId) : '';
    const clanLabel = clanId ? getClanLabel(config, clanId) : 'Unbound';
    const clanEffects = formatClanEffects(config, clanId) || 'None';
    const fatigue = clampUnit(dwarf.state ? dwarf.state.fatigue : 0);
    const stress = clampUnit(dwarf.state ? dwarf.state.stress : 0);
    const moraleValue = clampUnit(dwarf.state ? dwarf.state.morale : 0);
    const strength = clampUnit(lore.baseStrength + (1 - fatigue) * 0.15 - stress * 0.1);
    const dexterity = clampUnit(lore.baseDexterity + (1 - stress) * 0.15 - fatigue * 0.1);

    pushCartiglio(content, lore, index, total, width);
    content.push({ text: '', colorKey: null, separator: true });
    pushRuneBanner(content, lore.runes, width);

    pushSection(content, 'PROFILE', width, [
      `Name: ${displayName}`,
      `House: ${capitalize(lore.house)}`,
      formatTwoColumn(`Title: ${capitalize(lore.title)}`, `Rank: ${capitalize(lore.rank)}`, width),
      `Archetype: ${capitalize(lore.archetype)}`,
    ]);

    const statusLines = [
      formatTwoColumn(`Role: ${role}`, `Mood: ${morale}`, width),
      formatTwoColumn(`Age: ${age}`, `Stage: ${stage}`, width),
    ];
    const statLines = [
      formatStatLine('Strength', strength, 14, width),
      formatStatLine('Dexterity', dexterity, 14, width),
      formatStatLine('Morale', moraleValue, 14, width),
    ];
    pushDualSection(content, 'STATS', statLines, 'STATUS', statusLines, width);

    pushSectionWrappedFixed(content, 'CLAN', width, [
      clanId ? `Clan: ${clanLabel} (${clanId})` : `Clan: ${clanLabel}`,
      `Legacy: ${clanEffects}`,
    ], 2);

    const traits = lore.traits.map((trait) => capitalize(trait));
    pushSection(content, 'CHARACTER', width, [
      `Traits: ${traits.join(', ')}`,
      formatTwoColumn(`Virtue: ${capitalize(lore.virtue)}`, `Flaw: ${capitalize(lore.flaw)}`, width),
      `Totem: ${capitalize(lore.totem)}`,
      `Taboo: ${capitalize(lore.taboo)}`,
      `Mark: ${capitalize(lore.mark)}`,
    ]);
    pushSection(content, 'SOCIAL', width, buildSocialSectionLines(dwarf, state, config));

    const legacyLines = [];
    if (lore.oath) {
      legacyLines.push(`Oath: ${capitalize(lore.oath)}`);
    }
    if (lore.vow) {
      legacyLines.push(`Vow: ${capitalize(lore.vow)}`);
    }
    if (lore.motto) {
      legacyLines.push(`Motto: ${capitalize(lore.motto)}`);
    }
    if (lore.blazon) {
      legacyLines.push(`Blazon: ${capitalize(lore.blazon)}`);
    }
    if (lore.saga && lore.saga.length > 0) {
      legacyLines.push(`Saga: ${capitalize(lore.saga[0])}`);
      if (lore.saga[1]) {
        legacyLines.push(`Saga: ${capitalize(lore.saga[1])}`);
      }
    }
    pushSectionWrapped(content, 'LEGACY', width, legacyLines, 2);

    if (content.length > 0) {
      content.push({ text: '', colorKey: null });
    }
    pushRuneBanner(content, lore.runes, width);
  }

  const trimmed = content.slice(0, maxContent);
  while (trimmed.length < maxContent) {
    trimmed.push({ text: '', colorKey: null });
  }
  trimmed.push({ text: fitLine(controlsLine, width), colorKey: null });
  return trimmed.map((entry) => ({
    text: fitLine(entry.text, width),
    colorKey: entry.colorKey || null,
  }));
}

// Build inspect rows for the current dwarf's strongest social ties.
function buildSocialSectionLines(dwarf, state, config) {
  const social = ensureDwarfSocialState(dwarf, state);
  const summary = social.summary || {};
  return [
    formatSocialLinkLine('Friend', summary.friendId, summary.friendScore, state, config),
    formatSocialLinkLine('Rival', summary.rivalId, summary.rivalScore, state, config),
    formatSocialLinkLine('Grudge', summary.grudgeId, summary.grudgeScore, state, config),
    formatSocialLinkLine('Mentor', summary.mentorId, summary.mentorScore, state, config),
    formatSocialLinkLine('Protege', summary.protegeId, summary.protegeScore, state, config),
    `Incidents seen: ${Math.max(0, Number(social.incidentCount || 0))}`,
  ];
}

// Format one social tie line with dwarf name, id, and current score.
function formatSocialLinkLine(label, targetId, score, state, config) {
  const id = targetId ? String(targetId) : '';
  if (!id) {
    return `${label}: -`;
  }
  const dwarves = Array.isArray(state && state.dwarves) ? state.dwarves : [];
  const target = dwarves.find((entry) => entry && entry.id === id) || null;
  const lore = target ? buildDwarfLore(target, state, config) : null;
  const name = lore && lore.name ? String(lore.name) : id;
  return `${label}: ${name} <${id}> (${Number(score || 0).toFixed(1)})`;
}

// Push a single line into the buffer.
function pushLine(lines, value, width, colorKey = null) {
  const text = fitLine(value, width);
  lines.push({ text, colorKey });
}

// Push a section with a colored header and blank-line separation.
function pushSection(lines, title, width, entries) {
  if (lines.length > 0) {
    const last = lines[lines.length - 1];
    if (last && last.rune) {
      lines.push({ text: '', colorKey: null });
    } else {
      lines.push({ text: '', colorKey: null, separator: true });
    }
  }
  const rune = SECTION_RUNES[title] ? `${SECTION_RUNES[title]} ` : '';
  pushLine(lines, `${rune}${String(title || '')}`, width, 'hud_header');
  for (const entry of entries || []) {
    if (!entry) {
      continue;
    }
    pushLine(lines, entry, width);
  }
}

// Push a section that wraps entries to a maximum number of lines.
function pushSectionWrapped(lines, title, width, entries, maxLines) {
  if (lines.length > 0) {
    const last = lines[lines.length - 1];
    if (last && last.rune) {
      lines.push({ text: '', colorKey: null });
    } else {
      lines.push({ text: '', colorKey: null, separator: true });
    }
  }
  const rune = SECTION_RUNES[title] ? `${SECTION_RUNES[title]} ` : '';
  pushLine(lines, `${rune}${String(title || '')}`, width, 'hud_header');
  for (const entry of entries || []) {
    if (!entry) {
      continue;
    }
    const wrapped = wrapLine(entry, width);
    const limit = Math.max(1, Number(maxLines || 1));
    for (let i = 0; i < wrapped.length && i < limit; i += 1) {
      pushLine(lines, wrapped[i], width);
    }
  }
}

// Push a wrapped section while reserving space for max lines even if empty.
function pushSectionWrappedFixed(lines, title, width, entries, maxLines) {
  if (lines.length > 0) {
    const last = lines[lines.length - 1];
    if (last && last.rune) {
      lines.push({ text: '', colorKey: null });
    } else {
      lines.push({ text: '', colorKey: null, separator: true });
    }
  }
  const rune = SECTION_RUNES[title] ? `${SECTION_RUNES[title]} ` : '';
  pushLine(lines, `${rune}${String(title || '')}`, width, 'hud_header');
  const limit = Math.max(1, Number(maxLines || 1));
  for (const entry of entries || []) {
    const wrapped = entry ? wrapLine(entry, width) : [''];
    const length = Math.max(wrapped.length, limit);
    for (let i = 0; i < length; i += 1) {
      const value = wrapped[i] || '';
      pushLine(lines, value, width);
    }
  }
}

// Push two sections side by side in two columns.
function pushDualSection(lines, leftTitle, leftEntries, rightTitle, rightEntries, width) {
  if (lines.length > 0) {
    lines.push({ text: '', colorKey: null, separator: true });
  }
  const gap = 2;
  const usable = Math.max(0, width - gap);
  const colWidth = Math.max(1, Math.floor(usable / 2));
  const leftRune = SECTION_RUNES[leftTitle] ? `${SECTION_RUNES[leftTitle]} ` : '';
  const rightRune = SECTION_RUNES[rightTitle] ? `${SECTION_RUNES[rightTitle]} ` : '';
  const headerLeft = padRight(fitLine(`${leftRune}${leftTitle}`, colWidth), colWidth);
  const headerRight = padRight(fitLine(`${rightRune}${rightTitle}`, colWidth), colWidth);
  pushLine(lines, `${headerLeft}${' '.repeat(gap)}${headerRight}`.trimEnd(), width, 'hud_header');

  const left = Array.isArray(leftEntries) ? leftEntries : [];
  const right = Array.isArray(rightEntries) ? rightEntries : [];
  const rows = Math.max(left.length, right.length);
  for (let i = 0; i < rows; i += 1) {
    const leftValue = left[i] || '';
    const rightValue = right[i] || '';
    pushLine(lines, formatTwoColumn(leftValue, rightValue, width), width);
  }
}

// Push the cartiglio title line.
function pushCartiglio(lines, lore, index, total, width) {
  const ordinal = formatOrdinal(index + 1);
  const totalWord = formatCardinal(Math.max(1, total));
  const countText = `${ordinal} of ${totalWord}`.toUpperCase();
  const name = String(lore.name || '').toUpperCase();
  const epithet = String(lore.epithet || '').toUpperCase();

  let text = `[ ${name} · ${epithet} ] (${countText})`;
  if (text.length > width) {
    text = `[ ${name} ] (${countText})`;
  }
  if (text.length > width) {
    text = `${name} (${countText})`;
  }
  if (text.length > width) {
    text = countText;
  }

  const centered = centerLine(text, width);
  pushLine(lines, centered, width, 'hud_header');
}

// Push a centered rune banner.
function pushRuneBanner(lines, value, width) {
  if (!value) {
    return;
  }
  const text = fitLine(centerLine(String(value), width), width);
  lines.push({ text, colorKey: 'hud_header', rune: true });
}

// Format a two-column row to save space.
function formatTwoColumn(left, right, width) {
  const gap = 2;
  const usable = Math.max(0, width - gap);
  const colWidth = Math.max(1, Math.floor(usable / 2));
  const leftText = padRight(fitLine(left, colWidth), colWidth);
  const rightText = padRight(fitLine(right, colWidth), colWidth);
  return `${leftText}${' '.repeat(gap)}${rightText}`.trimEnd();
}

// Center a line within the given width.
function centerLine(value, width) {
  const text = String(value || '');
  if (!text) {
    return '';
  }
  if (text.length >= width) {
    return fitLine(text, width);
  }
  const padding = Math.max(0, Math.floor((width - text.length) / 2));
  return `${' '.repeat(padding)}${text}`;
}

// Format an ordinal number for display.
function formatOrdinal(value) {
  const ordinals = [
    '', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth',
    'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth', 'Seventeenth', 'Eighteenth',
    'Nineteenth', 'Twentieth',
  ];
  const num = Math.max(0, Number(value || 0));
  if (num < ordinals.length) {
    return ordinals[num] || String(num);
  }
  const mod100 = num % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${num}th`;
  }
  const mod10 = num % 10;
  if (mod10 === 1) {
    return `${num}st`;
  }
  if (mod10 === 2) {
    return `${num}nd`;
  }
  if (mod10 === 3) {
    return `${num}rd`;
  }
  return `${num}th`;
}

// Format a cardinal number for display.
function formatCardinal(value) {
  const cardinals = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen',
    'Nineteen', 'Twenty',
  ];
  const num = Math.max(0, Number(value || 0));
  if (num < cardinals.length) {
    return cardinals[num] || String(num);
  }
  return String(num);
}

// Clamp a number to 0..1.
function clampUnit(value) {
  return Math.min(1, Math.max(0, Number(value || 0)));
}

// Build a stat bar line with a numeric suffix.
function formatStatLine(label, value, length, width) {
  const total = Math.max(4, Number(length || 10));
  const filled = Math.round(clampUnit(value) * total);
  const bar = `${'█'.repeat(filled)}${'░'.repeat(total - filled)}`;
  const labelText = padRight(String(label || ''), 12);
  const suffix = `${filled}/${total}`;
  const base = `${labelText}: ${bar}`.trimEnd();
  if (base.length + 1 + suffix.length <= width) {
    return `${base} ${suffix}`;
  }
  return fitLine(base, width);
}

// Build a compact summary for clan effects.
function formatClanEffects(config, clanId) {
  if (!clanId) {
    return '';
  }
  const effects = getClanEffects(config, clanId);
  if (!effects || typeof effects !== 'object') {
    return '';
  }
  const parts = [];
  const pct = (value) => `${Math.round(Number(value || 0) * 100)}%`;
  if (effects.mine_output_bonus) {
    parts.push(`Mine +${pct(effects.mine_output_bonus)}`);
  }
  if (effects.mine_output_penalty) {
    parts.push(`Mine -${pct(effects.mine_output_penalty)}`);
  }
  if (effects.mine_rare_chance_bonus) {
    parts.push(`Rare +${pct(effects.mine_rare_chance_bonus)}`);
  }
  if (effects.build_ticks_bonus) {
    parts.push(`Build speed +${pct(effects.build_ticks_bonus)}`);
  }
  if (effects.build_cost_penalty) {
    parts.push(`Build cost +${pct(effects.build_cost_penalty)}`);
  }
  if (effects.gather_ticks_penalty) {
    parts.push(`Gather speed -${pct(effects.gather_ticks_penalty)}`);
  }
  if (effects.gather_yield_penalty) {
    const resources = Array.isArray(effects.gather_penalty_resources) && effects.gather_penalty_resources.length > 0
      ? ` (${effects.gather_penalty_resources.join(', ')})`
      : '';
    parts.push(`Gather yield -${pct(effects.gather_yield_penalty)}${resources}`);
  }
  if (effects.sawmill_output_penalty) {
    parts.push(`Sawmill -${pct(effects.sawmill_output_penalty)}`);
  }
  if (effects.raid_defense_bonus) {
    parts.push(`Raid defense +${pct(effects.raid_defense_bonus)}`);
  }
  if (effects.raid_max_kills_bonus) {
    parts.push(`Raid max +${pct(effects.raid_max_kills_bonus)}`);
  }
  if (effects.ruins_combat_bonus) {
    parts.push(`Ruins combat +${pct(effects.ruins_combat_bonus)}`);
  }
  if (effects.ruins_hazard_reduction) {
    parts.push(`Ruins hazard -${pct(effects.ruins_hazard_reduction)}`);
  }
  if (effects.storm_cold_need_decay_bonus) {
    parts.push(`Needs +${pct(effects.storm_cold_need_decay_bonus)} (storm/cold)`);
  }
  return parts.join('; ');
}

// Build a bordered panel from inner lines.
function buildPanelBox(lines, innerWidth, contentWidth) {
  const top = { text: `╔═╦${'═'.repeat(innerWidth)}╦═╗`, colorKey: null };
  const bottom = { text: `╚═╩${'═'.repeat(innerWidth)}╩═╝`, colorKey: null };
  const padWidth = Math.max(1, Number(contentWidth || innerWidth));
  const contentStart = 4;
  const contentEnd = contentStart + padWidth;
  const body = lines.map((line) => {
    if (line.separator) {
      return { text: `╠═╬${'═'.repeat(innerWidth)}╬═╣`, colorKey: null };
    }
    return {
      text: `║░║ ${padRight(line.text, padWidth)}║░║`,
      colorKey: line.colorKey || null,
      colorStart: line.colorKey ? contentStart : null,
      colorEnd: line.colorKey ? contentEnd : null,
    };
  });
  return [top, ...body, bottom];
}

// Overlay the inspect panel onto the grid.
function applyInspectPanel(grid, panel, colors) {
  if (!panel || !Array.isArray(panel.lines)) {
    return;
  }
  const startY = panel.y;
  const startX = panel.x;

  for (let row = 0; row < panel.lines.length; row += 1) {
    const y = startY + row;
    if (!grid[y]) {
      continue;
    }
    const line = panel.lines[row];
    const text = line.text || '';
    const colorKey = line.colorKey || null;
    const colorStart = Number.isFinite(line.colorStart) ? line.colorStart : null;
    const colorEnd = Number.isFinite(line.colorEnd) ? line.colorEnd : null;
    for (let col = 0; col < text.length; col += 1) {
      const x = startX + col;
      if (grid[y][x] === undefined) {
        continue;
      }
      const ch = text[col];
      const shouldColor = colorKey && (colorStart === null || (col >= colorStart && col < colorEnd));
      if (shouldColor) {
        grid[y][x] = applyColor(ch, colorKey, colors);
      } else {
        grid[y][x] = ch;
      }
    }
  }
}

module.exports = { buildInspectPanel, applyInspectPanel };
