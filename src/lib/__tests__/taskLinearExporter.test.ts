import { describe, it, expect, vi } from 'vitest';
import {
    buildLinearIssueDescription,
    buildLinearIssueInput,
    exportTasksToLinear,
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

/**
 * A tiny Linear GraphQL fake. Routes by a substring in the query string so a
 * single fetch mock can answer the team-resolution, label-lookup, and
 * issueCreate calls.
 */
function makeLinearFetch(opts: {
    labels?: { id: string; name: string }[];
    onIssueCreate?: (variables: Record<string, unknown>) => unknown;
} = {}) {
    const calls: { query: string; variables: Record<string, unknown> }[] = [];
    const labels = opts.labels ?? [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
        const parsed = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
        calls.push(parsed);
        let data: unknown;
        if (parsed.query.includes('team(id:')) {
            data = { team: { labels: { nodes: labels } } };
        } else if (parsed.query.includes('issueCreate')) {
            data = opts.onIssueCreate
                ? opts.onIssueCreate(parsed.variables)
                : {
                    issueCreate: {
                        success: true,
                        issue: { id: 'iss-1', identifier: 'ENG-42', url: 'https://linear.app/acme/issue/ENG-42', title: 'x' },
                    },
                };
        } else {
            data = { teams: { nodes: [{ id: 'team-uuid', key: 'ENG', name: 'Engineering' }] } };
        }
        return { ok: true, json: async () => ({ data }) } as unknown as Response;
    });
    return { fetchImpl, calls };
}

describe('linearExporter.checkReady', () => {
    it('reports not ready without an API key', () => {
        // jsdom localStorage has no LINEAR_API_KEY set in this suite.
        expect(linearExporter.checkReady()).toMatch(/Linear API key/i);
    });
});

describe('exportTasksToLinear', () => {
    it('returns a fatalError when no token is supplied', async () => {
        const { fetchImpl } = makeLinearFetch();
        const result = await exportTasksToLinear([TASK], { target: 'linear' }, { fetchImpl, token: '' as unknown as string, teamId: 'team-uuid' });
        expect(result.fatalError).toMatch(/No Linear API key/i);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('creates an issue per task and returns identifier + url', async () => {
        const { fetchImpl, calls } = makeLinearFetch({
            labels: [{ id: 'lbl-1', name: 'frontend' }, { id: 'lbl-2', name: 'synapse' }],
        });
        const result = await exportTasksToLinear(
            [TASK],
            { target: 'linear', projectName: 'Acme' },
            { fetchImpl, token: 'lin_api_x', teamId: 'team-uuid' },
        );
        expect(result.target).toBe('linear');
        expect(result.failed).toHaveLength(0);
        expect(result.succeeded).toHaveLength(1);
        expect(result.succeeded[0].externalId).toBe('ENG-42');
        expect(result.succeeded[0].externalUrl).toContain('linear.app');

        // The issueCreate input mapped known labels to IDs and skipped the rest.
        const create = calls.find(c => c.query.includes('issueCreate'));
        const input = create?.variables.input as { teamId: string; priority: number; labelIds?: string[] };
        expect(input.teamId).toBe('team-uuid');
        expect(input.priority).toBe(3);
        // 'milestone-2' is unknown (skipped); 'synapse'→lbl-2, 'frontend'→lbl-1,
        // preserving the task's label order.
        expect(input.labelIds).toEqual(['lbl-2', 'lbl-1']);
    });

    it('warns about labels that do not exist on the team', async () => {
        const { fetchImpl } = makeLinearFetch({ labels: [{ id: 'lbl-1', name: 'frontend' }] });
        const result = await exportTasksToLinear(
            [TASK],
            { target: 'linear' },
            { fetchImpl, token: 'lin_api_x', teamId: 'team-uuid' },
        );
        expect(result.succeeded[0].warnings?.some(w => /Skipped labels/i.test(w))).toBe(true);
        expect(result.succeeded[0].warnings?.[0]).toMatch(/milestone-2|synapse/);
    });

    it('resolves the team automatically when none is configured', async () => {
        const { fetchImpl, calls } = makeLinearFetch();
        const result = await exportTasksToLinear(
            [TASK],
            { target: 'linear' },
            { fetchImpl, token: 'lin_api_x', teamId: null },
        );
        expect(result.succeeded).toHaveLength(1);
        // The team query ran, then issueCreate used the resolved uuid.
        expect(calls.some(c => c.query.includes('teams'))).toBe(true);
        const create = calls.find(c => c.query.includes('issueCreate'));
        expect((create?.variables.input as { teamId: string }).teamId).toBe('team-uuid');
    });

    it('records a failure when Linear reports the issue was not created', async () => {
        const { fetchImpl } = makeLinearFetch({
            onIssueCreate: () => ({ issueCreate: { success: false } }),
        });
        const result = await exportTasksToLinear(
            [TASK],
            { target: 'linear' },
            { fetchImpl, token: 'lin_api_x', teamId: 'team-uuid' },
        );
        expect(result.succeeded).toHaveLength(0);
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0].error).toMatch(/not created/i);
    });
});
