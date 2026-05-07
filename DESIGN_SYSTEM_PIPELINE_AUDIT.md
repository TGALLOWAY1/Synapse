# Design System Pipeline Audit

This document captures the state of Synapse's Design System Starter artifact
before and during the work tracked on branch
`claude/design-system-contract-U0HMP`. The goal of that branch is to upgrade
the Design System artifact from a passive documentation page into an
operational generation contract used by both the AI image mockup and HTML
mockup pipelines.

## Current Flow (pre-change)

| Concern | State |
|---|---|
| Design System generation | `src/lib/services/coreArtifactService.ts` (lines 145–186) emits **plain markdown** via `callGeminiStream` with no JSON schema |
| Storage | `ArtifactVersion.content` (markdown string); `metadata` is generic |
| Renderer | `src/components/renderers/DesignSystemRenderer.tsx` parses markdown via regex (color swatches, typography table, spacing list) |
| AI image mockup prompt | `src/lib/services/mockupImageService.ts::buildScreenImagePrompt` — fidelity hints only; no design system context |
| HTML mockup prompt | `src/lib/services/mockupService.ts::buildSystemPrompt` — hard-coded Tailwind palette ("indigo-600 for primary actions", "neutral-50 backgrounds"); no design system context |
| HTML mockup render | `src/components/mockups/buildMockupSrcDoc.ts` injects Tailwind CDN + defensive CSS into iframe; **no CSS variables** |
| Artifact dependency metadata | `SourceRef` exists; only `sourceType: 'spine'` is currently used in practice |
| Staleness | `src/store/slices/stalenessSlice.ts` checks the spine ref only; no inter-artifact dependency tracking |
| Cross-artifact context-passing | Mockups receive `prdContent` + optional `structuredPRD` directly as parameters; no artifact-store lookups inside generators |
| Bundle ordering | `artifactJobController.ts`: design_system runs after component_inventory; mockup is in a separate single-slot bucket and may race |

## Integration Gaps

1. The Design System artifact's structured intent (colors, typography, etc.)
   is lost at the markdown boundary — downstream consumers (mockups) cannot
   reliably use it.
2. AI mockup prompts have **zero** awareness of design intent — they only
   know fidelity bands.
3. HTML mockup prompts encode a **hard-coded Tailwind palette** that
   contradicts whatever the user generated as their design system.
4. The HTML mockup iframe has no CSS variable layer, so the mockup HTML
   cannot reference design tokens at render time.
5. Staleness tracking has no concept of "mockup depends on design system",
   so token changes never cue regeneration of dependent mockups.
6. There is no compliance signal telling the user whether their mockups
   actually conform to their design system.

## Minimal-Change Plan

The plan in `/root/.claude/plans/claude-code-prompt-quizzical-wren.md`
describes the full implementation. In summary:

1. Introduce a `DesignTokens` type and a `designSystemTokensSchema` Gemini
   JSON schema. **No** changes to `Artifact`, `ArtifactVersion`, or
   `SourceRef`.
2. Switch the design_system generator to JSON mode; persist the structured
   tokens on `metadata.tokens` and a deterministic `metadata.tokensHash`.
   Auto-render canonical markdown for `content` so the existing renderer
   (and any legacy projects) keep working.
3. Add a `src/lib/designTokens/` module (normalize, hash, CSS-variables,
   prompt-snippet, markdown, validation, barrel).
4. Inject design tokens into both mockup pipelines as **optional**
   parameters; absence is a no-op fallback.
5. Inject `:root { --color-...: ... }` into the HTML mockup iframe.
6. Add soft compliance validation — metadata only, no hard fails.
7. Extend `stalenessSlice` so that **only mockup artifacts** detect
   tokensHash drift via the existing `SourceRef.anchorInfo` field; other
   artifacts are untouched and the PRD spine is never affected.

## Files Touched (planned)

| Path | Type of change |
|---|---|
| `src/types/index.ts` | Add `DesignTokens`, `DesignColorToken`, `DesignTypographyToken`, `DesignComponentToken` |
| `src/lib/schemas/artifactSchemas.ts` | Add `designSystemTokensSchema` |
| `src/lib/designTokens/*.ts` (new) | Normalize / hash / CSS / prompt / markdown / validation utilities |
| `src/lib/services/coreArtifactService.ts` | Switch design_system to JSON mode; emit `tokens`, `tokensHash`, canonical markdown |
| `src/components/renderers/DesignSystemRenderer.tsx` | Add token-aware sections + downstream-usage indicator |
| `src/lib/services/mockupService.ts` | Optional `designTokens` plumb-through; updated system prompt; per-screen compliance metadata |
| `src/lib/services/mockupImageService.ts` | Optional palette/typography injection into image prompt |
| `src/lib/services/artifactJobController.ts` | Resolve design_system tokens at mockup-generation time; record design_system `SourceRef` on mockup versions |
| `src/components/mockups/buildMockupSrcDoc.ts` | Inject `:root` CSS variables block when tokens present |
| `src/components/mockups/MockupHtmlPreview.tsx` | Forward `designTokens` prop |
| `src/components/mockups/MockupViewer.tsx` | Resolve tokens from store; surface compliance warnings |
| `src/store/slices/stalenessSlice.ts` | Add design-system tokensHash drift check (mockup artifacts only) |
| `DESIGN_SYSTEM_PIPELINE_AUDIT.md` | This document |

## Risks

| Risk | Mitigation |
|---|---|
| Switching design_system to JSON mode could break old projects in localStorage | Renderer falls back to markdown when `metadata.tokens` absent; legacy projects unaffected |
| Gemini JSON-mode failure for design_system | Catch and fall back to legacy markdown generation path |
| Mockup generated before design_system in same bundle (race) | Tokens treated as "use if available"; absence is no-op; identical to today's behaviour |
| `SourceRef` semantic change | None — only adds rows; existing `'spine'` ref semantics untouched |
| Validation false positives | Soft warnings only, no quality blocking, collapsible UI |
| Staleness regression on PRD or unrelated artifacts | New check is gated to mockup artifact type; existing spine check untouched |
| Tailwind + CSS variables conflict in iframe | Tailwind handles layout; CSS variables only used inside `style="…"` for brand-specific values; explicit prompt instruction |

## Limitations Documented

- `tokensHash` compares the **whole** token object. A token-name rename
  (functionally equivalent values) still counts as drift. Acceptable for
  v1.
- Manual edits to the design system markdown do not create a new
  `ArtifactVersion` (this is the existing system behaviour) — therefore
  hash never changes and mockups stay `current`. This naturally satisfies
  the "explanatory copy changes shouldn't mark mockups stale" requirement
  but means the user must regenerate the design system to propagate
  any change.

## Verification

### Final state

The design system pipeline is now an enforced generation contract:

1. The `design_system` core artifact is generated via Gemini JSON mode
   against `designSystemTokensSchema`. The structured output is
   normalized into a canonical `DesignTokens` object, hashed
   deterministically (FNV-1a), and persisted on
   `ArtifactVersion.metadata.tokens` plus `metadata.tokensHash`. A
   canonical markdown body (which the existing renderer can still parse)
   is stored on `ArtifactVersion.content`.
2. The Design System artifact UI now has seven sections: Token
   Summary (counts + hash badge), Color Tokens (grouped by namespace),
   Typography Tokens (live previews), Spacing & Radius (proportional
   bars), Component Tokens (recipe cards), Usage Rules, and Downstream
   Usage Status (with a warning when no consumer exists yet). Old
   markdown-only artifacts continue rendering via the legacy fallback
   path.
3. AI image mockups (gpt-image-2) inject a compact palette + typography
   brief into the prompt via `tokensToImagePromptBrief`.
4. HTML mockups (Gemini) inject the full token catalog and rules via
   `tokensToPromptSnippet`. The "Tailwind utilities exclusively" rule
   is relaxed to permit inline `style="background:
   var(--color-brand-primary)"` — Tailwind still drives layout.
5. The HTML mockup iframe (`buildMockupSrcDoc`) prepends a
   `<style>:root { --color-...: ...; --typography-...: ...;
   --spacing-...: ...; --radius-...: ... }</style>` block before
   Tailwind loads, so generated HTML referencing those variables
   resolves synchronously.
6. Mockup generation runs `validateMockupHtmlAgainstTokens` per screen
   when tokens are present; results are persisted in
   `ArtifactVersion.metadata.designSystemCompliance` and surfaced in
   `MockupViewer` as a collapsible warning callout. Soft-only — never
   blocks generation.
7. `stalenessSlice` has been extended with a mockup-only check: when a
   mockup carries a `core_artifact` `SourceRef` with `anchorInfo`
   (tokensHash) that no longer matches the project's preferred design
   system, the artifact returns `possibly_outdated`. Identical token
   regenerations leave hashes unchanged → mockups stay current. The PRD
   spine boundary is preserved; non-mockup artifacts are unaffected.

### Files changed (final)

| Path | Change |
|---|---|
| `DESIGN_SYSTEM_PIPELINE_AUDIT.md` | This document |
| `src/types/index.ts` | Added `DesignTokens`, `DesignColorToken`, `DesignTypographyToken`, `DesignComponentToken` |
| `src/lib/schemas/artifactSchemas.ts` | Added `designSystemTokensSchema` |
| `src/lib/designTokens/normalize.ts` | New — `normalizeDesignTokens` |
| `src/lib/designTokens/hash.ts` | New — `hashDesignTokens` (FNV-1a, double-pass) |
| `src/lib/designTokens/cssVariables.ts` | New — `tokensToCssVariables` + `tokensToCssStyleBlock` |
| `src/lib/designTokens/promptSnippet.ts` | New — `tokensToPromptSnippet` + `tokensToImagePromptBrief` |
| `src/lib/designTokens/markdownRenderer.ts` | New — `designSystemTokensToMarkdown` |
| `src/lib/designTokens/validation.ts` | New — `validateMockupHtmlAgainstTokens` |
| `src/lib/designTokens/storeSelectors.ts` | New — `selectPreferredDesignSystem`, `selectPreferredDesignTokens` |
| `src/lib/designTokens/index.ts` | New barrel |
| `src/lib/services/coreArtifactService.ts` | Switched design_system to JSON mode; returns `{ content, metadata? }` shape |
| `src/lib/services/mockupService.ts` | Token-aware system prompt; per-screen compliance metadata |
| `src/lib/services/mockupImageService.ts` | Optional palette/typography injection into image prompt |
| `src/lib/services/artifactJobController.ts` | Threads tokens to mockup generation; records design_system source ref + hash |
| `src/components/renderers/DesignSystemRenderer.tsx` | Token-aware UI + downstream usage indicator (legacy markdown fallback preserved) |
| `src/components/renderers/index.tsx` | `metadata` and `projectId` plumbed to design_system renderer |
| `src/components/ArtifactWorkspace.tsx` | Forwards version metadata + projectId; passes compliance to MockupViewer |
| `src/components/AdminCaptureDemo.tsx` | Updated for new generateCoreArtifact return shape |
| `src/components/mockups/buildMockupSrcDoc.ts` | Injects `:root { --... }` block when tokens present |
| `src/components/mockups/MockupHtmlPreview.tsx` | Forwards `designTokens` prop |
| `src/components/mockups/MockupViewer.tsx` | Resolves tokens from store; surfaces compliance warnings |
| `src/store/mockupImageStore.ts` | Resolves tokens at AI image generation time |
| `src/store/slices/stalenessSlice.ts` | Adds tokensHash drift check (mockups only) |
| `src/lib/__tests__/designTokens.test.ts` | New — 28 unit tests |
| `src/lib/__tests__/mockupService.test.ts` | 2 new tests for token injection / compliance |
| `src/store/__tests__/stalenessSlice.designTokens.test.ts` | New — 6 staleness tests |

### Test results

- `npm test` — **24 test files, 212 tests, all passing.**
- `npx tsc --noEmit` — clean.
- `npm run lint` — clean.
- `npm run build` — clean (one pre-existing chunk-size warning unrelated to this change).

### Residual risks

- The mockup prompt still asks for Tailwind utility classes; the model
  may default to neutral / indigo when the design system is absent,
  matching the pre-change behavior. This is intentional.
- Generation order: design_system runs in the core layer before the
  mockup slot starts, but the mockup slot's separate semaphore could
  theoretically race ahead on a project that already has design_system
  cached. The fall-through path (`designTokens` undefined) is benign.
- Validation is regex-based and intentionally lenient. False positives
  are mitigated by surfacing the warnings in a collapsed `details`
  element so users can ignore them.
- The tokensHash compares the entire DesignTokens object. A
  functionally-equivalent token rename would still trigger drift. This
  is acceptable for v1; documented as a known limitation.
