// Owner-only project snapshots. Bundles the per-project slice of the Zustand
// store together with that project's IndexedDB-backed mockup images, then
// pushes the whole bundle to the /api/snapshots endpoint, which writes it to
// Vercel Blob behind a SYNAPSE_OWNER_TOKEN gate.
//
// The owner token is entered once via the Snapshots panel and stored in
// localStorage under OWNER_TOKEN_KEY. Demo viewers never see snapshots —
// the panel is gated by token presence and every API call requires it.
//
// One snapshot can also be designated "the demo project": the server keeps a
// pointer blob (_demo.json) and exposes a public `?demo=1` read so anonymous
// visitors can load it from the home page without an owner token.
//
// Save/load splits images out of the JSON envelope. Each mockup image (base64
// PNG, 1–3 MB) is shipped as its own request so neither the upload body nor
// the download response crosses Vercel's ~4.5 MB serverless cap. The initial
// POST/GET carries the project bundle plus a list of image *metadata*
// records (no `dataUrl`); the per-image dataUrls are uploaded/fetched one at
// a time. Legacy v1 snapshots that still embed dataUrls inline are detected
// on load and returned as-is.

import type {
    Project, SpineVersion, HistoryEvent, Branch,
    Artifact, ArtifactVersion, FeedbackItem, MockupImageRecord,
    ScreenInventoryImageRecord, ProjectTask, WorkflowRun,
    MockupVariantImageRecord,
    ReviewRun, SpecialistRun, SpecialistFinding, ReviewIssue, PlanningRecord,
    ReadinessReview, ReadinessCommitmentEvent,
} from '../types';
import { useProjectStore } from '../store/projectStore';
import { buildImageKey, listImagesForVersion, putImage, deleteImagesForVersion } from './mockupImageStore';
import {
    buildScreenImageKey,
    listScreenImagesForArtifactVersion,
    putScreenImage,
    deleteScreenImagesForArtifactVersion,
} from './screenInventoryImageStore';
import {
    listVariantImagesForVersion,
    putVariantImage,
} from './mockupVariantImageStore';
import {
    buildMockupVariantImageSnapshot,
    splitVariantSnapshotImages,
    collectVariantSnapshotImageRefs,
    joinVariantSnapshotImages,
    namespaceVariantSnapshot,
    restoreMockupVariantImageSnapshot,
    type MockupVariantImageSnapshot,
} from './mockupVariantSnapshot';
import { useMockupVariantImageStore } from '../store/mockupVariantImageStore';

export const OWNER_TOKEN_KEY = 'synapse-owner-token';

export type SnapshotProjectBundle = {
    project: Project;
    spineVersions: SpineVersion[];
    historyEvents: HistoryEvent[];
    branches: Branch[];
    artifacts: Artifact[];
    artifactVersions: ArtifactVersion[];
    feedbackItems: FeedbackItem[];
    // Persisted store slices that were previously omitted from snapshots, so a
    // restored project carries its implementation tasks and orchestration
    // metrics too. Optional on the wire — snapshots saved before this layer
    // existed won't have them, and restore defaults to [].
    tasks?: ProjectTask[];
    workflowRuns?: WorkflowRun[];
    reviewRuns?: ReviewRun[];
    specialistRuns?: SpecialistRun[];
    reviewFindings?: SpecialistFinding[];
    reviewIssues?: ReviewIssue[];
    planningRecords?: PlanningRecord[];
    readinessReviews?: ReadinessReview[];
    readinessCommitmentEvents?: ReadinessCommitmentEvent[];
    // Phase 3D: per-variant mockup images (the Screens Mockups-tab variant
    // gallery) live in a dedicated IndexedDB store. They ride INSIDE the bundle
    // (which the server persists verbatim) in their WIRE form — image bytes are
    // stripped and shipped through the same per-image blob channel as the other
    // two image kinds. Optional on the wire — older snapshots won't have it, and
    // restore is a no-op when it's absent.
    mockupVariantImages?: MockupVariantImageSnapshot;
};

export type SnapshotManifest = {
    id: string;
    title: string;
    projectName: string;
    createdAt: string;
    schemaVersion: number;
    imageCount: number;
    // Count of user-uploaded Screen Inventory images bundled alongside the
    // mockup images. Optional for back-compat with pre-existing manifests.
    screenImageCount?: number;
    sizeBytes?: number;
};

export type SnapshotPayload = {
    schemaVersion: number;
    manifest: SnapshotManifest;
    project: SnapshotProjectBundle;
    images: MockupImageRecord[];
    // User-uploaded Screen Inventory images. Lives in a separate IndexedDB
    // store from mockup images (`screenInventoryImageStore`), so it travels as
    // its own array. Optional on the wire — older snapshots won't have it.
    screenImages?: ScreenInventoryImageRecord[];
    // Client-side only (never on the wire): false when the demo load had to
    // drop one or more images whose per-image fetch kept failing (flaky mobile
    // network / rate limit). `loadDemoProject` uses it to skip stamping
    // `demoSourceSnapshotId`, so the next demo open re-fetches and self-heals.
    imagesComplete?: boolean;
};

export type SnapshotListItem = SnapshotManifest & { isDemo?: boolean };

export type SnapshotListResult = {
    snapshots: SnapshotListItem[];
    demoSnapshotId: string | null;
};

// Progress callback shape. `phase` lets the UI render different messages
// for "uploading the bundle" vs "uploading image N of M". `total` is 0 for
// the bundle phase.
export type SnapshotProgress = {
    phase: 'bundle' | 'images';
    completed: number;
    total: number;
};
export type SnapshotProgressCallback = (p: SnapshotProgress) => void;

const API_BASE = '/api/snapshots';

export const getOwnerToken = (): string | null => {
    try {
        return localStorage.getItem(OWNER_TOKEN_KEY);
    } catch {
        return null;
    }
};

export const setOwnerToken = (token: string): void => {
    try {
        if (token) localStorage.setItem(OWNER_TOKEN_KEY, token);
        else localStorage.removeItem(OWNER_TOKEN_KEY);
    } catch {
        // ignore — quota / privacy mode
    }
};

const authHeaders = (): Record<string, string> => {
    const token = getOwnerToken();
    if (!token) throw new Error('Owner token not set. Add it in the Snapshots panel.');
    return { Authorization: `Bearer ${token}` };
};

// The server returns { error: 'code', message: 'human-readable detail' }. The
// panel only renders one string, so we prefer the message when it exists and
// fall back to the code; on parse failure we fall back to the status.
const errorFromResponse = async (resp: Response, fallbackCode: string): Promise<Error> => {
    const body = await resp.json().catch(() => null) as { error?: string; message?: string } | null;
    const message = typeof body?.message === 'string' && body.message.length > 0 ? body.message : null;
    const code = typeof body?.error === 'string' && body.error.length > 0 ? body.error : null;
    if (message && code) return new Error(`${code}: ${message}`);
    if (message) return new Error(message);
    if (code) return new Error(code);
    return new Error(`${fallbackCode}_${resp.status}`);
};

// Pull the per-project slice out of Zustand. We snapshot the store at one
// point in time so concurrent edits don't tear the bundle.
export const collectProjectBundle = (projectId: string): SnapshotProjectBundle => {
    const state = useProjectStore.getState();
    const project = state.projects[projectId];
    if (!project) throw new Error(`Project ${projectId} not found in store`);
    return {
        project,
        spineVersions: state.spineVersions[projectId] ?? [],
        historyEvents: state.historyEvents[projectId] ?? [],
        branches: state.branches[projectId] ?? [],
        artifacts: state.artifacts[projectId] ?? [],
        artifactVersions: state.artifactVersions[projectId] ?? [],
        feedbackItems: state.feedbackItems[projectId] ?? [],
        tasks: state.tasks[projectId] ?? [],
        workflowRuns: state.workflowRuns[projectId] ?? [],
        reviewRuns: state.reviewRuns[projectId] ?? [],
        specialistRuns: state.specialistRuns[projectId] ?? [],
        reviewFindings: state.reviewFindings[projectId] ?? [],
        reviewIssues: state.reviewIssues[projectId] ?? [],
        planningRecords: state.planningRecords[projectId] ?? [],
        readinessReviews: state.readinessReviews[projectId] ?? [],
        readinessCommitmentEvents: state.readinessCommitmentEvents[projectId] ?? [],
    };
};

// Gather every IDB image record tied to one of this project's artifact
// versions. The store keys artifactVersions by projectId, so the bundle's
// version list already represents this project exhaustively. The IDB index
// is keyed by versionId, so we walk that for each version.
//
// We deliberately do NOT filter on `record.projectId`. Artifact version ids
// are unique per project (and the demo restore namespaces them — see
// `namespaceSnapshotForRestore`), so a version id unambiguously identifies the
// owning project. Filtering on the stored `projectId` used to silently drop
// images whose tag had drifted (e.g. records left tagged with the demo project
// id by the old restore path), which is exactly how snapshots ended up
// "losing" mockup images.
const collectProjectImages = async (bundle: SnapshotProjectBundle): Promise<MockupImageRecord[]> => {
    const out: MockupImageRecord[] = [];
    for (const v of bundle.artifactVersions) {
        const records = await listImagesForVersion(v.id);
        out.push(...records);
    }
    return out;
};

// Gather every user-uploaded Screen Inventory image tied to one of this
// project's artifact versions. Same rationale as `collectProjectImages`: the
// IDB store is indexed by `artifactVersionId`, and a version id unambiguously
// identifies its owning project, so we walk by version id and never filter on
// the (drift-prone) stored `projectId`.
const collectScreenImages = async (
    bundle: SnapshotProjectBundle,
): Promise<ScreenInventoryImageRecord[]> => {
    const out: ScreenInventoryImageRecord[] = [];
    for (const v of bundle.artifactVersions) {
        const records = await listScreenImagesForArtifactVersion(v.id);
        out.push(...records);
    }
    return out;
};

// Gather every per-variant mockup image record (Phase 3B/3C) tied to one of
// this project's artifact versions and serialize them into the portable,
// size-guarded snapshot format. Same by-version walk as the other image
// collectors — the variant IDB store is indexed by `versionId`.
const collectVariantImages = async (
    bundle: SnapshotProjectBundle,
): Promise<MockupVariantImageSnapshot> => {
    const records: MockupVariantImageRecord[] = [];
    for (const v of bundle.artifactVersions) {
        const forVersion = await listVariantImagesForVersion(v.id);
        records.push(...forVersion);
    }
    return buildMockupVariantImageSnapshot(records, { projectId: bundle.project.id });
};

// Strip the (large) base64 payload off an image record so the bundle POST
// only carries the routing metadata. The dataUrl is uploaded in its own
// request immediately after.
const imageMetadata = <T extends { dataUrl: string }>(img: T): Omit<T, 'dataUrl'> => {
    // We intentionally destructure-then-discard so a future field added to
    // an image record automatically makes it into the metadata blob. Generic
    // over the record shape so it serves both mockup and screen-inventory
    // images.
    const { dataUrl: _dataUrl, ...meta } = img;
    void _dataUrl;
    return meta;
};

export const saveSnapshot = async (
    projectId: string,
    title: string,
    onProgress?: SnapshotProgressCallback,
    onWarnings?: (warnings: string[]) => void,
): Promise<SnapshotManifest> => {
    const bundle = collectProjectBundle(projectId);
    const images = await collectProjectImages(bundle);
    const screenImages = await collectScreenImages(bundle);

    // Phase 3D: serialize the per-variant mockup images, then split their bytes
    // out of the JSON envelope. The stripped (metadata-only) snapshot rides
    // inside the bundle (the server persists `project` verbatim); the bytes join
    // the per-image upload channel below. Any records the size guards dropped
    // surface as non-fatal warnings.
    const fullVariantSnapshot = await collectVariantImages(bundle);
    const { snapshot: variantWire, images: variantImages } =
        splitVariantSnapshotImages(fullVariantSnapshot);
    bundle.mockupVariantImages = variantWire;
    if (onWarnings && fullVariantSnapshot.summary.warnings?.length) {
        onWarnings(fullVariantSnapshot.summary.warnings);
    }

    onProgress?.({ phase: 'bundle', completed: 0, total: 0 });

    // Step 1 — POST the project bundle plus image metadata only. This is
    // bounded (typically a few hundred KB) regardless of how many or how
    // large the mockup / screen images are.
    const bundleResp = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
            title,
            project: bundle,
            images: images.map(imageMetadata),
            screenImages: screenImages.map(imageMetadata),
        }),
    });
    if (!bundleResp.ok) throw await errorFromResponse(bundleResp, 'save_failed');
    const { id, manifest } = await bundleResp.json() as { id: string; manifest: SnapshotManifest };

    // Step 2 — upload each image as a separate request. We go sequentially
    // so a slow/flaky uplink doesn't try to push all images at once and so
    // browsers don't hold every base64 payload in flight concurrently. Mockup,
    // screen-inventory, and per-variant mockup images share the same per-image
    // endpoint (the server keys each blob by a hash of the image key, and the
    // key shapes never collide — variant keys are `vimg:`-prefixed), so we
    // upload them in one combined pass.
    const allImages: Array<{ key: string; dataUrl: string }> =
        [...images, ...screenImages, ...variantImages];
    onProgress?.({ phase: 'images', completed: 0, total: allImages.length });
    for (let i = 0; i < allImages.length; i++) {
        const img = allImages[i];
        const resp = await fetch(`${API_BASE}?id=${encodeURIComponent(id)}&image=1`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ image: img }),
        });
        if (!resp.ok) throw await errorFromResponse(resp, 'save_image_failed');
        onProgress?.({ phase: 'images', completed: i + 1, total: allImages.length });
    }

    return manifest;
};

export const listSnapshots = async (): Promise<SnapshotListResult> => {
    const resp = await fetch(API_BASE, { headers: authHeaders() });
    if (!resp.ok) throw await errorFromResponse(resp, 'list_failed');
    const data = await resp.json();
    const snapshots: SnapshotListItem[] = Array.isArray(data?.snapshots) ? data.snapshots : [];
    const demoSnapshotId: string | null =
        typeof data?.demoSnapshotId === 'string' ? data.demoSnapshotId : null;
    return { snapshots, demoSnapshotId };
};

// Owner-only: pin a snapshot as the demo project. Pass null to clear.
export const setDemoSnapshot = async (snapshotId: string | null): Promise<string | null> => {
    const url = snapshotId
        ? `${API_BASE}?demo=1&id=${encodeURIComponent(snapshotId)}`
        : `${API_BASE}?demo=1`;
    const resp = await fetch(url, { method: 'PUT', headers: authHeaders() });
    if (!resp.ok) throw await errorFromResponse(resp, 'set_demo_failed');
    const body = await resp.json();
    return typeof body?.demoSnapshotId === 'string' ? body.demoSnapshotId : null;
};

// True if the bundle still has every image dataUrl inline — i.e. a legacy
// v1 snapshot. v2 bundles return image metadata only and need a follow-up
// fetch per image to hydrate the dataUrls.
const isFullyInlined = (images: unknown[]): boolean => {
    if (!Array.isArray(images)) return false;
    if (images.length === 0) return true;
    return images.every((img) =>
        img != null
        && typeof img === 'object'
        && typeof (img as { dataUrl?: unknown }).dataUrl === 'string',
    );
};

// Backoff between per-image fetch attempts. A transient 429 (the demo load is
// a burst of N+2 requests against one rate-limit scope) or a mobile-network
// blip on one image must not cost the whole snapshot.
const IMAGE_RETRY_DELAYS_MS = [500, 1500];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Fetch one image record, retrying transient failures (non-2xx responses and
// thrown network errors). A malformed body is permanent — retrying won't fix
// it — so it fails immediately.
const fetchImageWithRetry = async <T extends { key: string; dataUrl: string }>(
    fetchOne: (key: string) => Promise<Response>,
    key: string,
): Promise<T> => {
    let lastError: Error = new Error(`load_image_failed: ${key}`);
    for (let attempt = 0; attempt <= IMAGE_RETRY_DELAYS_MS.length; attempt++) {
        if (attempt > 0) await sleep(IMAGE_RETRY_DELAYS_MS[attempt - 1]);
        try {
            const resp = await fetchOne(key);
            if (!resp.ok) {
                lastError = await errorFromResponse(resp, 'load_image_failed');
                continue;
            }
            const body = await resp.json() as { image?: T };
            if (!body?.image || typeof body.image.dataUrl !== 'string') {
                throw new Error(`load_image_failed: malformed image record for ${key}`);
            }
            return body.image;
        } catch (err) {
            if (err instanceof Error && err.message.startsWith('load_image_failed: malformed')) {
                throw err;
            }
            lastError = err instanceof Error ? err : new Error(String(err));
        }
    }
    throw lastError;
};

type HydrateResult<T> = { images: T[]; failedKeys: string[] };

// Pull each image blob into a full record. Runs the fetches with a small
// concurrency limit so a project with dozens of screens doesn't try to open a
// fetch for every one simultaneously. With `tolerateFailures`, an image whose
// fetch permanently fails is dropped (reported in `failedKeys`) instead of
// rejecting the whole hydration — the public demo path uses this so one bad
// image on a flaky mobile connection can't discard the entire fresh snapshot.
const hydrateImages = async <T extends { key: string; dataUrl: string }>(
    fetchOne: (key: string) => Promise<Response>,
    refs: Array<Omit<T, 'dataUrl'>>,
    options?: { tolerateFailures?: boolean },
): Promise<HydrateResult<T>> => {
    const CONCURRENCY = 4;
    const out: Array<T | undefined> = new Array(refs.length);
    const failedKeys: string[] = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, refs.length) }, async () => {
        while (true) {
            const idx = cursor++;
            if (idx >= refs.length) return;
            const ref = refs[idx];
            try {
                out[idx] = await fetchImageWithRetry<T>(fetchOne, ref.key);
            } catch (err) {
                if (!options?.tolerateFailures) throw err;
                console.warn(`[snapshots] dropping image ${ref.key} after retries`, err);
                failedKeys.push(ref.key);
            }
        }
    });
    await Promise.all(workers);
    return { images: out.filter((img): img is T => img !== undefined), failedKeys };
};

// Hydrate the optional `screenImages` array of a payload using the same
// per-image fetch the mockup images use. Returns the payload's array unchanged
// when it carries no screen images (legacy snapshots) or they are already
// inlined.
const hydrateScreenImages = async (
    payload: SnapshotPayload,
    fetchOne: (key: string) => Promise<Response>,
    options?: { tolerateFailures?: boolean },
): Promise<{ images: ScreenInventoryImageRecord[] | undefined; failedKeys: string[] }> => {
    const screenImages = payload.screenImages;
    if (!Array.isArray(screenImages) || screenImages.length === 0) {
        return { images: screenImages, failedKeys: [] };
    }
    if (isFullyInlined(screenImages)) return { images: screenImages, failedKeys: [] };
    return await hydrateImages<ScreenInventoryImageRecord>(
        fetchOne,
        screenImages as unknown as Array<Omit<ScreenInventoryImageRecord, 'dataUrl'>>,
        options,
    );
};

// Hydrate the per-variant mockup image bytes for a payload. The wire snapshot
// (inside `payload.project.mockupVariantImages`) references its image bytes by
// `vimg:`-prefixed keys; we fetch each through the same per-image channel the
// mockup/screen images use, re-attach them, and write the joined snapshot back
// onto the payload. A ref that keeps failing is dropped (reported in failedKeys)
// so one bad image never poisons the whole restore. Returns the failed keys so
// the caller can factor them into `imagesComplete`.
const hydrateVariantImages = async (
    payload: SnapshotPayload,
    fetchOne: (key: string) => Promise<Response>,
    options?: { tolerateFailures?: boolean },
): Promise<string[]> => {
    const wire = payload.project?.mockupVariantImages;
    const refs = collectVariantSnapshotImageRefs(wire);
    if (!wire || refs.length === 0) return [];

    // Reuse the mockup image hydration machinery: it expects
    // `{ key, dataUrl }`-shaped records keyed by the image key.
    const { images, failedKeys } = await hydrateImages<{ key: string; dataUrl: string }>(
        fetchOne,
        refs.map((key) => ({ key })),
        options,
    );
    const byKey = new Map(images.map((img) => [img.key, img.dataUrl]));
    payload.project.mockupVariantImages = joinVariantSnapshotImages(wire, byKey);
    return failedKeys;
};

// Public, lightweight: read just the demo pointer so callers can decide
// whether their cached demo project is still current without paying the
// full bundle+image download. Returns null when no demo has been pinned
// or the probe fails — the caller is expected to fall back to its cache.
export type DemoPointer = { snapshotId: string; updatedAt: string | null };

export const loadDemoSnapshotPointer = async (): Promise<DemoPointer | null> => {
    const resp = await fetch(`${API_BASE}?demo=1&pointer=1`);
    if (!resp.ok) return null;
    const body = await resp.json().catch(() => null) as
        | { snapshotId?: unknown; updatedAt?: unknown }
        | null;
    if (!body || typeof body.snapshotId !== 'string' || body.snapshotId.length === 0) {
        return null;
    }
    return {
        snapshotId: body.snapshotId,
        updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : null,
    };
};

// Public: fetch the snapshot the owner has marked as the demo. No auth.
// Returns null when no demo has been set (server returns 404 in that case).
//
// Image hydration is failure-tolerant here: an image that keeps failing after
// retries is dropped and `imagesComplete` is set false, so a single flaky
// fetch on a mobile connection serves a fresh (mostly complete) demo instead
// of silently falling back to a stale cached one.
export const loadDemoSnapshotPublic = async (): Promise<SnapshotPayload | null> => {
    const resp = await fetch(`${API_BASE}?demo=1`);
    if (resp.status === 404) return null;
    if (!resp.ok) throw await errorFromResponse(resp, 'load_demo_failed');
    const payload = await resp.json() as SnapshotPayload;
    const fetchOne = (key: string) => fetch(`${API_BASE}?demo=1&image=${encodeURIComponent(key)}`);
    const tolerate = { tolerateFailures: true };
    const mockups = isFullyInlined(payload.images)
        ? { images: payload.images, failedKeys: [] as string[] }
        : await hydrateImages<MockupImageRecord>(
            fetchOne,
            payload.images as unknown as Array<Omit<MockupImageRecord, 'dataUrl'>>,
            tolerate,
        );
    const screens = await hydrateScreenImages(payload, fetchOne, tolerate);
    const variantFailed = await hydrateVariantImages(payload, fetchOne, tolerate);
    return {
        ...payload,
        images: mockups.images,
        screenImages: screens.images,
        imagesComplete:
            mockups.failedKeys.length === 0
            && screens.failedKeys.length === 0
            && variantFailed.length === 0,
    };
};

// Owner-only load. Hydration retries transient failures but stays strict —
// an owner restore should fail loudly rather than restore an incomplete
// snapshot over real data.
export const loadSnapshot = async (id: string): Promise<SnapshotPayload> => {
    const resp = await fetch(`${API_BASE}?id=${encodeURIComponent(id)}`, { headers: authHeaders() });
    if (!resp.ok) throw await errorFromResponse(resp, 'load_failed');
    const payload = await resp.json() as SnapshotPayload;
    const fetchOne = (key: string) => fetch(
        `${API_BASE}?id=${encodeURIComponent(id)}&image=${encodeURIComponent(key)}`,
        { headers: authHeaders() },
    );
    const mockups = isFullyInlined(payload.images)
        ? { images: payload.images }
        : await hydrateImages<MockupImageRecord>(
            fetchOne,
            payload.images as unknown as Array<Omit<MockupImageRecord, 'dataUrl'>>,
        );
    const screens = await hydrateScreenImages(payload, fetchOne);
    await hydrateVariantImages(payload, fetchOne);
    return { ...payload, images: mockups.images, screenImages: screens.images };
};

export const deleteSnapshot = async (id: string): Promise<void> => {
    const resp = await fetch(`${API_BASE}?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
    });
    if (!resp.ok) throw await errorFromResponse(resp, 'delete_failed');
};

// Repopulate the IndexedDB mockup-image store for a set of records, clearing
// each touched version first so a restore is a clean replace, not a merge.
const restoreMockupImagesToIdb = async (images: MockupImageRecord[]): Promise<void> => {
    const versionIds = new Set(images.map((r) => r.versionId));
    for (const vid of versionIds) {
        await deleteImagesForVersion(vid);
    }
    for (const record of images) {
        await putImage(record);
    }
};

// Same as above for the separate Screen Inventory image store, keyed by
// `artifactVersionId`. No-op when the snapshot predates screen-image capture.
const restoreScreenImagesToIdb = async (
    screenImages: ScreenInventoryImageRecord[] | undefined,
): Promise<void> => {
    if (!screenImages || screenImages.length === 0) return;
    const versionIds = new Set(screenImages.map((r) => r.artifactVersionId));
    for (const vid of versionIds) {
        await deleteScreenImagesForArtifactVersion(vid);
    }
    for (const record of screenImages) {
        await putScreenImage(record);
    }
};

// Phase 3D: hydrate the per-variant mockup images into the dedicated variant
// IndexedDB store + the reactive cache. Unlike the mockup/screen restores (a
// clean delete-then-put replace), this uses CONSERVATIVE merge semantics
// (`restoreMockupVariantImageSnapshot`) so a newer local variant is never
// clobbered by an older snapshot copy — the snapshot copy is preserved in
// history instead. A malformed variant section is skipped without throwing, so
// it never breaks the surrounding project restore. Returns any restore warnings.
const restoreVariantImagesToIdb = async (
    snapshot: MockupVariantImageSnapshot | undefined,
): Promise<string[]> => {
    if (!snapshot) return [];
    try {
        const result = await restoreMockupVariantImageSnapshot(snapshot, {
            listExisting: listVariantImagesForVersion,
            put: putVariantImage,
            notify: (records) => useMockupVariantImageStore.getState().mergeRecords(records),
        });
        return result.warnings;
    } catch (err) {
        console.warn('[snapshots] mockup variant images could not be restored', err);
        return ['Mockup variant images could not be restored.'];
    }
};

// Restore a snapshot into the live store. Replaces any existing project with
// the same id (we use the snapshot's project id directly so external
// references — e.g. screen URLs — keep working). Images are repopulated in
// IndexedDB for the project's mockup and screen-inventory versions.
export const restoreSnapshot = async (snapshot: SnapshotPayload): Promise<string> => {
    const { project: bundle, images } = snapshot;
    const projectId = bundle.project.id;

    // Repopulate IDB images first, before we expose the project in the store,
    // so renderers don't briefly see "missing image" placeholders.
    await restoreMockupImagesToIdb(images);
    await restoreScreenImagesToIdb(snapshot.screenImages);
    await restoreVariantImagesToIdb(bundle.mockupVariantImages);

    // Splice the bundle back into the Zustand store. We mutate the store
    // imperatively because there's no public action for "replace one project
    // wholesale" — that's a deliberately rare operation.
    useProjectStore.setState((state) => ({
        projects: { ...state.projects, [projectId]: bundle.project },
        spineVersions: { ...state.spineVersions, [projectId]: bundle.spineVersions },
        historyEvents: { ...state.historyEvents, [projectId]: bundle.historyEvents },
        branches: { ...state.branches, [projectId]: bundle.branches },
        artifacts: { ...state.artifacts, [projectId]: bundle.artifacts },
        artifactVersions: { ...state.artifactVersions, [projectId]: bundle.artifactVersions },
        feedbackItems: { ...state.feedbackItems, [projectId]: bundle.feedbackItems },
        tasks: { ...state.tasks, [projectId]: bundle.tasks ?? [] },
        workflowRuns: { ...state.workflowRuns, [projectId]: bundle.workflowRuns ?? [] },
        reviewRuns: { ...state.reviewRuns, [projectId]: bundle.reviewRuns ?? [] },
        specialistRuns: { ...state.specialistRuns, [projectId]: bundle.specialistRuns ?? [] },
        reviewFindings: { ...state.reviewFindings, [projectId]: bundle.reviewFindings ?? [] },
        reviewIssues: { ...state.reviewIssues, [projectId]: bundle.reviewIssues ?? [] },
        planningRecords: { ...state.planningRecords, [projectId]: bundle.planningRecords ?? [] },
        readinessReviews: { ...state.readinessReviews, [projectId]: bundle.readinessReviews ?? [] },
        readinessCommitmentEvents: {
            ...state.readinessCommitmentEvents,
            [projectId]: bundle.readinessCommitmentEvents ?? [],
        },
    }));

    return projectId;
};

// Deep-clone a value while replacing every string that EXACTLY equals a key in
// `idMap` with its mapped value. Exact-string matching (never substring) keeps
// this safe to run over PRD prose / markdown — only standalone id fields are
// rewritten, never an id that happens to appear inside a longer string.
const rewriteIds = <T,>(value: T, idMap: Map<string, string>): T => {
    if (Array.isArray(value)) {
        return value.map((v) => rewriteIds(v, idMap)) as unknown as T;
    }
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            out[k] = rewriteIds(v, idMap);
        }
        return out as T;
    }
    if (typeof value === 'string' && idMap.has(value)) {
        return idMap.get(value) as unknown as T;
    }
    return value;
};

// Produce a copy of a snapshot whose ids are namespaced under `targetProjectId`
// so the restored project shares NO ids — and therefore no IndexedDB image
// keys — with any real project already on this device.
//
// This is the crux of the "setting a project as demo wiped its mockup images"
// bug. Mockup images are keyed in IndexedDB by `versionId` (the artifact
// version id). The demo restore reuses the source project's bundle, so without
// remapping, the demo and its source project reference the *same* artifact
// version ids — and `restoreSnapshotAs` would `deleteImagesForVersion()` and
// overwrite the source project's own images. Remapping every artifact version
// id (and rebuilding each image's composite key) isolates the demo completely.
//
// Pure: no IndexedDB / store access, so it is unit-testable in isolation.
export const namespaceSnapshotForRestore = (
    snapshot: SnapshotPayload,
    targetProjectId: string,
): {
    bundle: SnapshotProjectBundle;
    images: MockupImageRecord[];
    screenImages: ScreenInventoryImageRecord[];
} => {
    const sourceId = snapshot.project.project.id;
    const screenImagesIn = snapshot.screenImages ?? [];

    const idMap = new Map<string, string>();
    if (sourceId !== targetProjectId) {
        idMap.set(sourceId, targetProjectId);
        // Namespace every artifact version id deterministically so repeated
        // restores are idempotent and never collide with a real project's
        // bare-UUID version ids.
        for (const v of snapshot.project.artifactVersions) {
            if (v.id) idMap.set(v.id, `${targetProjectId}:${v.id}`);
        }
    }

    if (idMap.size === 0) {
        return { bundle: snapshot.project, images: snapshot.images, screenImages: screenImagesIn };
    }

    const bundle = rewriteIds(snapshot.project, idMap);
    // The variant snapshot's composite `key` embeds the versionId (with colons),
    // so exact-string rewriteIds can't fix it — rebuild the keys (and projectId)
    // deterministically from the source snapshot so re-restores stay idempotent.
    if (snapshot.project.mockupVariantImages) {
        bundle.mockupVariantImages = namespaceVariantSnapshot(
            snapshot.project.mockupVariantImages, idMap, targetProjectId,
        );
    }
    const images = snapshot.images.map((record) => {
        const next = rewriteIds(record, idMap);
        // The composite `key` embeds the versionId, so rebuild it from the
        // remapped fields rather than relying on exact-string replacement.
        return { ...next, key: buildImageKey(next.versionId, next.screenId, next.quality) };
    });
    // Screen Inventory images are keyed in IDB by `artifactVersionId`, so they
    // need the same remap as mockup images — otherwise a demo restored from a
    // real project would share version ids and `restoreSnapshotAs`'s
    // delete-then-put would wipe the source project's screen images.
    const screenImages = screenImagesIn.map((record) => {
        const next = rewriteIds(record, idMap);
        return {
            ...next,
            key: buildScreenImageKey(next.artifactVersionId, next.screenSlug, next.versionNumber),
        };
    });

    return { bundle, images, screenImages };
};

// Restore a snapshot into the store under a fixed `targetProjectId` instead
// of the snapshot's own id. Used by `loadDemoProject` so the demo always
// lives at `/p/<DEMO_PROJECT_ID>` regardless of which real project the owner
// saved as the demo source.
export const restoreSnapshotAs = async (
    snapshot: SnapshotPayload,
    targetProjectId: string,
): Promise<string> => {
    const { bundle: remapped, images, screenImages } = namespaceSnapshotForRestore(snapshot, targetProjectId);

    await restoreMockupImagesToIdb(images);
    await restoreScreenImagesToIdb(screenImages);
    await restoreVariantImagesToIdb(remapped.mockupVariantImages);

    useProjectStore.setState((state) => ({
        projects: { ...state.projects, [targetProjectId]: remapped.project },
        spineVersions: { ...state.spineVersions, [targetProjectId]: remapped.spineVersions },
        historyEvents: { ...state.historyEvents, [targetProjectId]: remapped.historyEvents },
        branches: { ...state.branches, [targetProjectId]: remapped.branches ?? [] },
        artifacts: { ...state.artifacts, [targetProjectId]: remapped.artifacts },
        artifactVersions: { ...state.artifactVersions, [targetProjectId]: remapped.artifactVersions },
        feedbackItems: { ...state.feedbackItems, [targetProjectId]: remapped.feedbackItems ?? [] },
        tasks: { ...state.tasks, [targetProjectId]: remapped.tasks ?? [] },
        workflowRuns: { ...state.workflowRuns, [targetProjectId]: remapped.workflowRuns ?? [] },
        reviewRuns: { ...state.reviewRuns, [targetProjectId]: remapped.reviewRuns ?? [] },
        specialistRuns: { ...state.specialistRuns, [targetProjectId]: remapped.specialistRuns ?? [] },
        reviewFindings: { ...state.reviewFindings, [targetProjectId]: remapped.reviewFindings ?? [] },
        reviewIssues: { ...state.reviewIssues, [targetProjectId]: remapped.reviewIssues ?? [] },
        planningRecords: { ...state.planningRecords, [targetProjectId]: remapped.planningRecords ?? [] },
        readinessReviews: { ...state.readinessReviews, [targetProjectId]: remapped.readinessReviews ?? [] },
        readinessCommitmentEvents: {
            ...state.readinessCommitmentEvents,
            [targetProjectId]: remapped.readinessCommitmentEvents ?? [],
        },
    }));

    return targetProjectId;
};
