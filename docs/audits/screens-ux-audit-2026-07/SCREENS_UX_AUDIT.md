# Screens Artifact — Screenshot-Based UX Audit (July 2026)

This audit evaluates the **rendered product**, not the source code. Every finding is
anchored to a full-page screenshot captured from the **live production deployment**
(`https://synapse-prd.vercel.app`) using the pinned public demo project
("AI Learning Graphics", demo snapshot `ade138f4…`, pinned 2026-07-09 — i.e. it
includes the recent Screens rework). Screenshots live alongside this document; the
capture script mirrored `scripts/capture-demo-screenshots.mjs` (fetch-relay,
Chromium, `reducedMotion: reduce`) with one addition: because the workspace scrolls
inside an inner container, the viewport was expanded until nothing scrolled before
each capture, so every image is a true full-page snapshot.

**Viewports:** desktop 1440×920 @1x · mobile 390×844 @2x (iPhone-class UA, touch).

**Project state:** finalized PRD (Version 1, FINAL), 6 screens across 4 flows, every
screen user-**Accepted**, every screen has a generated primary mockup, no screen has
extra state/viewport variants generated, all mockups are "legacy" (generated before
source-signature capture, so their PRD-sync state is *unknown*).

**States that could not be reproduced on the read-only demo** (noted, not skipped
silently):

- *A screen with no primary mockup* — all 6 demo screens have one. The closest
  observable analogue is the non-generated variant cards on the Mockups tab
  (`30-detail-mockups-*`), which are assessed instead.
- *A hard out-of-sync (stale) state* — requires editing the PRD after generation;
  the demo is read-only. The **"PRD sync unknown"** legacy state is fully
  observable and is assessed in depth; the stale path shares the same UI surface
  (`MockupVariantsPanel` freshness strip).
- *A user-Draft / needs-review screen* — all demo screens are Accepted. The
  review-pending UI is still observable via Review Notes items, system-readiness
  labels, and the amber rollups.

---

## 1. Screenshot index

All routes are under the demo project `/p/00000000-0000-4000-8000-000000000d01`.
Each `…-desktop.png` / `…-mobile.png` is one full-page capture.

| ID | File(s) | Route (+params) | State / interaction |
| -- | ------- | --------------- | ------------------- |
| S-10 | `10-screens-list-{desktop,mobile}.png` | `/p/<demo>` | Screens list, default: grouped by flow, details collapsed. Assets stage → Screens row. |
| S-11 | `11-screens-list-card-details-{desktop,mobile}.png` | `/p/<demo>` | Screens list with the first two cards' "Show details" expanded. |
| S-12 | `12-screens-list-readiness-metadata-{desktop,mobile}.png` | `/p/<demo>` | "Project readiness & metadata" section expanded (coverage, review readiness, downstream, handoff, preflight, export). |
| S-20 | `20-user-flows-{desktop,mobile}.png` | `/p/<demo>` | User Flows artifact, default state (Flow 1 of 4 selected in the rail). |
| S-30 | `30-detail-overview-{desktop,mobile}.png` | `?screen=scr-infographic-library` | Screen Detail › Overview — screen **with** generated primary mockup, confirmed, 4 review-note items. |
| S-30f | `30-detail-flow-{desktop,mobile}.png` | `…&screenTab=flow` | Screen Detail › Flow — screen appearing in 4 of 7 steps of Flow 1. |
| S-30m | `30-detail-mockups-{desktop,mobile}.png` | `…&screenTab=mockups` | Screen Detail › Mockups — 1 generated Default variant + 2 non-generated state variants; legacy "PRD sync unknown". |
| S-31 | `31-detail-overview-expanded-{desktop,mobile}.png` | `?screen=scr-infographic-library` | Same as S-30 with **Review notes expanded** (2 info notes + 2 risks with resolution boxes). |
| S-34 | `34-detail-overview-{desktop,mobile}.png` | `?screen=scr-ingestion-workspace` | Screen Detail › Overview — second representative screen (single flow ref). |
| S-34f | `34-detail-flow-{desktop,mobile}.png` | `…&screenTab=flow` | Screen Detail › Flow — screen appearing in 1 step. |
| S-34m | `34-detail-mockups-{desktop,mobile}.png` | `…&screenTab=mockups` | Screen Detail › Mockups — same shape as S-30m. |

`manifest.json` (same folder) carries the machine-written route/viewport/height
metadata for every capture.

---

## 2. Executive assessment

The core of the rework landed. The Screens **list** is genuinely flow-first and calm:
cards lead with name, purpose, and a "Next →" strip; one muted readiness badge and
one mockup line are the only default status signals; everything else sits behind
"Show details" (S-10). The Screen Detail **Overview** has a correct hierarchy —
Purpose → large primary mockup → collapsed Review Notes → acceptance checklist →
collapsed PRD features / screen details — and review is one comprehensible action
("Confirm screen" ⇄ "Screen confirmed · Edit again", S-30). Risks come with an
answerable "How should this be handled?" box (S-31). Mobile has **no horizontal
overflow anywhere captured**, and tabs, cards, and drawers are comfortably usable
(S-10/30/31 mobile).

The experience falls apart exactly where the old system-status vocabulary survived:

- **Cohesive?** Mostly, until the disclosures open. The card "Show details" and the
  "Project readiness & metadata" section re-import the entire pre-rework dashboard —
  REVIEW / TRACEABILITY / HANDOFF / MOCKUPS / STATES / RISKS rows per card (S-11),
  and *five* stacked readiness models per project (S-12).
- **Simplified?** The primary surfaces yes; the secondary surfaces no. Four-plus
  distinct readiness verdicts coexist and **visibly contradict each other on one
  screen**: "0 of 6 screens pass the derived readiness checks / READY FOR
  DEVELOPMENT 0%" sits directly above "6 accepted … Ready for implementation
  planning" (green) and "Implementation handoff needs review" (amber) — all three
  claims about the same six accepted screens (S-12 desktop, segs 1–2).
- **Visually focused?** The list and Overview, yes. The Flow tab is not: it stacks
  an "appears in" digest, the full journey, and full step-by-step cards for the
  *entire* flow — 4,305 px tall for one screen, three renderings of the same steps
  (S-30f). The Mockups tab reads as a coverage report before it reads as a gallery
  (S-30m).
- **Mobile-ready?** Structurally yes (no overflow, good tap targets). Comfort
  issues remain: ~430 px of app chrome + demo banner before content, per-card
  detail stacks are very tall, and a few headers/labels wrap awkwardly (S-30
  mobile, S-11 mobile, S-30m mobile).
- **Trustworthy?** This is the weakest axis. A fully accepted, fully mocked-up
  demo project — Synapse's best-case showcase — displays: an amber "Needs review"
  HANDOFF row on every card (S-11), "1 of 3 recommended variants · 2 missing"
  with amber **Missing** pills (S-30m), "one or more mockups may be out of date or
  unverified" four times (S-12 seg2–3), and a 0% "Ready for development" bar
  (S-12 seg1). Nothing is actually wrong with the project. The UI makes normal
  states look like failures, and its own summaries disagree with each other.

**Bottom line:** the rework built the right primary surfaces; the remaining work is
subtraction — reconciling the readiness models into one voice, reframing optional
variants as optional, and moving implementation-handoff signals out of Screens —
plus two genuine rendering defects (raw markdown in the Flow tab, duplicated
feature names in flow goals).

---

## 3. Screenshot-by-screenshot findings

### S-10 — Screens list, default (desktop + mobile)

**What works**
- Flow-grouped sections with counts read as a product map; ordinal chips (1, 2, 3)
  inside a flow communicate sequence.
- Cards are scannable: name → purpose → "NEXT → Ingestion Workspace → …" strip.
  Connection *names*, not counts — exactly right.
- Default status surface is restrained: one "Mockup ready" line + one "Accepted"
  badge; two filters only (Flow, Status); "6 of 6 screens" counter.
- Mobile stacks cleanly; full-width filter selects; no overflow.

**What is confusing / heavy**
- Every card carries an uppercase **EDITED** chip. On the flagship demo all six
  cards show it. It answers a question nobody asked at list level and visually
  competes with the priority badge.
- "Mockup ready" (green icon) + "Accepted" (blue pill) are two near-synonymous
  positive signals side by side; the blue pill draws more attention than the
  purpose text.
- Desktop grid: three of the four flow groups contain a single card, so the
  2-column grid renders a lone ~500 px card with an equal blank area beside it —
  page feels half-empty and group headers dominate (S-10 seg1).
- Mobile chrome: title truncates to "AI L…", and header + stage tabs + demo
  banner + workspace header consume ~430 of 844 px before the first filter.

**Functional/responsive issues** — none observed.

**Direction** — keep the card recipe; drop EDITED from the default card face;
consider a single-column list (or span-2 for lone cards) on desktop; keep the two
positive signals as one line ("Accepted · mockup ready") rather than two styles.

### S-11 — Card "Show details" expanded (desktop + mobile)

**What works**
- Progressive disclosure is the right instinct — none of this competes by default.
- Labeled rows are consistent and legible; "CONNECTED TO … Reached from …" is
  genuinely useful context.

**What is confusing / heavy**
- **REVIEW: "Accepted · Ready to accept"** — the user-status and the system
  suggestion render side by side, and on an already-accepted screen the suggestion
  is stale nonsense. The two-concept review model (user status vs. system
  readiness) leaks raw into the UI with no framing.
- **HANDOFF: "Needs review"** in amber on every card — an implementation-handoff
  verdict inside the design-review surface, in warning color, on accepted screens.
  This is precisely the content the rework moved out of Screens; the rollup row
  drags it back in.
- **TRACEABILITY: "Covers 1 PRD feature: f10"** — raw internal ids (`f10`, `f1`,
  `f9`) shown to the user instead of feature names.
- **MOCKUPS: "1 / 3 recommended"** — deficit framing of optional variants (see
  S-30m).
- **ACTIONS: Version history / Mockup history / Regenerate mockup** repeated in
  *every* card, but all three act on the artifact-wide version, not this screen.
  Same buttons on all six cards implies per-screen scope that doesn't exist. On
  mobile they stack as three full rows per card (S-11 mobile seg1), making an
  expanded card ~900 px tall.

**Direction** — keep the disclosure, halve its content: one review line in plain
language, feature *names*, no handoff verdict (link to Implementation Plan
instead), "Mockups: primary ready · 2 optional states available", and move the
artifact-level actions to a single list-level overflow ("Artifact options") or the
metadata section.

### S-12 — "Project readiness & metadata" expanded (desktop + mobile)

**What works**
- Collapsed by default with an honest subtitle — the screens stay primary (S-10).
- The "Expanded Design Coverage" block inside Coverage is the *one* place variants
  are framed correctly: "OPTIONAL … 11 available on demand … generated only when
  you request them, to keep projects fast."

**What is confusing / heavy — the single worst trust failure in the audit**
- Five stacked verdict systems about the same six screens, in one scroll, that
  **contradict each other** (desktop segs 1–3):
  1. *Screen Coverage & Readiness*: headline "**0 of 6 screens pass the derived
     readiness checks**", "READY FOR DEVELOPMENT **0 / 6 · 0%**" — while every
     sub-metric beneath it is green and perfect (PRD features 10/10, flows 4/4,
     primary mockups 4/4 key screens, states 6/6, risks "None noted").
  2. *Review Readiness*: "6 accepted · 0 ready to build · 0 need review" +
     green "**Ready for implementation planning**".
  3. *Downstream Readiness*: a second, differently-derived green "Ready for
     implementation planning" (its body text even repeats the phrase twice), plus
     three "Review legacy mockups for X if it is implementation-critical" rows.
  4. *Implementation Handoff*: "**0 ready · 6 review recommended**" + amber
     "Implementation handoff needs review". "HANDOFF TRACE 6 strong" — jargon.
  5. *Implementation preflight*: amber "4 review" pill, four × "one or more
     mockups may be out of date or unverified", an info row "6 screens have
     legacy mockups with **no freshness metadata**", and six "Recommended next
     steps" of which four repeat the same legacy-mockup sentence verbatim.
- A user cannot answer "is this artifact done?" — the page says 0% ready, ready,
  and needs-review simultaneously. The 0% bar comes from `implementation_ready`
  being a separate status above Accepted, but nothing on the page explains that,
  and "ready to build" appearing as a *third* term deepens the confusion.
- Implementation preflight + handoff export are Implementation-Plan concerns
  living in Screens, restating each other's caveats.
- "freshness metadata", "legacy mockups", "handoff trace", "P0" — internal
  vocabulary throughout.

**Direction** — one readiness model, one sentence, one optional details table.
Everything implementation-flavored (handoff rollup, preflight, export) belongs in
the Implementation Plan artifact (its renderer already has Coverage/readiness
surfaces) or at minimum must stop issuing amber verdicts that contradict the
design-review gate.

### S-20 — User Flows artifact (desktop + mobile)

**What works**
- The flow header card (goal, success outcome, preconditions) is strong context.
- The **Flow Journey** grouping — consecutive steps under one screen header
  ("Infographic Library · STEPS 3–5" with user-action sub-rows) — is the best
  flow-shape communication in the product.
- Mobile keeps the actual journey (cards in sequence), not a degraded summary; no
  overflow; rail → hamburger conversion works.

**What is confusing / heavy**
- **Duplicated feature names (desktop rendering defect):** in the GOAL block each
  related feature renders as a chip *containing* "F1 Image and Prompt Ingestion"
  followed by the same name again as plain text — every feature appears twice
  (desktop seg0). Mobile renders chip "F1" + one name — correct — so this is a
  desktop-specific defect.
- **The whole flow renders twice.** Below the journey, a "STEP-BY-STEP FLOW"
  section repeats all 7 steps as full cards (segs 1–3). The journey already links
  to steps; the duplication makes the page 3,216 px for a single flow and buries
  flows 2–4 behind a subtle left dot-rail that looks like decoration.
- Branches render in raw generator notation: "[Uploaded file exceeds 10MB…] →
  [System disables the upload button…]" — bracket-arrow syntax shown verbatim
  (seg2).
- There is no graph/diagram view of screen-to-screen navigation anywhere — flow
  shape is only ever a vertical list. (The list is good; but cross-flow structure
  and branching are hard to see, and the dependency graph elsewhere proves the
  house style exists.)
- "Medium risk" amber pill sits in the flow header with no explanation or action.

**Direction** — fix the duplicate-name rendering; make the journey the single
rendering of steps (step cards become the expansion of a journey row, or are
removed); render branch conditions as styled "If … → then …" rows; make the flow
switcher look like navigation (named tabs/select, not dots).

### S-30 / S-34 — Screen Detail › Overview (desktop + mobile)

**What works**
- Hierarchy is right and consistent across screens: back link → title + P0 →
  confirm banner → tabs → Purpose/User goal → **large primary mockup** → collapsed
  Review notes → acceptance checklist → collapsed PRD features / Screen details.
- The confirm model is exactly the intended simple loop: "Screen confirmed ·
  Confirmed from PRD Version 1 · [Edit again]" — one action, plain provenance,
  version-labeled. Tabs carry useful meta (Flow count chip, mockup dot).
- Mobile: mockup card, checklist, and disclosures all comfortable; no overflow.

**What is confusing / heavy**
- **Acceptance checklist renders every item with a green check circle** — derived
  restatements of the spec presented in pass/verified iconography the user never
  confirmed. Items are also implementation-grade on S-34 ("System stores the
  original image in object storage and creates a database record with a 'pending'
  status", "99% of uploaded images are successfully stored and enqueued within
  2 seconds") and some are truncated artifacts ("Upload is blocked.").
- An unlabeled card at the very bottom contains only "Copy image prompt / Upload
  image" (S-30 seg2) — orphaned actions with no heading; unclear they belong to
  the screen-image gallery, and they duplicate the Mockups tab's job.
- "Reset to generated / Edit details" float above the Purpose card, visually
  attached to nothing.
- Mobile: the "Review notes — 4 items may benefit from review" header wraps into
  a centered two-line jumble (S-30 mobile seg1).
- The count "4 items may benefit from review" mixes two info-grade notes with two
  real risks — inflating the number on a confirmed screen.

**Direction** — neutral bullets (not green checks) for derived criteria; give the
gallery card a heading or fold those actions into the Mockups tab; left-align the
Review-notes summary on mobile; count only actionable items in the banner
("2 risks to resolve · 2 notes").

### S-31 — Review notes expanded (desktop + mobile)

**What works**
- This is the strongest new piece of review UX: each risk is an amber card with
  severity, a "HOW SHOULD THIS BE HANDLED?" text box **pre-filled with a proposed
  handling**, and "Mark resolved". Generic notes get "Go to Mockups →" + "Mark
  addressed". The user can respond to concerns in place — no hunting.

**What is confusing / heavy**
- The two non-risk notes are variant/metadata nags: "Additional state mockups
  available" and "**Mockup freshness unknown** — an older mockup has no source
  metadata…". Optional-variant marketing and sync jargon inside a review list
  dilute the two real risks.
- Risk cards say "MEDIUM SEVERITY / LOW SEVERITY" in caps but give no consequence
  framing; the pre-filled suggestion renders as gray placeholder text that looks
  disabled/empty rather than like a suggestion you can accept.

**Direction** — keep the mechanism; reserve Review Notes for items that need a
decision (risks, missing purpose/nav); move variant availability to the Mockups
tab and sync status to the mockup card; make the suggested handling an actual
pre-filled value with an "Use suggestion" affordance.

### S-30f / S-34f — Screen Detail › Flow tab (desktop + mobile)

**What works**
- "THIS SCREEN APPEARS IN" — step list with appearance numbering ("appearance 2
  of 4") and USER/SYSTEM lines — answers the tab's core question immediately.
- Journey highlighting (the current screen's groups outlined) ties the screen to
  its flow; the repeated-appearance explainer sentence is honest and calm.

**What is confusing / heavy**
- **Raw markdown leaks:** the flow description renders literally as
  "…study item generation. \*\*Related Features:\*\* [f1] Image and Prompt
  Ingestion, [f2] …" — visible asterisks and bracketed ids on both S-30f and
  (single-line) S-34f, desktop and mobile.
- **Triple rendering:** appears-in digest + full journey + full step-by-step
  cards for *all* steps of the flow (not only this screen's) = 4,305 px desktop /
  5,250 px mobile for one screen's flow context. The step cards are a verbatim
  copy of the User Flows artifact content one click away.
- The tab shows only the flow's steps as lists; the "flow context" promise of the
  tab is fulfilled by the first block alone.

**Direction** — keep appears-in + highlighted journey; replace the duplicated
step-card dump with "Open this flow in User Flows →"; render the description
through the markdown pipeline (or strip the syntax) and show feature *names*.

### S-30m / S-34m — Screen Detail › Mockups tab (desktop + mobile)

**What works**
- The generated Default variant is a large, primary card with Regenerate; variant
  cards are visually distinct from the detail panel; spec-coverage honesty caption
  ("Compared against the mockup's generation spec, not the rendered image…") is
  the right instinct.
- Mobile layout of the gallery and detail panel is clean; no overflow.

**What is confusing / heavy**
- **Deficit framing of optional work:** subtitle "1 of 3 recommended variants
  generated · **2 missing**"; two amber **Missing** pills; purple **RECOMMENDED**
  labels. The same variants are described as "OPTIONAL … available on demand" in
  the coverage panel (S-12) — two contradictory vocabularies for the same
  concept. On the demo (no OpenAI key) there is not even a generate affordance on
  these cards, so the "missing" framing points at nothing the user can do here.
- **"PRD sync unknown" three times** on one page (variant card pill, detail-panel
  pill, explanation box) for the normal legacy state, plus a fourth mention in
  Review notes. The explanation box repeats the pill it sits under.
- **"Mark accepted"** appears as a per-variant action — a second acceptance
  concept on top of the screen-level Confirm, with no explanation of what
  accepting a variant means or does.
- A persistent info paragraph about device storage/snapshot sync ("Generated
  variant images are included in project snapshots, so they travel with a saved
  snapshot and can be restored on another device. They don't yet sync
  automatically across devices.") — internal persistence trivia in a primary
  view, always visible.
- Mobile: SPEC COVERAGE status labels wrap mid-phrase ("In mockup / spec")
  producing a ragged two-column table (S-30m mobile seg1).

**Direction** — lead with the gallery ("Primary mockup" + "Optional states —
generate on demand" group header instead of Missing pills); one sync statement in
one place, in plain words ("Generated before Synapse tracked PRD versions —
re-generate to link it"); demote or remove per-variant "Mark accepted"; move the
storage note behind an info icon; fix the label wrapping.

---

## 4. Cross-view comparison (the system, not the pages)

- **List ⇄ Detail:** the card promises calm ("Mockup ready · Accepted") but its
  own "Show details" contradicts it (amber HANDOFF "Needs review", RISKS "2 to
  review") — the same screen looks fine collapsed and troubled expanded, with no
  state change in between (S-10 vs S-11). Detail's Overview then agrees with the
  calm version ("Screen confirmed"). The middle layer is the outlier.
- **User Flows ⇄ Flow tab:** the Flow tab embeds the artifact's journey *and* its
  step cards wholesale (S-20 vs S-30f). Two places now render 7 step cards; only
  one is ever needed. The tab's unique value (appears-in + highlighting) is real
  but is 15% of its pixels.
- **Mockups gallery ⇄ Overview mockup:** the Overview's PRIMARY MOCKUP card and
  the Mockups tab's Default-variant detail render the same image with different
  frames and different actions (Regenerate on both; Copy image prompt/Upload
  image split across an orphan card on Overview; Mark accepted only on the tab).
  Consistent framing and one action set would remove a mental model switch.
- **Screens ⇄ Implementation Plan:** HANDOFF rows per card, an Implementation
  Handoff rollup, an Implementation preflight, and an Implementation handoff
  export panel all live in Screens (S-11, S-12) while the Implementation Plan
  artifact owns readiness/coverage surfaces of its own. Screens is drifting back
  toward being a second implementation dashboard — the exact thing the redesign
  pulled out of Screen Detail.
- **Desktop ⇄ Mobile:** structure is shared (good — one mental model). Mobile
  inherits desktop's verbosity as height: an expanded card ≈ 900 px, the Flow tab
  ≈ 5,250 px, metadata section ≈ 4,357 px. Fixing desktop's duplication fixes
  mobile comfort for free. One desktop-only defect (duplicate feature names) and
  two mobile-only wraps (Review-notes header, spec-coverage labels).
- **Terminology drift across views:** the same concept is "Accepted" (badge),
  "Ready to accept" (system suggestion), "ready to build", "implementation_ready
  → Ready for implementation planning", "Handoff ready"; variants are
  "recommended", "optional", "missing", "available on demand"; sync is "PRD sync
  unknown", "freshness unknown", "no freshness metadata", "out of date or
  unverified". Each drift forces the user to re-learn the model per panel.

---

## 5. Severity-ranked issues

**Critical — blocks understanding or use**

| # | Issue | Evidence |
|---|-------|----------|
| C1 | The project-level readiness surfaces contradict each other on one page: "0 of 6 pass / 0% ready for development" (all sub-metrics green) vs. green "Ready for implementation planning" (twice) vs. amber "0 ready · 6 review recommended". A user cannot determine the artifact's actual state. | S-12 desktop segs 1–3 |

**High — materially harms usability or trust**

| # | Issue | Evidence |
|---|-------|----------|
| H1 | Optional mockup variants framed as failures: "2 missing", amber **Missing** pills, "1 / 3 recommended" — contradicting the "optional / on-demand" framing elsewhere; no action is even available where the deficit is shown. | S-30m, S-11, S-12 seg1 |
| H2 | Implementation-handoff verdicts inside Screens: amber "HANDOFF Needs review" on every accepted card + handoff rollup + preflight + export panels duplicating Implementation Plan responsibilities. | S-11, S-12 segs 2–3 |
| H3 | Sync/"freshness" jargon and repetition: "PRD sync unknown" ×3 on one tab, "freshness metadata", "legacy mockups", "may be out of date or unverified" ×4, same sentence repeated 4× in Recommended next steps. All on a healthy project. | S-30m, S-31, S-12 segs 2–3 |
| H4 | Two-status review model leaks raw: "REVIEW Accepted · Ready to accept" (stale suggestion on an accepted screen); "ready to build" as a third undefined term. | S-11, S-12 seg2 |
| H5 | Flow content triplicated: Flow tab = appears-in + journey + full step cards (4.3–5.3k px); User Flows page itself renders journey + step cards twice. | S-30f, S-20 |

**Medium — friction or unnecessary complexity**

| # | Issue | Evidence |
|---|-------|----------|
| M1 | Raw markdown/id leakage: literal `**Related Features:**` + `[f1]` ids in Flow tab; "Covers 1 PRD feature: f10" in card details; bracket-arrow branch notation. | S-30f, S-11, S-20 seg2 |
| M2 | Desktop-only rendering defect: every related-feature name renders twice (chip + plain text) in flow GOAL blocks. | S-20 seg0 |
| M3 | Artifact-wide actions (Version history / Mockup history / Regenerate mockup) repeated inside every card's details, implying per-screen scope; 3 stacked rows per card on mobile. | S-11 |
| M4 | Acceptance checklist renders derived, unverified criteria with green pass checks; items include implementation-grade content. | S-30 seg1, S-34 seg1 |
| M5 | Per-variant "Mark accepted" introduces a second acceptance concept on top of screen Confirm. | S-30m seg1 |
| M6 | Persistent storage/snapshot-sync paragraph in the Mockups tab. | S-30m |
| M7 | Review-notes banner counts info notes as review items ("4 items may benefit from review" = 2 risks + 2 nags). | S-30, S-31 |
| M8 | Orphaned bottom card with only "Copy image prompt / Upload image"; "Reset to generated / Edit details" float unanchored. | S-30 seg2 |
| M9 | Desktop list grid: single-card flow groups leave a permanently empty right column. | S-10 seg1 |

**Low — polish / consistency**

| # | Issue | Evidence |
|---|-------|----------|
| L1 | EDITED chip on every card face by default. | S-10 |
| L2 | Mobile wraps: "Review notes" header (centered 2-line), SPEC COVERAGE status labels ("In mockup / spec"). | S-30 mobile seg1, S-30m mobile seg1 |
| L3 | "Mockup ready" icon-line + "Accepted" pill = two styles for two positive signals on one row. | S-10 |
| L4 | Flow switcher on User Flows is an unlabeled dot rail with status dots; flows 2–4 are easy to miss. | S-20 seg0 |
| L5 | "Medium risk" pill on flow header with no explanation/action; severity caps labels without consequence framing. | S-20, S-31 |
| L6 | Mobile header: project title truncates to "AI L…"; ~430 px of chrome before content. | S-10 mobile seg0 |

---

## 6. What should not be changed

The following observed behaviors are working as intended and should be preserved
through any follow-up work:

1. **The list card recipe** (S-10): name → purpose → "NEXT →" connection strip →
   single muted readiness badge + mockup line, grouped by flow with ordinals, two
   filters only. This is the calm, flow-first surface the redesign promised.
2. **Progressive disclosure as the pattern** ("Show details" per card, collapsed
   "Project readiness & metadata", collapsed Review notes / PRD features / Screen
   details). The *contents* need pruning; the pattern is right.
3. **The single Confirm review action and its language** (S-30): "Confirm screen" ⇄
   "Screen confirmed · Confirmed from PRD Version N · Edit again". Also the
   edit-reopens-review behavior implied by "Edit again".
4. **Risk resolution in place** (S-31): severity + "How should this be handled?" +
   pre-filled proposal + "Mark resolved". Best-in-class moment of the redesign;
   only its packaging needs tuning.
5. **Screen Detail Overview hierarchy** (S-30/S-34): Purpose → primary mockup
   given real prominence → review → criteria → collapsed reference. Consistent
   across screens.
6. **Flow Journey grouping** (S-20, S-30f): consecutive same-screen steps grouped
   under one header with user-action sub-rows and "STEPS 3–5" ranges.
7. **"THIS SCREEN APPEARS IN" with appearance numbering** (S-30f) and the honest
   repeated-appearances explainer.
8. **URL-addressable screen detail** (`?screen=…&screenTab=…`) — back/forward and
   deep links worked throughout the capture.
9. **Honesty captions** on derived data ("Compared against the mockup's generation
   spec, not the rendered image", "estimated"). Wordy in places, but never remove
   the honesty itself.
10. **Generated-from provenance chips** ("Generated from PRD Version 1",
    "Confirmed from PRD Version 1") — the correct, plain way sync state is already
    communicated when it is known.
11. **Mobile structural parity** — same IA on both viewports, hamburger drawer for
    artifact nav, no layout forks. Fix verbosity, keep the structure.
12. **The demo-banner + read-only behavior** for keyless users — disabled actions
    were consistently explained rather than hidden.

---

*Companion document: [`SCREENS_UX_PLAN.md`](./SCREENS_UX_PLAN.md) — the phased
implementation plan derived from these findings. No code changes accompany this
audit.*
