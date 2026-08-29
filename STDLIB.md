# STDLIB.md — what we did not install

`repotool` has an empty `dependencies` block. Every capability below would
normally arrive as an npm package; each row records what we used instead and
where that code lives.

| Normally would use | Instead we use | Where |
|---|---|---|
| `simple-git`, `nodegit` | `child_process.execFileSync('git', …)` plus our own record/field-separator log parser | `src/git-reader.js` |
| `chalk`, `kleur`, `picocolors` | raw ANSI SGR escape codes, with TTY and `NO_COLOR` detection | `src/ansi.js` |
| `commander`, `yargs`, `minimist` | hand-rolled `process.argv` scanner (`--flag`, `--flag=value`, `--flag value`, positionals) | `bin/repotool.js` |
| `diff`, `jsdiff`, `fast-diff` | our own implementation of Myers' O(ND) algorithm, including the trace backtrack | `src/diff/myers.js` |
| `diff2html`, `unified-diff` formatters | our own hunk grouping and unified-diff renderer | `src/diff/myers.js`, `src/diff/render-diff.js` |
| `gitgraph.js`, `git-graph`, `dagre` | our own lane-allocation DAG layout | `src/graph/build-graph.js` |
| `toposort`, `graphlib` | Kahn-style topological sort over commit/parent edges, date-tie-broken | `src/graph/build-graph.js` (`topoSort`) |
| `boxen`, `cli-table3`, `string-width` | manual column padding plus an escape-code-aware `visibleLength` | `src/ansi.js`, `src/graph/render-ascii.js` |
| `natural`, `compromise`, `nlp.js` | keyword-group matcher mapping question patterns to intents — deterministic, no model | `src/query/parser.js` |
| `date-fns`, `dayjs`, `moment` | `git`'s ISO-8601 output (`%aI`, `%cI`) plus the built-in `Date` and string slicing | `src/git-reader.js`, `src/query/handlers.js` |
| `jest`, `mocha`, `chai`, `tap` | `node:test` and `node:assert/strict` | `test/*.test.js` |
| `tmp`, `fs-extra`, `rimraf` | `fs.mkdtempSync`, `fs.rmSync({ recursive: true })`, `os.tmpdir()` | `test/helpers.js` |
| `depcheck`, `license-checker` | our own import scanner that walks `src/` and `bin/` and rejects any non-builtin, non-relative `require` | `verify-zero-deps.sh` |

Node built-ins actually used: `child_process`, `fs`, `os`, `path`, `process`,
`node:test`, `node:assert`.

Dev dependencies: none. The test runner ships with Node.
