'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const myers = require('../src/diff/myers');
const { renderFileDiff } = require('../src/diff/render-diff');

/** Reconstruct sequence B by applying an edit script to nothing. */
function applyScript(ops) {
  return ops.filter((op) => op.type !== 'delete').map((op) => op.value);
}

/** Reconstruct sequence A from the same script. */
function originalFromScript(ops) {
  return ops.filter((op) => op.type !== 'insert').map((op) => op.value);
}

test('identical inputs produce only equal operations', () => {
  const ops = myers.diff(['a', 'b', 'c'], ['a', 'b', 'c']);
  assert.deepEqual(
    ops.map((op) => op.type),
    ['equal', 'equal', 'equal'],
  );
  assert.deepEqual(myers.stats(ops), { added: 0, removed: 0 });
});

test('empty original inserts everything', () => {
  const ops = myers.diff([], ['a', 'b']);
  assert.deepEqual(
    ops.map((op) => op.type),
    ['insert', 'insert'],
  );
});

test('empty update deletes everything', () => {
  const ops = myers.diff(['a', 'b'], []);
  assert.deepEqual(
    ops.map((op) => op.type),
    ['delete', 'delete'],
  );
});

test('classic Myers example produces a minimal script', () => {
  const a = 'ABCABBA'.split('');
  const b = 'CBABAC'.split('');
  const ops = myers.diff(a, b);
  const { added, removed } = myers.stats(ops);
  // The known shortest edit script for this pair has length 5.
  assert.equal(added + removed, 5);
  assert.deepEqual(applyScript(ops), b);
  assert.deepEqual(originalFromScript(ops), a);
});

test('random inputs always round-trip through the edit script', () => {
  const alphabet = 'abcde';
  const randomSeq = (length) =>
    Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]);

  for (let i = 0; i < 50; i++) {
    const a = randomSeq(Math.floor(Math.random() * 20));
    const b = randomSeq(Math.floor(Math.random() * 20));
    const ops = myers.diff(a, b);
    assert.deepEqual(originalFromScript(ops), a, 'original side must round-trip');
    assert.deepEqual(applyScript(ops), b, 'updated side must round-trip');
  }
});

test('trailing newline does not create a phantom empty line', () => {
  const ops = myers.diffLines('one\ntwo\n', 'one\ntwo\n');
  assert.equal(ops.length, 2);
  assert.deepEqual(myers.stats(ops), { added: 0, removed: 0 });
});

test('CRLF input is compared as if it were LF', () => {
  const ops = myers.diffLines('one\r\ntwo\r\n', 'one\ntwo\n');
  assert.deepEqual(myers.stats(ops), { added: 0, removed: 0 });
});

test('hunks group nearby changes and skip unchanged regions', () => {
  const a = Array.from({ length: 40 }, (_, i) => `line ${i}`);
  const b = a.slice();
  b[2] = 'changed early';
  b[35] = 'changed late';

  const hunks = myers.toHunks(myers.diff(a, b), 2);
  assert.equal(hunks.length, 2, 'distant changes belong to separate hunks');
  assert.ok(hunks[0].ops.length < a.length, 'hunk must not contain the whole file');
});

test('an added file reports a zero start on the original side', () => {
  const hunks = myers.toHunks(myers.diffLines('', 'new line\n'));
  assert.equal(hunks[0].aStart, 0);
  assert.equal(hunks[0].aCount, 0);
  assert.equal(hunks[0].bStart, 1);
});

test('renderer marks insertions, deletions and context', () => {
  const output = renderFileDiff(myers.diffLines('a\nb\n', 'a\nc\n'), { color: false });
  const lines = output.split('\n');
  assert.ok(lines[0].startsWith('@@'));
  assert.ok(lines.includes('-b'));
  assert.ok(lines.includes('+c'));
  assert.ok(lines.includes(' a'));
});

test('renderer emits no escape codes when colour is disabled', () => {
  const output = renderFileDiff(myers.diffLines('a\n', 'b\n'), { color: false });
  assert.ok(!output.includes('\x1b['));
});

test('binary content is detected from blob bytes, without any diff command', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { makeRepo, commit, git, cleanup } = require('./helpers');
  const reader = require('../src/git-reader');

  const dir = makeRepo();
  try {
    commit(dir, 'text.txt', 'hello\n', 'Add text');
    // A NUL byte is what makes content binary for our purposes.
    fs.writeFileSync(path.join(dir, 'blob.bin'), Buffer.from([0, 1, 2, 3, 0, 255]));
    git(dir, ['add', '.']);
    git(dir, ['commit', '-q', '-m', 'Add binary']);

    const changes = reader.changedPaths('HEAD~1', 'HEAD', { cwd: dir });
    const paths = changes.map((change) => change.path);
    assert.ok(paths.includes('blob.bin'), 'expected the binary file in the change list');

    const blobs = reader.readBlobs(['HEAD:blob.bin', 'HEAD:text.txt'], { cwd: dir });
    assert.equal(reader.isBinary(blobs.get('HEAD:blob.bin')), true);
    assert.equal(reader.isBinary(blobs.get('HEAD:text.txt')), false);
  } finally {
    cleanup(dir);
  }
});

test('readBlobs fetches many blobs in one call and reports missing ones', () => {
  const { makeRepo, commit, cleanup } = require('./helpers');
  const reader = require('../src/git-reader');

  const dir = makeRepo();
  try {
    commit(dir, 'a.txt', 'alpha\n', 'Add a');
    commit(dir, 'b.txt', 'beta\n', 'Add b');

    const blobs = reader.readBlobs(['HEAD:a.txt', 'HEAD:b.txt', 'HEAD:nope.txt'], { cwd: dir });
    assert.equal(blobs.get('HEAD:a.txt').toString('utf8'), 'alpha\n');
    assert.equal(blobs.get('HEAD:b.txt').toString('utf8'), 'beta\n');
    assert.equal(blobs.get('HEAD:nope.txt'), null, 'a missing path resolves to null');
  } finally {
    cleanup(dir);
  }
});

test('readBlobs returns an empty map for an empty request', () => {
  const reader = require('../src/git-reader');
  assert.equal(reader.readBlobs([], { cwd: process.cwd() }).size, 0);
});

// --- intra-line highlighting -----------------------------------------------

const render = require('../src/diff/render-diff');

/** Strip ANSI, returning the plain text a reader would see. */
function plain(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Every character wrapped in the bold+underline accent code. */
function accented(text) {
  const spans = text.match(/\x1b\[1;4;3[12]m([^\x1b]*)\x1b\[0m/g) || [];
  return spans.map((span) => span.replace(/\x1b\[[0-9;]*m/g, '')).join('');
}

test('a single-character change highlights only that character', () => {
  const ops = myers.diffLines('const value = 1;\nkeep\n', 'const value = 2;\nkeep\n');
  const output = renderFileDiff(ops, { color: true });

  assert.equal(accented(output), '12', 'only the old and new digit are picked out');
  assert.ok(plain(output).includes('-const value = 1;'));
  assert.ok(plain(output).includes('+const value = 2;'));
});

test('a fully rewritten line falls back to whole-line colouring', () => {
  const ops = myers.diffLines('alpha beta\n', 'totally different content\n');
  const output = renderFileDiff(ops, { color: true });

  assert.equal(accented(output), '', 'nothing is worth picking out on unrelated lines');
  assert.ok(output.includes('\x1b[31m-alpha beta\x1b[0m'));
  assert.ok(output.includes('\x1b[32m+totally different content\x1b[0m'));
});

test('intra-line highlighting is skipped entirely with colour off', () => {
  const ops = myers.diffLines('const value = 1;\n', 'const value = 2;\n');
  const output = renderFileDiff(ops, { color: false });

  assert.equal(output, ['@@ -1,1 +1,1 @@', '-const value = 1;', '+const value = 2;'].join('\n'));
  assert.ok(!output.includes('\x1b['));
});

test('added and removed whole lines are left alone', () => {
  const ops = myers.diffLines('one\ntwo\n', 'one\ntwo\nthree\n');
  const output = renderFileDiff(ops, { color: true });
  assert.equal(accented(output), '', 'an insertion has no partner to compare against');
});

test('paired changed lines are matched positionally within a block', () => {
  const ops = myers.diffLines('a1\nb1\n', 'a2\nb2\n');
  const pairs = render.pairChangedLines(ops);
  // Two deletes then two inserts: line 1 pairs with line 3, line 2 with line 4.
  assert.deepEqual([...pairs.entries()], [[0, 2], [1, 3]]);
});

test('an unpaired deletion in a block gets no partner', () => {
  const ops = myers.diffLines('a1\nb1\nc1\n', 'a2\n');
  const pairs = render.pairChangedLines(ops);
  assert.equal(pairs.size, 1, 'only the first delete has an insert to pair with');
});

test('similarity below the threshold means no character-level detail', () => {
  assert.equal(render.intraLineSpans('abcdef', 'abcdef'), null, 'identical lines need no detail');
  assert.equal(render.intraLineSpans('', 'xyz'), null, 'an empty side has nothing to compare');
  assert.equal(render.intraLineSpans('abcdefgh', 'zzzzzzzz'), null, 'nothing in common');

  const spans = render.intraLineSpans('value = 1', 'value = 2');
  assert.ok(spans, 'a one-character edit is well above the threshold');
  assert.deepEqual(spans.delete.filter((span) => span.changed).map((span) => span.text), ['1']);
  assert.deepEqual(spans.insert.filter((span) => span.changed).map((span) => span.text), ['2']);
});

test('very long lines skip character-level diffing', () => {
  const long = 'x'.repeat(1200);
  assert.equal(render.intraLineSpans(long + 'a', long + 'b'), null);
});

test('a rewrite that shares scattered fragments is not highlighted', () => {
  // These two lines share 'r', 'omise' and ')' by accident, not by edit: the
  // character diff comes back as four scattered runs, which is confetti.
  assert.equal(render.intraLineSpans('      return Promise.reject(error);', '    if (!promise) {'), null);
});

test('a few substantial spans are still highlighted', () => {
  const spans = render.intraLineSpans('  const pathname = parsed.pathname;', '  let pathname = parsed.pathname;');
  assert.ok(spans);
  assert.deepEqual(spans.delete.filter((span) => span.changed).map((span) => span.text), ['cons']);
  assert.deepEqual(spans.insert.filter((span) => span.changed).map((span) => span.text), ['le']);
});

test('too many separate changed runs falls back to whole-line colouring', () => {
  assert.equal(render.intraLineSpans('a1b2c3d4e5f6', 'aXbYcZdWeVfU'), null);
});
