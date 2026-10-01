import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from '../projectStore';
import type { StructuredPRD } from '../../types';

beforeEach(() => {
    useProjectStore.setState({
        projects: {},
        spineVersions: {},
        historyEvents: {},
        branches: {},
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
    });
    localStorage.clear();
});

const prd = (vision: string): StructuredPRD => ({
    vision,
    targetUsers: ['PMs'],
    coreProblem: 'slow specs',
    features: [],
    architecture: 'SPA',
    risks: [],
});

const settledMeta = { passes: [], totalMs: 1, revised: false, schemaVersion: 2 };

const spines = (projectId: string) => useProjectStore.getState().spineVersions[projectId];
const events = (projectId: string) => useProjectStore.getState().historyEvents[projectId] ?? [];

/** A project whose first spine holds a settled PRD. */
function settledProject(vision = 'original') {
    const store = useProjectStore.getState();
    const { projectId } = store.createProject('P', 'idea');
    const v1 = spines(projectId)[0];
    store.updateSpineStructuredPRD(projectId, v1.id, prd(vision), 'md', { generationMeta: settledMeta });
    return { projectId, v1Id: v1.id };
}

describe('editSpineStructuredPRD — no-op edits append nothing', () => {
    it('skips a content-identical edit and reports it as unchanged', () => {
        const { projectId, v1Id } = settledProject();
        const before = useProjectStore.getState().spineVersions;
        const eventCount = events(projectId).length;

        const result = useProjectStore.getState().editSpineStructuredPRD(projectId, v1Id, prd('original'), {
            responseText: 'md',
            editSummary: 'Updated section: Vision',
        });

        expect(result).toEqual({ newSpineId: v1Id, unchanged: true });
        expect(useProjectStore.getState().spineVersions).toBe(before);
        expect(events(projectId)).toHaveLength(eventCount);
    });

    it('ignores surrounding whitespace and explicitly-undefined optional fields', () => {
        const { projectId, v1Id } = settledProject();
        const sameContent = { ...prd('  original \n'), executiveSummary: undefined };

        const result = useProjectStore.getState().editSpineStructuredPRD(projectId, v1Id, sameContent);

        expect(result.unchanged).toBe(true);
        expect(spines(projectId)).toHaveLength(1);
    });

    it('does not amend a coalescing decision edit when nothing changed', () => {
        const { projectId, v1Id } = settledProject();
        const store = useProjectStore.getState();
        store.editSpineStructuredPRD(projectId, v1Id, prd('decided'), {
            changeSource: 'decision_edit',
            editSummary: 'Confirmed assumption: A',
            decisionDelta: { confirmed: 1 },
        });
        const decided = spines(projectId).find(spine => spine.isLatest)!;

        const result = store.editSpineStructuredPRD(projectId, decided.id, prd('decided'), {
            changeSource: 'decision_edit',
            editSummary: 'Confirmed assumption: B',
            decisionDelta: { confirmed: 1 },
        });

        expect(result.unchanged).toBe(true);
        const latest = spines(projectId).find(spine => spine.isLatest)!;
        expect(latest.provenance?.decisionCounts).toEqual({ confirmed: 1, corrected: 0, reopened: 0 });
    });

    it('still appends a real change, and an identical PRD carrying generation-meta overrides', () => {
        const { projectId, v1Id } = settledProject();
        const store = useProjectStore.getState();

        const changed = store.editSpineStructuredPRD(projectId, v1Id, prd('edited'));
        expect(changed.unchanged).toBeUndefined();
        expect(spines(projectId)).toHaveLength(2);

        const withMeta = store.editSpineStructuredPRD(projectId, changed.newSpineId, prd('edited'), {
            meta: { generationMeta: { ...settledMeta, failedSections: [] } },
        });
        expect(withMeta.unchanged).toBeUndefined();
        expect(spines(projectId)).toHaveLength(3);
    });
});

describe('compareAndAppendStructuredPRD — never appends onto a running PRD', () => {
    it('refuses while the latest spine is still being generated, then applies once it settles', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const v1 = spines(projectId)[0];
        store.markSpineGenerationStarted(projectId, v1.id);
        // Sections have landed (structuredPRD present, no section in flight in
        // this tab's grid) but the run has not settled — e.g. the final
        // consistency-review pass is still running.
        store.updateSpineStructuredPRD(projectId, v1.id, prd('partial'), 'md');
        const before = useProjectStore.getState().spineVersions;

        const refused = store.compareAndAppendStructuredPRD(projectId, v1.id, prd('decision applied'));

        expect(refused).toEqual({
            status: 'stale',
            expectedLatestSpineId: v1.id,
            actualLatestSpineId: v1.id,
            reason: 'generation_running',
        });
        expect(useProjectStore.getState().spineVersions).toBe(before);

        store.updateSpineStructuredPRD(projectId, v1.id, prd('final'), 'md', { generationMeta: settledMeta });
        const applied = store.compareAndAppendStructuredPRD(projectId, v1.id, prd('decision applied'));
        expect(applied.status).toBe('applied');
        expect(spines(projectId)).toHaveLength(2);
    });
});
