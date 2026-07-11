import { describe, it, expect } from 'vitest';
import { EXPORT_PROVIDERS, listExportProviders } from '../services/taskExport';

// SYN-014: the mocked Linear provider was removed entirely (no replacement
// "download JSON" stub either, per product decision) — this pins the
// registry to exactly the real, non-mocked providers so a future addition
// can't silently reintroduce a fake-success integration.
describe('EXPORT_PROVIDERS registry', () => {
    it('exposes exactly the real providers — markdown and github', () => {
        expect(Object.keys(EXPORT_PROVIDERS).sort()).toEqual(['github', 'markdown']);
    });

    it('registers no mocked/simulated providers', () => {
        for (const provider of listExportProviders()) {
            expect(provider.label.toLowerCase()).not.toContain('mock');
        }
    });

    it('every registered provider reports readiness truthfully (not a stub that always succeeds)', () => {
        // markdown has no external dependency, so it's always ready; github
        // requires a token/repo the test environment doesn't have, so it
        // must report a reason rather than silently pretending to be ready.
        expect(EXPORT_PROVIDERS.markdown.checkReady()).toBeNull();
        expect(typeof EXPORT_PROVIDERS.github.checkReady()).toBe('string');
    });
});
