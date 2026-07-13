# Planning Intelligence Layer and Decision Center

Status: approved for implementation on 2026-07-12

## Product problem

Synapse already generates a coherent PRD and connected downstream artifacts, but the reasoning behind important product choices is fragmented. Assumptions live inside the PRD, feature confirmation uses separate flags, deferred scope is derived, preflight unknowns are strings, screen risks use metadata overlays, and artifact impact is reported by a separate dependency system. Users can see pieces of this reasoning, but they cannot reliably answer what still needs a decision, why a decision was made, what changed, or what must be reviewed when it changes.

The Planning Intelligence Layer establishes durable, reviewable product decisions as shared project context. The first visible capability is a Decision Center that helps users resolve uncertainty before implementation without turning planning into workflow administration.

## Chosen approach

Ship a project-level durable decision register with append-only events. Preserve the existing append-only PRD and artifact version systems and integrate with them through explicit source references, guarded impact previews, and an explicit Apply to plan action.

Two alternatives were rejected for this release:

- A PRD-derived-only page would improve presentation but would not create durable context for future critique, readiness, impact, or scenario features.
- A full planning knowledge graph would require normalizing decisions, assumptions, risks, evidence, reviews, artifacts, and conflicts at once. That is documented as future work rather than attempted as a broad migration.

## Product principles

- The user remains the authority for consequential decisions.
- A Synapse recommendation is never presented as user-confirmed.
- Generated reasoning must cite project sources or clearly identify itself as inference.
- Decision changes never silently rewrite artifacts.
- Applying a change is previewed, explicit, versioned, guarded, and reversible through existing history.
- Traceability is available through progressive disclosure rather than persistent metadata clutter.
- Readiness is factual and composable; the first release does not invent a composite score.
- Existing projects load without destructive migration or reinterpretation.

## User workflow

1. Synapse creates or imports unresolved decisions from PRD assumptions and future extraction points.
2. The Decision Center shows a factual Needs review count and a separate Decision log.
3. A user opens one decision and sees the question, why it matters, source context, options, tradeoffs, and a clearly labeled Synapse recommendation.
4. The user selects an option, supplies a custom answer, defers the choice, rejects the premise, or reopens a prior decision.
5. The action appends a decision event. It does not yet change the PRD.
6. Synapse builds an impact preview against a specific current PRD version.
7. The preview shows proposed PRD changes, possible decision inconsistencies, likely affected artifacts, and what will remain unchanged.
8. Apply to plan revalidates the preview baseline, appends a new PRD version, rebuilds the canonical spine, and records the resulting version on the decision event.
9. Existing artifacts remain untouched. Existing dependency and staleness machinery identifies what needs review or regeneration.

## Minimum complete release

The first release includes:

- A durable project-level decision register.
- Append-only decision history.
- Clear separation among user decisions, Synapse recommendations, inferred assumptions, and machine assessments.
- Lazy, idempotent import of existing PRD assumptions.
- User-created decisions.
- Select, custom answer, defer, reject premise, reopen, and revise actions.
- Options, tradeoffs, recommendation, rationale, source context, and evidence.
- Version-bound impact previews.
- Explicit guarded application to a new PRD version.
- Existing artifact dependency impact surfaced after application.
- Desktop two-pane and mobile list-to-detail UI.
- Empty, complete, loading, error, stale preview, read-only, offline, and cross-device conflict behavior.

Out of scope:

- Automatic artifact regeneration.
- Composite planning-confidence or build-readiness scores.
- Multi-user ownership, comments, or approval workflows.
- Broad adversarial critique and scenario simulation.
- Automatic bulk conversion of every existing risk, feature, feedback item, and derived log entry.
- A normalized planning knowledge graph.

## Domain model

### PlanningDecision

`PlanningDecision` is the stable project-level record.

- `id`, `projectId`, `schemaVersion`
- `question`, `whyItMatters`, `kind`
- `options[]` with stable IDs, descriptions, and tradeoffs
- optional `recommendation` with option ID, rationale, confidence, model provenance, and evidence refs
- `sourceRefs[]` pointing to spine versions, artifact versions, preflight questions, feedback, or user creation
- `relatedDecisionIds[]`
- `events[]`
- optional `assessments[]`
- creation/update timestamps

The current status and selected answer are projections of append-only events rather than independently mutable truth.

### DecisionEvent

Human and system history uses an append-only event union:

- `created`, `imported`
- `selected`, `custom_answered`
- `deferred`, `premise_rejected`
- `reopened`, `revised`, `superseded`, `invalidated`
- `impact_previewed`, `applied_to_plan`

Each event records an actor (`user`, `synapse`, or `migration`), timestamp, rationale where relevant, the prior event/status when relevant, and related spine/assessment IDs. Only explicit user actions may create user-verdict events.

### DecisionAssessment

Machine assessments remain separate from human status:

- `recommendation`
- `impact_preview`
- `possible_inconsistency`
- `extraction_evidence`

An impact preview records its baseline spine version, proposed structured PRD patch, before/after summaries, affected PRD sections, affected artifact slots, evidence, model/provenance metadata, and `ready | stale | failed | applied | superseded` state.

The UI uses “Possible inconsistency” for semantic planning disagreement. “Conflict” remains reserved for the existing cross-device optimistic-concurrency state.

## Import and compatibility

Existing PRD assumptions are imported lazily from the latest structured PRD when the Decision Center first opens or after a new PRD generation settles. Import is idempotent through a deterministic source key combining the project, source kind, and assumption ID; mutable statement text is not the primary key.

Legacy fields remain readable and are not removed. Existing derived deferred scope and feature confirmations stay visible in the legacy Decision Log during the first release and are not bulk-persisted as new records. This avoids duplicates and silent reinterpretation.

New decisions travel through every existing project persistence boundary:

- Zustand/localStorage
- project bundle extraction, merge, overwrite, change detection, and recovery
- signed-in server synchronization
- owner snapshots
- user namespace reset/import
- foreign-project snapshot restore and ID rewriting
- read-only demo capability guards

The Mongo project document remains an opaque client bundle, so no new endpoint or normalized server collection is required.

## Impact preview and apply

Impact preview has deterministic and model-assisted stages.

Deterministic analysis gathers the current decision, current structured PRD and canonical spine, decision source refs, related decisions, `spineChangeAnalysis`, and the artifact dependency graph. It determines obvious section and artifact affinity without a model call.

Simple assumption confirmation or correction can produce a deterministic patch. Ambiguous cross-cutting decisions use a strong reasoning model to return a schema-constrained patch and explanation. Fast models are reserved for bounded extraction, normalization, classification, dedupe candidates, and source linking.

Apply to plan must:

1. Verify the preview baseline is still the latest spine.
2. Verify the decision projection still matches the previewed answer.
3. Merge the patch over the full structured PRD without dropping omitted fields.
4. Preserve stable feature IDs and all existing user decision fields not explicitly changed.
5. Run required-field, detail-loss, scope, and semantic preservation guards.
6. Rebuild the canonical spine for the new version.
7. Append a new non-destructive PRD version with decision provenance.
8. Append `applied_to_plan` with the resulting spine ID.
9. Re-evaluate dependency impact without regenerating artifacts.

If the baseline changed, the preview becomes stale. If validation fails, no project content changes.

## Required architectural repairs

The feature depends on fixing several existing seams rather than building around them:

- `editSpineStructuredPRD` and PRD revert must rebuild or clear/rebuild canonical-spine metadata so persisted canonical context cannot drift.
- PRD section retry must preserve assumption decisions and feature confirmations instead of replacing them with schema output that omits review fields.
- Branch consolidation must not produce a modern spine with markdown only and no structured PRD.
- Decision-only metadata changes must not claim every artifact has substantive content changes. Impact should use semantic change categories rather than version-ID drift alone.
- The richer dependency-graph evaluation should become the authoritative freshness calculation, with the legacy three-state getter retained as an adapter.

## Interface

Decisions is a `PRD | Decisions` subview inside the Project stage, available before and after finalization. It is not an Asset.

Desktop uses a 280–320px decision queue and one flexible detail pane. The existing branch/history rail collapses while Decisions is active. The detail reading width remains bounded. Source, evidence, relationships, and history use disclosures.

Mobile uses URL-addressable list-to-detail navigation with browser Back support and a sticky action region. It has no permanent queue drawer, KPI strip, or nested scrolling.

Primary views:

- Needs review
- Decision log

The first release shows one factual unresolved count. Search and filters appear only when volume warrants them. Recommendations are visually distinct and never preselected.

## System states

- No decisions detected
- All current decisions reviewed
- Needs review
- Deferred
- Decided, revised, reopened, superseded, or explicitly invalidated
- Preview generating, ready, stale, failed, applied, or superseded
- Possible inconsistency
- Read-only historical PRD/demo
- Local-only/offline save
- Existing cross-device conflict banner
- Loading, mutation failure, and retry

## Accessibility and responsive validation

- Keyboard queue navigation and logical tab order
- Focus transfer to the detail heading
- Visible focus indicators
- Semantic page, queue, and detail landmarks
- Live save/preview status and associated errors
- No color-only meaning
- 44px minimum mobile targets
- No horizontal overflow or clipped sticky actions

Visual QA widths: 360×800, 390×844, 430×932, 768×1024, 1024×768, and 1440×920, plus mobile landscape and 200% zoom.

## AI trust and routing

- Fast model: extraction, classification, normalization, source linking, dedupe candidates, and bounded change classification.
- Strong model: recommendations, nuanced tradeoffs, semantic inconsistencies, ambiguous impact analysis, and structured patch proposals.
- Deterministic code: migrations, projections, state transitions, version checks, validation, dependency traversal, and application.

No model can create a user-confirmed event or apply a patch.

## Validation criteria

- A user can identify what needs attention without reading the full PRD.
- A user can distinguish recommendation, inference, assessment, and confirmed intent.
- Every user decision has durable history and source context.
- A changed decision cannot alter the plan before preview and explicit application.
- A stale preview cannot be applied.
- Apply creates a new PRD version and preserves prior versions and existing artifacts.
- Artifact impact is derived from actual repository dependencies.
- Existing projects and old snapshots load without destructive migration.
- Existing PRD, asset, history, demo, sync, and regeneration flows continue to work.

## Future: Planning Knowledge Graph

The broader future architecture normalizes assertions, decisions, evidence, reviews, risks, constraints, artifacts, and machine assessments into a typed project knowledge graph. It should be pursued only after the Decision Center provides evidence about real relationship volume and after persistence boundaries are declarative rather than manually enumerated.

Prerequisites:

1. Stable IDs for decision-like concepts across PRD and artifact regeneration.
2. One authoritative freshness/impact engine.
3. Typed review and artifact-overlay revisions rather than mutable generic metadata.
4. A declarative project persistence registry.
5. Provenance-safe import and reconciliation services.
6. Bundle-size and history-retention policy.

That future graph would support adversarial critique, build-readiness evaluation, richer impact analysis, assumption validation, and scenario exploration without forcing the first release to migrate every existing concept.
