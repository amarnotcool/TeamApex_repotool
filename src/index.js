'use strict';

/**
 * repotool — public API.
 *
 * The CLI in bin/repotool.js is one consumer of these modules; this file is
 * the entry point for anyone who would rather call them directly:
 *
 *   const { readCommits, buildGraph, renderAscii } = require('@amarnotcool/repotool');
 *   const { commits } = readCommits({ cwd: '/path/to/repo' });
 *   console.log(renderAscii(buildGraph(commits)));
 *
 * Each feature is also grouped under its own namespace (`graph`, `query`,
 * `diff`, `git`) so callers can take just the part they need. Requires are
 * lazy for the same reason the CLI's are: one feature must not be able to
 * break the others.
 */

/** Define a lazily-required property, so a missing module only fails on use. */
function lazy(target, name, load) {
  Object.defineProperty(target, name, {
    enumerable: true,
    // Configurable so the getter can replace itself with the resolved value.
    configurable: true,
    get() {
      const value = load();
      // Repeated access shouldn't re-enter the module loader.
      Object.defineProperty(target, name, { value, enumerable: true });
      return value;
    },
  });
}

const api = {};

// --- git reading -----------------------------------------------------------
lazy(api, 'git', () => require('./git-reader'));
lazy(api, 'readCommits', () => require('./git-reader').readCommits);
lazy(api, 'head', () => require('./git-reader').head);
lazy(api, 'isRepo', () => require('./git-reader').isRepo);
lazy(api, 'resolveRev', () => require('./git-reader').resolveRev);
lazy(api, 'changedPaths', () => require('./git-reader').changedPaths);
lazy(api, 'readBlobs', () => require('./git-reader').readBlobs);
lazy(api, 'isBinary', () => require('./git-reader').isBinary);
lazy(api, 'GitError', () => require('./git-reader').GitError);

// --- graph -----------------------------------------------------------------
lazy(api, 'graph', () => ({
  ...require('./graph/build-graph'),
  ...require('./graph/render-ascii'),
}));
lazy(api, 'buildGraph', () => require('./graph/build-graph').buildGraph);
lazy(api, 'topoSort', () => require('./graph/build-graph').topoSort);
lazy(api, 'renderAscii', () => require('./graph/render-ascii').renderAscii);

// --- query -----------------------------------------------------------------
lazy(api, 'query', () => ({
  ...require('./query/parser'),
  ...require('./query/handlers'),
}));
lazy(api, 'parseQuestion', () => require('./query/parser').parseQuestion);
lazy(api, 'supportedQuestions', () => require('./query/parser').supportedQuestions);
lazy(api, 'answerQuestion', () => require('./query/handlers').answer);
lazy(api, 'QueryError', () => require('./query/handlers').QueryError);

// --- diff ------------------------------------------------------------------
lazy(api, 'diff', () => ({
  ...require('./diff/myers'),
  ...require('./diff/render-diff'),
}));
lazy(api, 'myersDiff', () => require('./diff/myers').diff);
lazy(api, 'diffLines', () => require('./diff/myers').diffLines);
lazy(api, 'toHunks', () => require('./diff/myers').toHunks);
lazy(api, 'renderFileDiff', () => require('./diff/render-diff').renderFileDiff);

// --- output ----------------------------------------------------------------
lazy(api, 'createStyle', () => require('./ansi').createStyle);

module.exports = api;
