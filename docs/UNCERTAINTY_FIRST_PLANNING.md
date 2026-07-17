# Uncertainty-first planning

## Product position

Synapse is a planning system, not an artifact factory. Its purpose is to help a
user discover what is worth building, expose consequential uncertainty before
implementation, and preserve why the resulting plan can be trusted.

Progress therefore means reducing meaningful uncertainty, not generating more
documents. A polished PRD, screen set, data model, or implementation plan can
still be exploratory when its foundation contains unresolved assumptions,
contradictions, or unapplied decisions.

The product loop is:

> Propose → expose uncertainty → decide → propagate → challenge → commit

Synapse may propose interpretations, questions, validation methods, evidence
interpretations, affected regions, and bounded changes. The user remains the
authority for consequential decisions, accepted conclusions, risk treatment,
change application, and commitment.

## The current end-to-end journey

The feature-complete planning journey is:

> Idea → working plan → Needs attention and Decision Center → assumption
> validation → working-plan alignment → selective downstream update planning →
> Challenge and readiness review → user commitment → History

This is a connected loop, not a rigid wizard. Users can inspect downstream
concepts early, move between stages, and return to earlier reasoning. Synapse
keeps exploration distinct from implementation readiness.

### 1. Idea to working plan

Synapse turns the initial idea and preflight answers into a working PRD. The PRD
is an editable current specification, not a declaration that every question has
been settled. The Plan stage leads with:

- a concise summary of the working plan;
- its current commitment condition;
- one most valuable next action;
- a small set of secondary items needing attention;
- accepted uncertainty and downstream condition summaries; and
- access to the durable readiness review.

The live readiness categories remain qualitative: shaping the working plan,
Needs attention, ready to challenge, needs alignment, and ready to build. They
are derived from the planning state and never from artifact count or a
percentage.

### 2. Needs attention and Decision Center

Consequential questions, assumptions, risks, conflicts, and changed sources
become durable planning records. The Plan overview and contextual PRD notices
point to the exact record rather than creating parallel tasks.

The Decision Center has two primary modes:

1. **Needs attention** — current items for which a user action would materially
   improve the plan.
2. **Resolved & history** — recorded choices, treatments, superseded items, and
   prior reasoning.

Each item leads with one dominant condition, why it matters, and the next
action. Options, tradeoffs, Synapse recommendations, evidence, affected content,
history, provenance, and technical bindings use progressive disclosure.

### 3. Assumption validation

A material assumption can move through a validation lifecycle without confusing
workflow progress with evidence support. The user can:

- define or edit an answerable validation question;
- choose or revise a proposed method;
- state supporting, contradicting, and inconclusive signals;
- record source, date, observation, scope or sample, and limitations;
- distinguish direct observation from interpretation;
- review Synapse's advisory interpretation; and
- record their own conclusion, caveats, uncertainty treatment, and revisit
  condition.

The interface preserves important distinctions:

- accepted without validation is not validated;
- evidence existing is not evidence supporting the assumption;
- Synapse's interpretation is not the user's conclusion;
- contradictory evidence may remain inconclusive; and
- expired or reopened conclusions no longer support current readiness.

Low-impact assumptions do not require a formal research workflow. Material
outcomes that could change the plan enter the same alignment path used by
decisions.

### 4. Update the working plan

A consequential decision or accepted validation outcome identifies exact PRD
targets. The impact review can point to claims, features, requirements,
behaviors, scope choices, flow steps, constraints, success criteria, and data or
API expectations.

Synapse may prepare precise replacement proposals. The user reviews each target
and may accept, edit, preserve, reject, defer, confirm that it is already
aligned, or confirm that it is not applicable. Accepted changes enter the PRD
only through the existing version- and content-guarded application boundary.
Nothing silently rewrites a newer working plan.

Broad or ambiguous impact remains review-only. For complex structures, Synapse
enumerates locally known scalar leaves before reasoning about a replacement.
Identity, reference, timestamp, confirmation, and other authority-bearing
fields are never model-editable targets.

### 5. Selective downstream update planning

Downstream condition uses one shared vocabulary:

- **Up to date** — the output reflects the current working plan.
- **Review recommended** — a change may matter, but no mismatch is proven.
- **Update required** — durable project evidence establishes a mismatch.

For screens, user flows, the data model, and the implementation plan, an update
plan can identify the source planning change, exact affected output and region,
certainty, evidence, ambiguity, recommended action, and unaffected scope. It
preserves manual work that remains usable instead of marking an entire artifact
stale because one region changed.

The user controls priority and disposition: planned, deferred, not applicable,
or already up to date. When a safe bounded artifact change is available, its
proposal, user review, guarded application, and later alignment verification
remain distinct events. **Change applied** never means **Alignment verified**.

Selective review is the primary path. Synapse does not silently regenerate a
project or infer that a user approved downstream work.

### 6. Challenge and readiness review

Challenge runs an adversarial planning review against an exact project context.
Findings remain suggestions until the user acts. A complete readiness-supporting
Challenge requires the project-specific specialist coverage selected for that
run and evidence grounded in the exact reviewed sources. A narrower run remains
useful, but is labeled exploratory and cannot silently satisfy readiness.

Readiness has two complementary layers:

- live guidance explains the current planning condition and most useful next
  step; and
- a durable readiness review records why an exact plan version was or was not
  safe enough to implement.

The durable review is bound to the PRD version and content, planning records,
Challenge context and findings, alignment state, downstream state, evidence,
criteria version, and integrity schema. It explains blockers, accepted
uncertainty, evidence support, and actions without presenting model approval as
permission to build.

### 7. User commitment

A favorable readiness review does not commit the plan. The user may continue
shaping it, resolve a blocker, commit a ready plan, or proceed with accepted
risk.

Proceeding with unresolved material concerns requires explicit rationale and,
where necessary, a containment plan. The concern remains unresolved in project
state; commitment does not manufacture validation or relabel risk as resolved.
Commitment is an append-only user event bound to the exact readiness review.

### 8. History and recovery

History preserves changes to the plan, its reasoning, readiness reviews,
commitments, and downstream outputs. Prior reviews remain inspectable against
the versions and criteria used at the time. When material context changes, a
previous review becomes historical rather than continuing to describe the
current project.

Users can recover from earlier judgments without rewriting history:

- decisions and assumption conclusions can be reopened;
- uncertainty treatment can change through a new user event;
- current Challenge findings can return to Needs attention with a rationale;
- stale Challenge findings require a fresh review of the current plan;
- commitments can be reopened; and
- downstream dispositions, applications, and verifications retain their exact
  event order.

Reopening a Challenge finding never reopens or changes a linked planning
record. The user decides whether that separate decision also needs revision.

## User-facing concepts

| Concept | Meaning |
| --- | --- |
| Working plan | The editable current product specification. |
| Needs attention | Consequential current uncertainty with an available action. |
| Decision Center | The durable reasoning, uncertainty, and choice history behind the plan. |
| Synapse recommendation | Advisory reasoning; never user authority. |
| Accepted without validation | A conscious user treatment of uncertainty, not evidence support. |
| Supported by current evidence | A user-recorded conclusion whose current evidence offers support. |
| Update the working plan | Review exact PRD consequences of a decision or validation outcome. |
| Review recommended | Possible downstream impact that has not established a mismatch. |
| Update required | A downstream mismatch supported by durable project evidence. |
| Change applied | Content changed through a guarded user-approved operation. |
| Alignment verified | A later review confirmed the resulting output matches the plan. |
| Challenge | Version-pinned adversarial review of the planning foundation. |
| Readiness review | Durable explanation of an exact plan version's build condition. |
| Plan committed | The user chose this exact ready plan as the implementation basis. |
| Proceeding with accepted risk | The user committed while preserving unresolved concerns. |
| Needs a fresh review | Saved reasoning no longer supports the current project context. |
| History | Append-only specification, reasoning, review, and authority record. |

Internal hashes, signatures, opaque identifiers, model/provider details, and
schema versions remain available only as technical records where needed. They
protect integrity but are not the user's planning vocabulary.

## PRD and Decision Center roles

The PRD communicates **what the current product specification says**. The
Decision Center communicates **why it says that, what remains uncertain, which
alternatives were considered, and what changed**.

Consequential PRD statements must not appear user-confirmed when they are based
on Synapse inference. Contextual notices connect provisional content to its
durable record. Conversely, the Decision Center is not a second PRD and does
not require users to manually duplicate specification content.

When reasoning changes, the PRD changes only through explicit user review and
guarded application. When the PRD or another authority-bearing source changes,
dependent interpretations, Challenge coverage, readiness reviews, and output
plans are invalidated proportionately.

## Authority, integrity, and historical truth

The durable authority boundary is consistent across the experience:

- generated decisions begin proposed or open;
- generated validation plans and evidence interpretations remain proposals;
- model output cannot author user verdicts, conclusions, dispositions,
  applications, overrides, or commitments;
- every consequential user action is append-only and version-bound;
- stale, tampered, duplicate, or concurrently changed actions fail safely; and
- legacy records with incomplete provenance are interpreted conservatively.

Identical visible PRD text does not make two planning states equivalent. A
different decision spine, evidence set, Challenge context, downstream state, or
criteria version makes an earlier interpretation historical.

## Evidence correction and retraction

Evidence is correctable without erasing the record:

- **Retraction** requires the exact current evidence identity, content, evidence
  set, plan context, and a user reason. It appends a sealed retraction event.
- **Correction** atomically appends replacement evidence and retracts its exact
  predecessor. The original, replacement, and correction reason remain in
  history.

Duplicate active sources cannot masquerade as independent corroboration.
Correction or retraction makes prior evidence interpretation and accepted
conclusion non-current, returns the assumption to attention, and makes dependent
readiness reviews historical. It does not automatically rewrite the PRD or
downstream outputs.

This capability supports honest project evidence; it is not a generalized
research or citation-management system.

## Navigation model

The visible progression is:

> Plan → Challenge → Explore or Build → History

Within Challenge, users can move among Review findings, Decision Center, and
Review history. Decision Center items use Needs attention and Resolved &
history. The Plan overview links to the exact current planning record, Challenge
finding, readiness concern, affected output, or update-plan item.

Typed navigation destinations support:

- a PRD anchor;
- the Decision Center or one planning record;
- a Challenge review, issue, or finding;
- a readiness review and concern;
- an artifact and stable screen, flow step, data member, or implementation-plan
  region; and
- an update plan and item.

Navigation carries a human-readable return destination. Browser Back and the
explicit return action use the same presentation state. It is encoded in the
workspace URL so refresh can preserve the target, but it never enters planning
authority, provenance, or readiness hashes. A missing or obsolete target falls
back to a safe parent surface; historical durable targets remain read-only.

## Current limitations

- Bounded working-plan reasoning primarily replaces existing scalar values.
  Adding or removing structured collections, creating absent optional fields,
  changing identities or references, and broad multi-section rewriting remain
  review-only unless a deterministic product path owns the operation.
- Precise downstream planning depends on stable structured region identity.
  Legacy or unstructured outputs receive a conservative bounded-review
  recommendation instead of fabricated precision.
- Possible impact remains advisory and may require user inspection; relevance
  alone cannot prove contradiction.
- Selective updates cover the current supported output families and do not
  imply that every artifact type has region-level planning.
- Early outputs remain useful for exploration, but they do not establish that
  the project is ready to build.
- Historical records with incomplete legacy provenance remain visible but may
  require a fresh review before supporting current readiness.

## Explicitly deferred backlog

The following are deliberately outside the current Decision Center and are the
only items in this deferred planning-intelligence backlog:

1. **Additional adversarial specialist critiques** beyond the current Challenge
   panel and coverage model.
2. **Scenario and alternative-plan comparison** that evaluates multiple
   consequential paths without changing the working or committed plan.
3. **Generalized research management** such as a broad study repository,
   citation library, participant system, or evidence program manager.
4. **Autonomous implementation** by coding agents acting from a committed plan.
5. **Broad automatic regeneration** or silent rewriting of downstream outputs.

These are not hidden modes, implied capabilities, or unfinished parts of the
current Decision Center. Any future work must preserve the same user-authority,
version-binding, non-destructive update, and historical-truth boundaries.
