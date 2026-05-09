// Convert DesignTokens into a CSS custom-property block injected into the
// HTML mockup iframe. The resulting `:root` declaration is consumed by
// generated mockups via inline `style="background: var(--color-brand-primary)"`
// references. Tailwind utility classes still drive layout/spacing for
// historical reasons; CSS variables are the carrier for brand-specific
// values that the design system controls.

import type { DesignTokens } from '../../types';

const slugify = (key: string): string =>
    key.replace(/\./g, '-').replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');

/**
 * Emit a CSS variable block (without the surrounding `:root { ... }`) for
 * a normalized DesignTokens object. Variable naming convention:
 *
 *   --color-<slug>      — colors, slug = dot.path with dots replaced by dashes
 *   --typography-<slug>-<prop>  (size in px, weight unitless, lineHeight unitless)
 *   --spacing-<key>     — px units
 *   --radius-<key>      — px units
 *
 * Returned string is line-separated, each line indented with two spaces so
 * it slots cleanly into a `:root { ... }` block.
 */
export function tokensToCssVariables(tokens: DesignTokens): string {
    const lines: string[] = [];

    const colorKeys = Object.keys(tokens.colors).sort();
    for (const key of colorKeys) {
        lines.push(`  --color-${slugify(key)}: ${tokens.colors[key]};`);
    }

    const typographyKeys = Object.keys(tokens.typography).sort();
    for (const key of typographyKeys) {
        const t = tokens.typography[key];
        const slug = slugify(key);
        lines.push(`  --typography-${slug}-font: ${t.font};`);
        lines.push(`  --typography-${slug}-size: ${t.size}px;`);
        lines.push(`  --typography-${slug}-weight: ${t.weight};`);
        lines.push(`  --typography-${slug}-line-height: ${t.lineHeight};`);
        if (t.letterSpacing !== undefined) {
            lines.push(`  --typography-${slug}-letter-spacing: ${t.letterSpacing}px;`);
        }
    }

    const spacingKeys = Object.keys(tokens.spacing).sort();
    for (const key of spacingKeys) {
        lines.push(`  --spacing-${slugify(key)}: ${tokens.spacing[key]}px;`);
    }

    const radiusKeys = Object.keys(tokens.radius).sort();
    for (const key of radiusKeys) {
        lines.push(`  --radius-${slugify(key)}: ${tokens.radius[key]}px;`);
    }

    return lines.join('\n');
}

/**
 * Wrap `tokensToCssVariables` output in a complete `<style>:root { ... }</style>`
 * block ready to drop into a mockup iframe `<head>`.
 */
export function tokensToCssStyleBlock(tokens: DesignTokens): string {
    const body = tokensToCssVariables(tokens);
    return `<style data-design-tokens="1">\n:root {\n${body}\n}\n</style>`;
}
