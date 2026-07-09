import { describe, it, expect } from 'vitest';
import type { MockupCoverageManifest, MockupVariantImageRecord } from '../../types';
import {
    buildMockupVariantImageSnapshot,
    validateMockupVariantImageSnapshot,
    estimateMockupVariantSnapshotSize,
    splitVariantSnapshotImages,
    joinVariantSnapshotImages,
    collectVariantSnapshotImageRefs,
    restoreMockupVariantImageSnapshot,
    mergeVariantRecords,
    namespaceVariantSnapshot,
    parseImageDataUrl,
    MAX_VARIANT_IMAGE_BYTES,
    type MockupVariantImageSnapshot,
} from '../mockupVariantSnapshot';

// A valid, small base64 PNG data URL (bytes are arbitrary — only the header +
// base64 shape matter to the safety checks).
const PNG = 'data:image/png;base64,aGVsbG8td29ybGQ=';
const PNG2 = 'data:image/png;base64,c2Vjb25kLXJlbmRlcg==';

const manifest = (): MockupCoverageManifest => ({
    variant: { viewport: 'mobile', stateName: 'Default' },
    overallStatus: 'aligned',
    estimated: true,
    uiRegions: [{ label: 'Feed', status: 'covered' }],
    states: [], userActions: [], acceptanceCriteria: [], warnings: [],
});

const makeRecord = (
    overrides: Partial<MockupVariantImageRecord> = {},
): MockupVariantImageRecord => ({
    key: 'v1:scr-home:mobile:default:low',
    projectId: 'p1',
    artifactId: 'a1',
    versionId: 'v1',
    screenId: 'scr-home',
    variantId: 'mobile:default',
    viewport: 'mobile',
    stateName: 'Default',
    dataUrl: PNG,
    quality: 'low',
    prompt: 'prompt',
    coverageManifest: manifest(),
    sourceSignature: {
        screenId: 'scr-home', viewport: 'mobile', stateName: 'Default',
        variantId: 'mobile:default', screenContractHash: 'hash-a',
        createdAt: '2026-01-01T00:00:00.000Z',
    },
    generatedFrom: { prdVersionId: 'prd-1', screenVersionId: 'inv-1', designSystemVersionId: 'ds-1' },
    generatedAt: 1000,
    ...overrides,
});

describe('buildMockupVariantImageSnapshot', () => {
    it('serializes a variant with image, manifest, source signature, generatedFrom, and history', () => {
        const rec = makeRecord({
            history: [{
                dataUrl: PNG2, quality: 'low', coverageManifest: manifest(),
                generatedAt: 500, reason: 'regenerated',
            }],
        });
        const snap = buildMockupVariantImageSnapshot([rec], { exportedAt: 'now', projectId: 'p1' });
        expect(snap.schemaVersion).toBe(1);
        expect(snap.projectId).toBe('p1');
        expect(snap.records).toHaveLength(1);
        const out = snap.records[0];
        expect(out.imageDataUrl).toBe(PNG);
        expect(out.manifest?.overallStatus).toBe('aligned');
        expect(out.sourceSignature?.screenContractHash).toBe('hash-a');
        expect(out.generatedFrom?.prdVersionId).toBe('prd-1');
        expect(out.source).toBe('generated_variant');
        expect(out.history).toHaveLength(1);
        expect(out.history?.[0].imageDataUrl).toBe(PNG2);
        expect(snap.summary.recordCount).toBe(1);
        expect(snap.summary.historyEntryCount).toBe(1);
    });

    it('serializes a default sidecar as metadata-only (no image)', () => {
        const sidecar = makeRecord({
            key: 'v1:scr-home:default:low', variantId: 'default', viewport: 'desktop',
            dataUrl: '', prompt: '',
        });
        const snap = buildMockupVariantImageSnapshot([sidecar], { exportedAt: 'now' });
        expect(snap.records).toHaveLength(1);
        expect(snap.records[0].source).toBe('default_sidecar');
        expect(snap.records[0].imageDataUrl).toBeUndefined();
        expect(snap.records[0].manifest?.overallStatus).toBe('aligned');
    });

    it('skips a non-default record that has no restorable image', () => {
        const rec = makeRecord({ dataUrl: '' });
        const snap = buildMockupVariantImageSnapshot([rec], { exportedAt: 'now' });
        expect(snap.records).toHaveLength(0);
        expect(snap.summary.skippedCount).toBe(1);
    });

    it('skips (with a warning) an oversized image and keeps the rest', () => {
        const big = 'data:image/png;base64,' + 'A'.repeat(Math.ceil((MAX_VARIANT_IMAGE_BYTES + 10) * 4 / 3));
        const oversized = makeRecord({ key: 'v1:scr-a:mobile:default:low', screenId: 'scr-a', dataUrl: big });
        const ok = makeRecord({ key: 'v1:scr-b:mobile:default:low', screenId: 'scr-b' });
        const snap = buildMockupVariantImageSnapshot([oversized, ok], { exportedAt: 'now' });
        expect(snap.records).toHaveLength(1);
        expect(snap.records[0].screenId).toBe('scr-b');
        expect(snap.summary.skippedCount).toBe(1);
        expect(snap.summary.warnings?.some(w => /too large/i.test(w))).toBe(true);
    });

    it('does not serialize a default sidecar that carries no useful metadata', () => {
        const bare = makeRecord({
            key: 'v1:scr-home:default:low', variantId: 'default', dataUrl: '', prompt: '',
            coverageManifest: undefined, sourceSignature: undefined, generatedFrom: undefined,
        });
        const snap = buildMockupVariantImageSnapshot([bare], { exportedAt: 'now' });
        expect(snap.records).toHaveLength(0);
    });
});

describe('validateMockupVariantImageSnapshot', () => {
    const good = (): MockupVariantImageSnapshot =>
        buildMockupVariantImageSnapshot([makeRecord()], { exportedAt: 'now' });

    it('accepts a current-schema snapshot', () => {
        const res = validateMockupVariantImageSnapshot(good());
        expect(res.valid).toBe(true);
        expect(res.errors).toHaveLength(0);
        expect(res.safeImageCount).toBe(1);
    });

    it('rejects an unsupported schema version', () => {
        const res = validateMockupVariantImageSnapshot({ ...good(), schemaVersion: 99 });
        expect(res.valid).toBe(false);
        expect(res.errors.join(' ')).toMatch(/schema/i);
    });

    it('rejects an unsafe (SVG) image mime', () => {
        const snap = good();
        snap.records[0].imageDataUrl = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
        const res = validateMockupVariantImageSnapshot(snap);
        expect(res.errors.some(e => /unsafe|malformed/i.test(e))).toBe(true);
        expect(res.safeImageCount).toBe(0);
    });

    it('rejects a malformed data url', () => {
        const snap = good();
        snap.records[0].imageDataUrl = 'not-a-data-url';
        const res = validateMockupVariantImageSnapshot(snap);
        expect(res.errors.some(e => /unsafe|malformed/i.test(e))).toBe(true);
    });

    it('rejects a non-object input', () => {
        expect(validateMockupVariantImageSnapshot(null).valid).toBe(false);
        expect(validateMockupVariantImageSnapshot('nope').valid).toBe(false);
    });
});

describe('parseImageDataUrl + estimate', () => {
    it('parses a safe png and estimates byte length', () => {
        const parsed = parseImageDataUrl(PNG);
        expect(parsed?.mime).toBe('image/png');
        expect(parsed?.approxBytes).toBeGreaterThan(0);
    });

    it('rejects svg and non-data strings', () => {
        expect(parseImageDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
        expect(parseImageDataUrl('http://x/y.png')).toBeNull();
    });

    it('estimates snapshot size from image + history bytes', () => {
        const snap = buildMockupVariantImageSnapshot([
            makeRecord({ history: [{ dataUrl: PNG2, quality: 'low', generatedAt: 1 }] }),
        ], { exportedAt: 'now' });
        expect(estimateMockupVariantSnapshotSize(snap)).toBeGreaterThan(0);
    });
});

describe('split / join wire transport', () => {
    it('strips image bytes out and re-attaches them by ref key', () => {
        const snap = buildMockupVariantImageSnapshot([
            makeRecord({ history: [{ dataUrl: PNG2, quality: 'low', generatedAt: 1 }] }),
        ], { exportedAt: 'now' });
        const { snapshot: wire, images } = splitVariantSnapshotImages(snap);
        expect(wire.records[0].imageDataUrl).toBeUndefined();
        expect(wire.records[0].imageRef).toBe('vimg:v1:scr-home:mobile:default:low');
        expect(wire.records[0].history?.[0].imageDataUrl).toBeUndefined();
        expect(images).toHaveLength(2); // current + one history

        const refs = collectVariantSnapshotImageRefs(wire);
        expect(refs).toHaveLength(2);

        const byKey = new Map(images.map(i => [i.key, i.dataUrl]));
        const joined = joinVariantSnapshotImages(wire, byKey);
        expect(joined.records[0].imageDataUrl).toBe(PNG);
        expect(joined.records[0].imageRef).toBeUndefined();
        expect(joined.records[0].history?.[0].imageDataUrl).toBe(PNG2);
    });

    it('drops an image whose ref is missing (failed fetch) without breaking the record', () => {
        const snap = buildMockupVariantImageSnapshot([makeRecord()], { exportedAt: 'now' });
        const { snapshot: wire } = splitVariantSnapshotImages(snap);
        const joined = joinVariantSnapshotImages(wire, new Map()); // nothing fetched
        expect(joined.records[0].imageDataUrl).toBeUndefined();
        expect(joined.records[0].imageRef).toBeUndefined();
    });
});

describe('mergeVariantRecords', () => {
    it('restores when there is no local record', () => {
        const out = mergeVariantRecords(undefined, makeRecord());
        expect(out.action).toBe('restored');
        expect(out.record?.key).toBe('v1:scr-home:mobile:default:low');
    });

    it('treats an identical record as a duplicate (no write)', () => {
        const rec = makeRecord();
        const out = mergeVariantRecords(rec, { ...rec });
        expect(out.action).toBe('duplicate');
        expect(out.record).toBeUndefined();
    });

    it('snapshot newer -> snapshot wins, local folds to history', () => {
        const local = makeRecord({ dataUrl: PNG, generatedAt: 100 });
        const incoming = makeRecord({ dataUrl: PNG2, generatedAt: 200 });
        const out = mergeVariantRecords(local, incoming);
        expect(out.action).toBe('updated');
        expect(out.record?.dataUrl).toBe(PNG2);
        expect(out.record?.history?.[0].dataUrl).toBe(PNG);
    });

    it('local newer -> local kept, snapshot folds to history', () => {
        const local = makeRecord({ dataUrl: PNG2, generatedAt: 300 });
        const incoming = makeRecord({ dataUrl: PNG, generatedAt: 100 });
        const out = mergeVariantRecords(local, incoming);
        expect(out.action).toBe('kept_local');
        expect(out.record?.dataUrl).toBe(PNG2);
        expect(out.record?.history?.some(h => h.dataUrl === PNG)).toBe(true);
    });

    it('inconclusive timestamps -> keep local, add snapshot to history + warn', () => {
        const local = makeRecord({ dataUrl: PNG2, generatedAt: 100 });
        const incoming = makeRecord({ dataUrl: PNG, generatedAt: 100 });
        const out = mergeVariantRecords(local, incoming);
        expect(out.action).toBe('kept_local');
        expect(out.warning).toBeTruthy();
        expect(out.record?.history?.some(h => h.dataUrl === PNG)).toBe(true);
    });

    it('an imageless incoming never replaces a successful local image', () => {
        const local = makeRecord({ dataUrl: PNG, generatedAt: 100 });
        const incoming = makeRecord({ dataUrl: '', generatedAt: 999 });
        const out = mergeVariantRecords(local, incoming);
        expect(out.action).toBe('skipped');
    });

    it('does not duplicate identical history entries when merging', () => {
        const shared = { dataUrl: PNG2, quality: 'low' as const, generatedAt: 50 };
        const local = makeRecord({ dataUrl: PNG, generatedAt: 300, history: [shared] });
        const incoming = makeRecord({ dataUrl: PNG, generatedAt: 100, history: [shared] });
        const out = mergeVariantRecords(local, incoming);
        const count = (out.record?.history ?? []).filter(h => h.dataUrl === PNG2).length;
        expect(count).toBe(1);
    });
});

describe('restoreMockupVariantImageSnapshot', () => {
    // A tiny in-memory IDB fake keyed by record.key.
    const makeFakeIdb = (seed: MockupVariantImageRecord[] = []) => {
        const db = new Map<string, MockupVariantImageRecord>();
        for (const r of seed) db.set(r.key, r);
        return {
            db,
            listExisting: async (versionId: string) =>
                [...db.values()].filter(r => r.versionId === versionId),
            put: async (r: MockupVariantImageRecord) => { db.set(r.key, r); },
        };
    };

    it('restores into an empty store', async () => {
        const snap = buildMockupVariantImageSnapshot([makeRecord()], { exportedAt: 'now' });
        const idb = makeFakeIdb();
        const notified: MockupVariantImageRecord[] = [];
        const res = await restoreMockupVariantImageSnapshot(snap, {
            listExisting: idb.listExisting, put: idb.put, notify: (r) => notified.push(...r),
        });
        expect(res.restored).toBe(1);
        expect(idb.db.get('v1:scr-home:mobile:default:low')?.dataUrl).toBe(PNG);
        expect(notified).toHaveLength(1);
    });

    it('same key + newer snapshot makes the snapshot current', async () => {
        const local = makeRecord({ dataUrl: PNG, generatedAt: 100 });
        const idb = makeFakeIdb([local]);
        const snap = buildMockupVariantImageSnapshot(
            [makeRecord({ dataUrl: PNG2, generatedAt: 200 })], { exportedAt: 'now' });
        const res = await restoreMockupVariantImageSnapshot(snap, {
            listExisting: idb.listExisting, put: idb.put,
        });
        expect(res.updated).toBe(1);
        expect(idb.db.get(local.key)?.dataUrl).toBe(PNG2);
    });

    it('same key + newer local keeps the local record current', async () => {
        const local = makeRecord({ dataUrl: PNG2, generatedAt: 300 });
        const idb = makeFakeIdb([local]);
        const snap = buildMockupVariantImageSnapshot(
            [makeRecord({ dataUrl: PNG, generatedAt: 100 })], { exportedAt: 'now' });
        const res = await restoreMockupVariantImageSnapshot(snap, {
            listExisting: idb.listExisting, put: idb.put,
        });
        expect(res.keptLocal).toBe(1);
        expect(idb.db.get(local.key)?.dataUrl).toBe(PNG2);
        expect(idb.db.get(local.key)?.history?.some(h => h.dataUrl === PNG)).toBe(true);
    });

    it('skips a non-default record with no safe image without crashing', async () => {
        const bad: MockupVariantImageSnapshot = {
            schemaVersion: 1, exportedAt: 'now',
            records: [{
                key: 'v1:scr-x:mobile:default:low', versionId: 'v1', screenId: 'scr-x',
                variantId: 'mobile:default', quality: 'low',
                imageDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=',
            }],
            summary: { recordCount: 1, historyEntryCount: 0, totalApproxBytes: 0 },
        };
        const idb = makeFakeIdb();
        const res = await restoreMockupVariantImageSnapshot(bad, {
            listExisting: idb.listExisting, put: idb.put,
        });
        expect(res.skipped).toBe(1);
        expect(idb.db.size).toBe(0);
    });

    it('returns an empty result (no throw) for a malformed section', async () => {
        const idb = makeFakeIdb();
        const res = await restoreMockupVariantImageSnapshot(
            { schemaVersion: 5 } as unknown as MockupVariantImageSnapshot,
            { listExisting: idb.listExisting, put: idb.put },
        );
        expect(res.restored).toBe(0);
        expect(res.warnings.length).toBeGreaterThan(0);
    });

    it('restores a default sidecar without an image (metadata only)', async () => {
        const sidecar = makeRecord({
            key: 'v1:scr-home:default:low', variantId: 'default', dataUrl: '', prompt: '',
        });
        const snap = buildMockupVariantImageSnapshot([sidecar], { exportedAt: 'now' });
        const idb = makeFakeIdb();
        await restoreMockupVariantImageSnapshot(snap, {
            listExisting: idb.listExisting, put: idb.put,
        });
        const restored = idb.db.get('v1:scr-home:default:low');
        expect(restored?.dataUrl).toBe('');
        expect(restored?.coverageManifest?.overallStatus).toBe('aligned');
    });
});

describe('full wire round-trip (build -> split -> upload/fetch -> join -> restore)', () => {
    it('reconstructs the current image, manifest, and history on a fresh device', async () => {
        const rec = makeRecord({
            history: [{ dataUrl: PNG2, quality: 'low', coverageManifest: manifest(), generatedAt: 500 }],
        });
        // 1. Build the portable snapshot and split image bytes out (what save does).
        const snap = buildMockupVariantImageSnapshot([rec], { exportedAt: 'now' });
        const { snapshot: wire, images } = splitVariantSnapshotImages(snap);

        // 2. Simulate the server blob channel: bytes keyed by ref key.
        const blobStore = new Map(images.map(i => [i.key, i.dataUrl]));

        // 3. On load, fetch each ref and re-attach (what the loaders do).
        const refs = collectVariantSnapshotImageRefs(wire);
        const fetched = new Map(refs.map(k => [k, blobStore.get(k)!]));
        const joined = joinVariantSnapshotImages(wire, fetched);

        // 4. Restore into a fresh (empty) device store.
        const db = new Map<string, MockupVariantImageRecord>();
        const res = await restoreMockupVariantImageSnapshot(joined, {
            listExisting: async (v) => [...db.values()].filter(r => r.versionId === v),
            put: async (r) => { db.set(r.key, r); },
        });

        expect(res.restored).toBe(1);
        const restored = db.get('v1:scr-home:mobile:default:low');
        expect(restored?.dataUrl).toBe(PNG);
        expect(restored?.coverageManifest?.overallStatus).toBe('aligned');
        expect(restored?.sourceSignature).toBeTruthy();
        expect(restored?.history?.[0].dataUrl).toBe(PNG2);
    });
});

describe('namespaceVariantSnapshot', () => {
    it('remaps versionId + rebuilds the composite key under the target project', () => {
        const snap = buildMockupVariantImageSnapshot([makeRecord()], { exportedAt: 'now' });
        const idMap = new Map([['v1', 'demo:v1']]);
        const out = namespaceVariantSnapshot(snap, idMap, 'demo');
        expect(out.records[0].versionId).toBe('demo:v1');
        expect(out.records[0].key).toBe('demo:v1:scr-home:mobile:default:low');
        expect(out.records[0].projectId).toBe('demo');
    });

    it('is idempotent when the id map is empty', () => {
        const snap = buildMockupVariantImageSnapshot([makeRecord()], { exportedAt: 'now' });
        const out = namespaceVariantSnapshot(snap, new Map(), 'demo');
        expect(out.records[0].key).toBe(snap.records[0].key);
    });
});
