'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseQuestion, supportedQuestions } = require('../src/query/parser');
const { answer, QueryError } = require('../src/query/handlers');
const { createStyle } = require('../src/ansi');
const reader = require('../src/git-reader');
const { makeRepo, commit, commitAt, git, cleanup } = require('./helpers');

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
    assert.match(output, /2 local, 0 remote/);
  } finally {
    cleanup(dir);
  }
});

test('branch-list includes remote-tracking branches, labelled as remote', () => {
  const origin = sampleRepo();
  const clone = makeRepo();
  try {
    // Give the clone a real remote by fetching from another repository on disk.
    git(origin, ['branch', 'release']);
    git(clone, ['remote', 'add', 'origin', origin]);
    git(clone, ['fetch', '-q', 'origin']);

    const output = answer(parseQuestion('what branches exist'), { cwd: clone, style });
    assert.match(output, /origin\/main/, 'expected the remote branch to be listed');
    assert.match(output, /origin\/release/);
    assert.match(output, /\(remote\)/, 'remote branches must be labelled');
    assert.match(output, /remote$|2 remote/m);
    assert.ok(!/origin\/HEAD/.test(output), "a remote's HEAD alias is not a branch");
  } finally {
    cleanup(origin);
    cleanup(clone);
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

test('every advertised question parses to its own intent', () => {
  const { INTENTS } = require('../src/query/parser');
  for (const intent of INTENTS) {
    assert.ok(intent.example, `${intent.name} needs an example question`);
    const parsed = parseQuestion(intent.example);
    assert.ok(parsed, `${intent.name} example did not parse: ${intent.example}`);
    assert.equal(parsed.name, intent.name, `"${intent.example}" routed to ${parsed.name}`);
  }
});

test('who-works-most and who-last-touched stay distinct', () => {
  assert.equal(parseQuestion('who works most on src/app.js').name, 'file-owner');
  assert.equal(parseQuestion('who works most on src/app.js').argument, 'src/app.js');
  assert.equal(parseQuestion('who last touched src/app.js').name, 'who-touched');
  assert.equal(parseQuestion('who maintains src/app.js').name, 'file-owner');
});

test('recent-activity and change-analysis do not swallow each other', () => {
  assert.equal(parseQuestion('what has changed recently').name, 'recent-activity');
  assert.equal(parseQuestion('what happened lately').name, 'recent-activity');
  assert.equal(parseQuestion('why is this repository changing so much').name, 'change-analysis');
  assert.equal(parseQuestion('explain the churn').name, 'change-analysis');
  // "last N commits" is a listing question, not an activity analysis.
  assert.equal(parseQuestion('show the last 5 commits').name, 'last-commits');
});

test('file-owner names the most involved author for a path', () => {
  const dir = sampleRepo();
  try {
    const output = answer(parseQuestion('who works most on app.js'), { cwd: dir, style });
    assert.match(output, /works most on app\.js/);
    assert.match(output, /of \d+ commits touching it/);
    assert.match(output, /file totals/);
  } finally {
    cleanup(dir);
  }
});

test('file-owner matches a path fragment and reports an unknown path plainly', () => {
  const dir = sampleRepo();
  try {
    const fragment = answer(parseQuestion('who works most on app'), { cwd: dir, style });
    assert.match(fragment, /app\.js/);

    const missing = answer(parseQuestion('who works most on nowhere/at/all.js'), { cwd: dir, style });
    assert.match(missing, /No tracked file matches/);
  } finally {
    cleanup(dir);
  }
});

test('recent-activity summarises the newest slice of history', () => {
  const dir = sampleRepo();
  try {
    const output = answer(parseQuestion('what has changed recently'), { cwd: dir, style });
    assert.match(output, /^Recently: \d+ commits? of \d+/m);
    assert.match(output, /churn\s+\d/);
    assert.match(output, /authors\s+\S/);
    assert.match(output, /latest commits:/);
  } finally {
    cleanup(dir);
  }
});

test('change-analysis compares real rates when history spans days', () => {
  const dir = makeRepo();
  try {
    // Quiet start: four commits, one a day, at the start of January.
    for (let i = 0; i < 4; i++) {
      commitAt(dir, `2026-01-0${i + 1}T09:00:00`, 'old.js', `rev ${i}\n`, `Slow change ${i}`);
    }
    // Then a burst a month later: two commits a day for three days, one file.
    for (let i = 0; i < 6; i++) {
      const day = 1 + Math.floor(i / 2);
      const hour = i % 2 === 0 ? '09' : '15';
      const body = Array.from({ length: 30 }, (_, line) => `line ${line} rev ${i}`).join('\n');
      commitAt(dir, `2026-02-0${day}T${hour}:00:00`, 'burst.js', `${body}\n`, `Burst ${i}`, 'Grace Hopper');
    }

    const output = answer(parseQuestion('why is this repository changing so much'), { cwd: dir, style });
    assert.match(output, /recent\s+\d+ commits over .*\/day/, 'a real span should quote a per-day rate');
    assert.match(output, /baseline\s+\d+ commits over/);
    assert.match(output, /pace\s+.*(faster|slower|same pace)/);
    assert.match(output, /focus\s+\d+% of recent churn/);
    assert.match(output, /driver\s+\S/);
    assert.match(output, /counted directly from git history/);
    assert.match(output, /burst\.js/);
  } finally {
    cleanup(dir);
  }
});

test('change-analysis refuses to quote per-day rates for a same-day history', () => {
  const dir = sampleRepo();
  try {
    const output = answer(parseQuestion('why is this repository changing so much'), { cwd: dir, style });
    assert.match(output, /inside a single day/);
    assert.match(output, /per-day rates would be meaningless/);
    assert.ok(!/\d\/day/.test(output), 'no rate should be quoted');
  } finally {
    cleanup(dir);
  }
});

test('the new intents handle an empty repository', () => {
  const dir = makeRepo();
  try {
    for (const question of ['who works most on app.js', 'what has changed recently', 'why is this repository changing so much']) {
      assert.match(answer(parseQuestion(question), { cwd: dir, style }), /no commits yet/i, question);
    }
  } finally {
    cleanup(dir);
  }
});

test('an unmatched question is refused without false-matching a new intent', () => {
  for (const question of ['what is the meaning of life', 'please deploy to production', 'make me a sandwich']) {
    assert.equal(parseQuestion(question), null, question);
  }
  assert.throws(
    () => answer(parseQuestion('what is the weather'), { cwd: process.cwd(), style }),
    (err) => {
      assert.equal(err.name, 'QueryError');
      assert.match(err.message, /I can answer:/);
      assert.match(err.message, /who works most on/, 'the new intents are advertised too');
      return true;
    },
  );
});
