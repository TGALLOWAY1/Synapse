import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import type { Project } from '../types';
import { Plus, Settings, Trash2 } from 'lucide-react';
import { SettingsModal } from './SettingsModal';

export function HomePage() {
    const { projects, createProject, deleteProject, getLatestSpine, getLatestDevPlan, getAgentPrompts } = useProjectStore();
    const navigate = useNavigate();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [projectName, setProjectName] = useState('');
    const [promptText, setPromptText] = useState('');

    const handleCreateProject = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!projectName.trim() || !promptText.trim()) return;

        const apiKey = localStorage.getItem('GEMINI_API_KEY');
        if (!apiKey) { setIsSettingsOpen(true); return; }

        const { projectId, spineId } = createProject(projectName.trim(), promptText.trim());
        navigate(`/p/${projectId}`);

        // Generate structured PRD asynchronously
        import('../lib/llmProvider').then(({ generateStructuredPRD, structuredPRDToMarkdown }) => {
            generateStructuredPRD(promptText.trim())
                .then((structuredPRD) => {
                    const markdown = structuredPRDToMarkdown(structuredPRD);
                    useProjectStore.getState().updateSpineStructuredPRD(projectId, spineId, structuredPRD, markdown);
                })
                .catch((e) => {
                    const errorMsg = e instanceof Error ? e.message : String(e);
                    useProjectStore.getState().updateSpineText(
                        projectId,
                        spineId,
                        `**Error generating PRD:**\n${errorMsg}\n\nPlease verify your API Key in Settings or check your network connection.`
                    );
                });
        });
    };

    return (
        <div className="min-h-screen p-8 max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-3xl font-bold">Synapse PRD</h1>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setIsSettingsOpen(true)}
                        className="p-2 text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-md transition"
                        title="API Settings"
                    >
                        <Settings size={20} />
                    </button>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition"
                    >
                        <Plus size={18} />
                        New Project
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {Object.values(projects).map((project: unknown) => {
                    const p = project as Project;
                    const spine = getLatestSpine(p.id);
                    const hasDevPlan = !!getLatestDevPlan(p.id);
                    const hasPrompts = getAgentPrompts(p.id).length > 0;
                    const stageBadge = hasPrompts ? 'Prompts' : hasDevPlan ? 'Dev Plan' : spine?.isFinal ? 'PRD Final' : 'PRD';
                    const stageColor = hasPrompts
                        ? 'bg-purple-900/30 text-purple-400 border-purple-800'
                        : hasDevPlan
                            ? 'bg-emerald-900/30 text-emerald-400 border-emerald-800'
                            : spine?.isFinal
                                ? 'bg-green-900/30 text-green-400 border-green-800'
                                : 'bg-neutral-700 text-neutral-400 border-neutral-600';

                    return (
                        <div
                            key={p.id}
                            onClick={() => navigate(`/p/${p.id}`)}
                            className="p-6 relative bg-neutral-800 rounded-lg border border-neutral-700 hover:border-indigo-500 cursor-pointer transition group"
                        >
                            <h2 className="text-xl font-semibold mb-2 group-hover:text-indigo-400">
                                {p.name}
                            </h2>
                            <div className="flex items-center gap-2">
                                <p className="text-sm text-neutral-400">
                                    {new Date(p.createdAt).toLocaleDateString()}
                                </p>
                                <span className={`text-xs px-2 py-0.5 rounded border ${stageColor}`}>
                                    {stageBadge}
                                </span>
                            </div>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm(`Are you sure you want to delete "${p.name}"?`)) {
                                        deleteProject(p.id);
                                    }
                                }}
                                className="absolute top-4 right-4 p-2 text-neutral-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Delete Project"
                                aria-label="Delete project"
                            >
                                <Trash2 size={18} />
                            </button>
                        </div>
                    );
                })}
                {Object.keys(projects).length === 0 && (
                    <div className="col-span-full p-12 text-center text-neutral-500 border border-dashed border-neutral-700 rounded-lg">
                        No projects yet. Create one to get started!
                    </div>
                )}
            </div>

            {isModalOpen && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={() => setIsModalOpen(false)}>
                    <div className="bg-neutral-800 rounded-lg w-full max-w-xl shadow-2xl overflow-hidden border border-neutral-700" onClick={e => e.stopPropagation()}>
                        <div className="px-6 py-4 border-b border-neutral-700">
                            <h2 className="text-xl font-semibold">Start New Session</h2>
                        </div>

                        <form onSubmit={handleCreateProject} className="p-6 space-y-6">
                            <div>
                                <label className="block text-sm font-medium text-neutral-300 mb-2">
                                    Project Name
                                </label>
                                <input
                                    type="text"
                                    value={projectName}
                                    onChange={(e) => setProjectName(e.target.value)}
                                    className="w-full bg-neutral-900 border border-neutral-700 rounded-md px-4 py-2 focus:outline-none focus:border-indigo-500"
                                    placeholder="e.g., E-commerce Mobile App"
                                    autoFocus
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-neutral-300 mb-2">
                                    Initial Prompt
                                </label>
                                <textarea
                                    value={promptText}
                                    onChange={(e) => setPromptText(e.target.value)}
                                    className="w-full bg-neutral-900 border border-neutral-700 rounded-md px-4 py-2 min-h-32 focus:outline-none focus:border-indigo-500"
                                    placeholder="Describe the product you want to build..."
                                />
                            </div>

                            <div className="flex justify-end gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="px-4 py-2 text-neutral-400 hover:text-neutral-200 transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={!projectName.trim() || !promptText.trim()}
                                    className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Generate First Draft
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
        </div>
    );
}
