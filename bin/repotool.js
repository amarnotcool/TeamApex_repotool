#!/usr/bin/env node
'use strict';

/**
 * repotool CLI — argument routing.
 *
 * Hand-rolled argv parsing: no commander, no yargs. The shape is
 *   repotool <command> [positional...] [--flag] [--option value]
 * and each command owns its own positional handling.
 */

const path = require('node:path');
const reader = require('../src/git-reader');
const { buildGraph } = require('../src/graph/build-graph');
const { renderAscii } = require('../src/graph/render-ascii');
const { parseQuestion, supportedQuestions } = require('../src/query/parser');
const { answer, QueryError } = require('../src/query/handlers');
const myers = require('../src/diff/myers');
const render = require('../src/diff/render-diff');
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

const USAGE = `repotool — understand a git repository, with zero dependencies

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
${supportedQuestions()
  .map((q) => `  - ${q}`)
  .join('\n')}
`;

function commandGraph(flags, style) {
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

  for (const change of changes) {
    // Diffing binary content line by line is meaningless and slow, so we
    // report it the way git does and move on.
    if (change.binary) {
      console.log(render.renderBinaryFile(change.path, change.status, { color }));
      continue;
    }

    const before = change.status === 'A' ? '' : reader.fileAtCommit(hashA, change.path, { cwd }) || '';
    const after = change.status === 'D' ? '' : reader.fileAtCommit(hashB, change.path, { cwd }) || '';
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
    console.log(USAGE);
    return command ? 0 : 1;
  }

  switch (command) {
    case 'graph':
      return commandGraph(flags, style);
    case 'ask':
      return commandAsk(rest, flags, style);
    case 'diff':
      return commandDiff(rest, flags, style);
    default:
      console.error(style.red(`Unknown command: ${command}`));
      console.error(USAGE);
      return 1;
  }
}

if (require.main === module) {
  const style = createStyle({});
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    if (err instanceof reader.GitError || err instanceof QueryError) {
      console.error(style.red(err.message));
      process.exitCode = 1;
    } else {
      throw err;
    }
  }
}

module.exports = { main, parseArgv };
