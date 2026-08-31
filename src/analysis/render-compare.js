'use strict';

/**
 * render-compare — the `repotool compare <A> <B>` report.
 *
 * Two columns, one per side, so "ahead" and "behind" are read off the same
 * row rather than inferred from two paragraphs. Everything shown comes from
 * compare.js, which is itself the shared model applied to a commit range.
 */

const { createStyle } = require('../ansi');
const format = require('../format');
const { compareRefs } = require('./compare');

const TOP_N = 3;

/** "3 commits" / "—" for an empty side. */
function orDash(text, empty, style) {
  return empty ? style.dim('—') : text;
}

/** "Ada (12), Grace (3)" for a list of { name, commits }. */
function names(list, style) {
  if (!list.length) return style.dim('—');
  return list.map((author) => `${author.name} ${style.dim(`(${author.commits})`)}`).join(', ');
}

/**
 * Render the comparison.
 *
 * @param {string} refA
 * @param {string} refB
 * @param {object} [options] { cwd, color }
 */
function renderCompare(refA, refB, options = {}) {
  const style = createStyle({ enabled: options.color });
  const result = compareRefs(refA, refB, { cwd: options.cwd });
  const { a, b } = result;

  const title =
    `${style.bold('repotool compare')} ${style.dim('—')} ` +
    `${style.brightCyan(refA)} ${style.dim('vs')} ${style.brightCyan(refB)}`;

  if (result.identical) {
    return [
      title,
      '',
      style.dim(`Both refs are the same commit (${result.hashA.slice(0, 7)}) — nothing to compare.`),
    ].join('\n');
  }

  const sections = [title, ''];

  if (!result.mergeBase) {
    sections.push(style.brightYellow('These refs share no history: every commit below is unique to its side.'));
    sections.push('');
  }

  const rows = [
    [style.dim(''), style.bold(refA), style.bold(refB)],
    [
      style.dim('commits ahead'),
      orDash(format.count(a.commits), a.commits === 0, style),
      orDash(format.count(b.commits), b.commits === 0, style),
    ],
    [
      style.dim('merges'),
      orDash(format.count(a.merges), a.merges === 0, style),
      orDash(format.count(b.merges), b.merges === 0, style),
    ],
    [
      style.dim('files changed'),
      orDash(format.count(a.filesChanged), a.filesChanged === 0, style),
      orDash(format.count(b.filesChanged), b.filesChanged === 0, style),
    ],
    [
      style.dim('churn'),
      orDash(`${format.count(a.churn)} ${style.dim(format.churn(a.added, a.removed))}`, a.churn === 0, style),
      orDash(`${format.count(b.churn)} ${style.dim(format.churn(b.added, b.removed))}`, b.churn === 0, style),
    ],
    [
      style.dim('contributors'),
      orDash(format.count(a.contributors.length), a.contributors.length === 0, style),
      orDash(format.count(b.contributors.length), b.contributors.length === 0, style),
    ],
  ];

  sections.push(format.table(rows, [{ align: 'left' }, { align: 'right' }, { align: 'right' }], '   '));

  sections.push('');
  sections.push(
    `${style.dim('only on')} ${style.bold(refA)}${style.dim(':')} ${names(a.onlyContributors, style)}`,
  );
  sections.push(
    `${style.dim('only on')} ${style.bold(refB)}${style.dim(':')} ${names(b.onlyContributors, style)}`,
  );
  if (result.sharedContributors.length) {
    sections.push(`${style.dim('on both sides:')} ${result.sharedContributors.join(', ')}`);
  }

  for (const side of [a, b]) {
    if (!side.files.length) continue;
    sections.push('');
    sections.push(format.heading(`Busiest files only on ${side.ref}`, style));
    sections.push(
      format.table(
        side.files.slice(0, TOP_N).map((file) => [
          format.count(file.churn),
          style.dim('lines'),
          style.bold(file.path),
        ]),
        [{ align: 'right' }],
      ),
    );
  }

  if (result.sharedFiles.length) {
    sections.push('');
    sections.push(
      style.dim(
        `${format.plural(result.sharedFiles.length, 'file')} changed on both sides: ` +
          `${result.sharedFiles.slice(0, TOP_N).join(', ')}` +
          (result.sharedFiles.length > TOP_N ? ', …' : ''),
      ),
    );
  }

  sections.push('');
  sections.push(
    style.dim(
      result.mergeBase
        ? `common ancestor ${result.mergeBase.slice(0, 7)} · counts are git's A..B ranges, folded through the same model as stats`
        : `no common ancestor · counts are git's A..B ranges, folded through the same model as stats`,
    ),
  );

  return sections.join('\n');
}

module.exports = { renderCompare };
