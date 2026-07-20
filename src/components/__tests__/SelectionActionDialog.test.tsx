import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SelectionActionDialog, SELECTION_ACTIONS } from '../SelectionActionDialog';
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
    vi.unstubAllGlobals();
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

    it('renders a multiline textarea for the intent', () => {
        mockMatchMedia(false);
        renderDialog({ intent: 'hi' });
        const box = screen.getByRole('textbox');
        expect(box.tagName).toBe('TEXTAREA');
        expect(box).toHaveValue('hi');
    });

    it('renders the five action chips in order', () => {
        mockMatchMedia(false);
        renderDialog();
        const chips = SELECTION_ACTIONS.map(tag => screen.getByRole('button', { name: tag }));
        expect(chips).toHaveLength(5);
        expect(SELECTION_ACTIONS).toEqual(['Clarify', 'Expand', 'Specify', 'Alternative', 'Replace']);
    });

    it('toggles aria-pressed on the chip matching the current intent', () => {
        mockMatchMedia(false);
        renderDialog({ intent: 'Expand: ' });
        expect(screen.getByRole('button', { name: 'Expand' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Clarify' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('submits on Enter and inserts a newline on Shift+Enter', () => {
        mockMatchMedia(false);
        const { props } = renderDialog({ intent: 'Clarify: x' });
        const box = screen.getByRole('textbox');

        fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
        expect(props.onSubmit).not.toHaveBeenCalled();

        fireEvent.keyDown(box, { key: 'Enter' });
        expect(props.onSubmit).toHaveBeenCalledTimes(1);
    });
});

describe('SelectionActionDialog — anchor highlight (CSS Custom Highlight API)', () => {
    class FakeHighlight {
        ranges: unknown[];
        constructor(...ranges: unknown[]) {
            this.ranges = ranges;
        }
    }

    it('registers the anchor highlight on mount and clears it on unmount', () => {
        mockMatchMedia(false);
        const highlights = new Map<string, unknown>();
        vi.stubGlobal('Highlight', FakeHighlight);
        vi.stubGlobal('CSS', { highlights });

        const range = {} as Range;
        const { unmount } = render(
            <SelectionActionDialog
                selection={{ ...selection, range }}
                intent=""
                setIntent={vi.fn()}
                isSubmitting={false}
                onSubmit={vi.fn((e: React.FormEvent) => e.preventDefault())}
                onQuickAction={vi.fn()}
                onDismiss={vi.fn()}
            />,
        );

        expect(highlights.has('prd-refine-anchor')).toBe(true);
        expect(highlights.get('prd-refine-anchor')).toBeInstanceOf(FakeHighlight);

        unmount();
        expect(highlights.has('prd-refine-anchor')).toBe(false);
    });

    it('falls back silently when the CSS Custom Highlight API is unavailable', () => {
        mockMatchMedia(false);
        // CSS present but without a highlights registry → feature detect fails.
        vi.stubGlobal('CSS', { supports: () => false });

        expect(() =>
            render(
                <SelectionActionDialog
                    selection={{ ...selection, range: {} as Range }}
                    intent=""
                    setIntent={vi.fn()}
                    isSubmitting={false}
                    onSubmit={vi.fn((e: React.FormEvent) => e.preventDefault())}
                    onQuickAction={vi.fn()}
                    onDismiss={vi.fn()}
                />,
            ),
        ).not.toThrow();
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
