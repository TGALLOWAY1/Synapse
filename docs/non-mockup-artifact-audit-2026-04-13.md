# Synapse Non-Mockup Artifact Audit — 2026-04-13

## 1. Executive summary
Synapse already generated all required non-mockup artifact types, but orchestration quality was uneven before this audit. The biggest legitimacy risk was that bundle generation treated artifacts as mostly independent outputs, allowing naming drift, weak feature traceability, and inconsistent specificity. This pass implemented a dependency-aware pipeline, shared grounding context, cross-artifact consistency checks, and normalization so outputs read as one connected product definition narrative.

## 2. Pipeline map (non-mockup artifacts)
Current pipeline (post-fix):

1. Structured PRD (`generateStructuredPRD`)
2. Screen Inventory
3. User Flows (grounded on Screen Inventory)
4. Component Inventory (grounded on Screen Inventory + User Flows)
5. Data Model (grounded on User Flows)
6. Implementation Plan (grounded on Component Inventory + Data Model)
7. Design System (grounded on Component Inventory)
8. Prompt Pack (grounded on Implementation Plan + Design System + Data Model)

Storage/rendering path:
- Every generation creates an `ArtifactVersion` linked to a source PRD spine version.
- Structured JSON artifacts are normalized to markdown and stored in version content.
- Rendering uses markdown fallback with subtype-aware renderers when JSON is available.

## 3. Per-artifact audit
### PRD
- Strengths: Has schema constraints (vision, users, problems, features, risks, NFRs, constraints).
- Gaps before fix: downstream prompts did not consistently enforce feature ID reuse.
- Improvement: Canonical feature glossary now injected into every artifact generation prompt.

### User flows
- Strengths: Prompt included goals, steps, decision points, error paths.
- Gaps before fix: could drift from generated screen names.
- Improvement: explicit dependency context from Screen Inventory is now injected.

### Architecture / implementation plan
- Strengths: milestone structure existed.
- Gaps before fix: roadmap could read generic and detached from data/component artifacts.
- Improvement: implementation plan prompt now requires traceability map to feature IDs and receives dependency artifacts.

### Data models
- Strengths: JSON schema for entities/fields/relationships.
- Gaps before fix: API mapping could be omitted or shallow.
- Improvement: consistency validator now flags missing API surface mapping.

### API specs
- Current representation: embedded in Data Model (`apiEndpoints`) rather than standalone artifact.
- Risk: users may perceive API design as under-specified.
- Current mitigation: stronger data model checks and prompt constraints.

### Task breakdown (implementation plan)
- Strengths: milestone checklist format.
- Gaps before fix: no enforced tie-back to features.
- Improvement: required traceability map + dependency grounding.

## 4. Cross-artifact consistency analysis
Pre-fix failure mode: bundle generation executed with concurrency and no artifact-to-artifact grounding context, so each output could be coherent locally but inconsistent globally.

Post-fix controls:
- Deterministic dependency graph (`CORE_ARTIFACT_PIPELINE`)
- Canonical feature glossary shared across all generations
- Dependency artifact excerpt injection per subtype
- Consistency validator for feature propagation and generic language

## 5. Key trust-breaking issues
1. **Independent-generation feel in bundle mode**
   - User saw artifacts with different naming for same concept.
   - This looked like stitched AI outputs, not orchestration.
2. **Weak feature propagation checks**
   - Feature IDs from PRD could disappear in downstream docs.
   - Reduced confidence that outputs were implementation-ready.
3. **Formatting variation**
   - Inconsistent spacing and markdown shape made artifacts look drafty.
   - Hurt perceived production quality.

## 6. Root causes
- Missing orchestration layer for inter-artifact grounding.
- Prompt design emphasized per-artifact quality but not pipeline coherence.
- Validation focused on per-document shape, not cross-artifact logic.
- No normalization pass to smooth formatting variability.

## 7. Recommended direction
- Keep a shared ontology centered on PRD feature IDs and canonical names.
- Expand dependency-aware generation to stale refresh and refine flows.
- Add standalone API spec artifact if recruiter-facing credibility is a priority.
- Introduce stricter regeneration gates (auto-retry on severe consistency warnings).

## 8. Implementation plan
Files modified in this pass:
- `src/lib/coreArtifactPipeline.ts`
- `src/lib/artifactOrchestration.ts`
- `src/lib/services/coreArtifactService.ts`
- `src/components/ArtifactsView.tsx`
- `docs/artifact-flow.md`
- `src/lib/__tests__/artifactOrchestration.test.ts`

Execution steps:
1. Add central dependency graph and metadata.
2. Inject glossary + dependency context into all artifact prompts.
3. Normalize generated markdown for consistent rendering.
4. Add cross-artifact consistency validator and surface warnings.
5. Switch bundle generation from concurrent independent jobs to dependency-ordered generation.
6. Add tests for orchestration helper behavior.

## 9. Changes made
- Added dependency graph and artifact metadata constants.
- Added orchestration helper module (grounding context, normalization, consistency checks).
- Strengthened prompts for user flows, implementation plans, data models, and prompt packs.
- Updated bundle generator to pass generated artifact context downstream in sequence.
- Added consistency warnings to UI warning state.
- Updated artifact flow documentation to match actual behavior.

## 10. Verification results
Verification executed with local tests and static checks:
- Unit tests validate normalization and consistency detection behavior.
- Build/lint verifies type integrity and integration.
- Manual dry-run analysis confirms bundle execution now follows dependency order and stores dependency trace metadata.

## 11. Remaining weaknesses
- No dedicated API spec artifact yet (API remains nested in data model).
- Refine and stale-refresh paths still provide limited dependency context compared to full bundle.
- Consistency checks are heuristic; they should evolve toward schema-level semantic validation.

## 12. Final verdict on overall artifact quality and system legitimacy
Synapse now presents a more credible orchestration story for non-mockup artifacts. The pipeline behavior is materially closer to a coordinated product definition engine than a set of loosely related LLM outputs. Remaining gaps are tactical (API artifact granularity, stronger semantic validators), not foundational.
