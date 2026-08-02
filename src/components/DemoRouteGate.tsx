import { useEffect, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import {
    hydrateDemoProject,
    hydrateGalleryProject,
    resetDemoProjectSingleFlight,
    resetGalleryProjectSingleFlight,
} from '../lib/demoRouteHydration';

type DemoGatePhase = 'loading' | 'ready' | 'failed';

/**
 * Route-level loader for the public showcase projects — the demo project and,
 * when a `gallerySlot` is given, one project-gallery slot. The showcase route
 * owns the complete initialization contract: opening, sharing, bookmarking,
 * or refreshing `/p/<showcase id>` in a clean browser hydrates the pinned
 * snapshot before the workspace mounts — entry no longer depends on the
 * Login/Home entry buttons having pre-loaded anything.
 *
 * All cache/freshness/failure policy stays in the store's load actions
 * (pointer probe → reuse cache / re-fetch stale / keep cache on failure);
 * this gate only sequences it and renders the loading/error shell. The
 * workspace is mounted only after hydration reports the project available,
 * so `ProjectWorkspace`'s missing-project bounce can never fire for it.
 */
export function DemoRouteGate({
    children,
    gallerySlot,
}: {
    children: ReactElement;
    gallerySlot?: number;
}) {
    // Wait for the session to resolve before hydrating: `authStore.setUser`
    // retargets the project store's localStorage namespace via
    // `applyProjectUser` (wipe + rehydrate), which would discard a project
    // restored into the previous namespace mid-flight.
    const authLoading = useAuthStore((s) => s.loading);
    const [phase, setPhase] = useState<DemoGatePhase>('loading');
    const isGallery = gallerySlot !== undefined;

    useEffect(() => {
        if (authLoading || phase !== 'loading') return;
        let cancelled = false;
        const hydrate = isGallery
            ? hydrateGalleryProject(gallerySlot)
            : hydrateDemoProject();
        hydrate
            .then(({ available }) => {
                if (!cancelled) setPhase(available ? 'ready' : 'failed');
            })
            .catch((err) => {
                console.error('[DemoRouteGate] showcase hydration failed', err);
                if (!cancelled) setPhase('failed');
            });
        return () => {
            cancelled = true;
        };
    }, [authLoading, phase, isGallery, gallerySlot]);

    if (phase === 'ready') return children;

    const noun = isGallery ? 'gallery project' : 'demo project';

    if (phase === 'failed') {
        // "Reset & reload" clears any (possibly corrupt) cached showcase
        // state first, in case the load failure is caused by a stale/broken
        // local cache rather than a transient network issue. It shares the
        // same single-flight slot as ordinary hydration (see
        // `resetDemoProjectSingleFlight` / `resetGalleryProjectSingleFlight`),
        // so kicking it off here and then flipping to 'loading' lets the
        // effect below join the SAME in-flight promise instead of racing a
        // second pass.
        const handleResetAndReload = () => {
            void (isGallery
                ? resetGalleryProjectSingleFlight(gallerySlot)
                : resetDemoProjectSingleFlight());
            setPhase('loading');
        };
        return (
            <div className="min-h-screen flex items-center justify-center px-6">
                <div role="alert" className="max-w-md w-full text-center space-y-4">
                    <h2 className="text-xl font-semibold">Unable to load {noun}</h2>
                    <p className="text-sm text-neutral-400">
                        The {noun} couldn't be loaded right now. This is
                        usually a temporary connection issue — or nothing has
                        been published for it yet.
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-3">
                        <button
                            type="button"
                            onClick={() => setPhase('loading')}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm hover:bg-indigo-700 transition"
                        >
                            Retry
                        </button>
                        <button
                            type="button"
                            onClick={handleResetAndReload}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/15 text-sm text-neutral-300 hover:border-white/30 hover:text-white transition"
                        >
                            Reset &amp; reload
                        </button>
                        <Link
                            to="/"
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/15 text-sm text-neutral-300 hover:border-white/30 hover:text-white transition"
                        >
                            Return home
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center px-6">
            <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 text-center">
                <Loader2 className="animate-spin text-neutral-400" size={24} aria-hidden="true" />
                <p className="text-sm text-neutral-400">Loading {noun}…</p>
            </div>
        </div>
    );
}
