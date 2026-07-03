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

### Snapshots & the demo project (`src/lib/snapshotClient.ts`, `api/snapshots.js`)

Owner-only project snapshots bundle a project's Zustand slice **plus its
IndexedDB-backed mockup images** (base64 PNGs from `src/lib/mockupImageStore.ts`,
keyed `versionId:screenId:quality` where `versionId` is the **artifact version
id**) **and its user-uploaded Screen Inventory images** (from
`src/lib/screenInventoryImageStore.ts`, a separate IDB store, keyed
`artifactVersionId:screenSlug:versionNumber`) and push them to Vercel Blob
behind a `SYNAPSE_OWNER_TOKEN` gate. The bundle also carries the project's
**implementation tasks** (`tasks` slice) and **orchestration metrics**
(`workflowRuns` slice) — every *persisted* store slice for the project, so a
restored snapshot is a faithful copy. Both image kinds split out of the JSON
envelope and ship one request each (reusing the **same** per-image blob channel
— each blob is keyed by a hash of the image key, and the two key shapes never
collide) so neither upload nor download crosses Vercel's ~4.5 MB cap. The wire
format carries mockup images in `payload.images` and screen-inventory images in
`payload.screenImages`. One snapshot can be pinned as **the demo** (`_demo.json`
pointer + public `?demo=1` read); `loadDemoProject` restores it under the stable
`DEMO_PROJECT_ID`. Snapshot fields (`tasks`/`workflowRuns`/`screenImages`) are
all **optional on the wire** — pre-existing snapshots lack them and restore
defaults each to `[]`. When adding a new persisted slice or IDB image store,
add it to `collectProjectBundle`/`collectScreenImages`, the restore writers, and
`namespaceSnapshotForRestore`, or it silently won't travel in snapshots.

- **Demo cache freshness — never short-circuit on a `DEMO_PROJECT_ID` cache hit
  alone.** Each restored demo project stores its source snapshot id in the
  optional `Project.demoSourceSnapshotId` (so it travels with the per-user
  project namespace). On every `loadDemoProject` call, the client first probes
  the lightweight public `GET /api/snapshots?demo=1&pointer=1`
  (`loadDemoSnapshotPointer`) and only reuses the cached demo when the stamped
  id matches the live pointer. When the owner pins a newer snapshot the
  pointer differs → the full bundle is re-fetched and `restoreSnapshotAs`
  overwrites the cache. If the pointer probe itself fails (offline / proxy
  error) the cache is preferred over an empty state. **Do not** re-add an
  early `if (existing) return` — that's exactly what made the desktop serve a
  stale demo while mobile (with no cache) silently saw the latest.
- **Demo image hydration is retried and failure-tolerant — never all-or-nothing.**
  A cache-less demo load is a burst of `2 + imageCount + screenImageCount`
  requests (pointer + bundle + one fetch per mockup/screen image). Per-image
  fetches in `snapshotClient` retry transient failures with backoff
  (`fetchImageWithRetry`); on the public demo path (`loadDemoSnapshotPublic`)
  an image that still fails is **dropped** (`imagesComplete: false` on the
  returned payload, a client-only field) instead of rejecting the whole
  snapshot. `loadDemoProject` restores an incomplete payload (fresh-partial
  beats stale cache) but skips stamping `demoSourceSnapshotId`, so the next
  open re-fetches and self-heals. This is the fix for "mobile shows the demo
  without its screen-inventory images": one failed image fetch used to reject
  the entire fresh snapshot and silently fall back to the stale cached demo.
  Owner-token `loadSnapshot` keeps strict all-or-nothing semantics (a restore
  over real data must not be partial). Server side, the public demo GET
  channel has its own rate-limit scope (`snapshots-demo`, 300/min in
  `api/snapshots.js`) so an image-rich demo can't 429 its own hydration burst;
  owner routes stay at 60/min.
- **Restoring under a *different* project id MUST namespace the artifact version
  ids** (`namespaceSnapshotForRestore` → `rewriteIds`), not just the project id.
  Both mockup images AND screen-inventory images are keyed in IndexedDB by the
  artifact version id with **no projectId in the key**, so a demo restored from a
  real project's snapshot would otherwise share version ids — and
  `restoreSnapshotAs`'s `deleteImagesForVersion()` /
  `deleteScreenImagesForArtifactVersion()` would wipe and re-tag the **source
  project's** images. Version ids are namespaced as `${targetProjectId}:${versionId}`
  (deterministic → idempotent re-restores) and each image's composite `key` is
  rebuilt from the remapped fields (`buildImageKey` for mockups,
  `buildScreenImageKey` for screen-inventory). `rewriteIds` runs over the whole
  bundle, so `tasks`/`workflowRuns` (which carry `projectId`) are remapped too.
  Never restore a snapshot under a foreign project id without this remap.
- **`collectProjectImages` must not filter images by the stored `record.projectId`.**
  A version id uniquely identifies its owning project, so collect by version id
  only; filtering on a (possibly drifted) `projectId` tag is what silently
  dropped mockup images from snapshots.
- **`collectScreenImages` (like `collectProjectImages`) must not filter by the
  stored `record.projectId`** — collect by artifact version id only, for the same
  drift reason.
- Note: user-uploaded Screen Inventory images
  (`src/lib/screenInventoryImageStore.ts`, a separate IndexedDB store) **are now
  captured in snapshots** (and therefore the demo) via `payload.screenImages`.
  They are **still a gap on the `/api/projects` cross-device sync path**, which
  only carries **mockup** images (via a separate Blob ref layer — see
  "Cross-device mockup image sync" below). The snapshot feature and the
  project-sync image layer are **independent**: different Blob prefixes
  (`snapshots/<id>/…` vs `users/<userId>/mockup-images/…`), different ref models,
  different auth gates (owner token vs per-user session). Do not entangle them.
  The project-sync ref layer is built generic (`kind`/`meta`) so screen-inventory
  images can be wired into it later. **Note:** the `user_uploaded` **mockup image
  source mode** (the OpenAI-key-free path that lets the user upload their own
  mockup) persists to `screenInventoryImageStore`, **not** `mockupImageStore` — so
  those uploads now travel in snapshots but still ride the cross-device-sync gap.
  Only the `gpt_image` (AI-generated) mockups sync across devices today.

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

### Cross-device mockup image sync (`api/_lib/imageRefsStore.js`, `src/store/projectImageSync.ts`)

AI-generated **mockup** images follow a signed-in user's projects across devices.
The `/api/projects` bundle stays **text-only**; image BYTES go to **Vercel Blob**
and only small **reference** records live in Mongo. This is the per-user sync
path and is **independent of the owner-only snapshot feature** (`api/snapshots.js`)
— different Blob prefix, ref model, and auth gate; don't entangle them.

- **Local-first, unchanged render path.** IndexedDB (`src/lib/mockupImageStore.ts`)
  remains the source of truth / render cache; generation still writes there.
  `MockupScreenImage` renders from the Zustand cache exactly as before.
- **Content-addressing.** Images are addressed by `sha256(dataUrl)`
  (`src/lib/imageBlobHash.ts`) and stored at the per-user, deterministic path
  `users/<userId>/mockup-images/<hash>.<ext>` (`addRandomSuffix:false`,
  `allowOverwrite:true`). Identical renders dedup to one blob; the hash → blob is
  1:1, which makes refcount GC exact. **Blob access is `public`** (unguessable
  uuid userId + sha256 path) — a deliberate decision: the architecture requires
  the browser to download bytes **directly** from the Blob URL (no function
  proxy), and a `private` blob would need a per-download function call to mint a
  signed URL. Mockups are low-sensitivity, so public + unguessable is the
  chosen trade-off. If image sensitivity ever rises, switch to signed URLs.
- **Client-direct upload.** Bytes go browser → Blob via `@vercel/blob/client`
  `upload()` (`src/lib/imageRefsClient.ts`), so they never traverse a serverless
  body (dodging Vercel's ~4.5 MB cap). The function only mints a signed token.
- **Ref store** (`api/_lib/imageRefsStore.js`, collection `project_images`). One
  doc per `(userId, projectId, key)`. A ref carries `{ key, hash, blobUrl,
  byteSize, kind, versionId?, screenId?, quality?, meta }` where `meta` is the
  dataUrl-less image record (so the client can reconstruct it on pull) — generic
  over `kind` (`mockup` | `screen_inventory`) so a second image type can reuse
  it. **RLS-equivalent** exactly like `projectsStore.js`: every function pins
  `{ userId }` (from `requireUser`, never the body). Indexes
  (`ensureImageRefIndexes`): `{userId,projectId,key}` unique, `{userId,projectId}`,
  `{userId,hash}`.
- **Endpoints — folded into `api/projects.js` via `?action=` (NO new function;
  the repo is at 11/12).** `image-upload-token` (POST, `handleUpload` token
  issuer — `onBeforeGenerateToken` restricts the pathname to the caller's
  `users/<userId>/…` prefix + allowed image types; `onUploadCompleted` persists a
  backup ref). `image-refs` (GET, list a project's refs). `image-ref-put` (POST,
  authoritative ref persist after upload — rejects a `blobUrl` outside the
  caller's prefix). `image-ref-delete` (POST, refcount-GCs orphan blobs).
  **`image-upload-token` runs BEFORE the global `requireUser`**: the
  upload-completed callback is a signed server-to-server request with no session
  cookie — `handleUpload` verifies its signature, and the userId comes from the
  `tokenPayload` stamped (from the verified session) at token-gen time. Never
  move it behind `requireUser`.
- **Dual ref-persist (both idempotent).** The client's `image-ref-put` is the
  **authoritative** path (works everywhere, incl. localhost where Vercel can't
  reach `onUploadCompleted`). `onUploadCompleted` is a best-effort backup for the
  tab-closed-early case and persists a minimal ref (routing parsed from the key).
- **Push** (`pushProjectImages`, fired after each text save AND from
  `mockupImageStore.generate` via `notifyMockupImageGenerated` — generation
  writes IDB directly and would otherwise never trigger a push). Diffs local
  image keys against a per-user uploaded-marker set
  (`synapse-mockup-images-uploaded::u:<userId>`, `src/lib/imageUploadMarker.ts`,
  mirrors `projectMigration.ts`) + the server refs, uploads the missing ones,
  persists refs, marks them. **Image sync NEVER blocks text sync** and every
  failure is non-fatal (the image is left unmarked and retried next push); a
  failed image never reverts local data.
- **Pull = refs only, hydrate lazily.** Reconcile pulls refs into an in-memory
  registry (`src/lib/imageRefRegistry.ts`, keyed by versionId). `loadForVersion`
  in the mockup image store, on an IndexedDB cache **miss** where a ref exists,
  fetches the Blob URL directly (concurrency-limited, mirrors snapshot
  `hydrateImages`), writes it into IndexedDB, then renders. **No bulk download on
  sign-in.**
- **GC.** Project **hard-delete** (`api/projects.js`) calls
  `deleteRefsForProject` then `del()`s the returned **orphaned** blob URLs —
  refcount-aware: a blob is deleted only once NO remaining ref for that user
  points at its hash (`findOrphanedHashes`; pure mirror in
  `src/lib/imageSyncDiff.ts`). Soft-delete keeps refs (recoverable). GC failures
  are logged, never fatal. **Known gap (sweep TODO):** per-image overwrite /
  version regen can orphan a blob until project hard-delete (a new render = new
  hash = new blob; the old ref/blob isn't eagerly collected). `image-ref-delete`
  exists for a future fine-grained sweep.
- **CSP.** `vercel.json` `connect-src` must include `https://*.vercel-storage.com`
  for the browser's upload/download fetches — without it the feature breaks in
  prod.

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
    document order. `DEFAULT_PRD_SECTIONS` (8 schema-aligned sections in
    `progressivePrdGeneration.ts`) each declare `dependencies` that are **true
    data dependencies only** — a section lists another solely when it consumes
    that section's output as prompt context. **The PRD is the product decision
    document, not a container for downstream artifacts:** the former
    `data_model` and `implementation_plan` PRD sections are **retired** from the
    default graph (`RETIRED_PRD_SECTIONS` / `RETIRED_SECTION_IDS`) — the
    dedicated data_model / implementation_plan *artifacts* own that detail, and
    the PRD-embedded copies duplicated them (two entity lists was a standing
    inconsistency source; `implementationPlan` was never rendered). Their
    `SectionId`, prompt builder, slice schema, and title all survive solely so
    single-section retry of legacy `generationMeta.failedSections` keeps
    working (`prdSectionRetry.ts` looks sections up across
    `DEFAULT_PRD_SECTIONS ∪ RETIRED_PRD_SECTIONS`). Never re-add retired
    sections to `DEFAULT_PRD_SECTIONS`, and never feed them to `runDag`.
    Legacy PRDs with `richDataModel`/`stateMachines`/`implementationPlan` keep
    rendering — the renderer blocks and optional `StructuredPRD` fields stay. `runDag()` runs every section whose
    deps are satisfied concurrently, under separate per-tier concurrency caps
    (`maxFastConcurrency` / `maxStrongConcurrency`); low-risk sections use the
    fast (Flash) model, high-risk the strong (Pro) model. `validateGraph()` runs
    first and throws on unknown-dependency references or cycles (Kahn's
    algorithm) so a broken graph fails loudly instead of silently dropping
    sections. Each section emits a typed slice of `StructuredPRD`; slices are
    merged deterministically (`prdSectionMerge.ts`, disjoint top-level fields)
    and markdown is rendered via `prdMarkdownRenderer.ts`. Do **not** re-add
    edges to sequence sections by document position — only by real data flow.
    **PRD reading order ≠ generation (DAG) order.** The human/agent-facing
    section order is a fixed logical flow (Product Overview → Target Users →
    MVP Scope → Core Features → UX → Success Metrics → Risks → Technical
    Architecture → Data Model → State Machines → NFRs → reference appendix)
    defined in **two mirrored renderers that must stay in sync**:
    `prdMarkdownRenderer.renderPremiumMarkdown` (export/`responseText`) and
    `StructuredPRDView`/`PremiumSections` (in-app). Reordering is
    presentation-only and safe — downstream artifacts/mockups consume the
    `StructuredPRD` **object by field**, never this render order — but if you
    change one renderer's section order, change the other to match.
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
  - **Shared design-system brief (single source of visual truth for image
    prompts).** `buildDesignSystemBrief(tokens)` (`designTokens/promptSnippet.ts`,
    replaced the old `tokensToImagePromptBrief`) is the ONE concise-but-complete
    Design System Brief embedded into every prompt that drives a mockup/screen
    image. Both the internal gpt-image-2 path (`mockupImageService.buildScreenImagePrompt`)
    and the user-copied external prompt on the Screen Inventory page
    (`screenInventoryImageService.buildExternalMockupPrompt`, formerly
    `buildScreenInventoryImagePrompt`) call it, so an externally generated mockup
    follows the same visual language as the internal one instead of drifting to a
    generic "neutral palette" look. The brief covers palette, typography,
    spacing/density, radius, elevation, button/card/form/modal conventions,
    navigation, responsive behavior, and accessibility — token data verbatim,
    the rest as derived conventions. `buildExternalMockupPrompt` takes optional
    `designTokens` (threaded from `ArtifactWorkspace` via `selectPreferredDesignTokens`
    into `ScreenImageGalleryContext`); with no design system it falls back to the
    neutral style hint so legacy projects still get a working prompt. Do **not**
    re-duplicate design-system prose into a prompt builder — reuse the brief.
  - **Design System Presets (`src/lib/designSystemPresets.ts`).** A
    visual-direction choice (`Modern SaaS`, `Enterprise Professional`,
    `AI Workspace`, `Minimal Editorial`, `Developer / Technical`,
    `Consumer Mobile`, `Creative Studio`, `Custom / Generate for me`). Preset
    **ids are stable and persisted** (`saas_minimal`, `editorial_learning`,
    `developer_tool`, … — never rename an id; labels are display-only). Each
    concrete preset also carries setup-step metadata (`tone`,
    `recommendedUseCases`, `visualTraits`, `previewTokens` — presentation-only,
    never fed to generation; only `directive` steers the model). The chosen id
    is stored on `Project.designSystemPreset`
    (`setProjectDesignSystemPreset`) and read at generation time by
    `artifactJobController.runCoreArtifactSlot` off the project (NOT threaded
    through every call site) and passed to `generateCoreArtifact`, which injects
    `getDesignSystemPresetDirective(id)` into the **design_system** prompt only.
    `custom`/unknown/missing → empty directive → original PRD-only behavior. The
    preset steers design_system generation and therefore both internal mockups
    and the external copy-prompt, keeping the project visually consistent. The
    `DesignSystemRenderer` shows a banner explaining this coupling and that
    regenerating may shift downstream mockups/screen prompts.
    - **Setup-stage selection (`src/components/setup/DesignSetupStep.tsx`) is
      the primary picker.** New projects stamp `Project.needsDesignSetup: true`
      in `createProject`; while that flag is set and no preset is chosen, the
      workspace PRD stage renders `DesignSetupStep` **instead of** the PRD/
      progress view — after the preflight clarification flow (if any) completes
      and therefore exactly while PRD generation runs in the background (the
      PRD run is untouched; the step is purely a view swap, so generation never
      waits on the choice). Gating is the pure, unit-tested
      `shouldShowDesignSetup` (`src/lib/designSetup.ts`): never for legacy
      projects (no flag), the demo, blocked spines, or failed runs — full
      (`generationError`) *and* partial (`generationMeta.failedSections`;
      plus the transient `hasFailedSection` guard in `ProjectWorkspace`) —
      because the error card / incomplete-PRD banner and their retry
      affordances must stay reachable. The step shows static
      `previewTokens`-driven preview cards (no AI/image calls), a rule-based
      **Recommended** badge (`src/lib/designPresetRecommendation.ts` — keyword
      scoring over idea + clarification answers, `saas_minimal` fallback), and
      preselects the user's saved **default preset**
      (`src/lib/designPresetPreference.ts`, localStorage
      `SYNAPSE_DEFAULT_DESIGN_PRESET`, written only via the explicit "Use this
      as my default" checkbox). Choosing calls `setProjectDesignSystemPreset`
      (which also clears `needsDesignSetup` — from any picker); "Decide later"
      calls `markDesignSetupComplete` and defers to the finalize gate.
    - **The Mark-as-Final gate (`DesignSystemPresetChoice` in
      `ProjectWorkspace`) is now the fallback**, still shown when a real
      project reaches finalize with no preset (setup skipped, or a legacy
      project) — so visual artifact generation still never starts without an
      explicit preset decision.
    - **Post-finalization re-selection.** The preset is **no longer one-time**.
      Because the Mark-as-Final gate only fires once (and never for projects
      finalized before presets existed), the **Design System artifact** carries a
      `DesignDirectionControl` (`src/components/DesignDirectionControl.tsx`,
      presentational) above its content in `ArtifactWorkspace`: it shows the
      current direction (or an "AI decides" fallback) and offers **Change
      direction** and **Regenerate**. **Change direction opens
      `ChangeDirectionModal` (`src/components/setup/ChangeDirectionModal.tsx`),
      which deliberately mirrors the setup-stage `DesignSetupStep`** — same light
      surface and large `DesignPresetGrid` preview cards (the card grid is
      extracted into the shared `src/components/setup/DesignPresetGrid.tsx` so the
      two screens are visually identical) — with the active preset marked
      **Current** and a prominent amber warning that the change flows through to
      downstream artifacts (mockups + copied screen prompts). Choosing a new
      direction persists it via `setProjectDesignSystemPreset` then opens a
      regenerate-confirm (itself carrying the downstream-impact warning) that
      calls `artifactJobController.retrySlot('design_system')` — which re-reads
      the preset off the project, so the new direction actually reaches
      generation. (The old compact `DesignSystemPresetChoice` sheet now serves
      only the Mark-as-Final fallback gate in `ProjectWorkspace`.)
    - **Generated-asset lock affordance.** Every *downstream* asset in the
      sidebar/mobile-header — anything except the PRD and the Design System
      itself (`isLockableAsset` / `LOCK_EXEMPT_SELECTIONS` in `ArtifactWorkspace`)
      — shows a small `Lock` icon once its slot status is `done`, signalling it's
      anchored ("locked") to the current design system. It's a passive indicator
      only; changing the visual direction + regenerating the design system is what
      updates those assets.
    - **Mockup-drift prompt.** Regenerating the design system produces a new
      `tokensHash`, which `stalenessSlice` already uses to flip dependent mockups
      to `possibly_outdated` (the auto-flag). On top of that, the Mockups view in
      `ArtifactWorkspace` renders an amber **"Design system changed … Regenerate
      the mockups"** banner when the mockup's recorded design_system
      `anchorInfo` (tokensHash) differs from the project's current preferred
      design system (`selectPreferredDesignSystem`), wired to the existing mockup
      regenerate-confirm. Mockup *images* are keyed by the new mockup version id,
      so the user must regenerate to pull the new visual direction through.
  - `coreArtifactService.ts` — the 7 core artifact types
    (screen_inventory, data_model, component_inventory, user_flows,
    implementation_plan, prompt_pack, design_system). **`prompt_pack` is
    RETIRED from new generation** (see "Consolidated Implementation Plan"
    below): it stays in the subtype union, pipeline, and complexity map so
    legacy persisted artifacts keep working, but new runs never generate it.
    **Per-artifact model
    routing (`src/lib/artifactModelSettings.ts`):** the routing brain lives in
    `artifactModelSettings.ts` (not coreArtifactService) so the Settings UI and
    the generation pipeline share one source of truth. Each subtype is tagged in
    `CORE_ARTIFACT_COMPLEXITY` (`low`/`high`); `getArtifactModel(subtype)`
    resolves **(1)** an explicit per-artifact override (Settings → "Artifact
    Generation Models", persisted as the `GEMINI_ARTIFACT_MODELS` JSON map),
    else **(2)** the complexity recommendation — `high` (screen_inventory,
    user_flows, data_model, implementation_plan) → Expert/Pro (`getStrongModel`),
    `low` (component_inventory, design_system, prompt_pack) → Fast/Flash
    (`getFastModel`), else **(3)** the tier fallback to the single Default model
    (`getModel`) → `DEFAULT_GEMINI_MODEL`. `coreArtifactService.selectArtifactModel`
    delegates to `getArtifactModel` and re-exports `CORE_ARTIFACT_COMPLEXITY` for
    back-compat. Existing projects have no override key, so behaviour is
    unchanged until the user picks a model (no migration). The resolved model is
    threaded into every generate **and** refine call, and `artifactJobController`
    records that same per-subtype model in workflow metrics. Keep
    `CORE_ARTIFACT_COMPLEXITY` in sync when adding a `CoreArtifactSubtype`.
    **Mockups are image artifacts, not text:** `artifactModelSettings` also owns
    the mockup **image source mode** (`getMockupImageMode`/`setMockupImageMode`,
    `SYNAPSE_MOCKUP_IMAGE_MODE`: `gpt_image` | `user_uploaded`, default
    `gpt_image`). `resolveMockupRender(mode, hasOpenAiKey)` decides per screen:
    `user_uploaded` (or `gpt_image` with **no** OpenAI key — a non-silent forced
    fallback) → the manual prompt+upload sheet (`MockupScreenUpload`, reusing the
    IDB-backed `screenInventoryImageStore` keyed by the mockup version id);
    otherwise the OpenAI gpt-image-2 generator (`MockupScreenImage`).
    `MockupImageStatusChip` summarizes per-version status (AI-generated /
    uploaded / awaiting). The Settings section is `settings/ArtifactModelsSection.tsx`
    (PRD shown as expandable "Multi", text artifacts with Complex/Simple badges,
    Mockups with an "Image Source" select); the model list is the shared
    `src/lib/modelCatalog.ts`.
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
    **Artifact in-page navigation** is a shared, collapsible **Artifact
    Outline** — `src/components/ArtifactOutlineNav.tsx` (presentational/
    controlled) + `src/lib/useArtifactOutline.ts` (scroll-spy via
    IntersectionObserver, smooth-scroll, and hash `history.pushState` so
    back/forward steps through sections). It mirrors the Mockups "Pages"
    navigator: a numbered list/card, subtle purple active highlight + a
    "Current section/entity" badge, `collapseOnSelect` on mobile (passed
    `isMobile`) with a floating re-open button. Used by the **Design System**
    (sections), **Data Model** (entities), and **Developer Prompts**
    (`prompt_pack`, prompts) renderers, which anchor each section with a
    `scroll-mt-*` id matching an outline item. This **replaced the old
    wrapping "pill" nav** (`SectionTabs`) on the first two pages and the old
    permanent left rail on Developer Prompts — do not reintroduce pills or a
    side rail there; `SectionTabs` survives only in the Implementation Plan
    renderer's legacy-markdown fallback path. When a document-style artifact
    needs in-page nav, reuse
    `ArtifactOutlineNav`/`useArtifactOutline` rather than introducing another
    navigation style.
    The `prompt_pack` (**Developer Prompts**) renderer
    (`PromptPackRenderer.tsx`) survives only for legacy persisted artifacts
    (the subtype is retired — no sidebar row, no new generation): a vertical
    document driven by the shared outline (one card per `### N. Title`), with
    Edit + Copy Prompt actions and a per-prompt `promptEdits` metadata
    overlay. Its markdown parser lives in
    `src/lib/services/promptPackParser.ts`, shared with the implementation-
    plan adapter (which is how legacy Developer Prompts surface inside the
    consolidated view). **Generated prompts are agent-agnostic** — neither
    the legacy prompt_pack prompt nor the implementation_plan prompt-pack
    instructions (`coreArtifactService.ts`) may name or recommend a specific
    coding agent (Cursor, Claude Code, ChatGPT, Copilot). `generatedAt`
    (version `createdAt`) and `versionNumber` thread through
    `ArtifactContentRenderer`.
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
              ↓ (new projects: needsDesignSetup)
              DesignSetupStep — pick a visual direction while the PRD
              generates in the background (see "Design System Presets")
              ↓
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

The artifact sidebar is organized into four workflow-named sections —
**Project Foundation** (PRD **and** Design System — the design system sits
directly below the PRD as the shared visual foundation every downstream asset is
generated against), **Experience** (User Flows, Screens — see "The Experience
workspace" below), **Architecture** (Data Model), and **Development**
(Implementation Plan — see "Consolidated Implementation Plan" below) — driven by
`ARTIFACT_GROUPS` in `ArtifactWorkspace.tsx`. Grouping is purely visual;
`CoreArtifactSubtype` ids
(`'data_model'`, `'component_inventory'`, `'design_system'`, `'prompt_pack'`,
`'implementation_plan'`) are unchanged so persisted artifacts, generation, and
per-artifact model overrides keep working. **`component_inventory` (UI Components)
is a *hidden* artifact** — no hard dependents, not useful to surface directly
right now, so it is hidden from the assets list but **still generates** (it stays
in `CORE_ARTIFACT_PIPELINE` and `MOCKUP_DEPENDENCIES`; mockups softly consume it
to tag per-screen `componentRefs`). **`HIDDEN_ARTIFACT_SUBTYPES` /
`isHiddenArtifactSubtype` in `coreArtifactPipeline.ts` is the single source of
truth for "hidden"** and drives three things: (1) `buildSlotMetas` drops it so it
renders no sidebar/mobile-header/auto-open row (it may stay listed in
`ARTIFACT_GROUPS.items`; the filter removes it); (2) `ProjectWorkspace.assetsReady`
excludes hidden subtypes so a hidden slot erroring can't strand the finalize
success modal on "assets are being created" (the user has no row to see/retry it);
(3) `artifactJobController.resumeIfNeeded` only auto-wakes for *visible* pending
slots so an errored hidden slot isn't retried invisibly on every remount — but
`startAll` still includes hidden slots in its pending set, so they're best-effort
generated alongside visible ones. A hidden artifact must never gate readiness or
be the sole reason a run resumes. To re-expose one, remove it from
`HIDDEN_ARTIFACT_SUBTYPES`. See `docs/backlog/BACKLOG.md` §6.
**`prompt_pack` (Developer Prompts) is a *retired* artifact**
(`RETIRED_ARTIFACT_SUBTYPES` / `isRetiredArtifactSubtype`, same module) —
stronger than hidden: retired subtypes are excluded from new generation runs
(`pendingSlotsForSpine`), from `assetsReady`, from `buildSlotMetas`, and from
the Settings model list, while the pipeline meta / renderer / export path stay
for legacy persisted artifacts. A retired subtype must never be a dependency
of an active one (its dep would starve in the layer filter — regression test
in `coreArtifactPipeline.test.ts`). `title`/`description` in
`CORE_ARTIFACT_PIPELINE` are display-only labels that may be renamed freely; the
sidebar's iteration order (and the mobile-header / auto-open order)
all derive from `ARTIFACT_GROUPS`, not `displayOrder`. There is no
separate generation-status panel on the right — per-slot status lives
inline on each sidebar row (the `StatusDot` next to the title) and in
the mobile header beside the selected artifact name.

Marking a spine final must not dump the user back on something that looks like
the PRD again. `ProjectWorkspace.handleToggleFinal` (on the finalize edge)
starts artifact generation and shows `FinalizationSuccessModal` ("PRD
Finalized" — *being created* vs *ready*, keyed off an `assetsReady` presence
check of the non-hidden, non-retired core artifacts + mockups) **without**
switching stage. Its
**Open Assets** action (`handleOpenAssets`) switches `currentStage` to
`workspace` and arms a one-shot `finalizeAutoOpen` flag passed to
`ArtifactWorkspace` as `autoOpenIntent`. `ArtifactWorkspace` consumes it once
(via `onAutoOpenConsumed`): it auto-selects the first **non-PRD** artifact —
preferring `done`, then `generating`, then `queued`, else the first slot in
`ARTIFACT_GROUPS` order (design_system → user_flows → screens → … →
implementation_plan) — and opens the mobile drawer (`useIsMobile`-gated, so it
never reopens after the user closes it; desktop keeps the persistent side rail). While the overall run is in
flight, an idle slot renders a centered `BuildAssetsLoading` ("Creating your
build assets…") instead of an empty state.

### Consolidated Implementation Plan (Development section)

The old **Developer Prompts** (`prompt_pack`) and **Build Plan**
(`implementation_plan`) rows are consolidated into one **Implementation Plan**
artifact (subtype id still `implementation_plan` — no new subtype, so
persisted artifacts, version history, snapshots, sync, model routing, and
Convert-to-Tasks all keep working). See
`docs/IMPLEMENTATION_PLAN_CONSOLIDATION.md` for the audit + design.

- **Data shape.** `StructuredImplementationPlan` (in `src/types`) gained
  all-optional consolidated fields: plan `summary`
  (`ImplementationPlanSummary`), `globalQualityGates`, and per-milestone
  `objective`/`priority`/`estimatedEffort`/`dependencies`/`linkedArtifacts`/
  `promptPacks` (`ImplementationPromptPack`)/`qualityGates`
  (`ImplementationQualityGate`)/`validationCommands`/`definitionOfDone`.
  Storage format is unchanged: markdown + trailing ```` ```json synapse-plan ````
  fence; the readable markdown keeps the legacy
  Milestone/Goal/Deliverables/Dependencies headings (artifactValidation and
  the legacy parser depend on them) and full prompt bodies live only in the
  fence JSON.
- **Adapter, not migration.** `src/lib/services/implementationPlanAdapter.ts`
  (`buildConsolidatedPlan`, pure, unit-tested) builds the render-time
  `ConsolidatedImplementationPlan` view model from any combination of: native
  consolidated plan, legacy structured plan, legacy markdown-only plan,
  and/or a legacy `prompt_pack` artifact. Legacy prompts become prompt packs
  attached to milestones by conservative token matching (≥2 shared meaningful
  tokens; unmatched → a labeled **Unassigned Prompt Packs** group); legacy
  plan-wide Definition of Done → categorized global quality gates; legacy
  Architecture → summary stack; Risks → readiness warnings. `readiness` and
  `traceability` are always **derived, never persisted/generated**. The
  legacy prompt-card parser is shared via
  `src/lib/services/promptPackParser.ts` (extracted from
  `PromptPackRenderer`).
- **Renderer.** `ImplementationPlanRenderer` routes through the adapter into
  `renderers/implementationPlan/ConsolidatedPlanView.tsx` (tabs: Overview /
  Milestones / Prompt Packs / Quality Gates / Traceability + copy actions:
  per-prompt, per-milestone, all packs, whole plan as markdown via the
  adapter's helpers). Fence-less, milestone-less content falls back to the
  old timeline / plain markdown. `ArtifactWorkspace` threads the legacy
  standalone prompt_pack artifact's preferred content in as
  `promptPackContent` (via `ArtifactContentRenderer`).
- **Generation.** The `implementation_plan` prompt + Gemini schema
  (`artifactSchemas.ts`) emit the consolidated shape with **milestone-centered
  prompt packs** (self-contained, agent-agnostic, fixed heading structure:
  Goal / Relevant Synapse Artifacts / Scope / Out of Scope / Implementation
  Steps / Acceptance Criteria / Quality Gates / Validation Commands / Commit
  Guidance; no triple backticks inside bodies — they'd collide with the
  markdown fences). It has true data deps on `screen_inventory` +
  `data_model` (NOT `user_flows` — that edge would make the active pipeline 3
  layers deep; the pipeline-shape tests assert ≥3-wide layer 1 and ≤2 layers
  over the **active** pipeline). New runs never generate `prompt_pack` (see
  the retired-subtype rules above).
- The demo project is a **cloud snapshot** and carries the legacy
  two-artifact shape until the owner re-pins a regenerated snapshot; the
  adapter is what keeps it rendering consolidated in the meantime. Do not add
  persisted state for the consolidated view.

### The Experience workspace (Screens) — read-side consolidation

The old **Screen Inventory** and **Mockups** sidebar rows are consolidated into
one screen-centric **Screens** view (`selected === 'screens'`, a
`WorkspaceSelection` value, NOT an artifact slot). **This is a read-side view
layer only**: the `screen_inventory`, `user_flows`, and `mockup` artifacts keep
generating, persisting, and versioning exactly as before — no schema, prompt,
pipeline, sync, or snapshot change. Do not add persisted state for this view.

- **Stable screen ids** — every screen has a canonical `ScreenItem.id`,
  stamped by `assignStableScreenIds` inside `normalizeScreenInventory`
  (`src/lib/screenInventoryNormalize.ts`): existing content id → slug of the
  name → deterministic `-2`/`-3` suffix on duplicates, in document order.
  Because generation persists the normalized shape, **new inventories store
  their ids**, while legacy artifacts derive the *same* ids on every read (no
  regeneration/migration required — derivation is deterministic from stored
  content and never from a user-facing rename). `MockupScreen.sourceScreenId`
  (optional, back-compat) records the inventory screen a mockup screen was
  derived from (`generateMockup` stamps it; `mockupParsing.coerceScreen`
  round-trips it).
- **Join layer** — `src/lib/screenExperience.ts` (pure; no store/IDB/React;
  unit-tested in `src/lib/__tests__/screenExperience.test.ts`).
  `buildScreenIndex(inventory, flows, mockupPayload)` joins the three parsed
  artifact contents into a `ScreenExperienceIndex` with **`byId` (canonical,
  rename-safe) and `bySlug` (name-based, first-wins)** lookups. Mockup screens
  match by `sourceScreenId` first, then slugified `MockupScreen.name` (legacy
  fallback). Flow steps are markdown and only know names, so they match by
  exact slug of the parsed `[Screen Name]` step title (`stepScreenSlug`).
  Screen selection/navigation uses the **id**; per-screen images stay keyed by
  the slug of the *stored* (generated) name, so both survive display renames.
  Missing artifacts degrade gracefully; a missing inventory returns the
  module-level `EMPTY_SCREEN_EXPERIENCE_INDEX` (stable reference —
  Selector-stability rule). Slug collisions keep **all** screens as items
  (unique ids), resolve `bySlug` to the first, and are surfaced via
  `index.collisions` (warning banner in the list).
- **Views** — `src/components/experience/`: `ScreenListView` (sectioned list of
  all inventory screens with flow-ref/mockup coverage chips),
  `ScreenDetailView` + `ScreenDetailTabs` (per-screen **Overview / Flow /
  Mockups** tabs). They reuse existing pieces rather than duplicating them:
  Overview = the exported `ScreenCard` from `ScreenInventoryRenderer` (+ the
  upload gallery); Flow = `FlowJourney`/`StepCard`/`FeatureDetailDrawer` with
  the current screen's steps highlighted (`highlightedStepIndices`); Mockups =
  `MockupScreenImage` (which internally routes to the manual upload sheet).
  Shared priority-chip styles live in `src/components/renderers/screenPriority.ts`
  (own module — the react-refresh/only-export-components rule forbids constant
  exports from component files).
- **Screen metadata edits are an overlay, never a content rewrite.** User
  edits (name / purpose / userIntent / priority / notes) are stored per
  canonical screen id in the screen_inventory **ArtifactVersion's
  `metadata.screenEdits`** (`ScreenMetadataEdit` / `readScreenEdits` in
  `screenExperience.ts`, persisted via the existing
  `updateArtifactVersionMetadata` — the prompt_pack `promptEdits` pattern).
  `buildScreenIndex` applies the overlay to produce the *effective*
  `item.screen` while keeping `item.baseScreen` (stored content) as the source
  of every join and image key — so **renames cannot orphan mockups, flow refs,
  or uploaded images**. `ScreenImageGallery`/`ScreenCard` take a
  `storageName`/`imageStorageName` (the base generated name) so upload buckets
  keep their original slug after a display rename. An overlay equal to the
  generated content clears itself (saved as null); "Reset to generated"
  removes it. Edits are per-version — regenerating the inventory starts clean,
  same as promptEdits. Do NOT rewrite `ArtifactVersion.content` for edits.
- **Screen selection is URL-addressable:** `/p/:projectId?screen=<canonical
  id>[&screenTab=flow|mockups]`. The query param is the **single source of
  truth** for the open Screen Detail (via `useSearchParams`); the rendered
  view is *derived* (`activeSelection = screen param ? 'screens' : selected`)
  — never synced by a setState-in-effect. Deep links, refresh, and browser
  back/forward all work; tab switches use `replace` so history is one entry
  per screen; unknown/stale ids miss `byId` and fall back to the list;
  unrelated query params (debug flags) are preserved. `ProjectWorkspace` has a
  one-shot mount effect that switches a deep-linked project to the `workspace`
  stage when the spine is final (otherwise the param is inert). Artifact-row
  selection (`selected`) stays local component state — only the screen
  dimension lives in the URL. Screen journey nodes in **User Flows** navigate
  to Screen Detail when the node is a `screen` kind AND its slug is in
  `availableScreenSlugs` (threaded through `ArtifactContentRenderer` →
  `UserFlowsRenderer` → `FlowJourney.onNavigateToScreen`); otherwise the
  original scroll-to-step behavior is preserved.
- **Mockup coverage is explicit and overlay-based.** The Screens list shows
  "Mockups: X of N screens covered". Uncovered screens get an **Add to
  mockups** action (Mockups tab) and the list header offers a confirmed
  **Generate missing mockups** batch. Both write user-added `MockupScreen`s
  into the *current* mockup ArtifactVersion's **`metadata.extraScreens`**
  overlay (`readExtraMockupScreens`/`mergeExtraScreens`/
  `mockupScreenFromInventoryScreen` in `mockupParsing.ts`) — **never a new
  ArtifactVersion**, because per-screen images are keyed by
  `versionId:screenId:quality`, so appending a version would orphan every
  existing render. Adding coverage is free; **image generation is never
  automatic** — it's the standard per-screen action, or the batch flow which
  fires low-quality drafts only after an explicit cost-labeled confirm and
  only when an OpenAI key exists (keyless → upload sheets). Every consumer of
  a mockup payload in the workspace must read the *effective* payload
  (`mergeExtraScreens(tryParsePayload(v), v.metadata)`).
- **Reference validation is advisory, never blocking.** `buildScreenIndex`
  emits `index.issues` (`ScreenReferenceIssue`): `unmatched_flow_step`
  (screen-kind journey steps matching no screen, grouped per name),
  `unmatched_mockup_screen`, `slug_collision`, and `legacy_name_match`
  (mockup matched by name only — works, but rename-fragile). The Screens list
  renders them in the collapsed `ReferenceWarningsPanel`
  (`src/components/experience/ReferenceWarningsPanel.tsx`) with two persisted
  repairs: **Relink/Pin** writes `metadata.screenLinks`
  (mockupScreenId → canonical screenId) on the **mockup** version — the
  highest-priority mockup match, above `sourceScreenId` and name — and
  **Ignore** appends the issue key to `metadata.dismissedScreenIssues` on the
  **inventory** version. Matching runs in three passes (links →
  sourceScreenId → name) so an explicit repair always beats a coincidental
  name match. Rendering must never be gated on validation results.
- **Status/fallbacks:** the Screens sidebar dot and generation/error states map
  to the **`screen_inventory` slot** (its retry re-runs that slot, since it no
  longer has its own row); the Mockups tab surfaces the `mockup` slot's
  generating/error states. A screen_inventory version whose content isn't
  parseable structured JSON (legacy markdown) falls back to the standalone
  `ScreenInventoryRenderer` path inside the Screens view. The legacy
  `screen_inventory` and `mockup` renderMain branches remain intact and
  internally reachable — do not delete them.

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
  pipeline sections (`DEFAULT_PRD_SECTIONS`) into **dependency waves**
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
