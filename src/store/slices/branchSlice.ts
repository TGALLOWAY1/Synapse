import type { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Branch, SpineVersion, HistoryEvent } from '../../types';
import type { ProjectState } from '../types';
import { assertProjectCapability } from '../../lib/projectCapabilities';

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
        assertProjectCapability(get().projects[projectId], 'canEditProjectContent');
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
        assertProjectCapability(get().projects[projectId], 'canEditProjectContent');
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
        assertProjectCapability(get().projects[projectId], 'canEditProjectContent');
        // Validate against a snapshot, but perform the array derivations inside
        // the set() updater against the fresh `state` so a concurrent spine /
        // branch mutation cannot be clobbered by a stale snapshot.
        const snapshot = get();
        const branch = (snapshot.branches[projectId] || []).find(b => b.id === branchId);
        if (!branch) throw new Error("Branch not found");
        const oldSpine = (snapshot.spineVersions[projectId] || []).find(v => v.id === branch.spineVersionId);
        if (!oldSpine) throw new Error("Spine not found");

        const now = Date.now();
        const historyEventId = uuidv4();
        // UUID, not `v${length + 1}`: a length-derived id collides with an
        // existing spine if two appends race or versions are ever pruned,
        // silently turning the append into an overwrite. Display labels are
        // derived from array position, never from the id.
        const newSpineId = uuidv4();

        set((state) => {
            const projectBranches = state.branches[projectId] || [];
            const updatedBranches = projectBranches.map(b =>
                b.id === branchId ? { ...b, status: 'merged' as const } : b
            );

            const currentVersions = state.spineVersions[projectId] || [];
            const mappedOld = currentVersions.map(v => ({ ...v, isLatest: false }));

            const newSpine: SpineVersion = {
                id: newSpineId,
                projectId,
                promptText: oldSpine.promptText, // inherit prompt
                responseText: newSpineText,
                createdAt: now,
                isLatest: true,
                isFinal: false,
                // Carry the persisted safety review forward: the classification
                // binds to the project idea, not to one spine's text, and the
                // canonical-spine builder threads its restriction directive into
                // every downstream artifact. Dropping it here would silently
                // strip a restricted project's binding constraints (and its
                // SafetyBoundariesCard) after a consolidation.
                safetyReview: oldSpine.safetyReview,
                // Preflight clarification answers likewise describe the idea —
                // keep them so a later regenerate can still honor them.
                preflightSession: oldSpine.preflightSession,
                // NOTE: structuredPRD is deliberately NOT copied — the merge
                // output is markdown only, and stamping the pre-merge
                // structured PRD onto it would present content that no longer
                // matches the document (and feed stale data to artifacts).
                provenance: {
                    changeSource: 'branch_merge',
                    editSummary: `Merged branch: "${branch.anchorText.substring(0, 40)}${branch.anchorText.length > 40 ? '…' : ''}"`,
                },
            };

            const mergeEvent: HistoryEvent = {
                id: historyEventId,
                projectId,
                spineVersionId: newSpineId,
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

            return {
                branches: { ...state.branches, [projectId]: updatedBranches },
                spineVersions: { ...state.spineVersions, [projectId]: [...mappedOld, newSpine] },
                historyEvents: { ...state.historyEvents, [projectId]: [...(state.historyEvents[projectId] || []), mergeEvent] },
            };
        });

        return { newSpineId };
    },

    deleteBranch: (projectId: string, branchId: string) => {
        assertProjectCapability(get().projects[projectId], 'canEditProjectContent');
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
