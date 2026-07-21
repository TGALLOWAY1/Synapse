import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebouncedStorage, registerQuotaRecovery } from '../storage';
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
