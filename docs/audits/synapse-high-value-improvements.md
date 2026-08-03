# Synapse High-Value Improvements Audit

## Executive Summary

Synapse already contains several trust-building foundations: progressive PRD generation, section-level retry, source references, version history, a dependency graph, validation warnings, safety gating, and a coding-agent handoff export. The highest-value opportunities are therefore not broad rewrites; they are targeted product changes that make the existing generation pipeline more honest, inspectable, and recoverable for real users.

The biggest trust gap is that Synapse can persist and downstream-use partial or warning-bearing generations without a strong, user-facing quality contract. A PRD with failed sections can still become the source for artifact generation, artifact warnings are mostly metadata rather than workflow gates, dependency context is truncated without provenance or loss indicators, and exports can bundle stale or partial outputs without an explicit manifest. These issues can mislead users because the app often looks successful even when the underlying evidence is incomplete.

The highest-value roadmap is:

1. Add a visible generation quality report for PRDs and artifacts, including completeness, warnings, model repair status, and whether downstream outputs are safe to trust.
2. Gate finalization and artifact generation on PRD completeness, with an explicit override path for intentionally partial PRDs.
3. Add artifact repair/regeneration loops that act on validation warnings instead of only storing them.
4. Make dependency provenance first-class: show exactly which PRD/artifact versions and context slices were used, and flag truncated or missing dependency context.
5. Add export/share manifests that identify version, staleness, partial status, and warnings for every included artifact.

Together, these changes would make Synapse feel less like a black-box generator and more like a professional product specification workbench that is honest about confidence, sources, and failure modes.

## Ranked Improvements

### 1. Add a user-facing PRD and artifact quality report

**Significance:** Critical  
**Complexity:** High  
**Primary value:** Trust, confidence, recovery, artifact quality  
**Affected areas:** PRD generation, artifact generation, UI, persistence, export

**Problem:**  
Synapse records useful quality signals, but they are fragmented and mostly invisible to the user. PRD generation records failed sections in `generationMeta.failedSections`, consistency-review metadata, and per-section statuses. Artifact generation records `validationWarnings` and cross-artifact consistency warnings in version metadata. However, the user does not get a single authoritative quality report that answers: “Is this output complete, what was repaired, what failed, what assumptions were made, and what should I do next?”

**Why this matters:**  
Users trust a generated PRD or artifact only when they can see why it is trustworthy. Without a consolidated quality report, a partially generated PRD, a weakly traceable artifact, or an output with generic language can look almost identical to a clean result. This is especially risky because PRDs become the source of truth for downstream artifacts.

**Evidence in code:**  
- `src/lib/services/progressivePrdPipeline.ts` persists failed PRD sections and consistency-review metadata but treats partial success as a returned result unless all sections fail.
- `src/lib/services/prdConsistencyReview.ts` has strong internal acceptance guards and rejection reasons, but those details are recorded as metadata rather than surfaced as a user-facing quality explanation.
- `src/lib/artifactValidation.ts` computes artifact quality scores and warnings for missing sections, truncation, degenerate repetition, and malformed implementation-plan JSON.
- `src/lib/artifactOrchestration.ts` adds cross-artifact warnings for weak PRD traceability and generic language.
- `src/lib/services/artifactJobController.ts` stores artifact validation warnings in `ArtifactVersion.metadata.validationWarnings`.

**Recommended improvement:**  
Create a persistent `GenerationQualityReport` model for PRD versions and artifact versions. It should include:

- overall status: `ready`, `needs_review`, `partial`, `failed`, `stale`
- completeness: section/artifact coverage and missing inputs
- warnings: validation warnings, generic-language hits, weak traceability, malformed structured payloads
- repairs: JSON repair used, consistency review applied/rejected, retry history
- provenance summary: model(s), generated-at time, source version(s), and dependency context health
- recommended action: retry section, regenerate artifact, review assumptions, update downstream artifacts, or export anyway

Add a “Quality” or “Trust Report” panel next to the PRD and each artifact. Also add a compact status badge in the sidebar and export modal.

**Expected user benefit:**  
Users can quickly distinguish polished outputs from partial or risky ones. They get clear next actions instead of needing to infer risk from raw errors or hidden metadata.

**Risks / tradeoffs:**  
Too many warnings can reduce confidence if they are noisy. Start with high-signal warnings only and group lower-severity diagnostics under “Details.”

**Suggested validation:**  
- Generate a PRD with one forced section failure and verify the PRD displays `partial`, identifies the failed section, and offers retry.
- Generate an artifact with validation warnings and verify the artifact sidebar, artifact page, and export modal all show the same warning state.

### 2. Gate PRD finalization and downstream artifact generation on completeness

**Significance:** Critical  
**Complexity:** Medium  
**Primary value:** Trust, workflow clarity, recovery  
**Affected areas:** PRD generation, finalization, artifact generation, UI

**Problem:**  
The progressive PRD pipeline can return a partial PRD when some sections fail. The app already keeps the progress timeline visible for failed sections and persists failed section IDs, but the broader workflow should more strongly prevent users from unknowingly finalizing or generating downstream artifacts from incomplete requirements.

**Why this matters:**  
A partial PRD can poison every downstream artifact. The user may see a polished markdown document and not realize that architecture, UX loops, metrics, or risks are missing. This is one of the highest-risk ways Synapse can mislead users.

**Evidence in code:**  
- `src/lib/services/progressivePrdPipeline.ts` only throws when every section fails; otherwise it returns a partial PRD and records failed section IDs.
- `src/components/ProjectWorkspace.tsx` computes `persistedFailedSections` and live failed-section state, which means the UI already has the data needed to gate finalization.
- `src/lib/runPrdGeneration.ts` persists partial PRD updates via `onPartial` and final PRD results via `onResult`.
- `src/lib/services/artifactJobController.ts` starts downstream generation from any finalized, non-blocked spine and does not appear to independently reject partial PRDs.

**Recommended improvement:**  
Add a hard “incomplete PRD” gate before Mark Final and before artifact generation. If `generationMeta.failedSections.length > 0`, show:

- failed section names
- what downstream areas may be affected
- a primary “Retry failed sections” action
- a secondary “Continue with incomplete PRD” override that records an explicit provenance flag such as `approvedPartialGeneration: true`

Downstream artifacts generated from an overridden partial PRD should inherit and display that warning.

**Expected user benefit:**  
Users will not accidentally build on incomplete requirements. When they intentionally proceed, the app remains honest and traceable.

**Risks / tradeoffs:**  
A hard gate can frustrate users during transient model outages. The override path is important, but it should be visibly marked and preserved in provenance.

**Suggested validation:**  
- Force one PRD section to fail and verify Mark Final is blocked until retry or explicit override.
- Verify generated artifacts from an overridden partial PRD show a source warning.

### 3. Turn artifact validation warnings into repair and retry workflows

**Significance:** Critical  
**Complexity:** High  
**Primary value:** Artifact quality, recovery, usefulness  
**Affected areas:** artifact validation, artifact generation, UI, persistence

**Problem:**  
Synapse validates artifact outputs and stores warnings, but the pipeline generally saves warning-bearing artifacts as successful versions. There is no automatic repair pass for common issues like weak PRD traceability, generic language, malformed structured plan JSON, repetitive table cells, or missing expected sections.

**Why this matters:**  
Users need artifacts that are directly useful for building. A data model without API mapping, user flows without error paths, or an implementation plan with malformed structured JSON can look professional while being less actionable. Saving these as green “done” outputs undermines trust.

**Evidence in code:**  
- `src/lib/artifactValidation.ts` detects truncated content, missing structure, malformed implementation-plan JSON fences, and degenerate repeated output.
- `src/lib/artifactOrchestration.ts` detects weak PRD traceability and generic language.
- `src/lib/services/artifactJobController.ts` combines those warnings and saves them in metadata while marking the slot `done`.
- `src/lib/services/coreArtifactService.ts` has detailed prompts and schemas for structured outputs, which could support targeted repair prompts.

**Recommended improvement:**  
Introduce a bounded artifact repair loop:

1. Generate artifact.
2. Validate artifact.
3. If high-severity warnings are present, run one targeted repair prompt with the warning list and original output.
4. Re-validate.
5. Save status as `repaired`, `needs_review`, or `failed_quality_gate`.

Start with high-value gates:

- implementation plan structured JSON must parse
- user flows must include error paths
- data model must include API endpoints
- artifacts must mention a minimum threshold of PRD features
- degenerate repetition must be repaired or blocked

Expose “Repair artifact” and “Regenerate from sources” separately. Repair should preserve the artifact’s intent; regenerate should start over from current sources.

**Expected user benefit:**  
Artifacts become more consistently usable, and users get clear recovery options when quality is poor.

**Risks / tradeoffs:**  
Repair calls add latency and cost. Limit to one repair pass and only for warnings that materially affect usefulness.

**Suggested validation:**  
- Inject an implementation plan with malformed structured JSON and verify the repair pass fixes it or marks the artifact `needs_review`.
- Inject a user-flow artifact without error paths and verify the repair prompt adds meaningful error paths.

### 4. Make dependency provenance and context truncation visible

**Significance:** High  
**Complexity:** High  
**Primary value:** Trust, artifact quality, workflow clarity  
**Affected areas:** artifact dependency selection, dependency graph, artifact UI, export

**Problem:**  
Artifact prompts include dependency context, but dependency content is sliced to 1,400 characters and missing dependencies are represented as “Not generated yet.” Users cannot see which parts of upstream artifacts were actually supplied to the model, whether context was truncated, or whether the generated artifact depended on stale/missing context.

**Why this matters:**  
Downstream artifacts are only as good as the context they receive. If an implementation plan receives a truncated screen inventory or a mockup falls back because component inventory failed, users need to know. Otherwise the app may appear deterministic and authoritative while silently using incomplete context.

**Evidence in code:**  
- `src/lib/artifactOrchestration.ts` builds dependency context by slicing dependency artifact content to 1,400 characters and inserting “Not generated yet” for missing dependencies.
- `src/lib/coreArtifactPipeline.ts` defines artifact dependencies and hidden dependency closure rules.
- `src/lib/services/artifactJobController.ts` records upstream artifact versions in `sourceRefs` for generated artifacts and mockups.
- `src/components/dependency/DependencyGraphView.tsx` evaluates source versions and displays graph-level staleness and update recommendations.

**Recommended improvement:**  
Create a dependency context manifest for every generated artifact version:

- exact upstream artifact version IDs used
- context byte/character counts supplied vs. available
- whether context was truncated
- dependency status at generation time: done, missing, errored, stale, hidden
- a short excerpt or structured summary of the supplied context

Show this in the Dependency Graph and artifact detail page. Replace blind `slice(0, 1400)` with artifact-specific extractors that choose high-signal context: screen names and state summaries for UX artifacts, entities/API endpoints for implementation plans, tokens and component semantics for mockups.

**Expected user benefit:**  
Users understand why an artifact says what it says and can identify when regeneration is needed because an upstream source was missing or clipped.

**Risks / tradeoffs:**  
Context manifests add persistence size. Store summaries and counts rather than full duplicated context unless trace/debug mode is enabled.

**Suggested validation:**  
- Generate an implementation plan from a long screen inventory and verify the UI reports truncated context and the selected summary fields.
- Delete or fail an upstream dependency and verify downstream artifacts show a missing-context warning.

### 5. Add export/share manifests that disclose version, staleness, and warnings

**Significance:** High  
**Complexity:** Medium  
**Primary value:** Trust, professionalism, usefulness of generated artifacts  
**Affected areas:** export/share, versioning, staleness, artifact metadata

**Problem:**  
Exports can include PRDs, artifacts, mockups, and an agent handoff, but exported bundles do not include a prominent manifest that identifies what is current, stale, partial, warning-bearing, or generated from incomplete sources.

**Why this matters:**  
Exports are where Synapse’s outputs leave the product and influence real work. If a developer receives a handoff that includes stale artifacts or a PRD with failed sections, the risk is no longer contained inside the app.

**Evidence in code:**  
- `src/components/ExportModal.tsx` builds full bundles, structured JSON, and coding-agent handoffs from latest/preferred content.
- `src/lib/exportHandoff.ts` creates a useful coding-agent preamble but does not include artifact quality, staleness, source versions, or warnings.
- `src/store/slices/stalenessSlice.ts` can evaluate whether an artifact is current or possibly outdated relative to the latest PRD and design-system token hash.
- `src/lib/services/artifactJobController.ts` records `sourceRefs` and validation warnings that exports could surface.

**Recommended improvement:**  
Prepend every full bundle and agent handoff with a “Synapse Export Manifest” containing:

- project name and export timestamp
- PRD version and completeness status
- artifact list with version number, generated date, staleness, quality status, and warning count
- omitted artifacts and why they were omitted
- explicit “Known caveats before building” section

For the coding-agent handoff, include instruction text that tells the agent to treat warnings as constraints and to ask before implementing around incomplete or stale artifacts.

**Expected user benefit:**  
Users and downstream developers can trust the handoff because it discloses its limits. Synapse feels more professional and accountable.

**Risks / tradeoffs:**  
Manifests add length to exports. Keep the top summary concise and link/anchor to detailed warnings later in the document.

**Suggested validation:**  
- Export a project with one stale artifact and verify the manifest flags it.
- Export a partial PRD and verify the manifest identifies failed sections before the PRD content.

### 6. Add source-aware compare views for PRDs and artifacts

**Significance:** High  
**Complexity:** High  
**Primary value:** Trust, safe editing, recovery  
**Affected areas:** versioning, PRD editing, artifact regeneration, dependency graph

**Problem:**  
Synapse has version history, restore behavior, and comparison UI, but users need more source-aware comparisons: what changed in the PRD, which downstream artifacts became stale, which feature/entity/screen references were added or removed, and whether an artifact regeneration improved or degraded quality.

**Why this matters:**  
Users refine product specs iteratively. Trust depends on knowing whether a change safely improves the product or invalidates downstream work. A plain text diff is not enough for product artifacts with dependency relationships.

**Evidence in code:**  
- `src/store/slices/spineSlice.ts` appends new spine versions for edits and retries, preserving provenance.
- `src/store/slices/artifactSlice.ts` appends new artifact versions and supports revert by cloning a historical version.
- `src/lib/versionDiff.ts` exists for version diffing.
- `src/components/versions/VersionHistoryPanel.tsx` and `src/components/versions/VersionCompareView.tsx` provide version-history UI.
- `src/components/dependency/DependencyGraphView.tsx` already computes downstream impact and update order.

**Recommended improvement:**  
Add semantic compare summaries:

- PRD: added/removed/changed features, risks, entities, assumptions, success metrics
- artifacts: changed screens, flows, entities, milestones, prompt packs, quality gates
- impact: downstream artifacts that should be regenerated because of the change
- quality delta: warnings added/resolved, traceability improved/degraded

Show these summaries before restore/regenerate actions and after AI section retries.

**Expected user benefit:**  
Users can edit and refine safely, understand consequences, and recover from bad generations without guesswork.

**Risks / tradeoffs:**  
Semantic diffs can be noisy for large markdown artifacts. Start with structured PRD fields and structured artifacts first, then fallback to markdown diff.

**Suggested validation:**  
- Edit a PRD feature name and verify compare identifies the feature change and downstream impacted artifacts.
- Regenerate an artifact and verify quality delta reports warnings resolved or introduced.

### 7. Strengthen PRD confidence with explicit assumptions, unknowns, and evidence gaps

**Significance:** High  
**Complexity:** Medium  
**Primary value:** Trust, PRD quality, workflow clarity  
**Affected areas:** preflight, prompt construction, PRD rendering

**Problem:**  
Preflight captures clarifications, assumptions, and unknowns, but the final PRD experience should make evidence gaps more explicit. Users need to know which requirements are grounded in their answers, which are model assumptions, and which remain unresolved.

**Why this matters:**  
A polished PRD can overstate certainty. Trustworthy product work distinguishes known decisions from assumptions and open questions. This is especially important when users skip clarification questions or use fallback questions.

**Evidence in code:**  
- `src/lib/services/preflightService.ts` generates clarification questions and summaries, falling back to generic questions or local summary when model calls fail.
- `src/components/preflight/PreflightView.tsx` lets users skip questions and passes skipped answers into PRD generation context.
- `src/lib/prompts/prdSectionPrompts.ts` constructs PRD section prompts using upstream/preflight context.
- `src/components/StructuredPRDView.tsx` renders the final structured PRD.

**Recommended improvement:**  
Add an “Assumptions & Unknowns” contract to the PRD:

- clearly separate user-confirmed decisions, model-assumed decisions, and unresolved questions
- attach assumptions to affected features/artifacts where possible
- display a confidence indicator based on skipped questions, fallback preflight use, missing answers, and failed sections
- allow users to resolve an unknown and regenerate only affected PRD sections/artifacts

**Expected user benefit:**  
Users can trust that Synapse is not hiding uncertainty behind confident prose, and they can improve the PRD through focused clarification.

**Risks / tradeoffs:**  
Too much uncertainty UI can feel negative. Frame it as “Confidence checklist” and “Decisions to confirm.”

**Suggested validation:**  
- Skip several preflight questions and verify the final PRD displays unresolved questions and reduced confidence.
- Answer a previously unresolved question and verify affected sections can be regenerated.

### 8. Improve recovery from interrupted or partial artifact generation

**Significance:** High  
**Complexity:** Medium  
**Primary value:** Recovery, workflow clarity, trust  
**Affected areas:** artifact job controller, progress states, UI

**Problem:**  
The artifact pipeline has cancellation, interruption marking, retry caps, and per-slot statuses, but recovery could be more guided. Users need a clear “resume exactly what is missing or failed” path, especially because hidden artifacts can affect visible outputs.

**Why this matters:**  
Network/API interruptions are common in generation-heavy apps. If recovery feels ambiguous, users may regenerate too much, lose confidence, or unknowingly use incomplete downstream outputs.

**Evidence in code:**  
- `src/lib/services/artifactJobController.ts` manages active runs, cancellation, hidden dependency closure, retry caps, and interrupted states.
- `src/store/interruptedGeneration.ts` converts stuck PRD generations into settled errors on rehydration.
- `src/components/ArtifactWorkspace.tsx` renders slot statuses and a combined Screens status dot for screen inventory plus mockup generation.
- `src/components/GenerationProgress.tsx` displays generation progress states.

**Recommended improvement:**  
Add a recovery command center in the workspace:

- “Resume missing outputs” for slots not done for the current PRD version
- “Retry failed outputs” for errored visible and hidden dependencies that block visible outputs
- “Regenerate impacted outputs” for stale outputs
- clear explanation of what will be reused vs regenerated

When a hidden dependency fails, surface it under the visible artifact it affects rather than hiding the reason.

**Expected user benefit:**  
Users can recover from partial generations without understanding internal slot topology.

**Risks / tradeoffs:**  
Combining hidden and visible dependencies in UI can be confusing. Present hidden artifacts as “supporting generation step” rather than as first-class workspace items.

**Suggested validation:**  
- Force `component_inventory` to fail and verify the Screens/mockup area explains that a supporting generation step failed and offers a targeted retry.
- Cancel artifact generation midway and verify resume only queues missing/interrupted slots.

### 9. Make progress states explain real work, dependencies, and partial success

**Significance:** Medium  
**Complexity:** Medium  
**Primary value:** Workflow clarity, trust, perceived professionalism  
**Affected areas:** PRD progress, artifact progress, dependency graph, mobile UX

**Problem:**  
Synapse tracks rich progress events, estimates, dependencies, and model choices, but progress UI should more directly explain why work is waiting, what is running in parallel, and when an output is only partially available.

**Why this matters:**  
Professional generation tools reduce anxiety by explaining what they are doing. Users are more patient and trusting when progress states are specific and honest.

**Evidence in code:**  
- `src/lib/services/progressivePrdPipeline.ts` emits section statuses with tiers, estimates, dependencies, and progress messages.
- `src/components/progress/buildGenerationSteps.ts` and `src/components/progress/ProgressTimeline.tsx` build and display PRD generation progress.
- `src/components/ArtifactWorkspace.tsx` includes a combined `ScreensStatusDot` because screen inventory and mockups finish at different times.
- `src/lib/services/artifactJobController.ts` appends per-slot progress messages.

**Recommended improvement:**  
Enhance progress displays with:

- “waiting on” dependency labels for PRD sections and artifacts
- partial availability states such as “screen breakdown ready, mockups still rendering”
- expected next action after failures
- model tier labels only where meaningful to users, not as raw provider jargon
- mobile-friendly compact state summaries

**Expected user benefit:**  
Users understand the workflow and avoid mistaking partial completion for final completion.

**Risks / tradeoffs:**  
Over-detailed progress can overwhelm. Use progressive disclosure: compact summary by default, details expandable.

**Suggested validation:**  
- Run artifact generation and verify dependent artifacts show “waiting on Screen Inventory” before they start.
- Verify mobile shows the same partial/failed status information without requiring horizontal scanning.

### 10. Add owner/debug tooling that turns traces into user-supportable diagnoses

**Significance:** Medium  
**Complexity:** Medium  
**Primary value:** Trust, recovery, operational professionalism  
**Affected areas:** LLM tracing, metrics, debug tools, support flows

**Problem:**  
Synapse has trace sessions and workflow metrics, but owner/debug tooling should connect traces, quality warnings, source refs, and user-visible failures into concise diagnoses. Today the diagnostics are useful for developers but not yet a support workflow.

**Why this matters:**  
For real users, failures will involve provider keys, quotas, model responses, sync, or partial generations. Support needs a safe way to understand what happened without asking users for screenshots of multiple panels or exposing sensitive prompts unnecessarily.

**Evidence in code:**  
- `src/lib/trace/traceRecorder.ts`, `src/lib/trace/traceSessions.ts`, and `src/components/developer/LlmTraceViewerPage.tsx` provide LLM trace infrastructure.
- `src/lib/metrics/buildWorkflowRun.ts` and metrics components record and display workflow runs.
- `src/lib/trace/traceRedaction.ts` exists for trace redaction.
- `src/lib/errors.ts` normalizes user-facing error categories.

**Recommended improvement:**  
Add a “Copy diagnostic summary” action for failed or warning-bearing runs. Include:

- project/run IDs
- generation stage and failed sections/slots
- normalized error categories
- models used and timing
- quality warnings
- source refs and staleness state
- redacted trace IDs, not full prompt content by default

Also add owner-only filters in the Trace Viewer for “failed runs,” “warnings,” and “partial PRDs.”

**Expected user benefit:**  
Users get faster help, and owners can debug reliability issues without breaching trust or privacy.

**Risks / tradeoffs:**  
Diagnostics can leak sensitive product ideas if not redacted. Default to IDs, categories, and summaries; require explicit user export for full traces.

**Suggested validation:**  
- Trigger a provider error and verify the diagnostic summary contains error category, failed stage, and no raw secret values.
- Verify trace export redaction still removes sensitive fields.

### 11. Improve mobile artifact review and action safety

**Significance:** Medium  
**Complexity:** Medium  
**Primary value:** Workflow clarity, recovery, perceived professionalism  
**Affected areas:** mobile UX, artifact workspace, versioning, dependency graph

**Problem:**  
The app has mobile-aware components, but the highest-trust actions—review warnings, compare versions, regenerate impacted artifacts, inspect dependencies, and export—need to be especially clear on small screens.

**Why this matters:**  
Mobile users are more likely to miss subtle status badges, hidden sidebars, dependency details, or version warnings. That increases the chance of acting on stale or partial outputs.

**Evidence in code:**  
- `src/components/ArtifactWorkspace.tsx` has mobile drawer behavior and auto-open intent.
- `src/lib/useIsMobile.ts` supports mobile-specific rendering.
- `src/components/MobileSelectionToolbar.tsx` exists for mobile selection actions.
- `src/components/dependency/DependencyGraphView.tsx` is information-dense and central to safe regeneration decisions.

**Recommended improvement:**  
Add a mobile “Review & Actions” sheet for each artifact:

- current quality/staleness status
- latest warning summary
- source versions used
- primary action: retry/repair/update/export
- secondary action: compare/history

For the dependency graph, provide a list-first impact view on mobile rather than relying on graph geometry.

**Expected user benefit:**  
Mobile users can make safe decisions without hunting through sidebars or dense graph views.

**Risks / tradeoffs:**  
Duplicating desktop controls can create divergent behavior. Reuse the same underlying quality report and action definitions.

**Suggested validation:**  
- On a narrow viewport, verify stale artifacts expose update and compare actions without opening the full graph canvas.
- Verify warning-bearing artifacts show the same top warning on mobile and desktop.

### 12. Make coding-agent handoffs self-contained, caveated, and source-linked

**Significance:** Medium  
**Complexity:** Low  
**Primary value:** Usefulness of generated artifacts, trust, professionalism  
**Affected areas:** export/share, implementation plan, prompt packs

**Problem:**  
The coding-agent handoff is valuable, but it should be more explicit about source hierarchy, caveats, stale/partial status, and how to handle conflicts between artifacts. It currently says to treat PRD as source of truth and follow the implementation plan, but it does not include a generated source manifest or conflict-resolution rules tied to actual artifact versions.

**Why this matters:**  
The handoff is likely the most practically useful Synapse artifact. Developers and coding agents need clear instructions when the PRD, data model, screens, and implementation plan disagree or when some artifact is stale.

**Evidence in code:**  
- `src/lib/exportHandoff.ts` builds the handoff preamble and includes PRD plus artifacts.
- `src/components/ExportModal.tsx` offers “Copy for coding agent” and “Export Full Bundle.”
- `src/lib/services/coreArtifactService.ts` instructs implementation-plan prompt packs to be self-contained and agent-agnostic.

**Recommended improvement:**  
Enhance the handoff preamble with:

- source priority rules: PRD > latest artifact manifest > implementation plan details > prompt packs
- conflict handling: stop and ask when artifacts disagree on scope, entities, or screens
- stale/partial caveats from the export manifest
- version table with artifact versions and generated timestamps
- explicit instruction to preserve feature IDs and named entities from the PRD

**Expected user benefit:**  
Handoffs become safer to paste into coding agents and less likely to produce implementation drift.

**Risks / tradeoffs:**  
Longer handoffs can be less convenient. Put the concise rules first and detailed manifest below.

**Suggested validation:**  
- Export a handoff and verify it includes source priority, conflict rules, artifact versions, and warning caveats.
