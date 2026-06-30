import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ArtifactOutlineNav, type ArtifactOutlineItem } from '../ArtifactOutlineNav';

const ITEMS: ArtifactOutlineItem[] = [
    { id: 'a', label: 'Summary', description: 'Overview' },
    { id: 'b', label: 'Colors', countLabel: '11 tokens' },
    { id: 'c', label: 'Typography', countLabel: '5 roles' },
];

function renderNav(
    overrides: Partial<React.ComponentProps<typeof ArtifactOutlineNav>> = {},
) {
    const props = {
        title: 'Sections',
        items: ITEMS,
        activeId: 'b',
        activeLabel: 'Current section',
        onSelect: vi.fn(),
        ...overrides,
    };
    return { props, ...render(<ArtifactOutlineNav {...props} />) };
}

describe('ArtifactOutlineNav', () => {
    it('renders rows as accessible buttons with count labels', () => {
        renderNav();
        // Each row is a button (not a clickable div).
        expect(screen.getByRole('button', { name: /Summary/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Colors/ })).toBeInTheDocument();
        expect(screen.getByText('11 tokens')).toBeInTheDocument();
    });

    it('marks the active row with aria-current and the active badge', () => {
        renderNav({ activeId: 'b', activeLabel: 'Current section' });
        const active = screen.getByRole('button', { name: /Colors/ });
        expect(active).toHaveAttribute('aria-current', 'true');
        expect(screen.getByText('Current section')).toBeInTheDocument();
    });

    it('exposes aria-expanded on the collapsible header and toggles it', () => {
        renderNav();
        const header = screen.getByRole('button', { name: /Sections/ });
        expect(header).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(header);
        expect(header).toHaveAttribute('aria-expanded', 'false');
    });

    it('calls onSelect with the row id when a row is clicked', () => {
        const { props } = renderNav();
        fireEvent.click(screen.getByRole('button', { name: /Typography/ }));
        expect(props.onSelect).toHaveBeenCalledWith('c');
    });

    it('collapses after selection when collapseOnSelect is set', () => {
        renderNav({ collapseOnSelect: true });
        const header = screen.getByRole('button', { name: /Sections/ });
        expect(header).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(screen.getByRole('button', { name: /Typography/ }));
        expect(header).toHaveAttribute('aria-expanded', 'false');
    });

    it('shows the current item in the collapsed header', () => {
        renderNav({ defaultExpanded: false, activeId: 'a' });
        // Collapsed header echoes the current selection.
        expect(screen.getByText('Summary')).toBeInTheDocument();
        expect(screen.getByText(/Current:/)).toBeInTheDocument();
    });
});
