import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    renderTaskMarkdown,
    renderTasksMarkdown,
    markdownExporter,
} from '../services/taskExport/markdownExporter';
import type { ImplementationTask } from '../../types/tasks';

vi.mock('../utils/downloadFile', () => ({
    downloadFile: vi.fn(),
}));

import { downloadFile } from '../utils/downloadFile';

const TASK: ImplementationTask = {
    id: 'm1-d1',
    title: 'Build /users endpoint',
    summary: 'From milestone "API Foundation". Deliverable: Build /users endpoint.',
    sourceArtifactId: 'art-1',
    sourceSectionId: 'milestone-1',
    priority: 'high',
    taskType: 'backend',
    estimatedComplexity: 'medium',
    acceptanceCriteria: [
        'Endpoint returns 200 for happy path.',
        'Endpoint returns documented 4xx codes.',
    ],
    implementationNotes: ['Technical approach: REST + Express.'],
    dependencies: ['M1'],
    suggestedLabels: ['milestone-1', 'synapse', 'backend'],
};

describe('renderTaskMarkdown', () => {
    it('emits checkbox-list acceptance criteria in the documented order', () => {
        const md = renderTaskMarkdown(TASK, 0);
        expect(md).toContain('## 1. Build /users endpoint');
        expect(md).toContain('**Type:** Backend');
        expect(md).toContain('**Priority:** High');
        expect(md).toContain('**Complexity:** Medium');
        expect(md).toContain('### Summary');
        expect(md).toContain('### Acceptance Criteria');
        expect(md).toMatch(/- \[ \] Endpoint returns 200 for happy path\./);
        expect(md).toContain('### Implementation Notes');
        expect(md).toContain('### Dependencies');
        expect(md).toContain('milestone-1, synapse, backend');
    });

    it('falls back to a placeholder criterion when the list is empty', () => {
        const md = renderTaskMarkdown({ ...TASK, acceptanceCriteria: [] }, 0);
        expect(md).toContain('- [ ] (no criteria captured');
    });
});

describe('renderTasksMarkdown', () => {
    it('renders a top-level heading with project name and a per-task section', () => {
        const md = renderTasksMarkdown([TASK, { ...TASK, id: 'm1-d2', title: 'Other task' }], 'Acme');
        expect(md.startsWith('# Implementation Tasks — Acme')).toBe(true);
        expect(md).toContain('2 tasks');
        expect(md).toContain('## 1. Build /users endpoint');
        expect(md).toContain('## 2. Other task');
    });
});

describe('markdownExporter', () => {
    beforeEach(() => {
        vi.mocked(downloadFile).mockReset();
    });

    it('always reports ready', () => {
        expect(markdownExporter.checkReady()).toBeNull();
    });

    it('triggers a download and reports per-task success', async () => {
        const result = await markdownExporter.exportTasks([TASK], { target: 'markdown', projectName: 'Acme' });
        expect(downloadFile).toHaveBeenCalledTimes(1);
        const [content, filename] = vi.mocked(downloadFile).mock.calls[0];
        expect(filename).toBe('acme-tasks.md');
        expect(content).toContain('## 1. Build /users endpoint');
        expect(result.target).toBe('markdown');
        expect(result.failed).toHaveLength(0);
        expect(result.succeeded.map(s => s.taskId)).toEqual(['m1-d1']);
    });

    it('surfaces a fatal error when downloadFile throws', async () => {
        vi.mocked(downloadFile).mockImplementationOnce(() => {
            throw new Error('boom');
        });
        const result = await markdownExporter.exportTasks([TASK], { target: 'markdown' });
        expect(result.fatalError).toContain('boom');
        expect(result.failed).toHaveLength(1);
        expect(result.succeeded).toHaveLength(0);
    });
});
