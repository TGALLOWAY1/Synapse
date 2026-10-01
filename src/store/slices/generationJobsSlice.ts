import type { StateCreator } from 'zustand';
import type {
    ArtifactSlotKey,
    ProjectJobState,
    SlotState,
} from '../../types';
import type { InitJobOptions, ProjectState } from '../types';

export type GenerationJobsSlice = {
    jobs: Record<string, ProjectJobState | undefined>;
    initJob: (
        projectId: string,
        spineVersionId: string,
        slotKeys: ArtifactSlotKey[],
        opts?: InitJobOptions,
    ) => void;
    claimJobRun: (projectId: string, runId: string) => void;
    setSlotStatus: (
        projectId: string,
        slot: ArtifactSlotKey,
        partial: Partial<SlotState>,
        runId?: string,
    ) => void;
    appendSlotProgress: (projectId: string, slot: ArtifactSlotKey, message: string, runId?: string) => void;
    clearJob: (projectId: string) => void;
    getSlot: (projectId: string, slot: ArtifactSlotKey) => SlotState | undefined;
    getJob: (projectId: string) => ProjectJobState | undefined;
    markAllInterrupted: (projectId: string, runId?: string) => void;
};

const blankSlot = (): SlotState => ({ status: 'idle', attempt: 0 });

const PROGRESS_LOG_CAP = 20;

/**
 * A job write tagged with a run id may only touch a job that run owns. A run
 * that was superseded (a newer run re-initialized or claimed the job) keeps
 * settling in the background — its late writes (a final `markAllInterrupted`,
 * a straggling progress line) must no-op rather than clobber the new run's
 * slots. Untagged writes and jobs without a run id are not guarded.
 */
const isStaleRunWrite = (job: ProjectJobState, runId: string | undefined): boolean =>
    runId !== undefined && job.runId !== undefined && job.runId !== runId;

export const createGenerationJobsSlice: StateCreator<
    ProjectState,
    [],
    [],
    GenerationJobsSlice
> = (set, get) => ({
    jobs: {},

    initJob: (projectId, spineVersionId, slotKeys, opts) => {
        set((state) => {
            // Re-initializing for the SAME spine keeps per-slot automatic-resume
            // counters (the auto-resume cap must survive the new job) and can
            // carry selected slots forward unchanged (a slot excluded from this
            // run keeps reading as failed instead of vanishing back to idle).
            const previous = state.jobs[projectId];
            const sameSpine = previous?.spineVersionId === spineVersionId;
            const slots = {} as Record<ArtifactSlotKey, SlotState>;
            if (previous && sameSpine) {
                for (const key of opts?.carryOverSlots ?? []) {
                    const prior = previous.slots[key];
                    if (prior) slots[key] = prior;
                }
            }
            for (const key of slotKeys) {
                const priorAuto = previous && sameSpine ? previous.slots[key]?.autoResumeAttempts ?? 0 : 0;
                const autoResumeAttempts = priorAuto + (opts?.autoResume ? 1 : 0);
                slots[key] = {
                    status: 'queued',
                    attempt: 0,
                    progressLog: [],
                    ...(autoResumeAttempts > 0 ? { autoResumeAttempts } : {}),
                };
            }
            return {
                jobs: {
                    ...state.jobs,
                    [projectId]: {
                        spineVersionId,
                        startedAt: Date.now(),
                        slots,
                        ...(opts?.runId ? { runId: opts.runId } : {}),
                    },
                },
            };
        });
    },

    // A new run that reuses an existing job (a manual single-slot retry, the
    // early design-system run) takes ownership of it, so any straggling write
    // from an older run is ignored from here on.
    claimJobRun: (projectId, runId) => {
        set((state) => {
            const job = state.jobs[projectId];
            if (!job || job.runId === runId) return state;
            return { jobs: { ...state.jobs, [projectId]: { ...job, runId } } };
        });
    },

    setSlotStatus: (projectId, slot, partial, runId) => {
        set((state) => {
            const job = state.jobs[projectId];
            if (!job || isStaleRunWrite(job, runId)) return state;
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

    appendSlotProgress: (projectId, slot, message, runId) => {
        set((state) => {
            const job = state.jobs[projectId];
            if (!job || isStaleRunWrite(job, runId)) return state;
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

    markAllInterrupted: (projectId, runId) => {
        set((state) => {
            const job = state.jobs[projectId];
            if (!job || isStaleRunWrite(job, runId)) return state;
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
