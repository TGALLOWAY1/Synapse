import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UnderlineTabs, type UnderlineTab } from '../ui/UnderlineTabs';

const tabs: UnderlineTab[] = [
    { id: 'first', label: 'First tab', count: 3 },
    { id: 'second', label: 'Second tab' },
    { id: 'third', label: 'Third tab' },
];

describe('UnderlineTabs', () => {
    it('renders a tablist with each tab and a count badge', () => {
        render(<UnderlineTabs tabs={tabs} activeId="first" onChange={vi.fn()} ariaLabel="Example tabs" />);

        expect(screen.getByRole('tablist', { name: 'Example tabs' })).toBeInTheDocument();
        expect(screen.getAllByRole('tab')).toHaveLength(3);
        expect(screen.getByRole('tab', { name: /First tab/ })).toHaveTextContent('3');
    });

    it('marks the active tab as selected and gives it the active styling', () => {
        render(<UnderlineTabs tabs={tabs} activeId="second" onChange={vi.fn()} ariaLabel="Example tabs" />);

        const active = screen.getByRole('tab', { name: 'Second tab' });
        const inactive = screen.getByRole('tab', { name: /First tab/ });
        expect(active).toHaveAttribute('aria-selected', 'true');
        expect(active).toHaveClass('text-indigo-700', 'border-indigo-600');
        expect(inactive).toHaveAttribute('aria-selected', 'false');
        expect(inactive).toHaveClass('text-neutral-500', 'border-transparent');
    });

    it('calls onChange when a tab is clicked', () => {
        const onChange = vi.fn();
        render(<UnderlineTabs tabs={tabs} activeId="first" onChange={onChange} ariaLabel="Example tabs" />);

        fireEvent.click(screen.getByRole('tab', { name: 'Third tab' }));
        expect(onChange).toHaveBeenCalledWith('third');
    });

    it('only puts the active tab in the natural tab order (roving tabIndex)', () => {
        render(<UnderlineTabs tabs={tabs} activeId="second" onChange={vi.fn()} ariaLabel="Example tabs" />);

        expect(screen.getByRole('tab', { name: 'Second tab' })).toHaveAttribute('tabIndex', '0');
        expect(screen.getByRole('tab', { name: /First tab/ })).toHaveAttribute('tabIndex', '-1');
        expect(screen.getByRole('tab', { name: 'Third tab' })).toHaveAttribute('tabIndex', '-1');
    });

    it('moves selection with ArrowRight, ArrowLeft, Home, and End', () => {
        const onChange = vi.fn();
        const { rerender } = render(<UnderlineTabs tabs={tabs} activeId="first" onChange={onChange} ariaLabel="Example tabs" />);
        const tablist = screen.getByRole('tablist');

        fireEvent.keyDown(tablist, { key: 'ArrowRight' });
        expect(onChange).toHaveBeenLastCalledWith('second');
        rerender(<UnderlineTabs tabs={tabs} activeId="second" onChange={onChange} ariaLabel="Example tabs" />);

        fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
        expect(onChange).toHaveBeenLastCalledWith('first');

        fireEvent.keyDown(tablist, { key: 'End' });
        expect(onChange).toHaveBeenLastCalledWith('third');

        rerender(<UnderlineTabs tabs={tabs} activeId="third" onChange={onChange} ariaLabel="Example tabs" />);
        fireEvent.keyDown(tablist, { key: 'Home' });
        expect(onChange).toHaveBeenLastCalledWith('first');
    });
});
