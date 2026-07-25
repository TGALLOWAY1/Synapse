# Synapse Audit 2: Project Coherence and Change Management

**Validated:** 2026-07-25  
**Audit basis:** source inspection and targeted automated tests on `16fd21c`  
**Scope:** changing approved requirements after downstream artifacts exist; proposal authority; propagation; version comparison and recovery  
**Implementation changes:** none

## Executive conclusion

Synapse is safer than a conventional editable document workspace: PRD and artifact restores append versions, downstream outputs retain source references, stale plans become read-only history, and focused AI changes cannot be applied until a user approves them. Those controls make changes visible and recoverable at the artifact level.

The project is not yet coherent as a single change-managed system, however. The PRD is the practical source of product truth, while approval, questions, decisions, downstream plans, and output currency are represented in separate records. Impact analysis is limited to four generated artifact slots and depends on structural or lexical matches. It does not provide a complete dependency ledger covering stories, journeys, screens, navigation, entities, APIs, architecture, acceptance criteria, tasks, tests, and metrics. Recovery is version-level rather than region-level, and comparison explains content deltas rather than the product consequences of those deltas.

**Answer to the central question:** users can change their minds with good snapshot safety and a guarded proposal workflow, but they must still manually reason about missing dependencies, authority across surfaces, and selective restoration. Major approved changes are understandable but not reliably coherent end to end.

## Validation of PRs merged after the original audit

The original findings were rechecked against the current branch after PRs #326, #327, and #328.

| PR | Relevant change | Effect on this audit |
|---|---|---|
| #326 — versioning image/overlay continuity | Artifact clones retain image identity; user-authored overlays now produce recoverable history; artifact restore defaults to preserving current overlays and can explicitly restore historical overlays. | **One recovery finding is narrowed, not closed.** Accidental screen edits/deletions represented as overlays now have recoverable artifact versions and an explicit keep/restore choice. Restoration is still whole-artifact/whole-overlay-state rather than single-screen or single-region restoration. Image loss during clone-based restore is no longer a current finding. |
| #327 — versioning assessment | Documentation and architecture guidance only. | **No runtime finding changed.** The assessment corroborates snapshot-oriented versioning and the absence of selective product-level restoration. |
| #328 — QA checklist | Documentation and manual QA guidance only. | **No runtime finding changed.** It adds repeatable checks but does not extend propagation, authority, comparison, or restoration behavior. |

The current implementation was therefore used for all severity and scenario conclusions below. No original conclusion was carried forward solely because it appeared in the earlier audit.

## 1. Current state model

### Practical sources of truth

1. **Product definition:** the latest PRD spine version is the practical product source of truth. A restored PRD is appended as the latest version, but is deliberately reopened as non-final.
2. **Generated outputs:** each artifact has a preferred/current version. Its `sourceRefs` record the spine and artifact versions from which it was generated or against which a user later asserted currency.
3. **Decisions and change intent:** planning records and their events preserve confirmation and application history. A downstream plan can identify its source as confirmed or provisional.
4. **Downstream truth:** there is no single authoritative project-wide dependency state. Output alignment, downstream update plans, proposal reviews, and artifact version history each expose part of the truth.

### State representation

| User concept | Current representation | Audit assessment |
|---|---|---|
| Approved product behavior | Final/latest PRD plus confirmed/applied planning records | Represented, but authority is split and a restored approved PRD becomes non-final. |
| AI suggestion | A sealed downstream artifact update proposal and recommendation copy | Clearly labelled in the focused review surface. |
| Proposed change | Proposal operation, before/proposed region, rationale, ambiguity, and preserved scope | Strong local representation. It does not become output content merely by being planned or reviewed. |
| Unresolved question | Planning/decision records and unresolved planning state | Present in planning, but not summarized as a project-wide authority state beside every affected output. |
| Confirmed decision | Planning record events and a downstream plan's `confirmed` source flag | Durable, though distributed across records rather than represented by one change object. |
| Invalidated assumption | Usually a later PRD or decision event plus staleness/alignment consequences | No dedicated first-class invalidated-assumption state with dependents attached. |
| Deferred idea | A downstream plan item disposition of `deferred`, with rationale | Clear within that plan; not a global backlog/change state. |
| Outdated artifact | Alignment state (`possibly_affected`, `out_of_date`, or stale read-only plan/proposal) | Useful but conservative and incomplete because dependency detection is bounded. |
| Restored state | A new PRD or artifact version with `changeSource: revert` and a source-version reference | Non-destructive and auditable at version granularity. |

### Lifecycle clarity

The focused flow is substantially correct:

> source change → generate impact plan → review a bounded proposal → approve/reject/defer → explicitly apply → create a new artifact version

The UI states that planning does not modify output content, distinguishes “Review only” from a proposed or applied change, and performs a currentness check before application. The weakness is above that local flow: there is no project-level change record proving that every required dependency was considered and either updated, accepted as aligned, deferred, or explicitly declared not applicable.

## 2. Prioritized issues

### CM-1 — Incomplete dependency coverage can present a coherent-looking but incomplete project

- **Severity:** Critical
- **Affected area:** `downstreamUpdatePlanGeneration`, output alignment, Sync outputs / downstream plan review
- **Reproduction:** Finalize a PRD, generate all artifacts, then remove a major feature or revise a core requirement. Review the generated impact plan.
- **Evidence:** Focused plan generation supports only `screen_inventory`, `user_flows`, `data_model`, and `implementation_plan`. It can skip an artifact when no focused regions are found. The output model has no required project-wide entries for analytics/success metrics, API contracts, global navigation, acceptance criteria, or test obligations.
- **Risk:** Users can finish all visible plan items while omitted downstream obligations remain contradictory. “Reviewed” can be mistaken for “complete impact analysis.”
- **Recommended change:** Introduce an explicit dependency registry with required categories and an auditable disposition for every category. A missing parser or weak match should create an “impact unknown — review required” item rather than silently omit the dependency.
- **Estimated effort:** Large (4–8 weeks, including migration, UI, and tests)

### CM-2 — Authority is split across latest, final, confirmed, preferred, aligned, and applied states

- **Severity:** High
- **Affected area:** PRD workspace, Decision Center/planning records, output alignment, artifact headers/history
- **Reproduction:** Revise a finalized requirement through a planning decision, apply one downstream proposal, defer another, and mark a third artifact current without changing its content.
- **Evidence:** The latest PRD, PRD finality, planning confirmation, preferred artifact version, proposal application, and alignment are separate state transitions. “Mark as up to date” creates an honest version but rebases source references based on user assertion, so provenance currency is not proof of semantic consistency.
- **Risk:** Two careful users can reasonably disagree about which behavior is authoritative. A green/current artifact may mean “regenerated,” “approved patch applied,” or “user asserted still current.”
- **Recommended change:** Add a project-level approved baseline and change-set status. Show the baseline/change-set identity and reconciliation method (`regenerated`, `patched`, `reviewed unchanged`) on every artifact.
- **Estimated effort:** Large (4–6 weeks)

### CM-3 — Selective recovery is not supported

- **Severity:** High
- **Affected area:** Version History, restore confirmation, artifact/spine stores
- **Reproduction:** Change navigation and the data model in separate user actions, then attempt to revert navigation while retaining the data-model change.
- **Evidence:** Restore clones an entire historical PRD or artifact version. The artifact modal can choose whether current or historical overlay state wins, but cannot select an individual screen, route, section, entity, or field. PRD restore similarly restores the complete structured PRD snapshot.
- **Risk:** Users must manually reapply unrelated later work or accept an over-broad restore. That makes recovery costly and discourages safe experimentation.
- **Recommended change:** Add section/region restore as a proposed patch against current state, with a preview of conflicts and downstream impact before approval.
- **Estimated effort:** Large (4–8 weeks)

### CM-4 — Accidental screen deletion is recoverable only through artifact-level history

- **Severity:** Medium (reduced from High after PR #326)
- **Affected area:** Screens overlays, Version History, artifact restore modal
- **Reproduction:** Edit or remove a screen represented in `screenEdits`/extra-screen overlay state, make unrelated later screen edits, then restore the deleted screen.
- **Evidence:** Overlay writes now append/amend version history, destructive overlay patches append a version, and restore can explicitly select historical overlays. The restore unit remains the artifact overlay collection, not one screen.
- **Risk:** Recovery exists, but users can restore too much or have to reconstruct unrelated screen work. The “Keep my edits” default also means restoring old generated content does not by itself restore a deleted historical overlay unless the alternate option is selected.
- **Recommended change:** Add per-screen history and “Restore this screen” as a patch onto the current artifact. Explain whether generated content, screen edits, links, approvals, and images will be restored.
- **Estimated effort:** Medium–Large (2–4 weeks)

### CM-5 — Semantic changes can escape focused impact detection

- **Severity:** High
- **Affected area:** spine change analysis and downstream region binding
- **Reproduction:** Change a core workflow using different terminology while retaining feature identifiers poorly or not at all; regenerate the downstream plan.
- **Evidence:** Candidate generation is driven by removed/changed/renamed features and section changes, then bound using identifiers, phrases, and significant words. When no regions are found, an artifact can receive no focused plan.
- **Risk:** The more conceptual the change, the more likely users must discover inconsistent journeys, screens, acceptance criteria, or architecture manually.
- **Recommended change:** Combine durable requirement IDs with an explicit typed trace graph. Treat low-confidence semantic analysis as supplemental evidence, never as the sole reason to omit review.
- **Estimated effort:** Large (4–8 weeks)

### CM-6 — Comparisons show snapshots, not consequences

- **Severity:** Medium
- **Affected area:** Version Compare view and structured version diff
- **Reproduction:** Compare the project before and after a major requirement revision.
- **Evidence:** PRD comparison is section-aware and artifact comparison is textual. Screen comparison is intentionally lean and does not express full nested UX state. Neither comparison includes the dependency plan, accepted/rejected proposals, unresolved impacts, or reconciliation outcomes.
- **Risk:** Users can tell that words or rows changed but not whether the project became coherent, what was intentionally preserved, or what remains unresolved.
- **Recommended change:** Compare approved baselines/change sets, not only versions. Include requirements added/changed/removed, decision rationale, affected artifacts, dispositions, applied patches, and outstanding reviews.
- **Estimated effort:** Medium–Large (3–5 weeks)

### CM-7 — PRD restoration intentionally drops final approval

- **Severity:** Medium
- **Affected area:** PRD restore and finalization state
- **Reproduction:** Restore an older finalized PRD version and inspect the resulting latest version.
- **Evidence:** Restore appends a new latest PRD with revert provenance but sets `isFinal: false` regardless of the source version's approval state.
- **Risk:** This is safer than silently declaring the restored state approved, but the user has not “returned to a previous approved product definition” in authority terms. Without explicit copy, restore may be interpreted as reinstating approval.
- **Recommended change:** Label the result “Restored draft from approved baseline X” and offer a deliberate reapproval flow with impact review. Preserve the historical approval as provenance without inheriting it as current approval.
- **Estimated effort:** Small–Medium (1–2 weeks)

### CM-8 — “Mark as up to date” can close visible staleness without evidence of semantic review

- **Severity:** Medium
- **Affected area:** Sync outputs, artifact version provenance, output alignment
- **Reproduction:** Make a consequential PRD change and mark an affected output current without modifying it.
- **Evidence:** The action appends an honest `marked_current` version and rebases its source references to current dependencies. This records the assertion but cannot prove the content is aligned.
- **Risk:** Auditability is better than an in-place flag, yet future users may treat technical currency as validated product consistency.
- **Recommended change:** Require a review disposition and rationale tied to the specific change set. Display “reviewed unchanged” rather than generic “up to date.”
- **Estimated effort:** Small–Medium (1–2 weeks)

## 3. Change propagation findings

| Dependency | Detection | Finding |
|---|---|---|
| User stories | Partial | Can appear through feature/section text in supported artifacts; not a required typed dependency. |
| User journeys / flows | Good within `user_flows` | Focused regions and proposal review exist when binding succeeds; conceptual renames can be missed. |
| Screens | Good within `screen_inventory` | Named screen regions, trace IDs, and lexical evidence can be detected; no guarantee every workflow impact maps to a screen. |
| Navigation | Partial | Screen navigation and flow transitions can be regions, but there is no authoritative global navigation graph or independent reconciliation category. |
| Data entities | Good within `data_model` | Entities, fields, relationships, and constraints are supported proposal regions; destructive changes receive warnings. |
| APIs / integrations | Partial | Implementation-plan architecture can identify API/integration work, but there is no dedicated API contract artifact/dependency class. |
| Architecture | Good within `implementation_plan` | Architecture/delivery regions are supported, subject to binding quality. |
| Acceptance criteria | Partial | Can be embedded in output text or implementation work, but is not a required impact category with traceable completion. |
| Implementation tasks | Good within `implementation_plan` | Delivery regions can be planned and patched. |
| Testing requirements | Partial | Tests can be mentioned as implementation delivery impact; there is no independent testing obligation ledger. |
| Analytics / success metrics | Not first-class | PRD section changes may signal broad drift, but focused downstream planning has no analytics/metrics artifact slot or mandatory review item. |

### Scenario outcomes

1. **Finalize PRD, generate artifacts, delete a major feature:** affected supported artifacts are marked possibly affected/out of date when references or bindings exist. Removed-feature references conservatively block readiness. Unsupported categories and unmatched regions require manual discovery.
2. **Change a core workflow after UX screens exist:** user flows and screen inventory can receive focused impact plans and bounded proposals. There is no completeness guarantee across navigation, acceptance tests, API behavior, and metrics.
3. **Accidentally delete a screen and restore it:** after PR #326, overlay edits are versioned and recoverable. The user must restore artifact overlay state rather than a single screen, and must deliberately choose historical overlays in the restore dialog.
4. **Revert navigation while preserving unrelated data-model changes:** possible only if navigation and data live in separate artifact versions and the desired navigation snapshot can be restored wholesale. It is not possible as a single cross-project selective revert when both changes share a PRD/artifact snapshot.
5. **Review a proposal without accepting it:** supported. “Review only,” proposed, approved, rejected, deferred, and applied paths remain distinct; planning and review do not silently change output content.
6. **Compare before/after a major requirement revision:** supported as section-aware PRD version comparison, but it does not summarize downstream consequences or prove reconciliation completeness.

## 4. Versioning findings

### What versioning currently supports

- Append-only PRD restoration with explicit revert provenance.
- Append-only artifact restoration with explicit revert provenance and a preferred version.
- Recoverable user overlay edits; destructive overlay changes force a historical version boundary.
- Image continuity across clone-based restore and “mark current” actions.
- A choice between keeping current overlay edits and restoring historical overlay edits.
- Comparison of a historical PRD/artifact version against current content.
- Honest history entries for restore, edit, generated, applied-proposal, and marked-current actions.

### Reasonable user expectations not yet met

- Restore one requirement, screen, route, entity, or field without rolling back unrelated work.
- Compare two approved product baselines, including decisions and downstream reconciliation.
- Reapply or revert one meaningful user action across all artifacts it changed.
- See conflicts before restoring an old region onto current content.
- Know whether a restored state is merely current, previously approved, or currently reapproved.

### Safety and clarity

Restoration is non-destructive because it appends rather than overwrites history. PR #326 fixed two material hazards: cloned artifacts retain images, and user overlays no longer disappear silently from unversioned in-place updates. The remaining hazard is **scope**, not irrecoverable deletion: restoring a version can carry more state than the user intended, while the overlay-preservation default can carry newer edits the user expected to roll back.

Partial restoration is not available as a first-class operation. Users can approximate it by copying content manually, by restoring different artifacts independently, or by generating and applying focused downstream proposals. None of those is a general region-level revert with conflict and impact preview.

Version history reflects more meaningful user actions after PR #326, especially overlay edits and restores. It remains a version timeline, not a change-set timeline: related PRD, navigation, data, task, and test updates are not grouped as one product decision.

## 5. Recommended change-management model

Use one explicit **Change Set** as the unit of intent, review, application, and recovery.

### A. Propose

- Start from an approved baseline.
- Record the proposed requirement/decision delta without mutating the baseline.
- Give the change a title, rationale, author, status, and stable requirement IDs.
- Distinguish AI-authored suggestions from user-authored intent.

### B. Preview impact

- Traverse a typed dependency graph across every required category.
- Show `affected`, `possibly affected`, `unaffected with evidence`, and `unknown — review required`.
- Never omit a required category because a parser or semantic matcher found nothing.
- Preview destructive operations and restoration conflicts.

### C. Decide

- Approve, reject, defer, or request changes at the change-set level.
- Permit item-level dispositions, each with rationale and owner.
- Keep approved intent immutable; revisions create a new proposal revision.

### D. Apply atomically to the source of truth

- Create a new approved or draft product baseline, depending on the decision.
- Record exactly which requirements and decisions were added, changed, invalidated, or restored.
- Preserve the prior baseline for one-click comparison and recovery.

### E. Reconcile downstream artifacts

- For each dependency, choose `regenerate`, `apply approved patch`, `reviewed unchanged`, `defer`, or `not applicable`.
- Create artifact versions only for applied actions.
- Keep proposals visibly separate from applied versions.
- Block “change complete” while required categories are unknown or unresolved.

### F. Verify and close

- Re-run dependency checks against the new baseline.
- Show a closure summary: what changed, what was preserved, what was restored, what remains deferred, and who approved each exception.
- Group all related versions and events under the change-set ID.

### G. Recover

- Restore a full approved baseline or propose restoration of a single region.
- Treat restoration as a new change set with the same impact preview and approval guardrails.
- Offer conflict-aware selective restore while preserving unrelated current work.

This lifecycle makes authority answerable in one sentence: **the current approved baseline is authoritative; open change sets are proposals; every artifact states how it was reconciled to that baseline; closed change sets and baselines are restorable.**

## Validation commands

The audit was revalidated with repository history inspection, source searches, diff review, and targeted versioning/propagation tests. No application code was changed.
