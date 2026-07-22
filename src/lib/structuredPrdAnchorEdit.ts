import type { StructuredPRD } from '../types';

export type StructuredPrdAnchorEditResult =
    | { applied: true; structuredPRD: StructuredPRD }
    | { applied: false };

/** Identifier-ish keys are never edited: an anchor that coincidentally appears
 * inside an id must not corrupt cross-references (feature ids, screen ids). */
const isIdentifierKey = (key: string) => key === 'id' || /Ids?$/.test(key);

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
 * finds the first string field containing the anchor text and replaces that
 * occurrence with the patch. `responseText` is a deterministic projection of
 * `structuredPRD` (`renderPremiumMarkdown`), so editing the structured source
 * and re-projecting keeps them consistent — appending a markdown-only merge
 * spine instead would disable the Challenge/Build stages, which gate on the
 * latest spine having a `structuredPRD`.
 *
 * Traversal follows object key order, which matches the renderer's section
 * order closely enough for the first match to be the on-screen one; anchors
 * are user-selected passages and in practice occur once. Returns
 * `{ applied: false }` (input untouched) when the anchor is not found — e.g.
 * a selection whose rendered text differs from the stored string because of
 * inline markdown — so callers can surface an actionable error instead of
 * committing a diverging spine.
 */
export const applyAnchorEditToStructuredPRD = (
    structuredPRD: StructuredPRD,
    anchorText: string,
    replacement: string,
): StructuredPrdAnchorEditResult => {
    if (!anchorText) return { applied: false };
    const state = { done: false };
    const next = replaceFirstIn(structuredPRD, anchorText, replacement, state) as StructuredPRD;
    return state.done ? { applied: true, structuredPRD: next } : { applied: false };
};
