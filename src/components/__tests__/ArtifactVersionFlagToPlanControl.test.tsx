import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { artifactConcernPlanningSourceKey } from '../../lib/planning/flagToPlan';
import type { Artifact, ArtifactVersion } from '../../types';
import { useProjectStore } from '../../store/projectStore';
import { ArtifactVersionFlagToPlanControl } from '../planning/ArtifactVersionFlagToPlanControl';

const projectId = 'artifact-binding-project';
const spineVersionId = 'artifact-binding-spine';

const coreArtifact: Artifact = {
    id: 'artifact-data-model',
    projectId,
    type: 'core_artifact',
    subtype: 'data_model',
    title: 'Data Model',
    status: 'active',
    currentVersionId: 'version-data-model',
    createdAt: 1,
    updatedAt: 2,
};

const coreVersion: ArtifactVersion = {
    id: 'version-data-model',
    artifactId: coreArtifact.id,
    versionNumber: 2,
    parentVersionId: 'version-data-model-1',
    content: 'Current data model',
    metadata: {},
    sourceRefs: [],
    generationPrompt: 'Generate data model',
    isPreferred: true,
    createdAt: 2,
};

const mockupArtifact: Artifact = {
    id: 'artifact-mockup',
    projectId,
    type: 'mockup',
    title: 'Mockups',
    status: 'active',
    currentVersionId: 'version-mockup',
    createdAt: 1,
    updatedAt: 2,
};

const mockupVersion: ArtifactVersion = {
    id: 'version-mockup',
    artifactId: mockupArtifact.id,
    versionNumber: 1,
    parentVersionId: null,
    content: 'Current mockups',
    metadata: {},
    sourceRefs: [],
    generationPrompt: 'Generate mockups',
    isPreferred: true,
    createdAt: 2,
};

const prdArtifact: Artifact = {
    id: 'artifact-prd',
    projectId,
    type: 'prd',
    title: 'PRD',
    status: 'active',
    currentVersionId: null,
    createdAt: 1,
    updatedAt: 1,
};

function submitConcern(artifactTitle: string, title: string, statement: string) {
    fireEvent.click(screen.getByRole('button', {
        name: `Flag ${artifactTitle} to plan`,
    }));
    fireEvent.change(screen.getByLabelText('Concern title'), {
        target: { value: `  ${title}  ` },
    });
    fireEvent.change(screen.getByLabelText('What should the plan address?'), {
        target: { value: `  ${statement}  ` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add to plan' }));
}

beforeEach(() => {
    useProjectStore.setState({
        projects: {
            [projectId]: {
                id: projectId,
                name: 'Artifact binding',
                createdAt: 1,
            },
        },
        spineVersions: {
            [projectId]: [{
                id: spineVersionId,
                projectId,
                promptText: 'Current plan',
                responseText: 'Current plan',
                createdAt: 1,
                isLatest: true,
                isFinal: false,
            }],
        },
        artifacts: {
            [projectId]: [coreArtifact, mockupArtifact, prdArtifact],
        },
        artifactVersions: {
            [projectId]: [coreVersion, mockupVersion],
        },
        planningRecords: {},
    });
});

afterEach(() => {
    useProjectStore.setState({
        projects: {},
        spineVersions: {},
        artifacts: {},
        artifactVersions: {},
        planningRecords: {},
    });
});

describe('ArtifactVersionFlagToPlanControl', () => {
    it('binds a core artifact concern to the exact store provenance and return target', () => {
        const onOpenPlanningRecord = vi.fn();
        render(
            <ArtifactVersionFlagToPlanControl
                projectId={projectId}
                spineVersionId={spineVersionId}
                artifact={coreArtifact}
                preferred={coreVersion}
                canPersistWorkflowState
                onOpenPlanningRecord={onOpenPlanningRecord}
            />,
        );

        submitConcern(
            coreArtifact.title,
            'Ownership is unclear',
            'The owner relationship has no deletion rule.',
        );

        expect(onOpenPlanningRecord).not.toHaveBeenCalled();
        const record = useProjectStore.getState().planningRecords[projectId][0];
        const sourceKey = artifactConcernPlanningSourceKey({
            artifactId: coreArtifact.id,
            artifactVersionId: coreVersion.id,
            title: 'Ownership is unclear',
            statement: 'The owner relationship has no deletion rule.',
        });
        expect(record).toMatchObject({
            projectId,
            title: 'Ownership is unclear',
            statement: 'The owner relationship has no deletion rule.',
            materiality: 'normal',
            affectedArtifactSlots: ['data_model'],
            evidence: [{
                sourceType: 'artifact',
                sourceId: coreArtifact.id,
                sourceVersionId: coreVersion.id,
                artifactSubtype: 'data_model',
                locator: {
                    entityType: 'artifact',
                    entityId: coreArtifact.id,
                },
            }],
            sources: [{
                key: sourceKey,
                sourceType: 'artifact',
                sourceId: coreArtifact.id,
                sourceVersionId: coreVersion.id,
                artifactSubtype: 'data_model',
                locator: {
                    entityType: 'artifact',
                    entityId: coreArtifact.id,
                },
            }, {
                key: `prd:${spineVersionId}`,
                sourceType: 'prd',
                sourceId: 'prd',
                sourceVersionId: spineVersionId,
            }],
        });

        fireEvent.click(screen.getByRole('button', { name: 'Review now' }));
        expect(onOpenPlanningRecord).toHaveBeenCalledWith(record.id, {
            destination: {
                kind: 'artifact',
                artifactId: coreArtifact.id,
                nodeId: 'data_model',
            },
            label: 'Back to Data Model',
        });
    });

    it('derives the mockup slot without inventing a core subtype', () => {
        render(
            <ArtifactVersionFlagToPlanControl
                projectId={projectId}
                spineVersionId={spineVersionId}
                artifact={mockupArtifact}
                preferred={mockupVersion}
                canPersistWorkflowState
            />,
        );

        submitConcern(
            mockupArtifact.title,
            'Empty state needs hierarchy',
            'The empty state competes with the primary action.',
        );

        expect(useProjectStore.getState().planningRecords[projectId][0]).toMatchObject({
            affectedArtifactSlots: ['mockup'],
            evidence: [{
                sourceId: mockupArtifact.id,
                sourceVersionId: mockupVersion.id,
                artifactSubtype: undefined,
                locator: {
                    entityType: 'artifact',
                    entityId: mockupArtifact.id,
                },
            }],
        });
        expect(screen.queryByRole('button', { name: 'Review now' })).toBeNull();
    });

    it('renders no mutation control for read-only or non-generated artifact types', () => {
        const { container, rerender } = render(
            <ArtifactVersionFlagToPlanControl
                projectId={projectId}
                spineVersionId={spineVersionId}
                artifact={coreArtifact}
                preferred={coreVersion}
                canPersistWorkflowState={false}
            />,
        );
        expect(container).toBeEmptyDOMElement();

        rerender(
            <ArtifactVersionFlagToPlanControl
                projectId={projectId}
                spineVersionId={spineVersionId}
                artifact={prdArtifact}
                preferred={coreVersion}
                canPersistWorkflowState
            />,
        );
        expect(container).toBeEmptyDOMElement();

        rerender(
            <ArtifactVersionFlagToPlanControl
                projectId={projectId}
                spineVersionId={spineVersionId}
                artifact={coreArtifact}
                preferred={mockupVersion}
                canPersistWorkflowState
            />,
        );
        expect(container).toBeEmptyDOMElement();
    });
});
