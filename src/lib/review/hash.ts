/** Stable synchronous hashing for review snapshots and evidence anchoring. */

export function stableStringify(value: unknown): string {
    if (value === undefined) return 'undefined';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function fnv1a(input: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

export function hashReviewValue(value: unknown): string {
    const canonical = typeof value === 'string' ? value : stableStringify(value);
    return `${fnv1a(canonical)}${fnv1a(`${canonical}:review-v1`)}`;
}

export function normalizeEvidenceText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

export function hashEvidenceExcerpt(excerpt: string): string {
    return hashReviewValue(normalizeEvidenceText(excerpt));
}
