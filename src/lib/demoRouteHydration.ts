import { useProjectStore } from '../store/projectStore';

export type DemoHydrationResult = { available: boolean };

// Single in-flight hydration shared by every caller. React Strict Mode mounts
// the demo route gate twice in dev, and both effect invocations must ride ONE
// `loadDemoProject()` pass — a second concurrent call would race
// `restoreSnapshotAs` against itself over the same IndexedDB/store keys. The
// promise clears on settle so an explicit Retry (or a later remount via
// back/forward navigation) runs a fresh pass; the store's pointer probe makes
// a repeat pass cheap whenever the cached demo is still current.
let inFlight: Promise<DemoHydrationResult> | null = null;

export function hydrateDemoProject(options?: { force?: boolean }): Promise<DemoHydrationResult> {
    if (!inFlight) {
        inFlight = useProjectStore
            .getState()
            .loadDemoProject(options)
            .finally(() => {
                inFlight = null;
            });
    }
    return inFlight;
}

/** Explicit reset used by the one public-demo notice. It shares the route
 * loader's single-flight protection, so repeated clicks and Strict Mode are safe. */
export async function resetDemoProject(): Promise<DemoHydrationResult> {
    await useProjectStore.getState().clearDemoProject();
    return hydrateDemoProject({ force: true });
}

// Test-only escape hatch: drops a leaked in-flight promise between tests so
// one test's pending hydration can't satisfy the next test's call.
export function resetDemoHydrationForTests(): void {
    inFlight = null;
}
