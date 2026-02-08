'use strict';

// Clamp a number between min and max bounds.
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// Resolve a top-right map inset rectangle from display config.
function resolveMapInsetRect(display, gridWidth, gridHeight) {
  const insetConfig = display && display.mapInset ? display.mapInset : null;
  if (!insetConfig || insetConfig.enabled === false) {
    return null;
  }
  if (gridWidth <= 0 || gridHeight <= 0) {
    return null;
  }

  const marginTop = Math.max(0, Math.floor(Number(insetConfig.marginTop ?? 1)));
  const marginRight = Math.max(0, Math.floor(Number(insetConfig.marginRight ?? 1)));
  const maxWidth = Math.max(0, gridWidth - marginRight);
  const maxHeight = Math.max(0, gridHeight - marginTop);
  if (maxWidth < 24 || maxHeight < 6) {
    return null;
  }

  const targetWidth = Math.max(24, Math.floor(Number(insetConfig.width || 50)));
  const targetHeight = Math.max(6, Math.floor(Number(insetConfig.height || 7)));
  const width = clamp(targetWidth, 24, maxWidth);
  const height = clamp(targetHeight, 6, maxHeight);
  const x = clamp(gridWidth - marginRight - width, 0, Math.max(0, gridWidth - width));
  const y = clamp(marginTop, 0, Math.max(0, gridHeight - height));

  return {
    x,
    y,
    width,
    height,
    title: String(insetConfig.title || 'ᚦ NodeDwarves ᛞ'),
    reserveSimulationSpace: insetConfig.reserveSimulationSpace !== false,
  };
}

// Check whether a map coordinate falls inside the runtime inset rectangle.
function isMapInsetCell(runtime, x, y) {
  const inset = runtime && runtime.mapInset;
  if (!inset) {
    return false;
  }
  const px = Math.floor(Number(x));
  const py = Math.floor(Number(y));
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    return false;
  }
  return px >= inset.x
    && py >= inset.y
    && px < inset.x + inset.width
    && py < inset.y + inset.height;
}

// Compute effective playable cell count after runtime carving.
function getPlayableGridArea(runtime) {
  const width = Math.max(0, Number(runtime && runtime.gridWidth || 0));
  const height = Math.max(0, Number(runtime && runtime.gridHeight || 0));
  const total = width * height;
  if (total <= 0) {
    return 0;
  }
  const inset = runtime && runtime.mapInset;
  if (!inset || inset.reserveSimulationSpace === false) {
    return total;
  }
  const carved = Math.max(0, Number(inset.width || 0)) * Math.max(0, Number(inset.height || 0));
  return Math.max(0, total - carved);
}

// Function: buildRuntime.
function buildRuntime(display, terminal) {
  let frameEnabled = Boolean(display.frame && display.frame.enabled);
  let frameWidth = frameEnabled ? 2 : 0;
  let frameHeight = frameEnabled ? 2 : 0;
  const headerHeight = display.header && display.header.enabled
    ? Math.max(0, Number(display.header.height || 2))
    : 0;
  const footerHeight = display.footer && display.footer.enabled
    ? Math.max(0, Number(display.footer.height || 0))
    : 0;
  const fallbackWidth = Number(display.width || 80);
  const fallbackHeight = Number(display.height || 24);
  let totalWidth = fallbackWidth;
  let totalHeight = fallbackHeight;

  if (display.autoSize) {
    const columns = Number((terminal && terminal.columns) || fallbackWidth);
    const rows = Number((terminal && terminal.rows) || fallbackHeight);
    const maxWidth = Number(display.maxWidth || fallbackWidth);
    const maxHeight = Number(display.maxHeight || fallbackHeight);

    totalWidth = Math.min(columns, maxWidth);
    totalHeight = Math.min(rows, maxHeight);
  }

  let gridWidth = totalWidth - frameWidth;
  let gridHeight = Math.max(0, totalHeight - headerHeight - footerHeight - frameHeight);

  if (frameEnabled && (gridWidth <= 0 || gridHeight <= 0)) {
    frameEnabled = false;
    frameWidth = 0;
    frameHeight = 0;
    gridWidth = totalWidth;
    gridHeight = Math.max(0, totalHeight - headerHeight - footerHeight);
  }

  const mapInset = resolveMapInsetRect(display, gridWidth, gridHeight);
  const playableArea = getPlayableGridArea({
    gridWidth,
    gridHeight,
    mapInset,
  });

  return {
    gridWidth,
    gridHeight,
    playableArea,
    headerHeight,
    footerHeight,
    frameEnabled,
    frameWidth,
    frameHeight,
    totalWidth,
    totalHeight,
    mapInset,
  };
}

// Function: getTerminalSize.
function getTerminalSize(display) {
  const fallback = {
    columns: Number(display.width || 80),
    rows: Number(display.height || 24),
  };

  if (!process.stdout || !process.stdout.isTTY) {
    return fallback;
  }

  const columns = Number(process.stdout.columns || fallback.columns);
  const rowsRaw = Number(process.stdout.rows || fallback.rows);
  // Reserve one row to avoid scrolling when rendering frames.
  const rows = rowsRaw > 1 ? rowsRaw - 1 : rowsRaw;

  return { columns, rows };
}

// Function: setupResizeHandler.
function setupResizeHandler(display, onResize) {
  if (!process.stdout || !process.stdout.isTTY) {
    return;
  }

  process.stdout.on('resize', () => {
    if (typeof onResize === 'function') {
      onResize(display);
    }
  });
}

module.exports = {
  buildRuntime,
  getTerminalSize,
  setupResizeHandler,
  resolveMapInsetRect,
  isMapInsetCell,
  getPlayableGridArea,
};
