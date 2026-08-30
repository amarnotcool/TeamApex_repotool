'use strict';

/**
 * handlers — intent to answer.
 *
 * Every handler receives the parsed intent plus a context ({ cwd, style })
 * and returns both renderings of one answer: `text`, the string a person
 * reads, and `data`, the plain object `--json` prints. Both are produced from
 * the same values in the same place, so the two can never disagree about the
 * facts. Handlers query git-reader directly; they never re-parse the
 * question, and they never shell out to git themselves.
 */

const reader = require('../git-reader');
const format = require('../format');
const { supportedQuestions } = require('./parser');

/**
 * The aggregate handlers need the shared repository model; the rest do not.
 * Loading it on use rather than on import keeps questions like "who last
 * touched X" answerable even if the analysis layer is missing or broken.
 */
function analysis() {
  return require('../analysis/repo-model');
}

function formatDate(iso) {
  if (!iso) return 'unknown date';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/** Sort a Map of counts into a descending [key, count] list. */
function ranked(counts) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function requireArgument(intent, what) {
  if (!intent.argument) {
    throw new QueryError(`I need ${what}. Try: repotool ask "${intent.describe}"`);
  }
  return intent.argument;
}

class QueryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QueryError';
  }
}

/** Pair the human answer with its machine-readable twin. */
function result(text, data) {
  return { text, data };
}

/** The subset of a commit we expose in JSON. These field names are stable. */
function commitJson(commit) {
  return {
    hash: commit.hash,
    shortHash: commit.shortHash,
    subject: commit.subject,
    authorName: commit.authorName,
    authorEmail: commit.authorEmail,
    authorDate: commit.authorDate,
    isMerge: Boolean(commit.isMerge),
  };
}

/** A period from activityComparison(), trimmed to the fields worth exporting. */
function periodJson(period) {
  if (!period) return null;
  return {
    commits: period.commits,
    churn: period.churn,
    days: period.rawDays,
    from: period.from,
    to: period.to,
    commitsPerDay: period.perDay,
  };
}

const handlers = {
  'who-touched'(intent, { cwd, style }) {
    const file = requireArgument(intent, 'a file path');
    const { commits } = reader.readCommits({ cwd, file, all: false, limit: 50 });
    if (!commits.length) {
      return result(
        `No commits found touching ${style.bold(file)} — check the path is spelled as git records it.`,
        { file, found: false, commitCount: 0, authors: [], lastCommit: null },
      );
    }
    const last = commits[0];
    const others = [...new Set(commits.map((commit) => commit.authorName))];
    return result(
      [
        `${style.bold(last.authorName)} last touched ${style.bold(file)}`,
        `  commit  ${style.brightYellow(last.shortHash)}  ${last.subject}`,
        `  when    ${formatDate(last.authorDate)}`,
        `  history ${commits.length} commit(s) by ${others.length} author(s): ${others.join(', ')}`,
      ].join('\n'),
      {
        file,
        found: true,
        lastAuthor: last.authorName,
        lastCommit: commitJson(last),
        commitCount: commits.length,
        authors: others,
      },
    );
  },

  'when-was'(intent, { cwd, style }) {
    const rev = requireArgument(intent, 'a commit reference');
    const hash = reader.resolveRev(rev, { cwd });
    const { commits } = reader.readCommits({ cwd, revs: [hash], limit: 1, all: false });
    const commit = commits[0];
    if (!commit) return result(`Could not read commit ${rev}.`, { rev, found: false, commit: null });
    return result(
      [
        `${style.brightYellow(commit.shortHash)} ${commit.subject}`,
        `  authored  ${formatDate(commit.authorDate)} by ${commit.authorName} <${commit.authorEmail}>`,
        `  committed ${formatDate(commit.commitDate)}`,
        commit.isMerge ? `  merge of ${commit.parents.length} parents` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      {
        rev,
        found: true,
        commit: { ...commitJson(commit), commitDate: commit.commitDate, parents: commit.parents },
      },
    );
  },

  'count-by-author'(intent, { cwd, style }) {
    // Contributor counts come from the shared model, which reads the same
    // history this handler used to walk itself.
    const model = analysis().buildRepoModel({ cwd });
    if (model.isEmpty) return result('This repository has no commits yet.', { empty: true, authors: [] });

    const counts = new Map(model.contributors.map((author) => [author.name, author.commits]));
    const asJson = (pairs) => pairs.map(([name, commits]) => ({ name, commits }));

    if (intent.argument) {
      const needle = intent.argument.toLowerCase();
      const matches = ranked(counts).filter(([name]) => name.toLowerCase().includes(needle));
      if (!matches.length) {
        return result(
          `No author matching ${style.bold(intent.argument)}. Known authors: ${ranked(counts)
            .map(([name]) => name)
            .join(', ')}`,
          { empty: false, filter: intent.argument, authors: [], knownAuthors: asJson(ranked(counts)) },
        );
      }
      return result(
        matches
          .map(([name, count]) => `${style.bold(name)}: ${count} commit${count === 1 ? '' : 's'}`)
          .join('\n'),
        { empty: false, filter: intent.argument, authors: asJson(matches) },
      );
    }

    return result(
      ranked(counts)
        .map(([name, count]) => `${String(count).padStart(5)}  ${name}`)
        .join('\n'),
      { empty: false, filter: null, authors: asJson(ranked(counts)) },
    );
  },

  'files-changed'(intent, { cwd, style }) {
    const rev = requireArgument(intent, 'a commit reference');
    const hash = reader.resolveRev(rev, { cwd });
    const files = reader.filesChanged(hash, { cwd });
    if (!files.length) {
      return result(`${style.brightYellow(rev)} changed no files (empty or merge commit).`, {
        rev,
        hash,
        files: [],
      });
    }
    return result(
      [`${files.length} file(s) changed in ${style.brightYellow(rev)}:`, ...files.map((f) => `  ${f}`)].join('\n'),
      { rev, hash, files },
    );
  },

  'last-commits'(intent, { cwd, style }) {
    const count = Math.min(Number(intent.argument) || 10, 200);
    const { commits } = reader.readCommits({ cwd, limit: count });
    if (!commits.length) return result('This repository has no commits yet.', { empty: true, commits: [] });
    return result(
      commits
        .map(
          (commit) =>
            `${style.brightYellow(commit.shortHash)}  ${String(commit.authorDate).slice(0, 10)}  ` +
            `${style.cyan(commit.authorName)}  ${commit.subject}`,
        )
        .join('\n'),
      { empty: false, requested: count, commits: commits.map(commitJson) },
    );
  },

  'top-authors'(intent, context) {
    return handlers['count-by-author']({ ...intent, argument: null }, context);
  },

  'busiest-file'(intent, { cwd, style }) {
    // Per-file commit counts already exist in the shared model, read from one
    // `git log --numstat`. This handler used to run `git show` per commit —
    // 500 git processes, half a minute on a repository with real history, and
    // an answer that could disagree with `repotool hotspots` because it was
    // counted a different way. Same numbers, one pass.
    const model = analysis().buildRepoModel({ cwd });
    if (model.isEmpty) return result('This repository has no commits yet.', { empty: true, files: [] });

    const ranking = analysis().rankHotspots(model, { sort: 'commits' }).slice(0, 10);
    if (!ranking.length) return result('No file changes recorded.', { empty: false, files: [] });

    return result(
      ranking.map((file) => `${String(file.commits).padStart(5)}  ${style.bold(file.path)}`).join('\n'),
      {
        empty: false,
        files: ranking.map((file) => ({ path: file.path, commits: file.commits, churn: file.churn })),
      },
    );
  },

  'file-owner'(intent, { cwd, style }) {
    const wanted = requireArgument(intent, 'a file or directory path');
    const model = analysis().buildRepoModel({ cwd });
    if (model.isEmpty) return result('This repository has no commits yet.', { empty: true, path: null });

    const matches = analysis().matchFiles(model, wanted);
    if (!matches.length) {
      return result(`No tracked file matches ${style.bold(wanted)} — check the path as git records it.`, {
        empty: false,
        query: wanted,
        path: null,
        matches: [],
      });
    }

    const path = matches[0];
    const file = model.fileMap.get(path);
    const contributors = analysis().fileContributors(model, path);
    const leader = contributors[0];

    const lines = [
      `${style.bold(leader.name)} works most on ${style.bold(path)}`,
      `  ${leader.commits} of ${format.plural(file.commits, 'commit')} touching it`,
      `  file totals: ${format.plural(file.commits, 'commit')}, ` +
        `${format.plural(file.authorCount, 'author')}, ` +
        `${format.count(file.churn)} lines changed ${style.dim(format.churn(file.added, file.removed))}`,
      `  last change ${style.dim(format.relativeDate(file.lastDate))}`,
    ];

    if (contributors.length > 1) {
      const others = contributors
        .slice(1)
        .map((author) => `${author.name} (${author.commits})`)
        .join(', ');
      lines.push(`  also worked on it: ${others}`);
    }

    if (matches.length > 1) {
      lines.push(style.dim(`  ${matches.length - 1} other path(s) matched; showing the busiest.`));
    }

    return result(lines.join('\n'), {
      empty: false,
      query: wanted,
      path,
      owner: { name: leader.name, commits: leader.commits },
      file: {
        path,
        commits: file.commits,
        authors: file.authorCount,
        added: file.added,
        removed: file.removed,
        churn: file.churn,
        lastDate: file.lastDate,
      },
      contributors,
      matches,
    });
  },

  'recent-activity'(intent, { cwd, style }) {
    const model = analysis().buildRepoModel({ cwd });
    if (model.isEmpty) return result('This repository has no commits yet.', { empty: true });

    const requested = Number(intent.argument);
    const windowSize = Number.isFinite(requested) && requested > 0 ? requested : undefined;
    const activity = analysis().activityComparison(model, { windowSize });
    const { recent } = activity;

    const lines = [
      `${style.bold('Recently')}: ${format.plural(recent.commits, 'commit')} of ` +
        `${format.count(model.totalCommits)}, ${format.isoDate(recent.from)} → ${format.isoDate(recent.to)} ` +
        style.dim(`(${format.relativeDate(recent.to)})`),
      `  churn    ${format.count(recent.churn)} lines across ${format.plural(activity.topRecentFiles.length, 'file')}`,
    ];

    const authors = activity.topRecentAuthors
      .slice(0, 3)
      .map((author) => `${author.name} (${author.commits})`)
      .join(', ');
    lines.push(`  authors  ${authors}`);

    if (activity.topRecentFiles.length) {
      lines.push('  busiest files:');
      for (const file of activity.topRecentFiles.slice(0, 5)) {
        lines.push(
          `    ${String(format.count(file.churn)).padStart(7)} lines  ` +
            `${style.dim(`${file.commits}×`)}  ${style.bold(file.path)}`,
        );
      }
    }

    lines.push('  latest commits:');
    for (const commit of model.commits.slice(0, 3)) {
      lines.push(`    ${style.brightYellow(commit.shortHash)}  ${style.cyan(commit.authorName)}  ${commit.subject}`);
    }

    return result(lines.join('\n'), {
      empty: false,
      totalCommits: model.totalCommits,
      recent: periodJson(recent),
      topFiles: activity.topRecentFiles.slice(0, 5),
      topAuthors: activity.topRecentAuthors.slice(0, 3),
      latestCommits: model.commits.slice(0, 3).map(commitJson),
    });
  },

  'change-analysis'(intent, { cwd, style }) {
    const model = analysis().buildRepoModel({ cwd });
    if (model.isEmpty) return result('This repository has no commits yet.', { empty: true });

    const activity = analysis().activityComparison(model);
    const { recent, baseline, concentration } = activity;

    const lines = [`${style.bold('Why this repository is changing')}`];

    // A per-day rate is only quoted when the period really spans days.
    const describePeriod = (period) =>
      period.rawDays >= 1
        ? `${format.plural(period.commits, 'commit')} over ${format.days(period.rawDays)} ` +
          `(${format.decimal(period.perDay, 1)}/day), ${format.count(period.churn)} lines`
        : `${format.plural(period.commits, 'commit')} inside a single day, ${format.count(period.churn)} lines`;

    lines.push(`  recent    ${describePeriod(recent)}`);
    if (baseline) lines.push(`  baseline  ${describePeriod(baseline)}`);

    if (activity.rateRatio !== null) {
      const ratio = activity.rateRatio;
      const verdict =
        ratio >= 1.25
          ? `${style.brightYellow(`${format.decimal(ratio, 1)}×`)} faster than the earlier period`
          : ratio <= 0.8
            ? `${format.decimal(1 / ratio, 1)}× slower than the earlier period`
            : 'roughly the same pace as the earlier period';
      lines.push(`  pace      ${verdict}`);
    } else if (!baseline) {
      lines.push(`  pace      ${style.dim('no earlier period to compare against yet')}`);
    } else {
      // Same-day history: comparing counts is honest, comparing rates is not.
      lines.push(
        `  pace      ${style.dim('this history spans under a day, so per-day rates would be meaningless —')}`,
      );
      lines.push(
        `            ${format.count(recent.commits)} recent vs ${format.count(baseline.commits)} earlier commits`,
      );
    }

    if (concentration.files > 0 && recent.churn > 0) {
      lines.push(
        `  focus     ${format.percent(concentration.share)} of recent churn ` +
          `(${format.count(concentration.churn)} of ${format.count(recent.churn)} lines) is in ` +
          `${format.plural(concentration.files, 'file')}:`,
      );
      for (const file of activity.topRecentFiles.slice(0, concentration.files)) {
        lines.push(`              ${String(format.count(file.churn)).padStart(7)} lines  ${style.bold(file.path)}`);
      }
    }

    const leader = activity.topRecentAuthors[0];
    if (leader) {
      lines.push(
        `  driver    ${style.bold(leader.name)} made ${leader.commits} of the ` +
          `${format.count(recent.commits)} recent commits`,
      );
    }

    lines.push(
      style.dim('  Every figure above is counted directly from git history — no estimation, no model.'),
    );

    return result(lines.join('\n'), {
      empty: false,
      recent: periodJson(recent),
      baseline: periodJson(baseline),
      comparableRates: activity.comparableRates,
      rateRatio: activity.rateRatio,
      concentration: {
        files: concentration.files,
        churn: concentration.churn,
        share: concentration.share,
        paths: activity.topRecentFiles.slice(0, concentration.files).map((file) => file.path),
      },
      topFiles: activity.topRecentFiles.slice(0, 5),
      topAuthors: activity.topRecentAuthors.slice(0, 3),
    });
  },

  'branch-list'(intent, { cwd, style }) {
    // Local and remote-tracking branches both matter when you are trying to
    // understand a repository; git-reader owns the ref query itself.
    const { local, remote, all } = reader.branches({ cwd });
    const current = reader.head(cwd);
    if (!all.length) return result('No branches yet.', { current: null, local: [], remote: [] });

    const lines = [];
    for (const branch of local) {
      const marker = branch.name === current.branch ? style.brightGreen('*') : ' ';
      lines.push(`${marker} ${branch.name}  ${style.dim(branch.hash)}`);
    }
    for (const branch of remote) {
      lines.push(`  ${style.cyan(branch.name)}  ${style.dim(branch.hash)} ${style.dim('(remote)')}`);
    }

    const summary = `${local.length} local, ${remote.length} remote`;
    return result([...lines, style.dim(summary)].join('\n'), {
      current: current.branch || null,
      local,
      remote,
    });
  },
};

/** Run a parsed intent, returning { text, data }. */
function answerFull(intent, context) {
  if (!intent || !handlers[intent.name]) {
    throw new QueryError(
      ['I do not understand that question yet. I can answer:', ...supportedQuestions().map((q) => `  - ${q}`)].join('\n'),
    );
  }
  const produced = handlers[intent.name](intent, context);
  // Belt and braces: a handler that returns a bare string still works.
  return typeof produced === 'string' ? { text: produced, data: null } : produced;
}

/** Run a parsed intent. Throws QueryError with guidance when unsupported. */
function answer(intent, context) {
  return answerFull(intent, context).text;
}

/**
 * The `--json` shape for one question: the answer's data, wrapped in enough
 * context that a script can tell what it asked without keeping its own note.
 */
function answerJson(intent, context) {
  const { data } = answerFull(intent, context);
  return {
    question: intent.question,
    intent: intent.name,
    argument: intent.argument,
    answer: data,
  };
}

module.exports = { answer, answerFull, answerJson, handlers, QueryError };
