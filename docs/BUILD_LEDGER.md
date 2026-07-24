# Build Ledger

> Maintained per `docs/todo/TODO_AGENT_PIPELINE_SETUP.md` operating rule 6. Must be true at all
> times — half-done means this file says half-done.

## Current status

**Phase 0 and Phase 1 are both built and passing verification.** `pipeline doctor` runs clean
against the real target repo (`finografic/llaab`); `run`/`gate`/`status`/`abort` are implemented
and typecheck/lint/test clean, but `run`/`gate` have not yet been exercised against a real GitHub
issue end-to-end (no LLAAB issue has been labeled `agent:ready` yet — see Deferred).

## Resume here

Nothing is mid-flight. To pick this up next:

1. Label a real, small LLAAB issue `agent:ready` (with `class:*`/`risk:*`), then run
   `pipeline run <issue>` for the first real end-to-end Phase 0 walking-skeleton test.
2. Before that first real run, sanity-check the worker adapter CLI flags in
   `src/workers/claude-code.ts`, `codex.ts`, and `opencode.ts` against `--help` for the installed
   CLI versions — they were written from documented conventions, not verified interactively (see
   Deferred).
3. Collect a telemetry sample from 3+ real runs (`pipeline status --costs`) and use it to tune the
   placeholder budget caps in `pipeline.config.ts`.

Key files: `src/cli.ts` (orchestration), `pipeline.config.ts` (target-repo config),
`src/config.ts` (schema), `docs/AGENT_PIPELINE_PROPOSAL.md` (design rationale).

## Phase table

| Phase                    | Commits (oldest → newest)       | Verified by                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tooling migration to Bun | `76aae1a`                       | `bun install`, `bun run typecheck` clean on an empty `src/`                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Config + core modules    | `f627d9b`, `aad3612`, `88737b7` | `bun run typecheck` clean at each commit; worktree lifecycle smoke-tested against a scratch fixture repo before the formal test suite existed                                                                                                                                                                                                                                                                                                                                                               |
| CLI entrypoint           | `df89b0e`, `c1469ba`            | `pipeline doctor` run live against `finografic/llaab` — all 9 checks pass, 12 labels created on the real repo. Found and fixed a real bug live: Bun's `$` array-arg interpolation mishandles an empty-string element ("too many arguments") in `ensureLabels`.                                                                                                                                                                                                                                              |
| Test suite               | `0f3145f`                       | `bun test` — 36 pass, 0 fail, ~0.6s. Covers config validation, all six R0 checks (including short-circuit order and the non-blocking test-integrity flags), R1 JSON parsing (valid/retry/malformed-closed/oversized-diff-escalation) via a mocked Ollama client, worktree create/resume/teardown against a disposable bare+clone fixture repo, and WIP-limit enforcement against a fake GithubClient. No test invokes a real agent CLI, a real model, this repo's own working tree, or the real LLAAB repo. |
| README + this ledger     | _(this commit)_                 | manual review                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## Decisions taken at forks

- **Runtime: full Bun**, not the brief's original "Bun + Vitest" — own `package.json`/`bun.lock`,
  `engines.bun >= 1.2`, `bun test` instead of Vitest, `Bun.$` for all subprocess/git/gh calls,
  `Bun.Glob` for the `requireTestsFor` check. User-directed mid-build.
- **No publish/library shape.** This repo is not imported as a library by its target repo (LLAAB
  shells out to it the same way it shells out to `gh`), so `package.json` has no
  `main`/`module`/`exports`/`publishConfig` — only `bin` (for `bun link`/`bunx`). `release.yml` was
  deliberately left untouched; revisit only if this needs to run on another machine or LLAAB ever
  wants to call it as a library instead of shelling out.
- **Labels only — no groomer.** Phase 2 (groomer + issue-template lint) is out of scope, so
  `class:*`/`risk:*` labels are applied by hand when a human moves an issue to `agent:ready`.
  `pipeline run` fails loud (`RoutingNotFoundError`) if either is missing rather than guessing a
  default route.
- **`gate` always runs R0 then R1 unconditionally** — it does not consult a routing rule's
  `reviewers` list to decide whether to run R1. The `reviewers` field (including `'r2'`) is
  forward-looking config for Phase 3; Phase 0/1 code doesn't read it for gating decisions, only
  `run` reads `routing.worker`/`routing.effort`.
- **Round tracking lives in the PR body**, not a label — a hidden `<!-- agent:round=N -->` marker,
  per the brief's "store it as a label or in the PR body" choice. Avoids having to pre-declare N
  round-labels in `doctor`.
- **R1 has no remote-model fallback.** The brief's PipelineConfig type (section 2) has no `remote`
  config section, so an oversized diff (should be rare — R0's `maxDiffLines` already caps it well
  under any local context window) fails closed to `agent:needs-human` with `escalated: true`
  recorded in telemetry, rather than guessing at a client that isn't configured. Clean Phase 2+
  extension point.
- **Test-integrity (R0 check 6) is a flag, not a failure** — per the brief's explicit carve-out,
  distinct from checks 1–5 which stop the gate at first failure.

## Deferred / left for later

- **Worker adapter CLI flags are unverified.** `claude`, `codex`, and `opencode` are all blocked
  from direct invocation in this build environment's shell sandbox (a reasonable guard against a
  nested-agent recursion risk), so `--help` could not be checked against the actually-installed
  versions. `claude-code.ts` uses `-p`/`--output-format json`/`--dangerously-skip-permissions`
  with fairly high confidence (Anthropic's own documented CLI). `codex.ts` (`codex exec
--full-auto`) and `opencode.ts` (`opencode run`) are lower-confidence and record `null` token
  counts rather than guess at an output-format flag that might not exist. **Verify all three
  against real `--help` output before the first real `pipeline run`.**
- **Process-tree kill on timeout is shallow.** `killProcessTree` in `src/workers/types.ts` sends
  `SIGTERM` to direct children (`pkill -P`) then `SIGKILL` to the worker process itself — it does
  not recurse into grandchildren. Fine for the common case (a worker CLI plus the shell commands it
  runs directly); revisit if a worker's own subprocess tree turns out to be deeper.
- **No real end-to-end `run`/`gate` cycle yet** — see Resume here above.
- **Budget caps are placeholders** (`perIssueUsdCap: 2`, `dailyUsdCap: 10` in `pipeline.config.ts`)
  — tune from real telemetry once available, per the brief's own instruction not to trust these
  numbers until real runs exist.
- Explicitly out of scope per the brief and untouched: Groomer, R2 adversarial review, Hermes
  integration, scheduled/launchd execution, concurrent issues (WIP > 1), a web UI, any merge
  automation. `reviewers/` and `workers/` are structured to take another module/adapter without
  rework.

## What I'd do differently

- Would have liked to confirm worker CLI flags interactively before writing the adapters instead
  of relying on documented conventions — the sandbox restriction wasn't apparent until task 5 was
  already underway. Flagged clearly in code comments and above instead of blocking the whole build
  on it.
