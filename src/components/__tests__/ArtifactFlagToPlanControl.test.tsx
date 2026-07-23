import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FlagPlanningConcernResult } from '../../lib/planning/flagToPlan';
import { ArtifactFlagToPlanControl } from '../planning/ArtifactFlagToPlanControl';

const createdResult: FlagPlanningConcernResult = {
    status: 'created',
    planningRecordId: 'planning-created',
};

function fillConcern() {
    fireEvent.change(screen.getByLabelText('Concern title'), {
        target: { value: '  Ownership is unclear  ' },
    });
    fireEvent.change(screen.getByLabelText('What should the plan address?'), {
        target: { value: '  The owner relationship has no deletion rule.  ' },
    });
}

function expectMinimumTouchTargets(container: ParentNode) {
    const controls = container.querySelectorAll<HTMLElement>('button, input, textarea');
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
        expect(control).toHaveClass('min-h-11');
    }
}

describe('ArtifactFlagToPlanControl', () => {
    it('opens a labeled modal, focuses the title, validates whitespace, and focuses created actions', async () => {
        const onCreate = vi.fn((): FlagPlanningConcernResult => createdResult);
        render(
            <ArtifactFlagToPlanControl
                artifactTitle="Data Model"
                onCreate={onCreate}
                onReviewNow={vi.fn()}
            />,
        );

        const trigger = screen.getByRole('button', { name: 'Flag Data Model to plan' });
        expect(trigger).toHaveClass('min-h-11');
        fireEvent.click(trigger);

        const dialog = screen.getByRole('dialog');
        const heading = screen.getByRole('heading', { name: 'Flag Data Model to plan' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAttribute('aria-labelledby', heading.id);
        expect(screen.getByLabelText('Concern title')).toHaveFocus();
        expect(dialog).toHaveClass('max-w-md');
        expect(dialog.parentElement).toHaveClass('items-end', 'sm:items-center');

        const addButton = screen.getByRole('button', { name: 'Add to plan' });
        expect(addButton).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Concern title'), {
            target: { value: '   ' },
        });
        fireEvent.change(screen.getByLabelText('What should the plan address?'), {
            target: { value: '\n\t ' },
        });
        expect(addButton).toBeDisabled();

        fillConcern();
        expect(addButton).toBeEnabled();
        expectMinimumTouchTargets(dialog);
        fireEvent.click(addButton);

        expect(onCreate).toHaveBeenCalledTimes(1);
        expect(onCreate).toHaveBeenCalledWith({
            title: 'Ownership is unclear',
            statement: 'The owner relationship has no deletion rule.',
        });
        const status = screen.getByRole('status');
        expect(status).toHaveAttribute('aria-live', 'polite');
        expect(status).toHaveTextContent('Added to plan');
        expect(screen.queryByRole('button', { name: 'Add to plan' })).toBeNull();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Keep reviewing' })).toHaveFocus());
        expectMinimumTouchTargets(dialog);
    });

    it('reports an existing record, reviews its exact id, and closes back to the trigger', async () => {
        const onCreate = vi.fn((): FlagPlanningConcernResult => ({
            status: 'existing',
            planningRecordId: 'planning-existing',
        }));
        const onReviewNow = vi.fn();
        render(
            <ArtifactFlagToPlanControl
                artifactTitle="Data Model"
                onCreate={onCreate}
                onReviewNow={onReviewNow}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Flag Data Model to plan' }));
        fillConcern();
        fireEvent.click(screen.getByRole('button', { name: 'Add to plan' }));

        expect(screen.getByRole('status')).toHaveTextContent('Already in plan');
        const actions = screen.getByRole('button', { name: 'Keep reviewing' }).parentElement;
        expect(actions).toHaveClass('flex-col', 'sm:flex-row');
        expect(screen.getByRole('button', { name: 'Keep reviewing' }))
            .toHaveClass('min-h-11', 'w-full', 'sm:w-auto');
        expect(screen.getByRole('button', { name: 'Review now' }))
            .toHaveClass('min-h-11', 'w-full', 'sm:w-auto');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Keep reviewing' })).toHaveFocus());

        fireEvent.click(screen.getByRole('button', { name: 'Review now' }));
        expect(onReviewNow).toHaveBeenCalledWith('planning-existing');

        const trigger = screen.getByRole('button', { name: 'Flag Data Model to plan' });
        fireEvent.click(screen.getByRole('button', { name: 'Keep reviewing' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(trigger).toHaveFocus();

        fireEvent.click(trigger);
        expect(screen.getByLabelText('Concern title')).toHaveValue('');
        expect(screen.getByLabelText('What should the plan address?')).toHaveValue('');
    });

    it('keeps a changed-source rejection editable and allows a retry without Review now', () => {
        const onCreate = vi.fn()
            .mockReturnValueOnce({
                status: 'rejected',
                reason: 'source_changed',
            } satisfies FlagPlanningConcernResult)
            .mockReturnValueOnce(createdResult);
        render(
            <ArtifactFlagToPlanControl
                artifactTitle="Data Model"
                onCreate={onCreate}
                onReviewNow={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Flag Data Model to plan' }));
        fillConcern();
        fireEvent.click(screen.getByRole('button', { name: 'Add to plan' }));

        expect(screen.getByRole('alert')).toHaveTextContent(/artifact changed/i);
        expect(screen.getByLabelText('Concern title')).toHaveValue('  Ownership is unclear  ');
        expect(screen.getByLabelText('What should the plan address?')).toHaveValue(
            '  The owner relationship has no deletion rule.  ',
        );
        expect(screen.queryByRole('button', { name: 'Review now' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Add to plan' })).toBeEnabled();

        fireEvent.click(screen.getByRole('button', { name: 'Add to plan' }));
        expect(onCreate).toHaveBeenCalledTimes(2);
        expect(screen.getByRole('status')).toHaveTextContent('Added to plan');
    });

    it.each(['source_not_found', 'spine_not_found'] as const)(
        'keeps the form and reports unavailable source data for %s',
        (reason) => {
            render(
                <ArtifactFlagToPlanControl
                    artifactTitle="Data Model"
                    onCreate={() => ({ status: 'rejected', reason })}
                    onReviewNow={vi.fn()}
                />,
            );

            fireEvent.click(screen.getByRole('button', { name: 'Flag Data Model to plan' }));
            fillConcern();
            fireEvent.click(screen.getByRole('button', { name: 'Add to plan' }));

            expect(screen.getByRole('alert')).toHaveTextContent(/artifact source is no longer available/i);
            expect(screen.getByRole('button', { name: 'Add to plan' })).toBeEnabled();
            expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
            expect(screen.queryByRole('button', { name: 'Review now' })).toBeNull();
        },
    );

    it('preserves the form and allows retry when the create callback throws', () => {
        const onCreate = vi.fn()
            .mockImplementationOnce(() => {
                throw new Error('Sensitive capability details must not escape.');
            })
            .mockReturnValueOnce(createdResult);
        render(
            <ArtifactFlagToPlanControl
                artifactTitle="Data Model"
                onCreate={onCreate}
                onReviewNow={vi.fn()}
            />,
        );

        const trigger = screen.getByRole('button', { name: 'Flag Data Model to plan' });
        fireEvent.click(trigger);
        fillConcern();
        fireEvent.click(screen.getByRole('button', { name: 'Add to plan' }));

        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent(/couldn't add this concern to the plan/i);
        expect(alert).toHaveTextContent(/try again/i);
        expect(alert).not.toHaveTextContent(/sensitive capability details/i);
        expect(screen.getByLabelText('Concern title')).toHaveValue('  Ownership is unclear  ');
        expect(screen.getByLabelText('What should the plan address?')).toHaveValue(
            '  The owner relationship has no deletion rule.  ',
        );
        expect(screen.getByRole('button', { name: 'Add to plan' })).toBeEnabled();
        expect(screen.queryByRole('status')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Review now' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        fireEvent.click(trigger);
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByLabelText('Concern title')).toHaveValue('  Ownership is unclear  ');

        fireEvent.click(screen.getByRole('button', { name: 'Add to plan' }));
        expect(onCreate).toHaveBeenCalledTimes(2);
        expect(screen.getByRole('status')).toHaveTextContent('Added to plan');
    });

    it('omits Review now and describes only available actions without planning navigation', async () => {
        render(
            <ArtifactFlagToPlanControl
                artifactTitle="Data Model"
                onCreate={() => createdResult}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Flag Data Model to plan' }));
        fillConcern();
        fireEvent.click(screen.getByRole('button', { name: 'Add to plan' }));

        expect(screen.getByRole('status')).toHaveTextContent('You can keep reviewing this artifact.');
        expect(screen.getByRole('status')).not.toHaveTextContent(/open the planning record now/i);
        expect(screen.getByRole('button', { name: 'Keep reviewing' })).toBeEnabled();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Keep reviewing' })).toHaveFocus());
        expect(screen.queryByRole('button', { name: 'Review now' })).toBeNull();
    });

    it('contains Tab focus inside enabled controls and excludes a disabled submit action', () => {
        render(
            <ArtifactFlagToPlanControl
                artifactTitle="Data Model"
                onCreate={() => createdResult}
                onReviewNow={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Flag Data Model to plan' }));
        const closeButton = screen.getByRole('button', { name: 'Close' });
        const statement = screen.getByLabelText('What should the plan address?');

        closeButton.focus();
        fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
        expect(statement).toHaveFocus();

        statement.focus();
        fireEvent.keyDown(window, { key: 'Tab' });
        expect(closeButton).toHaveFocus();

        fillConcern();
        const addButton = screen.getByRole('button', { name: 'Add to plan' });
        addButton.focus();
        fireEvent.keyDown(window, { key: 'Tab' });
        expect(closeButton).toHaveFocus();
    });

    it('closes only from the backdrop or Escape and restores trigger focus', async () => {
        render(
            <ArtifactFlagToPlanControl
                artifactTitle="Data Model"
                onCreate={() => createdResult}
                onReviewNow={vi.fn()}
            />,
        );
        const trigger = screen.getByRole('button', { name: 'Flag Data Model to plan' });

        fireEvent.click(trigger);
        const dialog = screen.getByRole('dialog');
        const backdrop = dialog.parentElement as HTMLElement;
        fireEvent.mouseDown(dialog);
        expect(screen.getByRole('dialog')).toBeTruthy();

        fireEvent.mouseDown(backdrop);
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(trigger).toHaveFocus();

        fireEvent.click(trigger);
        fireEvent.keyDown(window, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(trigger).toHaveFocus();
    });
});
