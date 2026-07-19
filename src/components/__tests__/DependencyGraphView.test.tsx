import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

const renderView = () =>
    render(
        <DependencyGraphView
            projectId={PROJECT_ID}
            spineVersionId={SPINE_V1}
            prdContent="prd text"
            structuredPRD={structuredPRD}
            onOpenNode={() => {}}
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
        seedStore({
            spines: [spine(SPINE_V1, false), spine(SPINE_V2, true)],
            generated: true,
            artifactSpineId: SPINE_V1,
        });
        renderView();
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
