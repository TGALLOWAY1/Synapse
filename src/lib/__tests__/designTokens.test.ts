import { describe, it, expect } from 'vitest';
import {
    normalizeDesignTokens,
    hashDesignTokens,
    tokensToCssVariables,
    tokensToCssStyleBlock,
    tokensToPromptSnippet,
    tokensToImagePromptBrief,
    designSystemTokensToMarkdown,
    validateMockupHtmlAgainstTokens,
} from '../designTokens';

describe('normalizeDesignTokens', () => {
    it('fills sensible defaults from an empty input', () => {
        const tokens = normalizeDesignTokens({});
        expect(tokens.version).toBe(1);
        expect(tokens.colors['brand.primary']).toMatch(/^#[0-9A-F]{6}$/);
        expect(tokens.colors['surface.app']).toMatch(/^#[0-9A-F]{6}$/);
        expect(tokens.typography['heading.lg']).toMatchObject({
            font: expect.any(String),
            size: expect.any(Number),
            weight: expect.any(Number),
            lineHeight: expect.any(Number),
        });
        expect(tokens.spacing.md).toBeGreaterThan(0);
        expect(tokens.radius.md).toBeGreaterThan(0);
        expect(tokens.components['button.primary']).toBeDefined();
        expect(tokens.rules.length).toBeGreaterThan(0);
    });

    it('preserves valid hex colors and uppercases them', () => {
        const tokens = normalizeDesignTokens({
            colors: { 'brand.primary': '#8b5cf6', 'brand.accent': '#10b981' },
        });
        expect(tokens.colors['brand.primary']).toBe('#8B5CF6');
        expect(tokens.colors['brand.accent']).toBe('#10B981');
    });

    it('expands 3-digit hex colors', () => {
        const tokens = normalizeDesignTokens({ colors: { 'brand.primary': '#abc' } });
        expect(tokens.colors['brand.primary']).toBe('#AABBCC');
    });

    it('rejects garbage hex values and falls back to default', () => {
        const tokens = normalizeDesignTokens({ colors: { 'brand.primary': 'not-a-color' } });
        expect(tokens.colors['brand.primary']).toMatch(/^#[0-9A-F]{6}$/);
    });

    it('coerces typography string sizes', () => {
        const tokens = normalizeDesignTokens({
            typography: {
                'heading.lg': { font: 'Outfit', size: '40px', weight: '700', lineHeight: '1.2' },
            },
        });
        expect(tokens.typography['heading.lg']).toMatchObject({
            font: 'Outfit',
            size: 40,
            weight: 700,
            lineHeight: 1.2,
        });
    });

    it('preserves extra component recipes', () => {
        const tokens = normalizeDesignTokens({
            components: {
                'badge.success': { background: 'state.success', text: '#FFFFFF' },
            },
        });
        expect(tokens.components['badge.success']).toMatchObject({
            background: 'state.success',
            text: '#FFFFFF',
        });
        // Default required components are still present.
        expect(tokens.components['button.primary']).toBeDefined();
    });

    it('falls back to default rules when none provided', () => {
        const tokens = normalizeDesignTokens({ rules: [] });
        expect(tokens.rules.length).toBeGreaterThanOrEqual(3);
    });
});

describe('hashDesignTokens', () => {
    it('is deterministic across calls', () => {
        const tokens = normalizeDesignTokens({});
        expect(hashDesignTokens(tokens)).toBe(hashDesignTokens(tokens));
    });

    it('is order-independent for object keys', () => {
        const a = normalizeDesignTokens({
            colors: { 'brand.primary': '#111111', 'brand.secondary': '#222222' },
        });
        const b = normalizeDesignTokens({
            colors: { 'brand.secondary': '#222222', 'brand.primary': '#111111' },
        });
        expect(hashDesignTokens(a)).toBe(hashDesignTokens(b));
    });

    it('changes when a token value changes', () => {
        const a = normalizeDesignTokens({ colors: { 'brand.primary': '#111111' } });
        const b = normalizeDesignTokens({ colors: { 'brand.primary': '#222222' } });
        expect(hashDesignTokens(a)).not.toBe(hashDesignTokens(b));
    });

    it('changes when typography value changes', () => {
        const a = normalizeDesignTokens({
            typography: { 'heading.lg': { font: 'Inter', size: 32, weight: 600, lineHeight: 1.2 } },
        });
        const b = normalizeDesignTokens({
            typography: { 'heading.lg': { font: 'Outfit', size: 32, weight: 600, lineHeight: 1.2 } },
        });
        expect(hashDesignTokens(a)).not.toBe(hashDesignTokens(b));
    });
});

describe('tokensToCssVariables', () => {
    it('emits stable, sorted output', () => {
        const tokens = normalizeDesignTokens({});
        const a = tokensToCssVariables(tokens);
        const b = tokensToCssVariables(tokens);
        expect(a).toBe(b);
    });

    it('includes color variables for every color token', () => {
        const tokens = normalizeDesignTokens({});
        const css = tokensToCssVariables(tokens);
        expect(css).toContain('--color-brand-primary');
        expect(css).toContain('--color-surface-app');
        expect(css).toContain('--color-text-primary');
    });

    it('includes typography variables', () => {
        const tokens = normalizeDesignTokens({});
        const css = tokensToCssVariables(tokens);
        expect(css).toContain('--typography-heading-lg-font');
        expect(css).toContain('--typography-heading-lg-size');
        expect(css).toContain('--typography-body-md-line-height');
    });

    it('includes spacing and radius variables in px', () => {
        const tokens = normalizeDesignTokens({ spacing: { md: 16 }, radius: { md: 12 } });
        const css = tokensToCssVariables(tokens);
        expect(css).toContain('--spacing-md: 16px');
        expect(css).toContain('--radius-md: 12px');
    });

    it('wraps in :root selector via tokensToCssStyleBlock', () => {
        const tokens = normalizeDesignTokens({});
        const block = tokensToCssStyleBlock(tokens);
        expect(block).toContain('<style data-design-tokens="1">');
        expect(block).toContain(':root {');
        expect(block).toContain('--color-brand-primary');
        expect(block).toContain('</style>');
    });
});

describe('tokensToPromptSnippet', () => {
    it('includes the binding header and color list', () => {
        const tokens = normalizeDesignTokens({});
        const snippet = tokensToPromptSnippet(tokens);
        expect(snippet).toMatch(/Design system contract/i);
        expect(snippet).toContain('### Color tokens');
        expect(snippet).toContain('brand.primary');
    });

    it('includes the rule list verbatim', () => {
        const tokens = normalizeDesignTokens({
            rules: ['Always use brand.primary for primary CTAs.'],
        });
        const snippet = tokensToPromptSnippet(tokens);
        expect(snippet).toContain('Always use brand.primary for primary CTAs.');
    });

    it('mentions CSS variable usage instructions', () => {
        const tokens = normalizeDesignTokens({});
        const snippet = tokensToPromptSnippet(tokens);
        expect(snippet).toMatch(/var\(--color-brand-primary\)/);
    });
});

describe('tokensToImagePromptBrief', () => {
    it('includes palette and typography descriptions', () => {
        const tokens = normalizeDesignTokens({});
        const brief = tokensToImagePromptBrief(tokens);
        expect(brief).toMatch(/brand\.primary/);
        expect(brief).toMatch(/Heading typography/);
        expect(brief).toMatch(/brand\.primary/);
    });
});

describe('designSystemTokensToMarkdown', () => {
    it('emits the section headings the legacy renderer expects', () => {
        const tokens = normalizeDesignTokens({});
        const md = designSystemTokensToMarkdown(tokens);
        expect(md).toContain('### Color Palette');
        expect(md).toContain('### Typography');
        expect(md).toContain('### Spacing Scale');
        expect(md).toContain('### Component Patterns');
        expect(md).toContain('### Usage Rules');
    });

    it('includes a markdown table for typography', () => {
        const tokens = normalizeDesignTokens({});
        const md = designSystemTokensToMarkdown(tokens);
        expect(md).toMatch(/\|\s*Role\s*\|\s*Font\s*\|\s*Size/);
    });

    it('renders color rows with hex codes the renderer can swatch', () => {
        const tokens = normalizeDesignTokens({});
        const md = designSystemTokensToMarkdown(tokens);
        expect(md).toMatch(/#[0-9A-F]{6}/);
    });
});

describe('validateMockupHtmlAgainstTokens', () => {
    const tokens = normalizeDesignTokens({
        colors: {
            'brand.primary': '#8B5CF6',
            'surface.card': '#1E293B',
            'text.primary': '#F8FAFC',
        },
    });

    it('reports clean compliance for HTML using only known colors', () => {
        const html = '<div style="background: #8B5CF6; color: #F8FAFC">Hi</div>';
        const result = validateMockupHtmlAgainstTokens(html, tokens);
        expect(result.warnings).toEqual([]);
        expect(result.score).toBe(1);
    });

    it('flags hex colors not present in tokens', () => {
        const html = '<button class="primary" style="background: #FF0000">Buy</button>';
        const result = validateMockupHtmlAgainstTokens(html, tokens);
        expect(result.counts.unknownHexes).toBeGreaterThan(0);
        expect(result.warnings.some(w => /not present in design system/i.test(w))).toBe(true);
        expect(result.score).toBeLessThan(1);
    });

    it('flags primary CTA without brand.primary reference', () => {
        const html = '<button class="primary" style="background: #112233">Click</button>';
        const result = validateMockupHtmlAgainstTokens(html, tokens);
        expect(result.warnings.some(w => /Primary CTA/i.test(w))).toBe(true);
    });

    it('passes when CTA uses brand.primary CSS variable', () => {
        const html = '<button class="primary" style="background: var(--color-brand-primary); color: #F8FAFC">Click</button>';
        const result = validateMockupHtmlAgainstTokens(html, tokens);
        expect(result.warnings.some(w => /Primary CTA/i.test(w))).toBe(false);
    });

    it('does not flag inline styles below the threshold', () => {
        const html = '<div style="padding: 4px"></div>';
        const result = validateMockupHtmlAgainstTokens(html, tokens);
        expect(result.warnings.some(w => /Heavy use of inline style/i.test(w))).toBe(false);
    });
});
