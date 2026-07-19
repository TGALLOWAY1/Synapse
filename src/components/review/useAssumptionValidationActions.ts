import { v4 as uuidv4 } from 'uuid';
import { useProjectStore } from '../../store/projectStore';
import { useToastStore } from '../../store/toastStore';
import type { AssumptionEvidenceConclusion, AssumptionUncertaintyTreatment } from '../../types';
import {
    assumptionEvidenceSetHash,
    assumptionStatementHash,
    buildAssumptionInterpretationProposal,
    buildAssumptionValidationPlanProposal,
    planningContentHash,
    projectAssumptionValidation,
    sealAssumptionEvidence,
    sealAssumptionValidationEvent,
    sealAssumptionValidationPlan,
} from '../../lib/planning';
import type {
    AssumptionEvidenceActionGuard,
    AssumptionEvidenceCorrectionInput,
    AssumptionEvidenceInput,
    AssumptionValidationPlanInput,
} from './AssumptionValidationPanel';

/**
 * User-authored assumption validation: recording validation plans, evidence,
 * interpretations, outcomes, uncertainty treatments, and reopening. Every
 * write is a sealed append-only assumption-validation event; Synapse-authored
 * proposals stay advisory and separate from user conclusions.
 */
export function useAssumptionValidationActions(params: { projectId: string; canWrite: boolean }) {
    const { projectId, canWrite } = params;

    const currentAssumptionContext = (recordId: string) => {
        const state = useProjectStore.getState();
        const record = state.planningRecords[projectId]?.find(item => item.id === recordId);
        const spine = state.spineVersions[projectId]?.find(item => item.isLatest)
            ?? state.spineVersions[projectId]?.at(-1);
        return {
            state,
            record,
            spine,
            spineContentHash: spine ? planningContentHash(spine.structuredPRD ?? spine.responseText) : undefined,
        };
    };

    const showValidationError = (title: string, reason: string) => {
        useToastStore.getState().addToast({ type: 'error', title, message: reason });
    };

    const handleGenerateAssumptionValidationPlan = (recordId: string) => {
        if (!canWrite) return;
        const { state, record, spine, spineContentHash } = currentAssumptionContext(recordId);
        if (!record || record.type !== 'assumption') return;
        const technical = record.affectedPrdSections?.some(section => /architecture|technical|constraint/i.test(section));
        const proposal = buildAssumptionValidationPlanProposal({
            record,
            question: `What observable result would show that “${record.statement}” is reliable enough to plan around?`,
            method: technical
                ? { kind: 'technical_test', label: 'Small technical test' }
                : { kind: 'user_interviews', label: 'Focused user interviews' },
            supportSignals: ['A directly observed result answers the validation question in the expected direction.'],
            contradictionSignals: ['A directly observed result shows the assumption does not hold in the relevant context.'],
            inconclusiveConditions: ['The source does not answer this exact question or the scope is too narrow to guide the plan.'],
            limitations: ['One method can reduce uncertainty without proving the assumption in every context.'],
            revisitCondition: 'New contradictory evidence appears or the dependent plan changes.',
            sourceSpineVersionId: spine?.id,
            sourceSpineContentHash: spineContentHash,
            model: 'bounded-validation-plan-v1',
            provider: 'synapse',
        });
        const result = state.addAssumptionValidationPlanProposal(projectId, recordId, proposal);
        if (!result.ok) showValidationError('Validation plan not prepared', result.reason);
    };

    const handleRecordAssumptionValidationPlan = (recordId: string, input: AssumptionValidationPlanInput) => {
        if (!canWrite) return;
        const { state, record, spine, spineContentHash } = currentAssumptionContext(recordId);
        if (!record || record.type !== 'assumption') return;
        const at = Date.now();
        const projection = projectAssumptionValidation(record, at);
        const plan = sealAssumptionValidationPlan({
            id: uuidv4(),
            question: input.question,
            method: { kind: input.methodKind, label: input.methodLabel },
            supportSignals: input.supportSignals,
            contradictionSignals: input.contradictionSignals,
            inconclusiveConditions: input.inconclusiveConditions,
            limitations: input.limitations,
            revisitCondition: input.revisitCondition,
            expiresAt: input.expiresAt,
            authoredBy: 'user',
            createdAt: at,
        });
        const event = sealAssumptionValidationEvent({
            id: uuidv4(), planningRecordId: recordId, type: 'validation_plan_recorded', actor: 'user', at,
            assumptionStatementHash: assumptionStatementHash(record),
            expectedSpineVersionId: spine?.id,
            expectedSpineContentHash: spineContentHash,
            expectedEvidenceSetHash: assumptionEvidenceSetHash(projection.activeEvidence),
            plan,
            sourceProposalId: input.sourceProposalId,
            sourceProposalContentHash: input.sourceProposalContentHash,
        });
        const result = state.appendAssumptionValidationEvent(projectId, recordId, event);
        if (!result.ok) showValidationError('Validation plan not saved', result.reason);
        else useToastStore.getState().addToast({ type: 'success', title: 'Validation plan recorded', message: 'This user-authored plan now defines what evidence belongs to the assumption.' });
    };

    const handleAddAssumptionEvidence = (recordId: string, input: AssumptionEvidenceInput) => {
        if (!canWrite) return;
        const { state, record, spine, spineContentHash } = currentAssumptionContext(recordId);
        if (!record || record.type !== 'assumption') return;
        const at = Date.now();
        const projection = projectAssumptionValidation(record, at);
        if (!projection.currentPlan) {
            showValidationError('Evidence not saved', 'Record a validation plan before adding evidence.');
            return;
        }
        const evidence = sealAssumptionEvidence({
            id: uuidv4(), planningRecordId: recordId,
            sourceType: input.sourceType, source: input.source, sourceIdentity: input.sourceIdentity,
            observedAt: input.observedAt, recordedAt: at, observation: input.observation,
            validationQuestion: projection.currentPlan.question,
            scopeOrSample: input.scopeOrSample, limitations: input.limitations,
            character: input.character, relation: input.relation,
            assumptionStatementHash: assumptionStatementHash(record),
            validationPlanHash: projection.currentPlan.contentHash,
            authoredBy: 'user',
        });
        const event = sealAssumptionValidationEvent({
            id: uuidv4(), planningRecordId: recordId, type: 'validation_evidence_recorded', actor: 'user', at,
            assumptionStatementHash: assumptionStatementHash(record),
            expectedSpineVersionId: spine?.id,
            expectedSpineContentHash: spineContentHash,
            expectedEvidenceSetHash: assumptionEvidenceSetHash(projection.activeEvidence),
            evidence,
        });
        const result = state.appendAssumptionValidationEvent(projectId, recordId, event);
        if (!result.ok) showValidationError('Evidence not saved', result.reason);
        else if (result.duplicateEvidenceOf) useToastStore.getState().addToast({ type: 'info', title: 'Duplicate source preserved', message: 'This record is visible, but will not count as independent corroboration.' });
        else useToastStore.getState().addToast({ type: 'success', title: 'Evidence recorded', message: 'The observation remains separate from any interpretation or conclusion.' });
    };

    const handleRetractAssumptionEvidence = (recordId: string, input: AssumptionEvidenceActionGuard) => {
        if (!canWrite) return;
        const result = useProjectStore.getState().retractAssumptionEvidence(projectId, recordId, input);
        if (!result.ok) showValidationError('Evidence not retracted', result.reason);
        else useToastStore.getState().addToast({
            type: 'success', title: 'Evidence retracted',
            message: 'The original remains in history. Prior interpretations and conclusions now need review.',
        });
    };

    const handleCorrectAssumptionEvidence = (recordId: string, input: AssumptionEvidenceCorrectionInput) => {
        if (!canWrite) return;
        const result = useProjectStore.getState().correctAssumptionEvidence(projectId, recordId, input);
        if (!result.ok) showValidationError('Evidence not corrected', result.reason);
        else useToastStore.getState().addToast({
            type: 'success', title: 'Evidence corrected',
            message: 'The replacement is current, the original remains in history, and the conclusion needs review.',
        });
    };

    const handleInterpretAssumptionEvidence = (recordId: string) => {
        if (!canWrite) return;
        const { state, record, spine, spineContentHash } = currentAssumptionContext(recordId);
        if (!record || record.type !== 'assumption') return;
        const projection = projectAssumptionValidation(record);
        if (!projection.currentPlan || projection.activeEvidence.length === 0) {
            showValidationError('Interpretation unavailable', 'Record a current validation plan and at least one evidence source first.');
            return;
        }
        const relations = new Set(projection.independentEvidence.map(item => item.relation));
        const proposal = buildAssumptionInterpretationProposal({
            record,
            reasoning: relations.has('supports') && relations.has('contradicts')
                ? 'Current independent evidence points in conflicting directions, so the assumption should remain inconclusive unless the user records a more qualified outcome.'
                : `Synapse compared ${projection.independentEvidence.length} independent source${projection.independentEvidence.length === 1 ? '' : 's'} with the validation question and excluded duplicate sources from corroboration.`,
            limitations: [
                'This interpretation summarizes user-recorded evidence relationships; it does not verify that a source is truthful or representative.',
                ...(projection.activeEvidence.some(item => item.character === 'interpretation') ? ['Some records are interpretations rather than direct observations.'] : []),
            ],
            sourceSpineVersionId: spine?.id,
            sourceSpineContentHash: spineContentHash,
            model: 'bounded-evidence-interpretation-v1',
            provider: 'synapse',
        });
        const result = state.addAssumptionInterpretationProposal(projectId, recordId, proposal);
        if (!result.ok) showValidationError('Interpretation not prepared', result.reason);
    };

    const handleRecordAssumptionOutcome = (recordId: string, input: {
        conclusion: AssumptionEvidenceConclusion;
        caveats?: string;
        revisitAt?: number;
        revisitCondition?: string;
        sourceInterpretationId?: string;
        sourceInterpretationContentHash?: string;
    }) => {
        if (!canWrite) return;
        const { state, record, spine, spineContentHash } = currentAssumptionContext(recordId);
        if (!record || record.type !== 'assumption') return;
        const at = Date.now();
        const projection = projectAssumptionValidation(record, at);
        if (!projection.currentPlan) return;
        const event = sealAssumptionValidationEvent({
            id: uuidv4(), planningRecordId: recordId, type: 'validation_outcome_recorded', actor: 'user', at,
            assumptionStatementHash: assumptionStatementHash(record),
            expectedSpineVersionId: spine?.id,
            expectedSpineContentHash: spineContentHash,
            conclusion: input.conclusion,
            caveats: input.caveats,
            expectedValidationPlanHash: projection.currentPlan.contentHash,
            expectedEvidenceSetHash: assumptionEvidenceSetHash(projection.activeEvidence),
            sourceInterpretationId: input.sourceInterpretationId,
            sourceInterpretationContentHash: input.sourceInterpretationContentHash,
            revisitAt: input.revisitAt,
            revisitCondition: input.revisitCondition,
        });
        const result = state.appendAssumptionValidationEvent(projectId, recordId, event);
        if (!result.ok) showValidationError('Conclusion not saved', result.reason);
        else useToastStore.getState().addToast({ type: 'success', title: 'Your conclusion was recorded', message: 'Synapse’s interpretation remains advisory and separate in history.' });
    };

    const handleRecordAssumptionTreatment = (recordId: string, input: {
        treatment: AssumptionUncertaintyTreatment;
        rationale: string;
        revisitAt?: number;
        revisitCondition?: string;
    }) => {
        if (!canWrite) return;
        const { state, record, spine, spineContentHash } = currentAssumptionContext(recordId);
        if (!record || record.type !== 'assumption') return;
        const at = Date.now();
        const projection = projectAssumptionValidation(record, at);
        const event = sealAssumptionValidationEvent({
            id: uuidv4(), planningRecordId: recordId, type: 'validation_uncertainty_treatment_recorded', actor: 'user', at,
            assumptionStatementHash: assumptionStatementHash(record),
            expectedSpineVersionId: spine?.id,
            expectedSpineContentHash: spineContentHash,
            expectedEvidenceSetHash: assumptionEvidenceSetHash(projection.activeEvidence),
            treatment: input.treatment,
            rationale: input.rationale,
            revisitAt: input.revisitAt,
            revisitCondition: input.revisitCondition,
        });
        const result = state.appendAssumptionValidationEvent(projectId, recordId, event);
        if (!result.ok) showValidationError('Uncertainty treatment not saved', result.reason);
        else useToastStore.getState().addToast({ type: 'info', title: 'Unresolved uncertainty recorded', message: 'The assumption remains unvalidated.' });
    };

    const handleReopenAssumptionOutcome = (recordId: string, reason: string) => {
        if (!canWrite || !reason.trim()) return;
        const { state, record, spine, spineContentHash } = currentAssumptionContext(recordId);
        if (!record || record.type !== 'assumption') return;
        const at = Date.now();
        const projection = projectAssumptionValidation(record, at);
        if (!projection.latestOutcomeEventId || !projection.currentPlan) return;
        const event = sealAssumptionValidationEvent({
            id: uuidv4(), planningRecordId: recordId, type: 'validation_outcome_reopened', actor: 'user', at,
            assumptionStatementHash: assumptionStatementHash(record),
            expectedSpineVersionId: spine?.id,
            expectedSpineContentHash: spineContentHash,
            previousOutcomeEventId: projection.latestOutcomeEventId,
            reason: reason.trim(),
            expectedValidationPlanHash: projection.currentPlan.contentHash,
            expectedEvidenceSetHash: assumptionEvidenceSetHash(projection.activeEvidence),
        });
        const result = state.appendAssumptionValidationEvent(projectId, recordId, event);
        if (!result.ok) showValidationError('Conclusion not reopened', result.reason);
        else useToastStore.getState().addToast({ type: 'info', title: 'Conclusion reopened', message: 'The earlier outcome remains in history while this assumption returns to active review.' });
    };

    return {
        handleGenerateAssumptionValidationPlan,
        handleRecordAssumptionValidationPlan,
        handleAddAssumptionEvidence,
        handleRetractAssumptionEvidence,
        handleCorrectAssumptionEvidence,
        handleInterpretAssumptionEvidence,
        handleRecordAssumptionOutcome,
        handleRecordAssumptionTreatment,
        handleReopenAssumptionOutcome,
    };
}
