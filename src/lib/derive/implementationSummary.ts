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

export type SummaryDecision = {
    id: string;
    statement: string;
};

export type ImplementationSummary = {
    buildFirst: SummaryFeature[];
    buildNext: SummaryFeature[];
    defer: SummaryFeature[];
    highestRisks: SummaryRisk[];
    openDecisions: SummaryDecision[];
};

const HIGH_IMPACT_KEYWORDS = /(outage|loss|critical|blocker|catastroph|exposed|leak|breach)/i;
const MAX_FEATURES_PER_BUCKET = 5;
const MAX_RISKS = 4;
const MAX_DECISIONS = 4;

function isMvp(feature: Feature): boolean {
    if (feature.tier === 'mvp') return true;
    if (!feature.tier && feature.priority === 'must') return true;
    return false;
}

function isV1(feature: Feature): boolean {
    if (feature.tier === 'v1') return true;
    if (!feature.tier && feature.priority === 'should') return true;
    return false;
}

function isLater(feature: Feature): boolean {
    if (feature.tier === 'later') return true;
    if (!feature.tier && feature.priority === 'could') return true;
    return false;
}

function featureIdSortKey(id: string): number {
    const match = id.match(/\d+/);
    return match ? parseInt(match[0], 10) : Number.MAX_SAFE_INTEGER;
}

function summaryFeatureFor(f: Feature, withReason: boolean): SummaryFeature {
    const reason = withReason
        ? buildReason(f)
        : undefined;
    return { id: f.id, name: f.name, reason };
}

function buildReason(f: Feature): string {
    const parts: string[] = [];
    if (f.complexity) parts.push(f.complexity);
    if (f.userValue) {
        const trimmed = f.userValue.length > 80
            ? `${f.userValue.slice(0, 78).trim()}…`
            : f.userValue;
        parts.push(trimmed);
    }
    return parts.join(' · ');
}

function pickFeatures(features: Feature[]): {
    buildFirst: Feature[];
    buildNext: Feature[];
    defer: Feature[];
} {
    const tagged = features.some(f => f.tier || f.priority);
    if (!tagged) {
        // Legacy PRDs without any prioritization. Use declaration order
        // as a rough proxy: first 4 → first, next 4 → next, rest → defer.
        return {
            buildFirst: features.slice(0, 4),
            buildNext: features.slice(4, 8),
            defer: features.slice(8),
        };
    }
    const buildFirst = features.filter(isMvp);
    const buildNext = features.filter(f => !isMvp(f) && isV1(f));
    const defer = features.filter(f => !isMvp(f) && !isV1(f) && isLater(f));

    // Within each bucket sort by the numeric portion of the feature id so the
    // user sees f1, f2, f3… in their natural order rather than a complexity
    // re-ranking that scrambles the numbers visible in the cards.
    const sortById = (arr: Feature[]) =>
        [...arr].sort((a, b) => featureIdSortKey(a.id) - featureIdSortKey(b.id));

    return {
        buildFirst: sortById(buildFirst),
        buildNext: sortById(buildNext),
        defer: sortById(defer),
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

function pickOpenDecisions(prd: StructuredPRD): SummaryDecision[] {
    const assumptions = prd.assumptions || [];
    const lowConfidence = assumptions.filter(a => a.confidence === 'low');
    const source = lowConfidence.length > 0 ? lowConfidence : assumptions.slice(0, MAX_DECISIONS);
    return source.slice(0, MAX_DECISIONS).map(a => ({
        id: a.id,
        statement: a.statement,
    }));
}

export function deriveImplementationSummary(prd: StructuredPRD): ImplementationSummary {
    const features = prd.features || [];
    const { buildFirst, buildNext, defer } = pickFeatures(features);
    return {
        buildFirst: buildFirst.slice(0, MAX_FEATURES_PER_BUCKET).map(f => summaryFeatureFor(f, true)),
        buildNext: buildNext.slice(0, MAX_FEATURES_PER_BUCKET).map(f => summaryFeatureFor(f, false)),
        defer: defer.slice(0, MAX_FEATURES_PER_BUCKET).map(f => summaryFeatureFor(f, false)),
        highestRisks: pickHighestRisks(prd),
        openDecisions: pickOpenDecisions(prd),
    };
}

export function isImplementationSummaryEmpty(s: ImplementationSummary): boolean {
    return (
        s.buildFirst.length === 0 &&
        s.buildNext.length === 0 &&
        s.defer.length === 0 &&
        s.highestRisks.length === 0 &&
        s.openDecisions.length === 0
    );
}
