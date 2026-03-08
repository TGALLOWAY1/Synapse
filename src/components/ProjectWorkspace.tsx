import { useParams, useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { ChevronLeft, RefreshCcw, LogOut, CheckCircle, Download, Settings, ChevronDown, ChevronRight, PanelRightOpen, PanelRightClose, MoreHorizontal } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { generateStructuredPRD, structuredPRDToMarkdown } from '../lib/llmProvider';
import { SelectableSpine } from './SelectableSpine';
import { BranchList } from './BranchList';
import { ConsolidationModal } from './ConsolidationModal';
import { SettingsModal } from './SettingsModal';
import { PipelineStageBar } from './PipelineStageBar';
import { StructuredPRDView } from './StructuredPRDView';
import { DevPlanView } from './DevPlanView';
import { AgentPromptView } from './AgentPromptView';
import type { Branch, PipelineStage } from '../types';

export function ProjectWorkspace() {
    const { projectId } = useParams<{ projectId: string }>();
    const navigate = useNavigate();
    const { getProject, getLatestSpine, regenerateSpine, updateSpineText, updateSpineStructuredPRD, getHistoryEvents, getBranchesForSpine, getSpineVersions, markSpineFinal, getLatestDevPlan, setProjectStage } = useProjectStore();
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [consolidatingBranch, setConsolidatingBranch] = useState<Branch | null>(null);
    const [viewedSpineId, setViewedSpineId] = useState<string | null>(null);
    const [isPromptCollapsed, setIsPromptCollapsed] = useState(false);
    const [isVersionsCollapsed, setIsVersionsCollapsed] = useState(false);
    const [isBranchesVisible, setIsBranchesVisible] = useState(true);
    const [showStructuredView, setShowStructuredView] = useState(true);
    const [showNavOverflow, setShowNavOverflow] = useState(false);
    const overflowRef = useRef<HTMLDivElement>(null);

    // Close overflow menu on outside click
    useEffect(() => {
        if (!showNavOverflow) return;
        const handleClick = (e: MouseEvent) => {
            if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
                setShowNavOverflow(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [showNavOverflow]);

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

    // Human-friendly version label
    const getVersionLabel = (spineId: string) => {
        const idx = allSpines.findIndex(s => s.id === spineId);
        return idx >= 0 ? `Version ${idx + 1}` : spineId;
    };

    if (!project) return <div>Project Not Found</div>;

    const handleAbandon = () => {
        if (window.confirm('Abandon this project and return to the home screen?')) {
            navigate('/');
        }
    };

    const handleRegenerate = async () => {
        if (!projectId || !latestSpine || isGenerating || hasBranches || isOldVersion) return;
        let activeNewSpineId: string | null = null;
        try {
            setIsGenerating(true);
            const { newSpineId } = regenerateSpine(projectId);
            activeNewSpineId = newSpineId;
            const structuredPRD = await generateStructuredPRD(latestSpine.promptText);
            const markdown = structuredPRDToMarkdown(structuredPRD);
            updateSpineStructuredPRD(projectId, newSpineId, structuredPRD, markdown);
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
        const versionLabel = getVersionLabel(activeSpine.id);
        const header = `# ${project.name} PRD
**Version:** ${versionLabel}
**Status:** ${status}
**Exported:** ${timestamp}

---

`;
        const markdownContent = header + activeSpine.responseText;
        const blob = new Blob([markdownContent], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${project.name.toLowerCase().replace(/\s+/g, '-')}-prd-${versionLabel.toLowerCase().replace(/\s+/g, '-')}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
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
                    <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap shrink-0 ${activeSpine?.isFinal ? 'bg-green-900/30 text-green-400 border border-green-800' : 'bg-neutral-800 text-neutral-400'}`}>
                        {activeSpine ? `${getVersionLabel(activeSpine.id)} ${activeSpine.isFinal ? '(FINAL)' : ''}` : 'Loading...'}
                    </span>
                </div>

                {/* Primary nav actions — always visible */}
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={handleExport}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded transition"
                        title="Export as Markdown"
                    >
                        <Download size={14} />
                        <span className="hidden sm:inline">Export</span>
                    </button>
                    {!isOldVersion && (
                        <button
                            onClick={handleToggleFinal}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded transition ${activeSpine?.isFinal ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'}`}
                            title={activeSpine?.isFinal ? "Unmark Final" : "Mark as Final"}
                        >
                            <CheckCircle size={14} />
                            <span className="hidden md:inline">{activeSpine?.isFinal ? 'Final' : 'Mark Final'}</span>
                        </button>
                    )}
                    <button
                        onClick={() => setIsSettingsOpen(true)}
                        className="p-2 text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-md transition"
                        title="API Settings"
                        aria-label="API Settings"
                    >
                        <Settings size={18} />
                    </button>

                    {/* Overflow menu for secondary actions */}
                    <div className="relative" ref={overflowRef}>
                        <button
                            onClick={() => setShowNavOverflow(!showNavOverflow)}
                            className="p-2 text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-md transition"
                            title="More actions"
                            aria-label="More actions"
                        >
                            <MoreHorizontal size={18} />
                        </button>
                        {showNavOverflow && (
                            <div className="absolute right-0 top-full mt-1 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl py-1 z-50 min-w-[180px]">
                                <button
                                    onClick={() => { handleRegenerate(); setShowNavOverflow(false); }}
                                    disabled={isGenerating || hasBranches || isOldVersion}
                                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-700 transition disabled:opacity-50 disabled:hover:bg-transparent"
                                >
                                    <RefreshCcw size={14} className={isGenerating ? 'animate-spin' : ''} />
                                    Regenerate
                                </button>
                                <button
                                    onClick={() => { setIsBranchesVisible(!isBranchesVisible); setShowNavOverflow(false); }}
                                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-700 transition"
                                >
                                    {isBranchesVisible ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
                                    {isBranchesVisible ? 'Hide Branches' : 'Show Branches'}
                                </button>
                                <div className="border-t border-neutral-700 my-1" />
                                <button
                                    onClick={() => { handleAbandon(); setShowNavOverflow(false); }}
                                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-neutral-700 transition"
                                >
                                    <LogOut size={14} />
                                    Abandon
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}

            {/* Pipeline Stage Bar — shrink-0, no absolute */}
            <div className="shrink-0 z-10">
                <PipelineStageBar
                    currentStage={pipelineStage}
                    onStageChange={setPipelineStage}
                    hasPRD={!!activeSpine?.isFinal}
                    hasDevPlan={!!getLatestDevPlan(projectId)}
                />
            </div>

            {/* Main Workspace Area — flex-1 fills remaining height */}
            <div className="flex-1 flex overflow-hidden">

                {/* Left: Main Content Column */}
                <div className="flex-1 min-w-0 bg-white text-black overflow-y-auto p-4 md:p-8 lg:p-12 shadow-2xl z-0 relative">
                    {isOldVersion && pipelineStage === 'prd' && (
                        <div className="sticky top-0 left-0 right-0 bg-yellow-100 border-b border-yellow-300 text-yellow-800 text-sm py-2 px-4 shadow-sm flex justify-between items-center z-10 -mx-4 md:-mx-8 lg:-mx-12 -mt-4 md:-mt-8 lg:-mt-12 mb-4">
                            <span>You are viewing a historical version (Read-Only).</span>
                            <button
                                onClick={() => setViewedSpineId(null)}
                                className="font-semibold underline hover:text-yellow-900 shrink-0 ml-4"
                            >
                                Return to Latest
                            </button>
                        </div>
                    )}

                    <div className="max-w-2xl mx-auto mt-4">
                        {/* PRD Stage */}
                        {pipelineStage === 'prd' && (
                            <>
                                {activeSpine ? (
                                    <>
                                        <div className="mb-8 bg-neutral-100 rounded-md border border-neutral-200 transition-all overflow-hidden flex flex-col">
                                            <div
                                                className="flex items-center justify-between cursor-pointer p-4 select-none hover:bg-neutral-200/50 transition"
                                                onClick={() => setIsPromptCollapsed(!isPromptCollapsed)}
                                            >
                                                <h3 className="text-sm font-semibold text-neutral-500 uppercase tracking-wider">Initial Prompt</h3>
                                                <button className="text-neutral-400 hover:text-neutral-600 transition">
                                                    {isPromptCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                                                </button>
                                            </div>
                                            {!isPromptCollapsed && (
                                                <div className="px-4 pb-4 border-t border-neutral-200/50 pt-2 bg-neutral-50/50">
                                                    <p className="whitespace-pre-wrap text-neutral-700 text-sm">{activeSpine.promptText}</p>
                                                </div>
                                            )}
                                        </div>

                                        {/* View toggle when structured PRD exists */}
                                        {activeSpine.structuredPRD && (
                                            <div className="flex items-center gap-2 mb-4">
                                                <button
                                                    onClick={() => setShowStructuredView(true)}
                                                    className={`px-3 py-1 text-sm rounded-md transition ${showStructuredView ? 'bg-blue-100 text-blue-700 font-medium' : 'text-neutral-500 hover:bg-neutral-100'}`}
                                                >
                                                    Structured View
                                                </button>
                                                <button
                                                    onClick={() => setShowStructuredView(false)}
                                                    className={`px-3 py-1 text-sm rounded-md transition ${!showStructuredView ? 'bg-blue-100 text-blue-700 font-medium' : 'text-neutral-500 hover:bg-neutral-100'}`}
                                                >
                                                    Markdown View
                                                </button>
                                            </div>
                                        )}

                                        {activeSpine.structuredPRD && showStructuredView ? (
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
                                    </>
                                ) : (
                                    <div className="animate-pulse flex flex-col gap-4">
                                        <div className="h-4 bg-neutral-200 rounded w-3/4"></div>
                                        <div className="h-4 bg-neutral-200 rounded w-full"></div>
                                        <div className="h-4 bg-neutral-200 rounded w-5/6"></div>
                                    </div>
                                )}
                            </>
                        )}

                        {/* Dev Plan Stage */}
                        {pipelineStage === 'devplan' && activeSpine?.structuredPRD && (
                            <DevPlanView
                                projectId={projectId}
                                structuredPRD={activeSpine.structuredPRD}
                                spineVersionId={activeSpine.id}
                                onStageChange={setPipelineStage}
                            />
                        )}

                        {/* Agent Prompts Stage */}
                        {pipelineStage === 'prompts' && (
                            <AgentPromptView
                                projectId={projectId}
                                projectName={project.name}
                            />
                        )}
                    </div>
                </div>

                {/* Right: Margin Branches — hidden on small screens, toggle-able */}
                {isBranchesVisible && (
                    <div className="hidden lg:flex w-80 xl:w-96 shrink-0 bg-neutral-50 text-black border-l border-neutral-200 overflow-y-auto p-4 flex-col gap-4">
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
                )}

                {/* Far Right: Sidebar (History) — hidden on small screens */}
                <div className={`hidden xl:flex ${isVersionsCollapsed ? 'w-14' : 'w-64'} shrink-0 bg-neutral-900 border-l border-neutral-800 flex-col text-neutral-300 transition-all duration-300`}>
                    <div
                        className={`p-4 border-b border-neutral-800 flex items-center cursor-pointer hover:bg-neutral-800 transition ${isVersionsCollapsed ? 'justify-center' : 'justify-between'}`}
                        onClick={() => setIsVersionsCollapsed(!isVersionsCollapsed)}
                        title={isVersionsCollapsed ? "Expand Versions" : "Collapse Versions"}
                    >
                        {!isVersionsCollapsed && <h3 className="font-semibold text-neutral-300 select-none">Versions</h3>}
                        <button className="text-neutral-400 hover:text-white transition">
                            {isVersionsCollapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
                        </button>
                    </div>
                    {!isVersionsCollapsed && (
                        <div className="p-4 flex-1 overflow-y-auto flex flex-col gap-4">
                            {historyEvents.slice().reverse().map(event => {
                                const isSelected = activeSpine?.id === event.spineVersionId;
                                const versionLabel = getVersionLabel(event.spineVersionId);
                                return (
                                    <button
                                        key={event.id}
                                        onClick={() => setViewedSpineId(event.spineVersionId)}
                                        className={`p-3 rounded-md border text-left transition ${isSelected ? 'bg-neutral-800 border-blue-500 ring-1 ring-blue-500' : 'bg-neutral-800/50 border-neutral-700 hover:bg-neutral-800'}`}
                                    >
                                        <div className="flex justify-between items-start mb-1">
                                            <span className={`text-sm font-medium ${isSelected ? 'text-blue-400' : 'text-neutral-400'}`}>{versionLabel}</span>
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
                    )}
                </div>

            </div>

            {consolidatingBranch && latestSpine && (
                <ConsolidationModal
                    projectId={projectId}
                    branch={consolidatingBranch}
                    spineText={latestSpine.responseText}
                    onClose={() => setConsolidatingBranch(null)}
                />
            )}
        </div>
    );
}
