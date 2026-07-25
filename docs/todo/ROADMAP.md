# Roadmap

> **This is the primary high-level plan for the project.**
> Check this file before proposing new work. Add new items when conceiving features.
> Keep it ordered by priority — move completed items to the Done section at the bottom.

---

## How to use this file

| Tier | Meaning                                   |
| ---- | ----------------------------------------- |
| P0   | Active — being worked on now              |
| P1   | Next — fully scoped, ready to start       |
| P2   | Planned — direction decided, detail TBD   |
| P3   | Backlog — good ideas, not yet prioritised |

When an item is done, move it to the Done section at the bottom with a completion date.

---

## Next

- [ ] **ACTIVE NOW — LLAAB local integration pass** — use the locally linked `pipeline` CLI from
      `/Users/justin/LLAAB`, confirm `pipeline doctor`, choose a safe LLAAB issue from the current
      roadmap/docs, and run the manual issue → `pipeline run` → `pipeline gate` loop while Phase 2
      groomer automation remains out of scope. Progress lives in
      [`TODO_LLAAB_INTEGRATION.md`](./TODO_LLAAB_INTEGRATION.md) and
      [`NEXT_STEPS.md`](./NEXT_STEPS.md#0-active-now--llaab-local-integration-pass).
- [x] Link the CLI locally — `bun link` run 2026-07-25; `~/.bun/bin/pipeline` resolves globally;
      `pipeline doctor` re-verified 9/9 against real `finografic/llaab` post-link.
- [x] Confirm LLAAB's CI check name — `lint`, confirmed via `.github/workflows/ci.yml` inspection
      2026-07-25 (no live PR existed to check directly; re-verify once one does).
- [x] Verify `claude-code.ts`/`codex.ts`/`opencode.ts` worker adapter CLI flags against real
      `--help` output — done 2026-07-25, fixed two real bugs (`codex.ts`'s deprecated
      `--full-auto`, `opencode.ts`'s missing `--auto`). JSON output shapes for `claude-code.ts`/
      `opencode.ts` still need a live invocation to fully confirm (see `docs/todo/NEXT_STEPS.md`
      §1) — that costs real usage, so it's gated on a deliberate decision to spend it.
- [x] First real end-to-end `run` + `gate` — done 2026-07-25 against `finografic/llaab#1`/`#2`.
      Found and fixed three real bugs along the way: a bad opencode model string in
      `pipeline.config.ts` (missing `provider/` prefix), a missing `--dir` flag in
      `src/workers/opencode.ts` (opencode was silently operating against _this_ repo instead of
      the worktree), and a `hasNewCommits` ref-comparison bug in `src/worktree.ts` that made
      every round after the first falsely look like it "made commits." See
      `docs/todo/NEXT_STEPS.md` §2–3 for full detail.
- [x] LLAAB's CI baseline blocker — **fixed on the LLAAB side same day** (LLAAB commit "fix(ci):
      resolve lint formatting drift", pushed to `master` 2026-07-25). Unblocked R0 and let R1 run
      for real for
      the first time all session; R1 gave a legitimate fail verdict (see `docs/todo/NEXT_STEPS.md`
      §3), which correctly exhausted the 2-round budget — both round-exhaustion paths (no-commits,
      and rounds-exhausted) are now proven live. `finografic/llaab#2` is open, draft,
      `agent:needs-human`, awaiting a human call on R1's finding.
- [ ] Collect a telemetry sample from 3+ real runs and tune the placeholder budget caps in
      `pipeline.config.ts` (2026-07-25 contributed 6 real `invoke`/`r0` records, but all against
      the same blocked issue, so not yet a representative sample).

---

## P0 — Active

- [ ] **LLAAB local integration pass** — actively being worked now. Track the live checklist in
      [`TODO_LLAAB_INTEGRATION.md`](./TODO_LLAAB_INTEGRATION.md) and the short execution queue in
      [`NEXT_STEPS.md`](./NEXT_STEPS.md#0-active-now--llaab-local-integration-pass).

---

## P1 — Next Up

- [ ] Phase 2 (out of scope for now): Groomer reads `ROADMAP.md#next`, drafts issues, template
      lint rejects bad ones.

---

## P2 — Planned

- [ ] Phase 3: R2 adversarial review (provider diversity from the Phase 0/1 worker), Hermes
      notifications and phone approval.

---

## P3 — Backlog

- [ ] Phase 4: scheduled tick via launchd, WIP limit raised to 2 — only once Phases 0–3 have been
      boring for a couple of weeks (per `docs/AGENT_PIPELINE_PROPOSAL.md`).

---

## Done

| Item                                                                                                   | Completed  |
| ------------------------------------------------------------------------------------------------------ | ---------- |
| Phase 0 — walking skeleton (`doctor`, `run`, worktrees, telemetry)                                     | 2026-07-24 |
| Phase 1 — the free gate (R0 deterministic + R1 local-model contract review, `gate`, `status`, `abort`) | 2026-07-24 |
