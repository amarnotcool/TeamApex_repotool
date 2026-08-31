'use strict';

/**
 * compare — two refs, folded through the same model both ways.
 *
 * `git log A..B` is "commits reachable from B but not from A" — exactly what
 * "B is ahead of A by" means. Running it in both directions gives the two
 * halves of a comparison, and each half is handed to `foldHistory`, the same
 * fold `stats` and `hotspots` are built on. There is no comparison-specific
 * parsing or aggregation here: a side of a comparison is just a repo model
 * scoped to a range.
 */

const reader = require('../git-reader');
const { foldHistory } = require('./repo-model');

/**
 * Build one side: everything reachable from `to` but not from `from`.
 *
 * @returns {{range: string, commits: number, ...aggregates}}
 */
function sideOf(fromRef, toRef, { cwd }) {
  const range = `${fromRef}..${toRef}`;
  const commits = reader.readHistoryWithStats({ cwd, revs: [range] });

  // A range model has no meaningful HEAD or branch list of its own — those
  // describe the repository, not the slice — so they are passed empty rather
  // than borrowed from the working tree and quietly misread as the range's.
  const model = foldHistory({
    cwd,
    head: { empty: commits.length === 0, detached: false, branch: null, hash: null },
    commits,
    branches: { local: [], remote: [], all: [] },
  });

  return {
    range,
    ref: toRef,
    commits: model.totalCommits,
    merges: model.mergeCount,
    contributors: model.contributors.map((author) => ({ name: author.name, commits: author.commits })),
    files: model.files
      .map((file) => ({ path: file.path, commits: file.commits, churn: file.churn }))
      .sort((a, b) => b.churn - a.churn || a.path.localeCompare(b.path)),
    filesChanged: model.totals.filesTouched,
    added: model.totals.added,
    removed: model.totals.removed,
    churn: model.totals.churn,
    first: model.firstCommitDate,
    last: model.lastCommitDate,
    model,
  };
}

/** Names present on one side and not the other. */
function exclusiveNames(mine, theirs) {
  const other = new Set(theirs.map((author) => author.name));
  return mine.filter((author) => !other.has(author.name));
}

/**
 * Compare two revisions.
 *
 * @param {string} refA
 * @param {string} refB
 * @param {object} options
 * @param {string} options.cwd
 * @returns {{
 *   a: object, b: object, identical: boolean, mergeBase: string|null,
 *   sharedContributors: string[], sharedFiles: string[],
 * }}
 *
 * `a` describes what A has that B does not, and `b` the reverse — so `b.commits`
 * is how far B is ahead of A, and `a.commits` how far it is behind.
 */
function compareRefs(refA, refB, { cwd = process.cwd() } = {}) {
  const hashA = reader.resolveRev(refA, { cwd });
  const hashB = reader.resolveRev(refB, { cwd });

  const a = sideOf(refB, refA, { cwd });
  const b = sideOf(refA, refB, { cwd });

  // Unrelated histories have no merge base; that is a fact about the pair
  // worth reporting, not a failure.
  const base = reader.mergeBase(hashA, hashB, { cwd });

  const contributorsA = a.contributors;
  const contributorsB = b.contributors;
  const sharedNames = contributorsA
    .filter((author) => contributorsB.some((other) => other.name === author.name))
    .map((author) => author.name);

  const pathsB = new Set(b.files.map((file) => file.path));

  return {
    refA,
    refB,
    hashA,
    hashB,
    identical: hashA === hashB,
    mergeBase: base,
    a: { ...a, ref: refA, onlyContributors: exclusiveNames(contributorsA, contributorsB) },
    b: { ...b, ref: refB, onlyContributors: exclusiveNames(contributorsB, contributorsA) },
    sharedContributors: sharedNames,
    sharedFiles: a.files.filter((file) => pathsB.has(file.path)).map((file) => file.path),
  };
}

module.exports = { compareRefs, sideOf };
