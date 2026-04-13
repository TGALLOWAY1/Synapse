# Artifact Flow

A file-by-file trace of how a raw prompt becomes a set of structured
product artifacts. This document complements
[`architecture.md`](./architecture.md) by walking through the happy path
with concrete function names.

## 1. Prompt → Structured PRD

**Entry:** `src/components/HomePage.tsx`

The user types a prompt and clicks **New Project**. `HomePage` calls
`useProjectStore.getState().createProject(name, promptText, platform)`,
which seeds an empty `SpineVersion` (`v1`) and navigates to
`/p/:projectId`.

**Generation:** `src/lib/services/prdService.ts`

`ProjectWorkspace` detects the placeholder spine and calls
`generateStructuredPRD()` (`prdService.ts`). That function asks Gemini for
a `StructuredPRD` in JSON mode using `structuredPRDSchema` from
`src/lib/schemas/prdSchemas.ts`, then updates the spine via
`updateSpineStructuredPRD()` on the store.

**Storage:** `src/store/slices/spineSlice.ts`

Each regeneration creates a new `SpineVersion` with `isLatest: true`; the
previous version is retained in history.

## 2. PRD → Branch → Consolidation

**Entry:** `src/components/SelectableSpine.tsx`

The user highlights any substring of the rendered PRD. `SelectableSpine`
uses `mark.js` to anchor the selection and opens the branch creation
sheet. `createBranch()` on the store (`slices/branchSlice.ts`) creates a
`Branch` record pinned to the current spine and the selected anchor text.

**Conversation:** `src/components/BranchCanvas.tsx`

Each reply in the branch is an LLM round-trip through `replyInBranch()` in
`src/lib/services/branchService.ts`. The branch accumulates a message
history.

**Merging back:** `src/components/ConsolidationModal.tsx`

When the user consolidates a branch, `consolidateBranch()`
(`branchService.ts`) asks Gemini to fold the branch decisions back into
the spine. The result creates a new `SpineVersion`, marks the old one
`isLatest: false`, and records a `Consolidated` history event.

## 3. Spine → Mockups

**Entry:** `src/components/MockupsView.tsx`

Once the user marks the spine `isFinal`, the Mockups stage unlocks.
`MockupsView` collects platform (`mobile` / `desktop`), fidelity (`low` /
`mid` / `high`), and scope (`single_screen` / `multi_screen` /
`key_workflow`) into a `MockupSettings` object.

**Generation:** `src/lib/services/mockupService.ts`

`generateMockup()` streams markdown back from Gemini and stores each run
as a new `ArtifactVersion` of a mockup `Artifact`. `MockupsView` supports
side-by-side version diffing.

## 4. Spine → Core Artifacts (bundle or individual)

**Entry:** `src/components/ArtifactsView.tsx`

Seven core artifact types ship in the bundle:

| Subtype | Rendering |
|---|---|
| `screen_inventory` | Grouped card grid (`renderers/ScreenInventoryRenderer.tsx`) |
| `data_model` | Entity tables (`renderers/DataModelRenderer.tsx`) |
| `component_inventory` | Categorized cards (`renderers/ComponentInventoryRenderer.tsx`) |
| `user_flows` | Markdown |
| `design_system` | Markdown |
| `implementation_plan` | Markdown |
| `prompt_pack` | Markdown |

Clicking **Generate All** now executes a dependency-aware pipeline using
`CORE_ARTIFACT_PIPELINE` from `src/lib/coreArtifactPipeline.ts`.
Artifacts are generated in a deterministic order:

1. `screen_inventory`
2. `user_flows`
3. `component_inventory`
4. `data_model`
5. `implementation_plan`
6. `design_system`
7. `prompt_pack`

Each call to `generateCoreArtifact()` receives context from already
generated dependencies (`generatedArtifacts`) so prompts are grounded in
upstream artifacts rather than generated independently. Individual
generate and **Refine** buttons still call the same service for targeted
operations.

**JSON mode:** The three structured subtypes
(`screen_inventory`, `data_model`, `component_inventory`) request Gemini
JSON mode with schemas from `src/lib/schemas/artifactSchemas.ts` and
convert the structured response to markdown via
`structuredArtifactToMarkdown()` before storing.

**Validation:** Every generation result passes through two validators:

- `src/lib/artifactValidation.ts` for structural completeness
- `validateCrossArtifactConsistency()` in
  `src/lib/artifactOrchestration.ts` for PRD traceability, generic output
  detection, and subtype-specific consistency checks

Warnings surface as an amber icon on artifact cards.

**Storage:** `src/store/slices/artifactSlice.ts`

Each generation creates an `ArtifactVersion` linked to its source
`SpineVersion` via a `SourceRef`. The newest version is marked
`isPreferred: true` by default; users can pin an older version.

### Pipeline map details (non-mockup artifacts)

| Step | Artifact | Primary Inputs | Output Guarantees | Validation Gate |
|---|---|---|---|---|
| 1 | `screen_inventory` | Structured PRD, canonical feature glossary | Functional-area grouped screens, navigation, feature refs | Structural headers + markdown checks |
| 2 | `user_flows` | PRD + `screen_inventory` excerpt | Goal/preconditions/steps/success/error paths | Cross-artifact check for feature propagation + error coverage |
| 3 | `component_inventory` | PRD + `screen_inventory` + `user_flows` | Reusable component catalog with usage mapping | Structural + cross-artifact consistency warnings |
| 4 | `data_model` | PRD + `user_flows` | Entities, fields, relationships, API endpoint implications | Structural + explicit API-surface check |
| 5 | `implementation_plan` | PRD + `component_inventory` + `data_model` | Milestones, dependencies, DoD, feature traceability map | Feature-traceability coverage warning |
| 6 | `design_system` | PRD + `component_inventory` | Tokens/patterns/states/layout guidance | Structural format checks |
| 7 | `prompt_pack` | PRD + `implementation_plan` + `design_system` + `data_model` | Downstream prompts with canonical feature/entity references | Cross-artifact genericness + traceability warnings |

### Audit-derived quality controls

The non-mockup audit identified four main trust risks: independent
generation feel, naming drift, missing feature propagation, and uneven
formatting. The current controls directly target those risks:

- **Dependency-ordered generation** (instead of independent bundle jobs)
  to force artifact-to-artifact grounding.
- **Canonical feature glossary + narrative guardrails** in every
  generation prompt to reduce naming drift.
- **Cross-artifact consistency validator** to flag weak propagation and
  generic language before users treat artifacts as final.
- **Normalization pass** to reduce markdown formatting variability across
  generations.

For the full audit report and rationale, see:
`docs/non-mockup-artifact-audit-2026-04-13.md`.

## 5. Spine → Markup Images

**Entry:** `src/components/MarkupImageView.tsx`

Five annotation types are available: `screenshot_annotation`,
`critique_board`, `wireframe_callout`, `flow_annotation`,
`design_feedback`.

**Generation:** `src/lib/services/markupImageService.ts`

`generateMarkupImage()` requests Gemini JSON mode with the
`markupImageSchema` to produce a `MarkupImageSpec` — a list of annotation
layers (boxes, arrows, callouts, highlights, numbered markers, text
blocks). The result is stored as the `content` field of an
`ArtifactVersion` of type `markup_image`.

**Rendering:** `src/components/MarkupImageRenderer.tsx`

Parses the JSON spec and renders a resolution-independent SVG. Users can
export the SVG directly.

## 6. Feedback loop

**Entry:** `src/components/FeedbackModal.tsx`

From any mockup `ArtifactVersion`, users can extract structured feedback
items. Each item has a `type` (e.g. `workflow_refinement`,
`missing_state`, `visual_system`) and a target artifact type.

**Apply:** `src/components/FeedbackItemsList.tsx`

Open feedback items surface back on the PRD stage as actionable cards.
Applying one spawns a localized branch on the current spine, pre-populated
with the feedback as an initial intent.

## 7. Staleness

**Logic:** `src/store/slices/stalenessSlice.ts`

When a new `SpineVersion` is created, every `Artifact` whose latest
`ArtifactVersion` references an older spine is marked as
`possibly_outdated` or `outdated`. `StalenessBadge.tsx` renders the
indicator; `ArtifactsView` offers a **Refresh Stale** button that
regenerates only affected artifacts.

## 8. History

**Entry:** `src/components/HistoryView.tsx`

Every meaningful store action (`Init`, `Regenerated`, `Consolidated`,
`ArtifactGenerated`, `ArtifactRegenerated`, `FeedbackCreated`,
`FeedbackApplied`) writes a `HistoryEvent`. `HistoryView` renders them
chronologically with optional diffs — giving the user a project-level
audit log they can scroll through.
