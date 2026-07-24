import type { PlanningRecord } from '../../types';

export type PlanningRecordPresentationGroupKind = 'critique_cluster' | 'prd_section';

export type PlanningRecordPresentationEntry =
    | {
        kind: 'record';
        key: string;
        recordId: string;
    }
    | {
        kind: 'group';
        key: string;
        groupKind: PlanningRecordPresentationGroupKind;
        label: string;
        recordIds: string[];
    };

type GroupCandidate = {
    key: string;
    groupKind: PlanningRecordPresentationGroupKind;
    label: string;
};

type NormalizedSection = {
    key: string;
    label: string;
};

const normalizeSection = (value: string): NormalizedSection | undefined => {
    const label = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!label) return undefined;
    return { key: label.toLowerCase(), label };
};

const uniqueSections = (values: Array<string | undefined>): NormalizedSection[] => {
    const byKey = new Map<string, NormalizedSection>();
    for (const value of values) {
        if (!value) continue;
        const section = normalizeSection(value);
        if (section && !byKey.has(section.key)) byKey.set(section.key, section);
    }
    return [...byKey.values()];
};

/**
 * Resolve one conservative PRD-section identity for presentation grouping.
 *
 * Exact plan locations are the most precise available signal and may serve as
 * the primary locator even when broader affected-section metadata names more
 * than one section. Without one exact location, a record that names multiple
 * affected sections stays standalone rather than being assigned arbitrarily.
 * Source locators are the final fallback for records without impact metadata.
 */
const primarySectionFor = (record: PlanningRecord): NormalizedSection | undefined => {
    const exactLocations = uniqueSections(
        (record.affectedPlanLocations ?? []).map(location => location.section),
    );
    if (exactLocations.length > 0) {
        return exactLocations.length === 1 ? exactLocations[0] : undefined;
    }

    const affectedSections = uniqueSections(record.affectedPrdSections ?? []);
    if (affectedSections.length > 0) {
        return affectedSections.length === 1 ? affectedSections[0] : undefined;
    }

    const sourceSections = uniqueSections(
        (record.sources ?? []).map(source => source.locator?.section),
    );
    return sourceSections.length === 1 ? sourceSections[0] : undefined;
};

const groupCandidateFor = (record: PlanningRecord): GroupCandidate | undefined => {
    if (record.sourceReviewIssueId) {
        return {
            key: `critique:${record.sourceReviewIssueId}`,
            groupKind: 'critique_cluster',
            label: record.title,
        };
    }

    const section = primarySectionFor(record);
    if (!section) return undefined;
    return {
        key: `prd-section:${encodeURIComponent(section.key)}`,
        groupKind: 'prd_section',
        label: section.label,
    };
};

/**
 * Presentation-only relationship grouping for planning records.
 *
 * The result is stable in input order, contains every input record exactly
 * once, and emits a group only when at least two records share the same
 * durable relationship. It never creates aggregate planning authority.
 */
export function derivePlanningRecordPresentation(
    records: PlanningRecord[],
): PlanningRecordPresentationEntry[] {
    const candidates = new Map<string, GroupCandidate>();
    const recordCandidateKeys = new Map<string, string>();
    const recordIdsByCandidate = new Map<string, string[]>();

    for (const record of records) {
        const candidate = groupCandidateFor(record);
        if (!candidate) continue;
        candidates.set(candidate.key, candidates.get(candidate.key) ?? candidate);
        recordCandidateKeys.set(record.id, candidate.key);
        recordIdsByCandidate.set(candidate.key, [
            ...(recordIdsByCandidate.get(candidate.key) ?? []),
            record.id,
        ]);
    }

    const emittedGroups = new Set<string>();
    const entries: PlanningRecordPresentationEntry[] = [];
    for (const record of records) {
        const candidateKey = recordCandidateKeys.get(record.id);
        const memberIds = candidateKey ? recordIdsByCandidate.get(candidateKey) : undefined;
        const candidate = candidateKey ? candidates.get(candidateKey) : undefined;
        if (candidate && memberIds && memberIds.length >= 2) {
            if (!emittedGroups.has(candidate.key)) {
                entries.push({
                    kind: 'group',
                    key: candidate.key,
                    groupKind: candidate.groupKind,
                    label: candidate.label,
                    recordIds: memberIds,
                });
                emittedGroups.add(candidate.key);
            }
            continue;
        }
        entries.push({ kind: 'record', key: `record:${record.id}`, recordId: record.id });
    }
    return entries;
}
