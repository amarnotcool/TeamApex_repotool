'use strict';

/**
 * render-diff — unified-diff output, coloured with raw ANSI codes.
 *
 * Input is the edit script from myers.js; this file only decides how it looks.
 */

const { createStyle } = require('../ansi');
const { toHunks, stats } = require('./myers');

const MARKS = { equal: ' ', insert: '+', delete: '-' };

/** Render one file's edit script as a unified diff body. */
function renderFileDiff(ops, options = {}) {
  const style = createStyle({ enabled: options.color });
  const context = options.context === undefined ? 3 : options.context;
  const hunks = toHunks(ops, context);
  const lines = [];

  for (const hunk of hunks) {
    lines.push(style.brightCyan(`@@ -${hunk.aStart},${hunk.aCount} +${hunk.bStart},${hunk.bCount} @@`));
    for (const op of hunk.ops) {
      const text = `${MARKS[op.type]}${op.value}`;
      if (op.type === 'insert') lines.push(style.green(text));
      else if (op.type === 'delete') lines.push(style.red(text));
      else lines.push(style.dim(text));
    }
  }

  return lines.join('\n');
}

/** Header shown above each changed file. */
function renderFileHeader(path, status, ops, options = {}) {
  const style = createStyle({ enabled: options.color });
  const { added, removed } = stats(ops);
  const label = { A: 'added', D: 'deleted', M: 'modified', R: 'renamed' }[status] || 'changed';
  return [
    style.bold(`${path}`),
    `${style.dim(label)}  ${style.green(`+${added}`)} ${style.red(`-${removed}`)}`,
  ].join('  ');
}

/** Bottom-line summary across every file in the diff. */
function renderSummary(fileCount, totals, options = {}) {
  const style = createStyle({ enabled: options.color });
  return style.dim(
    `${fileCount} file(s) changed, ${totals.added} insertion(s)(+), ${totals.removed} deletion(s)(-)`,
  );
}

module.exports = { renderFileDiff, renderFileHeader, renderSummary };
