import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { useProjectStore } from '../../store/projectStore';
import { StructuredPRDView } from '../StructuredPRDView';
import { ReviewConfirmSection } from '../prd/ReviewConfirmSection';
import { DecisionLogSection } from '../prd/DecisionLogSection';
import { deriveDecisionLog, splitAssumptions } from '../../lib/derive/prdDecisions';
import type { SpineVersion, StructuredPRD } from '../../types';

// mark.js walks real DOM ranges — irrelevant to these tests and flaky in
// jsdom, so stub it out.
vi.mock('mark.js', () => ({
    default: class {
        mark() {}
        unmark() {}
    },
}));

const PROJECT_ID = 'p1';
const SPINE_ID = 'spine1';

const prd: StructuredPRD = {
    vision: 'v',
    targetUsers: ['Solo builders'],
    coreProblem: 'p',
    architecture: 'a',
    risks: [],
    features: [
        { id: 'f1', name: 'Quick Capture', description: 'd', userValue: 'v', complexity: 'low', tier: 'mvp' },
        { id: 'f2', name: 'Weekly Review', description: 'd', userValue: 'v', complexity: 'low', tier: 'v1' },
    ],
    featureSystems: [
        { id: 's1', name: 'Capture System', purpose: 'sp', featureIds: ['f1'] },
    ],
    successMetrics: [{ name: 'Activation', target: '40%', instrumentation: 'legacy event name' }],
    assumptions: [
        { id: 'a1', statement: 'Users are mobile-first', confidence: 'low' },
        { id: 'a2', statement: 'Weekly cadence works', confidence: 'high' },
    ],
};

function seedStore() {
    const spine: Partial<SpineVersion> = {
        id: SPINE_ID,
        projectId: PROJECT_ID,
        promptText: 'idea',
        responseText: 'md',
        structuredPRD: prd,
        isLatest: true,
        isFinal: false,
        createdAt: 1,
    };
    useProjectStore.setState({
        projects: {},
        spineVersions: { [PROJECT_ID]: [spine as SpineVersion] },
        historyEvents: {},
        branches: {},
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
        planningRecords: {},
    });
}

beforeEach(() => {
    seedStore();
    vi.stubGlobal(
        'matchMedia',
        vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    );
});

const latestSpine = () => {
    const versions = useProjectStore.getState().spineVersions[PROJECT_ID];
    return versions[versions.length - 1];
};

function renderView(readOnly = false) {
    return render(
        <StructuredPRDView
            projectId={PROJECT_ID}
            spineId={SPINE_ID}
            structuredPRD={prd}
            readOnly={readOnly}
        />,
    );
}

describe('StructuredPRDView — section cleanup & ordering', () => {
    it('surfaces a calm impact handoff after a consequential direct edit', () => {
        const onOpenDecisions = vi.fn();
        render(
            <StructuredPRDView
                projectId={PROJECT_ID}
                spineId={SPINE_ID}
                structuredPRD={prd}
                readOnly={false}
                onOpenDecisions={onOpenDecisions}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Edit target users' }));
        fireEvent.change(screen.getByPlaceholderText('One item per line'), {
            target: { value: 'Independent creators' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        expect(screen.getByText('Plan meaning updated')).toBeInTheDocument();
        expect(screen.getByText(/related plan areas should be reviewed/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Review planning impact' }));
        expect(onOpenDecisions).toHaveBeenCalledWith(expect.any(String));
    });

    it('does not interrupt a copy-only direct edit', () => {
        renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Edit vision' }));
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'V.' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        expect(screen.queryByText('Plan meaning updated')).toBeNull();
        expect(screen.queryByText('This edit may affect the plan')).toBeNull();
    });

    it('renders Detailed Features before Feature Systems', () => {
        const { container } = renderView();
        const html = container.innerHTML;
        const features = html.indexOf('Detailed Features');
        const systems = html.indexOf('Feature Systems');
        expect(features).toBeGreaterThan(-1);
        expect(systems).toBeGreaterThan(-1);
        expect(features).toBeLessThan(systems);
    });

    it('does not render a Defer bucket or the derived-from clutter line', () => {
        renderView();
        expect(screen.getByText('Current proposed scope')).toBeInTheDocument();
        expect(screen.queryByText('Defer')).toBeNull();
        expect(screen.queryByText(/derived from features and assumptions/i)).toBeNull();
    });

    it('omits Instrumentation from Success Metrics', () => {
        renderView();
        expect(screen.getByText('Success Metrics')).toBeInTheDocument();
        expect(screen.queryByText(/instrumentation/i)).toBeNull();
        expect(screen.queryByText('legacy event name')).toBeNull();
    });

    it('replaces the passive Assumptions section with Review & Confirm', () => {
        renderView();
        expect(screen.queryByText('Assumptions')).toBeNull();
        expect(screen.getByText('Review & Confirm')).toBeInTheDocument();
    });

    it('surfaces durable decision-center conflicts in the affected PRD section', () => {
        useProjectStore.setState({
            planningRecords: {
                [PROJECT_ID]: [{
                    id: 'conflict-1', projectId: PROJECT_ID, type: 'conflict', status: 'open',
                    title: 'The target market conflicts with the pricing model', statement: 'Resolve the market conflict',
                    affectedPrdSections: ['Vision'], evidence: [], sourceFindingIds: [], createdBy: 'specialist_review',
                    affectedPlanLocations: [{ kind: 'claim', section: 'Vision', label: 'Primary market promise', jsonPath: '$.vision' }],
                    createdAt: 1, updatedAt: 1,
                }],
            },
        });
        const onOpenDecisions = vi.fn();
        render(<StructuredPRDView projectId={PROJECT_ID} spineId={SPINE_ID} structuredPRD={prd} readOnly={false} onOpenDecisions={onOpenDecisions} />);
        expect(screen.getByText(/Affected: Primary market promise/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /1 planning item needs review in this section/ }));
        expect(onOpenDecisions).toHaveBeenCalledOnce();
    });

    it('renders no MVP Scope section — the Implementation Summary is the single scope surface', () => {
        render(
            <StructuredPRDView
                projectId={PROJECT_ID}
                spineId={SPINE_ID}
                structuredPRD={{
                    ...prd,
                    mvpScope: {
                        mvp: ['F1: Quick Capture'],
                        v1: ['Weekly Review polish'],
                        later: ['Integrations'],
                        rationale: 'Capture loop first.',
                    },
                }}
                readOnly
            />,
        );
        expect(document.getElementById('prd-mvp-scope')).toBeNull();
        expect(screen.queryByText('MVP Scope')).toBeNull();
        // The scope rationale surfaces in the Implementation Summary…
        const summary = document.getElementById('prd-implementation-summary')!;
        expect(within(summary).getByText(/Capture loop first/)).toBeInTheDocument();
        // …and "Later" items surface as Deferred entries in the Decision Log.
        const log = document.getElementById('prd-decision-log')!;
        expect(within(log).getByText('Integrations')).toBeInTheDocument();
        expect(within(log).getByText('Deferred')).toBeInTheDocument();
    });

    it('collapses V1 features by default and expands them on toggle', () => {
        renderView();
        // f1 (mvp) visible; f2 (v1) hidden behind the disclosure.
        expect(screen.getByRole('heading', { level: 4, name: 'Quick Capture' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { level: 4, name: 'Weekly Review' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /V1 — soon after launch/ }));
        expect(screen.getByRole('heading', { level: 4, name: 'Weekly Review' })).toBeInTheDocument();
    });

    it('excludes deferred features from Detailed Features and points at the Decision Log', () => {
        render(
            <StructuredPRDView
                projectId={PROJECT_ID}
                spineId={SPINE_ID}
                structuredPRD={{
                    ...prd,
                    features: [
                        ...prd.features,
                        { id: 'f10', name: 'Anki Export', description: 'CSV export', userValue: 'v', complexity: 'low', tier: 'later' },
                    ],
                }}
                readOnly
            />,
        );
        expect(screen.queryByRole('heading', { level: 4, name: 'Anki Export' })).toBeNull();
        expect(screen.getByText(/deferred feature is recorded in the/)).toBeInTheDocument();
        const log = document.getElementById('prd-decision-log')!;
        expect(within(log).getByText('Anki Export')).toBeInTheDocument();
    });

    it('summary cards deep-link to feature detail anchors with a back affordance', () => {
        renderView();
        const summary = document.getElementById('prd-implementation-summary')!;
        const link = within(summary).getByTitle('Jump to Quick Capture details');
        expect(link.getAttribute('href')).toBe('#prd-feature-f1');
        expect(document.getElementById('prd-feature-f1')).not.toBeNull();
        expect(
            screen.getByRole('button', { name: 'Back to current proposed scope from Quick Capture' }),
        ).toBeInTheDocument();
    });
});

describe('StructuredPRDView — assumption review flow', () => {
    it('orders unresolved assumptions by confidence (highest first)', () => {
        renderView();
        const section = document.getElementById('prd-review-confirm')!;
        const items = within(section).getAllByRole('listitem');
        expect(items[0].textContent).toContain('Weekly cadence works');
        expect(items[1].textContent).toContain('Users are mobile-first');
    });

    it('confirming an assumption appends a new spine version with the decision', () => {
        renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Accept for planning, not validated: Weekly cadence works' }));
        const spine = latestSpine();
        expect(spine.id).not.toBe(SPINE_ID);
        const decided = spine.structuredPRD?.assumptions?.find(a => a.id === 'a2');
        expect(decided?.decision).toBe('confirmed');
        expect(decided?.decidedAt).toBeTypeOf('number');
        expect(spine.provenance?.editSummary).toContain('Accepted assumption for planning');
        const record = useProjectStore.getState().planningRecords[PROJECT_ID]
            .find(item => item.sources?.some(source => source.sourceId === 'a2'));
        expect(record).toMatchObject({ status: 'confirmed' });
        expect(record?.events?.at(-1)).toMatchObject({ type: 'custom_answered', actor: 'user' });
    });

    it('rejecting an assumption records the correction note', () => {
        renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Mark assumption incorrect: Users are mobile-first' }));
        fireEvent.change(screen.getByPlaceholderText(/What's actually true/), {
            target: { value: 'Desktop-first actually' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Mark incorrect' }));
        const decided = latestSpine().structuredPRD?.assumptions?.find(a => a.id === 'a1');
        expect(decided?.decision).toBe('rejected');
        expect(decided?.decisionNote).toBe('Desktop-first actually');
        const record = useProjectStore.getState().planningRecords[PROJECT_ID]
            .find(item => item.sources?.some(source => source.sourceId === 'a1'));
        expect(record?.status).toBe('rejected');
        expect(record?.events?.at(-1)).toMatchObject({
            type: 'premise_rejected',
            actor: 'user',
            reason: 'Desktop-first actually',
        });
    });

    it('confirming a feature appends a version with confirmed set', () => {
        renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Confirm feature Quick Capture' }));
        const spine = latestSpine();
        const f = spine.structuredPRD?.features.find(x => x.id === 'f1');
        expect(f?.confirmed).toBe(true);
        expect(spine.provenance?.editSummary).toBe('Confirmed feature: Quick Capture');
    });

    it('hides confirm/reject actions in read-only mode', () => {
        renderView(true);
        expect(screen.queryByRole('button', { name: /Accept for planning, not validated/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /Confirm feature/ })).toBeNull();
    });

    it('opens the exact material assumption record for validation', () => {
        const onOpenDecisions = vi.fn();
        render(<StructuredPRDView projectId={PROJECT_ID} spineId={SPINE_ID} structuredPRD={prd} readOnly={false} onOpenDecisions={onOpenDecisions} />);

        fireEvent.click(screen.getByRole('button', { name: 'Plan validation for assumption: Weekly cadence works' }));
        const record = useProjectStore.getState().planningRecords[PROJECT_ID]
            .find(item => item.sources?.some(source => source.sourceId === 'a2'));
        expect(record).toBeDefined();
        expect(onOpenDecisions).toHaveBeenCalledWith(record?.id);
    });
});

describe('ReviewConfirmSection / DecisionLogSection units', () => {
    it('ReviewConfirmSection renders nothing when all assumptions are decided', () => {
        const { container } = render(
            <ReviewConfirmSection assumptions={[]} onConfirm={() => {}} onReject={() => {}} readOnly={false} />,
        );
        expect(container.innerHTML).toBe('');
    });

    it('DecisionLogSection renders confirmed and rejected entries distinctly', () => {
        const entries = deriveDecisionLog({
            ...prd,
            assumptions: [
                { id: 'a1', statement: 'Solo users only', confidence: 'med', decision: 'rejected', decisionNote: 'Teams too', decidedAt: 1 },
                { id: 'a2', statement: 'Weekly cadence works', confidence: 'high', decision: 'confirmed', decidedAt: 2 },
            ],
            features: [{ ...prd.features[0], confirmed: true, confirmedAt: 3 }],
        });
        const onUndoAssumption = vi.fn();
        render(
            <DecisionLogSection
                entries={entries}
                onUndoAssumption={onUndoAssumption}
                onUndoFeature={() => {}}
                readOnly={false}
            />,
        );
        expect(screen.getByText('Decision Log')).toBeInTheDocument();
        expect(screen.getByText('Marked incorrect')).toBeInTheDocument();
        expect(screen.getByText('Accepted for planning · not validated')).toBeInTheDocument();
        expect(screen.getByText('Feature confirmed')).toBeInTheDocument();
        expect(screen.getByText(/Teams too/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Undo decision: Solo users only' }));
        expect(onUndoAssumption).toHaveBeenCalledWith('a1');
    });

    it('keeps an exact validation action beside a material accepted assumption', () => {
        const onPlanValidation = vi.fn();
        const entries = deriveDecisionLog({
            ...prd,
            assumptions: [{ id: 'a1', statement: 'Creators will pay', confidence: 'low', materiality: 'high', decision: 'confirmed' }],
        });
        render(<DecisionLogSection entries={entries} onUndoAssumption={() => {}} onPlanValidation={onPlanValidation} onUndoFeature={() => {}} readOnly={false} />);

        fireEvent.click(screen.getByRole('button', { name: 'Plan validation for accepted assumption: Creators will pay' }));
        expect(onPlanValidation).toHaveBeenCalledWith('a1');
    });

    it('keeps low-impact acceptance lightweight while material assumptions offer validation planning', () => {
        const onPlanValidation = vi.fn();
        render(
            <ReviewConfirmSection
                assumptions={[
                    { id: 'material', statement: 'Creators will pay', confidence: 'low', materiality: 'high' },
                    { id: 'low', statement: 'Users prefer rounded cards', confidence: 'med', materiality: 'low' },
                ]}
                onConfirm={() => {}}
                onPlanValidation={onPlanValidation}
                onReject={() => {}}
                readOnly={false}
            />,
        );

        expect(screen.getByRole('button', { name: 'Plan validation for assumption: Creators will pay' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Plan validation for assumption: Users prefer rounded cards' })).toBeNull();
        expect(screen.getAllByText('Accept for planning')).toHaveLength(2);
    });

    it('splitAssumptions keeps unresolved and decided visually separable inputs', () => {
        const { unresolved, decided } = splitAssumptions([
            { id: 'a1', statement: 's1', confidence: 'low' },
            { id: 'a2', statement: 's2', confidence: 'high', decision: 'confirmed' },
        ]);
        expect(unresolved.map(a => a.id)).toEqual(['a1']);
        expect(decided.map(a => a.id)).toEqual(['a2']);
    });
});
