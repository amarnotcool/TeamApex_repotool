'use strict';

/**
 * render-health — the `repotool health` report.
 *
 * Every score is printed next to the formula that produced it. `hotspots`
 * prints its weighting for the same reason: a number a reader cannot check is
 * a number they have to take on faith, and this tool does not ask for faith.
 */

const path = require('node:path');
const { createStyle } = require('../ansi');
const format = require('../format');
const { computeHealth, fileCommitThreshold, BANDS, WARN } = require('./health');

const BAR_WIDTH = 20;

/** Bands, coloured only at the extremes so the middle stays neutral. */
function paintBand(band, style) {
  if (band === 'EXCELLENT') return style.brightGreen(band);
  if (band === 'GOOD') return style.green(band);
  if (band === 'FAIR') return style.brightYellow(band);
  return style.brightRed(band);
}

/** One dimension: score, bar, and the arithmetic behind it. */
function dimensionRow(label, dimension, evidence, style) {
  if (dimension.score === null) {
    return [style.dim(label), style.dim('—'), '', style.dim(dimension.reason || 'not measurable')];
  }
  return [
    label,
    format.padStart(String(dimension.score), 3),
    style.cyan(format.bar(dimension.score, 100, BAR_WIDTH)),
    style.dim(evidence),
  ];
}

/**
 * Render the report.
 *
 * @param {object} model     repo model
 * @param {object} [options]
 * @param {boolean} [options.color]
 */
function renderHealth(model, options = {}) {
  const style = createStyle({ enabled: options.color });
  const health = computeHealth(model);
  const name = path.basename(model.cwd);

  const title = `${style.bold('repotool health')} ${style.dim('—')} ${style.brightCyan(name)}`;

  if (health.empty) {
    return [title, '', style.dim('No commits yet — not enough history to measure anything.')].join('\n');
  }

  const { activity, concentration, stability, collaboration } = health;

  const rows = [
    dimensionRow(
      'Activity',
      activity,
      activity.score === null
        ? ''
        : `${format.decimal(activity.ratio, 2)}× the baseline pace ` +
          `(${format.decimal(activity.recentPerDay, 2)}/day vs ${format.decimal(activity.baselinePerDay, 2)}/day), capped at 3×`,
      style,
    ),
    dimensionRow(
      'Concentration',
      concentration,
      `${format.percent(concentration.share)} of ${format.count(concentration.totalChurn)} churned lines ` +
        `are in the 3 busiest files`,
      style,
    ),
    dimensionRow(
      'Stability',
      stability,
      `${format.plural(stability.fixCommits, 'commit')} of ${format.count(stability.totalCommits)} ` +
        `mention a fix, bug, revert or regression`,
      style,
    ),
    dimensionRow(
      'Collaboration',
      collaboration,
      collaboration.topContributor
        ? `${collaboration.topContributor} made ${format.percent(collaboration.share)} of ` +
          `${format.count(collaboration.totalCommits)} commits`
        : '',
      style,
    ),
  ];

  const sections = [title, ''];
  sections.push(format.table(rows, [{ align: 'left' }, { align: 'right' }, { align: 'left' }]));

  sections.push('');
  if (health.overall.score === null) {
    sections.push(style.dim('No dimension could be measured, so there is no overall score.'));
  } else {
    const measured =
      health.overall.dimensions.length === 4
        ? ''
        : style.dim(` (mean of ${health.overall.dimensions.length} measurable dimensions)`);
    sections.push(
      `${style.bold('Overall')}  ${format.padStart(String(health.overall.score), 3)}  ` +
        `${paintBand(health.overall.band, style)}${measured}`,
    );
  }

  sections.push(
    style.dim(
      `equal-weighted mean of the scores above · bands: ${BANDS.map((band) => `${band.min}+ ${band.label}`).join(' · ')}`,
    ),
  );

  if (health.warnings.length) {
    sections.push('');
    sections.push(format.heading('Warnings', style));
    for (const warning of health.warnings) {
      sections.push(`${style.brightYellow('!')} ${warning.message}`);
    }
  }

  sections.push('');
  sections.push(style.dim('Formulas'));
  for (const [label, dimension] of [
    ['Activity', activity],
    ['Concentration', concentration],
    ['Stability', stability],
    ['Collaboration', collaboration],
  ]) {
    if (!dimension.formula) continue;
    sections.push(style.dim(`  ${format.padEnd(label, 13)} ${dimension.formula}`));
  }
  sections.push(
    style.dim(
      `  ${format.padEnd('warnings', 13)} one file in more than ` +
        `${fileCommitThreshold(model.totalCommits)} commits · top-3 churn above ` +
        `${WARN.concentrationShare * 100}% · one author above ${WARN.contributorShare * 100}%`,
    ),
  );

  return sections.join('\n');
}

module.exports = { renderHealth, BAR_WIDTH };
