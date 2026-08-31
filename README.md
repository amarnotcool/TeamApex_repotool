# repotool

A CLI that reads, graphs, questions and diffs a git repository — built on the
Node.js standard library and nothing else. No `chalk`, no `commander`, no
`diff`, no `simple-git`. `dependencies` in `package.json` is empty, and
`verify-zero-deps.sh` proves it.

## Run it

Nothing to install, nothing to build — run it straight from the registry
inside any git repository:

```sh
npx @amarnotcool/repotool graph
```

Or install it once and use the short command everywhere:

```sh
npm i -g @amarnotcool/repotool
repotool graph
```

That global install pulls exactly one package: this one. `dependencies` is
empty, so there is no transitive tree behind it.

From a clone, no install step at all:

```sh
node bin/repotool.js graph
```

Node 18 or newer and a `git` binary on `PATH` are the only requirements.

## Commands

### `repotool graph`

Parses the full commit and merge history and draws it as a lane graph.
`*` is a commit, `M` a merge, `o` a root commit.

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
`--output PATH`, `--repo PATH`, `--no-color`.

#### SVG export

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

### `repotool stats`

One screen describing the repository: size, people, branches, churn, and where
the changes land.

```
repotool stats — Zero Dependency  on branch main

commits        15
contributors   2
branches       2 local, 1 remote
files touched  37
line churn     10,666  +9,796 / -870
history        2026-08-20 → 2026-08-25  (4 days)
last commit    13 minutes ago

Top 3 contributors
──────────────────
13  ████████████████  Devpratap
 2  ██                Devpratap Singh

Top 3 most-changed files
────────────────────────
8 commits  497 lines  README.md
7 commits  863 lines  bin/repotool.js
6 commits  874 lines  src/query/handlers.js
```

### `repotool hotspots`

Files ranked by how much attention they attract — change frequency, how many
different people touch them, and how many lines move. The score weights all
three and the weighting is printed with the table rather than hidden.

```sh
repotool hotspots
repotool hotspots --limit 25 --sort churn
```

Sort by `score` (default), `commits`, `churn` or `authors`.

#### Where the churn numbers come from

Every line-count figure in `stats`, `hotspots` and `ask` comes from a single
`git log --numstat` pass over the whole history. Git emits no numstat for
merge commits, so **merges are excluded from churn** — that avoids counting the
same lines twice on a merge-heavy history, but it does mean a repository that
squash-merges everything will report less churn than the branch history
suggests. Every file-level answer reads that same pass, so `hotspots` and
`ask "which file changed the most often"` cannot disagree with each other.

### `repotool ask "<question>"`

Deterministic answers to fixed question shapes — a keyword matcher over parsed
git data, not a language model, so the same question always gives the same
answer and nothing leaves your machine.

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

Ask something unsupported and it prints the list of what it can answer.

### `repotool diff <commitA> [commitB]`

Colourised unified diff between two revisions, computed by our own Myers
diff implementation.

```sh
repotool diff HEAD~3 HEAD
repotool diff main feature --context 5
repotool diff HEAD~1 HEAD --stat
```

Lines that were *edited* rather than replaced get a second, character-level
Myers pass — the same algorithm, run again over the two lines' characters — and
only the span that actually changed is underlined inside the usual red/green
line. A pair is only treated as an edit when it clears three guards: at least
30% of characters in common, no more than three separate changed runs per
side, and runs averaging at least two characters. Anything else is a rewrite
and stays whole-line coloured, because character-level detail on unrelated
lines is noise rather than information. With `--no-color` (or `NO_COLOR`) the
extra pass is skipped entirely: there is nothing to show it with.

### `repotool completion <bash|zsh>`

Prints a completion script for the named shell. See
[Shell completion](#shell-completion) for installation.

## Scripting / JSON output

`stats`, `hotspots` and `ask` take `--json`. The JSON goes to stdout and
nothing else does, errors still go to stderr, and exit codes are unchanged — so
`repotool stats --json | …` is safe to pipe. `graph` and `diff` have no
`--json`: their value is the picture, and `--format svg` is graph's structured
export.

```sh
repotool stats --json
repotool hotspots --json --limit 25 --sort churn
repotool ask "who last touched src/app.js" --json
```

Field names are stable; new fields may be added, existing ones are not renamed.

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

## Shell completion

```sh
# bash — for the current shell
eval "$(repotool completion bash)"

# bash — permanently
repotool completion bash > ~/.local/share/bash-completion/completions/repotool

# zsh — into a directory on your fpath, then restart the shell
repotool completion zsh > "${fpath[1]}/_repotool"
```

Both scripts complete commands, each command's flags, and the fixed values a
flag accepts (`--sort score|commits|churn|authors`, `--format ascii|svg`);
`--repo` completes directories and `--output` completes files. They are
generated from one description of the CLI surface in `src/completion.js`, so
the two shells cannot drift apart from each other or from the tool.

## Zero-dependency proof

```sh
node verify-zero-deps.js     # runs anywhere Node runs
sh verify-zero-deps.sh       # same checks, POSIX shell
```

Both check the same three things: the `dependencies` block is empty, every
`require` in `src/`, `bin/` and `test/` resolves to a Node built-in or a
relative path, and no unexpected `node_modules` tree is present. The Node
version needs no shell, so it works on Windows without Git Bash.

See [STDLIB.md](STDLIB.md) for the full package-by-package substitution log.

## Tests

```sh
npm test        # or: node --test "test/*.test.js"
```

The suite builds real throwaway git repositories and covers empty repos, a
single root commit, merge commits, detached HEAD, malformed git output, a
randomised round-trip property for the diff algorithm, SVG well-formedness
(checked with a small XML parser written for the tests, since Node has none),
`--json` shapes, generated completion scripts (`bash -n`), and the dependency
proof itself — planting a third-party import to confirm the checker fails.

## Design

Six commands over one shared reading layer. Feature modules never reach into
each other's internals.

```
bin/repotool.js       argv routing, per-command help
src/index.js          public API for using repotool as a library
src/git-reader.js     the only file that talks to git
src/analysis/         shared repo model + stats, hotspots and JSON renderers
src/graph/            DAG layout + ASCII and SVG renderers
src/query/            question -> intent -> answer (text and JSON together)
src/diff/             Myers diff + unified-diff renderer
src/completion.js     generated bash and zsh completion scripts
src/format.js         column alignment, number grouping, relative dates
src/ansi.js           escape codes, TTY/NO_COLOR aware
```

Every output format is a renderer over a shared model, never a second
derivation of the same facts: ASCII and SVG share one lane layout, the human
and JSON reports share one repo model, and each `ask` answer produces its text
and its JSON side by side.

`src/analysis/repo-model.js` reads the history once — commits, contributors,
branches and per-file churn, the last of these from a single
`git log --numstat` — and every report and aggregate question is folded from
that one pass rather than re-deriving its own.

Feature modules are required lazily, both in the CLI and in `src/index.js`, so
a problem in one feature cannot stop the other two from running.

## Use it as a library

```js
const {
  readCommits, buildGraph, renderAscii, renderSvg,
  buildRepoModel, statsJson, hotspotsJson,
  diffLines, parseQuestion, answerQuestionJson,
} = require('@amarnotcool/repotool');

const { commits } = readCommits({ cwd: '/path/to/repo' });
console.log(renderAscii(buildGraph(commits)));
console.log(renderSvg(buildGraph(commits)));
console.log(statsJson(buildRepoModel({ cwd: '/path/to/repo' })));
```

`git-reader` shells out to the `git` binary for raw data only — commit
metadata, file lists, blob contents. Every piece of interpretation (graph
layout, question answering, diffing) is our own code.

## License

MIT — see [LICENSE](LICENSE).
