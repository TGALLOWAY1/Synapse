import { useEffect } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { canPerformProjectAction } from '../../lib/projectCapabilities';
import { ReviewWorkspace } from './ReviewWorkspace';
import { useReviewContextManifest } from './useReviewContextManifest';
import { useReviewRunController } from './useReviewRunController';
import { useReviewIssueActions } from './useReviewIssueActions';
import { useAssumptionValidationActions } from './useAssumptionValidationActions';
import { useDecisionImpactActions } from './useDecisionImpactActions';
import { buildReviewRunViews } from './reviewRunViews';
import { buildPlanningRecordViews } from './planningRecordViews';

interface Props {
    projectId: string;
    initialTab?: 'review' | 'decisions';
    initialRecordId?: string;
    initialReviewId?: string;
    initialIssueId?: string;
    initialFindingId?: string;
}

// Zustand selectors are consumed through React's useSyncExternalStore. Keep
// the absent per-project snapshot referentially stable so projects that have
// not created every review collection yet do not trigger an infinite render
// loop under React 19.
const EMPTY_PROJECT_COLLECTION: never[] = [];

export function ReviewWorkspaceContainer({ projectId, initialTab, initialRecordId, initialReviewId, initialIssueId, initialFindingId }: Props) {
    const project = useProjectStore(state => state.projects[projectId]);
    const spines = useProjectStore(state => state.spineVersions[projectId] ?? EMPTY_PROJECT_COLLECTION);
    const artifacts = useProjectStore(state => state.artifacts[projectId] ?? EMPTY_PROJECT_COLLECTION);
    const artifactVersions = useProjectStore(state => state.artifactVersions[projectId] ?? EMPTY_PROJECT_COLLECTION);
    const reviewRuns = useProjectStore(state => state.reviewRuns[projectId] ?? EMPTY_PROJECT_COLLECTION);
    const specialistRuns = useProjectStore(state => state.specialistRuns[projectId] ?? EMPTY_PROJECT_COLLECTION);
    const findings = useProjectStore(state => state.reviewFindings[projectId] ?? EMPTY_PROJECT_COLLECTION);
    const issues = useProjectStore(state => state.reviewIssues[projectId] ?? EMPTY_PROJECT_COLLECTION);
    const planningRecords = useProjectStore(state => state.planningRecords[projectId] ?? EMPTY_PROJECT_COLLECTION);
    const canWrite = canPerformProjectAction(projectId, 'persist');

    const { latestSpine, manifests, currentManifest, manifestForReview, panel } = useReviewContextManifest({
        projectId, project, spines, artifacts, artifactVersions, reviewRuns,
    });

    useEffect(() => {
        if (!canWrite || !latestSpine?.structuredPRD) return;
        useProjectStore.getState().importPlanningAssumptions(projectId, latestSpine.id, latestSpine.structuredPRD);
    }, [canWrite, latestSpine?.id, latestSpine?.structuredPRD, projectId]);

    const { activeRunId, setActiveRunId, busy, handleStart, handleRetrySpecialist, handleResumeReview, cancelRun } = useReviewRunController({
        projectId, canWrite, initialReviewId, currentManifest, manifests, manifestForReview, panel, reviewRuns, specialistRuns,
    });

    const { handleIssueAction, handleReopenIssue, handleTriageFinding } = useReviewIssueActions({
        projectId, canWrite, currentManifest,
    });

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

    const runViews = buildReviewRunViews({
        reviewRuns,
        specialistRuns,
        findings,
        issues,
        spines,
        currentContextSignature: currentManifest?.contextSignature,
    });

    const planningViews = buildPlanningRecordViews({ planningRecords, latestSpine, alignmentAnalysis });

    if (!project || !currentManifest) return <div className="p-6 text-sm text-neutral-500">A structured working plan is needed before Synapse can challenge it.</div>;
    return <ReviewWorkspace
        projectName={project.name}
        initialTab={initialTab}
        initialDecisionId={initialRecordId}
        initialIssueId={initialIssueId}
        initialFindingId={initialFindingId}
        recommendedPanel={panel}
        sourcesInScope={currentManifest.sources.map(source => source.label)}
        missingSources={currentManifest.missingArtifacts.map(source => source.replaceAll('_', ' '))}
        runs={runViews}
        planningRecords={planningViews}
        activeRunId={activeRunId}
        busy={busy}
        onStartReview={handleStart}
        onSelectRun={setActiveRunId}
        onCancelRun={cancelRun}
        onRetrySpecialist={(reviewId, specialistId) => void handleRetrySpecialist(reviewId, specialistId)}
        onRetrySynthesis={reviewId => void handleResumeReview(reviewId)}
        onActOnIssue={handleIssueAction}
        onReopenIssue={handleReopenIssue}
        onTriageFinding={handleTriageFinding}
        onConfirmPlanningRecord={recordId => {
            const record = planningRecords.find(item => item.id === recordId);
            if (record) useProjectStore.getState().updatePlanningRecordStatusByUser(projectId, recordId, record.type === 'decision' ? 'confirmed' : 'resolved');
        }}
        onReopenPlanningRecord={recordId => useProjectStore.getState().updatePlanningRecordStatusByUser(projectId, recordId, 'open')}
        onDecidePlanningRecord={handleDecisionAction}
        onPreviewPlanningRecordImpact={handlePreviewImpact}
        onApplyPlanningRecordToPlan={handleApplyToPlan}
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
        readOnly={!canPerformProjectAction(projectId, 'persist')}
    />;
}
