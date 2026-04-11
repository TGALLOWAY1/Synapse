import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '../projectStore';

// Reset store state before each test
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

describe('projectStore', () => {
    describe('createProject', () => {
        it('creates a project with initial spine and history event', () => {
            const store = useProjectStore.getState();
            const { projectId } = store.createProject('Test Project', 'Build a todo app');

            const project = useProjectStore.getState().projects[projectId];
            expect(project).toBeDefined();
            expect(project.name).toBe('Test Project');

            const spines = useProjectStore.getState().spineVersions[projectId];
            expect(spines).toHaveLength(1);
            expect(spines[0].promptText).toBe('Build a todo app');
            expect(spines[0].responseText).toBe('Generating PRD...');
            expect(spines[0].isLatest).toBe(true);
            expect(spines[0].isFinal).toBe(false);

            const events = useProjectStore.getState().historyEvents[projectId];
            expect(events).toHaveLength(1);
            expect(events[0].type).toBe('Init');
        });
    });

    describe('getLatestSpine', () => {
        it('returns the latest spine version', () => {
            const { projectId } = useProjectStore.getState().createProject('Test', 'prompt');
            const spine = useProjectStore.getState().getLatestSpine(projectId);
            expect(spine).toBeDefined();
            expect(spine?.isLatest).toBe(true);
        });

        it('returns undefined for non-existent project', () => {
            const spine = useProjectStore.getState().getLatestSpine('nonexistent');
            expect(spine).toBeUndefined();
        });
    });

    describe('deleteProject', () => {
        it('removes project and all associated data', () => {
            const store = useProjectStore.getState();
            const { projectId } = store.createProject('Test', 'prompt');

            expect(useProjectStore.getState().projects[projectId]).toBeDefined();

            useProjectStore.getState().deleteProject(projectId);

            expect(useProjectStore.getState().projects[projectId]).toBeUndefined();
            expect(useProjectStore.getState().spineVersions[projectId]).toBeUndefined();
            expect(useProjectStore.getState().historyEvents[projectId]).toBeUndefined();
        });
    });

    describe('markSpineFinal', () => {
        it('marks a spine as final', () => {
            const store = useProjectStore.getState();
            const { projectId, spineId } = store.createProject('Test', 'prompt');

            useProjectStore.getState().markSpineFinal(projectId, spineId, true);

            const spines = useProjectStore.getState().spineVersions[projectId];
            const spine = spines.find(s => s.id === spineId);
            expect(spine?.isFinal).toBe(true);
        });

        it('can unmark a spine as final', () => {
            const store = useProjectStore.getState();
            const { projectId, spineId } = store.createProject('Test', 'prompt');

            useProjectStore.getState().markSpineFinal(projectId, spineId, true);
            useProjectStore.getState().markSpineFinal(projectId, spineId, false);

            const spines = useProjectStore.getState().spineVersions[projectId];
            const spine = spines.find(s => s.id === spineId);
            expect(spine?.isFinal).toBe(false);
        });
    });

    describe('updateSpineText', () => {
        it('updates spine response text', () => {
            const store = useProjectStore.getState();
            const { projectId, spineId } = store.createProject('Test', 'prompt');

            useProjectStore.getState().updateSpineText(projectId, spineId, 'Updated PRD content');

            const spines = useProjectStore.getState().spineVersions[projectId];
            const spine = spines.find(s => s.id === spineId);
            expect(spine?.responseText).toBe('Updated PRD content');
        });
    });

    describe('artifact CRUD', () => {
        it('creates and retrieves artifacts', () => {
            const store = useProjectStore.getState();
            const { projectId } = store.createProject('Test', 'prompt');

            const { artifactId } = useProjectStore.getState().createArtifact(
                projectId, 'core_artifact', 'Screen Inventory', 'screen_inventory'
            );

            const artifacts = useProjectStore.getState().getArtifacts(projectId, 'core_artifact');
            expect(artifacts).toHaveLength(1);
            expect(artifacts[0].title).toBe('Screen Inventory');

            const artifact = useProjectStore.getState().getArtifact(projectId, artifactId);
            expect(artifact?.subtype).toBe('screen_inventory');
        });

        it('creates artifact versions and tracks preferred version', () => {
            const store = useProjectStore.getState();
            const { projectId, spineId } = store.createProject('Test', 'prompt');

            const { artifactId } = useProjectStore.getState().createArtifact(
                projectId, 'core_artifact', 'Screen Inventory', 'screen_inventory'
            );

            useProjectStore.getState().createArtifactVersion(
                projectId, artifactId, '# Screen Inventory v1', {},
                [{ id: 'ref1', sourceArtifactId: projectId, sourceArtifactVersionId: spineId, sourceType: 'spine' }],
                'Generate screen inventory'
            );

            const versions = useProjectStore.getState().getArtifactVersions(projectId, artifactId);
            expect(versions).toHaveLength(1);
            expect(versions[0].versionNumber).toBe(1);
            expect(versions[0].isPreferred).toBe(true);

            // Create second version
            const { versionId: v2 } = useProjectStore.getState().createArtifactVersion(
                projectId, artifactId, '# Screen Inventory v2', {},
                [{ id: 'ref1', sourceArtifactId: projectId, sourceArtifactVersionId: spineId, sourceType: 'spine' }],
                'Regenerate screen inventory'
            );

            const allVersions = useProjectStore.getState().getArtifactVersions(projectId, artifactId);
            expect(allVersions).toHaveLength(2);

            // Latest version should be preferred
            const preferred = useProjectStore.getState().getPreferredVersion(projectId, artifactId);
            expect(preferred?.id).toBe(v2);
        });
    });

    describe('branches', () => {
        it('creates a branch from selected text', () => {
            const store = useProjectStore.getState();
            const { projectId, spineId } = store.createProject('Test', 'prompt');

            useProjectStore.getState().createBranch(
                projectId, spineId, 'selected text snippet', 'Clarify this section'
            );

            const branches = useProjectStore.getState().getBranchesForSpine(projectId, spineId);
            expect(branches).toHaveLength(1);
            expect(branches[0].anchorText).toBe('selected text snippet');
            expect(branches[0].status).toBe('active');
        });
    });
});
