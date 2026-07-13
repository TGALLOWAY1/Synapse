# Adversarial Planning Review

## Product outcome

Adversarial Planning Review gives a user a small, relevant panel of independent specialists who inspect the exact project plan that existed when the review began. The result is structured planning intelligence: evidenced observations, recommendations, disagreements, and questions that the user may act on without allowing AI output to silently alter the canonical plan.

The first release is successful when a user can start a review, understand its coverage and partial failures, inspect deduplicated evidence-backed issues, and explicitly convert or link an issue to an open Decision Center record while preserving the review's source version and history.

## Product boundaries

- Reviews are durable workflows, not chat transcripts and not extensions of the silent PRD consistency rewrite.
- A specialist observation, a synthesized review issue, a proposed planning record, and a user-confirmed decision are separate records.
- Specialist calls are independent until synthesis. No specialist sees another specialist's conclusion.
- Specialists may return zero findings. The system never requires performative criticism.
- Successful specialist results survive sibling failures, cancellation, interruption, and retry.
- The first release excludes continuous review, live debate, autonomous artifact rewriting, custom-agent authoring, readiness scores, scenario simulation, and external reviewer collaboration.

## Primary workflow

1. Open Review from the project workspace.
2. See the recommended 3-5 specialist panel, the artifacts in scope, why each specialist was selected, and any known coverage gaps.
3. Optionally remove a specialist or add a focus note; start the review.
4. Synapse freezes a source manifest, then runs specialists independently with bounded concurrency.
5. Each output is schema-validated and its evidence is verified against the frozen sources. Unsupported findings remain auditable but do not enter synthesis as grounded findings.
6. Synapse groups overlapping findings and synthesizes genuine disagreements without deleting minority perspectives.
7. The results view leads with the consequential issue, why it matters, evidence, affected sources, participating specialists, and the decision/action required.
8. The user may propose or link a Decision Center record, challenge an existing decision, request an artifact revision, defer, dismiss with a reason, or mark the issue already addressed.
9. A changed project marks the historical review potentially stale. Re-review creates a new linked run; it never mutates the old review.

## Domain model

The persisted project domain is deliberately separate from generation metrics:

- `ReviewRun`: immutable scope/source manifest plus durable lifecycle, selected panel, synthesis state, coverage, and previous-run link.
- `SpecialistRun`: responsibility, boundaries, context refs, model, attempts, durable status, validation summary, and finding IDs.
- `SpecialistFinding`: immutable specialist observation, type, severity, confidence, implementation impact, consequence, recommended action, and verified evidence refs.
- `ReviewIssue`: user-facing cluster that preserves reinforcing and conflicting perspectives, issue status, and disposition history.
- `PlanningRecord`: Decision Center decision, assumption, risk, open question, or conflict. AI-created records begin as proposed/open and require explicit user confirmation or resolution.
- `EvidenceRef`: exact spine/artifact version plus structured locator, bounded excerpt, and excerpt hash.

Collections remain project-keyed to match the current Zustand, cloud bundle, snapshot, and demo-hydration conventions. Review source manifests are immutable; active lifecycle fields and disposition histories are append/audit oriented.

## Source manifest and context

At start, build one `ReviewContextManifest` containing:

- source spine ID, schema version, canonical spine, and content hash;
- exact preferred artifact IDs/version IDs/subtypes/content hashes;
- available and missing artifact inventory;
- project platform/category/constraints and inherited safety boundaries;
- a deterministic locator index for structured PRD paths and artifact sections;
- capture timestamp and overall context signature.

The canonical spine is the authority for identity, features, constraints, and safety. Exact artifact versions are authoritative for the detail they own. Full prose is secondary evidence. Specialists receive a bounded specialty-specific context slice plus the source index, not repeated whole-project dumps.

## Specialist panel

The registry defines each specialist's responsibility, review goals, boundaries, relevant source types, and selection signals. The default panel is selected deterministically from product category, platform, artifact inventory, AI/data/auth/operational signals, maturity, and the user's focus. The selection and its reasons are persisted and visible.

Initial specialties cover product/scope, UX/behavior, architecture, data/backend, security/privacy, accessibility, reliability/QA, AI/model risk, and delivery/operations. The selector chooses 3-5; it does not run the full registry mechanically.

Strong reasoning models handle specialist analysis and consequential disagreement synthesis. Fast models may later assist normalization or candidate clustering, but deterministic evidence validation and fingerprinting remain the first line. Every call records usage and estimated cost through the existing metrics infrastructure.

## Orchestration

Durable stages are:

`snapshot -> panel_selected -> specialist_analysis -> evidence_validation -> normalization -> synthesis -> ready`

- Three specialist calls run concurrently initially.
- Each specialist has strict structured output and may report no issues.
- Invalid JSON receives one bounded structured repair attempt; failed specialists are isolated.
- Network retry and inactivity timeout reuse the provider layer.
- Cancellation aborts active calls but preserves completed outputs.
- Rehydration converts active stages/runs to interrupted and offers retry against the same manifest.
- A review is `partial` when coverage is incomplete but validation and synthesis completed; it is never `complete` before required synthesis/validation.

Deduplication uses deterministic source IDs/locators, affected canonical entities/features, and normalized issue fingerprints before optional model synthesis. Raw findings always remain attached to the cluster. Conflicting recommendations become explicit perspectives and a user-evaluable tradeoff.

## Decision Center integration

Issue actions never silently rewrite a spine or artifact:

- Propose record: creates a proposed decision or open assumption/risk/question/conflict linked to the source finding IDs.
- Link existing: relates the issue to an existing planning record.
- Challenge decision: creates an open challenge linked to the confirmed record without changing it.
- Revise artifact: records a requested revision; applying content later must append a normal version with provenance.
- Defer, dismiss, already addressed: record actor, time, reason, and context signature.

Confirmed decisions remain user actions. Any action that changes canonical PRD or artifact content must append a new version using existing versioning conventions and retain the resulting version ID.

## Delivery phases and validation

### Phase 1: durable foundation

Add types, source manifest/evidence hashing, review/planning store slice, interruption migration, cloud bundle/snapshot support, and pure tests for anchoring and staleness.

Validation: old projects hydrate; exact source versions survive save/restore; changed preferred sources mark a review stale; no generated finding can become confirmed.

### Phase 2: specialists and orchestration

Add registry/panel selection, strict schemas/prompts, injectable transports, bounded independent execution, evidence validation, retries/cancellation, partial results, metrics, normalization, and disagreement-preserving synthesis.

Validation: strong plans may yield zero findings; absent requirements are not invented; unsupported evidence is quarantined; duplicate issues collapse without losing perspectives; one failed specialist does not erase successful results.

### Phase 3: review and Decision Center UI

Add a calm derived Review surface, recommended-panel setup, durable progress, results/history, evidence disclosure, issue actions, and first-class planning-record views.

Validation: primary actions are understandable without orchestration knowledge; severity/confidence/status remain distinct; mobile actions stack/use sheets; incomplete coverage and stale reviews are explicit.

### Phase 4: evaluation and hardening

Run fixtures for strong, incomplete, contradictory, unsupported, over-scoped, privacy-sensitive, mobile, AI-dependent, disagreement, duplicate, and partial-failure projects. Add desktop/mobile browser verification and regression tests.

Validation: existing PRD/assets/history workflows remain intact; review cost/latency are recorded; cancellation/interruption/retry are recoverable; dismissed findings remain dismissed until relevant evidence changes.

## Reliability and operating constraints

- Persist structured findings and bounded evidence, not raw transcripts.
- Debounce project sync updates to avoid a whole-bundle write for every token or progress tick.
- Hash and cache extracted source sections; reuse the manifest across specialists.
- Cap findings and output tokens, and show an estimated review range before start.
- Preserve validation failures for audit while excluding them from trusted synthesis.
- Treat developer traces as diagnostics, not the review audit store; traces are not a confidentiality boundary.

