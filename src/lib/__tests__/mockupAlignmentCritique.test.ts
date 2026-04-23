import { describe, expect, it } from 'vitest';
import type { MockupScreen, MockupSettings, StructuredPRD } from '../../types';
import { critiqueMockupAlignment } from '../mockupAlignmentCritique';

const settings: MockupSettings = {
    platform: 'desktop',
    fidelity: 'mid',
    scope: 'multi_screen',
};

const structuredPRD: StructuredPRD = {
    vision: 'Help warehouse managers reduce stockouts by coordinating replenishment workflows.',
    coreProblem: 'Teams miss replenishment windows and cannot act on risk signals quickly.',
    targetUsers: ['Warehouse manager', 'Inventory analyst'],
    features: [
        {
            id: 'f1',
            name: 'Replenishment Queue',
            description: 'Prioritized restock tasks by SKU and facility risk.',
            userValue: 'Prevents stockouts before they hit customers.',
            complexity: 'medium',
        },
        {
            id: 'f2',
            name: 'Supplier Escalation',
            description: 'Escalate delayed purchase orders and approve substitutions.',
            userValue: 'Keeps fulfillment moving despite upstream delays.',
            complexity: 'high',
        },
    ],
    architecture: 'React web app with workflow service.',
    risks: ['Supplier API lag'],
};

const prdContent = `${structuredPRD.vision}\n${structuredPRD.coreProblem}`;

describe('mockupAlignmentCritique', () => {
    it('flags generic outputs and missing PRD grounding', () => {
        const genericScreens: MockupScreen[] = [
            {
                id: '1',
                name: 'Overview Dashboard',
                purpose: 'Track KPIs for teams.',
                html: '<div class="min-h-screen"><header><h1>KPI Dashboard</h1></header><main><section>Revenue summary</section></main></div>',
            },
            {
                id: '2',
                name: 'Analytics Home',
                purpose: 'Review trends and metrics.',
                html: '<div class="min-h-screen"><main><section>Active users by month</section></main></div>',
            },
            {
                id: '3',
                name: 'Settings',
                purpose: 'Configure account preferences.',
                html: '<div class="min-h-screen"><main><section>Team workspace defaults</section></main></div>',
            },
        ];

        const critique = critiqueMockupAlignment(genericScreens, settings, prdContent, structuredPRD);

        expect(critique.severity).toBe('high');
        expect(critique.alignmentScore).toBeLessThan(55);
        expect(critique.issues.some(issue => issue.code === 'generic_dashboard_sludge')).toBe(true);
        expect(critique.missingConcepts).toContain('main entities/objects');
    });

    it('emits insufficient_entity_grounding when domainEntities are absent from screens', () => {
        const prdWithEntities: StructuredPRD = {
            ...structuredPRD,
            domainEntities: [
                { name: 'Replenishment task' },
                { name: 'Supplier order' },
                { name: 'Stockout risk signal' },
            ],
        };
        const screens: MockupScreen[] = [
            {
                id: '1',
                name: 'Overview Dashboard',
                purpose: 'Track KPIs for teams.',
                html: '<div class="min-h-screen"><header><h1>Overview Dashboard</h1></header><main><section>Active users</section></main></div>',
            },
            {
                id: '2',
                name: 'Analytics Home',
                purpose: 'Review trends.',
                html: '<div class="min-h-screen"><main><section>Revenue summary</section></main></div>',
            },
            {
                id: '3',
                name: 'Settings',
                purpose: 'Configure preferences.',
                html: '<div class="min-h-screen"><main><section>Defaults</section></main></div>',
            },
        ];
        const critique = critiqueMockupAlignment(screens, settings, prdContent, prdWithEntities);
        const perScreenIssueCodes = critique.screens.flatMap(s => s.issues.map(i => i.code));
        expect(perScreenIssueCodes).toContain('insufficient_entity_grounding');
    });

    it('does not emit insufficient_entity_grounding when screens mention domainEntities by name', () => {
        const prdWithEntities: StructuredPRD = {
            ...structuredPRD,
            domainEntities: [
                { name: 'Replenishment task', exampleValues: ['SKU-1042', 'SKU-1188'] },
                { name: 'Supplier order' },
            ],
        };
        const screens: MockupScreen[] = [
            {
                id: '1',
                name: 'Replenishment Queue',
                purpose: 'Warehouse manager triages replenishment task items.',
                html: '<div class="min-h-screen"><header><h1>Replenishment task queue</h1></header><main><section>Supplier order status</section></main></div>',
            },
            {
                id: '2',
                name: 'Supplier Escalation',
                purpose: 'Inventory analyst escalates supplier order delays.',
                html: '<div class="min-h-screen"><main><section>Supplier order delays</section><section>Replenishment task follow-up</section></main></div>',
            },
            {
                id: '3',
                name: 'Restock Workflow Review',
                purpose: 'Confirm replenishment task completion.',
                html: '<div class="min-h-screen"><main><section>Replenishment task trend</section></main></div>',
            },
        ];
        const critique = critiqueMockupAlignment(screens, settings, prdContent, prdWithEntities);
        const perScreenIssueCodes = critique.screens.flatMap(s => s.issues.map(i => i.code));
        expect(perScreenIssueCodes).not.toContain('insufficient_entity_grounding');
    });

    it('emits insufficient_action_grounding when no primaryActions verb appears on any CTA', () => {
        const prdWithActions: StructuredPRD = {
            ...structuredPRD,
            primaryActions: [
                { verb: 'Escalate', target: 'supplier order' },
                { verb: 'Approve', target: 'substitution' },
            ],
        };
        const screens: MockupScreen[] = [
            {
                id: '1',
                name: 'Replenishment Queue',
                purpose: 'Manager reviews restock risks.',
                html: '<div class="min-h-screen"><header><h1>Replenishment queue</h1><button type="button">Create record</button></header><main><section>Items</section></main></div>',
            },
            {
                id: '2',
                name: 'Restock Workflow Review',
                purpose: 'Confirm restock progress.',
                html: '<div class="min-h-screen"><header><h1>Workflow review</h1><button type="button">Save</button></header><main><section>Progress</section></main></div>',
            },
            {
                id: '3',
                name: 'Settings',
                purpose: 'Configure preferences.',
                html: '<div class="min-h-screen"><header><h1>Settings</h1><button type="button">Export</button></header><main><section>Defaults</section></main></div>',
            },
        ];
        const critique = critiqueMockupAlignment(screens, settings, prdContent, prdWithActions);
        expect(critique.issues.some(i => i.code === 'insufficient_action_grounding')).toBe(true);
    });

    it('skips structured grounding checks when domainEntities/primaryActions are absent', () => {
        const screens: MockupScreen[] = [
            {
                id: '1',
                name: 'Replenishment Queue',
                purpose: 'Warehouse manager triages replenishment.',
                html: '<div class="min-h-screen"><header><h1>Replenishment queue</h1></header><main><section>Restock ladder</section><section>Supplier activity</section></main></div>',
            },
            {
                id: '2',
                name: 'Supplier Escalation',
                purpose: 'Escalate delayed orders.',
                html: '<div class="min-h-screen"><main><section>Delayed orders</section><section>Approvals</section></main></div>',
            },
            {
                id: '3',
                name: 'Restock Workflow Review',
                purpose: 'Confirm completion.',
                html: '<div class="min-h-screen"><main><section>Timeline</section><section>Trend</section></main></div>',
            },
        ];
        const critique = critiqueMockupAlignment(screens, settings, prdContent, structuredPRD);
        const codes = critique.issues.map(i => i.code);
        expect(codes).not.toContain('insufficient_entity_grounding');
        expect(codes).not.toContain('insufficient_action_grounding');
    });

    it('accepts PRD-grounded screen sets', () => {
        const alignedScreens: MockupScreen[] = [
            {
                id: '1',
                name: 'Replenishment Queue',
                purpose: 'Warehouse manager triages high-risk SKUs that need immediate restock action.',
                html: '<div class="min-h-screen"><header><h1>Replenishment Queue</h1><button type="button">Create supplier escalation</button></header><main><section>SKU risk ladder</section><section>Facility restock tasks</section></main></div>',
            },
            {
                id: '2',
                name: 'Supplier Escalation',
                purpose: 'Inventory analyst escalates delayed purchase orders and assigns substitution workflows.',
                html: '<div class="min-h-screen"><header><h1>Supplier Escalation</h1></header><main><section>Delayed purchase orders</section><section>Substitution approvals</section></main></div>',
            },
            {
                id: '3',
                name: 'Restock Workflow Review',
                purpose: 'Warehouse manager confirms replenishment completion and tracks stockout risk trend.',
                html: '<div class="min-h-screen"><header><h1>Restock Workflow Review</h1></header><main><section>Workflow timeline</section><section>Risk trend</section></main></div>',
            },
        ];

        const critique = critiqueMockupAlignment(alignedScreens, settings, prdContent, structuredPRD);

        expect(critique.alignmentScore).toBeGreaterThanOrEqual(70);
        expect(critique.severity).not.toBe('high');
        expect(critique.missingConcepts.length).toBeLessThanOrEqual(3);
    });
});
