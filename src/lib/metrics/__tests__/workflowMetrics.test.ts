import { describe, expect, it } from 'vitest';
import {
    actualRuntimeMs,
    averageConcurrency,
    criticalPathMs,
    maxConcurrency,
    parallelTimeSavedMs,
    sequentialEstimateMs,
    speedupRatio,
    successRate,
    type MetricNode,
} from '../workflowMetrics';

// Helper to build a node with run-relative timings.
const node = (id: string, start: number, end: number, deps: string[] = []): MetricNode => ({
    nodeId: id,
    startedAt: start,
    completedAt: end,
    durationMs: end - start,
    dependencyIds: deps,
});

describe('workflowMetrics', () => {
    describe('sequentialEstimateMs', () => {
        it('sums all node durations', () => {
            const nodes = [node('a', 0, 100), node('b', 0, 50), node('c', 0, 30)];
            expect(sequentialEstimateMs(nodes)).toBe(180);
        });
        it('is 0 for no nodes', () => {
            expect(sequentialEstimateMs([])).toBe(0);
        });
    });

    describe('actualRuntimeMs', () => {
        it('is max end minus min start', () => {
            // 3 nodes overlapping; span is 0..120.
            const nodes = [node('a', 0, 100), node('b', 20, 120), node('c', 10, 40)];
            expect(actualRuntimeMs(nodes)).toBe(120);
        });
        it('is 0 for no nodes', () => {
            expect(actualRuntimeMs([])).toBe(0);
        });
    });

    describe('parallelTimeSavedMs / speedupRatio', () => {
        it('computes saved time and ratio', () => {
            // Example from the prompt: 180s sequential, 72s actual → 2.5×, 108s saved.
            expect(parallelTimeSavedMs(180_000, 72_000)).toBe(108_000);
            expect(speedupRatio(180_000, 72_000)).toBe(2.5);
        });
        it('clamps negative savings to 0', () => {
            expect(parallelTimeSavedMs(50, 80)).toBe(0);
        });
        it('guards divide-by-zero', () => {
            expect(speedupRatio(100, 0)).toBe(100);
            expect(speedupRatio(0, 0)).toBe(1);
        });
    });

    describe('maxConcurrency', () => {
        it('finds the peak overlap from intervals', () => {
            // a: 0..100, b: 10..40, c: 20..30 → at t=25 all three overlap → 3.
            const nodes = [node('a', 0, 100), node('b', 10, 40), node('c', 20, 30)];
            expect(maxConcurrency(nodes)).toBe(3);
        });
        it('counts back-to-back (touching) intervals as non-overlapping', () => {
            const nodes = [node('a', 0, 50), node('b', 50, 100)];
            expect(maxConcurrency(nodes)).toBe(1);
        });
        it('is 1 for a single node and 0 for none', () => {
            expect(maxConcurrency([node('a', 0, 10)])).toBe(1);
            expect(maxConcurrency([])).toBe(0);
        });
    });

    describe('averageConcurrency', () => {
        it('is total node runtime over actual runtime', () => {
            // total node runtime 180, actual 100 → 1.8 average.
            expect(averageConcurrency(180, 100)).toBe(1.8);
        });
        it('is 0 when actual runtime is 0', () => {
            expect(averageConcurrency(180, 0)).toBe(0);
        });
    });

    describe('criticalPathMs', () => {
        it('follows the longest dependency chain weighted by duration', () => {
            // a(10) → b(20) → d(40) = 70; c(5) is a side branch.
            const nodes = [
                node('a', 0, 10),
                node('b', 0, 20, ['a']),
                node('c', 0, 5, ['a']),
                node('d', 0, 40, ['b', 'c']),
            ];
            // a + b + d = 10 + 20 + 40 = 70.
            expect(criticalPathMs(nodes)).toBe(70);
        });
        it('falls back to the longest single node when there are no deps', () => {
            const nodes = [node('a', 0, 30), node('b', 0, 80), node('c', 0, 10)];
            expect(criticalPathMs(nodes)).toBe(80);
        });
        it('ignores unknown dependency ids', () => {
            const nodes = [node('a', 0, 25, ['ghost'])];
            expect(criticalPathMs(nodes)).toBe(25);
        });
    });

    describe('successRate', () => {
        it('counts complete and partial as successful', () => {
            expect(successRate(['complete', 'partial', 'error', 'complete'])).toBe(0.75);
        });
        it('is 0 for no runs', () => {
            expect(successRate([])).toBe(0);
        });
    });
});
