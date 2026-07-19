# Safety Gate & Artifact Validation

> Extracted from CLAUDE.md. The PRD safety classifier chokepoint, blocking vs advisory artifact validation, traceability repair, and the dependency sufficiency gate.

### Safety gate (`src/lib/safety/`)

Every PRD generation path runs through one chokepoint —
`generateStructuredPRD()` in `prdService.ts` — which calls
`classifyProjectSafety()` **before** any section runs. This is a hard,
**code-level** guardrail (not just a prompt): it stops Synapse from emitting a
malformed PRD where each section independently refuses ("I cannot fulfill this
request…").

- The classifier (`classifyProjectSafety.ts`) returns a `SafetyClassificationResult`
  (`allowed` | `allowed_with_restrictions` | `disallowed`) via Gemini JSON mode
  (`schemas/safetySchemas.ts`). Transport is injectable for tests.
- **`safetyPolicy.ts` is the single source of the policy TEXT.** The
  disallowed-capability list, the classifier system instruction, the in-prompt
  `SAFETY_OVERRIDE` (re-exported via `prompts/prdPrompts.ts`), and the two
  concern-summary fallbacks in `safetyReviewArtifact.ts` all render from this
  one module — they used to be four independently-drifting literals. Edit the
  policy there, never inline at a surface; `safetyPolicy.test.ts` asserts every
  surface carries every capability term.
- **`disallowed`** → `generateStructuredPRD` throws `SafetyBlockedError`; the
  pipeline never runs. Call sites (`HomePage`, `ProjectWorkspace.handleRegenerate`)
  catch it and persist a `blocked` `SpineVersion.safetyReview` (+ a canonical
  Safety Review markdown as `responseText`) via `setSpineSafetyReview`.
- **`allowed_with_restrictions`** → a restriction directive is appended to the
  prompt; the run records a `restricted` review and the PRD renders with a
  `SafetyBoundariesCard`.
- **Fail-closed:** if classification can't be determined (non-config transport
  error or unparseable output) the request is treated as `disallowed`. Genuine
  *config* errors (api key / auth / billing / permissions) are re-thrown to the
  normal error path.
- **UI / downstream gating keys off `SpineVersion.safetyReview.status === 'blocked'`:**
  `ProjectWorkspace` renders `SafetyReviewView` instead of the PRD,
  `handleToggleFinal` no-ops, the workspace render guard excludes it, and
  `artifactJobController.startAll` early-returns — so a blocked spine can never
  drive workspace/screens/architecture/implementation artifacts. Domain types
  (`SafetyClassification`, `SafetyClassificationResult`, `SpineSafetyReview`)
  live in `src/types`; the safety module re-exports them.

### Artifact validation: blocking vs advisory (`src/lib/artifactBlockingValidation.ts`)

Most artifact validation is **advisory** — `validateArtifactContent` /
`validateCrossArtifactConsistency` produce warnings stamped into
`ArtifactVersion.metadata.validationWarnings` but never change status. A narrow,
high-confidence set of defects is **blocking**: `detectArtifactBlockers(subtype,
content, prd)` (pure) flags (1) a `data_model` with no API surface, (2)
`user_flows` with no error paths, (3) an implementation-critical artifact
(`data_model`/`user_flows`/`implementation_plan`) that references **none** of the
PRD features (no traceability), and (4) a JSON-mode artifact
(screen/data/component inventory) that parses but is structurally empty. When
blockers exist, `runCoreArtifactSlot` still **saves the version** (content
preserved for review) but stamps `metadata.validationBlockers` and sets the slot
status to the new `GenerationStatus` value **`needs_review`** instead of `done`.
The state is durable: `ArtifactWorkspace.slotStatusFor` re-derives `needs_review`
from `readValidationBlockers(preferred.metadata)` after the transient job slot is
cleared (post-reload). UI: an amber `ShieldAlert` `StatusDot` + an in-view
"Needs review" banner listing the issues with a Regenerate action. Keep the
blocker list conservative — advisory warnings must stay non-blocking.

**Automatic traceability repair — never surface a "no traceability" blocker
before attempting repair** (`src/lib/artifactTraceabilityRepair.ts`, pure).
Blocker (3) — missing PRD-feature traceability — is often a false positive: an
artifact genuinely derived from the product's features but not spelling out a
feature id/name verbatim. So `runCoreArtifactSlot` reclassifies blockers via
`classifyBlockers` and, when the traceability blocker is the **sole** issue (the
artifact is otherwise structurally valid — `otherBlockers.length === 0`),
attempts a deterministic enrichment pass **before** exposing any blocker:
`repairTraceability` runs `matchFeaturesToContent` (token-overlap match of the
canonical PRD features against the artifact's own content — it can NEVER invent
an id, every mapped id/name comes from `prd.features`) and, on a confident
match, **appends** a `## PRD Feature Traceability` section citing the mapped
ids/names (append-only — substantive content is never rewritten). The artifact
is then **re-validated**; if clean it saves as normal `done`, and a small
neutral advisory note (not the amber banner) is shown. Repair provenance is
stamped into version metadata regardless of outcome (`repairAttempted`,
`repairType: 'traceability_enrichment'`, `repairSucceeded`,
`originalValidationBlockers`, `postRepairValidationBlockers`, `repairWarnings`,
`traceabilityMappedFeatures`) and the version's change summary notes the
enrichment, so history distinguishes an original vs. auto-enriched preferred
version. When repair is **ineligible** (other blockers present) or **fails** (no
confident feature match), the slot stays `needs_review` but the raw blocker is
reworded to the clearer `TRACEABILITY_UNRESOLVED_MESSAGE` ("Synapse could not
verify how this artifact maps back to the PRD…") rather than "references none of
the PRD features". Only the initial validation is stricter now-structural:
traceability is emitted **structurally** by generation (data_model entities carry
`featureRefs`, rendered as a `**Related Features:**` line; user_flows emit a
`**Related Features:**` line per flow; implementation_plan carries per-task
`linkedArtifacts.prd` in its `synapse-plan` JSON fence), reducing how often
repair is even needed. Legacy artifacts are unaffected on load — blockers are
only computed at generation time and read from persisted metadata, so an old
artifact without structured traceability never shows a blocking banner unless it
is regenerated/revalidated.

### Dependency sufficiency gate (`src/lib/artifactDependencyGate.ts`)

An artifact must not silently generate from missing/errored **required** upstream
dependencies (which previously produced degraded output behind a soft "Not
generated yet." placeholder). `REQUIRED_DEPENDENCIES` (`coreArtifactPipeline.ts`,
a conservative subset of each subtype's `dependsOn`: `user_flows` ←
`screen_inventory`; `implementation_plan` ← `screen_inventory` + `data_model`)
declares which deps block. `generateCoreArtifact` calls
`assertDependenciesSufficient(subtype, generatedArtifacts, { allowMissing })`
**before any model call** — a missing required dep throws
`DependencyInsufficiencyError` (surfaced as a slot error) unless
`allowMissingDependencies` acknowledges degraded generation. The happy path never
false-blocks because `buildDependencyLayers` runs required deps in an earlier
layer. `runCoreArtifactSlot` stamps `metadata.dependencyStatus`
(`complete`/`degraded`) + `missingRequiredDependencies`. `buildDependencyContext`
labels required deps `(REQUIRED)` and, when one is absent, emits an explicit
**MISSING** notice instead of "Not generated yet.". Screen-inventory dependency
context is summarized via `summarizeScreenInventoryDependency`, which emits the
**full screen roster (every id/name) first, never truncated**, then truncates the
verbose prose — so downstream artifacts never lose a screen reference to a long
prose cut.

