# Task — Verify agent-pipeline against real LLAAB (Tier 1 + Tier 2)

Run this from inside the `agent-pipeline` repo. Goal: work through
`docs/todo/NEXT_STEPS.md` in order, turning "code-complete but unverified" into "actually proven
against the real target." Do not skip ahead — later steps assume earlier ones are true.

> **Progress — updated 2026-07-25 (second pass, after a real run+gate cycle completed)**
>
> - **§1 (worker CLI flags)** — done. Once the shell-allowlist restriction was lifted, `--help`
>   plus public docs confirmed all three adapters, and found/fixed two real bugs (`codex.ts`'s
>   deprecated `--full-auto`, `opencode.ts`'s missing `--auto`/`--dir`). See
>   `docs/todo/NEXT_STEPS.md` §1 for full detail. Only nominally open: `claude-code.ts`'s and
>   `opencode.ts`'s JSON output shapes weren't confirmed by a live invocation (costs real usage).
> - **§2 (CI check name)** — done, confirmed **live** this time via `gh pr checks` on a real PR
>   (`finografic/llaab#2`), not just the workflow-file inspection from the first pass.
> - **§3 (pick the first real test issue)** — done. Proposed two candidates from LLAAB's own
>   `docs/todo/ROADMAP.md`/`TODO_*.md` state (a chore graduation, a docs link fix); human picked
>   the chore graduation.
> - **§4 (first real `run` + `gate` cycle)** — done, fully, including a human merge of the
>   resulting PR. Found and fixed a third real bug along the way (`hasNewCommits` comparing
>   against the wrong ref on round retries) and hit a genuine, unrelated LLAAB-side blocker
>   (pre-existing CI formatting drift on `master`) that got fixed same-day. R1 ran for real for
>   the first time and gave a legitimate fail verdict; round-exhaustion fired for real. Full trail
>   in `docs/todo/NEXT_STEPS.md` §2–3.
> - **§5–6 (disposable-PR safety-net tests)** — **not yet reached.** Round exhaustion did get
>   validated for real, but via the genuine LLAAB CI blocker above, not via a deliberately-created
>   disposable PR — so forbidden-path rejection, `abort`+WIP-limit refusal, and the
>   timeout/process-tree-kill check are all still untested. Still requires the human checkpoint
>   before opening a disposable test PR.
> - **Link verified**: `bun link` run successfully in this repo; `~/.bun/bin/pipeline` symlinks to
>   `src/cli.ts`; `pipeline doctor` re-confirmed 9/9 checks live against `finografic/llaab` after
>   linking. `bun test` (37 pass), `typecheck`, `lint`, and `format:check` all still clean.

---

## 0. Operating rules

1. **This repo is the workspace. LLAAB is the target, not something you edit.** You will invoke
   `pipeline` commands that act on the real `finografic/llaab` repo (via `gh`, worktrees, and
   worker CLIs) — that's the tool doing its job. You do not otherwise open, edit, or commit to
   LLAAB directly.
2. **Verification-first.** `bun test`, `bun run typecheck`, `bun run lint` must stay green
   throughout. Re-run after every change to `src/`.
3. **Human checkpoint before anything costs money or touches real LLAAB state.** Two hard stops
   below (§3 and §5) are not optional — post what you found, wait for confirmation, then continue.
   Everything before those stops is free (reading `--help` output, reading `gh` output, local
   test runs) and doesn't need sign-off.
4. **Update docs as you go, not at the end.** Check off completed items in
   `docs/todo/NEXT_STEPS.md` as you finish them. Update `.agents/handoff.md` at each numbered
   section boundary below (`docs/BUILD_LEDGER.md` was consolidated into it and deleted
   2026-07-24 — this doc predates that cleanup). Move a `ROADMAP.md` "Next" item to "Done" only
   once it's actually verified, not attempted.
5. **Never merge a PR or push to LLAAB's default branch.** The orchestrator's own design forbids
   this (see README) — that constraint applies to you too, not just to `pipeline`'s code.
6. **Any real LLAAB PR you cause to be opened during testing must be clearly disposable** —
   confirm before opening it, and close/delete the branch afterward unless the human says
   otherwise.

---

## 1. Verify worker CLI flags — `NEXT_STEPS.md` §1

Run `claude --help`, `claude -p --help`, `codex exec --help`, `opencode run --help` for real.
For each, check the actual adapter against reality:

- `src/workers/claude-code.ts` — confirm `-p`, `--output-format json`,
  `--dangerously-skip-permissions`, `--model` are real flags, and that a JSON result actually
  contains `usage.input_tokens` / `usage.output_tokens` / `total_cost_usd` in the shape the
  adapter expects. If the shape differs, fix the adapter's parsing, not the expectation of what's
  useful — real telemetry matters.
- `src/workers/codex.ts` — confirm `--full-auto` and `--model`. This adapter currently reports
  `null` tokens unconditionally; if `codex exec` has a real structured-output flag, wire it up.
  If it genuinely doesn't, leave `null` and say so in the ledger — don't fabricate a parser for
  output that isn't reliably structured.
- `src/workers/opencode.ts` — same check. Prioritize getting this one right: it's the default
  landing spot for `class:chore`/`class:docs` work, i.e. the highest-volume path.

For each adapter you touch: update the `NOTE:` doc comment (currently "not verified — see the
Open Questions in `.agents/handoff.md`"), remove the corresponding line from
`.agents/handoff.md`'s Open Questions once it's no longer true, run `bun test`, commit.

---

## 2. Verify the CI check name — `NEXT_STEPS.md` §8, first bullet

`pipeline.config.ts` currently assumes LLAAB's CI check is named exactly `lint`. Confirm against
a real, recent LLAAB PR:

```bash
gh pr checks <any-recent-llaab-pr-number> --repo finografic/llaab --json name,bucket
```

If the reported name differs (e.g. prefixed with a workflow name), update
`requiredChecks` in `pipeline.config.ts` to match. Getting this wrong means R0 polls forever
treating the check as permanently missing — silent hang, not a crash — so don't skip this even
though it looks minor. Commit.

---

## 3. STOP — pick the first real test issue (human checkpoint)

Do not proceed past this point without confirmation.

Look at LLAAB's actual open issues (`gh issue list --repo finografic/llaab`) and propose **2–3
candidates** that fit `NEXT_STEPS.md` §2's safety ordering:

1. Preferred: `class:chore`, `risk:low` — a dependency bump, rename, dead-code removal, or
   `TODO_*.md` → `DONE_*.md` graduation. Routes to opencode, `effort:light`, R0 only.
2. Also fine: `class:docs`, `risk:low` — a typo fix or stale doc section. Routes to opencode,
   light, but exercises R1 too.

Explicitly exclude and do not propose: anything touching `packages/llm`'s public API, anything
under `vault/`, `knowledge/`, `.agents/`, `scripts/macos/`, `configs/llm-routing.json` (R0 rejects
these — proposing one just burns a run for nothing), and anything `risk:high`.

Post the candidates with a one-line reason each. **Wait for the human to pick one before doing
anything else.**

---

## 4. First real `run` + `gate` cycle — `NEXT_STEPS.md` §2–3

Once an issue is chosen:

1. If it doesn't already have a clear `## Acceptance Criteria` heading in the body, that's worth
   flagging to the human before proceeding — `extractAcceptanceCriteria()` falls back to the
   whole issue body without one, which gives R1 less to check against.
2. Label it `class:<x>`, `risk:low`, `agent:ready`.
3. `pipeline run <issue-number>`. Narrate what you're watching for as it runs — don't just report
   success/failure at the end.
4. Confirm all of: worktree created under `~/.agent-pipeline/worktrees/`, issue label swapped to
   `agent:in-progress`, a commit landed, branch pushed, draft PR opened with `Closes #<issue>` and
   a `<!-- agent:round=0 -->` marker.
5. Check `telemetry/<today>.jsonl` for a real `invoke` record — real duration, and for
   claude-code, real token counts (per whatever §1 established).
6. Once the PR's `lint` check resolves, `pipeline gate <pr-number>`. Confirm R0 runs before R1,
   R1 only runs if R0 passed, exactly one consolidated comment gets posted.
7. On a pass: confirm the issue label became `agent:approved` and the PR left draft state. Check
   telemetry for `r0`/`r1` records — R1's tokens should be real numbers from Ollama, `usdEstimate:
0` for both.
8. Report the full outcome to the human. **Do not merge the PR.** Leave it open for the human to
   review and decide.

Update `NEXT_STEPS.md` §2–3 checkboxes and `.agents/handoff.md`.

---

## 5. STOP — before the disposable-PR safety-net tests (human checkpoint)

`NEXT_STEPS.md` §4 and §6 require deliberately triggering failure paths (forbidden-path
rejection, round exhaustion, timeout kill), which need a disposable test PR against real LLAAB —
not the PR from §4 above. Before opening one:

Post exactly what you intend to create (branch name, what it'll touch, that it'll be closed and
its branch deleted afterward) and wait for confirmation.

---

## 6. Safety-net tests — `NEXT_STEPS.md` §4–6

Once confirmed:

- **Forbidden path rejection** — a disposable PR touching `vault/` or `.agents/`. Run `pipeline
gate` against it. Confirm R0 fails immediately on `forbiddenPaths` and R1 never runs (verify
  via telemetry — no `r1` record).
- **Round exhaustion** — with `limits.maxRoundsPerIssue: 2`, get a PR gate-failed twice. Confirm
  the label becomes `agent:needs-human` after the second failure and no third `gate` round is
  attempted.
- **`abort` + WIP limit** — start a `run`, then `pipeline abort <issue>` mid-flight; confirm
  worktree/branch are gone and the label reverts to `agent:ready`. Separately, with one issue
  already `agent:in-progress`, confirm a second `run` refuses cleanly with a WIP-limit message and
  touches nothing.
- **Timeout / process-tree kill** — temporarily set `limits.workerTimeoutMinutes` very small
  (e.g. `0.05`), run a real issue, confirm the process actually dies (check `ps` for orphans
  afterward), the issue gets `agent:needs-human`, and the worktree is left in place for
  inspection. **Revert the config change immediately after** — do not leave a 3-second timeout in
  the shipped config.

Close and delete the branch of every disposable PR you created for these tests once done.

---

## 7. Wrap-up

- Update `docs/todo/NEXT_STEPS.md`: check off everything completed, leave anything not attempted
  (budget-cap tuning, telemetry rotation, the `--dry-run` flag idea) as-is — those are Tier 3, out
  of scope for this task.
- Update `docs/todo/ROADMAP.md`'s Next section to reflect what's now actually verified vs. still
  pending.
- Update `.agents/handoff.md` with a final status: what's proven, what's still unverified
  (e.g. codex/claude-code adapters if their CLIs weren't reachable in this environment either),
  and what the human should do next.
- Do not touch `pipeline.config.ts`'s budget caps (`perIssueUsdCap`/`dailyUsdCap`) — those need
  3+ real telemetry samples per `NEXT_STEPS.md` §7, which this task doesn't guarantee reaching.

---

## If a CLI is unreachable in this environment

If `claude`, `codex`, or `opencode` aren't actually invokable from where you're running (sandbox
restrictions, missing auth, etc.), don't guess at their flags a second time. Say exactly which
ones you couldn't verify, leave their `NOTE:` comments in place, and make that the first line of
your final report — the human will need to run those specific `--help` checks by hand.
