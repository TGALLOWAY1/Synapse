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

- **Save-time mockup-image audit (`src/lib/snapshotImageAudit.ts`, pure).**
  Mockup SPECS (the `mockup` artifact version JSON) and mockup IMAGES (IDB blobs
  shipped one-per-request) are collected independently, so nothing forces them to
  agree — it was possible to save, then pin as the public demo, a snapshot whose
  mockup spec listed screens but carried **zero** images (images generated in
  another browser, IDB cleared, or only the spec regenerated), and the demo then
  rendered mockup specs with no previews (the mockups "disappeared"). This is the
  root cause of the "demo lost its mockups" bug: the pinned demo blob genuinely
  had `imageCount: 0`. `auditMockupImageCoverage` runs inside `saveSnapshot` and,
  when the mockup version has ≥1 screen but no mockup image (AI / uploaded /
  variant) was collected for that version id, returns a warning surfaced through
  the existing `onWarnings` → `SnapshotsPanel` amber notice. **Saving is still
  never blocked** (specs are worth keeping) — the save-time audit only makes the
  gap visible. `snapshotImageAudit.ts` also exports the pure
  **`countMockupSpecScreens(artifacts, artifactVersions)`** (preferred mockup
  version → `{ versionId, screenCount }`, incl. the `extraScreens` overlay;
  `auditMockupImageCoverage` reuses it) — the shared "how many mockup screens
  does this snapshot claim?" number the pin-time gate keys off. A snapshot with
  no images is a data condition the owner must fix by regenerating the mockup
  images and re-saving/re-pinning; no restore/render change can recover images
  the blob never contained.

- **Pin-time completeness gate (SYN-003) — a HARD BLOCK, unlike the save-time
  audit.** Pinning a snapshot as the public demo is where a zero-image mockup
  spec does real damage (the demo claims "Generated" screens it can't show), so
  the pin is gated, not merely warned. `saveSnapshot` records
  `manifest.mockupScreenCount` (from `countMockupSpecScreens`) and
  `manifest.variantImageCount` (both optional on the wire — legacy manifests lack
  them; the client gate covers those). **Client hard block**
  (`SnapshotsPanel.handleSetDemo`, no override — pre-launch, the owner's recourse
  is regenerate + re-save): when `mockupScreenCount > 0` and total images
  (`imageCount + screenImageCount + variantImageCount`) is 0, it shows an
  actionable error and does NOT call `setDemoSnapshot`; a **legacy** summary (no
  `mockupScreenCount`) with zero images also blocks, asking for a re-save with
  the current app version; `mockupScreenCount === 0` (a legitimate PRD-only demo)
  pins cleanly; the unpin path is never gated. **Server backstop**
  (`api/snapshots.js` `handlePutDemo`): it counts the snapshot's per-image blobs
  (keys under `.../images/`) and, when that count is 0 and the manifest's
  `mockupScreenCount > 0`, rejects **422 `demo_snapshot_incomplete`** (a readable
  message surfaced through the client `setDemoSnapshot` error path); legacy
  manifests without the field pass (client gate covers them).

- **The public demo has one read-only capability boundary.**
  `src/lib/projectCapabilities.ts` is authoritative for durable project actions;
  `getProjectCapabilities` fails conservatively for a missing project and denies
  project/spine edits, finality, artifact/version/metadata changes, reviews,
  generation, design-system changes, persisted workflow/task state, and external
  task exports for `DEMO_PROJECT_ID`. Persisted Zustand slice actions, artifact
  generation controllers, and IndexedDB image writers assert the relevant
  capability before doing work. React surfaces consume
  `useProjectCapabilities` to hide mutation-only controls; the demo's pipeline
  stage is component state so PRD / Assets / History navigation remains
  explorable without persisting `currentStage`. Do not add raw demo-id mutation
  checks or a second demo store/workspace—extend the capability categories when
  a new durable mutation domain is introduced. Local copy/download exports that
  do not mutate project state remain available.

- **Reset Demo (SYN-001) — a deterministic "restore to pinned snapshot",
  route/store-owned like `loadDemoProject` itself.** `projectSlice.resetDemoProject()`
  deliberately bypasses the read-only capability guards above rather than
  extending them (this is a session/route-level concern, not a durable project
  mutation): it wipes all nine project-keyed store maps plus the transient
  `jobs`/`prdProgress`/`prdSectionStatus` slices for `DEMO_PROJECT_ID`, deletes
  every mockup/screen-inventory/variant IDB image record for the demo's
  artifact version ids (`deleteImagesForVersion` / `deleteScreenImagesForArtifactVersion`
  / `deleteVariantImagesForVersion`, each best-effort/try-caught so one failed
  delete can't abort the reset), and explicitly clears the matching reactive
  Zustand caches (`clearVersions` on all three of `mockupImageStore` /
  `screenInventoryImageStore` / `mockupVariantImageStore`) — required because
  `restoreSnapshotAs` never proactively evicts those caches itself (the mockup/
  screen-inventory caches only self-heal lazily via `loadForVersion`, and the
  variant cache's `mergeRecords` only ever adds/updates keys, never removes a
  stale one), so without this a demo reset could leave a corrupted record
  visible in memory even after IndexedDB was wiped. Deleting
  `projects[DEMO_PROJECT_ID]` drops the `demoSourceSnapshotId` stamp, so the
  action's final step — calling `loadDemoProject()` — can never cache-short-circuit;
  it always performs a full re-fetch + restore. `src/lib/demoRouteHydration.ts`'s
  `resetDemoProjectSingleFlight()` shares the module's `inFlight` slot with
  `hydrateDemoProject()` so a reset can't race a concurrent hydration pass:
  it waits out any in-flight hydration first, then registers its own promise
  as the new `inFlight` slot. UI: a "Reset demo" control with an inline
  confirm on `DemoReadOnlyNotice`, and a "Reset & reload demo" action on
  `DemoRouteGate`'s failed state (alongside Retry / Return home).

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
  snapshot. `loadDemoProject` restores an incomplete payload but **skips
  stamping `demoSourceSnapshotId`**, so the next open re-fetches and self-heals.
  This is the fix for "mobile shows the demo without its screen-inventory
  images": one failed image fetch used to reject the entire fresh snapshot and
  silently fall back to the stale cached demo.
  **Stamp = known-complete; the freshness precedence keys off it (SYN-003).**
  Because `demoSourceSnapshotId` is written **only** when the restore was NOT
  image-incomplete, a *stamped* cache is provably a full restore. So the
  precedence is: a **stamped (known-complete) cache beats a fresh-but-partial
  fetch** — when the pointer changed but the fresh fetch returns
  `imagesComplete: false` AND a stamped cache exists, `loadDemoProject` keeps
  serving the complete cache and does NOT overwrite it (the now-stale stamp vs.
  the live pointer already drives a re-fetch / self-heal on the next open).
  **Fresh-partial still beats no cache or an un-stamped cache** (a partial demo
  is better than an empty one), and it still leaves the stamp off so it heals.
  Do NOT restore a partial fetch over a stamped cache.
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

