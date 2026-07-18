Create a GitHub feature issue, implement it on a branch, and open a PR.
Runs Claude in the current session — for async bot implementation use `/open-issue <title> --auto-implement` instead (requires the feature-implement bot workflow).

Usage: /implement <title> — optionally followed by a description after a newline

Adapt before use: label names (`status: in progress`) and title prefixes to your repo's vocabulary.

Steps:
1. Parse the title from $ARGUMENTS (first line). Use remaining lines as the issue body if present.
2. Create the GitHub issue:
   - Labels: `status: in progress`
   - Command: `gh issue create --title "<title>" --label "status: in progress" [--body "<body>"]`
   - Capture the issue number from the URL printed to stdout.
3. Create a worktree based on the latest remote main: `git worktree add ../<repo>-<N> -b feat/issue-<N>-<slug> origin/main` where `<slug>` is the title lowercased with spaces replaced by hyphens, trimmed to ~30 chars. Do all subsequent work inside the worktree.
4. Implement the feature following project conventions (see CLAUDE.md):
   - No comments unless the WHY is non-obvious
   - Write or update tests for the new behaviour
   - Update README.md if the feature is user-visible
5. Run the project's coverage/test command before committing.
6. Commit all changes: `git add <files> && git commit -m "feat: <title> (closes #<N>)"`
7. Push the branch: `git push -u origin feat/issue-<N>-<slug>`
8. Open a draft PR whose title matches the issue title plus the issue number:
   ```
   gh pr create \
     --draft \
     --title "<title> (#<N>)" \
     --body "Closes #<N>" \
     --base main
   ```
9. Report the PR URL to the user.
