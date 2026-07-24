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

- [ ] Verify `claude-code.ts`/`codex.ts`/`opencode.ts` worker adapter CLI flags against real
      `--help` output before the first real `pipeline run` (see `docs/todo/NEXT_STEPS.md`).
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
