import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from '../projectStore';

// The generation jobs slice is transient UI state for artifact runs. Two
// guarantees live here (see docs/architecture/WORKSPACE_AND_ARTIFACTS.md):
// - run ownership: a write tagged with a run id only lands on a job that run
//   owns, so a superseded run settling late can't clobber the newer run;
// - the per-slot automatic-resume counter survives a same-spine re-init.

const projectId = 'p-jobs';

beforeEach(() => {
    useProjectStore.setState({ jobs: {} });
});

const slot = (key: 'data_model' | 'design_system') =>
    useProjectStore.getState().jobs[projectId]?.slots[key];

describe('generation jobs — run ownership', () => {
    it('ignores a superseded run\'s markAllInterrupted (it no longer owns the job)', () => {
        const store = useProjectStore.getState();
        store.initJob(projectId, 'spine-1', ['data_model'], { runId: 'run-1' });
        // A spine change supersedes run-1 with run-2, which re-inits the job.
        store.initJob(projectId, 'spine-2', ['data_model', 'design_system'], { runId: 'run-2' });
        store.setSlotStatus(projectId, 'data_model', { status: 'generating' }, 'run-2');

        // run-1 finally settles (aborted) and tries to interrupt "its" job.
        store.markAllInterrupted(projectId, 'run-1');

        expect(slot('data_model')?.status).toBe('generating');
        expect(slot('design_system')?.status).toBe('queued');

        // The owning run can still interrupt it.
        store.markAllInterrupted(projectId, 'run-2');
        expect(slot('data_model')?.status).toBe('interrupted');
        expect(slot('design_system')?.status).toBe('interrupted');
    });

    it('drops slot status and progress writes from a run that does not own the job', () => {
        const store = useProjectStore.getState();
        store.initJob(projectId, 'spine-1', ['data_model'], { runId: 'run-2' });

        store.setSlotStatus(projectId, 'data_model', { status: 'error' }, 'run-1');
        store.appendSlotProgress(projectId, 'data_model', 'stale progress', 'run-1');
        expect(slot('data_model')?.status).toBe('queued');
        expect(slot('data_model')?.progressLog).toEqual([]);

        store.appendSlotProgress(projectId, 'data_model', 'live progress', 'run-2');
        expect(slot('data_model')?.progressLog).toEqual(['live progress']);
    });

    it('lets a new run claim an existing job, after which the previous owner is ignored', () => {
        const store = useProjectStore.getState();
        store.initJob(projectId, 'spine-1', ['data_model'], { runId: 'run-1' });
        store.claimJobRun(projectId, 'retry-run');

        store.setSlotStatus(projectId, 'data_model', { status: 'interrupted' }, 'run-1');
        expect(slot('data_model')?.status).toBe('queued');
        store.setSlotStatus(projectId, 'data_model', { status: 'generating' }, 'retry-run');
        expect(slot('data_model')?.status).toBe('generating');
        expect(useProjectStore.getState().jobs[projectId]?.runId).toBe('retry-run');
    });

    it('keeps untagged writes working (legacy callers and run-less jobs)', () => {
        const store = useProjectStore.getState();
        store.initJob(projectId, 'spine-1', ['data_model']);
        store.setSlotStatus(projectId, 'data_model', { status: 'generating' }, 'any-run');
        expect(slot('data_model')?.status).toBe('generating');
        store.markAllInterrupted(projectId);
        expect(slot('data_model')?.status).toBe('interrupted');
    });
});

describe('generation jobs — automatic resume counter', () => {
    it('counts automatic runs per slot across same-spine re-inits', () => {
        const store = useProjectStore.getState();
        store.initJob(projectId, 'spine-1', ['data_model'], { runId: 'manual' });
        expect(slot('data_model')?.autoResumeAttempts).toBeUndefined();

        store.initJob(projectId, 'spine-1', ['data_model'], { runId: 'auto-1', autoResume: true });
        expect(slot('data_model')?.autoResumeAttempts).toBe(1);
        store.initJob(projectId, 'spine-1', ['data_model'], { runId: 'auto-2', autoResume: true });
        expect(slot('data_model')?.autoResumeAttempts).toBe(2);

        // A manual run neither resets nor increments the automatic budget.
        store.initJob(projectId, 'spine-1', ['data_model'], { runId: 'manual-2' });
        expect(slot('data_model')?.autoResumeAttempts).toBe(2);
    });

    it('starts from zero for a different spine', () => {
        const store = useProjectStore.getState();
        store.initJob(projectId, 'spine-1', ['data_model'], { autoResume: true });
        store.initJob(projectId, 'spine-2', ['data_model'], { autoResume: true });
        expect(slot('data_model')?.autoResumeAttempts).toBe(1);
    });

    it('carries an excluded slot forward unchanged so it keeps reading as failed', () => {
        const store = useProjectStore.getState();
        store.initJob(projectId, 'spine-1', ['data_model', 'design_system'], { runId: 'run-1' });
        store.setSlotStatus(projectId, 'data_model', {
            status: 'error',
            autoResumeAttempts: 2,
            error: { message: 'schema rejected', category: 'unknown', timestamp: 1 },
        }, 'run-1');

        store.initJob(projectId, 'spine-1', ['design_system'], {
            runId: 'run-2',
            autoResume: true,
            carryOverSlots: ['data_model'],
        });

        expect(slot('data_model')?.status).toBe('error');
        expect(slot('data_model')?.error?.message).toBe('schema rejected');
        expect(slot('data_model')?.autoResumeAttempts).toBe(2);
        expect(slot('design_system')?.status).toBe('queued');
    });
});
