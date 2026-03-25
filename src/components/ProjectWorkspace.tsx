import { useParams, useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { ChevronLeft, RefreshCcw, LogOut, CheckCircle, Download, Settings, ChevronDown, ChevronRight, PanelRightOpen, PanelRightClose, MoreHorizontal } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { generateStructuredPRD, structuredPRDToMarkdown } from '../lib/llmProvider';
import { SelectableSpine } from './SelectableSpine';
import { BranchList } from './BranchList';
import { ConsolidationModal } from './ConsolidationModal';
import { SettingsModal } from './SettingsModal';
import { PipelineStageBar } from './PipelineStageBar';
import { StructuredPRDView } from './StructuredPRDView';
import { MockupsView } from './MockupsView';
import { ArtifactsView } from './ArtifactsView';
import { MarkupImageView } from './MarkupImageView';
import { HistoryView } from './HistoryView';
import { ExportModal } from './ExportModal';
import { FeedbackItemsList } from './FeedbackItemsList';
import { BranchCanvas } from './BranchCanvas';
import type { Branch, PipelineStage, FeedbackItem } from '../types';

export function ProjectWorkspace() {
    const { projectId } = useParams<{ projectId: string }>();
    const navigate = useNavigate();
    const { getProject, getLatestSpine, regenerateSpine, updateSpineText, updateSpineStructuredPRD, getHistoryEvents, getBranchesForSpine, getSpineVersions, markSpineFinal, setProjectStage, createBranch: storCreateBranch, updateFeedbackStatus } = useProjectStore();
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [consolidatingBranch, setConsolidatingBranch] = useState<Branch | null>(null);
    const [viewedSpineId, setViewedSpineId] = useState<string | null>(null);
    const [isPromptCollapsed, setIsPromptCollapsed] = useState(true);
    const [isBranchesVisible, setIsBranchesVisible] = useState(true);
    const [activeRightTab, setActiveRightTab] = useState<'branches' | 'history'>('branches');
    const [activeCanvasBranchId, setActiveCanvasBranchId] = useState<string | null>(null);
    const [showStructuredView, setShowStructuredView] = useState(true);
    const [showNavOverflow, setShowNavOverflow] = useState(false);
    const overflowRef = useRef<HTMLDivElement>(null);
    const [animationParent] = useAutoAnimate();

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

    const handleApplyFeedback = (feedback: FeedbackItem) => {
        if (!projectId || !latestSpine) return;
        const intent = `[Feedback: ${feedback.title}] ${feedback.description}`;
        storCreateBranch(projectId, latestSpine.id, feedback.title, intent);
        updateFeedbackStatus(projectId, feedback.id, 'accepted');
        setActiveRightTab('branches');
        setIsBranchesVisible(true);
    };

    const handleToggleFinal = () => {
        if (!projectId || !activeSpine) return;
        markSpineFinal(projectId, activeSpine.id, !activeSpine.isFinal);
    };

    const [isExportOpen, setIsExportOpen] = useState(false);

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
                                    onClick={() => { setIsSettingsOpen(true); setShowNavOverflow(false); }}
                                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-neutral-300 hover:bg-white/5 transition border-b border-white/5"
                                >
                                    <Settings size={14} className="text-indigo-400" />
                                    Project Settings
                                </button>
                                <button
                                    onClick={() => { handleRegenerate(); setShowNavOverflow(false); }}
                                    disabled={isGenerating || hasBranches || isOldVersion}
                                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-neutral-300 hover:bg-white/5 transition disabled:opacity-30 disabled:hover:bg-transparent"
                                >
                                    <RefreshCcw size={14} className={`text-neutral-500 ${isGenerating ? 'animate-spin' : ''}`} />
                                    Regenerate Draft
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
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
            {isExportOpen && projectId && <ExportModal projectId={projectId} onClose={() => setIsExportOpen(false)} />}

            {/* Pipeline Stage Bar — shrink-0, no absolute */}
            <div className="shrink-0 z-10">
                <PipelineStageBar
                    currentStage={pipelineStage}
                    onStageChange={setPipelineStage}
                    hasPRD={!!activeSpine?.isFinal}
                />
            </div>

            {/* Main Workspace Area — flex-1 fills remaining height */}
            <div className="flex-1 flex overflow-hidden">

                {/* Left: Main Content Column */}
                <div className="flex-1 min-w-0 bg-neutral-50 text-black overflow-y-auto p-4 md:p-8 lg:p-12 shadow-inner z-0 relative">
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
                                {/* Feedback items from mockups/artifacts */}
                                <FeedbackItemsList
                                    projectId={projectId}
                                    onApplyToPRD={handleApplyFeedback}
                                />

                                {activeSpine ? (
                                    <div className="bg-white rounded-2xl shadow-sm border border-neutral-200/80 p-6 md:p-10 mb-8">
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

                                        {/* View toggle when structured PRD exists */}
                                        {activeSpine.structuredPRD && (
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
                                    </div>
                                ) : (
                                    <div className="bg-white rounded-2xl shadow-sm border border-neutral-200/80 p-6 md:p-10 mb-8 animate-pulse">
                                        <div className="h-8 bg-neutral-200 rounded w-1/3 mb-10"></div>
                                        <div className="space-y-6">
                                            <div>
                                                <div className="h-6 bg-neutral-200 rounded w-1/4 mb-4"></div>
                                                <div className="space-y-3">
                                                    <div className="h-4 bg-neutral-100 rounded w-full"></div>
                                                    <div className="h-4 bg-neutral-100 rounded w-11/12"></div>
                                                    <div className="h-4 bg-neutral-100 rounded w-5/6"></div>
                                                </div>
                                            </div>
                                            <div className="pt-6">
                                                <div className="h-6 bg-neutral-200 rounded w-1/5 mb-4"></div>
                                                <div className="space-y-3">
                                                    <div className="h-4 bg-neutral-100 rounded w-full"></div>
                                                    <div className="h-4 bg-neutral-100 rounded w-4/5"></div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}

                        {/* Mockups Stage */}
                        {pipelineStage === 'mockups' && activeSpine && (
                            <MockupsView
                                projectId={projectId}
                                spineVersionId={activeSpine.id}
                                prdContent={activeSpine.responseText}
                                structuredPRD={activeSpine.structuredPRD}
                            />
                        )}

                        {/* Artifacts Stage */}
                        {pipelineStage === 'artifacts' && activeSpine && (
                            <div className="space-y-8">
                                <ArtifactsView
                                    projectId={projectId}
                                    spineVersionId={activeSpine.id}
                                    prdContent={activeSpine.responseText}
                                    structuredPRD={activeSpine.structuredPRD}
                                />
                                <MarkupImageView
                                    projectId={projectId}
                                    spineVersionId={activeSpine.id}
                                    prdContent={activeSpine.responseText}
                                    structuredPRD={activeSpine.structuredPRD}
                                />
                            </div>
                        )}

                        {/* History Stage */}
                        {pipelineStage === 'history' && (
                            <HistoryView projectId={projectId} />
                        )}
                    </div>
                </div>

                {/* Right Column: Combined Branches and History */}
                {isBranchesVisible && (
                    <div className="hidden lg:flex w-80 xl:w-96 shrink-0 bg-neutral-50 border-l border-neutral-200 flex-col shadow-sm z-10">
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
                                    <div className="text-sm text-neutral-500 italic p-4 text-center border border-dashed border-neutral-300 rounded-lg bg-white shadow-sm mt-4">
                                        Loading...
                                    </div>
                                )
                            ) : (
                                <div ref={animationParent} className="flex flex-col gap-3">
                                    <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-1">Timeline</h4>
                                    {historyEvents.slice().reverse().map(event => {
                                        const isSelected = activeSpine?.id === event.spineVersionId;
                                        const versionLabel = event.spineVersionId ? getVersionLabel(event.spineVersionId) : 'N/A';
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
