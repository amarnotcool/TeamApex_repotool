'use strict';

/**
 * compare tests.
 *
 * `A..B` is git's own definition of "reachable from B but not from A", so the
 * assertions here are about known ahead/behind counts on repositories built
 * for the purpose, plus the two shapes that are easy to get wrong: unrelated
 * histories, and a ref compared with itself.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { compareRefs } = require('../src/analysis/compare');
const { renderCompare } = require('../src/analysis/render-compare');
const { makeRepo, commit, git, cleanup } = require('./helpers');

const CLI = path.join(__dirname, '..', 'bin', 'repotool.js');

function runCli(args, cwd) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * main and feature diverge from a shared base:
 *   main    +1 commit  (Ada)
 *   feature +2 commits (Grace)
 */
function divergedRepo() {
  const dir = makeRepo();
  commit(dir, 'base.js', 'base\n', 'Add base', 'Ada Lovelace');
  git(dir, ['checkout', '-q', '-b', 'feature']);
  commit(dir, 'feature.js', 'one\n', 'Add feature', 'Grace Hopper');
  commit(dir, 'feature.js', 'one\ntwo\n', 'Extend feature', 'Grace Hopper');
  git(dir, ['checkout', '-q', 'main']);
  commit(dir, 'main.js', 'main\n', 'Add main file', 'Ada Lovelace');
  return dir;
}

test('a diverged branch reports ahead and behind counts both ways', () => {
  const dir = divergedRepo();
  try {
    const result = compareRefs('main', 'feature', { cwd: dir });

    assert.equal(result.a.commits, 1, 'main has one commit feature lacks');
    assert.equal(result.b.commits, 2, 'feature has two commits main lacks');
    assert.equal(result.identical, false);
    assert.ok(result.mergeBase, 'they share a base commit');

    assert.equal(result.a.range, 'feature..main');
    assert.equal(result.b.range, 'main..feature');

    assert.deepEqual(result.a.onlyContributors.map((author) => author.name), ['Ada Lovelace']);
    assert.deepEqual(result.b.onlyContributors.map((author) => author.name), ['Grace Hopper']);
    assert.deepEqual(result.sharedContributors, []);

    assert.deepEqual(result.a.files.map((file) => file.path), ['main.js']);
    assert.deepEqual(result.b.files.map((file) => file.path), ['feature.js']);
    assert.ok(result.b.churn > 0);
  } finally {
    cleanup(dir);
  }
});

test('the comparison is symmetric when the refs are swapped', () => {
  const dir = divergedRepo();
  try {
    const forward = compareRefs('main', 'feature', { cwd: dir });
    const backward = compareRefs('feature', 'main', { cwd: dir });

    assert.equal(forward.a.commits, backward.b.commits);
    assert.equal(forward.b.commits, backward.a.commits);
    assert.equal(forward.mergeBase, backward.mergeBase);
  } finally {
    cleanup(dir);
  }
});

test('a ref compared with itself is zero difference, not an error', () => {
  const dir = divergedRepo();
  try {
    const result = compareRefs('main', 'main', { cwd: dir });

    assert.equal(result.identical, true);
    assert.equal(result.a.commits, 0);
    assert.equal(result.b.commits, 0);
    assert.equal(result.a.churn, 0);
    assert.equal(result.b.churn, 0);

    const output = renderCompare('main', 'main', { cwd: dir, color: false });
    assert.match(output, /same commit/);

    // Exit code stays 0: asking a question with a boring answer is not failure.
    const stdout = runCli(['compare', 'main', 'main'], dir);
    assert.match(stdout, /nothing to compare/);
  } finally {
    cleanup(dir);
  }
});

test('unrelated histories are reported rather than failing', () => {
  const dir = makeRepo();
  try {
    commit(dir, 'a.js', 'a\n', 'Add a', 'Ada Lovelace');
    // An orphan branch shares no ancestor with main at all.
    git(dir, ['checkout', '-q', '--orphan', 'other']);
    git(dir, ['rm', '-rq', '--cached', '.']);
    commit(dir, 'b.js', 'b\n', 'Add b on an unrelated root', 'Grace Hopper');
    git(dir, ['checkout', '-q', 'main']);

    const result = compareRefs('main', 'other', { cwd: dir });

    assert.equal(result.mergeBase, null);
    assert.equal(result.a.commits, 1);
    assert.equal(result.b.commits, 1);

    const output = renderCompare('main', 'other', { cwd: dir, color: false });
    assert.match(output, /share no history/);
  } finally {
    cleanup(dir);
  }
});

test('a linear ancestor comparison is ahead on one side only', () => {
  const dir = makeRepo();
  try {
    commit(dir, 'a.js', 'a\n', 'First');
    commit(dir, 'b.js', 'b\n', 'Second');
    commit(dir, 'c.js', 'c\n', 'Third');

    const result = compareRefs('HEAD~2', 'HEAD', { cwd: dir });
    assert.equal(result.a.commits, 0, 'the ancestor has nothing the tip lacks');
    assert.equal(result.b.commits, 2);
    assert.equal(result.b.filesChanged, 2);
  } finally {
    cleanup(dir);
  }
});

test('tags compare like any other ref', () => {
  const dir = makeRepo();
  try {
    commit(dir, 'a.js', 'a\n', 'First');
    git(dir, ['tag', 'v1']);
    commit(dir, 'b.js', 'b\n', 'Second');
    git(dir, ['tag', 'v2']);

    const result = compareRefs('v1', 'v2', { cwd: dir });
    assert.equal(result.b.commits, 1);
    assert.equal(result.a.commits, 0);
  } finally {
    cleanup(dir);
  }
});

test('compare --json covers both directions with the same shape', () => {
  const dir = divergedRepo();
  try {
    const parsed = JSON.parse(runCli(['compare', 'main', 'feature', '--json'], dir));

    assert.deepEqual(Object.keys(parsed), [
      'refA',
      'refB',
      'hashA',
      'hashB',
      'identical',
      'mergeBase',
      'a',
      'b',
      'sharedContributors',
      'sharedFiles',
    ]);
    assert.deepEqual(Object.keys(parsed.a), Object.keys(parsed.b), 'both sides serialise identically');
    assert.deepEqual(Object.keys(parsed.a), [
      'ref',
      'range',
      'commits',
      'merges',
      'filesChanged',
      'added',
      'removed',
      'churn',
      'first',
      'last',
      'contributors',
      'onlyContributors',
      'files',
    ]);
    assert.equal(parsed.a.commits, 1);
    assert.equal(parsed.b.commits, 2);
  } finally {
    cleanup(dir);
  }
});

test('compare needs two revisions and rejects an unknown one', () => {
  const dir = divergedRepo();
  try {
    try {
      execFileSync(process.execPath, [CLI, 'compare', 'main'], { cwd: dir, encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
      assert.fail('expected a usage error');
    } catch (err) {
      assert.equal(err.status, 2);
      assert.match(String(err.stderr), /needs two revisions/);
    }

    try {
      execFileSync(process.execPath, [CLI, 'compare', 'main', 'nope'], { cwd: dir, encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
      assert.fail('expected an unknown revision error');
    } catch (err) {
      assert.equal(err.status, 1);
      assert.match(String(err.stderr), /unknown revision: nope/);
    }
  } finally {
    cleanup(dir);
  }
});
