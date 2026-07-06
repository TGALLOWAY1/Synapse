import { useEffect, useState } from 'react';
import { Download, X, FileText, Package, Copy, Check, Bot } from 'lucide-react';
import { useProjectStore } from '../store/projectStore';
import { useProjectSyncStore } from '../store/projectSyncStore';
import { useToastStore } from '../store/toastStore';
import { downloadProjectRecoveryBundle } from '../lib/projectRecovery';
import { AlertTriangle } from 'lucide-react';
import { parseScreenInventory, screenInventoryToMarkdown } from '../lib/screenInventoryNormalize';
import { downloadFile } from '../lib/utils/downloadFile';
import { copyToClipboard } from '../lib/utils/copyToClipboard';
import { buildAgentHandoff } from '../lib/exportHandoff';
import {
    CORE_ARTIFACT_DISPLAY_ORDER,
    getArtifactMeta,
    isHiddenArtifactSubtype,
} from '../lib/coreArtifactPipeline';
import type { Artifact } from '../types';

// Screen inventory is now persisted as JSON. For human-readable exports,
// re-render it through the markdown converter; legacy markdown content
// is returned as-is.
function exportContentFor(artifact: Artifact, raw: string): string {
    if (artifact.subtype === 'screen_inventory') {
        const parsed = parseScreenInventory(raw);
        if (parsed) return screenInventoryToMarkdown(parsed);
    }
    return raw;
}

interface ExportModalProps {
    projectId: string;
    onClose: () => void;
}

export function ExportModal({ projectId, onClose }: ExportModalProps) {
    const { getProject, getLatestSpine, getArtifacts, getArtifactVersions } = useProjectStore();
    const { addToast } = useToastStore();
    const syncInfo = useProjectSyncStore((s) => s.projects[projectId]);
    const [exporting, setExporting] = useState(false);
    // Which card most recently showed a "Copied" confirmation.
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [recoverySaved, setRecoverySaved] = useState(false);
    // Surface a durability warning right where the user is about to rely on the
    // export: their latest changes may not have reached the cloud.
    const cloudAtRisk = syncInfo?.state === 'error' || syncInfo?.state === 'conflict';

    const flashCopied = (key: string) => {
        setCopiedKey(key);
        window.setTimeout(() => setCopiedKey(prev => (prev === key ? null : prev)), 1500);
    };

    const copyText = async (key: string, text: string, label: string) => {
        if (!text.trim()) return;
        const ok = await copyToClipboard(text);
        if (ok) {
            flashCopied(key);
        } else {
            addToast({ type: 'error', title: 'Copy failed', message: `Could not copy ${label} to the clipboard.` });
        }
    };

    // Allow dismissing the modal with the Escape key.
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const project = getProject(projectId);
    const latestSpine = getLatestSpine(projectId);
    const coreArtifacts = getArtifacts(projectId, 'core_artifact');
    const mockupArtifacts = getArtifacts(projectId, 'mockup');

    // Mirror the Assets tab: label each artifact with the same title shown in the
    // workspace (the meta title keyed by subtype), not the persisted
    // generation-time `artifact.title`, which can drift (e.g. "Prompt Pack" vs
    // "Developer Prompts"). Fall back to the stored title for any non-core row.
    const displayTitle = (artifact: Artifact): string =>
        artifact.subtype ? getArtifactMeta(artifact.subtype).title : artifact.title;

    // Order artifacts the way the Assets tab does (CORE_ARTIFACT_DISPLAY_ORDER)
    // and drop hidden subtypes (e.g. UI Components) so the export list matches
    // exactly what the user sees in the workspace.
    const orderedCoreArtifacts: Artifact[] = CORE_ARTIFACT_DISPLAY_ORDER
        .filter(meta => !isHiddenArtifactSubtype(meta.subtype))
        .map(meta => coreArtifacts.find(a => a.subtype === meta.subtype))
        .filter((a): a is Artifact => Boolean(a));

    const exportPRD = () => {
        if (!latestSpine) return;
        downloadFile(latestSpine.responseText, `${project?.name || 'project'}-prd.md`);
    };

    const exportArtifact = (artifact: Artifact) => {
        const versions = getArtifactVersions(projectId, artifact.id);
        const preferred = versions.find(v => v.isPreferred);
        if (!preferred) return;
        downloadFile(
            exportContentFor(artifact, preferred.content),
            `${displayTitle(artifact).replace(/\s+/g, '-').toLowerCase()}.md`,
        );
    };

    const exportStructuredJSON = () => {
        if (!latestSpine?.structuredPRD) return;
        const data = {
            project: project,
            structuredPRD: latestSpine.structuredPRD,
            artifacts: orderedCoreArtifacts.map(a => {
                const versions = getArtifactVersions(projectId, a.id);
                const preferred = versions.find(v => v.isPreferred);
                return {
                    id: a.id,
                    type: a.type,
                    subtype: a.subtype,
                    title: displayTitle(a),
                    content: preferred?.content || '',
                    versionNumber: preferred?.versionNumber,
                };
            }),
        };
        downloadFile(JSON.stringify(data, null, 2), `${project?.name || 'project'}-export.json`, 'application/json');
    };

    // Preferred-version content for an artifact, run through the screen-inventory
    // markdown converter where needed.
    const artifactContent = (artifact: Artifact): string => {
        const versions = getArtifactVersions(projectId, artifact.id);
        const preferred = versions.find(v => v.isPreferred);
        return preferred ? exportContentFor(artifact, preferred.content) : '';
    };

    const buildFullBundle = (): string => {
        const sections: string[] = [];
        if (latestSpine) {
            sections.push('# Product Requirements Document\n', latestSpine.responseText, '\n---\n');
        }
        for (const artifact of orderedCoreArtifacts) {
            const content = artifactContent(artifact);
            if (content) sections.push(`# ${displayTitle(artifact)}\n`, content, '\n---\n');
        }
        for (const mockup of mockupArtifacts) {
            const versions = getArtifactVersions(projectId, mockup.id);
            const preferred = versions.find(v => v.isPreferred);
            if (preferred) sections.push(`# ${mockup.title}\n`, preferred.content, '\n---\n');
        }
        return sections.join('\n');
    };

    // Agent handoff: instruction preamble + PRD + build-relevant core artifacts
    // (mockups excluded — image-heavy and not useful to a coding agent).
    const buildHandoff = (): string =>
        buildAgentHandoff({
            projectName: project?.name || 'This product',
            prdMarkdown: latestSpine?.responseText,
            artifacts: orderedCoreArtifacts.map(a => ({
                subtype: a.subtype ?? '',
                title: displayTitle(a),
                content: artifactContent(a),
            })),
        });

    const exportFullBundle = async () => {
        setExporting(true);
        try {
            downloadFile(buildFullBundle(), `${project?.name || 'project'}-full-bundle.md`);
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div
                className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between p-4 border-b border-neutral-200 shrink-0">
                    <h3 className="font-bold text-neutral-900">Export Project</h3>
                    <button onClick={onClose} className="p-2 hover:bg-neutral-100 rounded transition">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-4 space-y-3 overflow-y-auto min-h-0">
                    {cloudAtRisk && (
                        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
                            <div className="flex items-start gap-2">
                                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium">
                                        {syncInfo?.state === 'conflict'
                                            ? 'This project has an unresolved cloud conflict'
                                            : 'Recent changes may not have reached the cloud'}
                                    </p>
                                    <p className="mt-0.5 text-xs text-amber-800">
                                        Your work is safe on this device. Download a recovery bundle so
                                        you have a complete copy regardless of cloud sync.
                                    </p>
                                    <button
                                        onClick={() => {
                                            const ok = downloadProjectRecoveryBundle(projectId, 'export-cloud-at-risk');
                                            setRecoverySaved(ok);
                                        }}
                                        className="mt-2 inline-flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700"
                                    >
                                        {recoverySaved ? <Check size={12} /> : <Download size={12} />}
                                        {recoverySaved ? 'Recovery bundle saved' : 'Download recovery bundle'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* --- EXPORT: whole-project bundles --- */}
                    <span className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Export</span>

                    {/* Agent handoff — the build-companion preset */}
                    <div className="flex items-stretch gap-2">
                        <button
                            onClick={() => copyText('handoff', buildHandoff(), 'the agent handoff')}
                            disabled={!latestSpine}
                            className="flex-1 flex items-center gap-3 p-3 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-lg transition text-left disabled:opacity-50"
                        >
                            <Bot size={18} className="text-violet-600 shrink-0" />
                            <div className="min-w-0">
                                <div className="text-sm font-medium text-violet-900">Copy for coding agent</div>
                                <div className="text-xs text-violet-700">PRD + plan + prompts, ready to paste into Claude Code / Cursor</div>
                            </div>
                            {copiedKey === 'handoff'
                                ? <Check size={16} className="text-violet-600 shrink-0 ml-auto" />
                                : <Copy size={16} className="text-violet-400 shrink-0 ml-auto" />}
                        </button>
                        <button
                            onClick={() => downloadFile(buildHandoff(), `${project?.name || 'project'}-handoff.md`)}
                            disabled={!latestSpine}
                            aria-label="Download agent handoff as Markdown"
                            title="Download as Markdown"
                            className="shrink-0 flex items-center justify-center px-3 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-lg transition disabled:opacity-50"
                        >
                            <Download size={16} className="text-violet-600" />
                        </button>
                    </div>

                    {/* Full Bundle */}
                    <div className="flex items-stretch gap-2">
                        <button
                            onClick={exportFullBundle}
                            disabled={exporting}
                            className="flex-1 flex items-center gap-3 p-3 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition text-left disabled:opacity-50"
                        >
                            <Package size={18} className="text-indigo-600 shrink-0" />
                            <div>
                                <div className="text-sm font-medium text-indigo-800">
                                    {exporting ? 'Exporting...' : 'Export Full Bundle'}
                                </div>
                                <div className="text-xs text-indigo-600">PRD + all artifacts + mockups as single Markdown</div>
                            </div>
                        </button>
                        <button
                            onClick={() => copyText('bundle', buildFullBundle(), 'the full bundle')}
                            disabled={!latestSpine}
                            aria-label="Copy full bundle to clipboard"
                            title="Copy to clipboard"
                            className="shrink-0 flex items-center justify-center px-3 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition disabled:opacity-50"
                        >
                            {copiedKey === 'bundle'
                                ? <Check size={16} className="text-green-600" />
                                : <Copy size={16} className="text-indigo-500" />}
                        </button>
                    </div>

                    {/* Structured JSON */}
                    <button
                        onClick={exportStructuredJSON}
                        disabled={!latestSpine?.structuredPRD}
                        className="w-full flex items-center gap-3 p-3 bg-neutral-50 hover:bg-neutral-100 rounded-lg transition text-left disabled:opacity-50"
                    >
                        <Download size={18} className="text-neutral-500 shrink-0" />
                        <div>
                            <div className="text-sm font-medium text-neutral-800">Export Structured JSON</div>
                            <div className="text-xs text-neutral-500">PRD + artifacts as structured data</div>
                        </div>
                    </button>

                    {/* --- DOWNLOAD: individual documents --- */}
                    <div className="pt-1">
                        <span className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Download</span>
                    </div>

                    {/* PRD */}
                    <div className="flex items-stretch gap-2">
                        <button
                            onClick={exportPRD}
                            disabled={!latestSpine}
                            className="flex-1 flex items-center gap-3 p-3 bg-neutral-50 hover:bg-neutral-100 rounded-lg transition text-left disabled:opacity-50"
                        >
                            <FileText size={18} className="text-indigo-500 shrink-0" />
                            <div>
                                <div className="text-sm font-medium text-neutral-800">PRD</div>
                                <div className="text-xs text-neutral-500">Download PRD as Markdown</div>
                            </div>
                        </button>
                        <button
                            onClick={() => copyText('prd', latestSpine?.responseText ?? '', 'the PRD')}
                            disabled={!latestSpine}
                            aria-label="Copy PRD to clipboard"
                            title="Copy to clipboard"
                            className="shrink-0 flex items-center justify-center px-3 bg-neutral-50 hover:bg-neutral-100 rounded-lg transition disabled:opacity-50"
                        >
                            {copiedKey === 'prd'
                                ? <Check size={16} className="text-green-600" />
                                : <Copy size={16} className="text-neutral-400" />}
                        </button>
                    </div>

                    {/* Individual Artifacts — same names and order as the Assets tab */}
                    {orderedCoreArtifacts.length > 0 && (
                        <div className="space-y-1">
                            {orderedCoreArtifacts.map(a => (
                                <button
                                    key={a.id}
                                    onClick={() => exportArtifact(a)}
                                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-neutral-50 rounded-md transition text-left text-sm text-neutral-700"
                                >
                                    <Download size={14} className="text-neutral-400 shrink-0" />
                                    {displayTitle(a)}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
