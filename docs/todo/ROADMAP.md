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

- [x] Link the CLI locally — `bun link` run 2026-07-25; `~/.bun/bin/pipeline` resolves globally;
      `pipeline doctor` re-verified 9/9 against real `finografic/llaab` post-link.
- [x] Confirm LLAAB's CI check name — `lint`, confirmed via `.github/workflows/ci.yml` inspection
      2026-07-25 (no live PR existed to check directly; re-verify once one does).
- [ ] Verify `claude-code.ts`/`codex.ts`/`opencode.ts` worker adapter CLI flags against real
      `--help` output before the first real `pipeline run` (see `docs/todo/NEXT_STEPS.md`) — still
      blocked in this session's sandbox, same as during the original build.
- [ ] **Blocker**: LLAAB has zero open issues and zero PRs (checked 2026-07-25) — a qualifying
      issue must exist before `pipeline run` can be exercised end-to-end. See
      `docs/todo/TODO_LLAAB_INTEGRATION.md`.
- [ ] Label a real, small LLAAB issue `agent:ready` and run `pipeline run <issue>` end-to-end.
- [ ] Collect a telemetry sample from 3+ real runs and tune the placeholder budget caps in
      `pipeline.config.ts`.

---

## P0 — Active

_Nothing active right now — pick from P1._

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
