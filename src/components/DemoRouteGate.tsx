import { useEffect, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { hydrateDemoProject } from '../lib/demoRouteHydration';

type DemoGatePhase = 'loading' | 'ready' | 'failed';

/**
 * Route-level loader for the public demo project. The demo route owns the
 * complete initialization contract: opening, sharing, bookmarking, or
 * refreshing `/p/<DEMO_PROJECT_ID>` in a clean browser hydrates the pinned
 * demo snapshot before the workspace mounts — entry no longer depends on the
 * Login/Home "demo" buttons having run `loadDemoProject()` first.
 *
 * All cache/freshness/failure policy stays in the store's `loadDemoProject()`
 * (pointer probe → reuse cache / re-fetch stale / keep cache on failure); this
 * gate only sequences it and renders the loading/error shell. The workspace is
 * mounted only after hydration reports the demo available, so
 * `ProjectWorkspace`'s missing-project bounce can never fire for the demo.
 */
export function DemoRouteGate({ children }: { children: ReactElement }) {
    // Wait for the session to resolve before hydrating: `authStore.setUser`
    // retargets the project store's localStorage namespace via
    // `applyProjectUser` (wipe + rehydrate), which would discard a demo
    // restored into the previous namespace mid-flight.
    const authLoading = useAuthStore((s) => s.loading);
    const [phase, setPhase] = useState<DemoGatePhase>('loading');

    useEffect(() => {
        if (authLoading || phase !== 'loading') return;
        let cancelled = false;
        hydrateDemoProject()
            .then(({ available }) => {
                if (!cancelled) setPhase(available ? 'ready' : 'failed');
            })
            .catch((err) => {
                console.error('[DemoRouteGate] demo hydration failed', err);
                if (!cancelled) setPhase('failed');
            });
        return () => {
            cancelled = true;
        };
    }, [authLoading, phase]);

    if (phase === 'ready') return children;

    if (phase === 'failed') {
        return (
            <div className="min-h-screen flex items-center justify-center px-6">
                <div role="alert" className="max-w-md w-full text-center space-y-4">
                    <h2 className="text-xl font-semibold">Unable to load demo</h2>
                    <p className="text-sm text-neutral-400">
                        The demo project couldn't be loaded right now. This is
                        usually a temporary connection issue — or no demo
                        snapshot has been published yet.
                    </p>
                    <div className="flex items-center justify-center gap-3">
                        <button
                            type="button"
                            onClick={() => setPhase('loading')}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm hover:bg-indigo-700 transition"
                        >
                            Retry
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
                <p className="text-sm text-neutral-400">Loading demo project…</p>
            </div>
        </div>
    );
}
