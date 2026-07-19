import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from '../../../store/projectStore';
import { hasAnyCompletedSlotForSpine } from '../artifactJobController';

beforeEach(() => {
    useProjectStore.setState({
        // The capability boundary treats a missing project as unavailable, so
        // durable writes need a real project record.
        projects: { p1: { id: 'p1', name: 'P', createdAt: 1 } as never },
        spineVersions: {},
        historyEvents: {},
        branches: {},
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
        jobs: {},
    });
});

describe('artifact generation resume evidence', () => {
    it('does not treat opening an empty output workspace as a started run', () => {
        expect(hasAnyCompletedSlotForSpine('p1', 's1')).toBe(false);
    });

    it('recognizes a completed output tied to the current spine', () => {
        const store = useProjectStore.getState();
        const { artifactId } = store.createArtifact('p1', 'core_artifact', 'Data Model', 'data_model');
        store.createArtifactVersion('p1', artifactId, 'entities', {}, [{
            id: 'source-1',
            sourceArtifactId: 's1',
            sourceArtifactVersionId: 's1',
            sourceType: 'spine',
        }], 'Generate data model');
        expect(hasAnyCompletedSlotForSpine('p1', 's1')).toBe(true);
        expect(hasAnyCompletedSlotForSpine('p1', 's2')).toBe(false);
    });
});
