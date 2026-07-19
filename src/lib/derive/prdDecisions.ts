// Pure derivations behind the PRD "Review & Confirm" section and the
// Decision Log. No LLM call, no store access — everything is computed at
// read time from the StructuredPRD so legacy PRDs (whose assumptions carry
// no decision fields) render safely as "all unresolved".

import type { Assumption, StructuredPRD } from '../../types';
import { deriveDeferredFeatureIds } from './implementationSummary';
import { resolveScopeFeature } from './scopeFeatureMatch';

// Back-compat re-export — resolveScopeFeature moved to scopeFeatureMatch.ts
// (implementationSummary needs it too, and importing it from here would cycle).
export { resolveScopeFeature } from './scopeFeatureMatch';
export type { ScopeFeatureMatch } from './scopeFeatureMatch';

const CONFIDENCE_RANK: Record<string, number> = { high: 0, med: 1, low: 2 };
const MATERIALITY_RANK: Record<string, number> = { blocking: 0, high: 1, normal: 2, low: 3 };

/** Missing/unknown confidence sorts last, after low. */
const confidenceRank = (a: Assumption): number =>
    CONFIDENCE_RANK[a.confidence] ?? 3;
const materialityRank = (a: Assumption): number => MATERIALITY_RANK[a.materiality ?? 'normal'] ?? 2;

/**
 * Order assumptions by consequence first, then confidence. Confidence is
 * plausibility, not priority; a speculative product-defining assumption must
 * appear before an easy but low-impact confirmation.
 */
export function sortAssumptionsByConfidence(assumptions: Assumption[]): Assumption[] {
    return assumptions
        .map((a, i) => ({ a, i }))
        .sort((x, y) => materialityRank(x.a) - materialityRank(y.a)
            || confidenceRank(x.a) - confidenceRank(y.a)
            || x.i - y.i)
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
    /** Stable id of the source item (assumption id / feature id / scope item). */
    id: string;
    kind: 'assumption' | 'feature' | 'scope';
    verdict: 'confirmed' | 'rejected' | 'deferred';
    /** Short reference label shown as a badge (assumption id or feature id). */
    label: string;
    statement: string;
    note?: string;
    decidedAt?: number;
    materiality?: Assumption['materiality'];
};

/**
 * Derive the Decision Log — decided items only, never unresolved assumptions.
 * Sources: assumptions the user confirmed/rejected, features the user
 * confirmed, and DEFERRED scope (features tagged 'later' plus `mvpScope.later`
 * items). The Decision Log is the ONLY place deferred work is presented — no
 * other PRD section may refer to features outside the MVP/V1 phases. User
 * decisions are ordered chronologically (undated last, in document order);
 * deferred entries carry no timestamp so they read as a trailing record.
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
            materiality: a.materiality,
        });
    });

    const features = prd.features ?? [];
    features.forEach(f => {
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

    // Deferred scope — the record of what was consciously pushed out of the
    // MVP/V1 phases. The deferred set (deriveDeferredFeatureIds) is the same
    // one the renderers use to EXCLUDE these features from every other PRD
    // section, so a feature can never read as both deferred and in scope.
    const deferredIds = deriveDeferredFeatureIds(prd);
    features.forEach(f => {
        if (!deferredIds.has(f.id)) return;
        entries.push({
            id: f.id,
            kind: 'feature',
            verdict: 'deferred',
            label: f.id,
            statement: f.name,
            note: f.description || undefined,
        });
    });

    // mvpScope "Later" items that did NOT resolve into the deferred set —
    // plain prose, or a data conflict where the item names a feature whose
    // explicit mvp/v1 tier tag wins. Logged as raw scope records.
    (prd.mvpScope?.later ?? []).forEach((item, i) => {
        const match = resolveScopeFeature(item, features);
        if (match.feature && deferredIds.has(match.feature.id)) return; // logged above
        entries.push({
            id: `scope-later-${i}`,
            kind: 'scope',
            verdict: 'deferred',
            label: '',
            statement: item,
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

// (resolveScopeFeature lives in scopeFeatureMatch.ts — re-exported above.)

export type DecisionEditCounts = { confirmed: number; corrected: number; reopened: number };

/**
 * Build the edit-summary line for a (possibly coalesced) run of Decisions-tab
 * edits. When exactly one edit has happened and a specific `firstSummary` was
 * captured (e.g. "Confirmed assumption: X…"), that text is preserved. Once two
 * or more edits coalesce, a deterministic aggregate is produced instead — the
 * non-zero buckets in fixed priority order (confirmed → corrected → reopened),
 * joined with " · ", pluralizing "decision(s)" once, on the lead segment only
 * (e.g. "Confirmed 2 decisions · corrected 1").
 */
export function buildDecisionEditSummary(
    counts: DecisionEditCounts,
    firstSummary?: string,
): string {
    const total = counts.confirmed + counts.corrected + counts.reopened;
    if (total === 1 && firstSummary) return firstSummary;

    // Buckets in fixed priority order.
    const buckets: { verb: string; count: number }[] = [
        { verb: 'Confirmed', count: counts.confirmed },
        { verb: 'corrected', count: counts.corrected },
        { verb: 'reopened', count: counts.reopened },
    ];
    const present = buckets.filter(b => b.count > 0);
    if (present.length === 0) return 'Updated decisions';

    return present
        .map((b, i) => {
            // Capitalize the lead verb; subordinate verbs stay lowercase.
            const verb = i === 0
                ? b.verb.charAt(0).toUpperCase() + b.verb.slice(1)
                : b.verb.toLowerCase();
            // Pluralize the noun once, on the lead segment only.
            if (i === 0) return `${verb} ${b.count} ${b.count === 1 ? 'decision' : 'decisions'}`;
            return `${verb} ${b.count}`;
        })
        .join(' · ');
}
