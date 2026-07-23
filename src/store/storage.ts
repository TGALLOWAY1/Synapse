import type { StorageValue } from 'zustand/middleware';
import { useToastStore } from './toastStore';
import { decodePersistedBlob, encodePersistedBlob } from './persistCodec';

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

// Optional recovery hook invoked when a write fails on quota. It should free
// space in the persisted store (e.g. run the retention sweep) and return true
// iff it actually changed state — a truthy return means a fresh, smaller write
// is now scheduled through the normal persist path, so the caller can defer the
// "Storage full" warning to that retry instead of warning on the first miss.
// The project store registers the real implementation (see projectStore.ts);
// keeping it as an injected hook avoids a storage → store import cycle.
type QuotaRecovery = () => boolean;
let quotaRecovery: QuotaRecovery | null = null;
export function registerQuotaRecovery(recovery: QuotaRecovery | null): void {
    quotaRecovery = recovery;
}

// Cross-tab write-safety hook. The persisted store is ONE whole-blob value per
// namespace, so with two open tabs the LAST writer used to win outright: a
// stale background tab flushing any write (including its unload flush)
// silently reverted everything a fresher tab had persisted since — in a
// freshly generated project that is the mockup spec version, the last thing
// written (see src/lib/crossTabMerge.ts for the full failure story). Before
// overwriting a value that changed under us (another tab wrote since this tab
// last read or wrote the key), the storage now asks this handler to MERGE the
// stored blob with ours and writes the merged result instead. `onApplied`
// fires after a merged value lands so the registrant can adopt it into memory
// (rehydrate); it is skipped when a newer write is already pending — that
// write will simply re-merge on its own flush. Injected (not imported) for the
// same storage → store cycle reason as the quota hook.
export interface CrossTabMergeHandler {
    merge: (storedRaw: string, oursRaw: string) => string;
    onApplied?: () => void;
}
let crossTabMerge: CrossTabMergeHandler | null = null;
export function registerCrossTabMerge(handler: CrossTabMergeHandler | null): void {
    crossTabMerge = handler;
}

export function createDebouncedStorage<S>(
    delayMs: number = 500,
    // Optional override that decides the actual localStorage key, ignoring the
    // static `name` Zustand was configured with. Used to namespace the project
    // store per user (see userScope.ts) so accounts don't share project data in
    // the same browser. The resolver is evaluated at every read/write so a user
    // switch transparently retargets storage; a queued debounced write captures
    // its target at enqueue time, so it always lands in the namespace it came
    // from even if the active user changes before it flushes.
    resolveName?: (configuredName: string) => string,
) {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let pendingValue: string | null = null;
    let pendingName: string | null = null;
    // Per-key snapshot of the stored value as THIS TAB last saw it (read on
    // hydration, updated on every successful write). A mismatch at write time
    // means another tab wrote in between — the cross-tab merge guard's trigger.
    const lastObserved = new Map<string, string | null>();
    // The id of the currently-shown sticky quota toast, so we can dismiss it the
    // moment a later write succeeds (space was freed by recovery or by the user
    // exporting/deleting). null = no quota toast is up.
    let quotaToastId: string | null = null;
    // Guard so recovery is attempted at most once per quota-failure episode; it
    // resets on the next successful write so a fresh overflow can recover again.
    let recoveryAttempted = false;

    function dismissQuotaToast(): void {
        if (quotaToastId === null) return;
        try {
            useToastStore.getState().removeToast(quotaToastId);
        } catch {
            // Toast store unavailable (e.g. SSR/test) — swallow.
        }
        quotaToastId = null;
    }

    function warnQuota(): void {
        if (quotaToastId !== null) return; // already warned this episode
        try {
            quotaToastId = useToastStore.getState().addToast({
                type: 'warning',
                title: 'Storage full — changes are no longer being saved',
                message: 'Your browser storage is full. Export or delete some projects to free space, otherwise recent changes will be lost on refresh.',
                duration: 0, // sticky until dismissed
            });
        } catch {
            // Toast store unavailable (e.g. SSR/test) — swallow.
        }
    }

    // Wrap localStorage.setItem so a quota overflow (or any write failure)
    // cannot throw an unhandled exception that silently aborts persistence for
    // the rest of the session. On quota overflow we first try to free space via
    // the registered recovery (retention sweep) and only surface a single sticky
    // toast if that cannot rescue the write.
    function safeSetItem(name: string, value: string): void {
        // Cross-tab guard: if the stored value changed since this tab last read
        // or wrote it, another tab persisted work we do not have in memory —
        // blindly overwriting would silently revert it (the "mockups vanish
        // after reopening" data loss). Merge the two blobs and write the union
        // instead. `lastObserved.has(name) === false` (a write with no prior
        // read) is treated the same as a mismatch: we provably never saw what
        // we are about to destroy. The observation snapshot and the mismatch
        // check live in the RAW (possibly compressed) domain; the merge handler
        // works on decoded JSON.
        let merged = false;
        try {
            const stored = localStorage.getItem(name);
            if (
                crossTabMerge
                && stored !== null
                && stored !== lastObserved.get(name)
            ) {
                const storedJson = decodePersistedBlob(stored);
                if (storedJson !== null && storedJson !== value) {
                    const resolved = crossTabMerge.merge(storedJson, value);
                    if (resolved !== value) {
                        value = resolved;
                        merged = true;
                    }
                }
            }
        } catch (err) {
            // Never let the guard itself break persistence — fall through and
            // write ours, which is the pre-guard behavior.
            console.error('[STORE] cross-tab merge failed:', err);
        }
        try {
            const startTime = performance.now();
            // Compress at the storage boundary (see persistCodec.ts) — the
            // ~5MB localStorage quota is the root of the "Storage full" toast
            // and the silent tail-loss behind vanished mockups.
            const encoded = encodePersistedBlob(value);
            localStorage.setItem(name, encoded);
            lastObserved.set(name, encoded);
            if (persistDebugEnabled()) {
                const durationMs = performance.now() - startTime;
                console.log(`[STORE] persist: ${durationMs.toFixed(0)}ms (${(encoded.length / 1024).toFixed(1)}KB stored, ${(value.length / 1024).toFixed(1)}KB raw)`);
            }
            // A write got through: storage is no longer full, so clear any stale
            // sticky warning and re-arm recovery for a future overflow.
            dismissQuotaToast();
            recoveryAttempted = false;
            // Let the registrant adopt the merged value into memory — but only
            // when no newer write is already queued (that write will re-merge on
            // its own flush, and rehydrating now would race it).
            if (merged && crossTabMerge?.onApplied && pendingValue === null) {
                try {
                    crossTabMerge.onApplied();
                } catch (applyErr) {
                    console.error('[STORE] cross-tab merge onApplied failed:', applyErr);
                }
            }
        } catch (err) {
            if (isQuotaError(err)) {
                // First overflow of this episode: ask the store to prune. If it
                // freed space it has already scheduled a fresh, smaller write, so
                // defer warning to that retry (which clears the toast on success
                // or lands back here to warn if it still overflows).
                if (!recoveryAttempted && quotaRecovery) {
                    recoveryAttempted = true;
                    let freed = false;
                    try {
                        freed = quotaRecovery();
                    } catch (recoveryErr) {
                        console.error('[STORE] quota recovery failed:', recoveryErr);
                    }
                    if (freed) return;
                }
                warnQuota();
            } else {
                console.error('[STORE] persist failed:', err);
            }
        }
    }

    // Flush pending writes synchronously (used on page unload to prevent data
    // loss). Drain in a loop, not a single write: if the write overflows quota,
    // recovery (invoked from inside safeSetItem) prunes the store and schedules a
    // FRESH debounced write — but on unload that 500ms timer never fires, so the
    // recovered/pruned state would be lost. Looping writes that fresh pending
    // value synchronously instead. Capture-then-reset before each write so the
    // re-entrant persist can register its pending write without us clobbering it.
    // Recovery runs at most once per episode (`recoveryAttempted`), so the second
    // pass either succeeds or warns without scheduling more work — the loop
    // terminates in at most two iterations.
    function flush() {
        while (pendingValue !== null && pendingName !== null) {
            if (timeoutId) clearTimeout(timeoutId);
            const value = pendingValue;
            const name = pendingName;
            pendingValue = null;
            pendingName = null;
            timeoutId = null;
            safeSetItem(name, value);
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

    const target = (name: string) => (resolveName ? resolveName(name) : name);

    return {
        getItem: (name: string): StorageValue<S> | null => {
            const key = target(name);
            const raw = localStorage.getItem(key);
            // Reading IS observing: a later write only merges when the stored
            // value changed after this point (i.e. another tab wrote). The
            // snapshot is the RAW stored value so it compares against what a
            // write actually stores.
            lastObserved.set(key, raw);
            const json = decodePersistedBlob(raw);
            if (json === null) return null;
            try {
                return JSON.parse(json) as StorageValue<S>;
            } catch {
                return null;
            }
        },
        setItem: (name: string, value: StorageValue<S>): void => {
            const serialized = JSON.stringify(value);
            pendingValue = serialized;
            pendingName = target(name);
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                // Capture and reset the pending slot BEFORE writing. Quota
                // recovery runs synchronously inside safeSetItem and mutates the
                // store, which schedules a fresh pending write; resetting first
                // means that re-entrant write survives instead of being nulled
                // out when this callback returns.
                const value = pendingValue!;
                const name = pendingName!;
                pendingValue = null;
                pendingName = null;
                timeoutId = null;
                safeSetItem(name, value);
            }, delayMs);
        },
        removeItem: (name: string): void => {
            if (timeoutId) clearTimeout(timeoutId);
            pendingValue = null;
            pendingName = null;
            const key = target(name);
            localStorage.removeItem(key);
            lastObserved.set(key, null);
        },
    };
}
