import { describe, expect, it } from 'vitest';
import { stripPersistedCanonicalSpines } from '../projectStore';
import type { SpineVersion } from '../../types';

const makeSpine = (id: string, withCache: boolean): SpineVersion => ({
    id,
    projectId: 'p1',
    promptText: 'idea',
    responseText: '# PRD',
    createdAt: 1,
    isLatest: true,
    isFinal: false,
    // A minimal but real-shaped canonicalSpine cache; only its presence matters here.
    canonicalSpine: withCache
        ? ({ meta: { schemaVersion: 1 } } as unknown as SpineVersion['canonicalSpine'])
        : undefined,
});

describe('stripPersistedCanonicalSpines', () => {
    it('drops the canonicalSpine cache from every spine while keeping other fields', () => {
        const input = { p1: [makeSpine('s1', true), makeSpine('s2', true)] };
        const out = stripPersistedCanonicalSpines(input);
        expect(out.p1.every(spine => spine.canonicalSpine === undefined)).toBe(true);
        // Non-cache content is preserved.
        expect(out.p1.map(spine => spine.id)).toEqual(['s1', 's2']);
        expect(out.p1[0].responseText).toBe('# PRD');
    });

    it('does not mutate the live in-memory state', () => {
        const spine = makeSpine('s1', true);
        const input = { p1: [spine] };
        stripPersistedCanonicalSpines(input);
        expect(spine.canonicalSpine).toBeDefined(); // original untouched
    });

    it('returns the same reference when nothing carries a cache (no churn)', () => {
        const input = { p1: [makeSpine('s1', false)] };
        expect(stripPersistedCanonicalSpines(input)).toBe(input);
    });

    it('only clones the projects that actually have a cached spine', () => {
        const clean = [makeSpine('s1', false)];
        const input = { clean: clean, dirty: [makeSpine('s2', true)] };
        const out = stripPersistedCanonicalSpines(input);
        expect(out.clean).toBe(clean); // untouched array keeps its reference
        expect(out.dirty[0].canonicalSpine).toBeUndefined();
    });
});
