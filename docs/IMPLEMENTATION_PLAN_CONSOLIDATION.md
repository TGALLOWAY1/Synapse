# Development-artifact consolidation: audit & plan

Consolidates the two Development assets — **Developer Prompts** (`prompt_pack`)
and **Build Plan** (`implementation_plan`) — into one **Implementation Plan**
artifact that connects milestones, tasks, prompt packs, linked artifacts,
quality gates, validation commands, and definitions of done.

## Phase 1 audit — where everything lives today

### Definitions & pipeline
- `src/types/index.ts` — `CoreArtifactSubtype` includes `implementation_plan`
  and `prompt_pack`; `StructuredImplementationPlan` (overview / milestones /
  tasks / architecture / risks / definitionOfDone) is the structured plan shape.
  NOTE: `implementation_plan` is *also* a PRD **section id** in
  `prdSchemas.ts` / `prdSectionPrompts.ts` / `progressivePrdGeneration.ts` — a
  separate namespace; untouched by this work.
- `src/lib/coreArtifactPipeline.ts` — `CORE_ARTIFACT_PIPELINE` metas:
  `prompt_pack` (title "Developer Prompts", dependsOn implementation_plan +
  design_system + data_model) and `implementation_plan` (title "Build Plan",
  no deps). `HIDDEN_ARTIFACT_SUBTYPES` (= still generated, no UI row) exists
  for `component_inventory`.
- `src/components/ArtifactWorkspace.tsx` — `ARTIFACT_GROUPS` Development group
  = `['prompt_pack', 'implementation_plan']`; implementation_plan rows get the
  Convert-to-Tasks button + `TaskChecklist`; prompt_pack rows get the
  `promptEdits` metadata overlay wiring.

### Generation
- `src/lib/services/coreArtifactService.ts` — per-subtype prompts.
  `implementation_plan` generates via Gemini JSON mode
  (`implementationPlanSchema` in `src/lib/schemas/artifactSchemas.ts`) and is
  serialized by `implementationPlanToMarkdown()`: legacy-parseable markdown +
  trailing ```` ```json synapse-plan ```` fence. `prompt_pack` generates
  free-form markdown (`### N. Title` / `**Category:**` / fenced prompt body).
- `src/lib/services/artifactJobController.ts` — `ALL_SLOT_KEYS` derives from
  `CORE_ARTIFACT_PIPELINE`; `pendingSlotsForSpine` decides what generates;
  `resumeIfNeeded` gates on visible slots; `MOCKUP_DEPENDENCIES` does NOT
  include either subtype.
- `src/lib/artifactModelSettings.ts` — complexity: `implementation_plan: high`,
  `prompt_pack: low`. Settings UI `ArtifactModelsSection` iterates
  `CORE_ARTIFACT_DISPLAY_ORDER`.
- `src/components/generationStages.ts` — per-subtype progress labels.

### Parsing / rendering
- `src/lib/services/implementationPlanParser.ts` — pure parser: structured
  fence extraction + legacy `### Milestone N:` markdown regex parse.
- `src/components/renderers/ImplementationPlanRenderer.tsx` — structured tabbed
  view (Tasks/Architecture/Risks/DoD) or legacy timeline.
- `src/components/renderers/PromptPackRenderer.tsx` — parses prompt cards
  inline (private `parsePromptPack`), outline nav, copy/edit per prompt.
- `src/components/renderers/index.tsx` — `ArtifactContentRenderer` dispatch.

### Downstream consumers
- Convert to Tasks: `src/lib/services/taskExtractor.ts`
  (`extractTasksFromMarkdown` auto-detects fence vs legacy markdown) +
  `ConvertToTasksModal` + `tasksSlice`.
- Export: `ExportModal.tsx` + `src/lib/exportHandoff.ts` (titles from pipeline
  metas; no subtype literals).
- Validation: `src/lib/artifactValidation.ts` — required headings
  (`implementation_plan`: Milestone/Goal/Deliverables/Dependencies;
  `prompt_pack`: Prompt/Category/Target) + synapse-plan fence check.
- `ProjectWorkspace.assetsReady` — presence check over non-hidden
  `CORE_ARTIFACT_DISPLAY_ORDER` subtypes + mockups.

### Demo / fixtures / docs
- The demo project is a **cloud snapshot** (`/api/snapshots?demo=1`); the repo
  holds no static artifact fixture (`src/data/demoProject.ts` is just the id).
  Old snapshots therefore keep the legacy two-artifact shape until the owner
  re-pins a regenerated snapshot — the render-time adapter (below) is what
  keeps them working and consolidated.
- Tour copy: `src/components/tour/tourData.ts` (implementation_plan +
  prompt_pack asset cards). Screenshot script:
  `scripts/capture-demo-screenshots.mjs`. Docs: `docs/artifact-flow.md`,
  `README.md`, `CLAUDE.md`.
- Tests: `implementationPlanParser.test.ts`, `taskExtractor.test.ts`,
  `artifactModelSettings.test.ts`, `artifactModelRouting.test.ts`,
  `exportHandoff.test.ts`, `artifactOrchestration.test.ts`,
  `buildGenerationSteps.test.ts`.

## Design decisions (risk-minimizing)

1. **Reuse the existing `implementation_plan` subtype** as the consolidated
   artifact (retitled "Implementation Plan"). No new subtype → persisted
   artifacts, version history, snapshots, sync, model routing, and the
   Convert-to-Tasks flow all keep working. The storage format stays
   "markdown + `json synapse-plan` fence".
2. **Extend `StructuredImplementationPlan` additively** — optional `summary`,
   `readiness`, `globalQualityGates`, and per-milestone `objective`, `phase`,
   `priority`, `estimatedEffort`, `dependencies`, `linkedArtifacts`,
   `promptPacks`, `qualityGates`, `validationCommands`, `definitionOfDone`.
   Old fenced plans simply lack the new fields.
3. **Render-time adapter, no data migration.**
   `implementationPlanAdapter.ts` builds a normalized
   `ConsolidatedImplementationPlan` view model from any of: native new-shape
   plan; legacy structured plan + legacy prompt_pack markdown; legacy
   markdown-only plan; prompt_pack only. Legacy prompts become prompt packs
   attached to milestones by best-effort title/keyword matching, else an
   "Unassigned Prompt Packs" group. Legacy DoD → quality gates; architecture →
   summary stack; risks → `plan.risks` (rendered in their own Risks &
   Constraints card, kept out of readiness warnings). Traceability and
   readiness are *derived*, never generated.
4. **Retire `prompt_pack` from new generation and the sidebar** via a new
   `RETIRED_ARTIFACT_SUBTYPES` set in `coreArtifactPipeline.ts` (distinct from
   HIDDEN, which still generates). Retired subtypes: excluded from
   `pendingSlotsForSpine` (never generated/resumed), from `assetsReady`, from
   `buildSlotMetas`, and from the Settings model list. The meta stays in
   `CORE_ARTIFACT_PIPELINE` so legacy persisted artifacts keep their title,
   renderer, export path, and `getArtifactMeta` never throws.
5. **Legacy prompt_pack content is consumed, not orphaned**: the Implementation
   Plan view reads the project's existing prompt_pack artifact (when present)
   through the adapter, so old projects see their prompts inside the
   consolidated view instead of a separate card.
6. **Generation prompt/schema updated in place** for `implementation_plan` to
   emit milestone-centered prompt packs (coding-agent-ready body), quality
   gates, validation commands, and DoD; it gains dependencies on
   `screen_inventory` + `data_model` so links/prompts use real names.
   `implementationPlanToMarkdown` keeps the legacy headings (validation +
   legacy parsers unaffected) and appends the new sections.

## Phase plan / commit cadence

1. Audit note (this doc).
2. Additive types + Gemini schema extension.
3. Adapter/normalizer + prompt-pack parser extraction + unit tests.
4. Assets-page consolidation (retired subtype wiring).
5. Consolidated renderer (tab labels now Build Brief / Roadmap / Prompts /
   Validation / Coverage — internal ids unchanged — plus the executive
   PlanHeader, honest gate statuses via the `planProgress` overlay, and the
   coverage/impact matrix; see the CLAUDE.md renderer section).
6. Generation prompt + deps + progress labels.
7. Tour/demo copy + screenshot script + docs (README, CLAUDE.md,
   artifact-flow).
8. Tests + `npm run lint` + `npm run build` + `npm test`.
