import { describe, it, expect } from 'vitest';
import {
    buildLinearIssueDescription,
    buildLinearIssueInput,
    linearExporter,
} from '../services/taskExport/linearExporter';
import type { ImplementationTask } from '../../types/tasks';

const TASK: ImplementationTask = {
    id: 'm2-d1',
    title: 'Render login modal',
    summary: 'From milestone "Frontend Login Form". Deliverable: Render login modal.',
    sourceArtifactId: 'art-1',
    sourceSectionId: 'milestone-2',
    priority: 'medium',
    taskType: 'frontend',
    acceptanceCriteria: ['Modal opens on click of Sign In.', 'Modal validates email format inline.'],
    suggestedLabels: ['milestone-2', 'synapse', 'frontend'],
    dependencies: ['M1'],
};

describe('buildLinearIssueDescription', () => {
    it('contains a checkbox-formatted acceptance criteria block', () => {
        const desc = buildLinearIssueDescription(TASK, 'Acme');
        expect(desc).toContain('## Acceptance Criteria');
        expect(desc).toMatch(/- \[ \] Modal opens on click of Sign In\./);
        expect(desc).toContain('Implementation Plan · Acme · milestone-2');
    });
});

describe('buildLinearIssueInput', () => {
    it('translates priority strings to Linear priority numbers', () => {
        const input = buildLinearIssueInput(TASK, 'Acme', 'TEAM-123');
        expect(input.title).toBe('Render login modal');
        expect(input.priority).toBe(3); // medium
        expect(input.teamId).toBe('TEAM-123');
        expect(input.labels).toEqual(['milestone-2', 'synapse', 'frontend']);
        expect(input.description).toContain('## Acceptance Criteria');
    });

    it('omits priority when the task has none', () => {
        const noPriority: ImplementationTask = { ...TASK, priority: undefined };
        const input = buildLinearIssueInput(noPriority);
        expect(input.priority).toBeUndefined();
    });
});

describe('linearExporter (stub)', () => {
    it('always reports ready', () => {
        expect(linearExporter.checkReady()).toBeNull();
    });

    it('returns a mock-flagged result with one entry per task', async () => {
        const result = await linearExporter.exportTasks([TASK, { ...TASK, id: 'm2-d2', title: 'Other' }], { target: 'linear' });
        expect(result.mock).toBe(true);
        expect(result.target).toBe('linear');
        expect(result.succeeded).toHaveLength(2);
        expect(result.failed).toHaveLength(0);
        expect(result.succeeded[0].externalId).toBe('LIN-MOCK-001');
        expect(result.notes?.[0]).toMatch(/mocked/i);
    });
});
