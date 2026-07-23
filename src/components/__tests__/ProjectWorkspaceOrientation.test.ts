import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspace = readFileSync(
    resolve(process.cwd(), 'src/components/ProjectWorkspace.tsx'),
    'utf8',
);

describe('ProjectWorkspace orientation', () => {
    it('places one global strip after the rail and before stage content', () => {
        const rail = workspace.indexOf('<PipelineStageBar');
        const strip = workspace.indexOf('<GlobalNextActionStrip');
        const main = workspace.indexOf('{/* Main Workspace Area');

        expect(strip).toBeGreaterThan(rail);
        expect(strip).toBeLessThan(main);
        expect(workspace.match(/<GlobalNextActionStrip/g)).toHaveLength(1);
    });

    it('does not pass global primary props into PlanningStateBar', () => {
        const start = workspace.indexOf('<PlanningStateBar');
        const props = workspace.slice(start, workspace.indexOf('/>', start));

        expect(props).not.toContain('attention=');
        expect(props).not.toContain('onOpenAttention=');
        expect(props).not.toContain('onNextAction=');
    });

    it('routes global items through the direct commit-aware dispatcher', () => {
        const start = workspace.indexOf('const openPlanningAttention');
        const handler = workspace.slice(start, workspace.indexOf('const handleExport', start));

        expect(handler).toContain('dispatchPlanningAttentionItem');
        expect(handler).toContain('onCommit: handleToggleFinal');
        expect(handler).toContain('onNavigate:');
    });
});
