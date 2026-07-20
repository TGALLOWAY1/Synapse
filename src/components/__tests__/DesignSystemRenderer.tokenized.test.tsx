import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { DesignSystemRenderer } from '../renderers/DesignSystemRenderer';
import type { DesignTokens } from '../../types';

// First coverage of the tokenized `metadata.tokens` path (TokenizedDesignSystem).
// The legacy-markdown path already has dedicated coverage in
// DesignSystemRenderer.test.tsx — this file is additive and must not affect it.

beforeEach(() => {
    // useIsMobile (used by TokenizedDesignSystem) needs matchMedia.
    vi.stubGlobal(
        'matchMedia',
        vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    );
});

const TOKENS: DesignTokens = {
    version: 1,
    colors: {
        'brand.primary': '#6366F1',
        'brand.secondary': '#4F46E5',
        'text.body': '#171717',
    },
    typography: {
        'heading.lg': { font: 'Inter, sans-serif', size: 32, weight: 700, lineHeight: 1.2 },
        'body.md': { font: 'Inter, sans-serif', size: 16, weight: 400, lineHeight: 1.5 },
    },
    spacing: { sm: 8, md: 16, lg: 24 },
    radius: { sm: 4, md: 8 },
    components: {
        'button.primary': {
            background: 'brand.primary',
            text: '#ffffff',
            radius: 'md',
            padding: 'sm md',
            notes: 'Primary call-to-action.',
        },
    },
    rules: ['Use brand.primary only for primary actions.'],
};

function renderTokenized(tokens: DesignTokens = TOKENS) {
    return render(
        <DesignSystemRenderer content="" metadata={{ tokens }} />,
    );
}

describe('DesignSystemRenderer — tokenized path', () => {
    it('renders color token sub-names and hex values', () => {
        const { getByText } = renderTokenized();

        expect(getByText('primary')).toBeInTheDocument();
        expect(getByText('secondary')).toBeInTheDocument();
        expect(getByText('body')).toBeInTheDocument();
        expect(getByText('#6366F1')).toBeInTheDocument();
        expect(getByText('#4F46E5')).toBeInTheDocument();
        expect(getByText('#171717')).toBeInTheDocument();
    });

    it('renders namespace group headers', () => {
        const { getAllByText } = renderTokenized();

        expect(getAllByText('Brand').length).toBeGreaterThan(0);
        expect(getAllByText('Text').length).toBeGreaterThan(0);
    });

    it('renders all five section headings with their scroll-spy ds- ids', () => {
        const { container, getAllByText } = renderTokenized();

        expect(getAllByText('Color Tokens').length).toBeGreaterThan(0);
        expect(getAllByText('Typography Tokens').length).toBeGreaterThan(0);
        expect(getAllByText('Spacing & Radius').length).toBeGreaterThan(0);
        expect(getAllByText('Component Tokens').length).toBeGreaterThan(0);
        expect(getAllByText('Usage Rules').length).toBeGreaterThan(0);

        for (const id of ['ds-colors', 'ds-typography', 'ds-spacing', 'ds-components', 'ds-rules']) {
            expect(container.querySelector(`#${id}`)).not.toBeNull();
        }
    });

    it('shows typography rows with size/weight meta', () => {
        const { getByText } = renderTokenized();

        expect(getByText('heading.lg')).toBeInTheDocument();
        expect(getByText('body.md')).toBeInTheDocument();
        expect(getByText('32px · 700 · 1.2')).toBeInTheDocument();
        expect(getByText('16px · 400 · 1.5')).toBeInTheDocument();
    });
});

describe('DesignSystemRenderer — legacy markdown fallback still routes correctly', () => {
    it('renders the legacy path (no ds-colors id) when metadata.tokens is absent', () => {
        const { container } = render(
            <DesignSystemRenderer content="### Color Palette\n\n- **Primary**: #6366F1 - main" />,
        );
        expect(container.querySelector('#ds-colors')).toBeNull();
    });
});
