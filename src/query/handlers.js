'use strict';

/**
 * handlers — intent to answer.
 *
 * Every handler receives the parsed intent plus a context ({ cwd, style })
 * and returns a printable string. Handlers query git-reader directly; they
 * never re-parse the question, and they never shell out to git themselves.
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

const handlers = {
  'who-touched'(intent, { cwd, style }) {
    const file = requireArgument(intent, 'a file path');
    const { commits } = reader.readCommits({ cwd, file, all: false, limit: 50 });
    if (!commits.length) {
      return `No commits found touching ${style.bold(file)} — check the path is spelled as git records it.`;
    }
    const last = commits[0];
    const others = new Set(commits.map((commit) => commit.authorName));
    return [
      `${style.bold(last.authorName)} last touched ${style.bold(file)}`,
      `  commit  ${style.brightYellow(last.shortHash)}  ${last.subject}`,
      `  when    ${formatDate(last.authorDate)}`,
      `  history ${commits.length} commit(s) by ${others.size} author(s): ${[...others].join(', ')}`,
    ].join('\n');
  },

  'when-was'(intent, { cwd, style }) {
    const rev = requireArgument(intent, 'a commit reference');
    const hash = reader.resolveRev(rev, { cwd });
    const { commits } = reader.readCommits({ cwd, revs: [hash], limit: 1, all: false });
    const commit = commits[0];
    if (!commit) return `Could not read commit ${rev}.`;
    return [
      `${style.brightYellow(commit.shortHash)} ${commit.subject}`,
      `  authored  ${formatDate(commit.authorDate)} by ${commit.authorName} <${commit.authorEmail}>`,
      `  committed ${formatDate(commit.commitDate)}`,
      commit.isMerge ? `  merge of ${commit.parents.length} parents` : null,
    ]
      .filter(Boolean)
      .join('\n');
  },

  'count-by-author'(intent, { cwd, style }) {
    // Contributor counts come from the shared model, which reads the same
    // history this handler used to walk itself.
    const model = analysis().buildRepoModel({ cwd });
    if (model.isEmpty) return 'This repository has no commits yet.';

    const counts = new Map(model.contributors.map((author) => [author.name, author.commits]));

    if (intent.argument) {
      const needle = intent.argument.toLowerCase();
      const matches = ranked(counts).filter(([name]) => name.toLowerCase().includes(needle));
      if (!matches.length) {
        return `No author matching ${style.bold(intent.argument)}. Known authors: ${ranked(counts)
          .map(([name]) => name)
          .join(', ')}`;
      }
      return matches
        .map(([name, count]) => `${style.bold(name)}: ${count} commit${count === 1 ? '' : 's'}`)
        .join('\n');
    }

    return ranked(counts)
      .map(([name, count]) => `${String(count).padStart(5)}  ${name}`)
      .join('\n');
  },

  'files-changed'(intent, { cwd, style }) {
    const rev = requireArgument(intent, 'a commit reference');
    const hash = reader.resolveRev(rev, { cwd });
    const files = reader.filesChanged(hash, { cwd });
    if (!files.length) return `${style.brightYellow(rev)} changed no files (empty or merge commit).`;
    return [`${files.length} file(s) changed in ${style.brightYellow(rev)}:`, ...files.map((f) => `  ${f}`)].join('\n');
  },

  'last-commits'(intent, { cwd, style }) {
    const count = Math.min(Number(intent.argument) || 10, 200);
    const { commits } = reader.readCommits({ cwd, limit: count });
    if (!commits.length) return 'This repository has no commits yet.';
    return commits
      .map(
        (commit) =>
          `${style.brightYellow(commit.shortHash)}  ${String(commit.authorDate).slice(0, 10)}  ` +
          `${style.cyan(commit.authorName)}  ${commit.subject}`,
      )
      .join('\n');
  },

  'top-authors'(intent, context) {
    return handlers['count-by-author']({ ...intent, argument: null }, context);
  },

  'busiest-file'(intent, { cwd, style }) {
    const { commits } = reader.readCommits({ cwd, limit: 500 });
    if (!commits.length) return 'This repository has no commits yet.';

    const counts = new Map();
    for (const commit of commits) {
      for (const file of reader.filesChanged(commit.hash, { cwd })) {
        counts.set(file, (counts.get(file) || 0) + 1);
      }
    }
    if (!counts.size) return 'No file changes recorded.';

    return ranked(counts)
      .slice(0, 10)
      .map(([file, count]) => `${String(count).padStart(5)}  ${style.bold(file)}`)
      .join('\n');
  },

  'file-owner'(intent, { cwd, style }) {
    const wanted = requireArgument(intent, 'a file or directory path');
    const model = analysis().buildRepoModel({ cwd });
    if (model.isEmpty) return 'This repository has no commits yet.';

    const matches = analysis().matchFiles(model, wanted);
    if (!matches.length) {
      return `No tracked file matches ${style.bold(wanted)} — check the path as git records it.`;
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

    return lines.join('\n');
  },

  'recent-activity'(intent, { cwd, style }) {
    const model = analysis().buildRepoModel({ cwd });
    if (model.isEmpty) return 'This repository has no commits yet.';

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

    return lines.join('\n');
  },

  'change-analysis'(intent, { cwd, style }) {
    const model = analysis().buildRepoModel({ cwd });
    if (model.isEmpty) return 'This repository has no commits yet.';

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

    return lines.join('\n');
  },

  'branch-list'(intent, { cwd, style }) {
    // Local and remote-tracking branches both matter when you are trying to
    // understand a repository; git-reader owns the ref query itself.
    const { local, remote, all } = reader.branches({ cwd });
    const current = reader.head(cwd);
    if (!all.length) return 'No branches yet.';

    const lines = [];
    for (const branch of local) {
      const marker = branch.name === current.branch ? style.brightGreen('*') : ' ';
      lines.push(`${marker} ${branch.name}  ${style.dim(branch.hash)}`);
    }
    for (const branch of remote) {
      lines.push(`  ${style.cyan(branch.name)}  ${style.dim(branch.hash)} ${style.dim('(remote)')}`);
    }

    const summary = `${local.length} local, ${remote.length} remote`;
    return [...lines, style.dim(summary)].join('\n');
  },
};

/** Run a parsed intent. Throws QueryError with guidance when unsupported. */
function answer(intent, context) {
  if (!intent || !handlers[intent.name]) {
    throw new QueryError(
      ['I do not understand that question yet. I can answer:', ...supportedQuestions().map((q) => `  - ${q}`)].join('\n'),
    );
  }
  return handlers[intent.name](intent, context);
}

module.exports = { answer, handlers, QueryError };
