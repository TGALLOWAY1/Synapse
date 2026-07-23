import type { ArtifactSlotKey, ReadinessActionTarget, ReadinessCommitmentEvent, ReadinessReview } from '../../types';
import type {
    ReadinessReviewCurrentness,
    ReadinessReviewCurrentnessReason,
} from '../../lib/planning/readinessReview';
import {
    deriveReadinessCommitmentState,
    type ReadinessCommitmentState,
} from '../../lib/planning/readinessCommitment';
import type {
    ReadinessCheckpointCommitmentView,
    ReadinessCheckpointView,
} from './ReadinessCheckpoint';
import { featureDetailAnchorId } from '../../lib/derive/implementationSummary';

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
        integrity_mismatch: 'The saved readiness review no longer matches its integrity record.',
        schema_changed: 'Synapse now stores readiness reviews with a different schema.',
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
    if (target.kind === 'update_plan') return 'Review this update plan';
    return 'Review affected output';
}

export type ReadinessNavigationDestination =
    | { stage: 'prd'; anchorId: string }
    | { stage: 'review'; tab: 'decisions'; planningRecordId: string }
    | { stage: 'review'; tab: 'review'; reviewId?: string; issueId?: string; findingId?: string }
    | { stage: 'workspace'; artifactId: string; nodeId: ArtifactSlotKey; updatePlanId?: string; updatePlanItemId?: string };

export function readinessNavigationDestination(target: ReadinessActionTarget): ReadinessNavigationDestination {
    if (target.kind === 'planning_record') {
        return { stage: 'review', tab: 'decisions', planningRecordId: target.planningRecordId };
    }
    if (target.kind === 'challenge') {
        return {
            stage: 'review', tab: 'review', reviewId: target.reviewId,
            issueId: target.issueId, findingId: target.findingId,
        };
    }
    if (target.kind === 'output') {
        return { stage: 'workspace', artifactId: target.artifactId, nodeId: target.nodeId };
    }
    if (target.kind === 'update_plan') {
        return {
            stage: 'workspace', artifactId: target.artifactId, nodeId: target.nodeId,
            updatePlanId: target.planId, updatePlanItemId: target.itemId,
        };
    }
    if (target.kind === 'feature') {
        return { stage: 'prd', anchorId: target.featureId ? featureDetailAnchorId(target.featureId) : 'prd-features' };
    }
    const anchorId = target.section === 'problem'
        ? 'prd-coreProblem'
        : target.section === 'user' ? 'prd-targetUsers' : 'prd-successMetrics';
    return { stage: 'prd', anchorId };
}

function commitmentView(
    review: ReadinessReview,
    state: ReadinessCommitmentState,
    useActive: boolean,
): ReadinessCheckpointCommitmentView | undefined {
    const commit = useActive ? state.activeCommit : state.latestCommit;
    if (!commit) return undefined;
    const acceptedCount = state.authorization?.acceptedConcernIds.length ?? 0;
    const acceptedHardBlockerCount = state.authorization?.eventSchemaVersion === 2
        ? state.authorization.acceptedBlockingRecordIds?.length ?? 0
        : undefined;
    return {
        // V2 finalization authority distinguishes explicit materiality blockers
        // from broader analytical readiness warnings. Historical v1 events
        // retain the conclusion policy under which they were recorded.
        kind: state.authorization?.eventSchemaVersion === 2
            ? acceptedHardBlockerCount
                ? 'with_open_questions'
                : 'ready'
            : review.conclusion === 'ready_to_build'
                ? 'ready'
                : 'with_open_questions',
        committedAt: commit.at,
        rationale: state.authorization?.rationale,
        containment: state.authorization?.containmentPlan,
        acceptedConcernCount: acceptedCount,
        ...(!useActive && state.reopenedAt ? { reopenedAt: state.reopenedAt } : {}),
    };
}

export function buildReadinessCheckpointView(
    review: ReadinessReview,
    currentness: ReadinessReviewCurrentness,
    events: ReadinessCommitmentEvent[],
    versionLabel: string,
    comparisonSummary?: string[],
    hardBlockingRecordIds: readonly string[] = [],
): ReadinessCheckpointView {
    const commitmentState = deriveReadinessCommitmentState(review, events);
    const integrityValid = currentness.integrityValid;
    const hardBlockingIds = new Set(hardBlockingRecordIds);
    // The checkpoint authority is the exact materiality snapshot, even if a
    // legacy or partially projected readiness review omitted one of those
    // records from its broader analytical concern list.
    const hardBlockerCount = hardBlockingIds.size;
    return {
        id: review.id,
        versionLabel,
        capturedAt: review.createdAt,
        conclusion: review.conclusion,
        isCurrent: currentness.current,
        integrityValid,
        currentnessReasons: currentness.reasons.map(describeCurrentnessReason),
        concerns: review.concerns.map(concern => {
            const criterion = review.criteria.find(item => item.id === concern.criterionId);
            return {
                id: concern.id,
                title: concern.title,
                detail: criterion?.explanation ?? concern.consequence,
                consequence: concern.consequence,
                severity: concern.blocking ? 'blocker' as const : 'attention' as const,
                hardBlocking: concern.actionTarget.kind === 'planning_record'
                    && hardBlockingIds.has(concern.actionTarget.planningRecordId),
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
        hardBlockerCount,
        // Never project a commitment as authoritative when the review it was
        // bound to fails integrity validation.
        commitment: integrityValid ? commitmentView(review, commitmentState, true) : undefined,
        priorCommitment: integrityValid && !commitmentState.activeCommit
            ? commitmentView(review, commitmentState, false)
            : undefined,
        comparisonSummary,
    };
}
