/**
 * Onboarding-tour completion flag.
 *
 * Deliberately kept OUT of the Zustand project store — it's a single UI flag,
 * so it uses the repo's simple direct-localStorage pattern (like the retired
 * `synapse-meet-dismissed` key) with defensive try/catch for private-mode /
 * storage-disabled environments.
 */
export const TOUR_COMPLETED_KEY = 'synapse-tour-completed';

/** True once the user has reached the final tour screen at least once. */
export function hasCompletedTour(): boolean {
    try {
        return localStorage.getItem(TOUR_COMPLETED_KEY) === 'true';
    } catch {
        return false;
    }
}

/** Record that the tour has been completed (idempotent). */
export function markCompleted(): void {
    try {
        localStorage.setItem(TOUR_COMPLETED_KEY, 'true');
    } catch {
        // localStorage unavailable — completion simply won't persist.
    }
}

/** Clear completion (used by tests; not wired to any user action today). */
export function resetTour(): void {
    try {
        localStorage.removeItem(TOUR_COMPLETED_KEY);
    } catch {
        // ignore
    }
}
