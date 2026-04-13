# Mockup Creation Audit — 2026-04-13

## 1) Executive summary

Synapse’s core strategy (code-based mockup generation rendered as inspectable HTML/Tailwind) is the right bet for trust and repeatability. The main trust breakages were not from "no output" but from weak quality control: permissive parsing, minimal quality gating, and a preview shell that could make borderline output look worse.

This audit recommends **keep the code-based path** and harden it with:
1. tighter generation contract,
2. normalization/repair,
3. explicit quality scoring + rejection,
4. more stable preview framing.

## 2) Pipeline map (current + strengthened)

### Generation start
- User triggers mockup generation/regeneration in `MockupsView.handleGenerate` / `handleRegenerate`.
- Settings (`platform`, `fidelity`, `scope`, optional `style`, `notes`) are collected and passed to `generateMockup`.

### Service layer
- `generateMockup` in `src/lib/services/mockupService.ts` builds system + user prompt, then calls Gemini through `callGemini`.
- Provider call goes through `src/lib/geminiClient.ts` with model from `localStorage` (`GEMINI_MODEL`, default `gemini-2.5-flash`) and JSON mode schema.

### Output contract
- JSON schema in `src/lib/schemas/mockupSchema.ts` expects `{ version, title, summary, screens[] }` where screen has `{ name, purpose, html, notes? }`.

### Parse + validation
- Raw JSON is parsed in `parseMockupPayload`.
- Existing checks: object shape, non-empty screens array, non-empty names, minimum HTML length.
- **Strengthened in this pass:**
  - HTML normalization + sanitation before storage,
  - quality scoring (structure/content heuristics),
  - fail-closed for low-trust screens,
  - warning propagation for skipped screens.

### Storage
- Saved as artifact version JSON (`metadata.format = mockup_html_v1`) in project store via `createArtifactVersion`.

### Rendering
- `MockupViewer` renders selected screen through `MockupHtmlPreview` iframe using `buildMockupSrcDoc`.
- `buildMockupSrcDoc` wraps normalized fragment into full document with Tailwind CDN.
- `MockupErrorBoundary` protects the panel from render crashes.

### Failure handling
- Service throws on total failure (e.g., bad JSON or zero usable screens).
- Partial failures now produce warnings and skip bad screens.
- UI surfaces warnings and preserves last good version on regeneration failure.

## 3) Failure mode inventory and trust impact

### A. Generation / prompt / contract
1. **Generic dashboard sludge disconnected from PRD intent**
   - User sees polished-looking but semantically empty UI.
   - Trust impact: high (looks fake).
   - Cause: prompt ambiguity + weak downstream checks.

2. **Placeholder copy ("Lorem ipsum", "Button 1")**
   - User sees obvious template filler.
   - Trust impact: high (low-effort signal).
   - Cause: no hard rejection before display.

3. **Inconsistent shell across multi-screen outputs**
   - User sees screens that feel from different products.
   - Trust impact: medium/high.
   - Cause: coherence guidance was present but unenforced.

### B. Parsing / orchestration
4. **Permissive acceptance of low-quality HTML**
   - User sees malformed or skeletal fragments framed as completed artifacts.
   - Trust impact: high.
   - Cause: validation only checked short length + required fields.

5. **Partial output accepted without strong quality messaging**
   - User sees fewer screens than expected; unclear confidence level.
   - Trust impact: medium.
   - Cause: warnings existed but not quality-centric.

### C. Rendering / presentation shell
6. **Awkward framing and cramped previews**
   - User sees outputs clipped or visually compressed.
   - Trust impact: medium.
   - Cause: plain iframe container with limited framing context.

7. **Sanitization split across preview only**
   - User-facing stored artifact could retain uneven wrappers/format.
   - Trust impact: medium.
   - Cause: cleanup occurred at render-time, not generation-time.

## 4) Root causes

- Output contract was syntactically constrained but not quality-constrained.
- No first-class quality scoring / rejection step.
- Sanitization and normalization were not centralized.
- Preview shell did not always compensate for rough edges in generated layout.

## 5) Recommended direction

**Chosen direction:** keep code-based mockups and harden pipeline.

- Constrain generation with explicit layout contract.
- Normalize + sanitize before persistence.
- Run heuristic quality gate and reject low-trust screens.
- Preserve partial success only when remaining screens clear the quality bar.
- Improve presentation shell so credible output looks intentionally presented.

## 6) Prioritized fixes

1. Introduce reusable quality/normalization module.
2. Integrate quality gate in `parseMockupPayload` fail-closed path.
3. Tighten prompt with required structural contract.
4. Tighten response schema bounds (`screens` min/max).
5. Improve iframe presentation shell and mobile framing.

## 7) Risks / tradeoffs

- More rejection can increase regeneration frequency and latency.
- Heuristic gates can false-positive on intentionally minimal wireframes.
- Tailwind CDN runtime inside iframe remains a dependency for preview quality.

Mitigation: warnings explain skipped screens; thresholds can be tuned; wireframe mode still allowed via structural minimums instead of visual maximalism.
