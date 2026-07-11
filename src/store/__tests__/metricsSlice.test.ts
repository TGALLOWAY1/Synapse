import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '../projectStore';
import type { WorkflowRun } from '../../types';

const reset = () =>
    useProjectStore.setState({
        projects: {
            p1: { id: 'p1', name: 'Project 1', createdAt: 1 },
            p2: { id: 'p2', name: 'Project 2', createdAt: 1 },
        },
        spineVersions: {},
        historyEvents: {},
        branches: {},
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
        tasks: {},
        workflowRuns: {},
    });

const run = (id: string, projectId: string, startedAt: number): WorkflowRun => ({
    id,
    projectId,
    workflowType: 'prd',
    status: 'complete',
    startedAt,
    completedAt: startedAt + 1000,
    actualRuntimeMs: 1000,
    sequentialEstimateMs: 2500,
    parallelTimeSavedMs: 1500,
    speedupRatio: 2.5,
    maxConcurrency: 3,
    averageConcurrency: 2.1,
    criticalPathMs: 800,
    totalNodeRuntimeMs: 2500,
    totalInputTokens: 100,
    totalOutputTokens: 200,
    totalTokens: 300,
    estimatedCost: 0.01,
    retryCount: 0,
    failureCount: 0,
    nodeCount: 5,
    parallelGroupCount: 3,
    nodes: [],
});

describe('metricsSlice', () => {
    beforeEach(() => {
        reset();
        localStorage.clear();
    });

    it('records runs newest-first per project', () => {
        const s = useProjectStore.getState();
        s.recordWorkflowRun(run('r1', 'p1', 1000));
        s.recordWorkflowRun(run('r2', 'p1', 2000));
        const runs = useProjectStore.getState().getWorkflowRuns('p1');
        expect(runs.map(r => r.id)).toEqual(['r2', 'r1']);
    });

    it('aggregates all runs across projects newest-first', () => {
        const s = useProjectStore.getState();
        s.recordWorkflowRun(run('r1', 'p1', 1000));
        s.recordWorkflowRun(run('r2', 'p2', 3000));
        s.recordWorkflowRun(run('r3', 'p1', 2000));
        const all = useProjectStore.getState().getAllWorkflowRuns();
        expect(all.map(r => r.id)).toEqual(['r2', 'r3', 'r1']);
    });

    it('caps stored runs per project at 50', () => {
        const s = useProjectStore.getState();
        for (let i = 0; i < 60; i++) {
            s.recordWorkflowRun(run(`r${i}`, 'p1', i));
        }
        const runs = useProjectStore.getState().getWorkflowRuns('p1');
        expect(runs).toHaveLength(50);
        // Newest kept (r59 first), oldest dropped (r0..r9 gone).
        expect(runs[0].id).toBe('r59');
        expect(runs.some(r => r.id === 'r0')).toBe(false);
    });

    it('clears runs for a project', () => {
        const s = useProjectStore.getState();
        s.recordWorkflowRun(run('r1', 'p1', 1000));
        s.clearWorkflowRuns('p1');
        expect(useProjectStore.getState().getWorkflowRuns('p1')).toHaveLength(0);
    });

    it('removes runs when the project is deleted', () => {
        const s = useProjectStore.getState();
        const { projectId } = s.createProject('Test', 'an idea');
        useProjectStore.getState().recordWorkflowRun(run('r1', projectId, 1000));
        expect(useProjectStore.getState().getWorkflowRuns(projectId)).toHaveLength(1);
        useProjectStore.getState().deleteProject(projectId);
        expect(useProjectStore.getState().getWorkflowRuns(projectId)).toHaveLength(0);
    });
});
