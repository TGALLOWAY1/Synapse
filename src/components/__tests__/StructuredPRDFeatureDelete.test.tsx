import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useProjectStore } from '../../store/projectStore';
import { StructuredPRDView } from '../StructuredPRDView';
import { featureDetailAnchorId } from '../../lib/derive/implementationSummary';
import type { SpineVersion, StructuredPRD } from '../../types';

// mark.js walks real DOM ranges — irrelevant here and flaky in jsdom.
vi.mock('mark.js', () => ({
    default: class {
        mark() {}
        unmark() {}
    },
}));

const PROJECT_ID = 'p1';
const SPINE_ID = 'spine1';

const prd: StructuredPRD = {
    vision: 'v',
    targetUsers: ['Solo builders'],
    coreProblem: 'p',
    architecture: 'a',
    risks: [],
    features: [
        { id: 'f1', name: 'Quick Capture', description: 'd', userValue: 'v', complexity: 'low', tier: 'mvp' },
        { id: 'f2', name: 'Weekly Review', description: 'd', userValue: 'v', complexity: 'low', tier: 'v1' },
    ],
    successMetrics: [],
    assumptions: [],
};

const versions = () => useProjectStore.getState().spineVersions[PROJECT_ID];
const latestFeatureIds = () => versions()[versions().length - 1].structuredPRD!.features.map((f) => f.id);

beforeEach(() => {
    const spine: Partial<SpineVersion> = {
        id: SPINE_ID,
        projectId: PROJECT_ID,
        promptText: 'idea',
        responseText: 'md',
        structuredPRD: prd,
        isLatest: true,
        isFinal: false,
        createdAt: 1,
    };
    useProjectStore.setState({
        projects: { [PROJECT_ID]: { id: PROJECT_ID, name: 'Test', createdAt: 1 } },
        spineVersions: { [PROJECT_ID]: [spine as SpineVersion] },
        historyEvents: {},
        branches: {},
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
        planningRecords: {},
    });
    vi.stubGlobal(
        'matchMedia',
        vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    );
});

function openFeaturesAndClickDelete(featureId: string) {
    render(
        <StructuredPRDView projectId={PROJECT_ID} spineId={SPINE_ID} structuredPRD={prd} readOnly={false} />,
    );
    fireEvent.click(screen.getByRole('tab', { name: /Features/ }));
    const card = document.getElementById(featureDetailAnchorId(featureId))!;
    fireEvent.click(within(card).getByRole('button', { name: 'Delete feature' }));
}

describe('StructuredPRDView feature delete confirmation', () => {
    it('asks first, with the original copy, and removes nothing on Cancel', () => {
        openFeaturesAndClickDelete('f1');

        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('Delete feature "Quick Capture"?')).toBeTruthy();
        // Rendered into <body>, outside the feature card it was opened from.
        expect(document.getElementById(featureDetailAnchorId('f1'))!.querySelector('[role="dialog"]')).toBeNull();
        expect(versions()).toHaveLength(1);

        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(versions()).toHaveLength(1);
        expect(latestFeatureIds()).toEqual(['f1', 'f2']);
    });

    it('Escape cancels without deleting', () => {
        openFeaturesAndClickDelete('f1');

        fireEvent.keyDown(document.body, { key: 'Escape' });

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(latestFeatureIds()).toEqual(['f1', 'f2']);
    });

    it('removes the feature (as a new PRD version) only after the destructive confirm', () => {
        openFeaturesAndClickDelete('f1');

        const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' });
        expect(confirm.className).toContain('bg-red-600');
        fireEvent.click(confirm);

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(versions()).toHaveLength(2);
        expect(latestFeatureIds()).toEqual(['f2']);
    });
});
