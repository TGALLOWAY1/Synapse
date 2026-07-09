import { describe, it, expect } from 'vitest';
import type { DataModelContent, StructuredImplementationPlan } from '../../types';
import {
    buildScreenArtifactTraceBridge,
    matchScreenToDataModel,
    matchScreenToPlan,
    resolveDataModelForTrace,
    resolvePlanForTrace,
    type ScreenTraceContext,
} from '../screenArtifactTraceBridge';

// --- Fixtures ----------------------------------------------------------------

function ctx(overrides: Partial<ScreenTraceContext> = {}): ScreenTraceContext {
    return {
        screenId: 'scr-dashboard',
        screenTitle: 'Dashboard',
        isP0: true,
        featureRefs: ['F1: Recent evaluations'],
        route: '/dashboard',
        routeExplicit: true,
        components: ['RecentEvaluationsSidebar', 'AnalysisProgressPanel'],
        dataLabels: ['Evaluation', 'recentEvaluations'],
        hasDataRequirements: true,
        ...overrides,
    };
}

const DATA_MODEL: DataModelContent = {
    entities: [
        {
            name: 'Evaluation',
            description: 'A submitted evaluation',
            fields: [
                { name: 'id', type: 'string', required: true, description: '' },
                { name: 'role', type: 'string', required: true, description: '' },
                { name: 'status', type: 'string', required: true, description: '' },
                { name: 'score', type: 'number', required: false, description: '' },
                { name: 'createdAt', type: 'date', required: true, description: '' },
            ],
            relationships: [{ type: 'belongs_to', target: 'TargetRole' }],
            featureRefs: ['F1'],
        },
        {
            name: 'TargetRole',
            description: 'A role a user can evaluate against',
            fields: [
                { name: 'id', type: 'string', required: true, description: '' },
                { name: 'title', type: 'string', required: true, description: '' },
            ],
            relationships: [],
        },
        {
            name: 'AuditLog',
            description: 'Unrelated system log',
            fields: [{ name: 'id', type: 'string', required: true, description: '' }],
            relationships: [],
        },
    ],
};

const PLAN: StructuredImplementationPlan = {
    milestones: [
        {
            id: 'm1',
            name: 'Foundation',
            priority: 'critical',
            linkedArtifacts: { screens: ['Dashboard'] },
            tasks: [
                {
                    id: 't1',
                    title: 'Build the Dashboard route and recent evaluations sidebar',
                    description: 'Wire the /dashboard route and the RecentEvaluationsSidebar component.',
                    status: 'todo',
                    linkedArtifacts: { prd: ['F1'] },
                },
                {
                    id: 't2',
                    title: 'Implement evaluation history list',
                    description: 'Task mentions evaluation history data.',
                    status: 'todo',
                },
            ],
        },
        {
            id: 'm2',
            name: 'Settings',
            tasks: [
                { id: 't3', title: 'Build settings page', description: 'Unrelated settings work.', status: 'todo' },
            ],
        },
    ],
} as unknown as StructuredImplementationPlan;

// --- Data Model matching -----------------------------------------------------

describe('matchScreenToDataModel', () => {
    it('1. explicit Data Model entity ref (shared feature) → explicit confidence', () => {
        const res = matchScreenToDataModel(ctx(), DATA_MODEL);
        const evaluation = res.matches.find(m => m.entityName === 'Evaluation');
        expect(evaluation?.confidence).toBe('explicit');
        expect(evaluation?.source).toBe('feature_ref');
        expect(res.confidence).toBe('explicit');
    });

    it('2. exact entity name match → strong confidence', () => {
        const res = matchScreenToDataModel(
            ctx({ featureRefs: [], dataLabels: ['TargetRole'] }),
            DATA_MODEL,
        );
        const role = res.matches.find(m => m.entityName === 'TargetRole');
        expect(role?.confidence).toBe('strong');
    });

    it('3. field label match produces a field-level match', () => {
        const res = matchScreenToDataModel(
            ctx({ featureRefs: [], dataLabels: ['status', 'score'] }),
            DATA_MODEL,
        );
        const evaluation = res.matches.find(m => m.entityName === 'Evaluation');
        expect(evaluation?.fields?.some(f => f.name === 'status')).toBe(true);
        expect(evaluation?.fields?.some(f => f.name === 'score')).toBe(true);
    });

    it('4. weak token overlap is weak, not strong', () => {
        const res = matchScreenToDataModel(
            ctx({ featureRefs: [], dataLabels: [], components: [], screenTitle: 'Evaluation summary panel' }),
            DATA_MODEL,
        );
        const evaluation = res.matches.find(m => m.entityName === 'Evaluation');
        expect(evaluation?.confidence).toBe('weak');
    });

    it('5. no Data Model match returns missing with a warning', () => {
        const res = matchScreenToDataModel(
            ctx({ featureRefs: [], dataLabels: ['completely_unrelated_thing'], components: ['ZebraWidget'], screenTitle: 'Zebra' }),
            DATA_MODEL,
        );
        expect(res.confidence).toBe('missing');
        expect(res.warnings.length).toBeGreaterThan(0);
        expect(res.warnings[0]).toMatch(/No linked Data Model entities/);
    });

    it('returns missing when there is no Data Model artifact at all', () => {
        const res = matchScreenToDataModel(ctx(), null);
        expect(res.confidence).toBe('missing');
        expect(res.warnings[0]).toMatch(/No Data Model artifact/);
    });
});

// --- Implementation Plan matching --------------------------------------------

describe('matchScreenToPlan', () => {
    it('6. explicit plan screen ref → explicit confidence', () => {
        const res = matchScreenToPlan(ctx(), PLAN);
        // The Foundation milestone explicitly links "Dashboard".
        expect(res.matches[0].confidence).toBe('explicit');
        expect(res.confidence).toBe('explicit');
    });

    it('7. route match produces a strong plan match', () => {
        const res = matchScreenToPlan(
            ctx({ featureRefs: [] }),
            { milestones: [{ id: 'm', name: 'M', tasks: [
                { id: 't', title: 'Wire routing', description: 'Add the /dashboard route.', status: 'todo' },
            ] }] } as unknown as StructuredImplementationPlan,
        );
        expect(res.matches[0].confidence).toBe('strong');
        expect(res.matches[0].source).toBe('route_match');
    });

    it('8. exact component match produces a strong match', () => {
        const res = matchScreenToPlan(
            ctx({ featureRefs: [], route: undefined, screenTitle: 'X' }),
            { milestones: [{ id: 'm', name: 'M', tasks: [
                { id: 't', title: 'Build RecentEvaluationsSidebar', description: '', status: 'todo' },
            ] }] } as unknown as StructuredImplementationPlan,
        );
        expect(res.matches[0].confidence).toBe('strong');
        expect(res.matches[0].source).toBe('component_match');
    });

    it('9. screen-title token overlap produces a weak match', () => {
        const res = matchScreenToPlan(
            ctx({ featureRefs: [], route: undefined, components: [], screenTitle: 'Evaluation History' }),
            { milestones: [{ id: 'm', name: 'M', tasks: [
                { id: 't', title: 'Persist evaluation records', description: 'Store history rows.', status: 'todo' },
            ] }] } as unknown as StructuredImplementationPlan,
        );
        expect(res.matches[0].confidence).toBe('weak');
    });

    it('10. no plan match returns missing with a recommended action', () => {
        const res = matchScreenToPlan(
            ctx({ featureRefs: [], route: undefined, components: ['ZebraWidget'], screenTitle: 'Zebra' }),
            { milestones: [{ id: 'm', name: 'M', tasks: [
                { id: 't', title: 'Unrelated backend work', description: 'Nothing relevant.', status: 'todo' },
            ] }] } as unknown as StructuredImplementationPlan,
        );
        expect(res.confidence).toBe('missing');
        expect(res.warnings[0]).toMatch(/No related Implementation Plan tasks/);
    });

    it('returns missing when there is no plan artifact at all', () => {
        const res = matchScreenToPlan(ctx(), null);
        expect(res.confidence).toBe('missing');
    });
});

// --- Composite bridge --------------------------------------------------------

describe('buildScreenArtifactTraceBridge', () => {
    it('14. overall trace confidence rolls up as the weaker of the two traces', () => {
        // Strong data model, weak plan → overall weak.
        const bridge = buildScreenArtifactTraceBridge(
            ctx({ featureRefs: [], dataLabels: ['TargetRole'], route: undefined, components: [], screenTitle: 'Evaluation History' }),
            DATA_MODEL,
            { milestones: [{ id: 'm', name: 'M', tasks: [
                { id: 't', title: 'Persist evaluation records', description: 'Store history rows.', status: 'todo' },
            ] }] } as unknown as StructuredImplementationPlan,
        );
        expect(bridge.dataModel.confidence).toBe('strong');
        expect(bridge.implementationPlan.confidence).toBe('weak');
        expect(bridge.overall.confidence).toBe('weak');
    });

    it('12. missing Data Model trace creates a review recommendation, not a blocker', () => {
        const bridge = buildScreenArtifactTraceBridge(
            ctx({ featureRefs: [], dataLabels: ['completely_unrelated'], components: ['ZebraWidget'], screenTitle: 'Zebra' }),
            DATA_MODEL,
            PLAN,
        );
        expect(bridge.dataModel.confidence).toBe('missing');
        expect(bridge.overall.warnings.some(w => /data dependencies but no matched Data Model/.test(w))).toBe(true);
        expect(bridge.overall.recommendedActions.some(a => /Review Data Model support/.test(a))).toBe(true);
    });

    it('13. a P0 screen with no plan match surfaces a plan review recommendation', () => {
        const bridge = buildScreenArtifactTraceBridge(
            ctx({ featureRefs: [], route: undefined, components: ['ZebraWidget'], screenTitle: 'Zebra' }),
            DATA_MODEL,
            { milestones: [{ id: 'm', name: 'M', tasks: [
                { id: 't', title: 'Unrelated work', description: 'Nothing relevant.', status: 'todo' },
            ] }] } as unknown as StructuredImplementationPlan,
        );
        expect(bridge.implementationPlan.confidence).toBe('missing');
        expect(bridge.overall.recommendedActions.some(a => /Implementation Plan coverage/.test(a))).toBe(true);
    });

    it('16. legacy artifacts (no Data Model / Implementation Plan) do not throw', () => {
        expect(() => {
            const bridge = buildScreenArtifactTraceBridge(ctx(), null, null);
            expect(bridge.overall.confidence).toBe('missing');
            // Missing artifacts are NOT a review nag (no artifact to review).
            expect(bridge.overall.recommendedActions.length).toBe(0);
        }).not.toThrow();
    });
});

// --- Resolvers ---------------------------------------------------------------

describe('resolveDataModelForTrace', () => {
    it('parses structured JSON content', () => {
        const resolved = resolveDataModelForTrace(JSON.stringify(DATA_MODEL));
        expect(resolved?.entities.length).toBe(3);
    });

    it('returns null for empty / unparseable content', () => {
        expect(resolveDataModelForTrace('')).toBeNull();
        expect(resolveDataModelForTrace(undefined)).toBeNull();
    });
});

describe('resolvePlanForTrace', () => {
    it('parses a synapse-plan fence', () => {
        const content = 'Some markdown\n\n```json synapse-plan\n' + JSON.stringify(PLAN) + '\n```';
        const resolved = resolvePlanForTrace(content);
        expect(resolved?.milestones.length).toBe(2);
    });

    it('parses legacy milestone markdown into pseudo-tasks', () => {
        const md = [
            '### Milestone 1: Foundation (Week 1-2)',
            '**Goal:** Build the base.',
            '**Key Deliverables:**',
            '- [ ] Build the Dashboard route',
            '- [ ] Wire recent evaluations',
            '---',
            '## Critical Path Summary',
        ].join('\n');
        const resolved = resolvePlanForTrace(md);
        expect(resolved?.milestones[0].tasks.length).toBe(2);
        expect(resolved?.milestones[0].tasks[0].title).toMatch(/Dashboard route/);
    });

    it('returns null for empty content', () => {
        expect(resolvePlanForTrace('')).toBeNull();
    });
});

// --- Codex review fixes ------------------------------------------------------

describe('review-fix regressions', () => {
    it('honors task-level linkedArtifacts.mockups screen links', () => {
        const plan = { milestones: [{ id: 'm', name: 'M', tasks: [
            {
                id: 't', title: 'Backend wiring', description: 'No screen name here.',
                status: 'todo', linkedArtifacts: { mockups: ['Dashboard'] },
            },
        ] }] } as unknown as StructuredImplementationPlan;
        const res = matchScreenToPlan(ctx({ featureRefs: [], route: undefined, components: [], screenTitle: 'Dashboard' }), plan);
        expect(res.matches[0].confidence).toBe('explicit');
        expect(res.matches[0].source).toBe('explicit_screen_ref');
    });

    it('recovers Data Model feature refs from stored markdown', () => {
        const md = [
            '## Evaluation',
            '',
            'A submitted evaluation.',
            '**Related Features:** F1',
            '',
            '**Key Product Fields**',
            '',
            '| Field | Type | Required | Description |',
            '| --- | --- | --- | --- |',
            '| id | string | Yes | Identifier |',
            '| status | string | Yes | State |',
        ].join('\n');
        const resolved = resolveDataModelForTrace(md);
        expect(resolved?.entities[0].featureRefs).toEqual(['F1']);
        // And the explicit shared-feature match fires off the recovered refs.
        const res = matchScreenToDataModel(
            ctx({ featureRefs: ['F1: Recent evaluations'], dataLabels: [], components: [], screenTitle: 'X' }),
            resolved,
        );
        expect(res.matches.find(m => m.entityName === 'Evaluation')?.confidence).toBe('explicit');
    });
});
