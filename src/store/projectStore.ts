import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type { Project, SpineVersion, HistoryEvent, Branch } from '../types';

interface ProjectState {
    projects: Record<string, Project>;
    spineVersions: Record<string, SpineVersion[]>;
    historyEvents: Record<string, HistoryEvent[]>;
    branches: Record<string, Branch[]>; // projectId -> Branch[]
    createProject: (name: string, promptText: string) => { projectId: string, spineId: string };
    updateSpineText: (projectId: string, spineId: string, text: string) => void;
    regenerateSpine: (projectId: string) => { newSpineId: string };
    createBranch: (projectId: string, spineVersionId: string, anchorText: string, initialIntent: string) => { branchId: string };
    addBranchMessage: (projectId: string, branchId: string, role: 'user' | 'assistant', content: string) => void;
    mergeBranch: (projectId: string, branchId: string, newSpineText: string) => { newSpineId: string };
    getProject: (projectId: string) => Project | undefined;
    getSpineVersions: (projectId: string) => SpineVersion[];
    getLatestSpine: (projectId: string) => SpineVersion | undefined;
    getHistoryEvents: (projectId: string) => HistoryEvent[];
    getBranchesForSpine: (projectId: string, spineVersionId: string) => Branch[];
}

export const useProjectStore = create<ProjectState>()(
    persist(
        (set, get) => ({
            projects: {},
            spineVersions: {},
            historyEvents: {},
            branches: {},

            createProject: (name: string, promptText: string) => {
                const projectId = uuidv4();
                const now = Date.now();
                const newProject: Project = {
                    id: projectId,
                    name,
                    createdAt: now,
                };

                const initialSpine: SpineVersion = {
                    id: 'v1',
                    projectId,
                    promptText,
                    responseText: 'Generating PRD...',
                    createdAt: now,
                    isLatest: true,
                    isFinal: false,
                };

                const initEvent: HistoryEvent = {
                    id: uuidv4(),
                    projectId,
                    spineVersionId: initialSpine.id,
                    type: "Init",
                    description: "Spine v1 created",
                    createdAt: now,
                };

                set((state) => ({
                    projects: { ...state.projects, [projectId]: newProject },
                    spineVersions: { ...state.spineVersions, [projectId]: [initialSpine] },
                    historyEvents: { ...state.historyEvents, [projectId]: [initEvent] },
                }));

                return { projectId, spineId: initialSpine.id };
            },

            updateSpineText: (projectId: string, spineId: string, text: string) => {
                set((state) => {
                    const projectSpines = state.spineVersions[projectId] || [];
                    const updatedSpines = projectSpines.map(s =>
                        s.id === spineId ? { ...s, responseText: text } : s
                    );
                    return { spineVersions: { ...state.spineVersions, [projectId]: updatedSpines } };
                });
            },

            regenerateSpine: (projectId: string) => {
                const state = get();
                const currentVersions = state.spineVersions[projectId] || [];
                const latest = currentVersions.find(v => v.isLatest);

                if (!latest) throw new Error("No spine to regenerate");

                const nextVersionNum = currentVersions.length + 1;
                const mappedOld = currentVersions.map(v => ({ ...v, isLatest: false }));

                const now = Date.now();
                const newSpine: SpineVersion = {
                    id: `v${nextVersionNum}`,
                    projectId,
                    promptText: latest.promptText,
                    responseText: 'Generating PRD...',
                    createdAt: now,
                    isLatest: true,
                    isFinal: false,
                };

                const regenEvent: HistoryEvent = {
                    id: uuidv4(),
                    projectId,
                    spineVersionId: newSpine.id,
                    type: "Regenerated",
                    description: "Regenerated spine",
                    createdAt: now,
                };

                set((state) => ({
                    spineVersions: { ...state.spineVersions, [projectId]: [...mappedOld, newSpine] },
                    historyEvents: { ...state.historyEvents, [projectId]: [...(state.historyEvents[projectId] || []), regenEvent] },
                }));

                return { newSpineId: newSpine.id };
            },

            getProject: (projectId: string) => {
                return get().projects[projectId];
            },

            getSpineVersions: (projectId: string) => {
                return get().spineVersions[projectId] || [];
            },

            getLatestSpine: (projectId: string) => {
                const versions = get().spineVersions[projectId] || [];
                return versions.find(v => v.isLatest);
            },

            getHistoryEvents: (projectId: string) => {
                return get().historyEvents[projectId] || [];
            },

            createBranch: (projectId: string, spineVersionId: string, anchorText: string, initialIntent: string) => {
                const branchId = uuidv4();
                const now = Date.now();
                const newBranch: Branch = {
                    id: branchId,
                    projectId,
                    spineVersionId,
                    anchorText,
                    status: 'active',
                    createdAt: now,
                    messages: [
                        { id: uuidv4(), role: 'user', content: initialIntent, createdAt: now }
                    ]
                };

                set((state) => {
                    const projectBranches = state.branches[projectId] || [];
                    return {
                        branches: {
                            ...state.branches,
                            [projectId]: [...projectBranches, newBranch]
                        }
                    };
                });
                return { branchId };
            },

            addBranchMessage: (projectId: string, branchId: string, role: 'user' | 'assistant', content: string) => {
                set((state) => {
                    const projectBranches = state.branches[projectId] || [];
                    const updatedBranches = projectBranches.map(b => {
                        if (b.id === branchId) {
                            return {
                                ...b,
                                messages: [...b.messages, { id: uuidv4(), role, content, createdAt: Date.now() }]
                            };
                        }
                        return b;
                    });
                    return {
                        branches: {
                            ...state.branches,
                            [projectId]: updatedBranches
                        }
                    };
                });
            },

            mergeBranch: (projectId: string, branchId: string, newSpineText: string) => {
                const state = get();
                const projectBranches = state.branches[projectId] || [];
                const branch = projectBranches.find(b => b.id === branchId);

                if (!branch) throw new Error("Branch not found");

                const currentVersions = state.spineVersions[projectId] || [];
                const oldSpine = currentVersions.find(v => v.id === branch.spineVersionId);
                if (!oldSpine) throw new Error("Spine not found");

                // Mark branch as merged
                const updatedBranches = projectBranches.map(b =>
                    b.id === branchId ? { ...b, status: 'merged' as const } : b
                );

                // Create new Spine Version
                const nextVersionNum = currentVersions.length + 1;
                const mappedOld = currentVersions.map(v => ({ ...v, isLatest: false }));

                const now = Date.now();
                const newSpine: SpineVersion = {
                    id: `v${nextVersionNum}`,
                    projectId,
                    promptText: oldSpine.promptText, // inherit prompt
                    responseText: newSpineText,
                    createdAt: now,
                    isLatest: true,
                    isFinal: false,
                };

                // Add History Event
                const mergeEvent: HistoryEvent = {
                    id: uuidv4(),
                    projectId,
                    spineVersionId: newSpine.id,
                    type: "Consolidated",
                    description: `Merged branch for "${branch.anchorText.substring(0, 30)}..."`,
                    createdAt: now,
                };

                set((state) => ({
                    branches: { ...state.branches, [projectId]: updatedBranches },
                    spineVersions: { ...state.spineVersions, [projectId]: [...mappedOld, newSpine] },
                    historyEvents: { ...state.historyEvents, [projectId]: [...(state.historyEvents[projectId] || []), mergeEvent] },
                }));

                return { newSpineId: newSpine.id };
            },

            getBranchesForSpine: (projectId: string, spineVersionId: string) => {
                const projectBranches = get().branches[projectId] || [];
                return projectBranches.filter(b => b.spineVersionId === spineVersionId);
            },

        }),
        {
            name: 'synapse-projects-storage',
        }
    )
);
