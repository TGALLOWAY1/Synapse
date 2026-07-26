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

const SENTENCE_SPLIT = /(?<=[.!?])\s+|\s*\n+\s*|\s*•\s*|\s+[-–]\s+/;

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

/** Shortest / longest repeating block length `collapseRepeats` considers. */
const MIN_REPEAT_PERIOD = 30;
const MAX_REPEAT_PERIOD = 300;

/**
 * Smallest period in `[MIN_REPEAT_PERIOD, maxLen]` whose block repeats three or
 * more times back-to-back, or `null` when there is no such run.
 *
 * Exactly equivalent to testing `/(.{len})\1{2,}/s` for each `len` in ascending
 * order: that pattern matches iff some position `i` has `text[j] === text[j+len]`
 * for every `j` in `[i, i+2*len)`, i.e. a run of `2*len` consecutive matching
 * offset pairs. Doing it as a character scan costs one comparison per
 * (period, position) pair, where the regex form built and ran up to ~270
 * separate regexes across the whole string.
 *
 * That difference is not academic: this runs synchronously on the render path
 * (`PremiumSections` calls `looksDegenerate`/`coerceToBulletList` per state per
 * mechanic), and the regex form measured ~2.5s on a 12KB field and ~10s on a
 * 49KB one — a frozen tab on exactly the degenerate output this exists to clean
 * up.
 */
function findRepeatPeriod(text: string, maxLen: number): number | null {
    for (let len = MIN_REPEAT_PERIOD; len <= maxLen; len += 1) {
        const needed = 2 * len;
        let run = 0;
        for (let j = 0; j + len < text.length; j += 1) {
            if (text.charCodeAt(j) === text.charCodeAt(j + len)) {
                run += 1;
                if (run >= needed) return len;
            } else {
                run = 0;
            }
        }
    }
    return null;
}

/**
 * Collapse runs where a fixed-length substring repeats three or more
 * times back-to-back. Targets the "no-period" version of the degenerate
 * loop where dedupeSentences alone wouldn't help. Safe against
 * catastrophic backtracking because the backreference is fixed-length.
 */
export function collapseRepeats(text: string): string {
    if (!text || text.length < 90) return text;
    // Periods from 30 up to a third of the string, so an arbitrary loop length
    // is caught; the shortest matching period wins (same order as before).
    const maxLen = Math.min(MAX_REPEAT_PERIOD, Math.floor(text.length / 3));
    const len = findRepeatPeriod(text, maxLen);
    if (len === null) return text;
    return text.replace(new RegExp(`(.{${len}})\\1{2,}`, 'gs'), '$1');
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
