'use strict';

/**
 * to-json — the machine-readable rendering of the repo model.
 *
 * `render-stats.js` and `render-hotspots.js` turn the model into something a
 * person reads; this turns the same model into something a script reads. It
 * is a renderer like the others: no analysis happens here, it only selects
 * fields and gives them stable names.
 *
 * Field names are part of repotool's contract (see README, "Scripting / JSON
 * output"): add to them freely, rename them never.
 */

const path = require('node:path');
const { rankHotspots, HOTSPOT_WEIGHTS } = require('./repo-model');

/** HEAD in a form a script can branch on, rather than a sentence. */
function headJson(head) {
  return {
    empty: Boolean(head.empty),
    detached: Boolean(head.detached),
    branch: head.branch || null,
    hash: head.hash || null,
  };
}

function fileJson(file) {
  return {
    path: file.path,
    commits: file.commits,
    authors: file.authorCount,
    added: file.added,
    removed: file.removed,
    churn: file.churn,
    binary: Boolean(file.binary),
    firstDate: file.firstDate,
    lastDate: file.lastDate,
  };
}

/** The `repotool stats --json` document. */
function statsJson(model) {
  return {
    repository: { path: model.cwd, name: path.basename(model.cwd), head: headJson(model.head) },
    empty: model.isEmpty,
    commits: {
      total: model.totalCommits,
      merges: model.mergeCount,
      first: model.firstCommitDate,
      last: model.lastCommitDate,
      spanDays: model.spanDays,
    },
    contributors: model.contributors.map((author) => ({
      name: author.name,
      email: author.email,
      commits: author.commits,
      merges: author.merges,
      added: author.added,
      removed: author.removed,
      firstDate: author.firstDate,
      lastDate: author.lastDate,
    })),
    branches: {
      local: model.branches.local.map((branch) => branch.name),
      remote: model.branches.remote.map((branch) => branch.name),
    },
    totals: {
      filesTouched: model.totals.filesTouched,
      added: model.totals.added,
      removed: model.totals.removed,
      churn: model.totals.churn,
    },
    topFiles: rankHotspots(model, { sort: 'commits' }).slice(0, 3).map(fileJson),
  };
}

/** The `repotool hotspots --json` document. */
function hotspotsJson(model, { limit = 10, sort = 'score' } = {}) {
  const ranked = model.isEmpty ? [] : rankHotspots(model, { sort });
  const count = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;
  return {
    repository: { path: model.cwd, name: path.basename(model.cwd), head: headJson(model.head) },
    empty: model.isEmpty,
    sort,
    weights: HOTSPOT_WEIGHTS,
    totalFiles: ranked.length,
    files: ranked.slice(0, count).map((file, index) => ({
      rank: index + 1,
      score: file.score,
      ...fileJson(file),
    })),
  };
}

module.exports = { statsJson, hotspotsJson, headJson, fileJson };
