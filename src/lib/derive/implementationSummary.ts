// Pure derivation from a StructuredPRD that produces the
// "Implementation Summary" view rendered at the top of the PRD.
// No LLM call — we already have all the data, the user just shouldn't
// have to read 30 KB of prose to learn what to build first.

import type { Feature, RiskDetailed, StructuredPRD } from '../../types';
import { resolveScopeFeature } from './scopeFeatureMatch';

export type SummaryFeature = {
    /** Present when the entry is backed by a PRD feature; absent for a
     * free-form mvpScope string that resolves to no feature. */
    id?: string;
    name: string;
    reason?: string;
};

export type SummaryRisk = {
    risk: string;
    likelihood: string;
    impact: string;
};

// Note: the old "Defer" bucket and "Open Decisions" list were removed from
// this summary — deferred work lives in the Decision Log (as "Deferred"
// entries), and open decisions moved to the actionable "Review & Confirm"
// section (src/lib/derive/prdDecisions.ts).
export type ImplementationSummary = {
    buildFirst: SummaryFeature[];
    buildNext: SummaryFeature[];
    highestRisks: SummaryRisk[];
};

/** DOM id of a feature's detail card in the PRD view — the Implementation
 * Summary cards deep-link to it and the detail cards link back. */
export const featureDetailAnchorId = (featureId: string) => `prd-feature-${featureId}`;

const HIGH_IMPACT_KEYWORDS = /(outage|loss|critical|blocker|catastroph|exposed|leak|breach)/i;
const MAX_RISKS = 4;
const MAX_REASON_LENGTH = 110;

export function isMvpFeature(feature: Feature): boolean {
    if (feature.tier === 'mvp') return true;
    if (!feature.tier && feature.priority === 'must') return true;
    return false;
}

export function isV1Feature(feature: Feature): boolean {
    if (feature.tier === 'v1') return true;
    if (!feature.tier && feature.priority === 'should') return true;
    return false;
}

/** Deferred = explicitly tagged 'later'. Untagged features are never treated
 * as deferred by tier alone (hand-added features carry no tier and must stay
 * visible) — see deriveDeferredFeatureIds for the scope-aware full set. */
export function isDeferredFeature(feature: Feature): boolean {
    return feature.tier === 'later';
}

/**
 * The complete deferred set: features tagged 'later' PLUS features an
 * `mvpScope.later` item resolves to. An explicit mvp/v1 tier tag is
 * authoritative — a later item naming a tier-tagged feature is a data
 * conflict and never hides that feature (it stays in its tagged phase; the
 * later item is logged as a raw scope record instead). This one set drives
 * every surface — Detailed Features, Feature Systems chips, the summary
 * buckets, and the Decision Log's Deferred entries — so a feature can never
 * read as both deferred and in scope.
 */
export function deriveDeferredFeatureIds(prd: StructuredPRD): Set<string> {
    const features = prd.features || [];
    const ids = new Set(features.filter(isDeferredFeature).map(f => f.id));
    (prd.mvpScope?.later ?? []).forEach(item => {
        const match = resolveScopeFeature(item, features);
        if (match.feature && match.feature.tier !== 'mvp' && match.feature.tier !== 'v1') {
            ids.add(match.feature.id);
        }
    });
    return ids;
}

export type FeatureTierSplit = {
    /** MVP features PLUS untiered features that match no other bucket —
     * anything not explicitly pushed out of the initial build stays visible. */
    mvp: Feature[];
    v1: Feature[];
    /** Deferred — surfaced only as Decision Log entries. */
    deferred: Feature[];
};

/**
 * Split features into the display groups used by the Detailed Features
 * section: visible MVP (plus unclassified), collapsed V1, and deferred
 * (rendered only as Decision Log entries — PRD sections must not present
 * features outside the MVP/V1 phases). Pass `deriveDeferredFeatureIds(prd)`
 * as `deferredIds` so scope-deferred (untagged) features are excluded too;
 * without it only tier-tagged deferral applies.
 */
export function splitFeaturesByTier(
    features: Feature[],
    deferredIds?: ReadonlySet<string>,
): FeatureTierSplit {
    const mvp: Feature[] = [];
    const v1: Feature[] = [];
    const deferred: Feature[] = [];
    features.forEach(f => {
        if (isDeferredFeature(f) || deferredIds?.has(f.id)) deferred.push(f);
        else if (isV1Feature(f)) v1.push(f);
        else mvp.push(f);
    });
    return { mvp, v1, deferred };
}

function featureIdSortKey(id: string): number {
    const match = id.match(/\d+/);
    return match ? parseInt(match[0], 10) : Number.MAX_SAFE_INTEGER;
}

function summaryFeatureFor(f: Feature): SummaryFeature {
    return { id: f.id, name: f.name, reason: buildReason(f) };
}

// A short "what this feature is" line — the feature description (falling back
// to user value). Deliberately NOT prefixed with the complexity rating: an
// unexplained "low · " / "high · " read as noise in the summary cards.
function buildReason(f: Feature): string | undefined {
    const text = (f.description || f.userValue || '').trim();
    if (!text) return undefined;
    return text.length > MAX_REASON_LENGTH
        ? `${text.slice(0, MAX_REASON_LENGTH - 2).trim()}…`
        : text;
}

function pickBuckets(prd: StructuredPRD): {
    buildFirst: SummaryFeature[];
    buildNext: SummaryFeature[];
} {
    const features = prd.features || [];
    const deferredIds = deriveDeferredFeatureIds(prd);
    const active = features.filter(f => !deferredIds.has(f.id));
    const tagged = active.some(f => f.tier || f.priority);
    const scope = prd.mvpScope;
    const hasScopeLists = !!scope && (scope.mvp.length > 0 || scope.v1.length > 0);

    let first: Feature[] = [];
    let next: Feature[] = [];
    if (tagged) {
        first = active.filter(isMvpFeature);
        next = active.filter(f => !isMvpFeature(f) && isV1Feature(f));
    } else if (!hasScopeLists) {
        // Legacy PRDs with no prioritization signal at all. Use declaration
        // order as a rough proxy: first 4 → first, next 4 → next.
        first = active.slice(0, 4);
        next = active.slice(4, 8);
    }
    // (untagged + scope lists → the explicit scope entries below drive the
    // buckets instead of a declaration-order guess)

    // Within each bucket sort by the numeric portion of the feature id so the
    // user sees f1, f2, f3… in their natural order rather than a complexity
    // re-ranking that scrambles the numbers visible in the cards.
    const sortById = (arr: Feature[]) =>
        [...arr].sort((a, b) => featureIdSortKey(a.id) - featureIdSortKey(b.id));

    const buildFirst: SummaryFeature[] = sortById(first).map(summaryFeatureFor);
    const buildNext: SummaryFeature[] = sortById(next).map(summaryFeatureFor);

    // Explicit mvpScope entries the feature buckets don't already carry —
    // scope lists are free-form strings, so a legacy PRD's ship-first/next
    // decisions must not vanish just because no feature is tier-tagged.
    if (scope) {
        const seen = new Set([...first, ...next].map(f => f.id));
        const augment = (items: string[], bucket: SummaryFeature[]) => {
            items.forEach(item => {
                const match = resolveScopeFeature(item, features);
                if (match.feature) {
                    if (seen.has(match.feature.id) || deferredIds.has(match.feature.id)) return;
                    seen.add(match.feature.id);
                    bucket.push(summaryFeatureFor(match.feature));
                } else {
                    bucket.push({ name: item });
                }
            });
        };
        augment(scope.mvp ?? [], buildFirst);
        augment(scope.v1 ?? [], buildNext);
    }

    return { buildFirst, buildNext };
}

function pickHighestRisks(prd: StructuredPRD): SummaryRisk[] {
    const detailed = prd.risksDetailed;
    if (detailed && detailed.length > 0) {
        const ranked = [...detailed].sort((a, b) => {
            const aHigh = a.likelihood === 'high' ? 0 : a.likelihood === 'med' ? 1 : 2;
            const bHigh = b.likelihood === 'high' ? 0 : b.likelihood === 'med' ? 1 : 2;
            if (aHigh !== bHigh) return aHigh - bHigh;
            // Tie-break on impact keywords.
            const aSev = HIGH_IMPACT_KEYWORDS.test(a.impact) ? 0 : 1;
            const bSev = HIGH_IMPACT_KEYWORDS.test(b.impact) ? 0 : 1;
            return aSev - bSev;
        });
        const flagged: RiskDetailed[] = ranked.filter(
            r => r.likelihood === 'high' || HIGH_IMPACT_KEYWORDS.test(r.impact),
        );
        const source = flagged.length > 0 ? flagged : ranked;
        return source.slice(0, MAX_RISKS).map(r => ({
            risk: r.risk,
            likelihood: r.likelihood,
            impact: r.impact,
        }));
    }
    // Legacy plain string list.
    const fallback = (prd.risks || []).slice(0, 3);
    return fallback.map(r => ({ risk: r, likelihood: 'unknown', impact: '' }));
}

// The summary is THE section presenting MVP/V1 scope (the old MVP Scope
// feature lists were folded into it), so the buckets are deliberately
// uncapped — every tagged MVP/V1 feature and explicit scope entry appears.
export function deriveImplementationSummary(prd: StructuredPRD): ImplementationSummary {
    const { buildFirst, buildNext } = pickBuckets(prd);
    return {
        buildFirst,
        buildNext,
        highestRisks: pickHighestRisks(prd),
    };
}

export function isImplementationSummaryEmpty(s: ImplementationSummary): boolean {
    return (
        s.buildFirst.length === 0 &&
        s.buildNext.length === 0 &&
        s.highestRisks.length === 0
    );
}
