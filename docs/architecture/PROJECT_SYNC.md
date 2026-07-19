# Server-Side Project Storage & Cross-Device Image Sync

> Extracted from CLAUDE.md. Rules for the local-first project sync layer (`/api/projects`), conflict handling, and the mockup image Blob ref sync. Full design: docs/SERVER_PROJECT_STORAGE.md.

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
  `userScope.ts`'s per-user namespacing) recording, **separately from
  user-authored project content**, each project's
  `lastSeenServerRevision`/`lastSeenServerUpdatedAt`
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
  local, re-baselined so the conditional push wins). The module-local
  `recordSyncState(userId, projectId, { meta?, ui? })` helper writes the durable
  meta (`setProjectSyncMeta`) and the reactive per-project UI info
  (`patchProjectSync`) together at the sites that update both. `suspendPush`
  silences the echo while applying pulled/overwritten bundles. The read-only
  demo project
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
- **Upload state derives from durable sync meta — no separate marker store.**
  There is no `projectMigration.ts` marker set anymore; the server upsert is
  idempotent on the stable project UUID, so re-uploading is inherently
  harmless and **`reconcile` pushes every local-only project unconditionally**.
  The "N local projects uploaded" UI count (`migratedCount` → `markPulled` →
  `SyncStatusBanner`) is derived from `projectSyncMeta`: a project is "already
  uploaded" when its `getProjectSyncMeta(userId, id)` has `lastCloudSavedAt`
  or `lastSeenServerRevision` set (`isProjectUploaded` in `projectServerSync.ts`),
  checked BEFORE the push so only newly-uploaded projects increment the count.
  **Local projects are never deleted on import.** This is distinct from the
  anonymous→account *legacy* import (`userScope.ts`); after a legacy import,
  `HomePage` triggers a server reconcile so the newly-claimed projects upload
  to the account.

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
  writes IDB directly and would otherwise never trigger a push). The **server
  refs are the single source of truth for "already uploaded"** (there is no
  local uploaded-marker store): it fetches the project's refs, diffs local image
  keys against them (`computeImagesToUpload` in `src/lib/imageSyncDiff.ts`),
  uploads the missing ones, and persists a ref for each. **If the refs fetch
  fails (offline / transient) the push round is DEFERRED — it returns early and
  retries on the next push — never uploading blind.** Content-addressed blobs
  (sha256 path, `allowOverwrite`) make any redundant re-upload harmless. **Image
  sync NEVER blocks text sync** and every failure is non-fatal (a failed image
  is retried next push); a failed image never reverts local data.
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

