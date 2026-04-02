import type { StorageValue } from 'zustand/middleware';

export function createDebouncedStorage<S>(delayMs: number = 500) {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let pendingValue: string | null = null;
    let pendingName: string | null = null;

    // Flush pending writes synchronously (used on page unload to prevent data loss)
    function flush() {
        if (pendingValue !== null && pendingName !== null) {
            if (timeoutId) clearTimeout(timeoutId);
            localStorage.setItem(pendingName, pendingValue);
            pendingValue = null;
            pendingName = null;
            timeoutId = null;
        }
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', flush);
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
                const startTime = performance.now();
                localStorage.setItem(pendingName!, pendingValue!);
                const durationMs = performance.now() - startTime;
                console.log(`[STORE] persist: ${durationMs.toFixed(0)}ms (${(pendingValue!.length / 1024).toFixed(1)}KB)`);
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
