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
        projects: { [PROJECT_ID]: { id: PROJECT_ID, name: 'Test', createdAt: 1 } },
        spineVersions: { [PROJECT_ID]: [spine as SpineVersion] },
        historyEvents: {},
        branches: {},
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
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

// Switch the active PRD view (Overview | Features | Decisions). The tab's
// accessible name may include a trailing count badge, so match loosely.
const goTo = (label: RegExp) => fireEvent.click(screen.getByRole('tab', { name: label }));

describe('StructuredPRDView — three-view IA', () => {
    it('defaults to the Overview view with the product brief', () => {
        renderView();
        expect(screen.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('heading', { name: 'Scope' })).toBeInTheDocument();
        expect(screen.getByText('Success Metrics')).toBeInTheDocument();
        // The Overview shows scope as compact references, NOT the full feature
        // spec — feature detail (user value, criteria) lives in the Features view.
        expect(screen.queryByText('User Value:')).toBeNull();
        // Overview omits Instrumentation column / legacy values.
        expect(screen.queryByText(/instrumentation/i)).toBeNull();
        expect(screen.queryByText('legacy event name')).toBeNull();
        // Decisions content is not on the Overview panel.
        expect(screen.queryByText('Decision Log')).toBeNull();
    });

    it('Features view groups features under their feature systems', () => {
        renderView();
        goTo(/Features/);
        // The system name shows once as a group header…
        expect(screen.getByText('Capture System')).toBeInTheDocument();
        // …with its member feature nested (f1). f2 lands in "Other features".
        expect(screen.getByRole('heading', { level: 4, name: 'Quick Capture' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 4, name: 'Weekly Review' })).toBeInTheDocument();
        expect(screen.getByText('Other features')).toBeInTheDocument();
    });

    it('Features filter narrows to MVP / Later', () => {
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
        goTo(/Features/);
        // Default (All) hides deferred features.
        expect(screen.queryByRole('heading', { level: 4, name: 'Anki Export' })).toBeNull();
        // MVP filter keeps only f1.
        fireEvent.change(screen.getByLabelText('Filter features'), { target: { value: 'mvp' } });
        expect(screen.getByRole('heading', { level: 4, name: 'Quick Capture' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { level: 4, name: 'Weekly Review' })).toBeNull();
        // Later filter reveals the deferred feature.
        fireEvent.change(screen.getByLabelText('Filter features'), { target: { value: 'later' } });
        expect(screen.getByRole('heading', { level: 4, name: 'Anki Export' })).toBeInTheDocument();
    });

    it('Decisions view splits Needs Input from Assumptions to Validate', () => {
        renderView();
        goTo(/Decisions/);
        // a1 is low-confidence → Needs Input; a2 is high → Assumptions to Validate.
        const needsInput = document.getElementById('prd-needs-input')!;
        expect(within(needsInput).getByText('Users are mobile-first')).toBeInTheDocument();
        const toValidate = document.getElementById('prd-assumptions')!;
        expect(within(toValidate).getByText('Weekly cadence works')).toBeInTheDocument();
    });

    it('deferred scope surfaces in the Decisions Deferred & Risks section', () => {
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
        // Scope rationale lives in the Overview Implementation Summary…
        const summary = document.getElementById('prd-implementation-summary')!;
        expect(within(summary).getByText(/Capture loop first/)).toBeInTheDocument();
        expect(screen.queryByText('MVP Scope')).toBeNull();
        // …deferred "Later" items live in the Decisions view.
        goTo(/Decisions/);
        const deferred = document.getElementById('prd-deferred-risks')!;
        expect(within(deferred).getByText('Integrations')).toBeInTheDocument();
        expect(within(deferred).getByText('Deferred scope')).toBeInTheDocument();
    });

    it('scope references cross-navigate to the feature in the Features view', () => {
        renderView();
        const summary = document.getElementById('prd-implementation-summary')!;
        const link = within(summary).getByTitle('Go to Quick Capture in Features');
        fireEvent.click(link);
        // Now on the Features view, with the feature card + back affordance.
        expect(screen.getByRole('tab', { name: /Features/ })).toHaveAttribute('aria-selected', 'true');
        expect(document.getElementById('prd-feature-f1')).not.toBeNull();
        expect(
            screen.getByRole('button', { name: 'Back to Implementation Summary from Quick Capture' }),
        ).toBeInTheDocument();
    });
});

describe('StructuredPRDView — review workflow', () => {
    it('confirming an assumption appends a new spine version with the decision', () => {
        renderView();
        goTo(/Decisions/);
        fireEvent.click(screen.getByRole('button', { name: 'Confirm assumption: Weekly cadence works' }));
        const spine = latestSpine();
        expect(spine.id).not.toBe(SPINE_ID);
        const decided = spine.structuredPRD?.assumptions?.find(a => a.id === 'a2');
        expect(decided?.decision).toBe('confirmed');
        expect(decided?.decidedAt).toBeTypeOf('number');
        expect(spine.provenance?.editSummary).toContain('Confirmed assumption');
    });

    it('rejecting an assumption records the correction note', () => {
        renderView();
        goTo(/Decisions/);
        fireEvent.click(screen.getByRole('button', { name: 'Mark assumption incorrect: Users are mobile-first' }));
        fireEvent.change(screen.getByPlaceholderText(/What's actually true/), {
            target: { value: 'Desktop-first actually' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Mark incorrect' }));
        const decided = latestSpine().structuredPRD?.assumptions?.find(a => a.id === 'a1');
        expect(decided?.decision).toBe('rejected');
        expect(decided?.decisionNote).toBe('Desktop-first actually');
    });

    it('confirming a feature appends a version with confirmed set', () => {
        renderView();
        goTo(/Features/);
        fireEvent.click(screen.getByRole('button', { name: 'Confirm feature Quick Capture' }));
        const spine = latestSpine();
        const f = spine.structuredPRD?.features.find(x => x.id === 'f1');
        expect(f?.confirmed).toBe(true);
        expect(spine.provenance?.editSummary).toBe('Confirmed feature: Quick Capture');
    });

    it('hides confirm/reject actions in read-only mode', () => {
        renderView(true);
        goTo(/Decisions/);
        expect(screen.queryByRole('button', { name: /Confirm assumption/ })).toBeNull();
        goTo(/Features/);
        expect(screen.queryByRole('button', { name: /Confirm feature/ })).toBeNull();
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
        expect(screen.getByText('Confirmed')).toBeInTheDocument();
        expect(screen.getByText('Feature confirmed')).toBeInTheDocument();
        expect(screen.getByText(/Teams too/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Undo decision: Solo users only' }));
        expect(onUndoAssumption).toHaveBeenCalledWith('a1');
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
