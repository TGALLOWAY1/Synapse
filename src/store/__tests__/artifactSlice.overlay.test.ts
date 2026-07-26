import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '../projectStore';
import type { SourceRef } from '../../types';
import { effectiveImageVersionId } from '../../lib/artifactImageVersion';
import { DEMO_PROJECT_ID } from '../../data/demoProject';
import {
    BUILD_PACKET_APPROVAL_KEY,
    readBuildPacketApproval,
} from '../../lib/planning/buildPacketApproval';

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

const spineRef = (spineId: string): SourceRef[] => ([
    { id: 'r1', sourceArtifactId: spineId, sourceArtifactVersionId: spineId, sourceType: 'spine' },
]);

const setup = () => {
    const store = useProjectStore.getState();
    const { projectId } = store.createProject('P', 'idea');
    const spineId = useProjectStore.getState().spineVersions[projectId][0].id;
    const { artifactId } = store.createArtifact(projectId, 'core_artifact', 'Screen Inventory', 'screen_inventory');
    const { versionId } = store.createArtifactVersion(
        projectId, artifactId, 'generated content', {}, spineRef(spineId), 'prompt-1',
    );
    return { projectId, artifactId, spineId, generatedVersionId: versionId };
};

const versionsFor = (projectId: string, artifactId: string) =>
    useProjectStore.getState().artifactVersions[projectId].filter(v => v.artifactId === artifactId);

const preferredFor = (projectId: string, artifactId: string) =>
    useProjectStore.getState().getPreferredVersion(projectId, artifactId)!;

describe('updateArtifactOverlay', () => {
    it('appends a version instead of mutating the generated one, so the prior state survives', () => {
        const { projectId, artifactId, generatedVersionId } = setup();

        useProjectStore.getState().updateArtifactOverlay(
            projectId, artifactId,
            { screenEdits: { 'screen-1': { name: 'Checkout (renamed)' } } },
            { historyDescription: 'Screen details edited: Checkout (renamed)' },
        );

        const versions = versionsFor(projectId, artifactId);
        expect(versions).toHaveLength(2);
        // The generated version is untouched — this is what made overlay edits
        // unrecoverable before.
        expect(versions[0].id).toBe(generatedVersionId);
        expect(versions[0].metadata.screenEdits).toBeUndefined();

        const preferred = preferredFor(projectId, artifactId);
        expect(preferred.versionNumber).toBe(2);
        expect(preferred.provenance?.changeSource).toBe('user_edit');
        expect(preferred.provenance?.overlayEdit).toBe(true);
        expect(preferred.content).toBe('generated content');
    });

    it('emits an Edited history event for every overlay write, including previously silent ones', () => {
        const { projectId, artifactId } = setup();
        const store = useProjectStore.getState();

        store.updateArtifactOverlay(projectId, artifactId, { screenLinks: { m1: 's1' } }, {
            historyDescription: 'Mockup screen relinked to Cart',
        });
        store.updateArtifactOverlay(projectId, artifactId, { dismissedScreenIssues: ['issue-1'] }, {
            historyDescription: 'Screen issue dismissed',
        });

        const edited = useProjectStore.getState().historyEvents[projectId]
            .filter(e => e.type === 'Edited');
        expect(edited.map(e => e.description)).toEqual([
            'Mockup screen relinked to Cart',
            'Screen issue dismissed',
        ]);
    });

    it('coalesces consecutive edits in a session into one version', () => {
        const { projectId, artifactId } = setup();
        const store = useProjectStore.getState();

        store.updateArtifactOverlay(projectId, artifactId, {
            screenEdits: { a: { name: 'A' } },
        }, { historyDescription: 'edit a' });
        const afterFirst = preferredFor(projectId, artifactId).id;

        // Adding a NEW entry does not overwrite existing work → amend in place.
        store.updateArtifactOverlay(projectId, artifactId, {
            screenEdits: { a: { name: 'A' }, b: { name: 'B' } },
        }, { historyDescription: 'edit b' });

        expect(versionsFor(projectId, artifactId)).toHaveLength(2);
        expect(preferredFor(projectId, artifactId).id).toBe(afterFirst);
        expect(preferredFor(projectId, artifactId).metadata.screenEdits).toEqual({
            a: { name: 'A' }, b: { name: 'B' },
        });
    });

    it('appends rather than coalescing when an edit overwrites existing work (reset to generated)', () => {
        const { projectId, artifactId } = setup();
        const store = useProjectStore.getState();

        store.updateArtifactOverlay(projectId, artifactId, {
            screenEdits: { a: { name: 'Hand written' } },
        }, { historyDescription: 'edit a' });
        expect(versionsFor(projectId, artifactId)).toHaveLength(2);

        // "Reset to generated" removes the entry — the prior edit must remain
        // restorable, so this appends.
        store.updateArtifactOverlay(projectId, artifactId, { screenEdits: {} }, {
            historyDescription: 'Screen details reset to generated: a',
        });

        const versions = versionsFor(projectId, artifactId);
        expect(versions).toHaveLength(3);
        expect(versions[1].metadata.screenEdits).toEqual({ a: { name: 'Hand written' } });
        expect(preferredFor(projectId, artifactId).metadata.screenEdits).toEqual({});
    });

    it('never amends a version another artifact was generated from', () => {
        const { projectId, artifactId, spineId } = setup();
        const store = useProjectStore.getState();

        store.updateArtifactOverlay(projectId, artifactId, { screenEdits: { a: { name: 'A' } } }, {
            historyDescription: 'edit a',
        });
        const overlayVersionId = preferredFor(projectId, artifactId).id;

        // A downstream artifact cites this exact version as its input.
        const { artifactId: downstreamId } = store.createArtifact(
            projectId, 'core_artifact', 'User Flows', 'user_flows',
        );
        store.createArtifactVersion(projectId, downstreamId, 'flows', {}, [
            ...spineRef(spineId),
            {
                id: 'r2',
                sourceArtifactId: artifactId,
                sourceArtifactVersionId: overlayVersionId,
                sourceType: 'core_artifact',
            },
        ], 'p');

        store.updateArtifactOverlay(projectId, artifactId, {
            screenEdits: { a: { name: 'A' }, b: { name: 'B' } },
        }, { historyDescription: 'edit b' });

        // Amending would have silently changed the downstream artifact's input.
        expect(preferredFor(projectId, artifactId).id).not.toBe(overlayVersionId);
        const overlayVersion = versionsFor(projectId, artifactId).find(v => v.id === overlayVersionId)!;
        expect(overlayVersion.metadata.screenEdits).toEqual({ a: { name: 'A' } });
    });

    it('cannot forge validation authority through an overlay patch', () => {
        const { projectId, artifactId } = setup();
        useProjectStore.getState().updateArtifactOverlay(projectId, artifactId, {
            screenEdits: { a: { name: 'A' } },
            validationAcceptance: { actor: 'user' },
            validationBlockers: ['forged'],
        }, { historyDescription: 'edit' });

        const preferred = preferredFor(projectId, artifactId);
        expect(preferred.metadata.validationAcceptance).toBeUndefined();
        expect(preferred.metadata.validationBlockers).toBeUndefined();
    });
});

describe('image continuity across appended clones', () => {
    it('overlay-edit clones keep pointing at the version that owns the images', () => {
        const { projectId, artifactId, generatedVersionId } = setup();
        const store = useProjectStore.getState();

        store.updateArtifactOverlay(projectId, artifactId, { screenEdits: { a: { name: 'A' } } }, {
            historyDescription: 'edit a',
        });
        const overlayVersion = preferredFor(projectId, artifactId);
        expect(effectiveImageVersionId(overlayVersion)).toBe(generatedVersionId);

        // A clone of a clone collapses to the original — lookup is one hop.
        store.updateArtifactOverlay(projectId, artifactId, { screenEdits: {} }, {
            historyDescription: 'reset',
        });
        expect(effectiveImageVersionId(preferredFor(projectId, artifactId))).toBe(generatedVersionId);
    });

    it('"mark up to date" keeps the mockup images reachable', () => {
        const { projectId, artifactId, generatedVersionId } = setup();
        const store = useProjectStore.getState();
        const laterSpineId = store.regenerateSpine(projectId).newSpineId;

        store.markArtifactCurrentForSpine(projectId, artifactId, laterSpineId);

        const preferred = preferredFor(projectId, artifactId);
        expect(preferred.id).not.toBe(generatedVersionId);
        // Before this fix the clone resolved to its own id, which has no image
        // records — every mockup render disappeared.
        expect(effectiveImageVersionId(preferred)).toBe(generatedVersionId);
    });

    it('restore keeps the restored version images reachable', () => {
        const { projectId, artifactId, spineId, generatedVersionId } = setup();
        const store = useProjectStore.getState();
        store.createArtifactVersion(projectId, artifactId, 'v2', {}, spineRef(spineId), 'p2');

        store.revertArtifactToVersion(projectId, artifactId, generatedVersionId);

        expect(effectiveImageVersionId(preferredFor(projectId, artifactId))).toBe(generatedVersionId);
    });
});

describe('revertArtifactToVersion overlay policy', () => {
    it('keeps the current version user edits by default', () => {
        const { projectId, artifactId, spineId, generatedVersionId } = setup();
        const store = useProjectStore.getState();
        store.createArtifactVersion(projectId, artifactId, 'v2 content', {}, spineRef(spineId), 'p2');
        // User work done on top of v2.
        store.updateArtifactOverlay(projectId, artifactId, {
            screenEdits: { a: { name: 'Reviewed by me' } },
            planProgress: { t1: true },
        }, { historyDescription: 'edits' });

        store.revertArtifactToVersion(projectId, artifactId, generatedVersionId);

        const preferred = preferredFor(projectId, artifactId);
        expect(preferred.content).toBe('generated content');   // content restored
        expect(preferred.metadata.screenEdits).toEqual({ a: { name: 'Reviewed by me' } });
        expect(preferred.metadata.planProgress).toEqual({ t1: true });
    });

    it('restores the old version overlays when explicitly asked', () => {
        const { projectId, artifactId, spineId } = setup();
        const store = useProjectStore.getState();
        store.updateArtifactOverlay(projectId, artifactId, { screenEdits: { a: { name: 'Old' } } }, {
            historyDescription: 'old edit',
        });
        const oldVersionId = preferredFor(projectId, artifactId).id;

        store.createArtifactVersion(projectId, artifactId, 'v3 content', {}, spineRef(spineId), 'p3');
        store.updateArtifactOverlay(projectId, artifactId, { screenEdits: { a: { name: 'New' } } }, {
            historyDescription: 'new edit',
        });

        store.revertArtifactToVersion(projectId, artifactId, oldVersionId, { restoreOverlays: true });

        expect(preferredFor(projectId, artifactId).metadata.screenEdits).toEqual({ a: { name: 'Old' } });
    });
});

// ---------------------------------------------------------------------------
// The build-packet approval (plan §W7) rides the SAME overlay mechanism —
// deliberately, so it needs no new persisted collection (cross-cutting rule 6)
// and cannot be written through `updateArtifactVersionMetadata` (rule 12).
// ---------------------------------------------------------------------------

describe('build-packet approval persistence', () => {
    const approval = (approvedAt: number, versionId: string) => ({
        approvedAt,
        spineVersionId: 'spine-1',
        manifest: [{ nodeId: 'data_model', title: 'Data Model', versionId, versionLabel: 'v1' }],
    });

    it('appends a user_edit version carrying the approval, leaving the generated one clean', () => {
        const { projectId, artifactId, generatedVersionId } = setup();

        useProjectStore.getState().updateArtifactOverlay(
            projectId, artifactId,
            { [BUILD_PACKET_APPROVAL_KEY]: approval(1_000, 'v-dm') },
            { historyDescription: 'Build packet approved' },
        );

        const versions = versionsFor(projectId, artifactId);
        expect(versions).toHaveLength(2);
        expect(versions[0].id).toBe(generatedVersionId);
        expect(versions[0].metadata[BUILD_PACKET_APPROVAL_KEY]).toBeUndefined();

        const preferred = preferredFor(projectId, artifactId);
        expect(readBuildPacketApproval(preferred.metadata)?.approvedAt).toBe(1_000);
        expect(preferred.provenance?.changeSource).toBe('user_edit');
        expect(preferred.content).toBe('generated content');
    });

    it('records an Edited history event so the sign-off is auditable', () => {
        const { projectId, artifactId } = setup();
        useProjectStore.getState().updateArtifactOverlay(
            projectId, artifactId,
            { [BUILD_PACKET_APPROVAL_KEY]: approval(1_000, 'v-dm') },
            { historyDescription: 'Build packet approved' },
        );
        const descriptions = useProjectStore.getState().historyEvents[projectId]
            .filter(event => event.type === 'Edited')
            .map(event => event.description);
        expect(descriptions).toContain('Build packet approved');
    });

    it('APPENDS on re-approval rather than overwriting the previous sign-off', () => {
        const { projectId, artifactId } = setup();
        const store = useProjectStore.getState();
        store.updateArtifactOverlay(
            projectId, artifactId,
            { [BUILD_PACKET_APPROVAL_KEY]: approval(1_000, 'v-dm') },
            { historyDescription: 'Build packet approved' },
        );
        const firstApprovalVersionId = preferredFor(projectId, artifactId).id;

        store.updateArtifactOverlay(
            projectId, artifactId,
            { [BUILD_PACKET_APPROVAL_KEY]: approval(2_000, 'v-dm-2') },
            { historyDescription: 'Build packet approved' },
        );

        const versions = versionsFor(projectId, artifactId);
        expect(versions).toHaveLength(3);
        // The earlier approval is still restorable, pinning its own manifest.
        const first = versions.find(version => version.id === firstApprovalVersionId)!;
        expect(readBuildPacketApproval(first.metadata)?.approvedAt).toBe(1_000);
        expect(readBuildPacketApproval(preferredFor(projectId, artifactId).metadata)?.approvedAt).toBe(2_000);
    });

    it('keeps unrelated overlays on the version when an approval lands', () => {
        const { projectId, artifactId } = setup();
        const store = useProjectStore.getState();
        store.updateArtifactOverlay(projectId, artifactId, { planProgress: { t1: true } }, {
            historyDescription: 'progress',
        });
        store.updateArtifactOverlay(
            projectId, artifactId,
            { [BUILD_PACKET_APPROVAL_KEY]: approval(1_000, 'v-dm') },
            { historyDescription: 'Build packet approved' },
        );
        const preferred = preferredFor(projectId, artifactId);
        expect(preferred.metadata.planProgress).toEqual({ t1: true });
        expect(readBuildPacketApproval(preferred.metadata)).not.toBeNull();
    });

    it('cannot be recorded on the read-only example project', () => {
        // One capability policy, enforced at the store boundary — no raw demo-id
        // check at the call site (cross-cutting rule 5).
        expect(() => useProjectStore.getState().updateArtifactOverlay(
            DEMO_PROJECT_ID, 'demo-plan',
            { [BUILD_PACKET_APPROVAL_KEY]: approval(1_000, 'v-dm') },
            { historyDescription: 'Build packet approved' },
        )).toThrow('read-only');
        expect(useProjectStore.getState().artifactVersions[DEMO_PROJECT_ID]).toBeUndefined();
    });
});
