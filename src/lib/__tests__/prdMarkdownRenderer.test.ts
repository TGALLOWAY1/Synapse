import { describe, expect, it } from 'vitest';
import { renderPremiumMarkdown } from '../services/prdMarkdownRenderer';
import type { StructuredPRD } from '../../types';

const minimalPrd: StructuredPRD = {
    vision: 'A calmer inbox',
    targetUsers: ['Support agents'],
    coreProblem: 'Ticket triage is manual',
    features: [],
    architecture: 'SPA + serverless',
    risks: ['Adoption'],
};

describe('renderPremiumMarkdown handoff appendix', () => {
    it('renders "Where the Detail Lives" as the last section for a minimal legacy PRD', () => {
        const md = renderPremiumMarkdown(minimalPrd);
        const headings = md.split('\n').filter((l) => l.startsWith('## '));
        expect(headings[headings.length - 1]).toBe('## Where the Detail Lives');
        expect(md).toContain('**Data Model** — entities, fields, relationships, and state machines');
        expect(md).toContain('**Implementation Plan** — phased milestones, tasks, and quality gates');
    });
});

describe('renderPremiumMarkdown legacy-field back-compat', () => {
    it('still renders retired-section content stored on legacy PRDs', () => {
        const legacyPrd: StructuredPRD = {
            ...minimalPrd,
            richDataModel: {
                entities: [
                    { name: 'Ticket', description: 'A support request', fields: [{ name: 'id', type: 'string' }] },
                ],
            },
            stateMachines: [
                { entity: 'Ticket', states: [{ name: 'open', nextStates: ['closed'] }] },
            ],
            uxPages: [
                {
                    id: 'pg1',
                    name: 'Inbox',
                    purpose: 'Triage tickets',
                    components: ['Ticket list'],
                    interactions: ['Click a ticket to open it'],
                    emptyState: 'No tickets yet',
                },
            ],
        };
        const md = renderPremiumMarkdown(legacyPrd);
        expect(md).toContain('## Data Model');
        expect(md).toContain('## State Machines');
        expect(md).toContain('Ticket');
        expect(md).toContain('No tickets yet');
    });

    it('omits retired sections entirely when the fields are absent (lean PRDs)', () => {
        const md = renderPremiumMarkdown(minimalPrd);
        expect(md).not.toContain('## Data Model');
        expect(md).not.toContain('## State Machines');
    });
});
