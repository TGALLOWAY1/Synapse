# Codebase Cleanup Backlog

Items deferred from the
[2026-05-08 cleanup audit](../audits/SYNAPSE_CODEBASE_CLEANUP_AUDIT.md).
Phase 1 was applied in commit `claude/synapse-codebase-audit-tIUSS`; what
remains is grouped by risk so the next cleanup pass can pick from the top.

## Phase 2 — Low-risk consolidation

- [ ] **Merge `prdPipeline.ts` into `progressivePrdPipeline.ts`.**
  After this audit `prdPipeline.ts` only exports the types
  `PrdPipelineOptions`, `PrdPipelineResult`, and the constant
  `PRD_SCHEMA_VERSION`. Two files import them. Wait until
  `progressivePrdPipeline.ts` has been stable for one release cycle, then
  inline them and delete `prdPipeline.ts`.

- [ ] **Resolve "Password reset is coming soon" tooltip** at
  `src/components/LoginPage.tsx:321`. Either implement the flow (requires
  email-token plumbing in `api/auth/`) or remove the tooltip and the
  disabled link.

- [ ] **Reconcile CLAUDE.md vs reality on "intent classification."** CLAUDE.md
  describes feedback intent classification on `feedbackSlice`, but no such
  code exists. Either implement it or update CLAUDE.md.

## Phase 3 — Folder organization (low-medium risk)

- [ ] **Move flat `src/lib/*.ts` helpers into `src/lib/utils/`.** Target files
  (~10): `mockupValidation.ts`, `mockupQuality.ts`, `mockupParsing.ts`,
  `mockupDefaults.ts`, `mockupAlignmentCritique.ts`, `mockupPlaceholders.ts`,
  `screenInventoryNormalize.ts`, `jsonRepair.ts`, `textCleanup.ts`,
  `errors.ts`, `concurrency.ts`, `groundingFields.ts`. Update ~30 import
  sites. Validation: type-check + build + tests.

- [ ] **Do NOT undertake a top-down `features/*` reorg.** See audit §6 for
  rationale. If a future case for it appears, build it case-by-case starting
  with one feature (e.g. mockups) and verify the win before generalizing.

## Phase 4 — Higher-risk / needs tests first

- [ ] **Add E2E smoke tests for the four uncovered hot paths.** Today's 28
  vitest files cover utils/schemas; the integration paths are uncovered:
  - PRD generation (`runProgressivePrdPipeline`)
  - Mockup generation (`mockupService` → `MockupViewer`)
  - Branch consolidation (`branchService.consolidateBranch`)
  - Staleness detection (`stalenessSlice` against current spine)

  Tests should mock the LLM transport but exercise the orchestration glue
  end-to-end against a fixture project.

- [ ] **Resolve `TODO(tailwind-hardening)` at `src/components/mockups/buildMockupSrcDoc.ts:30`.**
  Currently the iframe sandbox loads Tailwind from a CDN inside generated
  mockup HTML. Replace with a pre-built / vendored Tailwind stylesheet
  injected into the sandbox.

## Phase 5 — Sunsetting live shims

- [ ] **Remove `GEMINI_MODEL_MIGRATION_KEY` shim** in `src/App.tsx:32-49`
  after **2026-07-01** (3-month soak from the 2026-04 sentinel). Migration
  pushes anyone still on `gemini-2.5-flash` to the current model on first
  load.

- [ ] **Eventually retire `onRehydrateStorage` legacy stage migration** in
  `src/store/projectStore.ts:42-58`. Wait until analytics show no projects
  in legacy stages for 60+ days, then delete.

- [ ] **Eventually retire `qualityScores` field** on `SpineVersion` and its
  conditional setters in `src/store/slices/spineSlice.ts:121, 143`. Pure
  backward-compat; cost is ~10 LOC. Defer indefinitely unless a v3 schema
  rev forces a clean break.

## Optional / opportunistic

- [ ] Extract LLM retry logic from `geminiClient.ts` and `openaiClient.ts`
  into `src/lib/utils/retry.ts` if a third LLM client is added.
- [ ] Reconsider `@formkit/auto-animate` (2 imports) and `date-fns` (1
  import) once any other dependency churn happens.
