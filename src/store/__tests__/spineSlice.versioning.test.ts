import { describe, it, expect, beforeEach } from 'vitest';
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

describe('editSpineStructuredPRD', () => {
    it('appends a new version instead of mutating in place', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        store.updateSpineStructuredPRD(projectId, v1.id, prd('original'), 'original md');

        store.editSpineStructuredPRD(projectId, v1.id, prd('edited'), {
            responseText: 'edited md',
            editSummary: 'Updated section: Vision',
        });

        const spines = useProjectStore.getState().spineVersions[projectId];
        expect(spines).toHaveLength(2);
        // Original content still retrievable.
        const original = spines.find(s => s.id === v1.id)!;
        expect(original.structuredPRD?.vision).toBe('original');
        expect(original.isLatest).toBe(false);
        // New version is latest with the edit + provenance.
        const latest = spines.find(s => s.isLatest)!;
        expect(latest.id).not.toBe(v1.id);
        expect(latest.structuredPRD?.vision).toBe('edited');
        expect(latest.responseText).toBe('edited md');
        expect(latest.isFinal).toBe(false);
        expect(latest.provenance?.changeSource).toBe('user_edit');
        expect(latest.provenance?.editSummary).toBe('Updated section: Vision');
    });

    it('pushes an Edited history event', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        store.editSpineStructuredPRD(projectId, v1.id, prd('edited'), { editSummary: 'Edited feature: X' });

        const events = useProjectStore.getState().historyEvents[projectId];
        const edited = events.find(e => e.type === 'Edited')!;
        expect(edited).toBeDefined();
        expect(edited.description).toBe('Edited feature: X');
    });

    it('keeps positional version labels correct (only one isLatest)', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        store.editSpineStructuredPRD(projectId, v1.id, prd('e1'));
        const latest1 = useProjectStore.getState().spineVersions[projectId].find(s => s.isLatest)!;
        store.editSpineStructuredPRD(projectId, latest1.id, prd('e2'));

        const spines = useProjectStore.getState().spineVersions[projectId];
        expect(spines).toHaveLength(3);
        expect(spines.filter(s => s.isLatest)).toHaveLength(1);
    });

    it('carries generation meta overrides onto the new version (section retry)', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        store.editSpineStructuredPRD(projectId, v1.id, prd('retried'), {
            changeSource: 'ai_section_retry',
            editSummary: 'Regenerated section: Architecture',
            meta: { model: 'gemini-x' },
        });
        const latest = useProjectStore.getState().spineVersions[projectId].find(s => s.isLatest)!;
        expect(latest.provenance?.changeSource).toBe('ai_section_retry');
        expect(latest.model).toBe('gemini-x');
    });
});

describe('decision-edit coalescing', () => {
    // Seed a project whose latest spine is a settled, non-final version so the
    // first decision edit appends (starting a coalescable run).
    const seed = () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        store.updateSpineStructuredPRD(projectId, v1.id, prd('base'), 'base md');
        const latest = useProjectStore.getState().spineVersions[projectId].find(s => s.isLatest)!;
        return { projectId, latestId: latest.id };
    };

    it('first decision edit appends a new version with decisionCounts seeded', () => {
        const { projectId, latestId } = seed();
        const before = useProjectStore.getState().spineVersions[projectId].length;
        useProjectStore.getState().editSpineStructuredPRD(projectId, latestId, prd('d1'), {
            responseText: 'd1 md',
            changeSource: 'decision_edit',
            editSummary: 'Confirmed assumption: A',
            decisionDelta: { confirmed: 1 },
        });
        const spines = useProjectStore.getState().spineVersions[projectId];
        expect(spines).toHaveLength(before + 1);
        const latest = spines.find(s => s.isLatest)!;
        expect(latest.id).not.toBe(latestId);
        expect(latest.provenance?.changeSource).toBe('decision_edit');
        expect(latest.provenance?.editSummary).toBe('Confirmed assumption: A');
        expect(latest.provenance?.decisionCounts).toEqual({ confirmed: 1, corrected: 0, reopened: 0 });
    });

    it('second decision edit AMENDS in place (same id + createdAt, merged counts, aggregate summary)', () => {
        const { projectId, latestId } = seed();
        const store = () => useProjectStore.getState();
        store().editSpineStructuredPRD(projectId, latestId, prd('d1'), {
            responseText: 'd1 md',
            changeSource: 'decision_edit',
            editSummary: 'Confirmed assumption: A',
            decisionDelta: { confirmed: 1 },
        });
        const afterFirst = store().spineVersions[projectId];
        const firstEdit = afterFirst.find(s => s.isLatest)!;
        const lenAfterFirst = afterFirst.length;

        const ret = store().editSpineStructuredPRD(projectId, firstEdit.id, prd('d2'), {
            responseText: 'd2 md',
            changeSource: 'decision_edit',
            editSummary: 'Marked assumption incorrect: B',
            decisionDelta: { corrected: 1 },
        });

        const spines = store().spineVersions[projectId];
        expect(spines).toHaveLength(lenAfterFirst); // amended, not appended
        const latest = spines.find(s => s.isLatest)!;
        // Same version identity.
        expect(latest.id).toBe(firstEdit.id);
        expect(latest.createdAt).toBe(firstEdit.createdAt);
        // Content + counts updated; aggregate summary now.
        expect(latest.structuredPRD?.vision).toBe('d2');
        expect(latest.responseText).toBe('d2 md');
        expect(latest.provenance?.decisionCounts).toEqual({ confirmed: 1, corrected: 1, reopened: 0 });
        expect(latest.provenance?.editSummary).toBe('Confirmed 1 decision · corrected 1');
        // Return value is the amended (latest) id.
        expect(ret.newSpineId).toBe(firstEdit.id);
    });

    it('keeps exactly one Edited history event whose description is the aggregate', () => {
        const { projectId, latestId } = seed();
        const store = () => useProjectStore.getState();
        store().editSpineStructuredPRD(projectId, latestId, prd('d1'), {
            changeSource: 'decision_edit',
            editSummary: 'Confirmed assumption: A',
            decisionDelta: { confirmed: 1 },
        });
        const firstEdit = store().spineVersions[projectId].find(s => s.isLatest)!;
        store().editSpineStructuredPRD(projectId, firstEdit.id, prd('d2'), {
            changeSource: 'decision_edit',
            editSummary: 'Confirmed assumption: B',
            decisionDelta: { confirmed: 1 },
        });

        const events = store().historyEvents[projectId].filter(
            e => e.type === 'Edited' && e.spineVersionId === firstEdit.id,
        );
        expect(events).toHaveLength(1);
        expect(events[0].description).toBe('Confirmed 2 decisions');
    });

    it('an interposed user_edit breaks the coalesce chain (next decision edit appends)', () => {
        const { projectId, latestId } = seed();
        const store = () => useProjectStore.getState();
        store().editSpineStructuredPRD(projectId, latestId, prd('d1'), {
            changeSource: 'decision_edit',
            editSummary: 'Confirmed assumption: A',
            decisionDelta: { confirmed: 1 },
        });
        const decisionEdit = store().spineVersions[projectId].find(s => s.isLatest)!;
        // A normal user edit appends and changes provenance.changeSource.
        store().editSpineStructuredPRD(projectId, decisionEdit.id, prd('u1'), {
            changeSource: 'user_edit',
            editSummary: 'Updated section: Vision',
        });
        const userEdit = store().spineVersions[projectId].find(s => s.isLatest)!;
        const lenBefore = store().spineVersions[projectId].length;

        store().editSpineStructuredPRD(projectId, userEdit.id, prd('d2'), {
            changeSource: 'decision_edit',
            editSummary: 'Confirmed assumption: C',
            decisionDelta: { confirmed: 1 },
        });
        expect(store().spineVersions[projectId]).toHaveLength(lenBefore + 1); // appended
    });

    it('markSpineFinal on the latest breaks the chain (next decision edit appends)', () => {
        const { projectId, latestId } = seed();
        const store = () => useProjectStore.getState();
        store().editSpineStructuredPRD(projectId, latestId, prd('d1'), {
            changeSource: 'decision_edit',
            editSummary: 'Confirmed assumption: A',
            decisionDelta: { confirmed: 1 },
        });
        const decisionEdit = store().spineVersions[projectId].find(s => s.isLatest)!;
        store().markSpineFinal(projectId, decisionEdit.id, true);
        const lenBefore = store().spineVersions[projectId].length;

        store().editSpineStructuredPRD(projectId, decisionEdit.id, prd('d2'), {
            changeSource: 'decision_edit',
            editSummary: 'Confirmed assumption: B',
            decisionDelta: { confirmed: 1 },
        });
        expect(store().spineVersions[projectId]).toHaveLength(lenBefore + 1); // appended
    });

    it('editing a NON-latest spineId with decision_edit appends (never amends)', () => {
        const { projectId, latestId } = seed();
        const store = () => useProjectStore.getState();
        store().editSpineStructuredPRD(projectId, latestId, prd('d1'), {
            changeSource: 'decision_edit',
            editSummary: 'Confirmed assumption: A',
            decisionDelta: { confirmed: 1 },
        });
        // latestId is now NOT the latest — a decision edit against it must append.
        const lenBefore = store().spineVersions[projectId].length;
        store().editSpineStructuredPRD(projectId, latestId, prd('d2'), {
            changeSource: 'decision_edit',
            editSummary: 'Confirmed assumption: B',
            decisionDelta: { confirmed: 1 },
        });
        expect(store().spineVersions[projectId]).toHaveLength(lenBefore + 1);
    });
});

describe('revertSpineToVersion', () => {
    it('appends a new latest version cloning the source and preserves history', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        store.updateSpineStructuredPRD(projectId, v1.id, prd('v1 content'), 'v1 md');
        // Two edits → v2, v3.
        store.editSpineStructuredPRD(projectId, v1.id, prd('v2 content'));
        const v2 = useProjectStore.getState().spineVersions[projectId].find(s => s.isLatest)!;
        store.editSpineStructuredPRD(projectId, v2.id, prd('v3 content'));

        // Revert to v1.
        store.revertSpineToVersion(projectId, v1.id);

        const spines = useProjectStore.getState().spineVersions[projectId];
        expect(spines).toHaveLength(4);
        // v1 still exists.
        expect(spines.find(s => s.id === v1.id)).toBeDefined();
        const latest = spines.find(s => s.isLatest)!;
        expect(latest.structuredPRD?.vision).toBe('v1 content');
        expect(latest.responseText).toBe('v1 md');
        expect(latest.provenance?.changeSource).toBe('revert');
        expect(latest.provenance?.revertedFromVersionId).toBe(v1.id);
        expect(latest.isFinal).toBe(false);
    });

    it('pushes a Reverted history event', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        store.editSpineStructuredPRD(projectId, v1.id, prd('v2'));
        store.revertSpineToVersion(projectId, v1.id);
        const events = useProjectStore.getState().historyEvents[projectId];
        expect(events.some(e => e.type === 'Reverted')).toBe(true);
    });
});

describe('legacy spines without provenance', () => {
    it('edit works on a spine that has no provenance field', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        expect(v1.provenance).toBeUndefined();
        expect(() => store.editSpineStructuredPRD(projectId, v1.id, prd('x'))).not.toThrow();
    });
});
