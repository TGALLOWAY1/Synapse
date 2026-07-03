import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '../projectStore';
import type { GenerationMeta, StructuredPRD } from '../../types';

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

const prd: StructuredPRD = {
    vision: 'Match music to mood.',
    targetUsers: ['Commuters'],
    coreProblem: 'Slow music picking.',
    features: [
        { id: 'f1', name: 'Mood Capture', description: 'Capture a mood.', userValue: 'Speed', complexity: 'medium' },
    ],
    architecture: 'Local-first SPA.',
    risks: ['Quality'],
};

const meta: GenerationMeta = {
    passes: [],
    totalMs: 10,
    revised: false,
    schemaVersion: 2,
};

describe('updateSpineStructuredPRD — canonical spine attachment', () => {
    it('attaches a canonical spine on final settle (generationMeta present)', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('MoodTune', 'idea');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];

        store.updateSpineStructuredPRD(projectId, v1.id, prd, 'md', { generationMeta: meta, prdVersion: 2 });

        const spine = useProjectStore.getState().spineVersions[projectId][0];
        expect(spine.canonicalSpine).toBeDefined();
        expect(spine.canonicalSpine?.features.map(f => f.id)).toEqual(['f1']);
        // Product name defaults to the user-chosen project name.
        expect(spine.canonicalSpine?.identity.productName).toBe('MoodTune');
        expect(spine.canonicalSpine?.meta.sourceSpineVersionId).toBe(v1.id);
        expect(spine.canonicalSpine?.meta.sourcePrdVersion).toBe(2);
        expect(spine.canonicalSpine?.meta.validation.valid).toBe(true);
    });

    it('does NOT attach a spine on a partial (streaming) update without generationMeta', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('MoodTune', 'idea');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];

        store.updateSpineStructuredPRD(projectId, v1.id, prd, 'partial md');

        const spine = useProjectStore.getState().spineVersions[projectId][0];
        expect(spine.canonicalSpine).toBeUndefined();
    });
});
