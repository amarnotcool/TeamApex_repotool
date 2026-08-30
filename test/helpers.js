'use strict';

/**
 * Test helpers — build throwaway git repositories on disk.
 *
 * We test against real repositories rather than mocked git output, because
 * the parser's job is precisely to survive what git actually prints.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function run(cwd, args, env) {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    windowsHide: true,
    env: env ? { ...process.env, ...env } : process.env,
  });
}

/** Create an empty repository in a fresh temp directory. */
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repotool-test-'));
  run(dir, ['init', '-q', '-b', 'main']);
  run(dir, ['config', 'user.email', 'test@example.com']);
  run(dir, ['config', 'user.name', 'Test Author']);
  run(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
}

/** Write a file and commit it. */
function commit(dir, file, contents, message, author) {
  fs.writeFileSync(path.join(dir, file), contents);
  if (author) run(dir, ['config', 'user.name', author]);
  run(dir, ['add', '.']);
  run(dir, ['commit', '-q', '-m', message]);
}

/**
 * Commit with an explicit timestamp, for tests about rates over time.
 * `when` is anything git accepts, e.g. "2026-01-05T12:00:00".
 */
function commitAt(dir, when, file, contents, message, author) {
  fs.writeFileSync(path.join(dir, file), contents);
  if (author) run(dir, ['config', 'user.name', author]);
  run(dir, ['add', '.']);
  run(dir, ['commit', '-q', '-m', message], {
    GIT_AUTHOR_DATE: when,
    GIT_COMMITTER_DATE: when,
  });
}

function git(dir, args) {
  run(dir, args);
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { makeRepo, commit, commitAt, git, cleanup };
