// Pure version-diffing helpers (no React). Used by the version Compare UI to
// show what changed between two PRD or artifact versions. Diffs are computed on
// the fly from stored full-content snapshots — nothing extra is persisted.
//
// Backed by jsdiff (`diff`), word-level. Kept framework-free and unit-tested.

import { diffWordsWithSpace } from 'diff';
import type { StructuredPRD, Feature, DomainEntity, PrimaryAction } from '../types';

/** One contiguous run of text classified relative to the "after" version. */
export type DiffSegment = {
    value: string;
    added?: boolean;   // present only in `after`
    removed?: boolean; // present only in `before`
};

export type SectionChangeKind = 'added' | 'removed' | 'changed' | 'unchanged';

/** Per-section diff of a structured PRD. */
export type SectionDiff = {
    key: string;          // stable section key (e.g. "vision")
    label: string;        // human label (e.g. "Vision")
    kind: SectionChangeKind;
    before: string;       // rendered comparable text from the before version
    after: string;        // rendered comparable text from the after version
    segments: DiffSegment[]; // word-level diff (empty when unchanged)
};

export type DiffSummary = {
    changed: number;
    added: number;
    removed: number;
    unchanged: number;
};

/**
 * Word-level diff of two text blobs. Returns ordered segments; unchanged runs
 * carry neither `added` nor `removed`. Identical inputs yield a single
 * unchanged segment (or an empty array when both are empty).
 */
export function diffText(before: string, after: string): DiffSegment[] {
    const a = before ?? '';
    const b = after ?? '';
    if (a === '' && b === '') return [];
    const parts = diffWordsWithSpace(a, b);
    return parts.map((p) => ({
        value: p.value,
        ...(p.added ? { added: true } : {}),
        ...(p.removed ? { removed: true } : {}),
    }));
}

// --- Structured-PRD section model -----------------------------------------

// Render a single PRD section to a stable, comparable plain-text block. Missing
// / legacy fields are treated as empty so older snapshots diff safely.
type SectionSpec = {
    key: string;
    label: string;
    render: (prd: StructuredPRD) => string;
};

const renderFeatures = (features?: Feature[]): string =>
    (features ?? [])
        .map((f) => {
            const lines = [`${f.name}`];
            if (f.description) lines.push(f.description);
            if (f.userValue) lines.push(`Value: ${f.userValue}`);
            if (f.complexity) lines.push(`Complexity: ${f.complexity}`);
            return lines.join('\n');
        })
        .join('\n\n');

const renderEntities = (entities?: DomainEntity[]): string =>
    (entities ?? [])
        .map((e) => {
            const desc = e.description ? `: ${e.description}` : '';
            const examples = e.exampleValues?.length ? ` (${e.exampleValues.join(', ')})` : '';
            return `${e.name}${desc}${examples}`;
        })
        .join('\n');

const renderActions = (actions?: PrimaryAction[]): string =>
    (actions ?? [])
        .map((a) => `${a.verb} ${a.target}`.trim())
        .join('\n');

const renderList = (items?: string[]): string => (items ?? []).join('\n');

// Known, comparable sections (core + commonly-edited grounding fields). Premium
// nested structures beyond these are intentionally out of scope for the MVP
// compare view.
const SECTION_SPECS: SectionSpec[] = [
    { key: 'vision', label: 'Vision', render: (p) => p.vision ?? '' },
    { key: 'coreProblem', label: 'Core Problem', render: (p) => p.coreProblem ?? '' },
    { key: 'targetUsers', label: 'Target Users', render: (p) => renderList(p.targetUsers) },
    { key: 'features', label: 'Features', render: (p) => renderFeatures(p.features) },
    { key: 'architecture', label: 'Architecture', render: (p) => p.architecture ?? '' },
    { key: 'risks', label: 'Risks', render: (p) => renderList(p.risks) },
    { key: 'nonFunctionalRequirements', label: 'Non-Functional Requirements', render: (p) => renderList(p.nonFunctionalRequirements) },
    { key: 'constraints', label: 'Constraints', render: (p) => renderList(p.constraints) },
    { key: 'domainEntities', label: 'Domain Entities', render: (p) => renderEntities(p.domainEntities) },
    { key: 'primaryActions', label: 'Primary Actions', render: (p) => renderActions(p.primaryActions) },
];

const classify = (before: string, after: string): SectionChangeKind => {
    const b = before.trim();
    const a = after.trim();
    if (b === a) return 'unchanged';
    if (b === '' && a !== '') return 'added';
    if (b !== '' && a === '') return 'removed';
    return 'changed';
};

/**
 * Section-aware diff of two structured PRDs. Each known section is rendered to
 * comparable text and classified added / removed / changed / unchanged, with a
 * word-level segment list for the changed/added/removed cases. Safe with
 * partial or legacy PRDs (absent fields treated as empty).
 */
export function diffStructuredPRD(
    before: StructuredPRD | undefined,
    after: StructuredPRD | undefined,
): SectionDiff[] {
    const beforePrd = before ?? ({} as StructuredPRD);
    const afterPrd = after ?? ({} as StructuredPRD);

    return SECTION_SPECS.map((spec) => {
        const beforeText = spec.render(beforePrd);
        const afterText = spec.render(afterPrd);
        const kind = classify(beforeText, afterText);
        return {
            key: spec.key,
            label: spec.label,
            kind,
            before: beforeText,
            after: afterText,
            segments: kind === 'unchanged' ? [] : diffText(beforeText, afterText),
        };
    });
}

/** Roll up section diffs into headline counts for a summary header. */
export function getDiffSummary(diffs: SectionDiff[]): DiffSummary {
    return diffs.reduce<DiffSummary>(
        (acc, d) => {
            acc[d.kind] += 1;
            return acc;
        },
        { changed: 0, added: 0, removed: 0, unchanged: 0 },
    );
}
