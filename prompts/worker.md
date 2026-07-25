# Task brief — issue #{{issueNumber}}: {{issueTitle}}

## Issue body

{{issueBody}}

## Acceptance criteria

{{acceptanceCriteria}}

## Effort profile: {{effortProfile}}

## Constraints — non-negotiable

- Diff size ceiling: **{{maxDiffLines}} lines**. A smaller correct diff beats a bigger speculative
  one — stay under the ceiling or your PR will be rejected before any review happens.
- Never touch these paths, under any circumstances: {{forbiddenPaths}}
- Commit in **Conventional Commits** format. One logical unit of work per commit.
- Do **not** push to the default branch (`{{defaultBranch}}`). Work happens only on this branch.
- Do not merge anything, do not open a second PR, do not modify CI or release configuration.
- Before your final response, run `git status --short`. If you changed files, stage and commit them
  before responding. A final response with dirty or staged-but-uncommitted changes is a failed run.
- If you intentionally make no changes, say exactly why no commit is needed.

## Repo conventions

This repo already documents its own conventions — read them, don't ask for them to be restated:

- `{{handoffPath}}` — current project state, architecture, and key decisions.
- `{{instructionsGlob}}` — coding, naming, and process rules that apply here.

## Round context

{{roundContext}}
