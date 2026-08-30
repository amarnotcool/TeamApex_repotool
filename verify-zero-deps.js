#!/usr/bin/env node
'use strict';

/**
 * verify-zero-deps.js — the dependency proof, runnable anywhere Node runs.
 *
 * Same three checks as verify-zero-deps.sh, without needing a POSIX shell, so
 * a reviewer on Windows without Git Bash can verify the claim too:
 *
 *   1. package.json declares no runtime dependencies
 *   2. every require() in src/, bin/ and test/ is a Node built-in or relative
 *   3. node_modules holds nothing beyond declared devDependencies
 *
 * Exits 0 when the project is clean, 1 on the first failure.
 * Naturally, this script itself uses only built-in modules.
 */

const fs = require('node:fs');
const path = require('node:path');
const nodeModule = require('node:module');

const ROOT = __dirname;
const SCANNED_DIRS = ['src', 'bin', 'test'];

/**
 * `module.isBuiltin` is the authority here rather than the `builtinModules`
 * array: modules that only exist under the `node:` prefix — `node:test` is
 * the one we use — are deliberately absent from that array.
 */
const BUILTINS = new Set(nodeModule.builtinModules);
const isBuiltinId = (id) =>
  typeof nodeModule.isBuiltin === 'function'
    ? nodeModule.isBuiltin(id)
    : BUILTINS.has(id.startsWith('node:') ? id.slice(5) : id);

const results = [];
let failed = false;

function pass(message) {
  results.push(`PASS: ${message}`);
}

function fail(message, details = []) {
  failed = true;
  results.push(`FAIL: ${message}`);
  for (const detail of details) results.push(`  ${detail}`);
}

/** Every .js file under a directory, recursively. */
function jsFiles(dir) {
  const found = [];
  if (!fs.existsSync(dir)) return found;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...jsFiles(full));
    else if (entry.name.endsWith('.js')) found.push(full);
  }
  return found;
}

/**
 * Remove comments before scanning, so a require() shown in documentation is
 * not reported as a real import. Block comments go entirely; for line
 * comments we only strip whole-line ones, which avoids mangling a `//` that
 * lives inside a string such as a URL.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Module ids required by a file, from both require() and import syntax. */
function importedIds(rawSource) {
  const source = stripComments(rawSource);
  const ids = [];
  const patterns = [
    /require\(\s*(['"])(.*?)\1\s*\)/g,
    /\bfrom\s+(['"])(.*?)\1/g,
    /\bimport\s*\(\s*(['"])(.*?)\1\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) ids.push(match[2]);
  }
  return ids;
}

function isAllowed(id) {
  if (id.startsWith('.') || id.startsWith('/')) return true; // our own files
  return isBuiltinId(id);
}

// ---------------------------------------------------------------- check one
function checkManifest() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const deps = Object.keys(manifest.dependencies || {});
  const peer = Object.keys(manifest.peerDependencies || {});
  const bundled = Object.keys(manifest.bundleDependencies || manifest.bundledDependencies || {});
  const offenders = [...deps, ...peer, ...bundled];

  if (offenders.length) {
    fail('package.json declares runtime dependencies', offenders);
    return;
  }

  const dev = Object.keys(manifest.devDependencies || {});
  pass(
    dev.length
      ? `zero runtime dependencies (devDependencies present, must be listed in STDLIB.md: ${dev.join(', ')})`
      : 'zero runtime dependencies, and no devDependencies either',
  );
}

// ---------------------------------------------------------------- check two
function checkImports() {
  const offenders = [];
  let fileCount = 0;
  let importCount = 0;

  for (const dir of SCANNED_DIRS) {
    for (const file of jsFiles(path.join(ROOT, dir))) {
      fileCount++;
      const source = fs.readFileSync(file, 'utf8');
      for (const id of importedIds(source)) {
        importCount++;
        if (!isAllowed(id)) offenders.push(`${path.relative(ROOT, file)} -> ${id}`);
      }
    }
  }

  if (offenders.length) {
    fail('found imports that are not Node built-ins', offenders);
    return;
  }
  pass(
    `all ${importCount} imports across ${fileCount} files in ${SCANNED_DIRS.join('/, ')}/ ` +
      'are Node built-ins or relative paths',
  );
}

// -------------------------------------------------------------- check three
function checkNodeModules() {
  const dir = path.join(ROOT, 'node_modules');
  if (!fs.existsSync(dir)) {
    pass('no node_modules directory present');
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const declared = new Set(Object.keys(manifest.devDependencies || {}));
  const installed = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name);

  // Anything installed that is not a declared devDependency (or npm's own
  // bookkeeping) means something arrived that the manifest does not admit to.
  const unexpected = installed.filter((name) => !declared.has(name) && name !== '.package-lock.json');
  if (unexpected.length) {
    fail('node_modules contains packages beyond declared devDependencies', unexpected);
    return;
  }
  pass(`node_modules holds only declared devDependencies (${installed.length} entries)`);
}

checkManifest();
checkImports();
checkNodeModules();

console.log(results.join('\n'));
console.log(failed ? '\nRESULT: FAILED' : '\nRESULT: zero runtime dependencies verified');
process.exit(failed ? 1 : 0);
