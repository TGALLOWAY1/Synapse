// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from '../projectStore';
import { DEMO_PROJECT_ID } from '../../data/demoProject';
import { evaluateSpineGenerationGate } from '../../lib/artifactGenerationGate';
import type { GenerationMeta, SpineVersion, StructuredPRD } from '../../types';

// The removed Finalize flow used to leave a durable incomplete-PRD
// acknowledgement behind (`isFinal`). Its replacement is the explicit
// "Generate anyway" record on the spine version (`incompleteAcknowledgedAt`):
// durable for that version, never inherited by a later one.

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

const meta = (failedSections: string[]): GenerationMeta => ({
    passes: [],
    totalMs: 0,
    revised: false,
    schemaVersion: 1,
    failedSections,
});

const spines = (projectId: string): SpineVersion[] => useProjectStore.getState().spineVersions[projectId];
const latest = (projectId: string): SpineVersion => spines(projectId).find(spine => spine.isLatest)!;

/** A settled PRD whose `failedSections` are non-empty. */
function seedIncompleteProject(failedSections = ['risks']): { projectId: string; spineId: string } {
    const store = useProjectStore.getState();
    const { projectId, spineId } = store.createProject('P', 'idea');
    store.updateSpineStructuredPRD(projectId, spineId, prd('v1'), 'v1 md', { generationMeta: meta(failedSections) });
    return { projectId, spineId };
}

describe('acknowledgeIncompleteSpine', () => {
    it('records the acknowledgement on the latest incomplete spine, and the gate honours it', () => {
        const { projectId, spineId } = seedIncompleteProject();
        expect(evaluateSpineGenerationGate(latest(projectId)).reason).toBe('incomplete_unacknowledged');

        useProjectStore.getState().acknowledgeIncompleteSpine(projectId, spineId);

        const spine = latest(projectId);
        expect(spine.incompleteAcknowledgedAt).toEqual(expect.any(Number));
        expect(spine.updatedAt).toBe(spine.incompleteAcknowledgedAt);
        expect(evaluateSpineGenerationGate(spine)).toMatchObject({ allowed: true, degraded: true });
    });

    it('keeps the first acknowledgement and is a no-op for complete, historical, or unknown spines', () => {
        const { projectId, spineId } = seedIncompleteProject();
        const store = useProjectStore.getState();
        store.acknowledgeIncompleteSpine(projectId, spineId);
        const first = latest(projectId).incompleteAcknowledgedAt;
        store.acknowledgeIncompleteSpine(projectId, spineId);
        expect(latest(projectId).incompleteAcknowledgedAt).toBe(first);

        // A complete version has nothing to acknowledge.
        const { projectId: completeId, spineId: completeSpine } = seedIncompleteProject([]);
        store.acknowledgeIncompleteSpine(completeId, completeSpine);
        expect(latest(completeId)).not.toHaveProperty('incompleteAcknowledgedAt');

        // A historical version cannot be acknowledged (it can never generate).
        store.editSpineStructuredPRD(projectId, spineId, prd('v2'), { responseText: 'v2 md' });
        const before = spines(projectId);
        store.acknowledgeIncompleteSpine(projectId, spineId);
        store.acknowledgeIncompleteSpine(projectId, 'no-such-spine');
        expect(spines(projectId)).toBe(before);
    });

    it('is refused for a read-only showcase project, leaving it untouched', () => {
        useProjectStore.setState({
            projects: { [DEMO_PROJECT_ID]: { id: DEMO_PROJECT_ID, name: 'Demo', createdAt: 1 } },
            spineVersions: {
                [DEMO_PROJECT_ID]: [{
                    id: 'demo-spine', projectId: DEMO_PROJECT_ID, promptText: 'idea', responseText: 'md',
                    createdAt: 1, isLatest: true, isFinal: false, structuredPRD: prd('demo'),
                    generationPhase: 'complete', generationMeta: meta(['risks']),
                }],
            },
        });
        const before = spines(DEMO_PROJECT_ID);
        expect(() => useProjectStore.getState().acknowledgeIncompleteSpine(DEMO_PROJECT_ID, 'demo-spine')).toThrow('read-only');
        expect(spines(DEMO_PROJECT_ID)).toBe(before);
    });
});

describe('a later spine version never inherits the acknowledgement', () => {
    it('an edit appends a version that needs its own acknowledgement', () => {
        const { projectId, spineId } = seedIncompleteProject();
        useProjectStore.getState().acknowledgeIncompleteSpine(projectId, spineId);

        useProjectStore.getState().editSpineStructuredPRD(projectId, spineId, prd('edited'), { responseText: 'edited md' });

        const edited = latest(projectId);
        expect(edited.id).not.toBe(spineId);
        expect(edited.generationMeta?.failedSections).toEqual(['risks']);
        expect(edited.incompleteAcknowledgedAt).toBeUndefined();
        expect(evaluateSpineGenerationGate(edited).reason).toBe('incomplete_unacknowledged');
        // The acknowledged version itself keeps its record.
        expect(spines(projectId).find(spine => spine.id === spineId)?.incompleteAcknowledgedAt).toEqual(expect.any(Number));
    });

    it('a section retry that leaves sections failed needs a new acknowledgement; one that completes the PRD does not', () => {
        const { projectId, spineId } = seedIncompleteProject(['risks', 'architecture']);
        const store = useProjectStore.getState();
        store.acknowledgeIncompleteSpine(projectId, spineId);

        const partial = store.compareAndAppendStructuredPRD(projectId, spineId, prd('retried risks'), {
            changeSource: 'ai_section_retry',
            meta: { generationMeta: meta(['architecture']) },
        });
        expect(partial.status).toBe('applied');
        const stillIncomplete = latest(projectId);
        expect(stillIncomplete.incompleteAcknowledgedAt).toBeUndefined();
        expect(evaluateSpineGenerationGate(stillIncomplete).reason).toBe('incomplete_unacknowledged');

        store.acknowledgeIncompleteSpine(projectId, stillIncomplete.id);
        store.compareAndAppendStructuredPRD(projectId, stillIncomplete.id, prd('retried architecture'), {
            changeSource: 'ai_section_retry',
            meta: { generationMeta: meta([]) },
        });
        const complete = latest(projectId);
        expect(complete.incompleteAcknowledgedAt).toBeUndefined();
        expect(evaluateSpineGenerationGate(complete)).toMatchObject({ allowed: true, degraded: false });
    });

    it('a restore of an acknowledged version appends an unacknowledged copy', () => {
        const { projectId, spineId } = seedIncompleteProject();
        const store = useProjectStore.getState();
        store.acknowledgeIncompleteSpine(projectId, spineId);
        store.editSpineStructuredPRD(projectId, spineId, prd('edited'), { responseText: 'edited md' });

        store.revertSpineToVersion(projectId, spineId);

        const restored = latest(projectId);
        expect(restored.provenance?.changeSource).toBe('revert');
        expect(restored.generationMeta?.failedSections).toEqual(['risks']);
        expect(restored.incompleteAcknowledgedAt).toBeUndefined();
        expect(evaluateSpineGenerationGate(restored).reason).toBe('incomplete_unacknowledged');
    });

    it('a branch merge and a regenerated draft build fresh versions without it', () => {
        const { projectId, spineId } = seedIncompleteProject();
        const store = useProjectStore.getState();
        store.acknowledgeIncompleteSpine(projectId, spineId);

        const { branchId } = store.createBranch(projectId, spineId, 'v1 md', 'tighten it');
        store.mergeBranch(projectId, branchId, 'merged md', { structuredPRD: prd('merged') });
        const merged = latest(projectId);
        expect(merged.provenance?.changeSource).toBe('branch_merge');
        expect(merged.incompleteAcknowledgedAt).toBeUndefined();

        store.regenerateSpine(projectId);
        expect(latest(projectId).incompleteAcknowledgedAt).toBeUndefined();
    });

    it('an in-place decision amend keeps it — the version did not change identity', () => {
        const { projectId, spineId } = seedIncompleteProject();
        const store = useProjectStore.getState();
        // The first decision edit appends; consecutive ones amend in place.
        store.editSpineStructuredPRD(projectId, spineId, prd('decided once'), { changeSource: 'decision_edit' });
        const decided = latest(projectId);
        store.acknowledgeIncompleteSpine(projectId, decided.id);

        store.editSpineStructuredPRD(projectId, decided.id, prd('decided twice'), { changeSource: 'decision_edit' });

        const amended = latest(projectId);
        expect(amended.id).toBe(decided.id);
        expect(amended.structuredPRD?.vision).toBe('decided twice');
        expect(amended.incompleteAcknowledgedAt).toEqual(expect.any(Number));
    });
});
