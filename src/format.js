'use strict';

/**
 * format — the small presentation helpers the reports need.
 *
 * Column alignment, thousands separators, bar charts and relative dates are
 * exactly the jobs people reach for cli-table3, numeral and date-fns to do.
 * None of them is hard; the only real subtlety is that padding must measure
 * *visible* width, because a coloured string carries escape sequences that
 * take no space on screen.
 */

const { visibleLength } = require('./ansi');

/** Pad to `width`, measuring the string as the terminal sees it. */
function padEnd(text, width) {
  const padding = Math.max(0, width - visibleLength(text));
  return `${text}${' '.repeat(padding)}`;
}

function padStart(text, width) {
  const padding = Math.max(0, width - visibleLength(text));
  return `${' '.repeat(padding)}${text}`;
}

/** 1234567 -> "1,234,567". Grouping only; no locale guessing. */
function count(value) {
  const rounded = Math.round(Number(value) || 0);
  return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Signed line counts, e.g. "+120 / -45". */
function churn(added, removed) {
  return `+${count(added)} / -${count(removed)}`;
}

/** A ratio as a whole percentage: 0.334 -> "33%". */
function percent(ratio) {
  if (!Number.isFinite(ratio)) return '—';
  return `${Math.round(ratio * 100)}%`;
}

/** "1.0", "12.4", "3.75x" style numbers, trimmed of pointless zeros. */
function decimal(value, places = 1) {
  if (!Number.isFinite(value)) return '—';
  return Number(value.toFixed(places)).toString();
}

/** Pluralise a noun against a count: plural(1, 'commit') -> "1 commit". */
function plural(value, noun, suffix = 's') {
  return `${count(value)} ${noun}${Math.round(value) === 1 ? '' : suffix}`;
}

const BAR_FULL = '█';

/** A proportional bar, `width` characters at the maximum value. */
function bar(value, max, width = 20) {
  if (!max || !Number.isFinite(value) || value <= 0) return '';
  const filled = Math.max(1, Math.round((value / max) * width));
  return BAR_FULL.repeat(Math.min(filled, width));
}

/** Whole days as a readable span: 0.4 -> "today", 1 -> "1 day", 45 -> "45 days". */
function days(value) {
  if (!Number.isFinite(value) || value < 1) return 'under a day';
  const whole = Math.round(value);
  return `${count(whole)} day${whole === 1 ? '' : 's'}`;
}

/** "3 days ago" / "just now", from an ISO date. */
function relativeDate(iso, now = Date.now()) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'unknown';

  const seconds = Math.max(0, (now - then) / 1000);
  const scales = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [30, 'day'],
    [12, 'month'],
    [Number.POSITIVE_INFINITY, 'year'],
  ];

  let value = seconds;
  for (const [step, unit] of scales) {
    if (value < step) {
      const whole = Math.floor(value);
      if (unit === 'second' && whole < 5) return 'just now';
      return `${whole} ${unit}${whole === 1 ? '' : 's'} ago`;
    }
    value /= step;
  }
  return 'a long time ago';
}

/** Just the date part of an ISO timestamp. */
function isoDate(iso) {
  return String(iso || '').slice(0, 10) || 'unknown';
}

/**
 * Render aligned columns.
 *
 * @param {Array<Array<string>>} rows
 * @param {Array<{align?: 'left'|'right'}>} [columns] per-column options
 * @param {string} [gap] separator between columns
 */
function table(rows, columns = [], gap = '  ') {
  if (!rows.length) return '';
  const widths = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] || 0, visibleLength(String(cell)));
    });
  }

  return rows
    .map((row) =>
      row
        .map((cell, index) => {
          const text = String(cell);
          // The last column never needs padding; trailing spaces are noise.
          if (index === row.length - 1) return text;
          return (columns[index] && columns[index].align === 'right' ? padStart : padEnd)(text, widths[index]);
        })
        .join(gap)
        .replace(/\s+$/, ''),
    )
    .join('\n');
}

/** A section heading, dimmed and underlined by a rule of the same width. */
function heading(text, style) {
  return `${style.bold(text)}\n${style.dim('─'.repeat(visibleLength(text)))}`;
}

module.exports = {
  padEnd,
  padStart,
  count,
  churn,
  percent,
  decimal,
  plural,
  bar,
  days,
  relativeDate,
  isoDate,
  table,
  heading,
};
