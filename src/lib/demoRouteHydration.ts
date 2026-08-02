import { useProjectStore } from '../store/projectStore';
import { DEMO_PROJECT_ID, galleryProjectIdForSlot } from '../data/demoProject';

export type DemoHydrationResult = { available: boolean };

// Single in-flight hydration per showcase target (the demo project or one
// gallery slot). React Strict Mode mounts the route gate twice in dev, and
// both effect invocations must ride ONE load pass — a second concurrent call
// would race `restoreSnapshotAs` against itself over the same IndexedDB/store
// keys. Targets are independent: hydrating gallery slot 2 must not serialize
// behind the demo. Each promise clears on settle so an explicit Retry (or a
// later remount via back/forward navigation) runs a fresh pass; the store's
// pointer probe makes a repeat pass cheap whenever the cached copy is still
// current.
const inFlight = new Map<string, Promise<DemoHydrationResult>>();

function singleFlight(
    key: string,
    run: () => Promise<DemoHydrationResult>,
): Promise<DemoHydrationResult> {
    let pending = inFlight.get(key);
    if (!pending) {
        pending = run().finally(() => {
            inFlight.delete(key);
        });
        inFlight.set(key, pending);
    }
    return pending;
}

// SYN-001: a reset shares the same single-flight slot as hydration so it can
// never race a concurrent hydration pass over the same IndexedDB/store keys.
// If a hydration is already in flight (e.g. the route just mounted and the
// load is mid-restore), we wait for it to settle — success or failure, we
// don't care which — before wiping anything, then register the reset's
// promise as the new in-flight slot so any hydration call that arrives while
// the reset is running joins it instead of starting a redundant, racing pass.
function singleFlightReset(
    key: string,
    run: () => Promise<DemoHydrationResult>,
): Promise<DemoHydrationResult> {
    const pending = inFlight.get(key);
    const afterPending = pending ? pending.catch(() => undefined) : Promise.resolve();
    const reset = afterPending.then(run).finally(() => {
        inFlight.delete(key);
    });
    inFlight.set(key, reset);
    return reset;
}

export function hydrateDemoProject(options?: { force?: boolean }): Promise<DemoHydrationResult> {
    return singleFlight(DEMO_PROJECT_ID, () =>
        useProjectStore.getState().loadDemoProject(options));
}

export function resetDemoProjectSingleFlight(): Promise<DemoHydrationResult> {
    return singleFlightReset(DEMO_PROJECT_ID, () =>
        useProjectStore.getState().resetDemoProject());
}

// Gallery counterparts, keyed by the slot's stable project id. An invalid
// slot resolves unavailable without touching the store.
export function hydrateGalleryProject(slot: number): Promise<DemoHydrationResult> {
    const targetProjectId = galleryProjectIdForSlot(slot);
    if (!targetProjectId) return Promise.resolve({ available: false });
    return singleFlight(targetProjectId, () =>
        useProjectStore.getState().loadGalleryProject(slot));
}

export function resetGalleryProjectSingleFlight(slot: number): Promise<DemoHydrationResult> {
    const targetProjectId = galleryProjectIdForSlot(slot);
    if (!targetProjectId) return Promise.resolve({ available: false });
    return singleFlightReset(targetProjectId, () =>
        useProjectStore.getState().resetGalleryProject(slot));
}

// Test-only escape hatch: drops leaked in-flight promises between tests so
// one test's pending hydration can't satisfy the next test's call.
export function resetDemoHydrationForTests(): void {
    inFlight.clear();
}
