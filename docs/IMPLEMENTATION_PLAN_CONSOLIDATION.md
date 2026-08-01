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
   `promptPacks`, `qualityGates`, `validationCommands`, `definitionOfDone`
   (and later the conditional `securityPrivacy` / `measurement` sections — see
   "Conditional cross-cutting sections" below).
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

## Conditional cross-cutting sections (W5, 2026-07)

Security/privacy and analytics used to exist only as incidental prose in PRD
fields and data-model field groups, so they could vanish between generation and
task handoff. They are now **two conditional sections of the consolidated
plan** — deliberately *not* new artifact subtypes, which would cost a
generation slot and re-fragment review (the very problem
[docs/audits/ARTIFACTS_BUILD_READINESS_AUDIT_2026-07-25.md](audits/ARTIFACTS_BUILD_READINESS_AUDIT_2026-07-25.md)
raises). See [docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md](ARTIFACT_READINESS_RESOLUTION_PLAN.md) §W5.

**The two sections** (`StructuredImplementationPlan`, all fields optional per
rule 3, so legacy plans render unchanged; passed through verbatim by the
adapter onto `ConsolidatedImplementationPlan`):

| Section | Shape | Per-item links |
|---|---|---|
| `securityPrivacy` — Security & Privacy obligations | `{ summary?, controls?: PlanSecurityControl[], openQuestions? }` | each control: `requirementIds` (plain `Feature` ids), `taskIds` (tasks in *this* plan), `tests` |
| `measurement` — Measurement | `{ summary?, metrics?: PlanMeasurementMetric[], openQuestions? }` | each metric: `eventName`, `properties`, `trigger`, `validation`, `taskIds` |

**Generation is conditional; the condition lives in the prompt.** The shared
fragment `PLAN_CONDITIONAL_SECTIONS_SPEC`
(`src/lib/prompts/artifactPromptFragments.ts`) instructs the model to emit each
section only when its trigger holds and to **omit it entirely otherwise** —
never emit it empty — and to park anything it cannot responsibly answer under
`openQuestions` rather than inventing a control or an event. Both objects are
**non-required** in `implementationPlanSchema`, as is every linking field inside
a control/metric, so a partial emit still parses. Prompt edits update the
`promptSurfaces` snapshot in the same change (rule 7).

**One predicate decides "required", for both the generator and the gate.**
`src/lib/planning/crossCuttingObligations.ts` — pure, derived on read, never
persisted (rule 10), no composite score and no auto-rewrite (rule 13):

```ts
deriveCrossCuttingObligations({ prd?, safety?, dataModel?, plan? })
  → { securityPrivacy, measurement, unresolved[], hasUnresolvedObligations }
// each section: { key, label, required, reason, triggers[], satisfied,
//                 absent, missing[], advisories[], itemCount }
deriveCrossCuttingRequirements({ prd?, safety?, dataModel? })  // the trigger half alone
```

*Trigger conditions* — the same wording the prompt fragment carries:

- **Security & Privacy** is required when ANY of: the spine's safety review is
  `restricted`/`blocked` or non-`allowed`, or records any detected concern /
  boundary; a PRD `constraints` / `nonFunctionalRequirements` entry matches the
  privacy vocabulary; a PRD `risks` / `risksDetailed` entry matches it; a data
  model entity declares a `Privacy / Safety` field group with fields; or a data
  model entity declares `privacyRules`. The vocabulary is the exported
  `PRIVACY_SIGNAL_RE` in `canonicalPrdSpine.ts` — the same test the spine uses
  for `constraints.privacySecurityCompliance`. **Do not fork it**: two
  vocabularies would let the gate demand a section the generator was never
  asked for.
- **Measurement** is required when `prd.successMetrics` contains at least one
  metric with a non-empty `name`.

*Satisfaction* is itemised, never scored. A required section with nothing in the
plan is `absent`. A present section is unsatisfied while any control lacks a
requirement id / task / test, any `openQuestion` is still open, any declared
success metric has no event mapping (or is only parked), any metric lacks
`eventName` / `trigger` / `validation`, or any linked `taskIds` entry does not
resolve to a task in the same plan (that last check runs only when the caller
passes `milestones` — an unverifiable link is skipped, never reported as
broken). `properties` and per-metric `taskIds` are
prompted for but reported as **advisories**, not blockers — a counter event can
legitimately carry no properties, and a gate stricter than the generator would
fail well-formed plans (plan §7).

**W6 consumes this module rather than re-deriving anything.** The build-packet
readiness evaluator's "Conditional security/privacy + measurement obligations
satisfied" criterion is `report.unresolved` (empty ⇒ satisfied), with each
entry's `missing[]` as the user-fixable blocker detail and `triggers[]` as the
evidence for why it is owed. Nothing in W5 blocks generation or rendering.

**Rendering is honest about absence.**
`src/components/artifacts/CrossCuttingObligationsCard.tsx` (rendered by
`ArtifactWorkspace` on the Implementation Plan page, above the plan view) has
exactly three states per section: **not required → renders nothing**; **required
+ satisfied → the controls / metric mappings with their links**; **required +
unsatisfied → an explicit "Unresolved obligation"** carrying the triggers that
fired and the named gaps, with whatever the plan does carry rendered underneath.
An absent-but-required section is never an empty section and never silently
omitted, and Synapse never fills one in for the user. (W7 folds this surface
into Final Review, driven by W6.)

## Phase plan / commit cadence

1. Audit note (this doc).
2. Additive types + Gemini schema extension.
3. Adapter/normalizer + prompt-pack parser extraction + unit tests.
4. Assets-page consolidation (retired subtype wiring).
5. Consolidated renderer (tab labels now Build Brief / Roadmap / Prompts /
   Coverage — internal ids unchanged — plus the executive PlanHeader,
   copied-pack progress via the `planProgress` overlay, and the
   coverage/impact matrix; see the CLAUDE.md renderer section). The
   validation/quality-gate surface (a "Validation" tab) was later removed as
   unnecessary complexity — Synapse ends at the plan + prompts handoff. See
   the "Removed: validation surface" note in
   `docs/architecture/WORKSPACE_AND_ARTIFACTS.md`.
6. Generation prompt + deps + progress labels.
7. Tour/demo copy + screenshot script + docs (README, CLAUDE.md,
   artifact-flow).
8. Tests + `npm run lint` + `npm run build` + `npm test`.
