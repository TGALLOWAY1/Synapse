# Canonical PRD Spine

Status: Phase 1 (introduce + prioritize; full PRD markdown kept as fallback).

## Problem

Downstream core-artifact generation historically received several overlapping
views of the same PRD, concatenated into one prompt (`generateCoreArtifact` in
`src/lib/services/coreArtifactService.ts`):

1. Narrative guardrails (`buildNarrativeGuardrails`)
2. **Canonical Feature Glossary** (`buildFeatureGlossary`)
3. An inline **structured PRD summary** (`prdSummary`, built ad-hoc from a
   subset of `StructuredPRD`)
4. **Dependency artifacts** (`buildDependencyContext`)
5. **Full PRD markdown** (`spine.responseText`, injected verbatim)
6. Subtype-specific steering (e.g. the design-system preset directive)

The feature glossary and the inline PRD summary duplicated each other (both
listed feature ids/names/descriptions) and neither captured the premium
`StructuredPRD` fields (jtbd, uxPages, domainEntities, successMetrics,
architecture flows, safety restrictions, design direction). Artifacts had to
re-interpret and re-summarize the PRD, which is a standing source of drift and
inconsistent terminology across artifacts.

## Current flow (audit)

- **Entry:** `artifactJobController.startAll(StartArgs)` where
  `StartArgs = { projectId, spineVersionId, prdContent, structuredPRD, projectPlatform? }`.
  `prdContent` is `SpineVersion.responseText` (rendered markdown);
  `structuredPRD` is `SpineVersion.structuredPRD`.
- **Per-slot:** `executeJob` → `runCoreArtifactSlot` reads the project's
  `designSystemPreset` off the store and calls
  `generateCoreArtifact(subtype, prdContent, structuredPRD, { designSystemPreset, generatedArtifacts, ... })`.
- **Prompt assembly** (`coreArtifactService.ts`): the user prompt was
  `userPrefix + guardrails + "Canonical Feature Glossary" + "Dependency Artifacts" + prdSummary + presetSection + "Full PRD" + mockupSection`.
- **Persistence:** each artifact version stores a single `sourceRef` of
  `sourceType: 'spine'` pointing at the spine version id; `metadata` carries
  `{ subtype, dependencyTrace, validationWarnings }` (+ design tokens for
  design_system).
- **Safety:** `SpineVersion.safetyReview` (`SpineSafetyReview`). A `blocked`
  status gates all downstream generation (`startAll` early-returns). A
  `restricted` status means the PRD was generated under a restriction directive
  (`buildRestrictionDirective`).
- **Design direction:** `Project.designSystemPreset` → concrete
  `DesignSystemPreset` (`getDesignSystemPreset`) carrying `directive`, `tone`,
  `visualTraits`.

## Design

A **Canonical PRD Spine** (`src/lib/canonicalPrdSpine.ts`) is a compact,
structured, deterministic contract built from the finalized `StructuredPRD`
(after the silent consistency review). It becomes the **primary** source of
truth for artifact generation; full PRD markdown stays as a lower-priority
fallback during this first migration.

- **Type:** `CanonicalPrdSpine` in `src/types/index.ts` — product identity,
  target users / JTBD, canonical feature glossary (PRD feature ids preserved),
  screen seeds (deterministic `scr-<slug>` ids), entity seeds (deterministic
  `ent-<slug>` ids), constraints, safety restrictions, architecture direction,
  design direction, plus a `meta` block (schema version, source spine id,
  validation result).
- **Builder:** `buildCanonicalPrdSpine(prd, options)` — pure, deterministic, no
  LLM call. Screen/entity seeds are conservatively derived from existing
  structured fields (uxPages / userLoops for screens; domainEntities /
  richDataModel for entities); it does not invent a full inventory.
- **Validation:** `validateCanonicalPrdSpine` — deterministic, non-invasive;
  warnings are recorded in the spine `meta`, never silently dropped.
- **Persistence:** `SpineVersion.canonicalSpine` is attached on final settle
  (in `updateSpineStructuredPRD` when `generationMeta` is present). Old
  projects have none; artifact generation rebuilds the spine lazily from the
  stored `structuredPRD`, so backwards compatibility is automatic.
- **Prompt order:** persona/system → guardrails → **Canonical PRD Spine
  (authoritative)** → dependency artifacts → **Full PRD (secondary fallback)**.
  The separate feature glossary and inline PRD summary are removed when a spine
  is present (the spine subsumes both).
- **Diagnostics:** each artifact version records `spineContextUsed` and
  `spineSchemaVersion` in `metadata`.
