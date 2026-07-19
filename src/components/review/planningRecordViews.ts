import type { PlanningRecord, SpineVersion } from '../../types';
import {
    alignmentProposalReviews,
    isDecisionImpactStale,
    projectDecision,
    COMPLEX_TARGET_KINDS,
    assumptionEvidenceSetHash,
    assumptionStatementHash,
    assumptionValidationReadiness,
    planningContentHash,
    projectAssumptionValidation,
} from '../../lib/planning';
import type { PlanningRecordView } from './ReviewWorkspace';

/** Per-proposal wording-analysis UI state keyed by `${recordId}:${previewId}:${proposalId}`. */
export type AlignmentAnalysisState = Record<string, { busy: boolean; error?: string }>;

export const buildPlanningRecordViews = (params: {
    planningRecords: PlanningRecord[];
    latestSpine: SpineVersion | undefined;
    alignmentAnalysis: AlignmentAnalysisState;
    /** Live option-suggestion state per record id (useDecisionOptionSuggestions). */
    optionSuggestions?: Record<string, { busy: boolean; error?: string }>;
}): PlanningRecordView[] => {
    const { planningRecords, latestSpine, alignmentAnalysis, optionSuggestions } = params;
    return planningRecords.map(record => {
        const projection = projectDecision(record);
        const validationProjection = record.type === 'assumption' ? projectAssumptionValidation(record) : undefined;
        const currentSpineContentHash = latestSpine
            ? planningContentHash(latestSpine.structuredPRD ?? latestSpine.responseText)
            : undefined;
        const evidenceSetHash = validationProjection
            ? assumptionEvidenceSetHash(validationProjection.activeEvidence)
            : undefined;
        const latestPlanProposal = [...(record.assumptionValidation?.planProposals ?? [])].reverse().find(proposal => (
            proposal.assumptionStatementHash === assumptionStatementHash(record)
            && proposal.evidenceSetHash === evidenceSetHash
            && (!proposal.sourceSpineVersionId || (
                proposal.sourceSpineVersionId === latestSpine?.id
                && proposal.sourceSpineContentHash === currentSpineContentHash
            ))
        ));
        const latestInterpretation = [...(record.assumptionValidation?.interpretationProposals ?? [])].reverse().find(proposal => (
            proposal.assumptionStatementHash === assumptionStatementHash(record)
            && proposal.validationPlanHash === validationProjection?.currentPlan?.contentHash
            && proposal.evidenceSetHash === evidenceSetHash
            && (!proposal.sourceSpineVersionId || (
                proposal.sourceSpineVersionId === latestSpine?.id
                && proposal.sourceSpineContentHash === currentSpineContentHash
            ))
        ));
        const assessment = record.assessments?.at(-1);
        const storedPreview = assessment?.impactPreview;
        const previewStale = storedPreview && latestSpine?.structuredPRD
            ? isDecisionImpactStale(storedPreview, latestSpine.id, latestSpine.structuredPRD)
                || storedPreview.decisionEventId !== projection.latestVerdictEventId
            : false;
        const option = record.decisionOptions?.find(item => item.id === projection.selectedOptionId);
        const proposalReviews = storedPreview ? alignmentProposalReviews(record, storedPreview) : [];
        return {
            id: record.id,
            type: record.type === 'open_question' ? 'question' : record.type,
            title: record.title,
            statement: record.statement,
            whyItMatters: record.whyItMatters ?? record.evidence[0]?.excerpt,
            status: projection.status,
            materiality: record.materiality,
            requiresValidation: record.type === 'assumption'
                && (record.materiality === undefined || record.materiality === 'blocking' || record.materiality === 'high')
                && !assumptionValidationReadiness(record, Date.now(), {
                    currentSpineVersionId: latestSpine?.id,
                    currentSpineContentHash,
                }).ready,
            options: record.decisionOptions,
            optionsSuggestion: optionSuggestions?.[record.id],
            recommendation: record.recommendationDetail ?? (record.recommendation ? { summary: record.recommendation } : undefined),
            resolution: option?.label ?? projection.answer,
            rationale: projection.rationale,
            sourceLabels: (record.sources ?? []).map(source => source.sourceType === 'prd_assumption'
                ? 'PRD assumption'
                : source.sourceType.replaceAll('_', ' ')),
            sourceNotice: record.sourceState === 'changed'
                ? `The source assumption changed to: ${record.currentSourceStatement}. Review this decision before relying on it.`
                : record.sourceState === 'missing'
                    ? 'The source assumption is no longer present in the current PRD. Review whether this decision is still valid.'
                    : undefined,
            sourceIssueIds: record.sourceReviewIssueId ? [record.sourceReviewIssueId] : [],
            createdAt: record.createdAt,
            history: (record.events ?? []).map(event => ({
                id: event.id,
                label: event.type.replaceAll('_', ' '),
                at: event.at,
                rationale: event.rationale,
            })),
            validation: validationProjection ? {
                workflowState: validationProjection.workflowState,
                currentPlan: validationProjection.currentPlan,
                latestPlanProposal,
                activeEvidence: validationProjection.activeEvidence,
                duplicateEvidenceIds: validationProjection.duplicateEvidenceIds,
                evidenceFromAnotherQuestionIds: validationProjection.evidenceFromAnotherQuestionIds,
                latestInterpretation,
                acceptedConclusion: validationProjection.acceptedConclusion,
                conclusionIsCurrent: validationProjection.conclusionIsCurrent,
                userTreatment: validationProjection.userTreatment,
                treatmentRationale: validationProjection.treatmentRationale,
                revisitAt: validationProjection.revisitAt,
                revisitCondition: validationProjection.revisitCondition,
                hasHistoricalValidation: validationProjection.hasHistoricalValidation,
                dependentLabels: [...new Set([
                    ...(record.affectedPrdSections ?? []),
                    ...(record.affectedArtifactSlots ?? []).map(slot => slot.replaceAll('_', ' ')),
                    ...(record.affectedPlanLocations ?? []).map(location => location.label),
                ])],
                history: (record.assumptionValidation?.events ?? []).map(event => ({
                    id: event.id,
                    label: event.type === 'validation_plan_recorded' ? 'Validation plan recorded'
                        : event.type === 'validation_evidence_recorded' ? 'Evidence recorded'
                            : event.type === 'validation_evidence_retracted' ? 'Evidence retracted'
                                : event.type === 'validation_outcome_recorded' ? `Conclusion: ${event.conclusion.replaceAll('_', ' ')}`
                                    : event.type === 'validation_outcome_reopened' ? 'Conclusion reopened'
                                        : `Uncertainty ${event.treatment.replaceAll('_', ' ')}`,
                    at: event.at,
                    detail: event.type === 'validation_outcome_recorded' ? event.caveats
                        : event.type === 'validation_evidence_recorded' ? event.evidence.source
                            : event.type === 'validation_uncertainty_treatment_recorded' ? event.rationale
                                : event.type === 'validation_evidence_retracted' || event.type === 'validation_outcome_reopened' ? event.reason
                                    : undefined,
                })),
                evidenceSetHash,
                sourceSpineVersionId: latestSpine?.id,
                sourceSpineContentHash: currentSpineContentHash,
            } : undefined,
            preview: storedPreview ? {
                id: storedPreview.id,
                status: previewStale ? 'stale' : storedPreview.status,
                affectedPrdSections: storedPreview.affectedPrdSections,
                affectedArtifactLabels: storedPreview.affectedArtifactSlots.map(slot => slot.replaceAll('_', ' ')),
                beforeSummary: storedPreview.proposedPrdPatch?.[0]?.beforeSummary,
                afterSummary: storedPreview.proposedPrdPatch?.[0]?.afterSummary,
                explanation: storedPreview.explanation,
                error: storedPreview.error,
                proposals: proposalReviews.map(review => ({
                    id: review.proposal.id,
                    targetLabel: review.proposal.target.label,
                    targetKind: review.proposal.target.kind,
                    section: review.proposal.target.section,
                    beforeSummary: review.proposal.beforeSummary,
                    proposedSummary: review.proposal.proposedSummary,
                    reason: review.proposal.reason,
                    confidence: review.proposal.confidence,
                    reasoningConfidence: review.proposal.reasoningConfidence ?? review.proposal.contract?.reasoningConfidence,
                    evidenceCharacter: review.proposal.evidenceCharacter ?? review.proposal.contract?.evidenceCharacter,
                    requiresInput: review.proposal.requiresInput,
                    requiredForVerdictAlignment: review.proposal.requiredForVerdictAlignment,
                    canEditWording: typeof review.proposal.proposedValue === 'string'
                        || (Array.isArray(review.proposal.proposedValue) && review.proposal.proposedValue.every(item => typeof item === 'string'))
                        || review.proposal.target.entityType === 'assumption',
                    canRequestReasoning: !['accepted', 'edited'].includes(review.disposition)
                        && COMPLEX_TARGET_KINDS.includes(review.proposal.target.kind as typeof COMPLEX_TARGET_KINDS[number])
                        && Boolean(review.proposal.target.jsonPath)
                        && review.proposal.target.jsonPath !== '$.architecture',
                    analysisStatus: review.proposal.contract?.analysisStatus,
                    analysisMethod: review.proposal.contract?.method,
                    analysisModel: review.proposal.contract?.model,
                    analysisProvider: review.proposal.contract?.provider,
                    analysisFailureReason: review.proposal.contract?.failureReason,
                    analysisAmbiguity: review.proposal.ambiguity,
                    analysisQuestions: review.proposal.questions,
                    analysisEvidence: review.proposal.evidenceSummary?.map(summary => {
                        const separator = summary.indexOf(': ');
                        return separator > 0
                            ? { label: summary.slice(0, separator), excerpt: summary.slice(separator + 2) }
                            : { label: 'Planning evidence', excerpt: summary };
                    }),
                    analysisBusy: alignmentAnalysis[`${record.id}:${storedPreview.id}:${review.proposal.id}`]?.busy,
                    analysisError: alignmentAnalysis[`${record.id}:${storedPreview.id}:${review.proposal.id}`]?.error,
                    disposition: review.disposition,
                    editedSummary: review.editedSummary,
                })),
                canApply: proposalReviews.some(review =>
                    ['accepted', 'edited'].includes(review.disposition)
                    && !review.proposal.requiresInput
                    && (storedPreview.proposalContractVersion !== 1 || review.proposal.contract?.analysisStatus === 'bounded_applicable')
                    && storedPreview.proposedPrdPatch?.some(patch => patch.proposalId === review.proposal.id),
                ),
            } : undefined,
        };
    });
};
