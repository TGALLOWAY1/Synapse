import { useMemo, useState } from 'react';
import {
    AlertTriangle, AppWindow, ArrowRight, CheckCircle2, ChevronDown, ChevronUp, Circle,
    Code2, Database, ExternalLink, FileText, Image, Info, Loader2, Package, Palette,
    ListChecks, PencilLine, RefreshCcw, ShieldCheck, Waypoints, X,
} from 'lucide-react';
import { useProjectStore } from '../../store/projectStore';
import { artifactJobController } from '../../lib/services/artifactJobController';
import { selectPreferredDesignSystem } from '../../lib/designTokens';
import {
    buildArtifactDependencyGraph,
    computeDisplayEdges,
    computeDownstreamImpacts,
    computeGraphLayout,
    computeRecommendedUpdates,
    computeUpdateOrder,
    evaluateDependencyGraph,
    getDependencyNode,
    getDirectDependencies,
    type DependencyEvaluationInput,
    type DependencyNodeEvaluation,
    type DependencyNodeId,
    type DependencyNodeStatus,
} from '../../lib/artifactDependencyGraph';
import { findFeatureReferences, makeSpineChangeResolver } from '../../lib/spineChangeAnalysis';
import { OutputAlignmentBadge } from '../OutputAlignmentStatus';
import type { OutputAlignment } from '../../lib/planning/outputAlignment';
import type {
    ArtifactSlotKey, GenerationStatus, ProjectPlatform, StructuredPRD,
} from '../../types';

interface DependencyGraphViewProps {
    projectId: string;
    spineVersionId: string;
    prdContent: string;
    structuredPRD: StructuredPRD;
    projectPlatform?: ProjectPlatform;
    /** Navigate the workspace to a node's artifact view. */
    onOpenNode: (nodeId: DependencyNodeId) => void;
    /** Open a bounded, non-executing update plan for a supported affected output. */
    onOpenUpdatePlan?: (artifactId: string) => void;
}

const NODE_ICONS: Record<DependencyNodeId, typeof FileText> = {
    prd: FileText,
    design_system: Palette,
    screen_inventory: AppWindow,
    user_flows: Waypoints,
    data_model: Database,
    implementation_plan: Code2,
    mockup: Image,
    component_inventory: Package,
    prompt_pack: Package,
};

// Canvas geometry (deterministic — no DOM measurement).
const CARD_W = 200;
const CARD_H = 86;
const GAP_X = 28;
const ROW_GAP = 64;

const STATUS_LABELS: Record<DependencyNodeStatus, string> = {
    source: 'Source of truth',
    up_to_date: 'Up to date',
    needs_update: 'Review required',
    update_recommended: 'Review recommended',
    generating: 'Generating…',
    error: 'Failed',
    missing: 'Not generated',
};

const STATUS_PILL_CLASSES: Record<DependencyNodeStatus, string> = {
    source: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    up_to_date: 'bg-green-50 text-green-700 border-green-200',
    needs_update: 'bg-amber-50 text-amber-800 border-amber-300',
    update_recommended: 'bg-amber-50 text-amber-700 border-amber-200',
    generating: 'bg-sky-50 text-sky-700 border-sky-200',
    error: 'bg-red-50 text-red-700 border-red-200',
    missing: 'bg-neutral-100 text-neutral-500 border-neutral-200',
};

function StatusIcon({ status }: { status: DependencyNodeStatus }) {
    if (status === 'source' || status === 'up_to_date') {
        return <CheckCircle2 size={13} className={status === 'source' ? 'text-indigo-500' : 'text-green-500'} />;
    }
    if (status === 'generating') return <Loader2 size={13} className="text-sky-500 animate-spin" />;
    if (status === 'error') return <AlertTriangle size={13} className="text-red-500" />;
    if (status === 'missing') return <Circle size={13} className="text-neutral-400" />;
    return <AlertTriangle size={13} className="text-amber-500" />;
}

function StatusPill({ status }: { status: DependencyNodeStatus }) {
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${STATUS_PILL_CLASSES[status]}`}>
            <StatusIcon status={status} />
            {STATUS_LABELS[status]}
        </span>
    );
}

function ImpactedPill() {
    return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-blue-700 text-[11px] font-medium">
            <Info size={12} /> Impacted
        </span>
    );
}

const formatDate = (ts?: number): string | undefined =>
    ts === undefined
        ? undefined
        : new Date(ts).toLocaleString(undefined, {
            month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
        });

type DetailTab = 'overview' | 'dependencies' | 'impact' | 'history';
type ViewMode = 'graph' | 'impact';

export function DependencyGraphView({
    projectId, spineVersionId, prdContent, structuredPRD, projectPlatform, onOpenNode, onOpenUpdatePlan,
}: DependencyGraphViewProps) {
    const {
        getArtifacts, getPreferredVersion, getSpineVersions, getArtifactVersions, getProjectOutputAlignment, getJob,
    } = useProjectStore();

    const graph = useMemo(() => buildArtifactDependencyGraph(), []);
    const layout = useMemo(() => computeGraphLayout(graph), [graph]);
    const displayEdges = useMemo(() => computeDisplayEdges(graph), [graph]);

    const [mode, setMode] = useState<ViewMode>('graph');
    const [selectedId, setSelectedId] = useState<DependencyNodeId | null>(null);
    const [detailTab, setDetailTab] = useState<DetailTab>('overview');
    const [showLegend, setShowLegend] = useState(false);
    const [updateConfirm, setUpdateConfirm] = useState<
        { title: string; order: DependencyNodeId[] } | null
    >(null);

    // --- evaluation input from live store data --------------------------------
    const spines = getSpineVersions(projectId);
    const latestSpine = spines.find(s => s.isLatest);
    const job = getJob(projectId);
    const coreArtifacts = getArtifacts(projectId, 'core_artifact');
    const mockupArtifact = getArtifacts(projectId, 'mockup')[0];
    const currentDesign = selectPreferredDesignSystem(useProjectStore.getState(), projectId);
    const outputAlignment = getProjectOutputAlignment(projectId);
    const alignmentByNode = new Map(outputAlignment.outputs.map(item => [item.nodeId, item]));

    const snapshots: DependencyEvaluationInput['snapshots'] = {};
    const slotStatus: Partial<Record<ArtifactSlotKey, GenerationStatus>> = {};
    const artifactIdByNode = new Map<DependencyNodeId, string>();
    for (const node of graph.nodes) {
        if (node.id === 'prd') continue;
        const slotKey = node.id as ArtifactSlotKey;
        const artifact = slotKey === 'mockup'
            ? mockupArtifact
            : coreArtifacts.find(a => a.subtype === slotKey && a.status !== 'archived');
        const preferred = artifact ? getPreferredVersion(projectId, artifact.id) : undefined;
        if (artifact && preferred) {
            artifactIdByNode.set(node.id, artifact.id);
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
        const live = job?.slots[slotKey]?.status;
        if (live && live !== 'idle') slotStatus[slotKey] = live;
    }

    // Change-aware staleness: resolves "what changed since spine X" against
    // the latest spine (memoized per spine pair inside the resolver).
    const spineChangeFor = useMemo(
        () => makeSpineChangeResolver(spines, latestSpine?.id),
        [spines, latestSpine?.id],
    );

    const evaluations = evaluateDependencyGraph(graph, {
        spineVersionIds: spines.map(s => s.id),
        latestSpineId: latestSpine?.id,
        latestSpineProvenance: latestSpine?.provenance,
        currentDesignTokensHash: currentDesign?.tokensHash,
        snapshots,
        slotStatus,
        spineChangeFor,
    });

    const recommendedUpdates = computeRecommendedUpdates(graph, evaluations);
    const jobActive = !!job && Object.values(job.slots).some(
        s => s && (s.status === 'generating' || s.status === 'queued'),
    );

    const startArgs = { projectId, spineVersionId, prdContent, structuredPRD, projectPlatform };

    const runUpdates = (order: DependencyNodeId[]) => {
        const slots = order.filter((id): id is ArtifactSlotKey => id !== 'prd');
        if (slots.length === 0) return;
        if (slots.length === 1) {
            artifactJobController.retrySlot(slots[0], startArgs);
        } else {
            artifactJobController.regenerateSlots(slots, startArgs);
        }
        setUpdateConfirm(null);
    };

    const titleOf = (id: DependencyNodeId) => getDependencyNode(graph, id)?.title ?? id;
    const evalOf = (id: DependencyNodeId): DependencyNodeEvaluation | undefined => evaluations.get(id);

    const selectNode = (id: DependencyNodeId) => {
        setSelectedId(prev => (prev === id ? prev : id));
        setDetailTab('overview');
    };

    // Confirm-modal openers -----------------------------------------------------
    const confirmSingleUpdate = (id: DependencyNodeId) => {
        if (id === 'prd') return;
        setUpdateConfirm({ title: `Update ${titleOf(id)}`, order: [id] });
    };
    const confirmImpactedUpdate = (id: DependencyNodeId) => {
        // The node itself + everything downstream that the map says consumes it.
        const { direct, indirect } = computeDownstreamImpacts(graph, id);
        const ids = [id, ...direct, ...indirect].filter(n => n !== 'prd');
        setUpdateConfirm({
            title: `Update ${titleOf(id)} and downstream artifacts`,
            order: computeUpdateOrder(graph, ids),
        });
    };
    const confirmRecommendedUpdate = () => {
        setUpdateConfirm({ title: 'Update all impacted artifacts', order: recommendedUpdates });
    };

    // --- canvas geometry --------------------------------------------------------
    const maxCols = Math.max(...layout.rows.map(r => r.length));
    const canvasW = maxCols * CARD_W + (maxCols - 1) * GAP_X;
    const canvasH = layout.rows.length * CARD_H + (layout.rows.length - 1) * ROW_GAP;
    const positions = new Map<DependencyNodeId, { x: number; y: number }>();
    layout.rows.forEach((row, r) => {
        const rowWidth = row.length * CARD_W + (row.length - 1) * GAP_X;
        row.forEach((id, i) => {
            positions.set(id, {
                x: (canvasW - rowWidth) / 2 + i * (CARD_W + GAP_X),
                y: r * (CARD_H + ROW_GAP),
            });
        });
    });

    // Is this edge the cause of the target's staleness?
    const edgeIsStaleCause = (from: DependencyNodeId, to: DependencyNodeId): boolean =>
        !!evalOf(to)?.reasons.some(r => r.dependencyId === from);

    // Cheap (≤7 nodes) — recomputed per render from the live evaluations.
    const summaryCounts = {
        stale: outputAlignment.blockingCount,
        review: outputAlignment.outputs.filter(item => item.state === 'possibly_affected' && !item.blocksBuildReadiness).length,
        ok: outputAlignment.alignedCount,
        missing: 0,
        generating: 0,
        error: 0,
    };
    for (const node of graph.nodes) {
        if (node.id === 'prd') continue;
        const s = evalOf(node.id)?.status;
        if (s === 'missing') summaryCounts.missing++;
        else if (s === 'generating') summaryCounts.generating++;
        else if (s === 'error') summaryCounts.error++;
    }

    const selectedEval = selectedId ? evalOf(selectedId) : undefined;

    // "Confirm aligned" — the user asserts the artifact is still valid for
    // the current PRD; the store appends a rebased clone (honest history).
    const canMarkCurrent = (id: DependencyNodeId): boolean => {
        const ev = evalOf(id);
        return !!latestSpine
            && artifactIdByNode.has(id)
            && (ev?.status === 'needs_update' || ev?.status === 'update_recommended');
    };
    const markCurrentNode = (id: DependencyNodeId) => {
        const artifactId = artifactIdByNode.get(id);
        if (!artifactId || !latestSpine) return;
        useProjectStore.getState().markArtifactCurrentForSpine(projectId, artifactId, latestSpine.id);
    };

    // Removed features (per the selected node's PRD change summary) that the
    // artifact's current content still mentions — the deletion blast radius.
    const selectedRemovedFeatureRefs: string[] = (() => {
        if (!selectedId || selectedId === 'prd' || !selectedEval) return [];
        const summary = selectedEval.reasons.find(r => r.kind === 'prd_changed')?.changeSummary;
        if (!summary || summary.features.removed.length === 0) return [];
        const artifactId = artifactIdByNode.get(selectedId);
        const content = artifactId ? getPreferredVersion(projectId, artifactId)?.content ?? '' : '';
        if (!content) return [];
        const candidate = [{ artifactId: artifactId!, title: titleOf(selectedId), content }];
        return summary.features.removed
            .filter(f => findFeatureReferences(f, candidate).length > 0)
            .map(f => f.name);
    })();

    return (
        <div className="max-w-5xl mx-auto space-y-4">
            {/* Header */}
            <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-4 md:p-5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-start gap-3 min-w-0">
                        <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 shrink-0">
                            <Waypoints size={18} />
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-base font-bold text-neutral-900">Dependency Graph</h2>
                            <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">
                                How your artifacts relate to each other and the impact of changes
                                across your project.
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowLegend(v => !v)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md transition shrink-0"
                    >
                        {showLegend ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Legend
                    </button>
                </div>

                <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
                    {/* Mode toggle */}
                    <div className="inline-flex rounded-lg border border-neutral-200 p-0.5 bg-neutral-50">
                        {(['graph', 'impact'] as ViewMode[]).map(m => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => setMode(m)}
                                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                                    mode === m
                                        ? 'bg-white text-indigo-700 shadow-sm border border-neutral-200'
                                        : 'text-neutral-600 hover:text-neutral-900'
                                }`}
                            >
                                {m === 'graph' ? 'Graph View' : 'Impact View'}
                            </button>
                        ))}
                    </div>
                    {/* Health summary + batch action */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] text-neutral-500">
                            {summaryCounts.ok} aligned
                            {summaryCounts.stale > 0 && ` · ${summaryCounts.stale} require${summaryCounts.stale === 1 ? 's' : ''} review before build`}
                            {summaryCounts.review > 0 && ` · ${summaryCounts.review} advisory`}
                            {summaryCounts.missing > 0 && ` · ${summaryCounts.missing} not generated`}
                            {summaryCounts.generating > 0 && ` · ${summaryCounts.generating} generating`}
                            {summaryCounts.error > 0 && ` · ${summaryCounts.error} failed`}
                        </span>
                        {recommendedUpdates.length > 0 && (
                            <button
                                type="button"
                                disabled={jobActive}
                                onClick={confirmRecommendedUpdate}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                                title={jobActive ? 'Generation is already running' : undefined}
                            >
                                <RefreshCcw size={12} />
                                {outputAlignment.outputs.length === 0
                                    ? `Generate ${recommendedUpdates.length} outputs`
                                    : `Review ${recommendedUpdates.length} affected`}
                            </button>
                        )}
                    </div>
                </div>

                {showLegend && (
                    <div className="mt-3 pt-3 border-t border-neutral-100 flex items-center gap-x-4 gap-y-2 flex-wrap text-[11px] text-neutral-600">
                        <StatusPill status="up_to_date" />
                        <StatusPill status="needs_update" />
                        <StatusPill status="update_recommended" />
                        <ImpactedPill />
                        <StatusPill status="missing" />
                        <span className="inline-flex items-center gap-1.5">
                            <svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" stroke="#a3a3a3" strokeWidth="1.5" /></svg>
                            depends on
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4 3" /></svg>
                            changed input — review the relationship
                        </span>
                    </div>
                )}
            </div>

            {/* Graph canvas / impact list */}
            {mode === 'graph' ? (
                <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-4 overflow-x-auto">
                    <div className="relative mx-auto" style={{ width: canvasW, height: canvasH }}>
                        <svg
                            className="absolute inset-0 pointer-events-none"
                            width={canvasW}
                            height={canvasH}
                            aria-hidden="true"
                        >
                            {displayEdges.map(edge => {
                                const from = positions.get(edge.from);
                                const to = positions.get(edge.to);
                                if (!from || !to) return null;
                                const x1 = from.x + CARD_W / 2;
                                const y1 = from.y + CARD_H;
                                const x2 = to.x + CARD_W / 2;
                                const y2 = to.y;
                                const midY = (y1 + y2) / 2;
                                const stale = edgeIsStaleCause(edge.from, edge.to);
                                const active = !stale && selectedId !== null
                                    && (edge.from === selectedId || edge.to === selectedId);
                                const stroke = stale ? '#f59e0b' : active ? '#6366f1' : '#d4d4d4';
                                return (
                                    <path
                                        key={`${edge.from}-${edge.to}`}
                                        d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                                        fill="none"
                                        stroke={stroke}
                                        strokeWidth={stale || active ? 2 : 1.5}
                                        strokeDasharray={stale ? '5 4' : undefined}
                                    />
                                );
                            })}
                        </svg>
                        {graph.nodes.map(node => {
                            const pos = positions.get(node.id);
                            if (!pos) return null;
                            const ev = evalOf(node.id);
                            const status = ev?.status ?? 'missing';
                            const impacted = status === 'up_to_date' && (ev?.impactedBy.length ?? 0) > 0;
                            const alignment = node.id === 'prd' ? undefined : alignmentByNode.get(node.id as ArtifactSlotKey);
                            const Icon = NODE_ICONS[node.id] ?? Package;
                            const isSel = selectedId === node.id;
                            return (
                                <button
                                    key={node.id}
                                    type="button"
                                    onClick={() => selectNode(node.id)}
                                    style={{ left: pos.x, top: pos.y, width: CARD_W, height: CARD_H }}
                                    className={`absolute text-left rounded-xl border bg-white px-3 py-2.5 shadow-sm transition ${
                                        isSel
                                            ? 'border-indigo-500 ring-2 ring-indigo-200'
                                            : 'border-neutral-200 hover:border-indigo-300 hover:shadow'
                                    }`}
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        <Icon size={15} className={isSel ? 'text-indigo-600 shrink-0' : 'text-neutral-500 shrink-0'} />
                                        <span className="text-sm font-semibold text-neutral-900 truncate">{node.title}</span>
                                        {ev?.manuallyEdited && (
                                            <PencilLine size={12} className="text-amber-500 shrink-0" aria-label="Edited manually" />
                                        )}
                                    </div>
                                    <div className="mt-1 text-[11px] text-neutral-500 truncate">
                                        {node.id === 'prd'
                                            ? 'Source of truth'
                                            : ev?.versionNumber !== undefined
                                                ? `v${ev.versionNumber}${ev.generatedAt ? ` · ${new Date(ev.generatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}`
                                                : STATUS_LABELS[status]}
                                    </div>
                                    <div className="mt-1.5 flex items-center gap-1.5 overflow-hidden">
                                        {node.id === 'prd'
                                            ? <StatusPill status="source" />
                                            : alignment
                                                ? <OutputAlignmentBadge alignment={alignment} />
                                                : impacted
                                                ? <ImpactedPill />
                                                : <StatusPill status={status} />}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            ) : (
                <ImpactModePanel
                    graph={graph}
                    evaluations={evaluations}
                    selectedId={selectedId ?? 'prd'}
                    onSelect={selectNode}
                    titleOf={titleOf}
                />
            )}

            {/* Detail panel */}
            {selectedId && selectedEval && (
                <DetailPanel
                    key={selectedId}
                    nodeId={selectedId}
                    evaluation={selectedEval}
                    alignment={selectedId === 'prd' ? undefined : alignmentByNode.get(selectedId as ArtifactSlotKey)}
                    graph={graph}
                    evaluations={evaluations}
                    tab={detailTab}
                    onTabChange={setDetailTab}
                    onClose={() => setSelectedId(null)}
                    onSelect={selectNode}
                    onOpenNode={onOpenNode}
                    onOpenUpdatePlan={
                        onOpenUpdatePlan
                        && (selectedId === 'screen_inventory' || selectedId === 'user_flows' || selectedId === 'data_model')
                        && artifactIdByNode.has(selectedId)
                        && alignmentByNode.get(selectedId)?.state !== 'aligned'
                            ? () => onOpenUpdatePlan(artifactIdByNode.get(selectedId)!)
                            : undefined
                    }
                    onUpdate={() => confirmSingleUpdate(selectedId)}
                    onUpdateImpacted={() => confirmImpactedUpdate(selectedId)}
                    onMarkCurrent={canMarkCurrent(selectedId) ? () => markCurrentNode(selectedId) : undefined}
                    removedFeatureRefs={selectedRemovedFeatureRefs}
                    jobActive={jobActive}
                    titleOf={titleOf}
                    history={
                        selectedId === 'prd'
                            ? spines.map((s, i) => ({
                                id: s.id,
                                label: `Version ${i + 1}`,
                                createdAt: s.createdAt,
                                changeSource: s.provenance?.changeSource,
                            })).reverse()
                            : (artifactIdByNode.has(selectedId)
                                ? [...getArtifactVersions(projectId, artifactIdByNode.get(selectedId)!)]
                                    .sort((a, b) => b.versionNumber - a.versionNumber)
                                    .map(v => ({
                                        id: v.id,
                                        label: `Version ${v.versionNumber}`,
                                        createdAt: v.createdAt,
                                        changeSource: v.provenance?.changeSource,
                                    }))
                                : [])
                    }
                />
            )}

            {/* Update confirm modal */}
            {updateConfirm && (
                <div
                    className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-4"
                    onClick={() => setUpdateConfirm(null)}
                    role="presentation"
                >
                    <div
                        className="bg-white rounded-xl shadow-xl border border-neutral-200 w-full max-w-sm overflow-hidden"
                        onClick={e => e.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="dep-update-title"
                    >
                        <div className="px-5 pt-5 pb-3">
                            <h3 id="dep-update-title" className="text-base font-bold text-neutral-900">
                                {updateConfirm.title}
                            </h3>
                            <p className="text-sm text-neutral-700 mt-1">
                                {updateConfirm.order.length === 1
                                    ? `Regenerates ${titleOf(updateConfirm.order[0])} as a new version.`
                                    : 'Regenerates these artifacts in dependency order, so each uses the reviewed upstream version:'}
                            </p>
                            {updateConfirm.order.length > 1 && (
                                <ol className="mt-2 space-y-1">
                                    {updateConfirm.order.map((id, i) => (
                                        <li key={id} className="flex items-center gap-2 text-sm text-neutral-800">
                                            <span className="w-4 text-right text-[11px] text-neutral-400">{i + 1}.</span>
                                            {titleOf(id)}
                                        </li>
                                    ))}
                                </ol>
                            )}
                            <p className="text-xs text-neutral-500 mt-2">
                                Current versions remain available in version history.
                            </p>
                        </div>
                        <div className="px-5 pb-4 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setUpdateConfirm(null)}
                                className="px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 rounded-md transition"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => runUpdates(updateConfirm.order)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded-md transition"
                            >
                                <RefreshCcw size={13} />
                                {updateConfirm.order.length === 1 ? 'Update' : `Update ${updateConfirm.order.length} artifacts`}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Impact mode — list-first exploration of one artifact's blast radius
// ---------------------------------------------------------------------------

interface ImpactModePanelProps {
    graph: ReturnType<typeof buildArtifactDependencyGraph>;
    evaluations: Map<DependencyNodeId, DependencyNodeEvaluation>;
    selectedId: DependencyNodeId;
    onSelect: (id: DependencyNodeId) => void;
    titleOf: (id: DependencyNodeId) => string;
}

function ImpactModePanel({ graph, evaluations, selectedId, onSelect, titleOf }: ImpactModePanelProps) {
    const ev = evaluations.get(selectedId);
    const deps = getDirectDependencies(graph, selectedId);
    const { direct, indirect } = computeDownstreamImpacts(graph, selectedId);
    const updateChain = computeUpdateOrder(
        graph,
        [selectedId, ...direct, ...indirect].filter(id => id !== 'prd'),
    );

    const nodeRow = (id: DependencyNodeId) => {
        const e = evaluations.get(id);
        return (
            <button
                key={id}
                type="button"
                onClick={() => onSelect(id)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-neutral-200 hover:border-indigo-300 bg-white text-left transition"
            >
                <span className="text-sm font-medium text-neutral-800 truncate">{titleOf(id)}</span>
                <StatusPill status={e?.status ?? 'missing'} />
            </button>
        );
    };

    return (
        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-4 md:p-5 space-y-4">
            <div>
                <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider mb-1.5">
                    Selected artifact
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    {graph.nodes.map(n => (
                        <button
                            key={n.id}
                            type="button"
                            onClick={() => onSelect(n.id)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition ${
                                n.id === selectedId
                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                    : 'bg-white text-neutral-700 border-neutral-200 hover:border-indigo-300'
                            }`}
                        >
                            {n.title}
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
                <div>
                    <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider mb-1.5">
                        Direct dependencies
                    </div>
                    {deps.length === 0
                        ? <p className="text-sm text-neutral-500">None — this is the source of truth.</p>
                        : <div className="space-y-1.5">{deps.map(nodeRow)}</div>}
                </div>
                <div>
                    <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider mb-1.5">
                        Impacts downstream
                    </div>
                    {direct.length === 0 && indirect.length === 0
                        ? <p className="text-sm text-neutral-500">Nothing downstream consumes this artifact.</p>
                        : (
                            <div className="space-y-1.5">
                                {direct.map(nodeRow)}
                                {indirect.length > 0 && (
                                    <>
                                        <div className="text-[11px] text-neutral-400 pt-1">Indirect</div>
                                        {indirect.map(nodeRow)}
                                    </>
                                )}
                            </div>
                        )}
                </div>
            </div>

            {ev && ev.reasons.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div className="text-sm font-semibold text-amber-900 mb-1">Why review?</div>
                    <ul className="space-y-1.5">
                        {ev.reasons.map((r, i) => (
                            <li key={i} className="text-xs text-amber-800 leading-relaxed">
                                {r.detail}
                                {r.changeSummary && (
                                    <span className="block mt-0.5 font-medium text-amber-900">
                                        What changed: {r.changeSummary.headline}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {updateChain.length > 1 && (
                <div>
                    <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider mb-1.5">
                        Recommended update order after changing {titleOf(selectedId)}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap text-sm text-neutral-800">
                        {updateChain.map((id, i) => (
                            <span key={id} className="inline-flex items-center gap-1.5">
                                {i > 0 && <ArrowRight size={13} className="text-neutral-400" />}
                                <span className="px-2 py-1 rounded-md bg-neutral-100">{titleOf(id)}</span>
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Detail panel — Overview / Dependencies / Impact / History for one node
// ---------------------------------------------------------------------------

interface HistoryEntry {
    id: string;
    label: string;
    createdAt: number;
    changeSource?: string;
}

interface DetailPanelProps {
    nodeId: DependencyNodeId;
    evaluation: DependencyNodeEvaluation;
    alignment?: OutputAlignment;
    graph: ReturnType<typeof buildArtifactDependencyGraph>;
    evaluations: Map<DependencyNodeId, DependencyNodeEvaluation>;
    tab: DetailTab;
    onTabChange: (tab: DetailTab) => void;
    onClose: () => void;
    onSelect: (id: DependencyNodeId) => void;
    onOpenNode: (id: DependencyNodeId) => void;
    onOpenUpdatePlan?: () => void;
    onUpdate: () => void;
    onUpdateImpacted: () => void;
    /** Present only when the node is stale and can be confirmed current. */
    onMarkCurrent?: () => void;
    /** Removed-feature names this artifact's content still mentions. */
    removedFeatureRefs: string[];
    jobActive: boolean;
    titleOf: (id: DependencyNodeId) => string;
    history: HistoryEntry[];
}

const CHANGE_SOURCE_LABELS: Record<string, string> = {
    ai_generation: 'AI generated',
    ai_regeneration: 'AI regenerated',
    ai_section_retry: 'Section retry',
    branch_merge: 'Branch merged',
    user_edit: 'Edited manually',
    revert: 'Restored',
    consistency_review: 'Consistency review',
};

function DetailPanel({
    nodeId, evaluation, alignment, graph, evaluations, tab, onTabChange, onClose, onSelect,
    onOpenNode, onOpenUpdatePlan, onUpdate, onUpdateImpacted, onMarkCurrent, removedFeatureRefs,
    jobActive, titleOf, history,
}: DetailPanelProps) {
    const node = getDependencyNode(graph, nodeId);
    const Icon = NODE_ICONS[nodeId] ?? Package;
    const deps = getDirectDependencies(graph, nodeId);
    const { direct, indirect } = computeDownstreamImpacts(graph, nodeId);
    const canUpdate = nodeId !== 'prd';
    const impacted = evaluation.status === 'up_to_date' && evaluation.impactedBy.length > 0;

    const TABS: Array<{ key: DetailTab; label: string }> = [
        { key: 'overview', label: 'Overview' },
        { key: 'dependencies', label: 'Dependencies' },
        { key: 'impact', label: 'Change Impact' },
        { key: 'history', label: 'History' },
    ];

    const nodeChip = (id: DependencyNodeId) => {
        const e = evaluations.get(id);
        return (
            <button
                key={id}
                type="button"
                onClick={() => onSelect(id)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-neutral-200 hover:border-indigo-300 bg-white text-left transition"
            >
                <span className="text-sm font-medium text-neutral-800 truncate">{titleOf(id)}</span>
                <span className="flex items-center gap-1.5 shrink-0">
                    {e?.versionNumber !== undefined && (
                        <span className="text-[11px] text-neutral-400">v{e.versionNumber}</span>
                    )}
                    <StatusPill status={e?.status ?? 'missing'} />
                </span>
            </button>
        );
    };

    return (
        <div className="bg-white rounded-xl border border-neutral-200 shadow-sm">
            {/* Header */}
            <div className="px-4 md:px-5 pt-4 flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-2 rounded-lg bg-neutral-100 text-neutral-600 shrink-0">
                        <Icon size={16} />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-bold text-neutral-900">{node?.title ?? nodeId}</h3>
                            {nodeId === 'prd'
                                ? <StatusPill status="source" />
                                : alignment ? <OutputAlignmentBadge alignment={alignment} />
                                    : impacted ? <ImpactedPill /> : <StatusPill status={evaluation.status} />}
                            {evaluation.manuallyEdited && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700 text-[11px] font-medium">
                                    <PencilLine size={11} /> Edited manually
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-neutral-500 mt-0.5">{node?.description}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {onOpenUpdatePlan && (
                        <button
                            type="button"
                            onClick={onOpenUpdatePlan}
                            className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-3 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100"
                        >
                            <ListChecks size={13} /> Update plan
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => onOpenNode(nodeId)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md transition"
                    >
                        <ExternalLink size={12} /> Open
                    </button>
                    {onMarkCurrent && (
                        <button
                            type="button"
                            onClick={onMarkCurrent}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-md hover:bg-emerald-100 transition"
                            title="Confirm this artifact is still valid for the current PRD without regenerating it"
                        >
                            <ShieldCheck size={12} /> Confirm aligned
                        </button>
                    )}
                    {canUpdate && (
                        <button
                            type="button"
                            disabled={jobActive}
                            onClick={onUpdate}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                            title={jobActive ? 'Generation is already running' : undefined}
                        >
                            <RefreshCcw size={12} /> Update
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close details"
                        className="p-1.5 text-neutral-400 hover:text-neutral-700 transition"
                    >
                        <X size={16} />
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="px-4 md:px-5 mt-3 border-b border-neutral-200 flex items-center gap-1 overflow-x-auto">
                {TABS.map(t => (
                    <button
                        key={t.key}
                        type="button"
                        onClick={() => onTabChange(t.key)}
                        className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px whitespace-nowrap transition ${
                            tab === t.key
                                ? 'border-indigo-600 text-indigo-700'
                                : 'border-transparent text-neutral-500 hover:text-neutral-800'
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            <div className="p-4 md:p-5">
                {tab === 'overview' && (
                    <div className="grid md:grid-cols-2 gap-4">
                        <div className="space-y-2 text-sm">
                            <dl className="space-y-1.5">
                                <div className="flex items-center justify-between gap-3">
                                    <dt className="text-xs text-neutral-500">Status</dt>
                                    <dd>{nodeId === 'prd' ? <StatusPill status="source" /> : alignment ? <OutputAlignmentBadge alignment={alignment} /> : <StatusPill status={evaluation.status} />}</dd>
                                </div>
                                {evaluation.generatedAt !== undefined && (
                                    <div className="flex items-center justify-between gap-3">
                                        <dt className="text-xs text-neutral-500">Last generated</dt>
                                        <dd className="text-xs text-neutral-800">{formatDate(evaluation.generatedAt)}</dd>
                                    </div>
                                )}
                                {evaluation.versionNumber !== undefined && (
                                    <div className="flex items-center justify-between gap-3">
                                        <dt className="text-xs text-neutral-500">Version</dt>
                                        <dd className="text-xs text-neutral-800">v{evaluation.versionNumber}</dd>
                                    </div>
                                )}
                                {evaluation.prdVersionLabel && (
                                    <div className="flex items-center justify-between gap-3">
                                        <dt className="text-xs text-neutral-500">Generated from</dt>
                                        <dd className="text-xs text-neutral-800">PRD {evaluation.prdVersionLabel}</dd>
                                    </div>
                                )}
                            </dl>
                            {impacted && (
                                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                                    <p className="text-xs text-blue-800 leading-relaxed">
                                        This artifact&rsquo;s own inputs match, but upstream{' '}
                                        {evaluation.impactedBy.map(titleOf).join(', ')}{' '}
                                        {evaluation.impactedBy.length === 1 ? 'needs' : 'need'} review —
                                        review upstream first, then decide whether this output also needs an update.
                                    </p>
                                </div>
                            )}
                        </div>
                        <div className="space-y-3">
                            {evaluation.reasons.length > 0 ? (
                                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                                    <div className="text-sm font-semibold text-amber-900 mb-1">Why review?</div>
                                    {alignment && alignment.state !== 'aligned' && (
                                        <div className="mb-2 text-xs text-amber-900 leading-relaxed">
                                            <p>{alignment.summary}</p>
                                            <p className="mt-1 font-medium">Next: {alignment.nextAction}</p>
                                            <p className="mt-1 text-amber-700">
                                                This saved output remains useful for exploration while alignment is reviewed.
                                            </p>
                                        </div>
                                    )}
                                    <ul className="space-y-1.5">
                                        {evaluation.reasons.map((r, i) => (
                                            <li key={i} className="text-xs text-amber-800 leading-relaxed">
                                                {r.detail}
                                                {r.changeSummary && (
                                                    <span className="block mt-0.5 font-medium text-amber-900">
                                                        What changed: {r.changeSummary.headline}
                                                    </span>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                    {removedFeatureRefs.length > 0 && (
                                        <p className="mt-2 pt-2 border-t border-amber-200 text-xs text-red-700 leading-relaxed">
                                            Still references removed feature{removedFeatureRefs.length === 1 ? '' : 's'}:{' '}
                                            <span className="font-semibold">{removedFeatureRefs.join(', ')}</span> —
                                            regenerate this artifact so deleted features stop appearing in it.
                                        </p>
                                    )}
                                    {evaluation.likelyUnaffected && removedFeatureRefs.length === 0 && (
                                        <p className="mt-2 pt-2 border-t border-amber-200 text-xs text-neutral-600 leading-relaxed">
                                            The PRD sections this asset chiefly derives from did not change —
                                            if it still looks right, you can <span className="font-medium">confirm it is aligned</span> instead
                                            of regenerating.
                                        </p>
                                    )}
                                </div>
                            ) : nodeId !== 'prd' && evaluation.status === 'up_to_date' && !impacted ? (
                                <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                                    <p className="text-xs text-green-800">
                                        All recorded inputs match their current versions.
                                    </p>
                                </div>
                            ) : null}
                            {canUpdate && (direct.length > 0 || indirect.length > 0) && (
                                <button
                                    type="button"
                                    disabled={jobActive}
                                    onClick={onUpdateImpacted}
                                    className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-neutral-200 hover:border-indigo-300 bg-white text-left transition disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <span>
                                        <span className="block text-sm font-medium text-neutral-800">
                                            Update this + downstream artifacts
                                        </span>
                                        <span className="block text-[11px] text-neutral-500 mt-0.5">
                                            {1 + direct.length + indirect.length} artifacts, regenerated in dependency order
                                        </span>
                                    </span>
                                    <RefreshCcw size={14} className="text-neutral-400 shrink-0" />
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {tab === 'dependencies' && (
                    deps.length === 0
                        ? <p className="text-sm text-neutral-500">This is the source of truth — it has no upstream dependencies.</p>
                        : <div className="space-y-1.5 max-w-md">{deps.map(nodeChip)}</div>
                )}

                {tab === 'impact' && (
                    (direct.length === 0 && indirect.length === 0)
                        ? <p className="text-sm text-neutral-500">Nothing downstream consumes this artifact.</p>
                        : (
                            <div className="space-y-3 max-w-md">
                                <div className="space-y-1.5">
                                    <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Direct</div>
                                    {direct.map(nodeChip)}
                                </div>
                                {indirect.length > 0 && (
                                    <div className="space-y-1.5">
                                        <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Indirect</div>
                                        {indirect.map(nodeChip)}
                                    </div>
                                )}
                            </div>
                        )
                )}

                {tab === 'history' && (
                    history.length === 0
                        ? <p className="text-sm text-neutral-500">No versions yet.</p>
                        : (
                            <ul className="space-y-1.5 max-w-md">
                                {history.slice(0, 6).map(entry => (
                                    <li
                                        key={entry.id}
                                        className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-neutral-200"
                                    >
                                        <span className="text-sm font-medium text-neutral-800">{entry.label}</span>
                                        <span className="flex items-center gap-2 text-[11px] text-neutral-500 shrink-0">
                                            {entry.changeSource && (
                                                <span className="px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600">
                                                    {CHANGE_SOURCE_LABELS[entry.changeSource] ?? entry.changeSource}
                                                </span>
                                            )}
                                            {formatDate(entry.createdAt)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )
                )}
            </div>
        </div>
    );
}
