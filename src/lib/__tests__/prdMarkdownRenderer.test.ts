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

describe('renderPremiumMarkdown mobile-cleanup pass', () => {
    const richPrd: StructuredPRD = {
        ...minimalPrd,
        features: [
            { id: 'f1', name: 'Quick Capture', description: 'd', userValue: 'v', complexity: 'low', tier: 'mvp' },
            { id: 'f2', name: 'Weekly Review', description: 'd', userValue: 'v', complexity: 'low', tier: 'later', confirmed: true, confirmedAt: 2 },
        ],
        featureSystems: [
            { id: 's1', name: 'Capture System', purpose: 'p', featureIds: ['f1'] },
        ],
        successMetrics: [
            { name: 'Activation', target: '40%', instrumentation: 'legacy event' },
        ],
        assumptions: [
            { id: 'a1', statement: 'Users are mobile-first', confidence: 'low' },
            { id: 'a2', statement: 'Weekly cadence works', confidence: 'high' },
            { id: 'a3', statement: 'Solo users only', confidence: 'med', decision: 'rejected', decisionNote: 'Teams too', decidedAt: 1 },
        ],
    };

    it('renders Detailed Features before Feature Systems', () => {
        const md = renderPremiumMarkdown(richPrd);
        expect(md.indexOf('## Detailed Features')).toBeGreaterThan(-1);
        expect(md.indexOf('## Feature Systems')).toBeGreaterThan(-1);
        expect(md.indexOf('## Detailed Features')).toBeLessThan(md.indexOf('## Feature Systems'));
    });

    it('renders no Defer section in the Implementation Summary', () => {
        const md = renderPremiumMarkdown(richPrd);
        expect(md).toContain('## Implementation Summary');
        expect(md).not.toContain('### Defer');
        expect(md).not.toContain('### Open Decisions');
    });

    it('omits Instrumentation from Success Metrics', () => {
        const md = renderPremiumMarkdown(richPrd);
        expect(md).toContain('## Success Metrics');
        expect(md).toContain('| Metric | Target |');
        expect(md).not.toContain('Instrumentation');
        expect(md).not.toContain('legacy event');
    });

    it('renders unresolved assumptions as Review & Confirm, sorted by confidence', () => {
        const md = renderPremiumMarkdown(richPrd);
        expect(md).toContain('## Review & Confirm');
        expect(md).not.toContain('## Assumptions');
        const high = md.indexOf('Weekly cadence works');
        const low = md.indexOf('Users are mobile-first');
        expect(high).toBeGreaterThan(-1);
        expect(low).toBeGreaterThan(high);
    });

    it('renders decided assumptions and confirmed features in the Decision Log', () => {
        const md = renderPremiumMarkdown(richPrd);
        expect(md).toContain('## Decision Log');
        expect(md).toContain('**Marked incorrect** (a3): Solo users only — Correction: Teams too');
        expect(md).toContain('**Feature confirmed** (f2): Weekly Review');
        // Unresolved items never appear in the log.
        const logStart = md.indexOf('## Decision Log');
        const logEnd = md.indexOf('##', logStart + 1);
        expect(md.slice(logStart, logEnd)).not.toContain('mobile-first');
    });

    it('legacy PRDs with plain assumptions still render safely (all unresolved)', () => {
        const legacy: StructuredPRD = {
            ...minimalPrd,
            assumptions: [{ id: 'a1', statement: 'Old assumption', confidence: 'med' }],
        };
        const md = renderPremiumMarkdown(legacy);
        expect(md).toContain('## Review & Confirm');
        expect(md).toContain('Old assumption');
        expect(md).not.toContain('## Decision Log');
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
