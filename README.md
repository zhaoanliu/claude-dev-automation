# claude-dev-automation

Reusable Claude-powered GitHub automation, extracted from the
[job-tracker](https://github.com/zhaoanliu/job-tracker) project: composite
actions for running Claude Code in CI, self-healing workflow templates, and an
operating playbook for Claude-assisted repos.

## Layout

```
actions/             # composite actions — vendor into .github/actions/ or reference cross-repo
  run-claude/        # claude -p with exponential-backoff retry on 529/overload
  install-claude/    # pinned CLI install + instrumented wrapper (model injection, cost summary, optional telemetry)
  open-fix-pr/       # commit → branch → PR with risk-gated auto-merge → issue comment
  check-existing-pr/ # dedup guard: skip if an open PR already exists for the issue
  mark-in-progress/  # label state transition helper
  detect-doc-only/   # doc-only PR short-circuit (job-level, required-check-safe)
  trigger-ci-failure/# repository_dispatch on CI failure (feeds a self-healing workflow)
workflow-templates/  # copy into .github/workflows/ and adapt the marked spots
  bug-fix.yml        # `bug`-labeled issue → Claude fix → risk-gated PR
  rebase-conflicting-prs.yml  # push to main → rebase all conflicting PRs, Claude resolves markers
playbook/            # process knowledge — copy and adapt
  CLAUDE-starter.md          # starter CLAUDE.md: worktree workflow, no-duplication, testing rules
  github-actions-pitfalls.md # hard-won CI lessons (token attribution, YAML traps, jq gotchas)
  commands/                  # slash commands: ship, implement, open-issue, report-bug
  hooks/session-start.sh     # pull main + prune merged-PR worktrees on session start
  settings.json              # hook wiring for .claude/settings.json
```

## Adopting in a new repo

1. **Vendor the actions**: copy `actions/*` into your repo's
   `.github/actions/`. (Once this repo is public you can instead reference
   `zhaoanliu/claude-dev-automation/actions/<name>@<tag>` directly — GitHub
   cannot resolve `uses:` into a private personal repo.)
2. **Copy the workflow templates** you want into `.github/workflows/` and
   adapt the spots marked in each file's header comment (labels, base branch,
   local-CI commands).
3. **Secrets**: `ANTHROPIC_API_KEY`, and `GH_PAT` — a classic PAT with `repo`
   scope belonging to a human account. The PAT is load-bearing, not a
   convenience: pushes and merges made with `GITHUB_TOKEN` are attributed to
   `github-actions[bot]` and GitHub silently suppresses the CI triggers they
   should cause (see `playbook/github-actions-pitfalls.md`).
4. **Repo settings**: Actions → allow GitHub Actions to create and approve
   pull requests; General → allow auto-merge; branch protection on `main`
   with your required checks.
5. **Playbook**: start your `CLAUDE.md` from `playbook/CLAUDE-starter.md`,
   copy `playbook/commands/` into `.claude/commands/`, and wire the
   session-start hook via `playbook/settings.json` → `.claude/settings.json`.

## Design notes

- **Risk-gated auto-merge**: Claude self-assesses each fix as `low`/`high`
  risk; `open-fix-pr` auto-merges only when risk is low AND the diff is ≤2
  files / ≤20 lines (both thresholds are inputs). Everything else waits for
  human review. Draft PRs are used when local CI could not be made to pass.
- **`install-claude` wrapper**: call sites just run
  `claude --max-turns N -p "..."` — the wrapper injects
  `--dangerously-skip-permissions --model $CLAUDE_MODEL --output-format json`,
  extracts result text so `| tee`/grep patterns work, appends a cost line to
  the step summary, and optionally POSTs run telemetry to any
  PostgREST-compatible table.
- **Everything is pinned** — CLI version, action tags, tool versions. Never
  `latest` (rate limits + non-determinism).

## Not (yet) extracted

Larger job-tracker systems that are reusable but need per-project adaptation
before they can live here as templates:

- **Sentry auto-fix pipeline** (`auto-fix.yml` + webhook bridge + resolve-on-close)
- **CI self-healing** (`ci-auto-fix.yml` — log fetch → Claude fix → push to PR branch)
- **CD self-healing state machine** (deploy failure → reproduce → classify infra/code → fix or file issue → auto-close)
- **Feature factory** (design issue with machine-readable plan JSON →
  subtask-by-subtask implementation → acceptance-criteria verification with
  `[AC-N-N]`-tagged tests)

## Provenance

Extracted 2026-07 from the job-tracker automation stack. The pitfalls doc
distills that repo's `.github/CLAUDE.md` and postmortems.
