import { useParams, useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { useAuthStore } from '../store/authStore';
import { ChevronLeft, RefreshCcw, LogOut, CheckCircle, Cloud, Download, Settings, ChevronDown, ChevronRight, PanelRightOpen, PanelRightClose, MoreHorizontal, Loader2, ArrowRight, History, Activity } from 'lucide-react';
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
import { CORE_ARTIFACT_DISPLAY_ORDER } from '../lib/coreArtifactPipeline';
import { HistoryView } from './HistoryView';
import { VersionHistoryPanel, VersionCompareView, RevertConfirmModal, type VersionEntry } from './versions';
import { ExportModal } from './ExportModal';
import { SnapshotsPanel } from './SnapshotsPanel';
import { FeedbackItemsList } from './FeedbackItemsList';
import { BranchCanvas } from './BranchCanvas';
import { artifactJobController } from '../lib/services/artifactJobController';
import { SECTION_TITLES } from '../lib/prompts/prdSectionPrompts';
import type { SectionId } from '../lib/schemas/prdSchemas';
import type { Branch, PipelineStage, FeedbackItem } from '../types';
import { DEMO_PROJECT_ID } from '../data/demoProject';

export function ProjectWorkspace() {
    const { projectId } = useParams<{ projectId: string }>();
    const navigate = useNavigate();
    const authUser = useAuthStore((s) => s.user);
    const logout = useAuthStore((s) => s.logout);
    const { getProject, getLatestSpine, regenerateSpine, updateSpineStructuredPRD, editSpineStructuredPRD, revertSpineToVersion, updateProjectProductMetadata, setSpineError, setSpineSafetyReview, getHistoryEvents, getBranchesForSpine, getSpineVersions, getArtifactStaleness, markSpineFinal, setProjectStage, createBranch: storCreateBranch, updateFeedbackStatus, getArtifact, getArtifactVersions, getArtifacts, appendPrdProgress, clearPrdProgress, clearSectionStatus, setSectionStatus } = useProjectStore();
    const prdProgress = useProjectStore((s) => (projectId ? s.prdProgress[projectId] : undefined));
    const prdSectionStatus = useProjectStore((s) => (projectId ? s.prdSectionStatus[projectId] : undefined));
    // Live asset-generation job for the post-finalize status pill.
    const assetJob = useProjectStore((s) => (projectId ? s.jobs[projectId] : undefined));
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
    // Post-finalization transition. `showFinalizeSuccess` drives the success
    // modal shown immediately after Mark Final; `finalizeAutoOpen` is the
    // one-shot intent handed to ArtifactWorkspace so it auto-opens the panel
    // and selects the first non-PRD artifact on arrival from finalize.
    const [showFinalizeSuccess, setShowFinalizeSuccess] = useState(false);
    const [finalizeAutoOpen, setFinalizeAutoOpen] = useState(false);
    const overflowRef = useRef<HTMLDivElement>(null);
    const overflowButtonRef = useRef<HTMLButtonElement>(null);
    const overflowMenuRef = useRef<HTMLDivElement>(null);
    // Synchronous regeneration lock; see handleRegenerate.
    const regenerateInFlight = useRef(false);
    const [overflowMenuPos, setOverflowMenuPos] = useState<{ top: number; right: number } | null>(null);
    const [animationParent] = useAutoAnimate();

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

    if (!projectId) return <div>Invalid Project</div>;

    const project = getProject(projectId);
    const latestSpine = getLatestSpine(projectId);
    const historyEvents = getHistoryEvents(projectId);
    const allSpines = getSpineVersions(projectId);

    const pipelineStage = project?.currentStage || 'prd';
    const setPipelineStage = (stage: PipelineStage) => {
        if (projectId) setProjectStage(projectId, stage);
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
    // section in pending/queued/generating/refining state means the panel
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
        if (!projectId || !latestSpine || isGenerating || hasBranches || isOldVersion) return;
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
            const { structuredPRD, markdown, model, ms } = await regeneratePrdSection(
                id,
                sourcePrompt,
                activeSpine.structuredPRD,
                {
                    platform: project?.platform,
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
            editSpineStructuredPRD(projectId, activeSpine.id, structuredPRD, {
                responseText: markdown,
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
        if (!projectId || !latestSpine) return;
        const intent = `[Feedback: ${feedback.title}] ${feedback.description}`;
        storCreateBranch(projectId, latestSpine.id, feedback.title, intent);
        updateFeedbackStatus(projectId, feedback.id, 'accepted');
        setActiveRightTab('branches');
        setIsBranchesVisible(true);
    };

    // True once every build asset (the 7 core artifacts + mockups) already has
    // a generated version — i.e. nothing is left to create. Drives the success
    // modal's "ready" vs "being created" copy. Cheap presence check; safe to
    // run each render.
    const assetsReady = !!activeSpine?.structuredPRD && (() => {
        const coreReady = CORE_ARTIFACT_DISPLAY_ORDER.every(meta =>
            getArtifacts(projectId, 'core_artifact').some(a => a.subtype === meta.subtype && a.currentVersionId),
        );
        const mockupReady = getArtifacts(projectId, 'mockup').some(a => a.currentVersionId);
        return coreReady && mockupReady;
    })();

    // Post-finalize status pill. Once a spine is final, the user can dismiss the
    // success modal ("Stay on the PRD") and be stranded with no obvious path to
    // the assets that are now building. Show a persistent affordance in the top
    // bar whenever we're final but not already viewing the Assets stage.
    const assetsBuilding = !!assetJob && Object.values(assetJob.slots).some(
        (s) => s.status === 'generating' || s.status === 'queued',
    );
    const showAssetsPill = !!activeSpine?.isFinal
        && !!activeSpine?.structuredPRD
        && activeSpine?.safetyReview?.status !== 'blocked'
        && !isOldVersion
        && pipelineStage !== 'workspace';

    const handleToggleFinal = () => {
        if (!projectId || !activeSpine) return;
        // Blocked spines can never advance to the workspace / artifact stage.
        if (activeSpine.safetyReview?.status === 'blocked') return;
        const next = !activeSpine.isFinal;
        markSpineFinal(projectId, activeSpine.id, next);
        if (!next) return;

        // Kick off artifact generation immediately so assets are underway
        // while the success modal is visible. We deliberately do NOT switch
        // to the Assets stage yet — the modal owns the transition, and its
        // "Open Assets" action performs the navigation + panel auto-open.
        if (activeSpine.structuredPRD && projectId !== DEMO_PROJECT_ID) {
            artifactJobController.startAll({
                projectId,
                spineVersionId: activeSpine.id,
                prdContent: activeSpine.responseText,
                structuredPRD: activeSpine.structuredPRD,
                projectPlatform: project?.platform,
            });
        }
        setShowFinalizeSuccess(true);
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
                                    : `${getVersionLabel(activeSpine.id)} ${activeSpine.isFinal ? '(FINAL)' : ''}`
                            : 'Initializing...'}
                    </span>
                </div>

                {/* Primary nav actions — always visible */}
                <div className="flex items-center gap-2 shrink-0">
                    {showAssetsPill && (
                        <button
                            onClick={handleOpenAssets}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600/90 hover:bg-green-600 text-white rounded transition"
                            title="Go to the build assets for this finalized PRD"
                        >
                            {assetsBuilding
                                ? <Loader2 size={14} className="animate-spin" />
                                : <ArrowRight size={14} />}
                            <span className="hidden sm:inline">
                                {assetsBuilding ? 'Building assets…' : 'Go to Assets'}
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
                            title={activeSpine?.isFinal ? "Unmark Final" : "Mark as Final"}
                        >
                            <CheckCircle size={14} />
                            <span className="hidden md:inline">{activeSpine?.isFinal ? 'Final' : 'Mark Final'}</span>
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

            {showFinalizeSuccess && (
                <FinalizationSuccessModal
                    assetsReady={assetsReady}
                    onOpenAssets={handleOpenAssets}
                    onClose={() => setShowFinalizeSuccess(false)}
                />
            )}
            {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
            {isExportOpen && projectId && <ExportModal projectId={projectId} onClose={() => setIsExportOpen(false)} />}
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
                    onStageChange={setPipelineStage}
                    hasPRD={!!activeSpine?.isFinal}
                />
            </div>

            {/* Demo-mode banner: shown only for the prepopulated demo project.
                Regenerate / refine buttons stay active; the existing no-key
                error paths surface readable messages if the user clicks one. */}
            {projectId === DEMO_PROJECT_ID && (
                <div className="shrink-0 bg-indigo-500/10 border-b border-indigo-500/30 text-indigo-200 text-sm px-4 py-2 flex items-center justify-center gap-2 z-10">
                    <span>
                        You&apos;re viewing the demo project. Regenerating or refining requires your own Gemini API key — add one in Settings to customize.
                    </span>
                </div>
            )}

            {/* Main Workspace Area — flex-1 fills remaining height */}
            <div className="flex-1 flex overflow-hidden">
                {pipelineStage === 'workspace' && activeSpine?.isFinal && activeSpine.structuredPRD && activeSpine.safetyReview?.status !== 'blocked' ? (
                    <ArtifactWorkspace
                        projectId={projectId}
                        spineVersionId={activeSpine.id}
                        prdContent={activeSpine.responseText}
                        structuredPRD={activeSpine.structuredPRD}
                        projectPlatform={project?.platform}
                        autoOpenIntent={finalizeAutoOpen}
                        onAutoOpenConsumed={() => setFinalizeAutoOpen(false)}
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
                        {pipelineStage === 'prd' && !showPreflight && (
                            <>
                                {/* Feedback items from mockups/artifacts */}
                                <FeedbackItemsList
                                    projectId={projectId}
                                    onApplyToPRD={handleApplyFeedback}
                                />

                                {activeSpine ? (
                                    <div className="bg-white rounded-2xl shadow-sm border border-neutral-200/80 p-6 md:p-10 mb-8">
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
                                            <StructuredPRDView
                                                projectId={projectId}
                                                spineId={activeSpine.id}
                                                structuredPRD={activeSpine.structuredPRD}
                                                readOnly={isOldVersion}
                                            />
                                        ) : (
                                            <div className="prose prose-neutral max-w-none">
                                                <SelectableSpine
                                                    projectId={projectId}
                                                    spineVersionId={activeSpine.id}
                                                    text={activeSpine.responseText}
                                                    readOnly={isOldVersion}
                                                />
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="bg-white rounded-2xl shadow-sm border border-neutral-200/80 p-6 md:p-10 mb-8">
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
