---
target: Synapse app UI (src/components)
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-08-04T13-19-55Z
slug: src-components
---
# Synapse UX/UI Critique — `/impeccable critique`

Method: dual-agent (A: design-director review of 28 screenshots + source · B: deterministic anti-pattern detector over `src/components`)

**Evidence base:** 22 audit screenshots (`docs/audits/screenshots-2026-07-10/`, desktop 1440 + mobile 360–430), 6 marketing screenshots (`public/screenshots/`), and source spot-reads (`index.css`, `tailwind.config.js`, `HomePage`, `ProjectWorkspace`, `JourneyRail`, `GenerationProgress`, a11y greps). Detector: 41 findings across 28 files. Browser overlay step skipped (screenshot-based critique; no live session).

**Staleness caveat:** the screenshots are ~3.5 weeks old and show *older* navigation than current code. Audit shots show `Project | Assets | History`; marketing shots show `Plan | Challenge | Explore | History`; current source (`JourneyRail.tsx`) ships a 6-step rail `Define · Refine · Finalize · Generate · Review · Build`. Screenshot-level nav findings are "as captured"; the churn itself is a finding (Issue 2). Screenshots 01/02/05 are broken captures (CSS-not-loaded artifacts — source shows correctly centered layouts), and were not treated as layout bugs.

---

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Best-in-class generation progress: real percentages, per-section model chips, honest `waiting` states, freshness chips everywhere |
| 2 | Match System / Real World | 2 | Unglossed jargon: "P0", "Confirmed est.", "prompt packs", "quality gates", "Generated before version tracking…" |
| 3 | User Control and Freedom | 3 | Append-only versioning and branch-before-merge are real safety; but no visible undo inside editing surfaces, and the demo is read-only with no sandbox escape |
| 4 | Consistency and Standards | 1 | Three top-level navigation systems in ~3 months of artifacts; dark/light theme schism; duplicate finality signals ("Version 1 (FINAL)" badge + green "Final" button) |
| 5 | Error Prevention | 3 | Read-only showcase guard, char-limit warnings, explained-disabled submit, PRD write barrier; "Confirm screen" states no consequence |
| 6 | Recognition Rather Than Recall | 2 | The mockup flow is a working-memory bridge: copy a 200-word prompt → external tool → return → upload |
| 7 | Flexibility and Efficiency | 3 | "Copy next prompt" as primary CTA is excellent; no command palette, shortcut layer, or bulk variant operations |
| 8 | Aesthetic and Minimalist Design | 2 | Raw LLM prompt text rendered as a dominant monospace wall in primary content areas; Implementation Plan header stacks 9 simultaneous paths |
| 9 | Error Recovery | 3 | Genuinely excellent failure copy ("Your saved projects are safe on this device"); docked for ambient yellow warnings across the demo and the unbranded boot spinner |
| 10 | Help and Documentation | 3 | Strong interactive tour and embedded explainer cards; no persistent help entry in the workspace, no legend for status vocabulary |
| **Total** | | **26/40** | **Acceptable — significant improvements needed before users are happy** |

26/40 sits at the top of the "Acceptable" band (20–27): a competent, sometimes excellent Operate-mode surface dragged down by consistency churn, vocabulary debt, and an accessibility floor.

## Design Specificity Verdict

**Split personality: an authored tour bolted onto a category-interchangeable workspace.**

**LLM assessment:** The interactive tour has genuine art direction — dark ground, indigo→violet gradient display type, a finale that literally visualizes the product's name as a connected-artifact constellation. The workspace itself is a generic AI-SaaS dashboard: `tailwind.config.js` extends *nothing but one shimmer keyframe* — no brand tokens, no type scale, no custom font; stock Tailwind indigo-600 on neutral. The deepest irony: the app generates named design tokens for the *user's* product while having none of its own. Where character exists it is verbal, not visual ("Replace belief with evidence" — Decision Center); the "synapse/connection" metaphor appears only in the tour finale and the Dependency Graph, never in daily-driver surfaces. The product also lives in two theme worlds (dark login/tour/chrome, light HomePage/content panes) — two products sharing a URL.

**Deterministic scan:** 41 warnings, but heavily skewed by one unreliable rule. `gray-on-color` (27 hits) is ~96% false positive here — the detector pairs classes across ternary branches and hover states that never co-occur at runtime (verified at 15 locations). The reliable signal agrees with the review: `ai-color-palette` (8) + `gradient-text` (1) confirm the palette is uniformly indigo/violet across product, planning, renderer, and tour surfaces — the canonical "default AI tool" palette, undifferentiated by any token layer; `side-tab` flagged real `border-l-4` category accents on Entity Graph cards (deliberate, but the detector's point about the idiom stands). One `broken-image` hit is a security test fixture (intentional).

**Visual overlays:** skipped — screenshot-based critique per request; no live app session (the app needs a Gemini key + generation to reach meaningful state).

## Overall Impression

Synapse's engineering-honesty is its best design asset — real progress, truthful waiting states, reassuring failure copy — and its packaging is its worst enemy. The demo (the product's shop window) showcases the *no-API-key fallback* on every mockup surface; the marketing screenshots show a navigation system that no longer exists; and the app that generates design systems doesn't run on one. The single biggest opportunity: make the product wear its own ideas — pinned demo images, one committed IA, and a real token layer.

## What's Working

1. **Honest progress engineering as UX craft.** `GenerationProgress.tsx` refuses to fake progress (documented in code), pairs real percentages with per-section model attribution and timing. It converts the longest wait into the most trustworthy moment — rare among AI tools.
2. **Reassurance copywriting at failure points.** "Your saved projects are safe on this device," "Your original prompt was kept," and a demo banner that explains *why* it's read-only. Design maturity most teams never reach.
3. **The Decision Center's opinionated structure.** One assumption at a time, "Why it matters" before the ask, a validation-question input instead of yes/no. The one Operate surface where the product's intellectual character is visible in the interface itself.

## Priority Issues

1. **[P1] The demo showcases the product's failure mode as its centerpiece.**
   Every demo mockup surface shows the no-OpenAI-key fallback: a yellow two-vendor warning and a monospace prompt dump, zero images. Evaluators judge by the demo; its hero artifact is empty.
   **Fix:** ship the demo with pre-generated mockup images pinned (snapshots already support this per `SNAPSHOTS_AND_DEMO.md`); suppress or one-line the key warning in showcase mode.
   **Suggested command:** `/impeccable onboard`

2. **[P1] Navigation identity churn.**
   Three top-level IAs across three months of artifacts (`Project/Assets/History` → `Plan/Challenge/Explore/History` → 6-step Journey rail). Returning users relearn the app's spine; README-referenced marketing screenshots no longer match the product; six top-level steps exceeds the 4-chunk working-memory budget.
   **Fix:** commit to the journey rail, regenerate `public/screenshots/`, and collapse Define/Refine/Finalize into one "Plan" phase with sub-states if six steps can't be defended.
   **Suggested command:** `/impeccable distill`

3. **[P1] Accessibility floor: contrast, focus, and a pointer-only signature feature.**
   `text-neutral-400` (~2.8:1 on white) appears **398 times**; only ~72 focus-style declarations exist across `src/` (new components like JourneyRail do it right, older surfaces don't); HomePage's icon-only buttons rely on `title` with no `aria-label`; the core refinement interaction is text-selection-driven with **no keyboard path found** to anchor a branch; `GenerationProgress` has no `role="status"`/`aria-live` — the product's most important wait is silent to a screen reader.
   **Fix:** alias a `text-muted` token at neutral-500+, add a shared focus-ring utility to button primitives, add a keyboard route into branch creation (e.g. per-section "refine this" affordance), and live-region the progress view.
   **Suggested command:** `/impeccable audit` then `/impeccable harden`

4. **[P2] Vocabulary without a legend.**
   "P0" chips, "Confirmed est.", "Generated before version tracking," "prompt packs," "quality gates," "Coverage: aligned with spec" all appear unglossed. A first-time PM cannot decode a single status chip on the Screens view.
   **Fix:** tooltip-on-chip one-sentence definitions; expand "est." to a word; state the consequence of "Confirm screen."
   **Suggested command:** `/impeccable clarify`

5. **[P2] Unbranded boot and theme schism.**
   First paint signed-out is a bare spinner on black; login/tour dark, HomePage light, workspace dark-chrome-white-content; `body` hard-codes dark while major routes are light.
   **Fix:** branded splash (wordmark + spinner); then either commit to one world or make light panes an intentional "paper document in a dark studio" motif with shared tokens — which would genuinely suit a PRD tool.
   **Suggested command:** `/impeccable document` (capture DESIGN.md) then `/impeccable polish`

6. **[P2] The mockup upload loop has no state guidance.**
   After "Copy prompt," the UI says only "Waiting for your upload" — nothing tracks that you copied, where to go, or the required size (buried in the prompt's last line).
   **Fix:** a 3-step checklist card (Copy → Generate elsewhere → Upload) with copied-state persisted; or push the inline-key path harder.
   **Suggested command:** `/impeccable onboard`

7. **[P3] Chrome-to-content ratio on mobile.**
   Top bar + tab row + 3-line non-dismissible demo banner + view header consume ~⅓ of a 390px viewport; Implementation Plan tabs clip to "V…" with a stray scrollbar; the data-model floating pill overlaps body text at 430px; the mockup prompt block is a nested scroll trap.
   **Fix:** collapse the demo banner to one line with a "why?" expander; auto-hide chrome on scroll; fix tab overflow affordance.
   **Suggested command:** `/impeccable adapt`

8. **[P3] Empty-feeling version ceremony.**
   "Version history" opens a modal to display one version; "Version 1 (FINAL)" badge + green "Final" button double-stamp the same fact (and the verb-shaped "Final" button reads as a call to action).
   **Fix:** inline popover until ≥2 versions exist; one finality indicator, noun-shaped.
   **Suggested command:** `/impeccable polish`

## Persona Red Flags

**Alex (impatient power user):** cannot bulk-generate the "Available on demand" mockup variants — each is an individual action, and without an OpenAI key each becomes a full copy/external/upload round trip. No command palette or shortcut system anywhere (only Enter-to-branch). "Version history" click yields a one-item modal — a dead-end click Alex will resent. Genuinely good for Alex: "Copy next prompt" as primary CTA, "Convert to tasks."

**Jordan (first-timer PM):** on the Screens view faces "P0", "Confirmed est.", "Mockup ready", "NEXT →", "5 of 5 screens" with zero explanation — cannot answer "what am I supposed to do here?" The screen-detail viewport names *three* credential concepts at once (GPT Image 2, OpenAI key, Gemini key) with no explanation of which powers what. "Confirm screen" states no consequence. The tour is Jordan's lifeline and it's good — but it ends with no bridge into the Screens vocabulary.

**Sam (screen-reader / keyboard-only):** the signature refinement interaction appears unreachable without a pointer; the generation wait is silent (no live region); 398 sub-AA meta-text instances; focus-visible coverage is newer-code-only. Good bones where recently touched: sr-only login labels, `aria-current` in JourneyRail, live regions in DecisionCenter.

**Casey (distracted mobile user):** permanent 3-line demo banner atop every screen; prompt block captures thumb-scroll; clipped tab row hides that more tabs exist; floating entity pill overlaps text. Done right: `MobileSelectionToolbar` uses true 44px targets and a bottom-sheet pattern; cards stack cleanly at 360px.

## Minor Observations

- LinkedIn button uses hard-coded brand blue while GitHub is neutral — visually unbalanced pair on login.
- "Tap to replay →" and "Tap an entity…" copy shown to desktop mouse users.
- Tour screen 1 runs four navigation systems at once (dots + "1/6" + Guided/Overview toggle + Next).
- Screens filter bar stacks two full-width selects on 360px before any content.
- Example-prompt carousel clips the third card mid-word at the default crop.
- "Review notes — 1 risk to resolve" collapses by default even when it holds the page's only blocker.
- Emerald "Signed in as {name}" pill styles a steady state as a success event.

## Questions to Consider

1. **Why doesn't Synapse run on a Synapse-generated design system?** Dogfooding one generated Design System as the app's own theme would be both a credibility proof and the fastest route to product character.
2. **What would the demo look like on the product's best day?** If every showcase screen had pinned images, real variants, and multi-version history, would evaluations flip from "config-heavy tool" to "this built a product"?
3. **Is the document the product, or is the chrome?** Three IA rewrites suggest rearranging containers around the same content. What if the PRD itself were the home surface, with screens/data model/plan as expansions inside the document?
4. **Can "Confirm" mean something?** What if each confirmation visibly unlocked the next dependency ("Confirming Document Library marks 2 flows buildable") — turning status hygiene into forward motion?

---

# Improvement Plan (proposed — nothing implemented)

Ordered so trust-destroying issues fall first and each phase is independently shippable. File pointers are starting points, not exhaustive.

**Phase 0 — Foundations (enables everything else)**
- Capture `PRODUCT.md` + `DESIGN.md` (`/impeccable init` + `/impeccable document`) so future design work has an authority to preserve.
- Introduce a real token layer in `tailwind.config.js`: brand color scale (own the indigo or replace it deliberately), `text-muted` alias ≥ neutral-500, type scale, shared `focus-ring` utility. Ideally: dogfood a Synapse-generated design system as the source.

**Phase 1 — First impressions & demo trust (P1 #1, P2 #5)**
- Pin pre-generated mockup images into the demo snapshot; suppress/one-line vendor key warnings for showcase ids (respect the `projectCapabilities.ts` policy — no raw id checks).
- Branded splash for the auth-loading boot state (`App.tsx` loading branch).
- Decide the theme story: one world, or an intentional "paper in a dark studio" motif with shared tokens.

**Phase 2 — IA commitment (P1 #2)**
- Ratify the Journey rail as the IA; evaluate collapsing Define/Refine/Finalize under one "Plan" phase (6 → 4 top-level chunks).
- Regenerate `public/screenshots/` from the current UI (README rule: stale screenshots are a defect).

**Phase 3 — Accessibility floor (P1 #3)**
- Sweep `text-neutral-400` meta text to the new `text-muted` token; add the focus-ring utility to button primitives; `aria-label` the icon-only header buttons.
- Add `role="status"`/`aria-live` to `GenerationProgress`.
- Design a keyboard path into branch creation (per-section "refine" affordance as an alternative to text selection).

**Phase 4 — Comprehension (P2 #4, #6)**
- Status-chip tooltip legend ("P0", "Confirmed est.", freshness labels); consequence copy on "Confirm screen".
- 3-step mockup checklist card (Copy → Generate → Upload) with persisted copied-state.

**Phase 5 — Mobile & polish (P3 #7, #8)**
- Collapsible one-line demo banner; tab-overflow affordance fix; un-trap the prompt-block scroll; version-history inline popover until ≥2 versions; single finality indicator.

Each phase maps to impeccable commands (`onboard`, `distill`, `audit`/`harden`, `clarify`, `adapt`, `polish`) and can be run as `/impeccable <command> <target>` once the plugin PR lands. Re-run `/impeccable critique` after fixes to track the 26/40 score.
