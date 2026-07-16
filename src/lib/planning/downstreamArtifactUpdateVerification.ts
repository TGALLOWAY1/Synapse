import type { Artifact, ArtifactVersion } from '../../types';
import { hashReviewValue } from '../review/hash';
import {
    downstreamArtifactUpdateResultRegion,
    downstreamUpdatePlanItemIntegrityHash,
    effectiveDownstreamArtifactUpdate,
    latestDownstreamArtifactUpdateVerificationReview,
    sealDownstreamArtifactUpdateVerification,
    validateDownstreamArtifactUpdateApplicationIntegrity,
    validateDownstreamArtifactUpdateProposalIntegrity,
    validateDownstreamArtifactUpdateReviewEventIntegrity,
    validateDownstreamArtifactUpdateVerificationIntegrity,
    type DownstreamArtifactUpdateApplication,
    type DownstreamArtifactUpdateProposal,
    type DownstreamArtifactUpdateReviewEvent,
    type DownstreamArtifactUpdateVerification,
    type DownstreamArtifactUpdateVerificationEvent,
} from './downstreamArtifactUpdateProposal';
import type {
    DownstreamUpdatePlanEvent,
    DownstreamUpdatePlanSummary,
    DownstreamUpdatePlanSummaryItem,
    DownstreamUpdatePlan,
    DownstreamUpdatePlanCurrentContext,
    DownstreamUpdatePlanItem,
} from './downstreamUpdatePlan';
import { latestDownstreamUpdatePlanItemState, validateDownstreamUpdatePlanIntegrity } from './downstreamUpdatePlan';
import type { ProjectOutputAlignmentSummary } from './outputAlignment';
import { resolveDownstreamUpdateRegionContent } from './downstreamRegionContent';
import { removedDownstreamUpdateRegionHash } from './screenFlowArtifactUpdates';

export type DownstreamVerificationOutcome =
    | 'aligned'
    | 'review_recommended'
    | 'update_still_required'
    | 'verification_unavailable';

export type DownstreamVerificationProjection = {
    planId: string;
    itemId: string;
    artifactId: string;
    artifactVersionId: string;
    outcome: DownstreamVerificationOutcome;
    deterministic: boolean;
    explanation: string;
    nextAction: string;
    verificationId?: string;
    verificationIntegrityHash?: string;
    proposalIntegrityHash?: string;
    applicationIntegrityHash?: string;
    userReview?: DownstreamArtifactUpdateVerificationEvent['action'];
    certainty: DownstreamUpdatePlanItem['certainty'];
    implementationCritical: boolean;
};

const sourceCurrent = (plan: DownstreamUpdatePlan, context: DownstreamUpdatePlanCurrentContext): boolean => (
    plan.source.targetSpineVersionId === context.spineVersionId
    && plan.source.targetSpineContentHash === context.spineContentHash
    && plan.source.planningContextHash === context.planningContextHash
);

const deterministicEvidence = (
    item: DownstreamUpdatePlanItem,
    proposal?: DownstreamArtifactUpdateProposal,
): boolean => item.certainty === 'definite'
    && item.region.kind !== 'artifact_review'
    && item.evidence.some(evidence => evidence.quality === 'direct')
    && item.evidence.every(evidence => evidence.quality !== 'incomplete')
    && (!proposal?.dataModelImpact || (
        !proposal.dataModelImpact.automaticApplicationBlocked
        && proposal.dataModelImpact.dependencies.every(dependency => dependency.certainty === 'direct')
    ));

export function deriveDownstreamArtifactUpdateVerification(input: {
    projectId: string;
    plan: DownstreamUpdatePlan;
    item: DownstreamUpdatePlanItem;
    context: DownstreamUpdatePlanCurrentContext;
    currentVersion: ArtifactVersion;
    baselineVersion?: ArtifactVersion;
    proposal?: DownstreamArtifactUpdateProposal;
    application?: DownstreamArtifactUpdateApplication;
    createdAt?: number;
}): DownstreamArtifactUpdateVerification {
    const { plan, item, currentVersion, proposal, application } = input;
    const current = resolveDownstreamUpdateRegionContent(
        currentVersion,
        proposal ? downstreamArtifactUpdateResultRegion(proposal) : item.region,
    );
    const baseline = input.baselineVersion
        ? resolveDownstreamUpdateRegionContent(input.baselineVersion, item.region)
        : undefined;
    const exact = deterministicEvidence(item, proposal);
    let result: DownstreamVerificationOutcome = 'verification_unavailable';
    let reasoning = 'The current output cannot be compared to an exact structured region with the available provenance.';
    let ambiguity: string | undefined = 'Review the affected region manually before treating the output as aligned.';

    const applicationBound = Boolean(application && proposal
        && validateDownstreamArtifactUpdateProposalIntegrity(proposal)
        && validateDownstreamArtifactUpdateApplicationIntegrity(application)
        && application.proposalId === proposal.id
        && application.proposalIntegrityHash === proposal.integrityHash
        && application.resultingArtifactVersionId === currentVersion.id
        && application.resultingArtifactContentHash === hashReviewValue(currentVersion.content));

    if (!sourceCurrent(plan, input.context)) {
        reasoning = 'The planning source changed after this update plan was created.';
        ambiguity = 'Create a current update plan before verifying this output.';
    } else if (applicationBound && proposal && application) {
        const removalMatches = application.effectiveOperation === 'remove'
            && !current.found
            && application.resultingRegionContentHash === removedDownstreamUpdateRegionHash(proposal.region);
        const regionMatches = current.found && current.contentHash === application.resultingRegionContentHash;
        if ((removalMatches || regionMatches) && exact) {
            result = 'aligned';
            reasoning = 'A local deterministic check confirmed the exact approved change in the current artifact version.';
            ambiguity = undefined;
        } else if (removalMatches || regionMatches) {
            result = 'review_recommended';
            reasoning = 'The approved change is present, but the dependency evidence is not strong enough to prove semantic alignment.';
            ambiguity = 'Review the affected region; Synapse will not convert inferred evidence into certainty.';
        } else {
            result = 'update_still_required';
            reasoning = 'The current artifact no longer contains the exact result produced by the approved application.';
            ambiguity = 'The region changed again or the approved update was not retained.';
        }
    } else if (proposal && proposal.operation !== 'review_only' && exact) {
        const manualRemovalMatches = proposal.operation === 'remove' && !current.found;
        // A parsed region hash is not the hash of raw proposed text. Without a
        // sealed application result, replacement/addition semantics cannot be
        // proved by comparing those unlike representations. Exact absence is
        // the only manual result that can currently be verified locally.
        if (manualRemovalMatches) {
            result = 'aligned';
            reasoning = 'A local deterministic check found the exact bounded result in a manually updated artifact version.';
            ambiguity = undefined;
        } else if (baseline?.found && current.found && baseline.contentHash === current.contentHash) {
            result = 'update_still_required';
            reasoning = 'The exact affected region is unchanged from the version that required attention.';
            ambiguity = 'Apply or manually make the bounded change, then verify again.';
        } else {
            result = 'review_recommended';
            reasoning = 'The affected region changed manually, but it does not exactly match the bounded recommendation.';
            ambiguity = 'Review the current region rather than assuming the manual edit resolved the dependency.';
        }
    } else if (baseline?.found && current.found && baseline.contentHash === current.contentHash) {
        result = 'update_still_required';
        reasoning = 'The affected region is unchanged from the version that required attention.';
        ambiguity = 'The planned concern remains present.';
    } else if (current.found || (baseline?.found && !current.found)) {
        result = 'review_recommended';
        reasoning = 'The affected region changed, but no exact deterministic expected result is available.';
        ambiguity = 'Review the changed region; relevance alone is not proof of alignment.';
    }

    const subjectKind = applicationBound ? 'application' as const : 'manual_update' as const;
    const subject = {
        kind: subjectKind,
        planId: plan.id,
        planIntegrityHash: plan.integrityHash,
        itemId: item.id,
        itemIntegrityHash: downstreamUpdatePlanItemIntegrityHash(plan, item),
        sourceSpineVersionId: plan.source.targetSpineVersionId,
        sourceSpineContentHash: plan.source.targetSpineContentHash,
        planningContextHash: plan.source.planningContextHash,
        artifactId: plan.artifact.artifactId,
        baselineArtifactVersionId: plan.artifact.artifactVersionId,
        baselineArtifactContentHash: plan.artifact.artifactContentHash,
        targetArtifactVersionId: currentVersion.id,
        targetArtifactContentHash: hashReviewValue(currentVersion.content),
        ...(proposal ? { proposalId: proposal.id, proposalIntegrityHash: proposal.integrityHash } : {}),
        ...(applicationBound && application ? { applicationId: application.id, applicationIntegrityHash: application.integrityHash } : {}),
    };
    return sealDownstreamArtifactUpdateVerification({
        schemaVersion: 1,
        id: hashReviewValue({ projectId: input.projectId, subject, result }),
        projectId: input.projectId,
        ...(proposal ? { proposalId: proposal.id, proposalIntegrityHash: proposal.integrityHash } : {}),
        ...(applicationBound && application ? { applicationId: application.id, applicationIntegrityHash: application.integrityHash } : {}),
        subject,
        authoredBy: 'synapse',
        result,
        evidence: item.evidence,
        reasoning,
        ...(ambiguity ? { remainingAmbiguity: ambiguity } : {}),
        verifiedArtifactVersionId: currentVersion.id,
        verifiedArtifactContentHash: hashReviewValue(currentVersion.content),
        verifiedRegionContentHash: current.found && current.contentHash
            ? current.contentHash
            : removedDownstreamUpdateRegionHash(item.region),
        generator: {
            provider: 'synapse-local',
            model: 'deterministic-region-verifier',
            promptHash: hashReviewValue({ plan: plan.integrityHash, item: item.id, current: currentVersion.id }),
            reasoningVersion: 'phase-5-stage-4-v1',
        },
        createdAt: input.createdAt ?? Date.now(),
    });
}

export function verificationIsCurrent(input: {
    verification: DownstreamArtifactUpdateVerification;
    plan?: DownstreamUpdatePlan;
    context?: DownstreamUpdatePlanCurrentContext;
    currentVersion?: ArtifactVersion;
    proposal?: DownstreamArtifactUpdateProposal;
    application?: DownstreamArtifactUpdateApplication;
    reviewEvents: DownstreamArtifactUpdateReviewEvent[];
}): boolean {
    const { verification, plan, context, currentVersion } = input;
    const subject = verification.subject;
    if (!subject || !plan || !context || !currentVersion || !validateDownstreamArtifactUpdateVerificationIntegrity(verification)) return false;
    const item = plan.items.find(candidate => candidate.id === subject.itemId);
    const proposalValid = !subject.proposalId || Boolean(input.proposal
        && validateDownstreamArtifactUpdateProposalIntegrity(input.proposal)
        && input.proposal.projectId === verification.projectId
        && input.proposal.id === subject.proposalId
        && input.proposal.integrityHash === subject.proposalIntegrityHash
        && input.proposal.updatePlanBinding.planId === plan.id
        && input.proposal.updatePlanBinding.planIntegrityHash === plan.integrityHash
        && input.proposal.updatePlanBinding.itemId === subject.itemId
        && input.proposal.updatePlanBinding.itemIntegrityHash === subject.itemIntegrityHash);
    const approval = input.application
        ? input.reviewEvents.find(event => event.id === input.application?.authorizedByReviewEventId)
        : undefined;
    const effective = input.proposal && approval
        ? effectiveDownstreamArtifactUpdate(input.proposal, approval)
        : undefined;
    const applicationValid = subject.kind !== 'application' || Boolean(input.application
        && input.proposal
        && approval
        && validateDownstreamArtifactUpdateApplicationIntegrity(input.application)
        && validateDownstreamArtifactUpdateReviewEventIntegrity(approval)
        && input.application.projectId === verification.projectId
        && approval.projectId === verification.projectId
        && approval.proposalId === input.proposal.id
        && approval.expectedProposalIntegrityHash === input.proposal.integrityHash
        && approval.expectedPlanIntegrityHash === input.proposal.updatePlanBinding.planIntegrityHash
        && approval.expectedItemIntegrityHash === input.proposal.updatePlanBinding.itemIntegrityHash
        && approval.expectedRegionContentHash === input.proposal.currentRegionContentHash
        && input.application.authorizedByReviewEventIntegrityHash === approval.integrityHash
        && input.application.id === subject.applicationId
        && input.application.integrityHash === subject.applicationIntegrityHash
        && input.application.proposalId === subject.proposalId
        && input.application.proposalIntegrityHash === subject.proposalIntegrityHash
        && input.application.expectedArtifactVersionId === input.proposal.artifact.artifactVersionId
        && input.application.expectedArtifactContentHash === input.proposal.artifact.artifactContentHash
        && input.application.expectedRegionContentHash === input.proposal.currentRegionContentHash
        && effective?.operation === input.application.effectiveOperation
        && effective.contentHash === input.application.effectiveContentHash
        && input.application.resultingArtifactVersionId === subject.targetArtifactVersionId
        && input.application.resultingArtifactContentHash === subject.targetArtifactContentHash);
    return validateDownstreamUpdatePlanIntegrity(plan)
        && proposalValid
        && applicationValid
        && plan.id === subject.planId
        && plan.integrityHash === subject.planIntegrityHash
        && Boolean(item && downstreamUpdatePlanItemIntegrityHash(plan, item) === subject.itemIntegrityHash)
        && subject.sourceSpineVersionId === plan.source.targetSpineVersionId
        && subject.sourceSpineContentHash === plan.source.targetSpineContentHash
        && subject.planningContextHash === plan.source.planningContextHash
        && subject.artifactId === plan.artifact.artifactId
        && subject.baselineArtifactVersionId === plan.artifact.artifactVersionId
        && subject.baselineArtifactContentHash === plan.artifact.artifactContentHash
        && sourceCurrent(plan, context)
        && currentVersion.artifactId === subject.artifactId
        && currentVersion.id === subject.targetArtifactVersionId
        && hashReviewValue(currentVersion.content) === subject.targetArtifactContentHash;
}

export function projectDownstreamArtifactUpdateVerifications(input: {
    plans: DownstreamUpdatePlan[];
    context?: DownstreamUpdatePlanCurrentContext;
    artifacts: Artifact[];
    artifactVersions: ArtifactVersion[];
    verifications: DownstreamArtifactUpdateVerification[];
    verificationEvents: DownstreamArtifactUpdateVerificationEvent[];
    proposals: DownstreamArtifactUpdateProposal[];
    applications: DownstreamArtifactUpdateApplication[];
    reviewEvents: DownstreamArtifactUpdateReviewEvent[];
}): DownstreamVerificationProjection[] {
    if (!input.context) return [];
    return input.plans.filter(validateDownstreamUpdatePlanIntegrity).flatMap(plan => {
        if (!sourceCurrent(plan, input.context!)) return [];
        const artifact = input.artifacts.find(candidate => candidate.id === plan.artifact.artifactId);
        const currentVersion = artifact
            ? input.artifactVersions.find(candidate => candidate.id === artifact.currentVersionId)
            : undefined;
        if (!currentVersion) return [];
        return plan.items.map(item => {
            const verification = input.verifications
                .filter(candidate => candidate.subject?.planId === plan.id
                    && candidate.subject.itemId === item.id
                    && verificationIsCurrent({
                        verification: candidate,
                        plan,
                        context: input.context,
                        currentVersion,
                        proposal: input.proposals.find(proposal => proposal.id === candidate.subject?.proposalId),
                        application: input.applications.find(application => application.id === candidate.subject?.applicationId),
                        reviewEvents: input.reviewEvents,
                    }))
                .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))[0];
            const userReview = verification
                ? latestDownstreamArtifactUpdateVerificationReview(verification, input.verificationEvents)?.action
                : undefined;
            const result = verification?.result;
            const outcome: DownstreamVerificationOutcome = result === 'aligned'
                || result === 'review_recommended'
                || result === 'update_still_required'
                || result === 'verification_unavailable'
                ? result
                : 'verification_unavailable';
            return {
                planId: plan.id,
                itemId: item.id,
                artifactId: plan.artifact.artifactId,
                artifactVersionId: currentVersion.id,
                outcome,
                deterministic: outcome === 'aligned',
                explanation: verification?.reasoning ?? 'This current artifact version has not been re-verified against the affected region.',
                nextAction: outcome === 'aligned'
                    ? 'Continue using the verified region.'
                    : outcome === 'update_still_required'
                        ? 'Update the exact affected region, then verify again.'
                        : 'Review or verify the exact affected region.',
                ...(verification ? {
                    verificationId: verification.id,
                    verificationIntegrityHash: verification.integrityHash,
                    ...(verification.proposalIntegrityHash ? { proposalIntegrityHash: verification.proposalIntegrityHash } : {}),
                    ...(verification.applicationIntegrityHash ? { applicationIntegrityHash: verification.applicationIntegrityHash } : {}),
                } : {}),
                ...(userReview ? { userReview } : {}),
                certainty: item.certainty,
                implementationCritical: item.implementationCritical,
            };
        });
    });
}

export function deriveVerifiedDownstreamUpdatePlanSummary(input: {
    base: DownstreamUpdatePlanSummary;
    plans: DownstreamUpdatePlan[];
    events: DownstreamUpdatePlanEvent[];
    context?: DownstreamUpdatePlanCurrentContext;
    projections: DownstreamVerificationProjection[];
}): DownstreamUpdatePlanSummary {
    if (!input.context) return input.base;
    const items: DownstreamUpdatePlanSummaryItem[] = input.plans
        .filter(validateDownstreamUpdatePlanIntegrity)
        .filter(plan => sourceCurrent(plan, input.context!))
        .flatMap(plan => plan.items.map(item => {
            const state = latestDownstreamUpdatePlanItemState(plan, input.events, item.id);
            const verification = input.projections.find(candidate => candidate.planId === plan.id && candidate.itemId === item.id);
            return {
                planId: plan.id,
                planIntegrityHash: plan.integrityHash,
                itemId: item.id,
                artifactId: plan.artifact.artifactId,
                artifactVersionId: verification?.artifactVersionId ?? plan.artifact.artifactVersionId,
                nodeId: plan.artifact.slot,
                artifactTitle: plan.artifact.title,
                region: item.region,
                certainty: item.certainty,
                implementationCritical: item.implementationCritical,
                disposition: state.disposition,
                priority: state.priority,
                recommendation: item.recommendation,
                ...(verification ? {
                    verificationOutcome: verification.outcome,
                    ...(verification.verificationIntegrityHash ? { verificationIntegrityHash: verification.verificationIntegrityHash } : {}),
                } : {}),
            };
        }));
    const handled = (item: DownstreamUpdatePlanSummaryItem): boolean => (
        item.verificationOutcome === 'aligned'
        || item.disposition === 'not_applicable'
        || item.disposition === 'already_aligned'
    );
    const blockingItems = items.filter(item => item.certainty === 'definite'
        && item.implementationCritical
        && !handled(item));
    const advisoryItems = items.filter(item => item.certainty !== 'definite' && !handled(item));
    const reviewedItems = items.filter(handled);
    return {
        currentPlanCount: new Set(items.map(item => item.planId)).size,
        historicalPlanCount: input.plans.filter(validateDownstreamUpdatePlanIntegrity).length
            - new Set(items.map(item => item.planId)).size,
        blockingItems: blockingItems.sort((a, b) => a.priority - b.priority || a.itemId.localeCompare(b.itemId)),
        advisoryItems: advisoryItems.sort((a, b) => a.priority - b.priority || a.itemId.localeCompare(b.itemId)),
        reviewedItems: reviewedItems.sort((a, b) => a.priority - b.priority || a.itemId.localeCompare(b.itemId)),
        snapshotHash: hashReviewValue({
            base: input.base.snapshotHash,
            items: items.map(item => ({
                planId: item.planId,
                planIntegrityHash: item.planIntegrityHash,
                itemId: item.itemId,
                artifactVersionId: item.artifactVersionId,
                disposition: item.disposition,
                verificationOutcome: item.verificationOutcome,
                verificationIntegrityHash: item.verificationIntegrityHash,
                projection: input.projections.find(candidate => candidate.planId === item.planId && candidate.itemId === item.itemId),
            })),
        }),
    };
}

export function reconcileProjectOutputAlignment(
    raw: ProjectOutputAlignmentSummary,
    projections: DownstreamVerificationProjection[],
): ProjectOutputAlignmentSummary {
    const outputs = raw.outputs.map(output => {
        const relevant = projections.filter(item => item.artifactId === output.artifactId);
        if (relevant.length === 0) return output;
        const allAligned = relevant.every(item => item.outcome === 'aligned');
        const independentRawConcern = output.state === 'stale'
            || !output.generatedFromSpineId
            || output.reasons.some(reason => /dependency|provenance|design token|upstream/i.test(reason));
        if (allAligned && !independentRawConcern) return {
            ...output,
            state: 'aligned' as const,
            confidence: 'definite' as const,
            summary: `Synapse deterministically verified ${relevant.length} exact affected region${relevant.length === 1 ? '' : 's'} in this artifact version.`,
            reasons: relevant.map(item => item.explanation),
            nextAction: `Continue using ${output.title}; unrelated work was preserved.`,
            blocksBuildReadiness: false,
        };
        if (allAligned) return {
            ...output,
            summary: `${output.summary} The exact planned regions were verified, but an independent output dependency still needs review.`,
            reasons: [...output.reasons, ...relevant.map(item => item.explanation)],
            nextAction: output.nextAction,
        };
        const required = relevant.filter(item => item.outcome === 'update_still_required');
        if (required.some(item => item.certainty === 'definite')) return {
            ...output,
            state: 'stale' as const,
            confidence: 'definite' as const,
            summary: 'A deterministic check found that an exact affected region still requires its planned update.',
            reasons: required.map(item => item.explanation),
            nextAction: 'Update the exact remaining region, then run verification again.',
            blocksBuildReadiness: required.some(item => item.implementationCritical),
        };
        return {
            ...output,
            state: 'possibly_affected' as const,
            confidence: relevant.some(item => item.outcome === 'review_recommended') ? 'possible' as const : 'unknown' as const,
            summary: 'The current artifact version still has one or more affected regions that need bounded review or verification.',
            reasons: relevant.filter(item => item.outcome !== 'aligned').map(item => item.explanation),
            nextAction: 'Review or verify the remaining exact affected regions.',
            blocksBuildReadiness: relevant.some(item => item.implementationCritical && item.certainty === 'definite'),
        };
    });
    return {
        outputs,
        alignedCount: outputs.filter(output => output.state === 'aligned').length,
        possiblyAffectedCount: outputs.filter(output => output.state === 'possibly_affected').length,
        staleCount: outputs.filter(output => output.state === 'stale').length,
        blockingCount: outputs.filter(output => output.blocksBuildReadiness).length,
    };
}
