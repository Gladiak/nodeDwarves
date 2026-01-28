'use strict';

// Function: buildRuntime.
function buildRuntime(display, terminal) {
  let hudEnabled = Boolean(display.hud && display.hud.enabled);
  const hudWidth = hudEnabled ? Number(display.hud.width || 0) : 0;
  const hudColumns = hudEnabled ? Number(display.hud.columns || 1) : 1;
  const hudColumnGap = hudEnabled ? Number(display.hud.columnGap || 2) : 2;
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

  let gridWidth = totalWidth;
  let gridHeight = Math.max(0, totalHeight - headerHeight - footerHeight - frameHeight);

  if (hudEnabled && gridWidth > hudWidth + 3 + frameWidth) {
    gridWidth = gridWidth - (hudWidth + 3 + frameWidth);
  } else {
    hudEnabled = false;
  }

  if (!hudEnabled) {
    gridWidth = gridWidth - frameWidth;
  }

  if (frameEnabled && (gridWidth <= 0 || gridHeight <= 0)) {
    frameEnabled = false;
    frameWidth = 0;
    frameHeight = 0;
    gridWidth = totalWidth;
    gridHeight = Math.max(0, totalHeight - headerHeight - footerHeight);
    if (hudEnabled && gridWidth > hudWidth + 3) {
      gridWidth = gridWidth - (hudWidth + 3);
    } else {
      hudEnabled = false;
    }
  }

  return {
    gridWidth,
    gridHeight,
    headerHeight,
    footerHeight,
    hudEnabled,
    hudWidth,
    hudColumns,
    hudColumnGap,
    frameEnabled,
    frameWidth,
    frameHeight,
    totalWidth,
    totalHeight,
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

module.exports = { buildRuntime, getTerminalSize, setupResizeHandler };
