/**
 * Session-scoped Zustand store for AI image previews. Holds an in-memory
 * cache of MockupImageRecord rows that have been hydrated from IndexedDB so
 * React components can subscribe and re-render. Generation state
 * (in-flight by composite key) drives the loading UI in MockupScreenImage.
 *
 * Persistence (the source of truth) lives in src/lib/mockupImageStore.ts
 * (IndexedDB). This store is purely a reactive cache and orchestrator.
 *
 * Records are keyed by `${versionId}:${screenId}:${quality}` (+ `:gemini` for
 * Nano Banana renders) so each quality level and each image model coexists
 * rather than overwriting earlier renders. `listForScreen` returns every
 * render for one (version, screen) pair so the UI can offer a switcher when a
 * screen has several (e.g. a GPT Image 2 and a Nano Banana 2.1 draft).
 */

import { create } from 'zustand';
import type {
    MockupImageProvider, MockupImageQuality, MockupImageRecord, MockupPayload, MockupScreen, MockupSettings,
} from '../types';
import { buildGeminiScreenImagePrompt, buildScreenImagePrompt } from '../lib/services/mockupImageService';
import { generateMockupImageWithFallback, NO_IMAGE_MODEL_MESSAGE } from '../lib/mockupImageGeneration';
import { getMockupImageProviderChain } from '../lib/artifactModelSettings';
import { selectPreferredDesignTokens } from '../lib/designTokens';
import { useProjectStore } from './projectStore';
import { assertProjectCapability } from '../lib/projectCapabilities';
import {
    buildImageKey,
    buildScreenScopeKey,
    getImage as idbGetImage,
    listImagesForVersion as idbListImages,
    putImage as idbPutImage,
} from '../lib/mockupImageStore';
import { getRefsForVersion, onImageRefsChanged } from '../lib/imageRefRegistry';
import { fetchBlobAsDataUrl } from '../lib/imageRefsClient';
import { mockupRecordFromRef, type ImageRef } from '../lib/imageRef';
import { notifyMockupImageGenerated } from './projectImageSync';

// Pull blob bytes for refs the local IndexedDB doesn't have yet (cross-device
// case). Concurrency-limited so a version with many screens doesn't open a fetch
// per screen at once. A failed fetch is skipped (render shows empty, retried on
// next mount) — never throws out of the loader.
const hydrateMissingRefs = async (refs: ImageRef[]): Promise<MockupImageRecord[]> => {
    const CONCURRENCY = 4;
    const out: MockupImageRecord[] = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, refs.length) }, async () => {
        while (true) {
            const idx = cursor++;
            if (idx >= refs.length) return;
            const ref = refs[idx];
            try {
                const dataUrl = await fetchBlobAsDataUrl(ref.blobUrl);
                out.push(mockupRecordFromRef(ref, dataUrl));
            } catch {
                // skip — best-effort hydration
            }
        }
    });
    await Promise.all(workers);
    return out;
};

interface InFlight {
    quality: MockupImageQuality;
    startedAt: number;
    abort: AbortController;
    /** The image provider rendering right now. */
    provider: MockupImageProvider;
    /** Set when this attempt is the automatic fallback after `fallbackFrom` failed. */
    fallbackFrom?: MockupImageProvider;
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
    /** Map of screen scope -> key of the render being viewed (session-only).
     * Set by the render switcher and by every successful generation, so the
     * screen image, its page thumbnail and its footer show the same render. */
    selected: Record<string, string>;
    /** SYN-003: versions whose `loadForVersion` has fully settled (records found
     * OR the version genuinely has none). Lets a consumer distinguish "no image
     * yet, still hydrating" from "no image, provably absent" so the Screens
     * variant grid never claims "Generated" for an image it can't find. */
    loadedVersions: Record<string, true>;

    /** Hydrate this version's images from IndexedDB into the reactive cache. */
    loadForVersion: (versionId: string) => Promise<void>;

    /** Look up a single record at a specific quality + provider (cache first, then IDB). */
    getRecord: (
        versionId: string,
        screenId: string,
        quality: MockupImageQuality,
        provider?: MockupImageProvider,
    ) => Promise<MockupImageRecord | undefined>;

    /** Synchronous lookup — returns every cached render for one screen. */
    listForScreen: (versionId: string, screenId: string) => MockupImageRecord[];

    /** Show this render for the screen (the render switcher). */
    select: (versionId: string, screenId: string, key: string) => void;

    /** Generate (or regenerate) an image for one screen. */
    generate: (args: {
        projectId: string;
        artifactId: string;
        versionId: string;
        screen: MockupScreen;
        payload: MockupPayload;
        settings: MockupSettings;
        quality: MockupImageQuality;
        /** An explicit model choice runs on that model only. Omitted, the
         * Settings chain runs: the primary model, then the fallback if the
         * primary fails. */
        provider?: MockupImageProvider;
        /** Phase 3C: fired after a successful render is stored, so a caller can
         * capture a coverage sidecar for the default variant without changing
         * this legacy image path. Best-effort — thrown callbacks are swallowed. */
        onGenerated?: (record: MockupImageRecord) => void;
    }) => Promise<void>;

    /** Cancel an in-flight generation. */
    cancel: (versionId: string, screenId: string) => void;

    /** Clear the error state for one screen (e.g. on retry click). */
    clearError: (versionId: string, screenId: string) => void;

    /** Evict cached records + settled-flags for these versions. IndexedDB
     * stays the source of truth (nothing here touches it) — this only
     * invalidates the in-memory reactive cache so a subsequent
     * `loadForVersion` can't briefly serve pre-wipe data after something
     * else (e.g. a demo reset) deletes the underlying IDB records out from
     * under this cache. */
    clearVersions: (versionIds: string[]) => void;
}

export const useMockupImageStore = create<ImageStoreState>((set, get) => ({
    images: {},
    inFlight: {},
    errors: {},
    selected: {},
    loadedVersions: {},

    loadForVersion: async (versionId) => {
        const records = await idbListImages(versionId);
        const haveKeys = new Set(records.map((r) => r.key));
        // Surface locally-cached records immediately — they must not wait on
        // the network hydration of refs this device is missing.
        if (records.length > 0) {
            set((state) => {
                const next = { ...state.images };
                for (const r of records) next[r.key] = r;
                return { images: next };
            });
        }

        // Cross-device hydration: for any server ref this device is missing,
        // fetch the blob, write it into IndexedDB (the local source of truth),
        // and surface it in the reactive cache. Lazy — only on view, never a
        // bulk download on sign-in.
        const missing = getRefsForVersion(versionId).filter((r) => !haveKeys.has(r.key));
        const hydrated = missing.length > 0 ? await hydrateMissingRefs(missing) : [];
        for (const record of hydrated) await idbPutImage(record);

        // SYN-003: mark the version settled on EVERY path (the empty path
        // previously returned without a set(), so a consumer could never tell
        // "no image yet" from "still loading").
        set((state) => {
            const next = { ...state.images };
            for (const r of hydrated) next[r.key] = r;
            return {
                images: next,
                loadedVersions: { ...state.loadedVersions, [versionId]: true },
            };
        });
    },

    getRecord: async (versionId, screenId, quality, provider) => {
        const key = buildImageKey(versionId, screenId, quality, provider);
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

    select: (versionId, screenId, key) => {
        const scope = screenScope(versionId, screenId);
        set((state) => (state.selected[scope] === key
            ? state
            : { selected: { ...state.selected, [scope]: key } }));
    },

    generate: async ({ projectId, artifactId, versionId, screen, payload, settings, quality, provider, onGenerated }) => {
        assertProjectCapability(useProjectStore.getState().projects[projectId], 'canGenerateArtifacts');
        const scope = screenScope(versionId, screen.id);
        if (get().inFlight[scope]) return; // already generating something for this screen

        const chain = provider ? [provider] : getMockupImageProviderChain();
        if (chain.length === 0) {
            set((state) => ({ errors: { ...state.errors, [scope]: NO_IMAGE_MODEL_MESSAGE } }));
            return;
        }

        const abort = new AbortController();
        set((state) => ({
            inFlight: { ...state.inFlight, [scope]: { quality, startedAt: Date.now(), abort, provider: chain[0] } },
            errors: { ...state.errors, [scope]: '' },
        }));

        const designTokens = selectPreferredDesignTokens(useProjectStore.getState(), projectId);

        try {
            const render = await generateMockupImageWithFallback({
                chain,
                quality,
                shape: { platform: settings.platform },
                signal: abort.signal,
                buildPrompt: (p) => (p === 'gemini'
                    ? buildGeminiScreenImagePrompt(payload, screen, settings, designTokens)
                    : buildScreenImagePrompt(payload, screen, settings, designTokens)),
                // Surface which model is running (and that it is the fallback).
                onAttempt: (p, fallbackFrom) => set((state) => {
                    const current = state.inFlight[scope];
                    if (!current || current.abort !== abort) return state;
                    return { inFlight: { ...state.inFlight, [scope]: { ...current, provider: p, fallbackFrom } } };
                }),
            });
            const key = buildImageKey(versionId, screen.id, quality, render.provider);
            const record: MockupImageRecord = {
                key,
                projectId,
                artifactId,
                versionId,
                screenId: screen.id,
                dataUrl: render.dataUrl,
                quality,
                prompt: render.prompt,
                model: render.model,
                generatedAt: Date.now(),
            };
            await idbPutImage(record);
            set((state) => {
                const nextInFlight = { ...state.inFlight };
                delete nextInFlight[scope];
                return {
                    images: { ...state.images, [key]: record },
                    inFlight: nextInFlight,
                    // Show the fresh render, whichever model produced it.
                    selected: { ...state.selected, [scope]: key },
                };
            });
            // Sync the freshly generated render to Blob (best-effort; no-op when
            // signed out). Image generation writes IndexedDB directly and never
            // touches the project store, so the bundle-push path wouldn't see it.
            notifyMockupImageGenerated(projectId, versionId);
            // Phase 3C: let a caller capture a default-variant coverage sidecar.
            // Best-effort — a callback failure must never break generation.
            try { onGenerated?.(record); } catch { /* ignore */ }
        } catch (err) {
            const aborted = (err as { name?: string })?.name === 'AbortError' || abort.signal.aborted;
            const message = aborted
                ? ''
                : err instanceof Error ? err.message : 'Image generation failed.';
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

    clearVersions: (versionIds) => {
        if (versionIds.length === 0) return;
        const idSet = new Set(versionIds);
        set((state) => {
            const images = { ...state.images };
            for (const key of Object.keys(images)) {
                if (idSet.has(images[key].versionId)) delete images[key];
            }
            const loadedVersions = { ...state.loadedVersions };
            for (const id of versionIds) delete loadedVersions[id];
            const selected = { ...state.selected };
            for (const scope of Object.keys(selected)) {
                if (versionIds.some((id) => scope.startsWith(`${id}:`))) delete selected[scope];
            }
            return { images, loadedVersions, selected };
        });
    },
}));

// Cross-device hydration false-negative fix: refs are pulled fire-and-forget
// AFTER reconcile, so on a fresh device `loadForVersion` can settle (and stamp
// `loadedVersions[id]`) before any ref exists — the presence UI then
// confidently claims no images exist until a remount. When a project's refs
// land, re-run hydration for any version this store already settled; it is
// idempotent and only fetches records the local IndexedDB is missing.
// Versions never viewed stay lazy (no flag → no fetch).
onImageRefsChanged((versionIds) => {
    const { loadedVersions, loadForVersion } = useMockupImageStore.getState();
    for (const id of versionIds) {
        if (loadedVersions[id]) void loadForVersion(id);
    }
});
