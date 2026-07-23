import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ScreenReviewIssue } from '../../lib/screenReviewWorkflow';
import type { FlagPlanningConcernResult } from '../../lib/planning/flagToPlan';
import {
    ScreenReviewNotes,
    type ScreenNotePlanningRequest,
} from '../experience/ScreenReviewNotes';

const blockingIssue: ScreenReviewIssue = {
    id: 'note-1',
    severity: 'blocking',
    category: 'navigation',
    title: 'Recovery path is missing',
    description: 'The error state cannot return to checkout.',
};

const reviewIssue: ScreenReviewIssue = {
    id: 'note-2',
    severity: 'review',
    category: 'states',
    title: 'Loading behavior needs detail',
    description: 'The loading state does not explain what remains interactive.',
};

const baseProps = {
    issues: [blockingIssue, reviewIssue],
    risks: [],
    dismissed: new Set<string>(),
    riskResolutions: {},
    onDismissIssue: vi.fn(),
    onResolveRisk: vi.fn(),
    onNavigate: vi.fn(),
    onEdit: vi.fn(),
};

function openReviewNotes() {
    fireEvent.click(screen.getByRole('button', { name: /Review notes/i }));
}

function noteRow(title: string): HTMLLIElement {
    const row = screen.getByText(title).closest('li');
    expect(row).not.toBeNull();
    return row as HTMLLIElement;
}

describe('ScreenReviewNotes Flag to plan', () => {
    it('flags a blocking note, scopes the result to that note, and restores trigger focus', async () => {
        const onFlagToPlan = vi.fn((): FlagPlanningConcernResult => ({
            status: 'created',
            planningRecordId: 'planning-1',
        }));
        render(<ScreenReviewNotes {...baseProps} onFlagToPlan={onFlagToPlan} />);

        openReviewNotes();
        const note = noteRow('Recovery path is missing');
        const otherNote = noteRow('Loading behavior needs detail');
        const trigger = within(note).getByRole('button', { name: 'Flag to plan' });
        fireEvent.click(trigger);

        expect(onFlagToPlan).toHaveBeenCalledWith({
            noteId: 'note-1',
            title: 'Recovery path is missing',
            statement: 'The error state cannot return to checkout.',
            materiality: 'blocking',
        });
        expect(within(note).getByRole('status')).toHaveTextContent('Added to the plan');
        expect(within(note).getByRole('button', { name: 'Flag to plan' })).toBeDisabled();
        expect(within(otherNote).queryByRole('status')).toBeNull();

        fireEvent.click(within(note).getByRole('button', { name: 'Keep reviewing' }));
        await waitFor(() => expect(trigger).toHaveFocus());
        expect(within(note).queryByRole('status')).toBeNull();
    });

    it('reports an existing record and reviews that exact record', () => {
        const onFlagToPlan = vi.fn((): FlagPlanningConcernResult => ({
            status: 'existing',
            planningRecordId: 'planning-existing',
        }));
        const onReviewPlanningRecord = vi.fn();
        render(
            <ScreenReviewNotes
                {...baseProps}
                onFlagToPlan={onFlagToPlan}
                onReviewPlanningRecord={onReviewPlanningRecord}
            />,
        );

        openReviewNotes();
        const note = noteRow('Recovery path is missing');
        fireEvent.click(within(note).getByRole('button', { name: 'Flag to plan' }));

        expect(within(note).getByRole('status')).toHaveTextContent('Already in the plan');
        fireEvent.click(within(note).getByRole('button', { name: 'Review now' }));
        expect(onReviewPlanningRecord).toHaveBeenCalledWith('planning-existing');
    });

    it('preserves independent results while dismissing one note', async () => {
        const onFlagToPlan = (
            request: ScreenNotePlanningRequest,
        ): FlagPlanningConcernResult => (
            request.noteId === 'note-1'
                ? { status: 'created', planningRecordId: 'planning-created' }
                : { status: 'existing', planningRecordId: 'planning-existing' }
        );
        render(<ScreenReviewNotes {...baseProps} onFlagToPlan={onFlagToPlan} />);

        openReviewNotes();
        const createdNote = noteRow('Recovery path is missing');
        const existingNote = noteRow('Loading behavior needs detail');
        const createdTrigger = within(createdNote).getByRole('button', { name: 'Flag to plan' });
        fireEvent.click(createdTrigger);
        fireEvent.click(within(existingNote).getByRole('button', { name: 'Flag to plan' }));

        expect(within(createdNote).getByRole('status')).toHaveTextContent('Added to the plan');
        expect(within(existingNote).getByRole('status')).toHaveTextContent('Already in the plan');

        fireEvent.click(within(createdNote).getByRole('button', { name: 'Keep reviewing' }));
        await waitFor(() => expect(createdTrigger).toHaveFocus());
        expect(within(createdNote).queryByRole('status')).toBeNull();
        expect(within(existingNote).getByRole('status')).toHaveTextContent('Already in the plan');
    });

    it('announces a changed source without offering Review now', () => {
        const onFlagToPlan = vi.fn((): FlagPlanningConcernResult => ({
            status: 'rejected',
            reason: 'source_changed',
        }));
        render(
            <ScreenReviewNotes
                {...baseProps}
                onFlagToPlan={onFlagToPlan}
                onReviewPlanningRecord={vi.fn()}
            />,
        );

        openReviewNotes();
        const note = noteRow('Recovery path is missing');
        fireEvent.click(within(note).getByRole('button', { name: 'Flag to plan' }));

        expect(within(note).getByRole('alert')).toHaveTextContent(/screen source changed/i);
        expect(within(note).queryByRole('button', { name: 'Review now' })).toBeNull();
    });

    it.each(['source_not_found', 'spine_not_found'] as const)(
        'announces an unavailable source for a %s rejection',
        (reason) => {
            const onFlagToPlan = vi.fn((): FlagPlanningConcernResult => ({
                status: 'rejected',
                reason,
            }));
            render(<ScreenReviewNotes {...baseProps} onFlagToPlan={onFlagToPlan} />);

            openReviewNotes();
            const note = noteRow('Recovery path is missing');
            fireEvent.click(within(note).getByRole('button', { name: 'Flag to plan' }));

            expect(within(note).getByRole('alert')).toHaveTextContent(
                'This screen source is no longer available.',
            );
            expect(within(note).queryByRole('button', { name: 'Review now' })).toBeNull();
        },
    );

    it('does not render Flag to plan without a writable planning callback', () => {
        const { rerender } = render(<ScreenReviewNotes {...baseProps} />);
        openReviewNotes();
        expect(screen.queryByRole('button', { name: 'Flag to plan' })).toBeNull();

        rerender(
            <ScreenReviewNotes
                {...baseProps}
                readOnly
                onFlagToPlan={() => ({ status: 'created', planningRecordId: 'planning-1' })}
            />,
        );
        expect(screen.queryByRole('button', { name: 'Flag to plan' })).toBeNull();
    });
});
