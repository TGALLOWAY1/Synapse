# Synapse Codebase Assessment

## 1. Executive Summary
Synapse has a strong product idea and a genuinely interesting interaction model (branching PRD edits, artifact pipelines, and feedback loops), but the implementation quality is uneven. The app works, but it currently behaves like a fast-moving prototype with production-themed UI rather than a hardened product system. The architecture advertises structure, but key seams (state boundaries, rendering contracts, LLM safety, and test discipline) are soft.

The project is impressive in ambition and breadth, but it is carrying credibility debt: large god-modules, legacy surface area still wired into the UX, weak typed contracts in critical paths, and little automated quality enforcement. If you keep adding features without fixing these foundations, reliability and contributor confidence will degrade quickly.

**Ratings (out of 10):**
- Product clarity: **7.5/10**
- Code quality: **5.5/10**
- Architecture: **5/10**
- UX polish: **6/10**
- Maintainability: **4.5/10**
- Demo/readiness: **7/10**

## 2. What Synapse Appears To Be
- **Inferred product:** AI-native PRD workspace that generates and iterates on product specs, mockups, artifacts, and feedback, with branch/consolidation workflows.
- **Intended user:** PM/founder/designer/engineer hybrid who wants to ideate and operationalize product requirements quickly.
- **Current maturity:** Advanced prototype / pre-production V1.
- **Major ambiguity:** The codebase still carries legacy Dev Plan/Prompt flows in state and homepage badges, while the visible product is now PRD→Mockups→Artifacts→History. That mismatch weakens narrative coherence.

## 3. Strengths
1. **Ambitious, coherent top-level vision.** The product narrative and pipeline are unusually strong for a portfolio app.
2. **Useful domain model breadth.** Spine versions, branches, artifacts, versions, feedback, and history are all represented with explicit types.
3. **Good UX scaffolding for iterative work.** Finalization gates, stale indicators, compare mode, and export are practical touches.
4. **High-value AI prompt and schema investment.** Prompt templates and JSON-mode schemas are substantial and likely improve output consistency.
5. **Fast local-first workflow.** No backend dependency for core use makes demoing easy.

## 4. Major Issues

### Issue 1: Security and deployment model are contradictory
- **Severity:** Critical
- **Why it matters:** You claim local key safety, but the key is in browser storage and sent in URL query params; this is risky and non-enterprise-safe.
- **Evidence:** Local storage key retrieval and URL query-string API key usage in `llmProvider`; settings modal messaging says key "never leaves your machine".
- **Likely impact:** Key leakage risk (browser history/logging/proxy), trust erosion for serious users.
- **Recommended fix:** Move all Gemini calls server-side through authenticated backend routes; never place secrets in query strings; support per-session encrypted server token exchange.

### Issue 2: Architecture is centralized into god modules
- **Severity:** High
- **Why it matters:** `llmProvider` and `projectStore` own too many responsibilities, making changes risky and slow.
- **Evidence:** `llmProvider` mixes transport, prompts, schemas, orchestration, conversion, refinement, markup generation; `projectStore` handles project lifecycle, branching, artifacts, feedback, migration, and staleness.
- **Likely impact:** High regression risk, difficult onboarding, coupling-induced bugs.
- **Recommended fix:** Split into bounded modules: `geminiClient`, `prompts/*`, `parsers/*`, `artifactService`, `branchService`, `historyService`, and thinner Zustand slices.

### Issue 3: “Structured renderer” path is functionally broken / misleading
- **Severity:** High
- **Why it matters:** The UI implies smart structured rendering, but implementation returns JSX unconditionally and never executes markdown fallback logic correctly.
- **Evidence:** `ArtifactContentRenderer` compares JSX element to null (always true). Renderer components only parse JSON, while generation stores markdown-converted content.
- **Likely impact:** Hidden rendering inconsistencies and architecture confusion (“looks typed,” behaves ad hoc).
- **Recommended fix:** Make renderer contract explicit: either store raw structured JSON alongside markdown, or remove structured renderer path until true dual-format storage exists.

### Issue 4: State integrity and UX behavior are fragile in mockup comparison flow
- **Severity:** Medium-High
- **Why it matters:** Compare mode is global state, but versions are selected by currently selected artifact; switching cards can produce confusing compare behavior.
- **Evidence:** `compareMode` and `compareVersions` are component-level singletons; `renderCompareView` reads `selectedArtifactId` globally.
- **Likely impact:** Incorrect user mental model, accidental cross-artifact compare state bleed.
- **Recommended fix:** Scope compare state by artifact ID (map state), and reset compare state on artifact switch.

### Issue 5: Quality gates are weak (no real automated confidence net)
- **Severity:** High
- **Why it matters:** There are no unit/integration/e2e scripts; lint currently fails on main branch.
- **Evidence:** `package.json` lacks test scripts; lint reports hook-order and purity violations.
- **Likely impact:** Regressions become normal, refactors are dangerous, recruiter confidence drops.
- **Recommended fix:** Add test pyramid baseline (store unit tests + critical flow integration tests + one e2e happy path), and make lint/type/test required checks.

## 5. Architecture Assessment
### What is sound
- Clear top-level app shell and route separation.
- Strong conceptual data model for product artifacts and provenance.
- Thoughtful attempt at staleness and versioning.

### What is weak
- Weak boundary between domain logic and UI logic (significant orchestration inside components).
- LLM logic not isolated from transport/security concerns.
- Legacy and current systems overlap in store and homepage labels.

### Hidden coupling
- Artifact source references reuse `projectId` as `sourceArtifactId` for spine references.
- Staleness depends on implicit conventions rather than explicit type-safe lineage objects.

### Scalability/extensibility concerns
- Any new artifact type means touching many places manually.
- Large single-file prompt registry will get brittle fast.

### Deployment/config concerns
- Conflicting architectures: local direct API calls vs serverless API routes both exist.
- Secret handling is not production-grade.

## 6. UX / UI Assessment
### Good
- Workspace layout is rich and demo-friendly.
- Versioning and side panel concepts are clear.
- Error banners and skeletons exist in many places.

### Friction / polish gaps
- Product flow is gated on “Mark Final” before mockups/artifacts, which can feel rigid in exploratory mode.
- Compare UX for mockups is brittle.
- Inconsistent confidence cues (e.g., “All systems operational” static status copy in settings).
- Legacy badges (Dev Plan / Prompts) surface stale product language.

### Mobile/accessibility concerns
- Dense workspace likely weak on smaller viewports.
- Minimal explicit accessibility affordances beyond basic aria labels.

## 7. Data Flow / Reliability Assessment
- LLM failures mostly become user-facing string errors; little structured retry/backoff handling.
- State mutations are synchronous and broad; no transactional safeguards for multi-step flows.
- Staleness calculation is simplistic (single spine ref comparison), vulnerable to future multi-source artifacts.
- Artifact validation is keyword/length heuristic, not schema-backed confidence for markdown outputs.

## 8. Maintainability Assessment
- **Readability:** good in many leaf components, weak in orchestration files.
- **Modularity:** below desired level due to giant store/provider modules.
- **Docs:** ambitious docs exist, but they overstate readiness relative to code robustness.
- **Testability:** currently poor.
- **Onboarding cost:** medium-high due to hidden conventions and mixed legacy/current concepts.

## 9. Enhancement Opportunities
### Must fix now
1. Secure LLM key flow and remove query-string secret usage.
2. Fix renderer contract mismatch and structured rendering lie.
3. Resolve lint failures and enforce CI quality gates.
4. De-legacy homepage/store surface (remove DevPlan/Prompts presentation remnants).

### High-value next
1. Split `llmProvider` and `projectStore` into modules/slices.
2. Add robust async operation state machine for generation/refinement jobs.
3. Introduce artifact lineage model (`source: spine | artifactVersion[]`) with strict typing.
4. Add automated tests for critical user flows.

### Later
1. Multi-user/cloud persistence.
2. Rich diff/merge tooling in branch consolidation.
3. Better accessibility and responsive behavior.

### Avoid for now
1. More artifact types.
2. Additional “wow” UI effects.
3. Premature backend complexity unrelated to key security and reliability.

## 10. Highest-Leverage Plan
### Top 3 changes for next 3 days
1. Security patch: backend proxy + remove API key in URL + env-based secret handling.
2. Fix renderer pipeline + structured/raw dual-storage decision.
3. Unblock quality baseline: lint clean + add core tests.

### Top 5 changes for next 2 weeks
1. Refactor `llmProvider` into domain modules.
2. Refactor store into slices and pure selectors.
3. Remove legacy DevPlan/Prompt product remnants from UI and state exposure.
4. Add integration tests for: create project → generate PRD → generate artifacts → feedback → branch.
5. Improve compare/staleness data contracts.

### Top 5 changes for next 6 weeks
1. Job orchestration layer (queued generation + retry semantics).
2. Better merge/consolidation experience with explicit diff previews.
3. Accessibility pass and mobile layout pass.
4. Performance pass (bundle splitting, lazy boundaries, charting heavy components).
5. Add optional cloud persistence and shareable project links.

## 11. Direct Answers to the Specific Questions
1. **5 biggest quality problems**
   - Secret handling/deployment contradiction.
   - God-module architecture.
   - Fake structured-renderer rigor.
   - Weak testing/quality enforcement.
   - Legacy/current product model inconsistency.

2. **5 strongest parts**
   - Product concept ambition.
   - End-to-end workflow breadth.
   - Versioning + history model intent.
   - Prompt/schema sophistication.
   - Good demoable UI shell.

3. **Where architecture is lying**
   - “Structured renderer” implies typed UI rendering, but runtime path is mostly markdown and renderer fallback logic is broken.
   - Presence of serverless API suggests secure backend path, but active flow is client-side direct key usage.

4. **What feels unfinished or fake-complete**
   - Compare behavior details.
   - Validation quality semantics.
   - Accessibility depth.
   - Legacy labels/stages still visible.

5. **What breaks first under real usage/scale**
   - API-key trust and operational security.
   - Large-state localStorage persistence with growing projects.
   - Regression rate from low test coverage.

6. **Most overcomplicated part**
   - `llmProvider` prompt/orchestration monolith.

7. **Most underdesigned part**
   - Reliability contract for async generation jobs and artifact lineage.

8. **3 improvements to increase trust**
   - Secure backend LLM proxy.
   - Passing CI with tests/lint/typecheck.
   - Clear module boundaries with explicit contracts.

9. **3 improvements to increase product polish**
   - Fix compare UX/state handling.
   - Improve loading/error/retry semantics per artifact job.
   - Remove stale legacy copy and tighten flow language.

10. **3 improvements to increase recruiter value**
   - Add architecture decision records and module diagrams matching actual code.
   - Add robust tests + CI badge + coverage snapshot.
   - Ship one clearly polished “golden path” demo with deterministic fixture mode.

11. **What to remove/simplify/defer**
   - Remove legacy DevPlan/Prompt surfaces from homepage/store UX.
   - Simplify renderer system unless dual-format storage is implemented.
   - Defer new artifact types until reliability baseline is solved.

12. **First 2 weeks takeover plan**
   - **Week 1:** security + lint cleanup + test harness + critical flow tests + remove legacy UX remnants.
   - **Week 2:** split provider/store into modules, fix structured rendering contract, and harden async generation state machine.

## 12. Final Verdict
- **Is this codebase solid?** Not yet.
- **Is it fragile?** Yes, especially around architecture boundaries and quality enforcement.
- **Is it impressive?** Concept and breadth: yes. Engineering rigor: not consistently.
- **Ready for aggressive expansion?** No. Needs a stabilization phase first.
- **Bottom-line recommendation:** Freeze feature expansion for a short hardening sprint. Fix trust, boundaries, and reliability first, then scale features.

## If You Only Fix 5 Things
1. Move LLM calls behind secure backend proxy; eliminate client-secret query param usage.
2. Refactor `llmProvider` into composable modules with strict contracts.
3. Repair/remove fake structured-renderer path and define one truthful artifact rendering pipeline.
4. Add and enforce automated quality gates (lint/typecheck/tests) in CI.
5. Remove legacy product remnants (DevPlan/Prompts) from UI/state surface and align narrative to actual V1.
