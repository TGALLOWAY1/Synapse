# Snapshots & the Demo Project

> Extracted from CLAUDE.md. Load-bearing rules for the owner snapshot system, the public demo, demo hydration/reset, and the demo capability boundary.

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

- **Demo hydration is route-owned.** The public demo route
  (`/p/<DEMO_PROJECT_ID>` in `App.tsx`'s `ProjectRoute`) wraps
  `ProjectWorkspace` in `DemoRouteGate` (`src/components/DemoRouteGate.tsx`),
  which runs `loadDemoProject()` — via the Strict-Mode-deduped single-flight
  wrapper `src/lib/demoRouteHydration.ts` — and mounts the workspace only
  after hydration reports the demo available (a loading state while restoring;
  an explicit error state with Retry / Return home on failure — never a silent
  redirect or the generic missing-project bounce). The gate waits for the auth
  session to settle first, because `applyProjectUser`'s namespace wipe would
  discard a demo restored mid-transition. The Login/Home demo buttons only
  NAVIGATE to the route — do **not** re-add `loadDemoProject()` calls to
  button handlers (that was the old, second initialization path that left
  direct links / bookmarks / refreshes / cleared-storage reloads broken). All
  cache/freshness policy stays inside `loadDemoProject()` (next bullet).
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

