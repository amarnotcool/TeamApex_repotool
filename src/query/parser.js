'use strict';

/**
 * parser — question string to intent.
 *
 * This is deliberately not NLP. Each supported question is described by a
 * pattern: a set of keywords that must be present and a regular expression
 * that pulls out the argument (a file path, an author name, a count). The
 * first pattern whose keywords all match wins, so adding a question means
 * adding one entry to INTENTS — nothing else changes.
 */

/** Strip quotes and trailing punctuation from a captured argument. */
function clean(value) {
  if (!value) return null;
  return value
    .trim()
    .replace(/^["'`]|["'`]$/g, '')
    .replace(/[?.!,]+$/, '')
    .trim() || null;
}

/**
 * Every supported question.
 *
 * keywords — all of these must appear in the normalised question
 * extract   — optional regex; capture group 1 becomes `argument`
 */
const INTENTS = [
  {
    name: 'who-touched',
    describe: 'who last touched <file>',
    keywords: [['who'], ['touched', 'changed', 'edited', 'modified', 'wrote']],
    extract: /(?:touched|changed|edited|modified|wrote)\s+(?:the\s+)?(?:file\s+)?(.+)$/i,
    argumentName: 'file',
  },
  {
    name: 'when-was',
    describe: 'when was <commit> made',
    keywords: [['when'], ['commit', 'made', 'committed', 'was']],
    extract: /(?:commit|was)\s+([0-9a-f]{4,40}|\S+)/i,
    argumentName: 'rev',
  },
  {
    name: 'count-by-author',
    describe: 'how many commits by <author> (omit author for a full breakdown)',
    keywords: [['how many', 'count', 'number of'], ['commit', 'commits']],
    extract: /(?:by|from|did)\s+(.+)$/i,
    argumentName: 'author',
  },
  {
    name: 'files-changed',
    describe: 'what files changed in <commit>',
    keywords: [['file', 'files'], ['in', 'changed', 'touched']],
    extract: /(?:in|of|for)\s+(?:commit\s+)?(\S+)$/i,
    argumentName: 'rev',
  },
  {
    name: 'last-commits',
    describe: 'show the last <n> commits',
    keywords: [['last', 'latest', 'recent'], ['commit', 'commits']],
    extract: /(\d+)/,
    argumentName: 'count',
  },
  {
    name: 'top-authors',
    describe: 'who are the top contributors',
    keywords: [['who', 'top'], ['contributor', 'contributors', 'authors', 'author']],
    extract: null,
    argumentName: null,
  },
  {
    name: 'busiest-file',
    describe: 'which file changed the most',
    keywords: [['which', 'what'], ['file', 'files'], ['most', 'often', 'frequently']],
    extract: null,
    argumentName: null,
  },
  {
    name: 'branch-list',
    describe: 'what branches exist',
    keywords: [['branch', 'branches']],
    extract: null,
    argumentName: null,
  },
];

/** A keyword group matches when any of its alternatives appears. */
function groupMatches(group, question) {
  return group.some((word) => new RegExp(`\\b${word.replace(/\s+/g, '\\s+')}\\b`, 'i').test(question));
}

/**
 * Parse a question into { name, argument, argumentName } or null when nothing
 * matches. Scoring by number of matched keywords keeps more specific patterns
 * (e.g. busiest-file, which needs three groups) ahead of looser ones.
 */
function parseQuestion(raw) {
  const question = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!question) return null;

  let best = null;
  for (const intent of INTENTS) {
    if (!intent.keywords.every((group) => groupMatches(group, question))) continue;
    const score = intent.keywords.length;
    if (!best || score > best.score) best = { intent, score };
  }
  if (!best) return null;

  const { intent } = best;
  const match = intent.extract ? question.match(intent.extract) : null;
  return {
    name: intent.name,
    describe: intent.describe,
    argumentName: intent.argumentName,
    argument: clean(match && match[1]),
    question,
  };
}

/** Human-readable list of everything we can answer, for help and error text. */
function supportedQuestions() {
  return INTENTS.map((intent) => intent.describe);
}

module.exports = { parseQuestion, supportedQuestions, INTENTS };
