import type { ReadinessCommitmentEvent, ReadinessReview } from '../../types';
import { planningContentHash } from './planningHash';

export type ReadinessCommitmentState = {
    activeCommit?: Extract<ReadinessCommitmentEvent, { type: 'plan_committed' }>;
    latestCommit?: Extract<ReadinessCommitmentEvent, { type: 'plan_committed' }>;
    authorization?: Extract<ReadinessCommitmentEvent, { type: 'commit_authorized' }>;
    reopenedAt?: number;
};

const meaningful = (value?: string): boolean => !!value && value.trim().length >= 20;

type UnsealedReadinessCommitmentEvent = ReadinessCommitmentEvent extends infer Event
    ? Event extends ReadinessCommitmentEvent
        ? Omit<Event, 'eventIntegrityHash'>
        : never
    : never;

const eventIntegrityPayload = (event: ReadinessCommitmentEvent | UnsealedReadinessCommitmentEvent) => {
    const payload = { ...event } as Partial<ReadinessCommitmentEvent>;
    delete payload.eventIntegrityHash;
    return payload;
};

export function sealReadinessCommitmentEvent(
    event: UnsealedReadinessCommitmentEvent,
): ReadinessCommitmentEvent {
    return {
        ...event,
        eventIntegrityHash: planningContentHash(eventIntegrityPayload(event)),
    } as ReadinessCommitmentEvent;
}

export function validateReadinessCommitmentEventIntegrity(event: ReadinessCommitmentEvent): boolean {
    return event.eventSchemaVersion === 1
        && typeof event.eventIntegrityHash === 'string'
        && event.eventIntegrityHash === planningContentHash(eventIntegrityPayload(event));
}

export const readinessReviewSnapshotHash = (review: ReadinessReview): string =>
    planningContentHash(review.snapshotHashes);

/** A final spine is legacy only when no Phase 3 record ever claimed authority
 * for that exact spine. Malformed or tampered Phase 3 data must stay
 * unverifiable instead of falling back to the more permissive legacy path. */
export function hasReadinessProvenanceForSpine(
    reviews: ReadinessReview[],
    events: ReadinessCommitmentEvent[],
    spineVersionId: string,
): boolean {
    return reviews.some(review => review.spineVersionId === spineVersionId)
        || events.some(event => event.spineVersionId === spineVersionId);
}

/** Runtime validation is required because restored/imported data is not
 * protected by the TypeScript actor literal. No event can confer authority
 * unless it is bound to the exact immutable review. */
export function readinessEventMatchesReview(
    event: ReadinessCommitmentEvent,
    review: ReadinessReview,
): boolean {
    return validateReadinessCommitmentEventIntegrity(event)
        && event.actor === 'user'
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
    const duplicateIds = new Set(events.filter((event, index) => (
        events.findIndex(candidate => candidate.id === event.id) !== index
    )).map(event => event.id));
    const reviewEvents = events
        .filter(event => event.reviewId === review.id && readinessEventMatchesReview(event, review))
        .filter(event => !duplicateIds.has(event.id))
        .slice()
        .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    const authorizations = reviewEvents.filter((event): event is Extract<ReadinessCommitmentEvent, { type: 'commit_authorized' }> => (
        event.type === 'commit_authorized' && readinessAuthorizationMatchesReview(event, review)
    ));
    const consumedAuthorizationIds = new Set<string>();
    const commits = reviewEvents.filter((event): event is Extract<ReadinessCommitmentEvent, { type: 'plan_committed' }> => {
        if (event.type !== 'plan_committed') return false;
        const authorization = authorizations.find(candidate => (
            candidate.id === event.authorizationEventId && candidate.at < event.at
        ));
        if (!authorization || consumedAuthorizationIds.has(authorization.id)) return false;
        consumedAuthorizationIds.add(authorization.id);
        return true;
    });
    const latestCommit = commits.at(-1);
    if (!latestCommit) return {};
    const reopened = reviewEvents
        .filter((event): event is Extract<ReadinessCommitmentEvent, { type: 'plan_reopened' }> => (
            event.type === 'plan_reopened'
            && event.priorCommitEventId === latestCommit.id
            && event.at > latestCommit.at
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
