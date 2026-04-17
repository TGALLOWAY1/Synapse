# Mockup Failure Detection Failure Map — 2026-04-17

## Executive Summary

This document maps end-to-end failure modes in the mockup pipeline from PRD input through user-visible display. The system already has meaningful safeguards (schema-constrained JSON mode, HTML sanitization/normalization, quality gating, alignment critique, React error boundaries), but there are still important blind spots:

- **Static validation is mostly heuristic and regex-based**, so structure can pass while real layout quality fails.
- **Runtime preview success is weakly observed** (iframe renders can silently degrade with no positive success telemetry).
- **Integration and display paths can hide critical quality regressions** by preserving prior versions or surfacing only generic warnings.
- **Determinism/regression risk is unmeasured** (no canary comparisons for small PRD changes).

The highest-risk trust failures are not full crashes; they are plausible-looking but semantically wrong or low-quality mockups that appear “successful” to users.

---

## 1) Pipeline Map in Scope

## 1.1 Input Layer (PRD → prompt)
- Prompt assembly happens in `buildSystemPrompt` and `buildUserPrompt`, combining hard constraints plus PRD text and optional structured PRD context. 
- Style/fidelity/platform/scope modifiers are injected from settings. 

## 1.2 Generation Layer (LLM output)
- `generateMockup` calls Gemini in JSON mode with `mockupSchema`.
- Model can still produce syntactically valid JSON with semantically poor HTML/copy.

## 1.3 Rendering Layer (HTML/Tailwind/iframe)
- HTML is normalized/sanitized via `normalizeMockupHtml` / `sanitizeMockupHtmlForPreview`.
- Final preview runs inside sandboxed iframe with Tailwind CDN loaded by `buildMockupSrcDoc`.

## 1.4 Integration Layer (React/UI injection)
- Parsed payload is persisted as artifact version JSON and later re-hydrated by `tryParsePayload`.
- Viewer (`MockupViewer`, `MockupHtmlPreview`) handles preview/code mode and version navigation.

## 1.5 Display Layer (user perception)
- User trust depends on visual polish, PRD alignment, and consistency signals.
- Errors can be explicit (banner/boundary) or silent (quality drift but render succeeds).

---

## 2) Complete Failure Mode Catalog

Severity scale:
- **Critical**: hard failure / unusable output.
- **Severe**: major quality failure that breaks user confidence.
- **Moderate**: noticeable quality/trust degradation.
- **Low**: subtle but cumulative trust erosion.

Likelihood scale:
- **High**: expected regularly in real traffic.
- **Medium**: occurs intermittently.
- **Low**: edge-case.

| Failure Mode | Layer | Severity | Likelihood | Detection Method |
|---|---|---:|---:|---|
| Gemini returns non-JSON / malformed JSON | Generation | Critical | Medium | Parse exception in `parseMockupPayload`; log error class + raw snippet hash |
| Gemini returns object but no `screens` or empty `screens` | Generation | Critical | Medium | Existing array-length checks + explicit metric for “no screens” |
| All screens rejected by quality gate (total wipeout) | Generation/Render handoff | Critical | Medium | Existing throw when `screens.length === 0`; add rejection reason histogram |
| HTML too short / empty fragments | Generation | Severe | High | Existing `MIN_HTML_LENGTH` + structured warning taxonomy |
| Forbidden tags included (`script/style/iframe/form/...`) | Rendering security | Severe | Medium | Existing regex check + sanitizer rewrite counter |
| Iframe srcDoc build failure | Rendering | Critical | Low | Existing try/catch in `MockupHtmlPreview`; emit observability event |
| Tailwind CDN unavailable/blocked in iframe | Rendering | Severe | Medium | Runtime visual probe: check computed styles for known utility class |
| Internal scroll trap (nested `overflow-y-auto`, `overflow-hidden`) causes blank-looking viewport | Rendering | Severe | Medium | Existing rewrite heuristic + runtime viewport occupancy check |
| HTML invalid but still parseable DOM with broken hierarchy | Rendering | Severe | High | Static DOM parse + required landmark counts + nesting lint |
| Screen missing major sections (header/action/primary/secondary/control) | Input/Generation | Severe | Medium | Contract validator for required section archetypes |
| CSS classes present but visual hierarchy weak | Display | Moderate | High | Heuristic scoring: heading contrast/size ladder, spacing rhythm variance |
| Overflow/clipping on mobile frame | Rendering/Display | Severe | Medium | Runtime screenshot diff + overflow detector (`scrollWidth > clientWidth`) |
| Iframe not loading due to sandbox/browser restrictions | Rendering | Critical | Low | `iframe.onload` timeout + fallback reason code |
| `tryParsePayload` drops malformed screens silently (version appears empty/partial) | Integration | Severe | Medium | Compare stored vs accepted screen counts + user-visible integrity warning |
| Version metadata corruption yields wrong settings defaults | Integration | Moderate | Medium | Existing default fallback + metadata schema validator |
| Regeneration fails and old version remains; user may misread as updated | Integration/Display | Moderate | Medium | Add explicit “regeneration failed, showing previous version” badge/event |
| Alignment critique false negatives (generic UI passes) | Generation QA | Severe | Medium | Expand critique features + PRD-term coverage thresholds + manual sampling |
| Alignment critique false positives (valid minimal UI rejected) | Generation QA | Moderate | Medium | Track rejection appeals + mode-aware thresholds |
| Scope mismatch (single/multi/workflow count drift) | Generation | Moderate | Medium | Existing critique issue + hard guard per scope when strict mode enabled |
| Non-deterministic output quality between identical runs | Systemic | Severe | High | Multi-run variance benchmark (layout/alignment score stddev) |
| Regression on tiny PRD edits (fragility) | Systemic | Severe | Medium | A/B perturbation tests (token-level PRD deltas) |
| Placeholder copy patterns not fully covered by regex | Display trust | Moderate | Medium | NLP placeholder classifier + dictionary expansion telemetry |
| “LLM-looking” generic component vocabulary despite valid structure | Display trust | Severe | High | Semantic novelty/domain-term density scoring |
| Inconsistent multi-screen shell/accent/typography | Display trust | Moderate | Medium | Cross-screen style consistency checks |
| Silent partial success (warnings present but overlooked) | Integration/Display | Severe | High | Promote warnings into persistent severity banner + per-screen status chips |
| Runtime crashes in viewer tree | Integration | Critical | Low | Existing `MockupErrorBoundary`; add crash counters by artifact version |
| Global React render crash outside mockup subtree | Display/App | Critical | Low | Existing `GlobalErrorBoundary`; add crash fingerprinting |
| Large fragment truncation at `MAX_FRAGMENT_LENGTH` degrades completeness | Rendering | Moderate | Low | Existing truncation comment + truncation telemetry flag |
| PRD parsing fallback (no structuredPRD) weakens grounding | Input | Moderate | Medium | Detect low structured context confidence and elevate risk score |
| Prompt over-constraint conflict (model forced into brittle patterns) | Input/Generation | Moderate | Medium | Prompt compliance analyzer: conflicting instruction incidence |

---

## 3) Root Cause Breakdown (Major Failures)

## 3.1 Blank output / near-blank preview
- **Why it happens:** LLM emits nested scroll containers or clipping classes; content renders above fold or hidden.
- **Origin:** Generation HTML structure; sometimes sanitizer rewrites but not always enough.
- **Why safeguards fail:** Current guardrails rely heavily on class-token regex rewrites and low-severity warnings rather than guaranteed layout viability checks.

## 3.2 Invalid HTML/JSX-like fragments that “sort-of” render
- **Why it happens:** Model outputs malformed trees that browsers auto-correct unpredictably.
- **Origin:** Generation quality variation.
- **Why safeguards fail:** Validation checks length/tags/heuristics, not strict DOM schema or structural semantics.

## 3.3 Iframe preview mismatch with expected styling
- **Why it happens:** Tailwind CDN script fails, network restrictions, or script execution quirks.
- **Origin:** Rendering dependency on runtime CDN.
- **Why safeguards fail:** No explicit runtime CSS readiness probe; preview can appear unstyled without a clear reason code.

## 3.4 Missing major sections despite “valid” output
- **Why it happens:** Prompt asks for sections, but model compliance is probabilistic.
- **Origin:** Input/generation contract adherence drift.
- **Why safeguards fail:** No strict validator enforcing required section archetypes per screen before persistence.

## 3.5 Semantic misalignment (generic dashboard sludge)
- **Why it happens:** Model defaults to common SaaS templates.
- **Origin:** Generation priors overpower PRD specifics.
- **Why safeguards fail:** Alignment critique uses token coverage heuristics; domain mismatch can slip through if enough generic overlap exists.

## 3.6 Silent partial failures
- **Why it happens:** Individual bad screens are skipped; surviving screens are saved.
- **Origin:** Intentional tolerant parsing strategy.
- **Why safeguards fail:** Warnings are ephemeral and may not be prominent enough to preserve user understanding of degraded completeness.

## 3.7 Non-deterministic regressions
- **Why it happens:** Stochastic LLM behavior + prompt sensitivity.
- **Origin:** Generation layer.
- **Why safeguards fail:** No continuous determinism monitoring, no regression suite based on fixed PRD fixtures.

---

## 4) Detection Strategy Design (By Detection Type)

## 4.1 Static validation (pre-render)
Use deterministic validators before persistence:

1. **JSON contract validation**
   - Validate required keys/types (`version/title/summary/screens[*]`).
   - Enforce scope-cardinality hard bounds by requested scope.

2. **DOM structure validation**
   - Parse fragment into DOM tree (not regex only).
   - Require exactly one root shell with `min-h-screen`.
   - Require landmarks: one header/nav, one main, at least one section, at least one control.

3. **Safety and policy validation**
   - Keep forbidden tags/protocol checks.
   - Add forbidden inline CSS patterns if style tags are absent but style attributes become abusive.

4. **Content realism validation**
   - Placeholder classifier (regex + lexicon + language-model rule scoring).
   - Domain-term coverage threshold against structured PRD entities/features.

## 4.2 Runtime detection (render-time)

1. **Iframe health checks**
   - `onload` timeout classification: loaded, timed out, failed.
   - Inject lightweight post-load probe script in srcDoc to report: body height, overflow, CSS-applied sentinel.

2. **Layout viability checks**
   - Detect near-empty viewport occupancy (e.g., rendered nodes > N but visible bounding area < threshold).
   - Horizontal overflow detector for mobile/desktop frames.

3. **Crash/error instrumentation**
   - Structured events from `MockupHtmlPreview` catch path and both error boundaries.
   - Version-linked crash fingerprints.

## 4.3 Heuristic scoring (quality/trust)

1. **Structural completeness score**
   - Header/action/primary/secondary/control presence.
   - Section balance (avoid one giant block).

2. **Visual hierarchy score**
   - Typography ladder consistency.
   - Contrast and spacing rhythm (Tailwind scale conformity).

3. **Semantic grounding score**
   - PRD entity mention density in labels/buttons/table columns.
   - Workflow continuity across screen sequence.

4. **Cross-screen coherence score**
   - Accent/class token overlap.
   - Shared shell signature similarity.

## 4.4 Visual signal detection

1. **Screenshot-based checks**
   - Blank/near-blank classifier.
   - Cropping/clipping detector (cut-off CTAs, cut tables).

2. **Template-likeness detector**
   - Identify repeated generic UI motifs detached from PRD nouns.

3. **Perceptual regression tracking**
   - For fixed fixture PRDs, compare new renders against baseline quality envelopes.

---

## 5) Guardrail Audit (Coverage vs Gaps)

## 5.1 Prompt constraints

**Coverage now**
- Extensive system instructions constrain HTML scope, no scripts, semantic tags, layout rules, required sections, and quality bar.

**Weaknesses**
- Prompt-only enforcement is non-deterministic.
- Conflicting constraints can still yield brittle outputs.

**Missing protections**
- Machine-enforced post-generation contract for required section archetypes.
- Explicit PRD grounding assertions with hard reject thresholds beyond current critique score.

## 5.2 Output validation

**Coverage now**
- JSON parse + screens existence.
- HTML normalization/sanitization.
- Quality score with rejection for high-severity issues or low score.
- Alignment critique with high-severity hard fail path.

**Weaknesses**
- Regex heuristics can miss structural/layout defects.
- Quality penalties are coarse and may underfit nuanced trust failures.
- Partial success warnings are easy to miss.

**Missing protections**
- DOM-level structural validator.
- Determinism and regression test harness for fixture PRDs.
- Explicit metric pipeline (rejection reasons, drift trends).

## 5.3 Rendering safeguards

**Coverage now**
- Sanitized srcDoc wrapper.
- CSS defensive overrides for overflow traps.
- Fallback UI when srcDoc unavailable.
- Mockup-scoped and global error boundaries.

**Weaknesses**
- No positive confirmation that Tailwind styles actually applied.
- No runtime “quality degraded” signals when render is technically successful.

**Missing protections**
- iframe runtime telemetry (loaded/rendered/styled).
- Automated visual checks for blank/clipped/unstyled states.

---

## 6) Risk Prioritization (Trust Impact × Frequency × Detectability)

Rank 1 is highest risk.

1. **Semantic misalignment / generic dashboard sludge**
   - Impact: Very high (appears competent but wrong).
   - Frequency: High.
   - Detectability: Medium-hard without stronger semantic checks.

2. **Silent partial failure (screens skipped, weakly surfaced)**
   - Impact: High.
   - Frequency: High.
   - Detectability: Medium (system knows, users may not).

3. **Broken layout that still technically renders**
   - Impact: High.
   - Frequency: Medium-high.
   - Detectability: Medium-hard without runtime visual probes.

4. **Unstyled preview from Tailwind runtime failure**
   - Impact: High.
   - Frequency: Medium.
   - Detectability: Easy if instrumented; currently weak.

5. **Non-deterministic quality variance between runs**
   - Impact: High (trust in repeatability drops).
   - Frequency: High.
   - Detectability: Hard without fixture benchmarking.

6. **Regression on small PRD edits**
   - Impact: Medium-high.
   - Frequency: Medium.
   - Detectability: Hard currently.

7. **Invalid/malformed HTML accepted by heuristics**
   - Impact: Medium-high.
   - Frequency: Medium.
   - Detectability: Medium with DOM validation; weak now.

8. **Overflow/clipping in platform-specific frames**
   - Impact: Medium.
   - Frequency: Medium.
   - Detectability: Medium with runtime geometry checks.

9. **Metadata/payload corruption fallback hiding state issues**
   - Impact: Medium.
   - Frequency: Medium-low.
   - Detectability: Easy if integrity checks are surfaced.

10. **Hard crashes (viewer/global)**
   - Impact: Very high but localized due to boundaries.
   - Frequency: Low.
   - Detectability: High (visible and logged).

---

## 7) Detection Blueprint (Actionable, No Fixes Implemented)

Minimum viable detection stack:

1. **Static gate bundle (blocking)**
   - JSON + scope cardinality validator.
   - DOM structural validator.
   - PRD-grounding threshold check.

2. **Runtime telemetry bundle (non-blocking, high signal)**
   - iframe load/styled/layout probes.
   - structured boundary error events.

3. **Quality analytics bundle (offline/continuous)**
   - rejection reason dashboards.
   - fixture PRD rerun variance tracking.
   - visual regression snapshots for blank/clipping/unstyled classes.

4. **User-visible integrity signaling**
   - persistent per-version status: full pass / partial pass / degraded.
   - explicit note when showing previous version after failed regeneration.

---

## 8) Code Evidence References

- Prompt construction and strict generation constraints: `src/lib/services/mockupService.ts`
- Schema gate for model JSON mode: `src/lib/schemas/mockupSchema.ts`
- Parsing, quality gate, skip-on-failure behavior, alignment critique fail path: `src/lib/services/mockupService.ts`
- HTML sanitizer/normalizer and heuristic quality scoring: `src/lib/mockupQuality.ts`
- PRD alignment critique heuristics and scoring: `src/lib/mockupAlignmentCritique.ts`
- iframe document wrapper and Tailwind runtime dependency: `src/components/mockups/buildMockupSrcDoc.ts`
- Preview fallback behavior: `src/components/mockups/MockupHtmlPreview.tsx`
- Integration parse fallback and generation/regeneration warning behavior: `src/components/MockupsView.tsx`
- Render crash containment: `src/components/mockups/MockupErrorBoundary.tsx`, `src/components/GlobalErrorBoundary.tsx`

