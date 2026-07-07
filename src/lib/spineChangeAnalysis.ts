// Pure spine-change analysis — the "what changed" layer behind change-aware
// staleness. Given two PRD snapshots (an artifact's source spine version and
// the current latest spine), it produces:
//
//   - a feature-level diff keyed by the stable `Feature.id` (added / removed /
//     renamed / changed) — the first user-facing use of the system's most
//     stable identity,
//   - a section-level change list (reusing versionDiff's section model), and
//   - a deterministic one-line headline ("1 feature removed · Architecture
//     changed") — never an LLM call, so it is free, instant, and honest.
//
// It also owns the conservative ARTIFACT_SECTION_AFFINITY map used for the
// advisory "no changes in the sections this asset chiefly derives from" note,
// and `findFeatureReferences`, the removed-feature blast-radius scan.
//
// Everything here is computed at read time from stored full snapshots —
// nothing is persisted. This module must stay free of store/React/LLM imports
// (mirrors versionDiff.ts / artifactDependencyGraph.ts).

import { diffStructuredPRD, type SectionDiff } from './versionDiff';
import type { ArtifactSlotKey, Feature, StructuredPRD } from '../types';

// ---------------------------------------------------------------------------
// Feature-level diff (by stable Feature.id)
// ---------------------------------------------------------------------------

export type FeatureDiff = {
    added: { id: string; name: string }[];
    removed: { id: string; name: string }[];
    /** Same id, different name. May ALSO appear in `changed` if other fields moved. */
    renamed: { id: string; from: string; to: string }[];
    /** Same id, non-name fields differ. `name` is the AFTER name. */
    changed: { id: string; name: string; changedFields: string[] }[];
};

// Fields compared for the `changed` classification. Name is handled
// separately (rename). Presentation-only premium fields are included where
// they change what downstream artifacts build.
const FEATURE_COMPARE_FIELDS = [
    'description',
    'userValue',
    'complexity',
    'priority',
    'acceptanceCriteria',
    'dependencies',
    'successCriteria',
    'edgeCases',
    'failureModes',
    'tier',
] as const;

const normalizeField = (value: unknown): string =>
    value === undefined || value === null ? '' : JSON.stringify(value);

/**
 * Diff two feature lists by stable id. Features without an id are ignored
 * (defensive — canonical PRDs always carry ids).
 */
export function diffFeatures(before?: Feature[], after?: Feature[]): FeatureDiff {
    const beforeById = new Map<string, Feature>();
    for (const f of before ?? []) if (f.id) beforeById.set(f.id, f);
    const afterById = new Map<string, Feature>();
    for (const f of after ?? []) if (f.id) afterById.set(f.id, f);

    const diff: FeatureDiff = { added: [], removed: [], renamed: [], changed: [] };

    for (const [id, f] of afterById) {
        if (!beforeById.has(id)) diff.added.push({ id, name: f.name });
    }
    for (const [id, f] of beforeById) {
        const next = afterById.get(id);
        if (!next) {
            diff.removed.push({ id, name: f.name });
            continue;
        }
        if ((f.name ?? '').trim() !== (next.name ?? '').trim()) {
            diff.renamed.push({ id, from: f.name, to: next.name });
        }
        const changedFields = FEATURE_COMPARE_FIELDS.filter(
            (field) => normalizeField(f[field]) !== normalizeField(next[field]),
        );
        if (changedFields.length > 0) {
            diff.changed.push({ id, name: next.name, changedFields: [...changedFields] });
        }
    }

    return diff;
}

// ---------------------------------------------------------------------------
// Spine change summary
// ---------------------------------------------------------------------------

export type SpineChangeSummary = {
    /**
     * False when either side lacks a structured PRD (legacy markdown-only
     * spine) — the detail fields are then empty and only the generic headline
     * applies. Never claim "likely unaffected" from an incomparable summary.
     */
    comparable: boolean;
    hasChanges: boolean;
    /** Per-section diffs (versionDiff SECTION_SPECS order). Empty when not comparable. */
    sections: SectionDiff[];
    /** Section keys with kind !== 'unchanged'. */
    changedSectionKeys: string[];
    /** Human labels for changedSectionKeys. */
    changedSectionLabels: string[];
    features: FeatureDiff;
    /** Deterministic one-liner, e.g. "1 feature removed · Architecture changed". */
    headline: string;
};

const EMPTY_FEATURE_DIFF: FeatureDiff = { added: [], removed: [], renamed: [], changed: [] };

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

const MAX_HEADLINE_SECTION_LABELS = 3;

/**
 * Summarize what changed between two PRD snapshots. Deterministic and cheap;
 * safe with partial/legacy PRDs (an incomparable pair degrades to a generic
 * "PRD content changed" headline instead of a noisy everything-added diff).
 */
export function summarizeSpineChange(
    before: StructuredPRD | undefined,
    after: StructuredPRD | undefined,
): SpineChangeSummary {
    if (!before || !after) {
        return {
            comparable: false,
            hasChanges: true,
            sections: [],
            changedSectionKeys: [],
            changedSectionLabels: [],
            features: EMPTY_FEATURE_DIFF,
            headline: 'PRD content changed (detailed comparison unavailable for this version)',
        };
    }

    const sections = diffStructuredPRD(before, after);
    const changedSections = sections.filter((s) => s.kind !== 'unchanged');
    const features = diffFeatures(before.features, after.features);

    const parts: string[] = [];
    if (features.removed.length > 0) parts.push(`${plural(features.removed.length, 'feature')} removed`);
    if (features.added.length > 0) parts.push(`${plural(features.added.length, 'feature')} added`);
    if (features.renamed.length > 0) parts.push(`${plural(features.renamed.length, 'feature')} renamed`);
    if (features.changed.length > 0) parts.push(`${plural(features.changed.length, 'feature')} changed`);

    // Non-feature section labels ('Features' is already covered above, and in
    // more detail). Capped so the headline stays one line.
    const otherLabels = changedSections.filter((s) => s.key !== 'features').map((s) => s.label);
    if (otherLabels.length > 0) {
        const shown = otherLabels.slice(0, MAX_HEADLINE_SECTION_LABELS);
        const more = otherLabels.length - shown.length;
        parts.push(`${shown.join(', ')}${more > 0 ? ` +${more} more` : ''} changed`);
    }

    const hasChanges = changedSections.length > 0
        || features.added.length > 0
        || features.removed.length > 0
        || features.renamed.length > 0
        || features.changed.length > 0;

    return {
        comparable: true,
        hasChanges,
        sections,
        changedSectionKeys: changedSections.map((s) => s.key),
        changedSectionLabels: changedSections.map((s) => s.label),
        features,
        headline: hasChanges ? parts.join(' · ') : 'No structural changes detected',
    };
}

// ---------------------------------------------------------------------------
// Section → artifact affinity (advisory scoping)
// ---------------------------------------------------------------------------

// Identity- and safety-level sections affect every artifact — including them
// in every affinity set keeps the "likely unaffected" note conservative:
// it only ever appears for genuinely narrow changes (e.g. a risks-only edit
// leaving the screens untouched).
const UNIVERSAL_SECTIONS = ['vision', 'coreProblem', 'constraints'] as const;

/**
 * The PRD sections each artifact slot *chiefly derives from*. Used ONLY for
 * the advisory "no changes in the sections this asset chiefly derives from"
 * annotation — never to suppress a hard needs_update (every artifact really is
 * generated from the whole PRD). Keys are versionDiff SECTION_SPECS keys.
 */
export const ARTIFACT_SECTION_AFFINITY: Record<ArtifactSlotKey, readonly string[]> = {
    design_system: [...UNIVERSAL_SECTIONS, 'targetUsers', 'uxPages'],
    screen_inventory: [...UNIVERSAL_SECTIONS, 'features', 'uxPages', 'targetUsers', 'primaryActions'],
    user_flows: [...UNIVERSAL_SECTIONS, 'features', 'uxPages', 'targetUsers', 'primaryActions'],
    component_inventory: [...UNIVERSAL_SECTIONS, 'features', 'uxPages'],
    data_model: [...UNIVERSAL_SECTIONS, 'features', 'domainEntities', 'architecture', 'primaryActions'],
    implementation_plan: [...UNIVERSAL_SECTIONS, 'features', 'architecture', 'domainEntities', 'nonFunctionalRequirements', 'risks'],
    prompt_pack: [...UNIVERSAL_SECTIONS, 'features', 'architecture'], // retired — kept for type completeness
    mockup: [...UNIVERSAL_SECTIONS, 'features', 'uxPages', 'targetUsers'],
};

/**
 * Advisory: did this spine change avoid every section the slot chiefly
 * derives from? False whenever the summary is incomparable or has no changes
 * — the note must never fire on weak evidence.
 */
export function isLikelyUnaffected(slot: ArtifactSlotKey, summary: SpineChangeSummary): boolean {
    if (!summary.comparable || !summary.hasChanges) return false;
    if (summary.changedSectionKeys.length === 0) return false;
    const affinity = ARTIFACT_SECTION_AFFINITY[slot];
    return summary.changedSectionKeys.every((key) => !affinity.includes(key));
}

// ---------------------------------------------------------------------------
// Removed-feature reference scan (blast radius of a deletion)
// ---------------------------------------------------------------------------

export type FeatureReferenceCandidate = {
    artifactId: string;
    /** Slot key when known — lets callers group hits by workspace row. */
    slot?: string;
    title: string;
    /** The candidate's preferred-version content (markdown or JSON). */
    content: string;
};

export type FeatureReferenceHit = {
    artifactId: string;
    slot?: string;
    title: string;
    matchedBy: 'id' | 'name';
};

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Conservative match guards: short ids/names ("F1", "app") would false-positive
// on ordinary prose, so they are skipped rather than risking a wrong
// "still referenced" claim.
const MIN_MATCH_LENGTH = 4;

const wordBoundaryMatch = (needle: string, haystack: string): boolean => {
    const trimmed = needle.trim();
    if (trimmed.length < MIN_MATCH_LENGTH) return false;
    try {
        return new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(trimmed)}($|[^A-Za-z0-9])`, 'i').test(haystack);
    } catch {
        return false;
    }
};

/**
 * Which artifacts still reference a (removed/renamed) feature? Token match of
 * the feature id and name against each candidate's content — the same
 * conservative style as artifactTraceabilityRepair: it can flag likely
 * references, it never proves absence.
 */
export function findFeatureReferences(
    feature: { id: string; name: string },
    candidates: FeatureReferenceCandidate[],
): FeatureReferenceHit[] {
    const hits: FeatureReferenceHit[] = [];
    for (const c of candidates) {
        if (!c.content) continue;
        if (wordBoundaryMatch(feature.id, c.content)) {
            hits.push({ artifactId: c.artifactId, slot: c.slot, title: c.title, matchedBy: 'id' });
        } else if (wordBoundaryMatch(feature.name, c.content)) {
            hits.push({ artifactId: c.artifactId, slot: c.slot, title: c.title, matchedBy: 'name' });
        }
    }
    return hits;
}

// ---------------------------------------------------------------------------
// Memoized resolver (per evaluation pass)
// ---------------------------------------------------------------------------

export type SpineSnapshotLike = { id: string; structuredPRD?: StructuredPRD };

/**
 * Build a memoized "what changed since spine X" resolver against the latest
 * spine. Returns null for the latest spine itself (no drift) and for unknown
 * ids. Summaries are cached per source id — spine pairs are few, so one
 * resolver per render/evaluation pass is cheap.
 */
export function makeSpineChangeResolver(
    spines: readonly SpineSnapshotLike[],
    latestSpineId: string | undefined,
): (fromSpineVersionId: string) => SpineChangeSummary | null {
    const cache = new Map<string, SpineChangeSummary | null>();
    const latest = latestSpineId ? spines.find((s) => s.id === latestSpineId) : undefined;
    return (fromSpineVersionId: string) => {
        if (!latest || fromSpineVersionId === latest.id) return null;
        const cached = cache.get(fromSpineVersionId);
        if (cached !== undefined) return cached;
        const from = spines.find((s) => s.id === fromSpineVersionId);
        const summary = from ? summarizeSpineChange(from.structuredPRD, latest.structuredPRD) : null;
        cache.set(fromSpineVersionId, summary);
        return summary;
    };
}
