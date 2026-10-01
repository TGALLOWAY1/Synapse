// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// getTabId caches per page load, so each case imports a fresh module instance.
async function loadTabId(): Promise<() => string> {
    vi.resetModules();
    return (await import('../outputRunLease')).getTabId;
}

const stubNavigation = (type: string) =>
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type } as unknown as PerformanceEntry]);

afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
});

describe('getTabId', () => {
    it('is stable for the life of the page and stored in sessionStorage', async () => {
        const getTabId = await loadTabId();
        const id = getTabId();
        expect(getTabId()).toBe(id);
        expect(sessionStorage.getItem('synapse-tab-id')).toBe(id);
    });

    it('survives this tab\'s own reload', async () => {
        sessionStorage.setItem('synapse-tab-id', 'tab-before-reload');
        stubNavigation('reload');
        const getTabId = await loadTabId();
        expect(getTabId()).toBe('tab-before-reload');
    });

    it('mints a new id when sessionStorage was copied into a new tab (e.g. "Duplicate tab")', async () => {
        sessionStorage.setItem('synapse-tab-id', 'original-tab');
        stubNavigation('navigate');
        const getTabId = await loadTabId();
        expect(getTabId()).not.toBe('original-tab');
    });
});
