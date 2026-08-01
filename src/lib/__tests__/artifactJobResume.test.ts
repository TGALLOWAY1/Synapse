import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { artifactJobController } from '../services/artifactJobController';
import { useProjectStore } from '../../store/projectStore';
import { visibleCoreSubtypes } from '../coreArtifactPipeline';
import type { Artifact, ArtifactVersion, CoreArtifactSubtype, StructuredPRD } from '../../types';

// W4 (docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md): unhiding `component_inventory`
// changes auto-resume. While it was hidden, `resumeIfNeeded` deliberately never
// woke for it — the user had no row to see or retry it, so an errored hidden slot
// would have been retried invisibly on every workspace remount. Now that the slot
// is visible (status + Retry live in the Screens view's Components section), it
// SHOULD auto-resume like any other pending output. These tests pin both halves:
// the new wake behavior, and the "nothing pending → no run" control.

const projectId = 'project-resume';
const spineId = 'spine-1';
const structuredPRD = { productName: 'Resume' } as StructuredPRD;

const args = {
    projectId,
    spineVersionId: spineId,
    prdContent: 'PRD',
    structuredPRD,
};

const artifactFor = (subtype: CoreArtifactSubtype): Artifact => ({
    id: `art-${subtype}`,
    projectId,
    type: 'core_artifact',
    subtype,
    title: subtype,
    status: 'active',
    currentVersionId: `ver-${subtype}`,
    createdAt: 1,
    updatedAt: 1,
});

const versionFor = (subtype: CoreArtifactSubtype): ArtifactVersion => ({
    id: `ver-${subtype}`,
    artifactId: `art-${subtype}`,
    versionNumber: 1,
    parentVersionId: null,
    content: `${subtype} content`,
    metadata: {},
    sourceRefs: [{
        id: `ref-${subtype}`,
        sourceArtifactId: projectId,
        sourceArtifactVersionId: spineId,
        sourceType: 'spine',
    }],
    generationPrompt: 'prompt',
    isPreferred: true,
    createdAt: 1,
});

const mockupArtifact: Artifact = {
    id: 'art-mockup',
    projectId,
    type: 'mockup',
    title: 'Mockups',
    status: 'active',
    currentVersionId: 'ver-mockup',
    createdAt: 1,
    updatedAt: 1,
};

const mockupVersion: ArtifactVersion = {
    id: 'ver-mockup',
    artifactId: 'art-mockup',
    versionNumber: 1,
    parentVersionId: null,
    content: '{}',
    metadata: {},
    sourceRefs: [{
        id: 'ref-mockup',
        sourceArtifactId: projectId,
        sourceArtifactVersionId: spineId,
        sourceType: 'spine',
    }],
    generationPrompt: 'prompt',
    isPreferred: true,
    createdAt: 1,
};

/** Seed the store with every visible core slot done for the spine except `missing`. */
function seedStore(missing: CoreArtifactSubtype[]): void {
    const done = visibleCoreSubtypes().filter(subtype => !missing.includes(subtype));
    useProjectStore.setState({
        projects: {
            [projectId]: { id: projectId, name: 'Resume', createdAt: 1, designSystemPreset: 'minimal' },
        },
        spineVersions: {
            [projectId]: [{
                id: spineId,
                projectId,
                promptText: 'idea',
                responseText: 'PRD',
                createdAt: 1,
                isLatest: true,
                isFinal: true,
                structuredPRD,
            }],
        },
        artifacts: { [projectId]: [...done.map(artifactFor), mockupArtifact] },
        artifactVersions: { [projectId]: [...done.map(versionFor), mockupVersion] },
        jobs: {},
    });
}

const realStartAll = artifactJobController.startAll;
let startAll: ReturnType<typeof vi.fn>;

beforeEach(() => {
    startAll = vi.fn();
    artifactJobController.startAll = startAll as unknown as typeof realStartAll;
});

afterEach(() => {
    artifactJobController.startAll = realStartAll;
});

describe('artifactJobController.resumeIfNeeded — component_inventory is no longer hidden', () => {
    it('auto-wakes a run for a pending component_inventory slot', () => {
        // Previously this slot was hidden, so `pending` filtered it out and the
        // errored/missing inventory stayed pending forever — silently degrading
        // every mockup generated afterwards.
        seedStore(['component_inventory']);

        artifactJobController.resumeIfNeeded(args);

        expect(startAll).toHaveBeenCalledTimes(1);
        expect(startAll).toHaveBeenCalledWith(args);
    });

    it('does not wake a run when every visible slot is already done', () => {
        seedStore([]);

        artifactJobController.resumeIfNeeded(args);

        expect(startAll).not.toHaveBeenCalled();
    });

    it('still requires durable evidence that an output run had begun', () => {
        // Nothing generated for this spine at all → opening Explore/Build must
        // not silently start generating (auto-resume is recovery, not an entry
        // side effect).
        seedStore(visibleCoreSubtypes());
        useProjectStore.setState({
            artifacts: { [projectId]: [] },
            artifactVersions: { [projectId]: [] },
        });

        artifactJobController.resumeIfNeeded(args);

        expect(startAll).not.toHaveBeenCalled();
    });
});
