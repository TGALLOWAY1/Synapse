import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { useProjectStore } from '../../store/projectStore';
import { DependencyGraphView } from '../dependency/DependencyGraphView';
import type {
    Artifact, ArtifactVersion, SourceRef, SpineVersion, StructuredPRD,
} from '../../types';

// Store-driven render tests for the Dependency Graph view: fresh project
// (nothing generated), fully consistent project, and PRD-drift staleness.

const PROJECT_ID = 'proj-1';
const SPINE_V1 = 'spine-v1';
const SPINE_V2 = 'spine-v2';

const structuredPRD = { productName: 'Testly' } as unknown as StructuredPRD;

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

const spine = (id: string, isLatest: boolean): SpineVersion => ({
    id,
    projectId: PROJECT_ID,
    promptText: 'idea',
    responseText: 'prd text',
    createdAt: 100,
    isLatest,
    isFinal: isLatest,
});

const spineRef = (spineId: string): SourceRef => ({
    id: nextId('ref'),
    sourceArtifactId: PROJECT_ID,
    sourceArtifactVersionId: spineId,
    sourceType: 'spine',
});

function makeArtifact(
    subtype: string | undefined,
    type: Artifact['type'],
    spineId: string,
): { artifact: Artifact; version: ArtifactVersion } {
    const artifactId = nextId(`art-${subtype ?? type}`);
    const versionId = nextId('ver');
    return {
        artifact: {
            id: artifactId,
            projectId: PROJECT_ID,
            type,
            subtype: subtype as Artifact['subtype'],
            title: subtype ?? type,
            status: 'active',
            currentVersionId: versionId,
            createdAt: 200,
            updatedAt: 200,
        },
        version: {
            id: versionId,
            artifactId,
            versionNumber: 1,
            parentVersionId: null,
            content: '# content',
            metadata: {},
            sourceRefs: [spineRef(spineId)],
            generationPrompt: 'generate',
            isPreferred: true,
            createdAt: 300,
        },
    };
}

function seedStore(opts: { spines: SpineVersion[]; generated: boolean; artifactSpineId?: string }) {
    const artifacts: Artifact[] = [];
    const versions: ArtifactVersion[] = [];
    if (opts.generated) {
        const spineId = opts.artifactSpineId ?? SPINE_V1;
        for (const subtype of [
            'screen_inventory', 'user_flows', 'design_system', 'data_model', 'implementation_plan',
        ]) {
            const { artifact, version } = makeArtifact(subtype, 'core_artifact', spineId);
            artifacts.push(artifact);
            versions.push(version);
        }
        const mockup = makeArtifact(undefined, 'mockup', spineId);
        artifacts.push(mockup.artifact);
        versions.push(mockup.version);
    }
    useProjectStore.setState({
        projects: { [PROJECT_ID]: { id: PROJECT_ID, name: 'Test', createdAt: 1 } },
        spineVersions: { [PROJECT_ID]: opts.spines },
        artifacts: { [PROJECT_ID]: artifacts },
        artifactVersions: { [PROJECT_ID]: versions },
        jobs: {},
        tasks: {},
    });
}

const renderView = (onOpenSyncOutputs = vi.fn()) =>
    render(
        <DependencyGraphView
            projectId={PROJECT_ID}
            spineVersionId={SPINE_V1}
            prdContent="prd text"
            structuredPRD={structuredPRD}
            onOpenNode={() => {}}
            onOpenSyncOutputs={onOpenSyncOutputs}
        />,
    );

beforeEach(() => {
    idCounter = 0;
});

describe('DependencyGraphView', () => {
    it('fresh project: shows every output without turning the map into a batch generation queue', () => {
        seedStore({ spines: [spine(SPINE_V1, true)], generated: false });
        renderView();
        expect(screen.getByText('Dependency Graph')).toBeTruthy();
        // All visible nodes render.
        for (const title of [
            'PRD', 'Screen Inventory', 'User Flows', 'Design System', 'Data Model',
            'Implementation Plan', 'Mockups',
        ]) {
            expect(screen.getAllByText(title).length).toBeGreaterThan(0);
        }
        expect(screen.getAllByText('Not generated').length).toBeGreaterThan(0);
        expect(screen.getByText(/6 not generated/)).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Generate 6 outputs/i })).toBeNull();
    });

    it('consistent project: everything reads up to date with no batch update offer', () => {
        seedStore({ spines: [spine(SPINE_V1, true)], generated: true });
        renderView();
        expect(screen.getByText(/6 aligned/)).toBeTruthy();
        expect(screen.queryByText(/impacted$/)).toBeNull();
        expect(screen.queryByText('Update required')).toBeNull();
    });

    it('legacy PRD drift stays advisory and explains the uncertainty in the detail panel', () => {
        const onOpenSyncOutputs = vi.fn();
        seedStore({
            spines: [spine(SPINE_V1, false), spine(SPINE_V2, true)],
            generated: true,
            artifactSpineId: SPINE_V1,
        });
        renderView(onOpenSyncOutputs);
        expect(screen.getAllByText('Review recommended').length).toBeGreaterThan(0);
        expect(screen.getByText(/6 advisory/)).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Review 6 affected/i })).toBeNull();

        // Open the Data Model node → detail panel explains the PRD drift.
        fireEvent.click(screen.getAllByText('Data Model')[0]);
        expect(screen.getByText('Why review?')).toBeTruthy();
        expect(screen.getByText(/remains useful for exploration/)).toBeTruthy();
        expect(
            screen.getAllByText(/The PRD changed after this was generated/).length,
        ).toBeGreaterThan(0);
        // "Generated from PRD Version 1" metadata row.
        expect(screen.getByText('PRD Version 1')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Update this \+ downstream artifacts/i })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
        expect(screen.queryByRole('button', { name: /Confirm aligned/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /Update plan/i })).toBeNull();
        const syncButton = screen.getByRole('button', { name: /Sync outputs/i });
        fireEvent.click(syncButton);
        expect(onOpenSyncOutputs).toHaveBeenCalledTimes(1);
    });

    it('does not render an alignment-only Sync outputs trigger without an eligible surface', () => {
        seedStore({
            spines: [spine(SPINE_V1, false), spine(SPINE_V2, true)],
            generated: true,
            artifactSpineId: SPINE_V1,
        });
        render(
            <DependencyGraphView
                projectId={PROJECT_ID}
                spineVersionId={SPINE_V1}
                prdContent="prd text"
                structuredPRD={structuredPRD}
                onOpenNode={() => {}}
            />,
        );
        fireEvent.click(screen.getAllByText('Data Model')[0]);
        expect(screen.queryByRole('button', { name: /Sync outputs/i })).not.toBeInTheDocument();
    });

    it('offers Sync outputs for an aligned output that needs validation review', () => {
        const onOpenSyncOutputs = vi.fn();
        seedStore({ spines: [spine(SPINE_V1, true)], generated: true });
        useProjectStore.setState(state => ({
            artifactVersions: {
                ...state.artifactVersions,
                [PROJECT_ID]: state.artifactVersions[PROJECT_ID].map(version => {
                    const artifact = state.artifacts[PROJECT_ID].find(
                        candidate => candidate.id === version.artifactId,
                    );
                    return artifact?.subtype === 'data_model'
                        ? {
                            ...version,
                            metadata: {
                                ...version.metadata,
                                validationBlockers: [{
                                    code: 'prd_traceability_unverified',
                                    message: 'Traceability was not verified.',
                                }],
                            },
                        }
                        : version;
                }),
            },
        }));

        renderView(onOpenSyncOutputs);
        const nodeButton = screen.getAllByText('Data Model')[0].closest('button');
        expect(nodeButton).not.toBeNull();
        expect(within(nodeButton!).getByText('Needs validation review')).toBeInTheDocument();
        expect(within(nodeButton!).queryByText('Aligned')).not.toBeInTheDocument();
        fireEvent.click(nodeButton!);
        expect(screen.getAllByText('Needs validation review').length).toBeGreaterThan(0);
        const detailHeading = screen.getByRole('heading', { name: 'Data Model' });
        expect(within(detailHeading.parentElement!).getByText('Needs validation review'))
            .toBeInTheDocument();
        expect(within(detailHeading.parentElement!).queryByText('Aligned'))
            .not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Sync outputs/i }));
        expect(onOpenSyncOutputs).toHaveBeenCalledTimes(1);
    });

    it('impact view lists dependencies and downstream impacts for a selected artifact', () => {
        seedStore({ spines: [spine(SPINE_V1, true)], generated: true });
        renderView();
        fireEvent.click(screen.getByText('Impact View'));
        // Select the Screen Inventory chip in the selector row.
        fireEvent.click(screen.getAllByText('Screen Inventory')[0]);
        expect(screen.getByText('Direct dependencies')).toBeTruthy();
        expect(screen.getByText('Impacts downstream')).toBeTruthy();
        // Downstream of screen_inventory: user_flows, implementation_plan, mockup.
        expect(screen.getAllByText('User Flows').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Mockups').length).toBeGreaterThan(0);
    });
});
