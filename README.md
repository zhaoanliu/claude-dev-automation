# claude-dev-automation

Reusable Claude-powered GitHub automation, extracted from the
[job-tracker](https://github.com/zhaoanliu/job-tracker) project: composite
actions for running Claude Code in CI, self-healing workflow templates
(Sentry auto-fix, CI/CD self-healing, a design→implement feature factory),
and an operating playbook for Claude-assisted repos.

## Versioning

This repo is shared by multiple projects and is **consumed by exact semver
tag** — never by branch, never `@main`, never a floating major tag.

- Consumers reference actions as
  `uses: zhaoanliu/claude-dev-automation/actions/<name>@v2.0.0` (the current
  tag — see Releases).
- Published tags are immutable — never moved or deleted. Fixes ship as a new
  tag (`v1.0.1`); breaking interface changes (renamed inputs, changed file
  contracts, changed dispatch event names) bump the major (`v2.0.0`).
- Changing anything here does not affect consumers until they deliberately
  bump their pinned tag. Develop freely on `main` for the next project;
  tagged history protects the previous ones.
- Workflow *templates* are copied into consumer repos and adapted, so they
  version by copy, not by tag — a consumer's copied workflow keeps working
  regardless of what happens here. Only the `actions/` (and the scripts they
  delegate to, which travel with the tag) are consumed live.
- The repo is **public** — required because consumers include public repos
  (job-tracker), and GitHub only lets *private* same-owner repos use actions
  from a private repo. Everything here was extracted from the already-public
  job-tracker repo, so nothing new is exposed. Never commit secrets or
  project-internal details here.

## Layout

```
actions/             # composite actions — consume via pinned tag, or vendor into .github/actions/
  run-claude/        # claude -p with retry (delegates to scripts/run-claude-retry.sh)
  install-claude/    # pinned CLI install + instrumented wrapper (model injection, cost summary, optional telemetry)
  open-fix-pr/       # commit → branch → PR with risk-gated auto-merge → issue comment
  check-existing-pr/ # dedup guard: skip if an open PR already exists for the issue
  mark-in-progress/  # label state transition helper
  detect-doc-only/   # doc-only PR short-circuit (job-level, required-check-safe)
  trigger-ci-failure/# repository_dispatch on CI failure (feeds ci-auto-fix)
  supabase-start/    # STACK MODULE (Supabase): supabase start with retries on transient failures
  verify-ac/         # generate + run acceptance-criteria E2E tests, self-heal on failure
                     #   (project specifics — spec rules, validation, backing stack — are inputs)
  check-ac-coverage/ # CI gate: every AC item needs an [AC-N-N]-tagged passing test
scripts/             # travel with the tag — pinned actions resolve them relatively
  run-claude-retry.sh    # canonical 529/overload retry loop (also exposed as
                         #   install-claude's retry-script output for inline loops)
  check-ac-coverage.mjs  # the script behind actions/check-ac-coverage
workflow-templates/  # copy into .github/workflows/ and adapt the marked spots
  bug-fix.yml              # `bug`-labeled issue → Claude fix → risk-gated PR
  sentry-auto-fix.yml      # Sentry alert → issue → Claude fix → PR; resolves Sentry on close
  ci-auto-fix.yml          # CI failure → log analysis → fix pushed to PR branch / PR to main
  cd.yml                   # CI gate → deploy (Vercel; optional migrations); failure dispatches
  cd-filter.yml            # Vercel deployment_status → cd-failure dispatch (Production only)
  cd-monitor.yml           # catch-all for CD startup failures / dropped dispatches
  cd-auto-fix.yml          # deploy failure → reproduce → classify infra/code → fix or file issue
  db-fix.yml               # OPTIONAL (Supabase): migration failure → constrained fix, never auto-merge
  feature-design.yml       # Phase 1: approved issue → design spec with machine-readable plan
  feature-implement.yml    # Phase 2: plan → subtask loop → AC-tagged tests → verified PR
  feature-verify.yml       # manual AC re-verification for an existing PR
  rebase-conflicting-prs.yml  # push to main → rebase all conflicting PRs, Claude resolves markers
  FEATURE-PIPELINE.md      # the feature-factory system doc: label flow, contracts, adoption checklist
integrations/
  sentry-webhook/          # Next.js route bridging Sentry alerts → repository_dispatch + SETUP.md
playbook/            # process knowledge — copy and adapt
  CLAUDE-starter.md          # starter CLAUDE.md: worktree workflow, no-duplication, testing rules
  github-actions-pitfalls.md # hard-won CI lessons (token attribution, YAML traps, jq gotchas)
  commands/                  # slash commands: ship, implement, open-issue, report-bug
  hooks/session-start.sh     # pull main + prune merged-PR worktrees on session start
  settings.json              # hook wiring for .claude/settings.json
```

## Adopting in a new repo

1. **Reference the actions by pinned tag** (recommended):
   `uses: zhaoanliu/claude-dev-automation/actions/<name>@v2.0.0`. Nothing needs
   vendoring — cross-repo composite actions check out this whole repo into the
   action path, so `scripts/` travels with the tag (verify-ac and
   check-ac-coverage resolve their scripts relatively; workflows with inline
   Claude loops use `install-claude`'s `retry-script` output). Vendoring into
   `.github/actions/` still works if you prefer it (copy `scripts/` to
   `.github/scripts/` alongside).
2. **Copy the workflow templates** you want into `.github/workflows/` and
   adapt the spots marked `# ADAPT:` in each file (labels, base branch,
   local-CI commands, deploy config). For the feature factory, read
   `workflow-templates/FEATURE-PIPELINE.md` first.
3. **Sentry**: copy `integrations/sentry-webhook/route.ts` into your app and
   follow `integrations/sentry-webhook/SETUP.md`.
4. **Secrets**: `ANTHROPIC_API_KEY`, and `GH_PAT` — a classic PAT with `repo`
   scope belonging to a human account. The PAT is load-bearing, not a
   convenience: pushes and merges made with `GITHUB_TOKEN` are attributed to
   `github-actions[bot]` and GitHub silently suppresses the CI triggers they
   should cause (see `playbook/github-actions-pitfalls.md`).
5. **Repo settings**: Actions → allow GitHub Actions to create and approve
   pull requests; General → allow auto-merge; branch protection on `main`
   with your required checks.
6. **Playbook**: start your `CLAUDE.md` from `playbook/CLAUDE-starter.md`,
   copy `playbook/commands/` into `.claude/commands/`, and wire the
   session-start hook via `playbook/settings.json` → `.claude/settings.json`.

## Stack modules

The core actions and templates are stack-agnostic. Per-stack assets live in
the same menu, clearly labeled — projects that don't use the stack simply
never reference them:

- **Supabase**: `actions/supabase-start`, `workflow-templates/db-fix.yml`,
  `install-claude`'s optional PostgREST telemetry sink
- **Vercel**: `workflow-templates/cd*.yml`
- **Sentry**: `workflow-templates/sentry-auto-fix.yml`, `integrations/sentry-webhook/`

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
- **Workflows wire together via `repository_dispatch` event names**
  (`sentry-issue`, `ci-failure`, `cd-failure`, `db-failure`). Keep them
  consistent between sender and receiver when adapting.
- **Everything is pinned** — CLI version, action tags, tool versions. Never
  `latest` (rate limits + non-determinism).
- **This repo governs itself** — changes follow the issue → worktree → PR
  workflow in `CLAUDE.md`; every PR runs `validate.yml` (static: actionlint,
  YAML parse, shellcheck, node --check) and `test-actions.yml` (behavioral:
  stub-based tests of the actions, no API spend), and `main` is
  branch-protected on both. Every tag traces to a merged PR, so every tag is
  behavior-tested before a consumer can pin it.

## Provenance

Extracted 2026-07 from the job-tracker automation stack, which is itself
pinned to this repo's tags as consumer #1. The pitfalls doc distills that
repo's `.github/CLAUDE.md` and postmortems.
