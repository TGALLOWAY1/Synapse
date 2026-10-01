import { describe, it, expect } from 'vitest';
import { buildAgentHandoff } from '../exportHandoff';

describe('buildAgentHandoff', () => {
    it('includes a coding-agent preamble with the project name', () => {
        const out = buildAgentHandoff({ projectName: 'Acme', artifacts: [] });
        expect(out).toContain('Acme — Build Handoff');
        expect(out).toContain('expert software engineer');
    });

    it('points the agent at the Implementation Plan\'s prompt packs, not the retired Prompt Pack artifact', () => {
        const out = buildAgentHandoff({ projectName: 'Acme', artifacts: [] });
        expect(out).toContain('Follow the **Implementation Plan** for milestone order');
        expect(out).toContain('**Prompt Packs** in the Implementation Plan');
        // The bodies are only in the plan's trailing JSON block (see
        // implementationPlanToMarkdown) — the preamble must say where to look.
        expect(out).toContain('`json synapse-plan` code block');
        // Singular "Prompt Pack" was the retired standalone artifact.
        expect(out).not.toContain('**Prompt Pack**');
    });

    it('emits PRD and artifact sections in order', () => {
        const out = buildAgentHandoff({
            projectName: 'Acme',
            prdMarkdown: 'PRD body',
            artifacts: [
                { subtype: 'implementation_plan', title: 'Implementation Plan', content: 'plan body' },
                { subtype: 'design_system', title: 'Design System', content: 'tokens body' },
            ],
        });
        expect(out).toContain('## Product Requirements');
        expect(out).toContain('PRD body');
        expect(out.indexOf('## Implementation Plan')).toBeLessThan(out.indexOf('## Design System'));
    });

    it('skips empty/whitespace sections', () => {
        const out = buildAgentHandoff({
            projectName: 'Acme',
            prdMarkdown: '   ',
            artifacts: [
                { subtype: 'data_model', title: 'Data Model', content: '' },
                { subtype: 'design_system', title: 'Design System', content: 'real content' },
            ],
        });
        expect(out).not.toContain('## Product Requirements');
        expect(out).not.toContain('## Data Model');
        expect(out).toContain('## Design System');
    });

    it('falls back to a generic title when project name is blank', () => {
        const out = buildAgentHandoff({ projectName: '', artifacts: [] });
        expect(out).toContain('This product — Build Handoff');
    });

    it('labels an uncommitted plan as exploratory', () => {
        const out = buildAgentHandoff({ projectName: 'Acme', artifacts: [], exploratory: true });
        expect(out).toContain('Exploratory handoff');
        expect(out).toContain('has not been committed as implementation-ready');
    });

    it('uses an exact checkpoint instead of stacking the blanket exploratory warning', () => {
        const out = buildAgentHandoff({
            projectName: 'Acme',
            artifacts: [],
            exploratory: true,
            checkpointMarkdown: '## Workflow Checkpoint\n\n**Plan status:** Working plan',
        });
        expect(out).toContain('**Plan status:** Working plan');
        expect(out).not.toContain('Exploratory handoff');
    });
});
