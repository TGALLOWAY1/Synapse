import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { useAuthStore } from '../store/authStore';
import { X, Trash2, Smartphone, Monitor } from 'lucide-react';
import { artifactJobController } from '../lib/services/artifactJobController';
import { SyncStatusBanner, ProjectSyncDot } from './sync/ProjectSyncStatus';
import { useProjectSyncStore } from '../store/projectSyncStore';
import { compareReadinessReviewCurrentness, deriveReadinessCommitmentState, hasReadinessProvenanceForSpine } from '../lib/planning';
import { buildReadinessReviewInputFromState } from '../store/slices/readinessSlice';

interface ProjectDrawerProps {
    isOpen: boolean;
    onClose: () => void;
}

export function ProjectDrawer({ isOpen, onClose }: ProjectDrawerProps) {
    const store = useProjectStore();
    const { projects, deleteProject, getLatestSpine } = store;
    const user = useAuthStore((s) => s.user);
    const authError = useAuthStore((s) => s.authError);
    const authLoading = useAuthStore((s) => s.loading);
    const syncPhase = useProjectSyncStore((s) => s.phase);
    const navigate = useNavigate();
    // Don't flash a "no projects yet" empty state while we're still resolving the
    // session or pulling the user's projects from the server.
    const isResolving = authLoading || (!!user && syncPhase === 'loading');

    const projectList = Object.values(projects).sort((a, b) => b.createdAt - a.createdAt);

    const stageBadges: Record<string, { label: string; color: string }> = {
        history: { label: 'History', color: 'bg-purple-900/30 text-purple-400 border-purple-800' },
        review: { label: 'Challenge', color: 'bg-indigo-900/30 text-indigo-400 border-indigo-800' },
        workspace: { label: 'Exploring outputs', color: 'bg-sky-900/30 text-sky-400 border-sky-800' },
    };

    const getBadge = (projectId: string, stage: string) => {
        const spine = getLatestSpine(projectId);
        const input = buildReadinessReviewInputFromState(store, projectId);
        const events = store.readinessCommitmentEvents[projectId] ?? [];
        const reviewStates = (store.readinessReviews[projectId] ?? []).map(review => ({
            review,
            currentness: input ? compareReadinessReviewCurrentness(review, input) : undefined,
            commitment: deriveReadinessCommitmentState(review, events),
        }));
        const currentReview = reviewStates.find(item => item.currentness?.current && item.commitment.activeCommit)?.review;
        if (currentReview?.conclusion === 'ready_to_build') {
            return { label: 'Plan committed', color: 'bg-green-900/30 text-green-400 border-green-800' };
        }
        if (currentReview) {
            return { label: 'Committed with open questions', color: 'bg-amber-900/30 text-amber-300 border-amber-800' };
        }
        if (reviewStates.some(item => item.currentness && !item.currentness.integrityValid)) {
            return { label: 'Readiness unverifiable', color: 'bg-red-900/30 text-red-300 border-red-800' };
        }
        if (reviewStates.some(item => item.commitment.latestCommit)) {
            return { label: 'Changed since commitment', color: 'bg-amber-900/30 text-amber-300 border-amber-800' };
        }
        if (spine?.isFinal && hasReadinessProvenanceForSpine(
            store.readinessReviews[projectId] ?? [], events, spine.id,
        )) {
            return { label: 'Readiness unverifiable', color: 'bg-red-900/30 text-red-300 border-red-800' };
        }
        if (spine?.isFinal) {
            return { label: 'Legacy · readiness not recorded', color: 'bg-neutral-700 text-neutral-300 border-neutral-600' };
        }
        return stageBadges[stage] || { label: 'Working plan', color: 'bg-neutral-700 text-neutral-400 border-neutral-600' };
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
                className={`fixed top-0 right-0 h-full w-80 bg-neutral-900 text-neutral-100 border-l border-neutral-700 z-50 transform transition-transform duration-300 ease-in-out ${
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
                    {user && (
                        <div className="mb-1">
                            <SyncStatusBanner signedIn={!!user} />
                        </div>
                    )}
                    {projectList.length === 0 && (
                        <div className="text-sm text-neutral-500 text-center py-8 px-3 space-y-1">
                            {isResolving ? (
                                <p className="text-neutral-400">Loading your projects…</p>
                            ) : authError && !user ? (
                                <>
                                    <p className="text-neutral-400">Couldn't load your projects</p>
                                    <p className="text-xs">
                                        We couldn't confirm your session. Your projects are safe on
                                        this device — reload to try again.
                                    </p>
                                </>
                            ) : !user ? (
                                <>
                                    <p className="text-neutral-400">Sign in to see your projects</p>
                                    <p className="text-xs">
                                        Projects are saved per account on this device.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <p className="text-neutral-400">No projects yet</p>
                                    <p className="text-xs">
                                        Create one from the home screen to get started.
                                    </p>
                                </>
                            )}
                        </div>
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
                                            <ProjectSyncDot projectId={p.id} />
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
