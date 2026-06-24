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
