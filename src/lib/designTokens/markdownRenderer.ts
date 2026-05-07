// Convert a normalized DesignTokens object to canonical markdown that the
// existing DesignSystemRenderer.tsx can parse without modification. This
// preserves the legacy markdown rendering path for old projects (whose
// content is markdown-only) while also providing the canonical text body
// for ArtifactVersion.content on new tokenized versions.
//
// The output uses the same ### Color Palette / ### Typography / ### Spacing
// Scale / ### Component Patterns / ### Usage Rules section structure so
// the regex-based fallback in DesignSystemRenderer keeps working.

import type { DesignTokens } from '../../types';

const titleCase = (key: string): string =>
    key.split(/[.\-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/**
 * Render a DesignTokens object as markdown matching the layout the existing
 * `DesignSystemRenderer.tsx` already knows how to parse.
 */
export function designSystemTokensToMarkdown(tokens: DesignTokens): string {
    const lines: string[] = [];

    lines.push('# Design System Starter');
    lines.push('');
    lines.push('This design system is the binding visual contract for downstream mockups and UI artifacts. Every color, typography choice, spacing value, and component style must be expressed via the tokens below.');
    lines.push('');

    // --- Color Palette ---
    lines.push('### Color Palette');
    lines.push('');
    const colorEntries = Object.entries(tokens.colors).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [name, hex] of colorEntries) {
        lines.push(`**${titleCase(name)}:** ${hex} — token \`${name}\``);
    }
    lines.push('');

    // --- Typography ---
    lines.push('### Typography');
    lines.push('');
    lines.push('| Role | Font | Size | Weight | Line Height |');
    lines.push('|------|------|------|--------|-------------|');
    const typographyEntries = Object.entries(tokens.typography).sort((a, b) => {
        // Sort headings first by descending size, then body in size order.
        const aIsHeading = a[0].startsWith('heading.');
        const bIsHeading = b[0].startsWith('heading.');
        if (aIsHeading !== bIsHeading) return aIsHeading ? -1 : 1;
        return b[1].size - a[1].size;
    });
    for (const [name, t] of typographyEntries) {
        lines.push(`| ${name} | ${t.font} | ${t.size}px | ${t.weight} | ${t.lineHeight} |`);
    }
    lines.push('');

    // --- Spacing Scale ---
    lines.push('### Spacing Scale');
    lines.push('');
    lines.push('Base spacing scale used across layout, padding, and gap utilities.');
    lines.push('');
    const spacingEntries = Object.entries(tokens.spacing).sort((a, b) => a[1] - b[1]);
    for (const [key, px] of spacingEntries) {
        lines.push(`- ${px}px (${key}): spacing token \`${key}\``);
    }
    lines.push('');

    // --- Radius Scale ---
    lines.push('### Radius Scale');
    lines.push('');
    const radiusEntries = Object.entries(tokens.radius).sort((a, b) => a[1] - b[1]);
    for (const [key, px] of radiusEntries) {
        lines.push(`- ${px}px (${key}): radius token \`${key}\``);
    }
    lines.push('');

    // --- Component Patterns ---
    lines.push('### Component Patterns');
    lines.push('');
    const componentEntries = Object.entries(tokens.components).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [name, c] of componentEntries) {
        lines.push(`**${titleCase(name)}** (\`${name}\`)`);
        const fields: string[] = [];
        if (c.background) fields.push(`background \`${c.background}\``);
        if (c.text) fields.push(`text \`${c.text}\``);
        if (c.border) fields.push(`border \`${c.border}\``);
        if (c.radius) fields.push(`radius \`${c.radius}\``);
        if (c.padding) fields.push(`padding \`${c.padding}\``);
        if (fields.length > 0) lines.push(`- ${fields.join(', ')}`);
        if (c.notes) lines.push(`- Notes: ${c.notes}`);
        lines.push('');
    }

    // --- Usage Rules ---
    lines.push('### Usage Rules');
    lines.push('');
    for (const r of tokens.rules) {
        lines.push(`- ${r}`);
    }
    lines.push('');

    return lines.join('\n');
}
