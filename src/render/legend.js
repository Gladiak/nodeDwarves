"use strict";

const { padRight } = require("../utils");
const { getColorConfig, colorizeLegend, applyColor } = require("./colors");
const { wrapLine, fitLine } = require("./format");

function toPascalCase(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  return text
    .split(/[_\s-]+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

function getResourceLabel(resourceConfig, resourceId) {
  const labels =
    resourceConfig && resourceConfig.labels ? resourceConfig.labels : null;
  const label = labels && labels[resourceId] ? labels[resourceId] : resourceId;
  return toPascalCase(label);
}

function pickSymbol(value, fallback) {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return fallback;
}

// Build raw legend and terrain entries for reuse.
function buildLegendSections(config, options = {}) {
  const useColor = options.color !== false;
  const detailed = options.detailed === true;
  const underrealmActive = options.underrealmActive === true;
  const symbols = config.symbols || {};
  const colors = getColorConfig(config);
  const resourceConfig = config.resources || {};
  const nodeConfig = resourceConfig.nodes || {};
  const structureConfig = config.structures || {};
  const terrainConfig = (config.display && config.display.terrain) || {};
  const terrainSymbols = terrainConfig.symbols || {};
  const underrealmTerrainConfig =
    (config.underrealm && config.underrealm.terrain) || {};
  const underrealmSymbols = underrealmTerrainConfig.symbols || {};
  const terrainEnabled =
    terrainConfig.enabled !== false &&
    terrainSymbols &&
    typeof terrainSymbols === "object";

  const formatEntry = (symbol, label, key) => {
    const text = `${symbol} ${toPascalCase(label)}`;
    if (detailed) {
      return { text, colorKey: key || null };
    }
    return useColor ? colorizeLegend(text, key, colors) : text;
  };

  const legendParts = [];
  if (underrealmActive) {
    const delverColorKey =
      colors.map && colors.map.underrealm_delver
        ? "underrealm_delver"
        : "dwarf";
    legendParts.push(
      formatEntry(symbols.dwarf || "☺", "delver crew", delverColorKey),
    );
    const hostilesConfig =
      (config.underrealm && config.underrealm.hostiles) || {};
    if (hostilesConfig.enabled !== false) {
      const hostileColorKey =
        colors.map && colors.map.underrealm_hostile
          ? "underrealm_hostile"
          : "beast";
      legendParts.push(
        formatEntry(
          symbols.underrealm_hostile || "☻",
          "deep hostiles",
          hostileColorKey,
        ),
      );
    }
  } else {
    legendParts.push(formatEntry(symbols.dwarf || "@", "dwarf", "dwarf"));
  }
  for (const resource of Object.keys(nodeConfig)) {
    if (isTerrainMappedResource(resourceConfig, terrainSymbols, resource)) {
      continue;
    }
    const symbol = symbols[resource] || resource[0] || "?";
    legendParts.push(
      formatEntry(symbol, getResourceLabel(resourceConfig, resource), resource),
    );
  }
  const houseLegend =
    symbols.house || getHouseLegendLabel(structureConfig.house);
  if (houseLegend) {
    legendParts.push(formatEntry(houseLegend, "house", "house"));
  }
  const structureWhitelist = new Set([
    "house",
    "well",
    "field",
    "workshop",
    "armory",
    "alchemy_lab",
    "mithril_forge",
    "brewery",
    "sawmill",
    "mine",
    "ruins",
    "watchtower",
    "temple_of_ancestors",
  ]);
  for (const [type, definition] of Object.entries(structureConfig)) {
    if (type === "house" && houseLegend) {
      continue;
    }
    if (!structureWhitelist.has(type)) {
      continue;
    }
    const count = Number(
      definition && definition.count !== undefined
        ? definition.count
        : definition,
    );
    const hasDefinition = definition && typeof definition === "object";
    if ((!Number.isFinite(count) || count <= 0) && !hasDefinition) {
      continue;
    }
    const symbol = symbols[type] || symbols.structure || "#";
    legendParts.push(formatEntry(symbol, type, type));
  }
  const underrealmConfig = config.underrealm || {};
  const discoveryConfig = underrealmConfig.discovery || {};
  if (underrealmConfig.enabled !== false && discoveryConfig.enabled !== false) {
    const gateSymbol = String(
      discoveryConfig.symbol || symbols.underrealm_gate || "O",
    );
    legendParts.push(
      formatEntry(
        gateSymbol,
        "underrealm gate",
        String(discoveryConfig.color_key || "underrealm_gate"),
      ),
    );
  }

  const merchantConfig = config.merchant || {};
  if (merchantConfig.enabled !== false) {
    legendParts.push(
      formatEntry(symbols.merchant || "M", "merchant", "merchant"),
    );
  }

  const externalCampsConfig = config.externalCamps || {};
  if (externalCampsConfig.enabled === true) {
    legendParts.push(
      formatEntry(
        symbols.external_camp_trade || "T",
        "trade camp",
        "external_camp_trade",
      ),
    );
    legendParts.push(
      formatEntry(
        symbols.external_camp_militia || "M",
        "militia camp",
        "external_camp_militia",
      ),
    );
    legendParts.push(
      formatEntry(
        symbols.external_camp_raider || "R",
        "raider camp",
        "external_camp_raider",
      ),
    );
    const caravansConfig = externalCampsConfig.caravans || {};
    if (caravansConfig.enabled !== false) {
      legendParts.push(
        formatEntry(
          symbols.external_camp_caravan || "*",
          "trade caravan",
          "external_camp_caravan",
        ),
      );
    }
    const influenceConfig = externalCampsConfig.influence || {};
    if (influenceConfig.enabled !== false && influenceConfig.renderEnabled !== false) {
      legendParts.push(
        formatEntry(
          symbols.external_camp_influence || ".",
          "camp influence",
          "external_camp_influence_trade",
        ),
      );
    }
  }

  const raidConfig = config.raids || {};
  const beastSymbol = getBeastSymbol(config);
  if (raidConfig.enabled === true && beastSymbol) {
    legendParts.push(formatEntry(beastSymbol, "beasts", "beast"));
  }

  const wildlifeConfig = config.wildlife || {};
  if (wildlifeConfig.enabled === true && symbols.herd) {
    legendParts.push(formatEntry(symbols.herd, "herds", "herd"));
  }

  const terrainParts = [];
  if (terrainEnabled) {
    if (
      underrealmActive &&
      underrealmSymbols &&
      typeof underrealmSymbols === "object"
    ) {
      const pushTerrain = (symbol, label, colorKey) => {
        if (!symbol) {
          return;
        }
        terrainParts.push(formatEntry(symbol, label, colorKey));
      };
      pushTerrain(underrealmSymbols.wall, "obsidian wall", "terrain_wall");
      pushTerrain(underrealmSymbols.cave, "echo cavern", "terrain_cave");
      pushTerrain(underrealmSymbols.chasm, "abyssal rift", "terrain_chasm");
      pushTerrain(underrealmSymbols.crystal, "mana crystal", "terrain_crystal");
      pushTerrain(underrealmSymbols.magma, "emberflow", "terrain_magma");
      pushTerrain(
        underrealmSymbols.shrine,
        "ancestor shrine",
        "terrain_shrine",
      );
      pushTerrain(
        symbols.underrealm_lift_up || "↑",
        "lift to upper",
        "underrealm_lift_up",
      );
      pushTerrain(
        symbols.underrealm_lift_down || "↓",
        "lift to lower",
        "underrealm_lift_down",
      );
      pushTerrain(
        symbols.underrealm_lift_locked || "↓",
        "lift locked",
        "underrealm_lift_locked",
      );
      return { legendParts, terrainParts };
    }
    const forestSymbols = terrainConfig.forestSymbols || {};
    const hillSymbols = terrainConfig.hillSymbols || {};
    const mountainSymbols = terrainConfig.mountainSymbols || {};
    const roadSymbols = terrainConfig.roadSymbols || {};
    const roadSpecialSymbols = terrainConfig.roadSpecialSymbols || {};
    const roadsConfig = config.roads || {};

    const pushTerrain = (symbol, label, colorKey) => {
      if (!symbol) {
        return;
      }
      terrainParts.push(formatEntry(symbol, label, colorKey));
    };

    pushTerrain(terrainSymbols.river, "river", "terrain_river");
    pushTerrain(terrainSymbols.lake, "lake", "terrain_lake");
    if (roadsConfig.enabled !== false) {
      const roadSymbol = pickSymbol(roadSymbols.horizontal, null);
      pushTerrain(roadSymbol, "road", "terrain_road");
      if (roadSpecialSymbols.bridge) {
        pushTerrain(roadSpecialSymbols.bridge, "bridge", "terrain_bridge");
      }
      if (roadSpecialSymbols.ford) {
        pushTerrain(roadSpecialSymbols.ford, "ford", "terrain_ford");
      }
    }

    const mountainMedium = pickSymbol(
      mountainSymbols.medium,
      terrainSymbols.mountain,
    );
    const mountainHigh = pickSymbol(mountainSymbols.high, mountainMedium);
    pushTerrain(
      mountainMedium,
      "mountain",
      colors.map.terrain_mountain_medium
        ? "terrain_mountain_medium"
        : "terrain_mountain",
    );
    if (mountainHigh && mountainHigh !== mountainMedium) {
      pushTerrain(
        mountainHigh,
        "mountain high",
        colors.map.terrain_mountain_high
          ? "terrain_mountain_high"
          : "terrain_mountain",
      );
    }

    const hillGentle = pickSymbol(hillSymbols.primary, terrainSymbols.hill);
    const hillPronounced = pickSymbol(hillSymbols.pronounced, hillGentle);
    pushTerrain(hillGentle, "hill", "terrain_hill");
    if (hillPronounced && hillPronounced !== hillGentle) {
      pushTerrain(
        hillPronounced,
        "hill pronounced",
        colors.map.terrain_hill_pronounced
          ? "terrain_hill_pronounced"
          : "terrain_hill",
      );
    }

    pushTerrain(terrainSymbols.plain, "plain", "terrain_plain");
    pushTerrain(terrainSymbols.fertile, "fertile", "terrain_fertile");
    pushTerrain(terrainSymbols.food, "food", "terrain_food");
    pushTerrain(terrainSymbols.pasture, "pasture", "terrain_pasture");

    const forestNormal = pickSymbol(
      forestSymbols.primary,
      terrainSymbols.forest,
    );
    const forestDense = pickSymbol(forestSymbols.dense, forestNormal);
    pushTerrain(forestNormal, "forest", "terrain_forest");
    if (forestDense && forestDense !== forestNormal) {
      pushTerrain(
        forestDense,
        "forest dense",
        colors.map.terrain_forest_dense
          ? "terrain_forest_dense"
          : "terrain_forest",
      );
    }
  }

  return { legendParts, terrainParts };
}

// Build footer lines containing the legend and map key.
function buildFooterLines(config, runtime) {
  const height = Math.max(0, Number(runtime.footerHeight || 0));
  if (height === 0) {
    return [];
  }

  const width = Number(runtime.totalWidth || runtime.gridWidth || 0);
  const colors = getColorConfig(config);
  const lines = [];

  const innerWidth = Math.max(0, width - 6);
  const simTitle = resolveSimulationTitle(config);
  const mottoText = pickFitting(
    [
      "⟪ DWARVEN COMMANDS ⟫",
      "ᚦ DWARVEN COMMANDS ᚦ",
      "DWARVEN COMMANDS",
      "COMMANDS",
    ],
    innerWidth,
  );
  const controlsText = pickFitting(
    [
      "ᚠ [SPACE] PAUSE ᚱ [l] LEGEND ᚨ [i] DWARF INFO ᚹ [w] WARRIOR LEAGUE ᚺ [h] TELEMETRY ᚲ [←/→] PAGE/INSPECT ᛞ [↑/↓] DEPTH ᛗ [m] MAP SAVE ᛗ [M] MAP+STRUCT ᚾ",
      "[SPACE] PAUSE  ::  [l] LEGEND  ::  [i] DWARF INFO  ::  [w] WARRIOR LEAGUE  ::  [h] TELEMETRY  ::  [←/→] PAGE/INSPECT  ::  [↑/↓] DEPTH  ::  [m] MAP SAVE  ::  [M] MAP+STRUCT",
      "[SPACE] PAUSE  [l] LEGEND  [i] DWARF INFO  [w] WARRIOR LEAGUE  [h] TELEMETRY  [←/→] PAGE/INSPECT  [↑/↓] DEPTH  [m] MAP SAVE  [M] MAP+STRUCT",
    ],
    innerWidth,
  );
  const titleText = pickFitting(buildTitleOptions(simTitle), innerWidth);

  if (height >= 3) {
    lines.push(buildFrameLine(width, titleText, colors, false));
    lines.push(buildContentLine(width, controlsText, colors));
    lines.push(buildFrameLine(width, mottoText, colors, true));
  } else if (height === 2) {
    lines.push(buildContentLine(width, controlsText, colors));
    lines.push(buildFrameLine(width, mottoText, colors, true));
  } else {
    const wrapped = wrapLine(controlsText, width);
    lines.push(padRight(wrapped[0] || "", width));
  }

  while (lines.length < height) {
    lines.push(padRight("", width));
  }
  return lines.slice(0, height);
}

// Pick the first option that fits the width.
function pickFitting(options, width) {
  const list = Array.isArray(options) ? options : [];
  for (const option of list) {
    if (measureDisplayWidth(option) <= width) {
      return option;
    }
  }
  if (list.length > 0) {
    return list[list.length - 1];
  }
  return "";
}

// Resolve the simulation title for footer display.
function resolveSimulationTitle(config) {
  const display = config.display || {};
  const header = display.header || {};
  if (header && header.title) {
    return String(header.title);
  }
  return "~ ⚒️ 🍺 ~ NodeDwarves Simulation: Dig Deep, Drink Hard ~ 🍺 ⚒️ ~";
}

// Build title variants to fit smaller widths.
function buildTitleOptions(title) {
  const sanitized = sanitizeFooterTitle(title);
  if (!sanitized) {
    return ["NodeDwarves Simulation"];
  }
  return [
    sanitized,
    sanitized.replace(/^~\s*/g, "").replace(/\s*~$/g, ""),
    "NodeDwarves Simulation: Dig Deep, Drink Hard",
    "NodeDwarves Simulation",
    "NodeDwarves",
  ];
}

// Remove emoji-width ambiguity while keeping a dwarven feel.
function sanitizeFooterTitle(value) {
  let text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const replacements = [
    { pattern: /⚒️/g, value: "ᚠ" },
    { pattern: /⚒/g, value: "ᚠ" },
    { pattern: /🍺/g, value: "ᛒ" },
  ];
  for (const entry of replacements) {
    text = text.replace(entry.pattern, entry.value);
  }
  text = text.replace(/[\uFE0F\u200D]/g, "");
  text = text.replace(/\p{Extended_Pictographic}/gu, "");
  text = text.replace(/\s{2,}/g, " ").trim();
  return text;
}

// Build a framed banner line with centered text.
function buildFrameLine(width, label, colors, isBottom) {
  const innerWidth = Math.max(0, width - 6);
  const text = fitDisplayLine(label, innerWidth);
  const textLen = measureDisplayWidth(text);
  const fillTotal = Math.max(0, innerWidth - textLen);
  const leftFill = Math.floor(fillTotal / 2);
  const rightFill = fillTotal - leftFill;
  const left = isBottom ? "╚═╩" : "╔═╦";
  const right = isBottom ? "╩═╝" : "╦═╗";
  const colored = text ? applyColor(text, "hud_header", colors) : "";
  return `${left}${"═".repeat(leftFill)}${colored}${"═".repeat(rightFill)}${right}`;
}

// Build a banner content line with white borders and centered controls.
function buildContentLine(width, label, colors) {
  const innerWidth = Math.max(0, width - 6);
  const text = fitDisplayLine(label, innerWidth);
  const textLen = measureDisplayWidth(text);
  const leftPad = Math.floor(Math.max(0, innerWidth - textLen) / 2);
  const rightPad = Math.max(0, innerWidth - textLen - leftPad);
  const content = padDisplayRight(
    `${" ".repeat(leftPad)}${text}${" ".repeat(rightPad)}`,
    innerWidth,
  );
  const colored = content ? applyColor(content, "hud_header", colors) : content;
  return `║ᚠ ${colored} ᚠ║`;
}

// Measure display width for a string (handles emoji/variation selectors).
function measureDisplayWidth(value) {
  const text = String(value || "");
  let width = 0;
  for (const char of text) {
    width += measureCharWidth(char);
  }
  return width;
}

// Clamp a string to the target display width without splitting emoji.
function fitDisplayLine(value, width) {
  if (width <= 0) {
    return "";
  }
  const text = String(value || "");
  let result = "";
  let used = 0;
  for (const char of text) {
    const charWidth = measureCharWidth(char);
    if (used + charWidth > width) {
      break;
    }
    result += char;
    used += charWidth;
  }
  return result;
}

// Pad a string to a target display width.
function padDisplayRight(value, width) {
  const text = String(value || "");
  const length = measureDisplayWidth(text);
  if (length >= width) {
    return text;
  }
  return `${text}${" ".repeat(width - length)}`;
}

// Determine display width for a single character.
function measureCharWidth(char) {
  if (!char) {
    return 0;
  }
  if (char === "\uFE0F" || char === "\u200D") {
    return 0;
  }
  if (isWideChar(char)) {
    return 2;
  }
  return 1;
}

// Rough wide-character detection (emoji + CJK blocks).
function isWideChar(char) {
  if (/\p{Extended_Pictographic}/u.test(char)) {
    return true;
  }
  const code = char.codePointAt(0) || 0;
  return (
    code >= 0x1100 &&
    (code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6))
  );
}

// Check if a resource is represented by terrain symbols.
function isTerrainMappedResource(resourceConfig, terrainSymbols, resourceId) {
  if (!resourceConfig || !resourceConfig.terrainAllowed) {
    return false;
  }
  const allowed = resourceConfig.terrainAllowed[resourceId];
  if (!Array.isArray(allowed) || allowed.length === 0) {
    return false;
  }
  if (!terrainSymbols || typeof terrainSymbols !== "object") {
    return false;
  }
  return allowed.some((type) => Boolean(terrainSymbols[type]));
}

// Build a label for house level symbols.
function getHouseLegendLabel(houseConfig) {
  if (
    !houseConfig ||
    !houseConfig.levels ||
    typeof houseConfig.levels !== "object"
  ) {
    return "";
  }
  const levels = Object.keys(houseConfig.levels)
    .map((key) => Number(key))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (levels.length === 0) {
    return "";
  }
  const min = levels[0];
  const max = levels[levels.length - 1];
  if (min === max) {
    return String(min);
  }
  return `${min}-${max}`;
}

// Resolve the symbol used for raid beasts.
function getBeastSymbol(config) {
  const symbols = config.symbols || {};
  if (symbols.beast) {
    return String(symbols.beast);
  }
  const raidConfig = config.raids || {};
  if (raidConfig.symbol) {
    return String(raidConfig.symbol);
  }
  return "";
}

module.exports = { buildFooterLines, buildLegendSections, getBeastSymbol };
