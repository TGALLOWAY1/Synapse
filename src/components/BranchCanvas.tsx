import { useParams, useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { ChevronLeft, Maximize2, Check, ArrowRight } from 'lucide-react';
import { useState } from 'react';

export function BranchCanvas() {
    const { projectId, branchId } = useParams<{ projectId: string, branchId: string }>();
    const navigate = useNavigate();
    const { getProject, getLatestSpine, branches, mergeBranch } = useProjectStore();

    const [isGenerating, setIsGenerating] = useState(false);
    const [drafts, setDrafts] = useState<{ id: string, title: string, content: string }[]>([]);
    const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
    const [leftWidth, setLeftWidth] = useState(320);

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.pageX;
        const startWidth = leftWidth;

        const handleMouseMove = (mouseEvent: MouseEvent) => {
            // Constrain width between 200px and 800px
            const newWidth = Math.max(200, Math.min(800, startWidth + mouseEvent.pageX - startX));
            setLeftWidth(newWidth);
        };

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    const project = projectId ? getProject(projectId) : undefined;
    const projectBranches = projectId ? branches[projectId] || [] : [];
    const branch = projectBranches.find(b => b.id === branchId);
    const latestSpine = projectId ? getLatestSpine(projectId) : undefined;

    if (!project || !branch || !latestSpine) {
        return <div className="p-8 text-neutral-400">Branch or Project not found.</div>;
    }

    const handleGenerateDrafts = async () => {
        setIsGenerating(true);
        // Mock generation of two approaches
        await new Promise(r => setTimeout(r, 1500));
        setDrafts([
            { id: 'draft-1', title: 'Approach A: Conservative', content: `[Locally Restructured]: ${branch.anchorText}\nMaintains original tone, just clarifies the points raised in the branch.` },
            { id: 'draft-2', title: 'Approach B: Aggressive Rewrite', content: `[Doc-Wide Rewrite]: Integrates the branch intent globally, shifting the entire section to accommodate the new perspective.` }
        ]);
        setIsGenerating(false);
    };

    const handleApply = () => {
        if (!selectedDraftId || !projectId) return;
        const draft = drafts.find(d => d.id === selectedDraftId);
        if (!draft) return;

        // Apply to spine
        const newText = latestSpine.responseText.replace(branch.anchorText, draft.content);
        mergeBranch(projectId, branch.id, newText);

        // Return to workspace
        navigate(`/p/${projectId}`);
    };

    return (
        <div className="flex flex-col h-screen bg-neutral-900 border-t border-neutral-800 text-neutral-100">
            {/* Top Bar */}
            <div className="h-14 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between px-4 z-10 shrink-0">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => navigate(`/p/${projectId}`)}
                        className="p-1 hover:bg-neutral-800 rounded-md transition text-neutral-400 flex items-center gap-1 text-sm font-medium pr-3"
                    >
                        <ChevronLeft size={20} /> Back to Spine
                    </button>
                    <span className="text-neutral-600">|</span>
                    <span className="font-semibold text-blue-400">Exploration Canvas</span>
                    <span className="text-sm text-neutral-400 italic hidden sm:inline-block">"{branch.anchorText.substring(0, 40)}..."</span>
                </div>
                <div className="flex items-center gap-3">
                    {drafts.length > 0 && (
                        <button
                            onClick={handleApply}
                            disabled={!selectedDraftId}
                            className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-md text-sm font-medium transition flex items-center gap-2"
                        >
                            Apply to Spine <Check size={16} />
                        </button>
                    )}
                </div>
            </div>

            {/* Content area */}
            <div className="flex flex-1 overflow-hidden">

                {/* Left: Branch Context */}
                <div
                    className="bg-neutral-800/30 border-r border-neutral-800 flex flex-col pt-6 pb-6 overflow-y-auto relative shrink-0"
                    style={{ width: leftWidth }}
                >
                    {/* Drag Handle */}
                    <div
                        className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-blue-500/50 transition-colors z-20"
                        onMouseDown={handleMouseDown}
                    />
                    <div className="px-6 mb-4">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-2">Branch Context</h3>
                        <div className="bg-neutral-800 p-3 rounded-md text-sm text-neutral-300 italic border border-neutral-700">
                            "{branch.anchorText}"
                        </div>
                    </div>

                    <div className="flex-1 px-4 flex flex-col gap-3">
                        {branch.messages.map(msg => (
                            <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                <div className={`max-w-[90%] rounded-lg p-3 text-sm ${msg.role === 'user' ? 'bg-blue-600/20 text-blue-100 border border-blue-500/30' : 'bg-neutral-800 text-neutral-300 border border-neutral-700'}`}>
                                    <p className="whitespace-pre-wrap">{msg.content}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right: Canvas Area */}
                <div className="flex-1 bg-neutral-900 overflow-y-auto p-12 relative flex items-center justify-center dashboard-grid">
                    {/* Dashboard grid background class (assume tailwind or simple inline defined later, using rough inline bg for now) */}
                    <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '24px 24px' }}></div>

                    <div className="relative z-10 w-full max-w-4xl flex flex-col items-center">
                        {drafts.length === 0 ? (
                            <div className="text-center">
                                <Maximize2 size={48} className="mx-auto text-neutral-600 mb-6" />
                                <h2 className="text-2xl font-light text-neutral-200 mb-4">Explore Design Spaces</h2>
                                <p className="text-neutral-400 max-w-md mx-auto mb-8">
                                    Synthesize the thread's context into actionable drafts. Choose an approach to apply as a decision artifact.
                                </p>
                                <button
                                    onClick={handleGenerateDrafts}
                                    disabled={isGenerating}
                                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-medium transition flex items-center gap-2 mx-auto"
                                >
                                    {isGenerating ? 'Synthesizing...' : 'Generate Approaches'}
                                    {!isGenerating && <ArrowRight size={18} />}
                                </button>
                            </div>
                        ) : (
                            <div className="w-full">
                                <h3 className="text-lg font-medium text-neutral-200 mb-6 text-center">Select an Approach Artifact</h3>
                                <div className="grid grid-cols-2 gap-6 w-full">
                                    {drafts.map(draft => (
                                        <button
                                            key={draft.id}
                                            onClick={() => setSelectedDraftId(draft.id)}
                                            className={`text-left p-6 rounded-xl border-2 transition-all flex flex-col h-64 ${selectedDraftId === draft.id ? 'bg-blue-900/20 border-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.15)]' : 'bg-neutral-800 border-neutral-700 hover:border-neutral-500'}`}
                                        >
                                            <h4 className={`font-semibold mb-3 ${selectedDraftId === draft.id ? 'text-blue-400' : 'text-neutral-200'}`}>{draft.title}</h4>
                                            <div className="flex-1 bg-neutral-900/50 rounded p-4 border border-black/20 overflow-y-auto font-mono text-sm text-neutral-400 whitespace-pre-wrap">
                                                {draft.content}
                                            </div>

                                            {selectedDraftId === draft.id && (
                                                <div className="mt-4 flex items-center justify-center gap-2 text-blue-400 font-medium text-sm">
                                                    <Check size={16} /> Selected
                                                </div>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                </div>
            </div>
        </div>
    );
}
