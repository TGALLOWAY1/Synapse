import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useProjectStore } from '../../store/projectStore';
import { useToastStore } from '../../store/toastStore';
import type { PlanningRecord } from '../../types';
import type { DecisionEvent } from '../../types';
import {
    buildDecisionImpact,
    buildResidualDecisionImpact,
    buildReviewedDecisionImpact,
    isDecisionImpactStale,
    projectDecision,
    reasonAboutComplexPlanningTargets,
    integrateComplexCandidateIntoPreview,
    COMPLEX_TARGET_KINDS,
} from '../../lib/planning';
import { alignmentProposalContentHash } from '../../lib/planning/proposalIntegrity';
import type { DecisionAction } from './DecisionCenter';
import type { AlignmentAnalysisState } from './planningRecordViews';

/**
 * User decision verdicts and their PRD impact flow: appending decision events,
 * building/refreshing impact previews, reviewing and requesting alignment
 * proposals, and applying accepted changes to the working plan through the
 * `compareAndAppendStructuredPRD` write barrier. All verdicts stay
 * `actor: 'user'`; model output remains advisory assessment state.
 */
export function useDecisionImpactActions(params: {
    projectId: string;
    canWrite: boolean;
    planningRecords: PlanningRecord[];
}) {
    const { projectId, canWrite, planningRecords } = params;
    const [alignmentAnalysis, setAlignmentAnalysis] = useState<AlignmentAnalysisState>({});

    const createImpactReview = (recordId: string) => {
        const state = useProjectStore.getState();
        const record = state.planningRecords[projectId]?.find(item => item.id === recordId);
        const spine = state.spineVersions[projectId]?.find(item => item.isLatest);
        if (!record || !spine?.structuredPRD) return undefined;
        const result = buildDecisionImpact({ projectId, record, baselineSpineVersionId: spine.id, structuredPRD: spine.structuredPRD });
        if (!result.ok) return result;
        state.addPlanningAssessment(projectId, recordId, result.assessment);
        return result;
    };

    const handleDecisionAction = (recordId: string, action: DecisionAction, value?: string, rationale?: string) => {
        if (!canWrite) return;
        const record = planningRecords.find(item => item.id === recordId);
        if (!record) return;
        const base = { id: uuidv4(), planningRecordId: recordId, actor: 'user' as const, at: Date.now(), rationale };
        let event: DecisionEvent;
        const projection = projectDecision(record);
        if (action === 'reopen') event = { ...base, type: 'reopened' };
        else if (action === 'defer') event = { ...base, type: 'deferred' };
        else if (action === 'reject') event = { ...base, type: 'premise_rejected', reason: value?.trim() || 'The premise is not valid.' };
        else if (action === 'invalidate') event = { ...base, type: 'invalidated', reason: value?.trim() || 'The decision is no longer valid.' };
        else if (action === 'revise' && projection.latestVerdictEventId) event = {
            ...base, type: 'revised', previousEventId: projection.latestVerdictEventId, answer: value?.trim(),
        };
        else if (action === 'confirm' && value && record.decisionOptions?.some(option => option.id === value)) {
            event = { ...base, type: 'option_selected', optionId: value };
        } else {
            event = { ...base, type: 'custom_answered', answer: value?.trim() || record.statement };
        }
        const result = useProjectStore.getState().appendPlanningDecisionEvent(projectId, recordId, event);
        if (!result.ok) useToastStore.getState().addToast({ type: 'error', title: 'Decision not saved', message: result.reason });
        else if (!['defer', 'reopen', 'invalidate'].includes(action)) {
            const impact = createImpactReview(recordId);
            if (impact && !impact.ok) useToastStore.getState().addToast({
                type: 'info', title: 'Decision saved', message: impact.reason,
            });
        }
    };

    const handlePreviewImpact = (recordId: string) => {
        if (!canWrite) return;
        const result = createImpactReview(recordId);
        if (!result) return;
        if (!result.ok) {
            useToastStore.getState().addToast({ type: 'info', title: 'Impact preview needs more context', message: result.reason });
            return;
        }
    };

    const handleAlignmentProposalReview = (
        recordId: string,
        previewId: string,
        proposalId: string,
        disposition: 'accepted' | 'rejected' | 'edited' | 'deferred' | 'confirmed_aligned' | 'confirmed_not_applicable',
        editedValue?: string,
    ) => {
        if (!canWrite) return;
        const record = useProjectStore.getState().planningRecords[projectId]?.find(item => item.id === recordId);
        const preview = record?.assessments?.find(item => item.impactPreview?.id === previewId)?.impactPreview;
        const proposal = preview?.alignmentProposals?.find(item => item.id === proposalId);
        const result = useProjectStore.getState().appendPlanningDecisionEvent(projectId, recordId, {
            id: uuidv4(), planningRecordId: recordId, type: 'alignment_change_reviewed', actor: 'user',
            impactPreviewId: previewId, proposalId, disposition, at: Date.now(),
            ...(proposal?.contract ? { proposalContentHash: alignmentProposalContentHash(proposal) } : {}),
            ...(disposition === 'edited' ? { editedValue, editedSummary: editedValue } : {}),
        });
        if (!result.ok) useToastStore.getState().addToast({ type: 'error', title: 'Alignment review not saved', message: result.reason });
    };

    const handleRequestAlignmentProposal = async (
        recordId: string,
        previewId: string,
        proposalId: string,
        request: { kind: 'missing_info' | 'different_interpretation'; guidance: string },
    ) => {
        if (!canWrite) throw new Error('This project is read-only.');
        const key = `${recordId}:${previewId}:${proposalId}`;
        setAlignmentAnalysis(current => ({ ...current, [key]: { busy: true } }));
        const fail = (message: string): never => {
            setAlignmentAnalysis(current => ({ ...current, [key]: { busy: false, error: message } }));
            throw new Error(message);
        };

        const initialState = useProjectStore.getState();
        const initialRecord = initialState.planningRecords[projectId]?.find(item => item.id === recordId);
        const initialAssessment = initialRecord?.assessments?.at(-1);
        const initialPreview = initialAssessment?.impactPreview;
        const initialSpine = initialState.spineVersions[projectId]?.find(item => item.isLatest);
        const initialProposal = initialPreview?.alignmentProposals?.find(item => item.id === proposalId);
        const recordAtStart = initialRecord ?? fail('This planning record is no longer current. Refresh the Decision Center.');
        const previewAtStart = initialPreview?.id === previewId
            ? initialPreview
            : fail('This review target is no longer current. Refresh the impact preview.');
        const proposalAtStart = initialProposal ?? fail('This review target is no longer current. Refresh the impact preview.');
        const spineAtStart = initialSpine ?? fail('The current working plan is unavailable.');
        const initialPrd = spineAtStart.structuredPRD ?? fail('The current working plan is unavailable.');
        if (isDecisionImpactStale(previewAtStart, spineAtStart.id, initialPrd)) {
            fail('The working plan changed. Refresh the impact preview before requesting wording.');
        }
        if (!COMPLEX_TARGET_KINDS.includes(proposalAtStart.target.kind as typeof COMPLEX_TARGET_KINDS[number])) {
            fail('This target needs a more precise planning location before Synapse can propose wording.');
        }
        const projection = projectDecision(recordAtStart);
        const causeEvent = recordAtStart.events?.find(event => event.id === previewAtStart.decisionEventId);
        const guidance = request.guidance.trim();
        let recordForReasoning = recordAtStart;
        let guidanceEvidenceId: string | undefined;
        if (guidance) {
            const contextEvent: Extract<DecisionEvent, { type: 'alignment_context_provided' }> = {
                id: uuidv4(), planningRecordId: recordId, type: 'alignment_context_provided', actor: 'user',
                impactPreviewId: previewId, proposalId, requestKind: request.kind, context: guidance, at: Date.now(),
            };
            const saved = useProjectStore.getState().appendPlanningDecisionEvent(projectId, recordId, contextEvent);
            if (!saved.ok) fail(`Your context could not be preserved: ${saved.reason}`);
            guidanceEvidenceId = contextEvent.id;
            recordForReasoning = useProjectStore.getState().planningRecords[projectId]?.find(item => item.id === recordId)
                ?? fail('Your context was saved, but the planning record is no longer available.');
        }
        const result = await reasonAboutComplexPlanningTargets({
            baselineSpineVersionId: spineAtStart.id,
            structuredPRD: initialPrd,
            cause: {
                id: previewAtStart.decisionEventId,
                kind: recordAtStart.sources?.some(source => source.key.startsWith('prd_edit:')) ? 'direct_edit' : 'decision',
                summary: `${recordAtStart.title}: ${recordAtStart.statement}`,
                answer: projection.answer,
                planningRecordId: recordAtStart.id,
                decisionEventId: causeEvent?.id,
                sourceSpineVersionId: spineAtStart.id,
            },
            targets: [{ id: proposalId, location: proposalAtStart.target }],
            requiredEvidenceRefIds: guidanceEvidenceId ? [guidanceEvidenceId] : undefined,
            evidence: [
                ...recordForReasoning.evidence.flatMap(evidence => evidence.excerpt ? [{
                    id: evidence.id,
                    label: evidence.locator?.section ?? 'Planning evidence',
                    sourceType: evidence.sourceType === 'spine' ? 'prd' as const : 'review' as const,
                    sourceId: evidence.sourceId,
                    sourceVersionId: evidence.sourceVersionId,
                    excerpt: evidence.excerpt,
                    location: evidence.locator?.section ? {
                        kind: evidence.locator.entityType === 'feature' ? 'feature' as const : 'claim' as const,
                        section: evidence.locator.section,
                        label: evidence.locator.entityId ?? evidence.locator.section,
                        jsonPath: evidence.locator.jsonPath,
                        entityType: evidence.locator.entityType,
                        entityId: evidence.locator.entityId,
                        excerpt: evidence.excerpt,
                    } : undefined,
                }] : []),
                ...(guidance && guidanceEvidenceId ? [{
                    id: guidanceEvidenceId,
                    label: request.kind === 'different_interpretation' ? 'Your requested interpretation' : 'Your added context',
                    sourceType: 'planning_record' as const,
                    sourceId: recordAtStart.id,
                    sourceVersionId: spineAtStart.id,
                    excerpt: guidance,
                }] : []),
            ],
        });
        const reasoning = result.ok
            ? result
            : fail(result.errors[0] ?? 'Synapse could not produce a trustworthy proposed change.');

        // The model call is outside the store transaction. Re-read every guard
        // before integrating so concurrent edits or verdict changes fail closed.
        const currentState = useProjectStore.getState();
        const currentRecord = currentState.planningRecords[projectId]?.find(item => item.id === recordId);
        const currentAssessment = currentRecord?.assessments?.at(-1);
        const currentPreview = currentAssessment?.impactPreview;
        const currentSpine = currentState.spineVersions[projectId]?.find(item => item.isLatest);
        const recordNow = currentRecord ?? fail('The planning record changed while Synapse was preparing this proposal. Nothing was replaced.');
        const assessmentNow = currentAssessment ?? fail('The impact assessment changed while Synapse was preparing this proposal. Nothing was replaced.');
        const previewNow = currentPreview?.id === previewId
            ? currentPreview
            : fail('The review changed while Synapse was preparing this proposal. Nothing was replaced.');
        const spineNow = currentSpine ?? fail('The working plan changed while Synapse was preparing this proposal. Nothing was replaced.');
        const currentPrd = spineNow.structuredPRD ?? fail('The working plan changed while Synapse was preparing this proposal. Nothing was replaced.');
        if (isDecisionImpactStale(previewNow, spineNow.id, currentPrd)) {
            fail('The working plan changed while Synapse was preparing this proposal. Nothing was replaced.');
        }
        const integrated = integrateComplexCandidateIntoPreview({
            preview: previewNow,
            replaceProposalId: proposalId,
            candidate: reasoning.candidates[0],
            record: recordNow,
            structuredPRD: currentPrd,
            currentSpineVersionId: spineNow.id,
            model: reasoning.model,
            provider: 'gemini',
        });
        const acceptedIntegration = integrated.ok ? integrated : fail(integrated.reason);
        currentState.addPlanningAssessment(projectId, recordId, {
            ...assessmentNow,
            impactPreview: acceptedIntegration.preview,
        });
        setAlignmentAnalysis(current => {
            const next = { ...current };
            delete next[key];
            return next;
        });
    };

    const handleApplyToPlan = (recordId: string) => {
        if (!canWrite) return;
        const state = useProjectStore.getState();
        const record = state.planningRecords[projectId]?.find(item => item.id === recordId);
        const spine = state.spineVersions[projectId]?.find(item => item.isLatest);
        const assessment = record?.assessments?.at(-1);
        const preview = assessment?.impactPreview;
        if (!record || !spine?.structuredPRD || !assessment || !preview || preview.status !== 'ready') return;
        if (isDecisionImpactStale(preview, spine.id, spine.structuredPRD)) {
            state.addPlanningAssessment(projectId, recordId, {
                ...assessment,
                status: 'stale',
                impactPreview: { ...preview, status: 'stale' },
            });
            return;
        }
        const reviewed = buildReviewedDecisionImpact({ record, preview, structuredPRD: spine.structuredPRD });
        if (reviewed.rejectedProposalIds.length > 0) {
            useToastStore.getState().addToast({
                type: 'error',
                title: 'Working plan not updated',
                message: 'One or more accepted changes no longer match the proposal you reviewed. Refresh the impact preview and review them again.',
            });
            return;
        }
        if (!reviewed.nextPrd || reviewed.acceptedProposalIds.length === 0) {
            useToastStore.getState().addToast({ type: 'info', title: 'No accepted changes', message: 'Accept or edit at least one safe proposal before updating the working plan.' });
            return;
        }
        const applied = state.compareAndAppendStructuredPRD(projectId, spine.id, reviewed.nextPrd, {
            editSummary: `Aligned PRD with decision: ${record.title}`,
            expectedPrdHash: preview.baseline.spineContentHash,
            decisionApplication: {
                planningRecordId: record.id,
                decisionEventId: preview.decisionEventId,
                impactPreviewId: preview.id,
                appliedEventId: uuidv4(),
            },
        });
        const current = useProjectStore.getState().planningRecords[projectId]?.find(item => item.id === recordId);
        const currentAssessment = current?.assessments?.find(item => item.id === assessment.id);
        if (currentAssessment) {
            useProjectStore.getState().addPlanningAssessment(projectId, recordId, {
                ...currentAssessment,
                status: applied.status === 'applied' ? 'fresh' : 'stale',
                impactPreview: {
                    ...preview,
                    status: applied.status === 'applied' ? 'applied' : 'stale',
                    ...(applied.status === 'applied' ? { appliedAt: Date.now(), resultingSpineVersionId: applied.newSpineId } : {}),
                },
            });
        }
        const residual = applied.status === 'applied' && applied.newSpineId
            ? buildResidualDecisionImpact({
                record: current ?? record,
                preview,
                structuredPRD: reviewed.nextPrd,
                baselineSpineVersionId: applied.newSpineId,
                appliedProposalIds: reviewed.acceptedProposalIds,
            })
            : undefined;
        if (residual) {
            useProjectStore.getState().addPlanningAssessment(projectId, recordId, residual.assessment);
        }
        useToastStore.getState().addToast(applied.status === 'applied'
            ? { type: 'success', title: 'Working plan updated', message: residual
                ? `${residual.preview.alignmentProposals?.length ?? 0} alignment review${residual.preview.alignmentProposals?.length === 1 ? '' : 's'} remain. Nothing else was rewritten.`
                : 'Accepted changes created a new PRD version. Nothing else was rewritten.' }
            : { type: 'info', title: 'Preview is stale', message: 'Refresh the impact preview before recording this decision in the PRD.' });
    };

    return {
        alignmentAnalysis,
        handleDecisionAction,
        handlePreviewImpact,
        handleAlignmentProposalReview,
        handleRequestAlignmentProposal,
        handleApplyToPlan,
    };
}
