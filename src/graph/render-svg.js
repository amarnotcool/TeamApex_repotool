'use strict';

/**
 * render-svg — draws a laid-out DAG as an SVG document.
 *
 * This is a second renderer over the *same* layout the ASCII renderer
 * consumes: build-graph decides which lane a commit sits in and which lanes
 * its parents were routed into, and both renderers only translate that into
 * glyphs or shapes. Neither can invent structure the other does not show.
 *
 * There is no SVG library here — an SVG file is just XML text, so we build
 * the string ourselves, the same way we build ANSI output by hand.
 */

const LANE_COLORS = ['#22d3ee', '#e879f9', '#4ade80', '#facc15', '#60a5fa', '#f87171'];

/** Geometry, in user units (= px at the default scale). */
const LAYOUT = {
  rowHeight: 26,
  laneWidth: 22,
  marginX: 18,
  marginY: 22,
  radius: 5,
  labelGap: 16,
  charWidth: 7.1, // monospace advance at fontSize 12, used only for canvas width
  fontSize: 12,
};

const THEME = {
  background: '#0f172a',
  hash: '#facc15',
  author: '#67e8f9',
  subject: '#e2e8f0',
  meta: '#94a3b8',
  ref: '#4ade80',
  tag: '#facc15',
};

/** Escape the five characters that cannot appear literally in XML text. */
function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Control characters are not legal XML 1.0 content at all; commit
    // subjects come from user input, so strip them rather than emit a
    // document no parser will accept.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function laneColor(lane) {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

/** Round to two decimals: keeps the markup readable and runs byte-identical. */
function n(value) {
  return Math.round(value * 100) / 100;
}

function centerX(lane) {
  return LAYOUT.marginX + lane * LAYOUT.laneWidth;
}

function centerY(rowIndex) {
  return LAYOUT.marginY + rowIndex * LAYOUT.rowHeight;
}

/**
 * The path from a commit down to one of its parents.
 *
 * A parent in the same lane is a straight drop. A parent in another lane
 * leaves the commit vertically, then curves into the parent's column — the
 * smooth equivalent of the ASCII renderer's `\` and `/` connectors.
 */
function edgePath(from, to) {
  if (from.lane === to.lane) {
    return `M ${n(from.x)} ${n(from.y)} L ${n(to.x)} ${n(to.y)}`;
  }
  const bendY = to.y - LAYOUT.rowHeight / 2;
  return (
    `M ${n(from.x)} ${n(from.y)} ` +
    `L ${n(from.x)} ${n(Math.min(bendY, to.y))} ` +
    `Q ${n(from.x)} ${n(to.y)} ${n(to.x)} ${n(to.y)}`
  );
}

/** Node shape: merges are diamonds, roots are hollow, everything else solid. */
function nodeShape(commit, x, y, color) {
  const r = LAYOUT.radius;
  if (commit.isMerge) {
    const points = [`${n(x)},${n(y - r)}`, `${n(x + r)},${n(y)}`, `${n(x)},${n(y + r)}`, `${n(x - r)},${n(y)}`];
    return `<polygon class="node merge" points="${points.join(' ')}" fill="${color}" />`;
  }
  if (commit.isRoot) {
    return `<circle class="node root" cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${THEME.background}" stroke="${color}" stroke-width="2" />`;
  }
  return `<circle class="node commit" cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${color}" />`;
}

/** "(HEAD -> main, v1.0)" as one tspan per ref, coloured like the ASCII one. */
function refSpans(commit) {
  if (!commit.refs || !commit.refs.length) return '';
  const painted = commit.refs
    .map((ref) => `<tspan fill="${ref.startsWith('tag: ') ? THEME.tag : THEME.ref}">${escapeXml(ref)}</tspan>`)
    .join(`<tspan fill="${THEME.meta}">, </tspan>`);
  return ` <tspan fill="${THEME.meta}">(</tspan>${painted}<tspan fill="${THEME.meta}">)</tspan>`;
}

/** Plain-text form of a row's label, used only to size the canvas. */
function labelText(commit, showDates) {
  const refs = commit.refs && commit.refs.length ? ` (${commit.refs.join(', ')})` : '';
  const date = showDates ? ` ${String(commit.authorDate || '').slice(0, 10)}` : '';
  return `${commit.shortHash}${date} ${commit.authorName}${refs} ${commit.subject}`;
}

/**
 * Render a built graph as a standalone SVG document.
 *
 * @param {{rows: Array, width: number}} graph output of buildGraph
 * @param {object} [options]
 * @param {boolean} [options.dates] show author dates (default true)
 * @param {string} [options.title]  document title
 * @returns {string} an SVG document, ready to write to a file
 */
function renderSvg(graph, options = {}) {
  const showDates = options.dates !== false;
  const rows = graph.rows || [];

  // Where each commit ended up, so a parent edge knows what to aim at.
  const placement = new Map();
  rows.forEach((row, index) => {
    placement.set(row.commit.hash, { lane: row.lane, x: centerX(row.lane), y: centerY(index), index });
  });

  const laneCount = Math.max(graph.width || 1, 1);
  const gutter = LAYOUT.marginX + (laneCount - 1) * LAYOUT.laneWidth + LAYOUT.labelGap;
  const longestLabel = rows.reduce((max, row) => Math.max(max, labelText(row.commit, showDates).length), 0);
  const width = Math.ceil(gutter + longestLabel * LAYOUT.charWidth + LAYOUT.marginX);
  const height = Math.ceil(LAYOUT.marginY * 2 + Math.max(rows.length - 1, 0) * LAYOUT.rowHeight);

  const edges = [];
  const nodes = [];
  const labels = [];

  rows.forEach((row, index) => {
    const { commit } = row;
    const from = { lane: row.lane, x: centerX(row.lane), y: centerY(index) };

    commit.parents.forEach((parentHash, parentIndex) => {
      const target = placement.get(parentHash);
      // A parent outside the loaded history (shallow clone, or --limit) has
      // no row to point at: draw a short dashed stub so the line is visibly
      // cut off rather than silently dropped.
      const routedLane = row.parentLanes[parentIndex];
      const lane = target ? target.lane : routedLane === undefined ? row.lane : routedLane;
      const to = target
        ? { lane: target.lane, x: target.x, y: target.y }
        : { lane, x: centerX(lane), y: from.y + LAYOUT.rowHeight * 0.6 };
      const dashed = target ? '' : ' stroke-dasharray="3 3"';
      edges.push(
        `<path class="edge" d="${edgePath(from, to)}" fill="none" stroke="${laneColor(lane)}" stroke-width="1.6"${dashed} />`,
      );
    });

    nodes.push(nodeShape(commit, from.x, from.y, laneColor(row.lane)));

    const date = showDates
      ? `<tspan fill="${THEME.meta}"> ${escapeXml(String(commit.authorDate || '').slice(0, 10))}</tspan>`
      : '';
    labels.push(
      `<text class="label" x="${n(gutter)}" y="${n(from.y + 4)}" fill="${THEME.subject}">` +
        `<tspan fill="${THEME.hash}">${escapeXml(commit.shortHash)}</tspan>${date}` +
        `<tspan fill="${THEME.author}"> ${escapeXml(commit.authorName)}</tspan>` +
        `${refSpans(commit)} ${escapeXml(commit.subject)}</text>`,
    );
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${LAYOUT.fontSize}">`,
    `<title>${escapeXml(options.title || 'repotool graph')}</title>`,
    `<rect class="background" x="0" y="0" width="${width}" height="${height}" fill="${THEME.background}" />`,
    '<g class="edges">',
    ...edges,
    '</g>',
    '<g class="nodes">',
    ...nodes,
    '</g>',
    '<g class="labels">',
    ...labels,
    '</g>',
    '</svg>',
    '',
  ].join('\n');
}

module.exports = { renderSvg, escapeXml, LAYOUT, LANE_COLORS, THEME };
