/**
 * Session-scoped Zustand store for AI image previews. Holds an in-memory
 * cache of MockupImageRecord rows that have been hydrated from IndexedDB so
 * React components can subscribe and re-render. Generation state
 * (in-flight by composite key) drives the loading UI in MockupScreenImage.
 *
 * Persistence (the source of truth) lives in src/lib/mockupImageStore.ts
 * (IndexedDB). This store is purely a reactive cache and orchestrator.
 */

import { create } from 'zustand';
import type { MockupImageQuality, MockupImageRecord, MockupPayload, MockupScreen, MockupSettings } from '../types';
import { callOpenAIImage } from '../lib/openaiClient';
import { buildScreenImagePrompt, pickImageSize } from '../lib/services/mockupImageService';
import {
    buildImageKey,
    getImage as idbGetImage,
    listImagesForVersion as idbListImages,
    putImage as idbPutImage,
} from '../lib/mockupImageStore';

interface InFlight {
    quality: MockupImageQuality;
    startedAt: number;
    abort: AbortController;
}

interface ImageStoreState {
    images: Record<string, MockupImageRecord>;
    inFlight: Record<string, InFlight>;
    errors: Record<string, string>;

    /** Hydrate this version's images from IndexedDB into the reactive cache. */
    loadForVersion: (versionId: string) => Promise<void>;

    /** Look up a single record (cache first, then IDB). */
    getRecord: (versionId: string, screenId: string) => Promise<MockupImageRecord | undefined>;

    /** Synchronous cache lookup for render-path use. */
    peek: (versionId: string, screenId: string) => MockupImageRecord | undefined;

    /** Generate (or regenerate at higher quality) an image for one screen. */
    generate: (args: {
        projectId: string;
        artifactId: string;
        versionId: string;
        screen: MockupScreen;
        payload: MockupPayload;
        settings: MockupSettings;
        quality: MockupImageQuality;
    }) => Promise<void>;

    /** Cancel an in-flight generation. */
    cancel: (versionId: string, screenId: string) => void;

    /** Clear the error state for one key (e.g. on retry click). */
    clearError: (versionId: string, screenId: string) => void;
}

export const useMockupImageStore = create<ImageStoreState>((set, get) => ({
    images: {},
    inFlight: {},
    errors: {},

    loadForVersion: async (versionId) => {
        const records = await idbListImages(versionId);
        if (records.length === 0) return;
        set((state) => {
            const next = { ...state.images };
            for (const r of records) next[r.key] = r;
            return { images: next };
        });
    },

    getRecord: async (versionId, screenId) => {
        const key = buildImageKey(versionId, screenId);
        const cached = get().images[key];
        if (cached) return cached;
        const fromIdb = await idbGetImage(key);
        if (fromIdb) {
            set((state) => ({ images: { ...state.images, [key]: fromIdb } }));
        }
        return fromIdb;
    },

    peek: (versionId, screenId) => {
        return get().images[buildImageKey(versionId, screenId)];
    },

    generate: async ({ projectId, artifactId, versionId, screen, payload, settings, quality }) => {
        const key = buildImageKey(versionId, screen.id);
        if (get().inFlight[key]) return; // already generating this exact key

        const abort = new AbortController();
        set((state) => ({
            inFlight: { ...state.inFlight, [key]: { quality, startedAt: Date.now(), abort } },
            errors: { ...state.errors, [key]: '' },
        }));

        const prompt = buildScreenImagePrompt(payload, screen, settings);
        const size = pickImageSize(settings.platform);

        try {
            const b64 = await callOpenAIImage(prompt, { quality, size, signal: abort.signal });
            const record: MockupImageRecord = {
                key,
                projectId,
                artifactId,
                versionId,
                screenId: screen.id,
                dataUrl: `data:image/png;base64,${b64}`,
                quality,
                prompt,
                generatedAt: Date.now(),
            };
            await idbPutImage(record);
            set((state) => {
                const nextInFlight = { ...state.inFlight };
                delete nextInFlight[key];
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
                delete nextInFlight[key];
                const nextErrors = { ...state.errors };
                if (message) nextErrors[key] = message; else delete nextErrors[key];
                return { inFlight: nextInFlight, errors: nextErrors };
            });
        }
    },

    cancel: (versionId, screenId) => {
        const key = buildImageKey(versionId, screenId);
        const inFlight = get().inFlight[key];
        if (!inFlight) return;
        inFlight.abort.abort();
    },

    clearError: (versionId, screenId) => {
        const key = buildImageKey(versionId, screenId);
        set((state) => {
            if (!state.errors[key]) return state;
            const next = { ...state.errors };
            delete next[key];
            return { errors: next };
        });
    },
}));
