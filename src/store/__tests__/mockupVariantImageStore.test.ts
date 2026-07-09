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
vi.mock('../../lib/openaiClient', () => ({
    callOpenAIImage: async () => {
        if (shouldFail) throw new Error('boom');
        return 'BASE64DATA';
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
});
