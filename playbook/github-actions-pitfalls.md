# GitHub Actions pitfalls — learned the hard way

Hard-won, project-agnostic lessons from running an automated Claude fix/CI
pipeline in production. Each of these cost at least one broken run to discover.

## Token attribution (the big one)

- **`GITHUB_TOKEN` suppresses the workflow triggers of events it causes.**
  A bot merge via `GITHUB_TOKEN` closes the linked issue but the
  `issues: closed` trigger never fires; a bot push to a PR branch resets the
  checks to "Waiting for status to be reported" and no CI run ever starts.
- **`git remote set-url` with embedded credentials does NOT fix this** —
  `actions/checkout` with default `persist-credentials: true` stores
  `GITHUB_TOKEN` as an `http.extraheader` that is sent on every push and wins.
  The correct fix is `token: ${{ secrets.GH_PAT }}` on the `actions/checkout`
  step, so the persisted credential is a human-actor PAT from the start.
- For CLI operations, prefix with the PAT explicitly:
  `GH_TOKEN="${GH_PAT}" gh pr merge --auto --squash`.
- **After changing any self-healing workflow, verify push attribution with a
  live test**: create a draft PR with an *additive* failing test (additive so
  the net diff is non-zero), let the pipeline push its fix, and confirm new
  check runs appear with timestamps after the push. The failure mode is silent.

## YAML / expression parsing

- `if:` expressions must be on a single line — a `|` block scalar adds a
  trailing newline the parser silently rejects; the job is skipped, no error.
- Blank lines inside `run: |` blocks can terminate the block scalar — use
  `echo ""` for blank output lines.
- `~` does not expand inside double quotes — use `$HOME` (SC2088).
- Quote `$GITHUB_OUTPUT` / `$GITHUB_PATH` (SC2086).
- Consolidate consecutive `>> file` redirects with `{ cmd1; cmd2; } >> file`
  (SC2129).
- Run `actionlint` locally before pushing any workflow change — the CI feedback
  loop is 5+ minutes per iteration.

## Versions

- **Never use `latest` anywhere** — `version: latest` for tool installers makes
  a GitHub API call that rate-limits on busy runners; unpinned
  `npm install -g <pkg>` is non-deterministic. Pin exact versions everywhere,
  and update every referencing file when upgrading.
- Pin action versions with exact tags that actually exist (`@v1.7.7`, not a
  floating `@v1` that may not be a tag).

## Required checks & skipping

- **Never use workflow-level `paths-ignore` for a required check** — a workflow
  that never triggers creates no check run, so the required check sits
  "pending" forever and blocks the PR. Instead use a `detect-changes` job whose
  output gates the main job via `needs` + `if:` — a job skipped by a job-level
  `if:` still creates a (satisfying) "skipped" check run.

## Reusable workflows (`workflow_call`)

- In a called workflow, `github.workflow`, `github.run_id`, and most `github.*`
  context evaluate in the CALLER's context — identical for all workflows called
  in parallel. Using them alone as a concurrency key makes sibling workflows
  cancel each other. Add a hardcoded per-file suffix to the group key.
- Pass secrets with `secrets: inherit`.

## Dispatch & dedup patterns

- **Use `gh api repos/.../dispatches --method POST --input -` fed by `jq -n`**,
  not `actions/github-script` — github-script requires a `github-token` input
  and an empty secret silently drops the dispatch.
- `gh issue list --search` uses the full-text index which lags on new issues —
  use the plain list API (`--json number,title`) and filter locally with jq.
- Two triggers can fire for the same event (e.g. a webhook dispatch AND a bot
  opening an issue). Use a `concurrency` group with `cancel-in-progress: false`
  to queue, then guard the second run: re-fetch and rebase before pushing,
  check `git rev-list origin/main..HEAD --count` (0 → already fixed → skip
  push), check for an existing open PR on the same branch prefix, and search
  closed issues too before creating a new one.
- Rebase conflicts in an automated push path must be caught explicitly:
  `if ! git rebase ...; then git rebase --abort; comment; exit 0; fi` —
  otherwise the run fails with no explanation and the issue stays open.
- The "no changes made" path must still comment and close — a bare `exit 0`
  leaves issues permanently open.
- `gh issue create` has no `--json` — capture stdout and
  `grep -oE '[0-9]+$'` for the number.

## `|| true` usage rules

`|| true` suppresses both expected failures (label missing) and unexpected ones
(API error). The test: *if this command silently returns nothing, does the
workflow still do the right thing?*

- **Correct:** label add/remove, `grep` with legitimate no-match, cleanup
  commands, non-critical telemetry.
- **Wrong:** any command whose output drives a downstream decision;
  `gh pr merge --auto` (a silent failure means the PR never merges — capture
  the exit code and add a label/comment instead); safeguard steps whose failure
  lets bad state through.

## Prompt-driven workflow steps

- **Scope the Claude prompt to the specific error** and explicitly forbid
  modifying `.github/` — otherwise it "improves" workflow files instead of
  fixing the bug. Belt and braces: add a post-Claude safeguard step
  `git checkout origin/main -- .github/` (revert to `origin/main`, not `HEAD`,
  because the checked-out SHA may have older workflow versions).
- **Trace the full format round-trip** for any code that generates a prompt and
  parses the output: prompt-specified format → parser expectation → consumer
  expectation. State every parser assumption explicitly in the prompt.

## jq gotchas (test every filter with non-empty sample input)

- Precedence: `a | b, c` parses as `a | (b, c)` — parenthesise:
  `(.number | tostring)`.
- Null access: `select(.field | startswith("x"))` crashes on null — guard with
  `select(.field != null and (.field | startswith("x")))`.
- Test harness:
  `echo '[{"number":1,"headRefName":"feat/foo"}]' | jq '<filter>'`
