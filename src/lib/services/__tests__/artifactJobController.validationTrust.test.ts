import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StructuredPRD } from '../../../types';

const controls = vi.hoisted(() => ({
    blockedSubtypes: new Set<string>(),
}));

vi.mock('../coreArtifactService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../coreArtifactService')>()),
    generateCoreArtifact: vi.fn(async (subtype: string) => ({
        content: subtype === 'screen_inventory'
            ? JSON.stringify({
                sections: [{
                    title: 'Core',
                    screens: [{ name: 'Home', purpose: 'Start here' }],
                }],
            })
            : `${subtype} content`,
        metadata: {},
    })),
}));

vi.mock('../../artifactBlockingValidation', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../artifactBlockingValidation')>()),
    detectArtifactBlockers: vi.fn((subtype: string) => (
        controls.blockedSubtypes.has(subtype)
            ? [{
                code: 'prd_traceability_unverified',
                message: 'Traceability was not verified.',
            }]
            : []
    )),
}));

import {
    artifactValidationBlockerSetFingerprint,
    isArtifactVersionEligibleAsGenerationContext,
} from '../../artifactValidationPolicy';
import { artifactJobController } from '../artifactJobController';
import { generateCoreArtifact } from '../coreArtifactService';
import { useProjectStore } from '../../../store/projectStore';

const generateMock = vi.mocked(generateCoreArtifact);

const prd = (): StructuredPRD => ({
    vision: 'A vision',
    targetUsers: ['user'],
    coreProblem: 'problem',
    features: [{
        id: 'f1',
        name: 'Feature One',
        description: 'desc',
        userValue: 'value',
        complexity: 'low',
    }],
    architecture: 'arch',
    risks: ['risk'],
});

function seedProject() {
    const store = useProjectStore.getState();
    const { projectId, spineId } = store.createProject('P', 'idea');
    store.updateSpineStructuredPRD(projectId, spineId, prd(), 'md', {
        generationMeta: {
            passes: [],
            totalMs: 0,
            revised: false,
            schemaVersion: 1,
        },
    });
    return { projectId, spineId };
}

const args = (projectId: string, spineVersionId: string) => ({
    projectId,
    spineVersionId,
    prdContent: 'md',
    structuredPRD: prd(),
});

async function settle(projectId: string): Promise<void> {
    for (let i = 0; i < 500; i++) {
        await new Promise(resolve => setTimeout(resolve, 0));
        if (!artifactJobController.isActive(projectId)) {
            await new Promise(resolve => setTimeout(resolve, 0));
            if (!artifactJobController.isActive(projectId)) return;
        }
    }
    throw new Error('run did not settle');
}

beforeEach(() => {
    useProjectStore.setState({
        projects: {},
        spineVersions: {},
        historyEvents: {},
        branches: {},
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
        jobs: {},
    });
    localStorage.clear();
    controls.blockedSubtypes.clear();
    generateMock.mockClear();
});

describe('artifact job controller validation trust', () => {
    it('pins a needs-review transient slot to the exact generated version', async () => {
        const { projectId, spineId } = seedProject();
        controls.blockedSubtypes.add('data_model');

        artifactJobController.retrySlot('data_model', args(projectId, spineId));
        await settle(projectId);

        const artifact = useProjectStore.getState().getArtifacts(projectId, 'core_artifact')
            .find(candidate => candidate.subtype === 'data_model');
        const preferred = artifact
            ? useProjectStore.getState().getPreferredVersion(projectId, artifact.id)
            : undefined;
        expect(preferred).toBeDefined();
        expect(useProjectStore.getState().getSlot(projectId, 'data_model')).toMatchObject({
            status: 'needs_review',
            artifactVersionId: preferred?.id,
        });
    });

    it('uses an exactly accepted dependency without regenerating it', async () => {
        const { projectId, spineId } = seedProject();
        const store = useProjectStore.getState();
        const blocker = {
            code: 'prd_traceability_unverified' as const,
            message: 'Traceability was not verified.',
        };
        const { artifactId } = store.createArtifact(
            projectId,
            'core_artifact',
            'Screen Inventory',
            'screen_inventory',
        );
        const { versionId } = store.createArtifactVersion(
            projectId,
            artifactId,
            JSON.stringify({ sections: [{ title: 'Core', screens: [{ name: 'Home' }] }] }),
            { validationBlockers: [blocker] },
            [{
                id: 'spine-ref',
                sourceArtifactId: projectId,
                sourceArtifactVersionId: spineId,
                sourceType: 'spine',
            }],
            'Generate screen inventory',
        );
        store.acceptArtifactValidationIssue(projectId, {
            artifactId,
            versionId,
            expectedBlockerFingerprint: artifactValidationBlockerSetFingerprint([blocker]),
            rationale: 'The canonical appendix supplies this mapping.',
        });

        artifactJobController.retrySlot('user_flows', args(projectId, spineId));
        await settle(projectId);

        expect(generateMock.mock.calls.map(call => call[0])).not.toContain('screen_inventory');
        const call = generateMock.mock.calls.find(item => item[0] === 'user_flows');
        expect(call).toBeDefined();
        expect(call?.[3]?.generatedArtifacts?.screen_inventory).toContain('"Home"');
    });

    it('keeps unaccepted semantic and structural versions ineligible', () => {
        const base = {
            id: 'v1',
            artifactId: 'a1',
            versionNumber: 1,
            parentVersionId: null,
            content: 'content',
            sourceRefs: [],
            generationPrompt: 'prompt',
            isPreferred: true,
            createdAt: 1,
        };
        expect(isArtifactVersionEligibleAsGenerationContext({
            ...base,
            metadata: {
                validationBlockers: [{
                    code: 'prd_traceability_unverified',
                    message: 'Traceability was not verified.',
                }],
            },
        })).toBe(false);
        expect(isArtifactVersionEligibleAsGenerationContext({
            ...base,
            metadata: {
                validationBlockers: [{
                    code: 'output_structure_incomplete',
                    message: 'No screens were produced.',
                }],
            },
        })).toBe(false);
    });
});
