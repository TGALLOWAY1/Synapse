# Synapse Risk Audit

## Executive Summary

Synapse has several strong safeguards already: session-gated project APIs, per-user local persistence namespaces, additive server pull, versioned PRDs/artifacts, safety gating before PRD generation, and source refs for artifact staleness. The most important remaining risks are not broad architecture issues; they are specific places where the product can silently present incomplete or stale work as usable, or where recovery/sync semantics can mislead users.

Highest-risk findings:

1. Partial PRD generation can still become the latest persisted PRD when only some sections fail. That is useful for resilience, but today it can look like a successful PRD and seed downstream artifacts.
2. Artifact generation records validation and consistency problems as metadata warnings but still marks artifacts `done` and preferred, allowing weak artifacts to reach users without an obvious quality gate.
3. Cloud sync is additive and local-first but has no per-project conflict resolution for projects that exist both locally and remotely; edits on another device can be ignored and then overwritten by later local saves.
4. Dependency context for downstream artifacts is aggressively truncated and can be missing; when this happens the generation still proceeds, risking downstream artifacts built from partial inputs.
5. Persistence relies on one debounced localStorage blob; quota protection exists, but successful local writes do not imply cloud durability and unsaved local changes can remain vulnerable across devices.

## Top Risks

### 1. Partial PRD generation can be persisted and treated as successful

**Severity:** Critical  
**Area:** LLM orchestration / PRD quality / recovery  

**Why it matters:** A PRD is the root source for every downstream artifact. If one or two high-signal sections fail, Synapse can still render and persist the merged PRD from the remaining sections. Users may not notice which sections are missing before generating mockups, data models, implementation plans, and exports from a weakened source artifact.

**Evidence:** `runProgressivePrdPipeline` only throws when every section fails; otherwise it logs a warning and returns a partial PRD. The consistency review is skipped when any section failed, but the partial PRD still continues to markdown/result creation. Evidence paths: `src/lib/services/progressivePrdPipeline.ts`, especially the failed-section handling and all-failed-only throw around lines 244-320. `ProjectWorkspace` writes partial section updates to the active spine through `onPartial` during generation and writes the final result in `onResult`. Evidence paths: `src/components/ProjectWorkspace.tsx`, around lines 321-361.

**Failure mode:** A transient Gemini error, timeout, rate limit, or schema parse failure affects a non-trivial section such as features, data model, or metrics. Because not all sections failed, Synapse returns a PRD and marks generation complete. The user sees a polished document, not an explicit “incomplete PRD” gate, and downstream artifacts are generated from it.

**Recommended fix:** Treat partial PRDs as a distinct persisted state, not a normal final PRD. Minimal remediation:

- Persist `generationMeta.failedSections` prominently on the spine.
- Block automatic downstream artifact generation when any required PRD section failed.
- Offer targeted retry for failed sections before “Finalize / Generate artifacts.”
- If you intentionally allow partial continuation, require explicit user acknowledgement and stamp downstream artifacts with “generated from incomplete PRD.”

**Suggested validation:** Add a focused regression test where one required PRD section fails and verify that the resulting spine is not treated as final/ready for artifact generation without explicit acknowledgement.

### 2. Artifact validation warnings do not prevent weak artifacts from becoming preferred

**Severity:** High  
**Area:** Artifacts / validation / user trust  

**Why it matters:** The audit found validation and cross-artifact consistency checks, but they currently act as passive metadata. An artifact can fail meaningful quality expectations, be saved as the preferred version, and show as `done`. This creates a high-trust failure: the UI says the artifact is complete while the code already detected concerns.

**Evidence:** `runCoreArtifactSlot` calls `validateArtifactContent` and `validateCrossArtifactConsistency`, combines warnings, then still creates a new artifact version and sets slot status to `done`. Evidence path: `src/lib/services/artifactJobController.ts`, around lines 203-240 and the subsequent save/status path. Cross-artifact warnings include weak feature traceability, generic language, missing API mapping for data models, and missing error paths for user flows. Evidence path: `src/lib/artifactOrchestration.ts`, around lines 81-103.

**Failure mode:** A data model omits API surface mapping, a user-flow artifact omits error paths, or an artifact barely references PRD features. Synapse records warnings in metadata but still makes that version preferred. The user exports or relies on it without seeing a blocking or review-required state.

**Recommended fix:** Split validation output into blocking vs advisory findings. Keep advisory warnings non-blocking, but make known user-facing defects block “done” status or show an explicit “needs review” state. Start with narrow blockers only:

- `data_model` missing API surface mapping.
- `user_flows` missing error paths.
- Traceability below a strict threshold for implementation-critical artifacts.
- JSON-mode artifacts that parse but are structurally empty.

**Suggested validation:** Add targeted tests for one blocker per critical artifact type, verifying that invalid output does not become preferred `done` content.

### 3. Same-project cross-device conflicts can be silently ignored and later overwritten

**Severity:** High  
**Area:** Persistence / cloud sync / data integrity  

**Why it matters:** Synapse markets durable, cross-device project persistence. The sync layer deliberately avoids destructive pulls, which is good, but if a project exists both locally and on the server, the current reconcile does not compare revisions or merge newer remote slices. That means another device’s edits can be invisible on this device and then overwritten on the next local save.

**Evidence:** Reconcile pulls only server projects whose ids are missing locally; existing local ids win. `mergeBundlesIntoSource` explicitly skips any bundle whose id is already present. The code comments note that per-project server-newer reconciliation is deferred. Evidence paths: `src/store/projectServerSync.ts`, around lines 145-170; `src/lib/projectBundle.ts`, around lines 83-114.

**Failure mode:** User edits Project A on laptop, syncs it, then opens Project A on desktop with an older local copy. Because the id already exists locally, desktop does not pull the newer server bundle. A later desktop edit pushes the older base plus new local change, potentially overwriting laptop work.

**Recommended fix:** Add lightweight per-project conflict detection before push:

- Persist server `revision` / `updatedAt` in local sync metadata per project.
- During reconcile, if local and server both exist and server revision is newer than last-seen local revision, mark conflict/stale instead of doing nothing.
- Before `saveProject`, include an expected revision or compare server revision; reject/hold pushes when the remote advanced unexpectedly.
- Provide a minimal user choice: keep local, pull remote as new version, or duplicate project.

**Suggested validation:** Integration test with two local store snapshots against one project id: remote advances, stale client reconnects, then local edit occurs. Verify the stale client does not blindly PUT over the newer remote revision.

### 4. Downstream artifacts can be generated from missing or truncated dependencies

**Severity:** High  
**Area:** Artifact dependency relationships / LLM orchestration reliability  

**Why it matters:** Dependencies are central to consistency across screen inventory, user flows, component inventory, implementation plan, and mockups. The dependency context builder inserts `Not generated yet` for missing dependencies and truncates each dependency to 1,400 characters. That allows downstream artifacts to proceed with partial context, which can produce broken relationships that are hard for users to audit.

**Evidence:** `buildDependencyContext` returns “Not generated yet” for absent dependencies and slices dependency content to 1,400 characters. Evidence path: `src/lib/artifactOrchestration.ts`, around lines 19-38. `generateCoreArtifact` embeds that dependency context into artifact prompts as normal prompt input. Evidence path: `src/lib/services/coreArtifactService.ts`, around lines 487-529.

**Failure mode:** A large screen inventory or data model exceeds the slice, so downstream user flows or implementation plan miss important screens/entities. Or a retry for a downstream slot runs while an upstream hidden dependency is absent/errored, so the prompt explicitly contains “Not generated yet” and the model fills gaps. The resulting artifact appears coherent but no longer matches upstream truth.

**Recommended fix:** Make dependency sufficiency explicit per artifact:

- For each artifact subtype, define required vs optional dependencies.
- Block generation when a required dependency is absent or errored, unless the user explicitly chooses degraded generation.
- Replace raw character slicing with structured summaries for JSON-mode artifacts, preserving ids/names/relationships before prose.
- Record dependency completeness in metadata and surface it in the dependency graph/export.

**Suggested validation:** Regression test that `implementation_plan` cannot generate when required upstream artifacts are missing, and that dependency context for screen inventory preserves all screen ids/names even when prose is truncated.

### 5. Partial mockup image generation failures can look like a completed mockup artifact

**Severity:** High  
**Area:** Mockups / recovery / user trust  

**Why it matters:** The mockup spec is saved and marked done before image generation finishes. Image generation is fire-and-forget; per-screen failures are logged as warnings. If images fail due to OpenAI quota, network, or Blob/IndexedDB problems, the artifact can still look complete at the orchestration level while the user sees missing visuals later.

**Evidence:** `runMockupSlot` saves the mockup spec, sets slot status to `done`, then starts image generation asynchronously and only logs failures. Evidence path: `src/lib/services/artifactJobController.ts`, around lines 341-393.

**Failure mode:** The mockup spec saves successfully, slot turns green, and the workspace progresses. Several images fail in the background. The user sees incomplete galleries or export output but the generation status does not clearly identify a partial mockup-image failure requiring retry.

**Recommended fix:** Track mockup as two phases: spec generated and images generated. Keep the artifact version but mark visual delivery as `partial` until all required screen images settle. Provide per-screen retry and a bundle-level “retry failed images” action.

**Suggested validation:** Mock image generation failure for one screen and verify the mockup status/metadata exposes partial visual completion rather than only `done`.

### 6. Consistency review can apply model-authored changes without full semantic guardrails

**Severity:** Medium  
**Area:** PRD consistency review / artifact quality  

**Why it matters:** The consistency-review pass is valuable, but it is still another model call that can change the PRD. The current guards prevent major detail loss, feature-id changes, required-field drops, and product-name loss, but they do not verify every semantic invariant that downstream artifacts rely on, such as acceptance criteria preservation, feature dependency references, entity field integrity, or restricted-safety directive preservation.

**Evidence:** `reviewPrdConsistency` merges parsed model output over the original and applies guards for array length loss, required fields, feature IDs, and product identity. Evidence path: `src/lib/services/prdConsistencyReview.ts`, around lines 109-225. The pass runs by default when all sections succeeded. Evidence path: `src/lib/services/progressivePrdPipeline.ts`, around lines 256-275.

**Failure mode:** The review “normalizes” terminology but changes a feature’s acceptance criteria, alters a dependency phrase, weakens a constraint, or removes a safety-sensitive restriction while preserving array counts and feature IDs. Downstream artifacts now derive from a subtly different PRD than the one produced by section agents.

**Recommended fix:** Extend the acceptance guard only where it protects downstream correctness:

- Preserve counts of acceptance criteria per feature.
- Preserve explicit feature dependency ids/names.
- Preserve safety restriction fields/directives when present.
- Record a structured diff for applied review changes and show it in version history for transparency.

**Suggested validation:** Targeted test where review output keeps feature IDs but drops acceptance criteria; verify the revision is rejected.

### 7. Retry semantics can regenerate a downstream slot without regenerating stale upstream dependencies

**Severity:** Medium  
**Area:** Artifact recovery / dependency graph  

**Why it matters:** A single-slot retry is a common recovery action after a failed generation. The retry path seeds available artifacts from the store, but it does not enforce that required upstream artifacts are current and successful for the same spine, nor does it expand hidden dependencies the way graph-driven regeneration does. This can produce a “fixed” downstream artifact built on stale or missing inputs.

**Evidence:** `retrySlot` initializes a job for only the requested slot, loads any preferred same-spine artifacts into `generatedArtifacts`, and calls `runCoreArtifactSlot` or `runMockupSlot` directly. Evidence path: `src/lib/services/artifactJobController.ts`, around lines 691-735. The more robust hidden-dependency closure exists in `regenerateSlots`, not in `retrySlot`. Evidence path: `src/lib/services/artifactJobController.ts`, around lines 626-646.

**Failure mode:** Component inventory fails or is stale, then the user retries mockup or implementation plan. The downstream retry proceeds with whatever preferred artifacts exist. The retry succeeds, but the result is inconsistent with the intended dependency chain.

**Recommended fix:** On retry, compute required dependency closure for the slot. If dependencies are missing/errored/stale, either queue them first or block with a clear message. Reuse the same closure logic from graph regeneration for retry.

**Suggested validation:** Test retrying a downstream slot with an errored hidden dependency; verify Synapse queues/blocks on the dependency instead of saving downstream output.

### 8. Local persistence failure is surfaced, but cloud durability remains ambiguous

**Severity:** Medium  
**Area:** Persistence / project recovery  

**Why it matters:** The store has thoughtful quota handling and lifecycle flushes, but the core persistence unit is still a large localStorage blob. A user can see local edits in the UI while cloud sync is delayed, failed, or never started. If they switch devices or clear browser data before successful cloud save, work can be lost despite feeling “saved.”

**Evidence:** Zustand persistence writes through `createDebouncedStorage`, serializing the entire persisted store and writing after a 500 ms debounce. It shows a sticky toast only when localStorage quota write fails. Evidence path: `src/store/storage.ts`, around lines 99-119 and quota handling earlier in the file. Server pushes are separately debounced at 1.5 seconds and failures are recorded in sync state, not tied to local save success. Evidence path: `src/store/projectServerSync.ts`, around lines 65-99.

**Failure mode:** The user generates or edits a large project, localStorage accepts it, but cloud save fails because the session expired, network is offline, body limit is hit, or server fails. The local workspace works until the user changes device or loses local storage. The small sync indicator can be missed, creating a trust issue.

**Recommended fix:** Distinguish “saved on this device” from “synced to cloud” at critical moments:

- On export/close/navigation after major generation, surface unsynced cloud state more strongly.
- Add a project-level `lastCloudSavedAt`/`lastCloudSaveError` visible in project details.
- For large bundle save failures, provide an explicit “Download recovery bundle” CTA.

**Suggested validation:** Simulate `saveProject` failure after local generation and verify the UI exposes unsynced state plus recovery export.

### 9. Prompt inputs still mix authoritative and secondary sources in one user prompt

**Severity:** Medium  
**Area:** Prompt construction / generated artifact quality  

**Why it matters:** The canonical spine is correctly positioned as authoritative, but the prompt still includes dependency artifacts and the full PRD markdown in the same user message. If the full PRD contains stale wording, partial sections, or user-edited contradictions, the model can still attend to conflicting content despite the instruction hierarchy.

**Evidence:** `generateCoreArtifact` builds a prompt with guardrails, canonical spine, dependency artifacts, selected preset, and full PRD markdown as a secondary reference. Evidence path: `src/lib/services/coreArtifactService.ts`, around lines 522-529.

**Failure mode:** A user manually edits PRD markdown or a partial generation leaves contradictory text. The canonical spine says one thing while full PRD prose says another. The model follows the wrong detail because both appear in-context, leading to artifact drift that looks plausible.

**Recommended fix:** Keep the full PRD fallback but make conflict handling machine-checkable:

- Include a compact “known conflicts/staleness” block when PRD markdown and spine disagree.
- Prefer structured canonical fields over prose for dependencies.
- For high-risk artifacts, generate from canonical spine plus structured dependency summaries first; include full PRD only in a clearly delimited appendix.

**Suggested validation:** Prompt-construction test where full PRD conflicts with canonical feature name; verify generated prompt emphasizes the canonical value and validation flags use of the stale name.

### 10. Owner/admin tooling is mostly gated, but OAuth debug output can disclose auth setup details

**Severity:** Low  
**Area:** Auth / owner-debug tooling  

**Why it matters:** Admin and owner routes have meaningful gates. The remaining trust issue is debug output on OAuth init: with `debug=1`, the route returns auth URL and redirect URI guidance. This is not a direct auth bypass, but in production it can reveal configuration details useful for targeted troubleshooting abuse or social engineering.

**Evidence:** The OAuth init dispatcher supports `?debug=1` and returns redirect URL diagnostics before redirecting. Evidence path: `api/auth/[provider].js`, around its debug branch.

**Failure mode:** An unauthenticated visitor hits the debug endpoint and learns exact redirect URI/base URL/provider wiring. This is low severity because client IDs and redirect URIs are not secrets, and the callback still requires provider state/session protections.

**Recommended fix:** Gate debug output behind an environment flag or owner/admin token in production. Keep it open only in local development.

**Suggested validation:** Route-level test that `?debug=1` returns diagnostics only when an explicit debug env flag is enabled.
