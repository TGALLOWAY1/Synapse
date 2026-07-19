import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { DesignSystemRenderer } from '../renderers/DesignSystemRenderer';

// SYN-004: the legacy Design System markdown fallback used to render raw
// HTML via rehype-raw with no sanitizer, so malicious/unexpected HTML in
// generated or restored artifact content became live DOM (script execution,
// iframes, img onerror handlers). These tests exercise the fallback path
// (no `metadata.tokens`, so DesignSystemRenderer routes to
// LegacyMarkdownDesignSystem) with unsafe HTML and assert it never becomes a
// real element — react-markdown's default (no rehype-raw) treats raw HTML as
// inert text.

beforeEach(() => {
    // useIsMobile (used by LegacyMarkdownDesignSystem) needs matchMedia.
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

describe('DesignSystemRenderer — legacy markdown fallback sanitization', () => {
    it('does not render a <script> element from raw HTML in content', () => {
        const content = 'Some general notes.\n\n<script>alert(1)</script>\n\nMore notes follow.';
        const { container } = render(<DesignSystemRenderer content={content} />);

        expect(container.querySelector('script')).toBeNull();
    });

    it('does not render an <iframe> element from raw HTML in content', () => {
        const content = 'Embed test.\n\n<iframe srcdoc="<script>alert(1)</script>"></iframe>\n\nAfter.';
        const { container } = render(<DesignSystemRenderer content={content} />);

        expect(container.querySelector('iframe')).toBeNull();
    });

    it('does not render an <img> element with an onerror handler from raw HTML in content', () => {
        const content = 'Broken image test.\n\n<img src="x" onerror="alert(1)">\n\nAfter.';
        const { container } = render(<DesignSystemRenderer content={content} />);

        expect(container.querySelector('img')).toBeNull();
    });
});

describe('DesignSystemRenderer — hex swatch preservation', () => {
    it('still renders a color swatch for a hex literal without raw HTML', () => {
        const content = 'Primary color: #6366F1 is used for primary buttons.';
        const { container, getByText } = render(<DesignSystemRenderer content={content} />);

        // The hex text itself stays visible.
        expect(getByText('#6366F1')).toBeInTheDocument();

        // A swatch (a decorative, aria-hidden colored square) renders next to it,
        // built from a component override rather than injected raw HTML.
        const swatch = container.querySelector<HTMLElement>('span[aria-hidden="true"]');
        expect(swatch).not.toBeNull();
        expect(swatch?.style.background).toBeTruthy();
        expect(swatch?.parentElement?.textContent).toContain('#6366F1');

        // No stray `data-hex` raw-HTML attribute should exist anywhere either —
        // the old implementation depended on it, the new one doesn't need it.
        expect(container.querySelector('[data-hex]')).toBeNull();
    });
});

describe('DesignSystemRenderer — legacy markdown still renders readable content', () => {
    it('renders headings, lists, a table, and bold text with hexes', () => {
        const content = `
Introductory notes about this design system.

### Color Palette

- **Primary**: #6366F1 - main brand color
- **Secondary**: #F59E0B - accent color

### Typography

| Role | Font | Size | Weight | Line Height | Application |
| --- | --- | --- | --- | --- | --- |
| Heading | Inter | 32px | 700 | 1.2 | Page titles |
| Body | Inter | 16px | 400 | 1.5 | Paragraph text |

### Usage Rules

Use **bold** text sparingly. Buttons should use #10B981 for success states.

| Component | Notes |
| --- | --- |
| Button | Rounded corners |
`;
        const { container, getByText, getAllByText } = render(<DesignSystemRenderer content={content} />);

        // Section headings render. (The collapsed outline nav also echoes the
        // active section's label, so these may appear more than once.)
        expect(getAllByText('Color Palette').length).toBeGreaterThan(0);
        expect(getAllByText('Typography').length).toBeGreaterThan(0);
        expect(getAllByText('Usage Rules').length).toBeGreaterThan(0);

        // Color palette rows and their hexes are readable.
        expect(getByText('Primary')).toBeInTheDocument();
        expect(getAllByText('#6366F1').length).toBeGreaterThan(0);

        // The typography table is recognized and rendered as structured rows.
        expect(getByText('Heading')).toBeInTheDocument();

        // The Usage Rules section doesn't match a specialized parser, so it
        // renders through the generic markdown fallback: its GFM table
        // becomes a real <table>, and bold text + an inline hex swatch
        // coexist in the same paragraph.
        expect(container.querySelector('table')).not.toBeNull();
        expect(getByText('bold')).toBeInTheDocument();
        expect(getAllByText('#10B981').length).toBeGreaterThan(0);
    });
});
