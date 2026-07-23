import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DecisionCenterSlideOver } from '../review/DecisionCenterSlideOver';

vi.mock('../review/DecisionCenterContainer', () => ({
    DecisionCenterContainer: ({
        projectId,
        initialRecordId,
    }: {
        projectId: string;
        initialRecordId?: string;
    }) => (
        <button
            type="button"
            data-testid="decision-center-container"
            data-project-id={projectId}
            data-record-id={initialRecordId}
        >
            Inner action
        </button>
    ),
}));

function Harness({ onClose = () => undefined }: { onClose?: () => void }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>Open decisions</button>
            <DecisionCenterSlideOver
                open={open}
                projectId="project-1"
                initialRecordId="record-7"
                onClose={() => {
                    onClose();
                    setOpen(false);
                }}
            />
        </>
    );
}

describe('DecisionCenterSlideOver', () => {
    it('opens as a labelled modal layer and forwards exact record selection', () => {
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Open decisions' }));

        expect(screen.getByRole('dialog', { name: 'Decision Center' })).toBeInTheDocument();
        expect(screen.getByTestId('decision-center-container')).toHaveAttribute(
            'data-project-id',
            'project-1',
        );
        expect(screen.getByTestId('decision-center-container')).toHaveAttribute(
            'data-record-id',
            'record-7',
        );
        expect(screen.getByRole('button', { name: 'Close Decision Center' })).toHaveFocus();
        expect(document.body).toHaveStyle({ overflow: 'hidden' });
    });

    it('closes with Escape and restores focus to the originating control', () => {
        const onClose = vi.fn();
        render(<Harness onClose={onClose} />);
        const trigger = screen.getByRole('button', { name: 'Open decisions' });
        trigger.focus();
        fireEvent.click(trigger);

        fireEvent.keyDown(window, { key: 'Escape' });

        expect(onClose).toHaveBeenCalledOnce();
        expect(screen.queryByRole('dialog', { name: 'Decision Center' })).toBeNull();
        expect(trigger).toHaveFocus();
        expect(document.body).not.toHaveStyle({ overflow: 'hidden' });
    });

    it('wraps keyboard focus inside the panel', () => {
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Open decisions' }));
        const close = screen.getByRole('button', { name: 'Close Decision Center' });
        const inner = screen.getByRole('button', { name: 'Inner action' });

        inner.focus();
        fireEvent.keyDown(window, { key: 'Tab' });
        expect(close).toHaveFocus();

        close.focus();
        fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
        expect(inner).toHaveFocus();
    });
});
