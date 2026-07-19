import { describe, expect, it } from 'vitest';
import type { Artifact, ArtifactVersion, SpineVersion, StructuredPRD } from '../../../types';
import { deriveProjectOutputAlignment } from '../outputAlignment';

const prd = (overrides: Partial<StructuredPRD> = {}): StructuredPRD => ({
    vision: 'Help independent creators plan a launch',
    targetUsers: ['Independent creators'],
    coreProblem: 'Launch planning is fragmented',
    architecture: 'Web application',
    risks: ['Low adoption'],
    features: [
        {
            id: 'feature-collaboration',
            name: 'Shared workspaces',
            description: 'Invite collaborators',
            userValue: 'Coordinate a team',
            complexity: 'medium',
        },
    ],
    ...overrides,
});

const spine = (id: string, structuredPRD: StructuredPRD, isLatest: boolean): SpineVersion => ({
    id,
    projectId: 'p1',
    promptText: 'prompt',
    responseText: 'prd',
    createdAt: id === 's1' ? 100 : 200,
    isLatest,
    isFinal: false,
    structuredPRD,
});

const artifact = (id: string, subtype: Artifact['subtype']): Artifact => ({
    id,
    projectId: 'p1',
    type: 'core_artifact',
    subtype,
    title: subtype ?? id,
    status: 'active',
    currentVersionId: `${id}-v1`,
    createdAt: 100,
    updatedAt: 100,
});

const version = (
    artifactId: string,
    sourceSpineId: string | undefined,
    content = 'Output body',
    metadata: Record<string, unknown> = {},
    extraSourceRefs: ArtifactVersion['sourceRefs'] = [],
): ArtifactVersion => ({
    id: `${artifactId}-v1`,
    artifactId,
    versionNumber: 1,
    parentVersionId: null,
    content,
    metadata,
    sourceRefs: [...(sourceSpineId ? [{
        id: `ref-${artifactId}`,
        sourceArtifactId: 'p1',
        sourceArtifactVersionId: sourceSpineId,
        sourceType: 'spine' as const,
    }] : []), ...extraSourceRefs],
    generationPrompt: '',
    isPreferred: true,
    createdAt: 100,
});

describe('deriveProjectOutputAlignment', () => {
    it('keeps a current output aligned', () => {
        const a = artifact('data', 'data_model');
        const result = deriveProjectOutputAlignment({
            artifacts: [a],
            artifactVersions: [version(a.id, 's1')],
            spineVersions: [spine('s1', prd(), true)],
        });

        expect(result.outputs[0]).toMatchObject({
            state: 'aligned',
            confidence: 'definite',
            blocksBuildReadiness: false,
            usefulForExploration: true,
        });
    });

    it('treats a relevant plan change as possibly affected, not definitely invalid', () => {
        const a = artifact('data', 'data_model');
        const result = deriveProjectOutputAlignment({
            artifacts: [a],
            artifactVersions: [version(a.id, 's1')],
            spineVersions: [
                spine('s1', prd(), false),
                spine('s2', prd({ architecture: 'Local-first desktop application' }), true),
            ],
        });

        expect(result.outputs[0]).toMatchObject({
            state: 'possibly_affected',
            confidence: 'possible',
            blocksBuildReadiness: true,
        });
        expect(result.outputs[0].summary).toContain('Architecture changed');
    });

    it('treats a removed-scope text reference as possible impact rather than proof of contradiction', () => {
        const a = artifact('screens', 'screen_inventory');
        const result = deriveProjectOutputAlignment({
            artifacts: [a],
            artifactVersions: [version(a.id, 's1', 'Screen for Shared workspaces and invitations')],
            spineVersions: [
                spine('s1', prd(), false),
                spine('s2', prd({ features: [] }), true),
            ],
        });

        expect(result.outputs[0]).toMatchObject({
            state: 'possibly_affected',
            confidence: 'possible',
            blocksBuildReadiness: true,
        });
        expect(result.outputs[0].reasons[0]).toContain('Shared workspaces');
    });

    it('does not block an output when only unrelated plan sections changed', () => {
        const a = artifact('design', 'design_system');
        const result = deriveProjectOutputAlignment({
            artifacts: [a],
            artifactVersions: [version(a.id, 's1')],
            spineVersions: [
                spine('s1', prd(), false),
                spine('s2', prd({ risks: ['Low adoption', 'Seasonality'] }), true),
            ],
        });

        expect(result.outputs[0]).toMatchObject({
            state: 'possibly_affected',
            blocksBuildReadiness: false,
        });
        expect(result.outputs[0].summary).toContain('not in an area');
    });

    it('keeps legacy missing provenance advisory and useful for exploration', () => {
        const a = artifact('legacy', 'implementation_plan');
        const result = deriveProjectOutputAlignment({
            artifacts: [a],
            artifactVersions: [version(a.id, undefined)],
            spineVersions: [spine('s1', prd(), true)],
        });

        expect(result.outputs[0]).toMatchObject({
            state: 'possibly_affected',
            confidence: 'unknown',
            blocksBuildReadiness: false,
            usefulForExploration: true,
        });
    });

    it('does not flag a version-only change with identical structured content', () => {
        const a = artifact('flows', 'user_flows');
        const result = deriveProjectOutputAlignment({
            artifacts: [a],
            artifactVersions: [version(a.id, 's1')],
            spineVersions: [
                spine('s1', prd(), false),
                spine('s2', prd(), true),
            ],
        });

        expect(result.outputs[0]).toMatchObject({
            state: 'aligned',
            blocksBuildReadiness: false,
        });
    });

    it('keeps legacy PRD version drift advisory when semantic comparison is unavailable', () => {
        const a = artifact('legacy-data', 'data_model');
        const first = spine('s1', prd(), false);
        const latest = spine('s2', prd(), true);
        delete first.structuredPRD;
        delete latest.structuredPRD;
        const result = deriveProjectOutputAlignment({
            artifacts: [a],
            artifactVersions: [version(a.id, 's1')],
            spineVersions: [first, latest],
        });

        expect(result.outputs[0]).toMatchObject({
            state: 'possibly_affected',
            confidence: 'unknown',
            blocksBuildReadiness: false,
        });
    });

    it('treats a dependency version mismatch as possible until an actual contradiction is proven', () => {
        const screens = artifact('screens', 'screen_inventory');
        screens.currentVersionId = 'screens-v2';
        const flows = artifact('flows', 'user_flows');
        const screensV1 = version(screens.id, 's1');
        const screensV2: ArtifactVersion = {
            ...screensV1,
            id: 'screens-v2',
            versionNumber: 2,
            parentVersionId: screensV1.id,
            isPreferred: true,
            createdAt: 200,
        };
        screensV1.isPreferred = false;
        const flowsVersion = version(flows.id, 's1', 'The creator reviews a launch flow.', {}, [{
            id: 'screen-ref',
            sourceArtifactId: screens.id,
            sourceArtifactVersionId: screensV1.id,
            sourceType: 'core_artifact',
        }]);

        const result = deriveProjectOutputAlignment({
            artifacts: [screens, flows],
            artifactVersions: [screensV1, screensV2, flowsVersion],
            spineVersions: [spine('s1', prd(), true)],
        });
        const flowAlignment = result.outputs.find(output => output.nodeId === 'user_flows');

        expect(flowAlignment).toMatchObject({
            state: 'possibly_affected',
            confidence: 'possible',
            blocksBuildReadiness: false,
        });
    });
});
