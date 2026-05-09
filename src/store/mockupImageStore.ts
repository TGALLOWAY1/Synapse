/**
 * Session-scoped Zustand store for AI image previews. Holds an in-memory
 * cache of MockupImageRecord rows that have been hydrated from IndexedDB so
 * React components can subscribe and re-render. Generation state
 * (in-flight by composite key) drives the loading UI in MockupScreenImage.
 *
 * Persistence (the source of truth) lives in src/lib/mockupImageStore.ts
 * (IndexedDB). This store is purely a reactive cache and orchestrator.
 *
 * Records are keyed by `${versionId}:${screenId}:${quality}` so each quality
 * level coexists rather than overwriting earlier renders. `getAllForScreen`
 * returns every variant for one (version, screen) pair so the UI can show a
 * quality switcher when both low- and high-quality images exist.
 */

import { create } from 'zustand';
import type { MockupImageQuality, MockupImageRecord, MockupPayload, MockupScreen, MockupSettings } from '../types';
import { callOpenAIImage } from '../lib/openaiClient';
import { buildScreenImagePrompt, pickImageSize } from '../lib/services/mockupImageService';
import { selectPreferredDesignTokens } from '../lib/designTokens';
import { useProjectStore } from './projectStore';
import {
    buildImageKey,
    buildScreenScopeKey,
    getImage as idbGetImage,
    listImagesForVersion as idbListImages,
    putImage as idbPutImage,
} from '../lib/mockupImageStore';

interface InFlight {
    quality: MockupImageQuality;
    startedAt: number;
    abort: AbortController;
}

const screenScope = (versionId: string, screenId: string): string =>
    buildScreenScopeKey(versionId, screenId);

interface ImageStoreState {
    /** Map of `${versionId}:${screenId}:${quality}` -> record. */
    images: Record<string, MockupImageRecord>;
    /** Map of `${versionId}:${screenId}` -> in-flight info (one per screen). */
    inFlight: Record<string, InFlight>;
    /** Map of `${versionId}:${screenId}` -> error message. */
    errors: Record<string, string>;

    /** Hydrate this version's images from IndexedDB into the reactive cache. */
    loadForVersion: (versionId: string) => Promise<void>;

    /** Look up a single record at a specific quality (cache first, then IDB). */
    getRecord: (
        versionId: string,
        screenId: string,
        quality: MockupImageQuality,
    ) => Promise<MockupImageRecord | undefined>;

    /** Synchronous lookup — returns every cached quality variant for one screen. */
    listForScreen: (versionId: string, screenId: string) => MockupImageRecord[];

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

    /** Clear the error state for one screen (e.g. on retry click). */
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

    getRecord: async (versionId, screenId, quality) => {
        const key = buildImageKey(versionId, screenId, quality);
        const cached = get().images[key];
        if (cached) return cached;
        const fromIdb = await idbGetImage(key);
        if (fromIdb) {
            set((state) => ({ images: { ...state.images, [key]: fromIdb } }));
        }
        return fromIdb;
    },

    listForScreen: (versionId, screenId) => {
        const prefix = screenScope(versionId, screenId);
        const out: MockupImageRecord[] = [];
        const images = get().images;
        for (const k of Object.keys(images)) {
            if (k.startsWith(prefix)) out.push(images[k]);
        }
        return out;
    },

    generate: async ({ projectId, artifactId, versionId, screen, payload, settings, quality }) => {
        const scope = screenScope(versionId, screen.id);
        if (get().inFlight[scope]) return; // already generating something for this screen

        const abort = new AbortController();
        set((state) => ({
            inFlight: { ...state.inFlight, [scope]: { quality, startedAt: Date.now(), abort } },
            errors: { ...state.errors, [scope]: '' },
        }));

        const designTokens = selectPreferredDesignTokens(useProjectStore.getState(), projectId);
        const prompt = buildScreenImagePrompt(payload, screen, settings, designTokens);
        const size = pickImageSize(settings.platform);

        try {
            const b64 = await callOpenAIImage(prompt, { quality, size, signal: abort.signal });
            const key = buildImageKey(versionId, screen.id, quality);
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

    cancel: (versionId, screenId) => {
        const scope = screenScope(versionId, screenId);
        const inFlight = get().inFlight[scope];
        if (!inFlight) return;
        inFlight.abort.abort();
    },

    clearError: (versionId, screenId) => {
        const scope = screenScope(versionId, screenId);
        set((state) => {
            if (!state.errors[scope]) return state;
            const next = { ...state.errors };
            delete next[scope];
            return { errors: next };
        });
    },
}));
