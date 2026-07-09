import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MockupVariantImageRecord } from '../../types';
import type { MockupVariantGenerationRequest } from '../../lib/mockupVariantRequest';

// In-memory fake of the variant-image IndexedDB layer + a stub OpenAI image
// call so we can exercise generation without a real IDB or network.
vi.mock('../../lib/mockupVariantImageStore', () => {
    const db = new Map<string, MockupVariantImageRecord>();
    return {
        buildVariantImageKey: (v: string, s: string, variant: string, q: string) =>
            `${v}:${s}:${variant}:${q}`,
        putVariantImage: async (record: MockupVariantImageRecord) => { db.set(record.key, record); },
        getVariantImage: async (key: string) => db.get(key),
        listVariantImagesForVersion: async (versionId: string) =>
            [...db.values()].filter(r => r.versionId === versionId),
        deleteVariantImagesForVersion: async (versionId: string) => {
            for (const [k, r] of db.entries()) if (r.versionId === versionId) db.delete(k);
        },
        __db: db,
    };
});

let shouldFail = false;
let currentB64 = 'BASE64DATA';
vi.mock('../../lib/openaiClient', () => ({
    callOpenAIImage: async () => {
        if (shouldFail) throw new Error('boom');
        return currentB64;
    },
    hasOpenAIKey: () => true,
}));

// Design tokens selector reads the project store — stub it out.
vi.mock('../../lib/designTokens', () => ({ selectPreferredDesignTokens: () => undefined }));

import { useMockupVariantImageStore } from '../mockupVariantImageStore';

const makeRequest = (
    overrides: Partial<MockupVariantGenerationRequest> = {},
): MockupVariantGenerationRequest => ({
    projectName: 'Acme',
    productSummary: 'A product.',
    screenId: 'scr-home',
    screenName: 'Home',
    screenPurpose: 'Landing.',
    priority: 'P0',
    variantId: 'mobile:default',
    viewport: 'mobile',
    stateName: 'Default',
    coreUIRegions: ['Feed'],
    userActions: ['Refresh'],
    acceptanceCriteria: ['Loads fast'],
    risks: [],
    fidelity: 'high',
    ...overrides,
});

const genArgs = (request: MockupVariantGenerationRequest) => ({
    projectId: 'p1', artifactId: 'a1', versionId: 'v1',
    platform: 'desktop' as const, request, quality: 'low' as const,
});

describe('mockupVariantImageStore.generate', () => {
    beforeEach(() => {
        shouldFail = false;
        currentB64 = 'BASE64DATA';
        useMockupVariantImageStore.setState({ images: {}, inFlight: {}, errors: {} });
    });

    it('stores a generated variant under a per-variant key with its manifest', async () => {
        const req = makeRequest();
        await useMockupVariantImageStore.getState().generate(genArgs(req));

        const record = useMockupVariantImageStore.getState().getBestRecord('v1', 'scr-home', 'mobile:default');
        expect(record).toBeDefined();
        expect(record?.key).toBe('v1:scr-home:mobile:default:low');
        expect(record?.dataUrl).toBe('data:image/png;base64,BASE64DATA');
        expect(record?.coverageManifest?.overallStatus).toBe('aligned');
        expect(record?.viewport).toBe('mobile');
    });

    it('generating Mobile · Default does not overwrite Desktop · Default', async () => {
        const store = useMockupVariantImageStore.getState();
        await store.generate(genArgs(makeRequest({ variantId: 'desktop:default', viewport: 'desktop' })));
        await store.generate(genArgs(makeRequest({ variantId: 'mobile:default', viewport: 'mobile' })));

        const desktop = useMockupVariantImageStore.getState().getBestRecord('v1', 'scr-home', 'desktop:default');
        const mobile = useMockupVariantImageStore.getState().getBestRecord('v1', 'scr-home', 'mobile:default');
        expect(desktop?.viewport).toBe('desktop');
        expect(mobile?.viewport).toBe('mobile');
        // Distinct keys — neither clobbered the other.
        expect(desktop?.key).not.toBe(mobile?.key);
        expect(Object.keys(useMockupVariantImageStore.getState().images)).toHaveLength(2);
    });

    it('a failed generation records an error without losing existing variants', async () => {
        const store = useMockupVariantImageStore.getState();
        // First succeed for the desktop variant.
        await store.generate(genArgs(makeRequest({ variantId: 'desktop:default', viewport: 'desktop' })));
        // Then fail generating the mobile variant.
        shouldFail = true;
        await useMockupVariantImageStore.getState()
            .generate(genArgs(makeRequest({ variantId: 'mobile:default', viewport: 'mobile' })));

        const state = useMockupVariantImageStore.getState();
        // Existing desktop variant survives.
        expect(state.getBestRecord('v1', 'scr-home', 'desktop:default')).toBeDefined();
        // Mobile variant is absent and its scope carries an error.
        expect(state.getBestRecord('v1', 'scr-home', 'mobile:default')).toBeUndefined();
        expect(state.errors['v1:scr-home:mobile:default']).toBe('boom');
    });

    it('stores the source signature + provenance with a generated variant', async () => {
        const req = makeRequest();
        const sourceSignature = {
            screenId: 'scr-home', viewport: 'mobile' as const, stateName: 'Default',
            variantId: 'mobile:default', screenContractHash: 'abc', createdAt: '2026-01-01T00:00:00.000Z',
        };
        await useMockupVariantImageStore.getState().generate({
            ...genArgs(req),
            sourceSignature,
            generatedFrom: { prdVersionId: 'prd-1', screenVersionId: 'inv-1', designSystemVersionId: 'ds-1' },
        });
        const rec = useMockupVariantImageStore.getState().getBestRecord('v1', 'scr-home', 'mobile:default');
        expect((rec?.sourceSignature as { screenContractHash?: string })?.screenContractHash).toBe('abc');
        expect(rec?.generatedFrom?.prdVersionId).toBe('prd-1');
    });

    it('regenerating a variant preserves the previous successful record in history', async () => {
        const store = useMockupVariantImageStore.getState();
        const req = makeRequest();
        // Distinguish the two renders by the returned base64.
        currentB64 = 'FIRST';
        await store.generate(genArgs(req));
        currentB64 = 'SECOND';
        await useMockupVariantImageStore.getState().generate(genArgs(req));

        const rec = useMockupVariantImageStore.getState().getBestRecord('v1', 'scr-home', 'mobile:default');
        expect(rec?.dataUrl).toBe('data:image/png;base64,SECOND');
        expect(rec?.history).toHaveLength(1);
        expect(rec?.history?.[0].dataUrl).toBe('data:image/png;base64,FIRST');
        expect(rec?.history?.[0].reason).toBe('regenerated');
    });

    it('failed regeneration preserves the current successful record and adds no history entry', async () => {
        const store = useMockupVariantImageStore.getState();
        const req = makeRequest();
        currentB64 = 'GOOD';
        await store.generate(genArgs(req));
        // Now a regeneration that fails.
        shouldFail = true;
        await useMockupVariantImageStore.getState().generate(genArgs(req));

        const rec = useMockupVariantImageStore.getState().getBestRecord('v1', 'scr-home', 'mobile:default');
        // The original good render survives untouched, with no bogus history.
        expect(rec?.dataUrl).toBe('data:image/png;base64,GOOD');
        expect(rec?.history ?? []).toHaveLength(0);
        expect(useMockupVariantImageStore.getState().errors['v1:scr-home:mobile:default']).toBe('boom');
    });

    it('history is grouped by variant key (regen of one variant does not touch another)', async () => {
        const store = useMockupVariantImageStore.getState();
        currentB64 = 'A1';
        await store.generate(genArgs(makeRequest({ variantId: 'desktop:default', viewport: 'desktop' })));
        currentB64 = 'B1';
        await useMockupVariantImageStore.getState()
            .generate(genArgs(makeRequest({ variantId: 'mobile:default', viewport: 'mobile' })));
        // Regenerate only the desktop variant.
        currentB64 = 'A2';
        await useMockupVariantImageStore.getState()
            .generate(genArgs(makeRequest({ variantId: 'desktop:default', viewport: 'desktop' })));

        const desktop = useMockupVariantImageStore.getState().getBestRecord('v1', 'scr-home', 'desktop:default');
        const mobile = useMockupVariantImageStore.getState().getBestRecord('v1', 'scr-home', 'mobile:default');
        expect(desktop?.history).toHaveLength(1);
        expect(desktop?.history?.[0].dataUrl).toBe('data:image/png;base64,A1');
        // The mobile variant is untouched — no history.
        expect(mobile?.history ?? []).toHaveLength(0);
    });

    it('mergeRecords hydrates the reactive cache from restored records (snapshot restore)', () => {
        const store = useMockupVariantImageStore.getState();
        const record: MockupVariantImageRecord = {
            key: 'v1:scr-home:mobile:default:low',
            projectId: 'p1', artifactId: 'a1', versionId: 'v1',
            screenId: 'scr-home', variantId: 'mobile:default', viewport: 'mobile',
            stateName: 'Default', dataUrl: 'data:image/png;base64,RESTORED',
            quality: 'low', prompt: '', generatedAt: 5,
        };
        store.mergeRecords([record]);
        const rec = useMockupVariantImageStore.getState().getBestRecord('v1', 'scr-home', 'mobile:default');
        expect(rec?.dataUrl).toBe('data:image/png;base64,RESTORED');
    });

    it('putSidecar stores a metadata-only default record without generating', async () => {
        const store = useMockupVariantImageStore.getState();
        await store.putSidecar({
            key: 'v1:scr-home:default:low',
            projectId: 'p1', artifactId: 'a1', versionId: 'v1',
            screenId: 'scr-home', variantId: 'default', viewport: 'desktop',
            stateName: 'Default', dataUrl: '', quality: 'low', prompt: '',
            coverageManifest: {
                variant: { viewport: 'desktop', stateName: 'Default' },
                overallStatus: 'aligned', estimated: true,
                uiRegions: [], states: [], userActions: [], acceptanceCriteria: [], warnings: [],
            },
            sourceSignature: { screenId: 'scr-home', viewport: 'desktop', stateName: 'Default',
                variantId: 'default', screenContractHash: 'zzz', createdAt: '2026-01-01T00:00:00.000Z' },
            generatedAt: 1,
        });
        const rec = useMockupVariantImageStore.getState().getBestRecord('v1', 'scr-home', 'default');
        expect(rec?.coverageManifest?.overallStatus).toBe('aligned');
        expect((rec?.sourceSignature as { screenContractHash?: string })?.screenContractHash).toBe('zzz');
    });
});
