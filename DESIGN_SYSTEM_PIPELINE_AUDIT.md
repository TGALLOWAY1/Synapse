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

Final summary, files touched, residual risks, and test results will be
appended to this document in the last commit on this branch.
