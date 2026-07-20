# Feature pipeline: design → implement → verify

A label-driven "feature factory": a feature issue moves through a design phase
(Claude researches the codebase and writes a reviewable design spec), a human
review gate, and an implement phase (Claude executes the pre-planned subtasks,
verifies acceptance criteria with generated Playwright tests, and opens a PR).
Acceptance criteria stay enforced after the PR opens via a CI coverage gate.

## Components

| File | Role |
|---|---|
| `workflow-templates/feature-design.yml` | Phase 1 — generate design issue #Y from feature issue #X |
| `workflow-templates/feature-implement.yml` | Phase 2 — implement #Y as subtasks, verify ACs, open PR |
| `workflow-templates/feature-verify.yml` | Manual re-run of AC verification against an open feature PR |
| `actions/verify-ac/action.yml` | Composite action: generate + run Playwright AC tests, 2-attempt self-heal — consumed by pin; project specifics are inputs |
| `actions/check-ac-coverage/action.yml` | Composite action wrapping check-ac-coverage.mjs — consumed by pin |
| `scripts/run-claude-retry.sh` | Canonical `claude -p` retry loop (529/overload backoff) — travels with the tag; inline loops reach it via install-claude's `retry-script` output |
| `scripts/check-ac-coverage.mjs` | CI gate: every AC item must have a passing `[AC-N-N]`-tagged test |

## Label state machine

```
#X (feature issue)                      #Y (design issue)
──────────────────                      ─────────────────
status: approved      ──design phase──▶ created with labels:
        │                               `user review required`, `implementation`
        ▼                               body contains AC checklist +
status: design-review                   <!-- implementation-plan-json --> block
        │
   (human reviews / edits #Y)
        │
status: auto-implement ──implement──▶   #Y gets `status: in progress`;
        │                               Step checkboxes ticked per subtask;
        ▼                               AC checkboxes ticked when verify-ac passes
status: in progress
        │
        ▼
PR opened: "Closes #X" + "Closes #Y" — merging closes both
```

- `status: approved` on #X → feature-design.yml runs, swaps it to
  `status: design-review`, creates #Y (or links an existing spec).
- `status: auto-implement` on #X (or on #Y directly — the workflows route in
  both directions via the `implementation` label) → feature-implement.yml runs.
- Adding `status: auto-implement` without going through the design phase skips
  straight to implementation with no design spec (monolithic fallback).
- Failure labels: `needs-acceptance-testing` on the PR when AC verification
  fails after 2 self-heal attempts; `manual merge required` on every feature PR
  (a human always merges); `user review required` back on #X if design
  generation produced nothing.

## Cross-linking conventions (exact strings — the workflows grep for them)

| String | Where | Meaning |
|---|---|---|
| `Technical tracking: #N` | body of #X (never a comment) | manually pre-paired spec issue |
| `<!-- design-issue: N -->` | comment on #X | posted by feature-design.yml after creating #Y |
| `See user-facing issue: #N` | body of #Y | back-reference so labeling #Y routes to #X |
| `Design for feature request #N` | body of #Y | Phase-1-generated back-reference |

## The implementation-plan-json contract

feature-design.yml makes Claude emit, inside #Y's `## Implementation plan`
section, both a machine-readable block and human-editable checkboxes:

```markdown
<!-- implementation-plan-json
[
  {"id":1,"title":"...","scope":"...","files_to_create":[],"files_to_modify":[],
   "test_file":"__tests__/...","estimated_turns":10,"ac_items":[1,2]}
]
-->

- [ ] **Step 1: <title>** (~10 turns) — <scope summary>
```

Rules:
- Each object's `id` must equal the `Step N:` number — the implement workflow
  ticks `- [ ] **Step N:` → `- [x]` as each subtask's validation passes.
- `estimated_turns` ≤ 25 (the implement loop runs Claude with
  `estimated_turns + 12` max turns per subtask).
- `ac_items` lists the 1-based AC positions whose tests that step writes. AC
  items left unassigned get an auto-appended final "Write AC-tagged tests"
  subtask.
- If no plan JSON exists (manually written spec), feature-implement.yml runs
  Claude at runtime to plan the subtasks; if that also fails it falls back to a
  monolithic 3-attempt implementation.
- `check-ac-coverage.mjs` recognizes design issues by the literal marker
  `<!-- implementation-plan-json -->` in the body.

## The AC-tag contract

- #Y's `## Acceptance criteria` section is a checkbox list; the design workflow
  rewrites `**N.**` placeholders to `[AC-{#Y}-{N}]` tags after the issue is
  created (N = 1-based position).
- Every covering test's `it()`/`test()` description must contain the tag:
  `it('saves entry to database [AC-88-1]', ...)`.
- Unit tests and E2E specs are both valid coverage; E2E-only coverage sets
  `needs_e2e=true` so CI can require an E2E run.
- Never tag a test that does not genuinely verify the criterion — that hides
  missing coverage.
- The verify-ac action additionally generates a throwaway Playwright spec
  (`e2e/ac_verify.spec.ts`, one `test()` per criterion) at implement time, runs
  it against a locally running app, and self-heals the implementation on
  failure (max 2 attempts, strict-mode violations fix the test instead). The
  generated spec is deleted afterwards — it is never committed.

## Wiring check-ac-coverage into CI

Run it on every PR after the unit-test suite, with a JSON reporter output:

```yaml
      - run: npx vitest run --reporter=json --outputFile=test-results.json

      - name: Check AC coverage
        id: ac_check
        uses: zhaoanliu/claude-dev-automation/actions/check-ac-coverage@v2.0.0
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          pr-number: ${{ github.event.pull_request.number }}
```

The job needs `permissions: issues: write` (it checks off passing AC items in
#Y). Optionally gate an E2E suite on the `needs_e2e` output:

```yaml
  run-e2e:
    needs: detect
    if: needs.detect.outputs.needs_e2e == 'true'
    uses: ./.github/workflows/your-e2e-workflow.yml

  # Always reports a status so branch protection is always satisfied:
  # pass when detect succeeded and run-e2e was skipped or passed.
  e2e-ac:
    needs: [detect, run-e2e]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - run: |
          [[ "${{ needs.detect.result }}" == "success" ]] || exit 1
          [[ "${{ needs.run-e2e.result }}" != "failure" && "${{ needs.run-e2e.result }}" != "cancelled" ]] || exit 1
```

## Required secrets

| Secret | Used by | Why |
|---|---|---|
| `ANTHROPIC_API_KEY` | all three workflows, verify-ac | Claude runs |
| `GH_PAT` (repo scope) | feature-implement, feature-verify | PR creation and PR-branch pushes must be attributed to a human actor — `GITHUB_TOKEN`-attributed pushes silently suppress PR-triggered CI |
| `GITHUB_TOKEN` (built in) | everywhere else | issue reads/edits/comments |

## Adoption checklist

1. Copy `feature-design.yml`, `feature-implement.yml`, `feature-verify.yml`
   into `.github/workflows/`.
2. Get the composite actions. `install-claude`, `run-claude`,
   `check-existing-pr`, `mark-in-progress` — recommended: replace each
   `./.github/actions/<name>` reference with
   `zhaoanliu/claude-dev-automation/actions/<name>@v2.0.0` (exact tag);
   alternative: vendor into `.github/actions/` (then also vendor `scripts/`
   to `.github/scripts/`). `verify-ac` and `check-ac-coverage` are consumed
   by pin — since v2.0.0 everything project-specific about verify-ac
   (spec-rules, validation-commands, optional setup/teardown-commands) is an
   input filled in at the templates' `# ADAPT:` markers; nothing needs
   vendoring, and `scripts/` travels with the tag.
3. Wire `check-ac-coverage` into your PR test workflow (snippet above).
4. Work through every `# ADAPT:` marker: dependency install, lint/typecheck/
   test commands, test-directory conventions (`__tests__/`, `e2e/`), the
   verify-ac inputs (Playwright helper rules, baseURL, validation commands,
   optional local backing stack), and the design prompt's domain-specific
   research guidance.
5. Create labels: `status: approved`, `status: design-review`,
   `status: auto-implement`, `status: in progress`, `status: planned`,
   `status: backlog`, `implementation`, `user review required`,
   `manual merge required`, `needs-acceptance-testing`.
6. Secrets: `ANTHROPIC_API_KEY`, `GH_PAT`.
7. Repo settings: allow GitHub Actions to create pull requests; branch
   protection on `main` with your required checks (include the AC coverage
   job).
8. Dry-run: open a small feature issue, add `status: approved`, review the
   generated #Y, then add `status: auto-implement` and watch the PR appear.
