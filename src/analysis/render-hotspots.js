'use strict';

/**
 * render-hotspots — the `repotool hotspots` table.
 *
 * A hotspot is a file that keeps demanding attention: changed often, by many
 * people, with a lot of lines moving. The ranking is explained in the output
 * itself rather than left as a magic number, because a score nobody can
 * interpret is worse than no score.
 */

const { createStyle } = require('../ansi');
const format = require('../format');
const { rankHotspots, HOTSPOT_WEIGHTS } = require('./repo-model');

const DEFAULT_LIMIT = 10;

/** "commits 50% · churn 30% · authors 20%" */
function describeWeights() {
  return Object.entries(HOTSPOT_WEIGHTS)
    .map(([name, weight]) => `${name} ${Math.round(weight * 100)}%`)
    .join(' · ');
}

/**
 * @param {object} model     repo model
 * @param {object} [options]
 * @param {number} [options.limit]  rows to show (default 10)
 * @param {string} [options.sort]   score | commits | churn | authors
 * @param {boolean} [options.color]
 */
function renderHotspots(model, options = {}) {
  const style = createStyle({ enabled: options.color });
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.floor(options.limit) : DEFAULT_LIMIT;
  const sort = options.sort || 'score';

  if (model.isEmpty) {
    return style.dim('No commits yet, so no file has a history to rank.');
  }

  const ranked = rankHotspots(model, { sort });
  if (!ranked.length) {
    return style.dim('No file changes recorded — every commit in this history is empty or a merge.');
  }

  const shown = ranked.slice(0, limit);
  // Scale bars against the highest score on screen, which is not necessarily
  // the first row when the caller sorted by another column.
  const maxScore = shown.reduce((max, file) => Math.max(max, file.score), 0) || 1;

  const header = [
    style.dim('rank'),
    style.dim('score'),
    style.dim('commits'),
    style.dim('authors'),
    style.dim('churn'),
    style.dim('added/removed'),
    style.dim('file'),
  ];

  // Total churn and its breakdown are separate columns: one number per cell
  // keeps every column aligned on its own width.
  const rows = shown.map((file, index) => [
    style.dim(`${index + 1}.`),
    style.cyan(format.bar(file.score, maxScore, 8)) || style.dim('·'),
    format.count(file.commits),
    format.count(file.authorCount),
    format.count(file.churn),
    style.dim(format.churn(file.added, file.removed)),
    style.bold(file.path) + (file.binary ? style.dim(' (binary)') : ''),
  ]);

  const alignment = [
    { align: 'right' },
    { align: 'left' },
    { align: 'right' },
    { align: 'right' },
    { align: 'right' },
    { align: 'right' },
    { align: 'left' },
  ];

  const title =
    `${style.bold('repotool hotspots')} ${style.dim('—')} top ${format.count(shown.length)} of ` +
    `${format.plural(ranked.length, 'file')}`;

  const legend =
    sort === 'score'
      ? style.dim(`ranked by score (${describeWeights()}), each scaled against the busiest file`)
      : style.dim(`ranked by ${sort}`);

  return [title, legend, '', format.table([header, ...rows], alignment)].join('\n');
}

module.exports = { renderHotspots, describeWeights, DEFAULT_LIMIT };
