// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactSlotKey, CoreArtifactSubtype, GenerationMeta, StructuredPRD } from '../../../types';

// Only the network-bound generation is stubbed; the controller, store, slice
// projection, fingerprints, and freshness engine are real. Mirrors
// artifactJobController.runs.test.ts.
vi.mock('../coreArtifactService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../coreArtifactService')>()),
    generateCoreArtifact: vi.fn(async (subtype: string) => ({ content: `${subtype} content`, metadata: {} })),
}));
vi.mock('../mockupService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../mockupService')>()),
    generateMockup: vi.fn(() => ({ payload: { title: 'Mockup', screens: [] }, warnings: [] })),
}));
// Keep every mocked slot `done` (generic mock content would otherwise trip
// blocking validation and hold dependents back).
vi.mock('../../artifactBlockingValidation', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../artifactBlockingValidation')>()),
    detectArtifactBlockers: vi.fn(() => []),
}));
// A resolvable key, so the early design-system run's key gate never masks
// the currency check under test.
vi.mock('../../geminiKeyVault', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../geminiKeyVault')>()),
    hasGeminiKey: vi.fn(() => true),
}));

import { artifactJobController } from '../artifactJobController';
import { generateCoreArtifact } from '../coreArtifactService';
import { generateMockup } from '../mockupService';
import { useProjectStore } from '../../../store/projectStore';
import { setActiveProjectUser } from '../../../store/userScope';
import { evaluateProjectFreshness } from '../../artifactFreshness';
import {
    currentPrdInputHashesForSpine,
    dependencyContentHash,
    inputHashSchemeFor,
} from '../../artifactInputSlices';
import { visibleCoreSubtypes } from '../../coreArtifactPipeline';

const genMock = vi.mocked(generateCoreArtifact);
const mockupMock = vi.mocked(generateMockup);

const prd = (risks: string[] = ['risk']): StructuredPRD => ({
    productName: 'Fingerprint',
    vision: 'A vision',
    targetUsers: ['user'],
    coreProblem: 'problem',
    features: [{ id: 'f1', name: 'Feature One', description: 'desc', userValue: 'value', complexity: 'low' }],
    architecture: 'arch',
    risks,
});

const completeMeta = (): GenerationMeta => ({ passes: [], totalMs: 0, revised: false, schemaVersion: 1 });

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

function seedProject(): { projectId: string; spineId: string } {
    const store = useProjectStore.getState();
    const { projectId, spineId } = store.createProject('P', 'idea', 'web');
    store.setProjectDesignSystemPreset(projectId, 'saas_minimal');
    store.updateSpineStructuredPRD(projectId, spineId, prd(), 'md', { generationMeta: completeMeta() });
    return { projectId, spineId };
}

const latestSpine = (projectId: string) =>
    useProjectStore.getState().spineVersions[projectId].find(s => s.isLatest)!;

/** StartArgs exactly as the workspace builds them from the latest spine. */
const argsFor = (projectId: string) => {
    const spine = latestSpine(projectId);
    return {
        projectId,
        spineVersionId: spine.id,
        prdContent: spine.responseText,
        structuredPRD: spine.structuredPRD!,
        projectPlatform: useProjectStore.getState().projects[projectId].platform,
    };
};

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

const preferredFor = (projectId: string, slot: ArtifactSlotKey) => {
    const state = useProjectStore.getState();
    const artifact = (state.artifacts[projectId] ?? []).find(a =>
        slot === 'mockup' ? a.type === 'mockup' : a.subtype === slot);
    return artifact ? state.getPreferredVersion(projectId, artifact.id) : undefined;
};

const statusBySlot = (projectId: string) => {
    const { evaluations } = evaluateProjectFreshness(useProjectStore.getState(), projectId);
    return Object.fromEntries([...evaluations].filter(([id]) => id !== 'prd').map(([id, ev]) => [id, ev.status]));
};

const generatedSlots = (): string[] => [
    ...genMock.mock.calls.map(call => call[0]),
    ...(mockupMock.mock.calls.length > 0 ? ['mockup'] : []),
];

const OUTPUT_SLOTS: ArtifactSlotKey[] = [...visibleCoreSubtypes(), 'mockup'];

beforeEach(() => {
    resetStore();
    setActiveProjectUser(null);
    genMock.mockReset();
    genMock.mockImplementation(async (subtype: string) => ({ content: `${subtype} content`, metadata: {} }));
    mockupMock.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

describe('artifactJobController — generation stamps input fingerprints', () => {
    it('stamps every generated version with the fingerprint of exactly what it consumed', async () => {
        const { projectId } = seedProject();
        artifactJobController.startAll(argsFor(projectId));
        await settle(projectId);

        const spine = latestSpine(projectId);
        const project = useProjectStore.getState().projects[projectId];
        for (const slot of OUTPUT_SLOTS) {
            const version = preferredFor(projectId, slot)!;
            // changeSource keeps its generation default alongside the fingerprint.
            expect(version.provenance?.changeSource, slot).toBe('ai_generation');
            const recorded = version.provenance?.inputHashes;
            const current = currentPrdInputHashesForSpine(slot, spine, project)!;
            expect(recorded?.scheme, slot).toBe(inputHashSchemeFor(slot));
            expect(recorded?.spine, slot).toBe(current.spine);
            expect(recorded?.designBrief, slot).toBe(current.designBrief);
        }

        const content = (subtype: CoreArtifactSubtype) => dependencyContentHash(`${subtype} content`);
        expect(preferredFor(projectId, 'design_system')!.provenance?.inputHashes?.dependencies).toBeUndefined();
        expect(preferredFor(projectId, 'user_flows')!.provenance?.inputHashes?.dependencies)
            .toEqual({ screen_inventory: content('screen_inventory') });
        expect(preferredFor(projectId, 'implementation_plan')!.provenance?.inputHashes?.dependencies).toEqual({
            screen_inventory: content('screen_inventory'),
            data_model: content('data_model'),
            user_flows: content('user_flows'),
        });
        // The mockup read the screen and component inventories (and tracks the
        // design system by tokensHash on its source ref, not here).
        expect(preferredFor(projectId, 'mockup')!.provenance?.inputHashes?.dependencies).toEqual({
            screen_inventory: content('screen_inventory'),
            component_inventory: content('component_inventory'),
        });

        expect(Object.values(statusBySlot(projectId)).every(status => status === 'up_to_date')).toBe(true);
    });
});

describe('artifactJobController — fingerprint-current outputs', () => {
    it('a PRD restored to identical content leaves every output current — and starts nothing on Build entry', async () => {
        const { projectId, spineId } = seedProject();
        artifactJobController.startAll(argsFor(projectId));
        await settle(projectId);

        const store = useProjectStore.getState();
        store.editSpineStructuredPRD(projectId, spineId, prd(['a new risk']));
        store.revertSpineToVersion(projectId, spineId);
        expect(latestSpine(projectId).id).not.toBe(spineId);
        expect(Object.values(statusBySlot(projectId)).every(status => status === 'up_to_date')).toBe(true);

        // Fingerprint currency is not resume evidence: nothing was generated
        // for the restored spine, so opening Build regenerates nothing.
        genMock.mockClear();
        mockupMock.mockClear();
        artifactJobController.resumeIfNeeded(argsFor(projectId));
        await settle(projectId);
        expect(generatedSlots()).toEqual([]);
    });

    it('regenerating one output reads its fingerprint-current upstreams as context', async () => {
        const { projectId, spineId } = seedProject();
        artifactJobController.startAll(argsFor(projectId));
        await settle(projectId);
        const store = useProjectStore.getState();
        store.editSpineStructuredPRD(projectId, spineId, prd(['a new risk']));
        store.revertSpineToVersion(projectId, spineId);

        // The data model is regenerated with new content on the restored spine;
        // the plan (generated against the original spine id) now reads
        // dependency_changed by content — not prd_changed.
        genMock.mockImplementation(async (subtype: string) => ({ content: `${subtype} content v2`, metadata: {} }));
        artifactJobController.regenerateSlots(['data_model'], argsFor(projectId));
        await settle(projectId);
        const planEval = evaluateProjectFreshness(useProjectStore.getState(), projectId).evaluations.get('implementation_plan')!;
        expect(planEval.status).toBe('needs_update');
        expect(planEval.reasons.map(r => r.kind)).toEqual(['dependency_changed']);

        // Regenerating just the plan seeds the screen inventory and flows —
        // generated against the ORIGINAL spine id, still current by
        // fingerprint — as context, so its required dependencies are present.
        genMock.mockClear();
        artifactJobController.regenerateSlots(['implementation_plan'], argsFor(projectId));
        await settle(projectId);
        expect(genMock).toHaveBeenCalledTimes(1);
        const context = genMock.mock.calls[0][3]?.generatedArtifacts;
        expect(context?.screen_inventory).toBe('screen_inventory content');
        expect(context?.user_flows).toBe('user_flows content');
        expect(context?.data_model).toBe('data_model content v2');
        expect(useProjectStore.getState().jobs[projectId]?.slots.implementation_plan?.status).toBe('done');
        expect(preferredFor(projectId, 'implementation_plan')!.provenance?.inputHashes?.dependencies?.data_model)
            .toBe(dependencyContentHash('data_model content v2'));
        expect(Object.values(statusBySlot(projectId)).every(status => status === 'up_to_date')).toBe(true);
    });

    it('Generate outputs schedules only what is not current — plus current dependents of what it regenerates', async () => {
        const { projectId, spineId } = seedProject();
        artifactJobController.startAll(argsFor(projectId));
        await settle(projectId);
        const store = useProjectStore.getState();
        store.editSpineStructuredPRD(projectId, spineId, prd(['a new risk']));
        store.revertSpineToVersion(projectId, spineId);
        // The data model goes missing on the restored spine.
        const dataModel = store.getArtifacts(projectId, 'core_artifact').find(a => a.subtype === 'data_model')!;
        store.deleteArtifact(projectId, dataModel.id);

        genMock.mockClear();
        mockupMock.mockClear();
        artifactJobController.startAll(argsFor(projectId));
        await settle(projectId);
        // The plan is current by fingerprint, but it consumes the data model
        // being generated, so it follows; nothing else is regenerated.
        expect(generatedSlots().sort()).toEqual(['data_model', 'implementation_plan']);
    });

    it('a PRD edit every core prompt reads (risks) regenerates the core outputs and carries the mockup along', async () => {
        const { projectId, spineId } = seedProject();
        artifactJobController.startAll(argsFor(projectId));
        await settle(projectId);
        useProjectStore.getState().editSpineStructuredPRD(projectId, spineId, prd(['a new risk']), {
            responseText: 'md with a new risk',
        });

        const statuses = statusBySlot(projectId);
        for (const subtype of visibleCoreSubtypes()) expect(statuses[subtype], subtype).toBe('needs_update');
        // The mockup spec does not read risks: its own inputs are unchanged.
        expect(statuses.mockup).toBe('up_to_date');

        // Its inputs regenerate in the same run, so it follows them.
        const store = useProjectStore.getState();
        const flows = store.getArtifacts(projectId, 'core_artifact').find(a => a.subtype === 'user_flows')!;
        store.deleteArtifact(projectId, flows.id);
        genMock.mockClear();
        mockupMock.mockClear();
        artifactJobController.startAll(argsFor(projectId));
        await settle(projectId);
        expect(generatedSlots().sort()).toEqual([...visibleCoreSubtypes(), 'mockup'].sort());
    });

    it('a design-preset change is reported by the engine but never regenerates the design system on its own', async () => {
        const { projectId } = seedProject();
        artifactJobController.startAll(argsFor(projectId));
        await settle(projectId);

        useProjectStore.getState().setProjectDesignSystemPreset(projectId, 'enterprise_professional');
        const designEval = evaluateProjectFreshness(useProjectStore.getState(), projectId).evaluations.get('design_system')!;
        expect(designEval.status).toBe('needs_update');
        expect(designEval.reasons.map(r => r.kind)).toEqual(['design_direction_changed']);

        // The early design-system run (fired by the workspace on any project
        // change) still reads the slot as done for the spine: regenerating on a
        // new direction stays the user's explicit choice.
        genMock.mockClear();
        artifactJobController.ensureDesignSystemForSpine(argsFor(projectId));
        await settle(projectId);
        expect(genMock).not.toHaveBeenCalled();
    });
});

describe('artifactJobController — an input regenerated in a run re-queues its consumers', () => {
    /** Generation that fails for the named subtypes and succeeds for the rest. */
    const failingFor = (...failed: string[]) => async (subtype: string) => {
        if (failed.includes(subtype)) throw new Error(`${subtype} failed`);
        return { content: `${subtype} content`, metadata: {} };
    };

    it('optional flows fail → the plan is saved without them → a resume regenerates the flows and rebuilds the plan after them', async () => {
        const { projectId } = seedProject();
        genMock.mockImplementation(failingFor('user_flows'));
        artifactJobController.startAll(argsFor(projectId));
        await settle(projectId);

        // The plan proceeded without its optional flows, for THIS spine: its
        // fingerprint records exactly the inputs it read — no user_flows.
        const degraded = preferredFor(projectId, 'implementation_plan')!;
        expect(degraded.provenance?.inputHashes?.dependencies).toEqual({
            screen_inventory: dependencyContentHash('screen_inventory content'),
            data_model: dependencyContentHash('data_model content'),
        });
        expect(preferredFor(projectId, 'user_flows')).toBeUndefined();

        // The next Build mount resumes: the flows are pending; the plan is not
        // (it is current for the spine) but follows them, in dependency order.
        genMock.mockImplementation(failingFor());
        genMock.mockClear();
        mockupMock.mockClear();
        artifactJobController.resumeIfNeeded(argsFor(projectId));
        await settle(projectId);

        expect(generatedSlots()).toEqual(['user_flows', 'implementation_plan']);
        const planCall = genMock.mock.calls.find(call => call[0] === 'implementation_plan')!;
        expect(planCall[3]?.generatedArtifacts?.user_flows).toBe('user_flows content');
        const rebuilt = preferredFor(projectId, 'implementation_plan')!;
        expect(rebuilt.id).not.toBe(degraded.id);
        expect(rebuilt.provenance?.inputHashes?.dependencies?.user_flows)
            .toBe(dependencyContentHash('user_flows content'));
        const slots = useProjectStore.getState().jobs[projectId]!.slots;
        expect(slots.user_flows?.status).toBe('done');
        expect(slots.implementation_plan?.status).toBe('done');
        expect(Object.values(statusBySlot(projectId)).every(status => status === 'up_to_date')).toBe(true);
    });

    it('a mockup degraded without its component inventory is rebuilt once a resume regenerates the inventory', async () => {
        const { projectId } = seedProject();
        genMock.mockImplementation(failingFor('component_inventory'));
        artifactJobController.startAll(argsFor(projectId));
        await settle(projectId);
        const degraded = preferredFor(projectId, 'mockup')!;
        expect(degraded.provenance?.inputHashes?.dependencies).toEqual({
            screen_inventory: dependencyContentHash('screen_inventory content'),
        });

        genMock.mockImplementation(failingFor());
        genMock.mockClear();
        mockupMock.mockClear();
        artifactJobController.resumeIfNeeded(argsFor(projectId));
        await settle(projectId);

        expect(generatedSlots()).toEqual(['component_inventory', 'mockup']);
        const rebuilt = preferredFor(projectId, 'mockup')!;
        expect(rebuilt.id).not.toBe(degraded.id);
        expect(rebuilt.provenance?.inputHashes?.dependencies).toEqual({
            screen_inventory: dependencyContentHash('screen_inventory content'),
            component_inventory: dependencyContentHash('component_inventory content'),
        });
        expect(Object.values(statusBySlot(projectId)).every(status => status === 'up_to_date')).toBe(true);
    });

    it('nothing regenerated → nothing rebuilt: when the flows fail again the queued plan is left as it is', async () => {
        const { projectId } = seedProject();
        genMock.mockImplementation(failingFor('user_flows'));
        artifactJobController.startAll(argsFor(projectId));
        await settle(projectId);
        const degraded = preferredFor(projectId, 'implementation_plan')!;

        // The plan is queued behind the flows, but with no new input to read a
        // paid rebuild would reproduce the same output: it is skipped.
        genMock.mockClear();
        mockupMock.mockClear();
        artifactJobController.resumeIfNeeded(argsFor(projectId));
        await settle(projectId);
        expect(generatedSlots()).toEqual(['user_flows']);
        expect(preferredFor(projectId, 'implementation_plan')!.id).toBe(degraded.id);
        const slots = useProjectStore.getState().jobs[projectId]!.slots;
        expect(slots.user_flows?.status).toBe('error');
        expect(slots.implementation_plan?.status).toBe('done');

        // Once the flows' automatic budget is spent, a resume starts nothing.
        artifactJobController.resumeIfNeeded(argsFor(projectId));
        await settle(projectId);
        genMock.mockClear();
        artifactJobController.resumeIfNeeded(argsFor(projectId));
        await settle(projectId);
        expect(generatedSlots()).toEqual([]);
    });

    it('nothing pending → nothing re-queued', async () => {
        const { projectId } = seedProject();
        artifactJobController.startAll(argsFor(projectId));
        await settle(projectId);

        genMock.mockClear();
        mockupMock.mockClear();
        artifactJobController.startAll(argsFor(projectId));
        await settle(projectId);
        artifactJobController.resumeIfNeeded(argsFor(projectId));
        await settle(projectId);
        expect(generatedSlots()).toEqual([]);
    });

    it('a single-slot retry of the missing flows flags the plan saved without them', async () => {
        const { projectId } = seedProject();
        genMock.mockImplementation(failingFor('user_flows'));
        artifactJobController.startAll(argsFor(projectId));
        await settle(projectId);
        // Flows missing: the plan has nothing concrete to compare (the gap
        // shows through impactedBy only).
        const before = evaluateProjectFreshness(useProjectStore.getState(), projectId).evaluations.get('implementation_plan')!;
        expect(before.status).toBe('up_to_date');
        expect(before.impactedBy).toEqual(['user_flows']);

        // A manual Retry regenerates only the flows; the engine then reports
        // the plan was built without an input that exists now.
        genMock.mockImplementation(failingFor());
        artifactJobController.retrySlot('user_flows', argsFor(projectId));
        await settle(projectId);
        const after = evaluateProjectFreshness(useProjectStore.getState(), projectId).evaluations.get('implementation_plan')!;
        expect(after.status).toBe('needs_update');
        expect(after.reasons).toEqual([
            expect.objectContaining({ kind: 'dependency_changed', dependencyId: 'user_flows' }),
        ]);
        expect(after.reasons[0].detail).toContain('was not available when this was generated');
    });
});
