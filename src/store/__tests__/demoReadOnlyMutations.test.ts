import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_PROJECT_ID } from '../../data/demoProject';
import { artifactJobController } from '../../lib/services/artifactJobController';
import type { StructuredPRD } from '../../types';
import { useProjectStore } from '../projectStore';

const projectId = DEMO_PROJECT_ID;
const spineId = 'demo-spine';
const artifactId = 'demo-artifact';
const versionId = 'demo-version';

const structuredPRD = { productName: 'Demo' } as StructuredPRD;

beforeEach(() => {
    useProjectStore.setState({
        projects: {
            [projectId]: { id: projectId, name: 'Demo', createdAt: 1, designSystemPreset: 'minimal' },
        },
        spineVersions: {
            [projectId]: [{
                id: spineId,
                projectId,
                promptText: 'Demo idea',
                responseText: 'Demo PRD',
                createdAt: 1,
                isLatest: true,
                isFinal: true,
                structuredPRD,
            }],
        },
        artifacts: {
            [projectId]: [{
                id: artifactId,
                projectId,
                type: 'core_artifact',
                subtype: 'screen_inventory',
                title: 'Screens',
                status: 'active',
                currentVersionId: versionId,
                createdAt: 1,
                updatedAt: 1,
            }],
        },
        artifactVersions: {
            [projectId]: [{
                id: versionId,
                artifactId,
                versionNumber: 1,
                parentVersionId: null,
                content: 'saved screen content',
                metadata: { screenEdits: {}, reviewStatus: 'draft' },
                sourceRefs: [],
                generationPrompt: 'demo',
                isPreferred: true,
                createdAt: 1,
            }],
        },
        historyEvents: { [projectId]: [] },
        branches: { [projectId]: [] },
        feedbackItems: { [projectId]: [] },
        tasks: { [projectId]: [] },
        workflowRuns: { [projectId]: [] },
        jobs: {},
        prdProgress: {},
        prdSectionStatus: {},
    });
});

describe('public demo mutation boundary', () => {
    it('rejects finality and PRD content changes without changing state', () => {
        const store = useProjectStore.getState();

        expect(() => store.markSpineFinal(projectId, spineId, false)).toThrow('read-only');
        expect(() => store.editSpineStructuredPRD(projectId, spineId, structuredPRD))
            .toThrow('read-only');
        expect(store.getLatestSpine(projectId)?.isFinal).toBe(true);
        expect(store.getSpineVersions(projectId)).toHaveLength(1);
    });

    it('rejects screen edits and review metadata changes', () => {
        const store = useProjectStore.getState();

        expect(() => store.updateArtifactVersionMetadata(
            projectId,
            artifactId,
            versionId,
            { screenEdits: { home: { name: 'Changed' } } },
        )).toThrow('read-only');
        expect(() => store.updateArtifactVersionMetadata(
            projectId,
            artifactId,
            versionId,
            { reviewStatus: 'accepted' },
        )).toThrow('read-only');
        expect(store.getPreferredVersion(projectId, artifactId)?.metadata).toEqual({
            screenEdits: {},
            reviewStatus: 'draft',
        });
    });

    it('rejects generation and regeneration before any job starts', () => {
        const args = {
            projectId,
            spineVersionId: spineId,
            prdContent: 'Demo PRD',
            structuredPRD,
        };

        expect(() => artifactJobController.startAll(args)).toThrow('read-only');
        expect(() => artifactJobController.retrySlot('screen_inventory', args)).toThrow('read-only');
        expect(useProjectStore.getState().getJob(projectId)).toBeUndefined();
    });

    it('rejects design-system and persisted workflow changes', () => {
        const store = useProjectStore.getState();

        expect(() => store.setProjectDesignSystemPreset(projectId, 'creative_studio')).toThrow('read-only');
        expect(() => store.saveTasks(projectId, artifactId, [])).toThrow('read-only');
        expect(useProjectStore.getState().projects[projectId].designSystemPreset).toBe('minimal');
    });

    it('keeps the same representative operations available to ordinary projects', () => {
        const store = useProjectStore.getState();
        const { projectId: editableId, spineId: editableSpineId } = store.createProject('Editable', 'Idea');

        expect(() => store.markSpineFinal(editableId, editableSpineId, true)).not.toThrow();
        expect(() => store.setProjectDesignSystemPreset(editableId, 'creative_studio')).not.toThrow();
        const { artifactId: editableArtifactId } = store.createArtifact(
            editableId,
            'core_artifact',
            'Screens',
            'screen_inventory',
        );
        expect(() => store.createArtifactVersion(
            editableId,
            editableArtifactId,
            'content',
            {},
            [],
            'prompt',
        )).not.toThrow();
        expect(useProjectStore.getState().getLatestSpine(editableId)?.isFinal).toBe(true);
    });
});
