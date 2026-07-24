import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, SpineVersion, StructuredPRD } from '../../types';
import { useProjectStore } from '../../store/projectStore';
import { DecisionCenterContainer } from '../review/DecisionCenterContainer';

vi.mock('../review/DecisionCenter', () => ({
    DecisionCenter: ({
        initialSelectedId,
        onDecide,
        onAcceptRecommendations,
    }: {
        initialSelectedId?: string;
        onDecide?: unknown;
        onAcceptRecommendations?: unknown;
    }) => (
        <div
            data-testid="decision-center"
            data-selected-id={initialSelectedId}
            data-decide-handler={typeof onDecide}
            data-batch-handler={typeof onAcceptRecommendations}
        />
    ),
}));

const PROJECT_ID = 'decision-layer-project';
const structuredPRD: StructuredPRD = {
    productName: 'Signal Notes',
    vision: 'Help teams refine a product plan.',
    coreProblem: 'Important choices are hidden in prose.',
    targetUsers: ['Product teams'],
    architecture: 'A browser client backed by durable project state.',
    risks: [],
    constraints: [],
    features: [{
        id: 'feature-1',
        name: 'Decision review',
        description: 'Review planning decisions.',
        userValue: 'Make product calls explicit.',
        complexity: 'medium',
        priority: 'must',
        acceptanceCriteria: ['User decisions remain authoritative.'],
    }],
};
const project: Project = {
    id: PROJECT_ID,
    name: 'Signal Notes',
    createdAt: 1,
    platform: 'web',
};
const spine: SpineVersion = {
    id: 'spine-1',
    projectId: PROJECT_ID,
    promptText: 'Create Signal Notes',
    responseText: '# Signal Notes',
    structuredPRD,
    prdVersion: 2,
    createdAt: 1,
    isLatest: true,
    isFinal: false,
};

beforeEach(() => {
    useProjectStore.setState({
        projects: {},
        spineVersions: {},
        planningRecords: {},
    });
});

describe('DecisionCenterContainer selectors', () => {
    it('mounts independently from critique collections and forwards exact selection', () => {
        useProjectStore.setState({
            projects: { [PROJECT_ID]: project },
            spineVersions: { [PROJECT_ID]: [spine] },
        });

        render(
            <DecisionCenterContainer
                projectId={PROJECT_ID}
                initialRecordId="record-7"
            />,
        );

        expect(screen.getByTestId('decision-center')).toHaveAttribute(
            'data-selected-id',
            'record-7',
        );
        expect(screen.getByTestId('decision-center')).toHaveAttribute(
            'data-decide-handler',
            'function',
        );
        expect(screen.getByTestId('decision-center')).toHaveAttribute(
            'data-batch-handler',
            'function',
        );
    });

    it('fails to a readable message without a structured plan', () => {
        useProjectStore.setState({
            projects: { [PROJECT_ID]: project },
            spineVersions: { [PROJECT_ID]: [{ ...spine, structuredPRD: undefined }] },
        });

        render(<DecisionCenterContainer projectId={PROJECT_ID} />);

        expect(screen.getByText(/structured working plan is needed/i)).toBeInTheDocument();
    });
});
