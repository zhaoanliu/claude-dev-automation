# claude-dev-automation — Claude Code Instructions

Shared library of Claude-powered GitHub automation, consumed by multiple
projects via pinned tags (job-tracker is consumer #1). Changes here become the
next tag — treat `main` as the staging area for releases, not a scratchpad.

## Git workflow

**`main` is read-only. Never edit or commit files directly on `main`.**

Before the first Edit or Write call in any session: (1) create an issue,
(2) create a worktree. The three steps in order:

1. `gh issue create` with a clear, plain-text title. Add `status: in progress`
   if implementing immediately in the same session.
2. `git worktree add ../claude-dev-automation-N -b <branch> origin/main` —
   base on `origin/main`; do all work inside the worktree. Branch naming:
   `feat/issue-N-<slug>`, `fix/issue-N-<slug>`, `docs/issue-N-<slug>`.
3. Open a PR titled `<issue title> (#N)` with `Closes #N` in the body.

Never use `cd /path && <command>` — use `git -C /abs/path` and absolute paths.
Never hardcode local absolute paths in committed files.

## Versioning and releases

- Consumers pin **exact, immutable tags**: `@v1.1.0`. Never move or delete a
  published tag. Never tell a consumer to reference `@main`.
- Fixes → patch tag; new assets → minor tag; interface changes (renamed
  inputs, changed file contracts like `/tmp/risk.txt`, changed
  `repository_dispatch` event names) → major tag.
- Release procedure: merge to `main` → `git tag -a vX.Y.Z -m "..."` → push
  tag → `gh release create vX.Y.Z` with notes stating whether it is a drop-in
  upgrade. Every tag must trace to a merged PR and its issue.
- Consumers upgrade deliberately: bump the pin in *their* repo (grep for
  `claude-dev-automation/actions`), verify their CI, merge.

## Content rules

- **This repo is public and must stay generic.** Never commit secrets,
  consumer-project names in code paths, personal directory structure, or
  project-internal details. Consumer-specific behavior goes through action
  inputs or `# ADAPT:` markers in templates — never hardcoded.
- **Actions version by tag; templates version by copy.** Actions must keep
  small, stable input surfaces. If making something reusable would require a
  dozen inputs or a prose-prompt parameter, ship it as a vendor-and-adapt
  template (like `verify-ac`) instead of a pinned action.
- Stack-specific assets (Supabase, Vercel, Sentry) are welcome but must be
  clearly labeled in the README's "Stack modules" section. The core stays
  stack-agnostic.
- The canonical Claude retry loop is `scripts/run-claude-retry.sh`;
  `run-claude` delegates to it via `$GITHUB_ACTION_PATH/../../scripts` —
  that relative path must keep working both cross-repo and vendored into
  `.github/`. Never inline a second copy of the retry loop.
- `# ADAPT:` markers are part of the product: when editing a template, keep
  adaptation points explicit and mark new ones.

## Validation

CI (`.github/workflows/validate.yml`) runs on every PR: actionlint on
workflows and templates, YAML parse on every `actions/*/action.yml`,
shellcheck on shell scripts, `node --check` on `.mjs` scripts. Run the same
checks locally before pushing:

```bash
actionlint .github/workflows/*.yml
TMP=$(mktemp -d) && cp workflow-templates/*.yml "$TMP"/ && actionlint "$TMP"/*.yml
for f in actions/*/action.yml; do ruby -ryaml -e "YAML.load_file('$f')"; done
shellcheck scripts/*.sh playbook/hooks/*.sh
node --check scripts/check-ac-coverage.mjs
```

Templates must be linted from a copy outside the repo: in repo context
actionlint follows `cd.yml`'s `uses: ./.github/workflows/<ci>.yml` ADAPT
examples, which only exist in consumer repos.

Follow `playbook/github-actions-pitfalls.md` when editing anything under
`.github/` or `workflow-templates/` — this repo's own content documents the
traps (pin exact versions, no `latest`, `|| true` discipline, jq testing).

## Docs

After every change, check whether README.md (layout, stack modules, adoption
steps) needs updating and update it in the same commit. When editing
CLAUDE.md, grep for related notes first and remove anything superseded.
