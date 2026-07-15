import type { ReadinessCommitmentEvent, ReadinessReview } from '../../types';
import { planningContentHash } from './planningHash';

export type ReadinessCommitmentState = {
    activeCommit?: Extract<ReadinessCommitmentEvent, { type: 'plan_committed' }>;
    latestCommit?: Extract<ReadinessCommitmentEvent, { type: 'plan_committed' }>;
    authorization?: Extract<ReadinessCommitmentEvent, { type: 'commit_authorized' }>;
    reopenedAt?: number;
};

const meaningful = (value?: string): boolean => !!value && value.trim().length >= 20;

export const readinessReviewSnapshotHash = (review: ReadinessReview): string =>
    planningContentHash(review.snapshotHashes);

/** Runtime validation is required because restored/imported data is not
 * protected by the TypeScript actor literal. No event can confer authority
 * unless it is bound to the exact immutable review. */
export function readinessEventMatchesReview(
    event: ReadinessCommitmentEvent,
    review: ReadinessReview,
): boolean {
    return event.actor === 'user'
        && event.projectId === review.projectId
        && event.reviewId === review.id
        && event.spineVersionId === review.spineVersionId
        && event.snapshotHash === readinessReviewSnapshotHash(review)
        && event.integrityHash === review.integrityHash
        && event.aggregateHash === review.snapshotHashes.aggregate;
}

export function readinessAuthorizationMatchesReview(
    event: Extract<ReadinessCommitmentEvent, { type: 'commit_authorized' }>,
    review: ReadinessReview,
): boolean {
    if (!readinessEventMatchesReview(event, review)) return false;
    const expected = review.concerns.map(item => item.id).sort();
    const accepted = [...new Set(event.acceptedConcernIds)].sort();
    if (expected.length !== accepted.length || expected.some((id, index) => id !== accepted[index])) return false;
    if (review.conclusion === 'not_ready' && !meaningful(event.rationale)) return false;
    if (review.concerns.some(item => item.blocking) && !meaningful(event.containmentPlan)) return false;
    return true;
}

/** Project append-only events remain the only commitment authority. Legacy
 * `SpineVersion.isFinal` and malformed imported events cannot manufacture an
 * active commitment in read-side UI or export projections. */
export function deriveReadinessCommitmentState(
    review: ReadinessReview,
    events: ReadinessCommitmentEvent[],
): ReadinessCommitmentState {
    const reviewEvents = events
        .filter(event => event.reviewId === review.id && readinessEventMatchesReview(event, review))
        .slice()
        .sort((a, b) => a.at - b.at);
    const authorizations = reviewEvents.filter((event): event is Extract<ReadinessCommitmentEvent, { type: 'commit_authorized' }> => (
        event.type === 'commit_authorized' && readinessAuthorizationMatchesReview(event, review)
    ));
    const commits = reviewEvents.filter((event): event is Extract<ReadinessCommitmentEvent, { type: 'plan_committed' }> => {
        if (event.type !== 'plan_committed') return false;
        const authorization = authorizations.find(candidate => (
            candidate.id === event.authorizationEventId && candidate.at <= event.at
        ));
        return Boolean(authorization);
    });
    const latestCommit = commits.at(-1);
    if (!latestCommit) return {};
    const reopened = reviewEvents
        .filter((event): event is Extract<ReadinessCommitmentEvent, { type: 'plan_reopened' }> => (
            event.type === 'plan_reopened'
            && event.priorCommitEventId === latestCommit.id
            && event.at >= latestCommit.at
        ))
        .at(-1);
    const authorization = authorizations.find(event => event.id === latestCommit.authorizationEventId);
    return {
        latestCommit,
        ...(!reopened && { activeCommit: latestCommit }),
        authorization,
        reopenedAt: reopened?.at,
    };
}
