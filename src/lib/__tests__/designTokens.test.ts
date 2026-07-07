import { describe, it, expect } from 'vitest';
import {
    normalizeDesignTokens,
    hashDesignTokens,
    tokensToCssVariables,
    tokensToCssStyleBlock,
    buildDesignSystemBrief,
    designSystemTokensToMarkdown,
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

describe('buildDesignSystemBrief', () => {
    it('includes palette and typography descriptions', () => {
        const tokens = normalizeDesignTokens({});
        const brief = buildDesignSystemBrief(tokens);
        expect(brief).toMatch(/brand\.primary/);
        expect(brief).toMatch(/[Tt]ypography/);
    });

    it('covers the core design-system aspects without ballooning in length', () => {
        const tokens = normalizeDesignTokens({});
        const brief = buildDesignSystemBrief(tokens);
        // Completeness: each listed aspect is represented.
        expect(brief).toMatch(/Color palette/i);
        expect(brief).toMatch(/typography/i);
        expect(brief).toMatch(/density/i);
        expect(brief).toMatch(/radius/i);
        expect(brief).toMatch(/[Ee]levation|shadow/);
        expect(brief).toMatch(/button/i);
        expect(brief).toMatch(/[Cc]ards?/);
        expect(brief).toMatch(/[Ff]orms?/);
        expect(brief).toMatch(/[Mm]odals?/);
        expect(brief).toMatch(/[Nn]avigation/);
        expect(brief).toMatch(/[Rr]esponsive/);
        expect(brief).toMatch(/[Aa]ccessibility|WCAG/);
        // Conciseness: a brief, not a spec dump.
        expect(brief.length).toBeLessThan(1600);
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

