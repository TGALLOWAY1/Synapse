import type { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { SpineVersion, HistoryEvent, StructuredPRD } from '../../types';
import type { ProjectState } from '../types';

export type SpineSlice = {
    spineVersions: Record<string, SpineVersion[]>;
    updateSpineText: ProjectState['updateSpineText'];
    regenerateSpine: ProjectState['regenerateSpine'];
    markSpineFinal: ProjectState['markSpineFinal'];
    getSpineVersions: ProjectState['getSpineVersions'];
    getLatestSpine: ProjectState['getLatestSpine'];
    updateStructuredPRD: ProjectState['updateStructuredPRD'];
    updateSpineStructuredPRD: ProjectState['updateSpineStructuredPRD'];
    setSpineError: ProjectState['setSpineError'];
};

export const createSpineSlice: StateCreator<ProjectState, [], [], SpineSlice> = (set, get) => ({
    spineVersions: {},

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

    getSpineVersions: (projectId: string) => {
        return get().spineVersions[projectId] || [];
    },

    getLatestSpine: (projectId: string) => {
        const versions = get().spineVersions[projectId] || [];
        return versions.find(v => v.isLatest);
    },

    markSpineFinal: (projectId: string, spineId: string, isFinal: boolean) => {
        set((state) => {
            const projectSpines = state.spineVersions[projectId] || [];
            const updatedSpines = projectSpines.map(s =>
                s.id === spineId ? { ...s, isFinal } : s
            );
            return {
                spineVersions: {
                    ...state.spineVersions,
                    [projectId]: updatedSpines
                }
            };
        });
    },

    updateStructuredPRD: (projectId: string, spineId: string, structuredPRD: StructuredPRD) => {
        set((state) => {
            const projectSpines = state.spineVersions[projectId] || [];
            const updatedSpines = projectSpines.map(s =>
                s.id === spineId ? { ...s, structuredPRD } : s
            );
            return { spineVersions: { ...state.spineVersions, [projectId]: updatedSpines } };
        });
    },

    updateSpineStructuredPRD: (projectId: string, spineId: string, structuredPRD: StructuredPRD, responseText: string) => {
        set((state) => {
            const projectSpines = state.spineVersions[projectId] || [];
            const updatedSpines = projectSpines.map(s =>
                s.id === spineId ? { ...s, structuredPRD, responseText } : s
            );
            return { spineVersions: { ...state.spineVersions, [projectId]: updatedSpines } };
        });
    },

    setSpineError: (projectId: string, spineId: string, error: { message: string; category: string; timestamp: number } | null) => {
        set((state) => {
            const projectSpines = state.spineVersions[projectId] || [];
            const spine = projectSpines.find(s => s.id === spineId);
            if (!spine) return state;

            const updatedSpines = projectSpines.map(s =>
                s.id === spineId
                    ? {
                        ...s,
                        generationError: error ?? undefined,
                        // Clear placeholder so isPRDGenerating stops being true
                        responseText: error && s.responseText === 'Generating PRD...' ? '' : s.responseText,
                    }
                    : s
            );

            const historyEvents = { ...state.historyEvents };
            if (error) {
                const events = historyEvents[projectId] || [];
                historyEvents[projectId] = [
                    ...events,
                    {
                        id: uuidv4(),
                        projectId,
                        spineVersionId: spineId,
                        type: 'GenerationFailed' as const,
                        description: `Generation failed: ${error.message}`,
                        createdAt: error.timestamp,
                    },
                ];
            }

            return {
                spineVersions: { ...state.spineVersions, [projectId]: updatedSpines },
                historyEvents,
            };
        });
    },
});
