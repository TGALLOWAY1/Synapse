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
restored snapshot is a faithful copy. It also carries the project's
**per-variant mockup images** (Phase 3D — the Screens Mockups-tab variant
gallery, from the dedicated `src/lib/mockupVariantImageStore.ts` IDB store, keyed
`versionId:screenId:variantId:quality`) as `SnapshotProjectBundle.mockupVariantImages`
(a `MockupVariantImageSnapshot` — see `src/lib/mockupVariantSnapshot.ts` and the
Phase 3D bullet under Screens). All three image kinds split out of the JSON
envelope and ship one request each (reusing the **same** per-image blob channel
— each blob is keyed by a hash of the image key, and the key shapes never
collide: mockup `versionId:screenId:quality`, screen `artifactVersionId:screenSlug:versionNumber`,
variant bytes under `vimg:`-prefixed keys) so neither upload nor download crosses
Vercel's ~4.5 MB cap. The wire format carries mockup images in `payload.images`,
screen-inventory images in `payload.screenImages`, and variant image metadata
inside `payload.project.mockupVariantImages` (bytes via the `vimg:` channel).
One snapshot can be pinned as **the demo** (`_demo.json` pointer + public
`?demo=1` read); `loadDemoProject` restores it under the stable `DEMO_PROJECT_ID`.
Snapshot fields (`tasks`/`workflowRuns`/`screenImages`/`mockupVariantImages`) are
all **optional on the wire** — pre-existing snapshots lack them and restore
defaults each to empty. When adding a new persisted slice or IDB image store,
add it to `collectProjectBundle`/`collectScreenImages`/`collectVariantImages`, the
restore writers, and `namespaceSnapshotForRestore`, or it silently won't travel
in snapshots.

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
  restore, archive toggles, hard-delete). No public/shared access exists. Each
  doc carries a monotonic `revision` counter (`$inc` per upsert); `upsertProject`
  returns the new revision and accepts an optional **`expectedRevision`** (or, for
  legacy rows with no revision yet, **`expectedUpdatedAt`**; both threaded from the
  query string) — an **atomic optimistic-concurrency guard**: the expected version
  is pinned INTO the `updateOne` filter (`upsert:false`), so the check-and-write
  is atomic and two devices saving concurrently with the same baseline can't both
  win — the loser's filter misses and it gets `{ conflict, currentRevision }`
  (mapped to **HTTP 409**) rather than a silent overwrite. On a miss the store
  distinguishes conflict (row advanced) from a remotely-deleted row (re-created
  via the unconditional path). A first-time save (no guard) is unaffected.
- **Client serialization.** A **ProjectBundle** (`src/lib/projectBundle.ts`,
  pure) is the transport unit: `extractProjectBundle` gathers a project's nine
  store slices; `mergeBundlesIntoSource` merges server bundles back **additively
  — local always wins on id collision** (an additive pull only ADDs projects this
  device lacks). `overwriteBundlesIntoSource` is the deliberate exception —
  REPLACES a project's local slices with the server copy, used only for a safe
  server-newer refresh (local clean) or an explicit "use cloud" conflict
  resolution. `src/lib/projectsClient.ts` is the `/api/projects` transport
  (`credentials: 'include'`; throws on non-2xx so a failure never silently drops
  projects; `saveProject` sends `expectedRevision` and throws a typed
  `RevisionConflictError` on 409).
- **Durable sync metadata** (`src/lib/projectSyncMeta.ts`). A per-user
  localStorage map (`synapse-project-sync-meta::u:<userId>`, mirrors
  `projectMigration.ts`) recording, **separately from user-authored project
  content**, each project's `lastSeenServerRevision`/`lastSeenServerUpdatedAt`
  (the conflict-detection baseline), `lastCloudSavedAt`, `lastCloudSaveError`,
  `hasUnsyncedChanges` (durable dirty flag — survives reload so an offline edit
  isn't forgotten), and `conflict`. `isServerNewer(server, meta)` compares
  revision-first, `updatedAt` fallback, false when there's no baseline. All
  fields optional → legacy/anonymous data is unaffected.
- **Sync orchestrator** (`src/store/projectServerSync.ts`). `startProjectSync`/
  `stopProjectSync` are driven from `authStore.setUser`. On sign-in it
  **reconciles**: for a project missing locally → additive pull; for a project on
  **both** sides → compare the server summary against the durable baseline
  (`isServerNewer`) — **server-newer + local clean** overwrites local with the
  newer copy and re-baselines (safe refresh), **server-newer + local dirty** flags
  a **`conflict`** and touches neither side; local-only projects still migrate
  (push). It then subscribes to the store to **push** changed projects (debounced,
  per-project) and remote-delete locally-deleted ones. Every push is a
  **conditional write** — it sends the last-seen `expectedRevision`, so a stale
  push (server advanced on another device) is rejected (409 →
  `RevisionConflictError`) and becomes a `conflict` instead of clobbering the
  newer copy; a conflicted project is not auto-pushed. **A failed save never drops
  local data** — it stays in localStorage and surfaces a per-project `error` sync
  state (+ durable `lastCloudSaveError`). Conflict resolution is **explicit, never
  silent**: `resolveConflictUseCloud` (adopt cloud, discard local — offer a
  recovery download first) and `resolveConflictKeepLocal` (overwrite cloud from
  local, re-baselined so the conditional push wins). `suspendPush` silences the
  echo while applying pulled/overwritten bundles. The read-only demo project
  (`DEMO_PROJECT_ID`) is never synced. A `beforeunload` guard warns only when
  cloud state is genuinely stuck (`conflict`/`error`), never for normal pending
  pushes.
- **Sync UI state** (`src/store/projectSyncStore.ts`,
  `src/components/sync/ProjectSyncStatus.tsx`). Overall `phase`
  (idle/loading/ready/error) + `online` + per-project
  saving/saved/error/dirty/**conflict** (with `lastCloudSavedAt`/
  `lastCloudSaveError`/`conflict` details; `patchProjectSync` merges partial
  updates). Surfaced as: a `SyncStatusBanner` (retry on failure, conflict count)
  and per-row `ProjectSyncDot` in `ProjectDrawer`; a compact `ProjectCloudStatus`
  pill in the workspace header distinguishing saved-on-device / synced-to-cloud
  ("synced Nm ago") / cloud-sync-pending / cloud-save-failed / conflict; and a
  `ProjectConflictBanner` above the workspace body ("Cloud version changed on
  another device" → keep local / use cloud / download local copy). `ExportModal`
  shows an at-risk banner + recovery download when the project's cloud state is
  failed/conflict.
- **Recovery bundle** (`src/lib/projectRecovery.ts`). A network-free JSON
  download of one project's LOCAL state (the `ProjectBundle` in a self-describing
  envelope) for at-risk cloud durability — failed save, expired session, network
  outage, server body-limit rejection, or an unresolved conflict. Reachable from
  the conflict banner and the export modal.
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
  need to reason about retry policy. **Both modes now parse Gemini's
  `usageMetadata`** and fire `JsonModeConfig.onUsage` — the streaming path
  reads it off the final SSE chunk, closing the old artifact-token-capture gap.
  `callGemini`/`callGeminiStream` are the **single chokepoint** for every LLM
  call in the app; both are instrumented by the LLM Trace Viewer (see below).

- **LLM Trace Viewer (`src/lib/trace/`, `src/components/developer/`) — a
  developer-only debugging surface.** Every call through the geminiClient
  chokepoint is captured (request, redacted body, raw response, parsed JSON,
  token usage, finishReason, retries, timing) via `beginTrace()`
  (`traceRecorder.ts`). **Capture is OFF by default** — enabled per browser via
  the viewer's toggle (localStorage `synapse-llm-trace`) or a `?llmtrace` query
  param; when off, `beginTrace` returns a zero-cost no-op handle. Enabled traces
  land in an in-memory registry (subscribable via `useLlmTraces` /
  useSyncExternalStore) **and** IndexedDB (`traceStore.ts`, capped at 1000) so
  past generations are inspectable after a reload. **Secrets are redacted at
  capture time** (`traceRedaction.ts`, pure/unit-tested) so no api key / bearer
  token / cookie / secret ever reaches the registry or disk — never weaken this.
  Call sites enrich traces with `JsonModeConfig.traceMeta`
  (`LlmTraceMeta`: purpose / stage / artifact / project / inputs / promptPieces
  / contextItems / sessionId) — wired into the PRD sections (via
  `ModelProvider.generateText`), core artifacts (`generateCoreArtifact`
  `traceContext`), consistency review, safety, preflight, and single-section
  retry. One `sessionId` per PRD run / artifact-bundle run groups a whole
  generation; calls without one group heuristically (`traceSessions.ts`, pure).
  The viewer lives at **`/developer/llm-trace`**, gated by `RequireOwner`
  (auth + possession of `SYNAPSE_OWNER_TOKEN`, the same client signal the
  Snapshots panel uses) and surfaced only in Settings' owner-gated **Developer**
  section — every non-owner experience is unchanged. It offers a session-grouped
  filterable call list, a tabbed inspector (Overview / Input / Prompt / Context /
  Raw Request / Raw Response / Parsed / Validation / Prompt Construction), diff
  mode (compare two calls), and standalone offline-HTML export
  (`traceExport.ts`, pure). This is purely observational — it never affects
  generation. See `docs/LLM_TRACE_VIEWER.md`.

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
    rendering — the renderer blocks and optional `StructuredPRD` fields stay.
    The remaining sections are prompted (and, where it matters,
    **schema-enforced** via lean slice schemas in `prdSchemas.ts` —
    `leanUxPageItemSchema`/`leanFeatureItemSchema`/`leanSuccessMetricSchema`,
    since Gemini JSON mode can't emit properties absent from the schema) to
    stay at decision level: `uxPages` is a lean screen list (name/purpose/key
    content — no per-screen interaction/empty/loading/error specs), features
    drop `uiAcceptanceCriteria`/`analyticsEvents`, success metrics drop
    `instrumentation`, and the architecture narrative is a short decision
    story grounded on `domainEntities`. `RUBRIC_DEFINITION` (`prdPrompts.ts`)
    encodes this split — decisions live in the PRD, detail lives in the
    artifacts — so don't re-add "full schemas / state machines / per-page
    component specs" demands to prompts or rubric. `runDag()` runs every section whose
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
    Architecture → Data Model → State Machines → NFRs → reference appendix →
    **"Where the Detail Lives"**, a static deterministic handoff appendix
    pointing to the downstream artifacts, rendered unconditionally by both
    renderers — legacy spines' persisted `responseText` picks it up on the
    next re-render (edit / section retry / regenerate), while the in-app
    Structured view shows it immediately for every PRD)
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
    - **Automatic final consistency review** (`prdConsistencyReview.ts`): runs
      **by default and silently** as the last step of normal PRD generation
      (one extra fast-model call, after DAG merge, before markdown is rendered
      for display/storage). It reconciles terminology / names / feature ids /
      duplicates / cross-section contradictions across the merged PRD. The user
      is **never** asked to approve ordinary repairs. The reviewed PRD replaces
      the merged one **only** when it clears conservative acceptance guards; a
      failed/unsafe review is discarded and the merged PRD is kept, so a review
      failure never blocks a usable PRD:
      - **merge-over-original** (omitted fields preserved — safety-restriction
        `constraints` survive even if the model omits them),
      - **detail-loss guard** (discards any revision shrinking/emptying a key
        content array below 70%),
      - **required-field guard** (vision/coreProblem/architecture must stay
        non-empty; targetUsers/features/risks must stay non-empty),
      - **feature-id stability** (every original `Feature.id` must survive —
        downstream artifacts/tasks reference them),
      - **product-identity guard** (a present `productName` may be canonicalized
        but never blanked),
      - **semantic preservation guards** (Phase 3 — protect facts downstream
        artifacts consume directly): a revision is discarded if it drops/reduces
        any feature's **acceptance/success criteria**, drops any feature
        **dependency id** reference, drops or **weakens a safety restriction**
        (`constraints` — every original entry must survive verbatim; a reworded
        or removed restriction is treated as weakening), or drops **entity fields,
        relationships, or example values** (rich-data-model + `domainEntities`,
        matched by name). All guards **reject wholesale** and keep the
        deterministically-merged PRD — the review is a polish, never a fact
        editor. `evaluateGuards` is the single ordered chokepoint.
      On apply it sets `generationMeta.revised` and adds a `consistency_review`
      pass record. The outcome (`ran`/`applied`/`status`/`rejectionReason`) is
      recorded in `generationMeta.consistencyReview` (`ConsistencyReviewMeta`),
      which also carries a compact **structured diff** (`ConsistencyReviewDiff`:
      `sectionsChanged`, `featuresReworded`, `productNameChange`,
      `guardsTriggered`, `outcome`) built for both accepted and rejected passes.
      `summarizeConsistencyReview(meta)` renders a one-line summary surfaced in
      the PRD **version-history panel** (`VersionEntry.consistencyReview`) — the
      only UI exposure; generation is never affected. It is **skipped** for a
      partial run (a section failed → PRD already surfaced as incomplete). The
      localStorage `synapse-prd-consistency-review` key is now only a
      **developer/debug opt-out** (`'false'` → skip via `enableConsistencyReview:
      false`); default and any other value leave the review on. `runPrdGeneration`
      resolves that override; `ProjectWorkspace.handleRegenerate` leaves it
      default-on. Do **not** re-add a user-facing "repair PRD?" prompt.
    - **Permissions & Roles quality gate** (`src/lib/prdRolesSanitizer.ts`,
      pure/idempotent). The `roles` slice (generated by the `ux_loops` section)
      must describe **business capabilities a user has inside the product**
      ("Create workouts", "Invite users", "View analytics") — not how the
      software is built or secured. Left unguided the model sometimes emits
      hundreds of implementation/security-config "restricted" items ("Disable
      SSL pinning", "Modify SQLite database", "Bypass rate limiting") that read
      like hallucinated infra docs or prompt injection. The fix is two-layer:
      **(1) prompting** — the `prdSectionPrompts.ts` (`ux_loops`) roles spec
      demands concise capability-based
      permissions (allowed 5–15, restricted optional & small 3–10, omitted when
      nothing product-meaningful), and forbid backend/infra/DB/OS/networking/
      security-implementation detail; **(2) deterministic validation+repair** —
      `sanitizeRolePermissions` drops any item matching a technical-term
      denylist (semantic check: "is this something a user can do inside the
      product?"), dedupes, caps list sizes, and omits an empty Restricted
      section. It runs at **generation** (`prdSectionMerge.mergeSectionsToStructuredPrd`
      + the single-section retry overlay in `prdSectionRetry.ts`) **and at
      render** (`prdMarkdownRenderer.renderRoles`, `PremiumSections.RolesSection`)
      so legacy persisted PRDs also display clean without regeneration. It is a
      deterministic repair, not an LLM re-generate loop (lower risk, guaranteed
      output). When broadening/narrowing the denylist, keep it precise — match
      "authentication server" not bare "authorize", "feature flag" not "feature
      gating" — so legitimate product permissions survive.
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
    - **Design-system lock affordance.** The **Design System row only**
      (`isLockedAsset` in `ArtifactWorkspace`) shows a small `Lock` icon in the
      sidebar/mobile-header once its slot status is `done`, signalling the
      project's visual direction is locked in — one committed aesthetic every
      downstream asset is generated against. It's a passive nudge, not a hard
      lock: the user can still change direction via `ChangeDirectionModal`
      (which carries the downstream-regression warning), but the lock
      encourages staying with one aesthetic to avoid costly regeneration of
      screens/mockups. Do **not** re-add per-asset lock icons to downstream
      rows.
    - **Mockup-drift prompt.** Regenerating the design system produces a new
      `tokensHash`, which `stalenessSlice` already uses to flip dependent mockups
      to `possibly_outdated` (the auto-flag). On top of that, the Mockups view in
      `ArtifactWorkspace` renders an amber **"Design system changed … Regenerate
      the mockups"** banner when the mockup's recorded design_system
      `anchorInfo` (tokensHash) differs from the project's current preferred
      design system (`selectPreferredDesignSystem`), wired to the existing mockup
      regenerate-confirm. Mockup *images* are keyed by the new mockup version id,
      so the user must regenerate to pull the new visual direction through.
  - **Canonical PRD Spine (`src/lib/canonicalPrdSpine.ts`) — the primary,
    authoritative context for artifact generation.** `buildCanonicalPrdSpine(prd,
    options)` is a **pure, deterministic** builder (NEVER an LLM call) that
    distills the finalized `StructuredPRD` into a compact structured contract
    (`CanonicalPrdSpine` in `src/types`): product identity, users/JTBD, a
    canonical feature glossary (**PRD `Feature.id`s preserved verbatim**),
    conservative **screen seeds** (deterministic `scr-<slug>` ids) and **entity
    seeds** (deterministic `ent-<slug>` ids — isolated in `slugId`, an interim
    stable-id source), constraints (privacy/security auto-extracted), safety
    restrictions (reconstructed from the persisted `SpineSafetyReview` via
    `buildRestrictionDirective`), architecture direction, and design direction
    (from the selected preset). Seeds are **seeds, not full artifacts** — derived
    only from existing structured fields (`uxPages`/`userLoops`;
    `domainEntities`/`richDataModel`), never invented. `validateCanonicalPrdSpine`
    records non-invasive warnings in `spine.meta.validation` (never a silently
    empty/misleading spine). The spine is **attached to `SpineVersion.canonicalSpine`**
    on final settle (`updateSpineStructuredPRD`, only when `generationMeta` is
    present — a diagnostic/diffing copy; artifact generation always **rebuilds it
    lazily** from `structuredPRD` so old projects and post-edit PRDs stay
    consistent). In `generateCoreArtifact` the prompt is assembled by the pure,
    unit-tested **`src/lib/services/artifactPromptBuilder.ts`** (`buildArtifactPrompt`)
    with an explicit, machine-checkable **source hierarchy** — labeled sections in
    a fixed authority order: **`## TASK` → `## SOURCE HIERARCHY — READ FIRST`
    (the conflict-resolution rules) → `## GUARDRAILS` → `## AUTHORITATIVE —
    CANONICAL PRD SPINE` (or `## AUTHORITATIVE — STRUCTURED PRD SUMMARY` on the
    legacy no-spine fallback) → `## AUTHORITATIVE — STRUCTURED DEPENDENCY
    SUMMARIES` → `## TASK CONSTRAINTS — SELECTED OPTIONS` (preset, only when
    present) → `## KNOWN CONFLICTS & STALENESS` (only when there is something to
    report) → `## APPENDIX — FULL PRD MARKDOWN (SECONDARY REFERENCE ONLY)`**. The
    hierarchy is: (1) canonical spine authoritative, (2) structured dependency
    summaries authoritative for the detail they own but yielding to the spine on
    conflict unless explicitly newer/valid, (3) selected preset/options are hard
    task constraints, (4) full PRD markdown is **secondary reference only** and
    must never override the structured sources — with an explicit instruction to
    cite features by canonical id/name, never a prose-only/stale name. The
    conflict/staleness block surfaces machine-derived notices (missing REQUIRED
    dependencies via `findMissingRequiredDependencies`, spine validation
    warnings) plus **stale feature-name conflicts** (`detectStaleFeatureNames`:
    canonical feature names absent from the PRD prose → likely drift). The spine
    subsumes and **replaces** the old standalone feature glossary + inline PRD
    summary (they are dropped when a spine is present, used only in the legacy
    fallback). A spine with **no features** yields a null spine section → the
    legacy structured-summary fallback. Each artifact version stamps
    `metadata.spineContextUsed` / `spineSchemaVersion`. Do **not** re-add the
    duplicate glossary/summary blocks alongside the spine, do **not** feed long
    markdown into the spine (it must stay compact/structured), and do **not**
    re-order the prompt so the PRD markdown appendix precedes the structured
    sources. See `docs/CANONICAL_PRD_SPINE.md`.
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
    (`getFastModel`), else **(3)** the tier fallback in `getFastModel`/
    `getStrongModel`: an explicit tier model → the single Default model
    (`GEMINI_MODEL`) → the **tier's own default** (`DEFAULT_FAST_MODEL` = Flash,
    `DEFAULT_STRONG_MODEL` = Pro, both in `geminiClient.ts`). The strong tier
    defaults to **Pro**, matching the Settings pickers — it must never collapse
    to the Flash global default (the old `getStrongModel → getModel →
    DEFAULT_GEMINI_MODEL` chain did, so complex PRD sections / high-complexity
    artifacts silently ran on Flash even though Settings advertised Pro).
    `coreArtifactService.selectArtifactModel`
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
    uploaded / awaiting). **Two-phase completion:** a mockup has a SPEC phase
    (the ArtifactVersion, marked done by the job controller as soon as the spec
    lands) and an independent IMAGE phase (one render per screen, async, can
    partially fail). `computeMockupImageCompletion` (`src/lib/mockupImageCompletion.ts`,
    pure) derives the visual status (`none`/`generating`/`partial`/`complete` +
    `failedScreenIds`) from per-screen image results so the UI never presents a
    mockup as fully complete when images failed: `MockupImageStatusChip` shows a
    red "Images incomplete · N failed" state, and `MockupViewer`'s header swaps
    the flat "AI Generated" badge for the live status and renders a
    "Retry failed images" banner (per-screen retry already exists in
    `MockupScreenImage`). Image failures are tracked in the session-scoped
    `mockupImageStore` `errors`/`inFlight` maps (transient — a reload re-attempts
    on view). The Settings section is `settings/ArtifactModelsSection.tsx`,
    now the single place PRD **and** artifact models are configured: the PRD row
    (badge "Per-section") expands to reveal the authoritative Fast (Flash) /
    Expert (Pro) model pickers **plus** a read-only per-section preview showing
    which tier each PRD section actually runs on — this replaced the old,
    separate "PRD Generation Models" block in `SettingsModal` (removing the
    redundancy that made PRD look like it "defaulted to Flash"). Text artifacts
    have one selector each; Mockups has an "Image Source" select. The `SettingsModal`
    itself groups advanced/fallback controls (Gemini billing project, Local
    browser keys, Integrations, Refine & enhance model) behind collapsed
    `Disclosure` sections; the Gemini billing project ID sits with the vault (it
    applies to every Gemini request regardless of key source), not buried in the
    local-keys fallback. The model list is the shared `src/lib/modelCatalog.ts`.
    Three of these
    (screen/data/component inventory) use Gemini JSON mode with schemas in
    `schemas/artifactSchemas.ts`, then convert to markdown via
    `structuredArtifactToMarkdown()` for storage; renderers in
    `src/components/renderers/` parse that markdown back to card layouts.
    The **`data_model` renderer** (`DataModelRenderer.tsx` +
    `src/components/renderers/dataModel/`) presents the artifact as an
    interactive entity-relationship design surface rather than a schema dump:
    a compact **overview header** (`DataModelOverview` — provenance/freshness +
    entity/relationship/constraint/index/PII counts), an **ER-style diagram**
    (`EntityGraph`) that mirrors the artifact dependency graph / user-flow
    diagrams (rounded node cards, deterministic layered SVG layout, directional
    cardinality-labelled edges, click-a-node-to-open-its-card), and
    **collapsible entity cards** (`EntityCard`) whose expanded state shows
    grouped field tables (colour-coded type chips, required/indexed markers) and
    compact **inspector rows** (`InspectorRow`) for relationships / constraints /
    privacy / indexes in a fixed colour language (relationship=blue,
    constraint=purple, privacy=rose, index=slate, warning=amber). All of it is
    **derived, never hand-drawn**, by the pure, unit-tested
    **`src/lib/dataModelGraph.ts`** (`analyzeDataModel` → graph + summary): it
    recovers structured relationships from the parser's `RELATIONSHIP` callouts
    (so cardinality is a faithful derivation of the schema's `DataRelationship`
    `type`, never invented), **dedupes reciprocal `has_many`/`belongs_to` pairs**
    into one parent→child edge, resolves plural/singular targets, tracks
    unresolved/self references separately, and derives conservative entity
    **categories** (`core`/`user_config`/`generated`/`system`/`external`, from
    userFacing/mutability/integration-shaped signals only) used for the optional
    "Group by category" swimlanes and node accents. The renderer keeps the legacy
    ReactMarkdown fallback for unparseable content and preserves the
    "How This Data Model Works", "How This Appears in the Product", and
    "API Endpoints" sections. Multi-entity models start collapsed (single-entity
    expanded) for scannability; provenance/freshness reach the overview via the
    optional `prdVersionLabel`/`staleness` props threaded through
    `ArtifactContentRenderer` for `data_model` only. Do **not** change
    `dataModelMarkdown.ts`'s parser output shape without re-checking
    `dataModelGraph.ts`, which consumes its `ParsedEntity.callouts`.
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
- **`prompts/prdPrompts.ts`** — the shared PRD prompt fragments
  (`SAFETY_OVERRIDE`, `PROMPT_CONTRACT`, `RUBRIC_DEFINITION`) composed into
  every section preamble by `prdSectionPrompts.ts`; `SAFETY_OVERRIDE` is
  prepended ahead of all formatting/rubric text as defense-in-depth and is
  **rendered from `safety/safetyPolicy.ts`** (see the Safety gate section) so
  the capability list can never drift from the classifier's. The legacy
  single-pass strategy instruction was removed (no runtime callers; it still
  demanded retired-section content).
- **Shared prompt fragments & snapshot net.**
  `prompts/artifactPromptFragments.ts` holds the artifact-prompt sentences that
  used to be copy-pasted across `CORE_ARTIFACT_PROMPTS` subtypes
  (`artifactRole(role)`, `AGENT_AGNOSTIC_RULE`, `ANTI_PREAMBLE_RULE`);
  `prompts/imagePromptFragments.ts` holds the image-prompt strings shared by
  the internal gpt-image-2 builder and the external copy prompt
  (`IMAGE_PLATFORM_HINTS`, `IMAGE_CLOSING_RULES`, and `fidelityStyleHint(fidelity,
  hasDesignSystem)` — the token-aware variant drops the generic "neutral
  palette"/"accent color" claims whenever the Design System Brief is appended,
  so one prompt never asks for a neutral palette AND a brand palette at once).
  Do not restate these fragments inline in a task prompt — import them.
  **Every major prompt surface is snapshot-locked** by
  `src/lib/__tests__/promptSurfaces.test.ts` (PRD fragments + all section
  prompts, safety classifier + restriction directive, preflight, all
  `CORE_ARTIFACT_PROMPTS`, both image builders): an intentional prompt edit
  must update the snapshot in the same change; an unreviewed snapshot diff is
  drift. See `docs/audits/PROMPT_ARCHITECTURE_AUDIT.md` for the full prompt
  architecture map and remaining recommendations.

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
- **`safetyPolicy.ts` is the single source of the policy TEXT.** The
  disallowed-capability list, the classifier system instruction, the in-prompt
  `SAFETY_OVERRIDE` (re-exported via `prompts/prdPrompts.ts`), and the two
  concern-summary fallbacks in `safetyReviewArtifact.ts` all render from this
  one module — they used to be four independently-drifting literals. Edit the
  policy there, never inline at a surface; `safetyPolicy.test.ts` asserts every
  surface carries every capability term.
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

### Artifact validation: blocking vs advisory (`src/lib/artifactBlockingValidation.ts`)

Most artifact validation is **advisory** — `validateArtifactContent` /
`validateCrossArtifactConsistency` produce warnings stamped into
`ArtifactVersion.metadata.validationWarnings` but never change status. A narrow,
high-confidence set of defects is **blocking**: `detectArtifactBlockers(subtype,
content, prd)` (pure) flags (1) a `data_model` with no API surface, (2)
`user_flows` with no error paths, (3) an implementation-critical artifact
(`data_model`/`user_flows`/`implementation_plan`) that references **none** of the
PRD features (no traceability), and (4) a JSON-mode artifact
(screen/data/component inventory) that parses but is structurally empty. When
blockers exist, `runCoreArtifactSlot` still **saves the version** (content
preserved for review) but stamps `metadata.validationBlockers` and sets the slot
status to the new `GenerationStatus` value **`needs_review`** instead of `done`.
The state is durable: `ArtifactWorkspace.slotStatusFor` re-derives `needs_review`
from `readValidationBlockers(preferred.metadata)` after the transient job slot is
cleared (post-reload). UI: an amber `ShieldAlert` `StatusDot` + an in-view
"Needs review" banner listing the issues with a Regenerate action. Keep the
blocker list conservative — advisory warnings must stay non-blocking.

**Automatic traceability repair — never surface a "no traceability" blocker
before attempting repair** (`src/lib/artifactTraceabilityRepair.ts`, pure).
Blocker (3) — missing PRD-feature traceability — is often a false positive: an
artifact genuinely derived from the product's features but not spelling out a
feature id/name verbatim. So `runCoreArtifactSlot` reclassifies blockers via
`classifyBlockers` and, when the traceability blocker is the **sole** issue (the
artifact is otherwise structurally valid — `otherBlockers.length === 0`),
attempts a deterministic enrichment pass **before** exposing any blocker:
`repairTraceability` runs `matchFeaturesToContent` (token-overlap match of the
canonical PRD features against the artifact's own content — it can NEVER invent
an id, every mapped id/name comes from `prd.features`) and, on a confident
match, **appends** a `## PRD Feature Traceability` section citing the mapped
ids/names (append-only — substantive content is never rewritten). The artifact
is then **re-validated**; if clean it saves as normal `done`, and a small
neutral advisory note (not the amber banner) is shown. Repair provenance is
stamped into version metadata regardless of outcome (`repairAttempted`,
`repairType: 'traceability_enrichment'`, `repairSucceeded`,
`originalValidationBlockers`, `postRepairValidationBlockers`, `repairWarnings`,
`traceabilityMappedFeatures`) and the version's change summary notes the
enrichment, so history distinguishes an original vs. auto-enriched preferred
version. When repair is **ineligible** (other blockers present) or **fails** (no
confident feature match), the slot stays `needs_review` but the raw blocker is
reworded to the clearer `TRACEABILITY_UNRESOLVED_MESSAGE` ("Synapse could not
verify how this artifact maps back to the PRD…") rather than "references none of
the PRD features". Only the initial validation is stricter now-structural:
traceability is emitted **structurally** by generation (data_model entities carry
`featureRefs`, rendered as a `**Related Features:**` line; user_flows emit a
`**Related Features:**` line per flow; implementation_plan carries per-task
`linkedArtifacts.prd` in its `synapse-plan` JSON fence), reducing how often
repair is even needed. Legacy artifacts are unaffected on load — blockers are
only computed at generation time and read from persisted metadata, so an old
artifact without structured traceability never shows a blocking banner unless it
is regenerated/revalidated.

### Dependency sufficiency gate (`src/lib/artifactDependencyGate.ts`)

An artifact must not silently generate from missing/errored **required** upstream
dependencies (which previously produced degraded output behind a soft "Not
generated yet." placeholder). `REQUIRED_DEPENDENCIES` (`coreArtifactPipeline.ts`,
a conservative subset of each subtype's `dependsOn`: `user_flows` ←
`screen_inventory`; `implementation_plan` ← `screen_inventory` + `data_model`)
declares which deps block. `generateCoreArtifact` calls
`assertDependenciesSufficient(subtype, generatedArtifacts, { allowMissing })`
**before any model call** — a missing required dep throws
`DependencyInsufficiencyError` (surfaced as a slot error) unless
`allowMissingDependencies` acknowledges degraded generation. The happy path never
false-blocks because `buildDependencyLayers` runs required deps in an earlier
layer. `runCoreArtifactSlot` stamps `metadata.dependencyStatus`
(`complete`/`degraded`) + `missingRequiredDependencies`. `buildDependencyContext`
labels required deps `(REQUIRED)` and, when one is absent, emits an explicit
**MISSING** notice instead of "Not generated yet.". Screen-inventory dependency
context is summarized via `summarizeScreenInventoryDependency`, which emits the
**full screen roster (every id/name) first, never truncated**, then truncates the
verbose prose — so downstream artifacts never lose a screen reference to a long
prose cut.

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
  Architecture → summary stack; Risks (milestone or appendix) → `plan.risks`
  (their own overview card — deliberately **not** folded into
  `readiness.warnings`, so the readiness signal stays trustworthy).
  `readiness` and `traceability` are always **derived, never
  persisted/generated**. The legacy prompt-card parser is shared via
  `src/lib/services/promptPackParser.ts` (extracted from
  `PromptPackRenderer`).
- **Renderer.** `ImplementationPlanRenderer` routes through the adapter into
  `renderers/implementationPlan/ConsolidatedPlanView.tsx` — a guided build
  launcher, not a report. Tab **ids** keep the internal vocabulary
  (`overview`/`milestones`/`prompt_packs`/`quality_gates`/`traceability`) but
  the **labels** are Build Brief / Roadmap / Prompts / Validation / Coverage.
  An executive `PlanHeader` sits above the tabs: readiness pill, scope
  counts, generated-from PRD version + staleness (threaded like data_model's
  `prdVersionLabel`/`staleness` props), a primary **Copy next prompt** CTA,
  and the **Convert to tasks** entry point (moved out of `ArtifactWorkspace`'s
  floating row; the legacy markdown fallback renders its own
  Convert-to-Tasks row so the modal stays reachable either way, and the
  outer white prose card is skipped for `implementation_plan` since the view
  brings its own cards). Decision-surface data is derived by the pure,
  unit-tested **`src/lib/services/implementationPlanInsights.ts`**:
  prompt-pack build order + next-pack resolution, gate rows with
  milestone/prompt linkage and verify commands, the coverage matrix (cells
  are explicitly `covered`/`missing`/`not_tracked` — `missing` only when the
  plan links that artifact kind somewhere, so absence is never
  over-reported), change-impact scoping per upstream artifact, critical-path
  resolution (ids/names → clickable milestone chips), and structured prompt
  previews. **Honest gate statuses:** every quality gate defaults to **Not
  run** — green/passed styling only ever reflects a user-recorded outcome;
  never re-add implied-pass icons. User progress (gate outcomes + copied
  packs) persists as the **`planProgress` metadata overlay** on the
  implementation_plan ArtifactVersion (`readPlanProgress`; same per-version
  pattern as screenEdits/promptEdits — regeneration starts clean; written
  silently via `updateArtifactVersionMetadata`, no history event). Saved
  `ProjectTask`s are threaded in as `savedTasks` so structured-plan task ids
  (preserved by `taskExtractor`) mark milestone tasks as "tracked" vs merely
  planned. Fence-less, milestone-less content falls back to the old timeline
  / plain markdown. `ArtifactWorkspace` threads the legacy standalone
  prompt_pack artifact's preferred content in as `promptPackContent`, plus
  `sourceVersions` (core_artifact sourceRefs resolved to "Data Model v2"
  labels for Coverage provenance), via `ArtifactContentRenderer`.
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
  **`stepScreenSlug` canonicalizes the `scr-` screen-seed prefix**
  (`stripScreenSeedPrefix` in `journeyNode.ts`) so a step whose bracket carries
  the canonical spine seed id (`[scr-infographic-library]` — a form the
  user_flows model sometimes emits instead of the human name, since the spine
  prompt tells it to "reuse screen seed ids") still joins to the
  `infographic-library` screen at read time (fixing already-final artifacts
  without regeneration). Because it is the single shared key for the
  flow→screen join, journey grouping, AND flow-node navigation, normalizing it
  there keeps all three consistent. The display mirrors this:
  `prettyScreenTitle` (also `journeyNode.ts`) renders a seed-id step title as
  its human name ("Infographic Library") in the flow renderer. The user_flows
  prompt was also tightened to write the human display name in the bracket, so
  new generations avoid the drift at the source. Only the `scr-` prefix (with a
  `-`/`_` separator) is stripped, so a real name like "Scribble Pad" is never
  touched.
  Screen selection/navigation uses the **id**; per-screen images stay keyed by
  the slug of the *stored* (generated) name, so both survive display renames.
  Missing artifacts degrade gracefully; a missing inventory returns the
  module-level `EMPTY_SCREEN_EXPERIENCE_INDEX` (stable reference —
  Selector-stability rule). Slug collisions keep **all** screens as items
  (unique ids), resolve `bySlug` to the first, and are surfaced via
  `index.collisions` (warning banner in the list).
- **Views** — `src/components/experience/`: `ScreenListView` (sectioned,
  filterable list of all inventory screens topped by the **Screen Coverage &
  Readiness** panel — `ScreenCoveragePanel`; per-card readiness badge,
  linked-feature/risk chips, state/mockup/flow metadata and
  "N incoming · N outgoing" navigation labels), `ScreenDetailView` +
  `ScreenDetailTabs` (per-screen **Overview / Flow / Mockups** tabs). They
  reuse existing pieces rather than duplicating them: Overview = the
  structured `ScreenOverviewPanel` (screen contract — see the readiness
  layer below; the legacy `ScreenCard` survives in the standalone
  `ScreenInventoryRenderer` fallback) + the upload gallery; Flow =
  `FlowJourney`/`StepCard`/`FeatureDetailDrawer` with the current screen's
  steps highlighted (`highlightedStepIndices`) plus a per-flow "This screen
  appears in" context block (repeated appearances labeled "— Step N
  (appearance i of k)"; decision steps flag unspecified branch outcomes).
  The `FlowJourney` timeline **groups consecutive steps that share a screen**
  (`buildJourneyGroups` in `journeyNode.ts`, grouped by `stepScreenSlug`) into
  one card: the screen name shows once as the header (with a "Steps N–M"
  range), and each step reads as a sub-row **labeled by its user action** (the
  "— User action → System response" half the flat node list hid), so a screen
  owning several sequential steps is no longer repeated node-after-node. It is
  **pure presentation over the same parsed `user_flows` steps** — no schema,
  prompt, or persistence change, so it fixes legacy/demo flows without
  regeneration. The header navigates to the screen (slug-gated, unchanged),
  sub-rows scroll to their step card, and single-step screens collapse to one
  row (keep `buildJourneyGroups` keyed on the same slug navigation uses, or a
  group header could point at the wrong screen);
  Mockups = the **Phase 3A `MockupVariantsPanel`**
  (`src/components/experience/MockupVariantsPanel.tsx`): a viewport × state
  **variant gallery** driven by `buildScreenMockupVariants`
  (`src/lib/mockupVariants.ts`, pure), with a derived summary row
  ("N of M recommended variants generated · K missing · coverage unknown for
  legacy mockup"), selectable variant cards (generated vs. missing, visually
  distinct), and a **selected-variant detail panel**. The primary generated
  Default variant renders the existing `MockupScreenImage` (its
  generate/upload/regenerate actions are untouched); missing variants are
  honest placeholders (NO per-variant generation in Phase 3A — no dead
  "Generate variant" button); a `buildMockupSpecCoverage` panel shows spec
  coverage or an honest "Coverage unknown" for legacy mockups. See the
  "Mockup variants (Phase 3A)" bullet below. Shared priority-chip styles live in
  `src/components/renderers/screenPriority.ts`
  (own module — the react-refresh/only-export-components rule forbids constant
  exports from component files).
- **Readiness & coverage layer (`src/lib/screenReadiness.ts`, pure,
  unit-tested — no store/LLM/persistence).** Computed at read time over the
  join layer: per-screen **gap detection** (`detectScreenGaps`: missing
  purpose / traceability / navigation / states, **invalid (stale) feature
  refs when a PRD feature list is supplied**, states without behavior, P0
  without mockup, **contract-recommended state variants without mockups**,
  risks without recorded handling, **flow decisions without parseable branch
  outcomes**, no flow refs) rolls into a
  per-screen **readiness status** (`deriveScreenReadiness` → draft /
  needs_review / accepted / implementation_ready).
  **Mockup variants are an optional enhancement, never a readiness
  requirement.** Synapse deliberately generates ONE primary
  implementation-quality mockup per screen (a missing P0 primary mockup is
  still `missing_mockup_p0`, review-triggering) and offers the extra viewport ×
  state variants on demand. So `OPTIONAL_ENHANCEMENT_GAPS`
  (`missing_state_variants`) is **excluded from status scoring**:
  `deriveScreenReadiness` scores off `gaps.filter(g => !OPTIONAL_ENHANCEMENT_GAPS.has(g.kind))`
  while still returning the full gap list (incl. the optional variant gap) so
  the detail view can surface it as an opportunity. A screen with every
  required asset is `implementation_ready` even when its optional variants are
  ungenerated. `missing_state_variants` is NOT in `REVIEW_TRIGGER_GAPS`. Never
  re-add variant gaps to readiness scoring — they are additive documentation.
  A **user-set status** —
  the optional `reviewStatus` field on the existing `ScreenMetadataEdit`
  overlay — always wins (`source: 'user'`) but never hides derived warnings
  (an `accepted_with_warnings` gap is appended); a derived status is always
  presented as estimated (`source: 'derived'`, `ReadinessBadge` renders an
  "est." suffix). `buildReadinessIndex(index, features?)` computes the
  variant/decision inputs itself. `buildScreenCoverageSummary` feeds the list
  panel — PRD-feature coverage estimated from `featureRefs` id tokens (plus
  `mustWithoutPrimaryScreen`: must-priority features only covered by P2/P3
  screens), a **recommended-state-variant rollup** (`stateVariants`, null for
  legacy specs), flow
  representation (requires the FULL parsed flows list, since the index only
  records matched flows), P0/mockup/state counts, open risks (riskDetails
  with a `proposedHandling` don't count), ready count,
  and one deterministic readiness sentence. Also here:
  `buildScreenTraceability` (featureRefs resolved against PRD `features`;
  **confidence `explicit` (every ref resolves) / `estimated` / `missing`** +
  `invalidRefIds` — "explicit" is still a generation-time claim, label it
  "mapped at generation", never "verified"), `deriveAcceptanceCriteria`
  (deterministic restatement of intent/exits/states/risks — capped, deduped,
  labeled derived), `buildScreenHandoff` (re-projection of existing fields
  only; route/accessibility have no data source and render "Not specified"),
  `buildMockupSpecCoverage` (token-overlap spec-to-spec comparison — present
  as "in the mockup spec", NEVER as visual detection of the image), and the
  list filters (`SCREEN_LIST_FILTERS`/`screenMatchesFilter`: All / P0 / Draft /
  Needs review / Accepted / Ready / Has blockers / Review recommended /
  Missing mockups / Has risks — `screenMatchesFilter` takes an optional
  `ScreenFilterReview` so the review-status/blocker filters key off the Phase 4A
  review model). **Honesty rule:
  everything derived is an estimate — keep the "estimated"/"derived" labels
  and "Not specified"/"Review recommended" fallbacks; never fabricate risk
  severity, mockup variants, routes, or per-state mockup coverage, and never
  present a derived status as user-confirmed.** All of it stays advisory —
  nothing gates rendering or generation. **A user override of
  `implementation_ready` over unresolved review-trigger gaps is counted in
  `summary.readyWithWarnings` and excluded from the "all screens pass"
  rollup** (`buildMessage` uses `ready − readyWithWarnings`; `ScreenCoveragePanel`
  gates its green all-clear on `readyWithWarnings === 0`) so a human override
  can never make the artifact-level summary read clean while warnings remain.
- **Phase 4A — screen review & approval workflow (`src/lib/screenReviewWorkflow.ts`,
  pure, unit-tested).** Turns the Screens artifact from a reference surface into a
  review workflow, layered ON TOP of the readiness/variant/trust layers (never
  changing them). It deliberately keeps **two distinct concepts** — do not
  collapse them: **(1) USER review status** — the human sign-off, persisted in the
  existing `ScreenMetadataEdit.reviewStatus` overlay
  (draft/needs_review/accepted/implementation_ready); and **(2) SYSTEM readiness**
  (`SystemReadinessStatus`: ready / needs_review / blocked) — Synapse's derived
  estimate from the issue set, never overridden by the buttons. A screen can be
  user-Accepted while system readiness says "review recommended", or user-Draft
  while the system says "ready to accept". `deriveScreenReviewIssues` reuses
  `detectScreenGaps` + `resolveAcceptanceCriteria`/`resolveScreenHandoff` +
  precomputed mockup/freshness signals to produce **`ScreenReviewIssue`s**
  (severity `blocking` | `review` | `info`, categorized) with a `recommendedAction`.
  Blocking = missing purpose, missing traceability/navigation on a **primary**
  (P0/P1) screen, P0 without a default mockup, a required state with no behavior,
  no derivable acceptance criteria, an unresolved high-severity risk on a P0
  screen. Review = stale mockups, unresolved risks,
  decisions without branch outcomes, thin handoff, stale
  PRD refs. Info = freshness/coverage unknown (legacy metadata — NEVER a
  blocker), no flow refs, **and the optional mockup-variant nudges (`mockup_mobile_missing`,
  `mockup_state_variants_missing`)** — additional viewport/state variants are
  generated on demand, so a missing one is `info` (discoverable) and must NEVER
  be `review`/`blocking` (that would let optional design coverage reduce a
  screen's system readiness). Only the P0 *primary* mockup gates. `buildScreenReviewModel`/`buildScreenReviewModelForItem`/
  `buildScreenReviewIndex` assemble the per-screen `ScreenReviewModel` (status +
  systemReadiness + issues + counts + `acceptedOverWarnings` + freshness +
  checklist progress); the views use the `-ForItem`/`-Index` wrappers (which build
  the variant grid), pure tests use the low-level fn with explicit signals.
  **Supporting review record** rides a NEW additive overlay field
  `ScreenMetadataEdit.review` (`ScreenReviewMeta` in `src/types`: checklist, note,
  override reason, sign-off `signature`, transition timestamps) — status stays in
  `reviewStatus`, so all existing wiring is untouched; `readScreenEdits` parses it
  defensively and preserves unknown keys. **Review freshness (re-review after
  acceptance):** `buildScreenReviewSignature` captures `computeScreenReviewHash`
  (a self-contained FNV-1a hash of the substantive spec — purpose/intent/priority/
  states/nav/UI/risks/criteria/traceability/handoff, **excluding the display-only
  `name` rename and overlay-only fields** so a pure rename never trips it) at
  accept/implementation-ready; `compareReviewFreshness` → `current` | `outdated` |
  `unknown` (**no stored signature = `unknown`, legacy records NEVER falsely
  outdated**, mirroring mockup freshness). **Artifact-level readiness gate:**
  `buildScreenArtifactReviewReadiness`/`summarizeArtifactReviewReadiness` roll the
  models up — **P0 screens are the gate**: ready iff every P0 screen is
  user-signed-off (accepted/implementation_ready) AND no P0 screen carries
  blocking issues. It is a **readiness signal, NOT a hard lock** — nothing gates
  rendering or generation. UI: `ScreenReviewPanel` (Screen Detail header — status
  line, Accept / Request changes / Mark ready-to-build actions with an inline
  override-reason capture when blockers exist, readiness-issue list, review
  checklist, a calm "review may be outdated" banner + Re-review), review status +
  issue counts on `ScreenListView` cards, and a "Review readiness" rollup + gate
  callout in `ScreenCoveragePanel`. Persistence flows through the existing
  `handleSaveScreenEdit` → `updateArtifactVersionMetadata` overlay path
  (timestamps/signatures stamped in `ScreenDetailView`, not the pure module).
  Language stays calm ("Review recommended", never "Invalid").
- **Phase 4B — downstream impact tracking + Screens preflight
  (`src/lib/screenDownstreamImpact.ts`, pure, unit-tested).** Layers ON TOP of
  the Phase 4A review layer (never changing it) to answer "an accepted screen
  changed — now what?". All **derived, never persisted** (a stale persisted
  verdict is worse than none). `buildScreenDownstreamImpact(input)` maps a
  screen's review signals to the downstream artifacts a change/blocker may have
  invalidated, one entry per **`DownstreamArtifactKind`** (mockups / data_model /
  implementation_plan / prompt_pack / user_flows / design_system / export),
  highest severity per kind (`blocking` | `review` | `info`). Conservative,
  explainable rules: (1) an **accepted/implementation-ready screen that changed
  after sign-off** (`reviewFreshness === 'outdated'` — from Phase 4A's
  `compareReviewFreshness`) → Mockups (review), Implementation Plan (review, or
  **blocking** when a P0 was already `implementation_ready`), Data Model (review,
  only when the screen carries data requirements — `outputData` / handoff
  data-deps), Prompt Pack (info); (2) a **P0 screen with blockers** → Implementation
  Plan **blocking**; (3) **stale mockup variants** (Phase 3C freshness, surfaced as
  the `mockup_freshness_stale` review issue) → Mockups review; (4) **unknown
  mockup freshness** (legacy metadata) → **info, never a blocker**. A draft/
  unsigned screen never produces the change-driven impacts.
  `screenDownstreamInputFromModel(item, model)` derives the input from the Phase 4A
  `ScreenReviewModel` (so the two layers can't drift). `buildScreensDownstreamImpactRollup`
  rolls per-screen impacts up to `overallStatus` **ready / review_recommended /
  not_ready** — **not_ready** iff the Phase 4A gate isn't ready OR any P0
  accepted/impl-ready screen is outdated OR any P0 has a blocking downstream
  impact; **review_recommended** for review-level impacts with a clean P0 gate;
  **ready** otherwise. `buildRecommendedNextActions` produces a prioritized list
  (P0 blockers → re-review outdated accepted P0 → accept remaining P0 → stale P0
  mockups → implementation plan → supporting screens → unknown legacy mockups),
  **capped to 5**. `buildScreensPreflight` assembles the implementation/export
  preflight (blocking / review / info / recommended next steps / export-snapshot
  caveats — e.g. the Phase 3D variant-image cross-device-sync gap).
  `analyzeScreensDownstream(index, reviewModels, artifactReview)` is the single
  entry point the workspace calls. **UI:** `ScreenDownstreamImpactSection`
  (Screen Detail, below the review panel — impacted-artifact list, or a calm
  "No downstream impact detected" / "cannot be fully confirmed for this older
  review" empty state), a compact `DownstreamChip` on `ScreenListView` cards
  (only when a blocking/review impact exists — info-only shows nothing), a
  **Downstream readiness** section in `ScreenCoveragePanel`, and a collapsible
  **`ScreenPreflightPanel`** ("Implementation preflight") above the screen list.
  Two new list filters — **Outdated review** (`reviewFreshness === 'outdated'`)
  and **Downstream review** (`downstreamReviewNeeded`) — extend
  `SCREEN_LIST_FILTERS` / `ScreenFilterReview` (the caller supplies the new
  signals; `screenReadiness.ts` must NOT import `screenDownstreamImpact` — that
  would cycle). **No export/finalization hook was added**: there is no
  Screens-specific export/share/finalize action today (the PRD Mark-as-Final /
  UpdateAssetsPlan flow is PRD-level, not per-artifact), so the local preflight
  panel is the Phase 4B decision surface — a safer choice than hooking into an
  unrelated flow. Everything stays **advisory** — nothing gates rendering or
  generation, and legacy artifacts (no review data) show no impact/blocker.
- **Phase 5A — implementation handoff packages + build-task bridge
  (`src/lib/screenImplementationHandoff.ts`, pure, unit-tested).** Layers ON TOP
  of the Phase 4A review + Phase 4B downstream layers (never changing them) to
  turn an accepted screen into a **developer-ready build contract**. All
  **derived, never persisted**. `buildScreenImplementationHandoff({item,
  reviewModel, variants, downstream?, features?})` produces a
  `ScreenImplementationHandoff`: **route** (explicit generated `handoff.route` →
  small keyword map → slugified title, tagged `explicit`/`derived`/`missing`),
  **components** (handoff `primaryComponents` → core UI regions → mockup UI
  elements → title, PascalCased), **state** (handoff `stateVariables` +
  per-non-default-state status vars), **events** (handoff `events` + exit-path +
  flow user-action handlers, `on…`-named), **data dependencies** (handoff
  data/api deps + `outputData`, keyword-classified entity/api/storage/…, with a
  "No linked data model entities found" review warning when empty — **there is no
  real Data Model trace; everything is estimated, never claimed as verified**),
  **mockup references** (variants holding a real image / accepted, with Phase 3C
  freshness + coverage), **acceptance criteria** (`resolveAcceptanceCriteria`),
  a **QA checklist** (rendering/interaction/state/data/accessibility/responsive/
  error_handling/acceptance, restated from the spec), and a small **build-task
  list** (route/component/state/data/mockup/qa/accessibility, each with a
  `priority` and a `source`). Individual derivers (`deriveHandoffRoute`/
  `…Components`/`…State`/`…Events`/`…DataDependencies`/`…QaChecklist`/
  `…BuildTasks`/`…Readiness`) are exported for pure testing. **Readiness**
  (`deriveHandoffReadiness` → `ready` | `review_recommended` | `blocked`):
  blocked on the clear cases (system-readiness blockers, unsigned/outdated/
  downstream-blocking P0, no acceptance criteria, no route/component guidance on
  a primary screen); review-recommended is the honest common state (accepted
  with review items, stale/unknown mockups, missing mobile, missing data trace,
  thin handoff); ready requires sign-off + no blockers + minimal guidance.
  `buildScreensHandoffRollup(handoffs, p0Ids)` rolls up ready/review/blocked
  **gated on P0**; `renderHandoffMarkdown` is the copy-to-clipboard export;
  `buildHandoffPreflightContribution` feeds the Phase 4B preflight via the
  structural `PreflightContribution` param on `buildScreensPreflight` /
  `analyzeScreensDownstream` (screenDownstreamImpact **never imports** the handoff
  module — that would cycle; the caller passes the contribution in). **UI:** a
  Screen Detail **Handoff tab** (`ScreenHandoffView` + a `handoff` value on
  `ScreenDetailTab`, URL-addressable via `?screenTab=handoff`) with a
  readiness-colored tab dot, compact sections, and a Copy-handoff action
  (clipboard → textarea fallback); a compact **handoff readiness chip** on
  `ScreenListView` cards; **Handoff ready / Handoff blocked** list filters
  (`SCREEN_LIST_FILTERS` + `ScreenFilterReview.handoffReadiness`); and an
  **Implementation handoff** rollup section in `ScreenCoveragePanel`. Everything
  stays **advisory** — nothing gates rendering or generation, and legacy/sparse
  screens degrade to "Not specified" / review warnings, never crash. **No
  Implementation Plan bridge was added in Phase 5A** (deliberately — the plan
  artifact is not mutated or coupled; a trace-backed plan bridge is deferred to
  Phase 5B) and no Screens-specific export/finalization hook was added (the local
  Handoff tab + copy action is the decision surface, mirroring Phase 4B).
- **Phase 5B — trace-backed Data Model + Implementation Plan bridge
  (`src/lib/screenArtifactTraceBridge.ts`, pure, unit-tested).** Layers ON TOP
  of the Phase 5A handoff (never changing it) to make the handoff trustworthy: a
  **READ-ONLY correlation** between a screen and the already-loaded **Data Model**
  and **Implementation Plan** artifacts. It never mutates, fetches, or regenerates
  a downstream artifact. `buildScreenArtifactTraceBridge(ctx, dataModel, plan)`
  produces a `ScreenArtifactTraceBridge`: per-entity **Data Model matches**
  (`ScreenDataModelMatch` — evidence order: shared PRD **feature ref** →
  `explicit`; a data-dependency/component **naming the entity** → `strong`;
  **field-name** overlap → strong/weak field matches; bare **token overlap** →
  `weak`; else dropped) and per-task **Implementation Plan matches**
  (`ScreenImplementationPlanMatch` — milestone **explicitly links the screen** or
  a task links a shared **feature id** → `explicit`; **route path** / exact
  **component name** / exact **screen title** in a task → `strong`; component/title
  **token overlap** → `weak`), each with a `TraceConfidence`
  (`explicit`/`strong`/`weak`/`estimated`/`missing`) and a plain-language reason.
  `overall.confidence` is the **weaker of the two present traces** (a chain is
  only as strong as its weakest link). **Honesty rules stand:** a token overlap is
  `weak`, never "confirmed"; a **missing artifact** (`null`) is an info note, never
  a review nag; a **present-but-unmatched** artifact is review-worthy, never a
  hard blocker. Content resolvers `resolveDataModelForTrace` / `resolvePlanForTrace`
  (pure) accept the structured JSON shapes AND markdown (the standard data_model
  storage format is markdown via `structuredArtifactToMarkdown`, so the resolver
  recovers each entity's `**Related Features:**` line so explicit shared-feature
  matches still fire; the plan resolver maps milestone deliverables into
  pseudo-tasks) so stored/legacy artifacts still correlate by
  feature/name/route/title. Plan matching also honors task-level
  `linkedArtifacts.mockups` (screen names) in addition to milestone
  `linkedArtifacts.screens`. **Absent vs. unmatched:** an ABSENT artifact
  (`null`) yields `missing` confidence with an "artifact not available" warning
  and is NEVER surfaced as a coverage gap — preflight review items and the
  rollup `p0PlanMissing` / `p0DataModelMissing` counts are warning-gated on the
  present-but-unmatched wording, so a new/partial project isn't flagged before
  the downstream artifact exists.
  - **Handoff integration** (`screenImplementationHandoff.ts`).
    `buildScreenImplementationHandoff` gained optional `dataModel` /
    `implementationPlan` inputs — **`undefined` (omitted) → no bridge (Phase 5A
    behavior, for legacy/test callers); `null` → artifact absent (info, no nag);
    content → correlate.** The workspace always passes both (resolved off the
    `data_model` / `implementation_plan` preferred versions). When present, the
    bridge **upgrades** each estimated `HandoffDataDependency` in place
    (`source: 'data_model_trace'` + `matchedEntity`/`matchedField`/`confidence` —
    never fabricates a match), exposes `implementationPlanReferences` and the full
    `traceBridge`, adds trace-review **readiness** signals
    (`dataModelTraceMissing` / `planBridgeMissing` (accepted P0 only) /
    `traceConfidenceWeakForP0` — all **review-recommended, never blocking**; they
    fire only when the relevant artifact was PRESENT), extends
    `renderHandoffMarkdown` with `## Trace Confidence` / `## Data Model Support` /
    `## Related Implementation Plan Items`, and folds trace guidance into
    `buildHandoffPreflightContribution`. `buildScreensHandoffRollup` gained a
    `ScreensTraceRollup` (strong/estimated/missing counts + P0 plan/data-model
    gaps; null when no screen carried a bridge).
  - **UI.** `ScreenHandoffView` renders a **Trace confidence** summary, **Data
    Model support** matches (entity + confidence + fields + reason, or a calm
    "No linked Data Model entities found" empty state), a **Related implementation
    plan items** section, per-dependency trace tags, and trace notes.
    `ScreenListView` cards carry a compact `TraceChip` (only on a real concern —
    "No plan match" / "Trace needs review", never on a strong trace);
    `ScreenCoveragePanel`'s handoff section shows the trace rollup. **No new list
    filters** were added (the filter bar is already crowded — chips + preflight
    carry the signal). Everything stays **advisory**; nothing gates rendering or
    generation, and screens with no downstream artifacts degrade to `missing`
    with an info note, never a crash. **No downstream artifact is mutated and no
    new export/finalization flow was added** — the Handoff tab + copy action is
    the decision surface (a full trace-aware export is a Phase 5C follow-up).
- **Phase 5C — trace-aware Screens handoff export + finalization preflight
  (`src/lib/screenHandoffExport.ts`, pure, unit-tested).** Layers ON TOP of the
  Phase 5A/5B handoffs + Phase 4B preflight (never changing them) to turn the
  trace-backed handoff into a practical, exportable implementation *package* —
  the Phase 5C follow-up the 5B note deferred. All **derived, never persisted**;
  it MUTATES no artifact and does NOT rewrite Synapse's global export system.
  `buildScreensHandoffExportPackage(input)` composes the already-derived pieces
  (per-screen `ScreenImplementationHandoff`s incl. their Phase 5B trace bridges,
  the Phase 4A review models, and the Phase 4B `ScreensPreflightModel` already
  folded with the handoff contribution) into a **schema-versioned**
  (`schemaVersion: 1`) `ScreensHandoffExportPackage`: `summary` (screen/P0/
  accepted/impl-ready/blocked/review counts + trace-confidence buckets + mockup
  generated/missing/stale/unknown counts), `preflight` (blocking/review/info/
  next-actions, verbatim from Phase 4B), per-screen projections
  (route/components/state/events/data deps — trace-tagged when upgraded to
  `data_model_trace` — acceptance/QA/build-tasks, mockup **references only**,
  trace matches + warnings, issues by severity), and a `manifest` (PRD / Screens
  / Data Model / Implementation Plan / Design System version ids + present
  artifacts + honesty `caveats`). **Export status** (`deriveScreensExportStatus`
  → `ready` | `review_recommended` | `not_ready`) is the **more conservative
  fold** of the Phase 4B preflight status and the Phase 5A/5B handoff-rollup
  status (mapping the rollup's `blocked` → `not_ready`) — so it can never
  contradict the preflight the user already sees, and an **absent Data Model /
  Implementation Plan artifact is a manifest caveat, never an automatic
  `not_ready`** (the Phase 5B rule holds: only a PRESENT-but-unmatched artifact
  is review-worthy). **Honesty rules stand:** correlation is label/token-based,
  not proof; **NO binary mockup image data is embedded** — only labels/freshness/
  coverage references travel (both renderers assert this); legacy unknown mockup
  freshness is a caveat, never a blocker; `SCREENS_HANDOFF_EXPORT_CAVEATS` (the
  standing honesty caveats) is always included so UI + markdown + JSON read the
  same. `renderScreensHandoffExportMarkdown` (copy/paste-ready — summary →
  preflight → manifest → per-screen sections incl. Data Model Support / Related
  Implementation Plan Items) and `renderScreensHandoffExportJson`
  (`JSON.stringify(pkg, null, 2)`) are the two export formats;
  `screensHandoffExportFilename` builds the download name. **UI:**
  `ScreensHandoffExportPanel` (`src/components/experience/`) — a local,
  collapsible panel rendered by `ScreenListView` directly below
  `ScreenPreflightPanel`: an export-readiness header + status banner (calm,
  **non-blocking** even when `not_ready` — it still exports, mirroring the
  Phase 4B "decision surface, never a gate" rule), summary stat tiles, Copy /
  Download for Markdown and JSON (clipboard → textarea fallback, Phase 5A
  pattern), and a "What's included & caveats" disclosure. `ArtifactWorkspace`
  supplies the memoized `exportManifest` (version ids + artifact presence) and
  `projectName`; the panel stamps `exportedAt` (via `new Date()`) at build time
  so the pure builder stays deterministic. Everything stays **advisory** —
  nothing gates rendering or generation; demo/keyless projects export the same
  (no key needed). **No server-side export storage, no persisted export state**
  (an optional "last exported" overlay was deliberately skipped — the package
  itself is enough and a stale exported-status is worse than none).
- **Phase 2 — source-grounded screen contracts.** New screen_inventory
  generations emit an explicit contract per screen (all fields optional &
  back-compat on `ScreenItem`/`ScreenState` in `src/types`): structured
  states (`type` (`ScreenStateType`), `systemBehavior`, `required`,
  `needsMockup`, per-state `acceptanceCriteria`), structured
  **`riskDetails`** (`severity` + `proposedHandling` — normalization derives
  the legacy `risks` string list from these when absent, so old consumers
  keep working; the schema no longer asks for plain `risks`), screen-level
  **`acceptanceCriteria`**, and a **`handoff`** spec (`ScreenHandoffSpec`:
  route/routeParams/primaryComponents/stateVariables/events/data+api
  dependencies/accessibility+responsive notes). The prompt instructs the
  model to omit fields the PRD doesn't support — the UI shows "Not
  specified", never invented detail. **Resolution order everywhere: user
  overlay → source contract fields → Phase 1 derived values → safe
  fallbacks** — `resolveAcceptanceCriteria` / `resolveScreenHandoff` return a
  `source: 'generated' | 'derived'` tag the UI must surface ("From generated
  spec" vs "Derived from this spec"). Round-trip lives in
  `screenInventoryNormalize.ts` (parse + `screenInventoryToMarkdown`) and the
  Gemini schema in `artifactSchemas.ts` — extend all three together (JSON
  mode can't emit properties absent from the schema). Legacy artifacts keep
  rendering through the Phase 1 derived layer — never require contract
  fields.
- **Per-state mockup variant tracking is metadata-based, never visual.**
  Two layers build on the same `mockupVariantStatus` overlay keys and must stay
  compatible:
  - **Readiness layer** — `buildMockupVariantRows(item, platform?)`
    (`screenReadiness.ts`) derives one row for the default view (status
    `generated` iff the screen joins a mockup screen) plus one per documented
    non-default state (`required` iff `state.needsMockup`); a default-`type`
    state folds into the default row. Rows carry a deterministic id
    (`default` / `state:<slug>`) — the overlay key for the user-set
    **`mockupVariantStatus`** map (`'accepted' | 'not_needed'`) on
    `ScreenMetadataEdit`. A missing **state** row (never the default row —
    that's `missing_mockup_p0`'s job, and counting it would downgrade legacy
    mockup-less P2/P3 screens) left `missing` while `required` produces the
    `missing_state_variants` gap; `accepted`/`not_needed` resolve it. **That gap
    is OPTIONAL (`OPTIONAL_ENHANCEMENT_GAPS`) — it is surfaced for discovery but
    excluded from readiness scoring, so it never downgrades a screen's status**
    (see the Readiness & coverage layer above).
  - **Phase 3A discovery layer (`src/lib/mockupVariants.ts`, pure,
    unit-tested)** — `buildScreenMockupVariants(item, {platform, mobileRelevant})`
    adds a **viewport dimension** (desktop / mobile / tablet) on top of states,
    for the Mockups-tab gallery + screen-card summary + coverage-panel rollup.
    A legacy single-image mockup normalizes to **`Desktop · Default`**
    (`source: 'legacy'`, `coverageStatus: 'unknown'` — no per-variant coverage
    metadata was ever captured). Recommendations are DERIVED estimates:
    `Desktop · Default` for every primary screen, `Mobile · Default` **only
    when the project is `mobileRelevant`** (mobile-first / responsive — then on
    every screen, P0 included), and important documented states. **A web/desktop
    project (`mobileRelevant` false) recommends NO Mobile variant — not even for
    its P0 screens** — so it never surfaces "mobile coverage" gaps for a
    platform that ships no mobile UI; `buildMockupVariantCoverageSummary` counts
    a P0 screen toward `p0Total` only when a Mobile default is actually
    recommended, so the "Mobile coverage (P0)" panel row stays hidden for
    non-mobile projects. Do **not** re-gate the Mobile recommendation on
    priority alone.
    **Overlay-key compatibility**: the primary-viewport Default reuses `default`
    and primary-viewport states reuse `state:<slug>` (shared with the readiness
    layer); only the secondary-viewport default introduces `${viewport}:default`.
    `summarizeScreenVariants` (per-screen card) and
    `buildMockupVariantCoverageSummary` (artifact rollup: recommended
    generated/total, **`additionalGenerated`/`additionalTotal`** — recommended
    variants EXCLUDING each screen's primary Default row, i.e. the optional
    "expanded coverage" pool the panel shows separately from required primary
    mockups — P0 mobile coverage, legacy-unknown count) drive the UI.
    This layer is **display/discovery only — it never changes review status.**
    The **Screen Coverage & Readiness panel (`ScreenCoveragePanel`) presents
    these variants as optional, NOT a checklist**: a green "Ready for
    Development" section lists the required implementation assets (PRD links,
    flows, primary mockups, states, open risks, ready count) with a progress
    bar, and a separate neutral "Expanded Design Coverage" section frames the
    additional variants positively ("N generated · M available on demand", an
    "Optional" bar, a discovery card pointing at the per-screen Mockups tab) —
    no warning color, no "recommended" ratio. Keep required vs. optional split;
    orange/amber is reserved for genuine implementation risk (uncovered PRD
    features, a P0 without its primary mockup, unhandled risks).
  - **Phase 3B single-variant generation (`src/lib/mockupVariantRequest.ts`
    pure + `src/lib/mockupVariantImageStore.ts` IDB +
    `src/store/mockupVariantImageStore.ts` Zustand +
    `src/components/experience/MockupVariantImage.tsx`)** — the Mockups tab can
    now GENERATE / regenerate / retry ONE specific non-default variant
    (`Mobile · Default`, `Desktop · Empty History`, …). The **default variant
    (`id === 'default'`) is deliberately left on the legacy `MockupScreenImage`
    path unchanged** (keys `versionId:screenId:quality`, coverage stays
    "unknown"); every OTHER variant uses a **dedicated, independent** per-variant
    IDB store keyed **`versionId:screenId:variantId:quality`** so generating one
    variant never overwrites another. `buildVariantGenerationRequest` assembles a
    variant-scoped request (viewport + state + core regions/actions/criteria/
    risks, derived only from existing screen-contract fields);
    `buildVariantImagePrompt` scopes the gpt-image-2 prompt to that exact viewport
    + state (forbids other states / a generic default; realistic mobile viewport;
    explicit empty/loading/error/permission/success guidance);
    `buildVariantCoverageManifest` captures a **generation-time coverage
    manifest** (`MockupCoverageManifest` in `src/types`) — a deterministic,
    structured self-report of what the render was ASKED to include (`estimated:
    true`), **never a visual inspection**. The manifest is stored WITH the variant
    image and threaded back into the derived model
    (`buildScreenMockupVariants`'s optional `generatedVariants` map →
    `source: 'variant'`, real `coverageStatus`), the screen cards, and the
    artifact rollup (`buildMockupVariantCoverageSummary`'s
    `generatedVariantsByScreen` → `manifestBackedGenerated`, counted separately
    from `legacyUnknownMockups`). **Honesty rules stand:** legacy mockups without
    a manifest stay "unknown"; UI copy says "Coverage manifest captured during
    generation … not a visual inspection", never "visually verified"; never show
    "covered" without structured metadata. Generation is gated on an OpenAI key
    (`hasOpenAIKey`) + `gpt_image` image mode — demo / keyless users see a
    disabled action with a clear explanation, never a silent failure. The
    per-variant store's image BYTES stay in its own dedicated IndexedDB store
    (never in `imageRefsStore` or the legacy mockup store); Phase 3D made the
    RECORDS portable through owner snapshots (see the Phase 3D bullet) but the
    variant store is still **not on the per-user `/api/projects` cross-device
    sync path** — do not entangle it with `imageRefsStore`.
  - **Phase 3C variant trust — freshness, history, default sidecar
    (`src/lib/mockupVariantTrust.ts`, pure).** A generated variant is captured
    with a **`MockupVariantSourceSignature`** — a deterministic snapshot of the
    inputs that materially affect its image: a **screen-contract hash**
    (`computeScreenContractHash`, keyed off the SAME screen-spec fields
    `buildVariantGenerationRequest` uses — viewport + state + core UI regions +
    user actions + acceptance criteria + risks; **excludes** overlay-only UI
    metadata like notes/reviewStatus/variant marks so cosmetic edits never trip a
    false stale warning) plus the **design-system tokens hash** and the
    **PRD/spine + screen-inventory + design-system version ids** at generation
    time. `buildVariantSourceSignature` (used at BOTH storage and comparison so
    they can't drift) is stored on `MockupVariantImageRecord.sourceSignature` +
    `generatedFrom`. `compareVariantFreshness(stored, current)` →
    **`current` | `possibly_stale` | `stale` | `unknown`**: contract-hash or
    design/PRD **hash** mismatch → `stale`; version-id changed but no hash to
    confirm → `possibly_stale`; **no stored signature → `unknown` (legacy /
    pre-3C records are NEVER falsely stale)**. Freshness is threaded into the
    derived model (`DerivedMockupVariant.freshness`) via a
    **`VariantTrustContext`** (current versions/hash) passed from
    `ArtifactWorkspace` → Screen views; a rollup
    (`summarizeVariantFreshness` → `MockupVariantCoverageSummary.freshness`
    `{current, review, unknown}`) feeds the coverage panel. UI: freshness badges
    + a calm explanation + a metadata-only **Source comparison** section (never a
    visual diff) in `MockupVariantsPanel`; a compact "Freshness: N to review"
    chip on screen cards.
    **Variant history:** the store's `generate` preserves the previous
    successful record as the newest **`history`** entry on regeneration (capped,
    newest-first); a **failed regeneration never appends history and never erases
    the current record**. Shown in a collapsible, local-only history section
    (view-only — no restore).
    **Default coverage sidecar:** the default variant KEEPS the legacy
    `MockupScreenImage` image path; on a NEW default (re)generation the panel
    captures a metadata-only sidecar record (`variantId: 'default'`, empty
    `dataUrl`, coverage manifest + source signature) keyed
    `versionId:screenId:default:quality` via `putSidecar` — wired through an
    optional `onGenerated` callback on the legacy image store/component (other
    callers unaffected). **Old defaults with no sidecar stay coverage-unknown; no
    fabricated coverage, and the legacy default image is never moved into the
    variant store.**
    **Storage clarity (updated by Phase 3D):** the Mockups tab and per-variant
    detail now state that generated variant images are saved on this device AND
    included in project snapshots (restorable on another device from a saved
    snapshot); they do not yet auto-sync across devices.
  - **Phase 3D — portable variant image snapshots
    (`src/lib/mockupVariantSnapshot.ts`, pure except the injected-IDB restore).**
    Generated variant images, coverage manifests, source signatures,
    `generatedFrom` provenance, and variant history now travel in owner
    **snapshots** (and therefore the demo) — closing the Phase 3C local-only
    gap. `buildMockupVariantImageSnapshot(records)` serializes the dedicated
    variant IDB store into a **schema-versioned** (`schemaVersion: 1`),
    size-guarded transport (`MockupVariantImageSnapshot`);
    `validateMockupVariantImageSnapshot` / `estimateMockupVariantSnapshotSize`
    are the pure guards. **Wire path reuses the existing per-image blob
    channel** (NO server change — `api/snapshots.js` hashes any key and persists
    `project` verbatim): `splitVariantSnapshotImages` moves image bytes out of
    the JSON envelope under `vimg:`-prefixed keys (never collide with
    mockup/screen keys) so nothing crosses Vercel's ~4.5 MB cap; the stripped
    metadata rides INSIDE `SnapshotProjectBundle.mockupVariantImages`;
    `joinVariantSnapshotImages` re-attaches bytes on load (a failed per-image
    fetch drops just that image, never the restore, and factors into the demo's
    `imagesComplete`). **Safety:** only `image/png|jpeg|webp` (never SVG);
    per-image cap 8 MB, total cap 50 MB, history cap 10 — oversized/unsafe
    records are skipped with calm warnings (surfaced in `SnapshotsPanel` after
    save). **Restore is CONSERVATIVE merge, not a clobber**
    (`restoreMockupVariantImageSnapshot` + pure `mergeVariantRecords`): per key —
    no local → restore; duplicate → keep one; snapshot newer → snapshot current,
    local folds to history; local newer → keep local, snapshot folds to history;
    inconclusive → keep local, snapshot to history + warning; an imageless
    incoming never replaces a successful local image; history dedupes by
    (image, generatedAt) and is capped. A malformed variant section is skipped
    without ever breaking the surrounding project restore. Restore updates the
    reactive cache via the new `useMockupVariantImageStore.mergeRecords`.
    **Non-default variants require a real safe image to restore** (they render
    an `<img>`); only the `variantId === 'default'` **sidecar** is metadata-only
    (no image — the legacy default image path is untouched, old defaults without
    a sidecar stay coverage-unknown). Demo restore under `DEMO_PROJECT_ID`
    namespaces variant records via `namespaceVariantSnapshot` (remap versionId +
    rebuild the composite key + `generatedFrom`, idempotent), invoked from
    `namespaceSnapshotForRestore`. Still **not** on the `/api/projects`
    cross-device sync path — that remains the documented next step.
  `parseDecisionBranches` (arrow-form +
  if/otherwise) powers both the branch-aware Flow-tab rendering
  (`DecisionBranches`) and the `decision_missing_branches` gap — an
  unparseable decision renders the raw text with an honest "branch outcomes
  not specified" nudge, never an invented branch.
- **Screen metadata edits are an overlay, never a content rewrite.** User
  edits (name / purpose / userIntent / priority / notes / **reviewStatus** —
  the readiness override above — / **mockupVariantStatus** — the per-variant
  override above) are stored per
  canonical screen id in the screen_inventory **ArtifactVersion's
  `metadata.screenEdits`** (`ScreenMetadataEdit` / `readScreenEdits` in
  `screenExperience.ts`, persisted via the existing
  `updateArtifactVersionMetadata` — the prompt_pack `promptEdits` pattern).
  **`readScreenEdits` preserves unknown overlay keys verbatim and every
  writer must merge from the existing edit** (the edit form spreads
  `item.edit` before setting its own fields; the variants card merges
  `mockupVariantStatus`) so a read-modify-write never drops fields written by
  newer code.
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
  generating/error states. **But the Screens row is fed by TWO slots** —
  `screen_inventory` (the screen "breakdown") and `mockup` — which settle at
  different times (the breakdown almost always lands well before the mockups).
  So the row's dot is **not** a plain `StatusDot` of `screen_inventory`: it uses
  `ScreensStatusDot(inventory, mockup)` (exported from `ArtifactWorkspace.tsx`,
  unit-tested), which shows the breakdown's raw status until the breakdown is
  `done`, then — while mockups are still `generating`/`queued` (or `error`/
  `interrupted`) — pairs the breakdown's green check with the mockups' live
  spinner/warning (plus a "Breakdown ready · mockups generating…" sub-label on
  the row and a matching tooltip) instead of a flat "done". Once mockups finish
  (or were never requested → `idle`) the check stands alone. Used in both the
  sidebar row and the mobile header. Do **not** revert the Screens dot to a bare
  `screen_inventory` `StatusDot` — that misled users into thinking mockups were
  ready when only the breakdown was. A screen_inventory version whose content isn't
  parseable structured JSON (legacy markdown) falls back to the standalone
  `ScreenInventoryRenderer` path inside the Screens view. The legacy
  `screen_inventory` and `mockup` renderMain branches remain intact and
  internally reachable — do not delete them.

### Artifact Dependency Graph (Project Map) — read-side integrity view

**Project Map → Dependency Graph** (`'dependency_graph'`, a
`WorkspaceSelection` like `'screens'`, NOT an artifact slot — no persisted
state) visualizes how artifacts derive from the PRD and each other, which are
stale and why, and the safe update order. See
`docs/ARTIFACT_DEPENDENCY_GRAPH.md`.

- **The map is derived, never hand-drawn.** `src/lib/artifactDependencyGraph.ts`
  (pure; no store/React/LLM imports; unit-tested) builds the graph from
  `CORE_ARTIFACT_PIPELINE` + `MOCKUP_DEPENDENCIES` (the latter now lives in
  `coreArtifactPipeline.ts`, shared with `artifactJobController`). Hidden
  subtypes collapse transitively; retired subtypes are excluded. To change the
  graph, change the pipeline constants — do **not** add edges in the graph
  module.
- **Provenance refs.** `runCoreArtifactSlot` records a `core_artifact`
  `SourceRef` for each `dependsOn` input actually available at generation time
  (mirrors what `runMockupSlot` always did). Legacy versions lack these refs —
  the evaluator falls back to a timestamp heuristic (advisory
  `update_recommended`, never hard `needs_update`). `sourceRefs` already
  travel in `ArtifactVersion` through persistence/sync/snapshots, so no
  schema change was involved.
- **Staleness is deterministic** (`evaluateDependencyGraph`): spine-ref drift
  and recorded dependency-ref drift → `needs_update`; the mockup
  design-tokensHash rule mirrors `stalenessSlice` (hash comparison beats
  version-id comparison — a token-identical regen keeps mockups current);
  missing/error/generating come from artifact presence + live job slots.
  Upstream trouble propagates downstream as `impactedBy` (blue "Impacted"
  pill). Keep this evaluator and `stalenessSlice` consistent if either rule
  set changes.
- **Actions reuse existing flows.** Single update → `retrySlot`; batch →
  `artifactJobController.regenerateSlots(slots, args)`, a thin wrapper over
  the existing `executeJob` (dependency-layer order, mockup last — no second
  pipeline). It no-ops while a run is active; the UI disables update buttons
  off live job state. `computeUpdateOrder`/`computeRecommendedUpdates` supply
  the topological order. **Hidden closure rule:** graph batches only name
  visible nodes, so `regenerateSlots` expands them via
  `expandWithHiddenDependencyClosure` (`coreArtifactPipeline.ts`) — a hidden
  subtype is pulled in when a requested slot consumes it and its inputs are
  also being regenerated (or it isn't done for the spine). Never pass a
  graph-derived batch to `executeJob` without this expansion, or the mockup
  can rebuild against a `component_inventory` generated from the old
  screen inventory.
- **Retry respects the dependency closure.** `retrySlot` no longer regenerates a
  slot against missing/errored/stale/needs_review upstreams. It calls the pure
  `planSlotRetry(slot, isHealthy)` (`coreArtifactPipeline.ts`), which walks the
  slot's dependency closure (including hidden deps like `component_inventory`)
  and, when a dependency is unhealthy (`isDependencyHealthy`: not done for the
  spine, or its preferred version carries `validationBlockers`), routes to
  `regenerateSlots([…unhealthy deps, slot])` so the upstreams regenerate first —
  reusing the same graph-driven `executeJob` path — instead of saving a
  downstream result built from invalid dependency state. Routes only when no run
  is active; an all-healthy plan falls through to the plain single-slot retry.
- **Workspace wiring rules.** The selection is excluded from the finalize
  auto-open candidates and renders no `StatusDot` (`slotStatusFor` returns a
  constant `'done'` for it). "Open artifact" routes `screen_inventory`/
  `mockup` into the Screens view since neither has its own sidebar row.

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

**Exports are version-aware.** `src/lib/exportManifest.ts` (pure) builds an
**export manifest** — per asset: version number, generated-from PRD version
label, and staleness at export time — rendered by `renderManifestMarkdown` into
the top of the full markdown bundle, a `manifest` field in the structured JSON,
and (via `HandoffInput.manifestMarkdown`) between the preamble and the PRD in
the agent handoff. When any exported asset is stale, `ExportModal` shows an
amber warning banner (same pattern as the cloud-at-risk banner) naming the
assets; exports are never blocked — the manifest keeps the document honest.
Keep the manifest in sync if export composition changes.

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
Phase 1 design and `docs/VERSIONING_V2_PLAN.md` for the change-awareness layer
(Phase A implemented).

**Change-aware staleness (`src/lib/spineChangeAnalysis.ts`, pure).** The "what
changed" layer behind every stale flag: `diffFeatures` (by stable `Feature.id`
— added/removed/renamed/changed), `summarizeSpineChange` (section diffs via
`versionDiff` + a deterministic one-line headline — never an LLM call),
`ARTIFACT_SECTION_AFFINITY`/`isLikelyUnaffected` (advisory "no changes in the
sections this asset chiefly derives from" — identity/safety sections sit in
every affinity set so the note only fires on genuinely narrow changes, and it
must NEVER suppress a hard `needs_update`), `findFeatureReferences`
(conservative removed-feature reference scan; whole-word, ≥4-char needles), and
`makeSpineChangeResolver` (memoized "since spine X vs latest" resolver).
`evaluateDependencyGraph` accepts an optional `spineChangeFor` input and
attaches a `changeSummary` to `prd_changed` reasons + a node-level
`likelyUnaffected` flag (only when the PRD change is the sole reason). Surfaced
in the graph detail panel ("What changed: …", removed-feature still-referenced
warnings), the `StalenessBadge` tooltip, and the artifact-header strip.
Everything is computed at read time from stored snapshots — nothing persisted.

**Provenance is complete.** Every version-creating path stamps
`provenance.changeSource`: `ai_generation` (initial settle in
`updateSpineStructuredPRD` when none exists; `createArtifactVersion` default
for v1), `ai_regeneration` (`regenerateSpine`; `createArtifactVersion` default
for v2+), `branch_merge` (`mergeBranch`), plus the existing `user_edit` /
`ai_section_retry` / `revert` and the new **`marked_current`**. User overlay
edits (screenEdits/promptEdits) pass `opts.historyDescription` through
`updateArtifactVersionMetadata` to record an `Edited` history event, and the
graph treats a non-empty overlay as manually-edited. New version-creating code
paths must stamp a changeSource.

**"Mark as up to date" (`artifactSlice.markArtifactCurrentForSpine`).** The
escape hatch for trivial PRD changes: appends a CLONED preferred version whose
`sourceRefs` are **rebased** — spine ref → the confirmed spine version AND
every `core_artifact` ref → that dependency's current preferred version
(refreshing a recorded design tokensHash `anchorInfo`). Rebasing only the spine
ref would leave the graph still reporting `dependency_changed`; never do a
partial rebase. Emits a `MarkedCurrent` history event. Exposed in the graph
detail panel and the artifact-header strip when stale.

**Re-finalize goes through the Update Assets plan.** When Mark-as-Final runs
and downstream assets already exist (and no generation job is active),
`ProjectWorkspace.finalizeAndGenerate` does NOT call `startAll` — it evaluates
the dependency graph against the spine being finalized and opens
`UpdateAssetsPlanModal` (`src/components/versions/`): a "what changed" header
(vs the assets' newest baseline PRD version) and a per-asset choice —
Regenerate / Mark up to date / Decide later — defaulted from
`computeRecommendedUpdates`. Confirm finalizes, applies mark-current FIRST
(healing confirmed upstreams), then regenerates the selection expanded via
`expandSelectionWithTroubledUpstreams` (a selected dependent must never rebuild
from a stale unselected visible input; marked-current upstreams count as
healed) through the existing `regenerateSlots` path. Cancel aborts the finalize
(spine stays non-final). First finalize / demo / job-active keep the direct
`startAll` path. Do not reintroduce a blind full regeneration on re-finalize.

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
  **Restricted projects retry under their original constraints:** the caller
  passes the spine's persisted `safetyReview`, and `regeneratePrdSection`
  re-appends the reconstructed restriction directive to the idea exactly as
  `generateStructuredPRD` does on a full run (the stored `promptText` is the
  raw idea, so without this the retry would silently drop the constraints).
  Pass `safetyReview` from any new retry call site.

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

**Incomplete-PRD generation gate** (`src/lib/artifactGenerationGate.ts`, pure).
A partial PRD (`generationMeta.failedSections` non-empty) must not silently
drive downstream artifact generation. `evaluateSpineGenerationGate(spine, opts)`
is the code-level guardrail (defense-in-depth alongside the UI, mirroring the
safety-blocked check): it returns `allowed:false` for a safety-blocked spine, a
spine with no `structuredPRD`, or an incomplete spine that is neither
acknowledged (`acknowledgeIncomplete`) nor already `isFinal` (the durable record
of acknowledgement, so resume/retry after reload still work). `startAll` /
`regenerateSlots` early-return when the gate disallows. On the finalize edge,
`ProjectWorkspace.handleToggleFinal` interposes an explicit "Generate assets from
an incomplete PRD?" confirmation before `markSpineFinal` + `startAll`; only
"Generate anyway" proceeds (passing `acknowledgeIncomplete`). Any artifact/mockup
version generated while `failedSections` is non-empty is stamped
`metadata.generatedFromIncompletePrd` + `incompletePrdSections` for provenance.

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

- **Token capture.** **Both** `callGemini` and `callGeminiStream` read Gemini's
  `usageMetadata` (the streaming path off the final SSE chunk) and surface it via
  an optional `JsonModeConfig.onUsage` callback (both still return the same
  `string` — no call site breaks). The PRD section worker threads it through
  `ModelProvider.generateText` → `makeJsonProvider` and emits it on the
  `section_completed` event. **New provider call sites that want token metrics
  must forward `onUsage`.** (The artifact-bundle `WorkflowRun` node observations
  in `artifactJobController` still don't record tokens even though the transport
  now reports them — wiring that through is the remaining TODO.)
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
