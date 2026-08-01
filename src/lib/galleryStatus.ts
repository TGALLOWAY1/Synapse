// Public gallery status for anonymous entry surfaces (home / login / the
// gallery page). Deliberately self-contained — it speaks to the public
// `?gallery=1` channel with plain fetch instead of going through
// `snapshotClient`, because these surfaces render for visitors with no owner
// token and must degrade to plain demo mode on ANY failure.
//
// The showcase mode is the owner's go-live switch: until the owner has
// pinned a full gallery and toggled the mode to 'gallery' on the server,
// every surface that consumes this module keeps presenting the single
// "View demo project" experience.

import { useEffect, useState } from 'react';

export type PublicGalleryMode = 'demo' | 'gallery';

export type PublicGalleryEntry = {
    slot: number;
    snapshotId: string;
    title?: string;
    projectName?: string;
    createdAt?: string;
    imageCount?: number;
    screenImageCount?: number;
    mockupScreenCount?: number;
    variantImageCount?: number;
    sizeBytes?: number;
};

export type PublicGalleryState = {
    mode: PublicGalleryMode;
    size: number;
    entries: PublicGalleryEntry[];
};

const API_URL = '/api/snapshots?gallery=1';

// One fetch per session for the entry buttons — the mode changes only when
// the owner flips it, so a stale-until-reload read is fine there. The gallery
// page itself passes `fresh: true` to re-read entries on every visit.
let cachedState: PublicGalleryState | null = null;
let inFlight: Promise<PublicGalleryState | null> | null = null;

const parseState = (body: unknown): PublicGalleryState => {
    const raw = (body ?? {}) as { mode?: unknown; size?: unknown; entries?: unknown };
    const entries = (Array.isArray(raw.entries) ? raw.entries : [])
        .filter((e): e is PublicGalleryEntry =>
            !!e && typeof e === 'object'
            && typeof (e as { slot?: unknown }).slot === 'number'
            && typeof (e as { snapshotId?: unknown }).snapshotId === 'string');
    return {
        mode: raw.mode === 'gallery' ? 'gallery' : 'demo',
        size: typeof raw.size === 'number' ? raw.size : 12,
        entries,
    };
};

/**
 * Fetch the public gallery state. Never throws — resolves null on any
 * transport/parse failure so callers fall back to demo-mode presentation.
 */
export function fetchPublicGalleryState(
    options?: { fresh?: boolean },
): Promise<PublicGalleryState | null> {
    if (!options?.fresh && cachedState) return Promise.resolve(cachedState);
    if (!options?.fresh && inFlight) return inFlight;
    const run = (async (): Promise<PublicGalleryState | null> => {
        try {
            const resp = await fetch(API_URL);
            if (!resp.ok) return null;
            const state = parseState(await resp.json());
            cachedState = state;
            return state;
        } catch {
            return null;
        }
    })();
    if (!options?.fresh) {
        inFlight = run.finally(() => {
            inFlight = null;
        });
        return inFlight;
    }
    return run;
}

/**
 * The live showcase mode for entry buttons. Resolves to 'demo' on failure;
 * null while still unknown (surfaces keep rendering the demo presentation
 * until the gallery is positively known to be live, so nothing flashes).
 */
export function usePublicGalleryMode(): PublicGalleryMode | null {
    const [mode, setMode] = useState<PublicGalleryMode | null>(cachedState?.mode ?? null);

    useEffect(() => {
        if (mode !== null) return;
        let cancelled = false;
        void fetchPublicGalleryState().then((state) => {
            if (!cancelled) setMode(state?.mode ?? 'demo');
        });
        return () => {
            cancelled = true;
        };
    }, [mode]);

    return mode;
}

// Test-only: drop the module-level cache between tests.
export function resetGalleryStatusForTests(): void {
    cachedState = null;
    inFlight = null;
}
