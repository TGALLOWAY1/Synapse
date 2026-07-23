import { useProjectStore } from '../../store/projectStore';
import { canPerformProjectAction } from '../../lib/projectCapabilities';
import { ReviewWorkspace } from './ReviewWorkspace';
import { useReviewContextManifest } from './useReviewContextManifest';
import { useReviewRunController } from './useReviewRunController';
import { useReviewIssueActions } from './useReviewIssueActions';
import { buildReviewRunViews } from './reviewRunViews';
import { buildPlanningRecordViews } from './planningRecordViews';
import { projectDecision } from '../../lib/planning/decisionProjection';

interface Props {
    projectId: string;
    initialTab?: 'review' | 'decisions';
    /** Kept during the Tier 3 integration window. Decision records now open in
     * DecisionCenterContainer rather than this critique surface. */
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

// Zustand selectors are consumed through React's useSyncExternalStore. Keep
// the absent per-project snapshot referentially stable so projects that have
// not created every review collection yet do not trigger an infinite render
// loop under React 19.
const EMPTY_PROJECT_COLLECTION: never[] = [];

export function ReviewWorkspaceContainer({
    projectId,
    initialTab,
    initialReviewId,
    initialIssueId,
    initialFindingId,
}: Props) {
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

    const { handleIssueAction, handleReopenIssue, handleTriageFinding } = useReviewIssueActions({
        projectId, canWrite, currentManifest,
    });

    const runViews = buildReviewRunViews({
        reviewRuns,
        specialistRuns,
        findings,
        issues,
        spines,
        currentContextSignature: currentManifest?.contextSignature,
    });

    // Critique needs records only for linking/challenging a finding. Decision
    // details and actions are projected by DecisionCenterContainer.
    const planningViews = buildPlanningRecordViews({
        planningRecords,
        latestSpine,
        alignmentAnalysis: {},
    });

    const openCritiqueAdvisoryRecords = planningRecords.filter(record => (
        CRITIQUE_ADVISORY_RECORD_TYPES.has(record.type)
        && ['open', 'proposed'].includes(projectDecision(record).status)
    ));

    if (!project || !currentManifest) return <div className="p-6 text-sm text-neutral-500">A structured working plan is needed before Synapse can challenge it.</div>;
    return <ReviewWorkspace
        projectName={project.name}
        initialTab={initialTab === 'decisions' ? 'review' : initialTab}
        initialIssueId={initialIssueId}
        initialFindingId={initialFindingId}
        openDecisionCount={openCritiqueAdvisoryRecords.length}
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
        readOnly={!canPerformProjectAction(projectId, 'persist')}
    />;
}
