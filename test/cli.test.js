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

/** Run the CLI capturing stdout and stderr separately. */
function runSplit(args, cwd) {
  const result = require('node:child_process').spawnSync(
    process.execPath,
    [path.join(PROJECT_ROOT, 'bin', 'repotool.js'), ...args],
    { cwd, encoding: 'utf8', windowsHide: true },
  );
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function busyRepo() {
  const dir = makeRepo();
  commit(dir, 'a.js', 'one\n', 'First');
  commit(dir, 'a.js', 'one\ntwo\n', 'Second', 'Grace Hopper');
  commit(dir, 'b.js', 'b\n', 'Third');
  return dir;
}

test('every command prints its results to stdout and nothing to stderr', () => {
  const repo = busyRepo();
  try {
    const commands = [
      ['graph', '--no-color'],
      ['stats', '--no-color'],
      ['hotspots', '--no-color'],
      ['ask', 'who are the top contributors', '--no-color'],
      ['diff', 'HEAD~1', 'HEAD', '--no-color'],
    ];

    for (const args of commands) {
      const result = runSplit(args, repo);
      assert.equal(result.status, 0, `${args[0]} exited ${result.status}: ${result.stderr}`);
      assert.ok(result.stdout.trim().length > 0, `${args[0]} wrote nothing to stdout`);
      assert.equal(result.stderr, '', `${args[0]} polluted stderr: ${result.stderr}`);
    }
  } finally {
    cleanup(repo);
  }
});

test('help goes to stdout and exits 0; a bare invocation is a usage error', () => {
  const repo = busyRepo();
  try {
    const help = runSplit(['help'], repo);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage:/);
    assert.equal(help.stderr, '');

    for (const command of ['graph', 'stats', 'hotspots', 'ask', 'diff']) {
      const perCommand = runSplit(['help', command], repo);
      assert.equal(perCommand.status, 0, `help ${command} exited ${perCommand.status}`);
      assert.match(perCommand.stdout, new RegExp(`repotool ${command}`), `help ${command} lacks a title`);
      assert.match(perCommand.stdout, /Usage:/, `help ${command} lacks usage`);
      assert.match(perCommand.stdout, /Examples:/, `help ${command} lacks examples`);

      const viaFlag = runSplit([command, '--help'], repo);
      assert.equal(viaFlag.status, 0);
      assert.equal(viaFlag.stdout, perCommand.stdout, `${command} --help must match help ${command}`);
    }

    // No command at all is a usage error: stderr, non-zero.
    const bare = runSplit([], repo);
    assert.equal(bare.status, 2);
    assert.equal(bare.stdout, '');
    assert.match(bare.stderr, /Usage:/);
  } finally {
    cleanup(repo);
  }
});

test('bad arguments exit 2 with the message on stderr', () => {
  const repo = busyRepo();
  try {
    const cases = [
      [['hotspots', '--sort', 'nonsense'], /--sort must be one of/],
      [['hotspots', '--limit', 'abc'], /--limit needs a number/],
      [['stats', '--limit', '-4'], /--limit needs a number/],
      [['graph', '--limit', 'lots'], /--limit needs a number/],
      [['diff'], /needs at least one revision/],
      [['ask'], /needs a question/],
    ];

    for (const [args, pattern] of cases) {
      const result = runSplit(args, repo);
      assert.equal(result.status, 2, `${args.join(' ')} should exit 2, got ${result.status}`);
      assert.match(result.stderr, pattern, args.join(' '));
      assert.equal(result.stdout, '', `${args.join(' ')} should print nothing to stdout`);
    }
  } finally {
    cleanup(repo);
  }
});

test('unknown commands and unanswerable questions exit non-zero via stderr', () => {
  const repo = busyRepo();
  try {
    const unknown = runSplit(['frobnicate'], repo);
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /Unknown command: frobnicate/);
    assert.equal(unknown.stdout, '');

    const unanswerable = runSplit(['ask', 'what is the weather', '--no-color'], repo);
    assert.equal(unanswerable.status, 1);
    assert.match(unanswerable.stderr, /I can answer:/);
    assert.equal(unanswerable.stdout, '');
  } finally {
    cleanup(repo);
  }
});

test('running outside a repository fails cleanly for every command', () => {
  const outside = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'repotool-bare-'));
  try {
    for (const args of [['graph'], ['stats'], ['hotspots'], ['ask', 'who are the top contributors'], ['diff', 'HEAD']]) {
      const result = runSplit([...args, '--no-color'], outside);
      assert.equal(result.status, 1, `${args[0]} should exit 1 outside a repository`);
      assert.match(result.stderr, /not a git repository|unknown revision/i, args[0]);
      assert.ok(!result.stderr.includes('at Object.'), `${args[0]} dumped a stack trace`);
    }
  } finally {
    cleanup(outside);
  }
});

test('stats and hotspots respect --no-color and a non-TTY stdout', () => {
  const repo = busyRepo();
  try {
    for (const command of ['stats', 'hotspots', 'graph']) {
      const explicit = runSplit([command, '--no-color'], repo);
      assert.ok(!explicit.stdout.includes('\x1b['), `${command} --no-color emitted escape codes`);

      // A piped (non-TTY) stdout must be plain even without the flag.
      const piped = runSplit([command], repo);
      assert.ok(!piped.stdout.includes('\x1b['), `${command} coloured a non-TTY stream`);

      // ...and --color forces colour on regardless of the stream.
      const forced = runSplit([command, '--color'], repo);
      assert.ok(forced.stdout.includes('\x1b['), `${command} --color produced no escape codes`);
    }
  } finally {
    cleanup(repo);
  }
});

test('stats and hotspots work on an empty repository and a detached HEAD', () => {
  const empty = makeRepo();
  const detached = busyRepo();
  try {
    for (const command of ['stats', 'hotspots']) {
      const onEmpty = runSplit([command, '--no-color'], empty);
      assert.equal(onEmpty.status, 0, `${command} should succeed on an empty repository`);
      assert.match(onEmpty.stdout, /No commits yet/);
      assert.equal(onEmpty.stderr, '');
    }

    require('./helpers').git(detached, ['checkout', '-q', '--detach', 'HEAD~1']);
    const onDetached = runSplit(['stats', '--no-color'], detached);
    assert.equal(onDetached.status, 0);
    assert.match(onDetached.stdout, /detached HEAD/);
  } finally {
    cleanup(empty);
    cleanup(detached);
  }
});

test('the public API exposes the analysis layer alongside the feature modules', () => {
  const api = require('../src/index');
  const repo = busyRepo();
  try {
    for (const name of ['buildRepoModel', 'rankHotspots', 'activityComparison', 'renderStats', 'renderHotspots']) {
      assert.equal(typeof api[name], 'function', `${name} should be exported`);
    }
    assert.ok(Object.keys(api.analysis).length > 0);
    assert.equal(typeof api.format.count, 'function');

    const built = api.buildRepoModel({ cwd: repo });
    assert.equal(built.totalCommits, 3);
    assert.match(api.renderStats(built, { color: false }), /commits/);
    assert.match(api.renderHotspots(built, { color: false }), /rank/);
  } finally {
    cleanup(repo);
  }
});
