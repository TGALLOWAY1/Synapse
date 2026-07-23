// Transparent compression for the persisted project-store blob.
//
// The whole store persists as ONE JSON string per user namespace in
// localStorage, whose origin quota is ~5MB on iOS Safari — a handful of
// projects with full artifact/version history fills it, the "Storage full —
// changes are no longer being saved" toast appears, and every write after
// that silently fails (the acute cause of "my mockups were gone when I
// reopened Synapse": the mockup spec is the last thing generation writes, so
// it is the first casualty of a failed save). Structured-PRD JSON compresses
// extremely well (typically 5–20×+ with lz-string's UTF-16 mode, which is
// designed to survive localStorage's UTF-16 storage), so compressing at the
// storage boundary turns the same quota into an order of magnitude more
// effective capacity without changing any store semantics.
//
// Format: a compressed value is `PREFIX + compressToUTF16(json)`. A plain
// JSON blob always starts with '{', so the prefix doubles as the format
// marker and legacy uncompressed blobs decode as themselves — every reader
// accepts both formats forever. Values under COMPRESSION_THRESHOLD stay
// plain: tiny blobs gain nothing, and staying readable keeps debugging and
// tests simple.
//
// LEAF module (only lz-string) — imported by storage.ts and userScope.ts,
// so it must not import the store or any module that does.

import { compressToUTF16, decompressFromUTF16 } from 'lz-string';

const PREFIX = '__SYNLZ1__';

/** Values smaller than this stay uncompressed (marginal gain, easier debugging). */
export const COMPRESSION_THRESHOLD = 16 * 1024;

/** Encode a JSON string for storage: compressed above the threshold, else as-is. */
export function encodePersistedBlob(json: string): string {
    if (json.length < COMPRESSION_THRESHOLD) return json;
    return PREFIX + compressToUTF16(json);
}

/**
 * Decode a stored value back to its JSON string. Plain legacy blobs pass
 * through unchanged; a compressed blob that fails to decompress returns null
 * (mirrors how an unparseable plain blob has always hydrated as absent).
 */
export function decodePersistedBlob(raw: string | null): string | null {
    if (raw === null) return null;
    if (!raw.startsWith(PREFIX)) return raw;
    const json = decompressFromUTF16(raw.slice(PREFIX.length));
    // Corrupt input can decompress to garbage rather than null — a persisted
    // blob is always a JSON object, so anything else is treated as absent.
    return json && json.startsWith('{') ? json : null;
}

/** Whether a stored value is in the compressed format. */
export function isCompressedBlob(raw: string): boolean {
    return raw.startsWith(PREFIX);
}

/**
 * One-time-per-load compaction: re-encode every OVERSIZED plain project-store
 * blob in localStorage (the active namespace, other users' namespaces, and
 * the legacy anonymous blob — which an import deliberately leaves behind as a
 * full extra copy). The active namespace only shrinks on its next write, and
 * the others never get written at all, so without this sweep a quota-full
 * device stays quota-full even after compression ships. Purely a re-encoding
 * of identical content — never parses, merges, or drops anything. Best-effort:
 * any failure leaves the original value in place.
 */
export function compactPersistedNamespaces(baseName: string): void {
    try {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key === baseName || key?.startsWith(`${baseName}::`)) keys.push(key);
        }
        for (const key of keys) {
            try {
                const raw = localStorage.getItem(key);
                if (raw === null || isCompressedBlob(raw) || raw.length < COMPRESSION_THRESHOLD) continue;
                const encoded = encodePersistedBlob(raw);
                if (encoded !== raw) localStorage.setItem(key, encoded);
            } catch {
                // Quota/serialization hiccup on one key must not stop the rest.
            }
        }
    } catch {
        // localStorage unavailable — nothing to compact.
    }
}
