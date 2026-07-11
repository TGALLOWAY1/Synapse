// Pure, read-side derivations behind the three coordinated PRD views
// (Overview · Features · Decisions). No LLM call, no store access, no React —
// everything is computed at read time from the StructuredPRD so legacy PRDs
// (missing feature systems, tiers, assumptions decisions, …) render safely.
//
// These views are a presentation layer over the SAME canonical StructuredPRD:
// they share one version, one finalization state, one revision history, one
// freshness/provenance model. Nothing here is persisted as its own structure.

import type { Assumption, Feature, RiskDetailed, StructuredPRD } from '../../types';
import {
    deriveDeferredFeatureIds,
    isMvpFeature,
} from './implementationSummary';
import { splitAssumptions } from './prdDecisions';

// ── View identity ──────────────────────────────────────────────────────────

export type PrdViewId = 'overview' | 'features' | 'decisions';

export const PRD_VIEWS: ReadonlyArray<{ id: PrdViewId; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'features', label: 'Features' },
    { id: 'decisions', label: 'Decisions' },
];

/** Coerce an arbitrary query-param / stored value to a valid view id. */
export function coercePrdView(value: string | null | undefined): PrdViewId {
    return value === 'features' || value === 'decisions' ? value : 'overview';
}

// ── Features view: system grouping ───────────────────────────────────────────

export type FeatureSystemGroup = {
    /** FeatureSystem.id, or a synthetic id for the ungrouped bucket. */
    id: string;
    name: string;
    purpose?: string;
    /** User outcome the system supports (system.endToEndBehavior). */
    outcome?: string;
    features: Feature[];
    /** Count breakdown across the in-scope features shown in this group. */
    mvpCount: number;
    v1CountAll: number; // v1 + untiered non-mvp
    total: number;
    /** True for the synthetic "Other features" bucket (features with no system). */
    ungrouped?: boolean;
};

const UNGROUPED_ID = '__ungrouped__';

function tierCounts(features: Feature[]): { mvpCount: number; v1CountAll: number } {
    let mvpCount = 0;
    let v1CountAll = 0;
    features.forEach(f => {
        if (isMvpFeature(f)) mvpCount++;
        else v1CountAll++;
    });
    return { mvpCount, v1CountAll };
}

/**
 * Group a set of features under their FeatureSystems. Grouping is authoritative
 * from `featureSystems[].featureIds` (falling back to `feature.system`); any
 * feature not claimed by a system lands in a trailing "Other features" bucket.
 * The caller passes the features it wants grouped (already tier/status-filtered),
 * so this never re-applies the deferred rule itself.
 */
export function groupFeaturesBySystem(
    features: Feature[],
    prd: StructuredPRD,
): FeatureSystemGroup[] {
    const byId = new Map(features.map(f => [f.id, f]));
    const claimed = new Set<string>();
    const groups: FeatureSystemGroup[] = [];

    (prd.featureSystems ?? []).forEach(system => {
        const members: Feature[] = [];
        const seen = new Set<string>();
        // Primary: the system's own featureIds list.
        (system.featureIds ?? []).forEach(fid => {
            const f = byId.get(fid);
            if (f && !seen.has(f.id)) {
                members.push(f);
                seen.add(f.id);
            }
        });
        // Secondary: features that name this system on themselves.
        features.forEach(f => {
            if (seen.has(f.id)) return;
            if (f.system && (f.system === system.id || f.system === system.name)) {
                members.push(f);
                seen.add(f.id);
            }
        });
        if (members.length === 0) return; // empty system after filtering → hide
        members.forEach(f => claimed.add(f.id));
        const { mvpCount, v1CountAll } = tierCounts(members);
        groups.push({
            id: system.id,
            name: system.name,
            purpose: system.purpose,
            outcome: system.endToEndBehavior,
            features: members,
            mvpCount,
            v1CountAll,
            total: members.length,
        });
    });

    const ungrouped = features.filter(f => !claimed.has(f.id));
    if (ungrouped.length > 0) {
        const { mvpCount, v1CountAll } = tierCounts(ungrouped);
        groups.push({
            id: UNGROUPED_ID,
            name: groups.length > 0 ? 'Other features' : 'All features',
            features: ungrouped,
            mvpCount,
            v1CountAll,
            total: ungrouped.length,
            ungrouped: true,
        });
    }
    return groups;
}

// ── Features view: filtering ─────────────────────────────────────────────────

export type FeatureFilterId = 'all' | 'mvp' | 'later' | 'needs_review' | 'confirmed';

export const FEATURE_FILTERS: ReadonlyArray<{ id: FeatureFilterId; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'mvp', label: 'MVP' },
    { id: 'later', label: 'Later' },
    { id: 'needs_review', label: 'Needs review' },
    { id: 'confirmed', label: 'Confirmed' },
];

/**
 * Filter features for the Features view. In-scope (MVP + V1 + untiered)
 * features are the default surface; deferred features are reachable only via
 * the explicit "Later" filter (their rationale stays in the Decisions view).
 */
export function filterFeatures(
    features: Feature[],
    filter: FeatureFilterId,
    deferredIds: ReadonlySet<string>,
): Feature[] {
    const inScope = features.filter(f => !deferredIds.has(f.id));
    switch (filter) {
        case 'mvp':
            return inScope.filter(isMvpFeature);
        case 'later':
            return features.filter(f => deferredIds.has(f.id));
        case 'needs_review':
            return inScope.filter(f => !f.confirmed);
        case 'confirmed':
            return inScope.filter(f => !!f.confirmed);
        case 'all':
        default:
            return inScope;
    }
}

/** Per-filter counts for the filter control, computed once. */
export function featureFilterCounts(
    features: Feature[],
    deferredIds: ReadonlySet<string>,
): Record<FeatureFilterId, number> {
    return {
        all: filterFeatures(features, 'all', deferredIds).length,
        mvp: filterFeatures(features, 'mvp', deferredIds).length,
        later: filterFeatures(features, 'later', deferredIds).length,
        needs_review: filterFeatures(features, 'needs_review', deferredIds).length,
        confirmed: filterFeatures(features, 'confirmed', deferredIds).length,
    };
}

// ── Features view: traceability ──────────────────────────────────────────────

export type FeatureTrace = {
    /** Related features resolved from explicit `dependencies` ids. */
    dependencies: Array<{ id: string; name: string }>;
    /** The feature system this feature rolls up under, if any. */
    system?: { id: string; name: string };
    /** Product principles this feature explicitly names (exact, id-based only). */
    principles: string[];
};

/**
 * Derive a feature's product-context links. Deliberately conservative — only
 * EXPLICIT references are surfaced (dependency ids, system membership); we never
 * fabricate goal/metric/user links from vague keyword overlap. Unresolved
 * dependency ids are dropped rather than shown as broken links.
 */
export function deriveFeatureTrace(feature: Feature, prd: StructuredPRD): FeatureTrace {
    const byId = new Map((prd.features ?? []).map(f => [f.id, f]));
    const dependencies = (feature.dependencies ?? [])
        .map(id => {
            const dep = byId.get(id);
            return dep ? { id: dep.id, name: dep.name } : null;
        })
        .filter((x): x is { id: string; name: string } => !!x);

    let system: { id: string; name: string } | undefined;
    const owningSystem = (prd.featureSystems ?? []).find(
        s => (s.featureIds ?? []).includes(feature.id)
            || feature.system === s.id
            || feature.system === s.name,
    );
    if (owningSystem) system = { id: owningSystem.id, name: owningSystem.name };

    return { dependencies, system, principles: [] };
}

// ── Decisions view: inputs ───────────────────────────────────────────────────

export type DecisionInputs = {
    /**
     * Low-confidence unresolved assumptions — genuinely uncertain, so they read
     * as questions the user should answer before relying on them.
     */
    needsInput: Assumption[];
    /**
     * Medium/high-confidence unresolved assumptions — plausible statements to
     * validate and then confirm (or correct).
     */
    toValidate: Assumption[];
};

/**
 * Split the unresolved assumptions into the two actionable Decisions buckets.
 * A single assumption appears in exactly one bucket (never both), keyed off its
 * confidence, so the two sections never duplicate the same uncertainty.
 */
export function splitDecisionInputs(assumptions: Assumption[] | undefined): DecisionInputs {
    const { unresolved } = splitAssumptions(assumptions);
    return {
        needsInput: unresolved.filter(a => a.confidence === 'low'),
        toValidate: unresolved.filter(a => a.confidence !== 'low'),
    };
}

// ── Decisions view: risks ────────────────────────────────────────────────────

export type NormalizedRisk = {
    risk: string;
    likelihood?: 'low' | 'med' | 'high';
    impact?: string;
    mitigation?: string;
    owner?: string;
};

/** Normalize detailed or legacy string risks into one shape for the Decisions view. */
export function deriveRisks(prd: StructuredPRD): NormalizedRisk[] {
    if (prd.risksDetailed?.length) {
        return prd.risksDetailed.map((r: RiskDetailed) => ({
            risk: r.risk,
            likelihood: r.likelihood,
            impact: r.impact,
            mitigation: r.mitigation,
            owner: r.owner,
        }));
    }
    return (prd.risks ?? []).map(r => ({ risk: r }));
}

// ── Cross-view presence checks (drive empty-state / tab affordances) ─────────

/** Does the PRD carry anything worth showing in the Decisions view? */
export function hasDecisionContent(prd: StructuredPRD): boolean {
    const { unresolved, decided } = splitAssumptions(prd.assumptions);
    const deferred = deriveDeferredFeatureIds(prd);
    return (
        unresolved.length > 0 ||
        decided.length > 0 ||
        deferred.size > 0 ||
        (prd.features ?? []).some(f => f.confirmed) ||
        deriveRisks(prd).length > 0 ||
        (prd.mvpScope?.later?.length ?? 0) > 0
    );
}
