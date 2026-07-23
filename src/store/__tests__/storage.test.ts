import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebouncedStorage, registerCrossTabMerge, registerQuotaRecovery } from '../storage';
import { useToastStore } from '../toastStore';

const KEY = 'synapse-projects-storage';
const VALUE = { state: { projects: {} }, version: 0 } as never;

function quotaError(): DOMException {
    return new DOMException('The quota has been exceeded.', 'QuotaExceededError');
}

function flushDebounce(): void {
    // Fire the pending debounced write scheduled by storage.setItem.
    vi.advanceTimersByTime(600);
}

describe('debounced storage — quota handling', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        registerQuotaRecovery(null);
        useToastStore.setState({ toasts: [] });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        registerQuotaRecovery(null);
    });

    it('runs recovery before warning and stays silent when recovery frees space', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw quotaError();
        });
        const recovery = vi.fn(() => true); // pruned → a fresh write is coming
        registerQuotaRecovery(recovery);

        const storage = createDebouncedStorage(500);
        storage.setItem(KEY, VALUE);
        flushDebounce();

        expect(recovery).toHaveBeenCalledTimes(1);
        // Recovery reported it freed space, so the warning is deferred to the retry.
        expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('warns once when recovery cannot free enough space', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw quotaError();
        });
        registerQuotaRecovery(() => false); // nothing to prune

        const storage = createDebouncedStorage(500);
        storage.setItem(KEY, VALUE);
        flushDebounce();

        const toasts = useToastStore.getState().toasts;
        expect(toasts).toHaveLength(1);
        expect(toasts[0].title).toContain('Storage full');
        expect(toasts[0].duration).toBe(0); // sticky
    });

    it('does not re-run recovery or stack toasts while storage stays full', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw quotaError();
        });
        const recovery = vi.fn(() => false);
        registerQuotaRecovery(recovery);

        const storage = createDebouncedStorage(500);
        storage.setItem(KEY, VALUE);
        flushDebounce();
        storage.setItem(KEY, VALUE);
        flushDebounce();

        expect(recovery).toHaveBeenCalledTimes(1); // guarded per episode
        expect(useToastStore.getState().toasts).toHaveLength(1); // single sticky toast
    });

    it('drains the recovered write synchronously during an unload flush', () => {
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((_key, value) => {
            // The oversized write overflows; the smaller recovered write fits.
            if (value.includes('"big"')) throw quotaError();
        });
        // eslint-disable-next-line prefer-const -- referenced by the recovery closure below
        let storage: ReturnType<typeof createDebouncedStorage>;
        registerQuotaRecovery(() => {
            // Mimic the project store: pruning schedules a fresh, smaller write.
            storage.setItem(KEY, { state: { size: 'small' }, version: 0 } as never);
            return true;
        });
        storage = createDebouncedStorage(500);
        storage.setItem(KEY, { state: { size: 'big' }, version: 0 } as never);

        // The tab is closed/backgrounded before the 500ms debounce timer fires.
        window.dispatchEvent(new Event('pagehide'));

        // The recovered small write must have landed synchronously, not been left
        // on a timer that never fires.
        expect(setItem).toHaveBeenCalledWith(KEY, expect.stringContaining('"small"'));
        expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('auto-dismisses the warning and re-arms once a later write succeeds', () => {
        let full = true;
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            if (full) throw quotaError();
        });
        registerQuotaRecovery(() => false);

        const storage = createDebouncedStorage(500);
        storage.setItem(KEY, VALUE);
        flushDebounce();
        expect(useToastStore.getState().toasts).toHaveLength(1);

        // The user frees space; the next write goes through.
        full = false;
        storage.setItem(KEY, VALUE);
        flushDebounce();

        expect(setItem).toHaveBeenCalled();
        expect(useToastStore.getState().toasts).toHaveLength(0); // stale warning cleared
    });
});

describe('debounced storage — cross-tab write guard', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        registerQuotaRecovery(null);
        registerCrossTabMerge(null);
        localStorage.clear();
        useToastStore.setState({ toasts: [] });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        registerQuotaRecovery(null);
        registerCrossTabMerge(null);
        localStorage.clear();
    });

    it('merges instead of overwriting when another tab wrote since our last read', () => {
        const merge = vi.fn(() => JSON.stringify({ state: { merged: true }, version: 0 }));
        const onApplied = vi.fn();
        registerCrossTabMerge({ merge, onApplied });

        const storage = createDebouncedStorage(500);
        // This tab hydrates (observes) the current value…
        localStorage.setItem(KEY, 'observed-value');
        storage.getItem(KEY);
        // …then ANOTHER tab persists newer work…
        localStorage.setItem(KEY, 'other-tab-value');
        // …and this tab flushes its own (stale) write.
        storage.setItem(KEY, VALUE);
        flushDebounce();

        expect(merge).toHaveBeenCalledWith('other-tab-value', JSON.stringify(VALUE));
        expect(localStorage.getItem(KEY)).toContain('"merged":true');
        expect(onApplied).toHaveBeenCalledTimes(1);
    });

    it('writes normally when the stored value is unchanged since our last observation', () => {
        const merge = vi.fn((_stored: string, ours: string) => ours);
        registerCrossTabMerge({ merge });

        const storage = createDebouncedStorage(500);
        storage.setItem(KEY, VALUE);
        flushDebounce();
        // Second write: stored === what we last wrote → no conflict.
        storage.setItem(KEY, VALUE);
        flushDebounce();

        expect(merge).not.toHaveBeenCalled();
        expect(localStorage.getItem(KEY)).toBe(JSON.stringify(VALUE));
    });

    it('treats a first write over never-observed existing data as a conflict', () => {
        const merge = vi.fn(() => 'merged-blob');
        registerCrossTabMerge({ merge });

        localStorage.setItem(KEY, 'pre-existing');
        const storage = createDebouncedStorage(500);
        // No getItem first — this tab provably never saw 'pre-existing'.
        storage.setItem(KEY, VALUE);
        flushDebounce();

        expect(merge).toHaveBeenCalledWith('pre-existing', JSON.stringify(VALUE));
        expect(localStorage.getItem(KEY)).toBe('merged-blob');
    });

    it('applies the guard on the unload flush too', () => {
        const merge = vi.fn(() => 'merged-on-unload');
        registerCrossTabMerge({ merge });

        const storage = createDebouncedStorage(500);
        localStorage.setItem(KEY, 'observed');
        storage.getItem(KEY);
        localStorage.setItem(KEY, 'other-tab');
        storage.setItem(KEY, VALUE);
        // Tab closes before the debounce fires.
        window.dispatchEvent(new Event('pagehide'));

        expect(merge).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(KEY)).toBe('merged-on-unload');
    });

    it('falls back to writing our value when the merge handler throws', () => {
        registerCrossTabMerge({
            merge: () => {
                throw new Error('merge exploded');
            },
        });
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const storage = createDebouncedStorage(500);
        localStorage.setItem(KEY, 'other-tab');
        storage.setItem(KEY, VALUE);
        flushDebounce();

        expect(localStorage.getItem(KEY)).toBe(JSON.stringify(VALUE));
    });
});
