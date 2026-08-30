# STDLIB.md — what we did not install

`repotool` has an empty `dependencies` block. Every capability below would
normally arrive as an npm package. Each entry records what we used instead,
where that code lives, and — honestly — what the substitution cost us as well
as what it bought.

The recurring gain is the same one every time, so it is stated once here rather
than repeated fifteen times: **no dependency surface**. No transitive tree, no
audit noise, no lockfile drift, no supply-chain exposure, nothing to update
when a maintainer moves on. `npm install` pulls exactly one package.

What each substitution cost is specific, and that is what the notes below are
for.

---

### `simple-git`, `nodegit` → `child_process.execFileSync` + our own parser
`src/git-reader.js`

We ask git for raw data with separator-delimited pretty formats and parse the
output ourselves.

- **Lost:** promise-based streaming, and the porcelain-vs-plumbing knowledge a
  library encodes. `nodegit` talks to libgit2 directly and never shells out at
  all, so it works with no `git` binary installed; we require one on `PATH`.
- **Gained:** every git invocation is visible in one file, and we choose the
  exact plumbing flags rather than accepting a wrapper's defaults. Being forced
  to name each call is what surfaced that binary detection was leaning on a
  diff command it did not need.

### `chalk`, `kleur`, `picocolors` → raw ANSI SGR escape codes
`src/ansi.js`

- **Lost:** chalk's colour-support detection, which probes terminal type,
  `TERM`, CI environment variables and Windows build numbers. Ours is a blunter
  test: TTY, plus `NO_COLOR` and `FORCE_COLOR`. A terminal that supports colour
  but reports oddly gets plain text from us.
- **Gained:** ~30 lines instead of a dependency, and colour that is trivially
  forced on or off for tests — every renderer takes an explicit `color` option
  rather than consulting global state.

### `commander`, `yargs`, `minimist` → hand-rolled `process.argv` scanner
`bin/repotool.js`

Supports `--flag`, `--flag=value`, `--flag value` and positionals.

- **Lost:** short flags (`-l`), flag clustering (`-abc`), `--` passthrough,
  negation handling, shell completion generation, and automatic help wired to
  the parser. Our help is a separate data table that we keep in step by
  construction, but nothing enforces it at the type level.
- **Gained:** exactly the argument grammar we document and no more, and
  validation errors we phrase ourselves — `--sort must be one of: …` rather
  than a framework's default.

### `diff`, `jsdiff`, `fast-diff` → our own Myers O(ND) implementation
`src/diff/myers.js`

The greedy forward walk with a trace, plus backtracking to an edit script.

- **Lost:** jsdiff's word, character, sentence, CSS and JSON diff modes, patch
  application, and the linear-space refinement that keeps memory bounded on
  very large inputs. Our trace holds one V-array snapshot per edit distance, so
  a pathological diff of two huge dissimilar files costs more memory than
  jsdiff would.
- **Gained:** the actual algorithm, which is the point of the exercise, plus a
  common prefix/suffix trim and a property test asserting that every generated
  script round-trips both inputs.

### `diff2html`, unified-diff formatters → our own hunk grouping and renderer
`src/diff/myers.js` (`toHunks`), `src/diff/render-diff.js`

- **Lost:** side-by-side rendering, syntax highlighting, HTML output, and
  word-level intra-line highlighting.
- **Gained:** hunk headers that follow unified-diff convention including the
  zero-start case for created and deleted files, and output that is plain text
  by default so it pipes cleanly.

### `gitgraph.js`, `git-graph`, `dagre` → our own lane-allocation DAG layout
`src/graph/build-graph.js`, `src/graph/render-ascii.js`

- **Lost:** SVG and canvas rendering, interactive layouts, and dagre's general
  graph algorithms (we solve one specific shape, not arbitrary DAGs).
- **Gained:** layout separated from rendering, so the same rows could drive an
  SVG exporter later; and control over the details that make a terminal graph
  readable — lanes compacting leftwards when a branch ends, diagonals that
  point at the column they actually mean.

### `toposort`, `graphlib` → Kahn-style topological sort, date-tie-broken
`src/graph/build-graph.js` (`topoSort`)

- **Lost:** cycle detection reporting and the general-purpose graph utilities
  that come with graphlib.
- **Gained:** a deterministic tie-break by commit date, which a generic sort
  cannot know we want, plus a defined fallback for partial histories (a shallow
  clone or `--max-count` cut leaves commits whose children were never loaded).

### `boxen`, `cli-table3`, `columnify`, `string-width` → our own column layout
`src/format.js` (`table`, `padEnd`, `padStart`), `src/ansi.js` (`visibleLength`)

- **Lost:** box drawing, per-cell wrapping, and — the real one — proper
  Unicode width handling. `string-width` knows that CJK characters occupy two
  columns and that emoji and combining marks are irregular; we count code units
  after stripping escape sequences, so a table of CJK filenames would misalign.
  ASCII and Latin paths, which is what git records here, align correctly.
- **Gained:** alignment that accounts for ANSI escape codes without a second
  dependency, and no trailing whitespace on any rendered row.

### `numeral`, `pretty-bytes`, `Intl.NumberFormat` → manual digit grouping
`src/format.js` (`count`, `churn`, `percent`, `decimal`)

- **Lost:** locale awareness. We always group with commas; a French or Indian
  reader gets grouping they would not choose. `Intl` is built in and would give
  us this, but its output varies with the host locale, which would make test
  assertions machine-dependent.
- **Gained:** identical output on every machine, which matters for a tool whose
  output people paste into issues and for tests that assert on exact strings.

### `date-fns`, `dayjs`, `moment` → ISO-8601 from git + the built-in `Date`
`src/git-reader.js` (`%aI`, `%cI`), `src/format.js` (`relativeDate`, `days`)

- **Lost:** timezone conversion, calendar-aware arithmetic, parsing of
  arbitrary formats, and localisation of relative phrasing.
- **Gained:** git already emits strict ISO-8601, so parsing is free; our
  `relativeDate` walks a fixed scale table in a dozen lines. The one place this
  bit us was worth catching: rate arithmetic over a history that fits inside a
  single day produced confident nonsense, so the model now reports the real
  elapsed span separately from the clamped one and declines to quote a per-day
  rate it cannot support.

### `natural`, `compromise`, `nlp.js` → keyword-group intent matcher
`src/query/parser.js`

Each question is a set of keyword groups plus an extraction regex; the intent
matching the most groups wins.

- **Lost:** synonym expansion, stemming, and any tolerance for phrasings we did
  not anticipate. Ask something slightly off-script and you get the supported
  list, not a guess.
- **Gained:** determinism — the same question always produces the same answer,
  and every answer is traceable to the arithmetic behind it. Adding a question
  is one table entry, and each entry carries an example that a test asserts
  routes back to its own intent, so the advertised questions cannot rot.

### `lodash` (`groupBy`, `countBy`, `sumBy`) → `Map` folding in one pass
`src/analysis/repo-model.js` (`foldHistory`)

- **Lost:** the ergonomics of chained collection helpers.
- **Gained:** one traversal that accumulates contributors, per-file commit
  counts, per-file authors and churn together, instead of several passes each
  building its own intermediate array. The aggregation is the interesting part
  of this project, so writing it out is not a cost.

### `isbinaryfile`, `istextorbinary` → NUL-byte sniff over the first 8 kB
`src/git-reader.js` (`isBinary`)

- **Lost:** encoding heuristics — UTF-16 detection, BOM handling, and the
  extension and MIME databases those packages consult.
- **Gained:** the check is honest about what it is (a byte test) and needs no
  diff command to classify a file, which is what replacing `git diff --numstat`
  here was about.

### `shelljs`, `execa`, `cross-spawn` → `execFileSync`, including batched stdin
`src/git-reader.js` (`git`, `readBlobs`, `readHistoryWithStats`)

- **Lost:** streaming output, promise interfaces, cross-shell quoting help, and
  execa's friendlier error objects.
- **Gained:** `execFileSync` takes an argument array, so there is no shell to
  quote for and no injection surface. Feeding `git cat-file --batch` a list of
  blobs over stdin turned two spawns per file into one per diff — a 21-file
  diff went from 2.9s to 0.44s — and `git log --numstat` gives whole-repository
  churn in a single invocation rather than one diff per commit.

### `jest`, `mocha`, `chai`, `tap` → `node:test` and `node:assert/strict`
`test/*.test.js`

- **Lost:** watch mode, snapshot testing, built-in coverage reporting, rich
  matcher vocabulary, and parallel workers.
- **Gained:** `npm test` needs no install at all, which keeps `devDependencies`
  empty and makes the zero-dependency claim total rather than runtime-only.
  `assert.match` and `assert.deepEqual` cover everything we assert.

### `tmp`, `fs-extra`, `rimraf` → `fs.mkdtempSync`, `fs.rmSync`, `os.tmpdir`
`test/helpers.js`

- **Lost:** automatic cleanup on process exit; ours is explicit in `finally`
  blocks, so a hard crash mid-test can leave a temp directory behind.
- **Gained:** tests that build real git repositories on disk rather than
  mocking git's output — which is what a parser this format-sensitive needs to
  be tested against.

### `depcheck`, `license-checker` → our own import scanner
`verify-zero-deps.js`, `verify-zero-deps.sh`

- **Lost:** license auditing, unused-dependency detection, and AST-accurate
  parsing. Ours is a regex over source with comments stripped, so it is
  deliberately conservative rather than clever.
- **Gained:** a proof a reviewer can run in either a shell or bare Node, that
  covers `src/`, `bin/` and `test/`, and that is itself tested — the suite
  plants a real third-party import and asserts the checker fails.

### `gitgraph.js`, `d3`, `svg.js` → our own SVG serialiser
`src/graph/render-svg.js`

An SVG file is XML text, so `--format svg` builds the string directly:
`<path>` for lane edges, `<circle>`/`<polygon>` for commit, root and merge
nodes, `<text>` with per-`tspan` colours for labels.

- **Lost:** a layout engine, hit-testing, interactivity, and a library's
  accumulated knowledge of font metrics — our canvas width comes from a
  monospace advance constant, so an unusual font can overflow the viewBox.
- **Gained:** the SVG renderer reads the *same* lane assignment the ASCII
  renderer does, so the two views cannot disagree about the shape of history.
  A drawing library would have wanted its own graph model, which is exactly
  the duplication that lets two renderings drift apart.

### `diff-match-patch`, `jsdiff`'s `diffWords` → the Myers pass we already have
`src/diff/render-diff.js`

Intra-line highlighting runs `myers.diff` a second time over the two lines'
characters instead of importing a second algorithm.

- **Lost:** word- and sentence-level heuristics, and `diff-match-patch`'s
  semantic cleanup, which merges trivial fragments into readable spans. We
  approximate that cleanup with two rules — a similarity floor and a cap on how
  many separate changed runs a line may have — tuned by looking at real diffs
  in express, axios and undici rather than by theory.
- **Gained:** one diff implementation in the project, used at two granularities.
  There is nothing that could disagree with the line-level result.

### `omelette`, `tabtab`, `commander`'s completion generator → generated scripts
`src/completion.js`

`repotool completion bash|zsh` prints a script generated from one description
of the CLI's surface.

- **Lost:** dynamic completion (asking the running tool for candidate branch or
  file names mid-completion), fish and PowerShell support, and installation
  helpers that edit the user's shell profile.
- **Gained:** commands, flags and static values live in one table, so the bash
  and zsh scripts cannot drift apart from each other or from the tool. The
  generated bash script is checked with `bash -n` in the test suite.

### `xml2js`, `fast-xml-parser`, `jsdom` → a small XML checker, for tests only
`test/xml.js`

Node has no XML parser, and asserting our hand-built SVG is well-formed needs
one.

- **Lost:** namespaces, DTDs, entity expansion beyond the five predefined ones,
  and CDATA. It is a checker, not a general parser.
- **Gained:** the assertion "this document parses" is honest without adding a
  devDependency, which would have made the zero-dependency claim runtime-only.
  It fails on exactly what a hand-written serialiser gets wrong: unbalanced
  tags, unquoted attributes, and unescaped `&` or `<`.

---

Node built-ins actually used: `child_process`, `fs`, `os`, `path`, `process`,
`module`, `node:test`, `node:assert`.

Dev dependencies: none. The test runner ships with Node.
