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

Flags: `--limit N`, `--branch REF`, `--no-dates`, `--repo PATH`, `--no-color`.

### `repotool ask "<question>"`

Deterministic answers to fixed question shapes — a keyword matcher over parsed
git data, not a language model, so the same question always gives the same
answer and nothing leaves your machine.

```sh
repotool ask "who last touched src/git-reader.js"
repotool ask "how many commits by Ada"
repotool ask "what files changed in HEAD~2"
repotool ask "show the last 10 commits"
repotool ask "which file changed the most often"
repotool ask "what branches exist"
repotool ask "when was 01f599d committed"
```

Ask something unsupported and it prints the list of what it can answer.

### `repotool diff <commitA> [commitB]`

Colourised unified diff between two revisions, computed by our own Myers
diff implementation.

```sh
repotool diff HEAD~3 HEAD
repotool diff main feature --context 5
repotool diff HEAD~1 HEAD --stat
```

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
randomised round-trip property for the diff algorithm, and the dependency
proof itself — planting a third-party import to confirm the checker fails.

## Design

Three modules, no shared internals — each stands alone.

```
bin/repotool.js       argv routing
src/index.js          public API for using repotool as a library
src/git-reader.js     the only file that talks to git
src/graph/            DAG layout + ASCII renderer
src/query/            question -> intent -> answer
src/diff/             Myers diff + unified-diff renderer
src/ansi.js           escape codes, TTY/NO_COLOR aware
```

Feature modules are required lazily, both in the CLI and in `src/index.js`, so
a problem in one feature cannot stop the other two from running.

## Use it as a library

```js
const { readCommits, buildGraph, renderAscii, diffLines, parseQuestion } = require('@amarnotcool/repotool');

const { commits } = readCommits({ cwd: '/path/to/repo' });
console.log(renderAscii(buildGraph(commits)));
```

`git-reader` shells out to the `git` binary for raw data only — commit
metadata, file lists, blob contents. Every piece of interpretation (graph
layout, question answering, diffing) is our own code.

## License

MIT — see [LICENSE](LICENSE).
