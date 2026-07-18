# CLAUDE.md starter — Claude-assisted repo operating manual

A distilled, project-agnostic version of the working rules that evolved in the
job-tracker project. Copy this into a new repo's `CLAUDE.md`, delete what
doesn't apply, and fill in the `<placeholders>`.

---

## Commands

```bash
<dev command>        # start dev server
<build command>      # production build
<lint command>       # linter + type-check
<test command>       # unit tests WITH coverage (the same command CI runs)
<e2e command>        # end-to-end tests
```

## Git workflow

**`main` is read-only. Never edit or commit files directly on `main`.** This
applies to every file change without exception — code, config, CI workflows,
documentation, CLAUDE.md itself.

**Before the first Edit or Write call in any session: (1) create an issue,
(2) create a worktree.** The three steps in order:

1. `gh issue create` with the appropriate label and a clear, plain-text title.
   Add `status: in progress` if implementing immediately in the same session
   (this also stops any auto-fix bot from racing you to a duplicate PR).
2. `git worktree add ../<repo>-N -b <branch-name> origin/main` — base on
   `origin/main`, not local main, and do ALL work inside the worktree. Branch
   naming: `fix/issue-N-<timestamp>`, `feat/issue-N-<slug>`, `docs/issue-N-<slug>`.
3. Open a PR titled `<issue title> (#N)` with `Closes #N` in the body.

**Never use `cd /path && <command>` in shell commands** — permission allowlists
match the leading token, so `cd ... && git ...` prompts even when `git *` is
allowed. Use `git -C /abs/path <subcommand>` and absolute paths instead;
reserve `cd` for standalone navigation.

**Never hardcode local absolute paths in any committed file** — use
`git rev-parse --show-toplevel` or relative paths.

**Bundle related changes** — code and the docs that explain them go in one
commit. Only split when changes are genuinely independent.

## No duplication

**Before writing any function, component, type, constant, or shell block —
search for an existing implementation first.** The moment of extraction is
before the second copy is written, not after. "It's slightly different" is not
a reason to copy — it is a reason to add a parameter.

For workflows specifically: any `run:` block longer than ~10 lines that appears
(or will appear) in more than one workflow file must be extracted to
`.github/actions/<name>/action.yml`.

## Testing

- **Run the coverage command before committing, not the bare test command** —
  use exactly what CI runs, so threshold failures surface locally.
- **Every user-facing change needs an E2E test in the same PR.** Ask before
  finishing any feature: "What E2E test covers this?" If none, write one.
- **Run E2E against a production build, not the dev server.** Dev servers skip
  tree-shaking, chunk isolation, and SSR/hydration in ways that hide entire
  classes of bugs.
- **Visual snapshot updates are an explicit human decision — never automated.**
  Investigate the diff; only run `--update-snapshots` after a human confirms
  the change is intentional, in a clearly labelled standalone commit.
- **Library upgrades that affect rendering (CSS framework, framework major
  bumps) must pass visual regression tests before merging** — unit and
  functional tests cannot catch layout/default-value changes.

## Documentation

**After every change, check whether README.md needs updating and update it in
the same commit.** The user-facing bar is intentionally low — setup steps, env
vars, secrets, and CI changes all count.

**When updating CLAUDE.md, grep for related terms first** and update or remove
anything the change supersedes. Stale notes that contradict current behaviour
are worse than no notes.

## Code conventions

- No comments unless the WHY is non-obvious.
- Read the actual API/payload schema before writing integration code — never
  infer field names from template variable names or analogy.
- Automate before listing manual dashboard steps — check for a Management API,
  CLI, or SDK first; only fall back to browser instructions if none exists.
- **Env-var guards must never be removed** — `if (!process.env.X) { fail }` is
  an intentional failure mode for missing configuration, not dead code. The fix
  is setting the env var, not deleting the guard.
- `gh` read commands (`gh run list`, `gh issue list`, …) don't need
  confirmation — run them directly. Pause only for destructive operations.

## Investigation discipline

- **When debugging a live workflow failure, check actual run logs before static
  YAML analysis**: `gh run list --workflow=<name> --limit 5` then
  `gh run view <id> --log-failed`. Static review misses runtime failures.
- **Never trigger a re-run as part of an investigation** — re-runs overwrite
  the latest-attempt data and destroy the evidence. Gather everything first.
- **Test at the lowest layer** — if a workflow can be triggered directly with
  `gh api .../dispatches`, do that instead of triggering the full external
  pipeline (webhook provider, live crash, etc.).

## Self-review before pushing (do not wait to be asked)

On every cycle check: logic, shell correctness (quoting, exit codes, heredoc
termination), step ordering (does each step have what it needs?), edge cases
(what if the happy path fails?), and `actionlint` for workflow files. For any
`sed`/`awk`/`jq` one-liner and every `--jq` flag: **run it against non-empty
representative sample input before committing** — this rule applies especially
when the expression looks obviously correct.
