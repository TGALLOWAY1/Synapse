// Deterministic hash of a normalized DesignTokens object. Used to detect
// whether downstream mockups need to be considered stale: if the hash on
// the mockup's recorded design-system source ref differs from the current
// preferred design-system version's hash, the tokens drifted and the
// mockup is `possibly_outdated`.
//
// We deliberately avoid `crypto.subtle` (async, not always available in
// Node test environments without polyfills) and use a small synchronous
// FNV-1a-based hash. The exact algorithm is not security-critical — only
// stability across calls and reasonable distribution matter.

import type { DesignTokens } from '../../types';

// Canonicalise an arbitrary value into a stable JSON string with sorted
// object keys at every depth. This is what makes the hash deterministic
// across calls regardless of property insertion order.
function canonicalStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalStringify).join(',')}]`;
    }
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const entries = keys.map(k => `${JSON.stringify(k)}:${canonicalStringify((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(',')}}`;
}

function fnv1a(input: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        // Multiply by FNV prime 16777619, kept in 32-bit unsigned range.
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

/**
 * Stable, order-independent hash of a `DesignTokens` object. Returns an
 * 8-char hex string (FNV-1a, double-pass for collision resistance on
 * structurally similar inputs). Equal *normalized* inputs always produce
 * equal hashes.
 */
export function hashDesignTokens(tokens: DesignTokens): string {
    const canonical = canonicalStringify(tokens);
    // Two-pass to reduce collisions on small inputs.
    return `${fnv1a(canonical)}${fnv1a(canonical + ':v1')}`;
}
