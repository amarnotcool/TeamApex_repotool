'use strict';

/**
 * render-stats — the `repotool stats` overview.
 *
 * One screen answering "what am I looking at?": size, people, branches, and
 * where the changes land. Every number comes from the shared repo model, so
 * this file only decides what to show and how to line it up.
 */

const path = require('node:path');
const { createStyle } = require('../ansi');
const format = require('../format');
const { rankHotspots } = require('./repo-model');

const TOP_N = 3;

/** "on branch main" / "detached HEAD at abc1234" / "empty repository". */
function describeHead(head) {
  if (head.empty) return 'empty repository';
  if (head.detached) return `detached HEAD at ${head.hash.slice(0, 7)}`;
  return `on branch ${head.branch}`;
}

/** The summary block: one label/value pair per line. */
function overviewRows(model, style) {
  const { branches, totals } = model;
  const rows = [
    ['commits', format.count(model.totalCommits) + (model.mergeCount ? style.dim(`  (${format.plural(model.mergeCount, 'merge')})`) : '')],
    ['contributors', format.count(model.contributors.length)],
    ['branches', `${format.count(branches.local.length)} local, ${format.count(branches.remote.length)} remote`],
    ['files touched', format.count(totals.filesTouched)],
    ['line churn', `${format.count(totals.churn)}  ${style.dim(format.churn(totals.added, totals.removed))}`],
  ];

  if (model.lastCommitDate) {
    const span =
      model.totalCommits > 1
        ? `${format.isoDate(model.firstCommitDate)} → ${format.isoDate(model.lastCommitDate)}  ${style.dim(`(${format.days(model.spanDays)})`)}`
        : `${format.isoDate(model.lastCommitDate)}  ${style.dim('(single commit)')}`;
    rows.push(['history', span]);
    rows.push(['last commit', style.dim(format.relativeDate(model.lastCommitDate))]);
  }

  return rows.map(([label, value]) => [style.dim(label), value]);
}

function contributorRows(model, style) {
  const top = model.contributors.slice(0, TOP_N);
  const max = top.length ? top[0].commits : 0;
  return top.map((author) => [
    format.count(author.commits),
    style.cyan(format.bar(author.commits, max, 16)),
    author.name,
  ]);
}

function hotspotRows(model, style) {
  const top = rankHotspots(model, { sort: 'commits' }).slice(0, TOP_N);
  return top.map((file) => [
    format.plural(file.commits, 'commit'),
    style.dim(`${format.count(file.churn)} lines`),
    style.bold(file.path),
  ]);
}

/**
 * Render the overview.
 *
 * @param {object} model      repo model
 * @param {object} [options]
 * @param {boolean} [options.color]
 */
function renderStats(model, options = {}) {
  const style = createStyle({ enabled: options.color });
  const name = path.basename(model.cwd);
  const sections = [];

  sections.push(`${style.bold(`repotool stats`)} ${style.dim('—')} ${style.brightCyan(name)}  ${style.dim(describeHead(model.head))}`);

  if (model.isEmpty) {
    sections.push('');
    sections.push(style.dim('No commits yet, so there is nothing to summarise.'));
    return sections.join('\n');
  }

  sections.push('');
  sections.push(format.table(overviewRows(model, style), [{ align: 'left' }]));

  sections.push('');
  sections.push(format.heading(`Top ${TOP_N} contributors`, style));
  sections.push(format.table(contributorRows(model, style), [{ align: 'right' }]));

  const hotspots = hotspotRows(model, style);
  if (hotspots.length) {
    sections.push('');
    sections.push(format.heading(`Top ${TOP_N} most-changed files`, style));
    sections.push(format.table(hotspots, [{ align: 'right' }]));
  }

  return sections.join('\n');
}

module.exports = { renderStats, describeHead };
