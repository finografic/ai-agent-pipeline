# @finografic/ai-agent-pipeline

> Semi-autonomous issue-to-PR pipeline with cost-ordered routing across local and cloud LLMs.

A small Bun/TypeScript orchestrator that takes a human-approved GitHub issue, hands it to an AI
coding agent CLI in an isolated git worktree, and opens a draft PR — then gates that PR with a
free deterministic check (R0) and a free local-model contract review (R1) before it's worth your
attention. See [`docs/AGENT_PIPELINE_PROPOSAL.md`](./docs/AGENT_PIPELINE_PROPOSAL.md) for the full
design rationale and [`.agents/handoff.md`](./.agents/handoff.md) for current architecture,
status, and key decisions.

This is a standalone tool. It runs against a target repo (currently
[finografic/llaab](https://github.com/finografic/llaab)) from the outside — worktrees, subprocess
CLI calls, `gh` — the same way `gh` or `yt-dlp` would. It is never imported as a library by the
repo it operates on.

## Status

Phase 0 and Phase 1 ([`docs/todo/DONE_AGENT_PIPELINE_SETUP.md`](./docs/todo/DONE_AGENT_PIPELINE_SETUP.md))
are code-complete: typecheck/lint/format clean, 36 tests passing, and `pipeline doctor` has been
run live against the real `finografic/llaab` repo (all 9 checks pass, its 12 GitHub labels exist
there for real). **A real end-to-end `run`/`gate` cycle against an actual issue hasn't happened
yet** — see [`docs/todo/NEXT_STEPS.md`](./docs/todo/NEXT_STEPS.md) for the concrete steps to get
there (including which worker CLI flags still need verifying, and which LLAAB issues are safe to
try first).

## Install

```bash
bun install
bun link          # makes the `pipeline` command available globally
```

Requires Bun ≥ 1.2, the `gh` CLI (authenticated), `git`, and a reachable Ollama instance with the
two models named in `pipeline.config.ts` pulled locally. Run `pipeline doctor` to verify all of
this before doing anything else.

## The five commands

Always start with `doctor`:

```bash
pipeline doctor              # verify every dependency; idempotently ensure the pipeline's
                              # GitHub labels exist on the target repo. Exits non-zero on failure.

pipeline run <issue-number>   # claim an agent:ready issue (if under the WIP limit), create/resume
                               # a worktree, invoke the routed worker, open a draft PR.

pipeline gate <pr-number>      # run R0 (deterministic), then R1 (local-model contract review) only
                               # if R0 passed. Posts one consolidated comment. On failure, re-invokes
                               # the worker with the review findings appended — up to
                               # limits.maxRoundsPerIssue rounds, then labels agent:needs-human and
                               # stops for good.

pipeline status [--costs]      # WIP count, or (with --costs) telemetry totals per issue.

pipeline abort <issue-number>  # kill switch: tears down the worktree/branch and releases the
                                # claim back to agent:ready.
```

The orchestrator never merges a PR or pushes to the default branch — that's always a human action.

## Labels are the state machine

`agent:ready` → `agent:in-progress` → `agent:approved` (or `agent:needs-human` at any failure
point that isn't recoverable within the round budget). `class:*` and `risk:*` labels on the issue
drive routing — see `pipeline.config.ts`'s `routing` table. There's no groomer yet (that's Phase
2, out of scope here), so a human applies `class:*`/`risk:*` by hand when approving an issue into
`agent:ready`.

## Config

`pipeline.config.ts` at the repo root is a typed, zod-validated `PipelineConfig` (schema in
`src/config.ts`). It controls: the target repo (slug/path/default branch), the worktree root,
budget/round/timeout limits, gate settings (forbidden paths, required CI checks, whether
conventional-commit format is enforced, which globs demand a test-file change), the routing table
(class+risk → worker + effort + reviewers), and the local Ollama models used for classification
and R1 review. Budget caps ship as placeholder defaults — tune them once `pipeline status --costs`
has real numbers behind it.

## Adding a worker

Workers implement the `Worker` interface in `src/workers/types.ts` — one `invoke()` method that
runs a CLI non-interactively in a worktree and reports back exit status plus token/cost counts
(`null` where the CLI doesn't report them — never fabricated). See `src/workers/claude-code.ts`,
`codex.ts`, and `opencode.ts` for the existing adapters, and `runWorkerProcess` in `types.ts` for
the shared timeout/process-tree-kill/logging plumbing. Register a new one in the `createWorker`
switch in `src/cli.ts` and reference its name in `pipeline.config.ts`'s routing table.

## Development

```bash
bun test           # bun:test — 36 tests, no real agent CLI or model is ever invoked
bun run typecheck   # tsc --noEmit
bun run lint        # oxlint
bun run format:check
```

## License

MIT © Justin Rankin
