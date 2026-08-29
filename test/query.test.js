'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseQuestion, supportedQuestions } = require('../src/query/parser');
const { answer, QueryError } = require('../src/query/handlers');
const { createStyle } = require('../src/ansi');
const reader = require('../src/git-reader');
const { makeRepo, commit, git, cleanup } = require('./helpers');

const style = createStyle({ enabled: false });

function sampleRepo() {
  const dir = makeRepo();
  commit(dir, 'app.js', 'one\n', 'Initial commit');
  commit(dir, 'app.js', 'one\ntwo\n', 'Tweak app', 'Grace Hopper');
  commit(dir, 'README.md', 'readme\n', 'Add readme', 'Ada Lovelace');
  return dir;
}

test('parser maps questions to intents and extracts arguments', () => {
  assert.equal(parseQuestion('who last touched src/app.js').name, 'who-touched');
  assert.equal(parseQuestion('who last touched src/app.js').argument, 'src/app.js');
  assert.equal(parseQuestion('how many commits by Ada?').name, 'count-by-author');
  assert.equal(parseQuestion('how many commits by Ada?').argument, 'Ada');
  assert.equal(parseQuestion('show the last 5 commits').argument, '5');
  assert.equal(parseQuestion('what branches exist').name, 'branch-list');
  assert.equal(parseQuestion('which file changed the most often').name, 'busiest-file');
});

test('parser returns null for questions it does not cover', () => {
  assert.equal(parseQuestion('what is the meaning of life'), null);
  assert.equal(parseQuestion(''), null);
  assert.equal(parseQuestion(undefined), null);
});

test('every advertised question parses to an intent', () => {
  assert.ok(supportedQuestions().length >= 5);
});

test('who-touched names the most recent author of a file', () => {
  const dir = sampleRepo();
  try {
    const output = answer(parseQuestion('who last touched app.js'), { cwd: dir, style });
    assert.match(output, /Grace Hopper/);
    assert.match(output, /Tweak app/);
  } finally {
    cleanup(dir);
  }
});

test('who-touched explains itself for an unknown file', () => {
  const dir = sampleRepo();
  try {
    const output = answer(parseQuestion('who last touched nope.js'), { cwd: dir, style });
    assert.match(output, /No commits found/);
  } finally {
    cleanup(dir);
  }
});

test('count-by-author counts per author and filters by name', () => {
  const dir = sampleRepo();
  try {
    const all = answer(parseQuestion('how many commits are there'), { cwd: dir, style });
    assert.match(all, /Grace Hopper/);
    assert.match(all, /Ada Lovelace/);

    const filtered = answer(parseQuestion('how many commits by Grace'), { cwd: dir, style });
    assert.match(filtered, /Grace Hopper: 1 commit/);
  } finally {
    cleanup(dir);
  }
});

test('files-changed lists the paths in a commit', () => {
  const dir = sampleRepo();
  try {
    const output = answer(parseQuestion('what files changed in HEAD'), { cwd: dir, style });
    assert.match(output, /README\.md/);
  } finally {
    cleanup(dir);
  }
});

test('when-was reports author and commit dates', () => {
  const dir = sampleRepo();
  try {
    const output = answer(parseQuestion('when was HEAD committed'), { cwd: dir, style });
    assert.match(output, /authored/);
    assert.match(output, /UTC/);
  } finally {
    cleanup(dir);
  }
});

test('branch-list marks the current branch', () => {
  const dir = sampleRepo();
  try {
    git(dir, ['branch', 'feature']);
    const output = answer(parseQuestion('what branches exist'), { cwd: dir, style });
    assert.match(output, /\* main/);
    assert.match(output, /feature/);
  } finally {
    cleanup(dir);
  }
});

test('an empty repository answers without throwing', () => {
  const dir = makeRepo();
  try {
    const output = answer(parseQuestion('show the last 5 commits'), { cwd: dir, style });
    assert.match(output, /no commits yet/i);
  } finally {
    cleanup(dir);
  }
});

test('unknown questions raise QueryError listing what is supported', () => {
  assert.throws(() => answer(parseQuestion('make me a sandwich'), { cwd: process.cwd(), style }), QueryError);
});

test('a question missing its argument asks for one', () => {
  const dir = sampleRepo();
  try {
    assert.throws(() => answer(parseQuestion('who touched'), { cwd: dir, style }), QueryError);
  } finally {
    cleanup(dir);
  }
});

test('an unknown revision surfaces a GitError', () => {
  const dir = sampleRepo();
  try {
    assert.throws(
      () => answer(parseQuestion('what files changed in deadbeef'), { cwd: dir, style }),
      reader.GitError,
    );
  } finally {
    cleanup(dir);
  }
});
