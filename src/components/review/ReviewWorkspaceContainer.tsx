import { useEffect, useRef } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { canPerformProjectAction } from '../../lib/projectCapabilities';
import { ReviewWorkspace } from './ReviewWorkspace';
import { useReviewContextManifest } from './useReviewContextManifest';
import { useReviewRunController } from './useReviewRunController';
import { useReviewIssueActions } from './useReviewIssueActions';
import { useDecisionOptionSuggestions } from './useDecisionOptionSuggestions';
import { useAssumptionValidationActions } from './useAssumptionValidationActions';
import { useDecisionImpactActions } from './useDecisionImpactActions';
import { useBatchVerdictCoordinator } from './useBatchVerdictCoordinator';
import { buildReviewRunViews } from './reviewRunViews';
import { buildPlanningRecordViews } from './planningRecordViews';
import { projectDecision } from '../../lib/planning/decisionProjection';

interface Props {
    projectId: string;
    initialTab?: 'review' | 'decisions';
    initialRecordId?: string;
    initialReviewId?: string;
    initialIssueId?: string;
    initialFindingId?: string;
    /** Jumps to the Explore/Build stage from the Decision Center. */
    onContinueToExplore?: () => void;
}

// Open planning items are useful context before critique, but never a gate.
// Keep this predicate aligned with planningReadiness.ts (risks are excluded).
const CRITIQUE_ADVISORY_RECORD_TYPES = new Set(['decision', 'open_question', 'conflict', 'assumption']);

// Cap on how many open choices get recommendations prepared per pass — bounds
// model spend on projects with a large backlog; the rest prepare on open.
const MAX_EAGER_OPTION_PREPARATIONS = 6;

// Zustand selectors are consumed through React's useSyncExternalStore. Keep
// the absent per-project snapshot referentially stable so projects that have
// not created every review collection yet do not trigger an infinite render
// loop under React 19.
const EMPTY_PROJECT_COLLECTION: never[] = [];

export function ReviewWorkspaceContainer({ projectId, initialTab, initialRecordId, initialReviewId, initialIssueId, initialFindingId, onContinueToExplore }: Props) {
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

    const { activeRunId, setActiveRunId, busy, handleStart, handleRetrySpecialist, handleResumeReview, cancelRun } = useReviewRunController({
        projectId, canWrite, initialReviewId, currentManifest, manifests, manifestForReview, panel, reviewRuns, specialistRuns,
    });

    const { optionSuggestions, prepareDecisionOptions } = useDecisionOptionSuggestions({ projectId, canWrite });

    // Prepare recommendations eagerly for the first few open choices so the
    // Decision Center queue opens ready to approve instead of waiting on a
    // per-record model call. The requested-id set makes the cap a true
    // per-mount total (re-runs must not drain the whole backlog batch by
    // batch) and doubles as the no-auto-retry guard for failed attempts —
    // everything beyond the cap prepares on open via the detail pane.
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

    const { handleIssueAction, handleReopenIssue, handleTriageFinding } = useReviewIssueActions({
        projectId, canWrite, currentManifest,
        // A newly proposed choice immediately starts collecting its suggested
        // alternatives so the Decision Center opens with concrete approaches.
        onChoiceRecordCreated: recordId => void prepareDecisionOptions(recordId),
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
    const recommendationBatch = useBatchVerdictCoordinator({
        projectId,
        canWrite,
        prepareImpact: handlePreviewImpact,
    });

    const runViews = buildReviewRunViews({
        reviewRuns,
        specialistRuns,
        findings,
        issues,
        spines,
        currentContextSignature: currentManifest?.contextSignature,
    });

    const planningViews = buildPlanningRecordViews({ planningRecords, latestSpine, alignmentAnalysis, optionSuggestions });

    const openCritiqueAdvisoryRecords = planningRecords.filter(record => (
        CRITIQUE_ADVISORY_RECORD_TYPES.has(record.type)
        && ['open', 'proposed'].includes(projectDecision(record).status)
    ));

    if (!project || !currentManifest) return <div className="p-6 text-sm text-neutral-500">A structured working plan is needed before Synapse can challenge it.</div>;
    return <ReviewWorkspace
        projectName={project.name}
        initialTab={initialTab}
        initialDecisionId={initialRecordId}
        initialIssueId={initialIssueId}
        initialFindingId={initialFindingId}
        openDecisionCount={openCritiqueAdvisoryRecords.length}
        onContinueToExplore={onContinueToExplore}
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
        onPrepareDecisionOptions={recordId => void prepareDecisionOptions(recordId)}
        recommendationBatchBusy={recommendationBatch.busy}
        recommendationBatchResult={recommendationBatch.result}
        onAcceptRecommendations={candidates => void recommendationBatch.runBatch(candidates)}
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
