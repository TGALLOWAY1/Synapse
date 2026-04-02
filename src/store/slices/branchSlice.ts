import type { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Branch, SpineVersion, HistoryEvent } from '../../types';
import type { ProjectState } from '../types';

export type BranchSlice = {
    branches: Record<string, Branch[]>;
    createBranch: ProjectState['createBranch'];
    addBranchMessage: ProjectState['addBranchMessage'];
    mergeBranch: ProjectState['mergeBranch'];
    deleteBranch: ProjectState['deleteBranch'];
    getBranchesForSpine: ProjectState['getBranchesForSpine'];
};

export const createBranchSlice: StateCreator<ProjectState, [], [], BranchSlice> = (set, get) => ({
    branches: {},

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
            diff: {
                matches: [{
                    before: branch.anchorText,
                    after: "(Consolidated changes)"
                }]
            }
        };

        set((state) => ({
            branches: { ...state.branches, [projectId]: updatedBranches },
            spineVersions: { ...state.spineVersions, [projectId]: [...mappedOld, newSpine] },
            historyEvents: { ...state.historyEvents, [projectId]: [...(state.historyEvents[projectId] || []), mergeEvent] },
        }));

        return { newSpineId: newSpine.id };
    },

    deleteBranch: (projectId: string, branchId: string) => {
        set((state) => {
            const projectBranches = state.branches[projectId] || [];
            return {
                branches: {
                    ...state.branches,
                    [projectId]: projectBranches.filter(b => b.id !== branchId)
                }
            };
        });
    },

    getBranchesForSpine: (projectId: string, spineVersionId: string) => {
        const projectBranches = get().branches[projectId] || [];
        return projectBranches.filter(b => b.spineVersionId === spineVersionId);
    },
});
