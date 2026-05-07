// Compact, model-friendly serialization of DesignTokens for injection
// into mockup generation prompts. Designed to be roughly 600–900 tokens
// when serialized — short enough to coexist with the existing mockup
// system prompt but rich enough that the model has no excuse to invent
// unrelated colors or typography.

import type { DesignTokens } from '../../types';

/**
 * Build a prompt-friendly catalog of design tokens. Returned text uses
 * Markdown-ish bullet structure so the model can scan and copy values
 * directly into output. Includes color list, key typography slots,
 * spacing/radius scales, component recipes, and the rule list verbatim.
 */
export function tokensToPromptSnippet(tokens: DesignTokens): string {
    const lines: string[] = [];

    lines.push('## Design system contract (MUST follow)');
    lines.push('You have been given the project\'s design system as machine-readable tokens. Use these — do NOT invent unrelated colors, fonts, or component styles.');
    lines.push('');

    lines.push('### Color tokens');
    const colorEntries = Object.entries(tokens.colors).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [name, hex] of colorEntries) {
        lines.push(`- \`${name}\`: ${hex}`);
    }
    lines.push('');

    lines.push('### Typography tokens');
    const typographyEntries = Object.entries(tokens.typography).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [name, t] of typographyEntries) {
        const ls = t.letterSpacing !== undefined ? `, letter-spacing ${t.letterSpacing}px` : '';
        lines.push(`- \`${name}\`: ${t.font} · ${t.size}px · weight ${t.weight} · line-height ${t.lineHeight}${ls}`);
    }
    lines.push('');

    lines.push('### Spacing scale (px)');
    const spacingEntries = Object.entries(tokens.spacing).sort((a, b) => a[1] - b[1]);
    lines.push(spacingEntries.map(([k, v]) => `\`${k}\`=${v}px`).join(', '));
    lines.push('');

    lines.push('### Radius scale (px)');
    const radiusEntries = Object.entries(tokens.radius).sort((a, b) => a[1] - b[1]);
    lines.push(radiusEntries.map(([k, v]) => `\`${k}\`=${v}px`).join(', '));
    lines.push('');

    lines.push('### Component recipes');
    const componentEntries = Object.entries(tokens.components).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [name, c] of componentEntries) {
        const parts: string[] = [];
        if (c.background) parts.push(`background ${c.background}`);
        if (c.text) parts.push(`text ${c.text}`);
        if (c.border) parts.push(`border ${c.border}`);
        if (c.radius) parts.push(`radius ${c.radius}`);
        if (c.padding) parts.push(`padding ${c.padding}`);
        const head = `- \`${name}\`: ${parts.join(', ') || '(no overrides)'}`;
        lines.push(c.notes ? `${head} — ${c.notes}` : head);
    }
    lines.push('');

    lines.push('### Usage rules (binding)');
    for (const r of tokens.rules) {
        lines.push(`- ${r}`);
    }
    lines.push('');

    lines.push('### Compliance instructions');
    lines.push('- Use ONLY the colors listed above. Do not introduce additional brand or accent colors.');
    lines.push('- Use the typography tokens for headings, labels, and body text.');
    lines.push('- Use component recipes for buttons, cards, inputs, panels, and navigation surfaces.');
    lines.push('- For brand-specific values inside HTML mockups, prefer inline style references like `style="background: var(--color-brand-primary); border-radius: var(--radius-md)"`. Tailwind utility classes are still allowed for layout, sizing, and structural typography.');
    lines.push('- If a needed token is missing, choose the closest existing token and add a one-line note in the screen `notes` field describing the gap.');

    return lines.join('\n');
}

/**
 * Shorter image-prompt-friendly token brief for AI image mockups
 * (gpt-image-2). Image generation prompts tolerate far less structured
 * markdown — keep this terse.
 */
export function tokensToImagePromptBrief(tokens: DesignTokens): string {
    const palette = Object.entries(tokens.colors)
        .filter(([key]) => /^(brand|surface|text|state)\./.test(key))
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, hex]) => `${key} ${hex}`)
        .join(', ');
    const headingFont = tokens.typography['heading.lg']?.font ?? tokens.typography['heading.md']?.font ?? 'sans-serif';
    const bodyFont = tokens.typography['body.md']?.font ?? 'sans-serif';
    const radiusMd = tokens.radius.md ?? 8;
    return [
        `Use this design system strictly: palette ${palette}.`,
        `Heading typography: ${headingFont}. Body typography: ${bodyFont}.`,
        `Corner radius around ${radiusMd}px on cards and buttons.`,
        `Primary actions in brand.primary; do not introduce additional accent colors.`,
    ].join(' ');
}
