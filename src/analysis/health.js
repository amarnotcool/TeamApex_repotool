'use strict';

/**
 * health — four measurements of a repository, each one a stated formula.
 *
 * The point of this module is that nothing in it is a judgement call at
 * runtime. Every score is arithmetic over data the shared repo model already
 * holds, every threshold is a named constant, and every formula is printed
 * alongside its result so a reader can check the number rather than trust it.
 * A score nobody can reproduce by hand is worse than no score.
 *
 * The four dimensions, and why each is measured the way it is:
 *
 *   Activity      recent commits per day against the earlier baseline rate.
 *                 Reuses activityComparison(), the same comparison the
 *                 `why is this repository changing` answer makes, including
 *                 its refusal to quote a rate when the history is too
 *                 compressed in time to support one.
 *   Concentration how much of the churn lands in the busiest three files. A
 *                 repository where every change touches the same file is
 *                 fragile regardless of how much work goes into it.
 *   Stability     how many commit subjects read as corrective work.
 *   Collaboration how much of the history one person accounts for.
 *
 * Concentration, Stability and Collaboration are all "less is better" ratios,
 * so each score is 100 minus the percentage. Activity is a rate ratio, capped
 * where sustaining more would say nothing further.
 */

const { activityComparison } = require('./repo-model');

/** Activity: this multiple of the baseline pace scores 100. */
const ACTIVITY_CAP = 3;

/** Concentration: churn share is measured over this many busiest files. */
const CONCENTRATION_FILES = 3;

/**
 * Stability: subjects counted as corrective work.
 *
 * Word-boundary matching, so "prefix" is not a fix and "debugger" is not a
 * bug. Deliberately narrow: these are the words a commit uses when it exists
 * because something was wrong.
 */
const FIX_PATTERN = /\b(fix|fixes|fixed|fixing|bug|bugs|bugfix|hotfix|revert|reverts|reverted|regression)\b/i;

/** Warning thresholds, all printed in `repotool help health`. */
const WARN = {
  /** Top-3 churn share above this is flagged. */
  concentrationShare: 0.5,
  /** A contributor above this share of commits is flagged. */
  contributorShare: 0.7,
  /** A file touched by more than this share of all commits is flagged … */
  fileCommitShare: 0.25,
  /** … but never fewer than this many commits, so tiny histories stay quiet. */
  fileCommitFloor: 5,
};

/** Verdict bands, applied to the overall score. */
const BANDS = [
  { min: 80, label: 'EXCELLENT' },
  { min: 60, label: 'GOOD' },
  { min: 40, label: 'FAIR' },
  { min: 0, label: 'NEEDS ATTENTION' },
];

/** Activity needs at least this many commits before a split means anything. */
const MIN_COMMITS_FOR_ACTIVITY = 4;

function clampScore(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function bandFor(score) {
  return BANDS.find((band) => score >= band.min).label;
}

/** How many commits a single file must exceed before it is flagged. */
function fileCommitThreshold(totalCommits) {
  return Math.max(WARN.fileCommitFloor, Math.ceil(totalCommits * WARN.fileCommitShare));
}

/**
 * Activity — recent pace against the baseline pace.
 *
 * score = min(recentPerDay / baselinePerDay, 3) / 3 * 100
 *
 * Returns a null score, with a reason, whenever that ratio would be an
 * artefact rather than a measurement: no earlier period to compare against,
 * or periods so short that clamping their spans to a day manufactures the
 * rate. This is the same honesty rule `change-analysis` applies.
 */
function activityScore(model) {
  const evidence = {
    formula: `min(recent commits/day ÷ baseline commits/day, ${ACTIVITY_CAP}) ÷ ${ACTIVITY_CAP} × 100`,
    recentPerDay: null,
    baselinePerDay: null,
    ratio: null,
    comparable: false,
    reason: null,
  };

  if (model.totalCommits < MIN_COMMITS_FOR_ACTIVITY) {
    return {
      score: null,
      ...evidence,
      reason: `fewer than ${MIN_COMMITS_FOR_ACTIVITY} commits — too little history to split into two periods`,
    };
  }

  const activity = activityComparison(model);
  if (!activity || !activity.baseline) {
    return { score: null, ...evidence, reason: 'no earlier period to compare against yet' };
  }

  evidence.recentPerDay = activity.recent.perDay;
  evidence.baselinePerDay = activity.baseline.perDay;

  if (!activity.comparableRates || activity.rateRatio === null) {
    return {
      score: null,
      ...evidence,
      reason: 'this history spans under a day, so per-day rates would be meaningless',
    };
  }

  return {
    score: clampScore((Math.min(activity.rateRatio, ACTIVITY_CAP) / ACTIVITY_CAP) * 100),
    ...evidence,
    ratio: activity.rateRatio,
    comparable: true,
  };
}

/**
 * Concentration — churn outside the busiest three files.
 *
 * score = 100 − (churn in top 3 files ÷ total churn × 100)
 */
function concentrationScore(model) {
  const byChurn = [...model.files].sort((a, b) => b.churn - a.churn || a.path.localeCompare(b.path));
  const top = byChurn.slice(0, CONCENTRATION_FILES);
  const topChurn = top.reduce((sum, file) => sum + file.churn, 0);
  const totalChurn = model.totals.churn;
  const share = totalChurn > 0 ? topChurn / totalChurn : 0;

  return {
    score: clampScore(100 - share * 100),
    formula: `100 − (churn in the ${CONCENTRATION_FILES} busiest files ÷ total churn × 100)`,
    share,
    topChurn,
    totalChurn,
    files: top.map((file) => ({ path: file.path, churn: file.churn })),
  };
}

/**
 * Stability — commit subjects that do not read as corrective work.
 *
 * score = 100 − (subjects matching the fix pattern ÷ total commits × 100)
 */
function stabilityScore(model) {
  const matches = model.commits.filter((commit) => FIX_PATTERN.test(commit.subject || ''));
  const share = model.totalCommits > 0 ? matches.length / model.totalCommits : 0;

  return {
    score: clampScore(100 - share * 100),
    formula: '100 − (commit subjects matching the fix pattern ÷ total commits × 100)',
    pattern: FIX_PATTERN.source,
    fixCommits: matches.length,
    totalCommits: model.totalCommits,
    share,
  };
}

/**
 * Collaboration — history not accounted for by its busiest author.
 *
 * score = 100 − (top contributor's commits ÷ total commits × 100)
 */
function collaborationScore(model) {
  const leader = model.contributors[0] || null;
  const share = leader && model.totalCommits > 0 ? leader.commits / model.totalCommits : 0;

  return {
    score: clampScore(100 - share * 100),
    formula: "100 − (top contributor's commits ÷ total commits × 100)",
    topContributor: leader ? leader.name : null,
    topCommits: leader ? leader.commits : 0,
    totalCommits: model.totalCommits,
    contributors: model.contributors.length,
    share,
  };
}

/**
 * Threshold warnings. Each one names the number that tripped it, so the
 * warning can be checked against the report above it.
 */
function warningsFor(model, dimensions) {
  const warnings = [];
  const threshold = fileCommitThreshold(model.totalCommits);

  const busiest = [...model.files].sort((a, b) => b.commits - a.commits || a.path.localeCompare(b.path))[0];
  if (busiest && busiest.commits > threshold) {
    warnings.push({
      code: 'file-churn',
      message:
        `${busiest.path} changed in ${busiest.commits} of ${model.totalCommits} commits ` +
        `(threshold: more than ${threshold})`,
      value: busiest.commits,
      threshold,
      path: busiest.path,
    });
  }

  if (dimensions.concentration.share > WARN.concentrationShare) {
    warnings.push({
      code: 'concentration',
      message:
        `${Math.round(dimensions.concentration.share * 100)}% of all churn is in ` +
        `${CONCENTRATION_FILES} files (threshold: above ${WARN.concentrationShare * 100}%)`,
      value: dimensions.concentration.share,
      threshold: WARN.concentrationShare,
    });
  }

  if (dimensions.collaboration.share > WARN.contributorShare) {
    warnings.push({
      code: 'contributor',
      message:
        `${dimensions.collaboration.topContributor} made ${Math.round(dimensions.collaboration.share * 100)}% ` +
        `of all commits (threshold: above ${WARN.contributorShare * 100}%)`,
      value: dimensions.collaboration.share,
      threshold: WARN.contributorShare,
      name: dimensions.collaboration.topContributor,
    });
  }

  return warnings;
}

/**
 * Score a repository.
 *
 * @param {object} model repo model from buildRepoModel()
 * @returns {{
 *   empty: boolean,
 *   overall: {score: number|null, band: string|null, dimensions: string[]},
 *   activity: object, concentration: object, stability: object, collaboration: object,
 *   warnings: Array,
 * }}
 *
 * A dimension that cannot be measured honestly carries `score: null` and a
 * `reason`; it is left out of the average rather than filled in with a
 * plausible-looking number.
 */
function computeHealth(model) {
  if (model.isEmpty) {
    return {
      empty: true,
      overall: { score: null, band: null, dimensions: [] },
      activity: { score: null, reason: 'no commits yet' },
      concentration: { score: null, reason: 'no commits yet' },
      stability: { score: null, reason: 'no commits yet' },
      collaboration: { score: null, reason: 'no commits yet' },
      warnings: [],
    };
  }

  const dimensions = {
    activity: activityScore(model),
    concentration: concentrationScore(model),
    stability: stabilityScore(model),
    collaboration: collaborationScore(model),
  };

  // Equal weights: none of the four is evidence for another, and weighting
  // them differently would be a preference we cannot derive from the data.
  const scored = Object.entries(dimensions).filter(([, value]) => value.score !== null);
  const average = scored.length
    ? Math.round(scored.reduce((sum, [, value]) => sum + value.score, 0) / scored.length)
    : null;

  return {
    empty: false,
    overall: {
      score: average,
      band: average === null ? null : bandFor(average),
      dimensions: scored.map(([name]) => name),
    },
    ...dimensions,
    warnings: warningsFor(model, dimensions),
  };
}

module.exports = {
  computeHealth,
  activityScore,
  concentrationScore,
  stabilityScore,
  collaborationScore,
  warningsFor,
  fileCommitThreshold,
  bandFor,
  ACTIVITY_CAP,
  CONCENTRATION_FILES,
  FIX_PATTERN,
  WARN,
  BANDS,
  MIN_COMMITS_FOR_ACTIVITY,
};
