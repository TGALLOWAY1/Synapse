// Defensive text cleanup for LLM-supplied content. Two failure modes we
// guard against:
//
// 1. Degenerate loops: the model emits the same sentence dozens of times
//    in a row inside a single STRING field. We split, dedupe (case-
//    insensitive), and cap.
// 2. Paragraph crammed into a list slot: the model joins many distinct
//    behaviors with periods or "Disables… Shows… Hides…" instead of
//    using the array shape. We split on sentence boundaries so the
//    renderer can present one bullet per behavior.
//
// Used on both the read path (legacy localStorage data with the bad
// single-string shape) and the write path (defense in depth after a
// fresh generation). The implementation is intentionally pure and
// dependency-free.

export type CoerceOptions = {
    /** Cap the resulting list at this many sentences. */
    max?: number;
};

const SENTENCE_SPLIT = /(?<=[.!?])\s+|\s*\n+\s*|\s*•\s*|\s*•\s*|\s+[-–]\s+/;

/**
 * Split the input on sentence-like boundaries, trim, drop empties, and
 * deduplicate case-insensitively while preserving original casing of
 * the first occurrence.
 */
export function dedupeSentences(text: string, opts: CoerceOptions = {}): string[] {
    if (!text) return [];
    const cleaned = String(text).replace(/\s+/g, ' ').trim();
    if (!cleaned) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of cleaned.split(SENTENCE_SPLIT)) {
        // Strip leading "Label:" prefixes that would otherwise dedupe-conflict.
        const trimmed = raw.trim().replace(/\.+$/, '').trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(trimmed);
        if (opts.max != null && out.length >= opts.max) break;
    }
    return out;
}

/**
 * Collapse runs where a fixed-length substring repeats three or more
 * times back-to-back. Targets the "no-period" version of the degenerate
 * loop where dedupeSentences alone wouldn't help. Safe against
 * catastrophic backtracking because each backreference is fixed-length.
 */
export function collapseRepeats(text: string): string {
    if (!text || text.length < 90) return text;
    // Try fixed-length backreferences (no catastrophic backtracking) of every
    // length from 30 up to a third of the string. Step by 1 so we catch
    // arbitrary period lengths; the regex engine is fast on fixed-length
    // backrefs.
    const maxLen = Math.min(300, Math.floor(text.length / 3));
    for (let len = 30; len <= maxLen; len += 1) {
        const re = new RegExp(`(.{${len}})\\1{2,}`, 's');
        if (re.test(text)) {
            const replaceRe = new RegExp(`(.{${len}})\\1{2,}`, 'gs');
            return text.replace(replaceRe, '$1');
        }
    }
    return text;
}

/**
 * Normalize anything that should logically be a list of short distinct
 * sentences into exactly that shape. Accepts a single string, an array
 * of strings, or undefined/null. Strings are first run through
 * `collapseRepeats` then `dedupeSentences`. Arrays are flattened with
 * the same per-item processing then deduped across items.
 */
export function coerceToBulletList(
    value: string | string[] | null | undefined,
    opts: CoerceOptions = {},
): string[] {
    if (value == null) return [];
    const items: string[] = Array.isArray(value) ? value : [value];
    const flat: string[] = [];
    for (const item of items) {
        if (typeof item !== 'string') continue;
        const collapsed = collapseRepeats(item);
        flat.push(...dedupeSentences(collapsed));
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const sentence of flat) {
        const key = sentence.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(sentence);
        if (opts.max != null && out.length >= opts.max) break;
    }
    return out;
}

/**
 * Heuristic to detect that an input string was originally a degenerate
 * loop. Useful for surfacing a non-blocking quality warning on a
 * section even after we've cleaned it up at render time.
 */
export function looksDegenerate(value: string | string[] | null | undefined): boolean {
    if (value == null) return false;
    const original = Array.isArray(value) ? value.join(' ') : value;
    if (typeof original !== 'string' || original.length < 200) return false;
    const cleaned = coerceToBulletList(value);
    if (cleaned.length === 0) return false;
    const cleanedJoined = cleaned.join(' ');
    // Degenerate if the cleanup reduced character count by more than 50%
    // OR if the original was very long but condensed to one sentence.
    if (cleanedJoined.length < original.length * 0.5) return true;
    if (cleaned.length === 1 && original.length > 400) return true;
    return false;
}
