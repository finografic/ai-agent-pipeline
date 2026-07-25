# Project — Handoff

> **How to maintain this file**
> Update after sessions that change architecture, add/remove features, resolve open questions, or shift priorities — not every session.
> — Update only the sections that changed. Keep the total under 150 lines.
> — Write in present tense. No code snippets — describe what exists, not how it works.
> — `.agents/memory.md` = chronological working memory / session log. `.agents/handoff.md` = current project state snapshot. See `docs/process/PROJECT_MEMORY_MODEL.md`.

## Project

A standalone Bun/TypeScript CLI that takes a human-approved GitHub issue on a target repo
(currently `finografic/llaab`), hands it to an AI coding agent CLI in an isolated git worktree, and
opens a draft PR — then gates that PR with a free deterministic check (R0) and a free local-model
contract review (R1) before it needs human attention. Design rationale lives in
`docs/AGENT_PIPELINE_PROPOSAL.md`; the build brief that scoped Phase 0/1 is
`docs/todo/DONE_AGENT_PIPELINE_SETUP.md`.

## Architecture

Full Bun — own `package.json`/`bun.lock`, `bun test`, `Bun.$` for every subprocess/git/gh call, no
build step (the CLI runs `.ts` directly via a `#!/usr/bin/env bun` shebang, `bin` in `package.json`
points straight at `src/cli.ts`). Not a published library — no `main`/`module`/`exports`; installed
locally via `bun link`. `src/cli.ts` is the orchestration hub for all five commands
(`doctor|run|gate|status|abort`) and imports: `config.ts` (zod-validated `pipeline.config.ts`),
`github.ts` (thin `gh` CLI wrapper, everything scoped with an explicit `-R` so it never depends on
cwd), `worktree.ts` (git worktree create/resume/destroy, always against a repo path passed in —
never this repo), `claim.ts` (the WIP-limit + `agent:ready` check, extracted so it's unit-testable
without a real `gh`), `workers/` (a `Worker` interface plus `claude-code`/`codex`/`opencode`
subprocess adapters sharing one timeout/process-tree-kill/logging runner), `reviewers/` (`r0-gate.ts`
deterministic, `r1-contract.ts` local-model via `llm/local.ts`'s minimal Ollama client),
`telemetry.ts` (JSONL per stage, `telemetry/<date>.jsonl`, gitignored), and `brief.ts` +
`prompts/*.md` (template rendering for the worker brief and R1's prompt).

## Status

Phase 0 and Phase 1 (per the build brief) are both implemented, typecheck/lint/format clean, and
covered by 37 `bun:test` tests (config validation, all six R0 checks, R1 JSON parsing including
the malformed/retry/escalation paths via a mocked Ollama client, worktree lifecycle against a
disposable fixture repo including round-retry commit-detection, WIP-limit enforcement). The CLI is
linked (`bun link`) — `~/.bun/bin/pipeline` resolves globally.

**First real end-to-end `run` + `gate` happened 2026-07-25**, against `finografic/llaab#1`/`#2` —
opencode produced a real commit and a real draft PR. It surfaced and fixed three real bugs (see Key
Decisions). LLAAB's `master` CI baseline was broken (pre-existing, unrelated formatting drift) and
then fixed same-day on the LLAAB side; once the PR's branch picked up that fix, R0 passed and **R1
ran for real for the first time all session** (previously always short-circuited by R0 failing
first), giving a legitimate fail verdict. That correctly exhausted the 2-round budget — both
round-exhaustion paths (no-new-commits, and rounds-exhausted) are now proven live, not just in
tests. `finografic/llaab#2` is left open, draft, labeled `agent:needs-human`, for a human call on
R1's finding. See `docs/todo/NEXT_STEPS.md` §2–3 for the full trail, and
`docs/todo/TODO_LLAAB_INTEGRATION.md` for day-to-day usage from the LLAAB side.

Explicitly not built (per brief, out of scope for now): Groomer, R2 adversarial review, Hermes
integration, scheduled execution, concurrent issues (WIP > 1), a web UI, merge automation.

## Key Decisions

- Runtime pivoted mid-build from the brief's original "Bun + Vitest" to full Bun (`bun test`, own
  lockfile, `engines.bun >= 1.2`) — user-directed.
- No publish/library shape — this repo is shelled out to like `gh` or `yt-dlp`, never imported.
  `release.yml` deliberately untouched.
- No groomer yet, so `class:*`/`risk:*` labels are applied by hand; `pipeline run` fails loud
  (`RoutingNotFoundError`) rather than guessing a route.
- Gate round tracking lives in a hidden PR-body marker (`<!-- agent:round=N -->`), not a label.
- R1 has no remote-model fallback (the brief's config schema has none) — an oversized diff fails
  closed to `agent:needs-human` rather than guessing at an unconfigured client.
- `gate` always runs R0 then R1 unconditionally — it does not consult a routing rule's
  `reviewers` list to decide whether to run R1. That field (including `'r2'`) is forward-looking
  config for Phase 3; only `run` reads `routing.worker`/`routing.effort`.
- Test-integrity (R0's sixth check — deleted/weakened test files) is a non-blocking flag, not a
  hard failure, per the brief's explicit carve-out. Checks 1–5 stop the gate at first failure.
- `pipeline.config.ts`'s opencode routing entries use `opencode-go/glm-5.2` (a `provider/model`
  string), not a bare model name — opencode requires the provider prefix; a bare name fails with
  `ProviderModelNotFoundError` immediately on invocation. Found live 2026-07-25.
- `src/workers/opencode.ts` always passes `--dir <worktreePath>` — `opencode run` does not
  reliably scope itself to the subprocess's OS-level `cwd` alone; a live run showed it operating
  against this repo instead of the actual target worktree until `--dir` was added. Found and
  fixed live 2026-07-25 — see `docs/todo/NEXT_STEPS.md` §3 for the full evidence trail.
- `hasNewCommits` (`src/worktree.ts`) takes a `since` sha, not a fixed ref — round-retry callers
  must capture HEAD immediately before each round's worker invocation and compare against that,
  not the default branch, or every round after the first falsely looks like it "made commits."
  Found live 2026-07-25 via a real round-2 retry; fixed, with a regression test added.
- This machine's global `~/.config/opencode/opencode.json` had `lean-ctx` wired in as an MCP
  server, which intermittently leaked this repo's file-tree context into opencode worker
  sessions. Disabled (`"enabled": false`) 2026-07-25 — a machine config fix, not a repo one; worth
  knowing about if opencode behaves strangely on a different machine that has the same wiring.
- LLAAB's git config has `push.default: matching`. A bare `git push` from any of LLAAB's worktrees
  pushes _every_ local branch with a remote counterpart, not just the current one — worktrees
  share local branch refs with the main checkout, so this can push someone else's unrelated,
  not-yet-intentionally-pushed local `master` commit too (happened live 2026-07-25, harmlessly, but
  it was still a push to `master` that shouldn't have happened). Always use `git push origin HEAD`
  from a worktree when doing anything beyond what `pipeline`'s own code already does (which only
  ever does `git push --set-upstream origin <branch>` on the agent's own branch, never bare).

## Open Questions

- Worker adapter CLI flags confirmed 2026-07-25 via `--help` + public docs (the shell-allowlist
  restriction that blocked this during the original build and the prior session was lifted).
  What's still open: `claude-code.ts`'s and `opencode.ts`'s JSON output shapes weren't confirmed
  by a live invocation (that spends real API/model usage — needs a deliberate sign-off).
- LLAAB's CI check name (`requiredChecks: ['lint']`) is confirmed **live** (2026-07-25, via
  `gh pr checks` on `finografic/llaab#2`) — no longer an open question. The baseline formatting
  drift that was failing it on every PR is also fixed now (LLAAB-side commit `fix(ci): resolve
lint formatting drift`, same day) — no longer a blocker.
- CI workflows triggered on `pull_request` check out the PR's head branch as committed, not a
  fresh merge with the current default branch — a fix landing on `master` does **not**
  retroactively apply to an open PR's own check runs. The PR's branch itself needs
  `origin/<defaultBranch>` merged in (and pushed) before its check will reflect the fix. Worth
  remembering for any future "why does this PR still fail a check that's fixed on master" moment.
- Both round-exhaustion paths (`hasNewCommits` correctly reporting no new commits; the
  `nextRound > maxRoundsPerIssue` "exhausted" comment/label path) are now proven live via
  `finografic/llaab#2`, not just in tests.
- Line count for Phase 0+1 (~1,976 in `src/` + config, excluding tests) is well over the brief's
  800–1,200 guideline (`src/cli.ts` at 626 lines and `src/github.ts` at 273 are most of it —
  genuine breadth plus this project's one-field-per-line `oxfmt` style, not padding). No
  mechanical trim was done at the end to avoid regressing tested, live-verified code; worth a
  critical read before Phase 2.
