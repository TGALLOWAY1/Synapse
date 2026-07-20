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
devices (see [docs/architecture/PROJECT_SYNC.md](docs/architecture/PROJECT_SYNC.md)). A Vercel-hosted backend
(under `api/`) powers both that project sync and a separate recruiter-portal
sub-product with OAuth, MongoDB, and snapshot storage.


## How this file is organized (documentation rule)

CLAUDE.md is deliberately lean: it holds the commands, the critical gates, the
cross-cutting rules that apply no matter what you touch, and an **index** into
the detailed architecture docs under `docs/architecture/`. The deep-dive rules
for each subsystem live in those topic docs — **read the relevant topic doc
before working in its area** (the index below says which).

**Keep the docs in sync with the code in the same change.** Whenever you add,
remove, or meaningfully alter architecture, data flow, state slices, the LLM
pipeline, domain types, or a cross-cutting pattern:

- update the relevant `docs/architecture/*.md` topic doc as part of the same
  commit — do not leave it for a follow-up;
- if the change alters a cross-cutting rule, the architecture map, or the doc
  index itself, update this file too;
- if a change makes an existing description wrong, fix the description; if it
  introduces a pattern others must follow or must not break, document it.

Treat docs drift as a defect in the change itself.

### README rule

`README.md` is the **public-facing** description of Synapse and must not drift
from reality. Whenever a change adds, removes, or meaningfully alters a
**user-visible feature, capability, or workflow** — a new pipeline stage, a new
artifact or asset type, a behavior shown in the interactive tour
(`src/components/tour/`), a change to supported models/providers, the safety
gate, preflight clarification, snapshots, or the getting-started flow — review
`README.md` in the same change and update it:

- Keep the feature tour aligned with the live product tour's seven-beat
  narrative (Idea → Spec generation → Refine → Decisions → Versions → Assets →
  Connections) so the README and `/tour` tell the same story.
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
npm run e2e          # Live e2e: real project generation + page screenshots
                     # (needs SYNAPSE_E2E_GEMINI_KEY; see docs/E2E_LIVE_TESTING.md)
npm run e2e:smoke    # E2e harness check without any LLM calls / key
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
There is no Playwright *assertion* suite; Playwright powers the screenshot
capture scripts and the live e2e driver `scripts/e2e-live-run.mjs`
(`npm run e2e` — real generation + visual screenshots + report; see
[docs/E2E_LIVE_TESTING.md](docs/E2E_LIVE_TESTING.md) and the `/e2e` skill in
`.claude/skills/e2e/`).

## Tech Stack

- React 19 + TypeScript + Vite 7
- Tailwind CSS 3 + tailwind-merge + clsx
- framer-motion (page/drag transitions in the interactive product tour)
- Zustand 5 with `persist` middleware (debounced localStorage)
- Google Gemini API called directly from the browser; key in localStorage
- React Router v7 (workspace, recruiter portal, admin pages, the interactive
  product tour at `/tour` + `/about` alias, /privacy)
- Deployed to Vercel (SPA + Node serverless functions under `api/`)


## Architecture at a glance

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
              ↓
  PRD stage:       StructuredPRDView (the only interactive view; legacy spines
                   with no structuredPRD render as read-only ReactMarkdown with
                   no selection/branch UI) — text selection →
                   branch creation → AI conversation → consolidateBranch()
                   merges into spine (local or doc-wide scope, see
                   ConsolidationModal). Selection → action dialog runs
                   through the shared touch-aware pipeline (see
                   docs/architecture/UI_PATTERNS.md).
  Build stage:     ArtifactWorkspace (exploratory or committed outputs; bundle/
                   individual gen, refine, validate)
                   + MockupsView (platform/fidelity/scope config)
                   + MarkupImageView (MarkupImageSpec → SVG via
                   MarkupImageRenderer). The `'workspace'` pipeline stage is
                   labeled **"Explore"** for a working plan and **"Build"** for
                   a committed plan (the stage key/route stays `workspace`).
  History stage:   HistoryView — chronological timeline with diffs
```


### Domain types

`src/types/index.ts` is the single source of truth for the domain model
(Project, SpineVersion, Branch, Artifact, ArtifactVersion, FeedbackItem,
HistoryEvent, etc.). Keep optional fields optional even when only one
code path uses them — legacy localStorage data may not have them.


## Architecture docs index

Read the topic doc **before** working in its area — each carries load-bearing
rules ("do not re-add X", "never bypass Y") that are easy to violate without it.

| Topic doc | Covers | Read before touching |
|---|---|---|
| [docs/architecture/LLM_PIPELINE.md](docs/architecture/LLM_PIPELINE.md) | `geminiClient` transport + LLM Trace Viewer, the PRD DAG pipeline & sections, two-view PRD IA (Overview | Features; decisions route to the Decision Center), consistency review + guards, design-system presets & brief, canonical PRD spine, core artifact services & per-artifact model routing, prompt fragments & the prompt snapshot net, preflight clarification | Anything in `src/lib/services/`, `src/lib/prompts/`, prompts/schemas, PRD generation or rendering, model routing |
| [docs/architecture/PLANNING_AND_DECISIONS.md](docs/architecture/PLANNING_AND_DECISIONS.md) | Uncertainty-first planning: Plan → Challenge → Build progression, planning readiness projection, `PlanningRecord` / `DecisionEvent` authority model, assumption import & validation, decision impact previews, the `compareAndAppendStructuredPRD` write barrier, adversarial review engine, downstream update plans | Anything in `src/lib/planning/`, `src/lib/review/`, `src/components/planning/`, `src/components/review/`, `src/components/downstream/`, the review/readiness/downstream store slices |
| [docs/architecture/SAFETY_AND_VALIDATION.md](docs/architecture/SAFETY_AND_VALIDATION.md) | The safety gate/classifier (`src/lib/safety/`), blocking vs advisory artifact validation, automatic traceability repair, dependency sufficiency gate | Safety policy, artifact validation, generation gating |
| [docs/architecture/STATE_AND_AUTH.md](docs/architecture/STATE_AND_AUTH.md) | The store slices, generation lifecycle, interrupted-run recovery, persistence/quota, per-user project namespacing, legacy import, account linking, encrypted provider-key vault, key-resolution rules | `src/store/`, auth flows, anything reading/writing credentials |
| [docs/architecture/PROJECT_SYNC.md](docs/architecture/PROJECT_SYNC.md) | Server-side project storage (`/api/projects`), revision/conflict model, sync orchestrator + UI, recovery bundle, cross-device mockup image sync (Blob refs) | Project sync, `api/projects.js`, `api/_lib/projectsStore.js`, image refs |
| [docs/architecture/SNAPSHOTS_AND_DEMO.md](docs/architecture/SNAPSHOTS_AND_DEMO.md) | Owner snapshots (all image kinds + wire format), mockup-image audit, pin-time gate, demo capability boundary, demo hydration/reset/cache freshness | `api/snapshots.js`, `snapshotClient.ts`, anything demo (`DEMO_PROJECT_ID`) |
| [docs/architecture/WORKSPACE_AND_ARTIFACTS.md](docs/architecture/WORKSPACE_AND_ARTIFACTS.md) | Artifact sidebar groups, hidden/retired subtypes, post-commitment transition (Commit Plan → Build), consolidated Implementation Plan (+adapter), Artifact Dependency Graph / freshness actions, implementation tasks | `ArtifactWorkspace`, artifact pipeline/job controller, plan rendering, tasks |
| [docs/architecture/SCREENS_EXPERIENCE.md](docs/architecture/SCREENS_EXPERIENCE.md) | The Screens view: stable screen ids, join layer, screen contracts, readiness/coverage, review workflow (4A), downstream impact (4B), handoff + trace bridge + export (5A–5C), mockup variants (3A–3D), overlays, URL-addressable selection | Anything under `src/components/experience/` or `src/lib/screen*` / `mockupVariant*` |
| [docs/architecture/VERSIONING_AND_EXPORT.md](docs/architecture/VERSIONING_AND_EXPORT.md) | Export modal + manifest + agent handoff, version history/compare/revert, change-aware staleness, provenance stamping, "Confirm aligned" | Exports, version history, revert, staleness UX |
| [docs/architecture/UI_PATTERNS.md](docs/architecture/UI_PATTERNS.md) | PRD highlight→branch selection pipeline (desktop+touch), PRD progress timeline, incomplete-PRD gate, `GenerationProgress` modes, interactive product tour, orchestration metrics | Selection/branching UI, progress UIs, `/tour`, `/metrics` |

Standalone design docs (referenced from the topic docs):
`docs/SERVER_PROJECT_STORAGE.md`, `docs/AUTH_AND_PROVIDER_KEYS.md`,
`docs/CANONICAL_PRD_SPINE.md`, `docs/LLM_TRACE_VIEWER.md`,
`docs/IMPLEMENTATION_PLAN_CONSOLIDATION.md`, `docs/ARTIFACT_DEPENDENCY_GRAPH.md`,
`docs/DECISION_CENTER_DESIGN.md`, `docs/DECISION_CENTER_IMPLEMENTATION_PLAN.md`,
`docs/ADVERSARIAL_PLANNING_REVIEW.md`, `docs/UNCERTAINTY_FIRST_PLANNING.md`,
`docs/DECISION_CENTER_SIMPLIFICATION_PLAN.md`, `docs/VERSIONING_AUDIT.md`,
`docs/ORCHESTRATION_AND_METRICS.md`, `docs/audits/PROMPT_ARCHITECTURE_AUDIT.md`.

## Cross-cutting rules (always apply)

These hold no matter which subsystem you touch. The linked doc carries the full
rationale and detail.

1. **Store concurrency:** store actions that append a version must do **all**
   state reads inside the `set((state) => …)` updater — never from a `get()`
   snapshot taken before `set()` runs (the 7 core artifacts generate
   concurrently). → STATE_AND_AUTH.md
2. **Selector stability:** Zustand selectors must return a stable reference
   when state is unchanged — a literal `?? []` / `?? {}` inside a selector is
   the canonical React error #185 trigger; use a module-level `EMPTY_*`
   constant. → STATE_AND_AUTH.md
3. **Optional domain fields stay optional** (`src/types/index.ts`) — legacy
   localStorage data may lack them; never require a new field on read.
4. **Credentials only via `localCredentials.ts`** — never
   `localStorage.getItem('GEMINI_API_KEY')` directly; keys are namespaced per
   user. Pre-generation key gates call `hasGeminiKey()` (vault OR local), never
   a localStorage-only check. New provider call sites route through the vault
   and never log a key. → STATE_AND_AUTH.md
5. **Demo is read-only via one capability policy** (`projectCapabilities.ts`):
   UI surfaces read `getProjectCapabilities`/`useProjectCapabilities`, domain
   boundaries call `assertProjectCapability`, and every persistent store action
   belongs in `PERSISTENT_STORE_ACTIONS` so `guardProjectStoreActions` no-ops
   it for `DEMO_PROJECT_ID`. Never add raw demo-id checks at call sites or a
   second demo store. → SNAPSHOTS_AND_DEMO.md, PLANNING_AND_DECISIONS.md
6. **New persisted state must travel:** adding a persisted collection means
   wiring `ALL_PROJECT_COLLECTIONS` (`src/lib/projectBundle.ts` — the single
   list the bundle, sync, recovery, namespace switch, and legacy import all
   derive from), the snapshot collectors/restorers +
   `namespaceSnapshotForRestore`, and demo cleanup — or it silently won't
   survive snapshots/sync. → SNAPSHOTS_AND_DEMO.md, PROJECT_SYNC.md
7. **Prompts are snapshot-locked:** every major prompt surface is covered by
   `src/lib/__tests__/promptSurfaces.test.ts` — an intentional prompt edit
   updates the snapshot in the same change; an unreviewed snapshot diff is
   drift. Shared fragments live in `src/lib/prompts/` — import them, don't
   restate them inline. → LLM_PIPELINE.md
8. **Safety policy text has one source** (`src/lib/safety/safetyPolicy.ts`) —
   never inline capability lists at a surface. The safety gate and the
   incomplete-PRD gate are code-level guardrails; don't bypass their
   chokepoints. → SAFETY_AND_VALIDATION.md
9. **One freshness engine:** `evaluateDependencyGraph` via
   `src/lib/artifactFreshness.ts` (`useProjectFreshness` /
   `evaluateProjectFreshness`) is THE staleness source — never hand-roll the
   store→input loop or re-add the deleted `stalenessSlice`. The derived
   output-alignment projection (`getProjectOutputAlignment`, on the downstream
   update plan slice) layers planning semantics on top; it never replaces the
   engine. System freshness vocabulary stays separate from user
   review/readiness statuses. → WORKSPACE_AND_ARTIFACTS.md,
   PLANNING_AND_DECISIONS.md
10. **Read-side layers are derived, never persisted** (Screens join/readiness/
    review-issues/downstream/handoff, dependency graph, planning readiness,
    diffs): pure `src/lib/` modules, unit-tested, honest "estimated/derived"
    labels, advisory-only — nothing gates rendering or generation.
    → SCREENS_EXPERIENCE.md, PLANNING_AND_DECISIONS.md
11. **Every version-creating path stamps `provenance.changeSource`**, and
    revert/restore always **appends** a new version — history is never mutated
    or deleted. Never parse a version number out of an id; labels derive from
    array position. → VERSIONING_AND_EXPORT.md, STATE_AND_AUTH.md
12. **User edits are overlays:** screen/prompt/plan-progress edits live in
    `ArtifactVersion.metadata` overlays (`screenEdits`, `promptEdits`,
    `planProgress`, `extraScreens`), never rewrites of `content`; overlay
    writers must merge from the existing edit so unknown keys survive.
    → SCREENS_EXPERIENCE.md
13. **User authority over planning is append-only:** `PlanningRecord` is the
    single durable aggregate for decisions/assumptions/risks — do not add a
    parallel decision collection. Verdict events in `DecisionEvent[]` are
    restricted to `actor: 'user'`; model output lives in `DecisionAssessment[]`
    and is never presented as user-confirmed. No composite planning-confidence
    scores, no automatic artifact rewriting, no model-authored verdicts.
    → PLANNING_AND_DECISIONS.md
14. **PRD updates go through the write barrier:**
    `compareAndAppendStructuredPRD` is the authoritative version-bound path for
    applying decision impacts and section retries — it compares the latest
    spine/hash/decision event inside one transaction and appends atomically; a
    stale preview writes nothing. Never mutate the spine around it.
    → PLANNING_AND_DECISIONS.md
