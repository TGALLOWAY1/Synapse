# TODO — Orchestration, Metrics & Cost Tracking

Backlog from the orchestration-metrics work. Phase 1 (instrumentation +
dashboard) is implemented; the items below are deferred follow-ups.

## Orchestration / Parallelism TODOs

- [ ] Make `maxFastConcurrency` / `maxStrongConcurrency` configurable from
      Settings (currently constants in `progressivePrdPipeline.ts`). Surface as
      an "advanced" control with sane defaults.
- [ ] Auto-tune concurrency caps based on observed 429/rate-limit responses
      (back off the per-tier cap on `RESOURCE_EXHAUSTED`, recover on success).
- [ ] Consider overlapping the automatic consistency-review pass (now default-on)
      with independent downstream work where it's safe (today it's strictly after
      the DAG).
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

- [x] **(R1 — the real cross-device fix) — shipped.** PRD projects now persist
      server-side (MongoDB `projects` collection, keyed by `userId`), syncing
      across mobile/web and surviving a browser-data clear. localStorage is kept
      as the live cache/offline fallback; the server is the cross-device source.
      See `docs/SERVER_PROJECT_STORAGE.md`. Implemented as: `api/_lib/projectsStore.js`
      (owner-scoped data layer + indexes), `api/projects.js` (session-gated CRUD),
      and the client sync layer (`projectBundle.ts`, `projectsClient.ts`,
      `projectServerSync.ts`, `projectSyncStore.ts`; upload state derives from
      durable `projectSyncMeta`).

  Deferred follow-ups for server project storage:
  - [ ] **Conflict resolution.** Pull is currently *additive* — a server project
        only loads onto a device that doesn't already have it locally; an
        existing local copy is never overwritten from the server. So editing the
        same project on two devices leaves each device with its own copy until a
        push reconciles. Add per-project version/`updatedAt` vectoring (or a
        last-writer-wins with a visible "this device is behind" prompt) so a
        newer server revision can safely refresh a stale-but-clean local copy.
  - [ ] **Offline write queue.** Pushes that fail while offline currently retry
        on the next local change or manual "Retry". Add a durable outbound queue
        that flushes automatically on reconnect, independent of further edits.
  - [ ] **Image/asset bodies.** Mockup and screen-inventory images live in
        separate localStorage stores and are NOT in the project bundle, so they
        don't yet sync. Move them to Vercel Blob (like snapshots) and reference
        them from the bundle so generated visuals follow the project across
        devices.
  - [ ] **Granular saves.** The client pushes the whole project bundle on any
        change (debounced). For very large projects, switch to per-collection
        PATCH (e.g. only the changed spine/artifact) to cut payload size.
  - [ ] **Shared workspaces / collaboration.** Access is strictly single-owner
        today (every query is `userId`-scoped). A future shared-project model
        would add a membership/ACL collection and relax the owner-only filter.
  - [ ] **Public project links.** No public/shared read path exists yet (the
        endpoint never serves a project to a non-owner). A future read-only
        public-link feature would add an explicit, opt-in share token separate
        from owner access.
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

## Cross-device image sync TODOs

Image durability for the per-user `/api/projects` path is implemented for
**mockup** images (bytes → Vercel Blob, refs → `project_images`, lazy hydration;
see CLAUDE.md "Cross-device mockup image sync"). Follow-ups:

- [ ] Wire **Screen Inventory** upload images (`screenInventoryImageStore.ts`)
      onto the same ref layer. The ref store is already generic (`kind:
      'screen_inventory'`, opaque `meta`); needs a push/pull path analogous to
      `projectImageSync.ts` and a hydration hook in the screen-inventory image
      consumer. Blob path prefix can stay `users/<userId>/mockup-images/` or be
      generalized to `users/<userId>/images/`. **This also covers the
      `user_uploaded` mockup image source mode** (PR #168): user-uploaded mockups
      persist to `screenInventoryImageStore`, so they only become cross-device
      once this store is wired. Today only `gpt_image` (AI-generated) mockups sync.
- [ ] **Eager GC for per-image overwrite / version regen.** Today a new render
      (new hash → new blob) leaves the prior blob/ref until project hard-delete.
      Add a sweep (or wire `deleteProjectImageRefs` into `deleteImagesForVersion`
      / regen paths) that refcount-GCs blobs no longer referenced by any live
      key. `image-ref-delete` already exists for this.
- [ ] Reconcile server-newer images per-key (today push is local-keys-out,
      pull is refs-in for hydration; there's no per-image conflict resolution,
      matching the text-bundle "local wins" stance).
- [ ] Consider switching to signed/expiring read URLs if mockups ever carry
      sensitive content (current decision: public + unguessable content-addressed
      path, for direct browser downloads).

## Lean PRD follow-ups (data_model / implementation_plan sections retired)

Deferred from the lean-PRD change (PRD = decision document; detail lives in
the dedicated artifacts).

- [ ] **Renderer-parity test** for the two mirrored PRD renderers
      (`prdMarkdownRenderer.renderPremiumMarkdown` vs
      `StructuredPRDView`/`PremiumSections`): CLAUDE.md mandates their section
      order stays in sync, but nothing asserts it. Consider extracting a shared
      SECTION_ORDER constant both consume, then asserting against it.
- [ ] **User Flows "Related Artifacts" phase chips**: new PRDs no longer carry
      `structuredPRD.implementationPlan`, so `RelatedArtifactsPanel` loses its
      implementation-phase cross-links (graceful — optional prop). If the chips
      are worth keeping, source them from the implementation_plan *artifact*'s
      structured JSON instead of the retired PRD field.
- [ ] **Artifact prompt hints**: data_model / screen_inventory artifact
      generation lost the PRD-embedded schema/page-spec hints from the markdown
      body (intended — single source of truth per concern). If artifact quality
      regresses, thread `domainEntities`/lean `uxPages` into those artifacts'
      structured `prdSummary` context in `coreArtifactService.ts` rather than
      re-fattening the PRD.
- [ ] **Dead `PRD_GENERATION_STAGES` labels** in `src/components/generationStages.ts`
      still mention "Defining data model…" but have no consumers — remove the
      dead exports in a cleanup pass.
