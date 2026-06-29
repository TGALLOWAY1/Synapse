import { describe, it, expect } from 'vitest';
import { namespaceSnapshotForRestore } from '../snapshotClient';
import type { SnapshotPayload } from '../snapshotClient';
import type { MockupImageRecord } from '../../types';
import { buildImageKey } from '../mockupImageStore';

// Builds a minimal-but-realistic snapshot for a source project that has one
// mockup artifact version with two AI image records. Only the fields the
// namespacing logic reads are populated; the rest is cast away.
const SOURCE_PROJECT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const VERSION_ID = 'bbbbbbbb-0000-4000-8000-000000000002';
const DEMO_PROJECT_ID = '00000000-0000-4000-8000-000000000d01';

const makeImage = (quality: MockupImageRecord['quality']): MockupImageRecord => ({
    key: buildImageKey(VERSION_ID, 'screen-1', quality),
    projectId: SOURCE_PROJECT_ID,
    artifactId: 'artifact-1',
    versionId: VERSION_ID,
    screenId: 'screen-1',
    dataUrl: `data:image/png;base64,${quality}`,
    quality,
    prompt: 'p',
    generatedAt: 1,
});

const makeSnapshot = (): SnapshotPayload => ({
    schemaVersion: 2,
    manifest: {
        id: 'snap-1', title: 't', projectName: 'n',
        createdAt: '2026-01-01', schemaVersion: 2, imageCount: 2,
    },
    project: {
        project: { id: SOURCE_PROJECT_ID },
        spineVersions: [],
        historyEvents: [],
        branches: [],
        artifacts: [],
        // The version id is also referenced from a sourceRef to prove the
        // remap is applied consistently across the bundle, not just on `.id`.
        artifactVersions: [
            {
                id: VERSION_ID,
                sourceRefs: [{ sourceType: 'spine', sourceArtifactVersionId: VERSION_ID }],
            },
        ],
        feedbackItems: [],
    } as unknown as SnapshotPayload['project'],
    images: [makeImage('low'), makeImage('high')],
});

describe('namespaceSnapshotForRestore', () => {
    it('namespaces the project id and every artifact version id under the target', () => {
        const { bundle, images } = namespaceSnapshotForRestore(makeSnapshot(), DEMO_PROJECT_ID);

        expect(bundle.project.id).toBe(DEMO_PROJECT_ID);
        const av = bundle.artifactVersions[0] as { id: string; sourceRefs: Array<{ sourceArtifactVersionId: string }> };
        const namespacedVersionId = `${DEMO_PROJECT_ID}:${VERSION_ID}`;
        expect(av.id).toBe(namespacedVersionId);
        // The same id referenced elsewhere in the bundle is remapped too.
        expect(av.sourceRefs[0].sourceArtifactVersionId).toBe(namespacedVersionId);

        for (const img of images) {
            expect(img.versionId).toBe(namespacedVersionId);
            expect(img.projectId).toBe(DEMO_PROJECT_ID);
            // The composite key is rebuilt from the remapped fields.
            expect(img.key).toBe(buildImageKey(namespacedVersionId, img.screenId, img.quality));
        }
    });

    it('isolates restored images from the source project (no shared version ids)', () => {
        const { images } = namespaceSnapshotForRestore(makeSnapshot(), DEMO_PROJECT_ID);
        // None of the restored images reuse the source project's version id, so
        // deleteImagesForVersion during restore can never touch the source's
        // IndexedDB records.
        expect(images.every((r) => r.versionId !== VERSION_ID)).toBe(true);
    });

    it('is a no-op remap when the target equals the snapshot project id', () => {
        const snapshot = makeSnapshot();
        const { bundle, images } = namespaceSnapshotForRestore(snapshot, SOURCE_PROJECT_ID);
        // Same project id => restore over self, ids untouched.
        expect(bundle).toBe(snapshot.project);
        expect(images).toBe(snapshot.images);
        expect(images[0].versionId).toBe(VERSION_ID);
    });
});
