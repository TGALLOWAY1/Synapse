import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { VersionHistoryPanel, VersionCompareView, type VersionEntry } from '../versions';

const ENTRIES: VersionEntry[] = [
    { id: 'v2', label: 'Version 2', isCurrent: true, createdAt: 2_000 },
    { id: 'v1', label: 'Version 1', isCurrent: false, createdAt: 1_000 },
];

function renderPanel(overrides: { onRestore?: (id: string) => void } = {}) {
    const onClose = vi.fn();
    const onRestore = overrides.onRestore ?? vi.fn();
    render(
        <VersionHistoryPanel
            title="Output version history"
            entries={ENTRIES}
            restoreKind="artifact"
            getCompareInput={() => ({ kind: 'text', before: 'old text', after: 'new text' })}
            onRestore={onRestore}
            onClose={onClose}
        />,
    );
    return { onClose, onRestore };
}

const escape = () => fireEvent.keyDown(document.body, { key: 'Escape' });

describe('VersionHistoryPanel Escape handling', () => {
    it('closes the panel on Escape', () => {
        const { onClose } = renderPanel();

        escape();

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes only the compare view when it is open over the panel', () => {
        const { onClose } = renderPanel();

        fireEvent.click(screen.getByRole('button', { name: /Compare/ }));
        expect(screen.getByText('Compare versions')).toBeTruthy();

        escape();

        expect(screen.queryByText('Compare versions')).toBeNull();
        // The panel underneath is still open and still responds.
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByText('Output version history')).toBeTruthy();

        escape();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('cancels the restore confirmation first, without restoring or closing the panel', () => {
        const { onClose, onRestore } = renderPanel();

        fireEvent.click(screen.getByRole('button', { name: /Restore/ }));
        expect(screen.getByText('Restore this version?')).toBeTruthy();

        escape();

        expect(screen.queryByText('Restore this version?')).toBeNull();
        expect(onRestore).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('unwinds panel -> compare -> restore confirmation one layer per keypress', () => {
        const { onClose, onRestore } = renderPanel();

        fireEvent.click(screen.getByRole('button', { name: /Compare/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
        expect(screen.getByText('Restore this version?')).toBeTruthy();

        escape();
        expect(screen.queryByText('Restore this version?')).toBeNull();
        expect(screen.getByText('Compare versions')).toBeTruthy();

        escape();
        expect(screen.queryByText('Compare versions')).toBeNull();
        expect(onClose).not.toHaveBeenCalled();

        escape();
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onRestore).not.toHaveBeenCalled();
    });
});

describe('VersionCompareView Escape handling', () => {
    it('closes on Escape when used on its own (the banner "Compare with current" path)', () => {
        const onClose = vi.fn();
        render(
            <VersionCompareView
                input={{ kind: 'text', before: 'a', after: 'b' }}
                fromLabel="Version 1"
                toLabel="Current"
                onClose={onClose}
            />,
        );

        escape();

        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
