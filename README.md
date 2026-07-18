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
  `uses: zhaoanliu/claude-dev-automation/actions/<name>@v1.0.0`.
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
- The repo is private; other repos owned by the same user can still use its
  actions because the Actions access policy is set to `user`
  (`gh api -X PUT repos/zhaoanliu/claude-dev-automation/actions/permissions/access -f access_level=user`).

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
  verify-ac/         # generate + run acceptance-criteria E2E tests, self-heal on failure
scripts/
  run-claude-retry.sh    # canonical 529/overload retry loop (vendor to .github/scripts/)
  check-ac-coverage.mjs  # CI gate: every AC item needs an [AC-N-N]-tagged passing test
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
   `uses: zhaoanliu/claude-dev-automation/actions/<name>@v1.0.0`.
   Vendoring into `.github/actions/` also works (copy `scripts/` to
   `.github/scripts/` alongside — `run-claude` and `verify-ac` resolve the
   retry script relatively and work in both layouts).
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

## Provenance

Extracted 2026-07 from the job-tracker automation stack, which is itself
pinned to this repo's tags as consumer #1. The pitfalls doc distills that
repo's `.github/CLAUDE.md` and postmortems.
