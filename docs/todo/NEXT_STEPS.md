# Next Steps — Agent Pipeline

> Near-term, action-oriented follow-ups for the Phase 0/1 build. References
> `docs/todo/ROADMAP.md` and `.agents/handoff.md` — see those for milestone-level status and
> the decisions/deferrals behind this list. This doc is for the concrete "what do I actually do
> next" detail; keep it current as items get done rather than letting it go stale.

---

## 0. ACTIVE NOW — LLAAB local integration pass

This is the current task as of 2026-07-26. Follow progress here while the integration pass is in
flight; durable usage rules live in [`TODO_LLAAB_INTEGRATION.md`](./TODO_LLAAB_INTEGRATION.md).

- [x] Run `pipeline doctor` from `/Users/justin/LLAAB` and record whether all 9 checks pass.
      → 2026-07-26: passed, all 9 checks OK.
- [x] Check `pipeline status` before starting work and confirm the WIP limit leaves room for a
      new run.
      → 2026-07-26: `WIP: 0/1`.
- [x] Pick one safe, low-risk LLAAB issue candidate from the current roadmap/docs; prefer docs,
      chore, or test work that avoids forbidden paths and `packages/llm` public APIs.
      → Selected docs-only graduation of `docs/todo/TODO_PODCAST_INGEST.md`; the roadmap already
      marks podcast ingest validation complete.
- [ ] Create or update the GitHub issue with `## Acceptance Criteria`.
- [ ] Apply `class:*`, `risk:low`, and `agent:ready` labels by hand.
- [ ] Run `pipeline run <issue-number>` and record the worktree, branch, draft PR, and telemetry.
- [ ] After required checks resolve, run `pipeline gate <pr-number>` and record the R0/R1 verdict.
- [ ] Leave the final merge decision to Justin; do not merge or push to LLAAB `master`.

## 1. Verify worker adapter CLI flags (do this first, before any real `run`)

- [x] `claude --help` — confirmed 2026-07-25: `-p`, `--output-format json`,
      `--dangerously-skip-permissions`, `--model` are all real flags on the installed CLI, no
      changes needed in `src/workers/claude-code.ts`. The JSON result shape (`usage.input_tokens`/
      `output_tokens`, `total_cost_usd`) is Anthropic's documented convention but was **not**
      confirmed by a live invocation — that spends real API usage, so it's still nominally open;
      falls back to `null` tokens on any shape mismatch either way, so low risk.
- [x] `codex exec --help` — confirmed 2026-07-25, **and fixed a real bug**: `--full-auto` (what
      the adapter used) is a deprecated compatibility flag on codex-cli 0.138.0; replaced with the
      documented `--sandbox workspace-write`. Also wired up real token telemetry — `--json` emits
      a `turn.completed` event with a genuine `usage.input_tokens`/`output_tokens` object (per
      [Codex non-interactive mode docs](https://learn.chatgpt.com/docs/non-interactive-mode)); no
      cost field exists in the stream, so `usdEstimate` stays `null`. Verified via `--help` +
      public docs, not a live invocation.
- [x] `opencode run --help` — confirmed 2026-07-25, **and fixed a real gap**: the adapter was
      missing `--auto`, meaning a permission prompt with no TTY to answer it would hang the worker
      until timeout-killed instead of completing. `--format json`'s event shape isn't documented
      anywhere reachable, and `opencode stats` (the separate cost/token command) has no session
      filter or JSON output, so token/cost fields stay `null` rather than guessed.
- [x] Adapter `NOTE:` doc comments updated in all three files; the corresponding
      `.agents/handoff.md` Open Questions bullet updated to match (worker CLI flags are no longer
      "sandboxed out of reach" — only the two live-JSON-shape confirmations above remain open).

## 2. First real end-to-end `pipeline run` — pick a safe LLAAB issue

- [x] **Done 2026-07-25** — opened `finografic/llaab#1` (graduate `TODO_REGISTRY_PACKAGES.md` to
      `DONE_REGISTRY_PACKAGES.md`), labeled `class:chore`/`risk:low`/`agent:ready`, ran
      `pipeline run 1`. Confirmed all of: worktree created under
      `~/.agent-pipeline/worktrees/1-graduate-todo-registry-packages-md-to-do`, label swapped to
      `agent:in-progress`, a real conventional-commit landed, branch pushed, draft PR
      [`finografic/llaab#2`](https://github.com/finografic/llaab/pull/2) opened with `Closes #1`
      and `<!-- agent:round=0 -->`. Telemetry recorded a real `invoke` record (opencode, ~34s,
      `outcome: success`, tokens `null` as documented).
      Getting here surfaced and fixed three real bugs — see "Bugs found via this run" below.

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

- [x] **Done 2026-07-25, with a real complication** — `gh pr checks 2` confirmed `lint` live
      (matches the indirect confirmation in §8). It resolved to **fail** — not because of
      anything in the PR's own diff, but because **LLAAB's `master` branch's last 5 CI runs have
      all failed** (`gh run list --repo finografic/llaab --branch master --workflow CI`), a
      pre-existing formatting problem across ~22 unrelated files. `pipeline gate 2` correctly ran
      R0 first, R0 failed on `requiredChecks`, posted exactly one comment
      (`**R0: fail**\n- requiredChecks: Check "lint" is fail`), and R1 never ran (no `r1`
      telemetry record) — all exactly as designed. This is a real, unresolved blocker on the
      LLAAB side: **no PR can currently pass `requiredChecks: ['lint']` until LLAAB's own
      formatting baseline is fixed** — that's LLAAB's problem to fix, not this pipeline's.
      Round-retry then correctly invoked the worker twice more with the R0 findings; the worker
      correctly declined to fix ~22 unrelated files as out of scope, and — after the round-N
      commit-detection bug below was fixed — round 2 correctly reported "no new commits" and
      labeled `agent:needs-human`.
- [x] **LLAAB's baseline was fixed for real 2026-07-25** (LLAAB commit "fix(ci): resolve lint
      formatting drift", pushed to `master`) — this unblocked the rest of the cycle. The PR's own
      `lint` check still needed the branch updated (`git merge origin/master`) since the CI workflow
      checks out the PR's head branch as committed, not a fresh merge with current `master` — a
      simple re-run of the same job did **not** pick up the fix, only a real branch update did.
      After that: R0 passed for the first time, and **R1 ran for real for the first time all
      session** (previously always short-circuited by R0 failing first) — `gpt-oss:20b`, real
      tokens (1641 in / 84 out), and a legitimate fail verdict: the diff doesn't show evidence the
      "search for inbound references" acceptance-criteria step was actually performed (even
      though that search genuinely turned up nothing, per manual verification during candidate
      selection). Round 2 was already spent, so this correctly triggered the **"rounds exhausted"
      comment/label path** — the one path in §4 below that hadn't been exercised for real yet.
      `finografic/llaab#2` is left open, draft, `agent:needs-human`, for a human call: the
      underlying work is correct, but R1's ask for documented evidence is a fair, defensible bar.
- **Caution while merging `origin/master` into an agent worktree**: a bare `git push` from a
  worktree can push _every_ local branch with a remote counterpart if `push.default: matching` is
  set (as it is in LLAAB) — worktrees share local branch refs with the main checkout, so this can
  push someone's unrelated, not-yet-intentionally-pushed local `master` commit too. Always use
  `git push origin HEAD` (current branch only) from a worktree, never a bare `git push`.

### Bugs found via this run (all fixed 2026-07-25)

- **`pipeline.config.ts`**: opencode's routing-table model was a bare `glm-5.2`; opencode
  requires `provider/model` format. Fixed to `opencode-go/glm-5.2` (confirmed via
  `opencode models`).
- **`src/workers/opencode.ts` — missing `--dir`**: `opencode run` does **not** reliably scope
  itself to the subprocess's OS-level `cwd` — a live run showed it operating against
  _this_ repo (agent-pipeline) instead of the actual LLAAB worktree, evidenced by
  `git branch --show-current`/`git status` inside the worker's own tool calls returning this
  repo's branch and dirty files. `--dir <worktreePath>` fixes it (verified live from an
  unrelated cwd). This was the most severe of the three — silently wrong-repo execution, not a
  crash.
- **`src/worktree.ts` — `hasNewCommits` compared against the wrong ref**: it checked
  `origin/<defaultBranch>..HEAD`, so once round 0 pushed a commit, _every later round_ looked
  like it "made commits" regardless of whether that round's worker did anything — silently
  burning retry rounds instead of correctly detecting "worker made no further changes." Fixed by
  comparing against the HEAD sha captured immediately before each round's invocation instead of a
  fixed ref (`src/cli.ts`'s `invokeWorkerAndPush`). Added a regression test
  (`tests/worktree.test.ts`) that fails against the old behavior and passes against the fix.
- **Environment-level, not a code bug**: this machine's `~/.config/opencode/opencode.json`
  (global, outside any repo) had `lean-ctx` wired in as an MCP server, which intermittently
  leaked _this_ repo's file-tree context into opencode worker sessions (independent of the
  `--dir` bug above). Disabled (`"enabled": false`, not deleted) rather than fixed in code, since
  it's a machine config, not a repo one.

## 4. Exercise the failure and retry paths (use a disposable test PR, not real LLAAB work)

These are easiest to test against a throwaway branch/PR in LLAAB rather than waiting for a
worker to naturally produce a bad diff:

- [ ] **Forbidden path rejection** — open a PR that touches `vault/` or `.agents/` and run
      `pipeline gate` against it. Confirm R0 fails immediately with a `forbiddenPaths` violation
      and R1 never runs (check telemetry — no `r1` record should appear).
- [x] **Round exhaustion — fully validated for real, 2026-07-25**, via `finografic/llaab#2` (see
      §3): round 2 first hit `agent:needs-human` via the "no new commits" path (once the
      `hasNewCommits` bug was fixed), then — after LLAAB's CI baseline was fixed and R1 ran for
      real and failed — a further `pipeline gate` call correctly hit the **"exhausted 2 rounds"**
      comment/label path (`nextRound > maxRoundsPerIssue`), posting the exhaustion comment and
      stopping without attempting a third round. Both round-exhaustion paths are now proven.
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
