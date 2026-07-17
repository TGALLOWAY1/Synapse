# Decision Center simplification plan

Status: approved for Phase 6 implementation on 2026-07-16

## Release boundary

- Starting commit: `66df1ed10488224297f2f3a87944652a4a80eb11`
- Branch: `codex/uncertainty-propagation`
- Phase 5 verdict: SHIP after automated, desktop, mobile, product, and adversarial review
- Starting working tree: clean
- Push and deployment: out of scope

Phase 6 is the final planned Decision Center development phase. It consolidates
Phases 1–5 into one uncertainty-first planning journey. It does not add deeper
adversarial specialists, scenarios, a new readiness phase, a task system, or
automatic project regeneration.

## Product objective

The user should be able to answer, without understanding Synapse's integrity
machinery:

1. What are we planning to build?
2. What consequential uncertainty still needs attention?
3. Why does it matter?
4. What should I do next?
5. Are the plan and its outputs aligned enough to implement?

Synapse will expose consequential uncertainty without asking the user to manage
the hashes, projections, event contracts, and provenance that protect it.

## Journey audit

The production journey is structurally sound:

`Idea → working plan → decisions and validation → Challenge → alignment →
outputs → readiness → commitment → history`

The principal problem is fragmentation in presentation and navigation:

- The same concern can appear in the planning banner, PRD context, Decision
  Center, Challenge, readiness, output status, update plan, and exports as if it
  were several independent tasks.
- Output condition is described by competing staleness, alignment, dependency,
  and readiness vocabularies.
- Project readiness competes with screen, handoff, export, mockup, and review
  meanings of “readiness.”
- Cross-stage navigation primarily uses transient component state. Refresh,
  browser Back, readiness-to-correction, and update-plan-to-source journeys can
  lose their exact target or return context.
- PRD uncertainty sometimes opens a generic queue rather than the exact durable
  planning record.
- Update-plan disposition, proposal review, application, and verification are
  all shown at once even though they are progressive steps.
- Evidence retraction exists as a sealed append-only event but has no user
  interface. Closed Challenge findings likewise lack a correction path.
- Data-model impact navigation stops at the entity even when an exact field or
  relationship identity is available.
- Project Map regeneration and alignment shortcuts compete with the safer
  selective-review workflow.
- Technical history is prominent while reasoning history is distributed across
  several surfaces.

## Simplification decisions

| Current presentation | Phase 6 treatment |
| --- | --- |
| Working plan | Retain as the primary planning concept |
| Plan committed | Retain |
| Committed with open questions | “Proceeding with accepted risk” |
| Needs review / Review & Confirm | Consolidate under “Needs attention” |
| Decision log | “Resolved & history” |
| Alignment review | “Update the working plan”; retain exact internal state |
| Update plan | “Review output changes” or “Output changes” |
| Aligned | “Up to date” |
| Possibly affected | “Review recommended” |
| Definitely stale / mismatch | “Update required” |
| Applied | “Change applied”; never imply verification |
| Verified | “Alignment verified” |
| Temporarily tolerated | “Accepted for now”; exact treatment remains in history |
| Readiness checkpoint | “Readiness review” |
| Unverifiable checkpoint | “Needs a fresh review” |
| Bounded/selective proposal | “Proposed change” |
| Historical proposal | “No longer current” |
| Planning spine, hashes, signatures, opaque IDs | Hide under “Technical record” |
| Raw event-type badges | Remove from the default history hierarchy |
| Open all decisions | “View attention” |
| Update all impacted artifacts | Secondary full-regeneration disclosure |

“Readiness” is reserved for the project-level build condition. Artifact-local
systems use scoped language such as Screen status, Coverage, Handoff checks,
Freshness, Review recommended, and Update required.

## Truthful distinctions that remain

Simplification must not merge:

- Synapse's proposal or interpretation and the user's decision.
- User acceptance and evidence support.
- Accepted without validation and supported by current evidence.
- Possible impact and proven mismatch.
- Planned, approved, applied, and verified.
- Working plan and committed plan.
- Current and historical or unverifiable state.
- Ready commitment and proceeding with accepted risk.
- Live readiness guidance and a durable version-pinned readiness review.

Persisted enums, integrity hashes, authority events, version bindings, and
currentness checks remain unchanged unless a correction capability explicitly
requires a new append-only event.

## Smallest cross-cutting architecture

Phase 6 adds three presentation-layer concepts. None are persisted authority.

### Planning language

`planningLanguage.ts` maps internal conditions to consistent user-facing
labels, explanations, and action language. It does not rename stored enums.

### Planning attention

`planningAttention.ts` derives one primary action and a short prioritized list
from integrity-valid current project state.

Items are deduplicated by durable identity, never text similarity:

- `record:{planningRecordId}`
- a linked Challenge issue adopts its planning-record key
- `challenge:{issueId}` for an unlinked current issue
- `output:{artifactId}:{regionKey}:{sourceChangeId}`
- `output:{artifactId}` for conservative legacy review

PRD notices, readiness concerns, artifact status, and update plans reference
these items; they do not create parallel tasks.

Priority is deterministic:

1. Safety or product-foundation blocker
2. Reopened or contradicted material decision or validation
3. Required working-plan alignment
4. Current consequential Challenge finding
5. Definite implementation-critical output mismatch
6. Actionable high-impact validation
7. Intentional scope confirmation
8. Possible downstream review
9. Commit when material attention is clear

Accepted risks are not repeatedly presented as unanswered unless a revisit is
due or dependent state changes.

### Planning navigation

`planningNavigation.ts` defines typed destinations for PRD locations, planning
records, Challenge findings, readiness concerns, artifacts and exact regions,
and update-plan items. It also carries a human-readable return destination.

`ProjectWorkspace` is the single resolver from a destination to stage, tab,
selected identity, and reliable anchor. Navigation state is browser-history
state, not planning state, and never enters hashes or authority events.

Requirements:

- PRD context opens the exact durable record.
- Readiness-to-correction and update-plan-to-source preserve return context.
- Browser Back and explicit “Return to …” controls agree.
- Targets that no longer exist fall back to a safe parent with an explanation.
- Historical targets remain read-only.
- Exact screen, flow, implementation-plan, entity, field, relationship, and
  constraint anchors are used only when stable structured identity exists.

## Decision Center

The final primary modes are:

1. **Needs attention**
2. **Resolved & history**

An item leads with its question, one dominant current condition, why it matters,
and the next action. Validation and alignment remain consequences of that same
record rather than separate queues.

Alternatives, recommendations, evidence, affected content, provenance, prior
interpretations, event history, and technical records use progressive
disclosure. Mobile shows either queue or detail, never both.

## Correction and recovery boundary

Existing append-only paths already cover decision revision/reopening,
assumption-conclusion reopening, uncertainty treatment, alignment and update
dispositions, proposal review, commitment reopening, and immutable readiness
override history.

Phase 6 closes two consequential gaps:

### Evidence correction and retraction

- Retraction requires the exact evidence identity, current content and evidence
  set, and a user reason, then appends the existing integrity-sealed event.
- Correction appends replacement evidence and retracts the predecessor as one
  atomic user operation.
- Original evidence and the correction reason remain in history.
- The prior interpretation and conclusion become non-current.
- The assumption returns to attention before any new alignment is proposed.
- Readiness reviews that depended on the previous evidence become historical
  through the existing planning-state binding.
- Concurrent, stale, duplicate, or tampered correction fails safely.

This is not a generalized research-management system.

### Challenge correction

- A reviewed current finding can be reopened with a required reason.
- Reopening appends history and restores the issue projection to open.
- Stale Challenge context instead offers a fresh review of the current plan.
- Reopening a finding never silently reopens a linked decision.

## Project-level experience

The Plan-stage planning overview—not a new page—shows:

- A short current-plan summary and commitment condition
- One dominant next action
- Up to three secondary meaningful concerns
- A compact accepted-uncertainty summary
- A compact downstream condition
- An entry to the durable readiness review

The PRD follows directly. Progression remains:

`Plan → Challenge → Explore or Build → History`

Explore/Build is based on actual project readiness, not merely commitment.
Artifacts remain accessible but artifact quantity is not presented as progress.
For affected outputs, selective review is primary; full regeneration is a
secondary recovery action with its consequences explained.

## Milestones and commit boundaries

1. `docs: define decision center simplification plan`
2. `refactor: simplify planning terminology and states`
3. `feat: unify planning attention and next actions`
4. `refactor: consolidate decision center experience`
5. `feat: complete planning correction and recovery paths`
6. `refactor: simplify project planning journey`
7. `docs: finalize uncertainty-first planning experience`
8. Audit-blocker fixes, if independently demonstrated
9. Final rendered-release fixes, if independently demonstrated

Each production milestone requires focused tests before the next begins. The
final exact commit requires the full Phase 1–5 regression suite, TypeScript,
ESLint, production build, diff check, desktop and mobile system-Chrome review,
and independent product and release-QA SHIP verdicts.

## Migration and safety risks

- Never rename persisted enums for copy cleanup.
- Attention consumes only integrity-valid current projections.
- Navigation does not carry authority or mutate planning state.
- Legacy records remain conservative and use plain “needs review” language.
- Evidence correction is atomic or fails without partial history.
- Challenge reopening is append-only and current-context bound.
- Presentation consolidation does not merge proposal approval, application,
  verification, alignment, or readiness authority.
- Demoting regeneration does not remove recovery access.
- Readiness snapshots continue hashing durable project state rather than the
  attention or language projection.
- No new readiness phase, planning-record type, approval system, or artifact
  family is introduced.

## Release-blocking acceptance criteria

- One durable concern appears as one connected attention item.
- Exactly one dominant next action appears in the planning overview.
- PRD uncertainty opens the exact concern and supports a reliable return.
- Cross-stage action and return context survive navigation and refresh where the
  target remains current.
- Accepted risk is not presented repeatedly as an unanswered question.
- Evidence correction/retraction invalidates dependent conclusions and
  readiness without rewriting history.
- Current Challenge findings can be corrected without editing history.
- Possible impact remains distinct from update required.
- Applying remains distinct from verification.
- Project Map does not lead with broad regeneration when selective review is
  available.
- Mobile presents one primary context and one dominant action.
- Phase 1–5 authority and integrity regressions remain green.
- Exact-final product, release-QA, desktop, and mobile reviews return SHIP.

## Explicitly deferred

- Additional adversarial specialist critiques
- Scenario exploration and alternate-plan comparison
- General research or citation management
- Autonomous implementation
- Broad automatic regeneration
- General task management

These are not part of the completed Decision Center feature set for the current
product version.
