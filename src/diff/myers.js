'use strict';

/**
 * myers — Eugene Myers' O(ND) difference algorithm.
 *
 * Intuition: think of the two inputs as the axes of a grid. Moving right
 * deletes a line from A, moving down inserts a line from B, and moving
 * diagonally means the lines match and costs nothing. The shortest edit
 * script is then the cheapest path from (0,0) to (N,M).
 *
 * The greedy loop below walks outwards by edit distance `d`, tracking for each
 * diagonal k = x - y the furthest x it can reach with d edits. The first time
 * a diagonal reaches the bottom-right corner we have the minimal script; we
 * keep a snapshot of every step (`trace`) so we can walk backwards and turn
 * the path into concrete equal/delete/insert operations.
 */

/**
 * Trim the shared prefix and suffix before running the algorithm.
 * Real diffs are mostly common context, and this cuts the work dramatically.
 */
function trimCommonEnds(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  return { start, endA, endB };
}

/**
 * Compute the minimal edit script between two arrays.
 *
 * @param {Array} a original sequence
 * @param {Array} b updated sequence
 * @returns {Array<{type: 'equal'|'delete'|'insert', value: *, aIndex: number, bIndex: number}>}
 */
function diff(a, b) {
  const { start, endA, endB } = trimCommonEnds(a, b);
  const middle = myersMiddle(a.slice(start, endA), b.slice(start, endB), start);

  const ops = [];
  for (let i = 0; i < start; i++) ops.push({ type: 'equal', value: a[i], aIndex: i, bIndex: i });
  ops.push(...middle);
  for (let i = endA; i < a.length; i++) {
    ops.push({ type: 'equal', value: a[i], aIndex: i, bIndex: endB + (i - endA) });
  }
  return ops;
}

/** The actual Myers walk over the trimmed middle section. */
function myersMiddle(a, b, offset) {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return b.map((value, i) => ({ type: 'insert', value, aIndex: offset, bIndex: offset + i }));
  if (m === 0) return a.map((value, i) => ({ type: 'delete', value, aIndex: offset + i, bIndex: offset }));

  const max = n + m;
  // v is indexed by diagonal k, shifted by `max` so negative k fits an array.
  const v = new Int32Array(2 * max + 1);
  const trace = [];

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const index = k + max;
      // Choose the neighbouring diagonal that reached furthest: going down
      // (k+1) when we are at the left edge or it is ahead, otherwise right.
      const goDown = k === -d || (k !== d && v[index - 1] < v[index + 1]);
      let x = goDown ? v[index + 1] : v[index - 1] + 1;
      let y = x - k;

      // Follow the free diagonal for as long as the lines match.
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[index] = x;

      if (x >= n && y >= m) return backtrack(trace, a, b, d, k, offset);
    }
  }

  /* istanbul ignore next — unreachable: d = n + m always terminates above. */
  throw new Error('myers: no edit path found');
}

/** Walk the recorded traces backwards, emitting operations in forward order. */
function backtrack(trace, a, b, d, k, offset) {
  const max = a.length + b.length;
  const ops = [];
  let x = a.length;
  let y = b.length;

  for (let step = d; step > 0; step--) {
    const v = trace[step];
    const index = k + max;
    const goDown = k === -step || (k !== step && v[index - 1] < v[index + 1]);
    const prevK = goDown ? k + 1 : k - 1;
    const prevX = v[prevK + max];
    const prevY = prevX - prevK;

    // Everything above (prevX, prevY) on this diagonal was a match.
    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push({ type: 'equal', value: a[x], aIndex: offset + x, bIndex: offset + y });
    }

    if (goDown) {
      y--;
      ops.push({ type: 'insert', value: b[y], aIndex: offset + x, bIndex: offset + y });
    } else {
      x--;
      ops.push({ type: 'delete', value: a[x], aIndex: offset + x, bIndex: offset + y });
    }
    k = prevK;
  }

  // Any remaining prefix on the final diagonal is common.
  while (x > 0 && y > 0) {
    x--;
    y--;
    ops.push({ type: 'equal', value: a[x], aIndex: offset + x, bIndex: offset + y });
  }

  return ops.reverse();
}

/**
 * Split text into lines for diffing. A trailing newline terminates the last
 * line rather than starting an empty one, so we drop it — otherwise every
 * diff reports a phantom blank line at the end of the file.
 */
function splitLines(text) {
  const normalised = String(text).replace(/\r\n/g, '\n');
  if (normalised === '') return [];
  const lines = normalised.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Convenience wrapper: diff two strings line by line. */
function diffLines(textA, textB) {
  return diff(splitLines(textA), splitLines(textB));
}

/**
 * Group an edit script into unified-diff hunks with `context` lines around
 * each change, so we print the interesting parts of a big file only.
 */
function toHunks(ops, context = 3) {
  const interesting = ops
    .map((op, index) => (op.type === 'equal' ? -1 : index))
    .filter((index) => index !== -1);
  if (!interesting.length) return [];

  const hunks = [];
  let startIndex = Math.max(0, interesting[0] - context);
  let endIndex = Math.min(ops.length - 1, interesting[0] + context);

  for (const index of interesting.slice(1)) {
    if (index - context <= endIndex + 1) {
      endIndex = Math.min(ops.length - 1, index + context);
    } else {
      hunks.push(makeHunk(ops, startIndex, endIndex));
      startIndex = Math.max(0, index - context);
      endIndex = Math.min(ops.length - 1, index + context);
    }
  }
  hunks.push(makeHunk(ops, startIndex, endIndex));
  return hunks;
}

function makeHunk(ops, startIndex, endIndex) {
  const slice = ops.slice(startIndex, endIndex + 1);
  const first = slice[0];
  const aCount = slice.filter((op) => op.type !== 'insert').length;
  const bCount = slice.filter((op) => op.type !== 'delete').length;
  // A side that contributes no lines starts at 0, matching unified-diff
  // convention for created and deleted files.
  const aStart = aCount === 0 ? 0 : first.aIndex + 1;
  const bStart = bCount === 0 ? 0 : first.bIndex + 1;
  return { aStart, aCount, bStart, bCount, ops: slice };
}

/** Added/removed line counts, handy for summaries. */
function stats(ops) {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === 'insert') added++;
    else if (op.type === 'delete') removed++;
  }
  return { added, removed };
}

module.exports = { diff, diffLines, splitLines, toHunks, stats, trimCommonEnds };
