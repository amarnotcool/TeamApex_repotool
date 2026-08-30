'use strict';

/**
 * Shell completion tests.
 *
 * The scripts are generated, so the risk is not "did someone typo a flag" but
 * "does the generator still emit a script the shell will accept". `bash -n`
 * answers that for bash; for zsh we check the structure we control, since a
 * zsh binary is not something we can assume on a test machine.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { bashScript, zshScript, completionScript, SHELLS } = require('../src/completion');

const CLI = path.join(__dirname, '..', 'bin', 'repotool.js');

function runCli(args) {
  return execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', windowsHide: true });
}

/** Is a working `bash` on PATH? Windows without Git Bash has none. */
function hasBash() {
  try {
    execFileSync('bash', ['-c', 'exit 0'], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

test('the generated bash script is syntactically valid', { skip: hasBash() ? false : 'no bash on PATH' }, () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'repotool-completion-')), 'repotool.bash');
  fs.writeFileSync(file, bashScript());
  try {
    // `bash -n` parses without executing: exactly the check we want.
    execFileSync('bash', ['-n', file], { stdio: 'pipe', windowsHide: true });
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

test('the bash script registers a completion for repotool and knows the commands', () => {
  const script = bashScript();
  assert.match(script, /complete -F _repotool repotool/);
  for (const command of ['graph', 'stats', 'hotspots', 'ask', 'diff', 'completion']) {
    assert.ok(script.includes(command), `bash script should mention ${command}`);
  }
});

test('static option values appear in both scripts', () => {
  for (const script of [bashScript(), zshScript()]) {
    assert.ok(script.includes('score commits churn authors'), '--sort values');
    assert.ok(script.includes('ascii svg'), '--format values');
    assert.ok(script.includes('--json'), '--json flag');
    assert.ok(script.includes('--no-color'), 'global flags');
  }
});

test('the zsh script is a compdef with balanced case blocks', () => {
  const script = zshScript();
  assert.match(script, /^#compdef repotool/);
  const opens = (script.match(/\bcase\b/g) || []).length;
  const closes = (script.match(/\besac\b/g) || []).length;
  assert.equal(opens, closes, 'every case must be closed by an esac');
  assert.match(script, /_repotool\(\) \{/);
});

test('completionScript only answers for shells we generate', () => {
  assert.deepEqual(SHELLS, ['bash', 'zsh']);
  assert.equal(completionScript('fish'), null);
  assert.equal(typeof completionScript('bash'), 'string');
});

test('the CLI prints the scripts and rejects unknown shells', () => {
  assert.equal(runCli(['completion', 'bash']), bashScript());
  assert.equal(runCli(['completion', 'zsh']), zshScript());

  const failed = (() => {
    try {
      execFileSync(process.execPath, [CLI, 'completion', 'fish'], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
      return null;
    } catch (err) {
      return err;
    }
  })();
  assert.ok(failed, 'an unknown shell must not exit 0');
  assert.equal(failed.status, 2);
  assert.match(String(failed.stderr), /Supported shells/);
});

test('completion with no shell named explains itself', () => {
  try {
    execFileSync(process.execPath, [CLI, 'completion'], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
    assert.fail('expected a usage error');
  } catch (err) {
    assert.equal(err.status, 2);
    assert.match(String(err.stderr), /needs a shell/);
  }
});
