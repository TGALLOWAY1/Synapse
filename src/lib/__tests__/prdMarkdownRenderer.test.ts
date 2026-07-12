import { describe, expect, it } from 'vitest';
import { renderPremiumMarkdown, renderPrdSectionMarkdown } from '../services/prdMarkdownRenderer';
import type { StructuredPRD } from '../../types';

const minimalPrd: StructuredPRD = {
    vision: 'A calmer inbox',
    targetUsers: ['Support agents'],
    coreProblem: 'Ticket triage is manual',
    features: [],
    architecture: 'SPA + serverless',
    risks: ['Adoption'],
};

describe('renderPremiumMarkdown — three-part structure', () => {
    it('emits Part I / II / III + Appendices in order', () => {
        const md = renderPremiumMarkdown(minimalPrd);
        const i = md.indexOf('# Part I — Product Overview');
        const ii = md.indexOf('# Part II — Feature Specification');
        const iii = md.indexOf('# Part III — Decisions and Validation');
        const app = md.indexOf('# Appendices');
        expect(i).toBeGreaterThan(-1);
        expect(ii).toBeGreaterThan(i);
        expect(iii).toBeGreaterThan(ii);
        expect(app).toBeGreaterThan(iii);
    });

    it('no longer renders the retired "Where the Detail Lives" handoff appendix', () => {
        const md = renderPremiumMarkdown(minimalPrd);
        expect(md).not.toContain('## Where the Detail Lives');
        expect(md).not.toContain('**Data Model** — entities, fields, relationships, and state machines');
        expect(md).not.toContain('**Implementation Plan** — phased milestones, tasks, and quality gates');
    });
});

describe('renderPremiumMarkdown — section content', () => {
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

    it('puts scope in Part I as Scope and Constraints, not a duplicate MVP Scope', () => {
        const md = renderPremiumMarkdown({
            ...richPrd,
            mvpScope: {
                mvp: ['Quick Capture (f1): one-tap logging'],
                v1: [],
                later: ['Integrations someday'],
                rationale: 'Focus on the capture loop first.',
            },
        });
        expect(md).toContain('## Scope and Constraints');
        expect(md).not.toContain('## MVP Scope');
        const start = md.indexOf('## Scope and Constraints');
        const end = md.indexOf('\n## ', start + 1);
        expect(md.slice(start, end)).toContain('> [!DECISION] Focus on the capture loop first.');
        // Deferred "Later" items surface in Part III, not the scope surface.
        expect(md).toContain('Integrations someday');
    });

    it('omits Instrumentation from Success Metrics', () => {
        const md = renderPremiumMarkdown(richPrd);
        expect(md).toContain('## Goals and Success Metrics');
        expect(md).toContain('| Metric | Target |');
        expect(md).not.toContain('Instrumentation');
        expect(md).not.toContain('legacy event');
    });

    it('renders Feature Systems and Detailed Features in Part II; deferred excluded from detail', () => {
        const md = renderPremiumMarkdown(richPrd);
        const featuresStart = md.indexOf('## Detailed Features');
        const featuresEnd = md.indexOf('\n## ', featuresStart + 1);
        const featuresBlock = md.slice(featuresStart, featuresEnd);
        expect(md).toContain('## Feature Systems');
        expect(featuresBlock).toContain('### Quick Capture');
        // f2 is tier 'later' — deferred features never render as detail sections.
        expect(featuresBlock).not.toContain('### Weekly Review');
    });

    it('never references deferred features from Feature Systems', () => {
        const md = renderPremiumMarkdown({
            ...richPrd,
            featureSystems: [
                { id: 's1', name: 'Capture System', purpose: 'p', featureIds: ['f1', 'f2'] },
            ],
        });
        expect(md).toContain('**Features:** f1');
        expect(md).not.toContain('**Features:** f1, f2');
    });

    it('splits Open Questions (low confidence) from Assumptions to Validate (higher)', () => {
        const md = renderPremiumMarkdown(richPrd);
        expect(md).toContain('## Open Questions');
        expect(md).toContain('## Assumptions to Validate');
        const oq = md.indexOf('## Open Questions');
        const oqEnd = md.indexOf('\n## ', oq + 1);
        expect(md.slice(oq, oqEnd)).toContain('Users are mobile-first');
        const av = md.indexOf('## Assumptions to Validate');
        const avEnd = md.indexOf('\n## ', av + 1);
        expect(md.slice(av, avEnd)).toContain('Weekly cadence works');
    });

    it('logs decided items and deferred/risks separately', () => {
        const md = renderPremiumMarkdown(richPrd);
        expect(md).toContain('## Decision Log');
        expect(md).toContain('**Marked incorrect** (a3): Solo users only — Correction: Teams too');
        expect(md).toContain('**Feature confirmed** (f2): Weekly Review');
        // Deferred + risks live in their own section.
        expect(md).toContain('## Risks and Deferred Items');
        const logStart = md.indexOf('## Decision Log');
        const logEnd = md.indexOf('\n## ', logStart + 1);
        expect(md.slice(logStart, logEnd)).not.toContain('mobile-first');
    });

    it('renders a Traceability Index from explicit references', () => {
        const md = renderPremiumMarkdown({
            ...richPrd,
            features: [
                { id: 'f1', name: 'Quick Capture', description: 'd', userValue: 'v', complexity: 'low', tier: 'mvp' },
                { id: 'f3', name: 'Sync', description: 'd', userValue: 'v', complexity: 'low', tier: 'mvp', dependencies: ['f1'] },
            ],
        });
        expect(md).toContain('## Traceability Index');
        expect(md).toContain('**f3** Sync — ');
        expect(md).toContain('depends on: Quick Capture');
    });
});

describe('renderPrdSectionMarkdown', () => {
    const prd: StructuredPRD = {
        ...minimalPrd,
        features: [{ id: 'f1', name: 'Quick Capture', description: 'd', userValue: 'v', complexity: 'low', tier: 'mvp' }],
        assumptions: [{ id: 'a1', statement: 'Old', confidence: 'high' }],
    };

    it('renders only the requested part', () => {
        const overview = renderPrdSectionMarkdown(prd, 'overview');
        expect(overview).toContain('# Part I — Product Overview');
        expect(overview).not.toContain('# Part II');
        expect(overview).not.toContain('## Detailed Features');

        const features = renderPrdSectionMarkdown(prd, 'features');
        expect(features).toContain('# Part II — Feature Specification');
        expect(features).toContain('## Detailed Features');

        const decisions = renderPrdSectionMarkdown(prd, 'decisions');
        expect(decisions).toContain('# Part III — Decisions and Validation');
        expect(decisions).toContain('## Assumptions to Validate');
    });
});

describe('renderPremiumMarkdown legacy-field back-compat', () => {
    it('renders retired-section content under the Appendices', () => {
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
        expect(md).toContain('## Architecture and Additional Context');
        expect(md).toContain('### Data Model');
        expect(md).toContain('### State Machines');
        expect(md).toContain('Ticket');
        expect(md).toContain('No tickets yet');
    });

    it('omits the additional-context block when no technical fields exist', () => {
        const md = renderPremiumMarkdown({ ...minimalPrd, architecture: '' });
        expect(md).not.toContain('## Architecture and Additional Context');
    });
});
