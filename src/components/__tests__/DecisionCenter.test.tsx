import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DecisionCenter, type DecisionCenterRecordView } from '../review/DecisionCenter';

const openRecord: DecisionCenterRecordView = {
    id: 'd1', type: 'assumption', title: 'Should guests start without an account?',
    statement: 'Guests can begin without an account',
    whyItMatters: 'This affects onboarding and persistence.', status: 'open',
    options: [
        { id: 'guest', label: 'Allow a limited guest session', tradeoffs: [{ kind: 'benefit', summary: 'Lower activation friction' }] },
        { id: 'account', label: 'Require an account first', tradeoffs: [{ kind: 'cost', summary: 'Higher onboarding friction' }] },
    ],
    recommendation: { optionId: 'guest', summary: 'Allow a limited guest session', rationale: 'It preserves a low-friction first experience.' },
    sourceLabels: ['PRD assumption'], createdAt: 1,
    history: [{ id: 'import', label: 'imported', at: 1 }],
};

const callbacks = () => ({
    onDecide: vi.fn(),
    onPreviewImpact: vi.fn(),
    onApplyToPlan: vi.fn(),
});

describe('DecisionCenter', () => {
    it('shows a calm queue/detail layout with recommendation distinct from user actions', () => {
        const props = callbacks();
        render(<DecisionCenter records={[openRecord]} {...props} />);
        expect(screen.getByLabelText('Decision queue')).toBeInTheDocument();
        expect(screen.getByLabelText('Decision detail')).toBeInTheDocument();
        expect(screen.getByText('Synapse recommendation')).toBeInTheDocument();
        expect(screen.getByText('1 needs review')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Allow a limited guest session/ }));
        expect(props.onDecide).toHaveBeenCalledWith('d1', 'confirm', 'guest', undefined);
    });

    it('requires a correction before rejecting a premise', () => {
        const props = callbacks();
        render(<DecisionCenter records={[openRecord]} {...props} />);
        const reject = screen.getByRole('button', { name: /Reject premise/ });
        expect(reject).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'Guests may browse but must sign in before saving' } });
        expect(reject).toBeEnabled();
        fireEvent.click(reject);
        expect(props.onDecide).toHaveBeenCalledWith('d1', 'reject', 'Guests may browse but must sign in before saving', undefined);
    });

    it('shows impact before apply and never applies from a stale preview', () => {
        const props = callbacks();
        const ready: DecisionCenterRecordView = {
            ...openRecord, status: 'confirmed', resolution: 'Allow a limited guest session',
            preview: {
                id: 'preview', status: 'ready', affectedPrdSections: ['Assumptions'],
                affectedArtifactLabels: ['screen inventory', 'implementation plan'],
                beforeSummary: openRecord.statement, afterSummary: 'Confirmed — limited guest session',
                canApply: true,
            },
        };
        const { rerender } = render(<DecisionCenter records={[ready]} {...props} />);
        fireEvent.click(screen.getByRole('button', { name: 'Apply to plan' }));
        expect(props.onApplyToPlan).toHaveBeenCalledWith('d1');

        rerender(<DecisionCenter records={[{ ...ready, preview: { ...ready.preview!, status: 'stale' } }]} {...props} />);
        expect(screen.queryByRole('button', { name: 'Apply to plan' })).toBeNull();
        const previewSection = screen.getByText(/Impact preview/).closest('section')!;
        fireEvent.click(within(previewSection).getByRole('button', { name: /Refresh preview/ }));
        expect(props.onPreviewImpact).toHaveBeenCalledWith('d1');
    });

    it('renders an explicit completed state and decision log', () => {
        render(<DecisionCenter records={[{ ...openRecord, status: 'confirmed', resolution: 'Confirmed' }]} {...callbacks()} />);
        expect(screen.getByText('All current decisions reviewed')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Decision log' }));
        expect(screen.getByRole('button', { name: /Should guests start/ })).toBeInTheDocument();
    });

    it('lets a user explicitly revise or invalidate a recorded decision', () => {
        const props = callbacks();
        render(<DecisionCenter records={[{ ...openRecord, status: 'confirmed', resolution: 'Confirmed' }]} {...props} />);
        const revision = screen.getByLabelText('Revise or invalidate');
        fireEvent.change(revision, { target: { value: 'Require sign-in before the first save' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save revision' }));
        expect(props.onDecide).toHaveBeenCalledWith('d1', 'revise', 'Require sign-in before the first save', undefined);
        fireEvent.change(revision, { target: { value: 'The onboarding flow was removed' } });
        fireEvent.click(screen.getByRole('button', { name: 'Mark no longer valid' }));
        expect(props.onDecide).toHaveBeenCalledWith('d1', 'invalidate', 'The onboarding flow was removed', undefined);
    });
});
