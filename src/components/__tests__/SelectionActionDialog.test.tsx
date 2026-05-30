import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SelectionActionDialog } from '../SelectionActionDialog';
import type { SelectionInfo } from '../../lib/selectionPopover';

const selection: SelectionInfo = {
    text: 'a highlighted PRD phrase',
    rect: { top: 100, bottom: 120, left: 200, width: 120, height: 20 },
};

function mockMatchMedia(matches: boolean) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof SelectionActionDialog>> = {}) {
    const props = {
        selection,
        intent: '',
        setIntent: vi.fn(),
        isSubmitting: false,
        onSubmit: vi.fn((e: React.FormEvent) => e.preventDefault()),
        onQuickAction: vi.fn(),
        onDismiss: vi.fn(),
        ...overrides,
    };
    return { props, ...render(<SelectionActionDialog {...props} />) };
}

afterEach(() => {
    // @ts-expect-error allow removing the stub between tests
    delete window.matchMedia;
    vi.restoreAllMocks();
});

describe('SelectionActionDialog — desktop', () => {
    it('renders the action chips and the anchor preview', () => {
        mockMatchMedia(false);
        renderDialog();
        expect(screen.getByText(/a highlighted PRD phrase/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Clarify' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument();
        // No bottom-sheet backdrop on desktop.
        expect(screen.queryByTestId('selection-dialog-backdrop')).not.toBeInTheDocument();
    });

    it('prefills the intent when a chip is clicked (does not create a branch)', () => {
        mockMatchMedia(false);
        const { props } = renderDialog();
        fireEvent.click(screen.getByRole('button', { name: 'Clarify' }));
        expect(props.setIntent).toHaveBeenCalledWith('Clarify: ');
        expect(props.onQuickAction).not.toHaveBeenCalled();
    });

    it('submits the typed intent via the form', () => {
        mockMatchMedia(false);
        const { props } = renderDialog({ intent: 'Clarify: make it precise' });
        fireEvent.click(screen.getByRole('button', { name: 'Branch' }));
        expect(props.onSubmit).toHaveBeenCalled();
    });
});

describe('SelectionActionDialog — mobile', () => {
    it('renders a bottom sheet with a dismissable backdrop', () => {
        mockMatchMedia(true);
        const { props } = renderDialog();
        const backdrop = screen.getByTestId('selection-dialog-backdrop');
        expect(backdrop).toBeInTheDocument();
        fireEvent.pointerDown(backdrop);
        expect(props.onDismiss).toHaveBeenCalled();
    });

    it('creates a branch in one tap when a chip is clicked', () => {
        mockMatchMedia(true);
        const { props } = renderDialog();
        fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
        expect(props.onQuickAction).toHaveBeenCalledWith('Expand');
        // Mobile chips do not just prefill.
        expect(props.setIntent).not.toHaveBeenCalled();
    });
});
