'use strict';

/**
 * SVG export tests.
 *
 * Two things matter: the document has to be well-formed XML (we build it by
 * hand, so nothing else guarantees that), and it has to show exactly the
 * structure the layout says is there — one node per commit, one edge per
 * parent link — so the SVG and ASCII renderers cannot disagree.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const reader = require('../src/git-reader');
const { buildGraph } = require('../src/graph/build-graph');
const { renderSvg, escapeXml } = require('../src/graph/render-svg');
const { parseXml, findByClass } = require('./xml');
const { makeRepo, commit, git, cleanup } = require('./helpers');

/** The same branchy fixture the ASCII graph tests use: two branches, a merge. */
function branchyRepo() {
  const dir = makeRepo();
  commit(dir, 'app.js', 'one\n', 'Initial commit');
  commit(dir, 'app.js', 'one\ntwo\n', 'Second commit');
  git(dir, ['checkout', '-q', '-b', 'feature']);
  commit(dir, 'feature.txt', 'hello\n', 'Add feature', 'Grace Hopper');
  git(dir, ['checkout', '-q', 'main']);
  commit(dir, 'README.md', 'readme\n', 'Add readme', 'Test Author');
  git(dir, ['merge', '-q', '--no-ff', 'feature', '-m', 'Merge feature']);
  return dir;
}

test('the SVG export parses as well-formed XML', () => {
  const dir = branchyRepo();
  try {
    const { commits } = reader.readCommits({ cwd: dir });
    const root = parseXml(renderSvg(buildGraph(commits)));

    assert.equal(root.name, 'svg');
    assert.equal(root.attributes.xmlns, 'http://www.w3.org/2000/svg');
    assert.ok(Number(root.attributes.width) > 0);
    assert.ok(Number(root.attributes.height) > 0);
  } finally {
    cleanup(dir);
  }
});

test('node and edge counts match the underlying graph model', () => {
  const dir = branchyRepo();
  try {
    const { commits } = reader.readCommits({ cwd: dir });
    const graph = buildGraph(commits);
    const root = parseXml(renderSvg(graph));

    const nodes = findByClass(root, 'node');
    const edges = findByClass(root, 'edge');
    const labels = findByClass(root, 'label');

    const parentLinks = graph.rows.reduce((sum, row) => sum + row.commit.parents.length, 0);
    assert.equal(nodes.length, graph.rows.length, 'one node per commit');
    assert.equal(edges.length, parentLinks, 'one edge per parent link');
    assert.equal(labels.length, graph.rows.length, 'one label per commit');

    // Merges are diamonds, roots are hollow circles, ordinary commits solid.
    assert.equal(findByClass(root, 'merge').length, commits.filter((c) => c.isMerge).length);
    assert.equal(findByClass(root, 'root').length, commits.filter((c) => c.isRoot).length);
  } finally {
    cleanup(dir);
  }
});

test('commit text is escaped rather than injected into the markup', () => {
  const dir = makeRepo();
  try {
    commit(dir, 'a.txt', 'x\n', 'Fix <script> & "quoted" bug');
    const { commits } = reader.readCommits({ cwd: dir });
    const svg = renderSvg(buildGraph(commits));

    assert.ok(!svg.includes('<script>'), 'raw markup must not survive into the document');
    assert.ok(svg.includes('&lt;script&gt;'));
    const root = parseXml(svg);
    assert.equal(findByClass(root, 'label').length, 1);
  } finally {
    cleanup(dir);
  }
});

test('an empty repository renders an empty but valid document', () => {
  const graph = buildGraph([]);
  const root = parseXml(renderSvg(graph));
  assert.equal(findByClass(root, 'node').length, 0);
  assert.equal(findByClass(root, 'edge').length, 0);
});

test('a parent outside the loaded history still draws a dashed stub', () => {
  const dir = branchyRepo();
  try {
    // --limit cuts history, so the oldest loaded commit has a parent with no
    // row of its own; the edge must still be there, marked as cut off.
    const { commits } = reader.readCommits({ cwd: dir, limit: 2 });
    const svg = renderSvg(buildGraph(commits));
    const edges = findByClass(parseXml(svg), 'edge');
    assert.ok(edges.some((edge) => edge.attributes['stroke-dasharray']));
  } finally {
    cleanup(dir);
  }
});

test('escapeXml removes control characters XML cannot represent', () => {
  assert.equal(escapeXml('a\u0000b\u0007c'), 'abc');
  assert.equal(escapeXml('a & b'), 'a &amp; b');
});

test('the XML checker itself rejects malformed documents', () => {
  assert.throws(() => parseXml('<a><b></a></b>'), /closes/);
  assert.throws(() => parseXml('<a x=1 />'), /not quoted/);
  assert.throws(() => parseXml('<a>'), /unclosed/);
});

// --- CLI wiring ------------------------------------------------------------

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'repotool.js');

test('graph --format svg writes only the document to stdout', () => {
  const dir = branchyRepo();
  try {
    const stdout = execFileSync(process.execPath, [CLI, 'graph', '--format', 'svg'], {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.ok(stdout.startsWith('<?xml'), 'no status banner may precede the document');
    const root = parseXml(stdout);
    assert.equal(root.name, 'svg');
  } finally {
    cleanup(dir);
  }
});

test('graph --output writes to a file, keeping stdout clean', () => {
  const dir = branchyRepo();
  const target = path.join(dir, 'history.svg');
  try {
    const stdout = execFileSync(process.execPath, [CLI, 'graph', '--format', 'svg', '--output', target], {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(stdout, '', 'the status line belongs on stderr');
    const written = fs.readFileSync(target, 'utf8');
    assert.equal(parseXml(written).name, 'svg');
  } finally {
    cleanup(dir);
  }
});

test('graph --format rejects an unknown renderer', () => {
  const dir = branchyRepo();
  try {
    execFileSync(process.execPath, [CLI, 'graph', '--format', 'png'], {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
      stdio: 'pipe',
    });
    assert.fail('expected a usage error');
  } catch (err) {
    assert.equal(err.status, 2);
    assert.match(String(err.stderr), /--format must be one of/);
  } finally {
    cleanup(dir);
  }
});

test('the ascii renderer is unaffected by the new flags', () => {
  const dir = branchyRepo();
  try {
    const stdout = execFileSync(process.execPath, [CLI, 'graph'], {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.match(stdout, /commit\(s\), on branch main/);
    assert.ok(!stdout.includes('<svg'));
  } finally {
    cleanup(dir);
  }
});
