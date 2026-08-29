'use strict';

/**
 * ansi — the whole of our "colour library": raw SGR escape codes.
 *
 * Colour is disabled automatically when stdout is not a TTY, when NO_COLOR is
 * set (https://no-color.org), or when the caller asks for plain output, so
 * piping repotool into a file produces clean text.
 */

const CODES = {
  reset: 0,
  bold: 1,
  dim: 2,
  italic: 3,
  underline: 4,
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  gray: 90,
  brightRed: 91,
  brightGreen: 92,
  brightYellow: 93,
  brightBlue: 94,
  brightMagenta: 95,
  brightCyan: 96,
  bgRed: 41,
  bgGreen: 42,
};

function supportsColor(stream = process.stdout) {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined) return process.env.FORCE_COLOR !== '0';
  return Boolean(stream && stream.isTTY);
}

/**
 * Build a styling helper.
 * `style.red('x')` returns the string wrapped in escape codes, or unchanged
 * when colour is off — so call sites never branch on colour support.
 */
function createStyle({ enabled = supportsColor() } = {}) {
  const style = { enabled };
  for (const [name, code] of Object.entries(CODES)) {
    style[name] = (text) => (enabled ? `\x1b[${code}m${text}\x1b[0m` : String(text));
  }
  return style;
}

/** Visible width of a string, ignoring any escape sequences inside it. */
function visibleLength(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, '').length;
}

module.exports = { createStyle, supportsColor, visibleLength, CODES };
