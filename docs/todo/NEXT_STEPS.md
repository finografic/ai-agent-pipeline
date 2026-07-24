# Next Steps — Agent Pipeline

> Near-term, action-oriented follow-ups for the Phase 0/1 build. References
> `docs/todo/ROADMAP.md` and `.agents/handoff.md` — see those for milestone-level status and
> the decisions/deferrals behind this list. This doc is for the concrete "what do I actually do
> next" detail; keep it current as items get done rather than letting it go stale.

---

## 1. Verify worker adapter CLI flags (do this first, before any real `run`)

All three adapters were written from documented conventions, not interactive `--help` output —
the CLIs (`claude`, `codex`, `opencode`) were sandboxed out of reach in the build environment.

- [ ] `claude --help` / `claude -p --help` — confirm `-p`, `--output-format json`,
      `--dangerously-skip-permissions`, `--model` still match `src/workers/claude-code.ts`.
      Confidence here is fairly high (Anthropic's own documented CLI); check the JSON result
      shape too — `claude-code.ts` expects a `usage` object with `input_tokens`/`output_tokens`
      plus `total_cost_usd`, and falls back to `null` tokens on any mismatch, so a shape drift
      won't crash anything, just silently lose cost telemetry. Worth confirming directly.
- [ ] `codex exec --help` — confirm `--full-auto` and `--model` are real flags for the installed
      version. `src/workers/codex.ts` records `null` tokens unconditionally right now (lower
      confidence on output format) — if `codex exec` has a real structured-output flag, wire it
      up the same way `claude-code.ts` does, so W2/chore-class routing gets real telemetry too.
- [ ] `opencode run --help` — same check as codex. This one matters more than it looks: the
      routing table sends `class:chore`/`class:docs`, `risk:low` work here, which is meant to be
      the cheapest, highest-volume path.
- [ ] Once confirmed, update the adapter(s) and the `NOTE:` doc comments in each file (they
      currently say "not verified — see the Open Questions in `.agents/handoff.md`"), and drop
      the corresponding bullet from that file once it's no longer true.

## 2. First real end-to-end `pipeline run` — pick a safe LLAAB issue

> **Blocker as of 2026-07-25**: `gh issue list --repo finografic/llaab --state all` and
> `gh pr list --repo finografic/llaab --state all` both return zero results. There is currently
> nothing to label `agent:ready` — a qualifying issue has to be opened in LLAAB before this
> section can proceed. See `docs/todo/TODO_LLAAB_INTEGRATION.md` for the LLAAB-side plan to seed
> one.

Do **not** start with anything risky. Good first candidates, in order of preference:

- **`class:chore`, `risk:low`** — a dependency bump, a rename, a dead-code removal, a
  `TODO_*.md` → `DONE_*.md` graduation. Routes to `opencode`, `effort: light`, `reviewers: [r0]`
  only — cheapest possible first test, and R1 doesn't even run so you're only exercising `run` +
  R0.
- **`class:docs`, `risk:low`** — fixing a typo or a broken link in LLAAB's own docs, or updating
  a stale section of LLAAB's `AGENTS.md`. Routes to `opencode`, still light, but now runs both
  `r0` and `r1` reviewers — exercises R1 too, on a diff simple enough that a wrong R1 verdict is
  easy to spot by eye.
- **`class:test`, `risk:low`** — add a missing unit test for an existing, already-tested-adjacent
  utility. Routes to `codex`, `effort: standard`. Good second test once `codex.ts`'s flags are
  confirmed (step 1).

**Explicitly avoid for first runs:**

- Anything touching `packages/llm`'s public API (`routeLlm` / `streamLlm` / `getLlmStatus`) — the
  landmines checklist (`prompts/landmines/llaab.md`) flags this, and it's LLAAB's highest
  blast-radius surface per the proposal doc.
- Anything under `vault/`, `knowledge/`, `.agents/`, `scripts/macos/`,
  `configs/llm-routing.json` — R0 will reject these outright (forbidden paths), so picking one
  just burns a worker invocation for nothing.
- Anything labeled `risk:high` — that routes to `claude-code`, `effort: deep`, and per the
  proposal's routing table should get a mandatory human read of the plan _before_ implementation,
  which Phase 0/1 doesn't build a gate for yet (Phase 2+ territory). Skip `risk:high` issues
  entirely for now.

### Steps

1. Write the issue with a clear `## Acceptance Criteria` heading in the body —
   `extractAcceptanceCriteria()` (`src/brief.ts`) looks for exactly that heading and falls back to
   the whole body if it's missing, but a real heading gives R1 something concrete to check against
   instead of the whole issue body.
2. Label it `class:<x>`, `risk:low`, `agent:ready` by hand (no groomer yet).
3. `pipeline run <issue-number>` — watch the console output and the worker's log
   (`<worktreeRoot>/<issue>-<slug>/.pipeline.log`) as it runs.
4. Confirm: a worktree was created under `~/.agent-pipeline/worktrees/`, the issue label swapped
   to `agent:in-progress`, a commit landed on the branch, the branch was pushed, and a **draft**
   PR opened with `Closes #<issue>` and a `<!-- agent:round=0 -->` marker in the body.
5. Check `telemetry/<today>.jsonl` — one `invoke` stage record with real duration and (for
   `claude-code`) real token counts.

## 3. First real `pipeline gate` cycle

1. Wait for the `lint` CI check to resolve on the draft PR from step 2.
2. `pipeline gate <pr-number>` — confirm R0 runs first (check the console output order), and R1
   only runs if R0 passed. Confirm exactly one consolidated comment gets posted.
3. If it passes both gates: confirm the issue label swapped to `agent:approved` and the PR was
   marked ready for review (no longer draft).
4. Check `telemetry/<today>.jsonl` for `r0` and `r1` stage records — `r1`'s `inputTokens`/
   `outputTokens` should be real numbers from Ollama (not null), `usdEstimate: 0` for both (local
   / free).

## 4. Exercise the failure and retry paths (use a disposable test PR, not real LLAAB work)

These are easiest to test against a throwaway branch/PR in LLAAB rather than waiting for a
worker to naturally produce a bad diff:

- [ ] **Forbidden path rejection** — open a PR that touches `vault/` or `.agents/` and run
      `pipeline gate` against it. Confirm R0 fails immediately with a `forbiddenPaths` violation
      and R1 never runs (check telemetry — no `r1` record should appear).
- [ ] **Round exhaustion** — with `limits.maxRoundsPerIssue: 2`, deliberately fail gate twice on
      the same PR (e.g. a PR that R1 will reasonably call incomplete) and confirm the _third_
      `pipeline gate` call is never reached — the second failure should label
      `agent:needs-human` and stop, per the brief's "never attempt a third round" rule.
- [ ] **R1 malformed-JSON fail-closed** — harder to force deliberately since it depends on the
      local model's output; if it happens naturally during testing, confirm the PR gets
      `agent:needs-human` immediately (not a round-retry) and the comment explains why.

## 5. Exercise `abort` and the WIP limit

- [ ] Start a `pipeline run`, then `pipeline abort <issue>` mid-flight (or right after). Confirm
      the worktree and branch are gone and the issue label is back to `agent:ready`.
- [ ] With one issue already `agent:in-progress` (`limits.wip: 1`), try `pipeline run` on a
      second `agent:ready` issue. Confirm it refuses cleanly ("WIP limit reached") and does not
      touch the second issue's label or create a worktree for it.

## 6. Timeout / process-tree-kill sanity check

`killProcessTree` (`src/workers/types.ts`) sends `SIGTERM` to direct children via `pkill -P` then
`SIGKILL` to the worker process — it does **not** recurse into grandchildren. This has not been
tested against a real worker CLI's actual subprocess tree.

- [ ] Temporarily set `limits.workerTimeoutMinutes` to something tiny (e.g. `0.05` = 3s) in
      `pipeline.config.ts`, run a real issue, and confirm: the process actually dies (check `ps`
      for orphaned worker/shell processes afterward), the issue gets labeled
      `agent:needs-human`, and the worktree is left in place for inspection (not torn down).
      Revert the config change afterward.

## 7. Telemetry and cost tuning

- [ ] After 3+ real runs, `pipeline status --costs` and sanity-check the numbers against what you
      remember happening.
- [ ] Use those numbers to replace the placeholder `perIssueUsdCap`/`dailyUsdCap` in
      `pipeline.config.ts` with real ones, per the brief's own instruction not to trust the
      shipped defaults.

## 8. Open implementation follow-ups (not required by the brief, worth a decision)

- [x] Confirm the actual check name `gh pr checks` reports for LLAAB's CI — **confirmed with a
      caveat (2026-07-25)**: no LLAAB PR exists yet to check live, so instead read
      `.github/workflows/ci.yml` directly (via `gh api repos/finografic/llaab/contents/...`) — one
      job, keyed `lint`, no `name:` override, no matrix, which confirms `requiredChecks: ['lint']`
      is correct. Re-verify against a live PR's `gh pr checks` output the first time one exists,
      since job-id-as-check-name isn't 100% guaranteed across GitHub's Checks API quirks.
- [ ] Telemetry files (`telemetry/*.jsonl`) have no rotation/retention — fine at low volume, worth
      a note if this runs for months.
- [ ] The line-count overage flagged in `.agents/handoff.md` (~1,976 vs. the brief's 800–1,200
      guideline) hasn't had a simplification pass. Worth revisiting once real usage shows which
      parts of `src/cli.ts` actually earn their complexity vs. which don't.
- [ ] Consider a `--dry-run` flag for `run`/`gate` (render the brief / print the gate result
      without labeling or invoking anything) to make future testing safer — not in the brief, but
      would have made steps 2–4 above easier to iterate on.
