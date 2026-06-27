# Audit — "Synapse projects disappearing / not showing on mobile or web"

Date: 2026-06-27
Scope: PRD-workspace project lifecycle — create → save → fetch → filter →
render — plus auth/ownership and the mobile/web split.

## TL;DR

The PRD workspace stores **all** project data in `localStorage`, namespaced
per signed-in user (`synapse-projects-storage::u:<userId>`). There is **no
server-side store for PRD projects** (only the recruiter portal uses MongoDB).
That single architectural fact, combined with two recent behavior changes
(auth enforcement + per-user namespacing, and removal of silent project
adoption), explains every reported symptom:

1. **Cross-device is impossible by design.** A project created on web lives in
   that browser's `localStorage` only. It will *never* appear on a phone (or a
   different browser, or after clearing site data). This is the dominant cause
   of "not showing on mobile or web."
2. **Namespacing stranded pre-existing projects.** When per-user namespacing
   shipped, projects created earlier (anonymously, under the base key
   `synapse-projects-storage`) stopped being shown. The one-time "import"
   banner only appears for a user who has **no** namespaced data yet — so any
   user who already created even one project under their account, or who
   dismissed the banner, has their old projects permanently stranded but not
   deleted.
3. **A transient session-fetch failure looks identical to "signed out."** If
   `/api/session` errors or the network blips, the client silently treats the
   user as logged out and renders the login page / an empty project list, even
   though the projects are safe in `localStorage`.

No code path **deletes** project data on load, on auth change, or on a failed
fetch — the projects are recoverable. The bugs are about *visibility* and
*which namespace is read*, not destruction.

---

## 1. Project persistence

- **Created:** `createProject` in `src/store/slices/projectSlice.ts`. Writes a
  `Project` + initial spine (`id: 'v1'`) + `Init` history event into the
  Zustand store. Returns `{ projectId, spineId }`.
- **Saved:** Zustand `persist` middleware (`src/store/projectStore.ts`) with a
  debounced `localStorage` writer (`src/store/storage.ts`). Key is resolved per
  user via `resolveProjectStorageName()` (`src/store/userScope.ts`).
- **Backend?** No. The PRD workspace never calls `api/`. MongoDB is only for the
  recruiter portal + snapshots. IndexedDB is not used. So projects are
  **browser-local and device-local**.
- **Silent save failures:** `safeSetItem` swallows write errors. A
  `QuotaExceededError` raises one sticky toast then silently drops all
  subsequent writes — so once storage fills, new work is not persisted (lost on
  refresh). Non-quota write errors are only `console.error`'d.
- **Required fields:** `Project` is minimal (`id`, `name`, `createdAt`). No
  field is required for listing beyond `id`/`createdAt`, so a malformed record
  is unlikely to hide a project. Low risk.
- **Overwrite/delete/replace-with-empty:** The dangerous spot is
  `applyProjectUser` (`src/store/projectUserSync.ts`): it calls
  `setState(emptyPersistedState())` then `rehydrate()`. This wipes **in-memory**
  state and reloads from the target namespace. Because the writer resolves the
  key at write time and the wipe happens *after* `setActiveProjectUser`, the
  empty state is written to the **new** namespace (immediately overwritten by
  rehydrate), never the old one — so it does not destroy the previous user's
  stored data. ✔️ Confirmed non-destructive. The one true data-loss edge: a
  debounced write still pending for user A is silently dropped if an auth switch
  enqueues a write for a different key before the 500 ms timer fires (the
  pending value/name/timer are all clobbered). Low severity, but real.

## 2. Project loading

- **Fetched on load:** there is no fetch. The store hydrates synchronously from
  `localStorage` at module init (active user = `null` → base key), then
  `authStore.refreshSession()` → `setUser` → `applyProjectUser(userId)` wipes
  and re-hydrates from the user's namespace.
- **Separate paths for dashboard/list/mobile/web?** No. Every surface
  (`HomePage`, `ProjectDrawer`, `ProjectWorkspace`) reads the same single store.
  There is **one** list path: `Object.values(projects)` in `ProjectDrawer`.
- **Gated by auth before user is loaded?** Yes — and correctly: `HomeRoute`/
  `RequireAuth` show a spinner while `loading`, and `applyProjectUser` runs
  synchronously inside `setUser` before `loading` flips to `false`. Since the
  debounced storage's `getItem` is synchronous, `rehydrate()` completes
  synchronously, so the namespace is correct by first render. No empty-render
  race on web. ✔️
- **Empty unauthenticated result overwriting the real list?** Not in storage
  (see §1). But **visually yes**: a failed/blank session resolves the user to
  `null`, swaps to the base namespace, and shows the login page — looking like
  the projects vanished.
- **Errors swallowed?** Yes. `fetchSession` returns whatever JSON it gets
  (including a 500's `{authenticated:false}`); `refreshSession`'s `catch`
  collapses every failure to `setUser(null)`. No distinction between "signed
  out" and "couldn't reach the server."

## 3. Auth & ownership

- Projects are keyed by `user.userId`. `userId` is **stable per
  `(authProvider, providerUserId)`** (`api/_lib/users.js`): email accounts get a
  UUID at signup; OAuth accounts reuse `existing?.userId` keyed on
  `(authProvider, providerUserId)`.
- **Sign-in method changes the userId.** The *same human* signing in with
  email vs GitHub vs LinkedIn gets **different** `userId`s → **different
  localStorage namespaces** → projects appear to vanish. (A cross-provider email
  collision throws `EmailInUseByOtherProviderError`, which blocks the second
  provider rather than linking — so accounts are never merged.)
- **RLS / access rules:** N/A — projects are client-only; there is no row-level
  server check because there are no server-side project rows.
- **Mobile and web share the auth source** (same `/api/session` cookie) — but
  **not** the project store (localStorage is per-device). Same identity, empty
  list on the other device.
- **Filtered out by id mismatch?** Not via a query (no query exists), but
  effectively yes via the **namespace key** when the userId differs.

## 4. Mobile vs web

- Same routes, same components, same store. No mobile-specific route, query, or
  cache key for the project list.
- `ProjectDrawer` is the only list and renders identically on both. No
  responsive rule hides cards.
- The divergence is purely **storage locality**: each device/browser has its own
  `localStorage`. There is no sync. This is the headline cross-device bug.

## 5. Filtering / sorting / status

- `ProjectDrawer` lists `Object.values(projects)` sorted by `createdAt` desc.
  **No status/archived/deleted/search filter, no pagination, no limit.** Nothing
  here hides projects. ✔️ Low risk. (`createdAt` is a numeric epoch, so date
  sorting is safe.)

## 6. Versioning / history

- Spines append-only; `getLatestSpine` reads `isLatest`. Projects are listed
  independent of spine state, so a project with no `isLatest` spine would still
  appear in the list (badge logic tolerates a missing spine). Reverting/editing
  appends versions and never deletes the project record. **No orphaning of the
  project record itself.** ✔️ Low risk.

## 7. Error handling / observability — gaps found

- No log line distinguishes the five empty/blocked states the task calls for.
- `ProjectDrawer` shows a single "No projects yet" regardless of cause (not
  signed in vs genuinely empty vs failed session).
- Auth failure is invisible to the user.

---

## Confirmed bugs & risks (ranked)

| # | Severity | Issue |
|---|----------|-------|
| **R8** | **Critical (confirmed bug, fixed)** | `applyProjectUser` queues a debounced persist write of the EMPTY wipe state to the target namespace, then `rehydrate()` loads the real data into memory **without persisting** (Zustand uses the raw setter during hydration). ~500ms later the queued empty write flushes and **overwrites the namespace's stored projects with `{}`** — so a returning user who signs in and doesn't immediately mutate the store loses their localStorage projects on the next refresh. Caught by a new regression test. |
| R1 | **Critical (by design)** | No server persistence → projects are device/browser-local; cannot appear across mobile/web or survive site-data clears. |
| R2 | **High** | Per-user namespacing stranded pre-existing (base-key) projects; the import offer is one-shot and disappears once the user has any namespaced data or dismisses it. |
| R3 | **High** | Different sign-in providers ⇒ different `userId` ⇒ different namespace ⇒ projects "disappear" when switching login method. |
| R4 | **Medium** | Transient `/api/session` failure is swallowed and rendered as "signed out" + empty list; no retry/error UI. |
| R5 | **Low** | Pending debounced write for user A can be dropped on a fast auth switch. |
| R6 | **Low** | Quota-exceeded silently stops all persistence after one toast. |
| R7 | **Low/UX** | Empty states don't distinguish loading / signed-out / empty / failed / filtered. |

**R8 is the most likely acute cause of "I suddenly don't see my projects anymore"**: it silently empties the signed-in user's namespace in the background. Combined with R2 (the recovery offer having already been dismissed/consumed), the projects then have no surviving copy in that namespace and no offer to recover them.

## Fixes implemented in this change

- **R8 (data-loss, the acute cause):** `applyProjectUser` now re-persists the
  freshly-rehydrated state immediately after `rehydrate()`, so the debounced
  empty-wipe write can never be the last queued write and can never clobber a
  namespace. Proven by `projectPersistence.test.ts`
  ("does NOT clobber a pre-existing namespace…").
- **R2 (recovery):** make the legacy-project offer resilient — it is now
  available whenever there are **unclaimed, undeclined** base-key projects, even
  if the user already has their own namespaced data, and the import **merges**
  (additive, never overwrites an existing id) so stranded projects can be
  recovered without losing current ones. (`userScope.ts`, `projectUserSync.ts`,
  `HomePage.tsx`.)
- **R4 (observability + UX):** `fetchSession` now throws on a non-OK response;
  `authStore` records an `authError` distinct from a clean sign-out and does not
  masquerade a server failure as logged-out. `HomeRoute` shows a "couldn't reach
  the server — Retry" panel.
- **R7:** `ProjectDrawer` differentiates "Sign in to see your projects" vs "No
  projects yet" and links to recovery.
- **Observability:** debug-gated lifecycle logging (`synapse-projects-debug`)
  around create / namespace switch / rehydrate counts / auth resolution.

## Deferred (see `tasks/TODO.md`)

- **R1/R3** require a real server-side project store keyed by a stable account
  id (so projects sync across devices and across sign-in methods). This is the
  only durable fix for the cross-device complaint and is out of scope for a
  safe, non-destructive change.
</content>
</invoke>
