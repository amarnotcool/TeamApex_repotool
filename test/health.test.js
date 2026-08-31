'use strict';

/**
 * health tests.
 *
 * Each dimension is a stated formula, so each test builds a repository whose
 * answer can be worked out by hand and asserts that exact number — a score
 * nobody can reproduce is the thing this command exists to avoid.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { buildRepoModel, clearCache } = require('../src/analysis/repo-model');
const { computeHealth, fileCommitThreshold, FIX_PATTERN, bandFor } = require('../src/analysis/health');
const { renderHealth } = require('../src/analysis/render-health');
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

function healthOf(dir) {
  clearCache();
  return computeHealth(buildRepoModel({ cwd: dir, fresh: true }));
}

/** Two authors, spread over days, ordinary commit subjects. */
function balancedRepo() {
  const dir = makeRepo();
  commitAt(dir, '2026-01-01T09:00:00', 'a.js', 'a1\n', 'Add a', 'Ada Lovelace');
  commitAt(dir, '2026-01-02T09:00:00', 'b.js', 'b1\n', 'Add b', 'Grace Hopper');
  commitAt(dir, '2026-01-03T09:00:00', 'c.js', 'c1\n', 'Add c', 'Ada Lovelace');
  commitAt(dir, '2026-01-04T09:00:00', 'd.js', 'd1\n', 'Add d', 'Grace Hopper');
  return dir;
}

test('a balanced repository scores every dimension it can measure', () => {
  const dir = balancedRepo();
  try {
    const health = healthOf(dir);

    assert.equal(health.empty, false);
    // Two authors, two commits each: the leader holds exactly half.
    assert.equal(health.collaboration.share, 0.5);
    assert.equal(health.collaboration.score, 50);
    // No fix-shaped subjects at all.
    assert.equal(health.stability.fixCommits, 0);
    assert.equal(health.stability.score, 100);
    assert.ok(health.overall.score !== null);
    assert.ok(['EXCELLENT', 'GOOD', 'FAIR', 'NEEDS ATTENTION'].includes(health.overall.band));
  } finally {
    cleanup(dir);
  }
});

test('one dominant contributor scores Collaboration low and fires the warning', () => {
  const dir = makeRepo();
  try {
    for (let i = 0; i < 9; i++) {
      commitAt(dir, `2026-02-0${i + 1}T09:00:00`, `f${i}.js`, `${i}\n`, `Add file ${i}`, 'Solo Dev');
    }
    commitAt(dir, '2026-02-10T09:00:00', 'other.js', 'x\n', 'Add other', 'Someone Else');

    const health = healthOf(dir);

    // 9 of 10 commits: 100 - 90 = 10.
    assert.equal(health.collaboration.topContributor, 'Solo Dev');
    assert.equal(health.collaboration.topCommits, 9);
    assert.equal(health.collaboration.share, 0.9);
    assert.equal(health.collaboration.score, 10);

    const warning = health.warnings.find((entry) => entry.code === 'contributor');
    assert.ok(warning, 'the >70% contributor warning must fire');
    assert.match(warning.message, /Solo Dev made 90% of all commits/);
    assert.equal(warning.threshold, 0.7);
  } finally {
    cleanup(dir);
  }
});

test('a history of fixes and reverts scores Stability low', () => {
  const dir = makeRepo();
  try {
    const subjects = [
      'Add feature',
      'Fix crash on startup',
      'Revert "Add feature"',
      'hotfix: null pointer',
      'Fixed the broken parser',
      'Add docs',
      'bug: wrong total',
      'Handle regression in totals',
    ];
    subjects.forEach((subject, index) => {
      commitAt(dir, `2026-03-0${index + 1}T09:00:00`, `f${index}.js`, `${index}\n`, subject, 'Ada Lovelace');
    });

    const health = healthOf(dir);

    // Six of the eight subjects match; 100 - 75 = 25.
    assert.equal(health.stability.totalCommits, 8);
    assert.equal(health.stability.fixCommits, 6);
    assert.equal(health.stability.share, 0.75);
    assert.equal(health.stability.score, 25);
  } finally {
    cleanup(dir);
  }
});

test('the fix pattern matches whole words only', () => {
  for (const subject of ['Fix crash', 'revert this', 'HOTFIX now', 'a bug appeared', 'regression found']) {
    assert.ok(FIX_PATTERN.test(subject), `${subject} should match`);
  }
  for (const subject of ['Add prefix handling', 'Rename debugger util', 'Affix the label', 'Refactor bugsnag-free code']) {
    assert.ok(!FIX_PATTERN.test(subject), `${subject} should not match`);
  }
});

test('churn concentrated in one file scores Concentration low and warns', () => {
  const dir = makeRepo();
  try {
    const big = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    commitAt(dir, '2026-04-01T09:00:00', 'hot.js', `${big}\n`, 'Add hot file', 'Ada Lovelace');
    commitAt(dir, '2026-04-02T09:00:00', 'hot.js', `${big}\nmore\n`, 'Extend hot file', 'Ada Lovelace');
    commitAt(dir, '2026-04-03T09:00:00', 'small.js', 'x\n', 'Add small file', 'Ada Lovelace');

    const health = healthOf(dir);

    assert.ok(health.concentration.share > 0.9, 'nearly all churn is in one file');
    assert.ok(health.concentration.score < 10);
    assert.ok(
      health.warnings.some((warning) => warning.code === 'concentration'),
      'the >50% concentration warning must fire',
    );
  } finally {
    cleanup(dir);
  }
});

test('the file-churn warning threshold scales with history length', () => {
  // max(5, 25% of commits)
  assert.equal(fileCommitThreshold(4), 5);
  assert.equal(fileCommitThreshold(20), 5);
  assert.equal(fileCommitThreshold(40), 10);
  assert.equal(fileCommitThreshold(100), 25);
});

test('a history too short or too compressed reports Activity as unmeasurable', () => {
  const dir = makeRepo();
  try {
    // Three commits, all on one day: neither period spans a day, so a rate
    // ratio would be an artefact of clamping rather than a measurement.
    commit(dir, 'a.js', 'a\n', 'Add a');
    commit(dir, 'b.js', 'b\n', 'Add b');
    commit(dir, 'c.js', 'c\n', 'Add c');

    const health = healthOf(dir);

    assert.equal(health.activity.score, null, 'no number may be invented here');
    assert.match(health.activity.reason, /too little history|under a day/);
    assert.ok(!health.overall.dimensions.includes('activity'));
    assert.ok(health.overall.score !== null, 'the other three dimensions still produce an overall');

    const output = renderHealth(buildRepoModel({ cwd: dir, fresh: true }), { color: false });
    assert.match(output, /Activity/);
    assert.ok(!/Activity\s+\d/.test(output), 'an unmeasurable dimension prints no score');
  } finally {
    cleanup(dir);
  }
});

test('Activity is measured when the history genuinely spans days', () => {
  const dir = makeRepo();
  try {
    // Slow first, then busy: the recent quarter is one commit inside a day, so
    // this asserts the measured path via a longer spread.
    for (let day = 1; day <= 8; day++) {
      const date = `2026-05-${String(day).padStart(2, '0')}T09:00:00`;
      commitAt(dir, date, `slow${day}.js`, `${day}\n`, `Slow commit ${day}`, 'Ada Lovelace');
    }
    for (let i = 0; i < 4; i++) {
      commitAt(dir, `2026-05-${10 + i}T09:00:00`, `fast${i}.js`, `${i}\n`, `Fast commit ${i}`, 'Ada Lovelace');
    }

    const health = healthOf(dir);

    // Recent window is the newest quarter (3 commits over 2 days = 1.5/day);
    // the baseline is the other 9 over 9 days = 1/day. 1.5x of a 3x cap = 50.
    assert.equal(health.activity.comparable, true);
    assert.equal(health.activity.ratio, 1.5);
    assert.equal(health.activity.score, 50);
    assert.ok(health.overall.dimensions.includes('activity'));
  } finally {
    cleanup(dir);
  }
});

test('band boundaries map exactly as documented', () => {
  assert.equal(bandFor(100), 'EXCELLENT');
  assert.equal(bandFor(80), 'EXCELLENT');
  assert.equal(bandFor(79), 'GOOD');
  assert.equal(bandFor(60), 'GOOD');
  assert.equal(bandFor(59), 'FAIR');
  assert.equal(bandFor(40), 'FAIR');
  assert.equal(bandFor(39), 'NEEDS ATTENTION');
  assert.equal(bandFor(0), 'NEEDS ATTENTION');
});

test('an empty repository says so and exits 0', () => {
  const dir = makeRepo();
  try {
    const health = healthOf(dir);
    assert.equal(health.empty, true);
    assert.equal(health.overall.score, null);
    assert.deepEqual(health.warnings, []);

    const output = runCli(['health'], dir);
    assert.match(output, /not enough history/i);
  } finally {
    cleanup(dir);
  }
});

test('health works on a detached HEAD', () => {
  const dir = balancedRepo();
  try {
    execFileSync('git', ['checkout', '-q', '--detach', 'HEAD~1'], { cwd: dir, stdio: 'ignore', windowsHide: true });
    const output = runCli(['health'], dir);
    assert.match(output, /Collaboration/);
    const parsed = JSON.parse(runCli(['health', '--json'], dir));
    assert.equal(parsed.repository.head.detached, true);
    assert.equal(parsed.empty, false);
  } finally {
    cleanup(dir);
  }
});

test('the report prints every formula it used', () => {
  const dir = balancedRepo();
  try {
    const output = renderHealth(buildRepoModel({ cwd: dir, fresh: true }), { color: false });
    assert.match(output, /Formulas/);
    assert.match(output, /÷ total churn × 100/);
    assert.match(output, /÷ total commits × 100/);
    assert.match(output, /EXCELLENT/);
    // Nothing here may present itself as a judgement rather than arithmetic.
    assert.ok(!/\bAI\b|smart score|intelligent/i.test(output));
  } finally {
    cleanup(dir);
  }
});

test('health --json carries the evidence, not just the scores', () => {
  const dir = balancedRepo();
  try {
    const parsed = JSON.parse(runCli(['health', '--json'], dir));

    assert.deepEqual(Object.keys(parsed), [
      'repository',
      'empty',
      'overall',
      'activity',
      'concentration',
      'stability',
      'collaboration',
      'warnings',
    ]);
    assert.deepEqual(Object.keys(parsed.overall), ['score', 'band', 'dimensions']);
    assert.equal(typeof parsed.collaboration.share, 'number');
    assert.equal(typeof parsed.collaboration.topCommits, 'number');
    assert.equal(typeof parsed.stability.fixCommits, 'number');
    assert.equal(typeof parsed.concentration.totalChurn, 'number');
    assert.ok(Array.isArray(parsed.concentration.files));
    assert.ok(Array.isArray(parsed.warnings));
    assert.equal(typeof parsed.stability.formula, 'string');
  } finally {
    cleanup(dir);
  }
});

test('health --help documents the formulas and the bands', () => {
  const output = runCli(['help', 'health']);
  assert.match(output, /80-100 EXCELLENT/);
  assert.match(output, /NEEDS ATTENTION/);
  assert.match(output, /min\(recent commits\/day/);
  assert.match(output, /25% of all commits/);
});
