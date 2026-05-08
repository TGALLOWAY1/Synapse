# Synapse Codebase Cleanup Audit

**Date:** 2026-05-08
**Branch:** `claude/synapse-codebase-audit-tIUSS`
**Scope:** Full repo (`src/`, `api/`, `scripts/`, `docs/`, configs, `package.json`)

---

## 1. Executive Summary

Synapse is in considerably better shape than a senior-engineer cleanup pass
typically expects. Across ~80 components, ~70 lib modules, 13 services, 8
store slices, and a small Vercel serverless backend, the codebase has:

- **No duplicate utilities** (no second slugify, debounce, retry, deep-clone, etc.)
- **No orphaned routes or pages** — every component mounted in `App.tsx` is real
- **No dead service files** — all 13 `src/lib/services/*.ts` are imported
- **No orphaned prompts or schemas** — every `src/lib/prompts/*` and `src/lib/schemas/*` file has consumers
- **No backend dead handlers** — every `api/*` endpoint has a frontend call site

Where the codebase _does_ carry weight is in three small, well-evidenced
places, all of which this audit removes (Phase 1, applied in this commit):

1. A 34-LOC unused `useStreamingText` hook with zero importers.
2. The body of `runPrdPipeline` (the legacy single-pass PRD function), which
   has been superseded by `runProgressivePrdPipeline`. Only its **types** are
   still imported.
3. A one-shot recruiter MongoDB backfill script (`migrate-recruiters-to-users.mjs`)
   that has been complete for weeks.
4. Seven v1-era documents in `docs/archive/` that have been superseded by the
   current architecture / audit / deployment docs.

### Biggest maintainability risks

- **PRD pipeline duplication of intent across two files.** `prdPipeline.ts`
  now exists *only* to export the types `PrdPipelineOptions` /
  `PrdPipelineResult` / `PRD_SCHEMA_VERSION`. Long-term the file should
  probably be merged into `progressivePrdPipeline.ts` — but only after that
  file has stabilized for a release cycle. **Backlogged, not fixed.**
- **CDN-loaded Tailwind in mockup sandbox** (`buildMockupSrcDoc.ts:30`) —
  load-bearing for HTML mockup rendering, but a third-party-network and
  supply-chain risk. Already tracked via in-file `TODO(tailwind-hardening)`.
- **No E2E coverage** of the four hottest user paths: PRD generation, mockup
  generation, branch consolidation, staleness detection. 28 vitest files
  exercise utility/schema layers; the integration paths are uncovered.

### Highest-confidence cleanup opportunities

- The four Phase 1 items above. Already applied.
- Sunset `GEMINI_MODEL_MIGRATION_KEY` (in `App.tsx`) once it has been live
  long enough — recommend July 2026.
- Decide whether the "Password reset is coming soon" tooltip in
  `LoginPage.tsx:321` should ship password reset or be removed.

### Areas that should not be touched without deeper tests

- **PRD generation orchestration** (`progressivePrdPipeline.ts`,
  `progressivePrdGeneration.ts`) — high cognitive load, streaming retry logic,
  no integration test backing.
- **Artifact orchestration** (`artifactJobController.ts`,
  `coreArtifactService.ts`, `artifactOrchestration.ts`) — concurrency control
  for multi-artifact bundle generation. Deceptively coupled.
- **Staleness detection** (`stalenessSlice.ts`) — single getter, but feeds UI
  in many places; refactoring should come with explicit tests.
- **Mockup HTML rendering** (`buildMockupSrcDoc.ts` + `MockupHtmlPreview`) —
  iframe sandboxing and CSP semantics matter; there is one unit test on the
  srcdoc builder, no end-to-end test.
- **Persistence migrations** in `src/store/projectStore.ts` and `src/App.tsx`
  — these protect real localStorage data on user machines.

---

## 2. Current Architecture Map

### Major folders

```
src/
├── App.tsx                       # Router + one-shot Gemini model migration
├── main.tsx                      # ReactDOM.createRoot
├── components/                   # 80 files: pages, modals, renderers, mockups
│   ├── prd/                      # PRD sub-components (Callout, ImplementationSummarySection)
│   ├── mockups/                  # MockupViewer + buildMockupSrcDoc + tests
│   ├── renderers/                # Per-artifact-type viewers
│   │   └── UserFlowsRenderer/    # Flow-specific subtree with own tests
│   └── infographics/             # Onboarding carousel
├── store/                        # Zustand
│   ├── projectStore.ts           # Root composition + persist + onRehydrate migration
│   └── slices/                   # 8 domain slices (project, spine, branch, artifact, feedback, generationJobs, prdProgress, staleness)
├── lib/
│   ├── services/                 # 13 high-level orchestrators (PRD, artifact, mockup, branch)
│   ├── prompts/                  # prdPrompts.ts, prdSectionPrompts.ts
│   ├── schemas/                  # prdSchemas, artifactSchemas, mockupSchema
│   ├── designTokens/             # Token generation, CSS vars, validation, prompt snippet
│   ├── derive/                   # Implementation summary derivation
│   ├── geminiClient.ts           # Gemini transport (sync + streaming + retry)
│   ├── openaiClient.ts           # OpenAI transport
│   ├── llmProvider.ts            # Barrel + provider routing
│   ├── recruiterApi.ts           # Frontend → /api/* glue (recruiter portal)
│   ├── snapshotClient.ts         # Frontend → /api/snapshots
│   └── ...                       # jsonRepair, textCleanup, mockupValidation, mockupQuality, etc.
├── types/index.ts                # Single source of truth for domain model
└── data/demoProject.ts           # Demo fixture for onboarding

api/                              # Vercel Node serverless (recruiter portal only)
├── _lib/                         # Shared: db, session, oauth, password, rateLimit
├── activity.js, session.js, snapshots.js
├── auth/                         # OAuth (Google/GitHub/LinkedIn) + email signup/login/logout
└── admin/recruiters.js

scripts/
└── mockup-eval-harness.mjs       # Playwright-driven mockup quality harness

docs/
├── architecture.md, artifact-flow.md, auth.md, deployment.md (current)
├── mockup-audit-*.md, mockup-failure-map-*.md, mockup-improvements-plan-*.md (recent)
├── audits/                       # this audit
├── backlog/                      # consolidated BACKLOG.md
└── archive/                      # 3 retained v1/v2 design notes (after this pass)
```

### Main data flow

```
User prompt
  └─▶ HomePage.handleCreateProject()
        └─▶ runProgressivePrdPipeline()              (src/lib/services/progressivePrdPipeline.ts)
              ├─▶ progressivePrdGeneration.ts        (section streaming + JSON repair)
              ├─▶ prdSectionPrompts + prdPrompts     (prompts/)
              └─▶ prdMarkdownRenderer                (deterministic md from JSON)
        └─▶ spineSlice.addSpineVersion()             (store)

PRD stage (currentStage = 'prd')
  ▶ SelectableSpine: text selection → branch creation
  ▶ branchSlice + branchService.consolidateBranch() merges branch back into spine

Workspace stage (currentStage = 'workspace')
  ▶ ArtifactsView
      └─▶ artifactJobController                      (concurrency control)
            └─▶ coreArtifactService                  (the 7 core artifact types)
                  └─▶ artifactSchemas (JSON mode for 3 of them)
                  └─▶ structuredArtifactToMarkdown
      └─▶ Per-type Renderer (renderers/)
  ▶ MockupsView
      └─▶ mockupService → mockupImageService → MockupViewer/MockupHtmlPreview
  ▶ MarkupImageRenderer (SVG from MarkupImageSpec)

History stage
  ▶ HistoryView (chronological event timeline)

Persistence
  ▶ Zustand `persist` middleware → localStorage (debounced)
  ▶ partialize strips: jobs, prdProgress, prdSectionStatus
  ▶ onRehydrateStorage migrates legacy currentStage values
```

### Where things live

| Concern | Owner |
|---|---|
| Domain types | `src/types/index.ts` |
| Prompts | `src/lib/prompts/prdPrompts.ts`, `prdSectionPrompts.ts` |
| Schemas | `src/lib/schemas/{prdSchemas, artifactSchemas, mockupSchema}.ts` |
| Artifact state | `src/store/slices/artifactSlice.ts` |
| Staleness | `src/store/slices/stalenessSlice.ts` (single getter) |
| Mockup generation | `src/lib/services/{mockupService, mockupImageService}.ts` |
| Mockup HTML rendering | `src/components/mockups/{MockupViewer, MockupHtmlPreview, buildMockupSrcDoc}.ts(x)` |
| LLM transport | `src/lib/{geminiClient, openaiClient}.ts` |
| Provider routing | `src/lib/llmProvider.ts` (barrel) |
| Persistence | `src/store/projectStore.ts` (Zustand `persist`) |

---

## 3. Dead Code Candidates

| Item | Location | Evidence | Risk | Recommendation |
|---|---|---|---|---|
| `useStreamingText` hook | `src/lib/useStreamingText.ts` (34 LOC) | `rg useStreamingText src/` shows only its own definition | **Low** | **Delete (applied)** |
| `runPrdPipeline` function + `parseStructuredPrd` helper | `src/lib/services/prdPipeline.ts` | Only mention outside its own file is a comment in `progressivePrdPipeline.ts`. `prdService.ts` calls `runProgressivePrdPipeline` exclusively. **Types** from this file are still imported. | **Low** | **Delete function body, keep types (applied)** |
| Recruiter MongoDB backfill | `scripts/migrate-recruiters-to-users.mjs` | Not in `package.json` scripts; one-shot; idempotent on already-migrated docs | **Low** | **Delete (applied)** |
| `original-prd.md` | `docs/archive/` | v1 PRD; product has materially evolved | **Low** | **Delete (applied)** |
| `codebase-audit-2026-03-25.md` | `docs/archive/` | 6 weeks old; superseded by this audit | **Low** | **Delete (applied)** |
| `codebase-assessment.md` | `docs/archive/` | v1 assessment; obsolete | **Low** | **Delete (applied)** |
| `expansion-plan.md` | `docs/archive/` | v1→v2 roadmap; implemented | **Low** | **Delete (applied)** |
| `prd-compliance.md` | `docs/archive/` | v1 feature checklist | **Low** | **Delete (applied)** |
| `qa-testing-guide.md` | `docs/archive/` | v1 manual QA procedures | **Low** | **Delete (applied)** |
| `assessment-action-plan.md` | `docs/archive/` | v1 fix log | **Low** | **Delete (applied)** |
| "Password reset coming soon" tooltip | `src/components/LoginPage.tsx:321` | Tooltip with no handler; no companion route | **Low** | **Backlog** — decide whether to ship or remove |
| `qualityScores` field on `SpineVersion` + writes in `spineSlice` lines 121, 143 | `src/types/index.ts`, `src/store/slices/spineSlice.ts` | Setter is conditional on `meta?.qualityScores !== undefined`; current pipelines never set this | **High** | **Keep** — protects legacy localStorage projects |
| `onRehydrateStorage` legacy stage migration | `src/store/projectStore.ts:42-58` | Coerces `'devplan'/'prompts'/'mockups'/'artifacts'` → `'prd'/'workspace'`; runs cheaply on every hydration | **High** | **Keep** — fires for any browser with a pre-migration project |
| `GEMINI_MODEL_MIGRATION_KEY` shim | `src/App.tsx:32-49` | Migrates users off `gemini-2.5-flash`; sentinel dated `2026_04` | **Medium** | **Keep until ~July 2026, then remove** |

---

## 4. Duplicate Functionality

**No material duplication found.** Specifically checked and ruled out:

- Markdown rendering — single canonical path: `prdMarkdownRenderer.ts` for PRD, `dataModelMarkdown.ts` for data-model artifact, `designTokens/markdownRenderer.ts` for design system. No overlap.
- Slug helpers — only `slugifyScreenName()` in `screenInventoryImageStore.ts`.
- Retry logic — only inline in `geminiClient.ts` and `openaiClient.ts`. Not extracted but also not duplicated. (See Backlog: optional extraction.)
- Schema validation — `artifactValidation.ts`, `mockupValidation.ts`, `groundingFields.ts` each cover distinct content shapes.
- Project state updates — concentrated in slices with clear ownership.
- Export formatting — `ExportModal.tsx` is the single export site.
- PRD section handling — single source of truth in `prdSectionPrompts.ts` for section identity, used by both prompts and renderer.
- Staleness — single getter in `stalenessSlice.ts`.

The one borderline case is `prdPipeline.ts` vs `progressivePrdPipeline.ts`.
After this cleanup, `prdPipeline.ts` exports types only and the function lives
in `progressivePrdPipeline.ts`. **Canonical owner: `progressivePrdPipeline.ts`.**
Long-term the type file could be folded in, but doing so now would churn many
import sites for no behavior change. See Backlog.

---

## 5. Backfill / Migration / Legacy Code Review

Three live shims exist. Default stance for development-only shims is _delete_;
applied below.

| Shim | Purpose | Still needed? | Recommendation |
|---|---|---|---|
| `onRehydrateStorage` legacy stage migration (`projectStore.ts`) | Coerces removed stage values (`devplan`, `prompts`, `mockups`, `artifacts`) into the current `prd`/`workspace` model | **Yes** — every browser still on those values triggers this | **Keep.** Cost is one map+find on hydrate. Sunset once analytics show no projects in legacy stages for 60+ days. |
| `GEMINI_MODEL_MIGRATION_KEY` (`App.tsx`) | One-shot bump of any `GEMINI_MODEL` localStorage value off the deprecated `gemini-2.5-flash` | **Yes for ~2 more months** — sentinel dated 2026-04 | **Keep until 2026-07-01**, then delete the migration block. Backlogged. |
| `qualityScores` on `SpineVersion` + setter | Stored on persisted v1 projects from the now-removed multi-pass scoring pipeline | **No new writes**, but field is read for display in legacy projects | **Keep type.** Pure backward compatibility — costs nothing. |

Other potential legacy code that was investigated and found _not_ present:
- No old prompt format adapters
- No old artifact-structure adapters
- No demo-data backfill / seed code beyond `src/data/demoProject.ts` (which is a current onboarding fixture)
- Multi-pass scoring scaffolding (`scorePRD`, `revisePRD`, `passB`, `passC`, `qualityRubric`) is **fully gone** — verified via grep

---

## 6. Folder Organization

The current organization is **coherent and product-aware**. Top-level
boundaries are clear:

- `components/` for UI
- `store/slices/` for state per domain
- `lib/services/` for orchestration
- `lib/prompts/` and `lib/schemas/` cleanly separate prompt strings and JSON schemas from runtime code
- `api/_lib/` cleanly separates shared backend helpers from handlers

**Recommendation against the prompt's suggested `features/*` reorg.**
A move to `features/projects/*`, `features/prd/*`, `features/artifacts/*`, etc.
would cross-cut every existing slice/service/component and would not improve
the organization meaningfully — Synapse already organizes by concern, just at
the file level rather than the folder level. The cost (hundreds of import
rewrites; breaking every open editor tab; broken muscle memory) outweighs the
benefit.

**Smaller targeted moves that _would_ help:**
- The flat `src/lib/*.ts` layer (mockupValidation, mockupQuality, mockupParsing, mockupDefaults, mockupAlignmentCritique, screenInventoryNormalize, jsonRepair, textCleanup, errors, concurrency) could move into `src/lib/utils/` to shrink the visual mass at the top of `src/lib/`. **Backlogged** — low value for moderate import churn.
- `src/lib/useStreamingText.ts` was the only hook outside of components and was unused; deleted in this pass.

The recruiter portal already lives in distinct files (`LoginPage`,
`RecruiterAdminPage`, `recruiterApi.ts`, `snapshotClient.ts`) and shares
nothing with the PRD workspace beyond the React tree. No reorg helps it.

---

## 7. Dependency and Package Audit

`package.json` is **clean**. Notes:

| Package | Imports | Notes |
|---|---|---|
| `react`, `react-dom`, `react-router-dom` | many | Core |
| `zustand` | core store + standalone stores | Core |
| `lucide-react` | 38 | Primary icon set |
| `react-icons` | 5 (`react-icons/md`) | Used by infographic slides only. Initial sub-agent flagged this as unused — **confirmed in use** via direct grep. |
| `react-markdown`, `remark-gfm`, `rehype-raw` | active | Used in SelectableSpine + ArtifactWorkspace |
| `@formkit/auto-animate` | 2 | Niche dependency; could be replaced with CSS transitions if budget tightens. **Keep.** |
| `mark.js` + `@types/mark.js` | 2 (SelectableSpine) | Highlighting library; load-bearing for spine selection UI |
| `uuid` + `@types/uuid` | 12 | Standard ID gen |
| `clsx`, `tailwind-merge` | many | Standard Tailwind toolkit |
| `date-fns` | 1 (RecruiterAdminPage) | Used for one component; could be replaced by `Intl.DateTimeFormat`. Low priority. |
| `@vercel/analytics` | mounted in App | Production analytics |
| `@vercel/blob` | api + snapshotClient | Blob storage for snapshots |
| `@tailwindcss/typography` | tailwind plugin | Markdown rendering |
| `playwright` (dev) | scripts/mockup-eval-harness only | **Intentional** — CLAUDE.md notes there's no Playwright suite; harness uses it for screenshots |
| Vitest, jsdom, @testing-library/* | tests | Standard |
| ESLint, typescript-eslint, react-hooks plugin | lint | Standard |

**No dependencies removed in this pass.** All have at least one verified
import. Date-fns and @formkit/auto-animate are candidates for future review
but neither is wasteful enough to justify removal-debt now.

---

## 8. Refactor Priority Plan

### Phase 1 — Safe Cleanup (applied in this commit)

| File | Change | Risk |
|---|---|---|
| `src/lib/useStreamingText.ts` | Delete (zero importers) | Low |
| `src/lib/services/prdPipeline.ts` | Trim function body; keep types and `PRD_SCHEMA_VERSION` | Low — types are the only re-export |
| `scripts/migrate-recruiters-to-users.mjs` | Delete (one-shot, complete) | Low |
| `docs/archive/{original-prd, codebase-audit-2026-03-25, codebase-assessment, expansion-plan, prd-compliance, qa-testing-guide, assessment-action-plan}.md` | Delete | Low — preserved in git history |
| `docs/archive/README.md` | Update index to drop deleted files | Low |
| `docs/audits/SYNAPSE_CODEBASE_CLEANUP_AUDIT.md` | New (this file) | — |
| `docs/backlog/BACKLOG.md` | New consolidated backlog (sibling) | — |

**Validation**: `npm run lint`, `npx tsc --noEmit`, `npm run build`,
`npm test` — see commit description.

### Phase 2 — Consolidation (deferred)

- Decide whether to merge `prdPipeline.ts` (types-only) into
  `progressivePrdPipeline.ts`, then update the 2 import sites. Wait until
  `progressivePrdPipeline.ts` has stabilized for one release.
- Optionally extract retry logic from `geminiClient.ts` + `openaiClient.ts`
  into `src/lib/utils/retry.ts`. Gain is small; only do it if a third LLM
  client is added.

**Risk:** Low. Validation: type-check + tests.

### Phase 3 — Folder Reorganization (deferred / not recommended at this scale)

- **Recommended:** move flat `src/lib/*.ts` helper files (mockup*, screenInventoryNormalize, jsonRepair, textCleanup, errors, concurrency) into `src/lib/utils/`. ~10 files, ~30 import sites.
- **Not recommended:** the prompt-suggested top-down `features/*` reorg. See
  Section 6.

**Risk:** Medium (many imports change). Validation: full type-check + build + tests + manual smoke of every page.

### Phase 4 — Risky Refactors (deferred; need test coverage first)

- Add E2E smoke tests for: PRD generation, mockup generation, branch
  consolidation, staleness detection. (No tests today on these paths.)
- Resolve `TODO(tailwind-hardening)` in `buildMockupSrcDoc.ts` — replace CDN
  Tailwind with vendored compiled CSS in the iframe sandbox.
- Sunset `GEMINI_MODEL_MIGRATION_KEY` after July 2026.
- Reconcile CLAUDE.md's "intent classification" mention on `feedbackSlice`
  with the actual code (feature does not exist).

**Risk:** Medium-High. Each item should be a separate PR with explicit
validation.

---

## 9. Out-of-Scope Notes

This audit deliberately did not modify or recommend modifying:

- `progressivePrdPipeline.ts`, `progressivePrdGeneration.ts`, or
  `prdService.ts` — the live PRD pipeline.
- `artifactJobController.ts`, `coreArtifactService.ts`,
  `artifactOrchestration.ts` — artifact orchestration internals.
- `stalenessSlice.ts` — staleness detection.
- `mockupService.ts`, `mockupImageService.ts`,
  `MockupViewer`/`MockupHtmlPreview`/`buildMockupSrcDoc.ts` — mockup
  rendering.
- The recruiter portal backend (`api/`) or frontend
  (`LoginPage`/`RecruiterAdminPage`/`recruiterApi.ts`/`snapshotClient.ts`).
- `package.json` dependencies.
- `vercel.json`, `eslint.config.js`, `tailwind.config.js`, `vitest.config.ts`,
  `vite.config.ts` — all current and correct.
