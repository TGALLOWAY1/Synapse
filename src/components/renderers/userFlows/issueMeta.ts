import type { FlowIssueKind } from './types';

export type IssueKindMeta = {
    label: string;
    shortLabel: string;
    description: string;
    /** Tailwind background class for the chip background. */
    badgeBg: string;
    /** Tailwind text class for the chip foreground. */
    badgeText: string;
    /** Tailwind classes for the section header tone. */
    sectionBg: string;
    sectionBorder: string;
    sectionHeader: string;
};

export const ISSUE_KIND_META: Record<FlowIssueKind, IssueKindMeta> = {
    alternate_path: {
        label: 'Alternate path',
        shortLabel: 'Alt',
        description: 'A non-primary path the flow can take when conditions diverge from the happy path.',
        badgeBg: 'bg-amber-100',
        badgeText: 'text-amber-800',
        sectionBg: 'bg-amber-50/60',
        sectionBorder: 'border-amber-200',
        sectionHeader: 'text-amber-800',
    },
    edge_case: {
        label: 'Edge case',
        shortLabel: 'Edge',
        description: 'An unusual or boundary scenario the flow needs to handle.',
        badgeBg: 'bg-sky-100',
        badgeText: 'text-sky-800',
        sectionBg: 'bg-sky-50/60',
        sectionBorder: 'border-sky-200',
        sectionHeader: 'text-sky-800',
    },
    validation_warning: {
        label: 'Validation warning',
        shortLabel: 'Validation',
        description: 'Input or state validation that may interrupt the flow with a warning.',
        badgeBg: 'bg-amber-100',
        badgeText: 'text-amber-900',
        sectionBg: 'bg-amber-50/60',
        sectionBorder: 'border-amber-200',
        sectionHeader: 'text-amber-900',
    },
    failure_mode: {
        label: 'Failure mode',
        shortLabel: 'Failure',
        description: 'An actual failure scenario where recovery may not be possible.',
        badgeBg: 'bg-red-100',
        badgeText: 'text-red-800',
        sectionBg: 'bg-red-50/60',
        sectionBorder: 'border-red-200',
        sectionHeader: 'text-red-800',
    },
    unresolved_reference: {
        label: 'Unresolved reference',
        shortLabel: 'Unresolved',
        description: 'A reference (feature, screen, state) that has not been defined yet.',
        badgeBg: 'bg-neutral-200',
        badgeText: 'text-neutral-800',
        sectionBg: 'bg-neutral-50',
        sectionBorder: 'border-neutral-300',
        sectionHeader: 'text-neutral-700',
    },
};
