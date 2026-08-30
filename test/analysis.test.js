'use strict';

/**
 * Tests for the shared repository model and the reports built on it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const reader = require('../src/git-reader');
const model = require('../src/analysis/repo-model');
const { renderStats } = require('../src/analysis/render-stats');
const { renderHotspots } = require('../src/analysis/render-hotspots');
const format = require('../src/format');
const { makeRepo, commit, git, cleanup } = require('./helpers');

/**
 * A repository where change is deliberately uneven:
 *   hot.js    touched by 3 commits and 2 authors, large edits
 *   warm.js   touched by 2 commits, 1 author
 *   cold.js   touched once
 */
function unevenRepo() {
  const dir = makeRepo();
  commit(dir, 'hot.js', 'a\nb\nc\n', 'Add hot');
  commit(dir, 'cold.js', 'x\n', 'Add cold');
  commit(dir, 'hot.js', 'a\nb\nc\nd\ne\nf\ng\n', 'Grow hot', 'Grace Hopper');
  commit(dir, 'warm.js', 'w\n', 'Add warm', 'Test Author');
  commit(dir, 'warm.js', 'w\nw2\n', 'Extend warm');
  commit(dir, 'hot.js', 'a\n', 'Shrink hot');
  return dir;
}

test('the model counts commits, contributors and branches in one pass', () => {
  const dir = unevenRepo();
  try {
    model.clearCache();
    const built = model.buildRepoModel({ cwd: dir });

    assert.equal(built.totalCommits, 6);
    assert.equal(built.isEmpty, false);
    assert.equal(built.contributors.length, 2);
    assert.equal(built.contributors[0].name, 'Test Author', 'most prolific author leads');
    assert.equal(built.contributors[0].commits, 5);
    assert.equal(built.branches.local.length, 1);
    assert.equal(built.branches.remote.length, 0);
  } finally {
    cleanup(dir);
  }
});

test('the model tracks per-file commit counts, authors and churn', () => {
  const dir = unevenRepo();
  try {
    model.clearCache();
    const built = model.buildRepoModel({ cwd: dir });

    const hot = built.fileMap.get('hot.js');
    assert.equal(hot.commits, 3);
    assert.equal(hot.authors.size, 2, 'hot.js was touched by two people');
    assert.ok(hot.added > 0 && hot.removed > 0, 'hot.js both grew and shrank');

    const cold = built.fileMap.get('cold.js');
    assert.equal(cold.commits, 1);
    assert.equal(cold.authors.size, 1);

    // Totals are the sum of the per-file numbers, not a separate count.
    const summed = built.files.reduce((sum, file) => sum + file.churn, 0);
    assert.equal(built.totals.churn, summed);
  } finally {
    cleanup(dir);
  }
});

test('the model is cached per repository and invalidated by a new commit', () => {
  const dir = unevenRepo();
  try {
    model.clearCache();
    const first = model.buildRepoModel({ cwd: dir });
    const second = model.buildRepoModel({ cwd: dir });
    assert.equal(first, second, 'a repeat build should hand back the cached model');

    commit(dir, 'new.js', 'fresh\n', 'Add new');
    const third = model.buildRepoModel({ cwd: dir });
    assert.notEqual(first, third, 'a new commit must not be served from cache');
    assert.equal(third.totalCommits, first.totalCommits + 1);
  } finally {
    cleanup(dir);
  }
});

test('an empty repository yields an empty model rather than an error', () => {
  const dir = makeRepo();
  try {
    model.clearCache();
    const built = model.buildRepoModel({ cwd: dir });

    assert.equal(built.isEmpty, true);
    assert.equal(built.totalCommits, 0);
    assert.deepEqual(built.contributors, []);
    assert.deepEqual(built.files, []);
    assert.equal(built.head.empty, true);
    assert.equal(model.activityComparison(built), null);
  } finally {
    cleanup(dir);
  }
});

test('building a model outside a repository throws GitError', () => {
  model.clearCache();
  assert.throws(() => model.buildRepoModel({ cwd: require('node:os').tmpdir() }), (err) => {
    assert.equal(err.code, 'NOT_A_REPO');
    return true;
  });
});

test('numstat rename shapes are normalised to the current path', () => {
  assert.equal(reader.normaliseNumstatPath('old.js => new.js'), 'new.js');
  assert.equal(reader.normaliseNumstatPath('src/{old => new}/file.js'), 'src/new/file.js');
  assert.equal(reader.normaliseNumstatPath('plain/path.js'), 'plain/path.js');
});

test('binary files are recorded without inventing line counts', () => {
  const dir = makeRepo();
  const fs = require('node:fs');
  const path = require('node:path');
  try {
    commit(dir, 'text.txt', 'hello\n', 'Add text');
    fs.writeFileSync(path.join(dir, 'blob.bin'), Buffer.from([0, 1, 2, 0, 255]));
    git(dir, ['add', '.']);
    git(dir, ['commit', '-q', '-m', 'Add binary']);

    model.clearCache();
    const built = model.buildRepoModel({ cwd: dir });
    const blob = built.fileMap.get('blob.bin');

    assert.ok(blob, 'the binary file should still be tracked');
    assert.equal(blob.binary, true);
    assert.equal(blob.added, 0, 'binary content contributes no line counts');
    assert.equal(blob.removed, 0);
  } finally {
    cleanup(dir);
  }
});

test('hotspots rank the busiest file first and expose every signal', () => {
  const dir = unevenRepo();
  try {
    model.clearCache();
    const ranked = model.rankHotspots(model.buildRepoModel({ cwd: dir }));

    assert.equal(ranked[0].path, 'hot.js');
    assert.ok(ranked[0].score >= ranked[ranked.length - 1].score, 'scores descend');
    for (const file of ranked) {
      assert.equal(typeof file.commits, 'number');
      assert.equal(typeof file.authorCount, 'number');
      assert.equal(file.churn, file.added + file.removed);
    }
  } finally {
    cleanup(dir);
  }
});

test('hotspot sort modes reorder by the requested signal', () => {
  const dir = unevenRepo();
  try {
    model.clearCache();
    const built = model.buildRepoModel({ cwd: dir });

    const byCommits = model.rankHotspots(built, { sort: 'commits' });
    const byChurn = model.rankHotspots(built, { sort: 'churn' });
    const byAuthors = model.rankHotspots(built, { sort: 'authors' });

    assert.ok(byCommits[0].commits >= byCommits[1].commits);
    assert.ok(byChurn[0].churn >= byChurn[1].churn);
    assert.ok(byAuthors[0].authorCount >= byAuthors[1].authorCount);
  } finally {
    cleanup(dir);
  }
});

test('a repository dominated by one file ranks that file top by every measure', () => {
  const dir = makeRepo();
  try {
    // One file changed repeatedly and hugely; the others barely move.
    for (let i = 0; i < 6; i++) {
      const body = Array.from({ length: 40 + i * 20 }, (_, line) => `line ${line} rev ${i}`).join('\n');
      commit(dir, 'dominant.js', `${body}\n`, `Rework dominant ${i}`, i % 2 ? 'Grace Hopper' : 'Test Author');
    }
    commit(dir, 'quiet.js', 'q\n', 'Add quiet');

    model.clearCache();
    const built = model.buildRepoModel({ cwd: dir });

    for (const sort of ['score', 'commits', 'churn', 'authors']) {
      assert.equal(model.rankHotspots(built, { sort })[0].path, 'dominant.js', `dominant.js should lead by ${sort}`);
    }

    const dominant = built.fileMap.get('dominant.js');
    assert.ok(
      dominant.churn > built.totals.churn * 0.9,
      'the dominant file should account for the overwhelming majority of churn',
    );
  } finally {
    cleanup(dir);
  }
});

test('file contributors and path matching resolve real paths', () => {
  const dir = unevenRepo();
  try {
    model.clearCache();
    const built = model.buildRepoModel({ cwd: dir });

    const contributors = model.fileContributors(built, 'hot.js');
    assert.equal(contributors.length, 2);
    assert.ok(contributors[0].commits >= contributors[1].commits);

    assert.deepEqual(model.matchFiles(built, 'hot.js'), ['hot.js'], 'an exact path matches itself');
    assert.ok(model.matchFiles(built, 'hot').includes('hot.js'), 'a fragment matches');
    assert.deepEqual(model.matchFiles(built, 'nothing-like-this'), []);
    assert.deepEqual(model.fileContributors(built, 'missing.js'), []);
  } finally {
    cleanup(dir);
  }
});

test('activity comparison splits history and computes real rates', () => {
  const dir = unevenRepo();
  try {
    model.clearCache();
    const activity = model.activityComparison(model.buildRepoModel({ cwd: dir }), { windowSize: 2 });

    assert.equal(activity.recent.commits, 2);
    assert.equal(activity.baseline.commits, 4);
    assert.ok(activity.recent.perDay > 0);
    assert.ok(activity.topRecentAuthors.length >= 1);
    assert.ok(activity.concentration.share >= 0 && activity.concentration.share <= 1);
  } finally {
    cleanup(dir);
  }
});

test('activity comparison survives a single-commit history', () => {
  const dir = makeRepo();
  try {
    commit(dir, 'only.js', 'one\n', 'Only commit');
    model.clearCache();
    const activity = model.activityComparison(model.buildRepoModel({ cwd: dir }));

    assert.equal(activity.recent.commits, 1);
    assert.equal(activity.baseline, null, 'there is no baseline to compare against');
    assert.equal(activity.rateRatio, null);
  } finally {
    cleanup(dir);
  }
});

test('stats renders an overview with every headline number', () => {
  const dir = unevenRepo();
  try {
    model.clearCache();
    const output = renderStats(model.buildRepoModel({ cwd: dir }), { color: false });

    assert.match(output, /commits/);
    assert.match(output, /contributors/);
    assert.match(output, /branches\s+1 local, 0 remote/);
    assert.match(output, /line churn/);
    assert.match(output, /Top 3 contributors/);
    assert.match(output, /Top 3 most-changed files/);
    assert.match(output, /hot\.js/);
    assert.ok(!output.includes('\x1b['), 'colour disabled means no escape codes');
  } finally {
    cleanup(dir);
  }
});

test('stats on an empty repository says so instead of printing zeros everywhere', () => {
  const dir = makeRepo();
  try {
    model.clearCache();
    const output = renderStats(model.buildRepoModel({ cwd: dir }), { color: false });
    assert.match(output, /empty repository/);
    assert.match(output, /No commits yet/);
  } finally {
    cleanup(dir);
  }
});

test('stats reports a detached HEAD as detached', () => {
  const dir = unevenRepo();
  try {
    git(dir, ['checkout', '-q', '--detach', 'HEAD~1']);
    model.clearCache();
    const output = renderStats(model.buildRepoModel({ cwd: dir }), { color: false });
    assert.match(output, /detached HEAD at [0-9a-f]{7}/);
    assert.match(output, /Top 3 contributors/, 'the rest of the report still renders');
  } finally {
    cleanup(dir);
  }
});

test('hotspots renders a ranked table with its scoring explained', () => {
  const dir = unevenRepo();
  try {
    model.clearCache();
    const output = renderHotspots(model.buildRepoModel({ cwd: dir }), { color: false, limit: 2 });

    assert.match(output, /ranked by score \(commits 50% · churn 30% · authors 20%\)/);
    assert.match(output, /rank\s+score\s+commits\s+authors/);
    assert.match(output, /hot\.js/);
    assert.equal(output.split('\n').filter((line) => /^\s*\d+\./.test(line)).length, 2, '--limit caps the rows');
    assert.ok(!output.includes('\x1b['));
  } finally {
    cleanup(dir);
  }
});

test('hotspots on an empty repository explains itself', () => {
  const dir = makeRepo();
  try {
    model.clearCache();
    const output = renderHotspots(model.buildRepoModel({ cwd: dir }), { color: false });
    assert.match(output, /No commits yet/);
  } finally {
    cleanup(dir);
  }
});

test('format helpers group numbers, pad around colour, and describe spans', () => {
  assert.equal(format.count(1234567), '1,234,567');
  assert.equal(format.count(42), '42');
  assert.equal(format.churn(10, 5), '+10 / -5');
  assert.equal(format.percent(0.334), '33%');
  assert.equal(format.plural(1, 'commit'), '1 commit');
  assert.equal(format.plural(2, 'commit'), '2 commits');
  assert.equal(format.days(1), '1 day');
  assert.equal(format.days(0.2), 'under a day');

  // Padding must measure visible width, ignoring escape sequences.
  const coloured = '\x1b[31mred\x1b[0m';
  assert.equal(format.padEnd(coloured, 5), `${coloured}  `);
  assert.equal(format.padStart(coloured, 5), `  ${coloured}`);

  assert.equal(format.bar(0, 10, 8), '');
  assert.equal(format.bar(10, 10, 8).length, 8);
  assert.equal(format.relativeDate(new Date(Date.now() - 3 * 86400000).toISOString()), '3 days ago');
});

test('table alignment lines columns up without trailing whitespace', () => {
  const rendered = format.table(
    [
      ['1', 'short', 'x'],
      ['200', 'much longer', 'y'],
    ],
    [{ align: 'right' }],
  );
  const [first, second] = rendered.split('\n');
  assert.equal(first, '  1  short        x');
  assert.equal(second, '200  much longer  y');
  assert.ok(!/\s$/.test(first), 'no trailing whitespace');
});
