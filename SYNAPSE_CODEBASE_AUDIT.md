# Synapse Codebase Audit

_Senior full-stack / architecture / code-quality review._
_Date: 2026-06-02 · Branch: `claude/synapse-codebase-audit-t9ZRY`_

> Scope: a systematic read of the PRD generation pipeline, model orchestration,
> safety gate, Zustand state/persistence layer, workspace/artifact flow, version
> history, mobile/web selection UX, the recruiter-portal backend (`api/`), and
> the test/tooling surface. Findings cite `file:line`. Line numbers are accurate
> as of this commit; treat them as anchors, not contracts.

---

## 1. Executive Summary

Synapse is, on the whole, a **well-architected codebase** with unusually
disciplined design in its highest-stakes areas. The safety gate is a genuine
code-level, fail-closed guardrail (not just a prompt); the DAG-based PRD
pipeline is a clean dependency-graph executor with real cycle detection; the
JSON-repair logic is careful; the backend is security-conscious (HMAC sessions,
scrypt, constant-time compares, NoSQL-injection-aware sanitization); and the
mobile selection pipeline genuinely deduplicates what used to be per-component
logic. Test coverage of pure helpers is strong.

The risks that remain cluster in a few predictable places: **the persistence
layer has no quota/error handling** (the single largest silent-data-loss risk),
**a handful of orchestration "glue" paths are untested and have drifted**
(regeneration duplicates the shared helper; cancellation is silently a no-op),
and **two large "god" components** (`ProjectWorkspace`, `ArtifactWorkspace`)
re-render broadly and mix transport with presentation.

**Biggest risks**
1. `localStorage.setItem` is unguarded — a `QuotaExceededError` silently stops
   _all_ future persistence; the user loses everything on refresh. (`storage.ts`)
2. PRD cancellation (`AbortSignal`) is threaded all the way down and then
   **never read** — navigating away does not stop in-flight Gemini calls.
3. `StructuredPRDView.handleRefreshGrounding` fires a full PRD regeneration that
   **bypasses the shared safety-aware path** and discards 8 of 10 sections.
4. Concurrent artifact generation can clobber version arrays because async store
   actions read `get()` outside the `set()` updater (lost-update race).

**Highest-value fixes**
- Wrap persistence writes in try/catch + a quota toast, and flush on
  `pagehide`/`visibilitychange` (mobile).
- Route `ProjectWorkspace.handleRegenerate` through `runPrdGeneration` (kills a
  duplicated, drift-prone callback block and a safety inconsistency).
- Add the one missing integration test for the safety chokepoint
  (`generateStructuredPRD`).
- Make spine IDs UUIDs/monotonic (positional `v${length+1}` IDs can collide).

**Well-structured areas (keep as-is)**
- Safety gate (`classifyProjectSafety.ts` + the `prdService` chokepoint):
  fail-closed, runs before any section, separates user text from system prompt.
- DAG executor: `validateGraph` (unknown-dep + Kahn cycle detection) +
  `withConcurrency`-style bounded dispatch + a runtime deadlock guard.
- `jsonRepair.ts`: careful string/escape tracking, LIFO bracket close, re-parse
  verification with fallback.
- Backend auth (`session.js`, `password.js`, `ownerAuth.js`): textbook.
- Mobile selection pipeline: real dedup, sound `manualCommit` design.
- IndexedDB for images (kept out of the localStorage blob) — correct call.

**Areas needing simplification**
- `ProjectWorkspace.tsx` (846 lines) and `ArtifactWorkspace.tsx` (633 lines):
  split out history/error/overflow UI; use selector subscriptions.
- Three independent JSON-parse-and-repair implementations should converge.
- `artifactValidation` / cross-artifact checks use stale substring heuristics
  that no longer match the JSON-mode renderers' output.

---

## 2. Critical Bugs

### C1 — `localStorage.setItem` is unguarded; quota overflow silently kills all persistence
- **Files:** `src/store/storage.ts:12`, `src/store/storage.ts:40`
- **Problem:** Both the debounced timer write and the `beforeunload` `flush()`
  call `localStorage.setItem` with no try/catch. The persisted blob contains
  full PRDs + all spine/artifact/branch versions and grows unbounded toward the
  ~5 MB quota. When it overflows, `setItem` throws `QuotaExceededError`
  _asynchronously inside the timer_ — an unhandled rejection that aborts the
  write with no signal to the user.
- **Why it matters:** After the first overflow, every subsequent edit is never
  persisted. On refresh, all work since the quota hit is gone. This is the
  single largest silent-data-loss vector in the app.
- **Suggested fix:** Wrap both writes in try/catch; on `QuotaExceededError`
  surface a toast via `useToastStore` and stop pretending the write succeeded.
  Longer term, cap/prune old versions or move large content to IndexedDB (as
  images already are).
- **Risk:** **Critical**

### C2 — PRD cancellation is a no-op for the main pipeline
- **Files:** `src/lib/services/progressivePrdGeneration.ts:368` (declared),
  threaded from `progressivePrdPipeline.ts:80`; never read in `worker`/`dispatch`
  (`:380-459`) or `makeJsonProvider` (`:178-189`).
- **Problem:** `signal?: AbortSignal` is accepted and passed down the whole call
  chain, then never forwarded into `callGemini`. Verified: the only occurrence
  of `signal` in the file is its declaration.
- **Why it matters:** A user who cancels or navigates away from a 60–90s
  generation cannot stop in-flight requests; all 10 sections keep running,
  burning quota, and their `onPartial`/`onSectionStatus` callbacks keep firing
  against a project the user has left. (The single-section _retry_ path,
  `prdSectionRetry.ts:84`, forwards `signal` correctly — only the main pipeline
  is broken.)
- **Suggested fix:** Add `signal` to the provider input and forward it to
  `callGemini`; thread `params.signal` through `worker`/`dispatch`.
- **Risk:** **Critical** (functional + cost)

### C3 — "Refresh grounding" bypasses the safety-aware generation path
- **File:** `src/components/StructuredPRDView.tsx:229` (`handleRefreshGrounding`)
- **Problem:** A UI button calls `generateStructuredPRD(summary)` directly with
  no `onPartial`/`onResult`/`onSafety` callbacks and no project platform, just
  to harvest two fields (`domainEntities`, `primaryActions`), discarding the
  other ~8 sections. If the summary trips the classifier, `SafetyBlockedError`
  is caught only as a generic `e.message` → "Refresh failed" (`:241`); the
  blocked review is never persisted.
- **Why it matters:** A full 10-section DAG run for 2 fields (waste), and the
  documented safety contract — _blocked verdict → persisted blocked review_ —
  is silently broken on this path.
- **Suggested fix:** Add a narrow `regenerateGroundingFields()` service that
  requests only those fields; at minimum handle `SafetyBlockedError` explicitly
  and persist the blocked review.
- **Risk:** **Critical** (correctness + safety inconsistency)

### C4 — Concurrent artifact generation can clobber version arrays (lost-update race)
- **Files:** `src/store/slices/artifactSlice.ts:88-164` (`createArtifactVersion`),
  also `spineSlice.ts:58-94`, `branchSlice.ts:66-119`
- **Problem:** These actions `get()` a snapshot, compute derived arrays
  (`updatedVersions`, `updatedArtifacts`, version numbers) _outside_ the final
  `set`, then splice the precomputed arrays in. Any concurrent `set` between the
  read and the write is overwritten.
- **Why it matters:** Synapse generates the 7 core artifacts **concurrently**
  (`artifactJobController`). Two slots completing near-simultaneously can clobber
  each other's version arrays → a finished artifact silently disappears.
- **Suggested fix:** Do all reads inside the `set((state) => …)` updater using
  the fresh `state` argument.
- **Risk:** **Critical** (data correctness under the app's own concurrency)

### C5 — Spine version IDs are positional and can collide
- **Files:** `src/store/slices/spineSlice.ts:65`, `:73-77`; initial `'v1'` at
  `projectSlice.ts:35`; `branchSlice.ts:83`
- **Problem:** New spine IDs are `v${currentVersions.length + 1}` — positional,
  not monotonic. Any deletion or interleaved regeneration can reproduce an
  existing `vN`. Duplicate IDs break `find(v => v.id === spineId)` (first match
  wins) and staleness matching (`stalenessSlice.ts:27`).
- **Why it matters:** Silent state corruption / wrong-version updates.
- **Suggested fix:** Use `uuidv4()` for spine IDs (branches/artifacts already
  do) and keep a separate display index, or a persisted monotonic counter.
- **Risk:** **High**

### C6 — Partial-failure runs persist a structurally-incomplete PRD as "success"
- **Files:** `src/lib/services/prdSectionMerge.ts:64-74`,
  `progressivePrdPipeline.ts:230-238`, `runPrdGeneration.ts:104-117`
- **Problem:** If a subset of sections fail, `mergeSectionsToStructuredPrd`
  stubs missing required fields to `''`/`[]`, the merged PRD is saved via
  `onResult` as a normal success, and only a `console.warn` records the partial
  failure. The "all sections failed" guard catches total outage but not the
  common 1–2-section failure.
- **Why it matters:** Downstream artifacts (screen inventory, data model) can be
  generated off a PRD with silently-empty core sections. To downstream code the
  PRD looks complete.
- **Suggested fix:** Carry `failedSections` into `generationMeta`; badge the PRD
  and gate downstream artifact generation when required sections are empty.
- **Risk:** **High**

---

## 3. Performance and Optimization

| # | Finding | File(s) | Expected improvement |
|---|---------|---------|----------------------|
| P1 | **Whole-store subscription via object destructure.** `useProjectStore()` is destructured wholesale (~25 members) in both big components, subscribing them to the _entire_ store; any unrelated mutation (another project's job tick, a toast, prd progress) re-renders these large trees. | `ProjectWorkspace.tsx:44`, `ArtifactWorkspace.tsx:86-89` | Use selector functions / `useShallow`. Eliminates most re-renders during active generation (which ticks frequently). |
| P2 | **`slotStatusFor` is uncached, O(slots²).** Called 4+ times across `allKeys` for counts, again per sidebar item (`:410`), again per right-rail item (`:578`), each running `getArtifacts()` array scans. | `ArtifactWorkspace.tsx:123-135` | Compute one `Record<key,status>` with `useMemo`. Removes dozens of store scans per render mid-generation. |
| P3 | **`assetsReady` recomputed every render** via `CORE_ARTIFACT_DISPLAY_ORDER.every(... getArtifacts().some(...))` — 8+ scans even when the finalize modal is closed. | `ProjectWorkspace.tsx:341-347` | Gate behind `showFinalizeSuccess` or `useMemo`. |
| P4 | **Selector getters allocate new arrays each call** (`getArtifacts`, `getLatestArtifactVersion`, `getBranchesForSpine`, `getArtifactStaleness`), defeating Zustand's `Object.is` bail-out if used reactively. | `stalenessSlice.ts:10-57`, `artifactSlice.ts:77-203`, `branchSlice.ts:134-137` | Memoize or document "imperative only". Removes extra/infinite re-renders. |
| P5 | **Head-of-line blocking in the DAG dispatcher.** The ready queue is FIFO and only the head (`ready[0]`) is inspected; a fast section at its concurrency cap blocks runnable strong sections queued behind it. | `progressivePrdGeneration.ts:329-353` | Iterate the ready queue and dispatch any entry whose tier has a free slot. Restores intended cross-tier parallelism (faster PRD wall-clock). |
| P6 | **Redundant concurrency primitive.** A single-slot mockup semaphore exists but the mockup already awaits the entire core pipeline and there is only one mockup slot. | `artifactJobController.ts:243,414-425` | Delete dead primitive; minor clarity/perf. |
| P7 | **Per-write `console.log` on persist** (size + duration) on every state change. | `storage.ts:42` | Remove or debug-gate; noisy console in prod, minor overhead. |

---

## 4. Refactoring and Simplification Opportunities

- **R1 — Split the god components.** `ProjectWorkspace.tsx` (846 lines) owns
  15+ `useState`, two positioning effects, the full regeneration transport loop,
  single-section retry orchestration, finalization kickoff, _and_ an inline
  right-rail history timeline (`:786-818`). Extract `HistoryTimeline`, the
  overflow menu, and the error panel. Same treatment for `ArtifactWorkspace.tsx`.
- **R2 — Regeneration should reuse `runPrdGeneration`.** `handleRegenerate`
  (`ProjectWorkspace.tsx:204-249`) reimplements the exact
  `onProgress/onSectionStatus/onPartial/onResult/onSafety` block that
  `src/lib/runPrdGeneration.ts` centralizes for HomePage and PreflightView.
  Regeneration is the one path that forked → future safety/metadata changes
  won't reach it. Call the shared helper with a `regenerate: true` option.
- **R3 — Converge three JSON parse/repair implementations.** `parseSectionJson`
  (`progressivePrdGeneration.ts:162`), the dead string-branch of
  `parseSectionResults` (`prdSectionMerge.ts:21-37`), and
  `prdConsistencyReview.parse` all repeat the same parse+repair. Centralize on
  one; delete the unreachable string branch (worker always stores parsed
  objects, never strings).
- **R4 — Extract the last duplicated selection block into a hook.** The
  selection _detection_ is deduplicated, but ~40 lines of `dismiss`/`submitBranch`
  /`handleSubmit`/`handleQuickAction` + toolbar JSX are copy-pasted verbatim
  across `SelectableSpine.tsx` and `StructuredPRDView.tsx`. CLAUDE.md already
  claims they are "wired identically" — make it true with a
  `usePrdSelectionBranching` hook.
- **R5 — Replace prose-matching progress with explicit stage ids.**
  `GenerationProgress.tsx:187-197` matches the active stage by first-three-words
  substring; brittle and silent when labels drift. Emit explicit stage ids from
  `onProgress`.
- **R6 — Fix stale validation heuristics.** `artifactValidation.ts:16-34`
  (`EXPECTED_HEADERS`/`MIN_CONTENT_LENGTH`) and
  `artifactOrchestration.ts:89-108` use substring checks that predate the
  JSON-mode renderers; they now fire false "missing section" / "missing API
  surface" warnings. Validate the structured shapes instead (as
  `screen_inventory` already does).
- **R7 — `partialize` should be an allowlist.** `projectStore.ts:31-37`
  hand-destructures the strip-list (`jobs`, `prdProgress`, `prdSectionStatus`)
  with `void _x` lint workarounds; a future transient slice can silently
  persist. Invert to an explicit persisted-keys allowlist or a `TRANSIENT_KEYS`
  constant.
- **R8 — Use Zustand `version` + `migrate`.** Migrations live ad-hoc in
  `onRehydrateStorage` (`projectStore.ts:39-58`) which also mutates `state` in
  place, inconsistent with the immutable style elsewhere.
- **R9 — Consolidate backend crypto duplication.** `constantTimeEqual` is
  duplicated in `ownerAuth.js:6-16`, `admin/recruiters.js:10-20`, and
  `session.js:41-51` (`safeCompare`); `readCookie` duplicates
  `parseSessionCookie`. Move to one `_lib` helper.
- **R10 — `HomePage` dynamic-import dead indirection.** `HomePage.tsx:134-141`
  dynamically imports `useToastStore` that is already statically imported at
  `:12`. Call the static import directly.

---

## 5. Architecture Review

The architecture **supports the product direction well**, with a few seams to
tighten before the implementation-tracking features land.

- **PRD creation pipeline.** The DAG model (true data dependencies, per-tier
  concurrency caps, `validateGraph` + runtime deadlock guard) is the right
  abstraction and is genuinely extensible: adding/reordering sections is a graph
  edit, and the progress UI is graph-derived (`buildGenerationSteps`). The main
  gaps are operational, not structural: cancellation (C2), partial-failure
  surfacing (C6), and the dead/incorrect `refinement` + `confidence` branches
  (see §2/§6).
- **Artifact generation.** `artifactJobController` is a solid idempotent,
  abort-aware controller with Kahn-style dependency layering
  (`coreArtifactPipeline.buildDependencyLayers`). One concurrency seam: a
  per-slot retry race can overwrite `runs.get(projectId)` and leave a dangling
  entry that blocks `startAll` (`artifactJobController.ts:511-556`).
- **Version history.** Functional but the **positional spine IDs (C5)** are an
  architectural liability precisely because history/restore and staleness all
  key off those IDs. Fix before building richer history features.
- **Workspace navigation.** The Mark-Final → Assets transition is thoughtfully
  designed (one-shot `finalizeAutoOpen`, presence-checked `assetsReady`) but
  lives inside the god component and is untested.
- **Multi-model coordination.** Tier selection (fast/strong) is clean. There is
  no _automatic runtime model fallback_ (only a guidance string in
  `geminiClient.ts`); if cross-provider fallback (OpenAI client already exists)
  is a product goal, it needs an explicit orchestration layer — today the
  OpenAI client is essentially unused by the PRD path.
- **Guardrails/safety.** Best-in-class for this codebase — see §7. The chokepoint
  pattern is the model the rest of the app should follow.
- **Mobile/web parity.** Strong shared pipeline; remaining asymmetries are
  mostly intentional (autofocus desktop-only) but undocumented, plus a couple of
  native `window.confirm()` escapes (`StructuredPRDView.tsx:587`).
- **`api/` not type-checked.** The entire serverless backend is `.js` excluded
  from `tsc -b` and ESLint. As the recruiter portal grows, this is the biggest
  structural quality gap on the server side.

**Architectural bottlenecks to watch:** (1) the localStorage blob as the single
persistence substrate (quota ceiling); (2) two oversized components as the
re-render and testability chokepoints; (3) positional spine IDs underpinning
history.

---

## 6. Error Handling and Edge Cases

- **Failed model calls.** `geminiClient` wraps fetch in `fetchWithRetry` and the
  stream in a stream-level retry (reconnect from byte zero) — well done. But
  `formatGeminiError` collapses non-JSON error bodies to `null`
  (`geminiClient.ts:209,274`), losing 502/504 gateway detail. Fall back to
  `response.text()`.
- **Gemini `finishReason === 'SAFETY'` mid-generation** is surfaced as a generic
  error (`geminiClient.ts:219-221`), not routed to the blocked Safety Review
  screen. No PRD is produced (safe), but the UX is confusing. Consider mapping
  it to the blocked state.
- **Partial generation failures.** See C6 — the main unrecoverable-looking gap:
  the run _looks_ successful with empty sections.
- **Invalid/missing API keys.** Config errors are correctly distinguished from
  safety failures and re-thrown to the normal error path
  (`classifyProjectSafety.ts:34-40`). Good.
- **User interruptions / cancel.** Broken for the main pipeline (C2).
- **Network failures.** Retry/backoff present and reasonable; the OpenAI client's
  per-attempt-timeout-vs-cancel separation (`openaiClient.ts:78-121`) is
  exemplary.
- **Empty states.** Idle non-PRD artifact slots show "Not generated yet" with no
  action (`ArtifactWorkspace.tsx:254-308`); a cleared job leaves a dead-end. Add
  a "Generate" affordance.
- **Long-running operations.** Covered by the progress timeline, but its history
  drive mode is prose-matched and silent on mismatch (R5).
- **Mobile text selection/editing.** Sound `manualCommit` design; minor:
  debounce timers are dropped when `manualCommit` flips mid-gesture
  (`useSelectionPopover.ts:135-140`), so the first selection after entering
  select-mode can need an extra tap; desktop popover doesn't reposition/dismiss
  on scroll (`SelectionActionDialog.tsx:139-143`).
- **Unsafe user requests.** Correctly blocked before any content — see §7.

---

## 7. Security and Safety

**Core guarantee verified: an unsafe request cannot produce a partially-filled
PRD.** Classification runs as a hard `await` at the top of `generateStructuredPRD`
(`prdService.ts:72-77`) _before_ the pipeline is invoked; a `disallowed` verdict
throws `SafetyBlockedError` so no section worker runs and `onPartial` (the only
thing that paints draft content) never fires. The blocked path also force-clears
content (`spineSlice.ts:320`: `structuredPRD: undefined, isFinal: false`). The
preflight path enforces the identical gate before generating questions
(`preflightService.ts:83-89`). Blocked spines are gated out of artifact/mockup
generation (`artifactJobController.startAll` early-return, render guards,
`handleToggleFinal` no-op). **Fail-closed** behavior is correct: non-config
transport errors / unparseable output → `disallowed`.

Strong, injection-resistant design: the user idea is passed as Gemini `contents`,
**not** concatenated into the system instruction (`classifyProjectSafety.ts:130`,
`geminiClient.ts:181-188`). Sensitive-data logging is clean — only durations and
char counts are logged, never prompts/ideas/keys/tokens (verified by grep).

**Gaps (defense-in-depth, none break the core guarantee):**

| # | Finding | File | Risk |
|---|---------|------|------|
| S1 | **`retrySlot` lacks the blocked-spine guard** that `startAll` has. Currently unreachable (render guards strip blocked spines), but the invariant shouldn't rely solely on an upstream render guard. | `artifactJobController.ts:511` | Low |
| S2 | **Single LLM call, no length cap / pre-screen.** The entire gate is one `temp 0.1` classification of the full, unbounded idea text; a long adversarial prompt could bury intent. No keyword pre-filter or second opinion. | `classifyProjectSafety.ts:122-136` | Medium |
| S3 | **No input-length validation** on idea/name anywhere (only non-empty trim). Enables S2 and inflates token cost. | `HomePage.tsx:88-99` | Low/Med |
| S4 | **API keys (Gemini, OpenAI, GitHub PAT) in plaintext localStorage.** Inherent to the bring-your-own-key client architecture, but any XSS reads all three; the GitHub PAT (`issues:write`) has the largest blast radius. | `geminiClient.ts:55-56`, `SettingsModal.tsx:103-148` | Medium |
| S5 | **OAuth: no PKCE/`nonce`; `id_token` never verified.** Google/LinkedIn are OIDC but the flow trusts userinfo via access token without verifying `id_token` signature/`aud`/`iss` or `email_verified` before cross-provider account linking. | `api/auth/[provider].js:53-60`, `api/_lib/google.js:59-70`, `api/_lib/users.js:217-221` | High |
| S6 | **`redirect_uri`/base URL derived from client-controlled `Host`/`X-Forwarded-Host`** when `*_REDIRECT_URI` env is unset. | `api/_lib/response.js:11-15` | Medium |
| S7 | **Login user-enumeration timing oracle** — not-found short-circuits before scrypt; existing user pays the hash cost. Rate limit is keyed `IP\|email` so IP rotation defeats it. | `api/auth/login.js:51-59` | Medium |
| S8 | **Rate limiter is in-memory per warm instance and keyed on spoofable leftmost `X-Forwarded-For`.** Effective limit is `limit × instances`; XFF rotation gets a fresh bucket per request. | `api/_lib/rateLimit.js:13,41-57` | Medium |
| S9 | **Stateless, non-revocable sessions.** Logout only clears the cookie; a copied 30-day HMAC token stays valid. | `api/auth/logout.js:4-8` | Low |
| S10 | **Public `?demo=1` snapshot serves the full stored bundle** (`handleGetDemo` → full `data`); any PII saved in the store becomes world-readable if marked demo. | `api/snapshots.js:316,404-405` | Med |
| S11 | **Internal error text returned to clients** (`return … message`). | `api/snapshots.js:476` | Low |

---

## 8. Testing Gaps

Pure-helper coverage is strong (DAG executor, `validateGraph`, jsonRepair,
selection math, safety classifier in isolation, task exporters, tour state).
The gaps are in **orchestration glue** and **the backend's security paths**.

| Priority | Module / behavior | Suggested test location | What to assert |
|----------|-------------------|-------------------------|----------------|
| **Critical** | `generateStructuredPRD` safety chokepoint orchestration | `src/lib/__tests__/prdService.test.ts` (new) | classifier runs before pipeline; `disallowed` throws + pipeline never invoked; `allowed_with_restrictions` appends directive; preflight block appended _after_ gate |
| **High** | `artifactJobController.startAll` | `src/lib/__tests__/artifactJobController.test.ts` (new) | blocked-spine early-return; concurrency caps; idempotent re-entry; retry-race controller ownership (C-race) |
| **High** | `runPrdGeneration` | `src/lib/__tests__/runPrdGeneration.test.ts` (new) | error + `SafetyBlockedError` propagation; preflight context wiring; metadata persisted |
| **High** | `prdSectionRetry.regeneratePrdSection` | `src/lib/__tests__/prdSectionRetry.test.ts` (new) | single-section overlay leaves other sections intact |
| **High** | `branchService.consolidateBranch` + `spineSlice` versioning | `src/lib/__tests__/branchService.test.ts` (new); extend `store/__tests__/projectStore.test.ts` | local vs doc-wide merge; `isLatest` flip; structured-PRD update |
| **High** | `api/` security paths | `api/_lib/__tests__/` (extend) | `password.verify`, `ownerAuth.requireOwner`, admin authz, OAuth `state`/CSRF in `oauthCallback`, `validate.parseJsonBody` |
| **Medium** | Finalization transition | `src/components/__tests__/` (new) | Mark-Final → asset auto-gen → auto-open first non-PRD artifact (`finalizeAutoOpen`/`autoOpenIntent`) |
| **Medium** | History/version restoration | `store/__tests__/projectStore.test.ts` | snapshot restore-as; timeline rendering |
| **Low** | Partial-failure run (C6) | `src/lib/__tests__/progressivePrdGeneration.test.ts` (extend) | 1–2 failed sections → `failedSections` recorded, not silently "done" |

**Tooling gaps:** unused `playwright` devDependency (no suite); `api/` excluded
from `tsc`/ESLint (no static checking on the backend); no coverage reporter
configured in Vitest; `api` Node tests run under jsdom unnecessarily.

---

## 9. Prioritized Fix Plan

### P0 — Must fix immediately
| Title | Why | Files | Size |
|-------|-----|-------|------|
| Guard persistence writes + quota toast; flush on `pagehide`/`visibilitychange` | Silent total data loss (C1) | `store/storage.ts`, `store/toastStore.ts` | Small |
| Forward `AbortSignal` into section calls | Cancellation is a no-op; wasted quota (C2) | `progressivePrdGeneration.ts`, `geminiClient.ts` | Small |
| Fix `handleRefreshGrounding` (narrow service or handle `SafetyBlockedError`) | Safety bypass + 5× waste (C3) | `StructuredPRDView.tsx`, new grounding service | Medium |
| Move reads inside `set()` in artifact/spine/branch actions | Lost-update race under concurrent gen (C4) | `artifactSlice.ts`, `spineSlice.ts`, `branchSlice.ts` | Small |
| Add safety-chokepoint integration test | The hard guardrail has no integration test | `__tests__/prdService.test.ts` | Small |

### P1 — High-value improvements
| Title | Why | Files | Size |
|-------|-----|-------|------|
| UUID/monotonic spine IDs | Positional IDs collide → corruption (C5) | `spineSlice.ts`, `projectSlice.ts` | Medium |
| Surface partial-failure (`failedSections`) + gate downstream | PRDs with empty sections drive artifacts (C6) | `prdSectionMerge.ts`, `runPrdGeneration.ts`, `generationMeta` | Medium |
| Route regeneration through `runPrdGeneration` | Kills duplicated drift-prone block (R2) | `ProjectWorkspace.tsx`, `runPrdGeneration.ts` | Medium |
| Selector subscriptions in big components | Broad re-renders during gen (P1) | `ProjectWorkspace.tsx`, `ArtifactWorkspace.tsx` | Medium |
| OAuth hardening: PKCE/`nonce`/`id_token` verify; `email_verified` | Auth integrity (S5) | `api/auth/*`, `api/_lib/google.js`, `users.js` | Medium |
| Rate-limit on trusted IP + login timing equalization | Brute-force/enumeration (S7, S8) | `api/_lib/rateLimit.js`, `api/auth/login.js` | Small |
| Bring `api/` into `tsc`/ESLint | No static checking on backend | `tsconfig*.json`, eslint config | Small |

### P2 — Refactors / cleanup
| Title | Why | Files | Size |
|-------|-----|-------|------|
| Split `ProjectWorkspace`/`ArtifactWorkspace` | Testability + re-renders (R1) | both | Large |
| Memoize `slotStatusFor` / `assetsReady` / getters | Per-render scans (P2–P4) | `ArtifactWorkspace.tsx`, `ProjectWorkspace.tsx`, slices | Medium |
| Converge 3 JSON parse/repair impls; drop dead string branch | Drift risk (R3) | `prdSectionMerge.ts`, `prdConsistencyReview.ts` | Small |
| Fix stale validation heuristics | False warnings (R6) | `artifactValidation.ts`, `artifactOrchestration.ts` | Medium |
| Allowlist `partialize` + Zustand `version`/`migrate` | Transient leakage / migrations (R7, R8) | `projectStore.ts` | Small |
| Delete dead code (see §below) | Clarity | multiple | Small |
| Resolve worker double-failure bookkeeping + dead refinement/confidence branches | Fragile invariant; latent broken code | `progressivePrdGeneration.ts` | Medium |

### P3 — Nice-to-have polish
- Extract `usePrdSelectionBranching` hook (R4); explicit progress stage ids (R5).
- Replace `window.confirm()` with in-app sheet (`StructuredPRDView.tsx:587`).
- Desktop popover reposition/dismiss on scroll (`SelectionActionDialog.tsx`).
- `formatGeminiError` text fallback; map Gemini `SAFETY` finishReason to blocked.
- "Generate" affordance on idle artifact empty state.
- Remove `playwright` dep; remove per-write `console.log`.

**Confirmed dead code to remove:** `withConcurrency` in `concurrency.ts:3`
(note: `isAbortError` in the same file **is** used by `artifactJobController` —
keep it); `FeedbackModal.tsx`, `SkeletonLoader.tsx`, `StreamingText.tsx` (no
importers); the 4 unused stage constants in `generationStages.ts`
(`PRD_GENERATION_STAGES`, `PRD_REGENERATION_STAGES`, `BUNDLE_GENERATION_STAGES`,
`STALE_REFRESH_STAGES`); `buildStrategySystemInstruction`
(`prdPrompts.ts:60`, self-documented unused); `getIntentInfo`
(`intentHelper.tsx:17`); `listExportProviders` (`taskExport/index.ts:22`);
`SECTION_ESTIMATES_S` (`progressivePrdGeneration.ts:116`).

---

## 10. Implementation Strategy

A safe, incremental rollout — **do not implement everything at once**:

1. **Low-risk bug fixes first (P0, mostly small + local).**
   Persistence guard (C1), signal forwarding (C2), read-inside-`set` (C4), and
   the `handleRefreshGrounding` fix (C3). Each is small, localized, and
   behavior-preserving except where the current behavior is broken.
2. **Test coverage for critical flows (before bigger refactors).**
   Land the safety-chokepoint test, `runPrdGeneration`, `artifactJobController`,
   and `prdSectionRetry`/`branchService` tests. This creates the safety net that
   makes the P1/P2 refactors safe.
3. **Refactors behind existing behavior.**
   Route regeneration through `runPrdGeneration` (R2), converge JSON parsing
   (R3), allowlist `partialize` (R7), then split the god components (R1) once
   tests guard them. Spine-ID change (C5) needs a migration in
   `onRehydrateStorage` so existing localStorage projects keep working.
4. **Performance improvements.**
   Selector subscriptions (P1), memoized status maps (P2–P4), DAG head-of-line
   fix (P5). Measure re-renders before/after.
5. **UX / mobile parity + backend hardening.**
   Extract the selection hook (R4), explicit progress ids (R5), in-app confirm,
   scroll-aware popover; OAuth hardening, rate-limit/timing fixes, and bringing
   `api/` under `tsc`/ESLint.

Throughout: prefer the smallest change that fixes the issue; preserve
user-visible behavior unless it is demonstrably broken (C1–C6); and treat any
spine-ID or persistence-shape change as a migration, never a breaking rename.

> **Uncertainty / needs runtime confirmation:** the C4 lost-update race and the
> `retrySlot` controller-ownership race (`artifactJobController.ts:511-556`) are
> reasoned from code reading; reproducing them needs two artifacts/sections
> finishing within the same tick. The localStorage quota threshold (C1) depends
> on real project sizes — worth instrumenting the persisted blob size in the
> field.
