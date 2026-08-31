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

// --- analysis --------------------------------------------------------------
lazy(api, 'analysis', () => ({
  ...require('./analysis/repo-model'),
  ...require('./analysis/render-stats'),
  ...require('./analysis/render-hotspots'),
  ...require('./analysis/to-json'),
  ...require('./analysis/health'),
  ...require('./analysis/render-health'),
  ...require('./analysis/timeline'),
  ...require('./analysis/render-timeline'),
  ...require('./analysis/compare'),
  ...require('./analysis/render-compare'),
}));
lazy(api, 'buildRepoModel', () => require('./analysis/repo-model').buildRepoModel);
lazy(api, 'rankHotspots', () => require('./analysis/repo-model').rankHotspots);
lazy(api, 'activityComparison', () => require('./analysis/repo-model').activityComparison);
lazy(api, 'renderStats', () => require('./analysis/render-stats').renderStats);
lazy(api, 'renderHotspots', () => require('./analysis/render-hotspots').renderHotspots);
lazy(api, 'statsJson', () => require('./analysis/to-json').statsJson);
lazy(api, 'hotspotsJson', () => require('./analysis/to-json').hotspotsJson);
lazy(api, 'computeHealth', () => require('./analysis/health').computeHealth);
lazy(api, 'renderHealth', () => require('./analysis/render-health').renderHealth);
lazy(api, 'healthJson', () => require('./analysis/to-json').healthJson);
lazy(api, 'buildTimeline', () => require('./analysis/timeline').buildTimeline);
lazy(api, 'renderTimeline', () => require('./analysis/render-timeline').renderTimeline);
lazy(api, 'timelineJson', () => require('./analysis/to-json').timelineJson);
lazy(api, 'compareRefs', () => require('./analysis/compare').compareRefs);
lazy(api, 'renderCompare', () => require('./analysis/render-compare').renderCompare);
lazy(api, 'compareJson', () => require('./analysis/to-json').compareJson);

// --- graph -----------------------------------------------------------------
lazy(api, 'graph', () => ({
  ...require('./graph/build-graph'),
  ...require('./graph/render-ascii'),
  ...require('./graph/render-svg'),
}));
lazy(api, 'buildGraph', () => require('./graph/build-graph').buildGraph);
lazy(api, 'topoSort', () => require('./graph/build-graph').topoSort);
lazy(api, 'renderAscii', () => require('./graph/render-ascii').renderAscii);
lazy(api, 'renderSvg', () => require('./graph/render-svg').renderSvg);

// --- query -----------------------------------------------------------------
lazy(api, 'query', () => ({
  ...require('./query/parser'),
  ...require('./query/handlers'),
}));
lazy(api, 'parseQuestion', () => require('./query/parser').parseQuestion);
lazy(api, 'supportedQuestions', () => require('./query/parser').supportedQuestions);
lazy(api, 'answerQuestion', () => require('./query/handlers').answer);
lazy(api, 'answerQuestionJson', () => require('./query/handlers').answerJson);
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

// --- completion ------------------------------------------------------------
lazy(api, 'completion', () => require('./completion'));
lazy(api, 'completionScript', () => require('./completion').completionScript);

// --- output ----------------------------------------------------------------
lazy(api, 'format', () => require('./format'));
lazy(api, 'createStyle', () => require('./ansi').createStyle);

module.exports = api;
