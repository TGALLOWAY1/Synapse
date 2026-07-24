import { describe, it, expect } from 'vitest';
import { buildExportManifest, renderManifestMarkdown } from '../exportManifest';
import { buildAgentHandoff } from '../exportHandoff';

const entries = [
    { title: 'Design System', versionNumber: 2, generatedFromPrdLabel: 'Version 3', status: 'up_to_date' as const },
    { title: 'Data Model', versionNumber: 1, generatedFromPrdLabel: 'Version 1', status: 'needs_update' as const },
];

describe('buildExportManifest', () => {
    it('counts stale entries and stamps a deterministic export time', () => {
        const manifest = buildExportManifest({
            projectName: 'Acme',
            prdLabel: 'Version 3',
            entries,
            exportedAt: new Date('2026-07-07T00:00:00Z'),
        });
        expect(manifest.staleCount).toBe(1);
        expect(manifest.exportedAt).toBe('2026-07-07T00:00:00.000Z');
    });
});

describe('renderManifestMarkdown', () => {
    it('renders the version table and a stale warning line', () => {
        const md = renderManifestMarkdown(buildExportManifest({
            projectName: 'Acme', prdLabel: 'Version 3', entries,
        }));
        expect(md).toContain('## Export Manifest');
        expect(md).toContain('- PRD: Version 3');
        expect(md).toContain('| Design System | v2 | Version 3 | Up to date |');
        expect(md).toContain('| Data Model | v1 | Version 1 | Needs update |');
        expect(md).toContain('1 output has an advisory alignment note');
    });

    it('renders "Not generated" for an artifact with no preferred version (missing)', () => {
        const md = renderManifestMarkdown(buildExportManifest({
            projectName: 'Acme',
            entries: [{ title: 'Implementation Plan', status: 'missing' }],
        }));
        expect(md).toContain('| Implementation Plan | — | — | Not generated |');
        // 'missing' is not a stale status, so it isn't counted / warned.
        expect(md).not.toContain('flagged');
    });

    it('omits the warning when everything is up to date', () => {
        const md = renderManifestMarkdown(buildExportManifest({
            projectName: 'Acme',
            entries: [{ title: 'Data Model', versionNumber: 1, status: 'up_to_date' }],
        }));
        expect(md).not.toContain('flagged');
        expect(md).not.toContain('alignment note');
    });

    it('distinguishes a definite build blocker from a possible impact', () => {
        const md = renderManifestMarkdown(buildExportManifest({
            projectName: 'Acme',
            entries: [{
                title: 'Screens',
                versionNumber: 1,
                status: 'update_recommended',
                alignmentState: 'stale',
                alignmentConfidence: 'definite',
                alignmentSummary: 'Shared workspaces remain in this output.',
                alignmentNextAction: 'Review and update Screens.',
                blocksBuildReadiness: true,
                usefulForExploration: true,
            }],
        }));
        expect(md).toContain('| Screens | v1 | — | Update required |');
        expect(md).toContain('requires alignment review before build');
        expect(md).toContain('remains useful for exploration');
        expect(md).toContain('Screens — definite impact');
        expect(md).toContain('Shared workspaces remain in this output.');
        expect(md).toContain('Next: Review and update Screens.');
    });

    it('keeps a validation-blocked output visible even when semantic alignment is current', () => {
        const manifest = buildExportManifest({
            projectName: 'Acme',
            entries: [{
                title: 'Data Model',
                versionNumber: 2,
                status: 'needs_review',
                alignmentState: 'aligned',
                alignmentConfidence: 'definite',
            }],
        });
        const md = renderManifestMarkdown(manifest);

        expect(manifest.reviewCount).toBe(1);
        expect(md).toContain('| Data Model | v2 | — | Needs validation review |');
        expect(md).not.toContain('| Data Model | v2 | — | Aligned |');
        expect(md).toContain('has a blocking validation issue');
    });
});

describe('agent handoff manifest section', () => {
    it('emits the manifest between the preamble and the PRD', () => {
        const manifestMarkdown = renderManifestMarkdown(buildExportManifest({
            projectName: 'Acme', prdLabel: 'Version 2', entries,
        }));
        const out = buildAgentHandoff({
            projectName: 'Acme',
            prdMarkdown: 'PRD body',
            manifestMarkdown,
            artifacts: [],
        });
        expect(out.indexOf('## Export Manifest')).toBeGreaterThan(out.indexOf('Build Handoff'));
        expect(out.indexOf('## Export Manifest')).toBeLessThan(out.indexOf('## Product Requirements'));
    });

    it('is omitted when not supplied (legacy behavior unchanged)', () => {
        const out = buildAgentHandoff({ projectName: 'Acme', prdMarkdown: 'PRD body', artifacts: [] });
        expect(out).not.toContain('## Export Manifest');
    });
});
