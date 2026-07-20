import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PlanningRecord } from '../../types';
import { SharpenPlanFlow } from '../planning/SharpenPlanFlow';

const record = (overrides: Partial<PlanningRecord> = {}): PlanningRecord => ({
    id: 'a-1', projectId: 'project-1', type: 'assumption', status: 'open',
    title: 'LLM pricing stays affordable',
    statement: 'LLM API providers will maintain pricing that supports real-time evaluation.',
    whyItMatters: 'Automated gap analysis relies on immediate, affordable feedback.',
    evidence: [], sourceFindingIds: [], createdBy: 'synapse', createdAt: 1, updatedAt: 1,
    materiality: 'high',
    ...overrides,
});

const records = [
    record(),
    record({
        id: 'a-2', title: 'Users write explanations willingly',
        statement: 'Users will type explanations rather than only reading material.',
        whyItMatters: 'Active recall is the core loop.',
    }),
];

describe('SharpenPlanFlow', () => {
    it('walks one question at a time and records a confirm verdict', () => {
        const onDecide = vi.fn();
        render(<SharpenPlanFlow records={records} onDecide={onDecide} onClose={vi.fn()} />);

        expect(screen.getByText('Question 1 of 2')).toBeInTheDocument();
        expect(screen.getByText(/LLM API providers will maintain pricing/)).toBeInTheDocument();
        expect(screen.getByText(/Automated gap analysis relies on immediate/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Sounds right' }));
        expect(onDecide).toHaveBeenCalledWith('a-1', 'confirm', records[0].statement, undefined);
        expect(screen.getByText('Question 2 of 2')).toBeInTheDocument();
    });

    it('records a correction through the reject path and shows the closing tally', () => {
        const onDecide = vi.fn();
        const onClose = vi.fn();
        render(<SharpenPlanFlow records={records} onDecide={onDecide} onClose={onClose} />);

        fireEvent.click(screen.getByRole('button', { name: 'Sounds right' }));

        fireEvent.click(screen.getByRole('button', { name: /Not quite/ }));
        const correction = screen.getByPlaceholderText(/What should replace this/);
        fireEvent.change(correction, { target: { value: 'Only power users will write explanations.' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
        expect(onDecide).toHaveBeenCalledWith('a-2', 'reject', 'Only power users will write explanations.', undefined);

        expect(screen.getByText('Nicely sharpened.')).toBeInTheDocument();
        expect(screen.getByText(/1 confirmed/)).toBeInTheDocument();
        expect(screen.getByText(/1 corrected/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(onClose).toHaveBeenCalled();
    });

    it('defers with Not sure yet, skips without an event, and can step back', () => {
        const onDecide = vi.fn();
        render(<SharpenPlanFlow records={records} onDecide={onDecide} onClose={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: 'Not sure yet' }));
        expect(onDecide).toHaveBeenCalledWith('a-1', 'defer', undefined, undefined);
        expect(screen.getByText('Question 2 of 2')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.getByText('Question 1 of 2')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
        fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
        expect(onDecide).toHaveBeenCalledTimes(1);
        expect(screen.getByText(/1 to revisit/)).toBeInTheDocument();
    });

    it('lets the user open the full record instead of answering inline', () => {
        const onOpenRecord = vi.fn();
        render(<SharpenPlanFlow records={records} onDecide={vi.fn()} onClose={vi.fn()} onOpenRecord={onOpenRecord} />);

        fireEvent.click(screen.getByRole('button', { name: /View full detail/ }));
        expect(onOpenRecord).toHaveBeenCalledWith('a-1');
    });

    it('closes immediately when there is nothing to ask', () => {
        const onClose = vi.fn();
        render(<SharpenPlanFlow records={[]} onDecide={vi.fn()} onClose={onClose} />);
        expect(screen.queryByText(/Question 1/)).toBeNull();
        expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    });
});
