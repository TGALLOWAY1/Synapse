import { useMemo, useState } from 'react';
import {
    FileText, Image, Package, CheckCircle2, Loader2, Circle, AlertTriangle,
    RefreshCcw, StopCircle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useProjectStore } from '../store/projectStore';
import { artifactJobController } from '../lib/services/artifactJobController';
import { CORE_ARTIFACT_DISPLAY_ORDER, getArtifactMeta } from '../lib/coreArtifactPipeline';
import { ArtifactContentRenderer } from './renderers';
import { StructuredPRDView } from './StructuredPRDView';
import { MockupViewer } from './mockups/MockupViewer';
import { MockupErrorBoundary } from './mockups/MockupErrorBoundary';
import { GenerationProgress } from './GenerationProgress';
import { MOCKUP_GENERATION_STAGES, getArtifactStages } from './generationStages';
import { tryParsePayload, extractMockupSettings } from '../lib/mockupParsing';
import type {
    ArtifactSlotKey, CoreArtifactSubtype, ProjectPlatform, StructuredPRD, GenerationStatus,
} from '../types';

interface ArtifactWorkspaceProps {
    projectId: string;
    spineVersionId: string;
    prdContent: string;
    structuredPRD: StructuredPRD;
    projectPlatform?: ProjectPlatform;
}

type WorkspaceSelection = 'prd' | ArtifactSlotKey;

interface SlotMeta {
    key: WorkspaceSelection;
    title: string;
    description: string;
    icon: typeof FileText;
}

function buildSlotMetas(): SlotMeta[] {
    return [
        { key: 'prd', title: 'PRD', description: 'Final product requirements document', icon: FileText },
        ...CORE_ARTIFACT_DISPLAY_ORDER.map(meta => ({
            key: meta.subtype as WorkspaceSelection,
            title: meta.title,
            description: meta.description,
            icon: Package,
        })),
        { key: 'mockup' as WorkspaceSelection, title: 'Mockups', description: 'Interactive UI mockups', icon: Image },
    ];
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

function statusLabel(status: GenerationStatus): string {
    switch (status) {
        case 'done': return 'Ready';
        case 'generating': return 'Generating…';
        case 'queued': return 'Queued';
        case 'error': return 'Failed';
        case 'interrupted': return 'Paused';
        default: return 'Idle';
    }
}

export function ArtifactWorkspace({
    projectId, spineVersionId, prdContent, structuredPRD, projectPlatform,
}: ArtifactWorkspaceProps) {
    const {
        getArtifacts, getPreferredVersion, getArtifactStaleness, getJob,
    } = useProjectStore();

    const slotMetas = useMemo(() => buildSlotMetas(), []);
    const [selected, setSelected] = useState<WorkspaceSelection>('prd');

    const job = getJob(projectId);

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

    // Derived counts for the right-rail header.
    const allKeys = slotMetas.map(s => s.key);
    const totalSlots = allKeys.length;
    const doneCount = allKeys.filter(k => slotStatusFor(k) === 'done').length;
    const generatingCount = allKeys.filter(k => slotStatusFor(k) === 'generating').length;
    const errorCount = allKeys.filter(k => slotStatusFor(k) === 'error').length;
    const interruptedCount = allKeys.filter(k => slotStatusFor(k) === 'interrupted').length;
    const isActive = generatingCount > 0 || allKeys.some(k => slotStatusFor(k) === 'queued');

    const handleRetrySlot = (slot: ArtifactSlotKey) => {
        artifactJobController.retrySlot(slot, {
            projectId, spineVersionId, prdContent, structuredPRD, projectPlatform,
        });
    };

    const handleCancelAll = () => {
        artifactJobController.cancelAll(projectId);
    };

    const handleResumeAll = () => {
        artifactJobController.startAll({
            projectId, spineVersionId, prdContent, structuredPRD, projectPlatform,
        });
    };

    const renderMain = () => {
        if (selected === 'prd') {
            return (
                <div className="max-w-3xl mx-auto">
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
            return (
                <div className="space-y-4">
                    <div className="flex items-center justify-end">
                        <button
                            type="button"
                            onClick={() => handleRetrySlot('mockup')}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md transition"
                        >
                            <RefreshCcw size={12} /> Regenerate Mockup
                        </button>
                    </div>
                    <MockupErrorBoundary>
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
        return (
            <div className="max-w-3xl mx-auto bg-white rounded-xl border border-neutral-200 shadow-sm p-6 prose prose-sm prose-neutral max-w-none overflow-auto">
                <ArtifactContentRenderer subtype={subtype} content={preferred.content} />
            </div>
        );
    };

    return (
        <div className="flex h-full">
            {/* Left rail */}
            <aside className="w-64 shrink-0 border-r border-neutral-200 bg-white overflow-y-auto">
                <ul className="py-2">
                    {slotMetas.map(slot => {
                        const status = slotStatusFor(slot.key);
                        const isSel = selected === slot.key;
                        const Icon = slot.icon;
                        return (
                            <li key={slot.key}>
                                <button
                                    type="button"
                                    onClick={() => setSelected(slot.key)}
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
            </aside>

            {/* Main pane */}
            <main className="flex-1 min-w-0 overflow-y-auto bg-neutral-50 p-6 md:p-8 relative">
                {renderMain()}
            </main>

            {/* Right rail — Generation Status */}
            <aside className="w-72 shrink-0 border-l border-neutral-200 bg-white overflow-y-auto">
                <div className="p-4 border-b border-neutral-200">
                    <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Generation Status</h3>
                    <p className="text-sm text-neutral-700 mt-1">
                        {doneCount} of {totalSlots} ready
                        {generatingCount > 0 && <span className="text-neutral-500"> · {generatingCount} generating</span>}
                    </p>
                </div>
                <ul className="py-2">
                    {slotMetas.map(slot => {
                        const status = slotStatusFor(slot.key);
                        return (
                            <li key={slot.key} className="px-4 py-2 flex items-center gap-3">
                                <StatusDot status={status} />
                                <span className="text-sm text-neutral-700 flex-1 truncate">{slot.title}</span>
                                <span className="text-[11px] text-neutral-400">{statusLabel(status)}</span>
                            </li>
                        );
                    })}
                </ul>
                <div className="px-4 py-3 border-t border-neutral-200 space-y-2">
                    {isActive && (
                        <button
                            type="button"
                            onClick={handleCancelAll}
                            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs bg-red-50 text-red-700 border border-red-200 rounded-md hover:bg-red-100 transition"
                        >
                            <StopCircle size={12} /> Cancel All
                        </button>
                    )}
                    {(errorCount > 0 || interruptedCount > 0) && !isActive && (
                        <button
                            type="button"
                            onClick={handleResumeAll}
                            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md hover:bg-indigo-100 transition"
                        >
                            <RefreshCcw size={12} /> Resume {errorCount + interruptedCount}
                        </button>
                    )}
                </div>
            </aside>
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
