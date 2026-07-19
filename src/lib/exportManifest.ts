// Export manifest — the version/staleness record attached to project exports
// so an outside reader (or coding agent) can see exactly what they're holding:
// which PRD version, which artifact versions, which PRD version each artifact
// was generated from, and whether anything was flagged stale AT EXPORT TIME.
// Pure: the caller (ExportModal) prepares the entries from live store state;
// nothing here reads the store or is persisted.

import type { OutputAlignmentConfidence, OutputAlignmentState } from './planning/outputAlignment';
import type { DependencyNodeStatus } from './artifactDependencyGraph';
import { DEPENDENCY_STATUS_LABELS, isStaleStatus } from './artifactFreshness';

export interface ExportManifestEntry {
    title: string;
    versionNumber?: number;
    /** Positional label of the PRD version this asset was generated from. */
    generatedFromPrdLabel?: string;
    /** Canonical freshness status (missing → "Not generated"). */
    status: DependencyNodeStatus;
    alignmentState?: OutputAlignmentState;
    alignmentConfidence?: OutputAlignmentConfidence;
    alignmentSummary?: string;
    alignmentNextAction?: string;
    usefulForExploration?: boolean;
    blocksBuildReadiness?: boolean;
}

export interface ExportManifest {
    projectName: string;
    /** ISO timestamp of the export. */
    exportedAt: string;
    /** Positional label of the exported PRD version ("Version 3"). */
    prdLabel?: string;
    entries: ExportManifestEntry[];
    /** Entries whose status is stale (needs_update / update_recommended). */
    staleCount: number;
    /** Outputs that deserve review, including advisory/legacy uncertainty. */
    reviewCount: number;
    /** Consequential unresolved alignment that prevents build-ready treatment. */
    blockingCount: number;
}

export function buildExportManifest(input: {
    projectName: string;
    exportedAt?: Date;
    prdLabel?: string;
    entries: ExportManifestEntry[];
}): ExportManifest {
    return {
        projectName: input.projectName,
        exportedAt: (input.exportedAt ?? new Date()).toISOString(),
        prdLabel: input.prdLabel,
        entries: input.entries,
        staleCount: input.entries.filter((e) => isStaleStatus(e.status)).length,
        reviewCount: input.entries.filter((e) => (
            e.alignmentState ? e.alignmentState !== 'aligned' : isStaleStatus(e.status)
        )).length,
        blockingCount: input.entries.filter((e) => e.blocksBuildReadiness === true).length,
    };
}

const ALIGNMENT_LABELS: Record<OutputAlignmentState, string> = {
    aligned: 'Aligned',
    possibly_affected: 'Review recommended',
    stale: 'Update required',
};


/**
 * Render the manifest as a markdown block for the bundle / handoff exports.
 * Includes an explicit warning line when stale content is included, so the
 * document is honest even after it leaves Synapse.
 */
export function renderManifestMarkdown(manifest: ExportManifest): string {
    const lines: string[] = [
        '## Export Manifest',
        '',
        `- Project: ${manifest.projectName}`,
        `- Exported: ${manifest.exportedAt}`,
    ];
    if (manifest.prdLabel) lines.push(`- PRD: ${manifest.prdLabel}`);
    if (manifest.entries.length > 0) {
        lines.push('', '| Asset | Version | Generated from | Status |', '| --- | --- | --- | --- |');
        for (const e of manifest.entries) {
            lines.push(
                `| ${e.title} | ${e.versionNumber !== undefined ? `v${e.versionNumber}` : '—'} | ${e.generatedFromPrdLabel ?? '—'} | ${e.alignmentState ? ALIGNMENT_LABELS[e.alignmentState] : DEPENDENCY_STATUS_LABELS[e.status]} |`,
            );
        }
    }
    const alignmentNotes = manifest.entries.filter(entry => (
        entry.alignmentState && entry.alignmentState !== 'aligned'
    ));
    if (alignmentNotes.length > 0) {
        lines.push('', '### Alignment notes', '');
        for (const entry of alignmentNotes) {
            const confidence = entry.alignmentConfidence === 'definite'
                ? 'definite impact'
                : entry.alignmentConfidence === 'unknown' ? 'unknown' : 'possible impact';
            const next = entry.alignmentNextAction ? ` Next: ${entry.alignmentNextAction}` : '';
            lines.push(`- **${entry.title} — ${confidence}:** ${entry.alignmentSummary ?? 'Review against the current plan.'}${next}`);
        }
    }
    if (manifest.blockingCount > 0) {
        lines.push(
            '',
            `> ⚠️ ${manifest.blockingCount} output${manifest.blockingCount === 1 ? '' : 's'} in this export ${manifest.blockingCount === 1 ? 'requires' : 'require'} alignment review before build. The saved work remains useful for exploration; treat the current PRD as the source of truth where they disagree.`,
        );
    } else if (manifest.reviewCount > 0) {
        lines.push(
            '',
            `> ${manifest.reviewCount} output${manifest.reviewCount === 1 ? '' : 's'} ${manifest.reviewCount === 1 ? 'has' : 'have'} an advisory alignment note. No definite contradiction was found; review before relying on ${manifest.reviewCount === 1 ? 'it' : 'them'} for implementation.`,
        );
    }
    return lines.join('\n');
}
