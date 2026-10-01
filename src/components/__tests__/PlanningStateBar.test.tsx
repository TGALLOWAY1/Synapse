import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlanningStateBar } from '../planning/PlanningStateBar';

const renderBar = (openItems: { decisions: number; assumptions: number }, onOpenChallenge?: () => void) => {
    const onOpenDecisions = vi.fn();
    render(
        <PlanningStateBar
            openItems={openItems}
            onOpenDecisions={onOpenDecisions}
            onOpenChallenge={onOpenChallenge}
        />,
    );
    return { onOpenDecisions };
};

describe('PlanningStateBar (one line)', () => {
    it('states open decisions and assumptions to confirm on one line', () => {
        renderBar({ decisions: 3, assumptions: 2 });
        const bar = screen.getByRole('region', { name: 'Planning status' });
        expect(bar.textContent).toContain('3 open decisions · 2 assumptions to confirm');
    });

    it('uses singular forms and omits a zero part', () => {
        renderBar({ decisions: 1, assumptions: 0 });
        const bar = screen.getByRole('region', { name: 'Planning status' });
        expect(bar.textContent).toContain('1 open decision');
        expect(bar.textContent).not.toMatch(/assumption/);
    });

    it('says plainly when nothing is open', () => {
        renderBar({ decisions: 0, assumptions: 0 });
        expect(screen.getByText('No open decisions or assumptions')).toBeInTheDocument();
    });

    it('opens the Decision Center', () => {
        const { onOpenDecisions } = renderBar({ decisions: 0, assumptions: 4 });
        fireEvent.click(screen.getByRole('button', { name: /Open Decision Center/ }));
        expect(onOpenDecisions).toHaveBeenCalledTimes(1);
    });

    it('offers Challenge this plan only when wired', () => {
        const onOpenChallenge = vi.fn();
        renderBar({ decisions: 1, assumptions: 1 }, onOpenChallenge);
        fireEvent.click(screen.getByRole('button', { name: /Challenge this plan/ }));
        expect(onOpenChallenge).toHaveBeenCalledTimes(1);
    });

    it('carries no readiness verdict, tool cards, check lists, packet block, or commit action', () => {
        renderBar({ decisions: 2, assumptions: 1 }, () => undefined);
        const bar = screen.getByRole('region', { name: 'Planning status' });
        expect(bar.textContent).not.toMatch(/Review readiness|Finalize|Commit|Implementation packet|Product-reasoning checks|Packet checks|Your draft is ready|Planning tools/);
        expect(bar.querySelector('details')).toBeNull();
        expect(screen.getAllByRole('button')).toHaveLength(2);
    });
});
