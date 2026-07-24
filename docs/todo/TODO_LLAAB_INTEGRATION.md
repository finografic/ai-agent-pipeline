# Task — Use the agent-pipeline CLI from inside LLAAB

This doc is written to be handed to an agent (or read by a human) working **inside the `LLAAB`
repo** (`/Users/justin/LLAAB`). It assumes zero prior context on `agent-pipeline` beyond this file.

---

## 0. What this tool is, and what it is not

`agent-pipeline` is a standalone Bun/TypeScript CLI that lives in its own repo
(`/Users/justin/repos-finografic/@finografic-ai-agent-pipeline`), completely separate from LLAAB.
It acts on LLAAB from the outside — the same way `gh` or `yt-dlp` would — via git worktrees,
subprocess CLI calls, and the GitHub API.

- **Do not add it as a dependency in LLAAB's `package.json`.** It is not imported as a library by
  anything, LLAAB included. There is nothing to `pnpm add`.
- **Do not edit anything inside the `agent-pipeline` repo from here.** If something about its
  behavior needs to change, that's a task for a session working in that repo, not this one.
- **It never merges a PR or pushes to LLAAB's `master`.** That's a human action, by design. Don't
  work around this — if a PR looks ready, hand it to Justin, don't merge it yourself.

It is already configured to target LLAAB specifically — `pipeline.config.ts` in the agent-pipeline
repo has `repo.slug: 'finografic/llaab'`, `repo.path: '/Users/justin/LLAAB'`. Nothing on the LLAAB
side needs to declare or configure this relationship; it's one-directional (agent-pipeline knows
about LLAAB, LLAAB doesn't need to know about agent-pipeline).

## 1. Confirm the CLI resolves from here

The CLI is installed via `bun link`, which put a symlink at `~/.bun/bin/pipeline`. Since
`~/.bun/bin` is already on `PATH` (same shell profile as `bun` itself), it should work from any
directory, including this one:

```bash
cd /Users/justin/LLAAB
pipeline doctor
```

Expect 9 `OK` lines (gh auth, git, target-repo cleanliness, worktree root, Ollama + models, the
three worker CLIs, GitHub labels). This has already been confirmed working from the agent-pipeline
repo itself (2026-07-25) — this step is just confirming `PATH` resolution holds from a different
cwd too. If `pipeline: command not found`, check `echo $PATH` includes `~/.bun/bin` in this shell.

## 2. The label-driven workflow (read before touching any issue)

There is no groomer yet (that's an unbuilt future phase) — a human or agent applies labels by
hand. Every issue that should go through the pipeline needs, at minimum:

- `class:<chore|docs|test|refactor|feature>` — picks the worker + effort from the routing table
  below.
- `risk:<low|med|high>` — same.
- `agent:ready` — the actual "go" signal; `pipeline run` only claims issues with this label.

Current routing table (`pipeline.config.ts` in the agent-pipeline repo — check there for the
authoritative, current version):

| class             | risk | worker      | effort   | reviewers    |
| ----------------- | ---- | ----------- | -------- | ------------ |
| chore             | low  | opencode    | light    | r0           |
| docs              | low  | opencode    | light    | r0, r1       |
| test              | low  | codex       | standard | r0, r1       |
| refactor, feature | med  | claude-code | standard | r0, r1, r2\* |
| refactor, feature | high | claude-code | deep     | r0, r1, r2\* |

\* r2 (adversarial review) isn't built yet (Phase 3) — `gate` currently always runs r0 then r1
only, regardless of what a routing rule's `reviewers` list says.

Also give the issue a `## Acceptance Criteria` heading in its body. R1 (the local-model contract
reviewer) checks the diff against that section specifically; without it, R1 falls back to judging
against the whole issue body, which is a weaker check.

## 3. Known blocker as of 2026-07-25 — seed a real issue

`gh issue list --repo finografic/llaab --state all` and `gh pr list --repo finografic/llaab
--state all` both currently return **zero results**. Nothing has ever gone through this pipeline
against real LLAAB. Before `pipeline run` can be exercised at all, at least one qualifying issue
needs to exist.

Safe first candidates (do not deviate from this ordering without asking Justin first — this list
is deliberately conservative because nothing has been proven end-to-end yet):

1. **Preferred**: `class:chore`, `risk:low` — a dependency bump, a rename, a dead-code removal, or
   a `TODO_*.md` → `DONE_*.md` graduation somewhere in LLAAB. Routes to `opencode`, `effort:light`,
   R0 only (cheapest possible first test).
2. **Also fine**: `class:docs`, `risk:low` — a typo fix or a stale doc section. Same routing, but
   exercises R1 too.

**Explicitly do not propose or label as `agent:ready`:**

- Anything touching `packages/llm`'s public API (`routeLlm`/`streamLlm`/`getLlmStatus`) — highest
  blast-radius surface in LLAAB per the design proposal.
- Anything under `vault/`, `knowledge/`, `.agents/`, `scripts/macos/`, `configs/llm-routing.json` —
  R0 rejects these outright (forbidden paths); labeling one just burns a run for nothing.
- Anything `risk:high` — routes to `claude-code`/`effort:deep` and, per the design doc, is meant to
  get a mandatory human read of the plan before implementation — a gate Phase 0/1 doesn't build.

If you (the agent reading this) are being asked to find or open such an issue in LLAAB: propose 2–3
candidates with a one-line reason each, and **wait for Justin to pick one** before labeling
anything `agent:ready`. This mirrors the human-checkpoint rule already in place on the
agent-pipeline side (`docs/todo/TODO_VERIFY_AGENT_PIPELINE.md` §3 in that repo).

## 4. Day-to-day command loop, once an issue exists

```bash
pipeline status                 # check WIP count (limit is 1 right now) before starting anything
pipeline run <issue-number>      # claims the agent:ready issue, creates a worktree under
                                  # ~/.agent-pipeline/worktrees/, invokes the routed worker CLI,
                                  # opens a draft PR with "Closes #<issue>"
# ... wait for LLAAB's own `lint` CI check to resolve on that PR ...
pipeline gate <pr-number>        # runs R0 (deterministic) then R1 (local-model) if R0 passed;
                                  # posts one consolidated comment; advances the issue label to
                                  # agent:approved on a pass, or re-invokes the worker with
                                  # findings on a fail (up to 2 rounds), then agent:needs-human
pipeline abort <issue-number>    # kill switch at any point — tears down the worktree/branch,
                                  # reverts the label to agent:ready
```

A **human** does the final PR review and merge. No command here does that, and none should be
made to.

## 5. Guardrails this tool assumes but doesn't enforce in code

Worth flagging explicitly, not just relying on the code:

- **Token permissions**: the `gh`-authenticated token/PAT this pipeline uses should not have merge
  rights on LLAAB's `master`. Nothing in the code checks this — it's an out-of-band setting on the
  token itself. Check it once, on the LLAAB/GitHub side, not something to "fix" here.
- **`packages/llm` and the forbidden paths** (§3 above) are enforced by R0 and by
  `prompts/landmines/llaab.md` in the agent-pipeline repo — respect them at labeling time, since
  R0 only catches them after a worker has already spent effort on a doomed diff.

## 6. Reporting back

Whatever you (the agent working here) end up doing, report back with:

- Which issue(s) got labeled and why.
- The full `pipeline run` / `pipeline gate` console output, not just pass/fail.
- Whether `pipeline doctor` passed from inside LLAAB (step 1).
- Anything in this brief that turned out to be wrong or out of date — that's a signal the
  agent-pipeline repo's docs need a follow-up pass, not something to silently paper over.
