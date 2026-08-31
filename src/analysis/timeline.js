'use strict';

/**
 * timeline — commits folded into date buckets.
 *
 * The repo model already carries every commit's author date, author name and
 * per-file line counts, so a timeline needs no new git call: it is one pass
 * over data already in memory, grouped by day or by week.
 *
 * Dates are bucketed on their **local calendar day**, taken from the ISO
 * timestamp git already gave us. Parsing the date portion of the string
 * directly, rather than going through `Date` and back, avoids the timezone
 * shift that would otherwise move an evening commit into the next day.
 */

const BUCKETS = ['day', 'week'];
const DEFAULT_LIMIT = 30;
const METRICS = ['commits', 'lines', 'contributors'];

const DAY_MS = 24 * 60 * 60 * 1000;

/** "2026-08-25T19:04:11+05:30" -> "2026-08-25", without touching timezones. */
function dayKey(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return match ? match[0] : null;
}

/** Midnight UTC for a YYYY-MM-DD key, as a number we can do arithmetic on. */
function keyToTime(key) {
  return Date.parse(`${key}T00:00:00Z`);
}

function timeToKey(time) {
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * The Monday on or before a day key. ISO weeks start on Monday, and a week
 * bucket is named after the day it starts.
 */
function weekKey(key) {
  const time = keyToTime(key);
  const weekday = new Date(time).getUTCDay(); // 0 = Sunday
  const back = (weekday + 6) % 7;
  return timeToKey(time - back * DAY_MS);
}

function bucketKey(iso, by) {
  const day = dayKey(iso);
  if (!day) return null;
  return by === 'week' ? weekKey(day) : day;
}

/** Every bucket key from `first` to `last` inclusive, including empty ones. */
function fillRange(first, last, by) {
  const step = by === 'week' ? 7 * DAY_MS : DAY_MS;
  const keys = [];
  for (let time = keyToTime(first); time <= keyToTime(last); time += step) {
    keys.push(timeToKey(time));
  }
  return keys;
}

/**
 * Build the timeline.
 *
 * @param {object} model repo model
 * @param {object} [options]
 * @param {'day'|'week'} [options.by]     bucket size (default day)
 * @param {number} [options.limit]        how many recent buckets to keep (default 30)
 * @param {'commits'|'lines'|'contributors'} [options.metric] what the bars measure
 * @returns {{
 *   by: string, metric: string, buckets: Array, peak: object|null,
 *   totalCommits: number, empty: boolean,
 * }}
 *
 * Buckets are returned oldest-first and include days with no commits, so the
 * chart shows quiet stretches rather than silently closing the gap.
 */
function buildTimeline(model, options = {}) {
  const by = BUCKETS.includes(options.by) ? options.by : 'day';
  const metric = METRICS.includes(options.metric) ? options.metric : 'commits';
  const limit =
    Number.isFinite(options.limit) && options.limit > 0 ? Math.floor(options.limit) : DEFAULT_LIMIT;

  if (model.isEmpty || !model.commits.length) {
    return { by, metric, buckets: [], peak: null, totalCommits: 0, empty: true };
  }

  const byKey = new Map();
  for (const commit of model.commits) {
    const key = bucketKey(commit.authorDate, by);
    if (!key) continue;

    const bucket = byKey.get(key) || {
      date: key,
      commits: 0,
      added: 0,
      removed: 0,
      authors: new Set(),
    };
    bucket.commits += 1;
    bucket.added += commit.added || 0;
    bucket.removed += commit.removed || 0;
    bucket.authors.add(commit.authorName);
    byKey.set(key, bucket);
  }

  const keys = [...byKey.keys()].sort();
  if (!keys.length) {
    return { by, metric, buckets: [], peak: null, totalCommits: model.totalCommits, empty: true };
  }

  const filled = fillRange(keys[0], keys[keys.length - 1], by).map((key) => {
    const bucket = byKey.get(key);
    return bucket
      ? {
          date: key,
          commits: bucket.commits,
          added: bucket.added,
          removed: bucket.removed,
          contributors: bucket.authors.size,
        }
      : { date: key, commits: 0, added: 0, removed: 0, contributors: 0 };
  });

  // `--limit` is a window on the recent end: the newest buckets are the ones
  // worth looking at, and a year of history should not push them off screen.
  const buckets = filled.slice(-limit);

  // The peak is reported over the window actually shown, so it always names a
  // bar the reader can see.
  const peak = buckets.reduce(
    (best, bucket) => (best === null || bucket.commits > best.commits ? bucket : best),
    null,
  );

  return {
    by,
    metric,
    buckets,
    peak: peak && peak.commits > 0 ? { date: peak.date, commits: peak.commits } : null,
    totalCommits: buckets.reduce((sum, bucket) => sum + bucket.commits, 0),
    empty: false,
  };
}

/** The number a bar represents, for the chosen metric. */
function metricValue(bucket, metric) {
  if (metric === 'lines') return bucket.added + bucket.removed;
  if (metric === 'contributors') return bucket.contributors;
  return bucket.commits;
}

module.exports = { buildTimeline, metricValue, dayKey, weekKey, fillRange, BUCKETS, METRICS, DEFAULT_LIMIT };
