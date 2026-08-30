'use strict';

/**
 * render-diff — unified-diff output, coloured with raw ANSI codes.
 *
 * Input is the edit script from myers.js; this file only decides how it looks.
 *
 * On top of the usual whole-line colouring, a line that was *edited* rather
 * than replaced gets a second look: we run the same Myers algorithm again,
 * this time over the two lines' characters, and brighten only the span that
 * actually differs. Everything else on the line stays in the ordinary +/-
 * colour, so the eye lands on the change instead of re-reading the line.
 */

const { createStyle, CODES } = require('../ansi');
const { diff, toHunks, stats } = require('./myers');

const MARKS = { equal: ' ', insert: '+', delete: '-' };

/**
 * Below this share of characters in common, two lines are different lines
 * that happen to sit next to each other, not an edit of one into the other —
 * highlighting them character by character produces confetti, not meaning.
 */
const SIMILARITY_THRESHOLD = 0.3;

/**
 * Character-level diffing is O(ND); a pair of very long lines (minified
 * bundles, embedded data) is not worth the time or the unreadable result.
 */
const MAX_INTRALINE_LENGTH = 1000;

/**
 * Two lines can share plenty of characters and still be a rewrite — a line of
 * code re-expressed keeps its punctuation and indentation, so the character
 * diff comes back as a dozen scattered fragments. Highlighting those is
 * confetti; past this many separate changed runs on either side, or when the
 * runs average shorter than a couple of characters each, we fall back to plain
 * whole-line colouring.
 */
const MAX_CHANGED_RUNS = 3;
const MIN_AVERAGE_RUN = 2;

/** SGR sequence from a list of codes, e.g. paint(1, 4, 31). */
function paint(...codes) {
  return `\x1b[${codes.join(';')}m`;
}

const RESET = '\x1b[0m';

/**
 * Split a character-level edit script into runs, tagged as changed or not,
 * for one side of the pair.
 *
 * @param {Array} ops    character-level edit script
 * @param {'delete'|'insert'} side which side's characters to keep
 * @returns {Array<{text: string, changed: boolean}>}
 */
function spansFor(ops, side) {
  const spans = [];
  for (const op of ops) {
    if (op.type !== 'equal' && op.type !== side) continue;
    const changed = op.type === side;
    const last = spans[spans.length - 1];
    if (last && last.changed === changed) last.text += op.value;
    else spans.push({ text: op.value, changed });
  }
  return spans;
}

/** How much of the longer line the two lines have in common, 0..1. */
function similarity(ops, aLength, bLength) {
  const common = ops.reduce((sum, op) => (op.type === 'equal' ? sum + 1 : sum), 0);
  const longest = Math.max(aLength, bLength);
  return longest === 0 ? 1 : common / longest;
}

/**
 * Compare two lines character by character.
 *
 * @returns {{spans: {delete: Array, insert: Array}}|null} null when the lines
 *   are too different (or too long) for character-level detail to help.
 */
function intraLineSpans(before, after) {
  if (before === after) return null;
  if (before.length > MAX_INTRALINE_LENGTH || after.length > MAX_INTRALINE_LENGTH) return null;
  if (!before.length || !after.length) return null;

  const ops = diff([...before], [...after]);
  if (similarity(ops, before.length, after.length) < SIMILARITY_THRESHOLD) return null;

  const spans = { delete: spansFor(ops, 'delete'), insert: spansFor(ops, 'insert') };
  const changed = (side) => spans[side].filter((span) => span.changed);
  for (const side of ['delete', 'insert']) {
    const runs = changed(side);
    if (runs.length > MAX_CHANGED_RUNS) return null;
    const characters = runs.reduce((sum, span) => sum + span.text.length, 0);
    // Single characters scattered through a line (`try` against `if (!x)`) share
    // letters by accident, not by edit.
    if (runs.length > 1 && characters / runs.length < MIN_AVERAGE_RUN) return null;
  }

  return spans;
}

/** Render one side of a paired change, with the changed span picked out. */
function paintSpans(mark, spans, lineCode, accentCodes) {
  const body = spans
    .map((span) =>
      span.changed
        ? `${paint(...accentCodes, lineCode)}${span.text}${RESET}`
        : `${paint(lineCode)}${span.text}${RESET}`,
    )
    .join('');
  return `${paint(lineCode)}${mark}${RESET}${body}`;
}

/**
 * Find the delete-run / insert-run pairs inside one hunk.
 *
 * A `-` block immediately followed by a `+` block is git's own signal that
 * lines were edited; we pair them positionally and only where both runs have
 * a line at that offset. Lines with no partner stay whole-line coloured.
 *
 * @returns {Map<number, number>} index of a delete op -> index of its insert
 */
function pairChangedLines(ops) {
  const pairs = new Map();

  for (let i = 0; i < ops.length; ) {
    if (ops[i].type !== 'delete') {
      i++;
      continue;
    }
    let deleteEnd = i;
    while (deleteEnd < ops.length && ops[deleteEnd].type === 'delete') deleteEnd++;
    let insertEnd = deleteEnd;
    while (insertEnd < ops.length && ops[insertEnd].type === 'insert') insertEnd++;

    const pairCount = Math.min(deleteEnd - i, insertEnd - deleteEnd);
    for (let offset = 0; offset < pairCount; offset++) {
      pairs.set(i + offset, deleteEnd + offset);
    }
    i = insertEnd > deleteEnd ? insertEnd : deleteEnd;
  }

  return pairs;
}

/** Render one file's edit script as a unified diff body. */
function renderFileDiff(ops, options = {}) {
  const style = createStyle({ enabled: options.color });
  const context = options.context === undefined ? 3 : options.context;
  const hunks = toHunks(ops, context);
  const lines = [];

  for (const hunk of hunks) {
    lines.push(style.brightCyan(`@@ -${hunk.aStart},${hunk.aCount} +${hunk.bStart},${hunk.bCount} @@`));

    // Character-level highlighting is a colour effect; with colour off there
    // is nothing to show it with, so we skip the work entirely.
    const pairs = style.enabled ? pairChangedLines(hunk.ops) : new Map();
    const highlighted = new Map();
    for (const [deleteIndex, insertIndex] of pairs) {
      const spans = intraLineSpans(String(hunk.ops[deleteIndex].value), String(hunk.ops[insertIndex].value));
      if (!spans) continue;
      highlighted.set(deleteIndex, paintSpans('-', spans.delete, CODES.red, [CODES.bold, CODES.underline]));
      highlighted.set(insertIndex, paintSpans('+', spans.insert, CODES.green, [CODES.bold, CODES.underline]));
    }

    hunk.ops.forEach((op, index) => {
      if (highlighted.has(index)) {
        lines.push(highlighted.get(index));
        return;
      }
      const text = `${MARKS[op.type]}${op.value}`;
      if (op.type === 'insert') lines.push(style.green(text));
      else if (op.type === 'delete') lines.push(style.red(text));
      else lines.push(style.dim(text));
    });
  }

  return lines.join('\n');
}

/** Header shown above each changed file. */
function renderFileHeader(path, status, ops, options = {}) {
  const style = createStyle({ enabled: options.color });
  const { added, removed } = stats(ops);
  const label = { A: 'added', D: 'deleted', M: 'modified', R: 'renamed' }[status] || 'changed';
  return [
    style.bold(`${path}`),
    `${style.dim(label)}  ${style.green(`+${added}`)} ${style.red(`-${removed}`)}`,
  ].join('  ');
}

/** Stand-in header for binary content, which we never try to line-diff. */
function renderBinaryFile(path, status, options = {}) {
  const style = createStyle({ enabled: options.color });
  const label = { A: 'added', D: 'deleted' }[status] || 'changed';
  return `${style.bold(path)}  ${style.dim(`binary, ${label} — contents not compared`)}`;
}

/** Bottom-line summary across every file in the diff. */
function renderSummary(fileCount, totals, options = {}) {
  const style = createStyle({ enabled: options.color });
  return style.dim(
    `${fileCount} file(s) changed, ${totals.added} insertion(s)(+), ${totals.removed} deletion(s)(-)`,
  );
}

module.exports = {
  renderFileDiff,
  renderFileHeader,
  renderBinaryFile,
  renderSummary,
  intraLineSpans,
  pairChangedLines,
  SIMILARITY_THRESHOLD,
  MAX_CHANGED_RUNS,
  MIN_AVERAGE_RUN,
};
