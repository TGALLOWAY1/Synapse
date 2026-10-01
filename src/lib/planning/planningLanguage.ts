import type {
    AssumptionEvidenceConclusion,
    AssumptionUncertaintyTreatment,
    AssumptionValidationWorkflowState,
    HistoryEventType,
    PlanningRecordStatus,
    PlanningRecordType,
} from '../../types';
import type { DownstreamArtifactUpdateReviewAction } from './downstreamArtifactUpdateProposal';
import type { DownstreamVerificationOutcome } from './downstreamArtifactUpdateVerification';
import type { DownstreamImpactCertainty, DownstreamUpdateDisposition } from './downstreamUpdatePlan';
import type { OutputAlignmentState } from './outputAlignment';

export type PlanningLanguageEntry = {
    label: string;
    detail?: string;
};

export type PlanningRecordDominantCondition =
    | 'needs_decision'
    | 'worth_validating'
    | 'needs_alignment'
    | 'accepted_without_validation'
    | 'resolved'
    | 'rejected'
    | 'deferred'
    | 'invalidated'
    | 'superseded';

const planningRecordLanguage = {
    needs_decision: { label: 'Needs your decision' },
    worth_validating: { label: 'Worth validating' },
    needs_alignment: { label: 'Needs alignment' },
    accepted_without_validation: { label: 'Accepted without validation' },
    resolved: { label: 'Resolved' },
    rejected: { label: 'Marked incorrect' },
    deferred: { label: 'Deferred' },
    invalidated: { label: 'Needs a new decision' },
    superseded: { label: 'Replaced' },
} satisfies Record<PlanningRecordDominantCondition, PlanningLanguageEntry>;

export function planningRecordDominantCondition(input: {
    type: PlanningRecordType;
    status: PlanningRecordStatus;
    requiresValidation?: boolean;
    hasCurrentEvidenceConclusion?: boolean;
    needsAlignment?: boolean;
}): PlanningRecordDominantCondition {
    if (input.status === 'invalidated') return 'invalidated';
    if (input.status === 'superseded') return 'superseded';
    if (input.status === 'deferred') return 'deferred';
    if (input.status === 'rejected') return 'rejected';
    if (input.status === 'open' || input.status === 'proposed') {
        return input.type === 'assumption' ? 'worth_validating' : 'needs_decision';
    }
    if (input.type === 'assumption' && input.requiresValidation && !input.hasCurrentEvidenceConclusion) {
        return 'worth_validating';
    }
    if (input.needsAlignment) return 'needs_alignment';
    if (input.type === 'assumption' && !input.hasCurrentEvidenceConclusion) {
        return 'accepted_without_validation';
    }
    return 'resolved';
}

export function planningRecordCopy(condition: PlanningRecordDominantCondition): PlanningLanguageEntry {
    return planningRecordLanguage[condition];
}

const assumptionWorkflowLanguage = {
    not_planned: { label: 'Not planned' },
    planned: { label: 'Validation planned' },
    in_progress: { label: 'Gathering evidence' },
    completed: { label: 'Conclusion recorded' },
    due_for_review: { label: 'Needs a fresh review' },
} satisfies Record<AssumptionValidationWorkflowState, PlanningLanguageEntry>;

export function assumptionWorkflowCopy(state: AssumptionValidationWorkflowState): PlanningLanguageEntry {
    return assumptionWorkflowLanguage[state];
}

const assumptionEvidenceLanguage = {
    unsupported: { label: 'Not supported by current evidence' },
    supported: { label: 'Supported by current evidence' },
    partially_supported: { label: 'Partly supported by current evidence' },
    contradicted: { label: 'Contradicted by current evidence' },
    inconclusive: { label: 'Inconclusive' },
    more_evidence_needed: { label: 'More evidence needed' },
} satisfies Record<AssumptionEvidenceConclusion, PlanningLanguageEntry>;

export function assumptionEvidenceCopy(conclusion: AssumptionEvidenceConclusion): PlanningLanguageEntry {
    return assumptionEvidenceLanguage[conclusion];
}

const assumptionTreatmentLanguage = {
    accepted_without_validation: { label: 'Proceeding without validation' },
    temporarily_tolerated: { label: 'Accepted for now' },
    deferred: { label: 'Deferred' },
} satisfies Record<AssumptionUncertaintyTreatment, PlanningLanguageEntry>;

export function assumptionTreatmentCopy(treatment: AssumptionUncertaintyTreatment): PlanningLanguageEntry {
    return assumptionTreatmentLanguage[treatment];
}

const outputAlignmentLanguage = {
    aligned: { label: 'Up to date', detail: 'This output reflects the current working plan.' },
    possibly_affected: {
        label: 'Review recommended',
        detail: 'The change may matter here, but no mismatch has been proven.',
    },
    stale: {
        label: 'Update required',
        detail: 'Durable project evidence establishes a mismatch.',
    },
} satisfies Record<OutputAlignmentState, PlanningLanguageEntry>;

export function outputAlignmentCopy(state: OutputAlignmentState): PlanningLanguageEntry {
    return outputAlignmentLanguage[state];
}

const downstreamImpactLanguage = {
    definite: { label: 'Update required', detail: 'Durable project evidence establishes a mismatch.' },
    likely: { label: 'Likely impact', detail: 'Strong dependency evidence suggests this region needs attention.' },
    possible: { label: 'Review recommended', detail: 'The change is relevant, but it does not prove this output is wrong.' },
} satisfies Record<DownstreamImpactCertainty, PlanningLanguageEntry>;

export function downstreamImpactCopy(certainty: DownstreamImpactCertainty): PlanningLanguageEntry {
    return downstreamImpactLanguage[certainty];
}

const downstreamDispositionLanguage = {
    planned: { label: 'Planned' },
    deferred: { label: 'Deferred' },
    not_applicable: { label: 'Not applicable' },
    already_aligned: { label: 'Already up to date' },
} satisfies Record<DownstreamUpdateDisposition, PlanningLanguageEntry>;

export function downstreamDispositionCopy(disposition: DownstreamUpdateDisposition): PlanningLanguageEntry {
    return downstreamDispositionLanguage[disposition];
}

export type ProposalLifecycleCondition =
    | 'preparing'
    | 'ready'
    | 'review_only'
    | 'no_longer_current'
    | 'change_applied';

const proposalLifecycleLanguage = {
    preparing: { label: 'Preparing proposed change' },
    ready: { label: 'Proposed change' },
    review_only: { label: 'Review only' },
    no_longer_current: { label: 'No longer current' },
    change_applied: {
        label: 'Change applied',
        detail: 'The output changed, but alignment still needs to be verified.',
    },
} satisfies Record<ProposalLifecycleCondition, PlanningLanguageEntry>;

export function proposalLifecycleCopy(condition: ProposalLifecycleCondition): PlanningLanguageEntry {
    return proposalLifecycleLanguage[condition];
}

const proposalReviewActionLanguage = {
    accepted: { label: 'Proposal accepted' },
    edited: { label: 'Edited proposal accepted' },
    rejected: { label: 'Proposal rejected' },
    preserved: { label: 'Current content preserved' },
    deferred: { label: 'Proposal deferred' },
    requested_another: { label: 'Another proposal requested' },
    provided_context: { label: 'Context added' },
} satisfies Record<DownstreamArtifactUpdateReviewAction, PlanningLanguageEntry>;

export function proposalReviewActionCopy(action: DownstreamArtifactUpdateReviewAction): PlanningLanguageEntry {
    return proposalReviewActionLanguage[action];
}

const downstreamVerificationLanguage = {
    aligned: { label: 'Alignment verified' },
    review_recommended: { label: 'Review recommended' },
    update_still_required: { label: 'Update still required' },
    verification_unavailable: { label: 'Could not verify alignment' },
} satisfies Record<DownstreamVerificationOutcome, PlanningLanguageEntry>;

export function downstreamVerificationCopy(outcome: DownstreamVerificationOutcome): PlanningLanguageEntry {
    return downstreamVerificationLanguage[outcome];
}

const historyEventLanguage = {
    Init: { label: 'Project created' },
    Regenerated: { label: 'Working plan regenerated' },
    Consolidated: { label: 'Changes consolidated' },
    ArtifactGenerated: { label: 'Output generated' },
    ArtifactRegenerated: { label: 'Output regenerated' },
    FeedbackCreated: { label: 'Feedback added' },
    FeedbackApplied: { label: 'Feedback applied' },
    GenerationFailed: { label: 'Generation failed' },
    Edited: { label: 'Content edited' },
    Reverted: { label: 'Earlier version restored' },
    MarkedCurrent: { label: 'Output confirmed up to date' },
    ValidationIssueAccepted: { label: 'Validation issue accepted' },
    // Legacy: written only by the removed Finalize/readiness checkpoint. Older
    // projects still carry these events, so they keep a plain timeline label.
    ReadinessReviewed: { label: 'Readiness reviewed' },
    PlanCommitted: { label: 'Plan committed' },
    PlanReopened: { label: 'Plan reopened' },
} satisfies Record<HistoryEventType, PlanningLanguageEntry>;

export function historyEventCopy(type: HistoryEventType): PlanningLanguageEntry {
    return historyEventLanguage[type];
}
