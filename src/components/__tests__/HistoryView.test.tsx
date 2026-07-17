import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryEvent } from '../../types';
import { HistoryView } from '../HistoryView';

const state = vi.hoisted(() => ({ events: [] as HistoryEvent[] }));

vi.mock('../../store/projectStore', () => ({
    useProjectStore: () => ({
        getHistoryEvents: () => state.events,
        getSpineVersions: () => [],
        getProjectOutputAlignment: () => [],
        getProject: () => undefined,
        readinessReviews: {},
        readinessCommitmentEvents: {},
        planningRecords: {},
        reviewRuns: {},
        specialistRuns: {},
        reviewIssues: {},
        reviewFindings: {},
        artifacts: {},
        artifactVersions: {},
    }),
}));

describe('HistoryView', () => {
    beforeEach(() => {
        state.events = [];
    });

    it('describes history as changes to the plan, reasoning, and outputs', () => {
        render(<HistoryView projectId="project-1" />);

        expect(screen.getByText('No history yet')).toBeInTheDocument();
        expect(screen.getByText('Changes to the plan, its reasoning, and downstream outputs will appear here.')).toBeInTheDocument();
    });

    it('shows the exact event description without exposing its internal event type', () => {
        state.events = [{
            id: 'event-1',
            projectId: 'project-1',
            type: 'Edited',
            description: 'Clarified the primary user and intended outcome',
            createdAt: Date.UTC(2026, 6, 17, 12),
        }];

        render(<HistoryView projectId="project-1" />);

        expect(screen.getByText('Clarified the primary user and intended outcome')).toBeInTheDocument();
        expect(screen.queryByText('Edited')).not.toBeInTheDocument();
    });
});
