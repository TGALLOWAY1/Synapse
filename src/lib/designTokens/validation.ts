// Lightweight, regex-based compliance check for generated mockup HTML
// against a DesignTokens object. Intentionally cheap — runs once per
// generated screen — and intentionally non-blocking. Output is stored
// in metadata so the UI can surface warnings; nothing here gates
// generation.

import type { DesignTokens } from '../../types';

export interface DesignSystemComplianceCounts {
    /** Number of distinct hex colors found in the HTML. */
    distinctHexes: number;
    /** Number of distinct hex colors NOT present in the token set. */
    unknownHexes: number;
    /** Number of inline `style="..."` attributes. */
    inlineStyleAttrs: number;
    /** Whether the HTML references at least one `var(--color-...)` or
     *  `var(--spacing-...)` / `var(--radius-...)` from the token set. */
    referencesCssVars: boolean;
}

export interface DesignSystemCompliance {
    /** 0..1, higher is better. Heuristic — see notes below. */
    score: number;
    /** Human-readable warnings the UI can surface. Empty if compliant. */
    warnings: string[];
    counts: DesignSystemComplianceCounts;
}

const HEX_RE = /#[0-9a-fA-F]{6}\b/g;
const INLINE_STYLE_RE = /\sstyle\s*=\s*"[^"]*"/g;
const CSS_VAR_RE = /var\(--(?:color|spacing|radius|typography)-[a-z0-9-]+\)/i;
const CTA_LIKE_RE = /<button[^>]*(?:primary|cta|action)[^>]*>|<a[^>]*class="[^"]*(?:primary|cta|btn-primary)[^"]*"/i;

const normalizeHex = (h: string): string => h.toUpperCase();

const collectKnownHexes = (tokens: DesignTokens): Set<string> => {
    const set = new Set<string>();
    for (const v of Object.values(tokens.colors)) set.add(normalizeHex(v));
    for (const c of Object.values(tokens.components)) {
        for (const f of [c.background, c.text, c.border]) {
            if (f && /^#[0-9a-fA-F]{6}$/.test(f)) set.add(normalizeHex(f));
        }
    }
    return set;
};

/**
 * Validate a single HTML mockup fragment against a DesignTokens contract.
 * Returns a compliance summary suitable for storage on the
 * ArtifactVersion or per-screen metadata. Soft-validation only — never
 * throws.
 *
 * Heuristics applied:
 *   - Hex colors not in the token set count against the score.
 *   - Excessive inline-style attributes (>12) count slightly.
 *   - Missing `var(--color-...)` references when the HTML *should* be
 *     using brand colors (CTA-like elements present) emit a warning.
 *   - A primary CTA without `brand.primary` (or its var) emits a warning.
 */
export function validateMockupHtmlAgainstTokens(
    html: string,
    tokens: DesignTokens,
): DesignSystemCompliance {
    const knownHexes = collectKnownHexes(tokens);
    const allHexes = (html.match(HEX_RE) || []).map(normalizeHex);
    const distinctHexes = new Set(allHexes);
    const unknownHexes = new Set<string>();
    for (const h of distinctHexes) {
        if (!knownHexes.has(h)) unknownHexes.add(h);
    }

    const inlineStyleMatches = html.match(INLINE_STYLE_RE) || [];
    const referencesCssVars = CSS_VAR_RE.test(html);

    const counts: DesignSystemComplianceCounts = {
        distinctHexes: distinctHexes.size,
        unknownHexes: unknownHexes.size,
        inlineStyleAttrs: inlineStyleMatches.length,
        referencesCssVars,
    };

    const warnings: string[] = [];
    let score = 1.0;

    if (unknownHexes.size > 0) {
        const sample = Array.from(unknownHexes).slice(0, 3).join(', ');
        warnings.push(
            `Found ${unknownHexes.size} color${unknownHexes.size === 1 ? '' : 's'} not present in design system tokens (${sample}${unknownHexes.size > 3 ? ', …' : ''}).`,
        );
        // Each unknown hex eats into the score; cap impact at 0.5.
        score -= Math.min(0.5, unknownHexes.size * 0.1);
    }

    const hasCta = CTA_LIKE_RE.test(html);
    const brandPrimaryHex = tokens.colors['brand.primary']
        ? normalizeHex(tokens.colors['brand.primary'])
        : null;
    if (hasCta && brandPrimaryHex) {
        const usesBrandHex = distinctHexes.has(brandPrimaryHex);
        const usesBrandVar = /var\(--color-brand-primary\)/i.test(html);
        if (!usesBrandHex && !usesBrandVar) {
            warnings.push('Primary CTA does not use brand.primary (token or CSS variable).');
            score -= 0.15;
        }
    }

    if (inlineStyleMatches.length > 12) {
        warnings.push(
            `Heavy use of inline style attributes (${inlineStyleMatches.length} occurrences). Prefer Tailwind utilities or CSS variable references.`,
        );
        score -= 0.05;
    }

    // If tokens were injected (we have CSS variables available) but HTML
    // doesn't reference them at all, surface a hint. Don't penalize hard
    // because legitimate mockups can use Tailwind utilities exclusively.
    if (!referencesCssVars && hasCta) {
        warnings.push('Mockup does not reference any design system CSS variables (var(--color-…)).');
        score -= 0.05;
    }

    score = Math.max(0, Math.min(1, score));
    return { score: Number(score.toFixed(2)), warnings, counts };
}
