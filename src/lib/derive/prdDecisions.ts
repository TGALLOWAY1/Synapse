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
    /** Stable id of the source item (assumption id / feature id / scope item). */
    id: string;
    kind: 'assumption' | 'feature' | 'scope';
    verdict: 'confirmed' | 'rejected' | 'deferred';
    /** Short reference label shown as a badge (assumption id or feature id). */
    label: string;
    statement: string;
    note?: string;
    decidedAt?: number;
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
