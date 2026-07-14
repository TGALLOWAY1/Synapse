import { describe, it, expect } from 'vitest';
import { buildAgentHandoff } from '../exportHandoff';

describe('buildAgentHandoff', () => {
    it('includes a coding-agent preamble with the project name', () => {
        const out = buildAgentHandoff({ projectName: 'Acme', artifacts: [] });
        expect(out).toContain('Acme — Build Handoff');
        expect(out).toContain('expert software engineer');
    });

    it('emits PRD and artifact sections in order', () => {
        const out = buildAgentHandoff({
            projectName: 'Acme',
            prdMarkdown: 'PRD body',
            artifacts: [
                { subtype: 'implementation_plan', title: 'Implementation Plan', content: 'plan body' },
                { subtype: 'prompt_pack', title: 'Prompt Pack', content: 'prompts body' },
            ],
        });
        expect(out).toContain('## Product Requirements');
        expect(out).toContain('PRD body');
        expect(out.indexOf('## Implementation Plan')).toBeLessThan(out.indexOf('## Prompt Pack'));
    });

    it('skips empty/whitespace sections', () => {
        const out = buildAgentHandoff({
            projectName: 'Acme',
            prdMarkdown: '   ',
            artifacts: [
                { subtype: 'data_model', title: 'Data Model', content: '' },
                { subtype: 'prompt_pack', title: 'Prompt Pack', content: 'real content' },
            ],
        });
        expect(out).not.toContain('## Product Requirements');
        expect(out).not.toContain('## Data Model');
        expect(out).toContain('## Prompt Pack');
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
});
