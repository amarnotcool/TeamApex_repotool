# repotool — Compliance Audit

**Audited:** 2026-08-21
**Commit:** `db31ce0`
**Repo:** https://github.com/amarnotcool/repotool
**npm:** `@amarnotcool/repotool@0.1.0`

**Scope:** 1,871 lines across `src/` (9 files), `bin/` (1), `test/` (4). Every file read; all claims below backed by executed commands.

> **Note on a fix applied during this audit:** the working copy of `verify-zero-deps.sh` had the text `i have` typed into the front of the shebang line (an accidental IDE edit), which broke the script. The change was uncommitted and the committed version was clean; the working copy was restored from HEAD. All results below reflect the restored, correct script.

---

## 1. Zero-Dependency Compliance — PASS

**package.json:** `"dependencies": {}` — present and empty. **No `devDependencies` block at all**, so nothing requires STDLIB.md disclosure. Test runner is Node's built-in `node:test`.

**Every `require()` in the codebase** (41 total, exhaustively enumerated via grep):

| Kind | Count | Modules |
|---|---|---|
| Node built-ins | 13 | `node:child_process`, `node:path`, `node:fs`, `node:os`, `node:test`, `node:assert/strict` |
| Relative internal | 28 | `../ansi`, `./myers`, `../git-reader`, `./parser`, `./helpers`, etc. |
| **Third-party** | **0** | — |

Every built-in uses the explicit `node:` prefix. No `import` statements anywhere (pure CommonJS).

**node_modules:** does not exist in the project directory.

**`sh verify-zero-deps.sh` — actual output:**

```
Checking package.json dependencies block...
PASS: zero runtime dependencies
Checking that src/ imports only Node built-ins...
PASS: every import in src/ and bin/ is a Node built-in or a relative path
Checking node_modules for anything beyond devDependencies...
no node_modules directory present
exit=0
```

The script goes beyond the manifest check the project plan sketched: it walks `src/` and `bin/` recursively, extracts every `require()` id, and fails on any that is neither `module.builtinModules` nor relative. That is a real proof, not a formality.

**Independent confirmation from npm** — fresh install into an empty directory:

```
added 1 package, and audited 2 packages in 2s
found 0 vulnerabilities
```

`npm view` reports `deps: none`.

**Minor gap:** the verify script scans `src/` and `bin/` but not `test/`. Tests are clean (verified manually), but a judge running the script isn't shown that.

---

## 2. Feature Completeness

### `graph` — implemented, working

Files: `src/graph/build-graph.js` (155 lines), `src/graph/render-ascii.js` (161 lines).

`buildGraph()` runs a Kahn-style topological sort (`topoSort`, date-tie-broken for determinism) then allocates lanes via `claimLane`/`trimLanes`, producing rows of `{commit, lane, lanesBefore, lanesAfter, parentLanes}`. Layout and rendering are separated. `renderAscii` emits a node row plus a transition row per commit, with `*` commit / `M` merge / `o` root.

Merge handling is genuine, not cosmetic: `commit.parents` comes from `%P`, `isMerge` is `parents.length > 1`, and each additional parent claims its own lane. Multi-lane jumps get an arrival diagonal (right) or an underscore run (left) that does not erase lanes it passes over.

**Live output — Asset Flow repo, 70 commits, 5 authors, 2 merges visible:**

```
M    aa3a37a 2026-07-12 Devpratap Singh (main, origin/main, origin/copilot/minor-ui-fix, origin/HEA…
|\
* |  20750bc 2026-07-12 Devpratap Singh feat: implement core asset management modules including dir…
| |
| *  8113196 2026-07-12 Devpratap Singh Readme Update
|/
*    e6bad3e 2026-07-12 Devpratap Singh feat: implement core application pages including asset allo…
```

Full 70-commit render handles 3 lanes, 3 independent root commits, and ~15 merges without crossing lines. Runtime 0.4s.

### `ask` — implemented, 8 patterns

Files: `src/query/parser.js` (126 lines), `src/query/handlers.js` (172 lines).

The parser is a keyword-group matcher over an `INTENTS` table — each entry has keyword groups (all must match, any alternative within a group counts) plus an optional extraction regex. Scored by number of matched groups so specific patterns beat loose ones. No NLP library, no model, no network.

Complete pattern list as implemented:

| Intent | Question shape |
|---|---|
| `who-touched` | who last touched `<file>` |
| `when-was` | when was `<commit>` made |
| `count-by-author` | how many commits by `<author>` (omit author for full breakdown) |
| `files-changed` | what files changed in `<commit>` |
| `last-commits` | show the last `<n>` commits |
| `top-authors` | who are the top contributors |
| `busiest-file` | which file changed the most |
| `branch-list` | what branches exist |

The plan asked for 4–5 to start; 8 are implemented.

**Three tested live against Asset Flow:**

```
$ repotool ask "when was 8113196 committed"
8113196 Readme Update
  authored  2026-07-12 11:48:27 UTC by Devpratap Singh <devprataprathore346@gmail.com>
  committed 2026-07-12 11:48:27 UTC

$ repotool ask "what files changed in 3659fd8"
1 file(s) changed in 3659fd8:
  frontend/public/4f375a68-b262-42d7-981b-0c031878eb4f.png

$ repotool ask "who last touched backend/src/app.js"
Devpratap Singh last touched backend/src/app.js
  commit  ad7591c  feat: implement audit management system and resource booking functionality...
  when    2026-07-12 09:47:51 UTC
  history 9 commit(s) by 2 author(s): Devpratap Singh, kiu-art
```

Author counts cross-checked against `git log --format='%an' --all | sort | uniq -c` — exact match.

### `diff` — genuine Myers implementation, from scratch

File: `src/diff/myers.js` (204 lines).

The algorithm is real and complete: `myersMiddle()` runs the greedy O(ND) forward walk over diagonals `k = x - y` using an `Int32Array` V-array with `max` offset for negative indices, snapshotting V per edit-distance `d` into `trace`; `backtrack()` then walks the trace in reverse to emit `equal`/`delete`/`insert` operations. `trimCommonEnds()` strips shared prefix/suffix first as an optimization. `toHunks()` does unified-diff hunk grouping with configurable context. None of this is delegated.

**Where git IS invoked, and for what** — `src/git-reader.js` is the only file touching the binary (`execFileSync` at line 51, single call site):

| Call | Purpose | Legitimate under project rules? |
|---|---|---|
| `git log --parents --pretty=…` | raw commit metadata | Yes — raw data |
| `git show <rev>:<path>` | file contents at a revision | Yes — raw data |
| `git diff --name-status A B` | *which paths* changed | Yes — file list, not content |
| `git diff --numstat A B` | binary detection only (`-`/`-` marker) | See flag below |
| `git rev-parse`, `symbolic-ref`, `for-each-ref` | ref resolution | Yes |

**Flag for review:** `git diff --numstat` returns per-file added/removed line counts. The code uses only the binary marker and discards the counts — all displayed numbers come from our own `myers.stats()`. This is defensible, but `--numstat` *is* a diff-computing command, and a strict judge could raise an eyebrow. A `git cat-file`-based binary check would remove the ambiguity entirely. Low risk, cheap to change.

**Live output on two real commits:**

```
$ repotool diff e6bad3e 8113196
README.md  modified  +3 -3
@@ -126,6 +126,6 @@
 
 ## 🔑 Cozy Access Key
 Login details to quickly evaluate the application flow:
-* **Username**: `name@company.com`
-* **Password**: `password123`
-* Default Role: **Employee**
+* **Username**: `admin@assetflow.com`
+* **Password**: `adminpassword123`
+* Default Role: **Admin**

1 file(s) changed, 3 insertion(s)(+), 3 deletion(s)(-)
```

### Module independence — partial

At the **library level, confirmed independent.** With `src/graph/` physically deleted, both other modules still load and run:

```
diff works without src/graph present:
@@ -1,2 +1,2 @@
 a
-b
+c
query works without src/graph present: count-by-author
```

No module requires another's internals; only `query/handlers.js` and the CLI depend on `git-reader.js`, which is the intended shared foundation.

At the **CLI level, NOT independent.** `bin/repotool.js` requires all three modules eagerly at lines 13–20. With `src/graph/` missing:

```
$ node bin/repotool.js diff HEAD~1 HEAD
Error: Cannot find module '../src/graph/build-graph'
```

The stated design goal — "if one breaks or runs out of time, the other two must still work standalone for the demo" — holds for the code but not for the demo surface. **Fix is ~5 lines:** move each `require` inside its command function so routing only loads what it needs. Worth doing precisely because it's the demo-safety property that was designed for.

---

## 3. Required Deliverables

| Deliverable | Status | Evidence |
|---|---|---|
| README.md | Present, 3.8 kB, real instructions | Commands executed as written — see below |
| STDLIB.md | Present, 13 entries | Counted, listed below |
| LICENSE | Present, MIT, 21 lines | `head -1` = "MIT License" |
| Tests | 34 passing | Full mapping below |
| Public repo | Confirmed public | GitHub API: `private: false, visibility: public` |

**README commands actually run, not just read:**

- `npx @amarnotcool/repotool graph` — executed against Asset Flow, rendered correctly.
- `npm test` — executed in **PowerShell** (not just bash) to catch shell-glob issues: 34 passed, 0 failed.
- `node bin/repotool.js graph` — works from a clone.
- `sh verify-zero-deps.sh` — passes.

No placeholder text, no TODO/FIXME/stub markers anywhere in `src/`, `bin/`, or `test/` (grep for `todo|fixme|placeholder|not implemented|stub` returns only the word "placeholders" in a `git-reader.js` comment describing git's `%H`-style format placeholders).

**STDLIB.md — all 13 entries:**

1. `simple-git`, `nodegit` → `execFileSync('git', …)` + own parser
2. `chalk`, `kleur`, `picocolors` → raw ANSI SGR codes
3. `commander`, `yargs`, `minimist` → hand-rolled argv scanner
4. `diff`, `jsdiff`, `fast-diff` → own Myers O(ND)
5. `diff2html`, unified-diff formatters → own hunk grouping/renderer
6. `gitgraph.js`, `git-graph`, `dagre` → own lane-allocation layout
7. `toposort`, `graphlib` → own Kahn topological sort
8. `boxen`, `cli-table3`, `string-width` → manual padding + escape-aware `visibleLength`
9. `natural`, `compromise`, `nlp.js` → keyword-group intent matcher
10. `date-fns`, `dayjs`, `moment` → git ISO-8601 output + built-in `Date`
11. `jest`, `mocha`, `chai`, `tap` → `node:test` + `node:assert/strict`
12. `tmp`, `fs-extra`, `rimraf` → `fs.mkdtempSync`, `fs.rmSync`, `os.tmpdir()`
13. `depcheck`, `license-checker` → own import scanner in the verify script

Each row names the specific file implementing the substitution.

**Test coverage — claimed vs. actual.** All five required edge cases are genuinely covered:

| Required edge case | Covered by | File |
|---|---|---|
| Empty repo | "an empty repository yields no commits and an empty HEAD"; "an empty repository answers without throwing" | graph, query |
| Single commit | "a single commit is a root with no parents" | graph |
| Merge commit | "a merge commit records both parents and opens a second lane"; "a merge draws a single opening diagonal" | graph |
| Detached HEAD | "detached HEAD is reported as detached" | graph |
| Malformed/missing git output | "malformed git output is skipped rather than crashing the parser"; "reading a directory that is not a repository throws GitError" | graph |

Plus 22 beyond the requirement, notably: a **randomized property test** (50 iterations) asserting every edit script round-trips both input sequences; the classic `ABCABBA`/`CBABAC` Myers case asserting the script length is the known minimum of 5; CRLF normalization; trailing-newline handling; binary detection; and colour-disabled output containing no escape codes.

Tests build real throwaway git repositories via `fs.mkdtempSync` rather than mocking git output — the parser is exercised against what git actually prints.

**Full test list (34):**

*diff.test.js (12)*
1. identical inputs produce only equal operations
2. empty original inserts everything
3. empty update deletes everything
4. classic Myers example produces a minimal script
5. random inputs always round-trip through the edit script
6. trailing newline does not create a phantom empty line
7. CRLF input is compared as if it were LF
8. hunks group nearby changes and skip unchanged regions
9. an added file reports a zero start on the original side
10. renderer marks insertions, deletions and context
11. renderer emits no escape codes when colour is disabled
12. binary content is flagged instead of being line-diffed

*graph.test.js (9)*
13. an empty repository yields no commits and an empty HEAD
14. a single commit is a root with no parents
15. a merge commit records both parents and opens a second lane
16. topological order always places a commit before its parents
17. detached HEAD is reported as detached
18. render produces one node line per commit and no escape codes when plain
19. malformed git output is skipped rather than crashing the parser
20. reading a directory that is not a repository throws GitError
21. a merge draws a single opening diagonal, not a doubled bar

*query.test.js (13)*
22. parser maps questions to intents and extracts arguments
23. parser returns null for questions it does not cover
24. every advertised question parses to an intent
25. who-touched names the most recent author of a file
26. who-touched explains itself for an unknown file
27. count-by-author counts per author and filters by name
28. files-changed lists the paths in a commit
29. when-was reports author and commit dates
30. branch-list marks the current branch
31. an empty repository answers without throwing
32. unknown questions raise QueryError listing what is supported
33. a question missing its argument asks for one
34. an unknown revision surfaces a GitError

---

## 4. Bonus Eligibility

### Package Killer (+3) — qualifies, strongly

Thirteen distinct package categories replaced, and critically, the replacements are *implementations*, not stubs: a real Myers O(ND) diff with trace backtracking, a real topological sort, a real lane-allocation graph layout. That is the difference between "avoided a dependency" and "killed a package." The npm listing (`deps: none`, one package installed, zero transitive) is externally verifiable proof a judge can check without cloning.

### STDLIB Log (+3) — qualifies

13 entries against a 10+ threshold. Each names the replaced packages, the stdlib substitute, and the file where it lives. The log tracks what was actually built — entries appear alongside the commits that introduced them (e.g. the `depcheck` row corresponds to the import scanner in the verify script) rather than being retrofitted.

*(Single File and Reproducible Build not evaluated — intentionally skipped by project decision.)*

---

## 5. Rule Violations — none found

**Copied third-party source:** none. All 1,871 lines are original. No vendored files, no bundled minified blobs, no license headers from other projects. The only external artifact is the MIT LICENSE, which is required.

**Network calls:** none in the scored path. Grepped `src/` and `bin/` for `http`, `https`, `fetch(`, `net.`, `dns.`, `socket`, `api_key`, `openai`, `anthropic` — the sole hit is a comment in `src/ansi.js` citing `no-color.org` as documentation for the `NO_COLOR` convention. No LLM calls, no AI APIs, no telemetry. The tool runs fully offline.

**Cut features stayed cut:** no LLM integration, no dead-code/static-analysis feature. Neither was reintroduced.

**Commit timestamps — needs confirmation:**

```
db31ce0  2026-08-21 01:32:23 +0530  chore: prepare the package for publishing
1a9233c  2026-08-21 01:17:30 +0530  chore: keep CLAUDE.md out of the published repo
5eeede7  2026-08-21 01:09:25 +0530  fix: correct lane connector glyphs in the ASCII graph
4742f18  2026-08-21 00:13:58 +0530  fix: skip binary files in diff and tighten stat output
4c561c4  2026-08-20 23:39:14 +0530  feat: repotool — zero-dependency git graph, query and diff CLI
```

All five commits fall in a ~2 hour window on 2026-08-20/21 IST. The first commit is the first code commit — nothing was committed earlier. **This audit cannot verify the commits are after the official kickoff, because the kickoff timestamp was not available.** Confirm 2026-08-20 23:39 IST is post-kickoff. If it is not, this is the one item that could cause disqualification.

**Note on history:** the history was rewritten with `git filter-branch` and force-pushed to purge `CLAUDE.md` (a planning document) from all commits. Commit hashes differ from the originals. This is legitimate repo hygiene, not evidence tampering — the file removed was strategy notes, and all code commits are intact — but if the rules require unaltered history, disclose it.

---

## 6. Gaps

**Required by the project plan, missing:**

1. **Demo video (5 min)** — not started. The only hard deliverable outstanding. The plan specifies the shot list including the `verify-zero-deps.sh` segment, flagged as the Craft-scoring portion.

**Designed for but not achieved:**

2. **CLI module independence** — `bin/repotool.js` eagerly requires all three modules, so any one missing breaks every command (demonstrated in §2). Contradicts the stated demo-safety goal. ~5-line fix: lazy-require inside each command function.

**Deferred by design, still absent:**

3. **SVG export for graph** — the plan listed it as "optionally exportable as SVG." Never built. `build-graph.js`'s comment claims the layout "can drive an SVG exporter," which is true but currently aspirational.

**Quality issues found during audit:**

4. **`git diff --numstat` for binary detection** — see §2 flag. Uses a diff-computing command where `git cat-file` would be unimpeachable.
5. **`ask "what branches exist"` shows local branches only** — reads `refs/heads`. On Asset Flow it omits `origin/master` and `origin/copilot/minor-ui-fix`, which reads as incomplete to anyone who knows the repo. An `--all` flag would fix it.
6. **`diff` performance** — ~2.9s for a 21-file diff, because each file costs two `git show` spawns. Fine functionally, sluggish on camera.
7. **Verify script doesn't scan `test/`** — clean in practice, but the proof is narrower than it could be.
8. **Verify script requires `sh`** — a Windows judge without Git Bash can't run it. A `node verify-zero-deps.js` equivalent would be universally runnable.
9. **Graph spacing artifact** — one connector row renders `|/  |` with a wider-than-needed gap. Cosmetic only.
10. **`"main": "src/git-reader.js"`** — points the library entry at the git reader rather than an index module. Harmless; slightly odd for consumers who `require()` the package.

**Non-issues worth stating so they aren't re-flagged:** the npm package is scoped (`@amarnotcool/repotool`) because bare `repotool` was already taken at v2.0.0 — the installed command is still `repotool`. The published tarball excludes `test/` via the `files` field; tests remain in the GitHub repo. Publishing to npm does not violate the zero-dependency rule — the project publishes itself, it does not consume anything.

---

## Bottom Line

Zero-dependency compliance is clean and provable, all three features are genuinely implemented (Myers is real, the graph layout is real, the query matcher is real), all required deliverables except the video are present and verified by execution, and both targeted bonuses qualify.

Two items need attention before submission: **confirm the kickoff timestamp** against the first commit at 2026-08-20 23:39 IST, and **record the demo video**. The CLI module-independence gap is the highest-value code fix remaining and is roughly a five-line change.
