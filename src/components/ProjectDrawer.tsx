import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { X, Trash2, Smartphone, Monitor } from 'lucide-react';
import { artifactJobController } from '../lib/services/artifactJobController';

interface ProjectDrawerProps {
    isOpen: boolean;
    onClose: () => void;
}

export function ProjectDrawer({ isOpen, onClose }: ProjectDrawerProps) {
    const { projects, deleteProject, getLatestSpine } = useProjectStore();
    const navigate = useNavigate();

    const projectList = Object.values(projects).sort((a, b) => b.createdAt - a.createdAt);

    const stageBadges: Record<string, { label: string; color: string }> = {
        history: { label: 'History', color: 'bg-purple-900/30 text-purple-400 border-purple-800' },
        artifacts: { label: 'Artifacts', color: 'bg-emerald-900/30 text-emerald-400 border-emerald-800' },
        mockups: { label: 'Mockups', color: 'bg-blue-900/30 text-blue-400 border-blue-800' },
    };

    const getBadge = (projectId: string, stage: string) => {
        const spine = getLatestSpine(projectId);
        return stageBadges[stage] || (spine?.isFinal
            ? { label: 'PRD Final', color: 'bg-green-900/30 text-green-400 border-green-800' }
            : { label: 'PRD', color: 'bg-neutral-700 text-neutral-400 border-neutral-600' });
    };

    return (
        <>
            {/* Backdrop */}
            {isOpen && (
                <div
                    className="fixed inset-0 bg-black/40 z-40 transition-opacity"
                    onClick={onClose}
                />
            )}

            {/* Drawer */}
            <div
                className={`fixed top-0 right-0 h-full w-80 bg-neutral-900 border-l border-neutral-700 z-50 transform transition-transform duration-300 ease-in-out ${
                    isOpen ? 'translate-x-0' : 'translate-x-full'
                }`}
            >
                <div className="flex items-center justify-between p-4 border-b border-neutral-700">
                    <h2 className="text-lg font-semibold">Projects</h2>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-neutral-400 hover:text-white hover:bg-white/10 rounded-lg transition"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="overflow-y-auto h-[calc(100%-57px)] p-3 space-y-2">
                    {projectList.length === 0 && (
                        <p className="text-sm text-neutral-500 text-center py-8">
                            No projects yet
                        </p>
                    )}

                    {projectList.map((p) => {
                        const stage = p.currentStage || 'prd';
                        const badge = getBadge(p.id, stage);

                        return (
                            <div
                                key={p.id}
                                onClick={() => {
                                    navigate(`/p/${p.id}`);
                                    onClose();
                                }}
                                className="p-3 rounded-lg bg-neutral-800/60 border border-neutral-700/50 hover:border-indigo-500/50 cursor-pointer transition group"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            {p.platform === 'app' && <Smartphone size={13} className="text-neutral-500 shrink-0" />}
                                            {p.platform === 'web' && <Monitor size={13} className="text-neutral-500 shrink-0" />}
                                            <h3 className="text-sm font-medium truncate group-hover:text-indigo-400 transition">
                                                {p.name}
                                            </h3>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-neutral-500">
                                                {new Date(p.createdAt).toLocaleDateString()}
                                            </span>
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badge.color}`}>
                                                {badge.label}
                                            </span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (window.confirm(`Delete "${p.name}"?`)) {
                                                artifactJobController.cancelAll(p.id);
                                                deleteProject(p.id);
                                            }
                                        }}
                                        className="p-1 text-neutral-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                        title="Delete"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </>
    );
}
