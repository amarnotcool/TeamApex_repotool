'use strict';

/**
 * render-timeline — the `repotool timeline` bar chart.
 *
 * One row per bucket, scaled against the busiest bucket on screen. The bars
 * come from the same `format.bar` helper the contributor and hotspot tables
 * use, so every chart in the tool is drawn to the same scale rule.
 */

const { createStyle } = require('../ansi');
const format = require('../format');
const { buildTimeline, metricValue } = require('./timeline');

const BAR_WIDTH = 32;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-08-23" -> "Aug 23". The year appears in the summary line instead. */
function shortDate(key) {
  const [year, month, day] = String(key).split('-');
  if (!year || !month || !day) return String(key);
  return `${MONTHS[Number(month) - 1] || month} ${day}`;
}

const METRIC_LABELS = {
  commits: 'commits',
  lines: 'lines changed',
  contributors: 'contributors',
};

/**
 * Render the chart.
 *
 * @param {object} model     repo model
 * @param {object} [options] passed through to buildTimeline, plus `color`
 */
function renderTimeline(model, options = {}) {
  const style = createStyle({ enabled: options.color });
  const timeline = buildTimeline(model, options);

  if (timeline.empty) {
    return style.dim('No commits yet, so there is no activity to chart.');
  }

  const { buckets, metric, by } = timeline;
  const values = buckets.map((bucket) => metricValue(bucket, metric));
  const max = values.reduce((best, value) => Math.max(best, value), 0);

  const heading = by === 'week' ? 'Repository Activity (weekly)' : 'Repository Activity';
  const lines = [format.heading(heading, style), ''];

  buckets.forEach((bucket, index) => {
    const value = values[index];
    const label = by === 'week' ? `${shortDate(bucket.date)}+` : shortDate(bucket.date);
    // A bucket with no activity still gets its row: a gap in the history is
    // information, and dropping it would silently compress the time axis.
    const drawn = value > 0 ? style.cyan(format.bar(value, max, BAR_WIDTH)) : style.dim('·');
    lines.push(`${format.padEnd(label, 7)} ${drawn}`);
  });

  lines.push('');
  const span =
    buckets.length > 1
      ? `${format.isoDate(buckets[0].date)} → ${format.isoDate(buckets[buckets.length - 1].date)}`
      : format.isoDate(buckets[0].date);

  lines.push(`${style.dim('Commits:')} ${format.count(timeline.totalCommits)}  ${style.dim(`(${span})`)}`);
  if (timeline.peak) {
    lines.push(
      `${style.dim('Peak:')} ${shortDate(timeline.peak.date)}  ` +
        `${style.dim(`(${format.plural(timeline.peak.commits, 'commit')})`)}`,
    );
  }
  if (metric !== 'commits') {
    lines.push(style.dim(`Bars show ${METRIC_LABELS[metric]} per ${by}.`));
  }

  return lines.join('\n');
}

module.exports = { renderTimeline, shortDate, BAR_WIDTH };
