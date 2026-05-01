import type { StateCreator } from 'zustand';
import type { ProjectState } from '../types';

export interface PrdProgressEntry {
    messages: string[];
    updatedAt: number;
}

export type PrdProgressSlice = {
    /** Transient — excluded from persistence in the root store config. */
    prdProgress: Record<string, PrdProgressEntry | undefined>;
    appendPrdProgress: (projectId: string, message: string) => void;
    clearPrdProgress: (projectId: string) => void;
    getPrdProgress: (projectId: string) => PrdProgressEntry | undefined;
};

const PROGRESS_LOG_CAP = 24;

export const createPrdProgressSlice: StateCreator<
    ProjectState,
    [],
    [],
    PrdProgressSlice
> = (set, get) => ({
    prdProgress: {},

    appendPrdProgress: (projectId, message) => {
        set((state) => {
            const current = state.prdProgress[projectId];
            const log = current?.messages ?? [];
            // Dedupe consecutive identical messages so chunk-throttled emissions
            // that round to the same string don't pile up.
            if (log.length > 0 && log[log.length - 1] === message) return state;
            const next = log.length >= PROGRESS_LOG_CAP
                ? [...log.slice(log.length - PROGRESS_LOG_CAP + 1), message]
                : [...log, message];
            return {
                prdProgress: {
                    ...state.prdProgress,
                    [projectId]: { messages: next, updatedAt: Date.now() },
                },
            };
        });
    },

    clearPrdProgress: (projectId) => {
        set((state) => {
            if (!state.prdProgress[projectId]) return state;
            const next = { ...state.prdProgress };
            delete next[projectId];
            return { prdProgress: next };
        });
    },

    getPrdProgress: (projectId) => get().prdProgress[projectId],
});
