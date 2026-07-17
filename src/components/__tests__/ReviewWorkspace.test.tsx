import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
    ReviewWorkspace,
    type PlanningRecordView,
    type ReviewRunView,
    type ReviewSpecialistOption,
    type ReviewWorkspaceProps,
} from '../review/ReviewWorkspace';

const panel: ReviewSpecialistOption[] = [
    {
        id: 'product',
        name: 'Product & Scope',
        responsibility: 'Tests scope, outcomes, and unresolved product choices.',
        selectionReason: 'The PRD contains several deferred features.',
        recommended: true,
    },
    {
        id: 'security',
        name: 'Security & Privacy',
        responsibility: 'Tests sensitive data and trust boundaries.',
        selectionReason: 'The plan includes account data.',
        recommended: true,
    },
];

const baseProps = (patch: Partial<ReviewWorkspaceProps> = {}): ReviewWorkspaceProps => ({
    projectName: 'Atlas',
    recommendedPanel: panel,
    sourcesInScope: ['PRD Version 3', 'Screens v2'],
    missingSources: [],
    runs: [],
    planningRecords: [],
    onStartReview: vi.fn(),
    onSelectRun: vi.fn(),
    onCancelRun: vi.fn(),
    onRetrySpecialist: vi.fn(),
    onRetrySynthesis: vi.fn(),
    onActOnIssue: vi.fn(),
    onTriageFinding: vi.fn(),
    onConfirmPlanningRecord: vi.fn(),
    onReopenPlanningRecord: vi.fn(),
    ...patch,
});

const completeRun = (patch: Partial<ReviewRunView> = {}): ReviewRunView => ({
    id: 'review-1',
    label: 'Review 1',
    sourceLabel: 'PRD Version 3 + 1 artifact',
    capturedAt: 1_700_000_000_000,
    status: 'complete',
    readinessCoverage: 'complete',
    specialists: panel.map(s => ({ ...s, status: 'complete', findingCount: 1 })),
    issues: [{
        id: 'issue-1',
        title: 'Retention behavior is not defined',
        observation: 'The PRD requires uploads but does not define when source files are deleted.',
        consequence: 'Engineering and privacy reviewers could implement incompatible retention periods.',
        recommendedAction: 'Choose a retention period and deletion trigger.',
        kind: 'decision_needed',
        severity: 'blocking',
        confidence: 'high',
        status: 'open',
        specialistNames: ['Product & Scope', 'Security & Privacy'],
        affectedSources: ['PRD · Data handling'],
        evidence: [{
            id: 'evidence-1',
            sourceLabel: 'PRD Version 3',
            locator: 'Data handling',
            excerpt: 'Users can upload source files for analysis.',
        }],
        perspectives: [
            { specialistName: 'Security & Privacy', recommendation: 'Delete source files after extraction.' },
            { specialistName: 'Product & Scope', recommendation: 'Retain files so users can revisit them.' },
        ],
        disagreement: true,
    }],
    ...patch,
});

describe('ReviewWorkspace', () => {
    it('updates the active surface when an exact target arrives while mounted', () => {
        const props = baseProps({ initialTab: 'review' });
        const { rerender } = render(<ReviewWorkspace {...props} />);
        expect(screen.getByRole('button', { name: 'Review findings' })).toHaveClass('border-indigo-600');

        rerender(<ReviewWorkspace {...props} initialTab="decisions" />);
        expect(screen.getByRole('button', { name: 'Decision Center' })).toHaveClass('border-indigo-600');
        expect(screen.getByRole('heading', { name: 'Decision Center' })).toBeInTheDocument();
    });

    it('keeps all three navigation targets reachable at mobile width', () => {
        render(<ReviewWorkspace {...baseProps()} />);

        const findings = screen.getByRole('button', { name: 'Review findings' });
        const decisions = screen.getByRole('button', { name: 'Decision Center' });
        const history = screen.getByRole('button', { name: 'Review history' });
        for (const tab of [findings, decisions, history]) {
            expect(tab).toHaveClass('min-h-12', 'flex-1', 'min-w-0', 'sm:flex-none');
        }
        expect(findings).toHaveTextContent('Findings');
        expect(decisions).toHaveTextContent('Decisions');
        expect(history).toHaveTextContent('History');
    });

    it('starts a recommended review with the selected panel and optional focus', () => {
        const onStartReview = vi.fn();
        render(<ReviewWorkspace {...baseProps({ onStartReview })} />);

        fireEvent.change(screen.getByLabelText('Optional focus'), { target: { value: 'Focus on mobile recovery' } });
        fireEvent.click(screen.getByRole('button', { name: 'Start specialist review' }));

        expect(onStartReview).toHaveBeenCalledWith({
            specialistIds: ['product', 'security'],
            focus: 'Focus on mobile recovery',
        });
    });

    it('labels an intentionally narrowed specialist review as exploratory rather than readiness-complete', () => {
        const onStartReview = vi.fn();
        render(<ReviewWorkspace {...baseProps({ onStartReview })} />);

        fireEvent.click(screen.getByRole('checkbox', { name: /Security & Privacy/i }));
        expect(screen.getByText(/will not satisfy build-readiness coverage/i)).toBeInTheDocument();
        expect(screen.getByText(/Restore Security & Privacy/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Start specialist review' }));
        expect(onStartReview).toHaveBeenCalledWith({ specialistIds: ['product'], focus: undefined });
    });

    it('preserves exploratory coverage and omitted specialists in results and history', () => {
        const run = completeRun({
            readinessCoverage: 'exploratory',
            omittedRequiredSpecialistNames: ['Security & Privacy'],
            specialists: [{ ...panel[0], status: 'complete', findingCount: 0 }],
            issues: [],
        });
        render(<ReviewWorkspace {...baseProps({ runs: [run], activeRunId: run.id })} />);

        expect(screen.getByRole('heading', { name: 'Exploratory planning review' })).toBeInTheDocument();
        expect(screen.getByText(/Missing required review: Security & Privacy/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Review history' }));
        expect(screen.getByText(/Exploratory · omitted Security & Privacy/i)).toBeInTheDocument();
        expect(screen.getByText('exploratory')).toHaveClass('text-amber-700');
    });

    it('does not present a completed run with incomplete specialist evidence as readiness-complete', () => {
        const run = completeRun({ readinessCoverage: 'incomplete' });
        render(<ReviewWorkspace {...baseProps({ runs: [run], activeRunId: run.id })} />);

        expect(screen.getByText(/completed with unsupported or incomplete specialist evidence/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Review history' }));
        expect(screen.getByText('Specialist evidence incomplete')).toBeInTheDocument();
        expect(screen.getByText('incomplete')).toHaveClass('text-amber-700');
    });

    it('shows durable specialist progress and retries only the failed specialist', () => {
        const run = completeRun({
            status: 'running',
            specialists: [
                { ...panel[0], status: 'complete', findingCount: 0 },
                { ...panel[1], status: 'failed', error: 'Timed out' },
            ],
            issues: [],
        });
        const onRetrySpecialist = vi.fn();
        render(<ReviewWorkspace {...baseProps({ runs: [run], activeRunId: run.id, onRetrySpecialist })} />);

        expect(screen.getByText('1 of 2 specialist reviews complete')).toBeInTheDocument();
        expect(screen.getByText('Timed out')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(onRetrySpecialist).toHaveBeenCalledWith('review-1', 'security');
    });

    it('preserves disagreement and requires a reason before dismissing a finding', () => {
        const run = completeRun();
        const onActOnIssue = vi.fn();
        render(<ReviewWorkspace {...baseProps({ runs: [run], activeRunId: run.id, onActOnIssue })} />);

        expect(screen.getByText('Specialists disagree')).toBeInTheDocument();
        expect(screen.getByText(/Raised independently by Product & Scope \+ Security & Privacy/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Resolve/ }));
        fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'dismiss' } });
        const save = screen.getByRole('button', { name: 'Save action' });
        expect(save).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Policy already approved elsewhere' } });
        fireEvent.click(save);

        expect(onActOnIssue).toHaveBeenCalledWith(
            'review-1',
            'issue-1',
            'dismiss',
            'Policy already approved elsewhere',
            undefined,
        );
    });

    it('keeps proposed specialist records distinct from confirmed decisions', () => {
        const records: PlanningRecordView[] = [{
            id: 'record-1',
            type: 'decision',
            title: 'Choose the source-file retention period',
            status: 'proposed',
            statement: 'Choose a retention period.',
            sourceLabels: ['specialist review'],
            history: [],
            sourceIssueIds: ['issue-1'],
            createdAt: 1_700_000_000_000,
        }];
        const onConfirmPlanningRecord = vi.fn();
        render(<ReviewWorkspace {...baseProps({ planningRecords: records, onConfirmPlanningRecord })} />);

        fireEvent.click(screen.getByRole('button', { name: /Decision Center/ }));
        expect(screen.getAllByText('Needs your decision').length).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('button', { name: 'Confirm decision' }));
        expect(onConfirmPlanningRecord).toHaveBeenCalledWith('record-1');
    });

    it('starts a new version-linked review after a completed run', () => {
        const onStartReview = vi.fn();
        render(<ReviewWorkspace {...baseProps({ runs: [completeRun()], onStartReview })} />);

        fireEvent.click(screen.getByRole('button', { name: 'Review current plan' }));
        expect(screen.getByRole('button', { name: 'Start specialist review' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Start specialist review' }));
        expect(onStartReview).toHaveBeenCalled();
    });

    it('retries and resynthesizes incomplete coverage from partial results', () => {
        const onRetrySynthesis = vi.fn();
        const run = completeRun({
            status: 'partial',
            specialists: [
                { ...panel[0], status: 'complete', findingCount: 1 },
                { ...panel[1], status: 'failed', error: 'Timed out' },
            ],
        });
        render(<ReviewWorkspace {...baseProps({ runs: [run], onRetrySynthesis })} />);
        fireEvent.click(screen.getByRole('button', { name: 'Retry failed coverage' }));
        expect(onRetrySynthesis).toHaveBeenCalledWith(run.id);
    });

    it('keeps the public example review surface read-only', () => {
        render(<ReviewWorkspace {...baseProps({ readOnly: true })} />);
        expect(screen.getByRole('button', { name: 'Reviews are read-only in this example' })).toBeDisabled();
    });

    it('requires a confirmed decision when recording a challenge', () => {
        const onActOnIssue = vi.fn();
        const records: PlanningRecordView[] = [{
            id: 'decision-1',
            type: 'decision',
            title: 'Retain files for 90 days',
            statement: 'Files remain available for 90 days.',
            status: 'confirmed',
            sourceLabels: ['user'],
            history: [],
            sourceIssueIds: [],
            createdAt: 1,
        }];
        render(<ReviewWorkspace {...baseProps({ runs: [completeRun()], planningRecords: records, onActOnIssue })} />);
        fireEvent.click(screen.getByRole('button', { name: /Resolve/ }));
        fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'challenge_decision' } });
        expect(screen.getByRole('button', { name: 'Save action' })).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Confirmed decision to challenge'), { target: { value: 'decision-1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save action' }));
        expect(onActOnIssue).toHaveBeenCalledWith('review-1', 'issue-1', 'challenge_decision', undefined, 'decision-1');
    });

    it('focuses and expands the exact readiness-linked finding', async () => {
        const first = completeRun().issues[0];
        const target = {
            ...first,
            id: 'issue-exact',
            title: 'Exact readiness-linked finding',
            severity: 'advisory' as const,
            recommendedAction: 'Inspect this exact issue before committing.',
        };
        const run = completeRun({ issues: [first, target] });
        render(<ReviewWorkspace {...baseProps({
            runs: [run], activeRunId: run.id, initialIssueId: target.id,
        })} />);

        const article = document.getElementById('review-issue-issue-exact');
        expect(article).toHaveClass('ring-2');
        await waitFor(() => expect(article).toHaveFocus());
        expect(screen.getByText('Inspect this exact issue before committing.')).toBeInTheDocument();
    });

    it('surfaces, highlights, and triages the exact readiness-linked specialist finding', async () => {
        const onTriageFinding = vi.fn();
        const run = completeRun({
            issues: [],
            untriagedFindings: [{
                id: 'finding-exact',
                title: 'Exact unsynthesized recovery risk',
                observation: 'The specialist found a recovery gap that did not enter issue synthesis.',
                consequence: 'Implementation could ship without a safe recovery path.',
                recommendedAction: 'Define the recovery boundary before implementation.',
                severity: 'blocking',
                confidence: 'high',
                specialistName: 'Reliability & Failure Modes',
                affectedSources: ['PRD · Recovery'],
                evidence: [],
            }],
        });
        render(<ReviewWorkspace {...baseProps({
            runs: [run], activeRunId: run.id, initialFindingId: 'finding-exact', onTriageFinding,
        })} />);

        const article = document.getElementById('review-finding-finding-exact');
        expect(article).toHaveClass('ring-2');
        await waitFor(() => expect(article).toHaveFocus());
        expect(screen.getByText('Exact unsynthesized recovery risk')).toBeInTheDocument();
        expect(screen.getByText('Define the recovery boundary before implementation.')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Add to review queue' }));
        expect(onTriageFinding).toHaveBeenCalledWith('review-1', 'finding-exact');
    });
});
