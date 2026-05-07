import type { StateCreator } from 'zustand';
import type { ProjectState } from '../types';
import type { SectionId } from '../../lib/schemas/prdSchemas';

export interface PrdProgressEntry {
    messages: string[];
    updatedAt: number;
}

export interface PrdSectionStatusEntry {
    tier: 'fast' | 'strong';
    status: 'pending' | 'queued' | 'generating' | 'complete' | 'error' | 'refining';
    model?: string;
    ms?: number;
    error?: string;
    /** Rough wall-clock estimate (seconds) for this section. */
    estimatedSeconds?: number;
    /** Wall-clock start timestamp (ms) — set when status flips to 'generating'. */
    startedAt?: number;
}

export type PrdProgressSlice = {
    /** Transient — excluded from persistence in the root store config. */
    prdProgress: Record<string, PrdProgressEntry | undefined>;
    appendPrdProgress: (projectId: string, message: string) => void;
    clearPrdProgress: (projectId: string) => void;
    getPrdProgress: (projectId: string) => PrdProgressEntry | undefined;

    /** Per-section generation status grid. Transient — excluded from persistence. */
    prdSectionStatus: Record<string, Record<SectionId, PrdSectionStatusEntry> | undefined>;
    setSectionStatus: (projectId: string, sectionId: SectionId, update: Partial<PrdSectionStatusEntry>) => void;
    clearSectionStatus: (projectId: string) => void;
};

const PROGRESS_LOG_CAP = 24;

export const createPrdProgressSlice: StateCreator<
    ProjectState,
    [],
    [],
    PrdProgressSlice
> = (set, get) => ({
    prdProgress: {},
    prdSectionStatus: {},

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

    setSectionStatus: (projectId, sectionId, update) => {
        set((state) => {
            const current = state.prdSectionStatus[projectId] ?? {} as Record<SectionId, PrdSectionStatusEntry>;
            const existing = current[sectionId] ?? { tier: update.tier ?? 'strong', status: 'pending' };
            const merged: PrdSectionStatusEntry = { ...existing, ...update };
            // Stamp wall-clock start the first time a section flips to 'generating'
            // so the live elapsed counter has a stable origin across re-renders.
            if (update.status === 'generating' && !merged.startedAt) {
                merged.startedAt = Date.now();
            }
            return {
                prdSectionStatus: {
                    ...state.prdSectionStatus,
                    [projectId]: {
                        ...current,
                        [sectionId]: merged,
                    },
                },
            };
        });
    },

    clearSectionStatus: (projectId) => {
        set((state) => {
            if (!state.prdSectionStatus[projectId]) return state;
            const next = { ...state.prdSectionStatus };
            delete next[projectId];
            return { prdSectionStatus: next };
        });
    },
});
