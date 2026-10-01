// Content equality for structured PRDs — used to recognise a no-op edit
// ("Save" with nothing changed) so it appends no version. Every appended spine
// version changes the latest spine id, which the freshness engine reads as
// "PRD changed" for every generated output, so a no-op append is not harmless.

import type { StructuredPRD } from '../types';

/**
 * Comparable form of a PRD value: strings are trimmed, object keys whose value
 * is `undefined` are dropped (an absent optional field and an explicit
 * `undefined` are the same content), and object keys are sorted. Array order
 * stays significant — reordering items is a real edit.
 */
function normalizeForComparison(value: unknown): unknown {
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) return value.map(normalizeForComparison);
    if (value !== null && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const normalized: Record<string, unknown> = {};
        for (const key of Object.keys(record).sort()) {
            if (record[key] === undefined) continue;
            normalized[key] = normalizeForComparison(record[key]);
        }
        return normalized;
    }
    return value;
}

/** True when two structured PRDs carry the same content (see normalizeForComparison). */
export function isStructuredPrdContentEqual(
    a: StructuredPRD | undefined,
    b: StructuredPRD | undefined,
): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return JSON.stringify(normalizeForComparison(a)) === JSON.stringify(normalizeForComparison(b));
}
