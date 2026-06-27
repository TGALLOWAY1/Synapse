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

## Project Persistence / "projects disappearing" TODOs

See `docs/audits/projects-disappearing-2026-06-27.md` for the full root-cause
analysis. The recovery + observability fixes (R2, R4, R7) shipped; the items
below are the durable follow-ups that need backend work.

- [ ] **(R1 — the real cross-device fix)** Persist PRD projects server-side
      (MongoDB, keyed by `userId`) so they sync across mobile/web and survive a
      browser-data clear. Today the PRD workspace is 100% `localStorage`, so
      projects are device-local and can never appear on a second device. This is
      the single most-requested behavior ("see all previous projects across web
      and mobile") and is impossible without server storage. Suggested shape:
      a `projects` collection mirroring the persisted Zustand slices, with the
      client treating localStorage as a cache and the server as source of truth.
- [x] **(R3 — resolved)** Account linking: one human → one stable `userId`
      across email/GitHub/LinkedIn. Auto-link by verified email + explicit
      "Connect another sign-in method" in Settings, with non-destructive account
      merge and client-side project-namespace recovery (`mergedUserIds`). See
      `docs/audits/projects-disappearing-2026-06-27.md`.
- [ ] **(R3 follow-up)** When two populated accounts merge, migrate the absorbed
      account's **server-side** data (snapshots, encrypted `provider_keys` keyed
      by the old `userId`) to the survivor. Today only client-side project data
      (localStorage namespace) is merged; server data stays under the
      tombstoned `userId` and becomes unreachable via sign-in.
- [ ] **(R3 follow-up)** Add an email-verification flow so an email/password
      account can be safely auto-linked by email (currently it must be linked
      explicitly while signed in, because unverified emails can't be trusted for
      auto-link).
- [ ] **(R3 follow-up)** Let a user UNLINK a sign-in method (and surface which
      providers are connected with their emails) from Settings.
- [ ] **(R5)** Flush the pending debounced localStorage write before
      `applyProjectUser` retargets the storage key, so a fast auth switch can't
      drop user A's last in-flight write.
- [ ] **(R6)** When `localStorage` quota is exceeded, offer an actionable
      recovery path (export + delete oldest, or prompt to enable server sync)
      rather than only a one-time toast that then silently drops writes.
- [ ] Consider an explicit "Export all projects" / "Import projects file"
      backup affordance so users have a manual cross-device escape hatch until
      R1 ships.

## Workflow Reliability TODOs

- [ ] Capture streaming first-token latency where streaming is used.
- [ ] Track DAG-internal retries (transport-level `fetchWithRetry` attempts) and
      surface `retryCount` per node — currently only manual retries count.
- [ ] Optional server-side persistence/aggregation of `WorkflowRun`s (the PRD
      workspace is client-only today, so metrics are per-browser).
- [ ] Record interrupted/aborted runs as a distinct status instead of dropping
      them.
