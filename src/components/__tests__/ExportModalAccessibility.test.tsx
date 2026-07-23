import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { WorkflowCheckpointSummary } from '../../lib/workflowCheckpointSummary';
import { ExportModal } from '../ExportModal';

const checkpointSummary: WorkflowCheckpointSummary = {
    context: 'export',
    headline: 'Export checkpoint — no generated outputs',
    supportingText: 'The current plan remains the source of truth.',
    planningVerdict: { kind: 'working_plan', label: 'Working plan' },
    counts: {
        totalArtifacts: 0,
        readyArtifacts: 0,
        rowCount: 0,
        attentionSignals: 0,
        advisorySignals: 0,
    },
    rows: [],
};

function Harness() {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>Open export</button>
            {open && (
                <ExportModal
                    projectId="missing-project"
                    checkpointSummary={checkpointSummary}
                    onClose={() => setOpen(false)}
                />
            )}
        </>
    );
}

describe('ExportModal accessibility', () => {
    it('labels and contains the dialog, then restores focus on Escape', async () => {
        render(<Harness />);
        const opener = screen.getByRole('button', { name: 'Open export' });
        opener.focus();
        fireEvent.click(opener);

        const dialog = screen.getByRole('dialog', { name: 'Export Project' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        const close = screen.getByRole('button', { name: 'Close export dialog' });
        await waitFor(() => expect(close).toHaveFocus());
        expect(close).toHaveClass('min-h-11', 'min-w-11');

        const focusable = dialog.querySelectorAll<HTMLElement>('button:not([disabled])');
        const last = focusable[focusable.length - 1];
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(last).toHaveFocus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(close).toHaveFocus();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await waitFor(() => expect(opener).toHaveFocus());
    });
});
