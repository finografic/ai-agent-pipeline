# Build Brief — Agent Pipeline, Phases 0 and 1

You are building a small orchestrator that lets AI coding agents work GitHub issues into reviewed
pull requests, cheaply and safely. Build **only Phases 0 and 1**. Later phases are described for
context so you don't design yourself into a corner — do not implement them.

Companion document: `docs/AGENT_PIPELINE_PROPOSAL.md` contains the full design rationale. Read it first.
Where it and this brief disagree on scope, **this brief wins**; where they disagree on intent, the
proposal wins.

---

## 0. Operating rules

1. **This is a new standalone repo.** Do not add it to the LLAAB workspace, do not import from
   `@llaab/*`, do not depend on LLAAB running. The pipeline must be able to operate on a repo it
   knows nothing about beyond its config file.
2. **Small.** Phase 0 + Phase 1 should land in roughly 800–1,200 lines of TypeScript excluding
   tests. If you're past that, you're building Phase 4. Stop and simplify.
3. **Verification-first.** Typecheck, tests, and lint pass before you call anything done. Run them
   yourself; don't assert success you haven't observed.
4. **No cleverness in the state layer.** GitHub labels are the state. Do not add a local database,
   a JSON state file, or an in-memory queue that outlives a process.
5. **Fail loud, fail cheap.** Every error path must either retry once with a bounded backoff or stop
   and label the issue `agent:needs-human`. Never silently continue. Never loop unbounded.
6. **Continuity.** Maintain `docs/BUILD_LEDGER.md` from your first commit: current status, a single
   "resume here" line with file paths, a phase table with commit SHAs and how each was verified,
   decisions taken at forks, and anything you deliberately deferred. Update it at every phase
   boundary. It must be true at all times — half-done means the ledger says half-done.
7. **Conventional Commits**, one logical unit per commit, green at every commit.

---

## 1. Stack and layout

Bun + TypeScript, strict mode. Vitest. No framework. `gh` and `git` invoked as subprocesses.

```
agent-pipeline/
├── src/
│   ├── cli.ts                 # entry: run | gate | status | abort | doctor
│   ├── config.ts              # load + validate pipeline.config.ts (zod)
│   ├── github.ts              # thin gh CLI wrapper — issues, labels, PRs, checks
│   ├── worktree.ts            # create / destroy isolated worktrees
│   ├── workers/
│   │   ├── types.ts           # Worker interface
│   │   ├── claude-code.ts     # subprocess adapter
│   │   ├── codex.ts           # subprocess adapter
│   │   └── opencode.ts        # subprocess adapter (also used for cheap review)
│   ├── reviewers/
│   │   ├── r0-gate.ts         # deterministic policy — NO LLM
│   │   └── r1-contract.ts     # local-model diff review
│   ├── llm/
│   │   └── local.ts           # minimal Ollama client — chat + JSON mode
│   ├── telemetry.ts           # per-stage tokens, duration, cost → JSONL
│   └── brief.ts               # renders the scoped brief handed to a worker
├── prompts/
│   ├── worker.md              # templated implementation brief
│   ├── r1-contract.md         # templated contract review
│   └── landmines/llaab.md     # repo-specific review checklist
├── pipeline.config.ts         # config for the target repo
├── docs/BUILD_LEDGER.md
└── tests/
```

---

## 2. Config

One config object, validated with zod at startup. `doctor` must verify every external dependency
before anything else runs.

```ts
type PipelineConfig = {
  repo: { slug: string; path: string; defaultBranch: string };
  worktreeRoot: string;                    // e.g. ~/.agent-pipeline/worktrees

  limits: {
    wip: number;                           // START AT 1
    maxRoundsPerIssue: number;             // 2
    maxDiffLines: number;                  // 400 — R0 rejects above this
    perIssueUsdCap: number;
    dailyUsdCap: number;
    workerTimeoutMinutes: number;
  };

  gates: {
    forbiddenPaths: string[];              // vault/, knowledge/, .agents/, scripts/macos/, configs/llm-routing.json
    requiredChecks: string[];              // CI check names that must be green
    requireConventionalCommits: boolean;
    requireTestsFor: string[];             // globs where a source change demands a test change
  };

  routing: Array<{
    when: { class: string[]; risk: string[] };
    worker: 'claude-code' | 'codex' | 'opencode';
    effort: 'light' | 'standard' | 'deep';
    model?: string;
    reviewers: Array<'r0' | 'r1' | 'r2'>;
  }>;

  local: { baseUrl: string; classifyModel: string; reviewModel: string };
};
```

Ship it pre-populated for LLAAB: forbidden paths as listed, `wip: 1`, `maxRounds: 2`,
`classifyModel: 'gemma4:e4b-it-qat'`, `reviewModel: 'gpt-oss:20b'`.

---

## 3. Phase 0 — the walking skeleton

**Goal:** `pipeline run <issue-number>` takes one existing, human-approved GitHub issue and produces
one draft PR, with full cost telemetry. No reviewers, no automation, no scheduling.

### Steps to implement, in order

**0.1 `doctor`.** Verify: `gh` present and authenticated; `git` present; target repo clean and on
default branch; worktree root writable; Ollama reachable and both configured models pulled; each
configured worker CLI present and runnable. Print a table, exit non-zero on any failure. Write this
first — it will save you hours.

**0.2 Labels.** An idempotent command that creates the label set on the target repo:
`agent:ready`, `agent:in-progress`, `agent:needs-human`, `agent:approved`,
`class:feature|refactor|chore|docs|test`, `risk:low|med|high`. Safe to re-run.

**0.3 Claim.** Given an issue number: verify it carries `agent:ready`, verify the WIP limit isn't
breached (count open `agent:in-progress`), then swap the label to `agent:in-progress`. If either
check fails, exit cleanly with a clear message — do no work.

**0.4 Worktree.** `git worktree add` from a fresh fetch of the default branch, into
`<worktreeRoot>/<issue>-<slug>`, on branch `agent/<issue>-<slug>`. If the worktree already exists,
that's a resume, not an error. Provide teardown.

**0.5 Brief.** Render `prompts/worker.md` with: issue title and body, acceptance criteria, the
effort profile, the forbidden-path list, the diff-size ceiling, and the target repo's own agent
conventions (for LLAAB: point at `.agents/handoff.md` and the relevant
`.github/instructions/**` files rather than restating them). Include an explicit instruction to
commit in conventional format and to **not** push to the default branch.

**0.6 Invoke.** Run the routed worker CLI as a subprocess in the worktree, non-interactive, with a
hard timeout from config. Stream output to a per-issue log file. On timeout: kill the process tree,
label `agent:needs-human`, tear down nothing (leave the worktree for inspection).

**0.7 PR.** If the worker produced commits, push the branch and open a **draft** PR via `gh`, body
linking the issue and listing changed files. If it produced no commits, label `agent:needs-human`
and say so.

**0.8 Telemetry.** Append one JSONL record per stage to `telemetry/<date>.jsonl`:
`{ issue, stage, worker, model, startedAt, durationMs, inputTokens, outputTokens, usdEstimate, outcome }`.
Parse token counts from the worker CLI's own output where it reports them; where it doesn't, record
`null` rather than guessing — **never fabricate a number**. Add `pipeline status --costs` to
summarise the last N runs. This is a Phase 0 deliverable, not an extra.

### Phase 0 acceptance

- `pipeline doctor` passes on the Mac Studio.
- A real LLAAB chore issue goes from `agent:ready` to a draft PR with zero manual intervention.
- The telemetry file contains a complete record with real durations, and token counts wherever the
  CLI reported them.
- Running the same issue twice does not create a second worktree, branch, or PR.
- Killing the process mid-run leaves recoverable state: the label can be reset by hand and a re-run
  resumes.

---

## 4. Phase 1 — the free gate

**Goal:** `pipeline gate <pr-number>` runs R0, then R1 only if R0 passes, and posts a single
consolidated review comment.

### R0 — deterministic gatekeeper (no LLM)

Runs in this order, stopping at the first failure:

1. All `requiredChecks` green (poll `gh pr checks` with bounded backoff; treat pending as
   not-yet-gated, not as failure).
2. No file in the diff matches `forbiddenPaths`.
3. Diff size within `maxDiffLines`.
4. Every commit message passes conventional-commit format.
5. If any path in `requireTestsFor` changed, at least one test file changed too.
6. No test file was deleted, and no test file's assertion count decreased. (Crude line-count
   heuristic is acceptable; flag rather than hard-fail on this one.)

Output a structured result: pass/fail plus a list of specific violations with file and line where
applicable. R0 must never call a model and must never take more than a few seconds beyond CI wait.

### R1 — contract reviewer (local model)

Only if R0 passed. Context handed to the model is **exactly**: the issue's acceptance criteria,
the unified diff, and the review checklist. Nothing else — no worker reasoning, no repo dump, no
PR description written by the worker.

Ask for strict JSON (both configured local models support JSON mode):

```json
{
  "verdict": "pass" | "fail",
  "unmetCriteria": [{ "criterion": "...", "why": "..." }],
  "concerns": [{ "file": "...", "line": 0, "note": "..." }],
  "confidence": "high" | "low"
}
```

Rules: parse strictly and retry once on malformed JSON, then fail closed to `needs-human` rather
than guessing. If the diff exceeds the local model's comfortable window, fall back to the configured
cheap remote and record the escalation in telemetry. `confidence: "low"` is treated as a fail — it
routes to a human, which is the correct cheap answer.

### Wiring

- Gate passes → label `agent:approved`, mark the PR ready for review, post the consolidated comment.
- Gate fails and rounds remaining → post the comment, label back to `agent:in-progress`, increment
  the round counter (store it as a label or in the PR body — not in a local file), re-invoke the
  worker with the review comment appended to its brief.
- Rounds exhausted → `agent:needs-human`, stop. **Do not attempt a third round under any
  circumstance.**

### Phase 1 acceptance

- A PR with a change under `vault/` is rejected by R0 without any model being called.
- A PR that fails CI never reaches R1 — verify by checking telemetry shows no R1 record.
- A deliberately incomplete PR (implements half the acceptance criteria) is caught by R1.
- A correct PR passes both gates and lands in `agent:approved`.
- Total model spend across all Phase 1 gate runs is zero or near-zero, since R1 is local.

---

## 5. Explicitly out of scope

Do not build: the Groomer, R2 adversarial review, Hermes integration, scheduled/launchd execution,
concurrent issues, a web UI, a state database, retry queues, or any merge automation. Leave clean
extension points — `reviewers/` takes another module, `workers/` takes another adapter — and stop.

The orchestrator must never merge a PR or push to the default branch. If the GitHub token you're
given has permission to do so, note it in the ledger as a risk to be fixed at the token level.

---

## 6. Definition of done

- Both phases' acceptance criteria demonstrably met, with evidence in the ledger.
- `README.md`: what it is, `doctor` first, the five commands, the config, how to add a worker.
- `docs/BUILD_LEDGER.md` accurate as of the final commit, including a "what I'd do differently"
  note and every deferred item.
- Tests covering: config validation, R0's six checks, R1 JSON parsing including the malformed case,
  worktree create/resume/teardown, and WIP-limit enforcement. Worker subprocesses are mocked —
  the test suite must not invoke a real agent CLI or a real model.
- A telemetry sample from at least three real runs, so the routing table can be tuned against
  actual numbers rather than estimates.
