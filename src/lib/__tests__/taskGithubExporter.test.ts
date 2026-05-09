import { describe, it, expect, vi } from 'vitest';
import {
    buildGithubIssueBody,
    buildGithubIssuePayload,
    exportTasksToGithub,
    parseRepo,
} from '../services/taskExport/githubExporter';
import type { ImplementationTask } from '../../types/tasks';

const TASK: ImplementationTask = {
    id: 'm1-d1',
    title: 'Build /users endpoint',
    summary: 'From milestone "API Foundation". Deliverable: Build /users endpoint.',
    sourceArtifactId: 'art-1',
    sourceSectionId: 'milestone-1',
    priority: 'high',
    taskType: 'backend',
    acceptanceCriteria: ['Endpoint returns 200 for happy path.'],
    implementationNotes: ['Technical approach: REST + Express.'],
    dependencies: ['M2'],
    suggestedLabels: ['milestone-1', 'synapse', 'backend'],
};

const SECOND_TASK: ImplementationTask = {
    ...TASK,
    id: 'm1-d2',
    title: 'Build /sessions endpoint',
};

const THIRD_TASK: ImplementationTask = {
    ...TASK,
    id: 'm1-d3',
    title: 'Build /admin endpoint',
};

describe('parseRepo', () => {
    it('accepts owner/repo strings', () => {
        expect(parseRepo('foo/bar')).toEqual({ owner: 'foo', repo: 'bar' });
    });
    it('accepts full GitHub URLs', () => {
        expect(parseRepo('https://github.com/foo/bar.git')).toEqual({ owner: 'foo', repo: 'bar' });
    });
    it('rejects malformed input', () => {
        expect(parseRepo('foo')).toBeNull();
        expect(parseRepo('')).toBeNull();
        expect(parseRepo(undefined)).toBeNull();
    });
});

describe('buildGithubIssueBody', () => {
    it('produces the documented section order', () => {
        const body = buildGithubIssueBody(TASK, 'Acme');
        const summaryIdx = body.indexOf('## Summary');
        const sourceIdx = body.indexOf('## Source');
        const criteriaIdx = body.indexOf('## Acceptance Criteria');
        const notesIdx = body.indexOf('## Implementation Notes');
        const depsIdx = body.indexOf('## Dependencies');
        expect(summaryIdx).toBeGreaterThanOrEqual(0);
        expect(summaryIdx).toBeLessThan(sourceIdx);
        expect(sourceIdx).toBeLessThan(criteriaIdx);
        expect(criteriaIdx).toBeLessThan(notesIdx);
        expect(notesIdx).toBeLessThan(depsIdx);
        expect(body).toContain('Implementation Plan · Acme · milestone-1');
        expect(body).toMatch(/- \[ \] Endpoint returns 200/);
    });
});

describe('buildGithubIssuePayload', () => {
    it('attaches title, body, and label list', () => {
        const payload = buildGithubIssuePayload(TASK, 'Acme');
        expect(payload.title).toBe('Build /users endpoint');
        expect(payload.labels).toEqual(['milestone-1', 'synapse', 'backend']);
        expect(payload.body).toContain('## Summary');
    });
});

function buildOkResponse(json: unknown): Response {
    return {
        ok: true,
        status: 201,
        json: async () => json,
        text: async () => JSON.stringify(json),
    } as unknown as Response;
}

function buildErrResponse(status: number, body: string): Response {
    return {
        ok: false,
        status,
        json: async () => ({}),
        text: async () => body,
    } as unknown as Response;
}

describe('exportTasksToGithub', () => {
    it('reports a fatal error when no token is configured', async () => {
        const result = await exportTasksToGithub([TASK], { target: 'github' }, {
            fetchImpl: vi.fn(),
            token: undefined,
            repo: { owner: 'a', repo: 'b' },
        });
        expect(result.fatalError).toContain('No GitHub token');
        expect(result.succeeded).toHaveLength(0);
    });

    it('reports a fatal error when no repo is configured', async () => {
        const result = await exportTasksToGithub([TASK], { target: 'github' }, {
            fetchImpl: vi.fn(),
            token: 'ghp_test',
            repo: undefined,
        });
        expect(result.fatalError).toContain('No GitHub repo');
    });

    it('creates one issue per task and reports per-task success', async () => {
        const fetchImpl = vi.fn()
            // Label fetch
            .mockResolvedValueOnce(buildOkResponse([{ name: 'milestone-1' }, { name: 'synapse' }, { name: 'backend' }]))
            // Issue creation
            .mockResolvedValueOnce(buildOkResponse({ html_url: 'https://github.com/o/r/issues/42', number: 42 }))
            .mockResolvedValueOnce(buildOkResponse({ html_url: 'https://github.com/o/r/issues/43', number: 43 }));
        const result = await exportTasksToGithub([TASK, SECOND_TASK], { target: 'github' }, {
            fetchImpl,
            token: 'ghp_test',
            repo: { owner: 'o', repo: 'r' },
        });
        expect(result.failed).toHaveLength(0);
        expect(result.succeeded).toHaveLength(2);
        expect(result.succeeded[0].externalId).toBe('#42');
        expect(result.succeeded[0].externalUrl).toBe('https://github.com/o/r/issues/42');
        // 1 label fetch + 2 creates
        expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it('surfaces partial failures without aborting the batch', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(buildOkResponse([{ name: 'milestone-1' }, { name: 'synapse' }, { name: 'backend' }]))
            .mockResolvedValueOnce(buildOkResponse({ html_url: 'https://github.com/o/r/issues/100', number: 100 }))
            .mockResolvedValueOnce(buildErrResponse(422, '{"message":"Validation failed"}'))
            .mockResolvedValueOnce(buildOkResponse({ html_url: 'https://github.com/o/r/issues/102', number: 102 }));
        const result = await exportTasksToGithub([TASK, SECOND_TASK, THIRD_TASK], { target: 'github' }, {
            fetchImpl,
            token: 'ghp_test',
            repo: { owner: 'o', repo: 'r' },
        });
        expect(result.succeeded).toHaveLength(2);
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0].taskId).toBe('m1-d2');
        expect(result.failed[0].error).toMatch(/422/);
    });

    it('warns about labels that do not exist on the repo and strips them from the request', async () => {
        const fetchImpl = vi.fn()
            // Only `synapse` exists.
            .mockResolvedValueOnce(buildOkResponse([{ name: 'synapse' }]))
            .mockResolvedValueOnce(buildOkResponse({ html_url: 'https://github.com/o/r/issues/9', number: 9 }));
        await exportTasksToGithub([TASK], { target: 'github' }, {
            fetchImpl,
            token: 'ghp_test',
            repo: { owner: 'o', repo: 'r' },
        });
        const issueCall = fetchImpl.mock.calls[1];
        const sentBody = JSON.parse((issueCall[1] as { body: string }).body);
        expect(sentBody.labels).toEqual(['synapse']);
    });
});
