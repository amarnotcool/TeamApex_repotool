'use strict';

/**
 * render-ascii — draws a laid-out DAG as terminal art.
 *
 * Each commit produces two lines:
 *
 *   * | |  a1b2c3d  (main) Add parser        <- the node row
 *   |\| |                                    <- the transition row
 *
 * The node row shows every lane that is alive above the commit. The
 * transition row explains how those lanes turn into the lanes alive below it:
 * a lane that simply continues is `|`, a lane opening to the right is `\`, and
 * a lane collapsing to the left (a branch rejoining) is `/`.
 */

const { createStyle, visibleLength } = require('../ansi');

const LANE_COLORS = ['brightCyan', 'brightMagenta', 'brightGreen', 'brightYellow', 'brightBlue', 'brightRed'];

/** Two columns per lane keeps room for the diagonal connectors. */
const LANE_WIDTH = 2;

function laneColor(style, lane) {
  return style[LANE_COLORS[lane % LANE_COLORS.length]];
}

/** Blank canvas wide enough for `laneCount` lanes. */
function blankRow(laneCount) {
  return new Array(Math.max(laneCount, 1) * LANE_WIDTH).fill(' ');
}

function draw(cells, index, char) {
  if (index >= 0 && index < cells.length) cells[index] = char;
}

/** The row carrying the commit node itself. */
function nodeRow(row, style) {
  const cells = blankRow(Math.max(row.lanesBefore.length, row.lane + 1));
  row.lanesBefore.forEach((hash, lane) => {
    if (hash) draw(cells, lane * LANE_WIDTH, laneColor(style, lane)('|'));
  });
  const glyph = row.commit.isMerge ? 'M' : row.commit.isRoot ? 'o' : '*';
  draw(cells, row.lane * LANE_WIDTH, laneColor(style, row.lane)(glyph));
  return cells.join('');
}

/**
 * The row between this commit and the next.
 *
 * Three things can happen to a lane here, and each has one glyph:
 *   `|`  the lane simply continues into the next row
 *   `\`  a merge opened a new lane to the right of the commit
 *   `/`  the commit's lane collapsed into a lane further left
 *
 * A diagonal only spans one column. When a parent lands more than one lane
 * away we bridge the gap with `_`, the way git does for long jumps, so the
 * connection stays readable instead of pointing at the wrong column.
 */
function transitionRow(row, style) {
  const laneCount = Math.max(
    row.lanesBefore.length,
    row.lanesAfter.length,
    ...row.parentLanes.map((lane) => lane + 1),
    1,
  );
  const cells = blankRow(laneCount);

  // Lanes a merge opened on this very row are drawn by their diagonal, not by
  // a vertical bar — otherwise the row reads as `|\|` instead of `|\`.
  const openedHere = new Set(
    row.parentLanes.filter((lane, index) => index > 0 && !row.lanesBefore[lane]),
  );

  row.lanesAfter.forEach((hash, lane) => {
    if (hash && !openedHere.has(lane)) draw(cells, lane * LANE_WIDTH, laneColor(style, lane)('|'));
  });

  // Route each parent from the commit's lane into the lane it landed in.
  for (const parentLane of row.parentLanes) {
    if (parentLane === row.lane) continue;
    const color = laneColor(style, parentLane);

    if (parentLane > row.lane) {
      // Opens to the right: the second parent of a merge. A lane further out
      // than the neighbouring one gets a second diagonal at its arrival
      // column, leaving the lanes in between untouched.
      draw(cells, row.lane * LANE_WIDTH + 1, color('\\'));
      if (parentLane > row.lane + 1) draw(cells, parentLane * LANE_WIDTH - 1, color('\\'));
    } else {
      // Collapses to the left: this branch rejoins an existing lane. The
      // horizontal run passes over any lanes in between without erasing them.
      draw(cells, row.lane * LANE_WIDTH - 1, color('/'));
      for (let column = parentLane * LANE_WIDTH + 1; column < row.lane * LANE_WIDTH - 1; column++) {
        if (cells[column] === ' ') draw(cells, column, color('_'));
      }
    }
  }

  return cells.join('').replace(/\s+$/, '');
}

/** "(HEAD -> main, origin/main)" style annotation for a commit's refs. */
function refLabel(commit, style) {
  if (!commit.refs.length) return '';
  const painted = commit.refs.map((ref) =>
    ref.startsWith('tag: ') ? style.brightYellow(ref) : style.brightGreen(ref),
  );
  return ` ${style.dim('(')}${painted.join(style.dim(', '))}${style.dim(')')}`;
}

function shortDate(commit) {
  return String(commit.authorDate || '').slice(0, 10);
}

/**
 * Render a built graph.
 *
 * @param {{rows: Array, width: number}} graph output of buildGraph
 * @param {object} [options]
 * @param {boolean} [options.color]   force colour on/off
 * @param {boolean} [options.dates]   show author dates (default true)
 * @param {number} [options.maxWidth] wrap/trim subject lines to this width
 */
function renderAscii(graph, options = {}) {
  const style = createStyle({ enabled: options.color });
  const showDates = options.dates !== false;
  const maxWidth = options.maxWidth || process.stdout.columns || 100;

  const lines = [];
  const gutter = Math.max(graph.width, 1) * LANE_WIDTH;

  for (const row of graph.rows) {
    const { commit } = row;
    const graphCells = nodeRow(row, style);
    const pad = ' '.repeat(Math.max(1, gutter - visibleLength(graphCells) + 1));

    const meta = [
      style.brightYellow(commit.shortHash),
      showDates ? style.dim(shortDate(commit)) : null,
      style.cyan(commit.authorName),
    ]
      .filter(Boolean)
      .join(' ');

    let text = `${graphCells}${pad}${meta}${refLabel(commit, style)} ${commit.subject}`;
    if (visibleLength(text) > maxWidth) {
      // Trim on the visible text only; escape codes must stay intact.
      const overflow = visibleLength(text) - maxWidth + 1;
      text = text.slice(0, text.length - overflow) + style.dim('…');
    }
    lines.push(text);

    const connector = transitionRow(row, style);
    if (connector.trim()) lines.push(connector);
  }

  return lines.join('\n');
}

module.exports = { renderAscii, transitionRow, nodeRow, LANE_WIDTH };
