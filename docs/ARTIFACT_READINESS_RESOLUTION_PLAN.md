# Artifact & Build-Readiness Resolution Plan

**Responds to:** [docs/audits/ARTIFACTS_BUILD_READINESS_AUDIT_2026-07-25.md](audits/ARTIFACTS_BUILD_READINESS_AUDIT_2026-07-25.md)
**Baseline:** `930814e` (audit validated at `16fd21c`)
**Goal of this plan:** move Synapse from *"produces a useful planning packet"* to
*"produces a packet whose readiness signal is backed by the evidence it claims,"*
and then update the audit to reflect what actually shipped.

This document is a **plan**, not a change. Nothing here has been implemented.

---

## 1. What this plan does and does not attempt

The audit's central finding is a **truth-in-signalling** problem, not a missing-features
problem: `isReadyToBuild` reports on product reasoning, while the UI and the copy CTAs
present it as build readiness. Everything downstream of that — API contracts, hidden
components, plan dependencies, CTA hierarchy — either feeds that signal or is misread
because of it.

So the plan is ordered by **what makes the readiness claim honest**, not by audit severity:

1. Give requirements and acceptance criteria stable identity (nothing traces without this).
2. Make the packet's *inputs* complete and visible (flows dependency, API contract, components).
3. Build a **separate build-packet readiness evaluator** and let it block.
4. Rebuild the plan surface around that evaluator (Final Review + one CTA).
5. Update the audit.

**Explicitly out of scope for this plan** (deferred, with rationale in §6):
audit row 10 (universal cross-version conflict-resolution workflow, effort **L**) and
the persisted-lifecycle half of row 8 (per-criterion approved/proposed/superseded state,
effort **M–L**). Row 12 (demo) is already closed.

---

## 2. Constraints this plan must respect

These are repo rules from `CLAUDE.md` that materially shape the designs below. A
workstream that violates one is wrong even if it satisfies the audit.

| Constraint | Consequence for this plan |
|---|---|
| **Read-side layers are derived, never persisted** (rule 10) | Requirement/criterion IDs, coverage, and build-packet readiness are pure `src/lib/` modules recomputed on read. No new persisted collection, no `ALL_PROJECT_COLLECTIONS` entry, no snapshot/sync wiring. |
| **One freshness engine** (rule 9) | The build-packet evaluator *consumes* `evaluateProjectFreshness`; it never re-derives staleness. Its vocabulary stays distinct from system freshness. |
| **Prompts are snapshot-locked** (rule 7) | Every prompt edit (API contract fields, measurement section, flows context) updates `src/lib/__tests__/promptSurfaces.test.ts` snapshots **in the same commit**. |
| **User edits are overlays** (rule 12) | New reviewable surfaces (Components, API contract, plan sections) write review/approval state through `updateArtifactOverlay`, never `updateArtifactVersionMetadata`. |
| **Optional domain fields stay optional** (rule 3) | Any new field on `Feature`, `ParsedApiEndpoint`, or the plan schema is optional; legacy artifacts must render unchanged. |
| **Vercel function cap: 11/12 used** | None of this work adds an `api/*.js` endpoint. If one becomes necessary, consolidate behind an existing handler's `?action=`. |
| **`npm run build` + `npm run lint` gate** | Test files are type-checked. Type the new derived models properly rather than casting in tests. |
| **Docs sync in the same change** (documentation rule) | Each workstream names the topic doc it must update. |

---

## 3. Workstreams

Effort labels match the audit's scale (XS/S/M/L). "Exit criteria" are what makes the
workstream reviewable — and what the audit update in §5 will be checked against.

### Phase 0 — Identity substrate

#### W1 · Stable requirement and acceptance-criterion identity
*Audit rows: **High** (task traceability), **Medium** (acceptance criteria) · Effort **M***

**Problem.** `Feature.id` is already stable and unique (`src/types/index.ts:68`), but
acceptance criteria are bare `string[]` across at least four shapes (`Feature.acceptanceCriteria`,
screen criteria, plan task criteria, definition-of-done). Nothing can answer *"which approved
requirement makes this task necessary?"*, so coverage and traceability are label-matching
heuristics.

**Design.** A new pure module `src/lib/requirementIdentity.ts`:

- `RequirementId` = the existing `Feature.id` — reuse, do not invent a parallel scheme.
- `CriterionId` = `${featureId}.AC.${hash8(normalize(text))}` — derived from **normalized
  criterion text**, not array position, so reordering is stable and a reword produces a new
  id (which is correct: a reworded criterion is a different criterion, and the delta is
  exactly the drift signal we want).
- `resolveCriterionRefs(text, index)` — fuzzy-matches criterion prose found in screens,
  tasks, and plan DoD back to canonical `CriterionId`s, returning
  `{ id, confidence: 'exact' | 'normalized' | 'fuzzy' | 'unmatched' }`.
- The result is **advisory and labelled**: an unmatched criterion is reported as
  "not traced to a PRD criterion", never silently dropped or auto-rewritten.

**Why derived, not persisted.** Persisting ids would require `ALL_PROJECT_COLLECTIONS`,
snapshot collectors, sync, and demo cleanup (rule 6) for a value that is a pure function of
PRD content. Derivation also means legacy projects gain traceability with no migration.

**Files.** New: `src/lib/requirementIdentity.ts` + `src/lib/__tests__/requirementIdentity.test.ts`.
Consumers land in W2/W6/W7.

**Exit criteria.**
- Every `Feature` yields a `RequirementId`; every criterion string yields a deterministic `CriterionId`.
- Reordering `acceptanceCriteria` does not change any id; editing one changes exactly that id.
- Match confidence is surfaced, and `unmatched` is a first-class reported state.

**Docs.** `docs/architecture/PLANNING_AND_DECISIONS.md` (new derived layer);
`docs/architecture/WORKSPACE_AND_ARTIFACTS.md` (coverage now keys off ids).

---

### Phase 1 — Complete and visible inputs

#### W2 · Implementation Plan sources User Flows
*Audit row: **High** · Effort **S–M***

**Problem.** `CORE_ARTIFACT_PIPELINE` (`src/lib/coreArtifactPipeline.ts:76-87`) declares
`implementation_plan.dependsOn = ['screen_inventory', 'data_model']` and the inline comment
explicitly excludes `user_flows` to keep the active pipeline two layers deep. Consequence:
a plan is "current" while the artifact defining alternate and error journeys is stale or absent.

**Decision required — and the recommendation.** Adding the edge makes the active pipeline
**three layers deep** (`user_flows` itself depends on `screen_inventory`), and a depth
assertion in `src/lib/__tests__/coreArtifactPipeline.test.ts` will fail. Two options:

| Option | Effect | Cost |
|---|---|---|
| **A (recommended)** — add `user_flows` to `dependsOn`, leave `REQUIRED_DEPENDENCIES` unchanged | Plan gets flows as prompt context, provenance source ref, and stale input. Generation is not *blocked* on flows; it waits for them. | Plan generation moves layer 2 → 3. Added wall-clock ≈ one `user_flows` run. Depth test updated with the rationale. |
| **B** — leave `dependsOn` alone; add flows only as a provenance/freshness input | No latency change. | The plan's *prompt* still never sees flows, so alternate/error paths keep getting dropped. Fixes the signal, not the content. |

Take **A**. The latency is real but bounded and one-time per run; B leaves the actual defect
(behavioral journeys absent from the plan) in place. Record the depth change as a deliberate
decision in the pipeline comment so the next reader does not "optimize" it back out.

**Files.** `src/lib/coreArtifactPipeline.ts`, the plan prompt in `src/lib/prompts/`
(+ snapshot), `src/lib/services/implementationPlanAdapter.ts` (provenance source ref),
`src/lib/__tests__/coreArtifactPipeline.test.ts` (depth assertion + rationale).

**Exit criteria.** Plan provenance lists a `user_flows` source version; a stale/missing
`user_flows` marks the plan stale via the existing freshness engine; plan prompt context
includes flow steps; depth test documents the accepted 3-layer pipeline.

**Docs.** `docs/architecture/WORKSPACE_AND_ARTIFACTS.md`, `docs/ARTIFACT_DEPENDENCY_GRAPH.md`.

---

#### W3 · API requirements become a contract
*Audit row: **High** · Effort **M***

**Problem.** `ParsedApiEndpoint` is `{ method, path, description, entity? }`
(`src/lib/services/dataModelMarkdown.ts:67`). Blocking validation only checks that the
string `"api endpoint"` appears at all (`src/lib/artifactBlockingValidation.ts:77`). An
endpoint can pass every check while saying nothing implementable.

**Design.**
1. **Schema.** Extend `ParsedApiEndpoint` with optional fields: `auth` (authn + authz rule),
   `requestSchema`, `responseSchema`, `errors`, `pagination`, `idempotency`, `rateLimit`,
   `requirementIds` (from W1), `tests`. All optional — legacy data models keep parsing.
2. **Emitter + parser.** Widen the `## API Endpoints` table round-trip in
   `dataModelMarkdown.ts` (currently a 3–4 column table) to a per-endpoint block form so
   schemas and error lists survive markdown. Keep the table parser as a legacy fallback.
3. **Prompt.** Require the new fields in the data-model prompt, tied to entities and to
   `RequirementId`s. Snapshot updated in the same commit.
4. **Completeness check.** New `src/lib/apiContractCompleteness.ts` (pure, derived) scoring
   each endpoint `complete | partial | stub` with the specific missing fields named. Advisory
   in the Data Model view; **blocking in W6** for endpoints reachable from the first slice.
5. **Review segmentation.** Split `DataModelRenderer` into **Schema → API Contract →
   Privacy & Security** sections with per-section completeness indicators, per the audit's
   "keep one architecture destination but segment it."

**Exit criteria.** A generated data model produces endpoints with request/response/error/auth
fields; the completeness module names exactly which fields are missing per endpoint; the
Data Model page reviews in three explicit segments; legacy table-form data models still render.

**Docs.** `docs/architecture/LLM_PIPELINE.md` (prompt), `docs/architecture/SAFETY_AND_VALIDATION.md` (new check).

---

#### W4 · Component Inventory becomes reviewable
*Audit row: **High** · Effort **M***

**Problem.** `component_inventory` is in `HIDDEN_ARTIFACT_SUBTYPES`
(`src/lib/coreArtifactPipeline.ts:133`) yet feeds mockups via `MOCKUP_DEPENDENCIES`. It also
has **no renderer** — `src/components/renderers/index.tsx:95` notes it falls through to raw
content. So it influences every mockup and cannot be inspected.

**Design.** Build the renderer first, then unhide — never the reverse, or the first thing
users see is raw JSON.

1. `src/components/renderers/ComponentInventoryRenderer.tsx` over the existing
   `parseComponentInventoryMarkdown`, showing component name, props, usage, accessibility notes,
   and **which screens reference it**.
2. Surface it as a **Components section within the Screens experience** (the audit's preferred
   consolidation) rather than a standalone sidebar row — it is a bridge artifact, and a new
   top-level row re-fragments the same implementation surface.
3. Remove `component_inventory` from `HIDDEN_ARTIFACT_SUBTYPES`. Audit every consumer of
   `isHiddenArtifactSubtype` — `ArtifactWorkspace.buildSlotMetas`, `ProjectWorkspace.assetsReady`,
   `artifactJobController.resumeIfNeeded` (`src/lib/services/artifactJobController.ts:740,1055`) —
   because the comment at `coreArtifactPipeline.ts:126-132` is explicit that unhiding changes
   readiness gating and retry behavior. Unhiding means the slot now *can* gate readiness and
   *will* auto-retry; both must be intentional and tested.
4. Flag component/screen contradictions (a screen citing a component that does not exist)
   as advisory review issues.

**Exit criteria.** Components render as structured review content with screen back-references;
an errored component slot is user-visible and retryable; `assetsReady` behavior change is
covered by a test; no invisible retry loop remains.

**Docs.** `docs/architecture/SCREENS_EXPERIENCE.md`, `docs/architecture/WORKSPACE_AND_ARTIFACTS.md`.

---

### Phase 2 — The gate

#### W5 · Cross-cutting obligations: security/privacy and measurement
*Audit row: **High** · Effort **M***

**Problem.** Security, privacy, and analytics live as incidental prose in PRD fields and
data-model field groups. They can vanish between generation and task handoff, and a product
with stated `successMetrics` can be declared build-ready with no measurement contract.

**Design.** Sections, not new artifacts — a new pipeline subtype costs a generation slot and
re-fragments review, which is the problem the audit is already complaining about.

1. Extend the consolidated plan schema with two **conditional** sections:
   - **Security & Privacy obligations** — emitted when the PRD carries safety context, privacy
     risks, or the data model has privacy-classified field groups. Each control links to
     requirement ids, tasks, and tests.
   - **Measurement** — emitted when `prd.successMetrics` is non-empty. Each metric maps to
     event name, properties, trigger, and validation.
2. Conditional generation lives in the plan prompt (+ snapshot); conditional **blocking** lives
   in W6, so the gate and the generator agree on when the section is required.
3. Absent-but-required renders as an explicit unresolved obligation, never as an empty section.

**Exit criteria.** A project with success metrics cannot reach build-approved without a
measurement mapping; a safety-flagged project cannot reach it without security/privacy controls
linked to tasks; projects with neither see neither section.

**Docs.** `docs/architecture/LLM_PIPELINE.md`, `docs/IMPLEMENTATION_PLAN_CONSOLIDATION.md`.

---

#### W6 · Build-packet readiness evaluator
*Audit row: **Critical** · Effort **M–L** · **The keystone workstream**

**Problem.** `derivePlanningReadiness` (`src/lib/planning/planningReadiness.ts:219`) computes
`isReadyToBuild` from `foundationClear && scopeExists && scopeConfirmed && decisionsResolved
&& alignmentClear && challengeClear` — all product-reasoning criteria. `ProjectWorkspace.tsx:1866`
then uses it to label the outputs CTA "Build outputs". Nothing in that expression looks at
whether the artifacts exist, are current, are complete, or are reviewed.

**Design.** A **second, separate** evaluator — do not widen `planningReadiness`. The two
answer different questions and must stay independently reportable:

- `derivePlanningReadiness` → *"is the product reasoning sound?"* → **PRD approved**
- `deriveBuildPacketReadiness` → *"is the implementation packet complete and current?"* → **Ready to build**

New module `src/lib/planning/buildPacketReadiness.ts`, modelled on the existing
`ReadinessReview` shape (`src/lib/planning/readinessReview.ts`) so criteria, evidence,
`blocking` flags, and action targets reuse a vocabulary the codebase already has.

**Blocking criteria** (from audit §5 step 5):

| Criterion | Source of truth |
|---|---|
| Required artifacts exist and are non-errored | artifact slots |
| No required source stale or missing | `evaluateProjectFreshness` (rule 9 — consumed, not re-derived) |
| Zero unresolved blocking validation issues | `artifactBlockingValidation` + W3 completeness |
| Every P0/P1 requirement maps to a task and a criterion | W1 + coverage matrix |
| Every endpoint reachable from the first slice has a complete contract | W3 |
| Conditional security/privacy + measurement obligations satisfied | W5 |
| First milestone is an executable vertical slice with no unresolved dependency | plan adapter |
| Product reasoning is approved | `derivePlanningReadiness.isReadyToBuild` (as **one input**, not the answer) |

**Non-blocking warnings** are allowed only when owner, impact, and rationale are recorded —
otherwise they are blockers. No composite confidence score (rule 13). Nothing auto-rewrites
an artifact.

**Files.** New `src/lib/planning/buildPacketReadiness.ts` + tests. Consumers: `ProjectWorkspace.tsx`
(CTA label at `:1866` must stop claiming build readiness from planning readiness),
`PlanningStateBar.tsx`, and W7's Final Review.

**Exit criteria.** A project with an approved PRD but a stale data model, an incomplete
endpoint contract, or an uncovered P0 requirement reports **not** build-ready, with the specific
blocker and a navigable action target. The two readiness states are separately visible and
never conflated in copy.

**Docs.** `docs/architecture/PLANNING_AND_DECISIONS.md` (authority model + the two-evaluator split),
`docs/architecture/WORKSPACE_AND_ARTIFACTS.md`.

---

### Phase 3 — The surface

#### W7 · Final Review: one blocker list, one CTA
*Audit rows: **Medium** (plan CTAs), **Medium** (graph/coverage split) · Effort **M***

**Problem.** `PlanHeader.tsx:104-129` renders **four** competing actions — Copy next prompt,
Review prompts, Convert/Manage tasks, Copy plan — with "Copy next prompt" styled as primary
regardless of blockers. Integrity is meanwhile summarized in four places (workspace status,
Dependency Graph, Coverage tab, readiness) with no single authority.

**Design.**
1. The Implementation Plan Overview becomes **Final Review**, driven by W6:
   - Not ready → single primary **Resolve N blockers**, expanding the ordered blocker list.
   - Ready → single primary **Approve build packet** (one genuine approval; prompt review and
     task conversion are not approvals).
   - Approved → **Start first slice / Copy first implementation prompt** is promoted.
2. Copy plan, Review prompts, Convert to tasks demote to a secondary menu at all times.
3. Fold the Coverage tab's blocker summary into Final Review; keep the full traceability matrix
   as an expandable detail. Dependency Graph stays as diagnostics.
4. Show the **pinned artifact-version manifest** (which version of each artifact this approval
   covers) — the audit's "one signed-off artifact-version manifest" gap.

**Exit criteria.** Exactly one primary action on the plan surface at any time; its label states
the actual next step; copying a prompt before approval is possible only via a clearly secondary
control; the blocker list and the graph never disagree.

**Docs.** `docs/architecture/WORKSPACE_AND_ARTIFACTS.md`, `docs/architecture/UI_PATTERNS.md`,
`README.md` if the build flow's user-visible narrative changes (README rule).

---

#### W8 · Honest task-progress semantics
*Audit row: **Medium** · Effort **S** (reduced from M)*

**Problem.** Plan task checkboxes persist through overlays and read as completion evidence,
while the renderer is a handoff surface with no execution or gate evidence.

**Design.** Take the audit's *"or explicitly label progress as self-reported"* branch. Ingesting
CI/command evidence is a much larger surface (evidence transport, trust model, staleness) and
is not justified before the gate in W6 exists. So: label the states honestly —
`planned → started → implemented (self-reported)` — and state plainly in the UI that Synapse does
not verify execution. Revisit verified-state ingestion only after W6 ships.

**Exit criteria.** No UI element implies Synapse verified an implementation; checkbox semantics
are stated at the point of use; W6 never counts self-reported progress as evidence.

**Docs.** `docs/architecture/WORKSPACE_AND_ARTIFACTS.md`.

---

## 4. Sequencing

```
Phase 0   W1 requirement identity ─────────────────┐
                                                    │ (ids consumed by W3, W6, W7)
Phase 1   W2 flows dep ──┐                          │
          W3 API contract ├── inputs complete ──────┤
          W4 components ──┘                         │
                                                    ▼
Phase 2   W5 cross-cutting sections ──────────► W6 build-packet readiness
                                                    │
Phase 3                                             ▼
          W7 Final Review + CTA ──► W8 progress semantics
                                                    │
Phase 4                                             ▼
                                            §5 audit update
```

W2, W3, and W4 are independent of one another and can land in any order or in parallel.
**W6 must not ship before W3 and W5**, or the gate blocks on criteria the generator was never
asked to satisfy — every project would fail readiness for reasons the user cannot fix.
**W7 must not ship before W6**, or "Resolve N blockers" has no N.

Each workstream is independently shippable and independently reviewable; none requires a
big-bang merge.

---

## 5. Updating the audit when complete

The audit is a dated, revision-pinned document (`ARTIFACTS_BUILD_READINESS_AUDIT_2026-07-25.md`).
Do not silently rewrite its findings — that destroys the record of what was true at `16fd21c`.
Instead:

**Per workstream, in the same PR that lands it:**
1. Add a row to the audit's **Post-audit PR validation** table: PR/commit, the change, and its
   effect on findings — in the same voice as the existing rows.
2. Update the **Status** column of the affected row in §2 *Prioritized issues* (add the column
   in the first such PR): `Open → In progress → Resolved (PR #N)` or `Deferred (see plan §6)`.
   Leave the original Severity/Evidence/Consequence text intact — it documents the state at
   audit time.

**Once Phases 0–3 are complete, in one closing PR:**
3. Rewrite the **Verdict** (line 6), the **§4 Decision**, and the **Scenario results** table
   against the shipped behavior — re-running the six scenarios rather than assuming the plan
   delivered what it promised. Scenario 4 ("Determine whether project is ready to build") is the
   one that must move from **Fail as a reliable gate**; if it has not, say so.
4. Update **§1 Artifact inventory** dispositions for artifacts whose status genuinely changed
   (Component Inventory, API requirements, Implementation Plan, User Flows).
5. Replace the **Revalidation conclusion** with a new one naming the new validated revision.
6. Re-check **§3 CTA audit** rows against the shipped Final Review surface.
7. Record what remains deferred (§6 below) so the audit does not read as fully closed when it
   is not.

**Verification before the closing PR** — the audit's claims are behavioral, so re-verify
behaviorally, not by reading the diff: `npm run build`, `npm run lint`, `npm test`, a manual pass
over [docs/QA_CHECKLIST.md](QA_CHECKLIST.md), and an `/e2e` run (scope B, replaying a saved
`state.json`, plus a critique pass) over the Screens, Data Model, and Implementation Plan views.

---

## 6. Deferred, with rationale

| Audit row | Why deferred | Revisit when |
|---|---|---|
| **Medium — Inconsistency resolution across versions** (four explicit resolutions, recompute graph after each) | Effort **L**, and it is a workflow layered *on top of* a blocker list that does not exist yet. Building it before W6/W7 means designing resolutions for blockers whose shape is still changing. | After W7 ships and the blocker taxonomy is stable. |
| **Medium — Acceptance-criterion lifecycle state** (approved/proposed/stale/superseded per criterion, with owner) | W1 delivers the identity and traceability half. The lifecycle half needs **persisted** per-criterion state — a new collection with `ALL_PROJECT_COLLECTIONS`, snapshot, sync, and demo-cleanup wiring (rule 6). That is a distinct, larger change. | After W1 proves the derived ids are stable in real projects. |
| **Medium — CI/command evidence ingestion for quality gates** | See W8: needs an evidence transport and trust model; the honest-labelling fix removes the misleading signal at a fraction of the cost. | After W6, if users ask for verified state. |

Deferring these means the audit **cannot be closed as fully resolved** at the end of Phase 3.
The closing update in §5 must say so explicitly.

---

## 7. Risks

- **W6 blocks everything.** A gate that is stricter than the generator makes every project
  un-buildable. Mitigation: W6 lands after W3/W5, and each blocking criterion ships with a test
  proving a freshly generated, well-formed project satisfies it.
- **W2 pipeline depth costs latency.** Accepted deliberately (§W2). If measured plan-generation
  wall-clock regresses more than one `user_flows` run, revisit option B.
- **W4 unhiding changes retry and readiness behavior**, per the explicit warning at
  `coreArtifactPipeline.ts:126-132`. Mitigation: renderer first, then unhide, with tests on
  `assetsReady` and `resumeIfNeeded`.
- **Prompt-snapshot churn.** W2, W3, and W5 each edit prompts. Each must update
  `promptSurfaces.test.ts` in its own commit — a batched snapshot update at the end hides drift.
- **Scope creep toward a project-management tool.** The goal is a trustworthy readiness signal,
  not execution tracking. W8 exists partly to hold that line.
