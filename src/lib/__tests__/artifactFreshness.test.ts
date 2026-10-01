// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { useProjectStore } from '../../store/projectStore';
import {
    buildDependencyEvaluationInput,
    evaluateProjectFreshness,
    invertToArtifactIds,
    isStaleStatus,
    hasDesignTokenDrift,
    slotsInvalidatedByRestore,
    DEPENDENCY_STATUS_LABELS,
    type FreshnessStateSlice,
} from '../artifactFreshness';
import {
    computeArtifactInputHashes,
    dependencyContentHash,
    inputHashSchemeFor,
    selectArtifactPrdInput,
} from '../artifactInputSlices';
import type { Artifact, ArtifactSlotKey, ArtifactVersion, SourceRef, SpineVersion, StructuredPRD } from '../../types';

// Exercises the canonical freshness seam against a REAL Zustand store instance
// (mirrors src/store/__tests__ suites). It also ABSORBS the coverage of the
// legacy stalenessSlice tests being retired in the cutover:
//   - stalenessAfterRevert.test.ts        → "revert round trip"
//   - stalenessSlice.designTokens.test.ts → "design system tokensHash drift"

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
    vision,
    targetUsers: [],
    coreProblem: '',
    features: [],
    architecture: '',
    risks: [],
});

const state = (): FreshnessStateSlice => useProjectStore.getState();

// --- helpers for the store-API round trips ----------------------------------

/** Create a project with a structured PRD spine and one artifact referencing it. */
function seedProjectWithArtifact(vision = 'v1') {
    const store = useProjectStore.getState();
    const { projectId } = store.createProject('P', 'idea');
    const v1 = useProjectStore.getState().spineVersions[projectId][0];
    store.updateSpineStructuredPRD(projectId, v1.id, prd(vision), 'md');

    const { artifactId } = store.createArtifact(projectId, 'core_artifact', 'Screen Inventory', 'screen_inventory');
    const refs: SourceRef[] = [
        { id: uuidv4(), sourceArtifactId: v1.id, sourceArtifactVersionId: v1.id, sourceType: 'spine' },
    ];
    store.createArtifactVersion(projectId, artifactId, 'content', {}, refs, 'prompt');
    return { projectId, spineV1Id: v1.id, artifactId };
}

const latestSpineId = (projectId: string): string =>
    useProjectStore.getState().spineVersions[projectId].find(s => s.isLatest)!.id;

// --- helpers for direct state seeding (design-token cases) -------------------

const mockupArtifact = (projectId: string, id: string): Artifact => ({
    id, projectId, type: 'mockup', title: 'Mockup', status: 'active',
    currentVersionId: null, createdAt: 1, updatedAt: 1,
});
const designSystemArtifact = (projectId: string, id: string): Artifact => ({
    id, projectId, type: 'core_artifact', subtype: 'design_system', title: 'Design System',
    status: 'active', currentVersionId: null, createdAt: 1, updatedAt: 1,
});
const version = (
    artifactId: string, versionId: string, sourceRefs: SourceRef[], metadata: Record<string, unknown> = {},
): ArtifactVersion => ({
    id: versionId, artifactId, versionNumber: 1, parentVersionId: null, content: '{}',
    metadata, sourceRefs, generationPrompt: '', isPreferred: true, createdAt: 1,
});
const spine = (id: string, projectId: string): SpineVersion => ({
    id, projectId, promptText: '', responseText: '', createdAt: 1, isLatest: true, isFinal: true,
});

function seedMockupProject(mockupTokensHash: string, designTokensHash: string) {
    const projectId = 'design-proj';
    const spineId = 'design-spine';
    const designId = 'design-art';
    const designVersionId = 'design-ver';
    const mockupId = 'mockup-art';
    const mockupVersionId = 'mockup-ver';

    const designArtifact = { ...designSystemArtifact(projectId, designId), currentVersionId: designVersionId };
    // selectPreferredDesignSystem requires a normalizable `tokens` object AND a
    // string `tokensHash` — the canonical engine reads the hash via that
    // selector (unlike stalenessSlice, which read metadata.tokensHash directly).
    const designVersion = version(designId, designVersionId, [], { tokens: {}, tokensHash: designTokensHash });

    const mockup = { ...mockupArtifact(projectId, mockupId), currentVersionId: mockupVersionId };
    const mockupRefs: SourceRef[] = [
        { id: uuidv4(), sourceArtifactId: projectId, sourceArtifactVersionId: spineId, sourceType: 'spine' },
        { id: uuidv4(), sourceArtifactId: designId, sourceArtifactVersionId: designVersionId, sourceType: 'core_artifact', anchorInfo: mockupTokensHash },
    ];
    const mockupVersion = version(mockupId, mockupVersionId, mockupRefs);

    useProjectStore.setState(s => ({
        spineVersions: { ...s.spineVersions, [projectId]: [spine(spineId, projectId)] },
        artifacts: { ...s.artifacts, [projectId]: [designArtifact, mockup] },
        artifactVersions: { ...s.artifactVersions, [projectId]: [designVersion, mockupVersion] },
    }));
    return { projectId, mockupId };
}

// ---------------------------------------------------------------------------

describe('artifactFreshness — store round trips', () => {
    it('a freshly generated artifact reads up_to_date', () => {
        const { projectId } = seedProjectWithArtifact();
        const { evaluations } = evaluateProjectFreshness(state(), projectId);
        expect(evaluations.get('screen_inventory')?.status).toBe('up_to_date');
    });

    it('revert round trip: a PRD revert flips a downstream artifact to needs_update / prd_changed', () => {
        const store = useProjectStore.getState();
        const { projectId, spineV1Id } = seedProjectWithArtifact();

        // Up to date with the latest spine.
        expect(evaluateProjectFreshness(state(), projectId).evaluations.get('screen_inventory')?.status)
            .toBe('up_to_date');

        // Edit → new latest spine, then revert to v1 (appends a new latest clone).
        store.editSpineStructuredPRD(projectId, spineV1Id, prd('v2'));
        store.revertSpineToVersion(projectId, spineV1Id);

        const ev = evaluateProjectFreshness(state(), projectId).evaluations.get('screen_inventory');
        expect(ev?.status).toBe('needs_update');
        expect(ev?.reasons.some(r => r.kind === 'prd_changed')).toBe(true);
    });

    it('mark-current round trip: marking the artifact current for the latest spine restores up_to_date', () => {
        const store = useProjectStore.getState();
        const { projectId, spineV1Id, artifactId } = seedProjectWithArtifact();

        // Drift the PRD so the artifact is stale.
        store.editSpineStructuredPRD(projectId, spineV1Id, prd('v2'));
        expect(evaluateProjectFreshness(state(), projectId).evaluations.get('screen_inventory')?.status)
            .toBe('needs_update');

        // User asserts it's still valid: rebase onto the latest spine.
        useProjectStore.getState().markArtifactCurrentForSpine(projectId, artifactId, latestSpineId(projectId));

        expect(evaluateProjectFreshness(state(), projectId).evaluations.get('screen_inventory')?.status)
            .toBe('up_to_date');
    });
});

describe('artifactFreshness — design system tokensHash drift (absorbs stalenessSlice.designTokens)', () => {
    it('mockup stays up_to_date when tokensHash matches the preferred design system', () => {
        const { projectId } = seedMockupProject('hashA', 'hashA');
        const ev = evaluateProjectFreshness(state(), projectId).evaluations.get('mockup');
        expect(ev?.status).toBe('up_to_date');
        expect(hasDesignTokenDrift(ev)).toBe(false);
    });

    it('mockup is needs_update / design_tokens_changed when tokens drift', () => {
        // Mockup rendered against hashA; design system now on hashB.
        const { projectId } = seedMockupProject('hashA', 'hashB');
        const ev = evaluateProjectFreshness(state(), projectId).evaluations.get('mockup');
        expect(ev?.status).toBe('needs_update');
        expect(hasDesignTokenDrift(ev)).toBe(true);
    });

    it('identical-hash regen keeps the mockup up_to_date (token-hash beats version-id)', () => {
        // Same hash on both sides even though the design version could have been
        // regenerated — the "no-op regeneration" contract.
        const { projectId } = seedMockupProject('hashA', 'hashA');
        expect(evaluateProjectFreshness(state(), projectId).evaluations.get('mockup')?.status)
            .toBe('up_to_date');
    });
});

describe('artifactFreshness — build options', () => {
    it('asOfSpineId evaluates against the given spine instead of the isLatest one', () => {
        const store = useProjectStore.getState();
        const { projectId, spineV1Id } = seedProjectWithArtifact();
        // Edit → v2 becomes latest; the artifact still references v1.
        store.editSpineStructuredPRD(projectId, spineV1Id, prd('v2'));

        // Default: latest is v2 → stale.
        expect(evaluateProjectFreshness(state(), projectId).evaluations.get('screen_inventory')?.status)
            .toBe('needs_update');

        // As-of v1: the artifact's spine ref equals the treated-latest → clean.
        expect(evaluateProjectFreshness(state(), projectId, { asOfSpineId: spineV1Id }).evaluations
            .get('screen_inventory')?.status).toBe('up_to_date');
    });

    it('includeSlotStatus:false ignores live job slot status', () => {
        const store = useProjectStore.getState();
        const { projectId } = seedProjectWithArtifact();
        // A consistent artifact, but a live job says its slot is generating.
        store.initJob(projectId, latestSpineId(projectId), ['screen_inventory']);
        store.setSlotStatus(projectId, 'screen_inventory', { status: 'generating' });

        // Default (include): live status wins → generating.
        expect(evaluateProjectFreshness(state(), projectId).evaluations.get('screen_inventory')?.status)
            .toBe('generating');

        // Excluded: falls through to the metadata verdict → up_to_date.
        expect(evaluateProjectFreshness(state(), projectId, { includeSlotStatus: false }).evaluations
            .get('screen_inventory')?.status).toBe('up_to_date');
    });
});

describe('artifactFreshness — inversion & tolerance', () => {
    it('invertToArtifactIds re-keys the evaluation map by artifact id', () => {
        const { projectId, artifactId } = seedProjectWithArtifact();
        const { context, evaluations } = evaluateProjectFreshness(state(), projectId);
        const byId = invertToArtifactIds(context, evaluations);
        expect(byId.get(artifactId)).toBe(evaluations.get('screen_inventory'));
        expect(context.artifactIdBySlot.screen_inventory).toBe(artifactId);
    });

    it('tolerates missing slice entries and unknown projects (no throw, all missing)', () => {
        // Unknown project against a fully-empty state.
        const empty = buildDependencyEvaluationInput(
            { artifacts: {}, artifactVersions: {}, spineVersions: {} },
            'nope',
        );
        expect(empty.input.snapshots).toEqual({});
        expect(empty.latestSpineId).toBeUndefined();

        // Even a state missing the maps entirely must not throw.
        expect(() => buildDependencyEvaluationInput({} as FreshnessStateSlice, 'nope')).not.toThrow();
        const bare = buildDependencyEvaluationInput({} as FreshnessStateSlice, 'nope');
        expect(bare.input.spineVersionIds).toEqual([]);
    });
});

describe('artifactFreshness — presentation helpers', () => {
    it('isStaleStatus is true only for the two stale statuses', () => {
        expect(isStaleStatus('needs_update')).toBe(true);
        expect(isStaleStatus('update_recommended')).toBe(true);
        expect(isStaleStatus('up_to_date')).toBe(false);
        expect(isStaleStatus('missing')).toBe(false);
        expect(isStaleStatus('generating')).toBe(false);
        expect(isStaleStatus(undefined)).toBe(false);
    });

    it('exposes the canonical status labels', () => {
        expect(DEPENDENCY_STATUS_LABELS.needs_update).toBe('Needs update');
        expect(DEPENDENCY_STATUS_LABELS.update_recommended).toBe('Update recommended');
        expect(DEPENDENCY_STATUS_LABELS.up_to_date).toBe('Up to date');
        expect(DEPENDENCY_STATUS_LABELS.source).toBe('Source of truth');
    });
});

describe('artifactFreshness — input fingerprints', () => {
    const richPrd = (vision: string): StructuredPRD => ({
        ...prd(vision),
        features: [{ id: 'f1', name: 'Feature One', description: 'd', userValue: 'v', complexity: 'low' }],
    });

    /** A screen inventory generated against v1 that recorded its input fingerprint. */
    function seedFingerprinted() {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea', 'web');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        store.updateSpineStructuredPRD(projectId, v1.id, richPrd('v1'), 'md v1');
        const spine = useProjectStore.getState().spineVersions[projectId][0];
        const slot: ArtifactSlotKey = 'screen_inventory';
        const inputHashes = computeArtifactInputHashes(slot, selectArtifactPrdInput(slot, {
            structuredPRD: spine.structuredPRD!,
            prdMarkdown: spine.responseText,
            project: useProjectStore.getState().projects[projectId],
        }), {});
        const { artifactId } = store.createArtifact(projectId, 'core_artifact', 'Screen Inventory', 'screen_inventory');
        store.createArtifactVersion(projectId, artifactId, 'content', {}, [
            { id: uuidv4(), sourceArtifactId: projectId, sourceArtifactVersionId: v1.id, sourceType: 'spine' },
        ], 'prompt', null, { inputHashes });
        return { projectId, spineV1Id: v1.id };
    }

    it('assembles the current fingerprint for each fingerprinted output, and each output\'s content fingerprint', () => {
        const { projectId } = seedFingerprinted();
        const { input } = buildDependencyEvaluationInput(state(), projectId);
        expect(input.currentInputHashes?.screen_inventory?.scheme).toBe(inputHashSchemeFor('screen_inventory'));
        // Nothing to compare against → nothing computed.
        for (const slot of ['design_system', 'data_model', 'mockup'] as ArtifactSlotKey[]) {
            expect(input.currentInputHashes?.[slot], slot).toBeUndefined();
        }
        expect(input.snapshots.screen_inventory?.version.contentHash).toBe(dependencyContentHash('content'));
    });

    it('restoring the PRD to identical content keeps a fingerprinted output up to date', () => {
        const store = useProjectStore.getState();
        const { projectId, spineV1Id } = seedFingerprinted();
        store.editSpineStructuredPRD(projectId, spineV1Id, richPrd('v2'));
        expect(evaluateProjectFreshness(state(), projectId).evaluations.get('screen_inventory')?.status)
            .toBe('needs_update');

        store.revertSpineToVersion(projectId, spineV1Id);
        const ev = evaluateProjectFreshness(state(), projectId).evaluations.get('screen_inventory');
        expect(ev?.status).toBe('up_to_date');
        expect(ev?.reasons).toEqual([]);
    });

    it('falls back to the spine-id comparison when the project is unknown to the slice', () => {
        const store = useProjectStore.getState();
        const { projectId, spineV1Id } = seedFingerprinted();
        store.editSpineStructuredPRD(projectId, spineV1Id, richPrd('v2'));
        store.revertSpineToVersion(projectId, spineV1Id);

        const { projects: _projects, ...withoutProjects } = useProjectStore.getState();
        void _projects;
        const { context, evaluations } = evaluateProjectFreshness(withoutProjects, projectId);
        expect(context.input.currentInputHashes).toEqual({});
        expect(evaluations.get('screen_inventory')?.status).toBe('needs_update');
    });

    it('asOfSpineId fingerprints the given spine', () => {
        const store = useProjectStore.getState();
        const { projectId, spineV1Id } = seedFingerprinted();
        store.editSpineStructuredPRD(projectId, spineV1Id, richPrd('v2'));
        expect(evaluateProjectFreshness(state(), projectId, { asOfSpineId: spineV1Id }).evaluations
            .get('screen_inventory')?.status).toBe('up_to_date');
    });

    it('the restore warning names only outputs a restore would actually take out of date', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea', 'web');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        store.updateSpineStructuredPRD(projectId, v1.id, richPrd('A'), 'md A');
        const { newSpineId: v2 } = store.editSpineStructuredPRD(projectId, v1.id, richPrd('B'), { responseText: 'md B' });
        store.revertSpineToVersion(projectId, v1.id); // v3: content A again
        const v3 = useProjectStore.getState().spineVersions[projectId].find(s => s.isLatest)!;

        // Both outputs generated from v3 (content A): one fingerprinted, one legacy.
        const inputHashes = computeArtifactInputHashes('screen_inventory', selectArtifactPrdInput('screen_inventory', {
            structuredPRD: v3.structuredPRD!,
            prdMarkdown: v3.responseText,
            project: useProjectStore.getState().projects[projectId],
        }), {});
        const ref = (): SourceRef[] => [{ id: uuidv4(), sourceArtifactId: projectId, sourceArtifactVersionId: v3.id, sourceType: 'spine' }];
        const { artifactId: screensId } = store.createArtifact(projectId, 'core_artifact', 'Screen Inventory', 'screen_inventory');
        store.createArtifactVersion(projectId, screensId, 'screens', {}, ref(), 'p', null, { inputHashes });
        const { artifactId: dataId } = store.createArtifact(projectId, 'core_artifact', 'Data Model', 'data_model');
        store.createArtifactVersion(projectId, dataId, 'dm', {}, ref(), 'p');

        // Restoring v1 (content A, what the screens were generated from) keeps
        // the fingerprinted output current; the legacy one follows its spine id.
        expect(slotsInvalidatedByRestore(state(), projectId, v1.id)).toEqual(['data_model']);
        // Restoring v2 (content B) takes both out of date.
        expect(slotsInvalidatedByRestore(state(), projectId, v2).sort()).toEqual(['data_model', 'screen_inventory']);

        // And the warning is honest: after the v1 restore, the screens read current.
        store.revertSpineToVersion(projectId, v1.id);
        expect(evaluateProjectFreshness(state(), projectId).evaluations.get('screen_inventory')?.status).toBe('up_to_date');
        expect(evaluateProjectFreshness(state(), projectId).evaluations.get('data_model')?.status).toBe('needs_update');
    });
});
