import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '../projectStore';

// Setup-stage design selection state on the project: new projects owe the
// setup step; choosing a preset (from any UI) or explicitly skipping settles
// it. Legacy projects are untouched.

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

describe('design setup project state', () => {
    it('stamps needsDesignSetup on newly created projects', () => {
        const { projectId } = useProjectStore.getState().createProject('Test', 'Build a music app');
        expect(useProjectStore.getState().projects[projectId].needsDesignSetup).toBe(true);
        expect(useProjectStore.getState().projects[projectId].designSystemPreset).toBeUndefined();
    });

    it('choosing a preset stores it and settles the setup step', () => {
        const { projectId } = useProjectStore.getState().createProject('Test', 'idea');
        useProjectStore.getState().setProjectDesignSystemPreset(projectId, 'creative_studio');
        const project = useProjectStore.getState().projects[projectId];
        expect(project.designSystemPreset).toBe('creative_studio');
        expect(project.needsDesignSetup).toBe(false);
    });

    it('markDesignSetupComplete skips the step without choosing a preset', () => {
        const { projectId } = useProjectStore.getState().createProject('Test', 'idea');
        useProjectStore.getState().markDesignSetupComplete(projectId);
        const project = useProjectStore.getState().projects[projectId];
        expect(project.needsDesignSetup).toBe(false);
        expect(project.designSystemPreset).toBeUndefined();
    });

    it('both actions are no-ops for unknown projects', () => {
        const before = useProjectStore.getState().projects;
        useProjectStore.getState().setProjectDesignSystemPreset('nope', 'custom');
        useProjectStore.getState().markDesignSetupComplete('nope');
        expect(useProjectStore.getState().projects).toEqual(before);
    });
});
