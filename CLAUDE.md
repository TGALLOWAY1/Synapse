# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Synapse — "From plain-language to product blueprint" — is an AI-native product
definition environment that transforms a plain-language prompt into a
structured PRD, then into UI mockups, downstream artifacts (screen inventory,
data model, etc.), and visual annotations. The product workspace is a
local-first React SPA — all PRD/branch/artifact state lives in localStorage via
Zustand and that remains the live cache, but signed-in users' projects also
**sync to a server `projects` collection** so they follow the user across
devices (see "Server-side project storage" below). A Vercel-hosted backend
(under `api/`) powers both that project sync and a separate recruiter-portal
sub-product with OAuth, MongoDB, and snapshot storage.

## Documentation rule

**Keep this file in sync with the code in the same change.** Whenever you
add, remove, or meaningfully alter architecture, data flow, state slices,
the LLM pipeline, domain types, or a cross-cutting pattern (e.g. the PRD
selection pipeline), update the relevant section of CLAUDE.md as part of
the same commit — do not leave it for a follow-up. If a change makes an
existing description wrong, fix the description; if it introduces a
pattern others must follow or must not break, document it here as a rule.
Treat docs drift as a defect in the change itself.

### README rule

`README.md` is the **public-facing** description of Synapse and must not drift
from reality. Whenever a change adds, removes, or meaningfully alters a
**user-visible feature, capability, or workflow** — a new pipeline stage, a new
artifact or asset type, a behavior shown in the interactive tour
(`src/components/tour/`), a change to supported models/providers, the safety
gate, preflight clarification, snapshots, or the getting-started flow — review
`README.md` in the same change and update it:

- Keep the feature tour aligned with the live product tour's six-beat narrative
  (Idea → Spec generation → Refine → Versions → Assets → Connections) so the
  README and `/tour` tell the same story.
- Keep referenced screenshots in `public/screenshots/` and the screenshots a
  feature describes consistent with the current UI; if a screenshot no longer
  matches, flag it rather than leaving a misleading image.
- Keep the tech-stack list (models, providers, libraries) accurate — e.g. the
  default Gemini model id and any image model.

If a change touches a user-visible feature but you are unsure whether the
README needs an edit, **surface it to the user** ("this looks like a
README-worthy change — want me to update it?") rather than silently letting the
README go stale. Significant new features should never ship without a
corresponding README update or an explicit decision to skip it.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Vite dev server at http://localhost:5173
npm run build        # tsc -b && vite build (TS check is part of build)
npm run lint         # ESLint flat config, TS/TSX only
npm run preview      # Preview production build
npm test             # vitest run (one-shot)
npx vitest <file>    # Run a single test file in watch mode
```

### Required pre-push gate (do not skip — this is what Vercel runs)

**Before committing/pushing, you MUST run `npm run build` and `npm run lint`
and both MUST pass.** Vercel's PR deployment check runs `npm run build`
(`tsc -b && vite build`), so a type error anywhere under `src/` (including test
files, which are part of the `tsconfig.app.json` project) **fails the Vercel
check and blocks the PR** — even if the app code is fine.

- **Do NOT validate types with `tsc --noEmit`.** The root `tsconfig.json` is a
  solution-style file (`files: []` + project `references`), so `tsc --noEmit`
  type-checks *nothing* and reports a false "clean". It is a trap. The only
  authoritative type check is **`tsc -b`** (what `npm run build` runs) — it
  builds the referenced `tsconfig.app.json` / `tsconfig.node.json` projects and
  is stricter (e.g. it rejects `X as Record<…>` casts that need
  `X as unknown as Record<…>`, and flags `string | undefined` passed where
  `string | null` is required).
- **Test files are type-checked by the build.** Tests under `src/**/__tests__/`
  compile with the app, so a typing slip in a test (e.g. destructuring a Vitest
  `mock.calls[0]` tuple, or an over-narrow `as` cast) breaks the Vercel build
  exactly like app code. Keep test TS as strict as production TS. `api/`
  serverless files are plain JS and aren't type-checked, but their tests still
  run under `npm test`.
- ESLint has **no `_`-prefix unused-arg exemption** — don't add unused
  underscore-prefixed params to satisfy types; cast the access site instead.

**Vercel Hobby serverless-function cap (hard limit: 12).** Every `.js` file
under `api/` (excluding `_lib/` and `__tests__/`, which are underscore-prefixed
and ignored) is one serverless function, and the deployment **fails** if there
are more than 12. The repo currently sits at **11** — so adding a new top-level
`api/*.js` endpoint is the kind of change that can break the deploy. If you need
a new endpoint and you're at the cap, **consolidate**: fold cohesive routes into
one handler that dispatches on a `?action=` (or method) param, and preserve the
original public URLs with `vercel.json` `rewrites` (e.g. the email-auth trio
login/signup/logout is one function, `api/auth/email.js`, behind rewrites). Do
not exceed 12.

Tests live in `src/lib/__tests__/`, `src/store/__tests__/`,
`src/components/__tests__/`, and `api/_lib/__tests__/` (+ `api/__tests__/`).
There is no Playwright suite despite the dev dependency.

## Tech Stack

- React 19 + TypeScript + Vite 7
- Tailwind CSS 3 + tailwind-merge + clsx
- framer-motion (page/drag transitions in the interactive product tour)
- Zustand 5 with `persist` middleware (debounced localStorage)
- Google Gemini API called directly from the browser; key in localStorage
- React Router v7 (workspace, recruiter portal, admin pages, the interactive
  product tour at `/tour` + `/about` alias, /privacy)
- Deployed to Vercel (SPA + Node serverless functions under `api/`)

## Architecture

### Two parallel sub-products

This repo holds **two separate products** that share the Vite build but
otherwise have nothing in common — keep that distinction in mind:

1. **PRD workspace** (the "real" Synapse product) — `src/components/HomePage.tsx`
   and `src/components/ProjectWorkspace.tsx` mounted at `/` and
   `/p/:projectId`. State is local-first: localStorage via Zustand is the live
   cache, and Gemini is still called directly from the browser. For signed-in
   users it **also syncs projects to the `api/` backend** (`/api/projects`) so
   they're durable and cross-device — see "Server-side project storage" below.
   (Anonymous/dev-skip-auth use stays fully local.)

2. **Recruiter portal** — `src/components/LoginPage.tsx`,
   `src/components/RecruiterAdminPage.tsx`, mounted at `/admin/recruiters`
   plus the `/api/auth/*`, `/api/session`, `/api/activity`,
   `/api/snapshots`, `/api/admin/recruiters` endpoints. Server-side state
   in MongoDB; OAuth via GitHub/LinkedIn; auth glue lives in
   `src/lib/recruiterApi.ts` and `src/lib/snapshotClient.ts`. Backend
   handlers are in `api/` (Node serverless), with shared helpers in
   `api/_lib/`. **DB access:** `api/_lib/db.js` exposes `runMongoAction(action,
   payload)` (actions: findOne/find/insertOne/updateOne/deleteOne/aggregate/
   createIndexes) backed by the official **MongoDB Node driver** with a cached
   connection pool — configured via `MONGODB_URI` (+ optional `MONGODB_DB_NAME`).
   The old Atlas Data API REST gateway was retired by MongoDB (2025-09-30); the
   shim preserves the prior call/return shapes so call sites are unchanged.

### Server-side project storage (`api/projects.js`, `api/_lib/projectsStore.js`, `src/store/projectServerSync.ts`)

PRD projects sync to a MongoDB `projects` collection so a signed-in user sees the
same projects on every device. **Architecture is local-first**: the Zustand store
+ localStorage is unchanged and remains the live, offline-capable cache; a sync
layer pulls server projects in on sign-in and pushes local changes out. See
`docs/SERVER_PROJECT_STORAGE.md` for the root-cause (localStorage is
device-scoped and never syncs) and full design.

- **Server.** `api/_lib/projectsStore.js` is the owner-scoped data layer — one
  doc per project keyed by the client UUID (`id`), with denormalized
  `title`/`idea`/`status`/`archived`/`deletedAt` for list/index queries and the
  full nine-collection bundle in `data`. **Access control is RLS-equivalent:**
  every function takes `userId` first and pins `{ userId }` into the Mongo
  filter, so one user's query can never match another's row; `userId` always
  comes from the verified session (`requireUser`), never the request body.
  `ensureProjectIndexes()` (idempotent, cached per warm instance) creates the
  `{userId,id}` unique + `{userId,updatedAt}` / `{userId,status}` /
  `{userId,deletedAt}` indexes via the new `createIndexes` db action.
  `api/projects.js` is the session-gated, rate-limited CRUD endpoint (list,
  fetch-one, PUT upsert — covers PRD/artifact saves, bulk import, soft-delete/
  restore, archive toggles, hard-delete). No public/shared access exists.
- **Client serialization.** A **ProjectBundle** (`src/lib/projectBundle.ts`,
  pure) is the transport unit: `extractProjectBundle` gathers a project's nine
  store slices; `mergeBundlesIntoSource` merges server bundles back **additively
  — local always wins on id collision** (a pull only ADDs projects this device
  lacks; it never clobbers local in-progress work — per-project server-newer
  reconciliation is deferred, see `tasks/TODO.md`). `src/lib/projectsClient.ts`
  is the `/api/projects` transport (`credentials: 'include'`; throws on non-2xx
  so a failure never silently drops projects).
- **Sync orchestrator** (`src/store/projectServerSync.ts`). `startProjectSync`/
  `stopProjectSync` are driven from `authStore.setUser`. On sign-in it
  **reconciles** (pull server projects this device is missing → apply; upload
  local-only projects → migrate) then subscribes to the store to **push**
  changed projects (debounced, per-project) and remote-delete locally-deleted
  ones. **A failed save never drops local data** — it stays in localStorage and
  surfaces a per-project `error` sync state. `suspendPush` silences the echo
  while applying pulled bundles. The read-only demo project
  (`DEMO_PROJECT_ID`) is never synced.
- **Sync UI state** (`src/store/projectSyncStore.ts`,
  `src/components/sync/ProjectSyncStatus.tsx`). Overall `phase`
  (idle/loading/ready/error) + `online` + per-project saving/saved/error/dirty,
  surfaced in `ProjectDrawer` (a `SyncStatusBanner` with a retry on failure, a
  per-row `ProjectSyncDot`, and a loading guard so the drawer never flashes a
  false "no projects" state while the session or initial pull is resolving).
- **Migration markers** (`src/lib/projectMigration.ts`). A per-user localStorage
  set (`synapse-projects-server-migrated::u:<userId>`) of project ids already
  pushed. The server upsert is idempotent on the stable UUID, so duplicates are
  impossible regardless; the markers power the "N local projects uploaded"
  state and avoid redundant re-uploads. **Local projects are never deleted on
  import.** This is distinct from the anonymous→account *legacy* import
  (`userScope.ts`); after a legacy import, `HomePage` triggers a server
  reconcile so the newly-claimed projects upload to the account.

### LLM layer (`src/lib/`)

- **`geminiClient.ts`** — low-level Gemini transport. Two modes:
  `callGemini()` (sync JSON) and `callGeminiStream()` (SSE). Both wrap fetch
  in `fetchWithRetry` for connection-level transient errors;
  `callGeminiStream` *also* wraps the entire fetch+reader in a stream-level
  retry, so a mid-stream mobile-network drop reconnects from byte zero.
  Stream callers should implement `StreamCallbacks.onRestart` to reset any
  chunk-derived state (char counters, phase trackers) when the stream is
  re-attempted. `isRetryableNetworkError` is exported for callers that
  need to reason about retry policy.

- **`services/`** — one file per AI feature. Importing through the
  `llmProvider.ts` barrel keeps legacy call sites stable.
  - `prdService.ts` → `progressivePrdPipeline.ts` → `progressivePrdGeneration.ts`
    — PRD generation runs as a **dependency-graph (DAG) pipeline**, not in
    document order. `DEFAULT_PRD_SECTIONS` (10 schema-aligned sections in
    `progressivePrdGeneration.ts`) each declare `dependencies` that are **true
    data dependencies only** — a section lists another solely when it consumes
    that section's output as prompt context. `runDag()` runs every section whose
    deps are satisfied concurrently, under separate per-tier concurrency caps
    (`maxFastConcurrency` / `maxStrongConcurrency`); low-risk sections use the
    fast (Flash) model, high-risk the strong (Pro) model. `validateGraph()` runs
    first and throws on unknown-dependency references or cycles (Kahn's
    algorithm) so a broken graph fails loudly instead of silently dropping
    sections. Each section emits a typed slice of `StructuredPRD`; slices are
    merged deterministically (`prdSectionMerge.ts`, disjoint top-level fields)
    and markdown is rendered via `prdMarkdownRenderer.ts`. Do **not** re-add
    edges to sequence sections by document position — only by real data flow.
    The legacy multi-pass scoring + revision passes were removed — old projects
    in localStorage retain their saved `qualityScores`, but no new generation
    writes them.
    - **User project name → `productName`.** The name the user types when
      creating a project is threaded into generation as an optional
      `projectName` (call site `runPrdGeneration`/`ProjectWorkspace.handleRegenerate`
      → `generateStructuredPRD` → pipeline → `generateProgressivePrd` →
      `SectionPromptContext.projectName`). The `product_basics` builder
      (`prdSectionPrompts.ts`) makes it the **authoritative** `productName` so the
      PRD (and every downstream artifact/mockup, which read `productName`) use the
      name the user chose instead of one the model invents. A generic-placeholder
      guard (`isMeaningfulProjectName` / `GENERIC_PROJECT_NAMES`: "untitled",
      "test", "my app", …) drops names with no product intent so the model is
      still free to coin one. `runPrdGeneration` reads the name from the store by
      `projectId`; pass it explicitly from any new direct `generateStructuredPRD`
      call site.
    - **Optional final consistency review** (`prdConsistencyReview.ts`): off by
      default (one extra fast-model call). When enabled (localStorage
      `synapse-prd-consistency-review === 'true'`, threaded through as
      `enableConsistencyReview`), it reconciles terminology / names /
      contradictions across the merged PRD. It **merges over the original**
      (omitted fields preserved) and a **detail-loss guard** discards any
      revision that would shrink/empty a key content array; on apply it sets
      `generationMeta.revised` and adds a `consistency_review` pass record.
    - **Observability** (`prdGenerationLog.ts`): structured, debug-gated logs
      (`synapse-prd-debug` / `?prddebug`) for queued/started/completed/failed,
      retry, run summary, model, est-vs-actual, and `surface` (mobile/web).
  - `mockupService.ts` + `mockupImageService.ts` — mockup HTML and image
    generation.
  - `coreArtifactService.ts` — the 7 core artifact types
    (screen_inventory, data_model, component_inventory, user_flows,
    implementation_plan, prompt_pack, design_system). **Complexity-based model
    routing (mirrors the PRD pipeline):** each subtype is tagged in
    `CORE_ARTIFACT_COMPLEXITY` as `low`/`high`, and `selectArtifactModel()`
    resolves a `high` artifact (screen_inventory, user_flows, data_model,
    implementation_plan) to the Expert/Pro model (`getStrongModel`) and a `low`
    artifact (component_inventory, design_system, prompt_pack) to the Fast/Flash
    model (`getFastModel`) — both configured in Settings → "PRD Generation
    Models" and shared with the PRD pipeline (when tier models are unset, both
    resolvers fall back to the single "Intelligence Level" `GEMINI_MODEL`). The
    resolved model is threaded into every generate **and** refine call, and
    `artifactJobController` records that same per-subtype model in workflow
    metrics (previously it always reported the strong model). Keep
    `CORE_ARTIFACT_COMPLEXITY` in sync when adding a `CoreArtifactSubtype`.
    Three of these
    (screen/data/component inventory) use Gemini JSON mode with schemas in
    `schemas/artifactSchemas.ts`, then convert to markdown via
    `structuredArtifactToMarkdown()` for storage; renderers in
    `src/components/renderers/` parse that markdown back to card layouts.
    The `component_inventory` renderer is a mobile-first, searchable
    component library (sticky search + category/complexity/used-in
    filters, expandable cards with live previews) decomposed under
    `src/components/renderers/componentInventory/`. Its schema/types carry
    optional `accessibility`, `previewType`, and per-prop `required`
    fields (all backward-compatible — older saved inventories lack them);
    when absent, `inferPreview.ts` derives a `previewType` and a
    heuristic, review-flagged accessibility contract at render time so
    every card still shows a preview and a dedicated a11y block.
    `componentInventoryParse.ts` round-trips all these fields through
    markdown.
  - `branchService.ts` — branch consolidation back into the spine.
  - `preflightService.ts` — optional pre-PRD clarification (see "Preflight
    clarification" below). `generatePreflightQuestions()` (safety-gated) and
    `generatePreflightSummary()`; both inject transports for tests and degrade
    to fallbacks (generic question set / local recap) on non-safety failure.
  - `artifactJobController.ts` — concurrency control for artifact bundle
    generation.
- **`prompts/prdPrompts.ts`** — strategy system instruction; the
  `RUBRIC_DEFINITION` "quality bar" is appended so Pass A self-targets the
  rubric in its first response. `SAFETY_OVERRIDE` is prepended ahead of all
  formatting/rubric text in every section preamble (`prdSectionPrompts.ts`) as
  defense-in-depth.

### Safety gate (`src/lib/safety/`)

Every PRD generation path runs through one chokepoint —
`generateStructuredPRD()` in `prdService.ts` — which calls
`classifyProjectSafety()` **before** any section runs. This is a hard,
**code-level** guardrail (not just a prompt): it stops Synapse from emitting a
malformed PRD where each section independently refuses ("I cannot fulfill this
request…").

- The classifier (`classifyProjectSafety.ts`) returns a `SafetyClassificationResult`
  (`allowed` | `allowed_with_restrictions` | `disallowed`) via Gemini JSON mode
  (`schemas/safetySchemas.ts`). Transport is injectable for tests.
- **`disallowed`** → `generateStructuredPRD` throws `SafetyBlockedError`; the
  pipeline never runs. Call sites (`HomePage`, `ProjectWorkspace.handleRegenerate`)
  catch it and persist a `blocked` `SpineVersion.safetyReview` (+ a canonical
  Safety Review markdown as `responseText`) via `setSpineSafetyReview`.
- **`allowed_with_restrictions`** → a restriction directive is appended to the
  prompt; the run records a `restricted` review and the PRD renders with a
  `SafetyBoundariesCard`.
- **Fail-closed:** if classification can't be determined (non-config transport
  error or unparseable output) the request is treated as `disallowed`. Genuine
  *config* errors (api key / auth / billing / permissions) are re-thrown to the
  normal error path.
- **UI / downstream gating keys off `SpineVersion.safetyReview.status === 'blocked'`:**
  `ProjectWorkspace` renders `SafetyReviewView` instead of the PRD,
  `handleToggleFinal` no-ops, the workspace render guard excludes it, and
  `artifactJobController.startAll` early-returns — so a blocked spine can never
  drive workspace/screens/architecture/implementation artifacts. Domain types
  (`SafetyClassification`, `SafetyClassificationResult`, `SpineSafetyReview`)
  live in `src/types`; the safety module re-exports them.

### Preflight clarification (`src/lib/services/preflightService.ts`, `src/components/preflight/`)

An **optional** pre-PRD step. After entering an idea on `HomePage`, a
`PreflightModeChoice` sheet offers **Generate Immediately** (unchanged path),
**Quick** (5 questions), or **Deep** (10 questions). Quick/Deep create the
project + spine, seed a `PreflightSession` via `initPreflightSession`, and
navigate to `/p/:projectId` **without** starting PRD generation.

- **State lives on the spine** — `SpineVersion.preflightSession`
  (`PreflightMode`/`PreflightQuestion`/`PreflightStatus`/`PreflightSession` in
  `src/types`), persisted with `spineVersions` (resumable across refresh; no
  `partialize` change). Store actions are on `spineSlice`
  (`initPreflightSession`, `setPreflightQuestions`, `setPreflightAnswer`,
  `setPreflightIndex`, `setPreflightSummary`, `completePreflightSession`,
  `setPreflightError`).
- **Hosted in the workspace.** `ProjectWorkspace` renders `PreflightView`
  (one question per card, progress, Skip/Back/Next, pinned safe-area CTA,
  AI-generated summary → Edit answers / Generate PRD) instead of the PRD/
  progress view while `preflightSession` exists, is not `completed`, has no
  `structuredPRD`, and isn't `blocked`.
- **Safety runs first.** `generatePreflightQuestions()` calls
  `classifyProjectSafety()` before producing any questions — a `disallowed`
  idea throws `SafetyBlockedError`, which `PreflightView` persists as a blocked
  `safetyReview` so the existing `SafetyReviewView` shows and no questions/PRD
  are produced. Non-safety failures fall back to a generic question set
  (flagged `usedFallback`) / a deterministic local summary, never blocking.
- **PRD integration.** Generation goes through the shared
  `src/lib/runPrdGeneration.ts` helper (used by both HomePage and
  `PreflightView`). On **Generate PRD**, `completePreflightSession` runs, then
  `generateStructuredPRD` is called with an `options.preflight`
  (`PreflightContext`) — answered/skipped responses + summary/assumptions/
  unknowns. `prdService` appends `buildClarificationPromptBlock()` (the
  authoritative-intent instruction; skipped → open unknowns) to the prompt
  **after** the safety gate, so every section receives it via `ctx.idea`.

### State (`src/store/`)

`useProjectStore` is one Zustand store composed from 10 slices in
`src/store/slices/`:

- `projectSlice` — Project CRUD, current stage
- `spineSlice` — SpineVersion CRUD, structured PRD updates, generation
  errors. Branches fork from highlighted spine text and consolidate
  back via `branchService.consolidateBranch()`. Spine versioning uses
  `isLatest`/`isFinal` flags. Spine ids are opaque — new versions
  (`regenerateSpine`, `mergeBranch`) get UUIDs, while the first spine and
  legacy localStorage data keep `v1`-style ids. Never parse a version
  number out of the id; display labels ("Version N") derive from array
  position. **Generation lifecycle:**
  `SpineVersion.generationPhase` (`'running' | 'complete'`, optional —
  legacy spines lack it) is stamped `'running'` by
  `markSpineGenerationStarted` when a PRD run actually begins (both
  entry points: `runPrdGeneration.ts` and
  `ProjectWorkspace.handleRegenerate`) and flipped to `'complete'` by
  every settle path (`updateSpineStructuredPRD` with `generationMeta`,
  `setSpineError`, blocked `setSpineSafetyReview`). New generation entry
  points must stamp it too, or interrupted-run recovery won't see them.
  **Edits append versions (never overwrite):** all user PRD edits and
  single-section retries go through `editSpineStructuredPRD` (clones the
  current spine, applies the new `structuredPRD`/`responseText`, becomes the
  new `isLatest`, stamps `provenance.changeSource`/`editSummary`, pushes an
  `Edited` history event) — the in-place `updateSpineStructuredPRD`/
  `updateSpineText` are now reserved for **live streaming generation** only.
  `revertSpineToVersion` restores a historical spine by appending a new latest
  clone (`changeSource: 'revert'`, `Reverted` event) — old versions are never
  mutated or deleted. `VersionProvenance` (on `SpineVersion` and
  `ArtifactVersion`, all-optional/back-compat) records change attribution.
- `branchSlice` — Branches and their messages
- `artifactSlice` — Artifacts + ArtifactVersions; preferred-version
  tracking; source-ref staleness detection against the current spine.
  `revertArtifactToVersion` restores an older version by appending a **cloned**
  `ArtifactVersion` (increments `versionNumber`, becomes preferred, carries
  `sourceRefs`, `Reverted` event) rather than only re-pointing `isPreferred`
  via `setPreferredVersion` — keeps the audit log honest.
- `feedbackSlice` — FeedbackItems with intent classification
- `stalenessSlice` — Staleness checks
- `generationJobsSlice` — Per-project job tracking (transient; stripped
  from persistence)
- `prdProgressSlice` — Live progress event log for the PRD generation UI
  (transient; stripped from persistence). Consecutive-duplicate-deduped.
- `tasksSlice` — Persisted implementation tasks (`ProjectTask[]` keyed by
  projectId). `saveTasks` persists an extracted set for an Implementation
  Plan artifact, replacing the prior set for that artifact while preserving
  the `status`/`externalRefs` of tasks whose id still exists; `setTaskStatus`
  (todo/in_progress/done) and `recordTaskExports` (attach created
  GitHub/Linear issue refs) drive progress tracking. **Persisted** — not
  stripped from localStorage.
- `metricsSlice` — Persisted orchestration metrics (`WorkflowRun[]` keyed by
  projectId, newest-first, capped at 50/project). `recordWorkflowRun` appends a
  run; `getWorkflowRuns`/`getAllWorkflowRuns`/`clearWorkflowRuns` read/clear.
  Append-only and **persisted** — the metric math lives in `src/lib/metrics/`
  (pure) before a run is recorded. Cleaned up in `deleteProject` and included
  in `emptyPersistedState()` (`projectUserSync.ts`). See "Orchestration metrics"
  below.

The store's `partialize` strips `jobs` and `prdProgress` so they don't
persist. `onRehydrateStorage` migrates legacy `currentStage` values
(`devplan`/`prompts`/`mockups`/`artifacts` → `prd` or `workspace`) and runs
`markInterruptedGenerations` (`src/store/interruptedGeneration.ts`): a page
load kills any in-flight PRD pipeline, so spines still marked
`generationPhase: 'running'` — or carrying the legacy `'Generating PRD...'`
placeholder with no structured PRD — are converted into a settled
`generationError` (`category: 'interrupted'`), which renders the existing
error card with Try Again instead of an eternal "Generating…" state. Spines
with an open preflight session or a blocked safety review are skipped.

**Concurrency rule:** store actions that append a version (e.g.
`createArtifactVersion`, `regenerateSpine`, `mergeBranch`) must do **all** state
reads (version counts, preferred-version unmarking, array maps) **inside** the
`set((state) => …)` updater using the `state` arg — never from a `get()`
snapshot taken before `set()` runs. The 7 core artifacts generate concurrently
(`artifactJobController`), so a read-then-write against a stale snapshot loses
the other in-flight slot's update. Validation that must `throw` may read via
`get()` outside `set()`, but the mutation itself reads `state`.

**Selector stability rule:** Zustand selectors must return a stable reference
when the underlying state is unchanged — otherwise React's
`useSyncExternalStore` sees a snapshot change on every render, schedules
another update, and after ~50 nested updates aborts with the cryptic
`Minified React error #185` (Maximum update depth exceeded). A literal
`?? []` / `?? {}` fallback in a selector (e.g.
`useProjectStore(s => s.tasks[projectId] ?? [])`) allocates a fresh empty
container each call and is the canonical trigger. Use a **module-level**
stable constant (`const EMPTY_TASKS: ProjectTask[] = []; … ?? EMPTY_TASKS`)
or read via a getter outside the selector. This bit `ArtifactWorkspace` and
`TaskChecklist` and broke the demo project, since the demo never has saved
tasks. Regression: `src/components/__tests__/ArtifactWorkspaceTasksSelector.test.tsx`.

**Persistence (`storage.ts`):** the debounced localStorage writer wraps every
`setItem` in try/catch — a `QuotaExceededError` surfaces a one-time sticky toast
(via `toastStore`) instead of throwing and silently killing all future
persistence. It flushes pending writes on `beforeunload`, `pagehide`, **and**
`visibilitychange → hidden` (the last two are the reliable mobile lifecycle
events).

### User accounts, per-user projects & encrypted provider keys

See `docs/AUTH_AND_PROVIDER_KEYS.md` for the full design. Key cross-cutting
rules:

- **Auth is the existing recruiter-portal system, now enforced.** The client
  bypass (`authStore.DEV_SKIP_AUTH`) is off by default — it only applies in
  local dev when `VITE_DEV_SKIP_AUTH=true`. `RequireAuth`/`ProjectRoute` in
  `App.tsx` gate the workspace (the read-only `DEMO_PROJECT_ID` stays public).
  Every private API route resolves identity **only** through
  `api/_lib/requireUser.js` (verified session cookie) — never a client-supplied
  id. **Sign-out** is exposed in the `HomePage` header and the
  `ProjectWorkspace` overflow menu; `authStore.logout()` clears the session
  cookie, the in-memory provider session, and (via
  `providerSession.clearLocalProviderKeys()`) the active user's local credential
  keys. The local credential keys (`GEMINI_API_KEY`/`OPENAI_API_KEY`/
  `GITHUB_TOKEN`) are **namespaced per user** in `localCredentials.ts` (suffixed
  `::u:<userId>`, mirroring the project store) so one account's local keys are
  never readable by another on the same browser; a one-time per-key migration
  moves any pre-existing un-namespaced key into the active user's namespace and
  deletes the shared global copy. **All credential reads/writes must go through
  `localCredentials.ts`** (`getLocalCredential`/`setLocalCredential`/
  `removeLocalCredential`) — never `localStorage.getItem('GEMINI_API_KEY')`
  directly (that reads the wrong/shared key). Logout clears them on an
  **explicit** logout only, not on passive "no session" resolution. The header
  signed-in label derives from `user.authProvider` (`HomePage.providerLabel`) —
  don't hardcode a provider name.
- **Projects are namespaced per user in localStorage.** `userScope.ts` maps the
  active `userId` to the persist key (`createDebouncedStorage`'s `resolveName`
  override); `projectUserSync.applyProjectUser()` wipes in-memory state and
  rehydrates from the new namespace on every auth transition (wired in
  `authStore`). **Pre-sign-in anonymous projects are NOT silently adopted** —
  silent first-signer adoption handed one user's projects to whichever account
  signed in first. Adoption is now **explicit opt-in**: `getLegacyImportOffer()`
  surfaces a `HomePage` banner, and only an informed click runs
  `importLegacyProjects()`; `declineLegacyImport()` suppresses re-prompts
  without claiming. The offer **persists for recovery** — it stays available
  while there are unclaimed, undeclined base-key projects the user does not
  already have (it is no longer suppressed merely because the user has some
  namespaced data of their own), and the import **merges additively** (existing
  ids always win, so a re-import can only add projects, never overwrite/delete
  one the user already has). **Do not** read the project store before
  `applyProjectUser` has run for the current user, and keep
  `emptyPersistedState()` in `projectUserSync` in sync with **both** the
  persisted slice fields **and** the slices re-persisted by
  `repersistCurrentState()`.
  - **Namespace-switch data-loss guard:** `applyProjectUser` wipes in-memory
    state (`setState(emptyPersistedState())`, which queues a *debounced* persist
    write of the empty state to the target namespace) and then calls
    `rehydrate()`. Zustand's `rehydrate()` loads stored data via the raw setter
    and does **not** persist, so `applyProjectUser` **must** re-persist the
    rehydrated state immediately after (`repersistCurrentState()`); otherwise the
    queued empty write flushes ~500ms later and clobbers the namespace's stored
    projects. Never remove that re-persist, and never add a code path that
    leaves an empty-wipe as the last queued write for a populated namespace.
  - **Auth-failure ≠ signed-out:** `fetchSession()` throws on a non-OK
    response, and `authStore` records `authError` (distinct from a clean
    sign-out) **without** calling `setUser(null)` — a transient session-fetch
    failure must not swap the project namespace or render the user as logged
    out, which makes projects look like they vanished. `HomeRoute` shows a
    retry panel and `ProjectDrawer` distinguishes signed-out / failed / empty.
    Opt-in lifecycle logging lives in `src/lib/projectsDebug.ts`
    (`synapse-projects-debug` / `?projectsdebug`).
  - **Account linking — one human → one stable `userId`:** because the project
    namespace is keyed by `userId`, the same person signing in with a different
    provider must resolve to the **same** account or their projects appear to
    vanish. The server identity model (`api/_lib/users.js`) supports this: a doc
    carries its primary identity plus `linkedIdentities[]` and `mergedUserIds[]`;
    `findUserByProviderIdentity` matches primary **or** linked identities and
    skips `mergedInto` tombstones. `upsertOAuthUser` **auto-links** an OAuth
    sign-in into an existing account when emails match **and the existing account
    is `emailVerified`** (never into an unverified account — takeover guard).
    **Explicit linking** while signed in goes through
    `GET /api/auth/link/:provider` (sets an HMAC-signed link-intent cookie,
    `api/_lib/linkState.js`) → the shared OAuth callback re-verifies the live
    session matches the intent and calls `linkProviderIdentity` (which
    non-destructively **merges** another owning account: moves its identities,
    records its id in `mergedUserIds`, tombstones it with `mergedInto`).
    `/api/session` exposes `mergedUserIds`, and `applyProjectUser(userId,
    mergedUserIds)` merges each absorbed account's namespace into the canonical
    one (`mergeNamespaceInto`, additive/idempotent) so already-split projects are
    recovered. UI: Settings → `ConnectedAccountsSection`. New auth return paths
    must go through `accountToSessionUser`/`toPublicUser` so linking fields are
    carried; account merge does **not** yet migrate server-side data (snapshots /
    `provider_keys`) — see `tasks/TODO.md`.
- **Provider keys live in an encrypted server vault** (`api/_lib/cryptoVault.js`
  AES-256-GCM, key from `SYNAPSE_KEY_ENCRYPTION_SECRET`; `providerKeys.js` Mongo
  `provider_keys` collection, one doc per `(userId, provider)`, bound via
  AES-GCM AAD `userId:provider`). `api/provider-keys.js` is the session-gated
  CRUD + connection-test endpoint; it returns **masked status only** (`…last4`),
  never key material. UI: `components/settings/ProviderKeysSection.tsx`.
- **Model routing:** OpenAI image gen is **fully proxied** server-side
  (`api/image/generate.js`; `openaiClient.ts` calls it, `hasOpenAIKey()` reads a
  primed flag, not localStorage). **Gemini stays client-side** (streaming would
  hit serverless `maxDuration`): `geminiKeyVault.ts` fetches the user's key into
  memory via `GET /api/provider-keys?material=gemini` (never persisted), with a
  legacy localStorage fallback. `providerSession.ts` primes/clears this runtime
  state on auth changes and Settings edits. Missing-key errors are explicit
  ("Add a Gemini API key in Settings to generate PRDs." / "…OpenAI…mockups.").
  New provider call sites must route through the vault, never expose a key, and
  never log one. **Pre-generation "has a key?" gates** (e.g. the HomePage
  submit/enhance buttons) must call `hasGeminiKey()` (vault-in-memory **OR**
  local fallback, mirroring `geminiClient`'s resolution), never check
  `localStorage` alone — a vault-only user has no localStorage key, so a
  localStorage-only gate wrongly routes them to Settings even though generation
  would succeed.

### Pipeline flow

```
User prompt → HomePage.handleCreateProject() → PreflightModeChoice
              ↓ (Generate Immediately) ──────────────┐
              ↓ (Quick / Deep)                        │
              PreflightView: questions → answers →     │
              summary → Generate PRD                   │
              ↓                                        ↓
              runPrdGeneration() → generateStructuredPRD()
              ↓
              Pass A streams structured JSON → onPartial paints draft
              ↓
              SpineVersion stored, currentStage='prd'
  PRD stage:       SelectableSpine / StructuredPRDView — text selection →
                   branch creation → AI conversation → consolidateBranch()
                   merges into spine (local or doc-wide scope, see
                   ConsolidationModal). Selection → action dialog runs
                   through the shared touch-aware pipeline (see "PRD
                   highlight → branch selection pipeline" below).
  Assets stage:    ArtifactWorkspace (bundle/individual gen, refine, validate)
                   + MockupsView (platform/fidelity/scope config)
                   + MarkupImageView (MarkupImageSpec → SVG via
                   MarkupImageRenderer). The `'workspace'` pipeline stage is
                   labeled **"Assets"** in `PipelineStageBar` (label-only; the
                   stage key/route is still `workspace`).
  History stage:   HistoryView — chronological timeline with diffs
```

### Post-finalization transition (Mark Final → Assets)

Marking a spine final must not dump the user back on something that looks like
the PRD again. `ProjectWorkspace.handleToggleFinal` (on the finalize edge)
starts artifact generation and shows `FinalizationSuccessModal` ("PRD
Finalized" — *being created* vs *ready*, keyed off an `assetsReady` presence
check of the 7 core artifacts + mockups) **without** switching stage. Its
**Open Assets** action (`handleOpenAssets`) switches `currentStage` to
`workspace` and arms a one-shot `finalizeAutoOpen` flag passed to
`ArtifactWorkspace` as `autoOpenIntent`. `ArtifactWorkspace` consumes it once
(via `onAutoOpenConsumed`): it auto-selects the first **non-PRD** artifact —
preferring `done`, then `generating`, then `queued`, else the first slot in
`CORE_ARTIFACT_DISPLAY_ORDER` (data_model → … → prompt_pack, then mockups) — and
opens the mobile drawer (`useIsMobile`-gated, so it never reopens after the user
closes it; desktop keeps the persistent side rail). While the overall run is in
flight, an idle slot renders a centered `BuildAssetsLoading` ("Creating your
build assets…") instead of an empty state.

### Implementation tasks (plan → tracked checklist)

The Implementation Plan artifact converts into trackable build tasks.
`taskExtractor.ts` deterministically derives `ImplementationTask[]` (no LLM
call) from the plan's structured JSON or legacy markdown. `ConvertToTasksModal`
(opened from the Implementation Plan view) lets the user review/edit them, then:

- **Save to project** persists them via `saveTasks` (`tasksSlice`) as
  `ProjectTask[]` with `status: 'todo'`. Re-opening the modal seeds from the
  saved set (preserving status), so editing and re-saving never resets
  progress.
- **Export** (`taskExport/` registry: markdown / github / linear) is unchanged;
  after a github/linear export the modal calls `recordTaskExports` to attach
  the created issue refs to the matching persisted tasks.

`TaskChecklist` (`src/components/tasks/`) renders above the Implementation Plan
content when saved tasks exist: a progress bar (`done / total`), a status
toggle per row cycling todo → in_progress → done, expandable acceptance
criteria, and a link to any exported GitHub issue. The "Convert to Tasks"
button becomes "Manage Tasks (N)" once tasks are saved. Tasks capture
`sourceSpineVersionId` for future staleness hints. Persisted tasks are cleaned
up in `deleteProject`.

### Export (`ExportModal.tsx`)

The Export dialog downloads the PRD, individual artifacts, a combined bundle,
or structured JSON. It also offers a **"Copy for coding agent"** preset
(`buildAgentHandoff` in `src/lib/exportHandoff.ts`): an instruction preamble +
PRD + build-relevant core artifacts (mockups excluded), with copy and download.
Copy-to-clipboard (via `src/lib/utils/copyToClipboard.ts`, Clipboard API with
an `execCommand` fallback) is available on the PRD and full bundle too.

### Version history & revert (`src/components/versions/`)

Shared, presentation-only components for browsing, comparing, and restoring
versions of **both** PRDs (spines) and artifacts:

- `VersionHistoryPanel` — props-driven modal listing versions (label,
  current/preferred badge, change-source badge, edit summary) with per-row
  **Compare** / **Restore**; orchestrates the compare → confirm flow internally.
- `VersionCompareView` — section-aware inline diff for PRDs, word diff for
  artifact text. Read-only except for opening the restore confirmation.
- `RevertConfirmModal` — non-destructive restore confirmation; the PRD variant
  warns which downstream artifacts will be marked possibly outdated (computed by
  the caller via `getArtifactStaleness`).

Diffs are computed on the fly from stored snapshots by **`src/lib/versionDiff.ts`**
(pure, jsdiff-backed: `diffText`, `diffStructuredPRD`, `getDiffSummary`) —
nothing extra is persisted. Wiring: `ProjectWorkspace` exposes PRD history (a
**Version History** overflow-menu item) and adds **Compare with current** /
**Restore this version** to the read-only historical-version banner;
`ArtifactWorkspace` shows a **Version history** button + a "Generated from PRD
Version X" chip + `StalenessBadge` above each generated artifact. Restores route
to `revertSpineToVersion` / `revertArtifactToVersion`. **Revert always appends a
new version and never deletes history.** See `docs/VERSIONING_AUDIT.md` for the
full design (Phase 1 implemented).

### PRD highlight → branch selection pipeline

The core PRD-refinement gesture — highlight PRD text, get a contextual
action dialog (Clarify / Expand / Specify / Alternative / Replace), spawn
a history-tracked branch — is detection-source-agnostic and works on
both desktop and touch. Both PRD renderers (`SelectableSpine.tsx` for
markdown PRDs, `StructuredPRDView.tsx` for structured PRDs) share one
pipeline; do not reintroduce per-component `onMouseUp` selection logic.

- **`src/lib/selectionPopover.ts`** — pure, framework-free helpers:
  `isValidSelection` (rejects null / collapsed / empty / out-of-container
  selections), `getSelectionInfo` (text + bounding rect), and
  `computePopoverPosition` (viewport clamp + flip-above math for the
  desktop popover). These are unit-tested in isolation.
- **`src/lib/useSelectionPopover.ts`** — the React hook owning detection.
  Listens on `document` for **`pointerup`** (mouse/pen/touch, short read
  delay) *and* **`selectionchange`** (debounced — the mobile long-press +
  drag-handle route, which never fires a matching `mouseup`). Validates
  against a `containerRef`; a *collapsing* selection never auto-dismisses
  an open dialog (focusing the mobile input collapses the native range) —
  dismissal is explicit via `clear()`. Supports a **`manualCommit`** mode
  (the mobile path): instead of surfacing a valid selection immediately, it
  only *tracks* it (exposed as `pendingText`) and waits for an explicit
  `commit()` to surface it as `selection`. This stops the Synapse action
  sheet from popping on the first selected word and fighting the native iOS
  Copy/Look Up/Translate toolbar. Desktop (`manualCommit` omitted/false) is
  unchanged — selections surface instantly.
- **`src/lib/useIsMobile.ts`** — `matchMedia` hook at the Tailwind `md`
  breakpoint (jsdom-safe).
- **`src/components/MobileSelectionToolbar.tsx`** — mobile-only control that
  drives the manual-commit flow. **Idle:** a pinned "Select text to edit"
  button (until tapped, the PRD is plain readable text with untouched native
  iOS selection — the hook is `enabled: false`). **Active:** a persistent
  footer ("Select text, then tap Edit selection") echoing `pendingText`, with
  **Edit selection** (→ `commit()`) and **Cancel** (→ exit mode + `clear()`).
  Both renderers wire it identically: `mobileSelectMode` state gates the hook
  via `enabled: … && (!isMobile || mobileSelectMode)` and
  `manualCommit: isMobile && mobileSelectMode`, and the toolbar is hidden while
  the action sheet (or, in `StructuredPRDView`, an inline edit) is open. Mode
  resets on dismiss / successful branch.
- **`src/components/SelectionActionDialog.tsx`** — shared presentation:
  desktop = floating popover anchored to the selection rect; mobile =
  bottom sheet with `env(safe-area-inset-*)` insets and ≥44px tap
  targets. Both call the same branch handlers — there is no parallel
  edit path. The branch/history flow itself (`createBranch` →
  `replyInBranch` → `addBranchMessage`) is unchanged by this layer.

`index.html` carries `viewport-fit=cover` so safe-area insets resolve on
notched devices.

### PRD progress timeline (`src/components/progress/`)

The PRD generation path renders a single **responsive** `ProgressTimeline`
card (used on both mobile and desktop — there is no separate mobile/desktop
component). It is driven directly by the live `prdSectionStatus` store slice
(not by parsing the `prdProgress` message log):

- **`buildGenerationSteps.ts`** — pure adapter. `computeWaves()` groups the
  10 pipeline sections (`DEFAULT_PRD_SECTIONS`) into **dependency waves**
  (topological levels): a single-section wave is a sequential row, a
  multi-section wave is a "Running concurrently" group whose children are the
  parallel sections (labeled `2A`, `2B`, …). This is purely graph-derived, so
  it supports arbitrary graphs, multiple concurrent groups, and any step
  count. Overlays live status/timing/model onto the static waves;
  `formatModelName()` renders the actual configured Gemini id (e.g.
  `gemini-3-flash-preview` → "Gemini 3 Flash (preview)") — no hardcoded model
  names. `summarizeSteps()` derives the header count/percent/status.
  The executor emits a `section_ready` event when a section's deps are
  satisfied, so the grid distinguishes two waiting states: **`pending`** =
  waiting on dependencies (shows "Waits on: …"), **`queued`** = deps satisfied,
  waiting for a free concurrency slot. `mapStatus()` keeps these distinct;
  leaves also carry `dependsOn` (resolved to titles) and `retryCount`.
- **`ProgressTimeline.tsx`** / `TimelineStep.tsx` / `ConcurrentGroup.tsx` —
  presentation. Status icons (completed/in-progress/queued/failed/pending — the
  amber `queued` ring is distinct from the plain `pending` ring), an
  always-visible (truncating) model chip, a "Retried ×N" badge, and
  explicitly-labeled times (`Actual:`/`Est. ~`/`Elapsed:`). A 1s ticker injects
  live `Elapsed:` from `startedAt` (re-stamped on each `generating` transition,
  so retries show fresh elapsed). Responsive rules (`min-w-0`, truncation, no
  `whitespace-nowrap` on the model chip) keep narrow screens from overlapping.
  Mobile collapses per-step detail behind chevrons and shows a `View full
  history >` link (navigates to the History stage); desktop shows
  description/model/status/est/actual/retry and concurrent groups without
  expansion, plus inline `[Current Run] [History]` tabs (History renders the
  `prdProgress` message log inline). Failed steps stay expanded with a red
  `Run again` button.
- **Single-section retry** (`src/lib/services/prdSectionRetry.ts`) —
  `regeneratePrdSection()` re-runs **only** a failed section using the
  current PRD as upstream context, shallow-overlays the new slice onto the
  existing `StructuredPRD` (sections own disjoint top-level fields), and the
  caller (`ProjectWorkspace.handleRetrySection`) writes it back via
  `updateSpineStructuredPRD` — every other section stays intact. The shared
  `parseSectionJson()` helper (in `progressivePrdGeneration.ts`) is reused by
  both the DAG worker and the retry path. `SECTION_DESCRIPTIONS` (next to
  `SECTION_TITLES` in `prdSectionPrompts.ts`) supplies the row descriptions.

The card is shown while `isPRDActivelyGenerating || hasFailedSection`, so a
partial-failure run (which returns a partial PRD without setting
`generationError`) keeps its Run again affordance visible.

**Partial-failure persistence:** the live section grid is transient, so the
pipeline also records failed section ids in
`generationMeta.failedSections` (set by `progressivePrdPipeline`, stored on
the spine via the normal `onResult` path). When non-empty, `ProjectWorkspace`
renders an amber "This PRD is incomplete" banner above the PRD with a
per-section "Run again" button wired to the same `handleRetrySection` flow —
this survives refresh, unlike the timeline. A successful single-section retry
removes its id from the list (see `handleRetrySection`).

### Other-flow progress UI (`src/components/GenerationProgress.tsx`)

The mockup / artifact / consolidation flows still use `GenerationProgress`.
Long-running LLM operations show a stages panel. The component supports
three drive modes, in priority order:

1. **State-driven** (`progress` prop is a number) — bar tracks the value
   directly, timer disabled.
2. **History-driven** (`history` prop is non-empty) — prominent label and
   stage-dot index derive from the latest progress message by
   first-three-words substring match against stage labels; walks
   backwards through history if the latest message is transient
   ("Connection dropped — retrying…", "Sending request to model…")
   so the indicator doesn't yank to the wrong stage.
3. **Timer-driven** (fallback) — labels rotate on `minDuration` timers.

When supplying `history`, the stage label strings in
`generationStages.ts` must be a substring-prefix match for the strings
emitted via `onProgress` for the indicator to track. Don't include
mutable detail (char counts, timestamps) in progress messages — that
defeats the store's consecutive-dedupe and floods the history list.

### Interactive product tour (`src/components/tour/`)

"Meet Synapse" is a fully interactive product tour (mounted at `/tour`, with
`/about` kept as a backward-compatible alias) — **not** a static infographic
page. It rebuilds six onboarding screens as native UI and teaches the workflow
through interaction. All content is demo-only (`tourData.ts`); it never touches
the Gemini pipeline, the `api/` backend, or the Zustand project store.

**Public portfolio demo:** `/tour` and `/about` are deliberately **outside the
auth gate** in `App.tsx` (no `RequireAuth`), so the tour is a standalone,
linkable demo that exposes no user data or keys. SPA fallback to `index.html`
on direct load/refresh is provided by `vercel.json` `rewrites` (Vercel) and
`public/_redirects` (Netlify / compatible static hosts) — keep both in sync if
routing changes. `TourPage.tsx`'s header carries Synapse branding + an "Open
Synapse" CTA back to `/` so it reads as a product demo, not an internal page.

- **Two modes, one source of truth.** `src/lib/useTourState.ts` is a
  `useReducer` (`tourReducer` + `initialTourState`, both exported for tests)
  holding `{ activeIndex, mode, direction }`. **Guided** mode (first-timers)
  is a linear story; **Overview** mode (returning users) shows
  `TourProgressRail` to jump to any section. Every navigation input — `TourNav`
  buttons, the dot rail, overview tabs, desktop Arrow keys (listener in
  `TourPage`, ignored while typing), and mobile swipe — funnels through
  `dispatch`. `RESTART` replays guided mode.
- **Completion persistence** lives in `src/lib/tourPersistence.ts`
  (`synapse-tour-completed` localStorage flag, defensive try/catch) —
  deliberately *not* in the project store. Reaching the last screen marks it
  completed; completed users default to Overview mode. The retired
  `synapse-meet-dismissed` key is swept in `App.tsx`'s migration block.
- **Transitions & gestures.** `TourContainer` uses framer-motion
  `AnimatePresence` + a `motion.div` with direction-aware slide/fade variants;
  `drag="x"` (mobile + motion-allowed only) commits via the pure
  `shouldCommitSwipe()` in `src/lib/swipeMath.ts` (offset/velocity → next/prev).
  Only the active screen is mounted; each `screens/Screen*.tsx` is
  `React.lazy`-loaded so all six never load at once (verify: separate chunks in
  `vite build` output). Because only the active screen mounts, screens reset by
  remounting — do not add `isActive`-based reset effects (they trip the
  `react-hooks/set-state-in-effect` lint rule); use async timer callbacks +
  unmount cleanup for animated sequences.
- **Reduced motion.** `src/lib/usePrefersReducedMotion.ts` (jsdom-safe, mirrors
  `useIsMobile`) plus framer-motion's own handling: screens render their final
  state instantly, drag is disabled, transitions collapse to a fade. Every
  interaction must remain usable without animation.
- **Screens** (`screens/`): Idea, SpecGeneration, Refine (reuses the
  Clarify/Expand/Specify/Alternative/Replace action set mirrored from
  `SELECTION_ACTIONS`), Versions, Assets (the hero — Mark as Final →
  sequential asset generation → `ArtifactDrawer` previews), Connections
  (`NodeGraph` PRD→assets dependency graph + recent-activity timeline). Shared
  pieces in `components/`: `ScreenShell`, `GenerationStep`, `RefineMenu`,
  `ArtifactDrawer` (mobile bottom-sheet / desktop side-drawer, mirrors
  `SelectionActionDialog`'s responsive pattern), `NodeGraph`.

### Orchestration metrics (`src/lib/metrics/`, `src/components/metrics/`)

A measurable view of the concurrent multi-agent workflows. **Important context:
PRD section generation was already genuinely concurrent** (the DAG executor —
see the LLM layer) before this; the metrics layer makes that concurrency
*visible*, it did not introduce it. See `docs/ORCHESTRATION_AND_METRICS.md`.

- **Token capture.** `callGemini` reads Gemini's `usageMetadata` and surfaces it
  via an optional `JsonModeConfig.onUsage` callback (callGemini still returns the
  same `string` — no call site breaks). The PRD section worker threads it
  through `ModelProvider.generateText` → `makeJsonProvider` and emits it on the
  `section_completed` event. **New provider call sites that want token metrics
  must forward `onUsage`.** (Artifact services don't yet — a documented TODO.)
- **Pure metric math** (`src/lib/metrics/`, unit-tested, no store/LLM access):
  `workflowMetrics.ts` (sequential estimate, actual runtime, speedup, max/avg
  concurrency via interval sweep, critical path via memoized DFS),
  `modelPricing.ts` (approximate per-model $/1M-token table → cost **estimates**,
  surfaced as "est."), and `buildWorkflowRun.ts` (assembles a `WorkflowRun` from
  per-node observations; derives `parallelGroupId` as a topological wave when not
  supplied). Both pipelines feed `buildWorkflowRun` so PRD and artifact runs are
  computed identically.
- **Recording is decoupled + defensive.** `progressivePrdPipeline` accumulates
  per-section node observations from the lifecycle events it already emits and
  fires `onWorkflowRun(run)` once at completion (threaded through `prdService`);
  `artifactJobController.executeJob` does the same for the artifact bundle.
  Identity (projectId/projectName) is stamped at the call site
  (`runPrdGeneration.ts`, `ProjectWorkspace.handleRegenerate`) before
  `recordWorkflowRun`. **All run assembly is wrapped in try/catch — metrics can
  never break a generation run.**
- **Dashboard** at `/metrics` (auth-gated route in `App.tsx`, linked from the
  Settings modal and the workspace overflow menu): `MetricsPage` (stable
  `EMPTY_RUNS` selector fallback per the Selector-stability rule),
  `MetricsOverviewCards`, `WorkflowRunsTable`, `WorkflowRunDetail` (Gantt bars +
  node table). **No synthetic/demo data** — a fresh user sees an empty state.

### Domain types

`src/types/index.ts` is the single source of truth for the domain model
(Project, SpineVersion, Branch, Artifact, ArtifactVersion, FeedbackItem,
HistoryEvent, etc.). Keep optional fields optional even when only one
code path uses them — legacy localStorage data may not have them.
