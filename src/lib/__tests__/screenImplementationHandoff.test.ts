import { describe, it, expect } from 'vitest';
import type { DataModelContent, Feature, ScreenItem, StructuredImplementationPlan } from '../../types';
import type { ScreenExperienceItem } from '../screenExperience';
import type { ScreenReviewModel, SystemReadinessStatus, ScreenReviewFreshnessStatus } from '../screenReviewWorkflow';
import type { DerivedMockupVariant } from '../mockupVariants';
import type { ScreenReviewStatus } from '../screenReadiness';
import {
    buildScreenImplementationHandoff,
    buildScreensHandoffRollup,
    buildHandoffPreflightContribution,
    deriveHandoffRoute,
    deriveHandoffComponents,
    deriveHandoffState,
    deriveHandoffEvents,
    deriveHandoffDataDependencies,
    deriveHandoffQaChecklist,
    deriveHandoffReadiness,
    renderHandoffMarkdown,
    type ScreenHandoffInput,
    type HandoffReadinessSignals,
} from '../screenImplementationHandoff';

// --- Fixtures ----------------------------------------------------------------

function screen(overrides: Partial<ScreenItem> = {}): ScreenItem {
    return {
        name: 'Landing & Role Selection',
        priority: 'P0',
        purpose: 'Entry point where the user picks a target role.',
        userIntent: 'Select a target role and start an evaluation',
        featureRefs: ['F1: Role selection'],
        states: [
            { name: 'Default', description: 'Roles shown', trigger: 'load', type: 'default', required: true },
            { name: 'Empty history', description: 'No prior evaluations', trigger: 'none', type: 'empty', required: true, needsMockup: true },
        ],
        entryPoints: ['App launch'],
        exitPaths: [{ label: 'Start evaluation', target: 'Dashboard' }],
        coreUIElements: ['Hero banner', 'Role selection grid'],
        outputData: ['selected role id'],
        acceptanceCriteria: ['User can select exactly one target role.'],
        ...overrides,
    };
}

function reviewModel(overrides: Partial<ScreenReviewModel> = {}): ScreenReviewModel {
    return {
        userStatus: undefined,
        systemReadiness: 'ready' as SystemReadinessStatus,
        issues: [],
        blockingCount: 0,
        reviewCount: 0,
        infoCount: 0,
        acceptedOverWarnings: false,
        freshness: 'unknown' as ScreenReviewFreshnessStatus,
        checklist: {},
        checklistProgress: { checked: 0, total: 8 },
        ...overrides,
    };
}

function variant(overrides: Partial<DerivedMockupVariant> = {}): DerivedMockupVariant {
    return {
        id: 'default',
        screenId: 's',
        viewport: 'desktop',
        stateName: 'Default',
        stateType: 'default',
        status: 'generated',
        required: true,
        userSet: false,
        source: 'legacy',
        coverageStatus: 'unknown',
        coverageEstimated: true,
        imagePresence: 'present',
        notes: [],
        ...overrides,
    };
}

function item(scr: ScreenItem, overrides: Partial<ScreenExperienceItem> = {}): ScreenExperienceItem {
    return {
        id: 'scr-landing',
        slug: 'landing-role-selection',
        screen: scr,
        baseScreen: scr,
        isEdited: false,
        sectionTitle: 'Main',
        relatedFlows: [],
        ...overrides,
    };
}

const FEATURES: Feature[] = [
    { id: 'F1', name: 'Role selection', description: '', userValue: '', complexity: 'low' },
];

function handoffInput(overrides: Partial<ScreenHandoffInput> = {}): ScreenHandoffInput {
    const scr = overrides.item?.screen ?? screen();
    return {
        item: item(scr),
        reviewModel: reviewModel(),
        variants: [variant()],
        features: FEATURES,
        ...overrides,
    };
}

// --- 1-3. Route --------------------------------------------------------------

describe('deriveHandoffRoute', () => {
    it('1. uses the explicit handoff route when available', () => {
        const r = deriveHandoffRoute(screen({ handoff: { route: '/evaluate' } }));
        expect(r.path).toBe('/evaluate');
        expect(r.confidence).toBe('explicit');
    });

    it('2. derives a fallback route from the screen title when explicit is missing', () => {
        const r = deriveHandoffRoute(screen({ name: 'Landing & Role Selection', handoff: undefined }));
        // Landing maps to '/'.
        expect(r.path).toBe('/');
        expect(r.confidence).toBe('derived');
    });

    it('3. marks confidence derived and slugifies an unknown title', () => {
        const r = deriveHandoffRoute(screen({ name: 'Widget Config Panel', handoff: undefined }));
        expect(r.path).toBe('/widget-config-panel');
        expect(r.confidence).toBe('derived');
    });
});

// --- 4-7. Components / State / Events / Data ---------------------------------

describe('deriveHandoffComponents', () => {
    it('4. derives components from core UI regions', () => {
        const comps = deriveHandoffComponents(screen());
        const names = comps.map(c => c.name);
        expect(names).toContain('HeroBanner');
        expect(names).toContain('RoleSelectionGrid');
        expect(comps.every(c => c.source === 'core_ui')).toBe(true);
    });

    it('prefers generated handoff primaryComponents over core UI', () => {
        const comps = deriveHandoffComponents(screen({
            handoff: { primaryComponents: ['SubmissionWizard'] },
        }));
        expect(comps[0].name).toBe('SubmissionWizard');
        expect(comps[0].source).toBe('handoff');
    });
});

describe('deriveHandoffState', () => {
    it('5. derives state entries from required states and handoff fields', () => {
        const state = deriveHandoffState(screen({
            handoff: { stateVariables: ['selectedRoleId'] },
        }));
        const names = state.map(s => s.name);
        expect(names).toContain('selectedRoleId');
        // The non-default "Empty history" state contributes a status entry.
        expect(names.some(n => n.includes('empty_history'))).toBe(true);
    });
});

describe('deriveHandoffEvents', () => {
    it('6. derives events from user actions and exit paths', () => {
        const events = deriveHandoffEvents(screen(), ['User selects a role']);
        const names = events.map(e => e.name);
        // From exit path "Start evaluation".
        expect(names).toContain('onStartEvaluation');
        // From the flow user action.
        expect(names.some(n => n.startsWith('on'))).toBe(true);
        expect(events.some(e => e.source === 'flow')).toBe(true);
    });
});

describe('deriveHandoffDataDependencies', () => {
    it('7. derives data dependencies from outputs, handoff data, and api deps', () => {
        const deps = deriveHandoffDataDependencies(screen({
            outputData: ['selected role id'],
            handoff: { dataDependencies: ['Evaluation', 'localStorage.recentEvaluations'], apiDependencies: ['POST /submissions'] },
        }));
        const labels = deps.map(d => d.label);
        expect(labels).toContain('Evaluation');
        expect(labels).toContain('selected role id');
        expect(deps.find(d => d.label === 'localStorage.recentEvaluations')?.type).toBe('storage');
        expect(deps.find(d => d.label === 'POST /submissions')?.type).toBe('api');
        expect(deps.find(d => d.label === 'selected role id')?.direction).toBe('write');
    });
});

// --- 8-10. QA checklist ------------------------------------------------------

describe('deriveHandoffQaChecklist', () => {
    const base = { mobileMissing: false, hasMockup: true, mockupFreshnessConcern: false };

    it('8. includes acceptance criteria', () => {
        const qa = deriveHandoffQaChecklist(screen(), {
            ...base, acceptanceCriteria: ['User can select exactly one target role.'],
        });
        expect(qa.some(q => q.category === 'acceptance')).toBe(true);
    });

    it('9. includes required states', () => {
        const qa = deriveHandoffQaChecklist(screen(), { ...base, acceptanceCriteria: [] });
        expect(qa.some(q => q.category === 'state' && /Empty history/.test(q.label))).toBe(true);
    });

    it('10. includes risk / error-handling items', () => {
        const qa = deriveHandoffQaChecklist(
            screen({ riskDetails: [{ description: 'Stored data is corrupt', severity: 'medium' }] }),
            { ...base, acceptanceCriteria: [] },
        );
        expect(qa.some(q => q.category === 'error_handling' && q.source === 'risks')).toBe(true);
    });
});

// --- 11. Build tasks ---------------------------------------------------------

describe('buildScreenImplementationHandoff build tasks', () => {
    it('11. includes route / component / state / QA tasks', () => {
        const h = buildScreenImplementationHandoff(handoffInput());
        const cats = new Set(h.buildTasks.map(t => t.category));
        expect(cats.has('route')).toBe(true);
        expect(cats.has('component')).toBe(true);
        expect(cats.has('state')).toBe(true);
        expect(cats.has('qa')).toBe(true);
    });
});

// --- 12-15. Readiness --------------------------------------------------------

function readinessSignals(overrides: Partial<HandoffReadinessSignals> = {}): HandoffReadinessSignals {
    return {
        isP0: true,
        isPrimary: true,
        userStatus: 'accepted' as ScreenReviewStatus,
        systemReadiness: 'ready',
        blockingCount: 0,
        reviewCount: 0,
        reviewFreshness: 'current',
        hasAcceptanceCriteria: true,
        hasRouteOrComponentGuidance: true,
        mockupFreshnessConcern: false,
        mobileMissing: false,
        dataDependenciesMissing: false,
        handoffThin: false,
        downstreamBlocking: false,
        ...overrides,
    };
}

describe('deriveHandoffReadiness', () => {
    it('12. a P0 unsigned screen is blocked', () => {
        const r = deriveHandoffReadiness(readinessSignals({ userStatus: undefined }));
        expect(r.status).toBe('blocked');
    });

    it('13. an accepted current P0 screen with no blockers is ready', () => {
        const r = deriveHandoffReadiness(readinessSignals());
        expect(r.status).toBe('ready');
    });

    it('14. a stale mockup creates review recommended, not blocked', () => {
        const r = deriveHandoffReadiness(readinessSignals({ mockupFreshnessConcern: true }));
        expect(r.status).toBe('review_recommended');
    });

    it('a missing optional mobile variant never downgrades readiness', () => {
        // Optional viewport variants are on-demand documentation — they appear
        // in the QA checklist but must not make an accepted screen read
        // "review recommended" (audit H1/H2).
        const r = deriveHandoffReadiness(readinessSignals({ mobileMissing: true }));
        expect(r.status).toBe('ready');
    });

    it('unknown mockup freshness (legacy metadata) never downgrades readiness', () => {
        // The caller maps unknown freshness to mockupFreshnessConcern: false —
        // asserted end-to-end here via buildScreenImplementationHandoff.
        const h = buildScreenImplementationHandoff(handoffInput({
            reviewModel: reviewModel({ userStatus: 'accepted', freshness: 'current' }),
            variants: [variant({
                status: 'generated', source: 'legacy',
                freshness: { status: 'unknown', reasons: [], severity: 'info', estimated: true },
            })],
        }));
        expect(h.readiness.status).toBe('ready');
    });

    it('15. missing data trace creates a review warning', () => {
        const r = deriveHandoffReadiness(readinessSignals({ dataDependenciesMissing: true }));
        expect(r.status).toBe('review_recommended');
        expect(r.reasons.some(x => /No linked data model entities/.test(x))).toBe(true);
    });

    it('no acceptance criteria blocks', () => {
        const r = deriveHandoffReadiness(readinessSignals({ hasAcceptanceCriteria: false }));
        expect(r.status).toBe('blocked');
    });
});

// --- 16. Rollup --------------------------------------------------------------

describe('buildScreensHandoffRollup', () => {
    it('16. counts ready / review / blocked and gates on P0', () => {
        const ready = buildScreenImplementationHandoff(handoffInput({
            reviewModel: reviewModel({ userStatus: 'accepted', freshness: 'current' }),
            variants: [variant({ freshness: { status: 'current', reasons: [], severity: 'info', estimated: true } })],
        }));
        const blocked = buildScreenImplementationHandoff(handoffInput({
            item: item(screen({ purpose: '', acceptanceCriteria: [], userIntent: '', states: [], exitPaths: [], name: 'Broken', handoff: undefined, coreUIElements: [], components: [] }), { id: 'scr-broken' }),
            reviewModel: reviewModel(),
        }));
        const rollup = buildScreensHandoffRollup([ready, blocked], new Set(['scr-broken']));
        expect(rollup.total).toBe(2);
        expect(rollup.blocked).toBeGreaterThanOrEqual(1);
        expect(rollup.status).toBe('blocked');
    });

    it('is ready when every P0 handoff is ready', () => {
        const ready = buildScreenImplementationHandoff(handoffInput({
            reviewModel: reviewModel({ userStatus: 'accepted', freshness: 'current' }),
            variants: [variant({ freshness: { status: 'current', reasons: [], severity: 'info', estimated: true } })],
        }));
        const rollup = buildScreensHandoffRollup([ready], new Set(['scr-landing']));
        expect(rollup.status).toBe('ready');
        expect(rollup.message).toMatch(/build-ready handoff/);
    });
});

// --- 17. Markdown ------------------------------------------------------------

describe('renderHandoffMarkdown', () => {
    it('17. includes the key sections', () => {
        const h = buildScreenImplementationHandoff(handoffInput());
        const md = renderHandoffMarkdown(h);
        expect(md).toMatch(/# Landing & Role Selection .*Implementation Handoff/);
        expect(md).toContain('## Route');
        expect(md).toContain('## Components');
        expect(md).toContain('## State');
        expect(md).toContain('## Events');
        expect(md).toContain('## Data Dependencies');
        expect(md).toContain('## Acceptance Criteria');
        expect(md).toContain('## QA Checklist');
        expect(md).toContain('## Build Tasks');
    });

    it('renders a "no data model entities" line when there are no data deps', () => {
        const h = buildScreenImplementationHandoff(handoffInput({
            item: item(screen({ outputData: [], handoff: undefined })),
        }));
        const md = renderHandoffMarkdown(h);
        expect(md).toMatch(/No linked data model entities found/);
    });
});

// --- 18. Legacy safety -------------------------------------------------------

describe('legacy / incomplete screens', () => {
    it('18. an incomplete/legacy screen does not throw', () => {
        const legacy: ScreenItem = { name: 'Bare', priority: 'P2', purpose: '' };
        expect(() => {
            const h = buildScreenImplementationHandoff({
                item: item(legacy, { id: 'scr-bare' }),
                reviewModel: reviewModel(),
                variants: [],
            });
            renderHandoffMarkdown(h);
        }).not.toThrow();
    });
});

// --- Preflight contribution --------------------------------------------------

describe('buildHandoffPreflightContribution', () => {
    it('surfaces blocked P0 handoffs as blocking preflight items', () => {
        const blocked = buildScreenImplementationHandoff(handoffInput({
            item: item(screen({ acceptanceCriteria: [], userIntent: '', name: 'Dashboard' }), { id: 'scr-dash' }),
            reviewModel: reviewModel(),
        }));
        const contrib = buildHandoffPreflightContribution([blocked], new Set(['scr-dash']));
        expect(contrib.blocking.length).toBeGreaterThan(0);
        expect(contrib.recommendedNextActions.some(a => /Dashboard/.test(a))).toBe(true);
    });
});

// --- Phase 5B: trace-backed handoff ------------------------------------------

const TRACE_DATA_MODEL: DataModelContent = {
    entities: [
        {
            name: 'Evaluation',
            description: 'A submitted evaluation',
            fields: [
                { name: 'id', type: 'string', required: true, description: '' },
                { name: 'status', type: 'string', required: true, description: '' },
                { name: 'score', type: 'number', required: false, description: '' },
            ],
            relationships: [],
            featureRefs: ['F1'],
        },
    ],
};

const TRACE_PLAN: StructuredImplementationPlan = {
    milestones: [
        {
            id: 'm1',
            name: 'Foundation',
            linkedArtifacts: { screens: ['Landing & Role Selection'] },
            tasks: [
                { id: 't1', title: 'Build Landing route and Hero banner', description: 'Wire / route.', status: 'todo' },
            ],
        },
    ],
} as unknown as StructuredImplementationPlan;

describe('Phase 5B trace-backed handoff', () => {
    it('11. upgrades a data dependency source to data_model_trace when matched', () => {
        const h = buildScreenImplementationHandoff(handoffInput({
            item: item(screen({
                featureRefs: ['F1: Role selection'],
                outputData: [],
                handoff: { dataDependencies: ['Evaluation'] },
            })),
            dataModel: TRACE_DATA_MODEL,
            implementationPlan: TRACE_PLAN,
        }));
        const dep = h.dataDependencies.find(d => d.label === 'Evaluation');
        expect(dep?.source).toBe('data_model_trace');
        expect(dep?.matchedEntity).toBe('Evaluation');
        expect(dep?.confidence).toBe('explicit');
        expect(h.traceBridge?.dataModel.confidence).toBe('explicit');
    });

    it('exposes Implementation Plan references for a matched screen', () => {
        const h = buildScreenImplementationHandoff(handoffInput({
            dataModel: TRACE_DATA_MODEL,
            implementationPlan: TRACE_PLAN,
        }));
        expect((h.implementationPlanReferences?.length ?? 0)).toBeGreaterThan(0);
    });

    it('12. missing Data Model trace stays review-recommended, never blocked', () => {
        const h = buildScreenImplementationHandoff(handoffInput({
            item: item(screen({
                featureRefs: [],
                outputData: [],
                handoff: { dataDependencies: ['UnrelatedThing'] },
            })),
            reviewModel: reviewModel({ userStatus: 'accepted', freshness: 'current' }),
            variants: [variant({ freshness: { status: 'current', reasons: [], severity: 'info', estimated: true } })],
            dataModel: TRACE_DATA_MODEL,
            implementationPlan: TRACE_PLAN,
        }));
        // A missing data-model trace never escalates past review_recommended.
        expect(h.readiness.status).not.toBe('blocked');
    });

    it('15. markdown export includes Data Model and Implementation Plan sections', () => {
        const h = buildScreenImplementationHandoff(handoffInput({
            dataModel: TRACE_DATA_MODEL,
            implementationPlan: TRACE_PLAN,
        }));
        const md = renderHandoffMarkdown(h);
        expect(md).toContain('## Trace Confidence');
        expect(md).toContain('## Data Model Support');
        expect(md).toContain('## Related Implementation Plan Items');
    });

    it('13. a P0 screen with no plan match appears in the preflight review', () => {
        const h = buildScreenImplementationHandoff(handoffInput({
            item: item(screen({ name: 'Landing & Role Selection', featureRefs: [], handoff: undefined, outputData: [] })),
            reviewModel: reviewModel({ userStatus: 'accepted', freshness: 'current' }),
            dataModel: TRACE_DATA_MODEL,
            implementationPlan: { milestones: [{ id: 'm', name: 'M', tasks: [
                { id: 't', title: 'Unrelated backend work', description: 'Nothing relevant.', status: 'todo' },
            ] }] } as unknown as StructuredImplementationPlan,
        }));
        const contrib = buildHandoffPreflightContribution([h], new Set(['scr-landing']));
        expect(contrib.review.some(r => /no related Implementation Plan tasks/i.test(r))).toBe(true);
    });

    it('16. omitting trace inputs preserves Phase 5A behavior (no bridge)', () => {
        const h = buildScreenImplementationHandoff(handoffInput());
        expect(h.traceBridge).toBeUndefined();
        expect(h.implementationPlanReferences).toBeUndefined();
    });

    it('rollup exposes a trace summary when handoffs carry a bridge', () => {
        const traced = buildScreenImplementationHandoff(handoffInput({
            reviewModel: reviewModel({ userStatus: 'accepted', freshness: 'current' }),
            variants: [variant({ freshness: { status: 'current', reasons: [], severity: 'info', estimated: true } })],
            dataModel: TRACE_DATA_MODEL,
            implementationPlan: TRACE_PLAN,
        }));
        const rollup = buildScreensHandoffRollup([traced], new Set(['scr-landing']));
        expect(rollup.trace).not.toBeNull();
        expect(rollup.trace?.traced).toBe(1);
        expect(rollup.trace?.strong).toBe(1);
    });

    it('rollup trace is null when no handoff carried a bridge', () => {
        const h = buildScreenImplementationHandoff(handoffInput());
        const rollup = buildScreensHandoffRollup([h], new Set(['scr-landing']));
        expect(rollup.trace).toBeNull();
    });

    it('an ABSENT plan (null) is never flagged as an unmatched-task defect', () => {
        // Data model present, plan genuinely absent — must not nag "no related
        // Implementation Plan tasks" nor count it as a P0 plan gap.
        const h = buildScreenImplementationHandoff(handoffInput({
            reviewModel: reviewModel({ userStatus: 'accepted', freshness: 'current' }),
            dataModel: TRACE_DATA_MODEL,
            implementationPlan: null,
        }));
        const contrib = buildHandoffPreflightContribution([h], new Set(['scr-landing']));
        expect(contrib.review.some(r => /Implementation Plan tasks/i.test(r))).toBe(false);
        const rollup = buildScreensHandoffRollup([h], new Set(['scr-landing']));
        expect(rollup.trace?.p0PlanMissing).toBe(0);
    });
});
