# Synapse UX Audit — Idea → PRD → Mockups → Execution Artifacts

**Date:** 2026-09-12
**Revision audited:** `f2bb3d8` (`main` after PR #351)
**Method:** static trace of the implemented behavior. Six parallel code traces
(entry & PRD creation · reading & refining · decisions & critique · mockups &
screens · build artifacts & export · cross-cutting) fed a single synthesis;
**every Blocker and Major finding below was re-verified by the auditor at the
cited `file:line`.** Minor and Polish items carry the trace's evidence and were
spot-checked. Claims that are inferred rather than observed are marked
**(assumption)**. No live generation run was performed (the repo's e2e rule
requires scoping a run with the owner first — see §7); visual grounding comes
from `public/screenshots/` and `docs/audits/screens-ux-audit-2026-07/`.
**No application code was changed by this audit.**

**The yardstick.** Synapse's stated purpose is to *easily take a user from an
idea to a concrete PRD, uncover the uncertainties in the original idea, improve
the idea, use mockups to inform functionality, and leave the user with design
artifacts that help them execute the project.* Every finding is judged against
those five promises, not against an abstract UX checklist.

**Relationship to prior audits.** This audit lands after the July 2026 wave —
[WORKFLOW_AUDIT.md](WORKFLOW_AUDIT.md) (stage gating; all three of its tiers are
recorded as shipped), [ARTIFACTS_BUILD_READINESS_AUDIT_2026-07-25.md](ARTIFACTS_BUILD_READINESS_AUDIT_2026-07-25.md)
(W1–W8 shipped in PR #334), [CHANGE_MANAGEMENT_AUDIT_2026-07-25.md](CHANGE_MANAGEMENT_AUDIT_2026-07-25.md),
and the screenshot-based [Screens audit](screens-ux-audit-2026-07/SCREENS_UX_AUDIT.md).
It does not re-litigate their findings; Appendix B records where their
remediation held, where it left a seam, and where it regressed.

---

## 0. Executive summary

### 0.1 Scorecard against the five promises

| # | Promise | Verdict | One-line why |
|---|---|---|---|
| 1 | Easily go from an idea to a concrete PRD | **Mostly delivered** | The fast path is three clicks and roughly a minute and a half, and the PRD content is strong. The edges are hostile: an account before the first idea, a silent key gate, a design-direction interstitial that hides the first value, and transient failures dressed up as safety blocks. |
| 2 | Uncertainties in the idea are uncovered | **Delivered in the machinery, not in the document** | Preflight questions, assumption import, the Sharpen flow and the Decision Center are rigorous — but the PRD itself never shows its own assumptions, risks or open questions, five surfaces disagree on how many items are open, and deferring a material item changes nothing. |
| 3 | The idea is improved | **Partially delivered** | Highlight-to-refine works but costs seven steps and two model calls per sentence and is undiscoverable on desktop; answering an assumption records a verdict without changing a word of the plan (twelve steps for an invisible result); and a live mock "Exploration Canvas" can write placeholder text into the plan. |
| 4 | Mockups inform functionality | **Not delivered** | The documented "approve flows, pick screens, then render" gate is unreachable in the product; images are rendered one screen at a time; there is no way to annotate a mockup or raise a free-form observation from it; and the one loop that exists discards every rendered image when the plan changes. |
| 5 | Artifacts that help execute the project | **Delivered, with heavy ceremony** | The data-model contracts, roadmap, prompt packs and Final Review are genuinely useful. Getting to green requires the Finalize ritual and "regenerate" remedies; the primary handoff copies a prompt without its context; export is fully disabled while any blocking decision is open; and four different vocabularies describe "this output is stale". |

An analogy for the whole: the cockpit is superbly instrumented — every gauge is
honest, every write is append-only and guarded — but the controls are labeled in
three languages (the rail says *Generate*, the header says *Explore outputs*,
the tour says *Assets*), two of the levers are wired to nothing (the mockup
approval gate, the Exploration Canvas), and the instrument the pilot most needs
— *what is this plan unsure about?* — is on a panel behind the seat.

### 0.2 The findings that matter most

| ID | Severity | Promise | Finding | Evidence |
|---|---|---|---|---|
| UX-17 | **Blocker** | 3 | "Dive Into Canvas" is a **mock** that fakes a 1.5 s "exploration" and then writes literal placeholder copy (`[Locally Restructured]: …`) into the real plan on "Apply to Spine". | `BranchCanvas.tsx:58-67,69-93,119`; entry `BranchList.tsx:136-142` |
| UX-25 | **Blocker** | 4 | The mockup **flow-approval gate and the whole Mockups view are unreachable**: they render only for a selection the sidebar stopped producing three days before the gate was added. README §6 and the architecture doc describe a step no user sees. | `ArtifactWorkspace.tsx:220,241-245,409-411,1810-1953,1927`; commits `2b0c094` → `bf4c7dc` |
| UX-18 | **Blocker** | 2, 3 | Answering an assumption (Sharpen, Decision Center, Accept defaults) **never changes the PRD prose**. The only applicable patch stamps a `decision` field on the assumption entry, which the structured view does not render; every other proposal is "review this section yourself". | `decisionImpact.ts:944-1002`; `StructuredPRDView.tsx:394-397` |
| UX-03 | Major | 1 | A **network blip or a missing key on the first call renders as a safety block**: "Request Cannot Be Fulfilled · Blocked · Disallowed Request … falls into a restricted category", with a list of *security-research* alternatives. The missing-key message does not match the regex that would exempt it. | `classifyProjectSafety.ts:35-41,60-68,140-146`; `errors.ts:37` vs `geminiClient.ts:100`; `SafetyReviewView.tsx:31-56` |
| UX-11 | Major | 2 | **The PRD never shows what it is unsure about.** Assumptions, risks and open questions live only in the Decision Center; the components that would render them are unmounted. | `StructuredPRDView.tsx:394-397`; `prd/DecisionLogSection.tsx`, `ReviewConfirmSection.tsx`, `DeferredRisksSection.tsx` (test-only consumers) |
| UX-27 | Major | 4 | **A mockup cannot be turned into a requirement.** "Flag to plan" exists only on system-generated review notes; the free-text control is never rendered in the Screens view; no annotation feature exists anywhere in `src/`. | `ScreenReviewNotes.tsx:220-244`; `ArtifactWorkspace.tsx:1424-1431` vs `1574-1585`; no `annotat*` match in `src/` |
| UX-42 | Major | all | **The journey rail doubles as a command bar.** Clicking *Finalize* persists a readiness review, *Generate* launches a paid multi-artifact run, *Build* opens Export — while the header keeps a parallel set of buttons with different names for the same acts. | `ProjectWorkspace.tsx:1878-1910,1957-1997` |
| UX-21 | Major | 3 | **On a phone the AI refinement thread is invisible.** The branch sidebar is `hidden md:flex`, "Show Sidebar" is `hidden md:flex`, and nothing else mounts the thread. One-tap chips submit `"Clarify: "` as the entire instruction. | `ProjectWorkspace.tsx:2700-2701,2722,2079`; `StructuredPRDView.tsx:234-236` |
| UX-24 | Major | 5 | **"Ready to finalize" becomes "Proceeding with accepted risk" on click.** The modal headline uses `hardBlockerCount === 0`; the recorded conclusion uses a stricter predicate. | `ReadinessCheckpoint.tsx:163,196`; `readinessReview.ts:762-763` |
| UX-35 | Major | 5 | **Export — including a plain PRD download — is fully disabled** while any `materiality: 'blocking'` record is open; the versioning doc says exports are never blocked. | `ExportModal.tsx:361-412`; `docs/architecture/VERSIONING_AND_EXPORT.md:47` |
| UX-36 | Major | 5 | **No API-key check on the outputs trigger**: six red rows and a failure checkpoint on a device without a key. | `ProjectWorkspace.tsx` (no `hasGeminiKey` reference); `artifactJobController.ts:852-903` |
| UX-51 | Major | all | **The README's screenshots show the retired four-tab rail** (Plan · Challenge · Explore · History) and promise "annotated visual feedback", swipe navigation and reduced-motion support that exist only in the tour. | `public/screenshots/*.png` vs `JourneyRail.tsx`; `README.md:9,49,136`; no `Markup*`/`annotat*` in `src/` |

### 0.3 The shape of the problem, in four sentences

1. **The forward path is fast; the first-run edges are hostile.** Three clicks
   and one wait produce a good PRD, but a new user meets an account wall, a
   silent settings modal, a design question before any content, and — if the
   network hiccups — an accusation-shaped error.
2. **Uncertainty is captured rigorously and then hidden.** The system knows
   exactly which assumptions it made; the document the user reads does not say
   so, and the act of answering does not visibly change it.
3. **The mockup→plan loop is severed at both ends.** The entry gate is
   unreachable; there is no way to say "this screen reveals a missing
   requirement" in your own words; and closing the loop erases the images.
4. **The vocabulary has drifted apart from the product.** Rail, header, drawer,
   tour, README and architecture docs each narrate a different progression, and
   four "stale" vocabularies coexist on one artifact.

---

## 1. Method and scope

- **In scope:** everything a signed-in product user can reach from `/` through
  `/p/:projectId` — entry, preflight, generation, the Refine surfaces (PRD,
  Decision Center, critique), Finalize, Generate/Review (artifacts, Screens,
  mockups), Build (export, tasks, handoff), history, settings, sync, and the
  marketing surfaces (`/tour`, README) as promises the product must keep.
- **Out of scope:** the recruiter portal, snapshot administration, the LLM
  trace viewer (owner-only and correctly gated), prompt quality, and model
  output quality — except where the UI misrepresents it.
- **Severity:** *Blocker* = corrupts data, makes a core promise unreachable, or
  dead-ends with no recovery. *Major* = materially harms one of the five
  promises. *Minor* = friction or inconsistency. *Polish* = copy and cosmetics.
- **What a live run would add.** Timing, real generated content, and mobile
  rendering. §7 says how to scope one; nothing below depends on it.

---

## 2. The journey as a first-time user experiences it

### 2.1 Fastest path (key already saved)

| Step | What the user does | What they see | Source |
|---|---|---|---|
| 1 | Opens `/` | **Login page** (tagline, "Take the tour", "Demo project", Sign In / Sign Up). An account is required before typing an idea. | `App.tsx:62`, `LoginPage.tsx:135-157` |
| 2 | Signs in | "Welcome to Synapse" hero: project name, prompt ("What product shall we design?"), App/Web toggle, "Enhance", arrow submit, five example prompts. No tagline, no mention that a Gemini key is needed. | `HomePage.tsx:417-601` |
| 3 | Submits | Dialog **"How would you like to start?"** — *Develop the idea · Recommended*, *Draft a working plan · Fastest*, *Explore deeply · Broader discovery*. No question counts, time or cost. | `PreflightModeChoice.tsx:16-37,56` |
| 4 | Picks *Draft a working plan* | Workspace opens on **"Synapse is preparing your PRD. While that runs, choose a visual direction…"** with eight presets — the progress timeline is hidden while this card is up. | `ProjectWorkspace.tsx:2442-2449`; `DesignSetupStep.tsx:71-130` |
| 5 | Picks or defers a direction | The **PRD Generation** timeline: "2 of 8 steps · 25%", waves "Running concurrently", per-section model chips and "Elapsed / Est." Sections paint in as they land. | `ProgressTimeline.tsx:126-200` |
| 6 | Waits (~70–100 s **(assumption)**) | Timeline disappears; an indigo card **"N new assumptions arrived with this plan"** with *Accept defaults / Review each / Later*; then the planning bar **"Your draft is ready — Synapse filled N gaps with working assumptions…"**, a *Sharpen my plan (N questions)* button and three numbered tools. The header shows a saturated green **Explore outputs** pill. | `AssumptionArrivalCard.tsx:53-118`; `planningOverviewPresentation.ts:36-44`; `PlanningStateBar.tsx:57-106`; `ProjectWorkspace.tsx:1957-1979` |

Three interruptions before value (mode dialog, design interstitial, arrival
card) and three competing "what next" signals on arrival (rail *Refine* is
current; the bar says *Decision Center · Start here*; the only filled header
button says *Explore outputs*).

### 2.2 Recommended path (*Develop the idea*)

Adds: a safety call + a question call ("Preparing your clarification questions…
Tailoring 5 questions to your idea."), five one-per-card questions with a
"why it matters" line, Back/Skip/Next, a summary call, then **"Here's what I
learned"** with *Assumptions* (neutral) and *Open questions* (amber) and
*Edit answers / Generate PRD* (`PreflightView.tsx:85-88,214-351`). Answers are
injected into every section prompt and re-injected on regenerate; skipped
questions become open unknowns; unknowns and assumptions are imported as
planning records with `sourceType: 'preflight'` (`assumptionImport.ts:175-208`).
**This is the best-designed stretch of the product** — and the answers are never
shown again after generation (only the raw "Initial Prompt" is,
`ProjectWorkspace.tsx:2478-2485`).

### 2.3 From PRD to outputs to handoff

Refine (PRD + Decision Center + optional critique) → **Finalize** (a modal that
persists a readiness review each time it opens) → success modal with one primary
(*Generate build foundation* / *Explore outputs* / *Review outputs*) → up to
three more interruptions (incomplete-PRD confirm, pre-build card, visual
direction picker if skipped earlier) → six core artifacts + a mockup *spec* in
three dependency layers → a completion card → per-screen image rendering →
Implementation Plan's **Final Review** (*Resolve N blockers → Approve build
packet → Copy first implementation prompt*) → **Export** (agent handoff, bundle,
JSON, tasks).

### 2.4 The returning user

Lands on the creation hero. Their projects are behind an icon-only button
(`title="Projects"`, `HomePage.tsx:340`) in a drawer sorted by **creation**
date with a status badge but no "last opened" or "next step"
(`ProjectDrawer.tsx:28-66`). Inside a project the rail shows which step is
current, and the planning bar's next action exists only on the PRD view; on the
critique, artifact and Screens surfaces orientation falls back to the rail and
stage banners. Rail steps that are off render `disabled` with the caption
**Unavailable** and no reason (`JourneyRail.tsx:39-45,62`).

---

## 3. Findings by promise

Format: **what the user experiences → why it matters → evidence → fix.**

### 3.1 Promise 1 — Easily from an idea to a concrete PRD

**UX-01 · Major · An account before the first idea.** `/` renders the login
page unless a session exists; every non-showcase project route is auth-gated
(`App.tsx:62,83,115-119`). The login page never says what an account unlocks,
and the README's "no sign-up" applies only to the tour and demo. *Why:* the
first promise is "easily"; a sign-up wall before the first sentence is the
single largest drop-off risk. *Fix:* either an anonymous local-first trial
(the store is already local-first; sync can attach on sign-in), or one sentence
on the login page: "Sign in so your projects and keys follow you across
devices."

**UX-02 · Major · The silent key gate.** Submit with no key simply opens the
Settings modal ("Project Settings / Configure your AI intelligence"), whose
first section is account linking; the Gemini row with its "Get key" link is
below (`HomePage.tsx:211-213`; `SettingsModal.tsx:182-183,249-252`). After
saving, the user must close the modal and submit again. Nothing on the home
page mentions the key. *Fix:* an inline notice above the form ("Add a free
Gemini key to generate — Get key"), open the modal scrolled to the key row with
a heading, and auto-continue to the mode dialog once `hasGeminiKey()` flips.

**UX-03 · Major · Transient failures wear the safety block's clothes.** The
classifier fails closed on any non-config error — network, parse, model
refusal (`classifyProjectSafety.ts:140-146`). The fail-closed result reuses the
"disallowed" classification and the default security-research alternatives
(`:60-68`), so the user sees **"Request Cannot Be Fulfilled · Blocked ·
Disallowed Request — Synapse identified that this request falls into a
restricted category"** and "If your goal is legitimate security research…"
(`SafetyReviewView.tsx:31-56`) for a dropped connection. Worse, a missing key
is *meant* to be exempt (`CONFIG_ERROR_CATEGORIES`, `:35-41`) but the thrown
message "Add a Gemini API key in Settings to generate PRDs." (`geminiClient.ts:100`)
does not match the `/missing gemini api key/i` pattern (`errors.ts:37`), so it
is categorised `unknown` and fails closed too. *Why:* the first call a new user
makes is the one most likely to hit a cold network or an unprimed vault; an
accusation-shaped screen at that moment costs trust that a plain "we couldn't
reach the model, try again" would not. *Fix:* a distinct `unverified` outcome
with calm copy and a Retry; widen the pattern to `/gemini api key/i`; add the
missing-key test string to `classifyProjectSafety.test.ts`.

**UX-04 · Major · "Revise Request" cannot revise.** The safety view's primary
button is wired to `handleRegenerate`, which re-runs the identical stored
prompt (`ProjectWorkspace.tsx:2532,1359`); the workspace has no prompt editor
(the Initial Prompt block is a read-only paragraph, `:2485`). The only real
path is "Start New Project", which lands on an empty form. *Fix:* "Revise"
opens an editable, prefilled prompt that regenerates as a new version.

**UX-05 · Major · Preflight can spin forever.** If question generation rejects
with anything other than a safety block (a config error re-thrown by the
classifier — e.g. a revoked or unprimed key), the effect only
`console.error`s; status stays `awaiting_questions`; no component ever calls
`setPreflightError`; and reload skips open preflight sessions
(`PreflightView.tsx:59-72,80-91`). The user watches "Preparing your
clarification questions…" indefinitely. *Fix:* on error write
`setPreflightError`, render it with *Retry* and *Skip questions and generate*.

**UX-06 · Major · A design question before any content.** On the fastest path
the first workspace screen asks for a visual direction; while it is shown, the
progress timeline is hidden (`ProjectWorkspace.tsx:2442-2449`). The decision is
about mockups, which are minutes and several steps away, and the same choice
is offered again at output generation (`DesignSystemPresetChoice.tsx`). *Fix:*
stream the PRD and timeline immediately; offer the direction as a dismissible
side card, or defer entirely to the existing pre-generation picker.

**UX-07 · Minor · The mode dialog hides cost and time; preflight has no escape
hatch.** "Recommended" is the slower path; no "5 questions · ~1 min" hint; once
inside, the only way out is to Skip every card and still wait for the summary
call (`PreflightView.tsx:135-140`). *Fix:* add count/time hints and a "Skip the
rest and generate" action.

**UX-08 · Minor · An interrupted run discards streamed sections.** Reloading
mid-run sets `generationError`, and the error card wins over the partial
`structuredPRD` (`interruptedGeneration.ts:40-51`;
`ProjectWorkspace.tsx:2534` before `:2582`); *Try Again* regenerates
everything. *Fix:* treat interruption like partial failure — keep completed
sections, retry the pending ones.

**UX-09 · Minor · The user's own answers vanish; completion is implicit.**
After generation only the raw prompt is shown; the arrival card calls preflight
*open questions* "assumptions"; the timeline simply disappears with no "PRD
ready" state or `aria-live` announcement (`ProjectWorkspace.tsx:2461,2478`;
`AssumptionArrivalCard.tsx:53-60`). *Fix:* an expandable "Your answers" block
under Initial Prompt; label the card by record type; a one-line "Your PRD is
ready" status.

**UX-10 · Polish · "Enhance" rewrites the idea with no undo.** The AI rewrite
replaces the textarea contents in place (`HomePage.tsx:242-262`); the original
is kept only if the call fails. *Fix:* show the rewrite as a diff or keep an
"Undo enhance" for one step.

### 3.2 Promise 2 — Uncertainties in the idea are uncovered

**UX-11 · Major · The PRD never says what it is unsure about.** The structured
view renders no assumptions list, no risks, no decision log — by design: "the
decision list/log/risks themselves render in the Decision Center, not here"
(`StructuredPRDView.tsx:394-397`). The components that would do it
(`prd/DecisionLogSection.tsx`, `ReviewConfirmSection.tsx`,
`DeferredRisksSection.tsx`) have no consumer outside tests, and PRD risks are
never imported as planning records (`assumptionImport.ts` imports assumptions
and preflight unknowns only). What the reader gets instead is two highlighted
statements on a session-only arrival card, amber "Planning item needs review
in this section" chips on five sections whose matching depends on the model
naming a recognisable section (`prdSectionPrompts.ts:214`;
`StructuredPRDView.tsx:493-503`), and a slide-over. *Why:* this is the second
promise, and a PRD that does not carry its own open questions cannot be handed
to anyone else without the app. *Fix:* render an **"Open questions & risks"**
section at the end of Overview — assumptions with materiality and current
answer, risks with mitigation, preflight unknowns — each row deep-linking to
its Decision Center record; keep the per-section chips.

**UX-12 · Major · Five counts, and deferral is cosmetic for material items.**
`planningRecordRequiresResolution` treats any *material* assumption as
unresolved regardless of status (`planningReadiness.ts:98-104`), so *Not sure
yet* keeps the record in the Sharpen count and it is re-asked
(`planningAttention.ts:153-156,289-300`) while the Decision Center says
"Nothing needs an answer" (`DecisionCenter.tsx:154,528-531`). Five denominators
coexist: "N need an answer", "Sharpen my plan (N)", "N open items — critiquing
now may re-raise them" (`ReviewWorkspace.tsx:249`), "k key choices, m material
assumptions … need attention" (`planningReadiness.ts:226`), and "N open items
remain" at Finalize. `deferred.revisitAt` is typed but has no UI
(`types/index.ts:1746`). *Fix:* derive every count from one predicate
(`needsVerdict`); make Defer terminal for non-blocking records or require a
revisit condition.

**UX-13 · Major · "Accept defaults" is the primary action, advances nothing
visible, and creates chores.** Accepting records one `accept_default` verdict
per record with the statement as the answer (`batchVerdicts.ts:126-141`); PRD
text is unchanged; the card returns `null` when nothing is pending, so its
"5 recorded · 0 skipped" line is only ever screen-reader text
(`AssumptionArrivalCard.tsx:33,83-85`). Material assumptions then read
"Accepted without validation", each verdict spawns an impact preview with
review-only proposals, and the record stays *needs alignment* until each is
dispositioned (`planningReadiness.ts:126-151`; `readinessReview.ts:157`). Six
accepted defaults yield six alignment chores and six "no current
evidence-supported user conclusion" concerns at Finalize. *Why:* engaging
creates more work than ignoring, which teaches users to ignore. *Fix:* make
*Review each* primary; keep a visible summary after a batch; do not generate
review-only proposals for a plain confirmation; count only real work.

**UX-14 · Major · Critique-derived records lose their "why".** Promoting a
finding drops `consequence`/`whyItMatters`; the Decision Center then shows the
first evidence excerpt (a PRD quote) under *Why it matters*
(`useReviewIssueActions.ts:34-45`; `planningRecordViews.ts:78`). Risks created
this way get no `materiality`, so they are treated as material and can never
clear *Material risks addressed* whatever their status
(`planningReadiness.ts:90-118`); they land under *Needs your decision* with the
placeholder "Record the product choice in your own words" and no owner or
response fields. *Fix:* carry the finding's consequence into the record; give
risks a materiality and an owner/response shape.

**UX-15 · Minor · The critique has no narrative summary and a narrow re-run
dedupe.** Results are tiles (*Needs attention / Build blockers / Deferred*) and
cards; nothing says "12 findings → 3 blocking, 4 recommended, 5 FYI". Only
*dismissed* issues with identical fingerprints carry over on re-run; issues
already promoted to decisions are re-raised (`useReviewRunController.ts:128-157`).
Option generation is not triggered on record creation (`onChoiceRecordCreated`
never wired, `ReviewWorkspaceContainer.tsx:60-62`), so the user meets "Synapse
is preparing 2-3 suggested approaches" only on opening.

**UX-16 · Minor · Assumption vs decision vs risk vs open question is never
explained.** The only definitions in the product are the descriptions inside the
critique's disposition dropdown (`ReviewWorkspace.tsx:224-234`). *Fix:* one
sentence on the arrival card and a "What's the difference?" popover in the
Decision Center: *an assumption is a fact Synapse guessed; a decision is a
choice only you can make; a risk is something that could go wrong.*

### 3.3 Promise 3 — The idea is improved

**UX-17 · Blocker · A mock "Exploration Canvas" can corrupt the plan.** Each
active branch card carries a maximize icon titled "Dive Into Canvas"
(`BranchList.tsx:136-142`). The canvas fakes a 1.5 s "Exploring design
approaches…" and returns two canned drafts — `[Locally Restructured]:
${anchorText}\nMaintains original tone, just clarifies…` and `[Doc-Wide
Rewrite]: Integrates the branch intent globally…` (`BranchCanvas.tsx:58-67`,
comment: "Mock generation of two approaches"). **"Apply to Spine"** then writes
that literal string over the selected passage via
`applyAnchorEditToStructuredPRD` + `mergeBranch` (`:69-93,119`). A curious user
replaces a paragraph of their plan with placeholder copy, and the branch is
closed. *Fix:* remove the entry point (or gate it behind a dev flag) until the
canvas is real; the branch reply + consolidation path already does this job.

**UX-18 · Blocker · Answering an assumption never changes the plan's words.**
For a PRD-sourced assumption the impact preview contains exactly one applicable
patch: the `assumptions[i]` entry gains `decision` / `decisionNote` / `decidedAt`
(`decisionImpact.ts:944-956,1014-1026`). Every other affected location is an
`operation: 'review'` proposal whose reason is "Synapse couldn't determine a
safe update here — review this section yourself." (`:989-1001`). The structured
view does not render assumptions (UX-11), so after *Apply accepted changes* the
only visible effect is an amber chip disappearing; the correction surfaces
solely in the markdown export as "**Marked incorrect** (a2): … — Correction: …"
(`prdMarkdownRenderer.ts:414-426`, per trace). Concrete path for "Musicians
will pay before finishing" → *Not quite — correct it*: Review each → Not quite
→ Save correction → Done → open Decision Center → *Resolved & history* → select
→ expand *Plan alignment* → Accept → Not affected ×2 → Apply → toast "Working
plan updated … Nothing else was rewritten." **Twelve steps, one modal, one
slide-over, and the monetization prose is unchanged.** *Why:* this is the
mechanism by which the second promise is supposed to deliver the third; today it
records the user's judgement and stops. *Fix:* when a verdict lands on a
PRD-sourced assumption, run a bounded model rewrite of the
`affectedPrdSections` as the impact preview (the `reasonAboutComplexPlanningTargets`
path already exists for claim targets), show a before/after diff *in the PRD*,
and render the decision log in the structured view.

**UX-19 · Major · Highlight-to-refine is undiscoverable on desktop.** No hint,
tooltip or hover cue exists on the PRD body. The one instruction — "Highlight
text in the spine to create a branch." (`BranchList.tsx:55`) — lives in a
sidebar that is closed by default and opens only after a branch exists or via
the overflow's "Show Sidebar" (`ProjectWorkspace.tsx:352,2663,2078-2083`).
Section pencils are `text-neutral-300`; feature pencils and delete buttons are
`opacity-0 group-hover` (`StructuredPRDView.tsx:582,849`; `FeatureCard.tsx:109`).
Mobile is paradoxically better: a pinned "Select text to edit" pill. *Fix:* a
persistent one-line hint under the tabs, `cursor: text` + hover affordance on
editable blocks, and low-emphasis but always-visible pencils.

**UX-20 · Major · Seven steps and two model calls to change one sentence, and
failure arrives last.** Select → chip → type → *Branch* → wait for the reply →
*Consolidate now* → scope modal (*Local Patch* vs a disabled *Doc-Wide
Rewrite*) → *Generate Local Patch* (a second call that re-asks the model to
rewrite, `branchService.ts:21-22`) → preview → *Commit to New Spine*. Even
"Replace: use SSO instead" goes to the model twice; the reply's "Suggested
replacement" block is parsed (`stagedBranchEdits.ts:21`) but `handleStageBranch`
ignores it and consolidates again (`ProjectWorkspace.tsx:1600-1606`). The
exact-unique-match requirement (`structuredPrdAnchorEdit.ts:76-78`) fails only
at the end — "Could not locate the exact selected text…" (`ConsolidationModal.tsx:66-68`)
— after both calls have been paid for; selections crossing a rendered label
such as "User Value:" are the likely trigger **(assumption)**. *Fix:* validate
the anchor at selection time; offer "Replace with my text" with no model call;
when a reply carries a replacement block, offer "Apply this wording" on the
card and skip the scope modal for structured plans (Doc-Wide is disabled there
anyway).

**UX-21 · Major · The refinement thread is invisible on phones, and one-tap
chips send an empty instruction.** Creating a branch opens the right sidebar,
but that column is `hidden md:flex` and the overflow's "Show Sidebar" is
`hidden … md:flex`; nothing else mounts `BranchList`
(`ProjectWorkspace.tsx:2700-2701,2722,2079`). The mobile toolbar works up to
*Edit selection*, then the AI reply, *Stage edit* and *Consolidate now* are
unreachable. Separately, mobile chips call `submitBranch(tag + ': ')`, so the
model receives "Clarify: " as the whole intent (`StructuredPRDView.tsx:234-236`).
README:49 promises "the full workflow runs on a phone". *Fix:* mount the thread
in a bottom sheet below `md`, opened by `onBranchCreated`; require or prompt
for an instruction on mobile chips.

**UX-22 · Major · Feature "Confirm" gates readiness but is never explained.**
Every MVP feature must be confirmed for "Feature scope confirmed"
(`planningReadiness.ts:207-209,225`); it becomes a readiness concern and a
decision-log entry — yet the only affordance is a tooltip "Confirm feature"
(`FeatureCard.tsx:125`), "Needs review" is simply `!confirmed`
(`prdViews.ts:162`) with no reason, there is no "Confirm all", and the pointer
sits inside a collapsed disclosure (`PlanningStateBar.tsx:246-266`). *Fix:* a
one-line explainer at the top of Features, a "Confirm all in MVP" action, and
per-feature reasons only when there is one.

**UX-23 · Major · Three competing next steps the moment the PRD lands.** The
rail says *Refine* is current; the planning bar says *Decision Center · Start
here*; the header's only saturated button is the green **Explore outputs** pill
(`ProjectWorkspace.tsx:1957-1979`), whose honest caveat ("committing the plan
comes first") is hover-only `title` text. A first-timer is pulled toward
generating outputs from an unrefined plan. *Fix:* demote the outputs pill to
secondary styling until readiness reaches *ready to challenge*; let the planning
bar's primary be the single filled button on the page.

**UX-24 · Major · "Ready to finalize" turns into "Proceeding with accepted risk"
on click.** The modal headline is `ready = hardBlockerCount === 0`
(`ReadinessCheckpoint.tsx:163,196`), while the recorded conclusion is
`ready_to_build` only if a substantive challenge ran, no material assumption is
unvalidated and no criterion blocks (`readinessReview.ts:762-763`). The usual
path is therefore: headline *Ready to finalize* → *Finalize plan* → success
modal *"Proceeding with accepted risk"*, an amber header button "Committed with
accepted risk", a bar chip *Proceeding with accepted risk* — and a rail step
that reads *Complete*. *Fix:* one commitment vocabulary from one predicate; if
the review is `not_ready`, say so in the headline *before* the click, with the
accepted-risk list.

### 3.4 Promise 4 — Mockups inform functionality

**UX-25 · Blocker · The flow-approval gate and the Mockups view are
unreachable.** `MockupApprovalGate` ("Approve flows before generating
mockups"), `MockupViewer`, "Regenerate Mockup", the design-drift banner and
`MockupPromptDialog` render only under `activeSelection === 'mockup'`
(`ArtifactWorkspace.tsx:1810-1953`, gate at `:1927`). The sidebar has no such
row (`items: ['user_flows', 'screens']`, `:220`), every deep link, graph node
and checkpoint destination naming the mockup is rerouted to Screens
(`SCREENS_HOSTED_SLOTS`, `:241-245,409-411`), and the only `setSelected` that
could yield `'mockup'` is an update-plan hop for a plan kind that is never
generated for mockups (`:1341`; update plans cover four other artifacts). The
Screens experience has no approval control of its own. The row was removed on
2026-07-20 (`2b0c094`) and the gate was added into that branch on 2026-07-23
(`bf4c7dc`) — the gate has never been reachable in production. README §6
("approve the flows and pick which screens to render before Synapse generates
the images") and `WORKSPACE_AND_ARTIFACTS.md:129-162` describe a step no user
sees; `mockupApproval` is never written. *Fix:* mount the gate at the top of the
Screens list when the current mockup version has no approval and no images,
give it a "Render the N approved screens" batch action, and delete or re-home
`MockupViewer`. Update the doc and README in the same change.

**UX-26 · Major · Images are rendered one screen at a time.** The user's real
path is Screens → a card → "Primary mockup: No AI image yet" → **Generate AI
image (low quality)** → 5–15 s → repeat (`MockupScreenImage.tsx:241-275`). The
only batch action, "Generate N missing mockups", targets screens *outside* the
five-screen spec and sits inside the collapsed "Project readiness & metadata"
section (`ArtifactWorkspace.tsx:913-937`; `ScreenCoveragePanel.tsx:266-279`). A
five-screen project needs roughly fifteen clicks to see five mockups. *Fix:*
one "Render N mockups" action in the list header (the approval gate's own
per-screen `generate` loop, `:1865-1880`, is the implementation).

**UX-27 · Major · A mockup cannot be turned into a requirement.** On a screen
the only free-text inputs are "Notes (internal)" (an overlay,
`ScreenDetailView.tsx:521-530`) and the risk box "How should this be handled?"
(`ScreenReviewNotes.tsx:418-445`). **Flag to plan** appears only on
*system-generated* review notes with a prefilled title and statement
(`:220-244`); the free-text `ArtifactFlagToPlanControl` is rendered from
`renderVersionControls` (`ArtifactWorkspace.tsx:1424-1431`), which the Screens
branch never calls (`:1574-1585` wires only the note path). No annotation
feature exists in `src/` (no `annotat*` match; `MarkupImageView` /
`MarkupImageRenderer` exist only in `CLAUDE.md`), and the image prompt asks for
"realistic placeholder copy … No watermarks" — no callouts
(`imagePromptFragments.ts:17-20`). *Why:* this is the fourth promise, verbatim,
and the affordance for "this screen shows me the plan is missing X" does not
exist. *Fix:* a per-screen **"Raise a change"** button — free text, prefilled
with the screen name and a link to the image key — through
`flagPlanningConcern` with a screen locator; then a lightweight numbered-callout
legend over the image derived from the screen contract's `coreUIElements`.

**UX-28 · Major · Closing the loop erases the images.** Flag → open question →
Decision Center → verdict → impact → new PRD version → "Outputs need review /
Sync outputs" (`ArtifactWorkspace.tsx:1673-1689`) → regenerate
`screen_inventory` + `mockup` → a new mockup version id. Images are keyed by
artifact version id (cross-cutting rule 12b), so every rendered mockup
disappears and must be re-rendered screen by screen; nothing warns the user
before the regenerate **(assumption: inferred from the image-key rule and the
regenerate path, not run)**. *Fix:* carry images forward for screens whose
contract hash is unchanged (`computeScreenContractHash` already exists in
`mockupVariantTrust`), and state the cost in the "Regenerate Mockup" confirm.

**UX-29 · Major · Risk resolutions and dismissed notes go nowhere.**
`riskResolutions` / `dismissedIssues` are read only by `screenExperience.ts:127-132`
and the two review components; `screenReviewWorkflow.ts` and the coverage
panel's "Open risks … N to review" (`ScreenCoveragePanel.tsx:155-160`) ignore
them, so a resolved risk still counts as open, and the docs' claim that
downstream artifacts consume them (`SCREENS_EXPERIENCE.md:78-80`) is
unfulfilled. *Fix:* feed resolutions into `deriveScreenReviewIssues` and the
handoff export.

**UX-30 · Major · The mockup is an unannotated picture with its contract hidden.**
On Overview the image sits between "Purpose" and "Acceptance criteria"; the PRD
features it serves and the contract (navigation, core UI regions, data outputs,
screen states with trigger / user sees / system) are behind two collapsed
disclosures (`ScreenOverviewPanel.tsx:161-273`). The user cannot see which
feature each region serves. *Fix:* open "PRD features" by default and render
the numbered legend from UX-27 beside the image.

**UX-31 · Minor · Promised controls do not exist; the high-quality path is
dead.** Platform, fidelity, scope and style are defaulted with no UI
(`mockupDefaults.ts:30-40`; the "Regenerate with options" affordance promised at
`:27-29` is absent); the empty-state copy "You can regenerate at high quality
once you like the draft" (`MockupScreenImage.tsx:253`) is false — only the
low-quality path is ever called (`:229,269`). *Fix:* either add the controls
or remove the promises.

**UX-32 · Minor · Honesty gaps around images.** Locally without the image
proxy the sheet blames a missing OpenAI key rather than saying this deployment
cannot render (`MockupScreenUpload.tsx:129-137`); uploaded primary mockups and
variant images do not sync across devices while AI ones do, and only variants
say so (`projectImageSync.ts:1-24`; `MockupVariantsPanel.tsx:525-528`); variants
are viewport × state, not A/B, and selecting one feeds nothing. The Screens
audit's H1/H3 (deficit framing of optional variants; "PRD sync unknown" ×3)
were addressed in copy; the two-status review model (H4) still leaks as three
readiness vocabularies on one screen (`ReadinessBadge.tsx:28-31`;
`ScreenConfirmPanel.tsx:56`; `screenReviewWorkflow.ts:94-98`).

### 3.5 Promise 5 — Artifacts that help execute the project

**UX-33 · Major · Final Review cannot go green without the Finalize ritual, and
most remedies say "regenerate".** Criterion 8 blocks with "The product
reasoning has not been committed" / "A readiness projection recomputed on
render is not an approval." (`buildPacketReadiness.ts:1496-1505`); an
unverifiable commitment demands "Reopen the plan and run Review readiness
again…" (`:1483-1490`). Seven other remedies are "Regenerate the
Implementation Plan so…" / "Regenerate the Data Model so this endpoint carries
auth…" (`:1098,1118,1229,1388,1402,1417,1430`) — regeneration is
non-deterministic, resets copied-prompt progress and the approval
(`buildPacketApproval.ts:52-57`), and the user cannot edit plan structure by
hand. Criterion labels — "Packet inputs current", "First-slice API contracts
complete", "Cross-cutting obligations discharged", "Product reasoning
committed" (`:126-135`) — explain nothing to a product person. *Fix:* plain
labels with a one-line "what this means"; make *reasoning committed* a warning
when the planning projection is ready; targeted "fix this section" regeneration
instead of a whole-artifact regenerate.

**UX-34 · Major · The primary handoff copies a prompt without its context.**
"Copy first implementation prompt" copies prompt + criteria + commit line
(`implementationPlanAdapter.ts:543-554`); the prompt cites "Relevant Synapse
Artifacts" by name, but the PRD, data model and design system reach the agent
only via Export → "Copy for coding agent" (`ExportModal.tsx:419-444`), and
nothing links the two (rationale text: "Start with the first slice and work
down the roadmap.", `buildPacketApproval.ts:436`). *Fix:* the approved-state
primary copies (or downloads) handoff + first prompt in one action, or Final
Review shows "1. Export context · 2. Copy prompt" as a sequence.

**UX-35 · Major · Export is blocked wholesale, against the docs.** `buildBlocked`
disables the entire fieldset — agent handoff, bundle, JSON *and* the PRD
download — with "Finalize blocking decisions before export"
(`ExportModal.tsx:361-412`); task export is blocked the same way while "Save to
project" is allowed (`ConvertToTasksModal.tsx:177-180`). The QA checklist
expects this (§9), but `VERSIONING_AND_EXPORT.md:47` says "Exports are never
blocked". A PM who wants to send the PRD to an engineer is locked out by a
build-facing rule. *Fix:* block only build-facing bundles (handoff, tasks);
keep PRD/JSON downloads live with a warning stamp; reconcile the doc.

**UX-36 · Major · No key check on the outputs trigger.** `handleGenerateAssets`
→ `proceedToAssetGeneration` → `startAll` never calls `hasGeminiKey()`
(`ProjectWorkspace.tsx` has no reference; only the background early run checks,
`artifactJobController.ts:807`). Keys are per device and projects sync across
devices, so a user on a second device gets six red rows reading "API key not
configured. Open Settings to add your Gemini API key." plus a failure checkpoint.
*Fix:* gate the pill, the rail step and the Sync modal on `hasGeminiKey()` with
a Settings link (cross-cutting rule 4).

**UX-37 · Major · Four vocabularies for "something changed".** The header shows
`FreshnessBadge` ("Needs update" / "Update recommended") *or* an alignment badge
("Update required" / "Review recommended"), plus "Needs validation review" and
"Impacted" in the graph (`artifactFreshness.ts:234-243`; `exportManifest.ts:62-66`;
`DependencyGraphView.tsx:88-94`); the Sync modal still says "possibly outdated"
(`UpdateAssetsPlanModal.tsx:289-290`), the retired term. Sidebar dots reflect
alignment only, so freshness-only staleness has no sidebar signal
(`ArtifactWorkspace.tsx:2311-2313`). *Fix:* one user-facing stale vocabulary in
`planningLanguage.ts` fed by both engines.

**UX-38 · Minor · A reload before the first output finishes leaves an empty
room.** `resumeIfNeeded` only wakes when some slot already completed
(`artifactJobController.ts:1058-1071`); job state is transient, so every slot
shows "Not generated yet" with no button (`ArtifactWorkspace.tsx:1961-1962`),
and the header pill is hidden inside the workspace stage
(`ProjectWorkspace.tsx:1507-1511`). The only restart is the rail's *Generate*
step, which reads as navigation (`:1896-1903`). *Fix:* a "Generate outputs"
button in the idle empty state.

**UX-39 · Minor · "Retry" silently regenerates upstreams; rate limits have no
backoff.** `retrySlot` routes through the dependency closure
(`artifactJobController.ts:978-995`) behind a button that just says "Retry"
(`ArtifactWorkspace.tsx:1788-1794`); 429s surface as "Too many requests…" on up
to four slots at once (`errors.ts:97`). *Fix:* a confirm naming the closure;
auto-backoff on 429.

**UX-40 · Minor · Validation speaks engineer.** "Needs review — this artifact
has a blocking validation issue" then raw findings such as "Artifact
references none of the PRD features — no traceability to the PRD." and "Screen
inventory could not be parsed as generated structured output."
(`ArtifactValidationBanner.tsx:171-177`; `artifactBlockingValidation.ts:37,80,127`);
the banner never says dependents will not build from it. The accept-with-
rationale flow itself is good.

**UX-41 · Minor · "Not now" on the pre-build card silently cancels generation
and never re-offers** (`ProjectWorkspace.tsx:2286`, `preBuildCheckOffered`), so
the next click skips straight to generation.

---

## 4. Cross-cutting findings

### 4.1 UX-42 · Major · The journey rail is a command bar wearing a navigation costume

`handleJourneyStepChange` (`ProjectWorkspace.tsx:1878-1910`): *Define* and
*Refine* open the same PRD surface; **Finalize persists a readiness review**
(`:1892-1894`); **Generate launches the full paid artifact run** when no
outputs exist (`:1896-1903`); *Review* opens outputs; **Build opens the Export
modal**. A user "just looking" at the steps triggers side effects and spend. The
header simultaneously offers the same acts under different names: **Explore /
Build / Review outputs** (`:1957-1979`), **Export** (`:1980-1987`), **Review
readiness / Reopen plan** (`:1988-1997`). Disabled steps render
`cursor-not-allowed` with the caption **Unavailable** and no reason
(`JourneyRail.tsx:39-45,62`); the sr-only description is the generic blurb.
*Review* is enabled only when *every* visible core artifact and the mockup
exist (`journeyPresentation.ts:107`; `assetsReady`), so one errored slot leaves
"Review · Unavailable" while five outputs are done. *Fix:* rail = navigation
only; put Finalize/Generate/Export actions in their stage surfaces; `aria-
disabled` + a reason; enable Review when any output exists.

### 4.2 UX-43 · Major · Vocabulary drift

| Concept | Labels in use | Where |
|---|---|---|
| The PRD/editing stage | **Define**, **Refine** (rail) · **Plan** ("Back to Plan", "Plan stage") · persisted key `prd` · README "Idea"/"Spec" | `journeyPresentation.ts:47-57`; `ProjectWorkspace.tsx:1803,2184`; README §🎬 |
| Adversarial review | **Challenge** (drawer badge, "Challenge this plan", tour title, docs "Challenge stage") · stage key `review` · **critique** ("Run an optional specialist critique") · tabs **Findings / History** | `ProjectDrawer.tsx:32`; `PlanningStateBar.tsx:93`; `tourTypes.ts:39`; `ReviewWorkspace.tsx:318,979-980` |
| Committing the plan | **Finalize** (rail, "Finalize plan") · **Review readiness** (header, tool card) · **Commit plan / Plan committed** (tour, chip, drawer) · "Legacy commitment" · **Proceeding with accepted risk** · `isFinal` | `journeyPresentation.ts:58`; `ReadinessCheckpoint.tsx:461`; `ProjectWorkspace.tsx:1912-1926,1995`; `tour/screens/ScreenAssets.tsx:80` |
| Downstream outputs | **Generate / Review** (rail) · **Outputs** ("Explore / Build / Review outputs", "Exploratory outputs") · **Assets** ("Open Assets", tour, "Generate assets from an incomplete PRD?") · **Artifacts** (mobile drawer, nav landmark) · **build foundation** · **Explore / Build** (docs, drawer "Exploring outputs", README "Explore workspace") · keys `workspace` / `mockups` / `artifacts` | `ProjectWorkspace.tsx:1976,2172,2332`; `FinalizationSuccessModal.tsx:63`; `ArtifactWorkspace.tsx:2248,2258`; README:88 |
| Decisions | **Decision Center** (slide-over, overflow, tool card) · **Decisions** (`?tab=decisions`, README) · tour shows it as a *tab* inside a "Challenge" strip | `DecisionCenterSlideOver.tsx:106`; `tourData.ts:144`; `tour/screens/ScreenDecisions.tsx:86-99` |
| History | **Version History** (modal) · **Project History** (panel) · **History Mode** (right-sidebar tab, "Timeline") · **History** (critique tab; drawer badge; legacy stage) · "View full history" | `ProjectWorkspace.tsx:2048,2068,2215,2714`; `ProgressTimeline.tsx:193` |
| Readiness | "Product-reasoning checks" vs "Implementation packet" / "Packet checks" · "Ready to challenge" / "Ready to build" · **Final Review** | `PlanningStateBar.tsx:186,206,248`; `planningLanguage.ts:61-65`; `FinalReviewCard.tsx:191` |
| Settings | **Project Settings** (modal title, overflow) vs **Settings** (home) — contents are global | `SettingsModal.tsx:182`; `ProjectWorkspace.tsx:2025` |
| The document | "PRD", "plan", "working plan", "draft", "document", "spine" | throughout |

The tour, README, `CLAUDE.md` and the architecture docs each narrate a
different progression, and `WORKSPACE_AND_ARTIFACTS.md:104-107` says the pill
flips on `planningReadiness.isReadyToBuild` while the code flips on
`displaysCurrentCommitment` (`ProjectWorkspace.tsx:1976`). *Fix:* one
vocabulary sheet — Define / Refine / Finalize / Generate / Review / Build,
"outputs", "Decision Center", "critique", "plan" for the document — applied to
UI, tour, README and docs, and snapshot-tested like the prompts.

### 4.3 Jargon that reaches the user

A glossary of internal vocabulary quoted from user-facing copy, with a plain
replacement. (Terms are explained here because the audience for this audit
includes non-engineers.)

| Term as shown | Where | What it means | Say instead |
|---|---|---|---|
| "spine", "Commit to New Spine", "Apply to Spine", "Highlight text in the spine" | `ConsolidationModal.tsx:234,240`; `BranchCanvas.tsx:119`; `BranchList.tsx:55` | the current version of the PRD | "the plan" / "Apply to plan" |
| "Branch", "Enter to branch", "Active Branches", "Delete Branch" | `SelectionActionDialog.tsx:236,243`; `ProjectWorkspace.tsx:2708` | a side conversation about one passage | "suggestion" / "thread" |
| "Anchor:" | `SelectionActionDialog.tsx:189`; `BranchList.tsx:119` | the selected text | "Selected text:" |
| "Consolidate now", "Select Consolidation Scope", "Local Patch", "Doc-Wide Rewrite", "Generate Local Patch", "Patch Analysis" | `BranchList.tsx:179`; `ConsolidationModal.tsx:113,151-213` | merge the suggestion into the plan | "Apply to plan" / "Preview change" |
| "staged / Unstage" | `BranchList.tsx:132,204` | held to apply together later | "held" / "apply later" |
| "Edits are saved as an overlay on this artifact version" | `ScreenDetailView.tsx:499` | your edits sit on top of the generated text and survive regeneration | "Your edits are kept separately and survive regeneration" |
| "Implementation packet", "Packet checks", "Approve build packet", "Start first slice" | `PlanningStateBar.tsx:186,206`; `buildPacketApproval.ts:411,432` | the bundle of outputs a developer needs; the first shippable feature | "build kit" / "first milestone" |
| "Cross-cutting obligations discharged", "Packet inputs current", "First-slice API contracts complete", "Product reasoning committed" | `buildPacketReadiness.ts:126-135` | security/measurement work planned; nothing stale; first milestone's endpoints fully specified; plan finalized | plain labels + one-line meaning |
| "Downstream alignment", "Decisions propagated into the plan", "Decision-to-plan propagation changed." | `PlanningStateBar.tsx:142`; `readinessReview.ts:627`; `readinessCheckpointView.ts:42` | whether outputs still match the plan | "Outputs match the plan" |
| "Accepted without validation", "Worth validating", "not independently checked", "Replace belief with evidence" | `planningLanguage.ts:87-88,149`; `DecisionCenter.tsx:745` | you said yes but nothing has proven it | "Your call — not yet tested" |
| "Technical provenance: gemini", "Supported inference · Checked automatically", "claim · Assumptions · definite impact relevance" | `DecisionCenter.tsx:863-887` | where a suggestion came from | hide behind "Details" |
| "Coverage manifest captured during generation — a structured self-report" | `MockupVariantsPanel.tsx:765` | the model's own checklist of what it drew | "What the mockup says it covers" |
| "Implementation preflight", "Implementation handoff export", "Impl-ready", "read-only trace references", "handoff trace" | `ScreenPreflightPanel.tsx:49`; `ScreensHandoffExportPanel.tsx:105,152,214` | developer readiness of a screen | move to the Implementation Plan |
| "Needs challenge triage", "grounded findings", "source-grounded coverage" | `ReviewWorkspace.tsx:494,688,887` | findings still to sort; findings that quote the plan | "Findings to sort" / "quotes the plan" |
| "Legacy commitment · readiness not recorded", "Readiness unavailable" | `ProjectWorkspace.tsx:1918-1922` | finalized under an older rule | "Finalized (older version)" |
| "generation slot frees up", "Orchestration Metrics", "Abandon Session" | `ArtifactWorkspace.tsx:1480`; `ProjectWorkspace.tsx:2075,2090` | queued; a developer dashboard; "back to projects" | "Queued" / hide / "Back to projects" |
| "kept the merged PRD (guard: feature-ids-changed)" | `prdConsistencyReview.ts:532` | the automatic consistency check declined a rewrite | "Consistency check: kept your version" |

### 4.4 UX-51 · Major · Docs and README have drifted from the product

`CLAUDE.md`'s README rule says screenshots and feature claims must match the
live UI. They do not:

- **All six `public/screenshots/*.png` show the retired four-tab rail** (Plan ·
  Challenge · Explore · History) and the old "Decision Center 6 · Review
  findings · Review history" tab strip. The live product renders the six-step
  rail (`JourneyRail.tsx`; `journeyPresentation.ts:46-77`) and a slide-over.
- README:9 "annotated visual feedback" and `CLAUDE.md` pipeline flow
  ("MarkupImageView (MarkupImageSpec → SVG via MarkupImageRenderer)"): **no
  such code exists** (`Glob src/**/*Markup*` → none; no `annotat*` in `src/`).
  `docs/architecture.md:91-93` and `docs/artifact-flow.md:54-57,182-196` cite
  the same phantom.
- README:40 / §6 "approve the flows and pick which screens to render before
  Synapse generates the images" and `WORKSPACE_AND_ARTIFACTS.md:129-162`: the
  gate is unreachable (UX-25).
- README:49 "swipe navigation" and README:136 "reduced-motion support": both
  exist only in the tour (`swipeMath.ts`, `useTourState.ts`;
  `usePrefersReducedMotion` is consumed only by `TourPage.tsx:42`; no
  `motion-reduce:` or `prefers-reduced-motion` in the product).
- README:98 "Marking the plan ready fans the same source of truth out…":
  generation is a separate explicit action (`FinalizationSuccessModal.tsx:54-63`).
- `VERSIONING_AND_EXPORT.md:47` "Exports are never blocked" vs
  `ExportModal.tsx:403-407` (UX-35).
- `WORKSPACE_AND_ARTIFACTS.md:104-107` pill condition vs
  `ProjectWorkspace.tsx:1976`; `:539` claims a Linear task target that does not
  exist (`taskExport/index.ts:15-18`).
- Tour vs product: Refine shows 5 actions, product has 6 (`tourData.ts:63` vs
  `prdEditActions.ts`); tour section names ("Product Vision, Target Users, Core
  Problems, Key Features") do not match `SECTION_TITLES`
  (`prdSectionPrompts.ts:245-254`); tour "Commit plan → Plan committed" vs
  product "Review readiness → Finalize plan"; tour's "Project health · Good ·
  All artifacts are up to date … aligned automatically"
  (`tour/screens/ScreenConnections.tsx:89-93,162,185`) describes automation the
  product deliberately does not do (rule 13); tour beat 6 is "Build"
  (`tourTypes.ts:41`) while CLAUDE.md/README call it "Assets".
- `planningReadiness.ts:28-37` comment still says critique is gated; `ProjectWorkspace.tsx:2184` says "…from the Plan stage first".

### 4.5 UX-52 · Dead, mock, or unreachable UI

| Surface | State | Evidence |
|---|---|---|
| `BranchCanvas` ("Exploration Canvas") | **Live and mock** — reachable, applies placeholder text | UX-17 |
| `MockupApprovalGate`, `MockupViewer`, `MockupPromptDialog`, "Regenerate Mockup", design-drift banner | **Unreachable** | UX-25 |
| `prd/DecisionLogSection.tsx`, `ReviewConfirmSection.tsx`, `DeferredRisksSection.tsx` | Exported, test-only consumers | UX-11 |
| `FeedbackItemsList` | Mounted above the PRD (`ProjectWorkspace.tsx:2452`) but nothing creates feedback items (creation path retired in the workflow audit's Tier 1.6); always renders `null` | `FeedbackItemsList.tsx:24-29` |
| `ReviewWorkspace.tsx:172-210` | ~20 deprecated decision props that render nothing; `initialTab: 'decisions'` coerced (`ReviewWorkspaceContainer.tsx:89`) | trace |
| `generationStages.ts:40-56` `BUNDLE_GENERATION_STAGES` ("Finalizing prompt pack…"), `STALE_REFRESH_STAGES`; `PRD_GENERATION_STAGES` | Unused exports (the last already listed in `tasks/TODO.md`) | trace |
| `exportHandoff.ts:54-58` "Exploratory handoff" stamp | Dead branch — `checkpointMarkdown` is always passed (`ExportModal.tsx:285-296`); the agent instead sees "**Plan status:** Working plan" with no gloss | trace |
| `ImplementationPlanRenderer.tsx:19-20` | Still lists a Traceability tab | trace |
| Slot meta "Mockups · Interactive UI mockups" (`ArtifactWorkspace.tsx:250`) | Never rendered | UX-25 |
| High-quality image path (`MockupScreenImage.tsx:153-159`) | Never called | UX-31 |

### 4.6 Resilience and error UX

- **Good:** sync status copy is calm and honest ("Offline — changes are saved on
  this device…", "Couldn't sync… Your projects are safe on this device",
  `ProjectSyncStatus.tsx:32-61`); the cross-device conflict banner never
  resolves silently and offers a recovery download (`:217-296`); interrupted
  generation settles into "Try Again"; per-section retry survives reload;
  storage-full is a sticky toast with auto-recovery (`storage.ts:96-108`); the
  error taxonomy (`errors.ts:77-111`) is specific and actionable.
- **UX-47 · Major · Cloud status is invisible in the workspace on mobile.**
  `ProjectCloudStatus` is `hidden md:inline-flex` (`ProjectWorkspace.tsx:1948-1952`);
  only the conflict banner shows at all widths; the drawer's conflict copy says
  "resolve it below" but resolution lives only in the workspace
  (`ProjectSyncStatus.tsx:69-70`). *Fix:* a compact cloud icon in the mobile
  header; drawer copy "open the project to resolve".
- **Minor:** in-workspace key errors say "Open Settings…" with no link
  (`errors.ts:78-81`); "Invalid Project" / "Project Not Found" flash as raw text
  before the toast and bounce (`ProjectWorkspace.tsx:734,1328,664-676`); a
  cross-device deep link may bounce to "not found" before the first sync pull
  **(assumption)**.

### 4.7 UX-46 · Major · Developer surfaces exposed to every user

"Cloud Snapshots" sits in every user's overflow (`ProjectWorkspace.tsx:2027-2033`)
and opens on "Snapshots are an owner-only feature. Paste the value of
SYNAPSE_OWNER_TOKEN from your Vercel project env." (`SnapshotsPanel.tsx:311`).
"Orchestration Metrics" (overflow `:2070-2076`; Settings) reads "dependency-aware
DAG executor… tokens… estimated cost" (`MetricsPage.tsx:53-58`). Settings
hard-codes "System Status: All systems operational" (`SettingsModal.tsx:474-475`).
The login error says "Check server logs for details." (`LoginPage.tsx:41`). The
progress timeline shows model ids and "Auto-save on" (`ProgressTimeline.tsx:197`).
The LLM Trace Viewer *is* correctly owner-gated (`App.tsx:131-145`). *Fix:* gate
Snapshots on `getOwnerToken()` like the trace viewer; move Metrics under an
"Advanced" disclosure; remove the fake status row.

### 4.8 Mobile and accessibility

- **UX-44 · Major · Returning users do not see their projects** (§2.4). *Fix:*
  a recent-projects list on Home sorted by last activity with the commitment
  badge and a "continue at <step>" hint.
- **UX-48 · Minor · Mixed palette, no reduced motion.** Chrome is dark, content
  light, modals alternate (Settings dark, Confirm/Version/History white), a light
  "Return to…" strip sits inside dark chrome (`ProjectWorkspace.tsx:2306`); no
  `dark:` variants and no `darkMode` config; `animate-spin/pulse/ping` with no
  `motion-reduce:` anywhere in the product.
- **UX-49 · Minor · Accessibility gaps.** Overflow menu has `role="menu"` but
  plain buttons — no `menuitem`, arrow keys or Esc
  (`ProjectWorkspace.tsx:649-662,2014-2019`); `ConfirmDialog`,
  `VersionHistoryPanel`, `VersionCompareView`, `RevertConfirmModal` have no
  focus trap or Esc (`ConfirmDialog.tsx:56-73`); toasts have no `aria-live`
  region (`ToastContainer.tsx:19-26`), so "Storage full…" is never announced;
  icon-only buttons without `aria-label` (drawer close `ProjectDrawer.tsx:87-92`,
  Settings close `SettingsModal.tsx:186-191`, Home header buttons rely on
  `title`); artifact status dots are color-only (`ArtifactWorkspace.tsx:2308-2316`);
  drawer delete is `opacity-0 group-hover` (invisible on touch,
  `ProjectDrawer.tsx:171`). Good: `UnderlineTabs` roving tabindex; Decision
  Center, History panel, Export modal and the mobile artifact drawer trap focus
  and handle Esc; the rail uses `aria-current="step"`.
- **UX-50 · Minor · Inconsistent confirms and a scary label.** Native
  `window.confirm` in five places vs `ConfirmDialog` elsewhere
  (`ProjectDrawer.tsx:166`; `BranchList.tsx:145`; `StructuredPRDView.tsx:845`;
  `ProjectSyncStatus.tsx:237`; `SnapshotsPanel.tsx`); "Abandon Session" only
  navigates home (`ProjectWorkspace.tsx:2085-2091,1330-1334`).

---

## 5. What works well — keep these

1. **The preflight interview.** One question per card with its "why", Back/Skip,
   a summary that separates *Assumptions* from *Open questions*, and answers
   that reach every section prompt *and* durable planning records with
   provenance. This is the product's clearest expression of promise 2.
2. **Honest progress.** No fabricated timers; `queued` vs `pending`; Est./
   Elapsed; "Retried ×N"; per-section retry with a doubled output budget; the
   incomplete-PRD banner and its "Generate anyway" gate survive reload.
3. **The Sharpen flow's language** — "Synapse assumed … Does this match your
   reality? Sounds right / Not quite — correct it / Not sure yet" — and the
   calm-first "Your draft is ready" card (`planningOverviewPresentation.ts:4-12`
   documents why).
4. **Ordered planning tools with "when" cues** (*Start here / When it reads
   coherently / Before you build*) — a pattern worth generalising to every
   stage.
5. **Recommendation preselected → one-click Approve**, and batch *Accept N
   recommendations* that reports skipped/failed per record.
6. **Append-only, user-only authority everywhere**; stale previews fail closed
   with clear toasts; every jump out of the plan carries a "Back to Plan"
   return strip.
7. **Sync outputs**: one modal, per-row *Regenerate / Mark up to date / Decide
   later*, a "What changed" headline, manual-edit warnings, and a run that
   really is dependency-ordered with the mockup last.
8. **The Data Model's per-endpoint contract cards** (auth, request/response,
   errors, pagination, idempotency, tests) with honest Complete/Partial/Stub
   chips — a developer can start from them.
9. **Roadmap milestones and prompt packs** with Outcome, linked artifacts,
   validation commands and "Done when"; "Start here" ordering.
10. **Final Review's single primary action** with consequence + remedy + a
    navigable target per blocker; warnings labelled "Recorded, not blocking";
    task progress honestly "self-reported".
11. **Screens list and Screen Detail hierarchy** (Purpose → primary mockup →
    collapsed review notes → criteria), the single Confirm/Edit-again toggle,
    and in-place risk resolution with a pre-filled suggestion.
12. **Resilience copy** for offline, sync failure, conflicts, storage-full and
    interrupted runs — none of it reads as data loss.

---

## 6. Recommendations, prioritized

Each item names the promise it serves and a rough effort (S ≤ 1 day, M ≤ 1
week, L ≤ 3 weeks). Presentation-only work preserves every write barrier and
authority rule.

### Tier 0 — stop the bleeding (days)

| # | Action | Promise | Effort | Closes |
|---|---|---|---|---|
| 0.1 | Remove the "Dive Into Canvas" entry point (or dev-flag it) | 3 | S | UX-17 |
| 0.2 | Mount `MockupApprovalGate` at the top of the Screens list when the current mockup version has no approval and no images; give it a "Render the N approved screens" batch; delete or re-home `MockupViewer` | 4 | M | UX-25, UX-26 |
| 0.3 | Distinguish *could not verify* from *disallowed* (own copy, Retry); widen the missing-key pattern to `/gemini api key/i`; pin the real message in the classifier test | 1 | S | UX-03 |
| 0.4 | Preflight error state with Retry / Skip-and-generate | 1 | S | UX-05 |
| 0.5 | `hasGeminiKey()` gate on the outputs pill, the rail step and Sync | 5 | S | UX-36 |
| 0.6 | Fix the drifted docs and README (screenshots re-captured on the six-step rail; remove "annotated visual feedback", swipe and reduced-motion claims or implement them; reconcile the export, pill and gate paragraphs; drop the `MarkupImage*` references from `CLAUDE.md`) | all | S | UX-51 |

### Tier 1 — make the uncertainty loop visible and cheap (1–3 weeks)

| # | Action | Promise | Effort | Closes |
|---|---|---|---|---|
| 1.1 | **"Open questions & risks" section in the PRD** (assumptions with status, risks with mitigation, preflight unknowns), each row linking to its record | 2 | M | UX-11 |
| 1.2 | **A verdict rewrites the affected prose**: bounded model rewrite of `affectedPrdSections` as the impact preview, before/after diff shown in the PRD, decision log rendered in the structured view | 2, 3 | L | UX-18 |
| 1.3 | One count (`needsVerdict`) on every surface; Defer terminal for non-blocking records; no review-only proposals for a plain confirmation | 2 | M | UX-12, UX-13 |
| 1.4 | Carry `consequence` into promoted records; materiality + owner/response on risks | 2 | S | UX-14 |
| 1.5 | Discoverable refine: inline hint, hover affordance, visible pencils; "Replace with my text" with no model call; anchor validation at selection time; "Apply this wording" from the reply | 3 | M | UX-19, UX-20 |
| 1.6 | Mobile branch thread as a bottom sheet; require an instruction on mobile chips | 3 | M | UX-21 |
| 1.7 | Explain feature Confirm; "Confirm all in MVP" | 3 | S | UX-22 |
| 1.8 | One commitment predicate and vocabulary for Finalize; honest headline before the click | 5 | S | UX-24 |
| 1.9 | Demote the outputs pill until *ready to challenge*; the planning bar owns the single filled action | 3 | S | UX-23 |
| 1.10 | Stream the PRD immediately; design direction as a dismissible side card | 1 | S | UX-06 |
| 1.11 | Inline key notice on Home + auto-continue; "Revise" opens an editable prompt | 1 | S | UX-02, UX-04 |

### Tier 2 — mockups that talk back (2–4 weeks)

| # | Action | Promise | Effort | Closes |
|---|---|---|---|---|
| 2.1 | Per-screen **"Raise a change"** (free text, screen locator, image key) through `flagPlanningConcern` | 4 | M | UX-27 |
| 2.2 | Numbered-callout legend beside the image from `coreUIElements`; PRD features open by default | 4 | M | UX-27, UX-30 |
| 2.3 | Carry images forward on unchanged contract hash; state the cost in the regenerate confirm | 4 | M | UX-28 |
| 2.4 | Feed risk resolutions / dismissals into readiness and handoff | 4 | S | UX-29 |
| 2.5 | Either ship platform/fidelity/scope controls and the high-quality path, or remove the promises | 4 | S–M | UX-31 |

### Tier 3 — execution handoff and orientation (ongoing)

| # | Action | Promise | Effort | Closes |
|---|---|---|---|---|
| 3.1 | Approved-state primary = handoff context + first prompt in one action | 5 | S | UX-34 |
| 3.2 | Block only build-facing exports; PRD/JSON always downloadable with a warning stamp | 5 | S | UX-35 |
| 3.3 | Plain-language packet criteria; `reasoning committed` as a warning when the projection is ready; targeted section fixes instead of whole-artifact regenerate | 5 | M | UX-33 |
| 3.4 | One stale vocabulary from `planningLanguage.ts`; sidebar dots reflect it | 5 | S | UX-37 |
| 3.5 | Rail = navigation only; actions live in their surfaces; disabled steps say why; Review enabled when any output exists | all | M | UX-42, UX-45 |
| 3.6 | Vocabulary sheet applied to UI, tour, README, docs; snapshot-tested | all | M | UX-43 |
| 3.7 | Recent projects on Home with "continue at <step>" | all | S | UX-44 |
| 3.8 | Gate Snapshots on the owner token; Metrics under Advanced; remove the fake status row | all | S | UX-46 |
| 3.9 | Mobile cloud status; a11y pass (menu semantics, focus traps, `aria-live` toasts, labels, non-color status); `motion-reduce:`; one confirm primitive | all | M | UX-47–UX-50 |
| 3.10 | Retire the dead surfaces in §4.5 | — | S | UX-52 |

---

## 7. How to validate

**Manual (add to `docs/QA_CHECKLIST.md`):**
- §1: start a project with the network throttled to offline for the first
  call — the screen must read as "could not reach", never as "disallowed".
- §3: on a 390 px viewport, create a branch and reach the AI reply and
  *Consolidate* without rotating the device.
- §3: from a branch card, "Dive Into Canvas" must not exist (or must produce
  real drafts).
- §4: answer one assumption with a correction; the PRD text must visibly
  change, and every open-item count on the page must agree.
- §6: with no images rendered, the Screens view must offer *one* action that
  renders the approved screens.
- §9: with a blocking decision open, the PRD must still be downloadable.

**Scoped visual pass.** This audit did not run `npm run e2e` (the repo rule
requires the owner to choose viewport, scope and critique first; a live run
also needs `SYNAPSE_E2E_GEMINI_KEY`). The most useful configuration for these
findings is `--viewport=both --interactions` on a fresh idea, or a
`--state=<prior run>` replay narrowed to `--views=prd,challenge,screens`
to check UX-11, UX-18, UX-21 and UX-25 at zero LLM cost.

---

## Appendix A — Confirmed vs. inferred

**Re-verified by the auditor at the cited lines:** UX-01–06, UX-11 (the
structured-view comment and unmounted components), UX-12 (readiness predicate
and Decision Center count), UX-17, UX-18 (patch shape), UX-19–25, UX-27,
UX-35, UX-36, UX-42–UX-46, UX-51, the mockup gate commit timeline, the absence
of annotation / `Markup*` code, the absence of reduced-motion and dark-mode
handling in the product, and the rail/header wiring.

**Reported by a trace and spot-checked but not exhaustively re-traced:**
UX-07–10, UX-13–16, UX-26, UX-29–34, UX-37–41, UX-47–50, §4.5 rows marked
"trace".

**Assumptions:** the ~70–100 s fast-path wall clock (from `estimatedSeconds`,
not measured); anchor-mismatch frequency for selections crossing rendered
labels; that regeneration discards every image (inferred from the version-id
key rule); the critique's 1–3 minute duration; that a cross-device deep link can
bounce before the first sync pull; that the early `ensureDesignSystemForSpine`
run can make `hasAnyCompletedSlotForSpine` true and auto-start a bundle without
the pre-build card.

## Appendix B — Status of prior-audit remediation

| Prior finding | Recorded as | What this audit found |
|---|---|---|
| Workflow audit Tier 1.2 "Flag to plan on screens review notes" | Implemented | Exists on **system-generated** notes only; no free-form path from a screen; the artifact-level free-text control is not rendered in Screens (UX-27). |
| Workflow audit Tier 1.4 "Assumption batch card" | Implemented | Shipped; but *Accept defaults* is primary and visibly does nothing (UX-13). |
| Workflow audit Tier 2.8 "Sync outputs" | Implemented | Shipped and good (§5.7); the retired "possibly outdated" term survives in its copy (UX-37). |
| Workflow audit Tier 3.13 "Six-step rail" | Implemented | Shipped; the header keeps the previous vocabulary and the rail performs actions (UX-42, UX-43); README screenshots still show the old rail (UX-51). |
| Workflow audit Tier 3.14 "Decision Center slide-over" | Implemented | Shipped; return context works; the tour still shows a tab (UX-51). |
| Workflow audit §2.3 "screens→plan loop severed" | Closed by Tier 1.2 | **Partially reopened**: the loop exists but discards images on the way back (UX-28) and cannot start from the user's own observation (UX-27). |
| Build-readiness audit W7 "one CTA" | Resolved | Holds (§5.10); the *ceremony* to reach green is the new problem (UX-33). |
| Build-readiness audit W4 "reviewable component inventory" | Resolved | Holds; presented as a developer artifact (§3.4 polish). |
| Screens audit C1 (contradicting readiness verdicts) | Open | Three readiness vocabularies still coexist on one screen (UX-32). |
| Screens audit H1/H3 (deficit framing; sync jargon ×3) | Open | Copy addressed ("Available on demand"); metadata section still stacks five models. |
| Change-management CM-1/CM-5 (bounded impact detection) | Deferred | Unchanged; visible to the user as UX-18's "review this section yourself" proposals. |
| Mockup flow-approval gate (WORKSPACE_AND_ARTIFACTS.md, 2026-07-23) | Shipped | **Never reachable** (UX-25). |
