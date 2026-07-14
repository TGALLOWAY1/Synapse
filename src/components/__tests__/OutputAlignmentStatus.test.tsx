import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OutputAlignmentBadge, OutputAlignmentNotice } from '../OutputAlignmentStatus';
import type { OutputAlignment } from '../../lib/planning/outputAlignment';

const alignment = (overrides: Partial<OutputAlignment> = {}): OutputAlignment => ({
    artifactId: 'a1',
    nodeId: 'data_model',
    title: 'Data Model',
    state: 'possibly_affected',
    confidence: 'possible',
    summary: 'The data ownership decision changed.',
    reasons: ['The current plan changed.'],
    nextAction: 'Review Data Model against the current plan.',
    usefulForExploration: true,
    blocksBuildReadiness: true,
    generatedFromSpineId: 's1',
    ...overrides,
});

describe('OutputAlignmentStatus', () => {
    it('distinguishes possible impact and keeps exploration usefulness explicit', () => {
        const item = alignment();
        render(<><OutputAlignmentBadge alignment={item} /><OutputAlignmentNotice alignment={item} /></>);

        expect(screen.getAllByText('Review recommended')).toHaveLength(2);
        expect(screen.getByText('Possible impact')).toBeTruthy();
        expect(screen.getByText(item.summary)).toBeTruthy();
        expect(screen.getByText(`Next: ${item.nextAction}`)).toBeTruthy();
        expect(screen.getByText(/remains useful for exploration/)).toBeTruthy();
    });

    it('does not render a warning panel for aligned output', () => {
        const item = alignment({ state: 'aligned', confidence: 'definite', blocksBuildReadiness: false });
        const { container } = render(<OutputAlignmentNotice alignment={item} />);
        expect(container).toBeEmptyDOMElement();
    });
});
