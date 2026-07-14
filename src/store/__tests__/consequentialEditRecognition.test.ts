import { beforeEach, describe, expect, it } from 'vitest';
import type { StructuredPRD } from '../../types';
import { buildDecisionImpact } from '../../lib/planning';
import { useProjectStore } from '../projectStore';

const prd = (overrides: Partial<StructuredPRD> = {}): StructuredPRD => ({
    vision: 'Help teams coordinate.',
    targetUsers: ['Enterprise administrators'],
    coreProblem: 'Work is fragmented.',
    features: [],
    architecture: 'Cloud web app.',
    risks: [],
    ...overrides,
});

beforeEach(() => {
    useProjectStore.setState({
        projects: {}, spineVersions: {}, historyEvents: {}, branches: {}, artifacts: {}, artifactVersions: {},
        feedbackItems: {}, planningRecords: {}, reviewRuns: {}, specialistRuns: {}, reviewFindings: {}, reviewIssues: {},
    });
    localStorage.clear();
});

describe('consequential edit integration', () => {
    it('atomically versions a direct edit and records its structured planning decision', () => {
        const store = useProjectStore.getState();
        const { projectId, spineId } = store.createProject('P', 'idea');
        store.updateSpineStructuredPRD(projectId, spineId, prd(), 'original');

        const result = store.editSpineStructuredPRD(projectId, spineId, prd({ targetUsers: ['Independent creators'] }));
        const record = useProjectStore.getState().planningRecords[projectId][0];

        expect(result.recognition).toMatchObject({ classification: 'meaning_changed', confidence: 'high' });
        expect(record).toMatchObject({
            createdBy: 'user', status: 'confirmed', resolution: 'Independent creators',
            resultingSpineVersionId: result.newSpineId,
        });

        const impact = buildDecisionImpact({
            projectId,
            record,
            baselineSpineVersionId: result.newSpineId,
            structuredPRD: prd({ targetUsers: ['Independent creators'] }),
            now: () => 100,
        });
        expect(impact.ok).toBe(true);
        if (!impact.ok) throw new Error(impact.reason);
        expect(impact.nextPrd).toBeUndefined();
        expect(impact.preview.alignmentProposals).toEqual(expect.arrayContaining([
            expect.objectContaining({
                target: expect.objectContaining({ jsonPath: '$.uxPages' }),
                operation: 'review',
                requiresInput: true,
            }),
        ]));
        expect(impact.preview.alignmentProposals).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ target: expect.objectContaining({ jsonPath: '$.targetUsers' }) }),
        ]));
    });

    it('does not create planning noise for a copy edit', () => {
        const store = useProjectStore.getState();
        const { projectId, spineId } = store.createProject('P', 'idea');
        store.updateSpineStructuredPRD(projectId, spineId, prd(), 'original');

        const result = store.editSpineStructuredPRD(projectId, spineId, prd({ vision: 'Help teams coordinate' }));

        expect(result.recognition?.classification).toBe('copy_edit');
        expect(useProjectStore.getState().planningRecords[projectId] ?? []).toHaveLength(0);
    });

    it('supports explicit opt-out for generated merges', () => {
        const store = useProjectStore.getState();
        const { projectId, spineId } = store.createProject('P', 'idea');
        store.updateSpineStructuredPRD(projectId, spineId, prd(), 'original');

        const result = store.editSpineStructuredPRD(
            projectId,
            spineId,
            prd({ targetUsers: ['Generated segment'] }),
            { recognizeConsequentialEdit: false },
        );

        expect(result.recognition).toBeUndefined();
        expect(useProjectStore.getState().planningRecords[projectId] ?? []).toHaveLength(0);
    });
});
