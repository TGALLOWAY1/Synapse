import { useParams, useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { ChevronLeft, RefreshCcw, LogOut, CheckCircle, Download, Settings } from 'lucide-react';
import { useState } from 'react';
import { generatePRD } from '../lib/llmProvider';
import { SelectableSpine } from './SelectableSpine';
import { BranchList } from './BranchList';
import { ConsolidationModal } from './ConsolidationModal';
import { SettingsModal } from './SettingsModal';
import type { Branch } from '../types';

export function ProjectWorkspace() {
    const { projectId } = useParams<{ projectId: string }>();
    const navigate = useNavigate();
    const { getProject, getLatestSpine, regenerateSpine, updateSpineText, getHistoryEvents, getBranchesForSpine, getSpineVersions, markSpineFinal } = useProjectStore();
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [consolidatingBranch, setConsolidatingBranch] = useState<Branch | null>(null);
    const [viewedSpineId, setViewedSpineId] = useState<string | null>(null);

    if (!projectId) return <div>Invalid Project</div>;

    const project = getProject(projectId);
    const latestSpine = getLatestSpine(projectId);
    const historyEvents = getHistoryEvents(projectId);
    const allSpines = getSpineVersions(projectId);

    const activeSpine = viewedSpineId ? allSpines.find(s => s.id === viewedSpineId) || latestSpine : latestSpine;
    const isOldVersion = activeSpine?.id !== latestSpine?.id;

    const branches = activeSpine ? getBranchesForSpine(projectId, activeSpine.id) : [];
    const hasBranches = branches.length > 0;

    if (!project) return <div>Project Not Found</div>;


    const handleAbandon = () => {
        navigate('/');
    };

    const handleRegenerate = async () => {
        if (!projectId || !latestSpine || isGenerating || hasBranches || isOldVersion) return;
        let activeNewSpineId: string | null = null;
        try {
            setIsGenerating(true);
            const { newSpineId } = regenerateSpine(projectId);
            activeNewSpineId = newSpineId;
            const newText = await generatePRD(latestSpine.promptText);
            updateSpineText(projectId, newSpineId, newText);
        } catch (e) {
            console.error(e);
            if (activeNewSpineId) {
                const errorMsg = e instanceof Error ? e.message : String(e);
                updateSpineText(
                    projectId,
                    activeNewSpineId,
                    `**Error regenerating PRD:**\n${errorMsg}\n\nPlease verify your API Key in Settings or check your network connection.`
                );
            }
        } finally {
            setIsGenerating(false);
        }
    };

    const handleToggleFinal = () => {
        if (!projectId || !activeSpine) return;
        markSpineFinal(projectId, activeSpine.id, !activeSpine.isFinal);
    };

    const handleExport = () => {
        if (!project || !activeSpine) return;

        const timestamp = new Date().toISOString().split('T')[0];
        const status = activeSpine.isFinal ? 'FINAL' : 'DRAFT';
        const header = `# ${project.name} PRD
**Version:** ${activeSpine.id}
**Status:** ${status}
**Exported:** ${timestamp}

---

`;
        const markdownContent = header + activeSpine.responseText;
        const blob = new Blob([markdownContent], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${project.name.toLowerCase().replace(/\s+/g, '-')}-prd-${activeSpine.id}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="flex h-screen bg-neutral-900 border-t border-neutral-800 text-neutral-100">

            {/* Top Navigation Bar */}
            <div className="absolute top-0 left-0 right-0 h-14 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between px-4 z-10 w-full">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => navigate('/')}
                        className="p-1 hover:bg-neutral-800 rounded-md transition text-neutral-400"
                    >
                        <ChevronLeft size={20} />
                    </button>
                    <span className="font-semibold">{project.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${activeSpine?.isFinal ? 'bg-green-900/30 text-green-400 border border-green-800' : 'bg-neutral-800 text-neutral-400'}`}>
                        {activeSpine ? `Spine ${activeSpine.id} ${activeSpine.isFinal ? '(FINAL)' : ''}` : 'Loading...'}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleExport}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded transition"
                        title="Export as Markdown"
                    >
                        <Download size={14} />
                        Export
                    </button>
                    {!isOldVersion && (
                        <button
                            onClick={handleToggleFinal}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded transition ${activeSpine?.isFinal ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'}`}
                            title={activeSpine?.isFinal ? "Unmark Final" : "Mark as Final"}
                        >
                            <CheckCircle size={14} />
                            {activeSpine?.isFinal ? 'Final' : 'Mark Final'}
                        </button>
                    )}
                    <button
                        onClick={() => setIsSettingsOpen(true)}
                        className="p-2 text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-md transition"
                        title="API Settings"
                    >
                        <Settings size={18} />
                    </button>
                    <button
                        onClick={handleRegenerate}
                        disabled={isGenerating || hasBranches || isOldVersion}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded transition disabled:opacity-50"
                        title={hasBranches ? "Cannot regenerate spine with active branches" : "Retry / Regenerate (Latest un-branched only)"}
                    >
                        <RefreshCcw size={14} className={isGenerating ? 'animate-spin' : ''} />
                        Regenerate
                    </button>
                    <button
                        onClick={handleAbandon}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800/50 rounded transition"
                        title="Abandon Session"
                    >
                        <LogOut size={14} />
                        Abandon
                    </button>
                </div>
            </div>

            {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}

            {/* Main Workspace Area (below navbar) */}
            <div className="flex-1 flex mt-14 overflow-hidden w-full">

                {/* Left: Spine Column */}
                <div className="flex-1 bg-white text-black overflow-y-auto p-12 shadow-2xl z-0 relative">
                    {isOldVersion && (
                        <div className="absolute top-0 left-0 right-0 bg-yellow-100 border-b border-yellow-300 text-yellow-800 text-sm py-2 px-4 shadow-sm flex justify-between items-center z-10">
                            <span>You are viewing a historical spine version (Read-Only). Branches cannot be added here.</span>
                            <button
                                onClick={() => setViewedSpineId(null)}
                                className="font-semibold underline hover:text-yellow-900"
                            >
                                Return to Latest
                            </button>
                        </div>
                    )}

                    <div className="max-w-2xl mx-auto mt-4">
                        {activeSpine ? (
                            <>
                                <div className="mb-8 p-4 bg-neutral-100 rounded-md border border-neutral-200">
                                    <h3 className="text-sm font-semibold text-neutral-500 mb-2 uppercase tracking-wider">Initial Prompt</h3>
                                    <p className="whitespace-pre-wrap text-neutral-700">{activeSpine.promptText}</p>
                                </div>

                                <div className="prose prose-neutral max-w-none">
                                    <SelectableSpine
                                        projectId={projectId}
                                        spineVersionId={activeSpine.id}
                                        text={activeSpine.responseText}
                                        readOnly={isOldVersion}
                                    />
                                </div>
                            </>
                        ) : (
                            <div className="animate-pulse flex flex-col gap-4">
                                <div className="h-4 bg-neutral-200 rounded w-3/4"></div>
                                <div className="h-4 bg-neutral-200 rounded w-full"></div>
                                <div className="h-4 bg-neutral-200 rounded w-5/6"></div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right: Margin Branches */}
                <div className="w-96 bg-neutral-50 text-black border-l border-neutral-200 overflow-y-auto p-4 flex flex-col gap-4">
                    <h3 className="font-semibold text-neutral-400 uppercase tracking-wider text-xs mb-2">Branches</h3>

                    {latestSpine ? (
                        <BranchList
                            projectId={projectId}
                            spineVersionId={latestSpine.id}
                            onConsolidate={(branch) => setConsolidatingBranch(branch)}
                        />
                    ) : (
                        <div className="text-sm text-neutral-500 italic p-4 text-center border border-dashed border-neutral-300 rounded-md">
                            Loading...
                        </div>
                    )}
                </div>

                {/* Far Right: Sidebar (History) */}
                <div className="w-64 bg-neutral-900 border-l border-neutral-800 flex flex-col relative top-0 right-0 h-full text-neutral-300">
                    <div className="p-4 border-b border-neutral-800 flex justify-between items-center">
                        <h3 className="font-semibold text-neutral-300">Versions</h3>
                    </div>
                    <div className="p-4 flex-1 overflow-y-auto flex flex-col gap-4">
                        {historyEvents.slice().reverse().map(event => {
                            const isSelected = activeSpine?.id === event.spineVersionId;
                            return (
                                <button
                                    key={event.id}
                                    onClick={() => setViewedSpineId(event.spineVersionId)}
                                    className={`p-3 rounded-md border text-left transition ${isSelected ? 'bg-neutral-800 border-blue-500 ring-1 ring-blue-500' : 'bg-neutral-800/50 border-neutral-700 hover:bg-neutral-800'}`}
                                >
                                    <div className="flex justify-between items-start mb-1">
                                        <span className={`text-sm font-medium ${isSelected ? 'text-blue-400' : 'text-neutral-400'}`}>Spine {event.spineVersionId}</span>
                                        <span className="text-xs text-neutral-500">{new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                    <p className={`text-sm ${isSelected ? 'text-neutral-200' : 'text-neutral-400'}`}>{event.description}</p>

                                    {event.diff && event.diff.matches && isSelected && (
                                        <div className="mt-3 pt-3 border-t border-neutral-700">
                                            <p className="text-xs text-neutral-500 mb-1 tracking-wide uppercase">Diff Preview</p>
                                            <div className="bg-neutral-900 rounded p-2 overflow-hidden">
                                                <p className="text-xs text-red-400 line-through truncate opacity-80">- {event.diff.matches[0].before}</p>
                                                <p className="text-xs text-green-400 truncate mt-1">+ {event.diff.matches[0].after}</p>
                                            </div>
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>

            </div>

            {consolidatingBranch && latestSpine && (
                <ConsolidationModal
                    projectId={projectId}
                    spineVersionId={latestSpine.id}
                    branch={consolidatingBranch}
                    spineText={latestSpine.responseText}
                    onClose={() => setConsolidatingBranch(null)}
                />
            )}
        </div>
    );
}

