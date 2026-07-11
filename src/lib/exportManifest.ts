// Export manifest — the version/staleness record attached to project exports
// so an outside reader (or coding agent) can see exactly what they're holding:
// which PRD version, which artifact versions, which PRD version each artifact
// was generated from, and whether anything was flagged stale AT EXPORT TIME.
// Pure: the caller (ExportModal) prepares the entries from live store state;
// nothing here reads the store or is persisted.

import type { DependencyNodeStatus } from './artifactDependencyGraph';
import { DEPENDENCY_STATUS_LABELS, isStaleStatus } from './artifactFreshness';

export interface ExportManifestEntry {
    title: string;
    versionNumber?: number;
    /** Positional label of the PRD version this asset was generated from. */
    generatedFromPrdLabel?: string;
    /** Canonical freshness status (missing → "Not generated"). */
    status: DependencyNodeStatus;
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
    };
}

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
                `| ${e.title} | ${e.versionNumber !== undefined ? `v${e.versionNumber}` : '—'} | ${e.generatedFromPrdLabel ?? '—'} | ${DEPENDENCY_STATUS_LABELS[e.status]} |`,
            );
        }
    }
    if (manifest.staleCount > 0) {
        lines.push(
            '',
            `> ⚠️ ${manifest.staleCount} asset${manifest.staleCount === 1 ? '' : 's'} in this export ${manifest.staleCount === 1 ? 'was' : 'were'} flagged as possibly out of date with the current PRD at export time. Treat the PRD as the source of truth where they disagree.`,
        );
    }
    return lines.join('\n');
}
