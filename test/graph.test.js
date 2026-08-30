'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const reader = require('../src/git-reader');
const { buildGraph, topoSort, compactLanes } = require('../src/graph/build-graph');
const { renderAscii } = require('../src/graph/render-ascii');
const { makeRepo, commit, git, cleanup } = require('./helpers');

/** Build a repo with two branches and two merges. */
function branchyRepo() {
  const dir = makeRepo();
  commit(dir, 'app.js', 'one\n', 'Initial commit');
  commit(dir, 'app.js', 'one\ntwo\n', 'Second commit');
  git(dir, ['checkout', '-q', '-b', 'feature']);
  commit(dir, 'feature.txt', 'hello\n', 'Add feature', 'Grace Hopper');
  git(dir, ['checkout', '-q', 'main']);
  commit(dir, 'README.md', 'readme\n', 'Add readme', 'Test Author');
  git(dir, ['merge', '-q', '--no-ff', 'feature', '-m', 'Merge feature']);
  return dir;
}

test('an empty repository yields no commits and an empty HEAD', () => {
  const dir = makeRepo();
  try {
    const { commits, head } = reader.readCommits({ cwd: dir });
    assert.deepEqual(commits, []);
    assert.equal(head.empty, true);
    assert.equal(head.hash, null);
    assert.deepEqual(buildGraph(commits).rows, []);
  } finally {
    cleanup(dir);
  }
});

test('a single commit is a root with no parents', () => {
  const dir = makeRepo();
  try {
    commit(dir, 'a.txt', 'x\n', 'Only commit');
    const { commits } = reader.readCommits({ cwd: dir });
    assert.equal(commits.length, 1);
    assert.deepEqual(commits[0].parents, []);
    assert.equal(commits[0].isRoot, true);
    assert.equal(commits[0].isMerge, false);

    const graph = buildGraph(commits);
    assert.equal(graph.rows.length, 1);
    assert.equal(graph.rows[0].lane, 0);
  } finally {
    cleanup(dir);
  }
});

test('a merge commit records both parents and opens a second lane', () => {
  const dir = branchyRepo();
  try {
    const { commits } = reader.readCommits({ cwd: dir });
    const merge = commits.find((c) => c.isMerge);
    assert.ok(merge, 'expected a merge commit');
    assert.equal(merge.parents.length, 2);

    const graph = buildGraph(commits);
    assert.ok(graph.width >= 2, 'a branchy history needs at least two lanes');
    const mergeRow = graph.rows.find((row) => row.commit.hash === merge.hash);
    assert.equal(mergeRow.parentLanes.length, 2);
    assert.notEqual(mergeRow.parentLanes[0], mergeRow.parentLanes[1]);
  } finally {
    cleanup(dir);
  }
});

test('topological order always places a commit before its parents', () => {
  const dir = branchyRepo();
  try {
    const { commits } = reader.readCommits({ cwd: dir });
    const ordered = topoSort(commits);
    const position = new Map(ordered.map((commit, index) => [commit.hash, index]));

    for (const commit of ordered) {
      for (const parent of commit.parents) {
        if (!position.has(parent)) continue;
        assert.ok(
          position.get(commit.hash) < position.get(parent),
          `${commit.shortHash} must be drawn above its parent`,
        );
      }
    }
  } finally {
    cleanup(dir);
  }
});

test('detached HEAD is reported as detached', () => {
  const dir = branchyRepo();
  try {
    git(dir, ['checkout', '-q', '--detach', 'HEAD~1']);
    const head = reader.head(dir);
    assert.equal(head.detached, true);
    assert.equal(head.branch, null);
    assert.match(head.hash, /^[0-9a-f]{40}$/);
  } finally {
    cleanup(dir);
  }
});

test('render produces one node line per commit and no escape codes when plain', () => {
  const dir = branchyRepo();
  try {
    const { commits } = reader.readCommits({ cwd: dir });
    const output = renderAscii(buildGraph(commits), { color: false, maxWidth: 200 });
    assert.ok(!output.includes('\x1b['));

    const nodeLines = output.split('\n').filter((line) => /[*Mo]/.test(line.split(/\s{2,}/)[0]));
    assert.equal(nodeLines.length, commits.length);
    assert.ok(output.includes('Merge feature'));
    assert.ok(output.includes('(main)') || output.includes('main'));
  } finally {
    cleanup(dir);
  }
});

test('malformed git output is skipped rather than crashing the parser', () => {
  const parsed = reader.parseLog(`garbage without separators${reader.RECORD}`);
  assert.deepEqual(parsed, []);
});

test('reading a directory that is not a repository throws GitError', () => {
  assert.throws(() => reader.readCommits({ cwd: require('node:os').tmpdir() }), (err) => {
    assert.ok(err instanceof reader.GitError);
    assert.equal(err.code, 'NOT_A_REPO');
    return true;
  });
});

test('a merge draws a single opening diagonal, not a doubled bar', () => {
  const dir = branchyRepo();
  try {
    const { commits } = reader.readCommits({ cwd: dir });
    const output = renderAscii(buildGraph(commits), { color: false, maxWidth: 200 });
    const isConnector = (line) => line.trim() !== '' && /^[|\\/_ ]+$/.test(line);
    const connectors = output.split('\n').filter(isConnector);

    assert.ok(connectors.length > 0, 'a branchy history must produce connector rows');
    assert.ok(
      connectors.some((line) => line.startsWith('|\\')),
      'expected a merge to open a lane with a diagonal',
    );
    assert.ok(
      connectors.every((line) => !line.endsWith('\\|')),
      'a lane opened by a merge must not also be drawn as a vertical bar',
    );
  } finally {
    cleanup(dir);
  }
});

test('lane layout never leaves a hole between active lanes', () => {
  const dir = branchyRepo();
  try {
    const { commits } = reader.readCommits({ cwd: dir });
    const graph = buildGraph(commits);

    for (const row of graph.rows) {
      const holeIndex = row.lanesAfter.findIndex((hash) => !hash);
      if (holeIndex === -1) continue;
      const occupiedAfterHole = row.lanesAfter.slice(holeIndex).some(Boolean);
      assert.ok(
        !occupiedAfterHole,
        `row ${row.commit.shortHash} leaves an empty lane with active lanes to its right`,
      );
    }
  } finally {
    cleanup(dir);
  }
});

test('compactLanes slides lanes left and reports the moves', () => {
  const lanes = ['a', null, 'c', null, 'e'];
  const moves = compactLanes(lanes);

  assert.deepEqual(lanes, ['a', 'c', 'e']);
  assert.deepEqual(moves, [
    { from: 2, to: 1 },
    { from: 4, to: 2 },
  ]);
});

test('compactLanes leaves an already dense layout untouched', () => {
  const lanes = ['a', 'b', 'c'];
  assert.deepEqual(compactLanes(lanes), []);
  assert.deepEqual(lanes, ['a', 'b', 'c']);
});
