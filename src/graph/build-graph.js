'use strict';

/**
 * build-graph — turns a flat commit list into a laid-out DAG.
 *
 * The layout is the classic "lane" model used by git log --graph: every
 * in-flight line of history occupies a column (a lane), a commit is drawn in
 * the lane that was waiting for it, and its parents claim lanes for the rows
 * below. Merges open an extra lane; a branch that rejoins history frees one.
 *
 * We compute the layout here and keep rendering separate, so the same layout
 * can drive an ASCII renderer, an SVG exporter, or a test assertion.
 */

/**
 * Order commits so that a commit always appears before its parents.
 *
 * `git log` already returns history newest-first, but that ordering is by
 * date and can interleave branches confusingly. We do our own Kahn-style
 * topological sort over the child edges, breaking ties by commit date so the
 * result is deterministic and still reads chronologically.
 */
function topoSort(commits) {
  const byHash = new Map(commits.map((commit) => [commit.hash, commit]));

  // childCount[hash] = how many commits in this set list `hash` as a parent.
  const pendingChildren = new Map();
  for (const commit of commits) pendingChildren.set(commit.hash, 0);
  for (const commit of commits) {
    for (const parent of commit.parents) {
      if (pendingChildren.has(parent)) {
        pendingChildren.set(parent, pendingChildren.get(parent) + 1);
      }
    }
  }

  const newestFirst = (a, b) => {
    const byDate = String(b.commitDate).localeCompare(String(a.commitDate));
    return byDate !== 0 ? byDate : a.hash.localeCompare(b.hash);
  };

  // Ready = every child already emitted. Start from the tips.
  const ready = commits.filter((commit) => pendingChildren.get(commit.hash) === 0).sort(newestFirst);
  const ordered = [];
  const emitted = new Set();

  while (ready.length) {
    const commit = ready.shift();
    if (emitted.has(commit.hash)) continue;
    emitted.add(commit.hash);
    ordered.push(commit);

    for (const parentHash of commit.parents) {
      if (!pendingChildren.has(parentHash)) continue;
      const remaining = pendingChildren.get(parentHash) - 1;
      pendingChildren.set(parentHash, remaining);
      if (remaining === 0) {
        ready.push(byHash.get(parentHash));
        ready.sort(newestFirst);
      }
    }
  }

  // A cycle is impossible in git, but a partial history (shallow clone, or a
  // --max-count cut) can leave commits whose children were never loaded.
  if (ordered.length < commits.length) {
    for (const commit of commits) {
      if (!emitted.has(commit.hash)) ordered.push(commit);
    }
  }

  return ordered;
}

/** Index of the first free lane, appending a new one if all are occupied. */
function claimLane(lanes, hash) {
  const existing = lanes.indexOf(hash);
  if (existing !== -1) return existing;
  const free = lanes.indexOf(null);
  if (free !== -1) {
    lanes[free] = hash;
    return free;
  }
  lanes.push(hash);
  return lanes.length - 1;
}

/** Drop trailing empty lanes so the graph does not drift right forever. */
function trimLanes(lanes) {
  while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
}

/**
 * Lay the commits out into rows.
 *
 * @param {Array} commits commit objects from git-reader
 * @returns {{rows: Row[], width: number}}
 *
 * Each row is:
 *   {
 *     commit,             the commit drawn on this row
 *     lane,               column the commit node sits in
 *     lanesBefore,        lane occupancy above the row (array of hash|null)
 *     lanesAfter,         lane occupancy below the row
 *     parentLanes,        lane each parent was routed into
 *   }
 */
function buildGraph(commits) {
  const ordered = topoSort(commits);
  const lanes = []; // lanes[i] = hash of the commit that lane i is waiting for
  const rows = [];
  let width = 0;

  for (const commit of ordered) {
    const lane = claimLane(lanes, commit.hash);
    const lanesBefore = lanes.slice();

    // The lane holding this commit is now free for its first parent; the
    // remaining parents (merges) claim lanes of their own.
    lanes[lane] = null;
    const parentLanes = [];
    commit.parents.forEach((parentHash, index) => {
      if (index === 0) {
        // Keep the mainline as far left as possible: if another lane is
        // already waiting for this parent, keep whichever column is leftmost
        // so long-lived history does not drift rightwards over time.
        const alreadyRouted = lanes.indexOf(parentHash);
        if (alreadyRouted === -1) {
          lanes[lane] = parentHash;
          parentLanes.push(lane);
          return;
        }
        if (alreadyRouted > lane) {
          lanes[alreadyRouted] = null;
          lanes[lane] = parentHash;
          parentLanes.push(lane);
          return;
        }
        parentLanes.push(alreadyRouted);
        return;
      }
      parentLanes.push(claimLane(lanes, parentHash));
    });

    trimLanes(lanes);
    const lanesAfter = lanes.slice();
    width = Math.max(width, lanesBefore.length, lanesAfter.length);

    rows.push({ commit, lane, lanesBefore, lanesAfter, parentLanes });
  }

  return { rows, width };
}

module.exports = { buildGraph, topoSort };
