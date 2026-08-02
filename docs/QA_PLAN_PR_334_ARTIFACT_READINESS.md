# PR #334 Artifact & Build-Readiness QA Plan

- **Merge under test:** `c4024ce`
- **Base:** `bd5d886`
- **PR:** #334, *Artifact & build-readiness resolution: implement plan workstreams W1–W8*
- **Change size:** 99 files, 13,961 additions, 497 deletions
**Prepared:** 2026-08-01

## 1. Purpose and release question

This plan validates the change from a useful planning packet with an overstated
readiness signal to a packet whose implementation-readiness claim is backed by
current artifacts, traceability, contracts, cross-cutting obligations, an
executable first slice, and a durable approval.

The release question is:

> Can a user distinguish product-reasoning readiness from implementation-packet
> readiness, resolve every blocking condition, approve an exact versioned packet,
> and hand its first slice to a coding agent without Synapse hiding or overstating
> the evidence?

The existing artifact-readiness audit must not be closed from unit tests alone.
Its six behavioral scenarios require a manual pass and a live or saved-state E2E
walk after the gaps in section 4 are addressed or explicitly waived.

## 2. Implementation audit

| Workstream | What landed | Primary evidence | Important boundary |
|---|---|---|---|
| W1 — requirement identity | Derived `RequirementId` values reuse `Feature.id`; criterion IDs hash normalized text; resolution reports `exact`, `normalized`, `fuzzy`, or `unmatched`. | `src/lib/requirementIdentity.ts` and 270 lines of focused tests. | IDs are derived, not persisted. Rewording a criterion intentionally changes its ID. Per-criterion lifecycle/ownership remains deferred. |
| W2 — User Flows dependency | `implementation_plan` now consumes Screen Inventory, Data Model, and User Flows; flow steps and alternate/error paths are preserved in bounded prompt context and provenance. | `coreArtifactPipeline.ts`, `artifactOrchestration.ts`, prompt snapshot and freshness tests. | User Flows is a generation dependency but not a `REQUIRED_DEPENDENCIES` hard stop. Missing/errored flows must block the final packet through freshness `impactedBy`. Pipeline depth increases to three layers. |
| W3 — API contracts | Endpoints gained authn/authz, request/response schemas, errors, pagination, idempotency, rate limit, requirement IDs, and tests; markdown supports block-form round trips with legacy-table fallback; Data Model is segmented into Schema, API Contract, and Privacy & Security. | `ApiEndpointContract`, `apiContractCompleteness.ts`, `dataModelMarkdown.ts`, `DataModelRenderer.tsx`. | Core contract gaps block only for endpoints tied to the first slice. Supplementary gaps and later-slice gaps warn. Legacy endpoints remain readable and score as stubs. |
| W4 — component review | Component Inventory is no longer hidden. It renders as an expandable Components section inside Screens with screen back-references, contradiction advisories, status, and Retry. It also becomes a graph node, export row, readiness gate, and auto-resume candidate. | `componentExperience.ts`, `ComponentInventoryRenderer.tsx`, `ScreenComponentsSection.tsx`. | It intentionally has no sidebar row. Its hosted Screens section is the only direct status/retry surface. Contradictions are advisory, not packet blockers. |
| W5 — cross-cutting obligations | Conditional Security & Privacy and Measurement plan sections are generated only when triggered. A shared derived evaluator reports required/satisfied/absent/missing/advisory states. Unresolved sections block W6 and can be flagged to the Decision Center. | `crossCuttingObligations.ts`, prompt fragment/schema, `CrossCuttingObligationsCard.tsx`, `flagToPlan.ts`. | Section presence is optional for backward compatibility; requiredness is derived. Metric properties/task links are advisory, while event/trigger/validation are blocking. |
| W6 — packet readiness | A second evaluator reports eight ordered criteria with evidence, blockers, warnings, and action targets. It consumes the existing freshness and validation engines and fails closed when authority or currency is unverifiable. | `buildPacketReadiness.ts`, `useBuildPacketInputs.ts`, 1,090-line evaluator test suite. | It never replaces `derivePlanningReadiness`. Self-reported task status is not evidence. Accepted issues/risks need rationale to remain warnings. |
| W7 — Final Review | Implementation Plan now has one Final Review surface and one state-driven primary CTA: Resolve blockers → Approve packet → Start/copy first slice. It persists approval as an artifact-version overlay with an exact artifact manifest and detects version drift. Coverage moved into an expandable Final Review detail. | `buildPacketApproval.ts`, `FinalReviewCard.tsx`, overlay/store tests. | Prompt review, task conversion, and copy-plan stay secondary. Approval of the packet is separate from commitment of the product reasoning. |
| W8 — honest progress | Task states display Planned → Started → Implemented (self-reported), with a non-verification disclaimer and legacy-state normalization. | `taskProgressLanguage.ts`, `TaskChecklist.tsx`, milestone rendering tests. | There is no Verified state or CI/command evidence ingestion. That is deliberately deferred. |

Two follow-up commits in the same merge also changed behavior:

- `b330412` adds per-section PRD output budgets, outcome-based generation/export
  checkpoint severity, and per-run dismissal persistence.
- `3c4415e` turns cross-cutting obligation panels into quiet flags and routes the
  explicit user action through the existing Decision Center flow.

## 3. Verification already performed at the merged tip

| Check | Result | Notes |
|---|---|---|
| `npm run build` | Pass | Vite reports a CSS minification syntax warning, an outdated Browserslist database, and a 2.64 MB main JS chunk. These do not fail the build but should be triaged separately. |
| `npm run lint` | Pass | No lint errors. The run also reported Babel de-optimization while scanning a large generated file in a local nested worktree. |
| `npm test` | Pass | 308 test files / 2,852 tests. |
| `npm run e2e:smoke` | Pass | Home, idea entry, start-mode dialog, and cancellation pass with no console, page, network, or HTTP errors. This stops before generation and does not validate PR #334 functionality. |
| Live `/e2e` generation walk | Not run | Requires a dedicated Gemini test key. The F2 harness gap is now fixed, but a real generated run is still required for W4 evidence. |
| Manual product pass | Not run | Required before rewriting the audit verdict/scenario table. |

### Follow-up resolution verification

| Check | Result | Notes |
|---|---|---|
| Focused navigation/component tests | Pass | 4 files / 80 tests covering Data Model focus, Coverage expansion/focus, Component missing/generate behavior, and workspace target transport. |
| `node --check scripts/e2e-live-run.mjs` | Pass | Corrected required-output settle and Components capture script parses. |
| `npm run build` | Pass | Same non-failing CSS minify, Browserslist-age, and large-chunk warnings recorded above. |
| `npm run lint` | Pass | No lint errors; same unrelated nested-worktree Babel de-optimization note. |
| `npm test` | Pass | 308 test files / 2,856 tests after the resolutions. |
| `npm run e2e:smoke` | Pass | Four smoke steps; zero console errors/warnings, page errors, failed requests, or HTTP errors. |
| Corrected live asset run | Not run | Still requires the dedicated Gemini test key and manual screenshot review. |

## 4. Audit findings and applied resolutions

### F1 — High — Resolved: exact blocker destinations are preserved

`deriveBuildPacketReadiness` creates exact targets such as `api_contract`,
`coverage`, and `first_milestone` plus a milestone ID. The Final Review button
labels promise those destinations. The workspace now retains the complete
`BuildPacketArtifactActionTarget` through its one-shot navigation state. Data
Model focuses **API Contract**; Implementation Plan expands and focuses
**Traceability matrix** or opens the requested milestone; Component Inventory
opens the hosted **Components** section. A missing component inventory now
renders a concrete Generate action instead of a blank Screens landing.

Focused renderer tests cover focus/expansion, and the workspace orientation test
guards the complete target transport. **Residual QA:** run QA-NAV-001 through
QA-NAV-004 in a browser to validate scroll position and visible focus styling.

### F2 — High — Resolved: live E2E fails incomplete required bundles

`scripts/e2e-live-run.mjs` now waits for all six active core subtypes plus the
mockup spec, including `component_inventory`. A bundle whose UI and generation
network are stably idle but still missing a required output is recorded as
`incomplete` with
`missingSubtypes` and fails the non-optional asset step. The Screens walk also
expands Components and captures it separately.

**Residual QA:** a live Gemini run has not yet been executed, so the corrected
contract is syntax-checked but still needs real generator evidence.

### F3 — Medium — Resolved: generic manual coverage includes the new contract

`docs/QA_CHECKLIST.md` now distinguishes five workspace destinations from six
active core outputs plus mockup, and explicitly covers Components, the three
Data Model segments, all eight packet criteria, cross-cutting trigger variants,
exact blocker navigation, and self-reported task semantics.

### F4 — Low — Resolved: current architecture descriptions are synchronized

`docs/architecture/LLM_PIPELINE.md` and
`docs/ARTIFACT_DEPENDENCY_GRAPH.md` now describe Component Inventory as a
reviewable hosted artifact and state that `HIDDEN_ARTIFACT_SUBTYPES` is empty.
Historical audits/backlog text remains historical and is not rewritten as fresh
revalidation evidence.

## 5. Explicitly deferred behavior — do not report as a regression

- A task that links to no requirement is not detected; only orphan requirements
  are detected by the current coverage gate.
- Acceptance criteria do not have persisted approved/proposed/superseded state,
  owner, or per-version conflict resolution.
- There is no universal guided cross-version inconsistency resolver.
- Task completion is self-reported. There is no Verified state and no CI/command
  evidence ingestion.
- Only first-slice endpoint implementability blocks. Later-slice and
  non-reachable endpoint gaps are warnings by design.
- A first milestone that is executable but not demonstrably vertical warns
  rather than blocks.

These boundaries should still be visible and honest in the UI and handoff.

## 6. Test environments and data

### Environments

1. **Local deterministic:** `VITE_DEV_SKIP_AUTH=true`, no real account or sync,
   replayed state fixtures for negative cases.
2. **Local live generation:** dedicated low-quota Gemini key; never a production
   key. Run both 1440×900 and 390×844 viewports.
3. **Preview deployment:** authenticated editable project plus a read-only/demo
   project. Validate persistence, capability gating, downloads, and real routing.
4. **Production-like browser pass:** current Chrome plus Safari/WebKit for the
   expandable cards, clipboard, downloads, focus, and responsive layout.

### Required fixtures/projects

| Fixture | Purpose |
|---|---|
| GOLDEN | Fresh generated project with two in-scope features, declared criteria, complete flow/error paths, screens/components, two entities, complete API contracts, a success metric, linked plan tasks, an executable first milestone, and a committed readiness review. |
| MINIMAL | No success metrics, no privacy/security signals, and no safety restriction. Proves both conditional sections are genuinely not required. |
| SENSITIVE | PII fields/privacy rules, a safety restriction, and at least two success metrics. Proves both cross-cutting sections are required and independently evaluated. |
| LEGACY | Pre-#334 Data Model table endpoints, plan with neither conditional section, optional fields absent, and legacy task statuses. Proves additive compatibility without migration. |
| DEGRADED | Missing or errored User Flows and Component Inventory, plus an Implementation Plan generated with degraded context. Proves `impactedBy`, visible failure, Retry, and auto-resume behavior. |
| DRIFTED | Approved GOLDEN packet with one downstream artifact regenerated, one manually edited, and one validation issue accepted with rationale. Proves drift, warnings, and re-approval. |
| READ_ONLY | Same content as GOLDEN with persistence/generation capabilities disabled. Proves approval, retry, and Decision Center write actions are absent/disabled. |

Use exported local state and `npm run e2e -- --state=<file>` for repeatability.
Never hand-edit a synced production project to create a negative fixture.

## 7. P0 end-to-end cases

### QA-E2E-001 — Fresh golden packet

1. Create a new project from a specific product idea and complete PRD generation.
2. Commit the product reasoning through Review readiness. If using accepted risk,
   record a meaningful rationale.
3. Generate the build foundation.
4. Verify six core slots settle: Design System, User Flows, Screen Inventory,
   Component Inventory, Data Model, and Implementation Plan; also verify the
   mockup specification settles.
5. Open the graph and confirm the three-layer plan dependency and explicit
   Component Inventory → Mockup edge.
6. Inspect User Flows, Screens/Components, all three Data Model sections, and
   the Implementation Plan.

**Expected:** no slot remains queued/generating; the plan provenance includes a
User Flows version; no output is silently omitted; the Final Review count equals
the rendered blocker list; the Planning State Bar keeps product reasoning and
implementation packet as separate facts.

### QA-E2E-002 — Resolve, approve, and start

1. From an incomplete packet, click **Resolve N blockers**.
2. Verify the list order follows the eight-criterion order and N exactly matches
   the list length.
3. Resolve each blocker and return to Final Review.
4. Verify the primary becomes **Approve build packet**, approve it, and reload.
5. Verify the primary becomes **Copy first implementation prompt** or **Start
   first slice** and no other filled primary appears on any plan tab.

**Expected:** approval survives reload, records time and artifact manifest, and
never substitutes prompt copy/task conversion for approval.

### QA-E2E-003 — Approval drift and re-approval

1. Approve GOLDEN.
2. Regenerate Data Model or User Flows.
3. Return to Final Review and inspect the manifest.
4. Re-approve, reload, and inspect again.

**Expected:** the changed row reports **Changed since approval**; the old approval
does not authorize Start; the primary is **Re-approve build packet**; re-approval
pins the new version without deleting history. The plan host row must not become
instantly superseded merely because the approval overlay appended a version.

### QA-E2E-004 — Degraded dependency and recovery

1. Use DEGRADED with User Flows missing/errored and Component Inventory errored.
2. Allow the plan to exist with degraded optional flow context.
3. Open Final Review and Screens.
4. Retry Component Inventory, then repair/regenerate User Flows and the plan.

**Expected:** missing User Flows appears through packet currency/`impactedBy` even
if the plan node itself says up to date; Component Inventory holds output readiness
back, is visibly failed in Screens, and offers Retry; recovery removes blockers
without duplicating artifact slots.

### QA-E2E-005 — Persistence and capability boundaries

1. Reload after plan commitment, output generation, packet approval, task status
   changes, warning acknowledgement, and Decision Center flagging.
2. Repeat the surface walk in READ_ONLY.

**Expected:** editable-state overlays persist and history remains append-only;
READ_ONLY shows the report but cannot approve, retry, create a planning concern,
or mutate task progress. No write action appears to succeed and then silently
does nothing.

## 8. Eight-criterion negative matrix

Run each row against a known passing GOLDEN fixture, changing only the named
input. Verify the Final Review count, criterion disclosure, blocker/warning copy,
action target, and recovery transition.

| ID | Criterion / mutation | Expected result |
|---|---|---|
| QA-GATE-001 | Remove a required output version. | `artifacts_present` blocks, names the output, and routes to generation. |
| QA-GATE-002 | Mark a slot errored or interrupted. | Presence blocks; failure is not downgraded to advisory. |
| QA-GATE-003 | Leave a slot generating. | Presence blocks until settled; no premature approval. |
| QA-GATE-004 | Change User Flows after plan generation. | `sources_current` blocks the stale plan. |
| QA-GATE-005 | Remove/error an upstream dependency while the dependent status remains `up_to_date`. | `sources_current` still blocks from `impactedBy`. |
| QA-GATE-006 | Manually edit an otherwise current artifact. | Warning with owner, impact, and rationale; no blocker solely for authorship. |
| QA-GATE-007 | Create unresolved blocking validation. | `validation_clear` blocks and routes to that output. |
| QA-GATE-008 | Accept the same issue with a recorded rationale. | It becomes a warning; rationale is shown/preserved. |
| QA-GATE-009 | Remove every covering task for an in-scope feature. | `requirement_coverage` blocks for that feature. |
| QA-GATE-010 | Remove all criteria from an in-scope feature. | Coverage blocks and routes to the feature. |
| QA-GATE-011 | Keep a task but remove milestone/plan verification text. | Coverage blocks because “implemented” cannot be checked. |
| QA-GATE-012 | Leave only an out-of-scope feature uncovered. | Warning, not blocker. Test the all-features fallback separately. |
| QA-GATE-013 | Remove a core field from a first-slice endpoint. | `api_contract` blocks and names the exact missing field. |
| QA-GATE-014 | Remove only pagination/idempotency/rate-limit/tests. | Warning; packet may remain complete. |
| QA-GATE-015 | Make an incomplete endpoint later-slice only. | Warning that clearly says it is not first-slice blocking. |
| QA-GATE-016 | Make all endpoints impossible to tie to the first slice. | `synapse`-owned warning states contracts were not gated; no silent pass. |
| QA-GATE-017 | Give Data Model no endpoint entries. | API criterion blocks; malformed/unparseable data also blocks validation. |
| QA-GATE-018 | Trigger privacy/safety but omit Security & Privacy. | `cross_cutting` blocks and lists the trigger/gaps. |
| QA-GATE-019 | Declare success metrics but omit Measurement or one metric mapping. | Cross-cutting blocks and names each unmapped metric. |
| QA-GATE-020 | Link a control/metric to a nonexistent task. | Cross-cutting blocks for the dangling task link. |
| QA-GATE-021 | Leave only advisory metric properties/task links absent. | Warning, not blocker. |
| QA-GATE-022 | Remove the first milestone or all its tasks. | `first_slice` blocks. |
| QA-GATE-023 | Give the first milestone a dependency or an external task dependency. | First slice blocks and names the dependency. |
| QA-GATE-024 | Remove all DoD/gates/commands from the first milestone. | First slice blocks for no completion check. |
| QA-GATE-025 | Make the first milestone executable but UI-only/data-only. | Warning about verticality; not a blocker. |
| QA-GATE-026 | Remove the current readiness commitment. | `reasoning_committed` blocks even if the live projection says ready. |
| QA-GATE-027 | Bind the commitment to another spine or make provenance unverifiable. | Fail closed; re-run Review readiness is the remedy. |
| QA-GATE-028 | Commit `not_ready` with rationale. | Warning with accepted risk. Without rationale, it blocks. |

## 9. Workstream-specific functional cases

### W1 — identity and traceability

- QA-W1-001: reorder a feature's criteria; derived IDs remain unchanged.
- QA-W1-002: reword exactly one criterion; exactly one ID changes.
- QA-W1-003: verify bullet/checkbox/case decoration resolves as normalized.
- QA-W1-004: verify conservative prose variation resolves as fuzzy and is
  visibly labelled derived rather than confirmed.
- QA-W1-005: verify unrelated prose returns unmatched and surfaces a traceability
  warning instead of being dropped or auto-linked.
- QA-W1-006: verify duplicate criterion text under two features resolves
  deterministically and does not create duplicate IDs within one feature.
- QA-W1-007: trace one in-scope feature end to end: feature → flow → screen →
  component/entity/API → task → verification.

### W2 — flows as a plan source

- QA-W2-001: prove the Implementation Plan starts after User Flows settles on a
  healthy run and records its exact source version.
- QA-W2-002: include alternate, decision, edge, and error paths late in a long
  flow artifact; prove all survive the dependency summary and appear as plan
  work or explicit deferred scope.
- QA-W2-003: regenerate only User Flows; prove plan freshness and manifest drift
  update without marking unrelated artifacts incorrectly.
- QA-W2-004: fail User Flows; prove degraded plan generation is honest and final
  packet approval remains blocked until repaired.
- QA-W2-005: measure added plan latency versus the previous two-layer pipeline
  and record it; no fixed threshold is set by the PR, but regression should be
  visible in the E2E report.

### W3 — API contract and Data Model review

- QA-W3-001: inspect Schema → API Contract → Privacy & Security ordering and
  each completeness chip.
- QA-W3-002: round-trip complete endpoints with auth, schemas, multiple errors,
  special characters, `none` values, requirement IDs, and tests.
- QA-W3-003: load legacy table-form markdown; it renders, is labelled Stub, and
  does not crash or lose the original four fields.
- QA-W3-004: verify missing fields listed in the endpoint card exactly match the
  gate's field vocabulary.
- QA-W3-005: verify auth coverage and PII-without-rule indicators in Privacy &
  Security.
- QA-W3-006: export markdown and structured JSON; parse them and compare endpoint
  contracts to the reviewed preferred version.

### W4 — Components inside Screens

- QA-W4-001: expand Components on desktop and mobile; all categories, props,
  usage, accessibility notes, and summary counts render.
- QA-W4-002: follow a component's screen back-reference; it opens the correct
  current screen even after a display-name overlay.
- QA-W4-003: create a screen citation with no inventory match; one advisory
  appears and **Open screen** navigates correctly.
- QA-W4-004: verify partial name matching is labelled derived/partial and short
  generic names do not produce false joins.
- QA-W4-005: verify an unused component and an unknown `usedIn` screen are
  informational, not blockers.
- QA-W4-006: verify failure/interruption/in-flight/empty/success states and Retry.
- QA-W4-007: verify Component Inventory appears in Dependency Graph, Sync outputs,
  export, manifest, and build-packet required slots, but not as a separate
  sidebar destination.
- QA-W4-008: confirm an errored component slot auto-resumes once, does not spin
  invisibly, and does not create a duplicate artifact.

### W5 — cross-cutting obligations and Decision Center

- QA-W5-001: MINIMAL renders no empty Security/Measurement sections or flags.
- QA-W5-002: SENSITIVE shows each trigger source and a separate status for
  Security & Privacy and Measurement.
- QA-W5-003: one control per obligation includes requirement IDs, existing task
  IDs, tests, and implementation detail; missing implementation is advisory.
- QA-W5-004: every declared metric maps to event, trigger, validation, properties,
  and task; normalized label variants match without dropping a metric.
- QA-W5-005: open questions keep a required section unresolved.
- QA-W5-006: **Address in Decision Center** creates a user-authored normal
  open-question record only after click, reuses the stable source key on repeat,
  opens the new record, and provides a route back to the plan.
- QA-W5-007: read-only/demo shows the obligation report but no write action.
- QA-W5-008: the quiet flag does not duplicate the loud blocker consequence and
  remedy; Final Review remains the only authoritative severity panel.

### W7 — Final Review and approval

- QA-W7-001: all four CTA states (`unavailable`, `resolve_blockers`, `approve`,
  `start_build`) render exactly one primary action.
- QA-W7-002: More actions always contains the applicable prompt/task/copy
  controls and none becomes a second filled primary.
- QA-W7-003: warnings never increase N and show impact; acknowledged warning IDs
  are recorded in the approval overlay.
- QA-W7-004: manifest includes every required output, exact preferred version,
  PRD label, and approval timestamp.
- QA-W7-005: added/changed/removed artifact versions produce the correct drift
  labels and prevent Start until re-approval.
- QA-W7-006: a previously approved packet that acquires a blocker returns to
  Resolve blockers regardless of approval history.
- QA-W7-007: traceability matrix is lazy-mounted, readable on mobile, and links
  to the correct milestone.

### W8 — self-reported task progress

- QA-W8-001: cycle Planned → Started → Implemented (self-reported) → Planned;
  labels, buttons, progress bar, and milestone summary agree.
- QA-W8-002: convert plan tasks, reload, and verify statuses persist without
  changing generated plan content.
- QA-W8-003: load legacy `done`, `in_progress`, `todo`, and import-only `blocked`
  values; labels normalize honestly.
- QA-W8-004: set every task to Implemented and prove packet readiness is
  unchanged when structural verification is missing.
- QA-W8-005: no UI uses bare “Done”, “Complete”, or “Verified” for this state.

## 10. Exact navigation cases

These remain mandatory browser checks even though F1 now has automated coverage.

| ID | Action label | Required landing |
|---|---|---|
| QA-NAV-001 | Open the API contract | Data Model scrolled/focused to the API Contract section, not merely the artifact top. |
| QA-NAV-002 | Open the first milestone | Implementation Plan Roadmap selected and the named milestone focused. |
| QA-NAV-003 | Review coverage | Final Review coverage disclosure expanded or an equivalently exact coverage destination focused. |
| QA-NAV-004 | Open Review readiness | Current readiness checkpoint opens, not an old or live projection-only state. |
| QA-NAV-005 | Feature/planning/output targets | Existing readiness destinations still route correctly with a usable return path. |
| QA-NAV-006 | Component Inventory target | Screens opens with the hosted Components section discoverable and visible. |

For every case, test from Plan and Workspace, then use browser Back/return
controls to ensure the user is not stranded.

## 11. Compatibility, persistence, export, and recovery

- Load LEGACY without migration. Every optional field may be absent; Data Model,
  plan, task progress, export, and version history must still render.
- Approvals and progress must use overlays, append versions when required, and
  survive recovery export/import, sync, cross-tab updates, and reload.
- Restoring older plan content must not delete approval/history. If an approval
  remains attached by overlay rules, currency/validation must still prevent a
  false Start state.
- Export Full Bundle and Structured JSON must include Component Inventory,
  contract fields, plan cross-cutting sections, versions, and stale/approval
  truth. Prompt Pack remains embedded/retired.
- Interrupt each core slot once, especially User Flows, Component Inventory, and
  Implementation Plan. Resume/retry must preserve completed slots and source
  provenance.
- Regenerate a source while another tab is open. Neither tab may clobber the
  approval overlay or display a stale packet as current.

## 12. Accessibility, responsive, and visual QA

- Keyboard-only: expand Final Review blockers, manifest, coverage, Components,
  API cards, cross-cutting flags, and More actions; activate every action and
  verify visible focus.
- Screen reader: status chips have meaningful text; icon-only controls have
  names; ordered blockers announce as a list; progress says self-reported;
  collapsed content is not duplicated unexpectedly in the accessibility tree.
- Focus after navigation: exact target receives focus without a scroll jump back
  to the page top.
- Mobile 390×844: no page-level horizontal overflow; wide matrices/cards have a
  deliberate local scroll/fade cue; targets remain at least 44 px where required.
- 200% zoom and reduced motion: controls stay reachable, text does not overlap,
  and smooth/animated transitions do not obscure state.
- Long-content stress: 30 blockers/advisories, long endpoint paths/schemas,
  multiple metrics, long component names, and 20+ artifact manifest rows remain
  readable and performant.
- Visual regression: capture both incomplete and approved Final Review, expanded
  Components, each Data Model section, warning-only state, superseded approval,
  and read-only state on desktop/mobile.

## 13. E2E automation status and remaining work

Completed in the findings follow-up:

1. The settle contract now requires `component_inventory` and mockup alongside
   the other five active core outputs.
2. A quiescent partial bundle records its missing required subtypes and fails;
   it cannot exit green merely because three artifacts exist.
3. The Screens walk expands and captures Components.
4. Focused tests guard workspace target transport and the API Contract,
   Coverage, first-milestone, and missing-Components destinations.

Remaining improvements before broad release sign-off:

1. Record explicit per-slot terminal status in the E2E report, not only artifacts
   with `currentVersionId`, to distinguish missing from errored/interrupted.
2. Validate a component → screen navigation during the Screens walk.
3. Expand Final Review blockers, manifest, coverage, and cross-cutting flags;
   exercise Resolve/Approve/Re-approve/Start states with deterministic replay
   fixtures.
4. Capture the three Data Model review sections and assert endpoint completeness
   labels.
5. Keep one live generation run for generator/gate agreement, then replay its
   state for negative UI permutations without repeated LLM spend.

Suggested live command:

```bash
npm run e2e -- --viewport=both --views=user-flows,screens,data-model,implementation-plan,dependency-graph
```

Then replay the exported state for focused regression captures:

```bash
npm run e2e -- --state=e2e-results/<run>/state.json --viewport=both --views=screens,data-model,implementation-plan
```

## 14. Closing the original six audit scenarios

Record evidence, not only Pass/Fail:

| Scenario | Evidence required to upgrade the audit |
|---|---|
| 1. Generate all major artifacts | Live report shows all six core slots plus mockup terminal; Component Inventory content/retry is visible; plan provenance includes flows. |
| 2. Product-owner review | Screens/Components, segmented Data Model, obligations, Final Review, versions, and contradiction/warning behavior are manually reviewed. |
| 3. Trace requirement end to end | At least one real feature is traced through flow, screen, component/entity/API, task, and verification with identity/confidence shown honestly. |
| 4. Determine build readiness | All eight negative criteria are demonstrated; reasoning readiness never substitutes for packet readiness; exact blocker navigation works. |
| 5. Hand to a coding agent | Approved manifest, first-slice task/dependency/test detail, contracts, obligations, deferred scope, and copied prompt are reviewed as one coherent handoff. |
| 6. Resolve final inconsistency | Current supported paths—regenerate, accept with rationale, Decision Center flag, and re-approve—are demonstrated; the still-deferred universal resolver is stated explicitly. |

Only after this evidence exists should the audit verdict, scenario result table,
CTA audit, and revalidation conclusion be rewritten.

## 15. Release exit criteria

PR #334 is behaviorally QA-complete when all of the following are true:

- Build, lint, unit tests, smoke E2E, and the corrected live/replay E2E pass.
- Every P0 case and QA-GATE-001 through QA-GATE-028 passes, with screenshots or
  machine-readable evidence for failures/recoveries.
- F1 exact navigation passes or is fixed; F2 cannot produce a false green run.
- No generated well-formed project is permanently blocked by a criterion the
  generator was never asked to satisfy.
- No missing, errored, stale, validation-blocked, uncommitted, or superseded
  packet can reach Approve/Start.
- Approval, warnings, task progress, and Decision Center flags persist correctly
  and respect read-only capabilities.
- Legacy projects and exports remain readable without migration or data loss.
- Desktop/mobile/accessibility checks pass for every new decision surface.
- Known deferrals are explicit in the handoff and are not mislabelled as shipped.
- The original audit's six scenarios are rerun and updated from recorded evidence.
