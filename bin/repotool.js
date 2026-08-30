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

const fs = require('node:fs');
const path = require('node:path');
const reader = require('../src/git-reader');
const { createStyle } = require('../src/ansi');

/** Flags that take a value rather than being booleans. */
const VALUED_FLAGS = new Set(['limit', 'context', 'repo', 'branch', 'sort', 'window', 'format', 'output']);

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

/** Thrown for bad input; the CLI turns it into a message and exit code 2. */
class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

/**
 * Read a numeric flag, rejecting anything that is not a positive number.
 * Returns undefined when the flag was not supplied.
 */
function numericFlag(flags, name, { min = 1 } = {}) {
  if (flags[name] === undefined) return undefined;
  const value = Number(flags[name]);
  if (!Number.isFinite(value) || value < min) {
    throw new UsageError(`--${name} needs a number of at least ${min}, got: ${flags[name]}`);
  }
  return value;
}

/** Read a flag constrained to a fixed set of values. */
function choiceFlag(flags, name, allowed, fallback) {
  if (flags[name] === undefined) return fallback;
  if (!allowed.includes(flags[name])) {
    throw new UsageError(`--${name} must be one of: ${allowed.join(', ')} (got: ${flags[name]})`);
  }
  return flags[name];
}

/** Options every command understands. */
const GLOBAL_OPTIONS = [
  ['--repo PATH', 'repository to inspect (default: current directory)'],
  ['--color', 'force ANSI colour on'],
  ['--no-color', 'force ANSI colour off (also honours NO_COLOR)'],
  ['--help', 'show help for the command'],
];

/**
 * Per-command help: usage line, what it does, its own options and examples.
 * Keeping this as data means `repotool help <command>` and `<command> --help`
 * cannot drift apart from each other.
 */
const COMMANDS = {
  graph: {
    usage: 'repotool graph [--limit N] [--branch REF] [--no-dates] [--format ascii|svg] [--output PATH]',
    summary: 'draw the commit and merge history as a lane graph',
    options: [
      ['--limit N', 'read at most N commits'],
      ['--branch REF', 'graph one branch instead of every ref'],
      ['--no-dates', 'omit author dates'],
      ['--format KIND', 'ascii (default) or svg'],
      ['--output PATH', 'write to a file instead of stdout'],
    ],
    examples: [
      'repotool graph',
      'repotool graph --limit 20',
      'repotool graph --branch main --no-dates',
      'repotool graph --format svg --output history.svg',
    ],
  },
  stats: {
    usage: 'repotool stats [--limit N] [--json]',
    summary: 'one-screen overview: commits, contributors, branches, churn',
    options: [
      ['--limit N', 'read at most N commits of history'],
      ['--json', 'print the same figures as JSON, for scripts'],
    ],
    examples: ['repotool stats', 'repotool stats --repo ../other-project', 'repotool stats --json'],
  },
  hotspots: {
    usage: 'repotool hotspots [--limit N] [--sort score|commits|churn|authors] [--json]',
    summary: 'rank files by how much attention they attract',
    options: [
      ['--limit N', 'rows to show (default 10)'],
      ['--sort KEY', 'score (default), commits, churn or authors'],
      ['--json', 'print the ranking as JSON, for scripts'],
    ],
    examples: ['repotool hotspots', 'repotool hotspots --limit 25 --sort churn', 'repotool hotspots --json'],
  },
  ask: {
    usage: 'repotool ask "<question>" [--json]',
    summary: 'answer a fixed set of questions about the repository',
    options: [['--json', 'print the answer as JSON, for scripts']],
    examples: [
      'repotool ask "who last touched src/app.js"',
      'repotool ask "who works most on src/app.js"',
      'repotool ask "what has changed recently"',
      'repotool ask "why is this repository changing so much"',
    ],
  },
  diff: {
    usage: 'repotool diff <commitA> [commitB] [--context N] [--stat]',
    summary: 'unified diff between two revisions, computed with our own Myers diff',
    options: [
      ['--context N', 'lines of context around each change (default 3)'],
      ['--stat', 'summary only, no diff bodies'],
    ],
    examples: ['repotool diff HEAD~3 HEAD', 'repotool diff main feature --context 5', 'repotool diff HEAD~1 HEAD --stat'],
  },
  completion: {
    usage: 'repotool completion <bash|zsh>',
    summary: 'print a shell completion script for repotool',
    options: [],
    examples: [
      'eval "$(repotool completion bash)"',
      'repotool completion zsh > "${fpath[1]}/_repotool"',
    ],
  },
};

/** Render a two-column option/example block. */
function optionBlock(pairs, indent = '  ') {
  const width = pairs.reduce((max, [flag]) => Math.max(max, flag.length), 0);
  return pairs.map(([flag, description]) => `${indent}${flag.padEnd(width)}  ${description}`).join('\n');
}

/** Help for one command. */
function commandUsage(name) {
  const command = COMMANDS[name];
  const parts = [`repotool ${name} — ${command.summary}`, '', 'Usage:', `  ${command.usage}`];

  if (command.options.length) {
    parts.push('', 'Options:', optionBlock(command.options));
  }
  parts.push('', 'Common options:', optionBlock(GLOBAL_OPTIONS));
  parts.push('', 'Examples:', ...command.examples.map((example) => `  ${example}`));

  if (name === 'ask') {
    parts.push('', 'Questions repotool can answer:', questionList());
  }
  return `${parts.join('\n')}\n`;
}

/**
 * The question list comes from the query module, which is loaded lazily here
 * too — if that module is missing, help still prints.
 */
function questionList() {
  try {
    return require('../src/query/parser')
      .supportedQuestions()
      .map((question) => `  - ${question}`)
      .join('\n');
  } catch {
    return '  (question list unavailable — the query module is missing)';
  }
}

/** Top-level help. */
function usage() {
  const summaries = [
    ...Object.entries(COMMANDS).map(([name, command]) => [name, command.summary]),
    ['help', 'show this help, or "repotool help <command>"'],
  ];

  return `repotool — understand a git repository, with zero dependencies

Usage:
  repotool <command> [options]

Commands:
${optionBlock(summaries)}

Common options:
${optionBlock(GLOBAL_OPTIONS)}

Questions repotool can answer:
${questionList()}

Run "repotool help <command>" for arguments and examples.
`;
}

const GRAPH_FORMATS = ['ascii', 'svg'];

function commandGraph(flags, style) {
  const { buildGraph } = require('../src/graph/build-graph');

  const format = choiceFlag(flags, 'format', GRAPH_FORMATS, 'ascii');
  const output = typeof flags.output === 'string' ? flags.output : null;
  if (flags.output === true) throw new UsageError('--output needs a file path.');

  const cwd = path.resolve(flags.repo || process.cwd());
  const limit = numericFlag(flags, 'limit');
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

  const graph = buildGraph(commits);

  if (format === 'svg') {
    const { renderSvg } = require('../src/graph/render-svg');
    const svg = renderSvg(graph, { dates: !flags['no-dates'], title: `${path.basename(cwd)} — repotool graph` });
    if (output) {
      // The status line goes to stderr so that redirecting stdout still
      // captures nothing but the document itself.
      fs.writeFileSync(output, svg);
      console.error(style.dim(`Wrote ${commits.length} commit(s) to ${output}`));
    } else {
      process.stdout.write(svg);
    }
    return 0;
  }

  const { renderAscii } = require('../src/graph/render-ascii');
  const location = head.empty
    ? 'empty repository'
    : head.detached
      ? `detached HEAD at ${head.hash.slice(0, 7)}`
      : `on branch ${head.branch}`;
  const ascii = renderAscii(graph, { color: colorPreference(flags), dates: !flags['no-dates'] });

  if (output) {
    fs.writeFileSync(output, `${ascii}\n`);
    console.error(style.dim(`Wrote ${commits.length} commit(s) to ${output}`));
    return 0;
  }

  console.log(style.dim(`${commits.length} commit(s), ${location}`));
  console.log();
  console.log(ascii);
  return 0;
}

function commandStats(flags, style) {
  const { buildRepoModel } = require('../src/analysis/repo-model');
  const { renderStats } = require('../src/analysis/render-stats');

  const cwd = path.resolve(flags.repo || process.cwd());
  const model = buildRepoModel({ cwd, limit: numericFlag(flags, 'limit') });

  if (flags.json) {
    console.log(JSON.stringify(require('../src/analysis/to-json').statsJson(model), null, 2));
    return 0;
  }

  console.log(renderStats(model, { color: colorPreference(flags) }));
  return 0;
}

const HOTSPOT_SORTS = ['score', 'commits', 'churn', 'authors'];

function commandHotspots(flags, style) {
  const { buildRepoModel } = require('../src/analysis/repo-model');
  const { renderHotspots } = require('../src/analysis/render-hotspots');

  const sort = choiceFlag(flags, 'sort', HOTSPOT_SORTS, 'score');
  const limit = numericFlag(flags, 'limit');

  const cwd = path.resolve(flags.repo || process.cwd());
  const model = buildRepoModel({ cwd });

  if (flags.json) {
    const { hotspotsJson } = require('../src/analysis/to-json');
    console.log(JSON.stringify(hotspotsJson(model, { limit: limit || 10, sort }), null, 2));
    return 0;
  }

  console.log(renderHotspots(model, { limit, sort, color: colorPreference(flags) }));
  return 0;
}

function commandAsk(positional, flags, style) {
  const { parseQuestion } = require('../src/query/parser');
  const { answer, answerJson } = require('../src/query/handlers');

  const cwd = path.resolve(flags.repo || process.cwd());
  const question = positional.join(' ');
  if (!question.trim()) {
    console.error(style.red('repotool ask needs a question.'));
    console.error(style.dim('Example: repotool ask "who last touched README.md" — see "repotool help ask".'));
    return 2;
  }

  const intent = parseQuestion(question);

  if (flags.json) {
    // Colour would corrupt the JSON, so the answer is built with a plain
    // style regardless of what the terminal supports.
    const plain = createStyle({ enabled: false });
    console.log(JSON.stringify(answerJson(intent, { cwd, style: plain }), null, 2));
    return 0;
  }

  console.log(answer(intent, { cwd, style }));
  return 0;
}

function commandCompletion(positional, flags, style) {
  const { completionScript, SHELLS } = require('../src/completion');

  const shell = positional[0];
  if (!shell) {
    throw new UsageError(`repotool completion needs a shell: ${SHELLS.join(' or ')}.`);
  }
  const script = completionScript(shell);
  if (!script) {
    throw new UsageError(`No completion script for ${shell}. Supported shells: ${SHELLS.join(', ')}.`);
  }
  process.stdout.write(script);
  return 0;
}

function commandDiff(positional, flags, style) {
  const myers = require('../src/diff/myers');
  const render = require('../src/diff/render-diff');

  const cwd = path.resolve(flags.repo || process.cwd());
  const [revA, revB = 'HEAD'] = positional;
  if (!revA) {
    console.error(style.red('repotool diff needs at least one revision.'));
    console.error(style.dim('Usage: repotool diff <commitA> [commitB] — see "repotool help diff".'));
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
  const context = numericFlag(flags, 'context', { min: 0 });
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
      console.log(render.renderFileDiff(ops, { color, context: context === undefined ? 3 : context }));
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

  // `repotool help [command]` is a successful request for help: stdout, exit 0.
  if (command === 'help') {
    const topic = rest[0];
    if (topic && COMMANDS[topic]) {
      console.log(commandUsage(topic));
      return 0;
    }
    if (topic) {
      console.error(style.red(`Unknown command: ${topic}`));
      console.error(usage());
      return 1;
    }
    console.log(usage());
    return 0;
  }

  // Running with no command at all is a usage error, so it goes to stderr.
  if (!command) {
    console.error(usage());
    return 2;
  }

  if (flags.help && COMMANDS[command]) {
    console.log(commandUsage(command));
    return 0;
  }

  const commands = {
    graph: () => commandGraph(flags, style),
    stats: () => commandStats(flags, style),
    hotspots: () => commandHotspots(flags, style),
    ask: () => commandAsk(rest, flags, style),
    diff: () => commandDiff(rest, flags, style),
    completion: () => commandCompletion(rest, flags, style),
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
    if (err.name === 'UsageError') {
      console.error(style.red(err.message));
      console.error(style.dim(`See "repotool help ${command}".`));
      return 2;
    }
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
