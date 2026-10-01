// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from '../projectStore';
import { evaluateProjectFreshness } from '../../lib/artifactFreshness';
import {
    computeArtifactInputHashes,
    currentPrdInputHashesForSpine,
    dependencyContentHash,
    selectArtifactPrdInput,
} from '../../lib/artifactInputSlices';
import type { ArtifactSlotKey, CoreArtifactSubtype, SourceRef, StructuredPRD } from '../../types';

// The input fingerprint (provenance.inputHashes) is provenance of the content
// it was recorded with, so every version-creating path has to decide what it
// carries: clones that keep content (restore, overlay edit) keep it; "Mark as
// up to date" rebases it onto the confirmed inputs, exactly like its refs.

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
});

const prd = (vision: string): StructuredPRD => ({
    productName: 'Clones',
    vision,
    targetUsers: ['u'],
    coreProblem: 'p',
    features: [{ id: 'f1', name: 'Feature One', description: 'd', userValue: 'v', complexity: 'low' }],
    architecture: 'a',
    risks: ['r'],
});

const spineRef = (spineId: string): SourceRef => ({
    id: `ref-${spineId}-${Math.random()}`,
    sourceArtifactId: 'project',
    sourceArtifactVersionId: spineId,
    sourceType: 'spine',
});

const latestSpine = (projectId: string) =>
    useProjectStore.getState().spineVersions[projectId].find(s => s.isLatest)!;

/** The fingerprint generation records for `slot` against the latest spine. */
const fingerprintFor = (
    projectId: string,
    slot: ArtifactSlotKey,
    deps: Partial<Record<CoreArtifactSubtype, string>> = {},
) => {
    const spine = latestSpine(projectId);
    return computeArtifactInputHashes(slot, selectArtifactPrdInput(slot, {
        structuredPRD: spine.structuredPRD!,
        prdMarkdown: spine.responseText,
        project: useProjectStore.getState().projects[projectId],
        safetyReview: spine.safetyReview,
    }), deps);
};

const statusOf = (projectId: string, slot: ArtifactSlotKey) =>
    evaluateProjectFreshness(useProjectStore.getState(), projectId).evaluations.get(slot)?.status;

/** screen_inventory → user_flows, both generated (with fingerprints) against spine v1. */
function seed() {
    const store = useProjectStore.getState();
    const { projectId, spineId } = store.createProject('P', 'idea', 'web');
    store.updateSpineStructuredPRD(projectId, spineId, prd('v1'), 'md v1');

    const { artifactId: screensId } = store.createArtifact(projectId, 'core_artifact', 'Screen Inventory', 'screen_inventory');
    const { versionId: screensV1 } = store.createArtifactVersion(
        projectId, screensId, 'screens', {}, [spineRef(spineId)], 'p', null,
        { inputHashes: fingerprintFor(projectId, 'screen_inventory') },
    );
    const { artifactId: flowsId } = store.createArtifact(projectId, 'core_artifact', 'User Flows', 'user_flows');
    store.createArtifactVersion(projectId, flowsId, 'flows', {}, [
        spineRef(spineId),
        { id: 'ref-dep', sourceArtifactId: screensId, sourceArtifactVersionId: screensV1, sourceType: 'core_artifact' },
    ], 'p', null, { inputHashes: fingerprintFor(projectId, 'user_flows', { screen_inventory: 'screens' }) });
    return { projectId, spineId, screensId, flowsId };
}

const preferred = (projectId: string, artifactId: string) =>
    useProjectStore.getState().getPreferredVersion(projectId, artifactId)!;

describe('input fingerprints across version-creating paths', () => {
    it('createArtifactVersion keeps the default changeSource when only a fingerprint is passed', () => {
        const { projectId, screensId } = seed();
        expect(preferred(projectId, screensId).provenance?.changeSource).toBe('ai_generation');
        useProjectStore.getState().createArtifactVersion(
            projectId, screensId, 'screens v2', {}, [spineRef(latestSpine(projectId).id)], 'p', null,
            { inputHashes: fingerprintFor(projectId, 'screen_inventory') },
        );
        expect(preferred(projectId, screensId).provenance?.changeSource).toBe('ai_regeneration');
        expect(preferred(projectId, screensId).provenance?.inputHashes).toBeDefined();
    });

    it('an overlay edit on an upstream keeps the fingerprint — and leaves its dependents current', () => {
        const { projectId, screensId } = seed();
        const before = preferred(projectId, screensId);

        // user_flows cites the screen inventory version, so this APPENDS a clone.
        useProjectStore.getState().updateArtifactOverlay(
            projectId, screensId, { screenEdits: { 'scr-a': { name: 'Renamed' } } }, { historyDescription: 'Edited a screen' },
        );
        const clone = preferred(projectId, screensId);
        expect(clone.id).not.toBe(before.id);
        expect(clone.provenance?.overlayEdit).toBe(true);
        expect(clone.provenance?.inputHashes).toEqual(before.provenance?.inputHashes);

        // New upstream version id, identical content: not drift for the dependent.
        expect(statusOf(projectId, 'screen_inventory')).toBe('up_to_date');
        expect(statusOf(projectId, 'user_flows')).toBe('up_to_date');
    });

    it('restoring an artifact version carries that version\'s fingerprint', () => {
        const { projectId, screensId } = seed();
        const v1 = preferred(projectId, screensId);
        const store = useProjectStore.getState();
        store.createArtifactVersion(projectId, screensId, 'screens v2', {}, [spineRef(latestSpine(projectId).id)], 'p');
        store.revertArtifactToVersion(projectId, screensId, v1.id);

        const restored = preferred(projectId, screensId);
        expect(restored.provenance?.changeSource).toBe('revert');
        expect(restored.provenance?.inputHashes).toEqual(v1.provenance?.inputHashes);
        // Content identical to what user_flows consumed → it is current again.
        expect(statusOf(projectId, 'user_flows')).toBe('up_to_date');
    });

    it('a PRD restored to identical content keeps fingerprinted outputs current (legacy ones still flag)', () => {
        const { projectId, spineId } = seed();
        const store = useProjectStore.getState();
        const { artifactId: legacyId } = store.createArtifact(projectId, 'core_artifact', 'Data Model', 'data_model');
        store.createArtifactVersion(projectId, legacyId, 'dm', {}, [spineRef(spineId)], 'p');

        store.editSpineStructuredPRD(projectId, spineId, prd('v2'));
        store.revertSpineToVersion(projectId, spineId);

        expect(statusOf(projectId, 'screen_inventory')).toBe('up_to_date');
        expect(statusOf(projectId, 'user_flows')).toBe('up_to_date');
        // No fingerprint → the spine-id comparison, as before.
        expect(statusOf(projectId, 'data_model')).toBe('needs_update');
    });

    it('mark-as-up-to-date rebases the fingerprint onto the confirmed inputs', () => {
        const { projectId, spineId, flowsId } = seed();
        const store = useProjectStore.getState();
        const { newSpineId } = store.editSpineStructuredPRD(projectId, spineId, prd('v2 — a different vision'));
        expect(statusOf(projectId, 'user_flows')).toBe('needs_update');

        store.markArtifactCurrentForSpine(projectId, flowsId, newSpineId);
        const marked = preferred(projectId, flowsId);
        expect(marked.provenance?.changeSource).toBe('marked_current');
        const confirmedSpine = latestSpine(projectId);
        expect(marked.provenance?.inputHashes).toEqual({
            ...currentPrdInputHashesForSpine('user_flows', confirmedSpine, useProjectStore.getState().projects[projectId]),
            dependencies: { screen_inventory: dependencyContentHash('screens') },
        });
        expect(statusOf(projectId, 'user_flows')).toBe('up_to_date');

        // The user confirmed the NEW inputs; restoring the old PRD content is a
        // change against what was confirmed.
        store.revertSpineToVersion(projectId, spineId);
        expect(statusOf(projectId, 'user_flows')).toBe('needs_update');
    });

    it('an output saved without an input that exists now is flagged — mark-as-up-to-date records that input', () => {
        const { projectId, spineId } = seed();
        const store = useProjectStore.getState();
        const { artifactId: dataModelId } = store.createArtifact(projectId, 'core_artifact', 'Data Model', 'data_model');
        store.createArtifactVersion(projectId, dataModelId, 'dm', {}, [spineRef(spineId)], 'p', null,
            { inputHashes: fingerprintFor(projectId, 'data_model') });
        // The plan was generated while its optional user flows were
        // unavailable: its fingerprint records only what it read.
        const { artifactId: planId } = store.createArtifact(projectId, 'core_artifact', 'Implementation Plan', 'implementation_plan');
        store.createArtifactVersion(projectId, planId, 'plan', {}, [spineRef(spineId)], 'p', null, {
            inputHashes: fingerprintFor(projectId, 'implementation_plan', { screen_inventory: 'screens', data_model: 'dm' }),
        });
        const planReasons = () => evaluateProjectFreshness(useProjectStore.getState(), projectId)
            .evaluations.get('implementation_plan')!.reasons;
        expect(statusOf(projectId, 'implementation_plan')).toBe('needs_update');
        expect(planReasons()).toEqual([expect.objectContaining({ kind: 'dependency_changed', dependencyId: 'user_flows' })]);

        // Confirming it current asserts it holds against TODAY's inputs —
        // including the flows it never read.
        store.markArtifactCurrentForSpine(projectId, planId, spineId);
        expect(preferred(projectId, planId).provenance?.inputHashes?.dependencies).toEqual({
            screen_inventory: dependencyContentHash('screens'),
            data_model: dependencyContentHash('dm'),
            user_flows: dependencyContentHash('flows'),
        });
        expect(statusOf(projectId, 'implementation_plan')).toBe('up_to_date');
    });
});
