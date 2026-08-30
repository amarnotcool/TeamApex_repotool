'use strict';

/**
 * Tests for the dependency proof itself.
 *
 * A checker that always passes proves nothing, so these plant real violations
 * in a copy of the project and assert the script catches each one.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PROJECT_ROOT = path.join(__dirname, '..');

/**
 * Build a require() line without writing one literally in this file: the
 * verify script scans source text, so a literal fixture here would be picked
 * up as a violation of this very project.
 */
const requireLine = (id) => `const x = ${'require'}('${id}');
`;

function projectCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repotool-verify-'));
  for (const entry of ['bin', 'src', 'test', 'package.json', 'verify-zero-deps.js']) {
    fs.cpSync(path.join(PROJECT_ROOT, entry), path.join(dir, entry), { recursive: true });
  }
  return dir;
}

function runVerify(dir) {
  try {
    return { status: 0, output: execFileSync(process.execPath, [path.join(dir, 'verify-zero-deps.js')], {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
    }) };
  } catch (err) {
    return { status: err.status, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

test('the verify script passes on the real project', () => {
  const result = runVerify(PROJECT_ROOT);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /zero runtime dependencies verified/);
});

test('the verify script scans test/ as well as src/ and bin/', () => {
  const result = runVerify(PROJECT_ROOT);
  assert.match(result.output, /src\/, bin\/, test\//);
});

test('a declared runtime dependency fails the check', () => {
  const dir = projectCopy();
  try {
    const manifestPath = path.join(dir, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.dependencies = { chalk: '^5.0.0' };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const result = runVerify(dir);
    assert.equal(result.status, 1);
    assert.match(result.output, /declares runtime dependencies/);
    assert.match(result.output, /chalk/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a third-party import anywhere in src/ fails the check', () => {
  const dir = projectCopy();
  try {
    fs.writeFileSync(path.join(dir, 'src', 'sneaky.js'), requireLine('chalk'));
    const result = runVerify(dir);
    assert.equal(result.status, 1);
    assert.match(result.output, /not Node built-ins/);
    assert.match(result.output, /sneaky\.js -> chalk/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a third-party import in test/ fails the check too', () => {
  const dir = projectCopy();
  try {
    fs.writeFileSync(path.join(dir, 'test', 'sneaky.test.js'), requireLine('jest'));
    const result = runVerify(dir);
    assert.equal(result.status, 1);
    assert.match(result.output, /sneaky\.test\.js -> jest/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('node: prefixed built-ins are accepted, including node:test', () => {
  const dir = projectCopy();
  try {
    fs.writeFileSync(
      path.join(dir, 'src', 'builtins-only.js'),
      requireLine('node:test') + requireLine('node:fs') + requireLine('path'),
    );
    const result = runVerify(dir);
    assert.equal(result.status, 0, result.output);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a require inside a comment is not reported as an import', () => {
  const dir = projectCopy();
  try {
    const documented = `/**\n * Example: ${requireLine('chalk').trim()}\n */\nmodule.exports = {};\n`;
    fs.writeFileSync(path.join(dir, 'src', 'documented.js'), documented);

    const result = runVerify(dir);
    assert.equal(result.status, 0, result.output);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a real import on the same line as a trailing comment is still caught', () => {
  const dir = projectCopy();
  try {
    fs.writeFileSync(path.join(dir, 'src', 'trailing.js'), `${requireLine('chalk').trim()} // needed for colour\n`);
    const result = runVerify(dir);
    assert.equal(result.status, 1, 'a trailing comment must not hide a real import');
    assert.match(result.output, /trailing\.js -> chalk/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
