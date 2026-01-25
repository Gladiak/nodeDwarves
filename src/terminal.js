'use strict';

function clearScreen() {
  process.stdout.write('\x1b[2J');
}

function moveCursorHome() {
  process.stdout.write('\x1b[H');
}

function hideCursor() {
  process.stdout.write('\x1b[?25l');
}

function showCursor() {
  process.stdout.write('\x1b[?25h');
}

module.exports = {
  clearScreen,
  moveCursorHome,
  hideCursor,
  showCursor,
};
