import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { loadDemoSnapshotPublic, namespaceSnapshotForRestore } from '../snapshotClient';
import type { SnapshotPayload } from '../snapshotClient';
import type { MockupImageRecord, ScreenInventoryImageRecord } from '../../types';
import { buildImageKey } from '../mockupImageStore';
import { buildScreenImageKey } from '../screenInventoryImageStore';

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

    it('defaults screenImages to [] for snapshots saved before screen-image capture', () => {
        const { screenImages } = namespaceSnapshotForRestore(makeSnapshot(), DEMO_PROJECT_ID);
        expect(screenImages).toEqual([]);
    });
});

const makeScreenImage = (versionNumber: number): ScreenInventoryImageRecord => ({
    key: buildScreenImageKey(VERSION_ID, 'login', versionNumber),
    projectId: SOURCE_PROJECT_ID,
    artifactId: 'artifact-1',
    artifactVersionId: VERSION_ID,
    screenSlug: 'login',
    screenName: 'Login',
    versionNumber,
    isPreferred: versionNumber === 1,
    dataUrl: `data:image/png;base64,si${versionNumber}`,
    mimeType: 'image/png',
    prompt: 'p',
    generatedAt: 1,
});

describe('namespaceSnapshotForRestore — screen images, tasks, metrics', () => {
    const withExtras = (): SnapshotPayload => {
        const snap = makeSnapshot();
        return {
            ...snap,
            project: {
                ...snap.project,
                tasks: [{ id: 'task-1', projectId: SOURCE_PROJECT_ID }],
                workflowRuns: [{ id: 'run-1', projectId: SOURCE_PROJECT_ID }],
                readinessReviews: [{ id: 'ready-1', projectId: SOURCE_PROJECT_ID }],
                readinessCommitmentEvents: [{ id: 'commit-1', projectId: SOURCE_PROJECT_ID }],
                downstreamArtifactUpdateProposals: [{
                    id: 'proposal-1', projectId: SOURCE_PROJECT_ID,
                    artifact: { artifactVersionId: VERSION_ID },
                }],
                downstreamArtifactUpdateApplications: [{
                    id: 'application-1', projectId: SOURCE_PROJECT_ID,
                    resultingArtifactVersionId: VERSION_ID,
                }],
            } as unknown as SnapshotPayload['project'],
            screenImages: [makeScreenImage(1), makeScreenImage(2)],
        };
    };

    it('namespaces screen-inventory images by artifactVersionId and rebuilds the key', () => {
        const { screenImages } = namespaceSnapshotForRestore(withExtras(), DEMO_PROJECT_ID);
        const namespacedVersionId = `${DEMO_PROJECT_ID}:${VERSION_ID}`;
        expect(screenImages).toHaveLength(2);
        for (const img of screenImages) {
            expect(img.artifactVersionId).toBe(namespacedVersionId);
            expect(img.projectId).toBe(DEMO_PROJECT_ID);
            expect(img.key).toBe(buildScreenImageKey(namespacedVersionId, img.screenSlug, img.versionNumber));
            // Never reuse the source version id, so restore can't wipe the
            // source project's screen images.
            expect(img.artifactVersionId).not.toBe(VERSION_ID);
        }
    });

    it('rewrites the projectId on bundled tasks and workflow runs', () => {
        const { bundle } = namespaceSnapshotForRestore(withExtras(), DEMO_PROJECT_ID);
        expect(bundle.tasks?.[0].projectId).toBe(DEMO_PROJECT_ID);
        expect(bundle.workflowRuns?.[0].projectId).toBe(DEMO_PROJECT_ID);
        expect(bundle.readinessReviews?.[0].projectId).toBe(DEMO_PROJECT_ID);
        expect(bundle.readinessCommitmentEvents?.[0].projectId).toBe(DEMO_PROJECT_ID);
        expect(bundle.downstreamArtifactUpdateProposals).toEqual([]);
        expect(bundle.downstreamArtifactUpdateApplications).toEqual([]);
    });

    it('namespaces bundled mockup variant images by versionId and rebuilds the key', () => {
        const snap = makeSnapshot();
        const withVariants: SnapshotPayload = {
            ...snap,
            project: {
                ...snap.project,
                mockupVariantImages: {
                    schemaVersion: 1,
                    projectId: SOURCE_PROJECT_ID,
                    exportedAt: 'now',
                    records: [{
                        key: `${VERSION_ID}:scr-home:mobile:default:low`,
                        versionId: VERSION_ID,
                        screenId: 'scr-home',
                        variantId: 'mobile:default',
                        quality: 'low',
                        projectId: SOURCE_PROJECT_ID,
                        imageDataUrl: 'data:image/png;base64,aGk=',
                        source: 'generated_variant',
                        generatedAt: 1,
                    }],
                    summary: { recordCount: 1, historyEntryCount: 0, totalApproxBytes: 0 },
                },
            } as unknown as SnapshotPayload['project'],
        };
        const { bundle } = namespaceSnapshotForRestore(withVariants, DEMO_PROJECT_ID);
        const namespacedVersionId = `${DEMO_PROJECT_ID}:${VERSION_ID}`;
        const rec = bundle.mockupVariantImages?.records[0];
        expect(rec?.versionId).toBe(namespacedVersionId);
        expect(rec?.key).toBe(`${namespacedVersionId}:scr-home:mobile:default:low`);
        expect(rec?.projectId).toBe(DEMO_PROJECT_ID);
    });
});

// --- loadDemoSnapshotPublic image hydration -------------------------------
//
// The public demo load is a burst of `2 + imageCount + screenImageCount`
// fetches, so per-image failures (rate limit 429s, flaky mobile networks)
// are a normal event, not an exception. These tests pin the resilience
// contract: transient failures are retried, permanent failures drop only the
// affected image and flag the payload incomplete — they must never reject
// the whole snapshot (which used to silently serve a stale cached demo).

// Strip the dataUrl so a record doubles as its v2 wire-format metadata ref.
const imageMetadataOf = <T extends { dataUrl: string }>(img: T): Omit<T, 'dataUrl'> => {
    const { dataUrl: _omit, ...meta } = img;
    void _omit;
    return meta;
};

type FetchResponder = (url: string, callCount: number) => { status: number; body: unknown };

const okJson = (body: unknown) => ({ status: 200, body });

const installFetchMock = (respond: FetchResponder) => {
    const counts = new Map<string, number>();
    const mock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const n = (counts.get(url) ?? 0) + 1;
        counts.set(url, n);
        const { status, body } = respond(url, n);
        return {
            ok: status >= 200 && status < 300,
            status,
            json: async () => body,
        } as Response;
    });
    vi.stubGlobal('fetch', mock);
    return mock;
};

describe('loadDemoSnapshotPublic — hydration resilience', () => {
    const mockupMeta = imageMetadataOf(makeImage('high'));
    const screenMeta = imageMetadataOf(makeScreenImage(1));
    const demoBundle: SnapshotPayload = {
        ...makeSnapshot(),
        images: [mockupMeta] as unknown as SnapshotPayload['images'],
        screenImages: [screenMeta] as unknown as SnapshotPayload['screenImages'],
    };
    const imageUrl = (key: string) => `/api/snapshots?demo=1&image=${encodeURIComponent(key)}`;

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    const runLoad = async (): Promise<SnapshotPayload | null> => {
        const promise = loadDemoSnapshotPublic();
        // Flush the retry backoff timers (500ms + 1500ms per image, at most).
        await vi.advanceTimersByTimeAsync(10_000);
        return await promise;
    };

    it('retries a transiently failing image fetch and reports a complete payload', async () => {
        const fetchMock = installFetchMock((url, callCount) => {
            if (url === '/api/snapshots?demo=1') return okJson(demoBundle);
            if (url === imageUrl(screenMeta.key)) {
                // First attempt is rate-limited; the retry succeeds.
                if (callCount === 1) return { status: 429, body: { error: 'rate_limited' } };
                return okJson({ image: makeScreenImage(1) });
            }
            if (url === imageUrl(mockupMeta.key)) return okJson({ image: makeImage('high') });
            throw new Error(`unexpected fetch: ${url}`);
        });

        const payload = await runLoad();

        expect(payload?.imagesComplete).toBe(true);
        expect(payload?.images).toHaveLength(1);
        expect(payload?.screenImages).toHaveLength(1);
        expect(payload?.screenImages?.[0].dataUrl).toBe(makeScreenImage(1).dataUrl);
        // 1 bundle + 1 mockup + 2 screen-image attempts.
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('drops a permanently failing image instead of rejecting the whole demo', async () => {
        installFetchMock((url) => {
            if (url === '/api/snapshots?demo=1') return okJson(demoBundle);
            if (url === imageUrl(screenMeta.key)) return { status: 429, body: { error: 'rate_limited' } };
            if (url === imageUrl(mockupMeta.key)) return okJson({ image: makeImage('high') });
            throw new Error(`unexpected fetch: ${url}`);
        });

        const payload = await runLoad();

        // The healthy mockup image survives; the failing screen image is
        // dropped and the payload is flagged incomplete so loadDemoProject
        // skips stamping the cache and self-heals on the next open.
        expect(payload?.images).toHaveLength(1);
        expect(payload?.screenImages).toHaveLength(0);
        expect(payload?.imagesComplete).toBe(false);
    });
});
