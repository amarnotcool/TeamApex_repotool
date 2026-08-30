#!/usr/bin/env node
'use strict';

/**
 * repotool CLI — argument routing.
 *
 * Hand-rolled argv parsing: no commander, no yargs. The shape is
 *   repotool <command> [positional...] [--flag] [--option value]
 * and each command owns its own positional handling.
 *
 * Feature modules are required inside their command handler rather than at
 * the top of the file. The three features are meant to stand alone, so a
 * missing or broken module must only take down its own command — `diff` and
 * `ask` keep working even if the graph module is gone entirely.
 */

const path = require('node:path');
const reader = require('../src/git-reader');
const { createStyle } = require('../src/ansi');

/** Flags that take a value rather than being booleans. */
const VALUED_FLAGS = new Set(['limit', 'context', 'repo', 'branch']);

function parseArgv(argv) {
  const positional = [];
  const flags = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const body = token.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    if (VALUED_FLAGS.has(body)) {
      flags[body] = argv[++i];
      continue;
    }
    flags[body] = true;
  }

  return { positional, flags };
}

/** Resolve colour preference: --no-color / --color override auto-detection. */
function colorPreference(flags) {
  if (flags['no-color']) return false;
  if (flags.color) return true;
  return undefined; // let ansi.js decide from TTY / NO_COLOR
}

/**
 * Help text. The question list comes from the query module, which is loaded
 * lazily here too — if that module is missing, help still prints.
 */
function usage() {
  let questions = '  (question list unavailable — the query module is missing)';
  try {
    questions = require('../src/query/parser')
      .supportedQuestions()
      .map((question) => `  - ${question}`)
      .join('\n');
  } catch {
    /* fall through to the placeholder above */
  }

  return `repotool — understand a git repository, with zero dependencies

Usage:
  repotool graph [--limit N] [--branch REF] [--no-dates]
  repotool ask "<question>"
  repotool diff <commitA> <commitB> [--context N] [--stat]
  repotool help

Options:
  --repo PATH     repository to inspect (default: current directory)
  --limit N       maximum commits to read
  --color         force ANSI colour on   --no-color  force it off

Questions repotool can answer:
${questions}
`;
}

function commandGraph(flags, style) {
  const { buildGraph } = require('../src/graph/build-graph');
  const { renderAscii } = require('../src/graph/render-ascii');

  const cwd = path.resolve(flags.repo || process.cwd());
  const limit = flags.limit ? Number(flags.limit) : undefined;
  const { commits, head } = reader.readCommits({
    cwd,
    limit,
    all: !flags.branch,
    revs: flags.branch ? [flags.branch] : undefined,
  });

  if (!commits.length) {
    console.log(style.dim('This repository has no commits yet — nothing to graph.'));
    return 0;
  }

  const location = head.empty
    ? 'empty repository'
    : head.detached
      ? `detached HEAD at ${head.hash.slice(0, 7)}`
      : `on branch ${head.branch}`;
  console.log(style.dim(`${commits.length} commit(s), ${location}`));
  console.log();
  console.log(
    renderAscii(buildGraph(commits), {
      color: colorPreference(flags),
      dates: !flags['no-dates'],
    }),
  );
  return 0;
}

function commandAsk(positional, flags, style) {
  const { parseQuestion } = require('../src/query/parser');
  const { answer } = require('../src/query/handlers');

  const cwd = path.resolve(flags.repo || process.cwd());
  const question = positional.join(' ');
  if (!question.trim()) {
    console.error(style.red('Ask a question, e.g. repotool ask "who last touched README.md"'));
    return 2;
  }

  const intent = parseQuestion(question);
  console.log(answer(intent, { cwd, style }));
  return 0;
}

function commandDiff(positional, flags, style) {
  const myers = require('../src/diff/myers');
  const render = require('../src/diff/render-diff');

  const cwd = path.resolve(flags.repo || process.cwd());
  const [revA, revB = 'HEAD'] = positional;
  if (!revA) {
    console.error(style.red('Usage: repotool diff <commitA> [commitB]'));
    return 2;
  }

  const hashA = reader.resolveRev(revA, { cwd });
  const hashB = reader.resolveRev(revB, { cwd });
  const changes = reader.changedPaths(hashA, hashB, { cwd });

  if (!changes.length) {
    console.log(style.dim(`No differences between ${revA} and ${revB}.`));
    return 0;
  }

  const color = colorPreference(flags);
  const context = flags.context ? Number(flags.context) : 3;
  const totals = { added: 0, removed: 0 };

  // Fetch every blob on both sides in a single `git cat-file --batch` call
  // rather than spawning git twice per file.
  const specs = [];
  for (const change of changes) {
    if (change.status !== 'A') specs.push(`${hashA}:${change.path}`);
    if (change.status !== 'D') specs.push(`${hashB}:${change.path}`);
  }
  const blobs = reader.readBlobs(specs, { cwd });
  const blobFor = (hash, filePath) => blobs.get(`${hash}:${filePath}`) || null;

  for (const change of changes) {
    const beforeBlob = change.status === 'A' ? null : blobFor(hashA, change.path);
    const afterBlob = change.status === 'D' ? null : blobFor(hashB, change.path);

    // Diffing binary content line by line is meaningless and slow, so we
    // report it the way git does and move on.
    if (reader.isBinary(beforeBlob) || reader.isBinary(afterBlob)) {
      console.log(render.renderBinaryFile(change.path, change.status, { color }));
      continue;
    }

    const before = beforeBlob ? beforeBlob.toString('utf8') : '';
    const after = afterBlob ? afterBlob.toString('utf8') : '';
    const ops = myers.diffLines(before, after);
    const fileStats = myers.stats(ops);
    totals.added += fileStats.added;
    totals.removed += fileStats.removed;

    console.log(render.renderFileHeader(change.path, change.status, ops, { color }));
    if (!flags.stat) {
      console.log(render.renderFileDiff(ops, { color, context }));
      console.log();
    }
  }

  console.log();
  console.log(render.renderSummary(changes.length, totals, { color }));
  return 0;
}

function main(argv) {
  const { positional, flags } = parseArgv(argv);
  const style = createStyle({ enabled: colorPreference(flags) });
  const [command, ...rest] = positional;

  if (!command || command === 'help' || flags.help) {
    console.log(usage());
    return command ? 0 : 1;
  }

  const commands = {
    graph: () => commandGraph(flags, style),
    ask: () => commandAsk(rest, flags, style),
    diff: () => commandDiff(rest, flags, style),
  };

  if (!commands[command]) {
    console.error(style.red(`Unknown command: ${command}`));
    console.error(usage());
    return 1;
  }

  try {
    return commands[command]();
  } catch (err) {
    // One feature failing to load must not look like the whole tool crashed:
    // say which command is unavailable and leave the others usable.
    if (err.code === 'MODULE_NOT_FOUND') {
      console.error(style.red(`The ${command} module is unavailable: ${err.message.split('\n')[0]}`));
      console.error(style.dim('The other commands still work — try `repotool help`.'));
      return 1;
    }
    throw err;
  }
}

if (require.main === module) {
  const style = createStyle({});
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    // QueryError is matched by name: its module may not even be loaded.
    if (err instanceof reader.GitError || err.name === 'QueryError') {
      console.error(style.red(err.message));
      process.exitCode = 1;
    } else {
      throw err;
    }
  }
}

module.exports = { main, parseArgv };
