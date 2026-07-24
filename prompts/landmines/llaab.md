# LLAAB review checklist

Repo-specific things that have slipped through review before. Treat any hit as a concern, not
automatically a fail — use judgement, but do not ignore these.

- Process-state invariant: status must be derived from `useRunMonitor`, never a mutation's
  `isPending`.
- No hardcoded `refetchInterval` overrides; no invalidate-on-every-poll-tick.
- No public API drift in `@llaab/llm` (`routeLlm` / `streamLlm` / `getLlmStatus`) unless the issue
  explicitly calls for it.
- No writes into the nested `vault/` repo, and nothing committed into it.
- No TS7 stale-`dist` workaround — a "fix" in a consumer package that is really papering over a
  build-order bug elsewhere.
- No test weakened or deleted just to make the suite go green.
- No promotion logic that runs Git, and no approval gate removed or bypassed.

This list is institutional memory — it grows every time something slips through. Add to it rather
than replacing entries.
