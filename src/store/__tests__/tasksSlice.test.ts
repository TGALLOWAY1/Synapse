import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '../projectStore';
import type { ImplementationTask } from '../../types/tasks';

const reset = () =>
    useProjectStore.setState({
        projects: {},
        spineVersions: {},
        historyEvents: {},
        branches: {},
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
        tasks: {},
    });

const task = (id: string, over: Partial<ImplementationTask> = {}): ImplementationTask => ({
    id,
    title: `Task ${id}`,
    summary: 'summary',
    sourceArtifactId: 'art-1',
    acceptanceCriteria: ['does the thing'],
    ...over,
});

describe('tasksSlice', () => {
    beforeEach(() => {
        reset();
        localStorage.clear();
    });

    it('saves extracted tasks as todo with tracking metadata', () => {
        const s = useProjectStore.getState();
        const { saved } = s.saveTasks('p1', 'art-1', [task('a'), task('b')], 'spine-1');
        expect(saved).toBe(2);
        const tasks = useProjectStore.getState().getTasks('p1');
        expect(tasks).toHaveLength(2);
        expect(tasks.every(t => t.status === 'todo')).toBe(true);
        expect(tasks[0].sourceSpineVersionId).toBe('spine-1');
    });

    it('preserves status and export refs when re-saving an edited set', () => {
        const s = useProjectStore.getState();
        s.saveTasks('p1', 'art-1', [task('a'), task('b')]);
        s.setTaskStatus('p1', 'a', 'done');
        s.recordTaskExports('p1', [
            { taskId: 'a', ref: { target: 'github', externalUrl: 'http://x/1', exportedAt: 1 } },
        ]);

        // Re-save with an edited title for 'a' and a dropped 'b', added 'c'.
        s.saveTasks('p1', 'art-1', [task('a', { title: 'Edited A' }), task('c')]);
        const tasks = useProjectStore.getState().getTasks('p1');
        const ids = tasks.map(t => t.id).sort();
        expect(ids).toEqual(['a', 'c']);
        const a = tasks.find(t => t.id === 'a')!;
        expect(a.title).toBe('Edited A');
        expect(a.status).toBe('done');
        expect(a.externalRefs?.[0].externalUrl).toBe('http://x/1');
    });

    it('replaces only the tasks for the saved artifact', () => {
        const s = useProjectStore.getState();
        s.saveTasks('p1', 'art-1', [task('a')]);
        s.saveTasks('p1', 'art-2', [task('x', { sourceArtifactId: 'art-2' })]);
        s.saveTasks('p1', 'art-1', [task('a2')]);
        const tasks = useProjectStore.getState().getTasks('p1');
        expect(tasks.map(t => t.id).sort()).toEqual(['a2', 'x']);
        expect(useProjectStore.getState().getTasksForArtifact('p1', 'art-2')).toHaveLength(1);
    });

    it('re-exporting to the same target replaces the stale ref', () => {
        const s = useProjectStore.getState();
        s.saveTasks('p1', 'art-1', [task('a')]);
        s.recordTaskExports('p1', [
            { taskId: 'a', ref: { target: 'github', externalUrl: 'http://x/1', exportedAt: 1 } },
        ]);
        s.recordTaskExports('p1', [
            { taskId: 'a', ref: { target: 'github', externalUrl: 'http://x/2', exportedAt: 2 } },
        ]);
        const a = useProjectStore.getState().getTasks('p1')[0];
        expect(a.externalRefs).toHaveLength(1);
        expect(a.externalRefs?.[0].externalUrl).toBe('http://x/2');
    });

    it('drops tasks when the project is deleted', () => {
        const s = useProjectStore.getState();
        const { projectId } = s.createProject('P', 'idea');
        s.saveTasks(projectId, 'art-1', [task('a')]);
        expect(useProjectStore.getState().getTasks(projectId)).toHaveLength(1);
        useProjectStore.getState().deleteProject(projectId);
        expect(useProjectStore.getState().getTasks(projectId)).toHaveLength(0);
    });
});
