import type { AlignmentProposal, DecisionEvent } from '../../types';
import { planningContentHash } from './planningHash';

/** Canonical content the user reviews. Excludes the self-referential contract
 * hash while binding the target, proposed mutation, reasoning, evidence, and
 * frozen planning context into one immutable acceptance identity. */
export function alignmentProposalContentHash(proposal: AlignmentProposal): string {
    const contract = proposal.contract;
    return planningContentHash({
        target: proposal.target,
        operation: proposal.operation,
        beforeSummary: proposal.beforeSummary,
        proposedSummary: proposal.proposedSummary,
        proposedValue: proposal.proposedValue,
        reason: proposal.reason,
        confidence: proposal.confidence,
        reasoningConfidence: proposal.reasoningConfidence,
        evidenceCharacter: proposal.evidenceCharacter,
        ambiguity: proposal.ambiguity,
        questions: proposal.questions,
        evidenceSummary: proposal.evidenceSummary,
        requiredForVerdictAlignment: proposal.requiredForVerdictAlignment,
        contract: contract ? {
            version: contract.version,
            analysisStatus: contract.analysisStatus,
            authoredBy: contract.authoredBy,
            method: contract.method,
            model: contract.model,
            provider: contract.provider,
            baselineSpineVersionId: contract.baselineSpineVersionId,
            baselineSpineContentHash: contract.baselineSpineContentHash,
            decisionEventId: contract.decisionEventId,
            targetValueHash: contract.targetValueHash,
            preservedContentHash: contract.preservedContentHash,
            evidence: contract.evidence,
            maxTouchedTargets: contract.maxTouchedTargets,
            failureReason: contract.failureReason,
            reasoningConfidence: contract.reasoningConfidence,
            evidenceCharacter: contract.evidenceCharacter,
        } : undefined,
    });
}

export function alignmentContextContentHash(event: Extract<DecisionEvent, { type: 'alignment_context_provided' }>): string {
    return planningContentHash({
        id: event.id,
        planningRecordId: event.planningRecordId,
        impactPreviewId: event.impactPreviewId,
        proposalId: event.proposalId,
        requestKind: event.requestKind,
        context: event.context,
        at: event.at,
    });
}
