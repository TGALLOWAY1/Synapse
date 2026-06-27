import { describe, expect, it } from 'vitest';
import { buildWorkflowRun, computeParallelGroups, type NodeObservation } from '../buildWorkflowRun';

const obs = (
    nodeId: string,
    start: number,
    end: number,
    extra: Partial<NodeObservation> = {},
): NodeObservation => ({
    nodeId,
    nodeName: nodeId,
    model: 'gemini-3-flash-preview',
    status: 'complete',
    startedAt: start,
    completedAt: end,
    ...extra,
});

describe('computeParallelGroups', () => {
    it('assigns topological wave levels', () => {
        const groups = computeParallelGroups([
            { nodeId: 'a' },
            { nodeId: 'b', dependencyIds: ['a'] },
            { nodeId: 'c', dependencyIds: ['a'] },
            { nodeId: 'd', dependencyIds: ['b', 'c'] },
        ]);
        expect(groups.get('a')).toBe(0);
        expect(groups.get('b')).toBe(1);
        expect(groups.get('c')).toBe(1);
        expect(groups.get('d')).toBe(2);
    });
});

describe('buildWorkflowRun', () => {
    it('aggregates timings, tokens, cost and concurrency', () => {
        const run = buildWorkflowRun({
            projectId: 'p1',
            projectName: 'Demo',
            workflowType: 'prd',
            startedAt: 1000,
            completedAt: 1120,
            nodes: [
                obs('a', 1000, 1040, { inputTokens: 100, outputTokens: 200 }),
                obs('b', 1040, 1120, { inputTokens: 50, outputTokens: 50, dependencyIds: ['a'] }),
                obs('c', 1040, 1100, { inputTokens: 10, outputTokens: 10, dependencyIds: ['a'] }),
            ],
        });

        expect(run.projectId).toBe('p1');
        expect(run.workflowType).toBe('prd');
        expect(run.nodeCount).toBe(3);
        expect(run.status).toBe('complete');
        // Sequential = 40 + 80 + 60 = 180; actual window = 120.
        expect(run.sequentialEstimateMs).toBe(180);
        expect(run.actualRuntimeMs).toBe(120);
        expect(run.parallelTimeSavedMs).toBe(60);
        // b and c overlap (both 1040..) → max concurrency 2.
        expect(run.maxConcurrency).toBe(2);
        expect(run.totalInputTokens).toBe(160);
        expect(run.totalOutputTokens).toBe(260);
        expect(run.totalTokens).toBe(420);
        expect(run.estimatedCost).toBeGreaterThan(0);
        // a is wave 0; b and c are wave 1 → 2 distinct groups.
        expect(run.parallelGroupCount).toBe(2);
    });

    it('marks a run partial when some nodes error and error when all error', () => {
        const partial = buildWorkflowRun({
            projectId: 'p1',
            workflowType: 'artifacts',
            nodes: [obs('a', 0, 10), obs('b', 0, 10, { status: 'error' })],
        });
        expect(partial.status).toBe('partial');
        expect(partial.failureCount).toBe(1);

        const allFailed = buildWorkflowRun({
            projectId: 'p1',
            workflowType: 'artifacts',
            nodes: [obs('a', 0, 10, { status: 'error' })],
        });
        expect(allFailed.status).toBe('error');
    });
});
