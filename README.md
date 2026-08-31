# repotool

A CLI that reads, graphs, questions and diffs a git repository — built on the
Node.js standard library and nothing else. No `chalk`, no `commander`, no
`diff`, no `simple-git`: `dependencies` in `package.json` is empty, and two
`verify-zero-deps` scripts prove it. Every number it prints is counted from
git history, and every score it prints is followed by the formula that produced
it.

```sh
npx @amarnotcool/repotool-apex stats
```

## Commands at a glance

| Command | What it does |
|---|---|
| [`graph`](#graph) | Draw the commit and merge history as a lane graph (ASCII or SVG) |
| [`stats`](#stats) | One screen of size, people, branches and churn |
| [`hotspots`](#hotspots) | Rank files by how much attention they attract |
| [`ask`](#ask) | Answer fixed questions about the repository, deterministically |
| [`diff`](#diff) | Colourised unified diff, computed with our own Myers diff |
| [`compare`](#compare) | Show what each of two refs has that the other does not |
| [`health`](#health) | Four scored measurements, each with its formula printed |
| [`timeline`](#timeline) | Chart commit activity per day or week |
| [`completion`](#completion) | Print a bash or zsh completion script |

Every command also takes `--repo PATH`, `--color`, `--no-color` and `--help`.
Run `repotool help <command>` for the full flag list and examples.

## Run it

Run it straight from the registry, without installing anything:

```sh
npx @amarnotcool/repotool-apex graph
```

Install it globally to get a `repotool` command on your `PATH`:

```sh
npm i -g @amarnotcool/repotool-apex
repotool graph
```

That global install pulls exactly one package: `dependencies` is empty, so
there is no tree behind it.

Or skip the registry entirely and run it from a clone:

```sh
git clone https://github.com/amarnotcool/TeamApex_repotool.git
cd TeamApex_repotool
node bin/repotool.js graph
```

Nothing to build either — a clone is already everything the tool needs.

To run it against another repository, point `--repo` at that checkout:

```sh
node bin/repotool.js graph --repo /path/to/other/repo
```

Node 18 or newer and a `git` binary on `PATH` are the only requirements.

---

## `graph`

Parses the full commit and merge history and draws it as a lane graph.
`*` is a commit, `M` a merge, `o` a root commit.

```sh
repotool graph
repotool graph --limit 20
repotool graph --format svg --output history.svg
```

```
8 commit(s), on branch main

M      f27040a 2026-08-20 Ada Lovelace (main) Merge hotfix
|\
| *    2c2040d 2026-08-20 Ada Lovelace (hotfix) Hotfix
| |
M |    0eb3d2e 2026-08-20 Ada Lovelace Merge feature into main
|\|\
* | |  5a22eb4 2026-08-20 Ada Lovelace Add readme
| |/
| *    ab19254 2026-08-20 Grace Hopper (feature) Extend feature
| |
| *    ef60ae3 2026-08-20 Grace Hopper Add feature file
|/
*      01f599d 2026-08-20 Ada Lovelace Tweak app
|
o      231d066 2026-08-20 Ada Lovelace Initial commit
```

Flags: `--limit N`, `--branch REF`, `--no-dates`, `--format ascii|svg`,
`--output PATH`.

<details>
<summary><b>SVG export</b> — how the second renderer stays in step with the first</summary>

`--format svg` renders the *same* layout through a second renderer — commit,
merge and root nodes, lane colours, connectors and labels — as an SVG document
on stdout, or into a file with `--output`:

```sh
repotool graph --format svg > history.svg
repotool graph --format svg --output history.svg     # status line on stderr
repotool graph --branch main --limit 50 --format svg --output main.svg
```

Lane assignment happens once, in `src/graph/build-graph.js`; the ASCII and SVG
renderers only draw what it decided, so they cannot disagree about structure.
A parent outside the loaded history (`--limit`, or a shallow clone) is drawn as
a dashed stub rather than dropped.

</details>

## `stats`

One screen describing the repository: size, people, branches, churn, and where
the changes land.

```sh
repotool stats
repotool stats --json
```

```
repotool stats — Zero Dependency - Team Apex  on branch master

commits        16
contributors   1
branches       1 local, 1 remote
files touched  45
line churn     10,829  +9,996 / -833
history        2026-08-29 → 2026-08-31  (2 days)
last commit    13 minutes ago

Top 3 contributors
──────────────────
16  ████████████████  Devpratap Singh

Top 3 most-changed files
────────────────────────
9 commits  1,019 lines  README.md
6 commits  808 lines    bin/repotool.js
6 commits  57 lines     package.json
```

Flags: `--limit N`, `--json`.

## `hotspots`

Files ranked by how much attention they attract — change frequency, how many
different people touch them, and how many lines move. The score weights all
three and the weighting is printed with the table rather than hidden.

```sh
repotool hotspots
repotool hotspots --limit 25 --sort churn
```

```
repotool hotspots — top 3 of 45 files
ranked by score (commits 50% · churn 30% · authors 20%), each scaled against the busiest file

rank  score     commits  authors  churn  added/removed  file
  1.  ████████        9        1  1,019    +825 / -194  README.md
  2.  ██████          6        1    808     +738 / -70  bin/repotool.js
  3.  █████           5        1    702    +588 / -114  src/query/handlers.js
```

Flags: `--limit N` (default 10), `--sort score|commits|churn|authors`, `--json`.

<details>
<summary><b>Where the churn numbers come from</b> — and why merges are excluded</summary>

Every line-count figure in `stats`, `hotspots`, `health`, `timeline`, `compare`
and `ask` comes from the single `git log --numstat` pass described in
[Design](#design). Git emits no numstat for merge commits, so **merges are
excluded from churn**. That avoids counting the same lines twice on a
merge-heavy history, but it does mean a repository that squash-merges
everything will report less churn than the branch history suggests.

Because every file-level answer reads that same pass, `hotspots` and
`ask "which file changed the most often"` cannot disagree with each other.

</details>

## `ask`

Deterministic answers to fixed question shapes — a keyword matcher over parsed
git data, not a language model, so the same question always gives the same
answer and nothing leaves your machine.

```sh
repotool ask "who last touched src/git-reader.js"
repotool ask "why is this repository changing so much"
repotool ask "which file changed the most often" --json
```

Ask something unsupported and it prints the list of what it can answer.

Flags: `--json`.

<details>
<summary><b>Every question repotool can answer</b></summary>

```sh
repotool ask "who last touched src/git-reader.js"
repotool ask "who works most on src/git-reader.js"
repotool ask "what has changed recently"
repotool ask "why is this repository changing so much"
repotool ask "how many commits by Ada"
repotool ask "what files changed in HEAD~2"
repotool ask "show the last 10 commits"
repotool ask "which file changed the most often"
repotool ask "what branches exist"
repotool ask "when was 01f599d committed"
```

`why is this repository changing so much` is arithmetic, not opinion: it
compares the recent commit rate against the earlier baseline, names the files
recent churn concentrates in, and says who is driving it — and it declines to
quote a per-day rate when the history is too compressed in time to support one.
`health`'s Activity score reuses that same comparison and the same refusal.

</details>

## `diff`

Colourised unified diff between two revisions, computed by our own Myers diff
implementation.

```sh
repotool diff HEAD~3 HEAD
repotool diff main feature --context 5
repotool diff HEAD~1 HEAD --stat
```

Lines that were *edited* rather than replaced get a second, character-level
Myers pass — the same algorithm, run again over the two lines' characters — and
only the span that actually changed is underlined inside the usual red/green
line.

Flags: `--context N` (default 3), `--stat`.

<details>
<summary><b>When intra-line highlighting applies</b> — the three guards</summary>

A `-`/`+` pair is only treated as an edit when it clears all three:

| Guard | Threshold | Why |
|---|---|---|
| Similarity | at least 30% of characters in common | Below it, the lines are neighbours rather than an edit of one into the other |
| Changed runs | no more than 3 per side | A rewrite keeps punctuation and indentation, so its character diff comes back as scattered fragments |
| Average run length | at least 2 characters | Single letters shared by accident (`try` against `if (!x)`) are not an edit |

Anything else is a rewrite and stays whole-line coloured, because
character-level detail on unrelated lines is noise rather than information.
Lines longer than 1,000 characters skip the second pass regardless. With
`--no-color` (or `NO_COLOR`) it is skipped entirely: there is nothing to show
a highlight with.

</details>

## `compare`

What each of two refs has that the other does not — branches, tags or commits.

```sh
repotool compare main feature
repotool compare v1.0 v2.0
repotool compare HEAD~10 HEAD --json
```

```
repotool compare — main vs feature

                 main   feature
commits ahead       1   2
merges              —   —
files changed       1   1
churn               1   3 +3 / -0
contributors        1   1

only on main: Ada Lovelace (1)
only on feature: Grace Hopper (2)
```

Each side is git's own `A..B` range — commits reachable from one ref and not
the other — folded through the same model `stats` and `hotspots` are built on,
so "ahead by" here counts what git counts. A ref compared with itself reports
zero difference and exits 0; refs with no common ancestor are reported as
unrelated rather than treated as an error.

Flags: `--json`.

## `health`

Four measurements of the repository, each printed next to the formula that
produced it. Nothing here is a judgement or an estimate — every number is
arithmetic over the same history `stats` and `hotspots` read.

```sh
repotool health
repotool health --json
```

```
repotool health — Zero Dependency - Team Apex

Activity         —                   this history spans under a day, so per-day rates would be meaningless
Concentration   77  ███████████████  23% of 10,829 churned lines are in the 3 busiest files
Stability       75  ███████████████  4 commits of 16 mention a fix, bug, revert or regression
Collaboration    0                   Devpratap Singh made 100% of 16 commits

Overall   51  FAIR (mean of 3 measurable dimensions)
equal-weighted mean of the scores above · bands: 80+ EXCELLENT · 60+ GOOD · 40+ FAIR · 0+ NEEDS ATTENTION

Warnings
────────
! README.md changed in 9 of 16 commits (threshold: more than 5)
! Devpratap Singh made 100% of all commits (threshold: above 70%)

Formulas
  Activity      min(recent commits/day ÷ baseline commits/day, 3) ÷ 3 × 100
  Concentration 100 − (churn in the 3 busiest files ÷ total churn × 100)
  Stability     100 − (commit subjects matching the fix pattern ÷ total commits × 100)
  Collaboration 100 − (top contributor's commits ÷ total commits × 100)
  warnings      one file in more than 5 commits · top-3 churn above 50% · one author above 70%
```

Flags: `--json`. `repotool help health` prints the formulas, the bands and the
warning thresholds in full.

<details>
<summary><b>The four formulas, the bands and the warning thresholds</b></summary>

| Dimension | Formula (higher is better) |
|---|---|
| Activity | `min(recent commits/day ÷ baseline commits/day, 3) ÷ 3 × 100` |
| Concentration | `100 − (churn in the 3 busiest files ÷ total churn × 100)` |
| Stability | `100 − (subjects matching the fix pattern ÷ commits × 100)` |
| Collaboration | `100 − (top contributor's commits ÷ total commits × 100)` |

The fix pattern is `\b(fix|fixes|fixed|fixing|bug|bugs|bugfix|hotfix|revert|reverts|reverted|regression)\b`,
case-insensitive — word boundaries, so `prefix` is not a fix and `debugger` is
not a bug.

Overall is the equal-weighted mean of the dimensions that could be measured:
`80+ EXCELLENT`, `60+ GOOD`, `40+ FAIR`, below 40 `NEEDS ATTENTION`.

**Activity refuses to answer rather than guess.** It reuses the comparison
behind [`ask "why is this repository changing so much"`](#ask): when either
period spans under a day, or there are fewer than four commits, no ratio is
printed and the dimension is left out of the overall mean instead of being
filled in with a plausible number.

Warnings print only when they trigger: one file changed in more than
`max(5, 25% of all commits)` commits, more than 50% of all churn in the three
busiest files, or one contributor above 70% of all commits.

</details>

## `timeline`

Commit activity per day (or week), scaled against the busiest bucket on screen.

```sh
repotool timeline --limit 6
repotool timeline --by week
repotool timeline --metric lines --json
```

```
Repository Activity
───────────────────

Aug 29  ████████████
Aug 30  ████████████████████████████████
Aug 31  ████████████████████

Commits: 16  (2026-08-29 → 2026-08-31)
Peak: Aug 30  (8 commits)
```

Flags: `--limit N` (recent buckets, default 30), `--by day|week`,
`--metric commits|lines|contributors`, `--json`.

Days with no commits are shown as `·` rather than skipped — a gap in the
history is information, and dropping it would quietly compress the time axis.
Buckets use each commit's local calendar day, so an evening commit stays on its
own day instead of sliding into the next one.

## `completion`

Prints a bash or zsh completion script on stdout, generated from one
description of the CLI surface in `src/completion.js` — so the two shells
cannot drift apart from each other or from the tool.

```sh
# bash — for the current shell
eval "$(repotool completion bash)"

# bash — permanently
repotool completion bash > ~/.local/share/bash-completion/completions/repotool

# zsh — into a directory on your fpath, then restart the shell
repotool completion zsh > "${fpath[1]}/_repotool"
```

Both scripts complete commands, each command's flags, and the fixed values a
flag accepts (`--sort score|commits|churn|authors`, `--format ascii|svg`,
`--by day|week`, `--metric commits|lines|contributors`); `--repo` completes
directories and `--output` completes files.

Arguments: `bash` or `zsh`. No flags of its own beyond the common options.

---

## Scripting / JSON output

`stats`, `hotspots`, `health`, `timeline`, `ask` and `compare` take `--json`.
The JSON goes to stdout and nothing else does, errors still go to stderr, and
exit codes are unchanged — so `repotool stats --json | …` is safe to pipe.
`graph` and `diff` have no `--json`: their value is the picture, and
`--format svg` is graph's structured export.

```sh
repotool stats --json
repotool hotspots --json --limit 25 --sort churn
repotool health --json
repotool timeline --json --by week
repotool compare main feature --json
repotool ask "who last touched src/app.js" --json
```

Field names are stable; new fields may be added, existing ones are not renamed.

<details>
<summary><b>Full JSON schemas</b> — stats, hotspots, health, timeline, compare, ask</summary>

`stats --json`:

```
{
  "repository": { "path", "name", "head": { "empty", "detached", "branch", "hash" } },
  "empty":        boolean,
  "commits":      { "total", "merges", "first", "last", "spanDays" },
  "contributors": [ { "name", "email", "commits", "merges", "added", "removed",
                      "firstDate", "lastDate" } ],
  "branches":     { "local": [name], "remote": [name] },
  "totals":       { "filesTouched", "added", "removed", "churn" },
  "topFiles":     [ file ]
}
```

`hotspots --json`:

```
{
  "repository": { … as above … },
  "empty":      boolean,
  "sort":       "score" | "commits" | "churn" | "authors",
  "weights":    { "commits", "churn", "authors" },
  "totalFiles": number,
  "files":      [ { "rank", "score", …file } ]
}
```

A `file` everywhere above is
`{ path, commits, authors, added, removed, churn, binary, firstDate, lastDate }`.

`health --json` carries the evidence behind each score, not just the score, so
a script can see what produced it:

```
{
  "repository": { … },
  "empty":         boolean,
  "overall":       { "score", "band", "dimensions": [measured dimension names] },
  "activity":      { "score", "formula", "ratio", "recentPerDay", "baselinePerDay",
                     "comparable", "reason" },
  "concentration": { "score", "formula", "share", "topChurn", "totalChurn", "files" },
  "stability":     { "score", "formula", "pattern", "fixCommits", "totalCommits", "share" },
  "collaboration": { "score", "formula", "topContributor", "topCommits",
                     "totalCommits", "contributors", "share" },
  "warnings":      [ { "code", "message", "value", "threshold" } ]
}
```

A dimension that could not be measured has `"score": null` and a `"reason"`,
and its name is absent from `overall.dimensions`.

`timeline --json`:

```
{
  "repository": { … },
  "empty":        boolean,
  "by":           "day" | "week",
  "metric":       "commits" | "lines" | "contributors",
  "buckets":      [ { "date", "commits", "added", "removed", "contributors" } ],
  "peak":         { "date", "commits" } | null,
  "totalCommits": number
}
```

`compare --json` describes both directions with the same shape, so a script can
read them symmetrically:

```
{
  "refA", "refB", "hashA", "hashB",
  "identical":  boolean,
  "mergeBase":  hash | null,
  "a":          side,          // what refA has that refB does not
  "b":          side,          // and the reverse
  "sharedContributors": [name],
  "sharedFiles":        [path]
}

side = { ref, range, commits, merges, filesChanged, added, removed, churn,
         first, last, contributors, onlyContributors, files }
```

`ask --json` wraps the answer in the question that produced it, so a script
does not have to keep its own note of what it asked:

```
{
  "question": "who last touched src/app.js",
  "intent":   "who-touched",
  "argument": "src/app.js",
  "answer":   { … shape depends on the intent … }
}
```

The text and JSON answers are built side by side from the same values in
`src/query/handlers.js`, so the two can never report different facts.

</details>

## Zero-dependency proof

```sh
node verify-zero-deps.js     # runs anywhere Node runs
sh verify-zero-deps.sh       # same checks, POSIX shell
```

Both check the same three things: the `dependencies` block is empty, every
`require` in `src/`, `bin/` and `test/` resolves to a Node built-in or a
relative path, and no unexpected `node_modules` tree is present. The Node
version needs no shell, so it works on Windows without Git Bash.

The proof is itself tested: the suite plants a real third-party import and a
declared dependency in a copy of the project and asserts the checker fails.

See [STDLIB.md](STDLIB.md) for the full package-by-package substitution log —
what each replaced package would have given us, and what writing it ourselves
cost.

## Tests

```sh
npm test        # or: node --test "test/*.test.js"
```

The suite builds real throwaway git repositories and covers empty repos, a
single root commit, merge commits, detached HEAD, malformed git output, a
randomised round-trip property for the diff algorithm, SVG well-formedness
(checked with a small XML parser written for the tests, since Node has none),
`--json` shapes, health scores asserted as exact hand-checkable numbers,
timeline bucketing across timezones and week boundaries, compare's ahead/behind
counts, and generated completion scripts (`bash -n`).

## Design

Nine commands over one shared reading layer. Feature modules never reach into
each other's internals.

```
bin/repotool.js       argv routing, per-command help
src/index.js          public API for using repotool as a library
src/git-reader.js     the only file that talks to git
src/analysis/         shared repo model + stats, hotspots, health, timeline,
                      compare, and the JSON renderers
src/graph/            DAG layout + ASCII and SVG renderers
src/query/            question -> intent -> answer (text and JSON together)
src/diff/             Myers diff + unified-diff renderer
src/completion.js     generated bash and zsh completion scripts
src/format.js         column alignment, number grouping, relative dates
src/ansi.js           escape codes, TTY/NO_COLOR aware
```

**Every output format is a renderer over a shared model, never a second
derivation of the same facts.** ASCII and SVG share one lane layout; the human
and JSON reports share one repo model; each `ask` answer produces its text and
its JSON side by side; `compare` folds a commit range through the same model
`stats` uses; one Myers implementation runs at both line and character
granularity; one description of the CLI generates both completion scripts.
That is what makes "these two views cannot disagree" checkable rather than
merely claimed.

`src/analysis/repo-model.js` reads the history once — commits, contributors,
branches and per-file churn, the last of these from a single
`git log --numstat` — and every report and aggregate question is folded from
that one pass rather than re-deriving its own. (What that pass does and does
not count is described under [hotspots](#hotspots).)

Feature modules are required lazily, both in the CLI and in `src/index.js`, so
a problem in one feature cannot stop the others from running.

## Use it as a library

```js
const {
  readCommits, buildGraph, renderAscii, renderSvg,
  buildRepoModel, statsJson, hotspotsJson,
  diffLines, parseQuestion, answerQuestionJson,
} = require('@amarnotcool/repotool-apex');

const { commits } = readCommits({ cwd: '/path/to/repo' });
console.log(renderAscii(buildGraph(commits)));
console.log(renderSvg(buildGraph(commits)));
console.log(statsJson(buildRepoModel({ cwd: '/path/to/repo' })));
```

`computeHealth`, `buildTimeline`, `compareRefs` and their renderers and JSON
serialisers are exported the same way.

`git-reader` shells out to the `git` binary for raw data only — commit
metadata, file lists, blob contents. Every piece of interpretation (graph
layout, question answering, diffing) is our own code.

## License

MIT — see [LICENSE](LICENSE).
