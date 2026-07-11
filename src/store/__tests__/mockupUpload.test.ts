import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ScreenInventoryImageRecord } from '../../types';

// In-memory fake of the IndexedDB persistence layer so we can exercise the
// upload store (the same store the mockup manual-upload UI uses) without a real
// IndexedDB. Keeps the real slug/key helpers for fidelity.
vi.mock('../../lib/screenInventoryImageStore', () => {
    const db = new Map<string, ScreenInventoryImageRecord>();
    const slugifyScreenName = (name: string): string =>
        name.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim()
            .replace(/\s+/g, '-').replace(/-+/g, '-') || 'screen';
    const buildScreenImageKey = (v: string, slug: string, n: number) => `${v}:${slug}:${n}`;
    return {
        slugifyScreenName,
        buildScreenImageKey,
        listScreenImagesForArtifactVersion: async (artifactVersionId: string) =>
            [...db.values()].filter((r) => r.artifactVersionId === artifactVersionId),
        putScreenImage: async (record: ScreenInventoryImageRecord) => {
            db.set(record.key, record);
        },
        setPreferredScreenImage: async (artifactVersionId: string, slug: string, versionNumber: number) => {
            const updated: ScreenInventoryImageRecord[] = [];
            for (const r of db.values()) {
                if (r.artifactVersionId === artifactVersionId && r.screenSlug === slug) {
                    const next = { ...r, isPreferred: r.versionNumber === versionNumber };
                    db.set(r.key, next);
                    updated.push(next);
                }
            }
            return updated;
        },
    };
});

import { useScreenInventoryImageStore } from '../screenInventoryImageStore';
import { useProjectStore } from '../projectStore';

const makeFile = (name = 'mock.png') =>
    new File([new Uint8Array([1, 2, 3, 4])], name, { type: 'image/png' });

describe('mockup manual upload — uploaded image accepted as the mockup source', () => {
    beforeEach(() => {
        useScreenInventoryImageStore.setState({ images: {}, hydrated: {}, uploading: {}, errors: {} });
        useProjectStore.setState({ projects: { p1: { id: 'p1', name: 'Test', createdAt: 1 } } });
    });

    it('stores an uploaded file as the preferred image for a mockup screen', async () => {
        const versionId = 'mockup-version-1';
        const screenName = 'Home Screen';

        await useScreenInventoryImageStore.getState().upload({
            projectId: 'p1',
            artifactId: 'mockup-artifact-1',
            artifactVersionId: versionId,
            screenName,
            file: makeFile(),
            prompt: 'Upload a mockup of the Home Screen',
        });

        const preferred = useScreenInventoryImageStore.getState().peekPreferred(versionId, screenName);
        expect(preferred).toBeDefined();
        expect(preferred?.isPreferred).toBe(true);
        expect(preferred?.dataUrl.startsWith('data:image/png')).toBe(true);
        expect(preferred?.prompt).toContain('Home Screen');
        expect(preferred?.versionNumber).toBe(1);
    });

    it('keeps the latest upload preferred and versions prior uploads', async () => {
        const versionId = 'mockup-version-2';
        const screenName = 'Settings';
        const store = useScreenInventoryImageStore.getState();

        await store.upload({
            projectId: 'p1', artifactId: 'a1', artifactVersionId: versionId,
            screenName, file: makeFile('v1.png'), prompt: 'first',
        });
        await store.upload({
            projectId: 'p1', artifactId: 'a1', artifactVersionId: versionId,
            screenName, file: makeFile('v2.png'), prompt: 'second',
        });

        const all = useScreenInventoryImageStore.getState().listForScreen(versionId, screenName);
        expect(all).toHaveLength(2);
        const preferred = useScreenInventoryImageStore.getState().peekPreferred(versionId, screenName);
        expect(preferred?.versionNumber).toBe(2);
        // Exactly one preferred at a time.
        expect(all.filter((r) => r.isPreferred)).toHaveLength(1);
    });
});
