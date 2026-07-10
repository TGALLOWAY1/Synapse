// Pure derivations behind the PRD "Review & Confirm" section and the
// Decision Log. No LLM call, no store access — everything is computed at
// read time from the StructuredPRD so legacy PRDs (whose assumptions carry
// no decision fields) render safely as "all unresolved".

import type { Assumption, Feature, StructuredPRD } from '../../types';

const CONFIDENCE_RANK: Record<string, number> = { high: 0, med: 1, low: 2 };

/** Missing/unknown confidence sorts last, after low. */
const confidenceRank = (a: Assumption): number =>
    CONFIDENCE_RANK[a.confidence] ?? 3;

/**
 * Order assumptions by confidence, highest first. Deterministic and stable:
 * items sharing a confidence keep their original relative order, and
 * missing/unknown confidence values sort last.
 */
export function sortAssumptionsByConfidence(assumptions: Assumption[]): Assumption[] {
    return assumptions
        .map((a, i) => ({ a, i }))
        .sort((x, y) => confidenceRank(x.a) - confidenceRank(y.a) || x.i - y.i)
        .map(x => x.a);
}

export type AssumptionSplit = {
    /** Undecided items, sorted by confidence (highest first). */
    unresolved: Assumption[];
    /** Confirmed/rejected items, in original document order. */
    decided: Assumption[];
};

/** Split assumptions into unresolved (needs user input) vs decided. */
export function splitAssumptions(assumptions: Assumption[] | undefined): AssumptionSplit {
    const list = assumptions ?? [];
    return {
        unresolved: sortAssumptionsByConfidence(list.filter(a => !a.decision)),
        decided: list.filter(a => !!a.decision),
    };
}

export type DecisionLogEntry = {
    /** Stable id of the source item (assumption id / feature id). */
    id: string;
    kind: 'assumption' | 'feature';
    verdict: 'confirmed' | 'rejected';
    /** Short reference label shown as a badge (assumption id or feature id). */
    label: string;
    statement: string;
    note?: string;
    decidedAt?: number;
};

/**
 * Derive the Decision Log — confirmed user choices only, never unresolved
 * assumptions. Sources: assumptions the user confirmed/rejected and features
 * the user confirmed. Ordered chronologically by decision time (undated
 * entries last, in document order) so the log reads as a running record.
 */
export function deriveDecisionLog(prd: StructuredPRD): DecisionLogEntry[] {
    const entries: DecisionLogEntry[] = [];

    (prd.assumptions ?? []).forEach(a => {
        if (!a.decision) return;
        entries.push({
            id: a.id,
            kind: 'assumption',
            verdict: a.decision,
            label: a.id,
            statement: a.statement,
            note: a.decisionNote || undefined,
            decidedAt: a.decidedAt,
        });
    });

    (prd.features ?? []).forEach(f => {
        if (!f.confirmed) return;
        entries.push({
            id: f.id,
            kind: 'feature',
            verdict: 'confirmed',
            label: f.id,
            statement: f.name,
            decidedAt: f.confirmedAt,
        });
    });

    return entries
        .map((e, i) => ({ e, i }))
        .sort((x, y) => {
            const xa = x.e.decidedAt ?? Number.MAX_SAFE_INTEGER;
            const ya = y.e.decidedAt ?? Number.MAX_SAFE_INTEGER;
            return xa - ya || x.i - y.i;
        })
        .map(x => x.e);
}

/**
 * True when a feature id is a short human-readable token (F1, f12) worth
 * rendering as an id badge. Hand-added features get uuids — showing those as
 * badges would be noise, so callers hide the badge instead.
 */
export function isDisplayableFeatureId(id: string | undefined): boolean {
    return !!id && /^[a-zA-Z]{1,3}-?\d{1,3}$/.test(id.trim());
}

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
        .replace(/^[\s:–—-]+/, '')
        .replace(/[\s:–—-]+$/, '')
        .trim();

    return { feature, secondary: secondary || undefined };
}
