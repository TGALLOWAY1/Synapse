/**
 * Session-scoped Zustand store for per-variant mockup images (Phase 3B). Holds
 * an in-memory reactive cache of MockupVariantImageRecord rows hydrated from
 * IndexedDB (src/lib/mockupVariantImageStore.ts, the source of truth) plus the
 * generation orchestration (in-flight / error state keyed per variant).
 *
 * This is the NEW per-variant path. It is independent of the legacy
 * mockupImageStore (which still owns the default variant's single image), so
 * generating one variant never overwrites another. Each record carries its
 * coverage manifest so the Mockups tab can show manifest-backed coverage
 * instead of "unknown".
 */

import { create } from 'zustand';
import type {
    MockupImageQuality, MockupVariantImageRecord,
} from '../types';
import { callOpenAIImage } from '../lib/openaiClient';
import { pickImageSize } from '../lib/services/mockupImageService';
import {
    buildVariantCoverageManifest, buildVariantImagePrompt,
    type MockupVariantGenerationRequest,
} from '../lib/mockupVariantRequest';
import type { MockupPlatform } from '../types';
import { selectPreferredDesignTokens } from '../lib/designTokens';
import { useProjectStore } from './projectStore';
import {
    buildVariantImageKey,
    getVariantImage as idbGetVariantImage,
    listVariantImagesForVersion as idbListVariantImages,
    putVariantImage as idbPutVariantImage,
} from '../lib/mockupVariantImageStore';

interface InFlight {
    quality: MockupImageQuality;
    startedAt: number;
    abort: AbortController;
}

/** Per-(version, screen, variant) scope key for in-flight / error tracking. */
const variantScope = (versionId: string, screenId: string, variantId: string): string =>
    `${versionId}:${screenId}:${variantId}`;

interface VariantImageStoreState {
    /** Map of composite key -> record. */
    images: Record<string, MockupVariantImageRecord>;
    /** Map of variant scope -> in-flight info. */
    inFlight: Record<string, InFlight>;
    /** Map of variant scope -> error message. */
    errors: Record<string, string>;

    /** Hydrate a version's variant images from IndexedDB into the cache. */
    loadForVersion: (versionId: string) => Promise<void>;

    /** Synchronous lookup of the best cached record for one variant. */
    getBestRecord: (
        versionId: string, screenId: string, variantId: string,
    ) => MockupVariantImageRecord | undefined;

    /** Generate (or regenerate) the image for one variant. */
    generate: (args: {
        projectId: string;
        artifactId: string;
        versionId: string;
        platform: MockupPlatform;
        request: MockupVariantGenerationRequest;
        quality: MockupImageQuality;
    }) => Promise<void>;

    cancel: (versionId: string, screenId: string, variantId: string) => void;
    clearError: (versionId: string, screenId: string, variantId: string) => void;
}

const QUALITY_RANK: Record<MockupImageQuality, number> = { low: 0, medium: 1, high: 2 };

export const useMockupVariantImageStore = create<VariantImageStoreState>((set, get) => ({
    images: {},
    inFlight: {},
    errors: {},

    loadForVersion: async (versionId) => {
        const records = await idbListVariantImages(versionId);
        if (records.length === 0) return;
        set((state) => {
            const next = { ...state.images };
            for (const r of records) next[r.key] = r;
            return { images: next };
        });
    },

    getBestRecord: (versionId, screenId, variantId) => {
        const images = get().images;
        let best: MockupVariantImageRecord | undefined;
        for (const k of Object.keys(images)) {
            const r = images[k];
            if (r.versionId !== versionId || r.screenId !== screenId || r.variantId !== variantId) continue;
            if (!best || QUALITY_RANK[r.quality] > QUALITY_RANK[best.quality]) best = r;
        }
        return best;
    },

    generate: async ({ projectId, artifactId, versionId, platform, request, quality }) => {
        const scope = variantScope(versionId, request.screenId, request.variantId);
        if (get().inFlight[scope]) return; // one generation per variant at a time

        const abort = new AbortController();
        set((state) => ({
            inFlight: { ...state.inFlight, [scope]: { quality, startedAt: Date.now(), abort } },
            errors: { ...state.errors, [scope]: '' },
        }));

        const designTokens = selectPreferredDesignTokens(useProjectStore.getState(), projectId);
        const prompt = buildVariantImagePrompt(request, designTokens);
        const manifest = buildVariantCoverageManifest(request);
        const size = pickImageSize(request.viewport === 'mobile' ? 'mobile' : platform);

        try {
            const b64 = await callOpenAIImage(prompt, { quality, size, signal: abort.signal });
            const key = buildVariantImageKey(versionId, request.screenId, request.variantId, quality);
            const record: MockupVariantImageRecord = {
                key,
                projectId,
                artifactId,
                versionId,
                screenId: request.screenId,
                variantId: request.variantId,
                viewport: request.viewport,
                stateName: request.stateName,
                dataUrl: `data:image/png;base64,${b64}`,
                quality,
                prompt,
                coverageManifest: manifest,
                generatedAt: Date.now(),
            };
            await idbPutVariantImage(record);
            set((state) => {
                const nextInFlight = { ...state.inFlight };
                delete nextInFlight[scope];
                return {
                    images: { ...state.images, [key]: record },
                    inFlight: nextInFlight,
                };
            });
        } catch (err) {
            const aborted = (err as { name?: string })?.name === 'AbortError' || abort.signal.aborted;
            const message = aborted
                ? ''
                : err instanceof Error ? err.message : 'OpenAI image generation failed.';
            set((state) => {
                const nextInFlight = { ...state.inFlight };
                delete nextInFlight[scope];
                const nextErrors = { ...state.errors };
                if (message) nextErrors[scope] = message; else delete nextErrors[scope];
                return { inFlight: nextInFlight, errors: nextErrors };
            });
        }
    },

    cancel: (versionId, screenId, variantId) => {
        const scope = variantScope(versionId, screenId, variantId);
        get().inFlight[scope]?.abort.abort();
    },

    clearError: (versionId, screenId, variantId) => {
        const scope = variantScope(versionId, screenId, variantId);
        set((state) => {
            if (!state.errors[scope]) return state;
            const next = { ...state.errors };
            delete next[scope];
            return { errors: next };
        });
    },
}));

// Re-export a helper so callers can compute the scope key without duplicating.
export const variantImageScope = variantScope;

// Re-export helper for reading a single record from IDB (used by tests / rare
// cache-miss paths).
export { idbGetVariantImage as getVariantImageFromIdb };
