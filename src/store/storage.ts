import type { StorageValue } from 'zustand/middleware';
import { useToastStore } from './toastStore';

// Persist debugging is opt-in via the same flag the PRD generation log uses.
function persistDebugEnabled(): boolean {
    try {
        return typeof localStorage !== 'undefined'
            && localStorage.getItem('synapse-prd-debug') === 'true';
    } catch {
        return false;
    }
}

function isQuotaError(err: unknown): boolean {
    if (!(err instanceof DOMException)) return false;
    return (
        err.name === 'QuotaExceededError'
        || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' // Firefox
        || err.code === 22
        || err.code === 1014 // Firefox
    );
}

export function createDebouncedStorage<S>(delayMs: number = 500) {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let pendingValue: string | null = null;
    let pendingName: string | null = null;
    // Only warn the user once per session so a quota overflow doesn't spam a
    // toast on every debounced write.
    let quotaWarned = false;

    // Wrap localStorage.setItem so a quota overflow (or any write failure)
    // cannot throw an unhandled exception that silently aborts persistence for
    // the rest of the session. On quota overflow we surface a single sticky
    // toast so the user knows their work is no longer being saved.
    function safeSetItem(name: string, value: string): void {
        try {
            const startTime = performance.now();
            localStorage.setItem(name, value);
            if (persistDebugEnabled()) {
                const durationMs = performance.now() - startTime;
                console.log(`[STORE] persist: ${durationMs.toFixed(0)}ms (${(value.length / 1024).toFixed(1)}KB)`);
            }
        } catch (err) {
            if (isQuotaError(err)) {
                if (!quotaWarned) {
                    quotaWarned = true;
                    try {
                        useToastStore.getState().addToast({
                            type: 'warning',
                            title: 'Storage full — changes are no longer being saved',
                            message: 'Your browser storage is full. Export or delete some projects to free space, otherwise recent changes will be lost on refresh.',
                            duration: 0, // sticky until dismissed
                        });
                    } catch {
                        // Toast store unavailable (e.g. SSR/test) — swallow.
                    }
                }
            } else {
                console.error('[STORE] persist failed:', err);
            }
        }
    }

    // Flush pending writes synchronously (used on page unload to prevent data loss)
    function flush() {
        if (pendingValue !== null && pendingName !== null) {
            if (timeoutId) clearTimeout(timeoutId);
            safeSetItem(pendingName, pendingValue);
            pendingValue = null;
            pendingName = null;
            timeoutId = null;
        }
    }

    if (typeof window !== 'undefined') {
        // beforeunload is unreliable on mobile (iOS Safari frequently skips it
        // when backgrounding/killing a tab). pagehide and visibilitychange→hidden
        // are the dependable lifecycle events, so flush on all three.
        window.addEventListener('beforeunload', flush);
        window.addEventListener('pagehide', flush);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flush();
        });
    }

    return {
        getItem: (name: string): StorageValue<S> | null => {
            const raw = localStorage.getItem(name);
            if (raw === null) return null;
            try {
                return JSON.parse(raw) as StorageValue<S>;
            } catch {
                return null;
            }
        },
        setItem: (name: string, value: StorageValue<S>): void => {
            const serialized = JSON.stringify(value);
            pendingValue = serialized;
            pendingName = name;
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                safeSetItem(pendingName!, pendingValue!);
                pendingValue = null;
                pendingName = null;
                timeoutId = null;
            }, delayMs);
        },
        removeItem: (name: string): void => {
            if (timeoutId) clearTimeout(timeoutId);
            pendingValue = null;
            pendingName = null;
            localStorage.removeItem(name);
        },
    };
}
