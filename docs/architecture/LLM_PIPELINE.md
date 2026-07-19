# LLM Layer & PRD Generation Pipeline

> Extracted from CLAUDE.md. The Gemini transport, trace viewer, PRD DAG pipeline, PRD views/decision log, design-system presets, canonical PRD spine, core artifact services, model routing, and prompt-fragment rules.

### LLM layer (`src/lib/`)

- **`geminiClient.ts`** — low-level Gemini transport. Two modes:
  `callGemini()` (sync JSON) and `callGeminiStream()` (SSE). Both wrap fetch
  in `fetchWithRetry` for connection-level transient errors;
  `callGeminiStream` *also* wraps the entire fetch+reader in a stream-level
  retry, so a mid-stream mobile-network drop reconnects from byte zero.
  Stream callers should implement `StreamCallbacks.onRestart` to reset any
  chunk-derived state (char counters, phase trackers) when the stream is
  re-attempted. `isRetryableNetworkError` is exported for callers that
  need to reason about retry policy. **Both modes now parse Gemini's
  `usageMetadata`** and fire `JsonModeConfig.onUsage` — the streaming path
  reads it off the final SSE chunk, closing the old artifact-token-capture gap.
  `callGemini`/`callGeminiStream` are the **single chokepoint** for every LLM
  call in the app; both are instrumented by the LLM Trace Viewer (see below).

- **LLM Trace Viewer (`src/lib/trace/`, `src/components/developer/`) — a
  developer-only debugging surface.** Every call through the geminiClient
  chokepoint is captured (request, redacted body, raw response, parsed JSON,
  token usage, finishReason, retries, timing) via `beginTrace()`
  (`traceRecorder.ts`). **Capture is OFF by default** — enabled per browser via
  the viewer's toggle (localStorage `synapse-llm-trace`) or a `?llmtrace` query
  param; when off, `beginTrace` returns a zero-cost no-op handle. Enabled traces
  land in an in-memory registry (subscribable via `useLlmTraces` /
  useSyncExternalStore) **and** IndexedDB (`traceStore.ts`, capped at 1000) so
  past generations are inspectable after a reload. **Secrets are redacted at
  capture time** (`traceRedaction.ts`, pure/unit-tested) so no api key / bearer
  token / cookie / secret ever reaches the registry or disk — never weaken this.
  Call sites enrich traces with `JsonModeConfig.traceMeta`
  (`LlmTraceMeta`: purpose / stage / artifact / project / inputs / promptPieces
  / contextItems / sessionId) — wired into the PRD sections (via
  `ModelProvider.generateText`), core artifacts (`generateCoreArtifact`
  `traceContext`), consistency review, safety, preflight, and single-section
  retry. One `sessionId` per PRD run / artifact-bundle run groups a whole
  generation; calls without one group heuristically (`traceSessions.ts`, pure).
  The viewer lives at **`/developer/llm-trace`**, gated by `RequireOwner`
  (auth + possession of `SYNAPSE_OWNER_TOKEN`, the same client signal the
  Snapshots panel uses) and surfaced only in Settings' owner-gated **Developer**
  section — every non-owner experience is unchanged. It offers a session-grouped
  filterable call list, a tabbed inspector (Overview / Input / Prompt / Context /
  Raw Request / Raw Response / Parsed / Validation / Prompt Construction), diff
  mode (compare two calls), and standalone offline-HTML export
  (`traceExport.ts`, pure). This is purely observational — it never affects
  generation. See `docs/LLM_TRACE_VIEWER.md`.

- **`services/`** — one file per AI feature. Importing through the
  `llmProvider.ts` barrel keeps legacy call sites stable.
  - `prdService.ts` → `progressivePrdPipeline.ts` → `progressivePrdGeneration.ts`
    — PRD generation runs as a **dependency-graph (DAG) pipeline**, not in
    document order. `DEFAULT_PRD_SECTIONS` (8 schema-aligned sections in
    `progressivePrdGeneration.ts`) each declare `dependencies` that are **true
    data dependencies only** — a section lists another solely when it consumes
    that section's output as prompt context. **The PRD is the product decision
    document, not a container for downstream artifacts:** the former
    `data_model` and `implementation_plan` PRD sections are **retired** from the
    default graph (`RETIRED_PRD_SECTIONS` / `RETIRED_SECTION_IDS`) — the
    dedicated data_model / implementation_plan *artifacts* own that detail, and
    the PRD-embedded copies duplicated them (two entity lists was a standing
    inconsistency source; `implementationPlan` was never rendered). Their
    `SectionId`, prompt builder, slice schema, and title all survive solely so
    single-section retry of legacy `generationMeta.failedSections` keeps
    working (`prdSectionRetry.ts` looks sections up across
    `DEFAULT_PRD_SECTIONS ∪ RETIRED_PRD_SECTIONS`). Never re-add retired
    sections to `DEFAULT_PRD_SECTIONS`, and never feed them to `runDag`.
    Legacy PRDs with `richDataModel`/`stateMachines`/`implementationPlan` keep
    rendering — the renderer blocks and optional `StructuredPRD` fields stay.
    The remaining sections are prompted (and, where it matters,
    **schema-enforced** via lean slice schemas in `prdSchemas.ts` —
    `leanUxPageItemSchema`/`leanFeatureItemSchema`/`leanSuccessMetricSchema`,
    since Gemini JSON mode can't emit properties absent from the schema) to
    stay at decision level: `uxPages` is a lean screen list (name/purpose/key
    content — no per-screen interaction/empty/loading/error specs), features
    drop `uiAcceptanceCriteria`/`analyticsEvents`, success metrics drop
    `instrumentation`, and the architecture narrative is a short decision
    story grounded on `domainEntities`. `RUBRIC_DEFINITION` (`prdPrompts.ts`)
    encodes this split — decisions live in the PRD, detail lives in the
    artifacts — so don't re-add "full schemas / state machines / per-page
    component specs" demands to prompts or rubric. `runDag()` runs every section whose
    deps are satisfied concurrently, under separate per-tier concurrency caps
    (`maxFastConcurrency` / `maxStrongConcurrency`); low-risk sections use the
    fast (Flash) model, high-risk the strong (Pro) model. `validateGraph()` runs
    first and throws on unknown-dependency references or cycles (Kahn's
    algorithm) so a broken graph fails loudly instead of silently dropping
    sections. Each section emits a typed slice of `StructuredPRD`; slices are
    merged deterministically (`prdSectionMerge.ts`, disjoint top-level fields)
    and markdown is rendered via `prdMarkdownRenderer.ts`. Do **not** re-add
    edges to sequence sections by document position — only by real data flow.
    **PRD reading order ≠ generation (DAG) order.** The human/agent-facing
    section order is a fixed logical flow (Product Overview → Target Users →
    MVP Scope → Core Features → UX → Success Metrics → Risks → Technical
    Architecture → Data Model → State Machines → NFRs → reference appendix →
    **"Where the Detail Lives"**, a static deterministic handoff appendix
    pointing to the downstream artifacts, rendered unconditionally by both
    renderers — legacy spines' persisted `responseText` picks it up on the
    next re-render (edit / section retry / regenerate), while the in-app
    Structured view shows it immediately for every PRD)
    defined in **two mirrored renderers that must stay in sync**:
    `prdMarkdownRenderer.renderPremiumMarkdown` (export/`responseText`) and
    `StructuredPRDView`/`PremiumSections` (in-app). Reordering is
    presentation-only and safe — downstream artifacts/mockups consume the
    `StructuredPRD` **object by field**, never this render order — but if you
    change one renderer's section order, change the other to match.
    The legacy multi-pass scoring + revision passes were removed — old projects
    in localStorage retain their saved `qualityScores`, but no new generation
    writes them.
    - **PRD Review & Confirm + Decision Log (2026-07 mobile cleanup pass).**
      Assumptions no longer render as a passive trailing "Assumptions" section
      (or as the Implementation Summary's "Open Decisions" list — both are
      gone, as are the summary's "Defer" bucket, the Success Metrics
      Instrumentation column, and the "Derived from features and assumptions"
      subtitle). Instead the PRD carries two mirrored sections near the top:
      **Review & Confirm** (unresolved assumptions, sorted by confidence
      highest-first, each with Confirm / "Not right"+correction actions) and
      **Decision Log** (decided items — decided assumptions + confirmed
      features + derived **Deferred** entries, never unresolved items). State
      lives ON the
      `StructuredPRD` itself via all-optional fields (`Assumption.decision` /
      `decisionNote` / `decidedAt`; `Feature.confirmed` / `confirmedAt` —
      legacy PRDs simply read as "all unresolved"); every confirm/reject/undo
      is a normal PRD edit through `editSpineStructuredPRD` (appends a
      version, descriptive editSummary, undoable via version history). All
      derivations (`sortAssumptionsByConfidence`, `splitAssumptions`,
      `deriveDecisionLog`, and `isDisplayableFeatureId`) are pure/read-side in
      `src/lib/derive/prdDecisions.ts`, which re-exports `resolveScopeFeature`
      — the MVP-scope-string → feature matcher, now defined in
      `src/lib/derive/scopeFeatureMatch.ts` (extracted so
      `implementationSummary.ts` can use it too without an import cycle) — for
      back-compat; do NOT persist a separate decision-log structure. Feature
      ids render everywhere through the
      shared `FeatureIdBadge` (`src/components/prd/FeatureIdBadge.tsx`),
      which mirrors the User Flows `FeatureReferenceChip` fuchsia look and
      hides uuid-shaped ids; feature confirmation uses the same green-check
      language as the Screens `ScreenConfirmPanel`. Within Core Features the
      order is **Detailed Features before Feature Systems** (both renderers).
    - **Scope presentation (2026-07 demo formatting pass): the Implementation
      Summary is the SINGLE MVP/V1 scope surface.** The old `MVP Scope`
      section duplicated the summary's Build First / Build Next buckets and
      was removed from BOTH renderers (`StructuredPRDView` +
      `renderPremiumMarkdown`); the scope *rationale* (`mvpScope.rationale`)
      now renders as the Decision callout at the top of
      `ImplementationSummarySection`, and the summary buckets are **uncapped**
      (every tagged MVP/V1 feature appears). `deriveImplementationSummary`
      (`src/lib/derive/implementationSummary.ts`) buckets by feature
      `tier`/`priority` when present; when a PRD has **no** tier/priority tags
      but DOES have `mvpScope.mvp`/`v1` entries, those explicit free-form scope
      strings drive the buckets instead (resolved to features via
      `resolveScopeFeature` where possible; an unresolved entry still renders
      as a plain scope card with no id badge — `SummaryFeature.id` is
      optional). Only when BOTH signals are absent does it fall back to the
      declaration-order 4+4 heuristic. Bucket cards show the feature
      **description** as supporting text (falling back to userValue) — never
      the raw complexity rating prefix ("low · "). Do not reintroduce a
      separate MVP Scope feature list.
      **Deferred scope renders ONLY in the Decision Log** — PRD sections must
      never present features outside the MVP/V1 phases. `deriveDeferredFeatureIds(prd)`
      is the single scope-aware source of truth for "deferred": features
      tagged `tier: 'later'`, PLUS any untagged feature an `mvpScope.later`
      item resolves to (an explicit `mvp`/`v1` tier tag always wins over a
      later item naming that feature — a data conflict logs the later item as
      a raw `kind: 'scope'` entry instead of hiding the tagged feature).
      `deriveDecisionLog` appends derived `verdict: 'deferred'` entries from
      this set (deferred entries carry no undo — they are scope records, not
      user decisions), and every other consumer (`splitFeaturesByTier`, Feature
      Systems' chip filter, the summary buckets) takes the same set so a
      feature can never read as both deferred and in scope. Do not derive
      "deferred" locally from `tier === 'later'` alone in a new call site —
      use `deriveDeferredFeatureIds`.
      **Detailed Features groups by tier** (`splitFeaturesByTier(features,
      deferredIds)` in `src/lib/derive/implementationSummary.ts`): MVP +
      untiered features visible by default (hand-added features have no tier
      and must stay visible), V1 features behind a collapsed disclosure,
      deferred features linked out to the Decision Log. Each detail card is anchored
      (`featureDetailAnchorId` → `prd-feature-<id>`): Implementation Summary
      cards deep-link to it (`StructuredPRDView.handleNavigateToFeature`
      auto-expands the V1 group when the target lives inside it) and each
      `FeatureCard` shows a "Summary" back affordance (`onBackToSummary`)
      returning to `#prd-implementation-summary`.
    - **User project name → `productName`.** The name the user types when
      creating a project is threaded into generation as an optional
      `projectName` (call site `runPrdGeneration`/`ProjectWorkspace.handleRegenerate`
      → `generateStructuredPRD` → pipeline → `generateProgressivePrd` →
      `SectionPromptContext.projectName`). The `product_basics` builder
      (`prdSectionPrompts.ts`) makes it the **authoritative** `productName` so the
      PRD (and every downstream artifact/mockup, which read `productName`) use the
      name the user chose instead of one the model invents. A generic-placeholder
      guard (`isMeaningfulProjectName` / `GENERIC_PROJECT_NAMES`: "untitled",
      "test", "my app", …) drops names with no product intent so the model is
      still free to coin one. `runPrdGeneration` reads the name from the store by
      `projectId`; pass it explicitly from any new direct `generateStructuredPRD`
      call site.
    - **Automatic final consistency review** (`prdConsistencyReview.ts`): runs
      **by default and silently** as the last step of normal PRD generation
      (one extra fast-model call, after DAG merge, before markdown is rendered
      for display/storage). It reconciles terminology / names / feature ids /
      duplicates / cross-section contradictions across the merged PRD. The user
      is **never** asked to approve ordinary repairs. The reviewed PRD replaces
      the merged one **only** when it clears conservative acceptance guards; a
      failed/unsafe review is discarded and the merged PRD is kept, so a review
      failure never blocks a usable PRD:
      - **merge-over-original** (omitted fields preserved — safety-restriction
        `constraints` survive even if the model omits them),
      - **detail-loss guard** (discards any revision shrinking/emptying a key
        content array below 70%),
      - **required-field guard** (vision/coreProblem/architecture must stay
        non-empty; targetUsers/features/risks must stay non-empty),
      - **feature-id stability** (every original `Feature.id` must survive —
        downstream artifacts/tasks reference them),
      - **product-identity guard** (a present `productName` may be canonicalized
        but never blanked),
      - **semantic preservation guards** (Phase 3 — protect facts downstream
        artifacts consume directly): a revision is discarded if it drops/reduces
        any feature's **acceptance/success criteria**, drops any feature
        **dependency id** reference, drops or **weakens a safety restriction**
        (`constraints` — every original entry must survive verbatim; a reworded
        or removed restriction is treated as weakening), or drops **entity fields,
        relationships, or example values** (rich-data-model + `domainEntities`,
        matched by name). All guards **reject wholesale** and keep the
        deterministically-merged PRD — the review is a polish, never a fact
        editor. `evaluateGuards` is the single ordered chokepoint.
      On apply it sets `generationMeta.revised` and adds a `consistency_review`
      pass record. The outcome (`ran`/`applied`/`status`/`rejectionReason`) is
      recorded in `generationMeta.consistencyReview` (`ConsistencyReviewMeta`),
      which also carries a compact **structured diff** (`ConsistencyReviewDiff`:
      `sectionsChanged`, `featuresReworded`, `productNameChange`,
      `guardsTriggered`, `outcome`) built for both accepted and rejected passes.
      `summarizeConsistencyReview(meta)` renders a one-line summary surfaced in
      the PRD **version-history panel** (`VersionEntry.consistencyReview`) — the
      only UI exposure; generation is never affected. It is **skipped** for a
      partial run (a section failed → PRD already surfaced as incomplete). The
      localStorage `synapse-prd-consistency-review` key is now only a
      **developer/debug opt-out** (`'false'` → skip via `enableConsistencyReview:
      false`); default and any other value leave the review on. `runPrdGeneration`
      resolves that override; `ProjectWorkspace.handleRegenerate` leaves it
      default-on. Do **not** re-add a user-facing "repair PRD?" prompt.
    - **Permissions & Roles quality gate** (`src/lib/prdRolesSanitizer.ts`,
      pure/idempotent). The `roles` slice (generated by the `ux_loops` section)
      must describe **business capabilities a user has inside the product**
      ("Create workouts", "Invite users", "View analytics") — not how the
      software is built or secured. Left unguided the model sometimes emits
      hundreds of implementation/security-config "restricted" items ("Disable
      SSL pinning", "Modify SQLite database", "Bypass rate limiting") that read
      like hallucinated infra docs or prompt injection. The fix is two-layer:
      **(1) prompting** — the `prdSectionPrompts.ts` (`ux_loops`) roles spec
      demands concise capability-based
      permissions (allowed 5–15, restricted optional & small 3–10, omitted when
      nothing product-meaningful), and forbid backend/infra/DB/OS/networking/
      security-implementation detail; **(2) deterministic validation+repair** —
      `sanitizeRolePermissions` drops any item matching a technical-term
      denylist (semantic check: "is this something a user can do inside the
      product?"), dedupes, caps list sizes, and omits an empty Restricted
      section. It runs at **generation** (`prdSectionMerge.mergeSectionsToStructuredPrd`
      + the single-section retry overlay in `prdSectionRetry.ts`) **and at
      render** (`prdMarkdownRenderer.renderRoles`, `PremiumSections.RolesSection`)
      so legacy persisted PRDs also display clean without regeneration. It is a
      deterministic repair, not an LLM re-generate loop (lower risk, guaranteed
      output). When broadening/narrowing the denylist, keep it precise — match
      "authentication server" not bare "authorize", "feature flag" not "feature
      gating" — so legitimate product permissions survive.
    - **Observability** (`prdGenerationLog.ts`): structured, debug-gated logs
      (`synapse-prd-debug` / `?prddebug`) for queued/started/completed/failed,
      retry, run summary, model, est-vs-actual, and `surface` (mobile/web).
  - `mockupService.ts` + `mockupImageService.ts` — mockup HTML and image
    generation.
  - **Shared design-system brief (single source of visual truth for image
    prompts).** `buildDesignSystemBrief(tokens)` (`designTokens/promptSnippet.ts`,
    replaced the old `tokensToImagePromptBrief`) is the ONE concise-but-complete
    Design System Brief embedded into every prompt that drives a mockup/screen
    image. Both the internal gpt-image-2 path (`mockupImageService.buildScreenImagePrompt`)
    and the user-copied external prompt on the Screen Inventory page
    (`screenInventoryImageService.buildExternalMockupPrompt`, formerly
    `buildScreenInventoryImagePrompt`) call it, so an externally generated mockup
    follows the same visual language as the internal one instead of drifting to a
    generic "neutral palette" look. The brief covers palette, typography,
    spacing/density, radius, elevation, button/card/form/modal conventions,
    navigation, responsive behavior, and accessibility — token data verbatim,
    the rest as derived conventions. `buildExternalMockupPrompt` takes optional
    `designTokens` (threaded from `ArtifactWorkspace` via `selectPreferredDesignTokens`
    into `ScreenImageGalleryContext`); with no design system it falls back to the
    neutral style hint so legacy projects still get a working prompt. Do **not**
    re-duplicate design-system prose into a prompt builder — reuse the brief.
  - **Design System Presets (`src/lib/designSystemPresets.ts`).** A
    visual-direction choice (`Modern SaaS`, `Enterprise Professional`,
    `AI Workspace`, `Minimal Editorial`, `Developer / Technical`,
    `Consumer Mobile`, `Creative Studio`, `Custom / Generate for me`). Preset
    **ids are stable and persisted** (`saas_minimal`, `editorial_learning`,
    `developer_tool`, … — never rename an id; labels are display-only). Each
    concrete preset also carries setup-step metadata (`tone`,
    `recommendedUseCases`, `visualTraits`, `previewTokens` — presentation-only,
    never fed to generation; only `directive` steers the model). The chosen id
    is stored on `Project.designSystemPreset`
    (`setProjectDesignSystemPreset`) and read at generation time by
    `artifactJobController.runCoreArtifactSlot` off the project (NOT threaded
    through every call site) and passed to `generateCoreArtifact`, which injects
    `getDesignSystemPresetDirective(id)` into the **design_system** prompt only.
    `custom`/unknown/missing → empty directive → original PRD-only behavior. The
    preset steers design_system generation and therefore both internal mockups
    and the external copy-prompt, keeping the project visually consistent. The
    `DesignSystemRenderer` shows a banner explaining this coupling and that
    regenerating may shift downstream mockups/screen prompts.
    - **Visual direction is requested at output generation, not during product
      reasoning.** New projects may still carry the backward-compatible
      `needsDesignSetup` flag, but the Plan stage never swaps the PRD/progress
      view for design setup. When the user explicitly chooses **Generate build
      foundation**, `DesignSystemPresetChoice` appears if no preset exists.
      Choosing calls `setProjectDesignSystemPreset` (which also clears
      `needsDesignSetup`) and then begins output generation. This prevents an
      aesthetic decision from interrupting problem/scope reasoning while still
      ensuring visual outputs have a deliberate direction. The reusable
      `DesignSetupStep`, recommendation, and preference helpers remain for
      other surfaces but are not a live-workspace gate.
    - **Post-finalization re-selection.** The preset is **no longer one-time**.
      Because the Mark-as-Final gate only fires once (and never for projects
      finalized before presets existed), the **Design System artifact** carries a
      `DesignDirectionControl` (`src/components/DesignDirectionControl.tsx`,
      presentational) above its content in `ArtifactWorkspace`: it shows the
      current direction (or an "AI decides" fallback) and offers **Change
      direction** and **Regenerate**. **Change direction opens
      `ChangeDirectionModal` (`src/components/setup/ChangeDirectionModal.tsx`),
      which deliberately mirrors the setup-stage `DesignSetupStep`** — same light
      surface and large `DesignPresetGrid` preview cards (the card grid is
      extracted into the shared `src/components/setup/DesignPresetGrid.tsx` so the
      two screens are visually identical) — with the active preset marked
      **Current** and a prominent amber warning that the change flows through to
      downstream artifacts (mockups + copied screen prompts). Choosing a new
      direction persists it via `setProjectDesignSystemPreset` then opens a
      regenerate-confirm (itself carrying the downstream-impact warning) that
      calls `artifactJobController.retrySlot('design_system')` — which re-reads
      the preset off the project, so the new direction actually reaches
      generation. (The old compact `DesignSystemPresetChoice` sheet now serves
      only the Mark-as-Final fallback gate in `ProjectWorkspace`.)
    - **Design-system lock affordance.** The **Design System row only**
      (`isLockedAsset` in `ArtifactWorkspace`) shows a small `Lock` icon in the
      sidebar/mobile-header once its slot status is `done`, signalling the
      project's visual direction is locked in — one committed aesthetic every
      downstream asset is generated against. It's a passive nudge, not a hard
      lock: the user can still change direction via `ChangeDirectionModal`
      (which carries the downstream-regression warning), but the lock
      encourages staying with one aesthetic to avoid costly regeneration of
      screens/mockups. Do **not** re-add per-asset lock icons to downstream
      rows.
    - **Mockup-drift prompt.** Regenerating the design system produces a new
      `tokensHash`, which `stalenessSlice` already uses to flip dependent mockups
      to `possibly_outdated` (the auto-flag). On top of that, the Mockups view in
      `ArtifactWorkspace` renders an amber **"Design system changed … Regenerate
      the mockups"** banner when the mockup's recorded design_system
      `anchorInfo` (tokensHash) differs from the project's current preferred
      design system (`selectPreferredDesignSystem`), wired to the existing mockup
      regenerate-confirm. Mockup *images* are keyed by the new mockup version id,
      so the user must regenerate to pull the new visual direction through.
  - **Canonical PRD Spine (`src/lib/canonicalPrdSpine.ts`) — the primary,
    authoritative context for artifact generation.** `buildCanonicalPrdSpine(prd,
    options)` is a **pure, deterministic** builder (NEVER an LLM call) that
    distills the finalized `StructuredPRD` into a compact structured contract
    (`CanonicalPrdSpine` in `src/types`): product identity, users/JTBD, a
    canonical feature glossary (**PRD `Feature.id`s preserved verbatim**),
    conservative **screen seeds** (deterministic `scr-<slug>` ids) and **entity
    seeds** (deterministic `ent-<slug>` ids — isolated in `slugId`, an interim
    stable-id source), constraints (privacy/security auto-extracted), safety
    restrictions (reconstructed from the persisted `SpineSafetyReview` via
    `buildRestrictionDirective`), architecture direction, and design direction
    (from the selected preset). Seeds are **seeds, not full artifacts** — derived
    only from existing structured fields (`uxPages`/`userLoops`;
    `domainEntities`/`richDataModel`), never invented. `validateCanonicalPrdSpine`
    records non-invasive warnings in `spine.meta.validation` (never a silently
    empty/misleading spine). The spine is **attached to `SpineVersion.canonicalSpine`**
    on final settle (`updateSpineStructuredPRD`, only when `generationMeta` is
    present — a diagnostic/diffing copy; artifact generation always **rebuilds it
    lazily** from `structuredPRD` so old projects and post-edit PRDs stay
    consistent). In `generateCoreArtifact` the prompt is assembled by the pure,
    unit-tested **`src/lib/services/artifactPromptBuilder.ts`** (`buildArtifactPrompt`)
    with an explicit, machine-checkable **source hierarchy** — labeled sections in
    a fixed authority order: **`## TASK` → `## SOURCE HIERARCHY — READ FIRST`
    (the conflict-resolution rules) → `## GUARDRAILS` → `## AUTHORITATIVE —
    CANONICAL PRD SPINE` (or `## AUTHORITATIVE — STRUCTURED PRD SUMMARY` on the
    legacy no-spine fallback) → `## AUTHORITATIVE — STRUCTURED DEPENDENCY
    SUMMARIES` → `## TASK CONSTRAINTS — SELECTED OPTIONS` (preset, only when
    present) → `## KNOWN CONFLICTS & STALENESS` (only when there is something to
    report) → `## APPENDIX — FULL PRD MARKDOWN (SECONDARY REFERENCE ONLY)`**. The
    hierarchy is: (1) canonical spine authoritative, (2) structured dependency
    summaries authoritative for the detail they own but yielding to the spine on
    conflict unless explicitly newer/valid, (3) selected preset/options are hard
    task constraints, (4) full PRD markdown is **secondary reference only** and
    must never override the structured sources — with an explicit instruction to
    cite features by canonical id/name, never a prose-only/stale name. The
    conflict/staleness block surfaces machine-derived notices (missing REQUIRED
    dependencies via `findMissingRequiredDependencies`, spine validation
    warnings) plus **stale feature-name conflicts** (`detectStaleFeatureNames`:
    canonical feature names absent from the PRD prose → likely drift). The spine
    subsumes and **replaces** the old standalone feature glossary + inline PRD
    summary (they are dropped when a spine is present, used only in the legacy
    fallback). A spine with **no features** yields a null spine section → the
    legacy structured-summary fallback. Each artifact version stamps
    `metadata.spineContextUsed` / `spineSchemaVersion`. Do **not** re-add the
    duplicate glossary/summary blocks alongside the spine, do **not** feed long
    markdown into the spine (it must stay compact/structured), and do **not**
    re-order the prompt so the PRD markdown appendix precedes the structured
    sources. See `docs/CANONICAL_PRD_SPINE.md`.
  - `coreArtifactService.ts` — the 7 core artifact types
    (screen_inventory, data_model, component_inventory, user_flows,
    implementation_plan, prompt_pack, design_system). **`prompt_pack` is
    RETIRED from new generation** (see "Consolidated Implementation Plan"
    below): it stays in the subtype union, pipeline, and complexity map so
    legacy persisted artifacts keep working, but new runs never generate it.
    **Per-artifact model
    routing (`src/lib/artifactModelSettings.ts`):** the routing brain lives in
    `artifactModelSettings.ts` (not coreArtifactService) so the Settings UI and
    the generation pipeline share one source of truth. Each subtype is tagged in
    `CORE_ARTIFACT_COMPLEXITY` (`low`/`high`); `getArtifactModel(subtype)`
    resolves **(1)** an explicit per-artifact override (Settings → "Artifact
    Generation Models", persisted as the `GEMINI_ARTIFACT_MODELS` JSON map),
    else **(2)** the complexity recommendation — `high` (screen_inventory,
    user_flows, data_model, implementation_plan) → Expert/Pro (`getStrongModel`),
    `low` (component_inventory, design_system, prompt_pack) → Fast/Flash
    (`getFastModel`), else **(3)** the tier fallback in `getFastModel`/
    `getStrongModel`: an explicit tier model → the single Default model
    (`GEMINI_MODEL`) → the **tier's own default** (`DEFAULT_FAST_MODEL` = Flash,
    `DEFAULT_STRONG_MODEL` = Pro, both in `geminiClient.ts`). The strong tier
    defaults to **Pro**, matching the Settings pickers — it must never collapse
    to the Flash global default (the old `getStrongModel → getModel →
    DEFAULT_GEMINI_MODEL` chain did, so complex PRD sections / high-complexity
    artifacts silently ran on Flash even though Settings advertised Pro).
    `coreArtifactService.selectArtifactModel`
    delegates to `getArtifactModel` and re-exports `CORE_ARTIFACT_COMPLEXITY` for
    back-compat. Existing projects have no override key, so behaviour is
    unchanged until the user picks a model (no migration). The resolved model is
    threaded into every generate **and** refine call, and `artifactJobController`
    records that same per-subtype model in workflow metrics. Keep
    `CORE_ARTIFACT_COMPLEXITY` in sync when adding a `CoreArtifactSubtype`.
    **Mockups are image artifacts, not text:** `artifactModelSettings` also owns
    the mockup **image source mode** (`getMockupImageMode`/`setMockupImageMode`,
    `SYNAPSE_MOCKUP_IMAGE_MODE`: `gpt_image` | `user_uploaded`, default
    `gpt_image`). `resolveMockupRender(mode, hasOpenAiKey)` decides per screen:
    `user_uploaded` (or `gpt_image` with **no** OpenAI key — a non-silent forced
    fallback) → the manual prompt+upload sheet (`MockupScreenUpload`, reusing the
    IDB-backed `screenInventoryImageStore` keyed by the mockup version id);
    otherwise the OpenAI gpt-image-2 generator (`MockupScreenImage`).
    `MockupImageStatusChip` summarizes per-version status (AI-generated /
    uploaded / awaiting). **Two-phase completion:** a mockup has a SPEC phase
    (the ArtifactVersion, marked done by the job controller as soon as the spec
    lands) and an independent IMAGE phase (one render per screen, async, can
    partially fail). `computeMockupImageCompletion` (`src/lib/mockupImageCompletion.ts`,
    pure) derives the visual status (`none`/`generating`/`partial`/`complete` +
    `failedScreenIds`) from per-screen image results so the UI never presents a
    mockup as fully complete when images failed: `MockupImageStatusChip` shows a
    red "Images incomplete · N failed" state, and `MockupViewer`'s header swaps
    the flat "AI Generated" badge for the live status and renders a
    "Retry failed images" banner (per-screen retry already exists in
    `MockupScreenImage`). Image failures are tracked in the session-scoped
    `mockupImageStore` `errors`/`inFlight` maps (transient — a reload re-attempts
    on view). The Settings section is `settings/ArtifactModelsSection.tsx`,
    now the single place PRD **and** artifact models are configured: the PRD row
    (badge "Per-section") expands to reveal the authoritative Fast (Flash) /
    Expert (Pro) model pickers **plus** a read-only per-section preview showing
    which tier each PRD section actually runs on — this replaced the old,
    separate "PRD Generation Models" block in `SettingsModal` (removing the
    redundancy that made PRD look like it "defaulted to Flash"). Text artifacts
    have one selector each; Mockups has an "Image Source" select. The `SettingsModal`
    itself groups advanced/fallback controls (Gemini billing project, Local
    browser keys, Integrations, Refine & enhance model) behind collapsed
    `Disclosure` sections; the Gemini billing project ID sits with the vault (it
    applies to every Gemini request regardless of key source), not buried in the
    local-keys fallback. The model list is the shared `src/lib/modelCatalog.ts`.
    Three of these
    (screen/data/component inventory) use Gemini JSON mode with schemas in
    `schemas/artifactSchemas.ts`, then convert to markdown via
    `structuredArtifactToMarkdown()` for storage; renderers in
    `src/components/renderers/` parse that markdown back to card layouts.
    The **`data_model` renderer** (`DataModelRenderer.tsx` +
    `src/components/renderers/dataModel/`) presents the artifact as an
    interactive entity-relationship design surface rather than a schema dump:
    a compact **overview header** (`DataModelOverview` — a single header row of
    database-icon + "Data Model" title with an optional freshness pill, over a
    2-col-on-mobile grid of **six metric tiles**: entities, relationships,
    constraints, indexes, entities-with-PII, and **API endpoints** — the API
    count comes straight from `summary.apiEndpointCount`, never hardcoded).
    **Provenance is deliberately NOT shown inside this card** — "Generated from
    PRD Version N" lives once at the artifact/page level
    (`ArtifactWorkspace.renderVersionControls`), so the card takes only
    `staleness` (the "Current" pill), not `prdVersionLabel`. Don't re-add a
    subtitle count line or a "From PRD …" pill to the card. Next comes an
    **ER-style diagram**
    (`EntityGraph`) that mirrors the artifact dependency graph / user-flow
    diagrams (rounded node cards, deterministic layered SVG layout, directional
    cardinality-labelled edges, click-a-node-to-open-its-card), and
    **collapsible entity cards** (`EntityCard`) whose expanded state shows
    grouped field tables (colour-coded type chips, required/indexed markers) and
    compact **inspector rows** (`InspectorRow`) for relationships / constraints /
    privacy / indexes in a fixed colour language (relationship=blue,
    constraint=purple, privacy=rose, index=slate, warning=amber). All of it is
    **derived, never hand-drawn**, by the pure, unit-tested
    **`src/lib/dataModelGraph.ts`** (`analyzeDataModel` → graph + summary): it
    recovers structured relationships from the parser's `RELATIONSHIP` callouts
    (so cardinality is a faithful derivation of the schema's `DataRelationship`
    `type`, never invented), **dedupes reciprocal `has_many`/`belongs_to` pairs**
    into one parent→child edge, resolves plural/singular targets, tracks
    unresolved/self references separately, and derives conservative entity
    **categories** (`core`/`user_config`/`generated`/`system`/`external`, from
    userFacing/mutability/integration-shaped signals only) used for the optional
    "Group by category" swimlanes and node accents. **Relationship-edge labels
    never overlap entity cards:** `EntityGraph` places each verb+cardinality pill
    with the pure, unit-tested **`placeEdgeLabels`** collision solver (also in
    `dataModelGraph.ts`) — each label starts on its edge midpoint (between-row
    labels already sit in the clear row gap and don't move), and any label that
    would intersect a card (chiefly same-row/horizontal edges, whose midpoint
    lands on the cards' shared vertical centre) is nudged to the nearest clear,
    canvas-clamped position and tethered to its edge with a thin dashed line; the
    graph reserves a top/bottom label lane (`ROW_GAP`) only when a same-row edge
    exists. Don't reintroduce raw midpoint positioning for the pills. The renderer
    keeps the legacy ReactMarkdown fallback for unparseable content and preserves
    the "How This Data Model Works", "How This Appears in the Product", and
    "API Endpoints" sections. Multi-entity models start collapsed (single-entity
    expanded) for scannability; freshness reaches the overview via the optional
    `staleness` prop threaded through `ArtifactContentRenderer` for `data_model`
    (the `prdVersionLabel` prop is passed only to `implementation_plan` now). Do
    **not** change `dataModelMarkdown.ts`'s parser output shape without
    re-checking `dataModelGraph.ts`, which consumes its `ParsedEntity.callouts`.
    The `component_inventory` renderer is a mobile-first, searchable
    component library (sticky search + category/complexity/used-in
    filters, expandable cards with live previews) decomposed under
    `src/components/renderers/componentInventory/`. Its schema/types carry
    optional `accessibility`, `previewType`, and per-prop `required`
    fields (all backward-compatible — older saved inventories lack them);
    when absent, `inferPreview.ts` derives a `previewType` and a
    heuristic, review-flagged accessibility contract at render time so
    every card still shows a preview and a dedicated a11y block.
    `componentInventoryParse.ts` round-trips all these fields through
    markdown.
    **Artifact in-page navigation** is a shared, collapsible **Artifact
    Outline** — `src/components/ArtifactOutlineNav.tsx` (presentational/
    controlled) + `src/lib/useArtifactOutline.ts` (scroll-spy via
    IntersectionObserver, smooth-scroll, and hash `history.pushState` so
    back/forward steps through sections). It mirrors the Mockups "Pages"
    navigator: a numbered list/card, subtle purple active highlight + a
    "Current section/entity" badge, `collapseOnSelect` on mobile (passed
    `isMobile`) with a floating re-open button. Used by the **Design System**
    (sections), **Data Model** (entities), and **Developer Prompts**
    (`prompt_pack`, prompts) renderers, which anchor each section with a
    `scroll-mt-*` id matching an outline item. This **replaced the old
    wrapping "pill" nav** (`SectionTabs`) on the first two pages and the old
    permanent left rail on Developer Prompts — do not reintroduce pills or a
    side rail there; `SectionTabs` survives only in the Implementation Plan
    renderer's legacy-markdown fallback path. When a document-style artifact
    needs in-page nav, reuse
    `ArtifactOutlineNav`/`useArtifactOutline` rather than introducing another
    navigation style.
    The `prompt_pack` (**Developer Prompts**) renderer
    (`PromptPackRenderer.tsx`) survives only for legacy persisted artifacts
    (the subtype is retired — no sidebar row, no new generation): a vertical
    document driven by the shared outline (one card per `### N. Title`), with
    Edit + Copy Prompt actions and a per-prompt `promptEdits` metadata
    overlay. Its markdown parser lives in
    `src/lib/services/promptPackParser.ts`, shared with the implementation-
    plan adapter (which is how legacy Developer Prompts surface inside the
    consolidated view). **Generated prompts are agent-agnostic** — neither
    the legacy prompt_pack prompt nor the implementation_plan prompt-pack
    instructions (`coreArtifactService.ts`) may name or recommend a specific
    coding agent (Cursor, Claude Code, ChatGPT, Copilot). `generatedAt`
    (version `createdAt`) and `versionNumber` thread through
    `ArtifactContentRenderer`.
  - `branchService.ts` — branch consolidation back into the spine.
  - `preflightService.ts` — optional pre-PRD clarification (see "Preflight
    clarification" below). `generatePreflightQuestions()` (safety-gated) and
    `generatePreflightSummary()`; both inject transports for tests and degrade
    to fallbacks (generic question set / local recap) on non-safety failure.
  - `artifactJobController.ts` — concurrency control for artifact bundle
    generation.
- **`prompts/prdPrompts.ts`** — the shared PRD prompt fragments
  (`SAFETY_OVERRIDE`, `PROMPT_CONTRACT`, `RUBRIC_DEFINITION`) composed into
  every section preamble by `prdSectionPrompts.ts`; `SAFETY_OVERRIDE` is
  prepended ahead of all formatting/rubric text as defense-in-depth and is
  **rendered from `safety/safetyPolicy.ts`** (see the Safety gate section) so
  the capability list can never drift from the classifier's. The legacy
  single-pass strategy instruction was removed (no runtime callers; it still
  demanded retired-section content).
- **Shared prompt fragments & snapshot net.**
  `prompts/artifactPromptFragments.ts` holds the artifact-prompt sentences that
  used to be copy-pasted across `CORE_ARTIFACT_PROMPTS` subtypes
  (`artifactRole(role)`, `AGENT_AGNOSTIC_RULE`, `ANTI_PREAMBLE_RULE`);
  `prompts/imagePromptFragments.ts` holds the image-prompt strings shared by
  the internal gpt-image-2 builder and the external copy prompt
  (`IMAGE_PLATFORM_HINTS`, `IMAGE_CLOSING_RULES`, and `fidelityStyleHint(fidelity,
  hasDesignSystem)` — the token-aware variant drops the generic "neutral
  palette"/"accent color" claims whenever the Design System Brief is appended,
  so one prompt never asks for a neutral palette AND a brand palette at once).
  Do not restate these fragments inline in a task prompt — import them.
  **Every major prompt surface is snapshot-locked** by
  `src/lib/__tests__/promptSurfaces.test.ts` (PRD fragments + all section
  prompts, safety classifier + restriction directive, preflight, all
  `CORE_ARTIFACT_PROMPTS`, both image builders): an intentional prompt edit
  must update the snapshot in the same change; an unreviewed snapshot diff is
  drift. See `docs/audits/PROMPT_ARCHITECTURE_AUDIT.md` for the full prompt
  architecture map and remaining recommendations.


### Preflight clarification (`src/lib/services/preflightService.ts`, `src/components/preflight/`)

An **optional** pre-PRD step. After entering an idea on `HomePage`, a
`PreflightModeChoice` sheet offers **Generate Immediately** (unchanged path),
**Quick** (5 questions), or **Deep** (10 questions). Quick/Deep create the
project + spine, seed a `PreflightSession` via `initPreflightSession`, and
navigate to `/p/:projectId` **without** starting PRD generation.

- **State lives on the spine** — `SpineVersion.preflightSession`
  (`PreflightMode`/`PreflightQuestion`/`PreflightStatus`/`PreflightSession` in
  `src/types`), persisted with `spineVersions` (resumable across refresh; no
  `partialize` change). Store actions are on `spineSlice`
  (`initPreflightSession`, `setPreflightQuestions`, `setPreflightAnswer`,
  `setPreflightIndex`, `setPreflightSummary`, `completePreflightSession`,
  `setPreflightError`).
- **Hosted in the workspace.** `ProjectWorkspace` renders `PreflightView`
  (one question per card, progress, Skip/Back/Next, pinned safe-area CTA,
  AI-generated summary → Edit answers / Generate PRD) instead of the PRD/
  progress view while `preflightSession` exists, is not `completed`, has no
  `structuredPRD`, and isn't `blocked`.
- **Safety runs first.** `generatePreflightQuestions()` calls
  `classifyProjectSafety()` before producing any questions — a `disallowed`
  idea throws `SafetyBlockedError`, which `PreflightView` persists as a blocked
  `safetyReview` so the existing `SafetyReviewView` shows and no questions/PRD
  are produced. Non-safety failures fall back to a generic question set
  (flagged `usedFallback`) / a deterministic local summary, never blocking.
- **PRD integration.** Generation goes through the shared
  `src/lib/runPrdGeneration.ts` helper (used by both HomePage and
  `PreflightView`). On **Generate PRD**, `completePreflightSession` runs, then
  `generateStructuredPRD` is called with an `options.preflight`
  (`PreflightContext`) — answered/skipped responses + summary/assumptions/
  unknowns. `prdService` appends `buildClarificationPromptBlock()` (the
  authoritative-intent instruction; skipped → open unknowns) to the prompt
  **after** the safety gate, so every section receives it via `ctx.idea`.

