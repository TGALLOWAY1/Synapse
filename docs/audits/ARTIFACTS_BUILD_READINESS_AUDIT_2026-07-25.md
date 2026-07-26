# Synapse Audit 3: Artifacts and Build Readiness

**Audit date:** 2026-07-25  
**Validated revision:** `16fd21c`  
**Revalidation baseline:** `39a831d` (the repository state before PRs #324–#328)  
**Resolution plan:** [docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md](../ARTIFACT_READINESS_RESOLUTION_PLAN.md) — sequenced workstreams for the issues below, and the protocol for updating this audit as they land. **Statuses in §2 are the live record of what has and has not been resolved.**  
**Verdict:** **Not reliably ready for autonomous implementation.** Synapse produces a useful, project-specific planning packet, but its final readiness signal is stronger than the evidence it checks. A coding agent can start discovery or a supervised first slice; it cannot safely treat the generated implementation plan as an authoritative build contract.

## Scope and method

This audit traces the active core-artifact pipeline, generation prompts, workspace navigation, renderers, dependency graph, planning-readiness rules, and implementation-plan handoff. It evaluates the six requested scenarios by static workflow tracing and focused automated tests.

The post-audit validation compared `39a831d..16fd21c`, covering PRs #324–#328. Those changes primarily affect the read-only demo, artifact overlay/version persistence, documentation, and QA. They improve recoverability and clarify the demo, but do not change the active artifact set, artifact prompts, implementation-plan dependencies, plan renderer, coverage model, or planning-readiness criteria. Therefore the findings below remain current. One earlier wording is now sharpened: plan progress is persisted and recoverable, but Synapse still does not provide execution evidence or quality-gate tracking.

## Executive findings

### What works

- The generated artifacts are deliberately project-bound: prompts require feature references, screen names, entities, constraints, milestone links, and acceptance criteria rather than generic prose.
- Screens consolidate inventory and mockups into a coherent review workspace, while User Flows can navigate into canonical screens.
- The implementation plan has milestones, ordered tasks, prompt packs, validation commands, definition of done, provenance, coverage, and task conversion.
- Dependency and stale-state views help users detect downstream artifacts generated from older sources.
- Recent version-overlay work makes edits, approvals, relinks, and plan progress recoverable instead of silently mutating generated versions.

### What still blocks trustworthy handoff

1. **“Ready to build” validates product reasoning, not the completeness of the implementation packet.** It does not require every active artifact to exist, be current, be reviewed, or have no blocking coverage gaps.
2. **API requirements are embedded summaries, not contracts.** Endpoint entries do not require schemas, error semantics, authorization, idempotency, pagination, or compatibility behavior.
3. **Security, privacy, analytics, and success metrics are not first-class reviewed artifacts.** They are distributed across PRD and data-model fields and can disappear between generation and task handoff.
4. **A hidden Component Inventory influences mockups but cannot be directly reviewed.** This weakens the chain from screen design to reusable implementation units.
5. **The Implementation Plan does not depend on User Flows.** It may be generated while behavioral journeys are missing or stale.
6. **Approval state is too coarse.** Synapse can show freshness and some review state, but not a consistent approved/proposed/outdated/unresolved state for every artifact and criterion.
7. **Plan CTAs mix review, export, prompt handoff, and execution administration.** “Copy next prompt” looks like the forward action even when unresolved decisions or coverage gaps remain.

---

## 1. Artifact inventory

| Artifact | Purpose and workflow position | Source information | Usefulness and PRD consistency | Implementation readiness | Disposition |
|---|---|---|---|---|---|
| **Approved PRD / structured spine** | Authoritative product definition before generation; supplies the project reasoning and feature set. | Planning conversation, decisions, challenge review, scope, users, outcomes, features, safety review. | Strong as the common source, but downstream traceability often stops at feature labels rather than immutable requirement IDs. | **Partial.** Product definition can be approved while technical/dependency questions remain unresolved. | **Retain and improve:** assign stable requirement and decision IDs; expose supersession and unresolved state. |
| **User Flows** | Defines onboarding, core, admin/settings, and alternate paths; generated after PRD and used during experience review. | PRD and screen names; generation requires feature references and explicit steps. | Project-specific and readable. Navigation into screens is useful. Consistency is vulnerable because the final plan does not require this artifact. | **Partial.** Useful behavioral input, but not guaranteed current at handoff and not expressed as testable state transitions. | **Retain and improve:** make it a plan dependency; identify preconditions, alternate/error paths, requirement IDs, and test scenarios. |
| **Screen Inventory** | Defines the screen set and per-screen implementation handoff; appears in the consolidated Screens workspace. | PRD features and flows; prompt asks for states, entry/exit, risks, acceptance criteria, route, components, state, events, data, APIs, accessibility, and responsive behavior. | The strongest implementation-facing artifact. It is specific, scannable, editable through screen overlays, and traceable by feature references. | **Mostly ready per screen**, provided generated fields are complete and reviewed. No global check guarantees every P0/P1 screen is complete. | **Retain and improve:** block readiness on missing handoff fields, criteria, and unresolved screen issues. |
| **Mockups / wireframes** | Visualizes screens and variants inside the Screens workspace after flow approval. | Screen Inventory, Design System, mockup settings, and approved flow/screen selection. | Visually useful and now better protected across version clones. It can still look complete while omitting runtime states, interaction semantics, or data constraints. | **Partial.** Suitable visual reference, not an executable specification. | **Retain and subordinate:** label images as evidence for a screen specification, never as proof that the screen is implementation-ready. |
| **Component Inventory** | Describes reusable components, props, usage, and accessibility; generated for downstream mockups. | PRD and experience artifacts. | Potentially valuable bridge from screens to implementation, but hidden from the workspace. Users cannot verify whether mockups rely on unsuitable or contradictory components. | **Not review-ready.** A hidden artifact cannot be authoritative handoff material. | **Consolidate:** expose it as a “Components” section of Screens or Design System, or stop treating it as a meaningful generated artifact. |
| **Design System** | Establishes tokens, component rules, and domain-appropriate visual conventions before mockups. | PRD, platform/domain context, generated token/component structure. | More project-specific than a generic palette, and valuable for visual consistency. Its relationship to implementation tokens and component inventory is not strongly enforced. | **Partial.** Guides styling, but lacks a required export/mapping to code conventions and accessibility verification. | **Retain and improve:** connect tokens/components to screens, code targets, contrast checks, and approval status. |
| **Data Model** | Defines entities, fields, relationships, indexes, constraints, privacy rules, endpoint summaries, and product mapping. | PRD and feature set; generated before the Implementation Plan. | Broad and project-specific. Product mapping supports traceability. Mixing persistence, API, security, and privacy into one page makes review dense and uneven. | **Partial.** Good conceptual schema; insufficient as a migration/API/security contract. | **Retain and split the review:** keep one architecture area, with explicit Schema, API Contract, and Privacy/Security sections and separate completeness checks. |
| **API requirements** *(embedded)* | Lists endpoints associated with the Data Model. | Generated from the PRD and inferred entities/operations. | Helpful inventory, but operationally shallow. It can identify that an endpoint exists without saying enough to implement interoperable clients and servers. | **Not ready.** Missing required request/response schemas, errors, authz, pagination, idempotency, rate limits, event behavior, and requirement/acceptance links. | **Improve into a first-class reviewed section** rather than a separate navigation page. |
| **System architecture** *(distributed)* | Communicates architecture through model overview, constraints, plan tasks, and prompt packs. | Inferred from PRD, Data Model, and implementation-plan generation. | Useful fragments exist, but there is no compact authoritative runtime/deployment/integration view for a coding agent. | **Not consistently ready.** Cross-cutting dependencies and boundaries can be inferred differently by different agents. | **Consolidate into Implementation Plan → Architecture & decisions**, including boundaries, external systems, deployment assumptions, and ADR links. |
| **Security and privacy** *(distributed)* | Captures privacy/safety field groups, privacy rules, and risk considerations. | PRD safety context and Data Model prompt. | Better than omission, but easy to review as incidental schema prose. Threats, authorization boundaries, retention, secrets, auditability, and abuse cases are not consistently converted to tasks/tests. | **Not ready for sensitive projects.** | **Make a blocking cross-cutting checklist** whose controls link to requirements, tasks, and tests. |
| **Analytics and success metrics** *(mostly PRD-derived)* | Connects intended outcomes to instrumentation and measurement. | PRD outcomes/features and inferred screen events. | Screen handoff can mention events, but there is no authoritative measurement plan mapping success metrics to event definitions, properties, owners, and validation. | **Not ready.** A product can be declared build-ready with no implementable measurement contract. | **Add a required Measurement section** to the plan for projects with stated success metrics. |
| **Acceptance criteria** *(distributed)* | Defines correctness at feature, screen, milestone, and definition-of-done levels. | PRD features plus generated screen and plan content. | Valuable but redundant and vulnerable to drift. Criteria do not share stable IDs or a single review status. | **Partial.** A coding agent must reconcile overlapping criteria and decide which formulation wins. | **Consolidate by reference:** canonical criteria under requirement IDs; artifacts link to them and add only artifact-specific checks. |
| **Implementation Plan** | Final handoff: milestones, ordered tasks, prompt packs, quality gates, validation commands, coverage, provenance, and optional task conversion. | PRD, Screen Inventory, and Data Model; notably not User Flows. | Rich, readable, and actionable at a high level. Coverage/provenance are strong review aids. It can still contain broad tasks, inferred architecture, and missing behavioral/security/analytics work. | **Partial, not autonomous-agent ready.** | **Retain and improve:** make it the sole final review surface, enforce dependency freshness and requirement-level coverage, and separate review from execution actions. |
| **Dependency Graph** | Read-only integrity map showing presence, versions, freshness, and dependencies. | Artifact manifests/source references. | Useful diagnostic view but disconnected from final approval; users can still proceed despite problems. | **Supportive, not a handoff artifact.** | **Retain as diagnostics; surface blockers inline in Final Review** rather than making users detour to a graph. |
| **Prompt Pack** *(embedded; standalone subtype retired)* | Provides bounded prompts for a coding agent, generally by milestone. | Implementation Plan tasks, linked artifacts, and definition of done. | Useful transport format, but copying a prompt is not evidence that context is complete. Prompt review duplicates parts of plan review. | **Partial.** Appropriate handoff convenience after readiness, not a readiness criterion. | **Retain inside the plan; never make it the default forward CTA before blockers are clear.** |

### Redundancy and disconnection summary

- The Screen Inventory and mockups are correctly consolidated, but Component Inventory remains an invisible third source for the same implementation surface.
- Acceptance criteria are repeated across PRD, screens, tasks, and definition of done without canonical IDs.
- Data Model combines schema, API, security, and privacy despite those domains having different reviewers and completeness standards.
- The Dependency Graph, plan Coverage tab, workspace status indicators, and final readiness state all summarize integrity differently; none is clearly the sole authority.
- Prompt packs can be visually complete and easy to copy while omitting context that was never required by readiness checks.

---

## 2. Prioritized issues

| Severity | Affected page/component/artifact | Evidence | Consequence | Recommended change | Effort | Status | Workstream |
|---|---|---|---|---|---|---|---|
| **Critical** | Finalize/Build readiness; `planningReadiness` | `isReadyToBuild` is derived from product-reasoning criteria (problem, user, outcome, scope, confirmed state, features, decisions, alignment, challenge, output alignment), not artifact completeness or freshness. | The UI can state “ready to build” while API contracts, security controls, analytics, stale artifacts, or task links are incomplete. A coding agent receives false confidence. | Introduce a separate build-packet readiness evaluator requiring current required artifacts, zero blocking validation/coverage issues, approved unresolved-decision policy, and executable first milestone. | M–L | **Resolved** (PR #334) | W6 |
| **High** | Data Model → API requirements | API endpoints are generated inside a broad Data Model payload; no first-class contract completeness is required. | Client/server behavior, authorization, failures, and compatibility must be invented during implementation. | Require method/path, authn/authz, request/response schemas, errors, pagination/idempotency, rate limits, events, requirement IDs, and tests. Validate completeness automatically. | M | **Resolved** (PR #334) — `events` folded into per-endpoint `tests`/`requirementIds` rather than a separate field | W3 |
| **High** | Implementation Plan generation dependencies | Active pipeline dependencies include Screen Inventory and Data Model but omit User Flows. | A plan can be current while the defining behavioral artifact is stale or absent, dropping alternate/error journeys. | Add User Flows as a required source/dependency and include its source version in provenance and stale checks. | S–M | **Resolved** (PR #334) — added as a `dependsOn` source, deliberately not a `REQUIRED_DEPENDENCIES` entry (plan §W2 option A) | W2 |
| **High** | Security/privacy and analytics handoff | These concerns are embedded in data fields, privacy rules, events, and inferred tasks rather than required review sections. | Cross-cutting requirements can silently disappear; sensitive products may begin without threat, retention, consent, or measurement work. | Add conditional blocking sections/checklists generated from PRD risks and success metrics; require task/test links. | M | **Resolved** (PR #334) — conditional plan sections, blocking via W6 | W5 |
| **High** | Component Inventory | It is generated and used downstream but hidden from normal artifact navigation. | Product owners cannot verify component assumptions or resolve screen/design contradictions before handoff. | Expose a consolidated Components review within Screens or Design System, with usage and conflict links. | M | **Resolved** (PR #334) — Components section inside Screens; `HIDDEN_ARTIFACT_SUBTYPES` now empty | W4 |
| **High** | Implementation Plan task traceability | Tasks and milestones can carry linked artifacts, but stable requirement/criterion IDs are not the universal source of truth. | A coding agent cannot reliably answer “which approved requirement makes this task necessary?” or detect orphan requirements/tasks. | Create stable requirement and acceptance-criterion IDs; require each implementation task and test to link to at least one. | L | **Partially resolved** (PR #334) — derived ids (W1) + requirement→task coverage blocking (W6) ship, so orphan *requirements* are detected; the reverse direction (a task linking to no requirement) is **not** reported | W1, W6 |
| **Medium** | Implementation Plan header and milestone cards | Copy next prompt, Review prompts, Convert/Manage tasks, and Copy plan all appear as forward-looking actions. | Users may export or execute before reviewing blockers; there is no obvious single next step. | When not ready, primary CTA should be **Resolve N blockers**. When ready, use **Approve build packet**; only then promote **Start/Copy first slice**. Demote export/task administration to secondary menus. | S–M | **Resolved** (PR #334) | W7 |
| **Medium** | Acceptance criteria across artifacts | Criteria are generated in multiple artifacts without shared lifecycle status. | Reviewers duplicate work and cannot tell whether conflicting wording is proposed, approved, stale, or superseded. | Canonicalize criteria by ID and expose state, owner, source, and last-impacting version. | M–L | Identity half **resolved** (PR #334, W1: derived `CriterionId`s + match confidence); persisted per-criterion lifecycle state still **deferred** — plan §6 | W1 (partial) |
| **Medium** | Plan execution/quality gates | The plan defines validation commands and quality gates, and progress can be persisted, but the renderer explicitly remains a handoff surface rather than validation tracking. | Checked tasks can be mistaken for verified work; test evidence and gate outcomes live elsewhere. | Distinguish “planned,” “started,” “implemented,” and “verified”; optionally ingest command/CI evidence or explicitly label progress as self-reported. | M | **Resolved as labelling** (PR #334, W8): `planned → started → implemented (self-reported)`, with a stated non-verification disclaimer and a regression test that W6 never counts progress as evidence. A **“verified”** state and CI/command evidence ingestion remain **deferred** — plan §6 | W8 |
| **Medium** | Inconsistency resolution across versions | Recent overlay work preserves edits and history, but there is no universal conflict-resolution workflow connecting a changed requirement to affected downstream artifacts. | Users can repair one artifact while leaving other artifacts semantically stale, or dismiss an issue without recording impact. | Offer four explicit resolutions: update source, regenerate selected downstream artifacts, retain current with rationale, or defer with impact/owner. Recompute the dependency graph after each. | L | Deferred — plan §6 | — |
| **Medium** | Dependency Graph and Coverage tab | Integrity summaries are spread across separate surfaces. | Review becomes an administrative detour; users must infer whether a warning is blocking. | Put one blocker summary and traceability matrix in Final Review; retain the graph as an expandable diagnostic. | M | **Resolved** (PR #334) — Coverage tab removed; its summary folded into Final Review with the matrix as expandable detail | W7 |
| **Low** | Read-only demo | PR #324 now lands visitors directly in Assets and hides unavailable journey actions. | This no longer distorts the audit workflow, but the demo cannot validate generation, approval, editing, or regeneration scenarios. | Label the demo as artifact exploration and keep workflow evaluation in an editable test project. | Done / XS | **Resolved** (PR #324) | — |

---

## 3. Page-level call-to-action audit

Synapse uses a stage-based project workspace rather than a distinct URL for every artifact. The rows below audit the major user-visible workflow surfaces and nested artifact views.

| Page/surface | Primary user goal | Current primary action | CTA clarity and competition | Recommended disposition |
|---|---|---|---|---|
| **Plan / planning conversation** | Turn an idea into explicit users, outcomes, scope, requirements, and decisions. | Continue the guided planning interaction. | Generally clear, although readiness/finalization can compete with resolving weak reasoning. | **Retain.** Keep one primary “Continue planning” action until minimum criteria are met. |
| **Review / challenge findings** | Resolve contradictions and decide whether the product definition is acceptable. | Address findings, confirm decisions, or finalize. | Multiple review/history/finalize paths can obscure the exact blocking item. | **Simplify.** Lead with “Resolve next blocker”; place history and navigation as secondary controls. |
| **PRD** | Verify the authoritative product definition before artifact generation. | Review/edit/finalize and proceed to generation. | The desired transition is understandable, but “approved” must distinguish product-definition approval from build approval. | **Retain.** Rename state to “PRD approved”; show downstream-impact warning on edits. |
| **Generate / artifact workspace landing** | Generate missing artifacts and understand overall status. | Generate all or open an artifact. | Status and generation actions are useful, but multiple rows/status controls can feel like administration. | **Retain and simplify.** One primary “Generate/refresh required artifacts”; one blocker summary. |
| **Screens list** | Verify screen coverage and choose a screen to review. | Open a screen; possibly repair missing mockup coverage. | Good consolidation. Repair, generation, status, and review affordances can compete when issues exist. | **Retain.** Primary CTA should adapt: “Review next screen” or “Resolve N screen issues.” |
| **Screen detail — Overview/Flow/Mockups** | Review one implementation surface end to end. | Move among tabs, edit details, approve/review, add/relink/generate mockups. | Actions affect content across tabs and some consequences (regenerate vs overlay edit) are not obvious. | **Retain as one page.** Add a sticky review status and a single “Mark reviewed / Resolve issue” action; group destructive/regenerative actions near version impact. |
| **User Flows** | Validate end-to-end journeys and navigate to implicated screens. | Review flow content or open a screen. | Understandable content, but no strong completion CTA and no clear downstream plan consequence. | **Retain within Experience.** Add “Complete flow review” and block final handoff on unresolved/missing paths. |
| **Design System** | Validate tokens and component conventions for the project. | Review or regenerate. | Review completion and effect on mockups are not prominent. | **Retain.** Add explicit approve/current state and impact preview before regeneration. Consolidate Component Inventory here or under Screens. |
| **Data Model** | Validate entities, relationships, constraints, privacy rules, and endpoint needs. | Review/edit/regenerate/export. | Dense page with no single review sequence; API/privacy concerns compete with schema review. | **Keep one architecture destination but segment it.** Guided Schema → API → Privacy/Security review with completeness indicators and one final approval action. |
| **Implementation Plan — Overview** | Understand build order and first vertical slice. | Copy next prompt, review prompts, convert/manage tasks, copy plan. | **Too many primary-looking actions.** “Copy next prompt” does not state whether it starts implementation, copies context only, or bypasses review. | **Retain as Final Review.** Primary CTA is “Resolve blockers” until approved, then “Start first slice.” Move copy/export/task actions to secondary controls. |
| **Implementation Plan — Milestones/tasks** | Verify ordering, dependencies, scope, and completion criteria. | Expand milestones, check progress, copy milestone prompt. | Task progress is useful, but checkbox consequence is ambiguous: planning acknowledgement vs verified completion. | **Retain.** Label status semantics and show requirement/dependency/test links inline. |
| **Implementation Plan — Coverage** | Confirm every requirement/artifact has implementation coverage and sources are current. | Inspect links or navigate to source artifacts. | Useful but passive; warnings do not consistently become blocking actions. | **Merge into Final Review summary.** Keep detailed matrix as an expandable tab. |
| **Prompt review** | Inspect coding-agent prompts before handoff. | Copy a prompt. | Duplicates plan content and encourages transport before final approval. | **Consolidate into each milestone.** Treat prompt as generated export of the approved slice. |
| **Convert/manage tasks modal** | Persist plan tasks for tracking. | Convert or manage tasks. | Administrative detour before readiness; conversion can imply approval. | **Keep secondary and post-approval.** Conversion must preserve requirement, criterion, dependency, artifact-version, and test links. |
| **Dependency Graph** | Diagnose missing or stale artifact relationships. | Inspect nodes and navigate to an artifact. | No clear primary CTA; useful only when investigating integrity. | **Retain as diagnostics, not a required page.** Surface actionable blockers in Final Review. |
| **Version History / restore modal** | Understand changes and restore a prior artifact state. | Restore a version, with recent overlay-preservation options. | Consequences are clearer after recent PRs, but this remains recovery rather than forward progress. | **Retain as contextual utility.** Keep it close to the artifact it affects; show downstream stale impact before restore. |
| **Read-only demo assets** | Explore finished example artifacts. | Open artifacts/screens. | PR #324 appropriately removes unavailable workflow CTAs and journey rail. | **Retain separately from workflow evaluation.** It should not claim to demonstrate generation or approval. |

### Explicit CTA problems

- **No clear CTA:** Dependency Graph; User Flows after content review; Coverage when all links have merely been inspected.
- **Too many primary-looking actions:** Implementation Plan header and milestone prompt controls.
- **Unclear consequences:** Copy next prompt, task progress checkboxes, regenerate/mark-current actions, and task conversion.
- **Redundant summaries:** workspace status, Dependency Graph, Coverage, and final readiness each describe integrity differently.
- **Actions far from affected content:** plan-level actions operate on milestone/task content below; version operations can affect downstream artifacts not visible in the modal.
- **Controls that can obscure content:** issue banners and generation/repair controls can dominate the Screens workspace during review.
- **Combine/simplify:** Component Inventory into Design System/Screens; Prompt Review into milestone details; API/privacy/security into structured Data Model sections; Coverage blockers into Final Review.

---

## 4. Build-readiness assessment

### Decision

**The current output is not sufficient for a coding agent to begin autonomous implementation.** It is sufficient for a human-supervised agent to perform repository discovery, confirm assumptions, and propose or implement a narrow first vertical slice after the owner resolves the blockers below.

### Missing or weak context

- **Missing requirements:** complete API behavior; authorization boundaries; data retention/deletion; abuse/threat controls; observability; analytics event contracts; migration/deployment/rollback expectations; non-functional budgets where relevant.
- **Missing dependencies:** User Flows are not a required Implementation Plan source; external services, runtime/deployment assumptions, and ownership boundaries are not consistently authoritative.
- **Potential contradictions:** screen criteria, flow behavior, data/API fields, and plan tasks can independently restate the same requirement without shared IDs or supersession rules.
- **Weak acceptance criteria:** criteria may be present but are not canonical, statused, or universally linked to tasks and tests. Broad milestones can pass review without machine-checkable behavior.
- **Unresolved decisions:** readiness does not prove that every implementation-impacting decision has an owner, due point, defer rationale, and affected artifacts.
- **Unclear sources of truth:** the approved PRD is conceptually authoritative, but overlays, regenerated artifact versions, plan coverage, and task copies can diverge. The UI lacks one signed-off artifact-version manifest.
- **Tasks too broad/disconnected:** generated tasks may describe a subsystem or milestone without a stable requirement/criterion link, explicit inputs/outputs, concrete files/interfaces, dependency status, or test evidence.

### Required coding-agent handoff context

Before implementation, an agent should receive:

1. A build manifest pinning the approved PRD and every authoritative artifact version.
2. The first vertical slice with ordered tasks and explicit dependencies.
3. Stable requirement and acceptance-criterion IDs for every task.
4. Screen/flow/entity/API links at the task level.
5. Architecture boundaries and recorded unresolved/deferred decisions.
6. Security/privacy and analytics obligations that apply to the slice.
7. Exact test commands plus expected assertions, not only generic “add tests” guidance.
8. Repository/runtime constraints and migration/deployment/rollback expectations.
9. A statement of intentionally deferred functionality.

### Scenario results

| Scenario | Result | Assessment |
|---|---|---|
| 1. Generate all major artifacts from an approved PRD | **Pass with caveats** | Active artifacts can be generated in dependency order; Component Inventory is hidden and Prompt Pack is embedded/retired as standalone. “All” does not include first-class API, security, analytics, or architecture artifacts. |
| 2. Product-owner review for correctness | **Partial** | Screens and plan coverage are reviewable, but lifecycle state and cross-artifact contradiction resolution are inconsistent. Hidden components and distributed cross-cutting concerns reduce confidence. |
| 3. Trace screen, entity, API, and task to a requirement | **Partial/fail** | Feature references and linked artifacts provide hints. No universal immutable requirement/criterion IDs guarantee end-to-end traceability, especially for endpoint and task details. |
| 4. Determine whether project is ready to build | **Fail as a reliable gate** | Current readiness can validate reasoning while build artifacts are absent, stale, incomplete, or unresolved. |
| 5. Hand plan to a coding agent | **Partial** | The agent receives useful milestones/prompts/commands, but must still infer contracts, architecture, cross-cutting controls, and authoritative versions. |
| 6. Resolve final-review inconsistency | **Partial** | Artifact editing, regeneration, history, and recent overlay recovery help. There is no single guided resolution that records the choice and refreshes all affected downstream artifacts. |

---

## 5. Recommended final-stage workflow

### Step 1 — Approve the product definition

Approve only the PRD: problem, users, outcomes, scope, stable requirement IDs, acceptance criteria, decisions, constraints, success metrics, and known risks. Call this state **PRD approved**, not “ready to build.”

### Step 2 — Generate the build foundation

Generate or refresh in dependency order:

1. Design System and visible component conventions.
2. User Flows.
3. Screen Inventory and mockups.
4. Data Model with structured API Contract and Privacy/Security sections.
5. Implementation Plan, sourced from **all** of the above.

Generation should create a versioned build manifest and never silently substitute an older source.

### Step 3 — Required artifact review

Require approval only for artifacts that constrain implementation:

- **Experience:** User Flows and Screens (including mockup evidence and component conventions).
- **Architecture:** schema, API contract, external integrations, security/privacy controls.
- **Delivery:** milestones, tasks, dependencies, tests, deferred scope, and requirement coverage.

Do not require separate approval of administrative views such as the Dependency Graph or copied Prompt Packs. They are derived evidence/exports.

### Step 4 — Automatic checks

Run checks continuously and summarize them in Final Review:

- Required artifacts exist and are generated from the approved PRD version.
- No required source is stale or missing.
- Every P0/P1 requirement maps to a flow, screen or non-UI behavior, task, and acceptance test.
- Every screen has required states, handoff details, accessibility/responsive notes, criteria, and resolved mockup/spec links.
- Every entity and endpoint maps to requirements and tasks.
- Every endpoint has complete contract fields.
- Security/privacy and analytics obligations map to tasks and tests.
- Every task has requirement IDs, dependencies, acceptance criteria, authoritative artifact links, and expected validation.
- The first milestone forms an executable vertical slice with no unresolved dependency.
- No two current artifacts contain conflicting canonical requirement/criterion definitions.

### Step 5 — Blocking rules

Block build approval for:

- missing or stale required artifacts;
- unresolved P0/P1 decisions or contradictions;
- uncovered requirements or orphan implementation tasks;
- incomplete API/security/privacy contracts relevant to the first slice;
- missing acceptance tests or unknown dependencies for the first slice;
- artifact versions not pinned in the build manifest.

Allow non-blocking warnings only when an owner, impact, rationale, and target milestone are recorded. Deferred functionality must be explicit and excluded from current acceptance criteria.

### Step 6 — Resolve inconsistencies in place

For every inconsistency, present one primary action, **Resolve**, followed by explicit choices:

1. Update the source requirement/decision and regenerate affected artifacts.
2. Update the downstream artifact to match the approved source.
3. Keep the current interpretation with a recorded rationale and owner approval.
4. Defer the functionality with impact, owner, and target milestone.

After resolution, automatically recompute freshness, coverage, and readiness. Never use “dismiss” as an unexplained equivalent of resolution.

### Step 7 — Approve the build packet

The final page should show one ordered blocker list, the pinned artifact manifest, the first slice, deferred scope, and a compact traceability matrix. One genuine approval is necessary: **Approve build packet** by the accountable product/technical owner(s). Prompt review and task conversion are not additional approvals.

### Definition of “Ready to Build”

“Ready to Build” should mean:

- the PRD and required artifact versions are pinned and approved;
- there are no blocking freshness, coverage, contradiction, decision, dependency, contract, security/privacy, or test gaps;
- every in-scope requirement traces to implementation and verification;
- the first vertical slice is independently executable and has explicit success/failure checks;
- deferred scope is explicit and excluded from current acceptance;
- a coding agent can identify authoritative context without choosing between contradictory artifacts;
- copied prompts and converted tasks are faithful exports of that approved packet.

Only after this state should **Start first slice** or **Copy first implementation prompt** become the primary CTA.

---

## Post-audit PR validation

| PR/commit range | Relevant change | Effect on findings |
|---|---|---|
| **#324 / `0ed30f3`** | Presents the demo as a view-only assets exploration, lands it in Assets, hides unavailable workflow controls. | Improves demo CTA clarity. Does not change editable artifact generation, review, traceability, or build readiness. |
| **#326 / `d49ddc1`** | Preserves overlays and image ownership across version clones/restores; records user-authored overlay changes, including plan progress, in recoverable history. | Improves editability, provenance, and inconsistency recovery. Does not add semantic cross-artifact conflict resolution or build gate checks. |
| **#325 follow-up / `262d6af`** | Removes the phantom Implementation Plan “Validation” tab from E2E expectations. | Confirms that there is no dedicated validation-tracking tab; the plan remains a handoff/progress surface. |
| **#327 / `fd5f40a`, `0abe756`** | Replaces versioning planning docs with a current assessment. | Documentation only; no artifact/readiness behavior change. |
| **#328 / `618207a`, `7cc35d3`** | Adds and corrects a manual QA checklist. | Improves human validation guidance, but does not make generated build packets self-validating or change readiness criteria. |
| **#334 / `3395eaa`…`4317eb3`** | Implements plan workstreams W1–W8: derived requirement/criterion ids; User Flows as a plan source; a per-endpoint API contract with a completeness check; a reviewable Component Inventory (`HIDDEN_ARTIFACT_SUBTYPES` now empty); conditional security/privacy + measurement plan sections; a **separate build-packet readiness evaluator** whose approval criterion reads the current *committed* `ReadinessReview` rather than the live projection; Final Review with one blocker list and one primary CTA plus a pinned artifact-version manifest; and self-reported task-progress labelling. | Addresses the **Critical** readiness-signal finding at its root: `isReadyToBuild` no longer labels the outputs CTA, and packet readiness is reported separately from product reasoning. Rows 1–7, 9 and 11 of §2 move to Resolved; row 6 is **partially** resolved (orphan-task detection absent); rows 8 and 10 stay Deferred. **The verdict, §4 Decision, §1 dispositions, §3 CTA rows and Scenario results below are NOT yet re-run against the shipped behavior** — plan §5 requires a manual QA pass and an `/e2e` run for that, which had not been performed when this row was written. |

### Revalidation conclusion

The recent PRs **do not invalidate the audit’s central findings**. They materially improve version recoverability and demo usability, so those areas are no longer characterized as silent metadata mutation or misleading demo workflow. The release still needs a distinct artifact-level readiness gate, first-class contract completeness, stable requirement traceability, visible/reviewable component assumptions, and an unambiguous final-review CTA before Synapse can claim autonomous coding-agent readiness.
