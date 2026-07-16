import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string) => readFileSync(resolve(process.cwd(), 'src/components', file), 'utf8');

describe('Phase 5A rendered mobile release regressions', () => {
    it('allows the workspace header and Explore pane to shrink below long readiness copy', () => {
        const workspace = source('ProjectWorkspace.tsx');
        expect(workspace).toContain('flex h-screen flex-col overflow-x-hidden');
        expect(workspace).toContain('flex min-w-0 flex-1 items-center gap-3');
        expect(workspace).toContain('max-w-[44vw] truncate whitespace-nowrap');
        expect(workspace).toContain('flex min-h-0 min-w-0 flex-1 flex-col');
    });

    it('keeps the mobile artifact-list controls at least 44px', () => {
        const artifacts = source('ArtifactWorkspace.tsx');
        expect(artifacts).toContain('aria-label="Open artifact list"');
        expect(artifacts).toContain('aria-label="Close artifact list"');
        expect(artifacts).toContain('sticky top-14 z-[9]');
        expect(artifacts.match(/min-h-11 min-w-11/g)?.length).toBeGreaterThanOrEqual(2);
    });
});
