import { useParams, useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { useAuthStore } from '../store/authStore';
import { ChevronLeft, RefreshCcw, LogOut, CheckCircle, Cloud, Download, Settings, ChevronDown, ChevronRight, PanelRightOpen, PanelRightClose, MoreHorizontal, Loader2, ArrowRight, History, Activity, AlertTriangle } from 'lucide-react';
import { useState, useRef, useEffect, useLayoutEffect } from 'react';
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
import { SelectableSpine } from './SelectableSpine';
import { BranchList } from './BranchList';
import { ConsolidationModal } from './ConsolidationModal';
import { SettingsModal } from './SettingsModal';
import { PipelineStageBar } from './PipelineStageBar';
import { StructuredPRDView } from './StructuredPRDView';
import { SafetyReviewView } from './SafetyReviewView';
import { SafetyBoundariesCard } from './SafetyBoundariesCard';
import { PreflightView } from './preflight/PreflightView';
import { ArtifactWorkspace } from './ArtifactWorkspace';
import { FinalizationSuccessModal } from './FinalizationSuccessModal';
import { DesignSystemPresetChoice } from './DesignSystemPresetChoice';
import { CORE_ARTIFACT_DISPLAY_ORDER, isHiddenArtifactSubtype, isRetiredArtifactSubtype } from '../lib/coreArtifactPipeline';
import { HistoryView } from './HistoryView';
import { VersionHistoryPanel, VersionCompareView, RevertConfirmModal, UpdateAssetsPlanModal, type VersionEntry, type UpdatePlanChoice, type UpdatePlanRow } from './versions';
import {
    buildArtifactDependencyGraph,
    computeRecommendedUpdates,
    evaluateDependencyGraph,
    expandSelectionWithTroubledUpstreams,
    type DependencyEvaluationInput,
    type DependencyNodeId,
    type DependencyNodeStatus,
} from '../lib/artifactDependencyGraph';
import { findFeatureReferences, makeSpineChangeResolver, summarizeSpineChange } from '../lib/spineChangeAnalysis';
import { selectPreferredDesignSystem } from '../lib/designTokens';
import { ExportModal } from './ExportModal';
import { SnapshotsPanel } from './SnapshotsPanel';
import { FeedbackItemsList } from './FeedbackItemsList';
import { BranchCanvas } from './BranchCanvas';
import { artifactJobController } from '../lib/services/artifactJobController';
import { SECTION_TITLES } from '../lib/prompts/prdSectionPrompts';
import type { SectionId } from '../lib/schemas/prdSchemas';
import type { ArtifactSlotKey, Branch, PipelineStage, FeedbackItem } from '../types';
import { DEMO_PROJECT_ID } from '../data/demoProject';
import { ProjectCloudStatus, ProjectConflictBanner } from './sync/ProjectSyncStatus';
import { ReviewWorkspaceContainer } from './review/ReviewWorkspaceContainer';
import { resetDemoProject } from '../lib/demoRouteHydration';
import { canPerformProjectAction } from '../lib/projectCapabilities';
import { derivePlanningReadiness, reviewIssueNeedsResolutionBeforeBuild } from '../lib/planning';
import { PlanningStateBar } from './planning/PlanningStateBar';

const EMPTY_PROJECT_LIST: never[] = [];

export function ProjectWorkspace() {
    const { projectId } = useParams<{ projectId: string }>();
    const navigate = useNavigate();
    const authUser = useAuthStore((s) => s.user);
    const logout = useAuthStore((s) => s.logout);
    const { getProject, getLatestSpine, regenerateSpine, updateSpineStructuredPRD, compareAndAppendStructuredPRD, revertSpineToVersion, updateProjectProductMetadata, setSpineError, setSpineSafetyReview, getHistoryEvents, getBranchesForSpine, getSpineVersions, getArtifactStaleness, getProjectOutputAlignment, markSpineFinal, setProjectStage, setProjectDesignSystemPreset, createBranch: storCreateBranch, updateFeedbackStatus, getArtifact, getArtifactVersions, getArtifacts, appendPrdProgress, clearPrdProgress, clearSectionStatus, setSectionStatus, markArtifactCurrentForSpine } = useProjectStore();
    const prdProgress = useProjectStore((s) => (projectId ? s.prdProgress[projectId] : undefined));
    const prdSectionStatus = useProjectStore((s) => (projectId ? s.prdSectionStatus[projectId] : undefined));
    // Live asset-generation job for the post-finalize status pill.
    const assetJob = useProjectStore((s) => (projectId ? s.jobs[projectId] : undefined));
    const planningRecords = useProjectStore((s) => (projectId ? s.planningRecords[projectId] ?? EMPTY_PROJECT_LIST : EMPTY_PROJECT_LIST));
    const reviewRuns = useProjectStore((s) => (projectId ? s.reviewRuns[projectId] ?? EMPTY_PROJECT_LIST : EMPTY_PROJECT_LIST));
    const reviewIssues = useProjectStore((s) => (projectId ? s.reviewIssues[projectId] ?? EMPTY_PROJECT_LIST : EMPTY_PROJECT_LIST));
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
    const [isBranchesVisible, setIsBranchesVisible] = useState(true);
    const [activeRightTab, setActiveRightTab] = useState<'branches' | 'history'>('branches');
    const [activeCanvasBranchId, setActiveCanvasBranchId] = useState<string | null>(null);
    const [showStructuredView, setShowStructuredView] = useState(true);
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
    // Incomplete working plans require an explicit acknowledgement before
    // commitment. Generated outputs retain that provenance later.
    const [showIncompletePrdConfirm, setShowIncompletePrdConfirm] = useState(false);
    const [showReadinessConfirm, setShowReadinessConfirm] = useState(false);
    const [reviewInitialTab, setReviewInitialTab] = useState<'review' | 'decisions'>('review');
    const [reviewInitialRecordId, setReviewInitialRecordId] = useState<string>();
    // Carries an explicit generation request across the design-preset choice.
    const generateAfterPreset = useRef(false);
    // Update Assets plan — shown on the re-commit edge when downstream
    // assets already exist, replacing the old silent full regeneration.
    // Cancel aborts commitment (the spine stays a working plan).
    const [updatePlan, setUpdatePlan] = useState<null | {
        rows: UpdatePlanRow[];
        changeHeadline?: string;
        baselineLabel?: string;
        ack: boolean;
    }>(null);
    const overflowRef = useRef<HTMLDivElement>(null);
    const overflowButtonRef = useRef<HTMLButtonElement>(null);
    const overflowMenuRef = useRef<HTMLDivElement>(null);
    // Synchronous regeneration lock; see handleRegenerate.
    const regenerateInFlight = useRef(false);
    const [overflowMenuPos, setOverflowMenuPos] = useState<{ top: number; right: number } | null>(null);
    const [animationParent] = useAutoAnimate();
    const [isResettingDemo, setIsResettingDemo] = useState(false);
    const [demoResetError, setDemoResetError] = useState<string | null>(null);

    const handleResetDemo = async () => {
        if (isResettingDemo) return;
        setIsResettingDemo(true);
        setDemoResetError(null);
        try {
            const result = await resetDemoProject();
            if (!result.available) setDemoResetError('The example could not be restored. Please try again.');
        } catch {
            setDemoResetError('The example could not be restored. Please try again.');
        } finally {
            setIsResettingDemo(false);
        }
    };

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
            import('../store/toastStore').then(({ useToastStore }) => {
                useToastStore.getState().addToast({
                    type: 'info',
                    title: 'Project not found',
                    message: 'It may have been deleted or saved in a different browser.',
                });
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
            store.setProjectStage(projectId, 'workspace');
        }
        // Mount-only by design (store read via getState, not deps): reacting
        // to later param changes would yank the stage from under the user.
    }, [projectId]);

    if (!projectId) return <div>Invalid Project</div>;

    const project = getProject(projectId);
    const latestSpine = getLatestSpine(projectId);
    const historyEvents = getHistoryEvents(projectId);
    const allSpines = getSpineVersions(projectId);

    const pipelineStage = project?.currentStage || 'prd';
    const setPipelineStage = (stage: PipelineStage) => {
        if (projectId) setProjectStage(projectId, stage);
    };
    const handlePipelineStageChange = (stage: PipelineStage) => {
        if (stage === 'review') setReviewInitialTab('review');
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
    const generatedOutputs = getArtifacts(projectId).filter(artifact =>
        artifact.type !== 'prd' && artifact.status !== 'archived' && !!artifact.currentVersionId,
    );
    // Readiness only counts consequential unresolved alignment. Historical
    // version drift, legacy provenance gaps, and changes outside an output's
    // main planning inputs stay visible for review without blocking build.
    const outputAlignment = getProjectOutputAlignment(projectId);
    const staleOutputCount = outputAlignment.blockingCount;
    const currentChallengeRuns = reviewRuns.filter(run =>
        run.sourceManifest.spineVersionId === activeSpine?.id
        && run.status === 'complete',
    );
    const currentChallengeIds = new Set(currentChallengeRuns.map(run => run.id));
    const blockingReviewIssueCount = reviewIssues.filter(issue =>
        currentChallengeIds.has(issue.reviewId)
        && reviewIssueNeedsResolutionBeforeBuild(issue, activeSpine?.id),
    ).length;
    const planningReadiness = derivePlanningReadiness({
        prd: activeSpine?.structuredPRD,
        planningRecords,
        incompleteSectionCount: persistedFailedSections.length,
        hasCurrentChallenge: currentChallengeRuns.length > 0,
        blockingReviewIssueCount,
        generatedOutputCount: generatedOutputs.length,
        staleOutputCount,
        isCommitted: !!activeSpine?.isFinal,
    });

    // Optional preflight clarification: while a non-completed session exists and
    // no PRD has been produced (and the request isn't blocked), the workspace
    // hosts the clarification flow instead of the PRD/progress view.
    const showPreflight = !!activeSpine?.preflightSession
        && !activeSpine.preflightSession.completed
        && !activeSpine.structuredPRD
        && activeSpine.safetyReview?.status !== 'blocked';


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
    const getStaleArtifactTitles = (): string[] =>
        getArtifacts(projectId)
            .filter(a => a.type !== 'prd' && getArtifactStaleness(projectId, a.id) === 'current')
            .map(a => a.title);

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
    const showAssetsPill = !!activeSpine?.isFinal
        && !!activeSpine?.structuredPRD
        && activeSpine?.safetyReview?.status !== 'blocked'
        && !isOldVersion
        && pipelineStage !== 'workspace';

    const handleToggleFinal = () => {
        if (!projectId || !canPerformProjectAction(projectId, 'persist') || !activeSpine) return;
        // Safety-blocked spines can never be committed.
        if (activeSpine.safetyReview?.status === 'blocked') return;
        const next = !activeSpine.isFinal;
        if (!next) {
            // Return the committed version to working-plan status.
            markSpineFinal(projectId, activeSpine.id, false);
            return;
        }

        if (!planningReadiness.isReadyToBuild) {
            setShowReadinessConfirm(true);
            return;
        }

        // Incomplete PRD: some required sections failed. Do not silently commit
        // partial source material — require explicit acknowledgement. Uses the raw
        // persisted list (not the SECTION_TITLES-filtered display list) so it
        // matches the code-level gate in artifactJobController.startAll.
        if ((activeSpine.generationMeta?.failedSections?.length ?? 0) > 0) {
            setShowIncompletePrdConfirm(true);
            return;
        }

        startFinalizeFlow(false);
    };

    // Continue commitment after the readiness/incomplete checkpoints. Visual
    // direction belongs to output generation, not to product commitment.
    const startFinalizeFlow = (ackIncomplete: boolean) => {
        if (!projectId || !activeSpine) return;
        finalizeAndGenerate(ackIncomplete);
    };

    // --- Update Assets plan (re-finalize with existing assets) --------------
    // Evaluate the dependency graph against the spine being finalized, exactly
    // like DependencyGraphView does, so the plan dialog shows the same
    // statuses/reasons the Project Map would.
    const buildUpdatePlanContext = () => {
        if (!projectId || !activeSpine?.structuredPRD) return null;
        const store = useProjectStore.getState();
        const graph = buildArtifactDependencyGraph();
        const spines = store.spineVersions[projectId] || [];
        const projectArtifacts = store.artifacts[projectId] || [];
        const mockupArtifact = projectArtifacts.find(a => a.type === 'mockup');

        const snapshots: DependencyEvaluationInput['snapshots'] = {};
        const artifactIdBySlot: Partial<Record<ArtifactSlotKey, string>> = {};
        const contentBySlot: Partial<Record<ArtifactSlotKey, string>> = {};
        for (const node of graph.nodes) {
            if (node.id === 'prd') continue;
            const slotKey = node.id as ArtifactSlotKey;
            const artifact = slotKey === 'mockup'
                ? mockupArtifact
                : projectArtifacts.find(a => a.type === 'core_artifact' && a.subtype === slotKey && a.status !== 'archived');
            const preferred = artifact ? store.getPreferredVersion(projectId, artifact.id) : undefined;
            if (artifact && preferred) {
                artifactIdBySlot[slotKey] = artifact.id;
                contentBySlot[slotKey] = preferred.content;
                snapshots[slotKey] = {
                    artifactId: artifact.id,
                    version: {
                        id: preferred.id,
                        versionNumber: preferred.versionNumber,
                        createdAt: preferred.createdAt,
                        sourceRefs: preferred.sourceRefs,
                        provenance: preferred.provenance,
                        metadata: preferred.metadata,
                    },
                };
            }
        }

        const evaluations = evaluateDependencyGraph(graph, {
            spineVersionIds: spines.map(s => s.id),
            latestSpineId: activeSpine.id,
            currentDesignTokensHash: selectPreferredDesignSystem(store, projectId)?.tokensHash,
            snapshots,
            spineChangeFor: makeSpineChangeResolver(spines, activeSpine.id),
        });

        return { graph, evaluations, snapshots, artifactIdBySlot, contentBySlot, spines };
    };

    const PLAN_STATUS_LABELS: Record<DependencyNodeStatus, string> = {
        source: 'Source of truth',
        up_to_date: 'Up to date',
        needs_update: 'Needs update',
        update_recommended: 'Update recommended',
        generating: 'Generating…',
        error: 'Failed',
        missing: 'Not generated',
    };

    const openUpdatePlan = (ctx: NonNullable<ReturnType<typeof buildUpdatePlanContext>>, ack: boolean) => {
        if (!activeSpine) return;
        const recommended = new Set(computeRecommendedUpdates(ctx.graph, ctx.evaluations));
        const rows: UpdatePlanRow[] = ctx.graph.nodes
            .filter(n => n.id !== 'prd')
            .map(node => {
                const ev = ctx.evaluations.get(node.id);
                const status = ev?.status ?? 'missing';
                const summary = ev?.reasons.find(r => r.kind === 'prd_changed')?.changeSummary;
                const content = ctx.contentBySlot[node.id as ArtifactSlotKey] ?? '';
                const removedFeatureNames = summary && content
                    ? summary.features.removed
                        .filter(f => findFeatureReferences(f, [{ artifactId: node.id, title: node.title, content }]).length > 0)
                        .map(f => f.name)
                    : [];
                return {
                    id: node.id,
                    title: node.title,
                    statusLabel: PLAN_STATUS_LABELS[status],
                    isStale: recommended.has(node.id),
                    changeHeadline: summary
                        ? `Since ${ev?.prdVersionLabel ?? 'generation'}: ${summary.headline}`
                        : undefined,
                    removedFeatureNames,
                    likelyUnaffected: ev?.likelyUnaffected,
                    defaultChoice: recommended.has(node.id) ? 'update' as const : 'skip' as const,
                    canMarkCurrent: !!ctx.artifactIdBySlot[node.id as ArtifactSlotKey]
                        && (status === 'needs_update' || status === 'update_recommended'),
                };
            });

        // Header "what changed": compare against the newest spine any asset was
        // generated from (assets can span several baselines after repeated edits).
        let baselineIdx = -1;
        for (const snap of Object.values(ctx.snapshots)) {
            const refId = snap?.version.sourceRefs.find(r => r.sourceType === 'spine')?.sourceArtifactVersionId;
            if (!refId) continue;
            const idx = ctx.spines.findIndex(s => s.id === refId);
            if (idx > baselineIdx && ctx.spines[idx]?.id !== activeSpine.id) baselineIdx = idx;
        }
        const baselineSpine = baselineIdx >= 0 ? ctx.spines[baselineIdx] : undefined;
        const headerSummary = baselineSpine
            ? summarizeSpineChange(baselineSpine.structuredPRD, activeSpine.structuredPRD)
            : null;

        setUpdatePlan({
            rows,
            changeHeadline: headerSummary?.headline,
            baselineLabel: baselineSpine ? `since Version ${baselineIdx + 1}` : undefined,
            ack,
        });
    };

    const handleUpdatePlanConfirm = (choices: Record<string, UpdatePlanChoice>) => {
        if (!projectId || !activeSpine?.structuredPRD || !updatePlan) return;
        // Finalize first — the durable record every path below depends on.
        markSpineFinal(projectId, activeSpine.id, true);

        // Re-evaluate against fresh store state (the dialog may have been open
        // a while), then apply mark-current BEFORE regeneration so a confirmed
        // upstream is healthy when its dependents regenerate.
        const ctx = buildUpdatePlanContext();
        if (ctx) {
            const marked = Object.entries(choices)
                .filter(([, c]) => c === 'mark_current')
                .map(([id]) => id as DependencyNodeId);
            for (const slot of marked) {
                const artifactId = ctx.artifactIdBySlot[slot as ArtifactSlotKey];
                if (!artifactId) continue;
                try {
                    markArtifactCurrentForSpine(projectId, artifactId, activeSpine.id);
                } catch {
                    // No preferred version — nothing to confirm; leave as-is.
                }
            }

            const selected = Object.entries(choices)
                .filter(([, c]) => c === 'update')
                .map(([id]) => id as DependencyNodeId);
            if (selected.length > 0) {
                // Pull in troubled visible upstreams the user left unselected —
                // regenerating a dependent against a stale input would rebuild
                // from stale context (marked-current upstreams count as healed).
                const batch = expandSelectionWithTroubledUpstreams(
                    ctx.graph, ctx.evaluations, selected, new Set(marked),
                );
                artifactJobController.regenerateSlots(
                    batch.filter((id): id is ArtifactSlotKey => id !== 'prd'),
                    {
                        projectId,
                        spineVersionId: activeSpine.id,
                        prdContent: activeSpine.responseText,
                        structuredPRD: activeSpine.structuredPRD,
                        projectPlatform: project?.platform,
                        acknowledgeIncomplete: updatePlan.ack,
                    },
                );
            }
        }
        setUpdatePlan(null);
        setShowFinalizeSuccess(true);
    };

    // Commit the working plan. Asset generation is a separate explicit action:
    // commitment records intent; generating documents does not create intent.
    const finalizeAndGenerate = (ackIncomplete: boolean) => {
        if (!projectId || !activeSpine) return;

        // Re-commit with existing outputs: route through the Update Assets plan
        // so source drift is explicit. First commitment, the demo, and an active
        // output run keep the direct path.
        if (activeSpine.structuredPRD && projectId !== DEMO_PROJECT_ID) {
            const jobActive = !!assetJob && Object.values(assetJob.slots).some(
                s => s && (s.status === 'generating' || s.status === 'queued'),
            );
            if (!jobActive) {
                const ctx = buildUpdatePlanContext();
                if (ctx && Object.keys(ctx.snapshots).length > 0) {
                    openUpdatePlan(ctx, ackIncomplete);
                    return; // not committed yet — the plan dialog owns it
                }
            }
        }

        markSpineFinal(projectId, activeSpine.id, true);

        setShowFinalizeSuccess(true);
    };

    const startAssetGeneration = () => {
        if (!projectId || !activeSpine?.structuredPRD || projectId === DEMO_PROJECT_ID) return;
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
        if (!projectId || !activeSpine?.structuredPRD || projectId === DEMO_PROJECT_ID) return handleOpenAssets();
        if (!project?.designSystemPreset) {
            generateAfterPreset.current = true;
            setShowPresetChoice(true);
            return;
        }
        startAssetGeneration();
    };

    const openDecisionCenter = (recordId?: string) => {
        setReviewInitialTab('decisions');
        setReviewInitialRecordId(recordId);
        setPipelineStage('review');
    };

    const openChallenge = () => {
        setReviewInitialTab('review');
        setReviewInitialRecordId(undefined);
        setPipelineStage('review');
    };

    const handlePlanningNextAction = () => {
        const kind = planningReadiness.nextAction.kind;
        if (kind === 'resolve_decision' || kind === 'review_source_change' || kind === 'align_plan') return openDecisionCenter(planningReadiness.nextAction.planningRecordId);
        if (kind === 'challenge_plan') return openChallenge();
        if (kind === 'align_outputs') return setPipelineStage('workspace');
        if (kind === 'commit_plan') return handleToggleFinal();
        const anchor = kind === 'confirm_scope' ? 'prd-features' : 'prd-coreProblem';
        document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const handleExport = () => {
        setIsExportOpen(true);
    };

    return (
        <div className="flex flex-col h-screen bg-neutral-900 text-neutral-100">

            {/* Top Navigation Bar — shrink-0, no absolute */}
            <div className="shrink-0 h-14 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between px-4 z-10">
                <div className="flex items-center gap-3 min-w-0">
                    <button
                        onClick={() => navigate('/')}
                        className="p-1 hover:bg-neutral-800 rounded-md transition text-neutral-400 shrink-0"
                        title="Back to projects"
                        aria-label="Back to projects"
                    >
                        <ChevronLeft size={20} />
                    </button>
                    <span className="font-semibold truncate">{project.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap shrink-0 ${activeSpine?.safetyReview?.status === 'blocked' ? 'bg-amber-900/30 text-amber-400 border border-amber-800' : activeSpine?.isFinal ? 'bg-green-900/30 text-green-400 border border-green-800' : activeSpine?.generationError ? 'bg-red-900/30 text-red-400 border border-red-800' : isPRDActivelyGenerating ? 'bg-indigo-900/30 text-indigo-400 border border-indigo-800' : 'bg-neutral-800 text-neutral-400'}`}>
                        {activeSpine
                            ? activeSpine.safetyReview?.status === 'blocked'
                                ? 'Blocked'
                                : activeSpine.generationError
                                ? 'Generation Failed'
                                : isPRDActivelyGenerating
                                    ? 'Generating...'
                                    : `${getVersionLabel(activeSpine.id)} ${activeSpine.isFinal ? '(COMMITTED)' : ''}`
                            : 'Initializing...'}
                    </span>
                    {projectId !== DEMO_PROJECT_ID && (
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
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded transition ${activeSpine?.isFinal ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'}`}
                            title={activeSpine?.isFinal ? "Return this plan to working status" : "Review readiness and commit this plan"}
                        >
                            <CheckCircle size={14} />
                            <span className="hidden md:inline">{activeSpine?.isFinal ? 'Committed' : 'Review readiness'}</span>
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
                                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-neutral-300 hover:bg-white/5 transition"
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

            {showReadinessConfirm && (
                <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-lg rounded-2xl bg-white text-neutral-900 shadow-2xl">
                        <div className="p-6">
                            <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Readiness checkpoint</p>
                            <h3 className="mt-2 text-xl font-bold">This is still a working plan</h3>
                            <p className="mt-2 text-sm leading-6 text-neutral-600">{planningReadiness.summary} Committing it records the current version as the intended implementation foundation; it does not make unresolved reasoning disappear.</p>
                            <div className="mt-4 space-y-2">
                                {planningReadiness.criteria.filter(item => item.status === 'attention').map(item => (
                                    <div key={item.id} className="rounded-lg bg-amber-50 px-3 py-2">
                                        <p className="text-sm font-semibold text-amber-950">{item.label}</p>
                                        <p className="mt-0.5 text-xs leading-5 text-amber-800">{item.explanation}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="flex flex-col-reverse gap-2 border-t border-neutral-100 p-4 sm:flex-row sm:justify-end">
                            <button type="button" onClick={() => { setShowReadinessConfirm(false); handlePlanningNextAction(); }} className="min-h-11 rounded-lg border border-neutral-200 px-4 text-sm font-semibold text-neutral-700">Keep shaping the plan</button>
                            <button type="button" onClick={() => {
                                setShowReadinessConfirm(false);
                                if (persistedFailedSections.length > 0) setShowIncompletePrdConfirm(true);
                                else startFinalizeFlow(false);
                            }} className="min-h-11 rounded-lg bg-neutral-950 px-4 text-sm font-semibold text-white">Commit working plan anyway</button>
                        </div>
                    </div>
                </div>
            )}
            {showIncompletePrdConfirm && (
                <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
                        <div className="flex items-start gap-3 p-5 border-b border-neutral-100">
                            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-500" />
                            <div>
                                <h3 className="font-semibold text-neutral-900">Commit an incomplete working plan?</h3>
                                <p className="text-sm text-neutral-600 mt-1">
                                    {persistedFailedSections.length} PRD section{persistedFailedSections.length > 1 ? 's' : ''} failed
                                    to generate. The current specification is missing source material and should not be treated
                                    as a complete implementation foundation.
                                </p>
                                <p className="text-sm text-neutral-600 mt-2">
                                    We recommend retrying the failed sections first.
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 p-4">
                            <button
                                type="button"
                                onClick={() => setShowIncompletePrdConfirm(false)}
                                className="px-3 py-1.5 text-sm rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-700 transition"
                            >
                                Retry sections first
                            </button>
                            <button
                                type="button"
                                onClick={() => { setShowIncompletePrdConfirm(false); startFinalizeFlow(true); }}
                                className="px-3 py-1.5 text-sm rounded-lg bg-amber-600 hover:bg-amber-700 text-white transition"
                            >
                                Commit anyway
                            </button>
                        </div>
                    </div>
                </div>
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
            {updatePlan && activeSpine && (
                <UpdateAssetsPlanModal
                    prdLabel={getVersionLabel(activeSpine.id)}
                    changeHeadline={updatePlan.changeHeadline}
                    baselineLabel={updatePlan.baselineLabel}
                    rows={updatePlan.rows}
                    onConfirm={handleUpdatePlanConfirm}
                    onCancel={() => setUpdatePlan(null)}
                />
            )}
            {showFinalizeSuccess && (
                <FinalizationSuccessModal
                    assetsGenerated={assetsReady}
                    assetsBuilding={assetsBuilding}
                    readyToBuild={planningReadiness.isReadyToBuild}
                    onOpenAssets={handleOpenAssets}
                    onGenerateAssets={handleGenerateAssets}
                    onClose={() => setShowFinalizeSuccess(false)}
                />
            )}
            {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
            {isExportOpen && projectId && <ExportModal projectId={projectId} planningReady={planningReadiness.isReadyToBuild} onClose={() => setIsExportOpen(false)} />}
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
                    isPlanCommitted={!!activeSpine?.isFinal && planningReadiness.isReadyToBuild}
                    canReview={!!activeSpine?.structuredPRD && activeSpine.safetyReview?.status !== 'blocked'}
                />
            </div>

            {/* One intentional explanation of the public demo policy. */}
            {projectId === DEMO_PROJECT_ID && (
                <div className="shrink-0 bg-indigo-500/10 border-b border-indigo-500/30 text-indigo-200 text-sm px-4 py-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 z-10" role="status" aria-live="polite">
                    <span>This is a read-only example project. Explore its connected artifacts and history; editing and generation are disabled.</span>
                    <button type="button" onClick={handleResetDemo} disabled={isResettingDemo}
                        className="font-medium underline underline-offset-2 disabled:opacity-60">
                        {isResettingDemo ? 'Resetting demo…' : 'Reset demo'}
                    </button>
                    {demoResetError && <span role="alert">{demoResetError}</span>}
                </div>
            )}

            {/* Cross-device conflict banner: the cloud copy changed on another
                device while this device has unsynced edits. Blocks silent
                overwrite — the user picks keep-local / use-cloud / download. */}
            {projectId !== DEMO_PROJECT_ID && authUser && (
                <div className="shrink-0 px-4 py-2 z-10 empty:hidden">
                    <ProjectConflictBanner projectId={projectId} />
                </div>
            )}

            {/* Main Workspace Area — flex-1 fills remaining height */}
            <div className="flex-1 flex overflow-hidden">
                {pipelineStage === 'workspace' && activeSpine?.structuredPRD && activeSpine.safetyReview?.status !== 'blocked' ? (
                    <div className="flex min-h-0 flex-1 flex-col">
                        {!planningReadiness.isReadyToBuild && (
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
                        />
                    </div>
                ) : pipelineStage === 'review' && activeSpine?.structuredPRD && activeSpine.safetyReview?.status !== 'blocked' ? (
                    <ReviewWorkspaceContainer projectId={projectId} initialTab={reviewInitialTab} initialRecordId={reviewInitialRecordId} />
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
                        {pipelineStage === 'prd' && !showPreflight && (
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

                                        {/* View toggle when structured PRD exists (hidden for blocked spines) */}
                                        {activeSpine.structuredPRD && activeSpine.safetyReview?.status !== 'blocked' && (
                                            <div className="flex items-center gap-2 mb-6">
                                                <button
                                                    onClick={() => setShowStructuredView(true)}
                                                    className={`px-3 py-1.5 text-sm rounded-md transition ${showStructuredView ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-neutral-500 hover:bg-neutral-100'}`}
                                                >
                                                    Structured View
                                                </button>
                                                <button
                                                    onClick={() => setShowStructuredView(false)}
                                                    className={`px-3 py-1.5 text-sm rounded-md transition ${!showStructuredView ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-neutral-500 hover:bg-neutral-100'}`}
                                                >
                                                    Markdown View
                                                </button>
                                            </div>
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
                                        ) : activeSpine.structuredPRD && showStructuredView ? (
                                            <>
                                                {!isOldVersion && (
                                                    <PlanningStateBar
                                                        readiness={planningReadiness}
                                                        committed={activeSpine.isFinal}
                                                        onNextAction={handlePlanningNextAction}
                                                        onOpenDecisions={openDecisionCenter}
                                                        onOpenChallenge={openChallenge}
                                                    />
                                                )}
                                                <StructuredPRDView
                                                    projectId={projectId}
                                                    spineId={activeSpine.id}
                                                    structuredPRD={activeSpine.structuredPRD}
                                                    readOnly={isOldVersion || !canPerformProjectAction(projectId, 'persist')}
                                                    onOpenDecisions={openDecisionCenter}
                                                />
                                            </>
                                        ) : (
                                            <div className="prose prose-neutral max-w-none">
                                                <SelectableSpine
                                                    projectId={projectId}
                                                    spineVersionId={activeSpine.id}
                                                    text={activeSpine.responseText}
                                                    readOnly={isOldVersion || !canPerformProjectAction(projectId, 'persist')}
                                                />
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
