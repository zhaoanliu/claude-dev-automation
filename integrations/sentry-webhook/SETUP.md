# Sentry auto-fix pipeline — setup

End-to-end flow:

1. A Sentry alert fires and POSTs to `/api/sentry-webhook` on your app.
2. `route.ts` (this directory) verifies the HMAC signature and sends a
   `repository_dispatch` (`event_type: sentry-issue`) to your GitHub repo.
3. `workflow-templates/sentry-auto-fix.yml` finds or creates a matching GitHub
   issue, fetches the full Sentry event, runs Claude to fix the bug, and opens
   a risk-gated PR (low-risk → auto-merge; high-risk → human review).
4. Merging the PR closes the issue (`Closes #N`), which triggers the
   `resolve-sentry-on-close` job to resolve the Sentry issue via API.

## 1. Install the pieces

- Copy `route.ts` to `app/api/sentry-webhook/route.ts` in your Next.js app.
- Copy `workflow-templates/sentry-auto-fix.yml` to `.github/workflows/` and
  get the composite actions (`install-claude`, `run-claude`,
  `check-existing-pr`, `mark-in-progress`, `open-fix-pr`) — recommended:
  replace each `./.github/actions/<name>` reference with
  `zhaoanliu/claude-dev-automation/actions/<name>@v2.0.0` (exact tag);
  alternative: vendor them from `actions/` into `.github/actions/`.
- Adjust the `# ADAPT:` markers in the workflow (dependency install, local CI
  commands, project-specific prompt constraints).

## 2. Sentry configuration

1. Sentry → Settings → Developer Settings → **New Internal Integration**:
   - Webhook URL: `https://your-app.example.com/api/sentry-webhook`
   - Enable **Alert Rule Action**
   - Permissions: **Issue & Event: Read & Write**
   - Copy the generated **Client Secret** — this is `SENTRY_WEBHOOK_SECRET`
   - Copy a generated **token** — this is the `SENTRY_AUTH_TOKEN` for GitHub
     Actions (see scopes note below)
2. Alerts → create (or edit) an issue alert rule and add the internal
   integration as a **notification action**, so alert triggers hit the webhook.

## 3. Secrets

Two different places, two different `SENTRY_AUTH_TOKEN` meanings — do not mix
them up:

**Deploy platform (e.g. Vercel) — used by `route.ts`:**

| Env var | Value |
|---|---|
| `GITHUB_REPO` | `OWNER/REPO` to dispatch to |
| `GH_PAT` | GitHub PAT with `repo` scope |
| `SENTRY_WEBHOOK_SECRET` | Client Secret of the Sentry internal integration |

**GitHub Actions secrets — used by the workflow:**

| Secret | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude Code |
| `GH_PAT` | GitHub PAT with `repo` scope (human actor — see note below) |
| `SENTRY_AUTH_TOKEN` | Sentry token with **Issue & Event: Read & Write** |

Scopes gotcha: the Actions `SENTRY_AUTH_TOKEN` (Issue & Event: Read & Write —
fetch events, resolve issues) is **not** the same token as a source-map-upload
token (which needs `project:releases`). If you also upload source maps at build
time, keep them as two separate tokens; reusing one silently breaks the other
use case.

Why `GH_PAT` and not `GITHUB_TOKEN`: actions performed with `GITHUB_TOKEN` are
attributed to `github-actions[bot]`, and GitHub suppresses workflow triggers
caused by that actor — a bot-merged PR would close the issue without ever
firing the `issues: closed` event, so Sentry would never be resolved. The PAT
makes the merge/close a human-actor event.

## 4. GitHub repo settings

Required for auto-merge and branch protection to work:

- Settings → Actions → General → enable **"Allow GitHub Actions to create and
  approve pull requests"**
- Settings → General → enable **"Allow auto-merge"**
- Settings → Branches → add a branch protection rule for `main`: no direct
  pushes, **"Require status checks to pass before merging"**, and add your
  required CI checks. Low-risk auto-merge PRs only merge after these pass.
  Do not add slow async jobs (e.g. nightly E2E) as required checks.

## 5. Test the pipeline

Test the workflow directly — do not trigger a live crash end-to-end:

```bash
gh api repos/OWNER/REPO/dispatches \
  --method POST \
  -f event_type=sentry-issue \
  -f 'client_payload[title]=TypeError: your error here' \
  -f 'client_payload[sentry_url]=https://sentry.io/organizations/ORG/issues/ISSUE_ID/' \
  -f 'client_payload[culprit]=/affected-route'
```

Then watch with `gh run list --limit 3`. This takes seconds vs. triggering a
live crash (5+ minutes of webhook latency, plus you must resolve the Sentry
issue each time to re-trigger). Only test the full Sentry → webhook → dispatch
path when verifying the webhook route itself.

## Deduplication behaviour (why the workflow looks paranoid)

When an alert fires, **two** triggers arrive at almost the same time: the
webhook's `repository_dispatch` AND `sentry[bot]` opening a GitHub issue
(third-party apps are not subject to the `github-actions[bot]` trigger
suppression). The workflow handles this with:

- A concurrency group (`cancel-in-progress: false`) that queues runs instead
  of letting them race.
- Issue matching by **title** via the REST list API — not `--search` (the
  search index lags on fresh issues) and not by URL/ID (the webhook and
  sentry[bot] use different Sentry URL formats).
- Open-issue search only for the primary match — sentry[bot] always opens a
  fresh issue per alert, so matching closed issues risks reopening old ones.
- A **closed-issue check** before creating a new issue — a queued run that
  starts after the first run already merged and closed the issue must skip,
  not re-fix already-fixed code.
- A **duplicate-PR guard** — if an open PR on a `fix/issue-N-` branch already
  exists for the matched issue, the run skips before invoking Claude.
- `replay_hydration_error` skip — these Sentry issues have no stack trace
  (browser-extension DOM tampering) and are auto-closed with a comment
  instead of burning Claude turns.
