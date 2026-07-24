import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { HistoryPanel } from '../HistoryPanel';

vi.mock('../HistoryView', () => ({
    HistoryView: ({
        projectId,
        showHeader,
    }: {
        projectId: string;
        showHeader?: boolean;
    }) => (
        <button
            type="button"
            data-testid="history-view"
            data-project-id={projectId}
            data-show-header={String(showHeader)}
        >
            Inspect history item
        </button>
    ),
}));

function Harness() {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>Open project history</button>
            <HistoryPanel
                open={open}
                projectId="project-1"
                onClose={() => setOpen(false)}
            />
        </>
    );
}

describe('HistoryPanel', () => {
    it('presents project history as a panel without duplicating its header', () => {
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: 'Open project history' }));

        expect(screen.getByRole('dialog', { name: 'Project history' })).toBeInTheDocument();
        expect(screen.getByTestId('history-view')).toHaveAttribute(
            'data-project-id',
            'project-1',
        );
        expect(screen.getByTestId('history-view')).toHaveAttribute(
            'data-show-header',
            'false',
        );
        expect(screen.getByRole('button', { name: 'Close project history' })).toHaveFocus();
    });

    it('closes on backdrop interaction and restores trigger focus', () => {
        const { container } = render(<Harness />);
        const trigger = screen.getByRole('button', { name: 'Open project history' });
        trigger.focus();
        fireEvent.click(trigger);

        const presentation = container.querySelector('[role="presentation"]')!;
        fireEvent.mouseDown(presentation);

        expect(screen.queryByRole('dialog', { name: 'Project history' })).toBeNull();
        expect(trigger).toHaveFocus();
    });
});
