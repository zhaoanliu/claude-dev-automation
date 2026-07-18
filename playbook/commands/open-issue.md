Create a GitHub issue for future tracking or automated bot implementation.

Usage: /open-issue <title> [--auto-implement]

Adapt before use: the `status: auto-implement` path assumes a feature-implement bot workflow listening for that label; without one, both paths just create a labeled issue.

Steps:
1. Parse $ARGUMENTS. Check if `--auto-implement` is present anywhere in the string; if so, set `has_auto=true` and strip `--auto-implement` from the title (trim whitespace).
2. If no title remains after stripping, ask the user for one.
3. Create the issue:
   - If `has_auto`:
     - Labels: `status: auto-implement`
     - Command: `gh issue create --title "<title>" --label "status: auto-implement"`
     - Note: the implement bot will pick this up automatically and open a PR.
   - Else:
     - Labels: `status: backlog`
     - Command: `gh issue create --title "<title>" --label "status: backlog"`
4. Report the issue URL and number to the user.
