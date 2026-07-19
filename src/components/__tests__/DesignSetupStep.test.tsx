import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DesignSetupStep } from '../setup/DesignSetupStep';
import { useProjectStore } from '../../store/projectStore';
import { DESIGN_SYSTEM_PRESETS } from '../../lib/designSystemPresets';
import { getDefaultDesignPreset, setDefaultDesignPreset } from '../../lib/designPresetPreference';

// The setup-stage design selection step: shown while the PRD generates in the
// background. Verifies recommendation badging, default preselection,
// selection storage, default persistence, and the skip path.

const createProject = (): string =>
    useProjectStore.getState().createProject('Test', 'Build something').projectId;

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

describe('DesignSetupStep', () => {
    it('shows the preparing copy while the PRD generates, and every preset card', () => {
        render(
            <DesignSetupStep
                projectId={createProject()}
                recommendationText="a productivity tool"
                prdGenerating
            />,
        );
        expect(screen.getByText(/Synapse is preparing your PRD/i)).toBeTruthy();
        for (const preset of DESIGN_SYSTEM_PRESETS) {
            expect(screen.getByText(preset.label)).toBeTruthy();
        }
    });

    it('shows the ready copy once the PRD has finished', () => {
        render(
            <DesignSetupStep
                projectId={createProject()}
                recommendationText=""
                prdGenerating={false}
            />,
        );
        expect(screen.getByText(/Your working plan is drafted/i)).toBeTruthy();
    });

    it('recommends and preselects a preset from the project idea', () => {
        render(
            <DesignSetupStep
                projectId={createProject()}
                recommendationText="A music app for DJs to build playlists"
                prdGenerating
            />,
        );
        const recommendedCard = screen.getByText('Recommended').closest('button')!;
        expect(recommendedCard.textContent).toContain('Creative Studio');
        expect(recommendedCard.getAttribute('aria-pressed')).toBe('true');
    });

    it('preselects a saved default while still badging the recommendation', () => {
        setDefaultDesignPreset('developer_tool');
        render(
            <DesignSetupStep
                projectId={createProject()}
                recommendationText="A music app for DJs"
                prdGenerating
            />,
        );
        const defaultCard = screen.getByText('Your default').closest('button')!;
        expect(defaultCard.textContent).toContain('Developer / Technical');
        expect(defaultCard.getAttribute('aria-pressed')).toBe('true');
        // The recommendation stays visible but is not selected.
        const recommendedCard = screen.getByText('Recommended').closest('button')!;
        expect(recommendedCard.textContent).toContain('Creative Studio');
        expect(recommendedCard.getAttribute('aria-pressed')).toBe('false');
    });

    it('stores the chosen preset on the project without touching the saved default', () => {
        setDefaultDesignPreset('developer_tool');
        const projectId = createProject();
        render(
            <DesignSetupStep projectId={projectId} recommendationText="A music app" prdGenerating />,
        );
        // Pick a preset different from both default and recommendation.
        fireEvent.click(screen.getByText('Consumer Mobile').closest('button')!);
        fireEvent.click(screen.getByText(/Continue with Consumer Mobile/i));

        const project = useProjectStore.getState().projects[projectId];
        expect(project.designSystemPreset).toBe('consumer_mobile');
        expect(project.needsDesignSetup).toBe(false);
        // Default unchanged: the user did not tick the checkbox.
        expect(getDefaultDesignPreset()).toBe('developer_tool');
    });

    it('saves the choice as the future default when explicitly opted in', () => {
        const projectId = createProject();
        render(
            <DesignSetupStep projectId={projectId} recommendationText="" prdGenerating />,
        );
        fireEvent.click(screen.getByText('Minimal Editorial').closest('button')!);
        fireEvent.click(screen.getByLabelText(/Use this as my default/i));
        fireEvent.click(screen.getByText(/Continue with Minimal Editorial/i));

        expect(getDefaultDesignPreset()).toBe('editorial_learning');
        expect(useProjectStore.getState().projects[projectId].designSystemPreset)
            .toBe('editorial_learning');
    });

    it('"Decide later" dismisses the step without storing a preset', () => {
        const projectId = createProject();
        render(
            <DesignSetupStep projectId={projectId} recommendationText="" prdGenerating />,
        );
        fireEvent.click(screen.getByText('Decide later'));

        const project = useProjectStore.getState().projects[projectId];
        expect(project.needsDesignSetup).toBe(false);
        expect(project.designSystemPreset).toBeUndefined();
        expect(getDefaultDesignPreset()).toBeNull();
    });
});
