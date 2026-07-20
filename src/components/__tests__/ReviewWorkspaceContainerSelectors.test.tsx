import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, SpineVersion, StructuredPRD } from '../../types';
import { useProjectStore } from '../../store/projectStore';
import { ReviewWorkspaceContainer } from '../review/ReviewWorkspaceContainer';

vi.mock('../review/ReviewWorkspace', () => ({
    ReviewWorkspace: ({ projectName, onReopenAssumptionOutcome }: { projectName: string; onReopenAssumptionOutcome?: (recordId: string, reason: string) => void }) => (
        <div data-testid="review-workspace" data-reopen-handler={typeof onReopenAssumptionOutcome}>{projectName}</div>
    ),
}));

const PROJECT_ID = 'phase-4-runtime-project';

const structuredPRD: StructuredPRD = {
    productName: 'Signal Notes',
    vision: 'Help product teams validate consequential planning assumptions.',
    coreProblem: 'Teams commit plans before testing the beliefs they depend on.',
    targetUsers: ['Product teams preparing an implementation-ready plan'],
    architecture: 'A browser client backed by durable project state.',
    risks: ['Weak evidence may be mistaken for validation.'],
    constraints: ['Generated interpretations remain advisory.'],
    features: [{
        id: 'f1',
        name: 'Assumption validation',
        description: 'Plan validation, record evidence, and preserve the user conclusion.',
        userValue: 'Reduce consequential uncertainty before implementation.',
        complexity: 'high',
        priority: 'must',
        acceptanceCriteria: ['User authority remains distinct from Synapse recommendations.'],
    }],
};

const project: Project = {
    id: PROJECT_ID,
    name: 'Signal Notes',
    createdAt: 1,
    platform: 'web',
};

const spine: SpineVersion = {
    id: 'spine-v1',
    projectId: PROJECT_ID,
    promptText: 'Validate planning assumptions',
    responseText: '# Signal Notes\n\nA plan for validating consequential assumptions.',
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
        artifacts: {},
        artifactVersions: {},
        reviewRuns: {},
        specialistRuns: {},
        reviewFindings: {},
        reviewIssues: {},
        planningRecords: {},
    });
});

describe('ReviewWorkspaceContainer project collection selectors', () => {
    it('mounts a structured project when its review and artifact collections are absent', () => {
        useProjectStore.setState({
            projects: { [PROJECT_ID]: project },
            spineVersions: { [PROJECT_ID]: [spine] },
        });

        expect(() => render(<ReviewWorkspaceContainer projectId={PROJECT_ID} critiqueUnlocked />)).not.toThrow();
        expect(screen.getByTestId('review-workspace')).toHaveTextContent('Signal Notes');
        expect(screen.getByTestId('review-workspace')).toHaveAttribute('data-reopen-handler', 'function');
    });

    it('mounts a real structured project when review collections are seeded', () => {
        useProjectStore.setState({
            projects: { [PROJECT_ID]: project },
            spineVersions: { [PROJECT_ID]: [spine] },
            artifacts: { [PROJECT_ID]: [] },
            artifactVersions: { [PROJECT_ID]: [] },
            reviewRuns: { [PROJECT_ID]: [] },
            specialistRuns: { [PROJECT_ID]: [] },
            reviewFindings: { [PROJECT_ID]: [] },
            reviewIssues: { [PROJECT_ID]: [] },
            planningRecords: { [PROJECT_ID]: [] },
        });

        expect(() => render(<ReviewWorkspaceContainer projectId={PROJECT_ID} critiqueUnlocked />)).not.toThrow();
        expect(screen.getByTestId('review-workspace')).toHaveTextContent('Signal Notes');
    });
});
