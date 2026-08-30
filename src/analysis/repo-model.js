'use strict';

/**
 * repo-model — one pass over a repository, shared by everything that needs
 * aggregate facts about it.
 *
 * Before this module existed, each question re-derived its own answer: the
 * contributor count walked the log, the busiest-file answer ran one `git show`
 * per commit, the branch answer ran its own ref query. That is fine for one
 * question and wasteful for a dashboard.
 *
 * Here we read the history once — including per-file line counts, via a single
 * `git log --numstat` — and fold it into the aggregates every caller wants:
 * contributors, branches, per-file commit counts, per-file churn.
 *
 * The model is a plain data structure. It renders nothing and prints nothing,
 * so `stats`, `hotspots` and the `ask` handlers can present it differently.
 */

const reader = require('../git-reader');

/**
 * Cache keyed by repository, options and current HEAD.
 *
 * Including HEAD means a model built before a commit is never handed back
 * after it: a new commit moves HEAD and therefore misses the cache.
 */
const cache = new Map();

function cacheKey(cwd, all, limit, headHash) {
  return [cwd, all, limit || 0, headHash || 'empty'].join('|');
}

/** Descending sort by count, then by name, so output is stable. */
function byCountDesc(a, b) {
  return b.commits - a.commits || String(a.name || a.path).localeCompare(String(b.name || b.path));
}

/** Whole days between two ISO dates, at least 1 so rates never divide by zero. */
function daysBetween(earliestIso, latestIso) {
  const earliest = new Date(earliestIso).getTime();
  const latest = new Date(latestIso).getTime();
  if (!Number.isFinite(earliest) || !Number.isFinite(latest)) return 1;
  return Math.max(1, (latest - earliest) / (1000 * 60 * 60 * 24));
}

/**
 * Build (or reuse) the model for a repository.
 *
 * @param {object} [options]
 * @param {string} [options.cwd]     repository directory
 * @param {boolean} [options.all]    include every ref (default true)
 * @param {number} [options.limit]   cap history length
 * @param {boolean} [options.fresh]  bypass the cache
 */
function buildRepoModel(options = {}) {
  const { cwd = process.cwd(), all = true, limit, fresh = false } = options;

  if (!reader.isRepo(cwd)) {
    throw new reader.GitError(`not a git repository: ${cwd}`, { code: 'NOT_A_REPO' });
  }

  const head = reader.head(cwd);
  const key = cacheKey(cwd, all, limit, head.hash);
  if (!fresh && cache.has(key)) return cache.get(key);

  const commits = reader.readHistoryWithStats({ cwd, all, limit });
  const model = foldHistory({ cwd, head, commits, branches: reader.branches({ cwd }) });

  cache.set(key, model);
  return model;
}

/**
 * Fold a history into aggregates. Split out from buildRepoModel so tests can
 * feed it synthetic commits without touching a real repository.
 */
function foldHistory({ cwd, head, commits, branches }) {
  const contributors = new Map(); // name -> record
  const files = new Map(); // path -> record

  for (const commit of commits) {
    const author = contributors.get(commit.authorName) || {
      name: commit.authorName,
      email: commit.authorEmail,
      commits: 0,
      added: 0,
      removed: 0,
      merges: 0,
      firstDate: commit.authorDate,
      lastDate: commit.authorDate,
    };
    author.commits += 1;
    author.added += commit.added || 0;
    author.removed += commit.removed || 0;
    if (commit.isMerge) author.merges += 1;
    // Commits arrive newest-first, so the earliest one seen wins `firstDate`.
    author.firstDate = commit.authorDate;
    contributors.set(commit.authorName, author);

    for (const file of commit.files || []) {
      const record = files.get(file.path) || {
        path: file.path,
        commits: 0,
        added: 0,
        removed: 0,
        binary: false,
        authors: new Map(),
        firstDate: commit.authorDate,
        lastDate: commit.authorDate,
      };
      record.commits += 1;
      record.added += file.added;
      record.removed += file.removed;
      record.binary = record.binary || file.binary;
      record.authors.set(commit.authorName, (record.authors.get(commit.authorName) || 0) + 1);
      record.firstDate = commit.authorDate;
      files.set(file.path, record);
    }
  }

  const fileList = [...files.values()].map((record) => ({
    ...record,
    authorCount: record.authors.size,
    churn: record.added + record.removed,
  }));

  // Point the lookup map at the enriched records, so `fileMap.get(path)` and
  // the `files` array are the same objects — not two shapes of the same data.
  const fileIndex = new Map(fileList.map((file) => [file.path, file]));

  const totals = fileList.reduce(
    (accumulator, file) => ({
      added: accumulator.added + file.added,
      removed: accumulator.removed + file.removed,
      churn: accumulator.churn + file.churn,
    }),
    { added: 0, removed: 0, churn: 0 },
  );

  const newest = commits[0];
  const oldest = commits[commits.length - 1];

  return {
    cwd,
    head,
    isEmpty: commits.length === 0,
    commits,
    totalCommits: commits.length,
    mergeCount: commits.filter((commit) => commit.isMerge).length,
    firstCommitDate: oldest ? oldest.authorDate : null,
    lastCommitDate: newest ? newest.authorDate : null,
    spanDays: newest && oldest ? daysBetween(oldest.authorDate, newest.authorDate) : 0,
    contributors: [...contributors.values()].sort(byCountDesc),
    branches,
    files: fileList,
    fileMap: fileIndex,
    totals: { ...totals, filesTouched: fileList.length },
  };
}

/**
 * Files ranked by how much attention they attract.
 *
 * Three signals matter and none of them alone is enough: a file changed often
 * (commits), by many different people (authors), with a lot of lines moving
 * (churn). Each is scaled against the busiest file in the repository so the
 * score is comparable across projects, then weighted — change frequency leads,
 * because a file nobody touches is not a hotspot however large it is.
 */
const HOTSPOT_WEIGHTS = { commits: 0.5, churn: 0.3, authors: 0.2 };

function rankHotspots(model, { sort = 'score' } = {}) {
  const maxOf = (pick) => model.files.reduce((max, file) => Math.max(max, pick(file)), 0) || 1;
  const maxCommits = maxOf((file) => file.commits);
  const maxChurn = maxOf((file) => file.churn);
  const maxAuthors = maxOf((file) => file.authorCount);

  const scored = model.files.map((file) => ({
    ...file,
    score:
      (HOTSPOT_WEIGHTS.commits * file.commits) / maxCommits +
      (HOTSPOT_WEIGHTS.churn * file.churn) / maxChurn +
      (HOTSPOT_WEIGHTS.authors * file.authorCount) / maxAuthors,
  }));

  const comparators = {
    score: (a, b) => b.score - a.score || b.commits - a.commits || a.path.localeCompare(b.path),
    commits: (a, b) => b.commits - a.commits || b.churn - a.churn || a.path.localeCompare(b.path),
    churn: (a, b) => b.churn - a.churn || b.commits - a.commits || a.path.localeCompare(b.path),
    authors: (a, b) => b.authorCount - a.authorCount || b.commits - a.commits || a.path.localeCompare(b.path),
  };

  return scored.sort(comparators[sort] || comparators.score);
}

/** Contributors to a single path, most commits first. */
function fileContributors(model, path) {
  const record = model.fileMap.get(path);
  if (!record) return [];
  return [...record.authors.entries()]
    .map(([name, commits]) => ({ name, commits }))
    .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name));
}

/**
 * Find files whose path matches a user-supplied fragment.
 * Exact match wins; otherwise every path containing the fragment is returned.
 */
function matchFiles(model, fragment) {
  const needle = String(fragment || '').trim().toLowerCase();
  if (!needle) return [];
  if (model.fileMap.has(fragment)) return [model.fileMap.get(fragment).path];
  return model.files
    .filter((file) => file.path.toLowerCase().includes(needle))
    .sort((a, b) => b.commits - a.commits)
    .map((file) => file.path);
}

/**
 * Compare a recent slice of history against everything before it.
 *
 * "Recent" is the newest `windowSize` commits (or a quarter of history,
 * whichever is smaller but at least one), and the baseline is the rest. Rates
 * are commits per day over each period's own span, which is what makes the
 * comparison meaningful when the two periods differ in length.
 *
 * Everything here is arithmetic over real commit data — no estimation.
 */
function activityComparison(model, { windowSize } = {}) {
  if (model.isEmpty) return null;

  const total = model.totalCommits;
  const size = Math.max(1, Math.min(windowSize || Math.ceil(total / 4), total));
  const recent = model.commits.slice(0, size);
  const baseline = model.commits.slice(size);

  const churnOf = (commits) =>
    commits.reduce((sum, commit) => sum + (commit.added || 0) + (commit.removed || 0), 0);

  const periodOf = (commits) => {
    if (!commits.length) return null;
    const newest = commits[0];
    const oldest = commits[commits.length - 1];
    // `days` is clamped so rates never divide by zero; `rawDays` is the real
    // elapsed time, which callers need to know whether a rate means anything.
    const days = daysBetween(oldest.authorDate, newest.authorDate);
    const rawDays = Math.max(
      0,
      (new Date(newest.authorDate).getTime() - new Date(oldest.authorDate).getTime()) / (1000 * 60 * 60 * 24),
    );
    return {
      commits: commits.length,
      churn: churnOf(commits),
      days,
      rawDays,
      from: oldest.authorDate,
      to: newest.authorDate,
      perDay: commits.length / days,
    };
  };

  const recentPeriod = periodOf(recent);
  const baselinePeriod = periodOf(baseline);

  // Per-file churn within the recent window only.
  const recentFiles = new Map();
  for (const commit of recent) {
    for (const file of commit.files || []) {
      const record = recentFiles.get(file.path) || { path: file.path, commits: 0, churn: 0 };
      record.commits += 1;
      record.churn += file.added + file.removed;
      recentFiles.set(file.path, record);
    }
  }
  const topRecentFiles = [...recentFiles.values()].sort(
    (a, b) => b.churn - a.churn || b.commits - a.commits || a.path.localeCompare(b.path),
  );

  const recentAuthors = new Map();
  for (const commit of recent) {
    recentAuthors.set(commit.authorName, (recentAuthors.get(commit.authorName) || 0) + 1);
  }
  const topRecentAuthors = [...recentAuthors.entries()]
    .map(([name, commits]) => ({ name, commits }))
    .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name));

  const concentrationCount = Math.min(3, topRecentFiles.length);
  const concentratedChurn = topRecentFiles
    .slice(0, concentrationCount)
    .reduce((sum, file) => sum + file.churn, 0);

  // A rate comparison is only meaningful when both periods actually span time.
  // A repository whose history lands inside a single day (an import, or a
  // one-sitting project) would otherwise produce a confident-looking ratio
  // that is really an artefact of clamping both spans to one day.
  const comparableRates =
    Boolean(baselinePeriod) && recentPeriod.rawDays >= 1 && baselinePeriod.rawDays >= 1 && baselinePeriod.perDay > 0;

  return {
    recent: recentPeriod,
    baseline: baselinePeriod,
    comparableRates,
    // Null when there is no baseline, or when the spans are too short to rate.
    rateRatio: comparableRates ? recentPeriod.perDay / baselinePeriod.perDay : null,
    topRecentFiles,
    topRecentAuthors,
    concentration: {
      files: concentrationCount,
      churn: concentratedChurn,
      share: recentPeriod.churn > 0 ? concentratedChurn / recentPeriod.churn : 0,
    },
  };
}

/** Drop cached models. Tests use this; so would a long-running process. */
function clearCache() {
  cache.clear();
}

module.exports = {
  buildRepoModel,
  foldHistory,
  rankHotspots,
  fileContributors,
  matchFiles,
  activityComparison,
  clearCache,
  daysBetween,
  HOTSPOT_WEIGHTS,
};
