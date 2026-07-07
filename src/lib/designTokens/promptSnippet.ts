// Design-system serialization for image prompts. `buildDesignSystemBrief` is
// the ONE Design System Brief embedded into every prompt that drives a
// mockup/screen image.

import type { DesignTokens } from '../../types';

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
