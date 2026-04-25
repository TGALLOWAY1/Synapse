# Synapse Mockup Generation Audit & Hardening Plan — 2026-04-22

## 1) Pipeline Audit Report

### 1.1 End-to-end pipeline diagram

```text
User idea (HomePage)
  -> createProject() creates initial spine draft
  -> generateStructuredPRD() (Gemini JSON mode + prd schema)
  -> structuredPRDToMarkdown() + store.updateSpineStructuredPRD()
  -> MockupsView.handleGenerate()/handleRegenerate()
     -> derive settings (platform/fidelity/scope/style)
     -> generateMockup(prdContent, settings, structuredPRD)
        -> buildSystemPrompt(settings)
        -> buildUserPrompt(prdContent, structuredPRD)
        -> callGemini(system, user, JSON mode, mockupSchema, temp/topP/topK)
        -> parseMockupPayload(raw)
           -> JSON parse + schema-shape checks
           -> normalizeMockupHtml() / sanitizeMockupHtmlForPreview()
           -> validateMockupHtmlStructure()
           -> assessMockupHtmlQuality()
           -> critiqueMockupAlignment()
           -> retry up to MAX_GENERATION_ATTEMPTS
           -> fallback template if all attempts fail
     -> createArtifactVersion() with metadata (alignment critique, strategy, fallback flag)
  -> MockupViewer + MockupHtmlPreview
     -> buildMockupSrcDoc(html)
     -> sandboxed iframe (Tailwind CDN in preview)
```

### 1.2 Stochastic boundaries (entropy entry points)

1. **PRD generation** (`generateStructuredPRD`) is model-generated and non-deterministic.
2. **Mockup generation** (`generateMockup -> callGemini`) is stochastic even with low temperature.
3. **Prompt interpretation** is non-deterministic (same constraints, different compliance).
4. **Retry loop** introduces additional randomness between attempts.
5. **Tailwind CDN + browser rendering nuances** can alter final visual result despite identical HTML.

### 1.3 Structure degradation points

1. **Model output quality drift**: valid JSON but semantically weak or generic screens.
2. **Regex-first validators**: malformed structures can still pass if token presence is sufficient.
3. **Partial acceptance path**: bad screens can be dropped while survivors are stored.
4. **Iframe runtime dependency**: rendering can degrade if Tailwind runtime behavior differs.
5. **Fallback overuse risk**: frequent fallback keeps renderability but lowers perceived product sophistication.

---

## 2) Failure Mode Catalog (Ranked)

| Severity | Failure mode | Likely cause | User impact | Reproducibility |
|---|---|---|---|---|
| **Critical** | Non-JSON or malformed JSON response | Model instruction non-compliance | No mockup; hard generation failure | Medium |
| **Critical** | Zero usable screens after validation | Overly weak/unsafe HTML across screens | No generated concept; fallback-only experience | Medium |
| **High** | PRD-semantic mismatch ("generic SaaS sludge") | Weak grounding vs model priors | Trust break: polished but wrong | High |
| **High** | Layout appears blank/clipped | Nested scroll/overflow patterns in generated HTML | User believes generation is broken | Medium |
| **High** | Cross-screen style drift | No strict shell/token enforcement post-gen | Feels like different products stitched together | Medium |
| **High** | Inconsistent outputs for same input | Stochastic LLM + no deterministic renderer contract | Demo instability, hard to trust | High |
| **Medium** | Missing sections (header/secondary controls) | Prompt compliance variance | Reduced usability/readability | Medium |
| **Medium** | Placeholder-ish content | Incomplete copy constraints or heuristics bypass | Amateur signal in recruiter demos | Medium |
| **Medium** | Metadata/version confusion during regen | Version fallback semantics in UI | Users misread old output as new | Low/Medium |
| **Low** | Minor spacing/token inconsistency | Loose Tailwind class generation | Visual polish drift | High |

---

## 3) Consistency & Determinism Test Results

## 3.1 Test harness run executed on **2026-04-22**

Command used:

```bash
npm run mockup:harness -- --runs 4 --max-attempts 3 --outdir harness/results --baseline harness/sample-results/latest/summary.json
```

Run ID: `2026-04-22T05-12-16-746Z-04bc90771a8b`

### 3.2 Quantitative results

- Render success rate: **100.00%**
- Structural validity rate: **100.00%**
- Retry rate: **10.00%**
- Fallback rate: **10.00%**
- Visual quality score: **81.10 / 100**
- Consistency score (same input repeated): **77.50 / 100**

### 3.3 Required tests interpretation

1. **Same Input, Multiple Runs**
   - Observed non-trivial variance: most cases show ~75 consistency (2 unique outputs across 4 runs).
   - Conclusion: deterministic reliability is currently insufficient for high-stakes demo use.

2. **Slightly Modified Input**
   - Suite now includes a small perturbation pair (`simple_landing` and `simple_landing_variant`), but coverage is still too narrow for confidence.
   - Recommended immediate suite extension: add per-case `variant_prompt` with <=10 token edits and compare shell similarity.

3. **Complex vs Simple Inputs**
   - Simple cases avg quality: **78.0**.
   - Medium cases avg quality: **89.0**.
   - Complex cases avg quality: **100.0** (fixture harness behavior, likely optimistic vs production model).
   - Edge cases avg quality: **66.33**, fallback **33.33%**.

4. **Cross-Screen Consistency**
   - Multi-screen fixture cases scored high in quality, but consistency still only ~75 due to run-to-run content variation.

### 3.4 Example diffs between runs

- The harness intentionally emits alternating content tokens (`A`/`B` suffix) across repeated runs, producing controlled layout/content drift and a consistency score penalty.
- This confirms the current score pipeline detects run variance, but it does **not yet** measure semantic-shell invariance deeply (e.g., component graph diff).

---

## 4) Schema & Constraint Evaluation

### 4.1 Current state

- **Schema exists** (`mockupSchema`) and constrains top-level JSON shape.
- **HTML quality checks** exist (`validateMockupHtmlStructure`, `assessMockupHtmlQuality`) but are largely heuristic.
- **Prompt contract is detailed**, including canonical section ordering and constraints.
- **Validation happens before persistence**; retries + fallback protect renderability.

### 4.2 Free-form generation risks still present

1. HTML internals are still free-form strings (not strongly typed layout AST).
2. Semantic adherence is heuristic, not contract-verified against PRD entities/flows.
3. Cross-screen coherence is encouraged by prompt, not enforced structurally.
4. Runtime rendering remains partially dependent on dynamic Tailwind execution.

---

## 5) Validation & Quality Gates Assessment

### 5.1 What exists

- Pre-render checks for structure and quality score.
- Alignment critique and rejection for severe mismatch.
- Retry loop (3 attempts) + safe fallback template.

### 5.2 Gaps

1. No DOM-level contract validator (regex-heavy checks can miss hierarchy defects).
2. No formal quality rubric persisted per screen/version (only warnings).
3. No explicit reject/retry policy by failure class (all treated similarly).
4. No perturbation-based determinism gate in CI.

### 5.3 Proposed quality gate stack

1. **Pre-render gate (blocking)**
   - JSON schema validation
   - DOM parse + landmark invariants
   - required fields + scope cardinality checks
2. **Quality score gate (blocking under threshold)**
   - layout, hierarchy, semantic grounding, consistency sub-scores
3. **Retry policy (typed)**
   - syntax failure: immediate retry with stricter temperature
   - semantic failure: retry with forced PRD entity list injection
   - visual failure: retry with stricter shell template hint
4. **Fallback policy**
   - fallback only after N typed retries
   - attach explicit "safe mode" badge and auto-regenerate CTA

---

## 6) Design System Enforcement Assessment

### 6.1 Current state

- Prompt defines a canonical palette, spacing rhythm, shell conventions.
- Quality checks include minimal style token density checks.
- Multi-screen coherence is requested in prompt text.

### 6.2 Remaining issues

- No centralized runtime-enforced design tokens file used by validator.
- No controlled vocabulary map for component names and semantic roles.
- No cross-screen style signature check before acceptance.

### 6.3 Proposal

1. Define tokens in code (`colors`, `spacing`, `type scale`, `radius`, `shadow`).
2. Validate class usage against approved token classes.
3. Enforce layout primitives (`AppShell`, `PrimaryPanel`, `SupportPanel`, `ActionBar`) at AST/schema level.
4. Gate multi-screen outputs on shell signature similarity (>0.9).

---

## 7) Prioritized Refactor Plan

## Phase 0 (1-2 days): Observability + deterministic metrics

1. Persist per-screen `qualityReport` and `validationReport` in artifact metadata.
2. Add CI harness job for fixed PRD fixtures with variance threshold alerts.
3. Add perturbation test pair cases (baseline vs slight edits).

## Phase 1 (2-4 days): Structure hardening

1. Introduce `MockupLayoutSpec` intermediate schema (JSON AST) instead of raw free-form HTML generation.
2. Deterministic renderer converts `MockupLayoutSpec` -> vetted Tailwind template.
3. Keep HTML path as fallback while migrating.

## Phase 2 (3-5 days): Validation hardening

1. DOM parser-based validator replacing regex-only landmarks.
2. Enforce required primitives and card/section ratios.
3. Cross-screen design signature validator.

## Phase 3 (3-5 days): Quality & retry policy

1. Weighted score model: layout/hierarchy/semantic/coherence.
2. Typed retry prompts based on failure category.
3. Template fallback selection by scope/platform (not one generic fallback).

## Phase 4 (ongoing): Product polish + recruiter demo mode

1. "Demo Safe Mode" toggle: lower creativity, higher determinism.
2. Golden fixtures and visual regression snapshots in CI.
3. Manual review queue for newly introduced prompt/schema versions.

---

## 8) Suggested Code Changes (Concrete)

1. Add `src/lib/schemas/mockupLayoutSpec.ts` for AST schema contract.
2. Add `src/lib/mockupLayoutRenderer.ts` deterministic renderer.
3. Add `src/lib/mockupDeterminism.ts` with structural hash + shell similarity utilities.
4. Extend `scripts/mockup-eval-harness.mjs` with perturbation pairs and component-graph diffing.
5. Add `mockup_quality_report` metadata payload on every generated screen.

---

## 9) Prompt Improvements (Ready to Use)

Use this as the top of your system prompt for deterministic mode:

```text
Deterministic mode is ON.
You MUST output mockup_json_v2 using only approved layout primitives and component IDs.
Do not invent new primitive types.
For each screen:
- root_shell: required
- header_bar: required
- primary_panel: required
- support_panel: required
- actions: at least 1 interactive control
Reuse identical shell_config across all screens unless explicitly marked "state_transition".
Use only token names from token_set_v1.
If unsure, choose the safest valid option instead of creating novel layout structures.
```

User prompt appendix:

```text
Return:
1) layout_spec JSON
2) rationale array (max 4 bullets)
Do NOT return HTML directly.
```

---

## 10) Validation Schema (Draft)

```json
{
  "$id": "mockup_layout_spec_v1",
  "type": "object",
  "required": ["version", "title", "screens", "tokenSet"],
  "properties": {
    "version": { "const": "mockup_layout_spec_v1" },
    "title": { "type": "string", "minLength": 3 },
    "tokenSet": { "const": "token_set_v1" },
    "screens": {
      "type": "array",
      "minItems": 1,
      "maxItems": 5,
      "items": {
        "type": "object",
        "required": ["id", "name", "purpose", "shell", "sections", "actions"],
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string", "minLength": 2 },
          "purpose": { "type": "string", "minLength": 8 },
          "shell": {
            "type": "object",
            "required": ["type", "platform", "accent"],
            "properties": {
              "type": { "enum": ["sidebar_topbar", "topbar_only", "mobile_tab_shell"] },
              "platform": { "enum": ["desktop", "mobile", "responsive"] },
              "accent": { "enum": ["indigo"] }
            },
            "additionalProperties": false
          },
          "sections": {
            "type": "array",
            "minItems": 2,
            "items": {
              "type": "object",
              "required": ["role", "component"],
              "properties": {
                "role": { "enum": ["primary", "support", "utility"] },
                "component": {
                  "enum": [
                    "stat_grid",
                    "data_table",
                    "activity_feed",
                    "filters_bar",
                    "detail_panel",
                    "empty_state"
                  ]
                }
              },
              "additionalProperties": false
            }
          },
          "actions": {
            "type": "array",
            "minItems": 1,
            "items": {
              "type": "object",
              "required": ["kind", "label"],
              "properties": {
                "kind": { "enum": ["primary_cta", "secondary_cta", "input", "select", "tab"] },
                "label": { "type": "string", "minLength": 2 }
              },
              "additionalProperties": false
            }
          }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
```

---

## 11) Critical Success Criteria Readout

Against target state:

- Same input -> structurally consistent output: **Not yet achieved** (consistency 77.50).
- No broken/non-renderable mockups: **Mostly achieved** in harness (100% render + structural pass), but production-model behavior still needs live verification.
- Clear hierarchy + professional UI: **Partially achieved** (quality score 81.10 with edge-case drag).
- Shared design language across screens: **Partially achieved**, prompt-led not strongly enforced.
- High confidence for recruiter demos: **Not yet**; requires deterministic AST pipeline + stronger CI gates.

