import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FreshnessBadge } from '../FreshnessBadge';

describe('FreshnessBadge', () => {
    it('renders nothing for non-stale / absent statuses', () => {
        for (const status of ['up_to_date', 'missing', 'generating', 'source', 'error', undefined] as const) {
            const { container } = render(<FreshnessBadge status={status} />);
            expect(container).toBeEmptyDOMElement();
        }
    });

    it('labels the two stale statuses', () => {
        const needs = render(<FreshnessBadge status="needs_update" />);
        expect(needs.getByText('Needs update')).toBeInTheDocument();

        const rec = render(<FreshnessBadge status="update_recommended" />);
        expect(rec.getByText('Update recommended')).toBeInTheDocument();
    });

    it('surfaces the detail as a hover title', () => {
        const { getByText } = render(<FreshnessBadge status="needs_update" detail="The PRD changed" />);
        expect(getByText('Needs update')).toHaveAttribute('title', 'The PRD changed');
    });
});
