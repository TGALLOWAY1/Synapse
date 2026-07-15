import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
    ReadinessCheckpoint,
    type ReadinessCheckpointView,
} from '../planning/ReadinessCheckpoint';

const baseReview = (overrides: Partial<ReadinessCheckpointView> = {}): ReadinessCheckpointView => ({
    id: 'review-2',
    versionLabel: 'Version 2',
    capturedAt: 1_720_000_000_000,
    conclusion: 'not_ready',
    isCurrent: true,
    concerns: [{
        id: 'decision-auth',
        title: 'Decide when an account is required',
        detail: 'The onboarding behavior is still provisional.',
        consequence: 'Persistence and account recovery depend on this choice.',
        severity: 'attention',
        actionLabel: 'Resolve in Decision Center',
    }],
    criteria: [{
        id: 'decisions',
        label: 'Material decisions resolved',
        status: 'attention',
        explanation: 'One material decision remains open.',
        evidence: [{
            id: 'decision-evidence',
            quality: 'direct',
            sourceLabel: 'Decision Center',
            summary: 'Account requirement remains open.',
        }],
    }],
    caveats: [],
    ...overrides,
});

const callbacks = () => ({
    onClose: vi.fn(),
    onAddressConcern: vi.fn(),
    onRefresh: vi.fn(),
    onCommitReady: vi.fn(),
    onCommitWithOpenQuestions: vi.fn(),
});

describe('ReadinessCheckpoint', () => {
    it('makes acting on the next open item primary and keeps override secondary', () => {
        const props = callbacks();
        render(<ReadinessCheckpoint review={baseReview()} {...props} />);

        const primary = screen.getAllByRole('button', { name: 'Resolve in Decision Center' }).at(-1)!;
        expect(primary).toHaveClass('min-h-11', 'w-full');
        fireEvent.click(primary);
        expect(props.onAddressConcern).toHaveBeenCalledWith('decision-auth');

        fireEvent.click(screen.getByRole('button', { name: 'Commit with open questions' }));
        expect(screen.getByLabelText('Why proceed now?')).toBeInTheDocument();
        expect(screen.getByText(/does not resolve the 1 open item/i)).toBeInTheDocument();
    });

    it('requires meaningful user rationale before authorizing an override', () => {
        const props = callbacks();
        render(<ReadinessCheckpoint review={baseReview()} {...props} />);

        fireEvent.click(screen.getByRole('button', { name: 'Commit with open questions' }));
        fireEvent.change(screen.getByLabelText('Why proceed now?'), { target: { value: 'Too short' } });
        fireEvent.click(screen.getByRole('button', { name: 'Commit with 1 open item' }));
        expect(screen.getByText(/meaningful rationale of at least 20 characters/i)).toBeInTheDocument();
        expect(props.onCommitWithOpenQuestions).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('Why proceed now?'), {
            target: { value: 'We need a prototype to validate demand before deciding.' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Commit with 1 open item' }));
        expect(props.onCommitWithOpenQuestions).toHaveBeenCalledWith({
            rationale: 'We need a prototype to validate demand before deciding.',
        });
    });

    it('requires containment when the exact checkpoint includes a build blocker', () => {
        const props = callbacks();
        const review = baseReview({
            concerns: [{
                id: 'challenge-security',
                title: 'Resolve unsafe token storage',
                detail: 'The current architecture stores credentials in plaintext.',
                severity: 'blocker',
                actionLabel: 'Open challenge finding',
            }],
        });
        render(<ReadinessCheckpoint review={review} {...props} />);

        fireEvent.click(screen.getByRole('button', { name: 'Commit with open questions' }));
        fireEvent.change(screen.getByLabelText('Why proceed now?'), {
            target: { value: 'A time-boxed prototype is needed for a user study.' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Commit with 1 open item' }));
        expect(screen.getByText(/build blocker requires a concrete containment plan/i)).toBeInTheDocument();
        expect(props.onCommitWithOpenQuestions).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('How will the implementation risk be contained?'), {
            target: { value: 'Use synthetic credentials only and prohibit any production deployment.' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Commit with 1 open item' }));
        expect(props.onCommitWithOpenQuestions).toHaveBeenCalledWith({
            rationale: 'A time-boxed prototype is needed for a user study.',
            containment: 'Use synthetic credentials only and prohibit any production deployment.',
        });
    });

    it('commits a ready exact checkpoint without asking for an override rationale', () => {
        const props = callbacks();
        render(<ReadinessCheckpoint review={baseReview({
            conclusion: 'ready_to_build',
            concerns: [],
            criteria: [{
                id: 'challenge', label: 'Current plan challenged', status: 'met',
                explanation: 'The current plan has no unresolved required finding.', evidence: [],
            }],
        })} {...props} />);

        expect(screen.getByText('Ready to build')).toBeInTheDocument();
        const commit = screen.getByRole('button', { name: 'Commit plan' });
        expect(commit).toHaveClass('min-h-11', 'w-full');
        fireEvent.click(commit);
        expect(props.onCommitReady).toHaveBeenCalledTimes(1);
        expect(screen.queryByLabelText('Why proceed now?')).toBeNull();
    });

    it('keeps historical rationale inspectable without mutable actions', () => {
        const props = callbacks();
        render(<ReadinessCheckpoint
            review={baseReview({
                isCurrent: false,
                currentnessReasons: ['The planning decisions changed.'],
                commitment: {
                    kind: 'with_open_questions',
                    committedAt: 1_720_000_100_000,
                    rationale: 'We committed a contained prototype to test the riskiest workflow.',
                    containment: 'No production data will be used during the prototype.',
                    acceptedConcernCount: 1,
                },
            })}
            readOnly
            {...props}
        />);

        expect(screen.getByText('Committed with open questions')).toBeInTheDocument();
        expect(screen.getByText(/The planning decisions changed/)).toBeInTheDocument();
        expect(screen.getByText(/committed a contained prototype/i)).toBeInTheDocument();
        expect(screen.getByText(/No production data/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Commit with open questions' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Resolve in Decision Center' })).toBeNull();
    });

    it('recovers from an obsolete checkpoint by offering a fresh review', () => {
        const props = callbacks();
        render(<ReadinessCheckpoint
            review={baseReview({ isCurrent: false, currentnessReasons: ['The PRD content changed.'] })}
            submitError="Review the current plan before committing."
            {...props}
        />);

        expect(screen.getByRole('alert')).toHaveTextContent(/plan changed before commitment/i);
        expect(screen.queryByRole('button', { name: 'Commit with open questions' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Review current plan' }));
        expect(props.onRefresh).toHaveBeenCalledTimes(1);
    });
});
