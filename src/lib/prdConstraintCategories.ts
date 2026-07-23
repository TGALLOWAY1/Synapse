// Constraint / non-functional-requirement items are plain strings, but the PRD
// generator overwhelmingly writes them with a short leading category label
// ("Performance: p95 page load under 2s", "Cost: …"). This module is the
// read-side projection that splits that label off so the Constraints surface can
// render it as a coloured badge. It is presentation-only and lossless: when a
// line has no recognisable label the whole string is returned as the text.

export interface ParsedConstraintItem {
    /** The leading category label, without the colon. Null when absent. */
    category: string | null;
    /** The remainder of the line (the whole line when there is no category). */
    text: string;
}

// A label is at most three short words — enough for "Quality & Performance" but
// not enough to swallow a real sentence that happens to contain a colon.
const LABEL_PATTERN = /^([A-Za-z][A-Za-z0-9&/\- ]{0,28}):[ \t]+(\S.*)$/s;
const MAX_LABEL_WORDS = 3;

export function parseConstraintItem(raw: string): ParsedConstraintItem {
    const value = raw.trim();
    const match = LABEL_PATTERN.exec(value);
    if (!match) return { category: null, text: value };

    const label = match[1].trim();
    if (label.split(/\s+/).length > MAX_LABEL_WORDS) return { category: null, text: value };

    return { category: label, text: match[2].trim() };
}

/** One labelled subsection: a category and every item filed under it.
 * `category` is null for items that carried no label — those render as a
 * plain list with no heading rather than under an invented one. */
export interface ConstraintGroup {
    category: string | null;
    items: string[];
}

/**
 * Group raw constraint lines by their leading category, preserving the order
 * categories first appear so the rendered order still tracks the document.
 * Unlabelled items collect into a single leading group.
 */
export function groupConstraintItems(raw: string[]): ConstraintGroup[] {
    const byCategory = new Map<string, ConstraintGroup>();
    const unlabelled: ConstraintGroup = { category: null, items: [] };
    const ordered: ConstraintGroup[] = [];

    for (const line of raw) {
        const { category, text } = parseConstraintItem(line);
        if (!text) continue;
        if (!category) {
            if (unlabelled.items.length === 0) ordered.unshift(unlabelled);
            unlabelled.items.push(text);
            continue;
        }
        const key = category.toLowerCase();
        const existing = byCategory.get(key);
        if (existing) {
            existing.items.push(text);
            continue;
        }
        const group: ConstraintGroup = { category, items: [text] };
        byCategory.set(key, group);
        ordered.push(group);
    }
    return ordered;
}
