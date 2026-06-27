# TODO — Orchestration, Metrics & Cost Tracking

Backlog from the orchestration-metrics work. Phase 1 (instrumentation +
dashboard) is implemented; the items below are deferred follow-ups.

## Orchestration / Parallelism TODOs

- [ ] Make `maxFastConcurrency` / `maxStrongConcurrency` configurable from
      Settings (currently constants in `progressivePrdPipeline.ts`). Surface as
      an "advanced" control with sane defaults.
- [ ] Auto-tune concurrency caps based on observed 429/rate-limit responses
      (back off the per-tier cap on `RESOURCE_EXHAUSTED`, recover on success).
- [ ] Consider overlapping the optional consistency-review pass with
      independent downstream work where it's safe (today it's strictly after the
      DAG).
- [ ] Expose the artifact dependency layers' concurrency utilization the same
      way the PRD waves are shown.

## Metrics Dashboard TODOs

- [ ] Per-provider / per-model cost + token breakdown cards.
- [ ] Filter/sort the runs table (by project, type, date range, status).
- [ ] Optional richer charts (concurrency-over-time curve, cost trend) — kept
      out of Phase 1 to stay clean.
- [ ] Export a run's metrics as JSON/CSV for the portfolio writeup.
- [ ] A compact "last run" speedup badge in the workspace header that deep-links
      to `/metrics`.

## AI Cost Tracking TODOs

- [ ] Thread `onUsage` through `coreArtifactService` / `generateCoreArtifact` so
      **artifact** runs capture real tokens & cost (today only PRD runs do).
- [ ] Capture OpenAI image-generation cost for mockups (per-image pricing, not
      token-based) via `api/image/generate.js`.
- [ ] Calibrate `modelPricing.ts` against real billing and add a "pricing as of
      <date>" note; consider reading prices from a config rather than code.
- [ ] Account for context caching / batch discounts in the estimate.

## Workflow Reliability TODOs

- [ ] Capture streaming first-token latency where streaming is used.
- [ ] Track DAG-internal retries (transport-level `fetchWithRetry` attempts) and
      surface `retryCount` per node — currently only manual retries count.
- [ ] Optional server-side persistence/aggregation of `WorkflowRun`s (the PRD
      workspace is client-only today, so metrics are per-browser).
- [ ] Record interrupted/aborted runs as a distinct status instead of dropping
      them.
