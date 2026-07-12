import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { GenerationMeta, SpineVersion, StructuredPRD } from '../../../types';

// --- Mocks --------------------------------------------------------------
// Keep the pure routing helpers (selectArtifactModel, CORE_ARTIFACT_COMPLEXITY
// re-exports) real; only stub the network-bound generateCoreArtifact.
vi.mock('../coreArtifactService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../coreArtifactService')>()),
    generateCoreArtifact: vi.fn(async (subtype: string) => ({
        content: `${subtype} content`,
        metadata: {},
    })),
}));

// The mockup slot builds a spec from upstream artifacts; stub it so the
// startAll path stays focused on which core slots generate.
vi.mock('../mockupService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../mockupService')>()),
    generateMockup: vi.fn(() => ({
        payload: { title: 'Mockup', screens: [] },
        warnings: [],
    })),
}));

// Controllable Gemini key gate. Keep every other export real (geminiClient
// imports getCachedGeminiKey from here).
vi.mock('../../geminiKeyVault', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../geminiKeyVault')>()),
    hasGeminiKey: vi.fn(() => true),
}));

// Force blocking validation off so every mocked slot settles `done` and can
// seed dependency context to later layers (otherwise generic mock content
// trips data_model/user_flows blockers and dependents never call generate).
vi.mock('../../artifactBlockingValidation', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../artifactBlockingValidation')>()),
    detectArtifactBlockers: vi.fn(() => []),
}));

import { artifactJobController } from '../artifactJobController';
import { generateCoreArtifact } from '../coreArtifactService';
import { hasGeminiKey } from '../../geminiKeyVault';
import { useProjectStore } from '../../../store/projectStore';
import { DEMO_PROJECT_ID } from '../../../data/demoProject';

const genMock = vi.mocked(generateCoreArtifact);
const keyMock = vi.mocked(hasGeminiKey);

// --- Helpers ------------------------------------------------------------
const prd = (): StructuredPRD => ({
    vision: 'A vision',
    targetUsers: ['user'],
    coreProblem: 'problem',
    features: [{ id: 'f1', name: 'Feature One', description: 'desc', userValue: 'value', complexity: 'low' }],
    architecture: 'arch',
    risks: ['risk'],
});

const completeMeta = (failedSections?: string[]): GenerationMeta => ({
    passes: [],
    totalMs: 0,
    revised: false,
    schemaVersion: 1,
    ...(failedSections ? { failedSections } : {}),
});

function resetStore(): void {
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
}

/**
 * Create a normal project whose latest spine is settled (generationPhase
 * 'complete') with a valid structuredPRD. Returns { projectId, spineId }.
 */
function seedCompleteProject(): { projectId: string; spineId: string } {
    const store = useProjectStore.getState();
    const { projectId, spineId } = store.createProject('P', 'idea');
    store.updateSpineStructuredPRD(projectId, spineId, prd(), 'md', {
        generationMeta: completeMeta(),
    });
    return { projectId, spineId };
}

/** Directly seed store state for a project whose id we control (demo/blocked). */
function seedRawProject(projectId: string, spine: Partial<SpineVersion>): string {
    const spineId = 'v1';
    useProjectStore.setState((s) => ({
        projects: { ...s.projects, [projectId]: { id: projectId, name: 'P', createdAt: Date.now() } },
        spineVersions: {
            ...s.spineVersions,
            [projectId]: [{
                id: spineId,
                projectId,
                promptText: 'idea',
                responseText: 'md',
                createdAt: Date.now(),
                isLatest: true,
                isFinal: false,
                generationPhase: 'complete',
                structuredPRD: prd(),
                ...spine,
            } as SpineVersion],
        },
    }));
    return spineId;
}

const args = (projectId: string, spineVersionId: string) => ({
    projectId,
    spineVersionId,
    prdContent: 'md',
    structuredPRD: prd(),
    projectPlatform: undefined,
});

/** Advance past a couple of microtask/macrotask turns. */
async function flush(): Promise<void> {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
}

/** Wait until the controller reports no active run for the project (stable). */
async function settle(projectId: string): Promise<void> {
    for (let i = 0; i < 500; i++) {
        await new Promise((r) => setTimeout(r, 0));
        if (!artifactJobController.isActive(projectId)) {
            await new Promise((r) => setTimeout(r, 0));
            if (!artifactJobController.isActive(projectId)) return;
        }
    }
    throw new Error('run did not settle');
}

const generatedSubtypes = (): string[] => genMock.mock.calls.map((c) => c[0] as string);

beforeEach(() => {
    resetStore();
    genMock.mockReset();
    genMock.mockImplementation(async (subtype: string) => ({
        content: `${subtype} content`,
        metadata: {},
    }));
    keyMock.mockReset();
    keyMock.mockReturnValue(true);
});

describe('ensureDesignSystemForSpine', () => {
    it('generates design_system and records the spine ref (so isSlotDoneForSpine is true after)', async () => {
        const { projectId, spineId } = seedCompleteProject();

        artifactJobController.ensureDesignSystemForSpine(args(projectId, spineId));
        await settle(projectId);

        expect(generatedSubtypes()).toEqual(['design_system']);

        // A design_system core artifact version now exists, referencing the spine.
        const store = useProjectStore.getState();
        const artifact = store.getArtifacts(projectId, 'core_artifact').find((a) => a.subtype === 'design_system');
        expect(artifact).toBeTruthy();
        const preferred = store.getPreferredVersion(projectId, artifact!.id);
        expect(preferred).toBeTruthy();
        expect(preferred!.sourceRefs.some(
            (r) => r.sourceType === 'spine' && r.sourceArtifactVersionId === spineId,
        )).toBe(true);
    });

    it('is a no-op on a second call once design_system is already done', async () => {
        const { projectId, spineId } = seedCompleteProject();

        artifactJobController.ensureDesignSystemForSpine(args(projectId, spineId));
        await settle(projectId);
        expect(genMock).toHaveBeenCalledTimes(1);

        artifactJobController.ensureDesignSystemForSpine(args(projectId, spineId));
        await settle(projectId);
        expect(genMock).toHaveBeenCalledTimes(1); // no second generation
    });

    it('skips the read-only demo project (capability gate)', async () => {
        const spineId = seedRawProject(DEMO_PROJECT_ID, {});

        artifactJobController.ensureDesignSystemForSpine(args(DEMO_PROJECT_ID, spineId));
        await Promise.resolve();

        expect(genMock).not.toHaveBeenCalled();
        expect(artifactJobController.isActive(DEMO_PROJECT_ID)).toBe(false);
    });

    it('skips a safety-blocked spine (generation gate)', async () => {
        const { projectId, spineId } = seedCompleteProject();
        useProjectStore.setState((s) => ({
            spineVersions: {
                ...s.spineVersions,
                [projectId]: s.spineVersions[projectId].map((sp) =>
                    sp.id === spineId ? { ...sp, safetyReview: { status: 'blocked' } } as SpineVersion : sp,
                ),
            },
        }));

        artifactJobController.ensureDesignSystemForSpine(args(projectId, spineId));
        await Promise.resolve();

        expect(genMock).not.toHaveBeenCalled();
        expect(artifactJobController.isActive(projectId)).toBe(false);
    });

    it('skips an incomplete, unacknowledged (non-final) PRD (generation gate)', async () => {
        const store = useProjectStore.getState();
        const { projectId, spineId } = store.createProject('P', 'idea');
        store.updateSpineStructuredPRD(projectId, spineId, prd(), 'md', {
            generationMeta: completeMeta(['product_overview']),
        });

        artifactJobController.ensureDesignSystemForSpine(args(projectId, spineId));
        await Promise.resolve();

        expect(genMock).not.toHaveBeenCalled();
        expect(artifactJobController.isActive(projectId)).toBe(false);
    });

    it('skips when no Gemini key is resolvable', async () => {
        const { projectId, spineId } = seedCompleteProject();
        keyMock.mockReturnValue(false);

        artifactJobController.ensureDesignSystemForSpine(args(projectId, spineId));
        await Promise.resolve();

        expect(genMock).not.toHaveBeenCalled();
        expect(artifactJobController.isActive(projectId)).toBe(false);
    });

    it('skips when a run is already active (never interleaves)', async () => {
        const { projectId, spineId } = seedCompleteProject();

        // Hold the first run open with a deferred design_system generation.
        let resolveDesign!: (v: { content: string; metadata: Record<string, unknown> }) => void;
        const deferred = new Promise<{ content: string; metadata: Record<string, unknown> }>((res) => {
            resolveDesign = res;
        });
        genMock.mockImplementation(async (subtype: string) => {
            if (subtype === 'design_system') return deferred;
            return { content: `${subtype} content`, metadata: {} };
        });

        artifactJobController.ensureDesignSystemForSpine(args(projectId, spineId));
        expect(artifactJobController.isActive(projectId)).toBe(true);
        await flush(); // let the (pending) design_system generation fire
        expect(genMock).toHaveBeenCalledTimes(1);

        // Second ensure while active → no-op.
        artifactJobController.ensureDesignSystemForSpine(args(projectId, spineId));
        await flush();
        expect(genMock).toHaveBeenCalledTimes(1);

        resolveDesign({ content: 'design_system content', metadata: {} });
        await settle(projectId);
        expect(genMock).toHaveBeenCalledTimes(1);
    });
});

describe('startAll interplay with an early design_system run', () => {
    it('does NOT regenerate design_system after a COMPLETED early run, but generates other slots', async () => {
        const { projectId, spineId } = seedCompleteProject();

        artifactJobController.ensureDesignSystemForSpine(args(projectId, spineId));
        await settle(projectId);
        expect(generatedSubtypes()).toEqual(['design_system']);
        genMock.mockClear();

        artifactJobController.startAll(args(projectId, spineId));
        await settle(projectId);

        const subtypes = generatedSubtypes();
        expect(subtypes).not.toContain('design_system'); // already done → skipped
        // Layer-1 (dependency-free) core slots still generate.
        expect(subtypes).toContain('screen_inventory');
        expect(subtypes).toContain('data_model');
    });

    it('chains startAll onto an IN-FLIGHT early run, then skips design_system', async () => {
        const { projectId, spineId } = seedCompleteProject();

        let resolveDesign!: (v: { content: string; metadata: Record<string, unknown> }) => void;
        const deferred = new Promise<{ content: string; metadata: Record<string, unknown> }>((res) => {
            resolveDesign = res;
        });
        genMock.mockImplementation(async (subtype: string) => {
            if (subtype === 'design_system') return deferred;
            return { content: `${subtype} content`, metadata: {} };
        });

        artifactJobController.ensureDesignSystemForSpine(args(projectId, spineId));
        expect(artifactJobController.isActive(projectId)).toBe(true);
        await flush(); // let the (pending) design_system generation fire
        expect(generatedSubtypes()).toEqual(['design_system']);

        // startAll while the single early run is in flight — returns immediately
        // without launching a full run yet.
        artifactJobController.startAll(args(projectId, spineId));
        await flush();
        expect(generatedSubtypes()).toEqual(['design_system']); // only the early call so far

        // Complete the early run → the chained startAll fires.
        resolveDesign({ content: 'design_system content', metadata: {} });
        await settle(projectId);

        const subtypes = generatedSubtypes();
        // design_system generated exactly once (the early run); the full run
        // skips it because it's already done for the spine.
        expect(subtypes.filter((s) => s === 'design_system')).toHaveLength(1);
        expect(subtypes).toContain('screen_inventory');
        expect(subtypes).toContain('data_model');
    });

    it('regenerates design_system on startAll after an early run FAILURE', async () => {
        const { projectId, spineId } = seedCompleteProject();

        genMock.mockImplementationOnce(async () => {
            throw new Error('boom');
        });

        artifactJobController.ensureDesignSystemForSpine(args(projectId, spineId));
        await settle(projectId);
        // Early run attempted design_system and failed → no version saved.
        expect(generatedSubtypes()).toEqual(['design_system']);
        const store = useProjectStore.getState();
        expect(store.getArtifacts(projectId, 'core_artifact').some((a) => a.subtype === 'design_system')).toBe(false);
        genMock.mockClear();

        artifactJobController.startAll(args(projectId, spineId));
        await settle(projectId);

        expect(generatedSubtypes()).toContain('design_system'); // included again
    });
});
