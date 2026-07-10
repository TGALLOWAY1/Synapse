// Pure derivation from a StructuredPRD that produces the
// "Implementation Summary" view rendered at the top of the PRD.
// No LLM call — we already have all the data, the user just shouldn't
// have to read 30 KB of prose to learn what to build first.

import type { Feature, RiskDetailed, StructuredPRD } from '../../types';

export type SummaryFeature = {
    id: string;
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
 * as deferred (hand-added features carry no tier and must stay visible). */
export function isDeferredFeature(feature: Feature): boolean {
    return feature.tier === 'later';
}

export type FeatureTierSplit = {
    /** MVP features PLUS untiered features that match no other bucket —
     * anything not explicitly pushed out of the initial build stays visible. */
    mvp: Feature[];
    v1: Feature[];
    /** Explicitly deferred (tier 'later') — surfaced only in the Decision Log. */
    deferred: Feature[];
};

/**
 * Split features into the display groups used by the Detailed Features
 * section: visible MVP (plus unclassified), collapsed V1, and deferred
 * (rendered only as Decision Log entries — PRD sections must not present
 * features outside the MVP/V1 phases).
 */
export function splitFeaturesByTier(features: Feature[]): FeatureTierSplit {
    const mvp: Feature[] = [];
    const v1: Feature[] = [];
    const deferred: Feature[] = [];
    features.forEach(f => {
        if (isDeferredFeature(f)) deferred.push(f);
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

function pickFeatures(features: Feature[]): {
    buildFirst: Feature[];
    buildNext: Feature[];
} {
    const tagged = features.some(f => f.tier || f.priority);
    if (!tagged) {
        // Legacy PRDs without any prioritization. Use declaration order
        // as a rough proxy: first 4 → first, next 4 → next.
        return {
            buildFirst: features.slice(0, 4),
            buildNext: features.slice(4, 8),
        };
    }
    const buildFirst = features.filter(isMvpFeature);
    const buildNext = features.filter(f => !isMvpFeature(f) && isV1Feature(f));

    // Within each bucket sort by the numeric portion of the feature id so the
    // user sees f1, f2, f3… in their natural order rather than a complexity
    // re-ranking that scrambles the numbers visible in the cards.
    const sortById = (arr: Feature[]) =>
        [...arr].sort((a, b) => featureIdSortKey(a.id) - featureIdSortKey(b.id));

    return {
        buildFirst: sortById(buildFirst),
        buildNext: sortById(buildNext),
    };
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
// uncapped — every tagged MVP/V1 feature must appear.
export function deriveImplementationSummary(prd: StructuredPRD): ImplementationSummary {
    const features = prd.features || [];
    const { buildFirst, buildNext } = pickFeatures(features);
    return {
        buildFirst: buildFirst.map(summaryFeatureFor),
        buildNext: buildNext.map(summaryFeatureFor),
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
