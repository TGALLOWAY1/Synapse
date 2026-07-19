import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '../projectStore';
import { evaluateProjectFreshness } from '../../lib/artifactFreshness';
import type { SourceRef, StructuredPRD } from '../../types';

// Freshness is now read exclusively through the canonical evaluator (SYN-005);
// the legacy getArtifactStaleness slice was deleted.
const statusOf = (projectId: string, slot: 'data_model' | 'mockup'): string | undefined =>
    evaluateProjectFreshness(useProjectStore.getState(), projectId).evaluations.get(slot)?.status;

beforeEach(() => {
    useProjectStore.setState({
        projects: {},
        spineVersions: {},
        historyEvents: {},
        branches: {},
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
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

const spineRef = (spineId: string): SourceRef => ({
    id: `ref-${spineId}`,
    sourceArtifactId: 'project',
    sourceArtifactVersionId: spineId,
    sourceType: 'spine',
});

describe('markArtifactCurrentForSpine', () => {
    it('appends a cloned preferred version rebased onto the new spine and flips staleness to current', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        store.updateSpineStructuredPRD(projectId, v1.id, prd('v1'), 'md');

        const { artifactId } = store.createArtifact(projectId, 'core_artifact', 'Data Model', 'data_model');
        store.createArtifactVersion(projectId, artifactId, 'content', { k: 1 }, [spineRef(v1.id)], 'prompt');

        // A PRD edit makes a newer spine latest — the artifact goes stale.
        const { newSpineId } = store.editSpineStructuredPRD(projectId, v1.id, prd('v2'));
        expect(statusOf(projectId, 'data_model')).toBe('needs_update');

        const { versionId } = store.markArtifactCurrentForSpine(projectId, artifactId, newSpineId);

        const versions = useProjectStore.getState().artifactVersions[projectId]
            .filter(v => v.artifactId === artifactId);
        expect(versions).toHaveLength(2);
        const confirmed = versions.find(v => v.id === versionId)!;
        expect(confirmed.isPreferred).toBe(true);
        expect(confirmed.versionNumber).toBe(2);
        expect(confirmed.content).toBe('content'); // clone, not a rewrite
        expect(confirmed.provenance?.changeSource).toBe('marked_current');
        expect(confirmed.sourceRefs.find(r => r.sourceType === 'spine')?.sourceArtifactVersionId).toBe(newSpineId);

        // History preserved + honest event recorded.
        expect(versions.find(v => v.versionNumber === 1)?.isPreferred).toBe(false);
        const events = useProjectStore.getState().historyEvents[projectId];
        expect(events.some(e => e.type === 'MarkedCurrent' && e.artifactVersionId === versionId)).toBe(true);

        expect(statusOf(projectId, 'data_model')).toBe('up_to_date');
    });

    it('rebases dependency refs onto their current preferred versions (incl. tokensHash anchor)', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const v1 = useProjectStore.getState().spineVersions[projectId][0];
        store.updateSpineStructuredPRD(projectId, v1.id, prd('v1'), 'md');

        // Upstream design system with a tokensHash, regenerated once.
        const { artifactId: designId } = store.createArtifact(projectId, 'core_artifact', 'Design System', 'design_system');
        const { versionId: designV1 } = store.createArtifactVersion(
            projectId, designId, 'design v1', { tokensHash: 'hash-old' }, [spineRef(v1.id)], 'p',
        );
        // Mockup recorded the design ref with the old hash anchor.
        const { artifactId: mockupId } = store.createArtifact(projectId, 'mockup', 'Mockups');
        store.createArtifactVersion(projectId, mockupId, 'mockup v1', {}, [
            spineRef(v1.id),
            {
                id: 'dref', sourceArtifactId: designId, sourceArtifactVersionId: designV1,
                sourceType: 'core_artifact', anchorInfo: 'hash-old',
            },
        ], 'p');

        // Design system regenerates with a new hash; PRD also edits forward.
        store.createArtifactVersion(projectId, designId, 'design v2', { tokensHash: 'hash-new' }, [spineRef(v1.id)], 'p');
        const { newSpineId } = store.editSpineStructuredPRD(projectId, v1.id, prd('v2'));

        store.markArtifactCurrentForSpine(projectId, mockupId, newSpineId);

        const confirmed = useProjectStore.getState().getPreferredVersion(projectId, mockupId)!;
        const depRef = confirmed.sourceRefs.find(r => r.sourceType === 'core_artifact')!;
        const designPreferred = useProjectStore.getState().getPreferredVersion(projectId, designId)!;
        expect(depRef.sourceArtifactVersionId).toBe(designPreferred.id);
        expect(depRef.anchorInfo).toBe('hash-new');
        // With spine + dep + hash all rebased, the mockup is fully up to date.
        expect(statusOf(projectId, 'mockup')).toBe('up_to_date');
    });

    it('throws when the artifact has no preferred version', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const { artifactId } = store.createArtifact(projectId, 'core_artifact', 'Data Model', 'data_model');
        expect(() => store.markArtifactCurrentForSpine(projectId, artifactId, 'spine-x')).toThrow();
    });
});

describe('provenance stamping completion', () => {
    it('stamps ai_generation / ai_regeneration on artifact versions by default', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const { artifactId } = store.createArtifact(projectId, 'core_artifact', 'Data Model', 'data_model');
        const first = store.createArtifactVersion(projectId, artifactId, 'a', {}, [], 'p');
        const second = store.createArtifactVersion(projectId, artifactId, 'b', {}, [], 'p');
        const versions = useProjectStore.getState().artifactVersions[projectId];
        expect(versions.find(v => v.id === first.versionId)?.provenance?.changeSource).toBe('ai_generation');
        expect(versions.find(v => v.id === second.versionId)?.provenance?.changeSource).toBe('ai_regeneration');
    });

    it('stamps ai_generation on the initial spine at final settle and ai_regeneration on regenerate', () => {
        const store = useProjectStore.getState();
        const { projectId, spineId } = store.createProject('P', 'idea');
        store.updateSpineStructuredPRD(projectId, spineId, prd('v1'), 'md', {
            generationMeta: { passes: [], totalMs: 1, revised: false, schemaVersion: 2 },
        });
        expect(
            useProjectStore.getState().spineVersions[projectId].find(s => s.id === spineId)?.provenance?.changeSource,
        ).toBe('ai_generation');

        const { newSpineId } = store.regenerateSpine(projectId);
        expect(
            useProjectStore.getState().spineVersions[projectId].find(s => s.id === newSpineId)?.provenance?.changeSource,
        ).toBe('ai_regeneration');
    });

    it('records an Edited history event for overlay metadata edits with a description', () => {
        const store = useProjectStore.getState();
        const { projectId } = store.createProject('P', 'idea');
        const { artifactId } = store.createArtifact(projectId, 'core_artifact', 'Screens', 'screen_inventory');
        const { versionId } = store.createArtifactVersion(projectId, artifactId, 'a', {}, [], 'p');

        store.updateArtifactVersionMetadata(projectId, artifactId, versionId, { screenEdits: {} });
        const silentCount = useProjectStore.getState().historyEvents[projectId]
            .filter(e => e.type === 'Edited').length;
        expect(silentCount).toBe(0);

        store.updateArtifactVersionMetadata(
            projectId, artifactId, versionId, { screenEdits: {} },
            { historyDescription: 'Screen details edited: Home' },
        );
        const edited = useProjectStore.getState().historyEvents[projectId].filter(e => e.type === 'Edited');
        expect(edited).toHaveLength(1);
        expect(edited[0].description).toContain('Home');
    });
});
