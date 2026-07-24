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
covered by 36 `bun:test` tests (config validation, all six R0 checks, R1 JSON parsing including
the malformed/retry/escalation paths via a mocked Ollama client, worktree lifecycle against a
disposable fixture repo, WIP-limit enforcement). `pipeline doctor` has been run live against the
real `finografic/llaab` repo — all 9 checks pass, and the 12 pipeline labels now exist there for
real. The CLI is now linked (`bun link`, 2026-07-25) — `~/.bun/bin/pipeline` resolves globally, and
`pipeline doctor` re-confirmed 9/9 checks post-link. `run`/`gate` have not yet been exercised
end-to-end against a real issue — blocked, not just un-started: LLAAB currently has zero open
issues and zero PRs (confirmed 2026-07-25). See `docs/todo/NEXT_STEPS.md` for the concrete steps
once an issue exists, and `docs/todo/TODO_LLAAB_INTEGRATION.md` for the LLAAB-side plan to seed
one and use the linked CLI from there.

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

## Open Questions

- Worker adapter CLI flags (`claude-code.ts`, `codex.ts`, `opencode.ts`) are based on documented
  conventions, not verified interactively — the CLIs resolve on `PATH` (`pipeline doctor` finds
  all three) but remain uninvokable from this sandboxed session (shell-allowlist restriction),
  same as during the original build. Verify against real `--help` output before the first real
  `pipeline run`.
- LLAAB's CI check name (`requiredChecks: ['lint']`) was confirmed indirectly (2026-07-25) by
  reading `.github/workflows/ci.yml` rather than a live `gh pr checks` call — no LLAAB PR exists
  yet. Low-risk but not 100% certain; re-check the first time a real PR's checks are visible.
- Line count for Phase 0+1 (~1,976 in `src/` + config, excluding tests) is well over the brief's
  800–1,200 guideline (`src/cli.ts` at 626 lines and `src/github.ts` at 273 are most of it —
  genuine breadth plus this project's one-field-per-line `oxfmt` style, not padding). No
  mechanical trim was done at the end to avoid regressing tested, live-verified code; worth a
  critical read before Phase 2.
