import { afterEach, describe, expect, it } from 'vitest';
import {
    COMPRESSION_THRESHOLD,
    compactPersistedNamespaces,
    decodePersistedBlob,
    encodePersistedBlob,
    isCompressedBlob,
} from '../persistCodec';

const BASE = 'synapse-projects-storage';

function bigJson(): string {
    return JSON.stringify({
        state: {
            projects: { p1: { id: 'p1', name: 'Big', createdAt: 1 } },
            artifactVersions: {
                p1: Array.from({ length: 200 }, (_, i) => ({
                    id: `v${i}`,
                    content: '# Mockup spec section\n'.repeat(20),
                    createdAt: i,
                })),
            },
        },
        version: 0,
    });
}

afterEach(() => {
    localStorage.clear();
});

describe('persistCodec', () => {
    it('round-trips a large blob through compression', () => {
        const json = bigJson();
        expect(json.length).toBeGreaterThan(COMPRESSION_THRESHOLD);
        const encoded = encodePersistedBlob(json);
        expect(isCompressedBlob(encoded)).toBe(true);
        expect(encoded.length).toBeLessThan(json.length / 2); // real savings
        expect(decodePersistedBlob(encoded)).toBe(json);
    });

    it('leaves small blobs uncompressed', () => {
        const json = JSON.stringify({ state: { projects: {} }, version: 0 });
        expect(encodePersistedBlob(json)).toBe(json);
        expect(isCompressedBlob(json)).toBe(false);
    });

    it('passes legacy plain blobs through decode unchanged', () => {
        const json = bigJson();
        expect(decodePersistedBlob(json)).toBe(json);
        expect(decodePersistedBlob(null)).toBeNull();
    });

    it('returns null for a corrupted compressed blob instead of throwing', () => {
        expect(decodePersistedBlob('__SYNLZ1__%%%not-actually-compressed')).toBeNull();
    });

    describe('compactPersistedNamespaces', () => {
        it('re-encodes oversized plain project-store blobs across namespaces', () => {
            const json = bigJson();
            localStorage.setItem(BASE, json);
            localStorage.setItem(`${BASE}::u:user-a`, json);
            localStorage.setItem('unrelated-key', json);

            compactPersistedNamespaces(BASE);

            const base = localStorage.getItem(BASE)!;
            const userA = localStorage.getItem(`${BASE}::u:user-a`)!;
            expect(isCompressedBlob(base)).toBe(true);
            expect(isCompressedBlob(userA)).toBe(true);
            expect(decodePersistedBlob(base)).toBe(json);
            expect(decodePersistedBlob(userA)).toBe(json);
            // Non-project keys are never touched.
            expect(localStorage.getItem('unrelated-key')).toBe(json);
        });

        it('leaves small and already-compressed blobs alone', () => {
            const small = JSON.stringify({ state: { projects: {} }, version: 0 });
            const compressed = encodePersistedBlob(bigJson());
            localStorage.setItem(BASE, small);
            localStorage.setItem(`${BASE}::u:user-b`, compressed);

            compactPersistedNamespaces(BASE);

            expect(localStorage.getItem(BASE)).toBe(small);
            expect(localStorage.getItem(`${BASE}::u:user-b`)).toBe(compressed);
        });
    });
});
