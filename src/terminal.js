'use strict';

// Function: clearScreen.
function clearScreen() {
  process.stdout.write('\x1b[2J');
}

// Function: moveCursorHome.
function moveCursorHome() {
  process.stdout.write('\x1b[H');
}

// Function: hideCursor.
function hideCursor() {
  process.stdout.write('\x1b[?25l');
}

// Function: showCursor.
function showCursor() {
  process.stdout.write('\x1b[?25h');
}

module.exports = {
  clearScreen,
  moveCursorHome,
  hideCursor,
  showCursor,
};
