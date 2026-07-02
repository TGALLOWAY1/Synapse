import { useEffect, useMemo, useRef, useState } from 'react';
import {
    FileText, Image, Package, CheckCircle2, Loader2, Circle, AlertTriangle,
    RefreshCcw, Menu, X, ListChecks, History,
    Layers, Database, Code2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useProjectStore } from '../store/projectStore';
import { useIsMobile } from '../lib/useIsMobile';
import { artifactJobController } from '../lib/services/artifactJobController';
import { CORE_ARTIFACT_DISPLAY_ORDER, getArtifactMeta, isHiddenArtifactSubtype } from '../lib/coreArtifactPipeline';
import { ArtifactContentRenderer } from './renderers';
import { StructuredPRDView } from './StructuredPRDView';
import { MockupViewer } from './mockups/MockupViewer';
import { MockupErrorBoundary } from './mockups/MockupErrorBoundary';
import { GenerationProgress } from './GenerationProgress';
import { MOCKUP_GENERATION_STAGES, getArtifactStages } from './generationStages';
import { ConvertToTasksModal } from './ConvertToTasksModal';
import { TaskChecklist } from './tasks/TaskChecklist';
import { StalenessBadge } from './StalenessBadge';
import { VersionHistoryPanel, type VersionEntry } from './versions';
import { DesignSystemPresetChoice } from './DesignSystemPresetChoice';
import { DesignDirectionControl } from './DesignDirectionControl';
import { tryParsePayload, extractMockupSettings } from '../lib/mockupParsing';
import { selectPreferredDesignTokens, selectPreferredDesignSystem } from '../lib/designTokens';
import type {
    ArtifactSlotKey, CoreArtifactSubtype, ProjectPlatform, StructuredPRD, GenerationStatus,
    ProjectTask,
} from '../types';

// Stable empty reference for the tasks selector. Returning `[]` literal each
// call would make Zustand's useSyncExternalStore see a fresh snapshot on every
// render and bail out with React #185 (Maximum update depth) for any project
// without saved tasks — e.g. the demo project on first load.
const EMPTY_TASKS: ProjectTask[] = [];

interface ArtifactWorkspaceProps {
    projectId: string;
    spineVersionId: string;
    prdContent: string;
    structuredPRD: StructuredPRD;
    projectPlatform?: ProjectPlatform;
    // One-shot signal that the user just arrived here by finalizing the PRD.
    // When true, the panel auto-selects the first meaningful non-PRD artifact
    // and opens the mobile drawer; consumed exactly once via onAutoOpenConsumed
    // so closing the drawer never triggers a reopen.
    autoOpenIntent?: boolean;
    onAutoOpenConsumed?: () => void;
}

type WorkspaceSelection = 'prd' | ArtifactSlotKey;

interface SlotMeta {
    key: WorkspaceSelection;
    title: string;
    description: string;
    icon: typeof FileText;
}

interface ArtifactGroup {
    id: string;
    title: string;
    icon: typeof FileText;
    items: WorkspaceSelection[];
}

// Sidebar grouping is purely visual — subtype IDs are unchanged. Order within
// a group is the order rows render in. The "Project Foundation → UX & Design
// → Architecture → Development" sequence tells the product-build story; keep
// it in sync with the README/tour if either changes.
const ARTIFACT_GROUPS: ArtifactGroup[] = [
    { id: 'foundation', title: 'Project Foundation', icon: FileText, items: ['prd'] },
    {
        id: 'design',
        title: 'UX & Design',
        icon: Layers,
        // 'component_inventory' (UI Components) lives in this group but is hidden
        // from the assets list at materialization time — see buildSlotMetas and
        // HIDDEN_ARTIFACT_SUBTYPES. It still generates for mockups; it just
        // never renders a sidebar row. Revisit — see docs/backlog/BACKLOG.md §6.
        items: ['user_flows', 'screen_inventory', 'mockup', 'component_inventory', 'design_system'],
    },
    { id: 'architecture', title: 'Architecture', icon: Database, items: ['data_model'] },
    { id: 'development', title: 'Development', icon: Code2, items: ['prompt_pack', 'implementation_plan'] },
];

function buildSlotMetas(): SlotMeta[] {
    const base: Record<WorkspaceSelection, SlotMeta> = {
        prd: { key: 'prd', title: 'PRD', description: 'Final product requirements document', icon: FileText },
        mockup: { key: 'mockup', title: 'Mockups', description: 'Interactive UI mockups', icon: Image },
    } as Record<WorkspaceSelection, SlotMeta>;
    for (const meta of CORE_ARTIFACT_DISPLAY_ORDER) {
        base[meta.subtype as WorkspaceSelection] = {
            key: meta.subtype as WorkspaceSelection,
            title: meta.title,
            description: meta.description,
            icon: Package,
        };
    }
    // Materialize in the group order so the right rail / counts / mobile
    // header iterate in the same order the sidebar shows. Hidden artifact
    // subtypes (generated for downstream use but not surfaced) are dropped here
    // so they render no row anywhere in the workspace.
    return ARTIFACT_GROUPS.flatMap(group =>
        group.items
            .filter(key => key === 'prd' || key === 'mockup' || !isHiddenArtifactSubtype(key))
            .map(key => base[key]),
    );
}

function StatusDot({ status }: { status: GenerationStatus }) {
    if (status === 'done') return <CheckCircle2 size={14} className="text-green-500 shrink-0" />;
    if (status === 'generating' || status === 'queued') {
        return <Loader2 size={14} className="text-sky-500 animate-spin shrink-0" />;
    }
    if (status === 'error') return <AlertTriangle size={14} className="text-red-500 shrink-0" />;
    if (status === 'interrupted') return <AlertTriangle size={14} className="text-amber-500 shrink-0" />;
    return <Circle size={14} className="text-neutral-300 shrink-0" />;
}

export function ArtifactWorkspace({
    projectId, spineVersionId, prdContent, structuredPRD, projectPlatform,
    autoOpenIntent, onAutoOpenConsumed,
}: ArtifactWorkspaceProps) {
    const isMobile = useIsMobile();
    const {
        getArtifacts, getPreferredVersion, getArtifactStaleness, getJob, getProject,
        updateArtifactVersionMetadata, getArtifactVersions, getSpineVersions,
        revertArtifactToVersion, setProjectDesignSystemPreset,
    } = useProjectStore();
    // Reactive read of the project's chosen visual direction, so the Design
    // System "Design direction" control re-renders when it changes.
    const designSystemPreset = useProjectStore(s => s.projects[projectId]?.designSystemPreset);
    // Which artifact's version-history panel is open (null = none).
    const [versionHistoryArtifactId, setVersionHistoryArtifactId] = useState<string | null>(null);
    // Subscribe to tasks so the Implementation Plan button label tracks saved
    // count reactively (the checklist itself reads the store directly).
    const projectTasks = useProjectStore(s => s.tasks[projectId] ?? EMPTY_TASKS);
    // Active design tokens, so the Screen Inventory copy-prompt embeds the same
    // Design System Brief the internal mockups use. selectPreferredDesignTokens
    // is reference-stable per ArtifactVersion, so it's safe inside a selector.
    const designTokens = useProjectStore(s => selectPreferredDesignTokens(s, projectId));

    const slotMetas = useMemo(() => buildSlotMetas(), []);
    const [selected, setSelected] = useState<WorkspaceSelection>('prd');
    // The scrollable content pane. Reset to the top whenever the user switches
    // pages so a new artifact never inherits the previous page's scroll offset.
    const mainRef = useRef<HTMLElement>(null);
    // Mobile-only: the left rail is a slide-in drawer below the md breakpoint.
    // Closed by default so the content pane is fully visible on first paint.
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    // Holds the artifact id + content the modal should extract tasks from.
    // Stored as state (rather than derived) so the modal keeps working even
    // if the user mutates the artifact in another tab while it's open.
    const [tasksModalSource, setTasksModalSource] = useState<
        { artifactId: string; content: string } | null
    >(null);
    // Mockup regenerate confirm — surfaces "Creates Version N. Current
    // version remains available." before kicking off a new run so the user
    // doesn't fear losing their existing render.
    const [mockupRegenConfirm, setMockupRegenConfirm] = useState<
        { nextVersion: number } | null
    >(null);
    // Post-finalization "design direction" flow on the Design System artifact:
    // the preset picker, and the confirm before regenerating the design system.
    const [showDirectionPicker, setShowDirectionPicker] = useState(false);
    const [designRegenConfirm, setDesignRegenConfirm] = useState<
        { nextVersion: number } | null
    >(null);

    const job = getJob(projectId);

    // Auto-resume any slots that didn't finish before the last unmount /
    // page reload. The job state is transient (stripped from persisted
    // store), so without this the user lands on a workspace where missing
    // artifacts silently sit at "Idle" with no resume affordance.
    useEffect(() => {
        artifactJobController.resumeIfNeeded({
            projectId, spineVersionId, prdContent, structuredPRD, projectPlatform,
        });
    }, [projectId, spineVersionId, prdContent, structuredPRD, projectPlatform]);

    // Scroll the content pane back to the top on every page switch.
    useEffect(() => {
        mainRef.current?.scrollTo({ top: 0 });
    }, [selected]);

    const slotStatusFor = (key: WorkspaceSelection): GenerationStatus => {
        if (key === 'prd') return 'done';
        const fromJob = job?.slots[key]?.status;
        if (fromJob && fromJob !== 'idle') return fromJob;
        // No active job state — derive from artifact presence so previously
        // completed artifacts still show as "Ready" after the job is cleared.
        const type = key === 'mockup' ? 'mockup' : 'core_artifact';
        const subtype: CoreArtifactSubtype | undefined = key === 'mockup' ? undefined : key;
        const artifacts = getArtifacts(projectId, type);
        const existing = subtype ? artifacts.find(a => a.subtype === subtype) : artifacts[0];
        if (existing && existing.currentVersionId) return 'done';
        return 'idle';
    };

    const slotErrorFor = (key: WorkspaceSelection) => {
        if (key === 'prd') return undefined;
        return job?.slots[key]?.error;
    };

    // Post-finalization auto-open. Runs once each time the parent arms
    // autoOpenIntent: pick the first meaningful non-PRD artifact (prefer one
    // that's already done, else generating, else queued, else the first slot
    // in display order) so the user never lands on the PRD again, and open the
    // mobile drawer so the asset list is visible. Consumed immediately so a
    // user who closes the drawer is never re-interrupted.
    useEffect(() => {
        if (!autoOpenIntent) return;
        const candidates = slotMetas.map(s => s.key).filter(k => k !== 'prd');
        const firstWith = (s: GenerationStatus) => candidates.find(k => slotStatusFor(k) === s);
        const pick = firstWith('done') ?? firstWith('generating') ?? firstWith('queued') ?? candidates[0];
        if (pick) setSelected(pick);
        if (isMobile) setMobileSidebarOpen(true);
        onAutoOpenConsumed?.();
        // slotStatusFor/slotMetas are stable for this purpose; we intentionally
        // react only to the intent flag flipping on.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoOpenIntent]);

    // Drives the in-pane "Creating your build assets…" placeholder so an
    // idle slot doesn't read as empty while siblings are still in flight.
    const isActive = slotMetas.some(s => {
        const status = slotStatusFor(s.key);
        return status === 'generating' || status === 'queued';
    });

    const handleRetrySlot = (slot: ArtifactSlotKey) => {
        artifactJobController.retrySlot(slot, {
            projectId, spineVersionId, prdContent, structuredPRD, projectPlatform,
        });
    };

    // Persist a newly-chosen visual direction, then surface the regenerate
    // confirm — the preset only takes effect when the design system is
    // regenerated, so we lead the user straight into that step.
    const handleChooseDirection = (presetId: string) => {
        setProjectDesignSystemPreset(projectId, presetId);
        setShowDirectionPicker(false);
        const ds = getArtifacts(projectId, 'core_artifact').find(a => a.subtype === 'design_system');
        const preferred = ds ? getPreferredVersion(projectId, ds.id) : undefined;
        setDesignRegenConfirm({ nextVersion: (preferred?.versionNumber ?? 0) + 1 });
    };

    // Resolve a spine source-ref id to its positional "Version N" label, matching
    // the label the PRD workspace shows.
    const resolveSpineLabel = (spineId?: string): string | undefined => {
        if (!spineId) return undefined;
        const idx = getSpineVersions(projectId).findIndex(s => s.id === spineId);
        return idx >= 0 ? `Version ${idx + 1}` : undefined;
    };

    // Header strip shown above a generated artifact: provenance chip ("Generated
    // from PRD Version X"), staleness badge, and a Version history entry point.
    const renderVersionControls = (
        artifactId: string,
        preferred: { sourceRefs: { sourceType: string; sourceArtifactVersionId: string }[] },
    ) => {
        const staleness = getArtifactStaleness(projectId, artifactId);
        const spineRef = preferred.sourceRefs.find(r => r.sourceType === 'spine')?.sourceArtifactVersionId;
        const prdLabel = resolveSpineLabel(spineRef);
        return (
            <div className="flex items-center gap-2 flex-wrap">
                {prdLabel && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600 font-medium">
                        Generated from PRD {prdLabel}
                    </span>
                )}
                <StalenessBadge staleness={staleness} />
                <button
                    type="button"
                    onClick={() => setVersionHistoryArtifactId(artifactId)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md transition"
                >
                    <History size={12} /> Version history
                </button>
            </div>
        );
    };

    const renderMain = () => {
        if (selected === 'prd') {
            return (
                <div className="max-w-3xl xl:max-w-5xl 2xl:max-w-6xl mx-auto">
                    <StructuredPRDView
                        projectId={projectId}
                        spineId={spineVersionId}
                        structuredPRD={structuredPRD}
                        readOnly
                    />
                </div>
            );
        }

        const status = slotStatusFor(selected);
        const error = slotErrorFor(selected);

        if (status === 'queued' || status === 'generating') {
            const meta = selected === 'mockup' ? null : getArtifactMeta(selected);
            const stages = selected === 'mockup' ? MOCKUP_GENERATION_STAGES : getArtifactStages(selected);
            const displayName = selected === 'mockup' ? 'Mockup' : (meta?.title ?? selected);
            const title = status === 'queued'
                ? `Queued: ${displayName}`
                : selected === 'mockup'
                    ? 'Designing your product interface'
                    : `Generating ${displayName}`;
            return (
                <div className="max-w-2xl mx-auto">
                    <GenerationProgress
                        stages={stages}
                        variant={selected === 'mockup' ? 'creative' : 'systematic'}
                        title={title}
                        subtitle={status === 'queued' ? 'Queued — will start as a generation slot frees up' : undefined}
                        history={job?.slots[selected]?.progressLog ?? []}
                    />
                </div>
            );
        }

        if (status === 'error' || status === 'interrupted') {
            return (
                <div className="max-w-2xl mx-auto bg-white border border-neutral-200 rounded-xl p-6 shadow-sm">
                    <div className="flex items-start gap-3">
                        <AlertTriangle size={20} className={status === 'error' ? 'text-red-500' : 'text-amber-500'} />
                        <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-neutral-900">
                                {status === 'error' ? 'Generation failed' : 'Generation interrupted'}
                            </h3>
                            {error?.message && (
                                <p className="text-sm text-neutral-600 mt-1 break-words">{error.message}</p>
                            )}
                            <button
                                type="button"
                                onClick={() => handleRetrySlot(selected)}
                                className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                            >
                                <RefreshCcw size={14} /> Retry
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        // Idle while the overall run is still in flight means this slot hasn't
        // started yet (e.g. cleared job, or waiting behind the concurrency
        // limit). Show the global "creating your build assets" state rather
        // than a bare "Not generated yet" so the workspace never looks empty.
        if (status === 'idle' && isActive) {
            return <BuildAssetsLoading />;
        }

        // status === 'done' or 'idle' — try to render the existing artifact.
        if (selected === 'mockup') {
            const mockup = getArtifacts(projectId, 'mockup')[0];
            const preferred = mockup ? getPreferredVersion(projectId, mockup.id) : undefined;
            if (!mockup || !preferred) {
                return <EmptyState message="No mockup yet" />;
            }
            const payload = tryParsePayload(preferred);
            if (!payload) {
                return (
                    <div className="bg-white rounded-xl border border-neutral-200 p-5 prose prose-sm prose-neutral max-w-none overflow-auto max-h-[600px]">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{preferred.content}</ReactMarkdown>
                    </div>
                );
            }
            const settings = extractMockupSettings(preferred);
            const staleness = getArtifactStaleness(projectId, mockup.id);
            // Did the design system's tokens change since these mockups were
            // generated? Mirrors stalenessSlice's mockup check: compare the
            // tokensHash recorded on the mockup's design_system source ref
            // against the project's current preferred design system. When they
            // differ, prompt the user to regenerate so the new visual direction
            // actually reaches the images.
            const designRef = preferred.sourceRefs.find(
                r => r.sourceType === 'core_artifact' && typeof r.anchorInfo === 'string',
            );
            const currentDesign = selectPreferredDesignSystem(useProjectStore.getState(), projectId);
            const designSystemDrift = !!designRef
                && !!currentDesign?.tokensHash
                && currentDesign.tokensHash !== designRef.anchorInfo;
            return (
                <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        {renderVersionControls(mockup.id, preferred)}
                        <button
                            type="button"
                            onClick={() => setMockupRegenConfirm({ nextVersion: preferred.versionNumber + 1 })}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md transition"
                        >
                            <RefreshCcw size={12} /> Regenerate Mockup
                        </button>
                    </div>
                    {designSystemDrift && (
                        <div className="flex items-start justify-between gap-3 flex-wrap rounded-lg border border-amber-200 bg-amber-50 p-3">
                            <div className="flex items-start gap-2 min-w-0">
                                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-amber-900">
                                        Design system changed since these mockups were generated
                                    </p>
                                    <p className="text-xs text-amber-700 mt-0.5">
                                        Regenerate the mockups to apply the new visual direction.
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setMockupRegenConfirm({ nextVersion: preferred.versionNumber + 1 })}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded-md transition shrink-0"
                            >
                                <RefreshCcw size={12} /> Regenerate Mockup
                            </button>
                        </div>
                    )}
                    <MockupErrorBoundary resetKey={preferred.id}>
                        <MockupViewer
                            payload={payload}
                            settings={settings}
                            staleness={staleness}
                            versionNumber={preferred.versionNumber}
                            createdAt={preferred.createdAt}
                            sourceSpineVersionId={preferred.sourceRefs.find(r => r.sourceType === 'spine')?.sourceArtifactVersionId}
                            versionId={preferred.id}
                            projectId={projectId}
                            artifactId={mockup.id}
                        />
                    </MockupErrorBoundary>
                </div>
            );
        }

        // Core artifact done state.
        const subtype = selected;
        const artifact = getArtifacts(projectId, 'core_artifact').find(a => a.subtype === subtype);
        const preferred = artifact ? getPreferredVersion(projectId, artifact.id) : undefined;
        if (!artifact || !preferred) {
            return <EmptyState message="Not generated yet" />;
        }
        const screenImageContext = subtype === 'screen_inventory'
            ? {
                projectId,
                artifactId: artifact.id,
                artifactVersionId: preferred.id,
                productTitle: structuredPRD.productName ?? getProject(projectId)?.name ?? 'this product',
                productSummary: structuredPRD.executiveSummary ?? structuredPRD.vision,
                designTokens,
                platformHint: (projectPlatform === 'app'
                    ? 'mobile'
                    : projectPlatform === 'web'
                        ? 'desktop'
                        : 'responsive') as 'mobile' | 'desktop' | 'responsive',
            }
            : undefined;
        const promptEdits = subtype === 'prompt_pack'
            ? ((preferred.metadata?.promptEdits as Record<number, string> | undefined) ?? {})
            : undefined;
        const handleUpdatePromptEdits = subtype === 'prompt_pack'
            ? (next: Record<number, string>) => {
                updateArtifactVersionMetadata(projectId, artifact.id, preferred.id, { promptEdits: next });
            }
            : undefined;
        return (
            <div className="max-w-3xl xl:max-w-5xl 2xl:max-w-6xl mx-auto space-y-4">
                <div className="flex items-center justify-start">
                    {renderVersionControls(artifact.id, preferred)}
                </div>
                {subtype === 'design_system' && (
                    <DesignDirectionControl
                        presetId={designSystemPreset}
                        onChangeDirection={() => setShowDirectionPicker(true)}
                        onRegenerate={() =>
                            setDesignRegenConfirm({ nextVersion: preferred.versionNumber + 1 })
                        }
                    />
                )}
                {subtype === 'implementation_plan' && (() => {
                    const savedCount = projectTasks.filter(t => t.sourceArtifactId === artifact.id).length;
                    return (
                        <div className="flex items-center justify-end">
                            <button
                                type="button"
                                onClick={() =>
                                    setTasksModalSource({
                                        artifactId: artifact.id,
                                        content: preferred.content,
                                    })
                                }
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md transition"
                            >
                                <ListChecks size={12} />
                                {savedCount > 0 ? `Manage Tasks (${savedCount})` : 'Convert to Tasks'}
                            </button>
                        </div>
                    );
                })()}
                {subtype === 'implementation_plan' && (
                    <TaskChecklist projectId={projectId} sourceArtifactId={artifact.id} />
                )}
                <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-6 prose prose-sm prose-neutral max-w-none overflow-auto">
                    <MockupErrorBoundary
                        resetKey={preferred.id}
                        fallback={
                            <div className="text-sm text-neutral-500 not-prose">
                                <p className="font-medium text-neutral-700 mb-1">Unable to render this artifact</p>
                                <p>
                                    The saved content for this version could not be displayed. Try
                                    regenerating the artifact or selecting a different version.
                                </p>
                            </div>
                        }
                    >
                    <ArtifactContentRenderer
                        subtype={subtype}
                        content={preferred.content}
                        screenImageContext={screenImageContext}
                        metadata={preferred.metadata}
                        projectId={projectId}
                        features={
                            subtype === 'prompt_pack' || subtype === 'user_flows'
                                ? structuredPRD.features
                                : undefined
                        }
                        uxPages={subtype === 'user_flows' ? structuredPRD.uxPages : undefined}
                        domainEntities={subtype === 'user_flows' ? structuredPRD.domainEntities : undefined}
                        featureSystems={subtype === 'user_flows' ? structuredPRD.featureSystems : undefined}
                        implementationPlan={subtype === 'user_flows' ? structuredPRD.implementationPlan : undefined}
                        promptEdits={promptEdits}
                        onUpdatePromptEdits={handleUpdatePromptEdits}
                        generatedAt={subtype === 'prompt_pack' ? preferred.createdAt : undefined}
                        versionNumber={subtype === 'prompt_pack' ? preferred.versionNumber : undefined}
                    />
                    </MockupErrorBoundary>
                </div>
            </div>
        );
    };

    const selectedMeta = slotMetas.find(s => s.key === selected);
    const handleSelect = (key: WorkspaceSelection) => {
        setSelected(key);
        setMobileSidebarOpen(false);
    };

    return (
        <div className="flex h-full flex-1 min-w-0 relative bg-neutral-50">
            {/* Mobile drawer backdrop */}
            {mobileSidebarOpen && (
                <button
                    type="button"
                    aria-label="Close artifact list"
                    onClick={() => setMobileSidebarOpen(false)}
                    className="md:hidden absolute inset-0 bg-black/30 z-30"
                />
            )}

            {/* Left rail — fixed sidebar on md+, slide-in drawer on mobile */}
            <aside
                className={`
                    absolute md:static inset-y-0 left-0 z-40 w-64 shrink-0
                    border-r border-neutral-200 bg-white overflow-y-auto
                    transition-transform duration-200 ease-out
                    ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
                    md:translate-x-0
                `}
            >
                <div className="md:hidden flex items-center justify-between px-3 py-2 border-b border-neutral-100">
                    <span className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Artifacts</span>
                    <button
                        type="button"
                        onClick={() => setMobileSidebarOpen(false)}
                        aria-label="Close artifact list"
                        className="p-1.5 -mr-1 text-neutral-500 hover:text-neutral-900"
                    >
                        <X size={18} />
                    </button>
                </div>
                <nav aria-label="Artifacts" className="py-2">
                    {ARTIFACT_GROUPS.map((group, groupIdx) => {
                        const SectionIcon = group.icon;
                        const groupSlots = group.items
                            .map(key => slotMetas.find(s => s.key === key))
                            .filter((s): s is SlotMeta => Boolean(s));
                        if (groupSlots.length === 0) return null;
                        return (
                            <div
                                key={group.id}
                                className={
                                    groupIdx > 0
                                        ? 'mt-3 pt-3 border-t border-neutral-200/70'
                                        : undefined
                                }
                            >
                                <div className="px-4 pb-1.5 flex items-center gap-2">
                                    <SectionIcon size={14} className="shrink-0 text-indigo-500" aria-hidden="true" />
                                    <span className="text-[11px] font-semibold text-indigo-600 uppercase tracking-wider">
                                        {group.title}
                                    </span>
                                </div>
                                <ul>
                                    {groupSlots.map(slot => {
                                        const status = slotStatusFor(slot.key);
                                        const isSel = selected === slot.key;
                                        const Icon = slot.icon;
                                        return (
                                            <li key={slot.key}>
                                                <button
                                                    type="button"
                                                    onClick={() => handleSelect(slot.key)}
                                                    className={`w-full flex items-start gap-3 px-4 py-2.5 text-left transition border-l-2 ${
                                                        isSel
                                                            ? 'bg-indigo-50 border-indigo-500'
                                                            : 'border-transparent hover:bg-neutral-50'
                                                    }`}
                                                >
                                                    <Icon size={16} className={`shrink-0 mt-0.5 ${isSel ? 'text-indigo-600' : 'text-neutral-400'}`} />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className={`text-sm font-medium truncate ${isSel ? 'text-indigo-900' : 'text-neutral-800'}`}>
                                                                {slot.title}
                                                            </span>
                                                            <StatusDot status={status} />
                                                        </div>
                                                        <div className="text-[11px] text-neutral-500 leading-tight truncate">
                                                            {slot.description}
                                                        </div>
                                                    </div>
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        );
                    })}
                </nav>
            </aside>

            {/* Main pane */}
            <main ref={mainRef} className="flex-1 min-w-0 overflow-y-auto bg-neutral-50 relative">
                {/* Mobile-only header with sidebar toggle and current artifact name */}
                <div className="md:hidden sticky top-0 z-10 flex items-center gap-2 px-3 py-2 bg-white border-b border-neutral-200">
                    <button
                        type="button"
                        onClick={() => setMobileSidebarOpen(true)}
                        aria-label="Open artifact list"
                        className="p-1.5 -ml-1 text-neutral-700 hover:text-neutral-900"
                    >
                        <Menu size={20} />
                    </button>
                    <span className="text-sm font-semibold text-neutral-800 truncate">
                        {selectedMeta?.title ?? 'Artifacts'}
                    </span>
                    {selected !== 'prd' && (
                        <span className="ml-auto shrink-0">
                            <StatusDot status={slotStatusFor(selected)} />
                        </span>
                    )}
                </div>
                <div className="p-4 md:p-8">
                    {renderMain()}
                </div>
            </main>

            {tasksModalSource && (
                <ConvertToTasksModal
                    projectId={projectId}
                    sourceArtifactId={tasksModalSource.artifactId}
                    sourceSpineVersionId={spineVersionId}
                    artifactContent={tasksModalSource.content}
                    projectName={getProject(projectId)?.name}
                    onClose={() => setTasksModalSource(null)}
                />
            )}

            {mockupRegenConfirm && (
                <div
                    className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-4"
                    onClick={() => setMockupRegenConfirm(null)}
                    role="presentation"
                >
                    <div
                        className="bg-white rounded-xl shadow-xl border border-neutral-200 w-full max-w-sm overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="mockup-regen-title"
                    >
                        <div className="px-5 pt-5 pb-3">
                            <h3 id="mockup-regen-title" className="text-base font-bold text-neutral-900">
                                Regenerate Mockup
                            </h3>
                            <p className="text-sm text-neutral-700 mt-1">
                                Creates Version {mockupRegenConfirm.nextVersion}.
                            </p>
                            <p className="text-xs text-neutral-500 mt-1">
                                Current version remains available in version history.
                            </p>
                        </div>
                        <div className="px-5 pb-4 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setMockupRegenConfirm(null)}
                                className="px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 rounded-md transition"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setMockupRegenConfirm(null);
                                    handleRetrySlot('mockup');
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded-md transition"
                            >
                                <RefreshCcw size={13} /> Regenerate
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showDirectionPicker && (
                <DesignSystemPresetChoice
                    currentPresetId={designSystemPreset}
                    title="Change your visual direction"
                    description="Pick a new direction for this project's design system. Internal mockups and the prompts you copy for external image tools both follow it, so everything stays consistent."
                    onChoose={handleChooseDirection}
                    onClose={() => setShowDirectionPicker(false)}
                />
            )}

            {designRegenConfirm && (
                <div
                    className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-4"
                    onClick={() => setDesignRegenConfirm(null)}
                    role="presentation"
                >
                    <div
                        className="bg-white rounded-xl shadow-xl border border-neutral-200 w-full max-w-sm overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="design-regen-title"
                    >
                        <div className="px-5 pt-5 pb-3">
                            <h3 id="design-regen-title" className="text-base font-bold text-neutral-900">
                                Regenerate design system
                            </h3>
                            <p className="text-sm text-neutral-700 mt-1">
                                Creates Version {designRegenConfirm.nextVersion} using your chosen direction.
                            </p>
                            <p className="text-xs text-neutral-500 mt-1">
                                This may make your existing mockups out of date — you can regenerate them
                                afterward. The current version remains in version history.
                            </p>
                        </div>
                        <div className="px-5 pb-4 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setDesignRegenConfirm(null)}
                                className="px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 rounded-md transition"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setDesignRegenConfirm(null);
                                    handleRetrySlot('design_system');
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded-md transition"
                            >
                                <RefreshCcw size={13} /> Regenerate
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {versionHistoryArtifactId && (() => {
                const artifactId = versionHistoryArtifactId;
                const versions = getArtifactVersions(projectId, artifactId);
                const preferred = getPreferredVersion(projectId, artifactId);
                const entries: VersionEntry[] = [...versions]
                    .sort((a, b) => b.versionNumber - a.versionNumber)
                    .map(v => ({
                        id: v.id,
                        label: `Version ${v.versionNumber}`,
                        isCurrent: v.isPreferred,
                        createdAt: v.createdAt,
                        changeSource: v.provenance?.changeSource,
                        editSummary: v.provenance?.editSummary,
                    }));
                return (
                    <VersionHistoryPanel
                        title="Artifact version history"
                        entries={entries}
                        restoreKind="artifact"
                        getCompareInput={(id) => ({
                            kind: 'text',
                            before: versions.find(v => v.id === id)?.content ?? '',
                            after: preferred?.content ?? '',
                        })}
                        onRestore={(id) => revertArtifactToVersion(projectId, artifactId, id)}
                        onClose={() => setVersionHistoryArtifactId(null)}
                    />
                );
            })()}
        </div>
    );
}

function BuildAssetsLoading() {
    return (
        <div className="max-w-lg mx-auto text-center py-16">
            <Loader2 size={32} className="mx-auto mb-4 text-indigo-500 animate-spin" />
            <h3 className="text-lg font-semibold text-neutral-900">Creating your build assets…</h3>
            <p className="text-sm text-neutral-500 mt-2 leading-relaxed">
                We&apos;re generating your data model, user flows, screen inventory, components,
                design system, implementation plan, prompt pack, and mockups. Each appears in
                the panel as it&apos;s ready.
            </p>
        </div>
    );
}

function EmptyState({ message }: { message: string }) {
    return (
        <div className="max-w-md mx-auto text-center text-neutral-500 py-12">
            <Circle size={28} className="mx-auto mb-3 text-neutral-300" />
            <p className="text-sm">{message}</p>
        </div>
    );
}
