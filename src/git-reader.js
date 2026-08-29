'use strict';

/**
 * git-reader — the only module that talks to the `git` binary.
 *
 * Everything downstream (graph, query, diff) consumes the plain objects this
 * module returns, so no other file needs to know how git formats its output.
 *
 * We ask git for raw data only: commit metadata, parent links, file lists and
 * blob contents. All interpretation — DAG building, question answering,
 * diffing — happens in our own code.
 */

const { execFileSync } = require('node:child_process');

/** Field/record separators unlikely to appear in commit text. */
const FIELD = '\x1f';
const RECORD = '\x1e';

/**
 * The pretty-format placeholders we request, in order, and the property name
 * each one maps to on a parsed commit.
 */
const LOG_FIELDS = [
  ['%H', 'hash'],
  ['%h', 'shortHash'],
  ['%P', 'parentsRaw'],
  ['%an', 'authorName'],
  ['%ae', 'authorEmail'],
  ['%aI', 'authorDate'],
  ['%cI', 'commitDate'],
  ['%D', 'refsRaw'],
  ['%s', 'subject'],
];

class GitError extends Error {
  constructor(message, { code = 'GIT_ERROR', cause } = {}) {
    super(message);
    this.name = 'GitError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

/**
 * Run a git command and return stdout as a string.
 * All git access in this project funnels through here.
 */
function git(args, { cwd = process.cwd(), allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (err) {
    if (allowFailure) return null;
    if (err.code === 'ENOENT') {
      throw new GitError('git executable not found on PATH', { code: 'GIT_MISSING', cause: err });
    }
    const stderr = (err.stderr || '').toString().trim();
    throw new GitError(stderr || `git ${args[0]} failed`, { code: 'GIT_FAILED', cause: err });
  }
}

/** True when `cwd` sits inside a git working tree. */
function isRepo(cwd = process.cwd()) {
  const out = git(['rev-parse', '--is-inside-work-tree'], { cwd, allowFailure: true });
  return out !== null && out.trim() === 'true';
}

/** Absolute path of the repository root containing `cwd`. */
function repoRoot(cwd = process.cwd()) {
  const out = git(['rev-parse', '--show-toplevel'], { cwd, allowFailure: true });
  return out === null ? null : out.trim();
}

/**
 * Current HEAD state: { detached, branch, hash, empty }.
 * `hash` is null and `empty` is true in a repository with no commits yet.
 */
function head(cwd = process.cwd()) {
  const hash = git(['rev-parse', 'HEAD'], { cwd, allowFailure: true });
  if (hash === null) return { detached: false, branch: null, hash: null, empty: true };
  const symbolic = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd, allowFailure: true });
  return {
    detached: symbolic === null,
    branch: symbolic === null ? null : symbolic.trim(),
    hash: hash.trim(),
    empty: false,
  };
}

/**
 * Split a `%D` decoration string ("HEAD -> main, origin/main, tag: v1") into
 * a list of ref names, dropping the "HEAD ->" arrow noise.
 */
function parseRefs(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.startsWith('HEAD -> ') ? part.slice('HEAD -> '.length) : part));
}

/**
 * Read commit history.
 *
 * @param {object} [options]
 * @param {string} [options.cwd]    repository directory
 * @param {boolean} [options.all]   include every ref, not just HEAD (default true)
 * @param {number} [options.limit]  cap the number of commits returned
 * @param {string} [options.file]   restrict history to commits touching this path
 * @param {string[]} [options.revs] explicit revision arguments (e.g. ['main'])
 */
function readCommits(options = {}) {
  const { cwd = process.cwd(), all = true, limit, file, revs } = options;

  if (!isRepo(cwd)) {
    throw new GitError(`not a git repository: ${cwd}`, { code: 'NOT_A_REPO' });
  }

  const format = LOG_FIELDS.map(([placeholder]) => placeholder).join(FIELD) + RECORD;
  const args = ['log', '--parents', `--pretty=format:${format}`];
  if (all && !revs) args.push('--all');
  if (typeof limit === 'number' && limit > 0) args.push(`--max-count=${limit}`);
  if (revs && revs.length) args.push(...revs);
  if (file) args.push('--', file);

  // An empty repository has no commits at all and git exits non-zero there,
  // which is a normal state for us rather than an error.
  const raw = git(args, { cwd, allowFailure: true });
  const commits = raw === null ? [] : parseLog(raw);

  const byHash = new Map(commits.map((commit) => [commit.hash, commit]));
  return { commits, byHash, head: head(cwd) };
}

/** Turn raw `git log` output in our separator format into commit objects. */
function parseLog(raw) {
  const commits = [];
  for (const record of raw.split(RECORD)) {
    const line = record.replace(/^\r?\n/, '');
    if (!line.trim()) continue;

    const parts = line.split(FIELD);
    if (parts.length < LOG_FIELDS.length) continue; // malformed record: skip it

    const commit = {};
    LOG_FIELDS.forEach(([, key], index) => {
      commit[key] = parts[index];
    });

    // `--parents` also prefixes the line with a hash list, but the %P field is
    // the authoritative copy, so we normalise from that.
    commit.parents = commit.parentsRaw.trim() ? commit.parentsRaw.trim().split(/\s+/) : [];
    commit.refs = parseRefs(commit.refsRaw);
    commit.isMerge = commit.parents.length > 1;
    commit.isRoot = commit.parents.length === 0;
    delete commit.parentsRaw;
    delete commit.refsRaw;

    commits.push(commit);
  }
  return commits;
}

/** Files touched by a single commit (for a merge, files differing from parent 1). */
function filesChanged(rev, { cwd = process.cwd() } = {}) {
  const out = git(['show', '--name-only', '--pretty=format:', '--first-parent', rev], {
    cwd,
    allowFailure: true,
  });
  if (out === null) return [];
  const seen = new Set();
  for (const line of out.split('\n')) {
    const name = line.trim();
    if (name) seen.add(name);
  }
  return [...seen];
}

/** Resolve a revision string ("HEAD~2", "main", "abc123") to a full commit hash. */
function resolveRev(rev, { cwd = process.cwd() } = {}) {
  const out = git(['rev-parse', '--verify', `${rev}^{commit}`], { cwd, allowFailure: true });
  if (out === null) {
    throw new GitError(`unknown revision: ${rev}`, { code: 'BAD_REV' });
  }
  return out.trim();
}

/** Contents of `path` at `rev`, or null when the file does not exist there. */
function fileAtCommit(rev, path, { cwd = process.cwd() } = {}) {
  const out = git(['show', `${rev}:${path}`], { cwd, allowFailure: true });
  return out === null ? null : out;
}

/**
 * Paths that differ between two revisions, with their change status and
 * whether git considers them binary.
 *
 * `--numstat` prints "-\t-" instead of line counts for binary content, which
 * is the cheapest reliable binary check available: it uses git's own
 * detection rather than us guessing from bytes.
 */
function changedPaths(revA, revB, { cwd = process.cwd() } = {}) {
  const out = git(['diff', '--name-status', revA, revB], { cwd, allowFailure: true });
  if (out === null) return [];

  const binary = new Set();
  const numstat = git(['diff', '--numstat', revA, revB], { cwd, allowFailure: true });
  if (numstat !== null) {
    for (const line of numstat.split('\n')) {
      const columns = line.split('\t');
      if (columns.length >= 3 && columns[0] === '-' && columns[1] === '-') {
        binary.add(columns[columns.length - 1]);
      }
    }
  }

  return out
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const columns = line.split('\t');
      const path = columns[columns.length - 1];
      return { status: columns[0][0], path, binary: binary.has(path) };
    });
}

module.exports = {
  GitError,
  git,
  isRepo,
  repoRoot,
  head,
  readCommits,
  parseLog,
  parseRefs,
  filesChanged,
  resolveRev,
  fileAtCommit,
  changedPaths,
  FIELD,
  RECORD,
};
