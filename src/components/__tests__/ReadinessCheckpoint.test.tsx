import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    integrityValid: true,
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
    it('keeps advisory items actionable without making them a finalization gate', () => {
        const props = callbacks();
        render(<ReadinessCheckpoint review={baseReview()} {...props} />);

        const action = screen.getByRole('button', { name: 'Resolve in Decision Center' });
        fireEvent.click(action);
        expect(props.onAddressConcern).toHaveBeenCalledWith('decision-auth');

        fireEvent.click(screen.getByRole('button', { name: 'Finalize plan' }));
        expect(props.onCommitReady).toHaveBeenCalledTimes(1);
        expect(screen.queryByLabelText('Why proceed now?')).not.toBeInTheDocument();
    });

    it('requires meaningful user rationale before accepting an explicit materiality blocker', () => {
        const props = callbacks();
        render(<ReadinessCheckpoint review={baseReview({
            hardBlockerCount: 1,
            concerns: [{
                ...baseReview().concerns[0],
                severity: 'blocker',
                hardBlocking: true,
            }],
        })} {...props} />);

        fireEvent.click(screen.getByRole('button', { name: 'Finalize with accepted risk' }));
        fireEvent.change(screen.getByLabelText('Why proceed now?'), { target: { value: 'Too short' } });
        fireEvent.click(screen.getByRole('button', { name: 'Finalize with 1 accepted blocker' }));
        expect(screen.getByText(/meaningful rationale of at least 20 characters/i)).toBeInTheDocument();
        expect(props.onCommitWithOpenQuestions).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('Why proceed now?'), {
            target: { value: 'We need a prototype to validate demand before deciding.' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Finalize with 1 accepted blocker' }));
        expect(props.onCommitWithOpenQuestions).toHaveBeenCalledWith({
            rationale: 'We need a prototype to validate demand before deciding.',
        });
    });

    it('does not promote a broad analytical blocker into a materiality hard stop', () => {
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

        expect(screen.queryByRole('button', { name: 'Finalize with accepted risk' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Finalize plan' }));
        expect(props.onCommitReady).toHaveBeenCalledTimes(1);
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

        expect(screen.getByText('Ready to finalize')).toBeInTheDocument();
        const commit = screen.getByRole('button', { name: 'Finalize plan' });
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

        expect(screen.getByText('Previously proceeded with accepted risk')).toBeInTheDocument();
        expect(screen.getByText(/The planning decisions changed/)).toBeInTheDocument();
        expect(screen.getByText(/committed a contained prototype/i)).toBeInTheDocument();
        expect(screen.getByText(/No production data/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Finalize with accepted risk' })).toBeNull();
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
        expect(screen.queryByRole('button', { name: 'Finalize with accepted risk' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Review current plan' }));
        expect(props.onRefresh).toHaveBeenCalledTimes(1);
    });

    it('labels an integrity-invalid checkpoint as unverifiable and suppresses commitment claims', () => {
        const props = callbacks();
        render(<ReadinessCheckpoint review={baseReview({
            integrityValid: false,
            isCurrent: false,
            currentnessReasons: ['The stored checkpoint no longer matches its integrity signature.'],
            commitment: {
                kind: 'ready',
                committedAt: 100,
            },
        })} {...props} />);

        expect(screen.getByRole('heading', { name: 'Needs a fresh review' })).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent(/needs a fresh review/i);
        expect(screen.queryByText('Plan committed')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Finalize plan' })).toBeNull();
    });

    it('shows a reopened checkpoint as recommittable instead of actively committed', () => {
        const props = callbacks();
        render(<ReadinessCheckpoint review={baseReview({
            priorCommitment: {
                kind: 'with_open_questions',
                committedAt: 100,
                reopenedAt: 200,
                rationale: 'We previously proceeded with a contained prototype.',
            },
        })} {...props} />);

        expect(screen.getByText('Previously committed, then reopened')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Ready to finalize' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Finalize plan' })).toBeInTheDocument();
    });

    it('moves focus to the mobile override rationale when the form is revealed', async () => {
        const props = callbacks();
        render(<ReadinessCheckpoint review={baseReview({
            hardBlockerCount: 1,
            concerns: [{ ...baseReview().concerns[0], hardBlocking: true }],
        })} {...props} />);
        fireEvent.click(screen.getByRole('button', { name: 'Finalize with accepted risk' }));
        await waitFor(() => expect(screen.getByLabelText('Why proceed now?')).toHaveFocus());
    });

    it('contains focus, closes on Escape, and restores the triggering focus', async () => {
        const props = callbacks();
        const trigger = document.createElement('button');
        document.body.append(trigger);
        trigger.focus();
        const rendered = render(<ReadinessCheckpoint review={baseReview()} {...props} />);

        const close = screen.getByRole('button', { name: 'Close readiness review' });
        await waitFor(() => expect(close).toHaveFocus());
        fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
        expect(screen.getByRole('button', { name: 'Finalize plan' })).toHaveFocus();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(props.onClose).toHaveBeenCalledTimes(1);

        rendered.unmount();
        expect(trigger).toHaveFocus();
        trigger.remove();
    });
});
