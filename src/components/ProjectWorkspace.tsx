import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { useAuthStore } from '../store/authStore';
import { useToastStore } from '../store/toastStore';
import { ChevronLeft, RefreshCcw, LogOut, CheckCircle, Cloud, Download, Settings, ChevronDown, ChevronRight, PanelRightOpen, PanelRightClose, MoreHorizontal, Loader2, ArrowRight, History, Activity } from 'lucide-react';
import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createPortal } from 'react-dom';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { generateStructuredPRD } from '../lib/llmProvider';
import { normalizeError, userMessage } from '../lib/errors';
import {
    SafetyBlockedError,
    buildBlockedSafetyReview,
    buildRestrictedSafetyReview,
    buildSafetyReviewMarkdown,
} from '../lib/safety';
import { ProgressTimeline } from './progress/ProgressTimeline';
import { buildGenerationSteps } from './progress/buildGenerationSteps';
import { regeneratePrdSection } from '../lib/services/prdSectionRetry';
import { summarizeConsistencyReview } from '../lib/services/prdConsistencyReview';
import { BranchList } from './BranchList';
import { ConsolidationModal } from './ConsolidationModal';
import { SettingsModal } from './SettingsModal';
import { PipelineStageBar } from './PipelineStageBar';
import { StructuredPRDView } from './StructuredPRDView';
import { coercePrdView, type PrdViewId } from '../lib/derive/prdViews';
import { SafetyReviewView } from './SafetyReviewView';
import { SafetyBoundariesCard } from './SafetyBoundariesCard';
import { PreflightView } from './preflight/PreflightView';
import { ArtifactWorkspace } from './ArtifactWorkspace';
import { FinalizationSuccessModal } from './FinalizationSuccessModal';
import { DesignSystemPresetChoice } from './DesignSystemPresetChoice';
import { DesignSetupStep } from './setup/DesignSetupStep';
import { shouldShowDesignSetup } from '../lib/designSetup';
import { CORE_ARTIFACT_DISPLAY_ORDER, isHiddenArtifactSubtype, isRetiredArtifactSubtype } from '../lib/coreArtifactPipeline';
import { HistoryView } from './HistoryView';
import { VersionHistoryPanel, VersionCompareView, RevertConfirmModal, type VersionEntry } from './versions';
import { ExportModal } from './ExportModal';
import { SnapshotsPanel } from './SnapshotsPanel';
import { FeedbackItemsList } from './FeedbackItemsList';
import { BranchCanvas } from './BranchCanvas';
import { artifactJobController } from '../lib/services/artifactJobController';
import { SECTION_TITLES } from '../lib/prompts/prdSectionPrompts';
import type { SectionId } from '../lib/schemas/prdSchemas';
import type { ArtifactSlotKey, Branch, PipelineStage, FeedbackItem, ReadinessActionTarget } from '../types';
import { ProjectCloudStatus, ProjectConflictBanner } from './sync/ProjectSyncStatus';
import { ReviewWorkspaceContainer } from './review/ReviewWorkspaceContainer';
import { useProjectCapabilities } from '../hooks/useProjectCapabilities';
import { DemoReadOnlyNotice } from './DemoReadOnlyNotice';
import { evaluateProjectFreshness } from '../lib/artifactFreshness';
import type { DependencyNodeId } from '../lib/artifactDependencyGraph';
import { canPerformProjectAction } from '../lib/projectCapabilities';
import {
    commitmentRemainsCurrent,
    compareReadinessReviewCurrentness,
    compareReadinessReviewProjections,
    deriveAnswerableAssumptionRecords,
    derivePlanningAttention,
    derivePlanningReadiness,
    deriveReadinessChallengeState,
    deriveReadinessCommitmentState,
    deriveReadinessReview,
    hasReadinessProvenanceForSpine,
    planningContentHash,
} from '../lib/planning';
import { PlanningStateBar } from './planning/PlanningStateBar';
import { SharpenPlanFlow } from './planning/SharpenPlanFlow';
import { useDecisionImpactActions } from './review/useDecisionImpactActions';
import { ReadinessCheckpoint, type ReadinessOverrideInput } from './planning/ReadinessCheckpoint';
import { buildReadinessCheckpointView, readinessNavigationDestination } from './planning/readinessCheckpointView';
import { hashReviewValue } from '../lib/review/hash';
import { buildReviewContextManifest } from '../lib/review/manifest';
import {
    PLANNING_NAVIGATION_QUERY_PARAM,
    parsePlanningNavigationIntent,
    validatePlanningDestination,
    withPlanningNavigationIntent,
    type PlanningArtifactRegionTarget,
    type PlanningNavigationIntent,
    type PlanningDestination,
    type PlanningReturnTarget,
} from '../lib/planning/planningNavigation';

const EMPTY_PROJECT_LIST: never[] = [];

export function ProjectWorkspace() {
    const { projectId } = useParams<{ projectId: string }>();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const capabilities = useProjectCapabilities(projectId);
    const prdView = coercePrdView(searchParams.get('prdView'));
    const setPrdView = (next: PrdViewId) => {
        setSearchParams(prev => {
            const p = new URLSearchParams(prev);
            if (next === 'overview') p.delete('prdView');
            else p.set('prdView', next);
            return p;
        }, { replace: true });
    };
    const authUser = useAuthStore((s) => s.user);
    const logout = useAuthStore((s) => s.logout);
    const { getProject, getLatestSpine, regenerateSpine, updateSpineStructuredPRD, compareAndAppendStructuredPRD, revertSpineToVersion, updateProjectProductMetadata, setSpineError, setSpineSafetyReview, getHistoryEvents, getBranchesForSpine, getSpineVersions, getProjectOutputAlignment, getDownstreamUpdatePlanSummary, markSpineFinal, createReadinessReview, authorizeReadinessCommitment, commitReadinessReview, reopenReadinessCommitment, setProjectStage, setProjectDesignSystemPreset, createBranch: storCreateBranch, updateFeedbackStatus, getArtifact, getArtifactVersions, getArtifacts, appendPrdProgress, clearPrdProgress, clearSectionStatus, setSectionStatus } = useProjectStore();
    const prdProgress = useProjectStore((s) => (projectId ? s.prdProgress[projectId] : undefined));
    const prdSectionStatus = useProjectStore((s) => (projectId ? s.prdSectionStatus[projectId] : undefined));
    // Live asset-generation job for the post-finalize status pill.
    const assetJob = useProjectStore((s) => (projectId ? s.jobs[projectId] : undefined));
    const planningRecords = useProjectStore((s) => (projectId ? s.planningRecords[projectId] ?? EMPTY_PROJECT_LIST : EMPTY_PROJECT_LIST));
    const canEditPlan = !!projectId && canPerformProjectAction(projectId, 'persist');
    // The sharpen flow records verdicts through the same append-only
    // decision-event path the Decision Center uses (user-only authority).
    const { handleDecisionAction: handleSharpenDecision } = useDecisionImpactActions({
        projectId: projectId ?? '',
        canWrite: canEditPlan,
        planningRecords,
    });
    const reviewRuns = useProjectStore((s) => (projectId ? s.reviewRuns[projectId] ?? EMPTY_PROJECT_LIST : EMPTY_PROJECT_LIST));
    const specialistRuns = useProjectStore((s) => (projectId ? s.specialistRuns[projectId] ?? EMPTY_PROJECT_LIST : EMPTY_PROJECT_LIST));
    const reviewIssues = useProjectStore((s) => (projectId ? s.reviewIssues[projectId] ?? EMPTY_PROJECT_LIST : EMPTY_PROJECT_LIST));
    const reviewFindings = useProjectStore((s) => (projectId ? s.reviewFindings[projectId] ?? EMPTY_PROJECT_LIST : EMPTY_PROJECT_LIST));
    const readinessReviews = useProjectStore((s) => (projectId ? s.readinessReviews[projectId] ?? EMPTY_PROJECT_LIST : EMPTY_PROJECT_LIST));
    const readinessCommitmentEvents = useProjectStore((s) => (projectId ? s.readinessCommitmentEvents[projectId] ?? EMPTY_PROJECT_LIST : EMPTY_PROJECT_LIST));
    const navigationArtifacts = useProjectStore((s) => (projectId ? s.artifacts[projectId] ?? EMPTY_PROJECT_LIST : EMPTY_PROJECT_LIST));
    const downstreamUpdatePlans = useProjectStore((s) => (projectId ? s.downstreamUpdatePlans[projectId] ?? EMPTY_PROJECT_LIST : EMPTY_PROJECT_LIST));
    const planningSourceSpine = useProjectStore((s) => projectId
        ? (s.spineVersions[projectId] ?? EMPTY_PROJECT_LIST).find(spine => spine.isLatest)
        : undefined);
    useEffect(() => {
        if (!projectId || !planningSourceSpine?.structuredPRD || !canPerformProjectAction(projectId, 'persist')) return;
        useProjectStore.getState().importPlanningAssumptions(projectId, planningSourceSpine.id, planningSourceSpine.structuredPRD, planningSourceSpine.preflightSession);
    }, [planningSourceSpine?.id, planningSourceSpine?.structuredPRD, planningSourceSpine?.preflightSession, projectId]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [consolidatingBranch, setConsolidatingBranch] = useState<Branch | null>(null);
    const [viewedSpineId, setViewedSpineId] = useState<string | null>(null);
    // PRD version-history UI: the full panel, plus the banner's standalone
    // compare/restore against the latest version.
    const [showPrdHistory, setShowPrdHistory] = useState(false);
    const [bannerCompareOpen, setBannerCompareOpen] = useState(false);
    const [bannerRestoreOpen, setBannerRestoreOpen] = useState(false);
    const [isPromptCollapsed, setIsPromptCollapsed] = useState(true);
    // Keep the planning canvas primary. The branch/history sidebar opens when
    // a branch is created or when the user explicitly asks for it.
    const [isBranchesVisible, setIsBranchesVisible] = useState(false);
    const [activeRightTab, setActiveRightTab] = useState<'branches' | 'history'>('branches');
    const [activeCanvasBranchId, setActiveCanvasBranchId] = useState<string | null>(null);
    const [showNavOverflow, setShowNavOverflow] = useState(false);
    const [isExportOpen, setIsExportOpen] = useState(false);
    const [isSnapshotsOpen, setIsSnapshotsOpen] = useState(false);
    const [retryingStepId, setRetryingStepId] = useState<string | null>(null);
    // Post-commitment transition. `showFinalizeSuccess` explains that output
    // generation is a separate action; `finalizeAutoOpen` carries an explicit
    // Review outputs navigation intent into ArtifactWorkspace.
    const [showFinalizeSuccess, setShowFinalizeSuccess] = useState(false);
    const [finalizeAutoOpen, setFinalizeAutoOpen] = useState(false);
    // Design direction is requested only when output generation begins.
    const [showPresetChoice, setShowPresetChoice] = useState(false);
    const [selectedReadinessReviewId, setSelectedReadinessReviewId] = useState<string | null>(null);
    const [readinessInitialConcernId, setReadinessInitialConcernId] = useState<string>();
    const [readinessSubmitError, setReadinessSubmitError] = useState<string | null>(null);
    const [isReadinessSubmitting, setIsReadinessSubmitting] = useState(false);
    const [reviewInitialTab, setReviewInitialTab] = useState<'review' | 'decisions'>('review');
    const [reviewInitialRecordId, setReviewInitialRecordId] = useState<string>();
    // Guided sharpen flow: the answerable-assumption queue is frozen at open
    // so answering one question never reshuffles the remaining ones.
    const [sharpenQueueIds, setSharpenQueueIds] = useState<string[] | null>(null);
    const [reviewInitialRunId, setReviewInitialRunId] = useState<string>();
    const [reviewInitialIssueId, setReviewInitialIssueId] = useState<string>();
    const [reviewInitialFindingId, setReviewInitialFindingId] = useState<string>();
    const [workspaceInitialNode, setWorkspaceInitialNode] = useState<ArtifactSlotKey>();
    const [workspaceInitialArtifactId, setWorkspaceInitialArtifactId] = useState<string>();
    const [workspaceInitialRegion, setWorkspaceInitialRegion] = useState<PlanningArtifactRegionTarget>();
    const [workspaceInitialUpdatePlanId, setWorkspaceInitialUpdatePlanId] = useState<string>();
    const [workspaceInitialUpdatePlanItemId, setWorkspaceInitialUpdatePlanItemId] = useState<string>();
    const lastPlanningIntentRef = useRef<PlanningNavigationIntent | undefined>(undefined);
    // Serialized form of the intent most recently applied to the presentation.
    // An intent is applied exactly once: later store updates (planning records,
    // review runs, update plans) must never re-run a stale destination and
    // yank the user back to a stage they already navigated away from.
    const lastAppliedPlanningIntentRef = useRef<string | undefined>(undefined);
    // Carries an explicit generation request across the design-preset choice.
    const generateAfterPreset = useRef(false);
    const overflowRef = useRef<HTMLDivElement>(null);
    const overflowButtonRef = useRef<HTMLButtonElement>(null);
    const overflowMenuRef = useRef<HTMLDivElement>(null);
    // Synchronous regeneration lock; see handleRegenerate.
    const regenerateInFlight = useRef(false);
    const [overflowMenuPos, setOverflowMenuPos] = useState<{ top: number; right: number } | null>(null);
    const [animationParent] = useAutoAnimate();
    // Demo navigation is intentionally session-only. Ordinary projects retain
    // their existing persisted currentStage behavior.
    const [readOnlyStage, setReadOnlyStage] = useState<PipelineStage | null>(null);

    const planningIntent = useMemo(
        () => parsePlanningNavigationIntent(searchParams.get(PLANNING_NAVIGATION_QUERY_PARAM)),
        [searchParams],
    );

    const writePlanningIntent = (intent?: PlanningNavigationIntent, replace = false) => {
        if (!intent) lastPlanningIntentRef.current = undefined;
        setSearchParams(current => {
            const next = withPlanningNavigationIntent(current, intent);
            const screenId = intent?.destination.kind === 'artifact' ? intent.destination.region?.screenId : undefined;
            if (!screenId) {
                next.delete('screen');
                next.delete('screenTab');
            }
            return next;
        }, { replace });
    };

    // The project workspace is the single presentation resolver. Navigation
    // state is deliberately URL-only and never enters planning hashes or user
    // authority. Missing exact targets fail to a readable parent surface.
    useEffect(() => {
        if (!projectId) return;
        const previousIntent = lastPlanningIntentRef.current;
        lastPlanningIntentRef.current = planningIntent;
        // Browser Back removes the destination query. When that destination
        // carried an explicit origin, restore the origin presentation once;
        // the URL remains clean and no planning data is mutated.
        const effectiveIntent = planningIntent ?? (previousIntent?.returnTo
            ? { destination: previousIntent.returnTo.destination }
            : undefined);
        if (!effectiveIntent) {
            lastAppliedPlanningIntentRef.current = undefined;
            return;
        }
        const destination = validatePlanningDestination(effectiveIntent.destination, {
            planningRecordIds: new Set(planningRecords.map(record => record.id)),
            reviewIds: new Set(reviewRuns.map(review => review.id)),
            reviewIssueIds: new Set(reviewIssues.map(issue => issue.id)),
            reviewFindingIds: new Set(reviewFindings.map(finding => finding.id)),
            readinessReviewIds: new Set(readinessReviews.map(review => review.id)),
            artifactIds: new Set(navigationArtifacts.map(artifact => artifact.id)),
            updatePlanIds: new Set(downstreamUpdatePlans.map(plan => plan.id)),
        });
        // The applied key covers the intent AND its validated destination: a
        // deep link whose target had not loaded yet (falling back to the PRD)
        // re-applies once the target exists, while store churn that leaves the
        // validated destination unchanged can never re-run a stale navigation.
        const serializedIntent = `${JSON.stringify(effectiveIntent)}=>${JSON.stringify(destination)}`;
        if (serializedIntent === lastAppliedPlanningIntentRef.current) return;
        lastAppliedPlanningIntentRef.current = serializedIntent;
        if (destination.kind === 'prd') {
            setSelectedReadinessReviewId(null);
            setProjectStage(projectId, 'prd');
            if (destination.anchorId) window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
                document.getElementById(destination.anchorId!)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }));
            return;
        }
        if (destination.kind === 'decision_center' || destination.kind === 'planning_record') {
            setReviewInitialTab('decisions');
            setReviewInitialRecordId(destination.kind === 'planning_record' ? destination.recordId : undefined);
            setReviewInitialRunId(undefined);
            setReviewInitialIssueId(undefined);
            setReviewInitialFindingId(undefined);
            setProjectStage(projectId, 'review');
            return;
        }
        if (destination.kind === 'challenge') {
            setReviewInitialTab('review');
            setReviewInitialRecordId(undefined);
            setReviewInitialRunId(destination.reviewId);
            setReviewInitialIssueId(destination.issueId);
            setReviewInitialFindingId(destination.findingId);
            setProjectStage(projectId, 'review');
            return;
        }
        if (destination.kind === 'readiness') {
            setReadinessInitialConcernId(destination.concernId);
            setSelectedReadinessReviewId(destination.reviewId);
            return;
        }
        if (destination.kind === 'artifact') {
            setFinalizeAutoOpen(false);
            setWorkspaceInitialNode(destination.nodeId);
            setWorkspaceInitialArtifactId(destination.artifactId);
            setWorkspaceInitialRegion(destination.region);
            setWorkspaceInitialUpdatePlanId(undefined);
            setWorkspaceInitialUpdatePlanItemId(undefined);
            setProjectStage(projectId, 'workspace');
            return;
        }
        const plan = downstreamUpdatePlans.find(candidate => candidate.id === destination.planId);
        setFinalizeAutoOpen(false);
        setWorkspaceInitialNode(destination.nodeId ?? plan?.artifact.slot);
        setWorkspaceInitialArtifactId(destination.artifactId ?? plan?.artifact.artifactId);
        setWorkspaceInitialUpdatePlanId(destination.planId);
        setWorkspaceInitialUpdatePlanItemId(destination.itemId);
        setProjectStage(projectId, 'workspace');
    }, [downstreamUpdatePlans, navigationArtifacts, planningIntent, planningRecords, projectId, readinessReviews, reviewFindings, reviewIssues, reviewRuns, setProjectStage]);

    // Position the portaled overflow menu relative to its trigger button.
    useLayoutEffect(() => {
        if (!showNavOverflow) {
            setOverflowMenuPos(null);
            return;
        }
        const update = () => {
            const btn = overflowButtonRef.current;
            if (!btn) return;
            const rect = btn.getBoundingClientRect();
            setOverflowMenuPos({
                top: rect.bottom + 4,
                right: window.innerWidth - rect.right,
            });
        };
        update();
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
        };
    }, [showNavOverflow]);

    // Close overflow menu on outside click (menu is portaled, so check both roots)
    useEffect(() => {
        if (!showNavOverflow) return;
        const handleClick = (e: MouseEvent) => {
            const target = e.target as Node;
            const insideTrigger = overflowRef.current?.contains(target);
            const insideMenu = overflowMenuRef.current?.contains(target);
            if (!insideTrigger && !insideMenu) {
                setShowNavOverflow(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [showNavOverflow]);

    // A stale URL (deleted project, cleared storage, bookmark from another
    // device) must not strand the user on a dead-end view — bounce home.
    const projectExists = !!projectId && !!getProject(projectId);
    useEffect(() => {
        if (projectId && !projectExists) {
            useToastStore.getState().addToast({
                type: 'info',
                title: 'Project not found',
                message: 'It may have been deleted or saved in a different browser.',
            });
            navigate('/', { replace: true });
        }
    }, [projectId, projectExists, navigate]);

    // Deep link: /p/:id?screen=<canonical id> targets a screen in the
    // Experience workspace (ArtifactWorkspace reads the param). currentStage
    // is persisted per project, so a shared/bookmarked screen URL would
    // otherwise open on whatever stage the project was last left in. One-shot
    // on mount — never fights later user navigation. If the workspace isn't
    // available (spine not final / blocked), the param is simply inert.
    useEffect(() => {
        if (!projectId) return;
        if (!new URLSearchParams(window.location.search).get('screen')) return;
        const store = useProjectStore.getState();
        const proj = store.getProject(projectId);
        const spine = store.getLatestSpine(projectId);
        if (!proj || proj.currentStage === 'workspace') return;
        if (spine?.structuredPRD && spine.safetyReview?.status !== 'blocked') {
            if (capabilities.canPersistWorkflowState) store.setProjectStage(projectId, 'workspace');
            else setReadOnlyStage('workspace');
        }
        // Mount-only by design (store read via getState, not deps): reacting
        // to later param changes would yank the stage from under the user.
    }, [projectId, capabilities.canPersistWorkflowState]);

    // Early design-system generation: as soon as a preset is chosen and the PRD
    // settles cleanly, kick off design_system in the background so it isn't
    // still "generating" after the user finalizes. All gating beyond these
    // guards (capabilities/demo, generation gate, missing key, already-done for
    // the spine, active run) lives inside ensureDesignSystemForSpine.
    const earlyDesignSpine = projectId ? getLatestSpine(projectId) : undefined;
    const earlyDesignProject = projectId ? getProject(projectId) : undefined;
    useEffect(() => {
        if (!projectId || !earlyDesignSpine) return;
        // Only act on the current latest spine — not while viewing an old one.
        if (viewedSpineId && viewedSpineId !== earlyDesignSpine.id) return;
        if (!earlyDesignProject?.designSystemPreset) return;
        // Finalize owns generation from here; also prevents a double-fire with
        // handleChooseDesignSystemPreset / the post-final ChangeDirectionModal.
        if (earlyDesignSpine.isFinal) return;
        if (earlyDesignSpine.generationPhase !== 'complete') return;
        if (!earlyDesignSpine.structuredPRD) return;
        if (earlyDesignSpine.generationError) return;
        if (earlyDesignSpine.safetyReview?.status === 'blocked') return;
        artifactJobController.ensureDesignSystemForSpine({
            projectId,
            spineVersionId: earlyDesignSpine.id,
            prdContent: earlyDesignSpine.responseText,
            structuredPRD: earlyDesignSpine.structuredPRD,
            projectPlatform: earlyDesignProject.platform,
        });
    }, [projectId, viewedSpineId, earlyDesignSpine, earlyDesignProject]);

    if (!projectId) return <div>Invalid Project</div>;

    const project = getProject(projectId);
    const latestSpine = getLatestSpine(projectId);
    const historyEvents = getHistoryEvents(projectId);
    const allSpines = getSpineVersions(projectId);

    const pipelineStage = capabilities.canPersistWorkflowState
        ? project?.currentStage || 'prd'
        : readOnlyStage ?? project?.currentStage ?? 'prd';
    const setPipelineStage = (stage: PipelineStage) => {
        if (projectId) setProjectStage(projectId, stage);
    };
    const handlePipelineStageChange = (stage: PipelineStage) => {
        // Land on the Decision Center first when decisions are still open — the
        // specialist critique (Findings) is gated until they are addressed.
        if (stage === 'review') setReviewInitialTab(critiqueUnlocked ? 'review' : 'decisions');
        writePlanningIntent(undefined);
        setPipelineStage(stage);
    };

    const activeSpine = viewedSpineId ? allSpines.find(s => s.id === viewedSpineId) || latestSpine : latestSpine;
    const isOldVersion = activeSpine?.id !== latestSpine?.id;


    const branches = activeSpine ? getBranchesForSpine(projectId, activeSpine.id) : [];
    const hasBranches = branches.length > 0;

    // Detect if the current spine is still waiting for initial generation
    const isPRDGenerating = !!activeSpine && activeSpine.responseText === 'Generating PRD...' && !activeSpine.structuredPRD && !activeSpine.generationError;

    // Multi-agent pipeline emits onPartial after each of ~10 sections, so
    // structuredPRD becomes truthy long before generation finishes. Use the
    // section-status grid as the source of truth for "still working" — any
    // section in pending/queued/generating state means the panel
    // should stay visible. Combined with isPRDGenerating to cover the brief
    // initial window before the first section_started event arrives.
    const sectionsStillRunning = !!prdSectionStatus && Object.values(prdSectionStatus).some(
        (s) => s && s.status !== 'complete' && s.status !== 'error',
    );
    const isPRDActivelyGenerating = isPRDGenerating || sectionsStillRunning;

    // A settled run can still hold a failed section (the pipeline returns a
    // partial PRD without setting generationError). Keep the progress timeline
    // — and its Run again affordance — visible while any section is in error.
    const hasFailedSection = !!prdSectionStatus && Object.values(prdSectionStatus).some(
        (s) => s && s.status === 'error',
    );
    const showProgressTimeline = isPRDActivelyGenerating || hasFailedSection;
    const timelineSteps = buildGenerationSteps(prdSectionStatus ?? {});

    // Failed sections persisted with the final result. Unlike the transient
    // prdSectionStatus grid (stripped from persistence), this survives a
    // refresh — it drives the incomplete-PRD banner with per-section retry.
    const persistedFailedSections = (activeSpine?.generationMeta?.failedSections ?? [])
        .filter((id): id is SectionId => id in SECTION_TITLES);
    const projectArtifacts = getArtifacts(projectId);
    const generatedOutputs = projectArtifacts.filter(artifact =>
        artifact.type !== 'prd' && artifact.status !== 'archived' && !!artifact.currentVersionId,
    );
    const currentReadinessArtifactRefs = projectArtifacts
        .filter(artifact => artifact.status !== 'archived')
        .flatMap(artifact => {
            const versions = getArtifactVersions(projectId, artifact.id);
            const version = artifact.currentVersionId
                ? versions.find(item => item.id === artifact.currentVersionId)
                : versions.find(item => item.isPreferred);
            return version ? [{
                artifactId: artifact.id,
                artifactVersionId: version.id,
                contentHash: hashReviewValue(version.content),
            }] : [];
        });
    const currentReviewArtifacts = projectArtifacts.flatMap(artifact => {
        if (artifact.type !== 'core_artifact' || !artifact.subtype || !artifact.currentVersionId) return [];
        const version = getArtifactVersions(projectId, artifact.id).find(item => item.id === artifact.currentVersionId);
        return version ? [{
            artifactId: artifact.id,
            versionId: version.id,
            subtype: artifact.subtype,
            title: artifact.title,
            content: version.content,
        }] : [];
    });
    const currentChallengeContextSignature = project && activeSpine?.structuredPRD
        ? buildReviewContextManifest({
            projectId,
            projectName: project.name,
            platform: project.platform,
            productCategory: project.productCategory,
            spine: {
                versionId: activeSpine.id,
                schemaVersion: activeSpine.prdVersion,
                content: activeSpine.responseText,
                structuredPRD: activeSpine.structuredPRD,
                canonicalSpine: activeSpine.canonicalSpine,
            },
            artifacts: currentReviewArtifacts,
            safetyBoundaries: activeSpine.safetyReview?.detectedConcerns ?? [],
        }).contextSignature
        : undefined;
    // Readiness only counts consequential unresolved alignment. Historical
    // version drift, legacy provenance gaps, and changes outside an output's
    // main planning inputs stay visible for review without blocking build.
    const outputAlignment = getProjectOutputAlignment(projectId);
    // Update plans bind to the latest planning spine. When the user is
    // inspecting an older PRD version, do not project today's review choices
    // into that historical planning context.
    const downstreamUpdatePlanSummary = activeSpine?.id === latestSpine?.id
        ? getDownstreamUpdatePlanSummary(projectId)
        : undefined;
    const staleOutputCount = outputAlignment.blockingCount;
    const readinessReviewInput = activeSpine ? {
        projectId,
        spine: {
            versionId: activeSpine.id,
            content: activeSpine.responseText,
            structuredPRD: activeSpine.structuredPRD,
            incompleteSectionCount: activeSpine.generationMeta?.failedSections?.length ?? 0,
            isCommitted: activeSpine.isFinal,
            safetyReview: activeSpine.safetyReview && {
                status: activeSpine.safetyReview.status,
                classification: activeSpine.safetyReview.classification,
                detectedConcerns: activeSpine.safetyReview.detectedConcerns,
                reviewedAt: activeSpine.safetyReview.reviewedAt,
            },
        },
        planningRecords,
        reviewRuns,
        specialistRuns,
        reviewIssues,
        reviewFindings,
        outputAlignment,
        downstreamUpdatePlanSummary,
        currentArtifactRefs: currentReadinessArtifactRefs,
        currentChallengeContextSignature,
    } : undefined;
    const readinessWithCurrentness = readinessReviewInput
        ? readinessReviews.map(review => ({
            review,
            currentness: compareReadinessReviewCurrentness(review, readinessReviewInput),
            commitment: deriveReadinessCommitmentState(review, readinessCommitmentEvents),
        }))
        : [];
    const currentCommittedReadiness = readinessWithCurrentness
        .filter(item => commitmentRemainsCurrent(item.currentness) && item.commitment.activeCommit)
        .sort((a, b) => b.commitment.activeCommit!.at - a.commitment.activeCommit!.at)[0];
    const isCurrentPlanCommitted = !!currentCommittedReadiness;
    const hasReadinessCommitmentHistory = readinessWithCurrentness.some(item => item.commitment.latestCommit);
    const hasPhase3ReadinessProvenance = !!activeSpine && hasReadinessProvenanceForSpine(
        readinessReviews, readinessCommitmentEvents, activeSpine.id,
    );
    const isLegacyPlanCommitted = !!activeSpine?.isFinal && !hasPhase3ReadinessProvenance;
    const isCommitmentUnverifiable = !!activeSpine?.isFinal
        && hasPhase3ReadinessProvenance
        && !isCurrentPlanCommitted
        && !hasReadinessCommitmentHistory;
    const displaysCurrentCommitment = isCurrentPlanCommitted || isLegacyPlanCommitted;
    const strictChallenge = readinessReviewInput
        ? deriveReadinessChallengeState(readinessReviewInput)
        : undefined;
    const planningReadinessInput = {
        prd: activeSpine?.structuredPRD,
        planningRecords,
        incompleteSectionCount: persistedFailedSections.length,
        hasCurrentChallenge: !!strictChallenge?.substantive,
        blockingReviewIssueCount:
            (strictChallenge?.blockingIssues.length ?? 0)
            + (strictChallenge?.untriagedFindings.length ?? 0),
        generatedOutputCount: generatedOutputs.length,
        staleOutputCount,
        downstreamUpdatePlanSummary,
        isCommitted: displaysCurrentCommitment,
        currentSpineVersionId: activeSpine?.id,
        currentSpineContentHash: activeSpine ? planningContentHash(activeSpine.structuredPRD ?? activeSpine.responseText) : undefined,
    };
    const planningReadiness = derivePlanningReadiness(planningReadinessInput);
    // The optional specialist critique (Challenge → Findings) stays locked until
    // every surfaced decision is addressed (answered or deferred/skipped).
    const critiqueUnlocked = planningReadiness.openDecisionCount === 0;
    const planningAttention = derivePlanningAttention({
        ...planningReadinessInput,
        reviewIssues,
        outputAlignments: outputAlignment.outputs,
    });
    const answerableAssumptions = deriveAnswerableAssumptionRecords(planningReadinessInput);
    const selectedReadinessReview = readinessReviews.find(review => review.id === selectedReadinessReviewId);
    const selectedReadinessCurrentness = selectedReadinessReview && readinessReviewInput
        ? compareReadinessReviewCurrentness(selectedReadinessReview, readinessReviewInput)
        : undefined;
    const selectedReadinessVersionLabel = selectedReadinessReview
        ? (() => {
            const index = allSpines.findIndex(spine => spine.id === selectedReadinessReview.spineVersionId);
            return index >= 0 ? `Version ${index + 1}` : selectedReadinessReview.spineVersionId;
        })()
        : undefined;
    const readinessComparisonSummary = selectedReadinessReview
        && selectedReadinessCurrentness
        && !selectedReadinessCurrentness.current
        && selectedReadinessCurrentness.integrityValid
        && readinessReviewInput
        && activeSpine
        ? compareReadinessReviewProjections(
            selectedReadinessReview,
            deriveReadinessReview({ ...readinessReviewInput, createdAt: selectedReadinessReview.createdAt }),
            {
                reviewedVersionLabel: selectedReadinessVersionLabel,
                currentVersionLabel: (() => {
                    const index = allSpines.findIndex(spine => spine.id === activeSpine.id);
                    return index >= 0 ? `Version ${index + 1}` : activeSpine.id;
                })(),
            },
        )
        : undefined;
    const selectedReadinessView = selectedReadinessReview && selectedReadinessCurrentness
        ? buildReadinessCheckpointView(
            selectedReadinessReview,
            selectedReadinessCurrentness,
            readinessCommitmentEvents,
            selectedReadinessVersionLabel ?? selectedReadinessReview.spineVersionId,
            readinessComparisonSummary,
        )
        : undefined;

    // Optional preflight clarification: while a non-completed session exists and
    // no PRD has been produced (and the request isn't blocked), the workspace
    // hosts the clarification flow instead of the PRD/progress view.
    const showPreflight = !!activeSpine?.preflightSession
        && !activeSpine.preflightSession.completed
        && !activeSpine.structuredPRD
        && activeSpine.safetyReview?.status !== 'blocked';

    // Setup-stage design selection: right after clarification (or immediately,
    // on the Generate Immediately path), while PRD generation runs in the
    // background, a fresh project picks its visual direction with live preview
    // cards. Replaces the PRD/progress view until the user chooses or skips;
    // never shown for legacy projects, the demo, blocked spines, or failed runs
    // (see shouldShowDesignSetup). `hasFailedSection` additionally yields on a
    // *transient* section failure (the live grid errors before the persisted
    // failedSections meta lands on the spine) so the progress timeline's
    // "Run again" affordance is never hidden behind the setup step.
    const showDesignSetup = !showPreflight && !isOldVersion && !hasFailedSection
        && shouldShowDesignSetup(project, activeSpine);

    // Idea + clarification text feeding the rule-based preset recommendation.
    const designRecommendationText = showDesignSetup
        ? [
            activeSpine?.promptText,
            activeSpine?.preflightSession?.summary,
            ...(activeSpine?.preflightSession?.questions.map((q) => q.answer ?? '') ?? []),
        ].filter(Boolean).join('\n')
        : '';


    // Human-friendly version label
    const getVersionLabel = (spineId: string) => {
        const idx = allSpines.findIndex(s => s.id === spineId);
        return idx >= 0 ? `Version ${idx + 1}` : spineId;
    };

    // --- PRD version history / revert -------------------------------------
    // Build the version list (current first) for the history panel.
    const prdVersionEntries: VersionEntry[] = [...allSpines]
        .map((s, idx) => ({
            id: s.id,
            label: `Version ${idx + 1}`,
            isCurrent: s.isLatest,
            createdAt: s.createdAt,
            changeSource: s.provenance?.changeSource,
            editSummary: s.provenance?.editSummary,
            consistencyReview: summarizeConsistencyReview(s.generationMeta?.consistencyReview) ?? undefined,
        }))
        .reverse();

    // Downstream artifacts that would be marked possibly outdated if a different
    // PRD version becomes latest — i.e. those currently in sync with the latest
    // spine. Used to warn in the revert confirmation.
    const getStaleArtifactTitles = (): string[] => {
        if (!projectId) return [];
        // Artifacts currently in sync with the latest spine (up_to_date) are
        // exactly the ones a revert to a different PRD version will invalidate.
        const { context, evaluations } = evaluateProjectFreshness(useProjectStore.getState(), projectId);
        const titles: string[] = [];
        for (const [slot, artifactId] of Object.entries(context.artifactIdBySlot)) {
            if (!artifactId) continue;
            if (evaluations.get(slot as DependencyNodeId)?.status !== 'up_to_date') continue;
            const artifact = getArtifact(projectId, artifactId);
            if (artifact) titles.push(artifact.title);
        }
        return titles;
    };

    const handleRestoreSpine = (sourceSpineId: string) => {
        if (!canPerformProjectAction(projectId, 'persist')) return;
        revertSpineToVersion(projectId, sourceSpineId);
        // Return to the (new) latest version after restoring.
        setViewedSpineId(null);
        setBannerRestoreOpen(false);
        setBannerCompareOpen(false);
    };

    // Human-friendly label for artifact-based history events (e.g. mockups)
    const ARTIFACT_TYPE_LABELS: Record<string, string> = {
        prd: 'PRD',
        mockup: 'Mockup',
        prompt: 'Prompt',
        core_artifact: 'Artifact',
        markup_image: 'Markup',
    };
    const getArtifactEventLabel = (artifactId: string, artifactVersionId?: string) => {
        const artifact = getArtifact(projectId, artifactId);
        if (!artifact) return 'N/A';
        const typeLabel = ARTIFACT_TYPE_LABELS[artifact.type] ?? 'Artifact';
        if (!artifactVersionId) return typeLabel;
        const versions = getArtifactVersions(projectId, artifactId);
        const version = versions.find(v => v.id === artifactVersionId);
        return version ? `${typeLabel} v${version.versionNumber}` : typeLabel;
    };

    if (!project) return <div>Project Not Found</div>;

    const handleAbandon = () => {
        if (window.confirm('Abandon this project and return to the home screen?')) {
            navigate('/');
        }
    };

    const handleRegenerate = async () => {
        // Ref guard, not just `isGenerating`: two clicks in the same tick both
        // see the stale React state and would launch two concurrent pipelines
        // whose results interleave on different spines.
        if (regenerateInFlight.current) return;
        if (!projectId || !canPerformProjectAction(projectId, 'generate') || !latestSpine || isGenerating || hasBranches || isOldVersion) return;
        regenerateInFlight.current = true;
        let activeNewSpineId: string | null = null;
        try {
            setIsGenerating(true);
            artifactJobController.cancelAll(projectId);
            useProjectStore.getState().clearJob(projectId);
            clearPrdProgress(projectId);
            clearSectionStatus(projectId);
            const { newSpineId } = regenerateSpine(projectId);
            activeNewSpineId = newSpineId;
            useProjectStore.getState().markSpineGenerationStarted(projectId, newSpineId);
            const sourcePrompt = latestSpine.promptText;
            await generateStructuredPRD(
                sourcePrompt,
                {
                    projectName: project?.name,
                    onProgress: (message) => appendPrdProgress(projectId, message),
                    onSectionStatus: (sectionId, update) => setSectionStatus(projectId, sectionId, update),
                    onWorkflowRun: (run) => {
                        useProjectStore.getState().recordWorkflowRun({
                            ...run,
                            projectId,
                            projectName: project?.name,
                        });
                    },
                    onPartial: ({ structuredPRD, markdown }) => {
                        updateSpineStructuredPRD(
                            projectId,
                            newSpineId,
                            structuredPRD,
                            markdown,
                            { sourcePrompt },
                        );
                        if (structuredPRD.productName || structuredPRD.productCategory) {
                            updateProjectProductMetadata(projectId, {
                                productName: structuredPRD.productName,
                                productCategory: structuredPRD.productCategory,
                            });
                        }
                    },
                    onResult: ({ structuredPRD, markdown, generationMeta, model }) => {
                        updateSpineStructuredPRD(
                            projectId,
                            newSpineId,
                            structuredPRD,
                            markdown,
                            {
                                sourcePrompt,
                                generationMeta,
                                model,
                                prdVersion: generationMeta.schemaVersion,
                            },
                        );
                    },
                    onSafety: (safety) => {
                        if (safety.classification === 'allowed_with_restrictions') {
                            setSpineSafetyReview(
                                projectId,
                                newSpineId,
                                buildRestrictedSafetyReview(safety),
                            );
                        }
                    },
                },
                project?.platform,
            );
        } catch (e) {
            // Disallowed → store a blocked Safety Review instead of an error.
            if (e instanceof SafetyBlockedError && activeNewSpineId) {
                setSpineSafetyReview(
                    projectId,
                    activeNewSpineId,
                    buildBlockedSafetyReview(e.result),
                    buildSafetyReviewMarkdown(e.result),
                );
                return;
            }
            const err = normalizeError(e);
            console.error('[PRD regeneration failed]', err.raw);
            if (activeNewSpineId) {
                setSpineError(projectId, activeNewSpineId, {
                    message: userMessage(err),
                    category: err.category,
                    timestamp: err.timestamp,
                    raw: err.raw,
                });
            }
        } finally {
            regenerateInFlight.current = false;
            setIsGenerating(false);
        }
    };

    // Re-run a single failed section, merging the new slice back into the
    // current spine's PRD while leaving every other section intact.
    const handleRetrySection = async (sectionId: string) => {
        if (!projectId || !activeSpine?.structuredPRD || isOldVersion || retryingStepId) return;
        const sourcePrompt = activeSpine.promptText;
        const id = sectionId as SectionId;
        const title = SECTION_TITLES[id] ?? sectionId;
        try {
            setRetryingStepId(sectionId);
            appendPrdProgress(projectId, `↻ Retrying ${title}…`);
            // Carry the incremented retry count through this run so the progress
            // UI can show a "Retried ×N" badge. Computed once from the current
            // entry and stamped on the first ('generating') status emission.
            const nextRetryCount = (prdSectionStatus?.[id]?.retryCount ?? 0) + 1;
            let retryCountStamped = false;
            const { structuredPRD, model, ms } = await regeneratePrdSection(
                id,
                sourcePrompt,
                activeSpine.structuredPRD,
                {
                    platform: project?.platform,
                    // Restricted projects must retry under the same binding
                    // safety constraints the original run used.
                    safetyReview: activeSpine.safetyReview,
                    onSectionStatus: (sid, update) => {
                        const enriched = !retryCountStamped
                            ? { ...update, retryCount: nextRetryCount }
                            : update;
                        if (!retryCountStamped) retryCountStamped = true;
                        setSectionStatus(projectId, sid, enriched);
                    },
                },
            );
            // A section retry appends a new version (preserving the prior
            // content) rather than mutating the spine in place.
            const appendResult = compareAndAppendStructuredPRD(projectId, activeSpine.id, structuredPRD, {
                changeSource: 'ai_section_retry',
                editSummary: `Regenerated section: ${title}`,
                meta: {
                    sourcePrompt,
                    model,
                    // A successful retry resolves this section — drop it from the
                    // persisted failed list so the incomplete-PRD banner shrinks.
                    ...(activeSpine.generationMeta?.failedSections?.includes(id)
                        ? {
                            generationMeta: {
                                ...activeSpine.generationMeta,
                                failedSections: activeSpine.generationMeta.failedSections.filter(s => s !== id),
                            },
                        }
                        : {}),
                },
            });
            if (appendResult.status === 'stale') {
                setSectionStatus(projectId, id, { status: 'error', error: 'The PRD changed before this retry could be saved. Retry on the latest version.' });
                appendPrdProgress(projectId, `↻ ${title} finished, but the PRD changed — run it again on the latest version.`);
                return;
            }
            if (id === 'product_basics' && (structuredPRD.productName || structuredPRD.productCategory)) {
                updateProjectProductMetadata(projectId, {
                    productName: structuredPRD.productName,
                    productCategory: structuredPRD.productCategory,
                });
            }
            appendPrdProgress(projectId, `✓ ${title} · ${(ms / 1000).toFixed(1)}s`);
        } catch (e) {
            // onSectionStatus already marked the section 'error', so the Run
            // again button stays visible. Surface the message in the log.
            const err = normalizeError(e);
            console.error('[PRD section retry failed]', err.raw);
            appendPrdProgress(projectId, `✕ ${title} failed`);
        } finally {
            setRetryingStepId(null);
        }
    };

    const handleApplyFeedback = (feedback: FeedbackItem) => {
        if (!projectId || !canPerformProjectAction(projectId, 'persist') || !latestSpine) return;
        const intent = `[Feedback: ${feedback.title}] ${feedback.description}`;
        storCreateBranch(projectId, latestSpine.id, feedback.title, intent);
        updateFeedbackStatus(projectId, feedback.id, 'accepted');
        setActiveRightTab('branches');
        setIsBranchesVisible(true);
    };

    // True once every build output already has a generated version. This is an
    // output-completion signal only; it is intentionally unrelated to planning
    // readiness.
    const assetsReady = !!activeSpine?.structuredPRD && (() => {
        // Hidden artifacts (generated for downstream use but not surfaced in the
        // assets list) must not gate readiness — the user has no row to see or
        // retry them, so a hidden slot erroring would otherwise leave the
        // output transition stuck reporting "outputs are being created".
        const coreReady = CORE_ARTIFACT_DISPLAY_ORDER
            // Retired subtypes (prompt_pack) no longer generate at all, so
            // they must not gate readiness either.
            .filter(meta => !isHiddenArtifactSubtype(meta.subtype) && !isRetiredArtifactSubtype(meta.subtype))
            .every(meta =>
                getArtifacts(projectId, 'core_artifact').some(a => a.subtype === meta.subtype && a.currentVersionId),
            );
        const mockupReady = getArtifacts(projectId, 'mockup').some(a => a.currentVersionId);
        return coreReady && mockupReady;
    })();

    // Post-commitment output affordance. Commitment alone creates no outputs;
    // the user retains an explicit route to generate or inspect them.
    const assetsBuilding = !!assetJob && Object.values(assetJob.slots).some(
        (s) => s.status === 'generating' || s.status === 'queued',
    );
    const showAssetsPill = displaysCurrentCommitment
        && !!activeSpine?.structuredPRD
        && activeSpine?.safetyReview?.status !== 'blocked'
        && !isOldVersion
        && pipelineStage !== 'workspace';

    const readinessFailureMessage = (reason: string): string => {
        if (reason === 'stale') return 'The plan or its evidence changed. Review the current plan before committing.';
        if (reason === 'tampered' || reason === 'hash_mismatch') return 'This checkpoint no longer passes its integrity check. Create a fresh checkpoint.';
        if (reason === 'accepted_concerns_mismatch') return 'The set of open items changed. Create a fresh checkpoint before committing.';
        if (reason === 'authorization_consumed') return 'That commitment authorization was already used. Review and authorize this checkpoint again.';
        if (reason === 'rationale_required') return 'Explain why proceeding is worth the remaining uncertainty.';
        if (reason === 'containment_required') return 'Describe how the remaining implementation risk will be contained.';
        if (reason === 'safety_blocked') return 'A safety-blocked plan cannot be committed.';
        if (reason === 'already_committed') return 'A current plan commitment already exists.';
        return 'Synapse could not record this commitment. Review the current plan and try again.';
    };

    const openCurrentReadinessCheckpoint = () => {
        if (!projectId || !activeSpine || !canPerformProjectAction(projectId, 'persist')) return;
        setReadinessSubmitError(null);
        const result = createReadinessReview(projectId);
        if (result.status === 'created') {
            writePlanningIntent({ destination: { kind: 'readiness', reviewId: result.reviewId } });
            setReadinessInitialConcernId(undefined);
            setSelectedReadinessReviewId(result.reviewId);
            return;
        }
        setReadinessSubmitError(readinessFailureMessage(result.reason));
    };

    const commitSelectedReadiness = (override?: ReadinessOverrideInput) => {
        if (!projectId || !selectedReadinessReview) return;
        setIsReadinessSubmitting(true);
        setReadinessSubmitError(null);
        try {
            const authorization = authorizeReadinessCommitment(projectId, selectedReadinessReview.id, {
                expectedIntegrityHash: selectedReadinessReview.integrityHash,
                expectedAggregateHash: selectedReadinessReview.snapshotHashes.aggregate,
                acceptedConcernIds: selectedReadinessReview.concerns.map(concern => concern.id),
                rationale: override?.rationale,
                containmentPlan: override?.containment,
            });
            if (authorization.status === 'rejected') {
                setReadinessSubmitError(readinessFailureMessage(authorization.reason));
                return;
            }
            const commitment = commitReadinessReview(
                projectId,
                selectedReadinessReview.id,
                authorization.authorizationEventId,
            );
            if (commitment.status === 'rejected') {
                setReadinessSubmitError(readinessFailureMessage(commitment.reason));
                return;
            }
            setSelectedReadinessReviewId(null);
            writePlanningIntent(undefined, true);
            setShowFinalizeSuccess(true);
        } finally {
            setIsReadinessSubmitting(false);
        }
    };

    const handleToggleFinal = () => {
        if (!projectId || !canPerformProjectAction(projectId, 'persist') || !activeSpine) return;
        // Safety-blocked spines can never be committed.
        if (activeSpine.safetyReview?.status === 'blocked') return;
        const activeCommit = currentCommittedReadiness?.commitment.activeCommit;
        if (activeCommit) {
            const result = reopenReadinessCommitment(projectId, activeCommit.id);
            if (result.status === 'rejected') setReadinessSubmitError(readinessFailureMessage(result.reason));
            return;
        }
        if (isLegacyPlanCommitted) {
            // Legacy commitments remain reversible without fabricating a
            // readiness review or user rationale that never existed.
            markSpineFinal(projectId, activeSpine.id, false);
            return;
        }
        openCurrentReadinessCheckpoint();
    };

    const startAssetGeneration = () => {
        if (!projectId || !activeSpine?.structuredPRD || capabilities.isReadOnly) return;
        artifactJobController.startAll({
            projectId,
            spineVersionId: activeSpine.id,
            prdContent: activeSpine.responseText,
            structuredPRD: activeSpine.structuredPRD,
            projectPlatform: project?.platform,
            acknowledgeIncomplete: (activeSpine.generationMeta?.failedSections?.length ?? 0) > 0,
        });
        setShowFinalizeSuccess(false);
        setFinalizeAutoOpen(true);
        setProjectStage(projectId, 'workspace');
    };

    const handleChooseDesignSystemPreset = (presetId: string) => {
        if (!projectId) return;
        // Persist the choice synchronously so the generation pipeline reads it
        // off the project when design_system runs.
        setProjectDesignSystemPreset(projectId, presetId);
        setShowPresetChoice(false);
        if (generateAfterPreset.current) startAssetGeneration();
        generateAfterPreset.current = false;
    };

    // "Open Assets" from the success modal: navigate to the Assets stage and
    // arm the one-shot auto-open intent so ArtifactWorkspace opens the panel
    // and selects the first non-PRD artifact instead of defaulting to the PRD.
    const handleOpenAssets = () => {
        if (!projectId) return;
        setShowFinalizeSuccess(false);
        setFinalizeAutoOpen(true);
        setProjectStage(projectId, 'workspace');
    };

    const handleGenerateAssets = () => {
        if (!projectId || !activeSpine?.structuredPRD || capabilities.isReadOnly) return handleOpenAssets();
        if (!project?.designSystemPreset) {
            generateAfterPreset.current = true;
            // Close the finalize modal before opening the preset picker; otherwise
            // the finalize card renders on top of the picker and covers/intercepts
            // its preset options.
            setShowFinalizeSuccess(false);
            setShowPresetChoice(true);
            return;
        }
        startAssetGeneration();
    };

    const openDecisionCenter = (recordId?: string, returnTo?: PlanningReturnTarget) => {
        setReviewInitialTab('decisions');
        setReviewInitialRecordId(recordId);
        setReviewInitialRunId(undefined);
        setReviewInitialIssueId(undefined);
        setReviewInitialFindingId(undefined);
        writePlanningIntent(recordId
            ? { destination: { kind: 'planning_record', recordId }, ...(returnTo ? { returnTo } : {}) }
            : { destination: { kind: 'decision_center' }, ...(returnTo ? { returnTo } : {}) });
        setPipelineStage('review');
    };

    const openChallenge = (reviewId?: string, issueId?: string, findingId?: string, returnTo?: PlanningReturnTarget) => {
        setReviewInitialTab('review');
        setReviewInitialRecordId(undefined);
        setReviewInitialRunId(reviewId);
        setReviewInitialIssueId(issueId);
        setReviewInitialFindingId(findingId);
        writePlanningIntent({
            destination: { kind: 'challenge', reviewId, issueId, findingId },
            ...(returnTo ? { returnTo } : {}),
        });
        setPipelineStage('review');
    };

    const navigateReadinessTarget = (target: ReadinessActionTarget, concernId?: string) => {
        const returnTo: PlanningReturnTarget | undefined = selectedReadinessReview ? {
            destination: {
                kind: 'readiness',
                reviewId: selectedReadinessReview.id,
                ...(concernId ? { concernId } : {}),
            },
            label: 'Return to readiness review',
        } : undefined;
        setSelectedReadinessReviewId(null);
        setReadinessSubmitError(null);
        const destination = readinessNavigationDestination(target);
        if (destination.stage === 'review' && destination.tab === 'decisions') {
            return openDecisionCenter(destination.planningRecordId, returnTo);
        }
        if (destination.stage === 'review') return openChallenge(destination.reviewId, destination.issueId, destination.findingId, returnTo);
        if (destination.stage === 'workspace') {
            setFinalizeAutoOpen(false);
            setWorkspaceInitialNode(destination.nodeId);
            setWorkspaceInitialArtifactId(destination.artifactId);
            setWorkspaceInitialUpdatePlanId(destination.updatePlanId);
            setWorkspaceInitialUpdatePlanItemId(destination.updatePlanItemId);
            writePlanningIntent({
                destination: destination.updatePlanId
                    ? {
                        kind: 'update_plan', planId: destination.updatePlanId, itemId: destination.updatePlanItemId,
                        nodeId: destination.nodeId, artifactId: destination.artifactId,
                    }
                    : { kind: 'artifact', nodeId: destination.nodeId, artifactId: destination.artifactId },
                ...(returnTo ? { returnTo } : {}),
            });
            return setPipelineStage('workspace');
        }
        writePlanningIntent({
            destination: { kind: 'prd', anchorId: destination.anchorId },
            ...(returnTo ? { returnTo } : {}),
        });
        setPipelineStage('prd');
        window.requestAnimationFrame(() => {
            document.getElementById(destination.anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    };

    const handleReadinessConcern = (concernId: string) => {
        const concern = selectedReadinessReview?.concerns.find(item => item.id === concernId);
        if (concern) navigateReadinessTarget(concern.actionTarget, concernId);
    };

    // Every jump that starts from the Plan stage carries an explicit way back,
    // so resolving a decision in Challenge never strands the user there.
    const planReturnTarget: PlanningReturnTarget = { destination: { kind: 'prd' }, label: 'Back to Plan' };

    const handlePlanningNextAction = () => {
        const kind = planningReadiness.nextAction.kind;
        if (kind === 'resolve_decision' || kind === 'validate_assumption' || kind === 'review_source_change' || kind === 'align_plan') return openDecisionCenter(planningReadiness.nextAction.planningRecordId, planReturnTarget);
        if (kind === 'challenge_plan') return openChallenge(undefined, undefined, undefined, planReturnTarget);
        if (kind === 'align_outputs') {
            if (planningReadiness.nextAction.nodeId) setWorkspaceInitialNode(planningReadiness.nextAction.nodeId);
            if (planningReadiness.nextAction.artifactId) setWorkspaceInitialArtifactId(planningReadiness.nextAction.artifactId);
            return setPipelineStage('workspace');
        }
        if (kind === 'commit_plan') return handleToggleFinal();
        const anchor = kind === 'confirm_scope' ? 'prd-features' : 'prd-coreProblem';
        document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const openPlanningAttention = (destination: PlanningDestination) => {
        writePlanningIntent(destination.kind === 'prd'
            ? { destination }
            : { destination, returnTo: planReturnTarget });
    };

    const handleExport = () => {
        setIsExportOpen(true);
    };

    const headerPlanStatus = activeSpine?.safetyReview?.status === 'blocked'
        ? 'Blocked'
        : activeSpine?.generationError
            ? 'Generation failed'
            : isPRDActivelyGenerating
                ? 'Generating…'
                : isCommitmentUnverifiable
                    ? 'Readiness unavailable'
                    : displaysCurrentCommitment
                        ? isLegacyPlanCommitted
                            ? 'Legacy commitment · readiness not recorded'
                            : currentCommittedReadiness?.review.conclusion === 'not_ready'
                                ? 'Proceeding with accepted risk'
                                : 'Plan committed'
                        : 'Working plan';

    return (
        <div className="flex h-screen flex-col overflow-x-hidden bg-neutral-900 text-neutral-100">

            {/* Top Navigation Bar — shrink-0, no absolute */}
            <div className="shrink-0 h-14 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between px-4 z-10">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                    <button
                        onClick={() => navigate('/')}
                        className="p-1 hover:bg-neutral-800 rounded-md transition text-neutral-400 shrink-0"
                        title="Back to projects"
                        aria-label="Back to projects"
                    >
                        <ChevronLeft size={20} />
                    </button>
                    <span className="font-semibold truncate">{project.name}</span>
                    <span className={`max-w-[44vw] truncate whitespace-nowrap rounded px-2 py-0.5 text-xs md:max-w-none md:shrink-0 ${activeSpine?.safetyReview?.status === 'blocked' ? 'bg-amber-900/30 text-amber-400 border border-amber-800' : isCommitmentUnverifiable ? 'bg-red-900/30 text-red-300 border border-red-800' : currentCommittedReadiness?.review.conclusion === 'not_ready' ? 'bg-amber-900/30 text-amber-300 border border-amber-800' : isCurrentPlanCommitted ? 'bg-green-900/30 text-green-400 border border-green-800' : isLegacyPlanCommitted ? 'bg-neutral-800 text-neutral-300 border border-neutral-700' : activeSpine?.generationError ? 'bg-red-900/30 text-red-400 border border-red-800' : isPRDActivelyGenerating ? 'bg-indigo-900/30 text-indigo-400 border border-indigo-800' : 'bg-neutral-800 text-neutral-400'}`}>
                        {activeSpine ? `${getVersionLabel(activeSpine.id)} · ${headerPlanStatus}` : 'Initializing…'}
                    </span>
                    {!capabilities.isReadOnly && (
                        <span className="hidden md:inline-flex shrink-0">
                            <ProjectCloudStatus projectId={projectId} signedIn={!!authUser} />
                        </span>
                    )}
                </div>

                {/* Primary nav actions — always visible */}
                <div className="flex items-center gap-2 shrink-0">
                    {showAssetsPill && (
                        <button
                            onClick={assetsReady ? handleOpenAssets : handleGenerateAssets}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600/90 hover:bg-green-600 text-white rounded transition"
                            title="Generate or review outputs from this committed plan"
                        >
                            {assetsBuilding
                                ? <Loader2 size={14} className="animate-spin" />
                                : <ArrowRight size={14} />}
                            <span className="hidden sm:inline">
                                {assetsBuilding ? 'Building outputs…' : assetsReady ? 'Review outputs' : planningReadiness.isReadyToBuild ? 'Build outputs' : 'Explore outputs'}
                            </span>
                        </button>
                    )}
                    <button
                        onClick={handleExport}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded transition"
                        title="Export as Markdown"
                    >
                        <Download size={14} />
                        <span className="hidden sm:inline">Export</span>
                    </button>
                    {!isOldVersion && activeSpine?.safetyReview?.status !== 'blocked' && (
                        <button
                            onClick={handleToggleFinal}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded transition ${currentCommittedReadiness?.review.conclusion === 'not_ready' ? 'bg-amber-700 hover:bg-amber-600 text-white' : displaysCurrentCommitment ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'}`}
                            title={displaysCurrentCommitment ? "Reopen this plan for changes" : "Review readiness and commit this plan"}
                        >
                            <CheckCircle size={14} />
                            <span className="hidden md:inline">{displaysCurrentCommitment ? 'Reopen plan' : 'Review readiness'}</span>
                        </button>
                    )}

                    {/* Overflow menu for secondary actions. The dropdown is portaled to
                        document.body with fixed positioning so it can't be clipped by
                        any ancestor's overflow or stacking-context rules. */}
                    <div className="relative" ref={overflowRef}>
                        <button
                            ref={overflowButtonRef}
                            onClick={() => setShowNavOverflow(!showNavOverflow)}
                            className="p-2 text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-md transition"
                            title="More actions"
                            aria-label="More actions"
                            aria-expanded={showNavOverflow}
                        >
                            <MoreHorizontal size={18} />
                        </button>
                        {showNavOverflow && overflowMenuPos && createPortal(
                            <div
                                ref={overflowMenuRef}
                                role="menu"
                                style={{ position: 'fixed', top: overflowMenuPos.top, right: overflowMenuPos.right }}
                                className="bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl py-1 z-[1000] min-w-[180px]"
                            >
                                <button
                                    onClick={() => { setIsSettingsOpen(true); setShowNavOverflow(false); }}
                                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-neutral-300 hover:bg-white/5 transition border-b border-white/5"
                                >
                                    <Settings size={14} className="text-indigo-400" />
                                    Project Settings
                                </button>
                                <button
                                    onClick={() => { setIsSnapshotsOpen(true); setShowNavOverflow(false); }}
                                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-neutral-300 hover:bg-white/5 transition border-b border-white/5"
                                >
                                    <Cloud size={14} className="text-indigo-400" />
                                    Cloud Snapshots
                                </button>
                                <button
                                    onClick={() => { handleRegenerate(); setShowNavOverflow(false); }}
                                    disabled={isGenerating || hasBranches || isOldVersion}
                                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-neutral-300 hover:bg-white/5 transition disabled:opacity-30 disabled:hover:bg-transparent"
                                >
                                    <RefreshCcw size={14} className={`text-neutral-500 ${isGenerating ? 'animate-spin' : ''}`} />
                                    {isGenerating ? 'Regenerating...' : 'Regenerate Draft'}
                                </button>
                                <button
                                    onClick={() => { setShowPrdHistory(true); setShowNavOverflow(false); }}
                                    disabled={allSpines.length === 0}
                                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-neutral-300 hover:bg-white/5 transition border-b border-white/5 disabled:opacity-30 disabled:hover:bg-transparent"
                                >
                                    <History size={14} className="text-indigo-400" />
                                    Version History
                                </button>
                                <button
                                    onClick={() => { navigate('/metrics'); setShowNavOverflow(false); }}
                                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-neutral-300 hover:bg-white/5 transition border-b border-white/5"
                                >
                                    <Activity size={14} className="text-indigo-400" />
                                    Orchestration Metrics
                                </button>
                                <button
                                    onClick={() => { setIsBranchesVisible(!isBranchesVisible); setShowNavOverflow(false); }}
                                    className="hidden w-full items-center gap-2 px-4 py-2.5 text-sm text-neutral-300 transition hover:bg-white/5 md:flex"
                                >
                                    {isBranchesVisible ? <PanelRightClose size={14} className="text-neutral-500" /> : <PanelRightOpen size={14} className="text-neutral-500" />}
                                    {isBranchesVisible ? 'Hide Sidebar' : 'Show Sidebar'}
                                </button>
                                <div className="border-t border-white/5 my-1" />
                                <button
                                    onClick={() => { handleAbandon(); setShowNavOverflow(false); }}
                                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition"
                                >
                                    <LogOut size={14} />
                                    Abandon Session
                                </button>
                                {authUser && (
                                    <button
                                        onClick={async () => {
                                            setShowNavOverflow(false);
                                            try {
                                                await logout();
                                                // RequireAuth sends the now-signed-out user to "/".
                                            } catch (err) {
                                                console.error('[workspace sign out] failed', err);
                                            }
                                        }}
                                        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-neutral-300 hover:bg-white/5 transition border-t border-white/5"
                                    >
                                        <LogOut size={14} className="text-neutral-500" />
                                        Sign out
                                    </button>
                                )}
                            </div>,
                            document.body,
                        )}
                    </div>
                </div>
            </div>

            {selectedReadinessView && (
                <ReadinessCheckpoint
                    review={selectedReadinessView}
                    initialConcernId={readinessInitialConcernId}
                    submitting={isReadinessSubmitting}
                    submitError={readinessSubmitError}
                    onClose={() => {
                        setSelectedReadinessReviewId(null);
                        setReadinessInitialConcernId(undefined);
                        setReadinessSubmitError(null);
                        if (planningIntent?.destination.kind === 'readiness') writePlanningIntent(undefined, true);
                    }}
                    onAddressConcern={handleReadinessConcern}
                    onRefresh={openCurrentReadinessCheckpoint}
                    onCommitReady={() => commitSelectedReadiness()}
                    onCommitWithOpenQuestions={commitSelectedReadiness}
                />
            )}
            {showPresetChoice && (
                <DesignSystemPresetChoice
                    onChoose={handleChooseDesignSystemPreset}
                    onClose={() => {
                        generateAfterPreset.current = false;
                        setShowPresetChoice(false);
                    }}
                />
            )}
            {showFinalizeSuccess && (
                <FinalizationSuccessModal
                    assetsGenerated={assetsReady}
                    assetsBuilding={assetsBuilding}
                    readyToBuild={currentCommittedReadiness?.review.conclusion === 'ready_to_build'}
                    onOpenAssets={handleOpenAssets}
                    onGenerateAssets={handleGenerateAssets}
                    onClose={() => setShowFinalizeSuccess(false)}
                />
            )}
            {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
            {isExportOpen && projectId && <ExportModal projectId={projectId} planningReady={currentCommittedReadiness?.review.conclusion === 'ready_to_build'} onClose={() => setIsExportOpen(false)} />}
            {showPrdHistory && (
                <VersionHistoryPanel
                    title="PRD version history"
                    entries={prdVersionEntries}
                    restoreKind="prd"
                    getCompareInput={(id) => ({
                        kind: 'prd',
                        before: allSpines.find(s => s.id === id)?.structuredPRD,
                        after: latestSpine?.structuredPRD,
                    })}
                    getStaleArtifactTitles={getStaleArtifactTitles}
                    onRestore={handleRestoreSpine}
                    onClose={() => setShowPrdHistory(false)}
                />
            )}
            {bannerCompareOpen && activeSpine && (
                <VersionCompareView
                    input={{ kind: 'prd', before: activeSpine.structuredPRD, after: latestSpine?.structuredPRD }}
                    fromLabel={getVersionLabel(activeSpine.id)}
                    toLabel="Current"
                    onClose={() => setBannerCompareOpen(false)}
                    onRestore={() => { setBannerCompareOpen(false); setBannerRestoreOpen(true); }}
                />
            )}
            {bannerRestoreOpen && activeSpine && (
                <RevertConfirmModal
                    kind="prd"
                    sourceLabel={getVersionLabel(activeSpine.id)}
                    staleArtifactTitles={getStaleArtifactTitles()}
                    onCancel={() => setBannerRestoreOpen(false)}
                    onConfirm={() => handleRestoreSpine(activeSpine.id)}
                />
            )}
            {isSnapshotsOpen && projectId && (
                <SnapshotsPanel
                    projectId={projectId}
                    onClose={() => setIsSnapshotsOpen(false)}
                    onRestored={(restoredId) => {
                        // If a different project id was restored, navigate to it.
                        if (restoredId && restoredId !== projectId) navigate(`/p/${restoredId}`);
                    }}
                />
            )}

            {/* Pipeline Stage Bar — shrink-0, no absolute */}
            <div className="shrink-0 z-10">
                <PipelineStageBar
                    currentStage={pipelineStage}
                    onStageChange={handlePipelineStageChange}
                    canExploreOutputs={!!activeSpine?.structuredPRD && activeSpine.safetyReview?.status !== 'blocked'}
                    isReadyToBuild={planningReadiness.isReadyToBuild}
                    canReview={!!activeSpine?.structuredPRD && activeSpine.safetyReview?.status !== 'blocked'}
                />
            </div>

            {/* One workspace-level explanation; individual artifacts stay free
                of repetitive read-only warnings. */}
            {capabilities.isReadOnly && (
                <DemoReadOnlyNotice />
            )}

            {/* Cross-device conflict banner: the cloud copy changed on another
                device while this device has unsynced edits. Blocks silent
                overwrite — the user picks keep-local / use-cloud / download. */}
            {!capabilities.isReadOnly && authUser && (
                <div className="shrink-0 px-4 py-2 z-10 empty:hidden">
                    <ProjectConflictBanner projectId={projectId} />
                </div>
            )}

            {planningIntent?.returnTo && (
                <div className="shrink-0 border-b border-indigo-200 bg-indigo-50 px-4 py-2 text-sm text-indigo-950 z-10">
                    <button
                        type="button"
                        onClick={() => writePlanningIntent({ destination: planningIntent.returnTo!.destination }, true)}
                        className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 font-semibold hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                        <ChevronLeft size={16} /> {planningIntent.returnTo.label}
                    </button>
                </div>
            )}

            {/* Main Workspace Area — flex-1 fills remaining height */}
            <div className="flex-1 flex overflow-hidden">
                {pipelineStage === 'workspace' && activeSpine?.structuredPRD && activeSpine.safetyReview?.status !== 'blocked' ? (
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                        {/* The read-only demo already carries a workspace-level
                            banner; don't stack this exploratory-outputs notice on
                            top of it there (it can't be built anyway). */}
                        {!capabilities.isReadOnly && !planningReadiness.isReadyToBuild && (
                            <div className="shrink-0 border-b border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
                                <span className="font-semibold">Exploratory outputs.</span> Use early screens, flows, or technical concepts to think—but they are not evidence that this plan is ready to build.
                                <button type="button" onClick={() => setPipelineStage('prd')} className="ml-2 font-semibold underline underline-offset-2">Return to the plan</button>
                            </div>
                        )}
                        <ArtifactWorkspace
                            projectId={projectId}
                            spineVersionId={activeSpine.id}
                            prdContent={activeSpine.responseText}
                            structuredPRD={activeSpine.structuredPRD}
                            projectPlatform={project?.platform}
                            autoOpenIntent={finalizeAutoOpen}
                            onAutoOpenConsumed={() => setFinalizeAutoOpen(false)}
                            initialSelection={workspaceInitialNode}
                            initialArtifactId={workspaceInitialArtifactId}
                            initialRegion={workspaceInitialRegion}
                            initialUpdatePlanId={workspaceInitialUpdatePlanId}
                            initialUpdatePlanItemId={workspaceInitialUpdatePlanItemId}
                            onOpenPlanningRecord={openDecisionCenter}
                            onNavigatePlanning={intent => writePlanningIntent(intent)}
                            onInitialSelectionConsumed={() => {
                                setWorkspaceInitialNode(undefined);
                                setWorkspaceInitialArtifactId(undefined);
                                setWorkspaceInitialRegion(undefined);
                                setWorkspaceInitialUpdatePlanId(undefined);
                                setWorkspaceInitialUpdatePlanItemId(undefined);
                            }}
                        />
                    </div>
                ) : pipelineStage === 'review' && activeSpine?.structuredPRD && activeSpine.safetyReview?.status !== 'blocked' ? (
                    <ReviewWorkspaceContainer
                        projectId={projectId}
                        initialTab={reviewInitialTab}
                        initialRecordId={reviewInitialRecordId}
                        initialReviewId={reviewInitialRunId}
                        initialIssueId={reviewInitialIssueId}
                        initialFindingId={reviewInitialFindingId}
                        critiqueUnlocked={critiqueUnlocked}
                    />
                ) : (
                <>
                {/* Left: Main Content Column */}
                <div className="flex-1 min-w-0 bg-neutral-50 text-black overflow-y-auto p-4 md:p-8 lg:p-12 shadow-inner z-0 relative">
                    {isOldVersion && pipelineStage === 'prd' && (
                        <div className="sticky top-0 left-0 right-0 bg-yellow-100 border-b border-yellow-300 text-yellow-800 text-sm py-2 px-4 shadow-sm flex flex-wrap gap-2 justify-between items-center z-10 -mx-4 md:-mx-8 lg:-mx-12 -mt-4 md:-mt-8 lg:-mt-12 mb-4">
                            <span>You are viewing a historical version (Read-Only).</span>
                            <div className="flex items-center gap-3 shrink-0">
                                {activeSpine?.structuredPRD && latestSpine?.structuredPRD && (
                                    <button
                                        onClick={() => setBannerCompareOpen(true)}
                                        className="font-semibold underline hover:text-yellow-900"
                                    >
                                        Compare with current
                                    </button>
                                )}
                                <button
                                    onClick={() => setBannerRestoreOpen(true)}
                                    className="font-semibold underline hover:text-yellow-900"
                                >
                                    Restore this version
                                </button>
                                <button
                                    onClick={() => setViewedSpineId(null)}
                                    className="font-semibold underline hover:text-yellow-900"
                                >
                                    Return to Latest
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="max-w-4xl mx-auto mt-4">
                        {/* PRD Stage */}
                        {pipelineStage === 'prd' && showPreflight && activeSpine && (
                            <PreflightView
                                projectId={projectId}
                                spineId={activeSpine.id}
                                session={activeSpine.preflightSession!}
                                platform={project?.platform}
                            />
                        )}
                        {pipelineStage === 'prd' && showDesignSetup && activeSpine && (
                            <DesignSetupStep
                                projectId={projectId}
                                recommendationText={designRecommendationText}
                                prdGenerating={isPRDActivelyGenerating}
                            />
                        )}
                        {pipelineStage === 'prd' && !showPreflight && !showDesignSetup && (
                            <>
                                {/* Feedback items from mockups/artifacts */}
                                <FeedbackItemsList
                                    projectId={projectId}
                                    onApplyToPRD={handleApplyFeedback}
                                />

                                {activeSpine ? (
                                    <div className="bg-white rounded-2xl shadow-sm border border-neutral-200/80 p-4 sm:p-6 md:p-10 mb-8">
                                        {/* PRD generation progress timeline (initial gen, regen, or a
                                            settled run with a failed section awaiting retry). */}
                                        {(isGenerating || showProgressTimeline) && (
                                            <div className="mb-6">
                                                <ProgressTimeline
                                                    steps={timelineSteps}
                                                    messages={prdProgress?.messages}
                                                    onRetryStep={handleRetrySection}
                                                    retryingStepId={retryingStepId ?? undefined}
                                                    onViewHistory={() => setPipelineStage('history')}
                                                />
                                            </div>
                                        )}

                                        <div className="mb-8 bg-neutral-50/80 rounded-xl border border-neutral-200 transition-all overflow-hidden flex flex-col">
                                            <div
                                                className="flex items-center justify-between cursor-pointer p-3 select-none hover:bg-neutral-100 transition"
                                                onClick={() => setIsPromptCollapsed(!isPromptCollapsed)}
                                            >
                                                <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Initial Prompt</h3>
                                                <button className="text-neutral-400 hover:text-neutral-600 transition">
                                                    {isPromptCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                                                </button>
                                            </div>
                                            {!isPromptCollapsed && (
                                                <div className="px-4 pb-4 border-t border-neutral-200/50 pt-3">
                                                    <p className="whitespace-pre-wrap text-neutral-600 text-sm leading-relaxed">{activeSpine.promptText}</p>
                                                </div>
                                            )}
                                        </div>

                                        {/* Safety Boundaries card for restricted (allowed_with_restrictions) PRDs */}
                                        {activeSpine.safetyReview?.status === 'restricted' && (
                                            <SafetyBoundariesCard review={activeSpine.safetyReview} />
                                        )}

                                        {/* Partial result: some sections failed and were merged as
                                            empty stubs. Surfaced from the persisted generationMeta so
                                            the warning survives refresh; each button re-runs only
                                            that section. */}
                                        {activeSpine.safetyReview?.status !== 'blocked'
                                            && !activeSpine.generationError
                                            && activeSpine.structuredPRD
                                            && !isPRDActivelyGenerating
                                            && persistedFailedSections.length > 0 && (
                                            <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
                                                <p className="font-semibold text-amber-900 text-sm mb-1">
                                                    This PRD is incomplete — {persistedFailedSections.length} section{persistedFailedSections.length > 1 ? 's' : ''} failed to generate
                                                </p>
                                                <p className="text-sm text-amber-800 mb-3">
                                                    The rest of the document is intact. Re-run the missing sections below — each retry regenerates only that section.
                                                </p>
                                                <div className="flex flex-wrap gap-2">
                                                    {persistedFailedSections.map((sid) => (
                                                        <button
                                                            key={sid}
                                                            onClick={() => handleRetrySection(sid)}
                                                            disabled={!!retryingStepId || isOldVersion}
                                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-white border border-amber-300 text-amber-900 hover:bg-amber-100 transition disabled:opacity-40"
                                                        >
                                                            <RefreshCcw size={12} className={retryingStepId === sid ? 'animate-spin' : ''} />
                                                            {retryingStepId === sid ? 'Retrying…' : `Run again: ${SECTION_TITLES[sid]}`}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Blocked: dedicated Safety Review screen instead of any PRD layout */}
                                        {activeSpine.safetyReview?.status === 'blocked' ? (
                                            <SafetyReviewView
                                                review={activeSpine.safetyReview}
                                                canRevise={!isOldVersion && !hasBranches && !isGenerating}
                                                onRevise={handleRegenerate}
                                            />
                                        ) : activeSpine.generationError ? (
                                            <div className="rounded-xl border border-red-200 bg-red-50 p-6">
                                                <div className="flex items-start gap-3">
                                                    <div className="shrink-0 mt-0.5 w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
                                                        <RefreshCcw size={16} className="text-red-500" />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-semibold text-red-800 mb-1">PRD generation could not be completed</p>
                                                        <p className="text-sm text-red-700 mb-4 whitespace-pre-wrap break-words">{activeSpine.generationError.message}</p>
                                                        {activeSpine.generationError.raw && (
                                                            <details className="mb-4 text-xs">
                                                                <summary className="cursor-pointer font-medium text-red-700 hover:text-red-800 select-none">
                                                                    Show technical details
                                                                </summary>
                                                                <div className="mt-2 p-3 rounded-lg bg-red-100/60 border border-red-200 text-red-900 font-mono whitespace-pre-wrap break-words">
                                                                    <div className="text-[10px] uppercase tracking-wider text-red-700 mb-1">
                                                                        Category: {activeSpine.generationError.category}
                                                                    </div>
                                                                    {activeSpine.generationError.raw}
                                                                </div>
                                                            </details>
                                                        )}
                                                        <div className="flex items-center gap-3">
                                                            <button
                                                                onClick={handleRegenerate}
                                                                disabled={isGenerating || hasBranches}
                                                                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition disabled:opacity-40"
                                                            >
                                                                Try Again
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : isPRDGenerating ? (
                                            <div className="space-y-4 animate-pulse">
                                                <div className="h-5 bg-neutral-100 rounded w-2/5" />
                                                <div className="space-y-2.5">
                                                    <div className="h-3.5 bg-neutral-100 rounded w-full" />
                                                    <div className="h-3.5 bg-neutral-100 rounded w-11/12" />
                                                    <div className="h-3.5 bg-neutral-100 rounded w-4/5" />
                                                </div>
                                                <div className="h-5 bg-neutral-100 rounded w-1/3 mt-6" />
                                                <div className="space-y-2.5">
                                                    <div className="h-3.5 bg-neutral-100 rounded w-full" />
                                                    <div className="h-3.5 bg-neutral-100 rounded w-5/6" />
                                                </div>
                                            </div>
                                        ) : activeSpine.structuredPRD ? (
                                            <>
                                                {!isOldVersion && (sharpenQueueIds ? (
                                                    <SharpenPlanFlow
                                                        records={sharpenQueueIds.flatMap(id => {
                                                            const match = planningRecords.find(record => record.id === id);
                                                            return match ? [match] : [];
                                                        })}
                                                        onDecide={handleSharpenDecision}
                                                        onClose={() => setSharpenQueueIds(null)}
                                                        onOpenRecord={recordId => {
                                                            setSharpenQueueIds(null);
                                                            openDecisionCenter(recordId, planReturnTarget);
                                                        }}
                                                    />
                                                ) : (
                                                    <PlanningStateBar
                                                        readiness={planningReadiness}
                                                        planSummary={activeSpine.structuredPRD.executiveSummary ?? activeSpine.structuredPRD.vision}
                                                        committed={isCurrentPlanCommitted}
                                                        legacyCommitted={isLegacyPlanCommitted}
                                                        onNextAction={handlePlanningNextAction}
                                                        onReviewReadiness={openCurrentReadinessCheckpoint}
                                                        onOpenDecisions={() => openDecisionCenter(undefined, planReturnTarget)}
                                                        onOpenChallenge={() => openChallenge(undefined, undefined, undefined, planReturnTarget)}
                                                        attention={planningAttention}
                                                        onOpenAttention={openPlanningAttention}
                                                        answerableCount={answerableAssumptions.length}
                                                        onStartSharpen={canEditPlan && answerableAssumptions.length > 0
                                                            ? () => setSharpenQueueIds(answerableAssumptions.map(record => record.id))
                                                            : undefined}
                                                    />
                                                ))}
                                                <StructuredPRDView
                                                    projectId={projectId}
                                                    spineId={activeSpine.id}
                                                    structuredPRD={activeSpine.structuredPRD}
                                                    readOnly={isOldVersion || !canPerformProjectAction(projectId, 'persist')}
                                                    view={prdView}
                                                    onViewChange={setPrdView}
                                                    onOpenDecisions={(recordId, returnTo) => openDecisionCenter(recordId, returnTo ?? planReturnTarget)}
                                                />
                                            </>
                                        ) : (
                                            <div className="prose prose-neutral max-w-none">
                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                    {activeSpine.responseText}
                                                </ReactMarkdown>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="bg-white rounded-2xl shadow-sm border border-neutral-200/80 p-4 sm:p-6 md:p-10 mb-8">
                                        <ProgressTimeline
                                            steps={timelineSteps}
                                            messages={prdProgress?.messages}
                                            onRetryStep={handleRetrySection}
                                            retryingStepId={retryingStepId ?? undefined}
                                            onViewHistory={() => setPipelineStage('history')}
                                        />
                                        <div className="mt-6 space-y-4 animate-pulse">
                                            <div className="h-5 bg-neutral-100 rounded w-2/5" />
                                            <div className="space-y-2.5">
                                                <div className="h-3.5 bg-neutral-100 rounded w-full" />
                                                <div className="h-3.5 bg-neutral-100 rounded w-11/12" />
                                                <div className="h-3.5 bg-neutral-100 rounded w-4/5" />
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}

                        {/* History Stage */}
                        {pipelineStage === 'history' && (
                            <HistoryView projectId={projectId} />
                        )}
                    </div>
                </div>

                {/* Right Column: Combined Branches and History */}
                {isBranchesVisible && (
                    <div className="hidden md:flex w-72 lg:w-80 xl:w-96 shrink-0 bg-neutral-50 border-l border-neutral-200 flex-col shadow-sm z-10">
                        {/* Tabs */}
                        <div className="flex items-center border-b border-neutral-200 bg-white shadow-sm shrink-0">
                            <button
                                onClick={() => setActiveRightTab('branches')}
                                className={`flex-1 py-3 text-sm font-semibold transition flex items-center justify-center gap-2 ${activeRightTab === 'branches' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-neutral-500 hover:text-neutral-800'}`}
                            >
                                Active Branches {hasBranches && <span className="bg-indigo-100 text-indigo-700 py-0.5 px-1.5 rounded-full text-xs">{branches.length}</span>}
                            </button>
                            <button
                                onClick={() => setActiveRightTab('history')}
                                className={`flex-1 py-3 text-sm font-semibold transition ${activeRightTab === 'history' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-neutral-500 hover:text-neutral-800'}`}
                            >
                                History Mode
                            </button>
                        </div>

                        {/* Tab Content */}
                        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 relative">
                            {activeRightTab === 'branches' ? (
                                latestSpine ? (
                                    <BranchList
                                        projectId={projectId}
                                        spineVersionId={latestSpine.id}
                                        onConsolidate={(branch) => setConsolidatingBranch(branch)}
                                        onCanvasOpen={(branchId) => setActiveCanvasBranchId(branchId)}
                                    />
                                ) : (
                                    <div className="text-sm text-neutral-500 p-4 text-center border border-dashed border-neutral-300 rounded-lg bg-white shadow-sm mt-4 flex items-center justify-center gap-2">
                                        <span className="relative flex h-1.5 w-1.5">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-indigo-400" />
                                        </span>
                                        Preparing workspace...
                                    </div>
                                )
                            ) : (
                                <div ref={animationParent} className="flex flex-col gap-3">
                                    <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-1">Timeline</h4>
                                    {historyEvents.slice().reverse().map(event => {
                                        const isSelected = activeSpine?.id === event.spineVersionId;
                                        const versionLabel = event.spineVersionId
                                            ? getVersionLabel(event.spineVersionId)
                                            : event.artifactId
                                                ? getArtifactEventLabel(event.artifactId, event.artifactVersionId)
                                                : 'N/A';
                                        return (
                                            <button
                                                key={event.id}
                                                onClick={() => setViewedSpineId(event.spineVersionId || null)}
                                                className={`p-3.5 rounded-xl border text-left transition relative overflow-hidden ${isSelected ? 'bg-indigo-50/50 border-indigo-300 ring-1 ring-indigo-500 shadow-sm' : 'bg-white border-neutral-200 hover:border-neutral-300 hover:shadow-sm'}`}
                                            >
                                                {isSelected && <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500" />}
                                                <div className="flex justify-between items-start mb-1.5">
                                                    <span className={`text-sm font-bold ${isSelected ? 'text-indigo-700' : 'text-neutral-800'}`}>{versionLabel}</span>
                                                    <span className={`text-xs ${isSelected ? 'text-indigo-500/80 font-medium' : 'text-neutral-400'}`}>{new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                </div>
                                                <p className={`text-sm leading-snug ${isSelected ? 'text-neutral-800 font-medium' : 'text-neutral-500'}`}>{event.description}</p>

                                                {event.diff && event.diff.matches && isSelected && (
                                                    <div className="mt-3 pt-3 border-t border-indigo-100">
                                                        <p className="text-[10px] text-indigo-600 mb-1.5 font-bold tracking-wider uppercase opacity-80">Diff Preview</p>
                                                        <div className="bg-white border border-neutral-100 rounded-md p-2 shadow-inner font-mono">
                                                            <p className="text-xs text-red-500 line-through truncate mb-0.5">- {event.diff.matches[0].before}</p>
                                                            <p className="text-xs text-green-600 truncate">+ {event.diff.matches[0].after}</p>
                                                        </div>
                                                    </div>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}
                </>
                )}

            </div>

            {consolidatingBranch && latestSpine && (
                <ConsolidationModal
                    projectId={projectId}
                    branch={consolidatingBranch}
                    spineText={latestSpine.responseText}
                    onClose={() => setConsolidatingBranch(null)}
                />
            )}

            {activeCanvasBranchId && (
                <BranchCanvas
                    projectId={projectId}
                    branchId={activeCanvasBranchId}
                    onClose={() => setActiveCanvasBranchId(null)}
                />
            )}
        </div>
    );
}
