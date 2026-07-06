# Prompt Architecture Audit & Redesign Proposal

**Date:** 2026-07-06
**Scope:** every prompt, prompt fragment, prompt-building utility, and prompt-adjacent
contract in the Synapse codebase (`src/` + `api/`), treated as one architecture.
**Status:** audit + proposal only — no prompt text has been changed. Individual prompt
rewrites should happen only after this architecture is reviewed and the shared layers
in §6 exist.

---

## 1. Executive summary

Synapse's prompt surface is large (~50 distinct prompt objects across ~20 files,
~6,700 lines of prompt-bearing code) and in most places thoughtfully engineered:
the artifact prompt assembler (`artifactPromptBuilder.ts`) with its machine-checkable
source hierarchy, the canonical PRD spine, the schema-enforced "lean PRD" slices, and
the prompt-rule-mirrored-by-code-guard pattern (consistency review, roles sanitizer,
safety gate) are genuinely strong designs worth preserving and extending.

But the ecosystem grew feature-by-feature, and it shows. The main structural problems,
in order of impact:

1. **The system/user split is broken on the PRD side.** Every PRD section call, the
   single-section retry, the consistency review, and the grounding backfill pass an
   **empty string** as Gemini's `systemInstruction` and concatenate what the code
   calls the "system" prompt into user content. Only artifact generation, the safety
   classifier, preflight, branch, and enhance use the real slot. Half the app's
   "system prompts" are not system prompts.
2. **The safety policy exists in four independently-drifting copies** (classifier
   system instruction, `SAFETY_OVERRIDE`, restriction-directive fallback, blocked-review
   markdown fallback), and they have already diverged.
3. **Cross-cutting instructions are copy-pasted, not composed.** The operating
   contract, role preambles, anti-preamble rules, agent-agnostic rules, platform hints,
   image closing rules, and the roles/permissions denylist each exist in 2–7
   hand-maintained copies.
4. **~10–15% of the prompt code is dead or retired-but-fully-present**, including the
   single largest prompt in the repo (`buildStrategySystemInstruction`, ~1,250 tokens,
   zero callers) and an entire unwired refine path whose format contract conflicts
   with the generation path.
5. **A handful of live conflicts** send the model contradictory instructions today
   (implementation-plan `status` prose vs schema, the internal image prompt's
   "neutral palette" vs the appended brand palette brief, component-inventory prompt
   format vs actual serializer output).

None of these require clever prompt engineering to fix. They require the same move
the codebase already made for data (`canonicalPrdSpine`) and for prompt *assembly*
(`buildArtifactPrompt`): a small number of **shared, tested, single-source prompt
layers** that every call site composes instead of copies. §6 proposes that layered
architecture; §7 orders the work by impact and risk.

---

## 2. Method

Four parallel deep-read passes covered (a) PRD generation, (b) core artifact
generation + prompt assembly, (c) safety/review/repair/preflight/branch, and
(d) mockup/image/design/export/transport, followed by direct verification of every
dead-code and empty-`systemInstruction` claim (grep + call-chain checks) and a
straggler sweep of `src/` and `api/` for template-literal prompts outside the known
files. File:line references below are against the audited tree.

---

## 3. Map of the current prompt architecture

### 3.1 Layers as they exist today (de facto, not by design)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ TRANSPORT   geminiClient.callGemini / callGeminiStream (system, user, cfg) │
│             openaiClient.callOpenAIImage → api/image/generate.js (prompt)  │
│             — no prompt text lives here; JSON enforced via responseSchema  │
├────────────────────────────────────────────────────────────────────────────┤
│ SHARED FRAGMENTS (partially factored)                                      │
│   prdPrompts.ts: SAFETY_OVERRIDE · PROMPT_CONTRACT · RUBRIC_DEFINITION     │
│   designTokens/promptSnippet.ts: buildDesignSystemBrief                    │
│   (everything else that is conceptually shared is copy-pasted)             │
├────────────────────────────────────────────────────────────────────────────┤
│ CONTEXT SERIALIZERS (canonical data → prompt text)                         │
│   canonicalPrdSpine.ts (spine JSON + preamble)                             │
│   artifactOrchestration.ts (guardrails, glossary, dependency context)      │
│   prdSectionPrompts.pick() (ad-hoc upstream JSON slices)                   │
│   preflightPrompts.buildClarificationPromptBlock                           │
│   safetyReviewArtifact.buildRestrictionDirective                           │
├────────────────────────────────────────────────────────────────────────────┤
│ TASK PROMPTS (per generation type)                                         │
│   prdSectionPrompts.builders (8 live + 2 retired)                          │
│   coreArtifactService.CORE_ARTIFACT_PROMPTS (6 live + 1 retired)           │
│   classifyProjectSafety.SYSTEM_INSTRUCTION · prdConsistencyReview.SYSTEM   │
│   preflightPrompts (questions + summary) · branchService (3 prompts)       │
│   prdService.enhancePrompt · mockupImageService / screenInventoryImage-    │
│   Service (image prompts) · exportHandoff.PREAMBLE                         │
├────────────────────────────────────────────────────────────────────────────┤
│ ASSEMBLY                                                                   │
│   buildArtifactPrompt (labeled sections, authority order, machine-checked) │
│   — artifacts only. PRD/review/branch paths assemble by string concat.     │
├────────────────────────────────────────────────────────────────────────────┤
│ ENFORCEMENT (code guards that back prompt rules)                           │
│   Gemini responseSchema (lean PRD slices, artifact schemas)                │
│   prdConsistencyReview.evaluateGuards · prdRolesSanitizer                  │
│   classifyProjectSafety pre-gate · artifactBlockingValidation ·            │
│   artifactTraceabilityRepair (deterministic, append-only)                  │
└────────────────────────────────────────────────────────────────────────────┘
```

The striking asymmetry: **artifact generation has a real architecture**
(spine → serializers → labeled assembly → schema + validators), while the **PRD,
review, branch, refine, and image paths each roll their own** composition with
inline string literals.

### 3.2 Call-site → prompt map (who sends what, where, on which tier)

| Flow | Prompt source | systemInstruction used? | Mode / schema | Model tier |
|---|---|---|---|---|
| PRD section (×8/run) | `prdSectionPrompts.builders` via `SHARED_PREAMBLE` | **No** — `callGemini('', system+"\n\n"+user)` (`progressivePrdGeneration.ts:227`) | JSON, `SECTION_SCHEMAS[id]` | fast/strong per `risk` |
| PRD single-section retry | same builders (incl. 2 retired) | **No** (`prdSectionRetry.ts:77-79`) | JSON, section schema | per section risk |
| PRD consistency review | `prdConsistencyReview.SYSTEM` | **No** (`prdConsistencyReview.ts:113`) | JSON, `reviewResponseSchema` | fast (explicit) |
| Grounding backfill | reuses `grounding` section builder | **No** (`groundingService.ts:41`) | JSON, `groundingSliceSchema` | default |
| Safety classification | `classifyProjectSafety.SYSTEM_INSTRUCTION` | Yes | JSON, `safetyClassificationSchema` | default/Flash |
| Preflight questions / summary | `preflightPrompts` (+`SAFETY_OVERRIDE`) | Yes | JSON, preflight schemas | default/Flash |
| Idea enhance | `prdService.enhancePrompt` | Yes | plain text | default/Flash |
| Branch reply / consolidate (×2 scopes) | `branchService` inline literals | Yes | plain text | default/Flash |
| Core artifact (×6/bundle) | `CORE_ARTIFACT_PROMPTS[subtype].system` + `buildArtifactPrompt` | **Yes** (`coreArtifactService.ts:695,741`) | JSON for 4 subtypes (+retired 1 text), text for user_flows | per-artifact routing |
| Artifact refine | `refineCoreArtifact` (2 inline prompts) | Yes | JSON only for screen_inventory | generation tier |
| Mockup spec | — none (deterministic since `mockupService.ts:14-24`) | — | — | — |
| Mockup image (internal) | `buildScreenImagePrompt` (+`buildDesignSystemBrief`) | n/a | gpt-image-2 | — |
| Screen image (external copy) | `buildExternalMockupPrompt` (+brief) | n/a | user copy-paste | — |
| Agent handoff export | `exportHandoff.PREAMBLE` | n/a | human/agent document | — |

### 3.3 Injected cross-cutting blocks and their ordering

The base PRD prompt is assembled in `prdService.generateStructuredPRD` as
`idea → restriction directive (if restricted) → preflight clarification block`,
and that combined string becomes `ctx.idea` for **every** section — so safety
restrictions and preflight answers are re-embedded 8× per run, *inside* the user
half, *after* each section's preamble. On single-section retry the restriction
directive is **not** re-appended (`prdSectionRetry.ts` rebuilds from the stored
idea only) — see finding C7.

---

## 4. Classification of every prompt by purpose and responsibility

Legend: **LIVE** = production path · **RETIRED** = kept only for legacy data ·
**DEAD** = no production caller.

### 4.1 Policy / safety (should have exactly one source of truth — currently has four)

| # | Prompt | Location | Status |
|---|---|---|---|
| P1 | Safety classifier system instruction | `safety/classifyProjectSafety.ts:42-63` | LIVE (authoritative gate) |
| P2 | `SAFETY_OVERRIDE` in-prompt defense | `prompts/prdPrompts.ts:21-30` (embedded in every PRD section + preflight prompt) | LIVE (defense-in-depth) |
| P3 | `buildRestrictionDirective` | `safety/safetyReviewArtifact.ts:110-128` | LIVE (restricted runs) |
| P4 | Blocked-review markdown (+ concern fallback list) | `safety/safetyReviewArtifact.ts:56-103` | LIVE (user-facing, not sent to model) |

### 4.2 Global style / quality contract

| # | Prompt | Location | Status |
|---|---|---|---|
| C1 | `PROMPT_CONTRACT` | `prdPrompts.ts:35-42` | LIVE (PRD side only) |
| C2 | `RUBRIC_DEFINITION` | `prdPrompts.ts:50-58` | LIVE (PRD side only) |
| C3 | Inline restatements of C1 (anti-hedge/anti-hype) | `prdService.ts:14-24` (enhance), `branchService.ts:20,23,53`, `artifactOrchestration.ts:80-91` (guardrails), `progressivePrdGeneration.ts:517-523` | LIVE — copy-pasted, not composed |

### 4.3 PRD task prompts

| # | Prompt | Location | Status |
|---|---|---|---|
| T1–T8 | 8 live section builders | `prdSectionPrompts.ts:79-269` | LIVE |
| T9–T10 | `data_model`, `implementation_plan` builders | `prdSectionPrompts.ts:161-180,274-301` | RETIRED (legacy retry only) |
| T11 | Single-pass strategy instruction | `prdPrompts.ts:64-114` (+`PLATFORM_CONTEXT` :9-12) | **DEAD** (~1,250 tokens) |
| T12 | Low-confidence refinement pass | `progressivePrdGeneration.ts:517-523` | **DEAD** in prod (`enableRefinementPass:false`, `progressivePrdPipeline.ts:108`) |
| T13 | Idea enhance | `prdService.ts:13-27` | LIVE |

### 4.4 Review / repair prompts (all backed by deterministic guards)

| # | Prompt | Location | Status |
|---|---|---|---|
| R1 | Consistency review `SYSTEM` | `prdConsistencyReview.ts:89-107` | LIVE (guards at :307-317) |
| R2 | Roles/permissions prompt rules | `prdSectionPrompts.ts:201-204` (+ dead twin in `prdPrompts.ts:98`) | LIVE (sanitizer backstop `prdRolesSanitizer.ts`) |

### 4.5 Preflight / conversation prompts

| # | Prompt | Location | Status |
|---|---|---|---|
| F1 | Question generation | `preflightPrompts.ts:19-32` | LIVE |
| F2 | Summary generation | `preflightPrompts.ts:36-47` | LIVE |
| F3 | Clarification block (into PRD) | `preflightPrompts.ts:91-120` | LIVE |
| F4 | Branch reply | `branchService.ts:50-64` | LIVE |
| F5/F6 | Consolidation (local / doc-wide) | `branchService.ts:10-48` | LIVE |

### 4.6 Artifact task prompts + assembly

| # | Prompt | Location | Status |
|---|---|---|---|
| A1–A5 | screen_inventory, user_flows, component_inventory, implementation_plan, data_model, design_system system blocks | `coreArtifactService.ts:49-311` | LIVE |
| A6 | `prompt_pack` system block (~2.6 KB) | `coreArtifactService.ts:238-290` | RETIRED (no new generation) |
| A7 | `HIERARCHY_RULES` + section assembly | `artifactPromptBuilder.ts:76-209` | LIVE |
| A8 | Spine prompt section (+preamble) | `canonicalPrdSpine.ts:429-443` | LIVE |
| A9 | Legacy structured fallback (glossary + summary) | `coreArtifactService.ts:547-576`, `artifactOrchestration.ts:15-19` | LIVE (spine-less PRDs only) |
| A10 | Guardrails / dependency context / screen-roster summarizer | `artifactOrchestration.ts:21-91` | LIVE |
| A11 | Preset directives ×8 + injection wrapper | `designSystemPresets.ts:86-263`, `coreArtifactService.ts:519-524` | LIVE (design_system only) |
| A12/A13 | Artifact refine (screen_inventory / generic) | `coreArtifactService.ts:756-821` | **DEAD** (only barrel export; no caller) |

### 4.7 Image / visual prompts

| # | Prompt | Location | Status |
|---|---|---|---|
| I1 | Internal gpt-image-2 screen prompt | `mockupImageService.ts:41-85` | LIVE |
| I2 | External copy-paste screen prompt | `screenInventoryImageService.ts:48-101` | LIVE |
| I3 | `buildDesignSystemBrief` (shared) | `designTokens/promptSnippet.ts:92-137` | LIVE (feeds I1+I2) |
| I4 | `tokensToPromptSnippet` (HTML-mockup contract, ~400-700 tokens) | `promptSnippet.ts:15-75` | **DEAD** (tests + barrel only; mockup pipeline is LLM-free) |
| I5 | Upload format hint appended to copied prompt | `MockupScreenUpload.tsx:34-40,70` | LIVE |

### 4.8 Human/agent handoff

| # | Prompt | Location | Status |
|---|---|---|---|
| H1 | Export handoff preamble | `exportHandoff.ts:19-30` | LIVE |

### 4.9 Not prompts (verified)

`intentHelper.tsx` (deterministic prefix lookup for UI labels), `feedbackSlice`
(no LLM call), `mockupService.ts` (deterministic spec derivation),
`prdRolesSanitizer.ts` / `artifactTraceabilityRepair.ts` (deterministic repairs),
`generationStages.ts` (UI labels), transport error strings in
`geminiClient.ts`/`openaiClient.ts`.

---

## 5. Findings

### 5.A Structural

**A1 — The "system prompt" abstraction is broken on the PRD side.**
`progressivePrdGeneration.ts:227`, `prdSectionRetry.ts:77-79`,
`prdConsistencyReview.ts:113`, and `groundingService.ts:41` all call
`callGemini('', \`${system}\n\n${user}\`)`. The safety override, operating
contract, and rubric that the code carefully places "first" are ordinary user
content. Consequences: (a) no separation-of-privilege between instructions and
data for the flows most exposed to raw user idea text; (b) inconsistency with the
artifact path, which does use the slot (`coreArtifactService.ts:695,741`); (c) the
LLM Trace Viewer's "Section system instruction" prompt-piece labels
(`progressivePrdGeneration.ts:468-473`) describe a split that does not exist on
the wire.

**A2 — Two different composition styles for the same job.** Artifact prompts are
assembled by a pure, unit-tested builder with named sections, an explicit authority
order, and machine-checkable output (`buildArtifactPrompt`). PRD sections, the
consistency review, branch prompts, and image prompts are assembled by ad-hoc
template literals with hand-rolled labels. Every new instruction added to the PRD
side is a new copy-paste site.

**A3 — Upstream-context serialization is ad-hoc per PRD section.** `pick()`
(`prdSectionPrompts.ts:63-71`) is a good primitive, but each builder invents its own
label for its output: `"Context from product_basics:"` vs `"Context:"` vs
`"Product basics:"` vs `"Grounding entities:"` vs `"Domain entities:"` for the same
kind of block. Sections also `pick` fields that are not declared DAG dependencies,
relying on `missingNote()` degradation; and the retry path passes the **entire**
current PRD as `upstream` (`prdSectionRetry.ts:74`) while the DAG passes only merged
declared-dep slices — the same builder sees different context surfaces on first run
vs retry.

**A4 — Prompt metadata is implicit.** Which model tier, placement, schema,
temperature, and injected fragments a prompt uses is only discoverable by reading
its call site. There is no registry, no versioning, and (outside
`artifactPromptBuilder` and `prdSectionPrompts` tests) no snapshot coverage, so
prompt drift is invisible in review.

### 5.B Duplication (same instruction maintained in N places)

| # | Instruction | Copies | Locations |
|---|---|---|---|
| B1 | Safety policy (category list + defensive carve-out) | 4 | `classifyProjectSafety.ts:42-63`; `prdPrompts.ts:21-30`; `safetyReviewArtifact.ts:113-115`; `safetyReviewArtifact.ts:66,76-77`. Already drifted: "phishing kits (for real attacks)" / "anti-detection" / "covert/silent monitoring" appear only in the classifier |
| B2 | Roles/permissions capability rules + infra denylist | 2 prompt copies + 1 code copy | `prdSectionPrompts.ts:201-204`; dead twin `prdPrompts.ts:98`; regex denylist `prdRolesSanitizer.ts:45-111` |
| B3 | "producing production-grade artifacts for engineering teams" role preamble | 7 | `coreArtifactService.ts:51,74,102,126,203,239,292` |
| B4 | Anti-hedge phrase list ("you could", "might be", …) | 4+ | `PROMPT_CONTRACT` (`prdPrompts.ts:38`); dead strategy :74; guardrails (`artifactOrchestration.ts:80-91`); paraphrased in enhance (`prdService.ts:19-20`) and dead refine (`progressivePrdGeneration.ts:519`) |
| B5 | Anti-marketing cliché list | 3 | dead strategy `prdPrompts.ts:73`; guardrails `artifactOrchestration.ts`; enhance `prdService.ts:18` — the live PRD path itself only has the softer `PROMPT_CONTRACT` phrasing |
| B6 | Agent-agnostic tool ban | 2 | `coreArtifactService.ts:188` (implementation_plan) and `:239` (retired prompt_pack) |
| B7 | Anti-preamble ("Begin your response directly…") | 2 | `coreArtifactService.ts:98,288` |
| B8 | "Spine wins" hierarchy rule stated twice per artifact prompt | 2 per prompt | `artifactPromptBuilder.ts:88-106` and `canonicalPrdSpine.ts:432-439` |
| B9 | Platform hint strings | 2 pairs | `PLATFORM_CONTEXT` (`prdPrompts.ts:9-12`, dead) vs `PLATFORM_NOTE` (`prdSectionPrompts.ts:35-38`, live); image variants byte-duplicated in `mockupImageService.ts:48-51` vs `screenInventoryImageService.ts:28-32` |
| B10 | Image closing rules ("Avoid lorem ipsum…", "No watermarks…") + mid-fidelity style sentence | 2–3 | `mockupImageService.ts:82-83,10`; `screenInventoryImageService.ts:82-84,98-99` |
| B11 | Feature enumeration inside the legacy fallback (glossary + feature list restate the same features) | 2 in one string | `coreArtifactService.ts:548-575` |
| B12 | Field-group names | 3 | prose `coreArtifactService.ts:218-223`; schema enum `artifactSchemas.ts:67-73`; serializer `dataModelMarkdown.ts:10-16` |
| B13 | "formal, professional, implementation-ready language" | 5+ | `PROMPT_CONTRACT`, enhance, branch reply, both consolidation prompts — inline restatement, never imported |
| B14 | `SHARED_PREAMBLE` (~900 tokens) re-sent on every section call | ×8 per run (~7,200 tokens/run) plus idea+restriction+preflight re-embedded ×8 | `prdSectionPrompts.ts:40-46` |

### 5.C Conflicts and contradictions (live, model-visible)

| # | Conflict | Detail |
|---|---|---|
| C1 | implementation_plan `status` | Prompt: "status: ALWAYS 'todo' … never emit any other status value" (`coreArtifactService.ts:165`) vs schema enum permitting `todo\|in_progress\|done\|blocked` (`artifactSchemas.ts:463`) |
| C2 | Internal image prompt palette | `FIDELITY_STYLE_HINTS` mid/high say "neutral palette with one accent color" / "accent color used sparingly" while the appended `buildDesignSystemBrief` supplies a full brand palette (`mockupImageService.ts:10-11,55-57`). The external builder guards this (`screenInventoryImageService.ts:82-84`); the internal one does not |
| C3 | component_inventory format | Prompt declares `#### [ComponentName]` + `**Props/Variants:**` (`coreArtifactService.ts:108-116`) but output is JSON re-serialized to `### {name}` + `**Props:**` (`:327-362`) — the prompt's format contract never reaches storage |
| C4 | Feature count | Dead strategy: "6–14 features" (`prdPrompts.ts:95`); live builder: "8–14" (`prdSectionPrompts.ts:151`) — harmless today, a trap for anyone "restoring" the dead prompt |
| C5 | Refine vs generation format | Generic `refineCoreArtifact` uses no JSON mode even for JSON-mode subtypes (`coreArtifactService.ts:806-820`) — a data_model refine must survive `parseDataModelMarkdown` from free text; a design_system refine would not refresh `tokens` metadata. Its `featureSummary` also drops feature ids (`:768`) against the id-centric guardrails. Dead today, but a footgun if wired |
| C6 | "Refine & enhance model" setting | Settings copy says it drives refinement (`SettingsModal.tsx:357-367`), and it does for branch/enhance (they use the default model) — but `refineCoreArtifact` routes via `selectArtifactModel` and would ignore it |
| C7 | Retry loses the restriction directive | `generateStructuredPRD` appends `buildRestrictionDirective` to the idea for restricted projects (`prdService.ts:98-101`), but `regeneratePrdSection` rebuilds from the raw stored idea — a restricted project's section retry runs with only the generic `SAFETY_OVERRIDE`, not its specific binding constraints |
| C8 | Safety-gate coverage is uneven | `enhancePrompt`, `replyInBranch`, and `consolidateBranch` run with no classification and no `SAFETY_OVERRIDE`. The PRD they downstream into was gated, so risk is bounded, but the asymmetry is undocumented and unprincipled |
| C9 | Stale validation contract | `EXPECTED_HEADERS.screen_inventory` expects "Components"/"Navigation" (`artifactValidation.ts:27`) which the current renderer never emits; superseded by the structured validation path but still present |

### 5.D Dead / obsolete prompt code

| # | Item | Location | Size |
|---|---|---|---|
| D1 | `buildStrategySystemInstruction` + `PLATFORM_CONTEXT` | `prdPrompts.ts:9-12,64-114` | ~1,250 tokens; still demands retired `richDataModel`/`stateMachines`/`implementationPlan` content and duplicates the roles block |
| D2 | `tokensToPromptSnippet` | `promptSnippet.ts:15-75` | ~400–700 tokens; header comment still claims it is "injected into mockup generation prompts" — mockup generation has been LLM-free since `mockupService.ts:14-24` |
| D3 | Low-confidence refinement pass (+ length-based confidence heuristic) | `progressivePrdGeneration.ts:501,517-523` | gated off in prod |
| D4 | `refineCoreArtifact` (both prompts) | `coreArtifactService.ts:756-821` | no caller; carries conflicts C5/C6 |
| D5 | Stale docs/comments describing retired architecture | `prdService.ts:29-38` ("Strategy → Render+Score → Revision", "Pass A", "quality scores"); `progressivePrdPipeline.ts:1-3` ("10 schema-aligned sections" — it's 8); `promptSnippet.ts:2-5` | prose only, but actively misleading |
| D6 | Retired-but-present blocks that are *deliberate* (keep): `prompt_pack` system block (legacy rendering contract), retired PRD section builders (legacy retry), `RETIRED_SECTION_PREAMBLE` | `coreArtifactService.ts:238-290`; `prdSectionPrompts.ts:161-180,274-301` | keep, but isolate + label (see R2) |

### 5.E Terminology drift

- **Document nouns:** the persisted object is a "spine" in code, but prompts say
  "PRD", "PRD document", "Original Document", "product specification", "Product
  Requirements Document". "Spine" never appears in any prompt (fine — but pick the
  prompt-facing noun once and standardize).
- **Unit nouns:** "section" (pipeline/UI) vs "slice" (builders) vs "artifact"
  (downstream) for overlapping concepts.
- **Upstream context labels:** five different labels for the same `pick()` block (A3).
- **Feature referencing:** id-centric everywhere ("canonical id and name") except the
  refine path's id-less `featureSummary`.
- **Design vocabulary:** preset directives ("radii", "surface system", "accent"),
  the brief (token keys `brand.primary`, `surface.card`), and the dead
  `tokensToPromptSnippet` (CSS vars `--color-brand-primary`) use three registers.
- **Enum spellings:** `low/med/high` vs `low/medium/high` mixed across prose and
  schemas.
- **Mockup nouns:** "mockup" vs "screen image" vs "UI mockup" used interchangeably.

### 5.F What is working well (preserve these patterns)

1. **Schema-as-enforcement** for the lean PRD (`prdSchemas.ts` lean variants) — the
   schema physically cannot emit what the prose forbids. This is the strongest
   determinism tool in the app; prefer extending it over adding prose rules.
2. **Prompt rule + deterministic guard pairs** (consistency review HARD RULES ↔
   `evaluateGuards`; roles prompt ↔ `prdRolesSanitizer`; `SAFETY_OVERRIDE` ↔
   classifier pre-gate). Prompts reduce violations; code makes violations harmless.
   Any redesign must keep both halves in lockstep — ideally generated from one spec.
3. **`buildArtifactPrompt`'s labeled authority hierarchy** with exported section
   constants and unit tests — this is the model for all prompt assembly.
4. **The canonical spine**: prompts consuming canonical structured data instead of
   re-serialized prose. The audit's main recommendation is to finish this journey —
   the PRD side still feeds prose+ad-hoc JSON.
5. **`summarizeScreenInventoryDependency`'s "roster first, never truncated"** rule —
   the right truncation philosophy; generalize it.
6. **Trace metadata (`traceMeta.promptPieces`)** — the observability hooks exist;
   they just need to reflect reality (A1) and be driven from a registry (A4).

---

## 6. Proposed target architecture

The goal is a **five-layer composed system** where every instruction lives in
exactly one module and every prompt is assembled, not written.

```
Layer 0  TRANSPORT DISCIPLINE
         callGemini/callGeminiStream unchanged, plus a lint-style rule:
         no call site may pass '' as systemInstruction. A thin helper
         (buildLlmRequest) takes {systemParts[], userParts[]} and owns joining.

Layer 1  POLICY (single source)
         src/lib/prompts/safetyPolicy.ts
           - DISALLOWED_CAPABILITIES: string[]      (the category list, once)
           - DEFENSIVE_CARVEOUT: string             (the carve-out sentence, once)
           - renderClassifierInstruction()          → P1
           - renderInPromptOverride()               → P2 (SAFETY_OVERRIDE)
           - renderRestrictionDirective(result)     → P3
           - renderBlockedReviewMarkdown(result)    → P4
         All four surfaces render from the same constants; a unit test asserts
         each rendered surface contains every capability term.

Layer 2  SHARED FRAGMENTS (the "prompt standard library")
         src/lib/prompts/fragments.ts (pure constants + tiny renderers)
           OPERATING_CONTRACT (today's PROMPT_CONTRACT, adopted app-wide)
           QUALITY_RUBRIC (RUBRIC_DEFINITION)
           ROLE_PREAMBLES = { prdStrategist, artifactEngineer(role), reviewer, … }
           ANTI_PREAMBLE_RULE, AGENT_AGNOSTIC_RULE, SELF_CONTAINED_PROMPT_RULES
           PLATFORM_NOTES = { app, web } (one copy; image variants derived)
           ROLES_PERMISSION_SPEC (B2 — one copy; the sanitizer denylist and this
             fragment exported from one module so they evolve together)
           IMAGE_CLOSING_RULES, FIDELITY_STYLES (with the tokens-aware guard)
         Rule: task prompts may not restate anything that exists here.

Layer 3  CONTEXT SERIALIZERS (canonical data → labeled prompt blocks)
         Keep: canonicalPrdSpine, buildDependencyContext, guardrails,
         clarification block, design brief.
         Add: serializeUpstreamSlice(sectionId, upstream) — one function, one
         label convention ("## UPSTREAM CONTEXT — {section}") replacing the five
         ad-hoc pick() labels; used by both the DAG worker and the retry path so
         first-run and retry see identically-shaped context.

Layer 4  TASK PROMPTS (thin, declarative)
         Each task prompt becomes data: role, task body, format contract,
         schema ref, tier hint — with all shared text referenced from Layers 1–2.
         PRD sections keep prdSectionPrompts.ts; artifact subtypes keep
         CORE_ARTIFACT_PROMPTS; branch/enhance/review move their inline literals
         into the same shape.

Layer 5  ASSEMBLY + REGISTRY
         a) Generalize the buildArtifactPrompt idea into a shared assembler used
            by PRD sections and review/branch flows too: named sections, fixed
            order (policy → role/contract → task → context → format), returns
            {systemText, userText, sections[]} — system/user split decided in ONE
            place (fixes A1 everywhere at once).
         b) src/lib/prompts/registry.ts — a manifest of every prompt id →
            { owner file, placement, mode, schema, tier, fragmentsUsed,
              version }. The trace viewer stamps registry ids into traceMeta;
            snapshot tests render every registry entry against a fixture project
            so ANY textual drift shows up as a reviewed snapshot diff.
```

**Composition order standard** (make today's implicit order explicit and universal):

```
systemInstruction:  [safety override] [role preamble] [operating contract]
                    [quality rubric (where applicable)] [task instruction]
                    [format contract]
user content:       [task inputs / idea] [restriction directive]
                    [clarification block] [labeled context sections in
                    authority order] [appendix]
```

**Determinism principles** to encode as review rules (they already exist implicitly):

1. Prefer schema enforcement over prose (extend a schema before adding a "do NOT
   emit X" sentence; where prose must exist, it cites the schema).
2. Every prompt rule that matters gets a deterministic guard or validator; every
   guard cites the fragment it enforces.
3. Prompts consume canonical structured data (spine, tokens, seeds) — never a
   second hand-written natural-language description of the same facts.
4. Never truncate identity-bearing lists (ids, names, rosters); truncate prose only,
   and say so in the prompt ("detail truncated; full roster above").

---

## 7. Recommendations, ordered by impact vs implementation complexity

Effort: S (&lt;½ day) · M (1–2 days) · L (multi-day). "Behavioral risk" = chance of
changing model output quality, which is the real cost in this codebase.

| # | Recommendation | Impact | Effort | Behavioral risk |
|---|---|---|---|---|
| R1 | **Delete dead prompts** (D1–D4) + fix stale comments (D5): `buildStrategySystemInstruction`, `PLATFORM_CONTEXT`, `tokensToPromptSnippet` (+its tests + barrel export), the refinement-pass branch + confidence heuristic, `refineCoreArtifact` (or wire it deliberately — see R9), stale `EXPECTED_HEADERS.screen_inventory` | High (removes ~2,500 tokens of drift magnets and 3 standing conflicts C4/C5/C6) | S–M | None (no callers — verified) |
| R2 | **Isolate retired-but-needed prompts**: move retired PRD section builders and the `prompt_pack` block into clearly-named `legacy*` modules with a "legacy retry/rendering only — do not extend" header | Medium (stops accidental extension) | S | None |
| R3 | **Single safety-policy module** (Layer 1): four surfaces render from one capability list + one carve-out. Re-sync the drifted category lists in the same change | High (policy correctness) | S–M | Low — keep rendered text near-identical initially; snapshot the four surfaces |
| R4 | **Fix live model-visible conflicts**: C1 (constrain the schema's `status` enum to `['todo']` for generation, or drop the prose), C2 (apply the external builder's tokens-aware style guard to `buildScreenImagePrompt`), C3 (make the component_inventory prompt describe the JSON fields, not a phantom markdown shape), C7 (re-append the restriction directive in `regeneratePrdSection` when the spine carries a restricted review) | High (output correctness + safety) | S each | Low; C2 may visibly *improve* image palette fidelity — eyeball a before/after |
| R5 | **Extract the shared fragments module** (Layer 2) and re-point existing copies: role preambles (B3), agent-agnostic rule (B6), anti-preamble (B7), platform hints (B9), image closing rules + fidelity styles (B10), roles spec (B2, co-located with the sanitizer denylist), operating-contract adoption in branch/enhance (B13) | High (ends copy-paste drift) | M | Low if extraction is byte-identical first, wording unification second |
| R6 | **Unify upstream-context serialization** (Layer 3): one `serializeUpstreamSlice` + one label convention; use it in both DAG worker and retry so retry stops seeing a different context surface (A3) | Medium-high (determinism, retry parity) | M | Medium — label changes are model-visible; verify on a fixture PRD run |
| R7 | **Restore the real system/user split on the PRD side** (A1): route section, retry, review, grounding calls through the Layer-5 assembler so `systemInstruction` actually carries the preamble. Update trace `promptPieces` to match | High (architecture integrity, injection posture) | M | **Medium-high** — placement changes can shift output. Gate behind a flag; A/B a fixture project; roll per-flow |
| R8 | **Reduce the per-run preamble cost** (B14). Important caveat: the 8 section calls are independent requests, so moving text between the user half and `systemInstruction` does **not** reduce tokens — the transport serializes both into every request. Real savings come only from sending less or from provider-side prefix caching: trim `RUBRIC_DEFINITION` to the dimensions each section is actually judged on, drop preamble parts a given section never needs, and keep the shared prefix byte-stable across sections so implicit prefix caching can apply. Placement is a separate question from cost: the user-authored idea and clarification answers must **stay in user content** (per A1's instruction/data separation); only the app-authored restriction directive is a candidate for the system half, and moving it is a placement decision, not a token saving | Medium (cost/latency) | M | Medium — measure output quality on fixtures before/after |
| R9 | **Decide the refine story**: either delete `refineCoreArtifact` (R1) or productize it properly — JSON mode per subtype, id-bearing feature summary, deliberate model routing consistent with the Settings copy | Medium | M (if productized) | n/a today (dead) |
| R10 | **Prompt registry + snapshot tests** (Layer 5b): manifest every prompt, render each against a fixture project in a snapshot test, stamp registry ids into `traceMeta` | High (drift resistance — makes every future prompt edit a visible, reviewed diff) | M–L | None (observational) |
| R11 | **Terminology pass** (5.E): pick canonical nouns (PRD / section / artifact / screen / mockup image), one enum spelling, one design-vocabulary register; apply mechanically across fragments once R5 exists | Medium | S–M (after R5) | Low |
| R12 | **Document the safety-gating map** (C8) and, if desired, add the cheap `SAFETY_OVERRIDE` fragment to branch/consolidate prompts (they edit gated documents, so full classification is likely overkill — but the decision should be recorded, not accidental) | Low-medium | S | Low |

**Suggested sequencing:** R1+R2 (clear the ground) → R3+R4 (correctness) → R5 (shared
layer) → R10 (lock everything with snapshots) → R6 → R7 (flagged) → R8 → R11/R12.
R10 deliberately lands *before* the behavior-affecting moves (R6–R8) so their diffs
are fully visible in review.

---

## 8. Risks in refactoring the prompt architecture

1. **Any textual change is a behavioral change.** Gemini output is sensitive to
   wording, ordering, and placement. Mitigations: byte-identical extraction first
   (R5), snapshot tests before behavior-affecting moves (R10 before R6–R8),
   per-flow feature flags for R7, and fixture-project before/after runs (the LLM
   Trace Viewer + orchestration metrics already provide the observation tooling).
2. **The system-slot migration (R7) is the riskiest single change.** Moving ~900
   tokens from user content to `systemInstruction` changes how the model weighs
   them. It should ship one flow at a time (grounding → consistency review →
   sections → retry), each validated on fixtures.
3. **Legacy data contracts.** The retired prompt builders, `prompt_pack` heading
   shape (`promptPackParser.ts` regexes), `synapse-plan` fence, data-model heading
   round-trip (`dataModelMarkdown.ts`), and `EXPECTED_HEADERS` for
   implementation_plan/data_model are load-bearing for *persisted* artifacts and the
   demo snapshot. Consolidation must not alter any parser-facing format string;
   the registry should tag these as `contract: parser` so edits get extra scrutiny.
4. **Guard/prompt lockstep.** The consistency-review HARD RULES, roles spec, and
   safety policy each have a code twin. Refactors that touch one half must touch the
   other; co-locating them (R3, R5) is itself the mitigation, but the transition
   window is where drift can slip in.
5. **Cache and cost characteristics.** Restructuring shared prefixes changes
   provider-side caching behavior and token counts; R8 should be measured, not
   assumed.
6. **Two-owner files.** `coreArtifactService.ts` mixes orchestration, prompts,
   serializers, and (dead) refine logic in 821 lines; extracting prompts from it
   (R5) risks merge pain with concurrent feature work — do it as a mechanical,
   isolated PR.
7. **Vercel/TS gate.** All refactors must keep `npm run build` (`tsc -b`) and
   `npm run lint` green, including test files (per CLAUDE.md); deleting exported
   symbols (R1) requires sweeping their test imports in the same change.

---

## 9. Concrete implementation notes (functionality-preserving)

- **R1:** deleting `tokensToPromptSnippet` requires removing its export from
  `designTokens/index.ts:4` and its tests in `__tests__/designTokens.test.ts`
  (plus the comment reference in `externalMockupPrompt.test.ts:75`). Deleting
  `refineCoreArtifact` requires removing the `llmProvider.ts:13` re-export.
  `buildStrategySystemInstruction` export removal breaks nothing (verified).
- **R3:** start by defining the constants to render **exactly** today's classifier
  text (the most complete of the four), then regenerate the other three surfaces
  from it; the only intended diff is the re-sync of the drifted terms into
  `SAFETY_OVERRIDE`.
- **R4/C1:** the safe fix is schema-side: generation schema's `status` enum →
  `['todo']` (persisted-task statuses live in `tasksSlice`, not in the generated
  artifact, so nothing downstream reads other values from generation output).
- **R4/C7:** `regeneratePrdSection` should accept the spine's persisted
  `safetyReview` and append `buildRestrictionDirective` to the idea exactly as
  `generateStructuredPRD` does — same module, same function, no new text.
- **R6:** implement `serializeUpstreamSlice` to emit today's JSON via `pick()`
  unchanged, only standardizing the label line; then align the retry path to pass
  the same declared-deps slice the DAG passes (or document that retry deliberately
  sees more).
- **R7:** the assembler change is mechanical — `makeJsonProvider` and the three
  other empty-system call sites already have the `system` string in hand; the flag
  just chooses `callGemini(system, user)` vs `callGemini('', system+user)`.
- **R10:** the registry can start as a plain exported array + one vitest snapshot
  file rendering each entry against a small fixture `StructuredPRD`/spine; wire
  `traceMeta.registryId` opportunistically.
- **Do not** touch `RETIRED_SECTION_PREAMBLE`'s rubric omission (it is a deliberate
  contradiction-avoidance, documented at `prdSectionPrompts.ts:48-52`), the
  spine-section null → legacy fallback behavior, or the "roster first" truncation
  rule — these are correct as-is.

---

## Appendix A — Size ledger (live path)

| Item | Approx. size | Frequency |
|---|---|---|
| `SHARED_PREAMBLE` (safety+role+contract+rubric) | ~900 tokens | ×8 per PRD run (~7,200 tokens) |
| Idea + restriction + preflight block | varies (~200–800 tokens) | ×8 per PRD run |
| Per-section unique instruction text | ~150–400 tokens | ×1 each |
| Artifact system blocks | 1.4–4.9 KB each (implementation_plan largest) | ×1 per subtype per bundle |
| Artifact user prompt (hierarchy+guardrails+spine+deps+appendix) | dominated by PRD markdown appendix + 1,400-char dep slices | ×1 per subtype |
| Consistency review | ~1.3 KB system + full PRD JSON | ×1 per run |
| Image prompts | ~250–400 words with brief | per screen render |
| Dead weight (D1+D2+refine+refinement pass) | ~2,500+ tokens of source | never sent, always maintained |

## Appendix B — Cross-reference to existing docs

This audit is consistent with and builds on: `docs/CANONICAL_PRD_SPINE.md` (the
structured-context direction this proposal generalizes), `docs/LLM_TRACE_VIEWER.md`
(observation tooling for validating prompt changes), and
`docs/IMPLEMENTATION_PLAN_CONSOLIDATION.md` (the prompt_pack retirement whose
prompt-side residue R1/R2 addresses). CLAUDE.md's documented rules (retired
sections, lean-PRD schema enforcement, hidden/retired artifact subtypes) were
treated as constraints, not targets, throughout.
