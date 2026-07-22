import type { StructuredPRD } from '../types';

export type StructuredPrdAnchorEditResult =
    | { applied: true; structuredPRD: StructuredPRD }
    | { applied: false; reason: 'not_found' | 'ambiguous' };

/** Identifier-ish keys are never edited: an anchor that coincidentally appears
 * inside an id must not corrupt cross-references (feature ids, screen ids). */
const isIdentifierKey = (key: string) => key === 'id' || /Ids?$/.test(key);

const countOccurrencesIn = (value: unknown, anchorText: string): number => {
    if (typeof value === 'string') {
        let count = 0;
        for (let index = value.indexOf(anchorText); index >= 0; index = value.indexOf(anchorText, index + anchorText.length)) count += 1;
        return count;
    }
    if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + countOccurrencesIn(item, anchorText), 0);
    if (value && typeof value === 'object') {
        return Object.entries(value).reduce<number>(
            (sum, [key, child]) => sum + (isIdentifierKey(key) ? 0 : countOccurrencesIn(child, anchorText)),
            0,
        );
    }
    return 0;
};

const replaceFirstIn = (
    value: unknown,
    anchorText: string,
    replacement: string,
    state: { done: boolean },
): unknown => {
    if (state.done) return value;
    if (typeof value === 'string') {
        const index = value.indexOf(anchorText);
        if (index < 0) return value;
        state.done = true;
        return value.slice(0, index) + replacement + value.slice(index + anchorText.length);
    }
    if (Array.isArray(value)) {
        return value.map(item => replaceFirstIn(item, anchorText, replacement, state));
    }
    if (value && typeof value === 'object') {
        const next: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value)) {
            next[key] = isIdentifierKey(key) ? child : replaceFirstIn(child, anchorText, replacement, state);
        }
        return next;
    }
    return value;
};

/**
 * Applies a branch-consolidation local patch to the structured PRD itself:
 * finds the string field containing the anchor text and replaces that
 * occurrence with the patch. `responseText` is a deterministic projection of
 * `structuredPRD` (`renderPremiumMarkdown`), so editing the structured source
 * and re-projecting keeps them consistent — appending a markdown-only merge
 * spine instead would disable the Challenge/Build stages, which gate on the
 * latest spine having a `structuredPRD`.
 *
 * Fails closed, never guesses (input untouched either way):
 * - `not_found` — the anchor matches no string field, e.g. a selection whose
 *   rendered text differs from the stored string because of inline markdown;
 * - `ambiguous` — the anchor occurs more than once. Object key order need not
 *   match the rendered section order, so "replace the first match" could
 *   silently patch a different field than the one the user selected; callers
 *   ask for a more specific selection instead.
 */
export const applyAnchorEditToStructuredPRD = (
    structuredPRD: StructuredPRD,
    anchorText: string,
    replacement: string,
): StructuredPrdAnchorEditResult => {
    if (!anchorText) return { applied: false, reason: 'not_found' };
    const occurrences = countOccurrencesIn(structuredPRD, anchorText);
    if (occurrences === 0) return { applied: false, reason: 'not_found' };
    if (occurrences > 1) return { applied: false, reason: 'ambiguous' };
    const state = { done: false };
    const next = replaceFirstIn(structuredPRD, anchorText, replacement, state) as StructuredPRD;
    return { applied: true, structuredPRD: next };
};
