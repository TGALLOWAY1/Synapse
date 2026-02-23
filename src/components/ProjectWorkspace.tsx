import { useParams, useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { ChevronLeft } from 'lucide-react';

export function ProjectWorkspace() {
    const { projectId } = useParams<{ projectId: string }>();
    const navigate = useNavigate();
    const { getProject, getLatestSpine } = useProjectStore();

    if (!projectId) return <div>Invalid Project</div>;

    const project = getProject(projectId);
    const latestSpine = getLatestSpine(projectId);

    if (!project) return <div>Project Not Found</div>;

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
                    <span className="text-xs px-2 py-0.5 bg-neutral-800 text-neutral-400 rounded">
                        {latestSpine ? `Spine ${latestSpine.id}` : 'Loading...'}
                    </span>
                </div>
            </div>

            {/* Main Workspace Area (below navbar) */}
            <div className="flex-1 flex mt-14 overflow-hidden w-full">

                {/* Left: Spine Column */}
                <div className="flex-1 bg-white text-black overflow-y-auto p-12 shadow-2xl z-0">
                    <div className="max-w-2xl mx-auto">
                        {latestSpine ? (
                            <>
                                <div className="mb-8 p-4 bg-neutral-100 rounded-md border border-neutral-200">
                                    <h3 className="text-sm font-semibold text-neutral-500 mb-2 uppercase tracking-wider">Initial Prompt</h3>
                                    <p className="whitespace-pre-wrap text-neutral-700">{latestSpine.promptText}</p>
                                </div>

                                <div className="prose prose-neutral max-w-none">
                                    {latestSpine.responseText.split('\n').map((para: string, i: number) => (
                                        <p key={i} className="mb-4">{para}</p>
                                    ))}
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

                    <div className="text-sm text-neutral-500 italic p-4 text-center border border-dashed border-neutral-300 rounded-md">
                        Highlight text in the spine to create a branch.
                    </div>
                </div>

                {/* Far Right: Sidebar (History) */}
                <div className="w-64 bg-neutral-900 border-l border-neutral-800 flex flex-col relative top-0 right-0 h-full text-neutral-300">
                    <div className="p-4 border-b border-neutral-800">
                        <h3 className="font-semibold text-neutral-300">History</h3>
                    </div>
                    <div className="p-4 flex-1 overflow-y-auto">
                        <div className="text-sm text-neutral-500">
                            Timeline will appear here...
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
