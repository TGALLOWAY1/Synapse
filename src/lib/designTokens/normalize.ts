// Coerce raw LLM output (or legacy persisted data) into a canonical
// DesignTokens object. Strips unknown keys, enforces hex format on color
// values, and fills sensible defaults so downstream consumers (CSS
// variable emitter, prompt snippet builder, validator) can rely on the
// shape without per-call defensive code.

import type {
    DesignColorToken,
    DesignComponentToken,
    DesignTokens,
    DesignTypographyToken,
} from '../../types';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const HEX_SHORT_RE = /^#[0-9a-fA-F]{3}$/;

const DEFAULT_COLORS: Record<string, DesignColorToken> = {
    'brand.primary': '#6366F1',
    'brand.secondary': '#10B981',
    'text.primary': '#0F172A',
    'text.secondary': '#475569',
    'surface.app': '#FFFFFF',
    'surface.card': '#F8FAFC',
    'border.subtle': '#E2E8F0',
    'state.success': '#10B981',
    'state.warning': '#F59E0B',
    'state.error': '#EF4444',
    'state.info': '#3B82F6',
};

const DEFAULT_TYPOGRAPHY: Record<string, DesignTypographyToken> = {
    'heading.xl': { font: 'Inter', size: 48, weight: 700, lineHeight: 1.1 },
    'heading.lg': { font: 'Inter', size: 32, weight: 600, lineHeight: 1.2 },
    'heading.md': { font: 'Inter', size: 22, weight: 600, lineHeight: 1.3 },
    'body.md': { font: 'Inter', size: 16, weight: 400, lineHeight: 1.5 },
    'body.sm': { font: 'Inter', size: 14, weight: 400, lineHeight: 1.5 },
};

const DEFAULT_SPACING: Record<string, number> = {
    xs: 4, sm: 8, md: 16, lg: 24, xl: 32,
};

const DEFAULT_RADIUS: Record<string, number> = {
    sm: 6, md: 10, lg: 16,
};

const DEFAULT_COMPONENTS: Record<string, DesignComponentToken> = {
    'button.primary': {
        background: 'brand.primary',
        text: '#FFFFFF',
        radius: 'md',
        padding: 'sm md',
    },
    'card.default': {
        background: 'surface.card',
        border: 'border.subtle',
        radius: 'lg',
        padding: 'lg',
    },
    'input.default': {
        background: 'surface.app',
        border: 'border.subtle',
        text: 'text.primary',
        radius: 'md',
    },
};

const DEFAULT_RULES: string[] = [
    'Use only the defined color tokens — do not invent new brand colors.',
    'Use typography tokens for all major text styles.',
    'Use component tokens for buttons, cards, inputs, panels, and navigation.',
    'Use brand.primary only for primary actions.',
    'Use state colors only for status, warning, success, error, or info states.',
];

const expandShortHex = (h: string): string =>
    `#${h.slice(1).split('').map(c => c + c).join('')}`;

const coerceHex = (raw: unknown, fallback: string): string => {
    if (typeof raw !== 'string') return fallback;
    const trimmed = raw.trim();
    if (HEX_RE.test(trimmed)) return trimmed.toUpperCase();
    if (HEX_SHORT_RE.test(trimmed)) return expandShortHex(trimmed).toUpperCase();
    return fallback;
};

const coerceNumber = (raw: unknown, fallback: number): number => {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string') {
        const n = Number(raw.replace(/px$/, '').trim());
        if (Number.isFinite(n)) return n;
    }
    return fallback;
};

const coerceTypographyToken = (
    raw: unknown,
    fallback: DesignTypographyToken,
): DesignTypographyToken => {
    if (!raw || typeof raw !== 'object') return { ...fallback };
    const r = raw as Record<string, unknown>;
    return {
        font: typeof r.font === 'string' && r.font.trim() ? r.font.trim() : fallback.font,
        size: coerceNumber(r.size, fallback.size),
        weight: coerceNumber(r.weight, fallback.weight),
        lineHeight: coerceNumber(r.lineHeight, fallback.lineHeight),
        ...(r.letterSpacing !== undefined
            ? { letterSpacing: coerceNumber(r.letterSpacing, 0) }
            : {}),
    };
};

const coerceComponentToken = (raw: unknown): DesignComponentToken => {
    if (!raw || typeof raw !== 'object') return {};
    const r = raw as Record<string, unknown>;
    const out: DesignComponentToken = {};
    if (typeof r.background === 'string' && r.background.trim()) out.background = r.background.trim();
    if (typeof r.text === 'string' && r.text.trim()) out.text = r.text.trim();
    if (typeof r.border === 'string' && r.border.trim()) out.border = r.border.trim();
    if (typeof r.radius === 'string' && r.radius.trim()) out.radius = r.radius.trim();
    if (typeof r.padding === 'string' && r.padding.trim()) out.padding = r.padding.trim();
    if (typeof r.notes === 'string' && r.notes.trim()) out.notes = r.notes.trim();
    return out;
};

/**
 * Coerce arbitrary input into a canonical DesignTokens object. Missing keys
 * are filled from sane defaults so the contract is always complete; unknown
 * keys are preserved (useful for product-specific extensions) for `colors`,
 * `typography`, `components`, `spacing`, and `radius` namespaces, but
 * non-object/non-conforming values are dropped.
 */
export function normalizeDesignTokens(raw: unknown): DesignTokens {
    const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

    // Colors: required keys filled with defaults; extra keys preserved if hex-valid.
    const colorsRaw = obj.colors && typeof obj.colors === 'object'
        ? (obj.colors as Record<string, unknown>)
        : {};
    const colors: Record<string, DesignColorToken> = {};
    for (const key of Object.keys(DEFAULT_COLORS)) {
        colors[key] = coerceHex(colorsRaw[key], DEFAULT_COLORS[key]);
    }
    for (const [key, val] of Object.entries(colorsRaw)) {
        if (key in colors) continue;
        const hex = coerceHex(val, '');
        if (hex) colors[key] = hex;
    }

    // Typography: required slots filled; extra slots preserved if shape-valid.
    const typographyRaw = obj.typography && typeof obj.typography === 'object'
        ? (obj.typography as Record<string, unknown>)
        : {};
    const typography: Record<string, DesignTypographyToken> = {};
    for (const [key, fallback] of Object.entries(DEFAULT_TYPOGRAPHY)) {
        typography[key] = coerceTypographyToken(typographyRaw[key], fallback);
    }
    for (const [key, val] of Object.entries(typographyRaw)) {
        if (key in typography) continue;
        if (val && typeof val === 'object') {
            typography[key] = coerceTypographyToken(val, DEFAULT_TYPOGRAPHY['body.md']);
        }
    }

    // Spacing & radius: required slots; extras preserved.
    const spacing: Record<string, number> = {};
    const spacingRaw = obj.spacing && typeof obj.spacing === 'object'
        ? (obj.spacing as Record<string, unknown>) : {};
    for (const [key, fallback] of Object.entries(DEFAULT_SPACING)) {
        spacing[key] = Math.max(0, Math.round(coerceNumber(spacingRaw[key], fallback)));
    }
    for (const [key, val] of Object.entries(spacingRaw)) {
        if (key in spacing) continue;
        const n = coerceNumber(val, NaN);
        if (Number.isFinite(n)) spacing[key] = Math.max(0, Math.round(n));
    }

    const radius: Record<string, number> = {};
    const radiusRaw = obj.radius && typeof obj.radius === 'object'
        ? (obj.radius as Record<string, unknown>) : {};
    for (const [key, fallback] of Object.entries(DEFAULT_RADIUS)) {
        radius[key] = Math.max(0, Math.round(coerceNumber(radiusRaw[key], fallback)));
    }
    for (const [key, val] of Object.entries(radiusRaw)) {
        if (key in radius) continue;
        const n = coerceNumber(val, NaN);
        if (Number.isFinite(n)) radius[key] = Math.max(0, Math.round(n));
    }

    // Components: required slots filled; extras preserved.
    const components: Record<string, DesignComponentToken> = {};
    const componentsRaw = obj.components && typeof obj.components === 'object'
        ? (obj.components as Record<string, unknown>) : {};
    for (const [key, fallback] of Object.entries(DEFAULT_COMPONENTS)) {
        const incoming = coerceComponentToken(componentsRaw[key]);
        components[key] = Object.keys(incoming).length > 0 ? incoming : { ...fallback };
    }
    for (const [key, val] of Object.entries(componentsRaw)) {
        if (key in components) continue;
        const c = coerceComponentToken(val);
        if (Object.keys(c).length > 0) components[key] = c;
    }

    // Rules: at least DEFAULT_RULES if absent.
    const rulesRaw = Array.isArray(obj.rules) ? obj.rules : [];
    const rules = rulesRaw
        .map(r => (typeof r === 'string' ? r.trim() : ''))
        .filter(r => r.length > 0);
    if (rules.length === 0) rules.push(...DEFAULT_RULES);

    return {
        version: 1,
        colors,
        typography,
        spacing,
        radius,
        components,
        rules,
    };
}
