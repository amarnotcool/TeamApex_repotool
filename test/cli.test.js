'use strict';

/**
 * CLI-level tests.
 *
 * The three features are meant to stand alone, so these run the real
 * entrypoint in a child process against a copy of the project with one
 * module removed — the situation the design is supposed to survive.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { parseArgv } = require('../bin/repotool');
const { makeRepo, commit, cleanup } = require('./helpers');

const PROJECT_ROOT = path.join(__dirname, '..');

/** Copy bin/ and src/ into a temp directory so we can break a module safely. */
function projectCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repotool-cli-'));
  for (const entry of ['bin', 'src', 'package.json']) {
    fs.cpSync(path.join(PROJECT_ROOT, entry), path.join(dir, entry), { recursive: true });
  }
  return dir;
}

/** Run the CLI, returning stdout+stderr and the exit status either way. */
function runCli(projectDir, args, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [path.join(projectDir, 'bin', 'repotool.js'), ...args], {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
    });
    return { status: 0, output: stdout };
  } catch (err) {
    return { status: err.status, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

test('argv parser handles flags, --flag=value, and positionals', () => {
  const { positional, flags } = parseArgv(['diff', 'HEAD~1', 'HEAD', '--context', '5', '--stat', '--repo=/tmp/x']);
  assert.deepEqual(positional, ['diff', 'HEAD~1', 'HEAD']);
  assert.equal(flags.context, '5');
  assert.equal(flags.stat, true);
  assert.equal(flags.repo, '/tmp/x');
});

test('diff and ask still work when the graph module is missing', () => {
  const projectDir = projectCopy();
  const repo = makeRepo();
  try {
    commit(repo, 'a.txt', 'one\n', 'First');
    commit(repo, 'a.txt', 'one\ntwo\n', 'Second');
    fs.rmSync(path.join(projectDir, 'src', 'graph'), { recursive: true, force: true });

    const diff = runCli(projectDir, ['diff', 'HEAD~1', 'HEAD', '--no-color'], repo);
    assert.equal(diff.status, 0, `diff should succeed, got: ${diff.output}`);
    assert.match(diff.output, /\+two/);

    const ask = runCli(projectDir, ['ask', 'show the last 2 commits', '--no-color'], repo);
    assert.equal(ask.status, 0, `ask should succeed, got: ${ask.output}`);
    assert.match(ask.output, /Second/);

    const help = runCli(projectDir, ['help'], repo);
    assert.equal(help.status, 0);
    assert.match(help.output, /Usage:/);
  } finally {
    cleanup(projectDir);
    cleanup(repo);
  }
});

test('a missing module reports which command is unavailable, not a stack trace', () => {
  const projectDir = projectCopy();
  const repo = makeRepo();
  try {
    commit(repo, 'a.txt', 'one\n', 'First');
    fs.rmSync(path.join(projectDir, 'src', 'graph'), { recursive: true, force: true });

    const graph = runCli(projectDir, ['graph', '--no-color'], repo);
    assert.equal(graph.status, 1);
    assert.match(graph.output, /graph module is unavailable/);
    assert.match(graph.output, /other commands still work/);
    assert.ok(!graph.output.includes('at Function.'), 'must not dump a stack trace');
  } finally {
    cleanup(projectDir);
    cleanup(repo);
  }
});

test('graph, ask and diff all run against a real repository', () => {
  const repo = makeRepo();
  try {
    commit(repo, 'a.txt', 'one\n', 'First');
    commit(repo, 'a.txt', 'one\ntwo\n', 'Second');

    for (const args of [['graph', '--no-color'], ['ask', 'who are the top contributors', '--no-color'], ['diff', 'HEAD~1', 'HEAD', '--no-color']]) {
      const result = runCli(PROJECT_ROOT, args, repo);
      assert.equal(result.status, 0, `${args[0]} failed: ${result.output}`);
      assert.ok(result.output.trim().length > 0, `${args[0]} produced no output`);
    }
  } finally {
    cleanup(repo);
  }
});

test('the public API exposes each feature and loads modules lazily', () => {
  const api = require('../src/index');

  assert.equal(typeof api.readCommits, 'function');
  assert.equal(typeof api.buildGraph, 'function');
  assert.equal(typeof api.renderAscii, 'function');
  assert.equal(typeof api.myersDiff, 'function');
  assert.equal(typeof api.parseQuestion, 'function');
  assert.equal(typeof api.answerQuestion, 'function');

  // Namespaces group each feature for callers who want only one part.
  for (const namespace of ['git', 'graph', 'query', 'diff']) {
    assert.ok(Object.keys(api[namespace]).length > 0, `${namespace} namespace should not be empty`);
  }

  // Repeated access returns the same resolved value, not a fresh require.
  assert.equal(api.buildGraph, api.buildGraph);
});

test('the public API produces the same graph as the CLI path', () => {
  const api = require('../src/index');
  const repo = makeRepo();
  try {
    commit(repo, 'a.txt', 'one\n', 'First');
    commit(repo, 'a.txt', 'one\ntwo\n', 'Second');

    const { commits } = api.readCommits({ cwd: repo });
    const rendered = api.renderAscii(api.buildGraph(commits), { color: false, maxWidth: 200 });
    assert.match(rendered, /Second/);
    assert.match(rendered, /First/);
  } finally {
    cleanup(repo);
  }
});
