import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from '../projectStore';
import type { StructuredPRD } from '../../types';

const projectId = 'p-merge';
const spineId = 's-1';
const branchId = 'b-1';

const structuredPRD: StructuredPRD = {
    vision: 'A calm habit tracker.',
    targetUsers: ['Busy parents'],
    coreProblem: 'Habit apps punish missed days.',
    features: [],
    architecture: 'Local-first.',
    risks: [],
};

beforeEach(() => {
    useProjectStore.setState({
        projects: { [projectId]: { id: projectId, name: 'Merge test', createdAt: 1 } },
        spineVersions: {
            [projectId]: [{
                id: spineId,
                projectId,
                promptText: 'idea',
                responseText: '# Plan\nA calm habit tracker.',
                createdAt: 1,
                isLatest: true,
                isFinal: false,
                structuredPRD,
                prdVersion: 2,
                generationMeta: {
                    passes: [],
                    totalMs: 1000,
                    revised: false,
                    schemaVersion: 2,
                    failedSections: ['ux_loops'],
                },
                safetyReview: {
                    classification: 'allowed',
                    status: 'generated',
                    detectedConcerns: [],
                    userFacingReason: '',
                    safeAlternatives: [],
                    reviewedAt: 1,
                },
            }],
        },
        branches: {
            [projectId]: [{
                id: branchId,
                projectId,
                spineVersionId: spineId,
                anchorText: 'A calm habit tracker.',
                status: 'active',
                createdAt: 1,
                messages: [],
            }],
        },
        historyEvents: { [projectId]: [] },
    });
});

describe('mergeBranch', () => {
    it('stamps the structured PRD and schema version on a structured consolidation', () => {
        const updated = { ...structuredPRD, vision: 'A calm, forgiving habit tracker.' };
        const { newSpineId } = useProjectStore.getState()
            .mergeBranch(projectId, branchId, '# Plan\nA calm, forgiving habit tracker.', { structuredPRD: updated });

        const spines = useProjectStore.getState().spineVersions[projectId];
        const merged = spines.find(s => s.id === newSpineId)!;
        expect(merged.isLatest).toBe(true);
        expect(merged.structuredPRD).toEqual(updated);
        expect(merged.prdVersion).toBe(2);
        // The incomplete-PRD banner and generate-anyway gate read
        // generationMeta.failedSections — a merge must not hide them.
        expect(merged.generationMeta?.failedSections).toEqual(['ux_loops']);
        // The safety review still carries forward (it binds to the idea).
        expect(merged.safetyReview?.status).toBe('generated');
        expect(merged.provenance?.changeSource).toBe('branch_merge');
    });

    it('keeps legacy markdown merges markdown-only', () => {
        const { newSpineId } = useProjectStore.getState()
            .mergeBranch(projectId, branchId, '# Plan\nRewritten.');
        const merged = useProjectStore.getState().spineVersions[projectId].find(s => s.id === newSpineId)!;
        expect(merged.structuredPRD).toBeUndefined();
        expect(merged.responseText).toBe('# Plan\nRewritten.');
    });
});
