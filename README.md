# Synapse

**Turn a brain-dump into a versioned PRD, UI mockups, and developer-ready artifacts — all from one prompt.**

<img width="100%" alt="Synapse Workspace Preview" src="public/screenshots/prd-view.png" />

<!-- TODO: Replace the static screenshot above with a short demo GIF showing: prompt → PRD generation → highlight-to-branch → mockups → artifacts. -->

---

## Why this project exists

PRDs are usually static Google Docs that go stale the moment engineering starts. Designers re-describe the same flows in Figma, engineers re-derive schemas in Notion, and feedback from mockup reviews rarely makes it back to the spec. Synapse collapses that loop: the PRD is the source of truth, and everything downstream (mockups, schemas, roadmaps, annotations) is generated and kept in sync from it.

## What it does

- Generates a structured PRD from a single prompt.
- Lets you **highlight any sentence** in the PRD to spawn a focused AI branch, then consolidates the decision back into a new spine version.
- Generates multi-fidelity UI mockups (wireframe / mid-fi / high-fi) and compares versions side-by-side.
- Derives 7 developer-ready artifacts from the PRD: screen inventory, user flows, component library, design system, data models, implementation roadmap, and prompt packs.
- Surfaces mockup feedback back into the PRD as actionable "apply" cards.
- Produces SVG markup images (critique boards, flow annotations, wireframe callouts) from PRD context.
- Tracks the whole evolution on a chronological history timeline.

## Why it is technically interesting

- **Two LLM call modes** — `callGemini()` for structured JSON responses (using Gemini's `responseMimeType: "application/json"` + `responseSchema`) and `callGeminiStream()` for streaming SSE output. Three artifact types use strict JSON-mode schemas and are then rendered back as typed card grids and entity tables.
- **Parallel artifact generation** — "Generate All" fires 7 concurrent LLM calls and streams per-card status (spinner → checkmark / red X), cutting bundle generation from ~21s to ~3–5s.
- **Spine versioning with branching** — PRDs evolve through `SpineVersion` records with `isLatest`/`isFinal` flags; highlighted text forks a `Branch` that runs its own AI conversation and merges back via `consolidateBranch()`.
- **Staleness tracking** — Every artifact stores source refs against the spine, so edits upstream visually flag downstream artifacts as stale and allow selective refresh.
- **Fully client-side** — No backend DB. All state (projects, versions, branches, artifacts, history) lives in a single Zustand store persisted to `localStorage` with debounced writes. Gemini is called directly from the browser.

## Architecture overview

```
User prompt
    │
    ▼
generateStructuredPRD()  ──►  SpineVersion (v1, v2, v3…)
    │                              │
    │                              ├─► Branches  ──► consolidateBranch() ──► new SpineVersion
    │                              │
    │                              ├─► Mockups   (platform × fidelity × scope)
    │                              │       └─► Feedback extraction ──► PRD branches
    │                              │
    │                              ├─► 7 Core Artifacts (parallel bundle gen)
    │                              │       └─► Refinement / validation / staleness
    │                              │
    │                              └─► Markup Images (SVG annotations)
    │
    └─► HistoryView (chronological timeline of all of the above)
```

Two files carry most of the weight:

- `src/lib/llmProvider.ts` (~950 lines) — every LLM call in the app, streaming + JSON modes, schemas for structured artifacts, markup image generation, branch consolidation.
- `src/store/projectStore.ts` (~820 lines) — single Zustand store for Projects, SpineVersions, Branches, Artifacts, ArtifactVersions, FeedbackItems, HistoryEvents, plus legacy-data migration.

See `ARCHITECTURE.md` for a deeper dive.

### Tech stack

React 19 · TypeScript · Vite 7 · Tailwind CSS 3 · Zustand 5 (persist middleware) · React Router v7 · Google Gemini API · React Markdown + Remark GFM · Lucide icons

## Key features

- **Intelligent PRD canvas** — prompt → structured spec with priorities, acceptance criteria, non-functional requirements.
- **Highlight-to-branch** — select any text to open an isolated AI thread, then consolidate locally or doc-wide.
- **Multi-fidelity mockups** — mobile/desktop × wireframe/mid-fi/high-fi × single-screen/workflow, with A/B diff viewer.
- **7 downstream artifacts** — screen inventory, user flows, component library, design system, data models, roadmap, prompt packs.
- **Type-specific renderers** — structured artifacts render as card grids, entity tables, and categorized components — not raw markdown.
- **Artifact refinement** — tweak an artifact with a natural-language instruction instead of regenerating from scratch.
- **Staleness detection** — visual warnings when the PRD has moved on beneath an artifact.
- **Markup images** — SVG annotation boards (critique, wireframe callouts, flow annotations) generated from PRD context, exportable as SVG.
- **History timeline** — chronological view of every spine version, branch, mockup, and artifact event.
- **Export** — markdown and structured JSON for the PRD, individual artifacts, or the full bundle.

## Demo / live link

<!-- TODO: Add the Vercel deployment URL here, e.g. https://synapse-prd.vercel.app -->

## Local setup

```bash
git clone https://github.com/tgalloway1/synapse.git
cd synapse
npm install
npm run dev
```

Then open `http://localhost:5173`, click the Settings gear in the top-right, and paste a Gemini API key.

Get a free key at [Google AI Studio](https://aistudio.google.com/apikey).

### Other commands

```bash
npm run build       # tsc -b && vite build
npm run lint        # ESLint (flat config)
npm run preview     # preview the production build
npx tsc --noEmit    # type-check without emitting
```

No test script is wired up yet (Vitest and Playwright are installed but there are no test files).

## Environment variables

Synapse runs entirely in the browser and does **not** use `.env` files for the Gemini key. The key is entered via the in-app Settings panel and stored in `localStorage`.

| Where | Name | Purpose |
|---|---|---|
| Browser `localStorage` | `synapse-gemini-api-key` | Google Gemini API key, set via the Settings gear in the UI |

The `api/` directory contains three Vercel serverless functions (`generate-prd.ts`, `generate-milestones.ts`, `generate-agent-prompts.ts`) that are **legacy / unused** — the client calls Gemini directly.

## Deployment overview

- Deployed to **Vercel** as an SPA.
- `vercel.json` rewrites everything under `/api/*` to the (unused) serverless functions and all other routes to `index.html`.
- Build command: `npm run build` → output in `dist/`.
- Because state lives in the user's browser, there is no database to provision and no backend key management — each user brings their own Gemini key.

## Screenshots

### PRD canvas with highlight-to-branch
<img width="100%" alt="Synapse PRD view" src="public/screenshots/prd-view.png" />

### Mockup A/B comparison
<img width="100%" alt="Mockups comparison view" src="public/screenshots/mockups-compare.png" />

### Feedback surfaced back into the PRD
<img width="100%" alt="PRD feedback" src="public/screenshots/prd-feedback.png" />

### Downstream artifacts
<img width="100%" alt="Artifacts view" src="public/screenshots/artifacts-view.png" />

### History timeline
<img width="100%" alt="History view" src="public/screenshots/history-view.png" />

<!-- TODO: Re-capture screenshots if the UI has drifted since the last snapshot. Consider adding a short GIF of the highlight-to-branch flow and one of parallel artifact generation. -->

## Limitations

- **Client-side only.** All data lives in `localStorage`. Clearing browser storage wipes every project; there's no multi-device sync or collaboration.
- **Bring your own key.** No managed Gemini proxy — the API key sits in the user's browser and requests go directly to Google.
- **No tests.** Vitest and Playwright are installed but no test files or CI checks exist yet.
- **Single LLM provider.** Gemini only; no abstraction for swapping models.
- **No auth.** Anyone with the URL can use their own key; projects aren't tied to accounts.
- **Artifact quality depends on PRD quality.** Garbage in, garbage out — structured output is enforced where possible but hallucinations still happen.

## Future work

- Replace `localStorage` persistence with a real backend (Postgres + row-level security) to unlock multi-device sync and sharing.
- Add a provider abstraction so Claude / GPT-4 / local models can slot in behind `llmProvider.ts`.
- Wire up the installed Playwright + Vitest into a real test suite and CI.
- Real-time multi-user editing on the PRD spine with branch merging.
- Export to Figma / Jira / Linear instead of just markdown + JSON.
- Proxy Gemini calls through the existing (currently unused) Vercel serverless functions so API keys don't live in the browser.
