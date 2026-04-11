# Architecture

Synapse is a fully client-side React SPA. There is no backend database — all
state lives in `localStorage`, and Gemini is called directly from the
browser with a user-supplied API key.

## Repository layout

```
synapse/
├── src/
│   ├── main.tsx                 React bootstrap
│   ├── App.tsx                  Router (3 routes: /, /about, /p/:projectId)
│   ├── components/              UI views, modals, cards, renderers
│   ├── lib/
│   │   ├── geminiClient.ts      Direct Gemini API client (sync + streaming)
│   │   ├── llmProvider.ts       Barrel re-exports for all services
│   │   ├── schemas/             Gemini JSON-mode schemas
│   │   └── services/            Bounded LLM services (see below)
│   ├── store/
│   │   ├── projectStore.ts      Zustand store factory + persist middleware
│   │   ├── storage.ts           Debounced localStorage adapter
│   │   ├── types.ts             ProjectState interface
│   │   └── slices/              One slice per domain
│   └── types/index.ts           Domain model type definitions
├── public/                      Static assets and screenshots
└── docs/                        This directory
```

## Runtime stack

| Layer | Choice | Notes |
|---|---|---|
| View | React 19 + TypeScript | Vite 7 dev server and build |
| Styling | Tailwind CSS 3 | `tailwind-merge` + `clsx` for conditional classes |
| State | Zustand 5 | `persist` middleware, debounced `localStorage` |
| Routing | React Router v7 | `/`, `/about`, `/p/:projectId` |
| LLM | Google Gemini 2.5 | Direct browser calls with user-supplied key |
| Hosting | Vercel | SPA rewrite only; no serverless functions |

## State layer

`src/store/projectStore.ts` composes a single Zustand store from six slices,
each focused on one domain:

| Slice | File | Owns |
|---|---|---|
| Projects | `slices/projectSlice.ts` | Project CRUD, stage navigation |
| Spines | `slices/spineSlice.ts` | `SpineVersion` history, `isLatest` / `isFinal` flags |
| Branches | `slices/branchSlice.ts` | Branch creation, messaging, merge |
| Artifacts | `slices/artifactSlice.ts` | Artifact + ArtifactVersion CRUD |
| Feedback | `slices/feedbackSlice.ts` | Feedback items from mockups |
| Staleness | `slices/stalenessSlice.ts` | Drift detection against current spine |

Persistence uses a custom debounced adapter (`storage.ts`) that batches
`localStorage` writes on a 500ms interval so typing into a branch doesn't
hit storage on every keystroke. An `onRehydrateStorage` hook migrates
legacy `devplan` / `prompts` stage names to `artifacts` when older projects
load.

## LLM layer

A single thin client (`src/lib/geminiClient.ts`) handles every Gemini
request — the rest of the LLM code is organized into **bounded services**,
one per generation concern:

| Service | File | Responsibility |
|---|---|---|
| PRD | `services/prdService.ts` | Prompt enhancement, structured PRD generation, PRD → markdown |
| Core artifacts | `services/coreArtifactService.ts` | 7 downstream artifact types, refinement |
| Mockups | `services/mockupService.ts` | Platform / fidelity / scope-aware mockup generation |
| Markup images | `services/markupImageService.ts` | JSON spec for SVG annotations |
| Branches | `services/branchService.ts` | In-branch replies, consolidation back into the spine |

`src/lib/llmProvider.ts` is a barrel re-export so existing imports from
`../lib/llmProvider` continue to work.

Three artifact types (`screen_inventory`, `data_model`,
`component_inventory`) request Gemini's JSON mode with explicit schemas in
`src/lib/schemas/artifactSchemas.ts`, then convert the structured response
to markdown for storage. The renderers in `src/components/renderers/` parse
that markdown back into card / table layouts.

## UI layer

`ProjectWorkspace.tsx` is the orchestrator for a single project. It reads
the current stage from the store and swaps between five stage views:

- `SelectableSpine.tsx` — the PRD canvas. Text selection spawns branches
- `MockupsView.tsx` — generate and diff mockup versions
- `ArtifactsView.tsx` — bundle / individual generation, refinement, validation
- `MarkupImageView.tsx` — SVG annotation artifacts
- `HistoryView.tsx` — chronological timeline of spine versions and artifact derivations

Cross-stage modals (`ConsolidationModal`, `ExportModal`, `SettingsModal`,
`FeedbackModal`) are mounted from the workspace shell.

## Data flow

```
  prompt ──┐
           ▼
    generateStructuredPRD()         ← prdService
           │
           ▼
       SpineVersion                 ← spineSlice
           │
       ┌───┴──── highlight ──► Branch ──► consolidateBranch() ──┐
       │                                                       │
       └───────────────── mark final ◄─────────────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
     generateMockup()  generateCoreArtifact()  generateMarkupImage()
           │                  │                  │
           ▼                  ▼                  ▼
     ArtifactVersion    ArtifactVersion    ArtifactVersion (SVG spec)
```

See [`artifact-flow.md`](./artifact-flow.md) for a file-by-file trace of one
end-to-end run.

## What's deliberately not here

- **No backend database.** Everything persists to `localStorage` — intentional
  for a single-user, zero-infra portfolio deployment.
- **No auth.** One browser, one workspace.
- **No serverless functions.** Gemini is called directly from the client
  with the user's own API key, stored in `localStorage` via `SettingsModal`.
