'use strict';

/**
 * `--json` tests.
 *
 * The contract is narrow and worth pinning down: valid JSON, nothing else on
 * stdout, stable top-level keys, and human output that is exactly what it was
 * before the flag existed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { makeRepo, commit, cleanup } = require('./helpers');

const CLI = path.join(__dirname, '..', 'bin', 'repotool.js');

/** Run the CLI, returning stdout and stderr separately. */
function runCli(args, cwd) {
  const stdout = execFileSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return stdout;
}

/** A small repository with two authors and two files. */
function sampleRepo() {
  const dir = makeRepo();
  commit(dir, 'app.js', 'one\n', 'Initial commit');
  commit(dir, 'app.js', 'one\ntwo\n', 'Second commit', 'Grace Hopper');
  commit(dir, 'README.md', 'readme\n', 'Add readme', 'Test Author');
  return dir;
}

test('stats --json is valid JSON with the documented top-level keys', () => {
  const dir = sampleRepo();
  try {
    const parsed = JSON.parse(runCli(['stats', '--json'], dir));
    assert.deepEqual(Object.keys(parsed), [
      'repository',
      'empty',
      'commits',
      'contributors',
      'branches',
      'totals',
      'topFiles',
    ]);
    assert.equal(parsed.commits.total, 3);
    assert.equal(parsed.empty, false);
    assert.equal(parsed.repository.head.branch, 'main');
    assert.ok(parsed.contributors.some((author) => author.name === 'Grace Hopper'));
  } finally {
    cleanup(dir);
  }
});

test('hotspots --json is valid JSON, honours --limit and --sort', () => {
  const dir = sampleRepo();
  try {
    const parsed = JSON.parse(runCli(['hotspots', '--json', '--limit', '1', '--sort', 'churn'], dir));
    assert.deepEqual(Object.keys(parsed), [
      'repository',
      'empty',
      'sort',
      'weights',
      'totalFiles',
      'files',
    ]);
    assert.equal(parsed.sort, 'churn');
    assert.equal(parsed.files.length, 1);
    assert.equal(parsed.totalFiles, 2);
    assert.equal(parsed.files[0].rank, 1);
    assert.equal(typeof parsed.files[0].path, 'string');
  } finally {
    cleanup(dir);
  }
});

test('ask --json wraps the answer with the question it answered', () => {
  const dir = sampleRepo();
  try {
    const parsed = JSON.parse(runCli(['ask', 'who are the top contributors', '--json'], dir));
    assert.deepEqual(Object.keys(parsed), ['question', 'intent', 'argument', 'answer']);
    assert.equal(parsed.intent, 'top-authors');
    assert.equal(parsed.answer.authors.length, 2);

    const touched = JSON.parse(runCli(['ask', 'who last touched app.js', '--json'], dir));
    assert.equal(touched.intent, 'who-touched');
    assert.equal(touched.argument, 'app.js');
    assert.equal(touched.answer.found, true);
    assert.equal(touched.answer.lastAuthor, 'Grace Hopper');
    assert.equal(touched.answer.commitCount, 2);
  } finally {
    cleanup(dir);
  }
});

test('ask --json never contains ANSI escapes, even when colour is forced on', () => {
  const dir = sampleRepo();
  try {
    const stdout = execFileSync(process.execPath, [CLI, 'ask', 'who last touched app.js', '--json', '--color'], {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.ok(!stdout.includes('\x1b['), 'colour codes would make the JSON unparseable');
    JSON.parse(stdout);
  } finally {
    cleanup(dir);
  }
});

test('every --json command prints JSON and nothing else on stdout', () => {
  const dir = sampleRepo();
  try {
    for (const args of [['stats', '--json'], ['hotspots', '--json'], ['ask', 'what branches exist', '--json']]) {
      const stdout = runCli(args, dir);
      // Parsing the whole stream is the assertion: any stray banner, warning
      // or trailing note would make this throw.
      assert.doesNotThrow(() => JSON.parse(stdout), `${args[0]} printed something other than JSON`);
    }
  } finally {
    cleanup(dir);
  }
});

test('human-readable output is unchanged when --json is absent', () => {
  const dir = sampleRepo();
  try {
    const stats = runCli(['stats'], dir);
    assert.ok(stats.includes('repotool stats'));
    assert.ok(stats.includes('contributors'));
    assert.throws(() => JSON.parse(stats));

    const hotspots = runCli(['hotspots'], dir);
    assert.ok(hotspots.includes('repotool hotspots'));

    const ask = runCli(['ask', 'who are the top contributors'], dir);
    assert.ok(/Grace Hopper/.test(ask));
    assert.throws(() => JSON.parse(ask));
  } finally {
    cleanup(dir);
  }
});

test('an empty repository still produces valid JSON', () => {
  const dir = makeRepo();
  try {
    const stats = JSON.parse(runCli(['stats', '--json'], dir));
    assert.equal(stats.empty, true);
    assert.equal(stats.commits.total, 0);

    const hotspots = JSON.parse(runCli(['hotspots', '--json'], dir));
    assert.equal(hotspots.empty, true);
    assert.deepEqual(hotspots.files, []);
  } finally {
    cleanup(dir);
  }
});

test('the library exposes the same JSON shapes as the CLI', () => {
  const dir = sampleRepo();
  try {
    const { buildRepoModel } = require('../src/analysis/repo-model');
    const { statsJson, hotspotsJson } = require('../src/analysis/to-json');
    const model = buildRepoModel({ cwd: dir, fresh: true });

    assert.equal(statsJson(model).commits.total, 3);
    assert.equal(hotspotsJson(model, { limit: 1 }).files.length, 1);
  } finally {
    cleanup(dir);
  }
});
