import type {
    ReadinessActionTarget,
    ReadinessCommitmentEvent,
    ReadinessReview,
} from '../../types';
import type {
    ReadinessReviewCurrentness,
    ReadinessReviewCurrentnessReason,
} from '../../lib/planning/readinessReview';
import type {
    ReadinessCheckpointCommitmentView,
    ReadinessCheckpointView,
} from './ReadinessCheckpoint';

const sourceLabel = (sourceType: ReadinessReview['criteria'][number]['evidence'][number]['sourceType']): string => {
    const labels: Record<typeof sourceType, string> = {
        prd: 'Current PRD',
        planning_record: 'Decision Center',
        challenge: 'Challenge review',
        alignment: 'Plan alignment',
        downstream: 'Downstream output',
        generation: 'Generation state',
    };
    return labels[sourceType];
};

const describeCurrentnessReason = (reason: ReadinessReviewCurrentnessReason): string => {
    const labels: Record<ReadinessReviewCurrentnessReason, string> = {
        integrity_mismatch: 'The stored checkpoint no longer matches its integrity signature.',
        schema_changed: 'Synapse now stores readiness checkpoints with a different schema.',
        criteria_changed: 'Synapse now evaluates readiness with different criteria.',
        spine_identity_changed: 'A different plan version is now current.',
        spine_content_changed: 'The reviewed plan content changed.',
        planning_state_changed: 'A decision, assumption, risk, or source state changed.',
        challenge_changed: 'Challenge coverage or findings changed.',
        alignment_changed: 'Decision-to-plan propagation changed.',
        downstream_changed: 'A downstream output or its alignment state changed.',
    };
    return labels[reason];
};

export function readinessActionLabel(target: ReadinessActionTarget): string {
    if (target.kind === 'prd') return 'Strengthen this PRD section';
    if (target.kind === 'feature') return 'Review first-release scope';
    if (target.kind === 'planning_record') return 'Resolve in Decision Center';
    if (target.kind === 'challenge') return 'Open challenge review';
    return 'Review affected output';
}

export type ReadinessCommitmentState = {
    activeCommit?: Extract<ReadinessCommitmentEvent, { type: 'plan_committed' }>;
    latestCommit?: Extract<ReadinessCommitmentEvent, { type: 'plan_committed' }>;
    authorization?: Extract<ReadinessCommitmentEvent, { type: 'commit_authorized' }>;
    reopenedAt?: number;
};

/** Project append-only events remain the authority source. A legacy
 * SpineVersion.isFinal flag never manufactures a review commitment. */
export function readinessCommitmentState(
    review: ReadinessReview,
    events: ReadinessCommitmentEvent[],
): ReadinessCommitmentState {
    const reviewEvents = events
        .filter(event => event.reviewId === review.id)
        .slice()
        .sort((a, b) => a.at - b.at);
    const commits = reviewEvents.filter((event): event is Extract<ReadinessCommitmentEvent, { type: 'plan_committed' }> => (
        event.type === 'plan_committed'
    ));
    const latestCommit = commits.at(-1);
    if (!latestCommit) return {};
    const reopened = reviewEvents
        .filter((event): event is Extract<ReadinessCommitmentEvent, { type: 'plan_reopened' }> => (
            event.type === 'plan_reopened' && event.priorCommitEventId === latestCommit.id
        ))
        .at(-1);
    const authorization = reviewEvents.find((event): event is Extract<ReadinessCommitmentEvent, { type: 'commit_authorized' }> => (
        event.type === 'commit_authorized' && event.id === latestCommit.authorizationEventId
    ));
    return {
        latestCommit,
        ...(!reopened && { activeCommit: latestCommit }),
        authorization,
        reopenedAt: reopened?.at,
    };
}

function commitmentView(
    review: ReadinessReview,
    events: ReadinessCommitmentEvent[],
): ReadinessCheckpointCommitmentView | undefined {
    const state = readinessCommitmentState(review, events);
    if (!state.latestCommit) return undefined;
    const acceptedCount = state.authorization?.acceptedConcernIds.length ?? 0;
    return {
        kind: acceptedCount > 0 ? 'with_open_questions' : 'ready',
        committedAt: state.latestCommit.at,
        rationale: state.authorization?.rationale,
        containment: state.authorization?.containmentPlan,
        acceptedConcernCount: acceptedCount,
    };
}

export function buildReadinessCheckpointView(
    review: ReadinessReview,
    currentness: ReadinessReviewCurrentness,
    events: ReadinessCommitmentEvent[],
    versionLabel: string,
    comparisonSummary?: string[],
): ReadinessCheckpointView {
    return {
        id: review.id,
        versionLabel,
        capturedAt: review.createdAt,
        conclusion: review.conclusion,
        isCurrent: currentness.current,
        currentnessReasons: currentness.reasons.map(describeCurrentnessReason),
        concerns: review.concerns.map(concern => {
            const criterion = review.criteria.find(item => item.id === concern.criterionId);
            return {
                id: concern.id,
                title: concern.title,
                detail: criterion?.explanation ?? concern.consequence,
                consequence: concern.consequence,
                severity: concern.blocking ? 'blocker' as const : 'attention' as const,
                actionLabel: readinessActionLabel(concern.actionTarget),
            };
        }),
        criteria: review.criteria.map(criterion => ({
            id: criterion.id,
            label: criterion.label,
            status: criterion.status,
            explanation: criterion.explanation,
            evidence: criterion.evidence.map(item => ({
                id: item.id,
                summary: item.summary,
                quality: item.quality,
                sourceLabel: sourceLabel(item.sourceType),
            })),
        })),
        caveats: review.caveats,
        commitment: commitmentView(review, events),
        comparisonSummary,
    };
}
