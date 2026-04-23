# Mockup Improvements Roadmap — 2026-04-23

Tracker for the multi-phase reliability/quality work kicked off after the
2026-04-22 audit (`docs/mockup-audit-2026-04-22.md`). Each phase is shipped
on its own so consistency gains can be measured incrementally.

Baseline from the 2026-04-22 harness run (`npm run mockup:harness -- --runs 4`):

| Metric | Baseline |
|---|---:|
| Render success | 100% |
| Structural validity | 100% |
| Visual quality | 81.1 / 100 |
| Consistency (same input, 4 runs) | 77.5 / 100 |
| Edge-case fallback rate | 33% |

---

## Phase A — Layout spec + template catalog

**Status:** shipped (commit `11c80e6`, branch
`claude/mockup-audit-improvements-FCt7b`).

Collapses the model's generation surface from "arbitrary Tailwind HTML
strings" to a typed `MockupLayoutSpec` (closed vocabulary of shells,
sections, actions) rendered by vetted templates. Structural variance moves
off the model and onto the renderer; only slot *content* stays model-
generated.

### Shipped

- [x] `src/types/index.ts` — `MockupLayoutSpec` discriminated-union types.
- [x] `src/lib/schemas/mockupLayoutSpec.ts` — Gemini JSON-mode schema with
      tight enums and min/max bounds.
- [x] `src/components/mockups/templates/` — 3 shells (`sidebar_topbar`,
      `topbar_only`, `mobile_tab_shell`), 6 section components
      (`stat_grid`, `data_table`, `activity_feed`, `filters_bar`,
      `detail_panel`, `empty_state`), 5 action kinds. All slot text is
      HTML-escaped.
- [x] `src/lib/mockupLayoutRenderer.ts` — fail-soft JSON parser and
      deterministic spec→HTML renderer; emits a dedicated
      `MockupSpecParseError` so the orchestrator can retry on parse failure.
- [x] `src/lib/services/mockupService.ts` — `runSpecEngine` alongside the
      existing `runHtmlEngine`, gated on `localStorage.MOCKUP_ENGINE ===
      'spec'`. Spec-engine failures fall back to the HTML engine.
- [x] Tests: renderer determinism, injection escape, shell variants, and a
      mockupService integration test for the spec path. 70/70 passing.

### Open — still part of Phase A

- [ ] **Harness comparison run.** Execute
      `MOCKUP_ENGINE=spec npm run mockup:harness -- --runs 4` against the
      same fixtures and compare consistency/quality numbers against the
      77.5 / 81.1 baseline. Entrance criterion for flipping the default is
      consistency ≥ 90.
- [ ] **Flip default engine.** Change `getMockupEngine()` to default `'spec'`
      once the harness threshold is met, and update
      `docs/mockup-evaluation-harness.md` with the new baseline.
- [x] **Surface engine toggle in UI** — added to `SettingsModal.tsx` as a
      radio group next to the model selector; persists to
      `localStorage.MOCKUP_ENGINE` (writes `'spec'` explicitly, clears the
      key when on the default `'html'`).
- [ ] **Remove HTML-engine path.** After one stable release on the spec
      default, delete `buildSystemPrompt`/`buildUserPrompt`/
      `parseMockupPayload`/`buildSafeFallbackPayload` plus the now-redundant
      regex checks in `mockupValidation.ts` and the non-PRD-grounding rules
      in `mockupQuality.ts`. Keep placeholder-copy + domain-term coverage
      checks, which still apply to slot text.

---

## Phase B — PRD grounding upgrade

**Status:** shipped.

Even a perfect renderer produces "generic SaaS sludge" if the LLM can't lock
onto the product's real nouns. Phase A narrowed the visual surface; Phase B
narrows the content surface by making PRD-derived entities and actions a
hard input to generation.

### Shipped

- [x] **Extended `StructuredPRD`** (optional so older projects keep working):
      - `domainEntities: { name, description?, exampleValues? }[]` — nouns
        for table columns, detail-panel fields, activity-feed targets.
      - `primaryActions: { verb, target }[]` — verb phrases for primary
        CTAs across screens.
- [x] **PRD generation** (`src/lib/schemas/prdSchemas.ts`,
      `src/lib/services/prdService.ts`): schema and system prompt updated so
      every new PRD includes 3–8 domain entities (with examples) and 3–6
      primary actions. `structuredPRDToMarkdown` renders them as dedicated
      sections.
- [x] **Spec-engine grounding injection** (`src/lib/services/mockupService.ts`,
      `buildSpecUserPrompt`): when the PRD carries `domainEntities` or
      `primaryActions`, they're appended to the user prompt as a MANDATORY
      grounding block, including exampleValues for realistic cell content
      and quoted `"verb target"` phrases for CTA labels.
- [x] **Stricter `mockupAlignmentCritique.ts`**: two new issue codes —
      `insufficient_entity_grounding` (per-screen, hard-severity if zero
      entity hits) and `insufficient_action_grounding` (set-level, hard-
      severity if no primary action verb appears on any CTA). Heuristic
      term-coverage still runs for projects without the new fields.
- [x] Tests: alignment critique hits/misses for both new codes, a backward-
      compat test that skips the structured checks when fields are absent,
      and a spec-engine test asserting the grounding block is injected.
      75/75 passing.

### Open — Phase B polish

- [x] **Backfill migration**: chose option (c). `StructuredPRDView` renders
      a "Refresh grounding fields" amber CTA when either field is missing;
      clicking re-runs `generateStructuredPRD` against a compact summary of
      the existing structured PRD and merges only `domainEntities` and
      `primaryActions` back — existing vision/features/risks untouched.
- [x] **StructuredPRDView UI**: two new editable sections (domain entities
      + primary actions) with inline edit using a one-per-line
      pipe-delimited format (`Name | description | example1, example2` /
      `verb | target`). Parse/serialize helpers extracted to
      `src/lib/groundingFields.ts` with full round-trip tests.

---

## Phase C — Deterministic rendering & Demo Safe Mode

**Status:** shipped.

Closes the remaining runtime gaps (Tailwind CDN health, viewport occupancy,
cross-run diff) and gives recruiter demos a defensible "safe" setting.

### Shipped

- [x] **Playwright layout-viability probe in harness**
      (`scripts/mockup-eval-harness.mjs`): the existing `renderAndProbe` now
      calls `page.evaluate` after `networkidle` to collect `styled`,
      `horizontalOverflow`, `bodyHeight`, and `visibleElements` per screen.
      A new `layoutViabilityRate` metric aggregates over all runs; a run
      fails when any screen reports unstyled, overflowing, <100px body, or
      zero landmarks.
- [x] **Perturbation pairs**: `harness/mockup-test-suite.json` cases gain
      an optional `variantPrompt` field (≤10-token edit). After the primary
      loop, the harness generates each variant and computes shell-signature
      Jaccard similarity. Aggregated as `perturbationSimilarityAvg` and
      `perturbationPassRate` (share of pairs ≥ 0.9).
- [x] **Non-SaaS fixtures**: `nonsaas_consumer_fitness`,
      `nonsaas_marketplace`, `nonsaas_physical_goods` added to stress the
      "generic dashboard sludge" failure mode against non-SaaS domains.
- [x] **Demo Safe Mode toggle** in `MockupsView.tsx` + `MockupSettings`:
      when on, pins `temperature=0 / topP=0.5 / topK=1` on the provider
      call, disables both the spec→HTML fallback and the HTML safe
      fallback template, and hard-rejects on ANY alignment critique hit
      (not just high+low-score). Serialized into artifact metadata so
      regeneration preserves the setting.
- [x] **iframe post-load probe** in `buildMockupSrcDoc.ts` +
      `MockupHtmlPreview.tsx`: a per-iframe UUID `probeId` drives an
      injected script that inspects `min-h-screen` computed styles + body
      geometry and posts a `MockupProbeReport` back to the parent via
      `postMessage`. The preview surfaces a "Preview degraded: …" badge
      when the probe reports missing Tailwind, horizontal overflow,
      near-empty body, or no landmarks — or when it doesn't arrive within
      6s.
- [x] **CI gate** at `.github/workflows/mockup-harness.yml`: runs typecheck
      + lint + tests + the harness (with Playwright installed) on PRs that
      touch the mockup surface, and fails the job on any regression vs the
      committed baseline or a `layoutViabilityRate < 100%`. Harness
      artifacts are uploaded for debugging.
- [x] Tests: Demo Safe Mode sampling pin + no-fallback behavior in
      `mockupService.test.ts`, and probe-script injection in a new
      `src/components/mockups/__tests__/buildMockupSrcDoc.test.ts`. 79/79
      tests passing.

### Open — Phase C polish

- [ ] **Establish a Phase C baseline**: after the first CI run, commit the
      generated `harness/sample-results/latest/summary.json` as the new
      baseline for regression detection.
- [x] **Probe telemetry dashboard**: session-scoped Zustand store
      (`src/store/probeStore.ts`) aggregates probe outcomes per
      `ArtifactVersion.id`. `MockupHtmlPreview` now takes an optional
      `versionId` prop and records every interpreted probe report.
      `MockupViewer` surfaces a per-version chip in the title strip —
      green "Render OK (n/n)" or amber "Render degraded (d/n)" with the
      last degradation reason as the tooltip.

---

## Alternatives considered (not primary path)

- **Managed UI-gen MCP (v0.dev-style)** — breaks Synapse's client-side,
  single-API-key architecture; revisit only as an opt-in "Pro engine".
- **Vision-model-as-judge only** — closes the "preview looks blank" gap but
  does not reduce variance. Useful as a *supplement* in Phase C, not a
  replacement for the AST.
- **Playwright MCP for harness/CI** — adopted in Phase C; stays out of
  shipped client code.
