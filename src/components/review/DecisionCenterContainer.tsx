import { useEffect, useRef } from 'react';
import { canPerformProjectAction } from '../../lib/projectCapabilities';
import { projectDecision } from '../../lib/planning/decisionProjection';
import { useProjectStore } from '../../store/projectStore';
import { DecisionCenter } from './DecisionCenter';
import { buildPlanningRecordViews } from './planningRecordViews';
import { useAssumptionValidationActions } from './useAssumptionValidationActions';
import { useBatchVerdictCoordinator } from './useBatchVerdictCoordinator';
import { useDecisionImpactActions } from './useDecisionImpactActions';
import { useDecisionOptionSuggestions } from './useDecisionOptionSuggestions';

interface DecisionCenterContainerProps {
    projectId: string;
    initialRecordId?: string;
    /** Jumps to the existing Explore/Build surface. Open decisions remain
     * advisory and never disable this action. */
    onContinueToExplore?: () => void;
}

const EMPTY_PROJECT_COLLECTION: never[] = [];
const MAX_EAGER_OPTION_PREPARATIONS = 6;

/**
 * Store-backed Decision Center controller that can be mounted independently
 * from specialist critique. The slide-over and any future embedded surface use
 * this one authority-preserving action path.
 */
export function DecisionCenterContainer({
    projectId,
    initialRecordId,
    onContinueToExplore,
}: DecisionCenterContainerProps) {
    const project = useProjectStore(state => state.projects[projectId]);
    const spines = useProjectStore(
        state => state.spineVersions[projectId] ?? EMPTY_PROJECT_COLLECTION,
    );
    const planningRecords = useProjectStore(
        state => state.planningRecords[projectId] ?? EMPTY_PROJECT_COLLECTION,
    );
    const canWrite = canPerformProjectAction(projectId, 'persist');
    const latestSpine = spines.find(spine => spine.isLatest);
    const { optionSuggestions, prepareDecisionOptions } = useDecisionOptionSuggestions({
        projectId,
        canWrite,
    });

    // Bound eager preparation to one small batch per mount. Opening a record
    // beyond the batch still prepares its options through DecisionCenter's
    // selected-record effect.
    const eagerPreparedIds = useRef(new Set<string>());
    useEffect(() => {
        if (!canWrite) return;
        for (const record of planningRecords) {
            if (eagerPreparedIds.current.size >= MAX_EAGER_OPTION_PREPARATIONS) break;
            if (record.type !== 'decision' && record.type !== 'open_question') continue;
            if (!['open', 'proposed'].includes(projectDecision(record).status)) continue;
            if (record.decisionOptions?.length || eagerPreparedIds.current.has(record.id)) continue;
            eagerPreparedIds.current.add(record.id);
            void prepareDecisionOptions(record.id);
        }
    }, [canWrite, planningRecords, prepareDecisionOptions]);

    const {
        handleGenerateAssumptionValidationPlan,
        handleRecordAssumptionValidationPlan,
        handleAddAssumptionEvidence,
        handleRetractAssumptionEvidence,
        handleCorrectAssumptionEvidence,
        handleInterpretAssumptionEvidence,
        handleRecordAssumptionOutcome,
        handleRecordAssumptionTreatment,
        handleReopenAssumptionOutcome,
    } = useAssumptionValidationActions({ projectId, canWrite });
    const {
        alignmentAnalysis,
        handleDecisionAction,
        handlePreviewImpact,
        handleAlignmentProposalReview,
        handleRequestAlignmentProposal,
        handleApplyToPlan,
    } = useDecisionImpactActions({ projectId, canWrite, planningRecords });
    const recommendationBatch = useBatchVerdictCoordinator({
        projectId,
        canWrite,
        prepareImpact: handlePreviewImpact,
    });
    const planningViews = buildPlanningRecordViews({
        planningRecords,
        latestSpine,
        alignmentAnalysis,
        optionSuggestions,
    });

    if (!project || !latestSpine?.structuredPRD) {
        return (
            <div className="p-6 text-sm text-neutral-500">
                A structured working plan is needed before Synapse can open the Decision Center.
            </div>
        );
    }

    return (
        <DecisionCenter
            records={planningViews}
            initialSelectedId={initialRecordId}
            readOnly={!canWrite}
            onDecide={handleDecisionAction}
            onPrepareOptions={recordId => void prepareDecisionOptions(recordId)}
            recommendationBatchBusy={recommendationBatch.busy}
            recommendationBatchResult={recommendationBatch.result}
            onAcceptRecommendations={candidates => void recommendationBatch.runBatch(candidates)}
            onPreviewImpact={handlePreviewImpact}
            onApplyToPlan={handleApplyToPlan}
            onReviewAlignmentProposal={handleAlignmentProposalReview}
            onRequestAlignmentProposal={handleRequestAlignmentProposal}
            onGenerateAssumptionValidationPlan={handleGenerateAssumptionValidationPlan}
            onRecordAssumptionValidationPlan={handleRecordAssumptionValidationPlan}
            onAddAssumptionEvidence={handleAddAssumptionEvidence}
            onCorrectAssumptionEvidence={handleCorrectAssumptionEvidence}
            onRetractAssumptionEvidence={handleRetractAssumptionEvidence}
            onInterpretAssumptionEvidence={handleInterpretAssumptionEvidence}
            onRecordAssumptionOutcome={handleRecordAssumptionOutcome}
            onRecordAssumptionTreatment={handleRecordAssumptionTreatment}
            onReopenAssumptionOutcome={handleReopenAssumptionOutcome}
            onContinueToExplore={onContinueToExplore}
        />
    );
}
