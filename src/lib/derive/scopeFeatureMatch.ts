// Pure matcher resolving a free-form MVP-scope string to the PRD feature it
// refers to. Extracted from prdDecisions.ts so both the decision-log and the
// implementation-summary derivations can use it without an import cycle.

import type { Feature } from '../../types';

export type ScopeFeatureMatch = {
    /** The PRD feature the scope item refers to, when one can be resolved. */
    feature?: Feature;
    /** Supporting text left over once the id/name reference is stripped. */
    secondary?: string;
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whole-token match for a feature name inside a scope item. A bare substring
// test would resolve unrelated words (feature "AI" matching inside "Daily")
// and then strip mid-word text from the secondary copy — scope entries are
// often free prose, so the name must sit on its own token boundaries.
const nameMatchRegExp = (name: string) =>
    new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(name)}(?![A-Za-z0-9])`, 'i');

/**
 * Resolve an MVP-scope string ("F1: Quick capture — one-tap logging") to its
 * PRD feature so the MVP/V1 lists can present items as features (id badge +
 * bold name) instead of plain prose. Conservative, read-side only:
 * 1. an explicit id token (`f1`, `F-1`, `[f1]`) wins;
 * 2. else the longest feature name contained in the item;
 * 3. no match → undefined (the caller renders the raw string unchanged).
 * The leftover text (minus the matched id/name and separators) is returned
 * as `secondary` supporting copy.
 */
export function resolveScopeFeature(item: string, features: Feature[]): ScopeFeatureMatch {
    const text = item.trim();
    if (!text || features.length === 0) return {};

    const byId = new Map<string, Feature>();
    features.forEach(f => byId.set(f.id.toLowerCase().replace(/-/g, ''), f));

    let feature: Feature | undefined;
    let consumed: RegExp | undefined;

    const idToken = text.match(/\[?\b([a-zA-Z]-?\d+)\b\]?/);
    if (idToken) {
        feature = byId.get(idToken[1].toLowerCase().replace(/-/g, ''));
        if (feature) consumed = new RegExp(`\\[?${escapeRegExp(idToken[1])}\\]?`, 'i');
    }

    if (!feature) {
        const named = features
            .filter(f => f.name && nameMatchRegExp(f.name).test(text))
            .sort((a, b) => b.name.length - a.name.length)[0];
        if (named) {
            feature = named;
            consumed = nameMatchRegExp(named.name);
        }
    }

    if (!feature) return {};

    let secondary = consumed ? text.replace(consumed, '') : text;
    // Strip the feature name too when the item was matched by id but also
    // repeats the name ("F1: Quick capture — …").
    if (feature.name) {
        secondary = secondary.replace(nameMatchRegExp(feature.name), '');
    }
    secondary = secondary
        // An id matched inside brackets ("Name (F1): …") leaves an empty
        // "()" / "[]" behind once the token is stripped — remove it, or the
        // supporting copy renders as "(): Upload pipeline…".
        .replace(/\(\s*\)|\[\s*\]/g, '')
        .replace(/^[\s:–—-]+/, '')
        .replace(/[\s:–—-]+$/, '')
        .trim();

    return { feature, secondary: secondary || undefined };
}
