import { describe, it, expect } from 'vitest';
import { buildExportManifest, renderManifestMarkdown } from '../exportManifest';
import { buildAgentHandoff } from '../exportHandoff';

const entries = [
    { title: 'Design System', versionNumber: 2, generatedFromPrdLabel: 'Version 3', staleness: 'current' as const },
    { title: 'Data Model', versionNumber: 1, generatedFromPrdLabel: 'Version 1', staleness: 'possibly_outdated' as const },
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
        expect(md).toContain('| Design System | v2 | Version 3 | Current |');
        expect(md).toContain('| Data Model | v1 | Version 1 | May be outdated |');
        expect(md).toContain('1 asset in this export was flagged');
    });

    it('omits the warning when everything is current', () => {
        const md = renderManifestMarkdown(buildExportManifest({
            projectName: 'Acme',
            entries: [{ title: 'Data Model', versionNumber: 1, staleness: 'current' }],
        }));
        expect(md).not.toContain('flagged');
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
