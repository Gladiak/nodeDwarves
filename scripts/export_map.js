"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const puppeteer = require("puppeteer");
const config = require("../config.json");
const packageInfo = require("../package.json");
const { createInitialState } = require("../src/state");
const { buildRuntime } = require("../src/runtime");
const { renderFrame } = require("../src/render");
const { updateSeason } = require("../src/simulation/season");

const EXPORT_DEFAULT_BACKGROUND = "#24273a";
const EXPORT_DEFAULT_FOREGROUND = "#cad3f5";
const EXPORT_ANSI_16_PALETTE = [
  [73, 77, 100],
  [237, 135, 150],
  [166, 218, 149],
  [238, 212, 159],
  [138, 173, 244],
  [245, 189, 230],
  [139, 213, 202],
  [165, 173, 203],
  [91, 96, 120],
  [236, 116, 134],
  [140, 207, 127],
  [225, 198, 130],
  [120, 161, 246],
  [242, 169, 221],
  [99, 203, 192],
  [184, 192, 224],
];
const EXPORT_TERRAIN_PALETTE = {
  terrain_cherry: "#9b7bbd",
  terrain_fertile: "#6fae97",
  terrain_fertile_autumn: "#a6895f",
  terrain_fertile_spring: "#6cab8c",
  terrain_fertile_summer: "#6fae97",
  terrain_fertile_winter: "#cfd6db",
  terrain_food: "#cdb56e",
  terrain_food_autumn: "#a6895f",
  terrain_food_spring: "#6fae97",
  terrain_food_summer: "#cdb56e",
  terrain_food_winter: "#d9dde1",
  terrain_forest: "#6cab8c",
  terrain_forest_autumn: "#a6895f",
  terrain_forest_dense: "#4f7f6a",
  terrain_forest_dense_autumn: "#8a6b45",
  terrain_forest_dense_spring: "#5f8f78",
  terrain_forest_dense_summer: "#5f8f78",
  terrain_forest_dense_winter: "#7a7d84",
  terrain_forest_spring: "#6cab8c",
  terrain_forest_summer: "#86a96a",
  terrain_forest_winter: "#cfd6db",
  terrain_hill: "#bfb69a",
  terrain_hill_pronounced: "#b39a5f",
  terrain_lake: "#5f9fb8",
  terrain_mountain: "#d9dde1",
  terrain_mountain_high: "#ffffff",
  terrain_mountain_medium: "#b8bcc2",
  terrain_pasture: "#b3a88e",
  terrain_pasture_depleted: "#8f866f",
  terrain_plain: "#6cab8c",
  terrain_plain_autumn: "#bfb69a",
  terrain_plain_spring: "#6cab8c",
  terrain_plain_summer: "#6fae97",
  terrain_plain_winter: "#b9cfc6",
  terrain_river: "#5a8fc9",
  terrain_stone: "#b8bcc2",
};

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printUsage();
  process.exit(0);
}

const CRC_TABLE = buildCrcTable();

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});

// Function: main.
async function main() {
  const width = normalizeDimension(
    args.width ?? args.w ?? config.display.width,
    "width",
  );
  const height = normalizeDimension(
    args.height ?? args.h ?? config.display.height,
    "height",
  );
  const scale = Math.max(1, Number(args.scale || 2));
  const baseFontSize = Math.max(6, Number(args.fontSize || 14));
  const lineHeightRatio = clampNumber(Number(args.lineHeight || 1.2), 1, 2.5);
  const fontFamily = String(
    args.font ||
      'Menlo, Monaco, Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace',
  );
  const count = normalizeCount(args.count ?? 1);
  const outputDir = String(args.outDir || "maps");
  const background = parseHexColor(
    String(args.background || EXPORT_DEFAULT_BACKGROUND),
    {
      r: 36,
      g: 39,
      b: 58,
      css: "rgb(36, 39, 58)",
    },
  );
  const foreground = parseHexColor(
    String(args.foreground || EXPORT_DEFAULT_FOREGROUND),
    {
      r: 202,
      g: 211,
      b: 245,
      css: "rgb(202, 211, 245)",
    },
  );
  const seasonInput = args.season ? String(args.season).toLowerCase() : null;
  const allSeasons =
    args.allSeasons === true
    || String(args.seasons || "").toLowerCase() === "all"
    || seasonInput === "all";
  const seasonProgress =
    args.seasonProgress !== undefined ? Number(args.seasonProgress) : 0.5;
  const snapshot = loadExportSnapshot(args.state);
  const includeStructures =
    args.includeStructures === true
    || (snapshot && (Array.isArray(snapshot.structures) || snapshot.roads));
  const seedOverride = args.seed !== undefined ? Number(args.seed) : null;
  const seeds = buildSeedList(count, seedOverride);
  const seasonList = resolveSeasonList(config, seasonInput, allSeasons);
  const underrealmOverrides = resolveUnderrealmExportOverrides(config, args, snapshot);
  const layerSpecs = resolveLayerSpecs(
    config,
    args,
    snapshot,
    underrealmOverrides,
  );
  const totalExports = Math.max(
    1,
    seeds.length * seasonList.length * layerSpecs.length,
  );
  let exportIndex = 0;

  for (let index = 0; index < seeds.length; index += 1) {
    for (const seasonName of seasonList) {
      const exportConfig = buildExportConfig(config, {
        width,
        height,
        seedOverride: seeds[index],
      });

      const runtime = buildRuntime(exportConfig.display, {
        columns: exportConfig.display.width,
        rows: exportConfig.display.height,
      });
      const outputWidth = runtime.totalWidth;
      const outputHeight = runtime.totalHeight;

      const state = createInitialState(exportConfig, runtime);

      const seasonInfo = resolveSeasonTick(
        exportConfig,
        seasonName,
        seasonProgress,
      );
      state.tick = seasonInfo.tick;
      updateSeason(state, exportConfig);

      if (snapshot) {
        applyExportSnapshot(state, snapshot, exportConfig.symbols || {});
      }

      applyUnderrealmExportOverrides(state, underrealmOverrides);
      stripNonMapEntities(state, { includeStructures });

      for (const layerSpec of layerSpecs) {
        applyLayerSelection(state, layerSpec);
        const renderedTerrain = getRenderedTerrain(state, layerSpec);
        const frame = renderFrame(state, exportConfig, runtime);
        const lines = normalizeFrameLines(frame, outputHeight);

        const parsed = parseAnsiLines(lines, {
          defaultColor: foreground,
          width: outputWidth,
        });

        const pngResult = await renderToPng(parsed, {
          width,
          height,
          scale,
          baseFontSize,
          lineHeightRatio,
          fontFamily,
          background,
          foreground,
          columns: outputWidth,
          rows: outputHeight,
        });

        const terrainSummary = summarizeTerrain(renderedTerrain);
        const metadata = buildMetadata({
          width,
          height,
          season: state.season,
          terrain: renderedTerrain,
          terrainSummary,
          config: exportConfig,
          tick: state.tick,
          layer: layerSpec,
          render: {
            scale,
            fontSize: baseFontSize,
            lineHeight: lineHeightRatio,
            fontFamily,
            background: background.css,
            foreground: foreground.css,
          },
        });

        const withMeta = insertTextChunk(
          pngResult.buffer,
          "NodeDwarves",
          JSON.stringify(metadata),
        );
        const svg = renderToSvg(parsed, {
          columns: outputWidth,
          rows: outputHeight,
          baseFontSize,
          lineHeightRatio,
          fontFamily,
          background,
          foreground,
          metrics: pngResult.metrics,
          metadata,
        });
        const outputName = buildLayeredName(
          buildSeasonalName(
            buildBatchName(args.name, exportIndex, totalExports),
            seasonInfo.name,
            seasonList.length,
          ),
          layerSpec,
          layerSpecs.length,
        );
        const layerSeed = Number.isFinite(renderedTerrain && renderedTerrain.seed)
          ? renderedTerrain.seed
          : (state.terrain ? state.terrain.seed : 0);
        const layerTag = getLayerTag(layerSpec);
        const layerTagForFile =
          layerSpecs.length > 1 || Number(layerSpec && layerSpec.depth || 0) > 0
            ? layerTag
            : null;
        const pngPath = writeOutput(withMeta, outputDir, outputName, {
          width,
          height,
          season: seasonInfo.name,
          seed: layerSeed,
          layerTag: layerTagForFile,
          format: "png",
        });
        const svgPath = writeOutput(svg, outputDir, outputName, {
          width,
          height,
          season: seasonInfo.name,
          seed: layerSeed,
          layerTag: layerTagForFile,
          format: "svg",
        });

        exportIndex += 1;
        const prefix =
          totalExports > 1 ? `[${exportIndex}/${totalExports}] ` : "";
        console.log(`${prefix}Map exported to ${pngPath}`);
        console.log(`${prefix}Map exported to ${svgPath}`);
        console.log(`${prefix}Signature: ${metadata.signature}`);
      }
    }
  }
}

// Function: parseArgs.
function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      continue;
    }
    const [key, value] = arg.slice(2).split("=");
    parsed[key] = value === undefined ? true : value;
  }
  return parsed;
}

// Function: printUsage.
function printUsage() {
  console.log(
    "Usage: node scripts/export_map.js --width=120 --height=40 --season=spring",
  );
  console.log("Options:");
  console.log("  --width, --w        Map width (columns).");
  console.log("  --height, --h       Map height (rows).");
  console.log(
    "  --season            Season name (spring, summer, autumn, winter).",
  );
  console.log("                    Use --season=all to export all seasons.");
  console.log("  --seasonProgress    Season progress (0..1, default 0.5).");
  console.log("  --allSeasons        Export all seasons (same as --season=all).");
  console.log(
    "  --includeStructures Include structures/roads from a snapshot (no dwarves).",
  );
  console.log("  --state             JSON snapshot with structures/roads.");
  console.log(
    "  --layers            Comma-separated layers: surface,d1,d2 or unlocked/all.",
  );
  console.log(
    "  --underrealmUnlockedDepth  Force unlocked underrealm depth for export.",
  );
  console.log(
    "  --underrealmMaxDepth       Override max underrealm depth bound.",
  );
  console.log("  --seed              Override terrain seed (number).");
  console.log("  --scale             Render scale multiplier (default 2; PNG only).");
  console.log("  --fontSize          Base font size in px (default 14).");
  console.log("  --lineHeight        Line height ratio (default 1.2).");
  console.log("  --font              Font family list (CSS format).");
  console.log("  --background        Background color hex (default #24273a).");
  console.log(
    "  --foreground        Default foreground hex (default #cad3f5).",
  );
  console.log(
    "  --count             Number of images to export (default 1).",
  );
  console.log("  --outDir            Output folder (default maps).");
  console.log(
    "  --name              Output filename base (optional).",
  );
  console.log("  --help              Show help.");
  console.log(
    "Outputs PNG + SVG into <outDir>/png and <outDir>/svg (default maps/png, maps/svg).",
  );
}

// Function: normalizeDimension.
function normalizeDimension(value, label) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return Math.floor(numeric);
}

// Function: normalizeCount.
function normalizeCount(value) {
  if (value === undefined || value === null || value === "") {
    return 1;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`Invalid count: ${value}`);
  }
  return Math.floor(numeric);
}

// Function: clampNumber.
function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

// Function: parseHexColor.
function parseHexColor(value, fallback) {
  const raw = String(value || "").trim();
  const normalized = raw.startsWith("#") ? raw.slice(1) : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return fallback || { r: 0, g: 0, b: 0, css: "rgb(0, 0, 0)" };
  }
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return { r, g, b, css: `rgb(${r}, ${g}, ${b})` };
}

// Function: buildSeedList.
function buildSeedList(count, seedOverride) {
  const seeds = [];
  if (Number.isFinite(seedOverride)) {
    const base = Math.floor(seedOverride);
    for (let i = 0; i < count; i += 1) {
      seeds.push(base + i);
    }
    return seeds;
  }
  for (let i = 0; i < count; i += 1) {
    seeds.push(randomSeed());
  }
  return seeds;
}

// Function: randomSeed.
function randomSeed() {
  return crypto.randomInt(0, 2 ** 31);
}

// Function: applyExportPalette.
function applyExportPalette(exportConfig) {
  const display = exportConfig.display || {};
  const colors = display.colors || {};
  const map = colors.map || {};
  for (const [key, value] of Object.entries(EXPORT_TERRAIN_PALETTE)) {
    const ansi = hexToAnsi(value);
    if (ansi) {
      map[key] = ansi;
    }
  }
  colors.map = map;
  display.colors = colors;
  exportConfig.display = display;
}

// Function: hexToAnsi.
function hexToAnsi(value) {
  const raw = String(value || "").trim();
  const normalized = raw.startsWith("#") ? raw.slice(1) : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `\u001b[38;2;${r};${g};${b}m`;
}

// Function: buildBatchName.
function buildBatchName(name, index, total) {
  if (!name || total <= 1) {
    return name;
  }
  const ext = path.extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  const digits = Math.max(2, String(total).length);
  const suffix = String(index + 1).padStart(digits, "0");
  return ext ? `${base}_${suffix}${ext}` : `${base}_${suffix}`;
}

// Function: buildSeasonalName.
function buildSeasonalName(name, season, seasonCount) {
  if (!name || seasonCount <= 1) {
    return name;
  }
  const ext = path.extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  const suffix = String(season || "").toLowerCase();
  if (!suffix) {
    return name;
  }
  return ext ? `${base}_${suffix}${ext}` : `${base}_${suffix}`;
}

// Function: buildLayeredName.
function buildLayeredName(name, layerSpec, layerCount) {
  if (!name || layerCount <= 1) {
    return name;
  }
  const ext = path.extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  const suffix = getLayerTag(layerSpec);
  return ext ? `${base}_${suffix}${ext}` : `${base}_${suffix}`;
}

// Function: getLayerTag.
function getLayerTag(layerSpec) {
  const depth = Math.max(0, Math.floor(Number(layerSpec && layerSpec.depth || 0)));
  if (depth <= 0) {
    return "surface";
  }
  return `d${depth}`;
}

// Function: normalizeDepthNumber.
function normalizeDepthNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`Invalid depth value: ${value}`);
  }
  return Math.floor(numeric);
}

// Function: normalizeMaxDepthFromState.
function normalizeMaxDepthFromState(state) {
  if (!state || typeof state !== "object") {
    return 0;
  }
  const underrealm = state.underrealm;
  if (!underrealm || typeof underrealm !== "object") {
    return 0;
  }
  const layerDepth = Array.isArray(underrealm.layers)
    ? underrealm.layers.reduce(
      (max, layer) => Math.max(max, Math.floor(Number(layer && layer.depth || 0))),
      0,
    )
    : 0;
  const configuredDepth = Math.floor(Number(underrealm.maxDepth || 0));
  return Math.max(0, Math.max(layerDepth, configuredDepth));
}

// Function: normalizeUnlockedDepthFromState.
function normalizeUnlockedDepthFromState(state) {
  if (!state || typeof state !== "object") {
    return 0;
  }
  const underrealm = state.underrealm;
  if (!underrealm || typeof underrealm !== "object") {
    return 0;
  }
  const value = Math.floor(Number(underrealm.maxUnlockedDepth || 0));
  return Math.max(0, value);
}

// Function: resolveUnderrealmExportOverrides.
function resolveUnderrealmExportOverrides(currentConfig, parsedArgs, snapshot) {
  const underrealmConfig = (currentConfig && currentConfig.underrealm) || {};
  const configMaxDepth = Math.max(0, Math.floor(Number(underrealmConfig.max_depth || 0)));
  const snapshotMaxDepth = normalizeMaxDepthFromState(snapshot);
  const snapshotUnlockedDepth = normalizeUnlockedDepthFromState(snapshot);
  const availableMaxDepth = Math.max(configMaxDepth, snapshotMaxDepth);
  const argMaxDepth = normalizeDepthNumber(
    parsedArgs.underrealmMaxDepth ?? parsedArgs.maxUnderrealmDepth,
  );
  const argUnlockedDepth = normalizeDepthNumber(
    parsedArgs.underrealmUnlockedDepth ?? parsedArgs.unlockedDepth,
  );
  const maxDepth = Math.max(
    0,
    argMaxDepth !== null
      ? clampNumber(argMaxDepth, 0, availableMaxDepth)
      : availableMaxDepth,
  );
  const unlockedDepth = clampNumber(
    Math.max(
      0,
      argUnlockedDepth !== null ? argUnlockedDepth : snapshotUnlockedDepth,
    ),
    0,
    maxDepth,
  );
  return {
    enabled: maxDepth > 0,
    maxDepth,
    maxUnlockedDepth: unlockedDepth,
  };
}

// Function: parseLayerDepthToken.
function parseLayerDepthToken(token) {
  if (!token) {
    return null;
  }
  const normalized = String(token).trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "surface" || normalized === "s" || normalized === "0") {
    return 0;
  }
  let match = normalized.match(/^d(\d+)$/);
  if (match) {
    return Math.max(0, Math.floor(Number(match[1])));
  }
  match = normalized.match(/^depth(\d+)$/);
  if (match) {
    return Math.max(0, Math.floor(Number(match[1])));
  }
  if (/^\d+$/.test(normalized)) {
    return Math.max(0, Math.floor(Number(normalized)));
  }
  return null;
}

// Function: appendLayerDepth.
function appendLayerDepth(depths, depthSet, depth) {
  const normalized = Math.max(0, Math.floor(Number(depth || 0)));
  if (depthSet.has(normalized)) {
    return;
  }
  depthSet.add(normalized);
  depths.push(normalized);
}

// Function: expandDepthToken.
function expandDepthToken(depths, depthSet, token, underrealmOverrides) {
  const normalized = String(token || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  const maxDepth = Math.max(0, Number(underrealmOverrides.maxDepth || 0));
  const maxUnlockedDepth = Math.max(
    0,
    Number(underrealmOverrides.maxUnlockedDepth || 0),
  );
  if (normalized === "all") {
    appendLayerDepth(depths, depthSet, 0);
    for (let depth = 1; depth <= maxDepth; depth += 1) {
      appendLayerDepth(depths, depthSet, depth);
    }
    return true;
  }
  if (normalized === "unlocked") {
    appendLayerDepth(depths, depthSet, 0);
    for (let depth = 1; depth <= maxUnlockedDepth; depth += 1) {
      appendLayerDepth(depths, depthSet, depth);
    }
    return true;
  }
  if (normalized === "underrealm" || normalized === "deep") {
    for (let depth = 1; depth <= maxUnlockedDepth; depth += 1) {
      appendLayerDepth(depths, depthSet, depth);
    }
    return true;
  }
  return false;
}

// Function: resolveLayerSpecs.
function resolveLayerSpecs(currentConfig, parsedArgs, snapshot, underrealmOverrides) {
  const source = parsedArgs.layers ?? parsedArgs.layer;
  if (source === undefined || source === null || String(source).trim() === "") {
    return [{ kind: "surface", depth: 0, label: "Surface" }];
  }

  const tokens = String(source)
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (tokens.length === 0) {
    return [{ kind: "surface", depth: 0, label: "Surface" }];
  }

  const depths = [];
  const depthSet = new Set();
  for (const token of tokens) {
    if (expandDepthToken(depths, depthSet, token, underrealmOverrides)) {
      continue;
    }
    const depth = parseLayerDepthToken(token);
    if (depth === null) {
      throw new Error(
        `Invalid layer token "${token}". Use surface,d1,d2 or unlocked/all.`,
      );
    }
    appendLayerDepth(depths, depthSet, depth);
  }

  if (depths.length === 0) {
    appendLayerDepth(depths, depthSet, 0);
  }

  const requestedDepth = depths.reduce((max, depth) => Math.max(max, depth), 0);
  const maxDepth = Math.max(0, Number(underrealmOverrides.maxDepth || 0));
  if (requestedDepth > 0 && maxDepth <= 0) {
    throw new Error("Underrealm layers requested, but underrealm is disabled in config.");
  }
  if (requestedDepth > maxDepth) {
    throw new Error(
      `Requested layer depth ${requestedDepth} exceeds max underrealm depth ${maxDepth}.`,
    );
  }
  underrealmOverrides.maxUnlockedDepth = Math.max(
    0,
    Math.max(Number(underrealmOverrides.maxUnlockedDepth || 0), requestedDepth),
  );

  return depths.map((depth) => {
    if (depth <= 0) {
      return { kind: "surface", depth: 0, label: "Surface" };
    }
    return {
      kind: "underrealm",
      depth,
      label: `Depth ${depth}`,
    };
  });
}

// Function: applyUnderrealmExportOverrides.
function applyUnderrealmExportOverrides(state, underrealmOverrides) {
  if (!state || !state.underrealm || underrealmOverrides.enabled !== true) {
    return;
  }
  const underrealm = state.underrealm;
  const availableDepth = Array.isArray(underrealm.layers)
    ? underrealm.layers.reduce(
      (max, layer) => Math.max(max, Math.floor(Number(layer && layer.depth || 0))),
      0,
    )
    : 0;
  const maxDepth = clampNumber(
    Number(underrealmOverrides.maxDepth || 0),
    0,
    Math.max(0, availableDepth),
  );
  underrealm.maxDepth = maxDepth;
  const unlockedDepth = clampNumber(
    Number(underrealmOverrides.maxUnlockedDepth || 0),
    0,
    maxDepth,
  );
  underrealm.maxUnlockedDepth = unlockedDepth;
  underrealm.activeDepth = clampNumber(
    Number(underrealm.activeDepth || 0),
    0,
    unlockedDepth,
  );
  if (underrealm.discovery && typeof underrealm.discovery === "object") {
    if (unlockedDepth > 0) {
      underrealm.discovery.found = true;
    }
  }
}

// Function: applyLayerSelection.
function applyLayerSelection(state, layerSpec) {
  if (!state || !state.underrealm) {
    return;
  }
  const depth = Math.max(0, Math.floor(Number(layerSpec && layerSpec.depth || 0)));
  if (depth <= 0) {
    state.underrealm.activeDepth = 0;
    return;
  }
  const maxDepth = Math.max(
    0,
    Math.floor(Number(state.underrealm.maxDepth || 0)),
  );
  const nextUnlockedDepth = clampNumber(
    depth,
    0,
    maxDepth,
  );
  state.underrealm.maxUnlockedDepth = Math.max(
    Math.floor(Number(state.underrealm.maxUnlockedDepth || 0)),
    nextUnlockedDepth,
  );
  state.underrealm.activeDepth = clampNumber(
    depth,
    0,
    Math.floor(Number(state.underrealm.maxUnlockedDepth || 0)),
  );
}

// Function: getRenderedTerrain.
function getRenderedTerrain(state, layerSpec) {
  const depth = Math.max(0, Math.floor(Number(layerSpec && layerSpec.depth || 0)));
  if (depth <= 0 || !state || !state.underrealm || !Array.isArray(state.underrealm.layers)) {
    return state ? state.terrain : null;
  }
  const layer = state.underrealm.layers.find(
    (entry) => Math.floor(Number(entry && entry.depth || 0)) === depth,
  );
  if (layer && layer.terrain) {
    return layer.terrain;
  }
  return state.terrain;
}

// Function: buildExportConfig.
function buildExportConfig(source, options) {
  const cloned = JSON.parse(JSON.stringify(source));
  cloned.display = cloned.display || {};
  cloned.display.autoSize = false;
  cloned.display.header = {
    ...(cloned.display.header || {}),
    enabled: false,
    height: 0,
  };
  cloned.display.footer = {
    ...(cloned.display.footer || {}),
    enabled: false,
    height: 0,
  };
  cloned.display.hud = {
    ...(cloned.display.hud || {}),
    enabled: false,
    width: 0,
  };
  cloned.display.frame = { ...(cloned.display.frame || {}) };
  cloned.display.colors = cloned.display.colors || {};
  cloned.display.colors.enabled = true;
  if (!cloned.display.colors.reset) {
    cloned.display.colors.reset = "\x1b[0m";
  }
  applyExportPalette(cloned);
  if (cloned.display.frame && cloned.display.frame.enabled) {
    cloned.display.width = options.width + 2;
    cloned.display.height = options.height + 2;
  } else {
    cloned.display.width = options.width;
    cloned.display.height = options.height;
  }
  if (options.seedOverride !== null && Number.isFinite(options.seedOverride)) {
    cloned.display.terrain = cloned.display.terrain || {};
    cloned.display.terrain.seed = Math.floor(options.seedOverride);
  }
  return cloned;
}

// Function: resolveSeasonTick.
function resolveSeasonTick(currentConfig, seasonName, seasonProgress) {
  const seasons = currentConfig.seasons || {};
  const order =
    Array.isArray(seasons.order) && seasons.order.length > 0
      ? seasons.order.map((name) => String(name).toLowerCase())
      : ["spring", "summer", "autumn", "winter"];
  const picked = seasonName ? String(seasonName).toLowerCase() : order[0];
  const index = order.indexOf(picked);
  if (index === -1) {
    throw new Error(
      `Unknown season "${seasonName}". Available: ${order.join(", ")}`,
    );
  }
  const duration = Math.max(1, Number(seasons.durationTicks || 200));
  const progress = clampNumber(
    Number.isFinite(seasonProgress) ? seasonProgress : 0.5,
    0,
    1,
  );
  const tickInSeason = clampNumber(
    Math.round(duration * progress),
    1,
    duration,
  );
  const tick = index * duration + tickInSeason;
  return { name: picked, index, duration, tick, progress, tickInSeason };
}

// Function: resolveSeasonList.
function resolveSeasonList(currentConfig, seasonName, allSeasons) {
  const seasons = currentConfig.seasons || {};
  const order =
    Array.isArray(seasons.order) && seasons.order.length > 0
      ? seasons.order.map((name) => String(name).toLowerCase())
      : ["spring", "summer", "autumn", "winter"];
  if (allSeasons) {
    return order;
  }
  if (!seasonName) {
    return [order[0]];
  }
  const picked = String(seasonName).toLowerCase();
  if (!order.includes(picked)) {
    throw new Error(`Unknown season "${seasonName}". Available: ${order.join(", ")}`);
  }
  return [picked];
}

// Function: loadExportSnapshot.
function loadExportSnapshot(value) {
  if (!value) {
    return null;
  }
  const filePath = path.resolve(String(value));
  let raw = null;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    throw new Error(`Failed to read export snapshot: ${err.message}`);
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid export snapshot JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Export snapshot must be a JSON object.");
  }
  return parsed;
}

// Function: applyExportSnapshot.
function applyExportSnapshot(state, snapshot, symbols) {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }
  if (Array.isArray(snapshot.structures)) {
    const normalized = snapshot.structures
      .map((structure) => normalizeSnapshotStructure(structure, symbols))
      .filter((value) => value !== null);
    state.structures = normalized;
  }
  if (snapshot.roads && snapshot.roads.types) {
    const normalized = normalizeSnapshotRoads(snapshot.roads);
    if (normalized) {
      state.roads = normalized;
    }
  }
  if (snapshot.temple && typeof snapshot.temple === "object") {
    const normalizedTemple = normalizeSnapshotTemple(snapshot.temple, state);
    if (normalizedTemple) {
      state.temple = normalizedTemple;
    }
  }
}

// Function: normalizeSnapshotStructure.
function normalizeSnapshotStructure(structure, symbols) {
  if (!structure || typeof structure !== "object") {
    return null;
  }
  const type = String(structure.type || "");
  if (!type) {
    return null;
  }
  const x = Number(structure.x);
  const y = Number(structure.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  const symbol = resolveSnapshotSymbol(structure, symbols, type);
  return {
    id: structure.id,
    type,
    x: Math.floor(x),
    y: Math.floor(y),
    symbol,
    level: structure.level,
    capacity: structure.capacity,
  };
}

// Function: resolveSnapshotSymbol.
function resolveSnapshotSymbol(structure, symbols, type) {
  if (structure && typeof structure.symbol === "string" && structure.symbol) {
    return structure.symbol;
  }
  if (symbols && typeof symbols === "object") {
    if (symbols[type]) {
      return symbols[type];
    }
    if (type === "house" && symbols.house) {
      return symbols.house;
    }
  }
  return "?";
}

// Function: normalizeSnapshotRoads.
function normalizeSnapshotRoads(roads) {
  if (!roads || typeof roads !== "object" || !Array.isArray(roads.types)) {
    return null;
  }
  const types = roads.types.map((row) => (Array.isArray(row) ? row.slice() : []));
  const inferredHeight = types.length;
  const inferredWidth = types.reduce((max, row) => Math.max(max, row.length), 0);
  const width = Number.isFinite(Number(roads.width))
    ? Math.floor(Number(roads.width))
    : inferredWidth;
  const height = Number.isFinite(Number(roads.height))
    ? Math.floor(Number(roads.height))
    : inferredHeight;
  return { width, height, types };
}

// Function: normalizeSnapshotTemple.
function normalizeSnapshotTemple(temple, state) {
  if (!temple || typeof temple !== "object") {
    return null;
  }
  const width = Number(state && state.terrain && state.terrain.width || 0);
  const height = Number(state && state.terrain && state.terrain.height || 0);
  const stage = Math.max(0, Math.floor(Number(temple.stage || 0)));
  const maxStage = Math.max(stage, Math.floor(Number(temple.maxStage || stage)));
  let site = null;
  if (
    temple.site
    && Number.isFinite(Number(temple.site.x))
    && Number.isFinite(Number(temple.site.y))
  ) {
    let x = Math.floor(Number(temple.site.x));
    let y = Math.floor(Number(temple.site.y));
    if (width > 0) {
      x = Math.max(0, Math.min(width - 1, x));
    }
    if (height > 0) {
      y = Math.max(0, Math.min(height - 1, y));
    }
    site = {
      x,
      y,
      terrainType: temple.site.terrainType || null,
    };
  }
  return {
    enabled: temple.enabled !== false,
    stage,
    maxStage,
    site,
    blockedReason: null,
    lastBuildTick: null,
    completedAtTick: Number.isFinite(Number(temple.completedAtTick))
      ? Number(temple.completedAtTick)
      : null,
    history: [],
  };
}

// Function: stripNonMapEntities.
function stripNonMapEntities(state, options = {}) {
  const includeStructures = options.includeStructures === true;
  state.nodes = [];
  if (!includeStructures && state.temple && typeof state.temple === "object") {
    state.temple.stage = 0;
    state.temple.site = null;
  }
  if (!includeStructures) {
    const keepStructures = new Set(["mine", "ruins"]);
    state.structures = Array.isArray(state.structures)
      ? state.structures.filter((structure) => keepStructures.has(structure.type))
      : [];
  } else if (!Array.isArray(state.structures)) {
    state.structures = [];
  }
  state.dwarves = [];
  state.wildlife = null;
  state.raid = null;
  state.merchant = null;
}

// Function: normalizeFrameLines.
function normalizeFrameLines(frame, height) {
  const trimmed = frame.replace(/\n$/, "");
  const lines = trimmed.length > 0 ? trimmed.split("\n") : [];
  while (lines.length < height) {
    lines.push("");
  }
  if (lines.length > height) {
    return lines.slice(0, height);
  }
  return lines;
}

// Function: parseAnsiLines.
function parseAnsiLines(lines, options) {
  const rows = [];
  const defaultColor = options.defaultColor;
  for (const line of lines) {
    const row = [];
    let currentColor = defaultColor;
    let index = 0;
    while (index < line.length) {
      const codePoint = line.codePointAt(index);
      const char = String.fromCodePoint(codePoint);
      if (char === "\x1b" && line[index + 1] === "[") {
        const end = line.indexOf("m", index + 2);
        if (end !== -1) {
          const sequence = line.slice(index + 2, end);
          currentColor = applySgr(sequence, currentColor, defaultColor);
          index = end + 1;
          continue;
        }
      }
      row.push({ char, color: currentColor });
      index += char.length;
    }
    while (row.length < options.width) {
      row.push({ char: " ", color: defaultColor });
    }
    if (row.length > options.width) {
      rows.push(row.slice(0, options.width));
    } else {
      rows.push(row);
    }
  }
  return rows;
}

// Function: applySgr.
function applySgr(sequence, currentColor, defaultColor) {
  if (!sequence) {
    return defaultColor;
  }
  const codes = sequence
    .split(";")
    .map((value) => Number(value))
    .filter(Number.isFinite);
  if (codes.length === 0) {
    return defaultColor;
  }
  let color = currentColor;
  for (let i = 0; i < codes.length; i += 1) {
    const code = codes[i];
    if (code === 0 || code === 39) {
      color = defaultColor;
      continue;
    }
    if (code === 38 && i + 1 < codes.length) {
      const mode = codes[i + 1];
      if (mode === 2 && i + 4 < codes.length) {
        color = rgbColor(codes[i + 2], codes[i + 3], codes[i + 4]);
        i += 4;
        continue;
      }
      if (mode === 5 && i + 2 < codes.length) {
        color = xtermColor(codes[i + 2]);
        i += 2;
        continue;
      }
    }
    if (code >= 30 && code <= 37) {
      color = xtermColor(code - 30);
      continue;
    }
    if (code >= 90 && code <= 97) {
      color = xtermColor(code - 90 + 8);
    }
  }
  return color;
}

// Function: rgbColor.
function rgbColor(r, g, b) {
  const clamped = (value) => Math.max(0, Math.min(255, Number(value || 0)));
  const red = clamped(r);
  const green = clamped(g);
  const blue = clamped(b);
  return { r: red, g: green, b: blue, css: `rgb(${red}, ${green}, ${blue})` };
}

// Function: xtermColor.
function xtermColor(code) {
  if (code < 0) {
    return rgbColor(255, 255, 255);
  }
  if (code < 16) {
    const entry = EXPORT_ANSI_16_PALETTE[code] || EXPORT_ANSI_16_PALETTE[7];
    return rgbColor(entry[0], entry[1], entry[2]);
  }
  if (code >= 16 && code <= 231) {
    const index = code - 16;
    const r = Math.floor(index / 36);
    const g = Math.floor((index % 36) / 6);
    const b = index % 6;
    const steps = [0, 95, 135, 175, 215, 255];
    return rgbColor(steps[r], steps[g], steps[b]);
  }
  if (code >= 232 && code <= 255) {
    const level = 8 + (code - 232) * 10;
    return rgbColor(level, level, level);
  }
  return rgbColor(255, 255, 255);
}

// Function: renderToPng.
async function renderToPng(rows, options) {
  const html = buildHtml(rows, options);
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--disable-gpu", "--disable-dev-shm-usage"],
  });
  let page;
  try {
    page = await browser.newPage();
    await page.setViewport({
      width: 800,
      height: 600,
      deviceScaleFactor: options.scale,
    });
    await page.setContent(html, { waitUntil: "load" });
    const size = await page.evaluate(() => {
      const map = document.getElementById("map");
      if (!map) {
        return null;
      }
      const rect = map.getBoundingClientRect();
      return {
        width: Math.max(1, Math.ceil(rect.width)),
        height: Math.max(1, Math.ceil(rect.height)),
      };
    });
    if (!size) {
      throw new Error("Failed to measure map size for export.");
    }
    await page.setViewport({
      width: size.width,
      height: size.height,
      deviceScaleFactor: options.scale,
    });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const metrics = await page.evaluate((columns, rows) => {
      const map = document.getElementById("map");
      if (!map) {
        return null;
      }
      const rect = map.getBoundingClientRect();
      return {
        width: Math.max(1, Math.ceil(rect.width)),
        height: Math.max(1, Math.ceil(rect.height)),
        cellWidth: rect.width / Math.max(1, columns),
        cellHeight: rect.height / Math.max(1, rows),
      };
    }, options.columns, options.rows);
    if (!metrics) {
      throw new Error("Failed to measure map metrics for export.");
    }
    const mapHandle = await page.$("#map");
    if (!mapHandle) {
      throw new Error("Failed to locate map element for export.");
    }
    const buffer = await mapHandle.screenshot({ type: "png" });
    return { buffer, metrics };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Function: renderToSvg.
function renderToSvg(rows, options) {
  const metrics = options.metrics || {};
  const fallbackCellWidth = Number(options.baseFontSize || 14) * 0.6;
  const fallbackCellHeight =
    Number(options.baseFontSize || 14) * Number(options.lineHeightRatio || 1.2);
  const cellWidth = Number.isFinite(metrics.cellWidth)
    ? metrics.cellWidth
    : fallbackCellWidth;
  const cellHeight = Number.isFinite(metrics.cellHeight)
    ? metrics.cellHeight
    : fallbackCellHeight;
  const width = Number.isFinite(metrics.width)
    ? metrics.width
    : cellWidth * Math.max(1, Number(options.columns || 0));
  const height = Number.isFinite(metrics.height)
    ? metrics.height
    : cellHeight * Math.max(1, Number(options.rows || 0));
  return buildSvg(rows, {
    width,
    height,
    cellWidth,
    cellHeight,
    baseFontSize: options.baseFontSize,
    fontFamily: options.fontFamily,
    background: options.background,
    foreground: options.foreground,
    metadata: options.metadata,
  });
}

// Function: buildSvg.
function buildSvg(rows, options) {
  const widthValue = Number(options.width || 0);
  const heightValue = Number(options.height || 0);
  const fontSize = Number(options.baseFontSize || 14);
  const cellWidth = Number(options.cellWidth || 0);
  const fallbackCellWidth = fontSize * 0.6;
  const safeCellWidth = Number.isFinite(cellWidth) && cellWidth > 0
    ? cellWidth
    : fallbackCellWidth;
  const pad = Math.max(0, Math.ceil(safeCellWidth * 0.5));
  const width = formatSvgNumber(widthValue + pad * 2);
  const height = formatSvgNumber(heightValue + pad * 2);
  const background = options.background
    ? options.background.css
    : "rgb(0, 0, 0)";
  const foreground = options.foreground
    ? options.foreground.css
    : "rgb(255, 255, 255)";
  const fontFamily = String(options.fontFamily || "monospace");
  const cellHeight = Number(options.cellHeight || fontSize);
  const style = escapeXml(
    `font-family: ${fontFamily}; font-size: ${fontSize}px; font-variant-ligatures: none; font-feature-settings: 'liga' 0; letter-spacing: 0;`,
  );
  const metadata = options.metadata
    ? `<metadata id="NodeDwarves">${escapeXml(JSON.stringify(options.metadata))}</metadata>`
    : "";
  const lines = rows.map((row, index) => {
    const y = formatSvgNumber(pad + cellHeight * (index + 1));
    const content = buildSvgLine(row, foreground);
    return `<text x="${formatSvgNumber(pad)}" y="${y}" xml:space="preserve" dominant-baseline="text-after-edge">${content}</text>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" overflow="visible">\n  <rect width="100%" height="100%" fill="${escapeXml(background)}" />\n  ${metadata}\n  <g id="map" style="${style}">\n    ${lines.join("\n    ")}\n  </g>\n</svg>\n`;
}

// Function: buildSvgLine.
function buildSvgLine(row, defaultColor) {
  if (!row || row.length === 0) {
    return "";
  }
  let output = "";
  let buffer = "";
  let current = null;
  const flush = () => {
    if (!buffer) {
      return;
    }
    const color = current && current.css ? current.css : defaultColor;
    output += `<tspan fill="${escapeXml(color)}">${escapeXml(buffer)}</tspan>`;
    buffer = "";
  };
  for (const cell of row) {
    const next = cell && cell.color ? cell.color : null;
    const char = cell ? cell.char : " ";
    if (current && next && current.css === next.css) {
      buffer += char;
      continue;
    }
    flush();
    current = next;
    buffer += char;
  }
  flush();
  return output;
}

// Function: buildHtml.
function buildHtml(rows, options) {
  const lines = rows.map((row) => buildHtmlLine(row, options.foreground.css));
  const style = `
    html, body {
      margin: 0;
      padding: 0;
      background: ${options.background.css};
    }
    #viewport {
      position: relative;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background: ${options.background.css};
    }
    #map {
      margin: 0;
      padding: 0;
      position: absolute;
      top: 0;
      left: 0;
      display: block;
      white-space: pre;
      font-family: ${options.fontFamily};
      font-size: ${options.baseFontSize}px;
      line-height: ${options.lineHeightRatio};
      color: ${options.foreground.css};
      background: ${options.background.css};
      font-variant-ligatures: none;
      font-feature-settings: \"liga\" 0;
      letter-spacing: 0;
    }
  `;
  return `<!doctype html>
<html>
  <head>
    <meta charset=\"utf-8\" />
    <style>${style}</style>
  </head>
  <body>
    <div id=\"viewport\">
      <pre id=\"map\">${lines.join("\n")}</pre>
    </div>
  </body>
</html>`;
}

// Function: buildHtmlLine.
function buildHtmlLine(row, defaultColor) {
  if (!row || row.length === 0) {
    return "";
  }
  let output = "";
  let buffer = "";
  let current = null;
  const flush = () => {
    if (!buffer) {
      return;
    }
    const color = current ? current.css : defaultColor;
    output += `<span style=\"color: ${color}\">${buffer}</span>`;
    buffer = "";
  };
  for (const cell of row) {
    const next = cell && cell.color ? cell.color : null;
    const char = cell ? cell.char : " ";
    if (current && next && current.css === next.css) {
      buffer += escapeHtml(char);
      continue;
    }
    flush();
    current = next;
    buffer += escapeHtml(char);
  }
  flush();
  return output;
}

// Function: escapeXml.
function escapeXml(value) {
  const raw = String(value);
  if (raw === "&") return "&amp;";
  if (raw === "<") return "&lt;";
  if (raw === ">") return "&gt;";
  if (raw === '"') return "&quot;";
  if (raw === "'") return "&apos;";
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Function: formatSvgNumber.
function formatSvgNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "0";
  }
  return numeric.toFixed(3).replace(/\.?0+$/, "");
}

// Function: escapeHtml.
function escapeHtml(value) {
  if (value === "&") return "&amp;";
  if (value === "<") return "&lt;";
  if (value === ">") return "&gt;";
  if (value === '"') return "&quot;";
  return value;
}

// Function: summarizeTerrain.
function summarizeTerrain(terrain) {
  if (!terrain || !terrain.types) {
    return { counts: {}, hash: "0" };
  }
  const counts = {};
  let hash = 0x811c9dc5;
  for (let y = 0; y < terrain.types.length; y += 1) {
    const row = terrain.types[y] || [];
    for (let x = 0; x < row.length; x += 1) {
      const type = String(row[x] || "");
      counts[type] = (counts[type] || 0) + 1;
      for (let i = 0; i < type.length; i += 1) {
        hash ^= type.charCodeAt(i);
        hash = Math.imul(hash, 16777619) >>> 0;
      }
      hash ^= x & 0xff;
      hash = Math.imul(hash, 16777619) >>> 0;
      hash ^= y & 0xff;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  if (Number.isFinite(terrain.seed)) {
    hash ^= terrain.seed & 0xffffffff;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return { counts, hash: hash.toString(16).padStart(8, "0") };
}

// Function: buildMetadata.
function buildMetadata(options) {
  const season = options.season || {};
  const terrain = options.terrain || {};
  const layer = options.layer || null;
  const layerDepth = Math.max(0, Math.floor(Number(layer && layer.depth || 0)));
  const layerTag = layerDepth <= 0 ? "surface" : `d${layerDepth}`;
  const configHash = hashObject({
    display: options.config.display,
    symbols: options.config.symbols,
    seasons: options.config.seasons,
  });
  const summary = options.terrainSummary || { counts: {}, hash: "0" };
  const metadata = {
    generator: "NodeDwarves map export",
    version: String(packageInfo.version || options.config.version || ""),
    generatedAt: new Date().toISOString(),
    map: {
      width: options.width,
      height: options.height,
    },
    tick: Number.isFinite(options.tick) ? options.tick : null,
    season: {
      name: season.name || null,
      index: Number.isFinite(season.index) ? season.index : null,
      globalIndex: Number.isFinite(season.globalIndex)
        ? season.globalIndex
        : null,
      tickInSeason: Number.isFinite(season.tickInSeason)
        ? season.tickInSeason
        : null,
      duration: Number.isFinite(season.duration) ? season.duration : null,
    },
    terrain: {
      seed: Number.isFinite(terrain.seed) ? terrain.seed : null,
      mode:
        options.config.display && options.config.display.terrain ? "valley" : null,
      width: Number.isFinite(terrain.width) ? terrain.width : null,
      height: Number.isFinite(terrain.height) ? terrain.height : null,
    },
    layer: {
      kind: layer && layer.kind ? String(layer.kind) : (layerDepth > 0 ? "underrealm" : "surface"),
      depth: layerDepth,
      tag: layerTag,
      label: layer && layer.label ? String(layer.label) : (layerDepth > 0 ? `Depth ${layerDepth}` : "Surface"),
    },
    terrainCounts: summary.counts,
    hashes: {
      terrain: summary.hash,
      config: configHash,
    },
    render: options.render || null,
  };
  metadata.signature = hashObject({
    map: metadata.map,
    tick: metadata.tick,
    season: metadata.season,
    terrain: metadata.terrain,
    layer: metadata.layer,
    terrainCounts: metadata.terrainCounts,
    hashes: metadata.hashes,
    render: metadata.render,
  });
  return metadata;
}

// Function: hashObject.
function hashObject(value) {
  const json = JSON.stringify(value);
  return crypto.createHash("sha256").update(json).digest("hex");
}

// Function: writeOutput.
function writeOutput(buffer, outDir, name, options) {
  const resolvedDir = path.isAbsolute(outDir)
    ? outDir
    : path.join(process.cwd(), outDir);
  const format = String(options.format || "png").toLowerCase();
  const outputDir = path.join(resolvedDir, format);
  fs.mkdirSync(outputDir, { recursive: true });
  const filenameBase = name
    ? sanitizeFilename(stripKnownExtension(String(name)))
    : buildFilenameBase(
        options.width,
        options.height,
        options.season,
        options.seed,
        options.layerTag,
      );
  const outputPath = path.join(outputDir, `${filenameBase}.${format}`);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

// Function: buildFilenameBase.
function buildFilenameBase(width, height, season, seed, layerTag) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const layerPart = layerTag ? `_${sanitizeFilename(String(layerTag))}` : "";
  return `map_${width}x${height}_${season}_${seed}${layerPart}_${stamp}`;
}

// Function: sanitizeFilename.
function sanitizeFilename(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

// Function: stripKnownExtension.
function stripKnownExtension(value) {
  const ext = path.extname(value).toLowerCase();
  if (ext === ".png" || ext === ".svg") {
    return value.slice(0, -ext.length);
  }
  return value;
}

// Function: insertTextChunk.
function insertTextChunk(pngBuffer, keyword, text) {
  const signature = pngBuffer.slice(0, 8);
  const chunks = [];
  let offset = 8;
  while (offset < pngBuffer.length) {
    const length = pngBuffer.readUInt32BE(offset);
    const type = pngBuffer.slice(offset + 4, offset + 8).toString("ascii");
    const end = offset + 12 + length;
    chunks.push({ type, start: offset, end });
    offset = end;
  }
  const insertAfter = chunks.find((chunk) => chunk.type === "IHDR");
  if (!insertAfter) {
    return pngBuffer;
  }
  const data = Buffer.from(`${keyword}\0${text}`, "utf8");
  const chunk = buildChunk("tEXt", data);
  const before = pngBuffer.slice(0, insertAfter.end);
  const after = pngBuffer.slice(insertAfter.end);
  return Buffer.concat([signature, before.slice(8), chunk, after]);
}

// Function: buildCrcTable.
function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

// Function: buildChunk.
function buildChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  const crcValue = crc32(Buffer.concat([typeBuffer, data]));
  crc.writeUInt32BE(crcValue >>> 0, 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

// Function: crc32.
function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
