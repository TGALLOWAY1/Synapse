/**
 * Session-scoped Zustand store for user-uploaded Screen Inventory images.
 * Holds an in-memory cache of ScreenInventoryImageRecord rows hydrated from
 * IndexedDB so React components can subscribe and re-render on upload /
 * preferred-version flips. Persistence (the source of truth) lives in
 * src/lib/screenInventoryImageStore.ts (IndexedDB).
 *
 * Mirrors the shape of src/store/mockupImageStore.ts so the two image flows
 * read the same way to anyone scanning the codebase.
 */

import { create } from 'zustand';
import type { ScreenInventoryImageRecord } from '../types';
import {
    buildScreenImageKey,
    listScreenImagesForArtifactVersion as idbListImages,
    putScreenImage as idbPutImage,
    setPreferredScreenImage as idbSetPreferred,
    slugifyScreenName,
} from '../lib/screenInventoryImageStore';

interface UploadArgs {
    projectId: string;
    artifactId: string;
    artifactVersionId: string;
    screenName: string;
    file: File;
    prompt: string;
}

interface ImageStoreState {
    images: Record<string, ScreenInventoryImageRecord>;
    hydrated: Record<string, boolean>;
    uploading: Record<string, boolean>;
    errors: Record<string, string>;

    /** Hydrate this artifact version's uploads from IndexedDB. Idempotent. */
    loadForArtifactVersion: (artifactVersionId: string) => Promise<void>;

    /** All records for one screen, sorted by versionNumber ascending. */
    listForScreen: (artifactVersionId: string, screenName: string) => ScreenInventoryImageRecord[];

    /** The preferred record for one screen, or undefined. */
    peekPreferred: (artifactVersionId: string, screenName: string) => ScreenInventoryImageRecord | undefined;

    /** Read a file as a data URL and persist it as the new preferred upload. */
    upload: (args: UploadArgs) => Promise<void>;

    /** Promote an existing version to preferred for its screen. */
    setPreferred: (artifactVersionId: string, screenName: string, versionNumber: number) => Promise<void>;

    /** Clear an upload error for one screen bucket (e.g. on retry). */
    clearError: (artifactVersionId: string, screenName: string) => void;
}

const bucketKey = (artifactVersionId: string, screenSlug: string): string =>
    `${artifactVersionId}:${screenSlug}`;

const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') resolve(reader.result);
            else reject(new Error('FileReader returned non-string result'));
        };
        reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
        reader.readAsDataURL(file);
    });

export const useScreenInventoryImageStore = create<ImageStoreState>((set, get) => ({
    images: {},
    hydrated: {},
    uploading: {},
    errors: {},

    loadForArtifactVersion: async (artifactVersionId) => {
        if (get().hydrated[artifactVersionId]) return;
        const records = await idbListImages(artifactVersionId);
        set((state) => {
            const next = { ...state.images };
            for (const r of records) next[r.key] = r;
            return {
                images: next,
                hydrated: { ...state.hydrated, [artifactVersionId]: true },
            };
        });
    },

    listForScreen: (artifactVersionId, screenName) => {
        const slug = slugifyScreenName(screenName);
        return Object.values(get().images)
            .filter(r => r.artifactVersionId === artifactVersionId && r.screenSlug === slug)
            .sort((a, b) => a.versionNumber - b.versionNumber);
    },

    peekPreferred: (artifactVersionId, screenName) => {
        const slug = slugifyScreenName(screenName);
        return Object.values(get().images).find(
            r => r.artifactVersionId === artifactVersionId && r.screenSlug === slug && r.isPreferred,
        );
    },

    upload: async ({ projectId, artifactId, artifactVersionId, screenName, file, prompt }) => {
        const slug = slugifyScreenName(screenName);
        const bucket = bucketKey(artifactVersionId, slug);
        if (get().uploading[bucket]) return;

        set((state) => ({
            uploading: { ...state.uploading, [bucket]: true },
            errors: { ...state.errors, [bucket]: '' },
        }));

        try {
            const dataUrl = await readFileAsDataUrl(file);
            const siblings = get().listForScreen(artifactVersionId, screenName);
            const versionNumber = siblings.length === 0
                ? 1
                : Math.max(...siblings.map(r => r.versionNumber)) + 1;
            const record: ScreenInventoryImageRecord = {
                key: buildScreenImageKey(artifactVersionId, slug, versionNumber),
                projectId,
                artifactId,
                artifactVersionId,
                screenSlug: slug,
                screenName,
                versionNumber,
                isPreferred: true,
                dataUrl,
                mimeType: file.type || 'image/png',
                prompt,
                generatedAt: Date.now(),
            };
            await idbPutImage(record);
            // Flip siblings to non-preferred (cheap when there are zero, common
            // case). Skip the IDB roundtrip if there are no siblings to demote.
            if (siblings.length > 0) {
                await idbSetPreferred(artifactVersionId, slug, versionNumber);
            }
            set((state) => {
                const nextImages = { ...state.images };
                // Demote previously-preferred siblings in cache.
                for (const s of siblings) {
                    if (s.isPreferred) nextImages[s.key] = { ...s, isPreferred: false };
                }
                nextImages[record.key] = record;
                const nextUploading = { ...state.uploading };
                delete nextUploading[bucket];
                return { images: nextImages, uploading: nextUploading };
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Upload failed.';
            set((state) => {
                const nextUploading = { ...state.uploading };
                delete nextUploading[bucket];
                return {
                    uploading: nextUploading,
                    errors: { ...state.errors, [bucket]: message },
                };
            });
        }
    },

    setPreferred: async (artifactVersionId, screenName, versionNumber) => {
        const slug = slugifyScreenName(screenName);
        const updated = await idbSetPreferred(artifactVersionId, slug, versionNumber);
        if (updated.length === 0) return;
        set((state) => {
            const nextImages = { ...state.images };
            for (const r of updated) nextImages[r.key] = r;
            return { images: nextImages };
        });
    },

    clearError: (artifactVersionId, screenName) => {
        const slug = slugifyScreenName(screenName);
        const bucket = bucketKey(artifactVersionId, slug);
        set((state) => {
            if (!state.errors[bucket]) return state;
            const next = { ...state.errors };
            delete next[bucket];
            return { errors: next };
        });
    },
}));
