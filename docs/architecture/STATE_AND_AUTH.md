# Store, Persistence, Auth & Provider Keys

> Extracted from CLAUDE.md. The Zustand store slices, concurrency + selector-stability rules, persistence/quota handling, per-user namespacing, account linking, and the encrypted provider-key vault. Full auth design: docs/AUTH_AND_PROVIDER_KEYS.md.

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

