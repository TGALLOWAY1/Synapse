import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetricsPage } from '../metrics/MetricsPage';
import { useProjectStore } from '../../store/projectStore';
import type { WorkflowRun } from '../../types';

const sampleRun = (over: Partial<WorkflowRun> = {}): WorkflowRun => ({
    id: 'run-1',
    projectId: 'p1',
    projectName: 'Recipe App',
    workflowType: 'prd',
    status: 'complete',
    startedAt: 1_700_000_000_000,
    completedAt: 1_700_000_072_000,
    actualRuntimeMs: 72_000,
    sequentialEstimateMs: 180_000,
    parallelTimeSavedMs: 108_000,
    speedupRatio: 2.5,
    maxConcurrency: 4,
    averageConcurrency: 2.4,
    criticalPathMs: 40_000,
    totalNodeRuntimeMs: 180_000,
    totalInputTokens: 1200,
    totalOutputTokens: 3400,
    totalTokens: 4600,
    estimatedCost: 0.0123,
    retryCount: 0,
    failureCount: 0,
    nodeCount: 6,
    parallelGroupCount: 3,
    nodes: [
        {
            id: 'n1', nodeId: 'product_basics', nodeName: 'Product Basics', model: 'gemini-3-flash-preview',
            provider: 'gemini', status: 'complete', dependencyIds: [], parallelGroupId: 0,
            startedAt: 1_700_000_000_000, completedAt: 1_700_000_008_000, durationMs: 8000,
            inputTokens: 200, outputTokens: 400, totalTokens: 600, estimatedCost: 0.001,
        },
    ],
    ...over,
});

const reset = (runs: Record<string, WorkflowRun[]>) =>
    useProjectStore.setState({ workflowRuns: runs });

describe('MetricsPage', () => {
    beforeEach(() => {
        reset({});
    });

    it('renders an empty state when no runs exist', () => {
        render(
            <MemoryRouter>
                <MetricsPage />
            </MemoryRouter>,
        );
        expect(screen.getByText(/No workflow runs recorded yet/i)).toBeInTheDocument();
    });

    it('renders overview + run row when runs exist', () => {
        reset({ p1: [sampleRun()] });
        render(
            <MemoryRouter>
                <MetricsPage />
            </MemoryRouter>,
        );
        // Overview headline + cards.
        expect(screen.getByText(/Workflows Run/i)).toBeInTheDocument();
        // Speedup shows up (overview headline and/or table).
        expect(screen.getAllByText(/2\.5×/).length).toBeGreaterThan(0);
        // The run's project name appears in the table.
        expect(screen.getByText('Recipe App')).toBeInTheDocument();
    });
});
