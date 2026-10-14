import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { GenerationProgress } from '../GenerationProgress';
import { getArtifactStages } from '../generationStages';

// The section grid labels each pip with its model family, derived from the
// model id. Gemini 4 Argon's id carries neither "flash" nor "pro", so without
// its own keyword the pip fell through to the raw id prefix ("gemini").

afterEach(() => {
    cleanup();
});

describe('GenerationProgress section grid — model labels', () => {
    it('labels Argon sections "Argon", and strong pips with no model yet too', () => {
        const { getAllByText, getByText, queryByText } = render(
            <GenerationProgress
                stages={getArtifactStages('user_flows')}
                title="Generating PRD"
                sectionStatus={{
                    features: { tier: 'strong', status: 'generating', model: 'gemini-4-argon' },
                    ux_loops: { tier: 'strong', status: 'queued' },
                    product_basics: { tier: 'fast', status: 'complete', model: 'gemini-3.8-flash', ms: 1200 },
                }}
            />,
        );

        expect(getAllByText('Argon')).toHaveLength(2);
        expect(getByText('Flash')).toBeInTheDocument();
        expect(queryByText('gemini')).not.toBeInTheDocument();
    });
});
