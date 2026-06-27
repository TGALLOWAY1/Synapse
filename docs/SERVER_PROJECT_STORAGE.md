# Server-side project storage

Synapse PRD projects were originally **100% client-side**: every project and all
of its derived state (spines, branches, artifacts, history, tasks, metrics)
lived only in the browser's `localStorage` via the Zustand `persist` middleware.
This document records the audit that motivated server-side storage, the
root-cause of "projects disappear when I switch devices", the server schema and
access-control model, and the local-first sync design.

## 1. Audit — how project state was persisted (local-only)

The project workspace store (`src/store/projectStore.ts`) is one Zustand store
composed of 10 slices and persisted to `localStorage` under a per-user
namespaced key (`synapse-projects-storage::u:<userId>`, see
`src/store/userScope.ts`). A "project" is **not** a single object — it is a set
of nine project-id-keyed collections that together make up everything the
workspace shows:

| Collection         | Shape                              | Holds |
| ------------------ | ---------------------------------- | ----- |
| `projects`         | `Record<id, Project>`              | title, stage, platform, product metadata |
| `spineVersions`    | `Record<id, SpineVersion[]>`       | the PRD itself (prompt, structured PRD, versions, safety review, preflight) |
| `historyEvents`    | `Record<id, HistoryEvent[]>`       | the change timeline |
| `branches`         | `Record<id, Branch[]>`             | refinement branches + messages |
| `artifacts`        | `Record<id, Artifact[]>`           | generated artifact slots |
| `artifactVersions` | `Record<id, ArtifactVersion[]>`    | artifact content + version history |
| `feedbackItems`    | `Record<id, FeedbackItem[]>`       | feedback / staleness |
| `tasks`            | `Record<id, ProjectTask[]>`        | implementation checklist |
| `workflowRuns`     | `Record<id, WorkflowRun[]>`        | orchestration metrics |

The persist layer (`src/store/storage.ts`) is a debounced `localStorage`
adapter; the active key is resolved per-user by `resolveProjectStorageName()`.
The transient slices (`jobs`, `prdProgress`, `prdSectionStatus`) are stripped
from persistence by `partialize`.

### Root cause — why projects were device-specific

`localStorage` is **origin + device + browser-profile scoped**. It never syncs.
When a user created a project on desktop, all nine collections were written to
that desktop browser's `localStorage` and **nowhere else**. Opening Synapse on a
phone — or a second browser, or after clearing site data — rehydrated the store
from an *empty* `localStorage` for that origin, so the project list came back
empty. The data was never lost; it simply lived on exactly one machine. The
per-user namespacing made isolation correct *within* a browser but did nothing
to move data *between* browsers. There was no server record of a project, so
nothing could repopulate a fresh device.

This is the disappearance the user reported: "projects are unavailable when
switching devices/browsers."

## 2. Design — local-first with server sync

We keep `localStorage` as the live, offline-capable cache (it backs the Zustand
store and every existing read path is unchanged) and add a **server source of
truth** that the client syncs to. This preserves the existing
client-side-streaming architecture (Gemini still runs in the browser) while
making projects durable and cross-device.

- **Pull on auth.** When a user signs in / the session resolves, the client
  fetches that user's server projects and merges them into the local store
  (additively — local edits are never silently dropped).
- **Push on change.** Local project mutations are debounced and pushed to the
  server as a whole *bundle* (all nine collections for that project).
- **Import on first run.** Pre-existing local-only projects are detected and the
  user is offered a one-click upload into their server account, with migration
  markers so the same local project is never imported twice.

The serialization boundary is a **ProjectBundle** (`src/lib/projectBundle.ts`):
`extractProjectBundle(state, projectId)` pulls the nine slices for one project,
`applyProjectBundles(bundles)` merges server bundles back into the store.

## 3. Server schema (`api/_lib/projectsStore.js`)

One MongoDB document per project in the `projects` collection. The project's
client UUID is the document's stable primary key (`id`) — reused across devices,
which makes upserts idempotent and prevents duplicate imports.

```
{
  id: string,            // client-generated UUID — stable primary key
  userId: string,        // owner (from the verified session, never the client body)
  title: string,         // denormalized project.name (for list views / search)
  idea: string,          // denormalized originating prompt (latest spine)
  status: 'active' | 'archived',
  archived: boolean,     // mirror of status for simple filters
  deletedAt: Date | null, // soft-delete tombstone (restorable)
  createdAt: Date,
  updatedAt: Date,
  revision: number,      // monotonic; bumped on every write (sync/debug aid)
  data: ProjectBundle,   // the nine project-keyed collections, verbatim
}
```

`title` / `idea` / `status` / `archived` are **denormalized** from inside the
bundle purely so list queries and indexes don't have to crack open `data`.

### Indexes

Created idempotently by `ensureProjectIndexes()` (cached per warm serverless
instance), via the new `createIndexes` action in `api/_lib/db.js`:

- `{ userId: 1, id: 1 }` **unique** — owner-scoped primary lookup; also enforces
  one row per (user, project).
- `{ userId: 1, updatedAt: -1 }` — the default "my projects, newest first" list.
- `{ userId: 1, status: 1 }` — active/archived filters.
- `{ userId: 1, deletedAt: 1 }` — exclude/restore soft-deleted rows.

## 4. Access control (RLS-equivalent)

MongoDB has no Postgres-style row-level security. The equivalent guarantee is
enforced in two layers:

1. **Identity comes only from the verified session.** Every `/api/projects`
   route resolves the user via `requireUser(req, res)` (signed session cookie) —
   never a client-supplied id. This is the same chokepoint the rest of the
   private API uses.
2. **Every data-layer query is owner-scoped.** Every function in
   `projectsStore.js` takes `userId` as its first argument and includes
   `{ userId }` in the Mongo filter. There is no code path that reads or writes a
   project without the owner's id in the filter, so User A's query can never
   match User B's row. The unique `{ userId, id }` index makes this the natural
   key. No public/shared access exists — that is explicitly deferred (see
   `tasks/TODO.md`).

## 5. API (`api/projects.js`)

Session-gated, rate-limited CRUD. All bodies are JSON; identity is the cookie.

| Method & query                       | Action |
| ------------------------------------ | ------ |
| `GET /api/projects`                  | List the user's project summaries (no heavy `data`); `?includeArchived=1`, `?includeDeleted=1` |
| `GET /api/projects?id=<id>`          | Fetch one full project (bundle included) |
| `PUT /api/projects?id=<id>`          | Create-or-update (upsert) a project from a bundle — covers PRD updates and artifact saves |
| `POST /api/projects?action=import`   | Bulk import an array of bundles (idempotent on id) |
| `DELETE /api/projects?id=<id>`       | Soft-delete (archive tombstone) by default; `&hard=1` to remove permanently |
| `POST /api/projects?action=restore&id=<id>` | Restore a soft-deleted project |
| `POST /api/projects?action=archive&id=<id>` / `&action=unarchive` | Toggle archive status |

## 6. Migration safety

- Local projects are **never deleted on import** — they remain in `localStorage`
  as the offline cache.
- Import is **idempotent**: the project's stable UUID is the server primary key,
  so re-importing the same local project updates rather than duplicates. A local
  migration marker (`synapse-projects-server-migrated::u:<userId>`) records which
  local project ids have been pushed so the import banner doesn't re-offer them.
- All sync/import failures are **non-fatal and logged** (`projectsDebug`) — a
  failed save leaves the local copy intact and surfaces a "Sync failed" state
  rather than throwing away work.

See `tasks/TODO.md` for deferred work (offline write queue, conflict resolution,
shared workspaces, public project links).
