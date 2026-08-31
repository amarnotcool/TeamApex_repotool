'use strict';

/**
 * timeline tests.
 *
 * The bucketing is the part that can be wrong in ways nobody notices — a
 * timezone shift moving an evening commit into the next day, a quiet day
 * silently dropped, a week starting on the wrong weekday — so the assertions
 * are about bucket keys and counts, not about how the bars look.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { buildRepoModel, clearCache } = require('../src/analysis/repo-model');
const { buildTimeline, weekKey, fillRange } = require('../src/analysis/timeline');
const { renderTimeline } = require('../src/analysis/render-timeline');
const { makeRepo, commit, commitAt, cleanup } = require('./helpers');

const CLI = path.join(__dirname, '..', 'bin', 'repotool.js');

function runCli(args, cwd) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function modelOf(dir) {
  clearCache();
  return buildRepoModel({ cwd: dir, fresh: true });
}

/**
 * Four days of activity with a deliberate gap:
 *   Jun 1: 1, Jun 2: 3, Jun 3: 0, Jun 4: 2
 */
function spreadRepo() {
  const dir = makeRepo();
  commitAt(dir, '2026-06-01T09:00:00', 'a.js', 'a\n', 'Add a', 'Ada Lovelace');
  commitAt(dir, '2026-06-02T09:00:00', 'b.js', 'b\n', 'Add b', 'Ada Lovelace');
  commitAt(dir, '2026-06-02T13:00:00', 'c.js', 'c\n', 'Add c', 'Grace Hopper');
  commitAt(dir, '2026-06-02T21:30:00', 'd.js', 'd\n', 'Add d', 'Grace Hopper');
  commitAt(dir, '2026-06-04T09:00:00', 'e.js', 'e\n', 'Add e', 'Ada Lovelace');
  commitAt(dir, '2026-06-04T10:00:00', 'f.js', 'f\n', 'Add f', 'Ada Lovelace');
  return dir;
}

test('daily buckets count commits per calendar day, gaps included', () => {
  const dir = spreadRepo();
  try {
    const timeline = buildTimeline(modelOf(dir));

    assert.deepEqual(
      timeline.buckets.map((bucket) => [bucket.date, bucket.commits]),
      [
        ['2026-06-01', 1],
        ['2026-06-02', 3],
        ['2026-06-03', 0],
        ['2026-06-04', 2],
      ],
    );
    assert.equal(timeline.totalCommits, 6);
  } finally {
    cleanup(dir);
  }
});

test('a late-evening commit stays on its own local day', () => {
  const dir = spreadRepo();
  try {
    // 21:30 on Jun 2 would slide into Jun 3 if the bucket key went through a
    // UTC conversion; the count for Jun 2 is what catches that.
    const timeline = buildTimeline(modelOf(dir));
    const june2 = timeline.buckets.find((bucket) => bucket.date === '2026-06-02');
    assert.equal(june2.commits, 3);
  } finally {
    cleanup(dir);
  }
});

test('the peak day is the busiest bucket in the window', () => {
  const dir = spreadRepo();
  try {
    const timeline = buildTimeline(modelOf(dir));
    assert.deepEqual(timeline.peak, { date: '2026-06-02', commits: 3 });
  } finally {
    cleanup(dir);
  }
});

test('bars are proportional to the busiest bucket on screen', () => {
  const dir = spreadRepo();
  try {
    const output = renderTimeline(modelOf(dir), { color: false });
    const bars = output
      .split('\n')
      .filter((line) => line.includes('█'))
      .map((line) => (line.match(/█+/) || [''])[0].length);

    // Three rows carry bars (the empty day renders a dot), and the widest is
    // the peak; 1 commit against a peak of 3 is a third of the width.
    assert.equal(bars.length, 3);
    assert.equal(Math.max(...bars), 32);
    assert.equal(bars[0], Math.round((1 / 3) * 32));
    assert.equal(bars[2], Math.round((2 / 3) * 32));
    assert.match(output, /Commits: 6/);
    assert.match(output, /Peak: Jun 02/);
  } finally {
    cleanup(dir);
  }
});

test('a quiet day renders a placeholder rather than being dropped', () => {
  const dir = spreadRepo();
  try {
    const output = renderTimeline(modelOf(dir), { color: false });
    assert.match(output, /Jun 03\s+·/);
  } finally {
    cleanup(dir);
  }
});

test('--by week buckets on ISO weeks starting Monday', () => {
  const dir = makeRepo();
  try {
    // 2026-06-01 is a Monday; 2026-06-07 a Sunday; 2026-06-08 the next Monday.
    commitAt(dir, '2026-06-01T09:00:00', 'a.js', 'a\n', 'Add a', 'Ada Lovelace');
    commitAt(dir, '2026-06-07T09:00:00', 'b.js', 'b\n', 'Add b', 'Ada Lovelace');
    commitAt(dir, '2026-06-08T09:00:00', 'c.js', 'c\n', 'Add c', 'Ada Lovelace');

    const timeline = buildTimeline(modelOf(dir), { by: 'week' });
    assert.deepEqual(
      timeline.buckets.map((bucket) => [bucket.date, bucket.commits]),
      [
        ['2026-06-01', 2],
        ['2026-06-08', 1],
      ],
    );
    assert.equal(timeline.by, 'week');
  } finally {
    cleanup(dir);
  }
});

test('weekKey and fillRange behave on their own', () => {
  assert.equal(weekKey('2026-06-01'), '2026-06-01'); // Monday
  assert.equal(weekKey('2026-06-07'), '2026-06-01'); // Sunday belongs to it
  assert.equal(weekKey('2026-06-08'), '2026-06-08');
  assert.deepEqual(fillRange('2026-06-01', '2026-06-03', 'day'), ['2026-06-01', '2026-06-02', '2026-06-03']);
  assert.deepEqual(fillRange('2026-06-01', '2026-06-15', 'week'), ['2026-06-01', '2026-06-08', '2026-06-15']);
});

test('--limit keeps the most recent buckets', () => {
  const dir = spreadRepo();
  try {
    const timeline = buildTimeline(modelOf(dir), { limit: 2 });
    assert.deepEqual(
      timeline.buckets.map((bucket) => bucket.date),
      ['2026-06-03', '2026-06-04'],
    );
    // Totals and peak describe the window shown, so they stay checkable.
    assert.equal(timeline.totalCommits, 2);
    assert.deepEqual(timeline.peak, { date: '2026-06-04', commits: 2 });
  } finally {
    cleanup(dir);
  }
});

test('--metric lines and contributors aggregate the same buckets', () => {
  const dir = spreadRepo();
  try {
    const timeline = buildTimeline(modelOf(dir), { metric: 'contributors' });
    const june2 = timeline.buckets.find((bucket) => bucket.date === '2026-06-02');
    assert.equal(june2.contributors, 2, 'Ada and Grace both committed that day');
    assert.ok(june2.added > 0, 'line counts ride along on every bucket');

    const output = renderTimeline(modelOf(dir), { metric: 'lines', color: false });
    assert.match(output, /Bars show lines changed per day/);
  } finally {
    cleanup(dir);
  }
});

test('an empty repository charts nothing and exits 0', () => {
  const dir = makeRepo();
  try {
    const timeline = buildTimeline(modelOf(dir));
    assert.equal(timeline.empty, true);
    assert.deepEqual(timeline.buckets, []);
    assert.equal(timeline.peak, null);

    const output = runCli(['timeline'], dir);
    assert.match(output, /no activity to chart/i);
  } finally {
    cleanup(dir);
  }
});

test('a single commit renders one bucket without dividing by zero', () => {
  const dir = makeRepo();
  try {
    commit(dir, 'a.js', 'a\n', 'Only commit');
    const timeline = buildTimeline(modelOf(dir));

    assert.equal(timeline.buckets.length, 1);
    assert.equal(timeline.buckets[0].commits, 1);
    assert.equal(timeline.peak.commits, 1);

    const output = renderTimeline(modelOf(dir), { color: false });
    assert.match(output, /Commits: 1/);
    assert.match(output, /█/, 'the only bucket is also the peak, so it fills the bar');
  } finally {
    cleanup(dir);
  }
});

test('timeline --json has a stable schema', () => {
  const dir = spreadRepo();
  try {
    const parsed = JSON.parse(runCli(['timeline', '--json', '--limit', '4'], dir));

    assert.deepEqual(Object.keys(parsed), [
      'repository',
      'empty',
      'by',
      'metric',
      'buckets',
      'peak',
      'totalCommits',
    ]);
    assert.deepEqual(Object.keys(parsed.buckets[0]), ['date', 'commits', 'added', 'removed', 'contributors']);
    assert.deepEqual(parsed.peak, { date: '2026-06-02', commits: 3 });
    assert.equal(parsed.totalCommits, 6);
  } finally {
    cleanup(dir);
  }
});

test('timeline rejects an unknown bucket or metric', () => {
  const dir = spreadRepo();
  try {
    for (const args of [['timeline', '--by', 'month'], ['timeline', '--metric', 'files']]) {
      try {
        execFileSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
        assert.fail(`expected ${args.join(' ')} to fail`);
      } catch (err) {
        assert.equal(err.status, 2);
        assert.match(String(err.stderr), /must be one of/);
      }
    }
  } finally {
    cleanup(dir);
  }
});
