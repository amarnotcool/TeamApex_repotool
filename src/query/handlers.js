'use strict';

/**
 * handlers — intent to answer.
 *
 * Every handler receives the parsed intent plus a context ({ cwd, style })
 * and returns a printable string. Handlers query git-reader directly; they
 * never re-parse the question, and they never shell out to git themselves.
 */

const reader = require('../git-reader');
const { supportedQuestions } = require('./parser');

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
    const { commits } = reader.readCommits({ cwd });
    if (!commits.length) return 'This repository has no commits yet.';

    const counts = new Map();
    for (const commit of commits) {
      counts.set(commit.authorName, (counts.get(commit.authorName) || 0) + 1);
    }

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

  'branch-list'(intent, { cwd, style }) {
    // Local and remote-tracking branches both matter when you are trying to
    // understand a repository, so we read refs/heads and refs/remotes.
    const raw = reader.git(
      ['for-each-ref', '--format=%(refname)\t%(refname:short)\t%(objectname:short)', 'refs/heads', 'refs/remotes'],
      { cwd, allowFailure: true },
    );
    const current = reader.head(cwd);
    if (!raw || !raw.trim()) return 'No branches yet.';

    const branches = raw
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        const [fullRef, name, hash] = line.split('\t');
        return { fullRef, name, hash, remote: fullRef.startsWith('refs/remotes/') };
      })
      // A remote's HEAD pointer is an alias, not a branch of its own. Match on
      // the full ref: refs/remotes/origin/HEAD shortens to plain "origin".
      .filter((branch) => !branch.fullRef.endsWith('/HEAD'));

    const local = branches.filter((branch) => !branch.remote);
    const remote = branches.filter((branch) => branch.remote);

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
