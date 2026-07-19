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

// SYN-001: "Reset Demo" shares the same single-flight slot as
// `hydrateDemoProject` so a reset can never race a concurrent hydration pass
// over the same IndexedDB/store keys. If a hydration is already in flight
// (e.g. the route just mounted and `loadDemoProject()` is mid-restore), we
// wait for it to settle — success or failure, we don't care which — before
// wiping anything, then run the reset and register ITS promise as the new
// `inFlight` slot so any hydration call that arrives while the reset is
// running joins it instead of starting a redundant, racing pass.
export function resetDemoProjectSingleFlight(): Promise<DemoHydrationResult> {
    const afterPending = inFlight ? inFlight.catch(() => undefined) : Promise.resolve();
    const run = afterPending.then(() => useProjectStore.getState().resetDemoProject());
    inFlight = run.finally(() => {
        inFlight = null;
    });
    return inFlight;
}

// Test-only escape hatch: drops a leaked in-flight promise between tests so
// one test's pending hydration can't satisfy the next test's call.
export function resetDemoHydrationForTests(): void {
    inFlight = null;
}
