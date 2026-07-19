// Write-time retention caps for the machine-generated review / readiness /
// downstream-update history collections, so localStorage (and therefore the
// sync bundle and snapshots, which derive from the same collections) does not
// grow without bound.
//
// Design rules (see docs/architecture/STATE_AND_AUTH.md "Retention caps"):
//
// - These helpers are PURE: given the persisted project-keyed collection maps,
//   a project id, and a config, they return pruned maps. All store reads happen
//   in the calling slice's `set((state) => …)` updater, never from a stale
//   `get()` snapshot.
// - Pruning is invoked when a new root record (review run / readiness review /
//   downstream update plan) is appended, plus ONE sweep right after the store
//   rehydrates from localStorage (`sweepRetentionCollections`, wired in
//   projectStore's `onRehydrateStorage`) so state that grew past the caps
//   before the caps existed — or while persistence was failing on quota — can
//   shrink without waiting for a new run. It never fires spontaneously
//   mid-session, so a currentness/aggregate hash that pruning could shift was
//   already invalidated by the very append (or full rehydrate) that
//   triggered it.
// - Retention is cascade-shaped, never a blind per-collection count cap: a
//   pruned root takes its entire dependent chain with it, and a retained root
//   keeps its entire chain, so referential integrity between runs, findings,
//   issues, plans, proposals, review events, applications, verifications, and
//   verification events is preserved.
// - USER AUTHORITY IS NEVER PRUNED. `planningRecords` (the append-only
//   PlanningRecord/DecisionEvent aggregate) and `readinessCommitmentEvents`
//   (user commit/reopen authority) have no retention cap at all — they are
//   user-rate-bounded and load-bearing for the authority model.
// - Caps err generous: this is growth-bounding, not aggressive cleanup.

import type {
    ReadinessCommitmentEvent,
    ReadinessReview,
    ReviewIssue,
    ReviewRun,
    SpecialistFinding,
    SpecialistRun,
    SpineVersion,
} from '../types';
import type { DownstreamUpdatePlan, DownstreamUpdatePlanEvent } from './planning/downstreamUpdatePlan';
import type {
    DownstreamArtifactUpdateApplication,
    DownstreamArtifactUpdateProposal,
    DownstreamArtifactUpdateReviewEvent,
    DownstreamArtifactUpdateVerification,
    DownstreamArtifactUpdateVerificationEvent,
} from './planning/downstreamArtifactUpdateProposal';

/** Adversarial review runs kept per project (most recent, by append order),
 *  beyond the always-protected ones (in-flight runs, runs with open/deferred
 *  issues, caller-protected runs such as the current substantive challenge). */
export const REVIEW_RUN_RETENTION_LIMIT = 20;

/** Readiness reviews kept per project, beyond reviews referenced by any
 *  commitment event (those are kept forever — commitments must stay auditable). */
export const READINESS_REVIEW_RETENTION_LIMIT = 20;

/** Downstream update plans kept per (project, artifact) — each selective
 *  application appends a rebased plan, so the cap is per artifact lineage. */
export const DOWNSTREAM_PLAN_RETENTION_LIMIT_PER_ARTIFACT = 10;

/** Review-run statuses that mean work may still land on the run — never prune. */
const ACTIVE_REVIEW_RUN_STATUSES: ReadonlySet<ReviewRun['status']> = new Set([
    'queued',
    'running',
    'synthesizing',
]);

/** Issue statuses that keep their whole review run (and its specialist runs /
 *  findings / sibling issues) alive: the user has not finished with them. */
const RUN_PROTECTING_ISSUE_STATUSES: ReadonlySet<ReviewIssue['status']> = new Set([
    'open',
    'deferred',
]);

const projectArray = <T>(map: Record<string, T[]>, projectId: string): T[] => {
    const value = map[projectId];
    return Array.isArray(value) ? value : [];
};

/** Swap in `next` for the project's array only when something was removed, so
 *  unchanged collections keep their exact reference (selector stability and
 *  `projectSlicesChanged`'s reference-equality sync diffing both rely on it). */
const replaceIfPruned = <T>(
    map: Record<string, T[]>,
    projectId: string,
    previous: T[],
    next: T[],
): Record<string, T[]> => (next.length === previous.length ? map : { ...map, [projectId]: next });

export interface ReviewRetentionCollections {
    reviewRuns: Record<string, ReviewRun[]>;
    specialistRuns: Record<string, SpecialistRun[]>;
    reviewFindings: Record<string, SpecialistFinding[]>;
    reviewIssues: Record<string, ReviewIssue[]>;
}

/**
 * Cap the adversarial-review history for one project at the review-run root.
 * Keeps the most recent `limit` runs (append order) PLUS every protected run:
 * ids passed by the caller (e.g. the current substantive challenge for the
 * latest spine), runs that are still in flight, and runs that still have an
 * open or deferred issue. Specialist runs, findings, and issues cascade with
 * their run, so nothing retained can reference a pruned run.
 */
export function pruneReviewCollections(
    collections: ReviewRetentionCollections,
    projectId: string,
    options: { limit?: number; protectedReviewIds?: Iterable<string> } = {},
): ReviewRetentionCollections {
    const limit = options.limit ?? REVIEW_RUN_RETENTION_LIMIT;
    const runs = projectArray(collections.reviewRuns, projectId);
    if (runs.length <= limit) return collections;

    const issues = projectArray(collections.reviewIssues, projectId);
    const protectedIds = new Set<string>(options.protectedReviewIds ?? []);
    for (const run of runs) {
        if (ACTIVE_REVIEW_RUN_STATUSES.has(run.status)) protectedIds.add(run.id);
    }
    for (const issue of issues) {
        if (RUN_PROTECTING_ISSUE_STATUSES.has(issue.status)) protectedIds.add(issue.reviewId);
    }
    const recentIds = new Set(runs.slice(-limit).map(run => run.id));
    const keptRuns = runs.filter(run => recentIds.has(run.id) || protectedIds.has(run.id));
    if (keptRuns.length === runs.length) return collections;

    const keptRunIds = new Set(keptRuns.map(run => run.id));
    const specialists = projectArray(collections.specialistRuns, projectId);
    const findings = projectArray(collections.reviewFindings, projectId);
    return {
        reviewRuns: { ...collections.reviewRuns, [projectId]: keptRuns },
        specialistRuns: replaceIfPruned(
            collections.specialistRuns, projectId, specialists,
            specialists.filter(run => keptRunIds.has(run.reviewId)),
        ),
        reviewFindings: replaceIfPruned(
            collections.reviewFindings, projectId, findings,
            findings.filter(finding => keptRunIds.has(finding.reviewId)),
        ),
        reviewIssues: replaceIfPruned(
            collections.reviewIssues, projectId, issues,
            issues.filter(issue => keptRunIds.has(issue.reviewId)),
        ),
    };
}

export interface ReadinessRetentionCollections {
    readinessReviews: Record<string, ReadinessReview[]>;
    readinessCommitmentEvents: Record<string, ReadinessCommitmentEvent[]>;
}

/**
 * Cap the derived readiness-review checkpoints for one project. Keeps the most
 * recent `limit` reviews (append order) PLUS every review referenced by any
 * commitment event — authorize/commit/reopen events dereference their review by
 * id and validate its integrity, so a committed (or ever-committed) review must
 * stay resident forever. `readinessCommitmentEvents` themselves are user
 * authority and are NEVER pruned; only the reviews map is returned.
 */
export function pruneReadinessReviews(
    collections: ReadinessRetentionCollections,
    projectId: string,
    options: { limit?: number } = {},
): Record<string, ReadinessReview[]> {
    const limit = options.limit ?? READINESS_REVIEW_RETENTION_LIMIT;
    const reviews = projectArray(collections.readinessReviews, projectId);
    if (reviews.length <= limit) return collections.readinessReviews;

    const referencedIds = new Set(
        projectArray(collections.readinessCommitmentEvents, projectId).map(event => event.reviewId),
    );
    const recentIds = new Set(reviews.slice(-limit).map(review => review.id));
    const kept = reviews.filter(review => recentIds.has(review.id) || referencedIds.has(review.id));
    if (kept.length === reviews.length) return collections.readinessReviews;
    return { ...collections.readinessReviews, [projectId]: kept };
}

export interface DownstreamRetentionCollections {
    downstreamUpdatePlans: Record<string, DownstreamUpdatePlan[]>;
    downstreamUpdatePlanEvents: Record<string, DownstreamUpdatePlanEvent[]>;
    downstreamArtifactUpdateProposals: Record<string, DownstreamArtifactUpdateProposal[]>;
    downstreamArtifactUpdateReviewEvents: Record<string, DownstreamArtifactUpdateReviewEvent[]>;
    downstreamArtifactUpdateApplications: Record<string, DownstreamArtifactUpdateApplication[]>;
    downstreamArtifactUpdateVerifications: Record<string, DownstreamArtifactUpdateVerification[]>;
    downstreamArtifactUpdateVerificationEvents: Record<string, DownstreamArtifactUpdateVerificationEvent[]>;
}

/**
 * Cap the downstream-update history for one project at the plan root, PER
 * ARTIFACT lineage (each selective application rebases into a fresh plan for
 * the same artifact, so plans accumulate per artifact). The newest plan per
 * artifact — the only one that can be current against the live context — is
 * always inside the window, as is its immediate predecessor chain up to the
 * limit. Everything below a pruned plan cascades: its plan events, proposals,
 * the review events / applications bound to those proposals, verifications
 * bound to the plan (via `subject.planId`) or a pruned proposal, and the
 * verification events of pruned verifications. A retained plan keeps its whole
 * chain, so no retained record dereferences a pruned one.
 */
export function pruneDownstreamCollections(
    collections: DownstreamRetentionCollections,
    projectId: string,
    options: { limitPerArtifact?: number } = {},
): DownstreamRetentionCollections {
    const limit = options.limitPerArtifact ?? DOWNSTREAM_PLAN_RETENTION_LIMIT_PER_ARTIFACT;
    const plans = projectArray(collections.downstreamUpdatePlans, projectId);
    // Total ≤ limit means every per-artifact group is within its window too.
    if (plans.length <= limit) return collections;

    const byArtifact = new Map<string, DownstreamUpdatePlan[]>();
    for (const plan of plans) {
        const group = byArtifact.get(plan.artifact.artifactId);
        if (group) group.push(plan);
        else byArtifact.set(plan.artifact.artifactId, [plan]);
    }
    const keptPlanIds = new Set<string>();
    for (const group of byArtifact.values()) {
        for (const plan of group.slice(-limit)) keptPlanIds.add(plan.id);
    }
    const keptPlans = plans.filter(plan => keptPlanIds.has(plan.id));
    if (keptPlans.length === plans.length) return collections;

    const planEvents = projectArray(collections.downstreamUpdatePlanEvents, projectId);
    const proposals = projectArray(collections.downstreamArtifactUpdateProposals, projectId);
    const keptProposals = proposals.filter(proposal => keptPlanIds.has(proposal.updatePlanBinding.planId));
    const keptProposalIds = new Set(keptProposals.map(proposal => proposal.id));
    const reviewEvents = projectArray(collections.downstreamArtifactUpdateReviewEvents, projectId);
    const applications = projectArray(collections.downstreamArtifactUpdateApplications, projectId);
    const verifications = projectArray(collections.downstreamArtifactUpdateVerifications, projectId);
    const keptVerifications = verifications.filter(verification => (
        verification.subject
            ? keptPlanIds.has(verification.subject.planId)
            : verification.proposalId
                ? keptProposalIds.has(verification.proposalId)
                // No resolvable binding at all — keep conservatively.
                : true
    ));
    const keptVerificationIds = new Set(keptVerifications.map(verification => verification.id));
    const verificationEvents = projectArray(collections.downstreamArtifactUpdateVerificationEvents, projectId);
    return {
        downstreamUpdatePlans: { ...collections.downstreamUpdatePlans, [projectId]: keptPlans },
        downstreamUpdatePlanEvents: replaceIfPruned(
            collections.downstreamUpdatePlanEvents, projectId, planEvents,
            planEvents.filter(event => keptPlanIds.has(event.planId)),
        ),
        downstreamArtifactUpdateProposals: replaceIfPruned(
            collections.downstreamArtifactUpdateProposals, projectId, proposals, keptProposals,
        ),
        downstreamArtifactUpdateReviewEvents: replaceIfPruned(
            collections.downstreamArtifactUpdateReviewEvents, projectId, reviewEvents,
            reviewEvents.filter(event => keptProposalIds.has(event.proposalId)),
        ),
        downstreamArtifactUpdateApplications: replaceIfPruned(
            collections.downstreamArtifactUpdateApplications, projectId, applications,
            applications.filter(application => keptProposalIds.has(application.proposalId)),
        ),
        downstreamArtifactUpdateVerifications: replaceIfPruned(
            collections.downstreamArtifactUpdateVerifications, projectId, verifications, keptVerifications,
        ),
        downstreamArtifactUpdateVerificationEvents: replaceIfPruned(
            collections.downstreamArtifactUpdateVerificationEvents, projectId, verificationEvents,
            verificationEvents.filter(event => keptVerificationIds.has(event.verificationId)),
        ),
    };
}

/**
 * The review run readiness reviews rely on as the "substantive challenge" of
 * the latest spine: the most recent COMPLETED project-scope run whose manifest
 * targets `latestSpineId`. It is always protected from pruning, even when
 * newer narrow/focus runs push it outside the count window. Shared by the
 * write-time path (`createReviewRun`) and the rehydrate-time sweep so both
 * apply the exact same protection — do not fork this policy at a call site.
 */
export function findProtectedSubstantiveChallengeId(
    runs: readonly ReviewRun[],
    latestSpineId: string | undefined,
): string | undefined {
    if (!latestSpineId) return undefined;
    for (let index = runs.length - 1; index >= 0; index -= 1) {
        const candidate = runs[index];
        if (candidate.scope.kind === 'project'
            && candidate.status === 'complete'
            && candidate.synthesisStatus === 'complete'
            && candidate.sourceManifest.spineVersionId === latestSpineId) {
            return candidate.id;
        }
    }
    return undefined;
}

/** Every collection the retention engine reads or prunes, in one shape. */
export type RetentionSweepCollections =
    ReviewRetentionCollections & ReadinessRetentionCollections & DownstreamRetentionCollections;

export interface RetentionSweepState extends ReviewRetentionCollections,
    ReadinessRetentionCollections, DownstreamRetentionCollections {
    /** Read-only input: needed to derive the protected substantive challenge
     *  per project (never pruned — version history is untouched by retention). */
    spineVersions: Record<string, SpineVersion[]>;
}

export interface RetentionSweepResult {
    /** The (possibly pruned) collections. Every map that had nothing to prune
     *  keeps its exact input reference, so callers can write back / diff by
     *  reference without churn. `readinessCommitmentEvents` is always the
     *  input reference — commitment events are user authority, never pruned. */
    collections: RetentionSweepCollections;
    /** True iff anything was actually removed (any root map reference changed). */
    pruned: boolean;
}

/**
 * One-shot retention sweep across EVERY project in a rehydrated state — the
 * recovery path for state that outgrew the caps while no root append (and thus
 * no write-time pruning) was happening, e.g. a user stuck behind the
 * "Storage full" quota toast. Pure state-in/state-out: it applies the exact
 * same per-project engines (`pruneReviewCollections` with the protected
 * substantive challenge, `pruneReadinessReviews`, `pruneDownstreamCollections`)
 * with their default caps and never-prune guarantees, and returns
 * `pruned: false` with all input references intact when nothing exceeds a cap.
 */
export function sweepRetentionCollections(state: RetentionSweepState): RetentionSweepResult {
    let review: ReviewRetentionCollections = {
        reviewRuns: state.reviewRuns,
        specialistRuns: state.specialistRuns,
        reviewFindings: state.reviewFindings,
        reviewIssues: state.reviewIssues,
    };
    let readinessReviews = state.readinessReviews;
    let downstream: DownstreamRetentionCollections = {
        downstreamUpdatePlans: state.downstreamUpdatePlans,
        downstreamUpdatePlanEvents: state.downstreamUpdatePlanEvents,
        downstreamArtifactUpdateProposals: state.downstreamArtifactUpdateProposals,
        downstreamArtifactUpdateReviewEvents: state.downstreamArtifactUpdateReviewEvents,
        downstreamArtifactUpdateApplications: state.downstreamArtifactUpdateApplications,
        downstreamArtifactUpdateVerifications: state.downstreamArtifactUpdateVerifications,
        downstreamArtifactUpdateVerificationEvents: state.downstreamArtifactUpdateVerificationEvents,
    };
    const projectIds = new Set([
        ...Object.keys(state.reviewRuns),
        ...Object.keys(state.readinessReviews),
        ...Object.keys(state.downstreamUpdatePlans),
    ]);
    for (const projectId of projectIds) {
        const latestSpineId = projectArray(state.spineVersions, projectId).find(item => item.isLatest)?.id;
        const protectedId = findProtectedSubstantiveChallengeId(
            projectArray(review.reviewRuns, projectId),
            latestSpineId,
        );
        review = pruneReviewCollections(review, projectId, {
            protectedReviewIds: protectedId ? [protectedId] : [],
        });
        readinessReviews = pruneReadinessReviews({
            readinessReviews,
            readinessCommitmentEvents: state.readinessCommitmentEvents,
        }, projectId);
        downstream = pruneDownstreamCollections(downstream, projectId);
    }
    // Dependent collections only ever change when their root map changed (the
    // cascade lives inside the root prune), so comparing the three root map
    // references is an exact "did anything get removed" signal.
    const pruned = review.reviewRuns !== state.reviewRuns
        || readinessReviews !== state.readinessReviews
        || downstream.downstreamUpdatePlans !== state.downstreamUpdatePlans;
    return {
        collections: {
            ...review,
            readinessReviews,
            readinessCommitmentEvents: state.readinessCommitmentEvents,
            ...downstream,
        },
        pruned,
    };
}
