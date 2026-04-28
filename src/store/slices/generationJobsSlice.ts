import type { StateCreator } from 'zustand';
import type {
    ArtifactSlotKey,
    ProjectJobState,
    SlotState,
} from '../../types';
import type { ProjectState } from '../types';

export type GenerationJobsSlice = {
    jobs: Record<string, ProjectJobState | undefined>;
    initJob: (projectId: string, spineVersionId: string, slotKeys: ArtifactSlotKey[]) => void;
    setSlotStatus: (
        projectId: string,
        slot: ArtifactSlotKey,
        partial: Partial<SlotState>,
    ) => void;
    appendSlotProgress: (projectId: string, slot: ArtifactSlotKey, message: string) => void;
    clearJob: (projectId: string) => void;
    getSlot: (projectId: string, slot: ArtifactSlotKey) => SlotState | undefined;
    getJob: (projectId: string) => ProjectJobState | undefined;
    markAllInterrupted: (projectId: string) => void;
};

const blankSlot = (): SlotState => ({ status: 'idle', attempt: 0 });

const PROGRESS_LOG_CAP = 20;

export const createGenerationJobsSlice: StateCreator<
    ProjectState,
    [],
    [],
    GenerationJobsSlice
> = (set, get) => ({
    jobs: {},

    initJob: (projectId, spineVersionId, slotKeys) => {
        const slots = {} as Record<ArtifactSlotKey, SlotState>;
        for (const key of slotKeys) {
            slots[key] = { status: 'queued', attempt: 0, progressLog: [] };
        }
        set((state) => ({
            jobs: {
                ...state.jobs,
                [projectId]: {
                    spineVersionId,
                    startedAt: Date.now(),
                    slots,
                },
            },
        }));
    },

    setSlotStatus: (projectId, slot, partial) => {
        set((state) => {
            const job = state.jobs[projectId];
            if (!job) return state;
            const current = job.slots[slot] ?? blankSlot();
            return {
                jobs: {
                    ...state.jobs,
                    [projectId]: {
                        ...job,
                        slots: {
                            ...job.slots,
                            [slot]: { ...current, ...partial },
                        },
                    },
                },
            };
        });
    },

    appendSlotProgress: (projectId, slot, message) => {
        set((state) => {
            const job = state.jobs[projectId];
            if (!job) return state;
            const current = job.slots[slot] ?? blankSlot();
            const log = current.progressLog ?? [];
            // Dedupe consecutive identical messages so chunk-throttled emissions
            // that round to the same string don't pile up.
            if (log.length > 0 && log[log.length - 1] === message) return state;
            const next = log.length >= PROGRESS_LOG_CAP
                ? [...log.slice(log.length - PROGRESS_LOG_CAP + 1), message]
                : [...log, message];
            return {
                jobs: {
                    ...state.jobs,
                    [projectId]: {
                        ...job,
                        slots: {
                            ...job.slots,
                            [slot]: { ...current, progressLog: next },
                        },
                    },
                },
            };
        });
    },

    clearJob: (projectId) => {
        set((state) => {
            if (!state.jobs[projectId]) return state;
            const next = { ...state.jobs };
            delete next[projectId];
            return { jobs: next };
        });
    },

    getSlot: (projectId, slot) => get().jobs[projectId]?.slots[slot],

    getJob: (projectId) => get().jobs[projectId],

    markAllInterrupted: (projectId) => {
        set((state) => {
            const job = state.jobs[projectId];
            if (!job) return state;
            const slots = { ...job.slots };
            for (const key of Object.keys(slots) as ArtifactSlotKey[]) {
                const s = slots[key];
                if (s && (s.status === 'queued' || s.status === 'generating')) {
                    slots[key] = { ...s, status: 'interrupted' };
                }
            }
            return {
                jobs: {
                    ...state.jobs,
                    [projectId]: { ...job, slots },
                },
            };
        });
    },
});
