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
    lines.push('You have been given the project\'s design system as machine-readable tokens. These tokens are binding. You MUST use them exactly as defined. You MUST NOT invent, rename, substitute, or stylistically reinterpret any color, font, or component style.');
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
    lines.push('- Use ONLY the colors listed above. You MUST NOT introduce additional brand or accent colors.');
    lines.push('- Use the typography tokens for headings, labels, and body text. You MUST NOT substitute other fonts, sizes, or weights.');
    lines.push('- Use the component recipes exactly for buttons, cards, inputs, panels, and navigation surfaces. You MUST NOT alter their token values.');
    lines.push('- For brand-specific values inside HTML mockups, prefer inline style references like `style="background: var(--color-brand-primary); border-radius: var(--radius-md)"`. Tailwind utility classes are still allowed for layout, sizing, and structural typography.');
    lines.push('- If a needed token is missing, choose the closest existing token and add a one-line note in the screen `notes` field describing the gap.');

    return lines.join('\n');
}

/**
 * Concise-but-complete "Design System Brief" — the SINGLE source of design
 * direction for every prompt that drives a mockup/screen image, whether it
 * is the internal gpt-image-2 path (`buildScreenImagePrompt`) or the
 * user-copied external prompt on the Screen Inventory page
 * (`buildExternalMockupPrompt`). Both call this so an externally generated
 * mockup follows the same visual language as the internal one.
 *
 * Token data (colors, typography, spacing, radius, component recipes, rules)
 * comes straight from the design system. Aspects the token contract does not
 * encode — elevation, navigation styling, responsive behavior, accessibility
 * — are expressed as sensible, derived conventions so the brief reads as a
 * complete spec without bloating into a wall of text. Kept terse on purpose:
 * image models tolerate far less structured prose than text models.
 */
export function buildDesignSystemBrief(tokens: DesignTokens): string {
    const palette = Object.entries(tokens.colors)
        .filter(([key]) => /^(brand|surface|text|state|border)\./.test(key))
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, hex]) => `${key} ${hex}`)
        .join(', ');

    const headingFont = tokens.typography['heading.lg']?.font ?? tokens.typography['heading.md']?.font ?? 'sans-serif';
    const headingWeight = tokens.typography['heading.lg']?.weight ?? tokens.typography['heading.md']?.weight ?? 700;
    const bodyFont = tokens.typography['body.md']?.font ?? 'sans-serif';
    const bodySize = tokens.typography['body.md']?.size ?? 16;

    const radiusMd = tokens.radius.md ?? 8;
    const spacingMd = tokens.spacing.md ?? 16;
    const density = spacingMd <= 8
        ? 'compact, information-dense'
        : spacingMd >= 20
            ? 'spacious and airy'
            : 'comfortable and balanced';

    const button = tokens.components['button.primary'];
    const card = tokens.components['card.default'];
    const buttonLine = button
        ? `Primary buttons: background ${button.background ?? 'brand.primary'}, text ${button.text ?? 'on the brand color'}, radius ${button.radius ?? 'md'}.`
        : `Primary buttons filled with brand.primary, ~${radiusMd}px corners.`;
    const cardLine = card
        ? `Cards: background ${card.background ?? 'surface.card'}, border ${card.border ?? 'border.subtle'}, radius ${card.radius ?? 'md'}.`
        : `Cards: surface.card background with a subtle border.`;

    const rules = tokens.rules.slice(0, 4).join(' ');

    return [
        'Follow this design system exactly — do not invent unrelated colors, fonts, or styling.',
        `Color palette: ${palette}.`,
        `Typography: headings in ${headingFont} (weight ${headingWeight}), body in ${bodyFont} (~${bodySize}px).`,
        `Density: ${density}, ${spacingMd}px base spacing; ~${radiusMd}px radius on buttons, inputs, cards, and modals.`,
        'Elevation: soft, subtle shadows lift cards and modals off the surface — no heavy drop shadows.',
        buttonLine,
        'Secondary buttons are outlined/low-emphasis — never a second brand color.',
        cardLine,
        'Forms: labelled inputs, subtle borders, comfortable hit areas, visible focus. Modals: surface.card panels over a dimmed backdrop matching card radius/elevation.',
        'Navigation: consistent bars/menus using the text colors, brand.primary for the active item.',
        'Responsive: reflow cleanly between mobile and desktop, no horizontal scroll. Accessibility: WCAG AA contrast, visible focus ring, tap targets ≥44px.',
        rules ? `Rules: ${rules}` : '',
    ].filter(Boolean).join(' ');
}
