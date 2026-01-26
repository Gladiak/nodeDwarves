'use strict';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

function stripAnsi(value) {
  return String(value).replace(ANSI_REGEX, '');
}

function visibleLength(value) {
  return stripAnsi(value).length;
}

function sliceVisible(value, width) {
  const str = String(value);
  if (width <= 0) {
    return '';
  }

  let visible = 0;
  let result = '';

  for (let i = 0; i < str.length && visible < width; ) {
    if (str[i] === '\x1b') {
      const match = str.slice(i).match(/^\x1b\[[0-9;]*m/);
      if (match) {
        result += match[0];
        i += match[0].length;
        continue;
      }
    }

    result += str[i];
    visible += 1;
    i += 1;
  }

  return result;
}

function padRight(value, width) {
  const str = String(value);
  if (width <= 0) {
    return '';
  }
  const length = visibleLength(str);
  if (length >= width) {
    return sliceVisible(str, width);
  }
  return str + ' '.repeat(width - length);
}

module.exports = {
  clamp,
  padRight,
  sliceVisible,
  stripAnsi,
  visibleLength,
};
