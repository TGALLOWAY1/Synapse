import type {
    ReadinessCriterionEvidence,
    ReadinessReview,
    ReadinessReviewConcern,
    ReadinessReviewCriterion,
} from '../../types';

export type ReadinessReviewComparisonOptions = {
    reviewedVersionLabel?: string;
    currentVersionLabel?: string;
    /** Maximum number of concrete changes shown before a compact remainder. */
    maxChanges?: number;
};

const statusLabel = (criterion: ReadinessReviewCriterion): string => {
    if (criterion.status === 'not_started') return 'not yet assessed';
    if (criterion.status === 'attention') return criterion.blocking ? 'blocking' : 'needs attention';
    return criterion.blocking ? 'blocking despite supporting evidence' : 'supported';
};

const concise = (value: string, max = 140): string => {
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).trimEnd()}…`;
};

const quote = (value: string): string => `“${concise(value)}”`;

const semanticConcernKey = (concern: ReadinessReviewConcern): string => [
    concern.criterionId,
    concern.kind,
    concern.source.type,
    concern.source.sourceId ?? 'unknown',
].join(':');

const evidenceKey = (evidence: ReadinessCriterionEvidence): string => [
    evidence.sourceType,
    evidence.sourceId ?? 'unknown',
].join(':');

const byKey = <T>(items: T[], key: (item: T) => string): Map<string, T> =>
    new Map([...items].sort((a, b) => key(a).localeCompare(key(b))).map(item => [key(item), item]));

const conclusionLabel = (review: ReadinessReview): string => review.conclusion === 'ready_to_build'
    ? 'ready to build'
    : 'not ready to build';

/**
 * Produces a deterministic, user-facing explanation of what changed between a
 * stored checkpoint and the readiness projection for the exact current state.
 * It compares durable findings and source references rather than translating
 * snapshot hash categories into generic prose.
 */
export function compareReadinessReviewProjections(
    reviewed: ReadinessReview,
    current: ReadinessReview,
    options: ReadinessReviewComparisonOptions = {},
): string[] {
    const headlineChanges: string[] = [];
    const concernChanges: string[] = [];
    const criterionChanges: string[] = [];
    const evidenceChanges: string[] = [];
    const caveatChanges: string[] = [];

    if (reviewed.spineVersionId !== current.spineVersionId) {
        const from = options.reviewedVersionLabel ?? reviewed.spineVersionId;
        const to = options.currentVersionLabel ?? current.spineVersionId;
        headlineChanges.push(`The active plan changed from ${from} to ${to}.`);
    }
    if (reviewed.criteriaVersion !== current.criteriaVersion) {
        headlineChanges.push(`Readiness criteria changed from version ${reviewed.criteriaVersion} to version ${current.criteriaVersion}.`);
    }
    if (reviewed.conclusion !== current.conclusion) {
        headlineChanges.push(`The readiness conclusion changed from ${conclusionLabel(reviewed)} to ${conclusionLabel(current)}.`);
    }

    const reviewedCriteria = byKey(reviewed.criteria, item => item.id);
    const currentCriteria = byKey(current.criteria, item => item.id);
    const criterionIds = [...new Set([...reviewedCriteria.keys(), ...currentCriteria.keys()])].sort();

    for (const id of criterionIds) {
        const before = reviewedCriteria.get(id);
        const after = currentCriteria.get(id);
        if (!before && after) {
            criterionChanges.push(`A new readiness criterion is now evaluated: ${after.label}.`);
            continue;
        }
        if (before && !after) {
            criterionChanges.push(`The earlier criterion is no longer evaluated: ${before.label}.`);
            continue;
        }
        if (!before || !after) continue;

        if (before.status !== after.status || before.blocking !== after.blocking) {
            criterionChanges.push(`${after.label} changed from ${statusLabel(before)} to ${statusLabel(after)}.`);
        }

        const beforeEvidence = byKey(before.evidence, evidenceKey);
        const afterEvidence = byKey(after.evidence, evidenceKey);
        const evidenceIds = [...new Set([...beforeEvidence.keys(), ...afterEvidence.keys()])].sort();
        for (const evidenceId of evidenceIds) {
            const oldEvidence = beforeEvidence.get(evidenceId);
            const newEvidence = afterEvidence.get(evidenceId);
            if (!oldEvidence && newEvidence) {
                evidenceChanges.push(`${after.label} now includes ${newEvidence.quality} evidence: ${quote(newEvidence.summary)}.`);
                continue;
            }
            if (oldEvidence && !newEvidence) {
                evidenceChanges.push(`${after.label} no longer includes evidence: ${quote(oldEvidence.summary)}.`);
                continue;
            }
            if (!oldEvidence || !newEvidence) continue;

            if (oldEvidence.quality !== newEvidence.quality) {
                evidenceChanges.push(`${after.label} evidence ${quote(newEvidence.summary)} changed from ${oldEvidence.quality} to ${newEvidence.quality}.`);
            } else if (oldEvidence.summary !== newEvidence.summary) {
                evidenceChanges.push(`${after.label} evidence changed from ${quote(oldEvidence.summary)} to ${quote(newEvidence.summary)}.`);
            } else if (
                oldEvidence.sourceVersionId !== newEvidence.sourceVersionId
                || oldEvidence.contentHash !== newEvidence.contentHash
            ) {
                evidenceChanges.push(`${after.label} still has the same finding, but its supporting source version changed: ${quote(newEvidence.summary)}.`);
            }
        }
    }

    const reviewedConcerns = byKey(reviewed.concerns, semanticConcernKey);
    const currentConcerns = byKey(current.concerns, semanticConcernKey);
    const concernKeys = [...new Set([...reviewedConcerns.keys(), ...currentConcerns.keys()])].sort();
    for (const key of concernKeys) {
        const before = reviewedConcerns.get(key);
        const after = currentConcerns.get(key);
        if (!before && after) {
            concernChanges.push(`New ${after.blocking ? 'blocker' : 'concern'}: ${after.title}.`);
            continue;
        }
        if (before && !after) {
            concernChanges.push(`No longer present: ${before.title}.`);
            continue;
        }
        if (!before || !after) continue;

        if (before.title !== after.title) {
            concernChanges.push(`The concern ${quote(before.title)} is now titled ${quote(after.title)}.`);
        }
        if (before.blocking !== after.blocking) {
            concernChanges.push(`${after.title} ${after.blocking ? 'now blocks implementation' : 'no longer blocks implementation'}.`);
        }
        if (before.evidenceQuality !== after.evidenceQuality) {
            concernChanges.push(`Support for ${after.title} changed from ${before.evidenceQuality} to ${after.evidenceQuality}.`);
        }
        if (before.consequence !== after.consequence) {
            concernChanges.push(`${after.title} now has this consequence: ${concise(after.consequence)}.`);
        }
    }

    const previousCaveats = new Set(reviewed.caveats);
    const currentCaveats = new Set(current.caveats);
    for (const caveat of [...currentCaveats].filter(item => !previousCaveats.has(item)).sort()) {
        caveatChanges.push(`New caveat: ${concise(caveat)}.`);
    }
    for (const caveat of [...previousCaveats].filter(item => !currentCaveats.has(item)).sort()) {
        caveatChanges.push(`Caveat no longer present: ${concise(caveat)}.`);
    }

    const changes = [
        ...headlineChanges,
        ...concernChanges,
        ...criterionChanges,
        ...evidenceChanges,
        ...caveatChanges,
    ];
    if (changes.length === 0 && reviewed.snapshotHashes.aggregate !== current.snapshotHashes.aggregate) {
        return ['The underlying source snapshot changed, while the projected findings stayed the same. Create a current checkpoint before relying on the earlier review.'];
    }

    const maxChanges = Math.max(1, options.maxChanges ?? 8);
    if (changes.length <= maxChanges) return changes;
    return [
        ...changes.slice(0, maxChanges),
        `${changes.length - maxChanges} additional change${changes.length - maxChanges === 1 ? '' : 's'} are available in the current project state.`,
    ];
}
